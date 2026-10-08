import { useCallback, useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "current"; checkedAt: number }
  | { phase: "available"; version: string; notes: string | null }
  | { phase: "downloading"; version: string; received: number; total: number | null }
  | { phase: "installing"; version: string }
  | { phase: "error"; message: string };

/**
 * Actualizaciones desde GitHub Releases (o la URL configurada en tauri.conf.json).
 * En Windows se descarga el mismo instalador NSIS de la versión nueva y se
 * ejecuta en modo pasivo: la app se cierra, se actualiza y vuelve a abrirse.
 */
export function useUpdater(enabled: boolean, checkOnStart: boolean) {
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  const update = useRef<Update | null>(null);

  const checkNow = useCallback(async () => {
    if (!enabled) return;
    setState({ phase: "checking" });
    try {
      const found = await check();
      update.current = found;
      setState(
        found
          ? { phase: "available", version: found.version, notes: found.body ?? null }
          : { phase: "current", checkedAt: Date.now() },
      );
    } catch (error) {
      setState({ phase: "error", message: describe(error) });
    }
  }, [enabled]);

  const install = useCallback(async () => {
    const found = update.current;
    if (!found) return;
    let received = 0;
    let total: number | null = null;
    setState({ phase: "downloading", version: found.version, received, total });
    try {
      await found.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? null;
        if (event.event === "Progress") received += event.data.chunkLength;
        if (event.event === "Finished") {
          setState({ phase: "installing", version: found.version });
          return;
        }
        setState({ phase: "downloading", version: found.version, received, total });
      });
      // En Windows el instalador ya cerró la app; en macOS y Linux hay que reiniciarla.
      await relaunch();
    } catch (error) {
      setState({ phase: "error", message: describe(error) });
    }
  }, []);

  useEffect(() => {
    if (enabled && checkOnStart) void checkNow();
  }, [enabled, checkOnStart, checkNow]);

  return { state, checkNow, install };
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/network|dns|connect|timed? ?out|request/i.test(text)) {
    return "No se pudo conectar con el servidor de actualizaciones. Comprueba tu conexión.";
  }
  if (/signature/i.test(text)) {
    return "La actualización no tiene una firma válida y no se instalará.";
  }
  return text;
}
