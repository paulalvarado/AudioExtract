import { useCallback, useRef, type PointerEvent } from "react";
import type { MultitrackEngine } from "../lib/audio-engine";

/**
 * Clic o arrastre sobre una forma de onda para mover el cabezal. Mientras se
 * arrastra, `fraction` guarda la posición (0–1) y el audio salta al soltar.
 */
export function useScrub(engine: MultitrackEngine) {
  const fraction = useRef<number | null>(null);

  const at = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
  };

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    fraction.current = at(event);
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (fraction.current !== null) fraction.current = at(event);
  }, []);

  const onPointerUp = useCallback(() => {
    if (fraction.current === null) return;
    engine.seek(fraction.current * engine.duration);
    fraction.current = null;
  }, [engine]);

  const onPointerCancel = useCallback(() => {
    fraction.current = null;
  }, []);

  /** Fracción que hay que pintar ahora: la del arrastre o la de reproducción. */
  const current = useCallback(
    () => fraction.current ?? (engine.duration > 0 ? engine.position / engine.duration : 0),
    [engine],
  );

  return { current, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}
