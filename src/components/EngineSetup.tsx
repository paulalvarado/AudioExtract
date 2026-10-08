import { setupVariant, type SetupState } from "../hooks/useEngineSetup";
import { formatBytes } from "../lib/format";
import { SETUP_STEPS, type EngineVariant, type SetupPlan, type SetupStep } from "../types";
import { AlertIcon, CheckIcon, RefreshIcon } from "./icons";

interface EngineSetupProps {
  plan: SetupPlan | null;
  planError: string | null;
  state: SetupState;
  onStart: (variant: EngineVariant) => void;
  onCancel: () => void;
}

const STEP_LABELS: Record<SetupStep, string> = {
  python: "Python 3.12",
  packages: "PyTorch y librerías de audio",
  ffmpeg: "ffmpeg",
  models: "Modelos de separación",
  check: "Comprobación",
};

const VARIANT_LABELS: Record<EngineVariant, string> = {
  "windows-cuda": "GPU · CUDA 12.8",
  "windows-cuda-legacy": "GPU · CUDA 12.6",
  "windows-cpu": "Procesador",
  "macos-arm64": "GPU · Metal",
};

/**
 * El motor integrado sin instalar (o poniéndose al día): qué equipo se detectó, qué se va a
 * instalar y cuánto ocupa, y el avance paso a paso. Va donde iría el aviso de motor no
 * disponible en «Nueva extracción» y en Ajustes.
 */
export function EngineSetup({ plan, planError, state, onStart, onCancel }: EngineSetupProps) {
  if (state.phase === "running") return <SetupProgress state={state} onCancel={onCancel} />;

  if (!plan) {
    return planError ? (
      <p role="alert" className="text-[13px] leading-relaxed text-danger select-text">
        {planError}
      </p>
    ) : (
      <p className="flex items-center gap-2.5 text-[13px] text-ink-2">
        <Spinner />
        Comprobando tu equipo…
      </p>
    );
  }

  const variant = setupVariant(plan);
  if (!variant) {
    return (
      <div role="alert" className="flex flex-col gap-2">
        <Title>Este sistema no admite el motor integrado</Title>
        <p className="text-[13px] leading-relaxed text-ink-2 select-text">{plan.reason}</p>
      </div>
    );
  }

  const gpu = plan.hardware.gpus[0] ?? null;
  const lacksSpace = plan.freeBytes !== null && plan.freeBytes < plan.requiredBytes;
  const failed = state.phase === "error" ? state : null;

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <Title>{failed?.cancelled ? "Instalación detenida" : "Instala el motor de separación"}</Title>
        <p className="text-[13px] leading-relaxed text-ink-2">
          {failed?.cancelled
            ? "Lo que ya se descargó se aprovecha al continuar."
            : "Se descarga una vez y después separa sin conexión: el audio no sale de tu equipo."}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg bg-surface/60 px-3 py-2.5 text-xs">
        <dt className="text-ink-3">GPU</dt>
        <dd className="truncate text-ink" title={gpu?.name}>
          {gpu ? (
            <>
              {gpu.name}
              {gpu.memoryBytes !== null && <span className="text-ink-3 tabular-nums"> · {formatBytes(gpu.memoryBytes)}</span>}
            </>
          ) : plan.hardware.os === "macos" ? (
            "Apple Silicon"
          ) : (
            <span className="text-ink-2">Ninguna NVIDIA</span>
          )}
        </dd>
        <dt className="text-ink-3">Equipo</dt>
        <dd className="text-ink tabular-nums">
          {plan.hardware.memoryBytes !== null && `${formatBytes(plan.hardware.memoryBytes)} de memoria · `}
          {plan.hardware.cpuThreads} hilos
        </dd>
        <dt className="text-ink-3">Separará con</dt>
        <dd className="flex items-center gap-1.5 text-ink">
          <span className={`size-1.5 shrink-0 rounded-full ${plan.accelerator === "cpu" ? "bg-warning" : "bg-accent"}`} aria-hidden />
          {VARIANT_LABELS[variant]}
        </dd>
        <dt className="text-ink-3">Descarga</dt>
        <dd className="text-ink tabular-nums">
          {plan.downloadBytes > 0 ? `≈${formatBytes(plan.downloadBytes)}` : "lo que falte"}
          <span className="text-ink-3"> · ocupará ≈{formatBytes(plan.installedBytes)}</span>
        </dd>
      </dl>

      {(plan.accelerator === "cpu" || plan.notes.length > 0) && (
        <ul className="flex flex-col gap-1.5 text-xs leading-snug text-warning">
          {[...(plan.accelerator === "cpu" ? [plan.reason] : []), ...plan.notes].map((note) => (
            <li key={note} className="flex items-start gap-1.5">
              <AlertIcon width={13} height={13} className="mt-px shrink-0" />
              {note}
            </li>
          ))}
        </ul>
      )}

      {failed && !failed.cancelled && (
        <div role="alert" className="flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-danger">
            <AlertIcon width={14} height={14} />
            No se pudo instalar el motor
          </p>
          <p className="max-h-28 overflow-y-auto rounded-lg border border-danger/30 bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-2 select-text">
            {failed.message}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={() => onStart(variant)}
          disabled={lacksSpace}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-surface transition-[filter] hover:brightness-110 active:brightness-95 disabled:pointer-events-none disabled:opacity-50"
        >
          {failed && <RefreshIcon width={14} height={14} />}
          {failed?.cancelled ? "Continuar" : failed ? "Reintentar" : "Instalar el motor"}
        </button>
        {plan.freeBytes !== null && (
          <span className={`text-xs tabular-nums ${lacksSpace ? "text-danger" : "text-ink-3"}`}>
            {lacksSpace
              ? `Hacen falta ${formatBytes(plan.requiredBytes)} libres y hay ${formatBytes(plan.freeBytes)}`
              : `${formatBytes(plan.freeBytes)} libres en el disco`}
          </span>
        )}
      </div>
    </div>
  );
}

function SetupProgress({ state, onCancel }: { state: Extract<SetupState, { phase: "running" }>; onCancel: () => void }) {
  const current = SETUP_STEPS.indexOf(state.step);
  const percent = Math.round(state.percent);

  return (
    <div className="flex min-w-0 flex-col gap-3.5" aria-busy>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <Title>{state.update ? "Poniendo al día el motor" : "Instalando el motor"}</Title>
          <span className="text-[13px] text-ink-2 tabular-nums">{percent} %</span>
        </div>
        <div
          role="progressbar"
          aria-label={state.update ? "Puesta al día del motor" : "Instalación del motor"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1 overflow-hidden rounded-full bg-raised"
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${state.percent}%` }} />
        </div>
      </div>

      <ol className="flex flex-col">
        {SETUP_STEPS.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={step} className="flex h-7 items-center gap-2.5 text-[13px]" aria-current={active ? "step" : undefined}>
              {done ? (
                <CheckIcon width={14} height={14} className="shrink-0 text-accent" aria-hidden />
              ) : active ? (
                <Spinner />
              ) : (
                <span className="size-3.5 shrink-0 rounded-full border-2 border-line" aria-hidden />
              )}
              <span className={done ? "text-ink-2" : active ? "text-ink" : "text-ink-3"}>{STEP_LABELS[step]}</span>
              {active && state.bytes !== null && state.total !== null && (
                <span className="ml-auto font-mono text-[11px] text-ink-3 tabular-nums">
                  {formatBytes(Math.min(state.bytes, state.total))} / {formatBytes(state.total)}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={state.cancelling}
          className="flex h-8 items-center rounded-lg px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:opacity-55"
        >
          {state.cancelling ? "Deteniendo…" : "Detener"}
        </button>
        <span className="text-xs text-ink-3">Puedes seguir escuchando tu biblioteca mientras tanto.</span>
      </div>
    </div>
  );
}

function Title({ children }: { children: string }) {
  return <p className="text-sm font-semibold text-ink">{children}</p>;
}

function Spinner() {
  return <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-ink-4 border-t-accent" aria-hidden />;
}
