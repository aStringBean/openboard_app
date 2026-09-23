import type { MappedHold as Hold } from "./calibration";

/**
 * Consecutive LED indices sit physically next to each other on the wall — the
 * web prototype measured a median jump of 0.052 across a real 250-LED sweep.
 * A hold far from both of its index neighbours is therefore almost certainly a
 * mis-tap, which turns verification from "check every hold" into "review the
 * handful that look wrong".
 */
const DEFAULT_SIGMA = 4;

const distance = (a: Hold, b: Hold) => Math.hypot(a.x - b.x, a.y - b.y);

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface Outlier {
  led: number;
  /** Distance to the nearer index neighbour, normalised image units. */
  gap: number;
}

/**
 * Flags holds whose distance to their nearest index neighbour is far beyond
 * the typical jump. Scale-free: the threshold comes from the wall's own
 * spacing, so it works for a dense spray wall and a sparse one alike.
 */
export function findOutliers(holds: Hold[], sigma = DEFAULT_SIGMA): Outlier[] {
  const sorted = [...holds].sort((a, b) => a.led - b.led);
  if (sorted.length < 3) return [];

  /* Gap to the nearer neighbour: a hold between two distant ones is suspect
   * only if it is far from both. */
  const gaps = sorted.map((hold, i) => {
    const prev = i > 0 ? distance(hold, sorted[i - 1]!) : Infinity;
    const next = i < sorted.length - 1 ? distance(hold, sorted[i + 1]!) : Infinity;
    return Math.min(prev, next);
  });

  const finite = gaps.filter(Number.isFinite);
  const typical = median(finite);
  if (typical === 0) return [];

  return sorted
    .map((hold, i) => ({ led: hold.led, gap: gaps[i]! }))
    .filter((o) => Number.isFinite(o.gap) && o.gap > typical * sigma)
    .sort((a, b) => b.gap - a.gap);
}
