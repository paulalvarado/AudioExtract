#!/usr/bin/env node
// Cambia la versión de la app en todos los sitios donde vive:
//   package.json + package-lock.json (tauri.conf.json la lee de package.json)
//   src-tauri/Cargo.toml
//
//   npm run version:set -- 0.3.0
//
// El instalador compara esta versión con la instalada: una versión mayor se
// instala encima como actualización (ver docs/ACTUALIZACIONES.md).

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Uso: npm run version:set -- <mayor.menor.parche>   (p. ej. 0.3.0)");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function updateJson(file, change) {
  const path = join(root, file);
  const data = JSON.parse(await readFile(path, "utf8"));
  change(data);
  await writeFile(path, `${JSON.stringify(data, null, 2)}
`);
}

await updateJson("package.json", (data) => {
  data.version = version;
});
await updateJson("package-lock.json", (data) => {
  data.version = version;
  if (data.packages?.[""]) data.packages[""].version = version;
});

const cargoPath = join(root, "src-tauri", "Cargo.toml");
const cargo = await readFile(cargoPath, "utf8");
const updated = cargo.replace(/^version = "[^"]+"/m, `version = "${version}"`);
if (updated === cargo && !cargo.includes(`version = "${version}"`)) {
  throw new Error("No se encontró la línea `version = \"…\"` en src-tauri/Cargo.toml");
}
await writeFile(cargoPath, updated);

console.log(`
Versión ${version} aplicada. Siguientes pasos:
  1. Añade las novedades a CHANGELOG.md.
  2. git commit -am "Versión ${version}" && git tag v${version} && git push --follow-tags
     (el flujo de GitHub Actions publica el instalador y el latest.json del actualizador).`);
