import { useEffect } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import * as board from "../lib/board";
import { boardLabel, protocolFor, shortId, signalOf } from "../lib/boardName";
import { getSetting, setSetting } from "../lib/db/repo";
import type { Db } from "../lib/db/types";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";
import { useConnection } from "./ConnectChip";

/** The phone setting holding the board a wall last connected to, by Bluetooth id. */
export const wallBoardKey = (wallId: string) => `wallBoard:${wallId}`;

/**
 * Connects for a wall, preferring the board it used last (see board.connect).
 * With ask, lists every board in range instead, to switch boards.
 */
export async function connectForWall(db: Db, wallId: string, ask = false): Promise<void> {
  await board.connect((await getSetting(db, wallBoardKey(wallId))) ?? null, { ask });
}

const SIGNAL_BARS = { strong: "▂▄▆", good: "▂▄", weak: "▂" } as const;

/**
 * Asks which board to connect to, when several are in range or the wall's own
 * is not, and remembers the board each wall connects to. Mounted once, at the
 * root.
 */
export function BoardPicker() {
  const { db, wall } = useApp();
  const conn = useConnection();
  const connectedId = conn.status === "connected" ? conn.id : null;

  /* Whatever this wall connects to becomes its board, picked or not. */
  useEffect(() => {
    if (connectedId) void setSetting(db, wallBoardKey(wall.id), connectedId);
  }, [db, wall.id, connectedId]);

  if (conn.status !== "choosing") return null;
  const missing = conn.preferred !== null && !conn.boards.some((b) => b.id === conn.preferred);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={board.cancelChoice}>
      <Pressable style={styles.backdrop} onPress={board.cancelChoice}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>Which board?</Text>
          <Text style={styles.dim}>
            {missing
              ? `${wall.name}'s usual board isn't in range. Nearest first:`
              : conn.boards.length === 1
                ? "1 board in range:"
                : `${conn.boards.length} boards in range, nearest first:`}
          </Text>

          <ScrollView style={styles.list} contentContainerStyle={{ gap: 8 }}>
            {conn.boards.map((b) => {
              const signal = signalOf(b.rssi);
              const ours = b.id === conn.preferred;
              const kind = protocolFor(b.name) === "openboard" ? "OpenBoard" : boardLabel(b.name);
              return (
                <Pressable
                  key={b.id}
                  accessibilityRole="button"
                  style={[styles.row, ours && styles.rowOurs]}
                  onPress={() => void board.chooseBoard(b.id)}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {boardLabel(b.name)}
                    </Text>
                    <Text style={styles.dim} numberOfLines={1}>
                      {ours ? "this wall's board · " : ""}
                      {kind !== boardLabel(b.name) ? `${kind} · ` : ""}ends {shortId(b.id)}
                    </Text>
                  </View>
                  {signal ? (
                    <View style={styles.signal}>
                      <Text style={styles.bars}>{SIGNAL_BARS[signal]}</Text>
                      <Text style={styles.dim}>{signal}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable style={styles.cancel} onPress={board.cancelChoice}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
  card: { backgroundColor: theme.panel, borderRadius: 14, padding: 16, gap: 10, maxHeight: "80%" },
  title: { color: theme.text, fontSize: 18, fontWeight: "700" },
  dim: { color: theme.dim, fontSize: 13 },
  list: { flexGrow: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.bg,
  },
  rowOurs: { borderColor: theme.accent },
  name: { color: theme.text, fontSize: 16, fontWeight: "600" },
  signal: { alignItems: "flex-end" },
  bars: { color: theme.good, fontSize: 14, letterSpacing: 1 },
  cancel: { alignItems: "center", paddingVertical: 10 },
  cancelText: { color: theme.accent, fontSize: 15, fontWeight: "600" },
});
