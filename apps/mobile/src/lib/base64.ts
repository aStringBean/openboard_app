/**
 * react-native-ble-plx takes characteristic values as base64. Hermes has no
 * Buffer and btoa is not dependable across platforms, so this is a small
 * explicit encoder rather than a polyfill dependency.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array): string {
  let out = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : ALPHABET[b2 & 0x3f];
  }

  return out;
}

const LOOKUP = new Map([...ALPHABET].map((c, i) => [c, i]));

/** Notification values arrive as base64 too. */
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let n = 0;

  for (let i = 0; i < clean.length; i += 4) {
    const c0 = LOOKUP.get(clean[i]!) ?? 0;
    const c1 = LOOKUP.get(clean[i + 1] ?? "A") ?? 0;
    const c2 = clean[i + 2] === undefined ? undefined : LOOKUP.get(clean[i + 2]!);
    const c3 = clean[i + 3] === undefined ? undefined : LOOKUP.get(clean[i + 3]!);

    out[n++] = (c0 << 2) | (c1 >> 4);
    if (c2 !== undefined) out[n++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (c3 !== undefined && c2 !== undefined) out[n++] = ((c2 & 0x03) << 6) | c3;
  }

  return out.subarray(0, n);
}
