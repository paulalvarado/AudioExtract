/**
 * Estimación del tempo (BPM) de una canción a partir de sus pistas separadas. Sin
 * dependencias ni DOM: corre en un worker y en Node.
 *
 * 1. Envolvente de ataques de cada pista: flujo espectral (lo que sube cada banda
 *    de frecuencia de una ventana a la siguiente, en escala logarítmica) a ~86
 *    ventanas por segundo.
 * 2. Autocorrelación de cada envolvente, normalizada, y media de todas las pistas
 *    con sonido: un tempo estable deja picos en el periodo del pulso y sus múltiplos.
 *    Usar todas las pistas, y no solo la batería, resuelve el error típico de doble
 *    o mitad: en un reggae los charles en corcheas marcan igual 70 que 140 BPM, pero
 *    bajo, guitarra y piano solo se repiten a 70.
 * 3. El tempo es el periodo con más autocorrelación, con una preferencia suave por
 *    tempos medios que solo decide cuando el doble y la mitad empatan. Después se
 *    afina con la autocorrelación en los múltiplos (2, 3 y 4 pulsos), que dan una
 *    medida más precisa del periodo.
 */

export interface TempoEstimate {
  /** Pulsos por minuto a velocidad original, con un decimal. */
  bpm: number;
  /** 0–1: cuánto destaca la periodicidad elegida sobre el resto. */
  confidence: number;
}

/** Frecuencia a la que se analiza: de sobra para los ataques y 16 veces menos trabajo. */
export const ANALYSIS_RATE = 11_025;
const FRAME = 512;
const HOP = 128;
const MIN_BPM = 60;
const MAX_BPM = 180;
/** Centro y anchura (en octavas) de la preferencia por tempos medios. */
const PRIOR_BPM = 120;
const PRIOR_OCTAVES = 1;
/** Por debajo de esto (RMS, ≈ −50 dBFS) la pista está prácticamente en silencio. */
const SILENCE_RMS = 0.003;
/** Una pista más corta no da para medir un pulso. */
const MIN_SECONDS = 10;
/** Con menos confianza, la canción no tiene un pulso claro (o es muy libre) y no se da cifra. */
const MIN_CONFIDENCE = 0.15;
/** Fragmento que se analiza, del centro de la canción: el tempo es el mismo y cuesta mucho menos. */
export const EXCERPT_SECONDS = 90;

/**
 * Toma el fragmento central de una pista, la mezcla a mono y la baja a
 * `ANALYSIS_RATE` (promediando bloques: filtro tosco, pero para ataques basta).
 * `channels` son los canales a `sampleRate`. Devuelve la frecuencia resultante.
 */
export function prepareSignal(channels: Float32Array[], sampleRate: number): { samples: Float32Array; sampleRate: number } {
  const factor = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE));
  const excerpt = Math.min(channels[0].length, Math.round(EXCERPT_SECONDS * sampleRate));
  const start = Math.floor((channels[0].length - excerpt) / 2);
  const length = Math.floor(excerpt / factor);
  const samples = new Float32Array(length);
  const scale = 1 / (factor * channels.length);
  for (const channel of channels) {
    for (let i = 0, j = start; i < length; i++) {
      let sum = 0;
      for (let k = 0; k < factor; k++, j++) sum += channel[j];
      samples[i] += sum * scale;
    }
  }
  return { samples, sampleRate: sampleRate / factor };
}

/** `signals`: una señal por pista, ya preparada con `prepareSignal` a `sampleRate`. */
export function estimateTempo(signals: Float32Array[], sampleRate: number): TempoEstimate | null {
  if (!(sampleRate > 0)) return null;
  const fps = sampleRate / HOP;
  const maxLag = Math.ceil((fps * 60 * 4) / MIN_BPM) + 2;
  const acf = new Float64Array(maxLag + 2);
  let used = 0;
  for (const samples of signals) {
    if (samples.length < sampleRate * MIN_SECONDS) continue;
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    if (Math.sqrt(energy / samples.length) < SILENCE_RMS) continue;
    const own = autocorrelation(onsetEnvelope(samples), maxLag);
    if (own[0] <= 0) continue;
    for (let lag = 0; lag < acf.length; lag++) acf[lag] += own[Math.min(lag, own.length - 1)] / own[0];
    used++;
  }
  if (used === 0) return null;
  for (let lag = 0; lag < acf.length; lag++) acf[lag] /= used;

  const at = (lag: number) => {
    const low = Math.floor(lag);
    return acf[low] + (acf[low + 1] - acf[low]) * (lag - low);
  };
  const periodicity = (bpm: number) => {
    const octaves = Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES;
    return at((fps * 60) / bpm) * Math.exp(-0.5 * octaves * octaves);
  };
  const precision = (bpm: number) => {
    const period = (fps * 60) / bpm;
    return at(period) + at(2 * period) + at(3 * period) + at(4 * period);
  };

  // Búsqueda gruesa cada 0,5 BPM y fina cada 0,05 alrededor del mejor.
  let best = MIN_BPM;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) if (periodicity(bpm) > periodicity(best)) best = bpm;
  let fine = best;
  for (let bpm = best - 0.75; bpm <= best + 0.75; bpm += 0.05) if (precision(bpm) > precision(fine)) fine = bpm;

  // Confianza: la autocorrelación (normalizada) en el periodo elegido frente a la media del rango.
  let mean = 0;
  const first = Math.floor((fps * 60) / MAX_BPM);
  const last = Math.ceil((fps * 60) / MIN_BPM);
  for (let lag = first; lag <= last; lag++) mean += acf[lag];
  mean /= last - first + 1;
  const peak = at((fps * 60) / fine);
  const confidence = Math.min(Math.max((peak - mean) / (acf[0] - mean), 0), 1);

  if (confidence < MIN_CONFIDENCE) return null;
  return { bpm: Math.round(fine * 10) / 10, confidence: Math.round(confidence * 1000) / 1000 };
}

/** Flujo espectral con compresión logarítmica, sin la tendencia local y rectificado. */
function onsetEnvelope(samples: Float32Array): Float32Array {
  const frames = Math.floor((samples.length - FRAME) / HOP) + 1;
  const bins = FRAME / 2;
  const window = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);

  const fft = createFft(FRAME);
  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  let previous = new Float32Array(bins);
  let current = new Float32Array(bins);
  const flux = new Float32Array(frames);

  for (let frame = 0; frame < frames; frame++) {
    const start = frame * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = samples[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    for (let bin = 1; bin < bins; bin++) {
      const value = Math.log1p(1000 * Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]));
      current[bin] = value;
      if (frame > 0 && value > previous[bin]) sum += value - previous[bin];
    }
    flux[frame] = sum;
    [previous, current] = [current, previous];
  }

  // Resta la media móvil (~0,4 s) para que solo cuenten los ataques, no el volumen.
  const radius = 17;
  const envelope = new Float32Array(frames);
  let running = 0;
  for (let i = 0; i < Math.min(radius, frames); i++) running += flux[i];
  for (let i = 0; i < frames; i++) {
    if (i + radius < frames) running += flux[i + radius];
    if (i - radius - 1 >= 0) running -= flux[i - radius - 1];
    const count = Math.min(i + radius, frames - 1) - Math.max(i - radius, 0) + 1;
    envelope[i] = Math.max(flux[i] - running / count, 0);
  }
  return envelope;
}

/** Autocorrelación sin sesgo (dividida por el número de términos) hasta `maxLag`. */
function autocorrelation(values: Float32Array, maxLag: number): Float64Array {
  const lags = Math.min(maxLag, values.length - 1);
  const result = new Float64Array(lags + 2);
  for (let lag = 0; lag <= lags; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < values.length; i++) sum += values[i] * values[i + lag];
    result[lag] = sum / (values.length - lag);
  }
  result[lags + 1] = result[lags];
  return result;
}

/** FFT compleja radix-2 en el sitio, para un tamaño fijo potencia de 2. */
function createFft(size: number): (re: Float32Array, im: Float32Array) => void {
  const levels = Math.log2(size);
  const reverse = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    for (let bit = 0; bit < levels; bit++) r = (r << 1) | ((i >>> bit) & 1);
    reverse[i] = r;
  }
  const cos = new Float32Array(size / 2);
  const sin = new Float32Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size);
    sin[i] = -Math.sin((2 * Math.PI * i) / size);
  }

  return (re, im) => {
    for (let i = 0; i < size; i++) {
      const j = reverse[i];
      if (j > i) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let half = 1; half < size; half *= 2) {
      const step = size / (half * 2);
      for (let start = 0; start < size; start += half * 2) {
        for (let k = 0; k < half; k++) {
          const a = start + k;
          const b = a + half;
          const wr = cos[k * step];
          const wi = sin[k * step];
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  };
}
