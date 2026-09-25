import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState as RNAppState, StyleSheet, Text, View } from "react-native";
import { Paths } from "expo-file-system";

import { useSession } from "../components/useSession";
import { parseFilter, type ProblemFilter } from "../lib/catalog";
import { cloud } from "../lib/cloud";
import { openDb } from "../lib/db/expo";
import {
  createWall,
  deleteWallLocally,
  getSetting,
  getWall,
  listWalls,
  onOutbox,
  pendingChanges,
  setSetting,
  updateWall,
} from "../lib/db/repo";
import { migrate } from "../lib/db/schema";
import type { Db } from "../lib/db/types";
import type { GradeScale } from "../lib/grades";
import { loadLegacyCalibration } from "../lib/legacy";
import { forgetPhotos, keepPhoto, photoStore } from "../lib/photos";
import { newId } from "../lib/problem";
import { adoptMyWalls, Offline, syncWall } from "../lib/sync";
import type { Wall } from "../lib/wall";
import { theme } from "../theme";

export interface SyncStatus {
  running: boolean;
  /** The last attempt could not reach the server. */
  offline: boolean;
  /** The last attempt failed for some other reason. */
  error: string | null;
  lastAt: number | null;
  /** Changes waiting to go up, and how many of those the server refused. */
  waiting: number;
  refused: number;
  /** This user is no longer a member of the current wall. */
  removed: boolean;
}

const IDLE: SyncStatus = {
  running: false,
  offline: false,
  error: null,
  lastAt: null,
  waiting: 0,
  refused: 0,
  removed: false,
};

interface AppState {
  db: Db;
  /** The wall everything else is about. */
  wall: Wall;
  walls: Wall[];
  /** The signed-in user, or null. */
  me: string | null;
  saveWall(wall: Wall): Promise<void>;
  switchWall(id: string): Promise<void>;
  newWall(name: string): Promise<Wall>;
  /** Re-reads the walls, after a publish or join changed them. */
  reloadWalls(): Promise<void>;
  /** Removes a wall from this phone, switching to another. */
  forgetWall(id: string): Promise<void>;
  /** Whose shared walls this phone holds, if it holds any, to warn before another account signs in. */
  sharedWallsOf: string | null;
  /** Bumped whenever a sync brings in changes, so screens know to reload. */
  revision: number;
  sync: SyncStatus;
  syncNow(): Promise<void>;
  gradeScale: GradeScale;
  setGradeScale(scale: GradeScale): Promise<void>;
  /** The problem list's filter. Remembered across launches, except the search text. */
  filter: ProblemFilter;
  setFilter(filter: ProblemFilter): void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const app = useContext(Ctx);
  if (!app) throw new Error("useApp outside AppProvider");
  return app;
}

const SCALES: GradeScale[] = ["font", "v", "both"];

/** How soon after a change it goes up, so a burst of edits goes in one sync. */
const PUSH_DELAY_MS = 1500;
/** How often a shared wall looks for others' changes while the app is open. */
const POLL_MS = 60_000;

interface Booted {
  db: Db;
  walls: Wall[];
  wallId: string;
  /** The account this phone's shared walls belong to: the last one signed in. */
  account: { id: string; email: string } | null;
  gradeScale: GradeScale;
  filter: ProblemFilter;
}

/**
 * Photos picked before walls kept their own copies still point into the
 * image picker's cache, which the system may clear. Copy them somewhere safe
 * while they are still there.
 */
async function rescuePhotos(db: Db) {
  const rows = await db.all<{ id: string; photo_uri: string | null }>("SELECT id, photo_uri FROM wall");
  for (const r of rows) {
    if (!r.photo_uri || r.photo_uri.startsWith(Paths.document.uri)) continue;
    try {
      const kept = await keepPhoto(r.id, r.photo_uri);
      await db.run("UPDATE wall SET photo_uri = ? WHERE id = ?", [kept, r.id]);
    } catch {
      /* Already gone: the wall setup screen asks for a new photo. */
    }
  }
}

/**
 * Opens the database and makes sure there is a wall. On first launch after
 * the move to SQLite, that wall is seeded from the calibration the app kept
 * in AsyncStorage, so existing setup carries straight across.
 */
async function boot(): Promise<Booted> {
  const db = await openDb();
  await migrate(db);
  await rescuePhotos(db);

  let walls = await listWalls(db);
  if (!walls.length) {
    await createWall(db, newId(), "My wall", await loadLegacyCalibration());
    walls = await listWalls(db);
  }
  const stored = await getSetting(db, "currentWall");
  const wallId = walls.some((w) => w.id === stored) ? stored! : walls[0]!.id;

  const scale = await getSetting(db, "gradeScale");
  const gradeScale = SCALES.includes(scale as GradeScale) ? (scale as GradeScale) : "both";

  const filter = { ...parseFilter(await getSetting(db, "problemFilter")), search: "" };

  let account: Booted["account"] = null;
  try {
    account = JSON.parse((await getSetting(db, "account")) ?? "null");
  } catch {
    /* Unreadable: treated as no account, so nothing is removed. */
  }

  return { db, walls, wallId, account, gradeScale, filter };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState<Booted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  /* Tagged with its wall, so switching walls never shows the last one's status. */
  const [syncState, setSync] = useState<SyncStatus & { wallId?: string }>(IDLE);
  const { session } = useSession();
  const me = session?.user.id ?? null;
  const email = session?.user.email ?? "";

  useEffect(() => {
    boot().then(setReady, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const db = ready?.db;
  const wallId = ready?.wallId;
  const wall = ready?.walls.find((w) => w.id === ready.wallId);
  const shared = Boolean(wall?.cloud);
  const account = ready?.account;

  const reloadWalls = useCallback(async () => {
    if (!db) return;
    const walls = await listWalls(db);
    setReady((r) => (r ? { ...r, walls } : r));
  }, [db]);


  /*
   * Shared walls belong to the account that joined them. When a different
   * account signs in, the previous one's come off this phone — they stay on
   * the server — before any sync can push its queued changes as the new one.
   */
  useEffect(() => {
    if (!db || !me || account === undefined || account?.id === me) return;
    void (async () => {
      if (account) {
        for (const w of (await listWalls(db)).filter((x) => x.cloud)) {
          await deleteWallLocally(db, w.id);
          forgetPhotos(w.id);
        }
      }
      let walls = await listWalls(db);
      if (!walls.length) {
        await createWall(db, newId(), "My wall");
        walls = await listWalls(db);
      }
      const next = { id: me, email };
      await setSetting(db, "account", JSON.stringify(next));
      setReady((r) =>
        r ? { ...r, walls, account: next, wallId: walls.some((w) => w.id === r.wallId) ? r.wallId : walls[0]!.id } : r,
      );
    })();
  }, [db, me, email, account]);

  /* Once the account is settled, fetch any shared walls it belongs to that this phone lacks. */
  useEffect(() => {
    if (!db || !me || account?.id !== me) return;
    adoptMyWalls(db, cloud, me).then(
      (added) => {
        if (added.length) void reloadWalls();
      },
      () => {
        /* Offline: the next sign-in or launch tries again. */
      },
    );
  }, [db, me, account, reloadWalls]);

  // ----------------------------------------------------------------- sync

  /* One sync at a time; a request during one runs another straight after —
   * through the latest runSync, since the wall may have changed meanwhile. */
  const running = useRef(false);
  const again = useRef(false);
  const latest = useRef<() => Promise<void>>(async () => {});

  const runSync = useCallback(async () => {
    if (!db || !wallId || !me || !shared || account?.id !== me) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    setSync((s) => ({ ...(s.wallId === wallId ? s : IDLE), wallId, running: true }));

    try {
      let next: Partial<SyncStatus>;
      try {
        const r = await syncWall(db, cloud, photoStore, wallId, me);
        next = { offline: false, error: null, lastAt: Date.now(), removed: r.removed };
        if (r.pulled > 0 || r.pushed > 0) setRevision((n) => n + 1);
      } catch (err) {
        next = err instanceof Offline ? { offline: true } : { error: err instanceof Error ? err.message : String(err) };
      }
      const queue = await pendingChanges(db, wallId);
      setSync((s) => ({
        ...s,
        ...next,
        waiting: queue.length,
        refused: queue.filter((e) => e.error !== null).length,
      }));
      /* Name, angles, policy or role may have changed. */
      const fresh = await getWall(db, wallId).catch(() => undefined);
      if (fresh) setReady((r) => (r ? { ...r, walls: r.walls.map((w) => (w.id === fresh.id ? fresh : w)) } : r));
    } finally {
      running.current = false;
      setSync((s) => ({ ...s, running: false }));
      if (again.current) {
        again.current = false;
        void latest.current();
      }
    }
  }, [db, wallId, me, shared, account]);

  useEffect(() => {
    latest.current = runSync;
  }, [runSync]);

  /* Sync when the wall or the user changes, and poll while in front. */
  useEffect(() => {
    if (!shared || !me) return;
    void runSync();
    const poll = setInterval(() => {
      if (RNAppState.currentState === "active") void runSync();
    }, POLL_MS);
    const front = RNAppState.addEventListener("change", (s) => {
      if (s === "active") void runSync();
    });
    return () => {
      clearInterval(poll);
      front.remove();
    };
  }, [runSync, shared, me]);

  /* Push local changes shortly after they are made. */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    onOutbox((changed) => {
      if (changed !== wallId) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void runSync(), PUSH_DELAY_MS);
    });
    return () => {
      onOutbox(null);
      if (timer) clearTimeout(timer);
    };
  }, [runSync, wallId]);

  // ---------------------------------------------------------------- walls

  const saveWall = useCallback(
    async (next: Wall) => {
      if (!db) return;
      await updateWall(db, next);
      setReady((r) => (r ? { ...r, walls: r.walls.map((w) => (w.id === next.id ? next : w)) } : r));
    },
    [db],
  );

  const switchWall = useCallback(
    async (id: string) => {
      if (!db) return;
      await setSetting(db, "currentWall", id);
      setReady((r) => (r ? { ...r, wallId: id } : r));
    },
    [db],
  );

  const newWall = useCallback(
    async (name: string) => {
      if (!db) throw new Error("Not ready");
      const created = await createWall(db, newId(), name.trim() || "New wall");
      await reloadWalls();
      await switchWall(created.id);
      return created;
    },
    [db, reloadWalls, switchWall],
  );

  const forgetWall = useCallback(
    async (id: string) => {
      if (!db) return;
      await deleteWallLocally(db, id);
      forgetPhotos(id);
      let walls = await listWalls(db);
      if (!walls.length) {
        await createWall(db, newId(), "My wall");
        walls = await listWalls(db);
      }
      const current = walls.some((w) => w.id === wallId) ? wallId! : walls[0]!.id;
      await setSetting(db, "currentWall", current);
      setReady((r) => (r ? { ...r, walls, wallId: current } : r));
    },
    [db, wallId],
  );

  // ------------------------------------------------------------- settings

  const setGradeScale = useCallback(
    async (gradeScale: GradeScale) => {
      if (!db) return;
      await setSetting(db, "gradeScale", gradeScale);
      setReady((r) => (r ? { ...r, gradeScale } : r));
    },
    [db],
  );

  const setFilter = useCallback(
    (filter: ProblemFilter) => {
      if (!db) return;
      setReady((r) => (r ? { ...r, filter } : r));
      void setSetting(db, "problemFilter", JSON.stringify({ ...filter, search: "" }));
    },
    [db],
  );

  const sync = syncState.wallId === wallId && shared && me ? syncState : IDLE;

  if (error) {
    return (
      <View style={styles.centre}>
        <Text style={styles.error}>Could not open the app&apos;s database.</Text>
        <Text style={styles.dim}>{error}</Text>
      </View>
    );
  }

  if (!ready || !wall) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <Ctx.Provider
      value={{
        db: ready.db,
        wall,
        walls: ready.walls,
        me,
        saveWall,
        switchWall,
        newWall,
        reloadWalls,
        forgetWall,
        sharedWallsOf: ready.walls.some((w) => w.cloud) ? (ready.account?.email ?? null) : null,
        revision,
        sync,
        syncNow: runSync,
        gradeScale: ready.gradeScale,
        setGradeScale,
        filter: ready.filter,
        setFilter,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8, backgroundColor: theme.bg },
  error: { color: theme.danger, fontSize: 15, fontWeight: "600" },
  dim: { color: theme.dim, fontSize: 13, textAlign: "center" },
});
