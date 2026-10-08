import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isSupportedAudio } from "../lib/tauri";

export type DropHover = "none" | "valid" | "invalid";

/**
 * Arrastrar y soltar a nivel de ventana. Tauri intercepta el drop nativo y
 * entrega rutas absolutas, que es lo que necesita el comando de Rust (el
 * `File` del DOM no expone la ruta real).
 */
export function useFileDrop(
  enabled: boolean,
  onFile: (path: string) => void,
  onRejected: (paths: string[]) => void,
): DropHover {
  const [hover, setHover] = useState<DropHover>("none");
  const handlers = useRef({ enabled, onFile, onRejected });
  useEffect(() => {
    handlers.current = { enabled, onFile, onRejected };
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        const { enabled, onFile, onRejected } = handlers.current;
        switch (payload.type) {
          case "enter":
            if (enabled) setHover(payload.paths.some(isSupportedAudio) ? "valid" : "invalid");
            break;
          case "drop": {
            setHover("none");
            if (!enabled) break;
            const audio = payload.paths.find(isSupportedAudio);
            if (audio) onFile(audio);
            else onRejected(payload.paths);
            break;
          }
          case "leave":
            setHover("none");
            break;
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return enabled ? hover : "none";
}
