import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProblemRow } from "../components/ProblemRow";
import { CommitTextInput } from "../components/CommitTextInput";
import type { ProblemSummary } from "../lib/catalog";
import { deleteList, getList, listProblems, renameList, setListItems } from "../lib/db/repo";
import { move } from "../lib/order";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

export function ListDetailScreen() {
  const { db, wall, gradeScale } = useApp();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState("");
  const [items, setItems] = useState<ProblemSummary[] | null>(null);

  const reload = useCallback(() => {
    let live = true;
    Promise.all([getList(db, id), listProblems(db, wall.id)]).then(([list, all]) => {
      if (!live || !list) return;
      const byId = new Map(all.map((p) => [p.id, p]));
      setName(list.name);
      setItems(list.problemIds.map((pid) => byId.get(pid)).filter((p): p is ProblemSummary => Boolean(p)));
    });
    return () => {
      live = false;
    };
  }, [db, id, wall.id]);

  useFocusEffect(reload);

  /* Every change rewrites the list's order in one go, so it is shown at once
   * and stored as a whole. */
  const reorder = async (next: ProblemSummary[]) => {
    setItems(next);
    await setListItems(db, id, next.map((p) => p.id));
  };

  const remove = () =>
    Alert.alert("Delete list?", `"${name}" goes; its problems stay.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteList(db, id);
          router.back();
        },
      },
    ]);

  const adjustable = wall.angleMode === "adjustable";

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: name || "List" }} />

      <View style={styles.head}>
        <CommitTextInput
          style={styles.input}
          initial={name}
          onChangeText={setName}
          onCommit={(text) => {
            const n = text.trim();
            if (n) void renameList(db, id, n);
          }}
          maxLength={40}
        />
      </View>

      <FlatList
        data={items ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          items ? (
            <Text style={[styles.dim, styles.empty]}>
              Empty. Open any problem and use Lists to add it here.
            </Text>
          ) : null
        }
        renderItem={({ item, index }) => (
          <ProblemRow
            item={item}
            gradeScale={gradeScale}
            showAngle={adjustable}
            onPress={() => router.push(`/problem/${item.id}`)}
            right={
              <View style={styles.reorder}>
                <Pressable
                  hitSlop={6}
                  disabled={index === 0}
                  onPress={() => items && reorder(move(items, index, index - 1))}
                >
                  <Text style={[styles.arrow, index === 0 && styles.arrowOff]}>▲</Text>
                </Pressable>
                <Pressable
                  hitSlop={6}
                  disabled={!items || index === items.length - 1}
                  onPress={() => items && reorder(move(items, index, index + 1))}
                >
                  <Text style={[styles.arrow, items && index === items.length - 1 && styles.arrowOff]}>▼</Text>
                </Pressable>
              </View>
            }
          />
        )}
      />

      <View style={styles.actions}>
        <Pressable style={styles.btn} onPress={remove}>
          <Text style={[styles.btnText, { color: theme.danger }]}>Delete list</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.primary, !items?.length && styles.disabled]}
          disabled={!items?.length}
          onPress={() => router.push(`/list/circuit?id=${id}`)}
        >
          <Text style={styles.primaryText}>Start circuit</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  head: { padding: 12, paddingBottom: 0 },
  input: {
    color: theme.text,
    fontSize: 17,
    fontWeight: "600",
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: theme.panel,
  },
  list: { padding: 12, gap: 8 },
  dim: { color: theme.dim, fontSize: 13 },
  empty: { textAlign: "center", marginTop: 40, paddingHorizontal: 20 },
  reorder: { gap: 6, paddingLeft: 4 },
  arrow: { color: theme.text, fontSize: 16 },
  arrowOff: { color: theme.line },
  actions: { flexDirection: "row", gap: 8, padding: 12 },
  btn: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    paddingVertical: 13,
    backgroundColor: theme.panel,
  },
  btnText: { color: theme.text, fontSize: 14, fontWeight: "500" },
  primary: { backgroundColor: theme.accent, borderColor: theme.accent },
  primaryText: { color: "#06101f", fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.4 },
});
