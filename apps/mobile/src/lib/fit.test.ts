import { describe, expect, it } from "vitest";

import { fitPhoto } from "./fit";

describe("fitPhoto", () => {
  it("fills the width when the photo is short enough", () => {
    expect(fitPhoto(400, 800, 4 / 3)).toEqual({ width: 400, height: 300 });
  });

  it("shrinks to fit the height when the photo is too tall to fill the width", () => {
    /* The bug this exists for: a tall wall in a short canvas. Width-filling
     * would make it 400 × 448 in a 300-high box and crop 148 of it. */
    const { width, height } = fitPhoto(400, 300, 1079 / 1208);
    expect(height).toBeCloseTo(300);
    expect(width).toBeLessThan(400);
  });

  it("is empty until the box has been measured", () => {
    expect(fitPhoto(0, 0, 1)).toEqual({ width: 0, height: 0 });
  });
});
