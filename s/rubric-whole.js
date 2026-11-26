// @ts-check
/* The Whole Rubric's cards: every criterion with each of its levels, the
   level given marked "You"; a Single-Point Rubric has only its goal. Drawn
   on The Whole Rubric (s/page-view.js) and under See the Assignment on
   Check and Send (s/send-note.js), so a student sending work can read the
   criteria without leaving it (Philosophy 12, Nov 26 2026). Moved here
   unchanged from s/page-view.js. */
(function () {
  'use strict';
  var TICKED =
    '<svg class="sp-fb-box" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var NOT_YET =
    '<svg class="sp-fb-box sp-fb-box-open" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/></svg>';

  // A level number, 1 to 4, for a class name; 0 for anything else.
  /** @param {unknown} level */
  function lvClass(level) {
    var lv = Math.round(Number(level));
    return lv >= 1 && lv <= 4 ? lv : 0;
  }

  /** @param {string} text */
  function wordsHtml(text) {
    return '<span class="sp-fb-words">' + esc(text) + '</span>';
  }

  // An Advanced Rubric's boxes at one level on The Whole Rubric, the ones ticked marked.
  /** @param {{ ticked: boolean, label: string }[]} checks */
  function wholeChecksHtml(checks) {
    return checks
      .map(function (k) {
        return (
          '<span class="sp-fb-check">' + (k.ticked ? TICKED : NOT_YET) + '<span>' + esc(k.label) + '</span></span>'
        );
      })
      .join('');
  }

  /** @param {any} p a piece with a rubric (shared/student-view.js) */
  function cards(p) {
    var style = p.rubric.style;
    return p.rubric.rows
      .map(function (row) {
        var levels = row.whole.filter(function (l) {
          if (style === 'single_point') return l.level === 3;
          return l.you || l.descriptor || l.checks.length;
        });
        return (
          '<section class="sp-fb-card sp-fb-whole"><h2 class="sp-fb-crit-name">' +
          esc(row.name) +
          '</h2><ul class="sp-fb-whole-levels">' +
          levels
            .map(function (l) {
              var you = l.you && row.text;
              return (
                '<li class="sp-fb-whole-level' +
                (you ? ' sp-fb-you sp-lv-' + lvClass(l.level) : '') +
                '"><span class="sp-fb-whole-name">' +
                esc(you ? row.text : style === 'single_point' ? 'The Goal' : l.name) +
                (you ? '<span class="sp-fb-you-tag">You</span>' : '') +
                '</span><span class="sp-fb-whole-words">' +
                (l.descriptor ? wordsHtml(l.descriptor) : '') +
                (style === 'advanced' ? wholeChecksHtml(l.checks) : '') +
                '</span></li>'
              );
            })
            .join('') +
          '</ul></section>'
        );
      })
      .join('');
  }

  /** @type {any} */ (window).StudentRubric = { cards: cards };
})();
