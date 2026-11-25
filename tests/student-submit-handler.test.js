/**
 * The student-submit edge function's request handler
 * (supabase/functions/student-submit/handler.ts), with stand-in database
 * calls. The rules themselves live in SQL and are tested in
 * migrations/local-test/student_submit.py; this checks what the handler
 * adds: Canada only, request shape, CORS, a keyed IP hash, and logs with no
 * student data.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeHandler, ipHash, allowedOrigin } from '../supabase/functions/student-submit/handler.ts';
import { readCardKey } from '../supabase/functions/_shared/card-key.ts';
import { FAKE_KEY, codeTag } from './helpers/card-key-fake.js';

const KEY = await readCardKey(FAKE_KEY);
const CARD = 'P3R8WDK4';

function setup(overrides) {
  const calls = [];
  const logs = [];
  const handle = makeHandler(
    Object.assign(
      {
        region: 'ca-central-1',
        ipKey: 'test-key',
        cardKey: KEY,
        log: entry => logs.push(entry),
        db: {
          async call(text, p) {
            // card: the code's tag, the key id, the hashed address.
            calls.push({ route: 'card', tag: p[0], hash: p[2] });
            return p[0] === codeTag(CARD)
              ? { ok: true, kind: 'card', student: { first_name: 'Cece' } }
              : { ok: false, error: 'not_found' };
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
  it('looks a card up and answers with what the database said', async () => {
    const { handle, calls } = setup();
    const res = await handle(post({ route: 'card', code: 'P3R8-WDK4' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, student: { first_name: 'Cece' } });
    // The code goes as its tag; the plain code is never sent.
    expect(calls[0]).toMatchObject({ route: 'card', tag: codeTag(CARD) });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://fullvision.ca');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses to run outside ca-central-1, before touching the database', async () => {
    for (const region of ['us-east-1', undefined]) {
      const { handle, calls } = setup({ region });
      const res = await handle(post({ route: 'card', code: 'P3R8-WDK4' }));
      expect(res.status).toBe(421);
      expect(await res.json()).toEqual({ ok: false, error: 'wrong_region' });
      expect(calls).toHaveLength(0);
    }
  });

  it('refuses every route without the address key, before touching the database', async () => {
    for (const ipKey of [null, '']) {
      const { handle, calls, logs } = setup({ ipKey });
      for (const body of [
        { route: 'card', code: 'P3R8-WDK4' },
        { route: 'page', session: 'a'.repeat(64), enrollment_id: '00000001-0000-4000-8000-000000000000' },
      ]) {
        const res = await handle(post(body));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ ok: false, error: 'server' });
      }
      expect(calls).toEqual([]);
      expect(logs.every(l => l.outcome === 'no_ip_key')).toBe(true);
    }
  });

  it('hands the database a session token only as its SHA-256, on every route that takes one', async () => {
    const token = '7'.repeat(64);
    const seen = [];
    const { handle } = setup({
      db: {
        async call(text, p) {
          seen.push(p);
          return { ok: true };
        },
      },
    });
    for (const body of [
      { route: 'page', session: token, enrollment_id: '00000001-0000-4000-8000-000000000000' },
      { route: 'done', session: token },
      { route: 'work', session: token, enrollment_id: '00000001-0000-4000-8000-000000000000' },
    ]) {
      await handle(post(body));
    }
    expect(seen).toHaveLength(3);
    for (const p of seen) {
      expect(p[0]).toBe(createHash('sha256').update(token).digest('hex'));
      expect(JSON.stringify(p)).not.toContain(token);
    }
  });

  it('refuses bad requests without calling the database', async () => {
    const { handle, calls } = setup();
    const bad = [
      '{not json',
      '[1,2]',
      { route: 'delete' },
      { route: 'card' },
      { route: 'card', code: 'x'.repeat(33) },
      { route: 'open', code: 'K7M-4QX' },
      { route: 'check', token: 'a'.repeat(64), birthday: '2012-05-15' },
      { route: 'submit', token: 'a'.repeat(64), answers: {} },
      { route: 'verify', token: 'a'.repeat(64), student_number: '0123456' },
    ];
    for (const body of bad) {
      const res = await handle(post(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const big = await handle(post({ route: 'card', code: 'P3R8-WDK4', pad: 'y'.repeat(130000) }));
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

  it('hashes the address the platform sets with the key, never passing the address on', async () => {
    const a = await ipHash(post({}, { 'cf-connecting-ip': '203.0.113.7' }), 'k1');
    const b = await ipHash(post({}, { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '203.0.113.7' }), 'k1');
    const c = await ipHash(post({}, { 'cf-connecting-ip': '203.0.113.8' }), 'k1');
    const d = await ipHash(post({}, { 'cf-connecting-ip': '203.0.113.7' }), 'k2');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    const { handle, calls } = setup();
    await handle(post({ route: 'card', code: 'P3R8-WDK4' }));
    expect(calls[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(calls)).not.toContain('203.0.113.7');
  });

  it('ignores an X-Forwarded-For the caller made up', async () => {
    const real = await ipHash(post({}, { 'cf-connecting-ip': '203.0.113.7' }), 'k1');
    const forged = await ipHash(
      post({}, { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.9, 203.0.113.7' }),
      'k1',
    );
    const other = await ipHash(
      post({}, { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.10, 203.0.113.7' }),
      'k1',
    );
    expect(forged).toBe(real);
    expect(other).toBe(real);
  });

  it('takes the last forwarded address, which the nearest proxy added, when there is no cf-connecting-ip', async () => {
    const a = await ipHash(post({}, { 'x-forwarded-for': '198.51.100.9, 203.0.113.7' }), 'k1');
    const b = await ipHash(post({}, { 'x-forwarded-for': '198.51.100.10, 203.0.113.7' }), 'k1');
    const c = await ipHash(post({}, { 'cf-connecting-ip': '203.0.113.7' }), 'k1');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('logs route, outcome and time only', async () => {
    const { handle, logs } = setup();
    await handle(post({ route: 'card', code: 'P3R8-WDK4' }));
    await handle(post({ route: 'card', code: 'ZZZ-ZZZ-ZZ' }));
    expect(logs.map(l => l.outcome)).toEqual(['ok', 'not_found']);
    const text = JSON.stringify(logs);
    for (const leak of ['P3R8', 'WDK4', 'ZZZ', 'Cece', 'aaaa', '203.0.113']) expect(text).not.toContain(leak);
  });

  it('a database failure is a plain server error, with nothing from the error in the log', async () => {
    const { handle, logs } = setup({
      db: {
        async call() {
          throw new Error('duplicate key value (code_hmac)=(P3R8-WDK4)');
        },
      },
    });
    const res = await handle(post({ route: 'card', code: 'P3R8-WDK4' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'server' });
    expect(JSON.stringify(logs)).not.toContain('P3R8');
  });
});
