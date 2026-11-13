// @ts-check
/* report-print-paper.js — Progress Reports, the Print Reports box's rows
   about sheets and paper (teacher/page-reports.js _printDialogHtml), and
   the sentence a saved copy's reprint shows for its paper.

   The app cannot know what paper is in a printer, so the box asks: a
   Paper switch like the toolbar's (Letter | Legal), and right under it a
   plain sentence saying what that paper needs. Pages laid out for Legal
   and printed on Letter come out shrunken. Moved out of page-reports.js
   with the box's Sheets line on 2026-11-13. */
window.ReportPrintPaper = (function () {
  'use strict';

  var COUNTING = 'Counting Sheets…';

  /** @type {Record<string, string>} */
  var SENTENCE = {
    letter: 'Letter paper (8.5 × 11 in).',
    legal: 'Load Legal paper (8.5 × 14 in). On Letter paper these pages print shrunken.',
  };

  /** What a paper needs, in one plain sentence (fixed text, no markup).
      @param {unknown} paper  'letter' or 'legal'; anything else reads as Letter. */
  function sentence(paper) {
    return paper === 'legal' ? SENTENCE.legal : SENTENCE.letter;
  }

  /** The Sheets line: "27 students · 1 sheet each", "24 on 1 sheet, 3 on 2".
      @param {number[]} sheets  each student's sheet count */
  function sheetsLine(sheets) {
    var n = sheets.length;
    /** @type {Record<number, number>} */
    var bySheets = {};
    sheets.forEach(function (k) {
      bySheets[k] = (bySheets[k] || 0) + 1;
    });
    var counts = Object.keys(bySheets)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });
    var rest =
      counts.length > 1
        ? counts
            .map(function (k) {
              return bySheets[k] + ' on ' + k + (k === 1 ? ' sheet' : '');
            })
            .join(', ')
        : counts[0] > 1
          ? counts[0] + ' sheets' + (n === 1 ? '' : ' each')
          : n === 1
            ? '1 sheet'
            : '1 sheet each';
    return n + (n === 1 ? ' student' : ' students') + ' · ' + rest;
  }

  /** The Paper row (the switch, then the sentence) and the Copier row, as
      issue-kv cells. Fixed markup only: the paper is one of two names.
      @param {unknown} paper  the class's paper
      @returns {string} */
  // html-safe: literal labels, data values and the two fixed sentences only
  function rowsHtml(paper) {
    var on = paper === 'legal' ? 'legal' : 'letter';
    var buttons = [
      ['letter', 'Letter'],
      ['legal', 'Legal'],
    ]
      .map(function (o) {
        var active = o[0] === on;
        return (
          '<button type="button" class="seg-btn' +
          (active ? ' active' : '') +
          '" data-issue="paper" data-paper="' +
          o[0] +
          '" role="radio" aria-checked="' +
          active +
          '">' +
          o[1] +
          '</button>'
        );
      })
      .join('');
    return (
      '<span class="issue-k" id="issue-paper-k">Paper</span><span class="issue-paper">' +
      '<span class="seg seg-sm" id="issue-paper" role="radiogroup" aria-labelledby="issue-paper-k">' +
      buttons +
      '</span><span class="issue-paper-say" id="issue-paper-say">' +
      sentence(on) +
      '</span></span>' +
      '<span class="issue-k">Copier</span><span>2-sided, flip on long edge</span>'
    );
  }

  return { COUNTING: COUNTING, sentence: sentence, sheetsLine: sheetsLine, rowsHtml: rowsHtml };
})();
