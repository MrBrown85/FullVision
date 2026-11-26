// @ts-check
/* ── assign-toolbar.js — the Assignments page's toolbar ────────────────
   Search, Show and New (Colin, Nov 25: "busy… janky"; he chose option C,
   "Three Things", from the Assignments Toolbar Board). Left to right:

   - Search, with the Filter button inside its right end (an icon; blue
     while any filter is on). Its menu holds the categories and Ungraded
     Only; ticking keeps the menu open, a click outside or Escape closes it.
   - Show (assign-show.js): All, Submitted, To Grade, To Return, Not In.
   - A chip for each filter that is on, with an × that turns it off.
   - Done Editing (in Bulk Edit), Show All Students (one student open),
     ⋯, and + New Assessment with a ▾ joined to it.
   - ⋯ holds Expand All, Collapse All, Bulk Edit and Rubrics (Rubrics only
     in Bulk Edit). ▾ holds New Quiz and Add From Another Class.

   The two menus are CardMenu's (card-menu.js): the same look, keys and
   focus as a card's ⋯. Every control is the toolbar height (--control-h),
   every chip --chip-h (e2e/toolbar-consistency.spec.js).

   PageAssignments passes the state it keeps (see html()) and draws the
   result; the actions are its own (toggleCategoryFilter, toggleUngraded,
   clearFilterMenu, expandAllAssess, collapseAllAssess, openRubricBank,
   showNewForm, newQuiz, addFromClass). */
/** @type {any} */ (window).AssignToolbar = (function () {
  'use strict';

  var G = /** @type {any} */ (window);

  /**
   * @typedef {{
   *   cid: string,
   *   courses: { id: string, name: string }[],
   *   search: string,
   *   cats: { id: string, name: string, color: string, on: boolean }[],
   *   ungraded: boolean,
   *   toReturn: { holds: boolean, total: number, pressed: boolean },
   *   bulk: boolean,
   *   focusStudent: boolean,
   *   cards: number,
   *   allOpen: boolean,
   *   noneOpen: boolean,
   *   quiz: boolean,
   *   copy: boolean
   * }} State
   */

  var _filterOpen = false;

  var FILTER_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
  var SEARCH_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  var DOTS_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
  var CHEVRON_ICON =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  var X_ICON =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function filterOpen() {
    return _filterOpen;
  }
  function reset() {
    _filterOpen = false;
  }
  /** @param {boolean} open */
  function setFilter(open) {
    _filterOpen = open;
    var wrap = document.querySelector('.atb-search');
    if (!wrap) return;
    wrap.classList.toggle('open', open);
    var btn = wrap.querySelector('.atb-filter-btn');
    if (btn) btn.setAttribute('aria-expanded', String(open));
  }
  // Whether a click or key landed in the Filter button or its menu.
  /** @param {any} target */
  function inFilter(target) {
    return !!(target && target.closest && target.closest('.atb-filter-btn, .assess-filter-menu'));
  }

  /* ── The Filter menu ───────────────────────────────────────── */
  // html-safe: category names and ids go through esc; colours are the palette's
  /** @param {State} s */
  function _filterMenuHtml(s) {
    var n = _filterCount(s);
    /** @param {string} action @param {string} attrs @param {boolean} on @param {string} dot @param {string} label */
    function item(action, attrs, on, dot, label) {
      return (
        '<button type="button" class="assess-filter-item' +
        (on ? ' is-on' : '') +
        '" role="menuitemcheckbox" aria-checked="' +
        on +
        '" data-action="' +
        action +
        '"' +
        attrs +
        '><span class="assess-filter-box" aria-hidden="true"></span>' +
        (dot ? '<span class="assess-filter-dot" style="background:' + G.esc(dot) + '"></span>' : '') +
        '<span>' +
        G.esc(label) +
        '</span></button>'
      );
    }
    return (
      '<div class="assess-filter-menu" role="menu" aria-label="Filter assessments">' +
      (s.cats.length
        ? '<span class="assess-filter-head">Category</span>' +
          s.cats
            .map(function (c) {
              return item('toggleCategoryFilter', ' data-catid="' + G.esc(c.id) + '"', c.on, c.color, c.name);
            })
            .join('') +
          '<span class="assess-filter-sep" aria-hidden="true"></span>'
        : '') +
      item('toggleUngraded', '', s.ungraded, '', 'Ungraded Only') +
      '<span class="assess-filter-sep" aria-hidden="true"></span>' +
      '<button type="button" class="assess-filter-item assess-filter-clear" role="menuitem" data-action="clearFilterMenu"' +
      (n ? '' : ' disabled') +
      '>Clear Filters</button>' +
      '</div>'
    );
  }
  /** @param {State} s */
  function _filterCount(s) {
    return (
      s.cats.filter(function (c) {
        return c.on;
      }).length + (s.ungraded ? 1 : 0)
    );
  }

  /* ── The two menus ─────────────────────────────────────────── */
  // Each item has its icon before the label, as a card's ⋯ menu does.
  /** @param {string} action @param {string} icon @param {string} label @param {string} [attrs] */
  function _item(action, icon, label, attrs) {
    return (
      '<button type="button" role="menuitem" class="assess-menu-item" ' +
      (action ? 'data-action="' + action + '"' : '') +
      (attrs || '') +
      '>' +
      icon +
      '<span>' +
      label +
      '</span></button>'
    );
  }

  // The ⋯ menu's items. Expand All and Collapse All leave out what is already so.
  // html-safe: fixed words
  /** @param {State} s */
  function moreItemsHtml(s) {
    var rubrics = _item('openRubricBank', LINE_ICONS.rubric, 'Rubrics');
    if (s.bulk) return rubrics;
    return (
      (s.cards && !s.allOpen ? _item('expandAllAssess', LINE_ICONS.expand, 'Expand All') : '') +
      (s.cards && !s.noneOpen ? _item('collapseAllAssess', LINE_ICONS.collapse, 'Collapse All') : '') +
      _item('', LINE_ICONS.checklist, 'Bulk Edit', ' data-alv-view="list"') +
      '<span class="assess-menu-sep" role="separator"></span>' +
      rubrics
    );
  }
  // html-safe: fixed words
  /** @param {State} s */
  function newItemsHtml(s) {
    return (
      (s.quiz ? _item('newQuiz', LINE_ICONS.quiz, 'New Quiz') : '') +
      (s.copy ? _item('addFromClass', LINE_ICONS.bringIn, 'Add From Another Class') : '')
    );
  }

  /** @param {string} which @param {string} label @param {string} cls @param {string} icon @param {string} items */
  function _menu(which, label, cls, icon, items) {
    return (
      '<div class="assess-menu-wrap atb-' +
      which +
      '-wrap">' +
      '<button type="button" class="' +
      cls +
      '" data-action="toggleCardMenu" data-atb="' +
      which +
      '" aria-haspopup="menu" aria-expanded="false" aria-label="' +
      label +
      '" title="' +
      label +
      '">' +
      icon +
      '</button>' +
      '<div class="assess-menu" role="menu" aria-label="' +
      label +
      '" hidden>' +
      items +
      '</div></div>'
    );
  }

  // After a card opens or closes: the ⋯ menu's two items follow, one at a time.
  /** @param {State} s */
  function syncMore(s) {
    var menu = document.querySelector('.atb-more-wrap .assess-menu');
    if (!menu || s.bulk) return;
    var expand = menu.querySelector('[data-action="expandAllAssess"]');
    var collapse = menu.querySelector('[data-action="collapseAllAssess"]');
    var wantExpand = s.cards > 0 && !s.allOpen;
    var wantCollapse = s.cards > 0 && !s.noneOpen;
    if (expand && !wantExpand) expand.remove();
    if (collapse && !wantCollapse) collapse.remove();
    // html-safe: built by _item
    if (!expand && wantExpand)
      menu.insertAdjacentHTML('afterbegin', _item('expandAllAssess', LINE_ICONS.expand, 'Expand All'));
    if (!collapse && wantCollapse) {
      var after = menu.querySelector('[data-action="expandAllAssess"]');
      // html-safe: built by _item
      (after || menu).insertAdjacentHTML(
        after ? 'afterend' : 'afterbegin',
        _item('collapseAllAssess', LINE_ICONS.collapse, 'Collapse All'),
      );
    }
  }

  /* ── The bar ───────────────────────────────────────────────── */
  // html-safe: course, category and search text go through esc; the rest is fixed words
  /** @param {State} s @param {string} siblingHtml */
  function html(s, siblingHtml) {
    var esc = G.esc;
    var n = _filterCount(s);
    var chips = s.cats
      .filter(function (c) {
        return c.on;
      })
      .map(function (c) {
        return _chip('toggleCategoryFilter', ' data-catid="' + esc(c.id) + '"', c.name);
      })
      .concat(s.ungraded ? [_chip('toggleUngraded', '', 'Ungraded Only')] : []);
    var newItems = newItemsHtml(s);
    return (
      '<div class="page-toolbar assess-toolbar">' +
      '<select class="class-picker assess-course-select" data-action="assessSwitchCourse" aria-label="Select course">' +
      s.courses
        .map(function (c) {
          return (
            '<option value="' + esc(c.id) + '"' + (c.id === s.cid ? ' selected' : '') + '>' + esc(c.name) + '</option>'
          );
        })
        .join('') +
      '</select>' +
      siblingHtml +
      '<div class="atb-search' +
      (_filterOpen ? ' open' : '') +
      '">' +
      '<div class="atb-field">' +
      '<span class="assess-search-icon" aria-hidden="true">' +
      SEARCH_ICON +
      '</span>' +
      '<input class="assess-search-input" type="text" placeholder="Search…" value="' +
      esc(s.search) +
      '" data-action-input="assessSearch" aria-label="Search assessments">' +
      '<button type="button" class="atb-filter-btn' +
      (n ? ' has-filters' : '') +
      '" data-action="toggleAssessFilterMenu" aria-haspopup="true" aria-expanded="' +
      _filterOpen +
      '" aria-label="Filter" title="Filter">' +
      FILTER_ICON +
      '</button>' +
      '</div>' +
      _filterMenuHtml(s) +
      '</div>' +
      '<span class="atb-show-slot">' +
      G.AssignShow.barHtml(s.cid, s.toReturn) +
      '</span>' +
      '<div class="atb-chips">' +
      chips.join('') +
      '</div>' +
      '<div class="atb-end">' +
      (s.bulk
        ? '<button type="button" class="tb-action-btn tb-action-secondary" data-alv-view="cards">Done Editing</button>'
        : '') +
      (s.focusStudent
        ? '<button type="button" class="tb-action-btn tb-show-all-btn" data-action="clearFocusStudent">Show All Students</button>'
        : '') +
      _menu('more', 'More', 'atb-icon-btn', DOTS_ICON, moreItemsHtml(s)) +
      '<div class="atb-new' +
      (newItems ? ' atb-split' : '') +
      '">' +
      '<button type="button" class="tb-action-btn atb-new-main" data-action="showNewForm">+ New Assessment</button>' +
      (newItems ? _menu('new', 'More Ways to Add', 'tb-action-btn atb-new-more', CHEVRON_ICON, newItems) : '') +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  // A filter that is on: its name and an × that turns it off.
  // html-safe: the name goes through esc
  /** @param {string} action @param {string} attrs @param {string} label */
  function _chip(action, attrs, label) {
    return (
      '<button type="button" class="atb-chip" data-action="' +
      action +
      '"' +
      attrs +
      ' aria-label="Remove Filter: ' +
      G.esc(label) +
      '" title="Remove Filter"><span class="atb-chip-label">' +
      G.esc(label) +
      '</span>' +
      X_ICON +
      '</button>'
    );
  }

  /* ── Focus after a filter changes the page ─────────────────────
     The click draws the page again, so the control is new. A menu item
     keeps the keyboard on the same item; a chip hands it to the Filter
     button; a card's category pill to the same pill. */
  /** @param {HTMLElement} el */
  function focusKey(el) {
    var cat = el.dataset.catid
      ? '[data-catid="' + CSS.escape(el.dataset.catid) + '"]'
      : '[data-action="toggleUngraded"]';
    if (el.closest('.assess-filter-menu')) return '.assess-filter-menu ' + cat;
    if (el.classList.contains('atb-chip')) return '.atb-filter-btn';
    var card = el.closest('.assess-card');
    return card ? '#' + CSS.escape(card.id) + ' .type-badge' + cat : '';
  }
  /** @param {string} key */
  function refocus(key) {
    var el = key && /** @type {HTMLElement | null} */ (document.querySelector(key));
    if (el) el.focus({ preventScroll: true });
  }

  return {
    html: html,
    reset: reset,
    filterOpen: filterOpen,
    setFilter: setFilter,
    inFilter: inFilter,
    syncMore: syncMore,
    focusKey: focusKey,
    refocus: refocus,
  };
})();
