import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { Segmented } from "../components/Pickers";
import { RangeSlider } from "../components/RangeSlider";
import { DEFAULT_FILTER, SORTS, type Sort, type TickedFilter } from "../lib/catalog";
import { gradeOptions, gradeRangeToSteps, stepsToGradeRange } from "../lib/grades";
import { MAX_STARS } from "../lib/tick";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

export function FilterScreen() {
  const { wall, filter, setFilter, gradeScale } = useApp();
  const router = useRouter();
  const set = (patch: Partial<typeof filter>) => setFilter({ ...filter, ...patch });

  const grades = gradeOptions(gradeScale);
  const lastGrade = grades.length - 1;
  const [gradeLo, gradeHi] = gradeRangeToSteps(filter.minGrade, filter.maxGrade, gradeScale);

  /* Star positions 0 … MAX_STARS-1 stand for 1★ … MAX_STARS★. */
  const starsLo = (filter.minStars ?? 1) - 1;
  const starsHi = (filter.maxStars ?? MAX_STARS) - 1;
  const stars = (n: number) => "★".repeat(n + 1);

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

        <Text style={styles.label}>Grade</Text>
        <RangeSlider
          steps={grades.length}
          low={gradeLo}
          high={gradeHi}
          ends={[grades[0]!.label, grades[lastGrade]!.label]}
          label={(lo, hi) =>
            lo === 0 && hi === lastGrade
              ? "Any grade"
              : lo === hi
                ? grades[lo]!.label
                : `${grades[lo]!.label} – ${grades[hi]!.label}`
          }
          onChange={(lo, hi) => set(stepsToGradeRange(lo, hi, gradeScale))}
        />

        <Text style={styles.label}>Stars</Text>
        <RangeSlider
          steps={MAX_STARS}
          low={starsLo}
          high={starsHi}
          ends={["★", "★".repeat(MAX_STARS)]}
          label={(lo, hi) =>
            lo === 0 && hi === MAX_STARS - 1
              ? "Any rating, unrated included"
              : lo === hi
                ? `${stars(lo)} only`
                : `${stars(lo)} – ${stars(hi)}`
          }
          onChange={(lo, hi) =>
            set({ minStars: lo === 0 ? null : lo + 1, maxStars: hi === MAX_STARS - 1 ? null : hi + 1 })
          }
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
