import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { starsText } from "./Pickers";
import type { ProblemSummary } from "../lib/catalog";
import { gradeLabel, type GradeScale } from "../lib/grades";
import { theme } from "../theme";

/** One problem in a list: ticked state, name, grade and stars. */
export function ProblemRow({
  item,
  gradeScale,
  showAngle,
  dimmed,
  onPress,
  right,
}: {
  item: ProblemSummary;
  gradeScale: GradeScale;
  showAngle: boolean;
  dimmed?: boolean;
  onPress: () => void;
  /** Extra controls at the end of the row, such as reorder buttons. */
  right?: ReactNode;
}) {
  return (
    <Pressable style={[styles.row, dimmed && styles.dimmed]} onPress={onPress}>
      <View style={[styles.tickMark, item.ticked && styles.tickMarkOn]}>
        <Text style={styles.tickMarkText}>{item.flashed ? "⚡" : item.ticked ? "✓" : ""}</Text>
      </View>
      <View style={styles.main}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.dim}>
          {item.holdIds.length} holds
          {item.ascents ? ` · ${item.ascents} ascent${item.ascents > 1 ? "s" : ""}` : ""}
          {showAngle ? ` · ${item.angle}°` : ""}
        </Text>
      </View>
      <View style={styles.gradeBox}>
        <Text style={styles.grade}>{gradeLabel(item.consensus, gradeScale)}</Text>
        {item.stars !== null ? <Text style={styles.stars}>{starsText(item.stars)}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
  },
  /* Set at another angle: still listed, but visibly not for the wall as it is. */
  dimmed: { opacity: 0.45 },
  main: { flex: 1, gap: 2 },
  name: { color: theme.text, fontSize: 16, fontWeight: "600" },
  dim: { color: theme.dim, fontSize: 13 },
  gradeBox: { alignItems: "flex-end" },
  grade: { color: theme.text, fontSize: 17, fontWeight: "700" },
  stars: { color: "#ffc94d", fontSize: 13 },
  /* Ticked problems carry a check (or a bolt for a flash); unticked ones an
   * empty circle, so the column lines up either way. */
  tickMark: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: theme.line,
    alignItems: "center",
    justifyContent: "center",
  },
  tickMarkOn: { borderColor: theme.good, backgroundColor: "rgba(61,220,132,0.18)" },
  tickMarkText: { color: theme.good, fontSize: 13, fontWeight: "800" },
});
