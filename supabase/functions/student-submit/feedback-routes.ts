// The student's side of Mark Up, Reflect on Feedback and group work
// (Batch C; docs/plans/student-page-build-plan.md, S9 to S12). The database
// side is migrations/2026111120_markup_reflect_revise.sql (its contract:
// migrations/local-test/batch-c-contract.md). The routes that move photos
// (a revision's send, the group's page links) are in revision-routes.ts.
//
//   {route: 'feedback', session, enrollment_id}
//        -> student_submit.feedback. Marks given, revision requests and
//           reflections for the class, read-only.
//   {route: 'markup', session, enrollment_id, assessment_id}
//        -> student_submit.markup. The marks given on one piece, read-only.
//   {route: 'reflect', session, enrollment_id, assessment_id, reflection}
//        -> student_submit.reflect.
//   {route: 'reply', session, enrollment_id, assessment_id, reply}
//        -> student_submit.reply.
//   {route: 'answer-seen', session, enrollment_id, assessment_ids}
//        -> student_submit.answer_seen.
//   {route: 'group-work', session, enrollment_id}
//        -> student_submit.group_work. Counts only, read-only.
//
// The rules are send-routes.ts's, and every route here keeps them:
//   - The session is checked by the database, first, in every one of these
//     functions. Who the student is comes only from that check: the
//     enrollment id is the one the session is asked about, and nothing else
//     the phone says about a class, a teacher or another student is read.
//   - Each statement is named here and nowhere else; every value goes as a
//     parameter.
//   - A request the database would raise 22023 for is refused here first,
//     as bad_request, so a 22023 is a bug and answers a plain server error.
//     The reflection and the reply are rebuilt from the fields the SQL
//     takes, each checked as the SQL checks it.
//   - A reply is copied field by field. A refusal is its code; a code a
//     route does not list is answered not_found.
//   - A log line holds the route, the outcome and the time (handler.ts).
//     Never a session token, an id, or a word the student wrote.
//
// Kept free of Deno and database imports, as handler.ts is.
import { gradeCopy } from './card-routes.ts';
import {
  CHANGE_ERRORS,
  SESSION_ERRORS,
  bad,
  good,
  isObject,
  list,
  ok,
  pick,
  refusal,
  session,
  uuid,
  type SendAnswer,
} from './send-routes.ts';

type Json = Record<string, unknown>;
type Param = string | null;

/** The routes this file serves. handler.ts sends a request here when its route is one of them. */
export const FEEDBACK_ROUTES: Record<string, true> = {
  feedback: true,
  markup: true,
  reflect: true,
  reply: true,
  'answer-seen': true,
  'group-work': true,
};

// ── The statements ──────────────────────────────────────────────────────────
// The caller's hashed address is last, as every student_submit function takes it (unused by Batch C).
export const SQL = {
  feedback: 'select student_submit.feedback($1::text, $2::uuid, $3::text) as r',
  markup: 'select student_submit.markup($1::text, $2::uuid, $3::uuid, $4::text) as r',
  reflect: 'select student_submit.reflect($1::text, $2::uuid, $3::uuid, $4::jsonb, $5::text) as r',
  reply: 'select student_submit.reply($1::text, $2::uuid, $3::uuid, $4::jsonb, $5::text) as r',
  answerSeen: 'select student_submit.answer_seen($1::text, $2::uuid, $3::uuid[], $4::text) as r',
  groupWork: 'select student_submit.group_work($1::text, $2::uuid, $3::text) as r',
};

// ── What each route passes on ───────────────────────────────────────────────
// The reads use _session_class (a locked card may read); reflect and reply use _send_session (card_locked).
const ERRORS = {
  feedback: SESSION_ERRORS,
  markup: SESSION_ERRORS,
  // too_many (E6): thirty reflections and replies an hour for a card, and sixty answer-seens.
  reflect: [...CHANGE_ERRORS, 'reflect_off', 'not_returned', 'already_answered', 'too_many'],
  reply: [...CHANGE_ERRORS, 'reflect_off', 'not_answered', 'already_asked', 'too_many'],
  'answer-seen': [...SESSION_ERRORS, 'too_many'],
  'group-work': SESSION_ERRORS,
} as const;

// ── Reading a request ───────────────────────────────────────────────────────
/** As many ids as answer_seen is sent at once; seen (card-routes.ts) takes the same. */
const MAX_IDS = 500;
/** Each text a student writes: 1,000 characters at most once its spaces are trimmed, as the SQL counts. */
const MAX_TEXT = 1000;

// A UTF-16 half of a pair with no other half: JSON can carry one, and Postgres refuses it inside jsonb.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/* One text field of a reflection or a reply, as the SQL reads it: null, or
   a string. The SQL trims spaces (Postgres btrim: the space character only)
   and counts what is left in characters (code points); empty after
   trimming is the same as not given. A string holding a NUL or a broken
   surrogate pair is refused here: Postgres cannot store either in jsonb,
   so it would be a server error. Undefined when it is wrong; otherwise the
   value as sent (null or the string) and whether it says anything. */
type Text = { value: string | null; given: boolean };
function text(v: unknown): Text | undefined {
  if (v === null) return { value: null, given: false };
  if (typeof v !== 'string' || v.includes('\u0000') || LONE_SURROGATE.test(v)) return undefined;
  const trimmed = v.replace(/^ +| +$/g, '');
  if ([...trimmed].length > MAX_TEXT) return undefined;
  return { value: v, given: trimmed !== '' };
}

/* `v`, when it is an object holding no field but the allowed ones. Null
   when it is not. */
function fields(v: unknown, allowed: string[]): Json | null {
  if (!isObject(v)) return null;
  for (const k of Object.keys(v)) if (!allowed.includes(k)) return null;
  return v;
}

/* p_reflection, as student_submit.reflect checks it: makes_sense 'yes' or
   'not_sure'; question, plan and went_well each text or null; not_sure
   needs a question, yes a plan; no other field. Rebuilt from those fields
   only, as JSON text for $4::jsonb. Null when it is wrong. */
function reflection(v: unknown): string | null {
  const r = fields(v, ['makes_sense', 'question', 'plan', 'went_well']);
  if (!r || (r.makes_sense !== 'yes' && r.makes_sense !== 'not_sure')) return null;
  const out: Json = { makes_sense: r.makes_sense };
  const said: Record<string, boolean> = {};
  for (const k of ['question', 'plan', 'went_well']) {
    if (!(k in r)) continue;
    const t = text(r[k]);
    if (!t) return null;
    out[k] = t.value;
    said[k] = t.given;
  }
  if (r.makes_sense === 'not_sure' && !said.question) return null;
  if (r.makes_sense === 'yes' && !said.plan) return null;
  return JSON.stringify(out);
}

/* p_reply, as student_submit.reply checks it: sense_now 'yes' or
   'not_sure'; follow_up text or null, saying something only with not_sure;
   plan text or null, saying something only with yes (Make My Plan); no
   other field. Rebuilt from those fields only. Null when it is wrong. */
function reply(v: unknown): string | null {
  const r = fields(v, ['sense_now', 'follow_up', 'plan']);
  if (!r || (r.sense_now !== 'yes' && r.sense_now !== 'not_sure')) return null;
  const out: Json = { sense_now: r.sense_now };
  for (const [k, only] of [
    ['follow_up', 'not_sure'],
    ['plan', 'yes'],
  ] as const) {
    if (!(k in r)) continue;
    const t = text(r[k]);
    if (!t || (t.given && r.sense_now !== only)) return null;
    out[k] = t.value;
  }
  return JSON.stringify(out);
}

/* answer_seen's p_assessment_ids: 1 to 500 ids, as a Postgres array in
   text. Null when anything is wrong. An empty list marks nothing, so it is
   the page's mistake (E6): refused here, the database never asked. */
function assessmentIds(v: unknown): string | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_IDS) return null;
  const ids = v.map(uuid);
  if (ids.includes(null)) return null;
  return '{' + ids.join(',') + '}';
}

// ── Copying a reply ─────────────────────────────────────────────────────────
const ids = (v: unknown): string[] =>
  list(v)
    .map(uuid)
    .filter((id): id is string => id !== null);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const REVISION = [
  'state',
  'what_to_fix',
  'revise_by',
  'keep_grade',
  'grade_hidden',
  'first_version',
  'first_sent_at',
  'revision_version',
  'revision_sent_at',
  'revision_note',
  'revision_late',
  'asked_at',
];
const REFLECTION = [
  'makes_sense',
  'question',
  'plan',
  'went_well',
  'sent_at',
  'answer',
  'answered_at',
  'sense_now',
  'follow_up',
  'follow_up_answer',
  'follow_up_answered_at',
  'answer_new',
];

/* feedback: the two switches, each listed piece's marks count, revision
   request and reflection, and the last plan. A revision's first grade is
   copied as page copies a grade (card-routes.ts). The teacher's Only Me
   notes are not in the SQL's answer, and no field here could carry one. */
function feedback(r: Json): Json {
  return {
    ok: true,
    ...pick(r, ['v', 'reflect_on_feedback', 'show_my_learning']),
    assessments: list(r.assessments).map(a => {
      const x = isObject(a) ? a : {};
      const rv = isObject(x.revision) ? x.revision : null;
      return {
        ...pick(x, ['id']),
        marks: isObject(x.marks) ? pick(x.marks, ['pages', 'work_pages', 'notes']) : null,
        revision: rv
          ? { ...pick(rv, REVISION), criterion_ids: ids(rv.criterion_ids), first_grade: gradeCopy(rv.first_grade) }
          : null,
        reflection: isObject(x.reflection) ? pick(x.reflection, REFLECTION) : null,
      };
    }),
    last_plan: isObject(r.last_plan) ? pick(r.last_plan, ['assessment_id', 'plan', 'sent_at']) : null,
  };
}

/* One mark, as save_markup stores it (batch-c-contract.md, "save_markup"):
   its type's own fields, each of the type that table names, with id and
   color where set. A mark of another type, or missing a field its type
   needs, is left out; a field the table does not name never reaches the
   phone. */
const COLORS = ['red', 'green', 'blue'];
function mark(v: unknown): Json | null {
  if (!isObject(v)) return null;
  const out: Json = { type: v.type };
  if (v.type === 'pen' || v.type === 'highlight') {
    if (!Array.isArray(v.points) || !v.points.length) return null;
    const points = v.points.filter(p => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]));
    if (points.length !== v.points.length) return null;
    out.points = points.map(p => [p[0], p[1]]);
    if (finite(v.width)) out.width = v.width;
  } else if (v.type === 'note' || v.type === 'tick' || v.type === 'cross') {
    if (!finite(v.x) || !finite(v.y)) return null;
    out.x = v.x;
    out.y = v.y;
    if (v.type === 'note') {
      if (typeof v.text !== 'string') return null;
      out.text = v.text;
    }
  } else {
    return null;
  }
  if (typeof v.id === 'string') out.id = v.id;
  if (typeof v.color === 'string' && COLORS.includes(v.color)) out.color = v.color;
  return out;
}

function markup(r: Json): Json {
  return {
    ok: true,
    files: list(r.files).map(f => {
      const x = isObject(f) ? f : {};
      const given = isObject(x.marks) ? x.marks : null;
      return {
        ...pick(x, ['file_id', 'given_at']),
        marks: given ? { ...pick(given, ['v']), marks: list(given.marks).map(mark).filter(Boolean) } : null,
      };
    }),
  };
}

function groupWork(r: Json): Json {
  return {
    ok: true,
    assessments: list(r.assessments).map(a => pick(a, ['id', 'members', 'sent', 'pages', 'you_sent', 'first_sent_at'])),
  };
}

// ── The routes ──────────────────────────────────────────────────────────────
type Route = {
  sql: string;
  // The parameters before the hashed address, or null when the request's shape is wrong.
  params: (body: Json, s: string, e: string) => Param[] | null;
  errors: readonly string[];
  reply: (r: Json) => Json;
};

const piece = (body: Json, s: string, e: string): Param[] | null => {
  const a = uuid(body.assessment_id);
  return a ? [s, e, a] : null;
};

const ROUTES: Record<string, Route> = {
  feedback: { sql: SQL.feedback, params: (_b, s, e) => [s, e], errors: ERRORS.feedback, reply: feedback },
  markup: { sql: SQL.markup, params: piece, errors: ERRORS.markup, reply: markup },
  reflect: {
    sql: SQL.reflect,
    params: (body, s, e) => {
      const at = piece(body, s, e);
      const r = reflection(body.reflection);
      return at && r ? [...at, r] : null;
    },
    errors: ERRORS.reflect,
    reply: r => ({
      ok: true,
      reflection: pick(r.reflection, ['makes_sense', 'question', 'plan', 'went_well', 'sent_at']),
    }),
  },
  reply: {
    sql: SQL.reply,
    params: (body, s, e) => {
      const at = piece(body, s, e);
      const r = reply(body.reply);
      return at && r ? [...at, r] : null;
    },
    errors: ERRORS.reply,
    reply: r => ({
      ok: true,
      reflection: pick(r.reflection, ['sense_now', 'follow_up', 'plan', 'answer', 'follow_up_answer']),
    }),
  },
  'answer-seen': {
    sql: SQL.answerSeen,
    params: (body, s, e) => {
      const a = assessmentIds(body.assessment_ids);
      return a ? [s, e, a] : null;
    },
    errors: ERRORS['answer-seen'],
    reply: r => ({ ok: true, ...pick(r, ['seen']) }),
  },
  'group-work': { sql: SQL.groupWork, params: (_b, s, e) => [s, e], errors: ERRORS['group-work'], reply: groupWork },
};

export function makeFeedbackRoutes(opts: { db: { call: (sql: string, params: Param[]) => Promise<unknown> } }) {
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
