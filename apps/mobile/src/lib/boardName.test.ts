import { describe, expect, it } from "vitest";

import { boardLabel, familyOf, protocolFor, shortId, signalOf } from "./boardName";

describe("protocolFor", () => {
  it("knows every Aurora family the firmware can be", () => {
    for (const family of ["Aurora", "Kilter", "Tension", "Decoy", "Grasshopper"]) {
      expect(protocolFor(`${family} Board#1@3`)).toBe("aurora");
    }
  });

  it("takes any serial, as vendor boards advertise their own", () => {
    expect(protocolFor("Kilter Board#12345@3")).toBe("aurora");
    expect(protocolFor("Tension Board#@3")).toBe("aurora");
  });

  it("speaks only API 3: a board announcing another level is left alone", () => {
    expect(protocolFor("Kilter Board#1@2")).toBeNull();
    expect(protocolFor("Kilter Board#1")).toBeNull();
    expect(protocolFor("Kilter Board#1@30")).toBeNull();
  });

  it("finds OpenBoard, named or not", () => {
    expect(protocolFor("OpenBoard")).toBe("openboard");
    expect(protocolFor("OpenBoard Garage wall")).toBe("openboard");
    expect(protocolFor("OpenBoardX")).toBeNull();
    expect(protocolFor("OpenBoard ")).toBeNull();
  });

  it("ignores everything else", () => {
    expect(protocolFor("Moonboard")).toBeNull();
    expect(protocolFor("Kilter Board")).toBeNull();
    expect(protocolFor("Pixel Buds")).toBeNull();
    expect(protocolFor("xKilter Board#1@3")).toBeNull();
  });

  it("shows the family without serial and level", () => {
    expect(familyOf("Grasshopper Board#1@3")).toBe("Grasshopper Board");
    expect(familyOf("OpenBoard")).toBe("OpenBoard");
  });

  it("calls a board by its own name when it has one", () => {
    expect(boardLabel("OpenBoard Garage wall")).toBe("Garage wall");
    expect(boardLabel("OpenBoard")).toBe("OpenBoard");
    expect(boardLabel("Kilter Board#1@3")).toBe("Kilter Board");
  });

  it("says how near a board sounds", () => {
    expect(signalOf(-45)).toBe("strong");
    expect(signalOf(-70)).toBe("good");
    expect(signalOf(-90)).toBe("weak");
    expect(signalOf(null)).toBeNull();
  });

  it("shortens an address to its last two bytes", () => {
    expect(shortId("F9:6C:73:5F:98:42")).toBe("98:42");
  });
});
