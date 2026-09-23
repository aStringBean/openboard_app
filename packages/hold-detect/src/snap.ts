/** Everything snapping needs: a point. Accepts a `DetectedHold` as-is. */
export interface SnapTarget {
  x: number;
  y: number;
}

/**
 * Default snap radius, as a fraction of the image's smaller side. About the
 * width of a fingertip on a phone-sized photo: wide enough to forgive an
 * imprecise tap, tight enough not to grab the hold next door.
 */
export const DEFAULT_SNAP_RADIUS = 0.04;

/**
 * Index of the hold nearest to a point, or -1 when none is within `radius`.
 * For callers that need to know *which* hold was hit, not just where it is.
 */
export function nearestHold(
  holds: readonly SnapTarget[],
  x: number,
  y: number,
  radius = DEFAULT_SNAP_RADIUS,
): number {
  let best = -1;
  let bestD = radius * radius;

  for (let i = 0; i < holds.length; i++) {
    const hold = holds[i]!;
    const d = (hold.x - x) ** 2 + (hold.y - y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }

  return best;
}

/**
 * Snaps a tap to the centre of the nearest detected hold.
 *
 * Returns the raw tap when nothing is close enough, so an undetected hold
 * still gets placed exactly where the user pointed rather than being dragged
 * onto its neighbour.
 */
export function snapToHold(
  holds: readonly SnapTarget[],
  x: number,
  y: number,
  radius = DEFAULT_SNAP_RADIUS,
): { x: number; y: number; snapped: boolean } {
  const i = nearestHold(holds, x, y, radius);
  const best = i >= 0 ? holds[i]! : null;

  return best ? { x: best.x, y: best.y, snapped: true } : { x, y, snapped: false };
}
