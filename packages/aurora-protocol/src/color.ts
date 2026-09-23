/**
 * Colour packing. The firmware expands a packed channel by bit replication, so
 * an all-ones field maps to 0xFF rather than falling short of it; quantising is
 * the inverse, and the pair round-trips exactly for every packed value.
 */

/** Port of `expand_3bit()`. */
export function expand3(v: number): number {
  v &= 0x07;
  return ((v << 5) | (v << 2) | (v >> 1)) & 0xff;
}

/** Port of `expand_2bit()`. */
export function expand2(v: number): number {
  v &= 0x03;
  return ((v << 6) | (v << 4) | (v << 2) | v) & 0xff;
}

/** Narrow an 8 bit channel to `bits`, rounding to the nearest representable level. */
export function quantize(value: number, bits: number): number {
  const max = (1 << bits) - 1;
  return Math.round((value * max) / 255);
}
