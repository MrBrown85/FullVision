/**
 * Persistence: dispatch delete_observation when an assessment is deleted (P6.5).
 *
 * Background: observations reference assessments through a JSON
 * `assignmentContext` field (no FK), so DB-level cascade does not reach
 * them. Deleting an assessment used to call saveQuickObs(cid, obs) which
 * is bare LS-only — server rows survived with stale assessmentId and
 * reappeared on reload. This file pins the new helper that filters LS +
 * dispatches delete_observation per affected observation.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const CID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_AID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OB_1 = '11111111-1111-4111-8111-111111111111';
const OB_2 = '22222222-2222-4222-8222-222222222222';
const OB_OTHER = '33333333-3333-4333-8333-333333333333';

function makeRpcRecorder() {
  var calls = [];
  return {
    calls: calls,
    rpc: function (name, payload) {
      calls.push({ name: name, payload: payload });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

describe('Persistence: deleteAssessmentObservations (P6.5)', () => {
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    if (_cache.observations[CID] !== undefined) _cache.observations[CID] = undefined;
    localStorage.clear();
    globalThis.COURSES = {};
    globalThis.COURSES[CID] = { id: CID, name: 'A' };
    // Seed three observations: two linked to AID, one to OTHER_AID.
    saveQuickObs(CID, {
      's-1': [
        { id: OB_1, text: 'Linked to AID', assignmentContext: { assessmentId: AID } },
        { id: OB_OTHER, text: 'Linked to OTHER_AID', assignmentContext: { assessmentId: OTHER_AID } },
      ],
      's-2': [{ id: OB_2, text: 'Also AID', assignmentContext: { assessmentId: AID } }],
    });
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  it('removes only observations whose assignmentContext matches the deleted aid', () => {
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;

    var n = deleteAssessmentObservations(CID, AID);
    expect(n).toBe(2);

    var remaining = getQuickObs(CID);
    expect(remaining['s-1']).toHaveLength(1);
    expect(remaining['s-1'][0].id).toBe(OB_OTHER);
    expect(remaining['s-2']).toHaveLength(0);
  });

  it('dispatches delete_observation RPC for each removed observation with a UUID', () => {
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;

    deleteAssessmentObservations(CID, AID);

    var deletes = client.calls.filter(function (c) {
      return c.name === 'delete_observation';
    });
    expect(deletes).toHaveLength(2);
    var deletedIds = deletes
      .map(function (c) {
        return c.payload.p_id;
      })
      .sort();
    expect(deletedIds).toEqual([OB_1, OB_2].sort());
    // OTHER_AID's observation must NOT have been deleted.
    expect(deletedIds).not.toContain(OB_OTHER);
  });

  it('returns 0 and dispatches no RPCs when no observations match the aid', () => {
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;

    var n = deleteAssessmentObservations(CID, 'nonexistent-aid');
    expect(n).toBe(0);
    expect(client.calls.filter(c => c.name === 'delete_observation')).toHaveLength(0);
  });

  it('skips delete_observation RPC for observations with non-UUID ids', () => {
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;
    // Add an observation with a local string id (not yet synced).
    saveQuickObs(CID, {
      's-1': [
        { id: 'local-obs-abc', text: 'Local obs', assignmentContext: { assessmentId: AID } },
        { id: OB_1, text: 'Canonical obs', assignmentContext: { assessmentId: AID } },
      ],
    });

    var n = deleteAssessmentObservations(CID, AID);
    expect(n).toBe(2); // Both removed from LS.

    var deletes = client.calls.filter(function (c) {
      return c.name === 'delete_observation';
    });
    // Only the UUID one should hit the canonical store.
    expect(deletes).toHaveLength(1);
    expect(deletes[0].payload.p_id).toBe(OB_1);
  });

  it('does not dispatch RPCs in demo mode', () => {
    localStorage.setItem('gb-demo-mode', '1');
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;

    var n = deleteAssessmentObservations(CID, AID);
    expect(n).toBe(2); // LS still cleaned.
    expect(client.calls.filter(c => c.name === 'delete_observation')).toHaveLength(0);

    localStorage.removeItem('gb-demo-mode');
  });

  it('does not dispatch RPCs when _useSupabase is false', () => {
    _useSupabase = false;
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;

    var n = deleteAssessmentObservations(CID, AID);
    expect(n).toBe(2);
    expect(client.calls.filter(c => c.name === 'delete_observation')).toHaveLength(0);
  });

  it('returns 0 cleanly for falsy inputs', () => {
    expect(deleteAssessmentObservations('', AID)).toBe(0);
    expect(deleteAssessmentObservations(CID, '')).toBe(0);
    expect(deleteAssessmentObservations(null, AID)).toBe(0);
    expect(deleteAssessmentObservations(CID, null)).toBe(0);
  });

  it('integration: silent dataloss regression guard for assessment-delete cascade', () => {
    var client = makeRpcRecorder();
    globalThis.getSupabase = () => client;

    // Before delete: 3 observations across 2 students.
    expect(Object.keys(getQuickObs(CID))).toHaveLength(2);
    var totalBefore = Object.values(getQuickObs(CID)).reduce(function (a, arr) {
      return a + arr.length;
    }, 0);
    expect(totalBefore).toBe(3);

    // Simulate the assignment-delete cascade.
    deleteAssessmentObservations(CID, AID);

    // After delete: AID-linked observations gone from LS, RPCs fired.
    var after = getQuickObs(CID);
    var totalAfter = Object.values(after).reduce(function (a, arr) {
      return a + arr.length;
    }, 0);
    expect(totalAfter).toBe(1);
    expect(after['s-1'][0].id).toBe(OB_OTHER);
    expect(client.calls.filter(c => c.name === 'delete_observation')).toHaveLength(2);
  });
});
