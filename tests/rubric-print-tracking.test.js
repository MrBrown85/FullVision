/**
 * Printed rubrics (migrations/20261102_rubric_print.sql): the prints in the
 * data layer (getRubricPrint / setRubricPrints and their set_rubric_printed
 * write, the bundle's print_rows), and in teacher/rubric-print.js the
 * fingerprint, each student's print state, Not Yet Printed / Changed Since
 * Printed, marking a print job and the marker beside a name.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';
const SID2 = '44444444-4444-4444-8444-444444444444';
const SID3 = '45454545-4545-4545-8545-454545454545';
const RUBRIC = '55555555-5555-4555-8555-555555555555';
const CRIT_A = '66666666-6666-4666-8666-666666666666';
const CRIT_B = '77777777-7777-4777-8777-777777777777';

function entry(sid, tagId, score) {
  return {
    id: sid + ':' + tagId,
    assessmentId: AID,
    tagId: tagId,
    score: score,
    date: '2026-10-03',
    type: 'summative',
    note: '',
  };
}

function seedClass() {
  saveStudents(CID, [
    { id: SID, firstName: 'Ada', lastName: 'Lovelace' },
    { id: SID2, firstName: 'Alan', lastName: 'Turing' },
    { id: SID3, firstName: 'Grace', lastName: 'Hopper' },
  ]);
  saveRubrics(CID, [
    {
      id: RUBRIC,
      name: 'Lab rubric',
      criteria: [
        { id: CRIT_A, name: 'Inquiry', tagIds: [], levels: { 4: 'a', 3: 'b', 2: 'c', 1: 'd' } },
        { id: CRIT_B, name: 'Communication', tagIds: [], levels: { 4: 'a', 3: 'b', 2: 'c', 1: 'd' } },
      ],
    },
  ]);
  saveAssessments(CID, [
    { id: AID, title: 'Cell lab', date: '2026-10-03', type: 'summative', tagIds: [], rubricId: RUBRIC },
  ]);
  // Ada and Alan are scored; Grace is not.
  saveScores(CID, {
    [SID]: [entry(SID, CRIT_A, 3), entry(SID, CRIT_B, 2)],
    [SID2]: [entry(SID2, CRIT_A, 4), entry(SID2, CRIT_B, 4)],
  });
}

function makeRecordingClient() {
  var calls = [];
  return {
    calls: calls,
    rpc(name, payload) {
      calls.push({ name: name, payload: payload || {} });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  ['scores', 'assessments', 'rubrics', 'students', 'rubricPrints'].forEach(function (field) {
    if (_cache[field]) delete _cache[field][CID];
  });
  seedClass();
});

describe('fingerprint and print state', () => {
  it('is the same for the same sheet and different after a level changes', () => {
    var before = RubricPrint.fingerprint(CID, AID, SID);
    expect(before).toMatch(/^[0-9a-f]{14}$/);
    expect(RubricPrint.fingerprint(CID, AID, SID)).toBe(before);
    expect(RubricPrint.fingerprint(CID, AID, SID2)).not.toBe(before);
    var scores = getScores(CID);
    scores[SID][1].score = 3;
    saveScores(CID, scores);
    expect(RubricPrint.fingerprint(CID, AID, SID)).not.toBe(before);
  });

  it('changes when a criterion comment is added', () => {
    var before = RubricPrint.fingerprint(CID, AID, SID);
    var scores = getScores(CID);
    scores[SID][0].critNote = 'Good fair test.';
    saveScores(CID, scores);
    expect(RubricPrint.fingerprint(CID, AID, SID)).not.toBe(before);
  });

  it('is empty for an unscored student', () => {
    expect(RubricPrint.fingerprint(CID, AID, SID3)).toBe('');
  });

  it('reads unscored, unprinted, printed and changed', () => {
    expect(RubricPrint.printState(CID, AID, SID3).kind).toBe('unscored');
    expect(RubricPrint.printState(CID, AID, SID).kind).toBe('unprinted');
    expect(RubricPrint.hasPrints(CID, AID)).toBe(false);

    RubricPrint.markPrinted(CID, AID, [SID, SID2, SID3]);
    expect(RubricPrint.hasPrints(CID, AID)).toBe(true);
    expect(RubricPrint.printState(CID, AID, SID).kind).toBe('printed');
    // Nothing to print for Grace, so nothing was recorded.
    expect(getRubricPrint(CID, SID3, AID)).toBeNull();

    var scores = getScores(CID);
    scores[SID][0].score = 4;
    saveScores(CID, scores);
    expect(RubricPrint.printState(CID, AID, SID).kind).toBe('changed');
    expect(RubricPrint.printState(CID, AID, SID2).kind).toBe('printed');
  });
});

describe('Not Yet Printed and Changed Since Printed', () => {
  it('select the unprinted and the changed scored students', () => {
    RubricPrint.markPrinted(CID, AID, [SID]);
    var ids = function (list) {
      return list.map(function (s) {
        return s.id;
      });
    };
    expect(ids(RubricPrint.selectStudents(CID, AID, { students: 'unprinted' }))).toEqual([SID2]);
    expect(ids(RubricPrint.selectStudents(CID, AID, { students: 'changed' }))).toEqual([]);
    var scores = getScores(CID);
    scores[SID][0].score = 1;
    saveScores(CID, scores);
    expect(ids(RubricPrint.selectStudents(CID, AID, { students: 'changed' }))).toEqual([SID]);
  });

  it('markPrinted returns what Undo puts back', () => {
    RubricPrint.markPrinted(CID, AID, [SID]);
    var first = getRubricPrint(CID, SID, AID);
    var before = RubricPrint.markPrinted(CID, AID, [SID, SID2]);
    expect(before).toEqual([
      { sid: SID, hash: first.hash, at: first.at },
      { sid: SID2, hash: null },
    ]);
    setRubricPrints(CID, AID, before);
    expect(getRubricPrint(CID, SID, AID)).toEqual(first);
    expect(getRubricPrint(CID, SID2, AID)).toBeNull();
  });

  it('Mark Not Printed clears one student', () => {
    RubricPrint.markPrinted(CID, AID, [SID, SID2]);
    RubricPrint.unmarkPrinted(CID, AID, SID);
    expect(RubricPrint.printState(CID, AID, SID).kind).toBe('unprinted');
    expect(RubricPrint.printState(CID, AID, SID2).kind).toBe('printed');
  });
});

describe('the marker beside a name', () => {
  it('is hidden and empty before a print', () => {
    var html = RubricPrint.markHtml(CID, AID, SID);
    expect(html).toContain(' hidden');
    expect(html).not.toContain('Printed');
  });

  it('says Printed with the date, then Changed Since Printed', () => {
    setRubricPrints(CID, AID, [{ sid: SID, hash: RubricPrint.fingerprint(CID, AID, SID), at: '2026-10-30T18:00:00Z' }]);
    var html = RubricPrint.markHtml(CID, AID, SID);
    expect(html).not.toContain(' hidden');
    expect(html).toContain('Printed Oct 30');
    expect(html).not.toContain('is-changed');
    var scores = getScores(CID);
    scores[SID][0].score = 1;
    saveScores(CID, scores);
    html = RubricPrint.markHtml(CID, AID, SID);
    expect(html).toContain('Changed Since Printed');
    expect(html).toContain('rp-mark is-changed');
  });
});

describe('prints in the data layer', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    client = makeRecordingClient();
    globalThis.getSupabase = () => client;
    _useSupabase = true;
  });
  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  function rpcCalls() {
    return client.calls.filter(function (c) {
      return c.name === 'set_rubric_printed';
    });
  }

  it('keeps prints in the cache and localStorage', () => {
    setRubricPrints(CID, AID, [{ sid: SID, hash: 'abc', at: '2026-10-30T18:00:00.000Z' }]);
    expect(getRubricPrint(CID, SID, AID)).toEqual({ at: '2026-10-30T18:00:00.000Z', hash: 'abc' });
    expect(JSON.parse(localStorage.getItem('gb-rubric-prints-' + CID))).toEqual({
      [SID + ':' + AID]: { at: '2026-10-30T18:00:00.000Z', hash: 'abc' },
    });
  });

  it('writes set_rubric_printed for a print and for a clear, and nothing for a repeat', async () => {
    var at = '2026-10-30T18:00:00.000Z';
    setRubricPrints(CID, AID, [{ sid: SID, hash: 'abc', at: at }]);
    setRubricPrints(CID, AID, [{ sid: SID, hash: 'abc', at: at }]); // the same
    setRubricPrints(CID, AID, [{ sid: SID, hash: null }]);
    setRubricPrints(CID, AID, [{ sid: SID2, hash: null }]); // nothing to clear
    await Promise.resolve();
    var calls = rpcCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].payload).toMatchObject({
      p_enrollment_id: SID,
      p_assessment_id: AID,
      p_hash: 'abc',
      p_printed_at: at,
    });
    expect(calls[1].payload).toMatchObject({
      p_enrollment_id: SID,
      p_assessment_id: AID,
      p_hash: null,
      p_printed_at: null,
    });
    // Every write RPC is idempotent by key (CLAUDE.md rule 7).
    expect(FV_IDEMPOTENT_RPCS.set_rubric_printed).toBe(true);
  });

  it('sends nothing in Demo Mode', () => {
    localStorage.setItem('gb-demo-mode', '1');
    setRubricPrints(CID, AID, [{ sid: SID, hash: 'abc' }]);
    expect(getRubricPrint(CID, SID, AID)).not.toBeNull();
    expect(rpcCalls()).toHaveLength(0);
  });

  it('is echo-safe: a print landing does not reload the class', () => {
    expect(_ECHO_SAFE_RPCS.set_rubric_printed).toBe(true);
  });

  it('rebuilds { sid:aid → { at, hash } } from the bundle print_rows', () => {
    var gb = {
      students: [{ enrollment_id: SID }, { enrollment_id: SID2 }],
      assessments: [{ id: AID }],
      print_rows: [
        [1, 0, '2026-10-30T18:00:00+00:00', 'def'],
        [0, 0, '2026-10-29T18:00:00+00:00', 'abc'],
        [0, 3, '2026-10-29T18:00:00+00:00', 'zzz'], // an assessment not in the list is skipped
      ],
    };
    expect(_bundleRubricPrints(gb)).toEqual({
      [SID + ':' + AID]: { at: '2026-10-29T18:00:00+00:00', hash: 'abc' },
      [SID2 + ':' + AID]: { at: '2026-10-30T18:00:00+00:00', hash: 'def' },
    });
    // A bundle from before print_rows has none.
    expect(_bundleRubricPrints({ students: [], assessments: [] })).toEqual({});
  });
});
