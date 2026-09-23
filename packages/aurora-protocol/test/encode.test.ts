import { describe, expect, it } from "vitest";
import {
  chunkPacket,
  decodeFrame,
  encodeAllOff,
  encodeFrame,
  inspect,
  verifyPacket,
  type Led,
} from "../src/index.js";
import { DOC_PKT } from "./helpers.js";

describe("encodeFrame", () => {
  it("reproduces the documented vector byte for byte", () => {
    const packets = encodeFrame([{ pos: 0, r: 0xff, g: 0x00, b: 0xff }]);

    expect(packets).toHaveLength(1);
    expect(packets[0]).toEqual(DOC_PKT);
  });

  it("emits an API 2 record whose position spans the colour byte", () => {
    const [packet] = encodeFrame([{ pos: 300, r: 0xff, g: 0x00, b: 0xff }], { api: 2 });

    /* Sequence byte, then 0x2c and 0b01_11_00_11 — the firmware's own vector. */
    expect(Array.from(packet!.subarray(4))).toEqual([0x50, 0x2c, 0x73, 0x03]);
  });

  it("blanks the wall for an empty frame", () => {
    const packets = encodeFrame([]);

    expect(packets).toHaveLength(1);
    expect(inspect(packets[0]!)).toMatchObject({ first: true, last: true });
    expect(decodeFrame(packets)).toEqual([]);
    expect(encodeAllOff()).toEqual(packets);
  });

  it("produces packets that pass full firmware-side validation", () => {
    const leds = Array.from({ length: 200 }, (_, i) => ({
      pos: i,
      r: i & 0xff,
      g: (i * 3) & 0xff,
      b: (i * 7) & 0xff,
    }));

    for (const packet of encodeFrame(leds)) {
      expect(() => verifyPacket(packet)).not.toThrow();
    }
  });

  describe("fragmentation", () => {
    const leds = (n: number): Led[] =>
      Array.from({ length: n }, (_, i) => ({ pos: i, r: 255, g: 255, b: 255 }));

    it("marks a single packet as both first and last", () => {
      const packets = encodeFrame(leds(4));

      expect(packets).toHaveLength(1);
      expect(inspect(packets[0]!)).toMatchObject({ first: true, last: true });
    });

    it("opens, continues and closes a fragmented message", () => {
      /* 84 API 3 records fill a maximum-length packet, so 200 needs three. */
      const packets = encodeFrame(leds(200));

      expect(packets).toHaveLength(3);
      expect(inspect(packets[0]!)).toMatchObject({ first: true, last: false });
      expect(inspect(packets[1]!)).toMatchObject({ first: false, last: false });
      expect(inspect(packets[2]!)).toMatchObject({ first: false, last: true });
    });

    it("never exceeds the protocol maximum packet length", () => {
      for (const packet of encodeFrame(leds(500))) {
        expect(packet.length).toBeLessThanOrEqual(260);
      }
    });

    it("respects a caller-supplied packet ceiling", () => {
      const packets = encodeFrame(leds(60), { maxPacketBytes: 20 });

      for (const packet of packets) {
        expect(packet.length).toBeLessThanOrEqual(20);
      }
      expect(decodeFrame(packets)).toHaveLength(60);
    });

    it("closes the message when the last batch fills a packet exactly", () => {
      /* 168 records is exactly two full API 3 packets; the boundary is where
       * an off-by-one would leave the frame never pushed to the strip. */
      const packets = encodeFrame(leds(168));

      expect(packets).toHaveLength(2);
      expect(inspect(packets[1]!)).toMatchObject({ last: true });
    });

    it("rejects a ceiling too small to hold one record", () => {
      expect(() => encodeFrame(leds(1), { maxPacketBytes: 6 })).toThrowError(RangeError);
    });
  });

  describe("validation", () => {
    it("rejects a position beyond the API 2 range", () => {
      expect(() => encodeFrame([{ pos: 1024, r: 0, g: 0, b: 0 }], { api: 2 })).toThrowError(
        /out of range for API 2/,
      );
    });

    it("accepts that same position under API 3", () => {
      expect(() => encodeFrame([{ pos: 1024, r: 0, g: 0, b: 0 }])).not.toThrow();
    });

    it("rejects a position beyond the API 3 range", () => {
      expect(() => encodeFrame([{ pos: 65536, r: 0, g: 0, b: 0 }])).toThrowError(RangeError);
    });

    it.each([
      ["negative", -1],
      ["oversized", 256],
      ["fractional", 12.5],
    ])("rejects a %s channel", (_label, value) => {
      expect(() => encodeFrame([{ pos: 0, r: value, g: 0, b: 0 }])).toThrowError(RangeError);
    });

    it("rejects a fractional position", () => {
      expect(() => encodeFrame([{ pos: 1.5, r: 0, g: 0, b: 0 }])).toThrowError(RangeError);
    });
  });
});

describe("chunkPacket", () => {
  it("splits a packet into writes of at most the given size", () => {
    const chunks = chunkPacket(DOC_PKT, 4);

    expect(chunks.map((c) => c.length)).toEqual([4, 4, 1]);
    expect(Uint8Array.from(chunks.flatMap((c) => Array.from(c)))).toEqual(DOC_PKT);
  });

  it("leaves a packet that already fits alone", () => {
    expect(chunkPacket(DOC_PKT, 244)).toHaveLength(1);
  });

  it("rejects a non-positive write size", () => {
    expect(() => chunkPacket(DOC_PKT, 0)).toThrowError(RangeError);
  });
});
