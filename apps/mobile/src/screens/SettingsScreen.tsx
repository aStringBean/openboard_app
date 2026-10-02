import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, Switch } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { useConnection } from "../components/ConnectChip";
import { AnglePicker, Segmented } from "../components/Pickers";
import { useSession } from "../components/useSession";
import { CommitTextInput } from "../components/CommitTextInput";
import * as board from "../lib/board";
import { getSetting, setSetting } from "../lib/db/repo";
import { DETECT_SETTING } from "../lib/calibration";
import { familyOf } from "../lib/boardName";
import { gradeLabel, type GradeScale } from "../lib/grades";
import {
  angleRange,
  canEditWall,
  DEFAULT_ADJUSTABLE,
  DEFAULT_FIXED_ANGLE,
  withAngles,
  type AngleMode,
} from "../lib/wall";
import { useApp } from "../state/AppProvider";
import { theme } from "../theme";

/** A number field that commits when editing ends, ignoring anything non-numeric. */
function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <CommitTextInput
        style={styles.input}
        keyboardType="number-pad"
        initial={String(value)}
        commitWhile="done"
        onCommit={(text) => {
          const n = Number(text);
          if (Number.isInteger(n)) onCommit(n);
        }}
      />
    </View>
  );
}

export function SettingsScreen() {
  const { wall, saveWall, gradeScale, setGradeScale } = useApp();
  const router = useRouter();

  return (
    <SafeAreaView edges={["bottom"]} style={styles.root}>
      <Stack.Screen options={{ title: "Settings" }} />

      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>Account</Text>
        <AccountLink />

        <Text style={styles.section}>Wall</Text>

        <Pressable style={styles.link} onPress={() => router.push("/share")}>
          <Text style={styles.linkTitle}>Sharing</Text>
          <Text style={styles.dim}>
            {wall.cloud ? "Invites, members, who can set problems" : "Only on this phone — share it with others"}
          </Text>
        </Pressable>

        <Pressable style={styles.link} onPress={() => router.push("/colours")}>
          <Text style={styles.linkTitle}>Hold colours</Text>
          <Text style={styles.dim}>What start, hand, no-match, foot and finish light up in</Text>
        </Pressable>

        {canEditWall(wall) ? (
          <WallSettings />
        ) : (
          <>
            <Text style={styles.dim}>
              {wall.name}&apos;s photo, holds, name and angles belong to its owner, and update here when they change
              them.
            </Text>
            {wall.angleMode === "adjustable" ? (
              <>
                <Text style={styles.label}>The wall is at</Text>
                <AnglePicker
                  angles={wall.angles}
                  value={wall.currentAngle}
                  onChange={(currentAngle) => void saveWall({ ...wall, currentAngle })}
                />
              </>
            ) : null}
          </>
        )}

        <BoardSettings />

        <Experimental />

        <Text style={styles.section}>Grades</Text>
        <Segmented<GradeScale>
          options={[
            { value: "font", label: "Font" },
            { value: "v", label: "V" },
            { value: "both", label: "Both" },
          ]}
          value={gradeScale}
          onChange={(s) => void setGradeScale(s)}
        />
        <Text style={styles.dim}>
          Shown as {gradeLabel(5, gradeScale)}. Grades are stored once and convert both ways, so switching never changes
          a problem&apos;s grade.
        </Text>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

/** What only the wall's owner may change: setup, name and angles. */
function WallSettings() {
  const { wall, saveWall } = useApp();
  const router = useRouter();
  const [range, setRange] = useState(() =>
    wall.angleMode === "adjustable" && wall.angles.length > 1
      ? { min: wall.angles[0]!, max: wall.angles[wall.angles.length - 1]!, step: wall.angles[1]! - wall.angles[0]! }
      : { ...DEFAULT_ADJUSTABLE },
  );

  const setMode = (mode: AngleMode) => {
    if (mode === wall.angleMode) return;
    const angles =
      mode === "fixed" ? [wall.currentAngle || DEFAULT_FIXED_ANGLE] : angleRange(range.min, range.max, range.step);
    void saveWall(withAngles(wall, mode, angles));
  };

  const setRangePart = (part: "min" | "max" | "step", n: number) => {
    const next = { ...range, [part]: n };
    setRange(next);
    void saveWall(withAngles(wall, "adjustable", angleRange(next.min, next.max, next.step)));
  };

  return (
    <>
      <Pressable style={styles.link} onPress={() => router.push("/setup")}>
        <Text style={styles.linkTitle}>Wall setup</Text>
        <Text style={styles.dim}>Photo, holds, mapping LEDs to holds</Text>
      </Pressable>

      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <CommitTextInput
          style={styles.input}
          initial={wall.name}
          maxLength={40}
          onCommit={(text) => {
            const name = text.trim();
            if (name) void saveWall({ ...wall, name });
          }}
        />
      </View>

      <Text style={styles.label}>Angle</Text>
      <Segmented
        options={[
          { value: "fixed", label: "Fixed" },
          { value: "adjustable", label: "Adjustable" },
        ]}
        value={wall.angleMode}
        onChange={setMode}
      />

      {wall.angleMode === "fixed" ? (
        <NumberField
          key="fixed"
          label="Wall angle (degrees overhanging)"
          value={wall.currentAngle}
          onCommit={(a) => void saveWall(withAngles(wall, "fixed", [a]))}
        />
      ) : (
        <>
          <View style={styles.rangeRow}>
            <NumberField label="From" value={range.min} onCommit={(n) => setRangePart("min", n)} />
            <NumberField label="To" value={range.max} onCommit={(n) => setRangePart("max", n)} />
            <NumberField label="Step" value={range.step} onCommit={(n) => setRangePart("step", n)} />
          </View>
          <Text style={styles.label}>The wall is at</Text>
          <AnglePicker
            angles={wall.angles}
            value={wall.currentAngle}
            onChange={(currentAngle) => void saveWall({ ...wall, currentAngle })}
          />
          <Text style={styles.dim}>
            Problems are graded at the angle they are set at, so a 40° problem climbed at 30° is a different climb. New
            problems use the angle the wall is at.
          </Text>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  root: { flex: 1, backgroundColor: theme.bg },
  body: { padding: 16, gap: 10 },
  section: { color: theme.text, fontSize: 17, fontWeight: "700", marginTop: 8 },
  field: { flex: 1, gap: 4 },
  label: { color: theme.dim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
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
  rangeRow: { flexDirection: "row", gap: 8 },
  link: {
    padding: 12,
    gap: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.panel,
  },
  linkTitle: { color: theme.text, fontSize: 15, fontWeight: "600" },
  dim: { color: theme.dim, fontSize: 13 },
  setBtn: { backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 18, justifyContent: "center" },
  setBtnText: { color: "#06101f", fontSize: 15, fontWeight: "700" },
});

/* Brightness in steps a person can tell apart; the board takes 1-255. */
const BRIGHTNESS_STEPS = [10, 25, 50, 75, 100];
const toValue = (pct: number) => Math.max(1, Math.round((pct * 255) / 100));
const nearestStep = (value: number) =>
  BRIGHTNESS_STEPS.reduce((a, b) => (Math.abs(toValue(b) - value) < Math.abs(toValue(a) - value) ? b : a));

/* After the strip length is set, its last LED blinks this long, so it can be found on the wall. */
const BLINK_LAST_MS = 5000;

/** The connected board's own settings, when it speaks OpenBoard API 1. */
function BoardSettings() {
  const conn = useConnection();
  const [read, setSettings] = useState<Awaited<ReturnType<typeof board.readSettings>>>(null);
  const [error, setError] = useState<string | null>(null);
  /* The strip length as typed, or null to show the board's. */
  const [typed, setTyped] = useState<string | null>(null);
  const [blinking, setBlinking] = useState<number | null>(null);
  /* Shown under the strip length field rather than at the end of the section. */
  const [lengthError, setLengthError] = useState<string | null>(null);
  /* Setting it again mid-blink starts a new blink; only the latest clears the note. */
  const lengthSets = useRef(0);
  const openboard = conn.status === "connected" && conn.protocol === "openboard";
  /* Settings read from a board that has since gone mean nothing. */
  const settings = openboard ? read : null;

  useEffect(() => {
    if (!openboard) return;
    let live = true;
    board.readSettings().then(
      (s) => live && setSettings(s),
      (err: unknown) => live && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [openboard]);

  if (conn.status !== "connected") return null;

  if (!openboard) {
    return (
      <>
        <Text style={styles.section}>Board</Text>
        <Text style={styles.dim}>
          Connected in {familyOf(conn.name)} mode. For full colour and brightness control from here, switch
          the board to OpenBoard mode from its console: board setup openboard.
        </Text>
      </>
    );
  }

  const setBrightness = async (pct: number) => {
    setError(null);
    try {
      await board.setBrightness(toValue(pct));
      setSettings(await board.readSettings());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const maxLength = conn.info?.maxChainLength ?? null;
  const length = typed ?? String(settings?.chainLength ?? "");

  const setChainLength = async () => {
    const n = Number(length);
    if (!Number.isInteger(n) || n < 1 || (maxLength !== null && n > maxLength)) {
      setLengthError(
        `The strip length is a whole number of LEDs, from 1${maxLength !== null ? ` to ${maxLength}` : ""}.`,
      );
      return;
    }
    setLengthError(null);
    const set = ++lengthSets.current;
    try {
      await board.setChainLength(n);
      setSettings(await board.readSettings());
      setTyped(null);
      setBlinking(n);
      await board.blink(n - 1, { r: 255, g: 255, b: 255 }, BLINK_LAST_MS);
    } catch (err) {
      setLengthError(err instanceof Error ? err.message : String(err));
    } finally {
      if (set === lengthSets.current) setBlinking(null);
    }
  };

  const fw = conn.info?.firmware;

  return (
    <>
      <Text style={styles.section}>Board</Text>
      <Text style={styles.dim}>
        OpenBoard{fw ? ` firmware ${fw.major}.${fw.minor}.${fw.patch}` : ""}
        {settings ? ` · ${settings.chainLength} LEDs` : ""}
      </Text>

      <Text style={styles.label}>Brightness</Text>
      {settings ? (
        <Segmented<number>
          options={BRIGHTNESS_STEPS.map((p) => ({ value: p, label: `${p}%` }))}
          value={nearestStep(settings.brightness)}
          onChange={(p) => void setBrightness(p)}
        />
      ) : null}
      <Text style={styles.label}>Strip length</Text>
      {settings ? (
        <View style={styles.rangeRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            keyboardType="number-pad"
            value={length}
            onChangeText={setTyped}
            onSubmitEditing={() => void setChainLength()}
          />
          <Pressable style={styles.setBtn} onPress={() => void setChainLength()}>
            <Text style={styles.setBtnText}>Set</Text>
          </Pressable>
        </View>
      ) : null}
      {lengthError ? <Text style={[styles.dim, { color: theme.danger }]}>{lengthError}</Text> : null}
      <Text style={styles.dim}>
        {blinking !== null
          ? `LED ${blinking}, the last, is blinking white.`
          : `How many LEDs the board drives${maxLength !== null ? `, up to ${maxLength}` : ""}. Setting it blinks the last one for ${BLINK_LAST_MS / 1000} seconds, to check it is the end of the strip.`}
      </Text>
      {settings ? (
        <Text style={styles.dim}>
          Power limit: a {settings.powerSupplyW} W supply, {settings.powerHeadroomPct}% of it for the LEDs. The board
          dims any frame that would draw more. Set from the board&apos;s console.
        </Text>
      ) : null}
      {error ? <Text style={[styles.dim, { color: theme.danger }]}>{error}</Text> : null}
    </>
  );
}

/** Features that work on some walls and not others, off unless chosen. */
function Experimental() {
  const { db } = useApp();
  const [detect, setDetect] = useState<boolean | null>(null);

  useEffect(() => {
    getSetting(db, DETECT_SETTING).then((v) => setDetect(v === "1"));
  }, [db]);

  return (
    <>
      <Text style={styles.section}>Experimental</Text>
      <View style={styles.switchRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.linkTitle}>Detect holds in the photo</Text>
          <Text style={styles.dim}>
            Finds holds for you when a wall photo is loaded. It works well on some walls and scatters dots over
            others; Clear all in Edit holds removes them.
          </Text>
        </View>
        <Switch
          value={detect ?? false}
          disabled={detect === null}
          onValueChange={(v) => {
            setDetect(v);
            void setSetting(db, DETECT_SETTING, v ? "1" : "0");
          }}
        />
      </View>
    </>
  );
}

function AccountLink() {
  const router = useRouter();
  const { session } = useSession();
  return (
    <Pressable style={styles.link} onPress={() => router.push("/account")}>
      <Text style={styles.linkTitle}>{session ? session.user.email : "Sign in"}</Text>
      <Text style={styles.dim}>{session ? "Your name, sign out" : "To share walls and sync between phones"}</Text>
    </Pressable>
  );
}
