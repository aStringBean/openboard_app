import type { RgbaImage } from "../src/types.js";

export type Rgb = [number, number, number];

/** Plywood-ish, so tests exercise the same low-saturation background as a real wall. */
export const PLYWOOD: Rgb = [186, 154, 108];

export function blank(width: number, height: number, colour: Rgb = PLYWOOD): RgbaImage {
  const data = new Uint8Array(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    data[i * 4] = colour[0];
    data[i * 4 + 1] = colour[1];
    data[i * 4 + 2] = colour[2];
    data[i * 4 + 3] = 255;
  }

  return { width, height, data };
}

/** Paints a filled circle. Coordinates and radius are in pixels. */
export function circle(img: RgbaImage, cx: number, cy: number, r: number, colour: Rgb): RgbaImage {
  for (let y = Math.max(0, cy - r); y <= Math.min(img.height - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(img.width - 1, cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * img.width + x) * 4;
      img.data[i] = colour[0];
      img.data[i + 1] = colour[1];
      img.data[i + 2] = colour[2];
    }
  }
  return img;
}

/** Paints a filled, rounded bar — a rail or an edge. */
export function bar(
  img: RgbaImage,
  cx: number,
  cy: number,
  halfLen: number,
  halfWidth: number,
  colour: Rgb,
  vertical = false,
): RgbaImage {
  const [hx, hy] = vertical ? [halfWidth, halfLen] : [halfLen, halfWidth];

  for (let y = Math.max(0, cy - hy); y <= Math.min(img.height - 1, cy + hy); y++) {
    for (let x = Math.max(0, cx - hx); x <= Math.min(img.width - 1, cx + hx); x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = colour[0];
      img.data[i + 1] = colour[1];
      img.data[i + 2] = colour[2];
    }
  }
  return img;
}

/** Multiplies a rectangle's brightness, imitating a soft shadow across the wall. */
export function shade(img: RgbaImage, x0: number, y0: number, x1: number, y1: number, k: number) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = Math.round(img.data[i]! * k);
      img.data[i + 1] = Math.round(img.data[i + 1]! * k);
      img.data[i + 2] = Math.round(img.data[i + 2]! * k);
    }
  }
  return img;
}

/** Deterministic per-pixel noise, for grain-rejection tests. */
export function speckle(img: RgbaImage, count: number, colour: Rgb, seed = 1): RgbaImage {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  for (let k = 0; k < count; k++) {
    const x = Math.floor(rand() * img.width);
    const y = Math.floor(rand() * img.height);
    const i = (y * img.width + x) * 4;
    img.data[i] = colour[0];
    img.data[i + 1] = colour[1];
    img.data[i + 2] = colour[2];
  }

  return img;
}

/** Nearest detected hold to a truth point, in normalised units. */
export function nearest(holds: { x: number; y: number }[], x: number, y: number) {
  let best = Infinity;
  for (const h of holds) best = Math.min(best, Math.hypot(h.x - x, h.y - y));
  return best;
}
