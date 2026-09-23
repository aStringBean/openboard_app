/**
 * One ordered difficulty scale, with a Font and a V label on every step.
 *
 * A grade is stored as its index here, never as text. So a problem graded
 * 6A+ by one climber and V3 by another lands on comparable numbers, sorting
 * and filtering work across both scales, and a consensus grade is just an
 * average of indices.
 *
 * Font is the finer scale through the middle grades (6A and 6A+ are both V3),
 * so it sets the steps and V labels repeat.
 */
export const GRADES = [
  { font: "4", v: "V0" },
  { font: "4+", v: "V0" },
  { font: "5", v: "V1" },
  { font: "5+", v: "V2" },
  { font: "6A", v: "V3" },
  { font: "6A+", v: "V3" },
  { font: "6B", v: "V4" },
  { font: "6B+", v: "V4" },
  { font: "6C", v: "V5" },
  { font: "6C+", v: "V5" },
  { font: "7A", v: "V6" },
  { font: "7A+", v: "V7" },
  { font: "7B", v: "V8" },
  { font: "7B+", v: "V8" },
  { font: "7C", v: "V9" },
  { font: "7C+", v: "V10" },
  { font: "8A", v: "V11" },
  { font: "8A+", v: "V12" },
  { font: "8B", v: "V13" },
  { font: "8B+", v: "V14" },
  { font: "8C", v: "V15" },
  { font: "8C+", v: "V16" },
] as const;

export type GradeScale = "font" | "v" | "both";

/** 6A / V3: a sensible starting point for a new problem. */
export const DEFAULT_GRADE = 4;

export const isGrade = (i: number): boolean =>
  Number.isInteger(i) && i >= 0 && i < GRADES.length;

export function gradeLabel(index: number, scale: GradeScale): string {
  const g = GRADES[index];
  if (!g) return "?";
  if (scale === "font") return g.font;
  if (scale === "v") return g.v;
  return `${g.font} / ${g.v}`;
}

export interface GradeOption {
  index: number;
  label: string;
}

/**
 * The choices a grade picker offers. In V, each V grade appears once and
 * stands for the lowest Font grade it covers — a V climber cannot express the
 * difference between 6A and 6A+, so offering both would be two identical
 * buttons.
 */
export function gradeOptions(scale: GradeScale): GradeOption[] {
  if (scale !== "v") {
    return GRADES.map((_, index) => ({ index, label: gradeLabel(index, scale) }));
  }

  const seen = new Set<string>();
  const out: GradeOption[] = [];
  GRADES.forEach((g, index) => {
    if (seen.has(g.v)) return;
    seen.add(g.v);
    out.push({ index, label: g.v });
  });
  return out;
}

/**
 * The index to store when a picker option is chosen. Picking the V grade a
 * problem already has keeps its exact Font step: a V climber re-saving a 6A+
 * must not silently turn it into a 6A.
 */
export function chooseGrade(current: number, option: GradeOption, scale: GradeScale): number {
  if (scale === "v" && isGrade(current) && GRADES[current]!.v === GRADES[option.index]!.v) {
    return current;
  }
  return option.index;
}

/** Whether an option is the one to show as selected for a stored grade. */
export function optionMatches(current: number, option: GradeOption, scale: GradeScale): boolean {
  if (!isGrade(current)) return false;
  return scale === "v" ? GRADES[current]!.v === GRADES[option.index]!.v : current === option.index;
}

/**
 * The index a picker option stands for as one end of a range. In V, an upper
 * bound must include every Font step inside that V grade: "up to V3" has to
 * let 6A+ through, not stop at 6A.
 */
export function gradeBound(option: GradeOption, scale: GradeScale, end: "min" | "max"): number {
  if (scale !== "v" || end === "min") return option.index;
  const v = GRADES[option.index]!.v;
  let last = option.index;
  GRADES.forEach((g, i) => {
    if (g.v === v) last = i;
  });
  return last;
}
