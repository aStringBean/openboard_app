import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { createList, listLists, listsContaining, toggleInList, type ListSummary } from "../lib/db/repo";
import { newId } from "../lib/problem";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

/** Puts one problem into, or takes it out of, any of the wall's lists. */
export function ProblemListsScreen() {
  const { db, wall } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [inLists, setInLists] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");

  const reload = useCallback(() => {
    let live = true;
    Promise.all([listLists(db, wall.id), listsContaining(db, id)]).then(([l, c]) => {
      if (!live) return;
      setLists(l);
      setInLists(c);
    });
    return () => {
      live = false;
    };
  }, [db, id, wall.id]);

  useFocusEffect(reload);

  const toggle = async (listId: string) => {
    await toggleInList(db, listId, id);
    reload();
  };

  /* A list made from here starts with this problem in it. */
  const create = async () => {
    if (!name.trim()) return;
    const listId = newId();
    await createList(db, listId, wall.id, name);
    await toggleInList(db, listId, id);
    setName("");
    reload();
  };

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: "Add to lists" }} />

      <View style={styles.newRow}>
        <TextInput
          style={styles.input}
          placeholder="New list"
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
        ListEmptyComponent={lists ? <Text style={[styles.dim, styles.empty]}>No lists yet — make one above.</Text> : null}
        renderItem={({ item }) => {
          const on = inLists.has(item.id);
          return (
            <Pressable style={[styles.row, on && styles.rowOn]} onPress={() => toggle(item.id)}>
              <View style={[styles.check, on && styles.checkOn]}>
                <Text style={styles.checkText}>{on ? "✓" : ""}</Text>
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.dim}>{item.count}</Text>
            </Pressable>
          );
        }}
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
    gap: 12,
    padding: 14,
    borderRadius: 10,
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
  },
  rowOn: { borderColor: theme.good },
  check: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: theme.line,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { borderColor: theme.good, backgroundColor: "rgba(61,220,132,0.18)" },
  checkText: { color: theme.good, fontSize: 14, fontWeight: "800" },
  name: { flex: 1, color: theme.text, fontSize: 16, fontWeight: "600" },
  dim: { color: theme.dim, fontSize: 13 },
  empty: { textAlign: "center", marginTop: 40 },
});
