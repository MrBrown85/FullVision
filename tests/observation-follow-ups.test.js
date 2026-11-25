/**
 * Observation follow-ups (docs/DECISIONS.md, "Observation follow-ups";
 * migrations/2026111703_observation_follow_ups.sql, not applied yet).
 *
 * - The data: a follow-up lives under its observation (followUps), in every
 *   student's copy of it, never as an observation of its own.
 * - The server's rows go under their parent; one whose parent is not loaded
 *   is dropped.
 * - Signed in: the writes, and a follow-up made under an observation still
 *   waiting for its own create (rule 6).
 * - Teacher-only: no report, Comment Bank, export or student page reader
 *   sees one, and only the files below name them.
 * - The pieces on screen and the delete question.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = 'c7000000-0000-4000-8000-000000000001';
const E1 = 'c7000000-0000-4000-8000-000000000011';
const E2 = 'c7000000-0000-4000-8000-000000000012';
const OB = 'c7000000-0000-4000-8000-000000000021';
const OB2 = 'c7000000-0000-4000-8000-000000000022';
const FU1 = 'c7000000-0000-4000-8000-000000000031';
const FU2 = 'c7000000-0000-4000-8000-000000000032';

function seed(field, value) {
  _cache[field][CID] = value;
  localStorage.setItem('gb-' + _DATA_KEYS[field] + '-' + CID, JSON.stringify(value));
}

function students() {
  return [
    { id: E1, firstName: 'Ana', lastName: 'Ames', designations: [], sortName: 'Ames Ana' },
    { id: E2, firstName: 'Ben', lastName: 'Burr', designations: [], sortName: 'Burr Ben' },
  ];
}

function ob(id, extra) {
  return Object.assign(
    {
      id: id,
      text: 'Left the lab early',
      dims: [],
      sentiment: 'concern',
      created: '2026-11-02T18:00:00Z',
      date: '2026-11-02',
    },
    extra || {},
  );
}

function reset() {
  localStorage.clear();
  Object.keys(_cache).forEach(function (field) {
    if (_cache[field] && typeof _cache[field] === 'object' && field !== 'courses' && field !== 'config') {
      _cache[field] = {};
    }
  });
  _idRekeys = {};
}

describe('follow-ups in the data layer', () => {
  beforeEach(() => {
    reset();
    seed('students', students());
    // One observation for two students: a copy under each.
    seed('observations', { [E1]: [ob(OB)], [E2]: [ob(OB)] });
  });

  it('adds a follow-up under every copy of its observation, oldest first', () => {
    var a = addObservationFollowUp(CID, OB, 'called_home', '  Spoke with mom.  ');
    var b = addObservationFollowUp(CID, OB, null, 'Still drifting on Fridays.');
    expect(a.kind).toBe('called_home');
    expect(a.text).toBe('Spoke with mom.');
    expect(b.kind).toBe(null);
    var all = getQuickObs(CID);
    [E1, E2].forEach(sid => {
      expect(all[sid][0].followUps.map(f => f.id)).toEqual([a.id, b.id]);
    });
    expect(getObservationFollowUps(CID, OB).map(f => f.text)).toEqual([
      'Spoke with mom.',
      'Still drifting on Fridays.',
    ]);
    // Kept on the device.
    expect(JSON.parse(localStorage.getItem('gb-quick-obs-' + CID))[E2][0].followUps).toHaveLength(2);
  });

  it('needs a kind or words, and takes only the four kinds', () => {
    expect(addObservationFollowUp(CID, OB, null, '   ')).toBe(null);
    expect(addObservationFollowUp(CID, 'nope', 'resolved', '')).toBe(null);
    expect(addObservationFollowUp(CID, OB, 'emailed_home', '')).toBe(null);
    expect(addObservationFollowUp(CID, OB, 'emailed_home', 'Sent a note').kind).toBe(null);
    expect(Object.keys(OBS_FOLLOW_UP_KINDS)).toEqual([
      'called_home',
      'spoke_with_student',
      'still_happening',
      'resolved',
    ]);
    expect(Object.values(OBS_FOLLOW_UP_KINDS).map(k => k.label)).toEqual([
      'Called Home',
      'Spoke With Student',
      'Still Happening',
      'Resolved',
    ]);
  });

  it('changes and deletes one follow-up on its own', () => {
    var a = addObservationFollowUp(CID, OB, 'called_home', 'Spoke with mom.');
    var b = addObservationFollowUp(CID, OB, 'still_happening', '');
    expect(updateObservationFollowUp(CID, OB, a.id, 'spoke_with_student', 'Spoke with Ana.')).toBe(true);
    expect(getObservationFollowUps(CID, OB)[0]).toMatchObject({ kind: 'spoke_with_student', text: 'Spoke with Ana.' });
    expect(updateObservationFollowUp(CID, OB, a.id, null, '')).toBe(false);
    expect(deleteObservationFollowUp(CID, OB, a.id)).toBe(true);
    expect(getObservationFollowUps(CID, OB).map(f => f.id)).toEqual([b.id]);
    deleteObservationFollowUp(CID, OB, b.id);
    expect(getQuickObs(CID)[E1][0].followUps).toBeUndefined();
  });

  it('is never an observation of its own', () => {
    addObservationFollowUp(CID, OB, 'called_home', 'FOLLOW-UP WORDS');
    var flat = getAllQuickObs(CID);
    expect(flat).toHaveLength(2);
    expect(flat.every(o => o.text === 'Left the lab early')).toBe(true);
    expect(getStudentQuickObs(CID, E1)).toHaveLength(1);
  });

  it('a Concern with a Resolved follow-up is closed; the open ones are counted once', () => {
    seed('observations', {
      [E1]: [ob(OB), ob(OB2, { sentiment: 'strength' })],
      [E2]: [ob(OB)],
    });
    expect(getOpenConcerns(CID).map(o => o.id)).toEqual([OB]);
    addObservationFollowUp(CID, OB, 'still_happening', '');
    expect(isOpenConcern(getStudentQuickObs(CID, E1)[0])).toBe(true);
    addObservationFollowUp(CID, OB, 'resolved', '');
    expect(isObservationResolved(getStudentQuickObs(CID, E2)[0])).toBe(true);
    expect(getOpenConcerns(CID)).toEqual([]);
  });

  it('deleting the observation takes its follow-ups with it', () => {
    addObservationFollowUp(CID, OB, 'called_home', '');
    deleteQuickOb(CID, E1, OB);
    deleteQuickOb(CID, E2, OB);
    expect(getObservationFollowUps(CID, OB)).toEqual([]);
  });
});

describe("the server's follow-ups", () => {
  beforeEach(() => {
    reset();
    seed('students', students());
  });

  function row(id, eids, extra) {
    return Object.assign(
      { id: id, body: 'Concern', sentiment: 'concern', created_at: '2026-11-02T18:00:00Z', enrollment_ids: eids },
      extra || {},
    );
  }

  it('go under their observation in every copy, oldest first, never as observations', () => {
    var blob = _observationsPayloadToBlob(
      {
        observations: [row(OB, [E1, E2]), row(OB2, [E1], { sentiment: 'strength' })],
        follow_ups: [
          { id: FU2, follow_up_of: OB, kind: 'resolved', body: 'Done', created_at: '2026-11-09T18:00:00Z' },
          { id: FU1, follow_up_of: OB, kind: 'called_home', body: 'Called', created_at: '2026-11-03T18:00:00Z' },
          { id: 'c7000000-0000-4000-8000-000000000039', follow_up_of: 'not-loaded', kind: null, body: 'x' },
        ],
      },
      CID,
    );
    expect(blob[E1].map(o => o.id)).toEqual([OB, OB2]);
    expect(blob[E1][0].followUps.map(f => [f.id, f.kind, f.text])).toEqual([
      [FU1, 'called_home', 'Called'],
      [FU2, 'resolved', 'Done'],
    ]);
    expect(blob[E2][0].followUps).toHaveLength(2);
    // Each copy has its own list.
    expect(blob[E2][0].followUps).not.toBe(blob[E1][0].followUps);
    expect(blob[E1][1].followUps).toBeUndefined();
  });

  it('a row with no students (a follow-up an old reader returned) makes no observation', () => {
    var blob = _observationsPayloadToBlob({ observations: [row(FU1, [])] }, CID);
    expect(blob).toEqual({});
  });
});

describe('follow-ups for a signed-in teacher', () => {
  var fake;
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    reset();
    fake = makeFakeSupabase();
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-uuid';
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.v2Queue.clear();
    seed('students', students());
    seed('observations', { [E1]: [ob(OB)] });
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    window.v2Queue.clear();
  });

  it('sends create_observation_follow_up with the parent, kind and words, then takes the server id', async () => {
    var f = addObservationFollowUp(CID, OB, 'resolved', 'Met with family');
    await settle();
    var sent = fake.committed.filter(c => c.name === 'create_observation_follow_up');
    expect(sent).toHaveLength(1);
    expect(sent[0].params).toMatchObject({ p_follow_up_of: OB, p_body: 'Met with family', p_kind: 'resolved' });
    // The time it was saved here, so one sent later keeps its day.
    expect(sent[0].params.p_created_at).toBe(f.created);
    expect(_isUuid(sent[0].params.p_idempotency_key)).toBe(true);
    var now = getObservationFollowUps(CID, OB)[0];
    expect(_isUuid(now.id)).toBe(true);
    expect(now.id).not.toBe(f.id);
  });

  it('a follow-up made before its observation has a server id waits for it, then names it', async () => {
    fake.hold();
    addQuickOb(CID, E1, 'Wandered during the lab', [], 'concern');
    var local = getStudentQuickObs(CID, E1).find(o => o.text === 'Wandered during the lab');
    expect(_isUuid(local.id)).toBe(false);
    var f = addObservationFollowUp(CID, local.id, 'called_home', 'Called dad');
    // Edited and changed again before anything landed.
    updateObservationFollowUp(CID, local.id, f.id, 'still_happening', 'Called dad twice');
    expect(fake.calls.filter(c => c.name === 'create_observation_follow_up')).toHaveLength(0);

    await fake.release();
    await settle();
    await fake.release();
    await settle();
    await fake.release();
    await settle();

    var parent = getStudentQuickObs(CID, E1).find(o => o.text === 'Wandered during the lab');
    expect(_isUuid(parent.id)).toBe(true);
    var created = fake.committed.filter(c => c.name === 'create_observation_follow_up');
    expect(created).toHaveLength(1);
    expect(created[0].params.p_follow_up_of).toBe(parent.id);
    var fu = parent.followUps[0];
    expect(_isUuid(fu.id)).toBe(true);
    var updated = fake.committed.filter(c => c.name === 'update_observation_follow_up');
    expect(updated.length).toBeGreaterThan(0);
    expect(updated[updated.length - 1].params).toMatchObject({
      p_id: fu.id,
      p_kind: 'still_happening',
      p_body: 'Called dad twice',
    });
    // No local id ever reached the server.
    fake.committed.forEach(c => {
      ['p_id', 'p_follow_up_of'].forEach(k => {
        if (c.params[k] != null) expect(_isUuid(c.params[k]), c.name + ' ' + k).toBe(true);
      });
    });
  });

  it('deleting a follow-up is delete_observation on its id', async () => {
    seed('observations', {
      [E1]: [ob(OB, { followUps: [{ id: FU1, kind: 'resolved', text: '', created: '2026-11-03T00:00:00Z' }] })],
    });
    deleteObservationFollowUp(CID, OB, FU1);
    await settle();
    expect(fake.committed.filter(c => c.name === 'delete_observation').map(c => c.params.p_id)).toEqual([FU1]);
  });

  it("a follow-up queues behind its observation's own writes, under its server id once it has one", async () => {
    var answer;
    fake.on('create_observation_follow_up', () => new Promise(r => (answer = r)));
    fake.hold();
    addQuickOb(CID, E1, 'Late to the lab', [], 'concern');
    var local = getStudentQuickObs(CID, E1).find(o => o.text === 'Late to the lab');
    addObservationFollowUp(CID, local.id, 'called_home', '');
    var key = () =>
      JSON.parse(localStorage.getItem('fv-sync-queue-v1')).entries.find(
        e => e.endpoint === 'create_observation_follow_up',
      ).key;
    await settle();
    expect(key()).toBe('id:' + local.id);
    await fake.release();
    await settle();
    var parent = getStudentQuickObs(CID, E1).find(o => o.text === 'Late to the lab');
    expect(_isUuid(parent.id)).toBe(true);
    // Sent, under the observation's server id, and not yet answered.
    expect(key()).toBe('id:' + parent.id);
    answer({ data: 'c7000000-0000-4000-8000-000000000041', error: null });
    await settle();
  });

  it('a change to a follow-up deleted meanwhile is settled, not a dead letter', async () => {
    fake.on('update_observation_follow_up', () => ({
      data: null,
      error: { code: 'P0002', message: 'follow-up not found' },
    }));
    var res = await window.v2Queue.push('update_observation_follow_up', { p_id: FU1, p_body: 'x', p_kind: null });
    expect(res.error).toBeNull();
    expect(window.v2Queue.stats()).toMatchObject({ queued: 0, deadLettered: 0 });
  });

  it('both new writes are idempotent', () => {
    expect(FV_IDEMPOTENT_RPCS.create_observation_follow_up).toBe(true);
    expect(FV_IDEMPOTENT_RPCS.update_observation_follow_up).toBe(true);
  });
});

describe('teacher-only: no report, Comment Bank, export or student page reader sees a follow-up', () => {
  beforeEach(() => {
    reset();
    seed('students', students());
    seed('observations', {
      [E1]: [ob(OB, { sentiment: 'strength', text: 'Helped a classmate' })],
    });
    addObservationFollowUp(CID, OB, 'spoke_with_student', 'FOLLOW-UP WORDS');
  });

  it('report blocks, Feedback Pages and the card readers leave them out', () => {
    var st = students()[0];
    expect(ReportBlocks.renderBlockObservations(CID, st)).toContain('Helped a classmate');
    expect(ReportBlocks.renderBlockObservations(CID, st)).not.toContain('FOLLOW-UP WORDS');
    expect(JSON.stringify(ReportFeedback.observations(CID, st, null))).not.toContain('FOLLOW-UP WORDS');
    var ctx = ObsCard.context(CID);
    var card = Object.assign({ studentId: E1 }, getStudentQuickObs(CID, E1)[0]);
    // Every list but the Observations page's log draws the card without them.
    expect(ObsCard.html(card, ctx)).not.toContain('FOLLOW-UP WORDS');
    expect(ObsCard.html(card, ctx, { followUps: true })).toContain('1 follow-up');
  });

  it('only these files name follow-ups; anything new that does is a decision to make here', () => {
    var named = [];
    function walk(dir) {
      readdirSync(dir).forEach(name => {
        var p = join(dir, name);
        if (statSync(p).isDirectory()) return walk(p);
        if (!/\.js$/.test(name)) return;
        if (
          /followUps|follow_ups|follow_up_of|ObsFollowUps|getObservationFollowUps|getOpenConcerns|isOpenConcern/.test(
            readFileSync(p, 'utf-8'),
          )
        )
          named.push(relative(root, p));
      });
    }
    ['shared', 'teacher', 'teacher-mobile', 's', 'supabase'].forEach(d => walk(join(root, d)));
    expect(named.sort()).toEqual([
      'shared/backup-restore.js', // the class backup keeps them, and a restore puts them back
      'shared/data-observations.js',
      'shared/data.js', // re-keying a follow-up's id
      'shared/obs-card.js', // the log's strip, only with opts.followUps
      'shared/obs-follow-ups.js',
      'shared/offline-queue.js', // a follow-up queues behind its observation; a change to a deleted one is done
      'shared/seed-data.js',
      'teacher-mobile/shell.js', // the delete question
      'teacher-mobile/tab-observe.js',
      'teacher/obs-roster.js', // the Open Concerns count
      'teacher/page-assignments.js', // the delete question
      'teacher/page-observations.js',
      'teacher/student-evidence.js', // the delete question
    ]);
  });
});

describe('the pieces on screen', () => {
  beforeEach(() => {
    reset();
    seed('students', students());
    seed('observations', { [E1]: [ob(OB)] });
  });

  it('"2 follow-ups · last Nov 15" names how many and the last date', () => {
    var now = new Date('2026-11-17T12:00:00');
    expect(ObsFollowUps.summaryText([], now)).toBe('');
    expect(ObsFollowUps.summaryText([{ date: '2026-11-15' }], now)).toBe('1 follow-up · last Nov 15');
    expect(ObsFollowUps.summaryText([{ date: '2026-11-03' }, { date: '2026-11-15' }], now)).toBe(
      '2 follow-ups · last Nov 15',
    );
    expect(ObsFollowUps.shortDate({ date: '2025-11-15' }, now)).toBe('Nov 15, 2025');
  });

  it("a card's strip: + Follow Up always; the count, the timeline when open, Resolved on a closed concern", () => {
    var card = Object.assign({ studentId: E1 }, getStudentQuickObs(CID, E1)[0]);
    var html = ObsFollowUps.cardHtml(CID, card);
    expect(html).toContain('+ Follow Up');
    expect(html).not.toContain('obs-fu-toggle');
    addObservationFollowUp(CID, OB, 'called_home', '<b>not bold</b>');
    addObservationFollowUp(CID, OB, 'resolved', '');
    card = Object.assign({ studentId: E1 }, getStudentQuickObs(CID, E1)[0]);
    html = ObsFollowUps.cardHtml(CID, card);
    expect(html).toMatch(/aria-expanded="false"[^>]*>.*2 follow-ups · last/);
    expect(html).toContain('obs-fu-closed');
    expect(html).not.toContain('obs-fu-list');
    ObsFollowUps.reveal(OB);
    html = ObsFollowUps.cardHtml(CID, card);
    expect(html).toContain('obs-fu-list');
    expect(html).toContain('Called Home');
    expect(html).toContain('&lt;b&gt;not bold&lt;/b&gt;');
    expect(html).not.toContain('<b>not bold</b>');
  });

  it("the edit window's panel lists them, or says none yet", () => {
    var card = Object.assign({ studentId: E1 }, getStudentQuickObs(CID, E1)[0]);
    expect(ObsFollowUps.panelHtml(CID, card)).toContain('None yet.');
    addObservationFollowUp(CID, OB, 'spoke_with_student', 'Talked at lunch');
    var html = ObsFollowUps.panelHtml(CID, card);
    expect(html).toContain('Follow-Ups');
    expect(html).toContain('Spoke With Student');
    expect(html).toContain('Talked at lunch');
  });

  it('deleting an observation with follow-ups asks first, saying how many', () => {
    var proceed = vi.fn();
    var asked = vi.fn();
    var original = globalThis.showConfirm;
    globalThis.showConfirm = asked;
    try {
      ObsFollowUps.confirmDelete(CID, OB, proceed);
      expect(proceed).toHaveBeenCalledTimes(1);
      expect(asked).not.toHaveBeenCalled();
      addObservationFollowUp(CID, OB, 'called_home', '');
      addObservationFollowUp(CID, OB, 'resolved', '');
      ObsFollowUps.confirmDelete(CID, OB, proceed);
      expect(asked).toHaveBeenCalledTimes(1);
      expect(asked.mock.calls[0][0]).toBe('Delete this observation and its 2 follow-ups?');
      expect(proceed).toHaveBeenCalledTimes(1);
      asked.mock.calls[0][4]();
      expect(proceed).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.showConfirm = original;
    }
  });

  it("the Observations page's open concerns: a Concern stays open until a Resolved follow-up", () => {
    expect(getOpenConcerns(CID).map(o => o.id)).toEqual([OB]);
    addObservationFollowUp(CID, OB, 'called_home', '');
    expect(getOpenConcerns(CID)).toHaveLength(1);
    addObservationFollowUp(CID, OB, 'resolved', '');
    expect(getOpenConcerns(CID)).toHaveLength(0);
  });
});

describe("Demo Mode's sample class", () => {
  it('has a concern with two follow-ups, still open', () => {
    var src = readFileSync(resolve(root, 'shared/seed-data.js'), 'utf-8');
    var at = src.indexOf("text: 'Needed a few reminders to stay on task during independent work time.'");
    expect(at).toBeGreaterThan(0);
    var fu = src.indexOf('followUps: [', at);
    expect(src.slice(at, fu)).toContain("sentiment: 'concern'");
    var block = src.slice(fu, src.indexOf('\n          ],', fu));
    expect((block.match(/kind: '/g) || []).length).toBe(2);
    expect(block).not.toContain("kind: 'resolved'");
  });
});
