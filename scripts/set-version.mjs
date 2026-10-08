#!/usr/bin/env node
// Publica una versión nueva en local: sube el número en todos los sitios donde
// vive y pasa la sección «Sin publicar» del CHANGELOG a esa versión con fecha.
//
//   npm run version:set -- patch      # 1.2.3 → 1.2.4  arreglos y ajustes
//   npm run version:set -- minor      # 1.2.3 → 1.3.0  funciones nuevas
//   npm run version:set -- major      # 1.2.3 → 2.0.0  cambios incompatibles
//   npm run version:set -- 1.3.0      # número explícito (debe ser mayor que el actual)
//
// Sitios: package.json, package-lock.json (tauri.conf.json la lee de package.json),
// src-tauri/Cargo.toml, src-tauri/Cargo.lock y CHANGELOG.md.
// La política de versiones está en docs/ACTUALIZACIONES.md.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const current = pkg.version.match(SEMVER)?.slice(1).map(Number);
if (!current) fail(`La versión actual de package.json («${pkg.version}») no es mayor.menor.parche.`);

const arg = process.argv[2] ?? "";
const [major, minor, patch] = current;
const next =
  arg === "major" ? [major + 1, 0, 0]
  : arg === "minor" ? [major, minor + 1, 0]
  : arg === "patch" ? [major, minor, patch + 1]
  : arg.match(SEMVER)?.slice(1).map(Number);
if (!next) fail("Uso: npm run version:set -- <patch | minor | major | mayor.menor.parche>");

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
if (compare(next, current) <= 0) {
  fail(
    `La versión nueva (${next.join(".")}) tiene que ser mayor que la actual (${pkg.version}): ` +
      "el instalador solo actualiza encima cuando la versión sube.",
  );
}
const version = next.join(".");
const bump = next[0] > major ? "major" : next[1] > minor ? "minor" : "patch";

// --- CHANGELOG: «Sin publicar» pasa a ser la versión nueva ---------------------
const changelogPath = join(root, "CHANGELOG.md");
const changelog = (await readFile(changelogPath, "utf8")).replace(/\r\n/g, "\n");
const unreleased = changelog.match(/^## \[Sin publicar\]\n([\s\S]*?)(?=^## \[|^\[Sin publicar\]:|(?![\s\S]))/m);
if (!unreleased) fail("CHANGELOG.md no tiene la sección «## [Sin publicar]».");
const notes = unreleased[1].trim();
if (!notes) fail("La sección «Sin publicar» del CHANGELOG está vacía: anota las novedades antes de publicar.");
if (bump === "patch" && /^### Añadido/m.test(notes)) {
  fail(`Hay novedades en «### Añadido»: una función nueva sube la versión menor (npm run version:set -- minor).`);
}
const previous = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1];

const today = new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD en la zona local
let updatedChangelog = changelog.replace(
  unreleased[0],
  `## [Sin publicar]\n\n## [${version}] — ${today}\n\n${notes}\n\n`,
);
// Enlaces del pie (Keep a Changelog): «Sin publicar» compara con la última etiqueta.
const link = updatedChangelog.match(/^\[Sin publicar\]: (https:\/\/github\.com\/[^/]+\/[^/\s]+)\/.*$/m);
if (link) {
  const base = link[1];
  const versionLink = previous
    ? `${base}/compare/v${previous}...v${version}`
    : `${base}/releases/tag/v${version}`;
  updatedChangelog = updatedChangelog.replace(
    link[0],
    `[Sin publicar]: ${base}/compare/v${version}...HEAD\n[${version}]: ${versionLink}`,
  );
}

// --- Número de versión ----------------------------------------------------------
async function updateJson(file, change) {
  const path = join(root, file);
  const data = JSON.parse(await readFile(path, "utf8"));
  change(data);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function updateText(file, pattern, replacement) {
  const path = join(root, file);
  const text = await readFile(path, "utf8");
  if (!pattern.test(text)) fail(`No se encontró la versión de la app en ${file}.`);
  await writeFile(path, text.replace(pattern, replacement));
}

await updateJson("package.json", (data) => {
  data.version = version;
});
await updateJson("package-lock.json", (data) => {
  data.version = version;
  if (data.packages?.[""]) data.packages[""].version = version;
});
await updateText("src-tauri/Cargo.toml", /^version = "[^"]+"/m, `version = "${version}"`);
await updateText(
  "src-tauri/Cargo.lock",
  /(\[\[package\]\]\r?\nname = "audioextract"\r?\nversion = )"[^"]+"/,
  `$1"${version}"`,
);
await writeFile(changelogPath, updatedChangelog);

console.log(`
Versión ${pkg.version} → ${version} (${bump}), con fecha ${today} en el CHANGELOG.

Siguientes pasos:
  1. npm run docker:app          → release/AudioExtract_${version}_x64-setup.exe para probarlo.
  2. git commit -am "Versión ${version}" && git tag -a v${version} -m "Versión ${version}"
  3. git push --follow-tags      → GitHub Actions publica la release con estas novedades.`);
