import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";

import { stripShortfall } from "../lib/strip";
import { theme } from "../theme";
import { useConnection } from "./ConnectChip";

/**
 * While connected to a board whose strip ends before the wall's last LED:
 * says how many holds cannot light, and goes to Settings to fix it. Boards in
 * Aurora mode cannot report their strip length, so never show it.
 */
export function StripWarning({ holds }: { holds: readonly { led: number | null }[] | null }) {
  const conn = useConnection();
  const router = useRouter();

  if (conn.status !== "connected" || conn.chainLength === null || !holds) return null;
  const short = stripShortfall(holds, conn.chainLength);
  if (!short) return null;

  return (
    <Pressable style={styles.banner} onPress={() => router.push("/settings")}>
      <Text style={styles.text}>
        The board drives {conn.chainLength} LEDs but this wall uses {short.needed}, so {short.holdsPast} hold
        {short.holdsPast > 1 ? "s" : ""} can&apos;t light. Tap to set the strip length.
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 12,
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.warn,
    backgroundColor: "rgba(255,176,32,0.12)",
  },
  text: { color: theme.warn, fontSize: 13 },
});
