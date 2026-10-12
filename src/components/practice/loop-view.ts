import type { LoopRange } from "../../types";

/*
 * Lo que se ve alrededor de «ahora» en una vista que avanza con la canción (la
 * tablatura del bajo, la cascada del piano). Sin bucle es un único tramo de la canción.
 * Con el bucle encendido, lo que viene tras su final es otra vez su inicio: la vista se
 * parte en tramos, cada uno dibujado `offset` ms más adelante de donde está en la canción.
 */

export interface TimeWindow {
  /** Tramo de la canción, en ms. */
  from: number;
  to: number;
  /** Se dibuja en `tiempo + offset`: dónde cae en la vista. */
  offset: number;
}

export interface LoopView {
  windows: TimeWindow[];
  /** Instantes de la vista (ms) donde el bucle empieza o vuelve a empezar. */
  marks: { at: number; kind: "start" | "wrap" }[];
}

/** Repeticiones que se dibujan como mucho (un bucle de medio segundo en una vista de 5 s). */
const MAX_WINDOWS = 16;

/**
 * Tramos de la canción que caen en la vista [`ms − behind`, `ms + ahead`]. `loop` es el
 * bucle encendido, en segundos (o `null`). Dentro del bucle la vista es periódica; antes
 * de él se ve la canción tal cual hasta su final y luego se repite; después, no influye.
 */
export function loopView(ms: number, behind: number, ahead: number, loop: LoopRange | null): LoopView {
  const from = ms - behind;
  const to = ms + ahead;
  const start = loop ? loop.start * 1000 : 0;
  const end = loop ? loop.end * 1000 : 0;
  if (!loop || ms >= end || end <= start) return { windows: [{ from, to, offset: 0 }], marks: [] };

  const length = end - start;
  const windows: TimeWindow[] = [];
  const marks: LoopView["marks"] = [];
  let k: number;
  if (ms < start) {
    windows.push({ from, to: Math.min(to, end), offset: 0 });
    if (start <= to) marks.push({ at: start, kind: "start" });
    k = 1;
  } else {
    k = Math.floor((from - start) / length);
  }
  for (; start + k * length < to && windows.length < MAX_WINDOWS; k++) {
    const viewFrom = Math.max(from, start + k * length);
    const viewTo = Math.min(to, start + (k + 1) * length);
    if (viewTo <= viewFrom) continue;
    windows.push({ from: viewFrom - k * length, to: viewTo - k * length, offset: k * length });
    if (k > 0 && start + k * length >= from) marks.push({ at: start + k * length, kind: "wrap" });
  }
  return { windows, marks };
}

/** Instante de la canción (ms) que se dibuja en el instante `at` de la vista. */
export function songTimeAt(view: LoopView, at: number): number {
  for (const window of view.windows) {
    if (at >= window.from + window.offset && at < window.to + window.offset) return at - window.offset;
  }
  return at;
}
