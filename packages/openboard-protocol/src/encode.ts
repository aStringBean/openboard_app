import { MAX_POS, MAX_RECORDS, MSG, OPCODE, RECORD_LEN, SETTING } from "./constants.js";
import { pack } from "./envelope.js";
import { OpenBoardProtocolError } from "./errors.js";

/** One lit LED: position from the controller, and full-scale RGB. */
export interface Led {
  pos: number;
  r: number;
  g: number;
  b: number;
}

const byte = (v: number, what: string): number => {
  if (!Number.isInteger(v) || v < 0 || v > 255) {
    throw new OpenBoardProtocolError(`${what} ${v}: must be an integer 0-255`);
  }
  return v;
};

/**
 * The packets of one frame (section 5): the complete state of the strip,
 * every LED not listed off. Up to 50 LEDs per packet, typed only, or first,
 * middle…, last. An empty list is one packet that turns the strip off.
 */
export function encodeFrame(frameId: number, leds: readonly Led[]): Uint8Array[] {
  byte(frameId, "frame id");
  for (const led of leds) {
    if (!Number.isInteger(led.pos) || led.pos < 0 || led.pos > MAX_POS) {
      throw new OpenBoardProtocolError(`LED position ${led.pos}: must be an integer 0-${MAX_POS}`);
    }
    byte(led.r, "red");
    byte(led.g, "green");
    byte(led.b, "blue");
  }

  const groups: (readonly Led[])[] = [];
  for (let i = 0; i < leds.length; i += MAX_RECORDS) groups.push(leds.slice(i, i + MAX_RECORDS));
  if (!groups.length) groups.push([]);

  return groups.map((group, n) => {
    const type =
      groups.length === 1
        ? MSG.frameOnly
        : n === 0
          ? MSG.frameFirst
          : n === groups.length - 1
            ? MSG.frameLast
            : MSG.frameMiddle;

    const payload = new Uint8Array(2 + group.length * RECORD_LEN);
    payload[0] = type;
    payload[1] = frameId;
    group.forEach((led, i) => {
      const o = 2 + i * RECORD_LEN;
      payload[o] = led.pos & 0xff;
      payload[o + 1] = led.pos >> 8;
      payload[o + 2] = led.r;
      payload[o + 3] = led.g;
      payload[o + 4] = led.b;
    });
    return pack(payload);
  });
}

function command(requestId: number, opcode: number, args: number[] = []): Uint8Array {
  byte(requestId, "request id");
  return pack(Uint8Array.from([MSG.command, requestId, opcode, ...args]));
}

export const encodeGetInfo = (requestId: number) => command(requestId, OPCODE.getInfo);

export const encodeGetSettings = (requestId: number) => command(requestId, OPCODE.getSettings);

/** Brightness, 1-255: every channel is scaled by it / 255 on the board. */
export function encodeSetBrightness(requestId: number, brightness: number): Uint8Array {
  if (byte(brightness, "brightness") < 1) {
    throw new OpenBoardProtocolError("brightness 0: must be 1-255");
  }
  return command(requestId, OPCODE.setSetting, [SETTING.brightness, brightness]);
}

export function encodeSetChainLength(requestId: number, length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 1 || length > MAX_POS) {
    throw new OpenBoardProtocolError(`chain length ${length}: must be an integer 1-${MAX_POS}`);
  }
  return command(requestId, OPCODE.setSetting, [SETTING.chainLength, length & 0xff, length >> 8]);
}

export function encodeSetColorOrder(requestId: number, order: "rgb" | "grb"): Uint8Array {
  return command(requestId, OPCODE.setSetting, [SETTING.colorOrder, order === "grb" ? 1 : 0]);
}
