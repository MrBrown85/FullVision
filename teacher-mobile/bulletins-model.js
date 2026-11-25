// @ts-check
/* bulletins-model.js — the phone's Bulletins feed as data: each card's kind,
   day and Seen line, newest first (teacher-mobile/tab-bulletins.js draws
   it; slice B1f). Pure: no page, no storage; moved here from the tab for its
   size, unchanged. */
window.MBulletinsModel = (function () {
  'use strict';

  /** @type {any} */
  var W = window;

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** "Fri, Nov 20" from 'YYYY-MM-DD'. @param {string} day */
  function dayText(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
    if (!m) return '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /**
   * The day heading over a card: Today, Yesterday, the weekday within the
   * week, else the date ("Fri, Nov 13"). Cards of one day share a heading.
   * @param {string | null} iso @param {Date} [now]
   */
  function dayLabel(iso, now) {
    if (!iso) return '';
    var at = new Date(iso);
    if (isNaN(at.getTime())) return '';
    var t = now || new Date();
    var a = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
    var b = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    var back = Math.round((b - a) / 86400000);
    if (back <= 0) return 'Today';
    if (back === 1) return 'Yesterday';
    if (back < 7) return WEEKDAYS[at.getDay()];
    return DAYS[at.getDay()] + ', ' + MONTHS[at.getMonth()] + ' ' + at.getDate();
  }

  /** Announcement, Reminder · Until Thu, Nov 19, or Photo of the Board. @param {any} b */
  function kindLabel(b) {
    if (b.kind === 'reminder') return b.pinned_until ? 'Reminder · Until ' + dayText(b.pinned_until) : 'Reminder';
    var files = b.files || [];
    if (!b.link_url && files.length === 1 && files[0].kind === 'photo') return 'Photo of the Board';
    return 'Announcement';
  }

  /**
   * The card's last line: Not Sent Yet for one still on this phone, else
   * "Seen by 18 of 26 · 8 Not Seen", "Seen by All 26" or "Not Seen Yet".
   * `main` and `rest` split it where the Not Seen part starts.
   * @param {any} b
   * @returns {{ waiting: boolean, text: string, main: string, rest: string }}
   */
  function seenLine(b) {
    if (b.waiting) return { waiting: true, text: 'Not Sent Yet', main: 'Not Sent Yet', rest: '' };
    var text = W.bulletinSeenText(b.seen, b.can_see);
    var at = text.indexOf(' · ');
    return {
      waiting: false,
      text: text,
      main: at < 0 ? text : text.slice(0, at),
      rest: at < 0 ? '' : text.slice(at + 3),
    };
  }

  /** "Jordan Kim Not Counted (Page Paused)", or a count past two names. @param {string[]} names */
  function pausedText(names) {
    var list = (names || []).filter(Boolean);
    if (!list.length) return '';
    if (list.length <= 2) return list.join(' and ') + ' Not Counted (Page Paused)';
    return list.length + ' Not Counted (Page Paused)';
  }

  /** @param {number} n */
  function noCardText(n) {
    if (!(n > 0)) return '';
    return n === 1 ? '1 Has No Card Yet' : n + ' Have No Card Yet';
  }

  /**
   * The feed: one card per bulletin, newest first, as the screen draws it.
   * @param {any[]} list getBulletins' answer @param {Date} [now]
   */
  function feedModel(list, now) {
    // Newest first (board T1): on the phone a pinned reminder is not lifted above a photo just posted.
    var sorted = (list || []).slice().sort(function (a, b) {
      var ta = Date.parse((a.waiting ? a.created_at : a.posted_at || a.created_at) || '') || 0;
      var tb = Date.parse((b.waiting ? b.created_at : b.posted_at || b.created_at) || '') || 0;
      if (ta !== tb) return tb - ta;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
    return sorted.map(function (b) {
      var files = b.files || [];
      var photo = files.filter(function (/** @type {any} */ f) {
        return f.kind === 'photo';
      })[0];
      var pdfs = files.filter(function (/** @type {any} */ f) {
        return f.kind === 'pdf';
      });
      var time = b.waiting ? b.created_at : b.posted_at || b.created_at;
      return {
        id: String(b.id),
        key: b.key || '',
        waiting: !!b.waiting,
        pinned: !!b.pinned,
        kind: kindLabel(b),
        reminder: b.kind === 'reminder',
        day: dayLabel(time, now),
        body: String(b.body || ''),
        photo: photo
          ? { id: String(photo.id), ready: photo.status === 'ready' || (photo.paths || []).length > 0 }
          : null,
        pdfs: pdfs.map(function (/** @type {any} */ f) {
          return { title: String(f.title || 'PDF'), pages: Number(f.page_count) || 1 };
        }),
        link: b.link_url
          ? { title: String(b.link_title || W.bulletinLinkHost(b.link_url)), host: W.bulletinLinkHost(b.link_url) }
          : null,
        seen: seenLine(b),
      };
    });
  }

  return {
    dayText: dayText,
    dayLabel: dayLabel,
    kindLabel: kindLabel,
    seenLine: seenLine,
    pausedText: pausedText,
    noCardText: noCardText,
    feedModel: feedModel,
  };
})();
