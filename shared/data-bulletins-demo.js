// @ts-check
/* data-bulletins-demo.js — Bulletins in Demo Mode: kept on this device in
   gb-bulletins-<cid>, in the shapes the server answers, never sent. Part of
   the Bulletins data layer (shared/data-bulletins.js, loaded first), moved
   here unchanged for the file's size. */

/* ── Demo Mode: kept on this device ─────────────────────────────────────── */

/** @param {string} cid */
function _bltDemoKey(cid) {
  return 'gb-bulletins-' + cid;
}

/** @typedef {{ bulletins: any[], seen: Record<string, string[]>, reactions: Record<string, Record<string, string[]>> }} BulletinDemoStore */

/** @param {string} cid @returns {BulletinDemoStore} */
function _bltDemoLoad(cid) {
  var kept = _safeParseLS(_bltDemoKey(cid), null);
  var out = { bulletins: [], seen: {}, reactions: {} };
  if (!kept || typeof kept !== 'object') return out;
  if (Array.isArray(kept.bulletins)) out.bulletins = kept.bulletins.filter(Boolean);
  if (kept.seen && typeof kept.seen === 'object') out.seen = kept.seen;
  if (kept.reactions && typeof kept.reactions === 'object') out.reactions = kept.reactions;
  return out;
}
/** @param {string} cid @param {BulletinDemoStore} store */
function _bltDemoSave(cid, store) {
  _safeLSSet(_bltDemoKey(cid), JSON.stringify(store));
}

/**
 * The sample class's bulletins, written once (shared/seed-data.js). `rows`
 * are bulletins in the server's shape with `seen` (student ids) and
 * `reactions` ({ word: [student ids] }) added. Nothing is written when the
 * class already has any.
 * @param {string} cid @param {any[]} rows
 * @returns {boolean}
 */
function saveDemoBulletinsSeed(cid, rows) {
  if (!cid || !_isDemoSession() || localStorage.getItem(_bltDemoKey(cid)) != null) return false;
  /** @type {BulletinDemoStore} */
  var store = { bulletins: [], seen: {}, reactions: {} };
  (rows || []).forEach(function (r) {
    if (!r || !r.id) return;
    var seen = Array.isArray(r.seen) ? r.seen.map(String) : [];
    var reactions = r.reactions && typeof r.reactions === 'object' ? r.reactions : {};
    var row = Object.assign({}, r);
    delete row.seen;
    delete row.reactions;
    store.bulletins.push(row);
    store.seen[r.id] = seen;
    store.reactions[r.id] = {
      got_it: (reactions.got_it || []).map(String),
      done: (reactions.done || []).map(String),
      question: (reactions.question || []).map(String),
    };
  });
  _bltDemoSave(cid, store);
  return true;
}

/**
 * Who counts, for a Demo Mode class: students not paused (the class's
 * per-student options) are counted; a student is Without a Card only when
 * the class has cards and theirs is not one.
 * @param {string} cid
 * @returns {{ can_see: string[], paused: string[], no_card: string[] }}
 */
function _bltDemoGroups(cid) {
  var students = (typeof getStudents === 'function' && getStudents(cid)) || [];
  var options = typeof getStudentPageOptions === 'function' ? getStudentPageOptions(cid) : {};
  var cards = typeof _demoCardsListed === 'function' ? _demoCardsListed(cid) : [];
  /** @type {Record<string, boolean>} */
  var carded = {};
  (cards || []).forEach(function (c) {
    if (c && c.enrollment_id) carded[c.enrollment_id] = true;
  });
  var haveCards = Object.keys(carded).length > 0;
  /** @type {{ can_see: string[], paused: string[], no_card: string[] }} */
  var out = { can_see: [], paused: [], no_card: [] };
  students.forEach(function (s) {
    if (!s || !s.id) return;
    if (options[s.id] && options[s.id].paused_at) out.paused.push(s.id);
    else if (haveCards && !carded[s.id]) out.no_card.push(s.id);
    else out.can_see.push(s.id);
  });
  return out;
}

/** @param {any} row @param {BulletinDemoStore} store @param {{ can_see: string[] }} groups @param {string} cid @returns {Bulletin | null} */
function _bltDemoBulletin(row, store, groups, cid) {
  var b = _bltFromRow(Object.assign({}, row, { visible: true }));
  if (!b) return null;
  var can = {};
  groups.can_see.forEach(function (id) {
    can[id] = true;
  });
  var seen = (store.seen[b.id] || []).filter(function (id) {
    return can[id];
  });
  var r = store.reactions[b.id] || {};
  var inCan = function (/** @type {string[]} */ ids) {
    return (ids || []).filter(function (id) {
      return can[id];
    }).length;
  };
  b.seen = seen.length;
  b.can_see = groups.can_see.length;
  b.reactions = { got_it: inCan(r.got_it), done: inCan(r.done), question: inCan(r.question) };
  // As the server computes it: pinned only while its last day has not gone by.
  if (b.pinned && b.pinned_until && b.pinned_until < _bltToday(cid)) b.pinned = false;
  return b;
}

/** @param {string} cid */
function _bltDemoRead(cid) {
  // The sample class's bulletins are written the first time Bulletins is read (never at seeding, so a
  // Demo Mode with the build switch off writes nothing new).
  if (localStorage.getItem(_bltDemoKey(cid)) == null && typeof seedDemoBulletins === 'function' && cid === 'sci8') {
    seedDemoBulletins();
  }
  var store = _bltDemoLoad(cid);
  var groups = _bltDemoGroups(cid);
  var list = store.bulletins
    .map(function (row) {
      return _bltDemoBulletin(row, store, groups, cid);
    })
    .filter(Boolean);
  var mem = _bltMemory(cid);
  mem.state = 'ok';
  mem.list = bulletinsSorted(/** @type {Bulletin[]} */ (list));
  mem.at = Date.now();
  mem.meta = {
    can_see: groups.can_see.length,
    no_card: groups.no_card.length,
    paused: groups.paused.length,
    page_on: !!(typeof getReturnSettings === 'function' && getReturnSettings(cid).student_page),
    more: false,
  };
  return mem;
}

/**
 * Pictures for a file added in Demo Mode: each page's small copy as a data
 * address, so it stays on the device.
 * @param {Blob | null | undefined} blob
 * @returns {Promise<string>}
 */
function _bltDataUrl(blob) {
  if (!blob) return Promise.resolve('');
  if (typeof FileReader === 'undefined') {
    return blob
      .arrayBuffer()
      .then(function (buf) {
        var bytes = new Uint8Array(buf);
        var text = '';
        for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
        return 'data:' + (blob.type || 'image/jpeg') + ';base64,' + btoa(text);
      })
      .then(null, function () {
        return '';
      });
  }
  return new Promise(function (resolve) {
    var reader = new FileReader();
    reader.onload = function () {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = function () {
      resolve('');
    };
    reader.readAsDataURL(blob);
  });
}

/* ── Demo Mode's writes ─────────────────────────────────────────────────── */

/**
 * @param {string} cid @param {Record<string, any>} draft @param {{ kind: string, title: string, pages: { blob: Blob, thumb?: Blob }[] }[]} files
 * @returns {Promise<{ ok: boolean, message?: string, bulletin?: Bulletin }>}
 */
function _bltDemoPost(cid, draft, files) {
  var payload = bulletinPayload(draft);
  var now = new Date().toISOString();
  var id = _newEntryId();
  return Promise.all(
    files.map(function (f) {
      return Promise.all(
        f.pages.map(function (p) {
          return _bltDataUrl(p.thumb || p.blob);
        }),
      );
    }),
  ).then(function (pictures) {
    var store = _bltDemoLoad(cid);
    var row = Object.assign(
      {
        id: id,
        body: '',
        link_url: null,
        link_title: null,
        pinned: false,
        pinned_until: null,
        assessment_id: null,
        reactions_on: false,
        shown_again_at: null,
        edited_at: null,
        posted_at: now,
        created_at: now,
        updated_at: now,
        idempotency_key: null,
      },
      payload,
      {
        files: files.map(function (f, i) {
          return {
            id: _newEntryId(),
            kind: f.kind === 'pdf' ? 'pdf' : 'photo',
            title: String(f.title || (f.kind === 'pdf' ? 'PDF' : 'Photo')).slice(0, BULLETIN_NAME_MAX),
            page_count: f.pages.length,
            bytes: f.pages.reduce(function (n, p) {
              return n + (p.blob && p.blob.size ? p.blob.size : 0);
            }, 0),
            status: 'ready',
            position: i + 1,
            paths: pictures[i].filter(Boolean),
          };
        }),
      },
    );
    store.bulletins.push(row);
    store.seen[id] = [];
    store.reactions[id] = { got_it: [], done: [], question: [] };
    _bltDemoSave(cid, store);
    _bltDemoRead(cid);
    _bltChanged(cid);
    return {
      ok: true,
      bulletin: _bltMemory(cid).list.filter(function (b) {
        return b.id === id;
      })[0],
    };
  });
}

/** @param {string} cid @param {string} id @param {Record<string, any>} patch @returns {Promise<BulletinWriteResult>} */
function _bltDemoEdit(cid, id, patch) {
  var store = _bltDemoLoad(cid);
  var at = -1;
  store.bulletins.forEach(function (b, i) {
    if (b.id === id) at = i;
  });
  if (at < 0) return Promise.resolve({ ok: false, message: 'That bulletin is not there.' });
  var row = _bltApplyPatch(/** @type {Bulletin} */ (store.bulletins[at]), patch);
  /** @type {any} */
  var next = Object.assign({}, store.bulletins[at]);
  ['body', 'link_url', 'link_title', 'pinned', 'pinned_until', 'assessment_id', 'reactions_on', 'edited_at'].forEach(
    function (k) {
      next[k] = /** @type {any} */ (row)[k];
    },
  );
  var files = Array.isArray(next.files) ? next.files : [];
  var words = String(next.body || '').trim();
  if (!words && !next.link_url && !files.length) {
    return Promise.resolve({ ok: false, message: 'A bulletin needs words, a link or a file.' });
  }
  next.updated_at = new Date().toISOString();
  store.bulletins[at] = next;
  _bltDemoSave(cid, store);
  _bltDemoRead(cid);
  _bltChanged(cid);
  return Promise.resolve({ ok: true });
}

/** @param {string} cid @param {string} id @returns {Promise<BulletinWriteResult>} */
function _bltDemoDelete(cid, id) {
  var store = _bltDemoLoad(cid);
  var rest = store.bulletins.filter(function (b) {
    return b.id !== id;
  });
  if (rest.length === store.bulletins.length)
    return Promise.resolve({ ok: false, message: 'That bulletin is not there.' });
  store.bulletins = rest;
  delete store.seen[id];
  delete store.reactions[id];
  _bltDemoSave(cid, store);
  _bltDemoRead(cid);
  _bltChanged(cid);
  return Promise.resolve({ ok: true });
}

/** @param {string} cid @param {string} id @returns {Promise<BulletinWriteResult>} */
function _bltDemoAgain(cid, id) {
  var store = _bltDemoLoad(cid);
  var row = store.bulletins.filter(function (b) {
    return b.id === id;
  })[0];
  if (!row) return Promise.resolve({ ok: false, message: 'That bulletin is not there.' });
  row.shown_again_at = new Date().toISOString();
  row.updated_at = row.shown_again_at;
  _bltDemoSave(cid, store);
  _bltDemoRead(cid);
  _bltChanged(cid);
  return Promise.resolve({ ok: true });
}
