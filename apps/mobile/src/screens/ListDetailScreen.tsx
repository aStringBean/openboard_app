import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProblemRow } from "../components/ProblemRow";
import { CommitTextInput } from "../components/CommitTextInput";
import { useFocusReload } from "../components/useFocusReload";
import type { ProblemSummary } from "../lib/catalog";
import {
  deleteList,
  getList,
  listProblems,
  memberNames,
  renameList,
  setListItems,
  setListShared,
} from "../lib/db/repo";
import { move } from "../lib/order";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

export function ListDetailScreen() {
  const { db, wall, me, gradeScale } = useApp();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState("");
  const [items, setItems] = useState<ProblemSummary[] | null>(null);
  /* Someone else's list, shared with the wall: yours to use, not to change. */
  const [owner, setOwner] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  const reload = useCallback(() => {
    let live = true;
    Promise.all([getList(db, id), listProblems(db, wall.id, me), memberNames(db, wall.id)]).then(
      ([list, all, names]) => {
        if (!live || !list) return;
        const byId = new Map(all.map((p) => [p.id, p]));
        setName(list.name);
        setShared(list.shared);
        setOwner(list.ownerId !== null && list.ownerId !== me ? names.get(list.ownerId) || "someone" : null);
        setItems(list.problemIds.map((pid) => byId.get(pid)).filter((p): p is ProblemSummary => Boolean(p)));
      },
    );
    return () => {
      live = false;
    };
  }, [db, id, wall.id, me]);

  useFocusReload(reload);

  /* Every change rewrites the list's order in one go, so it is shown at once
   * and stored as a whole. */
  const reorder = async (next: ProblemSummary[]) => {
    setItems(next);
    await setListItems(
      db,
      id,
      next.map((p) => p.id),
    );
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
        {owner !== null ? (
          <Text style={styles.dim}>Shared by {owner}</Text>
        ) : (
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
        )}
        {owner === null && wall.cloud ? (
          <View style={styles.shareRow}>
            <Text style={styles.dim}>Share with everyone on the wall</Text>
            <Switch
              value={shared}
              onValueChange={(v) => {
                setShared(v);
                void setListShared(db, id, v);
              }}
            />
          </View>
        ) : null}
      </View>

      <FlatList
        data={items ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          items ? (
            <Text style={[styles.dim, styles.empty]}>Empty. Open any problem and use Lists to add it here.</Text>
          ) : null
        }
        renderItem={({ item, index }) => (
          <ProblemRow
            item={item}
            gradeScale={gradeScale}
            showAngle={adjustable}
            onPress={() => router.push(`/problem/${item.id}`)}
            right={
              owner !== null ? undefined : (
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
              )
            }
          />
        )}
      />

      <View style={styles.actions}>
        {owner === null ? (
          <Pressable style={styles.btn} onPress={remove}>
            <Text style={[styles.btnText, { color: theme.danger }]}>Delete list</Text>
          </Pressable>
        ) : null}
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
  head: { padding: 12, paddingBottom: 0, gap: 8 },
  shareRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
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
