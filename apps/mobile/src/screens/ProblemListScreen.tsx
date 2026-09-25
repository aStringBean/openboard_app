import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnglePicker } from "../components/Pickers";
import { ProblemRow } from "../components/ProblemRow";
import { useFocusReload } from "../components/useFocusReload";
import { activeFilterCount, applyFilter, DEFAULT_FILTER, SORTS, type ProblemSummary } from "../lib/catalog";
import { loadCalibration, listProblems } from "../lib/db/repo";
import { canEditWall, canSet } from "../lib/wall";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

export function ProblemListScreen() {
  const { db, wall, walls, me, sync, gradeScale, saveWall, filter, setFilter } = useApp();
  const router = useRouter();
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);
  const [wallReady, setWallReady] = useState(true);

  /* Reload whenever the screen comes back into view: a problem may have been
   * added, edited or deleted, or the wall set up, in the meantime. */
  useFocusReload(
    useCallback(() => {
      let live = true;
      Promise.all([listProblems(db, wall.id, me), loadCalibration(db, wall.id)]).then(([list, cal]) => {
        if (!live) return;
        setProblems(list);
        setWallReady(Boolean(cal.photoUri) && cal.holds.length > 0);
      });
      return () => {
        live = false;
      };
    }, [db, wall.id, me]),
  );

  const adjustable = wall.angleMode === "adjustable";
  const shown = useMemo(
    () => (problems ? applyFilter(problems, filter, wall.currentAngle) : []),
    [problems, filter, wall.currentAngle],
  );
  const active = activeFilterCount(filter);

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen
        options={{
          /* The title switches walls, once there is more than one to switch between. */
          headerTitle: () => (
            <Pressable onPress={() => router.push("/walls")} hitSlop={8}>
              <Text style={styles.title} numberOfLines={1}>
                {wall.name} <Text style={styles.titleCaret}>▾</Text>
              </Text>
              {wall.cloud ? (
                <Text style={[styles.subtitle, (sync.offline || sync.refused > 0 || !me) && { color: theme.warn }]}>
                  {!me
                    ? "signed out · not syncing"
                    : sync.running
                      ? "syncing…"
                      : sync.offline
                        ? "offline"
                        : sync.refused
                          ? `${sync.refused} change${sync.refused > 1 ? "s" : ""} refused`
                          : `shared${walls.length > 1 ? "" : " wall"}`}
                </Text>
              ) : null}
            </Pressable>
          ),
        }}
      />

      <View style={styles.toolbar}>
        <Pressable style={styles.tool} onPress={() => router.push("/lists")}>
          <Text style={styles.toolText}>Lists</Text>
        </Pressable>
        <Pressable style={styles.tool} onPress={() => router.push("/logbook")}>
          <Text style={styles.toolText}>Logbook</Text>
        </Pressable>
        <Pressable style={styles.tool} onPress={() => router.push("/share")}>
          <Text style={styles.toolText}>Share</Text>
        </Pressable>
        <Pressable style={styles.tool} onPress={() => router.push("/settings")}>
          <Text style={styles.toolText}>Settings</Text>
        </Pressable>
      </View>

      {adjustable ? (
        <View style={styles.angleBar}>
          <Text style={styles.dim}>Wall is at</Text>
          <AnglePicker
            angles={wall.angles}
            value={wall.currentAngle}
            onChange={(currentAngle) => void saveWall({ ...wall, currentAngle })}
          />
        </View>
      ) : null}

      {wallReady && problems?.length ? (
        <View style={styles.filterBar}>
          <TextInput
            style={styles.search}
            placeholder="Search"
            placeholderTextColor={theme.dim}
            value={filter.search}
            onChangeText={(search) => setFilter({ ...filter, search })}
            returnKeyType="search"
          />
          <Pressable style={[styles.filterBtn, active > 0 && styles.filterBtnOn]} onPress={() => router.push("/filter")}>
            <Text style={[styles.filterText, active > 0 && styles.filterTextOn]}>
              Filters{active ? ` · ${active}` : ""}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {wallReady && problems?.length ? (
        <View style={styles.countRow}>
          <Text style={styles.dim}>
            {shown.length === problems.length ? `${problems.length}` : `${shown.length} of ${problems.length}`}{" "}
            problem{problems.length === 1 ? "" : "s"} · {SORTS.find((x) => x.value === filter.sort)?.label.toLowerCase()}
          </Text>
          {active || filter.search ? (
            <Pressable hitSlop={8} onPress={() => setFilter({ ...DEFAULT_FILTER, sort: filter.sort })}>
              <Text style={styles.clear}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!wallReady && !canEditWall(wall) ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Waiting for the wall</Text>
          <Text style={styles.dim}>
            {sync.running
              ? "Fetching its photo and holds…"
              : "Its photo and holds come from the wall's owner, once they have set it up."}
          </Text>
        </View>
      ) : !wallReady ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Set up your wall first</Text>
          <Text style={styles.dim}>
            Load a photo of the wall and map its holds to LEDs, then come back to set problems on it.
          </Text>
          <Pressable style={[styles.btn, styles.primary]} onPress={() => router.push("/setup")}>
            <Text style={styles.primaryText}>Set up wall</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            problems ? (
              <Text style={[styles.dim, styles.empty]}>
                {problems.length
                  ? "Nothing matches these filters."
                  : canSet(wall)
                    ? "No problems yet — set the first one."
                    : "No problems yet."}
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <ProblemRow
              item={item}
              gradeScale={gradeScale}
              showAngle={adjustable}
              dimmed={adjustable && item.angle !== wall.currentAngle}
              onPress={() => router.push(`/problem/${item.id}`)}
            />
          )}
        />
      )}

      {wallReady && canSet(wall) ? (
        <Pressable style={[styles.btn, styles.primary, styles.newBtn]} onPress={() => router.push("/problem/edit")}>
          <Text style={styles.primaryText}>New problem</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  toolbar: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  tool: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingVertical: 9,
    backgroundColor: theme.panel,
  },
  toolText: { color: theme.text, fontSize: 13, fontWeight: "500" },
  title: { color: theme.text, fontSize: 18, fontWeight: "600", maxWidth: 220 },
  titleCaret: { color: theme.dim, fontSize: 14 },
  subtitle: { color: theme.dim, fontSize: 11 },
  angleBar: { paddingHorizontal: 12, paddingTop: 10, gap: 6 },
  filterBar: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  search: {
    flex: 1,
    color: theme.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.panel,
  },
  filterBtn: {
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    backgroundColor: theme.panel,
  },
  filterBtnOn: { borderColor: theme.accent, backgroundColor: "rgba(91,157,255,0.15)" },
  filterText: { color: theme.text, fontSize: 14, fontWeight: "500" },
  filterTextOn: { fontWeight: "700" },
  countRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  clear: { color: theme.accent, fontSize: 13, fontWeight: "600" },
  list: { padding: 12, gap: 8 },
  dim: { color: theme.dim, fontSize: 13 },
  empty: { textAlign: "center", marginTop: 40 },
  card: { margin: 12, padding: 16, gap: 10, borderRadius: 12, backgroundColor: theme.panel },
  cardTitle: { color: theme.text, fontSize: 17, fontWeight: "700" },
  btn: { alignItems: "center", borderRadius: 10, paddingVertical: 13 },
  primary: { backgroundColor: theme.accent },
  primaryText: { color: "#06101f", fontSize: 15, fontWeight: "700" },
  newBtn: { marginHorizontal: 12, marginBottom: 10 },
});
