/**
 * createCourse timezone default — T-UI-03 (simplified scope)
 *
 * Every new course defaults to Pacific time. No UI picker (per product
 * decision 2026-04-22). The local course object gets timezone set, and
 * the create_course RPC is called with p_timezone.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

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

describe('createCourse timezone default', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    _teacherId = 'teacher-uuid';
    localStorage.clear();
    for (var k in COURSES) delete COURSES[k];
    client = makeRecordingClient();
    globalThis.getSupabase = () => client;
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  it('sets timezone to America/Vancouver on the returned course object', () => {
    var course = createCourse({ name: 'Test Class' });
    expect(course.timezone).toBe('America/Vancouver');
  });

  it('passes p_timezone=America/Vancouver to create_course RPC', () => {
    createCourse({ name: 'Test Class' });
    var call = client.calls.find(function (c) {
      return c.name === 'create_course';
    });
    expect(call).toBeDefined();
    expect(call.payload.p_timezone).toBe('America/Vancouver');
  });
});
