/** Thrown for a packet that is malformed, or a value that cannot be encoded. */
export class OpenBoardProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenBoardProtocolError";
  }
}
