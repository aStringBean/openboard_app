import type { RgbaImage } from "./types.js";

/**
 * Box-filter downscale. Detection gains nothing from a 4000px phone photo and
 * loses a lot of time to it, and averaging also suppresses sensor grain that
 * would otherwise survive thresholding as speckle.
 */
export function downscale(img: RgbaImage, maxDim: number): RgbaImage {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  if (scale >= 1) return img;

  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8Array(w * h * 4);

  const xStep = img.width / w;
  const yStep = img.height / h;

  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * yStep);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * yStep));

    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * xStep);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xStep));

      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * img.width + sx) * 4;
          r += img.data[i]!;
          g += img.data[i + 1]!;
          b += img.data[i + 2]!;
          n++;
        }
      }

      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }

  return { width: w, height: h, data: out };
}
