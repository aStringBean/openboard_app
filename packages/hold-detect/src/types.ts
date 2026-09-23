/** Tightly packed RGBA, as `Skia.Image.readPixels()` and most decoders give it. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** A detected hold. Coordinates are normalised to the image, 0..1. */
export interface DetectedHold {
  x: number;
  y: number;
  /** Fraction of the image this blob covers — useful for ranking and filtering. */
  area: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface DetectOptions {
  /**
   * Longest side the image is reduced to before analysis. Detection does not
   * get better with more pixels, and a phone photo is 4000px wide.
   */
  maxDim?: number;
  /** Blob size bounds, as a fraction of the analysed image. */
  minAreaFrac?: number;
  maxAreaFrac?: number;
  /** Morphological opening radius, in analysed pixels. Removes speckle. */
  openRadius?: number;
  /**
   * Smallest distance-to-background a hold centre may have, in analysed
   * pixels — roughly the half-width of the thinnest hold to find. Low enough
   * for rails and edges, which are long but only a few pixels across.
   */
  minRadius?: number;
}

export const DEFAULTS = {
  maxDim: 640,
  /* A 250-hold wall photographed whole puts each hold at well under 1% of the
   * frame; the lower bound is what rejects grain and t-nuts. */
  minAreaFrac: 0.0002,
  maxAreaFrac: 0.05,
  openRadius: 1,
  minRadius: 2.2,
} as const;
