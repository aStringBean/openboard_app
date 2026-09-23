/**
 * Separable square erode/dilate. Doing each axis in turn is O(r) per pixel
 * rather than O(r²), which keeps a full-frame open cheap enough to run on a
 * phone without a worker.
 */
function pass(
  src: Uint8Array,
  w: number,
  h: number,
  radius: number,
  pick: (a: number, b: number) => number,
  seed: number,
): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = seed;
      for (let d = -radius; d <= radius; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < w) v = pick(v, src[y * w + xx]!);
      }
      tmp[y * w + x] = v;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = seed;
      for (let d = -radius; d <= radius; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < h) v = pick(v, tmp[yy * w + x]!);
      }
      out[y * w + x] = v;
    }
  }

  return out;
}

export const erode = (m: Uint8Array, w: number, h: number, r: number) =>
  pass(m, w, h, r, Math.min, 1);

export const dilate = (m: Uint8Array, w: number, h: number, r: number) =>
  pass(m, w, h, r, Math.max, 0);

/** Erode then dilate: drops speckle without shrinking what survives. */
export function open(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r < 1) return mask;
  return dilate(erode(mask, w, h, r), w, h, r);
}
