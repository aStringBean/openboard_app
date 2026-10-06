/**
 * OpenBoard API 1, as specified in the firmware repository at
 * docs/openboard-api-1.md. Section numbers below refer to that document.
 */

export const API_VERSION = 1;

/** The name a board in OpenBoard mode advertises (section 2): this, or this, a
 * space and the board's own name. See boardNameFromAdvertised. */
export const DEVICE_NAME = "OpenBoard";

/** First payload byte (section 4). */
export const MSG = {
  frameMiddle: 0xb0,
  frameFirst: 0xb1,
  frameLast: 0xb2,
  frameOnly: 0xb3,
  command: 0xb8,
  reply: 0xb9,
} as const;

/** Bytes per LED record, and records per frame packet (section 5). */
export const RECORD_LEN = 5;
export const MAX_RECORDS = 50;
export const MAX_POS = 0xffff;

/** Largest payload the envelope can describe, and the packet it makes. */
export const MAX_PAYLOAD_LEN = 255;
export const MAX_PACKET_LEN = MAX_PAYLOAD_LEN + 5;

/** Commands (section 6). */
export const OPCODE = {
  getInfo: 0x01,
  getSettings: 0x02,
  setSetting: 0x03,
} as const;

/** Reply and event types (section 7). */
export const REPLY = {
  ok: 0x01,
  error: 0x02,
  info: 0x03,
  settings: 0x04,
  frameShown: 0x10,
  frameDropped: 0x11,
} as const;

/** ERROR codes (section 7). */
export const ERROR_CODE = {
  unknownOpcode: 0x01,
  badLength: 0x02,
  outOfRange: 0x03,
  readOnly: 0x04,
  unknownKey: 0x05,
  storage: 0x06,
} as const;

export type ErrorCodeName = keyof typeof ERROR_CODE;

/** Settings keys (section 8). Brightness, chain length, colour order and the
 * board name are writable over BLE. */
export const SETTING = {
  brightness: 0x01,
  chainLength: 0x02,
  colorOrder: 0x03,
  boardType: 0x04,
  boardName: 0x05,
  powerSupply: 0x10,
  powerHeadroom: 0x11,
  gamma: 0x12,
} as const;

/** INFO feature bits (section 7). */
export const FEATURE = {
  frames: 1 << 0,
  settings: 1 << 1,
  frameEvents: 1 << 2,
  powerLimit: 1 << 3,
  gamma: 1 << 4,
  boardName: 1 << 5,
} as const;

/** FRAME_DROPPED reasons (section 7). */
export const DROP_REASON = {
  superseded: 0x01,
  wrongId: 0x02,
  noFrame: 0x03,
  disconnected: 0x04,
} as const;

export type DropReasonName = keyof typeof DROP_REASON;

/** Board types (section 8, key 0x04). */
export const BOARD_TYPES = [
  "aurora",
  "kilter",
  "tension",
  "decoy",
  "grasshopper",
  "moon",
  "openboard",
] as const;

export type BoardType = (typeof BOARD_TYPES)[number];

/** Transport: Nordic UART Service (section 2). */
export const NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
/** Host writes packets here. */
export const NUS_RX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
/** The board notifies replies and events here. */
export const NUS_TX_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
