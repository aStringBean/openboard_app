import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConnection } from "../components/ConnectChip";
import { starsText } from "../components/Pickers";
import { useFitCanvas } from "../components/useFitCanvas";
import { WallCanvas } from "../components/WallCanvas";
import { useFocusReload } from "../components/useFocusReload";
import * as board from "../lib/board";
import type { Calibration } from "../lib/calibration";
import {
  deleteComment,
  deleteProblem,
  deleteTick,
  getProblem,
  listComments,
  loadCalibration,
  memberNames,
  saveComment,
  ticksFor,
  type CommentView,
} from "../lib/db/repo";
import { gradeLabel } from "../lib/grades";
import { countRoles, newId, problemFrame, ROLE_STYLE, ROLES, type Problem } from "../lib/problem";
import { averageStars, byAngle, gradeAt, isFlash, shortDate, type Tick } from "../lib/tick";
import { canEditProblem } from "../lib/wall";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

export function ProblemViewScreen() {
  const { db, wall, me, gradeScale } = useApp();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conn = useConnection();

  const [problem, setProblem] = useState<Problem | null | undefined>(undefined);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [cal, setCal] = useState<Calibration | null>(null);
  const [comments, setComments] = useState<CommentView[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [draft, setDraft] = useState("");
  const { onLayout: onCanvasLayout, width: canvasWidth, height: canvasHeight } = useFitCanvas(cal?.photoAspect);

  const reload = useCallback(() => {
    let live = true;
    Promise.all([
      getProblem(db, id),
      ticksFor(db, id),
      loadCalibration(db, wall.id),
      listComments(db, id),
      memberNames(db, wall.id),
    ]).then(([p, t, c, cs, n]) => {
      if (!live) return;
      setProblem(p ?? null);
      setTicks(t);
      setCal(c);
      setComments(cs);
      setNames(n);
    });
    return () => {
      live = false;
    };
  }, [db, id, wall.id]);

  /* Reload on focus, so returning from the editor or a tick shows it. */
  useFocusReload(reload);

  const frame = useMemo(() => (problem && cal ? problemFrame(problem.holds, cal.holds) : null), [problem, cal]);

  const light = useCallback(() => {
    if (frame) void board.send(frame.leds);
  }, [frame]);

  /* Opening a problem lights it; so does connecting while it is open. */
  useEffect(() => {
    if (conn.status === "connected") light();
  }, [conn.status, light]);

  const roles = useMemo(() => new Map(problem?.holds.map((h) => [h.holdId, h.role]) ?? []), [problem]);
  const counts = useMemo(() => countRoles(problem?.holds ?? []), [problem]);

  /* Mine: ticked here before signing in, or by me since. */
  const isMine = (userId: string | null) => userId === null || userId === me;
  const nameOf = (userId: string | null) => (isMine(userId) ? "You" : names.get(userId!) || "Someone");

  const post = async () => {
    const body = draft.trim();
    if (!body) return;
    await saveComment(db, { id: newId(), problemId: id, userId: me, body, createdAt: Date.now() });
    setDraft("");
    reload();
  };

  const removeComment = (c: CommentView) => {
    if (!isMine(c.userId) && !(wall.cloud && wall.role === "owner")) return;
    Alert.alert("Delete this comment?", c.body.slice(0, 80), [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteComment(db, c.id);
          reload();
        },
      },
    ]);
  };

  const remove = () =>
    Alert.alert(
      "Delete problem?",
      `"${problem?.name}"${ticks.length ? ` and its ${ticks.length} logged ascent${ticks.length > 1 ? "s" : ""}` : ""} will be gone for good.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteProblem(db, id);
            void board.blank();
            router.back();
          },
        },
      ],
    );

  const removeTick = (t: Tick) => {
    if (!isMine(t.userId)) return;
    Alert.alert("Delete this ascent?", `${shortDate(t.climbedAt)} · ${isFlash(t) ? "flash" : `${t.attempts} goes`}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteTick(db, t.id);
          reload();
        },
      },
    ]);
  };

  if (problem === null) {
    return (
      <View style={[styles.root, styles.centre]}>
        <Text style={styles.dim}>This problem no longer exists.</Text>
      </View>
    );
  }

  if (!problem || !cal) {
    return (
      <View style={[styles.root, styles.centre]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const consensus = gradeAt(problem, ticks, problem.angle) ?? problem.grade;
  const stars = averageStars(ticks);
  const angles = byAngle(problem, ticks);
  const adjustable = wall.angleMode === "adjustable";
  const connected = conn.status === "connected";
  const editable = canEditProblem(wall, problem.setterId, me);
  const mine = ticks.filter((t) => isMine(t.userId));

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: problem.name }} />

      <View style={styles.canvas} onLayout={onCanvasLayout}>
        {cal.photoUri && canvasWidth > 0 ? (
          <WallCanvas
            photoUri={cal.photoUri}
            width={canvasWidth}
            height={canvasHeight}
            holds={cal.holds}
            problemRoles={roles}
            onTap={() => {}}
          />
        ) : null}
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelInner}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={2}>
              {problem.name}
            </Text>
            {stars !== null ? <Text style={styles.stars}>{starsText(stars)}</Text> : null}
            {wall.cloud ? <Text style={styles.dim}>Set by {nameOf(problem.setterId)}</Text> : null}
          </View>
          <View style={styles.gradeBox}>
            <Text style={styles.grade}>{gradeLabel(consensus, gradeScale)}</Text>
            {consensus !== problem.grade ? (
              <Text style={styles.dim}>set as {gradeLabel(problem.grade, gradeScale)}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.legend}>
          {ROLES.filter((r) => counts[r] > 0).map((r) => (
            <View key={r} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: ROLE_STYLE[r].ui }]} />
              <Text style={styles.dim}>
                {counts[r]} {ROLE_STYLE[r].label.toLowerCase()}
              </Text>
            </View>
          ))}
          {adjustable ? <Text style={styles.dim}>· set at {problem.angle}°</Text> : null}
        </View>

        {adjustable && problem.angle !== wall.currentAngle ? (
          <Text style={styles.note}>
            Set at {problem.angle}°; the wall is at {wall.currentAngle}°, so it will climb differently.
          </Text>
        ) : null}
        {frame && frame.unlit > 0 ? (
          <Text style={styles.note}>
            {frame.unlit} hold{frame.unlit > 1 ? "s have" : " has"} no LED, so won&apos;t light.
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            style={[styles.btn, styles.primary]}
            onPress={() => router.push(`/problem/tick?id=${problem.id}`)}
          >
            <Text style={styles.primaryText}>Tick</Text>
          </Pressable>
          <Pressable style={[styles.btn, !connected && styles.disabled]} onPress={light} disabled={!connected}>
            <Text style={styles.btnText}>{connected ? "Light it" : "Not connected"}</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>
          {ticks.length === 0
            ? "Not climbed yet"
            : `${ticks.length} ascent${ticks.length > 1 ? "s" : ""}${
                mine.length && isFlash(mine[mine.length - 1]!) ? " · you flashed it" : mine.length ? " · ticked" : ""
              }`}
        </Text>

        {adjustable && angles.length > 1
          ? angles.map((a) => (
              <Text key={a.angle} style={styles.dim}>
                {a.angle}°: {a.ascents} ascent{a.ascents === 1 ? "" : "s"}
                {a.grade !== null ? ` · ${gradeLabel(a.grade, gradeScale)}` : ""}
              </Text>
            ))
          : null}

        {ticks.map((t) => (
          <Pressable key={t.id} style={styles.tick} onLongPress={() => removeTick(t)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.tickMain}>
                {wall.cloud ? `${nameOf(t.userId)} · ` : ""}
                {shortDate(t.climbedAt)} · {isFlash(t) ? "one go" : `${t.attempts} goes`}
                {adjustable ? ` · ${t.angle}°` : ""}
              </Text>
              {t.comment ? <Text style={styles.dim}>{t.comment}</Text> : null}
            </View>
            <Text style={styles.tickGrade}>
              {t.grade !== null ? gradeLabel(t.grade, gradeScale) : ""} {starsText(t.stars)}
            </Text>
          </Pressable>
        ))}
        {mine.length ? <Text style={styles.hint}>Long-press one of your ascents to delete it.</Text> : null}

        <Text style={styles.section}>Comments</Text>
        {comments.map((c) => (
          <Pressable key={c.id} style={styles.comment} onLongPress={() => removeComment(c)}>
            <Text style={styles.commentHead}>
              {nameOf(c.userId)} · {shortDate(c.createdAt)}
            </Text>
            <Text style={styles.commentBody}>{c.body}</Text>
          </Pressable>
        ))}
        <View style={styles.commentBar}>
          <TextInput
            style={styles.commentInput}
            placeholder={comments.length ? "Add a comment" : "Beta, conditions, a kind word…"}
            placeholderTextColor={theme.dim}
            value={draft}
            onChangeText={setDraft}
            maxLength={1000}
            multiline
          />
          <Pressable style={[styles.postBtn, !draft.trim() && styles.disabled]} onPress={post} disabled={!draft.trim()}>
            <Text style={styles.primaryText}>Post</Text>
          </Pressable>
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.btn} onPress={() => router.push(`/problem/lists?id=${problem.id}`)}>
            <Text style={styles.btnText}>Lists</Text>
          </Pressable>
          {editable ? (
            <Pressable style={styles.btn} onPress={() => router.push(`/problem/edit?id=${problem.id}`)}>
              <Text style={styles.btnText}>Edit</Text>
            </Pressable>
          ) : null}
          {editable ? (
            <Pressable style={styles.btn} onPress={remove}>
              <Text style={[styles.btnText, { color: theme.danger }]}>
                {isMine(problem.setterId) ? "Delete" : "Take down"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  centre: { alignItems: "center", justifyContent: "center" },
  canvas: { flex: 1, overflow: "hidden", justifyContent: "center", alignItems: "center" },
  panel: { maxHeight: "50%", borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.panel },
  panelInner: { padding: 12, gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  name: { color: theme.text, fontSize: 20, fontWeight: "700" },
  stars: { color: "#ffc94d", fontSize: 16, marginTop: 2 },
  gradeBox: { alignItems: "flex-end" },
  grade: { color: theme.text, fontSize: 20, fontWeight: "700" },
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  dim: { color: theme.dim, fontSize: 13 },
  hint: { color: theme.dim, fontSize: 11 },
  note: { color: theme.warn, fontSize: 12 },
  section: { color: theme.text, fontSize: 15, fontWeight: "600", marginTop: 6 },
  tick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: theme.bg,
  },
  tickMain: { color: theme.text, fontSize: 14 },
  comment: { padding: 10, borderRadius: 8, backgroundColor: theme.bg, gap: 2 },
  commentHead: { color: theme.dim, fontSize: 12 },
  commentBody: { color: theme.text, fontSize: 14 },
  commentBar: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  commentInput: {
    flex: 1,
    color: theme.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxHeight: 120,
    backgroundColor: theme.bg,
  },
  postBtn: { backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  tickGrade: { color: theme.text, fontSize: 14, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
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
  disabled: { opacity: 0.45 },
});
