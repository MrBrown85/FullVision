// @ts-check
/* report-legend.js — the BC Proficiency Scale on a report: the word for
   each level and what it means, under a bar that steps from light grey to
   black, Emerging to Extending, with the word that tells the levels apart
   (Initial, Partial, Complete, Sophisticated) in bold. Two by two at Side
   by Side width. Black and grey only: a printed report is never in colour
   (Colin, 2026-11-27; DECISIONS, "The Student Page on a printed report").

   An older printed copy keeps the markup it was saved with: the bar and
   the bold word are new elements and classes (report-legend-steps,
   report-legend-step, report-legend-key), so it reprints as it went home.

   report-blocks.js draws the block through html(). */
window.ReportLegend = (function () {
  'use strict';

  /* The few words for each level. */
  var LEVELS = [
    [1, 'Initial understanding'],
    [2, 'Partial understanding'],
    [3, 'Complete understanding'],
    [4, 'Sophisticated understanding'],
  ];
  /* options.descriptors (One Report): each level's full Ministry statement
     in place of its few words, in a Proficiency or Both class. */
  var MINISTRY = {
    1: 'Initial understanding of the concepts and competencies relevant to the expected learning',
    2: 'Partial understanding of the concepts and competencies relevant to the expected learning',
    3: 'Complete understanding of the concepts and competencies relevant to the expected learning',
    4: 'Sophisticated understanding of the concepts and competencies relevant to the expected learning',
  };

  /* What a level means, its first word in bold. */
  function _desc(text) {
    var at = text.indexOf(' ');
    return '<strong class="report-legend-key">' + text.slice(0, at) + '</strong>' + text.slice(at);
  }

  /* A Letter class prints its levels as percents, so its legend gives the
     % each level counts as (formatLevel) and no "out of 4". A Proficiency
     or Both class prints each level by its name alone: students and
     families read proficiencies, not numbers (DECISIONS, "Student-facing
     levels are proficiencies", 2026-11-12). A Letter class never prints
     the Ministry's statements. */
  // html-safe: the level words and statements are fixed text; formatLevel's figure is escaped
  function html(options, cid) {
    var half = options && options.size === 'half';
    var asPct = cid != null && courseGradeMode(cid) === 'letter';
    var ministry = !!(options && options.descriptors === true) && !asPct;
    var items = LEVELS.map(function (l) {
      var n = /** @type {number} */ (l[0]);
      return (
        '<div class="report-legend-item"><div class="report-legend-step report-legend-step-' +
        n +
        '" aria-hidden="true"></div><div class="report-legend-word">' +
        (asPct ? esc(formatLevel(cid, n)) + ' · ' : '') +
        PROF_LABELS[n] +
        '</div><div class="report-legend-desc">' +
        _desc(ministry ? MINISTRY[n] : String(l[1])) +
        '</div></div>'
      );
    }).join('');
    return (
      '<div class="report-block-box report-legend report-legend-steps' +
      (half ? ' report-legend-half' : '') +
      '">\n    <div class="report-legend-title">BC Proficiency Scale</div>\n    <div class="report-legend-items">' +
      items +
      '</div>\n  </div>'
    );
  }

  return { html: html };
})();
