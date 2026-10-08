import { useEffect, useState } from "react";
import type { SeparationJob } from "../hooks/useSeparation";
import { deviceLabel, formatTime } from "../lib/format";
import { fileName } from "../lib/tauri";
import { STEM_LABELS, STEM_ORDER, type AppError, type SeparationStage, type StemId } from "../types";
import { AlertIcon } from "./icons";
import { ROW_GRID } from "./LibraryRow";
import { stemStyle } from "./NewExtraction";

const STAGE_LABELS: Record<SeparationStage, string> = {
  loading_model: "Cargando el modelo",
  loading_audio: "Leyendo el audio",
  separating: "Separando instrumentos",
  wind: "Separando el viento",
  saving: "Guardando las pistas",
};

const ERROR_TITLES: Record<AppError["kind"], string> = {
  input: "No se puede usar este archivo",
  busy: "Ya hay una separación en marcha",
  environment: "El motor de separación no está listo",
  setup: "El motor de separación no está instalado",
  engine: "El motor no pudo separar la canción",
  cancelled: "Separación cancelada",
  library: "No se pudo guardar en la biblioteca",
  export: "No se pudo exportar",
  internal: "Algo salió mal",
};

interface JobRowProps {
  job: Exclude<SeparationJob, { phase: "idle" }>;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}

/** La separación en curso es la primera fila de la biblioteca, con sus mismas columnas. */
export function JobRow({ job, onCancel, onRetry, onDismiss }: JobRowProps) {
  const requested = new Set<StemId>(["vocals", "drums", "bass", "other", ...job.request.instruments]);

  if (job.phase === "error") {
    return (
      <li role="alert" className="flex items-start gap-3 bg-danger/5 px-4 py-3">
        <AlertIcon width={17} height={17} className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-ink">
            {ERROR_TITLES[job.error.kind]}
            <span className="ml-2 font-normal text-ink-3">{fileName(job.file)}</span>
          </p>
          <pre className="mt-2 max-h-36 overflow-auto rounded-lg bg-surface p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-2 select-text">
            {job.error.message}
          </pre>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-surface transition-opacity hover:opacity-90"
          >
            Reintentar
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-raised hover:text-ink"
          >
            Descartar
          </button>
        </div>
      </li>
    );
  }

  const { progress } = job;
  const label = progress.stage ? STAGE_LABELS[progress.stage] : "Arrancando el motor";
  const lastLog = progress.logs.at(-1);
  const percent = Math.floor(progress.percent);

  return (
    <li
      className={`relative grid h-14 items-center gap-x-3 bg-accent/4 px-2 ${ROW_GRID}`}
      aria-live="polite"
      aria-label={`Separando ${fileName(job.file)}: ${label}, ${percent} %`}
    >
      <span className="flex justify-center" aria-hidden>
        <span className="size-3.5 animate-spin rounded-full border-2 border-ink-4 border-t-accent" />
      </span>

      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-medium text-ink" title={job.file}>
          {fileName(job.file)}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-3" title={lastLog}>
          <span className="text-ink-2">{label}…</span> · {deviceLabel(progress.device)}
          {progress.deviceName && ` · ${progress.deviceName}`}
        </p>
      </div>

      <span
        className="flex items-center gap-1.5"
        role="img"
        aria-label={`Instrumentos: ${[...requested].map((id) => STEM_LABELS[id]).join(", ")}`}
      >
        {STEM_ORDER.map((id) =>
          requested.has(id) ? (
            <span key={id} title={STEM_LABELS[id]} style={stemStyle(id)} className="size-2.5 rounded-full border-2 border-(--stem)" />
          ) : (
            <span key={id} className="size-2.5 rounded-full border border-ink-4/60" />
          ),
        )}
      </span>

      <Elapsed startedAt={progress.startedAt} />
      <span />

      <div className="flex items-center justify-end gap-1">
        <span className="w-12 text-right text-[13px] font-semibold text-ink tabular-nums">{percent} %</span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-2.5 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-raised hover:text-ink"
        >
          Cancelar
        </button>
      </div>

      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Progreso de la separación">
        <span className="block h-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${progress.percent}%` }} />
      </span>
    </li>
  );
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="text-right font-mono text-xs text-ink-2 tabular-nums" title="Tiempo transcurrido">
      {formatTime(Math.max(0, (now - startedAt) / 1000))}
    </span>
  );
}
