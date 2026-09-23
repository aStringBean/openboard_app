import {
  API2_MAX_POS,
  API2_REC_LEN,
  API2_SEQ_FIRST,
  API2_SEQ_LAST,
  API2_SEQ_MIDDLE,
  API2_SEQ_ONLY,
  API3_MAX_POS,
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
  DEFAULT_API,
  HEADER_LEN,
  MAX_DATA_LEN,
  MAX_PKT_LEN,
  PKT_START_BYTE,
  PKT_START_BYTE_INDEX,
  STOP_BYTE,
  type ApiLevel,
} from "./constants.js";
import { quantize } from "./color.js";
import { auroraCrc } from "./crc.js";

/** One lit LED. Channels are full 8 bit; the encoder narrows them to the wire. */
export interface Led {
  pos: number;
  r: number;
  g: number;
  b: number;
}

export interface EncodeOptions {
  /** Record layout to emit. Defaults to API 3 (16 bit positions, 3/3/2 colour). */
  api?: ApiLevel;
  /**
   * Largest packet to emit, in bytes. Defaults to the protocol maximum of 260.
   * The firmware reassembles across BLE writes via a ring buffer, so a packet
   * may exceed the ATT MTU — but capping this at `mtu - 3` keeps one packet to
   * one write, which is easier to reason about when something goes wrong.
   */
  maxPacketBytes?: number;
}

function seqByte(api: ApiLevel, first: boolean, last: boolean): number {
  if (api === 3) {
    if (first && last) return API3_SEQ_ONLY;
    if (first) return API3_SEQ_FIRST;
    if (last) return API3_SEQ_LAST;
    return API3_SEQ_MIDDLE;
  }

  if (first && last) return API2_SEQ_ONLY;
  if (first) return API2_SEQ_FIRST;
  if (last) return API2_SEQ_LAST;
  return API2_SEQ_MIDDLE;
}

function assertChannel(value: number, name: string, pos: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(
      `LED at position ${pos} has ${name}=${value}; channels must be integers in 0..255`,
    );
  }
}

function validate(led: Led, api: ApiLevel): void {
  const maxPos = api === 3 ? API3_MAX_POS : API2_MAX_POS;

  if (!Number.isInteger(led.pos) || led.pos < 0 || led.pos > maxPos) {
    throw new RangeError(
      `LED position ${led.pos} is out of range for API ${api} (0..${maxPos})`,
    );
  }

  assertChannel(led.r, "r", led.pos);
  assertChannel(led.g, "g", led.pos);
  assertChannel(led.b, "b", led.pos);
}

/** Writes one record at `offset`, returning the number of bytes written. */
function writeRecord(out: Uint8Array, offset: number, led: Led, api: ApiLevel): number {
  if (api === 3) {
    out[offset] = led.pos & 0xff;
    out[offset + 1] = (led.pos >> 8) & 0xff;
    out[offset + 2] =
      (quantize(led.r, 3) << 5) | (quantize(led.g, 3) << 2) | quantize(led.b, 2);

    return API3_REC_LEN;
  }

  /* The top two bits of the colour byte are the high bits of a 10 bit
   * little endian position. */
  out[offset] = led.pos & 0xff;
  out[offset + 1] =
    (((led.pos >> 8) & 0x03) << 6) |
    (quantize(led.r, 2) << 4) |
    (quantize(led.g, 2) << 2) |
    quantize(led.b, 2);

  return API2_REC_LEN;
}

/** Frames a payload that already starts with its sequence byte. */
function framePacket(payload: Uint8Array): Uint8Array {
  const packet = new Uint8Array(HEADER_LEN + payload.length + 1);

  packet[PKT_START_BYTE_INDEX] = PKT_START_BYTE;
  packet[DATA_LEN_INDEX] = payload.length;
  packet[CRC_INDEX] = auroraCrc(payload);
  packet[DATA_START_BYTE_INDEX] = DATA_START_BYTE;
  packet.set(payload, DATA_INDEX);
  packet[DATA_INDEX + payload.length] = STOP_BYTE;

  return packet;
}

/**
 * Encodes one complete frame — the full set of lit LEDs — into the packets to
 * write to the controller's NUS RX characteristic, in order.
 *
 * A frame is absolute, not a delta: the firmware clears the strip on the
 * opening packet and pushes it on the closing one, so any LED not listed goes
 * dark. Encoding an empty array yields a single packet that blanks the wall.
 */
export function encodeFrame(leds: readonly Led[], options: EncodeOptions = {}): Uint8Array[] {
  const api = options.api ?? DEFAULT_API;
  const maxPacketBytes = options.maxPacketBytes ?? MAX_PKT_LEN;
  const recLen = api === 3 ? API3_REC_LEN : API2_REC_LEN;

  /* A packet is header + sequence byte + records + stop byte, and the length
   * byte caps the payload independently of the caller's ceiling. */
  const recordBudget = Math.min(maxPacketBytes - HEADER_LEN - 2, MAX_DATA_LEN - 1);
  const perPacket = Math.floor(recordBudget / recLen);

  if (perPacket < 1) {
    throw new RangeError(
      `maxPacketBytes=${maxPacketBytes} leaves no room for an API ${api} record; ` +
        `at least ${HEADER_LEN + 2 + recLen} bytes are needed`,
    );
  }

  for (const led of leds) {
    validate(led, api);
  }

  if (leds.length === 0) {
    return [framePacket(Uint8Array.of(seqByte(api, true, true)))];
  }

  const packets: Uint8Array[] = [];

  for (let start = 0; start < leds.length; start += perPacket) {
    const batch = leds.slice(start, start + perPacket);
    const payload = new Uint8Array(1 + batch.length * recLen);

    payload[0] = seqByte(api, start === 0, start + perPacket >= leds.length);

    let offset = 1;
    for (const led of batch) {
      offset += writeRecord(payload, offset, led, api);
    }

    packets.push(framePacket(payload));
  }

  return packets;
}

/** Convenience for the common case: blank the wall. */
export function encodeAllOff(options: EncodeOptions = {}): Uint8Array[] {
  return encodeFrame([], options);
}

/**
 * Splits a packet into BLE writes of at most `maxWriteBytes` (normally
 * `mtu - 3`). The firmware reassembles with a 512 byte ring buffer and
 * resynchronises on the start byte, so chunking mid-packet is safe — but the
 * chunks of one packet must be written in order and not interleaved with
 * another packet's.
 */
export function chunkPacket(packet: Uint8Array, maxWriteBytes: number): Uint8Array[] {
  if (!Number.isInteger(maxWriteBytes) || maxWriteBytes < 1) {
    throw new RangeError(`maxWriteBytes must be a positive integer, got ${maxWriteBytes}`);
  }

  const chunks: Uint8Array[] = [];

  for (let offset = 0; offset < packet.length; offset += maxWriteBytes) {
    chunks.push(packet.subarray(offset, offset + maxWriteBytes));
  }

  return chunks;
}
