import type { Channel } from "@tauri-apps/api/core";
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { encodeWav } from "../lib/wav";
import {
  STEM_ORDER,
  type EngineStatus,
  type LibraryItem,
  type MixState,
  type OptionalStem,
  type SeparationEvent,
  type SeparationRequest,
  type SetupEvent,
  type SetupPlan,
  type StemId,
} from "../types";
import { DEMO_SAMPLE_RATE, synthBassNotes, synthStem } from "./synth";

/*
 * Modo demo (`npm run dev:web`): la interfaz completa en un navegador, sin Rust
 * ni motor. Simula el backend en memoria y sintetiza las pistas. Parámetros de la URL:
 *   ?empty          biblioteca vacía (primer arranque)
 *   ?engine=down    motor no disponible · ?engine=old  motor v1 · ?engine=cpu  sin GPU
 *   ?engine=setup   motor sin instalar (también setup-cpu, setup-error, setup-space y update)
 *   ?update         hay una actualización disponible
 *   ?tab=error      la transcripción del bajo (modo práctica) falla
 */

const params = new URLSearchParams(location.search);
const LIBRARY_DIR = "C:\\Users\\demo\\Music\\AudioExtract";
const HOUR = 3_600_000;

function entry(
  title: string,
  stems: StemId[],
  quality: "fast" | "best",
  hoursAgo: number,
  durationSec: number,
  extra: Partial<LibraryItem> = {},
): LibraryItem {
  const dir = `${LIBRARY_DIR}\\${title}`;
  return {
    id: title,
    dir,
    title,
    sourceName: `${title}.mp3`,
    createdAt: Date.now() - hoursAgo * HOUR,
    durationSec,
    stems,
    quality,
    models: quality === "best" ? ["bs_roformer_sw", ...(stems.includes("wind") ? ["uvr_wind"] : [])] : ["htdemucs"],
    device: "cuda",
    deviceName: "NVIDIA GeForce RTX 3060",
    elapsedMs: durationSec * 700,
    files: stems.map((id) => ({ id, path: `${dir}\\${id}.wav` })),
    sizeBytes: durationSec * 176_400 * stems.length,
    missing: [],
    ...extra,
  };
}

const ALL = [...STEM_ORDER];
const library: LibraryItem[] = params.has("empty")
  ? []
  : [
      entry("Luces de neón", ALL, "best", 0.4, 52, {
        mix: {
          version: 1,
          masterFader: 0.75,
          masterSemitones: -2,
          tracks: { vocals: { fader: 0.75, muted: true, solo: false, semitones: 0 } },
        },
      }),
      entry("Ritmo de la calle", ["vocals", "drums", "bass", "other"], "fast", 26, 44),
      entry("Balada para piano", ["vocals", "drums", "bass", "piano", "other"], "best", 80, 38),
      entry("Big band en directo", ["vocals", "drums", "bass", "piano", "wind", "other"], "best", 290, 60),
      entry("Maqueta del local (2019)", ["vocals", "drums", "bass", "guitar", "other"], "fast", 24 * 210, 47, {
        missing: ["guitar"],
        device: "cpu",
        deviceName: null,
      }),
    ];

const engineParam = params.get("engine") ?? "";
let engineInstalled = !engineParam.startsWith("setup") && engineParam !== "update";
let setupCancelled = false;
let setupFailures = engineParam === "setup-error" ? 1 : 0;
const GB = 1024 ** 3;

function setupPlan(): SetupPlan {
  const cpu = engineParam === "setup-cpu";
  return {
    hardware: {
      os: "windows",
      arch: "x86_64",
      cpuThreads: 12,
      memoryBytes: (cpu ? 8 : 32) * GB,
      gpus: cpu
        ? []
        : [{ name: "NVIDIA GeForce RTX 3060", memoryBytes: 12 * GB, driver: "581.29", computeCapability: "8.6" }],
    },
    variant: cpu ? "windows-cpu" : "windows-cuda",
    accelerator: cpu ? "cpu" : "cuda",
    reason: cpu ? "No hay una GPU NVIDIA: separará con el procesador, más despacio." : "Separará con la GPU (CUDA 12.8).",
    notes: cpu ? ["Con menos de 8 GB de memoria, la calidad máxima puede quedarse sin memoria: usa la rápida."] : [],
    downloadBytes: (cpu ? 1.79 : 4.44) * GB,
    installedBytes: (cpu ? 1.95 : 5.89) * GB,
    requiredBytes: (cpu ? 5.5 : 9.4) * GB,
    freeBytes: (engineParam === "setup-space" ? 6.2 : 43.7) * GB,
    installed:
      engineInstalled || engineParam === "update"
        ? { variant: "windows-cuda", models: [], installedAt: Date.now() - 86_400_000, appVersion: "1.0.0" }
        : null,
    upToDate: engineInstalled,
    dir: `${LIBRARY_DIR.replace("Music\\AudioExtract", "AppData\\Local\\com.audioextract.desktop\\engine")}`,
  };
}

async function installEngine(channel: Channel<SetupEvent>): Promise<EngineStatus> {
  setupCancelled = false;
  const send = (event: SetupEvent) => channel.onmessage(event);
  const update = engineParam === "update";
  const steps: [SetupEvent & { event: "step" }, number, number | null][] = [
    [{ event: "step", data: { step: "python" } }, 8, 0.07 * GB],
    [{ event: "step", data: { step: "packages" } }, update ? 10 : 40, update ? null : 7.45 * GB],
    [{ event: "step", data: { step: "ffmpeg" } }, 2, null],
    [{ event: "step", data: { step: "models" } }, update ? 3 : 20, 0.99 * GB],
    [{ event: "step", data: { step: "check" } }, 10, null],
  ];
  const weights = [2, update ? 8 : 77, 1, update ? 3 : 18, 2];
  const all = weights.reduce((a, b) => a + b, 0);
  let before = 0;
  for (const [index, [step, ticks, total]] of steps.entries()) {
    send(step);
    for (let tick = 0; tick <= ticks; tick++) {
      if (setupCancelled) throw { kind: "cancelled", message: "Operación cancelada" };
      if (index === 1 && tick === Math.floor(ticks * 0.4) && setupFailures > 0) {
        setupFailures--;
        throw {
          kind: "setup",
          message:
            "No se pudo descargar. Comprueba la conexión a internet y vuelve a intentarlo: lo ya descargado no se repite.\n\n" +
            "error: Failed to fetch: `https://download.pytorch.org/whl/cu128/torch-2.8.0%2Bcu128-cp312-cp312-win_amd64.whl`\n" +
            "  Caused by: error sending request",
        };
      }
      const fraction = Math.min(tick / ticks, 0.97);
      send({
        event: "progress",
        data: {
          percent: ((before + weights[index] * fraction) / all) * 100,
          bytes: total === null ? null : total * fraction,
          total,
        },
      });
      await wait(150);
    }
    before += weights[index];
  }
  send({ event: "progress", data: { percent: 100, bytes: null, total: null } });
  engineInstalled = true;
  return engineStatus();
}

function engineStatus(): EngineStatus {
  const base: EngineStatus = {
    ready: true,
    kind: "app",
    needsSetup: false,
    device: "cuda",
    deviceName: "NVIDIA GeForce RTX 3060",
    protocol: 2,
    version: "2.0.0",
    qualities: { fast: ["guitar", "piano"], best: ["guitar", "piano"] },
    wind: true,
    transcription: true,
    problem: null,
    notes: ["Python 3.12.14 · torch 2.8.0+cu128 · CUDA 12.8"],
    checkedAt: Date.now(),
  };
  if (!engineInstalled) {
    return {
      ...base,
      ready: false,
      needsSetup: true,
      device: null,
      deviceName: null,
      protocol: 0,
      version: null,
      qualities: {},
      wind: false,
      transcription: false,
      notes: [],
      problem: engineParam === "update"
        ? "El motor de separación se está poniendo al día para esta versión de la app."
        : "El motor de separación todavía no está instalado en este equipo.",
    };
  }
  switch (engineParam) {
    case "down":
      return {
        ...base,
        ready: false,
        device: null,
        deviceName: null,
        protocol: 0,
        qualities: {},
        wind: false,
        transcription: false,
        notes: [],
        problem: "El motor no respondió a tiempo. Comprueba de nuevo en unos segundos.",
      };
    case "old":
      return {
        ...base,
        protocol: 1,
        version: null,
        qualities: { fast: [] },
        wind: false,
        transcription: false,
        notes: ["El motor instalado es de una versión anterior: solo separa voces, batería, bajo y otros."],
      };
    case "cpu":
      return {
        ...base,
        device: "cpu",
        deviceName: "x86_64",
        notes: [],
      };
    default:
      return base;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let cancelled = false;
let firstCheck = true;
/** Extracciones cuyo bajo ya se «transcribió»: como `bass.notes.json`, la segunda vez es inmediata. */
const transcribed = new Set<string>();

async function generateBassTab(id: string) {
  const item = library.find((candidate) => candidate.id === id);
  if (!item || !item.stems.includes("bass") || item.missing.includes("bass")) {
    throw { kind: "library", message: `«${id}» no tiene pista de bajo en el disco: no se puede abrir el modo práctica.` };
  }
  if (!transcribed.has(id)) {
    await wait(2200);
    if (params.get("tab") === "error") {
      throw {
        kind: "environment",
        message: "El motor terminó con error (código 1):\nRuntimeError: no se pudo cargar el modelo de Basic Pitch",
      };
    }
    transcribed.add(id);
  }
  return synthBassNotes(item.durationSec);
}

async function separate(inputPath: string, request: SeparationRequest, channel: Channel<SeparationEvent>): Promise<LibraryItem> {
  cancelled = false;
  const send = (event: SeparationEvent) => channel.onmessage(event);
  const stages: [SeparationEvent & { event: "progress" }, number][] = [];
  const hasWind = request.instruments.includes("wind");
  const plan: [string, number, number][] = [
    ["loading_audio", 0, 4],
    ["loading_model", 4, 8],
    ["separating", 8, hasWind ? 72 : 96],
    ...(hasWind ? ([["wind", 72, 96]] as [string, number, number][]) : []),
    ["saving", 96, 100],
  ];
  for (const [stage, from, to] of plan) {
    for (let percent = from; percent <= to; percent += 2) {
      stages.push([{ event: "progress", data: { percent, stage: stage as never } }, 90]);
    }
  }
  await wait(500);
  send({ event: "device", data: { device: "cuda", name: "NVIDIA GeForce RTX 3060" } });
  for (const [event, delay] of stages) {
    if (cancelled) throw { kind: "cancelled", message: "Separación cancelada" };
    send(event);
    await wait(delay);
  }
  const title = (inputPath.split(/[\\/]/).pop() ?? "Canción").replace(/\.[^.]+$/, "");
  const stems: StemId[] = STEM_ORDER.filter(
    (id) => ["vocals", "drums", "bass", "other"].includes(id) || request.instruments.includes(id as OptionalStem),
  );
  const created = entry(library.some((item) => item.id === title) ? `${title} (2)` : title, stems, request.quality, 0, 42);
  library.unshift(created);
  return created;
}

// Pistas sintéticas servidas en lugar del protocolo `asset:`.
const wavCache = new Map<string, Uint8Array>();
function stemBytes(path: string): Uint8Array | null {
  const item = library.find((candidate) => path.startsWith(candidate.dir + "\\"));
  const stem = path.split("\\").pop()?.replace(".wav", "") as StemId | undefined;
  if (!item || !stem || !STEM_ORDER.includes(stem)) return null;
  const key = `${stem}-${item.durationSec}`;
  if (!wavCache.has(key)) wavCache.set(key, encodeWav(synthStem(stem, item.durationSec), DEMO_SAMPLE_RATE, 16));
  return wavCache.get(key)!;
}

export function installMocks(): void {
  mockWindows("main");
  mockConvertFileSrc("windows");

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("http://asset.localhost/")) {
      const bytes = stemBytes(decodeURIComponent(url.slice("http://asset.localhost/".length)));
      await wait(150);
      return bytes
        ? new Response(bytes.slice().buffer, { headers: { "content-type": "audio/wav" } })
        : new Response(null, { status: 404 });
    }
    return realFetch(input, init);
  };

  mockIPC(
    async (cmd, raw) => {
      const args = (raw ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "app_info":
          return { version: "1.0.0", updater: true };
        case "engine_status":
          if (firstCheck) {
            firstCheck = false;
            await wait(900);
          } else if (args.refresh) {
            await wait(1200);
          }
          return engineStatus();
        case "engine_setup_plan":
          await wait(400);
          return setupPlan();
        case "engine_setup_start":
          return installEngine(args.onEvent as Channel<SetupEvent>);
        case "engine_setup_cancel":
          setupCancelled = true;
          return true;
        case "library_list":
          return { dir: LIBRARY_DIR, isDefault: true, items: [...library] };
        case "library_rename": {
          const item = library.find((candidate) => candidate.id === args.id)!;
          item.title = String(args.title);
          return { ...item };
        }
        case "library_delete":
          await wait(300);
          library.splice(
            library.findIndex((item) => item.id === args.id),
            1,
          );
          return null;
        case "library_save_mix": {
          const item = library.find((candidate) => candidate.id === args.id);
          if (item) item.mix = args.mix as MixState;
          return null;
        }
        case "library_choose_dir":
        case "library_open":
          return null;
        case "library_reset_dir":
          return { dir: LIBRARY_DIR, isDefault: true, items: [...library] };
        case "separate":
          return separate(String(args.inputPath), args.request as SeparationRequest, args.onEvent as Channel<SeparationEvent>);
        case "cancel_separation":
          cancelled = true;
          return true;
        case "generate_bass_tab":
          return generateBassTab(String(args.id));
        case "export_choose_folder":
          return "C:\\Users\\demo\\Desktop";
        case "export_choose_file":
          return `C:\\Users\\demo\\Desktop\\${String(args.suggestedName)}.${String(args.extension)}`;
        case "export_write":
          await wait(200);
          console.info("[demo] export_write", (raw as Uint8Array).byteLength, "bytes");
          return null;
        case "plugin:dialog|open":
          return "C:\\Users\\demo\\Music\\Nueva canción.mp3";
        case "plugin:opener|reveal_item_in_dir":
          return null;
        case "plugin:updater|check":
          return params.has("update")
            ? {
                rid: 1,
                currentVersion: "1.0.0",
                version: "1.1.0",
                date: new Date().toISOString(),
                body: "· Separación por lotes.\n· Bucle A–B para repetir un pasaje.",
                rawJson: {},
              }
            : null;
        case "plugin:updater|download_and_install": {
          const channel = args.onEvent as Channel<unknown>;
          channel.onmessage({ event: "Started", data: { contentLength: 9_000_000 } });
          for (let i = 0; i < 30; i++) {
            await wait(80);
            channel.onmessage({ event: "Progress", data: { chunkLength: 300_000 } });
          }
          channel.onmessage({ event: "Finished" });
          await wait(1500);
          return null;
        }
        case "plugin:process|restart":
          location.reload();
          return null;
        default:
          console.warn("[demo] comando sin simular:", cmd, args);
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}
