import { auroraCrc } from "../src/crc.js";

/**
 * Frames an arbitrary payload, computing the checksum. Port of `build_pkt()`
 * from tests/parse/src/main.c, so decoder vectors can be lifted verbatim
 * without going through the encoder.
 */
export function buildPkt(payload: readonly number[]): Uint8Array {
  const body = Uint8Array.from(payload);
  const packet = new Uint8Array(4 + body.length + 1);

  packet[0] = 0x01;
  packet[1] = body.length;
  packet[2] = auroraCrc(body);
  packet[3] = 0x02;
  packet.set(body, 4);
  packet[4 + body.length] = 0x03;

  return packet;
}

/** The vector documented alongside the protocol: LED 0 lit magenta. */
export const DOC_PKT = Uint8Array.of(0x01, 0x04, 0xc8, 0x02, 0x54, 0x00, 0x00, 0xe3, 0x03);
