import { describe, expect, it } from "vitest";

import { fromBase64, toBase64 } from "./base64";

describe("base64", () => {
  it("round-trips every length and byte", () => {
    for (let len = 0; len < 40; len++) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + len * 11) & 0xff);
      expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    }
  });

  it("matches the standard encoding", () => {
    expect(toBase64(Uint8Array.from([0x01, 0x03, 0x45, 0x02, 0xb8]))).toBe("AQNFArg=");
    expect(fromBase64("AQNFArg=")).toEqual(Uint8Array.from([0x01, 0x03, 0x45, 0x02, 0xb8]));
    expect(fromBase64("")).toEqual(new Uint8Array(0));
  });
});
