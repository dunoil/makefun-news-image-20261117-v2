// THE WORLD IN ONE IMAGE — Tuesday 17 November 2026 (v2)
// A program that draws a rich one-page broadsheet of the day's world news,
// pixel by pixel, with the Node standard library only (no network, no
// dependencies). It writes a deterministic 1024x1024 PNG to
// $MAKEFUN_OUTPUT_DIR/entry.png (or /output).
//
// Everything is drawn in code on a 2x supersampled canvas (anti-aliased on
// the way down): gradient skies and seas, a dot-matrix world map, drawn
// scenes for every story (summit flags over a skyline, a burning tanker, a
// night bridge under fire, a globe, an aid convoy, a measles virus, a
// microchip), a 5x7 bitmap typeface, and a hand-rolled PNG encoder
// (zlib + CRC32). All pseudo-randomness comes from a seeded generator, so
// two runs write byte-identical files.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;
const SS = 2; // supersampling factor
const RW = W * SS;
const RH = H * SS;

type RGB = [number, number, number];

// ---------------------------------------------------------------- palette
const PAPER: RGB = [246, 241, 230];
const PAPER_HI: RGB = [252, 248, 238];
const INK: RGB = [16, 24, 36];
const INK_SOFT: RGB = [38, 48, 62];
const RED: RGB = [172, 30, 42];
const RED_DK: RGB = [128, 20, 32];
const BLUE: RGB = [24, 66, 124];
const NAVY: RGB = [14, 30, 58];
const GOLD: RGB = [196, 138, 30];
const GOLD_LT: RGB = [232, 184, 84];
const TEAL: RGB = [14, 104, 98];
const GREEN: RGB = [44, 112, 60];
const LEAF: RGB = [74, 160, 84];
const GREY: RGB = [92, 100, 110];
const GREY_LT: RGB = [168, 174, 180];
const WHITE: RGB = [255, 255, 255];
const CREAM: RGB = [255, 250, 238];
const SKY: RGB = [178, 208, 234];
const SEA: RGB = [52, 108, 158];
const SAND: RGB = [226, 198, 148];
const SMOKE: RGB = [104, 104, 110];

// ------------------------------------------------------- seeded randomness
let rngState = 20261117;
function rnd(): number {
  // mulberry32: deterministic across runs and platforms
  rngState |= 0; rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ------------------------------------------------------------ framebuffer
const fb = new Uint8ClampedArray(RW * RH * 3);

function px(x: number, y: number, c: RGB, a = 1): void {
  // x, y in logical (1024) space; drawn into the supersampled buffer
  const rx = Math.round(x * SS), ry = Math.round(y * SS);
  if (rx < 0 || ry < 0 || rx >= RW || ry >= RH) return;
  const i = (ry * RW + rx) * 3;
  if (a >= 1) { fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2]; return; }
  fb[i] = fb[i] * (1 - a) + c[0] * a;
  fb[i + 1] = fb[i + 1] * (1 - a) + c[1] * a;
  fb[i + 2] = fb[i + 2] * (1 - a) + c[2] * a;
}

function lerpC(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// Filled rect in logical space, with optional vertical gradient and an
// ordered-dither amplitude (breaks banding, still compresses well).
function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.round(x * SS)), x1 = Math.min(RW, Math.round((x + w) * SS));
  const y0 = Math.max(0, Math.round(y * SS)), y1 = Math.min(RH, Math.round((y + h) * SS));
  for (let j = y0; j < y1; j++) {
    let i = (j * RW + x0) * 3;
    for (let k = x0; k < x1; k++) { fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2]; i += 3; }
  }
}

function vgrad(x: number, y: number, w: number, h: number, top: RGB, bot: RGB, dither = 5): void {
  const x0 = Math.max(0, Math.round(x * SS)), x1 = Math.min(RW, Math.round((x + w) * SS));
  const y0 = Math.max(0, Math.round(y * SS)), y1 = Math.min(RH, Math.round((y + h) * SS));
  for (let j = y0; j < y1; j++) {
    const t = (j - y0) / Math.max(1, y1 - y0 - 1);
    const base = lerpC(top, bot, t);
    let i = (j * RW + x0) * 3;
    for (let k = x0; k < x1; k++) {
      const d = ((BAYER[j & 3][k & 3] / 15) - 0.5) * dither;
      fb[i] = base[0] + d; fb[i + 1] = base[1] + d; fb[i + 2] = base[2] + d;
      i += 3;
    }
  }
}

function frame(x: number, y: number, w: number, h: number, t: number, c: RGB): void {
  rect(x, y, w, t, c); rect(x, y + h - t, w, t, c);
  rect(x, y, t, h, c); rect(x + w - t, y, t, h, c);
}

// Soft-edged disc: coverage falls off over ~1 render pixel at the rim.
function disc(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  const R = r * SS, CX = cx * SS, CY = cy * SS;
  const x0 = Math.max(0, Math.floor(CX - R - 1)), x1 = Math.min(RW - 1, Math.ceil(CX + R + 1));
  const y0 = Math.max(0, Math.floor(CY - R - 1)), y1 = Math.min(RH - 1, Math.ceil(CY + R + 1));
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      const d = Math.hypot(i - CX, j - CY);
      const cov = Math.max(0, Math.min(1, R - d + 0.5));
      if (cov > 0) px(i / SS, j / SS, c, cov * a);
    }
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
  const RX = rx * SS, RY = ry * SS, CX = cx * SS, CY = cy * SS;
  const x0 = Math.max(0, Math.floor(CX - RX - 1)), x1 = Math.min(RW - 1, Math.ceil(CX + RX + 1));
  const y0 = Math.max(0, Math.floor(CY - RY - 1)), y1 = Math.min(RH - 1, Math.ceil(CY + RY + 1));
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      const d = Math.hypot((i - CX) / RX, (j - CY) / RY);
      const cov = Math.max(0, Math.min(1, (1 - d) * Math.min(RX, RY) + 0.5));
      if (cov > 0) px(i / SS, j / SS, c, cov * a);
    }
  }
}

function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  const R = r * SS, CX = cx * SS, CY = cy * SS, T = t * SS;
  const x0 = Math.max(0, Math.floor(CX - R - 1)), x1 = Math.min(RW - 1, Math.ceil(CX + R + 1));
  const y0 = Math.max(0, Math.floor(CY - R - 1)), y1 = Math.min(RH - 1, Math.ceil(CY + R + 1));
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      const d = Math.hypot(i - CX, j - CY);
      if (d <= R && d >= R - T) px(i / SS, j / SS, c);
    }
  }
}

function line(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB, a = 1): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * SS;
  for (let s = 0; s <= steps; s++) {
    const x = x0 + ((x1 - x0) * s) / steps;
    const y = y0 + ((y1 - y0) * s) / steps;
    disc(x, y, t / 2, c, a);
  }
}

function tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB, a = 1): void {
  const minX = Math.min(x0, x1, x2), maxX = Math.max(x0, x1, x2);
  const minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
  const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (d === 0) return;
  for (let y = minY; y <= maxY; y += 0.5) {
    for (let x = minX; x <= maxX; x += 0.5) {
      const A = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d;
      const B = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d;
      const G = 1 - A - B;
      if (A >= 0 && B >= 0 && G >= 0) px(x, y, c, a);
    }
  }
}

function poly(pts: Array<[number, number]>, c: RGB, a = 1): void {
  // even-odd scanline fill at half-logical-pixel steps
  const ys = pts.map((p) => p[1]);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  for (let y = minY; y <= maxY; y += 0.5) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [xa, ya] = pts[i];
      const [xb, yb] = pts[(i + 1) % pts.length];
      if ((ya <= y && yb > y) || (yb <= y && ya > y)) {
        xs.push(xa + ((y - ya) / (yb - ya)) * (xb - xa));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = xs[i]; x <= xs[i + 1]; x += 0.5) px(x, y, c, a);
    }
  }
}

function star(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  const pts: Array<[number, number]> = [];
  for (let k = 0; k < 10; k++) {
    const ang = -Math.PI / 2 + (k * Math.PI) / 5;
    const rad = k % 2 === 0 ? r : r * 0.45;
    pts.push([cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]);
  }
  poly(pts, c, a);
}

// ---------------------------------------------------------------- typeface
// A 5x7 bitmap font. Each glyph is seven rows of five bits, '#' = ink.
const GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '....#', '....#', '....#', '....#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '.#.#.', '..#..', '..#..', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#..##', '#.#.#', '##..#', '#...#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '#.#..', '..#..', '..#..', '..#..', '#####'],
  '2': ['.###.', '#...#', '....#', '..##.', '.#...', '#....', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ';': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.#...'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '(': ['...##', '..#..', '.#...', '.#...', '.#...', '..#..', '...##'],
  ')': ['##...', '..#..', '...#.', '...#.', '...#.', '..#..', '##...'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '..##.', '..#..', '.....', '..#..'],
  '%': ['##..#', '##.#.', '....#', '...#.', '..#..', '.#...', '#..##'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '•': ['.....', '.....', '.###.', '.###.', '.###.', '.....', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

function textWidth(s: string, scale: number): number {
  return s.length === 0 ? 0 : s.length * 6 * scale - scale;
}

function drawText(s: string, x: number, y: number, scale: number, c: RGB, bold = false): void {
  let cx = x;
  for (const raw of s.toUpperCase()) {
    const g = GLYPHS[raw] ?? GLYPHS[' '];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g[row][col] !== '#') continue;
        rect(cx + col * scale, y + row * scale, scale, scale, c);
        if (bold) rect(cx + col * scale + Math.max(1, scale - 1), y + row * scale, scale, scale, c);
      }
    }
    cx += 6 * scale;
  }
}

function drawCentered(s: string, y: number, scale: number, c: RGB, bold = false, cx = W / 2): void {
  drawText(s, Math.round(cx - textWidth(s, scale) / 2), y, scale, c, bold);
}

function drawRight(s: string, rightX: number, y: number, scale: number, c: RGB, bold = false): void {
  drawText(s, rightX - textWidth(s, scale), y, scale, c, bold);
}

// Greedy word wrap: returns lines no wider than maxChars characters.
function wrap(s: string, maxChars: number): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur === '') cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

function drawWrapped(s: string, x: number, y: number, scale: number, maxChars: number, c: RGB, lineGap = 3): number {
  const lines = wrap(s, maxChars);
  lines.forEach((ln, i) => drawText(ln, x, y + i * (7 * scale + lineGap), scale, c));
  return y + lines.length * (7 * scale + lineGap);
}

// ---------------------------------------------------------------- scenes
// Every scene is drawn inside the box (x, y, w, h) it is handed.

// LEAD SCENE — three flags over the Shenzhen skyline, three leaders at a
// long table, dawn sky. The flags of China, the United States and Russia.
function sceneSummit(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [64, 92, 136], [242, 186, 118], 6);
  // dawn clouds, soft horizontal smears
  for (const [cy2, cw2, ca] of [[0.16, 0.3, 0.16], [0.26, 0.22, 0.12], [0.1, 0.18, 0.1]] as Array<[number, number, number]>) {
    ellipse(x + w * (0.14 + cw2 / 2), y + h * cy2, (w * cw2) / 2, h * 0.028, [250, 226, 196], ca);
    ellipse(x + w * (0.86 - cw2 / 2), y + h * (cy2 + 0.05), (w * cw2) / 2, h * 0.024, [250, 226, 196], ca);
  }
  // sun with a soft halo, low over the bay
  const sx = x + w * 0.79, sy = y + h * 0.42;
  disc(sx, sy, 34, GOLD_LT, 0.18);
  disc(sx, sy, 24, GOLD_LT, 0.3);
  disc(sx, sy, 15, [250, 214, 130], 0.95);
  // far skyline, hazed
  const horizon = y + h * 0.66;
  let fx = x + 4;
  while (fx < x + w - 8) {
    const tw = 10 + rnd() * 18;
    const th = 14 + rnd() * 30;
    rect(fx, horizon - th, tw, th, [86, 100, 128]);
    fx += tw + 3 + rnd() * 8;
  }
  // near skyline, dark against the dawn
  const towerC: RGB = [24, 36, 58];
  const towers: Array<[number, number, number]> = [
    [0.02, 0.30, 0.05], [0.09, 0.42, 0.045], [0.16, 0.26, 0.06], [0.24, 0.38, 0.04],
    [0.86, 0.34, 0.05], [0.93, 0.44, 0.045], [0.40, 0.30, 0.05], [0.30, 0.22, 0.05],
  ];
  for (const [tx, th, tw] of towers) {
    const X = x + tx * w, TW = tw * w, TH = th * h;
    rect(X, horizon - TH, TW, TH, towerC);
    for (let wy = horizon - TH + 4; wy < horizon - 4; wy += 6) {
      for (let wx = X + 3; wx < X + TW - 3; wx += 5) {
        if (rnd() < 0.42) rect(wx, wy, 2.4, 3, GOLD_LT);
      }
    }
  }
  // the supertall (Ping An) with its spire, centre-right
  const pxX = x + w * 0.615, pW = w * 0.075, pH = h * 0.56;
  rect(pxX, horizon - pH, pW, pH, towerC);
  line(pxX + pW / 2, horizon - pH, pxX + pW / 2, horizon - pH - h * 0.1, 2.4, towerC);
  for (let wy = horizon - pH + 5; wy < horizon - 5; wy += 6) {
    for (let wx = pxX + 3; wx < pxX + pW - 3; wx += 5) {
      if (rnd() < 0.5) rect(wx, wy, 2.4, 3, GOLD_LT);
    }
  }
  // the bay: water band with light dashes
  vgrad(x, horizon, w, h - (horizon - y), [38, 62, 96], [16, 28, 50], 4);
  for (let i = 0; i < 46; i++) {
    const dx = x + rnd() * w, dy = horizon + 3 + rnd() * (h - (horizon - y) - 8);
    rect(dx, dy, 4 + rnd() * 9, 1.4, [150, 180, 210]);
  }
  // three flag poles on the plaza, flags flying
  const plazaY = y + h * 0.985;
  const poleTop = y + h * 0.30;
  const flagW = w * 0.105, flagH = h * 0.155;
  const poles = [0.30, 0.455, 0.61];
  for (const pf of poles) {
    const X = x + pf * w;
    line(X, poleTop, X, plazaY, 2.6, [30, 34, 44]);
    disc(X, poleTop - 2, 2.6, GOLD_LT);
  }
  // China: red field, one big gold star and four small ones
  {
    const X = x + poles[0] * w + 2, Y = poleTop + 2;
    rect(X, Y, flagW, flagH, [206, 42, 46]);
    star(X + flagW * 0.24, Y + flagH * 0.3, flagH * 0.17, GOLD_LT);
    for (const [ox, oy] of [[0.44, 0.16], [0.5, 0.34], [0.5, 0.52], [0.44, 0.68]]) {
      star(X + flagW * ox, Y + flagH * oy, flagH * 0.07, GOLD_LT);
    }
  }
  // United States: stripes and a blue canton with dot stars
  {
    const X = x + poles[1] * w + 2, Y = poleTop + 2;
    rect(X, Y, flagW, flagH, WHITE);
    const sh = flagH / 7;
    for (let i = 0; i < 7; i += 2) rect(X, Y + i * sh, flagW, sh, [178, 34, 52]);
    rect(X, Y, flagW * 0.44, flagH * 0.54, [38, 52, 110]);
    for (let rI = 0; rI < 3; rI++) {
      for (let cI = 0; cI < 4; cI++) {
        disc(X + 4 + cI * (flagW * 0.1), Y + 3.5 + rI * (flagH * 0.16), 1.1, WHITE);
      }
    }
  }
  // Russia: white, blue, red horizontal bands
  {
    const X = x + poles[2] * w + 2, Y = poleTop + 2;
    rect(X, Y, flagW, flagH / 3, WHITE);
    rect(X, Y + flagH / 3, flagW, flagH / 3, [36, 72, 160]);
    rect(X, Y + (2 * flagH) / 3, flagW, flagH / 3 + 1, [206, 42, 46]);
  }
  // the long summit table and three seated figures
  const tableTop = y + h * 0.80, tableBot = y + h * 0.965;
  const figC: RGB = [18, 24, 38];
  for (const pf of [0.345, 0.50, 0.655]) {
    const cx = x + pf * w;
    disc(cx, tableTop - h * 0.085, h * 0.052, figC); // head
    ellipse(cx, tableTop - h * 0.01, w * 0.026, h * 0.055, figC); // shoulders
    tri(cx - 3, tableTop - h * 0.045, cx + 3, tableTop - h * 0.045, cx, tableTop - h * 0.005, CREAM); // shirt V
  }
  poly(
    [
      [x + w * 0.16, tableTop], [x + w * 0.84, tableTop],
      [x + w * 0.885, tableBot], [x + w * 0.115, tableBot],
    ],
    [26, 30, 42],
  );
  rect(x + w * 0.16, tableTop, w * 0.68, 3, [70, 80, 100]); // table edge highlight
  rect(x + w * 0.415, tableTop + (tableBot - tableTop) * 0.32, w * 0.17, (tableBot - tableTop) * 0.3, CREAM); // nameplate
}

// HORMUZ — a tanker ablaze on a smoky sea, a carrier standing off.
function sceneTanker(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h * 0.58, [110, 104, 106], [198, 148, 106], 6);
  vgrad(x, y + h * 0.58, w, h * 0.42, [40, 86, 122], [20, 50, 84], 5);
  // smoke rolling off the fire
  disc(x + w * 0.47, y + h * 0.2, 11, SMOKE, 0.4);
  disc(x + w * 0.56, y + h * 0.13, 14, SMOKE, 0.32);
  disc(x + w * 0.68, y + h * 0.09, 17, [88, 88, 94], 0.26);
  // distant carrier, right
  rect(x + w * 0.72, y + h * 0.52, w * 0.26, h * 0.05, [64, 68, 78]);
  rect(x + w * 0.86, y + h * 0.44, w * 0.05, h * 0.09, [64, 68, 78]);
  // the tanker
  poly([[x + w * 0.05, y + h * 0.68], [x + w * 0.95, y + h * 0.68], [x + w * 0.86, y + h * 0.84], [x + w * 0.14, y + h * 0.84]], INK);
  rect(x + w * 0.05, y + h * 0.645, w * 0.9, h * 0.04, [40, 46, 56]);
  const stacks: Array<[number, RGB]> = [[0.14, RED], [0.36, BLUE], [0.58, TEAL]];
  for (const [sf, sc] of stacks) {
    rect(x + sf * w, y + h * 0.47, w * 0.19, h * 0.18, sc);
    rect(x + sf * w, y + h * 0.47, w * 0.19, h * 0.045, lerpC(sc, WHITE, 0.25));
  }
  rect(x + w * 0.8, y + h * 0.36, w * 0.09, h * 0.29, GREY_LT); // bridge tower
  rect(x + w * 0.815, y + h * 0.4, w * 0.06, h * 0.05, NAVY);
  // flames over the middle stack, layered tongues
  const fx = x + w * 0.455, fbase = y + h * 0.47;
  tri(fx - 13, fbase, fx + 13, fbase, fx + 2, fbase - h * 0.30, RED);
  tri(fx - 9, fbase, fx + 9, fbase, fx - 1, fbase - h * 0.22, [238, 118, 26]);
  tri(fx - 5, fbase, fx + 5, fbase, fx + 1, fbase - h * 0.14, GOLD_LT);
  tri(fx - 20, fbase, fx - 8, fbase, fx - 15, fbase - h * 0.17, [238, 118, 26]);
  // firelight on the water
  for (let i = 0; i < 12; i++) {
    rect(x + w * 0.3 + rnd() * w * 0.4, y + h * 0.86 + rnd() * h * 0.1, 3 + rnd() * 7, 1.4, [240, 140, 60]);
  }
  for (let i = 0; i < 10; i++) { // wave dashes
    rect(x + rnd() * w * 0.94, y + h * 0.88 + rnd() * h * 0.09, 4 + rnd() * 6, 1.3, [170, 200, 225]);
  }
}

// KYIV — a night city in blackout, a bridge over the river, strikes coming in.
function sceneKyiv(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h * 0.72, [8, 15, 34], [42, 52, 84], 4);
  for (let i = 0; i < 42; i++) { // stars
    px(x + rnd() * w, y + rnd() * h * 0.5, WHITE, 0.35 + rnd() * 0.55);
  }
  disc(x + w * 0.85, y + h * 0.14, 6, [232, 236, 240], 0.95); // moon
  disc(x + w * 0.85, y + h * 0.14, 10, [232, 236, 240], 0.18);
  // searchlight beam sweeping up from the left bank
  poly([[x + w * 0.1, y + h * 0.72], [x + w * 0.2, y + h * 0.72], [x + w * 0.44, y + h * 0.04], [x + w * 0.34, y + h * 0.04]], WHITE, 0.08);
  // city silhouette, mostly dark (the blackout), a few windows still lit
  const cityC: RGB = [6, 10, 20];
  let bx = x + 2;
  while (bx < x + w - 6) {
    const bw = 9 + rnd() * 13, bh = 12 + rnd() * 22;
    rect(bx, y + h * 0.72 - bh, bw, bh, cityC);
    for (let wy = y + h * 0.72 - bh + 3; wy < y + h * 0.72 - 3; wy += 5) {
      for (let wx = bx + 2; wx < bx + bw - 2; wx += 4.5) {
        if (rnd() < 0.16) rect(wx, wy, 2, 2.6, GOLD_LT);
      }
    }
    bx += bw + 2;
  }
  rect(x, y + h * 0.72, w, h * 0.03, cityC);
  // the bridge: deck, two pylons, cables
  const deckY = y + h * 0.78;
  rect(x + 2, deckY, w - 4, 3, [52, 64, 88]);
  rect(x + w * 0.24, deckY - h * 0.17, 4, h * 0.17, [52, 64, 88]);
  rect(x + w * 0.72, deckY - h * 0.17, 4, h * 0.17, [52, 64, 88]);
  line(x + w * 0.26, deckY - h * 0.17, x + w * 0.48, deckY, 1.4, [90, 106, 134]);
  line(x + w * 0.74, deckY - h * 0.17, x + w * 0.5, deckY, 1.4, [90, 106, 134]);
  line(x + w * 0.26, deckY - h * 0.17, x + w * 0.05, deckY, 1.4, [90, 106, 134]);
  line(x + w * 0.74, deckY - h * 0.17, x + w * 0.94, deckY, 1.4, [90, 106, 134]);
  // the river, with broken reflections
  vgrad(x, y + h * 0.82, w, h * 0.18, [18, 32, 56], [8, 15, 30], 4);
  for (let i = 0; i < 12; i++) {
    rect(x + rnd() * w * 0.92, y + h * 0.85 + rnd() * h * 0.11, 3 + rnd() * 6, 1.2, [130, 155, 185]);
  }
  // incoming strike: a bright trail and a burst over the city
  line(x + w * 0.94, y + h * 0.05, x + w * 0.62, y + h * 0.4, 2.6, [250, 190, 110]);
  line(x + w * 0.94, y + h * 0.05, x + w * 0.62, y + h * 0.4, 1.2, WHITE);
  disc(x + w * 0.62, y + h * 0.42, 4, [255, 220, 150]);
  star(x + w * 0.4, y + h * 0.52, 10, GOLD_LT);
  star(x + w * 0.4, y + h * 0.52, 5.5, [240, 110, 40]);
  star(x + w * 0.68, y + h * 0.6, 6.5, GOLD_LT, 0.9);
}

// COP31 — a shaded globe with painted continents and a leaf for the talks.
function sceneGlobe(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [10, 54, 68], [7, 32, 46], 5);
  const cx = x + w * 0.4, cy = y + h * 0.5, r = h * 0.42;
  const lands: Array<[number, number, number, number]> = [
    [-0.52, -0.34, 0.36, 0.27], [-0.34, 0.36, 0.15, 0.27], // the Americas
    [0.10, -0.40, 0.20, 0.15], [0.18, 0.10, 0.21, 0.30], // Europe, Africa
    [0.55, -0.28, 0.38, 0.25], [0.62, 0.18, 0.12, 0.10], [0.60, 0.44, 0.17, 0.11], // Asia, SE Asia, Australia
  ];
  for (let yy = cy - r; yy <= cy + r; yy += 0.5) {
    for (let xx = cx - r; xx <= cx + r; xx += 0.5) {
      const u = (xx - cx) / r, v = (yy - cy) / r;
      if (u * u + v * v > 1) continue;
      let col = lerpC([66, 130, 182], [28, 80, 138], (v + 1) / 2); // ocean
      let land = false;
      for (const [cu, cv, ru, rv] of lands) {
        const du = (u - cu) / ru, dv = (v - cv) / rv;
        if (du * du + dv * dv <= 1) { land = true; break; }
      }
      if (land) {
        const mixv = 0.5 + 0.5 * Math.sin(u * 9 + v * 13);
        col = lerpC([58, 128, 66], [150, 152, 92], mixv * 0.55);
      }
      if (v < -0.84 || v > 0.88) col = [232, 238, 242]; // ice caps
      const shade = 1 - 0.22 * Math.max(0, u) - 0.1 * Math.max(0, v); // sphere shading
      px(xx, yy, [Math.round(col[0] * shade), Math.round(col[1] * shade), Math.round(col[2] * shade)]);
    }
  }
  ring(cx, cy, r, 1.6, [16, 60, 96]);
  // meridians and the equator, drawn as parametric curves
  for (const fx of [0.45, 0.8]) {
    for (let t = 0; t <= Math.PI * 2; t += 0.06) {
      const mx = cx + Math.cos(t) * r * fx, my = cy + Math.sin(t) * r;
      if (Math.hypot(mx - cx, my - cy) <= r) px(mx, my, [20, 70, 110], 0.55);
    }
  }
  for (let t = 0; t <= Math.PI * 2; t += 0.06) {
    const mx = cx + Math.cos(t) * r, my = cy + Math.sin(t) * r * 0.36;
    px(mx, my, [20, 70, 110], 0.55);
  }
  // the leaf, bottom right
  const lx = x + w * 0.78, ly = y + h * 0.76;
  disc(lx, ly, 13, LEAF);
  tri(lx - 11, ly - 5, lx + 11, ly - 5, lx, ly - 21, LEAF);
  line(lx - 6, ly + 8, lx + 7, ly - 12, 2, CREAM);
  disc(x + w * 0.85, y + h * 0.2, 8, GOLD_LT, 0.9); // a hot sun
  disc(x + w * 0.85, y + h * 0.2, 13, GOLD_LT, 0.25);
}

// GAZA AID — a convoy truck with a red cross, crates, desert sun.
function sceneAid(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h * 0.66, [148, 188, 224], [242, 222, 182], 5);
  disc(x + w * 0.84, y + h * 0.17, 9, GOLD_LT, 0.95);
  disc(x + w * 0.84, y + h * 0.17, 15, GOLD_LT, 0.25);
  vgrad(x, y + h * 0.66, w, h * 0.34, SAND, [198, 164, 112], 5);
  rect(x, y + h * 0.78, w, h * 0.09, [178, 146, 100]); // the road
  // far truck, smaller
  rect(x + w * 0.66, y + h * 0.42, w * 0.24, h * 0.2, WHITE);
  frame(x + w * 0.66, y + h * 0.42, w * 0.24, h * 0.2, 1.6, INK_SOFT);
  rect(x + w * 0.9, y + h * 0.5, w * 0.08, h * 0.12, INK_SOFT);
  disc(x + w * 0.72, y + h * 0.66, 4.5, INK); disc(x + w * 0.9, y + h * 0.66, 4.5, INK);
  // the aid truck
  ellipse(x + w * 0.38, y + h * 0.71, w * 0.34, 3.4, [160, 128, 84], 0.6); // shadow
  rect(x + w * 0.06, y + h * 0.3, w * 0.44, h * 0.34, WHITE);
  frame(x + w * 0.06, y + h * 0.3, w * 0.44, h * 0.34, 2.2, INK);
  rect(x + w * 0.245, y + h * 0.36, w * 0.07, h * 0.22, RED); // cross
  rect(x + w * 0.21, y + h * 0.405, w * 0.14, h * 0.13, RED);
  rect(x + w * 0.5, y + h * 0.42, w * 0.17, h * 0.22, BLUE); // cab
  poly([[x + w * 0.67, y + h * 0.42], [x + w * 0.76, y + h * 0.52], [x + w * 0.76, y + h * 0.64], [x + w * 0.67, y + h * 0.64]], BLUE);
  rect(x + w * 0.53, y + h * 0.45, w * 0.1, h * 0.09, SKY);
  disc(x + w * 0.17, y + h * 0.68, 7, INK); disc(x + w * 0.17, y + h * 0.68, 3, GREY_LT);
  disc(x + w * 0.6, y + h * 0.68, 7, INK); disc(x + w * 0.6, y + h * 0.68, 3, GREY_LT);
  // crates waiting by the road
  for (const [ox, oy] of [[0.06, 0.82], [0.06, 0.93], [0.17, 0.93]]) {
    rect(x + ox * w, y + oy * h - h * 0.1, w * 0.1, h * 0.1, [188, 152, 102]);
    frame(x + ox * w, y + oy * h - h * 0.1, w * 0.1, h * 0.1, 1.4, [120, 92, 58]);
  }
}

// MEASLES — a spotted virus and the syringe that used to hold it back.
function sceneVirus(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [76, 18, 28], [38, 8, 16], 5);
  const cx = x + w * 0.36, cy = y + h * 0.5, r = h * 0.27;
  for (let k = 0; k < 12; k++) { // spikes with knobs
    const ang = (k * Math.PI) / 6;
    const x1 = cx + (r - 2) * Math.cos(ang), y1 = cy + (r - 2) * Math.sin(ang);
    const x2 = cx + (r + 9) * Math.cos(ang), y2 = cy + (r + 9) * Math.sin(ang);
    line(x1, y1, x2, y2, 3, RED_DK);
    disc(x2, y2, 3.6, [188, 52, 62]);
  }
  disc(cx, cy, r, [198, 62, 72]);
  disc(cx - r * 0.18, cy - r * 0.18, r * 0.8, [212, 88, 96], 0.75);
  for (let i = 0; i < 15; i++) { // the measles spots
    const ang = rnd() * Math.PI * 2, rr = rnd() * r * 0.78;
    disc(cx + rr * Math.cos(ang), cy + rr * Math.sin(ang), 1.8 + rnd() * 1.8, [246, 196, 182], 0.9);
  }
  // syringe, diagonal at right
  line(x + w * 0.68, y + h * 0.68, x + w * 0.86, y + h * 0.5, 9, [216, 228, 234]);
  line(x + w * 0.68, y + h * 0.68, x + w * 0.86, y + h * 0.5, 5, [148, 198, 208]);
  line(x + w * 0.86, y + h * 0.5, x + w * 0.97, y + h * 0.39, 1.6, GREY_LT); // needle
  line(x + w * 0.68, y + h * 0.68, x + w * 0.6, y + h * 0.76, 3.4, GREY_LT); // plunger rod
  line(x + w * 0.55, y + h * 0.71, x + w * 0.65, y + h * 0.81, 3, GREY_LT); // thumb rest
  for (let i = 0; i < 4; i++) { // dose marks
    const t = 0.25 + i * 0.16;
    line(x + w * (0.68 + 0.18 * t) - 2, y + h * (0.68 - 0.18 * t) - 2, x + w * (0.68 + 0.18 * t) + 2, y + h * (0.68 - 0.18 * t) + 2, 1.2, INK_SOFT);
  }
  // a broken shield: protection lost
  ring(x + w * 0.82, y + h * 0.84, 9, 2, CREAM);
  line(x + w * 0.765, y + h * 0.775, x + w * 0.875, y + h * 0.905, 2.4, RED);
  line(x + w * 0.875, y + h * 0.775, x + w * 0.765, y + h * 0.905, 2.4, RED);
}

// AI CHIPS — a microchip on a dark board, traces running out, exports falling.
function sceneChip(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [20, 27, 38], [10, 14, 22], 4);
  // circuit traces running off the chip
  const traces: Array<Array<[number, number]>> = [
    [[0.3, 0.24], [0.3, 0.1], [0.12, 0.1]], [[0.5, 0.24], [0.5, 0.06]],
    [[0.7, 0.24], [0.7, 0.12], [0.88, 0.12]], [[0.3, 0.76], [0.3, 0.9], [0.14, 0.9]],
    [[0.7, 0.76], [0.7, 0.92]], [[0.24, 0.5], [0.08, 0.5]],
    [[0.76, 0.5], [0.93, 0.5], [0.93, 0.32]],
  ];
  for (const path of traces) {
    for (let i = 0; i + 1 < path.length; i++) {
      line(x + path[i][0] * w, y + path[i][1] * h, x + path[i + 1][0] * w, y + path[i + 1][1] * h, 1.5, TEAL, 0.85);
    }
    const [ex, ey] = path[path.length - 1];
    disc(x + ex * w, y + ey * h, 2.4, GOLD_LT);
  }
  // pins
  for (let i = 0; i < 4; i++) {
    rect(x + w * 0.245, y + h * (0.32 + i * 0.12), w * 0.055, h * 0.05, GREY_LT);
    rect(x + w * 0.7, y + h * (0.32 + i * 0.12), w * 0.055, h * 0.05, GREY_LT);
    rect(x + w * (0.32 + i * 0.12), y + h * 0.245, w * 0.05, h * 0.055, GREY_LT);
    rect(x + w * (0.32 + i * 0.12), y + h * 0.7, w * 0.05, h * 0.055, GREY_LT);
  }
  // chip body with a gold core
  rect(x + w * 0.3, y + h * 0.3, w * 0.4, h * 0.4, [34, 44, 60]);
  frame(x + w * 0.3, y + h * 0.3, w * 0.4, h * 0.4, 2, [90, 104, 128]);
  rect(x + w * 0.3, y + h * 0.3, w * 0.4, h * 0.1, WHITE); // sheen (alpha via low-value overlay below)
  rect(x + w * 0.395, y + h * 0.395, w * 0.21, h * 0.21, GOLD);
  drawText('AI', x + w * 0.432, y + h * 0.435, 3, INK, true);
  // a small falling export chart, bottom left
  const ax = x + w * 0.05, ay = y + h * 0.94;
  line(ax, ay - h * 0.16, ax, ay, 1.2, GREY);
  line(ax, ay, ax + w * 0.2, ay, 1.2, GREY);
  const pts: Array<[number, number]> = [[0, 0.13], [0.05, 0.1], [0.1, 0.115], [0.15, 0.05], [0.2, 0.015]];
  for (let i = 0; i + 1 < pts.length; i++) {
    line(ax + pts[i][0] * w, ay - pts[i][1] * h, ax + pts[i + 1][0] * w, ay - pts[i + 1][1] * h, 1.8, [240, 90, 90]);
  }
}

// ------------------------------------------------------------- world map
// Continents as unions of ellipses in lon/lat space, rasterised to dots.
const LAND: Array<[number, number, number, number]> = [
  [-102, 47, 30, 13], [-84, 37, 17, 9], [-96, 29, 13, 6], [-102, 21, 9, 5],
  [-152, 64, 13, 6], [-78, 49, 13, 8], [-42, 72, 10, 5], [-118, 33, 8, 5],
  [-61, -10, 10, 13], [-69, -24, 6, 11], [-52, -4, 7, 6], [-74, -38, 3.5, 8],
  [14, 49, 15, 7], [8, 44, 8, 4], [-3, 43, 6, 3.5], [16, 62, 8, 6],
  [28, 55, 10, 6], [-2, 53, 3, 3.5], [12, 42, 3, 5],
  [17, 9, 19, 14], [21, -13, 14, 12], [46, 5, 6, 5], [47, -19, 2.5, 5], [8, 4, 8, 6],
  [50, 40, 16, 9], [82, 52, 26, 10], [112, 47, 24, 11], [138, 56, 20, 11],
  [45, 30, 11, 7], [78, 21, 7, 9], [101, 15, 6, 7], [113, 31, 11, 9],
  [127, 38, 3.5, 4], [138, 37, 3.5, 4], [141, 41, 2.5, 3.5], [133, 34, 2.5, 2.5],
  [98, -1, 5, 2], [106, -6, 4.5, 1.8], [113, -1, 4, 2], [119, -2, 3.5, 2],
  [131, -3, 4, 2], [141, -4, 5, 2.5],
  [134, -25, 12, 7], [146, -33, 5, 4.5], [172, -42, 2.5, 3.5],
];

function isLand(lon: number, lat: number): boolean {
  for (const [clon, clat, rx, ry] of LAND) {
    const du = (lon - clon) / rx, dv = (lat - clat) / ry;
    if (du * du + dv * dv <= 1) return true;
  }
  return false;
}

// The day's nine places, numbered as the panels below are ordered.
const PLACES: Array<[number, number, number]> = [
  [1, 114, 22.5], // Shenzhen — the summit
  [2, 56.3, 26.5], // Strait of Hormuz
  [3, 30.5, 50.4], // Kyiv
  [4, 30.7, 36.9], // Antalya — COP31
  [5, 34.3, 31.4], // Gaza
  [6, -98, 39.8], // United States — measles
  [7, 2.35, 48.9], // Paris — Depardieu
  [8, 139.7, 35.7], // Japan — jets scrambled
  [9, 58.4, 23.6], // Oman — the U19 final
];

function drawWorldMap(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [18, 34, 58], [10, 20, 38], 4);
  const cols = 104, rows = 24;
  const cw = w / cols, ch = h / rows;
  for (let rI = 0; rI < rows; rI++) {
    const lat = 78 - ((rI + 0.5) * 138) / rows;
    for (let cI = 0; cI < cols; cI++) {
      const lon = -168 + ((cI + 0.5) * 336) / cols;
      if (isLand(lon, lat)) {
        disc(x + (cI + 0.5) * cw, y + (rI + 0.5) * ch, cw * 0.34, [216, 200, 158], 0.95);
      }
    }
  }
  for (const [n, lon, lat] of PLACES) {
    const mx = x + ((lon + 168) / 336) * w;
    const my = y + ((78 - lat) / 138) * h;
    disc(mx, my, 5.2, RED);
    ring(mx, my, 5.2, 1.3, WHITE);
    drawText(String(n), mx - 2.4, my - 3.4, 1, WHITE, true);
  }
}

// ------------------------------------------------------------ ticker icons
function iconEiffel(x: number, y: number): void {
  line(x + 6, y + 38, x + 17, y + 8, 2.6, INK);
  line(x + 34, y + 38, x + 23, y + 8, 2.6, INK);
  line(x + 20, y + 8, x + 20, y + 2, 2.2, INK);
  line(x + 10, y + 27, x + 30, y + 27, 2.2, INK);
  line(x + 13.5, y + 18, x + 26.5, y + 18, 2, INK);
  line(x + 6, y + 38, x + 34, y + 38, 2.2, INK);
  line(x + 14, y + 38, x + 20, y + 29, 1.8, INK);
  line(x + 26, y + 38, x + 20, y + 29, 1.8, INK);
}

function iconJet(x: number, y: number): void {
  poly([[x + 3, y + 27], [x + 30, y + 9], [x + 38, y + 11], [x + 37, y + 16], [x + 13, y + 29]], INK);
  poly([[x + 17, y + 21], [x + 27, y + 31], [x + 15, y + 31]], INK);
  poly([[x + 3, y + 27], [x + 1, y + 18], [x + 9, y + 19]], INK);
  disc(x + 31, y + 13.5, 1.8, SKY);
}

function iconCricket(x: number, y: number): void {
  for (const ox of [22, 27, 32]) line(x + ox, y + 12, x + ox, y + 35, 2.4, INK);
  line(x + 21, y + 10, x + 26, y + 10, 1.8, INK);
  line(x + 28, y + 10, x + 33, y + 10, 1.8, INK);
  line(x + 7, y + 6, x + 14, y + 22, 3.6, [148, 108, 56]); // bat handle
  line(x + 14, y + 22, x + 18, y + 35, 6, [178, 140, 82]); // blade
  disc(x + 35, y + 31, 3.6, RED);
  disc(x + 33.8, y + 29.8, 0.9, WHITE);
}

// ---------------------------------------------------------------- layout
vgrad(0, 0, W, H, PAPER_HI, PAPER, 3);
frame(8, 8, W - 16, H - 16, 3, INK);

// Masthead
drawText('NO. 321', 28, 40, 2, GREY, true);
drawRight('ONE PAGE', W - 28, 40, 2, GREY, true);
drawCentered('THE WORLD IN ONE IMAGE', 24, 5, INK, true);
drawCentered("ALL THE DAY'S BIG STORIES - DRAWN, NOT PHOTOGRAPHED", 76, 2, GREY);
rect(28, 94, W - 56, 3, INK);
rect(28, 100, W - 56, 1.2, INK);

// The date band: the day, named as large as the page allows
rect(16, 106, W - 32, 46, RED);
rect(16, 148, W - 32, 4, RED_DK);
star(52, 129, 7, GOLD_LT);
star(W - 52, 129, 7, GOLD_LT);
drawCentered('TUESDAY 17 NOVEMBER 2026', 108, 6, WHITE, true);

// ------------------------------------------------------------- lead story
// Left column: the first Xi-Trump-Putin trilateral summit
drawText('DIPLOMACY • APEC SUMMIT, SHENZHEN', 28, 164, 2, RED, true);
drawText('XI, TRUMP & PUTIN', 28, 186, 4, INK, true);
drawText('FIRST TRILATERAL', 28, 219, 4, INK, true);
drawText('SUMMIT ON THURSDAY', 28, 252, 4, INK, true);
drawWrapped(
  'CHINA CONFIRMS THE THREE LEADERS MEET FACE TO FACE ON THURSDAY 19 NOVEMBER IN SHENZHEN, ON THE SIDELINES OF THE APEC SUMMIT - A FIRST TRILATERAL MEETING OF THE CHINESE, US AND RUSSIAN PRESIDENTS.',
  28, 292, 2, 35, INK_SOFT,
);
drawText('AT A GLANCE', 28, 402, 2, GREY, true);
{
  const chips: Array<[string, number]> = [['THU 19 NOV', 128], ['SHENZHEN', 104], ['APEC 2026', 116]];
  let chipX = 28;
  for (const [label, cw] of chips) {
    frame(chipX, 420, cw, 24, 1.6, INK_SOFT);
    drawCentered(label, 425, 2, INK, true, chipX + cw / 2);
    chipX += cw + 12;
  }
}
rect(28, 458, 430, 1.6, GREY_LT);

// Right column: the scene, its caption, and the day on the map
sceneSummit(474, 162, 522, 160);
frame(474, 162, 522, 160, 2.4, INK);
drawCentered('THE THREE FLAGS OVER SHENZHEN BAY', 330, 2, GREY, false, 474 + 261);
frame(474, 352, 522, 114, 2, INK_SOFT);
drawText('THE DAY ON THE MAP', 486, 359, 2, INK, true);
drawRight('9 PLACES • 5 REGIONS', 984, 359, 2, GREY);
drawWorldMap(486, 378, 498, 80);

// ------------------------------------------------------------ numbers band
rect(16, 474, W - 32, 64, INK);
{
  const cells: Array<[string, string]> = [
    ['264', 'DAYS OF IRAN WAR'],
    ['5,412', 'US MEASLES CASES'],
    ['$120BN', 'A YEAR BY 2035'],
    ['19 NOV', 'SUMMIT DAY AHEAD'],
    ['1', 'WICKET MARGIN'],
  ];
  const cellW = (W - 32) / 5;
  cells.forEach(([num, label], i) => {
    const cx = 16 + cellW * (i + 0.5);
    drawCentered(num, 482, 4, GOLD_LT, true, cx);
    drawCentered(label, 516, 2, CREAM, false, cx);
    if (i > 0) rect(16 + cellW * i, 484, 1.4, 44, [70, 78, 92]);
  });
}

// ------------------------------------------------------------- story grid
interface Panel {
  kicker: string;
  color: RGB;
  head1: string;
  head2: string;
  body: string;
  scene: (x: number, y: number, w: number, h: number) => void;
}

const panels: Panel[] = [
  {
    kicker: 'WAR AT SEA • HORMUZ', color: RED,
    head1: 'TANKERS BURN', head2: 'IN HORMUZ',
    body: 'US JETS HIT IRGC SITE ON QESHM. TANKERS HIT MINES.',
    scene: sceneTanker,
  },
  {
    kicker: 'EUROPE • THE UKRAINE WAR', color: BLUE,
    head1: 'KYIV POUNDED,', head2: 'BRIDGE SHUT',
    body: 'MISSILES CUT KYIV HEAT + WATER. BRIDGE SHUT.',
    scene: sceneKyiv,
  },
  {
    kicker: 'CLIMATE • COP31, ANTALYA', color: TEAL,
    head1: 'PHASE OUT', head2: 'FOSSIL FUELS',
    body: 'DRAFT DEAL: $120BN A YEAR FOR ADAPTATION BY 2035.',
    scene: sceneGlobe,
  },
  {
    kicker: 'MIDDLE EAST • GAZA AID', color: GOLD,
    head1: 'OPEN GAZA', head2: 'CROSSINGS NOW',
    body: 'UK + ALLIES CALL AID CRISIS CATASTROPHIC.',
    scene: sceneAid,
  },
  {
    kicker: 'HEALTH • THE AMERICAS', color: RED,
    head1: 'MEASLES-FREE', head2: 'STATUS LOST',
    body: 'PAHO ENDS 26 YEARS ELIMINATION. 5,412 CASES.',
    scene: sceneVirus,
  },
  {
    kicker: 'TECH + MARKETS • US RULES', color: BLUE,
    head1: 'AI CHIP CURBS', head2: 'HIT CHINA',
    body: 'US CLOSES EXPORT LOOPHOLE. NVIDIA EARNS TONIGHT.',
    scene: sceneChip,
  },
];

const ROW_Y = [546, 669, 792];
const COL_X = [28, 514];
const PANEL_W = 482;
const PANEL_H = 116;

panels.forEach((p, i) => {
  const x = COL_X[i % 2];
  const y = ROW_Y[Math.floor(i / 2)];
  rect(x, y, PANEL_W, PANEL_H, WHITE);
  p.scene(x, y + 6, 148, PANEL_H - 6);
  frame(x + 148, y, PANEL_W - 148, PANEL_H, 2, p.color);
  rect(x, y, PANEL_W, 6, p.color);
  drawText(p.kicker, x + 160, y + 12, 2, p.color, true);
  drawText(p.head1, x + 160, y + 31, 3, INK, true);
  drawText(p.head2, x + 160, y + 54, 3, INK, true);
  drawWrapped(p.body, x + 160, y + 81, 2, 26, INK_SOFT, 2);
});

// ---------------------------------------------------------------- ticker
{
  const items: Array<{ color: RGB; icon: (x: number, y: number) => void; text: string }> = [
    {
      color: RED, icon: iconEiffel,
      text: 'DEPARDIEU PLEADS GUILTY TO SEXUAL ASSAULT, DROPS APPEAL',
    },
    {
      color: BLUE, icon: iconJet,
      text: 'JAPAN SCRAMBLES JETS AS RUSSIAN PLANES ENTER ITS AIRSPACE',
    },
    {
      color: GREEN, icon: iconCricket,
      text: 'INDIA EDGE PAKISTAN BY ONE WICKET TO WIN U19 ASIA CUP FINAL',
    },
  ];
  items.forEach((it, i) => {
    const x = 28 + i * 326;
    const y = 916;
    rect(x, y, 316, 68, CREAM);
    frame(x, y, 316, 68, 1.6, GREY_LT);
    rect(x, y, 5, 68, it.color);
    it.icon(x + 10, y + 14);
    drawWrapped(it.text, x + 58, y + 11, 2, 21, INK, 2);
  });
}

// Footer
rect(28, 992, W - 56, 1.6, INK);
drawCentered("FROM THE DAY'S REPORTING: AFP - REUTERS - PAHO - CNN - NPR - UKMTO", 1000, 2, GREY);

// ---------------------------------------------------------------- PNG out
// Box-downsample the supersampled buffer to the final 1024x1024 image.
const out = new Uint8Array(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * RW + (x * SS + dx)) * 3;
        r += fb[i]; g += fb[i + 1]; b += fb[i + 2];
      }
    }
    const o = (y * W + x) * 3, n = SS * SS;
    out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  bytes.set(data, 8);
  const crcData = new Uint8Array(4 + data.length);
  crcData.set(bytes.subarray(4, 8), 0);
  crcData.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcData));
  return bytes;
}

function encodePNG(): Uint8Array {
  const raw = new Uint8Array((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0; // filter: none
    raw.set(out.subarray(y * W * 3, (y + 1) * W * 3), y * (W * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, W);
  v.setUint32(4, H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { png.set(p, off); off += p.length; }
  return png;
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const png = encodePNG();
writeFileSync(join(outDir, 'entry.png'), png);
console.log(`wrote entry.png: ${W}x${H}, ${png.length} bytes`);
