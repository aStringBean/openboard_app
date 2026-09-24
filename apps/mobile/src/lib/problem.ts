/**
 * Problems: which holds, in which roles. Pure, so it can be tested in Node.
 */
import type { Led } from "@openboard/aurora-protocol";

export const ROLES = ["start", "hand", "no_match", "foot", "finish"] as const;
export type Role = (typeof ROLES)[number];

/**
 * How each role looks, on the wall and on screen.
 *
 * LED colours are all drawn from the eight that Aurora API 3 reproduces
 * exactly, so the wall shows precisely what the app intends. On screen the
 * same hues are softened, since pure #00ff00 over a photo is hard to read.
 *
 * No-match is magenta: of the three exact colours left after the four core
 * roles, it is the least like hand's blue on a real strip.
 */
export const ROLE_STYLE: Record<Role, { label: string; led: { r: number; g: number; b: number }; ui: string }> = {
  start: { label: "Start", led: { r: 0, g: 255, b: 0 }, ui: "#3ddc84" },
  hand: { label: "Hand", led: { r: 0, g: 0, b: 255 }, ui: "#4d8dff" },
  no_match: { label: "No-match", led: { r: 255, g: 0, b: 255 }, ui: "#ff4df2" },
  foot: { label: "Foot", led: { r: 255, g: 255, b: 0 }, ui: "#ffd23d" },
  finish: { label: "Finish", led: { r: 255, g: 0, b: 0 }, ui: "#ff5a4d" },
};

export interface ProblemHold {
  holdId: number;
  role: Role;
}

export interface Problem {
  id: string;
  wallId: string;
  name: string;
  /** Index into GRADES. */
  grade: number;
  /** The wall angle the problem was set, and graded, at. */
  angle: number;
  holds: ProblemHold[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Tapping a hold with a role selected in the palette: a hold already in that
 * role is taken out of the problem, anything else is put into that role.
 * Picking a role then tapping is quicker than cycling each hold through five
 * roles, and one tap always undoes the last.
 */
export function toggleRole(holds: readonly ProblemHold[], holdId: number, role: Role): ProblemHold[] {
  const existing = holds.find((h) => h.holdId === holdId);

  if (existing?.role === role) return holds.filter((h) => h.holdId !== holdId);
  if (existing) return holds.map((h) => (h.holdId === holdId ? { holdId, role } : h));
  return [...holds, { holdId, role }];
}

export function countRoles(holds: readonly ProblemHold[]): Record<Role, number> {
  const counts = { start: 0, hand: 0, no_match: 0, foot: 0, finish: 0 };
  for (const h of holds) counts[h.role]++;
  return counts;
}

/** How many holds a problem may have in a role, where that is limited. */
export const ROLE_LIMITS: Partial<Record<Role, { min: number; max: number }>> = {
  start: { min: 1, max: 2 },
  finish: { min: 1, max: 2 },
};

/**
 * Whether giving a hold this role would take the role past its limit. A hold
 * already in the role is a removal, and never blocked.
 */
export function roleFull(holds: readonly ProblemHold[], holdId: number, role: Role): boolean {
  const limit = ROLE_LIMITS[role];
  if (!limit) return false;
  if (holds.some((h) => h.holdId === holdId && h.role === role)) return false;
  return countRoles(holds)[role] >= limit.max;
}

/** Why a problem cannot be saved yet, as sentences for the user. Empty when it can. */
export function validateProblem(p: { name: string; holds: readonly ProblemHold[] }): string[] {
  const counts = countRoles(p.holds);
  const issues: string[] = [];

  if (!p.name.trim()) issues.push("Give it a name.");
  for (const [role, limit] of Object.entries(ROLE_LIMITS) as [Role, { min: number; max: number }][]) {
    const label = ROLE_STYLE[role].label.toLowerCase();
    if (counts[role] < limit.min) issues.push(`Add at least ${limit.min === 1 ? "one" : limit.min} ${label} hold.`);
    if (counts[role] > limit.max) issues.push(`Use at most ${limit.max === 2 ? "two" : limit.max} ${label} holds.`);
  }

  return issues;
}

/**
 * The LED frame that lights a problem.
 *
 * A hold with no LED beside it cannot be lit, but it is still part of the
 * problem — on a home spray wall the strip may not reach every foothold — so
 * it is left out of the frame and counted, for the UI to mention.
 */
export function problemFrame(
  holds: readonly ProblemHold[],
  wallHolds: readonly { id: number; led: number | null }[],
): { leds: Led[]; unlit: number } {
  const ledOf = new Map(wallHolds.map((h) => [h.id, h.led]));
  const leds: Led[] = [];
  let unlit = 0;

  for (const h of holds) {
    const led = ledOf.get(h.holdId);
    if (led === undefined || led === null) {
      unlit++;
      continue;
    }
    leds.push({ pos: led, ...ROLE_STYLE[h.role].led });
  }

  return { leds, unlit };
}

/** Random v4 UUID. Ids are made on the device and must not collide once walls sync. */
export function newId(): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else if (i === 19) out += hex[8 + Math.floor(Math.random() * 4)];
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}
