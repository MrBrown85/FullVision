// @ts-check
/* dash-competencies.js — the Dashboard's one Competencies tile (D2 of
   docs/plans/dashboard-inbox-plan.md). A tile titled Competencies with a
   segmented control, Curricular | Core, over two pages that slide sideways.
   Each page is today's card, drawn by DashOverview (competenciesCardHtml and
   coreCardHtml) with its own view menu; only the housing is new. The page
   shown is kept per class on the device by page-dashboard.js, which reads
   and writes it through its _readPref and _writePref and hands it to html()
   as opts.compPage. Nothing here holds state: the Dashboard redraws as one
   string, so the open page is always read from that choice.

   D3 draws the two pages for the tile's one-third width. Curricular opens on
   Level Mix: one row per competency, one stacked bar in the top bar's solid
   level colours, "21 of 27" under "Proficient or Above". Core opens on
   Self-Assessment: the same, in the self-assessment blues, under
   "Self-Assessed". A row is a button; a click opens a small list in place
   (the one thing this module does hold: which row is open, so a redraw
   keeps it). The other views are today's cards, drawn by DashOverview. */
window.DashCompetencies = (function () {
  'use strict';

  var PREF_KEY = 'fv-dash-comp-page:';
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

  /** The tile. opts is what DashOverview.renderOverviewPanel was given,
   * with compPage added.
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
    _tipRow = null;
    var cid = String(opts && opts.cid);
    var curView = curricularView(opts);
    var coreSelfOn = DashOverview.coreView(opts) === 'self';
    // A list left open on another visit to the Dashboard is not brought back.
    if (_open && !document.getElementById('dash-comp-pop')) _open = null;
    // The open row is kept only while its page still shows rows.
    if (_open && (_open.cid !== cid || (_open.page === 'curricular' ? curView !== 'mix' : !coreSelfOn))) _open = null;
    /** @type {Record<string, string>} */
    var cards = {
      curricular: curricularCard(opts, curView),
      core: coreSelfOn ? coreSelfCard(opts) : DashOverview.coreCardHtml(opts),
    };
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
      '</div>' +
      '<div class="dash-comp-tipbox" id="dash-comp-tipbox" role="tooltip" hidden></div>'
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
    return tab;
  }

  /* ── State: the one open row ───────────────────────────────── */
  /** The row whose list is open, kept here so a redraw loses nothing.
   * @type {{ cid: string, page: string, key: string, level?: number } | null} */
  var _open = null;
  /** What the last draw was given: the list is drawn from it without a redraw.
   * @type {any} */
  var _last = null;
  /** Where focus was when the page was last drawn, to put it back after.
   * @type {{ pop?: boolean, key?: string, page?: string, level?: number } | null} */
  var _refocus = null;

  /** @param {string} id */
  function _el(id) {
    return document.getElementById(id);
  }

  /** The Curricular page's view: the teacher's saved pick, else Level Mix in
   * every grading style (Colin, Nov 18 2026).
   * @param {any} opts
   * @returns {string} */
  function curricularView(opts) {
    return DashOverview.compView(opts.cid, opts.compView);
  }

  /** A level's name (1 to 4), as calc.js names its bands.
   * @param {number} level */
  function levelName(level) {
    return competencyDistribution('', [], {}).bands[level - 1].label;
  }

  /** The counts one competency's bar and number are made of, as
   * competencyDistribution bands them: no level is worked out here.
   * @param {any} dist
   * @returns {{ counts: number[], scored: number, above: number }} */
  function mixCounts(dist) {
    var counts = dist.bands.map(function (/** @type {any} */ b) {
      return b.ids.length;
    });
    var scored = counts.reduce(function (/** @type {number} */ a, /** @type {number} */ b) {
      return a + b;
    }, 0);
    return { counts: counts, scored: scored, above: counts[2] + counts[3] };
  }

  /** The one competency with the fewest at Proficient or above, or '' when
   * two or more share the fewest, when fewer than two are scored on by
   * anyone, or when no one is scored. A competency nobody is scored on never
   * counts.
   * @param {{ key: string, scored: number, above: number }[]} rows
   * @returns {string} */
  function lowestKey(rows) {
    var scored = rows.filter(function (r) {
      return r.scored > 0;
    });
    if (scored.length < 2) return '';
    var min = Math.min.apply(
      null,
      scored.map(function (r) {
        return r.above;
      }),
    );
    var at = scored.filter(function (r) {
      return r.above === min;
    });
    return at.length === 1 ? at[0].key : '';
  }

  /** Whether a Self-Assessed count is low: under two thirds of the class.
   * This is the test the Core card's squares made before D9 (amber under two
   * thirds), said here as a word.
   * @param {number} k
   * @param {number} n */
  function isFew(k, n) {
    return n > 0 && k * 3 < n * 2;
  }

  /** @param {string} label @param {string} cls */
  function _legendItem(label, cls) {
    return '<span><i class="' + cls + '"></i>' + esc(label) + '</span>';
  }

  /** @param {string} legend @param {string} head @param {string} rows @param {string} label */
  function _linesBody(legend, head, rows, label) {
    return (
      '<div class="dash-comp-body dash-comp-lines-body">' +
      '<div class="dash-comp-legend">' +
      legend +
      '</div>' +
      '<div class="dash-comp-colhead"><span>Competency</span><span>' +
      esc(head) +
      '</span></div>' +
      '<div class="dash-comp-lines" aria-label="' +
      esc(label) +
      '">' +
      rows +
      '</div></div>'
    );
  }

  /** One row: a button with its name, number and one bar. `tag` is the word
   * beside the number (Lowest, Only); `bar` the stacked segments. A Level
   * Mix row (`segs`) is split: the button holds the name and number, and the
   * bar under it is made of one button per level, as today's Level Mix had
   * one per count; each opens that level's students with their shared next
   * step. A competency nobody is scored on has a grey bar with no buttons.
   * @param {{ key: string, page: string, name: string, num: string, tag: string, label: string, tip: string, bar: string, picked: boolean, open: boolean, counts?: string, segs?: { level: number, n: number, label: string, open: boolean }[] }} r */
  function _line(r) {
    if (!r.segs) return _lineButton(r);
    var segs = r.segs.length
      ? r.segs
          .map(function (g) {
            return (
              '<button type="button" class="dash-comp-ln-seg" data-comp-level="' +
              g.level +
              '" data-comp-key="' +
              esc(r.key) +
              '" style="flex:' +
              g.n +
              ';background:var(--score-' +
              g.level +
              ')" aria-haspopup="dialog" aria-expanded="' +
              g.open +
              '" aria-label="' +
              esc(g.label) +
              '"></button>'
            );
          })
          .join('')
      : '<i class="is-none" style="flex:1"></i>';
    return (
      '<div class="dash-comp-lnbox' +
      (r.tag ? ' is-flag' : '') +
      '">' +
      _lineButton(Object.assign({}, r, { bar: '' }), true) +
      '<div class="dash-comp-ln-bar dash-comp-ln-segs" role="group" aria-label="' +
      esc(r.name + ', by level') +
      '">' +
      segs +
      '</div>' +
      _countsHtml(r) +
      '</div>'
    );
  }

  /** The quiet line of counts under a row's bar, shown where the row has the
   * room (DashCompetencies.fit). Its words are the row's accessible name's.
   * @param {{ counts?: string }} r */
  function _countsHtml(r) {
    return r.counts ? '<span class="dash-comp-ln-counts" aria-hidden="true">' + esc(r.counts) + '</span>' : '';
  }

  /** @param {{ key: string, page: string, name: string, num: string, tag: string, label: string, tip: string, bar: string, picked: boolean, open: boolean, counts?: string }} r
   * @param {boolean} [split] the bar is drawn under the button, not in it */
  function _lineButton(r, split) {
    return (
      '<button type="button" class="dash-comp-ln' +
      (split ? ' is-split' : '') +
      (r.tag ? ' is-flag' : '') +
      (r.tag === 'Lowest' ? ' is-low' : '') +
      (r.picked ? ' is-picked' : '') +
      '" data-comp-open="' +
      esc(r.key) +
      '" data-comp-page="' +
      r.page +
      '" aria-haspopup="dialog" aria-expanded="' +
      r.open +
      '" aria-label="' +
      esc(r.label) +
      '"><span class="dash-comp-ln-name">' +
      esc(r.name) +
      '</span><span class="dash-comp-ln-num' +
      (r.tag === 'Only' ? ' is-few' : '') +
      '">' +
      // As board D draws them: "Lowest" a red label beside the number, and a
      // low Self-Assessed count said as "Only 13 of 27" in amber.
      (r.tag === 'Only'
        ? '<span class="dash-comp-ln-few">Only</span> '
        : r.tag
          ? '<span class="dash-comp-ln-tag">' + esc(r.tag) + '</span>'
          : '') +
      esc(r.num) +
      '</span>' +
      (split ? '' : '<span class="dash-comp-ln-bar" aria-hidden="true">' + r.bar + '</span>' + _countsHtml(r)) +
      '<span class="dash-comp-ln-tip" aria-hidden="true">' +
      esc(r.tip) +
      '</span></button>'
    );
  }

  /** The Curricular page's card. Level Mix is drawn here; every other view
   * is today's card.
   * @param {any} opts @param {string} view */
  function curricularCard(opts, view) {
    var o = Object.assign({}, opts, { compView: view });
    var card = DashOverview.competenciesCardHtml(o);
    if (view !== 'mix') return card;
    var cid = opts.cid;
    var cols = DashInsights.columns(cid);
    var at = card.indexOf('<div class="dash-comp-body">');
    if (!cols.length || at < 0) return card;
    var ids = (opts.allStudents || []).map(function (/** @type {any} */ s) {
      return s.id;
    });
    var model = cols.map(function (/** @type {any} */ col) {
      var m = mixCounts(competencyDistribution(cid, ids, col.which));
      return { col: col, key: col.key, counts: m.counts, scored: m.scored, above: m.above };
    });
    var low = lowestKey(model);
    // The class's own level order, as today's Level Mix draws it.
    var order = levelOrderFor(cid);
    var rows = model
      .map(function (m) {
        var names = m.counts
          .map(function (/** @type {number} */ n, /** @type {number} */ i) {
            return levelName(i + 1) + ' ' + n;
          })
          .join(' · ');
        var bar = m.scored
          ? order
              .map(function (/** @type {number} */ l) {
                var n = m.counts[l - 1];
                return n ? '<i style="flex:' + n + ';background:var(--score-' + l + ')"></i>' : '';
              })
              .join('')
          : '<i class="is-none" style="flex:1"></i>';
        var label = m.scored
          ? m.col.title +
            ': ' +
            m.above +
            ' of ' +
            m.scored +
            ' Proficient or above' +
            (m.key === low ? ', the lowest' : '') +
            '. ' +
            names.replace(/ · /g, ', ')
          : m.col.title + ': not scored yet';
        return _line({
          key: m.key,
          page: 'curricular',
          name: m.col.label,
          num: m.scored ? m.above + ' of ' + m.scored : '—',
          tag: m.key === low ? 'Lowest' : '',
          label: label,
          tip: m.scored ? names : 'Not scored yet',
          // competencyDistribution's own counts and band names, in level order.
          counts: m.scored
            ? [1, 2, 3, 4]
                .map(function (l) {
                  return m.counts[l - 1] + ' ' + levelName(l);
                })
                .join(' · ')
            : '',
          bar: bar,
          picked: opts.naComp === m.key,
          open: !!_open && _open.page === 'curricular' && _open.key === m.key && !_open.level,
          segs: m.scored
            ? order
                .filter(function (/** @type {number} */ l) {
                  return m.counts[l - 1] > 0;
                })
                .map(function (/** @type {number} */ l) {
                  return {
                    level: l,
                    n: m.counts[l - 1],
                    label: m.col.title + ': ' + m.counts[l - 1] + ' ' + levelName(l),
                    open: !!_open && _open.page === 'curricular' && _open.key === m.key && _open.level === l,
                  };
                })
            : [],
        });
      })
      .join('');
    var legend = order
      .map(function (/** @type {number} */ l) {
        return _legendItem(levelName(l), 'dash-comp-sw-' + l);
      })
      .join('');
    return (
      card.slice(0, at) + _linesBody(legend, 'Proficient or Above', rows, 'Curricular competencies') + '</section>'
    );
  }

  /** Each Core Competency with the students at each self-assessed step.
   * @param {any} opts */
  function coreModel(opts) {
    var students =
      typeof sortStudents === 'function' ? sortStudents(opts.allStudents || [], 'lastName') : opts.allStudents || [];
    return CORE_COMPETENCIES.map(function (/** @type {any} */ cc) {
      var ratings = (opts.coreSelf && opts.coreSelf.byCore && opts.coreSelf.byCore[cc.id]) || {};
      /** @type {Record<number, any[]>} */
      var by = { 1: [], 2: [], 3: [], 4: [] };
      /** @type {any[]} */
      var notYet = [];
      students.forEach(function (/** @type {any} */ s) {
        var lv = ratings[s.id];
        if (by[lv]) by[lv].push(s);
        else notYet.push(s);
      });
      var n = students.length;
      return { cc: cc, by: by, notYet: notYet, n: n, k: n - notYet.length };
    });
  }

  /** The Core page's Self-Assessment card, in the blues.
   * @param {any} opts */
  function coreSelfCard(opts) {
    var card = DashOverview.coreCardHtml(opts);
    var at = card.indexOf('<div class="dash-core-list ');
    if (at < 0) return card;
    var rows = coreModel(opts)
      .map(function (m) {
        var counts = [1, 2, 3, 4]
          .map(function (lv) {
            return CONFIDENCE_LABELS[lv] + ' ' + m.by[lv].length;
          })
          .concat(['Not yet ' + m.notYet.length]);
        var few = isFew(m.k, m.n);
        var bar = [1, 2, 3, 4]
          .map(function (lv) {
            return m.by[lv].length
              ? '<i class="dash-comp-st-' + lv + '" style="flex:' + m.by[lv].length + '"></i>'
              : '';
          })
          .join('');
        if (m.notYet.length) bar += '<i class="is-none" style="flex:' + m.notYet.length + '"></i>';
        return _line({
          key: m.cc.id,
          page: 'core',
          name: m.cc.label,
          num: m.k + ' of ' + m.n,
          tag: few ? 'Only' : '',
          label: m.cc.label + ': ' + (few ? 'only ' : '') + m.k + ' of ' + m.n + ' self-assessed. ' + counts.join(', '),
          tip: counts.join(' · '),
          counts: [1, 2, 3, 4]
            .map(function (lv) {
              return m.by[lv].length + ' ' + CONFIDENCE_LABELS[lv];
            })
            .concat(m.notYet.length ? [m.notYet.length + ' Not Yet'] : [])
            .join(' · '),
          bar: bar,
          picked: false,
          open: !!_open && _open.page === 'core' && _open.key === m.cc.id,
        });
      })
      .join('');
    var legend = [1, 2, 3, 4]
      .map(function (lv) {
        return _legendItem(CONFIDENCE_LABELS[lv], 'dash-comp-st-' + lv);
      })
      .join('');
    return card.slice(0, at) + _linesBody(legend, 'Self-Assessed', rows, 'Core competencies') + '</section>';
  }

  /* ── The row's list ─────────────────────────────────────────── */
  /** The band's shared next step and its people chips, as DashInsights.popHtml
   * draws them for today's Level Mix (each name and its level, the way the
   * class shows grades). The next step is the line today's Level Mix list
   * gives a band; it is kept here so turning the row on loses nothing.
   * @param {any} opts @param {string} key @param {number} level */
  function _bandPeople(opts, key, level) {
    var h = DashInsights.popHtml(opts.cid, opts.allStudents || [], { key: key, level: level });
    var next = /<div class="dash-mix-pop-next">[\s\S]*?<\/div>/.exec(h);
    var m = /<div class="dash-ins-people">[\s\S]*?<\/div>/.exec(h);
    return (next ? next[0] : '') + (m ? m[0] : '');
  }

  /** @param {string} title */
  function _popHead(title) {
    return (
      '<div class="dash-mix-pop-head"><span>' +
      esc(title) +
      '</span><button type="button" class="dash-mix-pop-close" data-comp-close aria-label="Close">×</button></div>'
    );
  }

  /** The list for the open row, or '' when its row is gone.
   * @param {any} opts @param {{ page: string, key: string, level?: number }} open */
  function popBody(opts, open) {
    if (open.page === 'core') return _corePop(opts, open.key);
    // One level's students, with its shared next step: today's Level Mix list.
    if (open.level) return DashInsights.popHtml(opts.cid, opts.allStudents || [], { key: open.key, level: open.level });
    var cid = opts.cid;
    var col = DashInsights.columns(cid).find(function (/** @type {any} */ c) {
      return c.key === open.key;
    });
    if (!col) return '';
    var ids = (opts.allStudents || []).map(function (/** @type {any} */ s) {
      return s.id;
    });
    var m = mixCounts(competencyDistribution(cid, ids, col.which));
    var below = m.counts[0] + m.counts[1];
    var parts = [1, 2]
      .filter(function (l) {
        return m.counts[l - 1] > 0;
      })
      .map(function (l) {
        return m.counts[l - 1] + ' ' + levelName(l);
      });
    var summary = !m.scored
      ? 'No one is scored on this yet.'
      : below
        ? below + ' below ' + levelName(3) + ': ' + parts.join(', ')
        : 'No one is below ' + levelName(3) + '.';
    var groups = [1, 2]
      .map(function (l) {
        if (!m.counts[l - 1]) return '';
        return (
          '<div class="dash-comp-pop-level"><span>' +
          esc(levelName(l) + ' · ' + m.counts[l - 1]) +
          '</span>' +
          _bandPeople(opts, open.key, l) +
          '</div>'
        );
      })
      .join('');
    var show = '';
    if (below) {
      var label = 'Show These ' + below + ' in Student Cards ↓';
      show =
        '<button type="button" class="dash-comp-pop-act" data-comp-first data-comp-scroll' +
        (opts.naComp === open.key ? '' : ' data-action="naComp" data-key="' + esc(open.key) + '"') +
        '>' +
        esc(label) +
        '</button>';
    }
    return (
      _popHead(col.title) +
      '<div class="dash-comp-pop-sum">' +
      esc(summary) +
      '</div>' +
      (groups ? '<div class="dash-comp-pop-people">' + groups + '</div>' : '') +
      '<div class="dash-comp-pop-links">' +
      show +
      '<a class="dash-ins-link" role="link" tabindex="0"' +
      (show ? '' : ' data-comp-first') +
      ' data-href="' +
      esc(DashInsights.gradebookHref(cid, [], col)) +
      '">Open in Gradebook →</a></div>'
    );
  }

  /** @param {any} opts @param {string} id */
  function _corePop(opts, id) {
    var found = coreModel(opts).find(function (x) {
      return x.cc.id === id;
    });
    if (!found) return '';
    var m = found;
    var counts = [1, 2, 3, 4]
      .map(function (lv) {
        return CONFIDENCE_LABELS[lv] + ' ' + m.by[lv].length;
      })
      .concat(['Not yet ' + m.notYet.length])
      .join(' · ');
    /** @param {string} title @param {any[]} list */
    var group = function (title, list) {
      if (!list.length) return '';
      return (
        '<div class="dash-comp-pop-level"><span>' +
        esc(title + ' · ' + list.length) +
        '</span><div class="dash-ins-people">' +
        list
          .map(function (s) {
            return '<span class="dash-comp-pop-name">' + esc(displayName(s)) + '</span>';
          })
          .join('') +
        '</div></div>'
      );
    };
    var people = [1, 2, 3, 4]
      .map(function (lv) {
        return group(CONFIDENCE_LABELS[lv], m.by[lv]);
      })
      .join('');
    people += group('Not Yet', m.notYet);
    return (
      _popHead(m.cc.label + ' · ' + m.cc.group) +
      '<div class="dash-comp-pop-sum">' +
      esc(counts) +
      '</div>' +
      '<div class="dash-comp-pop-people">' +
      people +
      '</div>' +
      '<div class="dash-comp-pop-links">' +
      (m.notYet.length
        ? '<a class="dash-ins-link" role="link" tabindex="0" data-comp-first data-href="' +
          esc('/dashboard?course=' + opts.cid + '&manage=questionnaires') +
          '">Open the Questionnaire →</a>'
        : '<button type="button" class="dash-comp-pop-act" data-comp-first data-comp-close>Close</button>') +
      '</div>'
    );
  }

  /** @param {string} key @param {string} page
   * @returns {HTMLElement | null} */
  function _rowFor(key, page) {
    var rows = document.querySelectorAll('[data-comp-open]');
    for (var i = 0; i < rows.length; i++) {
      var r = /** @type {HTMLElement} */ (rows[i]);
      if (r.dataset.compOpen === key && r.dataset.compPage === page) return r;
    }
    return null;
  }

  /** A Level Mix row's button for one level.
   * @param {string} key @param {number} level
   * @returns {HTMLElement | null} */
  function _segFor(key, level) {
    var segs = document.querySelectorAll('[data-comp-level]');
    for (var i = 0; i < segs.length; i++) {
      var b = /** @type {HTMLElement} */ (segs[i]);
      if (b.dataset.compKey === key && Number(b.dataset.compLevel) === level) return b;
    }
    return null;
  }

  /** What opened the list: a level's button, else the row. */
  function _opener() {
    if (!_open) return null;
    return (_open.level && _segFor(_open.key, _open.level)) || _rowFor(_open.key, _open.page);
  }

  /** Puts the open list under its row, inside the window: below the row, or
   * above it when there is no room, and never past the window's edges. The
   * list sits outside the tile, which clips, and on the window (fixed). */
  function place() {
    var pop = _el('dash-comp-pop');
    if (!pop || pop.hidden || !_open) return;
    var row = _rowFor(_open.key, _open.page);
    if (!row) {
      pop.hidden = true;
      return;
    }
    if (typeof row.getBoundingClientRect !== 'function') return;
    var r = row.getBoundingClientRect();
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
      // No room above or below: beside the tile, so the row stays in view.
      var tile = row.closest('.dash-comp-tile');
      var t = tile ? tile.getBoundingClientRect() : r;
      if (t.left - 8 - pw >= 8) left = t.left - 8 - pw;
      else if (t.right + 8 + pw <= window.innerWidth - 8) left = t.right + 8;
      top = r.top;
    }
    top = Math.max(minTop, Math.min(top, maxBottom - ph));
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  }

  /* ── The tile's room (review of #1603) ─────────────────────
     A tall tile gives each row more to say, not more air: above TALL px the
     bar and name grow (is-tall), and a page whose rows have COUNTS_ROW px
     each shows their counts line (has-counts). Needs Support shows as many
     students as fit at SUPPORT_ROW px each, and "+N more" says how many
     it leaves out, only when it leaves some out. Run after each draw and
     whenever the tile changes size. */
  var TALL = 600;
  var COUNTS_ROW = 64;
  var SUPPORT_ROW = 36;
  /** @type {ResizeObserver | null} */
  var _fitWatch = null;

  /** @param {HTMLElement} pageEl */
  function _fitSupport(pageEl) {
    var list = /** @type {HTMLElement | null} */ (pageEl.querySelector('.dash-comp-rows:not(.is-scroll)'));
    if (!list) return;
    var rows = /** @type {HTMLElement[]} */ (
      Array.prototype.slice.call(list.querySelectorAll('.dash-comp-row.is-student'))
    );
    var more = /** @type {HTMLElement | null} */ (list.querySelector('.dash-comp-more'));
    if (!rows.length) return;
    rows.forEach(function (r) {
      r.classList.add('is-extra');
    });
    if (more) more.hidden = true;
    var room = list.clientHeight;
    var show = Math.floor(room / SUPPORT_ROW);
    if (show < rows.length && more) {
      more.hidden = false;
      show = Math.floor((room - more.offsetHeight) / SUPPORT_ROW);
    }
    show = Math.max(1, Math.min(rows.length, show));
    rows.forEach(function (r, i) {
      r.classList.toggle('is-extra', i >= show);
    });
    if (more) {
      more.hidden = show >= rows.length;
      more.textContent = '+' + (rows.length - show) + ' more';
    }
  }

  function fit() {
    var tile = /** @type {HTMLElement | null} */ (document.querySelector('.dash-comp-tile'));
    if (!tile || typeof tile.getBoundingClientRect !== 'function') return;
    var box = tile;
    box.classList.toggle('is-tall', box.getBoundingClientRect().height >= TALL);
    Array.prototype.forEach.call(box.querySelectorAll('.dash-comp-page'), function (/** @type {HTMLElement} */ pg) {
      _fitSupport(pg);
      // The one-line row's number column: the widest number on the page.
      var numW = 0;
      pg.querySelectorAll('.dash-comp-ln-num').forEach(function (el) {
        numW = Math.max(numW, /** @type {HTMLElement} */ (el).offsetWidth);
      });
      if (numW) pg.style.setProperty('--dash-comp-num-w', Math.ceil(numW) + 'px');
      var list = /** @type {HTMLElement | null} */ (pg.querySelector('.dash-comp-lines'));
      var n = list ? list.querySelectorAll('.dash-comp-lnbox, .dash-comp-lines > .dash-comp-ln').length : 0;
      // A row with its counts needs COUNTS_ROW px, or the full 72 when the
      // bar and name are the tall ones and the row is not one line.
      var wide = box.getBoundingClientRect().width >= 440;
      var need = box.classList.contains('is-tall') && !wide ? 72 : COUNTS_ROW;
      pg.classList.toggle('has-counts', !!list && n > 0 && list.clientHeight / n >= need);
    });
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
      else if (a.closest('[data-comp-level]')) {
        var g = /** @type {HTMLElement} */ (a.closest('[data-comp-level]'));
        _refocus = { key: g.dataset.compKey, level: Number(g.dataset.compLevel) };
      } else {
        var r = /** @type {HTMLElement | null} */ (a.closest('[data-comp-open]'));
        if (r) _refocus = { key: r.dataset.compOpen, page: r.dataset.compPage };
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
          : want.level
            ? _segFor(String(want.key), want.level)
            : _rowFor(String(want.key), String(want.page));
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
    // html-safe: popBody escapes every name, title and label; the rest is a count.
    pop.innerHTML = inner;
    pop.hidden = !inner;
    // A list opening takes a showing tip down with it.
    if (inner) hideTip();
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-comp-open]'),
      function (/** @type {HTMLElement} */ r) {
        r.setAttribute(
          'aria-expanded',
          String(!!_open && !_open.level && r.dataset.compOpen === _open.key && r.dataset.compPage === _open.page),
        );
      },
    );
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-comp-level]'),
      function (/** @type {HTMLElement} */ b) {
        b.setAttribute(
          'aria-expanded',
          String(!!_open && _open.key === b.dataset.compKey && _open.level === Number(b.dataset.compLevel)),
        );
      },
    );
    place();
  }

  /** Closes the list; with `refocus`, focus goes back to its row.
   * @param {boolean} refocus */
  function close(refocus) {
    if (!_open) return;
    var row = _opener();
    _open = null;
    _refresh();
    if (refocus && row) row.focus();
  }

  /** @param {HTMLElement} row */
  function _toggle(row) {
    var key = String(row.dataset.compOpen);
    var page = String(row.dataset.compPage);
    if (_open && _open.key === key && _open.page === page && !_open.level) {
      close(true);
      return;
    }
    if (!_last) return;
    _open = { cid: String(_last.cid), page: page, key: key };
    _refresh();
    _focusFirst();
  }

  /** A level's button in a Level Mix row: that level's students, with their
   * shared next step, as today's Level Mix list gives them. One list is open
   * at a time; the same button again closes it.
   * @param {HTMLElement} seg */
  function _toggleLevel(seg) {
    var key = String(seg.dataset.compKey);
    var level = Number(seg.dataset.compLevel);
    if (_open && _open.key === key && _open.level === level) {
      close(true);
      return;
    }
    if (!_last) return;
    _open = { cid: String(_last.cid), page: 'curricular', key: key, level: level };
    _refresh();
    _focusFirst();
  }

  function _focusFirst() {
    var first =
      document.querySelector('#dash-comp-pop [data-comp-first]') ||
      document.querySelector('#dash-comp-pop a, #dash-comp-pop button');
    if (first) /** @type {HTMLElement} */ (first).focus();
  }

  /** Show These N: the page's own click filters the cards (from the button's
   * data-action); this closes the list, scrolls down to the cards and puts
   * focus on the chip that clears the filter. */
  function _toCards() {
    _open = null;
    var pop = _el('dash-comp-pop');
    if (pop) pop.hidden = true;
    setTimeout(function () {
      var target = document.querySelector('.dash-comp-filter') || document.querySelector('.dash-students-head');
      if (target && target.scrollIntoView) {
        var calm = false;
        try {
          calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (e) {
          /* no media queries */
        }
        target.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
      }
      var chip = document.querySelector('.dash-comp-chip');
      if (chip) /** @type {HTMLElement} */ (chip).focus({ preventScroll: true });
    }, 0);
  }

  document.addEventListener('click', function (e) {
    var t = /** @type {Element | null} */ (e.target);
    if (!t || !t.closest) return;
    var seg = /** @type {HTMLElement | null} */ (t.closest('[data-comp-level]'));
    if (seg) {
      _toggleLevel(seg);
      return;
    }
    var row = /** @type {HTMLElement | null} */ (t.closest('[data-comp-open]'));
    if (row) {
      _toggle(row);
      return;
    }
    if (t.closest('[data-comp-close]')) {
      close(true);
      return;
    }
    if (t.closest('[data-comp-scroll]')) {
      _toCards();
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
  // Shift+Tab before its first, closes it and puts focus back on its row.
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

  /* ── Hover tips of the other views ───────────────────────────
     A row of Needs Support, Change or Evidence has a tip hung under it. The
     tile clips what hangs outside it, so the tip is shown whole from here, on
     the window, touching its row so the pointer can reach a link in it. */
  var TIP_ROWS = '.dash-comp-tile .dash-comp-row, .dash-comp-tile .dash-core-row, .dash-comp-tile .dash-comp-ln';
  /** @type {any} */
  var _tipTimer = 0;
  /** @type {Element | null} */
  var _tipRow = null;

  function hideTip() {
    clearTimeout(_tipTimer);
    _tipRow = null;
    var box = _el('dash-comp-tipbox');
    if (box) box.hidden = true;
  }

  /** @param {Element} row */
  function showTip(row) {
    var box = _el('dash-comp-tipbox');
    var tip = row.querySelector('.dist-tip, .dash-comp-ln-tip');
    if (!box || !tip) return;
    clearTimeout(_tipTimer);
    // A row whose list is open shows no tip: it would sit over the list.
    if (row.getAttribute('aria-expanded') === 'true') {
      hideTip();
      return;
    }
    if (_tipRow === row && !box.hidden) return;
    _tipRow = row;
    // html-safe: the tip's markup was built by DashOverview, which escapes every name and title.
    box.innerHTML = tip.innerHTML;
    box.hidden = false;
    if (typeof row.getBoundingClientRect !== 'function') return;
    var r = row.getBoundingClientRect();
    var w = box.offsetWidth;
    var h = box.offsetHeight;
    var left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    var top = r.bottom;
    if (top + h > window.innerHeight - 8) top = r.top - h;
    top = Math.max(8, Math.min(top, window.innerHeight - 8 - h));
    box.style.left = Math.round(left) + 'px';
    box.style.top = Math.round(top) + 'px';
  }

  function _tipLater() {
    clearTimeout(_tipTimer);
    _tipTimer = setTimeout(hideTip, 120);
  }

  document.addEventListener('mouseover', function (e) {
    var t = /** @type {Element | null} */ (e.target);
    if (!t || !t.closest) return;
    var row = t.closest(TIP_ROWS);
    if (row) showTip(row);
    else if (t.closest('#dash-comp-tipbox')) clearTimeout(_tipTimer);
    else if (_tipRow) _tipLater();
  });
  document.addEventListener('focusin', function (e) {
    var t = /** @type {Element | null} */ (e.target);
    var row = t && t.closest ? t.closest(TIP_ROWS) : null;
    if (row) showTip(row);
    else if (_tipRow && !(t && t.closest && t.closest('#dash-comp-tipbox'))) hideTip();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _tipRow) hideTip();
  });

  window.addEventListener('resize', place);
  document.addEventListener(
    'scroll',
    function (e) {
      if (_tipRow) hideTip();
      var pop = _el('dash-comp-pop');
      if (_open && !(pop && e.target instanceof Node && pop.contains(e.target))) place();
    },
    true,
  );

  return {
    PREF_KEY: PREF_KEY,
    PAGES: PAGES,
    pageOf: pageOf,
    pageForKey: pageForKey,
    html: html,
    show: show,
    lowestKey: lowestKey,
    isFew: isFew,
    close: close,
    place: place,
    fit: fit,
    toggle: _toggle,
    toggleLevel: _toggleLevel,
    showTip: showTip,
  };
})();
