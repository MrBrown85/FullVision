// Globals other files set with window.X = ..., which TypeScript can't see.
declare function getReturnedScores(cid: string): Record<string, Score[]> | null;
interface Window {
  // The data layer's namespace (shared/data.js and the data-*.js files).
  // Only what a checked file calls is typed; the rest is unknown until
  // those files are checked.
  v2: {
    saveSectionOverride(studentId: string, sectionId: string, level: number, reason: string): unknown;
    clearSectionOverride(studentId: string, sectionId: string): unknown;
    [name: string]: unknown;
  };
  // Set by shared/calc.js for tests and the console. Nothing checked reads it.
  Calc: unknown;
  CATEGORY_PALETTE: typeof CATEGORY_PALETTE;
  categoryTintByIndex: typeof categoryTintByIndex;
}
