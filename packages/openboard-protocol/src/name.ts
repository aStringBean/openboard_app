/**
 * Board names (sections 2 and 8): what a board in OpenBoard mode advertises,
 * and which names it accepts. UTF-8 by hand, since not every JavaScript
 * engine the app runs on has TextDecoder.
 */

import { DEVICE_NAME } from "./constants.js";

/** The longest name, in UTF-8 bytes: "OpenBoard " and it fill a scan response. */
export const NAME_MAX_BYTES = 19;

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

/** Decodes UTF-8; anything malformed becomes U+FFFD rather than an error. */
export function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]!;
    const n = b < 0x80 ? 1 : b >= 0xc2 && b <= 0xdf ? 2 : b >= 0xe0 && b <= 0xef ? 3 : b >= 0xf0 && b <= 0xf4 ? 4 : 0;
    if (n === 0 || i + n > bytes.length) {
      out += "\uFFFD";
      i++;
      continue;
    }
    let c = n === 1 ? b : b & (0xff >> (n + 1));
    let ok = true;
    for (let j = 1; j < n; j++) {
      const cont = bytes[i + j]!;
      if ((cont & 0xc0) !== 0x80) ok = false;
      c = (c << 6) | (cont & 0x3f);
    }
    out += ok ? String.fromCodePoint(c) : "\uFFFD";
    i += ok ? n : 1;
  }
  return out;
}

/**
 * Why a board would refuse this name, or null if it would take it. The
 * board's rules: at most 19 bytes of UTF-8, no control characters (C0, DEL,
 * C1), no space at either end. Empty is fine: it clears the name.
 */
export function boardNameProblem(name: string): string | null {
  if (utf8Encode(name).length > NAME_MAX_BYTES) {
    return `A board name is at most ${NAME_MAX_BYTES} characters (an accented letter counts as two).`;
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return "A board name can't contain control characters.";
  if (name !== name.trim()) return "A board name can't start or end with a space.";
  return null;
}

/**
 * The board's name, from what it advertises: "" for plain "OpenBoard", the
 * name for "OpenBoard <name>", and null for anything that is not a board in
 * OpenBoard mode.
 */
export function boardNameFromAdvertised(advertised: string): string | null {
  if (advertised === DEVICE_NAME) return "";
  if (advertised.startsWith(DEVICE_NAME + " ") && advertised.length > DEVICE_NAME.length + 1) {
    return advertised.slice(DEVICE_NAME.length + 1);
  }
  return null;
}
