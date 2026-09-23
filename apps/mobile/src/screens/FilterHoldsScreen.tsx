import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useFitCanvas } from "../components/useFitCanvas";
import { WallCanvas } from "../components/WallCanvas";
import { holdNear, type Calibration } from "../lib/calibration";
import { loadCalibration, usedHoldIds } from "../lib/db/repo";
import type { Role } from "../lib/problem";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

const HIT_PX = 24;

/** Pick the holds a problem must use. Only holds some problem uses can be picked. */
export function FilterHoldsScreen() {
  const { db, wall, filter, setFilter } = useApp();
  const router = useRouter();
  const [cal, setCal] = useState<Calibration | null>(null);
  const [picked, setPicked] = useState<number[]>(filter.holdIds);
  const { onLayout: onCanvasLayout, width: canvasWidth, height: canvasHeight } = useFitCanvas(cal?.photoAspect);

  useEffect(() => {
    Promise.all([loadCalibration(db, wall.id), usedHoldIds(db, wall.id)]).then(([c, used]) => {
      /* Holds no problem uses can only ever filter the list down to nothing,
       * so they are left off rather than offered as traps. */
      setCal({ ...c, holds: c.holds.filter((h) => used.has(h.id)) });
    });
  }, [db, wall.id]);

  const roles = useMemo(() => new Map<number, Role>(picked.map((id) => [id, "hand"])), [picked]);

  const onTap = useCallback(
    (x: number, y: number, zoom: number) => {
      if (!cal) return;
      const hit = holdNear(cal, x, y, { width: canvasWidth, height: canvasHeight, zoom, hitPx: HIT_PX });
      if (!hit) return;
      setPicked((p) => (p.includes(hit.id) ? p.filter((id) => id !== hit.id) : [...p, hit.id]));
    },
    [cal, canvasWidth, canvasHeight],
  );

  if (!cal) {
    return (
      <View style={[styles.root, styles.centre]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: "Pick holds" }} />

      <View style={styles.canvas} onLayout={onCanvasLayout}>
        {cal.photoUri && canvasWidth > 0 ? (
          <WallCanvas
            photoUri={cal.photoUri}
            width={canvasWidth}
            height={canvasHeight}
            holds={cal.holds}
            problemRoles={roles}
            showUnused
            onTap={onTap}
          />
        ) : null}
      </View>

      <View style={styles.panel}>
        <Text style={styles.dim}>
          {cal.holds.length === 0
            ? "No problems use any holds yet."
            : picked.length
              ? `Showing problems that use all ${picked.length} chosen hold${picked.length > 1 ? "s" : ""}.`
              : "Tap the holds a problem must use. Only holds used by at least one problem are shown."}
        </Text>
        <View style={styles.actions}>
          <Pressable style={styles.btn} onPress={() => setPicked([])}>
            <Text style={styles.btnText}>Clear</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.primary]}
            onPress={() => {
              setFilter({ ...filter, holdIds: picked });
              router.back();
            }}
          >
            <Text style={styles.primaryText}>Use {picked.length || "no"} hold{picked.length === 1 ? "" : "s"}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  centre: { alignItems: "center", justifyContent: "center" },
  canvas: { flex: 1, overflow: "hidden", justifyContent: "center", alignItems: "center" },
  panel: { padding: 12, gap: 10, borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.panel },
  dim: { color: theme.dim, fontSize: 13 },
  actions: { flexDirection: "row", gap: 8 },
  btn: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    paddingVertical: 12,
    backgroundColor: theme.bg,
  },
  btnText: { color: theme.text, fontSize: 14, fontWeight: "500" },
  primary: { backgroundColor: theme.accent, borderColor: theme.accent },
  primaryText: { color: "#06101f", fontSize: 14, fontWeight: "700" },
});
