// Globals other files set with window.X = ..., which TypeScript can't see.
declare function getReturnedScores(cid: string): Record<string, Score[]> | null;
interface Window {
  // The data layer's namespace (shared/data.js and the data-*.js files).
  // Only what a checked file calls is typed; the rest is unknown until
  // those files are checked.
  v2: {
    saveSectionOverride(studentId: string, sectionId: string, level: number, reason: string): unknown;
    clearSectionOverride(studentId: string, sectionId: string): unknown;
    // The category and profile calls (shared/data-rpc-wrappers.js). Each
    // resolves with what _rpcOrNoop resolves with.
    listCategories(courseId: string): Promise<RpcResult<'list_categories'>>;
    reorderCategories(ids: string[]): Promise<RpcResult<'reorder_categories'>>;
    saveCategories(courseId: string, rows: unknown, options?: unknown): Promise<RpcResult<'save_categories'>>;
    getStudentProfile(enrollmentId: string): Promise<RpcResult<'get_student_profile'>>;
    listCourseStudentProfiles(courseId: string): Promise<RpcResult<'list_course_student_profiles'>>;
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
// Browse Sentences' cases (teacher/report-qn-browse-cases.js) and the
// Observations card, the student's Voice and the class's report parts
// (teacher/report-qn-voice-observations.js).
interface Window {
  ReportQnBrowseCases: unknown;
  ReportQnVoiceObservations: unknown;
}
// One Report's model (teacher/report-one.js, not checked yet). Only the
// members the Voice and Observations piece uses are typed.
declare var ReportOne: {
  FEEDBACK: { key: string; opt: string; label: string }[];
  modelFor(reportConfig: unknown): { titles?: Record<string, string> };
  available(key: string, cid: string): boolean;
  isOn(model: unknown, key: string, sid?: string): boolean;
  order(model: unknown, sid?: string): string[];
  offParts(model: unknown, cid: string, sid?: string): string[];
  label(key: string, cid: string): string;
};
// The observation card (shared/obs-card.js, not checked yet). Only the
// members the Voice and Observations piece uses are typed.
declare var ObsCard: {
  obDay(ob: unknown): string;
  context(cid: string, opts?: unknown): unknown;
  html(ob: unknown, ctx: unknown, opts?: unknown): string;
};
// The offline queue (shared/offline-queue.js sets window.v2Queue). Only the
// member the checked data files call is typed.
// __fvPerf: shared/data-courses-terms.js keeps the last 50 load timings here.
interface Window {
  v2Queue: { dropBlockedOn(localId: string, opts?: unknown): number };
  __fvPerf: unknown[];
}
// The grade state (shared/grade-state.js, not checked yet). Only the members
// the checked data files use are typed.
declare var GradeState: {
  RETURNED: string;
  holds(klass: unknown): boolean;
  stateOf(cid: string, sid: string, aid: string): string | null;
};
// shared/reporting-term-presets.js (not checked yet): the school whose preset
// a class's terms come from, or null.
declare function reportingTermsSchoolMatch(terms: unknown): {
  school: { terms: { starts_on: string; ends_on: string; report?: string }[] };
} | null;
