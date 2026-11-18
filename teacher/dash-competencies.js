// @ts-check
/* dash-competencies.js — the Dashboard's one Competencies tile (D2 of
   docs/plans/dashboard-inbox-plan.md). A tile titled Competencies with a
   segmented control, Curricular | Core, over two pages that slide sideways.
   Each page is today's card, drawn by DashOverview (competenciesCardHtml and
   coreCardHtml) with its own view menu; only the housing is new. The page
   shown is kept per class on the device by page-dashboard.js, which reads
   and writes it through its _readPref and _writePref and hands it to html()
   as opts.compPage. Nothing here holds state: the Dashboard redraws as one
   string, so the open page is always read from that choice. */
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
    /** @type {Record<string, string>} */
    var cards = {
      curricular: DashOverview.competenciesCardHtml(opts),
      core: DashOverview.coreCardHtml(opts),
    };
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
      '<div class="seg dash-comp-seg" role="tablist" aria-label="Competencies">' +
      tabs +
      '</div>' +
      '</div>' +
      '<div class="dash-comp-pages"><div class="dash-comp-track">' +
      pages +
      '</div></div>' +
      '</section>'
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

  return { PREF_KEY: PREF_KEY, PAGES: PAGES, pageOf: pageOf, pageForKey: pageForKey, html: html, show: show };
})();
