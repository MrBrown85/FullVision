// @ts-check
/* shared/data-handout-files.js — handout files on an assessment (the data layer)

   Colin, Nov 17 2026: "+ Add a PDF" becomes "+ Add a File" (DECISIONS,
   Handouts and Links 6 to 11; migrations/2026111706_handout_files.sql; the
   contract is handouts-links-contract.md, "Handout files"). A web page, a
   text file or an EPUB is kept as the teacher chose it, 20 MB at most: kind
   'html' | 'txt' | 'epub', one file in the bucket handout-files at
   <class>/<resource>.<kind>, through start_handout_file and
   finish_handout_file, waiting in the photo queue as a one-page handout
   with its own type. The student page opens it through the edge function's
   handout-file route; a web page or a book only in the sealed frame
   (shared/handout-viewer.js).

   The rows, the upload's record and the photo queue's commit are shared/
   data.js's Handouts and Links, which hands a file's turns to the helpers
   here. Opening a PDF handout's page (openAssessmentHandoutPage) is here
   too, beside opening a file. Loaded after shared/data-student-work.js,
   wherever the data layer is. */

// A handout file's kinds, each with the one type it is kept and sent as, and its limit (the bucket's).
var RESOURCE_FILE_KINDS = { html: 'text/html', txt: 'text/plain', epub: 'application/epub+zip' };
var RESOURCE_FILE_MAX_BYTES = 20971520;
/** @param {unknown} kind */
function _resIsFileKind(kind) {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(RESOURCE_FILE_KINDS, kind);
}

// A handout file's name in handout-files: <class>/<resource>.<kind>.
var _HANDOUT_FILE_STORAGE_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(html|txt|epub|pdf)$/;

/* Add a handout file to assessment `aid`: a web page, a text file or an
   EPUB (`kind` 'html' | 'txt' | 'epub'), `blob` its bytes as they are to be
   kept (a web page's pictures already inside it), 20 MB at most. `title`
   is the name students see. → Promise of { ok: true, resource } or { ok:
   false, reason: 'not_a_file_kind' | 'empty' | 'too_large' |
   'storage_full' | 'store_failed' | 'no_photo_store' | 'not_available' }. */
function addAssessmentHandoutFile(cid, aid, title, kind, blob) {
  if (!_resIsFileKind(kind)) return Promise.resolve({ ok: false, reason: 'not_a_file_kind' });
  if (!blob || !(blob.size > 0)) return Promise.resolve({ ok: false, reason: 'empty' });
  if (blob.size > RESOURCE_FILE_MAX_BYTES) return Promise.resolve({ ok: false, reason: 'too_large' });
  if (!assessmentResourcesOffered(cid) || !aid) return Promise.resolve({ ok: false, reason: 'not_available' });
  var live = _resLive(cid);
  var q = /** @type {any} */ (live ? _wireWorkQueue() : window.PhotoQueue);
  if (!q || typeof q.addHandout !== 'function') return Promise.resolve({ ok: false, reason: 'no_photo_store' });
  var rid = _resLocalId();
  var name = _resTitle(title, 'Handout');
  var mime = RESOURCE_FILE_KINDS[kind];
  var typed = blob.type === mime ? blob : new Blob([blob], { type: mime });
  return Promise.resolve(q.addHandout({ course: cid, assessment: aid, resource: rid }, [{ blob: typed, mime: mime }]))
    .then(function (res) {
      if (!res || !res.ok)
        return { ok: false, reason: res && res.reason === 'storage_full' ? 'storage_full' : 'store_failed' };
      var draft = _resDraft(cid);
      var row = {
        id: rid,
        assessment_id: aid,
        kind: kind,
        title: name,
        url: null,
        page_count: null,
        bytes: typed.size,
        status: live ? 'uploading' : 'ready',
        position: _resNextPosition(draft.rows, aid),
        created_at: new Date().toISOString(),
        pages: null,
        file: 'photo-queue:' + res.ids[0],
      };
      draft.rows.push(row);
      _resWrite(cid, draft);
      if (live) _handoutStart(cid, aid, rid, name, res, { kind: kind, bytes: typed.size });
      _resChanged(cid);
      return { ok: true, resource: _resRowOut(row) };
    })
    .then(null, function () {
      return { ok: false, reason: 'store_failed' };
    });
}

/* start_handout_file through the outbox, keyed so a retry is the same start
   (data.js _handoutStart; named as written, so scripts/check-db-drift.mjs sees it). */
function _handoutFileStartCall(aid, title, file, key) {
  return _rpcOrNoop(
    'start_handout_file',
    { p_assessment_id: aid, p_title: title, p_kind: file.kind, p_bytes: file.bytes, p_idempotency_key: key },
    { entryId: key },
  );
}

/* start_handout_file answered: the one path a file goes to, <class>/<resource>.<kind>
   of the kind it was started as, or none (the upload is given up). */
function _handoutFilePaths(rec, res, id) {
  var expected = id ? String(rec.cid).toLowerCase() + '/' + id + '.' + rec.kind : '';
  return id && res && res.path === expected ? [expected] : [];
}

// The photo queue's batch is a handout file's: its kind ('pdf' is a PDF handout's original), or '' (a PDF's pages are .jpg).
function _handoutFileKindOf(batch) {
  var path = String((((batch && batch.files) || [])[0] || {}).path || '');
  return (/\.(html|txt|epub|pdf)$/.exec(path) || [])[1] || '';
}

function _handoutFileFinishCall(finish, quiet) {
  return _callRpcWithAuthGuard('finish_handout_file', finish, quiet);
}

// finish_handout_file said ready: the row keeps the file's path and its stored size.
function _handoutFileReady(r, batch, row) {
  r.file = String(batch.files[0].path);
  if (Number(row.bytes) > 0) r.bytes = Number(row.bytes);
}

/* The photo queue's upload for a handout file (data-student-work.js
   _workUploadFile): to the bucket handout-files with its kind's type,
   never upsert. null for any other path (a JPEG page in student-photos). */
var _HANDOUT_FILE_UPLOAD_TYPES = {
  html: 'text/html',
  txt: 'text/plain',
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
};
function _handoutFileUpload(sb, path, blob) {
  var m = _HANDOUT_FILE_STORAGE_PATH.exec(String(path || ''));
  if (!m) return null;
  var kind = m[1];
  return Promise.resolve(_signInWait)
    .then(function () {
      // The type the bucket allows for this kind, on the bytes as kept (storage reads a Blob's own type).
      var type = _HANDOUT_FILE_UPLOAD_TYPES[kind];
      var typed = blob && blob.type === type ? blob : new Blob([blob], { type: type });
      return sb.storage.from('handout-files').upload(path, typed, { contentType: type, upsert: false });
    })
    .then(function (res) {
      return { error: (res && res.error) || null };
    });
}

/* Handout file `rid` of class `cid` (a web page, a text file or an EPUB),
   as the student page opens it: Promise of { kind, title, blob } or null.
   One still on this device comes from the photo queue; one on the server
   through a link signed for 300 seconds in the bucket handout-files, only
   at this class's and this handout's own name. The blob always carries its
   kind's type. What is inside is the teacher's: show it only through
   HandoutViewer (shared/handout-viewer.js). */
function openAssessmentHandoutFile(cid, rid) {
  var row = _resFind(cid, rid);
  if (!row || !_resIsFileKind(row.kind)) return Promise.resolve(null);
  var mime = RESOURCE_FILE_KINDS[row.kind];
  var done = function (blob) {
    return blob ? { kind: row.kind, title: String(row.title || ''), blob: new Blob([blob], { type: mime }) } : null;
  };
  var name = typeof row.file === 'string' ? row.file : '';
  if (!name && _isUuid(rid)) name = String(cid).toLowerCase() + '/' + String(rid).toLowerCase() + '.' + row.kind;
  var m = name ? _STUDENT_WORK_QUEUE_PATH.exec(name) : null;
  if (m) {
    var qid = m[1];
    var q = /** @type {any} */ (window.PhotoQueue);
    if (m[2] || !q || typeof q.blobs !== 'function') return Promise.resolve(null);
    return Promise.resolve()
      .then(function () {
        return q.blobs(qid);
      })
      .then(
        function (found) {
          return done(found && found.photo);
        },
        function () {
          return null;
        },
      );
  }
  var own = String(cid).toLowerCase() + '/' + String(rid).toLowerCase() + '.' + row.kind;
  if (_isDemoSession() || name !== own || !_HANDOUT_FILE_STORAGE_PATH.test(name)) return Promise.resolve(null);
  var sb = /** @type {any} */ (getSupabase());
  if (!sb || !sb.storage || typeof fetch !== 'function') return Promise.resolve(null);
  return Promise.resolve(_signInWait)
    .then(function () {
      return sb.storage.from('handout-files').createSignedUrl(name, STUDENT_WORK_LINK_SECONDS);
    })
    .then(function (res) {
      var link = res && !res.error && res.data && res.data.signedUrl;
      if (!link) return null;
      return fetch(link, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }).then(function (r) {
        return r && r.ok ? r.blob() : null;
      });
    })
    .then(done)
    .then(null, function () {
      return null;
    });
}

/* ── A PDF handout's original (2026112408) ──

   A PDF handout keeps its pages (the pictures) and also the PDF itself, whole, in
   handout-files at <class>/<resource>.pdf, so students can save and print it.
   The pages go first, as they always did. The original waits in the photo queue
   under the same resource id, as a second batch of one file typed application/pdf;
   once finish_handout_upload says the pages are ready, start_handout_original goes
   through the outbox (keyed, so a retry is the same start), the file uploads to the
   one name it answers, and finish_handout_original hands it in under the batch's
   key. Offline, each step waits. The original is only ever extra: any step that
   fails or is refused gives it up quietly (no banner, no sync-dot count) and the
   handout works from its pages, as every handout made before this does. */

/* Queue `original` (the PDF as the teacher picked it) beside a handout's pages.
   → Promise of { ids, batch, bytes }, or null when it is not kept (none, empty,
   over 20 MB, no room on this device). Never rejects. */
function _handoutOriginalQueue(q, cid, aid, rid, original) {
  if (!original || !(original.size > 0) || original.size > RESOURCE_FILE_MAX_BYTES) return Promise.resolve(null);
  var typed = original.type === 'application/pdf' ? original : new Blob([original], { type: 'application/pdf' });
  return Promise.resolve()
    .then(function () {
      return q.addHandout({ course: cid, assessment: aid, resource: rid }, [{ blob: typed, mime: 'application/pdf' }]);
    })
    .then(
      function (res) {
        return res && res.ok ? { ids: res.ids, batch: res.batch, bytes: typed.size } : null;
      },
      function () {
        return null;
      },
    );
}

// The original's name in handout-files: <class>/<resource>.pdf.
function _handoutOriginalPath(cid, rid) {
  return String(cid).toLowerCase() + '/' + String(rid).toLowerCase() + '.pdf';
}

// Change what the row keeps of its original: a path, 'photo-queue:<id>', or null.
function _handoutOriginalMark(cid, rid, value) {
  var draft = _resDraft(cid);
  var changed = false;
  draft.rows.forEach(function (r) {
    if (r.id === rid && (r.original || null) !== value) {
      r.original = value;
      changed = true;
    }
  });
  if (!changed) return;
  _resWrite(cid, draft);
  _resChanged(cid);
}

/* The original is given up: it leaves this device and the record goes. The
   handout stays, and keeps working from its pages. `path`: the original is
   on the server after all (a start answered ready). Never noted on the sync
   dot: nothing the teacher added is lost. */
function _handoutOriginalGiveUp(rec, path) {
  var all = _handoutUploads();
  delete all[rec.key];
  _handoutUploadsSave(all);
  _handoutOriginalMark(rec.cid, rec.rid, path || null);
  return _teacherWorkForget(rec.ids || []).then(function () {
    return null;
  });
}

// The pages are ready: the original's start goes through the outbox, keyed so a retry is the same start.
function _handoutOriginalStart(rec) {
  _rpcOrNoop(
    'start_handout_original',
    { p_resource_id: rec.rid, p_bytes: rec.bytes, p_idempotency_key: rec.key },
    { entryId: rec.key },
  ).then(function (res) {
    if (res && !res.error && res.data != null) _handoutOriginalStarted(rec.key, res.data);
  });
}

/* start_handout_original answered (from the call, or from the outbox's own
   event after a reload): the row with `original` and `original_path`. Only
   'uploading' at this class's and this handout's own name goes on: the
   waiting file takes the path and goes up. Anything else gives it up. Runs
   once per start. */
function _handoutOriginalStarted(key, data) {
  var rec = _handoutUploads()[key];
  if (!rec || rec.placed || rec.kind !== 'pdf-original') return Promise.resolve(null);
  var res = _rpcObject(data) || {};
  var want = _handoutOriginalPath(rec.cid, rec.rid);
  if (res.original === 'ready' && res.original_path === want) return _handoutOriginalGiveUp(rec, want);
  var q = /** @type {any} */ (_wireWorkQueue());
  if (
    res.original !== 'uploading' ||
    res.original_path !== want ||
    String(res.id || '').toLowerCase() !== String(rec.rid).toLowerCase() ||
    !q ||
    typeof q.placeHandout !== 'function' ||
    (rec.ids || []).length !== 1
  ) {
    return _handoutOriginalGiveUp(rec, null);
  }
  var map = {};
  map[rec.ids[0]] = want;
  return Promise.resolve(q.ready && q.ready())
    .then(function () {
      return q.placeHandout(map);
    })
    .then(function (placed) {
      if (!placed || !placed.ok) return _handoutOriginalGiveUp(rec, null);
      var now = _handoutUploads();
      if (now[key]) {
        now[key].placed = true;
        _handoutUploadsSave(now);
      }
      q.send();
      return null;
    })
    .then(null, function (e) {
      console.warn('A handout original could not start:', e);
      return null;
    });
}

// A PDF's original, once the server says it is ready: its name in handout-files, else null.
function _resOriginalOf(kind, row) {
  return kind === 'pdf' && row.original === 'ready' && typeof row.original_path === 'string' ? row.original_path : null;
}

// A row with an upload on this device, as the server lists it: its pages, status and original stay as they are here.
function _resKeepOwn(row, had) {
  return Object.assign({}, row, {
    pages: had.pages,
    status: had.status,
    original: row.original || had.original || null,
  });
}

/* The pages are ready (data.js _handoutCommit): the record of the original waiting beside them, put
   in `all` for its start, or null when there is none. */
function _handoutOriginalNext(all, rec, cid, rid) {
  if (!rec.original) return null;
  var key = _newEntryId();
  all[key] = {
    key: key,
    cid: cid,
    rid: rid,
    local: rid,
    title: rec.title,
    kind: 'pdf-original',
    ids: rec.original.ids,
    batch: rec.original.batch,
    bytes: rec.original.bytes,
  };
  return all[key];
}

/* The outbox's word on start_handout_original: refused or lost, the original is given up
   quietly; the handout works from its pages. */
function _handoutOriginalEvent(kind, key, data) {
  if (kind === 'flush:success') return _handoutOriginalStarted(key, data);
  var rec = _handoutUploads()[key];
  if (rec && rec.kind === 'pdf-original') _handoutOriginalGiveUp(rec, null);
}

/* The photo queue's commit for the original: it is in storage; finish_handout_original
   marks it ready under the batch's key. Answers { error } as the queue reads it: none once
   it is ready or given up, a passing one while the server says it is missing (sent again). */
async function _handoutOriginalCommit(batch) {
  var rid = batch && batch.ids && batch.ids.resource;
  if (!_isUuid(rid)) return { error: { message: 'no resource id', status: 422 } };
  var rec = _handoutUploadByBatch(batch.key);
  var finish = { p_resource_id: rid, p_idempotency_key: batch.key };
  var res = await _callRpcWithAuthGuard('finish_handout_original', finish, { suppressSessionExpiredModal: true });
  if (!res || res.error) return { error: (res && res.error) || { message: 'no answer', status: 503 } };
  var row = _rpcObject(res.data) || {};
  var cid = (rec && rec.cid) || batch.ids.course;
  var path = String((((batch && batch.files) || [])[0] || {}).path || '');
  if (row.original === 'ready') {
    if (rec) {
      var all = _handoutUploads();
      delete all[rec.key];
      _handoutUploadsSave(all);
    }
    _handoutOriginalMark(cid, rid, path);
    _resReadAfterWrite({ p_course_id: cid });
    return { error: null };
  }
  if (row.missing === true) {
    // Not in storage yet: the one file goes again.
    var q = /** @type {any} */ (window.PhotoQueue);
    var pages = q && typeof q.pages === 'function' ? q.pages() : [];
    await Promise.all(
      pages
        .filter(function (p) {
          return p.batch === batch.key;
        })
        .map(function (p) {
          return Promise.resolve(q.retry(p.id, { again: true })).then(null, function () {});
        }),
    );
    return { error: { message: 'missing_pages', status: 503 } };
  }
  // Another type or size (bad), given up by the server (dropped), or the handout is gone: nothing to hand in.
  if (rec) await _handoutOriginalGiveUp(rec, null);
  else _handoutOriginalMark(cid, rid, null);
  return { error: null };
}

/* A PDF handout's original `rid` of class `cid`, as a student's Save or Print would
   hand it over: Promise of { title, blob } (type application/pdf) or null when there
   is none. One still on this device comes from the photo queue; one on the server
   through a link signed for 300 seconds in handout-files, only at this class's and
   this handout's own name. */
function openAssessmentHandoutOriginal(cid, rid) {
  var row = _resFind(cid, rid);
  if (!row || row.kind !== 'pdf' || typeof row.original !== 'string' || !row.original) return Promise.resolve(null);
  var done = function (blob) {
    return blob ? { title: String(row.title || ''), blob: new Blob([blob], { type: 'application/pdf' }) } : null;
  };
  var name = row.original;
  var m = _STUDENT_WORK_QUEUE_PATH.exec(name);
  if (m) {
    var qid = m[1];
    var q = /** @type {any} */ (window.PhotoQueue);
    if (m[2] || !q || typeof q.blobs !== 'function') return Promise.resolve(null);
    return Promise.resolve()
      .then(function () {
        return q.blobs(qid);
      })
      .then(
        function (found) {
          return done(found && found.photo);
        },
        function () {
          return null;
        },
      );
  }
  if (
    _isDemoSession() ||
    !_isUuid(rid) ||
    name !== _handoutOriginalPath(cid, rid) ||
    !_HANDOUT_FILE_STORAGE_PATH.test(name)
  ) {
    return Promise.resolve(null);
  }
  var sb = /** @type {any} */ (getSupabase());
  if (!sb || !sb.storage || typeof fetch !== 'function') return Promise.resolve(null);
  return Promise.resolve(_signInWait)
    .then(function () {
      return sb.storage.from('handout-files').createSignedUrl(name, STUDENT_WORK_LINK_SECONDS);
    })
    .then(function (res) {
      var link = res && !res.error && res.data && res.data.signedUrl;
      if (!link) return null;
      return fetch(link, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }).then(function (r) {
        return r && r.ok ? r.blob() : null;
      });
    })
    .then(done)
    .then(null, function () {
      return null;
    });
}

/* ── Showing a handout's page ── */

var _HANDOUT_STORAGE_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/handouts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/([1-9]|1[0-9]|20)\.jpg$/;

/* Page `i` (from 0) of handout `rid` in class `cid`: { url, release } or
   null. A page still on this device comes from the photo queue; one on
   the server through a link signed for 300 seconds, fetched, and shown
   from a blob: address. Only a path in this class's own handouts folder,
   under this handout. */
function openAssessmentHandoutPage(cid, rid, i) {
  var row = _resFind(cid, rid);
  var n = Number(i);
  if (!row || row.kind !== 'pdf' || !(n >= 0) || Math.floor(n) !== n) return Promise.resolve(null);
  var name = row.pages && row.pages[n];
  // The contract's layout, <course>/handouts/<resource>/<n>.jpg, when the server sent no paths.
  if (!name && _isUuid(rid) && n < (Number(row.page_count) || 0)) {
    name = String(cid).toLowerCase() + '/handouts/' + String(rid).toLowerCase() + '/' + (n + 1) + '.jpg';
  }
  if (!name) return Promise.resolve(null);
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(null);
  var m = _STUDENT_WORK_QUEUE_PATH.exec(name);
  if (m) {
    var qid = m[1];
    var q = /** @type {any} */ (window.PhotoQueue);
    if (m[2] || !q || typeof q.blobs !== 'function') return Promise.resolve(null);
    return Promise.resolve()
      .then(function () {
        return q.blobs(qid);
      })
      .then(
        function (found) {
          return found && found.photo ? _resPicture(found.photo) : null;
        },
        function () {
          return null;
        },
      );
  }
  var prefix = String(cid).toLowerCase() + '/handouts/' + String(rid).toLowerCase() + '/';
  if (_isDemoSession() || !_HANDOUT_STORAGE_PATH.test(name) || name.indexOf(prefix) !== 0) return Promise.resolve(null);
  var sb = /** @type {any} */ (getSupabase());
  if (!sb || !sb.storage || typeof fetch !== 'function') return Promise.resolve(null);
  return Promise.resolve(_signInWait) // not signed before start-up's re-check has passed
    .then(function () {
      return sb.storage.from('student-photos').createSignedUrl(name, STUDENT_WORK_LINK_SECONDS);
    })
    .then(function (res) {
      var link = res && !res.error && res.data && res.data.signedUrl;
      if (!link) return null;
      return fetch(link, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }).then(function (r) {
        return r && r.ok ? r.blob() : null;
      });
    })
    .then(function (blob) {
      return blob ? _resPicture(blob) : null;
    })
    .then(null, function () {
      return null;
    });
}

// A picture shown from a blob: address, with the way to let it go.
function _resPicture(blob) {
  // Always a picture: what is handed back is shown in an <img> and nothing else.
  var url = URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' }));
  var released = false;
  return {
    url: url,
    release: function () {
      if (released) return;
      released = true;
      URL.revokeObjectURL(url);
    },
  };
}
