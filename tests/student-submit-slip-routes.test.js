/**
 * A slip's open and verify with the card key (supabase/functions/student-submit/slip-routes.ts,
 * plan S3-S1). The database is handed tags and never the plain code or password; since 2026112406 there
 * is no second call for a slip from before the key. A slip's token reaches the database only as its hash (2026112403): open is given the hash of a token the
 * function made, and the phone that token.
 */
import { describe, expect, it } from 'vitest';
import { readCardKey } from '../supabase/functions/_shared/card-key.ts';
import { makeHandler as makeRealHandler } from '../supabase/functions/student-submit/handler.ts';
import { sha256, tokensAtTheDatabase } from './helpers/session-hash.js';
import { SLIP_SQL } from '../supabase/functions/student-submit/slip-routes.ts';
import { FAKE_KEY, keyId, slipCodeTag, slipPasswordTag } from './helpers/card-key-fake.js';

// The stand-in database is handed the tokens the test sent; one sent as itself fails (2026112401).
const makeHandler = tokensAtTheDatabase(makeRealHandler);

const KEY = await readCardKey(FAKE_KEY);
const TOKEN = 'a'.repeat(64);

function setup(answer, extra = {}) {
  const calls = [];
  const logs = [];
  const handle = makeHandler({
    region: 'ca-central-1',
    ipKey: 'k',
    cardKey: 'cardKey' in extra ? extra.cardKey : KEY,
    sessionToken: () => TOKEN,
    log: e => logs.push(e),
    db: {
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
    const h = setup(() => ({ ok: true, new_token: true }));
    expect((await h.send({ route: 'open', code: 'k7m-4qx' })).body).toEqual({ ok: true, token: TOKEN });
    expect(h.calls).toEqual([['open', [slipCodeTag('K7M4QX'), keyId(), expect.any(String), sha256(TOKEN)]]]);
    expect(JSON.stringify(h.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(h.calls)).not.toContain('K7M4QX');
  });

  it('a token the database names is never passed on; no new_token, no token', async () => {
    const h = setup(() => ({ ok: true, token: 'e'.repeat(64) }));
    expect((await h.send({ route: 'open', code: 'K7M4QX' })).body).toEqual({ ok: true });
  });

  it('a code nobody holds: one call, not_found, the code in no log', async () => {
    const h = setup(() => ({ ok: false, error: 'not_found' }));
    expect((await h.send({ route: 'open', code: 'ABC234' })).body).toEqual({ ok: false, error: 'not_found' });
    expect(h.calls).toHaveLength(1);
    expect(h.logs.map(l => l.outcome)).toEqual(['not_found']);
    expect(JSON.stringify(h.logs)).not.toContain('ABC234');
  });

  it('not a slip’s code: no tag, one call, so the database counts a bad format', async () => {
    const h = setup(() => ({ ok: false, error: 'not_found' }));
    await h.send({ route: 'open', code: 'K7M4Q1' });
    expect(h.calls).toEqual([['open', [null, keyId(), expect.any(String), sha256(TOKEN)]]]);
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
  it('with the code: the password’s tag, bound to the code, in one call; the typed password never sent', async () => {
    const h = setup(() => ({ ok: true, parts: [] }));
    const res = await h.send({ route: 'verify', token: TOKEN, code: 'K7M4QX', password: '4821' });
    expect(res.body).toEqual({ ok: true, parts: [] });
    expect(h.calls).toEqual([['verify', [TOKEN, null, null, slipPasswordTag('K7M4QX', '4821'), expect.any(String)]]]);
    expect(JSON.stringify(h.calls)).not.toContain('4821');
    expect(JSON.stringify(h.logs)).not.toContain('4821');
  });

  it('a birthday or student number goes as typed: it is checked where it lives', async () => {
    const h = setup(() => ({ ok: true, parts: [] }));
    await h.send({ route: 'verify', token: TOKEN, code: 'K7M4QX', student_number: '0123456' });
    expect(h.calls[0][1]).toEqual([TOKEN, null, '0123456', null, expect.any(String)]);
  });

  it('no code with the password: no tag can be made, so nothing of the password is sent', async () => {
    const h = setup(() => ({ ok: false, error: 'wrong_identity', tries_left: 4 }));
    await h.send({ route: 'verify', token: TOKEN, password: '4821' });
    expect(h.calls[0][1]).toEqual([TOKEN, null, null, null, expect.any(String)]);
  });
});
