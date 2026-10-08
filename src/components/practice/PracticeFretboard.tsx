import { useEffect, useRef, type PointerEvent } from "react";
import type { MultitrackEngine } from "../../lib/audio-engine";
import type { BassTab } from "../../lib/bass-tab";
import { FretboardRenderer } from "./fretboard-renderer";

interface PracticeFretboardProps {
  engine: MultitrackEngine;
  tab: BassTab;
  /** Descripción para lectores de pantalla («Bajo de 4 cuerdas…»). */
  label: string;
}

/**
 * Mástil y tablatura en un <canvas>. Mientras suena, cada frame lee la posición que
 * sale por los altavoces (`audiblePosition`) y pinta las notas de ese instante; en
 * pausa no hay bucle: se repinta solo cuando el motor avisa de un cambio (saltar,
 * reproducir, pausar). Nada de esto pasa por el estado de React.
 */
export function PracticeFretboard({ engine, tab, label }: PracticeFretboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FretboardRenderer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new FretboardRenderer(canvas, tab);
    rendererRef.current = renderer;

    let frame = 0;
    const paint = () => renderer.draw(engine.audiblePosition * 1000, engine.getSnapshot().playing);
    const loop = () => {
      paint();
      frame = requestAnimationFrame(loop);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(engine.getSnapshot().playing ? loop : paint);
    };

    const observer = new ResizeObserver(() => {
      renderer.resize();
      paint();
    });
    observer.observe(canvas);
    sync();
    const unsubscribe = engine.subscribe(sync);
    return () => {
      unsubscribe();
      observer.disconnect();
      cancelAnimationFrame(frame);
      rendererRef.current = null;
    };
  }, [engine, tab]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  // Clic en la tablatura: salta a ese momento de la canción.
  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const { x, y } = point(event);
    const seconds = rendererRef.current?.timeAt(x, y);
    if (seconds != null) engine.seek(seconds);
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const { y } = point(event);
    event.currentTarget.style.cursor = rendererRef.current?.inTab(y) ? "pointer" : "default";
  };

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 size-full touch-none"
      role="img"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    />
  );
}
