import type { CSSProperties, ReactNode } from "react";
import { availableQualities, supportsInstrument } from "../hooks/useEngineStatus";
import type { DropHover } from "../hooks/useFileDrop";
import { isGpu } from "../lib/format";
import { AUDIO_FORMATS_LABEL } from "../lib/tauri";
import {
  OPTIONAL_STEMS,
  STEM_HINTS,
  STEM_LABELS,
  type EngineStatus,
  type OptionalStem,
  type Quality,
  type StemId,
} from "../types";
import { AlertIcon, CloseIcon, RefreshIcon, UploadIcon } from "./icons";

interface NewExtractionProps {
  engine: EngineStatus | null;
  checkingEngine: boolean;
  onRecheck: () => void;
  /** Instalación del motor integrado (`EngineSetup`): va en lugar de las opciones mientras haga falta. */
  setup: ReactNode | null;
  instruments: OptionalStem[];
  onInstruments: (instruments: OptionalStem[]) => void;
  quality: Quality;
  onQuality: (quality: Quality) => void;
  hover: DropHover;
  busy: boolean;
  onBrowse: () => void;
  /** Sin `onClose` el panel no se puede cerrar (biblioteca vacía). */
  onClose?: () => void;
}

const BASE: StemId[] = ["vocals", "drums", "bass", "other"];

const QUALITY_INFO: Record<Quality, { label: string; model: string }> = {
  best: { label: "Máxima", model: "BS-RoFormer" },
  fast: { label: "Rápida", model: "Demucs v4" },
};

export function stemStyle(id: StemId): CSSProperties {
  return { "--stem": `var(--color-stem-${id})` } as CSSProperties;
}

/**
 * Tiempo aproximado por minuto de canción, medido en una RTX 3060 y en 12 hilos
 * de CPU (ver docs/MODELOS.md). Solo orienta: depende mucho del equipo.
 */
function estimate(quality: Quality, gpu: boolean, wind: boolean): string {
  const perMinute = (gpu ? { fast: 6, best: 35 } : { fast: 20, best: 180 })[quality] + (wind ? (gpu ? 8 : 35) : 0);
  return perMinute < 60 ? `≈${perMinute} s por minuto de canción` : `≈${Math.round(perMinute / 60)} min por minuto de canción`;
}

export function NewExtraction({
  engine,
  checkingEngine,
  onRecheck,
  setup,
  instruments,
  onInstruments,
  quality,
  onQuality,
  hover,
  busy,
  onBrowse,
  onClose,
}: NewExtractionProps) {
  const ready = engine?.ready === true;
  const gpu = isGpu(engine?.device ?? null);
  const qualities = availableQualities(engine);
  const selected = instruments.filter((stem) => supportsInstrument(engine, quality, stem));

  const toggle = (stem: OptionalStem) => {
    onInstruments(instruments.includes(stem) ? instruments.filter((s) => s !== stem) : [...instruments, stem]);
  };

  const dropTone =
    hover === "valid"
      ? "border-accent bg-accent/8"
      : hover === "invalid"
        ? "border-danger/70 bg-danger/5"
        : "border-line hover:border-ink-4 hover:bg-raised/40";

  return (
    <section
      aria-label="Nueva extracción"
      className="relative grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-5 rounded-2xl border border-line bg-panel p-5"
    >
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar nueva extracción"
          className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-raised hover:text-ink"
        >
          <CloseIcon width={15} height={15} />
        </button>
      )}

      <button
        type="button"
        onClick={onBrowse}
        disabled={busy || !ready}
        className={`group flex min-h-44 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 ${dropTone}`}
      >
        <span
          className={`flex size-12 items-center justify-center rounded-xl bg-raised transition-transform duration-200 ${
            hover === "valid" ? "scale-110 text-accent" : "text-ink-2 group-hover:-translate-y-0.5"
          }`}
        >
          <UploadIcon width={22} height={22} />
        </span>
        <span className="flex flex-col gap-1.5">
          <span className="text-base font-semibold tracking-tight text-ink">
            {setup
              ? "Primero, el motor de separación"
              : !ready
              ? "El motor no está listo"
              : busy
                ? "Hay una separación en marcha"
                : hover === "invalid"
                ? "Ese archivo no es de audio compatible"
                : hover === "valid"
                  ? "Suelta para separar"
                  : "Suelta una canción aquí"}
          </span>
          <span className="text-[13px] text-ink-3">
            {setup ? (
              "Se instala una vez, aquí al lado. Después podrás soltar canciones."
            ) : !ready ? (
              checkingEngine ? "Comprobando el motor…" : "Soluciónalo aquí al lado y podrás separar canciones."
            ) : busy ? (
              "Podrás separar otra cuando termine."
            ) : (
              <>
                o <span className="text-accent underline-offset-4 group-hover:underline">elige un archivo</span> ·{" "}
                {AUDIO_FORMATS_LABEL}
              </>
            )}
          </span>
        </span>
      </button>

      {setup ? (
        <div className="flex min-w-0 flex-col justify-center pr-6">{setup}</div>
      ) : engine && !engine.ready ? (
        <EngineProblem engine={engine} checking={checkingEngine} onRecheck={onRecheck} />
      ) : (
        <div className={`flex min-w-0 flex-col gap-5 pr-6 ${ready ? "" : "opacity-60"}`}>
          <fieldset className="min-w-0">
            <legend className="mb-2 text-[13px] font-semibold text-ink">Instrumentos</legend>
            <p className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
              Siempre:
              {BASE.map((id) => (
                <span key={id} style={stemStyle(id)} className="flex items-center gap-1.5 text-ink-2">
                  <span className="size-2 rounded-full bg-(--stem)" aria-hidden />
                  {STEM_LABELS[id]}
                </span>
              ))}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {OPTIONAL_STEMS.map((stem) => {
                const supported = supportsInstrument(engine, quality, stem);
                const on = supported && instruments.includes(stem);
                return (
                  <button
                    key={stem}
                    type="button"
                    aria-pressed={on}
                    disabled={!supported}
                    onClick={() => toggle(stem)}
                    title={supported ? STEM_HINTS[stem] : "El motor instalado no separa este instrumento"}
                    style={stemStyle(stem)}
                    className={`flex min-w-0 flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                      on ? "border-(--stem)/60 bg-(--stem)/10" : "border-line hover:border-ink-4 hover:bg-raised/50"
                    }`}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span
                        className={`size-2.5 shrink-0 rounded-full border-2 border-(--stem) ${on ? "bg-(--stem)" : ""}`}
                        aria-hidden
                      />
                      <span className="truncate text-[13px] font-medium text-ink">{STEM_LABELS[stem]}</span>
                    </span>
                    <span className="line-clamp-2 text-[11px] leading-snug text-ink-3">{STEM_HINTS[stem]}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-ink-3">Lo que no elijas se queda en «Otros».</p>
          </fieldset>

          <fieldset className="min-w-0">
            <legend className="mb-2 text-[13px] font-semibold text-ink">Calidad</legend>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Calidad de la separación">
              {(["best", "fast"] as const).map((option) => {
                const available = qualities.includes(option);
                const on = option === quality;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={!available}
                    onClick={() => onQuality(option)}
                    title={available ? undefined : "El motor instalado no incluye este modelo"}
                    className={`flex min-w-0 flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                      on ? "border-accent/70 bg-accent/10" : "border-line hover:border-ink-4 hover:bg-raised/50"
                    }`}
                  >
                    <span className="text-[13px] font-medium text-ink">
                      {QUALITY_INFO[option].label}
                      <span className="ml-1.5 font-normal text-ink-3">· {QUALITY_INFO[option].model}</span>
                    </span>
                    <span className="text-[11px] text-ink-3">{estimate(option, gpu, selected.includes("wind"))}</span>
                  </button>
                );
              })}
            </div>
            {ready && !gpu && quality === "best" && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-warning">
                <AlertIcon width={13} height={13} className="mt-px shrink-0" />
                Sin GPU, la calidad máxima tarda varios minutos por canción. La rápida es una buena alternativa.
              </p>
            )}
            {engine?.protocol === 1 && (
              <p className="mt-2 text-[11px] leading-snug text-ink-3">
                Tu motor es de una versión anterior: solo separa voces, batería, bajo y otros.
              </p>
            )}
          </fieldset>
        </div>
      )}
    </section>
  );
}

function EngineProblem({ engine, checking, onRecheck }: { engine: EngineStatus; checking: boolean; onRecheck: () => void }) {
  return (
    <div role="alert" className="flex min-w-0 flex-col justify-center gap-3 pr-6">
      <p className="flex items-center gap-2 text-sm font-semibold text-danger">
        <AlertIcon width={16} height={16} />
        El motor de separación no está listo
      </p>
      <p className="text-[13px] leading-relaxed text-ink-2 select-text">{engine.problem}</p>
      <button
        type="button"
        onClick={onRecheck}
        disabled={checking}
        className="flex w-fit items-center gap-2 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-line disabled:opacity-60"
      >
        <RefreshIcon width={14} height={14} className={checking ? "animate-spin" : ""} />
        {checking ? "Comprobando…" : "Comprobar de nuevo"}
      </button>
    </div>
  );
}
