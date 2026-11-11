// teacher-cards' second route: printing questionnaire and phone-report
// slips (plan S3-S1; migrations/2026111160_slips_keyed.sql).
//
//   { route: 'slips', kind: 'questionnaire' | 'report', id, enrollment_ids: [ids] | null, request_id }
//
// As for a card: for each student this draws a new six-character code (two
// candidates, since the database cannot be asked "is this code taken?"
// without being shown it) and a four-digit password, makes their tags with
// STUDENT_CARD_KEY under the slip's labels (../_shared/card-key.ts), and
// hands the tags to one database function, student_submit.issue_slips. The
// database stores tags and never sees a code. The reply carries each new
// code once, with its password for a student with no birthday or student
// number, to the browser that asked. This function keeps nothing.
//
// enrollment_ids null is every student the slips are for (the class's, or
// the report's): the database names them first (student_submit.slip_roster),
// so each can be drawn a code. A reprint is a new slip with a new code and,
// for a student with a password, a new password: the old one cannot be read.
//
// Who is asking, the region, the origins, the key and the log are the
// handler's (handler.ts), as for a card.
//
// Kept free of Deno and database imports, as handler.ts is.
import { type CardKey, type RandomSource, drawPassword, drawSlipCode, prettySlipCode } from '../_shared/card-key.ts';

type Json = Record<string, unknown>;

/** One student, with the two tagged candidates the database chooses between. */
export type SlipItem = { enrollment_id: string; candidates: { code_hmac: string; pw_hmac: string }[] };
export type SlipKind = 'questionnaire' | 'report';

export type SlipDb = {
  /* student_submit.slip_roster(p_teacher_id, p_kind, p_target_id): the students, in roster order. Raises as
     issue_slips does. */
  roster: (teacherId: string, kind: SlipKind, targetId: string) => Promise<unknown>;
  /* student_submit.issue_slips(p_teacher_id, p_kind, p_target_id, p_items, p_key_id, p_idempotency_key). It
     refuses a whole request by raising: PT401 not a teacher, P0002 not found or not this teacher's, FVS01 the
     report is closed. */
  slips: (
    teacherId: string,
    kind: SlipKind,
    targetId: string,
    items: SlipItem[],
    keyId: string,
    requestId: string,
  ) => Promise<unknown>;
};

/** The most students in one request, as for cards. */
export const MAX_SLIPS = 250;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);
function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export type SlipAsked = { kind: SlipKind; id: string; requestId: string; enrollmentIds: string[] | null };

/* The body of a slip request, checked. Null when the shape is wrong.
   Nothing else in it is read: a teacher id, a code or a tag sent in it is
   ignored. */
export function readSlipRequest(body: unknown): SlipAsked | null {
  if (!isObject(body) || body.route !== 'slips') return null;
  const kind = body.kind === 'questionnaire' || body.kind === 'report' ? body.kind : null;
  const id = uuid(body.id);
  const requestId = uuid(body.request_id);
  if (!kind || !id || !requestId) return null;
  if (body.enrollment_ids == null) return { kind, id, requestId, enrollmentIds: null };
  if (!Array.isArray(body.enrollment_ids) || body.enrollment_ids.length > MAX_SLIPS) return null;
  const seen = new Set<string>();
  for (const e of body.enrollment_ids) {
    const one = uuid(e);
    if (!one || seen.has(one)) return null;
    seen.add(one);
  }
  return { kind, id, requestId, enrollmentIds: [...seen] };
}

// What was drawn for one student. It lives for one request and is never stored, logged or sent to the database.
type Drawn = { codes: [string, string]; password: string };

async function drawAll(ids: string[], key: CardKey, random: RandomSource | undefined, drawn: Map<string, Drawn>) {
  const used = new Set<string>();
  const fresh = (): string => {
    for (let tries = 0; tries < 16; tries++) {
      const code = drawSlipCode(random);
      if (!used.has(code)) {
        used.add(code);
        return code;
      }
    }
    // Sixteen repeats in a row from six random characters: the random source is broken.
    throw new Error('random');
  };
  const items: SlipItem[] = [];
  for (const enrollment of ids) {
    const codes: [string, string] = [fresh(), fresh()];
    const password = drawPassword(random);
    drawn.set(enrollment, { codes, password });
    const candidates = [];
    for (const code of codes) {
      candidates.push({ code_hmac: await key.slipCodeTag(code), pw_hmac: await key.slipPasswordTag(code, password) });
    }
    items.push({ enrollment_id: enrollment, candidates });
  }
  return items;
}

const RESULTS = ['made', 'not_found', 'failed'];

/* The reply the browser is given, built field by field from what the
   database said, as for a card: a code only for a slip made in this request
   (never on a replay) and only the candidate the database says it stored; a
   password only when the database kept one. Null when the answer makes no
   sense. */
function buildReply(
  said: unknown,
  drawn: Map<string, Drawn>,
): { replayed: boolean; results: Json[]; made: number } | null {
  if (!isObject(said) || typeof said.replayed !== 'boolean' || !Array.isArray(said.results)) return null;
  const replayed = said.replayed;
  const answered = new Set<string>();
  const results: Json[] = [];
  let made = 0;
  for (const r of said.results) {
    if (!isObject(r)) return null;
    const enrollment = uuid(r.enrollment_id);
    if (typeof r.result !== 'string' || !RESULTS.includes(r.result)) return null;
    const mine = enrollment ? drawn.get(enrollment) : undefined;
    if (!enrollment || !mine || answered.has(enrollment)) continue;
    answered.add(enrollment);
    const out: Json = { enrollment_id: enrollment, result: r.result };
    if (r.result === 'made') {
      made += 1;
      out.slip_id = uuid(r.slip_id);
      if (!replayed && (r.candidate === 0 || r.candidate === 1)) {
        out.code = prettySlipCode(mine.codes[r.candidate]);
        if (r.has_password === true) out.password = mine.password;
      }
    }
    results.push(out);
  }
  return { replayed, results, made };
}

export type SlipAnswer = { status: number; outcome: string; body: Json; slips?: number };

/* One slip request, for a teacher Auth named and with the key. Throws what
   the database raises; handler.ts turns its SQLSTATE into the answer. */
export async function makeSlips(
  db: SlipDb,
  key: CardKey,
  teacherId: string,
  asked: SlipAsked,
  random?: RandomSource,
): Promise<SlipAnswer> {
  let ids = asked.enrollmentIds;
  if (ids == null) {
    const roster = await db.roster(teacherId, asked.kind, asked.id);
    if (!Array.isArray(roster)) throw new TypeError('roster');
    const named = new Set<string>();
    for (const e of roster) {
      const one = uuid(e);
      if (!one) throw new TypeError('roster');
      named.add(one);
    }
    ids = [...named];
    if (ids.length > MAX_SLIPS) return { status: 413, outcome: 'too_many', body: { ok: false, error: 'too_many' } };
  }
  if (!ids.length) return { status: 200, outcome: 'ok', body: { replayed: false, results: [] }, slips: 0 };
  // The new codes and passwords, by student. They live in this one request's memory and nowhere else.
  const drawn = new Map<string, Drawn>();
  try {
    const items = await drawAll(ids, key, random, drawn);
    const said = await db.slips(teacherId, asked.kind, asked.id, items, key.id, asked.requestId);
    const out = buildReply(said, drawn);
    if (!out) throw new TypeError('reply');
    return {
      status: 200,
      outcome: out.replayed ? 'replayed' : 'ok',
      body: { replayed: out.replayed, results: out.results },
      slips: out.made,
    };
  } finally {
    drawn.clear();
  }
}
