import { emptyCalibration, type Calibration, type WallHold } from "../calibration";
import { summarise, type ProblemSummary } from "../catalog";
import type { Problem, Role } from "../problem";
import type { Tick } from "../tick";
import { DEFAULT_FIXED_ANGLE, type AngleMode, type SetterPolicy, type Wall, type WallRole } from "../wall";
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
  cloud: number;
  my_role: WallRole | null;
  setter_policy: SetterPolicy;
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
  cloud: r.cloud === 1,
  role: r.my_role,
  setterPolicy: r.setter_policy,
});

export async function firstWall(db: Db): Promise<Wall | undefined> {
  const r = await db.get<WallRow>("SELECT * FROM wall ORDER BY created_at LIMIT 1");
  return r ? wallOf(r) : undefined;
}

/** Every wall on this phone: its own, and shared walls it has joined. */
export async function listWalls(db: Db): Promise<Wall[]> {
  return (await db.all<WallRow>("SELECT * FROM wall ORDER BY created_at")).map(wallOf);
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
  await db.run(
    "UPDATE wall SET name = ?, angle_mode = ?, angles = ?, current_angle = ?, setter_policy = ? WHERE id = ?",
    [wall.name, wall.angleMode, JSON.stringify(wall.angles), wall.currentAngle, wall.setterPolicy, wall.id],
  );
  /* On a shared wall only the owner's changes go up; a member's only
   * change is which angle the wall is at, and that stays on their phone. */
  const row = await db.get<{ my_role: WallRole | null }>("SELECT my_role FROM wall WHERE id = ?", [wall.id]);
  if (row?.my_role === null || row?.my_role === "owner") await enqueue(db, "wall", wall.id, wall.id, "upsert");
}

/**
 * Removes a wall and everything on it from this phone — for leaving a shared
 * wall. Problems go before holds, since holds they use cannot be deleted
 * while they exist.
 */
export async function deleteWallLocally(db: Db, id: string): Promise<void> {
  await db.transaction(async () => {
    await db.run("DELETE FROM list WHERE wall_id = ?", [id]);
    await db.run("DELETE FROM problem WHERE wall_id = ?", [id]);
    await db.run("DELETE FROM hold WHERE wall_id = ?", [id]);
    await db.run("DELETE FROM outbox WHERE wall_id = ?", [id]);
    await db.run("DELETE FROM wall WHERE id = ?", [id]);
  });
}

// --------------------------------------------------------------------- outbox

export type OutboxKind = "wall" | "holds" | "photo" | "problem" | "tick" | "list" | "comment";

export interface OutboxEntry {
  kind: OutboxKind;
  id: string;
  wallId: string;
  op: "upsert" | "delete";
  seq: number;
  error: string | null;
}

let outboxListener: ((wallId: string) => void) | null = null;

/** Hears about every change queued for the server — the app syncs soon after one. */
export function onOutbox(listener: ((wallId: string) => void) | null): void {
  outboxListener = listener;
}

/**
 * Records a change for the server — only on a shared wall; a wall that stays
 * on this phone has nothing to send. Re-enqueueing a row replaces its entry
 * with a new seq, so an upload already in flight will not clear it.
 */
export async function enqueue(
  db: Db,
  kind: OutboxKind,
  id: string,
  wallId: string,
  op: "upsert" | "delete",
): Promise<void> {
  const wall = await db.get<{ cloud: number }>("SELECT cloud FROM wall WHERE id = ?", [wallId]);
  if (!wall?.cloud) return;
  await db.run(
    `INSERT INTO outbox (kind, id, wall_id, op, seq, error)
     VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM outbox), NULL)
     ON CONFLICT (kind, id) DO UPDATE SET op = excluded.op, seq = excluded.seq, error = NULL`,
    [kind, id, wallId, op],
  );
  outboxListener?.(wallId);
}

export async function pendingChanges(db: Db, wallId: string): Promise<OutboxEntry[]> {
  const rows = await db.all<{ kind: OutboxKind; id: string; wall_id: string; op: "upsert" | "delete"; seq: number; error: string | null }>(
    "SELECT * FROM outbox WHERE wall_id = ? ORDER BY seq",
    [wallId],
  );
  return rows.map((r) => ({ kind: r.kind, id: r.id, wallId: r.wall_id, op: r.op, seq: r.seq, error: r.error }));
}

/** Clears an entry once it has reached the server — unless it was re-enqueued meanwhile. */
export async function clearChange(db: Db, e: Pick<OutboxEntry, "kind" | "id" | "seq">): Promise<void> {
  await db.run("DELETE FROM outbox WHERE kind = ? AND id = ? AND seq = ?", [e.kind, e.id, e.seq]);
}

export async function failChange(db: Db, e: Pick<OutboxEntry, "kind" | "id" | "seq">, error: string): Promise<void> {
  await db.run("UPDATE outbox SET error = ? WHERE kind = ? AND id = ? AND seq = ?", [error, e.kind, e.id, e.seq]);
}

/** Whether a row has local changes the server has not seen — a pull must not overwrite it. */
export async function isPending(db: Db, kind: OutboxKind, id: string): Promise<boolean> {
  return Boolean(await db.get("SELECT 1 AS x FROM outbox WHERE kind = ? AND id = ?", [kind, id]));
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
  let holdsChanged = false;
  let photoChanged = false;
  let chainChanged = false;

  await db.transaction(async () => {
    const before = await db.get<{ photo_uri: string | null; calibration: string }>(
      "SELECT photo_uri, calibration FROM wall WHERE id = ?",
      [wallId],
    );
    photoChanged = (before?.photo_uri ?? null) !== c.photoUri;
    chainChanged = before !== undefined && (JSON.parse(before.calibration) as CalibrationState).chainLength !== c.chainLength;

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
      const was = stored.get(h.id);
      if (!was || !sameHold(was, h)) {
        await insertHold(db, wallId, h);
        /* Sweep bookkeeping alone is private to this phone; only position,
         * LED or source changes are worth sending. */
        if (!was || was.x !== h.x || was.y !== h.y || was.led !== h.led || was.source !== h.source) {
          holdsChanged = true;
        }
      }
      stored.delete(h.id);
    }

    /* Whatever is left was removed from the calibration. */
    for (const id of stored.keys()) {
      await db.run("DELETE FROM hold WHERE wall_id = ? AND id = ?", [wallId, id]);
      holdsChanged = true;
    }
  });

  if (holdsChanged) await enqueue(db, "holds", wallId, wallId, "upsert");
  if (photoChanged) await enqueue(db, "photo", wallId, wallId, "upsert");
  /* The chain length is the wall's, shared with its members. */
  if (chainChanged) await enqueue(db, "wall", wallId, wallId, "upsert");
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

/**
 * Every problem on the wall, summarised with what its ascents say about it.
 * "Ticked" means ticked by `me` — or on this phone before anyone signed in.
 */
export async function listProblems(db: Db, wallId: string, me: string | null = null): Promise<ProblemSummary[]> {
  const problems = await db.all<{
    id: string;
    name: string;
    grade: number;
    angle: number;
    created_at: number;
    setter_id: string | null;
  }>(
    "SELECT id, name, grade, angle, created_at, setter_id FROM problem WHERE wall_id = ? ORDER BY created_at DESC",
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
    problems.map((p) => ({
      id: p.id,
      name: p.name,
      grade: p.grade,
      angle: p.angle,
      createdAt: p.created_at,
      setterId: p.setter_id,
    })),
    holds.map((h) => ({ problemId: h.problem_id, holdId: h.hold_id })),
    ticks.map(tickOf),
    me,
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
    setter_id: string | null;
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
    setterId: p.setter_id,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

/** Whether a save came from this phone (and should go to the server) or from the server. */
export interface SaveOptions {
  fromServer?: boolean;
}

/** Creates or replaces a problem, and its holds, atomically. */
export async function saveProblem(db: Db, p: Problem, opts: SaveOptions = {}): Promise<void> {
  await db.transaction(async () => {
    await db.run(
      `INSERT INTO problem (id, wall_id, name, grade, angle, created_at, updated_at, setter_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, grade = excluded.grade, angle = excluded.angle,
         updated_at = excluded.updated_at, setter_id = excluded.setter_id`,
      [p.id, p.wallId, p.name.trim(), p.grade, p.angle, p.createdAt, p.updatedAt, p.setterId],
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
  if (!opts.fromServer) await enqueue(db, "problem", p.id, p.wallId, "upsert");
}

export async function deleteProblem(db: Db, id: string, opts: SaveOptions = {}): Promise<void> {
  const p = await db.get<{ wall_id: string }>("SELECT wall_id FROM problem WHERE id = ?", [id]);
  await db.run("DELETE FROM problem WHERE id = ?", [id]);
  if (p && !opts.fromServer) await enqueue(db, "problem", id, p.wall_id, "delete");
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
  user_id: string | null;
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
  userId: r.user_id,
});

const wallOfProblem = async (db: Db, problemId: string) =>
  (await db.get<{ wall_id: string }>("SELECT wall_id FROM problem WHERE id = ?", [problemId]))?.wall_id;

export async function saveTick(db: Db, t: Tick, opts: SaveOptions = {}): Promise<void> {
  await db.run(
    `INSERT INTO tick (id, problem_id, climbed_at, angle, attempts, grade, stars, comment, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       climbed_at = excluded.climbed_at, angle = excluded.angle, attempts = excluded.attempts,
       grade = excluded.grade, stars = excluded.stars, comment = excluded.comment, user_id = excluded.user_id`,
    [t.id, t.problemId, t.climbedAt, t.angle, t.attempts, t.grade, t.stars, t.comment.trim(), t.userId],
  );
  const wallId = await wallOfProblem(db, t.problemId);
  if (wallId && !opts.fromServer) await enqueue(db, "tick", t.id, wallId, "upsert");
}

export async function deleteTick(db: Db, id: string, opts: SaveOptions = {}): Promise<void> {
  const t = await db.get<{ problem_id: string }>("SELECT problem_id FROM tick WHERE id = ?", [id]);
  const wallId = t ? await wallOfProblem(db, t.problem_id) : undefined;
  await db.run("DELETE FROM tick WHERE id = ?", [id]);
  if (wallId && !opts.fromServer) await enqueue(db, "tick", id, wallId, "delete");
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

/** My ascents on the wall, newest first — including any logged here before signing in. */
export async function logbook(db: Db, wallId: string, me: string | null = null): Promise<LogEntry[]> {
  const rows = await db.all<TickRow & { problem_name: string }>(
    `SELECT t.*, p.name AS problem_name FROM tick t JOIN problem p ON p.id = t.problem_id
     WHERE p.wall_id = ? AND (t.user_id IS NULL OR t.user_id = ?) ORDER BY t.climbed_at DESC`,
    [wallId, me],
  );
  return rows.map((r) => ({ ...tickOf(r), problemName: r.problem_name }));
}

// ---------------------------------------------------------------------- lists

export interface ListSummary {
  id: string;
  name: string;
  count: number;
  ownerId: string | null;
  shared: boolean;
}

const listWallOf = async (db: Db, id: string) =>
  (await db.get<{ wall_id: string }>("SELECT wall_id FROM list WHERE id = ?", [id]))?.wall_id;

const touchList = async (db: Db, id: string) => {
  const wallId = await listWallOf(db, id);
  if (wallId) await enqueue(db, "list", id, wallId, "upsert");
};

export async function createList(
  db: Db,
  id: string,
  wallId: string,
  name: string,
  ownerId: string | null = null,
  opts: SaveOptions & { shared?: boolean; createdAt?: number } = {},
): Promise<void> {
  await db.run(
    `INSERT INTO list (id, wall_id, name, created_at, owner_id, shared) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, shared = excluded.shared, owner_id = excluded.owner_id`,
    [id, wallId, name.trim(), opts.createdAt ?? Date.now(), ownerId, opts.shared ? 1 : 0],
  );
  if (!opts.fromServer) await enqueue(db, "list", id, wallId, "upsert");
}

export async function renameList(db: Db, id: string, name: string): Promise<void> {
  await db.run("UPDATE list SET name = ? WHERE id = ?", [name.trim(), id]);
  await touchList(db, id);
}

export async function setListShared(db: Db, id: string, shared: boolean): Promise<void> {
  await db.run("UPDATE list SET shared = ? WHERE id = ?", [shared ? 1 : 0, id]);
  await touchList(db, id);
}

export async function deleteList(db: Db, id: string, opts: SaveOptions = {}): Promise<void> {
  const wallId = await listWallOf(db, id);
  await db.run("DELETE FROM list WHERE id = ?", [id]);
  if (wallId && !opts.fromServer) await enqueue(db, "list", id, wallId, "delete");
}

/** My lists on the wall, and lists others have shared with it. */
export async function listLists(db: Db, wallId: string, me: string | null = null): Promise<ListSummary[]> {
  const rows = await db.all<{ id: string; name: string; count: number; owner_id: string | null; shared: number }>(
    `SELECT l.id, l.name, COUNT(i.problem_id) AS count, l.owner_id, l.shared
     FROM list l LEFT JOIN list_item i ON i.list_id = l.id
     WHERE l.wall_id = ? AND (l.owner_id IS NULL OR l.owner_id = ? OR l.shared = 1)
     GROUP BY l.id
     ORDER BY l.created_at DESC`,
    [wallId, me],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, count: r.count, ownerId: r.owner_id, shared: r.shared === 1 }));
}

/** A list with its problems in order. */
export async function getList(
  db: Db,
  id: string,
): Promise<{ id: string; name: string; problemIds: string[]; ownerId: string | null; shared: boolean } | undefined> {
  const row = await db.get<{ id: string; name: string; owner_id: string | null; shared: number }>(
    "SELECT id, name, owner_id, shared FROM list WHERE id = ?",
    [id],
  );
  if (!row) return undefined;
  const list = { id: row.id, name: row.name, ownerId: row.owner_id, shared: row.shared === 1 };
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
export async function setListItems(
  db: Db,
  listId: string,
  problemIds: readonly string[],
  opts: SaveOptions = {},
): Promise<void> {
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
  if (!opts.fromServer) await touchList(db, listId);
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

// ------------------------------------------------------------------- comments

export interface Comment {
  id: string;
  problemId: string;
  userId: string | null;
  body: string;
  createdAt: number;
}

export interface CommentView extends Comment {
  /** The author's name as members see it, or "" if unknown on this phone. */
  author: string;
}

/** A problem's comments, oldest first, like a conversation. */
export async function listComments(db: Db, problemId: string): Promise<CommentView[]> {
  const rows = await db.all<{ id: string; problem_id: string; user_id: string | null; body: string; created_at: number; author: string | null }>(
    `SELECT c.*, m.name AS author FROM comment c
     JOIN problem p ON p.id = c.problem_id
     LEFT JOIN member m ON m.wall_id = p.wall_id AND m.user_id = c.user_id
     WHERE c.problem_id = ? ORDER BY c.created_at`,
    [problemId],
  );
  return rows.map((r) => ({
    id: r.id,
    problemId: r.problem_id,
    userId: r.user_id,
    body: r.body,
    createdAt: r.created_at,
    author: r.author ?? "",
  }));
}

export async function saveComment(db: Db, c: Comment, opts: SaveOptions = {}): Promise<void> {
  await db.run(
    `INSERT INTO comment (id, problem_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET body = excluded.body`,
    [c.id, c.problemId, c.userId, c.body.trim(), c.createdAt],
  );
  const wallId = await wallOfProblem(db, c.problemId);
  if (wallId && !opts.fromServer) await enqueue(db, "comment", c.id, wallId, "upsert");
}

export async function deleteComment(db: Db, id: string, opts: SaveOptions = {}): Promise<void> {
  const c = await db.get<{ problem_id: string }>("SELECT problem_id FROM comment WHERE id = ?", [id]);
  const wallId = c ? await wallOfProblem(db, c.problem_id) : undefined;
  await db.run("DELETE FROM comment WHERE id = ?", [id]);
  if (wallId && !opts.fromServer) await enqueue(db, "comment", id, wallId, "delete");
}

// -------------------------------------------------------------------- members

export interface Member {
  userId: string;
  role: WallRole;
  name: string;
}

/** A shared wall's members as last synced: owner first, then by name. */
export async function listMembers(db: Db, wallId: string): Promise<Member[]> {
  const rows = await db.all<{ user_id: string; role: WallRole; name: string }>(
    `SELECT user_id, role, name FROM member WHERE wall_id = ?
     ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'setter' THEN 1 ELSE 2 END, name`,
    [wallId],
  );
  return rows.map((r) => ({ userId: r.user_id, role: r.role, name: r.name }));
}

/** Names by user id, for showing who set, climbed or said something. */
export async function memberNames(db: Db, wallId: string): Promise<Map<string, string>> {
  return new Map((await listMembers(db, wallId)).map((m) => [m.userId, m.name]));
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
