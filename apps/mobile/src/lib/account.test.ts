import { describe, expect, it } from "vitest";

import { accountChange } from "./account";

const LOCAL = "http://localhost:54321";
const HOSTED = "https://abc.supabase.co";
const walls = [
  { id: "home", cloud: false, role: null },
  { id: "owned", cloud: true, role: "owner" as const },
  { id: "joined", cloud: true, role: "climber" as const },
];
const phil = { id: "p", email: "phil@x" };

describe("accountChange", () => {
  it("changes nothing for the same account on the same server", () => {
    expect(accountChange({ ...phil, server: LOCAL }, phil, LOCAL, walls)).toEqual({ unshare: [], drop: [], record: null });
  });

  it("only records the account the first time one signs in", () => {
    expect(accountChange(null, phil, LOCAL, walls)).toEqual({
      unshare: [],
      drop: [],
      record: { ...phil, server: LOCAL },
    });
  });

  it("fills in the server on an account recorded without one", () => {
    expect(accountChange(phil, phil, LOCAL, walls)).toMatchObject({ unshare: [], drop: [], record: { server: LOCAL } });
  });

  it("drops every shared wall when someone else signs in", () => {
    const cleo = { id: "c", email: "cleo@x" };
    expect(accountChange({ ...phil, server: LOCAL }, cleo, LOCAL, walls)).toEqual({
      unshare: [],
      drop: ["owned", "joined"],
      record: { ...cleo, server: LOCAL },
    });
  });

  it("keeps owned walls as the phone's own when the server changes", () => {
    const hostedPhil = { id: "p2", email: "phil@x" };
    expect(accountChange({ ...phil, server: LOCAL }, hostedPhil, HOSTED, walls)).toEqual({
      unshare: ["owned"],
      drop: ["joined"],
      record: { ...hostedPhil, server: HOSTED },
    });
  });

  it("treats an old record with no server as the build's own server", () => {
    const cleo = { id: "c", email: "cleo@x" };
    expect(accountChange(phil, cleo, HOSTED, walls).drop).toEqual(["owned", "joined"]);
  });
});
