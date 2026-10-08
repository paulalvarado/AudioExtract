// Estima el tempo de una canción fuera del hilo de la interfaz (~1 s con siete pistas).
import { estimateTempo, type TempoEstimate } from "./tempo-estimate";

export interface TempoRequest {
  /** Una señal por pista, preparada con `prepareSignal`. */
  signals: Float32Array[];
  sampleRate: number;
}

export type TempoResponse = { estimate: TempoEstimate | null } | { error: string };

// El proyecto compila con los tipos del DOM; esto es lo único del ámbito del worker que se usa.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<TempoRequest>) => void) | null;
  postMessage(message: TempoResponse): void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ estimate: estimateTempo(data.signals, data.sampleRate) });
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
