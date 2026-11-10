/* shared/offline-queue.js — the outbox every write goes through
 *
 * shared/data.js hands each write RPC to push(); nothing writes to Supabase
 * any other way (docs/write-path-plan.md, Phase 1). An entry stays here until
 * the server accepts it, so a write that fails on a network blip, while
 * offline, or while cloud sync is paused is sent later instead of lost.
 *
 * Storage:
 *   fv-sync-queue-v1          — { entries:[...], last_flush_at:iso }
 *   fv-sync-dead-letter-v1    — entries the server rejected
 *   fv-sync-owner-v1          — { tab, at }: which tab sends (fallback only, see Tabs)
 *
 * Entry shape:
 *   { id, created_at, owner, key, endpoint, payload, attempts, last_error, last_code, next_at, blocked_on, sent_at,
 *     no_retry }
 *
 * Tabs: every tab shares the queue, but only one tab — the owner — sends.
 *   The owner holds the Web Lock fv-sync-queue-v1 for as long as it is open;
 *   the browser hands the lock to the next tab when the owner closes, reloads
 *   or is discarded. Where Web Locks are missing, the owner keeps a lease in
 *   fv-sync-owner-v1 alive with a heartbeat and another tab takes a stale one.
 *   The other tabs only queue; they ask the owner to send over the
 *   BroadcastChannel fv-sync-queue-v1 and hear back through the owner's
 *   events, which it posts to every tab, so push() callers, listeners (the
 *   sync dot, shared/data.js's re-keys) and stats() see the same thing in
 *   every tab. sent_at marks an entry the owner has started, so another tab
 *   never replaces or edits it; a new owner clears the marks it inherits.
 *
 * Key: the record the write touches (see _entryKey). Entries with the same
 *   key are sent one at a time, in order; different keys go in parallel.
 *
 * Barrier: a write to a whole column (clear_column_scores, delete_assessment)
 *   has no cell key. It waits for every earlier entry that names its
 *   assessment, and every later entry that names it waits for the barrier
 *   (see _pump). Cell writes in one column still run in parallel with each
 *   other.
 *
 * Restore: an entry naming a record of a class restore (import_json_restore)
 *   still queued ahead of it waits until the restore lands.
 *
 * Blocked: an entry whose payload names a record the server doesn't have yet
 *   (a local id whose create is still queued) carries those ids in
 *   blocked_on and is held, with everything behind it on its key. When the
 *   create lands, shared/data.js calls rewrite() to put the server id into
 *   the waiting payloads and clear blocked_on; the held entries then go.
 *   A reload keeps all of this, because it is in the entry, not in memory.
 *
 * Owner: the signed-in user's id when the entry was queued. The queue lives
 *   in localStorage, so on a shared computer it can outlast a sign-out. An
 *   entry is only ever sent under its owner's session; one owned by someone
 *   else is discarded. Entries queued before owners existed have none and are
 *   sent under whoever is signed in.
 *
 * Retry policy: network errors, timeouts and 5xx retry with backoff
 *   1s / 5s / 30s / 60s for as long as it takes; after SLOW_AFTER attempts
 *   the entry counts as slow (stats().slow) so the page can say so. Anything
 *   else (validation, permission, not found) is moved to the dead letter at
 *   once; retrying would only fail again. A dead-lettered entry doesn't block
 *   the rest of the queue (offline-sync.md decision #2). On the next page
 *   load each one is sent once more (a record deleted elsewhere, a stale
 *   copy and the like can have changed by then); one rejected again is
 *   dropped and reported to Sentry, so a dead letter never outlives a load.
 * Signed out: an expired session that a token refresh could not fix pauses
 *   the whole queue instead of failing the entry. Nothing is sent until
 *   resume(), which shared/supabase.js calls on SIGNED_IN.
 * Cap: 500 entries or ~5 MB serialized, whichever first. An over-cap write
 *   is refused: push() resolves { error: { refused } } and sends nothing.
 * Coalescing: a cell write (COALESCE_ENDPOINTS) replaces a queued, unsent
 *   write to the same target when nothing else on its key is behind it, so a
 *   cell edited three times offline holds one entry.
 *
 * Everything here is a window.v2Queue.* public surface; no new globals.
 */
(function () {
  'use strict';

  var QUEUE_KEY = 'fv-sync-queue-v1';
  var DEAD_KEY = 'fv-sync-dead-letter-v1';
  var MAX_ENTRIES = 500;
  var MAX_BYTES = 5 * 1024 * 1024;
  var SLOW_AFTER = 5; // attempts before an entry counts as slow
  var BACKOFF_MS = [1000, 5000, 30000, 60000];
  var MAX_PARALLEL = 6;
  var AUTO_FLUSH_MS = 60000; // periodic retry while online
  var LOCK_NAME = 'fv-sync-queue-v1'; // Web Lock and BroadcastChannel name
  var LEASE_KEY = 'fv-sync-owner-v1';
  var LEASE_STALE_MS = 15000; // a lease this old belongs to a tab that is gone
  var HEARTBEAT_MS = 5000;
  var FLUSH_REPLY_MS = 10000; // how long a tab waits for the owner to finish a flush

  /* Endpoints that accept `p_idempotency_key` on the server side. The list
   * lives in shared/constants.js (FV_IDEMPOTENT_RPCS) so the queued-write and
   * direct-write paths cannot drift apart; see the warning there before adding
   * one. For each of these the queue passes `entry.id` as the key, so a retry
   * after a network blip — where the server committed but the client missed
   * the 200 — returns the cached row id instead of inserting a duplicate. */
  var IDEMPOTENT_ENDPOINTS = typeof FV_IDEMPOTENT_RPCS !== 'undefined' ? FV_IDEMPOTENT_RPCS : {};

  function _withIdemKey(endpoint, payload, key) {
    if (!IDEMPOTENT_ENDPOINTS[endpoint] || !key) return payload || {};
    var p = {};
    if (payload) for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) p[k] = payload[k];
    p.p_idempotency_key = key;
    return p;
  }

  var _flushing = false;
  var _autoTimer = null;
  var _listeners = [];

  // In-memory state for this page. Entries themselves live in localStorage.
  var _send = null; // (endpoint, payload, options) → Promise<{data, error}>
  var _isPaused = function () {
    return false;
  };
  var _signedOut = false; // paused until resume(): the session expired
  var _inFlight = {}; // entry id → Promise of its settle
  var _waiters = {}; // entry id → [resolve] for push() callers
  var _sendOptions = {}; // entry id → options for _send (not persisted)
  var _retryTimer = null;
  var _counts = { processed: 0, succeeded: 0, deadLettered: 0 };

  // Which tab sends (Tabs, above). Only the owner starts entries.
  var _loadedAt = Date.now();
  var _tabId = _uuid4();
  var _owner = false;
  var _onSend = null; // told about each entry as it goes out (see configure)
  var _released = false; // the page is going away: claim nothing until claim()
  var _usingLocks =
    typeof navigator !== 'undefined' && !!navigator.locks && typeof navigator.locks.request === 'function';
  var _lockAbort = null; // AbortController of a Web Locks request still waiting
  var _lockRelease = null; // resolves the held lock's callback, letting it go
  var _heartbeat = null; // lease refresh / takeover timer (fallback only)
  var _channel = null; // BroadcastChannel to the other tabs
  var _flushReplies = {}; // request id → resolve for a flush() another tab ran

  /* Called once by shared/data.js: how to send (with its session handling)
     and when to hold off (cloud sync paused). */
  function configure(opts) {
    opts = opts || {};
    if (typeof opts.send === 'function') _send = opts.send;
    if (typeof opts.isPaused === 'function') _isPaused = opts.isPaused;
    if (typeof opts.onSend === 'function') _onSend = opts.onSend;
  }

  /* The record a write touches, so writes to one record stay in order. */
  function _entryKey(endpoint, payload) {
    payload = payload || {};
    if (payload.p_enrollment_id && payload.p_assessment_id) {
      return 'cell:' + payload.p_enrollment_id + ':' + payload.p_assessment_id;
    }
    // Return for one student (return_grades names its students as a list) is
    // a write to that student's cell: it goes after the score writes queued
    // for the cell and before any made after it. shared/data.js sends one
    // student to a call for this.
    if (
      endpoint === 'return_grades' &&
      payload.p_assessment_id &&
      Array.isArray(payload.p_enrollment_ids) &&
      payload.p_enrollment_ids.length === 1
    ) {
      return 'cell:' + payload.p_enrollment_ids[0] + ':' + payload.p_assessment_id;
    }
    if (payload.p_id) return 'id:' + payload.p_id;
    if (payload.p_course_id) return 'course:' + payload.p_course_id;
    if (payload.p_enrollment_id) return 'enrollment:' + payload.p_enrollment_id;
    return null;
  }

  /* Writes that act on a whole assessment column. */
  var BARRIER_ENDPOINTS = { clear_column_scores: true, delete_assessment: true };

  /* The assessment an entry touches, or null. Read from the payload each time
     (not stored) so a local id that rewrite() replaces is followed. */
  function _assessmentOf(entry) {
    var p = entry.payload || {};
    if (entry.endpoint === 'delete_assessment') return p.p_id || p.p_assessment_id || null;
    return p.p_assessment_id || null;
  }

  function _isBarrier(entry) {
    return !!BARRIER_ENDPOINTS[entry.endpoint];
  }

  /* A class restore (import_json_restore) writes a whole class, with ids
     made on this device, in one transaction. A write naming any of those
     records waits until the restore lands; sent first, it would find
     nothing and fail. The ids are every row id in the payload. */
  var _restoreIdsByEntry = {};

  function _restoredIds(entry) {
    if (entry.endpoint !== 'import_json_restore') return null;
    if (_restoreIdsByEntry[entry.id]) return _restoreIdsByEntry[entry.id];
    var ids = {};
    var tables = (entry.payload && entry.payload.p_payload) || {};
    Object.keys(tables).forEach(function (name) {
      if (!Array.isArray(tables[name])) return;
      tables[name].forEach(function (row) {
        if (row && typeof row.id === 'string') ids[row.id] = true;
      });
    });
    _restoreIdsByEntry[entry.id] = ids;
    return ids;
  }

  function _namesAny(entry, ids) {
    var p = entry.payload || {};
    return Object.keys(p).some(function (name) {
      var v = p[name];
      if (typeof v === 'string') return !!ids[v];
      return (
        Array.isArray(v) &&
        v.some(function (x) {
          return typeof x === 'string' && !!ids[x];
        })
      );
    });
  }

  /* Return (return_grades) gives a student what a cell holds when it lands,
     so it must land after every earlier write that can change that cell, and
     before every later one. Writes to the cell itself share its key and stay
     in order that way. The rest are writes to the whole student (every score
     of theirs cleared) or the whole piece of work (its scores moved to a
     copy of its rubric, the work edited, its column cleared): they have
     another key or none, so _pump holds a Return behind an earlier one of
     them, and one of them behind an earlier Return. A write to another cell
     (another student's score or Return on the same work) holds nothing. */
  function _returnOf(entry) {
    var p = entry.payload || {};
    if (entry.endpoint !== 'return_grades' || !p.p_assessment_id) return null;
    var ids = {};
    ids[p.p_assessment_id] = true;
    (Array.isArray(p.p_enrollment_ids) ? p.p_enrollment_ids : []).forEach(function (sid) {
      if (typeof sid === 'string') ids[sid] = true;
    });
    return ids;
  }
  function _isCellWrite(entry) {
    return typeof entry.key === 'string' && entry.key.indexOf('cell:') === 0;
  }

  function _isTransient(res) {
    if (!res) return true;
    var err = res.error;
    if (!err) return false;
    var status = Number(res.status || err.status || err.statusCode || 0);
    if (status >= 500 || status === 401 || status === 408 || status === 429) return true;
    var text = [err.code, err.message, err.name, typeof err === 'string' ? err : ''].join(' ');
    return /network|fetch|failed to connect|ECONNREFUSED|timed? ?out|load failed|no_supabase|jwt expired|PGRST301/i.test(
      text,
    );
  }

  /* An expired session the auth guard could not refresh. Retrying won't help
     until the teacher signs in again, so the queue pauses instead. */
  function _isSessionExpired(res) {
    var err = res && res.error;
    if (!err) return false;
    if (err.handledSessionExpired) return true;
    var status = Number(res.status || err.status || err.statusCode || 0);
    if (status === 401) return true;
    var text = [err.code, err.message].join(' ');
    return /jwt expired|PGRST301|session_expired/i.test(text);
  }

  /* Cell writes where a later write replaces an earlier one outright. */
  var COALESCE_ENDPOINTS = {
    upsert_score: true,
    upsert_tag_score: true,
    upsert_rubric_score: true,
    set_score_status: true,
    save_score_comment: true,
    save_score_report_note: true,
    set_rubric_printed: true,
  };

  /* Params a cell write may leave null to mean "keep the saved one": the
     server keeps the comment or Went Beyond when it is null and clears it
     when it is ''. A replacement takes these from the write it replaces when
     it leaves them null, so a comment cleared offline isn't kept again by a
     level change queued after it. */
  var KEEP_WHEN_NULL = {
    upsert_tag_score: ['p_comment'],
    upsert_rubric_score: ['p_comment', 'p_beyond'],
  };
  function _carryKept(entry, replaced) {
    var kept = KEEP_WHEN_NULL[entry.endpoint];
    if (!kept) return entry.payload;
    var payload = Object.assign({}, entry.payload);
    kept.forEach(function (k) {
      if (payload[k] == null && replaced.payload && replaced.payload[k] != null) payload[k] = replaced.payload[k];
    });
    return payload;
  }

  /* The record and field a write sets: endpoint plus every id param. Two
     writes with the same target set the same thing, so the later one
     replaces the earlier. Writes that add rows (create, duplicate, import,
     bulk) have no target: two of them are two rows. */
  function _target(endpoint, payload) {
    if (!endpoint || /^(create|duplicate|import|bulk|restore|relink|apply)_/.test(endpoint)) return null;
    payload = payload || {};
    var keys = Object.keys(payload).sort();
    var ids = [];
    keys.forEach(function (k) {
      if (k !== 'p_idempotency_key' && /^p_(.+_)?ids?$/.test(k)) ids.push(k + '=' + JSON.stringify(payload[k]));
    });
    // A term rating is one row per enrollment and term.
    if (endpoint === 'save_term_rating') ids.push('p_term=' + JSON.stringify(payload.p_term));
    // A new personal-bank template has no id yet (p_id null): it is the
    // template with this text, not every new template.
    if (endpoint === 'save_comment_template' && payload.p_id == null) {
      ids.push('p_text=' + JSON.stringify(payload.p_text));
    }
    if (!ids.length) return null;
    return endpoint + '|' + ids.join('&');
  }

  /* The fields a write sets on its target, for writes that send only the
     fields that changed (save_term_rating's p_payload, update_course's
     p_patch); null when a write sets the whole record. */
  function _fields(entry) {
    var param = entry && FIELDS_PARAM[entry.endpoint];
    if (!param) return null;
    var p = entry.payload && entry.payload[param];
    if (!p || typeof p !== 'object') return [];
    // A class-settings write sets only the fields it names once it says so
    // (shared/data.js FV_SETTINGS_CHANGED_ONLY). One without the mark is
    // from an earlier build, or is the student page's two settings: it is
    // replaced whole, as it always was.
    if (entry.endpoint === 'update_course' && !p[CHANGED_ONLY]) return null;
    return Object.keys(p).filter(function (k) {
      return k !== CHANGED_ONLY;
    });
  }
  // The param that holds the fields, for each write that sends only those.
  var FIELDS_PARAM = { save_term_rating: 'p_payload', update_course: 'p_patch' };
  var CHANGED_ONLY = '_changed_only';

  /* What is left of an older failed write once a newer write to the same
     target is queued or lands: the older one itself when the targets differ,
     null when the newer one sets everything it set, else a copy without the
     fields the newer one sets. A term-rating habits save leaves a failed
     narrative, approval or IE save alone, and a newer narrative takes the
     narrative out of a failed one, so the older value is never applied
     after the newer one. */
  function _without(newer, older) {
    var target = _target(newer.endpoint, newer.payload);
    if (!target || _target(older.endpoint, older.payload) !== target) return older;
    var mine = _replacedFields(newer);
    // Either one sets its whole record: nothing of the older is left.
    if (!mine || !_fields(older)) return null;
    return _withoutKeys(older, mine);
  }

  /* An approval and its draft_meta belong to the narrative they were made
     with: a newer narrative replaces them too, unless it carries its own. */
  var NARRATIVE_BOUND = ['approved', 'draft_meta'];
  function _replacedFields(newer) {
    var mine = _fields(newer);
    if (!mine || mine.indexOf('narrative_html') < 0) return mine;
    return mine.concat(
      NARRATIVE_BOUND.filter(function (k) {
        return mine.indexOf(k) < 0;
      }),
    );
  }

  /* A term-rating write without these fields: itself when it sets none of
     them, null when nothing is left, else a copy. */
  function _withoutKeys(entry, keys) {
    var theirs = _fields(entry);
    var left = theirs.filter(function (k) {
      return keys.indexOf(k) < 0;
    });
    if (!left.length) return null;
    if (left.length === theirs.length) return entry;
    var param = FIELDS_PARAM[entry.endpoint];
    var whole = entry.payload[param];
    var wire = {};
    left.forEach(function (k) {
      wire[k] = whole[k];
    });
    if (whole[CHANGED_ONLY]) wire[CHANGED_ONLY] = whole[CHANGED_ONLY];
    var payload = Object.assign({}, entry.payload);
    payload[param] = wire;
    return Object.assign({}, entry, { payload: payload });
  }

  /* A new narrative queued for a term rating takes the approval out of the
     older saves still waiting to go for that row, so the approval made with
     the old narrative never lands on the new one. A save left with no field
     still goes, as an empty one, so whoever waits on it hears back. */
  function _unapproveQueued(entries, entry) {
    var mine = _fields(entry);
    if (!mine || mine.indexOf('narrative_html') < 0) return;
    var target = _target(entry.endpoint, entry.payload);
    var drop = NARRATIVE_BOUND.filter(function (k) {
      return mine.indexOf(k) < 0;
    });
    if (!target || !drop.length) return;
    entries.forEach(function (e, i) {
      if (_isInFlight(e) || _target(e.endpoint, e.payload) !== target) return;
      var left = _withoutKeys(e, drop);
      if (left === e) return;
      if (!left) left = Object.assign({}, e, { payload: Object.assign({}, e.payload, { p_payload: {} }) });
      entries[i] = left;
    });
  }

  /* The failed writes with what a newer write replaces taken out. */
  function _pruneDead(dead, newer) {
    return dead
      .map(function (e) {
        return _without(newer, e);
      })
      .filter(Boolean);
  }

  function _sameSet(a, b) {
    a = Array.isArray(a) ? a.slice().sort() : [];
    b = Array.isArray(b) ? b.slice().sort() : [];
    return a.join('\u0000') === b.join('\u0000');
  }

  function _uuid4() {
    // RFC4122 v4 via crypto if available
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto && crypto.getRandomValues
      ? crypto.getRandomValues(b)
      : b.forEach(function (_, i) {
          b[i] = Math.floor(Math.random() * 256);
        });
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map
      .call(b, function (x) {
        return (x < 16 ? '0' : '') + x.toString(16);
      })
      .join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /* The signed-in user's id, read synchronously from the Supabase session
     that supabase-js keeps in localStorage (sb-<project>-auth-token). */
  function currentOwner() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || !/^sb-.*-auth-token$/.test(key)) continue;
        var session = JSON.parse(localStorage.getItem(key));
        var user = session && (session.user || (session.currentSession && session.currentSession.user));
        if (user && user.id) return user.id;
      }
    } catch (e) {
      /* unreadable session → treat as signed out */
    }
    return null;
  }

  function _isForeign(entry, owner) {
    return !!(entry && entry.owner && owner && entry.owner !== owner);
  }

  /* Drop queued and dead-lettered entries that belong to another user. */
  function _discardForeign(owner) {
    if (!owner) return 0;
    var q = _readQueue();
    var keep = q.entries.filter(function (e) {
      return !_isForeign(e, owner);
    });
    var d = _readDead();
    var keepDead = d.filter(function (e) {
      return !_isForeign(e, owner);
    });
    var dropped = q.entries.length - keep.length + (d.length - keepDead.length);
    if (keep.length !== q.entries.length) {
      q.entries = keep;
      _writeQueue(q);
    }
    if (keepDead.length !== d.length) _writeDead(keepDead);
    return dropped;
  }

  function _readQueue() {
    try {
      var raw = localStorage.getItem(QUEUE_KEY);
      if (!raw) return { entries: [], last_flush_at: null };
      var obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.entries)) return { entries: [], last_flush_at: null };
      return obj;
    } catch (e) {
      console.warn('[v2Queue] read parse failed, resetting:', e);
      try {
        localStorage.removeItem(QUEUE_KEY);
      } catch (_) {}
      return { entries: [], last_flush_at: null };
    }
  }

  function _writeQueue(q) {
    var s = JSON.stringify(q);
    if (s.length > MAX_BYTES) throw new Error('queue over size cap');
    try {
      localStorage.setItem(QUEUE_KEY, s);
    } catch (e) {
      console.warn('[v2Queue] write failed (storage full?):', e);
      throw e;
    }
  }

  function _readDead() {
    try {
      var raw = localStorage.getItem(DEAD_KEY);
      return raw ? JSON.parse(raw) || [] : [];
    } catch (e) {
      console.warn('[v2Queue] dead-letter parse failed, resetting:', e);
      try {
        localStorage.removeItem(DEAD_KEY);
      } catch (_) {}
      return [];
    }
  }

  function _writeDead(arr) {
    try {
      localStorage.setItem(DEAD_KEY, JSON.stringify(arr || []));
    } catch (e) {
      console.warn('[v2Queue] dead-letter write failed:', e);
    }
  }

  function _notifyLocal(kind, meta) {
    var snapshot = stats();
    _listeners.slice().forEach(function (listener) {
      try {
        listener({
          kind: kind || 'update',
          meta: meta || null,
          stats: snapshot,
        });
      } catch (e) {
        console.warn('[v2Queue] subscriber failed:', e);
      }
    });
  }

  /* Events any tab may raise, and every other tab needs to hear: they change
     queued entries or settle push() callers in the tab that queued them. The
     owner's events all go out; a follower's enqueue stays local, the owner
     learns of it from the flush request that follows. */
  var ANY_TAB_EVENTS = { coalesce: true, clear: true, remove: true, rewrite: true, 'dead-letter:dismiss': true };

  function _notify(kind, meta) {
    _notifyLocal(kind, meta);
    if (_owner || ANY_TAB_EVENTS[kind]) _post({ type: 'event', kind: kind || 'update', meta: meta || null });
  }

  /* ── Tabs ─────────────────────────────────────────────────────────────── */

  function _post(msg) {
    if (!_channel) return;
    try {
      _channel.postMessage(msg);
    } catch (e) {
      /* channel closed */
    }
  }

  function _openChannel() {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      _channel = new BroadcastChannel(LOCK_NAME);
      _channel.onmessage = function (event) {
        _onMessage(event && event.data);
      };
    } catch (e) {
      _channel = null;
    }
  }

  function _onMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'event') {
      _onRemoteEvent(msg.kind, msg.meta);
    } else if (msg.type === 'flushed') {
      var reply = _flushReplies[msg.req];
      if (reply) {
        delete _flushReplies[msg.req];
        reply(msg.result);
      }
    } else if (msg.type === 'released') {
      if (!_owner && !_released) claim();
    } else if (msg.type === 'flush' && _owner) {
      if (msg.req) {
        flush().then(function (result) {
          _post({ type: 'flushed', req: msg.req, result: result });
        });
      } else {
        _pump(!!msg.force);
      }
    } else if (msg.type === 'resume' && _owner) {
      resume();
    }
  }

  /* Something happened in another tab's copy of the queue: the owner sent an
     entry, or a tab replaced, removed or cleared one. Mirror what this tab's
     listeners and push() callers would have seen had it happened here. */
  function _onRemoteEvent(kind, meta) {
    meta = meta || {};
    if (kind === 'flush:start') _flushing = true;
    else if (kind === 'flush:end') _flushing = false;
    else if (kind === 'paused:auth') _signedOut = true;
    else if (kind === 'resume') _signedOut = false;
    else if (kind === 'coalesce' && meta.from && meta.to && _waiters[meta.from]) {
      _waiters[meta.to] = _waiters[meta.from].concat(_waiters[meta.to] || []);
      delete _waiters[meta.from];
      delete _sendOptions[meta.from];
    }
    _notifyLocal(kind, meta);
    if (kind === 'flush:success') {
      _resolveWaiters(meta.id, { data: meta.data === undefined ? null : meta.data, error: null });
    } else if (kind === 'flush:dead-letter') {
      _resolveWaiters(meta.id, meta.result || { data: null, error: { message: meta.error } });
    } else if (kind === 'remove') {
      _resolveWaiters(meta.id, { data: null, error: { message: 'cancelled', cancelled: true } });
    } else if (kind === 'clear') {
      Object.keys(_waiters).forEach(function (id) {
        _resolveWaiters(id, { data: null, error: { message: 'outbox cleared' } });
      });
    } else if (kind === 'rewrite' && _owner) {
      _pump(false);
    }
  }

  /* Become the tab that sends, now or when the current owner lets go. Called
     at load and on pageshow; tests call it to hand the queue back. */
  function claim() {
    _released = false;
    if (_owner) return;
    if (!_usingLocks) {
      _startHeartbeat();
      _claimLease();
      return;
    }
    if (_lockAbort) return; // already waiting for the lock
    var controller = typeof AbortController === 'function' ? new AbortController() : { abort: function () {} };
    _lockAbort = controller;
    navigator.locks
      .request(LOCK_NAME, controller.signal ? { signal: controller.signal } : {}, function () {
        if (_lockAbort === controller) _lockAbort = null;
        if (_released) return; // pagehide got here first: give it straight back
        _becomeOwner();
        return new Promise(function (resolve) {
          _lockRelease = resolve;
        });
      })
      .catch(function () {
        // Aborted by release() before it was granted.
        if (_lockAbort === controller) _lockAbort = null;
      });
  }

  /* This tab stops sending (pagehide, or a test closing a tab): the lock or
     lease goes to the next tab. Entries already in flight still settle. */
  function release() {
    _released = true;
    _owner = false;
    if (_lockAbort) {
      _lockAbort.abort();
      _lockAbort = null;
    }
    if (_lockRelease) {
      _lockRelease();
      _lockRelease = null;
    }
    if (_heartbeat) {
      clearInterval(_heartbeat);
      _heartbeat = null;
    }
    if (_leaseIsMine()) {
      try {
        localStorage.removeItem(LEASE_KEY);
      } catch (e) {
        /* ignore */
      }
      _post({ type: 'released' });
    }
  }

  function _becomeOwner() {
    _owner = true;
    _clearSentMarks();
    // A flush() this tab asked the old owner for is now its own to run.
    var asked = _flushReplies;
    _flushReplies = {};
    var reqs = Object.keys(asked);
    if (reqs.length) {
      flush().then(function (result) {
        reqs.forEach(function (req) {
          asked[req](result);
        });
      });
      return;
    }
    // The first flush waits for the page to finish booting (shared/data.js
    // configures the outbox then); a takeover later on sends at once.
    if (navigator.onLine) setTimeout(flush, Math.max(0, 2000 - (Date.now() - _loadedAt)));
  }

  /* Marks left by an owner that closed mid-send; this owner has nothing in
     flight yet, so every entry is free to go again. */
  function _clearSentMarks() {
    var q = _readQueue();
    var changed = false;
    q.entries.forEach(function (e) {
      if (e.sent_at) {
        delete e.sent_at;
        changed = true;
      }
    });
    if (!changed) return;
    try {
      _writeQueue(q);
    } catch (e) {
      /* ignore */
    }
  }

  /* Started by the owner, in this tab (its promise) or another (its mark). */
  function _isInFlight(entry) {
    return !!(entry && (_inFlight[entry.id] || (!_owner && entry.sent_at)));
  }

  /* Lease fallback for browsers without Web Locks. */
  function _readLease() {
    try {
      return JSON.parse(localStorage.getItem(LEASE_KEY)) || null;
    } catch (e) {
      return null;
    }
  }

  function _leaseIsMine() {
    var lease = _readLease();
    return !!(lease && lease.tab === _tabId);
  }

  function _leaseIsStale() {
    var lease = _readLease();
    return !lease || !(Date.now() - (lease.at || 0) < LEASE_STALE_MS);
  }

  function _writeLease() {
    try {
      localStorage.setItem(LEASE_KEY, JSON.stringify({ tab: _tabId, at: Date.now() }));
    } catch (e) {
      /* ignore */
    }
  }

  /* Take the lease when nobody holds it or its holder stopped refreshing. */
  function _claimLease() {
    if (_released) return false;
    if (!_leaseIsMine() && !_leaseIsStale()) return false;
    _writeLease();
    if (!_owner) _becomeOwner();
    return true;
  }

  function _startHeartbeat() {
    if (_heartbeat) return;
    _heartbeat = setInterval(function () {
      if (_owner) {
        if (_leaseIsMine()) _writeLease();
        else _owner = false; // another tab took over while this one slept
      } else if (_leaseIsStale() && _readLease()) {
        _claimLease();
      }
    }, HEARTBEAT_MS);
  }

  /* A tab that doesn't send asks the owner to. */
  function _askOwner(force) {
    if (!_usingLocks) _claimLease();
    if (_owner) return _pump(force);
    _post({ type: 'flush', force: !!force });
  }

  /* flush() from a tab that doesn't send: the owner runs it and reports
     back; if no owner answers (none yet, or it just closed), give up after
     FLUSH_REPLY_MS so a sign-out isn't held up. */
  function _delegateFlush() {
    var none = { processed: 0, succeeded: 0, deadLettered: 0 };
    if (!navigator.onLine) return Promise.resolve(Object.assign({ note: 'offline' }, none));
    if (!_usingLocks && _claimLease()) return flush();
    if (!_readQueue().entries.length) return Promise.resolve(Object.assign({ note: 'empty' }, none));
    var req = _uuid4();
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        delete _flushReplies[req];
        resolve(Object.assign({ note: 'delegated' }, none));
      }, FLUSH_REPLY_MS);
      _flushReplies[req] = function (result) {
        clearTimeout(timer);
        resolve(result || Object.assign({ note: 'delegated' }, none));
      };
      _post({ type: 'flush', force: true, req: req });
    });
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {};
    _listeners.push(listener);
    return function unsubscribe() {
      _listeners = _listeners.filter(function (fn) {
        return fn !== listener;
      });
    };
  }

  /* Enqueue a write. endpoint = RPC name, payload = RPC params object.
     If opts.id is provided it is used as the entry id (and therefore the
     idempotency key); otherwise a fresh UUID is generated.
     Returns { ok, id, reason?, replaced? }. Caller should update its
     optimistic cache AFTER receiving ok:true. `replaced` names the entry a
     cell write took the place of (see _coalesceIndex). */
  function enqueue(endpoint, payload, opts) {
    if (!endpoint || typeof endpoint !== 'string') {
      return { ok: false, reason: 'invalid_endpoint' };
    }
    var q = _readQueue();
    var entry = {
      id: (opts && opts.id) || _uuid4(),
      created_at: new Date().toISOString(),
      owner: currentOwner(),
      tab: _tabId,
      key: (opts && opts.key) || _entryKey(endpoint, payload),
      endpoint: endpoint,
      payload: payload || {},
      attempts: 0,
      last_error: null,
    };
    if (opts && Array.isArray(opts.blockedOn) && opts.blockedOn.length) entry.blocked_on = opts.blockedOn.slice();
    // A replacement doesn't grow the queue, so a full queue still takes it.
    var at = _coalesceIndex(q.entries, entry);
    var replaced = at >= 0 ? q.entries[at] : null;
    if (!replaced && q.entries.length >= MAX_ENTRIES) {
      return { ok: false, reason: 'queue_full' };
    }
    if (replaced) {
      // The replacement keeps its own id: the old one may already have
      // reached the server on an attempt whose answer was lost, and an
      // idempotency key can't carry a new value.
      entry.payload = _carryKept(entry, replaced);
      q.entries[at] = entry;
    } else {
      _unapproveQueued(q.entries, entry);
      q.entries.push(entry);
    }
    try {
      _writeQueue(q);
    } catch (e) {
      return { ok: false, reason: 'storage_full' };
    }
    if (replaced) {
      if (_waiters[replaced.id]) {
        _waiters[entry.id] = _waiters[replaced.id].concat(_waiters[entry.id] || []);
        delete _waiters[replaced.id];
      }
      delete _sendOptions[replaced.id];
      _notify('coalesce', { from: replaced.id, to: entry.id, endpoint: entry.endpoint });
    }
    _notify('enqueue', { id: entry.id, endpoint: entry.endpoint });
    // Kick off a flush attempt if we came online.
    if (navigator.onLine && !(opts && opts.noFlush)) setTimeout(flush, 0);
    return replaced ? { ok: true, id: entry.id, replaced: replaced.id } : { ok: true, id: entry.id };
  }

  /* Where a new cell write can take the place of a queued one: the last
     entry on its key, not started, same endpoint and target, waiting on the
     same local ids. Replacing the last entry on a key in place sends the
     same thing in the same order as appending after it. -1 when none. */
  function _coalesceIndex(entries, entry) {
    if (!entry.key || !COALESCE_ENDPOINTS[entry.endpoint]) return -1;
    var target = _target(entry.endpoint, entry.payload);
    if (!target) return -1;
    var assessment = _assessmentOf(entry);
    for (var i = entries.length - 1; i >= 0; i--) {
      var e = entries[i];
      // A column write between the two keeps them apart: the later score must
      // not move to before it.
      if (assessment && _isBarrier(e) && _assessmentOf(e) === assessment) return -1;
      if (e.key !== entry.key) continue;
      if (_isInFlight(e) || e.endpoint !== entry.endpoint || e.owner !== entry.owner) return -1;
      if (_target(e.endpoint, e.payload) !== target) return -1;
      if (!_sameSet(e.blocked_on, entry.blocked_on)) return -1;
      return i;
    }
    return -1;
  }

  /* The write path. Queues the write and sends it as soon as nothing ahead of
     it touches the same record. Resolves with the server's final answer —
     after any retries — so callers can act on the real outcome (for example
     re-keying a local id). While offline or paused it stays pending.
     If the outbox is full (or storage is), nothing is sent: a direct send
     would skip the per-record order and fail anyway offline. The promise
     resolves { error: { refused } } and carries .refused synchronously, so
     the caller can refuse the edit before it claims the server has it.
     opts.id names the entry (the caller's pending-create record uses it);
     opts.blockedOn lists local ids the payload still carries. */
  function push(endpoint, payload, opts) {
    opts = opts || {};
    payload = payload || {};
    var id = opts.id || payload.p_idempotency_key || _uuid4();
    var queued = enqueue(endpoint, payload, { id: id, key: opts.key, blockedOn: opts.blockedOn, noFlush: true });
    if (!queued.ok) {
      var refused = Promise.resolve({
        data: null,
        error: { message: queued.reason, refused: queued.reason },
      });
      refused.refused = queued.reason;
      return refused;
    }
    if (opts.sendOptions) _sendOptions[id] = opts.sendOptions;
    return new Promise(function (resolve) {
      (_waiters[id] = _waiters[id] || []).push(resolve);
      _pump(false);
    });
  }

  function _sendNow(endpoint, payload, options) {
    if (_send) return Promise.resolve(_send(endpoint, payload, options));
    var sb = typeof getSupabase === 'function' ? getSupabase() : null;
    if (!sb) return Promise.resolve({ data: null, error: { message: 'no_supabase' } });
    return Promise.resolve(sb.rpc(endpoint, payload));
  }

  async function _runEntry(entry) {
    var sb = typeof getSupabase === 'function' ? getSupabase() : null;
    if (!sb) return { data: null, error: { message: 'no_supabase' } };
    try {
      // Inject p_idempotency_key for retrofitted endpoints so a retry after
      // a blip (server committed, client missed the 200) replays to the
      // cached result instead of creating a duplicate row.
      var payload = _withIdemKey(entry.endpoint, entry.payload, entry.id);
      // The sender is told when this is the one more try after a reload.
      var options = entry.last_try ? Object.assign({}, _sendOptions[entry.id], { lastTry: true }) : _sendOptions[entry.id];
      var res = await _sendNow(entry.endpoint, payload, options);
      return res || { data: null, error: null };
    } catch (e) {
      return { data: null, error: { message: e && e.message ? e.message : String(e) } };
    }
  }

  /* A delete whose row is already gone (deleted elsewhere, or by an earlier
     attempt whose response was lost) has done its job. Seed observation
     templates also report "not found" but genuinely can't be deleted. */
  function _isGoneOnDelete(entry, res) {
    var err = res && res.error;
    if (!err || !/^delete_/.test(entry.endpoint) || entry.endpoint === 'delete_observation_template') return false;
    return err.code === 'P0002' || /not found/i.test(err.message || '');
  }

  function _errorText(res) {
    var err = res && res.error;
    if (!err) return 'unknown error';
    return err.message || err.code || String(err);
  }

  function _resolveWaiters(id, res) {
    var waiters = _waiters[id] || [];
    delete _waiters[id];
    delete _sendOptions[id];
    waiters.forEach(function (resolve) {
      resolve(res);
    });
  }

  function _removeEntry(id) {
    var q = _readQueue();
    q.entries = q.entries.filter(function (e) {
      return e.id !== id;
    });
    return q;
  }

  function _settle(entry, res) {
    delete _inFlight[entry.id];
    _counts.processed++;
    if (_isGoneOnDelete(entry, res)) res = { data: null, error: null };
    if (res && !res.error) {
      var q = _removeEntry(entry.id);
      q.last_flush_at = new Date().toISOString();
      _writeQueue(q);
      _counts.succeeded++;
      _dropDeadFor(entry);
      // Listeners see the result before the push() caller does, so a re-key
      // driven from here is finished by the time the caller's .then runs.
      _notify('flush:success', {
        id: entry.id,
        endpoint: entry.endpoint,
        key: entry.key,
        payload: entry.payload,
        data: res.data,
      });
      _resolveWaiters(entry.id, res);
      if (_restoreIdsByEntry[entry.id]) {
        delete _restoreIdsByEntry[entry.id];
        // The writes a restore held go on the next turn, after its caller
        // has applied what the server returned (backup-restore.js).
        setTimeout(function () {
          _pump(false);
        }, 0);
        return;
      }
      _pump(false);
      return;
    }

    // Signed out: hold this entry and everything else until resume(). The
    // write isn't wrong, the session is.
    if (_isSessionExpired(res)) {
      entry.last_error = _errorText(res);
      delete entry.next_at;
      delete entry.sent_at;
      _replaceEntry(entry);
      if (!_signedOut) {
        _signedOut = true;
        _notify('paused:auth', { id: entry.id, endpoint: entry.endpoint });
      }
      return;
    }

    entry.attempts = (entry.attempts || 0) + 1;
    entry.last_error = _errorText(res);
    entry.last_code = (res && res.error && res.error.code) || undefined;
    if (_isTransient(res)) {
      var delay = BACKOFF_MS[Math.min(entry.attempts, BACKOFF_MS.length) - 1];
      entry.next_at = new Date(Date.now() + delay).toISOString();
      delete entry.sent_at;
      _replaceEntry(entry);
      _notify('flush:retry', {
        id: entry.id,
        endpoint: entry.endpoint,
        attempts: entry.attempts,
        error: entry.last_error,
      });
      _scheduleRetry();
      return;
    }

    // One failed write per target: a newer failure replaces an older one.
    // The last try after a reload is dropped instead. A write the sender
    // says must never go again (error.noRetry) gets no last try either.
    if (res && res.error && res.error.noRetry) entry.no_retry = true;
    var dead = _pruneDead(_readDead(), entry);
    if (entry.last_try) _reportDropped(entry);
    else dead.push(entry);
    _writeDead(dead);
    _writeQueue(_removeEntry(entry.id));
    _counts.deadLettered++;
    _notify('flush:dead-letter', {
      id: entry.id,
      endpoint: entry.endpoint,
      key: entry.key,
      payload: entry.payload,
      error: entry.last_error,
      result: res,
    });
    _resolveWaiters(entry.id, res);
    _pump(false);
  }

  /* A write the server rejected twice, given up on. Sentry gets the
     endpoint and the Postgres error code only: the payload holds student
     data, and the server's message can quote an id or a value. */
  function _reportDropped(entry) {
    console.warn('[v2Queue] dropped ' + entry.endpoint + ' after a second rejection: ' + entry.last_error);
    if (window.Sentry && typeof window.Sentry.captureMessage === 'function') {
      var code = /^[0-9A-Z]{5}$/.test(entry.last_code || '') ? ' (' + entry.last_code + ')' : '';
      window.Sentry.captureMessage('Outbox dropped ' + entry.endpoint + code, 'warning');
    }
  }

  /* Write a settled entry back in its place in the queue. */
  function _replaceEntry(entry) {
    var q = _readQueue();
    q.entries = q.entries.map(function (e) {
      return e.id === entry.id ? entry : e;
    });
    _writeQueue(q);
  }

  /* A write to this target landed, so what it sets in older failed writes
     is out of date: retrying that would put back the value it replaced. */
  function _dropDeadFor(entry) {
    if (!_target(entry.endpoint, entry.payload)) return;
    var dead = _readDead();
    var keep = _pruneDead(dead, entry);
    var changed =
      keep.length !== dead.length ||
      keep.some(function (e, i) {
        return e !== dead[i];
      });
    if (!changed) return;
    _writeDead(keep);
    var kept = keep.map(function (e) {
      return e.id;
    });
    dead.forEach(function (e) {
      if (kept.indexOf(e.id) < 0) _notify('dead-letter:dismiss', { id: e.id, superseded: true });
    });
  }

  function _start(entry) {
    // Marked in storage so the other tabs leave it alone while it is out.
    entry.sent_at = new Date().toISOString();
    try {
      _replaceEntry(entry);
    } catch (e) {
      /* storage full: the entry still goes */
    }
    // Before it goes, so the data layer knows before realtime can report it
    // whether the change was made in this tab.
    if (_onSend) {
      try {
        _onSend({ endpoint: entry.endpoint, fromThisTab: entry.tab === _tabId });
      } catch (e) {
        console.warn('[v2Queue] onSend failed:', e);
      }
    }
    var p = _runEntry(entry).then(function (res) {
      _settle(entry, res);
    });
    _inFlight[entry.id] = p;
  }

  function _isBlocked(entry) {
    return !!(entry && Array.isArray(entry.blocked_on) && entry.blocked_on.length);
  }

  /* Start every entry that may go now: the first for its key, due, owned by
     whoever is signed in, not waiting on a local id. `force` ignores backoff
     (an explicit flush). `dueBy` counts entries due by then as due now, for
     a retry timer that fires a little early. A column write goes only when
     no earlier entry names its assessment; an entry behind a column write
     waits for it. A tab that isn't the owner asks the owner instead. */
  function _pump(force, dueBy) {
    if (_owner && !_usingLocks && !_leaseIsMine()) _owner = false; // replaced while asleep
    if (!_owner) return _askOwner(force);
    if (_signedOut || _isPaused() || !navigator.onLine) return;
    var owner = currentOwner();
    var now = Math.max(Date.now(), dueBy || 0);
    var busyKeys = {};
    var touched = {}; // assessment → an earlier entry names it
    var barred = {}; // assessment → an earlier column write is still queued
    var restoring = []; // ids of each earlier class restore still queued
    var returned = []; // the student and work of each earlier Return still queued
    var wide = []; // each earlier write that is not to one cell
    var entries = _readQueue().entries;
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var key = entry.key || entry.id;
      var assessment = _assessmentOf(entry);
      var barrier = _isBarrier(entry);
      var gated = !!assessment && (barrier ? touched[assessment] : barred[assessment]);
      if (assessment) {
        touched[assessment] = true;
        if (barrier) barred[assessment] = true;
      }
      if (
        restoring.some(function (ids) {
          return _namesAny(entry, ids);
        })
      )
        gated = true;
      var restored = _restoredIds(entry);
      if (restored) restoring.push(restored);
      // A Return and a write to its whole student or piece of work go in
      // the order they were made (see _returnOf).
      var giving = _returnOf(entry);
      if (giving) {
        if (
          wide.some(function (w) {
            return _namesAny(w, giving);
          })
        )
          gated = true;
        returned.push(giving);
      } else if (!_isCellWrite(entry)) {
        if (
          returned.some(function (ids) {
            return _namesAny(entry, ids);
          })
        )
          gated = true;
        wide.push(entry);
      }
      if (busyKeys[key]) continue;
      busyKeys[key] = true;
      if (gated) continue;
      if (_inFlight[entry.id]) continue;
      if (_isBlocked(entry)) continue;
      if (_isForeign(entry, owner)) continue;
      // An owned entry with nobody signed in waits for its owner.
      if (entry.owner && !owner) continue;
      if (!force && entry.next_at && Date.parse(entry.next_at) > now) continue;
      if (Object.keys(_inFlight).length >= MAX_PARALLEL) break;
      _start(entry);
    }
  }

  /* Wake when the next entry in backoff is due and send the entries due by
     then, each on its own backoff, then wait for the next one. A failure
     that comes due sooner moves the wake earlier. `after` skips entries due
     at or before it: the last wake already tried them, and one that could
     not go then (offline, held, all slots busy) goes when that changes. */
  function _scheduleRetry(after) {
    if (_retryTimer) clearTimeout(_retryTimer);
    _retryTimer = null;
    var next = null;
    _readQueue().entries.forEach(function (e) {
      if (_inFlight[e.id] || !e.next_at) return;
      var t = Date.parse(e.next_at);
      if (after !== undefined && t <= after) return;
      if (next === null || t < next) next = t;
    });
    if (next === null) return;
    _retryTimer = setTimeout(
      function () {
        _retryTimer = null;
        _pump(false, next);
        _scheduleRetry(next);
      },
      Math.max(0, next - Date.now()),
    );
  }

  /* Settles once nothing is in flight and nothing more can start now. */
  async function _idle() {
    while (true) {
      var pending = Object.keys(_inFlight).map(function (id) {
        return _inFlight[id];
      });
      if (pending.length === 0) return;
      await Promise.all(pending);
    }
  }

  /* Send everything that can go now, ignoring backoff, and wait until it has
     settled. Returns this flush's { processed, succeeded, deadLettered }. */
  async function flush() {
    if (_owner && !_usingLocks && !_leaseIsMine()) _owner = false;
    if (!_owner) return _delegateFlush();
    if (!navigator.onLine) return { processed: 0, succeeded: 0, deadLettered: 0, note: 'offline' };
    if (_isPaused()) return { processed: 0, succeeded: 0, deadLettered: 0, note: 'paused' };
    if (_signedOut) return { processed: 0, succeeded: 0, deadLettered: 0, note: 'signed-out' };
    var before = { processed: _counts.processed, succeeded: _counts.succeeded, deadLettered: _counts.deadLettered };
    _flushing = true;
    _notify('flush:start');
    try {
      var owner = currentOwner();
      if (_discardForeign(owner) > 0) _notify('discard:foreign');
      _pump(true);
      await _idle();
    } finally {
      _flushing = false;
      _notify('flush:end');
    }
    return {
      processed: _counts.processed - before.processed,
      succeeded: _counts.succeeded - before.succeeded,
      deadLettered: _counts.deadLettered - before.deadLettered,
    };
  }

  function stats() {
    var owner = currentOwner();
    var q = _readQueue();
    var d = _readDead();
    q.entries = q.entries.filter(function (e) {
      return !_isForeign(e, owner);
    });
    d = d.filter(function (e) {
      return !_isForeign(e, owner);
    });
    return {
      queued: q.entries.length,
      blocked: q.entries.filter(_isBlocked).length,
      slow: q.entries.filter(function (e) {
        return (e.attempts || 0) >= SLOW_AFTER;
      }).length,
      signedOut: _signedOut,
      deadLettered: d.length,
      lastFlushAt: q.last_flush_at,
      online: !!navigator.onLine,
      flushing: _flushing,
      owner: _owner,
    };
  }

  /* Is this entry still waiting to be sent (queued or in flight)? */
  function has(id) {
    if (_inFlight[id]) return true;
    return _readQueue().entries.some(function (e) {
      return e.id === id;
    });
  }

  /* This teacher's writes to one endpoint still waiting to be sent, oldest
     first, in flight included: copies of { id, payload }. A load reads them
     to lay an unsent change back over what the server sent
     (shared/data.js _unsentCourseChanges). */
  function queued(endpoint) {
    var owner = currentOwner();
    return _readQueue()
      .entries.filter(function (e) {
        return e.endpoint === endpoint && !_isForeign(e, owner);
      })
      .map(function (e) {
        return { id: e.id, payload: JSON.parse(JSON.stringify(e.payload || {})) };
      });
  }

  /* Let the caller change queued payloads, for example to put a server id
     where a local id was. fn(entry) returns { payload, blockedOn } or null
     to leave the entry alone. Entries in flight are skipped. A key that was
     derived from the old payload is derived again from the new one. */
  function rewrite(fn) {
    var q = _readQueue();
    var changed = 0;
    q.entries.forEach(function (entry) {
      if (_isInFlight(entry)) return;
      var next = fn(entry);
      if (!next) return;
      var derived = entry.key === _entryKey(entry.endpoint, entry.payload);
      if (next.payload) entry.payload = next.payload;
      if (derived) entry.key = _entryKey(entry.endpoint, entry.payload);
      if (Array.isArray(next.blockedOn) && next.blockedOn.length) entry.blocked_on = next.blockedOn.slice();
      else delete entry.blocked_on;
      changed++;
    });
    if (changed) {
      _writeQueue(q);
      _notify('rewrite', { count: changed });
      _pump(false);
    }
    return changed;
  }

  /* Drop a queued entry that hasn't been sent, for example a create whose row
     was removed again. Its push() caller gets { error: { cancelled } }. */
  function remove(id) {
    if (_inFlight[id]) return false;
    var q = _readQueue();
    var before = q.entries.length;
    q.entries = q.entries.filter(function (e) {
      return e.id !== id || _isInFlight(e);
    });
    if (q.entries.length === before) return false;
    _writeQueue(q);
    _resolveWaiters(id, { data: null, error: { message: 'cancelled', cancelled: true } });
    _notify('remove', { id: id });
    _pump(false);
    return true;
  }

  /* Drop every queued entry waiting on a local id whose create will never
     land: removed again (silently) or failed (opts.deadLetter, with its
     error, so the loss is visible). Returns how many were dropped. */
  function dropBlockedOn(localId, opts) {
    opts = opts || {};
    var q = _readQueue();
    var dropped = [];
    q.entries = q.entries.filter(function (e) {
      var hit = !_isInFlight(e) && _isBlocked(e) && e.blocked_on.indexOf(localId) >= 0;
      if (hit) dropped.push(e);
      return !hit;
    });
    if (!dropped.length) return 0;
    _writeQueue(q);
    if (opts.deadLetter) {
      var dead = _readDead();
      dropped.forEach(function (e) {
        e.last_error = opts.error || 'the record it belongs to was not created';
        dead.push(e);
      });
      _writeDead(dead);
      _counts.deadLettered += dropped.length;
    }
    dropped.forEach(function (e) {
      var res = { data: null, error: { message: 'cancelled', cancelled: true } };
      _resolveWaiters(e.id, res);
      _notify(opts.deadLetter ? 'flush:dead-letter' : 'remove', {
        id: e.id,
        endpoint: e.endpoint,
        error: e.last_error,
        result: res,
      });
    });
    _pump(false);
    return dropped.length;
  }

  function deadLetter() {
    var owner = currentOwner();
    return _readDead().filter(function (e) {
      return !_isForeign(e, owner);
    });
  }

  /* Signed in again: send what waited. */
  function resume() {
    if (_signedOut) {
      _signedOut = false;
      _notify('resume');
    }
    if (!_owner) _post({ type: 'resume' });
    return flush();
  }

  /* Once per page load: send the signed-in teacher's failed writes once
     more, at the end of the queue, without what a newer queued write also
     sets. One left with nothing to set is out of date, and one that adds a
     row or waited on a create that failed has nothing to retry against;
     those are dropped and reported. Another teacher's stay for
     _discardForeign. */
  function _retryDeadOnLoad() {
    var owner = currentOwner();
    if (!owner) return;
    var dead = _readDead();
    if (!dead.length) return;
    var q = _readQueue();
    var queued = q.entries.slice();
    var keep = [];
    dead.forEach(function (entry) {
      if (_isForeign(entry, owner)) {
        keep.push(entry);
        return;
      }
      var target = _target(entry.endpoint, entry.payload);
      var drop =
        !target || entry.last_try || entry.no_retry || entry.blocked_on || q.entries.length >= MAX_ENTRIES;
      // What a queued write sets is newer: only the rest is retried.
      var rest = entry;
      for (var i = 0; !drop && i < queued.length; i++) {
        rest = _without(queued[i], rest);
        drop = !rest;
      }
      if (drop) {
        _reportDropped(entry);
        return;
      }
      entry = rest;
      entry.attempts = 0;
      entry.last_try = true;
      delete entry.next_at;
      q.entries.push(entry);
    });
    try {
      _writeQueue(q);
    } catch (e) {
      return;
    }
    _writeDead(keep);
  }

  function dismissDeadLetter(id) {
    var d = _readDead().filter(function (e) {
      return e.id !== id;
    });
    _writeDead(d);
    _notify('dead-letter:dismiss', { id: id });
    return d.length;
  }

  function clear() {
    Object.keys(_waiters).forEach(function (id) {
      _resolveWaiters(id, { data: null, error: { message: 'outbox cleared' } });
    });
    try {
      localStorage.removeItem(QUEUE_KEY);
    } catch (_) {}
    try {
      localStorage.removeItem(DEAD_KEY);
    } catch (_) {}
    _notify('clear');
  }

  /* Wire listeners — flush on reconnect, periodic retry while online. */
  window.addEventListener('online', function () {
    _notify('network', { online: true });
    flush();
  });
  window.addEventListener('offline', function () {
    _notify('network', { online: false });
  });
  if (!_autoTimer) {
    _autoTimer = setInterval(function () {
      if (_owner && navigator.onLine) {
        var q = _readQueue();
        if (q.entries.length > 0) flush();
      }
    }, AUTO_FLUSH_MS);
  }
  // A tab that is going away lets the next one send; one shown again from
  // the back-forward cache asks for the queue back.
  window.addEventListener('pagehide', release);
  window.addEventListener('pageshow', claim);
  _retryDeadOnLoad();
  _openChannel();
  // A page loads this file once. A test loading it again stands for a
  // reload: the old copy's page is gone, so it lets go of the queue.
  if (window.v2Queue && typeof window.v2Queue.release === 'function') window.v2Queue.release();
  // Try to become the owner; the owner flushes once the page has booted.
  claim();

  window.v2Queue = {
    configure: configure,
    push: push,
    enqueue: enqueue,
    flush: flush,
    stats: stats,
    has: has,
    queued: queued,
    rewrite: rewrite,
    remove: remove,
    dropBlockedOn: dropBlockedOn,
    deadLetter: deadLetter,
    dismissDeadLetter: dismissDeadLetter,
    resume: resume,
    clear: clear,
    claim: claim,
    release: release,
    currentOwner: currentOwner,
    subscribe: subscribe,
    MAX_ENTRIES: MAX_ENTRIES,
    SLOW_AFTER: SLOW_AFTER,
  };
})();
