import type { CSSProperties, ReactNode, Ref } from "react";
import { faderToGain, gainToDb, UNITY_FADER, type TrackState } from "../lib/audio-engine";
import { formatDb } from "../lib/format";
import { STEM_LABELS } from "../types";
import { stemStyle } from "./NewExtraction";
import { SemitoneControl } from "./SemitoneControl";

interface TrackControlsProps {
  track: TrackState;
  pitchAvailable: boolean;
  meterRef: Ref<HTMLDivElement>;
  peakRef: Ref<HTMLDivElement>;
  onFader: (value: number) => void;
  onMute: () => void;
  onSolo: () => void;
  onSemitones: (value: number) => void;
  /** Acción propia de esta pista, entre el nombre y los semitonos (p. ej., el modo práctica del bajo). */
  action?: ReactNode;
}

export function TrackControls({
  track,
  pitchAvailable,
  meterRef,
  peakRef,
  onFader,
  onMute,
  onSolo,
  onSemitones,
  action,
}: TrackControlsProps) {
  const label = STEM_LABELS[track.id];
  const db = gainToDb(faderToGain(track.fader));

  return (
    <div
      style={stemStyle(track.id)}
      className={`flex h-full flex-col justify-center gap-1 px-4 py-1 transition-opacity duration-150 ${
        track.audible ? "" : "opacity-55"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="size-2.5 shrink-0 rounded-full bg-(--stem)" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{label}</span>
        {action}
        <SemitoneControl
          size="sm"
          value={track.semitones}
          onChange={onSemitones}
          label={label}
          disabled={!pitchAvailable}
          disabledReason="La transposición no está disponible en este equipo"
        />
        <ToggleButton active={track.muted} onClick={onMute} activeClass="bg-danger text-surface" title={`Silenciar ${label}`}>
          M
        </ToggleButton>
        <ToggleButton active={track.solo} onClick={onSolo} activeClass="bg-warning text-surface" title={`Solo ${label}`}>
          S
        </ToggleButton>
      </div>

      {/* Fila horizontal: el fader crece a lo ancho, nunca a lo alto, y su lectura queda a su lado. */}
      <div className="flex items-center gap-2.5">
        <Fader
          value={track.fader}
          onChange={onFader}
          label={`Volumen de ${label}`}
          valueText={`${formatDb(db)} dB`}
        >
          {/* Vúmetro pegado al fader: nivel, retención de pico y rojo si satura. */}
          <div className="absolute inset-x-0 -bottom-1 h-0.75 overflow-hidden rounded-full bg-surface" aria-hidden>
            <div
              ref={meterRef}
              className="h-full origin-left rounded-full bg-(--stem) data-[clip=true]:bg-danger"
              style={{ transform: "scaleX(0)" }}
            />
            <div ref={peakRef} className="absolute top-0 h-full w-0.5 bg-ink-2" style={{ left: "0%" }} />
          </div>
        </Fader>
        <span className="w-14 shrink-0 text-right font-mono text-[11px] text-ink-3 tabular-nums" aria-hidden>
          {formatDb(db)} dB
        </span>
      </div>
    </div>
  );
}

interface FaderProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  valueText: string;
  stem?: string;
  children?: ReactNode;
}

/** Fader con una marca en 0 dB (doble clic para volver a ella). */
export function Fader({ value, onChange, label, valueText, stem, children }: FaderProps) {
  return (
    <div className="relative flex h-3.5 min-w-0 flex-1 items-center">
      {/* El centro del pulgar (14 px) en 0 dB cae 3,5 px antes del 75 % del carril. */}
      <span
        className="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-ink-4"
        style={{ left: `calc(${UNITY_FADER * 100}% - 3.5px)` }}
        aria-hidden
      />
      <input
        type="range"
        className="fader relative"
        min={0}
        max={1}
        step={0.005}
        value={value}
        style={{ "--fill": `${value * 100}%`, ...(stem ? { "--stem": stem } : {}) } as CSSProperties}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        onDoubleClick={() => onChange(UNITY_FADER)}
        aria-label={label}
        aria-valuetext={valueText}
        title={`${valueText} · doble clic: 0 dB`}
      />
      {children}
    </div>
  );
}

interface ToggleButtonProps {
  active: boolean;
  activeClass: string;
  title: string;
  onClick: () => void;
  children: string;
}

function ToggleButton({ active, activeClass, title, onClick, children }: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={title}
      title={title}
      className={`size-6 shrink-0 rounded-md text-[11px] font-bold transition-colors duration-100 ${
        active ? activeClass : "bg-raised text-ink-3 hover:bg-line hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
