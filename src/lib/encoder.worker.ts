// Codifica audio a WAV o MP3 fuera del hilo de la interfaz.
import { createEncoder } from "wasm-media-encoders";
// LAME compilado a WASM se sirve como archivo aparte (componente LGPL sustituible).
import mp3WasmUrl from "wasm-media-encoders/wasm/mp3?url";
import { encodeWav } from "./wav";

export type EncodeFormat = "wav16" | "wav24" | "mp3";

export interface EncodeRequest {
  id: number;
  format: EncodeFormat;
  sampleRate: number;
  channels: Float32Array[];
}

export type EncodeResponse = { id: number; bytes: Uint8Array } | { id: number; error: string };

const MP3_CHUNK = 1152 * 64;

// El proyecto compila con los tipos del DOM; esto es lo único del ámbito del worker que se usa.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<EncodeRequest>) => void) | null;
  postMessage(message: EncodeResponse, transfer?: Transferable[]): void;
};

scope.onmessage = async ({ data }) => {
  try {
    const bytes =
      data.format === "mp3"
        ? await encodeMp3(data.channels, data.sampleRate)
        : encodeWav(data.channels, data.sampleRate, data.format === "wav24" ? 24 : 16);
    scope.postMessage({ id: data.id, bytes }, [bytes.buffer]);
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};

/** MP3 CBR 320 kbps con LAME. */
async function encodeMp3(channels: Float32Array[], sampleRate: number): Promise<Uint8Array> {
  const encoder = await createEncoder("audio/mpeg", mp3WasmUrl);
  const stereo = channels.length > 1;
  encoder.configure({ sampleRate, channels: stereo ? 2 : 1, bitrate: 320 });

  const parts: Uint8Array[] = [];
  let total = 0;
  const keep = (chunk: Uint8Array) => {
    // El búfer devuelto pertenece al codificador: hay que copiarlo.
    parts.push(chunk.slice());
    total += chunk.length;
  };
  const frames = channels[0]?.length ?? 0;
  for (let start = 0; start < frames; start += MP3_CHUNK) {
    const end = Math.min(start + MP3_CHUNK, frames);
    keep(encoder.encode(channels.slice(0, stereo ? 2 : 1).map((channel) => channel.subarray(start, end))));
  }
  keep(encoder.finalize());

  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
