#!/usr/bin/env node
// Comprueba que la versión de la app es coherente antes de compilar o publicar:
//   · package.json, package-lock.json, src-tauri/Cargo.toml y Cargo.lock dicen lo mismo;
//   · CHANGELOG.md tiene la sección de esa versión, con fecha;
//   · con --tag v1.2.3, la etiqueta coincide con la versión.
//
//   node scripts/check-version.mjs [--tag v1.2.3]
//
// En GitHub Actions deja la versión y sus novedades del CHANGELOG en las salidas
// `version` y `notes` del paso (las usa .github/workflows/release.yml).

import { appendFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(join(root, file), "utf8").then((text) => text.replace(/\r\n/g, "\n"));

const pkg = JSON.parse(await read("package.json"));
const lock = JSON.parse(await read("package-lock.json"));
const cargo = await read("src-tauri/Cargo.toml");
const cargoLock = await read("src-tauri/Cargo.lock");
const changelog = await read("CHANGELOG.md");

const version = pkg.version;
const errors = [];

if (!/^\d+\.\d+\.\d+$/.test(version)) errors.push(`package.json: «${version}» no es mayor.menor.parche.`);

const found = {
  "package-lock.json": lock.version,
  "package-lock.json (packages[\"\"])": lock.packages?.[""]?.version,
  "src-tauri/Cargo.toml": cargo.match(/^version = "([^"]+)"/m)?.[1],
  "src-tauri/Cargo.lock": cargoLock.match(/\[\[package\]\]\nname = "audioextract"\nversion = "([^"]+)"/)?.[1],
};
for (const [file, value] of Object.entries(found)) {
  if (value !== version) errors.push(`${file} dice ${value ?? "(nada)"} y package.json ${version}.`);
}

const escaped = version.replace(/\./g, "\\.");
const section = changelog.match(
  new RegExp(`^## \\[${escaped}\\] — \\d{4}-\\d{2}-\\d{2}\\n([\\s\\S]*?)(?=^## \\[|^\\[[^\\]]+\\]: |(?![\\s\\S]))`, "m"),
);
if (!section) errors.push(`CHANGELOG.md no tiene la sección «## [${version}] — AAAA-MM-DD».`);

const tagIndex = process.argv.indexOf("--tag");
if (tagIndex !== -1) {
  const tag = process.argv[tagIndex + 1];
  if (tag !== `v${version}`) errors.push(`La etiqueta ${tag} no coincide con la versión de la app (v${version}).`);
}

if (errors.length) {
  console.error(`\nVersión incoherente:\n  · ${errors.join("\n  · ")}\n\nUsa npm run version:set (ver docs/ACTUALIZACIONES.md).\n`);
  process.exit(1);
}

const notes = section[1].trim();
if (process.env.GITHUB_OUTPUT) {
  const delimiter = `NOTAS_${Date.now()}`;
  await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\nnotes<<${delimiter}\n${notes}\n${delimiter}\n`);
}
console.log(`Versión ${version} coherente en package.json, package-lock, Cargo.toml, Cargo.lock y CHANGELOG.`);
