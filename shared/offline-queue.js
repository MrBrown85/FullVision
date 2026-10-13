/* shared/offline-queue.js — the outbox every write goes through
 *
 * shared/data.js hands each write RPC to push(); nothing writes to Supabase
 * any other way (docs/write-path-plan.md, Phase 1). An entry stays here until
 * the server accepts it, so a write that fails on a network blip, while
 * offline, or while cloud sync is paused is sent later instead of lost.
 *
 * Storage:
 *   fv-sync-queue-v1          — { entries:[...], last_flush_at:iso }
 *   fv-sync-dead-letter-v1    — entries that exceeded the retry cap
 *
 * Entry shape:
 *   { id, created_at, owner, key, endpoint, payload, attempts, last_error, next_at }
 *
 * Key: the record the write touches (see _entryKey). Entries with the same
 *   key are sent one at a time, in order; different keys go in parallel.
 *
 * Owner: the signed-in user's id when the entry was queued. The queue lives
 *   in localStorage, so on a shared computer it can outlast a sign-out. An
 *   entry is only ever sent under its owner's session; one owned by someone
 *   else is discarded. Entries queued before owners existed have none and are
 *   sent under whoever is signed in.
 *
 * Retry policy: network errors, timeouts, 5xx and expired sessions retry
 *   with backoff 1s / 5s / 30s / 60s, up to MAX_ATTEMPTS. Anything else
 *   (validation, permission, not found) is moved to the dead letter at once;
 *   retrying would only fail again. A dead-lettered entry doesn't block the
 *   rest of the queue (offline-sync.md decision #2).
 * Cap: 500 entries or ~5 MB serialized, whichever first. Over-cap writes
 *   are rejected and returned to the caller.
 *
 * Everything here is a window.v2Queue.* public surface; no new globals.
 */
(function () {
  'use strict';

  var QUEUE_KEY = 'fv-sync-queue-v1';
  var DEAD_KEY = 'fv-sync-dead-letter-v1';
  var MAX_ENTRIES = 500;
  var MAX_BYTES = 5 * 1024 * 1024;
  var MAX_ATTEMPTS = 20;
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

  function _isTransient(res) {
    if (!res) return true;
    var err = res.error;
    if (!err) return false;
    // The long-form editor has taken this write over and retries it itself.
    if (err.handledSessionExpired) return false;
    var status = Number(res.status || err.status || err.statusCode || 0);
    if (status >= 500 || status === 401 || status === 408 || status === 429) return true;
    var text = [err.code, err.message, err.name, typeof err === 'string' ? err : ''].join(' ');
    return /network|fetch|failed to connect|ECONNREFUSED|timed? ?out|load failed|no_supabase|jwt expired|PGRST301/i.test(
      text,
    );
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
     Returns { ok, id, reason? }.  Caller should update its optimistic
     cache AFTER receiving ok:true. */
  function enqueue(endpoint, payload, opts) {
    if (!endpoint || typeof endpoint !== 'string') {
      return { ok: false, reason: 'invalid_endpoint' };
    }
    var q = _readQueue();
    if (q.entries.length >= MAX_ENTRIES) {
      return { ok: false, reason: 'queue_full' };
    }
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
    q.entries.push(entry);
    try {
      _writeQueue(q);
    } catch (e) {
      return { ok: false, reason: 'storage_full' };
    }
    _notify('enqueue', { id: entry.id, endpoint: entry.endpoint });
    // Kick off a flush attempt if we came online.
    if (navigator.onLine && !(opts && opts.noFlush)) setTimeout(flush, 0);
    return { ok: true, id: entry.id };
  }

  /* The write path. Queues the write and sends it as soon as nothing ahead of
     it touches the same record. Resolves with the server's final answer —
     after any retries — so callers can act on the real outcome (for example
     re-keying a local id). While offline or paused it stays pending. If the
     entry can't be stored, the write is sent directly instead. */
  function push(endpoint, payload, opts) {
    opts = opts || {};
    payload = payload || {};
    var id = payload.p_idempotency_key || _uuid4();
    var queued = enqueue(endpoint, payload, { id: id, key: opts.key, noFlush: true });
    if (!queued.ok) return _sendNow(endpoint, payload, opts.sendOptions);
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
    if (res && !res.error) {
      var q = _removeEntry(entry.id);
      q.last_flush_at = new Date().toISOString();
      _writeQueue(q);
      _counts.succeeded++;
      _notify('flush:success', { id: entry.id, endpoint: entry.endpoint });
      _resolveWaiters(entry.id, res);
      _pump(false);
      return;
    }

    entry.attempts = (entry.attempts || 0) + 1;
    entry.last_error = _errorText(res);
    if (_isTransient(res) && entry.attempts < MAX_ATTEMPTS) {
      var delay = BACKOFF_MS[Math.min(entry.attempts, BACKOFF_MS.length) - 1];
      entry.next_at = new Date(Date.now() + delay).toISOString();
      var qr = _readQueue();
      qr.entries = qr.entries.map(function (e) {
        return e.id === entry.id ? entry : e;
      });
      _writeQueue(qr);
      _notify('flush:retry', {
        id: entry.id,
        endpoint: entry.endpoint,
        attempts: entry.attempts,
        error: entry.last_error,
      });
      _scheduleRetry();
      return;
    }

    var dead = _readDead();
    dead.push(entry);
    _writeDead(dead);
    _writeQueue(_removeEntry(entry.id));
    _counts.deadLettered++;
    _notify('flush:dead-letter', { id: entry.id, endpoint: entry.endpoint, error: entry.last_error });
    _resolveWaiters(entry.id, res);
    _pump(false);
  }

  function _start(entry) {
    var p = _runEntry(entry).then(function (res) {
      _settle(entry, res);
    });
    _inFlight[entry.id] = p;
  }

  /* Start every entry that may go now: the first for its key, due, owned by
     whoever is signed in. `force` ignores backoff (an explicit flush). */
  function _pump(force) {
    if (_isPaused() || !navigator.onLine) return;
    var owner = currentOwner();
    var now = Date.now();
    var busyKeys = {};
    var entries = _readQueue().entries;
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var key = entry.key || entry.id;
      if (busyKeys[key]) continue;
      busyKeys[key] = true;
      if (_inFlight[entry.id]) continue;
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
      deadLettered: d.length,
      lastFlushAt: q.last_flush_at,
      online: !!navigator.onLine,
      flushing: _flushing,
    };
  }

  function deadLetter() {
    var owner = currentOwner();
    return _readDead().filter(function (e) {
      return !_isForeign(e, owner);
    });
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
  // Initial drain attempt on load if already online
  if (navigator.onLine) setTimeout(flush, 2000);

  window.v2Queue = {
    configure: configure,
    push: push,
    enqueue: enqueue,
    flush: flush,
    stats: stats,
    deadLetter: deadLetter,
    dismissDeadLetter: dismissDeadLetter,
    clear: clear,
    currentOwner: currentOwner,
    callOrEnqueue: callOrEnqueue,
    subscribe: subscribe,
    MAX_ENTRIES: MAX_ENTRIES,
    MAX_ATTEMPTS: MAX_ATTEMPTS,
  };
})();
