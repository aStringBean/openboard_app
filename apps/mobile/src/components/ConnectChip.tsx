import { useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import * as board from "../lib/board";
import { familyOf } from "../lib/boardName";
import { useApp } from "../state/AppProvider";
import { connectForWall } from "./BoardPicker";
import { theme } from "../theme";

export function useConnection(): board.ConnectionState {
  return useSyncExternalStore(board.subscribeConnection, board.getConnection);
}

const label = (c: board.ConnectionState): string => {
  switch (c.status) {
    case "connected":
      /* A named board by its name: the way to tell which board this is. */
      if (c.boardName) return c.boardName;
      return c.info
        ? `OpenBoard ${c.info.firmware.major}.${c.info.firmware.minor}.${c.info.firmware.patch}`
        : `${familyOf(c.name)} · MTU ${c.mtu}`;
    case "scanning":
      return "scanning…";
    case "connecting":
      return "connecting…";
    case "choosing":
      return "choose a board";
    case "error":
      return "retry";
    default:
      return "connect";
  }
};

/** Board connection, in every screen's header. Tap to connect or disconnect; long press to choose a board. */
export function ConnectChip() {
  const { db, wall } = useApp();
  const conn = useConnection();
  const on = conn.status === "connected";

  const connect = (ask = false) => connectForWall(db, wall.id, ask);

  return (
    <Pressable
      hitSlop={8}
      style={[styles.chip, on && styles.on, conn.status === "error" && styles.err]}
      onPress={() => void (on ? board.disconnect() : connect())}
      onLongPress={() => void connect(true)}
      accessibilityHint="Long press to choose from every board in range"
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
