import { useEffect, useState } from "react";
import type { MultitrackEngine } from "../lib/audio-engine";
import { prepareSignal, type TempoEstimate } from "../lib/tempo-estimate";
import type { TempoRequest, TempoResponse } from "../lib/tempo.worker";
import type { LibraryItem } from "../types";

/**
 * Estimaciones por extracción, compartidas mientras la app está abierta: el dock y
 * el mezclador piden la misma, y volver a abrir una canción no repite el análisis.
 * La clave incluye la fecha de creación, como las notas del modo práctica.
 */
const estimates = new Map<string, Promise<TempoEstimate | null>>();

/** Tempo estimado de la extracción cargada; `null` mientras se calcula o si no tiene un pulso claro. */
export function useTempoEstimate(engine: MultitrackEngine, item: LibraryItem): TempoEstimate | null {
  const key = `${item.id}\n${item.createdAt}`;
  const [result, setResult] = useState<{ key: string; estimate: TempoEstimate | null } | null>(null);

  useEffect(() => {
    let current = true;
    void requestEstimate(key, engine).then((estimate) => {
      if (current) setResult({ key, estimate });
    });
    return () => {
      current = false;
    };
  }, [key, engine]);

  return result?.key === key ? result.estimate : null;
}

function requestEstimate(key: string, engine: MultitrackEngine): Promise<TempoEstimate | null> {
  let request = estimates.get(key);
  if (!request) {
    request = estimate([...engine.buffers.values()]).catch((error: unknown) => {
      console.warn("No se pudo estimar el tempo:", error);
      return null;
    });
    estimates.set(key, request);
  }
  return request;
}

async function estimate(buffers: AudioBuffer[]): Promise<TempoEstimate | null> {
  // Una pista por tarea (~10 ms cada una), para no frenar la interfaz.
  const signals: Float32Array[] = [];
  let sampleRate = 0;
  for (const buffer of buffers) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
    const prepared = prepareSignal(channels, buffer.sampleRate);
    signals.push(prepared.samples);
    sampleRate = prepared.sampleRate;
  }

  const worker = new Worker(new URL("../lib/tempo.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<TempoEstimate | null>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<TempoResponse>) => {
        if ("error" in data) reject(new Error(data.error));
        else resolve(data.estimate);
      };
      worker.onerror = (event) => reject(new Error(event.message));
      const request: TempoRequest = { signals, sampleRate };
      worker.postMessage(
        request,
        signals.map((signal) => signal.buffer),
      );
    });
  } finally {
    worker.terminate();
  }
}
