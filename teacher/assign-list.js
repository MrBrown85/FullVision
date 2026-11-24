// @ts-check
/* ── assign-list.js — the Assignments page's List view ─────────────────
   Cards | List on the toolbar (Colin, Nov 16: "Bulk edit assignments, like
   schoology. Assignments listed, can filter, change order, but along the
   row there are options to change the settings"). Mockup approved Nov 16:
   https://claude.ai/artifact/QewmqUbXPfuuQcfAzSsRqJ

   One row per assessment. Along the row: Title, Module, Category, Date
   Assigned, Due Date, Factor and, in a class with Send Work on, Students
   Send. Scoring is shown, not changed: switching how work is scored under
   grades already given belongs in the form (Open). Rows ticked together are
   changed together from the bar above the list, with Undo.

   Every change saves the way the form's Save Changes does: the class's list
   through saveAssessments (update_assessment for each piece that changed,
   queued while offline) and Students Send through saveAssessmentStudentWork
   (set_assessment_student_work). A change to one piece changes only this
   class's piece, not its linked copies in other classes.

   The page's own filters (Filter, Search, Show) choose the rows; the List
   adds Module, Term, Scoring and No Due Date. Order: drag a row by its
   handle (or press ↑ ↓ on the handle), or sort by a column and press Keep
   This Order. Sorting alone changes nothing.

   PageAssignments asks on() while it draws, puts switchHtml() on its
   toolbar and html() in #main, then calls afterDraw(); its init adds
   listen()'s listeners. Changes here draw the page again through
   PageAssignments.render(). */
/** @type {any} */ (window).AssignList = (function () {
  'use strict';

  var G = /** @type {any} */ (window);
  var VIEW_KEY = 'fv-assign-view';
  var FACTOR_PICKS = [0.5, 1, 1.5, 2, 3];
  var SEND = [
    { value: 'nothing', label: 'Nothing' },
    { value: 'photos', label: 'Photos' },
    { value: 'photos_files', label: 'Photos and Files' },
  ];
  var SCORING = [
    { value: 'rubric', label: 'Rubric' },
    { value: 'competencies', label: 'Competencies' },
    { value: 'points', label: 'Points' },
    { value: 'complete', label: 'Complete/Incomplete' },
    { value: 'dibels', label: 'DIBELS' },
  ];
  var SORT_NAMES = {
    title: 'Title',
    module: 'Module',
    category: 'Category',
    date: 'Date Assigned',
    due: 'Due Date',
    factor: 'Factor',
  };
  var GRIP =
    '<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="3" r="1.4"/><circle cx="8.5" cy="3" r="1.4"/><circle cx="3.5" cy="8" r="1.4"/><circle cx="8.5" cy="8" r="1.4"/><circle cx="3.5" cy="13" r="1.4"/><circle cx="8.5" cy="13" r="1.4"/></svg>';

  var _on = _readView();
  /** @type {string | null} */
  var _cid = null;
  var _filters = { module: '', term: '', scoring: '', noDue: false, drafts: false };
  /** @type {string | null} */
  var _sort = null;
  var _dir = 1;
  /** @type {Set<string>} */
  var _sel = new Set();
  /** @type {string | null} */
  var _lastPick = null;
  // Each piece's Factor and category when the List first showed it, so a change shows.
  /** @type {Record<string, string>} */
  var _base = {};
  /** @type {{ text: string, undo: () => void } | null} */
  var _undo = null;
  // The class's assessments in the page's order, and the rows shown, at the last draw.
  /** @type {any[]} */
  var _all = [];
  /** @type {string[]} */
  var _shown = [];
  /** @type {string | null} */
  var _focusKey = null;
  /** @type {Record<string, DOMRect> | null} */
  var _glideFrom = null;
  /** @type {string | null} */
  var _dragId = null;

  function _readView() {
    try {
      return localStorage.getItem(VIEW_KEY) === 'list';
    } catch (e) {
      return false;
    }
  }

  function on() {
    return _on;
  }

  /** @param {boolean} list */
  function setView(list) {
    _on = !!list;
    try {
      if (_on) localStorage.setItem(VIEW_KEY, 'list');
      else localStorage.removeItem(VIEW_KEY);
    } catch (e) {
      /* a private window keeps it for this page only */
    }
  }

  // The page opened again: filters, sort and ticks start fresh (the view stays).
  function reset() {
    _cid = null;
  }

  // Another class: its own filters, sort and ticks.
  /** @param {string} cid */
  function _forClass(cid) {
    if (cid === _cid) return;
    _cid = cid;
    _filters = { module: '', term: '', scoring: '', noDue: false, drafts: false };
    _sort = null;
    _dir = 1;
    _sel = new Set();
    _lastPick = null;
    _base = {};
    _undo = null;
  }

  /* ── What a row reads ────────────────────────────────────── */
  /** @param {any} a */
  function dateOf(a) {
    return String(a.date || a.dateAssigned || a.assigned_at || a.date_assigned || '').slice(0, 10);
  }
  /** @param {any} a */
  function dueOf(a) {
    return String(a.dueDate || a.due_date || '').slice(0, 10);
  }
  /** @param {any} a */
  function categoryOf(a) {
    return (a && (a.categoryId || a.category_id)) || '';
  }
  /** @param {string} cid @param {any} a */
  function scoringOf(cid, a) {
    var mode = a.scoreMode || a.score_mode || 'proficiency';
    if (mode === 'dibels' || mode === 'complete' || mode === 'points') return mode;
    return a.rubricId && G.getRubricById(cid, a.rubricId) ? 'rubric' : 'competencies';
  }
  /** @param {string} cid @param {any} a */
  function scoringLabel(cid, a) {
    var kind = scoringOf(cid, a);
    if (kind === 'points') return G.formatPoints(Number(a.maxPoints || a.max_points) || 100) + ' Points';
    if (kind === 'rubric') return G.getRubricById(cid, a.rubricId).name || 'Rubric';
    return SCORING.filter(function (s) {
      return s.value === kind;
    })[0].label;
  }

  /* Under the Factor: this piece's part of its category, as the form's
     share bar says it (assessmentCategoryShare in shared/calc.js). */
  /** @param {string} cid @param {any} a */
  function shareText(cid, a) {
    if (G.isDibelsScored(a)) return 'Counts toward no grade';
    var info = G.assessmentCategoryShare(cid, a);
    if (!info) return '';
    if (info.kind === 'uncategorized') return 'Not in the course %';
    // The category is in the same row, so it is not named again.
    if (info.kind === 'zero') return 'Its category counts 0%';
    if (info.kind !== 'share') return '';
    return G.formatShare(info.share, true) + ' of ' + (info.category ? 'its category' : 'the course %');
  }

  /** @param {string} cid */
  function _categories(cid) {
    return (G.getCategories(cid) || []).slice().sort(function (/** @type {any} */ a, /** @type {any} */ b) {
      var d = Number(a.displayOrder || 0) - Number(b.displayOrder || 0);
      return d || String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  /** @param {string} cid */
  function _workOffered(cid) {
    return (
      !!G.CmStudentPage &&
      typeof G.CmStudentPage.workSettings === 'function' &&
      G.CmStudentPage.workSettings(cid).send_work === true &&
      typeof G.getAssessmentStudentWork === 'function'
    );
  }

  /** @param {string} cid */
  function _studentPageOn(cid) {
    return typeof G.getReturnSettings === 'function' && !!G.getReturnSettings(cid).student_page;
  }

  /* ── Which rows, in which order ──────────────────────────── */
  /** @param {string} cid @param {any[]} assessments */
  function rowsFor(cid, assessments) {
    var terms = typeof G.getReportingTerms === 'function' ? G.getReportingTerms(cid) || [] : [];
    var term = _filters.term !== '' ? terms[Number(_filters.term)] : null;
    var rows = assessments.filter(function (a) {
      if (_filters.module === '-' ? a.moduleId : _filters.module && a.moduleId !== _filters.module) return false;
      if (_filters.scoring && scoringOf(cid, a) !== _filters.scoring) return false;
      if (_filters.noDue && dueOf(a)) return false;
      if (_filters.drafts && !a.isDraft) return false;
      if (term) {
        var d = dateOf(a);
        if (!d || d < term.starts_on || d > term.ends_on) return false;
      }
      return true;
    });
    return _sort ? sorted(cid, rows, _sort, _dir) : rows;
  }

  /* Sorted by a column; empty values last whichever way. Ties keep the
     class's order. */
  /** @param {string} cid @param {any[]} rows @param {string} key @param {number} dir */
  function sorted(cid, rows, key, dir) {
    var mods = {};
    (G.getModules(cid) || []).forEach(function (/** @type {any} */ m) {
      mods[m.id] = m.name || '';
    });
    var cats = {};
    _categories(cid).forEach(function (/** @type {any} */ c) {
      cats[c.id] = c.name || '';
    });
    /** @param {any} a @returns {string | number} */
    function val(a) {
      if (key === 'title') return String(a.title || '').toLowerCase();
      if (key === 'module') return mods[a.moduleId] || '';
      if (key === 'category') return cats[categoryOf(a)] || '';
      if (key === 'date') return dateOf(a);
      if (key === 'due') return dueOf(a);
      return G.getAssessmentWeight(a);
    }
    return rows
      .map(function (a, i) {
        return { a: a, v: val(a), i: i };
      })
      .sort(function (x, y) {
        var ex = x.v === '',
          ey = y.v === '';
        if (ex || ey) return ex && ey ? x.i - y.i : ex ? 1 : -1;
        var d = typeof x.v === 'number' ? Number(x.v) - Number(y.v) : String(x.v).localeCompare(String(y.v));
        return d * dir || x.i - y.i;
      })
      .map(function (x) {
        return x.a;
      });
  }

  /* ── Saving ──────────────────────────────────────────────── */
  /* Changes the pieces `ids` with set(piece) and saves the class's list
     once, as the form's Save Changes does. */
  /** @param {string} cid @param {string[]} ids @param {(a: any) => void} set */
  function _write(cid, ids, set) {
    var list = G.getAssessments(cid);
    var n = 0;
    ids.forEach(function (id) {
      var a = list.find(function (/** @type {any} */ x) {
        return x && x.id === id;
      });
      if (!a) return;
      set(a);
      n++;
    });
    if (n) G.saveAssessments(cid, list);
    return n;
  }

  /* One field of a piece, as the form writes it. */
  /** @param {any} a @param {string} field @param {any} value */
  function _setField(a, field, value) {
    if (field === 'title') a.title = value;
    else if (field === 'module') a.moduleId = value || undefined;
    else if (field === 'category') {
      a.categoryId = value || undefined;
      a.category_id = value || undefined;
    } else if (field === 'date') {
      a.date = value;
      a.dateAssigned = value;
    } else if (field === 'due') a.dueDate = value || undefined;
    else if (field === 'factor') a.weight = Number(value) !== 1 ? Number(value) : undefined;
  }

  /** @param {any} a @param {string} field */
  function _getField(a, field) {
    if (field === 'title') return a.title || '';
    if (field === 'module') return a.moduleId || '';
    if (field === 'category') return categoryOf(a);
    if (field === 'date') return dateOf(a);
    if (field === 'due') return dueOf(a);
    return G.getAssessmentWeight(a);
  }

  /* Sets one field on each of `ids`; returns what each held before. */
  /** @param {string} cid @param {string[]} ids @param {string} field @param {any} value */
  function setField(cid, ids, field, value) {
    /** @type {Record<string, any>} */
    var before = {};
    _write(cid, ids, function (a) {
      before[a.id] = _getField(a, field);
      _setField(a, field, value);
    });
    return before;
  }

  /* What students send for each of `ids`, as the form's Student Work card
     saves it (Who Sends is Each Student for individual work). */
  /** @param {string} cid @param {string[]} ids @param {string} value */
  function setSend(cid, ids, value) {
    /** @type {Record<string, any>} */
    var before = {};
    var list = G.getAssessments(cid);
    ids.forEach(function (id) {
      var a = list.find(function (/** @type {any} */ x) {
        return x && x.id === id;
      });
      if (!a) return;
      var w = G.getAssessmentStudentWork(cid, id);
      before[id] = w.students_send;
      var next = Object.assign({}, w, { students_send: value });
      if (!a.collaboration || a.collaboration === 'individual') next.group_work = 'each';
      G.saveAssessmentStudentWork(cid, id, next);
    });
    return before;
  }

  /* Numbers the class's list 1..n in `order` (every assessment's id). */
  /** @param {string} cid @param {string[]} order */
  function saveOrder(cid, order) {
    var list = G.getAssessments(cid);
    var at = {};
    order.forEach(function (id, i) {
      at[id] = i + 1;
    });
    list.forEach(function (/** @type {any} */ a) {
      if (a && at[a.id]) a.display_order = at[a.id];
    });
    G.saveAssessments(cid, list);
  }

  /* Moves `id` to just before (after = false) or after `target` in the
     class's order, and saves the order. */
  /** @param {string} cid @param {string} id @param {string} target @param {boolean} after */
  function move(cid, id, target, after) {
    if (id === target) return false;
    var order = _all.map(function (a) {
      return a.id;
    });
    if (order.indexOf(id) < 0 || order.indexOf(target) < 0) return false;
    order.splice(order.indexOf(id), 1);
    order.splice(order.indexOf(target) + (after ? 1 : 0), 0, id);
    saveOrder(cid, order);
    return true;
  }

  // The whole class in the column's order, saved as its order.
  /** @param {string} cid */
  function keepSortedOrder(cid) {
    if (!_sort) return;
    saveOrder(
      cid,
      sorted(cid, _all, _sort, _dir).map(function (a) {
        return a.id;
      }),
    );
  }

  /* ── Drawing ─────────────────────────────────────────────── */
  /** @param {string} value @param {string} label @param {boolean} [on] */
  function _opt(value, label, on) {
    return '<option value="' + G.esc(value) + '"' + (on ? ' selected' : '') + '>' + G.esc(label) + '</option>';
  }

  // The Grade | Bulk Edit switch on the toolbar (Colin, Nov 18: "List is confusing"): the cards are
  // where work is graded, the list where settings are changed for many pieces at once.
  // html-safe: fixed words
  function switchHtml() {
    return (
      '<div class="seg assess-view-seg" role="group" aria-label="View">' +
      '<button type="button" class="seg-btn"' +
      G.segAttr(!_on) +
      ' data-alv-view="cards">Grade</button>' +
      '<button type="button" class="seg-btn"' +
      G.segAttr(_on) +
      ' data-alv-view="list">Bulk Edit</button>' +
      '</div>'
    );
  }

  /** @param {string} cid @param {any[]} modules @param {any[]} terms @param {number} shown @param {number} total */
  function _filtersHtml(cid, modules, terms, shown, total) {
    /** @param {string} key @param {string} label @param {string} body */
    function chip(key, label, body) {
      return (
        '<label class="alv-fchip' +
        (_filters[/** @type {'module'} */ (key)] ? ' is-on' : '') +
        '"><span>' +
        label +
        '</span><select data-alv-filter="' +
        key +
        '" data-alv-f="f:' +
        key +
        '">' +
        body +
        '</select></label>'
      );
    }
    var html = '<div class="alv-filters" role="group" aria-label="List filters">';
    if (modules.length)
      html += chip(
        'module',
        'Module',
        _opt('', 'All', !_filters.module) +
          _opt('-', 'No Module', _filters.module === '-') +
          modules
            .map(function (m) {
              return _opt(m.id, m.name || 'Untitled', _filters.module === m.id);
            })
            .join(''),
      );
    if (terms.length)
      html += chip(
        'term',
        'Term',
        _opt('', 'All', _filters.term === '') +
          terms
            .map(function (t, i) {
              return _opt(String(i), t.label || 'Term ' + (i + 1), _filters.term === String(i));
            })
            .join(''),
      );
    html += chip(
      'scoring',
      'Scoring',
      _opt('', 'All', !_filters.scoring) +
        SCORING.filter(function (s) {
          return s.value !== 'dibels' || _all.some(G.isDibelsScored);
        })
          .map(function (s) {
            return _opt(s.value, s.label, _filters.scoring === s.value);
          })
          .join(''),
    );
    html +=
      '<label class="alv-fchip alv-fchip-check' +
      (_filters.noDue ? ' is-on' : '') +
      '"><input type="checkbox" data-alv-filter="noDue" data-alv-f="f:noDue"' +
      (_filters.noDue ? ' checked' : '') +
      '><span>No Due Date</span></label>';
    // Drafts (assign-draft.js): only while the class has one, or the filter is on.
    if (_filters.drafts || _all.some(G.isDraftAssessment))
      html +=
        '<label class="alv-fchip alv-fchip-check' +
        (_filters.drafts ? ' is-on' : '') +
        '"><input type="checkbox" data-alv-filter="drafts" data-alv-f="f:drafts"' +
        (_filters.drafts ? ' checked' : '') +
        '><span>Drafts</span></label>';
    html += '<span class="alv-count">' + shown + ' of ' + total + '</span>';
    return html + '</div>';
  }

  /** @param {string} cid @param {any[]} cats @param {any[]} modules @param {boolean} work */
  function _bulkHtml(cid, cats, modules, work) {
    if (!_sel.size && !_undo) return '';
    if (!_sel.size)
      return (
        '<div class="alv-bar alv-undo-bar" role="status"><span>' +
        G.esc(_undo ? _undo.text : '') +
        '</span><button type="button" class="alv-link" data-alv-act="undo" data-alv-f="bulk:undo">Undo</button></div>'
      );
    /** @param {string} key @param {string} label @param {string} body */
    function pick(key, label, body) {
      return (
        '<select class="alv-bulk-pick" data-alv-bulk="' +
        key +
        '" data-alv-f="bulk:' +
        key +
        '" aria-label="' +
        label +
        '">' +
        _opt('', label + '…', true) +
        body +
        '</select>'
      );
    }
    return (
      '<div class="alv-bar" role="group" aria-label="Change the ticked assessments">' +
      '<strong class="alv-bar-n">' +
      _sel.size +
      ' Selected</strong>' +
      (_tickedDrafts(cid).length
        ? '<button type="button" class="btn btn-primary alv-assign" data-alv-act="assign" data-alv-f="bulk:assign">Assign</button>'
        : '') +
      (cats.length
        ? pick(
            'category',
            'Set Category',
            cats
              .map(function (c) {
                return _opt(c.id, c.name || 'Untitled');
              })
              .join(''),
          )
        : '') +
      (modules.length
        ? pick(
            'module',
            'Set Module',
            _opt('-', 'No Module') +
              modules
                .map(function (m) {
                  return _opt(m.id, m.name || 'Untitled');
                })
                .join(''),
          )
        : '') +
      '<label class="alv-bar-date"><span>Set Due Date</span><input type="date" data-alv-bulk="due" data-alv-f="bulk:due"></label>' +
      pick(
        'factor',
        'Set Factor',
        FACTOR_PICKS.map(function (v) {
          return _opt(String(v), '× ' + v);
        }).join(''),
      ) +
      (work
        ? pick(
            'send',
            'Students Send',
            SEND.map(function (s) {
              return _opt(s.value, s.label);
            }).join(''),
          )
        : '') +
      (_undo
        ? '<span class="alv-bar-done">' +
          G.esc(_undo.text) +
          '</span><button type="button" class="alv-link" data-alv-act="undo" data-alv-f="bulk:undo">Undo</button>'
        : '') +
      '<span class="alv-spacer"></span>' +
      '<button type="button" class="alv-link" data-alv-act="clearSel" data-alv-f="bulk:clear">Clear</button>' +
      '</div>'
    );
  }

  function _sortBarHtml() {
    if (!_sort) return '';
    return (
      '<div class="alv-bar alv-sort-bar" role="status"><span>Sorted by ' +
      SORT_NAMES[/** @type {'title'} */ (_sort)] +
      '. The class’s order is unchanged.</span><span class="alv-spacer"></span>' +
      '<button type="button" class="btn btn-ghost alv-keep" data-alv-act="keepOrder" data-alv-f="sort:keep">Keep This Order</button>' +
      '<button type="button" class="alv-link" data-alv-act="unsort" data-alv-f="sort:back">Back to My Order</button>' +
      '</div>'
    );
  }

  /** @param {string} key @param {string} label @param {string} [hint] */
  function _th(key, label, hint) {
    var on = _sort === key;
    return (
      '<th scope="col" aria-sort="' +
      (on ? (_dir > 0 ? 'ascending' : 'descending') : 'none') +
      '"><button type="button" class="alv-sort" data-alv-sort="' +
      key +
      '" data-alv-f="sort:' +
      key +
      '">' +
      label +
      (on ? '<span class="alv-arrow" aria-hidden="true">' + (_dir > 0 ? '↑' : '↓') + '</span>' : '') +
      '</button>' +
      (hint ? '<span class="alv-hint">' + hint + '</span>' : '') +
      '</th>'
    );
  }

  /* The List, in #main: the form's place (formHtml, as the cards have it),
     the filters, the bars and the rows. assessments are the ones the page's
     filters leave; allAssessments every one, in the class's order. */
  // html-safe: titles, names and labels through esc; ids are ours; dates, Factors and counts are numbers
  /** @param {string} cid @param {any[]} assessments @param {any[]} allAssessments @param {string} formHtml */
  function html(cid, assessments, allAssessments, formHtml) {
    _forClass(cid);
    _all = allAssessments.slice();
    var ids = {};
    _all.forEach(function (a) {
      ids[a.id] = true;
      if (!(a.id in _base)) _base[a.id] = G.getAssessmentWeight(a) + '|' + categoryOf(a);
    });
    _sel.forEach(function (id) {
      if (!ids[id]) _sel.delete(id);
    });
    var cats = _categories(cid);
    var tints = {};
    cats.forEach(function (c, i) {
      tints[c.id] = G.categoryTintByIndex(i, c.name).fg;
    });
    var modules = G.getModules(cid) || [];
    var terms = typeof G.getReportingTerms === 'function' ? G.getReportingTerms(cid) || [] : [];
    var work = _workOffered(cid);
    var pageOn = _studentPageOn(cid);
    var today = typeof G.courseToday === 'function' ? G.courseToday(cid) : '';
    var rows = rowsFor(cid, assessments);
    _shown = rows.map(function (a) {
      return a.id;
    });
    var allTicked =
      rows.length > 0 &&
      rows.every(function (a) {
        return _sel.has(a.id);
      });

    var out = '<div class="alv-page">' + formHtml;
    out += _filtersHtml(cid, modules, terms, rows.length, _all.length);
    out += '<div class="alv">' + _bulkHtml(cid, cats, modules, work) + _sortBarHtml();
    out += '<div class="alv-scroll"><table class="alv-table"><thead><tr>';
    out += '<th class="alv-grip-col" aria-label="Order"></th>';
    out +=
      '<th class="alv-tick-col"><input type="checkbox" data-alv-act="tickAll" data-alv-f="tick:all" aria-label="Select all shown"' +
      (allTicked ? ' checked' : '') +
      '></th>';
    out += _th('title', 'Title');
    if (modules.length) out += _th('module', 'Module');
    if (cats.length)
      out += _th(
        'category',
        'Category',
        cats.some(function (c) {
          return !(Number(c.weight || 0) > 0);
        })
          ? '0% counts toward nothing'
          : '',
      );
    out += _th('date', 'Date Assigned', pageOn ? 'Students see it from' : '');
    out += _th('due', 'Due Date');
    out += _th('factor', 'Factor');
    out += '<th scope="col" class="alv-plain">Scoring</th>';
    if (work) out += '<th scope="col" class="alv-plain">Students Send</th>';
    out += '<th class="alv-open-col" aria-label="Open"></th></tr></thead><tbody>';

    rows.forEach(function (a) {
      var id = G.esc(a.id);
      var title = a.title || '';
      var cat = categoryOf(a);
      var date = dateOf(a);
      var due = dueOf(a);
      var dibels = G.isDibelsScored(a);
      var factor = G.getAssessmentWeight(a);
      var changed = _base[a.id] !== factor + '|' + cat;
      var f = function (/** @type {string} */ k) {
        return ' data-alv-f="' + id + ':' + k + '"';
      };
      out += '<tr data-alv-row="' + id + '"' + (_sel.has(a.id) ? ' class="is-ticked"' : '') + '>';
      out +=
        '<td class="alv-grip-col">' +
        (_sort
          ? ''
          : '<button type="button" class="alv-grip" draggable="true" data-alv-grip="' +
            id +
            '"' +
            f('grip') +
            ' aria-label="Move ' +
            G.esc(title || 'Untitled') +
            ' (Up or Down arrow)">' +
            GRIP +
            '</button>') +
        '</td>';
      out +=
        '<td class="alv-tick-col"><input type="checkbox" data-alv-act="tick"' +
        f('tick') +
        (_sel.has(a.id) ? ' checked' : '') +
        ' aria-label="Select ' +
        G.esc(title || 'Untitled') +
        '"></td>';
      out +=
        '<td class="alv-title-col">' +
        (a.isDraft ? '<span class="draft-badge">Draft</span>' : '') +
        '<input class="alv-title" data-alv-k="title"' +
        f('title') +
        ' value="' +
        G.esc(title) +
        '" aria-label="Title" maxlength="200"></td>';
      if (modules.length)
        out +=
          '<td><select class="alv-cell' +
          (a.moduleId ? '' : ' is-empty') +
          '" data-alv-k="module"' +
          f('module') +
          ' aria-label="Module">' +
          _opt('', 'No Module', !a.moduleId) +
          modules
            .map(function (m) {
              return _opt(m.id, m.name || 'Untitled', m.id === a.moduleId);
            })
            .join('') +
          '</select></td>';
      if (cats.length) {
        var known = cats.some(function (c) {
          return c.id === cat;
        });
        out +=
          '<td><span class="alv-cat"><span class="alv-dot" style="background:' +
          G.esc(tints[cat] || 'var(--border)') +
          '"></span><select class="alv-cell' +
          (known ? '' : ' is-empty') +
          '" data-alv-k="category"' +
          f('category') +
          ' aria-label="Category">' +
          (known ? '' : _opt('', dibels ? 'No Category' : 'Choose…', true)) +
          cats
            .map(function (c) {
              return _opt(c.id, c.name || 'Untitled', c.id === cat);
            })
            .join('') +
          '</select></span></td>';
      }
      out +=
        '<td><input type="date" class="alv-cell alv-date" data-alv-k="date"' +
        f('date') +
        ' value="' +
        G.esc(date) +
        '" aria-label="Date assigned" required>' +
        (pageOn && today && date > today
          ? '<span class="alv-sub">Students see it ' + G.esc(G.formatShortDate(date, today)) + '</span>'
          : '') +
        '</td>';
      out +=
        '<td><input type="date" class="alv-cell alv-date' +
        (due ? '' : ' is-empty') +
        '" data-alv-k="due"' +
        f('due') +
        ' value="' +
        G.esc(due) +
        '" aria-label="Due date">' +
        (due && date && due < date ? '<span class="alv-sub alv-warn">Before the date assigned</span>' : '') +
        '</td>';
      var share = shareText(cid, a);
      out +=
        '<td class="alv-factor-col">' +
        (dibels
          ? '<span class="alv-sub">' + G.esc(share) + '</span>'
          : '<span class="alv-factor"><button type="button" class="alv-step" data-alv-step="-1"' +
            f('down') +
            ' aria-label="Lower the factor">−</button><input class="alv-factor-in" data-alv-k="factor"' +
            f('factor') +
            ' inputmode="decimal" value="' +
            G.esc(String(factor)) +
            '" aria-label="Factor"><button type="button" class="alv-step" data-alv-step="1"' +
            f('up') +
            ' aria-label="Raise the factor">+</button></span>' +
            (share
              ? '<span class="alv-sub alv-share' +
                (changed ? ' is-changed' : '') +
                '"' +
                (changed ? ' title="Changed since you opened the list"' : '') +
                '>' +
                G.esc(share) +
                '</span>'
              : '')) +
        '</td>';
      out += '<td><span class="alv-scoring">' + G.esc(scoringLabel(cid, a)) + '</span></td>';
      if (work) {
        var send = G.getAssessmentStudentWork(cid, a.id).students_send || 'nothing';
        out +=
          '<td><select class="alv-cell' +
          (send === 'nothing' ? ' is-empty' : '') +
          '" data-alv-k="send"' +
          f('send') +
          ' aria-label="Students send">' +
          SEND.map(function (s) {
            return _opt(s.value, s.label, s.value === send);
          }).join('') +
          '</select></td>';
      }
      out +=
        '<td class="alv-open-col"><button type="button" class="alv-link" data-action="editAssess" data-aid="' +
        id +
        '"' +
        f('open') +
        '>Open</button></td></tr>';
    });
    if (!rows.length)
      out +=
        '<tr><td class="alv-none" colspan="11">' +
        (_all.length
          ? 'No assessments match these filters. <button type="button" class="alv-link" data-alv-act="clearFilters" data-alv-f="f:clear">Clear List Filters</button>'
          : 'No assessments yet.') +
        '</td></tr>';
    out += '</tbody></table></div></div></div>';
    return out;
  }

  /* After the page is drawn: focus back where it was, and rows that moved
     glide from where they were. */
  /** @param {HTMLElement} root */
  function afterDraw(root) {
    if (!root || !_on) return;
    if (_focusKey) {
      var el = /** @type {HTMLElement | null} */ (root.querySelector('[data-alv-f="' + CSS.escape(_focusKey) + '"]'));
      if (el) el.focus({ preventScroll: true });
      _focusKey = null;
    }
    var from = _glideFrom;
    _glideFrom = null;
    if (!from || typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Read every row first, then write: one layout, not one per row.
    /** @type {{ row: HTMLElement, dy: number }[]} */
    var moved = [];
    var rects = from;
    root.querySelectorAll('tr[data-alv-row]').forEach(function (tr) {
      var row = /** @type {HTMLElement} */ (tr);
      var was = rects[row.dataset.alvRow || ''];
      var dy = was ? was.top - row.getBoundingClientRect().top : 0;
      if (dy) moved.push({ row: row, dy: dy });
    });
    if (!moved.length) return;
    moved.forEach(function (m) {
      m.row.style.transition = 'none';
      m.row.style.transform = 'translateY(' + m.dy + 'px)';
    });
    // Laid out at the start once, then let go: no frame wait, so a tab in
    // the background never keeps a row where it was.
    root.getBoundingClientRect();
    moved.forEach(function (m) {
      m.row.style.transition = 'transform 200ms cubic-bezier(.2,.8,.2,1)';
      m.row.style.transform = '';
    });
  }

  /* ── Events ──────────────────────────────────────────────── */
  /** @param {boolean} [glide] @param {string | null} [focus] the control to focus after, when not the one focused now */
  function _redraw(glide, focus) {
    var active = /** @type {HTMLElement | null} */ (document.activeElement);
    _focusKey = focus || (active && active.dataset ? active.dataset.alvF || null : null);
    if (glide) {
      /** @type {Record<string, DOMRect>} */
      var rects = {};
      document.querySelectorAll('.alv tr[data-alv-row]').forEach(function (tr) {
        rects[/** @type {HTMLElement} */ (tr).dataset.alvRow || ''] = tr.getBoundingClientRect();
      });
      _glideFrom = rects;
    }
    if (G.PageAssignments) G.PageAssignments.render();
  }

  /** @param {Element} el */
  function _rowId(el) {
    var tr = /** @type {HTMLElement | null} */ (el.closest('tr[data-alv-row]'));
    return tr ? tr.dataset.alvRow || '' : '';
  }

  /** @param {number} n */
  function _plural(n) {
    return n === 1 ? '1 assessment' : n + ' assessments';
  }

  /* A change that moves grades asks first and can be undone (Colin,
     Nov 16): which changes, and the question, are teacher/grade-change.js's. */
  var FIELD_NAMES = {
    title: 'Title',
    module: 'Module',
    category: 'Category',
    date: 'Date Assigned',
    due: 'Due Date',
    factor: 'Factor',
    send: 'Students Send',
  };

  /* A change kept for Undo: `before` is what each piece held, `field` the
     field changed ('send' for Students Send). */
  /* The ticked pieces that are Drafts. */
  /** @param {string} cid */
  function _tickedDrafts(cid) {
    return (G.getAssessments(cid) || [])
      .filter(function (/** @type {any} */ a) {
        return a && a.isDraft && _sel.has(a.id);
      })
      .map(function (/** @type {any} */ a) {
        return a.id;
      });
  }

  /* Assign on the bar: the ticked Drafts, with Undo while nothing has come in. */
  /** @param {string} cid */
  function _assignTicked(cid) {
    var ids = _tickedDrafts(cid);
    /** @type {Record<string, string>} */
    var dates = {};
    (G.getAssessments(cid) || []).forEach(function (/** @type {any} */ a) {
      if (a && ids.indexOf(a.id) >= 0) dates[a.id] = dateOf(a);
    });
    var n = G.AssignDraft.assign(cid, ids);
    if (!n) return;
    _undo = {
      text: 'Assigned ' + _plural(n) + '.',
      undo: function () {
        _write(cid, ids, function (a) {
          if (G.AssignDraft.hasWork(cid, a.id)) return;
          a.isDraft = true;
          a.date = dates[a.id];
          a.dateAssigned = dates[a.id];
        });
      },
    };
  }

  /** @param {string} cid @param {string} text @param {Record<string, any>} before @param {string} field */
  function _keepUndo(cid, text, before, field) {
    var ids = Object.keys(before);
    _undo = {
      text: text,
      undo: function () {
        if (field === 'send')
          ids.forEach(function (id) {
            setSend(cid, [id], before[id]);
          });
        else
          _write(cid, ids, function (a) {
            _setField(a, field, before[a.id]);
          });
      },
    };
  }

  /* Saves one field on `ids`. A change that moves grades asks first; it and
     every change to ticked rows (bulk) can be undone. */
  /** @param {string} cid @param {string[]} ids @param {string} field @param {any} value @param {boolean} bulk */
  function apply(cid, ids, field, value, bulk) {
    var list = G.getAssessments(cid);
    var pieces = ids
      .map(function (id) {
        return list.find(function (/** @type {any} */ x) {
          return x && x.id === id;
        });
      })
      .filter(Boolean);
    if (!pieces.length) return;
    var ask = field === 'send' ? null : G.GradeChange.question(cid, pieces, field, value, bulk);
    var active = /** @type {HTMLElement | null} */ (document.activeElement);
    var focus = active && active.dataset ? active.dataset.alvF || null : null;
    function go() {
      var before = field === 'send' ? setSend(cid, ids, value) : setField(cid, ids, field, value);
      if (bulk) _keepUndo(cid, 'Set ' + FIELD_NAMES[field] + ' for ' + _plural(ids.length) + '.', before, field);
      else if (ask)
        _keepUndo(
          cid,
          'Changed the ' + FIELD_NAMES[field] + ' of “' + (pieces[0].title || 'Untitled') + '”.',
          before,
          field,
        );
      else _undo = null;
      _redraw(false, focus);
    }
    if (!ask || typeof G.showConfirm !== 'function') return go();
    // The row shows what is saved until the teacher says yes.
    _redraw(false, focus);
    G.showConfirm(ask.title, ask.message, ask.ok, 'primary', go);
  }

  /** @param {Event} e */
  function _onChange(e) {
    var el = /** @type {HTMLInputElement} */ (e.target);
    if (!el.closest || !el.closest('.alv-page') || !_cid) return;
    var cid = _cid;
    var d = el.dataset;
    if (d.alvFilter) {
      if (d.alvFilter === 'noDue' || d.alvFilter === 'drafts') _filters[d.alvFilter] = el.checked;
      else _filters[/** @type {'module'} */ (d.alvFilter)] = el.value;
      _redraw();
      return;
    }
    if (d.alvBulk) {
      var ids = Array.from(_sel);
      if (!ids.length || !el.value) return;
      apply(cid, ids, d.alvBulk, d.alvBulk === 'module' && el.value === '-' ? '' : el.value, true);
      return;
    }
    var k = d.alvK;
    if (!k) return;
    var id = _rowId(el);
    if (!id) return;
    var value = k === 'title' ? el.value.trim() : k === 'factor' ? G.FactorField.parse(el.value) : el.value;
    // A blank Title or Date Assigned, or a Factor that isn't one, is not saved.
    if ((k === 'title' || k === 'date') && !value) return _redraw();
    if (k === 'factor' && value == null) return _redraw();
    apply(cid, [id], k, value, false);
  }

  /** @param {MouseEvent} e */
  function _onClick(e) {
    var t = /** @type {HTMLElement} */ (e.target);
    if (!t.closest) return;
    var view = /** @type {HTMLElement | null} */ (t.closest('[data-alv-view]'));
    if (view) {
      var list = view.dataset.alvView === 'list';
      if (list !== _on) {
        setView(list);
        if (G.PageAssignments) G.PageAssignments.render();
      }
      return;
    }
    if (!t.closest('.alv-page') || !_cid) return;
    var cid = _cid;
    var sortBtn = /** @type {HTMLElement | null} */ (t.closest('[data-alv-sort]'));
    if (sortBtn) {
      var key = sortBtn.dataset.alvSort || '';
      _dir = _sort === key ? -_dir : 1;
      _sort = key;
      _redraw(true);
      return;
    }
    var step = /** @type {HTMLElement | null} */ (t.closest('[data-alv-step]'));
    if (step) {
      var sid = _rowId(step);
      var a = _all.find(function (x) {
        return x.id === sid;
      });
      if (!a) return;
      apply(cid, [sid], 'factor', G.FactorField.step(G.getAssessmentWeight(a), Number(step.dataset.alvStep)), false);
      return;
    }
    var actEl = /** @type {HTMLInputElement | null} */ (t.closest('[data-alv-act]'));
    if (!actEl) return;
    var act = actEl.dataset.alvAct;
    if (act === 'tick') {
      var id = _rowId(actEl);
      if (e.shiftKey && _lastPick && _shown.indexOf(_lastPick) >= 0) {
        var a0 = _shown.indexOf(_lastPick);
        var a1 = _shown.indexOf(id);
        _shown.slice(Math.min(a0, a1), Math.max(a0, a1) + 1).forEach(function (x) {
          if (actEl && actEl.checked) _sel.add(x);
          else _sel.delete(x);
        });
      } else if (actEl.checked) _sel.add(id);
      else _sel.delete(id);
      _lastPick = id;
    } else if (act === 'tickAll') {
      if (actEl.checked)
        _shown.forEach(function (x) {
          _sel.add(x);
        });
      else _sel.clear();
    } else if (act === 'clearSel') {
      _sel.clear();
      _undo = null;
    } else if (act === 'undo') {
      if (_undo) _undo.undo();
      _undo = null;
    } else if (act === 'keepOrder') {
      keepSortedOrder(cid);
      _sort = null;
      _redraw(true);
      return;
    } else if (act === 'unsort') {
      _sort = null;
      _redraw(true);
      return;
    } else if (act === 'clearFilters') {
      _filters = { module: '', term: '', scoring: '', noDue: false, drafts: false };
    } else if (act === 'assign') {
      _assignTicked(cid);
    } else return;
    _redraw();
  }

  /** @param {KeyboardEvent} e */
  function _onKeydown(e) {
    var t = /** @type {HTMLElement} */ (e.target);
    if (!t || !t.dataset || !_cid) return;
    // Enter in the Title saves it.
    if (e.key === 'Enter' && t.dataset.alvK && t.tagName === 'INPUT') {
      e.preventDefault();
      t.blur();
      return;
    }
    if (!t.dataset.alvGrip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    var id = t.dataset.alvGrip;
    var at = _shown.indexOf(id);
    var up = e.key === 'ArrowUp';
    var target = _shown[up ? at - 1 : at + 1];
    if (!target) return;
    _undo = null;
    if (move(_cid, id, target, !up)) _redraw(true);
  }

  /** @param {DragEvent} e */
  function _onDragStart(e) {
    var grip = /** @type {HTMLElement | null} */ (
      e.target && /** @type {HTMLElement} */ (e.target).closest
        ? /** @type {HTMLElement} */ (e.target).closest('[data-alv-grip]')
        : null
    );
    if (!grip || !e.dataTransfer) return;
    _dragId = grip.dataset.alvGrip || null;
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', _dragId || '');
    } catch (err) {
      /* some browsers refuse setData on a synthetic drag */
    }
    var tr = grip.closest('tr');
    if (tr) {
      e.dataTransfer.setDragImage(tr, 20, 16);
      tr.classList.add('is-moving');
    }
  }

  function _clearMarks() {
    document.querySelectorAll('.alv tr.drop-before, .alv tr.drop-after').forEach(function (tr) {
      tr.classList.remove('drop-before', 'drop-after');
    });
  }

  /** @param {DragEvent} e @returns {{ tr: HTMLElement, after: boolean } | null} */
  function _dropAt(e) {
    var tr = /** @type {HTMLElement | null} */ (
      e.target && /** @type {HTMLElement} */ (e.target).closest
        ? /** @type {HTMLElement} */ (e.target).closest('.alv tr[data-alv-row]')
        : null
    );
    if (!tr) return null;
    var box = tr.getBoundingClientRect();
    return { tr: tr, after: e.clientY > box.top + box.height / 2 };
  }

  /** @param {DragEvent} e */
  function _onDragOver(e) {
    if (!_dragId) return;
    var at = _dropAt(e);
    if (!at) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    var want = at.after ? 'drop-after' : 'drop-before';
    if (at.tr.classList.contains(want)) return;
    _clearMarks();
    if (at.tr.dataset.alvRow !== _dragId) at.tr.classList.add(want);
  }

  /** @param {DragEvent} e */
  function _onDrop(e) {
    if (!_dragId || !_cid) return;
    var at = _dropAt(e);
    var id = _dragId;
    _dragId = null;
    _clearMarks();
    if (!at) return;
    e.preventDefault();
    _undo = null;
    _focusKey = null;
    if (move(_cid, id, at.tr.dataset.alvRow || '', at.after)) _redraw(true);
  }

  function _onDragEnd() {
    _dragId = null;
    _clearMarks();
    document.querySelectorAll('.alv tr.is-moving').forEach(function (tr) {
      tr.classList.remove('is-moving');
    });
  }

  /* Its listeners, on the page's document while the Assignments page is
     open: PageAssignments adds them with its own and takes them off with
     its own. Each acts only inside the List or on the switch. */
  /** @param {(type: string, handler: (e: any) => void) => void} add */
  function listen(add) {
    add('change', _onChange);
    add('click', _onClick);
    add('keydown', _onKeydown);
    add('dragstart', _onDragStart);
    add('dragover', _onDragOver);
    add('drop', _onDrop);
    add('dragend', _onDragEnd);
  }

  return {
    on: on,
    listen: listen,
    reset: reset,
    setView: setView,
    switchHtml: switchHtml,
    html: html,
    afterDraw: afterDraw,
    // For tests and the page: what a row reads and what a change writes.
    rowsFor: rowsFor,
    sorted: sorted,
    shareText: shareText,
    scoringOf: scoringOf,
    setField: setField,
    setSend: setSend,
    move: move,
  };
})();
