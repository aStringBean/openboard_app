/**
 * Whether a board's strip reaches every LED a wall uses. A strip of `length`
 * LEDs drives positions 0 to length - 1; the board silently drops anything
 * past the end. Pure, so it can be tested in Node.
 */

export interface Shortfall {
  /** The strip length that reaches every LED the wall uses: its highest LED, plus one. */
  needed: number;
  /** Holds whose LED is past the end of the strip, so cannot light. */
  holdsPast: number;
}

/** How far the wall's holds run past the end of the strip, or null when the strip reaches them all. */
export function stripShortfall(holds: readonly { led: number | null }[], length: number): Shortfall | null {
  let needed = 0;
  let holdsPast = 0;
  for (const h of holds) {
    if (h.led === null) continue;
    needed = Math.max(needed, h.led + 1);
    if (h.led >= length) holdsPast++;
  }
  return holdsPast ? { needed, holdsPast } : null;
}
