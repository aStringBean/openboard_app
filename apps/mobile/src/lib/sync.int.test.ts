/**
 * Two phones, one wall, a real server: an owner and a climber, each with
 * their own local database, syncing through the local Supabase.
 *
 * Needs `supabase start` first. Run with `npm run test:sync`.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addHold, emptyCalibration, mergeDetections, moveHold, type Calibration } from "./calibration";
import {
  createList,
  createWall,
  deleteProblem,
  getProblem,
  getWall,
  listComments,
  listLists,
  listMembers,
  listProblems,
  loadCalibration,
  pendingChanges,
  saveCalibration,
  saveComment,
  saveProblem,
  saveTick,
  setListItems,
  setListShared,
  updateWall,
} from "./db/repo";
import { migrate } from "./db/schema";
import { memoryDb } from "./db/testDb";
import type { Db } from "./db/types";
import { newId, type Problem } from "./problem";
import { createInvite, joinWall, Offline, publishWall, removeMember, syncWall, type PhotoStore } from "./sync";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
/* Admin access, to make and remove the test users: the local stack's secret
 * key, from the environment or from `supabase status`. Never committed. */
const SECRET = process.env.SUPABASE_SECRET_KEY ?? localSecretKey();

function localSecretKey(): string {
  try {
    const root = fileURLToPath(new globalThis.URL("../../../../", import.meta.url));
    const env = execSync("mise exec -- supabase status -o env", { cwd: root, encoding: "utf8", stdio: "pipe" });
    const key = /^SECRET_KEY="(.+)"$/m.exec(env)?.[1];
    if (key) return key;
  } catch {
    /* Not running, or no access to Docker: say what to do instead. */
  }
  throw new Error("The sync tests need the local Supabase: run `supabase start`, or set SUPABASE_SECRET_KEY.");
}

const admin = createClient(URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const users: string[] = [];

interface Phone {
  db: Db;
  sb: SupabaseClient;
  me: string;
  photos: PhotoStore;
  sync(wallId: string): ReturnType<typeof syncWall>;
}

async function phone(label: string, name: string): Promise<Phone> {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const password = `pw-${newId()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  users.push(created.data.user.id);

  const sb = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await sb.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  await sb.from("profiles").update({ display_name: name }).eq("id", created.data.user.id);

  const db = memoryDb();
  await migrate(db);
  const dir = mkdtempSync(join(tmpdir(), `openboard-${label}-`));
  const photos: PhotoStore = {
    read: async (uri) => new Uint8Array(readFileSync(uri.replace(/^file:\/\//, ""))),
    save: async (wallId, fileName, bytes) => {
      const path = join(dir, `${wallId}-${fileName}`);
      writeFileSync(path, bytes);
      return `file://${path}`;
    },
  };
  const me = created.data.user.id;
  return { db, sb, me, photos, sync: (wallId) => syncWall(db, sb, photos, wallId, me) };
}

/** A small fake JPEG: the bytes only have to survive the trip. */
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 2000 }, (_, i) => i % 251), 0xff, 0xd9]);

function calibration(photoUri: string): Calibration {
  const c = mergeDetections(emptyCalibration(250), [
    { x: 0.1, y: 0.2 },
    { x: 0.3, y: 0.4 },
    /* Awkward doubles, to prove positions round-trip exactly. */
    { x: 0.1 + 0.2, y: 1 / 3 },
    { x: 0.7, y: 0.8 },
  ]);
  return { ...c, photoUri, photoAspect: 0.75, holds: c.holds.map((h, i) => ({ ...h, led: i * 10 })) };
}

const problem = (wallId: string, setterId: string | null, over: Partial<Problem> = {}): Problem => ({
  id: newId(),
  wallId,
  name: "Crimp city",
  grade: 8,
  angle: 40,
  holds: [
    { holdId: 0, role: "start" },
    { holdId: 1, role: "hand" },
    { holdId: 2, role: "finish" },
  ],
  setterId,
  createdAt: Date.now() - 60_000,
  updatedAt: Date.now() - 60_000,
  ...over,
});

let reachable = false;
let owner: Phone;
let climber: Phone;
let wallId: string;
let ownersProblem: Problem;

beforeAll(async () => {
  try {
    reachable = (await fetch(`${URL}/auth/v1/health`, { headers: { apikey: ANON } })).ok;
  } catch {
    reachable = false;
  }
  if (!reachable) return;

  owner = await phone("owner", "Olive Owner");
  climber = await phone("climber", "Cleo Climber");
});

afterAll(async () => {
  /* Deleting the users takes their walls and everything on them too. */
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

describe("sync between two phones", () => {
  it("needs a local Supabase", () => {
    expect(reachable, `Start it first: supabase start (looked at ${URL})`).toBe(true);
  });

  it("publishes a wall set up offline, claiming what was made on it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "openboard-src-"));
    const photoPath = join(dir, "wall.jpg");
    writeFileSync(photoPath, PHOTO);

    wallId = newId();
    await createWall(owner.db, wallId, "Garage", calibration(`file://${photoPath}`));
    /* Set and climbed before signing in, so nobody's yet. */
    ownersProblem = problem(wallId, null);
    await saveProblem(owner.db, ownersProblem);
    await saveTick(owner.db, {
      id: newId(),
      problemId: ownersProblem.id,
      climbedAt: Date.now() - 30_000,
      angle: 40,
      attempts: 1,
      grade: 9,
      stars: 3,
      comment: "",
      userId: null,
    });
    await createList(owner.db, "00000000-0000-4000-8000-00000000000a", wallId, "Private warm-up");
    await createList(owner.db, "00000000-0000-4000-8000-00000000000b", wallId, "Wall circuit");
    await setListItems(owner.db, "00000000-0000-4000-8000-00000000000b", [ownersProblem.id]);
    await setListShared(owner.db, "00000000-0000-4000-8000-00000000000b", true);

    await publishWall(owner.db, wallId, owner.me, "Olive Owner");
    const r = await owner.sync(wallId);

    expect(r).toMatchObject({ failed: 0, removed: false });
    expect(await pendingChanges(owner.db, wallId)).toEqual([]);
    expect((await getProblem(owner.db, ownersProblem.id))!.setterId).toBe(owner.me);
    expect(await getWall(owner.db, wallId)).toMatchObject({ cloud: true, role: "owner" });
  });

  it("lets a climber join with a code and get the whole wall", async () => {
    const code = await createInvite(owner.sb, wallId);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    const joined = await joinWall(climber.db, climber.sb, code.toLowerCase());
    expect(joined).toBe(wallId);
    const r = await climber.sync(wallId);
    expect(r.failed).toBe(0);

    expect(await getWall(climber.db, wallId)).toMatchObject({ name: "Garage", cloud: true, role: "climber" });

    const theirs = await loadCalibration(climber.db, wallId);
    const mine = await loadCalibration(owner.db, wallId);
    expect(theirs.holds.map(({ id, x, y, led, source }) => ({ id, x, y, led, source }))).toEqual(
      mine.holds.map(({ id, x, y, led, source }) => ({ id, x, y, led, source })),
    );
    expect(theirs.chainLength).toBe(250);
    expect(theirs.photoAspect).toBe(0.75);
    expect(new Uint8Array(readFileSync(theirs.photoUri!.replace("file://", "")))).toEqual(PHOTO);

    expect(await getProblem(climber.db, ownersProblem.id)).toMatchObject({
      name: "Crimp city",
      setterId: owner.me,
      holds: ownersProblem.holds,
    });

    /* The owner's ascent counts towards grade and stars, but isn't the climber's tick. */
    const [summary] = await listProblems(climber.db, wallId, climber.me);
    expect(summary).toMatchObject({ ascents: 1, stars: 3, ticked: false });

    /* The shared list comes across; the private one does not. */
    expect((await listLists(climber.db, wallId, climber.me)).map((l) => l.name)).toEqual(["Wall circuit"]);

    expect(await listMembers(climber.db, wallId)).toEqual([
      { userId: owner.me, role: "owner", name: "Olive Owner" },
      { userId: climber.me, role: "climber", name: "Cleo Climber" },
    ]);
  });

  it("brings the climber's problems, ticks and comments back to the owner", async () => {
    /* The wall lets everyone set. */
    const theirs = problem(wallId, climber.me, { name: "Slopey" });
    await saveProblem(climber.db, theirs);
    await saveTick(climber.db, {
      id: newId(),
      problemId: ownersProblem.id,
      climbedAt: Date.now(),
      angle: 40,
      attempts: 4,
      grade: 9,
      stars: 2,
      comment: "",
      userId: climber.me,
    });
    await saveComment(climber.db, {
      id: newId(),
      problemId: ownersProblem.id,
      userId: climber.me,
      body: "That last move!",
      createdAt: Date.now(),
    });

    expect(await climber.sync(wallId)).toMatchObject({ failed: 0 });
    await owner.sync(wallId);

    expect(await getProblem(owner.db, theirs.id)).toMatchObject({ name: "Slopey", setterId: climber.me });
    const summaries = await listProblems(owner.db, wallId, owner.me);
    expect(summaries.find((p) => p.id === ownersProblem.id)).toMatchObject({ ascents: 2, ticked: true });
    expect(summaries.find((p) => p.id === theirs.id)).toMatchObject({ ascents: 0, ticked: false });
    expect(await listComments(owner.db, ownersProblem.id)).toMatchObject([
      { body: "That last move!", userId: climber.me, author: "Cleo Climber" },
    ]);
  });

  it("stops a climber setting once only chosen setters may, and says why", async () => {
    const wall = await getWall(owner.db, wallId);
    await updateWall(owner.db, { ...wall, setterPolicy: "chosen" });
    await owner.sync(wallId);
    await climber.sync(wallId);
    expect((await getWall(climber.db, wallId)).setterPolicy).toBe("chosen");

    const refused = problem(wallId, climber.me, { name: "Sneaky" });
    await saveProblem(climber.db, refused);
    const r = await climber.sync(wallId);

    expect(r.failed).toBe(1);
    const [left] = await pendingChanges(climber.db, wallId);
    expect(left).toMatchObject({ kind: "problem", id: refused.id });
    expect(left!.error).toMatch(/row-level security/);

    /* It stays on the climber's phone, still waiting, rather than vanishing. */
    expect(await getProblem(climber.db, refused.id)).toBeDefined();
    await deleteProblem(climber.db, refused.id);
    await climber.sync(wallId);
  });

  it("takes a problem down on every phone when the owner deletes it", async () => {
    const slopey = (await listProblems(owner.db, wallId)).find((p) => p.name === "Slopey")!;
    await deleteProblem(owner.db, slopey.id);
    expect(await owner.sync(wallId)).toMatchObject({ failed: 0 });

    await climber.sync(wallId);
    expect(await getProblem(climber.db, slopey.id)).toBeUndefined();
  });

  it("moves a hold on every phone when the owner moves it", async () => {
    let c = await loadCalibration(owner.db, wallId);
    c = moveHold(c, 3, 0.71, 0.81);
    c = addHold(c, 0.5, 0.5).cal;
    await saveCalibration(owner.db, wallId, c);
    expect(await owner.sync(wallId)).toMatchObject({ failed: 0 });

    await climber.sync(wallId);
    const theirs = await loadCalibration(climber.db, wallId);
    expect(theirs.holds.find((h) => h.id === 3)).toMatchObject({ x: 0.71, y: 0.81 });
    expect(theirs.holds).toHaveLength(5);
  });

  it("keeps changes queued when the server cannot be reached", async () => {
    const away = createClient("http://127.0.0.1:1", ANON, { auth: { persistSession: false } });
    await saveComment(climber.db, {
      id: newId(),
      problemId: ownersProblem.id,
      userId: climber.me,
      body: "Offline beta",
      createdAt: Date.now(),
    });

    await expect(syncWall(climber.db, away, climber.photos, wallId, climber.me)).rejects.toBeInstanceOf(Offline);
    expect(await pendingChanges(climber.db, wallId)).toMatchObject([{ kind: "comment", error: null }]);

    await climber.sync(wallId);
    expect(await pendingChanges(climber.db, wallId)).toEqual([]);
  });

  it("tells a removed member they are out", async () => {
    await removeMember(owner.db, owner.sb, wallId, climber.me);
    expect(await climber.sync(wallId)).toMatchObject({ removed: true });
  });
});
