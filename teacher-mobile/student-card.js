// @ts-check
/* student-card.js — the Students card (docs/plans/phone-look-plan.md, L5):
   the student's My Learning, drawn as the board "Tweak Students" has it.

   One card: the name (a tap for All Students), the overall level in words
   with four bars up to it (a Letter class shows its letter, no bars),
   + Observe and Profile, To Grade, To Return, then the five newest pieces
   with a result and All N Pieces. No mark for a piece the student has not
   opened yet (Colin, Nov 27 2026: the blue dots took up attention for nothing
   the teacher acts on). The card's list scrolls inside it; tab-students.js
   says "More Below" when it runs past the bottom.

   Every tap is one the app already answers: m-all-students,
   m-obs-quick-menu, m-student-detail, m-assess-grade, m-card-return.
   Grades are worded only by calc.js and constants.js (assessmentCellValue,
   studentGradeSummary, levelWord, formatPoints). */
/** @type {any} */ (window).MStudentCard = (function () {
  'use strict';

  /** @type {any} */
  var W = window;
  var WORK_ROWS = 5;

  /** @param {any} s */
  function esc(s) {
    return W.MComponents.esc(s);
  }
  var CHEVRON =
    '<svg class="m-sc-chev" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5l5 5-5 5"/></svg>';

  // The overall grade as My Learning shows it: the level's word and four
  // bars up to it; a Letter class shows its letter and no bars.
  // html-safe: the word comes from constants.js or calc.js and goes through esc; the rest is fixed markup
  /** @param {string} cid @param {string} sid */
  function _levelHtml(cid, sid) {
    var grade = studentGradeSummary(cid, sid);
    var letter = courseGradeMode(cid) === 'letter';
    var lv = letter ? 0 : roundLevel(getOverallProficiency(cid, sid));
    var word = letter ? grade.text || '' : levelWord(cid, getOverallProficiency(cid, sid));
    if (!word) return '';
    var bars = '';
    if (lv > 0)
      for (var i = 1; i <= 4; i++)
        bars += '<span class="m-sc-bar' + (i <= lv ? ' is-on' : '') + (i === lv ? ' is-now' : '') + '"></span>';
    return (
      '<div class="m-sc-level l' +
      (grade.level || lv) +
      '"><span class="m-sc-word">' +
      esc(word) +
      '</span>' +
      (bars ? '<span class="m-sc-bars" aria-hidden="true">' + bars + '</span>' : '') +
      '</div>'
    );
  }

  /* A piece's result as a short pill: the class's level wording, the score
     out of its points, Complete, Missing or Excused. null with none. */
  /** @param {string} cid @param {string} sid @param {any} a */
  function _result(cid, sid, a) {
    var cell = assessmentCellValue(cid, sid, a);
    if (cell.status === 'NS') return { text: 'Missing', tone: 'miss' };
    if (cell.status === 'EXC') return { text: 'Excused', tone: 'none' };
    if (cell.kind === 'complete')
      return { text: cell.mark === 'complete' ? 'Complete' : 'Incomplete', tone: cell.mark === 'complete' ? '3' : '1' };
    if (cell.kind === 'points')
      return {
        text: formatPoints(cell.value) + ' / ' + formatPoints(a.maxPoints || 100),
        tone: String(cell.level || 0),
      };
    if (cell.kind === 'level' || (cell.kind === 'dibels' && cell.text !== '—'))
      return { text: cell.text, tone: String(cell.level || 0) };
    return null;
  }

  /* ── To Return ───────────────────────────────────────────────────
     In a class that holds grades until they are returned, the card lists
     the student's drafts: the work, the Draft mark, the grade and "Cece
     can’t see it yet", and Return. MGrade.studentDrafts is empty in any
     other class. The grade is the piece's cell (assessmentCellValue), as
     the profile's All Work shows it. */
  /** @param {string} cid @param {string} sid @param {any} a */
  function _draftGradeText(cid, sid, a) {
    var cell = assessmentCellValue(cid, sid, a);
    if (cell.kind === 'complete') return cell.mark === 'complete' ? 'Complete' : 'Incomplete';
    if (cell.kind === 'points' || cell.kind === 'level') return W.MStudentDetail.cellText(cell, a);
    return '';
  }

  // html-safe: the title, the grade and the name go through esc; ids are escaped
  /** @param {any} st @param {string} cid */
  function _toReturnHtml(st, cid) {
    var drafts = W.MGrade && W.MGrade.studentDrafts ? W.MGrade.studentDrafts(cid, st.id) : [];
    if (!drafts.length) return '';
    var cant = displayNameFirst(st) + ' can’t see it yet';
    return (
      '<div class="m-scard-return"><div class="m-scard-return-head">To Return</div>' +
      drafts
        .map(function (/** @type {any} */ a) {
          var grade = _draftGradeText(cid, st.id, a);
          return (
            '<div class="m-scard-return-row"><div class="m-scard-return-body">' +
            '<div class="m-scard-return-title">' +
            esc(a.title) +
            '</div>' +
            '<div class="m-scard-return-sub"><span class="m-draft-mark">Draft</span><span class="m-scard-return-text">' +
            esc((grade ? grade + ' · ' : '') + cant) +
            '</span></div></div>' +
            '<button type="button" class="m-return-btn" data-action="m-card-return" data-sid="' +
            esc(st.id) +
            '" data-aid="' +
            esc(a.id) +
            '" aria-label="' +
            esc('Return, ' + a.title) +
            '"><span>Return</span></button></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* The pieces with a result, newest first. */
  /** @param {string} cid @param {string} sid */
  function _pieces(cid, sid) {
    return getAssignedAssessments(cid)
      .filter(function (/** @type {any} */ a) {
        return typeof assessmentInYearToDate !== 'function' || assessmentInYearToDate(cid, a);
      })
      .slice()
      .sort(function (/** @type {any} */ a, /** @type {any} */ b) {
        return (b.date || '').localeCompare(a.date || '') || samePieceDateOrder(cid, b.id, a.id);
      })
      .map(function (/** @type {any} */ a) {
        return { a: a, r: _result(cid, sid, a) };
      })
      .filter(function (/** @type {any} */ p) {
        return p.r;
      });
  }

  /* The card. */
  // html-safe: names, titles and results go through esc; ids are escaped; the To Grade box is built (escaped) by grade-photos.js
  /** @param {any} st @param {string} cid */
  function render(st, cid) {
    var pieces = _pieces(cid, st.id);
    var rows = pieces
      .slice(0, WORK_ROWS)
      .map(function (/** @type {any} */ p) {
        return (
          '<button type="button" class="m-sc-row" data-action="m-assess-grade" data-sid="' +
          esc(st.id) +
          '" data-aid="' +
          esc(p.a.id) +
          '">' +
          '<span class="m-sc-row-title">' +
          esc(p.a.title) +
          '</span><span class="m-sc-pill t' +
          p.r.tone +
          '">' +
          esc(p.r.text) +
          '</span>' +
          CHEVRON +
          '</button>'
        );
      })
      .join('');
    var boxes = (W.MGradePhotos ? W.MGradePhotos.studentListHtml(cid, st) : '') + _toReturnHtml(st, cid);
    return (
      '<div class="m-scard">' +
      // The name row is the chooser: the one way to the class list.
      '<button type="button" class="m-sc-who" data-action="m-all-students" aria-haspopup="dialog"><span class="m-sc-avatar" style="background:' +
      W.MComponents.avatarColor(st.id) +
      '">' +
      esc(W.MComponents.avatarInitials(st)) +
      '</span><span class="m-sc-name">' +
      esc(displayName(st)) +
      '</span>' +
      '<svg width="12" height="18" viewBox="0 0 12 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6.5l4-4 4 4M2 11.5l4 4 4-4"/></svg></button>' +
      _levelHtml(cid, st.id) +
      '<div class="m-sc-acts"><button type="button" class="m-sc-observe" data-action="m-obs-quick-menu" data-sid="' +
      esc(st.id) +
      '">+ Observe</button><button type="button" class="m-sc-profile" data-action="m-student-detail" data-sid="' +
      esc(st.id) +
      '">Profile</button></div>' +
      '<div class="m-sc-list"><div class="m-sc-scroll">' +
      (boxes ? '<div class="m-sc-boxes">' + boxes + '</div>' : '') +
      (rows
        ? '<div class="m-sc-work">' +
          rows +
          (pieces.length > WORK_ROWS
            ? '<button type="button" class="m-sc-row m-sc-all" data-action="m-student-detail" data-sid="' +
              esc(st.id) +
              '"><span class="m-sc-row-title">All ' +
              pieces.length +
              ' Pieces</span>' +
              CHEVRON +
              '</button>'
            : '') +
          '</div>'
        : '') +
      '</div></div></div>'
    );
  }

  return { render: render };
})();
