import { useEffect, useRef } from "react";

const BAR = 2;
const GAP = 1;

interface WaveformProps {
  peaks: Float32Array;
  className?: string;
}

/** Barras simétricas dibujadas en canvas. El color sale de `color` (CSS) del propio canvas. */
export function Waveform({ peaks, className }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => draw(canvas, peaks));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [peaks]);

  return <canvas ref={canvasRef} className={className} />;
}

function draw(canvas: HTMLCanvasElement, peaks: Float32Array): void {
  const { width, height } = canvas.getBoundingClientRect();
  if (width === 0 || height === 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = getComputedStyle(canvas).color;

  const bars = Math.floor(width / (BAR + GAP));
  const middle = height / 2;
  const usable = height - 6;

  for (let bar = 0; bar < bars; bar++) {
    const start = Math.floor((bar * peaks.length) / bars);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * peaks.length) / bars));
    let value = 0;
    for (let i = start; i < end; i++) if (peaks[i] > value) value = peaks[i];

    const barHeight = Math.max(1, value * usable);
    ctx.fillRect(bar * (BAR + GAP), middle - barHeight / 2, BAR, barHeight);
  }
}
