import { describe, expect, it } from "vitest";
import {
  decodeFrame,
  encodeFrame,
  expand2,
  expand3,
  quantize,
  type Led,
} from "../src/index.js";

describe("colour quantisation", () => {
  it("round-trips every 3 bit level", () => {
    for (let v = 0; v <= 7; v++) {
      expect(quantize(expand3(v), 3)).toBe(v);
    }
  });

  it("round-trips every 2 bit level", () => {
    for (let v = 0; v <= 3; v++) {
      expect(quantize(expand2(v), 2)).toBe(v);
    }
  });

  it("saturates rather than falling short", () => {
    expect(expand3(0x07)).toBe(0xff);
    expect(expand2(0x03)).toBe(0xff);
  });
});

describe("encode then decode", () => {
  /* Colours that survive the wire exactly: the role palette should be chosen
   * from these so what the app draws is what the wall shows. */
  const exact: Led[] = [
    { pos: 0, r: 0xff, g: 0x00, b: 0x00 },
    { pos: 1, r: 0x00, g: 0xff, b: 0x00 },
    { pos: 2, r: 0x00, g: 0x00, b: 0xff },
    { pos: 3, r: 0xff, g: 0xff, b: 0xff },
    { pos: 4, r: 0x00, g: 0x00, b: 0x00 },
    { pos: 65535, r: 0xff, g: 0x00, b: 0xff },
  ];

  it("preserves representable colours exactly", () => {
    expect(decodeFrame(encodeFrame(exact))).toEqual(exact);
  });

  it("preserves position and ordering across fragmentation", () => {
    const leds: Led[] = Array.from({ length: 400 }, (_, i) => ({
      pos: i * 3,
      r: 0xff,
      g: 0x00,
      b: 0x00,
    }));

    expect(decodeFrame(encodeFrame(leds))).toEqual(leds);
  });

  it("is idempotent: re-encoding a decoded frame gives the same bytes", () => {
    const leds: Led[] = Array.from({ length: 150 }, (_, i) => ({
      pos: i,
      r: (i * 11) & 0xff,
      g: (i * 29) & 0xff,
      b: (i * 47) & 0xff,
    }));

    const once = encodeFrame(leds);
    const twice = encodeFrame(decodeFrame(once));

    expect(twice).toEqual(once);
  });

  it("quantises an arbitrary colour to within one level", () => {
    /* API 3 gives 8 red/green levels and 4 blue ones, so the worst case error
     * is half a step: ~18 for r/g, ~42 for b. */
    const leds: Led[] = [{ pos: 0, r: 100, g: 150, b: 200 }];
    const [got] = decodeFrame(encodeFrame(leds));

    expect(Math.abs(got!.r - 100)).toBeLessThanOrEqual(18);
    expect(Math.abs(got!.g - 150)).toBeLessThanOrEqual(18);
    expect(Math.abs(got!.b - 200)).toBeLessThanOrEqual(43);
  });
});
