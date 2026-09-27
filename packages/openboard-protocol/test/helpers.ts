/** "01 0C 4E" -> bytes, and back, for writing vectors as the spec prints them. */
export const hex = (s: string): Uint8Array => Uint8Array.from(s.trim().split(/\s+/).map((b) => parseInt(b, 16)));

export const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0").toUpperCase()).join(" ");
