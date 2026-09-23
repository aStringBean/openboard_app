/**
 * The largest size a photo can take inside a box while staying whole — CSS
 * "contain". Filling the width instead crops a tall wall top and bottom, and
 * the cropped strips could never be reached: at zoom 1 there is no panning,
 * and the pan limits assume the photo fits.
 */
export function fitPhoto(boxWidth: number, boxHeight: number, aspect: number): { width: number; height: number } {
  if (!(boxWidth > 0 && boxHeight > 0 && aspect > 0)) return { width: 0, height: 0 };
  const width = Math.min(boxWidth, boxHeight * aspect);
  return { width, height: width / aspect };
}
