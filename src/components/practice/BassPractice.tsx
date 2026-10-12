import { useCallback, useMemo, type ReactNode } from "react";
import { useEngineState } from "../../hooks/useEngine";
import type { MultitrackEngine } from "../../lib/audio-engine";
import { buildBassTab, type BassTab } from "../../lib/bass-tab";
import { formatSemitones } from "../../lib/format";
import { MAX_SEMITONES } from "../../lib/pitch";
import type { LibraryItem } from "../../types";
import { FretboardRenderer } from "./fretboard-renderer";
import { PracticeCanvas } from "./PracticeCanvas";
import { PracticeShell, soundingSemitones, useStemNotes } from "./PracticeShell";

interface BassPracticeProps {
  engine: MultitrackEngine;
  item: LibraryItem;
  /** Controles de la pista de bajo (fader con vúmetro, semitonos, M/S) del mezclador. */
  controls: ReactNode;
  onClose: () => void;
}

/**
 * Modo práctica de bajo: el mástil y la tablatura, sincronizados con lo que suena. Se
 * carga aparte (React.lazy) para no pesar en el resto de la app.
 */
export default function BassPractice({ engine, item, controls, onClose }: BassPracticeProps) {
  const { tracks, masterSemitones } = useEngineState(engine);
  const semitones = soundingSemitones(
    tracks.find((track) => track.id === "bass")?.semitones,
    masterSemitones,
    MAX_SEMITONES * 2,
  );
  const { state, retry } = useStemNotes(item, "bass");
  const tab = useMemo(() => (state.status === "ready" ? buildBassTab(state.notes, semitones) : null), [state, semitones]);
  const create = useCallback((canvas: HTMLCanvasElement) => new FretboardRenderer(canvas, tab!), [tab]);

  return (
    <PracticeShell
      stem="bass"
      state={state}
      onRetry={retry}
      controls={controls}
      summary={<Summary tab={tab} semitones={semitones} />}
      empty={tab !== null && tab.notes.length === 0}
      onClose={onClose}
    >
      {tab && <PracticeCanvas engine={engine} create={create} label={describe(tab)} />}
    </PracticeShell>
  );
}

function Summary({ tab, semitones }: { tab: BassTab | null; semitones: number }) {
  if (!tab) {
    return (
      <div className="min-w-0 px-4">
        <p className="text-[13px] font-medium text-ink">Modo práctica</p>
        <p className="truncate text-xs text-ink-3">Mástil y tablatura del bajo, sincronizados con la canción</p>
      </div>
    );
  }
  const five = tab.strings.length === 5;
  return (
    <div className="min-w-0 px-4">
      <p
        className="flex items-baseline gap-2 text-[13px] font-medium text-ink"
        title={five ? "Hay notas por debajo de E1 (41,2 Hz): hace falta la cuerda B grave." : "Ninguna nota baja de E1 (41,2 Hz)."}
      >
        Bajo de {tab.strings.length} cuerdas
        <span className="font-mono text-[11px] font-normal tracking-wide text-ink-3">
          {tab.strings.map((string) => string.name).join(" ")}
        </span>
      </p>
      <p className="truncate text-xs text-ink-3">
        <span className="tabular-nums">{tab.notes.length}</span> notas ·{" "}
        <span title="Transcrita en tu equipo por un modelo: puede fallar en notas muy rápidas, muy graves o con mucho ruido de otras pistas.">
          transcripción automática
        </span>
        {semitones !== 0 && (
          <span className="text-accent"> · tablatura transpuesta {formatSemitones(semitones)}</span>
        )}
        {tab.shifted > 0 && (
          <span title="No caben en el mástil con esta transposición: se muestran una octava más arriba o más abajo.">
            {` · ${tab.shifted} ${tab.shifted === 1 ? "nota cambiada" : "notas cambiadas"} de octava`}
          </span>
        )}
      </p>
    </div>
  );
}

function describe(tab: BassTab): string {
  return `Mástil de bajo de ${tab.strings.length} cuerdas (${tab.strings.map((string) => string.name).join(" ")}) con las notas que suenan, y tablatura de la canción. Haz clic en la tablatura para saltar a ese momento.`;
}
