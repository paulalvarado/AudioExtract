import type { NoteEvent } from "../types";
import { eventMidi, midiToName } from "./bass-tab";

/*
 * Del JSON de notas del motor a lo que dibuja el modo práctica de piano: las notas
 * transpuestas, qué teclas hay que enseñar y con qué mano se toca cada nota.
 *
 * La transcripción no sabe de manos. Un pianista reparte el teclado entre las dos y
 * el reparto se mueve con la música: un bajo en octavas y acordes en el centro, o
 * las dos manos juntas arriba. Para cada nota se miran las que suenan cerca (un
 * segundo antes y después): si caben en una mano, van todas a la misma; si no, se
 * parten por el mayor hueco entre alturas, prefiriendo el que queda cerca del Do central.
 */

/** A0 y C8: las 88 teclas. */
export const LOWEST_KEY = 21;
export const HIGHEST_KEY = 108;
export const MIDDLE_C = 60;
/** Teclas que se enseñan como mínimo: tres octavas. */
const MIN_SPAN = 36;
/** Ventana alrededor de cada nota para decidir el reparto de manos. */
const HAND_WINDOW_MS = 1000;
/** Lo que abarca una mano sin desplazarse (una décima). */
const HAND_REACH = 15;
/** Cuánto pesa, al partir, que el hueco quede lejos del Do central (por semitono). */
const SPLIT_CENTER_COST = 0.12;

export type Hand = "left" | "right";

export interface PianoNote {
  startMs: number;
  endMs: number;
  /** Nota que suena, con la transposición aplicada. */
  midi: number;
  name: string;
  hand: Hand;
  /** Octavas que se desplazó para caber en el teclado (casi siempre 0). */
  octaveShift: number;
}

export interface PianoRoll {
  /** En orden de inicio. */
  notes: PianoNote[];
  /** Primera y última tecla que se dibujan (incluidas); siempre teclas blancas. */
  low: number;
  high: number;
  /** Nota más grave y más aguda que se tocan. */
  lowest: number;
  highest: number;
  /** Duración de la nota más larga: para no perder las que empezaron fuera de la vista. */
  longestMs: number;
  /** Notas que solo caben desplazadas de octava. */
  shifted: number;
  /** Notas de cada mano. */
  left: number;
  right: number;
}

const BLACK = new Set([1, 3, 6, 8, 10]);

export function isBlackKey(midi: number): boolean {
  return BLACK.has(((midi % 12) + 12) % 12);
}

/** Notas del motor transpuestas `semitones` (los que suenan en la pista de piano), sobre un teclado de 88 teclas. */
export function buildPianoRoll(source: readonly NoteEvent[], semitones = 0): PianoRoll {
  const events: Omit<PianoNote, "hand">[] = [];
  for (const note of source) {
    const original = eventMidi(note);
    if (original === null || note.endTimeMs <= note.startTimeMs) continue;
    let midi = original + semitones;
    let octaveShift = 0;
    while (midi < LOWEST_KEY) {
      midi += 12;
      octaveShift++;
    }
    while (midi > HIGHEST_KEY) {
      midi -= 12;
      octaveShift--;
    }
    events.push({ startMs: note.startTimeMs, endMs: note.endTimeMs, midi, name: midiToName(midi), octaveShift });
  }
  events.sort((a, b) => a.startMs - b.startMs || a.midi - b.midi);

  const hands = assignHands(events);
  const notes = events.map((event, index): PianoNote => ({ ...event, hand: hands[index] }));
  const lowest = notes.reduce((min, note) => Math.min(min, note.midi), HIGHEST_KEY);
  const highest = notes.reduce((max, note) => Math.max(max, note.midi), LOWEST_KEY);
  const [low, high] = notes.length > 0 ? keyRange(lowest, highest) : keyRange(MIDDLE_C - 12, MIDDLE_C + 12);

  return {
    notes,
    low,
    high,
    lowest: notes.length > 0 ? lowest : low,
    highest: notes.length > 0 ? highest : high,
    longestMs: notes.reduce((max, note) => Math.max(max, note.endMs - note.startMs), 0),
    shifted: notes.filter((note) => note.octaveShift !== 0).length,
    left: notes.filter((note) => note.hand === "left").length,
    right: notes.filter((note) => note.hand === "right").length,
  };
}

/**
 * Teclas que se dibujan: de la C por debajo de la nota más grave a la B por encima de la
 * más aguda (octavas completas, como se leen en un teclado), con tres octavas como mínimo
 * repartidas alrededor de lo que se toca, y nunca fuera de las 88 teclas.
 */
export function keyRange(lowest: number, highest: number): [number, number] {
  let low = lowest - (((lowest % 12) + 12) % 12);
  let high = highest + (11 - (((highest % 12) + 12) % 12));
  while (high - low + 1 < MIN_SPAN) {
    // Se añade la octava del lado que tiene más hueco hasta el centro del teclado.
    if (MIDDLE_C - low < high - MIDDLE_C) low -= 12;
    else high += 12;
  }
  return [Math.max(LOWEST_KEY, low), Math.min(HIGHEST_KEY, high)];
}

/** Mano de cada nota (ver el comentario del módulo). `notes` en orden de inicio. */
export function assignHands(notes: readonly Pick<PianoNote, "startMs" | "midi">[]): Hand[] {
  const hands: Hand[] = new Array(notes.length);
  let from = 0;
  let to = 0;
  for (let index = 0; index < notes.length; index++) {
    const at = notes[index].startMs;
    while (notes[from].startMs < at - HAND_WINDOW_MS) from++;
    while (to < notes.length && notes[to].startMs <= at + HAND_WINDOW_MS) to++;

    const pitches = [...new Set(notes.slice(from, to).map((note) => note.midi))].sort((a, b) => a - b);
    const lowest = pitches[0];
    const highest = pitches[pitches.length - 1];
    let split: number;
    if (highest - lowest <= HAND_REACH) {
      // Cabe en una mano: la que corresponde al centro de lo que suena.
      split = (lowest + highest) / 2 < MIDDLE_C ? Infinity : -Infinity;
    } else {
      split = MIDDLE_C;
      let best = -Infinity;
      for (let i = 1; i < pitches.length; i++) {
        const middle = (pitches[i - 1] + pitches[i]) / 2;
        const score = pitches[i] - pitches[i - 1] - Math.abs(middle - MIDDLE_C) * SPLIT_CENTER_COST;
        if (score > best) {
          best = score;
          split = middle;
        }
      }
    }
    hands[index] = notes[index].midi < split ? "left" : "right";
  }
  return hands;
}

/** Índice de la primera nota que empieza en `ms` o después. Búsqueda binaria. */
export function firstStartingAt(notes: readonly PianoNote[], ms: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (notes[middle].startMs < ms) low = middle + 1;
    else high = middle;
  }
  return low;
}
