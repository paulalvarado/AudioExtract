import type { BassNote } from "../types";

/*
 * Del JSON de notas que devuelve el motor a una tablatura de bajo: qué instrumento
 * hace falta (4 o 5 cuerdas) y en qué cuerda y traste se toca cada nota.
 *
 * Una misma nota se puede tocar en varios sitios (C#2: traste 9 de la cuerda E o
 * traste 4 de la A). Un bajista no elige nota a nota: coloca la mano en una «caja»
 * de cuatro trastes (un dedo por traste) y la mueve lo menos posible. El mapeo
 * busca el recorrido de cajas más barato para toda la canción (algoritmo de
 * Viterbi): cuesta mover la mano —más cuanto más lejos y con menos tiempo—, algo
 * cruzar cuerdas, y un poco tocar en trastes altos.
 */

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const NATURALS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** E1 (41,2 Hz): la cuerda más grave de un bajo de 4 cuerdas con afinación estándar. */
export const E1_HZ = 41.2034;
/** Medio semitono por debajo de E1: una nota por debajo de esto ya es D#1 o más grave. */
const BELOW_E1_HZ = E1_HZ * 2 ** (-0.5 / 12);

export interface BassString {
  /** Nombre de la cuerda al aire: «E», «B»… */
  name: string;
  midi: number;
}

/** Afinación estándar, de la cuerda más grave a la más aguda. */
export const FOUR_STRINGS: readonly BassString[] = [
  { name: "E", midi: 28 },
  { name: "A", midi: 33 },
  { name: "D", midi: 38 },
  { name: "G", midi: 43 },
];
/** La de 5 cuerdas añade un B0 grave. */
export const FIVE_STRINGS: readonly BassString[] = [{ name: "B", midi: 23 }, ...FOUR_STRINGS];

/** Trastes de un bajo de escala larga; lo que no cabe se desplaza de octava. */
export const MAX_FRET = 24;
/** Trastes que cubre la mano sin moverse: un dedo por traste. */
export const HAND_SPAN = 4;
/** Trastes que se dibujan como mínimo, aunque la canción no pase del quinto. */
const MIN_VISIBLE_FRETS = 12;

// Costes de la heurística. Las unidades son arbitrarias: solo importan las proporciones.
/** Mover la mano, aunque sea un traste: quedarse en la caja siempre es lo más cómodo. */
const SHIFT_COST = 1;
const SHIFT_PER_FRET = 0.5;
/** Los saltos de más de una caja se pagan aparte: se pierde la referencia visual. */
const LONG_JUMP_PER_FRET = 1;
/** Con un silencio así antes de la nota hay tiempo de sobra para desplazarse. */
const RELAXED_GAP_MS = 400;
const RELAXED_FACTOR = 0.5;
/** Cruzar cuerdas es barato pero no gratis: ante la duda, la misma cuerda. */
const STRING_CROSS_COST = 0.3;
/** Dos notas que se pisan no pueden sonar en la misma cuerda. */
const SAME_STRING_OVERLAP_COST = 50;
/** Preferencia suave por las posiciones graves y más marcada a partir del traste 12. */
const POSITION_COST = 0.04;
const HIGH_FRET = 12;
const HIGH_FRET_COST = 0.15;

export interface FretPosition {
  /** Índice en `BassTab.strings`: 0 es la cuerda más grave. */
  string: number;
  /** 0 es la cuerda al aire. */
  fret: number;
}

export interface TabNote extends FretPosition {
  startMs: number;
  endMs: number;
  /** Nota que suena, con la transposición aplicada. */
  midi: number;
  name: string;
  /** Primer traste de la caja donde está la mano al tocarla (en una cuerda al aire, la que tenía). */
  hand: number;
  /** Octavas que se desplazó para caber en el mástil (casi siempre 0). */
  octaveShift: number;
}

export interface BassTab {
  strings: readonly BassString[];
  /** En orden de inicio. */
  notes: TabNote[];
  /** Trastes que hay que dibujar. */
  fretCount: number;
  /** Notas que solo caben desplazadas de octava. */
  shifted: number;
}

/** «C#2» → 37, «Bb0» → 22. `null` si el texto no es una nota. */
export function noteToMidi(name: string): number | null {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name.trim());
  if (!match) return null;
  const [, letter, accidental, octave] = match;
  const alteration = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return (Number(octave) + 1) * 12 + NATURALS[letter] + alteration;
}

/** 37 → «C#2». */
export function midiToName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Nombre sin octava, para dibujar dentro de un punto: 37 → «C#». */
export function pitchClass(midi: number): string {
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}

/** Nota MIDI de un evento: la de su nombre o, si no se entiende, la más cercana a su frecuencia. */
export function eventMidi(note: BassNote): number | null {
  const named = noteToMidi(note.note);
  if (named !== null) return named;
  return note.frequency > 0 ? Math.round(69 + 12 * Math.log2(note.frequency / 440)) : null;
}

/** Si alguna nota baja de E1 hace falta la cuerda B grave de un bajo de 5 cuerdas. */
export function needsFiveStrings(notes: readonly Pick<BassNote, "frequency">[]): boolean {
  return notes.some((note) => note.frequency > 0 && note.frequency < BELOW_E1_HZ);
}

/**
 * Tablatura de las notas del motor, transpuestas `semitones` (los que suenan en la
 * pista de bajo: los suyos más los globales), en un bajo de 4 o 5 cuerdas según haga falta.
 */
export function buildBassTab(source: readonly BassNote[], semitones = 0): BassTab {
  const ratio = 2 ** (semitones / 12);
  const strings = needsFiveStrings(source.map((note) => ({ frequency: note.frequency * ratio })))
    ? FIVE_STRINGS
    : FOUR_STRINGS;
  const lowest = strings[0].midi;
  const highest = strings[strings.length - 1].midi + MAX_FRET;

  const events: PlacedEvent[] = [];
  for (const note of source) {
    const original = eventMidi(note);
    if (original === null || note.endTimeMs <= note.startTimeMs) continue;
    let midi = original + semitones;
    let octaveShift = 0;
    while (midi < lowest) {
      midi += 12;
      octaveShift++;
    }
    while (midi > highest) {
      midi -= 12;
      octaveShift--;
    }
    events.push({ startMs: note.startTimeMs, endMs: note.endTimeMs, midi, octaveShift });
  }
  events.sort((a, b) => a.startMs - b.startMs);

  const positions = mapToFretboard(events, strings);
  const notes = events.map((event, index): TabNote => ({ ...event, ...positions[index], name: midiToName(event.midi) }));
  const maxFret = notes.reduce((max, note) => Math.max(max, note.fret), 0);
  return {
    strings,
    notes,
    fretCount: Math.min(MAX_FRET, Math.max(MIN_VISIBLE_FRETS, maxFret + 2)),
    shifted: notes.filter((note) => note.octaveShift !== 0).length,
  };
}

interface PlacedEvent {
  startMs: number;
  endMs: number;
  midi: number;
  octaveShift: number;
}

interface State extends FretPosition {
  hand: number;
  cost: number;
  /** Estado de la nota anterior del que viene (índice en su capa). */
  from: number;
}

/**
 * Cuerda, traste y caja de cada nota (ya dentro del rango de `strings`), eligiendo
 * el recorrido de menor coste total. Cada estado es «nota tocada en esta cuerda y
 * traste con la mano en esta caja»; una cuerda al aire no necesita la mano, así que
 * hereda la caja del estado anterior y el desplazamiento se cobra en la siguiente nota pisada.
 */
export function mapToFretboard(
  events: readonly Pick<PlacedEvent, "startMs" | "endMs" | "midi">[],
  strings: readonly BassString[],
): (FretPosition & { hand: number })[] {
  if (events.length === 0) return [];
  const layers: State[][] = [];

  events.forEach((event, index) => {
    const previous = layers[index - 1];
    const before = events[index - 1];
    const gapMs = before ? event.startMs - before.endMs : Infinity;
    const overlaps = before !== undefined && event.startMs < before.endMs;
    const layer: State[] = [];

    for (const { string, fret } of candidates(event.midi, strings)) {
      if (fret === 0) {
        // Cuerda al aire: la mano puede estar en cualquier caja (la de la nota
        // anterior, o cualquiera si es la primera) y la decide la siguiente nota pisada.
        if (!previous) {
          for (let hand = 1; hand <= MAX_FRET - HAND_SPAN + 1; hand++) {
            layer.push({ string, fret, hand, cost: POSITION_COST * hand, from: -1 });
          }
          continue;
        }
        const byHand = new Map<number, State>();
        for (let fromIndex = 0; fromIndex < previous.length; fromIndex++) {
          const from = previous[fromIndex];
          const cost = from.cost + moveCost(from, string, from.hand, gapMs, overlaps);
          const known = byHand.get(from.hand);
          if (!known || cost < known.cost) byHand.set(from.hand, { string, fret, hand: from.hand, cost, from: fromIndex });
        }
        layer.push(...byHand.values());
        continue;
      }

      for (let hand = Math.max(1, fret - HAND_SPAN + 1); hand <= fret; hand++) {
        const place = POSITION_COST * hand + Math.max(0, fret - HIGH_FRET) * HIGH_FRET_COST;
        if (!previous) {
          layer.push({ string, fret, hand, cost: place, from: -1 });
          continue;
        }
        let best = Infinity;
        let bestFrom = 0;
        for (let fromIndex = 0; fromIndex < previous.length; fromIndex++) {
          const cost = previous[fromIndex].cost + moveCost(previous[fromIndex], string, hand, gapMs, overlaps);
          if (cost < best) {
            best = cost;
            bestFrom = fromIndex;
          }
        }
        layer.push({ string, fret, hand, cost: best + place, from: bestFrom });
      }
    }
    layers.push(layer);
  });

  // Del estado final más barato hacia atrás.
  const result: (FretPosition & { hand: number })[] = new Array(events.length);
  let state = layers[layers.length - 1].reduce((best, candidate) => (candidate.cost < best.cost ? candidate : best));
  for (let index = layers.length - 1; index >= 0; index--) {
    result[index] = { string: state.string, fret: state.fret, hand: state.hand };
    if (index > 0) state = layers[index - 1][state.from];
  }
  return result;
}

function candidates(midi: number, strings: readonly BassString[]): FretPosition[] {
  const positions: FretPosition[] = [];
  strings.forEach((open, string) => {
    const fret = midi - open.midi;
    if (fret >= 0 && fret <= MAX_FRET) positions.push({ string, fret });
  });
  return positions;
}

function moveCost(from: State, string: number, hand: number, gapMs: number, overlaps: boolean): number {
  const shift = Math.abs(hand - from.hand);
  let cost = shift === 0 ? 0 : SHIFT_COST + shift * SHIFT_PER_FRET + Math.max(0, shift - HAND_SPAN) * LONG_JUMP_PER_FRET;
  if (gapMs >= RELAXED_GAP_MS) cost *= RELAXED_FACTOR;
  cost += Math.abs(string - from.string) * STRING_CROSS_COST;
  if (overlaps && string === from.string) cost += SAME_STRING_OVERLAP_COST;
  return cost;
}

/** Índice de la última nota que empieza en `ms` o antes (−1 si ninguna). Búsqueda binaria. */
export function lastStartedAt(notes: readonly TabNote[], ms: number): number {
  let low = 0;
  let high = notes.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (notes[middle].startMs <= ms) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
