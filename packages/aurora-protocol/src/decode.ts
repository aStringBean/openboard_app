import {
  API2_REC_LEN,
  API2_SEQ_FIRST,
  API2_SEQ_LAST,
  API2_SEQ_MIDDLE,
  API2_SEQ_ONLY,
  API3_REC_LEN,
  API3_SEQ_FIRST,
  API3_SEQ_LAST,
  API3_SEQ_MIDDLE,
  API3_SEQ_ONLY,
  CRC_INDEX,
  DATA_INDEX,
  DATA_LEN_INDEX,
  DATA_START_BYTE,
  DATA_START_BYTE_INDEX,
  HEADER_LEN,
  PKT_START_BYTE,
  PKT_START_BYTE_INDEX,
  STOP_BYTE,
  type ApiLevel,
} from "./constants.js";
import { expand2, expand3 } from "./color.js";
import { auroraCrc } from "./crc.js";
import { AuroraProtocolError } from "./errors.js";

/**
 * Where a packet sits in a fragmented message. One frame is painted across
 * several packets: the first clears it, the last pushes it to the strip.
 */
export interface FrameInfo {
  first: boolean;
  last: boolean;
  api: ApiLevel;
}

export interface DecodedLed {
  pos: number;
  r: number;
  g: number;
  b: number;
}

interface Layout extends FrameInfo {
  recLen: number;
  recsLen: number;
}

/** Shared front half of inspect and decode. Port of `parse_header()`. */
function parseHeader(packet: Uint8Array): Layout {
  if (packet.length < HEADER_LEN + 1) {
    throw new AuroraProtocolError("EINVAL", `packet of ${packet.length} bytes is too short`);
  }

  if (
    packet[PKT_START_BYTE_INDEX] !== PKT_START_BYTE ||
    packet[DATA_START_BYTE_INDEX] !== DATA_START_BYTE
  ) {
    throw new AuroraProtocolError("EINVAL", "bad framing bytes");
  }

  const dataLen = packet[DATA_LEN_INDEX]!;

  if (dataLen < 1) {
    /* the sequence byte is the minimum payload */
    throw new AuroraProtocolError("EINVAL", "payload has no sequence byte");
  }

  const seq = packet[DATA_INDEX]!;

  let recLen: number;
  let first: boolean;
  let last: boolean;
  let api: ApiLevel;

  switch (seq) {
    case API2_SEQ_MIDDLE:
    case API2_SEQ_FIRST:
    case API2_SEQ_LAST:
    case API2_SEQ_ONLY:
      api = 2;
      recLen = API2_REC_LEN;
      first = seq === API2_SEQ_FIRST || seq === API2_SEQ_ONLY;
      last = seq === API2_SEQ_LAST || seq === API2_SEQ_ONLY;
      break;
    case API3_SEQ_MIDDLE:
    case API3_SEQ_FIRST:
    case API3_SEQ_LAST:
    case API3_SEQ_ONLY:
      api = 3;
      recLen = API3_REC_LEN;
      first = seq === API3_SEQ_FIRST || seq === API3_SEQ_ONLY;
      last = seq === API3_SEQ_LAST || seq === API3_SEQ_ONLY;
      break;
    default:
      throw new AuroraProtocolError("EPROTO", `unknown sequence byte 0x${seq.toString(16)}`);
  }

  /* The C decoder trusts the length byte because parse.c has already checked
   * the packet is whole. Nothing guarantees that here, so the record area is
   * also bounded by what the buffer actually holds. */
  const available = Math.max(0, packet.length - (DATA_INDEX + 1));
  const recsLen = Math.min(dataLen - 1, available);

  return { first, last, api, recLen, recsLen };
}

/** Validates the framing and reports where the packet sits in a message. */
export function inspect(packet: Uint8Array): FrameInfo {
  const { first, last, api } = parseHeader(packet);
  return { first, last, api };
}

/**
 * Full validation as `parse_aurora()` performs it before dispatching: framing,
 * declared length, stop byte and checksum. Throws on any fault.
 */
export function verifyPacket(packet: Uint8Array): void {
  parseHeader(packet);

  const dataLen = packet[DATA_LEN_INDEX]!;
  const expectedLen = HEADER_LEN + dataLen + 1;

  if (packet.length !== expectedLen) {
    throw new AuroraProtocolError(
      "EINVAL",
      `declared length implies ${expectedLen} bytes, got ${packet.length}`,
    );
  }

  if (packet[expectedLen - 1] !== STOP_BYTE) {
    throw new AuroraProtocolError("EINVAL", "missing stop byte");
  }

  const crc = auroraCrc(packet.subarray(DATA_INDEX, DATA_INDEX + dataLen));

  if (crc !== packet[CRC_INDEX]) {
    throw new AuroraProtocolError(
      "EINVAL",
      `checksum mismatch: packet 0x${packet[CRC_INDEX]!.toString(16)}, computed 0x${crc.toString(16)}`,
    );
  }
}

/**
 * Decodes the LED records, expanding each colour to eight bits per channel.
 * A trailing partial record is ignored rather than rejected, matching
 * `aurora_decode()`.
 */
export function decodePacket(packet: Uint8Array): DecodedLed[] {
  const { recLen, recsLen } = parseHeader(packet);
  const base = DATA_INDEX + 1;
  const leds: DecodedLed[] = [];

  for (let i = 0; i + recLen <= recsLen; i += recLen) {
    if (recLen === API3_REC_LEN) {
      const color = packet[base + i + 2]!;

      leds.push({
        pos: packet[base + i]! | (packet[base + i + 1]! << 8),
        r: expand3(color >> 5),
        g: expand3(color >> 2),
        b: expand2(color),
      });
    } else {
      /* The top two bits of the colour byte are the high bits of a 10 bit
       * little endian position. */
      const color = packet[base + i + 1]!;

      leds.push({
        pos: packet[base + i]! | ((color >> 6) << 8),
        r: expand2(color >> 4),
        g: expand2(color >> 2),
        b: expand2(color),
      });
    }
  }

  return leds;
}

/**
 * Reassembles a whole frame from the packets `encodeFrame()` produced, the way
 * the firmware does: the opening packet clears, later ones accumulate. Useful
 * for asserting round trips and for a loopback preview in the app.
 */
export function decodeFrame(packets: readonly Uint8Array[]): DecodedLed[] {
  const leds: DecodedLed[] = [];

  for (const packet of packets) {
    const info = inspect(packet);

    if (info.first) {
      leds.length = 0;
    }

    leds.push(...decodePacket(packet));
  }

  return leds;
}
