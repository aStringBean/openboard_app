/**
 * Generates a demo "show" using the real codec, as JSON for send.py.
 *
 * This is the point of the harness: the bytes that reach the wall come from
 * encodeFrame(), not from a hand-written vector, so lighting the board end to
 * end is a genuine test of the package.
 *
 *   node tools/frames.mjs [chainLength] > show.json
 */
import { encodeAllOff, encodeFrame } from "../dist/index.js";

const CHAIN = Number(process.argv[2] ?? 250);

/* Packets are kept small enough to be comfortable on any MTU, which also
 * forces fragmentation on the bigger frames. */
const OPTS = { maxPacketBytes: 180 };

const hex = (packets) => packets.map((p) => Buffer.from(p).toString("hex"));

/* The eight colours API 3 reproduces exactly. */
const RED = { r: 255, g: 0, b: 0 };
const GREEN = { r: 0, g: 255, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };
const MAGENTA = { r: 255, g: 0, b: 255 };
const CYAN = { r: 0, g: 255, b: 255 };
const YELLOW = { r: 255, g: 255, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

const step = (name, note, leds, holdMs = 1800) => ({
  name,
  note,
  holdMs,
  packets: hex(leds === null ? encodeAllOff(OPTS) : encodeFrame(leds, OPTS)),
});

const at = (pos, colour) => ({ pos, ...colour });

const show = [
  step("blank", "clear the wall", null, 800),

  step(
    "palette",
    "the eight exactly-representable colours, LEDs 0-6",
    [
      at(0, RED),
      at(1, GREEN),
      at(2, BLUE),
      at(3, YELLOW),
      at(4, MAGENTA),
      at(5, CYAN),
      at(6, WHITE),
    ],
    2500,
  ),

  step(
    "problem",
    "a plausible problem: green start, blue hands, yellow feet, red finish",
    [
      at(12, GREEN),
      at(18, GREEN),
      at(47, BLUE),
      at(63, BLUE),
      at(88, BLUE),
      at(104, BLUE),
      at(31, YELLOW),
      at(55, YELLOW),
      at(140, RED),
    ],
    3000,
  ),

  step(
    "sparse-far",
    "highest and lowest index, proving 16 bit positions reach the strip end",
    [at(0, WHITE), at(CHAIN - 1, WHITE)],
    2000,
  ),

  step(
    "fragmented",
    `every LED 0-${CHAIN - 1} in a repeating ramp — forces multi-packet fragmentation`,
    Array.from({ length: CHAIN }, (_, i) =>
      at(i, [RED, GREEN, BLUE, YELLOW, MAGENTA, CYAN][i % 6]),
    ),
    3000,
  ),

  step("blank-again", "empty frame clears the wall", null, 500),
];

process.stdout.write(JSON.stringify({ chain: CHAIN, show }, null, 2));
