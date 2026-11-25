// @ts-check
/* dash-bulletins.js — the Bulletins tile on the Dashboard, under the Inbox
   (slice B1e of docs/plans/bulletins-plan.md; boards A1 to A3). It draws only
   when the dashRow and bulletins build switches are both on: the middle row
   (dash-overview.js) calls DashBulletins.html(cid) and gives the tile the
   40% of the left column that is left under the Inbox.

   The pinned reminder first if there is one, then the latest, five at most;
   the tile draws as many whole rows as its height holds (dash-bulletins.css).
   Each row: a small kind label (the Reminder one amber with a pin), the words
   over two lines, the time as the Dashboard artboard writes it, and Seen by N
   of M as its own button (the full numbers are its accessible name). The words open the
   bulletin on the Bulletins page; Seen by opens it with its list; Write a
   Bulletin opens the page with the box open. Nothing is counted here: Seen
   by N of M is what shared/data-bulletins.js answers. The tile keeps no
   state in the page: the Dashboard draws it again with the rest, and the
   one listener below draws only the tile when the class's bulletins change.
   How many rows fit is a container query in dash-bulletins.css.

   Where the tile is wide enough for cards it is notes (.is-notes, set by
   _order from what the stylesheet says): the paper fits its words, a blank
   note is Write a Bulletin, and a bulletin that is a photo and no words
   shows the photo. */
/** @type {any} */ (window).DashBulletins = (function () {
  'use strict';

  var MAX_ROWS = 5;
  var EMPTY_LINE = "Bulletins reach every student's phone, on the first tab of their page.";
  var PAGE_OFF_LINE = 'Students cannot see Bulletins until the Student Page is turned on.';
  var JUST_NOW_MS = 60000;
  /** The pin the artboard draws before Reminder; fixed markup, no words. */
  var PIN_ICON =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/></svg>';

  var PLUS_ICON =
    '<svg viewBox="0 0 26 26" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M13 5v16M5 13h16"/></svg>';

  var _cid = '';
  var _listening = false;
  var _drawing = false;
  var _lastHtml = '';
  var _timer = 0;
  /** Watches the drawn tile's size so it becomes notes, or rows again, as its form changes. @type {any} */
  var _ro = null;
  /** The tile has become available while there is no slot for it: the row is drawn once more when nothing is open. */
  var _wantRow = false;
  var _retry = 0;
  /** Classes whose last read failed: a draw does not ask for them again, so reads that keep failing are not tried on every draw; the 30-second tick does. @type {Record<string, boolean>} */
  var _failing = {};
  var REFRESH_MS = 30000;

  /* ── Pure helpers ─────────────────────────────────────────── */

  /** @param {any} b @param {string} today 'YYYY-MM-DD' */
  function _stillPinned(b, today) {
    return !!b.pinned && !(b.pinned_until && String(b.pinned_until) < today);
  }

  /** @param {any} b */
  function _timeOf(b) {
    return String((b && (b.posted_at || b.created_at)) || '');
  }

  /** The bulletins the tile shows, in order: the pinned reminder (a pin that
   * has run out is not a pin), then the latest. At most three.
   * @param {any[]} list @param {string} today 'YYYY-MM-DD'
   * @returns {any[]} */
  function pick(list, today) {
    var all = (list || []).filter(Boolean);
    var lead = all
      .filter(function (b) {
        return _stillPinned(b, today);
      })
      .sort(function (a, b) {
        var ta = _timeOf(a);
        var tb = _timeOf(b);
        return ta === tb ? 0 : ta < tb ? 1 : -1;
      })[0];
    var rest = bulletinsSorted(
      all
        .filter(function (b) {
          return b !== lead;
        })
        .map(function (b) {
          return Object.assign({}, b, { pinned: false });
        }),
    );
    return (lead ? [lead] : []).concat(rest).slice(0, MAX_ROWS);
  }

  /** @returns {any} */
  function _helpers() {
    return /** @type {any} */ (window).BulletinsFormat || null;
  }

  /** "Reminder", "Announcement" or "Photo of the Board". @param {any} b */
  function kindText(b) {
    if (b.kind === 'reminder') return 'Reminder';
    var h = _helpers();
    return h ? h.kindLabel(b) : 'Announcement';
  }

  /** " · Until Thu" for a reminder that has an end day: the wide tile's card says it after Reminder. @param {any} b */
  function untilText(b) {
    var h = _helpers();
    if (!b || b.kind !== 'reminder' || !b.pinned_until || !h) return '';
    return ' \u00b7 Until ' + String(h.dateLabel(String(b.pinned_until))).split(',')[0];
  }

  /** The class's name for the wide tile's subtitle. @param {string} cid */
  function _className(cid) {
    var c = typeof COURSES !== 'undefined' ? COURSES[cid] : null;
    return (c && c.name) || '';
  }

  /** The first line of a bulletin's words, or what stands in for them. @param {any} b */
  function firstLine(b) {
    var lines = String(b.body || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t) return t;
    }
    if (b.link_title) return String(b.link_title);
    var f = (b.files || [])[0];
    if (f) return f.kind === 'photo' ? 'A photo' : f.title ? String(f.title) : 'A file';
    return 'A bulletin';
  }

  /** @param {any} b @param {number} nowMs */
  function isFresh(b, nowMs) {
    if (b.waiting) return !b.stalled;
    var at = new Date(_timeOf(b)).getTime();
    return !isNaN(at) && nowMs - at < JUST_NOW_MS && nowMs - at > -JUST_NOW_MS;
  }

  /** The time as the Dashboard artboard writes it: "Just Now", the time alone for today ("10:15"), the weekday alone for the last six days ("Mon"), "Yesterday", and "Nov 9" after that. @param {any} b @param {Date} now */
  function timeText(b, now) {
    if (isFresh(b, now.getTime())) return 'Just Now';
    var h = _helpers();
    var label = h ? h.timeLabel(_timeOf(b), now) : '';
    var clock = /\s*\d{1,2}:\d{2}(?: [ap]\.m\.)?$/;
    if (/^\d{1,2}:\d{2}/.test(label)) return label.replace(/ [ap]\.m\.$/, '');
    return label.replace(clock, '').replace(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]+$/, '$1');
  }

  /** The time with its full day and clock, for the accessible name: "Just Now", "10:15 a.m.", "Monday 8:42 a.m.". @param {any} b @param {Date} now */
  function timeFull(b, now) {
    if (isFresh(b, now.getTime())) return 'Just Now';
    var h = _helpers();
    return h ? h.timeLabel(_timeOf(b), now) : '';
  }

  /** One row, as the tile draws it. @param {any} b @param {string} cid @param {Date} now */
  function rowModel(b, cid, now) {
    var q = '/bulletins?course=' + encodeURIComponent(cid);
    var label = bulletinSeenText(Number(b.seen) || 0, Number(b.can_see) || 0);
    var split = label.indexOf(' · ');
    return {
      id: String(b.id),
      kind: kindText(b),
      words: firstLine(b),
      allWords: String(b.body || '')
        .replace(/\s+/g, ' ')
        .trim(),
      time: timeText(b, now),
      timeFull: timeFull(b, now),
      fresh: isFresh(b, now.getTime()),
      waiting: !!b.waiting && !b.stalled,
      stalled: !!b.stalled,
      seenMain: split < 0 ? label : label.slice(0, split),
      seenNot: split < 0 ? '' : label.slice(split + 3),
      seenFull: split < 0 ? label : label.slice(0, split) + ', ' + label.slice(split + 3),
      reminder: b.kind === 'reminder',
      // A bulletin that is a photo and no words: the note shows the photo (the wide tile only).
      pic:
        !String(b.body || '').trim() && (b.files || [])[0] && b.files[0].kind === 'photo' ? String(b.files[0].id) : '',
      until: untilText(b),
      href: q + '&open=' + encodeURIComponent(b.id),
      seenHref: q + '&seen=' + encodeURIComponent(b.id),
    };
  }

  /**
   * What the tile shows for a class: { mode, rows, ... }. mode is 'none' (the
   * server has not said Bulletins is there, so the app offers nothing and the
   * Inbox keeps the whole column), 'rows', 'empty', or 'pageoff' (the Student
   * Page is off for the class).
   * @param {string} cid @param {Date} [now]
   */
  function model(cid, now) {
    var at = now || new Date();
    /** @type {{ mode: string, offered: boolean, rows: ReturnType<typeof rowModel>[] }} */
    var out = { mode: 'none', offered: false, rows: [] };
    var demo = typeof isDemoMode === 'function' && isDemoMode();
    if (!demo && bulletinsState(cid) !== 'ok') return out;
    out.offered = bulletinsOffered(cid);
    if (!out.offered) return out;
    if (!getBulletinsMeta(cid).page_on) return Object.assign(out, { mode: 'pageoff' });
    var today =
      typeof courseToday === 'function' ? courseToday(cid) : typeof getTodayStr === 'function' ? getTodayStr() : '';
    out.rows = pick(getBulletins(cid), today).map(function (b) {
      return rowModel(b, cid, at);
    });
    out.mode = out.rows.length ? 'rows' : 'empty';
    return out;
  }

  /* ── Drawing ──────────────────────────────────────────────── */

  /** @param {string} cid @param {string} [query] */
  function _link(cid, query) {
    return '/bulletins?course=' + encodeURIComponent(cid) + (query || '');
  }

  /** @param {ReturnType<typeof rowModel>} r */
  function _rowHtml(r) {
    var aria = r.kind + r.until + ': ' + (r.allWords || r.words) + (r.timeFull ? ', ' + r.timeFull : '');
    var seen = r.stalled
      ? '<span class="dash-bulletins-seen dash-bulletins-pending">Didn&#39;t Finish Uploading</span>'
      : r.waiting
        ? '<span class="dash-bulletins-seen dash-bulletins-pending">Not Sent Yet</span>'
        : '<button type="button" class="dash-bulletins-seen" data-dash-bulletins-go="' +
          esc(r.seenHref) +
          '" aria-label="' +
          esc(r.seenFull) +
          '">' +
          esc(r.seenMain) +
          '</button>';
    return (
      '<li class="dash-bulletins-row' +
      (r.fresh ? ' dash-bulletins-fresh' : '') +
      '"><span class="dash-bulletins-kind' +
      (r.reminder ? ' dash-bulletins-rem' : r.kind === 'Announcement' ? ' dash-bulletins-plain' : '') +
      '"' +
      (r.until ? ' data-until="' + esc(r.until) + '"' : '') +
      '>' +
      (r.reminder ? PIN_ICON : '') +
      esc(r.kind) +
      '</span><a class="dash-bulletins-words" role="link" tabindex="0" data-href="' +
      esc(r.href) +
      '" aria-label="' +
      esc(aria) +
      '">' +
      (r.pic
        ? '<img class="dash-bulletins-pic" alt="" data-bulletin-id="' + esc(r.id) + '" data-file="' + esc(r.pic) + '">'
        : '') +
      esc(r.allWords || r.words) +
      '</a><span class="dash-bulletins-time">' +
      esc(r.time) +
      '</span>' +
      seen +
      '</li>'
    );
  }

  /** The tile as a string: no state is read from the page. @param {string} cid @param {Date} [now] */
  function tileHtml(cid, now) {
    var m = model(cid, now);
    if (m.mode === 'none') return '';
    var meta = getBulletinsMeta(cid);
    var sub = '';
    if (m.mode !== 'pageoff') {
      sub = meta.can_see > 0 ? meta.can_see + ' can see it' : 'No one can see it yet';
      if (meta.paused > 0) sub += ', ' + meta.paused + (meta.paused === 1 ? ' page paused' : ' pages paused');
    }
    var actions = m.offered
      ? '<span class="dash-bulletins-actions"><button type="button" class="btn btn-ghost dash-bulletins-write" data-dash-bulletins-go="' +
        esc(_link(cid, '&write=1')) +
        '">Write a Bulletin</button><a class="dash-bulletins-open" role="link" tabindex="0" data-href="' +
        esc(_link(cid)) +
        '">Open Bulletins →</a></span>'
      : '';
    var cls = sub ? _className(cid) : '';
    var h =
      '<section class="dash-bulletins-tile" aria-labelledby="dash-bulletins-title"><div class="dash-bulletins-head"><h2 class="dash-bulletins-title" id="dash-bulletins-title">Bulletins</h2>' +
      (sub
        ? '<span class="dash-bulletins-sub' +
          // The notes show this line only when it has something to act on.
          (meta.can_see > 0 && !(meta.paused > 0) ? '' : ' is-alert') +
          '">' +
          (cls ? '<span class="dash-bulletins-cls">' + esc(cls) + ' &middot; </span>' : '') +
          esc(sub) +
          '</span>'
        : '') +
      '</div>' +
      actions;
    if (m.mode === 'rows') {
      // The notes' next free place is a blank one to write on (drawn only where the tile is notes).
      var blank = m.offered
        ? '<li class="dash-bulletins-blank"><button type="button" class="dash-bulletins-blank-btn" data-dash-bulletins-go="' +
          esc(_link(cid, '&write=1')) +
          '">' +
          PLUS_ICON +
          'Write a Bulletin</button></li>'
        : '';
      h += '<ol class="dash-bulletins-rows">' + m.rows.map(_rowHtml).join('') + blank + '</ol>';
    } else if (m.mode === 'empty') {
      h += '<div class="dash-bulletins-none"><b>Nothing Posted Yet</b><span>' + esc(EMPTY_LINE) + '</span></div>';
    } else if (m.mode === 'pageoff') {
      h +=
        '<div class="dash-bulletins-none"><span>' +
        esc(PAGE_OFF_LINE) +
        ' <a role="link" tabindex="0" data-href="' +
        esc('/dashboard?course=' + encodeURIComponent(cid) + '&manage=student-page') +
        '">Class Settings →</a></span></div>';
    }
    return h + '</section>';
  }

  /* ── Where the tile lives ─────────────────────────────────── */

  function _slot() {
    return document.querySelector('.dash-row-bulletins');
  }

  /** True while something on the row is open or has the keyboard: a menu, a list, a pile, the grader. The row is not drawn again then. */
  function _blocked() {
    if (document.getElementById('grader-overlay')) return true;
    var row = document.querySelector('.dash-row');
    if (!row) return false;
    // A file is being dragged over the Inbox: its cover is up (dash-inbox-drop.js shows it by clearing `hidden`).
    if (row.querySelector('.dash-inbox-drop-cover:not([hidden])')) return true;
    // Keyboard focus on a control with an id is put back after the draw; on a text box or a control that cannot be found again, the draw waits.
    var a = /** @type {any} */ (document.activeElement);
    if (
      a &&
      a !== document.body &&
      row.contains(a) &&
      (!a.id || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)
    )
      return true;
    return !!row.querySelector('[aria-expanded="true"], .dash-view-menu:not([hidden]), .is-open');
  }

  /** The tile has become available and there is no slot: the Dashboard draws its row once more, when nothing is open. */
  function _tryRow() {
    if (!_wantRow) return;
    if (_retry) window.clearTimeout(_retry);
    _retry = 0;
    if (!_listening || !_cid || _slot()) {
      _wantRow = false;
      return;
    }
    if (_blocked() || !document.querySelector('.dash-row')) {
      _retry = window.setTimeout(_tryRow, 2000);
      return;
    }
    _wantRow = false;
    var page = /** @type {any} */ (window).PageDashboard;
    if (!page || typeof page.render !== 'function') return;
    var held = /** @type {any} */ (document.activeElement);
    var heldId = held && held !== document.body && held.id ? held.id : '';
    var main = document.getElementById('main');
    var top = main ? main.scrollTop : 0;
    page.render();
    if (main) main.scrollTop = top;
    var back = heldId ? document.getElementById(heldId) : null;
    if (back && typeof back.focus === 'function') back.focus({ preventScroll: true });
  }

  /** The class's bulletins changed: draw the tile again, only if what it shows is different and only for the class it is showing. With no slot, a class that has become available asks for the row once. @param {any} e */
  function _onChanged(e) {
    if (!_listening || _drawing || !_cid) return;
    var cid = e && e.detail && e.detail.cid;
    if (cid && cid !== _cid) return;
    var slot = _slot();
    if (!slot) {
      if (model(_cid).mode !== 'none') {
        _wantRow = true;
        _tryRow();
      }
      return;
    }
    // A press or a focus inside the tile is never taken away: the next change draws it.
    if (document.activeElement && slot.contains(document.activeElement)) return;
    var next = tileHtml(_cid);
    if (!next || next === _lastHtml) return;
    _lastHtml = next;
    // html-safe: tileHtml escapes every word, name and address; the rest is fixed markup.
    slot.innerHTML = next;
    _watch();
  }

  /** Where the stylesheet draws cards (it says so on the header) the tile is notes: the paper fits its words, the blank note is Write a Bulletin, and a photo bulletin shows its photo. The two header links stay first in the page in both forms, as on screen. */
  function _order() {
    var t = document.querySelector('.dash-bulletins-tile');
    if (!t) return;
    var head = t.querySelector('.dash-bulletins-head');
    var cs = /** @type {any} */ (head ? getComputedStyle(head) : null);
    var notes =
      !!cs && typeof cs.getPropertyValue === 'function' && cs.getPropertyValue('--dash-bulletins-cards').trim() === '1';
    t.classList.toggle('is-notes', notes);
    if (notes) _pics(t);
  }

  /** A photo note's picture, asked for once the tile is notes: the first page of the bulletin's photo. @param {Element} t */
  function _pics(t) {
    var cid = _cid;
    if (!cid || typeof getBulletinPage !== 'function') return;
    var list = getBulletins(cid);
    t.querySelectorAll('img.dash-bulletins-pic:not([data-asked])').forEach(function (/** @type {any} */ img) {
      img.setAttribute('data-asked', '1');
      var b = list.filter(function (/** @type {any} */ x) {
        return String(x.id) === img.getAttribute('data-bulletin-id');
      })[0];
      var f =
        b &&
        (b.files || []).filter(function (/** @type {any} */ x) {
          return String(x.id) === img.getAttribute('data-file');
        })[0];
      if (!f) return;
      getBulletinPage(cid, f, 0).then(function (/** @type {any} */ pic) {
        if (!pic || cid !== _cid || !img.isConnected) return;
        img.src = pic.url;
        if (img.parentElement) img.parentElement.classList.add('has-pic');
      });
    });
  }

  /** Watches the tile now on the page (the one just drawn), and only that one: the last tile's watch is dropped first. Sets its form once. */
  function _watch() {
    if (_ro) _ro.disconnect();
    _ro = null;
    var t = document.querySelector('.dash-bulletins-tile');
    if (t && typeof ResizeObserver === 'function') {
      _ro = new ResizeObserver(_order);
      _ro.observe(t);
    }
    _order();
  }

  /** A press on Write a Bulletin or Seen by opens that address in the app. @param {any} e */
  function _onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-dash-bulletins-go]') : null;
    var slot = _slot();
    if (!t || !slot || !slot.contains(t)) return;
    var url = t.getAttribute('data-dash-bulletins-go');
    var router = /** @type {any} */ (window).Router;
    if (url && router && typeof router.navigate === 'function') router.navigate(url);
  }

  /** @param {string} cid */
  function _ask(cid) {
    // A read dropped because the class changed or a write of this device was under way is not a failure.
    var dropped = false;
    var writes = typeof _bltMemory === 'function' ? _bltMemory(cid).writes : 0;
    refreshBulletins(cid, {
      stillShown: function () {
        var shown = _listening && _cid === cid;
        if (!shown) dropped = true;
        return shown;
      },
    }).then(function (ok) {
      if (typeof _bltMemory === 'function' && _bltMemory(cid).writes !== writes) dropped = true;
      if (_listening && !dropped) _failing[cid] = !ok;
    });
  }

  /**
   * The tile's markup for the middle row, or '' when the app offers no
   * Bulletins for the class yet (a signed-in class whose server has not
   * answered, or has no Bulletins functions): then there is no slot and the
   * Inbox keeps the whole column. Asks for fresh bulletins on a draw, but not
   * for a class whose last read failed: that is tried again only by the
   * 30-second tick.
   * @param {string} cid
   */
  function html(cid) {
    var flags = /** @type {any} */ (window).BuildFlags;
    if (!(flags && flags.on('dashRow') && flags.on('bulletins'))) return '';
    if (!_listening) {
      document.addEventListener('fv:bulletins-changed', _onChanged);
      document.addEventListener('click', _onClick);
      _listening = true;
      // Every 30 seconds while the page is showing; the data layer throttles it.
      _timer = window.setInterval(function () {
        if (!_cid || document.visibilityState === 'hidden') return;
        _ask(_cid);
      }, REFRESH_MS);
    }
    _cid = cid;
    if (bulletinsState(cid) !== 'failed' && !_failing[cid]) {
      _drawing = true;
      try {
        _ask(cid);
      } finally {
        _drawing = false;
      }
    }
    _lastHtml = tileHtml(cid);
    // The Dashboard puts the markup in its slot once this returns; the order is set then.
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(_watch);
    return _lastHtml;
  }

  /** The Dashboard is going: let go of the listeners. */
  function destroy() {
    if (_listening) {
      document.removeEventListener('fv:bulletins-changed', _onChanged);
      document.removeEventListener('click', _onClick);
    }
    if (_timer) window.clearInterval(_timer);
    if (_retry) window.clearTimeout(_retry);
    _timer = 0;
    _retry = 0;
    _wantRow = false;
    if (_ro) _ro.disconnect();
    _ro = null;
    _failing = {};
    _listening = false;
    _cid = '';
    _lastHtml = '';
  }

  return {
    html: html,
    destroy: destroy,
    model: model,
    _helpers: {
      pick: pick,
      kindText: kindText,
      untilText: untilText,
      firstLine: firstLine,
      timeText: timeText,
      timeFull: timeFull,
      rowModel: rowModel,
      rowHtml: _rowHtml,
      tileHtml: tileHtml,
    },
  };
})();
