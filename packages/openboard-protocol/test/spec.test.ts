/*
 * The worked examples of docs/openboard-api-1.md, section 13, byte for byte.
 * The firmware's tests/openboard checks the same bytes, so the two sides
 * cannot drift apart unnoticed.
 */
import { decodeMessage, encodeFrame, encodeGetInfo, encodeSetBrightness, encodeSetChainLength, unpack } from "../src/index.js";
import { hex, toHex } from "./helpers.js";

describe("the spec's worked examples", () => {
  it("a frame of two LEDs", () => {
    const [packet, ...rest] = encodeFrame(7, [
      { pos: 0, r: 0, g: 255, b: 0 },
      { pos: 249, r: 255, g: 0, b: 0 },
    ]);
    expect(rest).toEqual([]);
    expect(toHex(packet!)).toBe("01 0C 4E 02 B3 07 00 00 00 FF 00 F9 00 FF 00 00 03");
  });

  it("the FRAME_SHOWN it gets", () => {
    expect(decodeMessage(unpack(hex("01 08 2E 02 B9 10 07 02 00 00 00 FF 03")))).toEqual({
      kind: "frameShown",
      frameId: 7,
      applied: 2,
      skipped: 0,
      powerScale: 255,
    });
  });

  it("turn every LED off", () => {
    expect(encodeFrame(8, []).map(toHex)).toEqual(["01 02 44 02 B3 08 03"]);
  });

  it("ask what the board is, and its answer", () => {
    expect(toHex(encodeGetInfo(1))).toBe("01 03 45 02 B8 01 01 03");
    expect(decodeMessage(unpack(hex("01 0D 0D 02 B9 03 01 01 01 01 00 E8 03 0F 00 06 32 03")))).toEqual({
      kind: "info",
      requestId: 1,
      apiVersion: 1,
      firmware: { major: 1, minor: 1, patch: 0 },
      maxChainLength: 1000,
      features: { frames: true, settings: true, frameEvents: true, powerLimit: true, gamma: false },
      boardType: "openboard",
      maxRecordsPerPacket: 50,
    });
  });

  it("set brightness to 128, and OK", () => {
    expect(toHex(encodeSetBrightness(2, 128))).toBe("01 05 C1 02 B8 02 03 01 80 03");
    expect(decodeMessage(unpack(hex("01 03 43 02 B9 01 02 03")))).toEqual({ kind: "ok", requestId: 2 });
  });

  it("set the chain length to 250, and the ERROR had it been too long", () => {
    expect(toHex(encodeSetChainLength(3, 250))).toBe("01 06 45 02 B8 03 03 02 FA 00 03");
    expect(decodeMessage(unpack(hex("01 05 3B 02 B9 02 03 03 03 03")))).toEqual({
      kind: "error",
      requestId: 3,
      opcode: 3,
      code: 3,
      codeName: "outOfRange",
    });
  });
});
