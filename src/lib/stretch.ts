import type { StretchNode } from "signalsmith-stretch";

export type { StretchNode };

/** Audio anterior al punto de arranque: la primera ventana del procesador necesita historia. */
const PREROLL_SECONDS = 1;
/** Audio por delante del cabezal que cada procesador mantiene cargado. */
const AHEAD_SECONDS = 12;
/** Audio ya sonado que se conserva antes de liberarlo. */
const BEHIND_SECONDS = 2;
/** Tamaño de cada envío al procesador. */
const CHUNK_SECONDS = 4;

/**
 * Crea un procesador Signalsmith Stretch (WASM en un AudioWorklet), parado. El
 * módulo (~110 KB) se descarga la primera vez que hace falta.
 */
export async function createStretchNode(context: BaseAudioContext): Promise<StretchNode> {
  const { default: SignalsmithStretch } = await import("signalsmith-stretch");
  return SignalsmithStretch(context, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
}

/**
 * Una pista reproducida por Signalsmith Stretch en modo búfer: cambia el tono y
 * la velocidad a la vez, y arranca en cualquier punto exacto sin precalentarse.
 *
 * El procesador no recibe la pista entera (duplicaría en memoria cada canción
 * abierta), sino trozos alrededor del cabezal: `feed` carga lo que viene y
 * libera lo que ya sonó. Las posiciones de `play` son de la canción; la pista
 * traduce al tiempo de su búfer.
 *
 * El procesador compensa su propia latencia: lo programado para el instante `at`
 * del contexto suena en `at`, siempre que se programe con al menos `latency()`
 * de antelación. Los métodos devuelven la promesa de que el procesador ha recibido
 * el encargo; la reproducción no la espera (los mensajes llegan en orden), la
 * exportación sí, porque pausa el render para cargar audio.
 */
export class StretchLane {
  /** Primera muestra de la canción que hay en el búfer del procesador. */
  private base = 0;
  /** Muestra siguiente a la última enviada. */
  private fed = 0;
  /** Final (en muestras de la canción) de cada trozo enviado que sigue en el procesador. */
  private chunks: number[] = [];

  constructor(
    readonly node: StretchNode,
    private readonly buffer: AudioBuffer,
  ) {}

  /** Vacía el procesador y carga el audio alrededor de `seconds`. */
  reset(seconds: number): Promise<unknown> {
    const rate = this.buffer.sampleRate;
    this.base = clamp(Math.round((seconds - PREROLL_SECONDS) * rate), 0, this.buffer.length);
    this.fed = this.base;
    this.chunks = [];
    return Promise.all([this.node.dropBuffers(), this.feed(seconds)]);
  }

  /** Mantiene cargado el audio que va a sonar a partir de `seconds` y libera el que ya sonó. */
  feed(seconds: number): Promise<unknown> {
    const rate = this.buffer.sampleRate;
    const sent: Promise<unknown>[] = [];
    const until = Math.min(Math.round((seconds + AHEAD_SECONDS) * rate), this.buffer.length);
    while (this.fed < until) {
      const end = Math.min(this.fed + CHUNK_SECONDS * rate, this.buffer.length);
      const channels = Array.from({ length: this.buffer.numberOfChannels }, (_, channel) =>
        this.buffer.getChannelData(channel).slice(this.fed, end),
      );
      sent.push(
        this.node.addBuffers(
          channels,
          channels.map((channel) => channel.buffer),
        ),
      );
      this.chunks.push(end);
      this.fed = end;
    }

    // El procesador libera trozos enteros: se pide solo cuando el primero ya sobra.
    const keep = Math.round((seconds - BEHIND_SECONDS) * rate);
    if (this.chunks.length > 1 && this.chunks[0] <= keep) {
      while (this.chunks.length > 1 && this.chunks[0] <= keep) this.chunks.shift();
      sent.push(this.node.dropBuffers((keep - this.base) / rate));
    }
    return Promise.all(sent);
  }

  /** Desde el instante `at` del contexto suena la posición `position` de la canción, a `rate`. */
  play(at: number, position: number, rate: number, semitones: number): Promise<unknown> {
    return this.node.schedule({
      active: true,
      input: position - this.base / this.buffer.sampleRate,
      rate,
      semitones,
      output: at,
    });
  }

  /** Deja de sonar en el instante `at` (y anula lo programado después). */
  stop(at: number): Promise<unknown> {
    return this.node.schedule({ active: false, output: at });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
