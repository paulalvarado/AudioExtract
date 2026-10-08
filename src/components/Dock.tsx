import { useCallback, useMemo, useRef, type CSSProperties } from "react";
import { useAnimationFrame, useEngineState } from "../hooks/useEngine";
import type { PlayerState } from "../hooks/usePlayer";
import { useScrub } from "../hooks/useScrub";
import { useTempoEstimate } from "../hooks/useTempoEstimate";
import { faderToGain, gainToDb, type MultitrackEngine } from "../lib/audio-engine";
import { formatDb, formatTempo, formatTime } from "../lib/format";
import { ORIGINAL_TEMPO } from "../lib/pitch";
import type { TempoEstimate } from "../lib/tempo-estimate";
import { STEM_LABELS, type LibraryItem } from "../types";
import { CollapseIcon, ExpandIcon, ExportIcon, PauseIcon, PlayIcon, RefreshIcon, StopIcon, TempoIcon, ToneIcon, VolumeIcon } from "./icons";
import { stemStyle } from "./NewExtraction";
import { SemitoneControl } from "./SemitoneControl";
import { TempoControl } from "./TempoControl";
import { Fader } from "./TrackControls";
import { Waveform } from "./Waveform";

interface DockProps {
  player: PlayerState;
  item: LibraryItem | null;
  /** Biblioteca vacía: todavía no hay nada que escuchar. */
  libraryEmpty: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onExport: () => void;
  onRetry: () => void;
}

/** Transporte fijo abajo: lo que suena, siempre a mano, en la biblioteca y en el mezclador. */
export function Dock({ player, item, libraryEmpty, expanded, onToggleExpanded, onExport, onRetry }: DockProps) {
  if (player.status === "ready" && item) {
    return (
      <DockTransport
        engine={player.engine}
        item={item}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        onExport={onExport}
      />
    );
  }

  return (
    <footer className="flex h-12 shrink-0 items-center gap-3 border-t border-line bg-panel px-5 text-[13px]">
      {player.status === "empty" && (
        <p className="text-ink-3">
          {libraryEmpty
            ? "Cuando separes tu primera canción, podrás escucharla y mezclarla desde aquí."
            : "Elige una canción de la biblioteca para escucharla aquí."}
        </p>
      )}
      {player.status === "loading" && (
        <p className="flex items-center gap-2.5 text-ink-2">
          <span className="size-3.5 animate-spin rounded-full border-2 border-ink-4 border-t-accent" aria-hidden />
          Cargando las pistas de <span className="font-medium text-ink">{item?.title}</span>…
        </p>
      )}
      {player.status === "error" && (
        <>
          <p className="min-w-0 truncate text-danger" role="alert">
            No se pudo abrir «{item?.title}»: {player.message}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-ink-2 transition-colors hover:bg-raised hover:text-ink"
          >
            <RefreshIcon width={14} height={14} />
            Reintentar
          </button>
        </>
      )}
    </footer>
  );
}

interface DockTransportProps {
  engine: MultitrackEngine;
  item: LibraryItem;
  expanded: boolean;
  onToggleExpanded: () => void;
  onExport: () => void;
}

function DockTransport({ engine, item, expanded, onToggleExpanded, onExport }: DockTransportProps) {
  const { tracks, playing, duration, masterFader, masterSemitones, tempo, stretch } = useEngineState(engine);
  const estimate = useTempoEstimate(engine, item);
  const scrubRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const scrub = useScrub(engine);

  // La franja superior muestra la suma visual de las pistas que suenan.
  const peaks = useMemo(() => {
    const audible = tracks.filter((track) => track.audible);
    const length = tracks[0]?.peaks.length ?? 0;
    const combined = new Float32Array(length);
    for (const track of audible) {
      for (let i = 0; i < length; i++) if (track.peaks[i] > combined[i]) combined[i] = track.peaks[i];
    }
    return combined;
  }, [tracks]);

  // Lo que cambia a 60 fps se escribe directamente en el DOM, sin re-render.
  const frame = useCallback(() => {
    const fraction = scrub.current();
    scrubRef.current?.style.setProperty("--progress", fraction.toFixed(5));
    const time = formatTime(fraction * duration);
    if (timeRef.current && timeRef.current.textContent !== time) {
      timeRef.current.textContent = time;
      scrubRef.current?.setAttribute("aria-valuenow", String(Math.floor(fraction * duration)));
      scrubRef.current?.setAttribute("aria-valuetext", time);
    }
  }, [scrub, duration]);
  useAnimationFrame(frame);

  const masterDb = gainToDb(faderToGain(masterFader));

  return (
    <footer className="@container relative shrink-0 border-t border-line bg-panel">
      <div
        ref={scrubRef}
        className="relative h-7 cursor-pointer touch-none text-ink-4"
        style={{ "--progress": 0 } as CSSProperties}
        {...scrub.handlers}
        role="slider"
        tabIndex={0}
        aria-label="Posición de reproducción (flechas: ±5 s)"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            engine.seek(engine.position + (event.key === "ArrowLeft" ? -5 : 5));
          }
        }}
      >
        <Waveform peaks={peaks} className="absolute inset-x-0 top-1 h-5 w-full opacity-60" />
        <Waveform peaks={peaks} className="played absolute inset-x-0 top-1 h-5 w-full text-ink-2" />
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-accent"
          style={{ left: "calc(var(--progress) * 100%)" }}
        />
      </div>

      <div className="flex h-14 items-center gap-3 px-4">
        <button
          type="button"
          onClick={() => engine.toggle()}
          aria-label={playing ? "Pausa" : "Reproducir"}
          title={playing ? "Pausa (Espacio)" : "Reproducir (Espacio)"}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-surface transition-transform hover:scale-105 active:scale-95"
        >
          {playing ? <PauseIcon width={16} height={16} /> : <PlayIcon width={16} height={16} className="translate-x-px" />}
        </button>
        <button
          type="button"
          onClick={() => engine.stop()}
          aria-label="Detener"
          title="Detener y volver al principio (Inicio)"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-raised hover:text-ink"
        >
          <StopIcon width={13} height={13} />
        </button>

        <p className="shrink-0 font-mono text-[13px] tabular-nums">
          <span ref={timeRef} className="text-ink">
            0:00
          </span>
          <span className="text-ink-3"> / {formatTime(duration)}</span>
        </p>

        <button
          type="button"
          onClick={onToggleExpanded}
          className="ml-1 min-w-28 flex-1 truncate rounded-md px-1 text-left text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
          title={expanded ? "Volver a la biblioteca" : "Abrir el mezclador"}
        >
          {item.title}
        </button>

        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Silenciar instrumentos">
          {tracks.map((track) => (
            <button
              key={track.id}
              type="button"
              onClick={() => engine.toggleMute(track.id)}
              aria-pressed={track.muted}
              aria-label={`Silenciar ${STEM_LABELS[track.id]}`}
              title={`${STEM_LABELS[track.id]}: ${track.muted ? "silenciada. Clic para activarla" : "suena. Clic para silenciarla"}`}
              style={stemStyle(track.id)}
              className={`flex h-7 items-center gap-1.5 rounded-md border px-2 transition-colors ${
                track.muted ? "border-line/70 hover:bg-raised/60" : "border-line bg-raised/70 hover:bg-raised"
              }`}
            >
              <span
                className={`size-2.5 rounded-full border-2 border-(--stem) transition-colors ${
                  track.muted ? "opacity-55" : track.audible ? "bg-(--stem)" : "bg-(--stem)/40"
                }`}
                aria-hidden
              />
              <span className={`hidden text-xs @min-[1480px]:inline ${track.muted ? "text-ink-4 line-through" : "text-ink-2"}`}>
                {STEM_LABELS[track.id]}
              </span>
            </button>
          ))}
        </div>

        <span className="h-6 w-px shrink-0 bg-line" aria-hidden />

        {/* Cómo suena la canción entera: tono arriba y tempo abajo, en dos filas de 24 px. */}
        <div className="flex shrink-0 flex-col gap-0.5 text-ink-3" role="group" aria-label="Tono y tempo de toda la canción">
          <div className="flex items-center gap-1.5" title="Tono de toda la canción">
            <ToneIcon width={14} height={14} className="shrink-0" />
            <span className="hidden w-10 text-xs @min-[1100px]:inline">Tono</span>
            <SemitoneControl
              size="sm"
              value={masterSemitones}
              onChange={(value) => engine.setMasterSemitones(value)}
              label="toda la canción"
              valueWidth="min-w-[5.5ch]"
              disabled={stretch === "unavailable"}
              disabledReason="La transposición no está disponible en este equipo"
            />
          </div>
          <div className="flex items-center gap-1.5" title="Tempo de toda la canción">
            <TempoIcon width={14} height={14} className="shrink-0" />
            <span className="hidden w-10 text-xs @min-[1100px]:inline">Tempo</span>
            <TempoControl
              size="sm"
              value={tempo}
              onChange={(value) => engine.setTempo(value)}
              disabled={stretch === "unavailable"}
              disabledReason="El cambio de tempo no está disponible en este equipo"
            />
            {estimate && <BpmReading estimate={estimate} tempo={tempo} />}
          </div>
        </div>

        <div
          className="flex w-24 shrink-0 items-center gap-2 text-ink-3 @min-[1240px]:w-36"
          title="Volumen de escucha (no afecta a la exportación)"
        >
          <VolumeIcon width={16} height={16} className="shrink-0" />
          <Fader
            value={masterFader}
            onChange={(value) => engine.setMasterFader(value)}
            label="Volumen de escucha"
            valueText={`${formatDb(masterDb)} dB`}
            stem="var(--color-ink-2)"
          />
        </div>

        <button
          type="button"
          onClick={onExport}
          aria-label="Exportar"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-raised hover:text-ink"
          title="Exportar pistas o la mezcla"
        >
          <ExportIcon width={16} height={16} />
          <span className="hidden @min-[1160px]:inline">Exportar</span>
        </button>
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? "Volver a la biblioteca" : "Abrir el mezclador"}
          title={expanded ? "Volver a la biblioteca (M)" : "Abrir el mezclador (M)"}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-raised px-2.5 text-[13px] text-ink transition-colors hover:bg-line"
        >
          {expanded ? <CollapseIcon width={16} height={16} /> : <ExpandIcon width={16} height={16} />}
          <span className="hidden @min-[1100px]:inline">{expanded ? "Biblioteca" : "Mezclador"}</span>
        </button>
      </div>
    </footer>
  );
}

/** BPM que suenan: los estimados de la canción por el tempo elegido. */
function BpmReading({ estimate, tempo }: { estimate: TempoEstimate; tempo: number }) {
  const original = Math.round(estimate.bpm);
  const now = Math.round((estimate.bpm * tempo) / ORIGINAL_TEMPO);
  const hint =
    tempo === ORIGINAL_TEMPO
      ? `Tempo estimado de la canción: ${original} BPM`
      : `Al ${formatTempo(tempo)} suena a unos ${now} BPM (la canción va a unos ${original})`;
  return (
    <span
      className="hidden pl-1 whitespace-nowrap @min-[1000px]:inline"
      title={`${hint}. Estimado a partir de las pistas: puede ser el doble o la mitad del pulso que sientes.`}
    >
      <span className="font-mono text-[11px] text-ink-2 tabular-nums">{now}</span>
      <span className="ml-1 text-[11px] text-ink-3">BPM</span>
    </span>
  );
}
