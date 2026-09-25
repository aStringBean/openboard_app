import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "../components/useSession";
import { cloud } from "../lib/cloud";
import { joinWall } from "../lib/sync";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";
import { cleanCode } from "./WallsScreen";

/**
 * Where an invite lands: from a scanned QR code or a shared link
 * (openboard://join/CODE), or a code typed on the Walls screen. Joining is
 * a deliberate tap, never automatic on opening a link.
 */
export function JoinScreen() {
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = cleanCode(raw ?? "");
  const { db, reloadWalls, switchWall } = useApp();
  const { known, session } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const wallId = await joinWall(db, cloud, code);
      await reloadWalls();
      await switchWall(wallId);
      router.dismissTo("/");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        /not valid/i.test(msg)
          ? "That invite code isn't valid. It may have expired — ask for a new one."
          : /fetch|network/i.test(msg)
            ? "Can't reach the server. Check your connection."
            : msg,
      );
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: "Join a wall" }} />
      <View style={styles.body}>
        <Text style={styles.dim}>Invite code</Text>
        <Text style={styles.code}>{code}</Text>

        {!known ? (
          <ActivityIndicator color={theme.accent} />
        ) : !session ? (
          <>
            <Text style={styles.text}>Sign in first, so the wall knows who you are. Then open the invite again.</Text>
            <Pressable style={[styles.btn, styles.primary]} onPress={() => router.push("/account")}>
              <Text style={styles.primaryText}>Sign in</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.text}>
              You&apos;ll see the wall&apos;s problems and can tick and comment on them. Whether you can set problems
              is up to the wall&apos;s owner.
            </Text>
            <Pressable style={[styles.btn, styles.primary]} onPress={join} disabled={busy}>
              <Text style={styles.primaryText}>{busy ? "Joining…" : "Join wall"}</Text>
            </Pressable>
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { padding: 20, gap: 12 },
  code: { color: theme.text, fontSize: 30, fontWeight: "700", letterSpacing: 5 },
  text: { color: theme.text, fontSize: 15, lineHeight: 21 },
  dim: { color: theme.dim, fontSize: 13 },
  error: { color: theme.danger, fontSize: 14 },
  btn: { alignItems: "center", borderRadius: 10, paddingVertical: 13 },
  primary: { backgroundColor: theme.accent },
  primaryText: { color: "#06101f", fontSize: 15, fontWeight: "700" },
});
