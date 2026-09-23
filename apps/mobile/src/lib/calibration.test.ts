import { describe, expect, it } from "vitest";

import {
  addHold,
  assignLed,
  deleteHold,
  emptyCalibration,
  holdNear,
  mappedHolds,
  markNoHold,
  mergeDetections,
  migrate,
  moveHold,
  nextUndecided,
  resetCalibration,
  undoLast,
  type Calibration,
  type WallHold,
} from "./calibration";

/** A calibration with detected holds at the given points. */
function withDetected(points: [number, number][], snapEnabled = true): Calibration {
  return mergeDetections({ ...emptyCalibration(10), snapEnabled }, points.map(([x, y]) => ({ x, y })));
}

const holdWithLed = (c: Calibration, led: number): WallHold | undefined =>
  c.holds.find((h) => h.led === led);

describe("assignLed", () => {
  it("puts the LED on the detected hold the tap snapped to", () => {
    const c = assignLed(withDetected([[0.3, 0.3], [0.6, 0.6]]), 0, 0.31, 0.29);

    expect(c.holds).toHaveLength(2);
    expect(holdWithLed(c, 0)).toMatchObject({ x: 0.3, y: 0.3, source: "detected" });
  });

  it("prefers a free hold to a nearer one already carrying an LED", () => {
    /* The classic mis-tap: landing back on the hold just mapped. */
    let c = withDetected([[0.3, 0.3], [0.33, 0.3]]);
    c = assignLed(c, 0, 0.3, 0.3);
    c = assignLed(c, 1, 0.305, 0.3);

    expect(holdWithLed(c, 0)).toMatchObject({ x: 0.3 });
    expect(holdWithLed(c, 1)).toMatchObject({ x: 0.33 });
  });

  it("creates a hold at the tap when nothing is in range", () => {
    const c = assignLed(withDetected([[0.1, 0.1]]), 4, 0.8, 0.8);

    expect(c.holds).toHaveLength(2);
    expect(holdWithLed(c, 4)).toMatchObject({ x: 0.8, y: 0.8, source: "manual", createdByLed: 4 });
  });

  it("with snap off, lands exactly on the tap", () => {
    const c = assignLed(withDetected([[0.3, 0.3]], false), 0, 0.36, 0.3);

    expect(c.holds).toHaveLength(2);
    expect(holdWithLed(c, 0)).toMatchObject({ x: 0.36, y: 0.3 });
  });

  it("with snap off, reuses a free hold that must be the same one", () => {
    const c = assignLed(withDetected([[0.3, 0.3]], false), 0, 0.305, 0.302);

    expect(c.holds).toHaveLength(1);
    expect(c.holds[0]).toMatchObject({ led: 0, x: 0.305, y: 0.302, source: "manual" });
  });

  it("clears a previous no-hold decision for that LED", () => {
    const c = assignLed(markNoHold(withDetected([[0.3, 0.3]]), 0), 0, 0.3, 0.3);

    expect(c.noHold).toEqual([]);
    expect(holdWithLed(c, 0)).toBeDefined();
  });

  it("moves an LED when it is decided again", () => {
    let c = withDetected([[0.2, 0.2], [0.7, 0.7]]);
    c = assignLed(c, 3, 0.2, 0.2);
    c = assignLed(c, 3, 0.7, 0.7);

    expect(mappedHolds(c)).toEqual([{ led: 3, x: 0.7, y: 0.7 }]);
  });

  it("keeps positions inside the photo", () => {
    const c = assignLed(emptyCalibration(), 0, 1.2, -0.1);

    expect(holdWithLed(c, 0)).toMatchObject({ x: 1, y: 0 });
  });
});

describe("markNoHold", () => {
  it("records the LED and frees its hold", () => {
    let c = assignLed(withDetected([[0.3, 0.3]]), 2, 0.3, 0.3);
    c = markNoHold(c, 2);

    expect(c.noHold).toEqual([2]);
    expect(c.holds).toEqual([expect.objectContaining({ led: null })]);
  });

  it("removes a hold the sweep created for that LED", () => {
    let c = assignLed(emptyCalibration(), 2, 0.5, 0.5);
    c = markNoHold(c, 2);

    expect(c.holds).toEqual([]);
  });
});

describe("undoLast", () => {
  it("returns nothing when there is nothing to undo", () => {
    expect(undoLast(emptyCalibration())).toBeNull();
  });

  it("unmaps a snapped hold but keeps the hold", () => {
    const c = assignLed(withDetected([[0.3, 0.3]]), 0, 0.3, 0.3);
    const r = undoLast({ ...c, taps: [400] })!;

    expect(r.led).toBe(0);
    expect(r.cal.holds).toEqual([expect.objectContaining({ x: 0.3, led: null })]);
    expect(r.cal.taps).toEqual([]);
    expect(r.cal.nextLed).toBe(0);
  });

  it("deletes a hold the sweep created", () => {
    const c = assignLed(emptyCalibration(), 0, 0.5, 0.5);

    expect(undoLast(c)!.cal.holds).toEqual([]);
  });

  it("reverses the highest decided LED", () => {
    let c = withDetected([[0.1, 0.1], [0.2, 0.2]]);
    c = assignLed(c, 0, 0.1, 0.1);
    c = assignLed(c, 1, 0.2, 0.2);
    c = markNoHold(c, 2);

    const r = undoLast(c)!;
    expect(r.led).toBe(2);
    expect(r.cal.noHold).toEqual([]);
    expect(mappedHolds(r.cal).map((m) => m.led)).toEqual([0, 1]);
  });
});

describe("editing", () => {
  it("adds a hold with no LED", () => {
    const { cal, id } = addHold(emptyCalibration(), 0.4, 0.4);

    expect(cal.holds).toEqual([{ id, x: 0.4, y: 0.4, led: null, source: "manual" }]);
    expect(cal.nextHoldId).toBe(id + 1);
  });

  it("gives every added hold a fresh id", () => {
    const a = addHold(withDetected([[0.1, 0.1], [0.2, 0.2]]), 0.5, 0.5);
    const b = addHold(a.cal, 0.6, 0.6);

    expect(new Set(b.cal.holds.map((h) => h.id)).size).toBe(4);
  });

  it("moves a hold and its LED marker together", () => {
    /* The point of storing the LED on the hold: centring a mapped hold must
     * carry its marker with it. */
    let c = assignLed(withDetected([[0.3, 0.3]]), 7, 0.3, 0.3);
    c = moveHold(c, c.holds[0]!.id, 0.31, 0.295);

    expect(mappedHolds(c)).toEqual([{ led: 7, x: 0.31, y: 0.295 }]);
  });

  it("marks a moved hold manual, so re-detection keeps it", () => {
    let c = withDetected([[0.3, 0.3]]);
    c = moveHold(c, c.holds[0]!.id, 0.32, 0.3);
    c = mergeDetections(c, [{ x: 0.9, y: 0.9 }]);

    expect(c.holds.map((h) => [h.x, h.y])).toEqual([[0.32, 0.3], [0.9, 0.9]]);
  });

  it("keeps a sweep-created hold after it has been moved and its LED undone", () => {
    /* Undo would normally delete a hold the sweep created. Once the user has
     * positioned it by hand it is theirs, and should survive. */
    let c = assignLed(emptyCalibration(), 0, 0.5, 0.5);
    c = moveHold(c, c.holds[0]!.id, 0.52, 0.5);

    expect(undoLast(c)!.cal.holds).toEqual([expect.objectContaining({ x: 0.52, led: null })]);
  });

  it("clamps a move to the photo", () => {
    const { cal, id } = addHold(emptyCalibration(), 0.5, 0.5);

    expect(moveHold(cal, id, -0.2, 1.4).holds[0]).toMatchObject({ x: 0, y: 1 });
  });

  it("returns a deleted hold's LED to undecided", () => {
    let c = withDetected([[0.1, 0.1], [0.2, 0.2]]);
    c = assignLed(c, 0, 0.1, 0.1);
    c = assignLed(c, 1, 0.2, 0.2);
    c = deleteHold(c, holdWithLed(c, 0)!.id);

    expect(nextUndecided(c, 0)).toBe(0);
    expect(mappedHolds(c).map((m) => m.led)).toEqual([1]);
  });
});

describe("holdNear", () => {
  const c = withDetected([[0.5, 0.5]]);
  const view = { width: 400, height: 300, hitPx: 24 };

  it("finds a hold within the hit radius on screen", () => {
    expect(holdNear(c, 0.53, 0.5, { ...view, zoom: 1 })).not.toBeNull();
  });

  it("shrinks the target as the user zooms in", () => {
    /* 0.03 across a 400px canvas is 12px at zoom 1 but 48px at zoom 4 — so a
     * tap beside a hold selects it zoomed out, and adds a new one zoomed in. */
    expect(holdNear(c, 0.53, 0.5, { ...view, zoom: 4 })).toBeNull();
  });
});

describe("mergeDetections", () => {
  it("replaces earlier detections that nobody has touched", () => {
    const c = mergeDetections(withDetected([[0.1, 0.1]]), [{ x: 0.8, y: 0.8 }]);

    expect(c.holds.map((h) => [h.x, h.y])).toEqual([[0.8, 0.8]]);
  });

  it("keeps mapped and hand-placed holds", () => {
    let c = assignLed(withDetected([[0.1, 0.1]]), 0, 0.1, 0.1);
    c = addHold(c, 0.5, 0.5).cal;
    c = mergeDetections(c, []);

    expect(c.holds.map((h) => [h.x, h.y])).toEqual([[0.1, 0.1], [0.5, 0.5]]);
  });

  it("drops a detection that lands on a kept hold", () => {
    let c = assignLed(withDetected([[0.1, 0.1]]), 0, 0.1, 0.1);
    c = mergeDetections(c, [{ x: 0.104, y: 0.1 }, { x: 0.7, y: 0.7 }]);

    expect(c.holds).toHaveLength(2);
  });

  it("never reuses an id", () => {
    let c = withDetected([[0.1, 0.1], [0.2, 0.2]]);
    const before = c.holds.map((h) => h.id);
    c = mergeDetections(c, [{ x: 0.5, y: 0.5 }]);

    expect(before).not.toContain(c.holds[0]!.id);
  });
});

describe("migrate", () => {
  it("turns v1 markers into LEDs on the detected holds they snapped to", () => {
    const c = migrate({
      version: 1,
      chainLength: 5,
      detected: [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.6 }],
      holds: [{ led: 0, x: 0.2, y: 0.2 }],
      noHold: [1],
      taps: [300, 350],
      nextLed: 2,
    });

    expect(c.version).toBe(2);
    expect(c.holds).toHaveLength(2);
    expect(mappedHolds(c)).toEqual([{ led: 0, x: 0.2, y: 0.2 }]);
    expect(c).toMatchObject({ chainLength: 5, noHold: [1], taps: [300, 350], nextLed: 2 });
  });

  it("keeps a v1 marker with no detected hold near it as its own hold", () => {
    const c = migrate({ holds: [{ led: 3, x: 0.9, y: 0.1 }], detected: [] });

    expect(c.holds).toEqual([
      expect.objectContaining({ x: 0.9, y: 0.1, led: 3, source: "manual", createdByLed: 3 }),
    ]);
  });

  it("gives migrated holds unique ids and a next id beyond them", () => {
    const c = migrate({
      detected: [{ x: 0.1, y: 0.1 }],
      holds: [{ led: 0, x: 0.8, y: 0.8 }],
    });

    expect(new Set(c.holds.map((h) => h.id)).size).toBe(2);
    expect(c.nextHoldId).toBeGreaterThan(Math.max(...c.holds.map((h) => h.id)));
  });

  it("passes v2 through unchanged", () => {
    const v2 = assignLed(withDetected([[0.3, 0.3]]), 0, 0.3, 0.3);

    expect(migrate(JSON.parse(JSON.stringify(v2)))).toEqual(v2);
  });

  it("starts empty from nothing or garbage", () => {
    expect(migrate(null)).toEqual(emptyCalibration());
    expect(migrate("nonsense")).toEqual(emptyCalibration());
  });
});

describe("holds used by problems", () => {
  it("survive re-detection even when untouched", () => {
    const c = withDetected([[0.1, 0.1], [0.5, 0.5]]);
    const used = new Set([c.holds[0]!.id]);

    const after = mergeDetections(c, [{ x: 0.9, y: 0.9 }], used);

    expect(after.holds.map((h) => h.id)).toContain(c.holds[0]!.id);
    expect(after.holds.map((h) => h.id)).not.toContain(c.holds[1]!.id);
  });

  it("are unmapped rather than deleted when their LED is undone", () => {
    const c = assignLed(emptyCalibration(), 0, 0.5, 0.5);
    const used = new Set([c.holds[0]!.id]);

    expect(undoLast(c, used)!.cal.holds).toEqual([expect.objectContaining({ x: 0.5, led: null })]);
  });

  it("are unmapped rather than deleted when their LED is marked no-hold", () => {
    const c = assignLed(emptyCalibration(), 3, 0.5, 0.5);
    const used = new Set([c.holds[0]!.id]);

    expect(markNoHold(c, 3, used).holds).toHaveLength(1);
  });

  it("are unmapped rather than deleted when their LED is reassigned", () => {
    let c = assignLed(emptyCalibration(), 3, 0.2, 0.2);
    const used = new Set([c.holds[0]!.id]);
    c = assignLed(c, 3, 0.8, 0.8, used);

    expect(c.holds).toHaveLength(2);
    expect(c.holds.find((h) => h.x === 0.2)).toMatchObject({ led: null });
  });
});

describe("resetCalibration", () => {
  it("clears mappings, timings and unused holds, keeping holds problems use", () => {
    let c = withDetected([[0.1, 0.1], [0.5, 0.5]]);
    c = assignLed(c, 0, 0.1, 0.1);
    c = markNoHold({ ...c, taps: [300], elapsedMs: 9000, photoUri: "file:///wall.jpg" }, 1);
    const used = new Set([c.holds[0]!.id]);

    const r = resetCalibration(c, used);

    expect(r.holds).toEqual([expect.objectContaining({ id: c.holds[0]!.id, led: null, source: "manual" })]);
    expect(r).toMatchObject({ noHold: [], taps: [], elapsedMs: 0, nextLed: 0, photoUri: "file:///wall.jpg" });
    expect(r.nextHoldId).toBe(c.nextHoldId);
  });
});
