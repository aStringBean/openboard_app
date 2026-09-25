/**
 * Keeps a shared wall on this phone in step with the server.
 *
 * The phone's database stays the only thing screens read. A sync pushes this
 * phone's changes first (from the outbox, oldest first), then pulls everyone
 * else's since the last cursor — pushing first means a pull never lands on
 * top of an edit that has not yet gone up. A row with changes still waiting
 * in the outbox is never overwritten by a pull.
 *
 * The photo and the hold set are versioned per wall and fetched whole when
 * their version moves; everything else is pulled row by row, deletions
 * arriving as tombstones.
 *
 * No React Native here, so the whole thing runs in Node against a local
 * Supabase in the integration tests.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { WallHold } from "./calibration";
import {
  clearChange,
  createList,
  createWall,
  deleteComment,
  deleteList,
  deleteProblem,
  deleteTick,
  enqueue,
  failChange,
  getProblem,
  isPending,
  pendingChanges,
  saveComment,
  saveProblem,
  saveTick,
  setListItems,
  type OutboxEntry,
} from "./db/repo";
import type { Db } from "./db/types";
import type { Role } from "./problem";
import type { AngleMode, SetterPolicy, WallRole } from "./wall";

/** Where photos live on this phone. Expo's file system on a phone, the disk in tests. */
export interface PhotoStore {
  read(uri: string): Promise<Uint8Array>;
  /** Keeps a downloaded photo and says where it is. */
  save(wallId: string, name: string, bytes: Uint8Array): Promise<string>;
}

export interface SyncResult {
  pushed: number;
  /** Changes the server refused; they stay queued, with the reason. */
  failed: number;
  pulled: number;
  /** This user is no longer a member (removed, or the wall was deleted). */
  removed: boolean;
}

/** The server could not be reached, or the session needs renewing: try again later. */
export class Offline extends Error {}

/** Pulls reach back this far behind the cursor, for rows that committed late. */
const OVERLAP_MS = 2 * 60_000;
const PAGE = 500;

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (t: string) => Date.parse(t);

interface Res<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
  status: number;
}

/**
 * The data of a response, or a throw: `Offline` when nothing reached the
 * server or it could not answer, a plain Error when it refused.
 */
function ok<T>(r: Res<T>): T {
  if (!r.error) return r.data as T;
  if (r.status === 0 || r.status === 401 || r.status >= 500) throw new Offline(r.error.message);
  throw new Error(r.error.message);
}

// ----------------------------------------------------------------- publish/join

/**
 * Shares a wall that so far lived only on this phone. Everything on it
 * becomes the signed-in user's — it was theirs all along, set before they
 * signed in — and is queued to go up. Run `syncWall` after.
 */
export async function publishWall(db: Db, wallId: string, me: string, myName: string): Promise<void> {
  await db.transaction(async () => {
    await db.run("UPDATE wall SET cloud = 1, my_role = 'owner' WHERE id = ?", [wallId]);
    await db.run("UPDATE problem SET setter_id = ? WHERE wall_id = ? AND setter_id IS NULL", [me, wallId]);
    await db.run(
      "UPDATE tick SET user_id = ? WHERE user_id IS NULL AND problem_id IN (SELECT id FROM problem WHERE wall_id = ?)",
      [me, wallId],
    );
    await db.run(
      "UPDATE comment SET user_id = ? WHERE user_id IS NULL AND problem_id IN (SELECT id FROM problem WHERE wall_id = ?)",
      [me, wallId],
    );
    await db.run("UPDATE list SET owner_id = ? WHERE wall_id = ? AND owner_id IS NULL", [me, wallId]);
    await db.run(
      `INSERT INTO member (wall_id, user_id, role, name) VALUES (?, ?, 'owner', ?)
       ON CONFLICT (wall_id, user_id) DO UPDATE SET role = 'owner', name = excluded.name`,
      [wallId, me, myName],
    );

    /* In the order the server needs them: the wall, then what hangs off it. */
    await enqueue(db, "wall", wallId, wallId, "upsert");
    const wall = await db.get<{ photo_uri: string | null }>("SELECT photo_uri FROM wall WHERE id = ?", [wallId]);
    if (wall?.photo_uri) await enqueue(db, "photo", wallId, wallId, "upsert");
    await enqueue(db, "holds", wallId, wallId, "upsert");
    const ids = async (sql: string) => (await db.all<{ id: string }>(sql, [wallId])).map((r) => r.id);
    for (const id of await ids("SELECT id FROM problem WHERE wall_id = ? ORDER BY created_at")) {
      await enqueue(db, "problem", id, wallId, "upsert");
    }
    for (const id of await ids("SELECT id FROM list WHERE wall_id = ? ORDER BY created_at")) {
      await enqueue(db, "list", id, wallId, "upsert");
    }
    for (const id of await ids(
      "SELECT t.id FROM tick t JOIN problem p ON p.id = t.problem_id WHERE p.wall_id = ? ORDER BY t.climbed_at",
    )) {
      await enqueue(db, "tick", id, wallId, "upsert");
    }
    for (const id of await ids(
      "SELECT c.id FROM comment c JOIN problem p ON p.id = c.problem_id WHERE p.wall_id = ? ORDER BY c.created_at",
    )) {
      await enqueue(db, "comment", id, wallId, "upsert");
    }
  });
}

/**
 * Joins a wall with an invite code and makes an empty local copy of it for
 * `syncWall` to fill. Returns the wall's id.
 */
export async function joinWall(db: Db, sb: SupabaseClient, code: string): Promise<string> {
  const wallId = ok(await sb.rpc("join_wall", { p_code: code })) as string;
  /* Joining again, with the wall already here, just syncs it. */
  if (!(await db.get("SELECT 1 AS x FROM wall WHERE id = ?", [wallId]))) {
    await createWall(db, wallId, "Shared wall");
    await db.run("UPDATE wall SET cloud = 1, my_role = 'climber' WHERE id = ?", [wallId]);
  }
  return wallId;
}

// ------------------------------------------------------------------------- sync

/** Pushes this phone's changes to one shared wall, then pulls everyone else's. */
export async function syncWall(
  db: Db,
  sb: SupabaseClient,
  photos: PhotoStore,
  wallId: string,
  me: string,
): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, failed: 0, pulled: 0, removed: false };
  await push(db, sb, photos, wallId, me, result);
  await pull(db, sb, photos, wallId, me, result);
  return result;
}

// ------------------------------------------------------------------------- push

async function push(db: Db, sb: SupabaseClient, photos: PhotoStore, wallId: string, me: string, result: SyncResult) {
  /*
   * Oldest first, as they happened — but order can still be wrong, say a
   * tick queued before an edit re-queued its (never yet sent) problem. So
   * whatever fails gets a second go once everything else is up.
   */
  let failed: { e: OutboxEntry; message: string }[] = [];
  for (const pass of [1, 2]) {
    const entries = pass === 1 ? await pendingChanges(db, wallId) : failed.map((f) => f.e);
    failed = [];
    for (const e of entries) {
      try {
        await send(db, sb, photos, e, me);
        await clearChange(db, e);
        result.pushed++;
      } catch (err) {
        if (err instanceof Offline) throw err;
        failed.push({ e, message: err instanceof Error ? err.message : String(err) });
      }
    }
    if (!failed.length) break;
  }

  for (const f of failed) await failChange(db, f.e, f.message);
  result.failed = failed.length;
}

async function send(db: Db, sb: SupabaseClient, photos: PhotoStore, e: OutboxEntry, me: string): Promise<void> {
  switch (e.kind) {
    case "wall":
      return sendWall(db, sb, e.wallId);
    case "photo":
      return sendPhoto(db, sb, photos, e.wallId);
    case "holds":
      return sendHolds(db, sb, e.wallId);
    case "problem":
      return e.op === "delete" ? void ok(await sb.rpc("delete_problem", { p_id: e.id })) : sendProblem(db, sb, e.id);
    case "list":
      if (e.op === "delete") return void ok(await sb.from("lists").update({ deleted_at: iso(Date.now()) }).eq("id", e.id));
      return sendList(db, sb, e.id, me);
    case "tick":
      if (e.op === "delete") return void ok(await sb.from("ticks").update({ deleted_at: iso(Date.now()) }).eq("id", e.id));
      return sendTick(db, sb, e.id, e.wallId);
    case "comment":
      if (e.op === "delete") {
        return void ok(await sb.from("comments").update({ deleted_at: iso(Date.now()) }).eq("id", e.id));
      }
      return sendComment(db, sb, e.id, e.wallId);
  }
}

async function sendWall(db: Db, sb: SupabaseClient, wallId: string) {
  const w = await db.get<{
    name: string;
    angle_mode: AngleMode;
    angles: string;
    current_angle: number;
    setter_policy: SetterPolicy;
    calibration: string;
  }>("SELECT * FROM wall WHERE id = ?", [wallId]);
  if (!w) return;
  const fields = {
    name: w.name,
    angle_mode: w.angle_mode,
    angles: JSON.parse(w.angles),
    current_angle: w.current_angle,
    setter_policy: w.setter_policy,
    chain_length: (JSON.parse(w.calibration) as { chainLength: number }).chainLength,
  };

  /*
   * Update, else insert — not an upsert. An upsert also checks the new row
   * against the read policy, which only members pass, and the owner becomes
   * a member only once the insert has happened.
   */
  const updated = ok(await sb.from("walls").update(fields).eq("id", wallId).select("id")) as unknown[];
  if (!updated.length) ok(await sb.from("walls").insert({ id: wallId, ...fields }));
}

const extOf = (uri: string) => /\.(jpe?g|png|webp|heic)$/i.exec(uri)?.[1]?.toLowerCase() ?? "jpg";
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

async function sendPhoto(db: Db, sb: SupabaseClient, photos: PhotoStore, wallId: string) {
  const w = await db.get<{ photo_uri: string | null; photo_aspect: number | null }>(
    "SELECT photo_uri, photo_aspect FROM wall WHERE id = ?",
    [wallId],
  );
  if (!w?.photo_uri) return;

  const server = ok(
    await sb.from("walls").select("photo_path, photo_version").eq("id", wallId).single(),
  ) as { photo_path: string | null; photo_version: number };

  /* A new name for every version, so no member ever reads half of one. */
  const ext = extOf(w.photo_uri);
  const path = `${wallId}/${Date.now()}.${ext}`;
  const bytes = await photos.read(w.photo_uri);
  const up = await sb.storage.from("wall-photos").upload(path, bytes, { contentType: MIME[ext], upsert: false });
  if (up.error) storageFailed(up.error);

  const version = server.photo_version + 1;
  ok(
    await sb
      .from("walls")
      .update({ photo_path: path, photo_aspect: w.photo_aspect, photo_version: version })
      .eq("id", wallId),
  );
  await db.run("UPDATE wall SET photo_version = ? WHERE id = ?", [version, wallId]);

  /* Best effort: an orphaned old photo costs storage, nothing more. */
  if (server.photo_path) await sb.storage.from("wall-photos").remove([server.photo_path]);
}

/** Storage errors carry an HTTP status only when the server answered. */
function storageFailed(error: Error & { status?: number }): never {
  const status = Number(error.status ?? 0);
  if (!status || status === 401 || status >= 500) throw new Offline(error.message);
  throw new Error(error.message);
}

async function sendHolds(db: Db, sb: SupabaseClient, wallId: string) {
  const holds = await db.all<{ id: number; x: number; y: number; led: number | null; source: string }>(
    "SELECT id, x, y, led, source FROM hold WHERE wall_id = ? ORDER BY id",
    [wallId],
  );
  const version = ok(await sb.rpc("replace_holds", { p_wall: wallId, p_holds: holds })) as number;
  await db.run("UPDATE wall SET holds_version = ? WHERE id = ?", [version, wallId]);
}

async function sendProblem(db: Db, sb: SupabaseClient, id: string) {
  const p = await getProblem(db, id);
  if (!p) return;
  ok(
    await sb.rpc("save_problem", {
      p: {
        id: p.id,
        wall_id: p.wallId,
        name: p.name,
        grade: p.grade,
        angle: p.angle,
        created_at: iso(p.createdAt),
        holds: p.holds.map((h) => ({ hold_id: h.holdId, role: h.role })),
      },
    }),
  );
}

async function sendList(db: Db, sb: SupabaseClient, id: string, me: string) {
  const l = await db.get<{ wall_id: string; name: string; shared: number; created_at: number; owner_id: string | null }>(
    "SELECT * FROM list WHERE id = ?",
    [id],
  );
  /* Only the owner sends a list; a shared list someone else made is read-only here. */
  if (!l || (l.owner_id !== null && l.owner_id !== me)) return;
  const items = await db.all<{ problem_id: string }>("SELECT problem_id FROM list_item WHERE list_id = ? ORDER BY position", [id]);
  ok(
    await sb.rpc("save_list", {
      l: {
        id,
        wall_id: l.wall_id,
        name: l.name,
        shared: l.shared === 1,
        created_at: iso(l.created_at),
        problem_ids: items.map((i) => i.problem_id),
      },
    }),
  );
}

async function sendTick(db: Db, sb: SupabaseClient, id: string, wallId: string) {
  const t = await db.get<{
    problem_id: string;
    climbed_at: number;
    angle: number;
    attempts: number;
    grade: number | null;
    stars: number | null;
    comment: string;
    user_id: string | null;
  }>("SELECT * FROM tick WHERE id = ?", [id]);
  if (!t) return;
  ok(
    await sb.from("ticks").upsert({
      id,
      problem_id: t.problem_id,
      wall_id: wallId,
      ...(t.user_id ? { user_id: t.user_id } : {}),
      climbed_at: iso(t.climbed_at),
      angle: t.angle,
      attempts: t.attempts,
      grade: t.grade,
      stars: t.stars,
      comment: t.comment,
      deleted_at: null,
    }),
  );
}

async function sendComment(db: Db, sb: SupabaseClient, id: string, wallId: string) {
  const c = await db.get<{ problem_id: string; body: string; created_at: number; user_id: string | null }>(
    "SELECT * FROM comment WHERE id = ?",
    [id],
  );
  if (!c) return;
  ok(
    await sb.from("comments").upsert({
      id,
      problem_id: c.problem_id,
      wall_id: wallId,
      ...(c.user_id ? { user_id: c.user_id } : {}),
      body: c.body,
      created_at: iso(c.created_at),
      deleted_at: null,
    }),
  );
}

// ------------------------------------------------------------------------- pull

type Cursors = Partial<Record<"problems" | "ticks" | "comments" | "lists", string>>;

async function pull(db: Db, sb: SupabaseClient, photos: PhotoStore, wallId: string, me: string, result: SyncResult) {
  const walls = ok(await sb.from("walls").select("*").eq("id", wallId)) as ServerWall[];
  const server = walls[0];
  if (!server) {
    result.removed = true;
    return;
  }

  const local = await db.get<{ sync_cursor: string | null; photo_version: number; holds_version: number }>(
    "SELECT sync_cursor, photo_version, holds_version FROM wall WHERE id = ?",
    [wallId],
  );
  if (!local) return;
  const cursors: Cursors = local.sync_cursor ? JSON.parse(local.sync_cursor) : {};

  await pullMembers(db, sb, wallId, me);
  if (!(await isPending(db, "wall", wallId))) await applyWall(db, wallId, server);

  if (server.photo_version > local.photo_version && server.photo_path && !(await isPending(db, "photo", wallId))) {
    await pullPhoto(db, sb, photos, wallId, server);
  }
  if (server.holds_version > local.holds_version && !(await isPending(db, "holds", wallId))) {
    await pullHolds(db, sb, wallId, server.holds_version);
  }

  /* Problems before what refers to them. */
  result.pulled += await pullTable(db, sb, wallId, "problems", "*, problem_holds(hold_id, role)", cursors, applyProblem);
  result.pulled += await pullTable(db, sb, wallId, "lists", "*, list_items(problem_id, position)", cursors, applyList);
  result.pulled += await pullTable(db, sb, wallId, "ticks", "*", cursors, applyTick);
  result.pulled += await pullTable(db, sb, wallId, "comments", "*", cursors, applyComment);
  await dropUnsharedLists(db, sb, wallId, me);

  await db.run("UPDATE wall SET sync_cursor = ?, synced_at = ? WHERE id = ?", [JSON.stringify(cursors), Date.now(), wallId]);
}

interface ServerWall {
  id: string;
  owner_id: string;
  name: string;
  angle_mode: AngleMode;
  angles: number[];
  current_angle: number;
  setter_policy: SetterPolicy;
  chain_length: number;
  photo_path: string | null;
  photo_aspect: number | null;
  photo_version: number;
  holds_version: number;
}

async function applyWall(db: Db, wallId: string, w: ServerWall) {
  const row = await db.get<{ calibration: string }>("SELECT calibration FROM wall WHERE id = ?", [wallId]);
  const state = { ...(row ? JSON.parse(row.calibration) : {}), chainLength: w.chain_length };
  await db.run(
    `UPDATE wall SET name = ?, angle_mode = ?, angles = ?, current_angle = ?, setter_policy = ?, calibration = ?
     WHERE id = ?`,
    [w.name, w.angle_mode, JSON.stringify(w.angles), w.current_angle, w.setter_policy, JSON.stringify(state), wallId],
  );
}

async function pullMembers(db: Db, sb: SupabaseClient, wallId: string, me: string) {
  const members = ok(await sb.from("wall_members").select("user_id, role").eq("wall_id", wallId)) as {
    user_id: string;
    role: WallRole;
  }[];
  const profiles = ok(
    await sb
      .from("profiles")
      .select("id, display_name")
      .in(
        "id",
        members.map((m) => m.user_id),
      ),
  ) as { id: string; display_name: string }[];
  const names = new Map(profiles.map((p) => [p.id, p.display_name]));

  await db.transaction(async () => {
    await db.run("DELETE FROM member WHERE wall_id = ?", [wallId]);
    for (const m of members) {
      await db.run("INSERT INTO member (wall_id, user_id, role, name) VALUES (?, ?, ?, ?)", [
        wallId,
        m.user_id,
        m.role,
        names.get(m.user_id) ?? "",
      ]);
    }
    const mine = members.find((m) => m.user_id === me);
    if (mine) await db.run("UPDATE wall SET my_role = ? WHERE id = ?", [mine.role, wallId]);
  });
}

async function pullPhoto(db: Db, sb: SupabaseClient, photos: PhotoStore, wallId: string, w: ServerWall) {
  const res = await sb.storage.from("wall-photos").download(w.photo_path!);
  if (res.error) {
    /* Refused or gone: keep the photo we have and try again next time. */
    try {
      storageFailed(res.error);
    } catch (err) {
      if (err instanceof Offline) throw err;
      return;
    }
  }
  const bytes = new Uint8Array(await res.data.arrayBuffer());
  const uri = await photos.save(wallId, `${w.photo_version}.${extOf(w.photo_path!)}`, bytes);
  await db.run("UPDATE wall SET photo_uri = ?, photo_aspect = ?, photo_version = ? WHERE id = ?", [
    uri,
    w.photo_aspect,
    w.photo_version,
    wallId,
  ]);
}

async function pullHolds(db: Db, sb: SupabaseClient, wallId: string, version: number) {
  const holds = ok(
    await sb.from("holds").select("id, x, y, led, source").eq("wall_id", wallId).order("id").limit(10_000),
  ) as Pick<WallHold, "id" | "x" | "y" | "led" | "source">[];

  await db.transaction(async () => {
    const keep = new Set(holds.map((h) => h.id));
    /* A hold this phone's unsent problem still uses stays until that problem
     * is sorted out; the server will refuse the problem and say why. */
    const inUse = new Set(
      (await db.all<{ hold_id: number }>("SELECT DISTINCT hold_id FROM problem_hold WHERE wall_id = ?", [wallId])).map(
        (r) => r.hold_id,
      ),
    );
    for (const h of await db.all<{ id: number }>("SELECT id FROM hold WHERE wall_id = ?", [wallId])) {
      if (!keep.has(h.id) && !inUse.has(h.id)) await db.run("DELETE FROM hold WHERE wall_id = ? AND id = ?", [wallId, h.id]);
    }
    for (const h of holds) {
      await db.run(
        `INSERT INTO hold (wall_id, id, x, y, led, source) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (wall_id, id) DO UPDATE SET x = excluded.x, y = excluded.y, led = excluded.led, source = excluded.source`,
        [wallId, h.id, h.x, h.y, h.led, h.source],
      );
    }
    await db.run("UPDATE wall SET holds_version = ? WHERE id = ?", [version, wallId]);
  });
}

/**
 * Pulls one table's rows changed since its cursor, a page at a time, and
 * applies each. Returns how many rows were applied.
 */
async function pullTable<R extends { id: string; updated_at: string }>(
  db: Db,
  sb: SupabaseClient,
  wallId: string,
  table: keyof Cursors,
  columns: string,
  cursors: Cursors,
  apply: (db: Db, row: R) => Promise<boolean>,
): Promise<number> {
  let since = cursors[table] ? iso(ms(cursors[table]!) - OVERLAP_MS) : "1970-01-01T00:00:00Z";
  let applied = 0;

  for (;;) {
    const rows = ok(
      await sb
        .from(table)
        .select(columns)
        .eq("wall_id", wallId)
        .gte("updated_at", since)
        .order("updated_at")
        .limit(PAGE),
    ) as unknown as R[];

    for (const r of rows) {
      if (await apply(db, r)) applied++;
      if (!cursors[table] || ms(r.updated_at) > ms(cursors[table]!)) cursors[table] = r.updated_at;
    }
    if (rows.length < PAGE) return applied;
    since = rows[rows.length - 1]!.updated_at;
  }
}

const problemExists = async (db: Db, id: string) => Boolean(await db.get("SELECT 1 AS x FROM problem WHERE id = ?", [id]));

async function applyProblem(
  db: Db,
  r: {
    id: string;
    wall_id: string;
    setter_id: string;
    name: string;
    grade: number;
    angle: number;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    problem_holds: { hold_id: number; role: Role }[];
  },
): Promise<boolean> {
  if (await isPending(db, "problem", r.id)) return false;
  if (r.deleted_at) {
    await deleteProblem(db, r.id, { fromServer: true });
    return true;
  }

  /* A hold missing here means the hold set is behind; the next sync catches up. */
  const known = new Set(
    (await db.all<{ id: number }>("SELECT id FROM hold WHERE wall_id = ?", [r.wall_id])).map((h) => h.id),
  );
  if (r.problem_holds.some((h) => !known.has(h.hold_id))) return false;

  await saveProblem(
    db,
    {
      id: r.id,
      wallId: r.wall_id,
      name: r.name,
      grade: r.grade,
      angle: r.angle,
      holds: r.problem_holds.map((h) => ({ holdId: h.hold_id, role: h.role })),
      setterId: r.setter_id,
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
    },
    { fromServer: true },
  );
  return true;
}

async function applyList(
  db: Db,
  r: {
    id: string;
    wall_id: string;
    owner_id: string;
    name: string;
    shared: boolean;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    list_items: { problem_id: string; position: number }[];
  },
): Promise<boolean> {
  if (await isPending(db, "list", r.id)) return false;
  if (r.deleted_at) {
    await deleteList(db, r.id, { fromServer: true });
    return true;
  }
  await createList(db, r.id, r.wall_id, r.name, r.owner_id, {
    fromServer: true,
    shared: r.shared,
    createdAt: ms(r.created_at),
  });
  const items = [...r.list_items].sort((a, b) => a.position - b.position).map((i) => i.problem_id);
  const present: string[] = [];
  for (const id of items) if (await problemExists(db, id)) present.push(id);
  await setListItems(db, r.id, present, { fromServer: true });
  return true;
}

/** A list someone stopped sharing no longer comes back from the server at all. */
async function dropUnsharedLists(db: Db, sb: SupabaseClient, wallId: string, me: string) {
  const visible = new Set(
    (ok(await sb.from("lists").select("id").eq("wall_id", wallId).is("deleted_at", null)) as { id: string }[]).map(
      (l) => l.id,
    ),
  );
  const theirs = await db.all<{ id: string }>(
    "SELECT id FROM list WHERE wall_id = ? AND owner_id IS NOT NULL AND owner_id <> ?",
    [wallId, me],
  );
  for (const l of theirs) if (!visible.has(l.id)) await deleteList(db, l.id, { fromServer: true });
}

async function applyTick(
  db: Db,
  r: {
    id: string;
    problem_id: string;
    user_id: string;
    climbed_at: string;
    angle: number;
    attempts: number;
    grade: number | null;
    stars: number | null;
    comment: string;
    updated_at: string;
    deleted_at: string | null;
  },
): Promise<boolean> {
  if (await isPending(db, "tick", r.id)) return false;
  if (r.deleted_at) {
    await deleteTick(db, r.id, { fromServer: true });
    return true;
  }
  /* Its problem has been taken down, or not come through yet. */
  if (!(await problemExists(db, r.problem_id))) return false;
  await saveTick(
    db,
    {
      id: r.id,
      problemId: r.problem_id,
      userId: r.user_id,
      climbedAt: ms(r.climbed_at),
      angle: r.angle,
      attempts: r.attempts,
      grade: r.grade,
      stars: r.stars,
      comment: r.comment,
    },
    { fromServer: true },
  );
  return true;
}

async function applyComment(
  db: Db,
  r: { id: string; problem_id: string; user_id: string; body: string; created_at: string; updated_at: string; deleted_at: string | null },
): Promise<boolean> {
  if (await isPending(db, "comment", r.id)) return false;
  if (r.deleted_at) {
    await deleteComment(db, r.id, { fromServer: true });
    return true;
  }
  if (!(await problemExists(db, r.problem_id))) return false;
  await saveComment(
    db,
    { id: r.id, problemId: r.problem_id, userId: r.user_id, body: r.body, createdAt: ms(r.created_at) },
    { fromServer: true },
  );
  return true;
}

// ---------------------------------------------------------------- online-only

/** Makes a new invite code for a wall. Owner only; needs the network. */
export async function createInvite(sb: SupabaseClient, wallId: string, days = 30): Promise<string> {
  return ok(await sb.rpc("create_invite", { p_wall: wallId, p_days: days })) as string;
}

/** The link an invite code travels as; opening it on a phone with the app joins the wall. */
export const inviteLink = (code: string) => `openboard://join/${code}`;

/** Makes a member a setter or a climber. Owner only; needs the network. */
export async function setMemberRole(
  db: Db,
  sb: SupabaseClient,
  wallId: string,
  userId: string,
  role: "setter" | "climber",
): Promise<void> {
  ok(await sb.from("wall_members").update({ role }).eq("wall_id", wallId).eq("user_id", userId));
  await db.run("UPDATE member SET role = ? WHERE wall_id = ? AND user_id = ?", [role, wallId, userId]);
}

/** Removes someone from a wall — or, with your own id, leaves it. Needs the network. */
export async function removeMember(db: Db, sb: SupabaseClient, wallId: string, userId: string): Promise<void> {
  ok(await sb.from("wall_members").delete().eq("wall_id", wallId).eq("user_id", userId));
  await db.run("DELETE FROM member WHERE wall_id = ? AND user_id = ?", [wallId, userId]);
}

/** Whether a wall has changes waiting to go up, and whether any were refused. */
export async function outboxState(db: Db, wallId: string): Promise<{ waiting: number; refused: OutboxEntry[] }> {
  const all = await pendingChanges(db, wallId);
  return { waiting: all.length, refused: all.filter((e) => e.error !== null) };
}
