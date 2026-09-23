import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnglePicker, Segmented } from "../components/Pickers";
import { gradeLabel, type GradeScale } from "../lib/grades";
import { angleRange, DEFAULT_ADJUSTABLE, DEFAULT_FIXED_ANGLE, withAngles, type AngleMode } from "../lib/wall";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

/** A number field that commits when editing ends, ignoring anything non-numeric. */
function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        defaultValue={String(value)}
        onEndEditing={(e) => {
          const n = Number(e.nativeEvent.text);
          if (Number.isInteger(n)) onCommit(n);
        }}
      />
    </View>
  );
}

export function SettingsScreen() {
  const { wall, saveWall, gradeScale, setGradeScale } = useApp();
  const router = useRouter();
  const [range, setRange] = useState(() =>
    wall.angleMode === "adjustable" && wall.angles.length > 1
      ? { min: wall.angles[0]!, max: wall.angles[wall.angles.length - 1]!, step: wall.angles[1]! - wall.angles[0]! }
      : { ...DEFAULT_ADJUSTABLE },
  );

  const setMode = (mode: AngleMode) => {
    if (mode === wall.angleMode) return;
    const angles = mode === "fixed" ? [wall.currentAngle || DEFAULT_FIXED_ANGLE] : angleRange(range.min, range.max, range.step);
    void saveWall(withAngles(wall, mode, angles));
  };

  const setRangePart = (part: "min" | "max" | "step", n: number) => {
    const next = { ...range, [part]: n };
    setRange(next);
    void saveWall(withAngles(wall, "adjustable", angleRange(next.min, next.max, next.step)));
  };

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: "Settings" }} />

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>Wall</Text>

        <Pressable style={styles.link} onPress={() => router.push("/setup")}>
          <Text style={styles.linkTitle}>Wall setup</Text>
          <Text style={styles.dim}>Photo, hold detection, mapping LEDs to holds</Text>
        </Pressable>

        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            defaultValue={wall.name}
            maxLength={40}
            onEndEditing={(e) => {
              const name = e.nativeEvent.text.trim();
              if (name) void saveWall({ ...wall, name });
            }}
          />
        </View>

        <Text style={styles.label}>Angle</Text>
        <Segmented
          options={[
            { value: "fixed", label: "Fixed" },
            { value: "adjustable", label: "Adjustable" },
          ]}
          value={wall.angleMode}
          onChange={setMode}
        />

        {wall.angleMode === "fixed" ? (
          <NumberField
            key="fixed"
            label="Wall angle (degrees overhanging)"
            value={wall.currentAngle}
            onCommit={(a) => void saveWall(withAngles(wall, "fixed", [a]))}
          />
        ) : (
          <>
            <View style={styles.rangeRow}>
              <NumberField label="From" value={range.min} onCommit={(n) => setRangePart("min", n)} />
              <NumberField label="To" value={range.max} onCommit={(n) => setRangePart("max", n)} />
              <NumberField label="Step" value={range.step} onCommit={(n) => setRangePart("step", n)} />
            </View>
            <Text style={styles.label}>The wall is at</Text>
            <AnglePicker
              angles={wall.angles}
              value={wall.currentAngle}
              onChange={(currentAngle) => void saveWall({ ...wall, currentAngle })}
            />
            <Text style={styles.dim}>
              Problems are graded at the angle they are set at, so a 40° problem climbed at 30° is a different
              climb. New problems use the angle the wall is at.
            </Text>
          </>
        )}

        <Text style={styles.section}>Grades</Text>
        <Segmented<GradeScale>
          options={[
            { value: "font", label: "Font" },
            { value: "v", label: "V" },
            { value: "both", label: "Both" },
          ]}
          value={gradeScale}
          onChange={(s) => void setGradeScale(s)}
        />
        <Text style={styles.dim}>
          Shown as {gradeLabel(5, gradeScale)}. Grades are stored once and convert both ways, so switching never
          changes a problem's grade.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { padding: 16, gap: 10 },
  section: { color: theme.text, fontSize: 17, fontWeight: "700", marginTop: 8 },
  field: { flex: 1, gap: 4 },
  label: { color: theme.dim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
  input: {
    color: theme.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: theme.panel,
  },
  rangeRow: { flexDirection: "row", gap: 8 },
  link: { padding: 12, gap: 2, borderRadius: 10, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel },
  linkTitle: { color: theme.text, fontSize: 15, fontWeight: "600" },
  dim: { color: theme.dim, fontSize: 13 },
});
