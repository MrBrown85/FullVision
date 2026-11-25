/* dash-observations.js — observation helpers: the short row name the
   Dashboard's lists use, and the Observations page's roster days and date
   filter ranges.

   The Dashboard's Observations card (the By Week and By Competency grid) was
   removed on 2026-11-24 (docs/DECISIONS.md, "Observations off the
   Dashboard"). What it showed that teachers used, how long since each
   student was last observed, is on the Observations page's roster
   (rosterMark, drawn by obs-roster.js). The helpers are pure and take
   today's date as 'YYYY-MM-DD' so tests can pin it. Nothing here computes a
   grade. */
window.DashObservations = (function () {
  'use strict';

  var DAY_MS = 86400000;

  function _dayNum(dateStr) {
    return Math.floor(Date.parse(String(dateStr).slice(0, 10) + 'T00:00:00Z') / DAY_MS);
  }
  function _isDateStr(d) {
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && !isNaN(Date.parse(d.slice(0, 10)));
  }

  /** The day an observation belongs to: its date, else the day it was created. */
  function obDay(o) {
    var d = (o && (o.date || (o.created || '').slice(0, 10))) || '';
    return _isDateStr(d) ? d.slice(0, 10) : '';
  }

  function rowName(st) {
    var first = displayNameFirst(st);
    var last = String((st && st.lastName) || '').trim();
    if (!first) return displayName(st);
    if (!last || (st.preferred && st.preferred.indexOf(' ') > 0)) return first;
    return first + ' ' + last.charAt(0) + '.';
  }

  /* ── The Observations page's date filter ──────────────────── */
  function _pad2(n) {
    return String(n).padStart(2, '0');
  }
  /** A local Date as 'YYYY-MM-DD'. */
  function ymd(d) {
    return d.getFullYear() + '-' + _pad2(d.getMonth() + 1) + '-' + _pad2(d.getDate());
  }

  /* Monday of the week holding todayStr (YYYY-MM-DD), through todayStr. */
  function weekRange(todayStr) {
    var d = new Date(todayStr + 'T12:00:00');
    var back = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - back);
    return { from: ymd(d), to: todayStr };
  }

  /* The reporting term holding todayStr, else the latest one that has
     started, else null. */
  function termRange(terms, todayStr) {
    var started = (terms || []).filter(function (t) {
      return t.starts_on && t.starts_on <= todayStr;
    });
    if (!started.length) return null;
    var inside = started.filter(function (t) {
      return !t.ends_on || t.ends_on >= todayStr;
    });
    var t = (inside.length ? inside : started).sort(function (a, b) {
      return a.starts_on < b.starts_on ? 1 : -1;
    })[0];
    return { from: t.starts_on, to: t.ends_on || todayStr };
  }

  /* The Observations page's roster: the days since a student's last
     observation, and whether that is 3 weeks or more. A class with no
     observations at all has nobody overdue yet (classObserved false).
     → { text, overdue, title } */
  function rosterMark(obs, todayStr, classObserved) {
    var dated = (obs || []).map(function (o) {
      return { date: obDay(o) };
    });
    var last = DashOverview.obsLastDate(dated);
    var overdue = !!classObserved && DashOverview.obsIsOverdue(dated, todayStr);
    if (!last) return { text: classObserved ? 'None' : '', overdue: overdue, title: 'Not observed yet' };
    var days = Math.max(0, _dayNum(todayStr) - _dayNum(last));
    return {
      text: days === 0 ? 'Today' : days + 'd',
      overdue: overdue,
      title:
        days === 0
          ? 'Last observed today'
          : days === 1
            ? 'Last observed yesterday'
            : 'Last observed ' + days + ' days ago',
    };
  }

  return {
    rowName: rowName,
    rosterMark: rosterMark,
    ymd: ymd,
    weekRange: weekRange,
    termRange: termRange,
  };
})();
