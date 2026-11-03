/**
 * Whole-rubric competencies on the wire (rubric starts PR 6): the class
 * bundle's rubric_tags rows become rubric.tagIds, a save sends them as
 * upsert_rubric's p_linked_tag_ids (server ids only), a change to them is a
 * change to save, and a competency that lands re-keys them and sends the
 * rubric again.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'c0000000-0000-4000-8000-000000000201';
const R1 = 'c0000000-0000-4000-8000-000000000271';
const C1 = 'c0000000-0000-4000-8000-000000000272';
const T1 = 'c0000000-0000-4000-8000-000000000281';
const T2 = 'c0000000-0000-4000-8000-000000000282';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('rubric_tag rows', () => {
  it('become the rubric’s tagIds; a bundle without them gives none', () => {
    const rows = [{ id: R1, name: 'Lab', created_at: '2026-09-01', style: 'standard' }];
    const crit = [{ id: C1, rubric_id: R1, name: 'Inquiry', weight: 1, display_order: 0 }];
    const withTags = _canonicalRubricRowsToCache(
      rows,
      crit,
      [{ criterion_id: C1, tag_id: T1 }],
      [],
      [{ rubric_id: R1, tag_id: T2 }],
    );
    expect(withTags[0].tagIds).toEqual([T2]);
    expect(withTags[0].criteria[0].tagIds).toEqual([T1]);
    expect(_canonicalRubricRowsToCache(rows, crit, [], [])[0].tagIds).toEqual([]);
  });

  it('count in the save signature', () => {
    const r = { id: R1, name: 'Lab', criteria: [], tagIds: [] };
    expect(_rubricSignature(r)).not.toBe(_rubricSignature(Object.assign({}, r, { tagIds: [T1] })));
  });
});

describe('saving', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var calls;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    localStorage.clear();
    calls = [];
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        return Promise.resolve({ data: name === 'upsert_rubric' ? R1 : null, error: null });
      },
    });
  });
  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    delete _cache.rubrics[CID];
  });
  const upserts = () => calls.filter(c => c.name === 'upsert_rubric');

  it('sends p_linked_tag_ids with server ids only', async () => {
    await window.v2.upsertRubric({ id: R1, courseId: CID, name: 'Lab', criteria: [], linkedTagIds: [T1, 'tag-local'] });
    expect(upserts()[0].payload.p_linked_tag_ids).toEqual([T1]);
  });

  it('sends [] for a rubric with none, so removing the last one saves', async () => {
    await window.v2.upsertRubric({ id: R1, courseId: CID, name: 'Lab', criteria: [], linkedTagIds: [] });
    expect(upserts()[0].payload.p_linked_tag_ids).toEqual([]);
  });

  it('sends null when the rubric never loaded them, so the server keeps its own', async () => {
    await window.v2.upsertRubric({ id: R1, courseId: CID, name: 'Lab', criteria: [] });
    expect(upserts()[0].payload.p_linked_tag_ids).toBeNull();
  });

  it('re-keys a landed competency on the whole rubric and sends it again', async () => {
    _cache.rubrics[CID] = [
      {
        id: R1,
        name: 'Lab',
        tagIds: ['tag-local'],
        criteria: [{ id: C1, name: 'Inquiry', tagIds: [], weight: 1, levels: { 4: '', 3: '', 2: '', 1: '' } }],
      },
    ];
    _rekey(CID, 'tag', 'tag-local', T1);
    expect(getRubrics(CID)[0].tagIds).toEqual([T1]);
    await tick();
    await tick();
    const last = upserts()[upserts().length - 1];
    expect(last.payload.p_linked_tag_ids).toEqual([T1]);
  });
});
