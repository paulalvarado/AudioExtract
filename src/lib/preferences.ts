import { OPTIONAL_STEMS, type OptionalStem, type Quality } from "../types";
import type { ExportFormat } from "./export";

/** Preferencias de la interfaz. Viven en este equipo (localStorage), no en la biblioteca. */
export interface Preferences {
  instruments: OptionalStem[];
  /** `null`: la app decide según el hardware (máxima con GPU, rápida con CPU). */
  quality: Quality | null;
  exportFormat: ExportFormat;
  exportApplyMix: boolean;
  checkUpdates: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  instruments: ["guitar", "piano"],
  quality: null,
  exportFormat: "wav24",
  exportApplyMix: true,
  checkUpdates: true,
};

const KEY = "audioextract.preferences.v1";

export function loadPreferences(): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Preferences> | null;
    if (!stored || typeof stored !== "object") return DEFAULT_PREFERENCES;
    return {
      instruments: Array.isArray(stored.instruments)
        ? OPTIONAL_STEMS.filter((stem) => stored.instruments!.includes(stem))
        : DEFAULT_PREFERENCES.instruments,
      quality: stored.quality === "fast" || stored.quality === "best" ? stored.quality : null,
      exportFormat:
        stored.exportFormat === "wav16" || stored.exportFormat === "mp3" || stored.exportFormat === "wav24"
          ? stored.exportFormat
          : DEFAULT_PREFERENCES.exportFormat,
      exportApplyMix: stored.exportApplyMix ?? DEFAULT_PREFERENCES.exportApplyMix,
      checkUpdates: stored.checkUpdates ?? DEFAULT_PREFERENCES.checkUpdates,
    };
  } catch {
    // Almacenamiento bloqueado o dañado: la app funciona con los valores por defecto.
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Sin almacenamiento: las preferencias duran lo que la sesión.
  }
}
