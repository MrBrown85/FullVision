/**
 * Regression guard — proves initData actually calls the canonical read RPCs.
 *
 * This exists because on April 3, 2026 the canonical_schema_foundation migration
 * dropped every legacy public table, and the shared/data.js reads were gated
 * behind an `if (false && _useSupabase)` stub for 16 days. Writes worked, but
 * on sign-in no RPC was fired, localStorage silently filled the gap, and
 * sign-out wiped the cache. Teachers reloaded to empty dashboards.
 *
 * This test fails the moment the canonical reads get stubbed out, renamed,
 * or otherwise skipped. It does NOT check response shapes (that's what
 * tests/data-pagination.test.js is for) — it only asserts the read actually
 * leaves the client. That's the specific regression that hurt production.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';

const EXPECTED_RPCS = [
  'list_course_roster',
  'list_course_assessments',
  'list_course_scores',
  'list_course_observations',
  'get_course_policy',
  'get_report_config',
  'list_course_outcomes',
  'list_assignment_statuses',
];

function makeRecordingClient() {
  var calls = [];
  return {
    calls: calls,
    rpc(name, payload) {
      calls.push({ name: name, payload: payload || {} });
      return Promise.resolve({ data: [], error: null });
    },
  };
}

describe('initData invokes the canonical read RPCs', () => {
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    localStorage.clear();

    COURSES[CID] = { id: CID, name: 'Science 8', subjectCode: 'SCI8' };
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  it('fires list_course_roster and the other course-scoped canonical reads on init', async () => {
    var client = makeRecordingClient();
    globalThis.getSupabase = () => client;

    await initData(CID);

    var names = client.calls.map(function (c) {
      return c.name;
    });

    EXPECTED_RPCS.forEach(function (rpc) {
      expect(names).toContain(rpc);
    });
  });

  it('passes the course_offering_id to each canonical read', async () => {
    var client = makeRecordingClient();
    globalThis.getSupabase = () => client;

    await initData(CID);

    EXPECTED_RPCS.forEach(function (rpc) {
      var match = client.calls.find(function (c) {
        return c.name === rpc;
      });
      expect(match, rpc + ' should have been called').toBeDefined();
      expect(match.payload.p_course_offering_id).toBe(CID);
    });
  });

  it('does not silently no-op when Supabase is enabled for a canonical-UUID course', async () => {
    var client = makeRecordingClient();
    globalThis.getSupabase = () => client;

    await initData(CID);

    // The April 3 stub looked like `if (false && _useSupabase) { ...reads... }`
    // which meant zero RPCs fired. This is the bare-minimum assertion that
    // the canonical read path is reachable at all.
    expect(client.calls.length).toBeGreaterThan(0);
  });
});
