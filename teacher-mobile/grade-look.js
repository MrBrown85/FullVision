// @ts-check
/* grade-look.js — the phone grader in the new look
   (docs/plans/phone-look-plan.md, L1).

   With the phoneLook switch off, every answer here is empty and the grader
   is what it was. On, <html> carries m-look, teacher-mobile/look.css
   restyles the grader's own markup, and this file adds the three things a
   style cannot: who is on screen in the top bar, the class list behind that
   name, and the ⋯ sheet. tab-grade.js asks for those pieces as it draws;
   the taps on them are heard here. */
/** @type {any} */ (window).MGradeLook = (function () {
  'use strict';

  /** @type {any} */
  var W = window;
  var MORE =
    '<svg width="18" height="4" viewBox="0 0 18 4" aria-hidden="true"><circle cx="2" cy="2" r="2" fill="currentColor"/><circle cx="9" cy="2" r="2" fill="currentColor"/><circle cx="16" cy="2" r="2" fill="currentColor"/></svg>';

  // The grading screen's class and cards, as renderSwiper last drew them.
  /** @type {string | null} */
  var _cid = null;
  /** @type {any[]} */
  var _units = [];

  function on() {
    return !!(W.BuildFlags && W.BuildFlags.on('phoneLook'));
  }
  function _mark() {
    var look = on();
    if (document.documentElement) document.documentElement.classList.toggle('m-look', look);
    return look;
  }
  _mark();

  /** @param {any} s */
  function _esc(s) {
    return W.MComponents.esc(s);
  }
  /** @param {any} st */
  function _first(st) {
    return displayNameFirst(st) || displayName(st);
  }

  /* Who a card is: the student; a pair by its two first names; a bigger
     group by its label ("Group 2"). */
  /** @param {string} cid @param {any} unit */
  function unitName(cid, unit) {
    if (!unit.view) return displayName(unit.st);
    var students = getStudents(cid);
    var firsts = unit.view.members.map(function (/** @type {string} */ m) {
      var st = students.find(function (x) {
        return x.id === m;
      });
      return st ? _first(st) : '';
    });
    return firsts.length === 2 && firsts[0] && firsts[1] ? firsts[0] + ' and ' + firsts[1] : unit.label;
  }

  /* What the grading screen's bar takes: the first card's name as a title
     that opens the class list, and ⋯. One student's work has a bar that
     names the student already; it takes only ⋯. */
  // html-safe: fixed markup
  /** @param {string} cid @param {any[]} units @param {boolean} oneStudent */
  function bar(cid, units, oneStudent) {
    var look = _mark();
    _cid = cid;
    _units = look ? units : [];
    if (!look) return { title: '', titleAction: '', more: '' };
    var named = !oneStudent && units.length > 0;
    return {
      title: named ? unitName(cid, units[0]) : '',
      titleAction: named ? 'm-grade-roster' : '',
      more:
        '<button type="button" class="m-grade-more" data-action="m-grade-more" aria-label="More">' + MORE + '</button>',
    };
  }

  // The bar names the card now on screen.
  /** @param {number} idx */
  function show(idx) {
    var el = document.querySelector('#m-nav-bar-grade-swiper .m-nav-title-text');
    if (el && _cid && _units[idx]) el.textContent = unitName(_cid, _units[idx]);
  }

  // "Comment for Maya": the Overall Comment, named for who it is to. '' with the switch off.
  /** @param {string} cid @param {any} st @param {any} unit */
  function commentLabel(cid, st, unit) {
    if (!on()) return '';
    return 'Comment for ' + (unit && unit.view ? unitName(cid, unit) : _first(st));
  }

  // The marks in a box of their own, which look.css draws as the second card.
  // html-safe: wraps markup tab-grade.js built
  /** @param {string} html */
  function marks(html) {
    return on() ? '<div class="m-grade-marks">' + html + '</div>' : html;
  }

  /* The class list, from the name in the bar: the cards in their order, each
     by its name, a tick on each one the strip has as graded. A tap goes to
     that card, as a tap on the strip does (m-grade-jump). */
  // html-safe: names go through esc; the index is a number
  function openRoster() {
    if (!_cid) return;
    var cid = _cid;
    var thumbs = document.querySelectorAll('#m-thumb-strip .m-thumb');
    var at = W.MGrade.getCurrentIndex();
    var rows = _units
      .map(function (unit, idx) {
        var graded = !!thumbs[idx] && thumbs[idx].classList.contains('m-thumb-graded');
        return (
          '<button type="button" class="m-roster-row" data-action="m-grade-jump" data-idx="' +
          idx +
          '"' +
          (idx === at ? ' aria-current="true"' : '') +
          '><span>' +
          _esc(unitName(cid, unit)) +
          '</span>' +
          (graded ? '<span class="m-roster-graded">Graded</span>' : '') +
          '</button>'
        );
      })
      .join('');
    if (rows) W.MComponents.presentSheet('<div class="m-roster">' + rows + '</div>');
  }

  /* ⋯ in the bar: what the card on screen rarely needs. Each is the piece
     the card already draws, shown here with the action it already has:
     Missing, Excused and Late (a group's members each have theirs, with
     Grade Separately), Competencies or Rubric, and Unsubmit. */
  // html-safe: the name goes through esc; the rest is markup tab-grade.js and grade-photos.js drew
  function openMore() {
    var screen = document.getElementById('m-screen-grade-swiper');
    var idx = W.MGrade.getCurrentIndex();
    var card = screen && screen.querySelectorAll('#m-swiper .m-swiper-card')[idx];
    var unit = _units[idx];
    if (!screen || !card || !unit || !_cid) return;
    var html = '';
    /** @type {[Element, string][]} */
    var parts = [
      [card, '.m-grade-student-header .m-status-row, .m-group-members'],
      [card, '.m-grade-student-header .m-status-hint:not([hidden])'],
      [screen, '.m-grade-view-row .m-segmented'],
      [card, '.m-work-unsubmit'],
    ];
    parts.forEach(function (part) {
      var el = part[0].querySelector(part[1]);
      if (el) html += el.outerHTML;
    });
    if (!html) return;
    W.MComponents.presentSheet(
      '<div class="m-more-sheet"><div class="m-group-sheet-title">' +
        _esc(unitName(_cid, unit)) +
        '</div>' +
        html +
        '</div>',
      { half: true },
    );
  }

  document.addEventListener('click', function (e) {
    var target = e.target instanceof Element ? e.target.closest('[data-action]') : null;
    if (!target) return;
    var action = target.getAttribute('data-action');
    if (action === 'm-grade-roster') return openRoster();
    if (action === 'm-grade-more') return openMore();
    // A choice made in the ⋯ sheet or the class list is done: the sheet goes,
    // and shell.js acts on the tap as it does on the card's own.
    if (
      (action === 'm-grade-view' || action === 'm-grade-status' || action === 'm-grade-jump') &&
      target.closest('.m-more-sheet, .m-roster')
    )
      W.MComponents.dismissSheet();
  });

  return { on: on, bar: bar, show: show, commentLabel: commentLabel, marks: marks, unitName: unitName };
})();
