/**
 * Runs hold detection on a real photo and writes an annotated copy, so the
 * result can be judged by eye before any of it reaches the app.
 *
 *   node tools/detect.mjs wall.jpg [out.png]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

import { detectHolds } from "../dist/index.js";

const [input, output = "detected.png"] = process.argv.slice(2);

if (!input) {
  console.error("usage: node tools/detect.mjs <wall.jpg|wall.png> [out.png]");
  process.exit(1);
}

const raw = readFileSync(input);
const ext = extname(input).toLowerCase();

const image =
  ext === ".png"
    ? (({ width, height, data }) => ({ width, height, data }))(PNG.sync.read(raw))
    : jpeg.decode(raw, { useTArray: true, formatAsRGBA: true });

console.log(`${input}: ${image.width}x${image.height}`);

const t = performance.now();
const holds = detectHolds(image);
const ms = performance.now() - t;

console.log(`detected ${holds.length} holds in ${ms.toFixed(0)} ms`);

if (holds.length) {
  const areas = holds.map((h) => h.area).sort((a, b) => a - b);
  const med = areas[areas.length >> 1];
  console.log(`median hold area: ${(med * 100).toFixed(3)}% of frame`);
}

/* Annotate: a ring at every centroid, on a copy of the original. */
const png = new PNG({ width: image.width, height: image.height });
png.data.set(image.data.subarray(0, png.data.length));

const r = Math.max(4, Math.round(Math.min(image.width, image.height) / 120));

for (const hold of holds) {
  const cx = Math.round(hold.x * image.width);
  const cy = Math.round(hold.y * image.height);

  for (let a = 0; a < 360; a += 2) {
    for (const rr of [r, r - 1]) {
      const x = Math.round(cx + rr * Math.cos((a * Math.PI) / 180));
      const y = Math.round(cy + rr * Math.sin((a * Math.PI) / 180));
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;

      const i = (y * image.width + x) * 4;
      png.data[i] = 0;
      png.data[i + 1] = 255;
      png.data[i + 2] = 128;
      png.data[i + 3] = 255;
    }
  }
}

writeFileSync(output, PNG.sync.write(png));
console.log(`annotated image written to ${output}`);
