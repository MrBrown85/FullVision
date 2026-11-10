// The student card's routes (docs/plans/student-page-build-plan.md 1.5, 1.8).
//
// A student scans their card, answers "Is This You?", and reads their page
// for that class. Each route here calls one student_submit function
// (migrations/2026110904_student_sessions_page.sql) and nothing else:
//   {route: 'card', code}                          -> student_submit.card
//   {route: 'verify', code, birthday | student_number | password, session?}
//                                                  -> student_submit.verify_card
//   {route: 'add-card', code, birthday | …, session}
//                                                  -> student_submit.verify_card
//   {route: 'page', session, enrollment_id}        -> student_submit.page
//   {route: 'seen', session, enrollment_id, assessment_ids}
//                                                  -> student_submit.seen
//   {route: 'done', session}                       -> student_submit.done
//
// The session token travels as today's slip token does: in the JSON body,
// sent back as `session`. Never a cookie (the function is on another site,
// so the browser would drop it), never a header (nothing new for CORS to
// allow) and never the address (which is kept in history and logs).
//
// Each route below is the one place that names its SQL call, the error
// codes it passes on, and the fields of the reply the phone is given. A
// reply is copied field by field: anything the list does not name is left
// behind, so a column added to the SQL by mistake (a draft's level, a flag
// that says a draft exists) cannot reach a phone through here. Nothing is
// worked out, renamed or reformatted. calc.js in the browser turns the
// scores into a grade.
//
// Kept free of Deno and database imports, as handler.ts is.
import type { Identity } from './handler.ts';

type Json = Record<string, unknown>;
// Every parameter goes to the database as text, or as nothing.
export type Param = string | null;

export type CardRoute = {
  // The whole SQL statement. The caller's hashed address is the last parameter.
  sql: string;
  // The parameters before the hashed address, or null when the request's shape is wrong.
  params: (body: Json, who: Identity | null) => Param[] | null;
  // The error codes passed on as they are. Any other is answered as not_found.
  errors: string[];
  // The fields of a good reply the phone is given.
  reply: (r: Json) => Json;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Reading a request ───────────────────────────────────────────────────────
function code(body: Json): string | null {
  return typeof body.code === 'string' && body.code.length > 0 && body.code.length <= 32 ? body.code : null;
}

/* The device's session token: a short string, or absent. Undefined when the
   shape is wrong. The database decides whether it names a live session. */
function session(body: Json): string | null | undefined {
  const v = body.session;
  if (v == null || v === '') return null;
  return typeof v === 'string' && v.length <= 128 ? v : undefined;
}

function uuid(v: unknown): string | null {
  return typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null;
}

// ── Copying a reply ─────────────────────────────────────────────────────────
function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
const object = (v: unknown): Json => (isObject(v) ? v : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/* The named fields of one object, where it has them, each a plain value
   (text, a number, true or false, or null). An object or a list under a
   plain field's name is not copied. */
function pick(from: unknown, keys: string[]): Json {
  const src = object(from);
  const out: Json = {};
  for (const k of keys) {
    if (!(k in src)) continue;
    const v = src[k];
    out[k] = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null;
  }
  return out;
}

/* An object keyed by id, each value copied by `each`. A key that is not an
   id is left behind. */
function byId(from: unknown, each: (v: unknown) => Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(object(from))) {
    if (UUID.test(k)) out[k] = each(v);
  }
  return out;
}

const person = (v: unknown): Json => pick(v, ['first_name']);
const klass = (v: unknown): Json => pick(v, ['name', 'block']);

// The classes this device's session has opened, for Switching Classes.
function classes(v: unknown): Json[] {
  return list(v).map(c => ({
    ...pick(c, ['enrollment_id']),
    student: person(object(c).student),
    course: klass(object(c).course),
  }));
}

/* A copy of a grade, as student_submit._returned_grade gives it
   (migrations/2026110902_grade_return.sql, 3): the score, the Overall
   Comment, a level per competency, a level per rubric criterion with its
   Work On and Went Beyond notes, and the ticked checkboxes. */
const LEVEL = ['value', 'modifier', 'comment'];
function gradeCopy(v: unknown): Json | null {
  if (!isObject(v)) return null;
  return {
    ...pick(v, ['v', ...LEVEL]),
    tags: byId(v.tags, t => pick(t, LEVEL)),
    criteria: byId(v.criteria, c => pick(c, [...LEVEL, 'beyond'])),
    checks: list(v.checks).filter(id => typeof id === 'string' && UUID.test(id)),
  };
}

const LEVELS = [1, 2, 3, 4];
const CRITERION = [
  'id',
  'name',
  'weight',
  ...LEVELS.map(n => `level_${n}_value`),
  ...LEVELS.map(n => `level_${n}_descriptor`),
];
function rubric(v: unknown): Json {
  return {
    ...pick(v, ['id', 'name', 'style']),
    criteria: list(object(v).criteria).map(c => ({
      ...pick(c, CRITERION),
      checks: list(object(c).checks).map(k => pick(k, ['id', 'level', 'label'])),
    })),
  };
}

/* One assessment and the student's returned grade for it. status (Missing,
   Excused, Late) is never a draft, so it stands outside the grade. A piece
   with no return date carries no grade, whatever the database sent. */
const ASSESSMENT = ['id', 'title', 'date', 'due_date', 'score_mode', 'max_points', 'weight', 'rubric_id'];
const RETURN = ['status', 'returned_at', 'updated_at', 'seen_at'];
function assessment(v: unknown): Json {
  const a = object(v);
  const returned = typeof a.returned_at === 'string' && a.returned_at !== '';
  return {
    ...pick(a, ASSESSMENT),
    tag_ids: list(a.tag_ids).filter(id => typeof id === 'string' && UUID.test(id)),
    ...pick(a, RETURN),
    grade: returned ? gradeCopy(a.grade) : null,
    previous: returned ? gradeCopy(a.previous) : null,
  };
}

/* The class as calc.js needs it. grading_scale is the class's own setting
   (the teacher's boundaries and percents), handed on whole: leaving part of
   it behind would change how a grade reads. */
function course(v: unknown): Json {
  const c = object(v);
  return {
    ...pick(c, ['name', 'block', 'grading_system', 'level_order', 'round_percent']),
    grading_scale: isObject(c.grading_scale) ? c.grading_scale : null,
  };
}

function page(r: Json): Json {
  return {
    ok: true,
    ...pick(r, ['v', 'expires_at']),
    student: pick(r.student, ['enrollment_id', 'first_name']),
    course: course(r.course),
    classes: classes(r.classes),
    tags: byId(r.tags, t => pick(t, ['label', 'code'])),
    rubrics: list(r.rubrics).map(rubric),
    assessments: list(r.assessments).map(assessment),
  };
}

// session_token is a new token, or null when the one sent is still good.
function verified(r: Json): Json {
  return {
    ok: true,
    ...pick(r, ['session_token', 'expires_at', 'enrollment_id']),
    classes: classes(r.classes),
  };
}

// ── The routes ──────────────────────────────────────────────────────────────
// What card() can say about a code that will not open. A guessed code is
// not_found; so is a reissued card, a withdrawn student and a deleted class.
const CARD_ERRORS = ['not_found', 'closed', 'card_locked', 'card_expired', 'reprint', 'locked', 'busy'];
const SESSION_ERRORS = ['signed_out', 'not_found', 'card_stopped', 'card_expired', 'closed'];

const VERIFY_CARD =
  'select student_submit.verify_card($1::text, $2::text, $3::text, $4::text, $5::text, $6::text) as r';

function verifyParams(body: Json, who: Identity | null, needsSession: boolean): Param[] | null {
  const c = code(body);
  const s = session(body);
  if (!c || !who || s === undefined || (needsSession && !s)) return null;
  return [c, who.birthday, who.studentNumber, who.password, s];
}

export const CARD_ROUTES: Record<string, CardRoute> = {
  // Code in; first name, class and which identity check out. Nothing opens yet.
  card: {
    sql: 'select student_submit.card($1::text, $2::text) as r',
    params: body => {
      const c = code(body);
      return c ? [c] : null;
    },
    errors: CARD_ERRORS,
    reply: r => ({
      ok: true,
      ...pick(r, ['kind']),
      student: person(r.student),
      course: klass(r.course),
      ...pick(r, ['check', 'also_password']),
    }),
  },

  /* The card's identity check. The phone sends the code again with what the
     student typed. A match starts the device's session, or adds this class
     to the session it sent. A session ends at midnight where the class is,
     or on Done. */
  verify: {
    sql: VERIFY_CARD,
    params: (body, who) => verifyParams(body, who, false),
    errors: [...CARD_ERRORS, 'wrong_identity'],
    reply: verified,
  },

  // Add Another Card: the same check, from a device that is signed in.
  'add-card': {
    sql: VERIFY_CARD,
    params: (body, who) => verifyParams(body, who, true),
    errors: [...CARD_ERRORS, 'wrong_identity'],
    reply: verified,
  },

  // The student's whole page for one class in the session. Returned grades only.
  page: {
    sql: 'select student_submit.page($1::text, $2::uuid, $3::text) as r',
    params: body => {
      const s = session(body);
      const e = uuid(body.enrollment_id);
      return s && e ? [s, e] : null;
    },
    errors: SESSION_ERRORS,
    reply: page,
  },

  // The pieces the student opened, for "Updated" and What Changed.
  seen: {
    sql: 'select student_submit.seen($1::text, $2::uuid, $3::uuid[], $4::text) as r',
    params: body => {
      const s = session(body);
      const e = uuid(body.enrollment_id);
      const ids: Param[] | null = Array.isArray(body.assessment_ids) ? body.assessment_ids.map(uuid) : null;
      if (!s || !e || !ids || ids.length > 500 || ids.includes(null)) return null;
      // A Postgres array as text: every entry was checked to be an id.
      return [s, e, '{' + ids.join(',') + '}'];
    },
    errors: SESSION_ERRORS,
    reply: r => ({ ok: true, ...pick(r, ['seen']) }),
  },

  // Done: ends the device's session, whatever the token was.
  done: {
    sql: 'select student_submit.done($1::text, $2::text) as r',
    params: body => {
      const s = session(body);
      return s ? [s] : null;
    },
    errors: [],
    reply: () => ({ ok: true }),
  },
};

/* What the phone is told. A good reply is copied by the route's list. A
   refusal is its code alone, with the tries left after a wrong answer. A
   code the route does not list is answered as not_found, so nothing the
   database adds later tells a real card from a guess. A reply that is
   neither is thrown, and the handler answers with a plain server error. */
export function cardReply(route: CardRoute, r: unknown): Json {
  if (isObject(r) && r.ok === true) return route.reply(r);
  const error = isObject(r) ? r.error : null;
  if (!isObject(r) || typeof error !== 'string') throw new TypeError('reply');
  if (!route.errors.includes(error)) return { ok: false, error: 'not_found' };
  if (error === 'wrong_identity' && typeof r.tries_left === 'number') {
    return { ok: false, error, tries_left: r.tries_left };
  }
  return { ok: false, error };
}
