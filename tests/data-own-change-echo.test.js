/**
 * Realtime reports this page's own changes too (write-path audit, finding 15).
 *
 * Every change to a class bumps its version, and the tab that made the
 * change hears about it like every other device. A version the database
 * recorded with this page's client id, one past the version this page has,
 * is this page's own change: the page already holds it, so it doesn't
 * download the class again. Anything else still reloads.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'e0000000-0000-4000-8000-000000000001';

describe('own-change echoes', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var originalHandle;
  var originalClientId;
  var onChange;
  var refreshes;

  beforeEach(async () => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    originalHandle = globalThis._handleExternalCourseUpdate;
    originalClientId = window.__fvClientId;
    _useSupabase = true;
    globalThis.__FV_CLASS_BUNDLE = true;
    window.__fvClientId = 'tab-me';
    _echoNeedsReload = false;
    refreshes = [];
    globalThis._handleExternalCourseUpdate = function (cid, kind) {
      refreshes.push(kind);
      return Promise.resolve();
    };
    var query = {
      select() {
        return query;
      },
      eq() {
        return query;
      },
      maybeSingle() {
        return Promise.resolve({ data: null, error: null });
      },
    };
    globalThis.getSupabase = function () {
      return {
        from() {
          return query;
        },
        channel() {
          var channel = {
            on(type, filter, handler) {
              onChange = handler;
              return channel;
            },
            subscribe() {
              return channel;
            },
          };
          return channel;
        },
        removeChannel() {},
        rpc() {
          return Promise.resolve({ data: null, error: null });
        },
      };
    };
    _unsubscribeCourseSyncCursor();
    await _subscribeCourseSyncCursor(CID);
    _classVersion[CID] = 5;
  });

  afterEach(() => {
    _unsubscribeCourseSyncCursor();
    globalThis.getSupabase = originalGetSupabase;
    globalThis._handleExternalCourseUpdate = originalHandle;
    _useSupabase = originalUseSupabase;
    window.__fvClientId = originalClientId;
    globalThis.__FV_CLASS_BUNDLE = false;
    _echoNeedsReload = false;
    delete _classVersion[CID];
  });

  function change(version, lastClient) {
    onChange({ new: { course_id: CID, version: version, last_client: lastClient } });
  }

  it("doesn't reload for this page's own score", () => {
    _noteOutboxSend({ endpoint: 'upsert_tag_score', fromThisTab: true });
    change(6, 'tab-me');
    change(7, 'tab-me');
    expect(refreshes).toEqual([]);
    expect(_classVersion[CID]).toBe(7);
  });

  it('reloads for a change from another device', () => {
    change(6, 'tab-other');
    expect(refreshes).toEqual(['gradebook']);
    expect(_classVersion[CID]).toBe(5);
  });

  it('reloads when a version was missed in between', () => {
    change(7, 'tab-me');
    expect(refreshes).toEqual(['gradebook']);
  });

  it('reloads for a change with no client id (an older client or the server)', () => {
    change(6, null);
    expect(refreshes).toEqual(['gradebook']);
  });

  it('reloads after a create, which the server fills in', () => {
    _noteOutboxSend({ endpoint: 'create_assessment', fromThisTab: true });
    change(6, 'tab-me');
    expect(refreshes).toEqual(['gradebook']);
  });

  it('reloads for a write this tab sent for another tab', () => {
    _noteOutboxSend({ endpoint: 'upsert_tag_score', fromThisTab: false });
    change(6, 'tab-me');
    expect(refreshes).toEqual(['gradebook']);
  });
});
