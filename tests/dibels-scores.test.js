/**
 * DIBELS 8 benchmark scores in the data layer (grader plan PR 18,
 * migrations/20261027_dibels_scores.sql): one window's four raw numbers per
 * student and assessment, saved locally and sent as upsert_dibels_score,
 * loaded from list_course_dibels.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';

describe('DIBELS scores', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    localStorage.clear();
    delete _cache.dibels[CID];
    saveAssessments(CID, [{ id: AID, title: 'DIBELS Fall', date: '2026-10-03', scoreMode: 'dibels', tagIds: [] }]);
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    _teacherId = 'teacher-uuid';
    client = {
      calls: [],
      rows: [],
      rpc(name, payload) {
        client.calls.push({ name: name, payload: payload || {} });
        if (name === 'list_course_dibels') return Promise.resolve({ data: client.rows, error: null });
        return Promise.resolve({ data: null, error: null });
      },
    };
    globalThis.getSupabase = () => client;
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  const upserts = () => client.calls.filter(c => c.name === 'upsert_dibels_score');

  it('knows a DIBELS assessment', () => {
    expect(isDibelsScored({ scoreMode: 'dibels' })).toBe(true);
    expect(isDibelsScored({ score_mode: 'dibels' })).toBe(true);
    expect(isDibelsScored({ scoreMode: 'points' })).toBe(false);
  });

  it('saves one window and sends all four numbers, blanks as null', () => {
    saveDibelsScore(CID, SID, AID, 'boy', { orfWrc: '128', orfErrors: 3, mazeCorrect: '', mazeIncorrect: null });
    expect(getDibelsScore(CID, SID, AID, 'boy')).toEqual({
      orfWrc: 128,
      orfErrors: 3,
      mazeCorrect: null,
      mazeIncorrect: null,
    });
    expect(getDibelsScore(CID, SID, AID, 'moy')).toBeNull();
    expect(upserts()).toHaveLength(1);
    expect(upserts()[0].payload).toEqual({
      p_enrollment_id: SID,
      p_assessment_id: AID,
      p_period: 'boy',
      p_orf_wrc: 128,
      p_orf_errors: 3,
      p_maze_correct: null,
      p_maze_incorrect: null,
    });
  });

  it('sends nothing when nothing changed, and clears a window saved all blank', () => {
    saveDibelsScore(CID, SID, AID, 'boy', { orfWrc: 128 });
    saveDibelsScore(CID, SID, AID, 'boy', { orfWrc: '128' });
    expect(upserts()).toHaveLength(1);
    saveDibelsScore(CID, SID, AID, 'boy', {});
    expect(getDibelsScore(CID, SID, AID, 'boy')).toBeNull();
    expect(upserts()).toHaveLength(2);
    expect(upserts()[1].payload.p_orf_wrc).toBeNull();
  });

  it('ignores a negative or unknown number and an unknown window', () => {
    saveDibelsScore(CID, SID, AID, 'boy', { orfWrc: -4, orfErrors: 'abc', mazeCorrect: 12.7 });
    expect(getDibelsScore(CID, SID, AID, 'boy')).toEqual({
      orfWrc: null,
      orfErrors: null,
      mazeCorrect: 12,
      mazeIncorrect: null,
    });
    expect(saveDibelsScore(CID, SID, AID, 'summer', { orfWrc: 10 })).toBe(false);
  });

  it('loads the class’s rows from list_course_dibels', async () => {
    client.rows = [
      {
        enrollment_id: SID,
        assessment_id: AID,
        period: 'moy',
        orf_wrc: 141,
        orf_errors: 2,
        maze_correct: 21,
        maze_incorrect: 1,
      },
    ];
    expect(await loadDibelsScores(CID)).toBe(true);
    expect(getDibelsScore(CID, SID, AID, 'moy')).toEqual({
      orfWrc: 141,
      orfErrors: 2,
      mazeCorrect: 21,
      mazeIncorrect: 1,
    });
    expect(await loadDibelsScores(CID)).toBe(false);
  });
});
