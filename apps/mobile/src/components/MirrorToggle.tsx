import { Pressable, StyleSheet, Text } from "react-native";
import Svg, { Line, Path } from "react-native-svg";

import { theme } from "../theme";

/** A flip: a dashed centre line between two triangles, the filled one on the side being shown. */
function FlipIcon({ mirrored, color }: { mirrored: boolean; color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Line x1={12} y1={3} x2={12} y2={21} stroke={color} strokeWidth={1.5} strokeDasharray="2 2" />
      <Path
        d="M9.5 6 L3 18 H9.5 Z"
        fill={mirrored ? "none" : color}
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <Path
        d="M14.5 6 L21 18 H14.5 Z"
        fill={mirrored ? color : "none"}
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** One button that flips a problem between as set and mirrored, saying which it is showing. */
export function MirrorToggle({ mirrored, onChange }: { mirrored: boolean; onChange: (mirrored: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Mirrored"
      accessibilityState={{ checked: mirrored }}
      style={[styles.btn, mirrored && styles.on]}
      onPress={() => onChange(!mirrored)}
    >
      <FlipIcon mirrored={mirrored} color={mirrored ? ON_TEXT : theme.text} />
      <Text style={[styles.text, mirrored && styles.onText]}>{mirrored ? "Mirrored" : "As set"}</Text>
    </Pressable>
  );
}

/* Dark text on the accent, as the app's primary buttons have. */
const ON_TEXT = "#06101f";

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: theme.bg,
  },
  on: { backgroundColor: theme.accent, borderColor: theme.accent },
  text: { color: theme.text, fontSize: 14, fontWeight: "500" },
  onText: { color: ON_TEXT, fontWeight: "700" },
});
