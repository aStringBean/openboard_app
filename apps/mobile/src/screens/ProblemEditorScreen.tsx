import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConnection } from "../components/ConnectChip";
import { AnglePicker, GradePicker, RolePalette } from "../components/Pickers";
import { useFitCanvas } from "../components/useFitCanvas";
import { WallCanvas } from "../components/WallCanvas";
import * as board from "../lib/board";
import { holdNear, type Calibration } from "../lib/calibration";
import { getProblem, loadCalibration, saveProblem } from "../lib/db/repo";
import { DEFAULT_GRADE } from "../lib/grades";
import {
  countRoles,
  newId,
  problemFrame,
  roleFull,
  ROLE_LIMITS,
  ROLE_STYLE,
  toggleRole,
  validateProblem,
  type Problem,
  type ProblemHold,
  type Role,
} from "../lib/problem";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

/** Screen pixels within which a tap hits a hold. */
const HIT_PX = 24;

export function ProblemEditorScreen() {
  const { db, wall, gradeScale } = useApp();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const conn = useConnection();

  const [cal, setCal] = useState<Calibration | null>(null);
  const [original, setOriginal] = useState<Problem | null>(null);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState(DEFAULT_GRADE);
  const [angle, setAngle] = useState(wall.currentAngle);
  const [holds, setHolds] = useState<ProblemHold[]>([]);
  const [role, setRole] = useState<Role>("start");
  const [issues, setIssues] = useState<string[]>([]);
  /* Why the last tap was refused, if it was. */
  const [refused, setRefused] = useState<string | null>(null);
  const { onLayout: onCanvasLayout, width: canvasWidth, height: canvasHeight } = useFitCanvas(cal?.photoAspect);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setCal(await loadCalibration(db, wall.id));
      if (!id) return;

      const p = await getProblem(db, id);
      if (!p) return;
      setOriginal(p);
      setName(p.name);
      setGrade(p.grade);
      setAngle(p.angle);
      setHolds(p.holds);
    })();
  }, [db, wall.id, id]);

  /* Light the problem on the wall as it is built, so the setter sees exactly
   * what a climber will. Also re-sends when the board connects mid-edit. */
  useEffect(() => {
    if (!cal || conn.status !== "connected") return;
    void board.send(problemFrame(holds, cal.holds).leds);
  }, [holds, cal, conn.status]);

  const roles = useMemo(() => new Map(holds.map((h) => [h.holdId, h.role])), [holds]);
  const counts = useMemo(() => countRoles(holds), [holds]);
  const unlit = useMemo(() => (cal ? problemFrame(holds, cal.holds).unlit : 0), [holds, cal]);


  const onTap = useCallback(
    (x: number, y: number, zoom: number) => {
      if (!cal) return;
      const hit = holdNear(cal, x, y, { width: canvasWidth, height: canvasHeight, zoom, hitPx: HIT_PX });
      if (!hit) return;

      if (roleFull(holds, hit.id, role)) {
        const label = ROLE_STYLE[role].label.toLowerCase();
        setRefused(`Already ${ROLE_LIMITS[role]!.max} ${label} holds — tap one of them to take it out first.`);
        return;
      }

      setRefused(null);
      setHolds((hs) => toggleRole(hs, hit.id, role));
      setIssues([]);
    },
    [cal, canvasWidth, canvasHeight, role, holds],
  );

  const save = async () => {
    const found = validateProblem({ name, holds });
    setIssues(found);
    if (found.length) return;

    setSaving(true);
    const now = Date.now();
    const problem: Problem = {
      id: original?.id ?? newId(),
      wallId: wall.id,
      name: name.trim(),
      grade,
      angle,
      holds,
      createdAt: original?.createdAt ?? now,
      updatedAt: now,
    };

    try {
      await saveProblem(db, problem);
      /* A new problem opens in its own view; an edited one returns to it. */
      if (original) router.back();
      else router.replace(`/problem/${problem.id}`);
    } catch (err) {
      setSaving(false);
      Alert.alert("Could not save", err instanceof Error ? err.message : String(err));
    }
  };

  if (!cal) {
    return (
      <View style={[styles.root, styles.centre]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: original ? "Edit problem" : "New problem" }} />

      <View style={styles.canvas} onLayout={onCanvasLayout}>
        {cal.photoUri && canvasWidth > 0 ? (
          <WallCanvas
            photoUri={cal.photoUri}
            width={canvasWidth}
            height={canvasHeight}
            holds={cal.holds}
            problemRoles={roles}
            showUnused
            onTap={onTap}
          />
        ) : null}
      </View>

      <View style={styles.paletteBar}>
        <RolePalette
          active={role}
          counts={counts}
          onSelect={(r) => {
            setRole(r);
            setRefused(null);
          }}
        />
        {refused ? <Text style={styles.refused}>{refused}</Text> : null}
        <Text style={styles.hint}>
          Tap a hold to make it {role === "no_match" ? "a no-match hand" : `a ${role}`} hold; tap it again to
          remove it.
          {conn.status === "connected" ? " The wall shows it as you go." : " Connect to see it on the wall."}
        </Text>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelInner} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.input}
          placeholder="Name"
          placeholderTextColor={theme.dim}
          value={name}
          onChangeText={(t) => {
            setName(t);
            setIssues([]);
          }}
          maxLength={60}
        />

        <Text style={styles.label}>Grade</Text>
        <GradePicker value={grade} scale={gradeScale} onChange={setGrade} />

        {wall.angleMode === "adjustable" ? (
          <>
            <Text style={styles.label}>Set at</Text>
            <AnglePicker angles={wall.angles} value={angle} onChange={setAngle} />
          </>
        ) : null}

        {unlit > 0 ? (
          <Text style={styles.note}>
            {unlit} hold{unlit > 1 ? "s have" : " has"} no LED beside it, so won't light on the wall.
          </Text>
        ) : null}

        {issues.map((i) => (
          <Text key={i} style={styles.issue}>
            {i}
          </Text>
        ))}

        <View style={styles.actions}>
          <Pressable style={styles.btn} onPress={() => router.back()}>
            <Text style={styles.btnText}>Cancel</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.primary]} onPress={save} disabled={saving}>
            <Text style={styles.primaryText}>{saving ? "Saving…" : "Save"}</Text>
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
  paletteBar: {
    padding: 10,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    backgroundColor: theme.panel,
  },
  hint: { color: theme.dim, fontSize: 12 },
  refused: { color: theme.warn, fontSize: 12, fontWeight: "600" },
  panel: { maxHeight: "38%" },
  panelInner: { padding: 12, gap: 8 },
  input: {
    color: theme.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: theme.panel,
  },
  label: { color: theme.dim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 4 },
  note: { color: theme.warn, fontSize: 12 },
  issue: { color: theme.danger, fontSize: 13 },
  actions: { flexDirection: "row", gap: 8, marginTop: 6 },
  btn: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    paddingVertical: 12,
    backgroundColor: theme.panel,
  },
  btnText: { color: theme.text, fontSize: 14, fontWeight: "500" },
  primary: { backgroundColor: theme.accent, borderColor: theme.accent },
  primaryText: { color: "#06101f", fontSize: 14, fontWeight: "700" },
});
