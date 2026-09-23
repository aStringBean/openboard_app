import { emptyCalibration, type Calibration, type WallHold } from "../calibration";
import { summarise, type ProblemSummary } from "../catalog";
import type { Problem, Role } from "../problem";
import type { Tick } from "../tick";
import { DEFAULT_FIXED_ANGLE, type AngleMode, type Wall } from "../wall";
import type { Db } from "./types";

// ---------------------------------------------------------------------- walls

interface WallRow {
  id: string;
  name: string;
  photo_uri: string | null;
  photo_aspect: number | null;
  angle_mode: AngleMode;
  angles: string;
  current_angle: number;
  calibration: string;
}

/** Sweep bookkeeping. It is only ever read and written whole, so it is JSON. */
type CalibrationState = Pick<
  Calibration,
  "chainLength" | "nextHoldId" | "noHold" | "snapEnabled" | "taps" | "nextLed" | "elapsedMs"
>;

const stateOf = (c: Calibration): CalibrationState => ({
  chainLength: c.chainLength,
  nextHoldId: c.nextHoldId,
  noHold: c.noHold,
  snapEnabled: c.snapEnabled,
  taps: c.taps,
  nextLed: c.nextLed,
  elapsedMs: c.elapsedMs,
});

const wallOf = (r: WallRow): Wall => ({
  id: r.id,
  name: r.name,
  angleMode: r.angle_mode,
  angles: JSON.parse(r.angles) as number[],
  currentAngle: r.current_angle,
});

export async function firstWall(db: Db): Promise<Wall | undefined> {
  const r = await db.get<WallRow>("SELECT * FROM wall ORDER BY created_at LIMIT 1");
  return r ? wallOf(r) : undefined;
}

export async function getWall(db: Db, id: string): Promise<Wall> {
  const r = await db.get<WallRow>("SELECT * FROM wall WHERE id = ?", [id]);
  if (!r) throw new Error(`No wall ${id}`);
  return wallOf(r);
}

/** Creates a wall, optionally seeded with an existing calibration. */
export async function createWall(
  db: Db,
  id: string,
  name: string,
  calibration: Calibration = emptyCalibration(),
): Promise<Wall> {
  await db.transaction(async () => {
    await db.run(
      `INSERT INTO wall (id, name, photo_uri, photo_aspect, angle_mode, angles, current_angle, calibration, created_at)
       VALUES (?, ?, ?, ?, 'fixed', ?, ?, ?, ?)`,
      [
        id,
        name,
        calibration.photoUri,
        calibration.photoAspect,
        JSON.stringify([DEFAULT_FIXED_ANGLE]),
        DEFAULT_FIXED_ANGLE,
        JSON.stringify(stateOf(calibration)),
        Date.now(),
      ],
    );
    for (const h of calibration.holds) await insertHold(db, id, h);
  });
  return getWall(db, id);
}

export async function updateWall(db: Db, wall: Wall): Promise<void> {
  await db.run("UPDATE wall SET name = ?, angle_mode = ?, angles = ?, current_angle = ? WHERE id = ?", [
    wall.name,
    wall.angleMode,
    JSON.stringify(wall.angles),
    wall.currentAngle,
    wall.id,
  ]);
}

// ---------------------------------------------------------------------- holds

interface HoldRow {
  id: number;
  x: number;
  y: number;
  led: number | null;
  source: WallHold["source"];
  created_by_led: number | null;
}

const holdOf = (r: HoldRow): WallHold => ({
  id: r.id,
  x: r.x,
  y: r.y,
  led: r.led,
  source: r.source,
  ...(r.created_by_led === null ? {} : { createdByLed: r.created_by_led }),
});

const insertHold = (db: Db, wallId: string, h: WallHold) =>
  db.run(
    `INSERT INTO hold (wall_id, id, x, y, led, source, created_by_led) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (wall_id, id) DO UPDATE SET
       x = excluded.x, y = excluded.y, led = excluded.led,
       source = excluded.source, created_by_led = excluded.created_by_led`,
    [wallId, h.id, h.x, h.y, h.led, h.source, h.createdByLed ?? null],
  );

const sameHold = (a: WallHold, b: WallHold) =>
  a.x === b.x &&
  a.y === b.y &&
  a.led === b.led &&
  a.source === b.source &&
  (a.createdByLed ?? null) === (b.createdByLed ?? null);

export async function loadCalibration(db: Db, wallId: string): Promise<Calibration> {
  const wall = await db.get<WallRow>("SELECT * FROM wall WHERE id = ?", [wallId]);
  if (!wall) throw new Error(`No wall ${wallId}`);

  const rows = await db.all<HoldRow>("SELECT * FROM hold WHERE wall_id = ? ORDER BY id", [wallId]);
  const state = JSON.parse(wall.calibration) as CalibrationState;
  const holds = rows.map(holdOf);

  return {
    ...emptyCalibration(state.chainLength),
    ...state,
    version: 2,
    photoUri: wall.photo_uri,
    photoAspect: wall.photo_aspect,
    holds,
    /* Belt and braces: an id must never be handed out twice. */
    nextHoldId: Math.max(state.nextHoldId, ...holds.map((h) => h.id + 1), 0),
  };
}

/**
 * Writes a calibration back. Only holds that actually changed are written, so
 * a sweep tap costs one row rather than the whole wall.
 *
 * Deleting a hold a problem uses fails on the foreign key and rolls back the
 * whole save. The calibration code never does that; if it ever does, the
 * error surfaces rather than a problem silently losing a hold.
 */
export async function saveCalibration(db: Db, wallId: string, c: Calibration): Promise<void> {
  await db.transaction(async () => {
    await db.run("UPDATE wall SET photo_uri = ?, photo_aspect = ?, calibration = ? WHERE id = ?", [
      c.photoUri,
      c.photoAspect,
      JSON.stringify(stateOf(c)),
      wallId,
    ]);

    const stored = new Map(
      (await db.all<HoldRow>("SELECT * FROM hold WHERE wall_id = ?", [wallId])).map((r) => [r.id, holdOf(r)]),
    );

    for (const h of c.holds) {
      const before = stored.get(h.id);
      if (!before || !sameHold(before, h)) await insertHold(db, wallId, h);
      stored.delete(h.id);
    }

    /* Whatever is left was removed from the calibration. */
    for (const id of stored.keys()) {
      await db.run("DELETE FROM hold WHERE wall_id = ? AND id = ?", [wallId, id]);
    }
  });
}

/** Holds that at least one problem uses, and so must never be deleted. */
export async function usedHoldIds(db: Db, wallId: string): Promise<Set<number>> {
  const rows = await db.all<{ hold_id: number }>(
    "SELECT DISTINCT hold_id FROM problem_hold WHERE wall_id = ?",
    [wallId],
  );
  return new Set(rows.map((r) => r.hold_id));
}

export async function problemsUsingHold(
  db: Db,
  wallId: string,
  holdId: number,
): Promise<{ id: string; name: string }[]> {
  return db.all(
    `SELECT p.id, p.name FROM problem p
     JOIN problem_hold ph ON ph.problem_id = p.id
     WHERE ph.wall_id = ? AND ph.hold_id = ?
     ORDER BY p.name`,
    [wallId, holdId],
  );
}

// ------------------------------------------------------------------- problems

/** Every problem on the wall, summarised with what its ascents say about it. */
export async function listProblems(db: Db, wallId: string): Promise<ProblemSummary[]> {
  const problems = await db.all<{ id: string; name: string; grade: number; angle: number; created_at: number }>(
    "SELECT id, name, grade, angle, created_at FROM problem WHERE wall_id = ? ORDER BY created_at DESC",
    [wallId],
  );
  const holds = await db.all<{ problem_id: string; hold_id: number }>(
    "SELECT problem_id, hold_id FROM problem_hold WHERE wall_id = ?",
    [wallId],
  );
  const ticks = await db.all<TickRow>(
    "SELECT t.* FROM tick t JOIN problem p ON p.id = t.problem_id WHERE p.wall_id = ?",
    [wallId],
  );

  return summarise(
    problems.map((p) => ({ id: p.id, name: p.name, grade: p.grade, angle: p.angle, createdAt: p.created_at })),
    holds.map((h) => ({ problemId: h.problem_id, holdId: h.hold_id })),
    ticks.map(tickOf),
  );
}

export async function getProblem(db: Db, id: string): Promise<Problem | undefined> {
  const p = await db.get<{
    id: string;
    wall_id: string;
    name: string;
    grade: number;
    angle: number;
    created_at: number;
    updated_at: number;
  }>("SELECT * FROM problem WHERE id = ?", [id]);
  if (!p) return undefined;

  const holds = await db.all<{ hold_id: number; role: Role }>(
    "SELECT hold_id, role FROM problem_hold WHERE problem_id = ?",
    [id],
  );

  return {
    id: p.id,
    wallId: p.wall_id,
    name: p.name,
    grade: p.grade,
    angle: p.angle,
    holds: holds.map((h) => ({ holdId: h.hold_id, role: h.role })),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

/** Creates or replaces a problem, and its holds, atomically. */
export async function saveProblem(db: Db, p: Problem): Promise<void> {
  await db.transaction(async () => {
    await db.run(
      `INSERT INTO problem (id, wall_id, name, grade, angle, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, grade = excluded.grade, angle = excluded.angle,
         updated_at = excluded.updated_at`,
      [p.id, p.wallId, p.name.trim(), p.grade, p.angle, p.createdAt, p.updatedAt],
    );

    await db.run("DELETE FROM problem_hold WHERE problem_id = ?", [p.id]);
    for (const h of p.holds) {
      await db.run("INSERT INTO problem_hold (problem_id, wall_id, hold_id, role) VALUES (?, ?, ?, ?)", [
        p.id,
        p.wallId,
        h.holdId,
        h.role,
      ]);
    }
  });
}

export async function deleteProblem(db: Db, id: string): Promise<void> {
  await db.run("DELETE FROM problem WHERE id = ?", [id]);
}

// ---------------------------------------------------------------------- ticks

interface TickRow {
  id: string;
  problem_id: string;
  climbed_at: number;
  angle: number;
  attempts: number;
  grade: number | null;
  stars: number | null;
  comment: string;
}

const tickOf = (r: TickRow): Tick => ({
  id: r.id,
  problemId: r.problem_id,
  climbedAt: r.climbed_at,
  angle: r.angle,
  attempts: r.attempts,
  grade: r.grade,
  stars: r.stars,
  comment: r.comment,
});

export async function saveTick(db: Db, t: Tick): Promise<void> {
  await db.run(
    `INSERT INTO tick (id, problem_id, climbed_at, angle, attempts, grade, stars, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       climbed_at = excluded.climbed_at, angle = excluded.angle, attempts = excluded.attempts,
       grade = excluded.grade, stars = excluded.stars, comment = excluded.comment`,
    [t.id, t.problemId, t.climbedAt, t.angle, t.attempts, t.grade, t.stars, t.comment.trim()],
  );
}

export async function deleteTick(db: Db, id: string): Promise<void> {
  await db.run("DELETE FROM tick WHERE id = ?", [id]);
}

/** A problem's ascents, newest first. */
export async function ticksFor(db: Db, problemId: string): Promise<Tick[]> {
  const rows = await db.all<TickRow>("SELECT * FROM tick WHERE problem_id = ? ORDER BY climbed_at DESC", [
    problemId,
  ]);
  return rows.map(tickOf);
}

export interface LogEntry extends Tick {
  problemName: string;
}

/** Every ascent on the wall, newest first. */
export async function logbook(db: Db, wallId: string): Promise<LogEntry[]> {
  const rows = await db.all<TickRow & { problem_name: string }>(
    `SELECT t.*, p.name AS problem_name FROM tick t JOIN problem p ON p.id = t.problem_id
     WHERE p.wall_id = ? ORDER BY t.climbed_at DESC`,
    [wallId],
  );
  return rows.map((r) => ({ ...tickOf(r), problemName: r.problem_name }));
}

// ---------------------------------------------------------------------- lists

export interface ListSummary {
  id: string;
  name: string;
  count: number;
}

export async function createList(db: Db, id: string, wallId: string, name: string): Promise<void> {
  await db.run("INSERT INTO list (id, wall_id, name, created_at) VALUES (?, ?, ?, ?)", [
    id,
    wallId,
    name.trim(),
    Date.now(),
  ]);
}

export async function renameList(db: Db, id: string, name: string): Promise<void> {
  await db.run("UPDATE list SET name = ? WHERE id = ?", [name.trim(), id]);
}

export async function deleteList(db: Db, id: string): Promise<void> {
  await db.run("DELETE FROM list WHERE id = ?", [id]);
}

export async function listLists(db: Db, wallId: string): Promise<ListSummary[]> {
  return db.all(
    `SELECT l.id, l.name, COUNT(i.problem_id) AS count
     FROM list l LEFT JOIN list_item i ON i.list_id = l.id
     WHERE l.wall_id = ?
     GROUP BY l.id
     ORDER BY l.created_at DESC`,
    [wallId],
  );
}

/** A list with its problems in order. */
export async function getList(db: Db, id: string): Promise<{ id: string; name: string; problemIds: string[] } | undefined> {
  const list = await db.get<{ id: string; name: string }>("SELECT id, name FROM list WHERE id = ?", [id]);
  if (!list) return undefined;
  const items = await db.all<{ problem_id: string }>(
    "SELECT problem_id FROM list_item WHERE list_id = ? ORDER BY position",
    [id],
  );
  return { ...list, problemIds: items.map((i) => i.problem_id) };
}

/**
 * Makes a list hold exactly these problems, in this order. Adding, removing
 * and reordering are all this one operation, so positions can never end up
 * with gaps or duplicates.
 */
export async function setListItems(db: Db, listId: string, problemIds: readonly string[]): Promise<void> {
  await db.transaction(async () => {
    await db.run("DELETE FROM list_item WHERE list_id = ?", [listId]);
    for (const [position, problemId] of [...new Set(problemIds)].entries()) {
      await db.run("INSERT INTO list_item (list_id, problem_id, position) VALUES (?, ?, ?)", [
        listId,
        problemId,
        position,
      ]);
    }
  });
}

/** Which lists a problem is in. */
export async function listsContaining(db: Db, problemId: string): Promise<Set<string>> {
  const rows = await db.all<{ list_id: string }>("SELECT list_id FROM list_item WHERE problem_id = ?", [problemId]);
  return new Set(rows.map((r) => r.list_id));
}

/** Adds a problem to the end of a list, or removes it, keeping the rest in order. */
export async function toggleInList(db: Db, listId: string, problemId: string): Promise<boolean> {
  const list = await getList(db, listId);
  if (!list) return false;
  const present = list.problemIds.includes(problemId);
  await setListItems(
    db,
    listId,
    present ? list.problemIds.filter((p) => p !== problemId) : [...list.problemIds, problemId],
  );
  return !present;
}

// ------------------------------------------------------------------- settings

export async function getSetting(db: Db, key: string): Promise<string | undefined> {
  return (await db.get<{ value: string }>("SELECT value FROM setting WHERE key = ?", [key]))?.value;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.run(
    "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}
