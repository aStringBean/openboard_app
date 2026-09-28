/**
 * What a board speaks, from the name it advertises. Pure, so it can be tested
 * in Node.
 *
 * Aurora-family boards advertise "<Family> Board#<serial>@<API level>", as
 * "Kilter Board#1@3" (the firmware's own serial is 1). The app speaks Aurora
 * API 3 only, so it takes any serial but only boards announcing API level 3.
 * A board in OpenBoard mode advertises exactly "OpenBoard".
 */
export type Protocol = "aurora" | "openboard";

export const AURORA_FAMILIES = ["Aurora", "Kilter", "Tension", "Decoy", "Grasshopper"] as const;

const AURORA_NAME = new RegExp(`^(${AURORA_FAMILIES.join("|")}) Board#[^@]*@3$`);

export function protocolFor(name: string, openboardName = "OpenBoard"): Protocol | null {
  if (name === openboardName) return "openboard";
  if (AURORA_NAME.test(name)) return "aurora";
  return null;
}

/** "Kilter Board#1@3" -> "Kilter Board", for display. */
export const familyOf = (name: string): string => name.replace(/#.*$/, "");
