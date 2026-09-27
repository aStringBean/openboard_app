import { beforeEach, describe, expect, it } from "vitest";

import { browseFrom, browseNothing, neighbours } from "./browse";

describe("browsing a list of problems", () => {
  beforeEach(() => browseFrom(["a", "b", "c"]));

  it("knows each problem's neighbours and place", () => {
    expect(neighbours("a")).toEqual({ prev: null, next: "b", position: 1, count: 3 });
    expect(neighbours("b")).toEqual({ prev: "a", next: "c", position: 2, count: 3 });
    expect(neighbours("c")).toEqual({ prev: "b", next: null, position: 3, count: 3 });
  });

  it("has nothing for a problem not in the list", () => {
    expect(neighbours("z")).toBeNull();
  });

  it("has nothing to swipe to in a list of one", () => {
    browseFrom(["a"]);
    expect(neighbours("a")).toBeNull();
  });

  it("forgets the list when a problem is opened from elsewhere", () => {
    browseNothing();
    expect(neighbours("b")).toBeNull();
  });

  it("counts each problem once, where it first appears", () => {
    browseFrom(["a", "b", "a", "c", "b"]);
    expect(neighbours("c")).toEqual({ prev: "b", next: null, position: 3, count: 3 });
  });
});
