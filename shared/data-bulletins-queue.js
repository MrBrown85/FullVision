// @ts-check
/* data-bulletins-queue.js — the phone's post whose pages wait in the photo
   queue (docs/plans/bulletins-plan.md, slice B1f). Part of the Bulletins data
   layer (shared/data-bulletins.js, loaded first), in a file of its own for
   its size. Loaded by the phone (teacher-mobile/index.html); the desktop
   page posts its files online and does not load it, so shared/data-bulletins.js
   calls into this file only where it is there (_bltQueuedPost, _bltQueuedView,
   _bltQueuedSeenAll, _bltQueuedEvent, _bltQueuedTakeBack).

   The flow, each step kept on the device so a reload takes it up again:
   postBulletin(cid, draft, files, { queue: true }) keeps the bulletin in
   gb-bulletins-pending-<cid> as Not Sent Yet, then every page in
   shared/photo-queue.js (kind 'bulletin', under the bulletin's device key);
   post_bulletin goes through the outbox under that key; its answer is kept in
   the entry (`server`) and names each page's path (PhotoQueue.placeBulletin);
   the queue uploads the pages (_bltQueueUpload) and its commit finishes each
   file (_bltQueueCommit, finish_bulletin_file), after which students can see
   it.

   One post, ever, per press of Post: the phone never posts a bulletin again
   by itself. Missing pages go again under the same post. A file the server
   no longer has (`gone`, or an upload refused with the bulletin gone) is let
   go, whatever the clocks say: its pages go and its words come back once
   through B1c's one store (getReturnedBulletins), saying it was not posted
   and, when it had a photo, that the photo needs taking again. A refusal lets
   it go the same way. Taken back, it never sends: its pages go at once, and a
   post the server answers anyway is deleted; one that may have reached
   students is deleted (deleteBulletin). Trouble shows only on the sync dot.
   Nothing here writes to the device once Sign Out has begun
   (window.isSigningOut, shared/supabase.js). */

var BULLETIN_PAGE_PATH =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f-]{36}\/([1-9]|1[0-9]|20)\.jpg$/;
var BULLETIN_NOT_POSTED = 'This bulletin was not posted. Its words are here to post again.';
var BULLETIN_NOT_POSTED_PHOTO =
  'This bulletin was not posted. Its words are here to post again; its photo needs taking again.';
var BULLETIN_NO_ROOM = 'This phone is out of room, so the bulletin was not kept. Free some space, then post again.';
var BULLETIN_ORPHAN_MS = 5 * 60 * 1000; // a page this new may belong to a post another tab is still saving
var _bltQueueWired = false;
/** @type {Record<string, Promise<any> | undefined>} */
var _bltPlacing = {}; // key → placing its pages now
/** @type {Record<string, boolean>} */
var _bltCommitting = {}; // key → its commit is in flight
/** @type {Record<string, { url: string, release: () => void }>} */
var _bltDevicePictures = {}; // a waiting bulletin's first page, from the device

/** Sign Out has begun (shared/supabase.js): nothing more is written to this device. */
function _bltSigningOut() {
  var w = /** @type {any} */ (window);
  return typeof w.isSigningOut === 'function' && !!w.isSigningOut();
}

/** The photo queue, told how a bulletin's pages go up and are finished. Signed in only. @returns {any} */
function _bltQueue() {
  if (_isDemoSession() || typeof _wireWorkQueue !== 'function') return null;
  var q = /** @type {any} */ (_wireWorkQueue());
  if (!q || typeof q.addBulletin !== 'function' || typeof q.placeBulletin !== 'function') return null;
  if (!_bltQueueWired) {
    _bltQueueWired = true;
    q.configure({ bulletinUpload: _bltQueueUpload, bulletinCommit: _bltQueueCommit });
  }
  return q;
}

/** @param {string} key */
function _bltOutboxHas(key) {
  var q = window.v2Queue;
  return !!q && typeof q.has === 'function' && q.has(key);
}

/** The outbox's dead letter for a key, if it gave up on it. @param {string} key @returns {any} */
function _bltDeadFor(key) {
  var q = /** @type {any} */ (window.v2Queue);
  if (!q || typeof q.deadLetter !== 'function') return null;
  return (
    (q.deadLetter() || []).filter(function (/** @type {any} */ e) {
      return e && String(e.id) === key;
    })[0] || null
  );
}

/** @param {string} key */
function _bltDismissDead(key) {
  var q = /** @type {any} */ (window.v2Queue);
  if (q && typeof q.dismissDeadLetter === 'function' && _bltDeadFor(key)) q.dismissDeadLetter(key);
}

/** @param {string} cid @param {string} key @returns {BulletinWaiting | null} */
function _bltEntry(cid, key) {
  return (
    _bltPending(cid).filter(function (e) {
      return e.key === key;
    })[0] || null
  );
}

/** Save one waiting entry's change. @param {string} cid @param {string} key @param {(e: BulletinWaiting) => void} change */
function _bltEntryChange(cid, key, change) {
  if (_bltSigningOut()) return false;
  var list = _bltPending(cid);
  var hit = false;
  list.forEach(function (e) {
    if (e.key === key) {
      change(e);
      hit = true;
    }
  });
  if (hit) _bltSavePending(cid, list);
  return hit;
}

/** Every queued waiting entry on this device, with its class; null when storage could not be read. @returns {{ cid: string, entry: BulletinWaiting }[] | null} */
function _bltAllQueued() {
  /** @type {{ cid: string, entry: BulletinWaiting }[]} */
  var out = [];
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var name = localStorage.key(i);
      if (!name || name.indexOf('gb-bulletins-pending-') !== 0) continue;
      var cid = name.slice('gb-bulletins-pending-'.length);
      var raw = localStorage.getItem(name);
      if (raw == null) continue;
      _bltPending(cid).forEach(function (e) {
        if (e.queued) out.push({ cid: cid, entry: e });
      });
    }
  } catch (e) {
    return null;
  }
  return out;
}

/** The pages of a waiting bulletin in the queue, in order. @param {any} q @param {{ key: string }} entry */
function _bltPagesOf(q, entry) {
  var key = String(entry.key).toLowerCase();
  var pages = q && typeof q.pages === 'function' ? q.pages() : [];
  return pages
    .filter(function (/** @type {any} */ p) {
      return p.kind === 'bulletin' && p.ids && String(p.ids.key).toLowerCase() === key;
    })
    .sort(function (/** @type {any} */ a, /** @type {any} */ b) {
      return (a.order || 0) - (b.order || 0);
    });
}

/** Remove a waiting bulletin's pages from the queue: nothing is left behind. @param {{ key: string }} entry */
function _bltForgetPages(entry) {
  var q = /** @type {any} */ (window.PhotoQueue);
  if (!q || typeof q.pages !== 'function' || typeof q.remove !== 'function') return Promise.resolve();
  return Promise.resolve(q.ready && q.ready())
    .then(function () {
      return Promise.all(
        _bltPagesOf(q, entry).map(function (/** @type {any} */ p) {
          return Promise.resolve(q.remove(p.id)).then(null, function () {});
        }),
      );
    })
    .then(null, function () {});
}

/**
 * A bulletin page whose key no waiting entry holds is removed: it would hold
 * the sync dot for good. A page queued in the last five minutes is left (its
 * entry may be on its way from another tab), and nothing is removed in a pass
 * that could not read the waiting entries.
 */
function _bltSweepOrphans() {
  var q = /** @type {any} */ (window.PhotoQueue);
  if (!q || typeof q.pages !== 'function' || typeof q.remove !== 'function' || _bltSigningOut())
    return Promise.resolve();
  return Promise.resolve(q.ready && q.ready())
    .then(function () {
      var all = _bltAllQueued();
      if (!all) return null;
      /** @type {Record<string, boolean>} */
      var known = {};
      all.forEach(function (w) {
        if (!w.entry.takenBack) known[String(w.entry.key).toLowerCase()] = true;
      });
      var now = Date.now();
      return Promise.all(
        q
          .pages()
          .filter(function (/** @type {any} */ p) {
            if (p.kind !== 'bulletin' || (p.ids && known[String(p.ids.key).toLowerCase()])) return false;
            return now - (Number(p.queuedAt) || 0) > BULLETIN_ORPHAN_MS;
          })
          .map(function (/** @type {any} */ p) {
            return Promise.resolve(q.remove(p.id)).then(null, function () {});
          }),
      );
    })
    .then(null, function () {});
}

/**
 * A waiting bulletin that will never be sent: its entry and its pages go, and
 * the outbox forgets its refused post (it is not tried again at next start).
 * opts.giveBack keeps its words for the composer (B1c's store, once per key),
 * with opts.message or the plain sentence that it was not posted (and, when it
 * had a photo, that the photo needs taking again); opts.deleteOnServer deletes
 * the half-made bulletin the server holds (students never saw it). Nothing is
 * written once Sign Out has begun.
 * @param {string} cid @param {BulletinWaiting} entry
 * @param {{ giveBack?: boolean, message?: string, deleteOnServer?: boolean }} opts
 */
function _bltQueuedDrop(cid, entry, opts) {
  if (_bltSigningOut()) return Promise.resolve();
  _bltDropPending(cid, entry.key);
  delete _bltPlacing[entry.key];
  _bltDismissDead(entry.key);
  if (opts.giveBack) {
    var hadPhoto = (entry.files || []).length > 0;
    var said = opts.message || (hadPhoto ? BULLETIN_NOT_POSTED_PHOTO : BULLETIN_NOT_POSTED);
    // Given back even with no words: the teacher is told it was not posted.
    _bltReturn(cid, entry.key, entry.bulletin, said, entry.at, true);
  }
  if (opts.deleteOnServer && entry.server && _isUuid(entry.server.id)) {
    var key = _newEntryId();
    _writeRpc('delete_bulletin', { p_bulletin_id: entry.server.id, p_idempotency_key: key }, { entryId: key });
  }
  _bltReleaseDevicePicture(entry.key);
  _bltWriteBegan(cid);
  _bltChanged(cid);
  return _bltForgetPages(entry).then(_bltSweepOrphans);
}

/**
 * Keep the entry as Not Sent Yet, then the pages in the photo queue, and send
 * post_bulletin through the outbox under the device's key. The entry is saved
 * first, so another tab's sweep never takes the pages for orphans. When it
 * cannot be kept (the device is out of room) nothing is queued and the
 * caller keeps the photo and the words.
 * @param {string} cid @param {Record<string, any>} payload
 * @param {{ kind: string, title: string, pages: { blob: Blob, hash?: string, width?: number, height?: number, name?: string }[] }[]} files
 * @returns {Promise<{ ok: boolean, message?: string, waiting?: boolean, key?: string }>}
 */
function _bltQueuedPost(cid, payload, files) {
  var q = _bltQueue();
  if (!q) return Promise.resolve({ ok: false, message: "Photos can't be kept on this device." });
  _bltListen();
  var key = _newEntryId();
  var meta = files.map(function (f) {
    return {
      kind: f.kind === 'pdf' ? 'pdf' : 'photo',
      title: String(f.title || '').slice(0, BULLETIN_NAME_MAX),
      pages: f.pages.length,
    };
  });
  /** @type {any[]} */
  var pageList = [];
  files.forEach(function (f, fi) {
    f.pages.forEach(function (p, pi) {
      pageList.push({
        blob: p.blob,
        hash: p.hash,
        width: p.width,
        height: p.height,
        name: p.name,
        file: fi,
        page: pi + 1,
      });
    });
  });
  var pending = _bltPending(cid);
  pending.push({ key: key, at: new Date().toISOString(), bulletin: payload, files: meta, queued: true });
  _bltSavePending(cid, pending);
  if (!_bltEntry(cid, key)) return Promise.resolve({ ok: false, message: BULLETIN_NO_ROOM });
  return Promise.resolve(q.addBulletin({ course: cid, key: key }, pageList)).then(function (/** @type {any} */ added) {
    if (!added || !added.ok) {
      _bltDropPending(cid, key);
      return {
        ok: false,
        message:
          added && added.reason === 'storage_full'
            ? 'This phone is full. Free some space, then try again.'
            : "The photo couldn't be kept on this phone. Try again.",
      };
    }
    _bltWriteBegan(cid);
    _bltChanged(cid);
    _bltQueuedSend(cid, key);
    return { ok: true, waiting: true, key: key };
  });
}

/** post_bulletin for a waiting entry, through the outbox under its key. @param {string} cid @param {string} key */
function _bltQueuedSend(cid, key) {
  var entry = _bltEntry(cid, key);
  if (!entry) return Promise.resolve();
  return Promise.resolve(
    _writeRpc(
      'post_bulletin',
      { p_course_id: cid, p_bulletin: entry.bulletin, p_files: entry.files, p_idempotency_key: key },
      { entryId: key },
    ),
  )
    .then(function (res) {
      return _bltQueuedAnswered(cid, key, res);
    })
    .then(null, function (e) {
      console.warn('post_bulletin failed:', e);
    });
}

/**
 * post_bulletin answered (here, or from the outbox's event after a reload,
 * or found in the outbox's dead letters at start). A refusal lets the
 * bulletin go and gives its words back; an answer keeps the paths in the
 * entry (so a reload can place them) and places the pages; for one taken
 * back, the bulletin the server made is deleted. Runs once per answer.
 * @param {string} cid @param {string} key @param {any} res
 */
function _bltQueuedAnswered(cid, key, res) {
  var entry = _bltEntry(cid, key);
  if (!entry || !entry.queued) return Promise.resolve();
  if (res && res.error) {
    if (res.error.cancelled) return Promise.resolve(); // taken back before it went
    if (entry.takenBack) return _bltQueuedDrop(cid, entry, {});
    return _bltQueuedDrop(cid, entry, { giveBack: true, message: _bltMessage(res.error, 'post_bulletin') });
  }
  var data = _rpcObject(res && res.data);
  var posted = data && data.bulletin;
  if (!posted || !_isUuid(posted.id)) return Promise.resolve();
  if (entry.takenBack) return _bltDeleteTakenBack(cid, entry, String(posted.id));
  return _bltQueuedTake(cid, entry, posted);
}

/** The server's bulletin for a waiting entry: kept, then its pages placed. @param {string} cid @param {BulletinWaiting} entry @param {any} posted */
function _bltQueuedTake(cid, entry, posted) {
  if (posted.visible === true || posted.posted_at) {
    // Students can see it already (its files were all finished): nothing waits.
    _bltPlace(cid, posted);
    return _bltQueuedDrop(cid, entry, {});
  }
  if (!entry.server) {
    var server = {
      id: String(posted.id),
      files: (Array.isArray(posted.files) ? posted.files : [])
        .slice()
        .sort(function (/** @type {any} */ a, /** @type {any} */ b) {
          return (Number(a.position) || 0) - (Number(b.position) || 0);
        })
        .map(function (/** @type {any} */ f) {
          return { id: String(f.id), paths: Array.isArray(f.paths) ? f.paths.map(String) : [] };
        }),
    };
    _bltEntryChange(cid, entry.key, function (e) {
      e.server = server;
    });
    entry.server = server;
    // A list read begun before this answer must not judge the entry by it.
    _bltWriteBegan(cid);
    _bltChanged(cid);
  }
  return _bltPlacePages(cid, entry.key);
}

/** Give each waiting page the path the server named for it, in order, and send. @param {string} cid @param {string} key */
function _bltPlacePages(cid, key) {
  if (_bltPlacing[key]) return _bltPlacing[key];
  var found = _bltEntry(cid, key);
  var q = _bltQueue();
  if (!found || !found.server || found.takenBack || !q) return Promise.resolve();
  /** @type {BulletinWaiting} */
  var entry = found;
  var server = found.server;
  var run = Promise.resolve(q.ready && q.ready())
    .then(function () {
      var pages = _bltPagesOf(q, { key: key });
      /** @type {string[]} */
      var paths = [];
      server.files.forEach(function (/** @type {any} */ f) {
        f.paths.forEach(function (/** @type {string} */ p) {
          paths.push(p);
        });
      });
      var own = paths.every(function (p) {
        var m = BULLETIN_PAGE_PATH.exec(String(p).toLowerCase());
        return !!m && m[1] === String(cid).toLowerCase();
      });
      if (!pages.length) return _bltQueuedDrop(cid, entry, { giveBack: true, deleteOnServer: true });
      if (!own || paths.length !== pages.length || server.files.length !== entry.files.length) {
        return _bltQueuedDrop(cid, entry, { giveBack: true, deleteOnServer: true });
      }
      if (
        entry.placed &&
        pages.every(function (/** @type {any} */ p) {
          return !!p.path;
        })
      ) {
        q.send();
        return null;
      }
      /** @type {Record<string, string>} */
      var map = {};
      pages.forEach(function (/** @type {any} */ p, /** @type {number} */ i) {
        map[p.id] = paths[i];
      });
      return Promise.resolve(q.placeBulletin(map)).then(function (/** @type {any} */ placed) {
        if (!placed || !placed.ok) return _bltQueuedDrop(cid, entry, { giveBack: true, deleteOnServer: true });
        _bltEntryChange(cid, key, function (e) {
          e.placed = true;
        });
        q.send();
        return null;
      });
    })
    .then(null, function (/** @type {any} */ e) {
      console.warn('A bulletin upload could not start:', e);
    })
    .then(function () {
      delete _bltPlacing[key];
    });
  _bltPlacing[key] = run;
  return run;
}

/**
 * A page of a waiting bulletin goes up to the bucket, only to a path in its
 * own class's folder. Refused (the server's row is no longer uploading): the
 * file is asked about, and one the server no longer has is let go.
 * @param {string} path @param {Blob} blob @param {any} info
 */
function _bltQueueUpload(path, blob, info) {
  var sb = /** @type {any} */ (getSupabase());
  if (!sb || !sb.storage) return Promise.resolve({ error: { message: 'offline: no client', status: 503 } });
  var ids = (info && info.ids) || {};
  var m = BULLETIN_PAGE_PATH.exec(String(path));
  if (!m || m[1] !== String(ids.course || '').toLowerCase()) {
    return Promise.resolve({ error: { message: 'not a page of this class', status: 422 } });
  }
  return Promise.resolve(_signInWait)
    .then(function () {
      var jpeg = blob && blob.type === 'image/jpeg' ? blob : new Blob([blob], { type: 'image/jpeg' });
      return sb.storage.from(BULLETIN_BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: false });
    })
    .then(function (/** @type {any} */ res) {
      var err = (res && res.error) || null;
      var status = Number(err && (err.statusCode || err.status)) || 0;
      if (
        !err ||
        !(status === 403 || status === 400 || /row-level security|unauthori[sz]ed/i.test(String(err.message)))
      )
        return { error: err };
      // Refused: is the bulletin still there? A file the server no longer has is gone.
      var cid = String(ids.course);
      var key = String(ids.key);
      if (!_bltEntry(cid, key)) return { error: null }; // let go meanwhile: its pages go with the commit
      var fileId = String(path).split('/')[1];
      var finish = { p_bulletin_file_id: fileId, p_idempotency_key: fileId };
      var quiet = { suppressSessionExpiredModal: true };
      return Promise.resolve(_callRpcWithAuthGuard('finish_bulletin_file', finish, quiet)).then(
        function (/** @type {any} */ ans) {
          var data = _rpcObject(ans && ans.data);
          if (!ans || ans.error || !data || data.status !== 'gone') return { error: err };
          return _bltQueuedGone(cid, key).then(function () {
            return { error: null };
          });
        },
      );
    });
}

/**
 * The photo queue's commit for a bulletin: every page is up. Each file is
 * finished (finish_bulletin_file, keyed by the file's own id, the same on
 * every try); when the last is ready the server shows the bulletin to
 * students. Answers { error } as the queue reads it: none once it is
 * visible (or let go), a passing one while the server still misses a page
 * (each goes again), and the call's own error otherwise. One taken back
 * while this ran is deleted once it is finished.
 * @param {{ kind: string, key: string, batch: string, ids: { course: string }, files: { id: string, file: string | null, page: number }[] }} batch
 */
async function _bltQueueCommit(batch) {
  var cid = String((batch && batch.ids && batch.ids.course) || '');
  var entry = cid ? _bltEntry(cid, batch.key) : null;
  // Taken back, or let go: nothing is finished, and the pages go.
  if (!entry || entry.takenBack) return { error: null };
  var key = entry.key;
  _bltCommitting[key] = true;
  try {
    /** @type {string[]} */
    var fileIds = [];
    (batch.files || []).forEach(function (f) {
      if (f.file && fileIds.indexOf(f.file) < 0) fileIds.push(f.file);
    });
    if (!fileIds.length) return { error: { message: 'no bulletin file', status: 422 } };
    var quiet = { suppressSessionExpiredModal: true };
    /** @type {any} */
    var last = null;
    for (var i = 0; i < fileIds.length; i++) {
      var fid = fileIds[i];
      var finish = { p_bulletin_file_id: fid, p_idempotency_key: fid };
      var res = await _callRpcWithAuthGuard('finish_bulletin_file', finish, quiet);
      if (!res || res.error) return { error: (res && res.error) || { message: 'no answer', status: 503 } };
      var data = _rpcObject(res.data) || {};
      if (data.status === 'gone') {
        delete _bltCommitting[key];
        await _bltQueuedGone(cid, key);
        return { error: null };
      }
      if (Array.isArray(data.bad) && data.bad.length) {
        // A page there but not a picture of that size cannot be replaced: the bulletin goes.
        var bad = _bltEntry(cid, key);
        if (bad) await _bltQueuedDrop(cid, bad, { giveBack: !bad.takenBack, deleteOnServer: true });
        return { error: null };
      }
      var missing = Array.isArray(data.missing) ? data.missing.map(Number) : [];
      if (missing.length) {
        var q = /** @type {any} */ (window.PhotoQueue);
        var again = (batch.files || []).filter(function (f) {
          return f.file === fid && missing.indexOf(Number(f.page)) >= 0;
        });
        await Promise.all(
          again.map(function (f) {
            return Promise.resolve(q && q.retry(f.id, { again: true })).then(null, function () {});
          }),
        );
        return { error: { message: 'missing_pages', status: 503 } };
      }
      last = data.bulletin || last;
    }
    // Taken back while this ran: it may have reached students, so it is deleted.
    var now = _bltEntry(cid, key);
    if (now && now.takenBack && last && _isUuid(last.id)) {
      await _bltDeleteTakenBack(cid, now, String(last.id));
      return { error: null };
    }
    if (last && _isUuid(last.id)) _bltPlace(cid, last);
    if (!_bltSigningOut()) _bltDropPending(cid, key);
    _bltReleaseDevicePicture(key);
    _bltWriteBegan(cid);
    _bltChanged(cid);
    refreshBulletins(cid, { force: true });
    return { error: null };
  } finally {
    delete _bltCommitting[key];
  }
}

/**
 * The server no longer has the bulletin's file: it is let go, whatever the
 * clocks say, and never posted again by the phone. Its pages go and its words
 * come back once, saying it was not posted. The entry is read again here (a
 * caller's copy may be old); one with its commit in flight is left to it.
 * @param {string} cid @param {string} key
 */
function _bltQueuedGone(cid, key) {
  var entry = _bltEntry(cid, key);
  if (!entry || _bltCommitting[key] || _bltSigningOut()) return Promise.resolve();
  if (entry.takenBack) return _bltQueuedDrop(cid, entry, {});
  return _bltQueuedDrop(cid, entry, { giveBack: true });
}

/**
 * A taken-back bulletin the server made anyway: deleted, under a key kept in
 * the entry (the outbox retries it; a reload sends it again with the same
 * key). The entry goes once the delete lands.
 * @param {string} cid @param {BulletinWaiting} entry @param {string} id
 */
function _bltDeleteTakenBack(cid, entry, id) {
  if (!_isUuid(id) || _bltSigningOut()) return Promise.resolve();
  var key = entry.deleteKey || _newEntryId();
  _bltEntryChange(cid, entry.key, function (e) {
    e.deleteKey = key;
    e.deleteId = id;
  });
  return Promise.resolve(
    _writeRpc('delete_bulletin', { p_bulletin_id: id, p_idempotency_key: key }, { entryId: key }),
  ).then(function (/** @type {any} */ res) {
    var gone = !res || !res.error || res.error.code === 'P0002';
    if (gone) {
      var now = _bltEntry(cid, entry.key);
      if (now) _bltQueuedDrop(cid, now, {});
    }
  });
}

/**
 * What a list read says about a waiting entry. Taken back: deleted on the
 * server if it is there. Seen by students: done. The server's row still
 * uploading: its pages are placed, if they were not. Not listed once the
 * server answered (and not cut short, and nothing in flight): let go.
 * @param {string} cid @param {BulletinWaiting} entry @param {Bulletin | null} row @param {boolean} more the list was cut short
 */
function _bltQueuedSeen(cid, entry, row, more) {
  if (entry.takenBack) {
    if (row) {
      if (!entry.deleteKey || entry.deleteId !== row.id) _bltDeleteTakenBack(cid, entry, row.id);
    } else if (entry.deleteKey || (!_bltOutboxHas(entry.key) && !entry.server)) {
      _bltQueuedDrop(cid, entry, {});
    }
    return;
  }
  if (row && row.visible) {
    _bltQueuedDrop(cid, entry, {});
    return;
  }
  if (row && !entry.placed) {
    _bltQueuedTake(cid, entry, {
      id: row.id,
      visible: false,
      posted_at: null,
      files: row.files.map(function (f) {
        return { id: f.id, position: f.position, paths: f.paths };
      }),
    });
    return;
  }
  if (!row && entry.server && !more && !_bltCommitting[entry.key] && !_bltPlacing[entry.key]) {
    _bltQueuedGone(cid, entry.key);
  }
}

/** Hook (shared/data-bulletins.js): the class's list was read. @param {string} cid @param {Bulletin[]} list */
function _bltQueuedSeenAll(cid, list) {
  /** @type {Record<string, Bulletin>} */
  var rows = {};
  list.forEach(function (b) {
    if (b.idempotency_key) rows[b.idempotency_key] = b;
  });
  var more = !!_bltMemory(cid).meta.more;
  _bltPending(cid).forEach(function (e) {
    if (!e.queued) return;
    var dead = _bltDeadFor(e.key);
    if (dead) {
      _bltQueuedAnswered(cid, e.key, { error: { code: dead.last_code, message: dead.last_error } });
      return;
    }
    _bltQueuedSeen(cid, e, rows[e.key] || null, more);
  });
}

/**
 * Hook (shared/data-bulletins.js, getBulletins): a post whose pages are on
 * this device shows from the device (its photo is here), not as the server's
 * empty row; a bulletin taken back shows nowhere.
 * @param {string} cid @param {Bulletin[]} list
 */
function _bltQueuedView(cid, list) {
  /** @type {Record<string, boolean>} */
  var mine = {};
  /** @type {Record<string, boolean>} */
  var hidden = {};
  _bltPending(cid).forEach(function (e) {
    if (!e.queued) return;
    if (e.takenBack) hidden[e.key] = true;
    else mine[e.key] = true;
    if (e.takenBack && e.deleteId) hidden[e.deleteId] = true;
    if (e.takenBack && e.server) hidden[e.server.id] = true;
  });
  return list.filter(function (b) {
    var k = b.idempotency_key || '';
    if (hidden[b.id] || (k && hidden[k])) return false;
    return !(k && mine[k] && !b.visible);
  });
}

/** Hook (shared/data-bulletins.js, the outbox's word on a post): true when it was a queued one. @param {string} kind @param {string} cid @param {string} key @param {any} meta */
function _bltQueuedEvent(kind, cid, key, meta) {
  if (!cid || !key || (kind !== 'flush:success' && kind !== 'flush:dead-letter')) return false;
  var held = _bltEntry(cid, key);
  if (!held || !held.queued) return false;
  _bltQueuedAnswered(
    cid,
    key,
    kind === 'flush:success'
      ? { data: meta.data, error: null }
      : { data: null, error: (meta.result && meta.result.error) || { message: meta.error || 'refused' } },
  );
  return true;
}

/** The server's row for a post this phone made, by its key, as last read. @param {string} cid @param {string} key */
function _bltRowByKey(cid, key) {
  return (
    _bltMemory(cid).list.filter(function (b) {
      return b.idempotency_key === key;
    })[0] || null
  );
}

/**
 * Where Take It Back stands for a key, now (the phone asks when OK is
 * tapped): 'waiting' (not posted yet: taking it back means students never
 * see it), 'sent' (it may have reached students: it is deleted), or 'none'.
 * @param {string} cid @param {string} key
 */
function bulletinTakeBackState(cid, key) {
  var entry = _bltEntry(cid, key);
  if (entry && entry.queued && !entry.takenBack) return _bltCommitting[key] ? 'sent' : 'waiting';
  if (entry && !entry.queued) return 'waiting';
  return _bltRowByKey(cid, key) ? 'sent' : 'none';
}

/**
 * Hook (shared/data-bulletins.js, takeBackBulletin): null when the key is
 * neither a queued post nor one this phone's queued post became. Taken back
 * it never sends: marked (saved), its pages gone at once, its post taken out
 * of the outbox when it can be; a post already on its way or answered is
 * deleted on the server when its answer lands. One already sent (its entry
 * gone, the server's row known by its key) is deleted through
 * deleteBulletin.
 * @param {string} cid @param {string} key
 * @returns {boolean | null}
 */
function _bltQueuedTakeBack(cid, key) {
  var entry = _bltEntry(cid, key);
  if (!entry) {
    var row = _bltRowByKey(cid, key);
    if (!row || !_isUuid(row.id)) return null;
    deleteBulletin(cid, row.id);
    return true;
  }
  if (!entry.queued) return null;
  if (entry.takenBack) return true;
  _bltEntryChange(cid, key, function (e) {
    e.takenBack = true;
  });
  entry.takenBack = true;
  _bltReleaseDevicePicture(key);
  _bltForgetPages(entry);
  var q = window.v2Queue;
  var removed = !entry.server && !!q && typeof q.remove === 'function' && q.remove(key);
  if (removed) _bltQueuedDrop(cid, entry, {});
  else if (entry.server && !_bltCommitting[key]) _bltDeleteTakenBack(cid, entry, entry.server.id);
  _bltWriteBegan(cid);
  _bltChanged(cid);
  return true;
}

/**
 * A waiting bulletin's first page, from the device: { url, release } or
 * null. Signed in only (Demo Mode keeps its pictures in the bulletin).
 * @param {string} key
 */
function getBulletinWaitingPicture(key) {
  if (!key || _isDemoSession()) return Promise.resolve(null);
  if (_bltDevicePictures[key]) return Promise.resolve(_bltDevicePictures[key]);
  var q = /** @type {any} */ (window.PhotoQueue);
  if (!q || typeof q.pages !== 'function' || typeof q.blobs !== 'function') return Promise.resolve(null);
  return Promise.resolve(q.ready && q.ready())
    .then(function () {
      var first = _bltPagesOf(q, { key: key })[0];
      return first ? q.blobs(first.id) : null;
    })
    .then(function (/** @type {any} */ held) {
      if (!held || !held.photo || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
      if (_bltDevicePictures[key]) return _bltDevicePictures[key];
      var url = URL.createObjectURL(held.photo);
      var pic = {
        url: url,
        release: function () {
          URL.revokeObjectURL(url);
          delete _bltDevicePictures[key];
        },
      };
      _bltDevicePictures[key] = pic;
      return pic;
    })
    .then(null, function () {
      return null;
    });
}

/** @param {string} key */
function _bltReleaseDevicePicture(key) {
  var pic = _bltDevicePictures[key];
  if (pic) pic.release();
}

/** Let go of every waiting bulletin's picture (the tab was left). */
function releaseBulletinWaitingPictures() {
  Object.keys(_bltDevicePictures).forEach(_bltReleaseDevicePicture);
}

/**
 * The phone's start (MBulletins.boot): every waiting post is reconciled, so
 * an answer the outbox got before anything listened is never missed. A post
 * the outbox gave up on is let go; one it no longer holds with no answer
 * kept is sent again under the same key (the server answers its first reply:
 * it posts once); an answered one has its pages placed and sent, and a page
 * a tab without bulletin uploads marked failed is tried once more. Bulletin
 * pages no entry holds are removed. Never in Demo Mode.
 */
function resumeBulletinUploads() {
  if (_isDemoSession() || !_writesEnabled()) return;
  _bltListen();
  var waiting = _bltAllQueued();
  if (!waiting || !waiting.length) {
    _bltSweepOrphans();
    return;
  }
  var q = _bltQueue();
  if (!q) return;
  var list = waiting;
  Promise.resolve(q.ready && q.ready()).then(function () {
    list.forEach(function (w) {
      // Read again: the outbox may have answered while the queue was opening.
      var e = _bltEntry(w.cid, w.entry.key);
      if (!e) return;
      var dead = _bltDeadFor(e.key);
      if (dead) return _bltQueuedAnswered(w.cid, e.key, { error: { code: dead.last_code, message: dead.last_error } });
      if (e.takenBack) {
        if (e.deleteId) return _bltDeleteTakenBack(w.cid, e, e.deleteId);
        if (e.server) return _bltDeleteTakenBack(w.cid, e, e.server.id);
        if (!_bltOutboxHas(e.key)) return _bltQueuedSend(w.cid, e.key); // its answer names what to delete
        return;
      }
      if (e.server) {
        if (!e.retriedFailed) {
          var failed = _bltPagesOf(q, e).filter(function (/** @type {any} */ p) {
            return p.state === 'failed' && p.path;
          });
          if (failed.length) {
            _bltEntryChange(w.cid, e.key, function (x) {
              x.retriedFailed = true;
            });
            failed.forEach(function (/** @type {any} */ p) {
              q.retry(p.id);
            });
          }
        }
        return _bltPlacePages(w.cid, e.key);
      }
      if (!_bltOutboxHas(e.key)) _bltQueuedSend(w.cid, e.key);
    });
    _bltSweepOrphans().then(function () {
      q.send();
    });
  });
}
