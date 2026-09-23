import { boxBlur } from "./blur.js";
import type { RgbaImage } from "./types.js";

/**
 * Scores every pixel by how unlike the wall it is.
 *
 * The wall is whatever dominates the frame, so its colour is taken as the
 * per-channel median rather than assumed. A pixel then scores on whichever of
 * two differences is larger:
 *
 * - **chromaticity**, which catches coloured holds while ignoring shadow,
 *   since dividing out brightness makes shaded plywood look like lit plywood;
 * - **luminance**, which catches the black and white holds that a chroma-only
 *   measure would miss entirely, having barely any chroma to differ in.
 *
 * Luminance is compared against a heavily blurred copy of the image rather
 * than one global value. A shadow or a vignette is low-frequency and is
 * absorbed into that local baseline; a hold is small and sharp and still
 * stands out against it. A single global brightness would report every shaded
 * patch of plywood as a hold.
 */
export function scorePixels(img: RgbaImage): Uint8Array {
  const n = img.width * img.height;
  const score = new Uint8Array(n);

  const [bgR, bgG, bgB] = medianColour(img);
  const bgSum = Math.max(1, bgR + bgG + bgB);
  const bgCr = bgR / bgSum;
  const bgCg = bgG / bgSum;
  /* Local brightness baseline. The radius is a good fraction of the frame, so
   * it tracks lighting across the wall without following individual holds. */
  const lumaPlane = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lumaPlane[i] = luma(img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!);
  }
  const localLuma = boxBlur(
    lumaPlane,
    img.width,
    img.height,
    Math.max(4, Math.round(Math.max(img.width, img.height) / 12)),
  );

  for (let i = 0; i < n; i++) {
    const r = img.data[i * 4]!;
    const g = img.data[i * 4 + 1]!;
    const b = img.data[i * 4 + 2]!;

    const sum = r + g + b;
    const l = lumaPlane[i]!;

    /* Chromaticity is meaningless where there is almost no light, so very dark
     * pixels are judged on brightness alone. */
    let chroma = 0;
    if (sum > 30) {
      const dCr = r / sum - bgCr;
      const dCg = g / sum - bgCg;
      chroma = Math.hypot(dCr, dCg) * CHROMA_GAIN;
    }

    const lumaDiff = (Math.abs(l - localLuma[i]!) / 255) * LUMA_GAIN;

    score[i] = Math.min(255, Math.round(Math.max(chroma, lumaDiff) * 255));
  }

  return score;
}

/* Chromaticity differences are small numbers — a strongly coloured hold sits
 * around 0.15 from plywood — so they need more gain than luminance. */
const CHROMA_GAIN = 4;
const LUMA_GAIN = 1.6;

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Per-channel median over a subsample; the wall dominates, so this is its colour. */
function medianColour(img: RgbaImage): [number, number, number] {
  const hr = new Uint32Array(256);
  const hg = new Uint32Array(256);
  const hb = new Uint32Array(256);
  const n = img.width * img.height;
  /* Every pixel is unnecessary for a median this coarse. */
  const step = Math.max(1, Math.floor(n / 20000));
  let count = 0;

  for (let i = 0; i < n; i += step) {
    const r = img.data[i * 4]!;
    const g = img.data[i * 4 + 1]!;
    const b = img.data[i * 4 + 2]!;

    hr[r] = hr[r]! + 1;
    hg[g] = hg[g]! + 1;
    hb[b] = hb[b]! + 1;
    count++;
  }

  return [hr, hg, hb].map((h) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += h[v]!;
      if (seen >= count / 2) return v;
    }
    return 128;
  }) as [number, number, number];
}
