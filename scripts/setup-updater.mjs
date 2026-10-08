#!/usr/bin/env node
// Prepara el actualizador integrado para un repositorio de GitHub:
//   1. Genera (una sola vez) el par de claves con el que se firman las actualizaciones,
//      FUERA del repositorio: ~/.tauri/audioextract.key (+ .pub).
//   2. Escribe la clave pública y la URL de latest.json en src-tauri/tauri.conf.json.
//   3. Explica qué secretos hay que añadir en GitHub para que el flujo de publicación firme.
//
//   npm run updater:setup -- --repo usuario/AudioExtract
//
// La clave privada es la identidad de tus actualizaciones: si se pierde, las
// instalaciones existentes no aceptarán versiones nuevas firmadas con otra.
// Si se filtra, cualquiera podría publicar «actualizaciones». Guárdala bien.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const repo = args[args.indexOf("--repo") + 1];
if (!args.includes("--repo") || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) {
  console.error("Uso: npm run updater:setup -- --repo <usuario>/<repositorio> [--key <ruta>]");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const keyPath = args.includes("--key") ? args[args.indexOf("--key") + 1] : join(homedir(), ".tauri", "audioextract.key");
const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "";

if (existsSync(keyPath)) {
  console.log(`Se reutiliza la clave existente: ${keyPath}`);
} else {
  await mkdir(dirname(keyPath), { recursive: true });
  // El CLI de Tauri se ejecuta con el propio Node: sin shell ni diferencias entre sistemas.
  const tauri = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
  execFileSync(process.execPath, [tauri, "signer", "generate", "--ci", "--write-keys", keyPath, ...(password ? ["--password", password] : [])], {
    stdio: "inherit",
  });
  console.log(`Claves creadas en ${keyPath} (.pub al lado).${password ? "" : " Sin contraseña."}`);
}

const publicKey = (await readFile(`${keyPath}.pub`, "utf8")).trim();
const configPath = join(root, "src-tauri", "tauri.conf.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
config.plugins ??= {};
config.plugins.updater = {
  ...config.plugins.updater,
  pubkey: publicKey,
  endpoints: [`https://github.com/${repo}/releases/latest/download/latest.json`],
};
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`
Actualizador configurado para https://github.com/${repo}
  · Clave pública y URL escritas en src-tauri/tauri.conf.json (se pueden subir a git).

Falta añadir en GitHub → Settings → Secrets and variables → Actions:
  · TAURI_SIGNING_PRIVATE_KEY           el contenido del archivo ${keyPath}
  · TAURI_SIGNING_PRIVATE_KEY_PASSWORD  ${password ? "la contraseña que usaste" : "vacío (la clave no tiene contraseña)"}

Haz una copia de seguridad de ${keyPath}: sin ella no podrás publicar actualizaciones
que acepten las instalaciones existentes.`);
