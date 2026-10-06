/**
 * What a board speaks, from the name it advertises. Pure, so it can be tested
 * in Node.
 *
 * Aurora-family boards advertise "<Family> Board#<serial>@<API level>", as
 * "Kilter Board#1@3" (the firmware's own serial is 1). The app speaks Aurora
 * API 3 only, so it takes any serial but only boards announcing API level 3.
 * A board in OpenBoard mode advertises "OpenBoard", or "OpenBoard <name>"
 * once it has been named (firmware 1.2.0 on).
 */
import { boardNameFromAdvertised } from "@openboard/openboard-protocol";

export type Protocol = "aurora" | "openboard";

export const AURORA_FAMILIES = ["Aurora", "Kilter", "Tension", "Decoy", "Grasshopper"] as const;

const AURORA_NAME = new RegExp(`^(${AURORA_FAMILIES.join("|")}) Board#[^@]*@3$`);

export function protocolFor(name: string): Protocol | null {
  if (boardNameFromAdvertised(name) !== null) return "openboard";
  if (AURORA_NAME.test(name)) return "aurora";
  return null;
}

/** "Kilter Board#1@3" -> "Kilter Board", for display. */
export const familyOf = (name: string): string => name.replace(/#.*$/, "");

/** What to call a board, from what it advertises: its own name if it has one. */
export const boardLabel = (advertised: string): string => boardNameFromAdvertised(advertised) || familyOf(advertised);

/** How near a board sounds, from its signal strength in dBm. Rough: walls and bodies weaken it. */
export function signalOf(rssi: number | null): "strong" | "good" | "weak" | null {
  if (rssi === null) return null;
  return rssi >= -60 ? "strong" : rssi >= -75 ? "good" : "weak";
}

/** The end of a board's Bluetooth address, "98:42", to tell unnamed boards apart. */
export const shortId = (id: string): string => id.slice(-5);
