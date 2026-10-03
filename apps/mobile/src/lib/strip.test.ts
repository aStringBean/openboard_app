import { describe, expect, it } from "vitest";

import { stripShortfall } from "./strip";

const holds = (...leds: (number | null)[]) => leds.map((led) => ({ led }));

describe("stripShortfall", () => {
  it("is null when the strip reaches every LED the wall uses", () => {
    expect(stripShortfall(holds(0, 249, null), 250)).toBeNull();
    expect(stripShortfall(holds(), 250)).toBeNull();
  });

  it("counts the holds past the end, and the length that reaches them", () => {
    /* LED 250 is the 251st: one past the end of a 250-LED strip. */
    expect(stripShortfall(holds(0, 250, 501, null), 250)).toEqual({ needed: 502, holdsPast: 2 });
  });

  it("ignores holds without an LED", () => {
    expect(stripShortfall(holds(null, null), 1)).toBeNull();
  });
});
