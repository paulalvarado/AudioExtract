export type StemId = "vocals" | "drums" | "bass" | "guitar" | "piano" | "wind" | "other";

/** Orden de presentación: voz, base rítmica, armonía, viento y el resto. */
export const STEM_ORDER: readonly StemId[] = ["vocals", "drums", "bass", "guitar", "piano", "wind", "other"];

/** Instrumentos que se pueden pedir; si no se piden, su sonido queda en «Otros». */
export type OptionalStem = "guitar" | "piano" | "wind";
export const OPTIONAL_STEMS: readonly OptionalStem[] = ["guitar", "piano", "wind"];

export const STEM_LABELS: Record<StemId, string> = {
  vocals: "Voces",
  drums: "Batería",
  bass: "Bajo",
  guitar: "Guitarra",
  piano: "Piano",
  wind: "Viento",
  other: "Otros",
};

export const STEM_HINTS: Record<OptionalStem, string> = {
  guitar: "Eléctrica y acústica",
  piano: "Piano y teclados",
  wind: "Trompetas, saxos, flautas… (metales y maderas juntos)",
};

export function isStemId(value: string): value is StemId {
  return (STEM_ORDER as readonly string[]).includes(value);
}

export type Quality = "fast" | "best";

export interface StemFile {
  id: StemId;
  path: string;
}

export interface MixTrack {
  fader: number;
  muted: boolean;
  solo: boolean;
  semitones: number;
}

/** Estado del mezclador que se guarda en la biblioteca con cada extracción. */
export interface MixState {
  version: 1;
  masterFader: number;
  masterSemitones: number;
  /** Tempo global en porcentaje de la velocidad original; falta en mezclas de antes de la 0.4. */
  tempo?: number;
  tracks: Partial<Record<StemId, MixTrack>>;
}

/** Una extracción de la biblioteca (ver `LibraryItem` en src-tauri/src/library.rs). */
export interface LibraryItem {
  id: string;
  dir: string;
  title: string;
  sourceName: string;
  createdAt: number;
  durationSec: number;
  stems: StemId[];
  quality: Quality;
  models: string[];
  device: string | null;
  deviceName: string | null;
  elapsedMs: number;
  mix?: MixState;
  files: StemFile[];
  sizeBytes: number;
  missing: StemId[];
}

export interface LibraryListing {
  dir: string;
  isDefault: boolean;
  items: LibraryItem[];
}

/** Resultado de `separate.py --check` (ver `EngineStatus` en src-tauri/src/engine.rs). */
export interface EngineStatus {
  ready: boolean;
  kind: "docker" | "python";
  device: string | null;
  deviceName: string | null;
  /** 1: motor antiguo (4 pistas). 2: instrumentos opcionales y calidades. */
  protocol: number;
  version: string | null;
  qualities: Partial<Record<Quality, OptionalStem[]>>;
  wind: boolean;
  /** Si el motor transcribe el bajo para el modo práctica (motor 2.1 o posterior). */
  transcription: boolean;
  problem: string | null;
  notes: string[];
  checkedAt: number;
}

export interface SeparationRequest {
  instruments: OptionalStem[];
  quality: Quality;
}

export type SeparationStage = "loading_model" | "loading_audio" | "separating" | "wind" | "saving";

/** Mensajes del `Channel` de progreso (ver `SeparationEvent` en src-tauri/src/engine.rs). */
export type SeparationEvent =
  | { event: "device"; data: { device: string; name: string | null } }
  | { event: "progress"; data: { percent: number; stage: SeparationStage } }
  | { event: "log"; data: { message: string } };

/** Nota del bajo transcrita por el motor (ver `NoteEvent` en src-tauri/src/engine.rs). */
export interface BassNote {
  /** Notación científica: «C#2» (MIDI 37); A4 = 440 Hz. */
  note: string;
  frequency: number;
  startTimeMs: number;
  endTimeMs: number;
}

export type AppErrorKind =
  | "input"
  | "busy"
  | "environment"
  | "engine"
  | "cancelled"
  | "library"
  | "export"
  | "internal";

export interface AppError {
  kind: AppErrorKind;
  message: string;
}

export interface AppInfo {
  version: string;
  /** Si esta compilación sabe dónde buscar actualizaciones. */
  updater: boolean;
}
