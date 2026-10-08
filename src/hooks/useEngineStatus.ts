import { useCallback, useEffect, useState } from "react";
import { engineStatus, toAppError } from "../lib/tauri";
import type { EngineStatus, OptionalStem, Quality } from "../types";

/**
 * Estado del motor de separación. La primera comprobación la lanza el backend
 * al arrancar; `refresh` repite `--check` y `replace` usa el estado que devuelve
 * la instalación del motor integrado.
 */
export function useEngineStatus() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [checking, setChecking] = useState(true);

  const load = useCallback(async (force: boolean) => {
    setChecking(true);
    try {
      setStatus(await engineStatus(force));
    } catch (raw) {
      setStatus({
        ready: false,
        kind: "app",
        needsSetup: false,
        device: null,
        deviceName: null,
        protocol: 0,
        version: null,
        qualities: {},
        wind: false,
        transcription: false,
        problem: toAppError(raw).message,
        notes: [],
        checkedAt: Date.now(),
      });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);
  const replace = useCallback((next: EngineStatus) => setStatus(next), []);
  return { status, checking, refresh, replace };
}

/** Calidades que el motor puede usar, de mejor a más rápida. */
export function availableQualities(status: EngineStatus | null): Quality[] {
  if (!status?.ready) return [];
  return (["best", "fast"] as const).filter((quality) => status.qualities[quality] !== undefined);
}

/** Si un instrumento opcional se puede separar con la calidad elegida. */
export function supportsInstrument(status: EngineStatus | null, quality: Quality, stem: OptionalStem): boolean {
  if (!status?.ready) return false;
  if (stem === "wind") return status.wind;
  return status.qualities[quality]?.includes(stem) ?? false;
}
