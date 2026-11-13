/**
 * Counting how often a score that waited in the outbox meets a newer one on
 * the server (shared/overwrite-count.js). The count is measured only: it
 * reads, reports one line to Sentry, and must never change what the outbox
 * sends. The last test runs the same offline-then-online scenario with and
 * without the counter and compares every call the fake server saw.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

// Production loads the outbox next to shared/data.js; so do these tests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});
const COUNTER_SOURCE = readFileSync(resolve(root, 'shared/overwrite-count.js'), 'utf-8');

// A page load of the counter: fresh state, attached to the outbox.
function loadCounter() {
  runInThisContext(COUNTER_SOURCE, { filename: 'shared/overwrite-count.js' });
}
function unloadCounter() {
  if (window.OverwriteCount) window.OverwriteCount.detach();
}

const CID = '11111111-1111-4111-8111-111111111111';
const ENR1 = '22222222-2222-4222-8222-222222222221';
const ENR2 = '22222222-2222-4222-8222-222222222222';
const ENR3 = '22222222-2222-4222-8222-222222222223';
const AID = '44444444-4444-4444-8444-444444444444';
const TAG1 = '77777777-7777-4777-8777-777777777771';
const QUEUE_KEY = 'fv-sync-queue-v1';

function seed(field, value) {
  _cache[field][CID] = value;
  localStorage.setItem('gb-' + _DATA_KEYS[field] + '-' + CID, JSON.stringify(value));
  _rememberServerState(field, CID, value);
}

const tagEntry = score => ({
  id: AID + ':' + TAG1,
  assessmentId: AID,
  tagId: TAG1,
  score,
  date: '2026-11-03',
  type: 'summative',
  note: '',
});

// Make every waiting write look as if it was queued `ms` ago.
function age(ms) {
  const q = JSON.parse(localStorage.getItem(QUEUE_KEY));
  q.entries.forEach(e => {
    e.created_at = new Date(Date.now() - ms).toISOString();
  });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

let fake, reads, sentry, originalGetSupabase, originalUseSupabase, originalDemo, serverTagRows, answer;

// The fake server's read side: sb.from(table).select(...).in(...).in(...).
function installReads() {
  reads = [];
  fake.from = table => {
    const query = {
      table,
      filters: [],
      select(columns) {
        query.columns = columns;
        return query;
      },
      in(column, values) {
        query.filters.push([column, values]);
        return query;
      },
      eq(column, value) {
        query.filters.push([column, [value]]);
        return query;
      },
      then(onOk, onErr) {
        reads.push(query);
        const res = answer
          ? answer(table)
          : Promise.resolve({ data: table === 'tag_score' ? serverTagRows : [], error: null });
        return Promise.resolve(res).then(onOk, onErr);
      },
    };
    return query;
  };
}

// Offline, three cells scored on this device; the server's last known
// values: ENR1 2, ENR2 none, ENR3 3.
function scoreThreeOffline() {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  upsertScore(CID, ENR1, AID, TAG1, 3, '2026-11-13', 'summative', '');
  upsertScore(CID, ENR2, AID, TAG1, 2, '2026-11-13', 'summative', '');
  upsertScore(CID, ENR3, AID, TAG1, 4, '2026-11-13', 'summative', '');
}

// Back online: the outbox drains while the fake server holds every write,
// so the counter's read happens while they are still waiting.
async function reconnect() {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  fake.hold();
  const flushing = window.v2Queue.flush();
  // The counter runs on a timer after the drain has started.
  await new Promise(r => setTimeout(r, 5));
  await settle();
  await fake.release();
  await flushing;
  await settle();
}

const row = (enr, value, extra) =>
  Object.assign({ enrollment_id: enr, assessment_id: AID, tag_id: TAG1, value, modifier: 0, comment: null }, extra);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('sb-testproject-auth-token', JSON.stringify({ user: { id: 'teacher-uuid' } }));
  _serverState = {};
  seed('students', [
    { id: ENR1, firstName: 'Mateo', lastName: 'Alvarez' },
    { id: ENR2, firstName: 'Ana', lastName: 'Lopez' },
    { id: ENR3, firstName: 'Kai', lastName: 'Chen' },
  ]);
  seed('assessments', [{ id: AID, title: 'Unit 1 Lab', date: '2026-11-03', tagIds: [TAG1] }]);
  seed('scores', { [ENR1]: [tagEntry(2)], [ENR3]: [tagEntry(3)] });
  fake = makeFakeSupabase();
  installReads();
  answer = null;
  // The phone scored ENR3 1 while this device was offline.
  serverTagRows = [row(ENR1, 2), row(ENR3, 1)];
  originalGetSupabase = globalThis.getSupabase;
  originalUseSupabase = _useSupabase;
  originalDemo = globalThis.isDemoMode;
  globalThis.getSupabase = () => fake;
  globalThis.isDemoMode = () => false;
  _useSupabase = true;
  _supabaseDegraded = false;
  _teacherId = 'teacher-uuid';
  sentry = { captureMessage: vi.fn() };
  window.Sentry = sentry;
  window.v2Queue.clear();
  loadCounter();
});

afterEach(() => {
  unloadCounter();
  globalThis.getSupabase = originalGetSupabase;
  globalThis.isDemoMode = originalDemo;
  _useSupabase = originalUseSupabase;
  delete window.Sentry;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  window.v2Queue.clear();
});

describe('when there is nothing to count', () => {
  it('reads nothing when nothing waited', async () => {
    await reconnect();
    expect(reads).toHaveLength(0);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('reads nothing for writes younger than 60 seconds', async () => {
    scoreThreeOffline();
    age(30 * 1000);
    await reconnect();
    expect(reads).toHaveLength(0);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('reads nothing in Demo Mode', async () => {
    scoreThreeOffline();
    age(5 * 60 * 1000);
    globalThis.isDemoMode = () => true;
    await reconnect();
    expect(reads).toHaveLength(0);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('reads nothing without Sentry', async () => {
    scoreThreeOffline();
    age(5 * 60 * 1000);
    delete window.Sentry;
    await reconnect();
    expect(reads).toHaveLength(0);
  });
});

describe('counting', () => {
  it('reports 1 of 3 when the server changed one of three waiting cells', async () => {
    scoreThreeOffline();
    age(5 * 60 * 1000);
    await reconnect();
    expect(reads).toHaveLength(1);
    expect(reads[0].table).toBe('tag_score');
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage.mock.calls[0]).toEqual([
      'Overwrite count: 1 of 3 waiting cells changed on the server, 0 not measured (waited 1-10 min)',
      'warning',
    ]);
  });

  it('carries only the text and the level', async () => {
    scoreThreeOffline();
    age(5 * 60 * 1000);
    await reconnect();
    const args = JSON.stringify(sentry.captureMessage.mock.calls);
    [CID, ENR1, ENR2, ENR3, AID, TAG1, 'Mateo', 'Ana', 'Kai', 'Alvarez', 'Unit 1 Lab'].forEach(s => {
      expect(args).not.toContain(s);
    });
    expect(sentry.captureMessage.mock.calls[0]).toHaveLength(2);
  });

  it('does not count a cell the server already holds at the value being sent', async () => {
    serverTagRows = [row(ENR1, 2), row(ENR3, 4)];
    scoreThreeOffline();
    age(5 * 60 * 1000);
    await reconnect();
    expect(sentry.captureMessage.mock.calls[0][0]).toBe(
      'Overwrite count: 0 of 3 waiting cells changed on the server, 0 not measured (waited 1-10 min)',
    );
  });

  it('counts a proficiency 0 on the server as no score', async () => {
    serverTagRows = [row(ENR1, 2), row(ENR2, 0), row(ENR3, 3)];
    scoreThreeOffline();
    age(5 * 60 * 1000);
    await reconnect();
    expect(sentry.captureMessage.mock.calls[0][0]).toBe(
      'Overwrite count: 0 of 3 waiting cells changed on the server, 0 not measured (waited 1-10 min)',
    );
  });

  it('counts a + or − added on the server as a change', async () => {
    serverTagRows = [row(ENR1, 2, { modifier: 1 }), row(ENR3, 3)];
    scoreThreeOffline();
    age(5 * 60 * 1000);
    await reconnect();
    expect(sentry.captureMessage.mock.calls[0][0]).toBe(
      'Overwrite count: 1 of 3 waiting cells changed on the server, 0 not measured (waited 1-10 min)',
    );
  });

  it('names the bucket of the oldest waiting write', async () => {
    scoreThreeOffline();
    age(3 * 60 * 60 * 1000);
    await reconnect();
    expect(sentry.captureMessage.mock.calls[0][0]).toBe(
      'Overwrite count: 1 of 3 waiting cells changed on the server, 0 not measured (waited 1-24 h)',
    );
  });

  it('reports once per bucket per page load', async () => {
    scoreThreeOffline();
    age(5 * 60 * 1000);
    await reconnect();
    // More waiting writes in the same bucket: no second read or report.
    upsertScore(CID, ENR1, AID, TAG1, 1, '2026-11-13', 'summative', '');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    upsertScore(CID, ENR2, AID, TAG1, 4, '2026-11-13', 'summative', '');
    age(6 * 60 * 1000);
    await reconnect();
    expect(reads).toHaveLength(1);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    // Another bucket still reports.
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    upsertScore(CID, ENR3, AID, TAG1, 2, '2026-11-13', 'summative', '');
    age(2 * 24 * 60 * 60 * 1000);
    await reconnect();
    expect(sentry.captureMessage).toHaveBeenCalledTimes(2);
    expect(sentry.captureMessage.mock.calls[1][0]).toMatch(/, 0 not measured \(waited over 24 h\)$/);
  });
});

describe('points work and the Overall Comment', () => {
  const PTS = '44444444-4444-4444-8444-444444444445';
  const pointsEntry = score => Object.assign(tagEntry(score), { id: PTS + ':' + TAG1, assessmentId: PTS });

  function setUp(scoreRow) {
    seed('assessments', [
      { id: AID, title: 'Unit 1 Lab', date: '2026-11-03', tagIds: [TAG1] },
      { id: PTS, title: 'Quiz', date: '2026-11-03', scoreMode: 'points', maxPoints: 20, tagIds: [TAG1] },
    ]);
    seed('scores', { [ENR1]: [pointsEntry(17)] });
    answer = table =>
      Promise.resolve({
        data: table === 'score' ? [Object.assign({ enrollment_id: ENR1, assessment_id: PTS }, scoreRow)] : [],
        error: null,
      });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    setPointsScore(CID, ENR1, PTS, 18);
    age(15 * 60 * 1000);
  }

  it('counts a points score changed on the server', async () => {
    setUp({ value: 15, modifier: 0, status: null, comment: null });
    await reconnect();
    expect(reads.map(r => r.table)).toEqual(['score']);
    expect(sentry.captureMessage.mock.calls[0][0]).toBe(
      'Overwrite count: 1 of 1 waiting cells changed on the server, 0 not measured (waited 10-60 min)',
    );
  });

  it('does not count a points score the server still holds as this device knew it', async () => {
    setUp({ value: 17, modifier: 0, status: null, comment: null });
    await reconnect();
    expect(sentry.captureMessage.mock.calls[0][0]).toBe(
      'Overwrite count: 0 of 1 waiting cells changed on the server, 0 not measured (waited 10-60 min)',
    );
  });

  it('counts an Overall Comment changed on the server', async () => {
    setUp({ value: 17, modifier: 0, status: null, comment: 'From the phone.' });
    saveScoreComment(CID, ENR1, PTS, 'From the laptop.');
    age(15 * 60 * 1000);
    await reconnect();
    expect(sentry.captureMessage.mock.calls[0][0]).toBe(
      'Overwrite count: 1 of 1 waiting cells changed on the server, 0 not measured (waited 10-60 min)',
    );
  });
});

describe('waiting cells that cannot be measured', () => {
  const offline = () => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });

  // A write queued with a baseline row this tab holds, so it is left out
  // for its kind alone.
  function queueWithBaseline(endpoint, payload) {
    const r = window.v2Queue.enqueue(endpoint, payload, { noFlush: true });
    _baselineUndo[r.id] = { field: 'scores', cid: CID, prev: [tagEntry(2)] };
  }

  it('reports every waiting score after a reload as not measured, with no read', async () => {
    scoreThreeOffline();
    // A page load: this tab's baselines are gone; the outbox kept the writes.
    Object.keys(_baselineUndo).forEach(id => delete _baselineUndo[id]);
    age(2 * 60 * 60 * 1000);
    await reconnect();
    expect(reads).toHaveLength(0);
    expect(sentry.captureMessage.mock.calls).toEqual([
      ['Overwrite count: 0 of 0 waiting cells changed on the server, 3 not measured (waited 1-24 h)', 'warning'],
    ]);
  });

  [
    ['clear_score', { p_enrollment_id: ENR2, p_assessment_id: AID }],
    ['set_rubric_check', { p_enrollment_id: ENR2, p_assessment_id: AID, p_check_id: TAG1, p_on: true }],
    ['save_score_report_note', { p_enrollment_id: ENR2, p_assessment_id: AID, p_note: 'Steps.' }],
    // upsert_score on work scored by competency: the cache keeps no score.value.
    ['upsert_score', { p_enrollment_id: ENR2, p_assessment_id: AID, p_value: 3, p_modifier: 0 }],
  ].forEach(([endpoint, payload]) => {
    it('counts a waiting ' + endpoint + ' as not measured', async () => {
      offline();
      upsertScore(CID, ENR1, AID, TAG1, 3, '2026-11-13', 'summative', '');
      queueWithBaseline(endpoint, payload);
      age(5 * 60 * 1000);
      await reconnect();
      expect(sentry.captureMessage.mock.calls[0][0]).toBe(
        'Overwrite count: 0 of 1 waiting cells changed on the server, 1 not measured (waited 1-10 min)',
      );
    });
  });

  it('counts a waiting score from another tab as not measured', async () => {
    offline();
    upsertScore(CID, ENR1, AID, TAG1, 3, '2026-11-13', 'summative', '');
    // Queued with no baseline row in this tab.
    window.v2Queue.enqueue(
      'upsert_tag_score',
      { p_enrollment_id: ENR3, p_assessment_id: AID, p_tag_id: TAG1, p_value: 4, p_modifier: 0, p_comment: null },
      { noFlush: true },
    );
    age(5 * 60 * 1000);
    await reconnect();
    expect(sentry.captureMessage.mock.calls[0][0]).toBe(
      'Overwrite count: 0 of 1 waiting cells changed on the server, 1 not measured (waited 1-10 min)',
    );
  });

  it('counts a cell with a rejected write in the failed list as not measured', async () => {
    scoreThreeOffline();
    localStorage.setItem(
      'fv-sync-dead-letter-v1',
      JSON.stringify([
        {
          id: 'dead-1',
          owner: 'teacher-uuid',
          endpoint: 'upsert_tag_score',
          payload: { p_enrollment_id: ENR3, p_assessment_id: AID, p_tag_id: TAG1, p_value: 1 },
        },
      ]),
    );
    age(5 * 60 * 1000);
    await reconnect();
    expect(sentry.captureMessage.mock.calls[0][0]).toBe(
      'Overwrite count: 0 of 2 waiting cells changed on the server, 1 not measured (waited 1-10 min)',
    );
  });

  it('takes the bucket from the oldest waiting score, measured or not', async () => {
    offline();
    upsertScore(CID, ENR1, AID, TAG1, 3, '2026-11-13', 'summative', '');
    window.v2Queue.enqueue('clear_score', { p_enrollment_id: ENR2, p_assessment_id: AID }, { noFlush: true });
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY));
    q.entries.forEach(e => {
      const ms = e.endpoint === 'clear_score' ? 30 * 60 * 1000 : 2 * 60 * 1000;
      e.created_at = new Date(Date.now() - ms).toISOString();
    });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    await reconnect();
    expect(sentry.captureMessage.mock.calls[0][0]).toBe(
      'Overwrite count: 0 of 1 waiting cells changed on the server, 1 not measured (waited 10-60 min)',
    );
  });

  it('changes no outbox entry and no baseline row', async () => {
    scoreThreeOffline();
    window.v2Queue.enqueue('clear_score', { p_enrollment_id: ENR2, p_assessment_id: AID }, { noFlush: true });
    age(5 * 60 * 1000);
    const undoBefore = JSON.stringify(_baselineUndo);
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    fake.hold();
    const flushing = window.v2Queue.flush();
    // The outbox has marked what it started; the counter has not run yet.
    const sent = localStorage.getItem(QUEUE_KEY);
    await new Promise(r => setTimeout(r, 5));
    await settle();
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(QUEUE_KEY)).toBe(sent);
    expect(JSON.stringify(_baselineUndo)).toBe(undoBefore);
    await fake.release();
    await flushing;
  });
});

describe('a read that fails', () => {
  const cases = {
    'returns an error': () => Promise.resolve({ data: null, error: { message: 'boom' } }),
    throws: () => Promise.reject(new Error('network')),
    hangs: () => new Promise(() => {}),
    'returns text': () => Promise.resolve({ data: 'nope', error: null }),
    'returns rows without ids': () => Promise.resolve({ data: [{ junk: true }], error: null }),
    'returns nothing': () => Promise.resolve(undefined),
  };
  Object.keys(cases).forEach(name => {
    it('reports nothing and throws nothing when it ' + name, async () => {
      answer = cases[name];
      scoreThreeOffline();
      age(5 * 60 * 1000);
      await reconnect();
      expect(sentry.captureMessage).not.toHaveBeenCalled();
      expect(window.v2Queue.stats().queued).toBe(0);
    });
  });

  it('reports nothing when the read cannot be started', async () => {
    fake.from = () => {
      throw new Error('no from');
    };
    scoreThreeOffline();
    age(5 * 60 * 1000);
    await reconnect();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(window.v2Queue.stats().queued).toBe(0);
  });
});

describe('the outbox sends exactly what it sends without the counter', () => {
  // The same scenario twice from the same start: once with the counter's
  // file not loaded, once with it. A cell changed on the server, so the
  // counter does read and report in the second run.
  async function run(withCounter) {
    window.v2Queue.clear();
    localStorage.removeItem('fv-sync-dead-letter-v1');
    _serverState = {};
    seed('assessments', [{ id: AID, title: 'Unit 1 Lab', date: '2026-11-03', tagIds: [TAG1] }]);
    seed('scores', { [ENR1]: [tagEntry(2)], [ENR3]: [tagEntry(3)] });
    seed('statuses', {});
    fake = makeFakeSupabase();
    installReads();
    globalThis.getSupabase = () => fake;
    sentry.captureMessage.mockClear();
    unloadCounter();
    if (withCounter) loadCounter();
    scoreThreeOffline();
    saveScoreComment(CID, ENR1, AID, 'Clear steps.');
    setAssignmentStatus(CID, ENR2, AID, 'LATE');
    age(20 * 60 * 1000);
    await reconnect();
    // Online again: a normal edit, sent at once.
    upsertScore(CID, ENR2, AID, TAG1, 3, '2026-11-13', 'summative', '');
    await window.v2Queue.flush();
    await settle();
    return {
      calls: JSON.parse(JSON.stringify(fake.calls)),
      reads: reads.length,
      reports: sentry.captureMessage.mock.calls.length,
    };
  }

  it('is identical, call for call', async () => {
    const without = await run(false);
    const withIt = await run(true);
    expect(without.reads).toBe(0);
    expect(withIt.reads).toBeGreaterThan(0);
    expect(withIt.reports).toBe(1);
    expect(withIt.calls.length).toBeGreaterThan(3);
    // Idempotency keys are fresh ids each run; everything else must match.
    const strip = calls =>
      calls.map(c => {
        const params = Object.assign({}, c.params);
        delete params.p_idempotency_key;
        return { name: c.name, params };
      });
    expect(strip(withIt.calls)).toEqual(strip(without.calls));
  });
});
