// @ts-check
/* ── add-from-class.js — Add From Another Class ─────────────────────────
   The Assignments toolbar's dialog for bringing assessments in from
   another class (Colin, Nov 17: "add from another class looks janky-
   redesign this so it's cleaner and more intuitive"). The choices are in
   docs/DECISIONS.md, "Add From Another Class, the dialog (2026-11-17)".

   The class to copy from is a row of chips, same course first. Its
   assessments are rows in columns (Title, Category, Scoring, Date
   Assigned), newest first, found by Search, Category and Module. Select
   All ticks what is shown; the button counts what is ticked ("Add 3").
   The top of the dialog and its buttons stay in view while the list
   scrolls.

   This file only chooses. What a copy holds is AssessmentCopy's
   (planCopy, buildCopy, addFrom in teacher/assessment-copy.js) and has not
   changed: title, dates, category, module, competencies, rubric, Core
   Competencies, scoring, Factor and description, matched by name in this
   class. A Draft's copy is a Draft. Scores are never copied. */
/** @type {any} */ (window).AddFromClass = (function () {
  'use strict';

  var G = /** @type {any} */ (window);
  var LAST_KEY = 'fv-add-from-';
  var SCORING = {
    rubric: 'Rubric',
    competencies: 'Competencies',
    points: 'Points',
    complete: 'Complete/Incomplete',
    dibels: 'DIBELS',
  };
  var SEARCH_ICON =
    '<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5" /><line x1="10.5" y1="10.5" x2="14" y2="14" /></svg>';

  /** @param {any} s */
  function _norm(s) {
    return String(s == null ? '' : s)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  /** @param {any[]} list @returns {Record<string, any>} */
  function _byId(list) {
    /** @type {Record<string, any>} */
    var out = {};
    (list || []).forEach(function (x) {
      if (x && x.id) out[x.id] = x;
    });
    return out;
  }

  /** @param {number} n @param {string} one @param {string} many */
  function _count(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /* How a piece is scored, in the List view's words. */
  /** @param {string} cid @param {any} a */
  function scoringLabel(cid, a) {
    var kind = G.AssignList.scoringOf(cid, a);
    if (kind === 'points') return G.formatPoints(Number(a.maxPoints || a.max_points) || 100) + ' Points';
    return SCORING[/** @type {keyof typeof SCORING} */ (kind)] || SCORING.competencies;
  }

  /* srcCid's assessments as the dialog lists them for dstCid, newest first.
     Both classes must be loaded. state: 'here' when dstCid already holds
     this piece's linked copy, 'refused' when dstCid can't take it (DIBELS
     outside ELA and Social Studies 8), else 'ok'. sameTitle: dstCid has an
     unlinked piece of the same title. */
  /** @param {string} srcCid @param {string} dstCid */
  function rowsFor(srcCid, dstCid) {
    /** @type {Record<string, boolean>} */
    var haveGroup = {};
    /** @type {Record<string, boolean>} */
    var haveTitle = {};
    (G.getAssessments(dstCid) || []).forEach(function (/** @type {any} */ x) {
      if (x.copyGroup) haveGroup[x.copyGroup] = true;
      if (_norm(x.title)) haveTitle[_norm(x.title)] = true;
    });
    var cats = _byId(G.getCategories(srcCid));
    var mods = _byId(G.getModules(srcCid));
    return (G.getAssessments(srcCid) || [])
      .map(function (/** @type {any} */ a) {
        var cat = cats[a.categoryId || a.category_id];
        var mod = mods[a.moduleId];
        var here = !!(a.copyGroup && haveGroup[a.copyGroup]);
        var refused = !here && !G.AssessmentCopy.offersScoreMode(dstCid, a);
        return {
          id: String(a.id),
          title: a.title || 'Untitled',
          date: String(a.dateAssigned || a.date || a.assigned_at || ''),
          categoryId: cat ? String(cat.id) : '',
          category: cat ? String(cat.name || '') : '',
          moduleId: mod ? String(mod.id) : '',
          module: mod ? String(mod.name || '') : '',
          scoring: scoringLabel(srcCid, a),
          isDraft: !!G.isDraftAssessment(a),
          state: here ? 'here' : refused ? 'refused' : 'ok',
          sameTitle: !here && !!haveTitle[_norm(a.title)],
        };
      })
      .sort(function (/** @type {any} */ x, /** @type {any} */ y) {
        return y.date.localeCompare(x.date) || x.title.localeCompare(y.title);
      });
  }

  /* The rows Search, Category and Module leave. f: { q, cat, mod }; '' is
     every category or module, '-' the pieces with none. */
  /** @param {any[]} rows @param {{ q?: string, cat?: string, mod?: string }} f */
  function filterRows(rows, f) {
    var q = _norm(f && f.q);
    var cat = (f && f.cat) || '';
    var mod = (f && f.mod) || '';
    return rows.filter(function (r) {
      if (cat && (cat === '-' ? r.categoryId : r.categoryId !== cat)) return false;
      if (mod && (mod === '-' ? r.moduleId : r.moduleId !== mod)) return false;
      if (!q) return true;
      return _norm(r.title + ' ' + r.category + ' ' + r.module + ' ' + r.scoring).indexOf(q) >= 0;
    });
  }

  /* Select All ticks a row that can be added and isn't a likely repeat. */
  /** @param {any} r */
  function _allTicks(r) {
    return r.state === 'ok' && !r.sameTitle;
  }

  /* The class last copied from into cid on this device, when it is still
     one of the choices; else the first choice (same course first). */
  /** @param {string} cid @param {{ id: string, name: string }[]} classes */
  function _startClass(cid, classes) {
    var last = '';
    try {
      last = localStorage.getItem(LAST_KEY + cid) || '';
    } catch (e) {
      /* no storage: start on the first class */
    }
    var hit = classes.filter(function (c) {
      return c.id === last;
    })[0];
    return (hit || classes[0]).id;
  }

  /** @param {string} cid @param {string} srcCid */
  function _remember(cid, srcCid) {
    try {
      localStorage.setItem(LAST_KEY + cid, srcCid);
    } catch (e) {
      /* no storage: not remembered */
    }
  }

  /* One <select> of the categories or modules the rows use, with "No …"
     when some rows have none. '' when there is nothing to choose between. */
  /** @param {any[]} rows @param {'category' | 'module'} field @param {string} all @param {string} none @param {string} value */
  function _options(rows, field, all, none, value) {
    /** @type {Record<string, string>} */
    var names = {};
    var bare = false;
    rows.forEach(function (r) {
      if (r[field + 'Id']) names[r[field + 'Id']] = r[field];
      else bare = true;
    });
    var ids = Object.keys(names).sort(function (a, b) {
      return names[a].localeCompare(names[b]);
    });
    if (ids.length + (bare ? 1 : 0) < 2) return '';
    return (
      '<option value="">' +
      G.esc(all) +
      '</option>' +
      ids
        .map(function (id) {
          return (
            '<option value="' +
            G.esc(id) +
            '"' +
            (id === value ? ' selected' : '') +
            '>' +
            G.esc(names[id]) +
            '</option>'
          );
        })
        .join('') +
      (bare ? '<option value="-"' + (value === '-' ? ' selected' : '') + '>' + G.esc(none) + '</option>' : '')
    );
  }

  /** @param {any} r @param {boolean} on */
  function _rowHtml(r, on) {
    var off = r.state !== 'ok';
    var chip = '';
    if (r.state === 'here') chip = '<span class="afrom-chip">Already Here</span>';
    else if (r.state === 'refused')
      chip = '<span class="afrom-chip">DIBELS Is Only for ELA and Social Studies 8</span>';
    else if (r.sameTitle)
      chip =
        '<span class="afrom-chip afrom-chip-warn" title="This class already has an assessment with this title.">Same Title Here</span>';
    return (
      '<label class="afrom-row' +
      (off ? ' is-off' : '') +
      (on ? ' is-on' : '') +
      '" data-afrom-row="' +
      G.esc(r.id) +
      '">' +
      '<input type="checkbox" class="afrom-box" tabindex="-1" data-afrom-pick="' +
      G.esc(r.id) +
      '"' +
      (on ? ' checked' : '') +
      (off ? ' disabled' : '') +
      '>' +
      '<span class="afrom-title-cell"><span class="afrom-name">' +
      G.esc(r.title) +
      '</span>' +
      (r.isDraft ? '<span class="draft-badge">Draft</span>' : '') +
      chip +
      '</span>' +
      '<span class="afrom-cell afrom-cat">' +
      G.esc(r.category) +
      '</span>' +
      '<span class="afrom-cell afrom-scoring">' +
      G.esc(r.scoring) +
      '</span>' +
      '<span class="afrom-cell afrom-date">' +
      G.esc(r.date ? G.formatShortDate(r.date) : '') +
      '</span>' +
      '</label>'
    );
  }

  /* Open the dialog for the class cid. onDone runs after pieces were added. */
  /** @param {string} cid @param {() => void} [onDone] */
  function open(cid, onDone) {
    var targets = G.AssessmentCopy.copyTargets(cid);
    /** @type {{ id: string, name: string }[]} */
    var classes = targets.sameCourse.concat(targets.other);
    if (!classes.length || document.querySelector('.afrom-overlay')) return;

    var here = G.AssessmentCopy.className(cid);
    var trigger = /** @type {HTMLElement | null} */ (document.activeElement);
    var src = _startClass(cid, classes);
    /** @type {any[]} */
    var rows = [];
    /** @type {any[]} */
    var shown = [];
    var loading = true;
    var filters = { q: '', cat: '', mod: '' };
    /** @type {Set<string>} */
    var sel = new Set();
    var shift = false;
    /** @type {string | null} */
    var lastPick = null;
    var skipped = 0;

    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay afrom-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'afrom-title');
    overlay.setAttribute('aria-describedby', 'afrom-what');
    // html-safe: class ids and names through esc; the rest is fixed text
    overlay.innerHTML =
      '<div class="afrom-card">' +
      '<div class="afrom-head">' +
      '<h2 class="afrom-title" id="afrom-title">Add From Another Class</h2>' +
      '<p class="afrom-what" id="afrom-what">Into <strong>' +
      G.esc(here) +
      '</strong>. Each copy brings its dates, settings, rubric and competencies. Student scores are never copied.</p>' +
      '<div class="afrom-from"><span class="afrom-label" id="afrom-from-label">From</span>' +
      '<div class="afrom-classes" role="radiogroup" aria-labelledby="afrom-from-label">' +
      classes
        .map(function (c) {
          return (
            '<button type="button" class="afrom-class" role="radio" aria-checked="false" tabindex="-1" data-afrom-class="' +
            G.esc(c.id) +
            '">' +
            G.esc(c.name) +
            '</button>'
          );
        })
        .join('') +
      '</div></div>' +
      '<div class="afrom-tools">' +
      '<div class="assess-search-wrap afrom-search"><span class="assess-search-icon" aria-hidden="true">' +
      SEARCH_ICON +
      '</span><input class="assess-search-input" type="search" id="afrom-search" placeholder="Search" autocomplete="off" aria-label="Search this class’s assessments"></div>' +
      '<select class="afrom-select" id="afrom-cat" aria-label="Category" hidden></select>' +
      '<select class="afrom-select" id="afrom-mod" aria-label="Module" hidden></select>' +
      '</div>' +
      '</div>' +
      '<div class="afrom-cols">' +
      '<input type="checkbox" class="afrom-box" id="afrom-all" aria-label="Select all shown">' +
      '<label class="afrom-col afrom-col-all" for="afrom-all">Select All</label>' +
      '<span class="afrom-col afrom-cat">Category</span>' +
      '<span class="afrom-col afrom-scoring">Scoring</span>' +
      '<span class="afrom-col afrom-date">Date Assigned</span>' +
      '</div>' +
      '<div class="afrom-list" id="afrom-list" role="group" aria-label="Assessments to add"></div>' +
      '<div class="afrom-foot">' +
      '<div class="afrom-status" id="afrom-status" role="status"></div>' +
      '<button type="button" class="confirm-cancel" data-afrom-cancel>Cancel</button>' +
      '<button type="button" class="confirm-ok primary" data-afrom-add disabled>Add</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    /** @param {string} s @returns {any} */
    var $ = function (s) {
      return overlay.querySelector(s);
    };
    var listEl = $('#afrom-list');
    var allBox = $('#afrom-all');
    var addBtn = $('[data-afrom-add]');

    function srcName() {
      var c = classes.filter(function (x) {
        return x.id === src;
      })[0];
      return c ? c.name : '';
    }

    /* The class chips: one chosen, and only it in the Tab order. */
    function drawClasses() {
      overlay.querySelectorAll('[data-afrom-class]').forEach(function (b) {
        var on = b.getAttribute('data-afrom-class') === src;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.setAttribute('tabindex', on ? '0' : '-1');
      });
    }

    /* The Category and Module pickers, for the class in view. */
    function drawFilters() {
      var cat = _options(rows, 'category', 'All Categories', 'No Category', filters.cat);
      var mod = _options(rows, 'module', 'All Modules', 'No Module', filters.mod);
      var catEl = $('#afrom-cat');
      var modEl = $('#afrom-mod');
      // html-safe: _options escapes every id and name
      catEl.innerHTML = cat;
      catEl.hidden = !cat;
      // html-safe: _options escapes every id and name
      modEl.innerHTML = mod;
      modEl.hidden = !mod;
    }

    function drawList() {
      shown = loading ? [] : filterRows(rows, filters);
      var filtered = !!(filters.q || filters.cat || filters.mod);
      if (loading) listEl.textContent = 'Loading…';
      else if (!rows.length) listEl.textContent = srcName() + ' has no assessments yet.';
      else if (!shown.length) {
        // html-safe: fixed text
        listEl.innerHTML =
          '<span>No assessments match.</span> <button type="button" class="afrom-link" data-afrom-reset>Show All</button>';
      } else {
        // html-safe: _rowHtml escapes every id, title and name
        listEl.innerHTML = shown
          .map(function (r) {
            return _rowHtml(r, sel.has(r.id));
          })
          .join('');
      }
      listEl.classList.toggle('afrom-empty', !shown.length);
      listEl.classList.toggle('afrom-filtered', filtered);
      var first = listEl.querySelector('.afrom-box:not(:disabled)');
      if (first) first.setAttribute('tabindex', '0');
      listEl.scrollTop = 0;
      drawStatus();
    }

    /* Select All, the line beside the buttons, and the button's count. */
    function drawStatus() {
      var can = shown.filter(_allTicks);
      var on = shown.filter(function (r) {
        return sel.has(r.id);
      });
      var allOn =
        can.length > 0 &&
        can.every(function (r) {
          return sel.has(r.id);
        });
      allBox.checked = allOn;
      allBox.indeterminate = !allOn && on.length > 0;
      allBox.disabled = !can.length && !on.length;

      var n = sel.size;
      addBtn.disabled = !n;
      addBtn.textContent = n ? 'Add ' + n : 'Add';

      var status = $('#afrom-status');
      if (loading || !rows.length) {
        status.textContent = '';
        return;
      }
      var text;
      if (n) {
        var hidden = n - on.length;
        var drafts = rows.filter(function (r) {
          return r.isDraft && sel.has(r.id);
        }).length;
        text =
          n +
          ' selected' +
          (hidden ? ' (' + hidden + ' not shown)' : '') +
          '.' +
          (skipped ? ' Select All left out ' + skipped + ' with a title this class already has.' : '') +
          (!drafts
            ? ''
            : drafts === 1
              ? ' A Draft stays a Draft until you assign it here.'
              : ' Drafts stay Drafts until you assign them here.');
      } else {
        var already = rows.filter(function (r) {
          return r.state === 'here';
        }).length;
        text =
          (shown.length === rows.length
            ? _count(rows.length, 'assessment', 'assessments')
            : shown.length + ' of ' + rows.length + ' shown') +
          (already === rows.length
            ? '. All of them are already here.'
            : already
              ? ', ' + already + ' already here.'
              : '.');
      }
      // html-safe: text is counts and fixed words, through esc
      status.innerHTML =
        '<span>' +
        G.esc(text) +
        '</span>' +
        (n ? ' <button type="button" class="afrom-link" data-afrom-clear>Clear</button>' : '');
    }

    /* Load the class to copy from and list it. A slower, older load that
       comes back after the teacher moved on is dropped. */
    /** @param {string} next */
    function load(next) {
      src = next;
      rows = [];
      loading = true;
      sel.clear();
      lastPick = null;
      skipped = 0;
      filters.cat = '';
      filters.mod = '';
      drawClasses();
      drawFilters();
      drawList();
      Promise.resolve(G.AssessmentCopy.loadClass(next)).then(function () {
        if (src !== next || !overlay.isConnected) return;
        loading = false;
        rows = rowsFor(next, cid);
        drawFilters();
        drawList();
      });
    }

    /** @param {string} id @param {boolean} on */
    function tick(id, on) {
      if (on) sel.add(id);
      else sel.delete(id);
      var row = Array.from(listEl.querySelectorAll('[data-afrom-row]')).filter(function (/** @type {any} */ el) {
        return el.getAttribute('data-afrom-row') === id;
      })[0];
      if (!row) return;
      row.classList.toggle('is-on', on);
      /** @type {HTMLInputElement} */ (row.querySelector('.afrom-box')).checked = on;
    }

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      // The toolbar's ▾, when the trigger was an item of its menu (a closed menu takes no focus).
      var back =
        trigger && trigger !== document.body && trigger.isConnected && trigger.getClientRects().length
          ? trigger
          : document.querySelector('[data-atb="new"]');
      try {
        if (back) /** @type {HTMLElement} */ (back).focus();
      } catch (e) {
        /* nothing to go back to */
      }
    }

    function add() {
      if (!sel.size) return;
      // In the list's order, so the copies land in the order shown.
      var ids = rows
        .filter(function (r) {
          return sel.has(r.id);
        })
        .map(function (r) {
          return r.id;
        });
      var from = src;
      _remember(cid, from);
      close();
      G.AssessmentCopy.addFrom(from, ids, cid).then(function (/** @type {boolean} */ added) {
        if (added && onDone) onDone();
      });
    }

    /* Move among a set of controls with the arrow keys, one in the Tab order. */
    /** @param {KeyboardEvent} e @param {HTMLElement[]} items @param {string[]} back @param {string[]} fwd */
    function rove(e, items, back, fwd) {
      var i = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
      if (i < 0) return null;
      var to = i;
      if (fwd.indexOf(e.key) >= 0) to = Math.min(items.length - 1, i + 1);
      else if (back.indexOf(e.key) >= 0) to = Math.max(0, i - 1);
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = items.length - 1;
      else return null;
      e.preventDefault();
      items.forEach(function (el) {
        el.setAttribute('tabindex', '-1');
      });
      items[to].setAttribute('tabindex', '0');
      items[to].focus();
      return items[to];
    }

    /** @param {KeyboardEvent} e */
    function onKey(e) {
      if (!overlay.isConnected) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      var at = /** @type {HTMLElement} */ (document.activeElement);
      if (at && at.matches && at.matches('[data-afrom-class]')) {
        var chip = rove(
          e,
          Array.from(overlay.querySelectorAll('[data-afrom-class]')),
          ['ArrowLeft', 'ArrowUp'],
          ['ArrowRight', 'ArrowDown'],
        );
        // As a radio group does: the arrows choose as they move.
        if (chip && chip.getAttribute('data-afrom-class') !== src) load(chip.getAttribute('data-afrom-class') || '');
        if (chip) return;
      } else if (at && at.matches && at.matches('.afrom-list .afrom-box')) {
        if (rove(e, Array.from(listEl.querySelectorAll('.afrom-box:not(:disabled)')), ['ArrowUp'], ['ArrowDown']))
          return;
      }
      if (e.key !== 'Tab') return;
      var f = Array.from(
        overlay.querySelectorAll(
          'button:not(:disabled):not([tabindex="-1"]), select:not([hidden]), input:not(:disabled):not([tabindex="-1"])',
        ),
      );
      if (!f.length) return;
      var first = /** @type {HTMLElement} */ (f[0]);
      var last = /** @type {HTMLElement} */ (f[f.length - 1]);
      if (e.shiftKey && at === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      } else if (!overlay.contains(at)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey, true);

    overlay.addEventListener('mousedown', function (e) {
      shift = e.shiftKey;
    });
    overlay.addEventListener('click', function (e) {
      var t = /** @type {HTMLElement} */ (e.target);
      if (t === overlay || t.closest('[data-afrom-cancel]')) return close();
      if (t.closest('[data-afrom-add]')) return add();
      var chip = t.closest('[data-afrom-class]');
      if (chip) {
        if (chip.getAttribute('data-afrom-class') !== src) load(chip.getAttribute('data-afrom-class') || '');
        return;
      }
      if (t.closest('[data-afrom-clear]')) {
        sel.clear();
        skipped = 0;
        lastPick = null;
        drawList();
        allBox.focus();
        return;
      }
      if (t.closest('[data-afrom-reset]')) {
        filters = { q: '', cat: '', mod: '' };
        $('#afrom-search').value = '';
        drawFilters();
        drawList();
        $('#afrom-search').focus();
      }
    });
    overlay.addEventListener('input', function (e) {
      var t = /** @type {HTMLInputElement} */ (e.target);
      if (t.id !== 'afrom-search') return;
      filters.q = t.value;
      drawList();
    });
    overlay.addEventListener('change', function (e) {
      var t = /** @type {HTMLInputElement} */ (e.target);
      if (t.id === 'afrom-cat' || t.id === 'afrom-mod') {
        if (t.id === 'afrom-cat') filters.cat = t.value;
        else filters.mod = t.value;
        drawList();
        return;
      }
      if (t.id === 'afrom-all') {
        var on = t.checked;
        skipped = 0;
        shown.forEach(function (r) {
          if (!on) tick(r.id, false);
          else if (_allTicks(r)) tick(r.id, true);
          else if (r.state === 'ok' && !sel.has(r.id)) skipped++;
        });
        lastPick = null;
        drawStatus();
        return;
      }
      var id = t.getAttribute && t.getAttribute('data-afrom-pick');
      if (!id) return;
      // Shift and a click: every row from the last one ticked to this one.
      var ids = shown.map(function (r) {
        return r.id;
      });
      var a = lastPick == null ? -1 : ids.indexOf(lastPick);
      var b = ids.indexOf(id);
      if (shift && a >= 0 && b >= 0) {
        shown.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(function (r) {
          if (r.state === 'ok') tick(r.id, t.checked);
        });
      } else tick(id, t.checked);
      shift = false;
      lastPick = id;
      skipped = 0;
      // The ticked row is the list's one stop in the Tab order.
      listEl.querySelectorAll('.afrom-box[tabindex="0"]').forEach(function (/** @type {Element} */ x) {
        x.setAttribute('tabindex', '-1');
      });
      t.setAttribute('tabindex', '0');
      drawStatus();
    });

    load(src);
    // Start on the class to copy from: the first thing to decide, and no
    // keyboard slides up over the list on an iPad.
    var start = $('[data-afrom-class][aria-checked="true"]');
    if (start) start.focus();
  }

  return {
    open: open,
    // For tests: what the list reads.
    rowsFor: rowsFor,
    filterRows: filterRows,
    scoringLabel: scoringLabel,
  };
})();
