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

   A file (a photo, or a PDF made into JPEG pages by PhotoShrink) goes up
   while online, right after post_bulletin answers with the paths: with no
   connection the post is refused up front and the draft stays with the
   teacher. The phone posts with { queue: true }: its pages wait in the photo
   queue (shared/data-bulletins-queue.js, B1f; the hooks below call into it
   only where it is loaded).

   Demo Mode keeps everything on this device in gb-bulletins-<cid>, in the
   shapes the server answers, and never calls the server
   (shared/data-bulletins-demo.js). The refusals' plain sentences are
   shared/bulletins-refusals.js. Both load after this file. */

var BULLETIN_WORDS_MAX = 2000;
var BULLETIN_LINK_MAX = 2000;
var BULLETIN_NAME_MAX = 200;
var BULLETIN_PAGES_MAX = 20;
var BULLETIN_REFRESH_MS = 15000;
var BULLETIN_REACTION_WORDS = { got_it: 'Got It', done: 'Done', question: 'Have a Question' };
var BULLETIN_BUCKET = 'bulletin-files';

/** @typedef {{ id: string, kind: string, title: string, page_count: number, bytes: number | null, status: string, position: number, paths: string[], finish_by?: string | null }} BulletinFile */
/** @typedef {{ got_it: number, done: number, question: number }} BulletinReactions */
/** @typedef {{ ok: boolean, message?: string, gone?: boolean }} BulletinWriteResult */
/** @typedef {{ id: string, kind: string, body: string, link_url: string | null, link_title: string | null, pinned: boolean, pinned_until: string | null, assessment_id: string | null, reactions_on: boolean, visible: boolean, waiting: boolean, stalled: boolean, key: string | null, posted_at: string | null, shown_again_at: string | null, edited_at: string | null, created_at: string | null, updated_at: string | null, idempotency_key: string | null, files: BulletinFile[], seen: number, can_see: number, reactions: BulletinReactions }} Bulletin */
/** @typedef {{ can_see: number, no_card: number, paused: number, page_on: boolean, more: boolean }} BulletinsMeta */
/** @typedef {{ key: string, at: string, bulletin: Record<string, any>, files: { kind: string, title: string, pages: number }[], queued?: boolean, takenBack?: boolean, old?: string[], [more: string]: any }} BulletinWaiting */
/** @typedef {{ state: string, list: Bulletin[], meta: BulletinsMeta, at: number, loading: Promise<boolean> | null, writes: number }} BulletinMemory */

/** @type {Record<string, BulletinMemory>} */
var _bltMem = {}; // cid → what was read last
/** @type {Record<string, boolean>} */
var _bltFlows = {}; // key → true while this page is uploading that bulletin's files
/** @type {Record<string, boolean>} */
var _bltKept = {}; // key → true when a refused post's draft is still in the page's box (its words are not returned a second time)
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

/* Characters that show nothing or turn the text round: a link holding one can read as another address. */
var _BLT_HIDDEN = /[­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/;

/** The address as a URL when it is http or https with a host and no spaces, else null. @param {string} url @returns {URL | null} */
function _bltParse(url) {
  if (!url || url.length > BULLETIN_LINK_MAX) return null;
  if (/[\s\u0000-\u001f]/.test(url)) return null;
  if (!/^https?:\/\/[^/?#\s]+/i.test(url)) return null;
  try {
    var parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname ? parsed : null;
  } catch (e) {
    return null;
  }
}

/**
 * Why a link cannot go on a bulletin, as one plain sentence; '' when it can
 * (or there is none). A link may not hold a user name or password before its
 * host, nor a character that shows nothing or turns the text round.
 * @param {unknown} value
 */
function bulletinLinkProblem(value) {
  var url = String(value == null ? '' : value).trim();
  if (!url) return '';
  if (_BLT_HIDDEN.test(url)) return 'A link cannot hold hidden characters.';
  var parsed = _bltParse(url);
  if (!parsed) return 'A link must start with http:// or https://.';
  if (parsed.username || parsed.password) return 'A link cannot hold a user name or a password.';
  return '';
}

/** The address, trimmed, when it may go on a bulletin, else ''. @param {unknown} value */
function bulletinLinkOk(value) {
  var url = String(value == null ? '' : value).trim();
  return url && !bulletinLinkProblem(url) ? url : '';
}

/**
 * A link as the feed shows it: { href, host } from a real parse, with any user
 * name or password dropped, or null (not http or https, or hidden characters).
 * @param {unknown} value @returns {{ href: string, host: string } | null}
 */
function bulletinLinkShown(value) {
  var url = String(value == null ? '' : value).trim();
  if (!url || _BLT_HIDDEN.test(url)) return null;
  var parsed = _bltParse(url);
  if (!parsed) return null;
  parsed.username = '';
  parsed.password = '';
  return { href: parsed.href, host: parsed.hostname.replace(/^www\./i, '') };
}

/** The site's name for a link card: its host without a leading www. @param {unknown} value */
function bulletinLinkHost(value) {
  var shown = bulletinLinkShown(value);
  return shown ? shown.host : '';
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
  if (link && bulletinLinkProblem(link)) return bulletinLinkProblem(link);
  var name = String(d.link_title == null ? '' : d.link_title).trim();
  if (name.length > BULLETIN_NAME_MAX) return 'A link name can be up to ' + BULLETIN_NAME_MAX + ' characters.';
  var pages = 0;
  files.forEach(function (f) {
    pages += Math.max(1, Number(f && f.pages) || 1);
  });
  if (pages > BULLETIN_PAGES_MAX) return 'A bulletin can hold up to ' + BULLETIN_PAGES_MAX + ' pages in all.';
  if (d.assessment_id && !_bltAssessmentOk(d.assessment_id)) return BULLETIN_ASSESSMENT_SAVING;
  if (d.pinned_until) {
    if (d.kind !== 'reminder') return 'Only a reminder can stay pinned until a date.';
    var day = _bltDay(d.pinned_until);
    if (!day) return 'Choose a date for Stays Pinned Until.';
    if (day < _bltToday(d.cid)) return 'Stays Pinned Until cannot be before today.';
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
  if (d.assessment_id && _bltAssessmentOk(d.assessment_id)) out.assessment_id = String(d.assessment_id);
  return out;
}

var BULLETIN_ASSESSMENT_SAVING = 'That assessment is still being saved. Try again in a moment, or choose None.';

/**
 * Whether an assessment id may be named in a bulletin: a signed-in class's must
 * be a server id (an assessment still waiting to be saved has a local one, and
 * an id inside a bulletin is never re-keyed); Demo Mode's are all local.
 * @param {unknown} id
 */
function _bltAssessmentOk(id) {
  if (typeof id !== 'string' || !id) return false;
  return _isDemoSession() || _isUuid(id);
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
    stalled: false,
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
    stalled: false,
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
  /** @type {Record<string, boolean>} */
  var onServer = {};
  list.forEach(function (b) {
    if (b.idempotency_key) onServer[b.idempotency_key] = true;
  });
  var q = window.v2Queue;
  if (typeof _bltQueuedSeenAll === 'function') _bltQueuedSeenAll(cid, list);
  _bltSweepDead(cid);
  var keep = _bltPending(cid).filter(function (e) {
    if (e.queued) return true; // the phone's queued post: shared/data-bulletins-queue.js lets it go
    if (onServer[e.key]) return false;
    if (_bltFlows[e.key]) return true;
    if (q && typeof q.has === 'function' && q.has(e.key)) return true;
    if (Date.now() - Date.parse(e.at) < 120000) return true; // just made: the outbox may not have it yet
    // Not in the outbox, not on the server: it was lost. Its words come back.
    _bltReturn(cid, e.key, e.bulletin, BULLETIN_LOST, e.at);
    return false;
  });
  _bltSavePending(cid, keep);
}

/** The class's bulletins as held: a waiting one first, then the server's, pinned first and newest first. @param {string} cid @returns {Bulletin[]} */
function getBulletins(cid) {
  if (!cid) return [];
  var mem = _bltMemory(cid);
  var list = mem.list.slice();
  if (_isDemoSession()) return bulletinsSorted(list);
  if (typeof _bltQueuedView === 'function') list = _bltQueuedView(cid, list);
  // A bulletin whose delete waits in the outbox (offline included) is gone from the list at once.
  var deleting = _bltDeleting();
  list = list.filter(function (b) {
    return deleting.indexOf(b.id) < 0;
  });
  /** @type {Record<string, boolean>} */
  var onServer = {};
  list.forEach(function (b) {
    if (b.idempotency_key) onServer[b.idempotency_key] = true;
  });
  var waiting = _bltPending(cid)
    .filter(function (e) {
      return !onServer[e.key] && !e.takenBack;
    })
    .map(_bltWaitingBulletin);
  // A bulletin the server holds that students are not sent, whose files this
  // device is not uploading (the page was closed or reloaded midway): stalled.
  var rows = list.map(function (b) {
    if (b.visible || (b.idempotency_key && _bltFlows[b.idempotency_key])) return b;
    return Object.assign({}, b, { stalled: true });
  });
  return bulletinsSorted(waiting.concat(rows));
}

/** @type {string[] | null} */
var _bltDeletingIds = null; // the bulletins whose delete waits in the outbox, read once until the outbox changes
/** @type {any} */
var _bltDeletingFor = null; // the outbox they were read from

/** The ids of the bulletins whose delete waits in the outbox: read and parsed once, then again only after the outbox changes. @returns {string[]} */
function _bltDeleting() {
  var outbox = /** @type {any} */ (window.v2Queue);
  if (!outbox || typeof outbox.queued !== 'function') return [];
  if (_bltDeletingFor !== outbox) {
    _bltDeletingFor = outbox;
    _bltDeletingIds = null;
    if (typeof outbox.subscribe === 'function') {
      outbox.subscribe(function () {
        if (_bltDeletingFor === outbox) _bltDeletingIds = null;
      });
    } else _bltDeletingFor = null; // no word of changes: read every time
  }
  if (!_bltDeletingIds) {
    _bltDeletingIds = outbox.queued('delete_bulletin').map(function (/** @type {any} */ e) {
      return String((e && e.payload && e.payload.p_bulletin_id) || '');
    });
  }
  return /** @type {string[]} */ (_bltDeletingIds);
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

/* ── A post that was refused or lost: its words come back ───────────────── */

/** @param {string} cid */
function _bltReturnedKey(cid) {
  return 'gb-bulletins-returned-' + cid;
}

/** @typedef {{ key: string, at: string, bulletin: Record<string, any>, message: string }} BulletinReturned */

/**
 * The bulletins of this class that were not posted (refused, or lost from the
 * outbox), oldest first, with the words they held. The page offers each back
 * to the teacher and then drops it.
 * @param {string} cid @returns {BulletinReturned[]}
 */
function getReturnedBulletins(cid) {
  var kept = _safeParseLS(_bltReturnedKey(cid), []);
  return Array.isArray(kept)
    ? kept.filter(function (e) {
        return e && typeof e.key === 'string' && e.bulletin && typeof e.bulletin === 'object';
      })
    : [];
}

/** @param {string} cid @param {string} key */
function dropReturnedBulletin(cid, key) {
  var list = getReturnedBulletins(cid);
  var rest = list.filter(function (e) {
    return e.key !== key;
  });
  if (rest.length === list.length) return;
  if (!rest.length) {
    try {
      localStorage.removeItem(_bltReturnedKey(cid));
    } catch (e) {
      /* storage blocked */
    }
  } else _safeLSSet(_bltReturnedKey(cid), JSON.stringify(rest));
}

/**
 * Keep the words of a bulletin that was not posted, once per key, and tell
 * the page. A bulletin with nothing in it is not kept, unless `always` (the
 * phone's photo with no words: the teacher is still told it was not posted).
 * @param {string} cid @param {string} key @param {any} payload @param {string} message @param {string} [at] @param {boolean} [always]
 */
function _bltReturn(cid, key, payload, message, at, always) {
  if (!cid || !payload || typeof payload !== 'object') return;
  if (_bltKept[key]) return; // the page still holds this draft in its box
  var has = String(payload.body || '').trim() || payload.link_url || always;
  if (!has) return;
  var list = getReturnedBulletins(cid);
  if (
    list.some(function (e) {
      return e.key === key;
    })
  )
    return;
  list.push({ key: key, at: at || new Date().toISOString(), bulletin: payload, message: message || BULLETIN_LOST });
  _safeLSSet(_bltReturnedKey(cid), JSON.stringify(list.slice(-20)));
  _bltChanged(cid);
}

/**
 * A post the outbox gave up on (a dead letter, kept across a reload): its
 * words come back and the dead letter is cleared, so it is not retried or
 * counted again.
 * @param {string} cid
 */
function _bltSweepDead(cid) {
  var q = window.v2Queue;
  if (!q || typeof q.deadLetter !== 'function') return;
  /** @type {any[]} */
  var dead = q.deadLetter() || [];
  dead.forEach(function (e) {
    if (!e || e.endpoint !== 'post_bulletin' || !e.payload || e.payload.p_course_id !== cid) return;
    var key = String(e.id || '');
    var pend = _bltPending(cid).filter(function (x) {
      return x.key === key;
    })[0];
    _bltReturn(
      cid,
      key,
      e.payload.p_bulletin,
      _bltMessage({ code: e.last_code, message: e.last_error }, 'post_bulletin'),
      pend && pend.at,
    );
    _bltDropPending(cid, key);
    if (typeof q.dismissDeadLetter === 'function') q.dismissDeadLetter(key);
  });
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
    if (typeof _bltQueuedEvent === 'function' && _bltQueuedEvent(evt.kind, cid, key, meta)) return;
    if (!cid || !key || _bltFlows[key]) return; // this page's own post is handled where it was sent
    if (evt.kind === 'flush:dead-letter') {
      // Refused after a reload (or by another tab): the words come back, with a plain sentence.
      var refused = meta.result && meta.result.error;
      var pend = _bltPending(cid).filter(function (x) {
        return x.key === key;
      })[0];
      _bltReturn(
        cid,
        key,
        meta.payload.p_bulletin,
        _bltMessage(refused || { message: meta.error }, 'post_bulletin'),
        pend && pend.at,
      );
      _bltDropPending(cid, key);
      if (typeof window.v2Queue.dismissDeadLetter === 'function') window.v2Queue.dismissDeadLetter(key);
      _bltChanged(cid);
      return;
    }
    if (evt.kind !== 'flush:success') return;
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
 * @param {string} cid
 * @param {Record<string, any>} bulletin
 * @param {{ kind: string, title: string, pages: { blob: Blob, thumb?: Blob }[] }[]} [files]
 * @param {{ queue?: boolean }} [opts] the phone: files wait in the photo queue (shared/data-bulletins-queue.js)
 * @returns {Promise<{ ok: boolean, message?: string, offline?: boolean, waiting?: boolean, key?: string, bulletin?: Bulletin }>}
 */
function postBulletin(cid, bulletin, files, opts) {
  var list = Array.isArray(files) ? files : [];
  var problem = bulletinDraftProblem(
    Object.assign({ cid: cid }, bulletin, {
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
  if (list.length && opts && opts.queue && typeof _bltQueuedPost === 'function')
    return _bltQueuedPost(cid, bulletinPayload(bulletin), list);
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
        var said = _bltMessage(res.error, 'post_bulletin');
        // No file: the draft was cleared when Post was pressed, so the words come back through the returned list.
        if (!files.length) _bltReturn(cid, key, payload, said);
        else _bltKept[key] = true; // a post with a file keeps its draft in the box
        return finished({ ok: false, message: said });
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
      var general = BULLETIN_GENERAL;
      if (!files.length) _bltReturn(cid, key, payload, general);
      else _bltKept[key] = true;
      return finished({ ok: false, message: general });
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
  var queued = typeof _bltQueuedTakeBack === 'function' ? _bltQueuedTakeBack(cid, key) : null;
  if (queued !== null) return queued;
  var q = window.v2Queue;
  var mine = _bltPending(cid).some(function (e) {
    return e.key === key;
  });
  if (!mine || !q || typeof q.remove !== 'function') return false;
  if (!q.remove(key)) return false;
  _bltDropPending(cid, key);
  _bltChanged(cid);
  return true;
}

/** Whether a waiting bulletin can still be taken back. @param {string} cid @param {string} key */
function bulletinCanTakeBack(cid, key) {
  if (!cid || !key || _bltFlows[key] || _isDemoSession()) return false;
  var held = _bltPending(cid).filter(function (e) {
    return e.key === key;
  })[0];
  if (held && held.queued) return !held.takenBack; // a queued post can be taken back until students see it
  var q = window.v2Queue;
  return !!q && typeof q.has === 'function' && typeof q.remove === 'function' && q.has(key);
}

/* A change to a bulletin the server has. */
/**
 * @param {string} cid @param {string} id @param {string} rpc
 * @param {Record<string, any>} params
 * @param {(b: Bulletin) => Bulletin} lay what this device shows until the write answers
 * @returns {Promise<BulletinWriteResult>}
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
        // Deleted a moment before (from another window): it is gone, not refused.
        var gone = !!res.error.code && String(res.error.code) === 'P0002';
        if (gone) {
          mem.list = before.filter(function (b) {
            return b.id !== id;
          });
        }
        _bltChanged(cid);
        refreshBulletins(cid, { force: true });
        return { ok: false, gone: gone, message: _bltMessage(res.error, rpc) };
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
 * @returns {Promise<BulletinWriteResult>}
 */
function editBulletin(cid, id, patch) {
  if (!cid || !id) return Promise.resolve({ ok: false, message: 'That bulletin is not there.' });
  var p = Object.assign({}, patch);
  if (typeof p.body === 'string') p.body = p.body.trim();
  if ('link_url' in p) {
    var link = String(p.link_url == null ? '' : p.link_url).trim();
    if (link && bulletinLinkProblem(link)) {
      return Promise.resolve({ ok: false, message: bulletinLinkProblem(link) });
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
  if (p.assessment_id && !_bltAssessmentOk(p.assessment_id)) {
    return Promise.resolve({ ok: false, message: BULLETIN_ASSESSMENT_SAVING });
  }
  if (p.pinned_until) {
    var day = _bltDay(p.pinned_until);
    if (!day) return Promise.resolve({ ok: false, message: 'Choose a date for Stays Pinned Until.' });
    if (day < _bltToday(cid))
      return Promise.resolve({ ok: false, message: 'Stays Pinned Until cannot be before today.' });
    p.pinned_until = day;
  }
  if (_isDemoSession()) return _bltDemoEdit(cid, id, p);
  if (!_bltOnServer(cid) || !_isUuid(id)) return Promise.resolve({ ok: false, message: 'That bulletin is not there.' });
  return _bltChange(cid, id, 'edit_bulletin', { p_patch: p }, function (b) {
    return _bltApplyPatch(b, p);
  });
}

/** Pin or unpin. A reminder pinned again drops its old last day. @param {string} cid @param {string} id @param {boolean} pinned @returns {Promise<BulletinWriteResult>} */
function setBulletinPinned(cid, id, pinned) {
  var b = getBulletins(cid).filter(function (x) {
    return x.id === id;
  })[0];
  /** @type {Record<string, any>} */
  var patch = { pinned: !!pinned };
  if (pinned && b && b.kind === 'reminder') patch.pinned_until = null;
  return editBulletin(cid, id, patch);
}

/** Delete a bulletin, its files and who has seen it. Nothing undoes it. @param {string} cid @param {string} id @returns {Promise<BulletinWriteResult>} */
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

/** Put a bulletin back at the top of the phones that have not seen it. @param {string} cid @param {string} id @returns {Promise<BulletinWriteResult>} */
function showBulletinAgain(cid, id) {
  if (!cid || !id) return Promise.resolve({ ok: false, message: 'That bulletin is not there.' });
  if (_isDemoSession()) return _bltDemoAgain(cid, id);
  if (!_bltOnServer(cid) || !_isUuid(id)) return Promise.resolve({ ok: false, message: 'That bulletin is not there.' });
  return _bltChange(cid, id, 'show_bulletin_again', {}, function (b) {
    return Object.assign({}, b, { shown_again_at: new Date().toISOString() });
  });
}
