import { useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import * as board from "../lib/board";
import { theme } from "../theme";

export function useConnection(): board.ConnectionState {
  return useSyncExternalStore(board.subscribeConnection, board.getConnection);
}

const label = (c: board.ConnectionState): string => {
  switch (c.status) {
    case "connected":
      return `${c.name.replace(/#.*$/, "")} · MTU ${c.mtu}`;
    case "scanning":
      return "scanning…";
    case "connecting":
      return "connecting…";
    case "error":
      return "retry";
    default:
      return "connect";
  }
};

/** Board connection, in every screen's header. Tap to connect or disconnect. */
export function ConnectChip() {
  const conn = useConnection();
  const on = conn.status === "connected";

  return (
    <Pressable
      hitSlop={8}
      style={[styles.chip, on && styles.on, conn.status === "error" && styles.err]}
      onPress={() => (on ? board.disconnect() : board.connect())}
    >
      <Text style={[styles.text, on && styles.onText]} numberOfLines={1}>
        {label(conn)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 5,
    maxWidth: 190,
  },
  on: { borderColor: theme.good },
  err: { borderColor: theme.danger },
  text: { color: theme.dim, fontSize: 12 },
  onText: { color: theme.good },
});
