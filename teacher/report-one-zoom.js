// @ts-check
/* report-one-zoom.js — Progress Reports, One Student view: how large the
   sides of a student's report are drawn on screen, and the Zoom control
   that chooses it (Automatic, Fit Width, Whole Page, All Pages or a
   percent). Moved out of teacher/page-reports.js with _applyStudioZoom and
   _oneZoom, on 2026-11-13.

   The zoom is screen only. It sets --sheet-zoom (the scale), --sheet-cols
   (sides per row) and --pair-pad on the preview; teacher/report-one-zoom.css
   scales each page with a transform, so a page measures exactly as the
   layout engine (ReportOne, ReportSheets) measured it, and every rule is
   inside @media screen. A sheet's front and back always share a row: when
   two or more sides fit across, the sides per row are even.

   The choice (never the pixels) is remembered on this device in
   localStorage, one key per view ('gb-report-zoom-one'). The control takes
   its view and its list of choices from the caller, so another view can
   have its own; only the maths below (zoomFor, columns) is the One Student
   layout's. Everyone view keeps its own scale for now. */
window.ReportOneZoom = (function () {
  'use strict';

  /** @typedef {'auto' | 'width' | 'page' | 'all' | number} Choice
      A fit choice by name, or a percent (30 to 150). */
  /** @typedef {{ width: number, height: number, paper: string, sides: number }} Box
      The pane's inner size in px (less its padding), the paper and how
      many sides the student's report has. */

  var KEY = 'gb-report-zoom-';
  var PX_PER_IN = 96;
  /** @type {Record<string, { w: number, h: number }>} */
  var PAPER = {
    letter: { w: 8.5 * PX_PER_IN, h: 11 * PX_PER_IN },
    legal: { w: 8.5 * PX_PER_IN, h: 14 * PX_PER_IN },
  };
  var GAP = 8; // between two sides in a row (teacher/report-one-zoom.css column-gap)
  var PAIR_PAD = 7; // each side's extra room in its column: 8 + 7 + 7 = 22 px between sheets
  var ROW_GAP = 22; // between rows
  var LABEL = 24; // "Sheet 1 · Front" above each side
  var SAFETY = 1; // a pixel spare, for the browser's rounding of each width
  var MIN = 0.3;
  var MAX = 1.5;
  var STEPS = [30, 50, 60, 75, 90, 100, 125, 150];
  var FITS = ['auto', 'width', 'page', 'all'];
  /** @type {Record<string, string>} */
  var NAMES = { auto: 'Automatic', width: 'Fit Width', page: 'Whole Page', all: 'All Pages' };

  /* ── The maths (pure; tests/report-one-zoom.test.js) ───────── */

  /** @param {number} z */
  function clamp(z) {
    return Math.min(MAX, Math.max(MIN, z));
  }
  /* Down to a thousandth, never up: rounding up made two sides a fraction
     of a pixel wider than the pane, and the second wrapped below. */
  /** @param {number} z */
  function floor3(z) {
    return Math.floor(z * 1000) / 1000;
  }
  /** @param {string} paper */
  function paperOf(paper) {
    return PAPER[paper] || PAPER.letter;
  }
  /* The width of a row of n sides at scale z. */
  /** @param {number} n @param {number} z @param {string} paper */
  function rowWidth(n, z, paper) {
    var w = paperOf(paper).w * z + (n > 1 ? PAIR_PAD : 0);
    return n * w + (n - 1) * GAP;
  }
  /* The largest scale at which n sides fit across a width. */
  /** @param {number} n @param {number} width @param {string} paper */
  function zoomAcross(n, width, paper) {
    var pad = n > 1 ? PAIR_PAD : 0;
    return (width - SAFETY - (n - 1) * GAP - n * pad) / (n * paperOf(paper).w);
  }
  /* The largest scale at which r rows fit down a height. */
  /** @param {number} r @param {number} height @param {string} paper */
  function zoomDown(r, height, paper) {
    return (height - r * LABEL - (r - 1) * ROW_GAP) / (r * paperOf(paper).h);
  }

  /* Sides per row at scale z: as many as fit, but even when two or more
     fit, so a sheet's front and back are never split; never more columns
     than the report has sides (rounded up to a pair). */
  /** @param {number} z @param {Box} box */
  function columns(z, box) {
    var n = 1;
    while (rowWidth(n + 1, z, box.paper) <= box.width && n < 64) n++;
    if (n < 2) return 1;
    var sides = Math.max(2, box.sides + (box.sides % 2));
    return Math.min(n - (n % 2), sides);
  }

  /** @param {Box} box */
  function allPagesZoom(box) {
    var n = Math.max(1, box.sides);
    var best = 0;
    for (var c = 1; c <= n + 1; c = c === 1 ? 2 : c + 2) {
      var cols = Math.min(c, n + (n % 2));
      var rows = Math.ceil(n / cols);
      var z = Math.min(zoomAcross(cols, box.width, box.paper), zoomDown(rows, box.height, box.paper));
      if (z > best) best = z;
      if (cols >= n) break;
    }
    return best;
  }

  /* The scale for a choice in a pane. */
  /** @param {Choice} choice @param {Box} box @returns {number} */
  function zoomFor(choice, box) {
    if (typeof choice === 'number') return clamp(choice / 100);
    if (choice === 'width') return floor3(clamp(zoomAcross(1, box.width, box.paper)));
    if (choice === 'page') {
      return floor3(clamp(Math.min(zoomDown(1, box.height, box.paper), zoomAcross(1, box.width, box.paper))));
    }
    if (choice === 'all') return floor3(clamp(allPagesZoom(box)));
    // Automatic: a sheet's two sides side by side where both fit at three
    // quarters or more, else one side at up to full size.
    var two = zoomAcross(2, box.width, box.paper);
    if (two >= 0.75) return floor3(Math.min(1, two));
    return floor3(Math.min(1, Math.max(MIN, zoomAcross(1, box.width, box.paper))));
  }

  /* The next percent up (dir 1) or down (dir -1) from scale z. */
  /** @param {number} z @param {number} dir @returns {number} */
  function step(z, dir) {
    var p = z * 100;
    var i;
    if (dir > 0) {
      for (i = 0; i < STEPS.length; i++) if (STEPS[i] > p + 0.5) return STEPS[i];
      return STEPS[STEPS.length - 1];
    }
    for (i = STEPS.length - 1; i >= 0; i--) if (STEPS[i] < p - 0.5) return STEPS[i];
    return STEPS[0];
  }
  /** @param {number} z */
  function atMin(z) {
    return z <= MIN + 0.0005;
  }
  /** @param {number} z */
  function atMax(z) {
    return z >= MAX - 0.0005;
  }

  /** @param {unknown} s @returns {Choice} */
  function parseChoice(s) {
    if (typeof s !== 'string') return 'auto';
    if (FITS.indexOf(s) >= 0) return /** @type {Choice} */ (s);
    if (/^\d{2,3}$/.test(s)) {
      var n = Number(s);
      if (n >= MIN * 100 && n <= MAX * 100) return n;
    }
    return 'auto';
  }
  /** @param {{ getItem(k: string): string | null } | null} [store] @param {string} [view] @returns {Choice} */
  function readChoice(store, view) {
    try {
      var s = store === undefined ? window.localStorage : store;
      return parseChoice(s ? s.getItem(KEY + (view || 'one')) : null);
    } catch (e) {
      return 'auto';
    }
  }
  /** @param {Choice} choice @param {{ setItem(k: string, v: string): void, removeItem(k: string): void } | null} [store] @param {string} [view] */
  function saveChoice(choice, store, view) {
    try {
      var s = store === undefined ? window.localStorage : store;
      if (!s) return;
      var key = KEY + (view || 'one');
      if (choice === 'auto') s.removeItem(key);
      else s.setItem(key, typeof choice === 'number' ? String(Math.round(choice)) : choice);
    } catch (e) {
      /* storage unavailable: the choice lasts this visit */
    }
  }
  /** @param {Choice} choice */
  function label(choice) {
    return typeof choice === 'number' ? Math.round(choice) + '%' : NAMES[choice];
  }

  /* ── The control ─────────────────────────────────────────── */

  /* Per view: the choice (read from storage when first wanted) and the
     scale it gave last. */
  /** @type {Record<string, { choice: Choice | null, z: number }>} */
  var _views = {};
  var _view = 'one';
  /** @param {string} v */
  function _st(v) {
    return _views[v] || (_views[v] = { choice: null, z: 1 });
  }
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  var _glideTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  var _pinchTimer;
  /** @type {HTMLElement | null} */
  var _openMenu = null;

  function choice() {
    var st = _st(_view);
    if (st.choice === null) st.choice = readChoice(undefined, _view);
    return st.choice;
  }
  /** @param {Choice} c */
  function _setChoice(c) {
    _st(_view).choice = c;
  }

  var CARET =
    '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg>';

  /** @param {string} key @param {string} name */
  function _item(key, name) {
    return (
      '<button type="button" class="dash-view-item" role="menuitemradio" aria-checked="false" tabindex="-1" data-zoom="' +
      key +
      '"><span class="dash-view-tick" aria-hidden="true"></span><span class="dash-view-text"><span class="dash-view-name">' +
      name +
      '</span></span></button>'
    );
  }

  /* The Zoom control. opts.view names the view it zooms ('one' by
     default); opts.fits and opts.percents are its menu (by default the One
     Student view's: Automatic, Fit Width, Whole Page, All Pages, then 50%
     to 150%). Literal markup only: a fit is drawn only by its name in
     NAMES, a percent only as a number. */
  // html-safe: fixed markup; the names come from NAMES, the percents are numbers
  /** @param {{ view?: string, fits?: string[], percents?: number[] }} [opts] */
  function controlHtml(opts) {
    var o = opts || {};
    var view = o.view === 'all' ? 'all' : 'one';
    var items = (o.fits || FITS)
      .filter(function (k) {
        return Object.prototype.hasOwnProperty.call(NAMES, k);
      })
      .map(function (k) {
        return _item(k, NAMES[k]);
      })
      .join('');
    items += '<div class="studio-zoom-sep" role="separator"></div>';
    items += (o.percents || [50, 75, 100, 125, 150])
      .map(function (p) {
        var n = Math.round(Number(p)) || 100;
        return _item(String(n), n + '%');
      })
      .join('');
    return (
      '<span class="studio-zoom" id="studio-zoom" data-view="' +
      view +
      '" role="group" aria-label="Zoom">' +
      '<span class="tb-label">Zoom</span>' +
      '<span class="seg seg-sm studio-zoom-seg">' +
      '<button type="button" class="seg-btn studio-zoom-step" data-zoom-step="-1" aria-label="Zoom Out" title="Zoom Out">−</button>' +
      '<span class="dash-view-wrap">' +
      '<button type="button" class="seg-btn studio-zoom-btn" id="studio-zoom-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="studio-zoom-menu" aria-label="Zoom: Automatic"><span class="studio-zoom-now">Automatic</span>' +
      CARET +
      '</button>' +
      '<div class="dash-view-menu studio-zoom-menu" id="studio-zoom-menu" role="menu" aria-label="Zoom" hidden>' +
      items +
      '</div></span>' +
      '<button type="button" class="seg-btn studio-zoom-step" data-zoom-step="1" aria-label="Zoom In" title="Zoom In">+</button>' +
      '</span></span>'
    );
  }

  /** @param {HTMLElement} preview @returns {Box} */
  function _box(preview) {
    var cs = getComputedStyle(preview);
    var px = function (/** @type {string} */ v) {
      return parseFloat(v) || 0;
    };
    var sheet = preview.querySelector('.report-sheet[data-paper]');
    var cw = preview.clientWidth || 800;
    var ch = preview.clientHeight || 1000;
    return {
      width: cw - px(cs.paddingLeft) - px(cs.paddingRight),
      height: ch - px(cs.paddingTop) - px(cs.paddingBottom),
      paper: (sheet && sheet.getAttribute('data-paper')) || 'letter',
      sides: preview.querySelectorAll('.sheet-student > .sheet-zoom').length || 2,
    };
  }

  /** @param {HTMLElement} preview @param {number} z @param {boolean} glide */
  function _set(preview, z, glide) {
    var box = _box(preview);
    var cols = columns(z, box);
    if (glide && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      preview.classList.add('zoom-glide');
      clearTimeout(_glideTimer);
      _glideTimer = setTimeout(function () {
        preview.classList.remove('zoom-glide');
      }, 240);
    }
    preview.style.setProperty('--sheet-zoom', String(z));
    preview.style.setProperty('--sheet-cols', String(cols));
    preview.style.setProperty('--pair-pad', (cols > 1 ? PAIR_PAD : 0) + 'px');
    // Wider than the pane: the row starts at the left edge and scrolls.
    preview.classList.toggle('zoom-wide', rowWidth(cols, z, box.paper) > box.width + 0.5);
    _st(_view).z = z;
    _sync();
  }

  function _sync() {
    var ctl = document.getElementById('studio-zoom');
    if (!ctl) return;
    var c = choice();
    var shown = typeof c === 'number' ? Math.round(c) : c;
    var btn = ctl.querySelector('.studio-zoom-btn');
    var now = ctl.querySelector('.studio-zoom-now');
    if (now) now.textContent = label(shown);
    if (btn) btn.setAttribute('aria-label', 'Zoom: ' + label(shown));
    ctl.querySelectorAll('[data-zoom]').forEach(function (it) {
      var on = it.getAttribute('data-zoom') === String(shown);
      it.setAttribute('aria-checked', String(on));
      it.classList.toggle('is-on', on);
      var tick = it.querySelector('.dash-view-tick');
      if (tick) tick.textContent = on ? '✓' : '';
    });
    var steps = ctl.querySelectorAll('[data-zoom-step]');
    steps.forEach(function (b) {
      var down = b.getAttribute('data-zoom-step') === '-1';
      /** @type {HTMLButtonElement} */ (b).disabled = down ? atMin(_st(_view).z) : atMax(_st(_view).z);
    });
  }

  /** @returns {HTMLElement | null} */
  function _preview() {
    var p = document.getElementById('rb-preview');
    return p && !p.classList.contains('studio-all') ? p : null;
  }

  /** @param {Choice} c @param {boolean} glide */
  function _choose(c, glide) {
    _setChoice(c);
    saveChoice(c, undefined, _view);
    var p = _preview();
    if (p) _set(p, zoomFor(c, _box(p)), glide);
    else _sync();
  }

  /* ── The menu: the app's view menus' markup and keys ──────── */
  /** @param {Element} ctl */
  function _items(ctl) {
    return Array.prototype.slice.call(ctl.querySelectorAll('[role="menuitemradio"]'));
  }
  /** @param {Element} ctl */
  function _open(ctl) {
    var menu = /** @type {HTMLElement | null} */ (ctl.querySelector('.studio-zoom-menu'));
    var btn = ctl.querySelector('.studio-zoom-btn');
    if (!menu || !btn) return;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    _openMenu = menu;
    document.addEventListener('pointerdown', _outside, true);
    var items = _items(ctl);
    var on = items.filter(function (it) {
      return it.getAttribute('aria-checked') === 'true';
    })[0];
    if (on || items[0]) (on || items[0]).focus();
  }
  /** @param {boolean} [refocus] */
  function _close(refocus) {
    var menu = _openMenu;
    _openMenu = null;
    document.removeEventListener('pointerdown', _outside, true);
    if (!menu) return;
    menu.hidden = true;
    var btn = menu.parentElement && menu.parentElement.querySelector('.studio-zoom-btn');
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      if (refocus) /** @type {HTMLElement} */ (btn).focus();
    }
  }
  /** @param {Event} e */
  function _outside(e) {
    var t = /** @type {Element | null} */ (e.target);
    if (_openMenu && t && t.closest && t.closest('.studio-zoom-wrap, .dash-view-wrap') === _openMenu.parentElement)
      return;
    _close(false);
  }

  /** @param {Event} e */
  function _onClick(e) {
    var t = /** @type {Element | null} */ (e.target);
    var el = t && t.closest ? t.closest('[data-zoom-step], [data-zoom], .studio-zoom-btn') : null;
    var ctl = el && el.closest('.studio-zoom');
    if (!el || !ctl) return;
    if (el.hasAttribute('data-zoom-step')) {
      _choose(step(_st(_view).z, Number(el.getAttribute('data-zoom-step'))), true);
    } else if (el.hasAttribute('data-zoom')) {
      _close(true);
      _choose(parseChoice(el.getAttribute('data-zoom')), true);
    } else if (_openMenu) _close(true);
    else _open(ctl);
  }

  /* Down or Up on the closed button opens the menu (Enter and Space click
     it); in the menu the arrows, Home and End move, Escape closes it and
     gives the focus back to its button, Tab closes it. */
  /** @param {KeyboardEvent} e */
  function _onKey(e) {
    var t = /** @type {Element | null} */ (e.target);
    var ctl = t && t.closest ? t.closest('.studio-zoom') : null;
    if (!ctl) return;
    if (!_openMenu) {
      if (t && t.closest('.studio-zoom-btn') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        _open(ctl);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      _close(true);
      return;
    }
    if (e.key === 'Tab') {
      _close(false);
      return;
    }
    /** @type {HTMLElement[]} */
    var items = _items(ctl);
    var i = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    /** @type {HTMLElement | null} */
    var next = null;
    if (e.key === 'ArrowDown') next = items[i < 0 ? 0 : (i + 1) % items.length];
    else if (e.key === 'ArrowUp') next = items[i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    else return;
    e.preventDefault();
    if (next) next.focus();
  }

  /* ── Pinch, and Ctrl or Cmd with the scroll wheel ────────── */

  /* Scales to z keeping the point under the pointer still: the side under
     it keeps the same spot under the pointer, even when the sides per row
     change. The choice becomes a percent once the gesture stops. */
  /** @param {HTMLElement} preview @param {number} z @param {number} x @param {number} y */
  function _zoomAbout(preview, z, x, y) {
    var hit = document.elementFromPoint(x, y);
    var anchor = /** @type {HTMLElement | null} */ (
      (hit && hit.closest && preview.contains(hit) && hit.closest('.sheet-zoom')) ||
        preview.querySelector('.sheet-student > .sheet-zoom')
    );
    var r = anchor ? anchor.getBoundingClientRect() : null;
    var fx = r && r.width ? (x - r.left) / r.width : 0;
    var fy = r && r.height ? (y - r.top) / r.height : 0;
    _setChoice(z * 100);
    _set(preview, Math.round(z * 1000) / 1000, false);
    if (anchor && r) {
      var r2 = anchor.getBoundingClientRect();
      preview.scrollLeft += r2.left + fx * r2.width - x;
      preview.scrollTop += r2.top + fy * r2.height - y;
    }
    clearTimeout(_pinchTimer);
    _pinchTimer = setTimeout(function () {
      var pct = Math.round(_st(_view).z * 100);
      _setChoice(pct);
      saveChoice(pct, undefined, _view);
      _sync();
    }, 250);
  }

  /** @param {HTMLElement} preview */
  function _bindPreview(preview) {
    if (preview.dataset.zoomBound) return;
    preview.dataset.zoomBound = '1';
    preview.addEventListener(
      'wheel',
      function (e) {
        if (!(e.ctrlKey || e.metaKey) || preview.classList.contains('studio-all')) return;
        // The browser's own page zoom stays as it is.
        e.preventDefault();
        var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
        dy = Math.max(-40, Math.min(40, dy));
        _zoomAbout(preview, clamp(_st(_view).z * Math.exp(-dy * 0.005)), e.clientX, e.clientY);
      },
      { passive: false },
    );
    // Safari reports a trackpad pinch as gesture events.
    var base = 1;
    /** @param {Event} e @param {boolean} start */
    var gesture = function (e, start) {
      if (preview.classList.contains('studio-all')) return;
      e.preventDefault();
      var g = /** @type {Event & { scale?: number, clientX?: number, clientY?: number }} */ (e);
      if (start) base = _st(_view).z;
      else _zoomAbout(preview, clamp(base * (g.scale || 1)), g.clientX || 0, g.clientY || 0);
    };
    preview.addEventListener('gesturestart', function (e) {
      gesture(e, true);
    });
    preview.addEventListener('gesturechange', function (e) {
      gesture(e, false);
    });
  }

  /** @param {HTMLElement} ctl */
  function _bindControl(ctl) {
    if (ctl.dataset.zoomBound) return;
    ctl.dataset.zoomBound = '1';
    ctl.addEventListener('click', _onClick);
    ctl.addEventListener('keydown', _onKey);
  }

  /* After each render of the pages (and a resize, a new student or a
     paper change, which render them): the scale for the choice, at once,
     never gliding. In Everyone view the control hides and the preview
     keeps the Fit Map's own scale. */
  /** @param {HTMLElement} preview @param {string} view */
  function apply(preview, view) {
    var ctl = document.getElementById('studio-zoom');
    if (ctl) {
      // A control drawn for another view hides; only One Student has its maths yet.
      ctl.hidden = view === 'all' || (ctl.getAttribute('data-view') || 'one') !== view;
      _bindControl(ctl);
    }
    if (view === 'all') {
      preview.classList.remove('zoom-wide');
      return;
    }
    _view = view;
    _bindPreview(preview);
    _set(preview, zoomFor(choice(), _box(preview)), false);
  }

  /* The pane changed width without a render (a panel hidden or shown):
     a fit choice fits again, gliding. */
  /** @param {boolean} glide */
  function refit(glide) {
    var p = _preview();
    if (p) _set(p, zoomFor(choice(), _box(p)), glide);
  }

  return {
    controlHtml: controlHtml,
    apply: apply,
    refit: refit,
    // For tests.
    zoomFor: zoomFor,
    columns: columns,
    rowWidth: rowWidth,
    step: step,
    atMin: atMin,
    atMax: atMax,
    parseChoice: parseChoice,
    readChoice: readChoice,
    saveChoice: saveChoice,
    label: label,
    PAPER: PAPER,
    GEOM: { GAP: GAP, PAIR_PAD: PAIR_PAD, ROW_GAP: ROW_GAP, LABEL: LABEL, MIN: MIN, MAX: MAX },
  };
})();
