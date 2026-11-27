// @ts-check
/* cm-grading-bars.js — Class Settings' Grading tab: what the Points and
   Proficiency presets do, said beside each button, and the Course
   Percentage bar, whose lines between categories drag (Colin, 2026-11-17:
   "there should be a better explanation of what BC Letter Bands and Match
   Columns means. And let users grab the edges of the course percentage
   visualizer so they can adjust them graphically, too.").

   Nothing here works out a grade. The presets' sentences read the numbers
   each preset would save (BC_LETTER_BAND_PERCENTS, matchedPercents below,
   DEFAULT_GRADING_SCALE) and the letter through percentageToLetter. A drag
   on the bar types into the weight boxes: it calls the same function typing
   calls, once for each of the two categories either side of the line, so
   Save Categories sends what typing those two numbers would have sent.

   DashClassManager hands it, through configure(): the selected course, the
   categories as they stand on screen (_cmCatState rows), and setWeight,
   which is cmCatWeightLive. It keeps no state but the drag in progress. */
window.CmGradingBars = (function () {
  'use strict';

  /** @typedef {{ name?: string, weight?: number | string }} CmCatRow */
  /** @typedef {{ selectedCourse: () => (string | null), catRows: (cid: string) => CmCatRow[], setWeight: (idx: number, value: string) => void }} CmGradingBarsHost */
  /** @type {CmGradingBarsHost | null} */
  var _host = null;
  /** @param {CmGradingBarsHost} opts */
  function configure(opts) {
    _host = opts;
  }

  /* ── Points and Proficiency: the presets ── */

  /* Match Columns' Counts As from the bands (DECISIONS, "Proficiency
     percents"): Extending halfway from its start to 100, Proficient and
     Developing at their own starts, and Emerging at 50, the C- floor, so a
     Developing student with one Emerging still passes (half of Developing's
     start when that is 50 or lower). Moved here from dash-class-manager.js
     (move only). */
  function matchedPercents(boundaries) {
    var at = {};
    boundaries.forEach(function (row) {
      at[row.proficiency] = row.min;
    });
    return {
      4: Math.round(at[4] + (100 - at[4]) / 2),
      3: at[3],
      2: at[2],
      1: at[2] > 50 ? 50 : Math.round(at[2] / 2),
    };
  }

  // 86, 91.7.
  function _pct(v) {
    return String(Math.round(Number(v) * 10) / 10) + '%';
  }
  // 80% (B): the letter a % that size gets, from calc.js.
  function _pctLetter(v) {
    return _pct(v) + ' (' + percentageToLetter(Number(v)) + ')';
  }
  // "Extending counts as 100% (A), Proficient 80% (B)" and so on.
  function _countsList(pairs) {
    var parts = pairs.map(function (p, i) {
      return (i === 0 ? p[0] + ' counts as ' : p[0] + ' ') + _pctLetter(p[1]);
    });
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  /* The sentence beside each preset, with the numbers it would save for
     this class's scale. */
  function presetTexts(scale) {
    var L = PROF_LABELS;
    var bc = BC_LETTER_BAND_PERCENTS;
    var bounds = (scale && scale.boundaries) || DEFAULT_GRADING_SCALE.boundaries;
    var m = matchedPercents(bounds);
    var d = DEFAULT_GRADING_SCALE;
    var dStarts = d.boundaries
      .filter(function (b) {
        return b.proficiency > 1;
      })
      .map(function (b) {
        return b.min;
      })
      .sort(function (a, b) {
        return a - b;
      });
    return {
      bc:
        'Moves the markers onto the BC letter scale. ' +
        _countsList([
          [L[4], bc[4]],
          [L[3], bc[3]],
          [L[3] + ' +', bc['3+']],
          [L[2], bc[2]],
          [L[1], bc[1]],
        ]) +
        ', with the + and − in between. The bands don’t move.',
      match:
        'Moves the markers to where each band starts, so a proficiency score and a points score agree. For this class, ' +
        _countsList([
          [L[3], m[3]],
          [L[2], m[2]],
        ]) +
        '. ' +
        L[4] +
        ' counts as halfway from its start to 100% (' +
        _pct(m[4]) +
        '), and ' +
        L[1] +
        ' as ' +
        _pct(m[1]) +
        '. The bands don’t move.',
      reset:
        'Each score counts as its level out of 4 (' +
        L[3] +
        ' ' +
        _pct(d.percents[3]) +
        '), and the bands go back to ' +
        dStarts
          .map(function (v) {
            return v + '%';
          })
          .join(', ')
          .replace(/, ([^,]*)$/, ' and $1') +
        '.',
    };
  }

  // The line under the Points and Proficiency label; editing adds how to move a marker.
  var SCALE_HINT =
    'The markers on top are what each score counts as in the course %. The coloured bands are the proficiency a points score shows as.';
  var SCALE_HINT_EDIT = ' Drag a marker or a % tab, or pick one and type.';

  function renderScaleHint(editing) {
    return '<div class="cm-hint cm-pts-hint">' + esc(SCALE_HINT + (editing ? SCALE_HINT_EDIT : '')) + '</div>';
  }

  // The three preset buttons, each with its sentence beside it.
  function renderPresets(scale) {
    var t = presetTexts(scale);
    var rows = [
      ['cmPointsScaleBc', 'BC Letter Bands', t.bc, ''],
      ['cmPointsScaleMatch', 'Match Columns', t.match, ''],
      ['cmPointsScaleReset', 'Reset to Defaults', t.reset, ' cm-pts-reset'],
    ];
    return (
      '<div class="cm-pts-actions">' +
      rows
        .map(function (r) {
          return (
            '<button type="button" class="cm-action-btn' +
            r[3] +
            '" data-action="' +
            r[0] +
            '">' +
            esc(r[1]) +
            '</button><div class="cm-hint cm-pts-preset-text">' +
            esc(r[2]) +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* ── Course Percentage: the categories' weights as one bar ── */

  // A fill and a text colour for each category, in turn; the text passes
  // 4.5:1 on its fill.
  var SHADES = [
    ['#0a63c9', '#ffffff'],
    ['#a9c9f2', '#12355e'],
    ['#2f6fb8', '#ffffff'],
    ['#cfe0f7', '#12355e'],
    ['#7fb0ec', '#12355e'],
    ['#1d4f8f', '#ffffff'],
  ];

  function _w(row) {
    var v = Number(row && row.weight);
    return isFinite(v) && v > 0 ? v : 0;
  }
  function _name(row) {
    return (row && (row.name || '').trim()) || 'Unnamed';
  }
  function _sum(rows) {
    return rows.reduce(function (s, r) {
      return s + _w(r);
    }, 0);
  }
  function _rows(cid) {
    return (_host && cid ? _host.catRows(cid) : null) || [];
  }
  // Where line i (between category i and i + 1) sits, in % of the bar.
  function _lineAt(rows, i, total) {
    var cum = 0;
    for (var k = 0; k <= i; k++) cum += _w(rows[k]);
    return (cum / total) * 100;
  }
  function _gripText(rows, i) {
    return _name(rows[i]) + ' ' + _w(rows[i]) + '%, ' + _name(rows[i + 1]) + ' ' + _w(rows[i + 1]) + '%';
  }

  function renderWeightBar(cid) {
    var rows = _rows(cid);
    var total = _sum(rows);
    if (!rows.length || total <= 0) return '';
    var segs = rows
      .map(function (r, i) {
        var shade = SHADES[i % SHADES.length];
        return (
          '<span class="cm-weight-seg" data-idx="' +
          i +
          '" style="width:' +
          (_w(r) / total) * 100 +
          '%;background:' +
          shade[0] +
          ';color:' +
          shade[1] +
          '" title="' +
          esc(_name(r) + ' ' + _w(r) + '%') +
          '"><span class="cm-weight-name">' +
          esc(_name(r)) +
          '</span><span class="cm-weight-pct">' +
          esc(_w(r) + '%') +
          '</span></span>'
        );
      })
      .join('');
    var grips = rows
      .slice(0, -1)
      .map(function (r, i) {
        return (
          '<button type="button" class="cm-weight-grip" data-idx="' +
          i +
          '" role="slider" aria-label="' +
          esc('Between ' + _name(r) + ' and ' + _name(rows[i + 1])) +
          '" aria-valuemin="0" aria-valuemax="' +
          (_w(r) + _w(rows[i + 1])) +
          '" aria-valuenow="' +
          _w(r) +
          '" aria-valuetext="' +
          esc(_gripText(rows, i)) +
          '" style="left:' +
          _lineAt(rows, i, total) +
          '%"></button>'
        );
      })
      .join('');
    return (
      '<div class="cm-weight-bar" id="cm-weight-bar">' +
      segs +
      grips +
      '</div>' +
      (rows.length > 1
        ? '<div class="cm-hint cm-weight-hint">Drag a line between two categories to move weight from one to the other. The total stays the same.</div>'
        : '')
    );
  }

  /* The bar follows the boxes without a redraw, so a drag or typing keeps
     its place and focus. A bar drawn for a different list waits for the
     next draw. */
  function syncWeightBar(cid) {
    var bar = typeof document !== 'undefined' && document.getElementById('cm-weight-bar');
    if (!bar || !bar.querySelectorAll) return;
    var rows = _rows(cid);
    var total = _sum(rows);
    var segs = /** @type {NodeListOf<HTMLElement>} */ (bar.querySelectorAll('.cm-weight-seg'));
    var grips = /** @type {NodeListOf<HTMLElement>} */ (bar.querySelectorAll('.cm-weight-grip'));
    if (segs.length !== rows.length || total <= 0) return;
    rows.forEach(function (r, i) {
      var seg = segs[i];
      seg.style.width = (_w(r) / total) * 100 + '%';
      seg.title = _name(r) + ' ' + _w(r) + '%';
      var pct = seg.querySelector('.cm-weight-pct');
      if (pct) pct.textContent = _w(r) + '%';
      var nm = seg.querySelector('.cm-weight-name');
      if (nm) nm.textContent = _name(r);
    });
    Array.prototype.forEach.call(grips, function (g, i) {
      if (!rows[i + 1]) return;
      g.style.left = _lineAt(rows, i, total) + '%';
      g.setAttribute('aria-valuemax', String(_w(rows[i]) + _w(rows[i + 1])));
      g.setAttribute('aria-valuenow', String(_w(rows[i])));
      g.setAttribute('aria-valuetext', _gripText(rows, i));
    });
  }

  /* Line i moved so category i has v: whole percents, between 0 and the
     two categories' total, which stays as it was. Returns the two new
     weights, or null when nothing moves. */
  function splitAt(rows, i, v) {
    if (!rows[i] || !rows[i + 1]) return null;
    var pair = _w(rows[i]) + _w(rows[i + 1]);
    var a = Math.max(0, Math.min(Math.floor(pair), Math.round(Number(v))));
    if (!isFinite(a) || a === _w(rows[i])) return null;
    return [a, Math.round((pair - a) * 1e6) / 1e6];
  }

  /* Moves line i so category i has v, by typing both numbers into their
     boxes, then puts them in the boxes on screen. */
  function moveLine(i, v) {
    var cid = _host && _host.selectedCourse();
    if (!cid) return false;
    var two = splitAt(_rows(cid), i, v);
    if (!two || !_host) return false;
    var set = two;
    _host.setWeight(i, String(set[0]));
    _host.setWeight(i + 1, String(set[1]));
    if (typeof document !== 'undefined' && document.querySelector) {
      [i, i + 1].forEach(function (k, j) {
        var box = /** @type {HTMLInputElement | null} */ (
          document.querySelector('.cm-cat-weight[data-idx="' + k + '"]')
        );
        if (box) box.value = String(set[j]);
      });
    }
    syncWeightBar(cid);
    return true;
  }

  /* Left and Down take 1% from the category before the line (Shift: 5),
     Right and Up give it 1%. */
  function keydown(e) {
    var g = e.target && e.target.closest && e.target.closest('.cm-weight-grip');
    if (!g || e.altKey || e.metaKey || e.ctrlKey) return false;
    var by = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (!by) return false;
    e.preventDefault();
    var i = parseInt(g.dataset.idx, 10);
    var rows = _rows(_host && _host.selectedCourse());
    if (rows[i]) moveLine(i, _w(rows[i]) + by * (e.shiftKey ? 5 : 1));
    return true;
  }

  /* A line follows the pointer (mouse, pen or touch) and snaps to whole
     percents. */
  /** @type {{ pointer: number, i: number, before: number, total: number, rect: DOMRect } | null} */
  var _drag = null;
  function initDrag(addDocListener) {
    addDocListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var g = e.target && e.target.closest && e.target.closest('.cm-weight-grip');
      var bar = g && g.closest('.cm-weight-bar');
      var cid = _host && _host.selectedCourse();
      if (!bar || !cid) return;
      var i = parseInt(g.dataset.idx, 10);
      var rows = _rows(cid);
      if (!rows[i + 1]) return;
      var before = 0;
      for (var k = 0; k < i; k++) before += _w(rows[k]);
      _drag = { pointer: e.pointerId, i: i, before: before, total: _sum(rows), rect: bar.getBoundingClientRect() };
      e.preventDefault();
      g.classList.add('is-dragging');
      try {
        g.setPointerCapture(e.pointerId);
      } catch (err) {
        // No capture: the drag still follows the document's pointer events.
      }
    });
    addDocListener('pointermove', function (e) {
      var d = _drag;
      if (!d || e.pointerId !== d.pointer || !d.rect.width) return;
      e.preventDefault();
      moveLine(d.i, ((e.clientX - d.rect.left) / d.rect.width) * d.total - d.before);
    });
    function end(e) {
      if (!_drag || e.pointerId !== _drag.pointer) return;
      _drag = null;
      var on = document.querySelectorAll('.cm-weight-grip.is-dragging');
      Array.prototype.forEach.call(on, function (g) {
        g.classList.remove('is-dragging');
      });
    }
    addDocListener('pointerup', end);
    addDocListener('pointercancel', end);
  }

  return {
    configure: configure,
    matchedPercents: matchedPercents,
    presetTexts: presetTexts,
    renderScaleHint: renderScaleHint,
    renderPresets: renderPresets,
    renderWeightBar: renderWeightBar,
    syncWeightBar: syncWeightBar,
    splitAt: splitAt,
    moveLine: moveLine,
    keydown: keydown,
    initDrag: initDrag,
  };
})();
