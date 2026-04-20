/**
 * Regression guard — proves initData actually calls the v2 read RPC.
 *
 * This exists because on April 3, 2026 the canonical_schema_foundation migration
 * dropped every legacy public table, and the shared/data.js reads were gated
 * behind an `if (false && _useSupabase)` stub for 16 days. Writes worked, but
 * on sign-in no RPC was fired, localStorage silently filled the gap, and
 * sign-out wiped the cache. Teachers reloaded to empty dashboards.
 *
 * In the v2 rebuild, the boot read is get_gradebook(p_course_id). The old
 * canonical-schema RPCs (list_course_roster, list_course_assessments, etc.)
 * do not exist on gradebook-prod and were never shipped. This file guards
 * against get_gradebook being stubbed out or silently skipped.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';

function makeRecordingClient() {
  var calls = [];
  return {
    calls: calls,
    rpc(name, payload) {
      calls.push({ name: name, payload: payload || {} });
      return Promise.resolve({ data: { students: [], assessments: [], cells: {}, row_summaries: {} }, error: null });
    },
  };
}

describe('initData invokes the v2 get_gradebook RPC', () => {
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

  it('fires get_gradebook on init', async () => {
    var client = makeRecordingClient();
    globalThis.getSupabase = () => client;

    await initData(CID);

    var names = client.calls.map(function (c) { return c.name; });
    expect(names).toContain('get_gradebook');
  });

  it('passes p_course_id to get_gradebook', async () => {
    var client = makeRecordingClient();
    globalThis.getSupabase = () => client;

    await initData(CID);

    var call = client.calls.find(function (c) { return c.name === 'get_gradebook'; });
    expect(call, 'get_gradebook should have been called').toBeDefined();
    expect(call.payload.p_course_id).toBe(CID);
  });

  it('does not silently no-op when Supabase is enabled for a canonical-UUID course', async () => {
    var client = makeRecordingClient();
    globalThis.getSupabase = () => client;

    await initData(CID);

    // The April 3 stub looked like `if (false && _useSupabase) { ...reads... }`
    // which meant zero RPCs fired. This is the bare-minimum assertion that
    // the read path is reachable at all.
    expect(client.calls.length).toBeGreaterThan(0);
  });
});
