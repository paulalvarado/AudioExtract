import { pitchClass } from "../../lib/bass-tab";
import { firstStartingAt, isBlackKey, type Hand, type PianoNote, type PianoRoll } from "../../lib/piano-roll";
import type { LoopRange } from "../../types";
import { line, LOOP_FLAG, loopMark, readPalette, roundRect, type Palette } from "./canvas";
import { loopView, songTimeAt, type LoopView } from "./loop-view";
import type { PracticeRenderer } from "./PracticeCanvas";

/*
 * Modo práctica de piano en un único <canvas>: las notas caen hacia un teclado y,
 * al tocarlo, su tecla se ilumina. Cada nota es una barra sobre la columna de su
 * tecla, tan larga como dura; la mano derecha es una barra llena y la izquierda una
 * barra hueca, ambas en el celeste del piano. Lo que no cambia (columnas, líneas de
 * octava y el teclado en reposo) se pinta una vez por tamaño en una capa fuera de
 * pantalla; cada frame solo compone esa capa, las barras y las teclas que suenan.
 */

const PAD_X = 20;
const PAD_TOP = 10;
const PAD_BOTTOM = 14;
/** Alto del teclado: una parte del total, entre estos límites. */
const KEYS_SHARE = 0.24;
const MIN_KEYS_H = 64;
const MAX_KEYS_H = 128;
/** Más ancho que esto, una tecla blanca ya no se lee mejor: el teclado se centra. */
const MAX_WHITE_W = 44;
const BLACK_W = 0.58;
const BLACK_H = 0.62;
/** Desplazamiento de cada tecla negra respecto a la unión de sus blancas, en anchos de tecla blanca. */
const BLACK_OFFSET: Record<number, number> = { 1: -0.1, 3: 0.1, 6: -0.12, 8: 0, 10: 0.12 };
/** Lo que se ve por delante de «ahora», y la escala que resulta (px por ms). */
const LOOKAHEAD_MS = 3200;
const MIN_PX_PER_MS = 0.07;
const MAX_PX_PER_MS = 0.22;
/** Fundido de las barras al asomar por arriba. */
const FADE_H = 28;
/** Destello de ataque al empezar una nota. */
const ATTACK_MS = 180;
/** Barras con menos sitio que esto no llevan nombre. */
const LABEL_MIN_W = 15;
const LABEL_MIN_H = 18;

/** Qué manos se practican: la otra se ve en gris, sin iluminar teclas. */
export type HandFilter = "both" | Hand;

interface Key {
  midi: number;
  black: boolean;
  /** Tecla en el teclado. */
  x: number;
  width: number;
  /** Columna de sus barras en la cascada (un poco más estrecha que la tecla). */
  laneX: number;
  laneWidth: number;
}

interface Layout {
  width: number;
  height: number;
  left: number;
  right: number;
  rollTop: number;
  /** Borde superior del teclado: la línea de «ahora». */
  nowY: number;
  keysBottom: number;
  whiteWidth: number;
  /** Por nota MIDI − `roll.low`. */
  keys: Key[];
  pxPerMs: number;
}

export class PianoRenderer implements PracticeRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly roll: PianoRoll;
  private readonly hands: HandFilter;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private palette: Palette;
  private layout: Layout | null = null;
  private dpr = 1;
  /** Capa estática: columnas, líneas de octava y el teclado en reposo. */
  private readonly back = document.createElement("canvas");
  private lastMs = 0;
  private lastView: LoopView | null = null;

  constructor(canvas: HTMLCanvasElement, roll: PianoRoll, hands: HandFilter) {
    this.canvas = canvas;
    this.roll = roll;
    this.hands = hands;
    this.palette = readPalette(canvas, "--color-stem-piano");
  }

  resize(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (width === 0 || height === 0) {
      this.layout = null;
      return;
    }
    this.dpr = window.devicePixelRatio || 1;
    for (const target of [this.canvas, this.back]) {
      target.width = Math.round(width * this.dpr);
      target.height = Math.round(height * this.dpr);
    }
    this.palette = readPalette(this.canvas, "--color-stem-piano");
    this.layout = computeLayout(width, height, this.roll);
    this.paintStatic(this.layout);
  }

  /** Segundo de la canción bajo un punto de la cascada (para saltar ahí), o `null`. */
  timeAt(x: number, y: number): number | null {
    const layout = this.layout;
    if (!layout || x < layout.left || x > layout.right || y < layout.rollTop || y > layout.nowY) return null;
    const at = this.lastMs + (layout.nowY - y) / layout.pxPerMs;
    return Math.max(0, (this.lastView ? songTimeAt(this.lastView, at) : at) / 1000);
  }

  draw(ms: number, playing: boolean, loop: LoopRange | null): void {
    const layout = this.layout;
    const ctx = this.canvas.getContext("2d");
    if (!layout || !ctx) return;
    this.lastMs = ms;
    const animate = playing && !this.reducedMotion.matches;
    const view = loopView(ms, 0, (layout.nowY - layout.rollTop) / layout.pxPerMs, loop);
    this.lastView = view;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.back, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    for (const window of view.windows) this.paintWindow(ctx, layout, ms, window.from, window.to, window.offset);
    this.fadeTop(ctx, layout);
    for (const mark of view.marks) {
      const y = layout.nowY - (mark.at - ms) * layout.pxPerMs;
      if (y >= layout.rollTop + LOOP_FLAG && y <= layout.nowY) {
        loopMark(ctx, this.palette, mark.kind, y, layout.left, layout.right, "horizontal");
      }
    }
    this.paintKeys(ctx, layout, ms, animate);
  }

  // --- Capa estática ----------------------------------------------------------

  private paintStatic(layout: Layout): void {
    const { palette, roll } = this;
    const ctx = this.back.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.back.width, this.back.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Cascada: un pozo `surface`, con las columnas de las teclas negras un escalón más hundidas
    // y una línea en cada Do (más tenue en cada Fa), como las octavas del teclado.
    const rollHeight = layout.nowY - layout.rollTop;
    ctx.fillStyle = palette.surface;
    roundRect(ctx, layout.left, layout.rollTop, layout.right - layout.left, rollHeight + 8, [8, 8, 0, 0]);
    ctx.fill();
    ctx.fillStyle = "rgb(0 0 0 / 0.18)";
    for (const key of layout.keys) {
      if (key.black) ctx.fillRect(key.x, layout.rollTop, key.width, rollHeight);
    }
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1;
    for (const key of layout.keys) {
      const pitch = key.midi % 12;
      if (key.black || (pitch !== 0 && pitch !== 5) || key.midi === roll.low) continue;
      ctx.globalAlpha = pitch === 0 ? 1 : 0.45;
      const x = Math.round(key.x) + 0.5;
      line(ctx, x, layout.rollTop + 1, x, layout.nowY);
    }
    ctx.globalAlpha = 1;

    // Teclado en reposo: blancas en `ink-4` y negras en `surface`, con el nombre de cada Do.
    const keysHeight = layout.keysBottom - layout.nowY;
    for (const key of layout.keys) {
      if (key.black) continue;
      ctx.fillStyle = palette.ink4;
      roundRect(ctx, key.x + 0.5, layout.nowY, key.width - 1, keysHeight, [0, 0, 4, 4]);
      ctx.fill();
    }
    for (const key of layout.keys) {
      if (!key.black) continue;
      ctx.fillStyle = palette.surface;
      roundRect(ctx, key.x, layout.nowY, key.width, keysHeight * BLACK_H, [0, 0, 3, 3]);
      ctx.fill();
    }
    ctx.font = `11px ${palette.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = palette.ink;
    for (const key of layout.keys) {
      if (key.midi % 12 !== 0 || layout.whiteWidth < 15) continue;
      ctx.fillText(`C${key.midi / 12 - 1}`, key.x + key.width / 2, layout.keysBottom - 6);
    }
  }

  // --- Lo que se mueve --------------------------------------------------------

  /** Las barras de un tramo de la canción [`from`, `to`], dibujadas `offset` ms más arriba. */
  private paintWindow(ctx: CanvasRenderingContext2D, layout: Layout, ms: number, from: number, to: number, offset: number): void {
    const { palette, roll } = this;
    const yOf = (time: number) => layout.nowY - (time + offset - ms) * layout.pxPerMs;
    const top = Math.max(layout.rollTop, yOf(to));
    const bottom = Math.min(layout.nowY, yOf(from));
    if (bottom <= top) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(layout.left, top, layout.right - layout.left, bottom - top);
    ctx.clip();
    ctx.font = `600 11px ${palette.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    // Primero las de la otra mano (en gris, debajo) y luego las que se practican.
    for (const practiced of [false, true]) {
      for (let index = firstStartingAt(roll.notes, from - roll.longestMs); index < roll.notes.length; index++) {
        const note = roll.notes[index];
        if (note.startMs > to) break;
        if (note.endMs < from || this.practiced(note) !== practiced) continue;
        const key = layout.keys[note.midi - roll.low];
        const y0 = yOf(note.endMs);
        const y1 = yOf(note.startMs);
        const height = Math.max(4, y1 - y0);
        const radius = Math.min(4, key.laneWidth / 3);

        if (!practiced) {
          ctx.strokeStyle = palette.ink4;
          ctx.lineWidth = 1;
          roundRect(ctx, key.laneX + 0.5, y1 - height + 0.5, key.laneWidth - 1, height - 1, radius);
          ctx.stroke();
          continue;
        }
        if (note.hand === "right") {
          ctx.fillStyle = palette.stem;
          roundRect(ctx, key.laneX, y1 - height, key.laneWidth, height, radius);
          ctx.fill();
        } else {
          // Mano izquierda: hueca (relleno tenue y borde), para distinguirla sin depender del color.
          ctx.fillStyle = palette.stem;
          ctx.globalAlpha = 0.28;
          roundRect(ctx, key.laneX, y1 - height, key.laneWidth, height, radius);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = palette.stem;
          ctx.lineWidth = 1.5;
          roundRect(ctx, key.laneX + 0.75, y1 - height + 0.75, key.laneWidth - 1.5, height - 1.5, radius);
          ctx.stroke();
        }
        // El nombre, al pie de la barra; mientras suena, justo encima del teclado.
        const labelY = Math.min(y1, layout.nowY) - 5;
        if (key.laneWidth >= LABEL_MIN_W && labelY - (y1 - height) >= LABEL_MIN_H - 5) {
          ctx.fillStyle = note.hand === "right" ? palette.surface : palette.ink;
          ctx.fillText(pitchClass(note.midi), key.laneX + key.laneWidth / 2, labelY);
        }
      }
    }
    ctx.restore();
  }

  /** Las barras asoman por arriba con un fundido, en vez de aparecer cortadas. */
  private fadeTop(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const gradient = ctx.createLinearGradient(0, layout.rollTop, 0, layout.rollTop + FADE_H);
    gradient.addColorStop(0, this.palette.surface);
    // El mismo color, transparente: «transparent» (negro sin opacidad) agrisaría el fundido.
    gradient.addColorStop(1, withoutAlpha(this.palette.surface));
    ctx.fillStyle = gradient;
    ctx.save();
    roundRect(ctx, layout.left, layout.rollTop, layout.right - layout.left, FADE_H, [8, 8, 0, 0]);
    ctx.clip();
    ctx.fillRect(layout.left, layout.rollTop, layout.right - layout.left, FADE_H);
    ctx.restore();
  }

  /** Teclas que suenan ahora, con su nombre y un destello al atacarlas; y la línea de «ahora». */
  private paintKeys(ctx: CanvasRenderingContext2D, layout: Layout, ms: number, animate: boolean): void {
    const { palette, roll } = this;
    const keysHeight = layout.keysBottom - layout.nowY;
    const sounding = new Map<number, PianoNote>();
    for (let index = firstStartingAt(roll.notes, ms - roll.longestMs); index < roll.notes.length; index++) {
      const note = roll.notes[index];
      if (note.startMs > ms) break;
      if (note.endMs <= ms || !this.practiced(note)) continue;
      // Si dos notas comparten tecla, manda la que empezó después.
      sounding.set(note.midi, note);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `600 11px ${palette.mono}`;
    // Primero las blancas y luego las negras, que van encima.
    for (const black of [false, true]) {
      for (const note of sounding.values()) {
        const key = layout.keys[note.midi - roll.low];
        if (key.black !== black) continue;
        const height = black ? keysHeight * BLACK_H : keysHeight;
        const inset = black ? 0 : 0.5;
        // Lo que no se tapa en una blanca: por debajo de las negras vecinas.
        ctx.fillStyle = palette.stem;
        roundRect(ctx, key.x + inset, layout.nowY, key.width - inset * 2, height, black ? [0, 0, 3, 3] : [0, 0, 4, 4]);
        ctx.fill();
        if (note.hand === "left") {
          // La mano izquierda, también en la tecla: un borde interior oscuro la distingue.
          ctx.strokeStyle = palette.surface;
          ctx.lineWidth = 2;
          roundRect(ctx, key.x + inset + 2, layout.nowY + 2, key.width - inset * 2 - 4, height - 4, 3);
          ctx.stroke();
        }
        if (!black) this.repaintBlackNeighbours(ctx, layout, note.midi, sounding);
        if (key.width >= LABEL_MIN_W) {
          ctx.fillStyle = palette.surface;
          ctx.fillText(pitchClass(note.midi), key.x + key.width / 2, layout.nowY + height - (black ? 6 : 20));
        }
        const age = ms - note.startMs;
        if (animate && age < ATTACK_MS) {
          const progress = age / ATTACK_MS;
          ctx.globalAlpha = 0.85 * (1 - progress);
          ctx.fillStyle = palette.stem;
          const grow = 6 * progress;
          roundRect(ctx, key.x - grow / 2, layout.nowY - 3 - grow, key.width + grow, 3 + grow, 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    // Línea de «ahora», como el cabezal del mezclador: tinta con un contorno oscuro.
    const y = Math.round(layout.nowY) + 0.5;
    ctx.strokeStyle = "rgb(0 0 0 / 0.35)";
    ctx.lineWidth = 3;
    line(ctx, layout.left, y, layout.right, y);
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1;
    line(ctx, layout.left, y, layout.right, y);
  }

  /** Una blanca iluminada se pinta entera: hay que volver a poner encima las negras vecinas en reposo. */
  private repaintBlackNeighbours(ctx: CanvasRenderingContext2D, layout: Layout, midi: number, sounding: Map<number, PianoNote>): void {
    const keysHeight = layout.keysBottom - layout.nowY;
    for (const neighbour of [midi - 1, midi + 1]) {
      const key = layout.keys[neighbour - this.roll.low];
      if (!key?.black || sounding.has(neighbour)) continue;
      ctx.fillStyle = this.palette.surface;
      roundRect(ctx, key.x, layout.nowY, key.width, keysHeight * BLACK_H, [0, 0, 3, 3]);
      ctx.fill();
    }
  }

  private practiced(note: PianoNote): boolean {
    return this.hands === "both" || note.hand === this.hands;
  }
}

/** «oklch(0.17 0.006 260)» → «oklch(0.17 0.006 260 / 0)». */
function withoutAlpha(color: string): string {
  return /^(oklch|oklab)\([^/,]*\)$/.test(color) ? color.replace(/\)$/, " / 0)") : "transparent";
}

// --- Geometría ------------------------------------------------------------------

function computeLayout(width: number, height: number, roll: PianoRoll): Layout {
  let whites = 0;
  for (let midi = roll.low; midi <= roll.high; midi++) if (!isBlackKey(midi)) whites++;
  const whiteWidth = Math.min(MAX_WHITE_W, (width - PAD_X * 2) / whites);
  const left = (width - whiteWidth * whites) / 2;
  const right = left + whiteWidth * whites;

  const keysHeight = Math.min(MAX_KEYS_H, Math.max(MIN_KEYS_H, height * KEYS_SHARE));
  const keysBottom = height - PAD_BOTTOM;
  const nowY = keysBottom - keysHeight;
  const rollTop = PAD_TOP;
  const pxPerMs = Math.min(MAX_PX_PER_MS, Math.max(MIN_PX_PER_MS, (nowY - rollTop) / LOOKAHEAD_MS));

  const keys: Key[] = [];
  const blackWidth = whiteWidth * BLACK_W;
  let white = 0;
  for (let midi = roll.low; midi <= roll.high; midi++) {
    if (isBlackKey(midi)) {
      // Centrada en la unión con la blanca siguiente, con el desplazamiento de un teclado real.
      const center = left + white * whiteWidth + BLACK_OFFSET[midi % 12] * whiteWidth;
      const x = center - blackWidth / 2;
      keys.push({ midi, black: true, x, width: blackWidth, laneX: x + 1, laneWidth: blackWidth - 2 });
    } else {
      const x = left + white * whiteWidth;
      const gap = Math.min(3, whiteWidth * 0.12);
      keys.push({ midi, black: false, x, width: whiteWidth, laneX: x + gap / 2, laneWidth: whiteWidth - gap });
      white++;
    }
  }

  return { width, height, left, right, rollTop, nowY, keysBottom, whiteWidth, keys, pxPerMs };
}
