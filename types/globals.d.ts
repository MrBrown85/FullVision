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
    // The learning map, modules, notes, goals, ratings and preferences calls
    // (shared/data-rpc-wrappers.js; saveTermRating is in shared/data.js).
    upsertSubject(params: V2UpsertSubjectParams, options?: unknown): Promise<RpcResult<'upsert_subject'>>;
    upsertCompetencyGroup(
      params: V2UpsertCompetencyGroupParams,
      options?: unknown,
    ): Promise<RpcResult<'upsert_competency_group'>>;
    upsertSection(params: V2UpsertSectionParams, options?: unknown): Promise<RpcResult<'upsert_section'>>;
    upsertTag(params: V2UpsertTagParams, options?: unknown): Promise<RpcResult<'upsert_tag'>>;
    upsertModule(params: V2UpsertModuleParams, options?: unknown): Promise<RpcResult<'upsert_module'>>;
    deleteSubject(id: string): Promise<RpcResult<'delete_subject'>>;
    deleteCompetencyGroup(id: string): Promise<RpcResult<'delete_competency_group'>>;
    deleteSection(id: string): Promise<RpcResult<'delete_section'>>;
    deleteTag(id: string): Promise<RpcResult<'delete_tag'>>;
    deleteModule(id: string): Promise<RpcResult<'delete_module'>>;
    removeSection(id: string): Promise<RpcResult<'remove_section'>>;
    restoreSection(id: string): Promise<RpcResult<'restore_section'>>;
    addNote(enrollmentId: string, body: string): Promise<RpcResult<'upsert_note'>>;
    deleteNote(noteId: string): Promise<RpcResult<'delete_note'>>;
    listCourseGoalDates(courseId: string): Promise<RpcResult<'list_course_goal_dates'>>;
    listCourseTermAttendance(courseId: string): Promise<RpcResult<'list_course_term_attendance'>>;
    saveTermAttendance(enrollmentId: string, term: number, absences: number | null, lates: number | null): unknown;
    listCourseCoreSelfAssessments(courseId: string): Promise<RpcResult<'list_course_core_self_assessments'>>;
    saveCoreSelfAssessment(
      enrollmentId: string,
      coreId: string,
      termKey: string,
      level: unknown,
      text: string | null,
      goal: string | null,
    ): unknown;
    saveTermRating(enrollmentId: string, term: number, payload: unknown): unknown;
    saveTeacherPreferences(patch: import('./database').Json): unknown;
    deleteRubric(id: string): Promise<RpcResult<'delete_rubric'>>;
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
declare function getSupabase(): FvSupabase | null;
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
  CmStdHelp: unknown;
  CmTerms: unknown;
  ReportOneZoom: unknown;
  ReportOneHead: unknown;
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
  v2Queue: {
    dropBlockedOn(localId: string, opts?: unknown): number;
    remove(id: string): boolean;
    markReloaded(classId: string): number;
  };
  __fvPerf: unknown[];
}
// The grade state (shared/grade-state.js, not checked yet). Only the members
// the checked data files use are typed.
declare var GradeState: {
  RETURNED: string;
  holds(klass: unknown): boolean;
  stateOf(cid: string, sid: string, aid: string): string | null;
  copyOf(grade: unknown): unknown;
  sameCopy(a: unknown, b: unknown): boolean;
  partInUse(copy: unknown, scoring: unknown): unknown;
};
// shared/reporting-term-presets.js (not checked yet): the school whose preset
// a class's terms come from, or null.
declare function reportingTermsSchoolMatch(terms: unknown): {
  school: { id: string; terms: { label?: string; starts_on: string; ends_on: string; report?: string }[] };
} | null;
// The same file's other members, as teacher/cm-terms.js uses them.
declare var REPORTING_TERM_PRESETS: { schoolYear: string; defaultSchool: string };
declare function reportingTermSchools(): { id: string; name: string; assumed: unknown; notes: string }[];
declare function reportingTermPreset(
  schoolId: string | null,
  date?: string,
): { ordinal: number; label: string; starts_on: string; ends_on: string }[] | null;
declare function reportingTermReportNames(terms: unknown): string[] | null;
// teacher/ui.js (not checked yet): a segmented button's state attributes.
declare function segAttr(on: boolean, role?: string): string;
// Second batch of data files: what window.X = ... sets and what other
// files define. Only the members the checked data files use are typed.
// The Sentry browser SDK (shared/sentry-init.js loads it).
interface Window {
  Sentry?: { captureMessage?(message: string, level?: string): unknown };
  // The curriculum index (curriculum_data.js).
  _CURRICULUM_DATA?: Record<string, unknown>;
  // Set by the data files themselves (shared/data-assessments.js, data-roster.js).
  // Each resolves with undefined when it did nothing (no client or a bad id).
  duplicateAssessment(srcAssessmentId: string): Promise<RpcResult<'duplicate_assessment'> | undefined>;
  saveAssessmentTags(assessmentId: string, tagIds: string[]): Promise<RpcResult<'save_assessment_tags'> | undefined>;
  saveCollab(assessmentId: string, mode: unknown, config: unknown): Promise<RpcResult<'save_collab'> | undefined>;
  reorderRoster(enrollmentIds: string[]): Promise<RpcResult<'reorder_roster'> | undefined>;
  bulkApplyPronouns(
    studentIds: string[],
    pronouns: string | null,
  ): Promise<RpcResult<'bulk_apply_pronouns'> | undefined>;
  importRosterCsv(cid: string, rows: unknown[]): Promise<RpcResult<'import_roster_csv'> | undefined>;
  setEnrollmentFlag(enrollmentId: string, flagged: unknown): Promise<RpcResult<'update_enrollment'> | undefined>;
}
// The sync toast (teacher/ui.js, not checked yet).
declare function showSyncToast(message: string, type?: string): void;
// What each window.v2.upsert* call reads from its params (shared/data-rpc-wrappers.js).
type V2UpsertSubjectParams = {
  id: string | null;
  courseId: string;
  name?: string;
  color?: string | null;
  displayOrder?: number | string | null;
};
type V2UpsertModuleParams = V2UpsertSubjectParams;
type V2UpsertCompetencyGroupParams = V2UpsertSubjectParams & { countsAsOne?: boolean | null };
type V2UpsertSectionParams = {
  id: string | null;
  subjectId: string;
  name?: string;
  color?: string | null;
  competencyGroupId?: string | null;
  displayOrder?: number | string | null;
};
type V2UpsertTagParams = {
  id: string | null;
  sectionId: string;
  label?: string;
  code?: string | null;
  iCanText?: string | null;
  displayOrder?: number | string | null;
  iCanStatements?: string[] | null;
  sourceText?: string | null;
  bankId?: string | null;
};
// shared/data.js holds this while getRevisionFirstCell reads a first version.
declare var _firstVersionScope: { cid: string; sid: string; aid: string; entries: unknown } | null;
// Third batch of data files: what window.X = ... sets and what other files
// define. Only the members the checked data files use are typed.
interface Window {
  createObservationRich(params: {
    courseId: string;
    body?: string;
    sentiment?: string | null;
    contextType?: string | null;
    assessmentId?: string | null;
    enrollmentIds?: string[];
    tagIds?: string[];
    customTagIds?: string[];
    localId?: string;
  }): Promise<RpcResult<'create_observation'> | undefined>;
  updateObservationRich(
    obId: string,
    patch: import('./database').Json | null | undefined,
    joins?: { enrollmentIds?: string[]; tagIds?: string[]; customTagIds?: string[] },
  ): Promise<RpcResult<'update_observation'> | undefined>;
  upsertObservationTemplate(
    cid: string,
    payload: {
      id?: string | null;
      body?: string;
      defaultSentiment?: string | null;
      defaultContextType?: string | null;
      displayOrder?: number | string | null;
      defaultDims?: string[] | null;
    },
    options?: unknown,
  ): Promise<RpcResult<'upsert_observation_template'> | undefined>;
  deleteObservationTemplate(tplId: string): Promise<RpcResult<'delete_observation_template'> | undefined>;
  createCustomTag(cid: string, label: string): Promise<RpcResult<'create_custom_tag'> | undefined>;
}
// The Supabase client (shared/supabase.js), with only the members the data
// files call. A query is awaited for { data, error }.
interface FvSupabaseQuery extends PromiseLike<{
  data: Record<string, string | null>[] | null;
  error: RpcError | null;
}> {
  select(columns: string): FvSupabaseQuery;
  eq(column: string, value: unknown): FvSupabaseQuery;
  in(column: string, values: unknown[]): FvSupabaseQuery;
}
interface FvSupabase {
  from(table: string): FvSupabaseQuery;
  auth: { getSession(): Promise<{ data: { session: { access_token?: string } | null } }> };
}
// shared/supabase.js sets these on window; the data files call them by name.
declare function refreshSupabaseSession(): Promise<{ session?: { access_token?: string } | null }>;
declare function showSessionExpiredToast(): void;
declare function isDemoMode(): boolean;
declare function signOut(opts?: { force?: boolean; redirect?: string }): Promise<unknown>;
// seed-data.js (loaded in Demo Mode only): the sample class and its seeder.
declare var DEFAULT_COURSES: Record<string, unknown>;
declare function seedIfNeeded(): void;
interface Window {
  // Set by the Netlify edge function (inject-env.js).
  __ENV?: { SUPABASE_URL?: string; SUPABASE_KEY?: string };
  // shared/photo-queue.js. Only the member the data files call is typed.
  PhotoQueue: { wipe(): Promise<unknown> };
  // Set by shared/data-demo.js.
  loadSeedIfNeeded(): Promise<unknown>;
  resetDemoData(): Promise<void>;
  leaveDemoMode(href: string, opts?: { force?: boolean }): Promise<unknown>;
  leaveDemoUnsentText(n: number): string;
}
