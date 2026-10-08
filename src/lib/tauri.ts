import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  isStemId,
  type AppError,
  type AppInfo,
  type BassNote,
  type EngineStatus,
  type EngineVariant,
  type LibraryItem,
  type LibraryListing,
  type MixState,
  type SeparationEvent,
  type SeparationRequest,
  type SetupEvent,
  type SetupPlan,
} from "../types";

// Puente tipado con los comandos de src-tauri/src/commands.rs.

export function engineStatus(refresh = false): Promise<EngineStatus> {
  return invoke<EngineStatus>("engine_status", { refresh });
}

/** Equipo detectado y variante del motor integrado que le corresponde. */
export function engineSetupPlan(): Promise<SetupPlan> {
  return invoke<SetupPlan>("engine_setup_plan");
}

/** Instala o pone al día el motor integrado; devuelve su estado al terminar. */
export function engineSetupStart(variant: EngineVariant, onEvent: (event: SetupEvent) => void): Promise<EngineStatus> {
  const channel = new Channel<SetupEvent>();
  channel.onmessage = onEvent;
  return invoke<EngineStatus>("engine_setup_start", { variant, onEvent: channel });
}

export function engineSetupCancel(): Promise<boolean> {
  return invoke<boolean>("engine_setup_cancel");
}

/**
 * Separa una canción y la guarda en la biblioteca. `onEvent` recibe
 * dispositivo, progreso y logs en tiempo real.
 */
export async function separate(
  inputPath: string,
  request: SeparationRequest,
  onEvent: (event: SeparationEvent) => void,
): Promise<LibraryItem> {
  const channel = new Channel<SeparationEvent>();
  channel.onmessage = onEvent;
  return normalizeItem(await invoke<LibraryItem>("separate", { inputPath, request, onEvent: channel }));
}

export function cancelSeparation(): Promise<boolean> {
  return invoke<boolean>("cancel_separation");
}

/**
 * Notas del bajo de una extracción para el modo práctica, en orden de inicio. La
 * primera vez el motor las transcribe (unos segundos); después salen de la biblioteca.
 */
export function generateBassTab(id: string): Promise<BassNote[]> {
  return invoke<BassNote[]>("generate_bass_tab", { id });
}

export async function libraryList(): Promise<LibraryListing> {
  return normalizeListing(await invoke<LibraryListing>("library_list"));
}

export async function libraryRename(id: string, title: string): Promise<LibraryItem> {
  return normalizeItem(await invoke<LibraryItem>("library_rename", { id, title }));
}

export function libraryDelete(id: string, permanent = false): Promise<void> {
  return invoke("library_delete", { id, permanent });
}

export function librarySaveMix(id: string, mix: MixState): Promise<void> {
  return invoke("library_save_mix", { id, mix });
}

/** Abre un selector de carpeta; `null` si se cancela. */
export async function libraryChooseDir(): Promise<LibraryListing | null> {
  const listing = await invoke<LibraryListing | null>("library_choose_dir");
  return listing && normalizeListing(listing);
}

export async function libraryResetDir(): Promise<LibraryListing> {
  return normalizeListing(await invoke<LibraryListing>("library_reset_dir"));
}

/** Abre la carpeta de la biblioteca en el explorador de archivos. */
export function libraryOpen(): Promise<void> {
  return invoke("library_open");
}

export function exportChooseFolder(): Promise<string | null> {
  return invoke<string | null>("export_choose_folder");
}

export function exportChooseFile(suggestedName: string, extension: "wav" | "mp3"): Promise<string | null> {
  return invoke<string | null>("export_choose_file", { suggestedName, extension });
}

/** Escribe un archivo exportado; los bytes viajan como cuerpo binario, sin JSON. */
export function exportWrite(path: string, bytes: Uint8Array): Promise<void> {
  return invoke("export_write", bytes, { headers: { "x-export-path": encodeURIComponent(path) } });
}

export function appInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
}

/** Lee una pista de la biblioteca a través del protocolo `asset:`. */
export async function fetchStem(path: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(convertFileSrc(path), { signal });
  if (!response.ok) {
    throw new Error(`No se pudo leer ${fileName(path)} (HTTP ${response.status})`);
  }
  return response.arrayBuffer();
}

export function toAppError(error: unknown): AppError {
  if (error && typeof error === "object" && "kind" in error && "message" in error) {
    return error as AppError;
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: "internal", message };
}

export const AUDIO_EXTENSIONS = ["mp3", "wav", "flac", "aiff", "aif", "ogg", "m4a"] as const;
export const AUDIO_FORMATS_LABEL = "MP3, WAV, FLAC, AIFF, OGG o M4A";

export function isSupportedAudio(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => ext === extension);
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Une rutas con el separador que ya usa `dir` (\ en Windows, / en el resto). */
export function joinPath(dir: string, ...parts: string[]): string {
  const separator = dir.includes("\\") ? "\\" : "/";
  return [dir.replace(/[\\/]+$/, ""), ...parts].join(separator);
}

/** Nombre de archivo válido en cualquier sistema a partir de un texto libre. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return cleaned.slice(0, 120) || "AudioExtract";
}

// El backend devuelve ids de pista como texto: se descartan los que esta versión no conoce.
function normalizeItem(item: LibraryItem): LibraryItem {
  return {
    ...item,
    stems: item.stems.filter(isStemId),
    files: item.files.filter((file) => isStemId(file.id)),
    missing: item.missing.filter(isStemId),
  };
}

function normalizeListing(listing: LibraryListing): LibraryListing {
  return { ...listing, items: listing.items.map(normalizeItem) };
}
