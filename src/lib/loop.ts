import { MIN_LOOP_SECONDS, type MultitrackEngine } from "./audio-engine";

/*
 * Acciones del bucle A–B que comparten el dock y los atajos de teclado. La región se
 * marca sobre la marcha: con el botón (o «L»), desde el cabezal y con una duración de
 * cuatro compases; con «A» y «B», el inicio y el final donde está el cabezal.
 */

/** Compases de 4/4 que dura un bucle nuevo, si se conoce el tempo. */
const DEFAULT_BARS = 4;
/** Sin tempo estimado, un bucle nuevo dura esto. */
const FALLBACK_SECONDS = 8;
const MIN_DEFAULT = 4;
const MAX_DEFAULT = 30;

/** Duración de un bucle nuevo: cuatro compases al tempo estimado (sin cambio de tempo: es tiempo de canción). */
export function defaultLoopLength(bpm: number | null): number {
  if (!bpm || !Number.isFinite(bpm) || bpm <= 0) return FALLBACK_SECONDS;
  return Math.min(MAX_DEFAULT, Math.max(MIN_DEFAULT, (DEFAULT_BARS * 4 * 60) / bpm));
}

/** Enciende o apaga el bucle; si no hay región, marca una desde el cabezal y la enciende. */
export function toggleLoop(engine: MultitrackEngine, bpm: number | null): void {
  const { loop, looping } = engine.getSnapshot();
  if (loop) {
    engine.setLooping(!looping);
    return;
  }
  const length = Math.min(defaultLoopLength(bpm), engine.duration);
  const start = Math.max(0, Math.min(engine.position, engine.duration - length));
  engine.setLoop({ start, end: start + length });
}

/**
 * Pone el inicio («A») o el final («B») del bucle en el cabezal. Marcar el final enciende
 * el bucle (y salta a su inicio): es el gesto de «repetir de A a aquí». Si el otro extremo
 * no deja sitio, la región se rehace con la duración por defecto.
 */
export function setLoopEdge(engine: MultitrackEngine, edge: "start" | "end", bpm: number | null): void {
  const { loop, looping } = engine.getSnapshot();
  const position = engine.position;
  const length = defaultLoopLength(bpm);
  if (edge === "start") {
    const end = loop && loop.end - position >= MIN_LOOP_SECONDS ? loop.end : position + length;
    engine.setLoop({ start: position, end: Math.min(end, engine.duration) }, !loop || looping);
  } else {
    const start = loop && position - loop.start >= MIN_LOOP_SECONDS ? loop.start : position - length;
    engine.setLoop({ start: Math.max(0, start), end: position }, true);
  }
}
