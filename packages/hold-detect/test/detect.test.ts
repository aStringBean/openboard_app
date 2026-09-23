import { describe, expect, it } from "vitest";
import { detectHolds } from "../src/index.js";
import { bar, blank, circle, nearest, shade, speckle, PLYWOOD } from "./synth.js";

const W = 400;
const H = 300;

describe("detectHolds", () => {
  it("finds coloured holds on plywood", () => {
    const img = blank(W, H);
    const truth: [number, number][] = [
      [80, 60],
      [200, 120],
      [320, 200],
    ];
    circle(img, 80, 60, 9, [220, 40, 40]);
    circle(img, 200, 120, 9, [40, 90, 220]);
    circle(img, 320, 200, 9, [30, 180, 90]);

    const holds = detectHolds(img);

    expect(holds).toHaveLength(3);
    for (const [x, y] of truth) {
      expect(nearest(holds, x / W, y / H)).toBeLessThan(0.02);
    }
  });

  it("finds black and white holds, which have almost no chroma", () => {
    const img = blank(W, H);
    circle(img, 120, 80, 10, [15, 15, 18]);
    circle(img, 280, 180, 10, [245, 245, 245]);

    const holds = detectHolds(img);

    expect(holds).toHaveLength(2);
    expect(nearest(holds, 120 / W, 80 / H)).toBeLessThan(0.02);
    expect(nearest(holds, 280 / W, 180 / H)).toBeLessThan(0.02);
  });

  it("puts the centroid at the centre of the hold", () => {
    const img = blank(W, H);
    circle(img, 200, 150, 14, [200, 60, 160]);

    const [hold] = detectHolds(img);

    expect(hold!.x).toBeCloseTo(200 / W, 2);
    expect(hold!.y).toBeCloseTo(150 / H, 2);
  });

  it("ignores a soft shadow across the wall", () => {
    /* A shadow is low-frequency, so the local brightness baseline should
     * absorb it. A global one would report the whole shaded half. */
    const img = blank(W, H);
    shade(img, 0, 0, W, Math.floor(H / 2), 0.62);
    circle(img, 300, 220, 10, [220, 40, 40]);

    const holds = detectHolds(img);

    expect(holds).toHaveLength(1);
    expect(nearest(holds, 300 / W, 220 / H)).toBeLessThan(0.02);
  });

  it("rejects sensor grain", () => {
    const img = blank(W, H);
    speckle(img, 500, [90, 70, 50]);
    circle(img, 200, 150, 11, [40, 90, 220]);

    const holds = detectHolds(img);

    expect(holds).toHaveLength(1);
  });

  it("rejects a region too large to be a hold", () => {
    const img = blank(W, H);
    /* A rucksack leaning against the wall, or the mat. */
    for (let y = 0; y < 120; y++) circle(img, 200, y, 60, [30, 30, 120]);

    expect(detectHolds(img)).toHaveLength(0);
  });

  it("handles a full-resolution photo by downscaling", () => {
    const big = blank(2000, 1500);
    circle(big, 500, 400, 45, [220, 40, 40]);
    circle(big, 1400, 1000, 45, [40, 90, 220]);

    const holds = detectHolds(big);

    expect(holds).toHaveLength(2);
    expect(nearest(holds, 500 / 2000, 400 / 1500)).toBeLessThan(0.02);
  });

  it("returns nothing for a blank wall", () => {
    expect(detectHolds(blank(W, H, PLYWOOD))).toHaveLength(0);
  });

  it("orders holds largest first", () => {
    const img = blank(W, H);
    circle(img, 100, 100, 6, [220, 40, 40]);
    circle(img, 300, 200, 16, [40, 90, 220]);

    const holds = detectHolds(img);

    expect(holds[0]!.area).toBeGreaterThan(holds[1]!.area);
  });
});

describe("holds that touch", () => {
  it("separates two touching holds", () => {
    /* A blob spanning both would put its centroid in the gap between them,
     * losing both holds. Their distance fields still peak separately. */
    const img = blank(W, H);
    circle(img, 190, 150, 13, [220, 40, 40]);
    circle(img, 214, 150, 13, [40, 90, 220]);

    const holds = detectHolds(img);

    expect(holds).toHaveLength(2);
    expect(nearest(holds, 190 / W, 150 / H)).toBeLessThan(0.025);
    expect(nearest(holds, 214 / W, 150 / H)).toBeLessThan(0.025);
  });

  it("separates a row of three touching holds", () => {
    const img = blank(W, H);
    for (const cx of [170, 200, 230]) circle(img, cx, 150, 15, [30, 180, 90]);

    expect(detectHolds(img)).toHaveLength(3);
  });

  it("keeps a long rail as one hold, centred", () => {
    /* The ridge down a rail has no dip, so the peaks along it are one hold
     * seen several times — unlike two holds, which have a neck between. */
    const img = blank(W, H);
    bar(img, 200, 150, 55, 9, [240, 220, 40]);

    const holds = detectHolds(img);

    expect(holds).toHaveLength(1);
    /* Mid-rail, within a couple of pixels — the ridge centroid does not land
     * on the exact geometric centre and does not need to. */
    expect(nearest(holds, 200 / W, 150 / H)).toBeLessThan(0.02);
  });

  it("keeps a tall edge as one hold", () => {
    const img = blank(W, H);
    bar(img, 200, 150, 50, 8, [200, 60, 160], true);

    expect(detectHolds(img)).toHaveLength(1);
  });

  it("tells a rail apart from two holds beside it", () => {
    const img = blank(W, H);
    bar(img, 120, 90, 45, 8, [240, 220, 40]);
    circle(img, 270, 200, 14, [220, 40, 40]);
    circle(img, 298, 200, 14, [40, 90, 220]);

    expect(detectHolds(img)).toHaveLength(3);
  });
});
