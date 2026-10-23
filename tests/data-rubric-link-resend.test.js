/**
 * A rubric saved while one of its competencies still had a local id reached
 * the server without that link: upsert_rubric only sends competency ids the
 * server knows. When the competency lands and is re-keyed, the class's
 * rubrics are sent again so the link is saved (shared/data.js, the 'tag'
 * re-key and _resendRubricLinks).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'c0000000-0000-4000-8000-000000000101';
const R1 = 'c0000000-0000-4000-8000-000000000171';
const C1 = 'c0000000-0000-4000-8000-000000000172';
const T1 = 'c0000000-0000-4000-8000-000000000181';

function makeRecordingClient() {
  var calls = [];
  return {
    calls: calls,
    rpc(name, payload) {
      calls.push({ name: name, payload: payload || {} });
      return Promise.resolve({ data: name === 'upsert_rubric' ? R1 : null, error: null });
    },
  };
}

function rubric(tagId) {
  return {
    id: R1,
    name: 'Lab Skills',
    criteria: [{ id: C1, name: 'Inquiry', tagIds: [tagId], weight: 1, levels: { 4: 'a', 3: 'b', 2: 'c', 1: 'd' } }],
  };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('re-sending rubric links after a competency lands', () => {
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
    _cache.rubrics[CID] = [rubric('tag-local')];
  });
  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    delete _cache.rubrics[CID];
  });

  const upserts = () => client.calls.filter(c => c.name === 'upsert_rubric');

  it('sends the rubric again with the competency’s server id', async () => {
    _rekey(CID, 'tag', 'tag-local', T1);
    expect(getRubrics(CID)[0].criteria[0].tagIds).toEqual([T1]);
    await tick();
    await tick();
    expect(upserts().length).toBeGreaterThan(0);
    const last = upserts()[upserts().length - 1];
    expect(last.payload.p_criteria[0].linked_tag_ids).toEqual([T1]);
  });

  it('sends one save when several competencies land together', async () => {
    _cache.rubrics[CID] = [
      Object.assign(rubric('tag-a'), {
        criteria: [
          { id: C1, name: 'Inquiry', tagIds: ['tag-a', 'tag-b'], weight: 1, levels: { 4: '', 3: '', 2: '', 1: '' } },
        ],
      }),
    ];
    _rekey(CID, 'tag', 'tag-a', T1);
    _rekey(CID, 'tag', 'tag-b', 'c0000000-0000-4000-8000-000000000182');
    await tick();
    await tick();
    expect(upserts()).toHaveLength(1);
  });

  it('does not re-send for a re-key another tab already sent', async () => {
    _rekey(CID, 'tag', 'tag-local', T1, { remote: true });
    await tick();
    await tick();
    expect(upserts()).toHaveLength(0);
  });

  it('does nothing when no rubric links the competency', async () => {
    _rekey(CID, 'tag', 'tag-unrelated', T1);
    await tick();
    expect(upserts()).toHaveLength(0);
  });
});
