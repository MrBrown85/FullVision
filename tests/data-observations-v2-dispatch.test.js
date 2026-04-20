/**
 * v2 observation + template + custom-tag dispatch tests — shared/data.js (Phase 4.4)
 *
 * Covers:
 *   _persistObservationCreate  → create_observation (single-student quick-post)
 *   _persistObservationUpdate  → update_observation (patch-only, joins=null)
 *   _persistObservationDelete  → delete_observation
 *   window.createObservationRich   → create_observation (multi-student + tags)
 *   window.updateObservationRich   → update_observation (patch + join replace)
 *   window.upsertObservationTemplate → upsert_observation_template
 *   window.deleteObservationTemplate → delete_observation_template
 *   window.createCustomTag           → create_custom_tag
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const ENR = '22222222-2222-2222-2222-222222222222';
const ENR2 = '33333333-3333-3333-3333-333333333333';
const OB_ID = '44444444-4444-4444-4444-444444444444';
const AID = '55555555-5555-5555-5555-555555555555';
const TAG1 = '66666666-6666-4666-8666-666666666666';
const CTAG1 = '77777777-7777-4777-8777-777777777777';
const TPL_ID = '88888888-8888-4888-8888-888888888888';

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

describe('v2 observation / template / custom-tag dispatch', () => {
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

  describe('_persistObservationCreate (quick-post)', () => {
    it('calls create_observation with single-student enrollment_ids array', async () => {
      _persistObservationCreate(CID, ENR, {
        id: 'temp-id',
        text: 'Great insight',
        sentiment: 'strength',
        context: 'class-discussion',
      });
      await new Promise(function (r) { setTimeout(r, 0); });
      var call = client.calls.find(function (c) { return c.name === 'create_observation'; });
      expect(call).toBeDefined();
      expect(call.payload).toEqual({
        p_course_id: CID,
        p_body: 'Great insight',
        p_sentiment: 'strength',
        p_context_type: 'class-discussion',
        p_assessment_id: null,
        p_enrollment_ids: [ENR],
        p_tag_ids: [],
        p_custom_tag_ids: [],
      });
    });

    it('passes p_assessment_id when assignmentContext has a UUID', async () => {
      _persistObservationCreate(CID, ENR, {
        id: 'x', text: 't', assignmentContext: { assessmentId: AID },
      });
      await new Promise(function (r) { setTimeout(r, 0); });
      var call = client.calls.find(function (c) { return c.name === 'create_observation'; });
      expect(call.payload.p_assessment_id).toBe(AID);
    });

    it('skips dispatch when course id is not a UUID', () => {
      _persistObservationCreate('legacy', ENR, { id: 'x', text: 't' });
      expect(client.calls).toHaveLength(0);
    });

    it('patches cache id with returned observation id on success', async () => {
      var entry = { id: 'temp-id', text: 't' };
      _cache.observations[CID] = _cache.observations[CID] || {};
      _cache.observations[CID][ENR] = [entry];
      client = makeRecordingClient({
        create_observation: { data: OB_ID, error: null },
      });
      globalThis.getSupabase = () => client;
      _persistObservationCreate(CID, ENR, entry);
      await new Promise(function (r) { setTimeout(r, 0); });
      expect(entry.id).toBe(OB_ID);
    });
  });

  describe('_persistObservationUpdate', () => {
    it('calls update_observation with jsonb patch and null joins', async () => {
      _persistObservationUpdate(CID, { id: OB_ID, text: 'Updated', sentiment: 'growth', context: 'lab' });
      await new Promise(function (r) { setTimeout(r, 0); });
      var call = client.calls.find(function (c) { return c.name === 'update_observation'; });
      expect(call.payload.p_id).toBe(OB_ID);
      expect(call.payload.p_patch).toEqual({
        body: 'Updated',
        sentiment: 'growth',
        context_type: 'lab',
      });
      expect(call.payload.p_enrollment_ids).toBeNull();
      expect(call.payload.p_tag_ids).toBeNull();
      expect(call.payload.p_custom_tag_ids).toBeNull();
    });

    it('adds assessment_id to patch when assignmentContext is a UUID', async () => {
      _persistObservationUpdate(CID, { id: OB_ID, assignmentContext: { assessmentId: AID } });
      await new Promise(function (r) { setTimeout(r, 0); });
      var call = client.calls.find(function (c) { return c.name === 'update_observation'; });
      expect(call.payload.p_patch.assessment_id).toBe(AID);
    });
  });

  describe('_persistObservationDelete', () => {
    it('calls delete_observation', async () => {
      _persistObservationDelete(CID, OB_ID);
      await new Promise(function (r) { setTimeout(r, 0); });
      var call = client.calls.find(function (c) { return c.name === 'delete_observation'; });
      expect(call.payload).toEqual({ p_id: OB_ID });
    });

    it('skips on non-UUID id', () => {
      _persistObservationDelete(CID, 'legacy');
      expect(client.calls).toHaveLength(0);
    });
  });

  describe('window.createObservationRich', () => {
    it('filters enrollment_ids, tag_ids, custom_tag_ids to UUIDs', async () => {
      await window.createObservationRich({
        courseId: CID,
        body: 'body',
        sentiment: 'strength',
        contextType: 'class',
        assessmentId: AID,
        enrollmentIds: [ENR, 'junk', ENR2],
        tagIds: [TAG1, 'junk'],
        customTagIds: [CTAG1],
      });
      var call = client.calls.find(function (c) { return c.name === 'create_observation'; });
      expect(call.payload.p_enrollment_ids).toEqual([ENR, ENR2]);
      expect(call.payload.p_tag_ids).toEqual([TAG1]);
      expect(call.payload.p_custom_tag_ids).toEqual([CTAG1]);
    });
  });

  describe('window.updateObservationRich', () => {
    it('passes null for any joins not provided', async () => {
      await window.updateObservationRich(OB_ID, { body: 'x' }, {});
      var call = client.calls.find(function (c) { return c.name === 'update_observation'; });
      expect(call.payload.p_enrollment_ids).toBeNull();
      expect(call.payload.p_tag_ids).toBeNull();
      expect(call.payload.p_custom_tag_ids).toBeNull();
    });

    it('passes filtered UUID arrays when joins are provided', async () => {
      await window.updateObservationRich(OB_ID, {}, {
        enrollmentIds: [ENR, 'junk'],
        tagIds: [TAG1],
        customTagIds: [],
      });
      var call = client.calls.find(function (c) { return c.name === 'update_observation'; });
      expect(call.payload.p_enrollment_ids).toEqual([ENR]);
      expect(call.payload.p_tag_ids).toEqual([TAG1]);
      expect(call.payload.p_custom_tag_ids).toEqual([]);
    });
  });

  describe('window.upsertObservationTemplate', () => {
    it('maps camelCase payload to snake_case RPC params', async () => {
      await window.upsertObservationTemplate(CID, {
        id: TPL_ID,
        body: 'Template body',
        defaultSentiment: 'strength',
        defaultContextType: 'class',
        displayOrder: 2,
      });
      var call = client.calls.find(function (c) { return c.name === 'upsert_observation_template'; });
      expect(call.payload).toEqual({
        p_id: TPL_ID,
        p_course_id: CID,
        p_body: 'Template body',
        p_default_sentiment: 'strength',
        p_default_context_type: 'class',
        p_display_order: 2,
      });
    });

    it('nullifies non-UUID template id (insert path)', async () => {
      await window.upsertObservationTemplate(CID, { body: 'new' });
      var call = client.calls.find(function (c) { return c.name === 'upsert_observation_template'; });
      expect(call.payload.p_id).toBeNull();
    });
  });

  describe('window.deleteObservationTemplate', () => {
    it('calls delete_observation_template with the template id', async () => {
      await window.deleteObservationTemplate(TPL_ID);
      var call = client.calls.find(function (c) { return c.name === 'delete_observation_template'; });
      expect(call.payload).toEqual({ p_id: TPL_ID });
    });

    it('skips on non-UUID id', async () => {
      await window.deleteObservationTemplate('legacy');
      expect(client.calls).toHaveLength(0);
    });
  });

  describe('window.createCustomTag', () => {
    it('calls create_custom_tag with course id and label', async () => {
      await window.createCustomTag(CID, 'My Tag');
      var call = client.calls.find(function (c) { return c.name === 'create_custom_tag'; });
      expect(call.payload).toEqual({ p_course_id: CID, p_label: 'My Tag' });
    });

    it('skips on non-UUID course id', async () => {
      await window.createCustomTag('legacy', 'Tag');
      expect(client.calls).toHaveLength(0);
    });
  });
});
