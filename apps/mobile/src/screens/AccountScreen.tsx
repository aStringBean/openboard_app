import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "../components/useSession";
import { CommitTextInput } from "../components/CommitTextInput";
import { friendlyAuthError, getDisplayName, sendCode, setDisplayName, signOut, verifyCode } from "../lib/cloud";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

/**
 * Sign-in is two steps — email, then the 6-digit code emailed to it — with
 * no password to forget and no link to open. Other providers (Google, Apple)
 * slot in above the email form once their credentials exist.
 */
export function AccountScreen() {
  const { known, session } = useSession();

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: "Account" }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!known ? (
          <ActivityIndicator color={theme.accent} />
        ) : session ? (
          <SignedIn email={session.user.email ?? ""} />
        ) : (
          <SignIn />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const send = () =>
    run(async () => {
      await sendCode(email);
      setSentTo(email.trim());
      setCode("");
    });

  const verify = () => run(() => verifyCode(sentTo!, code));

  return (
    <View style={styles.gap}>
      <Text style={styles.title}>Sign in</Text>
      <Text style={styles.dim}>
        Needed to share a wall with friends and sync problems between phones. Everything you have set up so
        far stays on this phone either way.
      </Text>
      <OtherAccountNote />

      {sentTo === null ? (
        <>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={theme.dim}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <Pressable style={[styles.btn, styles.primary, (!email.includes("@") || busy) && styles.disabled]} onPress={send} disabled={!email.includes("@") || busy}>
            <Text style={styles.primaryText}>{busy ? "Sending…" : "Email me a code"}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.dim}>We sent a 6-digit code to {sentTo}.</Text>
          <TextInput
            style={[styles.input, styles.code]}
            placeholder="000000"
            placeholderTextColor={theme.line}
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            onSubmitEditing={verify}
            autoFocus
          />
          <Pressable style={[styles.btn, styles.primary, (code.length !== 6 || busy) && styles.disabled]} onPress={verify} disabled={code.length !== 6 || busy}>
            <Text style={styles.primaryText}>{busy ? "Checking…" : "Sign in"}</Text>
          </Pressable>
          <View style={styles.row}>
            <Pressable hitSlop={8} onPress={send} disabled={busy}>
              <Text style={styles.link}>Send a new code</Text>
            </Pressable>
            <Pressable hitSlop={8} onPress={() => { setSentTo(null); setError(null); }}>
              <Text style={styles.link}>Use a different email</Text>
            </Pressable>
          </View>
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/** Before a different account signs in, say what happens to the shared walls here. */
function OtherAccountNote() {
  const { sharedWallsOf } = useApp();
  if (!sharedWallsOf) return null;
  return (
    <Text style={styles.warn}>
      This phone has shared walls for {sharedWallsOf}. Signing in with a different account takes them off this
      phone; they stay on the server, and come back when {sharedWallsOf} signs in here again.
    </Text>
  );
}

function SignedIn({ email }: { email: string }) {
  const { db } = useApp();
  const [name, setName] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getDisplayName().then(setName, () => setName(""));
  }, []);

  return (
    <View style={styles.gap}>
      <Text style={styles.title}>Signed in</Text>
      <Text style={styles.dim}>{email}</Text>

      <Text style={styles.label}>Your name, as other climbers see it</Text>
      {name === null ? (
        <ActivityIndicator color={theme.accent} />
      ) : (
        <CommitTextInput
          style={styles.input}
          initial={name}
          onChangeText={() => setSaved(false)}
          onCommit={async (text) => {
            const n = text.trim();
            if (!n) return;
            try {
              await setDisplayName(n);
              setSaved(true);
            } catch (err) {
              Alert.alert("Could not save your name", friendlyAuthError(err));
            }
          }}
          maxLength={40}
        />
      )}
      {saved ? <Text style={styles.ok}>Saved</Text> : null}

      <Pressable
        style={[styles.btn, { marginTop: 16 }]}
        onPress={async () => {
          const unsent = (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM outbox"))?.n ?? 0;
          Alert.alert(
            "Sign out?",
            `Your walls and problems stay on this phone.${
              unsent
                ? ` ${unsent} change${unsent > 1 ? "s haven't" : " hasn't"} reached the server yet, and will go up when you sign back in as ${email}.`
                : ""
            }`,
            [
              { text: "Cancel", style: "cancel" },
              { text: "Sign out", style: "destructive", onPress: () => void signOut() },
            ],
          );
        }}
      >
        <Text style={[styles.btnText, { color: theme.danger }]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { padding: 16 },
  gap: { gap: 10 },
  title: { color: theme.text, fontSize: 20, fontWeight: "700" },
  label: { color: theme.dim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8 },
  dim: { color: theme.dim, fontSize: 14 },
  input: {
    color: theme.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: theme.panel,
  },
  code: { fontSize: 28, letterSpacing: 10, textAlign: "center", fontWeight: "700" },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  link: { color: theme.accent, fontSize: 14, fontWeight: "600" },
  warn: { color: theme.warn, fontSize: 13, lineHeight: 18 },
  error: { color: theme.danger, fontSize: 14 },
  ok: { color: theme.good, fontSize: 13 },
  btn: {
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    paddingVertical: 13,
    backgroundColor: theme.panel,
  },
  btnText: { color: theme.text, fontSize: 15, fontWeight: "500" },
  primary: { backgroundColor: theme.accent, borderColor: theme.accent },
  primaryText: { color: "#06101f", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.4 },
});
