/*
 * Primitivas de dibujo de los modos práctica. Todo en píxeles CSS (el canvas ya va
 * escalado por `devicePixelRatio`) y con los tokens de `src/index.css`: no hay una
 * paleta aparte.
 */

export interface Palette {
  surface: string;
  panel: string;
  raised: string;
  line: string;
  ink: string;
  ink2: string;
  ink3: string;
  ink4: string;
  accent: string;
  /** Color del instrumento que se practica. */
  stem: string;
  mono: string;
}

/** Lee los tokens del tema; `stem` es la variable del instrumento («--color-stem-bass»). */
export function readPalette(element: Element, stem: string): Palette {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    surface: token("--color-surface"),
    panel: token("--color-panel"),
    raised: token("--color-raised"),
    line: token("--color-line"),
    ink: token("--color-ink"),
    ink2: token("--color-ink-2"),
    ink3: token("--color-ink-3"),
    ink4: token("--color-ink-4"),
    accent: token("--color-accent"),
    stem: token(stem),
    mono: token("--font-mono") || "monospace",
  };
}

export function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

export function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number | number[],
): void {
  ctx.beginPath();
  const limit = Math.min(width / 2, height / 2);
  const radii = Array.isArray(radius) ? radius.map((r) => Math.max(0, Math.min(r, limit))) : Math.max(0, Math.min(radius, limit));
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, width, height, radii);
  else ctx.rect(x, y, width, height);
}

/** Lado de la bandera «A» de las marcas del bucle. */
export const LOOP_FLAG = 14;

/**
 * Marca del bucle: una línea de 1 px en el acento donde empieza (o vuelve a empezar),
 * con una bandera «A» de 14 px. `orientation` dice hacia dónde avanza la vista: en
 * vertical (tablatura) la línea es vertical y la bandera cuelga a su derecha desde
 * arriba; en horizontal (cascada) la línea cruza la vista y la bandera queda en el
 * margen izquierdo, encima de la línea (lo que hay encima es el inicio del bucle).
 */
export function loopMark(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  _kind: "start" | "wrap",
  position: number,
  from: number,
  to: number,
  orientation: "vertical" | "horizontal",
): void {
  const crisp = Math.round(position) + 0.5;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 1;
  let flagX: number;
  let flagY: number;
  let radii: number[];
  if (orientation === "vertical") {
    line(ctx, crisp, from, crisp, to);
    flagX = crisp - 0.5;
    flagY = from;
    radii = [0, 4, 4, 0];
  } else {
    line(ctx, from, crisp, to, crisp);
    flagX = from - LOOP_FLAG;
    flagY = crisp + 0.5 - LOOP_FLAG;
    radii = [4, 0, 0, 4];
  }
  ctx.fillStyle = palette.accent;
  roundRect(ctx, flagX, flagY, LOOP_FLAG, LOOP_FLAG, radii);
  ctx.fill();
  ctx.fillStyle = palette.surface;
  ctx.font = `600 11px ${palette.mono}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("A", flagX + LOOP_FLAG / 2, flagY + LOOP_FLAG / 2 + 0.5);
}
