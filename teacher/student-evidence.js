/* student-evidence.js — The student page's Evidence panel: a timeline strip,
   the shared capture strip with the student fixed, tabs (All, By
   competency, Assessments, Concerns) and the observation cards the
   Observations page uses (teacher/obs-card.js). */
window.StudentEvidence = (function () {
  'use strict';

  var GAP_DAYS = 14;
  var WEEK_TICK_MAX_DAYS = 84;
  var MIN_SPAN_DAYS = 7;
  var DAY_MS = 86400000;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var TABS = [
    { key: 'all', label: 'All' },
    { key: 'competency', label: 'By competency' },
    { key: 'assessments', label: 'Assessments' },
    { key: 'concerns', label: 'Concerns' },
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

  /* The observations a tab lists. 'competency' lists them all (grouped). */
  function tabFilter(obs, tab) {
    if (tab === 'assessments') return obs.filter(isAssessmentLinked);
    if (tab === 'concerns')
      return obs.filter(function (o) {
        return o.sentiment === 'concern';
      });
    return obs.slice();
  }

  /* Counts on the tabs. By competency counts those linked to one. */
  function tabCounts(obs) {
    return {
      all: obs.length,
      competency: obs.filter(function (o) {
        return !!o.competencyId;
      }).length,
      assessments: tabFilter(obs, 'assessments').length,
      concerns: tabFilter(obs, 'concerns').length,
    };
  }

  /* Groups in learning-map order; competencies no longer on the map after
     those, and unlinked observations last.
       items   ObsCapture.competencyItems(cid): [{ type:'section' } | { id, label }] */
  function groupByCompetency(obs, items, labelFor) {
    var order = [];
    var labels = {};
    (items || []).forEach(function (it) {
      if (it.type === 'section' || !it.id) return;
      order.push(it.id);
      labels[it.id] = it.label;
    });
    var byId = {};
    var none = [];
    obs.forEach(function (o) {
      if (!o.competencyId) {
        none.push(o);
        return;
      }
      (byId[o.competencyId] = byId[o.competencyId] || []).push(o);
    });
    var groups = [];
    order.forEach(function (id) {
      if (byId[id]) groups.push({ id: id, label: labels[id] || 'Competency', obs: byId[id] });
    });
    Object.keys(byId).forEach(function (id) {
      if (order.indexOf(id) >= 0) return;
      groups.push({ id: id, label: (labelFor && labelFor(id)) || 'Competency', obs: byId[id] });
    });
    if (none.length) groups.push({ id: null, label: 'Not linked to a competency', obs: none });
    return groups;
  }

  /* ── Panel state ────────────────────────────────────────── */

  var _cid = null;
  var _sid = null;
  var _tab = 'all';
  var _query = '';
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

  /* ── HTML ───────────────────────────────────────────────── */

  /* The panel's frame; mount() fills it. */
  function panelHtml() {
    return (
      '<section class="ev-panel" id="ev-panel" aria-labelledby="ev-title">' +
      '<div class="ev-head"><h2 class="ev-title" id="ev-title">Evidence</h2></div>' +
      '<div class="ev-timeline" id="ev-timeline"></div>' +
      '<div class="note-capture" id="note-capture"></div>' +
      '<div class="ev-toolbar">' +
      '<div class="seg seg-sm ev-tabs" role="tablist" aria-label="Show evidence" id="ev-tabs"></div>' +
      '<input type="search" class="note-search-input ev-search" id="ev-search" placeholder="Search evidence" aria-label="Search evidence">' +
      '</div>' +
      '<div class="ev-list" id="ev-list" role="tabpanel" aria-labelledby="ev-tab-' +
      _tab +
      '"></div>' +
      '</section>'
    );
  }

  function tabsHtml(counts) {
    return TABS.map(function (t) {
      var on = t.key === _tab;
      return (
        '<button type="button" role="tab" class="seg-btn ev-tab' +
        (on ? ' active' : '') +
        '" id="ev-tab-' +
        t.key +
        '" data-ev-tab="' +
        t.key +
        '" aria-selected="' +
        on +
        '" aria-controls="ev-list" tabindex="' +
        (on ? '0' : '-1') +
        '">' +
        esc(t.label) +
        ' <span class="ev-tab-count">' +
        counts[t.key] +
        '</span></button>'
      );
    }).join('');
  }

  var EMPTY = {
    all: 'No observations yet. Add one above.',
    competency: 'No observations yet. Add one above and pick a competency to link it.',
    assessments: 'No observations are linked to an assessment yet.',
    concerns: 'No concerns recorded.',
  };

  function listHtml(list) {
    if (!list.length) {
      var msg = _query.trim() ? 'Nothing here matches “' + esc(_query.trim()) + '”.' : esc(EMPTY[_tab] || EMPTY.all);
      return '<div class="notes-empty">' + msg + '</div>';
    }
    var ctx = ObsCard.context(_cid, { hidden: _pending });
    function card(o) {
      return ObsCard.html(o, ctx, { showStudent: false, action: null, when: 'date' });
    }
    if (_tab !== 'competency') return list.map(card).join('');
    return groupByCompetency(list, ObsCapture.competencyItems(_cid), function (id) {
      return ObsCapture.competencyLabel(_cid, id);
    })
      .map(function (g) {
        return (
          '<div class="ev-group">' +
          '<h3 class="ev-group-title">' +
          esc(g.label) +
          ' <span class="ev-tab-count">' +
          g.obs.length +
          '</span></h3>' +
          g.obs.map(card).join('') +
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
    if (isAssessmentLinked(ob)) parts.push(ObsCard.assessmentTitle(_cid, ob) || 'Assessment');
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
    if (!layout) return '';
    var byId = {};
    obs.forEach(function (o) {
      byId[o.id] = o;
    });
    var range = (term ? esc(term.label || 'This term') : 'All time') + ' · ' + shortDate(layout.start, today);
    range += ' to ' + (layout.today != null && !term ? 'today' : shortDate(layout.end, today));

    var out =
      '<div class="ev-tl-head">' +
      '<span class="ev-tl-range">' +
      range +
      '</span>' +
      '<span class="ev-tl-legend" aria-hidden="true">' +
      '<span class="ev-tl-key" data-type="strength">Strength</span>' +
      '<span class="ev-tl-key" data-type="growth">Growth</span>' +
      '<span class="ev-tl-key" data-type="concern">Concern</span>' +
      '<span class="ev-tl-key" data-type="note">Note</span>' +
      '<span class="ev-tl-key" data-type="none">No type</span>' +
      '<span class="ev-tl-key" data-shape="square">Assessment</span>' +
      '</span></div>' +
      '<div class="ev-tl-scroll"><div class="ev-tl-track" role="group" aria-label="Observations timeline, ' +
      esc(range.replace(' · ', ', ')) +
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
      var text = 'No evidence for ' + g.days + ' days';
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
    out += '</div></div><div class="ev-tl-tip" role="tooltip" id="ev-tl-tip" hidden></div>';
    return out;
  }

  /* ── Rendering ──────────────────────────────────────────── */

  function refreshList() {
    if (!_root) return;
    var all = searched();
    var tabs = _root.querySelector('#ev-tabs');
    if (tabs) tabs.innerHTML = tabsHtml(tabCounts(all));
    var list = _root.querySelector('#ev-list');
    if (list) {
      list.setAttribute('aria-labelledby', 'ev-tab-' + _tab);
      list.innerHTML = listHtml(tabFilter(all, _tab));
    }
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

  function setTab(key, focus) {
    _tab = key;
    refreshList();
    if (focus && _root) {
      var b = _root.querySelector('#ev-tab-' + key);
      if (b) b.focus();
    }
  }

  /* A timeline mark: show its card on the All tab and highlight it. */
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
    if (_tab !== 'all') _tab = 'all';
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
    var tab = e.target.closest('[data-ev-tab]');
    if (tab) {
      setTab(tab.getAttribute('data-ev-tab'));
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
    }
  }

  function onKeydown(e) {
    var tab = e.target.closest && e.target.closest('[data-ev-tab]');
    if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End')) {
      var i = TABS.findIndex(function (t) {
        return t.key === _tab;
      });
      if (e.key === 'ArrowRight') i = (i + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') i = (i - 1 + TABS.length) % TABS.length;
      else if (e.key === 'Home') i = 0;
      else i = TABS.length - 1;
      e.preventDefault();
      setTab(TABS[i].key, true);
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
      _tab = 'all';
      _query = '';
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
    setTab: setTab,
    isPending: isPending,
    _helpers: {
      timelineLayout: timelineLayout,
      tabFilter: tabFilter,
      tabCounts: tabCounts,
      groupByCompetency: groupByCompetency,
      shortDate: shortDate,
    },
  };
})();
