import {
  BOARD_TYPES,
  DROP_REASON,
  ERROR_CODE,
  FEATURE,
  MSG,
  REPLY,
  type BoardType,
  type DropReasonName,
  type ErrorCodeName,
} from "./constants.js";
import { OpenBoardProtocolError } from "./errors.js";

export interface Info {
  apiVersion: number;
  firmware: { major: number; minor: number; patch: number };
  maxChainLength: number;
  features: {
    frames: boolean;
    settings: boolean;
    frameEvents: boolean;
    powerLimit: boolean;
    gamma: boolean;
  };
  /** Always "openboard" from firmware that answers at all. */
  boardType: BoardType | "unknown";
  maxRecordsPerPacket: number;
}

export interface Settings {
  brightness: number;
  chainLength: number;
  colorOrder: "rgb" | "grb";
  boardType: BoardType | "unknown";
  powerSupplyW: number;
  powerHeadroomPct: number;
  gamma: boolean;
}

/** Everything the board sends (section 7). */
export type Message =
  | { kind: "ok"; requestId: number }
  | { kind: "error"; requestId: number; opcode: number; code: number; codeName: ErrorCodeName | "unknown" }
  | ({ kind: "info"; requestId: number } & Info)
  | ({ kind: "settings"; requestId: number } & Settings)
  | { kind: "frameShown"; frameId: number; applied: number; skipped: number; powerScale: number }
  | { kind: "frameDropped"; frameId: number; reason: number; reasonName: DropReasonName | "unknown" }
  /** A type this version does not know: later firmware may add some. */
  | { kind: "unknown"; type: number };

const nameOf = <T extends Record<string, number>>(table: T, v: number): keyof T | "unknown" =>
  (Object.keys(table) as (keyof T)[]).find((k) => table[k] === v) ?? "unknown";

const boardType = (v: number): BoardType | "unknown" => BOARD_TYPES[v] ?? "unknown";

/** Decodes one payload from the board. Longer payloads than expected are
 * valid: later versions append fields (section 7). */
export function decodeMessage(p: Uint8Array): Message {
  const need = (n: number, what: string) => {
    if (p.length < n) throw new OpenBoardProtocolError(`${what}: ${p.length} bytes, need ${n}`);
  };
  const u16 = (i: number) => p[i]! | (p[i + 1]! << 8);

  need(2, "reply");
  if (p[0] !== MSG.reply) {
    throw new OpenBoardProtocolError(`not a reply: 0x${p[0]!.toString(16)}`);
  }

  switch (p[1]) {
    case REPLY.ok:
      need(3, "OK");
      return { kind: "ok", requestId: p[2]! };
    case REPLY.error:
      need(5, "ERROR");
      return { kind: "error", requestId: p[2]!, opcode: p[3]!, code: p[4]!, codeName: nameOf(ERROR_CODE, p[4]!) };
    case REPLY.info: {
      need(13, "INFO");
      const f = u16(9);
      return {
        kind: "info",
        requestId: p[2]!,
        apiVersion: p[3]!,
        firmware: { major: p[4]!, minor: p[5]!, patch: p[6]! },
        maxChainLength: u16(7),
        features: {
          frames: (f & FEATURE.frames) !== 0,
          settings: (f & FEATURE.settings) !== 0,
          frameEvents: (f & FEATURE.frameEvents) !== 0,
          powerLimit: (f & FEATURE.powerLimit) !== 0,
          gamma: (f & FEATURE.gamma) !== 0,
        },
        boardType: boardType(p[11]!),
        maxRecordsPerPacket: p[12]!,
      };
    }
    case REPLY.settings:
      need(12, "SETTINGS");
      return {
        kind: "settings",
        requestId: p[2]!,
        brightness: p[3]!,
        chainLength: u16(4),
        colorOrder: p[6] === 1 ? "grb" : "rgb",
        boardType: boardType(p[7]!),
        powerSupplyW: u16(8),
        powerHeadroomPct: p[10]!,
        gamma: p[11] !== 0,
      };
    case REPLY.frameShown:
      need(8, "FRAME_SHOWN");
      return { kind: "frameShown", frameId: p[2]!, applied: u16(3), skipped: u16(5), powerScale: p[7]! };
    case REPLY.frameDropped:
      need(4, "FRAME_DROPPED");
      return { kind: "frameDropped", frameId: p[2]!, reason: p[3]!, reasonName: nameOf(DROP_REASON, p[3]!) };
    default:
      return { kind: "unknown", type: p[1]! };
  }
}
