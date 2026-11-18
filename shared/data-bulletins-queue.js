// @ts-check
/* data-bulletins-queue.js — the phone's post whose pages wait in the photo
   queue (docs/plans/bulletins-plan.md, slice B1f). Part of the Bulletins data
   layer (shared/data-bulletins.js, loaded first), in a file of its own for
   its size. Loaded by the phone (teacher-mobile/index.html); the desktop
   page posts its files online and does not load it, so shared/data-bulletins.js
   calls into this file only where it is there.

   The flow, each step kept on the device so a reload takes it up again:
   postBulletin(cid, draft, files, { queue: true }) keeps every page in
   shared/photo-queue.js (kind 'bulletin', under the bulletin's device key) and
   the bulletin in gb-bulletins-pending-<cid> as Not Sent Yet; post_bulletin
   goes through the outbox under that key; its answer is kept in the entry
   (server) and names each page's path (PhotoQueue.placeBulletin); the queue
   uploads the pages (_bltQueueUpload) and its commit finishes each file
   (_bltQueueCommit, finish_bulletin_file), after which students can see it.
   Missing pages go again; a gone upload is posted once more with a new key;
   a refusal lets the bulletin go and gives its words back (bulletinGivenBack).
   Trouble shows only on the sync dot. */

/* ── The phone: a post whose pages wait in the photo queue (B1f) ─────────── */

var BULLETIN_PAGE_PATH =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f-]{36}\/([1-9]|1[0-9]|20)\.jpg$/;
var _bltQueueWired = false;
/** @type {Record<string, Promise<any> | undefined>} */
var _bltPlacing = {}; // key → placing its pages now
/** @type {Record<string, { url: string, release: () => void }>} */
var _bltDevicePictures = {}; // a waiting bulletin's first page, from the device

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

/** The pages of a waiting bulletin in the queue, in order. Every key it was posted under. @param {any} q @param {BulletinWaiting | { key: string, old?: string[] }} entry */
function _bltPagesOf(q, entry) {
  var keys = [String(entry.key).toLowerCase()].concat(
    (entry.old || []).map(function (k) {
      return String(k).toLowerCase();
    }),
  );
  var pages = q && typeof q.pages === 'function' ? q.pages() : [];
  return pages
    .filter(function (/** @type {any} */ p) {
      return p.kind === 'bulletin' && p.ids && keys.indexOf(String(p.ids.key).toLowerCase()) >= 0;
    })
    .sort(function (/** @type {any} */ a, /** @type {any} */ b) {
      return (a.order || 0) - (b.order || 0);
    });
}

/** Remove a waiting bulletin's pages from the queue: nothing is left behind. @param {BulletinWaiting | { key: string, old?: string[] }} entry */
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

/** The returned words of class cid, kept for the composer. @param {string} cid */
function _bltReturnedKey(cid) {
  return 'gb-bulletins-returned-' + cid;
}

/**
 * A waiting bulletin that will never be sent: its entry and its pages go.
 * opts.giveBack keeps its words (and the server's sentence) for the composer
 * the next time it opens; opts.deleteOnServer deletes the half-made bulletin
 * the server holds (students never saw it).
 * @param {string} cid @param {BulletinWaiting} entry
 * @param {{ giveBack?: boolean, message?: string, deleteOnServer?: boolean }} opts
 */
function _bltQueuedDrop(cid, entry, opts) {
  _bltDropPending(cid, entry.key);
  delete _bltPlacing[entry.key];
  if (opts.giveBack) {
    _safeLSSet(
      _bltReturnedKey(cid),
      JSON.stringify({ bulletin: entry.bulletin || {}, message: opts.message || '', at: new Date().toISOString() }),
    );
  }
  if (opts.deleteOnServer && entry.server && _isUuid(entry.server.id)) {
    _writeRpc('delete_bulletin', { p_bulletin_id: entry.server.id, p_idempotency_key: _newEntryId() });
  }
  _bltReleaseDevicePicture(entry.key);
  _bltWriteBegan(cid);
  _bltChanged(cid);
  return _bltForgetPages(entry);
}

/**
 * Words the server refused, or a post that could not be sent, given back
 * once: { bulletin: { kind, body, link_url, … }, message } or null. Taking
 * them clears them.
 * @param {string} cid
 * @returns {{ bulletin: Record<string, any>, message: string } | null}
 */
function bulletinGivenBack(cid) {
  if (!cid) return null;
  var kept = _safeParseLS(_bltReturnedKey(cid), null);
  try {
    localStorage.removeItem(_bltReturnedKey(cid));
  } catch (e) {
    /* storage blocked */
  }
  if (!kept || typeof kept !== 'object' || !kept.bulletin || typeof kept.bulletin !== 'object') return null;
  return { bulletin: kept.bulletin, message: String(kept.message || '') };
}

/**
 * Keep the pages in the photo queue, the entry as Not Sent Yet, and send
 * post_bulletin through the outbox under the device's key.
 * @param {string} cid @param {Record<string, any>} payload
 * @param {{ kind: string, title: string, pages: { blob: Blob, hash?: string, width?: number, height?: number, name?: string }[] }[]} files
 * @returns {Promise<{ ok: boolean, message?: string, waiting?: boolean, key?: string }>}
 */
function _bltQueuedPost(cid, payload, files) {
  var q = _bltQueue();
  if (!q) return Promise.resolve({ ok: false, message: "Photos can't be kept on this device." });
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
  return Promise.resolve(q.addBulletin({ course: cid, key: key }, pageList)).then(function (/** @type {any} */ added) {
    if (!added || !added.ok) {
      return {
        ok: false,
        message:
          added && added.reason === 'storage_full'
            ? 'This phone is full. Free some space, then try again.'
            : "The photo couldn't be kept on this phone. Try again.",
      };
    }
    var pending = _bltPending(cid);
    pending.push({ key: key, at: new Date().toISOString(), bulletin: payload, files: meta, queued: true, tries: 0 });
    _bltSavePending(cid, pending);
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
 * post_bulletin answered (here, or from the outbox's event after a reload).
 * A refusal lets the bulletin go and gives its words back; an answer keeps
 * the paths in the entry (so a reload can place them) and places the pages.
 * Runs once per answer; a second call changes nothing.
 * @param {string} cid @param {string} key @param {any} res
 */
function _bltQueuedAnswered(cid, key, res) {
  var entry = _bltEntry(cid, key);
  if (!entry || !entry.queued) return Promise.resolve();
  if (res && res.error) {
    if (res.error.cancelled) return Promise.resolve(); // taken back: already let go
    return _bltQueuedDrop(cid, entry, { giveBack: true, message: _bltMessage(res.error) });
  }
  var data = _rpcObject(res && res.data);
  var posted = data && data.bulletin;
  if (!posted || !_isUuid(posted.id)) return Promise.resolve();
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
  }
  return _bltPlacePages(cid, entry.key);
}

/** Give each waiting page the path the server named for it, in order, and send. @param {string} cid @param {string} key */
function _bltPlacePages(cid, key) {
  if (_bltPlacing[key]) return _bltPlacing[key];
  var found = _bltEntry(cid, key);
  var q = _bltQueue();
  if (!found || !found.server || !q) return Promise.resolve();
  /** @type {BulletinWaiting} */
  var entry = found;
  var server = found.server;
  var run = Promise.resolve(q.ready && q.ready())
    .then(function () {
      var pages = _bltPagesOf(q, { key: key });
      /** @type {string[]} */
      var paths = [];
      server.files.forEach(function (f) {
        f.paths.forEach(function (p) {
          paths.push(p);
        });
      });
      var own = paths.every(function (p) {
        var m = BULLETIN_PAGE_PATH.exec(String(p).toLowerCase());
        return !!m && m[1] === String(cid).toLowerCase();
      });
      if (!pages.length) {
        // The pages are no longer on this device: nothing can be sent.
        return _bltQueuedDrop(cid, entry, { giveBack: true, deleteOnServer: true });
      }
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

/** A page of a waiting bulletin goes up to the bucket, at a path of its class only. @param {string} path @param {Blob} blob */
function _bltQueueUpload(path, blob) {
  var sb = /** @type {any} */ (getSupabase());
  if (!sb || !sb.storage) return Promise.resolve({ error: { message: 'offline: no client', status: 503 } });
  if (!BULLETIN_PAGE_PATH.test(String(path)))
    return Promise.resolve({ error: { message: 'not a bulletin page', status: 422 } });
  return Promise.resolve(_signInWait)
    .then(function () {
      var jpeg = blob && blob.type === 'image/jpeg' ? blob : new Blob([blob], { type: 'image/jpeg' });
      return sb.storage.from(BULLETIN_BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: false });
    })
    .then(function (/** @type {any} */ res) {
      return { error: (res && res.error) || null };
    });
}

/**
 * The photo queue's commit for a bulletin: every page is up. Each file is
 * finished (finish_bulletin_file, keyed by the file's own id, the same on
 * every try); when the last is ready the server shows the bulletin to
 * students. Answers { error } as the queue reads it: none once it is
 * visible (or let go), a passing one while the server still misses a page
 * (each goes again), and the call's own error otherwise.
 * @param {{ kind: string, key: string, batch: string, ids: { course: string }, files: { id: string, file: string | null, page: number }[] }} batch
 */
async function _bltQueueCommit(batch) {
  var cid = String((batch && batch.ids && batch.ids.course) || '');
  var entry = cid ? _bltEntry(cid, batch.key) : null;
  // Taken back, or let go: nothing is finished, and the pages go.
  if (!entry) return { error: null };
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
    // @ts-expect-error finish_bulletin_file is not in types/database.d.ts until the migration is applied and the types are regenerated.
    var res = await _callRpcWithAuthGuard('finish_bulletin_file', finish, quiet);
    if (!res || res.error) return { error: (res && res.error) || { message: 'no answer', status: 503 } };
    var data = _rpcObject(res.data) || {};
    if (data.status === 'gone') {
      return _bltQueuedGone(
        cid,
        entry,
        (batch.files || []).map(function (f) {
          return f.id;
        }),
      );
    }
    if (Array.isArray(data.bad) && data.bad.length) {
      // A page there but not a picture of that size cannot be replaced: the bulletin goes.
      await _bltQueuedDrop(cid, entry, { giveBack: true, deleteOnServer: true });
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
  if (last && _isUuid(last.id)) _bltPlace(cid, last);
  _bltDropPending(cid, entry.key);
  _bltReleaseDevicePicture(entry.key);
  _bltWriteBegan(cid);
  _bltChanged(cid);
  refreshBulletins(cid, { force: true });
  return { error: null };
}

/**
 * The server dropped the upload (two hours passed, or the bulletin went):
 * posted again once, with a new key, from the pages still held; a second
 * time, or with no pages, it is let go and its words given back.
 * pageIds: the queue's ids of its pages, in order.
 * @param {string} cid @param {BulletinWaiting} entry @param {string[]} pageIds
 */
async function _bltQueuedGone(cid, entry, pageIds) {
  var q = _bltQueue();
  /** @type {{ file: number, page: number }[]} */
  var places = [];
  (entry.files || []).forEach(function (f, fi) {
    for (var n = 1; n <= Math.max(1, Number(f.pages) || 1); n++) places.push({ file: fi, page: n });
  });
  if ((entry.tries || 0) >= 1 || !q || !pageIds.length || pageIds.length !== places.length) {
    await _bltQueuedDrop(cid, entry, { giveBack: true });
    return { error: null };
  }
  /** @type {any[]} */
  var pageList = [];
  for (var i = 0; i < pageIds.length; i++) {
    var held = await Promise.resolve(q.blobs(pageIds[i])).then(null, function () {
      return null;
    });
    if (!held || !held.photo) {
      await _bltQueuedDrop(cid, entry, { giveBack: true });
      return { error: null };
    }
    pageList.push({ blob: held.photo, file: places[i].file, page: places[i].page });
  }
  var key = _newEntryId();
  var added = await Promise.resolve(q.addBulletin({ course: cid, key: key }, pageList)).then(null, function () {
    return null;
  });
  if (!added || !added.ok) {
    await _bltQueuedDrop(cid, entry, { giveBack: true });
    return { error: null };
  }
  var was = entry.key;
  _bltEntryChange(cid, was, function (e) {
    e.old = (e.old || []).concat(was);
    e.key = key;
    e.tries = (e.tries || 0) + 1;
    delete e.server;
    delete e.placed;
  });
  _bltReleaseDevicePicture(was);
  _bltChanged(cid);
  _bltQueuedSend(cid, key);
  // The old pages go: the queue removes them when this answers (a commit), or here (a list read).
  await Promise.all(
    pageIds.map(function (id) {
      return Promise.resolve(q.remove(id)).then(null, function () {});
    }),
  );
  return { error: null };
}

/**
 * What a list read says about a waiting entry: seen by students (done), the
 * server's row still uploading (its pages are placed, if they were not), or
 * not there two hours after it was answered (gone).
 * @param {string} cid @param {BulletinWaiting} entry @param {Bulletin | null} row
 */
function _bltQueuedSeen(cid, entry, row) {
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
  if (!row && entry.server && Date.now() - Date.parse(entry.at) > 2 * 3600 * 1000) {
    var q = _bltQueue();
    if (!q) return;
    // Its pages, if any are still held, are posted again (or the bulletin is let go).
    _bltQueuedGone(
      cid,
      entry,
      _bltPagesOf(q, { key: entry.key }).map(function (/** @type {any} */ p) {
        return p.id;
      }),
    );
  }
}

/** Take back a waiting bulletin whose pages are on this device. @param {string} cid @param {BulletinWaiting} entry */
function _bltQueuedTakeBack(cid, entry) {
  var q = window.v2Queue;
  if (!entry.server) {
    if (!q || typeof q.remove !== 'function' || !q.remove(entry.key)) return false;
  }
  _bltQueuedDrop(cid, entry, { deleteOnServer: true });
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

/**
 * After a reload (the phone's boot, or the tab opening): every waiting post
 * whose pages are on this device is taken up where it stopped. Its answer
 * placed, its pages sent. Never in Demo Mode.
 */
function resumeBulletinUploads() {
  if (_isDemoSession() || !_writesEnabled()) return;
  _bltListen();
  var q = _bltQueue();
  if (!q) return;
  /** @type {string[]} */
  var keys = [];
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var name = localStorage.key(i);
      if (name) keys.push(name);
    }
  } catch (e) {
    return;
  }
  keys.forEach(function (k) {
    if (k.indexOf('gb-bulletins-pending-') !== 0) return;
    var cid = k.slice('gb-bulletins-pending-'.length);
    _bltPending(cid).forEach(function (e) {
      if (!e.queued) return;
      if (e.server) _bltPlacePages(cid, e.key);
      else if (!_bltOutboxHas(e.key) && Date.now() - Date.parse(e.at) > 120000) {
        // Its post is not in the outbox and no answer was kept: send it again under the same key (posts once).
        _bltQueuedSend(cid, e.key);
      }
    });
  });
  q.send();
}
