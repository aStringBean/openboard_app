import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View, ScrollView } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConnection } from "../components/ConnectChip";
import { LiftAboveKeyboard } from "../components/LiftAboveKeyboard";
import { LightButton } from "../components/LightButton";
import { MirrorToggle } from "../components/MirrorToggle";
import { starsText } from "../components/Pickers";
import { useFitCanvas } from "../components/useFitCanvas";
import { WallCanvas } from "../components/WallCanvas";
import { useFocusReload } from "../components/useFocusReload";
import * as board from "../lib/board";
import { neighbours } from "../lib/browse";
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
import { hasTwin, mirrorMap, mirrorProblem, unpairedIn } from "../lib/mirror";
import { countRoles, newId, problemFrame, ROLE_STYLE, ROLES, roleUi, type Problem } from "../lib/problem";
import { averageStars, byAngle, gradeAt, isFlash, myAscents, shortDate, type Tick } from "../lib/tick";
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
  /* On a mirror layout: showing and lighting the problem mirrored. Kept while
   * swiping to the next problem, as a session tends to stay on one side. */
  const [mirrored, setMirrored] = useState(false);
  const panelRef = useRef<ScrollView>(null);
  /* Where the comment box sits in the panel, and whether it is being typed in:
   * while it is, the panel keeps it in view as the keyboard shrinks the panel. */
  const commentY = useRef(0);
  const commenting = useRef(false);
  const showComment = useCallback(
    () => panelRef.current?.scrollTo({ y: Math.max(0, commentY.current - 48), animated: true }),
    [],
  );
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

  const pairs = useMemo(
    () =>
      wall.mirror && cal
        ? mirrorMap(
            wall.mirror,
            cal.holds.map((h) => h.id),
          )
        : null,
    [wall.mirror, cal],
  );
  /* Whether there is a distinct mirrored problem to climb. */
  const twin = !!problem && !!pairs && hasTwin(problem.holds, pairs);
  const showMirrored = mirrored && twin;
  const shown = useMemo(
    () =>
      problem && pairs && showMirrored
        ? (mirrorProblem(problem.holds, pairs) ?? problem.holds)
        : (problem?.holds ?? []),
    [problem, pairs, showMirrored],
  );

  const frame = useMemo(
    () => (problem && cal ? problemFrame(shown, cal.holds, wall.roleColors) : null),
    [problem, cal, shown, wall.roleColors],
  );

  const light = useCallback(() => {
    if (frame) void board.send(frame.leds);
  }, [frame]);

  /* Opening a problem lights it; so does connecting while it is open. */
  useEffect(() => {
    if (conn.status === "connected") light();
  }, [conn.status, light]);

  /* The list this problem was opened from, for swiping to its neighbours. */
  const around = useMemo(() => neighbours(id), [id]);

  const go = useCallback(
    (direction: 1 | -1) => {
      const target = direction > 0 ? around?.next : around?.prev;
      if (!target) return;
      setDraft("");
      /* The same page, another problem: back still returns to the list. */
      router.setParams({ id: target });
    },
    [around, router],
  );

  /* The panel below the photo swipes too; up and down still scroll it. */
  const panelSwipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-25, 25])
        .failOffsetY([-15, 15])
        .onEnd((e) => {
          if (Math.abs(e.translationX) > 60 || Math.abs(e.velocityX) > 600) {
            runOnJS(go)(e.translationX < 0 ? 1 : -1);
          }
        }),
    [go],
  );

  const roles = useMemo(() => new Map(shown.map((h) => [h.holdId, h.role])), [shown]);
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
  const unpaired = pairs ? unpairedIn(problem.holds, pairs).length : 0;
  /* Holds on LEDs past the end of the connected board's strip, which it drops. */
  const stripEnd = conn.status === "connected" ? conn.chainLength : null;
  const pastStrip = frame && stripEnd !== null ? frame.leds.filter((l) => l.pos >= stripEnd).length : 0;

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      {/* The panel sits where the keyboard comes up: lift the screen, and the photo gives way. */}
      <LiftAboveKeyboard>
        <Stack.Screen options={{ title: showMirrored ? `${problem.name} · mirrored` : problem.name }} />

        <View style={styles.canvas} onLayout={onCanvasLayout}>
          {cal.photoUri && canvasWidth > 0 ? (
            <WallCanvas
              photoUri={cal.photoUri}
              width={canvasWidth}
              height={canvasHeight}
              holds={cal.holds}
              problemRoles={roles}
              roleColors={wall.roleColors}
              onTap={() => {}}
              onSwipe={go}
            />
          ) : null}
        </View>

        <GestureDetector gesture={panelSwipe}>
          <ScrollView
            ref={panelRef}
            style={styles.panel}
            contentContainerStyle={styles.panelInner}
            onLayout={() => commenting.current && showComment()}
          >
            {around ? (
              <View style={styles.browse}>
                <Pressable hitSlop={10} disabled={!around.prev} onPress={() => go(-1)}>
                  <Text style={[styles.arrow, !around.prev && styles.arrowOff]}>‹</Text>
                </Pressable>
                <Text style={styles.dim}>
                  {around.position} of {around.count}
                </Text>
                <Pressable hitSlop={10} disabled={!around.next} onPress={() => go(1)}>
                  <Text style={[styles.arrow, !around.next && styles.arrowOff]}>›</Text>
                </Pressable>
              </View>
            ) : null}
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
                  <View style={[styles.swatch, { backgroundColor: roleUi(r, wall.roleColors) }]} />
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
            {pastStrip > 0 ? (
              <Text style={styles.note}>
                {pastStrip} hold{pastStrip > 1 ? "s are" : " is"} past the end of the board&apos;s strip ({stripEnd}{" "}
                LEDs), so won&apos;t light. Set the strip length in Settings → Board.
              </Text>
            ) : null}

            {/* Which way round on the left; lighting it again on the right. */}
            <View style={styles.viewRow}>
              {twin ? (
                <MirrorToggle mirrored={showMirrored} onChange={setMirrored} />
              ) : pairs && unpaired > 0 ? (
                <Text style={[styles.note, styles.viewRowText]}>
                  Can&apos;t be mirrored: {unpaired} of its holds {unpaired > 1 ? "have" : "has"} no mirror partner.
                  Pair {unpaired > 1 ? "them" : "it"} in Wall setup.
                </Text>
              ) : pairs ? (
                <Text style={[styles.dim, styles.viewRowText]}>Symmetric: the same climb both ways round.</Text>
              ) : null}
              <View style={styles.viewRowEnd}>
                <LightButton connected={connected} onPress={light} />
              </View>
            </View>

            <View style={styles.actions}>
              <Pressable
                style={[styles.btn, styles.primary]}
                onPress={() => router.push(`/problem/tick?id=${problem.id}&mirrored=${showMirrored ? 1 : 0}`)}
              >
                <Text style={styles.primaryText}>Tick</Text>
              </Pressable>
            </View>

            <Text style={styles.section}>
              {ticks.length === 0
                ? "Not climbed yet"
                : `${ticks.length} ascent${ticks.length > 1 ? "s" : ""}${mine.length ? ` · ${myAscents(mine, twin)}` : ""}`}
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
                    {t.mirrored ? " · mirrored" : ""}
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
            <View style={styles.commentBar} onLayout={(e) => (commentY.current = e.nativeEvent.layout.y)}>
              <TextInput
                style={styles.commentInput}
                /* The comment box is near the panel's end: keep it in view while typing. */
                onFocus={() => {
                  commenting.current = true;
                  showComment();
                }}
                onBlur={() => (commenting.current = false)}
                placeholder={comments.length ? "Add a comment" : "Beta, conditions, a kind word…"}
                placeholderTextColor={theme.dim}
                value={draft}
                onChangeText={setDraft}
                maxLength={1000}
                multiline
              />
              <Pressable
                style={[styles.postBtn, !draft.trim() && styles.disabled]}
                onPress={post}
                disabled={!draft.trim()}
              >
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
        </GestureDetector>
      </LiftAboveKeyboard>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  centre: { alignItems: "center", justifyContent: "center" },
  canvas: { flex: 1, overflow: "hidden", justifyContent: "center", alignItems: "center" },
  panel: { maxHeight: "50%", borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.panel },
  panelInner: { padding: 12, gap: 8 },
  browse: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18 },
  arrow: { color: theme.text, fontSize: 26, lineHeight: 28, paddingHorizontal: 8 },
  arrowOff: { color: theme.line },
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
  viewRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  viewRowText: { flex: 1 },
  /* Pushes the light button to the right, whatever is on the left. */
  viewRowEnd: { marginLeft: "auto" },
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
