/* student-evidence.js — The student page's Observations tab: the shared
   capture strip with the student fixed, the term's timeline with its gaps,
   Seen in Class (each competency and how many notes it has, which narrows
   the list), and the notes month by month as the Observations page's cards
   (teacher/obs-card.js), narrowed by type. Private notes (Concern, Note, a
   reflection) keep their words off the screen until the teacher shows
   them, since the student may be looking (redesign R3,
   docs/plans/teacher-student-page-redesign-plan.md). */
window.StudentEvidence = (function () {
  'use strict';

  var GAP_DAYS = 14;
  var WEEK_TICK_MAX_DAYS = 84;
  var MIN_SPAN_DAYS = 7;
  var DATES_LISTED_MAX = 10;
  var DAY_MS = 86400000;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  /* The type chips over the notes. */
  var TYPES = [
    { key: 'all', label: 'All' },
    { key: 'strength', label: 'Strength' },
    { key: 'growth', label: 'Growth' },
    { key: 'concern', label: 'Concern' },
    { key: 'note', label: 'Note' },
  ];

  /* ── Pure helpers (exported for tests) ──────────────────── */

  function dayNum(dateStr) {
    return Math.floor(Date.parse(String(dateStr).slice(0, 10) + 'T00:00:00Z') / DAY_MS);
  }
  function dayStr(n) {
    return new Date(n * DAY_MS).toISOString().slice(0, 10);
  }
  function obDay(ob) {
    return ob.date || (ob.created || '').slice(0, 10);
  }
  function isDay(d) {
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && !isNaN(Date.parse(d.slice(0, 10)));
  }

  /* "Oct 3", with the year when it is not this one. */
  function shortDate(dateStr, todayStr) {
    var y = dateStr.slice(0, 4);
    var label = MONTHS[Number(dateStr.slice(5, 7)) - 1] + ' ' + Number(dateStr.slice(8, 10));
    return todayStr && y !== todayStr.slice(0, 4) ? label + ', ' + y : label;
  }

  function isAssessmentLinked(ob) {
    var ac = ob.assignmentContext;
    return !!(ac && (ac.assessmentId || ac.assessmentTitle));
  }

  /* Where every mark, tick and gap sits on the timeline, as fractions of its
     width (0 at the left edge, 1 at the right).
       obs     the student's observations, any order
       opts    { today: 'YYYY-MM-DD', term: { startsOn, endsOn } | null, gapDays }
     With a term the strip covers the term; without one it runs from the
     first observation to today. A gap is a stretch of more than gapDays
     with nothing, counted up to today (or the term's end, if sooner).
     Null when there is nothing to draw. */
  function timelineLayout(obs, opts) {
    opts = opts || {};
    var today = opts.today;
    var term = opts.term && opts.term.startsOn && opts.term.endsOn ? opts.term : null;
    var gapDays = opts.gapDays || GAP_DAYS;
    var todayN = dayNum(today);

    var dated = (obs || []).filter(function (o) {
      return o && isDay(obDay(o));
    });
    var start, end, gapFrom;
    if (term) {
      start = dayNum(term.startsOn);
      end = dayNum(term.endsOn);
      if (end < start) end = start;
      dated = dated.filter(function (o) {
        var n = dayNum(obDay(o));
        return n >= start && n <= end;
      });
      gapFrom = start;
    } else {
      if (!dated.length) return null;
      var first = Math.min.apply(
        null,
        dated.map(function (o) {
          return dayNum(obDay(o));
        }),
      );
      var last = Math.max.apply(
        null,
        dated.map(function (o) {
          return dayNum(obDay(o));
        }),
      );
      end = Math.max(todayN, last);
      start = Math.min(first, end - MIN_SPAN_DAYS);
      gapFrom = first;
    }
    var span = Math.max(1, end - start);
    function x(n) {
      return Math.min(1, Math.max(0, (n - start) / span));
    }

    // Marks: oldest first; several on one day stack upward.
    var sorted = dated.slice().sort(function (a, b) {
      var da = obDay(a);
      var db = obDay(b);
      if (da !== db) return da < db ? -1 : 1;
      return (a.created || '').localeCompare(b.created || '');
    });
    var perDay = {};
    var marks = sorted.map(function (o) {
      var d = obDay(o).slice(0, 10);
      var n = dayNum(d);
      var stack = perDay[d] || 0;
      perDay[d] = stack + 1;
      return {
        id: o.id,
        day: d,
        x: x(n),
        stack: stack,
        shape: isAssessmentLinked(o) ? 'square' : 'circle',
        type: o.sentiment && OBS_SENTIMENTS[o.sentiment] ? o.sentiment : 'none',
      };
    });

    // Gaps, from the first point to today (or the term's end).
    var gapTo = Math.min(todayN, end);
    var gaps = [];
    if (gapTo >= gapFrom) {
      var points = [gapFrom];
      Object.keys(perDay)
        .sort()
        .forEach(function (d) {
          var n = dayNum(d);
          if (n > points[points.length - 1] && n <= gapTo) points.push(n);
        });
      if (gapTo > points[points.length - 1]) points.push(gapTo);
      for (var i = 1; i < points.length; i++) {
        var days = points[i] - points[i - 1];
        if (days > gapDays) {
          gaps.push({
            from: dayStr(points[i - 1]),
            to: dayStr(points[i]),
            days: days,
            x0: x(points[i - 1]),
            x1: x(points[i]),
            toToday: points[i] === todayN && !perDay[dayStr(todayN)],
          });
        }
      }
    }

    // Ticks: Mondays on a short strip, the 1st of each month on a long one.
    var ticks = [];
    var weekly = span <= WEEK_TICK_MAX_DAYS;
    for (var n = start; n <= end; n++) {
      var ds = dayStr(n);
      var dt = new Date(n * DAY_MS);
      if (weekly ? dt.getUTCDay() === 1 : dt.getUTCDate() === 1) {
        var m = MONTHS[dt.getUTCMonth()];
        ticks.push({
          day: ds,
          x: x(n),
          label: weekly ? m + ' ' + dt.getUTCDate() : dt.getUTCMonth() === 0 ? m + ' ' + dt.getUTCFullYear() : m,
        });
      }
    }

    return {
      start: dayStr(start),
      end: dayStr(end),
      spanDays: span,
      weekly: weekly,
      today: todayN >= start && todayN <= end ? x(todayN) : null,
      marks: marks,
      ticks: ticks,
      gaps: gaps,
    };
  }

  /* The notes a type chip lists. Notes with no type show under All only. */
  function typeFilter(obs, type) {
    if (!type || type === 'all') return obs.slice();
    return obs.filter(function (o) {
      return o.sentiment === type;
    });
  }

  /* The count on each type chip. */
  function typeCounts(obs) {
    var out = { all: obs.length };
    TYPES.forEach(function (t) {
      if (t.key !== 'all') out[t.key] = typeFilter(obs, t.key).length;
    });
    return out;
  }

  /* Seen in Class: each competency on the learning map, in map order, with
     how many of these notes are linked to it.
       items   ObsCapture.competencyItems(cid): [{ type:'section' } | { id, label }] */
  function coverage(obs, items) {
    var n = {};
    obs.forEach(function (o) {
      if (o.competencyId) n[o.competencyId] = (n[o.competencyId] || 0) + 1;
    });
    var seen = {};
    var out = [];
    (items || []).forEach(function (it) {
      if (it.type === 'section' || !it.id || seen[it.id]) return;
      seen[it.id] = true;
      out.push({ id: it.id, label: it.label || 'Competency', n: n[it.id] || 0 });
    });
    return out;
  }

  /* The notes by month, newest month first and newest note first within
     it. A month in another year carries the year ("June 2025"). */
  function monthGroups(obs, todayStr) {
    var sorted = obs.slice().sort(function (a, b) {
      var da = obDay(a);
      var db = obDay(b);
      if (da !== db) return da < db ? 1 : -1;
      return (b.created || '').localeCompare(a.created || '');
    });
    var groups = [];
    var byKey = {};
    sorted.forEach(function (o) {
      var d = obDay(o);
      var key = isDay(d) ? d.slice(0, 7) : '';
      if (!byKey[key]) {
        var label = 'No Date';
        if (key) {
          label = MONTH_NAMES[Number(key.slice(5, 7)) - 1];
          if (!todayStr || key.slice(0, 4) !== String(todayStr).slice(0, 4)) label += ' ' + key.slice(0, 4);
        }
        byKey[key] = { key: key, label: label, obs: [] };
        groups.push(byKey[key]);
      }
      byKey[key].obs.push(o);
    });
    return groups;
  }

  /* "No notes for 23 days, Oct 7 to Oct 30" (or "since Oct 7" when the
     stretch runs to today), for the latest gap; '' with none. */
  function gapSentence(layout, todayStr) {
    var g = layout && layout.gaps.length ? layout.gaps[layout.gaps.length - 1] : null;
    if (!g) return '';
    return (
      'No notes for ' +
      g.days +
      ' days, ' +
      (g.toToday
        ? 'since ' + shortDate(g.from, todayStr)
        : shortDate(g.from, todayStr) + ' to ' + shortDate(g.to, todayStr))
    );
  }

  /* "Notes on Sep 12, Sep 25 and Oct 3." for a short list of days, so the
     strip reads as words too; '' for none or too many to list. */
  function datesSentence(layout, todayStr) {
    if (!layout) return '';
    var days = [];
    layout.marks.forEach(function (m) {
      if (days.indexOf(m.day) < 0) days.push(m.day);
    });
    if (!days.length || days.length > DATES_LISTED_MAX) return '';
    var names = days.map(function (d) {
      return shortDate(d, todayStr);
    });
    var list = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    return (days.length === 1 ? 'A note on ' : 'Notes on ') + list + '.';
  }

  /* ── Panel state ────────────────────────────────────────── */

  var _cid = null;
  var _sid = null;
  var _type = 'all';
  var _comp = '';
  var _query = '';
  /* Private notes the teacher chose to show on this screen, this visit. */
  var _shown = {};
  /* Deleted observations stay in the data layer until their Undo toast closes. */
  var _pending = {};
  var _root = null;
  var _hitTimer = null;
  var _onChange = null;

  /* After an add, a delete or an Undo here, tell the page (the competency
     drawers list the same observations). */
  function changed() {
    if (typeof _onChange === 'function') _onChange();
  }

  function isPending(obId) {
    return !!_pending[obId];
  }

  /* The student's observations, newest first, each carrying its studentId
     as the Observations page's do (the card's "with …" line needs it). */
  function studentObs() {
    return getStudentQuickObs(_cid, _sid)
      .filter(function (o) {
        return !_pending[o.id];
      })
      .map(function (o) {
        return Object.assign({}, o, { studentId: _sid });
      });
  }

  function matchesQuery(ob, q) {
    if (!q) return true;
    if ((ob.text || '').toLowerCase().indexOf(q) >= 0) return true;
    var hit = (ob.dims || []).some(function (t) {
      return (
        String(resolveTag(t).label || '')
          .toLowerCase()
          .indexOf(q) >= 0
      );
    });
    if (hit) return true;
    var s = ob.sentiment && OBS_SENTIMENTS[ob.sentiment];
    if (s && s.label.toLowerCase().indexOf(q) >= 0) return true;
    var c = ob.context && OBS_CONTEXTS[ob.context];
    if (c && c.label.toLowerCase().indexOf(q) >= 0) return true;
    if (ObsCard.assessmentTitle(_cid, ob).toLowerCase().indexOf(q) >= 0) return true;
    return !!ob.competencyId && ObsCapture.competencyLabel(_cid, ob.competencyId).toLowerCase().indexOf(q) >= 0;
  }

  function searched() {
    var q = _query.trim().toLowerCase();
    return studentObs().filter(function (o) {
      return matchesQuery(o, q);
    });
  }

  function inComp(list) {
    if (!_comp) return list;
    return list.filter(function (o) {
      return o.competencyId === _comp;
    });
  }

  function isVeiled(ob) {
    return isPrivateObservation(ob) && !_shown[ob.id];
  }

  /* ── HTML ───────────────────────────────────────────────── */

  /* The panel's frame; mount() fills it. */
  function panelHtml() {
    return (
      '<section class="ev-panel" id="ev-panel" aria-labelledby="ev-title">' +
      '<div class="ev-head"><h2 class="ev-title" id="ev-title">Observations</h2></div>' +
      '<div class="note-capture" id="note-capture"></div>' +
      '<div class="ev-timeline" id="ev-timeline"></div>' +
      '<div class="ev-seen" id="ev-seen"></div>' +
      '<div class="ev-notes">' +
      '<div class="ev-sec-head ev-notes-head">' +
      '<h3 class="ev-h3" id="ev-notes-title">Notes</h3>' +
      '<span class="ev-comp-slot" id="ev-comp-slot"></span>' +
      '<span class="ev-grow"></span>' +
      '<div class="ev-chips" role="group" aria-label="Show" id="ev-types"></div>' +
      '<input type="search" class="note-search-input ev-search" id="ev-search" placeholder="Search notes" aria-label="Search notes">' +
      '</div>' +
      '<div class="ev-list" id="ev-list" role="region" aria-labelledby="ev-notes-title"></div>' +
      '</div>' +
      '<p class="ev-foot"><span class="ev-foot-lock" aria-hidden="true">' +
      (typeof LINE_ICONS !== 'undefined' ? LINE_ICONS.lock : '') +
      '</span>Concerns and Notes are private: only you see them. They stay hidden on this screen until you show them.</p>' +
      '</section>'
    );
  }

  // html-safe: TYPES keys and labels are fixed (labels escaped); counts are numbers.
  function typesHtml(counts) {
    return TYPES.map(function (t) {
      var on = t.key === _type;
      return (
        '<button type="button" class="ev-chip ev-type-chip" data-ev-type="' +
        t.key +
        '" aria-pressed="' +
        on +
        '">' +
        esc(t.label) +
        ' <span class="ev-chip-count">' +
        counts[t.key] +
        '</span></button>'
      );
    }).join('');
  }

  // html-safe: competency labels are escaped; ids are escaped; counts are numbers.
  function seenHtml(cov) {
    if (!cov.length) return '';
    var none = cov.filter(function (c) {
      return !c.n;
    }).length;
    var out =
      '<div class="ev-sec-head"><h3 class="ev-h3" id="ev-seen-title">Seen in Class</h3>' +
      '<span class="ev-hint">Pick a competency to see its notes</span></div>' +
      '<div class="ev-chips ev-seen-chips" role="group" aria-labelledby="ev-seen-title">';
    cov.forEach(function (c) {
      out +=
        '<button type="button" class="ev-chip ev-seen-chip' +
        (c.n ? '' : ' is-none') +
        '" data-ev-comp="' +
        esc(c.id) +
        '" aria-pressed="' +
        (c.id === _comp) +
        '">' +
        esc(c.label) +
        ' <strong class="ev-chip-count">' +
        c.n +
        '</strong></button>';
    });
    out += '</div>';
    if (none)
      out +=
        '<p class="ev-seen-note">' +
        (none === 1 ? '1 competency has' : none + ' competencies have') +
        ' no observation yet. Watch for ' +
        (none === 1 ? 'it' : 'them') +
        ' next class.</p>';
    return out;
  }

  // html-safe: the label is escaped.
  function compSlotHtml() {
    if (!_comp) return '';
    var label = ObsCapture.competencyLabel(_cid, _comp) || 'Competency';
    return (
      '<span class="ev-comp-pill">' +
      esc(label) +
      '<button type="button" class="ev-comp-clear" data-ev-comp="" aria-label="Show every competency">×</button></span>'
    );
  }

  // html-safe: the query and month labels are escaped; cards come from ObsCard.html, which escapes names, text and tags.
  function listHtml(list) {
    if (!list.length) {
      var msg;
      if (!studentObs().length) msg = 'No observations yet. Add one above.';
      else if (_query.trim()) msg = 'Nothing here matches “' + esc(_query.trim()) + '”.';
      else if (_type !== 'all' || _comp)
        msg = 'No notes match. <button type="button" class="ev-link" data-ev-clear="1">Show All Notes</button>';
      else msg = 'No observations yet. Add one above.';
      return '<div class="notes-empty">' + msg + '</div>';
    }
    var ctx = ObsCard.context(_cid, { hidden: _pending });
    return monthGroups(list, getTodayStr())
      .map(function (g) {
        return (
          '<div class="ev-month">' +
          '<h4 class="ev-month-title">' +
          esc(g.label) +
          '</h4>' +
          g.obs
            .map(function (o) {
              return ObsCard.html(o, ctx, {
                showStudent: false,
                action: 'evEditOb',
                when: 'date',
                veiled: isVeiled(o),
              });
            })
            .join('') +
          '</div>'
        );
      })
      .join('');
  }

  function firstLine(text) {
    var line = String(text || '')
      .split('\n')[0]
      .trim();
    return line.length > 90 ? line.slice(0, 89) + '…' : line;
  }

  function markLabel(ob, today) {
    var s = ob.sentiment && OBS_SENTIMENTS[ob.sentiment];
    var parts = [shortDate(obDay(ob), today)];
    if (s) parts.push(s.label);
    if (isPrivateObservation(ob)) parts.push('Private');
    if (isAssessmentLinked(ob)) parts.push(ObsCard.assessmentTitle(_cid, ob) || 'Assessment');
    // A private note's words stay off the screen until the teacher shows them.
    if (isVeiled(ob)) return parts.join(' · ');
    return parts.join(' · ') + ': ' + firstLine(ob.text);
  }

  function pct(x) {
    return (Math.round(x * 10000) / 100).toFixed(2) + '%';
  }

  function timelineHtml() {
    var today = getTodayStr();
    var term = typeof getActiveTerm === 'function' ? getActiveTerm(_cid) : null;
    var obs = studentObs();
    var layout = timelineLayout(obs, { today: today, term: term });
    // With nothing to show, an empty strip of the same height holds the
    // capture box in place, so it doesn't jump down after the first add.
    var title = term ? esc(term.label || 'This Term') : 'All Time';
    if (!layout) {
      return (
        '<div class="ev-sec-head ev-tl-head"><h3 class="ev-h3">' +
        title +
        '</h3><span class="ev-tl-range">No observations yet</span></div>' +
        '<div class="ev-tl-box"><div class="ev-tl-scroll"><div class="ev-tl-track ev-tl-empty" aria-hidden="true"><div class="ev-tl-axis"></div></div></div></div>'
      );
    }
    var byId = {};
    obs.forEach(function (o) {
      byId[o.id] = o;
    });
    var range =
      shortDate(layout.start, today) +
      ' to ' +
      (layout.today != null && !term ? 'today' : shortDate(layout.end, today));
    var gapLine = gapSentence(layout, today);
    var dates = datesSentence(layout, today);

    var out =
      '<div class="ev-sec-head ev-tl-head">' +
      '<h3 class="ev-h3">' +
      title +
      '</h3>' +
      '<span class="ev-tl-range">' +
      esc(range) +
      '</span>' +
      '<span class="ev-grow"></span>' +
      (gapLine ? '<span class="ev-tl-gapline">' + esc(gapLine) + '</span>' : '') +
      '</div>' +
      '<div class="ev-tl-box">' +
      '<div class="ev-tl-scroll"><div class="ev-tl-track" role="group" aria-label="Observations timeline, ' +
      esc((term ? term.label || 'This Term' : 'All Time') + ', ' + range) +
      '">' +
      '<div class="ev-tl-axis"></div>';
    layout.ticks.forEach(function (t) {
      out +=
        '<span class="ev-tl-tick" style="left:' +
        pct(t.x) +
        '" aria-hidden="true"><span class="ev-tl-tick-label">' +
        esc(t.label) +
        '</span></span>';
    });
    if (layout.today != null)
      out += '<span class="ev-tl-today" style="left:' + pct(layout.today) + '" aria-hidden="true"></span>';
    layout.gaps.forEach(function (g) {
      var text = 'No notes for ' + g.days + ' days';
      var title =
        text +
        (g.toToday
          ? ', since ' + shortDate(g.from, today)
          : ', ' + shortDate(g.from, today) + ' to ' + shortDate(g.to, today));
      out +=
        '<div class="ev-tl-gap" style="left:' +
        pct(g.x0) +
        ';width:' +
        pct(g.x1 - g.x0) +
        '" title="' +
        esc(title) +
        '"><span class="ev-tl-gap-label">' +
        esc(text) +
        '</span></div>';
    });
    layout.marks.forEach(function (m) {
      var ob = byId[m.id];
      out +=
        '<button type="button" class="ev-tl-mark" data-obid="' +
        m.id +
        '" data-shape="' +
        m.shape +
        '" data-type="' +
        m.type +
        '" style="left:' +
        pct(m.x) +
        ';--stack:' +
        Math.min(m.stack, 3) +
        '" aria-label="' +
        esc(markLabel(ob, today)) +
        '"></button>';
    });
    out +=
      '</div></div>' +
      '<div class="ev-tl-legend" aria-hidden="true">' +
      '<span class="ev-tl-key" data-type="strength">Strength</span>' +
      '<span class="ev-tl-key" data-type="growth">Growth</span>' +
      '<span class="ev-tl-key" data-type="concern">Concern</span>' +
      '<span class="ev-tl-key" data-type="note">Note</span>' +
      '<span class="ev-tl-key" data-type="none">No type</span>' +
      '<span class="ev-tl-key" data-shape="square">Assessment</span>' +
      '<span class="ev-tl-gapkey">More than two weeks with no notes</span>' +
      '</div>' +
      (dates ? '<p class="ev-tl-dates">' + esc(dates) + '</p>' : '') +
      '</div><div class="ev-tl-tip" role="tooltip" id="ev-tl-tip" hidden></div>';
    return out;
  }

  /* ── Rendering ──────────────────────────────────────────── */

  function refreshList() {
    if (!_root) return;
    var all = searched();
    var seen = _root.querySelector('#ev-seen');
    if (seen) {
      // html-safe: this file's seenHtml escapes labels and ids.
      seen.innerHTML = seenHtml(coverage(all, ObsCapture.competencyItems(_cid)));
      seen.hidden = !seen.innerHTML;
    }
    var slot = _root.querySelector('#ev-comp-slot');
    // html-safe: this file's compSlotHtml escapes the label.
    if (slot) slot.innerHTML = compSlotHtml();
    var base = inComp(all);
    var types = _root.querySelector('#ev-types');
    // html-safe: this file's typesHtml writes fixed labels and numbers.
    if (types) types.innerHTML = typesHtml(typeCounts(base));
    var list = _root.querySelector('#ev-list');
    // html-safe: this file's listHtml escapes the query and labels; cards come from ObsCard.html.
    if (list) list.innerHTML = listHtml(typeFilter(base, _type));
  }

  function refreshTimeline() {
    if (!_root) return;
    var el = _root.querySelector('#ev-timeline');
    if (!el) return;
    el.innerHTML = timelineHtml();
    el.hidden = !el.innerHTML;
  }

  function refresh() {
    refreshTimeline();
    refreshList();
  }

  /* Keep focus on the chip that was pressed after the list redraws. */
  function refocus(sel) {
    if (!_root || !sel) return;
    var b = _root.querySelector(sel);
    if (b && b.focus) b.focus();
  }

  function setType(key) {
    _type = key || 'all';
    refreshList();
    refocus('[data-ev-type="' + _type + '"]');
  }

  function setComp(id) {
    _comp = id || '';
    refreshList();
    refocus(_comp ? '.ev-seen-chip[data-ev-comp="' + _comp + '"]' : '[data-ev-type="' + _type + '"]');
  }

  function reveal(obId) {
    _shown[obId] = true;
    refresh();
    var card = _root && _root.querySelector('#ev-list .obs-card[data-obid="' + obId + '"]');
    if (card && card.focus) card.focus();
  }

  /* A timeline mark: show its card (clearing filters that hide it) and highlight it. */
  function jumpTo(obId) {
    if (!_root) return;
    var q = _query.trim().toLowerCase();
    var ob = studentObs().find(function (o) {
      return o.id === obId;
    });
    if (!ob) return;
    if (q && !matchesQuery(ob, q)) {
      _query = '';
      var input = _root.querySelector('#ev-search');
      if (input) input.value = '';
    }
    if (_type !== 'all' && ob.sentiment !== _type) _type = 'all';
    if (_comp && ob.competencyId !== _comp) _comp = '';
    refreshList();
    var card = _root.querySelector('#ev-list .obs-card[data-obid="' + obId + '"]');
    if (!card) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    card.classList.add('ev-card-hit');
    if (card.focus) card.focus({ preventScroll: true });
    clearTimeout(_hitTimer);
    _hitTimer = setTimeout(function () {
      card.classList.remove('ev-card-hit');
    }, 2000);
  }

  function showTip(mark) {
    var tip = _root && _root.querySelector('#ev-tl-tip');
    var box = _root && _root.querySelector('#ev-timeline');
    if (!tip || !box || !mark.getBoundingClientRect) return;
    tip.textContent = mark.getAttribute('aria-label');
    tip.hidden = false;
    var b = box.getBoundingClientRect();
    var r = mark.getBoundingClientRect();
    var w = tip.offsetWidth || 0;
    var left = r.left - b.left + r.width / 2 - w / 2;
    left = Math.max(0, Math.min(left, b.width - w));
    tip.style.left = left + 'px';
    tip.style.top = r.top - b.top - (tip.offsetHeight || 0) - 6 + 'px';
  }
  function hideTip() {
    var tip = _root && _root.querySelector('#ev-tl-tip');
    if (tip) tip.hidden = true;
  }

  function onClick(e) {
    var show = e.target.closest('.obs-card-reveal');
    if (show) {
      e.preventDefault();
      e.stopPropagation();
      reveal(show.getAttribute('data-reveal-obid'));
      return;
    }
    var type = e.target.closest('[data-ev-type]');
    if (type) {
      setType(type.getAttribute('data-ev-type'));
      return;
    }
    var comp = e.target.closest('[data-ev-comp]');
    if (comp) {
      var id = comp.getAttribute('data-ev-comp');
      setComp(id && id === _comp ? '' : id);
      return;
    }
    if (e.target.closest('[data-ev-clear]')) {
      _type = 'all';
      _comp = '';
      refreshList();
      refocus('[data-ev-type="all"]');
      return;
    }
    var mark = e.target.closest('.ev-tl-mark');
    if (mark) {
      jumpTo(mark.getAttribute('data-obid'));
      return;
    }
    var del = e.target.closest('.obs-card-delete[data-action="deleteOb"]');
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      deleteOb(del.getAttribute('data-obid'));
      return;
    }
    var card = e.target.closest('.obs-card[data-action="evEditOb"]');
    if (card) editOb(card.getAttribute('data-obid'));
  }

  /* A card opens the Observations page's edit window over this page. */
  function editOb(obId) {
    if (!obId || typeof PageObservations === 'undefined' || !PageObservations.openEditor) return;
    var cid = _cid;
    var sid = _sid;
    PageObservations.openEditor(cid, sid, obId, {
      onSaved: function () {
        if (_cid === cid && _sid === sid) {
          refresh();
          changed();
        }
      },
      onDelete: function (id) {
        if (_cid === cid && _sid === sid) deleteOb(id);
      },
    });
  }

  function onKeydown(e) {
    // A focused card opens with Enter or Space, like a button.
    if (
      (e.key === 'Enter' || e.key === ' ') &&
      e.target.classList &&
      e.target.classList.contains('obs-card') &&
      e.target.getAttribute('data-action') === 'evEditOb'
    ) {
      e.preventDefault();
      editOb(e.target.getAttribute('data-obid'));
      return;
    }
    var mark = e.target.closest && e.target.closest('.ev-tl-mark');
    if (mark && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      var marks = Array.prototype.slice.call(_root.querySelectorAll('.ev-tl-mark'));
      var j = marks.indexOf(mark) + (e.key === 'ArrowRight' ? 1 : -1);
      if (marks[j]) {
        e.preventDefault();
        marks[j].focus();
      }
      return;
    }
    if (mark && e.key === 'Escape') hideTip();
  }

  function onOver(e) {
    var mark = e.target.closest && e.target.closest('.ev-tl-mark');
    if (mark) showTip(mark);
  }
  function onOut(e) {
    var mark = e.target.closest && e.target.closest('.ev-tl-mark');
    if (mark) hideTip();
  }

  function onInput(e) {
    if (e.target && e.target.id === 'ev-search') {
      _query = e.target.value || '';
      refreshList();
    }
  }

  /* Fill the panel panelHtml() wrote. Called after every page render.
     opts.onChange runs after an observation is added or deleted here. */
  function mount(cid, studentId, opts) {
    _onChange = (opts && opts.onChange) || null;
    if (_cid !== cid || _sid !== studentId) {
      _type = 'all';
      _comp = '';
      _query = '';
      _shown = {};
    }
    _cid = cid;
    _sid = studentId;
    _root = document.getElementById('ev-panel');
    if (!_root) return;
    var input = _root.querySelector('#ev-search');
    if (input) input.value = _query;
    _root.addEventListener('click', onClick);
    _root.addEventListener('keydown', onKeydown);
    _root.addEventListener('mouseover', onOver);
    _root.addEventListener('mouseout', onOut);
    _root.addEventListener('focusin', onOver);
    _root.addEventListener('focusout', onOut);
    _root.addEventListener('input', onInput);
    refresh();
    mountCapture(cid, studentId, _root.querySelector('#note-capture'));
  }

  /* The note box is the shared capture strip with this student fixed. One
     strip per student, kept across page re-renders so its state and draft
     survive. */
  var _capture = null;
  var _captureKey = null;
  function mountCapture(cid, studentId, container) {
    if (!container || typeof ObsCapture === 'undefined') return null;
    var key = cid + '|' + studentId;
    if (!_capture || _captureKey !== key) {
      destroyCapture();
      _capture = ObsCapture.create({
        cid: cid,
        idPrefix: 'note-',
        students: [studentId],
        lockStudents: true,
        draftKey: 'student|' + studentId,
        placeholder: 'Add an observation…',
        onAdd: function () {
          if (_cid === cid && _sid === studentId) {
            refresh();
            changed();
          }
        },
      });
      _captureKey = key;
    }
    _capture.mount(container);
    return _capture;
  }
  function destroyCapture() {
    if (_capture) _capture.destroy();
    _capture = null;
    _captureKey = null;
  }

  function destroy() {
    destroyCapture();
    clearTimeout(_hitTimer);
    _root = null;
    _onChange = null;
  }

  /* One click hides the card and offers Undo for six seconds; the delete
     happens when the toast closes without Undo. */
  function deleteOb(obId) {
    if (!obId || _pending[obId]) return;
    var cid = _cid;
    var sid = _sid;
    _pending[obId] = true;
    refresh();
    changed();
    var settled = false;
    showUndoToast(
      'Observation deleted',
      function () {
        if (settled) return;
        settled = true;
        delete _pending[obId];
        if (_cid === cid && _sid === sid) {
          refresh();
          changed();
        }
      },
      function () {
        if (settled) return;
        settled = true;
        delete _pending[obId];
        deleteQuickOb(cid, sid, obId);
        if (_cid === cid && _sid === sid) {
          refresh();
          changed();
        }
      },
      6000,
    );
  }

  return {
    panelHtml: panelHtml,
    mount: mount,
    mountCapture: mountCapture,
    destroyCapture: destroyCapture,
    destroy: destroy,
    refresh: refresh,
    deleteOb: deleteOb,
    jumpTo: jumpTo,
    setType: setType,
    setComp: setComp,
    isPending: isPending,
    _helpers: {
      timelineLayout: timelineLayout,
      typeFilter: typeFilter,
      typeCounts: typeCounts,
      coverage: coverage,
      monthGroups: monthGroups,
      gapSentence: gapSentence,
      datesSentence: datesSentence,
      shortDate: shortDate,
    },
  };
})();
