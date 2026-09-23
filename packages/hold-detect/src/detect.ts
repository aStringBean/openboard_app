import { connectedComponents } from "./components.js";
import { downscale } from "./resize.js";
import { open } from "./morphology.js";
import { otsuThreshold } from "./otsu.js";
import { findPeaks } from "./peaks.js";
import { scorePixels } from "./score.js";
import { DEFAULTS, type DetectOptions, type DetectedHold, type RgbaImage } from "./types.js";

/**
 * Finds holds in a photo of a wall.
 *
 * Deliberately permissive: the app snaps a tap to the nearest detected hold
 * and falls back to the raw tap when nothing is near, so a missed hold costs
 * one careful tap while a spurious one costs a wrong snap. Recall is worth
 * more than precision here.
 *
 * Holds are located by peaks in the distance transform rather than by blob
 * centroids. On a dense wall, neighbouring holds touch and merge into one
 * blob, whose centroid lands in the gap between them — losing both. Their
 * distance fields still peak separately.
 */
export function detectHolds(image: RgbaImage, options: DetectOptions = {}): DetectedHold[] {
  const maxDim = options.maxDim ?? DEFAULTS.maxDim;
  const minAreaFrac = options.minAreaFrac ?? DEFAULTS.minAreaFrac;
  const maxAreaFrac = options.maxAreaFrac ?? DEFAULTS.maxAreaFrac;
  const openRadius = options.openRadius ?? DEFAULTS.openRadius;
  const minRadius = options.minRadius ?? DEFAULTS.minRadius;

  const img = downscale(image, maxDim);
  const { width: w, height: h } = img;
  const pixels = w * h;

  const score = scorePixels(img);
  const threshold = otsuThreshold(score);

  const mask = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) mask[i] = score[i]! > threshold ? 1 : 0;

  const cleaned = open(mask, w, h, openRadius);
  const { components, labels } = connectedComponents(cleaned, w, h);

  /* Drop grain and anything wall-sized before looking for centres, so the
   * peak finder only ever sees plausible holds. */
  const minArea = minAreaFrac * pixels;
  const maxArea = maxAreaFrac * pixels;
  const keep = components.map((c) => c.area >= minArea && c.area <= maxArea);

  const holdMask = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const id = labels[i]!;
    holdMask[i] = id >= 0 && keep[id] ? 1 : 0;
  }

  const peaks = findPeaks(holdMask, w, h, minRadius);

  /* A blob's area is shared out between the peaks found inside it, so a hold
   * split out of a merged pair still reports a believable size. */
  const peakCount = new Int32Array(components.length);
  for (const peak of peaks) {
    const id = labels[Math.round(peak.y) * w + Math.round(peak.x)]!;
    if (id >= 0) peakCount[id]!++;
  }

  return peaks
    .map((peak) => {
      const id = labels[Math.round(peak.y) * w + Math.round(peak.x)]!;
      const comp = id >= 0 ? components[id] : undefined;
      const share = id >= 0 ? Math.max(1, peakCount[id]!) : 1;
      const area = comp ? comp.area / share / pixels : (Math.PI * peak.r * peak.r) / pixels;

      return {
        x: peak.x / w,
        y: peak.y / h,
        area,
        bbox: {
          x0: (peak.x - peak.r) / w,
          y0: (peak.y - peak.r) / h,
          x1: (peak.x + peak.r) / w,
          y1: (peak.y + peak.r) / h,
        },
      };
    })
    .sort((a, b) => b.area - a.area);
}
