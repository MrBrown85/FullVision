/**
 * v2 scoring-dispatch tests — shared/data.js
 *
 * Covers the write path from HANDOFF 3.5 + 4.3:
 *   _persistScoreToCanonical → upsert_tag_score / upsert_rubric_score / save_score_comment
 *   persistScoreDiffToCanonical → per-row upsert/zero dispatch after bulk local restores
 *   window.upsertCellScore   → upsert_score
 *   window.setCellStatus     → set_score_status
 *   window.fillRubric        → fill_rubric
 *   window.clearScore        → clear_score
 *   window.clearRowScores    → clear_row_scores
 *   window.clearColumnScores → clear_column_scores
 *
 * The rubric-vs-tag dispatch reads _cache.v2Gradebook[cid].assessments[aid].has_rubric.
 * Non-UUID student / assessment IDs are rejected at the guard (no RPC emitted).
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const ENR = '22222222-2222-2222-2222-222222222222';
const AID_TAG = '33333333-3333-3333-3333-333333333333';
const AID_RUBRIC = '44444444-4444-4444-4444-444444444444';
const TAG_ID = '55555555-5555-5555-5555-555555555555';
const CRIT_ID = '66666666-6666-4666-8666-666666666666';
const TAG_ID_2 = '77777777-7777-4777-8777-777777777777';

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

describe('v2 scoring-dispatch', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    _teacherId = 'teacher-uuid';
    localStorage.clear();

    client = makeRecordingClient();
    globalThis.getSupabase = () => client;

    // Seed the v2Gradebook cache so has_rubric lookup works
    _cache.v2Gradebook = _cache.v2Gradebook || {};
    _cache.v2Gradebook[CID] = {
      assessments: [
        { id: AID_TAG, has_rubric: false },
        { id: AID_RUBRIC, has_rubric: true },
      ],
    };
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    delete _cache.v2Gradebook[CID];
  });

  describe('_persistScoreToCanonical', () => {
    it('dispatches to upsert_tag_score for a non-rubric assessment', () => {
      _persistScoreToCanonical(CID, ENR, AID_TAG, TAG_ID, 3, '');
      var call = client.calls.find(function (c) {
        return c.name === 'upsert_tag_score';
      });
      expect(call).toBeDefined();
      expect(call.payload).toEqual({
        p_enrollment_id: ENR,
        p_assessment_id: AID_TAG,
        p_tag_id: TAG_ID,
        p_value: 3,
      });
    });

    it('dispatches to upsert_rubric_score when assessment.has_rubric is true', () => {
      _persistScoreToCanonical(CID, ENR, AID_RUBRIC, CRIT_ID, 4, '');
      var call = client.calls.find(function (c) {
        return c.name === 'upsert_rubric_score';
      });
      expect(call).toBeDefined();
      expect(call.payload).toEqual({
        p_enrollment_id: ENR,
        p_assessment_id: AID_RUBRIC,
        p_criterion_id: CRIT_ID,
        p_value: 4,
      });
      // Must NOT have also called the tag variant
      expect(
        client.calls.find(function (c) {
          return c.name === 'upsert_tag_score';
        }),
      ).toBeUndefined();
    });

    it('dispatches to save_score_comment when note is present', () => {
      _persistScoreToCanonical(CID, ENR, AID_TAG, null, null, 'great effort');
      var call = client.calls.find(function (c) {
        return c.name === 'save_score_comment';
      });
      expect(call).toBeDefined();
      expect(call.payload).toEqual({
        p_enrollment_id: ENR,
        p_assessment_id: AID_TAG,
        p_comment: 'great effort',
      });
    });

    it('can dispatch both tag_score and save_score_comment in one call', () => {
      _persistScoreToCanonical(CID, ENR, AID_TAG, TAG_ID, 3, 'solid');
      var names = client.calls
        .map(function (c) {
          return c.name;
        })
        .sort();
      expect(names).toEqual(['save_score_comment', 'upsert_tag_score']);
    });

    it('skips dispatch when student id is not a UUID', () => {
      _persistScoreToCanonical(CID, 'not-a-uuid', AID_TAG, TAG_ID, 3, '');
      expect(client.calls).toHaveLength(0);
    });

    it('skips dispatch when assessment id is not a UUID', () => {
      _persistScoreToCanonical(CID, ENR, 'not-a-uuid', TAG_ID, 3, '');
      expect(client.calls).toHaveLength(0);
    });

    it('emits no tag/rubric call when tid is absent', () => {
      _persistScoreToCanonical(CID, ENR, AID_TAG, null, 3, '');
      expect(
        client.calls.find(function (c) {
          return c.name === 'upsert_tag_score';
        }),
      ).toBeUndefined();
      expect(
        client.calls.find(function (c) {
          return c.name === 'upsert_rubric_score';
        }),
      ).toBeUndefined();
    });

    it('emits no tag/rubric call when value is null', () => {
      _persistScoreToCanonical(CID, ENR, AID_TAG, TAG_ID, null, '');
      expect(
        client.calls.find(function (c) {
          return c.name === 'upsert_tag_score';
        }),
      ).toBeUndefined();
    });

    it('defaults to tag_score when _cache.v2Gradebook has no entry for the assessment', () => {
      // Server-side will reject if it turns out to be a rubric assessment —
      // that is the intended safety net per the commit message.
      var UNKNOWN = '99999999-9999-4999-8999-999999999999';
      _persistScoreToCanonical(CID, ENR, UNKNOWN, TAG_ID, 3, '');
      var call = client.calls.find(function (c) {
        return c.name === 'upsert_tag_score';
      });
      expect(call).toBeDefined();
    });
  });

  describe('persistScoreDiffToCanonical', () => {
    it('dispatches changed rows and zeroes removed rows after a bulk local restore', () => {
      const prev = {
        [ENR]: [
          { assessmentId: AID_TAG, tagId: TAG_ID, score: 4, note: '' },
          { assessmentId: AID_TAG, tagId: TAG_ID_2, score: 2, note: '' },
        ],
      };
      const next = {
        [ENR]: [{ assessmentId: AID_TAG, tagId: TAG_ID, score: 1, note: '' }],
      };

      persistScoreDiffToCanonical(CID, prev, next);

      const tagCalls = client.calls.filter(function (c) {
        return c.name === 'upsert_tag_score';
      });
      expect(tagCalls).toEqual([
        {
          name: 'upsert_tag_score',
          payload: {
            p_enrollment_id: ENR,
            p_assessment_id: AID_TAG,
            p_tag_id: TAG_ID,
            p_value: 1,
          },
        },
        {
          name: 'upsert_tag_score',
          payload: {
            p_enrollment_id: ENR,
            p_assessment_id: AID_TAG,
            p_tag_id: TAG_ID_2,
            p_value: 0,
          },
        },
      ]);
    });
  });

  describe('window.upsertCellScore', () => {
    it('calls upsert_score with the cell value', async () => {
      await window.upsertCellScore(CID, ENR, AID_TAG, 3);
      var call = client.calls.find(function (c) {
        return c.name === 'upsert_score';
      });
      expect(call).toBeDefined();
      expect(call.payload).toEqual({
        p_enrollment_id: ENR,
        p_assessment_id: AID_TAG,
        p_value: 3,
      });
    });

    it('passes null for empty value (clear cell)', async () => {
      await window.upsertCellScore(CID, ENR, AID_TAG, '');
      var call = client.calls.find(function (c) {
        return c.name === 'upsert_score';
      });
      expect(call.payload.p_value).toBeNull();
    });

    it('skips on non-UUID enrollment', async () => {
      await window.upsertCellScore(CID, 'not-a-uuid', AID_TAG, 3);
      expect(client.calls).toHaveLength(0);
    });
  });

  describe('window.setCellStatus', () => {
    it('calls set_score_status with the status string', async () => {
      await window.setCellStatus(ENR, AID_TAG, 'LATE');
      var call = client.calls.find(function (c) {
        return c.name === 'set_score_status';
      });
      expect(call).toBeDefined();
      expect(call.payload).toEqual({
        p_enrollment_id: ENR,
        p_assessment_id: AID_TAG,
        p_status: 'LATE',
      });
    });

    it('coerces falsy status to null (clear)', async () => {
      await window.setCellStatus(ENR, AID_TAG, '');
      var call = client.calls.find(function (c) {
        return c.name === 'set_score_status';
      });
      expect(call.payload.p_status).toBeNull();
    });
  });

  describe('window.fillRubric', () => {
    it('calls fill_rubric', async () => {
      await window.fillRubric(ENR, AID_RUBRIC, 3);
      var call = client.calls.find(function (c) {
        return c.name === 'fill_rubric';
      });
      expect(call).toBeDefined();
      expect(call.payload).toEqual({
        p_enrollment_id: ENR,
        p_assessment_id: AID_RUBRIC,
        p_value: 3,
      });
    });
  });

  describe('clear helpers', () => {
    it('clearScore calls clear_score', async () => {
      await window.clearScore(ENR, AID_TAG);
      expect(
        client.calls.find(function (c) {
          return c.name === 'clear_score';
        }),
      ).toBeDefined();
    });

    it('clearRowScores calls clear_row_scores', async () => {
      await window.clearRowScores(ENR, CID);
      expect(
        client.calls.find(function (c) {
          return c.name === 'clear_row_scores';
        }),
      ).toBeDefined();
    });

    it('clearColumnScores calls clear_column_scores', async () => {
      await window.clearColumnScores(AID_TAG);
      expect(
        client.calls.find(function (c) {
          return c.name === 'clear_column_scores';
        }),
      ).toBeDefined();
    });
  });

  describe('setPointsScore v2 dispatch', () => {
    beforeEach(function () {
      _cache.assessments = _cache.assessments || {};
      _cache.assessments[CID] = [{ id: AID_TAG, tagIds: [TAG_ID], type: 'summative', date: '2026-04-22' }];
      _cache.scores = _cache.scores || {};
      _cache.scores[CID] = {};
    });

    afterEach(function () {
      delete _cache.assessments[CID];
      delete _cache.scores[CID];
      localStorage.removeItem('gb-demo-mode');
    });

    it('dispatches upsert_score for the overall cell value when ids are UUIDs', function () {
      setPointsScore(CID, ENR, AID_TAG, 3.5);
      var call = client.calls.find(function (c) {
        return c.name === 'upsert_score';
      });
      expect(call).toBeDefined();
      expect(call.payload).toEqual({
        p_enrollment_id: ENR,
        p_assessment_id: AID_TAG,
        p_value: 3.5,
      });
    });

    it('skips dispatch when enrollment id is not a UUID', function () {
      setPointsScore(CID, 'local-stu-id', AID_TAG, 3.5);
      expect(
        client.calls.find(function (c) {
          return c.name === 'upsert_score';
        }),
      ).toBeUndefined();
    });

    it('skips dispatch in demo mode', function () {
      localStorage.setItem('gb-demo-mode', '1');
      setPointsScore(CID, ENR, AID_TAG, 3.5);
      expect(
        client.calls.find(function (c) {
          return c.name === 'upsert_score';
        }),
      ).toBeUndefined();
    });
  });
});
