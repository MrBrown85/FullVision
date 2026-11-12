// Globals other files set with window.X = ..., which TypeScript can't see.
declare function getReturnedScores(cid: string): Record<string, any[]> | null;
interface Window {
  v2: any;
  Calc: any;
  CATEGORY_PALETTE: any;
  categoryTintByIndex: any;
}
