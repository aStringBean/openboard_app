/**
 * Additive inverse checksum over the payload, starting at the sequence byte.
 * Port of `aurora_crc()`.
 */
export function auroraCrc(payload: Uint8Array): number {
  let crc = 0;

  for (const byte of payload) {
    crc = (crc + byte) & 0xff;
  }

  return ~crc & 0xff;
}
