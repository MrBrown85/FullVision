// The teacher-cards request handler: making student cards.
//
// A signed-in teacher's browser posts here, and nothing else does:
//   { course_id, items: [{ enrollment_id, replaces: <card id or null> }], request_id }
// One request covers every button. Make Cards is the students with no card
// (replaces null). Print New Card is one student, naming their live card.
// New Codes for This Class is every student.
//
// For each student this draws a new eight-character code and a four-digit
// password, makes their tags with STUDENT_CARD_KEY (../_shared/card-key.ts)
// and hands the tags to one database function, student_submit.issue_cards.
// The database stores tags and never sees a code. The reply carries each
// new code once, to the browser that asked, and this function keeps
// nothing: a code that was not printed from that reply is gone, and the
// teacher makes a new card.
//
// What the function is trusted with, and how each is held:
//   - Who is asking. The teacher's id comes only from Supabase Auth's
//     answer about the token sent (whoIs). It is never read from the body.
//     The database then decides what that teacher owns, with the same
//     helpers every other write uses.
//   - The codes. Two are drawn per student, because a code must be unlike
//     every card ever made and the database cannot be asked "is this code
//     taken?" without being shown it. It is handed both tags, uses the
//     second if the first is taken, and says which (candidate 0 or 1). The
//     code returned is that one, and only for a student the database says
//     was made. The other is thrown away.
//   - A replay. The same request_id sent again makes nothing: the database
//     answers what happened the first time and no code comes back, since
//     the first reply's codes were never kept anywhere.
//
// Kept apart from student-submit on purpose: that function is the public
// one a phone posts to with no sign-in, and nothing in it can reach this.
// The region check, the allowed origins and no-store are the same as there
// (tests/teacher-cards-handler.test.js checks the two agree).
//
// Kept free of Deno and database imports so the tests run it under Node.
// index.ts wires the real database and the real Auth.
import { type CardKey, type RandomSource, drawCode, drawPassword, prettyCode } from '../_shared/card-key.ts';

type Json = Record<string, unknown>;

/** One student in the request, with the two tagged candidates the database chooses between. */
export type IssueItem = {
  enrollment_id: string;
  replaces: string | null;
  candidates: { code_hmac: string; pw_hmac: string }[];
};

export type Db = {
  /* student_submit.issue_cards(p_teacher_id, p_course_id, p_items, p_key_id,
     p_idempotency_key). Gives back its reply. It refuses a whole request by
     raising: the error's `code` is the SQLSTATE (PT401 not a teacher, P0002
     class not found or not this teacher's). */
  issue: (
    teacherId: string,
    courseId: string,
    items: IssueItem[],
    keyId: string,
    requestId: string,
  ) => Promise<unknown>;
};

export type Options = {
  db: Db;
  region: string | undefined; // SB_REGION
  // STUDENT_CARD_KEY as readCardKey gives it: null or absent when it is missing or malformed.
  cardKey?: CardKey | null;
  /* Who a sign-in token belongs to: the user's id, or null when Supabase
     Auth does not accept the token. Throws when Auth cannot be asked. */
  whoIs: (token: string) => Promise<string | null>;
  // The random source for codes and passwords. crypto.getRandomValues unless a test gives another.
  random?: RandomSource;
  log?: (entry: Record<string, unknown>) => void;
};

export const REGION = 'ca-central-1';
/** The most students in one request: more than any class. A bigger request is refused whole. */
export const MAX_ITEMS = 250;
const MAX_BODY = 64_000;

const ORIGINS = [
  /^https:\/\/(www\.)?fullvision\.ca$/,
  /^https:\/\/deploy-preview-\d+--fullvision\.netlify\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

export function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return ORIGINS.some(re => re.test(origin)) ? origin : null;
}

function cors(origin: string | null): Record<string, string> {
  const ok = allowedOrigin(origin);
  if (!ok) return {};
  return {
    'Access-Control-Allow-Origin': ok,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // The sign-in token rides in Authorization; the rest is what the Supabase client adds.
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-region',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function reply(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // The reply holds new codes: no cache, anywhere, ever keeps it.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...cors(origin),
    },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);

function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/* The sign-in token from "Authorization: Bearer <token>", or null. Only its
   shape is checked here; whoIs asks Supabase Auth whose it is. */
export function bearer(req: Request): string | null {
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/.exec(req.headers.get('authorization') || '');
  return m ? m[1] : null;
}

/* whoIs for index.ts: asks Supabase Auth who a token belongs to
   (GET /auth/v1/user). This is the check that counts. It works however the
   project signs its tokens, because Auth itself reads the token; nothing
   here decodes one. Only a 200 that names a user is a yes. A token Auth
   refuses (any 4xx but "slow down") is null, and the handler answers 401.
   Anything else is thrown, and the handler answers a server error: an Auth
   outage is never read as "signed in", and never as "your sign-in is bad"
   either. */
export function authUser(fetcher: typeof fetch, supabaseUrl: string, anonKey: string) {
  const url = supabaseUrl.replace(/\/+$/, '') + '/auth/v1/user';
  return async function whoIs(token: string): Promise<string | null> {
    const res = await fetcher(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, apikey: anonKey },
    });
    if (res.status !== 200) {
      try {
        if (res.body) await res.body.cancel();
      } catch {
        /* nothing to release */
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return null;
      throw new Error('auth');
    }
    const user: unknown = await res.json();
    return isObject(user) ? uuid(user.id) : null;
  };
}

type Asked = { courseId: string; requestId: string; items: { enrollment_id: string; replaces: string | null }[] };

/* The request's body, checked: a class, a request id, and up to 250
   students, each once, each naming the card it replaces or none. Null when
   the shape is wrong. Nothing else in the body is read; a teacher id sent
   in it is ignored. */
export function readRequest(body: unknown): Asked | null {
  if (!isObject(body)) return null;
  const courseId = uuid(body.course_id);
  const requestId = uuid(body.request_id);
  if (!courseId || !requestId || !Array.isArray(body.items) || body.items.length > MAX_ITEMS) return null;
  const seen = new Set<string>();
  const items: Asked['items'] = [];
  for (const it of body.items) {
    if (!isObject(it)) return null;
    const enrollment = uuid(it.enrollment_id);
    const replaces = it.replaces == null ? null : uuid(it.replaces);
    if (!enrollment || seen.has(enrollment) || (it.replaces != null && !replaces)) return null;
    seen.add(enrollment);
    items.push({ enrollment_id: enrollment, replaces });
  }
  return { courseId, requestId, items };
}

// What was drawn for one student. It lives for one request and is never stored, logged or sent to the database.
type Drawn = { codes: [string, string]; password: string };

/* Two codes and one password for each student, and their tags. Every code
   in a request is unlike every other: the database refuses a request that
   holds one tag twice, and a student's two candidates must differ or the
   second is no use. */
async function drawAll(
  asked: Asked,
  key: CardKey,
  random: RandomSource | undefined,
  drawn: Map<string, Drawn>,
): Promise<IssueItem[]> {
  const used = new Set<string>();
  const fresh = (): string => {
    for (let tries = 0; tries < 16; tries++) {
      const code = drawCode(random);
      if (!used.has(code)) {
        used.add(code);
        return code;
      }
    }
    // Sixteen repeats in a row from eight random characters: the random source is broken.
    throw new Error('random');
  };
  const items: IssueItem[] = [];
  for (const it of asked.items) {
    const codes: [string, string] = [fresh(), fresh()];
    const password = drawPassword(random);
    drawn.set(it.enrollment_id, { codes, password });
    const candidates = [];
    for (const code of codes) {
      candidates.push({ code_hmac: await key.codeTag(code), pw_hmac: await key.passwordTag(code, password) });
    }
    items.push({ enrollment_id: it.enrollment_id, replaces: it.replaces, candidates });
  }
  return items;
}

const RESULTS = ['made', 'changed', 'not_found', 'failed'];

/* The reply the browser is given, built field by field from what the
   database said. Null when the database's answer makes no sense.
     - A student the request did not name is left out, and so is a second
       answer for the same student.
     - card_id, seq and works_until only for a card that was made.
     - code only for a card that was made in this request (never on a
       replay), and it is the candidate the database says it stored. If the
       database does not say which, no code is returned: the wrong one
       would print a card that never opens.
     - password only when the database kept one for this card (the student
       has no birthday and no student number on file). */
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
      out.card_id = uuid(r.card_id);
      out.seq = typeof r.seq === 'number' ? r.seq : null;
      out.works_until = typeof r.works_until === 'string' ? r.works_until : null;
      if (!replayed && (r.candidate === 0 || r.candidate === 1)) {
        out.code = prettyCode(mine.codes[r.candidate]);
        if (r.has_password === true) out.password = mine.password;
      }
    }
    results.push(out);
  }
  return { replayed, results, made };
}

export function makeHandler(opts: Options) {
  const log = opts.log || (entry => console.log(JSON.stringify(entry)));

  return async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get('origin');
    const started = Date.now();
    // Route, outcome, how many cards and time. Never a code, a tag, the key, a password, the token or a name.
    const done = (status: number, outcome: string, body: unknown, cards?: number): Response => {
      log({ route: 'issue', outcome, ...(cards == null ? {} : { cards }), ms: Date.now() - started });
      return reply(status, body, origin);
    };
    const refuse = (status: number, error: string, outcome?: string) =>
      done(status, outcome || error, { ok: false, error });

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: allowedOrigin(origin) ? 204 : 403, headers: cors(origin) });
    }
    // Student data is handled in Canada or not at all.
    if (opts.region !== REGION) {
      log({ route: null, outcome: 'wrong_region', region: opts.region || null });
      return reply(421, { ok: false, error: 'wrong_region' }, origin);
    }
    if (req.method !== 'POST') return reply(405, { ok: false, error: 'method' }, origin);

    // Who is asking, before anything else is read. No token, or one Auth does not accept: 401, and the
    // database is never called.
    const token = bearer(req);
    if (!token) return refuse(401, 'unauthorized');
    let teacherId: string | null;
    try {
      teacherId = uuid(await opts.whoIs(token));
    } catch (e) {
      log({
        route: 'issue',
        outcome: 'auth_error',
        kind: e instanceof Error ? e.name : typeof e,
        ms: Date.now() - started,
      });
      return reply(500, { ok: false, error: 'server' }, origin);
    }
    if (!teacherId) return refuse(401, 'unauthorized');

    // No key, no cards: nothing is drawn and the database is not called.
    const key = opts.cardKey || null;
    if (!key) return refuse(500, 'server', 'no_card_key');

    const length = Number(req.headers.get('content-length') || 0);
    if (length > MAX_BODY) return refuse(413, 'too_large');
    let asked: Asked | null;
    try {
      const text = await req.text();
      if (text.length > MAX_BODY) return refuse(413, 'too_large');
      asked = readRequest(JSON.parse(text));
    } catch {
      asked = null;
    }
    if (!asked) return refuse(400, 'bad_request');

    // The new codes and passwords, by student. They live in this one request's memory and nowhere else.
    const drawn = new Map<string, Drawn>();
    try {
      const items = await drawAll(asked, key, opts.random, drawn);
      const said = await opts.db.issue(teacherId, asked.courseId, items, key.id, asked.requestId);
      const out = buildReply(said, drawn);
      if (!out) throw new TypeError('reply');
      return done(200, out.replayed ? 'replayed' : 'ok', { replayed: out.replayed, results: out.results }, out.made);
    } catch (e) {
      // The database refuses a whole request by raising. Its SQLSTATE says why; its message is never read,
      // since a message can quote a value.
      const state = isObject(e) && typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : null;
      if (state === 'PT401') return refuse(401, 'unauthorized', 'not_a_teacher');
      if (state === 'P0002') return refuse(404, 'not_found');
      log({
        route: 'issue',
        outcome: 'error',
        kind: e instanceof Error ? e.name : typeof e,
        ...(state ? { sqlstate: state } : {}),
        ms: Date.now() - started,
      });
      return reply(500, { ok: false, error: 'server' }, origin);
    } finally {
      // Whatever happened, the function lets go of every code it drew. The reply already holds the ones it is to carry.
      drawn.clear();
    }
  };
}
