import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { createList, listLists, type ListSummary } from "../lib/db/repo";
import { newId } from "../lib/problem";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

export function ListsScreen() {
  const { db, wall } = useApp();
  const router = useRouter();
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [name, setName] = useState("");

  const reload = useCallback(() => {
    let live = true;
    listLists(db, wall.id).then((l) => live && setLists(l));
    return () => {
      live = false;
    };
  }, [db, wall.id]);

  useFocusEffect(reload);

  const create = async () => {
    if (!name.trim()) return;
    const id = newId();
    await createList(db, id, wall.id, name);
    setName("");
    router.push(`/list/${id}`);
  };

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: "Lists" }} />

      <View style={styles.newRow}>
        <TextInput
          style={styles.input}
          placeholder="New list, e.g. Warm-up circuit"
          placeholderTextColor={theme.dim}
          value={name}
          onChangeText={setName}
          onSubmitEditing={create}
          returnKeyType="done"
          maxLength={40}
        />
        <Pressable style={[styles.add, !name.trim() && styles.disabled]} onPress={create} disabled={!name.trim()}>
          <Text style={styles.addText}>Create</Text>
        </Pressable>
      </View>

      <FlatList
        data={lists ?? []}
        keyExtractor={(l) => l.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          lists ? (
            <Text style={[styles.dim, styles.empty]}>
              No lists yet. Make one for a circuit, a project list, or problems to show a friend.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/list/${item.id}`)}>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.dim}>
              {item.count} problem{item.count === 1 ? "" : "s"}
            </Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  newRow: { flexDirection: "row", gap: 8, padding: 12, paddingBottom: 0 },
  input: {
    flex: 1,
    color: theme.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: theme.panel,
  },
  add: { justifyContent: "center", paddingHorizontal: 16, borderRadius: 8, backgroundColor: theme.accent },
  addText: { color: "#06101f", fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.4 },
  list: { padding: 12, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 14,
    borderRadius: 10,
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
  },
  name: { flex: 1, color: theme.text, fontSize: 16, fontWeight: "600" },
  dim: { color: theme.dim, fontSize: 13 },
  empty: { textAlign: "center", marginTop: 40, paddingHorizontal: 20 },
});
