import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useApp } from "../state/AppProvider";
import type { Wall } from "../lib/wall";
import { theme } from "../theme";

const ROLE_LABEL = { owner: "Shared · you own it", setter: "Shared · you set", climber: "Shared" } as const;

/** Codes are typed from a screen or a message: forgive spaces, dashes and a pasted link. */
export function cleanCode(text: string): string {
  const fromLink = /join\/([A-Za-z0-9]+)/.exec(text)?.[1];
  return (fromLink ?? text).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function WallsScreen() {
  const { walls, wall, switchWall, newWall } = useApp();
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const open = async (w: Wall) => {
    await switchWall(w.id);
    router.back();
  };

  const create = async () => {
    try {
      await newWall(name);
      setName("");
      router.back();
    } catch (err) {
      Alert.alert("Could not add the wall", err instanceof Error ? err.message : String(err));
    }
  };

  const join = () => {
    const c = cleanCode(code);
    if (c.length !== 8) return Alert.alert("Invite codes are 8 letters and numbers.");
    router.push(`/join/${c}`);
  };

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: "Walls" }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {walls.map((w) => (
          <Pressable key={w.id} style={[styles.wall, w.id === wall.id && styles.current]} onPress={() => open(w)}>
            <Text style={styles.wallName}>{w.name}</Text>
            <Text style={styles.dim}>
              {w.cloud && w.role ? ROLE_LABEL[w.role] : "On this phone only"}
              {w.id === wall.id ? " · current" : ""}
            </Text>
          </Pressable>
        ))}

        <Text style={styles.section}>Join a wall</Text>
        <Text style={styles.dim}>
          Scan the owner&apos;s QR code with your camera, open the link they sent, or type their code.
        </Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.code]}
            placeholder="ABCD2345"
            placeholderTextColor={theme.dim}
            autoCapitalize="characters"
            autoCorrect={false}
            value={code}
            onChangeText={setCode}
            onSubmitEditing={join}
            returnKeyType="go"
          />
          <Pressable style={[styles.btn, styles.primary]} onPress={join}>
            <Text style={styles.primaryText}>Join</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>Add a wall</Text>
        <Text style={styles.dim}>Another wall of your own. It stays on this phone until you share it.</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Name"
            placeholderTextColor={theme.dim}
            value={name}
            onChangeText={setName}
            maxLength={40}
            onSubmitEditing={create}
          />
          <Pressable style={styles.btn} onPress={create}>
            <Text style={styles.btnText}>Add</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { padding: 16, gap: 10 },
  section: { color: theme.text, fontSize: 17, fontWeight: "700", marginTop: 12 },
  wall: { padding: 12, gap: 2, borderRadius: 10, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel },
  current: { borderColor: theme.accent },
  wallName: { color: theme.text, fontSize: 16, fontWeight: "600" },
  dim: { color: theme.dim, fontSize: 13 },
  row: { flexDirection: "row", gap: 8 },
  input: {
    color: theme.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: theme.panel,
  },
  code: { flex: 1, letterSpacing: 3, fontWeight: "600" },
  btn: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    paddingHorizontal: 18,
    backgroundColor: theme.panel,
  },
  btnText: { color: theme.text, fontSize: 14, fontWeight: "500" },
  primary: { backgroundColor: theme.accent, borderColor: theme.accent },
  primaryText: { color: "#06101f", fontSize: 14, fontWeight: "700" },
});
