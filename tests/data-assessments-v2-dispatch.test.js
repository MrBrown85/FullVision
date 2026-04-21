/**
 * v2 assessment CRUD dispatch tests — shared/data.js (Phase 4.2)
 *
 * Covers:
 *   _canonicalCreateAssessment  → create_assessment (+ tag_ids)
 *   _canonicalUpdateAssessment  → update_assessment (jsonb patch + tag_ids replace)
 *   _canonicalDeleteAssessment  → delete_assessment
 *   window.duplicateAssessment  → duplicate_assessment
 *   window.saveAssessmentTags   → save_assessment_tags
 *   window.saveCollab           → save_collab
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const AID = '22222222-2222-2222-2222-222222222222';
const TAG1 = '33333333-3333-3333-3333-333333333333';
const TAG2 = '44444444-4444-4444-4444-444444444444';
const RUBRIC_ID = '55555555-5555-5555-5555-555555555555';
const MODULE_ID = '66666666-6666-4666-8666-666666666666';
const CAT_ID = '77777777-7777-4777-8777-777777777777';

function makeRecordingClient(responses) {
  var calls = [];
  responses = responses || {};
  return {
    calls: calls,
    rpc(name, payload) {
      calls.push({ name: name, payload: payload || {} });
      var r = responses[name];
      return Promise.resolve(r || { data: null, error: null });
    },
  };
}

describe('v2 assessment CRUD dispatch', () => {
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
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  describe('_canonicalCreateAssessment', () => {
    it('maps app-shape fields to snake_case RPC params', async () => {
      var a = {
        id: 'temp-id',
        title: 'Essay 1',
        description: 'First essay',
        categoryId: CAT_ID,
        dateAssigned: '2026-04-18',
        dueDate: '2026-04-25',
        scoreMode: 'rubric',
        maxPoints: 20,
        weight: 2,
        evidenceType: 'writing',
        rubricId: RUBRIC_ID,
        moduleId: MODULE_ID,
        tagIds: [TAG1, TAG2, 'not-a-uuid'],
      };
      await _canonicalCreateAssessment(client, CID, a);
      var call = client.calls.find(function (c) { return c.name === 'create_assessment'; });
      expect(call).toBeDefined();
      expect(call.payload).toEqual({
        p_course_id: CID,
        p_title: 'Essay 1',
        p_category_id: CAT_ID,
        p_description: 'First essay',
        p_date_assigned: '2026-04-18',
        p_due_date: '2026-04-25',
        p_score_mode: 'rubric',
        p_max_points: 20,
        p_weight: 2,
        p_evidence_type: 'writing',
        p_rubric_id: RUBRIC_ID,
        p_module_id: MODULE_ID,
        p_tag_ids: [TAG1, TAG2],
      });
    });

    it('defaults score_mode to proficiency and weight to 1.0', async () => {
      await _canonicalCreateAssessment(client, CID, { id: 'x', title: 'T' });
      var call = client.calls.find(function (c) { return c.name === 'create_assessment'; });
      expect(call.payload.p_score_mode).toBe('proficiency');
      expect(call.payload.p_weight).toBe(1.0);
      expect(call.payload.p_max_points).toBeNull();
    });

    it('nullifies non-UUID categoryId / rubricId / moduleId', async () => {
      var a = { id: 'x', title: 'T', categoryId: 'legacy-cat', rubricId: 'legacy-rubric', moduleId: 'legacy-mod' };
      await _canonicalCreateAssessment(client, CID, a);
      var call = client.calls.find(function (c) { return c.name === 'create_assessment'; });
      expect(call.payload.p_category_id).toBeNull();
      expect(call.payload.p_rubric_id).toBeNull();
      expect(call.payload.p_module_id).toBeNull();
    });

    it('patches the cached assessment id with the returned UUID on success', async () => {
      var a = { id: 'temp-id', title: 'T' };
      _cache.assessments[CID] = [a];
      client = makeRecordingClient({
        create_assessment: { data: AID, error: null },
      });
      globalThis.getSupabase = () => client;
      await _canonicalCreateAssessment(client, CID, a);
      expect(a.id).toBe(AID);
    });
  });

  describe('_canonicalUpdateAssessment', () => {
    it('calls update_assessment with jsonb patch + filtered tag_ids', async () => {
      var a = {
        title: 'Updated',
        description: 'New desc',
        categoryId: CAT_ID,
        dateAssigned: '2026-04-18',
        dueDate: '2026-04-25',
        scoreMode: 'points',
        maxPoints: 50,
        weight: 1.5,
        evidenceType: 'quiz',
        rubricId: null,
        moduleId: MODULE_ID,
        tagIds: [TAG1],
      };
      await _canonicalUpdateAssessment(client, CID, AID, a);
      var call = client.calls.find(function (c) { return c.name === 'update_assessment'; });
      expect(call.payload.p_id).toBe(AID);
      expect(call.payload.p_tag_ids).toEqual([TAG1]);
      expect(call.payload.p_patch).toMatchObject({
        title: 'Updated',
        description: 'New desc',
        category_id: CAT_ID,
        date_assigned: '2026-04-18',
        due_date: '2026-04-25',
        score_mode: 'points',
        evidence_type: 'quiz',
        module_id: MODULE_ID,
        rubric_id: null,
      });
      // max_points + weight serialize as strings per the write-paths contract
      expect(call.payload.p_patch.max_points).toBe('50');
      expect(call.payload.p_patch.weight).toBe('1.5');
    });

    it('defaults missing weight to "1"', async () => {
      await _canonicalUpdateAssessment(client, CID, AID, { title: 'T' });
      var call = client.calls.find(function (c) { return c.name === 'update_assessment'; });
      expect(call.payload.p_patch.weight).toBe('1');
    });
  });

  describe('_canonicalDeleteAssessment', () => {
    it('calls delete_assessment with the assessment id', async () => {
      await _canonicalDeleteAssessment(client, CID, AID);
      var call = client.calls.find(function (c) { return c.name === 'delete_assessment'; });
      expect(call.payload).toEqual({ p_id: AID });
    });
  });

  describe('window.duplicateAssessment', () => {
    it('calls duplicate_assessment with p_src_id', async () => {
      await window.duplicateAssessment(AID);
      var call = client.calls.find(function (c) { return c.name === 'duplicate_assessment'; });
      expect(call.payload).toEqual({ p_src_id: AID });
    });

    it('skips dispatch on non-UUID id', async () => {
      await window.duplicateAssessment('legacy-id');
      expect(client.calls).toHaveLength(0);
    });
  });

  describe('window.saveAssessmentTags', () => {
    it('calls save_assessment_tags with filtered UUID list', async () => {
      await window.saveAssessmentTags(AID, [TAG1, 'junk', TAG2]);
      var call = client.calls.find(function (c) { return c.name === 'save_assessment_tags'; });
      expect(call.payload).toEqual({ p_id: AID, p_tag_ids: [TAG1, TAG2] });
    });

    it('skips dispatch on non-UUID assessment id', async () => {
      await window.saveAssessmentTags('junk', [TAG1]);
      expect(client.calls).toHaveLength(0);
    });
  });

  describe('window.saveCollab', () => {
    it('calls save_collab with mode + config jsonb', async () => {
      var cfg = { pairs: [['a', 'b']] };
      await window.saveCollab(AID, 'pairs', cfg);
      var call = client.calls.find(function (c) { return c.name === 'save_collab'; });
      expect(call.payload).toEqual({ p_id: AID, p_mode: 'pairs', p_config: cfg });
    });

    it('nulls the config when mode is "none"', async () => {
      await window.saveCollab(AID, 'none', { stale: true });
      var call = client.calls.find(function (c) { return c.name === 'save_collab'; });
      expect(call.payload.p_config).toBeNull();
    });

    it('defaults mode to "none" when missing', async () => {
      await window.saveCollab(AID);
      var call = client.calls.find(function (c) { return c.name === 'save_collab'; });
      expect(call.payload.p_mode).toBe('none');
    });
  });
});
