/**
 * Calibration prototype.
 *
 * The question this exists to answer: how long does it actually take to map a
 * spray wall by hand? Everything else here is throwaway — the timing panel is
 * the deliverable, because it decides whether camera-assisted calibration
 * (PLAN.md phase 5) needs to move up the list.
 *
 * Drives the board through the real codec, so it doubles as a second
 * end-to-end check of @openboard/aurora-protocol.
 */
import {
  chunkPacket,
  DEVICE_NAMES,
  encodeAllOff,
  encodeFrame,
  NUS_RX_CHAR_UUID,
  NUS_SERVICE_UUID,
} from "../../packages/aurora-protocol/dist/index.js";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "openboard.calibration.v1";

/* BlueZ commonly leaves the ATT MTU at 23, and this is the chunk size proven
 * against the hardware. */
const WRITE_CHUNK = 20;

const CALIBRATION_COLOUR = { r: 255, g: 255, b: 255 };
const VERIFY_COLOUR = { r: 0, g: 255, b: 255 };
const SHOW_ALL_COLOUR = { r: 0, g: 0, b: 255 };

// ---------------------------------------------------------------- board link

const board = {
  characteristic: null,

  get connected() {
    return this.characteristic !== null;
  },

  async connect() {
    if (!navigator.bluetooth) {
      /* Chrome still ships Web Bluetooth disabled by default on Linux, so
       * "I am using Chrome" is not enough — the flag has to be on. */
      throw new Error(
        isSecureContext
          ? "Web Bluetooth is off. Launch with ./launch-chrome.sh, or enable chrome://flags/#enable-web-bluetooth"
          : `Not a secure context (${location.origin}). Open the page over http://localhost.`,
      );
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: Object.values(DEVICE_NAMES).map((name) => ({ name })),
      optionalServices: [NUS_SERVICE_UUID],
    });

    device.addEventListener("gattserverdisconnected", () => {
      this.characteristic = null;
      setStatus("disconnected", "off");
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(NUS_SERVICE_UUID);

    this.characteristic = await service.getCharacteristic(NUS_RX_CHAR_UUID);

    return device.name ?? "board";
  },

  /** Writes one frame. Packets must not interleave, so calls are serialised. */
  async send(leds) {
    if (!this.connected) return;

    const packets = leds.length ? encodeFrame(leds) : encodeAllOff();

    for (const packet of packets) {
      for (const chunk of chunkPacket(packet, WRITE_CHUNK)) {
        await this.characteristic.writeValueWithoutResponse(chunk);
      }
    }
  },
};

/* One frame at a time, so a fast click-through cannot interleave packets. */
let queue = Promise.resolve();
const send = (leds) => {
  queue = queue.then(() => board.send(leds)).catch((err) => console.warn("send failed", err));
  return queue;
};

// ---------------------------------------------------------------- state

const state = {
  chain: 250,
  holds: new Map(), // led index -> { x, y } normalised 0..1
  skipped: new Set(),
  taps: [], // ms per decision, in order
  led: 0,
  mode: "idle", // idle | sweeping | verifying
  lastTapAt: 0,
  sweepStartedAt: 0,
  elapsedBefore: 0,
};

function save() {
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify({
      chain: state.chain,
      holds: [...state.holds],
      skipped: [...state.skipped],
      taps: state.taps,
      led: state.led,
      elapsed: totalElapsed(),
    }),
  );
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;

    const d = JSON.parse(raw);
    state.chain = d.chain ?? 250;
    state.holds = new Map(d.holds ?? []);
    state.skipped = new Set(d.skipped ?? []);
    state.taps = d.taps ?? [];
    state.led = d.led ?? 0;
    state.elapsedBefore = d.elapsed ?? 0;

    $("chain").value = state.chain;
    $("start").value = state.led;
  } catch (err) {
    console.warn("could not restore calibration", err);
  }
}

// ---------------------------------------------------------------- stats

const totalElapsed = () =>
  state.elapsedBefore + (state.sweepStartedAt ? Date.now() - state.sweepStartedAt : 0);

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const clock = (ms) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

function render() {
  const done = state.holds.size + state.skipped.size;
  const left = Math.max(0, state.chain - done);
  /* The last 20 decisions track the pace you settle into, which projects
   * better than an average dragged down by the first few. */
  const med = median(state.taps.slice(-20));

  $("s-mapped").textContent = state.holds.size;
  $("s-skipped").textContent = state.skipped.size;
  $("s-left").textContent = left;
  $("s-median").textContent = med === null ? "—" : `${(med / 1000).toFixed(1)}s`;
  $("s-elapsed").textContent = clock(totalElapsed());
  $("s-eta").textContent = med === null ? "—" : clock(totalElapsed() + med * left);
  $("bar-fill").style.width = `${(done / Math.max(1, state.chain)) * 100}%`;
  $("led-num").textContent = state.mode === "sweeping" ? state.led : "—";

  drawMarkers();
}

// ---------------------------------------------------------------- markers

function drawMarkers() {
  const box = $("markers");
  box.replaceChildren();

  const newest = state.taps.length ? [...state.holds.keys()].pop() : null;

  for (const [led, p] of state.holds) {
    const el = document.createElement("div");
    el.className = led === newest ? "marker recent" : "marker";
    el.style.left = `${p.x * 100}%`;
    el.style.top = `${p.y * 100}%`;
    el.innerHTML = `<span>${led}</span>`;
    box.append(el);
  }
}

// ---------------------------------------------------------------- sweep

function lightCurrent() {
  send([{ pos: state.led, ...CALIBRATION_COLOUR }]);
}

/** Next LED that has no decision recorded yet. */
function advance() {
  let next = state.led + 1;
  while (next < state.chain && (state.holds.has(next) || state.skipped.has(next))) next++;

  if (next >= state.chain) return finish();

  state.led = next;
  lightCurrent();
  render();
  save();
}

function recordDecision() {
  const now = Date.now();
  if (state.lastTapAt) state.taps.push(now - state.lastTapAt);
  state.lastTapAt = now;
}

function startSweep() {
  if (!board.connected) return alert("Connect the board first.");
  if (!$("img").src) return alert("Load a wall photo first.");

  state.chain = Number($("chain").value);
  state.led = Number($("start").value);
  state.mode = "sweeping";
  state.sweepStartedAt = Date.now();
  state.lastTapAt = Date.now();

  $("current-box").hidden = false;
  $("begin").disabled = true;
  $("stop").disabled = false;
  $("stage").classList.add("placing");
  $("verify").classList.remove("active");

  lightCurrent();
  render();
}

function stopSweep() {
  state.elapsedBefore = totalElapsed();
  state.sweepStartedAt = 0;
  state.mode = "idle";

  $("current-box").hidden = true;
  $("begin").disabled = false;
  $("stop").disabled = true;
  $("stage").classList.remove("placing");

  send([]);
  save();
  render();
}

function finish() {
  stopSweep();
  const med = median(state.taps) ?? 0;
  alert(
    `Sweep complete.\n\n` +
      `${state.holds.size} holds mapped, ${state.skipped.size} positions with no hold.\n` +
      `Total ${clock(totalElapsed())}, median ${(med / 1000).toFixed(1)}s per decision.`,
  );
}

// ---------------------------------------------------------------- input

$("stage").addEventListener("click", (e) => {
  if (!$("img").src) return;

  const rect = $("stage").getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;

  if (x < 0 || x > 1 || y < 0 || y > 1) return;

  if (state.mode === "sweeping") {
    state.holds.set(state.led, { x, y });
    state.skipped.delete(state.led);
    recordDecision();
    advance();
    return;
  }

  if (state.mode === "verifying") {
    let best = null;
    let bestD = Infinity;

    for (const [led, p] of state.holds) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) [best, bestD] = [led, d];
    }

    if (best !== null) {
      send([{ pos: best, ...VERIFY_COLOUR }]);
      $("photo-hint").textContent = `Verifying LED ${best} — it should light on the wall.`;
    }
  }
});

function skip() {
  if (state.mode !== "sweeping") return;
  state.skipped.add(state.led);
  state.holds.delete(state.led);
  recordDecision();
  advance();
}

function undo() {
  const prev = [...state.holds.keys(), ...state.skipped].sort((a, b) => a - b).pop();
  if (prev === undefined) return;

  state.holds.delete(prev);
  state.skipped.delete(prev);
  state.taps.pop();
  state.led = prev;

  if (state.mode === "sweeping") lightCurrent();
  render();
  save();
}

addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;

  if (e.code === "Space") {
    e.preventDefault();
    skip();
  } else if (e.key === "u") {
    undo();
  }
});

// ---------------------------------------------------------------- wiring

$("connect").addEventListener("click", async () => {
  try {
    setStatus("connecting…", "off");
    const name = await board.connect();
    setStatus(name, "on");
    await send([]);
  } catch (err) {
    setStatus(err.message.slice(0, 60), "err");
    console.error(err);
  }
});

function setStatus(text, cls) {
  const el = $("status");
  el.textContent = text;
  el.className = `status ${cls}`;
}

$("photo").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const img = $("img");

  img.src = url;
  img.hidden = false;
  $("empty").hidden = true;
});

$("zoom").addEventListener("input", (e) => {
  $("stage").style.width = `${e.target.value}%`;
});

$("begin").addEventListener("click", startSweep);
$("stop").addEventListener("click", stopSweep);
$("skip").addEventListener("click", skip);
$("undo").addEventListener("click", undo);
$("relight").addEventListener("click", lightCurrent);
$("blank").addEventListener("click", () => send([]));

$("showall").addEventListener("click", () => {
  send([...state.holds.keys()].map((pos) => ({ pos, ...SHOW_ALL_COLOUR })));
});

$("verify").addEventListener("click", () => {
  if (state.mode === "sweeping") stopSweep();

  state.mode = state.mode === "verifying" ? "idle" : "verifying";
  $("verify").classList.toggle("active", state.mode === "verifying");
  $("stage").classList.toggle("verifying", state.mode === "verifying");
  $("photo-hint").textContent =
    state.mode === "verifying"
      ? "Click a mapped hold; the board should light that LED."
      : "The photo is not saved across reloads; the hold map is.";
});

$("export").addEventListener("click", () => {
  const img = $("img");
  const payload = {
    version: 1,
    chainLength: state.chain,
    image: { width: img.naturalWidth, height: img.naturalHeight },
    holds: [...state.holds]
      .sort((a, b) => a[0] - b[0])
      .map(([led, p]) => ({ led, x: +p.x.toFixed(5), y: +p.y.toFixed(5) })),
    noHold: [...state.skipped].sort((a, b) => a - b),
    calibration: {
      totalMs: totalElapsed(),
      medianTapMs: median(state.taps),
      decisions: state.taps.length,
      tapMs: state.taps,
    },
  };

  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "wall-calibration.json";
  a.click();
  URL.revokeObjectURL(url);
});

$("reset").addEventListener("click", () => {
  if (!confirm("Discard the hold map and all timings?")) return;

  state.holds.clear();
  state.skipped.clear();
  state.taps = [];
  state.led = Number($("start").value);
  state.elapsedBefore = 0;
  state.sweepStartedAt = 0;

  localStorage.removeItem(STORE_KEY);
  send([]);
  render();
});

$("chain").addEventListener("change", (e) => {
  state.chain = Number(e.target.value);
  render();
  save();
});

load();
render();
setInterval(() => state.mode === "sweeping" && render(), 1000);
