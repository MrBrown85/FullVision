/**
 * teacher-cards' slips route (supabase/functions/teacher-cards/slips.ts,
 * plan S3-S1): a signed-in teacher prints questionnaire and phone-report
 * slips. As for a card: the teacher is the one Auth names, the database is
 * handed tags and never a code or a password, a code comes back once and
 * only for the candidate stored, a replay gives no code, and nothing is
 * logged but the route, the outcome, a count and the time.
 */
import { describe, expect, it } from 'vitest';
import { readCardKey, ALPHABET } from '../supabase/functions/_shared/card-key.ts';
import { makeHandler } from '../supabase/functions/teacher-cards/handler.ts';
import { readSlipRequest } from '../supabase/functions/teacher-cards/slips.ts';
import { FAKE_KEY, bytesFrom, keyId, slipCodeTag, slipPasswordTag } from './helpers/card-key-fake.js';

const KEY = await readCardKey(FAKE_KEY);
const TEACHER = '11111111-1111-4111-8111-111111111111';
const QID = '22222222-2222-4222-8222-222222222222';
const CECE = '33333333-3333-4333-8333-333333333331';
const OMAR = '33333333-3333-4333-8333-333333333332';
const REQUEST = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.' + 'dGVhY2hlcg'.repeat(4) + '.c2lnbmF0dXJlLW9uZQ';

/* Draws exactly these: two codes then a password for each student. */
const draws = (...values) =>
  bytesFrom(
    values.flatMap(v =>
      /^\d{4}$/.test(v)
        ? [...v].map(Number).concat([0, 0, 0, 0])
        : [...v].map(c => ALPHABET.indexOf(c)).concat(Array(6).fill(0)),
    ),
  );

function setup(over = {}) {
  const handed = [];
  const logs = [];
  const db = {
    issue: async () => {
      throw new Error('a card request');
    },
    async roster(teacherId, kind, id) {
      handed.push({ fn: 'roster', teacherId, kind, id });
      return [CECE, OMAR];
    },
    async slips(teacherId, kind, id, items, keyId, requestId) {
      handed.push({ fn: 'slips', teacherId, kind, id, items, keyId, requestId });
      return {
        replayed: false,
        results: items.map((it, i) => ({
          enrollment_id: it.enrollment_id,
          result: 'made',
          slip_id: REQUEST,
          candidate: i % 2,
          has_password: it.enrollment_id === OMAR,
        })),
      };
    },
    ...over.db,
  };
  const handle = makeHandler({
    region: 'ca-central-1',
    cardKey: 'cardKey' in over ? over.cardKey : KEY,
    whoIs: async () => TEACHER,
    random: over.random,
    log: e => logs.push(e),
    db,
  });
  return { handle, handed, logs };
}
const ask = body =>
  new Request('https://x.supabase.co/functions/v1/teacher-cards?forceFunctionRegion=ca-central-1', {
    method: 'POST',
    headers: { origin: 'https://fullvision.ca', authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const slips = more => ({
  route: 'slips',
  kind: 'questionnaire',
  id: QID,
  enrollment_ids: null,
  request_id: REQUEST,
  ...more,
});
const send = async (h, body) => {
  const res = await h.handle(ask(body));
  return { status: res.status, body: await res.json() };
};

describe('teacher-cards: slips', () => {
  it('every student when none are named: the roster first, then one tag pair each, codes back once', async () => {
    const h = setup({ random: draws('K7M4QX', 'P3R8WD', '9073', 'ABC234', 'ZZZZZZ', '4821') });
    const res = await send(h, slips());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      replayed: false,
      results: [
        { enrollment_id: CECE, result: 'made', slip_id: REQUEST, code: 'K7M-4QX' },
        { enrollment_id: OMAR, result: 'made', slip_id: REQUEST, code: 'ZZZ-ZZZ', password: '4821' },
      ],
    });
    expect(h.handed.map(x => x.fn)).toEqual(['roster', 'slips']);
    const call = h.handed[1];
    expect([call.teacherId, call.kind, call.id, call.keyId, call.requestId]).toEqual([
      TEACHER,
      'questionnaire',
      QID,
      keyId(),
      REQUEST,
    ]);
    expect(call.items[1].candidates).toEqual([
      { code_hmac: slipCodeTag('ABC234'), pw_hmac: slipPasswordTag('ABC234', '4821') },
      { code_hmac: slipCodeTag('ZZZZZZ'), pw_hmac: slipPasswordTag('ZZZZZZ', '4821') },
    ]);
    // Tags and ids only: no code or password reaches the database or the log.
    const seen = JSON.stringify(h.handed) + JSON.stringify(h.logs);
    for (const plain of ['K7M4QX', 'P3R8WD', 'ABC234', 'ZZZZZZ', '4821', '9073', TOKEN])
      expect(seen).not.toContain(plain);
    expect(h.logs).toEqual([{ route: 'slips', outcome: 'ok', slips: 2, ms: expect.any(Number) }]);
  });

  it('named students go as named, with no roster asked; a report has the same shape', async () => {
    const h = setup();
    const res = await send(h, slips({ kind: 'report', enrollment_ids: [OMAR.toUpperCase()] }));
    expect(res.status).toBe(200);
    expect(h.handed.map(x => x.fn)).toEqual(['slips']);
    expect(h.handed[0].kind).toBe('report');
    expect(h.handed[0].items.map(i => i.enrollment_id)).toEqual([OMAR]);
  });

  it('a replay gives no code, even if the database names a candidate', async () => {
    const h = setup({
      db: {
        slips: async () => ({
          replayed: true,
          results: [{ enrollment_id: CECE, result: 'made', slip_id: REQUEST, candidate: 0 }],
        }),
      },
    });
    const res = await send(h, slips({ enrollment_ids: [CECE] }));
    expect(res.body).toEqual({ replayed: true, results: [{ enrollment_id: CECE, result: 'made', slip_id: REQUEST }] });
  });

  it.each([
    ['PT401', 401, 'unauthorized'],
    ['P0002', 404, 'not_found'],
    ['FVS01', 409, 'closed'],
  ])('the database raising %s answers %s', async (code, status, error) => {
    const h = setup({ db: { roster: async () => Promise.reject(Object.assign(new Error('x ' + QID), { code })) } });
    expect(await send(h, slips())).toEqual({ status, body: { ok: false, error } });
    expect(JSON.stringify(h.logs)).not.toContain(QID);
  });

  it('no key: a server error, and the database is not asked', async () => {
    const h = setup({ cardKey: null });
    expect(await send(h, slips())).toEqual({ status: 500, body: { ok: false, error: 'server' } });
    expect(h.handed).toEqual([]);
  });

  it('reads only a well-formed request', async () => {
    expect(readSlipRequest(slips({ enrollment_ids: [CECE] }))).toEqual({
      kind: 'questionnaire',
      id: QID,
      requestId: REQUEST,
      enrollmentIds: [CECE],
    });
    for (const bad of [
      slips({ kind: 'cards' }),
      slips({ id: 'q1' }),
      slips({ request_id: null }),
      slips({ enrollment_ids: [CECE, CECE] }),
      slips({ enrollment_ids: ['e1'] }),
      slips({
        enrollment_ids: Array.from({ length: 251 }, (_, i) => '33333333-3333-4333-8333-' + String(i).padStart(12, '0')),
      }),
    ]) {
      expect(readSlipRequest(bad)).toBeNull();
      const h = setup();
      expect((await send(h, bad)).status).toBe(400);
      expect(h.handed).toEqual([]);
    }
  });
});
