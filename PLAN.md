# Open Board App — Plan

A native iOS and Android app for **custom spray walls** driven by the
[`open_board_leds`](../zpehyr_workspace/open_board_leds) controller.

Commercial board apps ship with a fixed, known layout. A spray wall inverts
that: every wall is different, and the user defines the holds, their positions
and their LED mapping. Everything below follows from that one difference.

## Scope

Users build their own LED spray wall, then use the app to:

- register a wall from a photo and map its holds to LEDs
- create, name and catalog problems
- illuminate a problem on the wall over BLE
- tick climbs, log attempts, propose grades
- rate, star and comment on other people's problems
- build lists and circuits
- filter by grade, stars, setter, completion, and holds used

Like the MoonBoard, Tension or boardsesh apps, but for a wall only its owner
has ever seen.

## Assessment

**Achievable.** The firmware is finished and the hardware is not a constraint.
The whole risk sits in wall onboarding (see below).

### What the firmware already provides

| Fact | Where |
| --- | --- |
| Transport is Nordic UART Service for every board mode | `app/src/bt_setup.c:246-340` |
| Aurora API3: 16-bit LED position, 3/3/2-bit colour, 3 bytes/record | `app/src/aurora.c:86` |
| Packet framing `0x01 \| len \| crc \| 0x02 \| payload \| 0x03` | `app/src/aurora.h:10-18` |
| CRC is the additive inverse over the payload | `app/src/aurora.c:5` |
| Fragmentation via FIRST/MIDDLE/LAST/ONLY sequence bytes | `app/src/aurora.h:28-36` |
| LED chain ceiling of 1000 | `app/boards/*.overlay` |

`aurora.c` and `parse.c` are a working reference implementation to port, and
`tests/` already pins the behaviour. The BLE side of this app is a few hundred
lines, not a project.

### Three firmware facts to design around

1. **It is write-only.** Nothing calls `bt_nus_send`, so the firmware never
   notifies. The app cannot read back chain length, board mode, or any ack.
   Fine for now; revisited in phase 6.
2. **The Aurora advertisement claims a service the GATT table does not have.**
   `bt_setup.c:41` advertises `4488B571-7806-4DF6-BCFF-A2897E4953FF`, but only
   NUS is registered. Filter scans on the device name or on NUS.
3. **Do not use Moonboard mode.** Fixed LED count, seven hardcoded colours, and
   a 128-byte message buffer. Aurora API3 is the target.

### Unrelated firmware bug spotted while reading

`bt_init()` calls `bt_conn_disconnect(active_conn, ...)` at `bt_setup.c:229`
with no NULL check, on the board-switch path where `bt_is_ready()` is true but
nothing is connected. Worth a guard.

## The critical problem: onboarding a wall

Before a user can do anything, the app must learn where every hold is. On a
spray wall that means hundreds of holds at arbitrary positions — there is no
grid to exploit and no vendor database to download.

The fear was that setup would be a ninety-minute tapping chore nobody finishes.
**Measured, it is about two minutes** (see below), so this is no longer the
project's main risk — but the interaction still has to be got right, because it
is the first thing every user does.

### Two mappings, captured in one pass

These are easy to conflate:

1. hold → position on the wall photo (drawing and selection)
2. hold → LED index (illumination)

With one LED per hold, a single pass gives both: **light LED `k`, user taps the
hold it sits under, repeat.**

### Approaches, in build order

- **Manual tap sweep** — the baseline and the guaranteed fallback. Auto-advance
  on tap, undo, skip-if-no-hold, and resumable across sessions.
- **Hold detection + snap to centre** — *the fix that mattered.* Segment the
  holds in the wall photo, then land every tap on the nearest hold's centre.
  Tap roughly anywhere on a hold and it lands dead centre, no zooming. Built as
  `packages/hold-detect`.
- **Hand correction of detection** — *built.* An Edit holds mode to add holds
  detection missed, delete false ones, and centre any hold exactly (drag, or
  arrow nudges that step one screen pixel at any zoom). Detection gets most
  holds; the user fixes the rest once, before sweeping.

### Holds are the source of truth for positions

The app first kept two lists: detected dots (snap targets) and LED markers
(copies of a dot's position, taken at tap time). Moving a dot after mapping
would have left its marker behind. It now stores **one set of holds, with the
LED as an attribute of the hold beside it** — the same shape as the `hold`
table in the data model below. Centring a mapped hold carries its LED marker
with it.

Rules worth knowing, all covered by tests in `apps/mobile/src/lib/`:

- A sweep tap only ever lands on a hold *without* an LED, so a mis-tap back
  onto the hold just mapped goes to the nearest free one instead, and an
  earlier LED is never silently stripped of its hold.
- Holds placed or moved by hand become `manual`, and re-detecting the photo
  never touches them. Untouched detections are replaced.
- Stored v1 data migrates on first load; the v1 key is left in place as a
  fallback until the user resets.

### TODO: a corpus of board images for detection

Detection has been tuned against synthetic walls and one board render
(`tensionboard.png`, holds on pure black — an easy background). Before relying
on it for other people's walls, gather a set of real photos: plywood spray
walls, commercial boards, different lighting, chalk, angles. Add each with a
hand-counted or hand-marked ground truth, and turn `tools/detect.mjs` into a
regression run that reports recall and precision per image. Tuning without
that corpus risks fixing one wall by breaking another.
- **Collaborative calibration** — once walls are shared, anyone on the wall can
  fix a mis-tapped hold. Turns a chore into maintenance.
- **Neighbour outlier check** — see below. Cheap, and it removes the need to
  verify every hold by hand.
- **LED auto-detection** — phone on a tripod, sweep the LEDs, match each bright
  blob to an already-detected hold. Much more robust now that hold positions
  are known independently. Next after snapping.

### Measured, not guessed (2026-09-21)

A full manual sweep of the 250-LED wall took **2 minutes 5 seconds**: 250
decisions, 248 holds, 2 positions with no hold, **median 374 ms per decision**.
Measured with `prototypes/calibration-web` on the real wall.

This kills the camera-auto-detection idea outright. It was premised on manual
calibration being a 30-to-45-minute barrier to onboarding; the actual cost is
about the same as reading the app's welcome screen. Automating it would save
under two minutes of genuinely one-time work in exchange for a pile of
computer-vision fragility. **Manual tap calibration is the shipping answer.**

**Re-measured on a Pixel 6a (2026-09-21).** Same wall, 250 decisions, 248 holds:
**median 420 ms, total 3m35s.** The typical tap is only 12% slower than a mouse
— my two-to-three-times guess was wrong.

But the totals diverge far more than the medians do, and that is the real
finding:

| | median | mean | total | mean/median |
| --- | --- | --- | --- | --- |
| Desktop, mouse | 374 ms | 502 ms | 2m05s | 1.34 |
| Phone, thumb | 420 ms | 858 ms | 3m35s | 2.04 |

**These numbers understate the problem, and the conclusion drawn from them was
wrong.** `undo` discarded the timing of the decision it reversed while the wall
clock kept running, so every retry *improved* the median. The metric was
anti-correlated with the pain it was meant to measure. Roughly 109s of the
phone's 214s is not in the tap record at all.

The honest per-hold cost is total ÷ decisions: **858 ms on the phone against
502 ms on the desktop.** And the user's account is the decisive evidence:
tapping the exact centre of a hold on a phone was difficult and needed many
undo-and-retry cycles.

So image detection is back in the plan, and snapping is the first thing built.
The raw per-decision timings are now exported (`tapMs`) so the next sweep can be
judged on its distribution rather than a median that hides retries.

### The strip is wired in spatial order

The exported data shows a **median jump of 0.052** (normalised) between
consecutive LED indices — successive LEDs land physically next to each other on
the wall. Two consequences worth using:

- **Automatic mis-tap detection.** A hold whose position is far from both its
  index neighbours is almost certainly a mis-tap. Flagging those turns hold-by-
  hold verification into reviewing a handful of outliers.

  *Validated on both real sweeps.* It flagged 1 hold in the desktop run and 0
  in the phone run. Crucially it did **not** flag the largest jump in either
  dataset (0.696, desktop LED 240): that is the strip wrapping from the right
  edge back to the left, and LED 240 sits right next to 241. Comparing against
  the *nearer* of the two neighbours is what separates a routing turn from a
  mis-tap — a naive "biggest jump" rule would have flagged the one hold that is
  certainly correct.
- **Sanity-check on import.** A calibration file whose jumps are large and
  unstructured was probably captured against the wrong photo or a different
  wall.

### Two decisions to lock early

- **One canonical wall photo**, captured at setup, used for all rendering.
  Allow re-shoots later via a homography fit. Never support arbitrary
  per-problem viewpoints.
- **Capture hold metadata during calibration**, while the user is already
  looking at each hold: colour, and rough type (jug/crimp/sloper/pinch/foot).
  One extra tap, and it is what makes spray-wall filtering work later.

## Architecture

### Tenancy

**The wall is the tenant.** A spray wall has 3–30 people who ever climb on it.
Problems, ticks, ratings, comments and lists are all scoped to one wall. Users
join by invite link or a QR code printed and stuck on the wall itself.

No global discovery, no cross-wall ranking, no moderation burden.

### Stack

- **React Native + Expo dev build** (not Expo Go — BLE needs native modules)
- **`react-native-ble-plx`** for BLE
- **Supabase** — Postgres fits the relational data exactly, and auth, photo
  storage and row-level security come free. Firebase is a workable alternative;
  Supabase wins on the relational model.
- **Local SQLite mirror.** You are in a garage or a basement with no signal, and
  lighting holds must work offline. Server is the source of truth, device holds
  a cache, ticks queue and push.

Flutter + `flutter_blue_plus` is an equally solid client choice if Dart is
preferred. A web/PWA is ruled out: iOS Safari has no Web Bluetooth.

### Data model

The parts that are painful to retrofit:

```
wall            id, name, photo_url, led_count, angle_adjustable, created_by
wall_member     wall_id, user_id, role
hold            id, wall_id, x, y, led_index, colour, type
problem         id, wall_id, name, setter_id, created_at, proposed_grade, angle
problem_hold    problem_id, hold_id, role   -- start | hand | foot | finish
tick            id, problem_id, user_id, date, attempts, type,
                user_grade, user_stars, comment
comment         id, problem_id, user_id, body, created_at
list            id, wall_id, name, owner_id
list_item       list_id, problem_id, position
```

Notes on the non-obvious choices:

- **Proposed grade and consensus grade are different things.** The setter
  proposes; each tick carries the climber's own grade and stars; the displayed
  grade is the aggregate. This is how MoonBoard and Kilter work and it is what
  makes a catalog trustworthy.
- **Ticks are events, not a boolean.** The logbook, the consensus grade and the
  "completed" filter all fall out of one table.
- **Angle belongs to the grade**, not the problem, if the wall is adjustable.
  Model it from the start even if only one angle is ever used.
- **Hold-based filtering** ("show me problems using this hold") is nearly free
  given `problem_hold`, and on a spray wall where you are working one section it
  is among the most-used filters. Signature feature, minimal cost.

## Phases

**0 — Spike.** nRF Connect, hand-send one Aurora API3 packet to the board,
confirm the GATT layout and that the advertised-UUID mismatch does not bite.
Negotiate MTU 247 on Android; chunk writes to MTU−3. *Half a day.*

**1 — Protocol module. DONE.** `packages/aurora-protocol` — zero-dependency
TypeScript codec for the Aurora wire format. `encodeFrame()`, `decodeFrame()`,
`verifyPacket()`, `chunkPacket()`, and the NUS transport UUIDs. The decoder
suite is ported vector-for-vector from the firmware's `tests/parse/src/main.c`,
so a divergence from the controller fails a test rather than showing up on the
wall. 52 tests, clean strict-mode typecheck. See its README for the wire format
and the colour-fidelity constraints.

**Verified against hardware on 2026-09-21.** Frames generated by `encodeFrame()`
lit the physical board correctly — right LEDs, right colours, including index
249 at the far end of the 250-LED chain. Packets went out in 20-byte writes and
the firmware reassembled them: the same chunking path the mobile app takes.
`npm run smoke` repeats the test.

**2 — Wall onboarding. DONE.** Photo capture, manual tap sweep, persist the hold and
LED map, tap a hold and watch it light up. The riskiest and most important
surface in the product. Build it before anything else and test end to end on a
real wall.

*Prototyped.* `prototypes/calibration-web` ran the sweep on the real wall and
timed it: **2m05s for 250 LEDs, median 374 ms per decision.** Manual
calibration is not a barrier, so there is no camera-assisted phase to build.

*In progress:* `apps/mobile` — Expo SDK 57 / RN 0.86, `react-native-ble-plx`,
sharing the codec through an npm workspace. Carries the prototype's interaction
across (light, tap, auto-advance, no-hold, undo, verify, autosave) plus
pinch/pan zoom, which the desktop prototype did not need, and the neighbour
outlier check. Still to do: run the sweep on a phone and re-measure, since the
374 ms figure came from a mouse.

*Verified on device (2026-09-21).* Built with JDK 21, installed on a Pixel 6a,
and connected to the board: the status chip read `Kilter Board#1@3 · MTU 23`.
Scan-by-name, connect and GATT discovery all work from the phone.

**Firmware MTU raised (2026-09-21).** The controller used to cap the ATT MTU at
Zephyr's default of 23, so every write carried at most 20 bytes. `prj.conf` now
sets `CONFIG_BT_L2CAP_TX_MTU=247`, `CONFIG_BT_BUF_ACL_{RX,TX}_SIZE=251` and
`CONFIG_BT_CTLR_DATA_LENGTH_MAX=251` (the last so the link layer does not
re-fragment on air), rebuilt and flashed over J-Link.

Measured after reflash: largest single write 244 bytes, so the MTU is exactly
247. **A full 250-LED frame went from 39 writes to 4**, and `board.ts` now sizes
each packet to one write rather than chunking. Costs ~4 KB of RAM (40.6% used).
This matters most in phase 3, when flicking through a problem list repaints the
wall constantly.

**3 — Single-user catalog. DONE.** Create problems with hold roles, browse, filter,
tick. Local only. Proves the data model.

*Decided (2026-09-23):*

- **Grades in both Font and V.** Stored once, as an index into one ordered
  scale where every step carries both labels (`apps/mobile/src/lib/grades.ts`);
  a setting picks Font, V or both for display. Consensus grades will be an
  average of indices, so Font and V climbers' grades combine.
- **Fixed and adjustable walls.** A wall is fixed (one angle) or adjustable
  (a list of angles, plus the angle it is set to now). A problem records the
  angle it was set, and graded, at; ticks will record the angle climbed at.
- **Roles: start, hand, no-match, foot, finish.** No-match is a hand hold you
  may not match on, lit magenta — the exact-reproducible colour least like
  hand's blue.

*Slice 1, the core loop — built:* create a problem by picking a role and
tapping holds (the wall lights it live as you go), name, grade and angle it,
save, list, view (lights on open), edit, delete. Expo Router for navigation;
storage moved from AsyncStorage to SQLite, seeded once from the old store.

*The rule that matters:* **a hold a problem uses can never vanish.** Undo,
re-detection and reset all keep such holds (undo unmaps rather than deletes),
deleting one in Edit holds is refused with the list of problems using it, and
the database enforces the same with a foreign key `ON DELETE RESTRICT` — tested
against real SQLite.

*Slice 2, ticks — built.* An ascent records the angle climbed at, attempts,
the climber's grade, 1–3 stars and a note. A flash is a first ascent in one go
(a one-go repeat is not). The consensus grade at the set angle counts the
setter as one vote and each graded ascent as another; at other angles only
ascents there count. Logbook of every ascent.

*Slice 3, filters — built.* Search, grade range on the consensus grade (a V
bound spans every Font step inside it: "up to V3" includes 6A+), minimum
stars, ticked or not, set at the wall's current angle, and problems using
every chosen hold (picked on the photo). Six sorts. Remembered across
launches, except the search text.

*Slice 4, lists and circuits — built.* Named, ordered lists; add or remove a
problem from its own page; reorder. Circuit mode steps through a list,
lighting each problem as it comes up, with a tick button and progress bar.

*Verified on the Pixel (2026-09-23)* by driving every slice through the UI:
upgrade of the live database from schema v1 to v3 in place, problems on all
five roles, a flash tick moving the consensus (6A setter + 6A+ tick → 6A+),
each filter, reorder, the circuit, and cleanup with the hold table hashing
identically before and after.

*Bug found and fixed on the way:* screens filled the photo to the canvas
width, which crops a tall wall top and bottom — in the editor the top row of
holds was cut in half and everything above it unreachable, since the pan
limits assume the photo fits. Photos now fit whole (`lib/fit.ts`).

*Known gap:* the app cannot tell when its chain length exceeds the strip's.
The test calibration says 500 LEDs; the controller drives 250, and silently
drops anything past the end. The firmware is write-only, so only the native
mode in phase 5 (which reports chain length back) can close this.

**4 — Multi-user.** Supabase, auth, wall membership via QR and invite link,
sync, ratings, comments, consensus grades.

**5 — Firmware native mode.** Add an `OPENBOARD` board type with full 24-bit
RGB, config read/write, and notifications back to the app (board mode, chain
length, firmware version, per-packet ack). Keep the emulation modes so vendor
apps still work. Genuinely optional — the board already does what the app
needs.

## On forking boardsesh

Borrow, do not fork. Its core assumption is a known fixed layout synced from a
vendor database, and this product inverts exactly that assumption. Forking means
fighting its data model. Lift its BLE and protocol handling, which is the part
that transfers, and build the catalog fresh.
