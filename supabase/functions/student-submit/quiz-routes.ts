// Quizzes on the student's page: open, save each answer, send (docs/plans/
// quizzes-plan.md, slice Q3a; the contract is migrations/local-test/
// quizzes-contract.md, "The student's side (MQ2)"; the functions are
// migrations/2026111806_quizzes_student.sql).
//
//   {route: 'quiz', session, enrollment_id, assessment_id, new_try?}
//        -> student_submit.quiz: the student's try (the first open starts
//           it; Try Again only with new_try: true), its questions in this
//           student's order and their own saved answers.
//   {route: 'quiz-save', session, enrollment_id, assessment_id, question_id,
//    answer}
//        -> student_submit.quiz_save: one answer to the open try; answer
//           null clears it. { ok, question_id, saved_at }.
//   {route: 'quiz-send', session, enrollment_id, assessment_id}
//        -> student_submit.quiz_send: the try is sent.
//           { ok, try, sent_at, tries_left, can_try_again }.
//
// The rules are bulletin-routes.ts's: the session checked by the database
// first, and who the student is taken only from that; the statement named
// here, every value a parameter; the request's shape checked before the
// database is asked; a reply rebuilt field by field from the lists in SENT
// (tests/student-submit-allow-list.test.js holds them to the SQL), so a key
// the database adds later is left behind until it is named there; a
// refusal passed on by its code, any other answered not_found; a log line
// with nothing about the student (handler.ts).
//
// THE ANSWER KEY never comes this way. The database's three functions never
// read it; these lists are the second look: a question carries only its id,
// number, kind, prompt, points, multiple and choices, a choice only its id
// and text, an answer only a raw answer's shape under a question shown.
//
// Kept free of Deno and database imports, as handler.ts is.
import {
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
  whole,
  type SendAnswer,
} from './send-routes.ts';

type Json = Record<string, unknown>;
type Param = string | null;

/** The routes this file serves. handler.ts sends a request here when its route is one of them. */
export const QUIZ_ROUTES: Record<string, true> = {
  quiz: true,
  'quiz-save': true,
  'quiz-send': true,
};

/** A quiz has at most 100 questions (the contract's limits). */
export const MAX_QUESTIONS = 100;
/** A choice question has at most 20 choices; a Choice answer names at most 20. */
export const MAX_CHOICES = 20;
/** A text answer is 1 to 5000 characters after trimming; before, the route takes at most 20,000. */
export const MAX_TEXT = 5000;
export const MAX_TEXT_SENT = 20_000;
/** A number answer is -10^12 to 10^12. */
export const MAX_NUMBER = 1e12;
/** The kinds a question may be. */
export const KINDS = ['choice', 'true_false', 'number', 'text'];

// The caller's hashed address comes after the ids, as every student_submit function takes it; quiz's new_try after it.
// The answer goes as JSON text typed as text and then cast to jsonb: typed as jsonb straight away, postgres.js would
// make a JSON string of it (tests/student-submit-json-params.test.js).
export const SQL = {
  quiz: 'select student_submit.quiz($1::text, $2::uuid, $3::uuid, $4::text, $5::text::boolean) as r',
  quizSave: 'select student_submit.quiz_save($1::text, $2::uuid, $3::uuid, $4::uuid, $5::text::jsonb, $6::text) as r',
  quizSend: 'select student_submit.quiz_send($1::text, $2::uuid, $3::uuid, $4::text) as r',
};

/* The keys passed on, level by level: exactly the contract's
   (tests/student-submit-allow-list.test.js holds them to the SQL). */
export const SENT = {
  quiz: ['ok', 'quiz', 'try', 'sent_tries', 'can_answer', 'can_try_again', 'questions', 'answers'],
  info: ['tries', 'tries_left', 'closed', 'closes_on'],
  try: ['number', 'sent', 'started_at', 'sent_at', 'reopened'],
  question: ['id', 'number', 'kind', 'prompt', 'points', 'multiple', 'choices'],
  choice: ['id', 'text'],
  save: ['ok', 'question_id', 'saved_at'],
  send: ['ok', 'try', 'sent_at', 'tries_left', 'can_try_again'],
};

// Refusals each route passes on by name; any other is not_found. bad_answer carries its question_id.
export const ERRORS = {
  quiz: [...SESSION_ERRORS, 'quiz_closed', 'no_tries_left', 'too_many'],
  'quiz-save': [...SESSION_ERRORS, 'quiz_closed', 'sent', 'bad_answer', 'too_many'],
  'quiz-send': [...SESSION_ERRORS, 'quiz_closed', 'sent', 'too_many'],
} as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A lone surrogate, which PostgreSQL's jsonb cannot hold (it answers an error), and NUL, which text cannot.
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const bool = (v: unknown): boolean => v === true;
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const date = (v: unknown): string | null => (typeof v === 'string' && DATE.test(v) ? v : null);
const count = (v: unknown, hi: number): number | null => (whole(v, 0, hi) ? v : null);
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A raw answer as the phone may send it: null, a boolean, a finite number, a string (at most MAX_TEXT_SENT
    characters, no NUL, no lone surrogate), or an array of 0 to 20 ids (lower-cased). Undefined when it is none of
    these. The database decides whether it fits its question (bad_answer). */
export function rawAnswer(v: unknown): unknown {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    if (v.includes('\u0000') || LONE.test(v) || [...v].length > MAX_TEXT_SENT) return undefined;
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length > MAX_CHOICES) return undefined;
    const ids = v.map(uuid);
    return ids.includes(null) ? undefined : ids;
  }
  return undefined;
}

/** An answer as the database sends one back, of a raw answer's shape, or undefined (then it is left out). */
function sentAnswer(v: unknown): unknown {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= MAX_NUMBER ? v : undefined;
  if (typeof v === 'string') return [...v].length <= MAX_TEXT ? v : undefined;
  if (Array.isArray(v) && v.length >= 1 && v.length <= MAX_CHOICES) {
    const ids = v.map(uuid);
    return ids.includes(null) ? undefined : ids;
  }
  return undefined;
}

/* One question, rebuilt: its id, a whole number, a known kind, its words, points, multiple, and its choices (id and
   text only) on a choice question, null otherwise. */
function question(q: unknown): Json {
  const x = isObject(q) ? q : {};
  const kind = typeof x.kind === 'string' && KINDS.includes(x.kind) ? x.kind : null;
  if (!uuid(x.id) || !kind || !whole(x.number, 1, MAX_QUESTIONS * 10)) throw new TypeError('question');
  const choices =
    kind === 'choice'
      ? list(x.choices).map(c => {
          const y = isObject(c) ? c : {};
          if (!uuid(y.id)) throw new TypeError('choice');
          return { id: uuid(y.id), text: text(y.text) };
        })
      : null;
  if (choices && choices.length > MAX_CHOICES) throw new TypeError('choices');
  return {
    id: uuid(x.id),
    number: x.number,
    kind,
    prompt: text(x.prompt),
    points: finite(x.points),
    multiple: bool(x.multiple),
    choices,
  };
}

/* The answer to quiz, rebuilt. The keys in the order the contract writes them. */
export function quizReply(r: Json): Json {
  const info = isObject(r.quiz) ? r.quiz : {};
  const t = isObject(r.try) ? r.try : null;
  const all = list(r.questions);
  if (all.length > MAX_QUESTIONS) throw new TypeError('questions');
  const questions = all.map(question);
  const shown = new Set(questions.map(q => q.id as string));
  // Only answers to a question shown, each of a raw answer's shape.
  const answers: Json = {};
  if (isObject(r.answers)) {
    for (const [k, v] of Object.entries(r.answers)) {
      const id = uuid(k);
      const a = sentAnswer(v);
      if (id && shown.has(id) && a !== undefined) answers[id] = a;
    }
  }
  return {
    ok: true,
    quiz: {
      tries: whole(info.tries, 0, 2) ? info.tries : null,
      tries_left: count(info.tries_left, 2),
      closed: bool(info.closed),
      closes_on: date(info.closes_on),
    },
    try: t && {
      number: count(t.number, 1_000_000),
      sent: bool(t.sent),
      ...pick(t, ['started_at', 'sent_at']),
      reopened: bool(t.reopened),
    },
    sent_tries: count(r.sent_tries, 1_000_000) ?? 0,
    can_answer: bool(r.can_answer),
    can_try_again: bool(r.can_try_again),
    questions,
    answers,
  };
}

/* A refusal with bad_answer's question_id, which refusal() does not carry. */
function refused(r: unknown, errors: readonly string[]): Json {
  const out = refusal(r, errors);
  if (out.error === 'bad_answer') return { ...out, question_id: isObject(r) ? uuid(r.question_id) : null };
  return out;
}

/* The three ids every route takes, or null. */
function ids(body: Json): Param[] | null {
  const s = session(body);
  const e = uuid(body.enrollment_id);
  const a = uuid(body.assessment_id);
  return s && e && a ? [s, e, a] : null;
}

export function makeQuizRoutes(opts: { db: { call: (sql: string, params: Param[]) => Promise<unknown> } }) {
  async function open(body: Json, hash: string): Promise<SendAnswer> {
    const p = ids(body);
    const n = body.new_try === undefined ? false : body.new_try;
    if (!p || typeof n !== 'boolean') return bad();
    const r = await opts.db.call(SQL.quiz, [...p, hash, n ? 'true' : 'false']);
    return ok(good(r) ? quizReply(r) : refusal(r, ERRORS.quiz));
  }

  async function save(body: Json, hash: string): Promise<SendAnswer> {
    const p = ids(body);
    const q = uuid(body.question_id);
    const a = Object.hasOwn(body, 'answer') ? rawAnswer(body.answer) : undefined;
    if (!p || !q || a === undefined) return bad();
    const r = await opts.db.call(SQL.quizSave, [...p, q, a === null ? null : JSON.stringify(a), hash]);
    if (!good(r)) return ok(refused(r, ERRORS['quiz-save']));
    if (uuid(r.question_id) !== q) throw new TypeError('question_id');
    return ok({ ok: true, question_id: q, ...pick(r, ['saved_at']) });
  }

  async function send(body: Json, hash: string): Promise<SendAnswer> {
    const p = ids(body);
    if (!p) return bad();
    const r = await opts.db.call(SQL.quizSend, [...p, hash]);
    if (!good(r)) return ok(refusal(r, ERRORS['quiz-send']));
    return ok({
      ok: true,
      try: count(r.try, 1_000_000),
      ...pick(r, ['sent_at']),
      tries_left: count(r.tries_left, 2),
      can_try_again: bool(r.can_try_again),
    });
  }

  return async function run(route: string, body: Json, hash: string): Promise<SendAnswer> {
    if (route === 'quiz') return open(body, hash);
    if (route === 'quiz-save') return save(body, hash);
    if (route === 'quiz-send') return send(body, hash);
    return bad();
  };
}
