import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { theme } from "../theme";
import type { WallHold } from "../lib/calibration";
import { ROLE_STYLE, type Role } from "../lib/problem";

interface Props {
  photoUri: string;
  /** Rendered size of the photo at zoom 1. */
  width: number;
  height: number;
  /** Every hold: those with an LED draw as markers, the rest as dots. */
  holds: WallHold[];
  highlightLed?: number | null;
  /**
   * Problem mode: holds in the problem draw as rings in their role colour,
   * instead of the calibration view's LED markers.
   */
  problemRoles?: ReadonlyMap<number, Role>;
  /** In problem mode, also draw the holds not in the problem, faintly, as targets. */
  showUnused?: boolean;
  selectedId?: number | null;
  /** Enables dragging the selected hold. */
  editing?: boolean;
  /** Normalised 0..1 coordinates within the photo, plus the current zoom. */
  onTap: (x: number, y: number, zoom: number) => void;
  onMoveSelected?: (x: number, y: number) => void;
  onZoomChange?: (zoom: number) => void;
  ref?: Ref<WallCanvasHandle>;
}

/**
 * Nudging runs through the canvas rather than through React state: each step
 * moves the crosshair on the UI thread, and the hold is committed once when
 * the button is released. Committing every step re-rendered ~500 markers per
 * tick, which saturated the JS thread for as long as a button was held.
 */
export interface WallCanvasHandle {
  /** Moves the selected hold by (sx, sy) steps of NUDGE_PX screen pixels. */
  nudge(sx: number, sy: number): void;
  /** Reports where nudging left the hold through onMoveSelected. */
  commitNudge(): void;
}

/** One nudge, in screen pixels — the same visible step at any zoom. */
const NUDGE_PX = 1.5;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** How close, in screen pixels, a drag must start to grab the selected hold. */
const DRAG_HIT_PX = 32;

/**
 * The photo, pinch/pan zoomable, with every hold drawn on it.
 *
 * Gestures are attached to the transformed view, so gesture-handler reports
 * coordinates in the photo's own space and the pan/zoom transform does not
 * have to be inverted by hand.
 *
 * Markers are counter-scaled against the zoom. Otherwise they grow with the
 * photo, and zooming in to centre a hold precisely would bury it under its
 * own marker.
 */
export function WallCanvas({
  photoUri,
  width,
  height,
  holds,
  highlightLed,
  problemRoles,
  showUnused = false,
  selectedId = null,
  editing = false,
  onTap,
  onMoveSelected,
  onZoomChange,
  ref,
}: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  /* The selected hold lives on the UI thread while it is dragged, so it
   * follows the finger without a React render per frame. */
  const editingSV = useSharedValue(editing ? 1 : 0);
  const hasSel = useSharedValue(0);
  const selX = useSharedValue(0);
  const selY = useSharedValue(0);
  const dragging = useSharedValue(0);
  const offX = useSharedValue(0);
  const offY = useSharedValue(0);

  /* Zoom as React sees it, updated when a pinch ends: enough to size the
   * static markers without re-rendering hundreds of views mid-gesture. */
  const [zoom, setZoom] = useState(1);

  const selected = selectedId === null ? null : (holds.find((h) => h.id === selectedId) ?? null);

  useEffect(() => {
    editingSV.value = editing ? 1 : 0;
  }, [editing, editingSV]);

  useEffect(() => {
    if (selected) {
      selX.value = selected.x;
      selY.value = selected.y;
      hasSel.value = 1;
    } else {
      hasSel.value = 0;
    }
  }, [selected?.id, selected?.x, selected?.y, selX, selY, hasSel]);

  /* The nudged position, held in JS between the first step and release. Kept
   * here rather than read back from the shared values, so nothing depends on
   * reading UI-thread state from JS. */
  const nudged = useRef<{ x: number; y: number } | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      nudge(sx, sy) {
        if (!selected) return;
        const from = nudged.current ?? { x: selected.x, y: selected.y };
        const to = {
          x: clamp01(from.x + (sx * NUDGE_PX) / (width * zoom)),
          y: clamp01(from.y + (sy * NUDGE_PX) / (height * zoom)),
        };
        nudged.current = to;
        selX.value = to.x;
        selY.value = to.y;
      },
      commitNudge() {
        const to = nudged.current;
        nudged.current = null;
        if (to) onMoveSelected?.(to.x, to.y);
      },
    }),
    [selected, width, height, zoom, onMoveSelected, selX, selY],
  );

  const gesture = useMemo(() => {
    const reportZoom = (z: number) => {
      setZoom(z);
      onZoomChange?.(z);
    };

    const pinch = Gesture.Pinch()
      .onUpdate((e) => {
        scale.value = Math.min(8, Math.max(1, savedScale.value * e.scale));
      })
      .onEnd(() => {
        savedScale.value = scale.value;
        if (scale.value <= 1.01) {
          tx.value = withTiming(0);
          ty.value = withTiming(0);
          savedTx.value = 0;
          savedTy.value = 0;
        }
        runOnJS(reportZoom)(scale.value);
      });

    const pan = Gesture.Pan()
      .averageTouches(true)
      .onStart((e) => {
        /* A drag that starts on the selected hold moves the hold; any other
         * drag pans the photo as usual. Judged in screen pixels, so it is as
         * easy to grab at 8x as at 1x. */
        dragging.value = 0;
        if (!editingSV.value || !hasSel.value) return;

        const d = Math.hypot(e.x - selX.value * width, e.y - selY.value * height) * scale.value;
        if (d > DRAG_HIT_PX) return;

        dragging.value = 1;
        /* Keep the grab offset, so the hold does not jump under the finger. */
        offX.value = selX.value - e.x / width;
        offY.value = selY.value - e.y / height;
      })
      .onUpdate((e) => {
        if (dragging.value) {
          selX.value = Math.min(1, Math.max(0, e.x / width + offX.value));
          selY.value = Math.min(1, Math.max(0, e.y / height + offY.value));
          return;
        }

        /* Keep the photo from being dragged entirely off screen. */
        const limitX = (width * (scale.value - 1)) / 2;
        const limitY = (height * (scale.value - 1)) / 2;

        tx.value = Math.min(limitX, Math.max(-limitX, savedTx.value + e.translationX));
        ty.value = Math.min(limitY, Math.max(-limitY, savedTy.value + e.translationY));
      })
      .onEnd(() => {
        if (dragging.value) {
          dragging.value = 0;
          if (onMoveSelected) runOnJS(onMoveSelected)(selX.value, selY.value);
          return;
        }

        savedTx.value = tx.value;
        savedTy.value = ty.value;
      });

    const tap = Gesture.Tap()
      .maxDuration(300)
      .maxDistance(12)
      .onEnd((e) => {
        runOnJS(onTap)(e.x / width, e.y / height, scale.value);
      });

    return Gesture.Race(Gesture.Simultaneous(pinch, pan), tap);
  }, [
    width,
    height,
    onTap,
    onMoveSelected,
    onZoomChange,
    scale,
    savedScale,
    tx,
    ty,
    savedTx,
    savedTy,
    editingSV,
    hasSel,
    selX,
    selY,
    dragging,
    offX,
    offY,
  ]);

  const photoStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const crosshairStyle = useAnimatedStyle(() => ({
    opacity: hasSel.value,
    left: selX.value * width,
    top: selY.value * height,
    /* Counter-scaled continuously, so it stays a hairline even mid-pinch. */
    transform: [{ scale: 1 / scale.value }],
  }));

  /* Hundreds of static views: rebuilt only when the holds, the zoom, the
   * highlight or the selection change — not on every parent render. */
  const markers = useMemo(() => {
    const dot = DOT / zoom;
    const ring = SIZE / zoom;
    const border = 1.5 / zoom;

    if (problemRoles) {
      const border = 2.5 / zoom;
      return holds.map((h) => {
        const role = problemRoles.get(h.id);

        if (!role) {
          if (!showUnused) return null;
          return (
            <View
              key={h.id}
              pointerEvents="none"
              style={[
                styles.unused,
                {
                  left: h.x * width,
                  top: h.y * height,
                  width: dot,
                  height: dot,
                  marginLeft: -dot / 2,
                  marginTop: -dot / 2,
                  borderRadius: dot / 2,
                },
              ]}
            />
          );
        }

        const colour = ROLE_STYLE[role].ui;
        const size = ring * 1.5;
        return (
          <View
            key={h.id}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: h.x * width,
              top: h.y * height,
              width: size,
              height: size,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              borderRadius: size / 2,
              borderWidth: border,
              borderColor: colour,
              /* The same hue, faint, so the hold stays visible through it. */
              backgroundColor: `${colour}33`,
            }}
          />
        );
      });
    }

    return holds.map((h) => {
      /* The selected hold is drawn by the crosshair layer instead, so it does
       * not linger at its old spot while being dragged. */
      if (h.id === selectedId) return null;

      if (h.led === null) {
        return (
          <View
            key={h.id}
            pointerEvents="none"
            style={[
              styles.dot,
              {
                left: h.x * width,
                top: h.y * height,
                width: dot,
                height: dot,
                marginLeft: -dot / 2,
                marginTop: -dot / 2,
                borderRadius: dot / 2,
              },
            ]}
          />
        );
      }

      const hot = h.led === highlightLed;
      return (
        <View
          key={h.id}
          pointerEvents="none"
          style={[
            styles.marker,
            {
              left: h.x * width,
              top: h.y * height,
              width: ring,
              height: ring,
              marginLeft: -ring / 2,
              marginTop: -ring / 2,
              borderRadius: ring / 2,
              borderWidth: border,
            },
            hot && styles.markerHot,
          ]}
        >
          {hot ? (
            <Text style={[styles.label, { transform: [{ scale: 1 / zoom }] }]}>{h.led}</Text>
          ) : null}
        </View>
      );
    });
  }, [holds, zoom, highlightLed, selectedId, problemRoles, showUnused, width, height]);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{ width, height }, photoStyle]}>
        <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />

        {markers}

        <Animated.View pointerEvents="none" style={[styles.crosshair, crosshairStyle]}>
          <View style={styles.crossRing} />
          <View style={[styles.tick, styles.tickTop]} />
          <View style={[styles.tick, styles.tickBottom]} />
          <View style={[styles.tickH, styles.tickLeft]} />
          <View style={[styles.tickH, styles.tickRight]} />
          <View style={styles.crossCentre} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const SIZE = 14;
const DOT = 6;
/** The crosshair: a ring with ticks outside it, so nothing covers the centre. */
const CROSS = 26;
const TICK = 7;
const SELECT = "#ff3df0";

const styles = StyleSheet.create({
  dot: {
    position: "absolute",
    backgroundColor: "rgba(91,157,255,0.6)",
  },
  unused: {
    position: "absolute",
    backgroundColor: "rgba(255,255,255,0.45)",
  },
  marker: {
    position: "absolute",
    borderColor: theme.good,
    backgroundColor: "rgba(61,220,132,0.25)",
    alignItems: "center",
  },
  markerHot: {
    borderColor: "#fff",
    backgroundColor: "rgba(255,255,255,0.45)",
  },
  label: {
    position: "absolute",
    top: -16,
    fontSize: 10,
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 3,
    borderRadius: 3,
    overflow: "hidden",
  },
  crosshair: {
    position: "absolute",
    width: CROSS,
    height: CROSS,
    marginLeft: -CROSS / 2,
    marginTop: -CROSS / 2,
  },
  crossRing: {
    ...StyleSheet.absoluteFill,
    borderRadius: CROSS / 2,
    borderWidth: 1.5,
    borderColor: SELECT,
  },
  crossCentre: {
    position: "absolute",
    left: CROSS / 2 - 1,
    top: CROSS / 2 - 1,
    width: 2,
    height: 2,
    backgroundColor: SELECT,
  },
  tick: {
    position: "absolute",
    left: CROSS / 2 - 0.75,
    width: 1.5,
    height: TICK,
    backgroundColor: SELECT,
  },
  tickTop: { top: -TICK },
  tickBottom: { bottom: -TICK },
  tickH: {
    position: "absolute",
    top: CROSS / 2 - 0.75,
    width: TICK,
    height: 1.5,
    backgroundColor: SELECT,
  },
  tickLeft: { left: -TICK },
  tickRight: { right: -TICK },
});
