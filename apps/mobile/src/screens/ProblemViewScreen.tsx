import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConnection } from "../components/ConnectChip";
import { starsText } from "../components/Pickers";
import { useFitCanvas } from "../components/useFitCanvas";
import { WallCanvas } from "../components/WallCanvas";
import * as board from "../lib/board";
import type { Calibration } from "../lib/calibration";
import { deleteProblem, deleteTick, getProblem, loadCalibration, ticksFor } from "../lib/db/repo";
import { gradeLabel } from "../lib/grades";
import { countRoles, problemFrame, ROLE_STYLE, ROLES, type Problem } from "../lib/problem";
import { averageStars, byAngle, gradeAt, isFlash, shortDate, type Tick } from "../lib/tick";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

export function ProblemViewScreen() {
  const { db, wall, gradeScale } = useApp();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conn = useConnection();

  const [problem, setProblem] = useState<Problem | null | undefined>(undefined);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [cal, setCal] = useState<Calibration | null>(null);
  const { onLayout: onCanvasLayout, width: canvasWidth, height: canvasHeight } = useFitCanvas(cal?.photoAspect);

  const reload = useCallback(() => {
    let live = true;
    Promise.all([getProblem(db, id), ticksFor(db, id), loadCalibration(db, wall.id)]).then(([p, t, c]) => {
      if (!live) return;
      setProblem(p ?? null);
      setTicks(t);
      setCal(c);
    });
    return () => {
      live = false;
    };
  }, [db, id, wall.id]);

  /* Reload on focus, so returning from the editor or a tick shows it. */
  useFocusEffect(reload);

  const frame = useMemo(() => (problem && cal ? problemFrame(problem.holds, cal.holds) : null), [problem, cal]);

  const light = useCallback(() => {
    if (frame) void board.send(frame.leds);
  }, [frame]);

  /* Opening a problem lights it; so does connecting while it is open. */
  useEffect(() => {
    if (conn.status === "connected") light();
  }, [conn.status, light]);

  const roles = useMemo(() => new Map(problem?.holds.map((h) => [h.holdId, h.role]) ?? []), [problem]);
  const counts = useMemo(() => countRoles(problem?.holds ?? []), [problem]);

  const remove = () =>
    Alert.alert(
      "Delete problem?",
      `"${problem?.name}"${ticks.length ? ` and its ${ticks.length} logged ascent${ticks.length > 1 ? "s" : ""}` : ""} will be gone for good.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteProblem(db, id);
            void board.blank();
            router.back();
          },
        },
      ],
    );

  const removeTick = (t: Tick) =>
    Alert.alert("Delete this ascent?", `${shortDate(t.climbedAt)} · ${isFlash(t) ? "flash" : `${t.attempts} goes`}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteTick(db, t.id);
          reload();
        },
      },
    ]);

  if (problem === null) {
    return (
      <View style={[styles.root, styles.centre]}>
        <Text style={styles.dim}>This problem no longer exists.</Text>
      </View>
    );
  }

  if (!problem || !cal) {
    return (
      <View style={[styles.root, styles.centre]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const consensus = gradeAt(problem, ticks, problem.angle) ?? problem.grade;
  const stars = averageStars(ticks);
  const angles = byAngle(problem, ticks);
  const adjustable = wall.angleMode === "adjustable";
  const connected = conn.status === "connected";

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: problem.name }} />

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

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelInner}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={2}>
              {problem.name}
            </Text>
            {stars !== null ? <Text style={styles.stars}>{starsText(stars)}</Text> : null}
          </View>
          <View style={styles.gradeBox}>
            <Text style={styles.grade}>{gradeLabel(consensus, gradeScale)}</Text>
            {consensus !== problem.grade ? (
              <Text style={styles.dim}>set as {gradeLabel(problem.grade, gradeScale)}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.legend}>
          {ROLES.filter((r) => counts[r] > 0).map((r) => (
            <View key={r} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: ROLE_STYLE[r].ui }]} />
              <Text style={styles.dim}>
                {counts[r]} {ROLE_STYLE[r].label.toLowerCase()}
              </Text>
            </View>
          ))}
          {adjustable ? <Text style={styles.dim}>· set at {problem.angle}°</Text> : null}
        </View>

        {adjustable && problem.angle !== wall.currentAngle ? (
          <Text style={styles.note}>
            Set at {problem.angle}°; the wall is at {wall.currentAngle}°, so it will climb differently.
          </Text>
        ) : null}
        {frame && frame.unlit > 0 ? (
          <Text style={styles.note}>
            {frame.unlit} hold{frame.unlit > 1 ? "s have" : " has"} no LED, so won't light.
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            style={[styles.btn, styles.primary]}
            onPress={() => router.push(`/problem/tick?id=${problem.id}`)}
          >
            <Text style={styles.primaryText}>Tick</Text>
          </Pressable>
          <Pressable style={[styles.btn, !connected && styles.disabled]} onPress={light} disabled={!connected}>
            <Text style={styles.btnText}>{connected ? "Light it" : "Not connected"}</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>
          {ticks.length === 0
            ? "Not climbed yet"
            : `${ticks.length} ascent${ticks.length > 1 ? "s" : ""}${
                ticks.length && isFlash(ticks[ticks.length - 1]!) ? " · flashed" : ""
              }`}
        </Text>

        {adjustable && angles.length > 1
          ? angles.map((a) => (
              <Text key={a.angle} style={styles.dim}>
                {a.angle}°: {a.ascents} ascent{a.ascents === 1 ? "" : "s"}
                {a.grade !== null ? ` · ${gradeLabel(a.grade, gradeScale)}` : ""}
              </Text>
            ))
          : null}

        {ticks.map((t) => (
          <Pressable key={t.id} style={styles.tick} onLongPress={() => removeTick(t)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.tickMain}>
                {shortDate(t.climbedAt)} · {isFlash(t) ? "one go" : `${t.attempts} goes`}
                {adjustable ? ` · ${t.angle}°` : ""}
              </Text>
              {t.comment ? <Text style={styles.dim}>{t.comment}</Text> : null}
            </View>
            <Text style={styles.tickGrade}>
              {t.grade !== null ? gradeLabel(t.grade, gradeScale) : ""} {starsText(t.stars)}
            </Text>
          </Pressable>
        ))}
        {ticks.length ? <Text style={styles.hint}>Long-press an ascent to delete it.</Text> : null}

        <View style={styles.actions}>
          <Pressable style={styles.btn} onPress={() => router.push(`/problem/lists?id=${problem.id}`)}>
            <Text style={styles.btnText}>Lists</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => router.push(`/problem/edit?id=${problem.id}`)}>
            <Text style={styles.btnText}>Edit</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={remove}>
            <Text style={[styles.btnText, { color: theme.danger }]}>Delete</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  centre: { alignItems: "center", justifyContent: "center" },
  canvas: { flex: 1, overflow: "hidden", justifyContent: "center", alignItems: "center" },
  panel: { maxHeight: "50%", borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.panel },
  panelInner: { padding: 12, gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  name: { color: theme.text, fontSize: 20, fontWeight: "700" },
  stars: { color: "#ffc94d", fontSize: 16, marginTop: 2 },
  gradeBox: { alignItems: "flex-end" },
  grade: { color: theme.text, fontSize: 20, fontWeight: "700" },
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  dim: { color: theme.dim, fontSize: 13 },
  hint: { color: theme.dim, fontSize: 11 },
  note: { color: theme.warn, fontSize: 12 },
  section: { color: theme.text, fontSize: 15, fontWeight: "600", marginTop: 6 },
  tick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: theme.bg,
  },
  tickMain: { color: theme.text, fontSize: 14 },
  tickGrade: { color: theme.text, fontSize: 14, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
  btn: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    paddingVertical: 12,
    backgroundColor: theme.bg,
  },
  btnText: { color: theme.text, fontSize: 14, fontWeight: "500" },
  primary: { backgroundColor: theme.accent, borderColor: theme.accent },
  primaryText: { color: "#06101f", fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.45 },
});
