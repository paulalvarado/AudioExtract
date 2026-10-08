/**
 * WAV PCM entero, intercalado. Con 16 bits, una pista sin procesar vuelve a sus
 * muestras originales exactas (el decodificador divide entre 32768 y aquí se multiplica).
 */
export function encodeWav(channels: Float32Array[], sampleRate: number, bits: 16 | 24): Uint8Array {
  const frames = channels[0]?.length ?? 0;
  const count = channels.length;
  const bytesPerSample = bits / 8;
  const dataSize = frames * count * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * bytesPerSample, true);
  view.setUint16(32, count * bytesPerSample, true);
  view.setUint16(34, bits, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);

  const scale = bits === 16 ? 32768 : 8388608;
  const max = scale - 1;
  const bytes = new Uint8Array(buffer);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < count; channel++) {
      const value = Math.max(-scale, Math.min(max, Math.round(channels[channel][frame] * scale)));
      if (bits === 16) {
        view.setInt16(offset, value, true);
        offset += 2;
      } else {
        bytes[offset] = value & 0xff;
        bytes[offset + 1] = (value >> 8) & 0xff;
        bytes[offset + 2] = (value >> 16) & 0xff;
        offset += 3;
      }
    }
  }
  return bytes;
}
