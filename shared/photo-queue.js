/* shared/photo-queue.js — photos waiting to send
 *
 * The outbox (shared/offline-queue.js) keeps JSON in localStorage and cannot
 * hold a photo. This queue keeps each shrunk page (shared/photo-shrink.js) in
 * IndexedDB until the server has it, so a photo taken offline, on bad Wi-Fi
 * or just before a reload is sent later instead of lost. The student page and
 * both teacher apps use it. It has no network code: the caller supplies the
 * upload, and in Demo Mode nothing is ever handed to it.
 *
 * Storage: IndexedDB database fv-photo-queue
 *   meta   one row per page: the record below, keyed by its id
 *   blobs  the page and its thumbnail (as bytes), under the same id
 *   localStorage fv-photo-queue-owner-v1 — { tab, at }: which tab sends
 *   (only where Web Locks are missing, see Tabs)
 *
 * Record:
 *   { id, batch, owner, ids: { course, assessment, enrollment, submission,
 *     file }, order, hash, bytes, thumb_bytes, width, height, name,
 *     queued_at, state, sent: { photo, thumb }, attempts, last_error,
 *     last_code, next_at }
 *
 * Ids: a page waits under a local id (p + base36 time), and ids.file starts
 *   as that id. The submission record goes through the outbox; when it comes
 *   back with server ids the caller hands them to rekey(), which writes them
 *   into the waiting records. A page uploads only when all five ids are
 *   server UUIDs, to
 *     <course>/<assessment>/<enrollment>/<submission>/<file>.jpg
 *   with its thumbnail beside it as <file>-thumb.jpg. pathFor() throws on
 *   anything else, so a local id cannot reach a storage path (CLAUDE.md
 *   rule 6). A reload keeps all of this, because it is in the record.
 *
 * Sending: one page at a time, oldest batch first, pages in order. The page
 *   goes, then its thumbnail; each is marked in the record as it lands, so a
 *   reload does not send a landed part again.
 *
 * Confirming: a page is deleted from IndexedDB only after the server
 *   confirms it. With a commit function configured, that is the commit: the
 *   pages of one add() wait as "uploaded" until every one of them is up, then
 *   commit({ key, ids, files }) runs once for the batch and they are deleted
 *   when it succeeds. key is the batch's own id, the same on every retry, so
 *   a second commit of the same files is harmless. With no commit function,
 *   the upload's own success is the confirmation.
 *
 * Failures: a network error, a timeout or a 5xx is retried with backoff
 *   1s / 5s / 30s / 60s for as long as it takes; after SLOW_AFTER attempts
 *   the page counts as slow. Anything else the server refuses marks the page
 *   failed. A failed page is kept, never dropped: pages() reports it ("One
 *   Page Didn't Send"), retry() sends it again, remove() gives it up. The
 *   other pages still go. "Already there" (409) counts as sent.
 *
 * Tabs: every tab shares the queue; one sends at a time. A pass holds the
 *   Web Lock fv-photo-queue-v1 and reads the store again before each page,
 *   so a second tab waits, then finds the first tab's pages gone. Where Web
 *   Locks are missing, a lease in localStorage with a heartbeat stands in and
 *   the second tab's send() answers "busy".
 *
 * Owner: who was signed in when the page was queued, when the caller says.
 *   A page is only sent, counted or listed under its own owner.
 *
 * State for the screens: stats() (for the sync dot, like the outbox's),
 *   pages(submission) (one row per page) and subscribe(). Nothing is wired
 *   to any screen here. A full device is reported, not swallowed: add()
 *   answers storage_full and stats().storageFull stays true until space is
 *   freed.
 *
 * Handouts: a teacher's handout PDF (Handouts and Links on the assessment
 *   form) waits here too, one record per page, kind 'handout', added by
 *   addHandout(). Its ids are { course, assessment, resource, file } and it
 *   has no thumbnail. It goes to the path the server named for it
 *   (<course>/handouts/<resource>/<n>.jpg), which placeHandout() writes into
 *   the record once start_handout_upload answers: until then it is blocked.
 *   Its batch commits as { kind: 'handout', key, ids, files }.
 *
 * Everything here is a window.PhotoQueue.* public surface; no other globals.
 */
window.PhotoQueue = (function () {
  'use strict';

  var DB_NAME = 'fv-photo-queue';
  var DB_VERSION = 1;
  var LOCK_NAME = 'fv-photo-queue-v1'; // Web Lock and BroadcastChannel name
  var LEASE_KEY = 'fv-photo-queue-owner-v1';
  var LEASE_STALE_MS = 15000; // a lease this old belongs to a tab that is gone
  var HEARTBEAT_MS = 5000;
  var BACKOFF_MS = [1000, 5000, 30000, 60000];
  var SLOW_AFTER = 5; // attempts before a page counts as slow
  var ID_KEYS = ['course', 'assessment', 'enrollment', 'submission', 'file'];
  var HANDOUT_KEYS = ['course', 'assessment', 'resource']; // a page's own file id stays its local one
  // Where a handout's page goes: the class's handouts folder, the resource, the page's number.
  var HANDOUT_PATH =
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/handouts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([1-9]|1[0-9]|20)\.jpg$/;
  // The same test shared/data.js uses (_isUuid) to tell a server id from a local one.
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var BUSY = {}; // another tab holds the lease

  var _store = null; // where pages are kept (IndexedDB unless configured)
  var _upload = null; // (path, blob, info) → Promise<{ error }>
  var _commit = null; // ({ key, ids, files }) → Promise<{ error }>
  var _isDemo = null;
  var _owner = null; // () → who is signed in
  var _metas = null; // this tab's copy of every record, without the bytes
  var _loaded = null;
  var _listeners = [];
  var _sending = null; // the pass in progress
  var _again = false; // send() was called during a pass: run one more after it
  var _sendingId = null; // the page going out now
  var _retryTimer = null;
  var _storageFull = false;
  var _storeError = null;
  var _epoch = 0; // goes up on wipe() and release(): work begun before it stops
  var _released = false;
  var _channel = null;
  var _tabId = _uuid4();

  /* Called once by the page that wires the queue:
       upload(path, blob, info) → Promise<{ error }>   sends one file
       commit({ key, ids, files }) → Promise<{ error }> optional, see Confirming
       isDemo() → true in Demo Mode (default: the page's isDemoMode())
       owner() → the signed-in user's id, or null
       store    where pages are kept (tests pass a fake; default IndexedDB) */
  function configure(opts) {
    opts = opts || {};
    if ('upload' in opts) _upload = typeof opts.upload === 'function' ? opts.upload : null;
    if ('commit' in opts) _commit = typeof opts.commit === 'function' ? opts.commit : null;
    if ('isDemo' in opts) _isDemo = typeof opts.isDemo === 'function' ? opts.isDemo : null;
    if ('owner' in opts) _owner = typeof opts.owner === 'function' ? opts.owner : null;
    if ('store' in opts) {
      _store = opts.store || null;
      _metas = null;
      _loaded = null;
    }
  }

  /* ── Ids and paths ────────────────────────────────────────────────────── */

  function _uuid4() {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    var b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(b);
    } else {
      for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map
      .call(b, function (x) {
        return (x < 16 ? '0' : '') + x.toString(16);
      })
      .join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }

  function newLocalId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function isServerId(id) {
    return typeof id === 'string' && UUID_RE.test(id);
  }

  function isLocalId(id) {
    return typeof id === 'string' && !!id && !UUID_RE.test(id);
  }

  function _folder(ids) {
    ID_KEYS.forEach(function (k) {
      if (!isServerId(ids && ids[k])) {
        throw new Error('A photo cannot upload before its ' + k + ' has a server id');
      }
    });
    return [ids.course, ids.assessment, ids.enrollment, ids.submission].join('/').toLowerCase();
  }

  /* Where a page goes in the bucket. Throws unless every id is a server id. */
  function pathFor(ids) {
    return _folder(ids) + '/' + ids.file.toLowerCase() + '.jpg';
  }

  function thumbPathFor(ids) {
    return _folder(ids) + '/' + ids.file.toLowerCase() + '-thumb.jpg';
  }

  function _isHandout(meta) {
    return !!meta && meta.kind === 'handout';
  }

  function _keysOf(meta) {
    return _isHandout(meta) ? HANDOUT_KEYS : ID_KEYS;
  }

  function _blocked(meta) {
    if (_isHandout(meta) && !meta.path) return true;
    return !_keysOf(meta).every(function (k) {
      return isServerId(meta.ids && meta.ids[k]);
    });
  }

  // Where this record's page goes. A handout's is the path the server named; it throws until there is one.
  function _pathOf(meta) {
    if (!_isHandout(meta)) return pathFor(meta.ids);
    if (!meta.path) throw new Error('A handout page cannot upload before the server names its path');
    return meta.path;
  }

  /* Does `path` belong to a handout page of this class and resource? Both
     ids must be server ids, and the path the bucket's handout layout. */
  function handoutPathOk(path, course, resource) {
    var m = typeof path === 'string' ? HANDOUT_PATH.exec(path) : null;
    return (
      !!m &&
      isServerId(course) &&
      isServerId(resource) &&
      m[1] === String(course).toLowerCase() &&
      m[2] === String(resource).toLowerCase()
    );
  }

  /* ── The IndexedDB store ──────────────────────────────────────────────── */

  /* Write a change into a record: each field replaces the old one, except
     ids and sent, which change one id or one part at a time. */
  function applyPatch(meta, patch) {
    Object.keys(patch || {}).forEach(function (k) {
      if ((k === 'ids' || k === 'sent') && patch[k]) meta[k] = Object.assign({}, meta[k], patch[k]);
      else meta[k] = patch[k];
    });
    return meta;
  }

  function _buffer(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(reader.error || new Error('The photo could not be read'));
      };
      reader.readAsArrayBuffer(blob);
    });
  }

  /* A store keeps pages. The queue asks only this of one:
       list()          → Promise<record[]>   every record, no bytes
       putAll(items)   → Promise             items: [{ meta, photo, thumb }], all or none
       update(id, patch) → Promise           applyPatch on a record still there; else nothing
       blobs(id)       → Promise<{ photo, thumb } | null>
       remove(ids)     → Promise
       clear()         → Promise
     update reads the record and writes it back in one step, so two tabs
     saving different fields of one record never undo each other. A full
     device rejects putAll with a QuotaExceededError. Photos are kept as
     bytes, not Blobs: Safari has lost Blobs kept in IndexedDB. */
  function indexedDbStore(name) {
    var opening = null;

    function open() {
      if (opening) return opening;
      opening = new Promise(function (resolve, reject) {
        if (typeof indexedDB === 'undefined' || !indexedDB) {
          reject(new Error('This browser has nowhere to keep photos'));
          return;
        }
        var req = indexedDB.open(name || DB_NAME, DB_VERSION);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
        };
        req.onsuccess = function () {
          var db = req.result;
          db.onversionchange = function () {
            db.close();
            opening = null;
          };
          resolve(db);
        };
        req.onerror = function () {
          reject(req.error || new Error('The photo store could not be opened'));
        };
      });
      opening.catch(function () {
        opening = null;
      });
      return opening;
    }

    function tx(stores, mode, work) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(stores, mode);
          var out;
          t.oncomplete = function () {
            resolve(out);
          };
          t.onerror = t.onabort = function () {
            reject(t.error || new Error('The photo store failed'));
          };
          work(t, function (value) {
            out = value;
          });
        });
      });
    }

    function jpeg(bytes) {
      return new Blob([bytes], { type: 'image/jpeg' });
    }

    return {
      list: function () {
        return tx(['meta'], 'readonly', function (t, done) {
          var req = t.objectStore('meta').getAll();
          req.onsuccess = function () {
            done(req.result || []);
          };
        });
      },
      putAll: function (items) {
        // Read the bytes first: a transaction closes while anything else is awaited.
        return Promise.all(
          items.map(function (item) {
            return Promise.all([_buffer(item.photo), item.thumb ? _buffer(item.thumb) : null]);
          }),
        ).then(function (bytes) {
          return tx(['meta', 'blobs'], 'readwrite', function (t) {
            items.forEach(function (item, i) {
              t.objectStore('meta').put(item.meta);
              t.objectStore('blobs').put({ photo: bytes[i][0], thumb: bytes[i][1] }, item.meta.id);
            });
          });
        });
      },
      update: function (id, patch) {
        return tx(['meta'], 'readwrite', function (t) {
          var store = t.objectStore('meta');
          var req = store.get(id);
          req.onsuccess = function () {
            if (req.result) store.put(applyPatch(req.result, patch));
          };
        });
      },
      blobs: function (id) {
        return tx(['blobs'], 'readonly', function (t, done) {
          var req = t.objectStore('blobs').get(id);
          req.onsuccess = function () {
            done(
              req.result
                ? { photo: jpeg(req.result.photo), thumb: req.result.thumb ? jpeg(req.result.thumb) : null }
                : null,
            );
          };
        });
      },
      remove: function (ids) {
        return tx(['meta', 'blobs'], 'readwrite', function (t) {
          ids.forEach(function (id) {
            t.objectStore('meta').delete(id);
            t.objectStore('blobs').delete(id);
          });
        });
      },
      clear: function () {
        return tx(['meta', 'blobs'], 'readwrite', function (t) {
          t.objectStore('meta').clear();
          t.objectStore('blobs').clear();
        });
      },
    };
  }

  function _getStore() {
    if (!_store) _store = indexedDbStore();
    return _store;
  }

  // Change a record here and in the store.
  function _save(meta, patch) {
    applyPatch(meta, patch);
    return _getStore().update(meta.id, patch);
  }

  /* Read every record again. Another tab may have sent, added or wiped. */
  function _reload() {
    return Promise.resolve()
      .then(function () {
        return _getStore().list();
      })
      .then(
        function (rows) {
          _metas = rows || [];
          _storeError = null;
          return _metas;
        },
        function (err) {
          _storeError = _message(err);
          if (!_metas) _metas = [];
          return _metas;
        },
      );
  }

  /* Resolves once this tab has read the store. */
  function ready() {
    if (!_loaded) _loaded = _reload();
    return _loaded;
  }

  /* ── Telling the page and the other tabs ──────────────────────────────── */

  function _message(err) {
    if (!err) return '';
    if (typeof err === 'string') return err;
    return err.message || err.name || err.code || String(err);
  }

  function _ownerNow() {
    try {
      return _owner ? _owner() || null : null;
    } catch (e) {
      return null;
    }
  }

  function _mine(meta, owner) {
    return !meta.owner || !owner || meta.owner === owner;
  }

  function _sorted(metas) {
    return metas.slice().sort(function (a, b) {
      return (
        (a.queued_at || 0) - (b.queued_at || 0) ||
        String(a.batch).localeCompare(String(b.batch)) ||
        (a.order || 0) - (b.order || 0) ||
        String(a.id).localeCompare(String(b.id))
      );
    });
  }

  function _online() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  function _demo() {
    try {
      if (_isDemo) return !!_isDemo();
      return typeof window.isDemoMode === 'function' && !!window.isDemoMode();
    } catch (e) {
      return false;
    }
  }

  function _pageState(meta) {
    if (meta.state === 'failed') return 'failed';
    if (meta.state === 'uploaded') return 'uploaded';
    if (_sendingId === meta.id) return 'sending';
    if (_blocked(meta)) return 'blocked';
    return meta.attempts > 0 ? 'retrying' : 'waiting';
  }

  /* Counts for the sync dot. Sync, from this tab's copy (see ready()). */
  function stats() {
    var owner = _ownerNow();
    var mine = (_metas || []).filter(function (m) {
      return _mine(m, owner);
    });
    function count(state) {
      return mine.filter(function (m) {
        return _pageState(m) === state;
      }).length;
    }
    return {
      queued: mine.length,
      blocked: count('blocked'),
      sending: count('sending'),
      retrying: count('retrying'),
      slow: mine.filter(function (m) {
        return m.state !== 'failed' && (m.attempts || 0) >= SLOW_AFTER;
      }).length,
      failed: count('failed'),
      uploaded: count('uploaded'),
      storageFull: _storageFull,
      storeError: _storeError,
      online: _online(),
      demo: _demo(),
      flushing: !!_sending,
    };
  }

  /* One row per waiting page, in sending order: every page, or one
     submission's. state is blocked (its record has no server ids yet),
     waiting, sending, retrying, uploaded (up, not yet committed) or failed. */
  function pages(submission) {
    var owner = _ownerNow();
    return _sorted(_metas || [])
      .filter(function (m) {
        return _mine(m, owner) && (!submission || (m.ids && m.ids.submission === submission));
      })
      .map(function (m) {
        return {
          id: m.id,
          batch: m.batch,
          kind: m.kind || 'work',
          path: m.path || null,
          ids: Object.assign({}, m.ids),
          order: m.order,
          name: m.name,
          hash: m.hash,
          bytes: m.bytes,
          width: m.width,
          height: m.height,
          queuedAt: m.queued_at,
          state: _pageState(m),
          attempts: m.attempts || 0,
          slow: m.state !== 'failed' && (m.attempts || 0) >= SLOW_AFTER,
          error: m.last_error || null,
          code: m.last_code || null,
        };
      });
  }

  function _notifyLocal(kind, meta) {
    var snapshot = stats();
    _listeners.slice().forEach(function (listener) {
      try {
        listener({ kind: kind || 'update', meta: meta || null, stats: snapshot });
      } catch (e) {
        console.warn('[PhotoQueue] subscriber failed:', e);
      }
    });
  }

  function _post(msg) {
    if (!_channel) return;
    try {
      _channel.postMessage(msg);
    } catch (e) {
      /* a closed channel: the other tabs read the store on their next pass */
    }
  }

  // This tab changed the store: tell its listeners, and the other tabs.
  function _changed(kind, meta) {
    _notifyLocal(kind, meta);
    _post({ type: 'changed' });
  }

  function _onMessage(msg) {
    if (!msg || _released) return;
    if (msg.type === 'wiped') {
      _epoch++;
      _metas = [];
      _storageFull = false;
      _notifyLocal('wipe', null);
    } else if (msg.type === 'changed') {
      _reload().then(function () {
        _notifyLocal('remote', null);
      });
    }
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

  /* ── Adding ───────────────────────────────────────────────────────────── */

  function _isQuota(err) {
    return !!err && (err.name === 'QuotaExceededError' || err.code === 22 || /quota/i.test(_message(err)));
  }

  /* Queue the pages of one send. ref says what they belong to (ids local or
     server): { course, assessment, enrollment, submission }. pages are
     PhotoShrink's, in order: [{ blob, thumb, hash, width, height, name }].
     All of them are kept, or none.
       → { ok: true, batch, ids }                      ids: each page's local id
       → { ok: false, reason: 'storage_full' | 'store_failed' | 'invalid', error } */
  async function add(ref, pageList) {
    ref = ref || {};
    var bad = ID_KEYS.slice(0, 4).some(function (k) {
      return typeof ref[k] !== 'string' || !ref[k];
    });
    if (bad || !Array.isArray(pageList) || !pageList.length) return { ok: false, reason: 'invalid' };
    var unsized = pageList.some(function (p) {
      return !p || !p.blob || !p.thumb || !(p.blob.size > 0) || !(p.thumb.size > 0);
    });
    if (unsized) return { ok: false, reason: 'invalid' };

    await ready();
    var now = Date.now();
    var batch = _uuid4();
    var owner = _ownerNow();
    var first = typeof ref.firstOrder === 'number' ? ref.firstOrder : 0;
    var items = pageList.map(function (page, i) {
      var id = newLocalId();
      return {
        meta: {
          id: id,
          batch: batch,
          owner: owner,
          ids: {
            course: ref.course,
            assessment: ref.assessment,
            enrollment: ref.enrollment,
            submission: ref.submission,
            file: id,
          },
          order: typeof page.order === 'number' ? page.order : first + i,
          hash: page.hash || null,
          bytes: page.blob.size,
          thumb_bytes: page.thumb.size,
          width: page.width || null,
          height: page.height || null,
          name: page.name || null,
          queued_at: now,
          state: 'waiting',
          sent: { photo: false, thumb: false },
          attempts: 0,
          last_error: null,
          last_code: null,
          next_at: 0,
        },
        photo: page.blob,
        thumb: page.thumb,
      };
    });
    try {
      await _getStore().putAll(items);
    } catch (err) {
      if (_isQuota(err)) {
        _storageFull = true;
        _notifyLocal('storage-full', { error: _message(err) });
        return { ok: false, reason: 'storage_full', error: _message(err) };
      }
      _storeError = _message(err);
      _notifyLocal('store-failed', { error: _storeError });
      return { ok: false, reason: 'store_failed', error: _storeError };
    }
    _storageFull = false;
    await _reload();
    var ids = items.map(function (item) {
      return item.meta.id;
    });
    _changed('add', { batch: batch, ids: ids });
    return { ok: true, batch: batch, ids: ids };
  }

  /* Queue the pages of one handout (the teacher's PDF, Handouts and Links).
     ref: { course, assessment, resource } (ids local or server). pages are
     PhotoShrink's, in order; their thumbnails are not kept. All of them are
     kept, or none. Answers as add() does. */
  async function addHandout(ref, pageList) {
    ref = ref || {};
    var bad = ['course', 'assessment', 'resource'].some(function (k) {
      return typeof ref[k] !== 'string' || !ref[k];
    });
    if (bad || !Array.isArray(pageList) || !pageList.length) return { ok: false, reason: 'invalid' };
    var unsized = pageList.some(function (p) {
      return !p || !p.blob || !(p.blob.size > 0);
    });
    if (unsized) return { ok: false, reason: 'invalid' };

    await ready();
    var now = Date.now();
    var batch = _uuid4();
    var owner = _ownerNow();
    var items = pageList.map(function (page, i) {
      var id = newLocalId();
      return {
        meta: {
          id: id,
          batch: batch,
          kind: 'handout',
          path: null,
          owner: owner,
          ids: { course: ref.course, assessment: ref.assessment, resource: ref.resource, file: id },
          order: i,
          hash: page.hash || null,
          bytes: page.blob.size,
          thumb_bytes: 0,
          width: page.width || null,
          height: page.height || null,
          name: page.name || null,
          queued_at: now,
          state: 'waiting',
          sent: { photo: false, thumb: true },
          attempts: 0,
          last_error: null,
          last_code: null,
          next_at: 0,
        },
        photo: page.blob,
        thumb: null,
      };
    });
    try {
      await _getStore().putAll(items);
    } catch (err) {
      if (_isQuota(err)) {
        _storageFull = true;
        _notifyLocal('storage-full', { error: _message(err) });
        return { ok: false, reason: 'storage_full', error: _message(err) };
      }
      _storeError = _message(err);
      _notifyLocal('store-failed', { error: _storeError });
      return { ok: false, reason: 'store_failed', error: _storeError };
    }
    _storageFull = false;
    await _reload();
    var ids = items.map(function (item) {
      return item.meta.id;
    });
    _changed('add', { batch: batch, ids: ids });
    return { ok: true, batch: batch, ids: ids };
  }

  /* start_handout_upload answered: each waiting handout page takes the path
     the server named for it. map: { pageId: path }. Every path must be the
     page's own class and resource (server ids by now: rekey first) in the
     handouts folder, or nothing is written. */
  async function placeHandout(map) {
    map = map || {};
    var ids = Object.keys(map);
    if (!ids.length) return { ok: false, reason: 'invalid' };
    await ready();
    await _reload();
    var rows = ids.map(function (id) {
      return (
        (_metas || []).filter(function (m) {
          return m.id === id;
        })[0] || null
      );
    });
    for (var i = 0; i < rows.length; i++) {
      var m = rows[i];
      if (!m) return { ok: false, reason: 'not_found', id: ids[i] };
      if (!_isHandout(m) || !handoutPathOk(map[ids[i]], m.ids && m.ids.course, m.ids && m.ids.resource)) {
        return { ok: false, reason: 'bad_path', id: ids[i] };
      }
    }
    for (var j = 0; j < rows.length; j++) {
      await _save(rows[j], { path: String(map[ids[j]]).toLowerCase() });
    }
    await _reload();
    _changed('place', { changed: rows.length });
    return { ok: true, changed: rows.length };
  }

  /* A record came back from the server: put its id into every waiting page
     that names the local one. rekey(localId, serverId) or rekey({ local:
     server, … }). A page's own file id is rekeyed the same way, by the local
     id add() gave it. Refuses anything that is not a server id. */
  async function rekey(a, b) {
    var map = {};
    if (typeof a === 'string') map[a] = b;
    else if (a) map = a;
    var locals = Object.keys(map);
    for (var i = 0; i < locals.length; i++) {
      if (!isServerId(map[locals[i]])) return { ok: false, reason: 'not_a_server_id', id: locals[i] };
    }
    await ready();
    await _reload();
    var metas = (_metas || []).slice();
    var changed = 0;
    for (var j = 0; j < metas.length; j++) {
      var ids = {};
      var touched = false;
      _keysOf(metas[j]).forEach(function (k) {
        var id = metas[j].ids && metas[j].ids[k];
        if (typeof id === 'string' && Object.prototype.hasOwnProperty.call(map, id)) {
          ids[k] = map[id];
          touched = true;
        }
      });
      if (!touched) continue;
      await _save(metas[j], { ids: ids });
      changed++;
    }
    if (changed) {
      await _reload();
      _changed('rekey', { changed: changed });
    }
    return { ok: true, changed: changed };
  }

  /* ── Which tab sends ──────────────────────────────────────────────────── */

  function _readLease() {
    try {
      var lease = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null');
      return lease && lease.tab ? lease : null;
    } catch (e) {
      return null;
    }
  }

  function _writeLease() {
    try {
      localStorage.setItem(LEASE_KEY, JSON.stringify({ tab: _tabId, at: Date.now() }));
    } catch (e) {
      /* no localStorage: this tab sends without a lease */
    }
  }

  function _claimLease() {
    var lease = _readLease();
    if (lease && lease.tab !== _tabId && Date.now() - lease.at < LEASE_STALE_MS) return false;
    _writeLease();
    var now = _readLease();
    return !now || now.tab === _tabId;
  }

  function _releaseLease() {
    try {
      var lease = _readLease();
      if (lease && lease.tab === _tabId) localStorage.removeItem(LEASE_KEY);
    } catch (e) {
      /* nothing to let go */
    }
  }

  /* Run fn while no other tab is sending. Web Locks make a second tab wait
     its turn; the lease fallback answers BUSY instead. */
  function _withLock(fn) {
    var locks = typeof navigator !== 'undefined' && navigator.locks;
    if (locks && typeof locks.request === 'function') {
      return locks.request(LOCK_NAME, function () {
        return fn();
      });
    }
    if (!_claimLease()) return Promise.resolve(BUSY);
    var beat = setInterval(_writeLease, HEARTBEAT_MS);
    function letGo() {
      clearInterval(beat);
      _releaseLease();
    }
    return Promise.resolve()
      .then(fn)
      .then(
        function (value) {
          letGo();
          return value;
        },
        function (err) {
          letGo();
          throw err;
        },
      );
  }

  /* ── Sending ──────────────────────────────────────────────────────────── */

  function _status(res) {
    var err = res && res.error;
    return Number((res && res.status) || (err && (err.status || err.statusCode)) || 0);
  }

  function _errorText(res) {
    var err = res && res.error;
    if (!err) return '';
    return [err.code, err.message, err.name, typeof err === 'string' ? err : ''].join(' ').trim();
  }

  /* The same split the outbox makes: worth another try, or refused. */
  function _isTransient(res) {
    if (!res) return true;
    if (!res.error) return false;
    var status = _status(res);
    if (status >= 500 || status === 401 || status === 408 || status === 429) return true;
    return /network|fetch|failed to connect|ECONNREFUSED|timed? ?out|load failed|jwt expired|offline/i.test(
      _errorText(res),
    );
  }

  // The file is already in the bucket: an earlier try landed and its answer was lost.
  function _alreadyThere(res) {
    return _status(res) === 409 || /already exists|duplicate/i.test(_errorText(res));
  }

  function _callUpload(path, blob, info) {
    return Promise.resolve()
      .then(function () {
        return _upload(path, blob, info);
      })
      .then(
        function (res) {
          return res || { error: null };
        },
        function (err) {
          return { error: { message: _message(err) || 'upload failed' } };
        },
      );
  }

  async function _recordFailure(metas, res) {
    var transient = _isTransient(res);
    var now = Date.now();
    for (var i = 0; i < metas.length; i++) {
      var attempts = (metas[i].attempts || 0) + 1;
      var patch = {
        attempts: attempts,
        last_error: _errorText(res) || 'failed',
        last_code: _status(res) || (res && res.error && res.error.code) || null,
        next_at: transient ? now + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] : 0,
      };
      if (!transient) patch.state = 'failed';
      await _save(metas[i], patch);
    }
    await _reload();
    _changed(transient ? 'retry' : 'failed', {
      ids: metas.map(function (m) {
        return m.id;
      }),
      error: _errorText(res),
    });
  }

  function _nextReady(tried, force) {
    var now = Date.now();
    var owner = _ownerNow();
    return (
      _sorted(_metas || []).filter(function (m) {
        return (
          m.state === 'waiting' &&
          !tried[m.id] &&
          _mine(m, owner) &&
          !_blocked(m) &&
          (force || !m.next_at || m.next_at <= now)
        );
      })[0] || null
    );
  }

  /* Send one page and its thumbnail. true: sent. false: failed, and kept.
     null: nothing to do (another tab finished it, or the queue was wiped). */
  async function _sendOne(meta, epoch) {
    _sendingId = meta.id;
    _notifyLocal('send:start', { id: meta.id });
    try {
      var blobs = await _getStore().blobs(meta.id);
      if (epoch !== _epoch || !blobs) return null;
      var handout = _isHandout(meta);
      var paths = { photo: _pathOf(meta), thumb: handout ? null : thumbPathFor(meta.ids) };
      meta.sent = meta.sent || { photo: false, thumb: handout };
      var parts = handout ? ['photo'] : ['photo', 'thumb'];
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (meta.sent[part]) continue;
        var res = await _callUpload(paths[part], blobs[part], {
          part: part,
          id: meta.id,
          ids: Object.assign({}, meta.ids),
          order: meta.order,
          hash: meta.hash,
        });
        if (epoch !== _epoch) return null;
        if (res.error && !_alreadyThere(res)) {
          _sendingId = null;
          await _recordFailure([meta], res);
          return false;
        }
        var landed = {};
        landed[part] = true;
        await _save(meta, { sent: landed });
      }
      if (typeof _commit === 'function') {
        await _save(meta, { state: 'uploaded', attempts: 0, last_error: null, last_code: null, next_at: 0 });
      } else {
        await _getStore().remove([meta.id]);
        _storageFull = false;
      }
      _sendingId = null;
      await _reload();
      _changed('sent', { id: meta.id });
      return true;
    } finally {
      _sendingId = null;
    }
  }

  /* Commit every batch whose pages are all up, oldest first, and delete its
     pages once the server says yes. */
  async function _commitBatches(opts, out, epoch) {
    await _reload();
    var owner = _ownerNow();
    var batches = {};
    _sorted(_metas || []).forEach(function (m) {
      if (_mine(m, owner)) (batches[m.batch] = batches[m.batch] || []).push(m);
    });
    var keys = Object.keys(batches);
    var now = Date.now();
    for (var i = 0; i < keys.length; i++) {
      var rows = batches[keys[i]];
      var allUp = rows.every(function (m) {
        return m.state === 'uploaded';
      });
      var due = rows.every(function (m) {
        return !m.next_at || m.next_at <= now;
      });
      if (!allUp || (!due && !opts.force)) continue;
      var first = rows[0];
      var res;
      try {
        res = _isHandout(first)
          ? await _commit({
              kind: 'handout',
              key: keys[i],
              ids: { course: first.ids.course, assessment: first.ids.assessment, resource: first.ids.resource },
              files: rows.map(function (m) {
                return {
                  id: m.ids.file,
                  order: m.order,
                  path: _pathOf(m),
                  hash: m.hash,
                  bytes: m.bytes,
                  width: m.width,
                  height: m.height,
                };
              }),
            })
          : await _commit({
              key: keys[i],
              ids: {
                course: first.ids.course,
                assessment: first.ids.assessment,
                enrollment: first.ids.enrollment,
                submission: first.ids.submission,
              },
              files: rows.map(function (m) {
                return {
                  id: m.ids.file,
                  order: m.order,
                  path: pathFor(m.ids),
                  thumbPath: thumbPathFor(m.ids),
                  hash: m.hash,
                  bytes: m.bytes,
                  thumbBytes: m.thumb_bytes,
                  width: m.width,
                  height: m.height,
                };
              }),
            });
      } catch (err) {
        res = { error: { message: _message(err) || 'commit failed' } };
      }
      if (epoch !== _epoch) return;
      if (res && res.error) {
        out.commitFailed++;
        await _recordFailure(rows, res);
        continue;
      }
      await _getStore().remove(
        rows.map(function (m) {
          return m.id;
        }),
      );
      _storageFull = false;
      out.committed++;
      await _reload();
      _changed('commit', { batch: keys[i] });
    }
  }

  async function _pass(opts, out, epoch) {
    var tried = {};
    for (;;) {
      await _reload();
      if (epoch !== _epoch || !_online()) break;
      var next = _nextReady(tried, opts.force);
      if (!next) break;
      tried[next.id] = true;
      var sent = await _sendOne(next, epoch);
      if (sent === true) out.sent++;
      else if (sent === false) out.failed++;
    }
    if (epoch === _epoch && _online() && typeof _commit === 'function') await _commitBatches(opts, out, epoch);
  }

  function _retryIn(ms) {
    if (_released) return;
    if (_retryTimer) clearTimeout(_retryTimer);
    _retryTimer = setTimeout(function () {
      _retryTimer = null;
      send();
    }, ms);
  }

  // Wake up when the soonest backoff ends.
  function _scheduleRetry() {
    var owner = _ownerNow();
    var soonest = null;
    (_metas || []).forEach(function (m) {
      if (!_mine(m, owner) || m.state === 'failed' || !m.next_at) return;
      if (m.state === 'waiting' && _blocked(m)) return;
      if (soonest == null || m.next_at < soonest) soonest = m.next_at;
    });
    if (soonest != null) _retryIn(Math.max(0, soonest - Date.now()));
  }

  async function _run(opts) {
    var out = { sent: 0, failed: 0, committed: 0, commitFailed: 0, note: null };
    var epoch = _epoch;
    try {
      await ready();
      if (typeof _upload !== 'function') out.note = 'not_configured';
      else if (_demo()) out.note = 'demo';
      else if (!_online()) out.note = 'offline';
      if (out.note) return out;
      var ran = await _withLock(function () {
        return _pass(opts, out, epoch);
      });
      if (ran === BUSY) {
        out.note = 'busy';
        _retryIn(HEARTBEAT_MS);
        return out;
      }
    } catch (err) {
      out.note = 'store_failed';
      out.error = _message(err);
      _storeError = out.error;
    }
    if (epoch === _epoch) _scheduleRetry();
    return out;
  }

  /* Send what can go now. One pass at a time per tab; a call during a pass
     waits for it and for one more pass after it. opts.force skips the
     backoff waits.
       → { sent, failed, committed, commitFailed, note }
     note: null, or why nothing was tried: not_configured, demo, offline,
     busy (another tab is sending), store_failed. */
  function send(opts) {
    if (_sending) {
      _again = true; // pages added during this pass may have missed it
      return _sending;
    }
    _sending = _run(opts || {}).then(function (out) {
      var again = _again && !out.note;
      _sending = null;
      _again = false;
      _notifyLocal('send:end', out);
      if (!again) return out;
      return send(opts).then(function (more) {
        ['sent', 'failed', 'committed', 'commitFailed'].forEach(function (k) {
          more[k] += out[k];
        });
        return more;
      });
    });
    return _sending;
  }

  /* ── One page ─────────────────────────────────────────────────────────── */

  async function _find(id) {
    await ready();
    await _reload();
    return (
      (_metas || []).filter(function (m) {
        return m.id === id;
      })[0] || null
    );
  }

  /* Try a page again from the start of its backoff. opts.again sends its
     files again even if they landed. Call send() after. */
  async function retry(id, opts) {
    var meta = await _find(id);
    if (!meta) return { ok: false, reason: 'not_found' };
    var patch = { state: 'waiting', attempts: 0, next_at: 0, last_error: null, last_code: null };
    if (opts && opts.again) patch.sent = { photo: false, thumb: _isHandout(meta) };
    await _save(meta, patch);
    await _reload();
    _changed('retry:reset', { id: id });
    return { ok: true };
  }

  /* Give a page up: it is deleted from this device and never sent. */
  async function remove(id) {
    var meta = await _find(id);
    if (!meta) return { ok: false, reason: 'not_found' };
    await _getStore().remove([id]);
    _storageFull = false;
    await _reload();
    _changed('remove', { id: id });
    return { ok: true };
  }

  /* A waiting page's pictures, to show it: { photo, thumb } Blobs, or null. */
  function blobs(id) {
    return ready().then(function () {
      return _getStore().blobs(id);
    });
  }

  /* ── Sign Out ─────────────────────────────────────────────────────────── */

  function _stopTimers() {
    if (_retryTimer) clearTimeout(_retryTimer);
    _retryTimer = null;
  }

  /* Delete every waiting photo from this device. For Sign Out, and Done on
     the student page. Always resolves: { ok, error }. */
  async function wipe() {
    _epoch++;
    _stopTimers();
    _sendingId = null;
    var error = null;
    try {
      await _getStore().clear();
    } catch (err) {
      error = _message(err);
    }
    _metas = [];
    _loaded = Promise.resolve(_metas);
    _storageFull = false;
    _releaseLease();
    _post({ type: 'wiped' });
    _notifyLocal('wipe', null);
    return { ok: !error, error: error };
  }

  /* The page is going away: stop timers, stop work in progress, close the
     channel. A test loading this file again stands for a reload. */
  function release() {
    _released = true;
    _epoch++;
    _stopTimers();
    _releaseLease();
    if (_channel) {
      try {
        _channel.close();
      } catch (e) {
        /* already closed */
      }
      _channel = null;
    }
    if (typeof window.removeEventListener === 'function') window.removeEventListener('online', _onOnline);
  }

  function _onOnline() {
    send();
  }

  if (window.PhotoQueue && typeof window.PhotoQueue.release === 'function') window.PhotoQueue.release();
  if (typeof BroadcastChannel === 'function') {
    try {
      _channel = new BroadcastChannel(LOCK_NAME);
      _channel.onmessage = function (event) {
        _onMessage(event && event.data);
      };
    } catch (e) {
      _channel = null;
    }
  }
  if (typeof window.addEventListener === 'function') window.addEventListener('online', _onOnline);

  return {
    configure: configure,
    ready: ready,
    add: add,
    addHandout: addHandout,
    placeHandout: placeHandout,
    handoutPathOk: handoutPathOk,
    rekey: rekey,
    send: send,
    stats: stats,
    pages: pages,
    blobs: blobs,
    retry: retry,
    remove: remove,
    wipe: wipe,
    release: release,
    subscribe: subscribe,
    pathFor: pathFor,
    thumbPathFor: thumbPathFor,
    isServerId: isServerId,
    isLocalId: isLocalId,
    newLocalId: newLocalId,
    indexedDbStore: indexedDbStore,
    applyPatch: applyPatch,
    BACKOFF_MS: BACKOFF_MS,
    SLOW_AFTER: SLOW_AFTER,
  };
})();
