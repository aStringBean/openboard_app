/**
 * The calibration model and every operation on it, as pure functions.
 *
 * Kept free of React Native so it can be unit tested: these functions rewrite
 * the user's hold map, and a bug here silently corrupts calibration that took
 * real time on a real wall to capture.
 */
import { DEFAULT_SNAP_RADIUS, nearestHold } from "@openboard/hold-detect";

export interface WallHold {
  id: number;
  /** Normalised to the photo, 0..1, so positions survive any display size. */
  x: number;
  y: number;
  /** The LED beside this hold, once the sweep has found it. */
  led: number | null;
  /**
   * `detected` holds came from image detection and are replaced when the
   * photo is re-detected. `manual` holds were placed *or adjusted* by hand,
   * and re-detection never touches them — so centring a hold is not undone
   * by the next detection run.
   */
  source: "detected" | "manual";
  /**
   * Set when a sweep tap had to create this hold because nothing was near
   * enough to snap to. Undoing that decision then removes the hold rather
   * than leaving a stray one behind.
   */
  createdByLed?: number;
}

/** The shape the outlier check and the export work in. */
export interface MappedHold {
  led: number;
  x: number;
  y: number;
}

export interface Calibration {
  version: 2;
  chainLength: number;
  photoUri: string | null;
  /** width / height of the photo, needed to lay it out before it loads. */
  photoAspect: number | null;
  /**
   * Every hold on the wall, and the single source of truth for positions. An
   * LED is an attribute of the hold beside it, so moving a hold moves its LED
   * marker with it.
   */
  holds: WallHold[];
  nextHoldId: number;
  /** LED positions with no hold beside them — distinct from "not yet done". */
  noHold: number[];
  /** Snapping is on by default, but has to be escapable. */
  snapEnabled: boolean;
  /** Milliseconds per decision, in order. */
  taps: number[];
  nextLed: number;
  elapsedMs: number;
}

export const emptyCalibration = (chainLength = 250): Calibration => ({
  version: 2,
  chainLength,
  photoUri: null,
  photoAspect: null,
  holds: [],
  nextHoldId: 0,
  noHold: [],
  snapEnabled: true,
  taps: [],
  nextLed: 0,
  elapsedMs: 0,
});

/**
 * Two holds closer than this are one hold placed twice. Well under the
 * spacing of even a dense commercial board (~0.03).
 */
export const SAME_HOLD_RADIUS = 0.012;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Holds that problems use. Nothing here may delete or replace them — undoing
 * an LED only unmaps such a hold, and re-detection keeps it — or a problem
 * would silently lose a hold. The database enforces the same rule as a
 * backstop.
 */
export type Protected = ReadonlySet<number>;
const NONE: Protected = new Set();

/** Drops the sweep bookkeeping from a hold, leaving it an ordinary hold. */
function unmapped({ createdByLed: _created, ...hold }: WallHold): WallHold {
  return { ...hold, led: null };
}

// ------------------------------------------------------------------- queries

export function mappedHolds(c: Calibration): MappedHold[] {
  return c.holds
    .filter((h): h is WallHold & { led: number } => h.led !== null)
    .map((h) => ({ led: h.led, x: h.x, y: h.y }))
    .sort((a, b) => a.led - b.led);
}

export const decidedCount = (c: Calibration): number =>
  c.holds.reduce((n, h) => n + (h.led !== null ? 1 : 0), 0) + c.noHold.length;

/** First LED at or after `from` that has no decision yet. */
export function nextUndecided(c: Calibration, from: number): number {
  const done = new Set<number>(c.noHold);
  for (const h of c.holds) if (h.led !== null) done.add(h.led);

  let n = from;
  while (n < c.chainLength && done.has(n)) n++;
  return n;
}

/**
 * The hold under a tap, judged in screen pixels rather than image units, so
 * zooming in shrinks the target in the photo. That is what lets a user add a
 * hold right beside a detected neighbour: zoom until they are apart.
 */
export function holdNear(
  c: Pick<Calibration, "holds">,
  x: number,
  y: number,
  view: { width: number; height: number; zoom: number; hitPx: number },
): WallHold | null {
  let best: WallHold | null = null;
  let bestD = view.hitPx;

  for (const h of c.holds) {
    const d = Math.hypot((h.x - x) * view.width, (h.y - y) * view.height) * view.zoom;
    if (d <= bestD) {
      bestD = d;
      best = h;
    }
  }

  return best;
}

// --------------------------------------------------------------------- sweep

/**
 * Takes an LED off whichever hold carries it. A hold the sweep created for
 * that LED goes with it — unless a problem uses it, in which case it stays,
 * unmapped, like any other hold.
 */
function releaseLed(holds: WallHold[], led: number, keep: Protected): WallHold[] {
  return holds
    .filter((h) => !(h.led === led && h.createdByLed === led && !keep.has(h.id)))
    .map((h) => (h.led === led ? unmapped(h) : h));
}

/**
 * Records that LED `led` sits beside the hold at the tapped point.
 *
 * Only holds without an LED are candidates. Each LED belongs to exactly one
 * hold, so a tap that lands near an already-mapped hold goes to the nearest
 * free one instead — which quietly corrects the common mis-tap onto the hold
 * just mapped, and never strips an earlier LED of its hold.
 *
 * With snap on, the tap goes to the nearest free hold within the snap radius.
 * With snap off it lands exactly where tapped, reusing a free hold only if one
 * is so close it must be the same hold. If nothing qualifies, a hold is
 * created at the tap.
 */
export function assignLed(
  c: Calibration,
  led: number,
  x: number,
  y: number,
  keep: Protected = NONE,
): Calibration {
  const holds = releaseLed(c.holds, led, keep);
  const free = holds.filter((h) => h.led === null);
  const radius = c.snapEnabled ? DEFAULT_SNAP_RADIUS : SAME_HOLD_RADIUS;
  const hit = nearestHold(free, x, y, radius);

  if (hit >= 0) {
    const target = free[hit]!;
    return {
      ...c,
      holds: holds.map((h) =>
        h.id !== target.id
          ? h
          : c.snapEnabled
            ? { ...h, led }
            : { ...h, led, x: clamp01(x), y: clamp01(y), source: "manual" },
      ),
      noHold: c.noHold.filter((n) => n !== led),
    };
  }

  return {
    ...c,
    holds: [
      ...holds,
      { id: c.nextHoldId, x: clamp01(x), y: clamp01(y), led, source: "manual", createdByLed: led },
    ],
    nextHoldId: c.nextHoldId + 1,
    noHold: c.noHold.filter((n) => n !== led),
  };
}

/** Records that LED `led` has no hold beside it. */
export function markNoHold(c: Calibration, led: number, keep: Protected = NONE): Calibration {
  return {
    ...c,
    holds: releaseLed(c.holds, led, keep),
    noHold: [...c.noHold.filter((n) => n !== led), led],
  };
}

/**
 * Reverses the most recent decision — the highest decided LED, since a sweep
 * runs in order. Returns the LED so the caller can light it again.
 */
export function undoLast(
  c: Calibration,
  keep: Protected = NONE,
): { cal: Calibration; led: number } | null {
  const decided = [...c.noHold];
  for (const h of c.holds) if (h.led !== null) decided.push(h.led);
  if (!decided.length) return null;

  const led = Math.max(...decided);

  return {
    led,
    cal: {
      ...c,
      holds: releaseLed(c.holds, led, keep),
      noHold: c.noHold.filter((n) => n !== led),
      taps: c.taps.slice(0, -1),
      nextLed: led,
    },
  };
}

// ------------------------------------------------------------------- editing

export function addHold(c: Calibration, x: number, y: number): { cal: Calibration; id: number } {
  const id = c.nextHoldId;
  return {
    id,
    cal: {
      ...c,
      holds: [...c.holds, { id, x: clamp01(x), y: clamp01(y), led: null, source: "manual" }],
      nextHoldId: id + 1,
    },
  };
}

/**
 * Moves a hold. It becomes `manual`, so re-detection keeps it, and it loses
 * any sweep-created status: once positioned by hand it is the user's, and
 * undoing its LED should leave it in place rather than delete their work.
 */
export function moveHold(c: Calibration, id: number, x: number, y: number): Calibration {
  return {
    ...c,
    holds: c.holds.map((h) => {
      if (h.id !== id) return h;
      const { createdByLed: _created, ...rest } = h;
      return { ...rest, x: clamp01(x), y: clamp01(y), source: "manual" };
    }),
  };
}

/** Deletes a hold. Its LED, if it had one, goes back to needing a decision. */
export function deleteHold(c: Calibration, id: number): Calibration {
  return { ...c, holds: c.holds.filter((h) => h.id !== id) };
}

// ----------------------------------------------------------------- detection

/**
 * Folds a fresh detection run into the hold set.
 *
 * Holds the user has invested in — mapped to an LED, placed or moved by hand,
 * or used in a problem — are kept exactly as they are. Everything else from
 * earlier detection is replaced, and new detections landing on a kept hold
 * are dropped as duplicates.
 */
export function mergeDetections(
  c: Calibration,
  found: readonly { x: number; y: number }[],
  keep: Protected = NONE,
): Calibration {
  const kept = c.holds.filter((h) => h.led !== null || h.source === "manual" || keep.has(h.id));
  let id = c.nextHoldId;

  const added: WallHold[] = [];
  for (const f of found) {
    if (nearestHold(kept, f.x, f.y, SAME_HOLD_RADIUS) >= 0) continue;
    added.push({ id: id++, x: f.x, y: f.y, led: null, source: "detected" });
  }

  return { ...c, holds: [...kept, ...added], nextHoldId: id };
}

/**
 * Starts calibration over: every LED mapping, no-hold decision and timing is
 * cleared, as are holds nobody depends on. Holds used by problems stay, now
 * unmapped, so their problems still point at something.
 */
export function resetCalibration(c: Calibration, keep: Protected = NONE): Calibration {
  return {
    ...emptyCalibration(c.chainLength),
    photoUri: c.photoUri,
    photoAspect: c.photoAspect,
    snapEnabled: c.snapEnabled,
    holds: c.holds.filter((h) => keep.has(h.id)).map((h) => ({ ...unmapped(h), source: "manual" as const })),
    /* Ids are never reused, even across a reset. */
    nextHoldId: c.nextHoldId,
  };
}

// ----------------------------------------------------------------- migration

interface CalibrationV1 {
  version?: 1;
  chainLength?: number;
  photoUri?: string | null;
  photoAspect?: number | null;
  /** v1 kept LED markers and snap targets as separate position lists. */
  holds?: { led: number; x: number; y: number }[];
  detected?: { x: number; y: number }[];
  noHold?: number[];
  snapEnabled?: boolean;
  taps?: number[];
  nextLed?: number;
  elapsedMs?: number;
}

/**
 * Reads stored calibration of any version into the current shape.
 *
 * v1 stored a marker's position as a copy of the dot it snapped to. Each
 * marker is matched back to the nearest free detected hold, and becomes an
 * LED on that hold; a marker with no hold near it becomes a hold of its own.
 */
export function migrate(raw: unknown): Calibration {
  if (!raw || typeof raw !== "object") return emptyCalibration();

  const r = raw as Partial<Calibration> & CalibrationV1;

  if (r.version === 2) {
    return { ...emptyCalibration(r.chainLength ?? 250), ...(r as Calibration) };
  }

  let id = 0;
  const holds: WallHold[] = (r.detected ?? []).map((d) => ({
    id: id++,
    x: d.x,
    y: d.y,
    led: null,
    source: "detected",
  }));

  for (const m of r.holds ?? []) {
    const free = holds.filter((h) => h.led === null);
    const hit = nearestHold(free, m.x, m.y, SAME_HOLD_RADIUS);

    if (hit >= 0) {
      free[hit]!.led = m.led;
    } else {
      holds.push({ id: id++, x: m.x, y: m.y, led: m.led, source: "manual", createdByLed: m.led });
    }
  }

  return {
    ...emptyCalibration(r.chainLength ?? 250),
    photoUri: r.photoUri ?? null,
    photoAspect: r.photoAspect ?? null,
    holds,
    nextHoldId: id,
    noHold: r.noHold ?? [],
    snapEnabled: r.snapEnabled ?? true,
    taps: r.taps ?? [],
    nextLed: r.nextLed ?? 0,
    elapsedMs: r.elapsedMs ?? 0,
  };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Calibration as JSON for analysis. `holds` keeps the shape the web prototype
 * exports; `holdSet` adds every hold, including those with no LED yet.
 */
export function toExportJson(c: Calibration): string {
  return JSON.stringify(
    {
      version: 1,
      chainLength: c.chainLength,
      holds: mappedHolds(c),
      noHold: [...c.noHold].sort((a, b) => a - b),
      holdSet: c.holds.map(({ id, x, y, led, source }) => ({ id, x, y, led, source })),
      calibration: {
        totalMs: c.elapsedMs,
        medianTapMs: median(c.taps),
        decisions: c.taps.length,
        /* The raw timings: the median alone hides the long tail. */
        tapMs: c.taps,
      },
    },
    null,
    2,
  );
}
