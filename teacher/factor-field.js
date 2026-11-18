/* The assessment form's Factor (2026-11-06): a stepper, [−][ 2.3 ][+], and
   the share bar under the scoring that shows what the Factor means.

   A teacher can set any Factor from 0.1 to 10, to one decimal; the buttons
   step by 0.5. An assessment's stored Factor is kept exactly until the
   teacher changes it, so a 1.25 saved before stays 1.25.

   The share bar is this assessment's part of its category, as the course %
   counts it (assessmentCategoryShare in shared/calc.js): this one in blue,
   the others grey, each naming itself and its share on hover. */
window.FactorField = (function () {
  'use strict';

  var MIN = 0.1;
  var MAX = 10;
  var STEP = 0.5;

  // To one decimal, from 0.1 to 10.
  function clamp(v) {
    var r = Math.round(Number(v) * 10) / 10;
    return Math.max(MIN, Math.min(MAX, r));
  }

  // A typed Factor, clamped; null when it isn't a number above 0.
  function parse(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return null;
    var v = Number(s);
    return isFinite(v) && v > 0 ? clamp(v) : null;
  }

  // One press of − (dir < 0) or + from v, never below 0.1.
  function step(v, dir) {
    var n = Number(v);
    if (!(n > 0)) n = 1;
    return clamp(n + (dir < 0 ? -STEP : STEP));
  }

  // The stepper, holding the assessment's stored Factor exactly.
  function fieldHtml(weight) {
    var w = Number(weight) > 0 ? String(Number(weight)) : '1';
    return (
      '<div class="af-factor-stepper">' +
      '<button type="button" class="af-factor-btn" data-action="stepFactor" data-dir="-1" aria-label="Lower the factor">−</button>' +
      '<input class="af-factor-input" id="af-weight" type="number" inputmode="decimal" min="0.1" max="10" step="0.1" value="' +
      esc(w) +
      '" data-was="' +
      esc(w) +
      '" data-good="' +
      esc(w) +
      '" data-af-tip="factor">' +
      '<button type="button" class="af-factor-btn" data-action="stepFactor" data-dir="1" aria-label="Raise the factor">+</button>' +
      '</div>'
    );
  }

  /* The Factor the field says: the stored one while the box still shows
     it, else what was typed (clamped), else the last good value while the
     box is blank or half typed. */
  function read(el) {
    if (!el) return 1;
    var was = el.dataset ? el.dataset.was : '';
    if (was && String(el.value) === was && Number(was) > 0) return Number(was);
    var v = parse(el.value);
    if (v != null) return v;
    var good = Number(el.dataset && el.dataset.good);
    return good > 0 ? good : 1;
  }

  // Typing: a good value is kept for the bar and for save.
  function track(el) {
    if (!el || !el.dataset) return;
    var v = read(el);
    el.dataset.good = String(v);
  }

  // Leaving the box: it shows what will be saved.
  function settle(el) {
    if (!el) return;
    var v = read(el);
    var was = el.dataset ? el.dataset.was : '';
    if (!(was && String(el.value) === was)) el.value = String(v);
    if (el.dataset) el.dataset.good = String(v);
  }

  // Sets the box to v (a Start From Past or a kept value), exact.
  function set(el, v) {
    if (!el) return;
    var n = Number(v);
    if (!(n > 0)) return;
    el.value = String(n);
    if (el.dataset) {
      el.dataset.was = String(n);
      el.dataset.good = String(n);
    }
  }

  // A press of − or +: the box moves by 0.5 and tells the form.
  function stepIn(el, dir) {
    if (!el) return;
    var v = step(read(el), dir);
    el.value = String(v);
    if (el.dataset) el.dataset.good = String(v);
    // The box's own window's Event, so it works wherever the box lives.
    var view = el.ownerDocument && el.ownerDocument.defaultView;
    var Ev = (view && view.Event) || Event;
    ['input', 'change'].forEach(function (type) {
      if (el.dispatchEvent) el.dispatchEvent(new Ev(type, { bubbles: true }));
    });
  }

  /* The share bar, from assessmentCategoryShare's answer, as markup for
     #af-counts-as. selfTitle names this assessment on hover. null is
     nothing (a class with no %, DIBELS); no category or a 0% category is a
     short line. */
  // html-safe: every title, share and category name goes through esc; the rest is fixed markup
  function barHtml(info, selfTitle) {
    if (!info) return '';
    if (info.kind === 'uncategorized') return esc('Not in the course %');
    if (info.kind === 'zero') return esc((info.category || 'Its category') + ' counts 0%');
    if (info.kind !== 'share') return '';
    var segs = info.parts
      .map(function (p) {
        var name = p.self ? selfTitle || 'This assessment' : p.title || 'Untitled';
        return (
          '<span class="af-share-seg' +
          (p.self ? ' af-share-self' : '') +
          '" style="flex-grow:' +
          esc(String(p.share > 0 ? p.share : 0)) +
          '" title="' +
          esc(name + ': ' + formatShare(p.share, false)) +
          '"></span>'
        );
      })
      .join('');
    return (
      '<div class="af-share">' +
      '<div class="af-share-bar" aria-hidden="true">' +
      segs +
      '</div>' +
      '<div class="af-share-labels">' +
      '<span class="af-share-pct">' +
      esc(formatShare(info.share, true) + ' of') +
      '</span>' +
      '<span class="af-share-cat">' +
      esc(info.category || 'the course %') +
      '</span>' +
      '</div>' +
      '</div>'
    );
  }

  // The share bar into mount (the form's #af-counts-as), and the switch under it.
  function renderBar(mount, info, selfTitle) {
    if (!mount) return;
    mount.innerHTML = barHtml(info, selfTitle);
    refreshFactored(mount.ownerDocument);
  }

  /* Show Students the Factored Score (2026-11-18), under the share bar:
     points work whose Factor isn't 1x. Students see the score times the
     Factor ("20 / 24" for 5 / 6 at 4x, constants.js's factoredPoints); the
     teacher still grades out of the Max Points and the course % is the
     same. Hidden for anything else, its value kept until save. */
  function factoredShown(mode, weight) {
    return mode === 'points' && (Number(weight) > 0 ? Number(weight) : 1) !== 1;
  }
  function factoredHint(maxPoints, weight) {
    var max = Number(maxPoints) || 0;
    var f = Number(weight) > 0 ? Number(weight) : 1;
    if (!(max > 0)) return 'Students see the score times the Factor. You still grade it as you set it.';
    return 'Students see it out of ' + formatPoints(max * f) + '. You still grade it out of ' + formatPoints(max) + '.';
  }
  /* Nothing while it doesn't apply, so every other form is as it was; the
     switch is put in (refreshFactored) once the teacher picks points and a
     Factor other than 1x, and from then on only hidden. */
  // html-safe: the hint goes through esc; the rest is fixed markup
  function factoredHtml(mode, maxPoints, weight, on) {
    if (!factoredShown(mode, weight)) return '';
    return (
      '<div class="af-factored" id="af-factored-wrap">' +
      '<span class="af-factored-text"><label class="af-label" for="af-factored">Show Students the Factored Score</label>' +
      '<span class="af-factored-hint" id="af-factored-hint">' +
      esc(factoredHint(maxPoints, weight)) +
      '</span></span>' +
      '<span class="gpd-switch"><input type="checkbox" role="switch" id="af-factored" aria-describedby="af-factored-hint"' +
      (on ? ' checked' : '') +
      '><span class="gpd-switch-ui" aria-hidden="true"></span></span>' +
      '</div>'
    );
  }
  // What the form says now: its scoring, Max Points and Factor.
  function _formNow(doc) {
    var mode = doc.getElementById('af-scoremode');
    var max = doc.getElementById('af-maxpoints');
    return {
      mode: (mode && mode.value) || 'proficiency',
      max: max ? max.value : '',
      weight: read(doc.getElementById('af-weight')),
    };
  }
  // The switch shown or hidden, and its hint, as the form is now.
  function refreshFactored(doc) {
    var wrap = doc && doc.getElementById('af-factored-wrap');
    var now = doc ? _formNow(doc) : null;
    var bar = doc && doc.getElementById('af-counts-as');
    if (!wrap && bar && factoredShown(now.mode, now.weight)) {
      // html-safe: factoredHtml escapes its one text
      bar.insertAdjacentHTML('afterend', factoredHtml(now.mode, now.max, now.weight, false));
      wrap = doc.getElementById('af-factored-wrap');
    }
    if (!wrap) return;
    wrap.hidden = !factoredShown(now.mode, now.weight);
    var hint = doc.getElementById('af-factored-hint');
    if (hint) hint.textContent = factoredHint(now.max, now.weight);
  }
  // On only where it means something: points work at a Factor other than 1x.
  function factoredOn(doc) {
    var el = doc && doc.getElementById('af-factored');
    if (!el || !el.checked) return false;
    var now = _formNow(doc);
    return factoredShown(now.mode, now.weight);
  }
  function setFactored(doc, on) {
    refreshFactored(doc);
    var el = doc && doc.getElementById('af-factored');
    if (el) el.checked = !!on;
  }

  /* The grader's chip beside a points score box: the score times the
     Factor, "= 20 / 24" for 5 / 6 at 4x. Read-only: the score as entered is
     the one saved. Only on work whose Factor isn't 1x; empty until scored. */
  function chipText(factor, raw, max) {
    var fp = factoredPoints({ scoreMode: 'points', weight: factor }, raw, max);
    return fp ? '= ' + formatPoints(fp.points) + ' / ' + formatPoints(fp.outOf) : '';
  }
  // html-safe: the factor and text are numbers through formatPoints/formatFactor, esc'd
  function chipHtml(a, raw, max) {
    var factor = getAssessmentWeight(a);
    if (factor === 1) return '';
    return (
      '<span class="gb-pts-factored" data-factor="' +
      esc(String(factor)) +
      '" title="' +
      esc('Times its Factor, ' + formatFactor(factor)) +
      '">' +
      esc(chipText(factor, raw, max)) +
      '</span>'
    );
  }
  // A typed or saved score: the chip in row follows it.
  function refreshChip(row, raw, max) {
    var chip = row && row.querySelector('.gb-pts-factored');
    if (chip) chip.textContent = chipText(Number(chip.dataset.factor), raw, max);
  }

  return {
    MIN: MIN,
    MAX: MAX,
    STEP: STEP,
    clamp: clamp,
    parse: parse,
    step: step,
    fieldHtml: fieldHtml,
    read: read,
    track: track,
    settle: settle,
    set: set,
    stepIn: stepIn,
    barHtml: barHtml,
    renderBar: renderBar,
    factoredHtml: factoredHtml,
    refreshFactored: refreshFactored,
    factoredOn: factoredOn,
    setFactored: setFactored,
    chipText: chipText,
    chipHtml: chipHtml,
    refreshChip: refreshChip,
  };
})();
