export interface Component {
  /** Centroid in analysed-image pixels. */
  cx: number;
  cy: number;
  area: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 8-connected components via an explicit stack. Recursion would blow the stack
 * on a large blob, and holds touching each other do produce large blobs.
 */
export interface Labelled {
  components: Component[];
  /** Component index per pixel, or -1 for background. */
  labels: Int32Array;
}

export function connectedComponents(mask: Uint8Array, w: number, h: number): Labelled {
  const seen = new Uint8Array(w * h);
  const labels = new Int32Array(w * h).fill(-1);
  const out: Component[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;

    const id = out.length;
    stack.push(start);
    seen[start] = 1;

    let area = 0;
    let sx = 0;
    let sy = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;

    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p / w) | 0;

      labels[p] = id;
      area++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

          const q = ny * w + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }

    out.push({ cx: sx / area, cy: sy / area, area, x0, y0, x1, y1 });
  }

  return { components: out, labels };
}
