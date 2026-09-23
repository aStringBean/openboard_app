import { describe, expect, it } from "vitest";

import { move } from "./order";

describe("move", () => {
  it("moves an item up and down", () => {
    expect(move(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(move(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("ignores moves off either end", () => {
    expect(move(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(move(["a", "b"], 1, 2)).toEqual(["a", "b"]);
  });

  it("leaves its input alone", () => {
    const items = ["a", "b"];
    move(items, 0, 1);
    expect(items).toEqual(["a", "b"]);
  });
});
