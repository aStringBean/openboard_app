# Calibration prototype

A throwaway web page for answering one question before any app scaffolding
exists: **how long does it actually take to map a spray wall by hand?**

PLAN.md phase 5 (camera-assisted calibration) is worth building only if the
manual sweep is genuinely painful. This measures that instead of guessing. The
timing panel is the deliverable; the UI is disposable.

It drives the board through `@openboard/aurora-protocol` over Web Bluetooth, so
it doubles as a second end-to-end check of the codec.

## Running it

```shell
node serve.mjs
# http://localhost:8080/prototypes/calibration-web/index.html
```

Then open it with the launcher, **not** by pasting the URL into your normal
browser window:

```shell
./launch-chrome.sh
```

Chrome ships Web Bluetooth **disabled by default on Linux**, so a normal Chrome
window reports no Web Bluetooth even though Chrome supports it. The launcher
passes `--enable-features=WebBluetooth` and uses its own profile directory,
because handing that flag to an already-running Chrome does nothing — the URL
is just forwarded to the existing process, flag and all ignored. The equivalent
manual fix is `chrome://flags/#enable-web-bluetooth`, then a full restart of
every Chrome window.

Firefox and Safari have no Web Bluetooth at all. The server roots at
`openboard_app/` so the page can import the codec's `dist/`; build it first if
you have not:

```shell
cd ../../packages/aurora-protocol && npm run build
```

Serving over `localhost` is what makes Web Bluetooth available (it counts as a
secure context), which is why this needs a server rather than a `file://` open.

## The sweep

1. **Connect board** — picks any Aurora-family device by name.
2. Load a photo of your wall, set the chain length.
3. **Start sweep.** One LED lights; click where it appears on the photo. The
   page advances automatically.
   - `space` — no hold at this LED (still timed; skips are part of the cost)
   - `u` — undo the last decision
4. **Verify mode** — click a mapped hold and the board lights that LED. This is
   what catches an off-by-one early.
5. **Export JSON** — the hold map plus the calibration timings.

The hold map autosaves to `localStorage` after every decision, so you can stop
and resume. The photo is not saved; re-pick it after a reload.

## What to look at afterwards

`Median / tap` and `Projected total` in the progress panel, and the
`calibration` block in the exported JSON:

```json
"calibration": { "totalMs": 0, "medianTapMs": null, "decisions": 0 }
```

Median per decision is the number that matters. Roughly: under ~2s means a
250-LED wall is a ten-minute job and phase 5 can wait; over ~5s means manual
calibration is a genuine barrier to onboarding and the camera sweep should move
up the plan.

## Output format

```json
{
  "version": 1,
  "chainLength": 250,
  "image": { "width": 4032, "height": 3024 },
  "holds": [{ "led": 0, "x": 0.31204, "y": 0.72119 }],
  "noHold": [7, 19],
  "calibration": { "totalMs": 0, "medianTapMs": null, "decisions": 0 }
}
```

Coordinates are normalised to the image, so they survive resizing and any
display size. `noHold` records LED positions with no hold next to them —
worth keeping, since it distinguishes "not yet done" from "nothing there".
