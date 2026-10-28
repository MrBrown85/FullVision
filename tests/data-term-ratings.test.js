/**
 * Term rating tests — gb-data.js
 */

const CID = 'test';
const CANONICAL_CID = '11111111-1111-1111-1111-111111111111';
const ENROLLMENT_ID = '22222222-2222-2222-2222-222222222222';
const STUDENT_ID = '33333333-3333-3333-3333-333333333333';
let _origGetSupabase;
let _origUseSupabase;

beforeEach(() => {
  _cache.termRatings[CID] = undefined;
  _cache.termRatings[CANONICAL_CID] = undefined;
  _cache.students[CANONICAL_CID] = undefined;
  localStorage.clear();
  _origGetSupabase = getSupabase;
  _origUseSupabase = _useSupabase;
  _useSupabase = false;
});

afterEach(() => {
  globalThis.getSupabase = _origGetSupabase;
  _useSupabase = _origUseSupabase;
});

describe('getStudentTermRating', () => {
  it('returns rating when it exists', () => {
    saveTermRatings(CID, {
      stu1: { term1: { dims: { engagement: 3 }, narrative: 'Good work' } },
    });
    const result = getStudentTermRating(CID, 'stu1', 'term1');
    expect(result.narrative).toBe('Good work');
    expect(result.dims.engagement).toBe(3);
  });

  it('returns null when student has no ratings', () => {
    saveTermRatings(CID, {});
    expect(getStudentTermRating(CID, 'stu1', 'term1')).toBeNull();
  });

  it('returns null when term not found', () => {
    saveTermRatings(CID, { stu1: { term1: { narrative: 'x' } } });
    expect(getStudentTermRating(CID, 'stu1', 'term2')).toBeNull();
  });
});

describe('upsertTermRating', () => {
  it('creates a new rating without the old nine dims', () => {
    saveTermRatings(CID, {});
    upsertTermRating(CID, 'stu1', 'term1', { narrative: 'First report' });
    const result = getStudentTermRating(CID, 'stu1', 'term1');
    expect(result.narrative).toBe('First report');
    expect(result.dims).toBeUndefined();
    expect(result.created).toBeDefined();
    expect(result.modified).toBeDefined();
  });

  it('merges data into existing rating', () => {
    saveTermRatings(CID, {
      stu1: { term1: { dims: { engagement: 2 }, narrative: 'Old', created: '2025-01-01', modified: '2025-01-01' } },
    });
    upsertTermRating(CID, 'stu1', 'term1', { narrative: 'Updated' });
    const result = getStudentTermRating(CID, 'stu1', 'term1');
    expect(result.narrative).toBe('Updated');
    expect(result.dims.engagement).toBe(2); // preserved
  });

  it('sets modified timestamp on update', () => {
    saveTermRatings(CID, {
      stu1: { term1: { dims: {}, narrative: '', created: '2025-01-01T00:00:00Z', modified: '2025-01-01T00:00:00Z' } },
    });
    upsertTermRating(CID, 'stu1', 'term1', { narrative: 'New' });
    const result = getStudentTermRating(CID, 'stu1', 'term1');
    expect(result.modified).not.toBe('2025-01-01T00:00:00Z');
  });

  it('preserves existing dims when updating only narrative', () => {
    saveTermRatings(CID, {});
    upsertTermRating(CID, 'stu1', 'term1', { dims: { engagement: 4, collaboration: 3 } });
    upsertTermRating(CID, 'stu1', 'term1', { narrative: 'Added narrative' });
    const result = getStudentTermRating(CID, 'stu1', 'term1');
    expect(result.dims.engagement).toBe(4);
    expect(result.narrative).toBe('Added narrative');
  });

  it('calls v2 save_term_rating via window.v2.saveTermRating when enrollment id is a UUID', async () => {
    const rpcCalls = [];
    _useSupabase = true;
    _cache.students[CANONICAL_CID] = [
      {
        id: ENROLLMENT_ID,
        personId: STUDENT_ID,
        firstName: 'Ada',
        lastName: 'Lovelace',
        designations: [],
        sortName: 'Lovelace Ada',
      },
    ];
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        rpcCalls.push({ name, payload });
        return Promise.resolve({ error: null });
      },
    });

    // `termId` must be a numeric 1..6 to pass the v2 guard; legacy 'term1'
    // no longer dispatches remotely.
    upsertTermRating(CANONICAL_CID, ENROLLMENT_ID, 1, { narrative: 'Canonical write' });
    await Promise.resolve();

    const call = rpcCalls.find(function (c) {
      return c.name === 'save_term_rating';
    });
    expect(call).toBeDefined();
    expect(call.payload.p_enrollment_id).toBe(ENROLLMENT_ID);
    expect(call.payload.p_term).toBe(1);
    expect(call.payload.p_payload.narrative_html).toBe('Canonical write');
  });

  it('an edited comment clears its approval; the same text keeps it', () => {
    saveTermRatings(CID, {});
    upsertTermRating(CID, 'stu1', 'term-2', { narrative: 'Steady term.', approvedAt: '2026-10-28T10:00:00Z' });
    upsertTermRating(CID, 'stu1', 'term-2', { narrative: 'Steady term.' });
    expect(getStudentTermRating(CID, 'stu1', 'term-2').approvedAt).toBe('2026-10-28T10:00:00Z');
    upsertTermRating(CID, 'stu1', 'term-2', { habits: { completes: 4 } });
    expect(getStudentTermRating(CID, 'stu1', 'term-2').approvedAt).toBe('2026-10-28T10:00:00Z');
    upsertTermRating(CID, 'stu1', 'term-2', { narrative: 'Steady term. Edited.' });
    expect(getStudentTermRating(CID, 'stu1', 'term-2').approvedAt).toBeNull();
  });

  it('sends habits and approval to save_term_rating', async () => {
    const rpcCalls = [];
    _useSupabase = true;
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        rpcCalls.push({ name, payload });
        return Promise.resolve({ error: null });
      },
    });
    upsertTermRating(CANONICAL_CID, ENROLLMENT_ID, 'term-2', {
      habits: { completes: 4, part: 2, ready: 0, kindness: 3 },
      approvedAt: '2026-10-28T10:00:00Z',
    });
    upsertTermRating(CANONICAL_CID, ENROLLMENT_ID, 'term-2', { approvedAt: null });
    await Promise.resolve();
    const calls = rpcCalls.filter(c => c.name === 'save_term_rating');
    expect(calls[0].payload.p_term).toBe(2);
    expect(calls[0].payload.p_payload).toEqual({ habits: { completes: 4, part: 2 }, approved: true });
    expect(calls[1].payload.p_payload).toEqual({ approved: false });
  });

  it('never sends the old dims', async () => {
    const rpcCalls = [];
    _useSupabase = true;
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        rpcCalls.push({ name, payload });
        return Promise.resolve({ error: null });
      },
    });
    upsertTermRating(CANONICAL_CID, ENROLLMENT_ID, 'term-2', { dims: { engagement: 3 } });
    await Promise.resolve();
    expect(rpcCalls.filter(c => c.name === 'save_term_rating')).toHaveLength(0);
  });
});

describe('_applyBundleTermRatings', () => {
  it('reads habits and approved_at back from the bundle', () => {
    _applyBundleTermRatings(CANONICAL_CID, [
      {
        enrollment_id: ENROLLMENT_ID,
        term: 2,
        narrative_html: 'Steady term.',
        habits: { completes: 4, devices: 5 },
        approved_at: '2026-10-28T10:00:00Z',
      },
      { enrollment_id: STUDENT_ID, term: 1, narrative_html: '' },
    ]);
    const r = getStudentTermRating(CANONICAL_CID, ENROLLMENT_ID, 'term-2');
    expect(r.habits).toEqual({ completes: 4, devices: 5 });
    expect(r.approvedAt).toBe('2026-10-28T10:00:00Z');
    const old = getStudentTermRating(CANONICAL_CID, STUDENT_ID, 'term-1');
    expect(old.habits).toEqual({});
    expect(old.approvedAt).toBeNull();
  });

  it('keeps the old dims this device has', () => {
    saveTermRatings(CANONICAL_CID, { [ENROLLMENT_ID]: { 'term-2': { dims: { engagement: 3 } } } });
    _applyBundleTermRatings(CANONICAL_CID, [{ enrollment_id: ENROLLMENT_ID, term: 2, narrative_html: 'x' }]);
    expect(getStudentTermRating(CANONICAL_CID, ENROLLMENT_ID, 'term-2').dims).toEqual({ engagement: 3 });
  });
});
