/**
 * Wire constants for the Aurora LED protocol, mirroring `app/src/aurora.h` in
 * the open_board_leds firmware. Changing anything here without changing the
 * firmware breaks the link.
 */

/** Packet framing: `0x01 | dataLen | crc | 0x02 | payload | 0x03`. */
export const PKT_START_BYTE = 0x01;
export const DATA_START_BYTE = 0x02;
export const STOP_BYTE = 0x03;

export const HEADER_LEN = 4;

export const PKT_START_BYTE_INDEX = 0;
export const DATA_LEN_INDEX = 1;
export const CRC_INDEX = 2;
export const DATA_START_BYTE_INDEX = 3;
export const DATA_INDEX = 4;

/**
 * The length byte is a single octet, so this is the largest packet that can be
 * described: header + payload + stop byte.
 */
export const MAX_DATA_LEN = 255;
export const MAX_PKT_LEN = HEADER_LEN + MAX_DATA_LEN + 1;

/**
 * First payload byte. It identifies the API level, which fixes the record
 * layout, and where this packet sits in a fragmented message.
 */
export const API2_SEQ_MIDDLE = 0x4d;
export const API2_SEQ_FIRST = 0x4e;
export const API2_SEQ_LAST = 0x4f;
export const API2_SEQ_ONLY = 0x50;

export const API3_SEQ_MIDDLE = 0x51;
export const API3_SEQ_FIRST = 0x52;
export const API3_SEQ_LAST = 0x53;
export const API3_SEQ_ONLY = 0x54;

/**
 * Bytes per LED record. API 2 packs a 10 bit position and a 2/2/2 colour into
 * two bytes; API 3 uses a 16 bit position plus a 3/3/2 colour byte.
 */
export const API2_REC_LEN = 2;
export const API3_REC_LEN = 3;

/** Largest LED index each API level can address. */
export const API2_MAX_POS = 0x03ff;
export const API3_MAX_POS = 0xffff;

/** Which record layout to speak. API 3 is the right default for a spray wall. */
export type ApiLevel = 2 | 3;

export const DEFAULT_API: ApiLevel = 3;
