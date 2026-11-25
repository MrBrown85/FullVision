// @ts-check
/* dash-competencies.js — the Dashboard's one Competencies tile: what the
   class's work has covered. A tile titled Competencies with a segmented
   control, Curricular | Core, over two pages that slide sideways. Under the
   title, "<this term> | Year" says what the numbers count; each page lists
   its competencies with how many assessments carried them.

   Curricular: one row for each competency assessed in the period, in the
   class's own order, under its folder's name where the class has more than
   one folder. The name and, at the right, how many of the class's
   assessments carried it (amber at one). Under the name, one tick for each
   student, the strongest first, in that student's level on the competency
   (hollow with no mark yet). A tick opens the students at that level, as the
   old Level Mix bar did. At the foot, one quiet line counts the competencies
   with no assessment in the period; it opens to their names, and a name
   opens the New Assessment form with that competency ticked.

   Core: one row for each Core Competency tagged in the period, a dark bar
   as long as its count against the most tagged; the same quiet line for the
   ones not tagged.

   A level here is the one competencyDistribution gives (the bands the old
   Level Mix drew), read as of the term when the term is picked
   (readAsOfTerm). Nothing here works out a level or a grade.

   The page shown and the period are kept per class on the device by
   page-dashboard.js, which reads and writes them through its _readPref and
   _writePref and hands them to html() as opts.compPage and opts.compSpan.
   The only state held here is the open list of students and which "Not
   Assessed" lines are open, so a redraw (the Dashboard redraws as one
   string) loses nothing. */
window.DashCompetencies = (function () {
  'use strict';

  var PREF_KEY = 'fv-dash-comp-page:';
  var SPAN_KEY = 'fv-dash-comp-span:';
  /** @type {{ key: string, label: string }[]} */
  var PAGES = [
    { key: 'curricular', label: 'Curricular' },
    { key: 'core', label: 'Core' },
  ];

  /** The page a saved choice names; Curricular when it names none.
   * @param {unknown} raw
   * @returns {string} */
  function pageOf(raw) {
    return raw === 'core' ? 'core' : 'curricular';
  }

  /** What a saved choice counts over: 'year' when it says so, else 'term'
   * (which is the year when the class has no term now).
   * @param {unknown} raw
   * @returns {string} */
  function spanOf(raw) {
    return raw === 'year' ? 'year' : 'term';
  }

  /** The page an arrow key, Home or End moves to from `page`, or null when
   * the key is not one of those.
   * @param {string} page
   * @param {string} key
   * @returns {string | null} */
  function pageForKey(page, key) {
    var at = PAGES.findIndex(function (p) {
      return p.key === page;
    });
    if (at < 0) at = 0;
    var n = PAGES.length;
    if (key === 'ArrowRight' || key === 'ArrowDown') return PAGES[(at + 1) % n].key;
    if (key === 'ArrowLeft' || key === 'ArrowUp') return PAGES[(at - 1 + n) % n].key;
    if (key === 'Home') return PAGES[0].key;
    if (key === 'End') return PAGES[n - 1].key;
    return null;
  }

  /** @param {string} key */
  function _tabId(key) {
    return 'dash-comp-tab-' + key;
  }
  /** @param {string} key */
  function _pageId(key) {
    return 'dash-comp-page-' + key;
  }

  /* ── The period ─────────────────────────────────────────────── */
  /** What the numbers count: this term (the class's reporting term whose
   * dates hold today) or the year. A class with no terms, or today outside
   * every one, counts the year.
   * @param {any} opts
   * @returns {{ span: string, term: any, today: string }} */
  function periodOf(opts) {
    var cid = String(opts.cid);
    var today = String(opts.todayStr || (typeof courseToday === 'function' ? courseToday(cid) : '')).slice(0, 10);
    var terms = typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [];
    var term =
      terms.find(function (t) {
        return t.starts_on && t.ends_on && t.starts_on <= today && today <= t.ends_on;
      }) || null;
    return { span: term && spanOf(opts.compSpan) === 'term' ? 'term' : 'year', term: term, today: today };
  }

  /** The day an assessment is dated, as 'YYYY-MM-DD', or ''.
   * @param {any} a */
  function _dayOf(a) {
    return String((a && (a.date || a.dateAssigned || a.assigned_at || a.date_assigned)) || '').slice(0, 10);
  }

  /** The class's assessments in the period: all of them in the year, those
   * dated inside the term in the term (undated work is in no term). Drafts
   * are left out: they take no work.
   * @param {string} cid @param {{ span: string, term: any }} period
   * @returns {any[]} */
  function assessmentsIn(cid, period) {
    return getAssignedAssessments(cid).filter(function (/** @type {any} */ a) {
      if (period.span !== 'term') return true;
      var d = _dayOf(a);
      return !!d && d >= period.term.starts_on && d <= period.term.ends_on;
    });
  }

  /** @param {any} opts */
  function _words(opts) {
    return periodOf(opts).span === 'term' ? 'This Term' : 'This Year';
  }

  /** A level's name (1 to 4), as calc.js names its bands.
   * @param {number} level */
  function levelName(level) {
    return competencyDistribution('', [], {}).bands[level - 1].label;
  }

  /* ── The model ──────────────────────────────────────────────── */
  /** @typedef {{ id: string, name: string, n: number, tagIds: string[], levels: Record<string, number> }} CompRow */

  /** Every competency of the class in the class's order, in the folders the
   * class keeps them in: { folder: name | '', rows } for each, then those
   * outside a folder. A row has how many of the period's assessments carry
   * it and each student's level on it (0 for no mark).
   * @param {any} opts
   * @returns {{ groups: { folder: string, rows: CompRow[] }[], none: { id: string, name: string, tagIds: string[] }[] }} */
  function curricularModel(opts) {
    var cid = String(opts.cid);
    var period = periodOf(opts);
    var students = opts.allStudents || [];
    var ids = students.map(function (/** @type {any} */ s) {
      return s.id;
    });
    var assessed = assessmentsIn(cid, period);
    var read = function () {
      /** @param {any} sec
       * @returns {CompRow} */
      var rowOf = function (sec) {
        var tagIds = (sec.tags || []).map(function (/** @type {any} */ t) {
          return t.id;
        });
        var n = assessed.filter(function (/** @type {any} */ a) {
          return (a.tagIds || []).some(function (/** @type {string} */ t) {
            return tagIds.indexOf(t) >= 0;
          });
        }).length;
        /** @type {Record<string, number>} */
        var levels = {};
        if (n) {
          competencyDistribution(cid, ids, { sectionId: sec.id }).bands.forEach(function (/** @type {any} */ b) {
            b.ids.forEach(function (/** @type {string} */ sid) {
              levels[sid] = b.level;
            });
          });
        }
        return { id: sec.id, name: sec.shortName || sec.name || '', n: n, tagIds: tagIds, levels: levels };
      };
      var grouped = getGroupedSections(cid);
      var buckets = grouped.groups
        .map(function (/** @type {any} */ g) {
          return { folder: String(g.group.name || ''), secs: g.sections };
        })
        .concat([{ folder: '', secs: grouped.ungrouped }]);
      /** @type {{ folder: string, rows: CompRow[] }[]} */
      var groups = [];
      /** @type {{ id: string, name: string, tagIds: string[] }[]} */
      var none = [];
      buckets.forEach(function (b) {
        var rows = [];
        b.secs.forEach(function (/** @type {any} */ sec) {
          var r = rowOf(sec);
          if (r.n) rows.push(r);
          else none.push({ id: r.id, name: r.name, tagIds: r.tagIds });
        });
        if (rows.length) groups.push({ folder: b.folder, rows: rows });
      });
      // A folder's name is a heading only where more than one set of rows has one.
      if (groups.length < 2)
        groups.forEach(function (g) {
          g.folder = '';
        });
      else
        groups.forEach(function (g) {
          if (!g.folder) g.folder = 'Other Competencies';
        });
      return { groups: groups, none: none };
    };
    return period.span === 'term' && typeof readAsOfTerm === 'function'
      ? readAsOfTerm(cid, period.term.ordinal, read)
      : read();
  }

  /** Each Core Competency tagged in the period with how many assessments
   * carry it, the most tagged first; and those not tagged.
   * @param {any} opts
   * @returns {{ rows: { id: string, name: string, n: number }[], none: { id: string, name: string }[] }} */
  function coreModel(opts) {
    var cid = String(opts.cid);
    var assessed = assessmentsIn(cid, periodOf(opts));
    var rows = [];
    var none = [];
    CORE_COMPETENCIES.forEach(function (/** @type {any} */ cc) {
      var n = assessed.filter(function (/** @type {any} */ a) {
        return (a.coreCompetencyIds || []).indexOf(cc.id) >= 0;
      }).length;
      if (n) rows.push({ id: cc.id, name: cc.label, n: n });
      else none.push({ id: cc.id, name: cc.label });
    });
    // Array.sort is stable: ties stay in the Core Competencies' own order.
    rows.sort(function (a, b) {
      return b.n - a.n;
    });
    return { rows: rows, none: none };
  }

  /* ── Drawing ────────────────────────────────────────────────── */
  var CHEVRON =
    '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2 6.5 5 3.5 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /** The sentence an empty page says, or the empty list's line.
   * @param {string} text */
  function _plain(text) {
    return '<p class="dash-comp-plain">' + esc(text) + '</p>';
  }

  /** Counted over: this term's name | Year. Drawn only where the class has a
   * term now.
   * @param {string} page @param {{ span: string, term: any }} period */
  function _spanSwitch(page, period) {
    if (!period.term) return '';
    var pick = function (/** @type {string} */ key, /** @type {string} */ label) {
      var on = period.span === key;
      return (
        '<button type="button" class="seg-btn' +
        (on ? ' active' : '') +
        '" id="dash-comp-span-' +
        page +
        '-' +
        key +
        '" aria-pressed="' +
        on +
        '" data-action="compSpan" data-span="' +
        key +
        '">' +
        esc(label) +
        '</button>'
      );
    };
    return (
      '<div class="seg seg-sm dash-comp-span" role="group" aria-label="Counted over">' +
      pick('term', period.term.label || 'Term') +
      pick('year', 'Year') +
      '</div>'
    );
  }

  /** The line under the title: the period, a link, the column's heading.
   * @param {string} page @param {any} opts @param {{ span: string, term: any }} period
   * @param {string} linkText @param {string} href @param {string} head */
  function _subhead(page, opts, period, linkText, href, head) {
    return (
      '<div class="dash-comp-sub">' +
      _spanSwitch(page, period) +
      '<a class="dash-comp-sub-link" role="link" tabindex="0" data-href="' +
      esc(href) +
      '">' +
      esc(linkText) +
      '</a><span class="dash-comp-colhead">' +
      esc(head) +
      '</span></div>'
    );
  }

  /** The foot's quiet line and the names it opens.
   * @param {string} page @param {string} what "Assessed" or "Tagged"
   * @param {string} words "This Term" or "This Year"
   * @param {string[]} items the names' markup */
  function _quiet(page, what, words, items) {
    if (!items.length) return '';
    var open = !!_naOpen[page];
    var id = 'dash-comp-na-' + page;
    return (
      '<div class="dash-comp-quiet-box">' +
      '<button type="button" class="dash-comp-quiet" id="dash-comp-quiet-' +
      page +
      '" data-comp-na="' +
      page +
      '" aria-expanded="' +
      open +
      '" aria-controls="' +
      id +
      '">' +
      items.length +
      ' Not ' +
      esc(what) +
      ' ' +
      esc(words) +
      CHEVRON +
      '</button><ul class="dash-comp-na" id="' +
      id +
      '"' +
      (open ? '' : ' hidden') +
      '>' +
      items
        .map(function (h) {
          return '<li>' + h + '</li>';
        })
        .join('') +
      '</ul></div>'
    );
  }

  /** One page's list, with the fade that shows while there is more below.
   * @param {string} inner */
  function _listBox(inner) {
    return (
      '<div class="dash-comp-listbox"><div class="dash-comp-list" tabindex="0">' +
      inner +
      '</div><div class="dash-comp-fade" aria-hidden="true"></div></div>'
    );
  }

  /** One student's tick: their level on the competency, the hollow one with
   * no mark. A button named for the student and the level.
   * @param {string} key @param {any} st @param {number} level */
  function _tick(key, st, level) {
    var word = level ? levelName(level) : 'No Mark Yet';
    var open = !!_open && _open.key === key && _open.level === level && _open.sid === st.id;
    return (
      '<button type="button" class="dash-comp-tick' +
      (level ? '' : ' is-none') +
      '" data-comp-tick data-comp-key="' +
      esc(key) +
      '" data-comp-level="' +
      level +
      '" data-comp-sid="' +
      esc(st.id) +
      '"' +
      (level
        ? ' style="background:var(--score-' + level + ')" aria-haspopup="dialog" aria-expanded="' + open + '"'
        : '') +
      ' aria-label="' +
      esc(displayName(st) + ', ' + word) +
      '"></button>'
    );
  }

  /** @param {string} cid @param {CompRow} r @param {any[]} students */
  function _row(cid, r, students) {
    var key = 's:' + r.id;
    // The strongest first, those with no mark last; the class list's order within a level.
    var order = students
      .map(function (/** @type {any} */ st, /** @type {number} */ i) {
        return { st: st, i: i, level: r.levels[st.id] || 0 };
      })
      .sort(function (a, b) {
        return (b.level || 0) - (a.level || 0) || a.i - b.i;
      });
    return (
      '<div class="dash-comp-it" data-comp-sec="' +
      esc(r.id) +
      '"><button type="button" class="dash-comp-it-name" data-comp-go="' +
      esc(DashInsights.gradebookHref(cid, [], { sectionIds: [r.id] })) +
      '">' +
      esc(r.name) +
      '</button><span class="dash-comp-it-n' +
      (r.n === 1 ? ' is-thin' : '') +
      '">' +
      r.n +
      '</span><div class="dash-comp-ticks" role="group" aria-label="' +
      esc(r.name + ': one mark for each student') +
      '">' +
      order
        .map(function (o) {
          return _tick(key, o.st, o.level);
        })
        .join('') +
      '</div></div>'
    );
  }

  /** @param {any} opts */
  function curricularPage(opts) {
    var cid = String(opts.cid);
    var period = periodOf(opts);
    var students = opts.allStudents || [];
    var m = curricularModel(opts);
    var body = '';
    m.groups.forEach(function (g) {
      if (g.folder) body += '<h3 class="dash-comp-fold">' + esc(g.folder) + '</h3>';
      g.rows.forEach(function (r) {
        body += _row(cid, r, students);
      });
    });
    if (!m.groups.length) {
      body += _plain(
        m.none.length
          ? 'Nothing assessed ' + _words(opts).toLowerCase() + ' yet.'
          : 'No competencies in this class yet.',
      );
    }
    var na = m.none.map(function (c) {
      return (
        '<button type="button" class="dash-comp-na-name" data-comp-new="' +
        esc(c.tagIds.join(',')) +
        '">' +
        esc(c.name) +
        '</button>'
      );
    });
    return (
      _subhead('curricular', opts, period, 'Gradebook →', '/gradebook?course=' + cid, 'Assessed') +
      _listBox(body + _quiet('curricular', 'Assessed', _words(opts), na))
    );
  }

  /** @param {any} opts */
  function corePage(opts) {
    var cid = String(opts.cid);
    var period = periodOf(opts);
    var m = coreModel(opts);
    var top = m.rows.length ? m.rows[0].n : 1;
    var body = m.rows
      .map(function (r) {
        return (
          '<div class="dash-comp-it is-core"><span class="dash-comp-it-name">' +
          esc(r.name) +
          '</span><span class="dash-comp-it-n">' +
          r.n +
          '</span><div class="dash-comp-bar" aria-hidden="true"><i style="--n:' +
          r.n +
          ';--top:' +
          top +
          '"></i></div></div>'
        );
      })
      .join('');
    if (!m.rows.length) body = _plain('Nothing is tagged ' + _words(opts).toLowerCase() + ' yet.');
    var na = m.none.map(function (c) {
      return '<span class="dash-comp-na-name">' + esc(c.name) + '</span>';
    });
    return (
      _subhead('core', opts, period, 'Assignments →', '/assignments?course=' + cid, 'Tagged') +
      _listBox(body + _quiet('core', 'Tagged', _words(opts), na))
    );
  }

  /** The tile. opts is what DashOverview.renderOverviewPanel was given,
   * with compPage and compSpan added.
   * @param {any} opts
   * @returns {string} */
  function html(opts) {
    var page = pageOf(opts && opts.compPage);
    var tabs = PAGES.map(function (p) {
      var on = p.key === page;
      return (
        '<button type="button" class="seg-btn' +
        (on ? ' active' : '') +
        '" id="' +
        _tabId(p.key) +
        '" role="tab" aria-selected="' +
        on +
        '" aria-controls="' +
        _pageId(p.key) +
        '" tabindex="' +
        (on ? '0' : '-1') +
        '" data-action="compPage" data-page="' +
        p.key +
        '">' +
        esc(p.label) +
        '</button>'
      );
    }).join('');
    _last = opts;
    var cid = String(opts && opts.cid);
    // A list left open on another visit to the Dashboard is not brought back.
    if (_open && (_open.cid !== cid || !document.getElementById('dash-comp-pop'))) _open = null;
    if (_naCid !== cid) {
      _naCid = cid;
      _naOpen = {};
    }
    /** @type {Record<string, string>} */
    var cards = { curricular: curricularPage(opts), core: corePage(opts) };
    var popInner = _open ? popBody(opts, _open) : '';
    if (!popInner) _open = null;
    _queuePlace();
    var pages = PAGES.map(function (p) {
      var on = p.key === page;
      return (
        '<div class="dash-comp-page' +
        (on ? ' is-on' : '') +
        '" id="' +
        _pageId(p.key) +
        '" role="tabpanel" aria-labelledby="' +
        _tabId(p.key) +
        '">' +
        cards[p.key] +
        '</div>'
      );
    }).join('');
    return (
      '<section class="dash-comp-tile" aria-labelledby="dash-comp-tile-title" data-page="' +
      page +
      '">' +
      '<div class="dash-comp-tile-head">' +
      '<h2 class="dash-comp-tile-title" id="dash-comp-tile-title">Competencies</h2>' +
      '<div class="seg seg-sm dash-comp-seg" role="tablist" aria-label="Competencies">' +
      tabs +
      '</div>' +
      '</div>' +
      '<div class="dash-comp-pages"><div class="dash-comp-track">' +
      pages +
      '</div></div>' +
      '</section>' +
      // Outside the tile, which clips: the list is placed on the window (place).
      '<div class="dash-comp-pop" id="dash-comp-pop" role="dialog" aria-label="Students"' +
      (popInner ? '' : ' hidden') +
      '>' +
      popInner +
      '</div>'
    );
  }

  /** Shows a page in the tile already on screen: the track slides (CSS, 220
   * ms, none under Reduce Motion) and the segmented control moves its pill.
   * No redraw, so nothing else on the Dashboard is touched. Returns the
   * chosen tab, or null when there is no tile.
   * @param {ParentNode} root
   * @param {string} page
   * @returns {HTMLElement | null} */
  function show(root, page) {
    var tile = /** @type {HTMLElement | null} */ (root.querySelector('.dash-comp-tile'));
    if (!tile) return null;
    var key = pageOf(page);
    tile.setAttribute('data-page', key);
    Array.prototype.forEach.call(tile.querySelectorAll('.dash-comp-page'), function (/** @type {HTMLElement} */ el) {
      el.classList.toggle('is-on', el.id === _pageId(key));
    });
    var tab = /** @type {HTMLElement | null} */ (tile.querySelector('#' + _tabId(key)));
    if (!tab) return null;
    if (typeof segSelect === 'function') segSelect(tab);
    Array.prototype.forEach.call(
      tile.querySelectorAll('.dash-comp-seg [role="tab"]'),
      function (/** @type {Element} */ t) {
        t.setAttribute('tabindex', t === tab ? '0' : '-1');
      },
    );
    fit();
    return tab;
  }

  /* ── State: the one open list, and the open "Not Assessed" lines ── */
  /** The tick whose list of students is open, kept here so a redraw loses nothing.
   * @type {{ cid: string, key: string, level: number, sid: string } | null} */
  var _open = null;
  /** What the last draw was given: the list is drawn from it without a redraw.
   * @type {any} */
  var _last = null;
  /** Where focus was when the page was last drawn, to put it back after.
   * @type {{ pop?: boolean, sid?: string, key?: string } | null} */
  var _refocus = null;
  /** The pages whose quiet line is open, for the class last drawn.
   * @type {Record<string, boolean>} */
  var _naOpen = {};
  var _naCid = '';

  /** @param {string} id */
  function _el(id) {
    return document.getElementById(id);
  }

  /* ── The list of students at one level ──────────────────────── */
  /** The students at the tick's level on its competency with their shared
   * next step: what the old Level Mix bar's segment opened. '' when the
   * level is gone (another term, a removed score).
   * @param {any} opts @param {{ key: string, level: number }} open */
  function popBody(opts, open) {
    var cid = String(opts.cid);
    var period = periodOf(opts);
    var read = function () {
      return DashInsights.popHtml(cid, opts.allStudents || [], { key: open.key, level: open.level });
    };
    return period.span === 'term' && typeof readAsOfTerm === 'function'
      ? readAsOfTerm(cid, period.term.ordinal, read)
      : read();
  }

  /** @param {string} sid @param {string} key
   * @returns {HTMLElement | null} */
  function _tickFor(sid, key) {
    var ticks = document.querySelectorAll('[data-comp-tick]');
    for (var i = 0; i < ticks.length; i++) {
      var b = /** @type {HTMLElement} */ (ticks[i]);
      if (b.dataset.compSid === sid && b.dataset.compKey === key) return b;
    }
    return null;
  }

  /** What opened the list. */
  function _opener() {
    return _open ? _tickFor(_open.sid, _open.key) : null;
  }

  /** Puts the open list under its tick, inside the window: below it, or
   * above it when there is no room, and never past the window's edges. The
   * list sits outside the tile, which clips, and on the window (fixed). */
  function place() {
    var pop = _el('dash-comp-pop');
    if (!pop || pop.hidden || !_open) return;
    var tick = _opener();
    if (!tick) {
      pop.hidden = true;
      return;
    }
    if (typeof tick.getBoundingClientRect !== 'function') return;
    var r = tick.getBoundingClientRect();
    // Never under the app's top bar (z-index 1000, over this list), and never
    // taller than the room below it: the middle of the list scrolls.
    var dock = _el('dock-mount');
    var minTop = Math.max(8, (dock ? dock.getBoundingClientRect().bottom : 0) + 8);
    var maxBottom = window.innerHeight - 8;
    pop.style.maxHeight = Math.max(120, maxBottom - minTop) + 'px';
    var pw = pop.offsetWidth;
    var ph = pop.offsetHeight;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
    var top;
    if (r.bottom + 6 + ph <= maxBottom) top = r.bottom + 6;
    else if (r.top - 6 - ph >= minTop) top = r.top - 6 - ph;
    else {
      // No room above or below: beside the tile, so the tick stays in view.
      var tile = tick.closest('.dash-comp-tile');
      var t = tile ? tile.getBoundingClientRect() : r;
      if (t.left - 8 - pw >= 8) left = t.left - 8 - pw;
      else if (t.right + 8 + pw <= window.innerWidth - 8) left = t.right + 8;
      top = r.top;
    }
    top = Math.max(minTop, Math.min(top, maxBottom - ph));
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  }

  /* ── The tile's room ────────────────────────────────────────
     The fade at the foot of a list shows only while there is more below. Run
     after each draw, on scroll and whenever the tile changes size. */
  /** @type {ResizeObserver | null} */
  var _fitWatch = null;

  /** @param {Element} list */
  function _syncFade(list) {
    var box = list.parentElement;
    if (!box) return;
    var more = list.scrollTop + list.clientHeight < list.scrollHeight - 2;
    box.classList.toggle('has-more', more);
  }

  function fit() {
    var tile = /** @type {HTMLElement | null} */ (document.querySelector('.dash-comp-tile'));
    if (!tile || typeof tile.getBoundingClientRect !== 'function') return;
    Array.prototype.forEach.call(tile.querySelectorAll('.dash-comp-list'), _syncFade);
    if (_fitWatch || typeof ResizeObserver === 'undefined') return;
    var was = { w: 0, h: 0 };
    _fitWatch = new ResizeObserver(function () {
      var t = /** @type {HTMLElement | null} */ (document.querySelector('.dash-comp-tile'));
      if (!t || !t.isConnected) return;
      var r = t.getBoundingClientRect();
      if (Math.abs(r.width - was.w) < 0.5 && Math.abs(r.height - was.h) < 0.5) return;
      was = { w: r.width, h: r.height };
      fit();
    });
    _fitWatch.observe(tile);
  }

  /** After a draw: place the list, and put focus back where it was. */
  function _queuePlace() {
    var a = document.activeElement;
    _refocus = null;
    if (a && a.closest) {
      if (a.closest('#dash-comp-pop')) _refocus = { pop: true };
      else {
        var t = /** @type {HTMLElement | null} */ (a.closest('[data-comp-tick]'));
        if (t) _refocus = { sid: t.dataset.compSid, key: t.dataset.compKey };
      }
    }
    var run = function () {
      // A new draw is a new tile: watch that one.
      if (_fitWatch) _fitWatch.disconnect();
      _fitWatch = null;
      fit();
      place();
      var want = _refocus;
      _refocus = null;
      var cur = document.activeElement;
      if (want && (!cur || cur === document.body)) {
        var t = want.pop
          ? document.querySelector('#dash-comp-pop [data-comp-first], #dash-comp-pop a, #dash-comp-pop button')
          : _tickFor(String(want.sid), String(want.key));
        if (t) /** @type {HTMLElement} */ (t).focus();
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  /** Draws the open list (or hides it) without redrawing the page. */
  function _refresh() {
    var pop = _el('dash-comp-pop');
    if (!pop) return;
    var inner = _open && _last ? popBody(_last, _open) : '';
    if (!inner) _open = null;
    // html-safe: popHtml escapes every name, title and label; the rest is a count.
    pop.innerHTML = inner;
    pop.hidden = !inner;
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-comp-tick][aria-haspopup]'),
      function (/** @type {HTMLElement} */ b) {
        b.setAttribute(
          'aria-expanded',
          String(
            !!_open &&
              _open.key === b.dataset.compKey &&
              _open.sid === b.dataset.compSid &&
              _open.level === Number(b.dataset.compLevel),
          ),
        );
      },
    );
    place();
  }

  /** Closes the list; with `refocus`, focus goes back to its tick.
   * @param {boolean} refocus */
  function close(refocus) {
    if (!_open) return;
    var tick = _opener();
    _open = null;
    _refresh();
    if (refocus && tick) tick.focus();
  }

  /** A tick: with a level, that level's students and their shared next step
   * (one list at a time; the same tick again closes it); with no mark, the
   * student's page.
   * @param {HTMLElement} tick */
  function _toggleTick(tick) {
    var key = String(tick.dataset.compKey);
    var level = Number(tick.dataset.compLevel);
    var sid = String(tick.dataset.compSid);
    if (!level) {
      _go(
        '/student?id=' +
          encodeURIComponent(sid) +
          '&course=' +
          encodeURIComponent(String(_last && _last.cid)) +
          '&tab=comps',
      );
      return;
    }
    if (_open && _open.key === key && _open.level === level && _open.sid === sid) {
      close(true);
      return;
    }
    if (!_last) return;
    _open = { cid: String(_last.cid), key: key, level: level, sid: sid };
    _refresh();
    var first = document.querySelector('#dash-comp-pop a, #dash-comp-pop button');
    if (first) /** @type {HTMLElement} */ (first).focus();
  }

  /** Goes to a page of the app, as a link does.
   * @param {string} href */
  function _go(href) {
    var url = new URL(href, location.href);
    var router = /** @type {any} */ (window).Router;
    if (router && router.isRoute(url.pathname)) router.navigate(url.pathname + url.search);
    else location.assign(url.href);
  }

  /** Opens or closes a page's quiet line.
   * @param {HTMLElement} btn */
  function _toggleNa(btn) {
    var page = String(btn.dataset.compNa);
    var open = btn.getAttribute('aria-expanded') !== 'true';
    _naOpen[page] = open;
    btn.setAttribute('aria-expanded', String(open));
    var list = document.getElementById('dash-comp-na-' + page);
    if (list) list.hidden = !open;
    var scroller = btn.closest('.dash-comp-list');
    if (open && scroller) scroller.scrollTop = scroller.scrollHeight;
    if (scroller) _syncFade(scroller);
  }

  document.addEventListener('click', function (e) {
    var t = /** @type {Element | null} */ (e.target);
    if (!t || !t.closest) return;
    var tick = /** @type {HTMLElement | null} */ (t.closest('[data-comp-tick]'));
    if (tick) {
      _toggleTick(tick);
      return;
    }
    var go = /** @type {HTMLElement | null} */ (t.closest('[data-comp-go]'));
    if (go) {
      _go(String(go.dataset.compGo));
      return;
    }
    var nu = /** @type {HTMLElement | null} */ (t.closest('[data-comp-new]'));
    if (nu && _last) {
      _go(
        '/assignments?course=' +
          encodeURIComponent(String(_last.cid)) +
          '&new=1&tags=' +
          encodeURIComponent(String(nu.dataset.compNew)),
      );
      return;
    }
    var na = /** @type {HTMLElement | null} */ (t.closest('[data-comp-na]'));
    if (na) {
      _toggleNa(na);
      return;
    }
    if (t.closest('[data-comp-close]')) {
      close(true);
      return;
    }
    // A link in the list leaves the page; a click anywhere else outside closes it.
    if (_open && !t.closest('#dash-comp-pop')) close(false);
    else if (_open && t.closest('#dash-comp-pop a')) _open = null;
  });

  // Escape closes the list before the page can use it to clear the filter.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !_open) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close(true);
  });

  // Focus does not wander out of the open list: Tab past its last control, or
  // Shift+Tab before its first, closes it and puts focus back on its tick.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !_open) return;
    var pop = _el('dash-comp-pop');
    var t = /** @type {Element | null} */ (e.target);
    if (!pop || !t || !pop.contains(t)) return;
    var items = pop.querySelectorAll('button, a[href], a[tabindex], [tabindex="0"]');
    var first = items[0];
    var last = items[items.length - 1];
    if ((e.shiftKey && t === first) || (!e.shiftKey && t === last)) {
      e.preventDefault();
      close(true);
    }
  });

  window.addEventListener('resize', place);
  document.addEventListener(
    'scroll',
    function (e) {
      var tgt = /** @type {Element | null} */ (e.target instanceof Element ? e.target : null);
      if (tgt && tgt.classList && tgt.classList.contains('dash-comp-list')) {
        _syncFade(tgt);
        return;
      }
      var pop = _el('dash-comp-pop');
      if (_open && !(pop && e.target instanceof Node && pop.contains(e.target))) place();
    },
    true,
  );

  return {
    PREF_KEY: PREF_KEY,
    SPAN_KEY: SPAN_KEY,
    PAGES: PAGES,
    pageOf: pageOf,
    spanOf: spanOf,
    pageForKey: pageForKey,
    periodOf: periodOf,
    html: html,
    show: show,
    close: close,
    place: place,
    fit: fit,
    toggleTick: _toggleTick,
  };
})();
