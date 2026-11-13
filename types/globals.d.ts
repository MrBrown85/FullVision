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

// Server calls (shared/data-rpc-wrappers.js). The database's own functions
// come from types/database.d.ts, which is generated.
type RpcFunctions = import('./database').Database['public']['Functions'];
type RpcName = keyof RpcFunctions;
// Any argument may be sent as null: PostgREST passes JSON null as SQL NULL.
// The generator types arguments without null, so this adds it back.
type RpcNullable<T> = { [K in keyof T]: T[K] | null };
type RpcArgs<N extends RpcName> = RpcNullable<RpcFunctions[N]['Args']>;
// What a call resolves with. error is Supabase's, or one the data layer
// makes (blocked, refused, handledSessionExpired); only those keys are named.
type RpcError = {
  message?: string;
  handledSessionExpired?: boolean;
  blocked?: boolean;
  [key: string]: unknown;
};
type RpcResult<N extends RpcName> = {
  data: RpcFunctions[N]['Returns'] | null;
  error: RpcError | null;
};
// shared/data.js defines these two as plain functions, and that file is not
// checked. A var of the same name gives every call in a checked file the
// typed signature; the function in shared/data.js still runs as it is.
declare var _rpcOrNoop: <N extends RpcName>(name: N, params: RpcArgs<N>, options?: unknown) => Promise<RpcResult<N>>;
declare var _callRpcWithAuthGuard: <N extends RpcName>(
  name: N,
  params: RpcArgs<N>,
  options?: unknown,
) => Promise<RpcResult<N>>;
// Set by shared/supabase.js (window.getSupabase): the client, or null.
declare function getSupabase(): unknown;
// The Comment Bank's engine (teacher/comment-bank.js, not checked yet). Only
// the members a checked file uses are typed.
declare var CommentBank: {
  STANDING: Record<string, string>;
  SKILLS: Record<string, { key: string; name: string }[]>;
  HABITS: { key: string; name: string }[];
  aOrAn(word: string): string;
  gradeOf(facts: unknown): { kind: string; letter?: string; standing?: string; next?: string; word?: string } | null;
  angle(facts: unknown, picks: unknown): { id: string };
  stepOf(sentence: unknown): string | null;
};
// Browse Sentences' cases (teacher/report-qn-browse-cases.js).
interface Window {
  ReportQnBrowseCases: unknown;
}
