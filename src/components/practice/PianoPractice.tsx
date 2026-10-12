import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useEngineState } from "../../hooks/useEngine";
import type { MultitrackEngine } from "../../lib/audio-engine";
import { midiToName } from "../../lib/bass-tab";
import { formatSemitones } from "../../lib/format";
import { buildPianoRoll, type PianoRoll } from "../../lib/piano-roll";
import { MAX_SEMITONES } from "../../lib/pitch";
import type { LibraryItem } from "../../types";
import { PianoRenderer, type HandFilter } from "./piano-renderer";
import { PracticeCanvas } from "./PracticeCanvas";
import { PracticeShell, soundingSemitones, useStemNotes } from "./PracticeShell";

interface PianoPracticeProps {
  engine: MultitrackEngine;
  item: LibraryItem;
  /** Controles de la pista de piano (fader con vúmetro, semitonos, M/S) del mezclador. */
  controls: ReactNode;
  onClose: () => void;
}

const HAND_OPTIONS: { value: HandFilter; label: string; short: string; hint: string }[] = [
  { value: "both", label: "Ambas", short: "Ambas", hint: "Las dos manos" },
  {
    value: "left",
    label: "Izquierda",
    short: "Izq.",
    hint: "Solo la mano izquierda: la derecha se ve en gris y no ilumina teclas",
  },
  {
    value: "right",
    label: "Derecha",
    short: "Der.",
    hint: "Solo la mano derecha: la izquierda se ve en gris y no ilumina teclas",
  },
];

/**
 * Modo práctica de piano: las notas caen hacia un teclado y su tecla se ilumina al
 * sonar, sincronizadas con la canción. Se carga aparte (React.lazy) para no pesar en
 * el resto de la app.
 */
export default function PianoPractice({ engine, item, controls, onClose }: PianoPracticeProps) {
  const { tracks, masterSemitones } = useEngineState(engine);
  const semitones = soundingSemitones(
    tracks.find((track) => track.id === "piano")?.semitones,
    masterSemitones,
    MAX_SEMITONES * 2,
  );
  const { state, retry } = useStemNotes(item, "piano");
  const [hands, setHands] = useState<HandFilter>("both");
  const roll = useMemo(() => (state.status === "ready" ? buildPianoRoll(state.notes, semitones) : null), [state, semitones]);
  const create = useCallback((canvas: HTMLCanvasElement) => new PianoRenderer(canvas, roll!, hands), [roll, hands]);

  return (
    <PracticeShell
      stem="piano"
      state={state}
      onRetry={retry}
      controls={controls}
      summary={<Summary roll={roll} semitones={semitones} />}
      options={
        roll &&
        roll.notes.length > 0 && (
          <div className="flex gap-1 rounded-xl bg-surface p-1" role="radiogroup" aria-label="Manos que se practican">
            {HAND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={hands === option.value}
                aria-label={`Mano: ${option.label.toLowerCase()}`}
                onClick={() => setHands(option.value)}
                title={option.hint}
                className={`h-8 rounded-lg px-2.5 text-[13px] transition-colors ${
                  hands === option.value ? "bg-raised font-medium text-ink" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {/* En ventanas estrechas, abreviado: el resumen necesita el sitio. */}
                <span className="@max-[1000px]:hidden">{option.label}</span>
                <span className="hidden @max-[1000px]:inline">{option.short}</span>
              </button>
            ))}
          </div>
        )
      }
      empty={roll !== null && roll.notes.length === 0}
      onClose={onClose}
    >
      {roll && <PracticeCanvas engine={engine} create={create} label={describe(roll, hands)} />}
    </PracticeShell>
  );
}

function Summary({ roll, semitones }: { roll: PianoRoll | null; semitones: number }) {
  if (!roll) {
    return (
      <div className="min-w-0 px-4">
        <p className="text-[13px] font-medium text-ink">Modo práctica</p>
        <p className="truncate text-xs text-ink-3">Notas del piano sobre un teclado, sincronizadas con la canción</p>
      </div>
    );
  }
  return (
    <div className="min-w-0 px-4">
      <p
        className="flex items-baseline gap-2 truncate text-[13px] font-medium text-ink"
        title="De la nota más grave a la más aguda que se tocan."
      >
        Piano
        {roll.notes.length > 0 && (
          <span className="font-mono text-[11px] font-normal tracking-wide text-ink-3">
            {midiToName(roll.lowest)}–{midiToName(roll.highest)}
          </span>
        )}
      </p>
      <p className="truncate text-xs text-ink-3">
        <span className="tabular-nums">{roll.notes.length}</span> notas ·{" "}
        <span title="Transcritas en tu equipo por un modelo: puede saltarse notas en acordes muy densos o con el pedal, o añadir alguna que se cuela de otras pistas.">
          transcripción automática
        </span>{" "}
        ·{" "}
        <span title="La mano de cada nota se estima por su altura y por lo que suena a la vez. Barra llena: derecha; hueca: izquierda.">
          manos estimadas
        </span>
        {semitones !== 0 && <span className="text-accent"> · transpuesto {formatSemitones(semitones)}</span>}
        {roll.shifted > 0 && (
          <span title="No caben en el teclado con esta transposición: se muestran una octava más arriba o más abajo.">
            {` · ${roll.shifted} ${roll.shifted === 1 ? "nota cambiada" : "notas cambiadas"} de octava`}
          </span>
        )}
      </p>
    </div>
  );
}

function describe(roll: PianoRoll, hands: HandFilter): string {
  const range = `de ${midiToName(roll.low)} a ${midiToName(roll.high)}`;
  const which = hands === "both" ? "" : ` Solo se iluminan las notas de la mano ${hands === "left" ? "izquierda" : "derecha"}.`;
  return `Teclado de piano ${range} con las notas que caen hacia él y se iluminan al sonar.${which} Haz clic en las notas para saltar a ese momento.`;
}
