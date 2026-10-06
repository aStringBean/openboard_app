import { boardNameFromAdvertised, boardNameProblem, utf8Decode, utf8Encode } from "../src/index.js";

describe("board names", () => {
  it("reads a board's name from what it advertises", () => {
    expect(boardNameFromAdvertised("OpenBoard")).toBe("");
    expect(boardNameFromAdvertised("OpenBoard Garage wall")).toBe("Garage wall");
    expect(boardNameFromAdvertised("OpenBoardX")).toBeNull();
    expect(boardNameFromAdvertised("OpenBoard ")).toBeNull();
    expect(boardNameFromAdvertised("Kilter Board#1@3")).toBeNull();
  });

  it("refuses what the board would refuse", () => {
    expect(boardNameProblem("Garage wall")).toBeNull();
    expect(boardNameProblem("")).toBeNull();
    /* 19 bytes fits; "é" counts two. */
    expect(boardNameProblem("nineteen bytes long")).toBeNull();
    expect(boardNameProblem("nineteen bytes loné")).toMatch(/at most 19 characters/);
    expect(boardNameProblem("tab\there")).toMatch(/control/);
    expect(boardNameProblem("x\u0085")).toMatch(/control/);
    expect(boardNameProblem("Wall ")).toMatch(/space/);
  });

  it("round-trips UTF-8, emoji included", () => {
    const name = "Café € 🧗";
    expect(Array.from(utf8Encode(name)).length).toBe(14);
    expect(utf8Decode(utf8Encode(name))).toBe(name);
  });

  it("decodes malformed UTF-8 without throwing", () => {
    expect(utf8Decode(Uint8Array.from([0x41, 0x80, 0x42]))).toBe("A�B");
    expect(utf8Decode(Uint8Array.from([0x63, 0xc3]))).toBe("c�");
  });
});
