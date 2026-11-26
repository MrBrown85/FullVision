// @ts-check
/* report-qn-boxes.js — how the Term Questionnaire's Sentences card draws a
   part: the box, its head line (a tile, the part's name and, at the right,
   the evidence the sentence rests on) and the evidence's small shapes.
   Look only (docs/plans/term-questionnaire-redesign-plan.md, slice 1). It
   keeps no state, reads no marks and words no grade: the caller hands in
   text already worded by calc.js and its helpers. */
window.ReportQnBoxes = (function () {
  'use strict';

  /* Each part's tile colour and glyph (a 16 by 16 box, stroke 2, round
     caps, no fill), from the approved artboard. */
  var LOOK = {
    grade: { label: 'Grade', tint: '#0066cc', icon: 'M3.5 13V9.5M8 13V6M12.5 13V3' },
    bestPiece: {
      label: 'Best Piece',
      tint: '#a8690a',
      icon: 'M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4L2.2 6.5l4-.6z',
    },
    strengths: { label: 'Strength', tint: '#2e7d4f', icon: 'M3 8.5l3.2 3.2L13 4.8' },
    habits: {
      label: 'Work Habits',
      tint: '#6b4fbb',
      icon: 'M8 2.4a5.6 5.6 0 1 0 0 11.2 5.6 5.6 0 1 0 0-11.2M8 4.8V8l2.2 1.6',
    },
    attendance: { label: 'Attendance', tint: '#3f6fb5', icon: 'M3 4h10v9H3zM3 7h10M5.5 2.5v3M10.5 2.5v3' },
    voice: { label: 'Voice', tint: '#b83a72', icon: 'M2.8 3.5h10.4v7H7.4L4.4 13v-2.5H2.8z' },
    notHandedIn: { label: 'Missing Work', tint: '#a35f00', icon: 'M4 2.5h5.5l3 3v8H4zM9.5 2.5v3h3' },
    nextStep: { label: 'Next Step', tint: '#0f7b83', icon: 'M3 8h10M9 4l4 4-4 4' },
    support: { label: 'Support', tint: '#0f7b83', icon: 'M8 3v10M3 8h10' },
    closing: { label: 'Closing', tint: '#5b5b60', icon: 'M4 14V2.5M4 3h8l-2 3 2 3H4' },
    /* The left cards that are not a sentence part (slice 7). */
    glance: { label: 'At a Glance', tint: '#5b5b60', icon: 'M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z' },
    change: { label: 'Biggest Change', tint: '#5b5b60', icon: 'M2.5 11l3.5-3.5 2.5 2.5 5-5M10 5h3.5v3.5' },
    observations: {
      label: 'Observations',
      tint: '#5856d6',
      icon: 'M1.8 8s2.3-4.3 6.2-4.3S14.2 8 14.2 8s-2.3 4.3-6.2 4.3S1.8 8 1.8 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 1 0 0-3.6',
    },
  };
  /* Every other part (Your Sentence, Statement, Problem, Plan, Deadline,
     Meeting, Example, Earlier Comment, Language Goals) keeps its own name
     under the Your Sentence slate tile. */
  var OTHER = { label: '', tint: '#44546a', icon: 'M3 13l.6-2.8L10.8 3 13 5.2l-7.2 7.2z' };

  /** @param {string} s */
  function _esc(s) {
    return esc(s);
  }

  /** @param {string} kind @param {string} label */
  function look(kind, label) {
    var l = LOOK[kind];
    return l
      ? { label: label || l.label, tint: l.tint, icon: l.icon }
      : { label: label, tint: OTHER.tint, icon: OTHER.icon };
  }

  // html-safe: the glyph path and colour are fixed strings from LOOK
  function _tile(l) {
    return `<span class="qn-box-tile" style="background:${l.tint}" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${l.icon}"></path></svg></span>`;
  }

  /* One part's box: its head line, then the rows (already drawn). opts:
     { kind, label, evidence (html from the shapes below), chip (html) }. */
  // html-safe: kind is a fixed key, label and the chip text esc()'d, evidence and rows are html the caller drew with esc()
  function box(opts, rows) {
    var l = look(opts.kind, opts.label);
    var chip = opts.required
      ? `<span class="qn-req-chip" title="${_esc(opts.requiredTip || 'Required.')}">Required</span>`
      : '';
    return `<div class="qn-box" data-bk="${_esc(opts.bk || opts.kind)}" data-part="${_esc(opts.kind)}" role="group" aria-label="${_esc(l.label)}">
      <div class="qn-box-head">${_tile(l)}<span class="qn-box-name">${_esc(l.label)}</span>${chip}<span class="qn-box-evidence">${opts.evidence || ''}</span></div>
      ${rows}
    </div>`;
  }

  /* ── The evidence's shapes ─────────────────────────────── */

  /** A fact as text, already worded by the caller. @param {string} text */
  function fact(text) {
    return text ? `<span class="qn-ev-text">${_esc(text)}</span>` : '';
  }

  /** A piece's title and its result in a small badge. @param {string} title @param {string} mark */
  function piece(title, mark) {
    return fact(title) + (mark ? `<span class="qn-ev-badge">${_esc(mark)}</span>` : '');
  }

  /* The six habit ratings as bars: Rarely to Consistently stand 6, 9, 12
     and 15 px tall; a habit not rated is a short grey stub. ratings: six
     numbers, 0 for not rated. */
  var BAR_H = [6, 9, 12, 15];
  /** @param {number[]} ratings @param {string} words the ratings in words, for a reader */
  function bars(ratings, words) {
    var b = ratings
      .map(function (v) {
        var h = BAR_H[v - 1];
        return h
          ? `<span class="qn-ev-bar" style="height:${h}px"></span>`
          : '<span class="qn-ev-bar off" style="height:4px"></span>';
      })
      .join('');
    return `<span class="qn-ev-bars" role="img" aria-label="${_esc(words)}">${b}</span>`;
  }

  /** A track filled to the share, then "N of M". @param {number} n @param {number} total */
  function missingTrack(n, total) {
    return `<span class="qn-ev-track" aria-hidden="true" style="--n:${Number(n) || 0};--t:${Math.max(1, Number(total) || 0)}"><span></span></span><span class="qn-ev-text">${n} of ${total}</span>`;
  }

  /* The labels of the parts that are not one of LOOK's. */
  var LABELS = {
    yours: 'Your Sentence',
    earlier: 'Earlier Comment',
    statement: 'Statement',
    example: 'Example',
    languageGoals: 'Language Goals',
    ieProblem: 'Problem',
    iePlan: 'Plan',
    ieDeadline: 'Deadline',
    ieMeeting: 'Meeting',
  };

  /* What a part's sentence rests on, drawn from the facts the caller
     worded (see _boxFacts in report-questionnaire.js). */
  function evidence(kind, d) {
    if (kind === 'grade') return d.grade && d.grade !== '—' ? fact(d.grade) : '';
    if (kind === 'bestPiece') return d.piece ? piece(d.piece.title, d.piece.mark) : '';
    if (kind === 'strengths' || kind === 'nextStep')
      return d.comp ? fact(d.comp.level ? d.comp.name + ' · ' + d.comp.level : d.comp.name) : '';
    if (kind === 'habits' && d.habits) {
      var words = d.habits
        .map(function (h) {
          return h.name + ': ' + (h.v ? d.scale[h.v - 1] : 'Not rated');
        })
        .join(', ');
      return bars(
        d.habits.map(function (h) {
          return h.v;
        }),
        words,
      );
    }
    if (kind === 'attendance' && d.absent != null) return fact(d.absent + ' Absent · ' + d.late + ' Late');
    if (kind === 'voice') return fact(d.goal ? 'Goal Check-In' : 'About Me');
    if (kind === 'notHandedIn' && d.total != null) return missingTrack(d.missing, d.total);
    return '';
  }

  /* Rows that sit together in one part as one box each. entries: [{ kind,
     html, row (the first sentence's row), label, required }] in the card's
     order. Support that follows the Next Step joins its box. opts: { first
     (the student's first name, for "Liam’s Voice"), facts(kind, row) }. */
  // html-safe: the boxes are drawn by box(), which esc()s every text
  function wrap(entries, opts) {
    var out = '';
    var seen = /** @type {Record<string, number>} */ ({});
    /** @type {any} */
    var cur = null;
    var flush = function () {
      if (!cur) return;
      var kind = cur.kind;
      var label = LABELS[kind] || (kind === 'voice' ? opts.first + '’s Voice' : cur.label || '');
      seen[kind] = (seen[kind] || 0) + 1;
      out += box(
        {
          bk: kind + '#' + seen[kind],
          kind: kind,
          label: label,
          required: cur.required,
          requiredTip: opts.requiredTip,
          evidence: evidence(kind, opts.facts(kind, cur.row)),
        },
        cur.html,
      );
      cur = null;
    };
    entries.forEach(function (e) {
      var joins = cur && (cur.kind === e.kind || (e.kind === 'support' && cur.kind === 'nextStep'));
      if (!joins) {
        flush();
        cur = { kind: e.kind, row: e.row, label: e.label, required: !!e.required, html: '' };
      }
      cur.html += e.html;
    });
    flush();
    return out;
  }

  /* The head line of a left card (slice 7): the same tile, name and type as
     a box's. right is html the caller drew with esc(). */
  // html-safe: kind is a fixed key, label esc()'d, right is html the caller drew with esc()
  function head(kind, label, right) {
    var l = look(kind, label);
    return `<div class="qn-card-top qn-box-head">${_tile(l)}<span class="qn-box-name">${_esc(l.label)}</span><span class="qn-box-evidence">${right || ''}</span></div>`;
  }

  /** The small tile alone, for a row. @param {string} kind */
  function tile(kind) {
    return _tile(look(kind, ''));
  }

  /* A card and its sentence light each other (slice 7): pointing at or
     focusing a left card or row (data-lit) or a box (data-part)
     lights every element of the same part on the page. A tint and ring in
     the part's colour (reports.css, .qn-lit); nothing moves. Wired once. */
  var _lightWired = false;
  /* A lit thing is a left card or row (data-lit) or a Sentences box (its
     data-part); both name the same part. */
  var LIT = '[data-lit], .qn-box[data-part]';
  /** @param {Element|null} from */
  function _partOf(from) {
    var el = from && from.closest ? from.closest(LIT) : null;
    if (!el) return '';
    return el.getAttribute('data-lit') || el.getAttribute('data-part') || '';
  }
  /** @param {string} part @param {boolean} on */
  function _set(part, on) {
    document.querySelectorAll('.qn-left, .qn-right').forEach(function (side) {
      side.querySelectorAll('[data-lit="' + part + '"], .qn-box[data-part="' + part + '"]').forEach(function (el) {
        el.classList.toggle('qn-lit', on);
      });
    });
  }
  function wireLight() {
    if (_lightWired || typeof document === 'undefined' || !document.addEventListener) return;
    _lightWired = true;
    /** @type {string} */
    var cur = '';
    /** @param {string} part */
    var go = function (part) {
      if (part === cur) {
        if (part) _set(part, true); // the card was redrawn under the pointer
        return;
      }
      if (cur) _set(cur, false);
      cur = part;
      if (part) _set(part, true);
    };
    var on = function (/** @type {Event} */ e) {
      go(_partOf(/** @type {Element} */ (e.target)));
    };
    document.addEventListener('mouseover', on);
    document.addEventListener('focusin', on);
    document.addEventListener('mouseout', function (e) {
      if (!e.relatedTarget) go('');
    });
    document.addEventListener('focusout', function (e) {
      if (!e.relatedTarget) go('');
    });
  }

  return {
    look: look,
    box: box,
    wrap: wrap,
    evidence: evidence,
    head: head,
    tile: tile,
    wireLight: wireLight,
    LOOK: LOOK,
  };
})();
