// Tipos de signalsmith-stretch (el paquete no trae declaraciones). API documentada en
// node_modules/signalsmith-stretch/README.md.
declare module "signalsmith-stretch" {
  export interface StretchSchedule {
    /** Tiempo del AudioContext en que se aplica el cambio. */
    output?: number;
    active?: boolean;
    /** Posición en el búfer de entrada (solo en modo búfer). */
    input?: number;
    rate?: number;
    semitones?: number;
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
    loopStart?: number;
    loopEnd?: number;
  }

  export interface StretchNode extends AudioWorkletNode {
    inputTime: number;
    schedule(change: StretchSchedule): Promise<StretchSchedule>;
    start(when?: number, offset?: number, duration?: number, rate?: number, semitones?: number): Promise<StretchSchedule>;
    stop(when?: number): Promise<StretchSchedule>;
    addBuffers(buffers: Float32Array[], transfer?: Transferable[]): Promise<number>;
    dropBuffers(toSeconds?: number): Promise<{ start: number; end: number }>;
    /** Latencia en segundos del modo «entrada en vivo». */
    latency(): Promise<number>;
    configure(config: {
      blockMs?: number;
      intervalMs?: number;
      splitComputation?: boolean;
      preset?: "default" | "cheaper";
    }): Promise<void>;
    setUpdateInterval(seconds: number, callback?: (inputTime: number) => void): Promise<void>;
  }

  export default function SignalsmithStretch(
    context: BaseAudioContext,
    options?: AudioWorkletNodeOptions,
  ): Promise<StretchNode>;
}
