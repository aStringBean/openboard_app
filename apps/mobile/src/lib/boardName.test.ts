import { describe, expect, it } from "vitest";

import { familyOf, protocolFor } from "./boardName";

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

  it("finds OpenBoard by its exact name", () => {
    expect(protocolFor("OpenBoard")).toBe("openboard");
    expect(protocolFor("OpenBoard 2")).toBeNull();
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
});
