/**
 * Problems: which holds, in which roles. Pure, so it can be tested in Node.
 */
import type { Led } from "@openboard/aurora-protocol";

export const ROLES = ["start", "hand", "no_match", "foot", "finish"] as const;
export type Role = (typeof ROLES)[number];

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * How each role looks by default, on the wall and on screen.
 *
 * The default LED colours are all among the eight Aurora API 3 reproduces
 * exactly, so they show true on a board in Kilter mode too. On screen the
 * same hues are softened, since pure #00ff00 over a photo is hard to read.
 *
 * No-match is magenta: of the three exact colours left after the four core
 * roles, it is the least like hand's blue on a real strip. (Cyan was tried,
 * as a colour next to hand's; magenta stayed.)
 */
export const ROLE_STYLE: Record<Role, { label: string; led: Rgb; ui: string }> = {
  start: { label: "Start", led: { r: 0, g: 255, b: 0 }, ui: "#3ddc84" },
  hand: { label: "Hand", led: { r: 0, g: 0, b: 255 }, ui: "#4d8dff" },
  no_match: { label: "No-match", led: { r: 255, g: 0, b: 255 }, ui: "#ff4df2" },
  foot: { label: "Foot", led: { r: 255, g: 255, b: 0 }, ui: "#ffd23d" },
  finish: { label: "Finish", led: { r: 255, g: 0, b: 0 }, ui: "#ff5a4d" },
};

/**
 * A wall's own role colours: only the roles it has changed. A role left out
 * follows the default, including any later change to the default.
 */
export type RoleColors = Partial<Record<Role, Rgb>>;

/** Colours to choose from: bright, distinct on a strip, at full scale. */
export const PALETTE: readonly { name: string; led: Rgb }[] = [
  { name: "Red", led: { r: 255, g: 0, b: 0 } },
  { name: "Orange", led: { r: 255, g: 96, b: 0 } },
  { name: "Amber", led: { r: 255, g: 176, b: 0 } },
  { name: "Yellow", led: { r: 255, g: 255, b: 0 } },
  { name: "Lime", led: { r: 128, g: 255, b: 0 } },
  { name: "Green", led: { r: 0, g: 255, b: 0 } },
  { name: "Spring", led: { r: 0, g: 255, b: 128 } },
  { name: "Cyan", led: { r: 0, g: 255, b: 255 } },
  { name: "Sky", led: { r: 0, g: 128, b: 255 } },
  { name: "Blue", led: { r: 0, g: 0, b: 255 } },
  { name: "Indigo", led: { r: 64, g: 0, b: 255 } },
  { name: "Violet", led: { r: 160, g: 0, b: 255 } },
  { name: "Magenta", led: { r: 255, g: 0, b: 255 } },
  { name: "Pink", led: { r: 255, g: 0, b: 96 } },
  { name: "White", led: { r: 255, g: 255, b: 255 } },
  { name: "Warm white", led: { r: 255, g: 160, b: 64 } },
];

export const sameRgb = (a: Rgb, b: Rgb) => a.r === b.r && a.g === b.g && a.b === b.b;

/** The LED colour a role lights in, on a wall with these colours. */
export const roleLed = (role: Role, colors?: RoleColors | null): Rgb => colors?.[role] ?? ROLE_STYLE[role].led;

const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");

/**
 * The colour a role is drawn in on screen. Defaults have hand-tuned screen
 * colours; a chosen one is lightened a quarter towards white, which softens
 * the pure LED hues the way the defaults are softened.
 */
export function roleUi(role: Role, colors?: RoleColors | null): string {
  const c = colors?.[role];
  if (!c) return ROLE_STYLE[role].ui;
  const soft = (v: number) => v + (255 - v) * 0.25;
  return `#${hex(soft(c.r))}${hex(soft(c.g))}${hex(soft(c.b))}`;
}

/** An LED colour as it looks on screen, unsoftened, for palette swatches. */
export const rgbHex = (c: Rgb) => `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;

/** A wall's colours with one role changed; choosing the default removes the override. */
export function withRoleColor(colors: RoleColors, role: Role, led: Rgb): RoleColors {
  const next: RoleColors = { ...colors };
  if (sameRgb(led, ROLE_STYLE[role].led)) delete next[role];
  else next[role] = led;
  return next;
}

/** Reads stored colours, keeping only well-formed entries for known roles. */
export function parseRoleColors(raw: unknown): RoleColors {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return {};
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};

  const byte = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 255;
  const out: RoleColors = {};
  for (const role of ROLES) {
    const c = (v as Record<string, unknown>)[role] as Partial<Rgb> | undefined;
    if (c && byte(c.r) && byte(c.g) && byte(c.b)) out[role] = { r: c.r!, g: c.g!, b: c.b! };
  }
  return out;
}

/** Roles that would light in the same colour as another, so could not be told apart. */
export function clashingRoles(colors: RoleColors): Role[] {
  return ROLES.filter((a) => ROLES.some((b) => a !== b && sameRgb(roleLed(a, colors), roleLed(b, colors))));
}

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
  /** Who set it; null for a problem set on this phone before signing in. */
  setterId: string | null;
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
  colors?: RoleColors | null,
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
    leds.push({ pos: led, ...roleLed(h.role, colors) });
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
