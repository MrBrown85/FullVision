/**
 * scheduled-sweep: the student-submit edge function's route for the
 * database's own timer (migrations/2026111140_photo_lifecycle.sql, section 6:
 * pg_cron calls public.photo_removal_call every ten minutes, which posts
 * { route: 'scheduled-sweep', secret } through pg_net when a queued file is
 * due). The route runs the removal worker, and nothing else, for a caller
 * holding PHOTO_SWEEP_SECRET.
 *
 * Run through the whole handler with the stand-in database and bucket of
 * tests/helpers/fake-send-world.js, as the other send routes are.
 */
import { describe, expect, it } from 'vitest';
import { makeHandler } from '../supabase/functions/student-submit/handler.ts';
import { sweepSecret } from '../supabase/functions/student-submit/send-routes.ts';
import { C1, CECE, LAB, fakeWorld } from './helpers/fake-send-world.js';

const URL_ = 'https://x.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1';
const SECRET = '5e'.repeat(32); // a test value
const OTHER = 'a1'.repeat(32);
const REQ = '0f0f0f0f-0000-4000-8000-000000000001';
const FILE = '0f0f0f0f-0000-4000-8000-000000000002';
const path = (n, thumb = false) =>
  `${C1}/${LAB}/${CECE}/${REQ}/${FILE.slice(0, -2)}${String(n).padStart(2, '0')}${thumb ? '-thumb' : ''}.jpg`;

function setup(extra = {}) {
  const world = fakeWorld();
  const logs = [];
  const handle = makeHandler({
    region: 'region' in extra ? extra.region : 'ca-central-1',
    ipKey: 'test-key',
    db: {
      open: async () => ({ ok: false }),
      verify: async () => ({ ok: false }),
      check: async () => ({ ok: false }),
      submit: async () => ({ ok: false }),
      call: world.db.call,
    },
    store: 'store' in extra ? extra.store : world.store,
    whoIs: null,
    log: entry => logs.push(entry),
    defer: extra.defer,
    sweepSecret: 'secret' in extra ? extra.secret : SECRET,
  });
  const send = async body => {
    const res = await handle(
      new Request(URL_, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: await res.json() };
  };
  return { world, logs, send };
}
const queueSome = (world, n) => {
  for (let i = 1; i <= n; i++) world.queue.push({ id: i, bucket: 'student-photos', path: path(i), done: false });
};
const names = world => world.calls.map(c => c[0]);

describe('scheduled-sweep: the database timer runs the removal worker', () => {
  it('with the secret: the worker deletes exactly the queued files and reports them done; the answer is ok and nothing else', async () => {
    const t = setup();
    queueSome(t.world, 3);
    const r = await t.send({ route: 'scheduled-sweep', secret: SECRET });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(t.world.calls.find(c => c[0] === 'removal_batch')[1]).toEqual(['200']);
    expect(t.world.storeCalls.filter(c => c[0] === 'remove').flatMap(c => c[1])).toEqual([path(1), path(2), path(3)]);
    expect(t.world.queue.every(q => q.done)).toBe(true);
    expect(t.logs).toContainEqual({ route: 'scheduled-sweep', worker: 'ran', removed: 3, skipped: 0, left: 0 });
  });

  it('nothing else in the body is read: no path, class or limit a caller sends is used', async () => {
    const t = setup();
    queueSome(t.world, 1);
    await t.send({ route: 'scheduled-sweep', secret: SECRET, paths: [path(9)], course_id: C1, limit: 5 });
    expect(t.world.calls.find(c => c[0] === 'removal_batch')[1]).toEqual(['200']);
    expect(t.world.storeCalls.filter(c => c[0] === 'remove').flatMap(c => c[1])).toEqual([path(1)]);
  });

  it.each([
    ['no secret', {}],
    ['a wrong secret', { secret: OTHER }],
    ['the secret in upper case', { secret: SECRET.toUpperCase() }],
    ['the secret with one character more', { secret: SECRET + '0' }],
    ['the secret cut short', { secret: SECRET.slice(1) }],
    ['a list', { secret: [SECRET] }],
    ['a number', { secret: 5 }],
    ["a teacher's sign-in token instead", { access_token: 'eyJhbGciOiJIUzI1NiJ9.someone.else' }],
  ])('%s: refused (401), and neither the database nor storage is asked', async (_label, extra) => {
    const t = setup();
    queueSome(t.world, 2);
    const r = await t.send({ route: 'scheduled-sweep', ...extra });
    expect(r).toEqual({ status: 401, body: { ok: false, error: 'unauthorized' } });
    expect(t.world.calls).toEqual([]);
    expect(t.world.storeCalls).toEqual([]);
  });

  it.each([
    ['not set', null],
    ['empty', ''],
    ['not 64 hex characters', 'short'],
    ['upper-case hex', SECRET.toUpperCase()],
  ])(
    'PHOTO_SWEEP_SECRET %s: a server error, even for the right-looking secret, and nothing runs',
    async (_l, secret) => {
      const t = setup({ secret });
      queueSome(t.world, 1);
      const r = await t.send({ route: 'scheduled-sweep', secret: SECRET });
      expect(r).toEqual({ status: 500, body: { ok: false, error: 'server' } });
      expect(t.world.calls).toEqual([]);
      expect(t.world.storeCalls).toEqual([]);
    },
  );

  it('without the bucket: a server error, and the database is not asked', async () => {
    const t = setup({ store: null });
    const r = await t.send({ route: 'scheduled-sweep', secret: SECRET });
    expect(r.status).toBe(500);
    expect(t.world.calls).toEqual([]);
  });

  it('outside ca-central-1: refused before the body is read', async () => {
    const t = setup({ region: 'us-east-1' });
    const r = await t.send({ route: 'scheduled-sweep', secret: SECRET });
    expect(r).toEqual({ status: 421, body: { ok: false, error: 'wrong_region' } });
    expect(t.world.calls).toEqual([]);
  });

  it('runs up to 40 rounds while files are left (a teacher’s sweep stops at 10)', async () => {
    const t = setup();
    let n = 0;
    t.world.override.removal_batch = () => ({
      ok: true,
      items: [{ id: ++n, bucket: 'student-photos', path: path(n % 90) }],
      left: 1,
    });
    t.world.override.removal_done = () => ({ ok: true, gone: 1, still_there: [] });
    await t.send({ route: 'scheduled-sweep', secret: SECRET });
    expect(names(t.world).filter(x => x === 'removal_batch').length).toBe(40);
  });

  it('with EdgeRuntime.waitUntil: answers at once (pg_net waits 10 seconds) and the runtime is handed the worker', async () => {
    const later = [];
    const t = setup({ defer: p => later.push(p) });
    queueSome(t.world, 2);
    let release;
    const gate = new Promise(r => (release = r));
    t.world.override.removal_batch = async (params, fns) => (await gate, fns.removal_batch(params));
    const r = await Promise.race([
      t.send({ route: 'scheduled-sweep', secret: SECRET }),
      new Promise(res => setTimeout(() => res('waited'), 200)),
    ]);
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(later.length).toBe(1);
    release();
    await Promise.all(later);
    expect(t.world.queue.every(q => q.done)).toBe(true);
  });

  it('a failing worker never reaches the answer; the queue keeps its files', async () => {
    const t = setup();
    queueSome(t.world, 1);
    t.world.override.removal_batch = () => {
      throw new Error('db down');
    };
    const r = await t.send({ route: 'scheduled-sweep', secret: SECRET });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(t.world.queue.every(q => !q.done)).toBe(true);
    expect(t.logs).toContainEqual({ route: 'scheduled-sweep', worker: 'error', kind: 'Error', removed: 0, skipped: 0 });
  });

  it('no log line holds the secret, right or wrong', async () => {
    const t = setup();
    queueSome(t.world, 1);
    await t.send({ route: 'scheduled-sweep', secret: SECRET });
    await t.send({ route: 'scheduled-sweep', secret: OTHER });
    const all = JSON.stringify(t.logs);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(OTHER);
    expect(all).not.toContain(path(1));
  });
});

describe('sweepSecret: the only shape PHOTO_SWEEP_SECRET may have', () => {
  it('64 lower-case hex characters, and nothing else', () => {
    expect(sweepSecret(SECRET)).toBe(SECRET);
    for (const v of [
      undefined,
      null,
      '',
      SECRET.toUpperCase(),
      SECRET + ' ',
      ' ' + SECRET,
      SECRET.slice(2),
      'g'.repeat(64),
      64,
      [SECRET],
    ])
      expect(sweepSecret(v)).toBeNull();
  });

  it('index.ts reads PHOTO_SWEEP_SECRET through it, logs nothing of it, and hands it to the handler', async () => {
    const src = (await import('node:fs')).readFileSync('supabase/functions/student-submit/index.ts', 'utf8');
    expect(src).toMatch(/sweepSecret\(Deno\.env\.get\('PHOTO_SWEEP_SECRET'\)\)/);
    expect(src).not.toMatch(/console\.log\([^)]*[Ss]weep/);
    expect(src).toMatch(/sweepSecret: photoSweepSecret/);
  });

  it('the database sends exactly what this route reads (route and secret), to the Canada address', async () => {
    const sql = (await import('node:fs')).readFileSync('migrations/2026111140_photo_lifecycle.sql', 'utf8');
    expect(sql).toMatch(/jsonb_build_object\('route', 'scheduled-sweep', 'secret', _secret\)/);
    expect(sql).toMatch(/forceFunctionRegion=ca-central-1\$'/);
    expect(sql).toMatch(/_secret !~ '\^\[0-9a-f\]\{64\}\$'/);
  });
});
