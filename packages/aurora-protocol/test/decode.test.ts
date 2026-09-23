/**
 * Ported from the `aurora` ztest suite in the firmware's
 * tests/parse/src/main.c. The vectors are unchanged so a divergence between
 * this codec and the controller shows up here.
 */
import { describe, expect, it } from "vitest";
import {
  AuroraProtocolError,
  decodePacket,
  inspect,
  verifyPacket,
} from "../src/index.js";
import { buildPkt, DOC_PKT } from "./helpers.js";

describe("inspect", () => {
  it("reads the documented API 3 vector", () => {
    const info = inspect(DOC_PKT);

    expect(info.api).toBe(3);
    expect(info.first).toBe(true); // a lone packet opens the message
    expect(info.last).toBe(true); //  ...and closes it
  });

  it.each([
    [0x4e, 2, true, false],
    [0x4d, 2, false, false],
    [0x4f, 2, false, true],
    [0x50, 2, true, true],
    [0x52, 3, true, false],
    [0x51, 3, false, false],
    [0x53, 3, false, true],
    [0x54, 3, true, true],
  ])("maps sequence byte 0x%s to api %i first=%s last=%s", (seq, api, first, last) => {
    expect(inspect(buildPkt([seq]))).toEqual({ api, first, last });
  });

  it("rejects a bad packet start byte", () => {
    const pkt = buildPkt([0x54, 0x00, 0x00, 0xe3]);
    pkt[0] = 0x00;

    expect(() => inspect(pkt)).toThrowError(
      expect.objectContaining({ code: "EINVAL" }) as Error,
    );
  });

  it("rejects a bad data start byte", () => {
    const pkt = buildPkt([0x54, 0x00, 0x00, 0xe3]);
    pkt[3] = 0x00;

    expect(() => inspect(pkt)).toThrowError(
      expect.objectContaining({ code: "EINVAL" }) as Error,
    );
  });

  it("rejects a payload with no sequence byte", () => {
    const pkt = buildPkt([0x54, 0x00, 0x00, 0xe3]);
    pkt[1] = 0;

    expect(() => inspect(pkt)).toThrowError(
      expect.objectContaining({ code: "EINVAL" }) as Error,
    );
  });

  it("rejects an unknown sequence byte with EPROTO", () => {
    const pkt = buildPkt([0x99, 0x00, 0x00, 0xe3]);

    expect(() => inspect(pkt)).toThrowError(AuroraProtocolError);
    expect(() => inspect(pkt)).toThrowError(
      expect.objectContaining({ code: "EPROTO" }) as Error,
    );
  });
});

describe("decodePacket", () => {
  it("decodes the documented API 3 vector", () => {
    expect(decodePacket(DOC_PKT)).toEqual([{ pos: 0, r: 0xff, g: 0x00, b: 0xff }]);
  });

  it("expands colour endpoints to the full range", () => {
    /* Two records at position 0: all channels clear, then all channels set. */
    const leds = decodePacket(buildPkt([0x54, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff]));

    expect(leds[0]).toEqual({ pos: 0, r: 0x00, g: 0x00, b: 0x00 });
    expect(leds[1]).toEqual({ pos: 0, r: 0xff, g: 0xff, b: 0xff });
  });

  it("reads an API 2 record whose position spans the colour byte", () => {
    /*
     * Position 300 is 0x12c, so the low byte is 0x2c and the two high bits are
     * 0b01. Those share a byte with a 2/2/2 colour of R=3, G=0, B=3:
     * 0b01 11 00 11 = 0x73.
     */
    expect(decodePacket(buildPkt([0x50, 0x2c, 0x73]))).toEqual([
      { pos: 300, r: 0xff, g: 0x00, b: 0xff },
    ]);
  });

  it("ignores a trailing partial record", () => {
    /* One whole three byte record followed by two stray bytes. */
    const leds = decodePacket(buildPkt([0x54, 0x00, 0x00, 0xe3, 0x01, 0x00]));

    expect(leds).toHaveLength(1);
  });

  it("decodes multiple records in order", () => {
    const leds = decodePacket(
      buildPkt([0x54, 0x01, 0x00, 0xe0, 0x02, 0x00, 0x1c, 0x03, 0x01, 0x03]),
    );

    expect(leds).toEqual([
      { pos: 1, r: 0xff, g: 0x00, b: 0x00 },
      { pos: 2, r: 0x00, g: 0xff, b: 0x00 },
      { pos: 259, r: 0x00, g: 0x00, b: 0xff }, // position is little endian
    ]);
  });
});

describe("verifyPacket", () => {
  it("accepts the documented vector", () => {
    expect(() => verifyPacket(DOC_PKT)).not.toThrow();
  });

  it("rejects a corrupt checksum", () => {
    const pkt = Uint8Array.from(DOC_PKT);
    pkt[2] = pkt[2]! ^ 0xff;

    expect(() => verifyPacket(pkt)).toThrowError(/checksum mismatch/);
  });

  it("rejects a missing stop byte", () => {
    const pkt = Uint8Array.from(DOC_PKT);
    pkt[pkt.length - 1] = 0x00;

    expect(() => verifyPacket(pkt)).toThrowError(/stop byte/);
  });

  it("rejects a truncated packet", () => {
    expect(() => verifyPacket(DOC_PKT.subarray(0, 7))).toThrowError(
      expect.objectContaining({ code: "EINVAL" }) as Error,
    );
  });
});
