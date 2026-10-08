import { forwardRef } from "react";
import type { SetupState } from "../hooks/useEngineSetup";
import { deviceLabel, isGpu } from "../lib/format";
import type { EngineStatus } from "../types";
import { PlusIcon, SearchIcon, SettingsIcon } from "./icons";

interface TopBarProps {
  search: string;
  onSearch: (value: string) => void;
  showSearch: boolean;
  engine: EngineStatus | null;
  checkingEngine: boolean;
  setup: SetupState;
  /** Clic en la píldora del motor: la instalación si falta, los ajustes si no. */
  onOpenEngine: () => void;
  onOpenSettings: () => void;
  onNewExtraction: () => void;
  newExtractionOpen: boolean;
  /** Punto en el botón de ajustes cuando hay una actualización. */
  updateAvailable: boolean;
}

export const TopBar = forwardRef<HTMLInputElement, TopBarProps>(function TopBar(
  {
    search,
    onSearch,
    showSearch,
    engine,
    checkingEngine,
    setup,
    onOpenEngine,
    onOpenSettings,
    onNewExtraction,
    newExtractionOpen,
    updateAvailable,
  },
  searchRef,
) {
  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
      <span className="shrink-0 text-sm font-semibold tracking-tight text-ink-2">
        Audio<span className="text-accent">Extract</span>
      </span>

      {showSearch && (
        <label className="relative ml-2 flex w-72 max-w-[40vw] items-center">
          <SearchIcon width={15} height={15} className="pointer-events-none absolute left-2.5 text-ink-3" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(event) => onSearch(event.currentTarget.value)}
            placeholder="Buscar en la biblioteca"
            aria-label="Buscar en la biblioteca"
            className="h-8 w-full rounded-lg border border-transparent bg-panel pr-12 pl-8 text-[13px] text-ink transition-colors outline-none select-text hover:border-line focus:border-accent/60"
          />
          <kbd className="pointer-events-none absolute right-2 rounded border border-line px-1 font-sans text-[10px] text-ink-3">
            Ctrl K
          </kbd>
        </label>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <EnginePill engine={engine} checking={checkingEngine} setup={setup} onClick={onOpenEngine} />
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={updateAvailable ? "Ajustes (hay una actualización)" : "Ajustes"}
          title="Ajustes"
          className="relative flex size-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-raised hover:text-ink"
        >
          <SettingsIcon width={17} height={17} />
          {updateAvailable && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent ring-2 ring-surface" />}
        </button>
        <button
          type="button"
          onClick={onNewExtraction}
          aria-expanded={newExtractionOpen}
          className="ml-1.5 flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-surface transition-[filter] hover:brightness-110 active:brightness-95"
        >
          <PlusIcon width={15} height={15} strokeWidth={2.2} />
          Nueva extracción
        </button>
      </div>
    </header>
  );
});

function EnginePill({
  engine,
  checking,
  setup,
  onClick,
}: {
  engine: EngineStatus | null;
  checking: boolean;
  setup: SetupState;
  onClick: () => void;
}) {
  let dot = "bg-ink-4";
  let text = "Comprobando el motor…";
  let title = "Comprobando el motor de separación";
  let pulse = checking;
  if (setup.phase === "running") {
    dot = "bg-accent";
    pulse = true;
    text = `${setup.update ? "Actualizando motor" : "Instalando motor"} · ${Math.round(setup.percent)} %`;
    title = "El motor de separación se está instalando";
  } else if (!checking && engine?.needsSetup) {
    dot = "bg-warning";
    text = "Instalar el motor";
    title = "El motor de separación se instala una vez, desde «Nueva extracción»";
  } else if (!checking && engine) {
    if (!engine.ready) {
      dot = "bg-danger";
      text = "Motor no disponible";
      title = engine.problem ?? text;
    } else if (isGpu(engine.device)) {
      dot = "bg-accent";
      text = deviceLabel(engine.device);
      title = `Motor listo · ${engine.deviceName ?? deviceLabel(engine.device)}`;
    } else {
      dot = "bg-warning";
      text = "CPU";
      title = "Motor listo, sin GPU: la separación será más lenta";
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-7 items-center gap-2 rounded-full px-2.5 text-xs text-ink-3 transition-colors hover:bg-raised hover:text-ink-2"
    >
      <span className={`size-1.5 rounded-full ${dot} ${pulse ? "animate-pulse" : ""}`} aria-hidden />
      <span className="tabular-nums">{text}</span>
    </button>
  );
}
