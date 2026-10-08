import { useState, useSyncExternalStore } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { UNITY_FADER, type MultitrackEngine } from "../lib/audio-engine";
import {
  audibleStems,
  describeMix,
  effectiveSemitones,
  EXPORT_FORMATS,
  exportAudio,
  mixTempo,
  type ExportFormat,
  type ExportProgress,
  type ExportResult,
} from "../lib/export";
import { formatSemitones, formatTempo, formatTime } from "../lib/format";
import { ORIGINAL_TEMPO } from "../lib/pitch";
import { toAppError } from "../lib/tauri";
import { STEM_LABELS, type LibraryItem, type MixState, type StemId } from "../types";
import { AlertIcon, CheckIcon, FolderIcon } from "./icons";
import { stemStyle } from "./NewExtraction";
import { Sheet, SheetSection } from "./Sheet";

interface ExportPanelProps {
  item: LibraryItem;
  /** Motor cargado con esta extracción, si la hay: aporta la mezcla actual y los búferes ya decodificados. */
  engine: MultitrackEngine | null;
  format: ExportFormat;
  onFormat: (format: ExportFormat) => void;
  applyMix: boolean;
  onApplyMix: (apply: boolean) => void;
  onClose: () => void;
}

const DEFAULT_MIX: MixState = { version: 1, masterFader: UNITY_FADER, masterSemitones: 0, tempo: ORIGINAL_TEMPO, tracks: {} };
const noSubscription = () => () => {};

type RunState =
  | { phase: "idle" }
  | { phase: "running"; progress: ExportProgress }
  | { phase: "done"; result: ExportResult }
  | { phase: "error"; message: string };

export function ExportPanel({ item, engine, format, onFormat, applyMix, onApplyMix, onClose }: ExportPanelProps) {
  const [kind, setKind] = useState<"stems" | "mix">("stems");
  const [selected, setSelected] = useState<StemId[]>(item.stems);
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  // Se vuelve a pintar cuando cambia la mezcla con el panel abierto.
  useSyncExternalStore(engine?.subscribe ?? noSubscription, () => engine?.getSnapshot() ?? null);
  const available = item.stems.filter((id) => !item.missing.includes(id));
  const mix = engine?.mixState() ?? item.mix ?? DEFAULT_MIX;
  const extension = format === "mp3" ? "mp3" : "wav";
  const audible = audibleStems(available, mix);
  const tempo = mixTempo(mix);
  const tempoChanged = tempo !== ORIGINAL_TEMPO;
  const busy = run.phase === "running";
  const selectedFormat = EXPORT_FORMATS.find((option) => option.id === format) ?? EXPORT_FORMATS[0];
  const stemCount = available.filter((id) => selected.includes(id)).length;

  const toggle = (id: StemId) =>
    setSelected((current) => (current.includes(id) ? current.filter((s) => s !== id) : [...current, id]));

  const start = async () => {
    setRun({ phase: "running", progress: { label: "Eligiendo destino…", fraction: 0 } });
    try {
      const result = await exportAudio({
        item,
        target:
          kind === "mix"
            ? { kind: "mix" }
            : { kind: "stems", stems: available.filter((id) => selected.includes(id)), applyMix },
        format,
        // La mezcla se lee al pulsar, para exportar exactamente lo que suena ahora.
        mix: engine?.mixState() ?? item.mix ?? DEFAULT_MIX,
        buffers: engine?.buffers,
        onProgress: (progress) => setRun({ phase: "running", progress }),
      });
      setRun(result ? { phase: "done", result } : { phase: "idle" });
    } catch (raw) {
      setRun({ phase: "error", message: toAppError(raw).message });
    }
  };

  const disabled = busy || (kind === "stems" ? stemCount === 0 : audible.length === 0);

  return (
    <Sheet
      title="Exportar"
      subtitle={item.title}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-3">
          <RunStatus run={run} />
          <button
            type="button"
            onClick={() => void start()}
            disabled={disabled}
            className="h-9 rounded-lg bg-accent text-[13px] font-semibold text-surface transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-45"
          >
            {busy
              ? "Exportando…"
              : kind === "stems"
                ? `Exportar ${stemCount === 1 ? "1 pista" : `${stemCount} pistas`} · ${selectedFormat.label}`
                : `Guardar la mezcla · ${selectedFormat.label}`}
          </button>
        </div>
      }
    >
      <SheetSection title="Qué exportar">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1" role="radiogroup" aria-label="Qué exportar">
          {(
            [
              ["stems", "Pistas por separado"],
              ["mix", "Mezcla"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              disabled={busy}
              onClick={() => setKind(value)}
              className={`h-8 rounded-lg text-[13px] transition-colors ${
                kind === value ? "bg-raised font-medium text-ink" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </SheetSection>

      <SheetSection title="Formato">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface p-1" role="radiogroup" aria-label="Formato">
          {EXPORT_FORMATS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={format === option.id}
              disabled={busy}
              onClick={() => onFormat(option.id)}
              className={`h-8 rounded-lg text-[13px] transition-colors ${
                format === option.id ? "bg-raised font-medium text-ink" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-3">
          {selectedFormat.detail}
          {kind === "stems" && format === "wav16" && ". Las pistas sin cambios se copian idénticas a las de la biblioteca."}
        </p>
      </SheetSection>

      {kind === "stems" ? (
        <SheetSection title="Pistas">
          <div className="mb-2 flex gap-3 text-xs">
            <button type="button" disabled={busy} onClick={() => setSelected(available)} className="text-accent hover:underline">
              Todas
            </button>
            <button type="button" disabled={busy} onClick={() => setSelected([])} className="text-ink-3 hover:text-ink-2">
              Ninguna
            </button>
          </div>
          <ul className="flex flex-col gap-0.5">
            {item.stems.map((id) => {
              const missing = item.missing.includes(id);
              const semitones = applyMix ? effectiveSemitones(mix, id) : 0;
              return (
                <li key={id}>
                  <label
                    style={stemStyle(id)}
                    className={`flex h-9 items-center gap-3 rounded-lg px-2 transition-colors ${
                      missing ? "opacity-45" : "cursor-pointer hover:bg-raised/60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!missing && selected.includes(id)}
                      disabled={missing || busy}
                      onChange={() => toggle(id)}
                      className="size-4 accent-(--stem)"
                    />
                    <span className="size-2.5 rounded-full bg-(--stem)" aria-hidden />
                    <span className="flex-1 text-[13px] text-ink">{STEM_LABELS[id]}</span>
                    {missing && <span className="text-xs text-warning">no está en el disco</span>}
                    {semitones !== 0 && (
                      <span className="text-xs text-accent tabular-nums">tono {formatSemitones(semitones)}</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg bg-surface/60 p-3">
            <input
              type="checkbox"
              checked={applyMix}
              disabled={busy}
              onChange={(event) => onApplyMix(event.currentTarget.checked)}
              className="mt-0.5 size-4"
            />
            <span className="text-[13px] leading-snug text-ink">
              Aplicar el volumen, el tono y el tempo del mezclador
              <span className="mt-0.5 block text-xs text-ink-3">
                Cada pista sale con su volumen, sus semitonos (más los globales) y
                {tempoChanged ? ` al ${formatTempo(tempo)} de velocidad` : " el tempo global"}. Sin marcar, salen tal cual se
                separaron.
              </span>
            </span>
          </label>
        </SheetSection>
      ) : (
        <SheetSection title="Mezcla">
          <p className="text-[13px] leading-relaxed text-ink-2">
            Se exporta lo que suena ahora, con sus volúmenes, semitonos y tempo:
          </p>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
            {audible.length === 0 ? (
              <span className="text-[13px] text-warning">No suena ninguna pista: quita algún mute o solo.</span>
            ) : (
              audible.map((id) => (
                <span key={id} style={stemStyle(id)} className="flex items-center gap-1.5 text-[13px] text-ink">
                  <span className="size-2 rounded-full bg-(--stem)" aria-hidden />
                  {STEM_LABELS[id]}
                  {effectiveSemitones(mix, id) !== 0 && (
                    <span className="font-mono text-xs text-accent tabular-nums">{formatSemitones(effectiveSemitones(mix, id))}</span>
                  )}
                </span>
              ))
            )}
          </p>
          <p className="mt-3 truncate rounded-lg bg-surface/60 px-3 py-2 text-xs text-ink-2 select-text">
            {item.title} - {describeMix(available, mix)}.{extension}
          </p>
          {tempoChanged && item.durationSec > 0 && (
            <p className="mt-2 text-xs text-ink-2">
              Al <span className="font-mono text-accent tabular-nums">{formatTempo(tempo)}</span> dura{" "}
              <span className="tabular-nums">{formatTime((item.durationSec * ORIGINAL_TEMPO) / tempo)}</span> (la original,{" "}
              <span className="tabular-nums">{formatTime(item.durationSec)}</span>).
            </p>
          )}
          <p className="mt-2 text-xs text-ink-3">El volumen de escucha del dock no afecta a la exportación.</p>
        </SheetSection>
      )}

    </Sheet>
  );
}

function RunStatus({ run }: { run: RunState }) {
  if (run.phase === "running") {
    return (
      <div aria-live="polite">
        <p className="mb-1.5 truncate text-xs text-ink-2">{run.progress.label}</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={Math.round(run.progress.fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${run.progress.fraction * 100}%` }} />
        </div>
      </div>
    );
  }
  if (run.phase === "done") {
    const { result } = run;
    return (
      <div className="rounded-lg bg-surface/60 p-3 text-xs" role="status">
        <p className="flex items-center gap-1.5 font-medium text-ink">
          <CheckIcon width={14} height={14} className="text-accent" />
          {result.files.length === 1 ? "Exportado" : `${result.files.length} archivos exportados`}
        </p>
        <p className="mt-1 truncate text-ink-3 select-text" title={result.destination}>
          {result.destination}
        </p>
        {result.attenuationDb > 0.05 && (
          <p className="mt-1 text-warning">Se bajó {result.attenuationDb.toFixed(1).replace(".", ",")} dB para que no saturara.</p>
        )}
        <button
          type="button"
          onClick={() => void revealItemInDir(result.files[0])}
          className="mt-2 flex items-center gap-1.5 text-accent hover:underline"
        >
          <FolderIcon width={13} height={13} />
          Mostrar en la carpeta
        </button>
      </div>
    );
  }
  if (run.phase === "error") {
    return (
      <p role="alert" className="flex items-start gap-1.5 text-xs leading-snug text-danger select-text">
        <AlertIcon width={14} height={14} className="mt-px shrink-0" />
        {run.message}
      </p>
    );
  }
  return null;
}
