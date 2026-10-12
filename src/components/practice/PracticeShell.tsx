import { useEffect, useState, type ReactNode } from "react";
import { toAppError, transcribeStem } from "../../lib/tauri";
import type { AppError, LibraryItem, NoteEvent, PracticeStem } from "../../types";
import { CloseIcon, RefreshIcon } from "../icons";

const INSTRUMENT: Record<PracticeStem, string> = { bass: "el bajo", piano: "el piano" };

interface PracticeShellProps {
  stem: PracticeStem;
  state: NotesState;
  onRetry: () => void;
  /** Controles de la pista (fader con vúmetro, semitonos, M/S) del mezclador. */
  controls: ReactNode;
  /** Resumen junto a los controles: instrumento, notas, transposición. */
  summary: ReactNode;
  /** Opciones propias del modo, antes de «Todas las pistas». */
  options?: ReactNode;
  /** Hay notas transcritas, pero ninguna: el lienzo no tiene nada que mostrar. */
  empty: boolean;
  onClose: () => void;
  /** El lienzo, cuando hay notas. */
  children: ReactNode;
}

/**
 * Lo común a los modos práctica: el mezclador entero se dedica a una pista. Arriba, sus
 * controles, un resumen y las opciones del modo; debajo, el lienzo sincronizado con lo
 * que suena, o el estado de la transcripción.
 */
export function PracticeShell({ stem, state, onRetry, controls, summary, options, empty, onClose, children }: PracticeShellProps) {
  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-[312px_minmax(0,1fr)_auto] items-center border-b border-line">
        <div className="h-15 border-r border-line">{controls}</div>
        {summary}
        <div className="mr-3 flex items-center gap-2">
          {options}
          <button
            type="button"
            onClick={onClose}
            title="Salir del modo práctica y volver a todas las pistas"
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-raised hover:text-ink"
          >
            <CloseIcon width={15} height={15} />
            Todas las pistas
          </button>
        </div>
      </div>

      <div className="relative min-h-64 flex-1">
        {state.status === "loading" && (
          <Centered>
            <div className="reveal-late flex flex-col items-center gap-2 text-center">
              <p className="flex items-center gap-2.5 text-[13px] text-ink-2">
                <span className="size-3.5 animate-spin rounded-full border-2 border-ink-4 border-t-accent" aria-hidden />
                Transcribiendo {INSTRUMENT[stem]}…
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
              <p className="text-[13px] font-medium text-danger">No se pudo transcribir {INSTRUMENT[stem]}</p>
              <p className="text-xs leading-relaxed text-ink-2 select-text">{state.error.message}</p>
              <button
                type="button"
                onClick={onRetry}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-raised px-3 text-xs text-ink transition-colors hover:bg-line"
              >
                <RefreshIcon width={14} height={14} />
                Reintentar
              </button>
            </div>
          </Centered>
        )}
        {state.status === "ready" && empty && (
          <Centered>
            <p className="max-w-sm text-center text-[13px] leading-relaxed text-ink-2">
              No se detectaron notas en la pista de {stem === "bass" ? "bajo" : "piano"} de esta canción.
            </p>
          </Centered>
        )}
        {state.status === "ready" && !empty && children}
      </div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex items-center justify-center px-6">{children}</div>;
}

// --- Notas del motor --------------------------------------------------------------

export type NotesState =
  | { status: "loading" }
  | { status: "ready"; notes: NoteEvent[] }
  | { status: "error"; error: AppError };

/**
 * Peticiones por extracción y pista, compartidas mientras la app está abierta: salir y
 * volver a entrar no repite el `invoke`, y una transcripción en curso no se lanza dos
 * veces. La clave incluye la fecha de creación: una extracción nueva con el mismo nombre
 * de carpeta que otra borrada no hereda sus notas.
 */
const requests = new Map<string, Promise<NoteEvent[]>>();

function requestNotes(item: LibraryItem, stem: PracticeStem): Promise<NoteEvent[]> {
  const key = `${item.id}\n${item.createdAt}\n${stem}`;
  let request = requests.get(key);
  if (!request) {
    request = transcribeStem(item.id, stem);
    requests.set(key, request);
    // Un fallo no se recuerda: «Reintentar» vuelve a preguntar al motor.
    request.catch(() => requests.delete(key));
  }
  return request;
}

/** Notas de la pista `stem` de la extracción: las guardadas o, la primera vez, las que transcribe el motor. */
export function useStemNotes(item: LibraryItem, stem: PracticeStem) {
  const [state, setState] = useState<NotesState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    requestNotes(item, stem).then(
      (notes) => current && setState({ status: "ready", notes }),
      (raw: unknown) => current && setState({ status: "error", error: toAppError(raw) }),
    );
    return () => {
      current = false;
    };
    // `item` cambia de identidad con cada mezcla guardada; solo importa qué extracción es.
  }, [item.id, item.createdAt, stem, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}

/** Semitonos que suenan en una pista: los suyos más los globales (igual que el motor). */
export function soundingSemitones(own: number | undefined, master: number, limit: number): number {
  return Math.min(Math.max((own ?? 0) + master, -limit), limit);
}
