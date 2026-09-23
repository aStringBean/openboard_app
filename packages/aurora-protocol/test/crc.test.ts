import { describe, expect, it } from "vitest";
import { auroraCrc } from "../src/index.js";
import { DOC_PKT } from "./helpers.js";

describe("auroraCrc", () => {
  it("matches the documented vector", () => {
    /* The checksum covers the payload, starting at the sequence byte. */
    expect(auroraCrc(DOC_PKT.subarray(4, 4 + DOC_PKT[1]!))).toBe(0xc8);
  });

  it("is 0xff for an empty payload", () => {
    /* The inverse of a zero sum. */
    expect(auroraCrc(new Uint8Array(0))).toBe(0xff);
  });

  it("wraps the running sum at eight bits", () => {
    expect(auroraCrc(Uint8Array.of(0xff, 0x01))).toBe(0xff);
  });
});
