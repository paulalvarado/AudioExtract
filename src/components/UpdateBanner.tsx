import type { UpdateState } from "../hooks/useUpdater";
import { formatBytes } from "../lib/format";
import { CloseIcon, DownloadIcon } from "./icons";

interface UpdateBannerProps {
  state: UpdateState;
  onInstall: () => void;
  onDetails: () => void;
  onDismiss: () => void;
}

/** Aviso fino bajo la barra superior cuando hay una versión nueva; nunca bloquea la app. */
export function UpdateBanner({ state, onInstall, onDetails, onDismiss }: UpdateBannerProps) {
  if (state.phase !== "available" && state.phase !== "downloading" && state.phase !== "installing") return null;

  const busy = state.phase !== "available";
  const fraction = state.phase === "downloading" && state.total ? state.received / state.total : null;

  return (
    <div className="relative flex h-9 shrink-0 items-center gap-3 overflow-hidden border-b border-line bg-panel px-4 text-[13px]" role="status">
      <DownloadIcon width={15} height={15} className="text-accent" />
      <p className="min-w-0 flex-1 truncate text-ink-2">
        {state.phase === "available" && (
          <>
            <span className="font-medium text-ink">AudioExtract {state.version}</span> está disponible. Se instala encima
            de esta versión y tu biblioteca se conserva.
          </>
        )}
        {state.phase === "downloading" && (
          <>
            Descargando AudioExtract {state.version}
            {state.total ? ` · ${formatBytes(state.received)} de ${formatBytes(state.total)}` : "…"}
          </>
        )}
        {state.phase === "installing" && <>Instalando AudioExtract {state.version}; la app se reiniciará sola…</>}
      </p>
      {!busy && (
        <>
          <button type="button" onClick={onDetails} className="rounded-md px-2 py-1 text-ink-3 transition-colors hover:bg-raised hover:text-ink">
            Novedades
          </button>
          <button
            type="button"
            onClick={onInstall}
            className="rounded-md bg-accent px-2.5 py-1 font-semibold text-surface transition-[filter] hover:brightness-110"
          >
            Instalar y reiniciar
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Ocultar aviso"
            className="flex size-6 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-raised hover:text-ink"
          >
            <CloseIcon width={14} height={14} />
          </button>
        </>
      )}
      {busy && (
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-raised" aria-hidden>
          <span
            className={`block h-full bg-accent transition-[width] duration-300 ${fraction === null ? "w-1/3 animate-pulse" : ""}`}
            style={fraction === null ? undefined : { width: `${fraction * 100}%` }}
          />
        </span>
      )}
    </div>
  );
}
