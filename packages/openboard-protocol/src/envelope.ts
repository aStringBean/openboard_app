import { MAX_PACKET_LEN, MAX_PAYLOAD_LEN } from "./constants.js";
import { OpenBoardProtocolError } from "./errors.js";

/*
 * The packet envelope, shared with Aurora (section 3):
 * 0x01 | length | checksum | 0x02 | payload | 0x03
 */
const START = 0x01;
const DATA = 0x02;
const STOP = 0x03;
const HEADER_LEN = 4;

/** Sum of the payload bytes, modulo 256, bits inverted. */
export function checksum(payload: Uint8Array): number {
  let sum = 0;
  for (const b of payload) sum = (sum + b) & 0xff;
  return ~sum & 0xff;
}

/** Wraps a payload in the envelope. */
export function pack(payload: Uint8Array): Uint8Array {
  if (payload.length < 1 || payload.length > MAX_PAYLOAD_LEN) {
    throw new OpenBoardProtocolError(`payload of ${payload.length} bytes: must be 1-${MAX_PAYLOAD_LEN}`);
  }

  const packet = new Uint8Array(payload.length + HEADER_LEN + 1);
  packet[0] = START;
  packet[1] = payload.length;
  packet[2] = checksum(payload);
  packet[3] = DATA;
  packet.set(payload, HEADER_LEN);
  packet[packet.length - 1] = STOP;
  return packet;
}

/** The payload of one whole packet, after checking its framing and checksum. */
export function unpack(packet: Uint8Array): Uint8Array {
  if (packet.length < HEADER_LEN + 2) {
    throw new OpenBoardProtocolError(`packet of ${packet.length} bytes is too short`);
  }
  const len = packet[1]!;
  if (packet[0] !== START || packet[3] !== DATA || packet.length !== len + HEADER_LEN + 1) {
    throw new OpenBoardProtocolError("bad framing");
  }
  if (packet[packet.length - 1] !== STOP) {
    throw new OpenBoardProtocolError("missing end byte");
  }

  const payload = packet.subarray(HEADER_LEN, HEADER_LEN + len);
  if (checksum(payload) !== packet[2]) {
    throw new OpenBoardProtocolError("bad checksum");
  }
  return payload;
}

/** Splits a packet into BLE writes of at most `size` bytes. */
export function chunk(packet: Uint8Array, size: number): Uint8Array[] {
  if (size < 1) throw new OpenBoardProtocolError(`write size ${size}`);
  const out: Uint8Array[] = [];
  for (let i = 0; i < packet.length; i += size) out.push(packet.subarray(i, i + size));
  return out;
}

/**
 * Reassembles packets from notification bytes. The board sends one packet per
 * notification, but a transport may split or join them; bytes before a start
 * byte, and packets that fail their checks, are skipped.
 */
export class PacketReader {
  private buf: number[] = [];

  /** Adds bytes; returns the payloads of any packets now complete. */
  push(bytes: Uint8Array): Uint8Array[] {
    for (const b of bytes) this.buf.push(b);
    const payloads: Uint8Array[] = [];

    for (;;) {
      const start = this.buf.indexOf(START);
      if (start < 0) {
        this.buf = [];
        break;
      }
      if (start > 0) this.buf.splice(0, start);
      if (this.buf.length < HEADER_LEN) break;

      const total = this.buf[1]! + HEADER_LEN + 1;
      if (total > MAX_PACKET_LEN || this.buf[3] !== DATA) {
        this.buf.shift(); /* not a real start: resynchronise on the next */
        continue;
      }
      if (this.buf.length < total) break;

      const candidate = Uint8Array.from(this.buf.slice(0, total));
      try {
        payloads.push(unpack(candidate));
        this.buf.splice(0, total);
      } catch {
        this.buf.shift();
      }
    }

    return payloads;
  }

  reset(): void {
    this.buf = [];
  }
}
