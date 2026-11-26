// @ts-check
/* ── gradebook-toolbar.js — the Gradebook page's toolbar and filter panel ─
   The Assignments toolbar's "Three Things" in the Gradebook (Colin, Nov 25:
   the filter strip was "kinda janky, early design"). Left to right:

   - the class picker and Scores | Competencies, as they were;
   - Search with the Filter button inside its right end (an icon; blue while
     any filter is on), and its × just left of Filter while the box holds text;
   - Show: All, To Grade, To Return, Questions. An option is drawn when its
     count is above 0 (or while it is pressed), the bar when one is. One at
     a time: pressing one lets the others go; a second click, or All, shows
     everything. Each keeps the filter it always had (page-gradebook.js);
   - a chip for each filter that is on (a category, a module, a competency;
     a folder whose competencies are all ticked is one chip with its name),
     and "Showing N Students" as the same kind of chip;
   - ⋯ (Print Grades, Export) and + New Assessment.

   The filter panel floats over the grid under Search: Category, Competencies
   (the class's folders, each opening to its competencies) and Modules, each
   drawn only when the class has it, and Clear Filters. It is drawn only while
   open, and ticking keeps it open with the keyboard on the same row (the page
   redraws on every tick). The filters are the page's: filterCategories,
   filterSections, filterModules; this file only draws how they are chosen.

   ⋯ is CardMenu's (card-menu.js), the same look, keys and focus as the
   Assignments page's. The chips are styled in styles.css, shared with the
   Assignments toolbar (assign-toolbar.js).

   PageGradebook passes the state it keeps (see State) to html(), and calls
   click(), keydown(), keep() and afterDraw() around its own handling. */
/** @type {any} */ (window).GradebookToolbar = (function () {
  'use strict';

  var G = /** @type {any} */ (window);

  /**
   * @typedef {{
   *   cid: string,
   *   courses: { id: string, name: string }[],
   *   view: string,
   *   search: string,
   *   students: number,
   *   show: string,
   *   avail: boolean,
   *   counts: { tograde: number, toreturn: number, questions: number },
   *   cats: { id: string, name: string, color: string }[],
   *   filters: { cats: string[], secs: string[], mods: string[] }
   * }} State
   */

  var X_ICON =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var CHEVRON_ICON =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

  var _open = false;
  // The folders the panel has open, by the folder's id.
  /** @type {Record<string, boolean>} */
  var _openFolders = {};
  // The state of the last draw: opening the panel draws it from this.
  /** @type {State | null} */
  var _last = null;

  // A fresh page, or another class.
  function reset() {
    _open = false;
    _openFolders = {};
  }
  function isOpen() {
    return _open;
  }

  /* ── What the class has to filter by ───────────────────────── */
  /** @param {State} s */
  function _modules(s) {
    return (G.getModules(s.cid) || []).map(function (/** @type {any} */ u) {
      return { id: String(u.id), name: String(u.name || ''), color: G.cssColor(u.color) };
    });
  }
  /** The class's competencies as folders and the ones in none. @param {State} s */
  function _competencies(s) {
    var grouped = G.getGroupedSections(s.cid) || { groups: [], ungrouped: [] };
    /** @param {any} sec */
    var one = function (sec) {
      return { id: String(sec.id), name: String(sec.shortName || sec.name || '') };
    };
    return {
      folders: grouped.groups
        .filter(function (/** @type {any} */ gi) {
          return gi.sections.length > 0;
        })
        .map(function (/** @type {any} */ gi) {
          return { id: String(gi.group.id), name: String(gi.group.name || 'Folder'), secs: gi.sections.map(one) };
        }),
      loose: (grouped.ungrouped || []).map(one),
    };
  }

  /* ── The chips ─────────────────────────────────────────────── */
  // html-safe: the name goes through esc; the attrs are built here from ids through esc
  /** @param {string} action @param {string} attrs @param {string} label @param {string} [aria] @param {string} [tip] */
  function _chip(action, attrs, label, aria, tip) {
    return (
      '<button type="button" class="atb-chip" data-action="' +
      action +
      '"' +
      attrs +
      ' aria-label="' +
      G.esc(aria || 'Remove Filter: ' + label) +
      '" title="' +
      (tip || 'Remove Filter') +
      '"><span class="atb-chip-label">' +
      G.esc(label) +
      '</span>' +
      X_ICON +
      '</button>'
    );
  }
  // html-safe: built by _chip
  /** @param {State} s */
  function _chipsHtml(s) {
    var f = s.filters;
    var c = _competencies(s);
    var out = [];
    s.cats.forEach(function (cat) {
      if (f.cats.indexOf(cat.id) >= 0)
        out.push(_chip('toggleCategoryFilter', ' data-catid="' + G.esc(cat.id) + '"', cat.name));
    });
    _modules(s).forEach(function (u) {
      if (f.mods.indexOf(u.id) >= 0)
        out.push(_chip('toggleModuleFilter', ' data-moduleid="' + G.esc(u.id) + '"', u.name));
    });
    c.folders.forEach(function (g) {
      var on = g.secs.filter(function (/** @type {any} */ k) {
        return f.secs.indexOf(k.id) >= 0;
      });
      if (on.length && on.length === g.secs.length)
        out.push(_chip('toggleFolderFilter', ' data-grpid="' + G.esc(g.id) + '"', g.name));
      else
        on.forEach(function (/** @type {any} */ k) {
          out.push(_chip('toggleSectionFilter', ' data-secid="' + G.esc(k.id) + '"', k.name));
        });
    });
    c.loose.forEach(function (k) {
      if (f.secs.indexOf(k.id) >= 0)
        out.push(_chip('toggleSectionFilter', ' data-secid="' + G.esc(k.id) + '"', k.name));
    });
    if (s.students) {
      var label = 'Showing ' + s.students + (s.students === 1 ? ' Student' : ' Students');
      out.push(_chip('clearStudentFilter', '', label, 'Show All Students', 'Show All Students'));
    }
    return out.join('');
  }

  /* ── Show ──────────────────────────────────────────────────── */
  var SHOW = [
    {
      show: 'tograde',
      label: 'To Grade',
      badge: 'atb-badge-blue',
      on: 'Showing only the work waiting to grade. Click to show everything.',
      off: 'Show only the students and assessments with work waiting to grade.',
    },
    {
      show: 'toreturn',
      label: 'To Return',
      badge: 'atb-badge-amber',
      on: 'Showing only the drafts to return. Click to show everything.',
      off: 'Show only the students and assessments with a draft to return.',
    },
    {
      show: 'questions',
      label: 'Questions',
      badge: 'atb-badge-blue',
      on: 'Showing only the work with a question waiting. Click to show everything.',
      off: 'Show only the students and assessments with a question waiting for you.',
    },
  ];
  // html-safe: fixed words and numbers
  /** @param {string} show @param {string} label @param {boolean} pressed @param {string} [tip] @param {string} [badge] */
  function _option(show, label, pressed, tip, badge) {
    return (
      '<button type="button" class="seg-btn"' +
      G.segAttr(pressed) +
      ' data-action="setShow" data-show="' +
      show +
      '"' +
      (tip ? ' title="' + tip + '"' : '') +
      '><span class="atb-lab" data-t="' +
      label +
      '"><span>' +
      label +
      '</span></span>' +
      (badge || '') +
      '</button>'
    );
  }
  // One of To Grade, To Return and Questions, with its badge.
  // html-safe: fixed words and numbers
  /** @param {{ show: string, label: string, badge: string, on: string, off: string }} o @param {State} s */
  function _optionFor(o, s) {
    var pressed = s.show === o.show;
    var n = s.counts[/** @type {'tograde' | 'toreturn' | 'questions'} */ (o.show)];
    return _option(
      o.show,
      o.label,
      pressed,
      pressed ? o.on : o.off,
      '<span class="atb-badge ' + o.badge + '" data-n="' + o.show + '">' + n + '</span>',
    );
  }
  // The options drawn: those with a count, or pressed.
  /** @param {State} s */
  function _shown(s) {
    return SHOW.filter(function (o) {
      return s.counts[/** @type {'tograde' | 'toreturn' | 'questions'} */ (o.show)] > 0 || s.show === o.show;
    });
  }
  /* The bar: All and what is waiting. It is on screen while something waits.
     Where something could wait (the class holds grades, takes work, or has
     questions: s.avail) it stays in the page, hidden, with All alone, so
     the first option to arrive is one button inserted, not a whole bar drawn
     (tests/speed-guard.test.js). Nothing is drawn where nothing could. */
  // html-safe: fixed words and numbers
  /** @param {State} s */
  function showHtml(s) {
    var shown = _shown(s);
    if (!shown.length && !s.avail) return '';
    return (
      '<div class="seg atb-show" role="group" aria-label="Show"' +
      (shown.length ? '' : ' hidden') +
      '>' +
      _option('all', 'All', s.show === 'all') +
      shown
        .map(function (o) {
          return _optionFor(o, s);
        })
        .join('') +
      '</div>'
    );
  }
  /* The counts moved (a score, a return): the numbers on the badges follow
     in place, and an option comes or goes alone, as its count crosses 0; the
     bar shows while one is there. False when the bar itself has to be drawn
     or taken away: draw it again (showHtml, swapped in). */
  /** @param {State} s */
  function syncShow(s) {
    var bar = /** @type {HTMLElement | null} */ (document.querySelector('.gb-toolbar .atb-show'));
    var shown = _shown(s);
    if (!bar) return !shown.length && !s.avail;
    if (!s.avail && !shown.length) return false;
    var drawn = bar;
    SHOW.forEach(function (o, i) {
      var n = s.counts[/** @type {'tograde' | 'toreturn' | 'questions'} */ (o.show)];
      var btn = drawn.querySelector('[data-show="' + o.show + '"]');
      var want = shown.indexOf(o) >= 0;
      if (btn && !want) btn.remove();
      else if (btn) {
        var badge = btn.querySelector('[data-n]');
        if (badge) badge.textContent = String(n);
      } else if (want) {
        var after = SHOW.slice(i + 1)
          .map(function (next) {
            return drawn.querySelector('[data-show="' + next.show + '"]');
          })
          .filter(Boolean)[0];
        // html-safe: built by _option
        (after || drawn).insertAdjacentHTML(after ? 'beforebegin' : 'beforeend', _optionFor(o, s));
      }
    });
    bar.hidden = !shown.length;
    return true;
  }

  /* ── The filter panel ──────────────────────────────────────── */
  // html-safe: names and ids go through esc; the dot's colour is a palette colour or went through cssColor
  /** @param {string} action @param {string} attrs @param {boolean | 'some'} on @param {string} dot @param {string} label @param {string} [cls] */
  function _row(action, attrs, on, dot, label, cls) {
    return (
      '<button type="button" class="assess-filter-item' +
      (on === true ? ' is-on' : on === 'some' ? ' is-some' : '') +
      (cls ? ' ' + cls : '') +
      '" role="checkbox" aria-checked="' +
      (on === 'some' ? 'mixed' : String(on)) +
      '" data-action="' +
      action +
      '"' +
      attrs +
      '><span class="assess-filter-box" aria-hidden="true"></span>' +
      (dot ? '<span class="assess-filter-dot" style="background:' + G.esc(dot) + '"></span>' : '') +
      '<span class="gbf-name">' +
      G.esc(label) +
      '</span></button>'
    );
  }
  // html-safe: built by _row
  /** @param {State} s */
  function _competenciesHtml(s) {
    var c = _competencies(s);
    var ticked = s.filters.secs;
    /** @param {{ id: string, name: string }} k @param {string} [cls] */
    var kid = function (k, cls) {
      return _row(
        'toggleSectionFilter',
        ' data-secid="' + G.esc(k.id) + '"',
        ticked.indexOf(k.id) >= 0,
        '',
        k.name,
        cls,
      );
    };
    return (
      c.folders
        .map(function (g) {
          var n = g.secs.filter(function (/** @type {any} */ k) {
            return ticked.indexOf(k.id) >= 0;
          }).length;
          var open = !!_openFolders[g.id];
          return (
            '<div class="gbf-folder">' +
            _row(
              'toggleFolderFilter',
              ' data-grpid="' + G.esc(g.id) + '"',
              n === g.secs.length ? true : n ? 'some' : false,
              '',
              g.name,
            ) +
            '<button type="button" class="gbf-chev" data-action="toggleFolderOpen" data-grpid="' +
            G.esc(g.id) +
            '" aria-expanded="' +
            open +
            '" aria-label="Competencies in ' +
            G.esc(g.name) +
            '">' +
            CHEVRON_ICON +
            '</button></div>' +
            '<div class="gbf-kids" data-grpid="' +
            G.esc(g.id) +
            '"' +
            (open ? '' : ' hidden') +
            '>' +
            g.secs
              .map(function (/** @type {any} */ k) {
                return kid(k, 'gbf-kid');
              })
              .join('') +
            '</div>'
          );
        })
        .join('') +
      c.loose
        .map(function (k) {
          return kid(k);
        })
        .join('')
    );
  }
  // html-safe: built by _row and _competenciesHtml
  /** @param {State} s */
  function _panelHtml(s) {
    var f = s.filters;
    var mods = _modules(s);
    var c = _competencies(s);
    var hasComps = c.folders.length > 0 || c.loose.length > 0;
    /** @param {string} name @param {string} rows */
    var col = function (name, rows) {
      return (
        '<div class="gbf-col" role="group" aria-label="' +
        name +
        '"><span class="assess-filter-head">' +
        name +
        '</span><div class="gbf-list">' +
        rows +
        '</div></div>'
      );
    };
    var any = f.cats.length + f.secs.length + f.mods.length > 0;
    return (
      '<div class="gbf-panel" id="gbf-panel" role="group" aria-label="Filter"><div class="gbf-cols">' +
      (s.cats.length
        ? col(
            'Category',
            s.cats
              .map(function (cat) {
                return _row(
                  'toggleCategoryFilter',
                  ' data-catid="' + G.esc(cat.id) + '"',
                  f.cats.indexOf(cat.id) >= 0,
                  cat.color,
                  cat.name,
                );
              })
              .join(''),
          )
        : '') +
      (hasComps ? col('Competencies', _competenciesHtml(s)) : '') +
      (mods.length
        ? col(
            'Modules',
            mods
              .map(function (u) {
                return _row(
                  'toggleModuleFilter',
                  ' data-moduleid="' + G.esc(u.id) + '"',
                  f.mods.indexOf(u.id) >= 0,
                  u.color,
                  u.name,
                );
              })
              .join(''),
          )
        : '') +
      '</div><div class="gbf-foot"><button type="button" class="assess-filter-item gbf-clear" data-action="clearAllFilters"' +
      (any ? '' : ' disabled') +
      '>Clear Filters</button></div></div>'
    );
  }

  // Under Search, kept inside the window: slid left when it would run off the
  // right, its columns given only the room below it.
  function place() {
    var panel = /** @type {HTMLElement | null} */ (document.querySelector('.gbf-panel'));
    if (!panel) return;
    panel.style.left = '0';
    panel.style.removeProperty('--gbf-list-h');
    var r = panel.getBoundingClientRect();
    var over = r.right - (window.innerWidth - 8);
    if (over > 0) panel.style.left = -over + 'px';
    var chrome = panel.offsetHeight - (panel.querySelector('.gbf-list') || panel).clientHeight;
    var room = window.innerHeight - r.top - 8 - chrome;
    panel.style.setProperty('--gbf-list-h', Math.max(120, Math.min(374, room)) + 'px');
  }
  /** @param {boolean} open */
  function setPanel(open) {
    _open = open;
    var wrap = document.querySelector('.gb-toolbar .atb-search');
    if (!wrap) return;
    var btn = wrap.querySelector('.atb-filter-btn');
    if (btn) btn.setAttribute('aria-expanded', String(open));
    var panel = wrap.querySelector('.gbf-panel');
    if (!open && panel) panel.remove();
    // html-safe: built by _panelHtml
    if (open && !panel && _last) wrap.insertAdjacentHTML('beforeend', _panelHtml(_last));
    if (open) place();
  }

  /* ── The bar ───────────────────────────────────────────────── */
  // html-safe: course names, ids and the search text go through esc; the rest is fixed words
  /** @param {State} s */
  function html(s) {
    _last = s;
    var esc = G.esc;
    var f = s.filters;
    var on = f.cats.length + f.secs.length + f.mods.length > 0;
    var chips = _chipsHtml(s);
    return (
      '<div class="page-toolbar gb-toolbar">' +
      '<select class="class-picker gb-course-select" data-action="switchCourse" aria-label="Select course">' +
      s.courses
        .map(function (c) {
          return (
            '<option value="' + esc(c.id) + '"' + (c.id === s.cid ? ' selected' : '') + '>' + esc(c.name) + '</option>'
          );
        })
        .join('') +
      '</select>' +
      '<div class="seg gb-seg-control" role="tablist" aria-label="View mode">' +
      ['scores:Scores', 'detailed:Competencies']
        .map(function (v) {
          var mode = v.split(':')[0];
          var label = v.split(':')[1];
          return (
            '<button class="seg-btn gb-seg-btn' +
            (s.view === mode ? ' active' : '') +
            '" data-action="setView" data-mode="' +
            mode +
            '" data-label="' +
            label +
            '" role="tab" aria-selected="' +
            (s.view === mode) +
            '">' +
            label +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="atb-search"><div class="atb-field">' +
      '<span class="assess-search-icon atb-ico atb-ico-search" aria-hidden="true"></span>' +
      '<input class="gb-search-input" type="text" placeholder="Search…" value="' +
      esc(s.search) +
      '" data-action-input="gbSearch" aria-label="Search students">' +
      (s.search
        ? '<button type="button" class="gb-search-clear" data-action="clearSearch" aria-label="Clear Search" title="Clear Search">×</button>'
        : '') +
      '<button type="button" class="atb-filter-btn' +
      (on ? ' has-filters' : '') +
      '" data-action="toggleFilterPanel" aria-haspopup="true" aria-expanded="' +
      _open +
      '" aria-controls="gbf-panel" aria-label="Filter" title="Filter">' +
      '<span class="atb-ico atb-ico-filter" aria-hidden="true"></span></button></div>' +
      (_open ? _panelHtml(s) : '') +
      '</div>' +
      showHtml(s) +
      (chips ? '<div class="atb-chips">' + chips + '</div>' : '') +
      '<div class="atb-end">' +
      '<div class="assess-menu-wrap atb-more-wrap">' +
      '<button type="button" class="atb-icon-btn" data-action="toggleCardMenu" data-atb="more" aria-haspopup="menu" aria-expanded="false" aria-label="More" title="More">' +
      '<span class="atb-ico atb-ico-dots" aria-hidden="true"></span></button><div class="assess-menu" role="menu" aria-label="More" hidden>' +
      _item('printGrades', LINE_ICONS.print, 'Print Grades') +
      _item('exportScoresCSV', LINE_ICONS.export, 'Export') +
      '</div></div>' +
      '<a class="tb-action-btn" role="link" tabindex="0" data-href="/assignments?course=' +
      esc(s.cid) +
      '&new=1">+ New Assessment</a>' +
      '</div></div>'
    );
  }
  // Its icon, then its label, as a card's ⋯ menu has.
  // html-safe: fixed words and icons
  /** @param {string} action @param {string} icon @param {string} label */
  function _item(action, icon, label) {
    return (
      '<button type="button" role="menuitem" class="assess-menu-item" data-action="' +
      action +
      '">' +
      icon +
      '<span>' +
      label +
      '</span></button>'
    );
  }

  /* ── Clicks and keys ───────────────────────────────────────────
     click() is first in the page's click handler. It closes the panel and
     ⋯ on a click outside them, opens and closes them, and opens a folder.
     True when the click was wholly its own. */
  /** @param {Event} e */
  function click(e) {
    var t = /** @type {Element | null} */ (e.target);
    if (!t || !t.closest) return false;
    if (_open && !t.closest('.gbf-panel, .atb-filter-btn')) setPanel(false);
    if (!t.closest('.atb-more-wrap')) G.CardMenu.close();
    var el = /** @type {HTMLElement | null} */ (t.closest('[data-action]'));
    var action = el && el.dataset.action;
    if (action === 'toggleFilterPanel') {
      setPanel(!_open);
      return true;
    }
    if (action === 'toggleFolderOpen' && el) {
      _toggleFolder(el.dataset.grpid || '');
      return true;
    }
    if (action === 'toggleCardMenu' && el && el.closest('.gb-toolbar')) {
      G.CardMenu.toggle(el);
      return true;
    }
    // Choosing an item closes ⋯ and hands the keyboard back to it.
    if (el && el.closest('.atb-more-wrap .assess-menu')) {
      G.CardMenu.close();
      var btn = document.querySelector('.atb-more-wrap [data-action="toggleCardMenu"]');
      if (btn) /** @type {HTMLElement} */ (btn).focus({ preventScroll: true });
    }
    return false;
  }

  /** @param {string} gid */
  function _toggleFolder(gid) {
    var open = !_openFolders[gid];
    _openFolders[gid] = open;
    var kids = document.querySelector('.gbf-kids[data-grpid="' + CSS.escape(gid) + '"]');
    var chev = document.querySelector('.gbf-chev[data-grpid="' + CSS.escape(gid) + '"]');
    if (kids) /** @type {HTMLElement} */ (kids).hidden = !open;
    if (chev) chev.setAttribute('aria-expanded', String(open));
  }

  // The rows a column shows, top to bottom (not its folders' chevrons).
  /** @param {Element} col */
  function _rows(col) {
    return /** @type {HTMLElement[]} */ (
      Array.prototype.filter.call(col.querySelectorAll('.assess-filter-item'), function (/** @type {HTMLElement} */ b) {
        return b.getClientRects().length > 0;
      })
    );
  }

  /* Keys. Escape closes the panel and gives the keyboard back to Filter; ↑ ↓
     move through a column's rows and wrap, → opens a folder and ← closes it
     (from one of its competencies, back to the folder). ⋯'s keys are
     CardMenu's. True when it was the toolbar's. */
  /** @param {KeyboardEvent} e */
  function keydown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    if (_open && e.key === 'Escape') {
      e.preventDefault();
      setPanel(false);
      var trigger = document.querySelector('.gb-toolbar .atb-filter-btn');
      if (trigger) /** @type {HTMLElement} */ (trigger).focus();
      return true;
    }
    var t = /** @type {HTMLElement | null} */ (e.target);
    if (!t || !t.closest) return false;
    if (G.CardMenu.keydown(e)) return true;
    var col = t.closest('.gbf-col');
    if (!col || !t.classList.contains('assess-filter-item')) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var rows = _rows(col);
      var i = rows.indexOf(t) + (e.key === 'ArrowDown' ? 1 : -1);
      rows[(i + rows.length) % rows.length].focus();
      return true;
    }
    var gid =
      t.dataset.grpid ||
      (t.closest('.gbf-kids') && /** @type {HTMLElement} */ (t.closest('.gbf-kids')).dataset.grpid) ||
      '';
    if (e.key === 'ArrowRight' && t.dataset.action === 'toggleFolderFilter') {
      e.preventDefault();
      if (!_openFolders[gid]) _toggleFolder(gid);
      return true;
    }
    if (e.key === 'ArrowLeft' && gid && _openFolders[gid]) {
      e.preventDefault();
      _toggleFolder(gid);
      if (t.dataset.action === 'toggleSectionFilter') {
        var head = col.querySelector('[data-action="toggleFolderFilter"][data-grpid="' + CSS.escape(gid) + '"]');
        if (head) /** @type {HTMLElement} */ (head).focus();
      }
      return true;
    }
    return false;
  }

  /* ── A filter changed the page ─────────────────────────────────
     The click draws the page again, so the control is new. keep(el) takes
     the control and the columns' scroll before the draw; the function it
     returns puts both back after it: a row keeps the keyboard, a chip hands
     it to Filter, Clear Filters to the panel's first row. */
  /** @param {HTMLElement} el @returns {() => void} */
  function keep(el) {
    var key = '';
    if (el.closest('.gbf-panel')) {
      var attr = el.dataset.secid
        ? '[data-secid="' + CSS.escape(el.dataset.secid) + '"]'
        : el.dataset.grpid
          ? '[data-action="toggleFolderFilter"][data-grpid="' + CSS.escape(el.dataset.grpid) + '"]'
          : el.dataset.catid
            ? '[data-catid="' + CSS.escape(el.dataset.catid) + '"]'
            : el.dataset.moduleid
              ? '[data-moduleid="' + CSS.escape(el.dataset.moduleid) + '"]'
              : '';
      key = '.gbf-panel ' + (attr || '.assess-filter-item');
    } else if (el.closest('.atb-chips')) key = '.gb-toolbar .atb-filter-btn';
    var tops = Array.prototype.map.call(
      document.querySelectorAll('.gbf-list'),
      function (/** @type {HTMLElement} */ l) {
        return l.scrollTop;
      },
    );
    return function () {
      document.querySelectorAll('.gbf-list').forEach(function (l, i) {
        if (tops[i]) l.scrollTop = tops[i];
      });
      var again = key && /** @type {HTMLElement | null} */ (document.querySelector(key));
      if (again) again.focus({ preventScroll: true });
    };
  }

  // After the page is drawn: an open panel is put back where it fits.
  function afterDraw() {
    if (_open) place();
  }

  return {
    html: html,
    showHtml: showHtml,
    syncShow: syncShow,
    reset: reset,
    isOpen: isOpen,
    setPanel: setPanel,
    click: click,
    keydown: keydown,
    keep: keep,
    afterDraw: afterDraw,
  };
})();
