import type { ReactNode } from "react";
import type { UpdateState } from "../hooks/useUpdater";
import { deviceLabel, formatDate, isGpu } from "../lib/format";
import { STEM_LABELS, type AppInfo, type EngineStatus, type LibraryListing, type Quality } from "../types";
import { AlertIcon, FolderIcon, RefreshIcon } from "./icons";
import { Sheet, SheetSection } from "./Sheet";

interface SettingsSheetProps {
  info: AppInfo | null;
  listing: LibraryListing | null;
  engine: EngineStatus | null;
  checkingEngine: boolean;
  update: UpdateState;
  checkUpdates: boolean;
  onClose: () => void;
  onOpenLibrary: () => void;
  onChooseLibrary: () => void;
  onResetLibrary: () => void;
  onRecheckEngine: () => void;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
  onToggleCheckUpdates: (enabled: boolean) => void;
}

const QUALITY_NAMES: Record<Quality, string> = { best: "máxima (BS-RoFormer)", fast: "rápida (Demucs)" };

export function SettingsSheet(props: SettingsSheetProps) {
  const { info, listing, engine, checkingEngine, update } = props;

  return (
    <Sheet title="Ajustes" subtitle={info ? `AudioExtract ${info.version}` : undefined} onClose={props.onClose}>
      <SheetSection title="Biblioteca">
        <p className="truncate rounded-lg bg-surface/60 px-3 py-2 text-xs text-ink-2 select-text" title={listing?.dir}>
          {listing?.dir ?? "…"}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <SmallButton onClick={props.onOpenLibrary}>
            <FolderIcon width={14} height={14} />
            Abrir
          </SmallButton>
          <SmallButton onClick={props.onChooseLibrary}>Cambiar carpeta…</SmallButton>
          {listing && !listing.isDefault && <SmallButton onClick={props.onResetLibrary}>Usar la predeterminada</SmallButton>}
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-ink-3">
          Cada extracción es una carpeta independiente con sus pistas y su mezcla. Al cambiar de carpeta, las anteriores se
          quedan donde están: puedes moverlas a la nueva y aparecerán solas.
        </p>
      </SheetSection>

      <SheetSection title="Motor de separación">
        <EngineSummary engine={engine} checking={checkingEngine} />
        <SmallButton onClick={props.onRecheckEngine} disabled={checkingEngine} className="mt-3">
          <RefreshIcon width={14} height={14} className={checkingEngine ? "animate-spin" : ""} />
          {checkingEngine ? "Comprobando…" : "Comprobar de nuevo"}
        </SmallButton>
      </SheetSection>

      <SheetSection title="Actualizaciones">
        {info?.updater ? (
          <>
            <UpdateSummary update={update} version={info.version} />
            <div className="mt-3 flex flex-wrap gap-2">
              {update.phase === "available" ? (
                <button
                  type="button"
                  onClick={props.onInstallUpdate}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-surface transition-[filter] hover:brightness-110"
                >
                  Instalar {update.version} y reiniciar
                </button>
              ) : (
                <SmallButton onClick={props.onCheckUpdates} disabled={update.phase === "checking" || update.phase === "downloading"}>
                  <RefreshIcon width={14} height={14} className={update.phase === "checking" ? "animate-spin" : ""} />
                  Buscar actualizaciones
                </SmallButton>
              )}
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={props.checkUpdates}
                onChange={(event) => props.onToggleCheckUpdates(event.currentTarget.checked)}
                className="size-4"
              />
              Buscar al abrir la app
            </label>
          </>
        ) : (
          <p className="text-xs leading-relaxed text-ink-3">
            Esta compilación no busca actualizaciones por sí sola. Para actualizar, ejecuta el instalador de la versión nueva:
            se instala encima de esta y conserva tu biblioteca y tus ajustes.
          </p>
        )}
      </SheetSection>

      <SheetSection title="Atajos">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
          <Shortcut keys="Espacio">Reproducir o pausar</Shortcut>
          <Shortcut keys="← →">Retroceder o avanzar 5 s</Shortcut>
          <Shortcut keys="Inicio">Volver al principio</Shortcut>
          <Shortcut keys="Ctrl K">Buscar en la biblioteca</Shortcut>
          <Shortcut keys="Ctrl N">Nueva extracción</Shortcut>
          <Shortcut keys="M">Abrir o cerrar el mezclador</Shortcut>
          <Shortcut keys="Doble clic">En un fader: 0 dB · en el tono: original</Shortcut>
        </dl>
      </SheetSection>
    </Sheet>
  );
}

function EngineSummary({ engine, checking }: { engine: EngineStatus | null; checking: boolean }) {
  if (!engine || (checking && !engine.ready)) {
    return <p className="text-xs text-ink-3">Comprobando el motor…</p>;
  }
  if (!engine.ready) {
    return (
      <div role="alert" className="rounded-lg border border-danger/30 bg-surface/60 p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-danger">
          <AlertIcon width={14} height={14} />
          No disponible
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-2 select-text">{engine.problem}</p>
      </div>
    );
  }

  const qualities = (["best", "fast"] as const).filter((quality) => engine.qualities[quality] !== undefined);
  const extras = [
    ...new Set(qualities.flatMap((quality) => engine.qualities[quality] ?? [])),
    ...(engine.wind ? (["wind"] as const) : []),
  ];

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      <dt className="text-ink-3">Estado</dt>
      <dd className="flex items-center gap-1.5 text-ink">
        <span className={`size-1.5 rounded-full ${isGpu(engine.device) ? "bg-accent" : "bg-warning"}`} aria-hidden />
        Listo · {engine.kind === "docker" ? "Docker" : "Python local"}
      </dd>
      <dt className="text-ink-3">Acelerador</dt>
      <dd className="text-ink">
        {deviceLabel(engine.device)}
        {engine.deviceName && <span className="text-ink-3"> · {engine.deviceName}</span>}
      </dd>
      <dt className="text-ink-3">Calidades</dt>
      <dd className="text-ink">{qualities.map((quality) => QUALITY_NAMES[quality]).join(" y ")}</dd>
      <dt className="text-ink-3">Instrumentos</dt>
      <dd className="text-ink">
        Voces, batería, bajo, otros{extras.length > 0 && `, ${extras.map((id) => STEM_LABELS[id].toLowerCase()).join(", ")}`}
      </dd>
      <dt className="text-ink-3">Modo práctica</dt>
      <dd className={engine.transcription ? "text-ink" : "text-ink-2"}>
        {engine.transcription
          ? "Transcribe el bajo a tablatura"
          : "No disponible en este motor: reconstrúyelo con npm run docker:engine"}
      </dd>
      {engine.version && (
        <>
          <dt className="text-ink-3">Versión</dt>
          <dd className="text-ink">{engine.version}</dd>
        </>
      )}
      {engine.notes.length > 0 && (
        <dd className="col-span-2 mt-1.5 flex flex-col gap-1 text-ink-3 select-text">
          {engine.notes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </dd>
      )}
    </dl>
  );
}

function UpdateSummary({ update, version }: { update: UpdateState; version: string }) {
  let text: ReactNode = `Tienes la versión ${version}.`;
  if (update.phase === "checking") text = "Buscando actualizaciones…";
  if (update.phase === "current") text = `Tienes la última versión (${version}). Comprobado ${formatDate(update.checkedAt)}.`;
  if (update.phase === "available")
    text = (
      <>
        Hay una versión nueva: <span className="font-medium text-ink">{update.version}</span>. Se instala encima de esta y tu
        biblioteca se conserva.
      </>
    );
  if (update.phase === "downloading") text = `Descargando ${update.version}…`;
  if (update.phase === "installing") text = `Instalando ${update.version}; la app se reiniciará sola.`;
  if (update.phase === "error") text = <span className="text-danger">{update.message}</span>;

  return (
    <>
      <p className="text-xs leading-relaxed text-ink-2">{text}</p>
      {update.phase === "available" && update.notes && (
        <p className="mt-2 max-h-32 overflow-y-auto rounded-lg bg-surface/60 p-3 text-xs leading-relaxed whitespace-pre-line text-ink-3 select-text">
          {update.notes}
        </p>
      )}
    </>
  );
}

function Shortcut({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <>
      <dt>
        <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-sans text-[11px] text-ink-2">{keys}</kbd>
      </dt>
      <dd className="self-center text-ink-2">{children}</dd>
    </>
  );
}

function SmallButton({
  onClick,
  disabled,
  className = "",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-fit items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-xs text-ink transition-colors hover:bg-line disabled:opacity-55 ${className}`}
    >
      {children}
    </button>
  );
}
