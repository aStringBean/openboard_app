import { FilterMode, ImageFormat, MipmapMode, Skia } from "@shopify/react-native-skia";

import { invert, multiply, scaling, squareToQuad, type Quad } from "./perspective";

/**
 * The straightened photo's longer side. Plenty to place holds by, and well
 * inside every phone GPU's texture limit.
 */
const MAX_DIM = 2048;

/**
 * Warps a wall photo so the board, marked by its corners, fills an image of
 * the board's own proportions — as if photographed square-on. Done on the GPU:
 * Skia draws the photo through the perspective matrix in one pass.
 *
 * Returns the result as JPEG bytes.
 */
export async function straightenPhoto(uri: string, corners: Quad, aspect: number): Promise<Uint8Array> {
  const source = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
  if (!source) throw new Error("Could not decode that photo.");

  const sw = source.width(),
    sh = source.height();

  /* No bigger than the board's longest edge in the photo: upscaling adds
   * nothing but file size. */
  const px = corners.map((p) => ({ x: p.x * sw, y: p.y * sh }));
  const edge = Math.max(...px.map((p, i) => Math.hypot(px[(i + 1) % 4]!.x - p.x, px[(i + 1) % 4]!.y - p.y)));
  const long = Math.round(Math.min(MAX_DIM, edge));
  const w = aspect >= 1 ? long : Math.max(1, Math.round(long * aspect));
  const h = aspect >= 1 ? Math.max(1, Math.round(long / aspect)) : long;

  const surface = Skia.Surface.MakeOffscreen(w, h);
  if (!surface) throw new Error("Could not allocate an image surface.");

  /* Photo pixels to normalised, onto the unit square, out to result pixels. */
  const m = multiply(scaling(w, h), multiply(invert(squareToQuad(corners)), scaling(1 / sw, 1 / sh)));

  const canvas = surface.getCanvas();
  canvas.concat(Skia.Matrix([...m]));
  /* Mipmaps, since most of the photo is shrunk, the far edge most of all. */
  const all = { x: 0, y: 0, width: sw, height: sh };
  canvas.drawImageRectOptions(source, all, all, FilterMode.Linear, MipmapMode.Linear);
  surface.flush();

  return surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 90);
}
