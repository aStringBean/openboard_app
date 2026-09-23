/**
 * The firmware reports framing faults as `-EINVAL` and an unrecognised
 * sequence byte as `-EPROTO`. The decoder here throws instead, carrying the
 * same distinction so tests ported from `tests/parse/src/main.c` still
 * distinguish the two.
 */
export type AuroraErrorCode = "EINVAL" | "EPROTO";

export class AuroraProtocolError extends Error {
  readonly code: AuroraErrorCode;

  constructor(code: AuroraErrorCode, message: string) {
    super(message);
    this.name = "AuroraProtocolError";
    this.code = code;
  }
}
