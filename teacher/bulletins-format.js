// @ts-check
/* bulletins-format.js — the words and the focus keepers of Bulletins that
   have no page of their own: day headings, times, the kind label, the header's
   notes, and putting keyboard focus back after a redraw. Moved out of
   page-bulletins.js unchanged; the Bulletins page and the Dashboard's tile
   (dash-bulletins.js) both read it. */
/** @type {any} */ (window).BulletinsFormat = (function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /* ── Words ───────────────────────────────────────────────────── */

  /** @param {number} n */
  function _pad(n) {
    return String(n).padStart(2, '0');
  }
  /** @param {string} ymd @returns {Date | null} */
  function _dayOf(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  /** "Thu, Nov 19" @param {string} ymd */
  function dateLabel(ymd) {
    var d = _dayOf(ymd);
    return d ? DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() : '';
  }
  /** @param {string} iso */
  function _timeOf(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var h = d.getHours();
    return (h % 12 || 12) + ':' + _pad(d.getMinutes()) + (h < 12 ? ' a.m.' : ' p.m.');
  }

  /**
   * The heading a bulletin sits under: Today, a weekday for the last six days,
   * else the date.
   * @param {string} iso @param {Date} [now]
   */
  function dayHeading(iso, now) {
    var at = new Date(iso);
    if (isNaN(at.getTime())) return '';
    var today = now || new Date();
    var a = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
    var t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    var back = Math.round((t - a) / 86400000);
    if (back === 0) return 'Today';
    if (back === 1) return 'Yesterday';
    if (back > 1 && back < 7) return DAY_NAMES[at.getDay()];
    return (
      MONTHS[at.getMonth()] +
      ' ' +
      at.getDate() +
      (at.getFullYear() !== today.getFullYear() ? ', ' + at.getFullYear() : '')
    );
  }

  /**
   * When a returned bulletin was written, for "Your bulletin from …": the time
   * today, else the day with it ("yesterday at 12:17 p.m.", "Monday at 12:17 p.m.").
   * @param {string} iso @param {Date} [now]
   */
  function returnedWhen(iso, now) {
    var day = dayHeading(iso, now);
    var t = _timeOf(iso);
    if (!day || day === 'Today') return t;
    return (day === 'Yesterday' ? 'yesterday' : day) + ' at ' + t;
  }

  /** The time on a bulletin: the time today, else the weekday and time. @param {string} iso @param {Date} [now] */
  function timeLabel(iso, now) {
    var h = dayHeading(iso, now);
    if (!h) return '';
    var t = _timeOf(iso);
    return h === 'Today' ? t : h === 'Yesterday' ? 'Yesterday ' + t : h + ' ' + t;
  }

  /**
   * The small grey label above a bulletin: Announcement, Reminder · Until
   * Thu, Nov 19, or Photo of the Board (an announcement that is only a
   * photo, with or without a caption).
   * @param {any} b
   */
  function kindLabel(b) {
    if (b.kind === 'reminder') return b.pinned_until ? 'Reminder · Until ' + dateLabel(b.pinned_until) : 'Reminder';
    var files = b.files || [];
    if (!b.link_url && files.length === 1 && files[0].kind === 'photo') return 'Photo of the Board';
    return 'Announcement';
  }

  /** "26 students can see it" and the note after it. @param {number} n */
  function canSeeText(n) {
    if (n === 1) return '1 student can see it';
    if (n <= 0) return 'No students can see it yet';
    return n + ' students can see it';
  }

  /**
   * The header's parts after "26 students can see it": the Have No Card Yet
   * count, and the students not counted (names when one or two, else a count).
   * @param {{ no_card: number, paused: number }} meta @param {string[]} pausedNames
   * @returns {{ noCard: string, paused: string }}
   */
  function headerNotes(meta, pausedNames) {
    var paused = Number(meta.paused) || 0;
    var text = '';
    if (paused > 0) {
      var names = (pausedNames || []).filter(Boolean);
      if (names.length === paused && paused <= 2) text = names.join(' and ') + ' Not Counted (Page Paused)';
      else text = paused + ' Not Counted (Page Paused)';
    }
    return { noCard: meta.no_card > 0 ? meta.no_card + ' Have No Card Yet' : '', paused: text };
  }

  /* ── Keeping focus across a redraw ───────────────────────────── */

  /**
   * What has keyboard focus inside `root`, as something that can be found again
   * after that markup is drawn anew (a redraw must not drop focus on the page).
   * @param {Element | null} root @returns {Record<string, string> | null}
   */
  function _focusSpec(root) {
    var a = /** @type {any} */ (document.activeElement);
    if (!a || a === document.body || !root || !root.contains(a)) return null;
    var art = a.closest ? a.closest('[data-bulletin-id]') : null;
    return {
      id: a.id || '',
      action: a.getAttribute('data-bulletin') || '',
      did: a.getAttribute('data-id') || '',
      kind: a.getAttribute('data-kind') || '',
      index: a.getAttribute('data-index') || '',
      art: art ? art.getAttribute('data-bulletin-id') : '',
    };
  }

  /** The control of a bulletin, found by its action. @param {Element | null} root @param {string} bid @param {string} action @returns {any} */
  function _controlOf(root, bid, action) {
    if (!root) return null;
    var cards = root.querySelectorAll('[data-bulletin-id]');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute('data-bulletin-id') !== bid) continue;
      var all = cards[i].querySelectorAll('[data-bulletin]');
      for (var j = 0; j < all.length; j++) if (all[j].getAttribute('data-bulletin') === action) return all[j];
    }
    return null;
  }

  /**
   * Put focus back on what had it (see _focusSpec); when that control is gone,
   * on its bulletin's ⋯ button. true when something took focus.
   * @param {Element | null} root @param {Record<string, string> | null} spec
   */
  function _applyFocus(root, spec) {
    if (!root || !spec) return false;
    /** @type {any} */
    var found = null;
    if (spec.id) found = document.getElementById(spec.id);
    else {
      var all = root.querySelectorAll('[data-bulletin]');
      for (var i = 0; i < all.length && !found; i++) {
        var n = /** @type {any} */ (all[i]);
        if (
          n.getAttribute('data-bulletin') === spec.action &&
          (n.getAttribute('data-id') || '') === spec.did &&
          (n.getAttribute('data-kind') || '') === spec.kind &&
          (n.getAttribute('data-index') || '') === spec.index &&
          !n.disabled &&
          !n.closest('[hidden]')
        )
          found = n;
      }
    }
    if (!found && spec.art) found = _controlOf(root, spec.art, 'menu');
    if (found && typeof found.focus === 'function') {
      found.focus();
      return true;
    }
    return false;
  }

  return {
    dateLabel: dateLabel,
    dayHeading: dayHeading,
    returnedWhen: returnedWhen,
    timeLabel: timeLabel,
    kindLabel: kindLabel,
    canSeeText: canSeeText,
    headerNotes: headerNotes,
    focusSpec: _focusSpec,
    controlOf: _controlOf,
    applyFocus: _applyFocus,
  };
})();
