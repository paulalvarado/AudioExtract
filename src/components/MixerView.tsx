import { lazy, Suspense, useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useAnimationFrame, useEngineState } from "../hooks/useEngine";
import { useScrub } from "../hooks/useScrub";
import { useTempoEstimate } from "../hooks/useTempoEstimate";
import { gainToDb, type MultitrackEngine, type TrackState } from "../lib/audio-engine";
import { deviceLabel, formatDuration, formatFullDate, formatSemitones, formatTempo } from "../lib/format";
import { ORIGINAL_TEMPO } from "../lib/pitch";
import { isPracticeStem, type LibraryItem, type PracticeStem, type StemId } from "../types";
import { BackIcon, FolderIcon, ResetIcon } from "./icons";
import { stemStyle } from "./NewExtraction";
import { TrackControls } from "./TrackControls";
import { Waveform } from "./Waveform";

// Cada modo práctica (transcripción, mapeo de notas y dibujo en canvas) va en su propio
// fragmento: solo se descarga al abrirlo, o al acercar el puntero a su botón.
const PRACTICE_LOADERS = {
  bass: () => import("./practice/BassPractice"),
  piano: () => import("./practice/PianoPractice"),
} satisfies Record<PracticeStem, () => Promise<unknown>>;
const PRACTICE_VIEWS = {
  bass: lazy(PRACTICE_LOADERS.bass),
  piano: lazy(PRACTICE_LOADERS.piano),
};
const PRACTICE_HINTS: Record<PracticeStem, string> = {
  bass: "Modo práctica: mástil y tablatura del bajo, sincronizados con la canción",
  piano: "Modo práctica: las notas del piano caen sobre un teclado, sincronizadas con la canción",
};

interface MixerViewProps {
  engine: MultitrackEngine;
  item: LibraryItem;
  onBack: () => void;
  onReveal: () => void;
}

const METER_FLOOR_DB = -60;
const METER_FALLOFF = 0.93;
const PEAK_HOLD_MS = 900;
const MODEL_NAMES: Record<string, string> = {
  htdemucs: "Demucs v4",
  htdemucs_6s: "Demucs v4 (6 pistas)",
  htdemucs_ft: "Demucs v4 afinado",
  bs_roformer_sw: "BS-RoFormer SW",
  uvr_wind: "UVR Wind",
};

export function MixerView({ engine, item, onBack, onReveal }: MixerViewProps) {
  const { tracks, duration, masterSemitones, tempo, stretch } = useEngineState(engine);
  const estimate = useTempoEstimate(engine, item);
  const lanesRef = useRef<HTMLDivElement>(null);
  const meterRefs = useRef<Partial<Record<StemId, HTMLDivElement | null>>>({});
  const peakRefs = useRef<Partial<Record<StemId, HTMLDivElement | null>>>({});
  const meterLevels = useRef<Partial<Record<StemId, number>>>({});
  const peakHold = useRef<Partial<Record<StemId, { level: number; at: number }>>>({});
  const scrub = useScrub(engine);
  // Extracción y pista en modo práctica (si al cambiar de canción no es esta, el modo se cierra).
  const [practiceFor, setPracticeFor] = useState<{ itemId: string; stem: PracticeStem } | null>(null);
  const practiceTrack =
    practiceFor?.itemId === item.id ? tracks.find((track) => track.id === practiceFor.stem) : undefined;
  const practice = practiceTrack?.id ?? null;

  // Cabezal y vúmetros a 60 fps, directamente en el DOM.
  const frame = useCallback(() => {
    lanesRef.current?.style.setProperty("--progress", scrub.current().toFixed(5));
    const now = performance.now();
    for (const { id } of engine.getSnapshot().tracks) {
      // En el modo práctica su lienzo ocupa la pantalla: solo se mide el vúmetro de esa pista.
      if (practice && id !== practice) continue;
      const meter = meterRefs.current[id];
      if (!meter) continue;
      const peak = engine.level(id);
      const db = gainToDb(peak);
      const target = Number.isFinite(db) ? Math.min(Math.max((db - METER_FLOOR_DB) / -METER_FLOOR_DB, 0), 1) : 0;
      const shown = Math.max(target, (meterLevels.current[id] ?? 0) * METER_FALLOFF);
      meterLevels.current[id] = shown;
      meter.style.transform = `scaleX(${shown.toFixed(3)})`;
      meter.dataset.clip = String(peak >= 1);

      // Retención de pico: se queda arriba un momento y luego baja despacio.
      const hold = peakHold.current[id];
      const level =
        !hold || shown >= hold.level ? shown : now - hold.at < PEAK_HOLD_MS ? hold.level : Math.max(shown, hold.level - 0.006);
      if (!hold || level !== hold.level) peakHold.current[id] = { level, at: !hold || shown >= hold.level ? now : hold.at };
      const tick = peakRefs.current[id];
      if (tick) tick.style.left = `calc(${(level * 100).toFixed(2)}% - 1px)`;
    }
  }, [engine, scrub, practice]);
  useAnimationFrame(frame);

  const models = item.models.map((model) => MODEL_NAMES[model] ?? model).join(" + ");
  const shifted = tracks.some((track) => track.semitones !== 0) || masterSemitones !== 0 || tempo !== ORIGINAL_TEMPO;
  const changed = shifted || tracks.some((track) => track.muted || track.solo || Math.abs(track.fader - 0.75) > 0.001);

  const controlsFor = (track: TrackState, action?: ReactNode) => (
    <TrackControls
      track={track}
      pitchAvailable={stretch === "ready"}
      meterRef={(element) => {
        meterRefs.current[track.id] = element;
      }}
      peakRef={(element) => {
        peakRefs.current[track.id] = element;
      }}
      onFader={(value) => engine.setFader(track.id, value)}
      onMute={() => engine.toggleMute(track.id)}
      onSolo={() => engine.toggleSolo(track.id)}
      onSemitones={(value) => engine.setSemitones(track.id, value)}
      action={action}
    />
  );

  const practiceButton = (stem: PracticeStem) => (
    <button
      type="button"
      onClick={() => setPracticeFor({ itemId: item.id, stem })}
      onPointerEnter={() => void PRACTICE_LOADERS[stem]()}
      onFocus={() => void PRACTICE_LOADERS[stem]()}
      title={PRACTICE_HINTS[stem]}
      className="h-6 shrink-0 rounded-md bg-raised px-2 text-[11px] font-semibold text-ink-2 transition-colors duration-100 hover:bg-line hover:text-ink"
    >
      Practicar
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pt-3 pb-4">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg pr-2.5 pl-1.5 text-[13px] text-ink-3 transition-colors hover:bg-raised hover:text-ink"
        >
          <BackIcon width={16} height={16} />
          Biblioteca
        </button>
        <div className="min-w-0 flex-1 border-l border-line pl-3">
          <h1 className="truncate text-lg font-semibold tracking-tight text-ink" title={item.title}>
            {item.title}
          </h1>
          <p className="truncate text-xs text-ink-3" title={formatFullDate(item.createdAt)}>
            {tracks.length} pistas · {models} · {deviceLabel(item.device)}
            {item.elapsedMs > 0 && ` · separada en ${formatDuration(item.elapsedMs)}`}
            {estimate && (
              <span title="Tempo estimado a partir de las pistas: puede ser el doble o la mitad del pulso que sientes">
                {" "}
                · {Math.round(estimate.bpm)} BPM
              </span>
            )}
            {masterSemitones !== 0 && (
              <span className="text-accent"> · tono global {formatSemitones(masterSemitones)}</span>
            )}
            {tempo !== ORIGINAL_TEMPO && <span className="text-accent"> · tempo {formatTempo(tempo)}</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => engine.resetMix()}
          disabled={!changed}
          title="Volúmenes a 0 dB, sin mute ni solo, y tono y tempo originales"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:text-ink-4"
        >
          <ResetIcon width={15} height={15} />
          Restablecer
        </button>
        <button
          type="button"
          onClick={onReveal}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-raised hover:text-ink"
        >
          <FolderIcon width={15} height={15} />
          Mostrar archivos
        </button>
      </header>

      {practiceTrack && isPracticeStem(practiceTrack.id) ? (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
          <Suspense
            fallback={
              <p className="reveal-late flex flex-1 items-center justify-center gap-2.5 text-[13px] text-ink-2">
                <span className="size-3.5 animate-spin rounded-full border-2 border-ink-4 border-t-accent" aria-hidden />
                Abriendo el modo práctica…
              </p>
            }
          >
            <PracticeMode
              key={practiceTrack.id}
              stem={practiceTrack.id}
              engine={engine}
              item={item}
              controls={controlsFor(practiceTrack)}
              onClose={() => setPracticeFor(null)}
            />
          </Suspense>
        </section>
      ) : (
      /* Un solo contenedor con desplazamiento: controles y ondas se mueven juntos y siempre alineados. */
      <section className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-line bg-panel">
        <div className="grid min-h-full grid-cols-[312px_1fr]">
          <div className="flex flex-col divide-y divide-line border-r border-line">
            {tracks.map((track) => (
              <div key={track.id} className="min-h-[52px] flex-1">
                {controlsFor(track, isPracticeStem(track.id) ? practiceButton(track.id) : undefined)}
              </div>
            ))}
          </div>

          <div
            ref={lanesRef}
            className="relative flex cursor-pointer touch-none flex-col divide-y divide-line"
            style={{ "--progress": 0 } as CSSProperties}
            {...scrub.handlers}
            role="slider"
            tabIndex={-1}
            aria-label="Posición de reproducción"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
          >
            {tracks.map((track) => {
              const effective = Math.min(Math.max(track.semitones + masterSemitones, -24), 24);
              return (
                <div
                  key={track.id}
                  style={stemStyle(track.id)}
                  className={`relative min-h-[52px] flex-1 text-(--stem) transition-opacity duration-150 ${
                    track.audible ? "" : "opacity-30 grayscale"
                  }`}
                >
                  <Waveform peaks={track.peaks} className="absolute inset-0 size-full opacity-35" />
                  <Waveform peaks={track.peaks} className="played absolute inset-0 size-full" />
                  {effective !== 0 && (
                    <span
                      className="pointer-events-none absolute top-2 right-2 rounded-md bg-surface/85 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent tabular-nums"
                      title="Semitonos que suenan en esta pista (propios + globales)"
                    >
                      {formatSemitones(effective)}
                    </span>
                  )}
                </div>
              );
            })}
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-ink shadow-[0_0_0_1px_rgb(0_0_0/0.35)]"
              style={{ left: "calc(var(--progress) * 100%)" }}
            />
          </div>
        </div>
      </section>
      )}
    </div>
  );
}

interface PracticeModeProps {
  stem: PracticeStem;
  engine: MultitrackEngine;
  item: LibraryItem;
  controls: ReactNode;
  onClose: () => void;
}

/** El modo práctica de una pista, cargado aparte. */
function PracticeMode({ stem, ...props }: PracticeModeProps) {
  const View = PRACTICE_VIEWS[stem];
  return <View {...props} />;
}
