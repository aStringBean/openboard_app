import {
  decodeMessage,
  encodeFrame,
  encodeSetBrightness,
  encodeSetChainLength,
  encodeSetColorOrder,
  MSG,
  OpenBoardProtocolError,
  PacketReader,
  chunk,
  pack,
  unpack,
} from "../src/index.js";
import { hex, toHex } from "./helpers.js";

const leds = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ pos: from + i, r: 1, g: 2, b: 3 }));

describe("encodeFrame", () => {
  it("splits a frame into first, middle and last packets of up to 50 LEDs", () => {
    const packets = encodeFrame(9, leds(250));
    expect(packets.map((p) => p[4])).toEqual([MSG.frameFirst, MSG.frameMiddle, MSG.frameMiddle, MSG.frameMiddle, MSG.frameLast]);
    expect(packets.every((p) => p[5] === 9)).toBe(true);
    expect(packets.map((p) => unpack(p).length)).toEqual([252, 252, 252, 252, 252]);
  });

  it("uses first and last alone for two packets, and only for one", () => {
    expect(encodeFrame(1, leds(51)).map((p) => p[4])).toEqual([MSG.frameFirst, MSG.frameLast]);
    expect(encodeFrame(1, leds(50)).map((p) => p[4])).toEqual([MSG.frameOnly]);
  });

  it("writes positions little-endian, colours as given", () => {
    const [p] = encodeFrame(0, [{ pos: 0x1234, r: 10, g: 20, b: 30 }]);
    expect(toHex(unpack(p!).subarray(2))).toBe("34 12 0A 14 1E");
  });

  it("refuses what cannot be encoded", () => {
    expect(() => encodeFrame(256, [])).toThrow(OpenBoardProtocolError);
    expect(() => encodeFrame(0, [{ pos: -1, r: 0, g: 0, b: 0 }])).toThrow(/position/);
    expect(() => encodeFrame(0, [{ pos: 70000, r: 0, g: 0, b: 0 }])).toThrow(/position/);
    expect(() => encodeFrame(0, [{ pos: 0, r: 256, g: 0, b: 0 }])).toThrow(/red/);
    expect(() => encodeFrame(0, [{ pos: 0, r: 0, g: 1.5, b: 0 }])).toThrow(/green/);
  });
});

describe("commands", () => {
  it("encode their settings", () => {
    expect(toHex(unpack(encodeSetColorOrder(4, "grb")))).toBe("B8 04 03 03 01");
    expect(toHex(unpack(encodeSetColorOrder(4, "rgb")))).toBe("B8 04 03 03 00");
    expect(toHex(unpack(encodeSetChainLength(5, 1000)))).toBe("B8 05 03 02 E8 03");
  });

  it("refuse values the board would", () => {
    expect(() => encodeSetBrightness(1, 0)).toThrow(/brightness/);
    expect(() => encodeSetBrightness(1, 300)).toThrow(/brightness/);
    expect(() => encodeSetChainLength(1, 0)).toThrow(/chain length/);
  });
});

describe("decodeMessage", () => {
  it("decodes SETTINGS", () => {
    expect(decodeMessage(hex("B9 04 09 FF FA 00 01 06 C8 00 50 00"))).toEqual({
      kind: "settings",
      requestId: 9,
      brightness: 255,
      chainLength: 250,
      colorOrder: "grb",
      boardType: "openboard",
      powerSupplyW: 200,
      powerHeadroomPct: 80,
      gamma: false,
    });
  });

  it("decodes FRAME_DROPPED with its reason", () => {
    expect(decodeMessage(hex("B9 11 14 01"))).toEqual({ kind: "frameDropped", frameId: 20, reason: 1, reasonName: "superseded" });
    expect(decodeMessage(hex("B9 11 14 09"))).toMatchObject({ reasonName: "unknown" });
  });

  it("reads only the fields it knows from a longer payload", () => {
    expect(decodeMessage(hex("B9 01 07 AA BB"))).toEqual({ kind: "ok", requestId: 7 });
  });

  it("passes types it does not know through", () => {
    expect(decodeMessage(hex("B9 42 00"))).toEqual({ kind: "unknown", type: 0x42 });
  });

  it("refuses what is not a reply, or too short", () => {
    expect(() => decodeMessage(hex("B8 01 01"))).toThrow(/not a reply/);
    expect(() => decodeMessage(hex("B9 03 01 01"))).toThrow(/INFO/);
  });
});

describe("the envelope", () => {
  it("round-trips, and refuses bad packets", () => {
    const p = pack(hex("B9 01 02"));
    expect(toHex(unpack(p))).toBe("B9 01 02");
    const bad = p.slice();
    bad[2] = bad[2]! ^ 1;
    expect(() => unpack(bad)).toThrow(/checksum/);
    expect(() => unpack(p.subarray(0, p.length - 1))).toThrow();
    expect(() => pack(new Uint8Array(0))).toThrow();
    expect(() => pack(new Uint8Array(256))).toThrow();
  });

  it("chunks a packet into writes", () => {
    const p = encodeFrame(0, leds(10))[0]!;
    const parts = chunk(p, 20);
    expect(parts.map((c) => c.length)).toEqual([20, 20, 17]);
    expect(Uint8Array.from(parts.flatMap((c) => Array.from(c)))).toEqual(p);
  });
});

describe("PacketReader", () => {
  const shown = pack(hex("B9 10 07 02 00 00 00 FF"));
  const ok = pack(hex("B9 01 02"));

  it("reassembles a packet split across notifications", () => {
    const r = new PacketReader();
    expect(r.push(shown.subarray(0, 5))).toEqual([]);
    expect(r.push(shown.subarray(5)).map(toHex)).toEqual(["B9 10 07 02 00 00 00 FF"]);
  });

  it("finds packets joined together, after junk", () => {
    const r = new PacketReader();
    const joined = Uint8Array.from([0xff, 0x00, ...shown, ...ok]);
    expect(r.push(joined).map(toHex)).toEqual(["B9 10 07 02 00 00 00 FF", "B9 01 02"]);
  });

  it("skips a corrupt packet and carries on", () => {
    const r = new PacketReader();
    const corrupt = shown.slice();
    corrupt[6] = corrupt[6]! ^ 0xff;
    expect(r.push(Uint8Array.from([...corrupt, ...ok])).map(toHex)).toEqual(["B9 01 02"]);
  });
});
