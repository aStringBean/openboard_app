/**
 * Ticks: one ascent of one problem. Pure, so it can be tested in Node.
 */
import { isGrade } from "./grades";

export interface Tick {
  id: string;
  problemId: string;
  /** When it was climbed, in ms since the epoch. */
  climbedAt: number;
  /** The wall angle it was climbed at — on an adjustable wall, part of what was climbed. */
  angle: number;
  /** Goes it took, the send included. One is a flash. */
  attempts: number;
  /** The climber's own grade for it, if they gave one. */
  grade: number | null;
  /** Quality, 1 to MAX_STARS, if given. */
  stars: number | null;
  comment: string;
  /** Who climbed it; null for an ascent logged on this phone before signing in. */
  userId: string | null;
}

export const MAX_STARS = 3;

export const isFlash = (t: Pick<Tick, "attempts">): boolean => t.attempts === 1;

/** Why a tick cannot be saved, as sentences for the user. Empty when it can. */
export function validateTick(t: Pick<Tick, "attempts" | "grade" | "stars">): string[] {
  const issues: string[] = [];
  if (!Number.isInteger(t.attempts) || t.attempts < 1) issues.push("Attempts must be at least one.");
  if (t.grade !== null && !isGrade(t.grade)) issues.push("That is not a grade.");
  if (t.stars !== null && (!Number.isInteger(t.stars) || t.stars < 1 || t.stars > MAX_STARS)) {
    issues.push(`Stars go from 1 to ${MAX_STARS}.`);
  }
  return issues;
}

/**
 * The grade a problem is felt to be at an angle.
 *
 * At the angle it was set, the setter's grade is one vote and every graded
 * ascent another — so a single dissenting tick moves it, but does not
 * override the setter on its own. At any other angle the setter never graded
 * it, so only ascents there count, and with none there is no grade.
 */
export function gradeAt(
  problem: { grade: number; angle: number },
  ticks: readonly Pick<Tick, "angle" | "grade">[],
  angle: number,
): number | null {
  const votes = ticks.filter((t) => t.angle === angle && t.grade !== null).map((t) => t.grade!);
  if (angle === problem.angle) votes.push(problem.grade);
  if (!votes.length) return null;
  return Math.round(votes.reduce((a, b) => a + b, 0) / votes.length);
}

/** Mean of the stars given, or null if nobody gave any. */
export function averageStars(ticks: readonly Pick<Tick, "stars">[]): number | null {
  const given = ticks.filter((t) => t.stars !== null).map((t) => t.stars!);
  return given.length ? given.reduce((a, b) => a + b, 0) / given.length : null;
}

/** Per-angle ascent counts and grades, for a problem climbed at more than one angle. */
export function byAngle(
  problem: { grade: number; angle: number },
  ticks: readonly Pick<Tick, "angle" | "grade">[],
): { angle: number; ascents: number; grade: number | null }[] {
  const angles = [...new Set([problem.angle, ...ticks.map((t) => t.angle)])].sort((a, b) => a - b);
  return angles.map((angle) => ({
    angle,
    ascents: ticks.filter((t) => t.angle === angle).length,
    grade: gradeAt(problem, ticks, angle),
  }));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "23 Sep", or "23 Sep 2025" outside the current year. Independent of Intl support. */
export function shortDate(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}
