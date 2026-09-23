import { AlphaType, ColorType, Skia } from "@shopify/react-native-skia";
import { detectHolds, type DetectedHold } from "@openboard/hold-detect";

/**
 * Analysis size. A phone photo is ~4000px wide; reading that many pixels back
 * from the GPU would cost ~48 MB and tell the detector nothing it cannot see
 * at a fraction of the size.
 */
const ANALYSIS_MAX_DIM = 640;

/**
 * Decodes the wall photo, scales it down on the GPU, reads the pixels back and
 * runs hold detection over them.
 *
 * The scaling happens in Skia rather than in the detector so that only the
 * small buffer ever crosses into JS.
 */
export async function detectHoldsInPhoto(uri: string): Promise<DetectedHold[]> {
  const data = await Skia.Data.fromURI(uri);
  const source = Skia.Image.MakeImageFromEncoded(data);

  if (!source) {
    throw new Error("Could not decode that photo.");
  }

  const scale = Math.min(1, ANALYSIS_MAX_DIM / Math.max(source.width(), source.height()));
  const w = Math.max(1, Math.round(source.width() * scale));
  const h = Math.max(1, Math.round(source.height() * scale));

  const surface = Skia.Surface.MakeOffscreen(w, h);
  if (!surface) {
    throw new Error("Could not allocate an image surface.");
  }

  surface.getCanvas().drawImageRect(
    source,
    { x: 0, y: 0, width: source.width(), height: source.height() },
    { x: 0, y: 0, width: w, height: h },
    Skia.Paint(),
  );
  surface.flush();

  const snapshot = surface.makeImageSnapshot();
  const pixels = snapshot.readPixels(0, 0, {
    width: w,
    height: h,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });

  if (!pixels) {
    throw new Error("Could not read the photo's pixels.");
  }

  /* Already at analysis size, so the detector's own downscale is a no-op. */
  return detectHolds({ width: w, height: h, data: new Uint8Array(pixels.buffer) });
}
