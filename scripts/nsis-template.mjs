#!/usr/bin/env node
// Regenera src-tauri/windows/installer.nsi: la plantilla NSIS oficial de Tauri
// con un parche para que ejecutar un instalador más nuevo ACTUALICE la app
// instalada, sin preguntar ni lanzar el desinstalador (lo mismo que hace el
// actualizador interno al pasar /UPDATE).
//
//   npm run nsis:template
//
// Hay que ejecutarlo cada vez que se actualiza @tauri-apps/cli: la plantilla usa
// variables que cambian entre versiones del bundler.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "src-tauri", "windows", "installer.nsi");

const cli = JSON.parse(await readFile(join(root, "node_modules", "@tauri-apps", "cli", "package.json"), "utf8"));
const bundler = await bundlerVersion(cli.version);
const url = `https://raw.githubusercontent.com/tauri-apps/tauri/tauri-bundler-v${bundler}/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi`;
const upstream = await fetchText(url);

const patches = [
  {
    why: "una versión más nueva entra en modo actualización (sin página de reinstalar ni desinstalador)",
    find: "  ; Skip showing the page if passive\n",
    replace:
      "  ; AudioExtract: instalar encima una versión más nueva la actualiza sin\n" +
      "  ; preguntar, igual que el actualizador interno con /UPDATE (conserva los\n" +
      "  ; accesos directos y los datos; no ejecuta el desinstalador anterior).\n" +
      "  ${If} $R0 = 1\n" +
      "  ${AndIf} $WixMode <> 1\n" +
      "    StrCpy $UpdateMode 1\n" +
      "  ${EndIf}\n" +
      "\n" +
      "  ; Skip showing the page if passive\n",
  },
  {
    why: "en modo actualización no se muestra la página",
    find: "  ${If} $PassiveMode = 1\n    Call PageLeaveReinstall\n",
    replace: "  ${If} $PassiveMode = 1\n  ${OrIf} $UpdateMode = 1\n    Call PageLeaveReinstall\n",
  },
  {
    why: "al actualizar se reutiliza la carpeta de instalación sin preguntar",
    find: "; 5. Choose install directory page\n!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive\n",
    replace: "; 5. Choose install directory page\n!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassiveOrUpdate\n",
  },
  {
    why: "función para saltar páginas al actualizar",
    find: "Function SkipIfPassive\n",
    replace:
      "Function SkipIfPassiveOrUpdate\n" +
      "  ${IfThen} $PassiveMode = 1 ${|} Abort ${|}\n" +
      "  ${IfThen} $UpdateMode = 1 ${|} Abort ${|}\n" +
      "FunctionEnd\n" +
      "\n" +
      "Function SkipIfPassive\n",
  },
];

let patched = upstream.replace(/\r\n/g, "\n");
for (const patch of patches) {
  const count = patched.split(patch.find).length - 1;
  if (count !== 1) {
    throw new Error(
      `La plantilla de tauri-bundler ${bundler} cambió: no se encuentra exactamente una vez el ancla para «${patch.why}». Revisa el parche en scripts/nsis-template.mjs.`,
    );
  }
  patched = patched.replace(patch.find, patch.replace);
}

const header =
  `; Plantilla NSIS de tauri-bundler ${bundler} con el parche de AudioExtract.\n` +
  "; NO editar a mano: se genera con `npm run nsis:template` (scripts/nsis-template.mjs).\n" +
  `; Origen: ${url}\n`;

await mkdir(dirname(output), { recursive: true });
await writeFile(output, header + patched);
console.log(`Plantilla de tauri-bundler ${bundler} parcheada en ${output}`);

async function bundlerVersion(cliVersion) {
  const response = await fetch(`https://crates.io/api/v1/crates/tauri-cli/${cliVersion}/dependencies`, {
    headers: { "user-agent": "audioextract-nsis-template" },
  });
  if (!response.ok) throw new Error(`crates.io respondió ${response.status} al consultar tauri-cli ${cliVersion}`);
  const { dependencies } = await response.json();
  const requirement = dependencies.find((dependency) => dependency.crate_id === "tauri-bundler")?.req;
  const version = requirement?.match(/\d+\.\d+\.\d+/)?.[0];
  if (!version) throw new Error(`No se pudo determinar la versión de tauri-bundler de tauri-cli ${cliVersion}`);
  return version;
}

async function fetchText(address) {
  const response = await fetch(address);
  if (!response.ok) throw new Error(`No se pudo descargar ${address} (HTTP ${response.status})`);
  return response.text();
}
