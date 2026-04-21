/**
 * v2 learning-map structural dispatch tests — shared/data.js (Phase 4.5)
 *
 * Covers the 20 window.v2.* structural helpers:
 *   Subject, CompetencyGroup, Section, Tag, Module, Category, Rubric
 *   (upsert / delete / reorder where applicable, composite criteria for rubric).
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const ID1 = '22222222-2222-2222-2222-222222222222';
const ID2 = '33333333-3333-3333-3333-333333333333';
const SUBJ_ID = '44444444-4444-4444-4444-444444444444';
const SEC_ID = '55555555-5555-5555-5555-555555555555';
const GRP_ID = '66666666-6666-4666-8666-666666666666';
const TAG1 = '77777777-7777-4777-8777-777777777777';
const TAG2 = '88888888-8888-4888-8888-888888888888';
const CRIT1 = '99999999-9999-4999-8999-999999999999';

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

describe('v2 learning-map structural dispatch (window.v2.*)', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    localStorage.clear();
    client = makeRecordingClient();
    globalThis.getSupabase = () => client;
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  // ---- Subject ---------------------------------------------------------
  describe('Subject', () => {
    it('upsertSubject maps params to snake_case, nulls non-UUID id (insert)', async () => {
      await window.v2.upsertSubject({ courseId: CID, name: 'English', displayOrder: 2 });
      var call = client.calls.find(function (c) { return c.name === 'upsert_subject'; });
      expect(call.payload).toEqual({
        p_id: null,
        p_course_id: CID,
        p_name: 'English',
        p_display_order: 2,
      });
    });

    it('upsertSubject passes UUID id through (update)', async () => {
      await window.v2.upsertSubject({ id: ID1, courseId: CID, name: 'X' });
      var call = client.calls.find(function (c) { return c.name === 'upsert_subject'; });
      expect(call.payload.p_id).toBe(ID1);
    });

    it('deleteSubject calls delete_subject', async () => {
      await window.v2.deleteSubject(ID1);
      expect(client.calls[0]).toEqual({ name: 'delete_subject', payload: { p_id: ID1 } });
    });

    it('reorderSubjects filters to UUIDs', async () => {
      await window.v2.reorderSubjects([ID1, 'junk', ID2]);
      var call = client.calls.find(function (c) { return c.name === 'reorder_subjects'; });
      expect(call.payload).toEqual({ p_ids: [ID1, ID2] });
    });
  });

  // ---- CompetencyGroup ------------------------------------------------
  describe('CompetencyGroup', () => {
    it('upsert maps fields + color', async () => {
      await window.v2.upsertCompetencyGroup({ courseId: CID, name: 'CC', color: '#0891b2', displayOrder: 1 });
      var call = client.calls.find(function (c) { return c.name === 'upsert_competency_group'; });
      expect(call.payload).toEqual({
        p_id: null, p_course_id: CID, p_name: 'CC', p_color: '#0891b2', p_display_order: 1,
      });
    });
    it('delete + reorder', async () => {
      await window.v2.deleteCompetencyGroup(ID1);
      await window.v2.reorderCompetencyGroups([ID1, ID2]);
      expect(client.calls.map(function (c) { return c.name; })).toEqual(['delete_competency_group', 'reorder_competency_groups']);
    });
  });

  // ---- Section (owns subject + optional group) ------------------------
  describe('Section', () => {
    it('upsert passes subject_id + optional competency_group_id', async () => {
      await window.v2.upsertSection({
        subjectId: SUBJ_ID, name: 'S', competencyGroupId: GRP_ID, displayOrder: 3,
      });
      var call = client.calls.find(function (c) { return c.name === 'upsert_section'; });
      expect(call.payload).toEqual({
        p_id: null,
        p_subject_id: SUBJ_ID,
        p_name: 'S',
        p_competency_group_id: GRP_ID,
        p_display_order: 3,
      });
    });

    it('nullifies non-UUID competency_group_id', async () => {
      await window.v2.upsertSection({ subjectId: SUBJ_ID, name: 'S', competencyGroupId: 'legacy' });
      var call = client.calls.find(function (c) { return c.name === 'upsert_section'; });
      expect(call.payload.p_competency_group_id).toBeNull();
    });

    it('delete + reorder', async () => {
      await window.v2.deleteSection(SEC_ID);
      await window.v2.reorderSections([SEC_ID]);
      expect(client.calls.map(function (c) { return c.name; })).toEqual(['delete_section', 'reorder_sections']);
    });
  });

  // ---- Tag -------------------------------------------------------------
  describe('Tag', () => {
    it('upsert passes section_id, label, code, i_can_text', async () => {
      await window.v2.upsertTag({
        sectionId: SEC_ID, label: 'QAP', code: 'QAP-1',
        iCanText: 'I can ask questions', displayOrder: 0,
      });
      var call = client.calls.find(function (c) { return c.name === 'upsert_tag'; });
      expect(call.payload).toEqual({
        p_id: null,
        p_section_id: SEC_ID,
        p_label: 'QAP',
        p_code: 'QAP-1',
        p_i_can_text: 'I can ask questions',
        p_display_order: 0,
      });
    });

    it('delete + reorder', async () => {
      await window.v2.deleteTag(TAG1);
      await window.v2.reorderTags([TAG1, TAG2]);
      expect(client.calls.map(function (c) { return c.name; })).toEqual(['delete_tag', 'reorder_tags']);
    });
  });

  // ---- Module ----------------------------------------------------------
  describe('Module', () => {
    it('upsert + delete + reorder', async () => {
      await window.v2.upsertModule({ courseId: CID, name: 'Unit 1', color: '#ff0000', displayOrder: 1 });
      await window.v2.deleteModule(ID1);
      await window.v2.reorderModules([ID1]);
      expect(client.calls.map(function (c) { return c.name; })).toEqual([
        'upsert_module', 'delete_module', 'reorder_modules',
      ]);
      expect(client.calls[0].payload.p_name).toBe('Unit 1');
      expect(client.calls[0].payload.p_color).toBe('#ff0000');
    });
  });

  // ---- Category --------------------------------------------------------
  describe('Category', () => {
    it('upsert defaults weight to 0, passes through Number', async () => {
      await window.v2.upsertCategory({ courseId: CID, name: 'Tests', weight: 40, displayOrder: 1 });
      var call = client.calls.find(function (c) { return c.name === 'upsert_category'; });
      expect(call.payload).toEqual({
        p_id: null, p_course_id: CID, p_name: 'Tests', p_weight: 40, p_display_order: 1,
      });
    });

    it('upsert defaults missing weight to 0', async () => {
      await window.v2.upsertCategory({ courseId: CID, name: 'X' });
      var call = client.calls.find(function (c) { return c.name === 'upsert_category'; });
      expect(call.payload.p_weight).toBe(0);
    });

    it('deleteCategory', async () => {
      await window.v2.deleteCategory(ID1);
      expect(client.calls[0]).toEqual({ name: 'delete_category', payload: { p_id: ID1 } });
    });
  });

  // ---- Rubric (composite) ---------------------------------------------
  describe('Rubric', () => {
    it('maps composite criteria + linked_tag_ids to snake_case', async () => {
      await window.v2.upsertRubric({
        courseId: CID,
        name: 'Writing',
        criteria: [
          {
            name: 'Ideas',
            level4Descriptor: 'Extending',
            level3Descriptor: 'Proficient',
            level2Descriptor: 'Developing',
            level1Descriptor: 'Emerging',
            level4Value: 4, level3Value: 3, level2Value: 2, level1Value: 1,
            weight: 2,
            displayOrder: 0,
            linkedTagIds: [TAG1, 'junk', TAG2],
          },
          {
            id: CRIT1,
            name: 'Organization',
            level4Descriptor: 'E', level3Descriptor: 'P',
            level2Descriptor: 'D', level1Descriptor: 'Em',
            weight: 1,
            linkedTagIds: [],
          },
        ],
      });
      var call = client.calls.find(function (c) { return c.name === 'upsert_rubric'; });
      expect(call.payload.p_name).toBe('Writing');
      expect(call.payload.p_criteria).toHaveLength(2);
      var c0 = call.payload.p_criteria[0];
      expect(c0.name).toBe('Ideas');
      expect(c0.level_4_descriptor).toBe('Extending');
      expect(c0.level_1_descriptor).toBe('Emerging');
      expect(c0.level_4_value).toBe(4);
      expect(c0.level_1_value).toBe(1);
      expect(c0.weight).toBe(2);
      expect(c0.linked_tag_ids).toEqual([TAG1, TAG2]);
      expect(c0.id).toBeUndefined(); // new criterion, no id
      var c1 = call.payload.p_criteria[1];
      expect(c1.id).toBe(CRIT1);
      expect(c1.level_4_value).toBeUndefined(); // not set, omitted
    });

    it('defaults criterion weight to 1.0 and display_order to 0', async () => {
      await window.v2.upsertRubric({
        courseId: CID, name: 'R',
        criteria: [{ name: 'X' }],
      });
      var call = client.calls.find(function (c) { return c.name === 'upsert_rubric'; });
      expect(call.payload.p_criteria[0].weight).toBe(1.0);
      expect(call.payload.p_criteria[0].display_order).toBe(0);
    });

    it('deleteRubric', async () => {
      await window.v2.deleteRubric(ID1);
      expect(client.calls[0]).toEqual({ name: 'delete_rubric', payload: { p_id: ID1 } });
    });
  });

  describe('_rpcOrNoop (internal)', () => {
    it('returns a resolved no-op when Supabase is not available', async () => {
      globalThis.getSupabase = () => null;
      var res = await window.v2.deleteSubject(ID1);
      expect(res).toEqual({ data: null, error: null });
    });
  });
});
