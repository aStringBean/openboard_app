/**
 * A wall's settings. Pure, so it can be tested in Node.
 */

export type AngleMode = "fixed" | "adjustable";
export type WallRole = "owner" | "setter" | "climber";
/** "everyone": every member may set problems. "chosen": only the owner and the setters they choose. */
export type SetterPolicy = "everyone" | "chosen";

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
  /** Shared through the server. A wall that is not stays on this phone only. */
  cloud: boolean;
  /** My role on a shared wall; null on a wall that is not shared. */
  role: WallRole | null;
  setterPolicy: SetterPolicy;
}

/*
 * What I may do on a wall. A wall only on this phone is entirely mine; on a
 * shared one it depends on my role. The server enforces the same rules — these
 * only decide what the app offers.
 */

export const canEditWall = (w: Pick<Wall, "cloud" | "role">): boolean => !w.cloud || w.role === "owner";

export const canSet = (w: Pick<Wall, "cloud" | "role" | "setterPolicy">): boolean =>
  !w.cloud || w.role === "owner" || w.role === "setter" || (w.role === "climber" && w.setterPolicy === "everyone");

/** Edit or delete a problem: my own, or anyone's on a wall I own. */
export const canEditProblem = (
  w: Pick<Wall, "cloud" | "role">,
  setterId: string | null,
  me: string | null,
): boolean => !w.cloud || w.role === "owner" || setterId === null || (me !== null && setterId === me);

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
