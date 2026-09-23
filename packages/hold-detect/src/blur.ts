/**
 * Separable box blur with a running sum, so each pixel costs the same however
 * wide the radius. Used to build a local brightness baseline.
 */
export function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const span = radius * 2 + 1;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[row + clamp(x, w)]!;

    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / span;
      sum += src[row + clamp(x + radius + 1, w)]! - src[row + clamp(x - radius, w)]!;
    }
  }

  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[clamp(y, h) * w + x]!;

    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / span;
      sum += tmp[clamp(y + radius + 1, h) * w + x]! - tmp[clamp(y - radius, h) * w + x]!;
    }
  }

  return out;
}

const clamp = (v: number, n: number) => (v < 0 ? 0 : v >= n ? n - 1 : v);
