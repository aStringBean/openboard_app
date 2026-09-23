/**
 * Otsu's threshold: the split that minimises within-class variance. Chosen
 * because it needs no tuning — a dim garage photo and a bright gym one land on
 * different values on their own.
 */
export function otsuThreshold(score: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (const v of score) hist[v]!++;

  const total = score.length;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v]!;

  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;

  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;

    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * hist[t]!;

    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);

    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }

  return best;
}
