// @ts-check
/* revision-sheet.js — the phone's Return for Revision sheet (S11-F1), drawn
   in the phone's form style, as Write a Bulletin is (Nov 26 2026, after
   Colin's "That looks janky"): What to Fix in the sheet's own box, then
   Revise By and Revise as rows with the label at the left and the value in
   link blue at the right, and Return for Revision as the one primary button.
   Revise By reads "None" until a day is picked (an iPhone draws an empty
   date as nothing at all). The line "Until the New Version Is Graded: Keep
   this grade" is gone: it named no choice (Hide was left out, Colin, Nov 11),
   and the phone shows no line of explanation (DECISIONS, "The phone's new
   look" 8). tab-grade.js opens it and sends it (sendRevision reads
   .m-revision-fix, .m-revision-by and .m-revision-crit). */
(function () {
  'use strict';
  /** @type {any} */
  var w = window;

  /** html-safe: names, titles and criterion names go through MComponents.esc; ids are ours; labels are fixed words.
   * @param {string} cid @param {any} a the assessment @param {any} st the student */
  function html(cid, a, st) {
    var esc = w.MComponents.esc;
    var rubric = a.rubricId ? w.getRubricById(cid, a.rubricId) : null;
    var criteria = ((rubric && rubric.criteria) || []).filter(Boolean);
    return (
      '<div class="m-revision-sheet" role="dialog" aria-labelledby="m-revision-title">' +
      '<div class="m-revision-head"><button type="button" class="m-revision-cancel" data-action="m-sheet-cancel">Cancel</button>' +
      '<h2 class="m-revision-title" id="m-revision-title">Return for Revision</h2><span aria-hidden="true"></span></div>' +
      '<p class="m-revision-sub">' +
      esc(w.displayNameWithLast(st) + ' · ' + (a.title || 'Assessment')) +
      '</p>' +
      '<label class="m-sheet-label" for="m-revision-fix">What to Fix</label>' +
      '<textarea id="m-revision-fix" class="m-sheet-textarea m-revision-fix" rows="4" maxlength="2000"></textarea>' +
      '<label class="m-form-row m-revision-by-row" for="m-revision-by" data-empty=""><span>Revise By</span>' +
      '<span class="m-revision-none" aria-hidden="true">None</span>' +
      '<input type="date" id="m-revision-by" class="m-revision-by"></label>' +
      (criteria.length > 1
        ? '<label class="m-form-row m-form-pick" for="m-revision-crit"><span>Revise</span>' +
          '<select id="m-revision-crit" class="m-revision-crit"><option value="">The Whole Assignment</option>' +
          criteria
            .map(function (/** @type {any} */ c) {
              return '<option value="' + esc(c.id) + '">' + esc((c.name || 'Criterion') + ' only') + '</option>';
            })
            .join('') +
          '</select></label>'
        : '') +
      '<p class="m-revision-msg" role="status"></p>' +
      '<button type="button" class="m-btn-primary m-revision-send" data-action="m-grade-revision-send" data-sid="' +
      esc(st.id) +
      '" data-aid="' +
      esc(a.id) +
      '">Return for Revision</button>' +
      '</div>'
    );
  }

  /** Once the sheet is on screen: Revise By's "None" goes when a day is picked, and comes back when it is cleared. */
  function wire() {
    var by = /** @type {HTMLInputElement | null} */ (document.getElementById('m-revision-by'));
    var row = by && by.closest('.m-revision-by-row');
    if (!by || !row) return;
    var show = function () {
      if (by && row) row.toggleAttribute('data-empty', !by.value);
    };
    by.addEventListener('input', show);
    by.addEventListener('change', show);
  }

  w.MRevisionSheet = { html: html, wire: wire };
})();
