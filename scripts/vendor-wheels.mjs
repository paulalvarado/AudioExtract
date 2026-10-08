#!/usr/bin/env node
// Prepara python/wheels/: las ruedas de Python puro que el instalador lleva consigo para el motor.
//
// La app instala junto a sus scripts del motor (separate.py, transcribe.py…) las librerías ligeras que
// esos scripts necesitan y que una imagen del motor anterior no trae (hoy, la transcripción del bajo:
// basic-pitch y sus dependencias). El motor las usa sin red ni reconstrucción: así basta con instalar
// el .exe de una versión nueva. Ver docs/ARQUITECTURA.md («Scripts del motor»).
//
//   npm run vendor:wheels     (también se ejecuta solo antes de `npm run build` y `npm run dev`)
//
// Versiones fijas y comprobadas por SHA-256. Si la rueda ya está y coincide, no se descarga.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WHEELS = [
  {
    file: "basic_pitch-0.4.0-py2.py3-none-any.whl",
    sha256: "738adb503aae7fdfc7d1e1511aa0ce35052315f260a19531ef4c356708425db0",
    url: "https://files.pythonhosted.org/packages/99/0e/3a36d22562daeb0ae3c78ac78da3f8dba96543c5576ed57d4acb8ddbab5b/basic_pitch-0.4.0-py2.py3-none-any.whl",
  },
  {
    file: "pretty_midi-0.2.11.post0-py3-none-any.whl",
    sha256: "a3e2321736245a9c92259716d85a4762f16b7bde2f591fb0dba95bdb6e793d8a",
    url: "https://files.pythonhosted.org/packages/db/4f/fae82739ec54708915e90772938ac2745f2084550223f94cbee175a24910/pretty_midi-0.2.11.post0-py3-none-any.whl",
  },
  {
    file: "mido-1.3.3-py3-none-any.whl",
    sha256: "01033c9b10b049e4436fca2762194ca839b09a4334091dd3c34e7f4ae674fd8a",
    url: "https://files.pythonhosted.org/packages/fd/28/45deb15c11859d2f10702b32e71de9328a9fa494f989626916db39a9617f/mido-1.3.3-py3-none-any.whl",
  },
  {
    file: "mir_eval-0.8.2-py3-none-any.whl",
    sha256: "114cda33d8e17408c170598e0b36ed0d71ff4a2fee8eaf9e165b58ecf1c87170",
    url: "https://files.pythonhosted.org/packages/1b/5a/69ce896a32ebc8c75deae00b1fba9837567405fa6ef37b377f2e85b856ae/mir_eval-0.8.2-py3-none-any.whl",
  },
  {
    file: "importlib_resources-7.1.0-py3-none-any.whl",
    sha256: "1bd7b48b4088eddb2cd16382150bb515af0bd2c70128194392725f82ad2c96a1",
    url: "https://files.pythonhosted.org/packages/8a/db/55a262f3606bebcae07cc14095338471ad7c0bbcaa37707e6f0ee49725b7/importlib_resources-7.1.0-py3-none-any.whl",
  },
  // Dependencias de las anteriores que casi cualquier entorno ya tiene; por si un Python local no.
  {
    file: "six-1.17.0-py2.py3-none-any.whl",
    sha256: "4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274",
    url: "https://files.pythonhosted.org/packages/b7/ce/149a00dd41f10bc29e5921b496af8b574d8413afcd5e30dfa0ed46c2cc5e/six-1.17.0-py2.py3-none-any.whl",
  },
  {
    file: "packaging-26.3-py3-none-any.whl",
    sha256: "d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c",
    url: "https://files.pythonhosted.org/packages/63/34/ba1c580383c9eada3711951fef0795c80b829a078d72188184bcab9dd527/packaging-26.3-py3-none-any.whl",
  },
];

const ATTEMPTS = 4;
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "python", "wheels");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function existing(path) {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function download({ url, sha256: expected, file }) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const actual = sha256(bytes);
      if (actual !== expected) throw new Error(`SHA-256 inesperado (${actual})`);
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) console.warn(`  ${file}: intento ${attempt} fallido (${error.message}); reintentando…`);
    }
  }
  throw new Error(`No se pudo descargar ${file}: ${lastError.message}`);
}

await mkdir(dir, { recursive: true });
let downloaded = 0;
for (const wheel of WHEELS) {
  const path = join(dir, wheel.file);
  const current = await existing(path);
  if (current && sha256(current) === wheel.sha256) continue;
  const bytes = await download(wheel);
  await writeFile(`${path}.tmp`, bytes);
  await rename(`${path}.tmp`, path);
  downloaded++;
}

// Fuera lo que no está en la lista (versiones anteriores): el instalador incluye todo *.whl de la carpeta.
const wanted = new Set(WHEELS.map((wheel) => wheel.file));
for (const name of await readdir(dir)) {
  if (!wanted.has(name)) await rm(join(dir, name), { force: true });
}

console.log(`Ruedas del motor listas en python/wheels (${WHEELS.length}${downloaded ? `, ${downloaded} descargadas` : ", ya estaban"}).`);
