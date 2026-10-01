import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ScrollView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Stack, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { Segmented } from "../components/Pickers";
import { StraightenView } from "../components/StraightenView";
import { useFitCanvas } from "../components/useFitCanvas";
import { WallCanvas, type WallCanvasHandle } from "../components/WallCanvas";
import { CommitTextInput } from "../components/CommitTextInput";
import { LiftAboveKeyboard } from "../components/LiftAboveKeyboard";
import * as board from "../lib/board";
import {
  addHold,
  assignLed,
  clearHolds,
  DETECT_SETTING,
  DOT_COLORS,
  DOT_OPACITIES,
  decidedCount,
  deleteHold,
  emptyCalibration,
  holdNear,
  mappedHolds,
  markNoHold,
  mergeDetections,
  moveHold,
  nextUndecided,
  resetCalibration,
  straighten,
  straighteningOf,
  toExportJson,
  undoLast,
  type Calibration,
  type Protected,
} from "../lib/calibration";
import { detectHoldsInPhoto } from "../lib/detectPhoto";
import { mirrorMap, pairHolds, setPair, unpair } from "../lib/mirror";
import { findOutliers } from "../lib/outliers";
import { loadCalibration, problemsUsingHold, saveCalibration, usedHoldIds, getSetting } from "../lib/db/repo";
import type { Quad } from "../lib/perspective";
import { keepPhoto, savePhoto } from "../lib/photos";
import { straightenPhoto } from "../lib/straightenPhoto";
import { useApp } from "../state/AppProvider";
import { CALIBRATION_COLOUR, theme, VERIFY_COLOUR } from "../theme";

type Mode = "idle" | "sweeping" | "verifying" | "editing" | "straightening" | "mirroring";

/** The photo being straightened, and whether it was only just picked. */
interface Straightening {
  uri: string;
  corners: Quad | null;
  size: { w: number; h: number } | null;
  fresh: boolean;
}

/** Screen pixels within which a tap selects a hold rather than adding one. */
const HIT_PX = 24;

/** Reviewing mirror pairs: a hold with no partner, the chosen hold, and its partner. */
const UNPAIRED = "#ff9f1a";
const SELECTED = "#ff3df0";
const PARTNER = "#00e5ff";
/** Saves are batched rather than written on every change. */
const SAVE_DEBOUNCE_MS = 300;
/** A held arrow waits this long, then repeats at this interval. */
const REPEAT_DELAY_MS = 350;
const REPEAT_MS = 60;

export function CalibrationScreen() {
  const [cal, setCal] = useState<Calibration>(emptyCalibration());
  const [loaded, setLoaded] = useState(false);
  const { db, wall, saveWall } = useApp();
  /* Holds that problems use: undo, re-detection and reset must keep them. */
  const [used, setUsed] = useState<Protected>(new Set());
  const usedRef = useRef<Protected>(used);
  usedRef.current = used;
  const [mode, setMode] = useState<Mode>("idle");
  const [highlight, setHighlight] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { onLayout: onCanvasLayout, width: canvasWidth, height: canvasHeight } = useFitCanvas(cal?.photoAspect);
  const [detecting, setDetecting] = useState(false);
  /* Hold detection is experimental, off unless switched on in Settings: on
   * some walls it scatters dots everywhere. */
  const [detectOn, setDetectOn] = useState(false);
  const [dotsOpen, setDotsOpen] = useState(false);
  const [straightening, setStraightening] = useState<Straightening | null>(null);
  const [warping, setWarping] = useState(false);
  /* Reviewing mirror pairs: the hold whose partner is shown. */
  const [mirrorSel, setMirrorSel] = useState<number | null>(null);

  /*
   * The latest calibration, readable synchronously. Every change goes through
   * commit(), which updates this before React re-renders — so two taps in
   * quick succession each build on the other rather than on a stale render,
   * and side effects (lighting LEDs, alerts) can run outside state updaters.
   */
  const calRef = useRef(cal);
  const canvasRef = useRef<WallCanvasHandle>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());

  /* Writes the calibration now. If the database refuses — it will not let a
   * hold a problem uses be deleted — say so and resync from what is stored,
   * rather than carry on showing a state that was never saved. */
  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;

    saving.current = saving.current
      .then(() => saveCalibration(db, wall.id, calRef.current))
      .catch(async (err: unknown) => {
        Alert.alert("Could not save the wall", err instanceof Error ? err.message : String(err));
        const fresh = await loadCalibration(db, wall.id);
        calRef.current = fresh;
        setCal(fresh);
      });
    return saving.current;
  }, [db, wall.id]);

  /** A change by the user: shown at once, saved shortly after the last one. */
  const commit = useCallback(
    (next: Calibration) => {
      calRef.current = next;
      setCal(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(), SAVE_DEBOUNCE_MS);
    },
    [persist],
  );

  const flush = useCallback(() => {
    if (saveTimer.current) void persist();
  }, [persist]);

  /* Wall-clock bookkeeping lives in refs: it changes every frame while
   * sweeping and must not drive re-renders of the photo. */
  const lastDecisionAt = useRef(0);
  const sweepStartedAt = useRef(0);

  /* Load whenever the screen comes into view — problems may have claimed
   * holds since — after any save still in flight has landed. */
  useFocusEffect(
    useCallback(() => {
      let live = true;
      saving.current
        .then(() =>
          Promise.all([loadCalibration(db, wall.id), usedHoldIds(db, wall.id), getSetting(db, DETECT_SETTING)]),
        )
        .then(([c, u, detect]) => {
          if (!live) return;
          setDetectOn(detect === "1");
          calRef.current = c;
          setCal(c);
          setUsed(u);
          setLoaded(true);
        });
      return () => {
        live = false;
        flush();
      };
    }, [db, wall.id, flush]),
  );

  /* Save at once when the app is backgrounded, so a sweep survives being put
   * in a pocket. */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") flush();
    });
    return () => sub.remove();
  }, [flush]);

  const mapped = useMemo(() => mappedHolds(cal), [cal]);
  const outliers = useMemo(() => findOutliers(mapped), [mapped]);

  /* Mirror layout: partners by hold, and the holds without one. */
  const partners = useMemo(
    () =>
      mirrorMap(
        wall.mirror,
        cal.holds.map((h) => h.id),
      ),
    [wall.mirror, cal.holds],
  );
  const unpairedHolds = useMemo(() => cal.holds.filter((h) => !partners.has(h.id)), [cal.holds, partners]);
  const mirrorMarks = useMemo(() => {
    if (mode !== "mirroring") return undefined;
    const marks = new Map<number, string>(unpairedHolds.map((h) => [h.id, UNPAIRED]));
    if (mirrorSel !== null) {
      const partner = partners.get(mirrorSel);
      if (partner !== undefined) marks.set(partner, PARTNER);
      marks.set(mirrorSel, partner === mirrorSel ? PARTNER : SELECTED);
    }
    return marks;
  }, [mode, unpairedHolds, mirrorSel, partners]);
  const selected = selectedId === null ? null : (cal.holds.find((h) => h.id === selectedId) ?? null);

  const decided = decidedCount(cal);
  const remaining = Math.max(0, cal.chainLength - decided);

  // ---------------------------------------------------------------- sweep

  const startSweep = () => {
    if (!board.isConnected()) return Alert.alert("Connect the board first.");
    if (!cal.photoUri) return Alert.alert("Load a photo of your wall first.");

    const led = nextUndecided(calRef.current, calRef.current.nextLed);
    if (led >= cal.chainLength) return Alert.alert("Every LED already has a decision.");

    sweepStartedAt.current = Date.now();
    lastDecisionAt.current = Date.now();
    commit({ ...calRef.current, nextLed: led });
    setSelectedId(null);
    setMode("sweeping");
    void board.lightOne(led, CALIBRATION_COLOUR);
  };

  const stopSweep = useCallback(() => {
    const extra = sweepStartedAt.current ? Date.now() - sweepStartedAt.current : 0;
    sweepStartedAt.current = 0;
    commit({ ...calRef.current, elapsedMs: calRef.current.elapsedMs + extra });
    setMode("idle");
    void board.blank();
  }, [commit]);

  /** Applies a decision for the current LED and moves to the next undecided one. */
  const decide = useCallback(
    (apply: (c: Calibration, led: number) => Calibration) => {
      const now = Date.now();
      const gap = lastDecisionAt.current ? now - lastDecisionAt.current : 0;
      lastDecisionAt.current = now;

      const c = calRef.current;
      const led = c.nextLed;
      const after = apply({ ...c, taps: gap ? [...c.taps, gap] : c.taps }, led);
      const next = nextUndecided(after, led + 1);
      const done = next >= after.chainLength;

      commit({ ...after, nextLed: done ? led : next });

      if (done) {
        stopSweep();
        Alert.alert(
          "Sweep complete",
          `${mappedHolds(after).length} holds mapped, ${after.noHold.length} with no hold.`,
        );
      } else {
        void board.lightOne(next, CALIBRATION_COLOUR);
      }
    },
    [commit, stopSweep],
  );

  const skip = () => decide((c, led) => markNoHold(c, led, usedRef.current));

  const undo = () => {
    const r = undoLast(calRef.current, usedRef.current);
    if (!r) return;
    commit(r.cal);
    if (mode === "sweeping") void board.lightOne(r.led, CALIBRATION_COLOUR);
  };

  // --------------------------------------------------------------- editing

  const select = useCallback((id: number | null) => {
    setSelectedId(id);
    const hold = id === null ? null : calRef.current.holds.find((h) => h.id === id);

    /* Light the selected hold's LED, so the physical hold is obvious while
     * centring its marker. */
    if (hold && hold.led !== null) void board.lightOne(hold.led, VERIFY_COLOUR);
    else void board.blank();
  }, []);

  const enterEdit = () => {
    if (mode === "sweeping") stopSweep();
    setHighlight(null);
    setMode("editing");
    select(null);
  };

  const exitEdit = () => {
    setMode("idle");
    setSelectedId(null);
    void board.blank();
  };

  const onMoveSelected = useCallback(
    (x: number, y: number) => {
      if (selectedId === null) return;
      commit(moveHold(calRef.current, selectedId, x, y));
    },
    [selectedId, commit],
  );

  /* Arrow buttons drive the canvas directly and commit on release. */
  const nudgeStep = (sx: number, sy: number) => () => canvasRef.current?.nudge(sx, sy);
  const nudgeRelease = () => canvasRef.current?.commitNudge();

  const deleteSelected = async () => {
    if (!selected) return;

    if (usedRef.current.has(selected.id)) {
      const problems = await problemsUsingHold(db, wall.id, selected.id);
      const names = problems.map((p) => `• ${p.name}`).join("\n");
      Alert.alert(
        "This hold is in use",
        `It is part of ${problems.length === 1 ? "a problem" : `${problems.length} problems`}:\n\n${names}\n\nRemove it from ${problems.length === 1 ? "that problem" : "those problems"} first. You can still move it.`,
      );
      return;
    }

    const remove = () => {
      commit(deleteHold(calRef.current, selected.id));
      select(null);
    };

    if (selected.led === null) return remove();

    Alert.alert("Delete hold?", `LED ${selected.led} will need to be mapped again.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: remove },
    ]);
  };

  // ----------------------------------------------------------------- taps

  const onTap = useCallback(
    (x: number, y: number, tapZoom: number) => {
      const c = calRef.current;

      if (mode === "sweeping") {
        decide((cal, led) => assignLed(cal, led, x, y, usedRef.current));
        return;
      }

      if (mode === "editing") {
        const hit = holdNear(c, x, y, {
          width: canvasWidth,
          height: canvasHeight,
          zoom: tapZoom,
          hitPx: HIT_PX,
        });

        if (hit) {
          select(hit.id);
        } else {
          const added = addHold(c, x, y);
          commit(added.cal);
          select(added.id);
        }
        return;
      }

      if (mode === "mirroring") {
        const hit = holdNear(c, x, y, { width: canvasWidth, height: canvasHeight, zoom: tapZoom, hitPx: HIT_PX });
        if (!hit || hit.id === mirrorSel) return setMirrorSel(null);
        /* With a hold chosen, tapping another makes them partners. */
        if (mirrorSel !== null && wall.mirror) {
          void saveWall({ ...wall, mirror: setPair(wall.mirror, mirrorSel, hit.id) });
          return;
        }
        setMirrorSel(hit.id);
        return;
      }

      if (mode === "verifying" && mapped.length) {
        let best = mapped[0]!;
        let bestD = Infinity;

        for (const h of mapped) {
          const d = (h.x - x) ** 2 + (h.y - y) ** 2;
          if (d < bestD) [best, bestD] = [h, d];
        }

        setHighlight(best.led);
        void board.lightOne(best.led, VERIFY_COLOUR);
      }
    },
    [mode, mapped, canvasWidth, canvasHeight, decide, select, commit, mirrorSel, wall, saveWall],
  );

  // --------------------------------------------------------------- actions

  const runDetection = async (uri: string) => {
    setDetecting(true);
    try {
      const found = await detectHoldsInPhoto(uri);
      commit(mergeDetections(calRef.current, found, usedRef.current));

      if (found.length === 0) {
        Alert.alert(
          "No holds detected",
          "You can still add holds by hand in Edit holds. A photo square-on to the wall, in even light, detects best.",
        );
      }
    } catch (err) {
      Alert.alert("Detection failed", err instanceof Error ? err.message : String(err));
    } finally {
      setDetecting(false);
    }
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert("Photo library permission is needed.");

    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (res.canceled) return;

    const asset = res.assets[0]!;

    if (usedRef.current.size > 0) {
      const ok = await new Promise<boolean>((resolve) =>
        Alert.alert(
          "Change the photo?",
          "Your problems' holds keep their positions from the current photo. That only lines up if the new photo is taken from the same spot.",
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Change", onPress: () => resolve(true) },
          ],
        ),
      );
      if (!ok) return;
    }

    let photoUri: string;
    try {
      photoUri = await keepPhoto(wall.id, asset.uri);
    } catch (err) {
      return Alert.alert("Could not keep that photo", err instanceof Error ? err.message : String(err));
    }

    /* Untouched detections from the old photo mean nothing on the new one. */
    commit({
      ...mergeDetections(calRef.current, [], usedRef.current),
      photoUri,
      photoAspect: asset.width && asset.height ? asset.width / asset.height : 0.75,
    });
    setSelectedId(null);

    /* Detection waits until the photo is straightened, or left as it is. */
    setStraightening({ uri: photoUri, corners: null, size: calRef.current.straightening?.size ?? null, fresh: true });
    setMode("straightening");
  };

  const openStraighten = () => {
    const c = calRef.current;
    if (!c.photoUri) return;
    /* Always from the photo as taken, so warps never stack. */
    const s = straighteningOf(c);
    setStraightening({
      uri: s?.originalUri ?? c.photoUri,
      corners: s?.corners ?? null,
      size: c.straightening?.size ?? null,
      fresh: false,
    });
    setMode("straightening");
  };

  const leaveStraighten = async () => {
    const fresh = straightening?.fresh;
    setStraightening(null);
    setMode("idle");
    if (fresh && detectOn && calRef.current.photoUri) await runDetection(calRef.current.photoUri);
  };

  const finishStraighten = async (corners: Quad, size: { w: number; h: number }) => {
    if (!straightening) return;
    setWarping(true);
    try {
      const jpeg = await straightenPhoto(straightening.uri, corners, size.w / size.h);
      const resultUri = savePhoto(wall.id, jpeg);
      commit(straighten(calRef.current, { originalUri: straightening.uri, corners, size, resultUri }, usedRef.current));
    } catch (err) {
      return Alert.alert("Could not straighten the photo", err instanceof Error ? err.message : String(err));
    } finally {
      setWarping(false);
    }
    await leaveStraighten();
  };

  const clearAll = () => {
    const keep = usedRef.current.size;
    Alert.alert(
      "Clear all holds?",
      keep > 0
        ? `Removes every hold and its LED, except the ${keep} your problems use, which stay as they are.`
        : "Removes every hold from the photo, and its LED. The photo stays.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            commit(clearHolds(calRef.current, usedRef.current));
            setSelectedId(null);
          },
        },
      ],
    );
  };

  // ------------------------------------------------------------ mirror layout

  const autoPair = () => void saveWall({ ...wall, mirror: pairHolds(calRef.current.holds).mirror });

  const startMirror = () => {
    const begin = () => {
      autoPair();
      setMirrorSel(null);
      setMode("mirroring");
    };
    /* Pairing reflects holds across the photo's centre line, which is only
     * the board's when the board is square-on. */
    if (straighteningOf(calRef.current)) return begin();
    Alert.alert(
      "Straighten the photo first?",
      "Holds are paired with their reflection across the board's centre line. That works best with the board square-on in the photo.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Pair anyway", onPress: begin },
        { text: "Straighten", onPress: openStraighten },
      ],
    );
  };

  const repair = () =>
    Alert.alert("Pair every hold again?", "Pairs you set by hand are replaced by what the photo suggests.", [
      { text: "Cancel", style: "cancel" },
      { text: "Pair again", onPress: autoPair },
    ]);

  const stopMirror = () =>
    Alert.alert(
      "Not a mirror layout?",
      "Problems can no longer be climbed mirrored. Ascents already logged mirrored are kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Turn off",
          style: "destructive",
          onPress: () => {
            void saveWall({ ...wall, mirror: null });
            setMirrorSel(null);
            setMode("idle");
          },
        },
      ],
    );

  const exportJson = async () => {
    const file = new File(Paths.cache, "wall-calibration.json");

    if (file.exists) file.delete();
    file.create();
    file.write(toExportJson(calRef.current));

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: "application/json" });
    } else {
      Alert.alert("Exported", file.uri);
    }
  };

  const reset = () =>
    Alert.alert(
      "Reset map?",
      usedRef.current.size > 0
        ? `Clears every LED mapping and all timings, and removes unused holds. The ${usedRef.current.size} holds your problems use are kept, but will need mapping again.`
        : "Discards every hold and all timings.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            sweepStartedAt.current = 0;
            commit(resetCalibration(calRef.current, usedRef.current));
            setSelectedId(null);
            setMode("idle");
            void board.blank();
          },
        },
      ],
    );

  const toggleVerify = () => {
    if (mode === "sweeping") stopSweep();
    setSelectedId(null);
    setMode((m) => (m === "verifying" ? "idle" : "verifying"));
    setHighlight(null);
    void board.blank();
  };

  // ---------------------------------------------------------------- render

  if (!loaded) {
    return (
      <View style={[styles.root, styles.centre]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      {/* The panel sits where the keyboard comes up: lift the screen, and the photo gives way. */}
      <LiftAboveKeyboard>
        <Stack.Screen
          options={{
            title:
              mode === "editing"
                ? "Edit holds"
                : mode === "straightening"
                  ? "Straighten"
                  : mode === "mirroring"
                    ? "Mirror pairs"
                    : "Wall setup",
          }}
        />

        {mode === "straightening" && straightening ? (
          <StraightenView
            uri={straightening.uri}
            corners={straightening.corners}
            size={straightening.size}
            busy={warping}
            leaveLabel={straightening.fresh ? "Use as is" : "Cancel"}
            onDone={finishStraighten}
            onLeave={leaveStraighten}
          />
        ) : (
          <>
            <View style={styles.canvas} onLayout={onCanvasLayout}>
              {cal.photoUri && canvasWidth > 0 ? (
                <WallCanvas
                  photoUri={cal.photoUri}
                  width={canvasWidth}
                  height={canvasHeight}
                  holds={cal.holds}
                  highlightLed={mode === "sweeping" ? cal.nextLed : highlight}
                  selectedId={mode === "editing" ? selectedId : null}
                  editing={mode === "editing"}
                  onTap={onTap}
                  onMoveSelected={onMoveSelected}
                  dotColor={cal.dotColor}
                  dotOpacity={cal.dotOpacity}
                  marks={mirrorMarks}
                  showUnused={mode === "mirroring"}
                  ref={canvasRef}
                />
              ) : (
                <View style={styles.centre}>
                  <Text style={styles.dim}>Load a photo of your wall to begin.</Text>
                </View>
              )}

              {detecting ? (
                <View style={styles.busy}>
                  <ActivityIndicator color={theme.accent} />
                  <Text style={styles.dim}>Finding holds…</Text>
                </View>
              ) : null}
            </View>

            {mode === "sweeping" ? (
              <View style={styles.sweepBar}>
                <View>
                  <Text style={styles.sweepLabel}>LED</Text>
                  <Text style={styles.sweepNum}>{cal.nextLed}</Text>
                </View>
                <Text style={styles.sweepHint}>Tap where it lit</Text>
                <View style={styles.sweepBtns}>
                  <Pressable style={styles.btn} onPress={skip}>
                    <Text style={styles.btnText}>No hold</Text>
                  </Pressable>
                  <Pressable style={styles.btn} onPress={undo}>
                    <Text style={styles.btnText}>Undo</Text>
                  </Pressable>
                  <Pressable style={styles.btn} onPress={stopSweep}>
                    <Text style={styles.btnText}>Stop</Text>
                  </Pressable>
                </View>
              </View>
            ) : mode === "mirroring" ? (
              <View style={[styles.editBar, { borderTopColor: PARTNER }]}>
                <Text style={styles.editInfo}>
                  {mirrorSel === null
                    ? `${cal.holds.length - unpairedHolds.length} of ${cal.holds.length} holds paired${
                        unpairedHolds.length ? ` · ${unpairedHolds.length} without a partner, ringed orange` : ""
                      }. Tap a hold to see its partner.`
                    : partners.get(mirrorSel) === mirrorSel
                      ? `Hold ${mirrorSel} is on the centre line: its own mirror image. Tap another hold to pair them instead.`
                      : partners.has(mirrorSel)
                        ? `Hold ${mirrorSel} pairs with hold ${partners.get(mirrorSel)} (cyan). Tap another hold to pair it instead.`
                        : `Hold ${mirrorSel} has no partner. Tap the hold that mirrors it.`}
                </Text>
                {mirrorSel !== null ? (
                  <View style={styles.editRow}>
                    <Pressable
                      style={styles.btn}
                      onPress={() =>
                        wall.mirror && void saveWall({ ...wall, mirror: setPair(wall.mirror, mirrorSel, mirrorSel) })
                      }
                    >
                      <Text style={styles.btnText}>Centre line</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.btn, !partners.has(mirrorSel) && styles.btnDisabled]}
                      disabled={!partners.has(mirrorSel)}
                      onPress={() => wall.mirror && void saveWall({ ...wall, mirror: unpair(wall.mirror, mirrorSel) })}
                    >
                      <Text style={styles.btnText}>Unpair</Text>
                    </Pressable>
                  </View>
                ) : null}
                <View style={styles.editRow}>
                  <Pressable style={styles.btn} onPress={repair}>
                    <Text style={styles.btnText}>Pair again</Text>
                  </Pressable>
                  <Pressable style={styles.btn} onPress={stopMirror}>
                    <Text style={[styles.btnText, { color: theme.danger }]}>Turn off</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.btn, styles.btnPrimary]}
                    onPress={() => {
                      setMirrorSel(null);
                      setMode("idle");
                    }}
                  >
                    <Text style={[styles.btnText, styles.btnTextPrimary]}>Done</Text>
                  </Pressable>
                </View>
              </View>
            ) : mode === "editing" ? (
              <View style={styles.editBar}>
                <Text style={styles.editInfo}>
                  {selected
                    ? `Hold ${selected.id} · ${selected.led === null ? "no LED yet" : `LED ${selected.led}`} · ${selected.source}`
                    : "Tap a hold to select it, or empty wall to add one. Zoom in where holds are close together."}
                </Text>
                <View style={styles.editRow}>
                  <NudgeButton label="←" disabled={!selected} onStep={nudgeStep(-1, 0)} onRelease={nudgeRelease} />
                  <NudgeButton label="↑" disabled={!selected} onStep={nudgeStep(0, -1)} onRelease={nudgeRelease} />
                  <NudgeButton label="↓" disabled={!selected} onStep={nudgeStep(0, 1)} onRelease={nudgeRelease} />
                  <NudgeButton label="→" disabled={!selected} onStep={nudgeStep(1, 0)} onRelease={nudgeRelease} />
                </View>
                <View style={styles.editRow}>
                  <Pressable
                    style={[styles.btn, !selected && styles.btnDisabled]}
                    onPress={deleteSelected}
                    disabled={!selected}
                  >
                    <Text style={[styles.btnText, { color: theme.danger }]}>Delete</Text>
                  </Pressable>
                  <Pressable style={[styles.btn, styles.btnPrimary]} onPress={exitEdit}>
                    <Text style={[styles.btnText, styles.btnTextPrimary]}>Done</Text>
                  </Pressable>
                </View>
                <View style={styles.editRow}>
                  <Pressable style={[styles.btn, dotsOpen && styles.btnActive]} onPress={() => setDotsOpen(!dotsOpen)}>
                    <Text style={styles.btnText}>Dots</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.btn, !cal.holds.length && styles.btnDisabled]}
                    onPress={clearAll}
                    disabled={!cal.holds.length}
                  >
                    <Text style={[styles.btnText, { color: theme.danger }]}>Clear all</Text>
                  </Pressable>
                </View>
                {dotsOpen ? (
                  <View style={styles.dots}>
                    <View style={styles.swatches}>
                      {DOT_COLORS.map((d) => (
                        <Pressable
                          key={d.color}
                          accessibilityLabel={d.name}
                          hitSlop={4}
                          onPress={() => commit({ ...calRef.current, dotColor: d.color })}
                          style={[
                            styles.swatch,
                            { backgroundColor: d.color },
                            cal.dotColor === d.color && styles.swatchOn,
                          ]}
                        />
                      ))}
                    </View>
                    <Segmented<number>
                      options={DOT_OPACITIES.map((o) => ({ value: o, label: `${Math.round(o * 100)}%` }))}
                      value={cal.dotOpacity}
                      onChange={(o) => commit({ ...calRef.current, dotOpacity: o })}
                    />
                  </View>
                ) : null}
                <Text style={styles.dim}>
                  Drag the pink crosshair, or hold an arrow to move it.
                  {detectOn ? " Moved and added holds are kept when you re-detect." : ""}
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.panel} contentContainerStyle={styles.panelInner}>
                <View style={styles.stats}>
                  <Stat label="Mapped" value={String(mapped.length)} />
                  <Stat label="No hold" value={String(cal.noHold.length)} />
                  <Stat label="Left" value={String(remaining)} />
                </View>

                <View style={styles.row}>
                  <Text style={styles.dim}>Chain length</Text>
                  <CommitTextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    initial={String(cal.chainLength)}
                    commitWhile="done"
                    onCommit={(text) => {
                      const n = Number(text);
                      if (Number.isInteger(n) && n > 0 && n <= 1000) {
                        commit({ ...calRef.current, chainLength: n });
                      }
                    }}
                  />
                </View>

                <View style={styles.btnRow}>
                  <Pressable
                    style={[styles.btn, cal.snapEnabled && styles.btnActive]}
                    onPress={() => commit({ ...calRef.current, snapEnabled: !calRef.current.snapEnabled })}
                  >
                    <Text style={styles.btnText}>Snap {cal.snapEnabled ? "on" : "off"}</Text>
                  </Pressable>
                  {detectOn ? (
                    <Pressable
                      style={styles.btn}
                      onPress={() => cal.photoUri && runDetection(cal.photoUri)}
                      disabled={!cal.photoUri || detecting}
                    >
                      <Text style={styles.btnText}>Re-detect</Text>
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.btn} onPress={enterEdit} disabled={!cal.photoUri}>
                    <Text style={styles.btnText}>Edit holds · {cal.holds.length}</Text>
                  </Pressable>
                </View>

                <View style={styles.btnRow}>
                  <Pressable style={styles.btn} onPress={pickPhoto}>
                    <Text style={styles.btnText}>{cal.photoUri ? "Change photo" : "Load photo"}</Text>
                  </Pressable>
                  {cal.photoUri ? (
                    <Pressable style={styles.btn} onPress={openStraighten}>
                      <Text style={styles.btnText}>Straighten</Text>
                    </Pressable>
                  ) : null}
                  <Pressable style={[styles.btn, styles.btnPrimary]} onPress={startSweep}>
                    <Text style={[styles.btnText, styles.btnTextPrimary]}>
                      {decided > 0 ? "Resume sweep" : "Start sweep"}
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.btnRow}>
                  <Pressable style={[styles.btn, mode === "verifying" && styles.btnActive]} onPress={toggleVerify}>
                    <Text style={styles.btnText}>Verify</Text>
                  </Pressable>
                  <Pressable style={styles.btn} onPress={exportJson}>
                    <Text style={styles.btnText}>Export</Text>
                  </Pressable>
                  <Pressable style={styles.btn} onPress={reset}>
                    <Text style={[styles.btnText, { color: theme.danger }]}>Reset</Text>
                  </Pressable>
                </View>

                <View style={styles.btnRow}>
                  <Pressable
                    style={[
                      styles.btn,
                      wall.mirror !== null && styles.btnActive,
                      !cal.holds.length && styles.btnDisabled,
                    ]}
                    disabled={!cal.holds.length}
                    onPress={() => {
                      if (!wall.mirror) return startMirror();
                      setMirrorSel(null);
                      setMode("mirroring");
                    }}
                  >
                    <Text style={styles.btnText}>
                      {wall.mirror
                        ? `Mirror layout · ${unpairedHolds.length ? `${unpairedHolds.length} unpaired` : "all paired"}`
                        : "Mirror layout · off"}
                    </Text>
                  </Pressable>
                </View>

                {mode === "verifying" ? <Text style={styles.dim}>Tap a hold; the board lights that LED.</Text> : null}

                <Text style={styles.dim}>
                  {cal.snapEnabled
                    ? "During a sweep, taps snap to the nearest free hold — tap anywhere on a hold. Fix missed or off-centre holds in Edit holds first."
                    : "Snap is off: during a sweep, markers land exactly where you tap."}
                </Text>

                {outliers.length > 0 ? (
                  <View style={styles.outliers}>
                    <Text style={styles.outlierTitle}>
                      {outliers.length} likely mis-tap{outliers.length > 1 ? "s" : ""}
                    </Text>
                    <Text style={styles.dim}>
                      Consecutive LEDs sit next to each other on the wall. These are far from both neighbours — tap one
                      to light it and check.
                    </Text>
                    <View style={styles.outlierRow}>
                      {outliers.slice(0, 12).map((o) => (
                        <Pressable
                          key={o.led}
                          style={styles.outlierChip}
                          onPress={() => {
                            setHighlight(o.led);
                            void board.lightOne(o.led, VERIFY_COLOUR);
                          }}
                        >
                          <Text style={styles.outlierText}>{o.led}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </>
        )}
      </LiftAboveKeyboard>
    </SafeAreaView>
  );
}

/**
 * Steps once on press, then repeats while held — a short press for a pixel,
 * a held press to travel.
 *
 * The repeat loop cannot outlive the press. `held` is checked before every
 * step and before re-arming, so a tick that fires after release does nothing
 * and ends the loop, and pressing again always cancels any loop already
 * running rather than starting a second one beside it.
 */
function NudgeButton({
  label,
  disabled,
  onStep,
  onRelease,
}: {
  label: string;
  disabled: boolean;
  onStep: () => void;
  onRelease: () => void;
}) {
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    const wasHeld = held.current;
    held.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (wasHeld) onRelease();
  };

  const start = () => {
    stop();
    held.current = true;
    onStep();

    const repeat = (delay: number) => {
      timer.current = setTimeout(() => {
        if (!held.current) return;
        onStep();
        repeat(REPEAT_MS);
      }, delay);
    };
    repeat(REPEAT_DELAY_MS);
  };

  /* Stop if the button is disabled or unmounted mid-hold, since neither is
   * guaranteed to deliver a press-out. */
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);
  useEffect(() => stop, []);

  return (
    <Pressable
      style={[styles.btn, styles.nudge, disabled && styles.btnDisabled]}
      onPressIn={start}
      onPressOut={stop}
      disabled={disabled}
    >
      <Text style={styles.nudgeText}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { gap: 10, paddingTop: 4 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: theme.line },
  swatchOn: { borderColor: theme.text, transform: [{ scale: 1.15 }] },
  root: { flex: 1, backgroundColor: theme.bg },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  canvas: { flex: 1, overflow: "hidden", justifyContent: "center", alignItems: "center" },
  busy: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(18,20,26,0.72)",
  },
  dim: { color: theme.dim, fontSize: 13 },

  sweepBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: theme.accent,
    backgroundColor: theme.panel,
  },
  sweepLabel: { color: theme.dim, fontSize: 10, letterSpacing: 1 },
  sweepNum: { color: theme.text, fontSize: 30, fontWeight: "700" },
  sweepHint: { color: theme.dim, fontSize: 12, flex: 1, textAlign: "center" },
  sweepBtns: { flexDirection: "row", gap: 6 },

  editBar: {
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#ff3df0",
    backgroundColor: theme.panel,
  },
  editInfo: { color: theme.text, fontSize: 13 },
  editRow: { flexDirection: "row", gap: 8 },
  nudge: { paddingVertical: 12 },
  nudgeText: { color: theme.text, fontSize: 20, fontWeight: "600" },

  panel: { maxHeight: "45%", borderTopWidth: 1, borderTopColor: theme.line },
  panelInner: { padding: 12, gap: 10 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: {
    flexGrow: 1,
    minWidth: 92,
    backgroundColor: theme.panel,
    borderRadius: 8,
    padding: 8,
  },
  statLabel: { color: theme.dim, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 },
  statValue: { color: theme.text, fontSize: 18, fontWeight: "600" },

  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  input: {
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 80,
    textAlign: "right",
  },

  btnRow: { flexDirection: "row", gap: 8 },
  btn: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: theme.panel,
  },
  btnPrimary: { backgroundColor: theme.accent, borderColor: theme.accent },
  btnActive: { borderColor: theme.good },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: theme.text, fontSize: 13, fontWeight: "500" },
  btnTextPrimary: { color: "#06101f", fontWeight: "700" },

  outliers: {
    borderWidth: 1,
    borderColor: theme.warn,
    borderRadius: 8,
    padding: 10,
    gap: 6,
  },
  outlierTitle: { color: theme.warn, fontWeight: "600", fontSize: 13 },
  outlierRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  outlierChip: {
    borderWidth: 1,
    borderColor: theme.warn,
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  outlierText: { color: theme.warn, fontSize: 12, fontWeight: "600" },
});
