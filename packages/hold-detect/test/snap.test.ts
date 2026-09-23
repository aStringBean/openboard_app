import { describe, expect, it } from "vitest";
import { nearestHold, snapToHold, type DetectedHold } from "../src/index.js";

const hold = (x: number, y: number): DetectedHold => ({
  x,
  y,
  area: 0.001,
  bbox: { x0: x - 0.01, y0: y - 0.01, x1: x + 0.01, y1: y + 0.01 },
});

describe("snapToHold", () => {
  const holds = [hold(0.3, 0.3), hold(0.5, 0.5), hold(0.8, 0.2)];

  it("snaps a near miss to the hold centre", () => {
    const r = snapToHold(holds, 0.32, 0.31);

    expect(r).toEqual({ x: 0.3, y: 0.3, snapped: true });
  });

  it("picks the nearest when two are in range", () => {
    expect(snapToHold(holds, 0.4, 0.4, 0.2).x).toBeCloseTo(0.5, 5);
    expect(snapToHold(holds, 0.35, 0.35, 0.2).x).toBeCloseTo(0.3, 5);
  });

  it("keeps the raw tap when nothing is close", () => {
    /* An undetected hold must still land where the user pointed, rather than
     * being dragged onto its neighbour. */
    const r = snapToHold(holds, 0.05, 0.9);

    expect(r).toEqual({ x: 0.05, y: 0.9, snapped: false });
  });

  it("keeps the raw tap when nothing was detected at all", () => {
    expect(snapToHold([], 0.42, 0.42)).toEqual({ x: 0.42, y: 0.42, snapped: false });
  });

  it("respects a custom radius", () => {
    expect(snapToHold(holds, 0.36, 0.3, 0.01).snapped).toBe(false);
    expect(snapToHold(holds, 0.36, 0.3, 0.1).snapped).toBe(true);
  });
});

describe("nearestHold", () => {
  const holds = [hold(0.3, 0.3), hold(0.5, 0.5), hold(0.8, 0.2)];

  it("returns the index of the nearest hold in range", () => {
    expect(nearestHold(holds, 0.49, 0.52)).toBe(1);
  });

  it("returns -1 when nothing is in range", () => {
    expect(nearestHold(holds, 0.05, 0.9)).toBe(-1);
    expect(nearestHold([], 0.5, 0.5)).toBe(-1);
  });
});
