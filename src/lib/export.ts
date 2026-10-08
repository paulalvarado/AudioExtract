import { STEM_LABELS, type LibraryItem, type MixState, type MixTrack, type StemId } from "../types";
import { faderToGain, UNITY_FADER } from "./audio-engine";
import type { EncodeFormat, EncodeRequest, EncodeResponse } from "./encoder.worker";
import { formatSemitones, formatTempo } from "./format";
import { clampSemitones, clampTempo, MAX_SEMITONES, ORIGINAL_TEMPO } from "./pitch";
import { createStretchNode, StretchLane } from "./stretch";
import { exportChooseFile, exportChooseFolder, exportWrite, fetchStem, joinPath, safeFileName } from "./tauri";

export type ExportFormat = EncodeFormat;

export const EXPORT_FORMATS: readonly { id: ExportFormat; label: string; detail: string }[] = [
  { id: "wav24", label: "WAV 24 bits", detail: "Sin pérdida, para tu DAW" },
  { id: "wav16", label: "WAV 16 bits", detail: "Sin pérdida, calidad CD" },
  { id: "mp3", label: "MP3 320 kbps", detail: "Comprimido, para escuchar o compartir" },
];

/** Frecuencia de las pistas que genera el motor. */
export const STEM_SAMPLE_RATE = 44_100;

export type ExportTarget =
  | { kind: "stems"; stems: StemId[]; applyMix: boolean }
  | { kind: "mix" };

export interface ExportProgress {
  label: string;
  /** 0–1 del total. */
  fraction: number;
}

export interface ExportResult {
  destination: string;
  files: string[];
  /** Cuánto se bajó la mezcla para no saturar (0 si no hizo falta). */
  attenuationDb: number;
}

export interface ExportJob {
  item: LibraryItem;
  target: ExportTarget;
  format: ExportFormat;
  mix: MixState;
  /** Búferes ya decodificados por el reproductor; si faltan, se leen de disco. */
  buffers?: ReadonlyMap<StemId, AudioBuffer>;
  onProgress: (progress: ExportProgress) => void;
}

const DEFAULT_TRACK: MixTrack = { fader: UNITY_FADER, muted: false, solo: false, semitones: 0 };

export function trackMix(mix: MixState, id: StemId): MixTrack {
  return mix.tracks[id] ?? DEFAULT_TRACK;
}

/** Semitonos que suenan en una pista: los suyos más los globales. */
export function effectiveSemitones(mix: MixState, id: StemId): number {
  return clampSemitones(trackMix(mix, id).semitones + mix.masterSemitones, MAX_SEMITONES * 2);
}

/** Tempo global de la mezcla, en porcentaje de la velocidad original. */
export function mixTempo(mix: MixState): number {
  return typeof mix.tempo === "number" && Number.isFinite(mix.tempo) ? clampTempo(mix.tempo) : ORIGINAL_TEMPO;
}

/** « (tono −2, tempo 80 %)», o nada si suena como el original. */
export function describeChanges(semitones: number, tempo: number): string {
  const changes = [
    semitones !== 0 && `tono ${formatSemitones(semitones)}`,
    tempo !== ORIGINAL_TEMPO && `tempo ${formatTempo(tempo)}`,
  ].filter(Boolean);
  return changes.length > 0 ? ` (${changes.join(", ")})` : "";
}

/** Pistas que suenan según mute/solo. */
export function audibleStems(stems: readonly StemId[], mix: MixState): StemId[] {
  const anySolo = stems.some((id) => trackMix(mix, id).solo);
  return stems.filter((id) => {
    const track = trackMix(mix, id);
    return !track.muted && (!anySolo || track.solo);
  });
}

/** «mezcla», «sin voces», «voces», «bajo + batería»…, con el tono y el tempo si cambian. */
export function describeMix(stems: readonly StemId[], mix: MixState): string {
  const audible = audibleStems(stems, mix);
  const label = (id: StemId) => STEM_LABELS[id].toLowerCase();
  let text: string;
  if (audible.length === stems.length) text = "mezcla";
  else if (audible.length === 1) text = label(audible[0]);
  else if (audible.length === stems.length - 1) text = `sin ${label(stems.find((id) => !audible.includes(id))!)}`;
  else text = audible.map(label).join(" + ");
  return text + describeChanges(mix.masterSemitones, mixTempo(mix));
}

/**
 * Pide el destino y exporta. Devuelve `null` si el usuario cancela el diálogo.
 * Se renderiza con la misma cadena que la reproducción (volumen, tono y tempo con
 * Signalsmith Stretch), así que se exporta exactamente lo que se oye.
 */
export async function exportAudio(job: ExportJob): Promise<ExportResult | null> {
  const extension = job.format === "mp3" ? "mp3" : "wav";
  const title = safeFileName(job.item.title);

  if (job.target.kind === "mix") {
    const stems = audibleStems(job.item.stems, job.mix);
    if (stems.length === 0) throw new Error("No suena ninguna pista: quita algún mute o solo antes de exportar la mezcla.");
    const path = await exportChooseFile(safeFileName(`${title} - ${describeMix(job.item.stems, job.mix)}`), extension);
    if (!path) return null;

    return withEncoder(async (encode) => {
      const report = (label: string, fraction: number) => job.onProgress({ label, fraction });
      report("Preparando pistas…", 0);
      const sources = await Promise.all(
        stems.map(async (id) => ({
          buffer: await bufferOf(job, id),
          gain: faderToGain(trackMix(job.mix, id).fader),
          semitones: effectiveSemitones(job.mix, id),
        })),
      );
      const rate = mixTempo(job.mix) / ORIGINAL_TEMPO;
      const channels = await render(sources, rate, (fraction) => report("Mezclando…", 0.05 + fraction * 0.55));
      const attenuationDb = limitPeak(channels);
      report("Codificando…", 0.65);
      const bytes = await encode(job.format, channels);
      report("Guardando…", 0.95);
      await exportWrite(path, bytes);
      report("Listo", 1);
      return { destination: path, files: [path], attenuationDb };
    });
  }

  const folder = await exportChooseFolder();
  if (!folder) return null;
  const directory = joinPath(folder, `${title} - pistas`);
  const { stems, applyMix } = job.target;

  return withEncoder(async (encode) => {
    const files: string[] = [];
    let attenuationDb = 0;
    for (const [index, id] of stems.entries()) {
      const report = (label: string, fraction: number) =>
        job.onProgress({ label: `${STEM_LABELS[id]}: ${label}`, fraction: (index + fraction) / stems.length });
      const semitones = applyMix ? effectiveSemitones(job.mix, id) : 0;
      const tempo = applyMix ? mixTempo(job.mix) : ORIGINAL_TEMPO;
      const gain = applyMix ? faderToGain(trackMix(job.mix, id).fader) : 1;
      const changes = describeChanges(semitones, tempo);
      const path = joinPath(directory, safeFileName(`${title} - ${STEM_LABELS[id]}${changes}`) + `.${extension}`);
      const file = job.item.files.find((candidate) => candidate.id === id);
      if (!file) throw new Error(`La extracción no tiene la pista ${STEM_LABELS[id]}.`);

      let bytes: Uint8Array;
      if (job.format === "wav16" && semitones === 0 && gain === 1 && tempo === ORIGINAL_TEMPO) {
        // Sin cambios y en el mismo formato: copia exacta del archivo de la biblioteca.
        report("Copiando…", 0.3);
        bytes = new Uint8Array(await fetchStem(file.path));
      } else {
        report("Preparando…", 0);
        const channels = await render(
          [{ buffer: await bufferOf(job, id), gain, semitones }],
          tempo / ORIGINAL_TEMPO,
          (fraction) => report("Procesando…", 0.05 + fraction * 0.55),
        );
        attenuationDb = Math.max(attenuationDb, limitPeak(channels));
        report("Codificando…", 0.65);
        bytes = await encode(job.format, channels);
      }
      report("Guardando…", 0.95);
      await exportWrite(path, bytes);
      files.push(path);
    }
    job.onProgress({ label: "Listo", fraction: 1 });
    return { destination: directory, files, attenuationDb };
  });
}

async function bufferOf(job: ExportJob, id: StemId): Promise<AudioBuffer> {
  const cached = job.buffers?.get(id);
  if (cached) return cached;
  const file = job.item.files.find((candidate) => candidate.id === id);
  if (!file) throw new Error(`La extracción no tiene la pista ${STEM_LABELS[id]}.`);
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: STEM_SAMPLE_RATE });
  return context.decodeAudioData(await fetchStem(file.path));
}

interface RenderSource {
  buffer: AudioBuffer;
  gain: number;
  semitones: number;
}

/** Audio de salida entre dos cargas de los procesadores (que guardan 12 s por delante). */
const FEED_STEP_SECONDS = 4;

/**
 * Mezcla las fuentes en estéreo con OfflineAudioContext y la misma cadena que la
 * reproducción: las que no cambian suenan tal cual y el resto pasa por Signalsmith
 * Stretch en modo búfer (`rate` es la velocidad: 0,8 = 80 %). Los procesadores
 * reciben el audio a trozos, en pausas del render. Todo arranca con la antelación
 * que piden y al final se recorta, así que queda alineado con el original.
 */
async function render(sources: RenderSource[], rate: number, onProgress: (fraction: number) => void): Promise<Float32Array[]> {
  const sampleRate = sources[0].buffer.sampleRate;
  const frames = Math.ceil(Math.max(...sources.map((source) => source.buffer.length)) / rate);

  if (sources.length === 1 && sources[0].gain === 1 && sources[0].semitones === 0 && rate === 1) {
    return stereoChannels(sources[0].buffer, 0, frames);
  }

  const processed = rate !== 1 || sources.some((source) => source.semitones !== 0);
  // Margen para la antelación del procesador (≈0,12 s), que se recorta al final.
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: frames + (processed ? sampleRate : 0),
    sampleRate,
  });

  let lead = 0;
  const direct: AudioBufferSourceNode[] = [];
  const lanes: { lane: StretchLane; semitones: number }[] = [];
  for (const { buffer, gain, semitones } of sources) {
    const level = context.createGain();
    level.gain.value = gain;
    level.connect(context.destination);
    if (rate === 1 && semitones === 0) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(level);
      direct.push(source);
    } else {
      const node = await createStretchNode(context);
      lead = await node.latency();
      node.connect(level);
      const lane = new StretchLane(node, buffer);
      await lane.reset(0);
      lanes.push({ lane, semitones });
    }
  }
  for (const source of direct) source.start(lead);
  await Promise.all(lanes.map(({ lane, semitones }) => lane.play(lead, 0, rate, semitones)));

  const duration = context.length / sampleRate;
  for (let time = FEED_STEP_SECONDS; time < duration; time += FEED_STEP_SECONDS) {
    void context.suspend(time).then(async () => {
      const position = Math.max(time - lead, 0) * rate;
      await Promise.all(lanes.map(({ lane }) => lane.feed(position)));
      onProgress(time / duration);
      await context.resume();
    });
  }
  const rendered = await context.startRendering();
  onProgress(1);
  return stereoChannels(rendered, Math.round(lead * sampleRate), frames);
}

function stereoChannels(buffer: AudioBuffer, start: number, frames: number): Float32Array[] {
  const channels = Math.min(buffer.numberOfChannels, 2);
  const output = Array.from({ length: 2 }, (_, index) => {
    const data = new Float32Array(frames);
    buffer.copyFromChannel(data, Math.min(index, channels - 1), start);
    return data;
  });
  return output;
}

/** Si la mezcla supera 0 dBFS, la baja lo justo para no saturar. Devuelve los dB aplicados. */
function limitPeak(channels: Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      const value = Math.abs(sample);
      if (value > peak) peak = value;
    }
  }
  if (peak <= 1) return 0;
  const gain = 0.999 / peak;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) channel[i] *= gain;
  }
  return -20 * Math.log10(gain);
}

type Encode = (format: ExportFormat, channels: Float32Array[]) => Promise<Uint8Array>;

/** Un worker de codificación por exportación, cerrado al terminar pase lo que pase. */
async function withEncoder<T>(work: (encode: Encode) => Promise<T>): Promise<T> {
  const worker = new Worker(new URL("./encoder.worker.ts", import.meta.url), { type: "module" });
  let next = 0;
  const encode: Encode = (format, channels) =>
    new Promise((resolve, reject) => {
      const id = next++;
      const onMessage = ({ data }: MessageEvent<EncodeResponse>) => {
        if (data.id !== id) return;
        worker.removeEventListener("message", onMessage);
        if ("bytes" in data) resolve(data.bytes);
        else reject(new Error(`No se pudo codificar el audio: ${data.error}`));
      };
      worker.addEventListener("message", onMessage);
      const request: EncodeRequest = { id, format, sampleRate: STEM_SAMPLE_RATE, channels };
      worker.postMessage(
        request,
        channels.map((channel) => channel.buffer),
      );
    });
  try {
    return await work(encode);
  } finally {
    worker.terminate();
  }
}
