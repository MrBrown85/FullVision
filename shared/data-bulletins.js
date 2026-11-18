// @ts-check
/* Bulletins: a one-way class feed. The teacher posts, students read, the
   teacher sees who has seen it (docs/plans/bulletins-plan.md, slice B1c).
   This is the one data layer for it; the teacher's page
   (teacher/page-bulletins.js) and, later, the phone's tab read and write
   through these functions only.

   Server (migrations/local-test/bulletins-contract.md): list_bulletins,
   post_bulletin, finish_bulletin_file, edit_bulletin, delete_bulletin,
   list_bulletin_seen and show_bulletin_again, each for the signed-in
   teacher's own class. Not on the live database until the migration is
   applied: a class whose list_bulletins answers "no such function" is
   offered nothing and sent nothing (bulletinsOffered).

   Writes go through the outbox with a key made on this device, and no local
   id is ever made. A bulletin waiting to be sent is kept here, in
   gb-bulletins-pending-<cid>, as Not Sent Yet, known by its key; the
   server's row (its idempotency_key) takes its place. Edit, Pin, Delete
   and Show It Again only ever name a real server id.

   A file (a photo, or a PDF made into JPEG pages by PhotoShrink) goes up,
   on the desktop page, while online, right after post_bulletin answers with
   the paths: with no connection the post is refused up front (offline) and
   the draft stays with the teacher.

   The phone (teacher-mobile/tab-bulletins.js, slice B1f) posts with
   { queue: true }: the pages wait in the photo queue (shared/photo-queue.js,
   kind 'bulletin') under the bulletin's device key, the bulletin shows as Not
   Sent Yet with its photo from the device, post_bulletin goes through the
   outbox, its answer names each page's path (placeBulletin), the queue
   uploads them and its commit finishes each file (finish_bulletin_file).
   The waiting entry keeps what the server answered, so each step is taken
   up again after a reload (resumeBulletinUploads). Trouble shows only on
   the sync dot; words the server refused are given back to the composer
   (takeReturnedBulletin).

   Demo Mode keeps everything on this device in gb-bulletins-<cid>, in the
   shapes the server answers, and never calls the server. */

var BULLETIN_WORDS_MAX = 2000;
var BULLETIN_LINK_MAX = 2000;
var BULLETIN_NAME_MAX = 200;
var BULLETIN_PAGES_MAX = 20;
var BULLETIN_REFRESH_MS = 15000;
var BULLETIN_REACTION_WORDS = { got_it: 'Got It', done: 'Done', question: 'Have a Question' };
var BULLETIN_BUCKET = 'bulletin-files';

/** @typedef {{ id: string, kind: string, title: string, page_count: number, bytes: number | null, status: string, position: number, paths: string[], finish_by?: string | null }} BulletinFile */
/** @typedef {{ got_it: number, done: number, question: number }} BulletinReactions */
/** @typedef {{ id: string, kind: string, body: string, link_url: string | null, link_title: string | null, pinned: boolean, pinned_until: string | null, assessment_id: string | null, reactions_on: boolean, visible: boolean, waiting: boolean, key: string | null, posted_at: string | null, shown_again_at: string | null, edited_at: string | null, created_at: string | null, updated_at: string | null, idempotency_key: string | null, files: BulletinFile[], seen: number, can_see: number, reactions: BulletinReactions }} Bulletin */
/** @typedef {{ can_see: number, no_card: number, paused: number, page_on: boolean, more: boolean }} BulletinsMeta */
/** @typedef {{ key: string, at: string, bulletin: Record<string, any>, files: { kind: string, title: string, pages: number }[], queued?: boolean, tries?: number, old?: string[], server?: { id: string, files: { id: string, paths: string[] }[] }, placed?: boolean }} BulletinWaiting */
/** @typedef {{ state: string, list: Bulletin[], meta: BulletinsMeta, at: number, loading: Promise<boolean> | null, writes: number }} BulletinMemory */

/** @type {Record<string, BulletinMemory>} */
var _bltMem = {}; // cid → what was read last
/** @type {Record<string, boolean>} */
var _bltFlows = {}; // key → true while this page is uploading that bulletin's files
/** @type {Record<string, { url: string, release: () => void }>} */
var _bltPictures = {}; // page path → its picture, held as a blob: address
var _bltListening = false;

// A bulletin's writes are not class changes: no sync cursor moves (the contract), so none comes back as an echo.
if (typeof _ECHO_SAFE_RPCS !== 'undefined') {
  ['post_bulletin', 'finish_bulletin_file', 'edit_bulletin', 'delete_bulletin', 'show_bulletin_again'].forEach(
    function (name) {
      _ECHO_SAFE_RPCS[name] = true;
    },
  );
}

/* ── Pure helpers ───────────────────────────────────────────────────────── */

/** The address with its spaces cut off when it is http or https with a host, else ''. @param {unknown} value */
function bulletinLinkOk(value) {
  var url = String(value == null ? '' : value).trim();
  if (!url || url.length > BULLETIN_LINK_MAX) return '';
  if (/[\s\u0000-\u001f]/.test(url)) return '';
  if (!/^https?:\/\/[^/?#\s]+/i.test(url)) return '';
  try {
    var parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (!parsed.hostname) return '';
  } catch (e) {
    return '';
  }
  return url;
}

/** The site's name for a link card: its host without a leading www. @param {unknown} value */
function bulletinLinkHost(value) {
  var url = bulletinLinkOk(value);
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch (e) {
    return '';
  }
}

/** @param {unknown} value @returns {string} 'YYYY-MM-DD' or '' */
function _bltDay(value) {
  var s = String(value == null ? '' : value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/**
 * What a draft is missing or has wrong, as one plain sentence, or ''.
 * draft: { kind, body, link_url, link_title, pinned_until, files: [{ pages }] }.
 * @param {Record<string, any>} draft
 */
function bulletinDraftProblem(draft) {
  var d = draft || {};
  var body = String(d.body == null ? '' : d.body).trim();
  var link = String(d.link_url == null ? '' : d.link_url).trim();
  var files = Array.isArray(d.files) ? d.files : [];
  if (d.kind !== 'announcement' && d.kind !== 'reminder') return 'Choose Announcement or Reminder.';
  if (body.length > BULLETIN_WORDS_MAX) return 'Words can be up to ' + BULLETIN_WORDS_MAX + ' characters.';
  if (link && !bulletinLinkOk(link)) return 'A link must start with http:// or https://.';
  var name = String(d.link_title == null ? '' : d.link_title).trim();
  if (name.length > BULLETIN_NAME_MAX) return 'A link name can be up to ' + BULLETIN_NAME_MAX + ' characters.';
  var pages = 0;
  files.forEach(function (f) {
    pages += Math.max(1, Number(f && f.pages) || 1);
  });
  if (pages > BULLETIN_PAGES_MAX) return 'A bulletin can hold up to ' + BULLETIN_PAGES_MAX + ' pages in all.';
  if (d.pinned_until) {
    if (d.kind !== 'reminder') return 'Only a reminder can stay pinned until a date.';
    var day = _bltDay(d.pinned_until);
    if (!day) return 'Choose a date for Stays Pinned Until.';
    if (day < getTodayStr()) return 'Stays Pinned Until cannot be before today.';
  }
  if (!body && !link && !files.length) return 'Write something, add a link or add a file.';
  return '';
}

/**
 * The p_bulletin the server takes, from a draft. Only the keys that mean
 * something, so a missing one takes the server's default.
 * @param {Record<string, any>} draft
 */
function bulletinPayload(draft) {
  var d = draft || {};
  var link = bulletinLinkOk(d.link_url);
  var name = String(d.link_title == null ? '' : d.link_title).trim();
  /** @type {Record<string, any>} */
  var out = {
    kind: d.kind === 'reminder' ? 'reminder' : 'announcement',
    body: String(d.body == null ? '' : d.body).trim(),
    reactions_on: d.reactions_on === true,
  };
  if (link) {
    out.link_url = link;
    if (name) out.link_title = name;
  }
  if (d.kind === 'reminder') {
    out.pinned = d.pinned !== false;
    if (out.pinned && d.pinned_until) out.pinned_until = _bltDay(d.pinned_until);
  } else if (d.pinned === true) {
    out.pinned = true;
  }
  if (d.assessment_id && typeof d.assessment_id === 'string') out.assessment_id = d.assessment_id;
  return out;
}

/**
 * The facts line's first words: "Seen by 18 of 26 · 8 Not Seen", "Seen by
 * All 26" or "Not Seen Yet".
 * @param {number} seen @param {number} canSee
 */
function bulletinSeenText(seen, canSee) {
  var s = Math.max(0, Number(seen) || 0);
  var m = Math.max(0, Number(canSee) || 0);
  if (s <= 0) return 'Not Seen Yet';
  if (m > 0 && s >= m) return 'Seen by All ' + m;
  return 'Seen by ' + s + ' of ' + m + ' · ' + Math.max(0, m - s) + ' Not Seen';
}

/** "14 Got It · 2 Have a Question", '' when none or Reactions is off. @param {{ reactions_on?: boolean, reactions?: Partial<BulletinReactions> }} b */
function bulletinReactionText(b) {
  if (!b || !b.reactions_on) return '';
  var r = b.reactions || {};
  return ['got_it', 'done', 'question']
    .filter(function (w) {
      return Number(r[/** @type {'got_it'} */ (w)]) > 0;
    })
    .map(function (w) {
      return Number(r[/** @type {'got_it'} */ (w)]) + ' ' + BULLETIN_REACTION_WORDS[/** @type {'got_it'} */ (w)];
    })
    .join(' · ');
}

/** The time a bulletin sorts by. @param {Partial<Bulletin>} b */
function _bltTime(b) {
  return String((b && (b.posted_at || b.created_at)) || '');
}

/** Pinned first, then newest first. @param {Bulletin[]} list */
function bulletinsSorted(list) {
  return list.slice().sort(function (a, b) {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    var ta = _bltTime(a);
    var tb = _bltTime(b);
    if (ta !== tb) return ta < tb ? 1 : -1;
    return String(a.id) < String(b.id) ? -1 : 1;
  });
}

/* ── What the server sent ───────────────────────────────────────────────── */

/** @returns {BulletinReactions} @param {any} r */
function _bltReactions(r) {
  var o = r && typeof r === 'object' ? r : {};
  return { got_it: Number(o.got_it) || 0, done: Number(o.done) || 0, question: Number(o.question) || 0 };
}

/** @param {any} f @returns {BulletinFile | null} */
function _bltFile(f) {
  if (!f || typeof f !== 'object' || !f.id) return null;
  return {
    id: String(f.id),
    kind: f.kind === 'pdf' ? 'pdf' : 'photo',
    title: String(f.title || ''),
    page_count: Math.max(1, Number(f.page_count) || 1),
    bytes: f.bytes == null ? null : Number(f.bytes) || 0,
    status: f.status === 'uploading' ? 'uploading' : 'ready',
    position: Number(f.position) || 0,
    paths: Array.isArray(f.paths) ? f.paths.map(String) : [],
    finish_by: f.finish_by || null,
  };
}

/** A bulletin as the screens read it, from the server's or the device's row. @param {any} row @returns {Bulletin | null} */
function _bltFromRow(row) {
  if (!row || typeof row !== 'object' || !row.id) return null;
  var visible = row.visible !== false && row.posted_at !== null;
  return {
    id: String(row.id),
    kind: row.kind === 'reminder' ? 'reminder' : 'announcement',
    body: String(row.body || ''),
    link_url: row.link_url ? String(row.link_url) : null,
    link_title: row.link_title ? String(row.link_title) : null,
    pinned: row.pinned === true,
    pinned_until: _bltDay(row.pinned_until) || null,
    assessment_id: row.assessment_id ? String(row.assessment_id) : null,
    reactions_on: row.reactions_on === true,
    visible: visible,
    waiting: !visible,
    key: null,
    posted_at: row.posted_at || null,
    shown_again_at: row.shown_again_at || null,
    edited_at: row.edited_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    idempotency_key: row.idempotency_key ? String(row.idempotency_key) : null,
    files: (Array.isArray(row.files) ? row.files : []).map(_bltFile).filter(Boolean),
    seen: Number(row.seen) || 0,
    can_see: Number(row.can_see) || 0,
    reactions: _bltReactions(row.reactions),
  };
}

/** @returns {BulletinsMeta} @param {any} data */
function _bltMeta(data) {
  var d = data && typeof data === 'object' ? data : {};
  return {
    can_see: Number(d.can_see) || 0,
    no_card: Number(d.no_card) || 0,
    paused: Number(d.paused) || 0,
    page_on: d.page_on !== false,
    more: d.more === true,
  };
}

/* ── Where a class's bulletins are kept ─────────────────────────────────── */

/** A signed-in teacher's class with its server id. @param {string} cid */
function _bltOnServer(cid) {
  return !!cid && !_isDemoSession() && _writesEnabled() && _isUuid(cid);
}

/** @param {string} cid */
function _bltMemory(cid) {
  if (!_bltMem[cid]) {
    _bltMem[cid] = {
      state: '',
      list: [],
      meta: { can_see: 0, no_card: 0, paused: 0, page_on: true, more: false },
      at: 0,
      loading: null,
      writes: 0,
    };
  }
  return _bltMem[cid];
}

/** @param {string} cid */
function _bltChanged(cid) {
  if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function') return;
  if (typeof CustomEvent !== 'function') return;
  document.dispatchEvent(new CustomEvent('fv:bulletins-changed', { detail: { cid: cid } }));
}

/** @param {string} cid */
function _bltPendingKey(cid) {
  return 'gb-bulletins-pending-' + cid;
}
/** @param {string} cid @returns {BulletinWaiting[]} */
function _bltPending(cid) {
  var kept = _safeParseLS(_bltPendingKey(cid), []);
  return Array.isArray(kept)
    ? kept.filter(function (e) {
        return e && typeof e.key === 'string' && e.bulletin && typeof e.bulletin === 'object';
      })
    : [];
}
/** @param {string} cid @param {BulletinWaiting[]} list */
function _bltSavePending(cid, list) {
  if (!list.length) {
    try {
      localStorage.removeItem(_bltPendingKey(cid));
    } catch (e) {
      /* storage blocked */
    }
    return;
  }
  _safeLSSet(_bltPendingKey(cid), JSON.stringify(list));
}
/** @param {string} cid @param {string} key */
function _bltDropPending(cid, key) {
  var list = _bltPending(cid);
  var rest = list.filter(function (e) {
    return e.key !== key;
  });
  if (rest.length !== list.length) _bltSavePending(cid, rest);
}

/** A waiting entry as a bulletin the screens can draw. @param {BulletinWaiting} e @returns {Bulletin} */
function _bltWaitingBulletin(e) {
  var b = e.bulletin || {};
  return {
    id: 'waiting:' + e.key,
    kind: b.kind === 'reminder' ? 'reminder' : 'announcement',
    body: String(b.body || ''),
    link_url: b.link_url || null,
    link_title: b.link_title || null,
    pinned: b.pinned === true,
    pinned_until: _bltDay(b.pinned_until) || null,
    assessment_id: b.assessment_id || null,
    reactions_on: b.reactions_on === true,
    visible: false,
    waiting: true,
    key: e.key,
    posted_at: e.at,
    shown_again_at: null,
    edited_at: null,
    created_at: e.at,
    updated_at: e.at,
    idempotency_key: e.key,
    files: (e.files || []).map(function (f, i) {
      return {
        id: 'waiting:' + e.key + ':' + i,
        kind: f.kind === 'pdf' ? 'pdf' : 'photo',
        title: String(f.title || ''),
        page_count: Math.max(1, Number(f.pages) || 1),
        bytes: null,
        status: 'uploading',
        position: i + 1,
        paths: [],
      };
    }),
    seen: 0,
    can_see: 0,
    reactions: { got_it: 0, done: 0, question: 0 },
  };
}

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

/** @param {any} row @param {BulletinDemoStore} store @param {{ can_see: string[] }} groups @returns {Bulletin | null} */
function _bltDemoBulletin(row, store, groups) {
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
  if (b.pinned && b.pinned_until && b.pinned_until < getTodayStr()) b.pinned = false;
  return b;
}

/** @param {string} cid */
function _bltDemoRead(cid) {
  var store = _bltDemoLoad(cid);
  var groups = _bltDemoGroups(cid);
  var list = store.bulletins
    .map(function (row) {
      return _bltDemoBulletin(row, store, groups);
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

/* ── Reading ────────────────────────────────────────────────────────────── */

/** True when Bulletins is offered for a class: Demo Mode, or a signed-in class whose server answered. @param {string} cid */
function bulletinsOffered(cid) {
  if (!cid) return false;
  if (_isDemoSession()) return true;
  if (!_bltOnServer(cid)) return false;
  return _bltMemory(cid).state === 'ok';
}

/** 'ok', 'missing' (the server has no such function yet), 'failed', or '' before the first answer. @param {string} cid */
function bulletinsState(cid) {
  if (_isDemoSession()) return 'ok';
  return _bltMemory(cid).state;
}

/**
 * Read the class's bulletins again: at most every 15 seconds unless
 * opts.force. opts.stillShown() says whether the class is still on screen;
 * an answer for one that is not is dropped. Tells the page (fv:bulletins-
 * changed) when what it holds changed. Resolves true when the list is read;
 * never rejects.
 * @param {string} cid
 * @param {{ force?: boolean, stillShown?: () => boolean }} [opts]
 * @returns {Promise<boolean>}
 */
function refreshBulletins(cid, opts) {
  var o = opts || {};
  if (!cid) return Promise.resolve(false);
  if (_isDemoSession()) {
    _bltDemoRead(cid);
    _bltChanged(cid);
    return Promise.resolve(true);
  }
  if (!_bltOnServer(cid)) return Promise.resolve(false);
  _bltListen();
  var mem = _bltMemory(cid);
  if (mem.state === 'missing') return Promise.resolve(false);
  if (mem.loading) return mem.loading;
  if (!o.force && mem.at && Date.now() - mem.at < BULLETIN_REFRESH_MS) return Promise.resolve(mem.state === 'ok');
  var began = mem.writes;
  // The page says whether the class is still on screen; with no word, an answer is kept (it is per class).
  var stillShown =
    typeof o.stillShown === 'function'
      ? o.stillShown
      : function () {
          return true;
        };
  var asked = { p_course_id: cid };
  var quiet = { suppressSessionExpiredModal: true };
  var run = Promise.resolve()
    .then(function () {
      // @ts-expect-error list_bulletins is not in types/database.d.ts until the migration is applied and the types are regenerated.
      return _callRpcWithAuthGuard('list_bulletins', asked, quiet);
    })
    .then(function (res) {
      if (!stillShown()) return false; // asked for a class no longer on screen
      if (res && res.error) {
        // The migration comes first: nothing offered, nothing sent, no report.
        if (_isMissingRpcError(res.error)) mem.state = 'missing';
        else {
          if (!res.error.handledSessionExpired) console.warn('list_bulletins failed:', res.error);
          if (mem.state !== 'ok') mem.state = 'failed';
        }
        _bltChanged(cid);
        return false;
      }
      var data = _rpcObject(res && res.data);
      if (!data || !Array.isArray(data.bulletins)) {
        if (mem.state !== 'ok') mem.state = 'failed';
        _bltChanged(cid);
        return false;
      }
      // A write of this device's began or landed since this read began: its
      // answer may be older than the change. The write refreshes again.
      if (mem.writes !== began) return false;
      var list = data.bulletins.map(_bltFromRow).filter(Boolean);
      mem.state = 'ok';
      mem.at = Date.now();
      mem.list = /** @type {Bulletin[]} */ (list);
      mem.meta = _bltMeta(data);
      _bltLandedKeys(cid, mem.list);
      _bltChanged(cid);
      return true;
    })
    .then(null, function (e) {
      console.warn('list_bulletins failed:', e);
      return false;
    })
    .then(function (ok) {
      mem.loading = null;
      return ok;
    });
  mem.loading = run;
  return run;
}

/**
 * A waiting bulletin whose key is in the server's list has landed; one the
 * outbox no longer holds, that nothing here is sending, and that the server
 * does not list, was refused or lost, and is let go.
 * @param {string} cid @param {Bulletin[]} list
 */
function _bltLandedKeys(cid, list) {
  var pending = _bltPending(cid);
  if (!pending.length) return;
  /** @type {Record<string, boolean>} */
  var onServer = {};
  /** @type {Record<string, Bulletin>} */
  var rows = {};
  list.forEach(function (b) {
    if (b.idempotency_key) {
      onServer[b.idempotency_key] = true;
      rows[b.idempotency_key] = b;
    }
  });
  // A post whose pages wait in the photo queue is done only once students can see it.
  pending.forEach(function (e) {
    if (e.queued) _bltQueuedSeen(cid, e, rows[e.key] || null);
  });
  pending = _bltPending(cid);
  var q = window.v2Queue;
  var keep = pending.filter(function (e) {
    if (e.queued) return true; // _bltQueuedSeen lets it go
    if (onServer[e.key]) return false;
    if (_bltFlows[e.key]) return true;
    if (q && typeof q.has === 'function' && q.has(e.key)) return true;
    return Date.now() - Date.parse(e.at) < 120000; // just made: the outbox may not have it yet
  });
  if (keep.length !== pending.length) _bltSavePending(cid, keep);
}

/** The class's bulletins as held: a waiting one first, then the server's, pinned first and newest first. @param {string} cid @returns {Bulletin[]} */
function getBulletins(cid) {
  if (!cid) return [];
  var mem = _bltMemory(cid);
  var list = mem.list.slice();
  if (_isDemoSession()) return bulletinsSorted(list);
  var pending = _bltPending(cid);
  // A post whose pages are still on this device shows from the device (its photo is here), not as the server's empty row.
  /** @type {Record<string, boolean>} */
  var mine = {};
  pending.forEach(function (e) {
    if (!e.queued) return;
    mine[e.key] = true;
    (e.old || []).forEach(function (k) {
      mine[k] = true;
    });
  });
  list = list.filter(function (b) {
    return !(b.idempotency_key && mine[b.idempotency_key] && !b.visible);
  });
  /** @type {Record<string, boolean>} */
  var onServer = {};
  list.forEach(function (b) {
    if (b.idempotency_key) onServer[b.idempotency_key] = true;
  });
  var waiting = pending
    .filter(function (e) {
      return !onServer[e.key];
    })
    .map(_bltWaitingBulletin);
  return bulletinsSorted(waiting.concat(list));
}

/** { can_see, no_card, paused, page_on, more } as last read. @param {string} cid @returns {BulletinsMeta} */
function getBulletinsMeta(cid) {
  return Object.assign({}, _bltMemory(cid).meta);
}

/**
 * Who has seen a bulletin: { ok, not_seen, seen, reactions, paused,
 * no_card }, each a list of student ids in class-list order. Ids only; the
 * page has the names. ok is false when it could not be read.
 * @param {string} cid @param {string} bulletinId
 * @returns {Promise<{ ok: boolean, not_seen: string[], seen: string[], reactions: { got_it: string[], done: string[], question: string[] }, paused: string[], no_card: string[] }>}
 */
function getBulletinSeen(cid, bulletinId) {
  var none = {
    ok: false,
    not_seen: /** @type {string[]} */ ([]),
    seen: /** @type {string[]} */ ([]),
    reactions: {
      got_it: /** @type {string[]} */ ([]),
      done: /** @type {string[]} */ ([]),
      question: /** @type {string[]} */ ([]),
    },
    paused: /** @type {string[]} */ ([]),
    no_card: /** @type {string[]} */ ([]),
  };
  if (!cid || !bulletinId) return Promise.resolve(none);
  if (_isDemoSession()) {
    var store = _bltDemoLoad(cid);
    var groups = _bltDemoGroups(cid);
    var seen = store.seen[bulletinId] || [];
    var r = store.reactions[bulletinId] || {};
    var asked = function (/** @type {string[]} */ ids) {
      var set = {};
      (ids || []).forEach(function (id) {
        /** @type {Record<string, boolean>} */ (set)[id] = true;
      });
      return groups.can_see.filter(function (id) {
        return /** @type {Record<string, boolean>} */ (set)[id];
      });
    };
    var seenIds = asked(seen);
    return Promise.resolve({
      ok: true,
      not_seen: groups.can_see.filter(function (id) {
        return seenIds.indexOf(id) < 0;
      }),
      seen: seenIds,
      reactions: { got_it: asked(r.got_it), done: asked(r.done), question: asked(r.question) },
      paused: groups.paused,
      no_card: groups.no_card,
    });
  }
  if (!_bltOnServer(cid) || !_isUuid(bulletinId)) return Promise.resolve(none);
  var args = { p_bulletin_id: bulletinId };
  var quiet = { suppressSessionExpiredModal: true };
  return Promise.resolve()
    .then(function () {
      // @ts-expect-error list_bulletin_seen is not in types/database.d.ts until the migration is applied and the types are regenerated.
      return _callRpcWithAuthGuard('list_bulletin_seen', args, quiet);
    })
    .then(function (res) {
      var data = _rpcObject(res && res.data);
      if ((res && res.error) || !data) return none;
      var ids = function (/** @type {any} */ v) {
        return Array.isArray(v) ? v.map(String) : [];
      };
      var rx = data.reactions && typeof data.reactions === 'object' ? data.reactions : {};
      return {
        ok: true,
        not_seen: ids(data.not_seen),
        seen: ids(data.seen),
        reactions: { got_it: ids(rx.got_it), done: ids(rx.done), question: ids(rx.question) },
        paused: ids(data.paused),
        no_card: ids(data.no_card),
      };
    })
    .then(null, function () {
      return none;
    });
}

/* ── A page of a file ───────────────────────────────────────────────────── */

/**
 * A page's picture for the teacher: { url, release } or null. Demo Mode's are
 * the sample pictures in assets/ (or the small copy kept on the device);
 * a signed-in class's through a link signed for 300 seconds, fetched, and held
 * as a blob: address. Only a path in this class's own bulletin folder.
 * @param {string} cid @param {BulletinFile} file @param {number} i from 0
 * @returns {Promise<{ url: string, release: () => void } | null>}
 */
function getBulletinPage(cid, file, i) {
  var path = file && file.paths ? String(file.paths[i] || '') : '';
  if (!cid || !path) return Promise.resolve(null);
  if (_isDemoSession()) {
    var ok = /^(\/assets\/sample-bulletins\/|\/assets\/sample-handouts\/|data:image\/)/.test(path);
    return Promise.resolve(ok ? { url: path, release: function () {} } : null);
  }
  if (_bltPictures[path]) return Promise.resolve(_bltPictures[path]);
  var own = new RegExp('^' + String(cid).toLowerCase() + '/[0-9a-f-]{36}/([1-9]|1[0-9]|20)\\.jpg$');
  if (!own.test(path)) return Promise.resolve(null);
  var sb = /** @type {any} */ (getSupabase());
  if (!sb || !sb.storage || typeof fetch !== 'function') return Promise.resolve(null);
  return Promise.resolve(_signInWait)
    .then(function () {
      return sb.storage.from(BULLETIN_BUCKET).createSignedUrl(path, 300);
    })
    .then(function (/** @type {any} */ res) {
      var link = res && !res.error && res.data && res.data.signedUrl;
      if (!link) return null;
      return fetch(link, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }).then(function (r) {
        return r && r.ok ? r.blob() : null;
      });
    })
    .then(function (blob) {
      if (!blob) return null;
      // Always a picture: what is handed back is shown in an <img> and nothing else.
      var url = URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' }));
      var held = {
        url: url,
        release: function () {
          URL.revokeObjectURL(url);
          delete _bltPictures[path];
        },
      };
      _bltPictures[path] = held;
      return held;
    })
    .then(null, function () {
      return null;
    });
}

/** Let go of every picture held as a blob: address (the page closed). */
function releaseBulletinPictures() {
  Object.keys(_bltPictures).forEach(function (p) {
    try {
      _bltPictures[p].release();
    } catch (e) {
      /* already gone */
    }
  });
  _bltPictures = {};
}

/* ── Writing ────────────────────────────────────────────────────────────── */

/** The plain sentence of a refused write. @param {any} error */
function _bltMessage(error) {
  var m = error && error.message ? String(error.message) : '';
  if (error && error.code === '22023' && m) return m;
  return 'Bulletins could not be saved. Try again in a moment.';
}

/** @param {string} cid */
function _bltWriteBegan(cid) {
  _bltMemory(cid).writes++;
}

/** Put a bulletin the server answered into the list held, replacing one with its id. @param {string} cid @param {any} row */
function _bltPlace(cid, row) {
  var b = _bltFromRow(row);
  if (!b) return;
  var id = b.id;
  var mem = _bltMemory(cid);
  var at = -1;
  mem.list.forEach(function (x, i) {
    if (x.id === id) at = i;
  });
  if (at >= 0) mem.list[at] = b;
  else mem.list.push(b);
}

/** One bulletin's change on this device only, as the server will make it, until its write lands. @param {Bulletin} b @param {Record<string, any>} patch */
function _bltApplyPatch(b, patch) {
  var out = Object.assign({}, b);
  /** @type {any} */
  var any = out;
  Object.keys(patch).forEach(function (k) {
    any[k] = patch[k];
  });
  if (patch.pinned === false) out.pinned_until = null;
  if ('link_url' in patch && !patch.link_url) out.link_title = null;
  if ('body' in patch || 'link_url' in patch || 'link_title' in patch) out.edited_at = new Date().toISOString();
  return out;
}

/* The outbox tells every page when a write lands, even after a reload, so a
   post that was waiting when the page closed is still put right. */
function _bltListen() {
  if (_bltListening) return;
  var q = window.v2Queue;
  if (!q || typeof q.subscribe !== 'function') return;
  _bltListening = true;
  q.subscribe(function (evt) {
    var meta = evt && evt.meta;
    if (!meta || meta.endpoint !== 'post_bulletin') return;
    var cid = meta.payload && meta.payload.p_course_id;
    var key = String(meta.id || '');
    // A post whose pages wait in the photo queue: its answer, or its refusal, names the pages' paths or lets them go.
    if (cid && key && (evt.kind === 'flush:success' || evt.kind === 'flush:dead-letter')) {
      var held = _bltPending(cid).filter(function (e) {
        return e.key === key && e.queued;
      })[0];
      if (held) {
        _bltQueuedAnswered(
          cid,
          key,
          evt.kind === 'flush:success'
            ? { data: meta.data, error: null }
            : { data: null, error: (meta.result && meta.result.error) || { message: meta.error || 'refused' } },
        );
        return;
      }
    }
    if (evt.kind !== 'flush:success') return;
    if (!cid || !key || _bltFlows[key]) return; // this page's own post is handled where it was sent
    _bltDropPending(cid, key);
    var data = _rpcObject(meta.data);
    if (data && data.bulletin && data.bulletin.posted_at) _bltPlace(cid, data.bulletin);
    _bltChanged(cid);
    refreshBulletins(cid, { force: true });
  });
}

/**
 * Post a bulletin. bulletin: a draft ({ kind, body, link_url, link_title,
 * pinned_until, assessment_id, reactions_on }); files: [{ kind: 'photo' |
 * 'pdf', title, pages: [{ blob }] }] made by PhotoShrink.prepare, or none.
 * Resolves { ok: true, bulletin } once the server has it (and its files),
 * or { ok: false, message, offline? } with nothing posted: the draft is the
 * caller's to keep. Until then the bulletin shows as Not Sent Yet.
 * opts.queue (the phone): a post with files keeps its pages in the photo
 * queue and resolves { ok: true, waiting: true, key } as soon as they are
 * kept, with or without a connection; the rest happens on its own (see the
 * top of this file).
 * @param {string} cid
 * @param {Record<string, any>} bulletin
 * @param {{ kind: string, title: string, pages: { blob: Blob, thumb?: Blob }[] }[]} [files]
 * @param {{ queue?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, message?: string, offline?: boolean, waiting?: boolean, key?: string, bulletin?: Bulletin }>}
 */
function postBulletin(cid, bulletin, files, opts) {
  var list = Array.isArray(files) ? files : [];
  var problem = bulletinDraftProblem(
    Object.assign({}, bulletin, {
      files: list.map(function (f) {
        return { pages: f.pages.length };
      }),
    }),
  );
  if (problem) return Promise.resolve({ ok: false, message: problem });
  if (!cid) return Promise.resolve({ ok: false, message: 'Choose a class first.' });
  if (_isDemoSession()) return _bltDemoPost(cid, bulletin, list);
  if (!_bltOnServer(cid) || bulletinsState(cid) === 'missing') {
    return Promise.resolve({ ok: false, message: 'Bulletins are not available yet.' });
  }
  if (list.length && opts && opts.queue) {
    _bltListen();
    return _bltQueuedPost(cid, bulletinPayload(bulletin), list);
  }
  if (list.length && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.resolve({
      ok: false,
      offline: true,
      message: 'A file needs a connection. Your draft is kept; post it when you are back online.',
    });
  }
  _bltListen();
  return _bltSend(cid, bulletinPayload(bulletin), list, 0);
}

/**
 * @param {string} cid @param {Record<string, any>} payload @param {{ kind: string, title: string, pages: { blob: Blob }[] }[]} files @param {number} tries
 * @returns {Promise<{ ok: boolean, message?: string, bulletin?: Bulletin }>}
 */
function _bltSend(cid, payload, files, tries) {
  var key = _newEntryId();
  var meta = files.map(function (f) {
    return {
      kind: f.kind === 'pdf' ? 'pdf' : 'photo',
      title: String(f.title || '').slice(0, BULLETIN_NAME_MAX),
      pages: f.pages.length,
    };
  });
  var pending = _bltPending(cid);
  pending.push({ key: key, at: new Date().toISOString(), bulletin: payload, files: meta });
  _bltSavePending(cid, pending);
  // Only a post with files goes on after it lands (the upload); one without can still be taken back.
  if (files.length) _bltFlows[key] = true;
  _bltWriteBegan(cid);
  _bltChanged(cid);
  var finished = function (/** @type {{ ok: boolean, message?: string, bulletin?: Bulletin }} */ out) {
    delete _bltFlows[key];
    _bltWriteBegan(cid);
    _bltDropPending(cid, key);
    _bltChanged(cid);
    if (out.ok) refreshBulletins(cid, { force: true });
    return out;
  };
  return Promise.resolve(
    _writeRpc(
      'post_bulletin',
      { p_course_id: cid, p_bulletin: payload, p_files: meta.length ? meta : null, p_idempotency_key: key },
      { entryId: key },
    ),
  )
    .then(function (res) {
      if (res && res.error) {
        // Taken back before it went: nothing to say.
        if (res.error.cancelled) return finished({ ok: false });
        return finished({ ok: false, message: _bltMessage(res.error) });
      }
      var data = _rpcObject(res && res.data);
      var posted = data && data.bulletin;
      if (!posted) return finished({ ok: true });
      if (!files.length) {
        _bltPlace(cid, posted);
        return finished({ ok: true, bulletin: _bltFromRow(posted) || undefined });
      }
      return _bltUploadFiles(cid, posted, files).then(function (out) {
        if (out.gone && tries < 2) {
          // The upload ran out of time on the server: post again, with a new key, from the pages still held.
          finished({ ok: false });
          return _bltSend(cid, payload, files, tries + 1);
        }
        if (!out.ok) {
          // A bulletin students are never sent: let it go rather than leave it waiting.
          _writeRpc('delete_bulletin', { p_bulletin_id: posted.id, p_idempotency_key: _newEntryId() });
          return finished({ ok: false, message: out.message });
        }
        if (out.bulletin) _bltPlace(cid, out.bulletin);
        return finished({ ok: true, bulletin: out.bulletin ? _bltFromRow(out.bulletin) || undefined : undefined });
      });
    })
    .then(null, function (e) {
      console.warn('post_bulletin failed:', e);
      return finished({ ok: false, message: 'Bulletins could not be saved. Try again in a moment.' });
    });
}

/**
 * Upload every page of every file to the paths post_bulletin gave, then
 * finish each file. A page missing on the server is uploaded again; a file
 * the server no longer has is gone.
 * @param {string} cid @param {any} posted @param {{ pages: { blob: Blob }[] }[]} files
 * @returns {Promise<{ ok: boolean, gone?: boolean, message?: string, bulletin?: any }>}
 */
function _bltUploadFiles(cid, posted, files) {
  var sb = /** @type {any} */ (getSupabase());
  var serverFiles = (Array.isArray(posted.files) ? posted.files : [])
    .slice()
    .sort(function (/** @type {any} */ a, /** @type {any} */ b) {
      return (Number(a.position) || 0) - (Number(b.position) || 0);
    });
  var failed = {
    ok: false,
    message: 'A file did not go up. Check the connection and post it again.',
  };
  if (!sb || !sb.storage || serverFiles.length !== files.length) return Promise.resolve(failed);
  var bucket = sb.storage.from(BULLETIN_BUCKET);

  /** @param {string} path @param {Blob} blob @param {number} left */
  function putPage(path, blob, left) {
    return Promise.resolve(_signInWait)
      .then(function () {
        return bucket.upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      })
      .then(function (/** @type {any} */ res) {
        var err = res && res.error;
        // Already there (an earlier try got through): the page is up.
        if (err && /already exists|duplicate|409/i.test(String(err.message || '') + String(err.statusCode || '')))
          return true;
        if (!err) return true;
        return left > 0 ? putPage(path, blob, left - 1) : false;
      })
      .then(null, function () {
        return left > 0 ? putPage(path, blob, left - 1) : false;
      });
  }

  /** @param {any} serverFile @param {{ pages: { blob: Blob }[] }} mine @param {number[] | null} only */
  function putPages(serverFile, mine, only) {
    var numbers =
      only && only.length
        ? only
        : mine.pages.map(function (_p, i) {
            return i + 1;
          });
    var chain = Promise.resolve(true);
    numbers.forEach(function (n) {
      chain = chain.then(function (ok) {
        if (!ok) return false;
        var path = serverFile.paths && serverFile.paths[n - 1];
        var page = mine.pages[n - 1];
        if (!path || !page) return false;
        return putPage(String(path), page.blob, 2);
      });
    });
    return chain;
  }

  /** @param {any} serverFile @param {{ pages: { blob: Blob }[] }} mine @param {number} round @returns {Promise<{ ok: boolean, gone?: boolean, bulletin?: any }>} */
  function finish(serverFile, mine, round) {
    var key = _newEntryId();
    return Promise.resolve(
      _writeRpc(
        'finish_bulletin_file',
        { p_bulletin_file_id: serverFile.id, p_idempotency_key: key },
        { entryId: key },
      ),
    ).then(function (res) {
      var data = _rpcObject(res && res.data);
      if ((res && res.error) || !data) return { ok: false };
      if (data.status === 'gone') return { ok: false, gone: true };
      var missing = Array.isArray(data.missing) ? data.missing.map(Number) : [];
      var bad = Array.isArray(data.bad) ? data.bad : [];
      if (bad.length) return { ok: false };
      if (missing.length) {
        if (round >= 2) return { ok: false };
        return putPages(serverFile, mine, missing).then(function (ok) {
          return ok ? finish(serverFile, mine, round + 1) : { ok: false };
        });
      }
      return { ok: true, bulletin: data.bulletin };
    });
  }

  var chain = Promise.resolve(/** @type {{ ok: boolean, gone?: boolean, bulletin?: any }} */ ({ ok: true }));
  serverFiles.forEach(function (/** @type {any} */ sf, /** @type {number} */ i) {
    chain = chain.then(function (prev) {
      if (!prev.ok) return prev;
      return putPages(sf, files[i], null).then(function (ok) {
        if (!ok) return { ok: false };
        return finish(sf, files[i], 0);
      });
    });
  });
  return chain
    .then(function (out) {
      if (out.ok) return out;
      return out.gone ? { ok: false, gone: true } : failed;
    })
    .then(null, function () {
      return failed;
    });
}

/**
 * Take a bulletin back that has not gone yet: its waiting entry goes from
 * this device and its write from the outbox. false when it is already on its
 * way (in flight), or is not a waiting bulletin.
 * @param {string} cid @param {string} key
 */
function takeBackBulletin(cid, key) {
  if (!cid || !key || _bltFlows[key]) return false;
  var q = window.v2Queue;
  var entry = _bltPending(cid).filter(function (e) {
    return e.key === key;
  })[0];
  var mine = !!entry;
  if (entry && entry.queued) return _bltQueuedTakeBack(cid, entry);
  if (!mine || !q || typeof q.remove !== 'function') return false;
  if (!q.remove(key)) return false;
  _bltDropPending(cid, key);
  _bltChanged(cid);
  return true;
}

/** Whether a waiting bulletin can still be taken back. @param {string} cid @param {string} key */
function bulletinCanTakeBack(cid, key) {
  if (!cid || !key || _bltFlows[key] || _isDemoSession()) return false;
  var entry = _bltPending(cid).filter(function (e) {
    return e.key === key;
  })[0];
  // Pages on this device: until students can see it, it can be taken back (from the outbox, or from the server).
  if (entry && entry.queued) return !!entry.server || _bltOutboxHas(key);
  var q = window.v2Queue;
  return !!q && typeof q.has === 'function' && typeof q.remove === 'function' && q.has(key);
}

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
function takeReturnedBulletin(cid) {
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

/* A change to a bulletin the server has. */
/**
 * @param {string} cid @param {string} id @param {string} rpc
 * @param {Record<string, any>} params
 * @param {(b: Bulletin) => Bulletin} lay what this device shows until the write answers
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
function _bltChange(cid, id, rpc, params, lay) {
  var mem = _bltMemory(cid);
  var before = mem.list;
  mem.list = mem.list.map(function (b) {
    return b.id === id ? lay(b) : b;
  });
  _bltWriteBegan(cid);
  _bltChanged(cid);
  var key = _newEntryId();
  var sent = Object.assign({ p_bulletin_id: id }, params, { p_idempotency_key: key });
  var call;
  // Each name is written out, for the check that the database has it.
  if (rpc === 'edit_bulletin') call = _writeRpc('edit_bulletin', sent, { entryId: key });
  else if (rpc === 'delete_bulletin') call = _writeRpc('delete_bulletin', sent, { entryId: key });
  else call = _writeRpc('show_bulletin_again', sent, { entryId: key });
  return Promise.resolve(call)
    .then(function (res) {
      _bltWriteBegan(cid);
      if (res && res.error) {
        // Put back what was shown; the server's own list will say the rest.
        mem.list = before;
        _bltChanged(cid);
        refreshBulletins(cid, { force: true });
        return { ok: false, message: _bltMessage(res.error) };
      }
      var data = _rpcObject(res && res.data);
      if (data && data.bulletin) _bltPlace(cid, data.bulletin);
      _bltChanged(cid);
      refreshBulletins(cid, { force: true });
      return { ok: true };
    })
    .then(null, function () {
      _bltWriteBegan(cid);
      mem.list = before;
      _bltChanged(cid);
      return { ok: false, message: 'Bulletins could not be saved. Try again in a moment.' };
    });
}

/**
 * Change a bulletin: any of body, link_url, link_title, pinned,
 * pinned_until, assessment_id, reactions_on. A bulletin that is only waiting
 * (no server id) is refused: take it back instead.
 * @param {string} cid @param {string} id @param {Record<string, any>} patch
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
function editBulletin(cid, id, patch) {
  if (!cid || !id) return Promise.resolve({ ok: false, message: 'That bulletin is not there.' });
  var p = Object.assign({}, patch);
  if (typeof p.body === 'string') p.body = p.body.trim();
  if ('link_url' in p) {
    var link = String(p.link_url == null ? '' : p.link_url).trim();
    if (link && !bulletinLinkOk(link)) {
      return Promise.resolve({ ok: false, message: 'A link must start with http:// or https://.' });
    }
    p.link_url = link || null;
    if (!link) p.link_title = null;
  }
  if ('link_title' in p) {
    var name = String(p.link_title == null ? '' : p.link_title).trim();
    if (name.length > BULLETIN_NAME_MAX) {
      return Promise.resolve({ ok: false, message: 'A link name can be up to ' + BULLETIN_NAME_MAX + ' characters.' });
    }
    p.link_title = name || null;
  }
  if (typeof p.body === 'string' && p.body.length > BULLETIN_WORDS_MAX) {
    return Promise.resolve({ ok: false, message: 'Words can be up to ' + BULLETIN_WORDS_MAX + ' characters.' });
  }
  if (p.pinned_until) {
    var day = _bltDay(p.pinned_until);
    if (!day) return Promise.resolve({ ok: false, message: 'Choose a date for Stays Pinned Until.' });
    if (day < getTodayStr())
      return Promise.resolve({ ok: false, message: 'Stays Pinned Until cannot be before today.' });
    p.pinned_until = day;
  }
  if (_isDemoSession()) return _bltDemoEdit(cid, id, p);
  if (!_bltOnServer(cid) || !_isUuid(id)) return Promise.resolve({ ok: false, message: 'That bulletin is not there.' });
  return _bltChange(cid, id, 'edit_bulletin', { p_patch: p }, function (b) {
    return _bltApplyPatch(b, p);
  });
}

/** Pin or unpin. A reminder pinned again drops its old last day. @param {string} cid @param {string} id @param {boolean} pinned @returns {Promise<{ ok: boolean, message?: string }>} */
function setBulletinPinned(cid, id, pinned) {
  var b = getBulletins(cid).filter(function (x) {
    return x.id === id;
  })[0];
  /** @type {Record<string, any>} */
  var patch = { pinned: !!pinned };
  if (pinned && b && b.kind === 'reminder') patch.pinned_until = null;
  return editBulletin(cid, id, patch);
}

/** Delete a bulletin, its files and who has seen it. Nothing undoes it. @param {string} cid @param {string} id @returns {Promise<{ ok: boolean, message?: string }>} */
function deleteBulletin(cid, id) {
  if (!cid || !id) return Promise.resolve({ ok: false, message: 'That bulletin is not there.' });
  if (_isDemoSession()) return _bltDemoDelete(cid, id);
  if (!_bltOnServer(cid) || !_isUuid(id)) return Promise.resolve({ ok: false, message: 'That bulletin is not there.' });
  return _bltChange(cid, id, 'delete_bulletin', {}, function (b) {
    return b;
  }).then(function (out) {
    if (out.ok) {
      var mem = _bltMemory(cid);
      mem.list = mem.list.filter(function (b) {
        return b.id !== id;
      });
      _bltChanged(cid);
    }
    return out;
  });
}

/** Put a bulletin back at the top of the phones that have not seen it. @param {string} cid @param {string} id @returns {Promise<{ ok: boolean, message?: string }>} */
function showBulletinAgain(cid, id) {
  if (!cid || !id) return Promise.resolve({ ok: false, message: 'That bulletin is not there.' });
  if (_isDemoSession()) return _bltDemoAgain(cid, id);
  if (!_bltOnServer(cid) || !_isUuid(id)) return Promise.resolve({ ok: false, message: 'That bulletin is not there.' });
  return _bltChange(cid, id, 'show_bulletin_again', {}, function (b) {
    return Object.assign({}, b, { shown_again_at: new Date().toISOString() });
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

/** @param {string} cid @param {string} id @param {Record<string, any>} patch @returns {Promise<{ ok: boolean, message?: string }>} */
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

/** @param {string} cid @param {string} id @returns {Promise<{ ok: boolean, message?: string }>} */
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

/** @param {string} cid @param {string} id @returns {Promise<{ ok: boolean, message?: string }>} */
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
