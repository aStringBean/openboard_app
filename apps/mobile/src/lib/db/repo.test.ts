import { beforeEach, describe, expect, it } from "vitest";

import {
  addHold,
  assignLed,
  deleteHold,
  emptyCalibration,
  mergeDetections,
  resetCalibration,
  type Calibration,
} from "../calibration";
import type { Problem } from "../problem";
import type { Tick } from "../tick";
import {
  clearChange,
  createList,
  createWall,
  deleteList,
  getList,
  listLists,
  listsContaining,
  renameList,
  setListItems,
  toggleInList,
  deleteProblem,
  deleteTick,
  firstWall,
  getProblem,
  getSetting,
  getWall,
  deleteWallLocally,
  listComments,
  listProblems,
  loadCalibration,
  listWalls,
  logbook,
  pendingChanges,
  problemsUsingHold,
  saveCalibration,
  saveProblem,
  saveComment,
  saveTick,
  setSetting,
  ticksFor,
  updateWall,
  usedHoldIds,
} from "./repo";
import { migrate, SCHEMA_VERSION } from "./schema";
import { memoryDb } from "./testDb";
import type { Db } from "./types";

const WALL = "wall-1";

/** A calibration with three detected holds, the first two mapped to LEDs. */
function seeded(): Calibration {
  let c = mergeDetections(emptyCalibration(10), [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.5 },
    { x: 0.9, y: 0.9 },
  ]);
  c = assignLed(c, 0, 0.1, 0.1);
  c = assignLed(c, 1, 0.5, 0.5);
  return { ...c, photoUri: "file:///wall.jpg", photoAspect: 0.75, taps: [300, 250], elapsedMs: 4000 };
}

const problem = (over: Partial<Problem> = {}): Problem => ({
  id: "p1",
  wallId: WALL,
  name: "Crimp city",
  grade: 5,
  setterId: null,
  angle: 40,
  holds: [
    { holdId: 0, role: "start" },
    { holdId: 1, role: "finish" },
  ],
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

let db: Db;

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
});

describe("schema", () => {
  it("records its version, and migrating again is a no-op", async () => {
    await migrate(db);
    expect(await db.get("PRAGMA user_version")).toEqual({ user_version: SCHEMA_VERSION });
  });

  it("enforces foreign keys", async () => {
    expect(await db.get("PRAGMA foreign_keys")).toEqual({ foreign_keys: 1 });
  });
});

describe("walls", () => {
  it("creates a fixed wall, found as the first wall", async () => {
    await createWall(db, WALL, "Garage");

    expect(await firstWall(db)).toEqual({
      id: WALL,
      name: "Garage",
      angleMode: "fixed",
      angles: [40],
      currentAngle: 40,
      cloud: false,
      role: null,
      setterPolicy: "everyone",
    });
  });

  it("saves angle settings", async () => {
    const wall = await createWall(db, WALL, "Garage");
    await updateWall(db, { ...wall, angleMode: "adjustable", angles: [20, 30, 40], currentAngle: 30 });

    expect(await getWall(db, WALL)).toMatchObject({ angleMode: "adjustable", angles: [20, 30, 40], currentAngle: 30 });
  });
});

describe("calibration", () => {
  it("round-trips holds and sweep state", async () => {
    const c = seeded();
    await createWall(db, WALL, "Garage", c);

    expect(await loadCalibration(db, WALL)).toEqual(c);
  });

  it("writes changes and removals", async () => {
    let c = seeded();
    await createWall(db, WALL, "Garage", c);

    c = addHold(c, 0.3, 0.7).cal;
    c = deleteHold(c, 2);
    c = { ...c, noHold: [2], nextLed: 3 };
    await saveCalibration(db, WALL, c);

    expect(await loadCalibration(db, WALL)).toEqual(c);
  });

  it("never hands out a hold id twice, even if the stored counter is behind", async () => {
    await createWall(db, WALL, "Garage", { ...seeded(), nextHoldId: 0 });

    expect((await loadCalibration(db, WALL)).nextHoldId).toBe(3);
  });
});

describe("problems", () => {
  beforeEach(async () => {
    await createWall(db, WALL, "Garage", seeded());
  });

  it("round-trips a problem with its holds", async () => {
    await saveProblem(db, problem());

    expect(await getProblem(db, "p1")).toEqual(problem());
  });

  it("replaces a problem's holds when it is saved again", async () => {
    await saveProblem(db, problem());
    await saveProblem(db, problem({ name: "Crimp town", holds: [{ holdId: 2, role: "no_match" }], updatedAt: 2000 }));

    expect(await getProblem(db, "p1")).toMatchObject({
      name: "Crimp town",
      holds: [{ holdId: 2, role: "no_match" }],
      createdAt: 1000,
      updatedAt: 2000,
    });
  });

  it("lists problems newest first, with hold counts", async () => {
    await saveProblem(db, problem({ id: "old", createdAt: 1 }));
    await saveProblem(db, problem({ id: "new", createdAt: 2, holds: [{ holdId: 0, role: "start" }] }));

    expect((await listProblems(db, WALL)).map((p) => [p.id, p.holdIds.length])).toEqual([
      ["new", 1],
      ["old", 2],
    ]);
  });

  it("refuses a problem that uses a hold that does not exist", async () => {
    await expect(saveProblem(db, problem({ holds: [{ holdId: 99, role: "start" }] }))).rejects.toThrow(
      /FOREIGN KEY/,
    );
    expect(await getProblem(db, "p1")).toBeUndefined();
  });

  it("frees its holds when deleted", async () => {
    await saveProblem(db, problem());
    await deleteProblem(db, "p1");

    expect(await usedHoldIds(db, WALL)).toEqual(new Set());
  });

  it("reports which holds are in use, and by what", async () => {
    await saveProblem(db, problem());
    await saveProblem(db, problem({ id: "p2", name: "Another", holds: [{ holdId: 0, role: "hand" }] }));

    expect(await usedHoldIds(db, WALL)).toEqual(new Set([0, 1]));
    expect((await problemsUsingHold(db, WALL, 0)).map((p) => p.name)).toEqual(["Another", "Crimp city"]);
  });
});

describe("a hold a problem uses", () => {
  beforeEach(async () => {
    await createWall(db, WALL, "Garage", seeded());
    await saveProblem(db, problem());
  });

  it("cannot be deleted: the whole save fails and nothing changes", async () => {
    /* Hold 0 is a start hold of p1. A save that drops it must not land,
     * not even the unrelated change made alongside it. */
    const before = await loadCalibration(db, WALL);
    const bad = { ...deleteHold(before, 0), nextLed: 7 };

    await expect(saveCalibration(db, WALL, bad)).rejects.toThrow(/FOREIGN KEY/);
    expect(await loadCalibration(db, WALL)).toEqual(before);
  });

  it("survives re-detection and reset when the calibration is told it is in use", async () => {
    const used = await usedHoldIds(db, WALL);
    let c = await loadCalibration(db, WALL);

    c = mergeDetections(c, [{ x: 0.4, y: 0.4 }], used);
    await saveCalibration(db, WALL, c);
    c = resetCalibration(c, used);
    await saveCalibration(db, WALL, c);

    expect((await loadCalibration(db, WALL)).holds.map((h) => h.id).sort()).toEqual([0, 1]);
    expect(await getProblem(db, "p1")).toEqual(problem());
  });
});

describe("settings", () => {
  it("stores and overwrites values", async () => {
    expect(await getSetting(db, "gradeScale")).toBeUndefined();

    await setSetting(db, "gradeScale", "v");
    await setSetting(db, "gradeScale", "both");

    expect(await getSetting(db, "gradeScale")).toBe("both");
  });
});

const tick = (over: Partial<Tick> = {}): Tick => ({
  id: "t1",
  problemId: "p1",
  climbedAt: 5000,
  userId: null,
  angle: 40,
  attempts: 2,
  grade: 7,
  stars: 3,
  comment: "",
  ...over,
});

describe("ticks", () => {
  beforeEach(async () => {
    await createWall(db, WALL, "Garage", seeded());
    await saveProblem(db, problem());
  });

  it("round-trip, newest first", async () => {
    await saveTick(db, tick({ id: "a", climbedAt: 1 }));
    await saveTick(db, tick({ id: "b", climbedAt: 2, comment: "  crux is the move to the pinch  " }));

    const ticks = await ticksFor(db, "p1");
    expect(ticks.map((t) => t.id)).toEqual(["b", "a"]);
    expect(ticks[0]!.comment).toBe("crux is the move to the pinch");
  });

  it("feed the problem list's consensus, stars and ticked state", async () => {
    await saveTick(db, tick({ id: "a", grade: 7, stars: 3 }));
    await saveTick(db, tick({ id: "b", grade: 7, stars: 2 }));

    /* Setter said 5; two ascents say 7 → (5 + 7 + 7) / 3 = 6.33 → 6. */
    expect((await listProblems(db, WALL))[0]).toMatchObject({ consensus: 6, stars: 2.5, ascents: 2, ticked: true });
  });

  it("go when their problem is deleted", async () => {
    await saveTick(db, tick());
    await deleteProblem(db, "p1");

    expect(await db.all("SELECT * FROM tick")).toEqual([]);
  });

  it("can be deleted on their own", async () => {
    await saveTick(db, tick());
    await deleteTick(db, "t1");

    expect(await ticksFor(db, "p1")).toEqual([]);
  });

  it("are listed in the logbook with their problem's name", async () => {
    await saveTick(db, tick({ id: "a", climbedAt: 1 }));
    await saveTick(db, tick({ id: "b", climbedAt: 2 }));

    expect((await logbook(db, WALL)).map((e) => [e.id, e.problemName])).toEqual([
      ["b", "Crimp city"],
      ["a", "Crimp city"],
    ]);
  });

  it("refuse impossible values at the database too", async () => {
    await expect(saveTick(db, tick({ attempts: 0 }))).rejects.toThrow(/CHECK/);
    await expect(saveTick(db, tick({ stars: 5 }))).rejects.toThrow(/CHECK/);
  });
});

describe("upgrading an existing install", () => {
  it("brings a version 1 database up to date without touching its data", async () => {
    const old = memoryDb();
    await migrate(old, 1);
    await createWall(old, WALL, "Garage", seeded());
    /* Written as version 1 code wrote it: the repository now expects newer columns. */
    await old.run("INSERT INTO problem (id, wall_id, name, grade, angle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      "p1",
      WALL,
      "Crimp city",
      5,
      40,
      1000,
      1000,
    ]);
    await old.run(
      "INSERT INTO problem_hold (problem_id, wall_id, hold_id, role) VALUES ('p1', ?, 0, 'start'), ('p1', ?, 1, 'finish')",
      [WALL, WALL],
    );
    const before = await loadCalibration(old, WALL);

    await migrate(old);

    expect(await old.get("PRAGMA user_version")).toEqual({ user_version: SCHEMA_VERSION });
    expect(await loadCalibration(old, WALL)).toEqual(before);
    expect(await getProblem(old, "p1")).toEqual(problem());
    await saveTick(old, tick());
    expect(await ticksFor(old, "p1")).toHaveLength(1);
  });
});

describe("lists", () => {
  beforeEach(async () => {
    await createWall(db, WALL, "Garage", seeded());
    for (const id of ["p1", "p2", "p3"]) await saveProblem(db, problem({ id, name: id }));
    await createList(db, "L", WALL, "  Warm-up  ");
  });

  it("keep their problems in order", async () => {
    await setListItems(db, "L", ["p3", "p1", "p2"]);

    expect(await getList(db, "L")).toEqual({
      id: "L",
      name: "Warm-up",
      problemIds: ["p3", "p1", "p2"],
      ownerId: null,
      shared: false,
    });
    expect(await listLists(db, WALL)).toEqual([{ id: "L", name: "Warm-up", count: 3, ownerId: null, shared: false }]);
  });

  it("hold a problem at most once", async () => {
    await setListItems(db, "L", ["p1", "p2", "p1"]);

    expect((await getList(db, "L"))!.problemIds).toEqual(["p1", "p2"]);
  });

  it("add to the end and remove without disturbing the rest", async () => {
    await setListItems(db, "L", ["p1", "p2"]);

    expect(await toggleInList(db, "L", "p3")).toBe(true);
    expect((await getList(db, "L"))!.problemIds).toEqual(["p1", "p2", "p3"]);

    expect(await toggleInList(db, "L", "p1")).toBe(false);
    expect((await getList(db, "L"))!.problemIds).toEqual(["p2", "p3"]);
  });

  it("lose a problem that is deleted", async () => {
    await setListItems(db, "L", ["p1", "p2"]);
    await deleteProblem(db, "p1");

    expect((await getList(db, "L"))!.problemIds).toEqual(["p2"]);
  });

  it("report which lists a problem is in", async () => {
    await createList(db, "M", WALL, "Project");
    await setListItems(db, "L", ["p1"]);
    await setListItems(db, "M", ["p1", "p2"]);

    expect(await listsContaining(db, "p1")).toEqual(new Set(["L", "M"]));
    expect(await listsContaining(db, "p3")).toEqual(new Set());
  });

  it("can be renamed and deleted, taking their items with them", async () => {
    await setListItems(db, "L", ["p1"]);
    await renameList(db, "L", "Circuit A");
    expect((await getList(db, "L"))!.name).toBe("Circuit A");

    await deleteList(db, "L");
    expect(await getList(db, "L")).toBeUndefined();
    expect(await db.all("SELECT * FROM list_item")).toEqual([]);
  });

  it("refuse a problem that does not exist", async () => {
    await expect(setListItems(db, "L", ["nope"])).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe("changes for the server", () => {
  const share = () => db.run("UPDATE wall SET cloud = 1, my_role = 'owner' WHERE id = ?", [WALL]);
  const queued = async () => (await pendingChanges(db, WALL)).map((e) => `${e.kind}:${e.op}:${e.id}`);

  beforeEach(async () => {
    await createWall(db, WALL, "Garage", seeded());
  });

  it("are not queued for a wall that stays on this phone", async () => {
    await saveProblem(db, problem());
    await saveTick(db, tick());

    expect(await queued()).toEqual([]);
  });

  it("are queued, in order, once the wall is shared", async () => {
    await share();
    await saveProblem(db, problem());
    await saveTick(db, tick());
    await saveComment(db, { id: "c1", problemId: "p1", userId: null, body: "Nice", createdAt: 1 });
    await createList(db, "L", WALL, "Circuit");

    expect(await queued()).toEqual(["problem:upsert:p1", "tick:upsert:t1", "comment:upsert:c1", "list:upsert:L"]);
  });

  it("keep one entry per row, the latest operation winning", async () => {
    await share();
    await saveProblem(db, problem());
    await saveProblem(db, problem({ name: "Renamed" }));
    await deleteProblem(db, "p1");

    expect(await queued()).toEqual(["problem:delete:p1"]);
  });

  it("are not queued when they came from the server", async () => {
    await share();
    await saveProblem(db, problem(), { fromServer: true });
    await deleteProblem(db, "p1", { fromServer: true });

    expect(await queued()).toEqual([]);
  });

  it("survive an upload that finishes after the row changed again", async () => {
    await share();
    await saveProblem(db, problem());
    const [sent] = await pendingChanges(db, WALL);
    await saveProblem(db, problem({ name: "Edited while uploading" }));

    await clearChange(db, sent!);

    expect(await queued()).toEqual(["problem:upsert:p1"]);
  });

  it("queue holds and photo only when they really change", async () => {
    await share();
    const c = await loadCalibration(db, WALL);

    await saveCalibration(db, WALL, { ...c, taps: [...c.taps, 100] });
    expect(await queued()).toEqual([]);

    await saveCalibration(db, WALL, { ...c, holds: c.holds.map((h) => (h.id === 2 ? { ...h, x: 0.8 } : h)) });
    await saveCalibration(db, WALL, { ...c, photoUri: "file:///new.jpg" });
    expect(await queued()).toEqual([`holds:upsert:${WALL}`, `photo:upsert:${WALL}`]);
  });
});

describe("several people on one wall", () => {
  beforeEach(async () => {
    await createWall(db, WALL, "Garage", seeded());
    await saveProblem(db, problem());
  });

  it("keeps my logbook to my ascents, and those from before signing in", async () => {
    await saveTick(db, tick({ id: "old", userId: null }));
    await saveTick(db, tick({ id: "mine", userId: "me" }));
    await saveTick(db, tick({ id: "theirs", userId: "them" }));

    expect((await logbook(db, WALL, "me")).map((e) => e.id).sort()).toEqual(["mine", "old"]);
  });

  it("shows my lists and shared ones, not others' private lists", async () => {
    await createList(db, "mine", WALL, "Mine", "me");
    await createList(db, "private", WALL, "Theirs", "them");
    await createList(db, "shared", WALL, "Circuit", "them", { shared: true });

    expect((await listLists(db, WALL, "me")).map((l) => l.id).sort()).toEqual(["mine", "shared"]);
  });

  it("names comment authors from the wall's members", async () => {
    await db.run("INSERT INTO member (wall_id, user_id, role, name) VALUES (?, 'them', 'climber', 'Cleo')", [WALL]);
    await saveComment(db, { id: "c1", problemId: "p1", userId: "them", body: "Crux is hard", createdAt: 2 });
    await saveComment(db, { id: "c2", problemId: "p1", userId: "gone", body: "Agreed", createdAt: 3 });

    expect(await listComments(db, "p1")).toMatchObject([
      { body: "Crux is hard", author: "Cleo" },
      { body: "Agreed", author: "" },
    ]);
  });

  it("forgets a wall entirely when leaving it", async () => {
    await createWall(db, "other", "Board");
    await saveTick(db, tick());
    await createList(db, "L", WALL, "Circuit");
    await saveComment(db, { id: "c1", problemId: "p1", userId: null, body: "x", createdAt: 1 });

    await deleteWallLocally(db, WALL);

    expect((await listWalls(db)).map((w) => w.id)).toEqual(["other"]);
    for (const t of ["problem", "problem_hold", "tick", "list", "comment", "hold"]) {
      expect(await db.all(`SELECT * FROM ${t}`), t).toEqual([]);
    }
  });
});
