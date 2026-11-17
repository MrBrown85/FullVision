// @ts-check
/* Sticker codes for Add Work for the Class (docs/plans/add-work-for-class-plan.md,
   B4): one sheet of small stickers per student, each carrying a QR code of
   FVS + the student's sticker code, so a scanned pile names its pieces.

   A code is 12 characters of SCAN_LABEL_ALPHABET (no 0, 1, I or O), drawn
   at random. It says nothing about the student, is not a student card code
   and signs nobody in. A student has one live code; a new sheet retires the
   old one, and a retired code is kept so a scan can say "this sticker is
   from a sheet that was replaced" instead of guessing.

   Three calls, each answering a promise of { data, error, refused }:

     listScanLabels(cid)        { labels: [{ enrollment_id, code, retired }] }
                                every code of the class, live and retired.
     issueScanLabels(cid)       { labels: [{ enrollment_id, code }] }
                                a live code for each student still in the
                                class who has none; the live codes of every
                                student still in the class. Again changes
                                nothing.
     reissueScanLabel(cid, sid) { label: { enrollment_id, code } | null }
                                the student's live code retired and a new
                                one made; null when the student is not in
                                this teacher's class, or is withdrawn.

   The server's list also holds a withdrawn student's codes, with no flag:
   who is in the class is the app's own class list (ScanLabelRead.resolve
   names only students on the page's list).

   `refused` is a plain sentence the screen shows when the call could not be
   made or was refused (offline, permission denied, a class or student still
   saving); data is then null. Nothing here goes through the outbox and
   nothing shows on the sync dot: a sheet needs the code the server holds,
   so a call that cannot be made says so on the screen instead of waiting.

   Signed in, they call list_scan_labels, issue_scan_labels and
   reissue_scan_label. Each write always sends a p_idempotency_key: a new
   one for each press, and the same one when _callRpcWithAuthGuard sends
   that press again after refreshing the sign-in (it reuses the params), so
   a retried New Code never retires the code it just made. A class
   or student whose id is still local-shaped (CLAUDE.md rule 6) is never
   sent. In Demo Mode the same answers are made on this device and kept in
   gb-scan-labels-<cid>, which Demo Mode's reset and sign-out wipe with
   every other gb- key. */
var SCAN_LABEL_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
var SCAN_LABEL_LENGTH = 12;
var _SCAN_LABEL_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/;
var SCAN_LABEL_REFUSED = {
  offline: 'Sticker sheets are not available right now. Check the connection and try again.',
  saving: 'Sticker sheets are not available right now. This class is still saving; try again in a moment.',
  failed: 'Sticker sheets are not available right now. Try again in a moment.',
};

/** @param {any} data @param {any} [error] @param {string} [refused] */
function _scanLabelsAnswer(data, error, refused) {
  return Promise.resolve({ data: data == null ? null : data, error: error || null, refused: refused || null });
}

/** @param {unknown} code */
function isScanLabelCode(code) {
  return typeof code === 'string' && _SCAN_LABEL_RE.test(code);
}

/* Why a signed-in call cannot be asked now, or '' when it can. */
/** @param {string} cid @param {string} [sid] */
function _scanLabelsBlocked(cid, sid) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return SCAN_LABEL_REFUSED.offline;
  if (!_useSupabase) return SCAN_LABEL_REFUSED.offline;
  if (!_isUuid(cid)) return SCAN_LABEL_REFUSED.saving;
  if (sid !== undefined && !_isUuid(sid)) return SCAN_LABEL_REFUSED.saving;
  return '';
}

/* A server row with only the fields of the contract, or null when it is
   not one. */
/** @param {any} row @param {boolean} withRetired */
function _scanLabelRow(row, withRetired) {
  if (!row || typeof row !== 'object' || typeof row.enrollment_id !== 'string' || !isScanLabelCode(row.code)) {
    return null;
  }
  /** @type {{ enrollment_id: string, code: string, retired?: boolean }} */
  var out = { enrollment_id: row.enrollment_id, code: row.code };
  if (withRetired) out.retired = row.retired === true;
  return out;
}
/** @param {any} data @param {boolean} withRetired */
function _scanLabelRows(data, withRetired) {
  var list = data && Array.isArray(data.labels) ? data.labels : [];
  return list
    .map(function (/** @type {any} */ r) {
      return _scanLabelRow(r, withRetired);
    })
    .filter(Boolean);
}
/** @param {string} name @param {any} res */
function _scanLabelsFailed(name, res) {
  if (res && res.error && !res.error.handledSessionExpired) console.warn(name + ' failed:', res.error);
  return { data: null, error: (res && res.error) || { message: 'no answer' }, refused: SCAN_LABEL_REFUSED.failed };
}

/* ── Demo Mode: the same answers, on this device ── */

/** @param {string} cid @returns {{ enrollment_id: string, code: string, retired: boolean }[]} */
function _demoScanLabels(cid) {
  var kept = _safeParseLS('gb-scan-labels-' + cid, []);
  if (!Array.isArray(kept)) return [];
  return /** @type {any} */ (
    kept
      .map(function (/** @type {any} */ r) {
        return _scanLabelRow(r, true);
      })
      .filter(Boolean)
  );
}
/** @param {string} cid @param {any[]} rows */
function _saveDemoScanLabels(cid, rows) {
  _safeLSSet('gb-scan-labels-' + cid, JSON.stringify(rows));
}
/* Every code this device holds, in every class: a new one is never one of them. */
function _demoScanCodesTaken() {
  /** @type {Record<string, boolean>} */
  var taken = {};
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf('gb-scan-labels-') !== 0) continue;
      _demoScanLabels(k.slice('gb-scan-labels-'.length)).forEach(function (r) {
        taken[r.code] = true;
      });
    }
  } catch (e) {
    /* nothing readable: the draw below still avoids this class's own */
  }
  return taken;
}
/* A whole number from 0 to n - 1 (n up to 256), every value equally likely. */
/** @param {number} n */
function _scanLabelRandom(n) {
  if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
    var limit = 256 - (256 % n);
    var b = new Uint8Array(1);
    do crypto.getRandomValues(b);
    while (b[0] >= limit);
    return b[0] % n;
  }
  return Math.floor(Math.random() * n);
}
/** @param {Record<string, boolean>} taken */
function _demoScanLabelCode(taken) {
  var code;
  do {
    code = '';
    for (var i = 0; i < SCAN_LABEL_LENGTH; i++) {
      code += SCAN_LABEL_ALPHABET.charAt(_scanLabelRandom(SCAN_LABEL_ALPHABET.length));
    }
  } while (taken[code]);
  taken[code] = true;
  return code;
}
/** @param {string} cid */
function _demoStudentsIn(cid) {
  /** @type {Record<string, boolean>} */
  var here = {};
  (getStudents(cid) || []).forEach(function (/** @type {any} */ st) {
    if (st && st.id) here[st.id] = true;
  });
  return here;
}

/* ── The three calls ── */

/** @param {string} cid */
function listScanLabels(cid) {
  if (!cid) return _scanLabelsAnswer({ labels: [] });
  if (!_writesEnabled()) return _scanLabelsAnswer({ labels: _demoScanLabels(cid) });
  var blocked = _scanLabelsBlocked(cid);
  if (blocked) return _scanLabelsAnswer(null, null, blocked);
  return _callRpcWithAuthGuard('list_scan_labels', { p_course_id: cid }, { suppressSessionExpiredModal: true }).then(
    function (/** @type {any} */ res) {
      if (!res || res.error || res.data == null) return _scanLabelsFailed('list_scan_labels', res);
      return { data: { labels: _scanLabelRows(res.data, true) }, error: null, refused: null };
    },
  );
}

/** @param {string} cid */
function issueScanLabels(cid) {
  if (!cid) return _scanLabelsAnswer({ labels: [] });
  if (!_writesEnabled()) {
    var rows = _demoScanLabels(cid);
    var here = _demoStudentsIn(cid);
    /** @type {Record<string, string>} */
    var live = {};
    rows.forEach(function (r) {
      if (!r.retired) live[r.enrollment_id] = r.code;
    });
    var taken = _demoScanCodesTaken();
    var made = false;
    Object.keys(here).forEach(function (sid) {
      if (live[sid]) return;
      live[sid] = _demoScanLabelCode(taken);
      rows.push({ enrollment_id: sid, code: live[sid], retired: false });
      made = true;
    });
    if (made) _saveDemoScanLabels(cid, rows);
    return _scanLabelsAnswer({
      labels: Object.keys(here).map(function (sid) {
        return { enrollment_id: sid, code: live[sid] };
      }),
    });
  }
  var blocked = _scanLabelsBlocked(cid);
  if (blocked) return _scanLabelsAnswer(null, null, blocked);
  return _callRpcWithAuthGuard('issue_scan_labels', { p_course_id: cid, p_idempotency_key: _newEntryId() }).then(
    function (/** @type {any} */ res) {
      if (!res || res.error || res.data == null) return _scanLabelsFailed('issue_scan_labels', res);
      return { data: { labels: _scanLabelRows(res.data, false) }, error: null, refused: null };
    },
  );
}

/** @param {string} cid @param {string} sid */
function reissueScanLabel(cid, sid) {
  if (!cid || !sid) return _scanLabelsAnswer({ label: null });
  if (!_writesEnabled()) {
    if (!_demoStudentsIn(cid)[sid]) return _scanLabelsAnswer({ label: null });
    var rows = _demoScanLabels(cid);
    rows.forEach(function (r) {
      if (r.enrollment_id === sid) r.retired = true;
    });
    var code = _demoScanLabelCode(_demoScanCodesTaken());
    rows.push({ enrollment_id: sid, code: code, retired: false });
    _saveDemoScanLabels(cid, rows);
    return _scanLabelsAnswer({ label: { enrollment_id: sid, code: code } });
  }
  var blocked = _scanLabelsBlocked(cid, sid);
  if (blocked) return _scanLabelsAnswer(null, null, blocked);
  return _callRpcWithAuthGuard('reissue_scan_label', { p_enrollment_id: sid, p_idempotency_key: _newEntryId() }).then(
    function (/** @type {any} */ res) {
      if (!res || res.error || res.data == null) return _scanLabelsFailed('reissue_scan_label', res);
      return { data: { label: _scanLabelRow(res.data.label, false) }, error: null, refused: null };
    },
  );
}
