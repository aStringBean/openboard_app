import { Pressable, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";

import { theme } from "../theme";

/** A light bulb, drawn as an outline. */
function BulbIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path
        d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1V17h5v-1.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path d="M9.5 20h5M10.5 22.5h3" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

/** Lights the problem on the wall again; dimmed while no board is connected. */
export function LightButton({ connected, onPress }: { connected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={connected ? "Light it" : "Not connected"}
      accessibilityState={{ disabled: !connected }}
      hitSlop={6}
      style={[styles.btn, !connected && styles.disabled]}
      onPress={onPress}
      disabled={!connected}
    >
      <BulbIcon color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    backgroundColor: theme.bg,
  },
  disabled: { opacity: 0.45 },
});
