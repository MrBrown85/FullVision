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
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
      var call = client.calls.find(function (c) {
        return c.name === 'create_observation';
      });
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
        p_dims: [],
        p_level: null,
        p_idempotency_key: expect.any(String),
      });
    });

    it('sends the tags as p_dims string keys', async () => {
      _persistObservationCreate(CID, ENR, {
        id: 'temp-id',
        text: 't',
        dims: ['engagement', 'cc:3', 'tag:Lab safety', 'engagement', '', null],
      });
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
      var call = client.calls.find(function (c) {
        return c.name === 'create_observation';
      });
      expect(call.payload.p_dims).toEqual(['engagement', 'cc:3', 'tag:Lab safety']);
      // Tag keys are not learning-map or custom_tag ids.
      expect(call.payload.p_tag_ids).toEqual([]);
      expect(call.payload.p_custom_tag_ids).toEqual([]);
    });

    it('passes p_assessment_id when assignmentContext has a UUID', async () => {
      _persistObservationCreate(CID, ENR, {
        id: 'x',
        text: 't',
        assignmentContext: { assessmentId: AID },
      });
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
      var call = client.calls.find(function (c) {
        return c.name === 'create_observation';
      });
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
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
      expect(entry.id).toBe(OB_ID);
    });
  });

  describe('_persistObservationUpdate', () => {
    it('calls update_observation with jsonb patch and null joins', async () => {
      _persistObservationUpdate(CID, { id: OB_ID, text: 'Updated', sentiment: 'growth', context: 'lab' });
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
      var call = client.calls.find(function (c) {
        return c.name === 'update_observation';
      });
      expect(call.payload.p_id).toBe(OB_ID);
      expect(call.payload.p_patch).toEqual({
        body: 'Updated',
        sentiment: 'growth',
        context_type: 'lab',
        dims: [],
        level: null,
      });
      expect(call.payload.p_enrollment_ids).toBeNull();
      expect(call.payload.p_tag_ids).toBeNull();
      expect(call.payload.p_custom_tag_ids).toBeNull();
    });

    it('sends the current tags in the patch', async () => {
      _persistObservationUpdate(CID, { id: OB_ID, text: 'x', dims: ['collaboration', 'cc:7'] });
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
      var call = client.calls.find(function (c) {
        return c.name === 'update_observation';
      });
      expect(call.payload.p_patch.dims).toEqual(['collaboration', 'cc:7']);
    });

    it('sends an empty dims list when the last tag is removed', async () => {
      _persistObservationUpdate(CID, { id: OB_ID, text: 'x', dims: [] });
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
      var call = client.calls.find(function (c) {
        return c.name === 'update_observation';
      });
      expect(call.payload.p_patch.dims).toEqual([]);
    });

    it('adds assessment_id to patch when assignmentContext is a UUID', async () => {
      _persistObservationUpdate(CID, { id: OB_ID, assignmentContext: { assessmentId: AID } });
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
      var call = client.calls.find(function (c) {
        return c.name === 'update_observation';
      });
      expect(call.payload.p_patch.assessment_id).toBe(AID);
    });
  });

  describe('round trip to a second device', () => {
    it('a tag added on one device shows after another device loads the class', async () => {
      // Device A: post an observation with tags, then edit its tags.
      _cache.observations[CID] = {};
      client = makeRecordingClient({ create_observation: { data: OB_ID, error: null } });
      globalThis.getSupabase = () => client;
      addQuickOb(CID, ENR, 'Asked a strong question', ['engagement', 'cc:3'], 'strength', null);
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
      updateQuickOb(CID, ENR, OB_ID, { dims: ['engagement', 'cc:3', 'tag:Lab safety'] });
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
      var create = client.calls.find(function (c) {
        return c.name === 'create_observation';
      });
      var update = client.calls.find(function (c) {
        return c.name === 'update_observation';
      });
      expect(create.payload.p_dims).toEqual(['engagement', 'cc:3']);
      expect(update.payload.p_patch.dims).toEqual(['engagement', 'cc:3', 'tag:Lab safety']);

      // The server stores what was sent and returns it on the row.
      var row = {
        id: OB_ID,
        body: create.payload.p_body,
        sentiment: create.payload.p_sentiment,
        context_type: null,
        assessment_id: null,
        created_at: '2026-10-18T15:00:00Z',
        enrollment_ids: [ENR],
        tag_ids: [],
        custom_tag_ids: [],
        dims: update.payload.p_patch.dims,
      };

      // Device B: load the class from the server.
      var blob = _observationsPayloadToBlob({ observations: [row] }, CID);
      expect(blob[ENR][0].dims).toEqual(['engagement', 'cc:3', 'tag:Lab safety']);
    });

    it('an Assignments-page comment keeps its assessment title after reload', async () => {
      _cache.assessments[CID] = [{ id: AID, title: 'Lab report 2' }];
      _cache.observations[CID] = {};
      addQuickOb(CID, ENR, 'Clear method section', [], null, null, {
        assessmentId: AID,
        assessmentTitle: 'Lab report 2',
      });
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
      var create = client.calls.find(function (c) {
        return c.name === 'create_observation';
      });
      expect(create.payload.p_assessment_id).toBe(AID);

      var blob = _observationsPayloadToBlob(
        {
          observations: [
            {
              id: OB_ID,
              body: create.payload.p_body,
              assessment_id: create.payload.p_assessment_id,
              created_at: '2026-10-18T15:00:00Z',
              enrollment_ids: [ENR],
              dims: [],
            },
          ],
        },
        CID,
      );
      expect(blob[ENR][0].assignmentContext).toEqual({ assessmentId: AID, assessmentTitle: 'Lab report 2' });
      delete _cache.assessments[CID];
    });
  });

  describe('competency and level', () => {
    function lastCall(name) {
      return client.calls
        .filter(function (c) {
          return c.name === name;
        })
        .pop();
    }
    function tick() {
      return new Promise(function (r) {
        setTimeout(r, 0);
      });
    }

    it('create sends the competency in p_tag_ids and the level in p_level', async () => {
      _cache.observations[CID] = {};
      addQuickOb(CID, ENR, 'Planned the variables first', [], 'strength', null, null, {
        competencyId: TAG1,
        level: 3,
      });
      await tick();
      var call = lastCall('create_observation');
      expect(call.payload.p_tag_ids).toEqual([TAG1]);
      expect(call.payload.p_level).toBe(3);
      expect(call.payload.p_dims).toEqual([]);
      var stored = _cache.observations[CID][ENR][0];
      expect(stored.competencyId).toBe(TAG1);
      expect(stored.level).toBe(3);
    });

    it('keeps Core Competency keys in dims beside a learning-map competency', async () => {
      _cache.observations[CID] = {};
      addQuickOb(CID, ENR, 't', ['cc:3'], null, null, null, { competencyId: TAG1 });
      await tick();
      var call = lastCall('create_observation');
      expect(call.payload.p_dims).toEqual(['cc:3']);
      expect(call.payload.p_tag_ids).toEqual([TAG1]);
      expect(call.payload.p_level).toBeNull();
    });

    it('a level outside 1-4 is not stored or sent', async () => {
      _cache.observations[CID] = {};
      addQuickOb(CID, ENR, 't', [], null, null, null, { competencyId: TAG1, level: 7 });
      await tick();
      expect(lastCall('create_observation').payload.p_level).toBeNull();
      expect(_cache.observations[CID][ENR][0].level).toBeUndefined();
    });

    it('never sends a local learning-map id the server has not seen (rule 6)', async () => {
      _cache.observations[CID] = {};
      addQuickOb(CID, ENR, 't', [], null, null, null, { competencyId: 'tag_local_123', level: 2 });
      await tick();
      var call = lastCall('create_observation');
      expect(call.payload.p_tag_ids).toEqual([]);
      expect(call.payload.p_level).toBeNull();
    });

    it('update sends the level in the patch; the competency only when it changed', async () => {
      _cache.observations[CID] = {
        [ENR]: [{ id: OB_ID, text: 't', dims: [], competencyId: TAG1, level: 2, created: '2026-10-18T15:00:00Z' }],
      };
      updateQuickOb(CID, ENR, OB_ID, { text: 'edited' });
      await tick();
      var first = lastCall('update_observation');
      expect(first.payload.p_patch.level).toBe(2);
      expect(first.payload.p_tag_ids).toBeNull();

      updateQuickOb(CID, ENR, OB_ID, { level: 4 });
      await tick();
      expect(lastCall('update_observation').payload.p_patch.level).toBe(4);

      updateQuickOb(CID, ENR, OB_ID, { competencyId: null });
      await tick();
      var cleared = lastCall('update_observation');
      expect(cleared.payload.p_tag_ids).toEqual([]);
      expect(cleared.payload.p_patch.level).toBeNull();
      expect(_cache.observations[CID][ENR][0].competencyId).toBeUndefined();
      expect(_cache.observations[CID][ENR][0].level).toBeUndefined();
    });

    it('a competency-linked observation round-trips the server', async () => {
      _cache.observations[CID] = {};
      client = makeRecordingClient({ create_observation: { data: OB_ID, error: null } });
      globalThis.getSupabase = () => client;
      addQuickOb(CID, ENR, 'Explained the process to two classmates', ['collaboration'], 'strength', null, null, {
        competencyId: TAG1,
        level: 3,
      });
      await tick();
      var create = lastCall('create_observation');

      // What the server stores and returns on the row.
      var row = {
        id: OB_ID,
        body: create.payload.p_body,
        sentiment: create.payload.p_sentiment,
        context_type: null,
        assessment_id: null,
        created_at: '2026-10-18T15:00:00Z',
        enrollment_ids: [ENR],
        tag_ids: create.payload.p_tag_ids,
        custom_tag_ids: [],
        dims: create.payload.p_dims,
        level: create.payload.p_level,
      };
      var blob = _observationsPayloadToBlob({ observations: [row] }, CID);
      expect(blob[ENR][0]).toMatchObject({
        id: OB_ID,
        text: 'Explained the process to two classmates',
        dims: ['collaboration'],
        sentiment: 'strength',
        competencyId: TAG1,
        level: 3,
      });
    });

    it('a competency with a local id is re-keyed when its tag reaches the server', () => {
      _cache.observations[CID] = {
        [ENR]: [
          { id: OB_ID, text: 't', dims: [], competencyId: 'tLOCALTAG1', level: 3, created: '2026-10-18T15:00:00Z' },
        ],
      };
      _rekey(CID, 'tag', 'tLOCALTAG1', TAG1);
      expect(getQuickObs(CID)[ENR][0].competencyId).toBe(TAG1);
      expect(getQuickObs(CID)[ENR][0].level).toBe(3);
    });

    it('a row without a level or tag loads without them', () => {
      var blob = _observationsPayloadToBlob(
        {
          observations: [
            { id: OB_ID, body: 'b', created_at: '2026-10-18T15:00:00Z', enrollment_ids: [ENR], dims: [], level: null },
          ],
        },
        CID,
      );
      expect(blob[ENR][0].competencyId).toBeUndefined();
      expect(blob[ENR][0].level).toBeUndefined();
    });
  });

  describe('_persistObservationDelete', () => {
    it('calls delete_observation', async () => {
      _persistObservationDelete(CID, OB_ID);
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
      var call = client.calls.find(function (c) {
        return c.name === 'delete_observation';
      });
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
      var call = client.calls.find(function (c) {
        return c.name === 'create_observation';
      });
      expect(call.payload.p_enrollment_ids).toEqual([ENR, ENR2]);
      expect(call.payload.p_tag_ids).toEqual([TAG1]);
      expect(call.payload.p_custom_tag_ids).toEqual([CTAG1]);
    });
  });

  describe('window.updateObservationRich', () => {
    it('passes null for any joins not provided', async () => {
      await window.updateObservationRich(OB_ID, { body: 'x' }, {});
      var call = client.calls.find(function (c) {
        return c.name === 'update_observation';
      });
      expect(call.payload.p_enrollment_ids).toBeNull();
      expect(call.payload.p_tag_ids).toBeNull();
      expect(call.payload.p_custom_tag_ids).toBeNull();
    });

    it('passes filtered UUID arrays when joins are provided', async () => {
      await window.updateObservationRich(
        OB_ID,
        {},
        {
          enrollmentIds: [ENR, 'junk'],
          tagIds: [TAG1],
          customTagIds: [],
        },
      );
      var call = client.calls.find(function (c) {
        return c.name === 'update_observation';
      });
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
      var call = client.calls.find(function (c) {
        return c.name === 'upsert_observation_template';
      });
      expect(call.payload).toEqual({
        p_id: TPL_ID,
        p_course_id: CID,
        p_body: 'Template body',
        p_default_sentiment: 'strength',
        p_default_context_type: 'class',
        p_display_order: 2,
        p_idempotency_key: expect.any(String),
      });
    });

    it('nullifies non-UUID template id (insert path)', async () => {
      await window.upsertObservationTemplate(CID, { body: 'new' });
      var call = client.calls.find(function (c) {
        return c.name === 'upsert_observation_template';
      });
      expect(call.payload.p_id).toBeNull();
    });
  });

  describe('window.deleteObservationTemplate', () => {
    it('calls delete_observation_template with the template id', async () => {
      await window.deleteObservationTemplate(TPL_ID);
      var call = client.calls.find(function (c) {
        return c.name === 'delete_observation_template';
      });
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
      var call = client.calls.find(function (c) {
        return c.name === 'create_custom_tag';
      });
      expect(call.payload).toEqual({
        p_course_id: CID,
        p_label: 'My Tag',
        p_idempotency_key: expect.any(String),
      });
    });

    it('skips on non-UUID course id', async () => {
      await window.createCustomTag('legacy', 'Tag');
      expect(client.calls).toHaveLength(0);
    });
  });
});
