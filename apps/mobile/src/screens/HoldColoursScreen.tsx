import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConnection } from "../components/ConnectChip";
import * as board from "../lib/board";
import { familyOf } from "../lib/boardName";
import { loadCalibration } from "../lib/db/repo";
import {
  clashingRoles,
  PALETTE,
  rgbHex,
  roleLed,
  ROLE_STYLE,
  ROLES,
  sameRgb,
  withRoleColor,
  type Rgb,
  type Role,
} from "../lib/problem";
import { canEditWall } from "../lib/wall";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

const nameOf = (c: Rgb) => PALETTE.find((p) => sameRgb(p.led, c))?.name ?? "Custom";

/**
 * The colours each role lights in on this wall. The owner chooses; members
 * see the wall's choice. Only changed roles are stored, so a role left alone
 * follows the app's default.
 */
export function HoldColoursScreen() {
  const { db, wall, saveWall } = useApp();
  const conn = useConnection();
  const editable = canEditWall(wall);
  const [open, setOpen] = useState<Role | null>(null);
  const [preview, setPreview] = useState(false);
  /* Five holds whose LEDs sit next to each other on the strip, one per role. */
  const [sample, setSample] = useState<number[]>([]);

  useEffect(() => {
    loadCalibration(db, wall.id).then((c) => {
      const leds = c.holds
        .map((h) => h.led)
        .filter((l): l is number => l !== null)
        .sort((a, b) => a - b);
      setSample(leds.slice(0, ROLES.length));
    });
  }, [db, wall.id]);

  const connected = conn.status === "connected";
  const colors = wall.roleColors;
  const clashes = useMemo(() => clashingRoles(colors), [colors]);

  const light = useCallback(() => {
    void board.send(sample.map((pos, i) => ({ pos, ...roleLed(ROLES[i]!, colors) })));
  }, [sample, colors]);

  /* While previewing, the wall follows every change; leaving turns it off. */
  useEffect(() => {
    if (preview && connected) light();
  }, [preview, connected, light]);
  useEffect(() => () => void board.blank(), []);

  const choose = (role: Role, led: Rgb) => void saveWall({ ...wall, roleColors: withRoleColor(colors, role, led) });

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: "Hold colours" }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.dim}>
          {editable
            ? "What each role lights up in on this wall. Tap a role to change it."
            : "What each role lights up in on this wall, as its owner has chosen."}
        </Text>

        {ROLES.map((role) => {
          const led = roleLed(role, colors);
          const custom = colors[role] !== undefined;
          return (
            <View key={role}>
              <Pressable
                style={[styles.row, open === role && styles.rowOpen]}
                disabled={!editable}
                onPress={() => setOpen(open === role ? null : role)}
              >
                <View style={[styles.swatch, { backgroundColor: rgbHex(led) }]} />
                <Text style={styles.role}>{ROLE_STYLE[role].label}</Text>
                <Text style={[styles.dim, clashes.includes(role) && { color: theme.warn }]}>
                  {nameOf(led)}
                  {custom ? "" : " · default"}
                </Text>
              </Pressable>

              {open === role ? (
                <View style={styles.palette}>
                  {PALETTE.map((p) => {
                    const on = sameRgb(p.led, led);
                    return (
                      <Pressable
                        key={p.name}
                        accessibilityLabel={p.name}
                        style={[styles.chip, on && styles.chipOn]}
                        onPress={() => choose(role, p.led)}
                      >
                        <View style={[styles.chipColour, { backgroundColor: rgbHex(p.led) }]} />
                        <Text style={styles.chipText} numberOfLines={1}>
                          {p.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}

        {clashes.length ? (
          <Text style={styles.warn}>
            {clashes.map((r) => ROLE_STYLE[r].label).join(" and ")} light in the same colour, so climbers
            cannot tell them apart on the wall.
          </Text>
        ) : null}

        {editable && Object.keys(colors).length ? (
          <Pressable style={styles.btn} onPress={() => void saveWall({ ...wall, roleColors: {} })}>
            <Text style={styles.btnText}>Back to the default colours</Text>
          </Pressable>
        ) : null}

        <Text style={styles.section}>On the wall</Text>
        {!connected ? (
          <Text style={styles.dim}>Connect to the board to see these colours on the wall.</Text>
        ) : (
          <>
            <Pressable
              style={[styles.btn, preview && styles.primary]}
              disabled={sample.length < ROLES.length}
              onPress={() => {
                if (preview) void board.blank();
                setPreview(!preview);
              }}
            >
              <Text style={preview ? styles.primaryText : styles.btnText}>
                {preview ? "Stop showing" : "Show on the wall"}
              </Text>
            </Pressable>
            <Text style={styles.dim}>
              {sample.length < ROLES.length
                ? "Map at least five holds to LEDs first."
                : `Lights LEDs ${sample.join(", ")}, side by side, in ${ROLES.map((r) =>
                    ROLE_STYLE[r].label.toLowerCase(),
                  ).join(", ")} order.`}
            </Text>
            {conn.protocol === "aurora" ? (
              <Text style={styles.warn}>
                The board is in {familyOf(conn.name)} mode, which only carries a few colours
                exactly; others show as the nearest it can. In OpenBoard mode every colour shows true.
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { padding: 16, gap: 10 },
  section: { color: theme.text, fontSize: 17, fontWeight: "700", marginTop: 12 },
  dim: { color: theme.dim, fontSize: 13 },
  warn: { color: theme.warn, fontSize: 13 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.panel,
  },
  rowOpen: { borderColor: theme.accent },
  swatch: { width: 28, height: 28, borderRadius: 14 },
  role: { color: theme.text, fontSize: 15, fontWeight: "600", flex: 1 },
  palette: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 10 },
  chip: {
    width: "22%",
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.line,
  },
  chipOn: { borderColor: theme.text, backgroundColor: theme.panel },
  chipColour: { width: 26, height: 26, borderRadius: 13 },
  chipText: { color: theme.dim, fontSize: 11 },
  btn: {
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    paddingVertical: 12,
    backgroundColor: theme.panel,
  },
  btnText: { color: theme.text, fontSize: 14, fontWeight: "500" },
  primary: { backgroundColor: theme.accent, borderColor: theme.accent },
  primaryText: { color: "#06101f", fontSize: 14, fontWeight: "700" },
});
