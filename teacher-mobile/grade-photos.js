/* grade-photos.js — the student's work on the phone's grading card.

   The speed grader (teacher-mobile/tab-grade.js) asks this file what to draw
   between a card's name and its levels: the photos of the work a student
   sent, or a teacher added, for that piece. It is the one place the phone's
   grader reads student work, so the cards, the strip pinned at the top
   while a card scrolls, and the full-screen view all come from here.

   Nothing is drawn yet: no class sends work until Send Work is built
   (docs/plans/student-page-build-plan.md, slice S7). With nothing to show,
   cardHtml is '' and the card is exactly what it was. */

window.MGradePhotos = (function () {
  'use strict';

  /* What a grading card shows of `st`'s work on assessment `a` (on group
     work, `unit` is the group's card). html-safe: '' until work is shown. */
  function cardHtml(cid, a, st, unit) {
    return '';
  }

  return {
    cardHtml: cardHtml,
  };
})();
