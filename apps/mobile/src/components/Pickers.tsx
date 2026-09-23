import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { chooseGrade, gradeBound, gradeOptions, optionMatches, type GradeOption, type GradeScale } from "../lib/grades";
import { ROLE_STYLE, ROLES, type Role } from "../lib/problem";
import { theme } from "../theme";

/** A horizontally scrolling row of choices. */
function Chips<T>({
  options,
  selected,
  label,
  onPick,
  colour,
}: {
  options: readonly T[];
  selected: (o: T) => boolean;
  label: (o: T) => string;
  onPick: (o: T) => void;
  colour?: (o: T) => string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {options.map((o) => {
        const on = selected(o);
        const c = colour?.(o) ?? theme.accent;
        return (
          <Pressable
            key={label(o)}
            onPress={() => onPick(o)}
            style={[styles.chip, on && { borderColor: c, backgroundColor: `${c}26` }]}
          >
            <Text style={[styles.chipText, on && { color: theme.text, fontWeight: "700" }]}>{label(o)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function GradePicker({
  value,
  scale,
  onChange,
}: {
  value: number;
  scale: GradeScale;
  onChange: (grade: number) => void;
}) {
  return (
    <Chips
      options={gradeOptions(scale)}
      selected={(o) => optionMatches(value, o, scale)}
      label={(o) => o.label}
      onPick={(o) => onChange(chooseGrade(value, o, scale))}
    />
  );
}

export function AnglePicker({
  angles,
  value,
  onChange,
}: {
  angles: readonly number[];
  value: number;
  onChange: (angle: number) => void;
}) {
  return <Chips options={angles} selected={(a) => a === value} label={(a) => `${a}°`} onPick={onChange} />;
}

/** The role new taps will give a hold, each with its count in the problem so far. */
export function RolePalette({
  active,
  counts,
  onSelect,
}: {
  active: Role;
  counts: Record<Role, number>;
  onSelect: (role: Role) => void;
}) {
  return (
    <View style={styles.palette}>
      {ROLES.map((role) => {
        const { label, ui } = ROLE_STYLE[role];
        const on = role === active;
        return (
          <Pressable
            key={role}
            onPress={() => onSelect(role)}
            style={[styles.role, { borderColor: on ? ui : theme.line }, on && { backgroundColor: `${ui}26` }]}
          >
            <View style={[styles.swatch, { backgroundColor: ui }]} />
            <Text style={[styles.roleText, on && { color: theme.text }]} numberOfLines={1}>
              {label}
            </Text>
            <Text style={styles.count}>{counts[role]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6, paddingVertical: 2 },
  chip: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: theme.panel,
  },
  chipText: { color: theme.dim, fontSize: 13, fontWeight: "500" },
  palette: { flexDirection: "row", gap: 5 },
  role: {
    flex: 1,
    alignItems: "center",
    gap: 3,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingVertical: 7,
    backgroundColor: theme.panel,
  },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  roleText: { color: theme.dim, fontSize: 11, fontWeight: "600" },
  count: { color: theme.dim, fontSize: 11 },
  stars: { flexDirection: "row", alignItems: "center", gap: 10 },
  star: { fontSize: 32, color: theme.line },
  starOn: { color: "#ffc94d" },
  segmented: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 9,
    overflow: "hidden",
  },
  segment: { flex: 1, alignItems: "center", paddingVertical: 10, backgroundColor: theme.panel },
  segmentOn: { backgroundColor: theme.accent },
  segmentText: { color: theme.dim, fontSize: 14, fontWeight: "500" },
  segmentTextOn: { color: "#06101f", fontWeight: "700" },
});

/** Tappable stars: tap one to set, tap the current value again to clear. */
export function StarsInput({ value, onChange, max = 3 }: { value: number | null; onChange: (v: number | null) => void; max?: number }) {
  return (
    <View style={styles.stars}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <Pressable key={n} hitSlop={6} onPress={() => onChange(value === n ? null : n)}>
          <Text style={[styles.star, value !== null && n <= value && styles.starOn]}>★</Text>
        </Pressable>
      ))}
      <Text style={styles.chipText}>{value === null ? "No rating" : ""}</Text>
    </View>
  );
}

/** Stars as text: filled to the rounded value, e.g. ★★☆. Empty string for no rating. */
export function starsText(value: number | null, max = 3): string {
  if (value === null) return "";
  const n = Math.round(value);
  return "★".repeat(n) + "☆".repeat(Math.max(0, max - n));
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable
          key={String(o.value)}
          style={[styles.segment, o.value === value && styles.segmentOn]}
          onPress={() => onChange(o.value)}
        >
          <Text style={[styles.segmentText, o.value === value && styles.segmentTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** One end of a grade range: any grade, or a bound. */
export function GradeBoundPicker({
  value,
  scale,
  end,
  onChange,
}: {
  value: number | null;
  scale: GradeScale;
  end: "min" | "max";
  onChange: (v: number | null) => void;
}) {
  const options: (GradeOption | null)[] = [null, ...gradeOptions(scale)];
  return (
    <Chips
      options={options}
      selected={(o) => (o === null ? value === null : value !== null && optionMatches(value, o, scale))}
      label={(o) => (o === null ? "Any" : o.label)}
      onPick={(o) => onChange(o === null ? null : gradeBound(o, scale, end))}
    />
  );
}
