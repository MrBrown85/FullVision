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
 *
 * Entry shape:
 *   { id, created_at, owner, key, endpoint, payload, attempts, last_error, next_at, blocked_on }
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

  /* Called once by shared/data.js: how to send (with its session handling)
     and when to hold off (cloud sync paused). */
  function configure(opts) {
    opts = opts || {};
    if (typeof opts.send === 'function') _send = opts.send;
    if (typeof opts.isPaused === 'function') _isPaused = opts.isPaused;
  }

  /* The record a write touches, so writes to one record stay in order. */
  function _entryKey(endpoint, payload) {
    payload = payload || {};
    if (payload.p_enrollment_id && payload.p_assessment_id) {
      return 'cell:' + payload.p_enrollment_id + ':' + payload.p_assessment_id;
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
  };

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
    if (!ids.length) return null;
    return endpoint + '|' + ids.join('&');
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

  function _notify(kind, meta) {
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
     idempotency key); otherwise a fresh UUID is generated. Passing an
     explicit id is how callOrEnqueue threads the key it used for the
     failed online attempt into the queued retry so both the direct call
     and the retry share a single key.
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
      q.entries[at] = entry;
    } else {
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
      if (_inFlight[e.id] || e.endpoint !== entry.endpoint || e.owner !== entry.owner) return -1;
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
      var res = await _sendNow(entry.endpoint, payload, _sendOptions[entry.id]);
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
      _dropDeadFor(_target(entry.endpoint, entry.payload));
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
      _pump(false);
      return;
    }

    // Signed out: hold this entry and everything else until resume(). The
    // write isn't wrong, the session is.
    if (_isSessionExpired(res)) {
      entry.last_error = _errorText(res);
      delete entry.next_at;
      _replaceEntry(entry);
      if (!_signedOut) {
        _signedOut = true;
        _notify('paused:auth', { id: entry.id, endpoint: entry.endpoint });
      }
      return;
    }

    entry.attempts = (entry.attempts || 0) + 1;
    entry.last_error = _errorText(res);
    if (_isTransient(res)) {
      var delay = BACKOFF_MS[Math.min(entry.attempts, BACKOFF_MS.length) - 1];
      entry.next_at = new Date(Date.now() + delay).toISOString();
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
    // The last try after a reload is dropped instead.
    var target = _target(entry.endpoint, entry.payload);
    var dead = _readDead().filter(function (e) {
      return !target || _target(e.endpoint, e.payload) !== target;
    });
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
    });
    _resolveWaiters(entry.id, res);
    _pump(false);
  }

  /* A write the server rejected twice, given up on. The endpoint and the
     server's message only: the payload holds student data. */
  function _reportDropped(entry) {
    console.warn('[v2Queue] dropped ' + entry.endpoint + ' after a second rejection: ' + entry.last_error);
    if (window.Sentry && typeof window.Sentry.captureMessage === 'function') {
      window.Sentry.captureMessage('Outbox dropped ' + entry.endpoint + ': ' + entry.last_error, 'warning');
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

  /* A write to this target landed, so older failed writes to it are out of
     date: retrying one would put back the value it replaced. */
  function _dropDeadFor(target) {
    if (!target) return;
    var dead = _readDead();
    var keep = dead.filter(function (e) {
      return _target(e.endpoint, e.payload) !== target;
    });
    if (keep.length === dead.length) return;
    _writeDead(keep);
    dead.forEach(function (e) {
      if (keep.indexOf(e) < 0) _notify('dead-letter:dismiss', { id: e.id, superseded: true });
    });
  }

  function _start(entry) {
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
     (an explicit flush). A column write goes only when no earlier entry names
     its assessment; an entry behind a column write waits for it. */
  function _pump(force) {
    if (_signedOut || _isPaused() || !navigator.onLine) return;
    var owner = currentOwner();
    var now = Date.now();
    var busyKeys = {};
    var touched = {}; // assessment → an earlier entry names it
    var barred = {}; // assessment → an earlier column write is still queued
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

  function _scheduleRetry() {
    if (_retryTimer) return;
    var next = null;
    _readQueue().entries.forEach(function (e) {
      if (_inFlight[e.id] || !e.next_at) return;
      var t = Date.parse(e.next_at);
      if (next === null || t < next) next = t;
    });
    if (next === null) return;
    _retryTimer = setTimeout(
      function () {
        _retryTimer = null;
        _pump(true);
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
    };
  }

  /* Is this entry still waiting to be sent (queued or in flight)? */
  function has(id) {
    if (_inFlight[id]) return true;
    return _readQueue().entries.some(function (e) {
      return e.id === id;
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
      if (_inFlight[entry.id]) return;
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
      return e.id !== id;
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
      var hit = !_inFlight[e.id] && _isBlocked(e) && e.blocked_on.indexOf(localId) >= 0;
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
      _resolveWaiters(e.id, { data: null, error: { message: 'cancelled', cancelled: true } });
      _notify(opts.deadLetter ? 'flush:dead-letter' : 'remove', {
        id: e.id,
        endpoint: e.endpoint,
        error: e.last_error,
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
    return flush();
  }

  /* Once per page load: send the signed-in teacher's failed writes once
     more, at the end of the queue. A write to a record that a newer queued
     write also sets is out of date, and one that adds a row or waited on a
     create that failed has nothing to retry against; those are dropped and
     reported. Another teacher's stay for _discardForeign. */
  function _retryDeadOnLoad() {
    var owner = currentOwner();
    if (!owner) return;
    var dead = _readDead();
    if (!dead.length) return;
    var q = _readQueue();
    var keep = [];
    dead.forEach(function (entry) {
      if (_isForeign(entry, owner)) {
        keep.push(entry);
        return;
      }
      var target = _target(entry.endpoint, entry.payload);
      var drop = !target || entry.last_try || entry.blocked_on || q.entries.length >= MAX_ENTRIES;
      if (!drop) {
        drop = q.entries.some(function (e) {
          return _target(e.endpoint, e.payload) === target;
        });
      }
      if (drop) {
        _reportDropped(entry);
        return;
      }
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

  /* One-shot convenience: call the RPC directly if online, else enqueue.
     Resolves to { ok, data?, enqueued, reason? }.

     For endpoints that support idempotency, we generate a key up front and
     pass it to both the direct call and any fallback enqueue. That way, if
     the direct call's network leg fails after the server committed, the
     queued retry sends the same key and the server returns the cached row
     id instead of inserting a second row. */
  function callOrEnqueue(endpoint, payload) {
    var idemKey = IDEMPOTENT_ENDPOINTS[endpoint] ? _uuid4() : null;
    if (navigator.onLine && typeof getSupabase === 'function' && getSupabase()) {
      return getSupabase()
        .rpc(endpoint, _withIdemKey(endpoint, payload, idemKey))
        .then(function (res) {
          if (res && res.error) {
            // Treat non-2xx network failures as "enqueue and retry" — but
            // return ok:false for semantic (validation/auth) errors so the
            // caller can decide. The heuristic: a message mentioning 'fetch'
            // or 'network' enqueues; everything else is a real error.
            var msg = (res.error.message || '') + '';
            if (/network|fetch|failed to connect|ECONNREFUSED/i.test(msg)) {
              var q = enqueue(endpoint, payload, idemKey ? { id: idemKey } : null);
              return { ok: false, enqueued: q.ok, reason: 'network', error: msg };
            }
            return { ok: false, enqueued: false, error: msg };
          }
          return { ok: true, enqueued: false, data: res && res.data };
        })
        .catch(function (e) {
          var q = enqueue(endpoint, payload, idemKey ? { id: idemKey } : null);
          return { ok: false, enqueued: q.ok, reason: 'exception', error: (e && e.message) || String(e) };
        });
    }
    // Offline or Supabase unavailable
    var q = enqueue(endpoint, payload, idemKey ? { id: idemKey } : null);
    return Promise.resolve({ ok: false, enqueued: q.ok, reason: q.ok ? 'offline' : q.reason });
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
      if (navigator.onLine) {
        var q = _readQueue();
        if (q.entries.length > 0) flush();
      }
    }, AUTO_FLUSH_MS);
  }
  _retryDeadOnLoad();
  // Initial drain attempt on load if already online
  if (navigator.onLine) setTimeout(flush, 2000);

  window.v2Queue = {
    configure: configure,
    push: push,
    enqueue: enqueue,
    flush: flush,
    stats: stats,
    has: has,
    rewrite: rewrite,
    remove: remove,
    dropBlockedOn: dropBlockedOn,
    deadLetter: deadLetter,
    dismissDeadLetter: dismissDeadLetter,
    resume: resume,
    clear: clear,
    currentOwner: currentOwner,
    callOrEnqueue: callOrEnqueue,
    subscribe: subscribe,
    MAX_ENTRIES: MAX_ENTRIES,
    SLOW_AFTER: SLOW_AFTER,
  };
})();
