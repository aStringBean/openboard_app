import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS, useDerivedValue, useSharedValue, type SharedValue } from "react-native-reanimated";
import { Canvas, Circle, FillType, Group, Image, Path, Skia, useImage } from "@shopify/react-native-skia";

import { fitPhoto } from "../lib/fit";
import { isBoard, type Quad } from "../lib/perspective";
import { theme } from "../theme";

interface Props {
  /** The photo as taken. */
  uri: string;
  /** Where the corners were last time, or null to start them inset. */
  corners: Quad | null;
  size: { w: number; h: number } | null;
  busy: boolean;
  /** What leaving without straightening means here: "Cancel", or "Use as is" for a photo just picked. */
  leaveLabel: string;
  onDone: (corners: Quad, size: { w: number; h: number }) => void;
  onLeave: () => void;
}

/** Common board sizes, width × height. */
const PRESETS = [
  { w: 8, h: 10 },
  { w: 8, h: 12 },
  { w: 12, h: 10 },
  { w: 12, h: 12 },
];

const INSET: Quad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
];

/** How close, in screen pixels, a touch must land to pick up a corner. */
const GRAB_PX = 56;
const LOUPE_R = 64;
const LOUPE_ZOOM = 3;
const SELECT = "#ff3df0";

const flat = (q: Quad) => q.flatMap((p) => [p.x, p.y]);
const quadOf = (v: readonly number[]): Quad => [
  { x: v[0]!, y: v[1]! },
  { x: v[2]!, y: v[3]! },
  { x: v[4]!, y: v[5]! },
  { x: v[6]!, y: v[7]! },
];

/**
 * Marking the board's four corners on a photo, and its size.
 *
 * A finger covers the very corner it is placing, so a magnifier shows the
 * spot under the dragged corner, in the top corner of the photo away from
 * it. Corners move with the finger rather than jumping to it, so the finger
 * can sit off to one side.
 */
export function StraightenView({ uri, corners, size, busy, leaveLabel, onDone, onLeave }: Props) {
  const image = useImage(uri);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ w: width, h: height });
  }, []);

  const fit = image ? fitPhoto(box.w, box.h, image.width() / image.height()) : { width: 0, height: 0 };
  const fx = (box.w - fit.width) / 2;
  const fy = (box.h - fit.height) / 2;

  /* The photo's rectangle on screen, for the worklets. */
  const rect = useSharedValue([0, 0, 0, 0]);
  useEffect(() => {
    rect.set([fx, fy, fit.width, fit.height]);
  }, [fx, fy, fit.width, fit.height, rect]);

  /* Corners, normalised to the photo, live on the UI thread while dragged;
   * React gets them when a drag ends. */
  const pts = useSharedValue(flat(corners ?? INSET));
  const [quad, setQuad] = useState<Quad>(corners ?? INSET);
  const endDrag = useCallback((v: number[]) => setQuad(quadOf(v)), []);
  const active = useSharedValue(-1);
  const start = useSharedValue([0, 0]);

  const [w, setW] = useState(size ? String(size.w) : "");
  const [h, setH] = useState(size ? String(size.h) : "");
  const board = { w: Number(w), h: Number(h) };
  const sizeOk = board.w > 0 && board.h > 0 && board.w / board.h > 0.2 && board.w / board.h < 5;
  const shapeOk = isBoard(quad);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          const [x0, y0, rw, rh] = rect.value as [number, number, number, number];
          let best = -1;
          let bestD = GRAB_PX;
          for (let i = 0; i < 4; i++) {
            const d = Math.hypot(e.x - (x0 + pts.value[2 * i]! * rw), e.y - (y0 + pts.value[2 * i + 1]! * rh));
            if (d < bestD) {
              best = i;
              bestD = d;
            }
          }
          active.set(best);
          if (best >= 0) start.set([pts.value[2 * best]!, pts.value[2 * best + 1]!]);
        })
        .onUpdate((e) => {
          const i = active.value;
          if (i < 0) return;
          const [, , rw, rh] = rect.value as [number, number, number, number];
          const next = [...pts.value];
          next[2 * i] = Math.min(1, Math.max(0, start.value[0]! + e.translationX / rw));
          next[2 * i + 1] = Math.min(1, Math.max(0, start.value[1]! + e.translationY / rh));
          pts.set(next);
        })
        .onFinalize(() => {
          if (active.value < 0) return;
          active.set(-1);
          /* Plain numbers across: quadOf is not a worklet. */
          runOnJS(endDrag)(pts.value);
        }),
    [rect, pts, active, start, endDrag],
  );

  /* The board's outline, and everything outside it shaded. */
  const outline = useDerivedValue(() => {
    const [x0, y0, rw, rh] = rect.value as [number, number, number, number];
    const p = Skia.Path.Make();
    for (let i = 0; i < 4; i++) {
      const x = x0 + pts.value[2 * i]! * rw,
        y = y0 + pts.value[2 * i + 1]! * rh;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    p.close();
    return p;
  });
  const shade = useDerivedValue(() => {
    const [x0, y0, rw, rh] = rect.value as [number, number, number, number];
    const p = Skia.Path.Make();
    p.addRect({ x: x0, y: y0, width: rw, height: rh });
    p.addPath(outline.value);
    p.setFillType(FillType.EvenOdd);
    return p;
  });

  /* The magnifier: in whichever top corner is away from the dragged corner. */
  const loupe = useDerivedValue(() => {
    const [x0, y0, rw, rh] = rect.value as [number, number, number, number];
    const i = Math.max(0, active.value);
    const sx = x0 + pts.value[2 * i]! * rw,
      sy = y0 + pts.value[2 * i + 1]! * rh;
    const right = sx < x0 + rw / 2;
    const lx = right ? x0 + rw - LOUPE_R - 12 : x0 + LOUPE_R + 12;
    const ly = y0 + LOUPE_R + 12;
    return { sx, sy, lx, ly };
  });
  const loupeClip = useDerivedValue(() => {
    const p = Skia.Path.Make();
    p.addCircle(loupe.value.lx, loupe.value.ly, LOUPE_R);
    return p;
  });
  const loupeView = useDerivedValue(() => [
    { translateX: loupe.value.lx - LOUPE_ZOOM * loupe.value.sx },
    { translateY: loupe.value.ly - LOUPE_ZOOM * loupe.value.sy },
    { scale: LOUPE_ZOOM },
  ]);
  const loupeOpacity = useDerivedValue(() => (active.value >= 0 ? 1 : 0));
  const loupeX = useDerivedValue(() => loupe.value.lx);
  const loupeY = useDerivedValue(() => loupe.value.ly);

  return (
    <View style={styles.root}>
      <GestureDetector gesture={gesture}>
        <View style={styles.canvas} onLayout={onLayout}>
          {image ? (
            <Canvas style={StyleSheet.absoluteFill}>
              <Image image={image} x={fx} y={fy} width={fit.width} height={fit.height} fit="fill" />
              <Path path={shade} color="rgba(0,0,0,0.55)" />
              <Path path={outline} style="stroke" strokeWidth={2} color={SELECT} />
              {[0, 1, 2, 3].map((i) => (
                <Handle key={i} i={i} pts={pts} rect={rect} />
              ))}

              <Group opacity={loupeOpacity}>
                <Group clip={loupeClip}>
                  <Group transform={loupeView}>
                    <Image image={image} x={fx} y={fy} width={fit.width} height={fit.height} fit="fill" />
                    <Path path={outline} style="stroke" strokeWidth={1 / LOUPE_ZOOM} color={SELECT} />
                  </Group>
                </Group>
                <Circle cx={loupeX} cy={loupeY} r={LOUPE_R} style="stroke" strokeWidth={2} color="#ffffff" />
                <Circle cx={loupeX} cy={loupeY} r={3} style="stroke" strokeWidth={1.5} color={SELECT} />
              </Group>
            </Canvas>
          ) : (
            <ActivityIndicator color={theme.accent} />
          )}
        </View>
      </GestureDetector>

      <View style={styles.panel}>
        <Text style={shapeOk ? styles.dim : styles.warn}>
          {shapeOk
            ? "Drag each pink corner onto that corner of the board. Corners follow your finger, so it need not cover them."
            : "Two corners have crossed: put each on its own corner of the board."}
        </Text>

        <View style={styles.row}>
          <Text style={styles.label}>Board size</Text>
          <TextInput
            style={styles.input}
            value={w}
            onChangeText={setW}
            keyboardType="decimal-pad"
            placeholder="width"
            placeholderTextColor={theme.dim}
          />
          <Text style={styles.label}>×</Text>
          <TextInput
            style={styles.input}
            value={h}
            onChangeText={setH}
            keyboardType="decimal-pad"
            placeholder="height"
            placeholderTextColor={theme.dim}
          />
        </View>
        <View style={styles.row}>
          {PRESETS.map((p) => {
            const on = board.w === p.w && board.h === p.h;
            return (
              <Pressable
                key={`${p.w}x${p.h}`}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => {
                  setW(String(p.w));
                  setH(String(p.h));
                }}
              >
                <Text style={styles.btnText}>
                  {p.w}×{p.h}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.dim}>Width × height in any unit, feet or metres: only the shape counts.</Text>

        <View style={styles.row}>
          <Pressable style={styles.btn} onPress={onLeave} disabled={busy}>
            <Text style={styles.btnText}>{leaveLabel}</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnPrimary, !(sizeOk && shapeOk && !busy) && styles.btnDisabled]}
            disabled={!(sizeOk && shapeOk) || busy}
            onPress={() => onDone(quad, board)}
          >
            {busy ? (
              <ActivityIndicator color="#06101f" />
            ) : (
              <Text style={[styles.btnText, styles.btnTextPrimary]}>Straighten</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** One corner's ring. */
function Handle({ i, pts, rect }: { i: number; pts: SharedValue<number[]>; rect: SharedValue<number[]> }) {
  const cx = useDerivedValue(() => rect.value[0]! + pts.value[2 * i]! * rect.value[2]!);
  const cy = useDerivedValue(() => rect.value[1]! + pts.value[2 * i + 1]! * rect.value[3]!);
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={14} style="stroke" strokeWidth={4} color="rgba(0,0,0,0.6)" />
      <Circle cx={cx} cy={cy} r={14} style="stroke" strokeWidth={2} color={SELECT} />
    </Group>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  canvas: { flex: 1, overflow: "hidden", justifyContent: "center", alignItems: "center" },
  panel: { padding: 12, gap: 10, borderTopWidth: 1, borderTopColor: SELECT, backgroundColor: theme.panel },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { color: theme.text, fontSize: 13 },
  dim: { color: theme.dim, fontSize: 13 },
  warn: { color: theme.warn, fontSize: 13 },
  input: {
    flex: 1,
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    textAlign: "center",
  },
  chip: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  chipOn: { borderColor: theme.accent, backgroundColor: `${theme.accent}26` },
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
  btnDisabled: { opacity: 0.4 },
  btnText: { color: theme.text, fontSize: 13, fontWeight: "500" },
  btnTextPrimary: { color: "#06101f", fontWeight: "700" },
});
