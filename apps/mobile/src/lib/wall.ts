/**
 * A wall's settings. Pure, so it can be tested in Node.
 */

export type AngleMode = "fixed" | "adjustable";

export interface Wall {
  id: string;
  name: string;
  /**
   * A fixed wall has one angle. An adjustable one can be set to any of
   * `angles`, and problems and grades belong to the angle they were set at.
   */
  angleMode: AngleMode;
  angles: number[];
  /** The angle the wall is set to right now; new problems default to it. */
  currentAngle: number;
}

export const DEFAULT_FIXED_ANGLE = 40;

/** A spread that covers most adjustable boards: vertical to 70°. */
export const DEFAULT_ADJUSTABLE = { min: 0, max: 70, step: 5 } as const;

export const MAX_ANGLE = 90;

export function angleRange(min: number, max: number, step: number): number[] {
  if (!(step > 0) || min > max) return [];
  const out: number[] = [];
  for (let a = min; a <= max; a += step) out.push(a);
  return out;
}

/** Applies a new angle setup, keeping the current angle if it is still available. */
export function withAngles(wall: Wall, mode: AngleMode, angles: number[]): Wall {
  const valid = [...new Set(angles.filter((a) => Number.isInteger(a) && a >= 0 && a <= MAX_ANGLE))].sort(
    (a, b) => a - b,
  );
  if (!valid.length) return wall;

  const list = mode === "fixed" ? [valid[0]!] : valid;
  const currentAngle = list.includes(wall.currentAngle)
    ? wall.currentAngle
    : list.reduce((best, a) => (Math.abs(a - wall.currentAngle) < Math.abs(best - wall.currentAngle) ? a : best));

  return { ...wall, angleMode: mode, angles: list, currentAngle };
}
