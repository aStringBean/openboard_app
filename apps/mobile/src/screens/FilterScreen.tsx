import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { GradeBoundPicker, Segmented } from "../components/Pickers";
import { DEFAULT_FILTER, SORTS, type Sort, type TickedFilter } from "../lib/catalog";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

export function FilterScreen() {
  const { wall, filter, setFilter, gradeScale } = useApp();
  const router = useRouter();
  const set = (patch: Partial<typeof filter>) => setFilter({ ...filter, ...patch });

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: "Filter problems" }} />

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.label}>Sort by</Text>
        <View style={styles.wrap}>
          {SORTS.map((s) => (
            <Pressable
              key={s.value}
              style={[styles.chip, filter.sort === s.value && styles.chipOn]}
              onPress={() => set({ sort: s.value as Sort })}
            >
              <Text style={[styles.chipText, filter.sort === s.value && styles.chipTextOn]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Grade from</Text>
        <GradeBoundPicker
          value={filter.minGrade}
          scale={gradeScale}
          end="min"
          onChange={(minGrade) => set({ minGrade })}
        />
        <Text style={styles.label}>Grade up to</Text>
        <GradeBoundPicker
          value={filter.maxGrade}
          scale={gradeScale}
          end="max"
          onChange={(maxGrade) => set({ maxGrade })}
        />
        {filter.minGrade !== null && filter.maxGrade !== null && filter.minGrade > filter.maxGrade ? (
          <Text style={styles.warn}>The lower grade is above the upper one, so nothing will match.</Text>
        ) : null}

        <Text style={styles.label}>Stars</Text>
        <Segmented<number>
          options={[
            { value: 0, label: "Any" },
            { value: 1, label: "★ 1+" },
            { value: 2, label: "★ 2+" },
            { value: 3, label: "★ 3" },
          ]}
          value={filter.minStars ?? 0}
          onChange={(v) => set({ minStars: v === 0 ? null : v })}
        />

        <Text style={styles.label}>Ticked</Text>
        <Segmented<TickedFilter>
          options={[
            { value: "all", label: "All" },
            { value: "ticked", label: "Ticked" },
            { value: "unticked", label: "Not yet" },
          ]}
          value={filter.ticked}
          onChange={(ticked) => set({ ticked })}
        />

        {wall.angleMode === "adjustable" ? (
          <View style={styles.switchRow}>
            <Text style={styles.switchText}>Only problems set at {wall.currentAngle}°</Text>
            <Switch value={filter.currentAngleOnly} onValueChange={(currentAngleOnly) => set({ currentAngleOnly })} />
          </View>
        ) : null}

        <Text style={styles.label}>Uses holds</Text>
        <View style={styles.holdsRow}>
          <Pressable style={[styles.btn, { flex: 2 }]} onPress={() => router.push("/filter-holds")}>
            <Text style={styles.btnText}>
              {filter.holdIds.length
                ? `${filter.holdIds.length} hold${filter.holdIds.length > 1 ? "s" : ""} chosen`
                : "Pick holds on the wall"}
            </Text>
          </Pressable>
          {filter.holdIds.length ? (
            <Pressable style={styles.btn} onPress={() => set({ holdIds: [] })}>
              <Text style={styles.btnText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.holdsRow, { marginTop: 14 }]}>
          <Pressable style={styles.btn} onPress={() => setFilter({ ...DEFAULT_FILTER, search: filter.search })}>
            <Text style={styles.btnText}>Reset</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.primary]} onPress={() => router.back()}>
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { padding: 16, gap: 8 },
  label: { color: theme.dim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8 },
  warn: { color: theme.warn, fontSize: 12 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: theme.panel,
  },
  chipOn: { borderColor: theme.accent, backgroundColor: "rgba(91,157,255,0.15)" },
  chipText: { color: theme.dim, fontSize: 13 },
  chipTextOn: { color: theme.text, fontWeight: "700" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  switchText: { color: theme.text, fontSize: 14 },
  holdsRow: { flexDirection: "row", gap: 8 },
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
