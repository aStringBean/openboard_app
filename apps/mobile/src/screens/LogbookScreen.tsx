import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { starsText } from "../components/Pickers";
import { useFocusReload } from "../components/useFocusReload";
import { logbook, type LogEntry } from "../lib/db/repo";
import { gradeLabel } from "../lib/grades";
import { isFlash, shortDate } from "../lib/tick";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

/** Every ascent on the wall, newest first. */
export function LogbookScreen() {
  const { db, wall, me, gradeScale } = useApp();
  const router = useRouter();
  const [entries, setEntries] = useState<LogEntry[] | null>(null);

  useFocusReload(
    useCallback(() => {
      let live = true;
      logbook(db, wall.id, me).then((e) => live && setEntries(e));
      return () => {
        live = false;
      };
    }, [db, wall.id, me]),
  );

  const problems = new Set(entries?.map((e) => e.problemId)).size;
  /* A flash is a problem's first ascent in one go. Entries are newest first,
   * so the last entry seen for a problem is its first ascent. */
  const firsts = new Map<string, LogEntry>();
  for (const e of entries ?? []) firsts.set(e.problemId, e);
  const flashes = [...firsts.values()].filter(isFlash).length;

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: "Logbook" }} />

      {entries?.length ? (
        <Text style={styles.summary}>
          {entries.length} ascent{entries.length > 1 ? "s" : ""} of {problems} problem{problems > 1 ? "s" : ""}
          {flashes ? ` · ${flashes} flash${flashes > 1 ? "es" : ""}` : ""}
        </Text>
      ) : null}

      <FlatList
        data={entries ?? []}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          entries ? <Text style={[styles.dim, styles.empty]}>No ascents yet. Tick a problem to log one.</Text> : null
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/problem/${item.problemId}`)}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name} numberOfLines={1}>
                {item.problemName}
              </Text>
              <Text style={styles.dim}>
                {shortDate(item.climbedAt)} · {firsts.get(item.problemId) === item && isFlash(item) ? "flash" : isFlash(item) ? "one go" : `${item.attempts} goes`}
                {wall.angleMode === "adjustable" ? ` · ${item.angle}°` : ""}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              {item.grade !== null ? <Text style={styles.grade}>{gradeLabel(item.grade, gradeScale)}</Text> : null}
              {item.stars !== null ? <Text style={styles.stars}>{starsText(item.stars)}</Text> : null}
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  summary: { color: theme.text, fontSize: 14, paddingHorizontal: 12, paddingTop: 12 },
  list: { padding: 12, gap: 8 },
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
  name: { color: theme.text, fontSize: 15, fontWeight: "600" },
  grade: { color: theme.text, fontSize: 15, fontWeight: "700" },
  stars: { color: "#ffc94d", fontSize: 13 },
  dim: { color: theme.dim, fontSize: 13 },
  empty: { textAlign: "center", marginTop: 40 },
});
