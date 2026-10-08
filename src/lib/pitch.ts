/** Rango de cada control de semitonos (pista y global). */
export const MAX_SEMITONES = 12;

export function clampSemitones(value: number, limit = MAX_SEMITONES): number {
  return Math.min(Math.max(Math.round(value), -limit), limit);
}

/** Tempo global, en porcentaje de la velocidad original. */
export const ORIGINAL_TEMPO = 100;
export const MIN_TEMPO = 50;
export const MAX_TEMPO = 150;
export const TEMPO_STEP = 5;

export function clampTempo(value: number): number {
  return Math.min(Math.max(Math.round(value), MIN_TEMPO), MAX_TEMPO);
}
