import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "../theme";
import { useConnection } from "./ConnectChip";

const SHOW_MS = 6000;
/* Below the screen header, clear of the main buttons most screens keep at the bottom. */
const HEADER_DP = 64;

/**
 * Says why the board connection ended or failed, when the app did not end it
 * itself: another phone taking the board, or no board in range. Mounted once,
 * at the root; goes after a few seconds, or when tapped.
 */
export function ConnectionNotice() {
  const conn = useConnection();
  const insets = useSafeAreaInsets();
  const text = conn.status === "error" ? conn.message : conn.status === "idle" ? (conn.notice ?? null) : null;
  /* The notice dismissed, so the same one does not come back. */
  const [dismissed, setDismissed] = useState<typeof conn | null>(null);

  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => setDismissed(conn), SHOW_MS);
    return () => clearTimeout(timer);
  }, [conn, text]);

  if (!text || dismissed === conn) return null;

  return (
    <Pressable
      accessibilityRole="alert"
      style={[styles.notice, { top: insets.top + HEADER_DP + 8 }]}
      onPress={() => setDismissed(conn)}
    >
      <Text style={styles.text}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  notice: {
    position: "absolute",
    left: 16,
    right: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.warn,
    backgroundColor: theme.panel,
  },
  text: { color: theme.text, fontSize: 14 },
});
