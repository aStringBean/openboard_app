/**
 * Mirror layouts: boards set up so the right half is the left half reflected,
 * hold for hold. Any problem then has a mirrored twin, lit on the partner of
 * each of its holds. Pure, so it can be tested in Node.
 */
import type { ProblemHold } from "./problem";

/**
 * Which hold mirrors which. A hold on the centre line is its own partner,
 * stored as [id, id]. A hold that appears in no pair has none.
 */
export interface Mirror {
  pairs: [number, number][];
}

/** Hold id to partner id, both ways round. */
export type MirrorMap = ReadonlyMap<number, number>;

interface Pos {
  id: number;
  x: number;
  y: number;
}

/**
 * Pairs every hold with the one at its reflection across the board's
 * vertical centre line.
 *
 * Meant for a straightened photo, where the board fills the frame and its
 * centre line is the photo's, near enough. The line is still fitted rather
 * than assumed: corners marked a little off shift it, so it is put wherever
 * the most holds find a partner. A centre column needs nothing special — its
 * holds reflect onto themselves — and nor does a board without one.
 *
 * Pairs are taken closest first, each hold in one pair at most, so two holds
 * never share a partner.
 */
export function pairHolds(holds: readonly Pos[]): { mirror: Mirror; axis: number; unpaired: number[] } {
  if (holds.length === 0) return { mirror: { pairs: [] }, axis: 0.5, unpaired: [] };

  /* Close enough to be a hold's partner: a third of the typical spacing. */
  const tol = spacing(holds) / 3;

  /* Most holds partnered wins; among equals, the line whose reflections land
   * closest to their partners. */
  let axis = 0.5;
  let best = { found: -1, miss: Infinity };
  for (let a = 0.4; a <= 0.6 + 1e-9; a += 0.0025) {
    let found = 0;
    let miss = 0;
    for (const h of holds) {
      const d = nearestDistance(holds, 2 * a - h.x, h.y);
      if (d <= tol) {
        found++;
        miss += d;
      }
    }
    if (found > best.found || (found === best.found && miss < best.miss)) {
      best = { found, miss };
      axis = a;
    }
  }

  const candidates: { a: number; b: number; d: number }[] = [];
  for (const h of holds) {
    const mx = 2 * axis - h.x;
    for (const o of holds) {
      const d = Math.hypot(o.x - mx, o.y - h.y);
      if (d <= tol && h.id <= o.id) candidates.push({ a: h.id, b: o.id, d });
    }
  }
  candidates.sort((p, q) => p.d - q.d);

  const used = new Set<number>();
  const pairs: [number, number][] = [];
  for (const { a, b } of candidates) {
    if (used.has(a) || used.has(b)) continue;
    used.add(a);
    used.add(b);
    pairs.push([a, b]);
  }
  pairs.sort((p, q) => p[0] - q[0]);

  return { mirror: { pairs }, axis, unpaired: holds.filter((h) => !used.has(h.id)).map((h) => h.id) };
}

/** Partners by hold, for holds that still exist. */
export function mirrorMap(m: Mirror | null, holdIds?: Iterable<number>): MirrorMap {
  const exists = holdIds ? new Set(holdIds) : null;
  const map = new Map<number, number>();
  for (const [a, b] of m?.pairs ?? []) {
    if (exists && (!exists.has(a) || !exists.has(b))) continue;
    map.set(a, b);
    map.set(b, a);
  }
  return map;
}

/** Makes a and b partners, ending whatever pairs either was in. a === b puts a hold on the centre line. */
export function setPair(m: Mirror, a: number, b: number): Mirror {
  const pairs = m.pairs.filter(([x, y]) => x !== a && y !== a && x !== b && y !== b);
  pairs.push(a <= b ? [a, b] : [b, a]);
  pairs.sort((p, q) => p[0] - q[0]);
  return { pairs };
}

/** Leaves a hold with no partner. */
export function unpair(m: Mirror, a: number): Mirror {
  return { pairs: m.pairs.filter(([x, y]) => x !== a && y !== a) };
}

/**
 * The problem as climbed mirrored: each hold swapped for its partner, roles
 * kept. Null if any hold has no partner, since then there is no mirrored
 * problem to climb.
 */
export function mirrorProblem(holds: readonly ProblemHold[], map: MirrorMap): ProblemHold[] | null {
  const out: ProblemHold[] = [];
  for (const h of holds) {
    const partner = map.get(h.holdId);
    if (partner === undefined) return null;
    out.push({ holdId: partner, role: h.role });
  }
  return out;
}

/** Holds of a problem with no partner. */
export const unpairedIn = (holds: readonly ProblemHold[], map: MirrorMap): number[] =>
  holds.filter((h) => !map.has(h.holdId)).map((h) => h.holdId);

/**
 * Whether a problem has a distinct mirrored twin to climb: every hold has a
 * partner, and the reflection is not the problem itself (a symmetric problem
 * is the same climb both ways round).
 */
export function hasTwin(holds: readonly ProblemHold[], map: MirrorMap): boolean {
  const twin = mirrorProblem(holds, map);
  if (!twin) return false;
  const key = (hs: readonly ProblemHold[]) =>
    hs
      .map((h) => `${h.holdId}:${h.role}`)
      .sort()
      .join(",");
  return key(twin) !== key(holds);
}

/** Reads the stored form, dropping anything malformed. */
export function parseMirror(v: unknown): Mirror | null {
  if (typeof v === "string") {
    try {
      return parseMirror(JSON.parse(v));
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || !Array.isArray((v as { pairs?: unknown }).pairs)) return null;
  const pairs = (v as { pairs: unknown[] }).pairs.filter(
    (p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n) && n >= 0),
  );
  return { pairs };
}

/** Median distance from each hold to its nearest neighbour. */
function spacing(holds: readonly Pos[]): number {
  if (holds.length < 2) return 0.05;
  const d = holds
    .map((a) => Math.min(...holds.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y))))
    .sort((p, q) => p - q);
  return d[d.length >> 1]!;
}

function nearestDistance(holds: readonly Pos[], x: number, y: number): number {
  let d = Infinity;
  for (const h of holds) d = Math.min(d, Math.hypot(h.x - x, h.y - y));
  return d;
}
