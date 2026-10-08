import { STEM_ORDER, type MixState, type StemFile, type StemId } from "../types";
import { clampSemitones, clampTempo, MAX_SEMITONES, ORIGINAL_TEMPO } from "./pitch";
import { createStretchNode, StretchLane, type StretchNode } from "./stretch";
import { fetchStem } from "./tauri";

/** Posición del fader que equivale a 0 dB. Por encima hay hasta ~+5 dB de ganancia. */
export const UNITY_FADER = 0.75;

export function faderToGain(position: number): number {
  return position <= 0 ? 0 : (position / UNITY_FADER) ** 2;
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

export interface TrackState {
  id: StemId;
  /** Posición del fader, 0–1. */
  fader: number;
  muted: boolean;
  solo: boolean;
  /** Semitonos propios de la pista; se suman a los globales. */
  semitones: number;
  /** Resultado de mute/solo: si la pista se oye ahora mismo. */
  audible: boolean;
  /** Picos (0–1) para dibujar la forma de onda, en escala común a todas las pistas. */
  peaks: Float32Array;
}

/** Si Signalsmith Stretch (WASM) funciona en este equipo: sin él no hay transposición ni tempo. */
export type StretchAvailability = "ready" | "unavailable";

export interface EngineSnapshot {
  tracks: TrackState[];
  playing: boolean;
  duration: number;
  masterFader: number;
  masterSemitones: number;
  /** Tempo global en porcentaje de la velocidad original (100 = original). */
  tempo: number;
  stretch: StretchAvailability;
}

/** Por dónde suena una pista: la fuente tal cual o Signalsmith Stretch. */
type Route = "dry" | "wet";

interface Track {
  id: StemId;
  buffer: AudioBuffer;
  dryGain: GainNode;
  wetGain: GainNode;
  /** Procesador de la pista; se crea la primera vez que hace falta. */
  lane: StretchLane | null;
  laneRequest: Promise<StretchLane | null> | null;
  /** Ruta que suena o está programada; `null` con el transporte parado. */
  route: Route | null;
  gain: GainNode;
  analyser: AnalyserNode;
  meterData: Float32Array<ArrayBuffer>;
  fader: number;
  muted: boolean;
  solo: boolean;
  semitones: number;
  peaks: Float32Array;
}

/** Tramo del reloj: desde el instante `at` del contexto suena `position` de la canción, que avanza a `rate`. */
interface Segment {
  at: number;
  position: number;
  rate: number;
}

const PEAK_BUCKETS = 1600;
const START_LATENCY = 0.04;
const RAMP = 0.012;
/** Duración de un fundido entre rutas (casi 7 constantes de tiempo); lo que se apaga se para después. */
const CROSSFADE = 0.08;
/** Cada cuánto se carga audio en los procesadores y se comprueba si la canción ha terminado. */
const TICK_MS = 250;
/** Tras una pausa, el contexto se suspende para que los procesadores no gasten CPU. */
const SUSPEND_AFTER_MS = 250;
/** Una latencia de salida mayor que esto es una marca de tiempo caducada, no el dispositivo. */
const MAX_OUTPUT_LATENCY = 0.5;

/**
 * Reproductor multipista sincronizado. Cadena por pista:
 *
 *   BufferSource ──────────→ dry ─┬→ Gain (fader × mute/solo) → Analyser → Master → Transporte
 *   Signalsmith Stretch ───→ wet ─┘
 *
 * A velocidad original y con 0 semitonos, la pista suena por la ruta directa,
 * idéntica al archivo. Al transponerla o cambiar el tempo suena por Signalsmith
 * Stretch en modo búfer, que cambia tono y velocidad a la vez; con el tempo
 * cambiado, todas las pistas van por ahí y no hay fuentes directas.
 *
 * Todo cambio (arranque, tempo, tono) se programa para un mismo instante futuro
 * con la antelación que pide el procesador. En ese instante las rutas se funden
 * y cada procesador arranca en la posición exacta, así que las pistas nunca se
 * desfasan. El reloj guarda los tramos de velocidad para saber qué posición de
 * la canción suena en cada momento.
 */
export class MultitrackEngine {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  /** Silencia lo que queda sonando al pausar o saltar. */
  private readonly transport: GainNode;
  private readonly tracks: Track[];
  private readonly listeners = new Set<() => void>();
  /** Latencia del procesador en segundos (0 si no está disponible). */
  private readonly latency: number;
  private stretch: StretchAvailability;
  /** Procesador creado al cargar para medir la latencia; se asigna a la primera pista que lo necesite. */
  private spareNode: StretchNode | null;

  /** Fuentes de la ruta directa: solo existen a velocidad original. */
  private sources: AudioBufferSourceNode[] = [];
  private playing = false;
  /** Posición con el transporte parado, y punto de partida al reproducir. */
  private offset = 0;
  private clock: Segment[] = [];
  /** Fin del último cambio programado: el siguiente espera a que llegue. */
  private pendingUntil = 0;
  /** Estado programado, para no volver a programar lo mismo. */
  private appliedKey = "";
  private updateTimer: number | undefined;
  private tickTimer: number | undefined;
  private masterFader = UNITY_FADER;
  private masterSemitones = 0;
  private tempo = ORIGINAL_TEMPO;
  private suspendTimer: number | undefined;
  private snapshot: EngineSnapshot;
  private disposed = false;

  readonly duration: number;

  private constructor(
    ctx: AudioContext,
    master: GainNode,
    transport: GainNode,
    tracks: Track[],
    stretch: { node: StretchNode; latency: number } | null,
  ) {
    this.ctx = ctx;
    this.master = master;
    this.transport = transport;
    this.tracks = tracks;
    this.spareNode = stretch?.node ?? null;
    this.latency = stretch?.latency ?? 0;
    this.stretch = stretch ? "ready" : "unavailable";
    this.duration = Math.max(...tracks.map((track) => track.buffer.duration));
    this.snapshot = this.buildSnapshot();
  }

  /** Descarga y decodifica las pistas en paralelo mientras se prepara el procesador. */
  static async load(files: StemFile[], sampleRate: number, signal?: AbortSignal): Promise<MultitrackEngine> {
    // A la frecuencia de las pistas: sin remuestreo al decodificar y con los mismos
    // búferes que usa la exportación.
    const ctx = new AudioContext({ latencyHint: "playback", sampleRate });
    try {
      const transport = ctx.createGain();
      transport.connect(ctx.destination);
      const master = ctx.createGain();
      master.gain.value = faderToGain(UNITY_FADER);
      master.connect(transport);

      const stretch = createStretchNode(ctx)
        .then(async (node) => ({ node, latency: await node.latency() }))
        .catch((error: unknown) => {
          console.warn("Transposición y tempo no disponibles:", error);
          return null;
        });

      const ordered = [...files].sort((a, b) => STEM_ORDER.indexOf(a.id) - STEM_ORDER.indexOf(b.id));
      const tracks = await Promise.all(
        ordered.map(async ({ id, path }): Promise<Track> => {
          const data = await fetchStem(path, signal);
          const buffer = await ctx.decodeAudioData(data);

          const dryGain = ctx.createGain();
          const wetGain = ctx.createGain();
          wetGain.gain.value = 0;
          const gain = ctx.createGain();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;

          dryGain.connect(gain);
          wetGain.connect(gain);
          gain.connect(analyser).connect(master);

          return {
            id,
            buffer,
            dryGain,
            wetGain,
            lane: null,
            laneRequest: null,
            route: null,
            gain,
            analyser,
            meterData: new Float32Array(analyser.fftSize),
            fader: UNITY_FADER,
            muted: false,
            solo: false,
            semitones: 0,
            peaks: computePeaks(buffer, PEAK_BUCKETS),
          };
        }),
      );
      if (tracks.length === 0) throw new Error("La extracción no tiene pistas que reproducir.");

      normalizePeaks(tracks.map((track) => track.peaks));
      const engine = new MultitrackEngine(ctx, master, transport, tracks, await stretch);
      engine.applyGains(true);
      return engine;
    } catch (error) {
      void ctx.close();
      throw error;
    }
  }

  // --- Suscripción para useSyncExternalStore --------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EngineSnapshot => this.snapshot;

  private commit(): void {
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((listener) => listener());
  }

  private buildSnapshot(): EngineSnapshot {
    return {
      tracks: this.tracks.map((track) => ({
        id: track.id,
        fader: track.fader,
        muted: track.muted,
        solo: track.solo,
        semitones: track.semitones,
        audible: this.isAudible(track),
        peaks: track.peaks,
      })),
      playing: this.playing,
      duration: this.duration,
      masterFader: this.masterFader,
      masterSemitones: this.masterSemitones,
      tempo: this.tempo,
      stretch: this.stretch,
    };
  }

  // --- Transporte -----------------------------------------------------------

  /** Posición de la canción que suena, en segundos. Se consulta en cada frame, no pasa por React. */
  get position(): number {
    return this.positionAt(this.ctx.currentTime);
  }

  /**
   * Posición que está sonando ahora mismo por la salida de audio: `position` sin
   * la latencia del dispositivo (decenas de ms). Para dibujar notas en el mismo
   * instante en que se oyen.
   */
  get audiblePosition(): number {
    return this.positionAt(this.outputTime());
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  /** Búferes decodificados, para exportar sin volver a leer los archivos. */
  get buffers(): ReadonlyMap<StemId, AudioBuffer> {
    return new Map(this.tracks.map((track) => [track.id, track.buffer]));
  }

  play(): void {
    if (this.playing || this.disposed) return;
    if (this.offset >= this.duration) this.offset = 0;
    window.clearTimeout(this.suspendTimer);
    void this.ctx.resume();
    this.playing = true;
    this.clock = [];
    this.tickTimer = window.setInterval(this.tick, TICK_MS);
    this.update();
    this.commit();
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = this.position;
    this.halt();
    this.commit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  stop(): void {
    this.halt();
    this.offset = 0;
    this.commit();
  }

  seek(seconds: number): void {
    const target = Math.min(Math.max(seconds, 0), this.duration);
    if (this.playing) {
      this.halt();
      this.offset = target;
      this.play();
    } else {
      this.offset = target;
      this.commit();
    }
  }

  /** Para al instante: silencia el transporte y anula todo lo programado. */
  private halt(): void {
    window.clearInterval(this.tickTimer);
    window.clearTimeout(this.updateTimer);
    this.updateTimer = undefined;
    const now = this.ctx.currentTime;
    const gain = this.transport.gain;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(0, now, 0.004);

    this.stopSources(now + 0.03);
    for (const track of this.tracks) {
      void track.lane?.stop(now + 0.03);
      track.route = null;
    }
    this.clock = [];
    this.pendingUntil = 0;
    this.playing = false;
    this.scheduleSuspend();
  }

  /** Carga audio en los procesadores que suenan y detecta el final de la canción. */
  private readonly tick = (): void => {
    if (!this.playing) return;
    const position = this.position;
    if (this.clock.length > 0 && position >= this.duration) {
      this.halt();
      this.offset = 0;
      this.commit();
      return;
    }
    for (const track of this.tracks) if (track.route === "wet") void track.lane?.feed(position);
  };

  /**
   * Lleva lo que suena al estado pedido. Si queda un cambio programado por llegar,
   * espera a que llegue: así nunca hay dos pendientes y todas las pistas cambian
   * en el mismo instante.
   */
  private update(): void {
    if (!this.playing || this.disposed || this.updateTimer !== undefined) return;
    const wait = this.pendingUntil - this.ctx.currentTime;
    if (wait > 0) {
      this.updateTimer = window.setTimeout(() => {
        this.updateTimer = undefined;
        this.update();
      }, wait * 1000 + 5);
      return;
    }
    this.apply();
  }

  private apply(): void {
    const rate = this.rate();
    const routes = this.tracks.map((track): Route => (this.processed(track) ? "wet" : "dry"));
    const key = `${rate}|${routes.join()}|${this.tracks.map((track) => this.effective(track)).join()}`;
    const starting = this.clock.length === 0;
    if (!starting && key === this.appliedKey) return;

    // Los procesadores se crean la primera vez que hacen falta; cuando están, se vuelve aquí.
    const missing = this.tracks.filter((track, index) => routes[index] === "wet" && !track.lane);
    if (missing.length > 0) {
      void Promise.all(missing.map((track) => this.ensureLane(track))).then(() => this.update());
      return;
    }

    const now = this.ctx.currentTime;
    const at = now + START_LATENCY + this.latency;
    const position = starting ? this.offset : this.positionAt(at);
    if (starting || this.clock[this.clock.length - 1].rate !== rate) this.clock.push({ at, position, rate });
    while (this.clock.length > 2 && this.clock[1].at < now - 1) this.clock.shift();

    // La ruta directa solo existe a velocidad original.
    const direct = routes.includes("dry");
    if (direct && this.sources.length === 0) this.startSources(at, position);
    else if (!direct && this.sources.length > 0) this.stopSources(at + CROSSFADE);

    this.tracks.forEach((track, index) => {
      const route = routes[index];
      if (route === "wet" && track.lane) {
        if (track.route !== "wet") void track.lane.reset(position);
        void track.lane.play(at, position, rate, this.effective(track));
      } else if (track.route === "wet") {
        void track.lane?.stop(at + CROSSFADE);
      }
      if (route !== track.route) this.crossfade(track, route, at, starting);
      track.route = route;
    });

    if (starting) {
      // Fuentes y procesadores arrancan en `at`; hasta entonces, silencio.
      const gain = this.transport.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(0, now);
      gain.setValueAtTime(0, Math.max(now, at - 0.004));
      gain.linearRampToValueAtTime(1, at + 0.004);
    }
    this.appliedKey = key;
    this.pendingUntil = at + CROSSFADE;
  }

  private startSources(at: number, position: number): void {
    this.sources = this.tracks.map((track) => {
      const source = this.ctx.createBufferSource();
      source.buffer = track.buffer;
      source.connect(track.dryGain);
      source.start(at, position);
      return source;
    });
  }

  private stopSources(at: number): void {
    for (const source of this.sources) {
      try {
        source.stop(at);
      } catch {
        // Ya estaba parada.
      }
    }
    this.sources = [];
  }

  /** Fundido entre rutas en `at`; de golpe al arrancar, porque el transporte aún está en silencio. */
  private crossfade(track: Track, route: Route, at: number, immediate: boolean): void {
    const now = this.ctx.currentTime;
    for (const [node, on] of [
      [track.dryGain, route === "dry"],
      [track.wetGain, route === "wet"],
    ] as const) {
      node.gain.cancelScheduledValues(now);
      if (immediate) node.gain.setValueAtTime(on ? 1 : 0, at);
      else node.gain.setTargetAtTime(on ? 1 : 0, at, RAMP);
    }
  }

  /** Posición de la canción que suena en el instante `time` del contexto. */
  private positionAt(time: number): number {
    if (!this.playing) return this.offset;
    let segment: Segment | undefined;
    for (const candidate of this.clock) {
      if (candidate.at > time) break;
      segment = candidate;
    }
    // Hasta que llega el audio nuevo, el cabezal se queda en el punto de partida.
    if (!segment) return this.offset;
    return Math.min(segment.position + (time - segment.at) * segment.rate, this.duration);
  }

  /**
   * Instante del reloj de audio que sale ahora por el dispositivo. `getOutputTimestamp`
   * dice qué muestra se estaba emitiendo en un momento de `performance.now()`; se
   * extrapola hasta ahora. Sin él, se resta la latencia que declara el contexto.
   */
  private outputTime(): number {
    const rendered = this.ctx.currentTime;
    const stamp = this.ctx.getOutputTimestamp?.();
    if (stamp?.contextTime && stamp.performanceTime) {
      const heard = stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
      // Justo al reanudar, la marca puede ser de antes de la pausa: solo vale si es plausible.
      if (heard <= rendered && heard > rendered - MAX_OUTPUT_LATENCY) return heard;
    }
    return rendered - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
  }

  private scheduleSuspend(): void {
    window.clearTimeout(this.suspendTimer);
    this.suspendTimer = window.setTimeout(() => {
      if (!this.playing && !this.disposed) void this.ctx.suspend();
    }, SUSPEND_AFTER_MS);
  }

  // --- Mezcla ---------------------------------------------------------------

  setFader(id: StemId, fader: number): void {
    this.track(id).fader = clamp01(fader);
    this.applyGains();
    this.commit();
  }

  toggleMute(id: StemId): void {
    const track = this.track(id);
    track.muted = !track.muted;
    this.applyGains();
    this.commit();
  }

  toggleSolo(id: StemId): void {
    const track = this.track(id);
    track.solo = !track.solo;
    this.applyGains();
    this.commit();
  }

  setMasterFader(fader: number): void {
    this.masterFader = clamp01(fader);
    this.master.gain.setTargetAtTime(faderToGain(this.masterFader), this.ctx.currentTime, RAMP);
    this.commit();
  }

  /** Semitonos de una pista (−12…+12), sin cambiar el tempo. */
  setSemitones(id: StemId, semitones: number): void {
    this.track(id).semitones = clampSemitones(semitones);
    this.retune();
  }

  /** Semitonos de toda la canción (−12…+12); se suman a los de cada pista. */
  setMasterSemitones(semitones: number): void {
    this.masterSemitones = clampSemitones(semitones);
    this.retune();
  }

  /** Tempo de toda la canción (50–150 % de la velocidad original), sin cambiar el tono. */
  setTempo(percent: number): void {
    this.tempo = clampTempo(percent);
    this.retune();
  }

  /** Semitonos que suenan en una pista: los suyos más los globales. */
  effectiveSemitones(id: StemId): number {
    return this.effective(this.track(id));
  }

  /** Pico instantáneo (0–1+) después del fader, para los vúmetros. */
  level(id: StemId): number {
    const track = this.track(id);
    track.analyser.getFloatTimeDomainData(track.meterData);
    let peak = 0;
    for (const sample of track.meterData) {
      const value = Math.abs(sample);
      if (value > peak) peak = value;
    }
    return peak;
  }

  mixState(): MixState {
    return {
      version: 1,
      masterFader: this.masterFader,
      masterSemitones: this.masterSemitones,
      tempo: this.tempo,
      tracks: Object.fromEntries(
        this.tracks.map((track) => [
          track.id,
          { fader: track.fader, muted: track.muted, solo: track.solo, semitones: track.semitones },
        ]),
      ),
    };
  }

  /** Restaura una mezcla guardada; los valores fuera de rango se corrigen. */
  applyMix(mix: MixState | undefined): void {
    this.masterFader = finiteOr(mix?.masterFader, UNITY_FADER, clamp01);
    this.masterSemitones = finiteOr(mix?.masterSemitones, 0, clampSemitones);
    this.tempo = finiteOr(mix?.tempo, ORIGINAL_TEMPO, clampTempo);
    for (const track of this.tracks) {
      const saved = mix?.tracks?.[track.id];
      track.fader = finiteOr(saved?.fader, UNITY_FADER, clamp01);
      track.muted = saved?.muted === true;
      track.solo = saved?.solo === true;
      track.semitones = finiteOr(saved?.semitones, 0, clampSemitones);
    }
    this.master.gain.setTargetAtTime(faderToGain(this.masterFader), this.ctx.currentTime, RAMP);
    this.applyGains();
    this.retune();
  }

  resetMix(): void {
    this.applyMix(undefined);
  }

  /** Tras cambiar tono o tempo: prepara los procesadores que harán falta (también en pausa) y reprograma. */
  private retune(): void {
    for (const track of this.tracks) if (this.processed(track)) void this.ensureLane(track);
    this.update();
    this.commit();
  }

  /** Mute gana sobre solo; si alguna pista está en solo, solo suenan esas. */
  private isAudible(track: Track): boolean {
    if (track.muted) return false;
    const anySolo = this.tracks.some((t) => t.solo);
    return !anySolo || track.solo;
  }

  private applyGains(immediate = false): void {
    const now = this.ctx.currentTime;
    for (const track of this.tracks) {
      const target = this.isAudible(track) ? faderToGain(track.fader) : 0;
      if (immediate) track.gain.gain.value = target;
      // Rampa corta para que mute/solo no produzcan clics.
      else track.gain.gain.setTargetAtTime(target, now, RAMP);
    }
  }

  private effective(track: Track): number {
    return clampSemitones(track.semitones + this.masterSemitones, MAX_SEMITONES * 2);
  }

  /** Velocidad de reproducción; sin procesador, la original. */
  private rate(): number {
    return this.stretch === "ready" ? this.tempo / ORIGINAL_TEMPO : 1;
  }

  /** Si la pista tiene que sonar por el procesador. */
  private processed(track: Track): boolean {
    return this.stretch === "ready" && (this.tempo !== ORIGINAL_TEMPO || this.effective(track) !== 0);
  }

  private ensureLane(track: Track): Promise<StretchLane | null> {
    if (track.lane) return Promise.resolve(track.lane);
    if (this.stretch !== "ready") return Promise.resolve(null);
    track.laneRequest ??= (async () => {
      const node = this.spareNode ?? (await createStretchNode(this.ctx));
      this.spareNode = null;
      if (this.disposed) return null;
      node.connect(track.wetGain);
      track.lane = new StretchLane(node, track.buffer);
      return track.lane;
    })().catch((error: unknown) => {
      // Sin procesador no hay tono ni tempo: todo vuelve al original y los controles se desactivan.
      console.warn(`No se pudo preparar el procesador de ${track.id}:`, error);
      this.stretch = "unavailable";
      this.update();
      this.commit();
      return null;
    });
    return track.laneRequest;
  }

  private track(id: StemId): Track {
    const track = this.tracks.find((t) => t.id === id);
    if (!track) throw new Error(`Pista desconocida: ${id}`);
    return track;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.halt();
    window.clearTimeout(this.suspendTimer);
    this.listeners.clear();
    void this.ctx.close();
  }
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function finiteOr(value: number | undefined, fallback: number, clamp: (value: number) => number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value) : fallback;
}

/** Máximo absoluto por tramo, mezclando canales. */
function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const peaks = new Float32Array(buckets);
  const bucketSize = buffer.length / buckets;

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let bucket = 0; bucket < buckets; bucket++) {
      const start = Math.floor(bucket * bucketSize);
      const end = Math.min(Math.floor((bucket + 1) * bucketSize), data.length);
      let peak = peaks[bucket];
      for (let i = start; i < end; i++) {
        const value = Math.abs(data[i]);
        if (value > peak) peak = value;
      }
      peaks[bucket] = peak;
    }
  }
  return peaks;
}

/**
 * Normaliza contra el pico global (no el de cada pista) para que una pista casi
 * vacía se vea casi vacía, y comprime con raíz cuadrada para que las partes
 * suaves sigan siendo visibles.
 */
function normalizePeaks(all: Float32Array[]): void {
  let max = 0;
  for (const peaks of all) for (const value of peaks) if (value > max) max = value;
  if (max === 0) return;
  for (const peaks of all) {
    for (let i = 0; i < peaks.length; i++) peaks[i] = Math.sqrt(peaks[i] / max);
  }
}
