/* sweep.js — Class sweep: work down the roster with one or two taps per
   student (docs/DECISIONS.md, "Observations (2026-10-18)", Mockup B).

   A student is done when they have any observation dated today, from any
   surface, so the sweep composes with everything else and survives a
   reload. Skip is per device: localStorage keyed by course and date. */

window.MSweep = (function () {
  'use strict';

  var MC = window.MComponents;
  var UNDO_MS = 6000;
  var ORDER_KEY = 'gb-sweep-order';
  var SKIP_PREFIX = 'gb-sweep-skipped-';
  var TYPES = [
    { key: 'strength', label: 'Strength' },
    { key: 'growth', label: 'Growth' },
    { key: 'concern', label: 'Concern' },
    { key: 'note', label: 'Note' },
  ];

  /* ── Pure helpers ─────────────────────────────────────────── */
  function localDay(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  }

  function obDay(ob) {
    return ob.created ? localDay(ob.created) : ob.date || '';
  }

  /* sid → true for every student with an observation dated `today`. */
  function doneSet(obs, today) {
    var done = {};
    (obs || []).forEach(function (ob) {
      if (ob && ob.studentId && obDay(ob) === today) done[ob.studentId] = true;
    });
    return done;
  }

  /* sid → newest `created` among that student's observations. */
  function lastObserved(obs) {
    var last = {};
    (obs || []).forEach(function (ob) {
      if (!ob || !ob.studentId || !ob.created) return;
      if (!last[ob.studentId] || ob.created > last[ob.studentId]) last[ob.studentId] = ob.created;
    });
    return last;
  }

  function firstName(st) {
    return st.preferred || st.firstName || st.lastName || '';
  }

  function fullName(st) {
    return (firstName(st) + ' ' + (st.lastName || '')).trim();
  }

  /* sid → tile label: the first name, with a last initial when two
     students share it, and the whole last name if that still collides. */
  function tileNames(students) {
    function count(list, fn) {
      var n = {};
      list.forEach(function (st) {
        var k = fn(st).toLowerCase();
        n[k] = (n[k] || 0) + 1;
      });
      return n;
    }
    var withInitial = function (st) {
      var initial = (st.lastName || '').charAt(0);
      return initial ? firstName(st) + ' ' + initial + '.' : firstName(st);
    };
    var firsts = count(students, firstName);
    var initials = count(students, withInitial);
    var names = {};
    students.forEach(function (st) {
      if (firsts[firstName(st).toLowerCase()] < 2) names[st.id] = firstName(st);
      else if (initials[withInitial(st).toLowerCase()] < 2) names[st.id] = withInitial(st);
      else names[st.id] = fullName(st);
    });
    return names;
  }

  /* Student ids in sweep order. 'roster' keeps the roster as given;
     'longest' puts never-observed students first, then the longest since
     an observation, ties in roster order. */
  function orderIds(students, mode, last) {
    var ids = students.map(function (st) {
      return st.id;
    });
    if (mode !== 'longest') return ids;
    var pos = {};
    ids.forEach(function (id, i) {
      pos[id] = i;
    });
    return ids.slice().sort(function (a, b) {
      return (last[a] || '').localeCompare(last[b] || '') || pos[a] - pos[b];
    });
  }

  /* The next student after `afterSid` (wrapping round) who is neither done
     nor skipped, or null when no one is left. */
  function nextStudent(ids, done, skipped, afterSid) {
    var start = afterSid ? ids.indexOf(afterSid) + 1 : 0;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[(start + i) % ids.length];
      if (id !== afterSid && !done[id] && !skipped[id]) return id;
    }
    return null;
  }

  /* ── Device storage ───────────────────────────────────────── */
  function readOrder() {
    try {
      return localStorage.getItem(ORDER_KEY) === 'longest' ? 'longest' : 'roster';
    } catch (e) {
      return 'roster';
    }
  }

  function writeOrder(mode) {
    try {
      localStorage.setItem(ORDER_KEY, mode);
    } catch (e) {
      /* a remembered order is a convenience */
    }
  }

  function skipKey(cid, day) {
    return SKIP_PREFIX + cid + '-' + day;
  }

  function readSkipped(cid, day) {
    var out = {};
    try {
      JSON.parse(localStorage.getItem(skipKey(cid, day)) || '[]').forEach(function (sid) {
        out[sid] = true;
      });
    } catch (e) {
      /* nothing skipped */
    }
    return out;
  }

  /* Writes today's set and drops this class's older days. */
  function writeSkipped(cid, day, skipped) {
    try {
      var prefix = SKIP_PREFIX + cid + '-';
      var stale = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(prefix) === 0 && k !== skipKey(cid, day)) stale.push(k);
      }
      stale.forEach(function (k) {
        localStorage.removeItem(k);
      });
      var ids = Object.keys(skipped).filter(function (sid) {
        return skipped[sid];
      });
      if (ids.length) localStorage.setItem(skipKey(cid, day), JSON.stringify(ids));
      else localStorage.removeItem(skipKey(cid, day));
    } catch (e) {
      /* skipping is a convenience */
    }
  }

  /* ── Screen state ─────────────────────────────────────────── */
  var _s = null;

  function _today() {
    return typeof getTodayStr === 'function' ? getTodayStr() : localDay(new Date().toISOString());
  }

  function _students(cid) {
    return sortStudents(getStudents(cid).slice(), 'alpha');
  }

  function _starters(cid) {
    return MObserve.quickStarters(cid).items;
  }

  /* Starters with the chosen type's first, otherwise in bank order. */
  function sortStarters(items, type) {
    if (!type) return items.slice();
    return items
      .filter(function (t) {
        return t.sentiment === type;
      })
      .concat(
        items.filter(function (t) {
          return t.sentiment !== type;
        }),
      );
  }

  function _open(cid) {
    var day = _today();
    _s = {
      cid: cid,
      day: day,
      order: readOrder(),
      skipped: readSkipped(cid, day),
      ids: [],
      sid: null,
      type: null,
      listType: null,
      starterKey: null,
      writing: false,
      text: '',
      finished: false,
    };
    _reorder();
  }

  function _reorder() {
    _s.ids = orderIds(_students(_s.cid), _s.order, lastObserved(getAllQuickObs(_s.cid)));
  }

  function _done() {
    return doneSet(getAllQuickObs(_s.cid), _s.day);
  }

  function _starter() {
    if (!_s.starterKey) return null;
    return (
      _starters(_s.cid).find(function (t) {
        return t.key === _s.starterKey;
      }) || null
    );
  }

  /* What Save and next would write: the typed text when writing, otherwise
     the chosen starter's text. */
  function _draft() {
    var st = _starter();
    var text = _s.writing ? _s.text : st ? st.text : '';
    return {
      text: (text || '').trim(),
      sentiment: _s.type || null,
      context: st ? st.context || null : null,
      dims: st ? (st.dims || []).slice() : [],
    };
  }

  /* ── Rendering ────────────────────────────────────────────── */
  var TICK =
    '<svg class="m-sweep-tick" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7"/></svg>';

  function _countText(done) {
    var n = _s.ids.filter(function (id) {
      return done[id];
    }).length;
    return n + ' of ' + _s.ids.length + ' observed today';
  }

  function _gridHtml(done) {
    var students = _students(_s.cid);
    var byId = {};
    students.forEach(function (st) {
      byId[st.id] = st;
    });
    var names = tileNames(students);
    return _s.ids
      .map(function (id) {
        var state = done[id] ? 'done' : _s.skipped[id] ? 'skipped' : '';
        var label = names[id] + (state === 'done' ? ', observed today' : state === 'skipped' ? ', skipped' : '');
        return (
          '<button class="m-sweep-tile' +
          (id === _s.sid ? ' m-sweep-current' : '') +
          '" data-action="m-sweep-pick" data-sid="' +
          MC.esc(id) +
          '" data-state="' +
          state +
          '" aria-label="' +
          MC.esc(label) +
          '"' +
          (id === _s.sid ? ' aria-current="true"' : '') +
          '>' +
          (state === 'done' ? TICK : '') +
          '<span class="m-sweep-tile-name">' +
          MC.esc(names[id] || '') +
          '</span></button>'
        );
      })
      .join('');
  }

  function _orderHtml() {
    return [
      { key: 'roster', label: 'Roster order' },
      { key: 'longest', label: 'Longest since observed' },
    ]
      .map(function (o) {
        var on = _s.order === o.key;
        return (
          '<button class="m-seg-btn m-sweep-order-btn' +
          (on ? ' m-seg-active' : '') +
          '" role="radio" aria-checked="' +
          on +
          '" data-action="m-sweep-order" data-val="' +
          o.key +
          '">' +
          o.label +
          '</button>'
        );
      })
      .join('');
  }

  function _panelHtml(done) {
    if (_s.finished) {
      var allDone = _s.ids.every(function (id) {
        return done[id];
      });
      var skippedN = _s.ids.filter(function (id) {
        return !done[id] && _s.skipped[id];
      }).length;
      return (
        '<section class="m-sweep-panel m-sweep-finished" aria-live="polite">' +
        '<div class="m-sweep-finished-title">' +
        (allDone
          ? 'Everyone has an observation today'
          : 'No one left. ' + skippedN + (skippedN === 1 ? ' student' : ' students') + ' skipped for today.') +
        '</div>' +
        '<button class="m-btn-primary" data-action="m-sweep-done">Done</button>' +
        '</section>'
      );
    }
    if (!_s.sid) {
      return _s.ids.length
        ? '<div class="m-sweep-hint">Tap a name to start.</div>'
        : '<div class="m-empty"><div class="m-empty-title">No students in this class</div></div>';
    }
    var st = getStudents(_s.cid).find(function (x) {
      return x.id === _s.sid;
    });
    if (!st) return '';
    var chosen = _starter();
    var draft = _draft();

    var types = TYPES.map(function (t) {
      var on = _s.type === t.key;
      return (
        '<button class="m-sentiment-btn m-sweep-type' +
        (on ? ' m-selected' : '') +
        '" role="radio" aria-checked="' +
        on +
        '" data-action="m-sweep-type" data-val="' +
        t.key +
        '" data-sentiment="' +
        t.key +
        '">' +
        t.label +
        '</button>'
      );
    }).join('');

    var starters = sortStarters(_starters(_s.cid), _s.listType)
      .map(function (t) {
        var on = t.key === _s.starterKey;
        return (
          '<button class="m-quick-template m-sweep-starter' +
          (on ? ' m-selected' : '') +
          '" aria-pressed="' +
          on +
          '" data-action="m-sweep-starter" data-key="' +
          MC.esc(t.key) +
          '"><span>' +
          MC.esc(t.text) +
          '</span>' +
          MObserve.typePill(t.sentiment) +
          '</button>'
        );
      })
      .join('');

    var tags = chosen ? MObserve.tagChips(chosen.dims) : '';

    return (
      '<section class="m-sweep-panel" aria-label="' +
      MC.esc('Observation for ' + fullName(st)) +
      '">' +
      '<div class="m-sweep-panel-name">' +
      MC.esc(fullName(st)) +
      '</div>' +
      '<div class="m-sentiment-row m-sweep-types" role="radiogroup" aria-label="Type">' +
      types +
      '</div>' +
      '<div class="m-sweep-starters">' +
      starters +
      '</div>' +
      (_s.writing
        ? '<label class="m-sheet-label" for="m-sweep-text">Observation</label>' +
          '<textarea class="m-sheet-textarea" id="m-sweep-text" rows="3" placeholder="What did you notice?">' +
          MC.esc(_s.text) +
          '</textarea>'
        : '<button class="m-quick-compose m-sweep-write" data-action="m-sweep-write">Write instead…</button>') +
      (tags ? '<div class="m-obs-tags m-sweep-tags">' + tags + '</div>' : '') +
      '<div class="m-sweep-actions">' +
      '<button class="m-btn-primary" id="m-sweep-save" data-action="m-sweep-save"' +
      (draft.text ? '' : ' disabled') +
      '>Save and Next</button>' +
      '<button class="m-btn-ghost m-sweep-skip" data-action="m-sweep-skip">' +
      (_s.skipped[_s.sid] ? 'Undo skip' : 'Skip') +
      '</button>' +
      '</div>' +
      '</section>'
    );
  }

  function render(cid) {
    _open(cid);
    var done = _done();
    return (
      '<div class="m-screen" id="m-screen-obs-sweep">' +
      MC.navBar({ id: 'obs-sweep', title: 'Sweep', backLabel: 'Observations' }) +
      '<div class="m-screen-content" id="m-sweep-content">' +
      MC.largeTitleHTML('Sweep') +
      '<div class="m-sweep-head">' +
      '<div class="m-sweep-count" id="m-sweep-count" aria-live="polite">' +
      _countText(done) +
      '</div>' +
      '<div class="m-segmented m-sweep-order" role="radiogroup" aria-label="Order">' +
      _orderHtml() +
      '</div>' +
      '</div>' +
      '<div class="m-sweep-grid" id="m-sweep-grid">' +
      _gridHtml(done) +
      '</div>' +
      '<div id="m-sweep-panel">' +
      _panelHtml(done) +
      '</div>' +
      '<div style="height:80px"></div>' +
      '</div>' +
      '</div>'
    );
  }

  function _el(id) {
    return document.getElementById(id);
  }

  /* Redraws the count, grid and panel from the data. */
  function refresh(opts) {
    if (!_s || !_el('m-screen-obs-sweep')) return;
    var done = _done();
    var count = _el('m-sweep-count');
    if (count) count.textContent = _countText(done);
    var order = document.querySelector('#m-screen-obs-sweep .m-sweep-order');
    if (order) order.innerHTML = _orderHtml();
    var grid = _el('m-sweep-grid');
    if (grid) grid.innerHTML = _gridHtml(done);
    var panel = _el('m-sweep-panel');
    if (panel) panel.innerHTML = _panelHtml(done);
    _bindText();
    if (opts && opts.scroll) _scrollToPanel(panel);
    if (opts && opts.focusText) {
      var ta = _el('m-sweep-text');
      if (ta) ta.focus();
    }
  }

  /* Brings the panel's top (the student's name) just under the nav bar. */
  function _scrollToPanel(panel) {
    var content = _el('m-sweep-content');
    if (!content || !panel || !panel.getBoundingClientRect || !content.scrollTo) return;
    var top = content.scrollTop + panel.getBoundingClientRect().top - content.getBoundingClientRect().top - 8;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    content.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  }

  function _updateSave() {
    var btn = _el('m-sweep-save');
    if (btn) btn.disabled = !_draft().text;
  }

  /* Enter saves, Shift+Enter adds a line. */
  function _bindText() {
    var ta = _el('m-sweep-text');
    if (!ta || ta._sweepBound) return;
    ta._sweepBound = true;
    ta.addEventListener('input', function () {
      _s.text = ta.value;
      _updateSave();
    });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        saveAndNext();
      }
    });
  }

  function _resetPanel(sid) {
    _s.sid = sid;
    _s.type = null;
    _s.listType = null;
    _s.starterKey = null;
    _s.writing = false;
    _s.text = '';
    _s.finished = !sid;
  }

  /* ── Actions ──────────────────────────────────────────────── */
  function pick(sid) {
    if (!_s || _s.ids.indexOf(sid) < 0) return;
    _resetPanel(sid);
    refresh({ scroll: true });
  }

  function setOrder(mode) {
    if (!_s || (mode !== 'roster' && mode !== 'longest')) return;
    _s.order = mode;
    writeOrder(mode);
    _reorder();
    refresh();
  }

  function setType(type) {
    if (!_s || !_s.sid) return;
    _s.type = _s.type === type ? null : type;
    _s.listType = _s.type;
    refresh();
  }

  /* A starter's own type preselects the type button. */
  function chooseStarter(key) {
    if (!_s || !_s.sid) return;
    if (_s.starterKey === key) {
      _s.starterKey = null;
    } else {
      _s.starterKey = key;
      var st = _starter();
      if (st && st.sentiment) _s.type = st.sentiment;
      if (_s.writing && st && !_s.text.trim()) _s.text = st.text;
    }
    refresh();
  }

  function writeInstead() {
    if (!_s || !_s.sid) return;
    var st = _starter();
    _s.writing = true;
    _s.text = st ? st.text : '';
    refresh({ focusText: true });
  }

  function _advance(fromSid) {
    var next = nextStudent(_s.ids, _done(), _s.skipped, fromSid);
    _resetPanel(next);
    refresh({ scroll: true });
  }

  /* Saves through addQuickOb, offers Undo for that one observation, marks
     the tile done and opens the next student left. */
  function saveAndNext() {
    if (!_s || !_s.sid) return;
    var draft = _draft();
    if (!draft.text) return;
    var cid = _s.cid;
    var sid = _s.sid;
    var before = {};
    getStudentQuickObs(cid, sid).forEach(function (o) {
      before[o.id] = true;
    });
    var ok;
    try {
      ok = addQuickOb(cid, sid, draft.text, draft.dims, draft.sentiment, draft.context);
    } catch (e) {
      MC.showToast('Failed to save — try again');
      return;
    }
    MC.haptic();
    if (ok === false) {
      MC.showToast("Couldn't save — local storage full. Try again after freeing space.");
      return;
    }
    var saved = getStudentQuickObs(cid, sid).find(function (o) {
      return !before[o.id];
    });
    if (_s.skipped[sid]) {
      delete _s.skipped[sid];
      writeSkipped(cid, _s.day, _s.skipped);
    }
    var st = getStudents(cid).find(function (x) {
      return x.id === sid;
    });
    MC.showToast('Saved for ' + (st ? firstName(st) : 'student'), {
      duration: UNDO_MS,
      onUndo: saved
        ? function () {
            undo(cid, sid, saved.id);
          }
        : null,
    });
    _advance(sid);
  }

  /* Removes exactly the observation Save and next wrote, through the
     phone's delete path, with no confirm. */
  function undo(cid, sid, obId) {
    var id = typeof resolveObservationId === 'function' ? resolveObservationId(cid, obId) : obId;
    MObserve.deleteObservation(cid, sid, id);
    if (_s && _s.cid === cid) {
      if (_s.finished) _resetPanel(sid);
      refresh();
    }
  }

  function skip() {
    if (!_s || !_s.sid) return;
    var sid = _s.sid;
    if (_s.skipped[sid]) {
      delete _s.skipped[sid];
      writeSkipped(_s.cid, _s.day, _s.skipped);
      refresh();
      return;
    }
    _s.skipped[sid] = true;
    writeSkipped(_s.cid, _s.day, _s.skipped);
    _advance(sid);
  }

  function handleAction(action, target) {
    var val = target && target.getAttribute ? target.getAttribute('data-val') : null;
    if (action === 'm-sweep-pick') pick(target.getAttribute('data-sid'));
    else if (action === 'm-sweep-order') setOrder(val);
    else if (action === 'm-sweep-type') setType(val);
    else if (action === 'm-sweep-starter') chooseStarter(target.getAttribute('data-key'));
    else if (action === 'm-sweep-write') writeInstead();
    else if (action === 'm-sweep-save') saveAndNext();
    else if (action === 'm-sweep-skip') skip();
  }

  function isOpen() {
    return !!(_s && _el('m-screen-obs-sweep'));
  }

  /* The screen closed: the feed below picks up what was saved. */
  function close() {
    var cid = _s ? _s.cid : null;
    _s = null;
    if (cid) MObserve.refreshFeed(cid);
  }

  return {
    render: render,
    refresh: refresh,
    handleAction: handleAction,
    isOpen: isOpen,
    close: close,
    pick: pick,
    setOrder: setOrder,
    setType: setType,
    chooseStarter: chooseStarter,
    writeInstead: writeInstead,
    saveAndNext: saveAndNext,
    undo: undo,
    skip: skip,
    _state: function () {
      return _s;
    },
    _helpers: {
      localDay: localDay,
      doneSet: doneSet,
      lastObserved: lastObserved,
      tileNames: tileNames,
      orderIds: orderIds,
      nextStudent: nextStudent,
      sortStarters: sortStarters,
      readSkipped: readSkipped,
      writeSkipped: writeSkipped,
      readOrder: readOrder,
    },
  };
})();
