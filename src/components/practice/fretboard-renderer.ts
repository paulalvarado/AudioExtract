import { HAND_SPAN, lastStartedAt, pitchClass, type BassTab, type TabNote } from "../../lib/bass-tab";

/*
 * Dibujo del modo práctica en un único <canvas>: arriba el mástil (puntos en los
 * trastes que suenan, la caja de la mano y un anticipo de lo que viene) y abajo una
 * tablatura que avanza hacia la línea de «ahora». Lo que no cambia (diapasón,
 * trastes, cuerdas, líneas de la tablatura) se pinta una vez por tamaño en dos
 * capas fuera de pantalla; cada frame solo compone esas capas y lo que se mueve.
 * Todo en píxeles CSS; el canvas se escala por `devicePixelRatio`.
 */

const PAD_X = 20;
const PAD_TOP = 18;
/** Columna de los nombres de cuerda. */
const LABEL_W = 26;
/** Zona entre los nombres y la cejuela donde se dibujan las cuerdas al aire. */
const OPEN_W = 34;
const MIN_NECK_H = 112;
const MAX_NECK_H = 236;
/** Parte del alto para el mástil, mientras la tablatura conserve su separación mínima. */
const NECK_SHARE = 0.6;
/** Separación entre las líneas de la tablatura: legible con números de 12 px, sin quedar suelta. */
const MIN_TAB_GAP = 20;
const MAX_TAB_GAP = 36;
/** Alturas fijas entre el mástil y la tablatura: regla de trastes, separador y márgenes. */
const RULER_H = 14;
const SEPARATOR_GAP = 16;
const TAB_PAD = 20;
const BOTTOM_PAD = 20;
/** Mezcla entre el espaciado real de los trastes (que se estrecha hacia el cuerpo) y uno uniforme. */
const REAL_SPACING = 0.55;
const SINGLE_INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_INLAYS = [12, 24];
/** Grosor de las cuerdas, de la más grave a la más aguda. */
const STRING_WIDTHS = [2.8, 2.4, 2, 1.6, 1.3];

/** Lo que se ve de la tablatura por delante de «ahora», como mínimo y como máximo en px/ms. */
const TAB_LOOKAHEAD_MS = 5000;
const MIN_PX_PER_MS = 0.14;
const MAX_PX_PER_MS = 0.24;
/** Posición de la línea de «ahora» en la tablatura (fracción del ancho). */
const NOW_AT = 0.16;
/** Cuánto antes se anuncian en el mástil las notas que vienen, y cuántas como mucho. */
const PREVIEW_MS = 1600;
const PREVIEW_COUNT = 3;
/** Destello de ataque al empezar una nota. */
const ATTACK_MS = 180;
/** Constante de tiempo del deslizamiento de la caja al cambiar de posición. */
const BOX_EASE_MS = 45;

interface Palette {
  surface: string;
  panel: string;
  raised: string;
  line: string;
  ink: string;
  ink3: string;
  ink4: string;
  stem: string;
  mono: string;
}

interface Layout {
  width: number;
  height: number;
  labelX: number;
  openX: number;
  nut: number;
  /** x de cada traste; 0 es la cejuela. */
  frets: number[];
  boardTop: number;
  boardBottom: number;
  /** y de cada cuerda en el mástil, por índice (0 = la más grave, abajo). */
  strings: number[];
  stringGap: number;
  rulerY: number;
  separatorY: number;
  tabTop: number;
  tabBottom: number;
  tabLeft: number;
  tabRight: number;
  /** y de cada cuerda en la tablatura. */
  tabStrings: number[];
  nowX: number;
  pxPerMs: number;
}

export class FretboardRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly tab: BassTab;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private palette: Palette;
  private layout: Layout | null = null;
  private dpr = 1;
  /** Capas estáticas: lo que va debajo de la caja de la mano y lo que va encima. */
  private readonly under = document.createElement("canvas");
  private readonly over = document.createElement("canvas");
  private boxHand: number | null = null;
  private lastFrameAt = 0;
  private lastMs = 0;

  constructor(canvas: HTMLCanvasElement, tab: BassTab) {
    this.canvas = canvas;
    this.tab = tab;
    this.palette = readPalette(canvas);
  }

  /** Ajusta el canvas a su tamaño en pantalla y repinta las capas estáticas. */
  resize(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (width === 0 || height === 0) {
      this.layout = null;
      return;
    }
    this.dpr = window.devicePixelRatio || 1;
    for (const target of [this.canvas, this.under, this.over]) {
      target.width = Math.round(width * this.dpr);
      target.height = Math.round(height * this.dpr);
    }
    this.palette = readPalette(this.canvas);
    this.layout = computeLayout(width, height, this.tab);
    this.paintStatic(this.layout);
  }

  /** Si un punto (px CSS) cae sobre la tablatura. */
  inTab(y: number): boolean {
    const layout = this.layout;
    return layout !== null && y >= layout.tabTop - 16 && y <= layout.tabBottom + 16;
  }

  /** Segundo de la canción bajo un punto de la tablatura (para saltar ahí), o `null`. */
  timeAt(x: number, y: number): number | null {
    const layout = this.layout;
    if (!layout || !this.inTab(y) || x < layout.tabLeft || x > layout.tabRight) return null;
    return Math.max(0, (this.lastMs + (x - layout.nowX) / layout.pxPerMs) / 1000);
  }

  /** Pinta el instante `ms` de la canción. `playing` activa las animaciones (al pausar o saltar, todo se coloca de golpe). */
  draw(ms: number, playing: boolean): void {
    const layout = this.layout;
    const ctx = this.canvas.getContext("2d");
    if (!layout || !ctx) return;

    const now = performance.now();
    const elapsed = this.lastFrameAt ? now - this.lastFrameAt : 0;
    this.lastFrameAt = now;
    this.lastMs = ms;
    const animate = playing && !this.reducedMotion.matches;

    const { notes } = this.tab;
    const current = lastStartedAt(notes, ms);
    const sounding: TabNote[] = [];
    for (let index = current; index >= 0 && index > current - 6; index--) {
      if (notes[index].endMs > ms) sounding.push(notes[index]);
    }
    const coming: TabNote[] = [];
    for (let index = current + 1; index < notes.length && coming.length < PREVIEW_COUNT; index++) {
      if (notes[index].startMs - ms > PREVIEW_MS) break;
      coming.push(notes[index]);
    }

    // La caja sigue a la última nota que empezó (o espera en la primera).
    const anchor = notes[current] ?? notes[0];
    const targetHand = anchor ? anchor.hand : 1;
    if (this.boxHand === null || !animate || elapsed > 250) this.boxHand = targetHand;
    else this.boxHand += (targetHand - this.boxHand) * (1 - Math.exp(-elapsed / BOX_EASE_MS));

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.under, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.paintBox(ctx, layout, this.boxHand);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.over, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.paintNeckNotes(ctx, layout, ms, sounding, coming, animate);
    this.paintTab(ctx, layout, ms);
  }

  // --- Capas estáticas --------------------------------------------------------

  private paintStatic(layout: Layout): void {
    const { palette, tab } = this;
    const under = this.under.getContext("2d");
    const over = this.over.getContext("2d");
    if (!under || !over) return;
    for (const ctx of [under, over]) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.under.width, this.under.height);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    // Debajo: el diapasón como un pozo hundido y sus marcas de posición.
    const right = layout.frets[layout.frets.length - 1];
    under.fillStyle = palette.surface;
    roundRect(under, layout.nut, layout.boardTop, right - layout.nut + 6, layout.boardBottom - layout.boardTop, 8);
    under.fill();
    under.fillStyle = palette.raised;
    const middle = (layout.boardTop + layout.boardBottom) / 2;
    const inlay = Math.max(3, Math.min(6, layout.stringGap * 0.16));
    for (let fret = 1; fret < layout.frets.length; fret++) {
      const x = (layout.frets[fret - 1] + layout.frets[fret]) / 2;
      if (SINGLE_INLAYS.includes(fret)) dot(under, x, middle, inlay);
      if (DOUBLE_INLAYS.includes(fret)) {
        const offset = (layout.boardBottom - layout.boardTop) * 0.25;
        dot(under, x, middle - offset, inlay);
        dot(under, x, middle + offset, inlay);
      }
    }

    // Encima: trastes, cejuela, cuerdas y la regla de números.
    over.strokeStyle = palette.line;
    over.lineWidth = 2;
    for (let fret = 1; fret < layout.frets.length; fret++) {
      line(over, layout.frets[fret], layout.boardTop + 3, layout.frets[fret], layout.boardBottom - 3);
    }
    over.strokeStyle = palette.ink4;
    over.lineWidth = 4;
    line(over, layout.nut, layout.boardTop, layout.nut, layout.boardBottom);

    over.strokeStyle = palette.ink4;
    tab.strings.forEach((_, string) => {
      over.lineWidth = stringWidth(string, tab.strings.length);
      line(over, layout.openX, layout.strings[string], right + 6, layout.strings[string]);
    });

    over.font = `11px ${palette.mono}`;
    over.textAlign = "center";
    over.textBaseline = "middle";
    over.fillStyle = palette.ink3;
    for (let fret = 1; fret < layout.frets.length; fret++) {
      if (!SINGLE_INLAYS.includes(fret) && !DOUBLE_INLAYS.includes(fret) && fret !== 1) continue;
      over.fillText(String(fret), (layout.frets[fret - 1] + layout.frets[fret]) / 2, layout.rulerY);
    }

    // Tablatura: separador, una línea por cuerda y sus nombres.
    over.strokeStyle = palette.line;
    over.lineWidth = 1;
    const separator = Math.round(layout.separatorY) + 0.5;
    line(over, 0, separator, layout.width, separator);
    tab.strings.forEach((open, string) => {
      const y = Math.round(layout.tabStrings[string]) + 0.5;
      over.strokeStyle = palette.line;
      line(over, layout.tabLeft, y, layout.tabRight, y);
      over.fillStyle = palette.ink3;
      over.font = `12px ${palette.mono}`;
      over.fillText(open.name, layout.labelX, y);
    });
  }

  // --- Lo que se mueve --------------------------------------------------------

  private paintBox(ctx: CanvasRenderingContext2D, layout: Layout, hand: number): void {
    const last = layout.frets.length - 1;
    const from = Math.min(Math.max(hand - 1, 0), last);
    const to = Math.min(hand - 1 + HAND_SPAN, last);
    const x0 = fretPosition(layout, from);
    const x1 = fretPosition(layout, to);
    ctx.fillStyle = this.palette.stem;
    ctx.globalAlpha = 0.1;
    roundRect(ctx, x0 + 2, layout.boardTop + 2, x1 - x0 - 4, layout.boardBottom - layout.boardTop - 4, 6);
    ctx.fill();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = this.palette.stem;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private paintNeckNotes(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    ms: number,
    sounding: TabNote[],
    coming: TabNote[],
    animate: boolean,
  ): void {
    const { palette, tab } = this;
    const right = layout.frets[layout.frets.length - 1] + 6;

    // Nombres de cuerda: la que suena, resaltada.
    ctx.font = `600 12px ${palette.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    tab.strings.forEach((open, string) => {
      ctx.fillStyle = sounding.some((note) => note.string === string) ? palette.ink : palette.ink3;
      ctx.fillText(open.name, layout.labelX, layout.strings[string]);
    });

    // La parte de la cuerda que vibra: del traste pisado (o la cejuela) hacia el cuerpo.
    ctx.strokeStyle = palette.stem;
    for (const note of sounding) {
      ctx.lineWidth = stringWidth(note.string, tab.strings.length);
      const from = note.fret === 0 ? layout.openX : layout.frets[note.fret];
      line(ctx, from, layout.strings[note.string], right, layout.strings[note.string]);
    }

    // Lo que viene: anillos que se intensifican al acercarse.
    ctx.lineWidth = 2;
    for (const note of coming) {
      const proximity = 1 - (note.startMs - ms) / PREVIEW_MS;
      const { x, y, radius } = noteDot(layout, note);
      ctx.globalAlpha = 0.25 + 0.6 * Math.max(0, proximity);
      ctx.beginPath();
      ctx.arc(x, y, radius - 1, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Lo que suena: punto lleno con el nombre de la nota y un destello al atacar.
    for (const note of sounding) {
      const { x, y, radius } = noteDot(layout, note);
      const age = ms - note.startMs;
      if (animate && age < ATTACK_MS) {
        const progress = age / ATTACK_MS;
        ctx.globalAlpha = 0.8 * (1 - progress);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, radius + 3 + 7 * progress, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = palette.stem;
      dot(ctx, x, y, radius);
      const label = pitchClass(note.midi);
      ctx.font = `600 11px ${palette.mono}`;
      if (radius >= 8 && ctx.measureText(label).width <= radius * 2 - 4) {
        ctx.fillStyle = palette.surface;
        ctx.fillText(label, x, y + 0.5);
      }
    }
  }

  private paintTab(ctx: CanvasRenderingContext2D, layout: Layout, ms: number): void {
    const { palette, tab } = this;
    const { notes } = tab;
    const visibleFrom = ms - (layout.nowX - layout.tabLeft) / layout.pxPerMs;
    const visibleTo = ms + (layout.tabRight - layout.nowX) / layout.pxPerMs;
    const at = (time: number) => layout.nowX + (time - ms) * layout.pxPerMs;

    ctx.save();
    ctx.beginPath();
    ctx.rect(layout.tabLeft, layout.tabTop - 14, layout.tabRight - layout.tabLeft, layout.tabBottom - layout.tabTop + 28);
    ctx.clip();
    ctx.font = `600 12px ${palette.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Unas notas antes de la primera visible, por si su duración aún entra en pantalla.
    for (let index = Math.max(0, lastStartedAt(notes, visibleFrom) - 8); index < notes.length; index++) {
      const note = notes[index];
      if (note.startMs > visibleTo) break;
      if (note.endMs < visibleFrom) continue;
      const y = layout.tabStrings[note.string];
      const x = at(note.startMs);
      const label = String(note.fret);
      const labelWidth = ctx.measureText(label).width;
      const isSounding = note.startMs <= ms && note.endMs > ms;
      const isPast = note.endMs <= ms;

      // Duración: una barra fina en el color del bajo tras el número.
      const barFrom = x + labelWidth / 2 + 4;
      const barTo = at(note.endMs);
      if (barTo > barFrom) {
        ctx.fillStyle = palette.stem;
        ctx.globalAlpha = isSounding ? 0.85 : isPast ? 0.22 : 0.45;
        roundRect(ctx, barFrom, y - 1.5, barTo - barFrom, 3, 1.5);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // El número interrumpe la línea de la cuerda, como en una tablatura impresa.
      const boxWidth = Math.max(labelWidth + 8, 18);
      if (isSounding) {
        ctx.fillStyle = palette.stem;
        roundRect(ctx, x - boxWidth / 2, y - 9, boxWidth, 18, 6);
        ctx.fill();
        ctx.fillStyle = palette.surface;
      } else {
        ctx.fillStyle = palette.panel;
        ctx.fillRect(x - boxWidth / 2, y - 8, boxWidth, 16);
        ctx.fillStyle = isPast ? palette.ink3 : palette.ink;
      }
      ctx.fillText(label, x, y + 0.5);
    }
    ctx.restore();

    // Línea de «ahora», como el cabezal del mezclador: tinta con un contorno oscuro.
    const top = layout.tabTop - 14;
    const bottom = layout.tabBottom + 14;
    const x = Math.round(layout.nowX) + 0.5;
    ctx.strokeStyle = "rgb(0 0 0 / 0.35)";
    ctx.lineWidth = 3;
    line(ctx, x, top, x, bottom);
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1;
    line(ctx, x, top, x, bottom);
  }
}

// --- Geometría ------------------------------------------------------------------

function computeLayout(width: number, height: number, tab: BassTab): Layout {
  const count = tab.strings.length;
  const labelX = PAD_X + LABEL_W / 2;
  const openX = PAD_X + LABEL_W;
  const nut = openX + OPEN_W;
  const right = width - PAD_X - 6;

  // Espaciado de trastes: la mitad real (cada traste 2^(−1/12) más estrecho) y la mitad uniforme.
  const real = (fret: number) => 1 - 2 ** (-fret / 12);
  const span = (fret: number) =>
    REAL_SPACING * (real(fret) / real(tab.fretCount)) + (1 - REAL_SPACING) * (fret / tab.fretCount);
  const frets = Array.from({ length: tab.fretCount + 1 }, (_, fret) => nut + (right - nut) * span(fret));

  // El mástil se queda con la mayor parte del alto, pero nunca a costa de apretar la tablatura.
  const available = height - PAD_TOP - RULER_H - SEPARATOR_GAP - TAB_PAD - BOTTOM_PAD;
  const neckHeight = Math.min(
    MAX_NECK_H,
    Math.max(MIN_NECK_H, Math.min(available * NECK_SHARE, available - MIN_TAB_GAP * (count - 1))),
  );
  const boardTop = PAD_TOP;
  const boardBottom = boardTop + neckHeight;
  const stringGap = neckHeight / count;
  // La cuerda más aguda arriba, como en una tablatura.
  const strings = tab.strings.map((_, string) => boardTop + stringGap * (count - 1 - string + 0.5));
  const rulerY = boardBottom + RULER_H;
  const separatorY = rulerY + SEPARATOR_GAP;

  // La tablatura, centrada en lo que queda si le sobra sitio.
  const areaTop = separatorY + TAB_PAD;
  const areaHeight = Math.max(0, height - BOTTOM_PAD - areaTop);
  const tabGap = Math.min(MAX_TAB_GAP, Math.max(MIN_TAB_GAP * 0.7, areaHeight / (count - 1)));
  const tabTop = areaTop + Math.max(0, (areaHeight - tabGap * (count - 1)) / 2);
  const tabBottom = tabTop + tabGap * (count - 1);
  const tabStrings = tab.strings.map((_, string) => tabTop + tabGap * (count - 1 - string));
  const tabLeft = openX;
  const tabRight = width - PAD_X;
  const nowX = tabLeft + (tabRight - tabLeft) * NOW_AT;
  const pxPerMs = Math.min(MAX_PX_PER_MS, Math.max(MIN_PX_PER_MS, (tabRight - nowX) / TAB_LOOKAHEAD_MS));

  return {
    width,
    height,
    labelX,
    openX,
    nut,
    frets,
    boardTop,
    boardBottom,
    strings,
    stringGap,
    rulerY,
    separatorY,
    tabTop,
    tabBottom,
    tabLeft,
    tabRight,
    tabStrings,
    nowX,
    pxPerMs,
  };
}

/** x de un traste, admitiendo posiciones fraccionarias (la caja se desliza entre trastes). */
function fretPosition(layout: Layout, fret: number): number {
  const lower = Math.floor(fret);
  const upper = Math.min(lower + 1, layout.frets.length - 1);
  return layout.frets[lower] + (layout.frets[upper] - layout.frets[lower]) * (fret - lower);
}

function noteDot(layout: Layout, note: TabNote): { x: number; y: number; radius: number } {
  const y = layout.strings[note.string];
  if (note.fret === 0) {
    return { x: (layout.openX + layout.nut) / 2, y, radius: Math.min(layout.stringGap * 0.36, OPEN_W * 0.4, 13) };
  }
  const left = layout.frets[note.fret - 1];
  const right = layout.frets[note.fret];
  return { x: (left + right) / 2, y, radius: Math.min(layout.stringGap * 0.36, (right - left) * 0.38, 13) };
}

function stringWidth(string: number, count: number): number {
  // En un bajo de 4 cuerdas, la más grave (E) usa el segundo grosor: el primero es la B.
  return STRING_WIDTHS[string + (count === 4 ? 1 : 0)] ?? 1.3;
}

// --- Primitivas -----------------------------------------------------------------

function readPalette(element: Element): Palette {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    surface: token("--color-surface"),
    panel: token("--color-panel"),
    raised: token("--color-raised"),
    line: token("--color-line"),
    ink: token("--color-ink"),
    ink3: token("--color-ink-3"),
    ink4: token("--color-ink-4"),
    stem: token("--color-stem-bass"),
    mono: token("--font-mono") || "monospace",
  };
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
  else ctx.rect(x, y, width, height);
}
