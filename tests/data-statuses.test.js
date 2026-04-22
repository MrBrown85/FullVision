/**
 * setAssignmentStatus v2 dispatch — shared/data.js
 *
 * Local-cache status behavior is covered in data-scores.test.js.
 * window.setCellStatus (direct RPC wrapper) is covered in
 * data-scores-v2-dispatch.test.js. This file pins the wiring between
 * the page-level setAssignmentStatus entry point and the set_score_status
 * RPC, including the UUID guard that falls back to local-only.
 */

const CID = 'status-test';
let _origGetSupabase;
let _origUseSupabase;

beforeEach(() => {
  _cache.statuses[CID] = undefined;
  localStorage.clear();
  _origGetSupabase = getSupabase;
  _origUseSupabase = _useSupabase;
});

afterEach(() => {
  globalThis.getSupabase = _origGetSupabase;
  _useSupabase = _origUseSupabase;
});

describe('setAssignmentStatus v2 dispatch', () => {
  it('calls set_score_status when Supabase is enabled and ids are UUIDs', async () => {
    const ENR = '11111111-1111-1111-1111-111111111111';
    const AID = '22222222-2222-2222-2222-222222222222';
    const rpcCalls = [];
    _useSupabase = true;
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        rpcCalls.push({ name, payload });
        return Promise.resolve({ error: null });
      },
    });

    setAssignmentStatus(CID, ENR, AID, 'late');
    await Promise.resolve();

    const scoreStatusCall = rpcCalls.find(c => c.name === 'set_score_status');
    expect(scoreStatusCall).toBeDefined();
    expect(scoreStatusCall.payload).toEqual({
      p_enrollment_id: ENR,
      p_assessment_id: AID,
      p_status: 'late',
    });
  });

  it('skips the RPC when ids are not UUIDs (legacy local-only path)', async () => {
    const rpcCalls = [];
    _useSupabase = true;
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        rpcCalls.push({ name, payload });
        return Promise.resolve({ error: null });
      },
    });

    setAssignmentStatus(CID, 'stu1', 'assess1', 'late');
    await Promise.resolve();

    expect(rpcCalls.find(c => c.name === 'set_score_status')).toBeUndefined();
  });
});
