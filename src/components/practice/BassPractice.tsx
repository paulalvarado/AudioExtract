import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useEngineState } from "../../hooks/useEngine";
import type { MultitrackEngine } from "../../lib/audio-engine";
import { buildBassTab, type BassTab } from "../../lib/bass-tab";
import { formatSemitones } from "../../lib/format";
import { MAX_SEMITONES } from "../../lib/pitch";
import { generateBassTab, toAppError } from "../../lib/tauri";
import type { AppError, BassNote, LibraryItem } from "../../types";
import { CloseIcon, RefreshIcon } from "../icons";
import { PracticeFretboard } from "./PracticeFretboard";

interface BassPracticeProps {
  engine: MultitrackEngine;
  item: LibraryItem;
  /** Controles de la pista de bajo (fader con vúmetro, semitonos, M/S) del mezclador. */
  controls: ReactNode;
  onClose: () => void;
}

/**
 * Modo práctica: el mezclador entero se dedica al bajo. Arriba, sus controles y un
 * resumen; debajo, el mástil y la tablatura sincronizados con lo que suena. Se carga
 * aparte (React.lazy) para no pesar en el resto de la app.
 */
export default function BassPractice({ engine, item, controls, onClose }: BassPracticeProps) {
  const { tracks, masterSemitones } = useEngineState(engine);
  const bass = tracks.find((track) => track.id === "bass");
  // Lo que suena en la pista de bajo: sus semitonos más los globales (igual que el motor).
  const semitones = Math.min(Math.max((bass?.semitones ?? 0) + masterSemitones, -MAX_SEMITONES * 2), MAX_SEMITONES * 2);
  const { state, retry } = useBassNotes(item);
  const tab = useMemo(() => (state.status === "ready" ? buildBassTab(state.notes, semitones) : null), [state, semitones]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-[312px_minmax(0,1fr)_auto] items-center border-b border-line">
        <div className="h-15 border-r border-line">{controls}</div>
        <Summary tab={tab} semitones={semitones} />
        <button
          type="button"
          onClick={onClose}
          title="Salir del modo práctica y volver a todas las pistas"
          className="mr-3 flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-raised hover:text-ink"
        >
          <CloseIcon width={15} height={15} />
          Todas las pistas
        </button>
      </div>

      <div className="relative min-h-64 flex-1">
        {state.status === "loading" && (
          <Centered>
            <div className="reveal-late flex flex-col items-center gap-2 text-center">
              <p className="flex items-center gap-2.5 text-[13px] text-ink-2">
                <span className="size-3.5 animate-spin rounded-full border-2 border-ink-4 border-t-accent" aria-hidden />
                Transcribiendo el bajo…
              </p>
              <p className="max-w-sm text-xs leading-relaxed text-ink-3">
                La primera vez el motor analiza la pista en tu equipo y tarda unos segundos. Después se abre al instante.
              </p>
            </div>
          </Centered>
        )}
        {state.status === "error" && (
          <Centered>
            <div className="flex max-w-md flex-col items-start gap-3 rounded-xl border border-danger/35 bg-danger/5 px-4 py-3.5" role="alert">
              <p className="text-[13px] font-medium text-danger">No se pudo transcribir el bajo</p>
              <p className="text-xs leading-relaxed text-ink-2 select-text">{state.error.message}</p>
              <button
                type="button"
                onClick={retry}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-raised px-3 text-xs text-ink transition-colors hover:bg-line"
              >
                <RefreshIcon width={14} height={14} />
                Reintentar
              </button>
            </div>
          </Centered>
        )}
        {tab && tab.notes.length === 0 && (
          <Centered>
            <p className="max-w-sm text-center text-[13px] leading-relaxed text-ink-2">
              No se detectaron notas en la pista de bajo de esta canción.
            </p>
          </Centered>
        )}
        {tab && tab.notes.length > 0 && <PracticeFretboard engine={engine} tab={tab} label={describe(tab)} />}
      </div>
    </div>
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

function Centered({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex items-center justify-center px-6">{children}</div>;
}

function describe(tab: BassTab): string {
  return `Mástil de bajo de ${tab.strings.length} cuerdas (${tab.strings.map((string) => string.name).join(" ")}) con las notas que suenan, y tablatura de la canción. Haz clic en la tablatura para saltar a ese momento.`;
}

// --- Notas del motor --------------------------------------------------------------

type NotesState =
  | { status: "loading" }
  | { status: "ready"; notes: BassNote[] }
  | { status: "error"; error: AppError };

/**
 * Peticiones por extracción, compartidas mientras la app está abierta: salir y volver
 * a entrar no repite el `invoke`, y una transcripción en curso no se lanza dos veces.
 * La clave incluye la fecha de creación: una extracción nueva con el mismo nombre de
 * carpeta que otra borrada no hereda sus notas.
 */
const requests = new Map<string, Promise<BassNote[]>>();

function requestNotes(item: LibraryItem): Promise<BassNote[]> {
  const key = `${item.id}\n${item.createdAt}`;
  let request = requests.get(key);
  if (!request) {
    request = generateBassTab(item.id);
    requests.set(key, request);
    // Un fallo no se recuerda: «Reintentar» vuelve a preguntar al motor.
    request.catch(() => requests.delete(key));
  }
  return request;
}

function useBassNotes(item: LibraryItem) {
  const [state, setState] = useState<NotesState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    requestNotes(item).then(
      (notes) => current && setState({ status: "ready", notes }),
      (raw: unknown) => current && setState({ status: "error", error: toAppError(raw) }),
    );
    return () => {
      current = false;
    };
    // `item` cambia de identidad con cada mezcla guardada; solo importa qué extracción es.
  }, [item.id, item.createdAt, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}
