/**
 * Perspective maths for straightening a wall photo: the homography that takes
 * the unit square onto the four corners of the board as photographed, and
 * back.
 *
 * Everything works in normalised coordinates (0..1 across the photo), the
 * same space holds are stored in. A homography survives rescaling an axis, so
 * the pixel sizes of the photo and of the straightened result only come in
 * when the image itself is drawn.
 */

export interface Pt {
  x: number;
  y: number;
}

/** A board's corners: top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Pt, Pt, Pt, Pt];

/** A 3x3 matrix, row-major, mapping (x, y, 1). The layout Skia takes. */
export type Mat3 = readonly number[];

/**
 * The homography taking the unit square onto a quad: (0,0) to its first
 * corner, (1,0) to the second, (1,1) to the third and (0,1) to the fourth.
 * Heckbert's closed form, so there is no system to solve.
 */
export function squareToQuad([p0, p1, p2, p3]: Quad): Mat3 {
  const dx1 = p1.x - p2.x,
    dx2 = p3.x - p2.x,
    dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y,
    dy2 = p3.y - p2.y,
    dy3 = p0.y - p1.y + p2.y - p3.y;

  const den = dx1 * dy2 - dx2 * dy1;
  /* A parallelogram (photographed square-on) needs no perspective terms. */
  const g = den === 0 ? 0 : (dx3 * dy2 - dx2 * dy3) / den;
  const h = den === 0 ? 0 : (dx1 * dy3 - dx3 * dy1) / den;

  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1,
  ];
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const m: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      m.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!);
    }
  }
  return m;
}

export function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h,
    B = f * g - d * i,
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (det === 0) throw new Error("A degenerate quad has no inverse.");
  return [
    A / det, (c * h - b * i) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, (c * d - a * f) / det,
    C / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
}

export const scaling = (sx: number, sy: number): Mat3 => [sx, 0, 0, 0, sy, 0, 0, 0, 1];

export function apply(m: Mat3, { x, y }: Pt): Pt {
  const w = m[6]! * x + m[7]! * y + m[8]!;
  return { x: (m[0]! * x + m[1]! * y + m[2]!) / w, y: (m[3]! * x + m[4]! * y + m[5]!) / w };
}

/**
 * Whether the corners make a board: convex, and in order clockwise on screen
 * (top-left, top-right, bottom-right, bottom-left). Dragging two corners
 * past each other makes a bow tie, which no photo of a flat board can show.
 */
export function isBoard(q: Quad): boolean {
  for (let i = 0; i < 4; i++) {
    const a = q[i]!,
      b = q[(i + 1) % 4]!,
      c = q[(i + 2) % 4]!;
    /* y grows downwards, so a clockwise turn on screen is a positive cross product. */
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) return false;
  }
  return true;
}
