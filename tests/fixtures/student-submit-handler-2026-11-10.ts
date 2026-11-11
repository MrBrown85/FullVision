// A TEST FIXTURE, NOT THE FUNCTION. This is
// supabase/functions/student-submit/handler.ts as it stood on Nov 10 2026
// (commit 995fa247), before S3-E1 made the function check a card by a
// keyed tag of its code. It is the handler that is deployed until S3-E1 is,
// and the only one a six-character card ever opened through. Two things
// use it: tests/helpers/fake-student-submit.js, for the student page's
// tests that still hold a six-character card, and
// tests/student-submit-card-key.test.js, to show what S3-E1 changed. The
// only line changed from the original is the import below, which points at
// the card routes of the same day. Delete both fixtures once no test holds
// a six-character card.
//
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
import { CARD_ROUTES, cardReply, type Param } from './student-submit-card-routes-2026-11-10.ts';

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

function ipv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every(n => n <= 255) ? parts : null;
}

// An IPv6 address as its eight 16-bit groups, or null when it is not one.
function ipv6(s: string): number[] | null {
  let tail: number[] | null = null;
  if (s.includes('.')) {
    // The last 32 bits written as an IPv4 address, as in ::ffff:203.0.113.7.
    const at = s.lastIndexOf(':');
    const v4 = ipv4(s.slice(at + 1));
    if (at < 0 || !v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    s = s.slice(0, at + 1) + '0:0';
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const groups = (h: string) => (h === '' ? [] : h.split(':'));
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  const given = head.length + rest.length;
  if (halves.length === 2 ? given > 7 : given !== 8) return null;
  if (![...head, ...rest].every(g => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const hex = (g: string) => parseInt(g, 16);
  const all = [...head.map(hex), ...Array(8 - given).fill(0), ...rest.map(hex)];
  return tail ? [...all.slice(0, 6), ...tail] : all;
}

/* What an address counts as for the rate limits.
   - An IPv4 address counts whole, as it always has.
   - An IPv6 address counts as its /64, the first four groups. A home or a
     school network is handed a whole /64 or more, and any device on it can
     pick a new address within it at will, so counting each full address let
     one connection have as many "addresses" as it wanted.
   - An IPv4 address written as IPv6 (::ffff:203.0.113.7) counts as that IPv4
     address, so one connection has one key however it is written.
   Brackets, a port and a zone id (fe80::1%en0) are dropped first. Anything
   that is not an address counts as 'unknown', the one key a missing address
   has always had, so made-up text is one bucket and not a new one each time. */
export function addressKey(address: string | null | undefined): string {
  let s = String(address || '')
    .trim()
    .toLowerCase();
  if (!s || s.length > 100) return 'unknown';
  const bracketed = /^\[([^\]]*)\](?::\d{1,5})?$/.exec(s);
  if (bracketed) s = bracketed[1];
  else if (/^[\d.]+:\d{1,5}$/.test(s)) s = s.slice(0, s.indexOf(':'));
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);

  const v4 = ipv4(s);
  if (v4) return v4.join('.');
  const v6 = ipv6(s);
  if (!v6) return 'unknown';
  if (v6.slice(0, 5).every(g => g === 0) && v6[5] === 0xffff) {
    return [v6[6] >> 8, v6[6] & 255, v6[7] >> 8, v6[7] & 255].join('.');
  }
  return (
    v6
      .slice(0, 4)
      .map(g => g.toString(16))
      .join(':') + '::/64'
  );
}

/* The caller's address as a keyed hash: the same phone on the same network
   hashes the same way for the rate limits, and the address itself is never
   stored or logged. The address comes from cf-connecting-ip, which Supabase's
   Cloudflare edge sets to the connecting address and overwrites when a caller
   sends one. The first X-Forwarded-For entry is whatever the caller sent, so
   a made-up one per request got around the per-address limit (Nov 3 bug
   sweep). Without cf-connecting-ip, as when served locally, the last entry is
   the one the nearest proxy added. What is hashed is addressKey's answer: an
   IPv4 address whole, an IPv6 address by its /64. */
export async function ipHash(req: Request, key: string): Promise<string> {
  const fwd = (req.headers.get('x-forwarded-for') || '').split(',');
  const ip = addressKey(req.headers.get('cf-connecting-ip') || fwd[fwd.length - 1]);
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
