/**
 * The problems a problem page can swipe between: the list it was opened from,
 * in the order that list showed them, taken at the moment of the tap. Pure,
 * so it can be tested in Node.
 */

let order: readonly string[] = [];

/** Called as a problem is opened from a list, with that list as shown. Each
 * problem once, in first-appearance order. */
export function browseFrom(ids: readonly string[]): void {
  order = [...new Set(ids)];
}

/** Opened from somewhere that is not a list: nothing to swipe to. */
export function browseNothing(): void {
  order = [];
}

export interface Neighbours {
  prev: string | null;
  next: string | null;
  /** 1-based, for "3 of 17". */
  position: number;
  count: number;
}

/** Where a problem sits in the list it was opened from; null if it is not in
 * it (opened from elsewhere, or deleted from the list since). */
export function neighbours(id: string): Neighbours | null {
  const i = order.indexOf(id);
  if (i < 0 || order.length < 2) return null;
  return {
    prev: i > 0 ? order[i - 1]! : null,
    next: i < order.length - 1 ? order[i + 1]! : null,
    position: i + 1,
    count: order.length,
  };
}
