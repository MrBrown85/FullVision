/**
 * Persistence custom-tag delete (P6.3) — tests the delete branch added to
 * _persistCustomTagsToCanonical, plus the label→uuid bookkeeping.
 *
 * Background: removeCustomTag was LS-only before this change because the
 * old _persistCustomTagsToCanonical only iterated additions. With the new
 * delete branch, removed labels dispatch delete_custom_tag(p_id) when the
 * uuid is cached, or delete_custom_tag_by_label(course, label) otherwise.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const CID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TAG_FOO_ID = '11111111-1111-4111-8111-111111111111';
const TAG_BAR_ID = '22222222-2222-4222-8222-222222222222';

function makeRpcRecorder(responses) {
  responses = responses || {};
  var calls = [];
  return {
    calls: calls,
    rpc: function (name, payload) {
      calls.push({ name: name, payload: payload });
      var resp = responses[name];
      if (typeof resp === 'function') return Promise.resolve(resp(payload));
      if (resp !== undefined) return Promise.resolve(resp);
      return Promise.resolve({ data: null, error: null });
    },
  };
}

describe('Persistence custom-tag delete (P6.3)', () => {
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    _supabaseDegraded = false;
    _pendingLocalCids.clear();
    Object.keys(_customTagIds).forEach(function (k) {
      delete _customTagIds[k];
    });
    if (_cache.customTags && _cache.customTags[CID] !== undefined) _cache.customTags[CID] = undefined;
    localStorage.clear();
    globalThis.COURSES = {};
    globalThis.COURSES[CID] = { id: CID, name: 'A', gradingSystem: 'proficiency' };
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    Object.keys(_customTagIds).forEach(function (k) {
      delete _customTagIds[k];
    });
  });

  describe('add path caches uuid in _customTagIds', () => {
    it('populates _customTagIds[cid][label] from create_custom_tag response', async () => {
      var client = makeRpcRecorder({
        create_custom_tag: function (payload) {
          return { data: payload.p_label === 'Foo' ? TAG_FOO_ID : TAG_BAR_ID, error: null };
        },
      });
      globalThis.getSupabase = () => client;

      saveCustomTags(CID, ['Foo']);
      // Drain the save queue (microtask fan-out).
      await new Promise(function (r) {
        setTimeout(r, 10);
      });

      expect(_customTagIds[CID]).toBeDefined();
      expect(_customTagIds[CID].Foo).toBe(TAG_FOO_ID);
      expect(client.calls).toHaveLength(1);
      expect(client.calls[0].name).toBe('create_custom_tag');
    });
  });

  describe('delete path with cached uuid', () => {
    it('dispatches delete_custom_tag(p_id) when uuid is cached', async () => {
      var client = makeRpcRecorder({
        create_custom_tag: { data: TAG_FOO_ID, error: null },
        delete_custom_tag: { data: null, error: null },
      });
      globalThis.getSupabase = () => client;

      saveCustomTags(CID, ['Foo']);
      await new Promise(function (r) {
        setTimeout(r, 10);
      });
      expect(_customTagIds[CID].Foo).toBe(TAG_FOO_ID);

      // Now remove "Foo".
      saveCustomTags(CID, []);
      await new Promise(function (r) {
        setTimeout(r, 10);
      });

      var deleteCall = client.calls.find(function (c) {
        return c.name === 'delete_custom_tag';
      });
      expect(deleteCall, 'delete_custom_tag should have been called').toBeDefined();
      expect(deleteCall.payload.p_id).toBe(TAG_FOO_ID);
      // No fallback should fire since uuid was cached.
      expect(client.calls.find(c => c.name === 'delete_custom_tag_by_label')).toBeUndefined();
      // Cache cleared after successful delete.
      expect(_customTagIds[CID].Foo).toBeUndefined();
    });

    it('only dispatches deletes for labels removed (not still-present labels)', async () => {
      var client = makeRpcRecorder({
        create_custom_tag: function (payload) {
          return { data: payload.p_label === 'Foo' ? TAG_FOO_ID : TAG_BAR_ID, error: null };
        },
        delete_custom_tag: { data: null, error: null },
      });
      globalThis.getSupabase = () => client;

      saveCustomTags(CID, ['Foo', 'Bar']);
      await new Promise(function (r) {
        setTimeout(r, 10);
      });

      // Remove Foo, keep Bar.
      saveCustomTags(CID, ['Bar']);
      await new Promise(function (r) {
        setTimeout(r, 10);
      });

      var deletes = client.calls.filter(function (c) {
        return c.name === 'delete_custom_tag';
      });
      expect(deletes).toHaveLength(1);
      expect(deletes[0].payload.p_id).toBe(TAG_FOO_ID);
    });
  });

  describe('delete path with no cached uuid (cross-session fallback)', () => {
    it('falls through to delete_custom_tag_by_label when uuid is unknown', async () => {
      var client = makeRpcRecorder({
        delete_custom_tag_by_label: { data: 1, error: null },
      });
      globalThis.getSupabase = () => client;

      // Simulate cross-session state: LS already has the tag but cache is empty.
      _safeLSSet('gb-custom-tags-' + CID, JSON.stringify(['Foo']));
      _cache.customTags[CID] = ['Foo']; // Simulate hydration.
      // _customTagIds[CID] is empty — no uuid known.

      // User removes "Foo".
      saveCustomTags(CID, []);
      await new Promise(function (r) {
        setTimeout(r, 10);
      });

      var byLabel = client.calls.find(function (c) {
        return c.name === 'delete_custom_tag_by_label';
      });
      expect(byLabel, 'delete_custom_tag_by_label should fire as fallback').toBeDefined();
      expect(byLabel.payload.p_course_id).toBe(CID);
      expect(byLabel.payload.p_label).toBe('Foo');
      // No delete_custom_tag call since we don't have the uuid.
      expect(client.calls.find(c => c.name === 'delete_custom_tag')).toBeUndefined();
    });
  });

  describe('skip conditions', () => {
    it('does not dispatch any RPC when in demo mode', async () => {
      var client = makeRpcRecorder({});
      globalThis.getSupabase = () => client;
      localStorage.setItem('gb-demo-mode', '1');

      saveCustomTags(CID, ['Foo']);
      saveCustomTags(CID, []);
      await new Promise(function (r) {
        setTimeout(r, 10);
      });

      expect(client.calls).toHaveLength(0);
      localStorage.removeItem('gb-demo-mode');
    });

    it('does not dispatch when _useSupabase is false', async () => {
      _useSupabase = false;
      var client = makeRpcRecorder({});
      globalThis.getSupabase = () => client;

      saveCustomTags(CID, ['Foo']);
      saveCustomTags(CID, []);
      await new Promise(function (r) {
        setTimeout(r, 10);
      });

      expect(client.calls).toHaveLength(0);
    });

    it('does not dispatch when cid is not a UUID', async () => {
      var client = makeRpcRecorder({});
      globalThis.getSupabase = () => client;

      saveCustomTags('non-uuid', ['Foo']);
      saveCustomTags('non-uuid', []);
      await new Promise(function (r) {
        setTimeout(r, 10);
      });

      expect(client.calls).toHaveLength(0);
    });
  });

  describe('integration — remove-then-reload regression guard', () => {
    it('removed tag does not leave a canonical row behind (issued delete RPC)', async () => {
      var client = makeRpcRecorder({
        create_custom_tag: { data: TAG_FOO_ID, error: null },
        delete_custom_tag: { data: null, error: null },
      });
      globalThis.getSupabase = () => client;

      // 1. Add a tag → caches uuid.
      addCustomTag(CID, 'Foo');
      await new Promise(function (r) {
        setTimeout(r, 10);
      });
      expect(getCustomTags(CID)).toContain('Foo');

      // 2. Remove the tag → dispatches delete RPC.
      removeCustomTag(CID, 'Foo');
      await new Promise(function (r) {
        setTimeout(r, 10);
      });

      expect(getCustomTags(CID)).not.toContain('Foo');
      var deleted = client.calls.filter(function (c) {
        return c.name === 'delete_custom_tag';
      });
      expect(deleted, 'delete RPC must have fired so canonical row is removed').toHaveLength(1);
      expect(deleted[0].payload.p_id).toBe(TAG_FOO_ID);
    });
  });
});
