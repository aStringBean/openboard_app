import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { DEFAULT_FILTER, parseFilter, type ProblemFilter } from "../lib/catalog";
import { openDb } from "../lib/db/expo";
import { createWall, firstWall, getSetting, setSetting, updateWall } from "../lib/db/repo";
import { migrate } from "../lib/db/schema";
import type { Db } from "../lib/db/types";
import type { GradeScale } from "../lib/grades";
import { loadLegacyCalibration } from "../lib/legacy";
import { newId } from "../lib/problem";
import type { Wall } from "../lib/wall";
import { theme } from "../theme";

interface AppState {
  db: Db;
  wall: Wall;
  saveWall(wall: Wall): Promise<void>;
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

/**
 * Opens the database and makes sure there is a wall. On first launch after
 * the move to SQLite, that wall is seeded from the calibration the app kept
 * in AsyncStorage, so existing setup carries straight across.
 */
interface Booted {
  db: Db;
  wall: Wall;
  gradeScale: GradeScale;
  filter: ProblemFilter;
}

async function boot(): Promise<Booted> {
  const db = await openDb();
  await migrate(db);

  const wall = (await firstWall(db)) ?? (await createWall(db, newId(), "My wall", await loadLegacyCalibration()));

  const stored = await getSetting(db, "gradeScale");
  const gradeScale = SCALES.includes(stored as GradeScale) ? (stored as GradeScale) : "both";

  const filter = { ...parseFilter(await getSetting(db, "problemFilter")), search: "" };

  return { db, wall, gradeScale, filter };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState<Booted | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    boot().then(setReady, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const saveWall = useCallback(
    async (wall: Wall) => {
      if (!ready) return;
      await updateWall(ready.db, wall);
      setReady((r) => (r ? { ...r, wall } : r));
    },
    [ready],
  );

  const setGradeScale = useCallback(
    async (gradeScale: GradeScale) => {
      if (!ready) return;
      await setSetting(ready.db, "gradeScale", gradeScale);
      setReady((r) => (r ? { ...r, gradeScale } : r));
    },
    [ready],
  );

  const setFilter = useCallback(
    (filter: ProblemFilter) => {
      if (!ready) return;
      setReady((r) => (r ? { ...r, filter } : r));
      void setSetting(ready.db, "problemFilter", JSON.stringify({ ...filter, search: "" }));
    },
    [ready],
  );

  if (error) {
    return (
      <View style={styles.centre}>
        <Text style={styles.error}>Could not open the app's database.</Text>
        <Text style={styles.dim}>{error}</Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return <Ctx.Provider value={{ ...ready, saveWall, setGradeScale, setFilter }}>{children}</Ctx.Provider>;
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8, backgroundColor: theme.bg },
  error: { color: theme.danger, fontSize: 15, fontWeight: "600" },
  dim: { color: theme.dim, fontSize: 13, textAlign: "center" },
});
