/**
 * The student-submit edge function's request handler
 * (supabase/functions/student-submit/handler.ts), with stand-in database
 * calls. The rules themselves live in SQL and are tested in
 * migrations/local-test/student_submit.py; this checks what the handler
 * adds: Canada only, request shape, CORS, a keyed IP hash, and logs with no
 * student data.
 */
import { describe, expect, it } from 'vitest';
import { makeHandler, ipHash, allowedOrigin } from '../supabase/functions/student-submit/handler.ts';

function setup(overrides) {
  const calls = [];
  const logs = [];
  const handle = makeHandler(
    Object.assign(
      {
        region: 'ca-central-1',
        ipKey: 'test-key',
        log: entry => logs.push(entry),
        db: {
          async open(code, hash) {
            calls.push({ route: 'open', code, hash });
            return code === 'K7M-4QX'
              ? { ok: true, token: 'a'.repeat(64), student: { first_name: 'Cece' } }
              : { ok: false, error: 'not_found' };
          },
          async submit(token, answers, hash) {
            calls.push({ route: 'submit', token, answers, hash });
            return { ok: true, submitted_at: '2026-11-04T10:00:00Z' };
          },
        },
      },
      overrides,
    ),
  );
  return { handle, calls, logs };
}

function post(body, headers) {
  return new Request('https://x.supabase.co/functions/v1/student-submit', {
    method: 'POST',
    headers: Object.assign(
      {
        'content-type': 'application/json',
        origin: 'https://fullvision.ca',
        'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      },
      headers,
    ),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('student-submit handler', () => {
  it('opens a code and answers with what the database said', async () => {
    const { handle, calls } = setup();
    const res = await handle(post({ route: 'open', code: 'K7M-4QX' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, student: { first_name: 'Cece' } });
    expect(calls[0]).toMatchObject({ route: 'open', code: 'K7M-4QX' });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://fullvision.ca');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('submits answers with the token', async () => {
    const { handle, calls } = setup();
    const answers = { 'q-1': 'Being curious helps me in labs.' };
    const res = await handle(post({ route: 'submit', token: 'a'.repeat(64), answers }));
    expect(await res.json()).toEqual({ ok: true, submitted_at: '2026-11-04T10:00:00Z' });
    expect(calls[0]).toMatchObject({ route: 'submit', token: 'a'.repeat(64), answers });
  });

  it('refuses to run outside ca-central-1, before touching the database', async () => {
    for (const region of ['us-east-1', undefined]) {
      const { handle, calls } = setup({ region });
      const res = await handle(post({ route: 'open', code: 'K7M-4QX' }));
      expect(res.status).toBe(421);
      expect(await res.json()).toEqual({ ok: false, error: 'wrong_region' });
      expect(calls).toHaveLength(0);
    }
  });

  it('refuses bad requests without calling the database', async () => {
    const { handle, calls } = setup();
    const bad = [
      '{not json',
      '[1,2]',
      { route: 'delete' },
      { route: 'open' },
      { route: 'open', code: 'x'.repeat(33) },
      { route: 'submit', answers: {} },
      { route: 'submit', token: 'a'.repeat(64) },
      { route: 'submit', token: 'a'.repeat(129), answers: {} },
    ];
    for (const body of bad) {
      const res = await handle(post(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const big = await handle(post({ route: 'submit', token: 'a', answers: { x: 'y'.repeat(130000) } }));
    expect(big.status).toBe(413);
    const get = await handle(new Request('https://x.supabase.co/functions/v1/student-submit'));
    expect(get.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it('allows only FullVision, its deploy previews and local dev', async () => {
    expect(allowedOrigin('https://fullvision.ca')).toBe('https://fullvision.ca');
    expect(allowedOrigin('https://www.fullvision.ca')).toBe('https://www.fullvision.ca');
    expect(allowedOrigin('https://deploy-preview-399--fullvision.netlify.app')).toBeTruthy();
    expect(allowedOrigin('http://localhost:8352')).toBeTruthy();
    expect(allowedOrigin('https://fullvision.ca.evil.com')).toBeNull();
    expect(allowedOrigin('https://deploy-preview-1--other.netlify.app')).toBeNull();
    expect(allowedOrigin(null)).toBeNull();
    const { handle } = setup();
    const pre = await handle(
      new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }),
    );
    expect(pre.status).toBe(403);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    const good = await handle(
      new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://fullvision.ca' } }),
    );
    expect(good.status).toBe(204);
    expect(good.headers.get('access-control-allow-headers')).toContain('content-type');
  });

  it('hashes the first forwarded address with the key, never passing the address on', async () => {
    const a = await ipHash(post({}, { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }), 'k1');
    const b = await ipHash(post({}, { 'x-forwarded-for': '203.0.113.7' }), 'k1');
    const c = await ipHash(post({}, { 'x-forwarded-for': '203.0.113.8' }), 'k1');
    const d = await ipHash(post({}, { 'x-forwarded-for': '203.0.113.7' }), 'k2');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    const { handle, calls } = setup();
    await handle(post({ route: 'open', code: 'K7M-4QX' }));
    expect(calls[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(calls)).not.toContain('203.0.113.7');
  });

  it('logs route, outcome and time only', async () => {
    const { handle, logs } = setup();
    await handle(post({ route: 'open', code: 'K7M-4QX' }));
    await handle(post({ route: 'open', code: 'ZZZ-ZZZ' }));
    await handle(post({ route: 'submit', token: 'a'.repeat(64), answers: { q: 'My secret answer' } }));
    expect(logs.map(l => l.outcome)).toEqual(['ok', 'not_found', 'ok']);
    const text = JSON.stringify(logs);
    for (const leak of ['K7M', 'ZZZ', 'Cece', 'secret', 'aaaa', '203.0.113']) expect(text).not.toContain(leak);
  });

  it('a database failure is a plain server error, with nothing from the error in the log', async () => {
    const { handle, logs } = setup({
      db: {
        async open() {
          throw new Error('duplicate key value (code_hash)=(K7M-4QX)');
        },
        async submit() {
          return {};
        },
      },
    });
    const res = await handle(post({ route: 'open', code: 'K7M-4QX' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'server' });
    expect(JSON.stringify(logs)).not.toContain('K7M');
  });
});
