import { midiToName } from "../lib/bass-tab";
import type { BassNote, StemId } from "../types";

// Pistas sintéticas para el modo demo: una canción corta a 100 BPM sobre
// La m – Fa – Do – Sol, con un timbre reconocible por instrumento.

const RATE = 44_100;
const BPM = 100;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const CHORDS = [
  [57, 60, 64], // La m
  [53, 57, 60], // Fa
  [48, 52, 55], // Do
  [55, 59, 62], // Sol
];

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const chordAt = (time: number) => CHORDS[Math.floor(time / BAR) % CHORDS.length];

/**
 * Bajo: fundamental, quinta, octava y quinta del acorde, una por tiempo, dos octavas
 * por debajo. El Do baja a C1 (32,7 Hz), por debajo de E1: pide un bajo de 5 cuerdas.
 */
const BASS_STEPS = [0, 7, 12, 7];
const bassMidiAt = (time: number) => chordAt(time)[0] - 24 + BASS_STEPS[Math.floor(time / BEAT) % BASS_STEPS.length];
/** El pulso del bajo se apaga casi del todo antes del siguiente tiempo. */
const BASS_SUSTAIN = 0.85;

/** Las notas exactas que toca el bajo sintético, como las devolvería la transcripción del motor. */
export function synthBassNotes(seconds: number): BassNote[] {
  const notes: BassNote[] = [];
  for (let beat = 0; beat * BEAT < seconds - 0.05; beat++) {
    const start = beat * BEAT;
    const midi = bassMidiAt(start + 0.001);
    notes.push({
      note: midiToName(midi),
      frequency: Math.round(hz(midi) * 100) / 100,
      startTimeMs: Math.round(start * 1000),
      endTimeMs: Math.round(Math.min(start + BEAT * BASS_SUSTAIN, seconds) * 1000),
    });
  }
  return notes;
}

function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state / 2147483647) * 2 - 1;
  };
}

export function synthStem(id: StemId, seconds: number): Float32Array[] {
  const frames = Math.round(seconds * RATE);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const rand = noise(id.length * 97 + 13);
  const pan = { vocals: 0, drums: 0, bass: 0, guitar: -0.35, piano: 0.3, wind: 0.2, other: -0.15 }[id];

  // Nivel común para que la suma de las siete pistas quede por debajo de 0 dBFS, como una mezcla real.
  const LEVEL = 0.34;
  const write = (index: number, value: number) => {
    left[index] += value * LEVEL * (1 - pan);
    right[index] += value * LEVEL * (1 + pan);
  };

  if (id === "guitar") {
    // Karplus-Strong: arpegios punteados en corcheas.
    const step = BEAT / 2;
    for (let start = 0; start < seconds; start += step) {
      const chord = chordAt(start);
      const note = chord[Math.round(start / step) % chord.length] + 12;
      const period = Math.round(RATE / hz(note));
      const buffer = Float32Array.from({ length: period }, () => rand() * 0.5);
      const begin = Math.round(start * RATE);
      for (let i = 0; i < RATE * 1.2 && begin + i < frames; i++) {
        const index = i % period;
        const next = (index + 1) % period;
        const sample = buffer[index];
        buffer[index] = (sample + buffer[next]) * 0.4985;
        write(begin + i, sample * 0.55);
      }
    }
    return [left, right];
  }

  for (let i = 0; i < frames; i++) {
    const t = i / RATE;
    const beat = t % BEAT;
    const chord = chordAt(t);
    let value = 0;
    switch (id) {
      case "drums": {
        const kick = beat < 0.25 ? Math.sin(2 * Math.PI * 55 * t * (1 + 2 * Math.exp(-beat * 30))) * Math.exp(-beat * 18) : 0;
        const snareTime = (t + BEAT) % (BEAT * 2);
        const snare = snareTime < 0.2 ? rand() * Math.exp(-snareTime * 24) * 0.5 : 0;
        const hat = rand() * Math.exp(-(t % (BEAT / 2)) * 70) * 0.18;
        value = kick * 0.9 + snare + hat;
        break;
      }
      case "bass": {
        const note = hz(bassMidiAt(t));
        const pluck = Math.exp(-beat * 3);
        value = (Math.sin(2 * Math.PI * note * t) + 0.3 * Math.sin(4 * Math.PI * note * t)) * pluck * 0.55;
        break;
      }
      case "piano": {
        const hit = t % (BAR / 2);
        const decay = Math.exp(-hit * 2.2);
        for (const note of chord) {
          const f = hz(note + 12);
          value += (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t) + 0.15 * Math.sin(6 * Math.PI * f * t)) * decay;
        }
        value *= 0.16;
        break;
      }
      case "wind": {
        // Frases de metal: diente de sierra suavizado con ataque lento, en compases alternos.
        const bar = Math.floor(t / BAR);
        if (bar % 2 === 1) {
          const inBar = t % BAR;
          const note = hz(chord[2] + 12 + (inBar > BAR / 2 ? 2 : 0));
          const vibrato = 1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * t);
          const envelope = Math.min(inBar * 6, 1) * Math.min((BAR - inBar) * 8, 1);
          for (let h = 1; h <= 7; h++) value += Math.sin(2 * Math.PI * note * vibrato * h * t) / h;
          value *= envelope * 0.14;
        }
        break;
      }
      case "vocals": {
        const melody = [64, 67, 69, 67, 65, 64, 62, 60];
        const phrase = Math.floor(t / BEAT) % melody.length;
        const note = hz(melody[phrase] + (Math.floor(t / BAR) % 4 === 3 ? 2 : 0));
        const vibrato = 1 + 0.006 * Math.sin(2 * Math.PI * 5 * t);
        const syllable = Math.min((t % BEAT) * 12, 1) * (0.7 + 0.3 * Math.cos((2 * Math.PI * (t % BEAT)) / BEAT));
        const singing = Math.floor(t / (BAR * 2)) % 2 === 0 ? 1 : 0.15;
        value =
          (Math.sin(2 * Math.PI * note * vibrato * t) +
            0.5 * Math.sin(4 * Math.PI * note * vibrato * t) +
            0.2 * Math.sin(6 * Math.PI * note * vibrato * t)) *
          syllable *
          singing *
          0.22;
        break;
      }
      case "other": {
        for (const note of chord) {
          const f = hz(note);
          value += Math.sin(2 * Math.PI * f * 1.003 * t) + Math.sin(2 * Math.PI * f * 0.997 * t);
        }
        value *= 0.035;
        break;
      }
    }
    write(i, value);
  }
  return [left, right];
}

export const DEMO_SAMPLE_RATE = RATE;
