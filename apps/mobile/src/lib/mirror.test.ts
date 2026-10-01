import { describe, expect, it } from "vitest";

import { hasTwin, mirrorMap, mirrorProblem, pairHolds, parseMirror, setPair, unpair, unpairedIn } from "./mirror";

/** A grid of holds, `cols` across, evenly spaced over the board, shifted by dx. */
function grid(cols: number, rows: number, dx = 0) {
  const holds: { id: number; x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      holds.push({ id: holds.length, x: (c + 0.5) / cols + dx, y: (r + 0.5) / rows });
    }
  }
  return holds;
}

const partnerOf = (holds: { id: number; x: number; y: number }[], id: number) => {
  const map = mirrorMap(pairHolds(holds).mirror);
  return holds.find((h) => h.id === map.get(id));
};

describe("pairHolds", () => {
  it("pairs a board with a centre column, which pairs with itself", () => {
    const holds = grid(11, 4);
    const { mirror, unpaired } = pairHolds(holds);
    expect(unpaired).toEqual([]);
    /* 5 pairs and 1 centre hold per row. */
    expect(mirror.pairs).toHaveLength(4 * 6);
    expect(mirror.pairs).toContainEqual([5, 5]);
    expect(partnerOf(holds, 0)).toMatchObject({ id: 10 });
  });

  it("pairs a board without a centre column across the gap", () => {
    const holds = grid(10, 3);
    const { mirror, unpaired } = pairHolds(holds);
    expect(unpaired).toEqual([]);
    expect(mirror.pairs.every(([a, b]) => a !== b)).toBe(true);
    expect(partnerOf(holds, 4)).toMatchObject({ id: 5 });
  });

  it("finds the centre line when the corners were marked a little off", () => {
    const holds = grid(11, 4, 0.03);
    const { axis, unpaired } = pairHolds(holds);
    expect(axis).toBeCloseTo(0.53, 2);
    expect(unpaired).toEqual([]);
  });

  it("leaves a hold with no reflection unpaired", () => {
    const holds = [...grid(10, 2), { id: 99, x: 0.02, y: 0.5 }];
    expect(pairHolds(holds).unpaired).toEqual([99]);
  });

  it("never gives two holds the same partner", () => {
    /* Two holds close together on the left, one on the right. */
    const holds = [
      { id: 0, x: 0.2, y: 0.5 },
      { id: 1, x: 0.21, y: 0.5 },
      { id: 2, x: 0.8, y: 0.5 },
      { id: 3, x: 0.5, y: 0.1 },
      { id: 4, x: 0.5, y: 0.9 },
    ];
    const { mirror, unpaired } = pairHolds(holds);
    expect(mirror.pairs).toContainEqual([0, 2]);
    expect(unpaired).toEqual([1]);
  });

  it("copes with no holds", () => {
    expect(pairHolds([]).mirror.pairs).toEqual([]);
  });
});

describe("mirrored problems", () => {
  const map = mirrorMap({
    pairs: [
      [1, 2],
      [3, 3],
      [4, 5],
    ],
  });

  it("swap each hold for its partner, keeping roles", () => {
    expect(
      mirrorProblem(
        [
          { holdId: 1, role: "start" },
          { holdId: 3, role: "hand" },
          { holdId: 5, role: "finish" },
        ],
        map,
      ),
    ).toEqual([
      { holdId: 2, role: "start" },
      { holdId: 3, role: "hand" },
      { holdId: 4, role: "finish" },
    ]);
  });

  it("do not exist when a hold has no partner", () => {
    const holds = [
      { holdId: 1, role: "start" as const },
      { holdId: 9, role: "finish" as const },
    ];
    expect(mirrorProblem(holds, map)).toBeNull();
    expect(unpairedIn(holds, map)).toEqual([9]);
    expect(hasTwin(holds, map)).toBe(false);
  });

  it("are no twin when the problem is its own reflection", () => {
    const symmetric = [
      { holdId: 1, role: "start" as const },
      { holdId: 2, role: "start" as const },
      { holdId: 3, role: "finish" as const },
    ];
    expect(hasTwin(symmetric, map)).toBe(false);
    /* The same holds with sides swapped in role are a different climb. */
    expect(
      hasTwin(
        [
          { holdId: 1, role: "start" },
          { holdId: 2, role: "hand" },
        ],
        map,
      ),
    ).toBe(true);
  });
});

describe("editing pairs", () => {
  it("re-pairs, unpairs, and drops pairs whose holds are gone", () => {
    let m = {
      pairs: [
        [1, 2],
        [3, 4],
      ] as [number, number][],
    };
    m = setPair(m, 2, 3);
    expect(m.pairs).toEqual([[2, 3]]);
    m = setPair(m, 7, 7);
    expect(m.pairs).toEqual([
      [2, 3],
      [7, 7],
    ]);
    expect(unpair(m, 3).pairs).toEqual([[7, 7]]);
    expect([...mirrorMap(m, [2, 3]).keys()].sort()).toEqual([2, 3]);
  });

  it("reads the stored form, ignoring junk", () => {
    expect(parseMirror('{"pairs":[[1,2],[3,"x"],[4]]}')).toEqual({ pairs: [[1, 2]] });
    expect(parseMirror(null)).toBeNull();
    expect(parseMirror("not json")).toBeNull();
  });
});
