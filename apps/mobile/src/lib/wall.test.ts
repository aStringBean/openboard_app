import { describe, expect, it } from "vitest";

import { angleRange, withAngles, type Wall } from "./wall";

const wall: Wall = { id: "w", name: "Garage", angleMode: "fixed", angles: [40], currentAngle: 40 };

describe("angleRange", () => {
  it("steps from min to max inclusive", () => {
    expect(angleRange(20, 40, 5)).toEqual([20, 25, 30, 35, 40]);
  });

  it("is empty for nonsense", () => {
    expect(angleRange(40, 20, 5)).toEqual([]);
    expect(angleRange(0, 40, 0)).toEqual([]);
  });
});

describe("withAngles", () => {
  it("makes a wall adjustable, keeping the current angle when it is offered", () => {
    expect(withAngles(wall, "adjustable", [30, 40, 50])).toMatchObject({
      angleMode: "adjustable",
      angles: [30, 40, 50],
      currentAngle: 40,
    });
  });

  it("moves the current angle to the nearest one offered", () => {
    expect(withAngles(wall, "adjustable", [20, 25, 45]).currentAngle).toBe(45);
  });

  it("gives a fixed wall exactly one angle", () => {
    const adjustable = withAngles(wall, "adjustable", [20, 30, 40]);
    expect(withAngles(adjustable, "fixed", [35])).toMatchObject({ angles: [35], currentAngle: 35 });
  });

  it("sorts, de-duplicates and drops impossible angles", () => {
    expect(withAngles(wall, "adjustable", [50, 20, 50, -5, 95, 32.5, 40]).angles).toEqual([20, 40, 50]);
  });

  it("ignores a setup with no usable angle", () => {
    expect(withAngles(wall, "adjustable", [-1, 200])).toBe(wall);
  });
});
