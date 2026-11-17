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
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(html|txt|epub)$/;

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

// The photo queue's batch is a handout file's: its kind, or '' (a PDF's pages are .jpg).
function _handoutFileKindOf(batch) {
  var path = String((((batch && batch.files) || [])[0] || {}).path || '');
  return (/\.(html|txt|epub)$/.exec(path) || [])[1] || '';
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
var _HANDOUT_FILE_UPLOAD_TYPES = { html: 'text/html', txt: 'text/plain', epub: 'application/epub+zip' };
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
