// Questionnaires and phone reports from the student's card (Batch E, E2;
// plan S4-F4). The database side is migrations/2026111150_student_page_
// last_changes.sql. A slip's own routes (open, verify, check, submit in
// handler.ts) are not changed: a printed slip works as before.
//
//   {route: 'forms', session, enrollment_id}
//        -> student_submit.forms. The Questionnaires and My Reports tabs'
//           lists, read-only.
//   {route: 'form', session, enrollment_id, questionnaire_id}
//        -> student_submit.form. The questionnaire to answer, as a slip's
//           verify gives it, read-only.
//   {route: 'answer', session, enrollment_id, questionnaire_id, answers}
//        -> student_submit.answer. Once.
//   {route: 'report', session, enrollment_id, report_id}
//        -> student_submit.report. The phone report, as a slip's check
//           gives it once the birthday matches.
//
// The rules are send-routes.ts's and feedback-routes.ts's: the session
// checked by the database first and who the student is taken only from
// that; each statement named here; every request the database would raise
// 22023 for refused first as bad_request; a reply copied field by field; a
// refusal passed on by its code with the one extra field the SQL gives it,
// any other answered not_found; a log line with nothing about the student
// (handler.ts).
//
// Two answers are passed on whole, as the slip's routes pass them: a
// question's `options` (the teacher's own choices and labels, whose shape
// is the question kind's) and the phone report (the teacher's copy for
// this student, written when it was sent; s/report.js reads it as it reads
// a slip's).
//
// Kept free of Deno and database imports, as handler.ts is.
import {
  SESSION_ERRORS,
  CHANGE_ERRORS,
  bad,
  good,
  isObject,
  list,
  ok,
  pick,
  session,
  uuid,
  type SendAnswer,
} from './send-routes.ts';

type Json = Record<string, unknown>;
type Param = string | null;

/** The routes this file serves. handler.ts sends a request here when its route is one of them. */
export const FORM_ROUTES: Record<string, true> = {
  forms: true,
  form: true,
  answer: true,
  report: true,
};

// ── The statements ──────────────────────────────────────────────────────────
// The caller's hashed address is last, as every student_submit function takes it.
export const SQL = {
  forms: 'select student_submit.forms($1::text, $2::uuid, $3::text) as r',
  form: 'select student_submit.form($1::text, $2::uuid, $3::uuid, $4::text) as r',
  answer: 'select student_submit.answer($1::text, $2::uuid, $3::uuid, $4::jsonb, $5::text) as r',
  report: 'select student_submit.report($1::text, $2::uuid, $3::uuid, $4::text) as r',
};

// ── What each route passes on ───────────────────────────────────────────────
// form and answer use _send_session (card_locked); forms and report may be read by a locked card.
const ERRORS = {
  forms: SESSION_ERRORS,
  form: [...CHANGE_ERRORS, 'already_sent', 'closed', 'not_open_yet'],
  answer: [...CHANGE_ERRORS, 'already_sent', 'closed', 'not_open_yet', 'invalid', 'empty', 'too_many'],
  report: [...SESSION_ERRORS, 'report_closed'],
} as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const whole = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= lo && v <= hi;

/* A refusal: its code, if the route passes it on, with the one field the
   SQL gives that code and nothing else. A reply that is neither a good
   answer nor a refusal is thrown: the handler answers a server error. */
function refusal(r: unknown, errors: readonly string[]): Json {
  if (!isObject(r) || typeof r.error !== 'string') throw new TypeError('reply');
  if (!errors.includes(r.error)) return { ok: false, error: 'not_found' };
  const out: Json = { ok: false, error: r.error };
  if (r.error === 'not_open_yet')
    out.opens_on = typeof r.opens_on === 'string' && DATE.test(r.opens_on) ? r.opens_on : null;
  if (r.error === 'invalid' && typeof r.question_id === 'string' && UUID.test(r.question_id))
    out.question_id = r.question_id;
  if (r.error === 'too_many' && whole(r.retry_after_s, 1, 86_400)) out.retry_after_s = r.retry_after_s;
  return out;
}

// ── Reading a request ───────────────────────────────────────────────────────
/* The answers, as submit and answer take them: an object of at most 80
   answers. The SQL checks each one (an answer it cannot read is invalid, not
   an error). Only its size is checked here, as the SQL does: 100,000 bytes
   as JSON. Null when it is wrong. */
const MAX_ANSWERS = 80;
const MAX_ANSWER_BYTES = 100_000;
function answers(v: unknown): string | null {
  if (!isObject(v) || Object.keys(v).length > MAX_ANSWERS) return null;
  const text = JSON.stringify(v);
  // The SQL counts the bytes of its own jsonb text; refusing at the edge first keeps it a refusal, never a raise.
  if (new TextEncoder().encode(text).length > MAX_ANSWER_BYTES) return null;
  // Postgres cannot hold a NUL or a broken surrogate pair in jsonb: refused here, never a server error.
  // JSON.stringify writes each of them as an escape (\u0000, \udXXX) and a whole pair as the character itself.
  if (/\\u0000|\\ud[89a-f][0-9a-f]{2}/i.test(text)) return null;
  return text;
}

// ── Copying a reply ─────────────────────────────────────────────────────────
const texts = (v: unknown): string[] => list(v).filter((t): t is string => typeof t === 'string');
const textMap = (v: unknown): Json | null => {
  if (!isObject(v)) return null;
  const out: Json = {};
  for (const [k, t] of Object.entries(v)) if (typeof t === 'string') out[k] = t;
  return out;
};

function forms(r: Json): Json {
  return {
    ok: true,
    ...pick(r, ['v']),
    questionnaires: list(r.questionnaires).map(q =>
      pick(q, ['id', 'title', 'description', 'minutes', 'state', 'opens_on', 'closes_on', 'sent_at']),
    ),
    reports: list(r.reports).map(x => {
      const y = isObject(x) ? x : {};
      return {
        ...pick(y, ['id', 'title', 'issued_at', 'expires_on', 'opened_at']),
        overall: isObject(y.overall) ? pick(y.overall, ['word', 'text', 'level']) : null,
        comment: typeof y.comment === 'string' ? y.comment : Array.isArray(y.comment) ? texts(y.comment) : null,
      };
    }),
  };
}

const QUESTION = ['id', 'prompt', 'kind', 'teacher_only'];
function form(r: Json): Json {
  const ctx = isObject(r.context) ? r.context : {};
  return {
    ok: true,
    parts: list(r.parts).map(p => {
      const x = isObject(p) ? p : {};
      return {
        ...pick(x, ['id', 'kind', 'title', 'theme', 'closes_on', 'grade']),
        questions: list(x.questions).map(q => {
          const y = isObject(q) ? q : {};
          return {
            ...pick(y, QUESTION),
            prompt_translations: textMap(y.prompt_translations),
            options: isObject(y.options) || Array.isArray(y.options) ? y.options : null,
            core_ids: texts(y.core_ids),
          };
        }),
      };
    }),
    context: isObject(ctx.course_goal) ? { course_goal: pick(ctx.course_goal, ['text', 'at']) } : {},
  };
}

// ── The routes ──────────────────────────────────────────────────────────────
type Route = {
  sql: string;
  params: (body: Json, s: string, e: string) => Param[] | null;
  errors: readonly string[];
  reply: (r: Json) => Json;
};

const ROUTES: Record<string, Route> = {
  forms: { sql: SQL.forms, params: (_b, s, e) => [s, e], errors: ERRORS.forms, reply: forms },
  form: {
    sql: SQL.form,
    params: (body, s, e) => {
      const q = uuid(body.questionnaire_id);
      return q ? [s, e, q] : null;
    },
    errors: ERRORS.form,
    reply: form,
  },
  answer: {
    sql: SQL.answer,
    params: (body, s, e) => {
      const q = uuid(body.questionnaire_id);
      const a = answers(body.answers);
      return q && a ? [s, e, q, a] : null;
    },
    errors: ERRORS.answer,
    reply: r => ({ ok: true, ...pick(r, ['submitted_at']) }),
  },
  report: {
    sql: SQL.report,
    params: (body, s, e) => {
      const id = uuid(body.report_id);
      return id ? [s, e, id] : null;
    },
    errors: ERRORS.report,
    reply: r => ({ ok: true, report: isObject(r.report) ? r.report : {} }),
  },
};

export function makeFormRoutes(opts: { db: { call: (sql: string, params: Param[]) => Promise<unknown> } }) {
  return async function run(route: string, body: Json, hash: string): Promise<SendAnswer> {
    const r = Object.hasOwn(ROUTES, route) ? ROUTES[route] : null;
    const s = session(body);
    const e = uuid(body.enrollment_id);
    if (!r || !s || !e) return bad();
    const params = r.params(body, s, e);
    if (!params) return bad();
    const answer = await opts.db.call(r.sql, [...params, hash]);
    return ok(good(answer) ? r.reply(answer) : refusal(answer, r.errors));
  };
}
