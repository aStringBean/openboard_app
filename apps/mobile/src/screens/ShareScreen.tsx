import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";

import { Segmented } from "../components/Pickers";
import { useFocusReload } from "../components/useFocusReload";
import { cloud, getDisplayName } from "../lib/cloud";
import { listMembers, type Member, type OutboxEntry } from "../lib/db/repo";
import type { Db } from "../lib/db/types";
import { createInvite, inviteLink, outboxState, publishWall, removeMember, setMemberRole } from "../lib/sync";
import type { SetterPolicy } from "../lib/wall";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

const ROLE_TEXT = { owner: "Owner", setter: "Setter", climber: "Climber" } as const;

/** What a queued change is about, in words: 'Problem "Crimp city"', 'Ascent of "Crimp city"'. */
async function describe(db: Db, e: OutboxEntry): Promise<string> {
  const name = async (sql: string) => (await db.get<{ name: string }>(sql, [e.id]))?.name;
  const n =
    e.kind === "problem"
      ? await name("SELECT name FROM problem WHERE id = ?")
      : e.kind === "list"
        ? await name("SELECT name FROM list WHERE id = ?")
        : e.kind === "tick"
          ? await name("SELECT p.name FROM tick t JOIN problem p ON p.id = t.problem_id WHERE t.id = ?")
          : e.kind === "comment"
            ? await name("SELECT p.name FROM comment c JOIN problem p ON p.id = c.problem_id WHERE c.id = ?")
            : undefined;
  const label = {
    problem: "Problem",
    list: "List",
    tick: "Ascent of",
    comment: "Comment on",
    wall: "Wall",
    holds: "Holds",
    photo: "Photo",
  }[e.kind];
  return n === undefined ? label : `${label} "${n}"`;
}

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(t).toLocaleString();
};

export function ShareScreen() {
  const app = useApp();
  const { db, wall, me, sync } = app;
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [refused, setRefused] = useState<{ entry: OutboxEntry; what: string }[]>([]);

  const reload = useCallback(() => {
    let live = true;
    Promise.all([listMembers(db, wall.id), outboxState(db, wall.id)]).then(async ([m, o]) => {
      const named = await Promise.all(o.refused.map(async (entry) => ({ entry, what: await describe(db, entry) })));
      if (!live) return;
      setMembers(m);
      setRefused(named);
    });
    return () => {
      live = false;
    };
  }, [db, wall.id]);
  useFocusReload(reload);

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: "Sharing" }} />
      <ScrollView contentContainerStyle={styles.body}>
        {!wall.cloud ? (
          <Publish />
        ) : (
          <>
            <SyncLine />
            {sync.removed ? <Removed /> : null}
            {refused.length ? (
              <View style={styles.card}>
                <Text style={styles.warnTitle}>
                  {refused.length} change{refused.length > 1 ? "s" : ""} the server refused
                </Text>
                {refused.map(({ entry, what }) => (
                  <Text key={`${entry.kind}:${entry.id}`} style={styles.dim}>
                    {what}: {entry.error}
                  </Text>
                ))}
                <Text style={styles.dim}>They stay on this phone and are tried again at every sync.</Text>
              </View>
            ) : null}

            {wall.role === "owner" ? <OwnerTools members={members} onChanged={reload} /> : null}

            <Text style={styles.section}>Members</Text>
            {members.map((m) => (
              <MemberRow key={m.userId} member={m} onChanged={reload} />
            ))}

            {wall.role !== "owner" && me ? (
              <Pressable
                style={[styles.btn, { marginTop: 16 }]}
                onPress={() =>
                  Alert.alert("Leave this wall?", "It will be removed from this phone. You can join again with an invite.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Leave",
                      style: "destructive",
                      onPress: async () => {
                        try {
                          await removeMember(db, cloud, wall.id, me);
                          await app.forgetWall(wall.id);
                          router.dismissTo("/");
                        } catch (err) {
                          Alert.alert("Could not leave", err instanceof Error ? err.message : String(err));
                        }
                      },
                    },
                  ])
                }
              >
                <Text style={[styles.btnText, { color: theme.danger }]}>Leave wall</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** A wall only on this phone: share it, which needs an account. */
function Publish() {
  const { db, wall, me, reloadWalls } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const publish = async () => {
    if (!me) return;
    setBusy(true);
    try {
      const name = await getDisplayName().catch(() => "");
      await publishWall(db, wall.id, me, name);
      await reloadWalls();
    } catch (err) {
      Alert.alert("Could not share the wall", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{wall.name} is only on this phone</Text>
      <Text style={styles.text}>
        Share it and you can invite others: they see its problems, tick and comment, and — if you let them — set
        their own. Everything already on it, including your ticks, comes along.
      </Text>
      {me ? (
        <Pressable style={[styles.btn, styles.primary]} onPress={publish} disabled={busy}>
          <Text style={styles.primaryText}>{busy ? "Sharing…" : "Share this wall"}</Text>
        </Pressable>
      ) : (
        <Pressable style={[styles.btn, styles.primary]} onPress={() => router.push("/account")}>
          <Text style={styles.primaryText}>Sign in to share</Text>
        </Pressable>
      )}
    </View>
  );
}

function SyncLine() {
  const { sync, syncNow, me } = useApp();
  const router = useRouter();

  if (!me) {
    return (
      <Pressable style={styles.card} onPress={() => router.push("/account")}>
        <Text style={styles.warnTitle}>Signed out</Text>
        <Text style={styles.dim}>Sign in to sync this wall. Changes you make meanwhile wait on this phone.</Text>
      </Pressable>
    );
  }

  const status = sync.running
    ? "Syncing…"
    : sync.offline
      ? "Offline — changes wait on this phone"
      : sync.error
        ? `Sync failed: ${sync.error}`
        : sync.lastAt
          ? `Synced ${ago(sync.lastAt)}`
          : "Not synced yet";

  return (
    <View style={styles.syncRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.dim, (sync.offline || sync.error) && { color: theme.warn }]}>{status}</Text>
        {sync.waiting > sync.refused ? (
          <Text style={styles.dim}>{sync.waiting - sync.refused} change(s) waiting to go up</Text>
        ) : null}
      </View>
      {sync.running ? (
        <ActivityIndicator color={theme.accent} />
      ) : (
        <Pressable style={styles.smallBtn} onPress={() => void syncNow()}>
          <Text style={styles.btnText}>Sync now</Text>
        </Pressable>
      )}
    </View>
  );
}

function Removed() {
  const { wall, forgetWall } = useApp();
  const router = useRouter();
  return (
    <View style={styles.card}>
      <Text style={styles.warnTitle}>You&apos;re no longer a member of {wall.name}</Text>
      <Text style={styles.dim}>The owner removed you, or deleted the wall.</Text>
      <Pressable
        style={styles.btn}
        onPress={async () => {
          await forgetWall(wall.id);
          router.dismissTo("/");
        }}
      >
        <Text style={styles.btnText}>Remove it from this phone</Text>
      </Pressable>
    </View>
  );
}

function OwnerTools({ members, onChanged }: { members: Member[]; onChanged: () => void }) {
  const { wall, saveWall } = useApp();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invite = async () => {
    setBusy(true);
    try {
      setCode(await createInvite(cloud, wall.id));
    } catch (err) {
      Alert.alert("Could not make an invite", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const share = (c: string) =>
    Share.share({
      message: `Join my wall "${wall.name}" on OpenBoard: ${inviteLink(c)}\n\nOr open OpenBoard, tap Walls, and enter the code ${c}.`,
    });

  return (
    <>
      <Text style={styles.section}>Invite</Text>
      {code ? (
        <View style={styles.inviteCard}>
          <View style={styles.qr}>
            <QRCode value={inviteLink(code)} size={200} backgroundColor="#ffffff" color="#000000" />
          </View>
          <Text style={styles.code}>{code}</Text>
          <Text style={styles.dim}>
            Scan with a phone camera, or enter the code in OpenBoard. Works for 30 days, for as many people as you
            like.
          </Text>
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.primary, { flex: 1 }]} onPress={() => share(code)}>
              <Text style={styles.primaryText}>Send invite</Text>
            </Pressable>
            <Pressable style={[styles.btn, { flex: 1 }]} onPress={invite} disabled={busy}>
              <Text style={styles.btnText}>New code</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable style={[styles.btn, styles.primary]} onPress={invite} disabled={busy}>
          <Text style={styles.primaryText}>{busy ? "Making an invite…" : "Invite people"}</Text>
        </Pressable>
      )}

      <Text style={styles.section}>Who can set problems</Text>
      <Segmented<SetterPolicy>
        options={[
          { value: "everyone", label: "Every member" },
          { value: "chosen", label: "Chosen setters" },
        ]}
        value={wall.setterPolicy}
        onChange={(setterPolicy) => void saveWall({ ...wall, setterPolicy }).then(onChanged)}
      />
      <Text style={styles.dim}>
        {wall.setterPolicy === "everyone"
          ? "Anyone who joins can set problems."
          : `Only you and the members you make setters. ${
              members.some((m) => m.role === "setter") ? "" : "Tap a member below to make them one."
            }`}
      </Text>
    </>
  );
}

function MemberRow({ member, onChanged }: { member: Member; onChanged: () => void }) {
  const { db, wall, me, syncNow } = useApp();
  const owner = wall.role === "owner";
  const isMe = member.userId === me;

  const manage = () => {
    if (!owner || member.role === "owner") return;
    const other = member.role === "setter" ? "climber" : "setter";
    const act = (fn: () => Promise<void>) => async () => {
      try {
        await fn();
        onChanged();
        void syncNow();
      } catch (err) {
        Alert.alert("That didn't work", err instanceof Error ? err.message : String(err));
      }
    };
    Alert.alert(member.name || "Member", `${ROLE_TEXT[member.role]} of ${wall.name}`, [
      {
        text: other === "setter" ? "Make a setter" : "Make a climber",
        onPress: act(() => setMemberRole(db, cloud, wall.id, member.userId, other)),
      },
      {
        text: "Remove from wall",
        style: "destructive",
        onPress: act(() => removeMember(db, cloud, wall.id, member.userId)),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <Pressable style={styles.member} onPress={manage} disabled={!owner || member.role === "owner"}>
      <Text style={styles.memberName}>
        {member.name || "Unnamed"}
        {isMe ? " (you)" : ""}
      </Text>
      <Text style={styles.dim}>
        {ROLE_TEXT[member.role]}
        {member.role === "climber" && wall.setterPolicy === "everyone" ? " · can set" : ""}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { padding: 16, gap: 10 },
  section: { color: theme.text, fontSize: 17, fontWeight: "700", marginTop: 12 },
  card: { padding: 14, gap: 8, borderRadius: 12, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.line },
  cardTitle: { color: theme.text, fontSize: 16, fontWeight: "700" },
  warnTitle: { color: theme.warn, fontSize: 15, fontWeight: "600" },
  text: { color: theme.text, fontSize: 14, lineHeight: 20 },
  dim: { color: theme.dim, fontSize: 13 },
  syncRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  inviteCard: { alignItems: "center", gap: 10, padding: 14, borderRadius: 12, backgroundColor: theme.panel },
  qr: { padding: 12, backgroundColor: "#ffffff", borderRadius: 8 },
  code: { color: theme.text, fontSize: 26, fontWeight: "700", letterSpacing: 4 },
  row: { flexDirection: "row", gap: 8, alignSelf: "stretch" },
  member: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    backgroundColor: theme.panel,
  },
  memberName: { color: theme.text, fontSize: 15, fontWeight: "500" },
  btn: {
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    paddingVertical: 12,
    backgroundColor: theme.panel,
  },
  smallBtn: { borderWidth: 1, borderColor: theme.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  btnText: { color: theme.text, fontSize: 14, fontWeight: "500" },
  primary: { backgroundColor: theme.accent, borderColor: theme.accent },
  primaryText: { color: "#06101f", fontSize: 14, fontWeight: "700" },
});
