import { describe, expect, it } from "vitest";

import {
  countRoles,
  newId,
  problemFrame,
  clashingRoles,
  PALETTE,
  parseRoleColors,
  rgbHex,
  roleLed,
  roleUi,
  ROLE_STYLE,
  withRoleColor,
  roleFull,
  ROLES,
  toggleRole,
  validateProblem,
  type ProblemHold,
} from "./problem";

describe("toggleRole", () => {
  it("adds a hold in the selected role", () => {
    expect(toggleRole([], 7, "start")).toEqual([{ holdId: 7, role: "start" }]);
  });

  it("changes a hold to the selected role", () => {
    expect(toggleRole([{ holdId: 7, role: "hand" }], 7, "foot")).toEqual([{ holdId: 7, role: "foot" }]);
  });

  it("removes a hold tapped again in the same role", () => {
    expect(toggleRole([{ holdId: 7, role: "hand" }], 7, "hand")).toEqual([]);
  });

  it("leaves other holds alone", () => {
    const holds: ProblemHold[] = [
      { holdId: 1, role: "start" },
      { holdId: 2, role: "finish" },
    ];

    expect(toggleRole(holds, 1, "hand")).toEqual([
      { holdId: 1, role: "hand" },
      { holdId: 2, role: "finish" },
    ]);
  });
});

describe("validateProblem", () => {
  const complete: ProblemHold[] = [
    { holdId: 1, role: "start" },
    { holdId: 2, role: "finish" },
  ];

  it("accepts a named problem with a start and a finish", () => {
    expect(validateProblem({ name: "Crimp city", holds: complete })).toEqual([]);
  });

  it("lists everything missing", () => {
    expect(validateProblem({ name: "  ", holds: [] })).toEqual([
      "Give it a name.",
      "Add at least one start hold.",
      "Add at least one finish hold.",
    ]);
  });

  it("counts roles", () => {
    expect(countRoles([...complete, { holdId: 3, role: "no_match" }])).toEqual({
      start: 1,
      hand: 0,
      no_match: 1,
      foot: 0,
      finish: 1,
    });
  });
});

describe("problemFrame", () => {
  const wall = [
    { id: 1, led: 10 },
    { id: 2, led: 11 },
    { id: 3, led: null },
  ];

  it("lights each hold in its role colour", () => {
    const { leds, unlit } = problemFrame(
      [
        { holdId: 1, role: "start" },
        { holdId: 2, role: "no_match" },
      ],
      wall,
    );

    expect(leds).toEqual([
      { pos: 10, r: 0, g: 255, b: 0 },
      { pos: 11, r: 255, g: 0, b: 255 },
    ]);
    expect(unlit).toBe(0);
  });

  it("leaves out holds with no LED, and counts them", () => {
    const { leds, unlit } = problemFrame(
      [
        { holdId: 1, role: "start" },
        { holdId: 3, role: "foot" },
        { holdId: 99, role: "hand" },
      ],
      wall,
    );

    expect(leds).toHaveLength(1);
    expect(unlit).toBe(2);
  });
});

describe("role colours", () => {
  it("are distinct on the wall", () => {
    const keys = ROLES.map((r) => JSON.stringify(ROLE_STYLE[r].led));
    expect(new Set(keys).size).toBe(ROLES.length);
  });

  it("are all exactly reproducible on the wire", () => {
    /* Every channel fully on or off: the eight colours API 3 carries exactly. */
    for (const r of ROLES) {
      for (const v of Object.values(ROLE_STYLE[r].led)) expect([0, 255]).toContain(v);
    }
  });

  it("light no-match in magenta, well away from hand's blue", () => {
    expect(ROLE_STYLE.no_match.led).toEqual({ r: 255, g: 0, b: 255 });
    expect(ROLE_STYLE.hand.led).toEqual({ r: 0, g: 0, b: 255 });
  });

  it("follow a wall's own colours, and the defaults for the rest", () => {
    const orange = { r: 255, g: 96, b: 0 };
    const { leds } = problemFrame(
      [
        { holdId: 1, role: "start" },
        { holdId: 2, role: "hand" },
      ],
      [
        { id: 1, led: 10 },
        { id: 2, led: 11 },
      ],
      { start: orange },
    );
    expect(leds).toEqual([
      { pos: 10, ...orange },
      { pos: 11, ...ROLE_STYLE.hand.led },
    ]);
    expect(roleLed("finish", { start: orange })).toEqual(ROLE_STYLE.finish.led);
  });

  it("draw a chosen colour softened on screen, a default as tuned", () => {
    expect(roleUi("hand")).toBe(ROLE_STYLE.hand.ui);
    expect(roleUi("hand", { hand: { r: 0, g: 0, b: 255 } })).toBe("#4040ff");
    expect(rgbHex({ r: 255, g: 96, b: 0 })).toBe("#ff6000");
  });

  it("store only what differs from the default", () => {
    const orange = { r: 255, g: 96, b: 0 };
    const changed = withRoleColor({}, "start", orange);
    expect(changed).toEqual({ start: orange });
    expect(withRoleColor(changed, "start", ROLE_STYLE.start.led)).toEqual({});
  });

  it("read back only well-formed colours for known roles", () => {
    expect(parseRoleColors('{"hand":{"r":1,"g":2,"b":3},"bogus":{"r":1,"g":1,"b":1}}')).toEqual({
      hand: { r: 1, g: 2, b: 3 },
    });
    expect(parseRoleColors({ start: { r: 300, g: 0, b: 0 }, foot: { r: 1, g: 2 } })).toEqual({});
    expect(parseRoleColors("not json")).toEqual({});
    expect(parseRoleColors(null)).toEqual({});
  });

  it("find roles that would light alike", () => {
    expect(clashingRoles({})).toEqual([]);
    expect(clashingRoles({ no_match: ROLE_STYLE.hand.led })).toEqual(["hand", "no_match"]);
  });

  it("offer a palette of distinct colours", () => {
    expect(new Set(PALETTE.map((p) => rgbHex(p.led))).size).toBe(PALETTE.length);
  });
});

describe("newId", () => {
  it("makes v4 UUIDs that do not repeat", () => {
    const ids = Array.from({ length: 2000 }, newId);

    for (const id of ids.slice(0, 20)) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("start and finish limits", () => {
  const two: ProblemHold[] = [
    { holdId: 1, role: "start" },
    { holdId: 2, role: "start" },
    { holdId: 3, role: "finish" },
  ];

  it("allow a second start or finish hold", () => {
    expect(roleFull(two.slice(1), 9, "start")).toBe(false);
    expect(roleFull(two, 9, "finish")).toBe(false);
  });

  it("refuse a third", () => {
    expect(roleFull(two, 9, "start")).toBe(true);
    /* Moving a hand hold into start counts the same as adding one. */
    expect(roleFull([...two, { holdId: 9, role: "hand" }], 9, "start")).toBe(true);
  });

  it("never block taking a hold out of the role", () => {
    expect(roleFull(two, 1, "start")).toBe(false);
  });

  it("leave the other roles unlimited", () => {
    const hands = Array.from({ length: 12 }, (_, i) => ({ holdId: i, role: "hand" as const }));
    expect(roleFull(hands, 99, "hand")).toBe(false);
  });

  it("stop a problem with too many from being saved", () => {
    const three = [...two, { holdId: 4, role: "start" as const }];
    expect(validateProblem({ name: "x", holds: three })).toEqual(["Use at most two start holds."]);
  });
});
