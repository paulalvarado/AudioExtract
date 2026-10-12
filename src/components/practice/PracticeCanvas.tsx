import { useEffect, useRef, type PointerEvent } from "react";
import type { MultitrackEngine } from "../../lib/audio-engine";
import type { LoopRange } from "../../types";

/** Lo que dibuja un modo práctica (mástil y tablatura, cascada y teclado). */
export interface PracticeRenderer {
  /** Ajusta el canvas a su tamaño en pantalla y repinta lo estático. */
  resize(): void;
  /**
   * Pinta el instante `ms` de la canción. `playing` activa las animaciones (al pausar o
   * saltar, todo se coloca de golpe); `loop` es el bucle encendido, si lo hay.
   */
  draw(ms: number, playing: boolean, loop: LoopRange | null): void;
  /** Segundo de la canción bajo un punto (px CSS) en el que se puede hacer clic para saltar, o `null`. */
  timeAt(x: number, y: number): number | null;
}

interface PracticeCanvasProps {
  engine: MultitrackEngine;
  /** Crea el dibujo; se vuelve a crear cuando cambia (por ejemplo, al transponer). */
  create: (canvas: HTMLCanvasElement) => PracticeRenderer;
  /** Descripción para lectores de pantalla. */
  label: string;
}

/**
 * Un <canvas> sincronizado con lo que suena. Mientras suena, cada frame lee la posición
 * que sale por los altavoces (`audiblePosition`) y pinta las notas de ese instante; en
 * pausa no hay bucle: se repinta solo cuando el motor avisa de un cambio (saltar,
 * reproducir, pausar, mover el bucle). Nada de esto pasa por el estado de React.
 */
export function PracticeCanvas({ engine, create, label }: PracticeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PracticeRenderer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = create(canvas);
    rendererRef.current = renderer;

    let frame = 0;
    const paint = () => {
      const { playing, loop, looping } = engine.getSnapshot();
      renderer.draw(engine.audiblePosition * 1000, playing, looping ? loop : null);
    };
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
  }, [engine, create]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  // Clic en la parte que avanza con la canción: salta a ese momento.
  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const { x, y } = point(event);
    const seconds = rendererRef.current?.timeAt(x, y);
    if (seconds != null) engine.seek(seconds);
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = point(event);
    event.currentTarget.style.cursor = rendererRef.current?.timeAt(x, y) != null ? "pointer" : "default";
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
