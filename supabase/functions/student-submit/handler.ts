// The student-submit request handler (docs/STUDENT-VOICE-PLAN.md, PR 6).
//
// A student's phone posts here; nothing else does. Four routes for a slip:
//   {route: 'open', code}             -> student_submit.open
//   {route: 'verify', token, birthday | student_number | password}
//                                     -> student_submit.verify (questionnaires)
//   {route: 'check', token, birthday} -> student_submit.check (phone reports)
//   {route: 'submit', token, answers} -> student_submit.submit
// and the student card's routes, in card-routes.ts: card, verify (with a
// code in place of a token), add-card, page, seen and done.
// The SQL functions (migrations/20261025_student_submit.sql, and
// migrations/2026110904_student_sessions_page.sql for a card) hold every
// rule; this file only checks the request's shape, refuses to run outside
// ca-central-1, turns the caller's IP into a keyed hash, and answers with
// what the database said.
//
// Kept free of Deno and database imports so the tests run it under Node
// with stand-in database calls. index.ts wires the real ones.
import { CARD_ROUTES, cardReply, type Param } from './card-routes.ts';

export type Db = {
  open: (code: string, ipHash: string) => Promise<Record<string, unknown>>;
  verify: (token: string, who: Identity, ipHash: string) => Promise<Record<string, unknown>>;
  check: (token: string, birthday: string, ipHash: string) => Promise<Record<string, unknown>>;
  submit: (token: string, answers: unknown, ipHash: string) => Promise<Record<string, unknown>>;
  // A card route's one statement (card-routes.ts), with its parameters. Gives back the function's reply.
  call: (sql: string, params: Param[]) => Promise<unknown>;
};

// What the student typed to show the slip is theirs; any one may match.
export type Identity = { birthday: string | null; studentNumber: string | null; password: string | null };

export type Options = {
  db: Db;
  region: string | undefined; // SB_REGION
  ipKey: string; // HMAC key for IP hashes
  log?: (entry: Record<string, unknown>) => void;
};

export const REGION = 'ca-central-1';
const MAX_BODY = 120_000;

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
    'Access-Control-Allow-Headers': 'content-type, x-region',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function reply(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...cors(origin),
    },
  });
}

/* The caller's address as a keyed hash: the same phone on the same network
   hashes the same way for the rate limits, and the address itself is never
   stored or logged. The address comes from cf-connecting-ip, which Supabase's
   Cloudflare edge sets to the connecting address and overwrites when a caller
   sends one. The first X-Forwarded-For entry is whatever the caller sent, so
   a made-up one per request got around the per-address limit (Nov 3 bug
   sweep). Without cf-connecting-ip, as when served locally, the last entry is
   the one the nearest proxy added. */
export async function ipHash(req: Request, key: string): Promise<string> {
  const fwd = (req.headers.get('x-forwarded-for') || '').split(',');
  const ip = (req.headers.get('cf-connecting-ip') || fwd[fwd.length - 1] || '').trim() || 'unknown';
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(ip)));
  return Array.from(sig, b => b.toString(16).padStart(2, '0')).join('');
}

/* The verify body's identity fields: each a short string or absent, and at
   least one given. Null when the shape is wrong. */
export function identity(body: Record<string, unknown>): Identity | null {
  const field = (v: unknown, max: number): string | null | undefined => {
    if (v == null || v === '') return null;
    return typeof v === 'string' && v.length <= max ? v : undefined;
  };
  const birthday = field(body.birthday, 10);
  const studentNumber = field(body.student_number, 32);
  const password = field(body.password, 16);
  if (birthday === undefined || studentNumber === undefined || password === undefined) return null;
  if (birthday !== null && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null;
  if (birthday === null && studentNumber === null && password === null) return null;
  return { birthday, studentNumber, password };
}

export function makeHandler(opts: Options) {
  const log = opts.log || (entry => console.log(JSON.stringify(entry)));

  return async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get('origin');
    const started = Date.now();

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: allowedOrigin(origin) ? 204 : 403, headers: cors(origin) });
    }
    // Student data is handled in Canada or not at all.
    if (opts.region !== REGION) {
      log({ route: null, outcome: 'wrong_region', region: opts.region || null });
      return reply(421, { ok: false, error: 'wrong_region' }, origin);
    }
    if (req.method !== 'POST') return reply(405, { ok: false, error: 'method' }, origin);

    const length = Number(req.headers.get('content-length') || 0);
    if (length > MAX_BODY) return reply(413, { ok: false, error: 'too_large' }, origin);
    let body: Record<string, unknown>;
    try {
      const text = await req.text();
      if (text.length > MAX_BODY) return reply(413, { ok: false, error: 'too_large' }, origin);
      body = JSON.parse(text);
    } catch {
      return reply(400, { ok: false, error: 'bad_request' }, origin);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply(400, { ok: false, error: 'bad_request' }, origin);
    }

    const route = body.route;
    // A verify with a token is a slip's, as it always was; with a code and no token, a card's.
    const card =
      typeof route === 'string' &&
      Object.hasOwn(CARD_ROUTES, route) &&
      (route !== 'verify' || (body.token == null && body.code != null))
        ? CARD_ROUTES[route]
        : null;
    let result: Record<string, unknown>;
    try {
      const hash = await ipHash(req, opts.ipKey);
      if (card) {
        const params = card.params(body, identity(body));
        if (!params) return reply(400, { ok: false, error: 'bad_request' }, origin);
        result = cardReply(card, await opts.db.call(card.sql, [...params, hash]));
      } else if (route === 'open') {
        if (typeof body.code !== 'string' || body.code.length > 32) {
          return reply(400, { ok: false, error: 'bad_request' }, origin);
        }
        result = await opts.db.open(body.code, hash);
      } else if (route === 'verify') {
        const who = identity(body);
        if (typeof body.token !== 'string' || body.token.length > 128 || !who) {
          return reply(400, { ok: false, error: 'bad_request' }, origin);
        }
        result = await opts.db.verify(body.token, who, hash);
      } else if (route === 'check') {
        if (
          typeof body.token !== 'string' ||
          body.token.length > 128 ||
          typeof body.birthday !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(body.birthday)
        ) {
          return reply(400, { ok: false, error: 'bad_request' }, origin);
        }
        result = await opts.db.check(body.token, body.birthday, hash);
      } else if (route === 'submit') {
        if (typeof body.token !== 'string' || body.token.length > 128 || body.answers == null) {
          return reply(400, { ok: false, error: 'bad_request' }, origin);
        }
        result = await opts.db.submit(body.token, body.answers, hash);
      } else {
        return reply(400, { ok: false, error: 'bad_request' }, origin);
      }
    } catch (e) {
      // The error's class only: a database message can quote a value.
      log({ route, outcome: 'error', kind: e instanceof Error ? e.name : typeof e, ms: Date.now() - started });
      return reply(500, { ok: false, error: 'server' }, origin);
    }

    // Route, outcome and time. Never the code, token, session token,
    // birthday, student number, password, answers or name.
    log({
      route,
      outcome: result && result.ok ? 'ok' : (result && result.error) || 'unknown',
      ms: Date.now() - started,
    });
    return reply(200, result, origin);
  };
}
