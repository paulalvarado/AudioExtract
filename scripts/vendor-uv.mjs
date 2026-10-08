#!/usr/bin/env node
// Prepara src-tauri/binaries/uv-<triple>[.exe]: el ejecutable de uv que el instalador lleva junto a la app.
//
// Con uv la app instala por sí misma el motor de separación en el equipo del usuario (Python, PyTorch
// según su GPU, Demucs, audio-separator…), sin Docker ni Python previos. Ver docs/ARQUITECTURA.md
// («Motor integrado»). Tauri lo incluye como binario externo (`externalBin` en tauri.conf.json).
//
//   npm run vendor:uv                         (para el sistema actual)
//   node scripts/vendor-uv.mjs --target x86_64-pc-windows-msvc
//
// También se ejecuta solo antes de `npm run build` y `npm run dev`. El destino sale de `--target`, de
// TAURI_ENV_TARGET_TRIPLE (lo define `tauri build --target …`) o del sistema actual. Versión fija y
// comprobada por SHA-256; si el binario ya está, no se descarga.

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, inflateRawSync } from "node:zlib";

const VERSION = "0.12.19";
const ARCHIVES = {
  "x86_64-pc-windows-msvc": {
    file: "uv-x86_64-pc-windows-msvc.zip",
    sha256: "6dbb02d79e419522f1c500f0adb1cddcff0cda7d59b0d66ea7f5e3b4a1b2f5f0",
    entry: "uv.exe",
  },
  "aarch64-apple-darwin": {
    file: "uv-aarch64-apple-darwin.tar.gz",
    sha256: "a9a8df1eedeb192f2e47e40e2faabfb387db4b850209118786d42f89dde3e0ba",
    entry: "uv-aarch64-apple-darwin/uv",
  },
};

const ATTEMPTS = 4;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function hostTriple() {
  if (process.platform === "win32" && process.arch === "x64") return "x86_64-pc-windows-msvc";
  if (process.platform === "darwin" && process.arch === "arm64") return "aarch64-apple-darwin";
  return `${process.arch}-${process.platform}`;
}

const flag = process.argv.indexOf("--target");
const target = (flag > 0 && process.argv[flag + 1]) || process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const archive = ARCHIVES[target];
if (!archive) {
  // La app solo se publica para Windows x64 y macOS Apple Silicon; en otro sistema se puede
  // compilar la interfaz, pero no el instalador.
  console.warn(`uv: sin binario para ${target}; el motor integrado solo se instala en Windows x64 y macOS Apple Silicon.`);
  process.exit(0);
}

const binary = join(root, "src-tauri", "binaries", `uv-${target}${target.includes("windows") ? ".exe" : ""}`);
const stamp = `${binary}.sha256`;

async function existing(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function download() {
  const url = `https://github.com/astral-sh/uv/releases/download/${VERSION}/${archive.file}`;
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const actual = sha256(bytes);
      if (actual !== archive.sha256) throw new Error(`SHA-256 inesperado (${actual})`);
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) console.warn(`  ${archive.file}: intento ${attempt} fallido (${error.message}); reintentando…`);
    }
  }
  throw new Error(`No se pudo descargar ${archive.file}: ${lastError.message}`);
}

/** Un archivo de un .zip, leyendo el directorio central (los tamaños de la cabecera local pueden faltar). */
function unzip(zip, name) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("ZIP sin directorio central");
  let offset = zip.readUInt32LE(end + 16);
  const count = zip.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    if (zip.toString("utf8", offset + 46, offset + 46 + nameLength) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressed);
      return method === 0 ? Buffer.from(data) : inflateRawSync(data);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${name} no está en el ZIP`);
}

/** Un archivo de un .tar.gz. */
function untar(gz, name) {
  const tar = gunzipSync(gz);
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const entry = tar.toString("utf8", offset, offset + 100).replace(/\0.*$/s, "");
    if (!entry) break;
    const size = parseInt(tar.toString("utf8", offset + 124, offset + 136).replace(/\0.*$/s, "").trim(), 8) || 0;
    if (entry === name) return Buffer.from(tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${name} no está en el TAR`);
}

if ((await existing(stamp))?.trim() === archive.sha256) {
  console.log(`uv ${VERSION} listo en ${binary} (ya estaba).`);
} else {
  const bytes = await download();
  const content = archive.file.endsWith(".zip") ? unzip(bytes, archive.entry) : untar(bytes, archive.entry);
  await mkdir(dirname(binary), { recursive: true });
  await writeFile(`${binary}.tmp`, content, { mode: 0o755 });
  await rename(`${binary}.tmp`, binary);
  await writeFile(stamp, `${archive.sha256}\n`);
  console.log(`uv ${VERSION} listo en ${binary} (${(content.length / 1e6).toFixed(1)} MB).`);
}
