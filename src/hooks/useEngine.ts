import { useEffect, useSyncExternalStore } from "react";
import type { EngineSnapshot, MultitrackEngine } from "../lib/audio-engine";

/** Estado de mezcla y transporte del motor, suscrito sin re-render por frame. */
export function useEngineState(engine: MultitrackEngine): EngineSnapshot {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot);
}

/** Ejecuta `callback` en cada frame de pantalla mientras el componente esté montado. */
export function useAnimationFrame(callback: () => void): void {
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      callback();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [callback]);
}
