import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnglePicker, GradePicker, StarsInput } from "../components/Pickers";
import { getProblem, saveTick, ticksFor } from "../lib/db/repo";
import { newId, type Problem } from "../lib/problem";
import { gradeAt, validateTick, type Tick } from "../lib/tick";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

/** Logs an ascent of one problem. */
export function TickScreen() {
  const { db, wall, me, gradeScale } = useApp();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [problem, setProblem] = useState<Problem | null>(null);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [attempts, setAttempts] = useState(1);
  const [angle, setAngle] = useState(wall.currentAngle);
  const [grade, setGrade] = useState(0);
  const [stars, setStars] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [gradeTouched, setGradeTouched] = useState(false);

  useEffect(() => {
    Promise.all([getProblem(db, id), ticksFor(db, id)]).then(([p, t]) => {
      if (!p) return;
      setProblem(p);
      setTicks(t);
      /* On a fixed wall there is only the set angle; on an adjustable one,
       * default to where the wall is now. */
      setAngle(wall.angleMode === "fixed" ? p.angle : wall.currentAngle);
    });
  }, [db, id, wall]);

  /* Until the climber picks a grade themselves, offer what the problem is
   * currently felt to be at the chosen angle. */
  useEffect(() => {
    if (!problem || gradeTouched) return;
    setGrade(gradeAt(problem, ticks, angle) ?? problem.grade);
  }, [problem, ticks, angle, gradeTouched]);

  const save = async () => {
    if (!problem) return;
    const tick: Tick = {
      id: newId(),
      problemId: problem.id,
      climbedAt: Date.now(),
      angle,
      attempts,
      grade,
      stars,
      comment,
      userId: me,
    };

    const issues = validateTick(tick);
    if (issues.length) return Alert.alert("Can't log that yet", issues.join("\n"));

    try {
      await saveTick(db, tick);
      router.back();
    } catch (err) {
      Alert.alert("Could not save", err instanceof Error ? err.message : String(err));
    }
  };

  if (!problem) {
    return (
      <View style={[styles.root, styles.centre]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const first = ticks.length === 0;

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: `Tick · ${problem.name}` }} />

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Attempts</Text>
        <View style={styles.stepper}>
          <Pressable style={styles.step} onPress={() => setAttempts((a) => Math.max(1, a - 1))}>
            <Text style={styles.stepText}>−</Text>
          </Pressable>
          <View style={styles.stepValue}>
            <Text style={styles.attempts}>{attempts}</Text>
            <Text style={styles.dim}>
              {attempts === 1 ? (first ? "Flash" : "In one go") : first ? "Send" : "Repeat"}
            </Text>
          </View>
          <Pressable style={styles.step} onPress={() => setAttempts((a) => a + 1)}>
            <Text style={styles.stepText}>+</Text>
          </Pressable>
        </View>

        {wall.angleMode === "adjustable" ? (
          <>
            <Text style={styles.label}>Climbed at</Text>
            <AnglePicker angles={wall.angles} value={angle} onChange={setAngle} />
          </>
        ) : null}

        <Text style={styles.label}>Your grade</Text>
        <GradePicker
          value={grade}
          scale={gradeScale}
          onChange={(g) => {
            setGrade(g);
            setGradeTouched(true);
          }}
        />

        <Text style={styles.label}>Quality</Text>
        <StarsInput value={stars} onChange={setStars} />

        <Text style={styles.label}>Notes</Text>
        <TextInput
          style={[styles.input, styles.notes]}
          placeholder="Beta, conditions, anything…"
          placeholderTextColor={theme.dim}
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={500}
        />

        <View style={styles.actions}>
          <Pressable style={styles.btn} onPress={() => router.back()}>
            <Text style={styles.btnText}>Cancel</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.primary]} onPress={save}>
            <Text style={styles.primaryText}>Log ascent</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  centre: { alignItems: "center", justifyContent: "center" },
  body: { padding: 16, gap: 10 },
  label: { color: theme.dim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6 },
  dim: { color: theme.dim, fontSize: 13 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 12 },
  step: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.panel,
  },
  stepText: { color: theme.text, fontSize: 26, fontWeight: "600" },
  stepValue: { flex: 1, alignItems: "center" },
  attempts: { color: theme.text, fontSize: 30, fontWeight: "700" },
  input: {
    color: theme.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: theme.panel,
  },
  notes: { minHeight: 70, textAlignVertical: "top" },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 },
  btn: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    paddingVertical: 13,
    backgroundColor: theme.panel,
  },
  btnText: { color: theme.text, fontSize: 14, fontWeight: "500" },
  primary: { backgroundColor: theme.accent, borderColor: theme.accent },
  primaryText: { color: "#06101f", fontSize: 14, fontWeight: "700" },
});
