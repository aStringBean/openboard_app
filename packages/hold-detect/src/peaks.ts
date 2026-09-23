import { distanceTransform } from "./distance.js";

export interface Peak {
  x: number;
  y: number;
  /** Distance to the nearest background pixel — effectively the hold's radius. */
  r: number;
}

/**
 * One peak per hold, from the distance transform of the mask.
 *
 * Holds that touch merge into a single connected blob, and a blob's centroid
 * then falls in the gap between them, so both holds read as missed. Their
 * distance fields still peak separately, so taking local maxima recovers one
 * centre per hold however many are stuck together.
 *
 * Suppression scales with each peak's own radius: a big hold clears a big
 * neighbourhood, a small one only its own, so a dense wall of small holds is
 * not thinned out by one large hold beside it.
 */
const LOCAL_MAX_RADIUS = 2;

/**
 * Joins peaks that sit on one continuous ridge.
 *
 * A long hold — a rail or an edge — has a flat ridge running down it, and the
 * plateau rule above leaves a peak every radius along that ridge. Two holds
 * merely touching instead have a neck between them where the distance field
 * dips sharply. So: walk the straight line between two peaks, and if the
 * distance never drops meaningfully below the smaller of the two, they are one
 * hold seen twice.
 */
function mergeRidgePeaks(peaks: Peak[], dist: Float32Array, w: number, h: number): Peak[] {
  const parent = peaks.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));

  for (let a = 0; a < peaks.length; a++) {
    for (let b = a + 1; b < peaks.length; b++) {
      const pa = peaks[a]!;
      const pb = peaks[b]!;
      const gap = Math.hypot(pa.x - pb.x, pa.y - pb.y);

      /* Only peaks close enough to share a hold are worth walking between. */
      if (gap > (pa.r + pb.r) * 2) continue;

      const floor = Math.min(pa.r, pb.r) * RIDGE_RATIO;
      const steps = Math.max(2, Math.ceil(gap));
      let dips = false;

      for (let s = 1; s < steps && !dips; s++) {
        const t = s / steps;
        const x = Math.round(pa.x + (pb.x - pa.x) * t);
        const y = Math.round(pa.y + (pb.y - pa.y) * t);
        if (dist[y * w + x]! < floor) dips = true;
      }

      if (!dips) parent[find(a)] = find(b);
    }
  }

  const groups = new Map<number, Peak[]>();
  for (let i = 0; i < peaks.length; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(peaks[i]!);
    else groups.set(root, [peaks[i]!]);
  }

  /* One representative per hold, at the middle of its ridge. */
  return [...groups.values()].map((group) => ({
    x: group.reduce((a, p) => a + p.x, 0) / group.length,
    y: group.reduce((a, p) => a + p.y, 0) / group.length,
    r: Math.max(...group.map((p) => p.r)),
  }));
}

/** How far the ridge may dip between two peaks and still count as continuous. */
const RIDGE_RATIO = 0.8;

export function findPeaks(mask: Uint8Array, w: number, h: number, minRadius: number): Peak[] {
  const dist = distanceTransform(mask, w, h);

  /*
   * Only local maxima are eligible. Without this, the ring of shoulder pixels
   * just outside a peak's suppression disc still clears minRadius on a blob
   * of any size, and every hold sprouts a halo of phantom centres. A shoulder
   * pixel always has a higher neighbour on the way to the centre, so the test
   * costs little and removes them all.
   *
   * The comparison is non-strict so that a plateau — the ridge running down a
   * rail or an edge — survives; the suppression pass below then thins it.
   */
  const candidates: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = dist[i]!;
      if (d < minRadius) continue;

      let isMax = true;
      for (let dy = -LOCAL_MAX_RADIUS; dy <= LOCAL_MAX_RADIUS && isMax; dy++) {
        for (let dx = -LOCAL_MAX_RADIUS; dx <= LOCAL_MAX_RADIUS; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (dist[ny * w + nx]! > d) {
            isMax = false;
            break;
          }
        }
      }

      if (isMax) candidates.push(i);
    }
  }

  /* Strongest first, so a hold's true centre claims its neighbourhood before
   * any equal-ranked plateau pixel beside it can. */
  candidates.sort((a, b) => dist[b]! - dist[a]!);

  const taken = new Uint8Array(w * h);
  const peaks: Peak[] = [];

  for (const i of candidates) {
    if (taken[i]) continue;

    const x = i % w;
    const y = (i / w) | 0;
    const r = dist[i]!;
    peaks.push({ x, y, r });

    /* Reach out to the peak's own radius: that covers the whole hold it sits
     * in, while two touching holds keep their centres a full diameter apart
     * and so both survive. */
    const reach = Math.max(1, Math.round(r));
    const x0 = Math.max(0, x - reach);
    const x1 = Math.min(w - 1, x + reach);
    const y0 = Math.max(0, y - reach);
    const y1 = Math.min(h - 1, y + reach);

    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        if ((xx - x) ** 2 + (yy - y) ** 2 <= reach * reach) taken[yy * w + xx] = 1;
      }
    }
  }

  return mergeRidgePeaks(peaks, dist, w, h);
}
