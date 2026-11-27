// @ts-check
/* ── student-comps.js — Your Competencies, on the student Overview ──────
   The card under the grade on the teacher's student page (DECISIONS, "Your
   Competencies at a glance (2026-11-27)"): how the levels split, then the
   strongest competencies and the next to work on, each by name as a bar in
   its level's colour, for a teacher and a student reading one screen
   together. See All opens the Competencies tab, which lists every one.

   rank is also the Competencies tab's Strongest and Next to Work On line
   (teacher/page-student.js), so the two never disagree.

   teacher/page-student.js builds the model; every number and word in it
   comes from calc.js in the class's grading style. Nothing here works a
   grade out. Text goes into HTML through esc. teacher/student-overview.js
   wires the pointing and the first tap on an iPad. */
window.StudentComps = (function () {
  'use strict';

  /* Strongest and Next to Work On, here and in the Competencies tab's line:
     only competencies with enough scores for Since the Start (x.enough), so
     neither rests on one score. Up to a third of them each way, three at
     most; on a tie, the one with more scores. No level sits on both sides.
       items  [{ v: level, n: scores, enough, text: the level as shown }] */
  function rank(items) {
    var ok = (items || []).filter(function (x) {
      return x.enough && x.v > 0;
    });
    var by = function (dir) {
      return ok.slice().sort(function (a, b) {
        return dir * (a.v - b.v) || b.n - a.n;
      });
    };
    var up = by(-1);
    var down = by(1);
    var hi = up.slice(0, 1);
    var lo = down[0] && down[0] !== up[0] ? [down[0]] : [];
    var max = Math.max(1, Math.min(3, Math.floor(ok.length / 3)));
    var fill = function (from, side, other) {
      from.forEach(function (x) {
        var apart = other.every(function (y) {
          return y.v !== x.v && (y.text == null || y.text !== x.text);
        });
        if (side.length < max && side.indexOf(x) < 0 && other.indexOf(x) < 0 && apart) side.push(x);
      });
    };
    fill(up, hi, lo);
    fill(down, lo, hi);
    return { hi: hi, lo: lo };
  }

  // One competency by name: its level as the class shows it, and which way it has moved.
  function _barHtml(m, it) {
    var on = m.compFilter === it.id;
    var grade = it.text + (it.word ? ' ' + it.word : '');
    var tip = it.trend ? ['<span>' + esc(it.trend) + '</span>'] : [];
    if (it.pieces)
      tip.push(
        '<span class="stu-gp-tip-hint">' +
          (on ? 'Show all work' : 'Show its ' + it.pieces + (it.pieces === 1 ? ' piece' : ' pieces')) +
          '</span>',
      );
    var arrow = it.dir === 'up' ? '↑' : it.dir === 'down' ? '↓' : '';
    return (
      '<button type="button" class="stu-gp-tile stu-gp-lv-' +
      it.lv +
      '" data-action="stuGpComp" data-sec="' +
      esc(it.id) +
      '" data-lv="' +
      it.lv +
      '" data-aids="' +
      esc(it.aids.join(' ')) +
      '" aria-pressed="' +
      on +
      '" aria-label="' +
      esc(it.name + ': ' + grade + (it.trend ? ', ' + it.trend : '')) +
      '"' +
      (it.pieces ? '' : ' disabled') +
      '><span class="stu-gp-name">' +
      esc(it.name) +
      '</span><span class="stu-gp-val"><b>' +
      esc(it.text) +
      '</b>' +
      esc(it.word) +
      (arrow ? '<span class="stu-gp-arr ' + it.dir + '">' + arrow + '</span>' : '') +
      '</span>' +
      (tip.length ? '<span class="stu-gp-tip" role="tooltip">' + tip.join('') + '</span>' : '') +
      '</button>'
    );
  }

  // How the levels split: a Proficiency or Both class names its levels (a Letter class does not).
  function _splitHtml(counts) {
    if (!counts.length) return '';
    var said = counts.map(function (k) {
      return k.n + ' ' + k.name;
    });
    var out = '<div class="stu-gp-seg" role="img" aria-label="' + esc(said.join(', ')) + '">';
    counts.forEach(function (k) {
      out +=
        '<span class="stu-gp-seg-part stu-gp-lv-' +
        k.lv +
        '" style="flex:' +
        k.n +
        ' 1 0" data-lv="' +
        k.lv +
        '" title="' +
        esc(k.n + ' ' + k.name) +
        '">' +
        k.n +
        '</span>';
    });
    out += '</div><div class="stu-gp-key" aria-hidden="true">';
    counts.forEach(function (k) {
      out += '<span data-lv="' + k.lv + '"><i class="stu-gp-lv-' + k.lv + '"></i>' + esc(k.name) + '</span>';
    });
    return out + '</div>';
  }

  // A named group of bars; wide when nothing sits beside it.
  function _groupHtml(m, label, list, wide) {
    if (!list.length) return '';
    var bars = list.map(function (it) {
      return _barHtml(m, it);
    });
    return (
      '<div class="stu-gp-group' +
      (wide ? ' wide' : '') +
      '"><span class="stu-ov-label">' +
      label +
      '</span>' +
      bars.join('') +
      '</div>'
    );
  }

  function html(m) {
    var c = m.comps;
    if (!c.total) return '';
    var head =
      '<section class="stu-gp-card stu-gp-comps" aria-label="Your competencies"><div class="stu-gp-head">' +
      '<h3 class="stu-ov-h3">Your Competencies</h3>';
    if (!c.scored) return head + '<span class="stu-gp-sub">None of ' + c.total + ' assessed yet</span></div></section>';
    var r = rank(c.items);
    var scored = c.items.filter(function (it) {
      return it.v > 0;
    });
    return (
      head +
      '<button type="button" class="stu-gp-all" data-action="stuTab" data-tab="comps">See All ' +
      c.total +
      '</button></div>' +
      _splitHtml(c.counts) +
      '<div class="stu-gp-groups">' +
      // Nothing with enough scores to rank yet: what is assessed so far, in curriculum order.
      (r.hi.length
        ? _groupHtml(m, 'Strongest', r.hi, !r.lo.length) + _groupHtml(m, 'Next to Work On', r.lo, false)
        : _groupHtml(m, 'Assessed So Far', scored.slice(0, 6), true)) +
      '</div></section>'
    );
  }

  return { html: html, rank: rank };
})();
