import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS, useSharedValue } from "react-native-reanimated";

import { theme } from "../theme";

const THUMB = 26;
const PAD = THUMB / 2;
/*
 * Kept clear of the screen edges. Android's gesture navigation treats a
 * swipe starting within about 30dp of either edge as Back, and a thumb
 * resting at the end of an edge-to-edge track sits right in that zone, so
 * dragging it would leave the screen instead of moving the thumb.
 */
const EDGE_INSET = 28;

interface Props {
  /** Number of positions, at least two. */
  steps: number;
  /** Committed positions, 0 … steps - 1. */
  low: number;
  high: number;
  /** Called on release, not during a drag, so a list is not refiltered at every step. */
  onChange: (low: number, high: number) => void;
  /** Summary shown above the track, live while dragging. */
  label: (low: number, high: number) => string;
  /** What the two ends of the track stand for. */
  ends: [string, string];
}

/**
 * A two-thumb slider over discrete steps: the low thumb sets the bottom of a
 * range, the high thumb the top. A drag grabs whichever thumb is nearer, and
 * the thumbs may meet but never cross, so the range is never inverted. A tap
 * on the track moves the nearer thumb there.
 */
export function RangeSlider({ steps, low, high, onChange, label, ends }: Props) {
  const [live, setLive] = useState<[number, number]>([low, high]);
  const liveRef = useRef<[number, number]>([low, high]);
  const dragging = useRef(false);
  /* 0 low, 1 high; null while two stacked thumbs wait to see which way the finger goes. */
  const active = useRef<0 | 1 | null>(null);

  const trackWidth = useSharedValue(0);
  const lastStep = useSharedValue(-1);
  const [width, setWidth] = useState(0);

  /* Follow outside changes, such as Reset, except mid-drag. */
  useEffect(() => {
    if (dragging.current) return;
    liveRef.current = [low, high];
    setLive([low, high]);
  }, [low, high]);

  const apply = (next: [number, number]) => {
    liveRef.current = next;
    setLive(next);
  };

  const move = (step: number) => {
    const [lo, hi] = liveRef.current;
    if (active.current === null) {
      if (step < lo) active.current = 0;
      else if (step > hi) active.current = 1;
      else return;
    }
    apply(active.current === 0 ? [Math.min(step, hi), hi] : [lo, Math.max(step, lo)]);
  };

  const grab = (step: number) => {
    dragging.current = true;
    const [lo, hi] = liveRef.current;
    active.current = lo === hi ? null : Math.abs(step - lo) <= Math.abs(step - hi) ? 0 : 1;
    move(step);
  };

  const release = () => {
    dragging.current = false;
    active.current = null;
    const [lo, hi] = liveRef.current;
    if (lo !== low || hi !== high) onChange(lo, hi);
  };

  /* Gestures run on the UI thread and call back through these stable
   * wrappers, which always reach the latest handlers. */
  const handlers = useRef({ grab, move, release });
  handlers.current = { grab, move, release };
  const jsGrab = useCallback((s: number) => handlers.current.grab(s), []);
  const jsMove = useCallback((s: number) => handlers.current.move(s), []);
  const jsRelease = useCallback(() => handlers.current.release(), []);
  const jsTap = useCallback((s: number) => {
    handlers.current.grab(s);
    handlers.current.release();
  }, []);

  const gesture = useMemo(() => {
    const toStep = (x: number) => {
      "worklet";
      const w = trackWidth.value;
      if (w <= 0) return 0;
      return Math.min(steps - 1, Math.max(0, Math.round(((x - PAD) / w) * (steps - 1))));
    };

    /* Horizontal only, so a vertical swipe still scrolls the screen. */
    const pan = Gesture.Pan()
      .activeOffsetX([-4, 4])
      .failOffsetY([-14, 14])
      .onStart((e) => {
        const from = toStep(e.x - e.translationX);
        lastStep.value = from;
        runOnJS(jsGrab)(from);
      })
      .onUpdate((e) => {
        const s = toStep(e.x);
        if (s !== lastStep.value) {
          lastStep.value = s;
          runOnJS(jsMove)(s);
        }
      })
      .onEnd(() => {
        runOnJS(jsRelease)();
      });

    const tap = Gesture.Tap().onEnd((e) => {
      runOnJS(jsTap)(toStep(e.x));
    });

    return Gesture.Race(pan, tap);
  }, [steps, trackWidth, lastStep, jsGrab, jsMove, jsRelease, jsTap]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.max(0, e.nativeEvent.layout.width - THUMB);
    trackWidth.value = w;
    setWidth(w);
  };

  const at = (step: number) => (steps > 1 ? (step / (steps - 1)) * width : 0);
  const [lo, hi] = live;

  return (
    <View style={styles.root}>
      <Text style={styles.value}>{label(lo, hi)}</Text>

      <GestureDetector gesture={gesture}>
        <View style={styles.hit} onLayout={onLayout}>
          <View style={styles.track} />
          <View style={[styles.range, { left: PAD + at(lo), width: at(hi) - at(lo) }]} />
          <View style={[styles.thumb, { left: at(lo) }]} />
          <View style={[styles.thumb, { left: at(hi) }]} />
        </View>
      </GestureDetector>

      <View style={styles.ends}>
        <Text style={styles.end}>{ends[0]}</Text>
        <Text style={styles.end}>{ends[1]}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 4, marginHorizontal: EDGE_INSET },
  value: { color: theme.text, fontSize: 16, fontWeight: "600" },
  /* Tall for an easy target; the track itself is a thin line through the middle. */
  hit: { height: 44, justifyContent: "center" },
  track: {
    position: "absolute",
    left: PAD,
    right: PAD,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.line,
  },
  range: { position: "absolute", height: 4, borderRadius: 2, backgroundColor: theme.accent },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: theme.text,
    borderWidth: 3,
    borderColor: theme.accent,
  },
  ends: { flexDirection: "row", justifyContent: "space-between" },
  end: { color: theme.dim, fontSize: 12 },
});
