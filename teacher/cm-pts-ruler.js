// @ts-check
/* cm-pts-ruler.js — Class Settings › Grading › Points and Proficiency, drawn.

   One 0–100% ruler: Counts As markers above (every step, 1 to 4 with + and −,
   at the percent it counts as in the course %), Points to Proficiency bands
   and a handle at each start below. It is locked until the teacher presses
   Edit (docs/DECISIONS.md, "Points and Proficiency locks until Edit"): at rest
   the markers and tabs are labels, not buttons, and the header offers "Use in
   Other Classes…" and Edit. Editing, the header offers Cancel and Save, the
   markers are buttons, and a step or band start that differs from what is
   saved leaves a ghost at its saved place (CmPtsModel.ghosts); clicking a
   ghost puts that marker back.

   render() draws the whole section from what CmPtsEdit hands it; sync() moves
   what is already on the page, so a preview or a drag keeps its place without
   a redraw. Text goes in through esc. CmPtsEdit keeps the draft and the
   handlers. */
window.CmPtsRuler = (function () {
  'use strict';

  var M = CmPtsModel;
  var TICKS = [0, 25, 50, 75, 100];

  // A marker's name. A whole level that reads back as another level is
  // flagged, not blocked (DECISIONS, "Proficiency percents").
  function markerName(key, v, scale) {
    var name = M.stepLabel(key) + ' counts as ' + M.pctText(v) + '%';
    if (key.length === 1) {
      var readsAs = pointsToProf(v, 100, scale);
      if (readsAs !== Number(key)) name += ', which shows as ' + M.names()[readsAs];
    }
    return name;
  }

  function isPicked(pick, kind, k) {
    return !!pick && pick.kind === kind && (kind === 'step' ? pick.key === k : pick.level === k);
  }

  function markerHtml(v, i, rowsNow) {
    var key = COUNTS_AS_STEPS[i].key;
    var val = M.values(v.shown)[i];
    var on = v.editing && isPicked(v.pick, 'step', key);
    var name = markerName(key, val, v.shown);
    var inner = esc(M.stepLabel(key));
    var attrs = ' id="cm-pts-step-' + M.stepId(key) + '" aria-label="' + esc(name) + '" title="' + esc(name) + '"';
    var pill = v.editing
      ? '<button type="button" class="cm-pts-pill' +
        (on ? ' is-on' : '') +
        '"' +
        attrs +
        ' data-action="cmPtsPick" data-kind="step" data-key="' +
        esc(key) +
        '" aria-pressed="' +
        on +
        '">' +
        inner +
        '</button>'
      : '<span class="cm-pts-pill" role="img"' + attrs + '>' + inner + '</span>';
    return (
      '<div class="cm-pts-marker lv-' +
      key.charAt(0) +
      (rowsNow[i] ? ' is-low' : '') +
      (on ? ' is-on' : '') +
      '" data-key="' +
      esc(key) +
      '" style="left:' +
      M.left(val) +
      '">' +
      pill +
      '<span class="cm-pts-stem" aria-hidden="true"></span></div>'
    );
  }

  function bandsHtml(at) {
    var cuts = [0, at[2], at[3], at[4], 100];
    var n = M.names();
    return [1, 2, 3, 4]
      .map(function (l) {
        return (
          '<span class="cm-pts-band lv-' +
          l +
          '" data-lv="' +
          l +
          '" style="width:' +
          Math.max(0, cuts[l] - cuts[l - 1]) +
          '%">' +
          esc(n[l]) +
          '</span>'
        );
      })
      .join('');
  }

  function edgeHtml(v, l, at) {
    var on = v.editing && isPicked(v.pick, 'edge', l);
    var name = M.names()[l] + ' starts at ' + at[l] + '%';
    var attrs = ' id="cm-pts-edge-' + l + '" aria-label="' + esc(name) + '" title="' + esc(name) + '"';
    var tab = v.editing
      ? '<button type="button" class="cm-pts-handle' +
        (on ? ' is-on' : '') +
        '"' +
        attrs +
        ' data-action="cmPtsPick" data-kind="edge" data-level="' +
        l +
        '" aria-pressed="' +
        on +
        '">' +
        esc(at[l] + '%') +
        '</button>'
      : '<span class="cm-pts-handle" role="img"' + attrs + '>' + esc(at[l] + '%') + '</span>';
    return (
      '<div class="cm-pts-edge' +
      (on ? ' is-on' : '') +
      '" data-level="' +
      l +
      '" style="left:' +
      M.left(at[l]) +
      '"><span class="cm-pts-edge-line" aria-hidden="true"></span>' +
      tab +
      '</div>'
    );
  }

  // html-safe: fixed markup and numbers
  // A dotted line from a ghost to its live marker.
  function tethersHtml(plan) {
    return plan.tethers
      .map(function (t) {
        return (
          '<span class="cm-pts-tether' +
          (t.low ? ' is-low' : '') +
          '" style="left:' +
          M.left(t.at) +
          ';width:' +
          t.width +
          '%" aria-hidden="true"></span>'
        );
      })
      .join('');
  }
  // html-safe: fixed markup, numbers and esc-escaped keys and titles
  // A dashed pill, or a small ring, where a step was saved.
  function stepGhostsHtml(plan) {
    return plan.ghosts
      .map(function (g) {
        return (
          '<div class="cm-pts-marker cm-pts-ghost lv-' +
          g.key.charAt(0) +
          (g.low ? ' is-low' : '') +
          (g.ring ? ' is-ring' : '') +
          '" data-key="' +
          esc(g.key) +
          '" style="left:' +
          M.left(g.at) +
          '"><button type="button" class="cm-pts-pill" data-action="cmPtsGhost" data-kind="step" data-key="' +
          esc(g.key) +
          '" aria-label="' +
          esc(g.title) +
          '" title="' +
          esc(g.title) +
          '">' +
          esc(g.label) +
          '</button><span class="cm-pts-stem" aria-hidden="true"></span></div>'
        );
      })
      .join('');
  }
  // html-safe: fixed markup, numbers and esc-escaped titles
  // A dashed line and tab where a band started.
  function edgeGhostsHtml(plan) {
    return plan.edges
      .map(function (e) {
        return (
          '<div class="cm-pts-edge cm-pts-ghost" data-level="' +
          e.level +
          '" style="left:' +
          M.left(e.at) +
          '"><span class="cm-pts-edge-line" aria-hidden="true"></span>' +
          '<button type="button" class="cm-pts-handle" data-action="cmPtsGhost" data-kind="edge" data-level="' +
          e.level +
          '" aria-label="' +
          esc(e.title) +
          '" title="' +
          esc(e.title) +
          '">' +
          esc(e.label) +
          '</button></div>'
        );
      })
      .join('');
  }
  /* The marks left behind where the saved scale had them: a dotted tether
     // html-safe: its parts are fixed markup, numbers and esc-escaped keys and labels
     to the live marker, a dashed pill or ring, a dashed line and tab. */
  function ghostsHtml(plan) {
    return tethersHtml(plan) + stepGhostsHtml(plan) + edgeGhostsHtml(plan);
  }

  // The line to type a picked marker's or handle's percent in.
  function typeHtml(v) {
    var pick = v.pick;
    if (!v.editing || !pick) return '';
    var isStep = pick.kind === 'step';
    var at = M.starts(v.shown);
    var value =
      v.typed != null ? v.typed : isStep ? M.pctText(M.stepValues(v.shown)[pick.key]) : String(at[pick.level]);
    return (
      '<label class="cm-pts-edit-label" for="cm-pts-input"><span class="cm-pts-edit-name">' +
      esc(isStep ? M.stepLabel(pick.key) : M.names()[pick.level]) +
      '</span> ' +
      (isStep ? 'counts as' : 'starts at') +
      '</label>' +
      '<input class="cm-input cm-pts-input" type="number" id="cm-pts-input" ' +
      (isStep ? 'min="0" max="100" step="0.1"' : 'min="1" max="99" step="1"') +
      ' value="' +
      esc(value) +
      '" data-action-change="cmPointsScale" data-action-input="cmPtsLive"' +
      (v.error ? ' aria-invalid="true" aria-describedby="cm-pts-error"' : '') +
      '><span class="cm-pts-unit">%</span>'
    );
  }

  // Use in Other Classes… and Edit at rest; Cancel and Save while editing.
  function headHtml(v) {
    var buttons = v.editing
      ? '<button type="button" class="cm-action-btn" id="cm-pts-cancel" data-action="cmPtsCancel">Cancel</button>' +
        '<button type="button" class="cm-pts-btn-fill" id="cm-pts-save" data-action="cmPtsSave"' +
        (v.dirty ? '' : ' disabled') +
        '>Save</button>'
      : '<button type="button" class="cm-action-btn" id="cm-pts-use" data-action="cmPtsUse">Use in Other Classes…</button>' +
        '<button type="button" class="cm-pts-btn-tint" id="cm-pts-edit-btn" data-action="cmPtsEdit">Edit</button>';
    return (
      '<div class="cm-pts-head"><span class="cm-label" id="cm-pts-label">Points and Proficiency</span>' +
      '<div class="cm-pts-head-actions">' +
      buttons +
      '</div></div>'
    );
  }

  // The line under the ruler while editing: the box for a picked marker, the refusal, and the grade preview.
  function editRowHtml(v) {
    if (!v.editing) return '';
    return (
      '<div class="cm-pts-edit">' +
      typeHtml(v) +
      '<span class="cm-pts-preview" id="cm-pts-preview">' +
      (v.preview || '') +
      '</span></div>' +
      (v.error ? '<div class="cm-pts-error" id="cm-pts-error" role="alert">' + esc(v.error) + '</div>' : '')
    );
  }

  /* v: { cid, editing, shown (the scale on the ruler), saved, pick, typed,
     error, previewing, dirty }. */
  function render(v) {
    var steps = M.values(v.shown);
    var rowsNow = M.rows(steps);
    var plan = v.editing ? M.ghosts(v.saved, v.shown, v.previewing) : null;
    // Editing always keeps the room for two rows: a preview or a drag that needs the second one must not
    // move the presets below it from under the pointer (the button would leave and the press be lost).
    var two = v.editing || rowsNow.indexOf(1) >= 0;
    var at = M.starts(v.shown);
    var markers = COUNTS_AS_STEPS.map(function (s, i) {
      return markerHtml(v, i, rowsNow);
    }).join('');
    var edges = [2, 3, 4]
      .map(function (l) {
        return edgeHtml(v, l, at);
      })
      .join('');
    var ticks = TICKS.map(function (t) {
      return '<span style="left:' + t + '%">' + t + '%</span>';
    }).join('');
    return (
      '<div class="cm-pts-scale">' +
      headHtml(v) +
      (v.notice || '') +
      CmGradingBars.renderScaleHint(v.editing) +
      '<div class="cm-pts-scroll ' +
      (v.editing ? 'is-editing' : 'is-rest') +
      '"><div class="cm-pts-ruler' +
      (two ? ' is-two-rows' : '') +
      '" id="cm-pts-ruler" role="group" aria-labelledby="cm-pts-label">' +
      markers +
      '<div class="cm-pts-marks" id="cm-pts-marks">' +
      (plan ? ghostsHtml(plan) : '') +
      '</div>' +
      '<div class="cm-pts-bands" aria-hidden="true">' +
      bandsHtml(at) +
      '</div>' +
      edges +
      '<div class="cm-pts-ticks" aria-hidden="true">' +
      ticks +
      '</div></div></div>' +
      editRowHtml(v) +
      (v.editing ? CmGradingBars.renderPresets(v.shown) : '') +
      '</div>'
    );
  }

  /* Moves what is on the page to a scale, with no redraw: the markers, bands
     and handles, the two-row height and the ghosts. glide: let the markers
     slide there (a preview), not jump (a drag). */
  function sync(root, v, glide) {
    var ruler = root && root.querySelector && root.querySelector('#cm-pts-ruler');
    if (!ruler || typeof CSS === 'undefined' || !CSS.escape) return;
    var steps = M.values(v.shown);
    var rowsNow = M.rows(steps);
    var at = M.starts(v.shown);
    var plan = M.ghosts(v.saved, v.shown, v.previewing);
    ruler.classList.toggle('is-gliding', !!glide);
    ruler.classList.toggle('is-two-rows', true);
    COUNTS_AS_STEPS.forEach(function (s, i) {
      var m = ruler.querySelector('.cm-pts-marker[data-key="' + CSS.escape(s.key) + '"]:not(.cm-pts-ghost)');
      if (!m) return;
      m.style.left = M.left(steps[i]);
      m.classList.toggle('is-low', rowsNow[i] === 1);
      var pill = m.querySelector('.cm-pts-pill');
      var name = markerName(s.key, steps[i], v.shown);
      if (pill) {
        pill.setAttribute('aria-label', name);
        pill.setAttribute('title', name);
      }
    });
    var cuts = [0, at[2], at[3], at[4], 100];
    [1, 2, 3, 4].forEach(function (l) {
      var band = ruler.querySelector('.cm-pts-band[data-lv="' + l + '"]');
      if (band) band.style.width = Math.max(0, cuts[l] - cuts[l - 1]) + '%';
      var edge = l > 1 && ruler.querySelector('.cm-pts-edge[data-level="' + l + '"]:not(.cm-pts-ghost)');
      if (!edge) return;
      edge.style.left = M.left(at[l]);
      var tab = edge.querySelector('.cm-pts-handle');
      if (tab) {
        tab.textContent = at[l] + '%';
        tab.setAttribute('aria-label', M.names()[l] + ' starts at ' + at[l] + '%');
        tab.setAttribute('title', M.names()[l] + ' starts at ' + at[l] + '%');
      }
    });
    var layer = ruler.querySelector('#cm-pts-marks');
    if (layer) layer.innerHTML = ghostsHtml(plan);
  }

  /* Brings the notice into view (smooth; at once with Reduce Motion) and puts the
     focus on it, so a screen reader reads it once: it has no live-region role. */
  function revealNotice() {
    var el = /** @type {HTMLElement | null} */ (document.querySelector('.cm-pts-scale .cm-cat-notice'));
    if (!el) return;
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  }
  // The line the categories use, with its What You Typed list and Dismiss (cm-cat-notice).
  // html-safe: the sentence is a constant; each typed line through esc
  function noticeHtml(n) {
    return (
      '<div class="cm-cat-notice" tabindex="-1"><div class="cm-cat-notice-text">' +
      'Points and Proficiency changed on another device, so nothing was saved. These are the current ones. What you typed is below.' +
      '</div><div class="cm-cat-typed"><div class="cm-cat-typed-label">What You Typed</div><ul>' +
      n.typed
        .map(function (l) {
          return '<li>' + esc(l) + '</li>';
        })
        .join('') +
      '</ul></div><button class="cm-add-link" data-action="cmPtsNoticeDone">Dismiss</button></div>'
    );
  }

  return { render: render, noticeHtml: noticeHtml, revealNotice: revealNotice, sync: sync, markerName: markerName };
})();
