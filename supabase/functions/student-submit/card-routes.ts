// The student card's routes (docs/plans/student-page-build-plan.md 1.5, 1.8).
//
// A student scans their card, answers "Is This You?", and reads their page
// for that class. Each route here calls one student_submit function
// (migrations/2026110904_student_sessions_page.sql) and nothing else:
//   {route: 'card', code}                          -> student_submit.card
//   {route: 'verify', code, birthday | student_number | password, session?}
//                                    -> student_submit.verify_card, p_add false
//   {route: 'add-card', code, birthday | …, session}
//                                    -> student_submit.verify_card, p_add true
//   {route: 'page', session, enrollment_id}        -> student_submit.page
//   {route: 'seen', session, enrollment_id, assessment_ids}
//                                                  -> student_submit.seen
//   {route: 'done', session}                       -> student_submit.done
//
// The database cannot read a card's code (S3-E1). The first three routes
// take the code the phone sent, tidy it, and hand the database its tag: a
// keyed fingerprint made with STUDENT_CARD_KEY (../_shared/card-key.ts),
// which the database never has. A card's own four-digit password goes the
// same way, as a tag bound to its card. The code and the typed password
// are never a parameter, never in a statement and never logged. A birthday
// and a student number are checked in the database, where they live.
//   - A code that is not eight characters once tidied is no card (a slip
//     is six): not_found, with nothing asked of the database, so a slip
//     scanned here is never counted as a guess at a card.
//   - With no key, those three routes answer a plain server error and ask
//     the database nothing. page, seen and done use the session token, not
//     the key, and carry on.
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
import { CODE_LENGTH, tidy, type CardKey } from '../_shared/card-key.ts';
import type { Identity } from './handler.ts';

type Json = Record<string, unknown>;
// Every parameter goes to the database as text, or as nothing.
export type Param = string | null;

/* What the phone sent to one of the three routes that take a card's code,
   once its shape is checked. It is turned into tags (cardParams) and goes
   no further as it is. `check` is there for verify and add-card. */
type Typed = { code: string; check?: { who: Identity; session: string | null } };

export type CardRoute = {
  // The whole SQL statement. The caller's hashed address is the last parameter.
  sql: string;
  // page, seen and done: the parameters before the hashed address, or null when the request's shape is wrong.
  params?: (body: Json) => Param[] | null;
  // card, verify and add-card: what was sent, or null when the request's shape is wrong.
  typed?: (body: Json, who: Identity | null) => Typed | null;
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
   with no return date carries no grade, whatever the database sent.
   created_at is when the teacher made the piece: two pieces with the same
   date are listed with the one made later counting later (Colin, Nov 10).
   The database sends it since S0-M4b (2026110905); where it is absent,
   nothing is put in its place. */
const ASSESSMENT = ['id', 'title', 'date', 'due_date', 'created_at', 'score_mode', 'max_points', 'weight', 'rubric_id'];
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

// session_token is the new session's token, or null when add-card joined the session sent.
function verified(r: Json): Json {
  return {
    ok: true,
    ...pick(r, ['session_token', 'expires_at', 'enrollment_id']),
    classes: classes(r.classes),
  };
}

// ── The routes ──────────────────────────────────────────────────────────────
// What card() can say about a code that will not open. A guessed code is
// not_found; so is a slip's code, a withdrawn student and a deleted class.
// card_stopped is a card that was replaced: the student is told to ask for
// their new one (Colin, Nov 10). It tells a guesser nothing: the code is
// dead and no name comes with it. card_locked is five wrong tries in a row
// or fifteen in 7 days. locked is the per-address limit. There is no
// everyone-is-busy stop on a card's routes (Colin, Nov 9); a slip's open
// keeps its own.
const CARD_ERRORS = ['not_found', 'card_stopped', 'closed', 'card_locked', 'card_expired', 'reprint', 'locked'];
const SESSION_ERRORS = ['signed_out', 'not_found', 'card_stopped', 'card_expired', 'closed'];

/* The card's identity check, for the start screen (p_add false) or for Add
   Another Card (p_add true). Which one is written into the route's
   statement, never taken from the request: sending a session token, or
   anything else, cannot turn a plain verify into an add. The parameters are
   the code's tag, the key id, the birthday, the student number, the typed
   password's tag, the session token and the hashed address. */
const verifyCard = (add: boolean) =>
  'select student_submit.verify_card($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, ' +
  `p_add => ${add ? 'true' : 'false'}) as r`;

function verifyTyped(body: Json, who: Identity | null, needsSession: boolean): Typed | null {
  const c = code(body);
  const s = session(body);
  if (!c || !who || s === undefined || (needsSession && !s)) return null;
  return { code: c, check: { who, session: s } };
}

export const CARD_ROUTES: Record<string, CardRoute> = {
  /* Code in; first name, class and which identity check out. Nothing opens
     yet. A slip's code is not_found here, as any unknown code is, so this
     route says nothing about slips; the page then sends the code to open. */
  card: {
    // The code's tag, the key id and the hashed address.
    sql: 'select student_submit.card($1::text, $2::text, $3::text) as r',
    typed: body => {
      const c = code(body);
      return c ? { code: c } : null;
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

  /* The card's identity check from the start screen. The phone sends the
     code again with what the student typed. A match always starts a new
     session for the device and ends the one it sent, if that was live: on a
     shared Chromebook the last student is signed out (Colin, Nov 9: "start
     fresh"). A session ends at midnight where the class is, or on Done. */
  verify: {
    sql: verifyCard(false),
    typed: (body, who) => verifyTyped(body, who, false),
    errors: [...CARD_ERRORS, 'wrong_identity'],
    reply: verified,
  },

  /* Add Another Card: the same check, from a device that is signed in. The
     class joins the session sent, and session_token comes back null (keep
     using the one sent); if that session is no longer live, a new one starts. */
  'add-card': {
    sql: verifyCard(true),
    typed: (body, who) => verifyTyped(body, who, true),
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

/* What to ask the database for one request: the parameters before the
   hashed address, or why the database is not asked.
     'bad_request'  the request's shape is wrong;
     'not_a_card'   the code is not eight characters once tidied, so it is
                    no card's, with or without the key; a slip's is six;
     'no_key'       a card's code, and no key to make its tag with.
   For the three routes that take a code, this is the only place the code
   and the typed password are used, and tags are all that leave it. A typed
   password is tagged whatever it holds: one that is not the card's four
   digits matches nothing, and the database counts the wrong try. */
export async function cardParams(
  route: CardRoute,
  body: Json,
  who: Identity | null,
  key: CardKey | null,
): Promise<Param[] | 'bad_request' | 'not_a_card' | 'no_key'> {
  if (!route.typed) return (route.params && route.params(body)) || 'bad_request';
  const sent = route.typed(body, who);
  if (!sent) return 'bad_request';
  const c = tidy(sent.code);
  if (c.length !== CODE_LENGTH) return 'not_a_card';
  if (!key) return 'no_key';
  const tag = await key.codeTag(c);
  if (!sent.check) return [tag, key.id];
  const { who: typed, session: token } = sent.check;
  const password = typed.password === null ? null : await key.passwordTag(c, tidy(typed.password));
  return [tag, key.id, typed.birthday, typed.studentNumber, password, token];
}

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
