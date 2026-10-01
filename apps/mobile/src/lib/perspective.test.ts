import { describe, expect, it } from "vitest";

import { apply, invert, isBoard, multiply, scaling, squareToQuad, type Quad } from "./perspective";

/** A board photographed from below and to the left: nothing parallel. */
const skewed: Quad = [
  { x: 0.12, y: 0.2 },
  { x: 0.85, y: 0.08 },
  { x: 0.93, y: 0.9 },
  { x: 0.05, y: 0.78 },
];

const near = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
};

describe("squareToQuad", () => {
  it("takes each corner of the unit square to its corner of the board", () => {
    const m = squareToQuad(skewed);
    near(apply(m, { x: 0, y: 0 }), 0.12, 0.2);
    near(apply(m, { x: 1, y: 0 }), 0.85, 0.08);
    near(apply(m, { x: 1, y: 1 }), 0.93, 0.9);
    near(apply(m, { x: 0, y: 1 }), 0.05, 0.78);
  });

  it("keeps straight lines straight", () => {
    const m = squareToQuad(skewed);
    const [a, b, c] = [0, 0.37, 1].map((t) => apply(m, { x: t, y: 0.5 }));
    const cross = (b!.x - a!.x) * (c!.y - a!.y) - (b!.y - a!.y) * (c!.x - a!.x);
    expect(cross).toBeCloseTo(0, 12);
  });

  it("is a plain scale and shift for a board photographed square-on", () => {
    const m = squareToQuad([
      { x: 0.1, y: 0.2 },
      { x: 0.9, y: 0.2 },
      { x: 0.9, y: 0.7 },
      { x: 0.1, y: 0.7 },
    ]);
    expect(m[6]).toBeCloseTo(0, 12);
    expect(m[7]).toBeCloseTo(0, 12);
    near(apply(m, { x: 0.5, y: 0.5 }), 0.5, 0.45);
  });
});

describe("invert", () => {
  it("undoes the mapping", () => {
    const m = squareToQuad(skewed);
    const back = invert(m);
    near(apply(back, apply(m, { x: 0.3, y: 0.8 })), 0.3, 0.8);
    near(apply(back, { x: 0.93, y: 0.9 }), 1, 1);
  });

  it("composes with multiply as matrices should", () => {
    const m = multiply(scaling(2000, 1500), invert(squareToQuad(skewed)));
    near(apply(m, { x: 0.85, y: 0.08 }), 2000, 0);
  });

  it("refuses a quad with every corner in one place", () => {
    const p = { x: 0.5, y: 0.5 };
    expect(() => invert(squareToQuad([p, p, p, p]))).toThrow();
  });
});

describe("isBoard", () => {
  it("accepts corners in order, and rejects a bow tie or the wrong way round", () => {
    expect(isBoard(skewed)).toBe(true);
    const [tl, tr, br, bl] = skewed;
    expect(isBoard([tl, tr, bl, br])).toBe(false);
    expect(isBoard([tl, bl, br, tr])).toBe(false);
  });
});
