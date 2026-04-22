/* shared/offline-queue.js — v2 offline write queue (Phase 4.10)
 *
 * Implements docs/backend-design/offline-sync.md's queue model for FullVision
 * v2. When the browser reports offline, callers enqueue writes here instead
 * of calling the Supabase RPC directly; the queue drains on reconnect.
 *
 * Storage:
 *   fv-sync-queue-v1          — { entries:[...], last_flush_at:iso }
 *   fv-sync-dead-letter-v1    — entries that exceeded the retry cap
 *
 * Entry shape:
 *   { id, created_at, endpoint, payload, attempts, last_error }
 *
 * Retry policy: 3 attempts with backoff 1s / 5s / 30s.
 * Drain policy: FIFO; a failure on one entry does NOT block the rest
 *   (dead-lettered and the queue continues) per offline-sync.md decision #2.
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
  var MAX_ATTEMPTS = 3;
  var BACKOFF_MS = [1000, 5000, 30000];
  var AUTO_FLUSH_MS = 60000; // periodic retry while online

  var _flushing = false;
  var _autoTimer = null;
  var _listeners = [];

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
     Returns { ok, id, reason? }.  Caller should update its optimistic
     cache AFTER receiving ok:true. */
  function enqueue(endpoint, payload) {
    if (!endpoint || typeof endpoint !== 'string') {
      return { ok: false, reason: 'invalid_endpoint' };
    }
    var q = _readQueue();
    if (q.entries.length >= MAX_ENTRIES) {
      return { ok: false, reason: 'queue_full' };
    }
    var entry = {
      id: _uuid4(),
      created_at: new Date().toISOString(),
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
    if (navigator.onLine) setTimeout(flush, 0);
    return { ok: true, id: entry.id };
  }

  function _sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  async function _runEntry(entry) {
    var sb = typeof getSupabase === 'function' ? getSupabase() : null;
    if (!sb) return { ok: false, error: 'no_supabase' };
    try {
      var res = await sb.rpc(entry.endpoint, entry.payload || {});
      if (res && res.error) return { ok: false, error: res.error.message || String(res.error) };
      return { ok: true, data: res && res.data };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  /* Drain the queue FIFO. Returns { processed, succeeded, deadLettered }.
     A single-entry failure doesn't block later entries. */
  async function flush() {
    if (_flushing) return { processed: 0, succeeded: 0, deadLettered: 0, note: 'busy' };
    if (!navigator.onLine) return { processed: 0, succeeded: 0, deadLettered: 0, note: 'offline' };
    _flushing = true;
    _notify('flush:start');
    var succeeded = 0;
    var deadLettered = 0;
    var processed = 0;
    try {
      while (true) {
        var q = _readQueue();
        if (q.entries.length === 0) break;
        var head = q.entries[0];

        var res = await _runEntry(head);
        processed++;

        if (res.ok) {
          var q2 = _readQueue();
          q2.entries.shift();
          q2.last_flush_at = new Date().toISOString();
          _writeQueue(q2);
          succeeded++;
          _notify('flush:success', { id: head.id, endpoint: head.endpoint });
          continue;
        }

        // Failure — backoff or dead-letter
        head.attempts = (head.attempts || 0) + 1;
        head.last_error = res.error;
        if (head.attempts >= MAX_ATTEMPTS) {
          var dead = _readDead();
          dead.push(head);
          _writeDead(dead);
          var qd = _readQueue();
          qd.entries.shift();
          _writeQueue(qd);
          deadLettered++;
          _notify('flush:dead-letter', { id: head.id, endpoint: head.endpoint, error: head.last_error });
          continue; // keep draining the rest
        }

        // Persist updated attempt count, then backoff; break out so the
        // caller (or the auto-timer) retries later. This yields control so
        // a flood of transient errors doesn't busy-loop the UI.
        var qb = _readQueue();
        qb.entries[0] = head;
        _writeQueue(qb);
        _notify('flush:retry', {
          id: head.id,
          endpoint: head.endpoint,
          attempts: head.attempts,
          error: head.last_error,
        });
        var delay = BACKOFF_MS[Math.min(head.attempts, BACKOFF_MS.length) - 1];
        await _sleep(delay);
        if (!navigator.onLine) break;
      }
    } finally {
      _flushing = false;
      _notify('flush:end');
    }
    return { processed: processed, succeeded: succeeded, deadLettered: deadLettered };
  }

  function stats() {
    var q = _readQueue();
    var d = _readDead();
    return {
      queued: q.entries.length,
      deadLettered: d.length,
      lastFlushAt: q.last_flush_at,
      online: !!navigator.onLine,
      flushing: _flushing,
    };
  }

  function deadLetter() {
    return _readDead();
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
    try {
      localStorage.removeItem(QUEUE_KEY);
    } catch (_) {}
    try {
      localStorage.removeItem(DEAD_KEY);
    } catch (_) {}
    _notify('clear');
  }

  /* One-shot convenience: call the RPC directly if online, else enqueue.
     Resolves to { ok, data?, enqueued, reason? }. */
  function callOrEnqueue(endpoint, payload) {
    if (navigator.onLine && typeof getSupabase === 'function' && getSupabase()) {
      return getSupabase()
        .rpc(endpoint, payload || {})
        .then(function (res) {
          if (res && res.error) {
            // Treat non-2xx network failures as "enqueue and retry" — but
            // return ok:false for semantic (validation/auth) errors so the
            // caller can decide. The heuristic: a message mentioning 'fetch'
            // or 'network' enqueues; everything else is a real error.
            var msg = (res.error.message || '') + '';
            if (/network|fetch|failed to connect|ECONNREFUSED/i.test(msg)) {
              var q = enqueue(endpoint, payload);
              return { ok: false, enqueued: q.ok, reason: 'network', error: msg };
            }
            return { ok: false, enqueued: false, error: msg };
          }
          return { ok: true, enqueued: false, data: res && res.data };
        })
        .catch(function (e) {
          var q = enqueue(endpoint, payload);
          return { ok: false, enqueued: q.ok, reason: 'exception', error: (e && e.message) || String(e) };
        });
    }
    // Offline or Supabase unavailable
    var q = enqueue(endpoint, payload);
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
    enqueue: enqueue,
    flush: flush,
    stats: stats,
    deadLetter: deadLetter,
    dismissDeadLetter: dismissDeadLetter,
    clear: clear,
    callOrEnqueue: callOrEnqueue,
    subscribe: subscribe,
    MAX_ENTRIES: MAX_ENTRIES,
    MAX_ATTEMPTS: MAX_ATTEMPTS,
  };
})();
