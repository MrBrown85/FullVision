/**
 * A slip's open and verify with the card key (supabase/functions/student-submit/slip-routes.ts,
 * plan S3-S1). The database is handed tags; the plain code goes only on open's second call, when the
 * database asks for it (a slip printed before 2026111160, not yet converted), and the typed password
 * only on verify's second call, or from a page that sends no code. `fallback` never reaches the phone.
 * Before the migration (SQLSTATE 42883) both go the old way.
 */
import { describe, expect, it } from 'vitest';
import { readCardKey } from '../supabase/functions/_shared/card-key.ts';
import { makeHandler } from '../supabase/functions/student-submit/handler.ts';
import { SLIP_SQL } from '../supabase/functions/student-submit/slip-routes.ts';
import { FAKE_KEY, keyId, slipCodeTag, slipPasswordTag } from './helpers/card-key-fake.js';

const KEY = await readCardKey(FAKE_KEY);
const TOKEN = 'a'.repeat(64);

function setup(answer, extra = {}) {
  const calls = [];
  const logs = [];
  const handle = makeHandler({
    region: 'ca-central-1',
    ipKey: 'k',
    cardKey: 'cardKey' in extra ? extra.cardKey : KEY,
    log: e => logs.push(e),
    db: {
      open: async (code, hash) => (calls.push(['old open', code]), { ok: true, token: TOKEN }),
      verify: async (token, who) => (calls.push(['old verify', who]), { ok: true, parts: [] }),
      async call(sql, params) {
        calls.push([sql === SLIP_SQL.open ? 'open' : 'verify', params]);
        return answer(sql, params, calls.length);
      },
    },
  });
  const send = async body => {
    const res = await handle(
      new Request('https://x/', {
        method: 'POST',
        headers: { origin: 'https://fullvision.ca', 'cf-connecting-ip': '203.0.113.7' },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: await res.json() };
  };
  return { send, calls, logs };
}

describe('a slip’s open', () => {
  it('a slip found by its tag: one call, the plain code never sent', async () => {
    const h = setup(() => ({ ok: true, token: TOKEN }));
    expect((await h.send({ route: 'open', code: 'k7m-4qx' })).body).toEqual({ ok: true, token: TOKEN });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0][1].slice(0, 3)).toEqual([slipCodeTag('K7M4QX'), keyId(), null]);
  });

  it('the database asks for the plain code: a second call with it, and fallback is not passed on', async () => {
    const h = setup((sql, p, n) =>
      n === 1 ? { ok: false, error: 'not_found', fallback: true } : { ok: true, token: TOKEN },
    );
    expect((await h.send({ route: 'open', code: 'K7M-4QX' })).body).toEqual({ ok: true, token: TOKEN });
    expect(h.calls.map(c => c[1][2])).toEqual([null, 'K7M4QX']);
    const miss = setup((sql, p, n) => ({ ok: false, error: 'not_found', ...(n === 1 ? { fallback: true } : {}) }));
    expect((await miss.send({ route: 'open', code: 'ABC234' })).body).toEqual({ ok: false, error: 'not_found' });
    expect(miss.logs.map(l => l.outcome)).toEqual(['not_found']);
    expect(JSON.stringify(miss.logs)).not.toContain('ABC234');
  });

  it('not a slip’s code: no tag, one call, so the database counts a bad format as before', async () => {
    const h = setup(() => ({ ok: false, error: 'not_found', fallback: true }));
    await h.send({ route: 'open', code: 'K7M4Q1' });
    expect(h.calls).toEqual([['open', [null, keyId(), null, expect.any(String)]]]);
  });

  it('before the migration: the old open, with the code as typed', async () => {
    const h = setup(() => Promise.reject(Object.assign(new Error('no function'), { code: '42883' })));
    expect((await h.send({ route: 'open', code: 'k7m-4qx' })).body).toEqual({ ok: true, token: TOKEN });
    expect(h.calls.map(c => c[0])).toEqual(['open', 'old open']);
    expect(h.calls[1][1]).toBe('k7m-4qx');
  });

  it('no key: a server error, and nothing is asked', async () => {
    const h = setup(() => ({ ok: true }), { cardKey: null });
    expect(await h.send({ route: 'open', code: 'K7M4QX' })).toEqual({
      status: 500,
      body: { ok: false, error: 'server' },
    });
    expect(h.calls).toEqual([]);
  });
});

describe('a slip’s verify', () => {
  it('with the code: the password’s tag first, bound to the code; the typed password only when asked', async () => {
    const h = setup((sql, p, n) =>
      n === 1 ? { ok: false, error: 'wrong_identity', fallback: true } : { ok: true, parts: [] },
    );
    const res = await h.send({ route: 'verify', token: TOKEN, code: 'K7M4QX', password: '4821' });
    expect(res.body).toEqual({ ok: true, parts: [] });
    expect(h.calls[0][1]).toEqual([
      TOKEN,
      null,
      null,
      null,
      slipCodeTag('K7M4QX'),
      slipPasswordTag('K7M4QX', '4821'),
      expect.any(String),
    ]);
    expect(h.calls[1][1][3]).toBe('4821');
    expect(JSON.stringify(h.logs)).not.toContain('4821');
  });

  it('matched by its tag: one call, the typed password never sent', async () => {
    const h = setup(() => ({ ok: true, parts: [] }));
    await h.send({ route: 'verify', token: TOKEN, code: 'K7M4QX', password: '4821' });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0][1][3]).toBeNull();
  });

  it('a page that sends no code: no tags, the password as typed, as before', async () => {
    const h = setup(() => ({ ok: true, parts: [] }));
    await h.send({ route: 'verify', token: TOKEN, password: '4821' });
    expect(h.calls[0][1]).toEqual([TOKEN, null, null, '4821', null, null, expect.any(String)]);
  });

  it('before the migration: the old verify', async () => {
    const h = setup(() => Promise.reject(Object.assign(new Error('x'), { code: '42883' })));
    expect((await h.send({ route: 'verify', token: TOKEN, code: 'K7M4QX', birthday: '2012-05-15' })).body).toEqual({
      ok: true,
      parts: [],
    });
    expect(h.calls.map(c => c[0])).toEqual(['verify', 'old verify']);
  });
});
