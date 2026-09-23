import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConnection } from "../components/ConnectChip";
import { starsText } from "../components/Pickers";
import { useFitCanvas } from "../components/useFitCanvas";
import { WallCanvas } from "../components/WallCanvas";
import * as board from "../lib/board";
import type { Calibration } from "../lib/calibration";
import type { ProblemSummary } from "../lib/catalog";
import { getList, getProblem, listProblems, loadCalibration } from "../lib/db/repo";
import { gradeLabel } from "../lib/grades";
import { problemFrame, type Problem } from "../lib/problem";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

/**
 * Steps through a list in order, lighting each problem on the wall as it
 * comes up — a circuit, without touching the phone between climbs beyond
 * pressing Next.
 */
export function CircuitScreen() {
  const { db, wall, gradeScale } = useApp();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conn = useConnection();

  const [name, setName] = useState("");
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [summaries, setSummaries] = useState<Map<string, ProblemSummary>>(new Map());
  const [cal, setCal] = useState<Calibration | null>(null);
  const [index, setIndex] = useState(0);
  const { onLayout: onCanvasLayout, width: canvasWidth, height: canvasHeight } = useFitCanvas(cal?.photoAspect);

  /* Loaded on focus so ticks logged mid-circuit show when coming back. */
  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const list = await getList(db, id);
        if (!list) return;
        const [ps, all, c] = await Promise.all([
          Promise.all(list.problemIds.map((pid) => getProblem(db, pid))),
          listProblems(db, wall.id),
          loadCalibration(db, wall.id),
        ]);
        if (!live) return;
        setName(list.name);
        setProblems(ps.filter((p): p is Problem => Boolean(p)));
        setSummaries(new Map(all.map((s) => [s.id, s])));
        setCal(c);
      })();
      return () => {
        live = false;
      };
    }, [db, id, wall.id]),
  );

  const current = problems?.[index];
  const summary = current ? summaries.get(current.id) : undefined;
  const roles = useMemo(() => new Map(current?.holds.map((h) => [h.holdId, h.role]) ?? []), [current]);

  /* Light each problem as it comes up, and again if the board reconnects. */
  useEffect(() => {
    if (!current || !cal || conn.status !== "connected") return;
    void board.send(problemFrame(current.holds, cal.holds).leds);
  }, [current, cal, conn.status]);

  if (!problems || !cal) {
    return (
      <View style={[styles.root, styles.centre]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (!current) {
    return (
      <View style={[styles.root, styles.centre]}>
        <Text style={styles.dim}>This list has no problems.</Text>
      </View>
    );
  }

  const last = index === problems.length - 1;

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: `${name} · ${index + 1}/${problems.length}` }} />

      <View style={styles.canvas} onLayout={onCanvasLayout}>
        {cal.photoUri && canvasWidth > 0 ? (
          <WallCanvas
            photoUri={cal.photoUri}
            width={canvasWidth}
            height={canvasHeight}
            holds={cal.holds}
            problemRoles={roles}
            onTap={() => {}}
          />
        ) : null}
      </View>

      <View style={styles.panel}>
        <View style={styles.progress}>
          {problems.map((p, i) => (
            <View
              key={p.id}
              style={[
                styles.pip,
                summaries.get(p.id)?.ticked && styles.pipDone,
                i === index && styles.pipNow,
              ]}
            />
          ))}
        </View>

        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>
              {current.name}
            </Text>
            <Text style={styles.dim}>
              {summary?.ticked ? "✓ ticked" : "not ticked yet"}
              {summary?.stars != null ? `  ${starsText(summary.stars)}` : ""}
            </Text>
          </View>
          <Text style={styles.grade}>{gradeLabel(summary?.consensus ?? current.grade, gradeScale)}</Text>
        </View>

        {conn.status !== "connected" ? <Text style={styles.warn}>Connect to light each problem.</Text> : null}

        <View style={styles.actions}>
          <Pressable
            style={[styles.btn, index === 0 && styles.disabled]}
            disabled={index === 0}
            onPress={() => setIndex((i) => i - 1)}
          >
            <Text style={styles.btnText}>◀ Prev</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => router.push(`/problem/tick?id=${current.id}`)}>
            <Text style={styles.btnText}>Tick</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.primary]}
            onPress={() => (last ? router.back() : setIndex((i) => i + 1))}
          >
            <Text style={styles.primaryText}>{last ? "Finish" : "Next ▶"}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  centre: { alignItems: "center", justifyContent: "center" },
  canvas: { flex: 1, overflow: "hidden", justifyContent: "center", alignItems: "center" },
  panel: { padding: 12, gap: 10, borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.panel },
  progress: { flexDirection: "row", gap: 4 },
  pip: { flex: 1, height: 4, borderRadius: 2, backgroundColor: theme.line },
  pipDone: { backgroundColor: theme.good },
  pipNow: { backgroundColor: theme.accent },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { color: theme.text, fontSize: 20, fontWeight: "700" },
  grade: { color: theme.text, fontSize: 20, fontWeight: "700" },
  dim: { color: theme.dim, fontSize: 13 },
  warn: { color: theme.warn, fontSize: 12 },
  actions: { flexDirection: "row", gap: 8 },
  btn: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    paddingVertical: 14,
    backgroundColor: theme.bg,
  },
  btnText: { color: theme.text, fontSize: 15, fontWeight: "600" },
  primary: { backgroundColor: theme.accent, borderColor: theme.accent },
  primaryText: { color: "#06101f", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.35 },
});
