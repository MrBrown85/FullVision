// @ts-check
/* ── obs-toolbar.js — the Observations page's bar and filter panel ───────
   The Assignments toolbar's "Three Things" over the Observations feed (Colin,
   Nov 25: "Build it"). Left to right:

   - Search, with the Filter button inside its right end (an icon; blue while
     any filter is on);
   - Show: All, Open Concerns. The amber pill is now an option; its count is
     an amber badge while it is above 0 (the badge keeps its room at 0, so
     nothing beside it moves). One at a time: the pressed one clicked again,
     or All, shows everything;
   - a chip for each filter that is on, labelled as the filter chips were
     (a student's name or "3 students", a tag or "2 tags", a type or "2 types",
     a context or "2 contexts", the date choice or the custom range), left
     off whole when they do not fit (styles.css, .atb-chips). The students
     are the roster's: a click on a name there picks it (shift adds), and the
     chip shows who.

   The filter panel floats over the feed under Search, in three columns: Tag
   (a search box over a scrolling checklist), Type, and Date over Context.
   Tag, Type and Context take several (square ticks; a card shows when it
   matches any); Date takes one (round marks) and Custom Dates shows From
   and To. Clear Filters. It is drawn only while open; a tick updates it in
   place, so it stays open with its search text and the keyboard on the same
   row. Every label in it is Title Case (the data's own words are not
   changed: _title).

   The page (page-observations.js) keeps the filters and what each does; this
   file draws how they are chosen. It passes the state it keeps (see State) to
   html() and sync(), and gives start() the actions below. Clicks and keys are
   this file's own document listeners, from start() to stop().

   A card's type badge and its tags are buttons (ObsCard.html, filters: true);
   pressing one sets that filter: the same two actions. */
/** @type {any} */ (window).ObsToolbar = (function () {
  'use strict';

  var G = /** @type {any} */ (window);

  /**
   * @typedef {{
   *   cid: string,
   *   search: string,
   *   students: any[],
   *   concerns: number | null,
   *   f: {
   *     students: string[], tags: string[], types: string[], contexts: string[],
   *     date: string | null, from: string, to: string, concerns: boolean
   *   }
   * }} State
   *
   * The actions the page gives start():
   * @typedef {{
   *   search: (text: string) => void,
   *   toggle: (kind: 'tag' | 'type' | 'context', value: string) => void,
   *   pick: (key: string, value: string) => void,
   *   range: (which: 'from' | 'to', value: string) => void,
   *   drop: (kind: string) => void,
   *   clear: () => void,
   *   concerns: () => void
   * }} Actions
   */

  var X_ICON =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  /* The page's setFilterOption takes Date, the one choice. */
  /** The words of a label with a capital each (and, between words, stays small). @param {string} text */
  function _title(text) {
    return text.replace(/\S+/g, function (w, i) {
      return i && w === 'and' ? w : w.charAt(0).toUpperCase() + w.slice(1);
    });
  }

  /** @type {Actions | null} */
  var _api = null;
  /** @type {State | null} */
  var _last = null;
  var _open = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  var _searchTimer = null;
  /** @type {{ type: string, fn: (e: any) => void }[]} */
  var _listeners = [];

  /* ── What the filters offer ────────────────────────────────── */
  function _types() {
    return Object.keys(OBS_SENTIMENTS).map(function (k) {
      return { value: k, label: OBS_SENTIMENTS[k].label };
    });
  }
  function _contexts() {
    return Object.keys(OBS_CONTEXTS).map(function (k) {
      return { value: k, label: _title(OBS_CONTEXTS[k].label) };
    });
  }
  /** @param {string} cid */
  function _dates(cid) {
    var opts = [{ value: 'week', label: 'This Week' }];
    if (G.getReportingTerms(cid).length) opts.push({ value: 'term', label: 'This Term' });
    opts.push({ value: 'custom', label: 'Custom Dates' });
    return opts;
  }
  /** @param {{ value: string, label: string }[]} options @param {string} value */
  function _label(options, value) {
    for (var i = 0; i < options.length; i++) if (options[i].value === value) return options[i].label;
    return value;
  }
  /** @param {string} ymd */
  function _short(ymd) {
    return G.ObsCard.dateFormat({ month: 'short', day: 'numeric' }).format(new Date(ymd + 'T12:00:00'));
  }
  /** @param {State} s */
  function _any(s) {
    var f = s.f;
    return !!(f.students.length || f.tags.length || f.types.length || f.contexts.length || f.date);
  }

  /* ── The chips ─────────────────────────────────────────────── */
  /* Each filter that is on, in the panel's order: [kind, label]. */
  /** @param {State} s */
  function _chipList(s) {
    var f = s.f;
    var out = [];
    if (f.students.length) {
      var named = s.students.filter(function (/** @type {any} */ st) {
        return st.id === f.students[0];
      })[0];
      out.push([
        'students',
        f.students.length > 1 ? f.students.length + ' students' : named ? G.displayName(named) : '1 student',
      ]);
    }
    if (f.tags.length)
      out.push(['tags', f.tags.length === 1 ? G.resolveTag(f.tags[0]).label : f.tags.length + ' tags']);
    if (f.types.length)
      out.push(['types', f.types.length === 1 ? _label(_types(), f.types[0]) : f.types.length + ' types']);
    if (f.contexts.length)
      out.push([
        'contexts',
        f.contexts.length === 1 ? _label(_contexts(), f.contexts[0]) : f.contexts.length + ' contexts',
      ]);
    if (f.date) {
      var d = _label(_dates(s.cid), f.date);
      if (f.date === 'custom')
        d =
          f.from && f.to
            ? _short(f.from) + ' – ' + _short(f.to)
            : f.from
              ? 'From ' + _short(f.from)
              : f.to
                ? 'Until ' + _short(f.to)
                : 'Custom Dates';
      out.push(['date', d]);
    }
    return out;
  }
  // html-safe: the label goes through esc; the kind is one of the fixed names above
  /** @param {State} s */
  function _chipsHtml(s) {
    return _chipList(s)
      .map(function (c) {
        return (
          '<button type="button" class="atb-chip" data-action="obsChipOff" data-kind="' +
          c[0] +
          '" aria-label="' +
          G.esc('Remove Filter: ' + c[1]) +
          '" title="Remove Filter"><span class="atb-chip-label">' +
          G.esc(c[1]) +
          '</span>' +
          X_ICON +
          '</button>'
        );
      })
      .join('');
  }

  /* ── Show ──────────────────────────────────────────────────── */
  // html-safe: fixed words and numbers
  /** @param {string} show @param {string} label @param {boolean} pressed @param {string} [tip] @param {string} [badge] */
  function _option(show, label, pressed, tip, badge) {
    return (
      '<button type="button" class="seg-btn"' +
      G.segAttr(pressed) +
      ' data-action="obsShow" data-show="' +
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
  /** @param {number} n */
  function _badge(n) {
    return '<span class="atb-badge atb-badge-amber' + (n ? '' : ' atb-badge-off') + '" data-n>' + n + '</span>';
  }
  // html-safe: fixed words and a number
  /** @param {State} s */
  function _showHtml(s) {
    var on = s.f.concerns;
    return (
      '<div class="seg atb-show" role="group" aria-label="Show">' +
      _option('all', 'All', !on) +
      _option(
        'concerns',
        'Open Concerns',
        on,
        on
          ? 'Showing only the open concerns. Click to show everything.'
          : 'Show only the concerns with no Resolved follow-up.',
        _badge(s.concerns || 0),
      ) +
      '</div>'
    );
  }

  /* ── The filter panel ──────────────────────────────────────── */
  // html-safe: the label goes through esc; a dot is a palette colour (esc'd) or a type's own; value is esc'd
  /** @param {string} grp @param {string} value @param {boolean} on @param {string} label @param {string} [dot] */
  function _row(grp, value, on, label, dot) {
    var one = grp === 'd';
    return (
      '<button type="button" class="assess-filter-item obp-row' +
      (one ? ' is-radio' : '') +
      (on ? ' is-on' : '') +
      '" role="' +
      (one ? 'radio' : 'checkbox') +
      '" aria-checked="' +
      on +
      '" data-action="obsRow" data-grp="' +
      grp +
      '" data-value="' +
      G.esc(value) +
      '"><span class="assess-filter-box" aria-hidden="true"></span>' +
      (dot ? '<span class="assess-filter-dot" style="background:' + G.esc(dot) + '"></span>' : '') +
      '<span class="gbf-name">' +
      G.esc(label) +
      '</span></button>'
    );
  }
  // html-safe: section labels go through esc; rows are built by _row
  /** @param {State} s */
  function _tagRows(s) {
    return G.ObsCapture.tagMenuItems(s.cid)
      .map(function (/** @type {any} */ item) {
        return item.type === 'section'
          ? '<div class="assess-filter-head obp-section" data-section>' + G.esc(_title(item.label)) + '</div>'
          : _row('t', item.key, s.f.tags.indexOf(item.key) >= 0, item.label, item.color);
      })
      .join('');
  }
  /** Rows for a few options: a list of those ticked, or the one chosen. @param {string} grp @param {{ value: string, label: string }[]} options @param {string[] | string | null} cur @param {boolean} [dots] */
  function _choice(grp, options, cur, dots) {
    return options
      .map(function (o) {
        var on = Array.isArray(cur) ? cur.indexOf(o.value) >= 0 : cur === o.value;
        return _row(grp, o.value, on, o.label, dots ? OBS_SENTIMENTS[o.value].color : '');
      })
      .join('');
  }
  // html-safe: heads are fixed words; rows are built by _row
  /** @param {string} name @param {string} body @param {string} [cls] */
  function _col(name, body, cls) {
    return '<div class="gbf-col obp-col ' + (cls || '') + '" role="group" aria-label="' + name + '">' + body + '</div>';
  }
  /** @param {string} name @param {boolean} [gap] */
  function _head(name, gap) {
    return '<span class="assess-filter-head' + (gap ? ' obp-gap' : '') + '">' + name + '</span>';
  }
  // html-safe: built by _col, _row and _choice; the dates are esc'd
  /** @param {State} s */
  function _panelHtml(s) {
    var f = s.f;
    var find = function (/** @type {string} */ grp, /** @type {string} */ ph) {
      return (
        '<input class="obp-find" type="text" placeholder="' +
        ph +
        '" aria-label="' +
        ph.replace('…', '') +
        '" autocomplete="off" data-find="' +
        grp +
        '">'
      );
    };
    return (
      '<div class="gbf-panel obp-panel" id="obp-panel" role="group" aria-label="Filter"><div class="gbf-cols">' +
      _col(
        'Tag',
        _head('Tag') + find('t', 'Search Tags…') + '<div class="gbf-list obp-list">' + _tagRows(s) + '</div>',
        'obp-tags',
      ) +
      _col('Type', _head('Type') + _choice('y', _types(), f.types, true), 'obp-type') +
      _col(
        'Date and Context',
        _head('Date') +
          _choice('d', _dates(s.cid), f.date) +
          '<div class="obp-dates"' +
          (f.date === 'custom' ? '' : ' hidden') +
          '><label>From <input type="date" id="filter-date-from" value="' +
          G.esc(f.from) +
          '"></label><label>To <input type="date" id="filter-date-to" value="' +
          G.esc(f.to) +
          '"></label></div>' +
          _head('Context', true) +
          _choice('c', _contexts(), f.contexts),
        'obp-context',
      ) +
      '</div><div class="gbf-foot"><button type="button" class="assess-filter-item gbf-clear" data-action="obsClear"' +
      (_any(s) ? '' : ' disabled') +
      '>Clear Filters</button></div></div>'
    );
  }

  /* Under Search, kept inside the window: slid left when it would run off the
     right, and its columns scrolled inside it when it would run off the
     bottom. A column is as wide as it was drawn, so a search that hides rows
     does not narrow it. */
  /** @param {boolean} [first] */
  function place(first) {
    var panel = /** @type {HTMLElement | null} */ (document.querySelector('.obp-panel'));
    if (!panel) return;
    if (first)
      panel.querySelectorAll('.obp-col').forEach(function (c) {
        var col = /** @type {HTMLElement} */ (c);
        col.style.width = Math.ceil(col.getBoundingClientRect().width) + 'px';
      });
    panel.style.left = '0';
    panel.style.removeProperty('--obp-cols-h');
    var r = panel.getBoundingClientRect();
    var over = r.right - (window.innerWidth - 8);
    if (over > 0) panel.style.left = -over + 'px';
    var cols = /** @type {HTMLElement} */ (panel.querySelector('.gbf-cols'));
    var room = window.innerHeight - r.top - 8 - (panel.offsetHeight - cols.offsetHeight);
    panel.style.setProperty('--obp-cols-h', Math.max(160, room) + 'px');
  }
  /** @param {boolean} open */
  function setPanel(open) {
    _open = open;
    var wrap = document.querySelector('.obs-toolbar .atb-search');
    if (!wrap) return;
    var btn = wrap.querySelector('.atb-filter-btn');
    if (btn) btn.setAttribute('aria-expanded', String(open));
    var panel = wrap.querySelector('.obp-panel');
    if (!open && panel) panel.remove();
    // html-safe: built by _panelHtml
    if (open && !panel && _last) wrap.insertAdjacentHTML('beforeend', _panelHtml(_last));
    if (open) place(!panel);
  }

  /* ── The bar ───────────────────────────────────────────────── */
  // html-safe: the search text goes through esc; the rest is fixed words, numbers and what _chipsHtml, _showHtml and _panelHtml build
  /** @param {State} s */
  function html(s) {
    _last = s;
    var chips = _chipsHtml(s);
    return (
      '<div class="page-toolbar obs-toolbar" id="obs-toolbar">' +
      '<div class="atb-search"><div class="atb-field">' +
      '<span class="assess-search-icon atb-ico atb-ico-search" aria-hidden="true"></span>' +
      '<input type="text" placeholder="Search…" id="obs-search-input" value="' +
      G.esc(s.search) +
      '" aria-label="Search observations">' +
      '<button type="button" class="atb-filter-btn' +
      (_any(s) ? ' has-filters' : '') +
      '" data-action="obsFilter" aria-haspopup="true" aria-expanded="' +
      _open +
      '" aria-controls="obp-panel" aria-label="Filter" title="Filter">' +
      '<span class="atb-ico atb-ico-filter" aria-hidden="true"></span></button></div>' +
      (_open ? _panelHtml(s) : '') +
      '</div>' +
      _showHtml(s) +
      '<div class="atb-chips" id="obs-chips">' +
      chips +
      '</div></div>'
    );
  }

  /* ── In place ──────────────────────────────────────────────────
     A filter changed (a tick, a chip, the roster, Clear Filters): the bar and
     the panel follow without being drawn again, so a row keeps the keyboard
     and a search box its text. state.concerns is null when the count is not
     to be read again. */
  /** @param {State} s */
  function sync(s) {
    _last = s;
    var f = s.f;
    var bar = document.getElementById('obs-toolbar');
    if (!bar) return;
    var btn = bar.querySelector('.atb-filter-btn');
    if (btn) btn.classList.toggle('has-filters', _any(s));
    var chips = document.getElementById('obs-chips');
    // html-safe: built by _chipsHtml
    if (chips) chips.innerHTML = _chipsHtml(s);
    bar.querySelectorAll('.atb-show .seg-btn').forEach(function (b) {
      var el = /** @type {HTMLElement} */ (b);
      var pressed = el.dataset.show === 'concerns' ? f.concerns : !f.concerns;
      el.setAttribute('aria-pressed', String(pressed));
      if (el.dataset.show === 'concerns') {
        el.title = pressed
          ? 'Showing only the open concerns. Click to show everything.'
          : 'Show only the concerns with no Resolved follow-up.';
        var badge = el.querySelector('[data-n]');
        if (badge && s.concerns != null) {
          badge.textContent = String(s.concerns);
          badge.classList.toggle('atb-badge-off', !s.concerns);
        }
      }
    });
    var panel = document.querySelector('.obp-panel');
    if (!panel) return;
    /** @type {Record<string, any>} */
    var cur = { t: f.tags, y: f.types, c: f.contexts, d: f.date };
    panel.querySelectorAll('.obp-row').forEach(function (r) {
      var row = /** @type {HTMLElement} */ (r);
      var c = cur[row.dataset.grp || ''];
      var on = Array.isArray(c) ? c.indexOf(row.dataset.value) >= 0 : c === row.dataset.value;
      row.classList.toggle('is-on', on);
      row.setAttribute('aria-checked', String(on));
    });
    var dates = /** @type {HTMLElement | null} */ (panel.querySelector('.obp-dates'));
    if (dates) {
      dates.hidden = f.date !== 'custom';
      var from = /** @type {HTMLInputElement} */ (dates.querySelector('#filter-date-from'));
      var to = /** @type {HTMLInputElement} */ (dates.querySelector('#filter-date-to'));
      if (from.value !== f.from) from.value = f.from;
      if (to.value !== f.to) to.value = f.to;
    }
    var clear = /** @type {HTMLButtonElement | null} */ (panel.querySelector('.gbf-clear'));
    if (clear) clear.disabled = !_any(s);
    place();
  }

  /* ── A search box in a column narrows its rows ────────────────── */
  /** @param {HTMLInputElement} input */
  function _narrow(input) {
    var q = input.value.trim().toLowerCase();
    var list = /** @type {HTMLElement} */ (input.closest('.obp-col')).querySelector('.obp-list');
    if (!list) return;
    var section = /** @type {HTMLElement | null} */ (null);
    var any = false;
    /** @param {HTMLElement | null} sec */
    var settle = function (sec) {
      if (sec) sec.style.display = !q || any ? '' : 'none';
    };
    Array.prototype.forEach.call(list.children, function (/** @type {HTMLElement} */ el) {
      if (el.hasAttribute('data-section')) {
        settle(section);
        section = el;
        any = false;
        return;
      }
      var hit = !q || (el.textContent || '').toLowerCase().indexOf(q) >= 0;
      el.style.display = hit ? '' : 'none';
      if (hit) any = true;
    });
    settle(section);
  }

  /* ── Clicks and keys ───────────────────────────────────────── */
  /* After a card's badge or tag is pressed the feed is drawn again: the same
     control, where its card is still there, takes the keyboard back; else
     Filter does. */
  /** @param {HTMLElement} el */
  function _fromCard(el) {
    var card = el.closest('.obs-card');
    var id = card && /** @type {HTMLElement} */ (card).dataset.obid;
    var action = el.dataset.action;
    var value = el.dataset.value;
    return function () {
      var again = id
        ? document.querySelector(
            '#obs-feed .obs-card[data-obid="' +
              CSS.escape(id) +
              '"] [data-action="' +
              action +
              '"]' +
              (action === 'obsPickTag' ? '[data-value="' + CSS.escape(value || '') + '"]' : ''),
          )
        : null;
      var to = /** @type {HTMLElement | null} */ (again || document.querySelector('.obs-toolbar .atb-filter-btn'));
      if (to) to.focus({ preventScroll: true });
    };
  }
  /** @param {Event} e */
  function click(e) {
    var t = /** @type {Element | null} */ (e.target);
    if (!t || !t.closest || !_api || !_last) return;
    if (_open && !t.closest('.obp-panel, .obs-toolbar .atb-filter-btn')) setPanel(false);
    var el = /** @type {HTMLElement | null} */ (t.closest('[data-action]'));
    var action = el && el.dataset.action;
    if (!el || !action) return;
    var value = el.dataset.value || '';
    if (action === 'obsFilter') setPanel(!_open);
    else if (action === 'obsShow') {
      if (el.dataset.show === 'concerns' || _last.f.concerns) _api.concerns();
    } else if (action === 'obsRow') {
      var grp = el.dataset.grp || '';
      if (grp === 'd') _api.pick('date', value);
      else _api.toggle(grp === 't' ? 'tag' : grp === 'y' ? 'type' : 'context', value);
      if (grp === 'd' && value === 'custom' && _last.f.date === 'custom') {
        var from = document.getElementById('filter-date-from');
        if (from) from.focus();
      }
    } else if (action === 'obsChipOff') {
      _api.drop(el.dataset.kind || '');
      var trigger = document.querySelector('.obs-toolbar .atb-filter-btn');
      if (trigger) /** @type {HTMLElement} */ (trigger).focus({ preventScroll: true });
    } else if (action === 'obsClear') _api.clear();
    else if (action === 'obsPickType' || action === 'obsPickTag') {
      var back = _fromCard(el);
      _api.toggle(action === 'obsPickType' ? 'type' : 'tag', value);
      back();
    }
  }

  /* Escape closes the panel and gives the keyboard back to Filter; ↑ and ↓
     move through a column's rows (from its search box, to the first) and
     wrap. */
  /** @param {KeyboardEvent} e */
  function keydown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || !_open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setPanel(false);
      var trigger = document.querySelector('.obs-toolbar .atb-filter-btn');
      if (trigger) /** @type {HTMLElement} */ (trigger).focus();
      return;
    }
    var t = /** @type {HTMLElement | null} */ (e.target);
    if (!t || !t.closest || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    var col = t.closest('.obp-col');
    if (!col || !(t.classList.contains('obp-row') || t.classList.contains('obp-find'))) return;
    var rows = /** @type {HTMLElement[]} */ (
      Array.prototype.filter.call(col.querySelectorAll('.obp-row'), function (/** @type {HTMLElement} */ b) {
        return b.getClientRects().length > 0;
      })
    );
    if (!rows.length) return;
    e.preventDefault();
    var i = t.classList.contains('obp-find')
      ? e.key === 'ArrowDown'
        ? 0
        : -1
      : rows.indexOf(t) + (e.key === 'ArrowDown' ? 1 : -1);
    rows[(i + rows.length) % rows.length].focus();
  }

  /** @param {Event} e */
  function input(e) {
    var t = /** @type {HTMLInputElement | null} */ (e.target);
    if (!t || !t.classList) return;
    if (t.classList.contains('obp-find')) _narrow(t);
    else if (t.id === 'obs-search-input') {
      var text = t.value;
      if (_searchTimer) clearTimeout(_searchTimer);
      _searchTimer = setTimeout(function () {
        if (_api) _api.search(text);
      }, 120);
    }
  }
  /** @param {Event} e */
  function change(e) {
    var t = /** @type {HTMLInputElement | null} */ (e.target);
    if (!t || !_api) return;
    if (t.id === 'filter-date-from') _api.range('from', t.value);
    else if (t.id === 'filter-date-to') _api.range('to', t.value);
  }

  /** @param {Actions} api */
  function start(api) {
    stop();
    _api = api;
    [
      ['click', click],
      ['keydown', keydown],
      ['input', input],
      ['change', change],
    ].forEach(function (l) {
      var type = /** @type {string} */ (l[0]);
      var fn = /** @type {(e: any) => void} */ (l[1]);
      document.addEventListener(type, fn);
      _listeners.push({ type: type, fn: fn });
    });
  }
  function stop() {
    _listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.fn);
    });
    _listeners = [];
    if (_searchTimer) clearTimeout(_searchTimer);
    _searchTimer = null;
    _api = null;
    _last = null;
    _open = false;
  }
  // Another class: the panel is shut (the bar is drawn again).
  function reset() {
    _open = false;
  }

  return { html: html, sync: sync, start: start, stop: stop, reset: reset };
})();
