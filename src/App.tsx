import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Dock } from "./components/Dock";
import { EngineSetup } from "./components/EngineSetup";
import { ExportPanel } from "./components/ExportPanel";
import { JobRow } from "./components/JobRow";
import { LibraryView } from "./components/LibraryView";
import { MixerView } from "./components/MixerView";
import { NewExtraction } from "./components/NewExtraction";
import { SettingsSheet } from "./components/SettingsSheet";
import { TopBar } from "./components/TopBar";
import { UpdateBanner } from "./components/UpdateBanner";
import { setupVariant, useEngineSetup } from "./hooks/useEngineSetup";
import { availableQualities, supportsInstrument, useEngineStatus } from "./hooks/useEngineStatus";
import { useFileDrop } from "./hooks/useFileDrop";
import { useLibrary } from "./hooks/useLibrary";
import { usePlayer } from "./hooks/usePlayer";
import { usePreferences } from "./hooks/usePreferences";
import { useSeparation } from "./hooks/useSeparation";
import { useUpdater } from "./hooks/useUpdater";
import { isGpu } from "./lib/format";
import { appInfo, AUDIO_EXTENSIONS, AUDIO_FORMATS_LABEL, fileName, libraryOpen, toAppError } from "./lib/tauri";
import type { AppInfo, EngineStatus, LibraryItem, Quality } from "./types";

type Panel = { kind: "settings" } | { kind: "export"; itemId: string } | null;

/** Máxima con GPU, rápida sin ella; o la que el usuario eligió, si el motor la tiene. */
function resolveQuality(preferred: Quality | null, engine: EngineStatus | null): Quality {
  const available = availableQualities(engine);
  if (preferred && available.includes(preferred)) return preferred;
  if (available.includes("best") && isGpu(engine?.device ?? null)) return "best";
  return available.includes("fast") ? "fast" : (available[0] ?? "fast");
}

export default function App() {
  const [preferences, setPreferences] = usePreferences();
  const { status: engine, checking: checkingEngine, refresh: recheckEngine, replace: replaceEngine } = useEngineStatus();
  const setup = useEngineSetup(engine, replaceEngine);
  const library = useLibrary();
  const { player, load, unload } = usePlayer(library.setMix);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const updater = useUpdater(info?.updater ?? false, preferences.checkUpdates);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  const [view, setView] = useState<"library" | "mixer">("library");
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    appInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const items = useMemo(() => library.listing?.items ?? [], [library.listing]);
  const currentId = player.status === "empty" ? null : player.itemId;
  const currentItem = items.find((item) => item.id === currentId) ?? null;
  const engineReady = player.status === "ready" ? player.engine : null;
  const quality = resolveQuality(preferences.quality, engine);
  const [playing, setPlaying] = useState(false);

  // Solo interesa saber si suena, para las filas de la biblioteca.
  useEffect(() => {
    if (!engineReady) {
      setPlaying(false);
      return;
    }
    const sync = () => setPlaying(engineReady.getSnapshot().playing);
    sync();
    return engineReady.subscribe(sync);
  }, [engineReady]);

  const separation = useSeparation((item) => {
    library.upsert(item);
    setNotice({ text: `Lista: «${item.title}». Ya está en tu biblioteca.`, tone: "info" });
    if (player.status === "empty") void load(item, false);
  });
  const busy = separation.job.phase === "running";

  const startFile = useCallback(
    (path: string) => {
      if (busy) {
        setNotice({ text: "Ya hay una separación en marcha. Podrás soltar otra cuando termine.", tone: "info" });
        return;
      }
      if (!engine?.ready) {
        setNewOpen(true);
        setView("library");
        setNotice({
          text: engine?.needsSetup
            ? `Para separar «${fileName(path)}», primero instala el motor de separación.`
            : `No se puede separar «${fileName(path)}»: el motor no está listo. ${engine?.problem ?? "Compruébalo en Ajustes."}`,
          tone: engine?.needsSetup ? "info" : "error",
        });
        return;
      }
      setNewOpen(false);
      setView("library");
      setSearch("");
      void separation.start(path, {
        instruments: preferences.instruments.filter((stem) => supportsInstrument(engine, quality, stem)),
        quality,
      });
    },
    [busy, engine, preferences.instruments, quality, separation],
  );

  const hover = useFileDrop(true, startFile, (paths) =>
    setNotice({ text: `«${fileName(paths[0] ?? "")}» no es un archivo de audio compatible (${AUDIO_FORMATS_LABEL}).`, tone: "error" }),
  );

  const browse = useCallback(async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Audio", extensions: [...AUDIO_EXTENSIONS] }],
    });
    if (typeof selected === "string") startFile(selected);
  }, [startFile]);

  // Si la extracción cargada desaparece (borrada, otra carpeta de biblioteca…), se descarga.
  useEffect(() => {
    if (currentId && library.listing && !items.some((item) => item.id === currentId)) {
      unload();
      setView("library");
    }
  }, [currentId, items, library.listing, unload]);

  useEffect(() => {
    if (view === "mixer" && player.status === "empty") setView("library");
  }, [view, player.status]);

  const playItem = useCallback(
    (item: LibraryItem) => {
      if (player.status === "ready" && player.itemId === item.id) {
        player.engine.toggle();
        return;
      }
      if (player.status === "loading" && player.itemId === item.id) return;
      void load(item, true);
    },
    [player, load],
  );

  const openMixer = useCallback(
    (item: LibraryItem) => {
      if (player.status === "empty" || player.itemId !== item.id) void load(item, false);
      setView("mixer");
    },
    [player, load],
  );

  const reveal = useCallback((item: LibraryItem) => {
    const target = item.files.find((file) => !item.missing.includes(file.id))?.path ?? item.dir;
    revealItemInDir(target).catch((raw: unknown) => setNotice({ text: toAppError(raw).message, tone: "error" }));
  }, []);

  const openLibraryFolder = useCallback(() => {
    libraryOpen().catch((raw: unknown) => setNotice({ text: toAppError(raw).message, tone: "error" }));
  }, []);

  const deleteItem = useCallback(
    async (item: LibraryItem, permanent: boolean) => {
      if (item.id === currentId) {
        unload();
        setView("library");
      }
      await library.remove(item.id, permanent);
      setNotice({ text: permanent ? `«${item.title}» eliminada.` : `«${item.title}» se movió a la papelera.`, tone: "info" });
    },
    [currentId, library, unload],
  );

  // Atajos globales. Los controles con teclado propio (campos, botones, deslizadores) tienen prioridad.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, [contenteditable=true]");
      const ctrl = event.ctrlKey || event.metaKey;

      if (ctrl && (event.key === "k" || event.key === "f")) {
        event.preventDefault();
        setView("library");
        requestAnimationFrame(() => searchRef.current?.focus());
        return;
      }
      if (ctrl && event.key === "n") {
        event.preventDefault();
        setView("library");
        setNewOpen(true);
        return;
      }
      if (typing || ctrl || event.altKey) return;
      if (event.key === "Escape" && newOpen && items.length > 0) {
        setNewOpen(false);
        return;
      }
      if (!engineReady) return;
      if (target?.closest("button, [role=slider], [role=spinbutton]") && event.code !== "Space") return;

      if (event.code === "Space") {
        if (target?.closest("button")) return;
        event.preventDefault();
        engineReady.toggle();
      } else if (event.code === "Home") {
        engineReady.seek(0);
      } else if (event.code === "ArrowLeft") {
        engineReady.seek(engineReady.position - 5);
      } else if (event.code === "ArrowRight") {
        engineReady.seek(engineReady.position + 5);
      } else if (event.key === "m" || event.key === "M") {
        setView((current) => (current === "mixer" ? "library" : "mixer"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engineReady, newOpen, items.length]);

  const exportItem = panel?.kind === "export" ? items.find((item) => item.id === panel.itemId) : undefined;
  const firstRun = library.listing !== null && items.length === 0;
  // La tarjeta de instalación ocupa el sitio de las opciones (y del aviso de motor no disponible).
  const setupCard =
    engine?.needsSetup || setup.state.phase === "running" ? (
      <EngineSetup
        plan={setup.plan}
        planError={setup.planError}
        state={setup.state}
        onStart={(variant) => void setup.start(variant)}
        onCancel={setup.cancel}
      />
    ) : null;
  const showNew = newOpen || (firstRun && separation.job.phase === "idle");
  const showUpdate = !updateDismissed && ["available", "downloading", "installing"].includes(updater.state.phase);

  return (
    <main className="flex h-full flex-col">
      <TopBar
        ref={searchRef}
        search={search}
        onSearch={setSearch}
        showSearch={view === "library" && items.length > 0}
        engine={engine}
        checkingEngine={checkingEngine}
        setup={setup.state}
        onOpenEngine={() => {
          if (setupCard) {
            setView("library");
            setNewOpen(true);
          } else {
            setPanel({ kind: "settings" });
          }
        }}
        onOpenSettings={() => setPanel({ kind: "settings" })}
        onNewExtraction={() => {
          setView("library");
          setNewOpen((open) => (firstRun ? true : !open || view !== "library"));
        }}
        newExtractionOpen={showNew && view === "library"}
        updateAvailable={updater.state.phase === "available"}
      />
      {showUpdate && (
        <UpdateBanner
          state={updater.state}
          onInstall={() => void updater.install()}
          onDetails={() => setPanel({ kind: "settings" })}
          onDismiss={() => setUpdateDismissed(true)}
        />
      )}

      {view === "mixer" && engineReady && currentItem ? (
        <MixerView engine={engineReady} item={currentItem} onBack={() => setView("library")} onReveal={() => reveal(currentItem)} />
      ) : view === "mixer" ? (
        <div className="flex flex-1 items-center justify-center gap-2.5 text-[13px] text-ink-2">
          <span className="size-3.5 animate-spin rounded-full border-2 border-ink-4 border-t-accent" aria-hidden />
          Cargando las pistas…
        </div>
      ) : (
        <LibraryView
          listing={library.listing}
          error={library.error}
          search={search}
          onClearSearch={() => setSearch("")}
          currentId={currentId}
          playing={playing}
          loadingCurrent={player.status === "loading"}
          header={
            <>
              {showNew && (
                <NewExtraction
                  engine={engine}
                  checkingEngine={checkingEngine}
                  onRecheck={() => void recheckEngine()}
                  setup={setupCard}
                  instruments={preferences.instruments}
                  onInstruments={(instruments) => setPreferences({ instruments })}
                  quality={quality}
                  onQuality={(next) => setPreferences({ quality: next })}
                  hover={hover}
                  busy={busy}
                  onBrowse={() => void browse()}
                  onClose={firstRun ? undefined : () => setNewOpen(false)}
                />
              )}
            </>
          }
          job={
            separation.job.phase !== "idle" && (
              <JobRow
                job={separation.job}
                onCancel={separation.cancel}
                onRetry={() => {
                  if (separation.job.phase === "error") void separation.start(separation.job.file, separation.job.request);
                }}
                onDismiss={separation.dismiss}
              />
            )
          }
          onPlay={playItem}
          onOpenMixer={openMixer}
          onExport={(item) => setPanel({ kind: "export", itemId: item.id })}
          onReveal={reveal}
          onRename={async (item, title) => {
            try {
              await library.rename(item.id, title);
            } catch (raw) {
              setNotice({ text: toAppError(raw).message, tone: "error" });
              throw raw;
            }
          }}
          onDelete={deleteItem}
          onOpenFolder={openLibraryFolder}
          onRetry={() => void library.reload()}
        />
      )}

      <Dock
        player={player}
        item={currentItem}
        libraryEmpty={firstRun}
        expanded={view === "mixer"}
        onToggleExpanded={() => setView((current) => (current === "mixer" ? "library" : "mixer"))}
        onExport={() => currentItem && setPanel({ kind: "export", itemId: currentItem.id })}
        onRetry={() => currentItem && void load(currentItem, false)}
      />

      {panel?.kind === "settings" && (
        <SettingsSheet
          info={info}
          listing={library.listing}
          engine={engine}
          checkingEngine={checkingEngine}
          setup={setupCard}
          setupPlan={setup.plan}
          onReinstallEngine={() => {
            const variant = setup.plan && setupVariant(setup.plan);
            if (variant) void setup.start(variant);
          }}
          update={updater.state}
          checkUpdates={preferences.checkUpdates}
          onClose={() => setPanel(null)}
          onOpenLibrary={openLibraryFolder}
          onChooseLibrary={() =>
            void library.chooseDir().catch((raw: unknown) => setNotice({ text: toAppError(raw).message, tone: "error" }))
          }
          onResetLibrary={() =>
            void library.resetDir().catch((raw: unknown) => setNotice({ text: toAppError(raw).message, tone: "error" }))
          }
          onRecheckEngine={() => void recheckEngine()}
          onCheckUpdates={() => void updater.checkNow()}
          onInstallUpdate={() => void updater.install()}
          onToggleCheckUpdates={(checkUpdates) => setPreferences({ checkUpdates })}
        />
      )}
      {exportItem && (
        <ExportPanel
          key={exportItem.id}
          item={exportItem}
          engine={engineReady && currentId === exportItem.id ? engineReady : null}
          format={preferences.exportFormat}
          onFormat={(exportFormat) => setPreferences({ exportFormat })}
          applyMix={preferences.exportApplyMix}
          onApplyMix={(exportApplyMix) => setPreferences({ exportApplyMix })}
          onClose={() => setPanel(null)}
        />
      )}

      {hover !== "none" && !(showNew && view === "library") && (
        <div className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-surface/85 backdrop-blur-sm">
          <p className="text-lg font-medium text-ink">
            {hover === "invalid"
              ? `Solo se admiten archivos ${AUDIO_FORMATS_LABEL}`
              : busy
                ? "Espera a que termine la separación en curso"
                : engine?.needsSetup
                  ? "Primero instala el motor de separación"
                  : !engine?.ready
                  ? "El motor no está listo: no se puede separar ahora"
                  : "Suelta para separar esta canción"}
          </p>
        </div>
      )}

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`fixed bottom-24 left-5 z-50 max-w-md rounded-xl border px-4 py-2.5 text-[13px] ${
            notice.tone === "error" ? "border-danger/40 bg-panel text-danger" : "border-line bg-panel text-ink-2"
          }`}
        >
          {notice.text}
        </p>
      )}
    </main>
  );
}
