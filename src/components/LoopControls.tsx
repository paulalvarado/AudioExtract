import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { MIN_LOOP_SECONDS, type MultitrackEngine } from "../lib/audio-engine";
import { formatTimePrecise } from "../lib/format";
import { toggleLoop } from "../lib/loop";
import type { LoopRange } from "../types";
import { CloseIcon, LoopIcon } from "./icons";

/*
 * El bucle A–B en el dock: un botón que lo enciende (y marca una región si no hay
 * ninguna), la región sobre la onda con un tirador en cada extremo, y Mayús + arrastrar
 * sobre la onda para marcar otra. Lo que se arrastra se ve al momento y el motor solo
 * recibe la región al soltar: así el audio no se reprograma a cada píxel.
 */

type Edge = "start" | "end";

interface Drag {
  /** Extremo que no se mueve, en segundos. */
  fixed: number;
  moving: number;
  /** Región nueva (Mayús + arrastrar): se enciende al soltar. */
  create: boolean;
}

interface ScrubHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
}

/** Edición del bucle sobre la franja de onda del dock, encima de su arrastre para saltar. */
export function useLoopEditing(engine: MultitrackEngine, scrub: ScrubHandlers, stripRef: RefObject<HTMLElement | null>) {
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const update = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const timeAt = (clientX: number) => {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * engine.duration;
  };

  const commit = () => {
    const current = dragRef.current;
    update(null);
    if (!current) return;
    const range = { start: Math.min(current.fixed, current.moving), end: Math.max(current.fixed, current.moving) };
    if (range.end - range.start >= MIN_LOOP_SECONDS) engine.setLoop(range, current.create);
  };

  const strip = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button === 0 && event.shiftKey) {
        event.currentTarget.setPointerCapture(event.pointerId);
        const at = timeAt(event.clientX);
        update({ fixed: at, moving: at, create: true });
        return;
      }
      scrub.onPointerDown(event);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = dragRef.current;
      if (current) update({ ...current, moving: timeAt(event.clientX) });
      else scrub.onPointerMove(event);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (dragRef.current) commit();
      else scrub.onPointerUp(event);
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      if (dragRef.current) update(null);
      else scrub.onPointerCancel(event);
    },
  };

  /** Props de un tirador: arrastrarlo mueve ese extremo; las flechas lo afinan. */
  const handle = (edge: Edge, loop: LoopRange) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      // El tirador está dentro de la franja: sin esto, también saltaría el cabezal.
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      update({ fixed: edge === "start" ? loop.end : loop.start, moving: edge === "start" ? loop.start : loop.end, create: false });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      event.stopPropagation();
      const current = dragRef.current;
      if (current) update({ ...current, moving: timeAt(event.clientX) });
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      event.stopPropagation();
      commit();
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      event.stopPropagation();
      update(null);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      const step = (event.shiftKey ? 1 : 0.1) * (event.key === "ArrowLeft" ? -1 : 1);
      const next = edge === "start" ? { start: loop.start + step, end: loop.end } : { start: loop.start, end: loop.end + step };
      if (next.end - next.start >= MIN_LOOP_SECONDS) engine.setLoop(next, false);
    },
  });

  const preview: LoopRange | null = drag
    ? { start: Math.min(drag.fixed, drag.moving), end: Math.max(drag.fixed, drag.moving) }
    : null;

  /** `creating`: la región que se arrastra es nueva (se encenderá al soltar). */
  return { strip, handle, preview, creating: drag?.create === true };
}

interface LoopRegionProps {
  /** La región que se ve: la del motor o la que se está arrastrando. */
  range: LoopRange;
  looping: boolean;
  duration: number;
  /** Mientras se arrastra, la región aún no está en el motor: los tiradores no son los suyos. */
  editable: boolean;
  handle: (edge: Edge, loop: LoopRange) => object;
}

/** La región del bucle sobre la franja de onda del dock, con un tirador «A» y otro «B». */
export function LoopRegion({ range, looping, duration, editable, handle }: LoopRegionProps) {
  if (duration <= 0) return null;
  const left = (range.start / duration) * 100;
  const right = (range.end / duration) * 100;
  const tone = looping ? "bg-accent" : "bg-ink-3";

  return (
    <>
      <div
        className={`pointer-events-none absolute inset-y-0 ${looping ? "bg-accent/12" : "bg-ink-3/10"}`}
        style={{ left: `${left}%`, width: `${right - left}%` }}
        aria-hidden
      />
      {(["start", "end"] as const).map((edge) => {
        const at = edge === "start" ? range.start : range.end;
        return (
          <div
            key={edge}
            role="slider"
            tabIndex={editable ? 0 : -1}
            aria-label={edge === "start" ? "Inicio del bucle (A)" : "Final del bucle (B)"}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(at)}
            aria-valuetext={formatTimePrecise(at)}
            title={`${edge === "start" ? "Inicio" : "Final"} del bucle: ${formatTimePrecise(at)}. Arrastra para moverlo; con el foco, flechas ±0,1 s (Mayús: ±1 s)`}
            className="absolute inset-y-0 z-10 w-4 -translate-x-1/2 cursor-ew-resize touch-none"
            style={{ left: `${edge === "start" ? left : right}%` }}
            {...(editable ? handle(edge, range) : {})}
          >
            <span className={`pointer-events-none absolute inset-y-0 left-1/2 w-px ${tone}`} aria-hidden />
            <span
              className={`pointer-events-none absolute top-0 flex size-3.5 items-center justify-center font-mono text-[11px] leading-none font-semibold text-surface ${tone} ${
                edge === "start" ? "left-1/2 rounded-r-sm" : "right-1/2 rounded-l-sm"
              }`}
              aria-hidden
            >
              {edge === "start" ? "A" : "B"}
            </span>
          </div>
        );
      })}
    </>
  );
}

interface LoopButtonProps {
  engine: MultitrackEngine;
  loop: LoopRange | null;
  looping: boolean;
  bpm: number | null;
}

/** Encender, apagar y quitar el bucle, con su región en mono tabular si hay sitio. */
export function LoopButton({ engine, loop, looping, bpm }: LoopButtonProps) {
  const span = loop ? `${formatTimePrecise(loop.start)}–${formatTimePrecise(loop.end)}` : "";
  const title = !loop
    ? "Bucle (L): repite cuatro compases desde aquí. También: A y B marcan el inicio y el final en el cabezal, y Mayús + arrastrar sobre la onda marca una región"
    : looping
      ? `Bucle encendido, ${span} (L para apagarlo)`
      : `Bucle apagado, ${span} (L para encenderlo)`;

  return (
    <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Bucle">
      <button
        type="button"
        onClick={() => toggleLoop(engine, bpm)}
        aria-pressed={looping}
        aria-label="Bucle"
        title={title}
        className={`flex size-8 items-center justify-center rounded-lg transition-colors ${
          looping ? "bg-accent/15 text-accent hover:bg-accent/25" : "text-ink-3 hover:bg-raised hover:text-ink"
        }`}
      >
        <LoopIcon width={16} height={16} />
      </button>
      {loop && (
        <>
          <span
            className={`hidden pl-0.5 font-mono text-[11px] whitespace-nowrap tabular-nums @min-[1320px]:inline ${
              looping ? "text-accent" : "text-ink-3"
            }`}
          >
            {span}
          </span>
          <button
            type="button"
            onClick={() => engine.setLoop(null)}
            aria-label="Quitar el bucle"
            title="Quitar el bucle"
            className="flex size-6 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-raised hover:text-ink"
          >
            <CloseIcon width={12} height={12} />
          </button>
        </>
      )}
    </div>
  );
}
