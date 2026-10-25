// The student-submit request handler (docs/STUDENT-VOICE-PLAN.md, PR 6).
//
// A student's phone posts here; nothing else does. Two routes:
//   {route: 'open', code}             -> student_submit.open
//   {route: 'submit', token, answers} -> student_submit.submit
// The SQL functions (migrations/20261025_student_submit.sql) hold every
// rule; this file only checks the request's shape, refuses to run outside
// ca-central-1, turns the caller's IP into a keyed hash, and answers with
// what the database said.
//
// Kept free of Deno and database imports so the tests run it under Node
// with stand-in database calls. index.ts wires the real ones.

export type Db = {
  open: (code: string, ipHash: string) => Promise<Record<string, unknown>>;
  submit: (token: string, answers: unknown, ipHash: string) => Promise<Record<string, unknown>>;
};

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
   stored or logged. */
export async function ipHash(req: Request, key: string): Promise<string> {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const ip = (fwd.split(',')[0] || req.headers.get('cf-connecting-ip') || 'unknown').trim();
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
    let result: Record<string, unknown>;
    try {
      const hash = await ipHash(req, opts.ipKey);
      if (route === 'open') {
        if (typeof body.code !== 'string' || body.code.length > 32) {
          return reply(400, { ok: false, error: 'bad_request' }, origin);
        }
        result = await opts.db.open(body.code, hash);
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

    // Route, outcome and time. Never the code, token, answers or name.
    log({
      route,
      outcome: result && result.ok ? 'ok' : (result && result.error) || 'unknown',
      ms: Date.now() - started,
    });
    return reply(200, result, origin);
  };
}
