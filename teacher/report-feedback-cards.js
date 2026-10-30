/* report-feedback-cards.js — the Quick Report's Feedback Pages cards.

   One card's HTML for an item from ReportFeedback.forStudent (the item
   shape is documented at the top of report-feedback.js), plus the two
   simple cards for the student's observations and the Term Questionnaire
   comment. Pure: data in, an HTML string out. Pages, columns and
   measuring are drawn elsewhere; the look is in teacher/reports.css
   under "Feedback cards" (.fb-). Black and white only (it is photocopied).

   cardHtml(item, opts): opts.number is the grade sheet's row number
   (Assignment Numbers), shown in a small outlined box before the title.
   observationsCardHtml(list, opts): the list from ReportFeedback.observations.
   termCommentCardHtml(text, opts): the text from ReportFeedback.termComment.
   opts.continued: the title ends "(continued)" (a later piece of a card
   the layout split between entries or paragraphs).
   Each returns '' when there is nothing to print. */
(function () {
  'use strict';

  var LEVELS = [4, 3, 2, 1];

  function _e(s) {
    return esc(String(s == null ? '' : s));
  }

  function _levelName(lv) {
    return typeof PROF_LABELS !== 'undefined' && PROF_LABELS[lv] ? PROF_LABELS[lv] : '';
  }

  /* ── Title bar ─────────────────────────────────────────── */

  function _titleBar(title, meta, grade, status, number) {
    var num = number != null && number !== '' ? '<span class="fb-num">' + _e(number) + '</span>' : '';
    var right = '';
    if (grade && grade.text) right += '<span class="fb-pill">' + _e(grade.text) + '</span>';
    if (status) right += '<span class="fb-status">' + _e(status) + '</span>';
    return (
      '<div class="fb-head"><div class="fb-id"><span class="fb-title-row">' +
      num +
      '<b class="fb-title">' +
      _e(title) +
      '</b></span>' +
      (meta ? '<span class="fb-meta">' + _e(meta) + '</span>' : '') +
      '</div>' +
      (right ? '<div class="fb-right">' + right + '</div>' : '') +
      '</div>'
    );
  }

  /* ── Feedback ──────────────────────────────────────────── */

  /* The assignment comments in one bordered box, or '' with none. */
  function _feedbackBox(feedback) {
    var list = (feedback || []).filter(function (f) {
      return f && String(f.text || '').trim();
    });
    if (!list.length) return '';
    var html = '<div class="fb-feedback"><b>Feedback</b> ' + _e(String(list[0].text).trim());
    for (var i = 1; i < list.length; i++) {
      html += '<div class="fb-more">' + _e(String(list[i].text).trim()) + '</div>';
    }
    return html + '</div>';
  }

  /* ── Score box and Complete box (points, complete) ─────── */

  function _scoreBox(item) {
    if (item.score === '' || item.score == null) return '';
    var sub = (item.percent ? _e(item.percent) + ' · ' : '') + 'Points';
    return (
      '<div class="fb-score"><div class="fb-score-main"><span class="fb-score-n">' +
      _e(item.score) +
      '</span><span class="fb-score-of">out of ' +
      _e(item.outOf) +
      '</span></div><span>' +
      sub +
      '</span></div>'
    );
  }

  function _completeBox(item) {
    if (item.mark !== 'complete' && item.mark !== 'incomplete') return '';
    var done = item.mark === 'complete';
    return (
      '<div class="fb-complete"><span class="fb-sq' +
      (done ? ' is-on' : '') +
      '">' +
      (done ? '✓' : '') +
      '</span><span class="fb-complete-word">' +
      (done ? 'Complete' : 'Incomplete') +
      '</span></div>'
    );
  }

  /* The score or Complete box beside the Feedback box. */
  function _splitBody(box, feedbackHtml) {
    if (!box && !feedbackHtml) return '';
    if (!box) return feedbackHtml;
    if (!feedbackHtml) return '<div class="fb-split is-alone">' + box + '</div>';
    return '<div class="fb-split">' + box + feedbackHtml + '</div>';
  }

  /* ── Rubric table ──────────────────────────────────────── */

  function _checksHtml(checks) {
    if (!checks || !checks.length) return '';
    return (
      '<span class="fb-cks">' +
      checks
        .map(function (c) {
          return (
            '<span class="fb-ck"><span class="fb-bx' +
            (c.ticked ? ' is-on' : '') +
            '">' +
            (c.ticked ? '✓' : '') +
            '</span><span>' +
            _e(c.label) +
            '</span></span>'
          );
        })
        .join('') +
      '</span>'
    );
  }

  function _markHtml(row) {
    var mark = '✓';
    if (row.mod > 0) mark += '+';
    else if (row.mod < 0) mark += '−';
    return '<span class="fb-mk">' + mark + '</span>';
  }

  function _commentRow(text, cols) {
    if (!String(text || '').trim()) return '';
    return '<tr class="fb-cm"><td colspan="' + cols + '"><b>Comment</b> ' + _e(String(text).trim()) + '</td></tr>';
  }

  function _levelTable(rubric) {
    var order = rubric.levelOrder && rubric.levelOrder.length ? rubric.levelOrder : LEVELS;
    var advanced = rubric.style === 'advanced';
    var cols = order.length + 1;
    var head =
      '<thead><tr><th class="fb-c1">' +
      _e(rubric.name) +
      '</th>' +
      order
        .map(function (lv) {
          return '<th>' + _e(_levelName(lv)) + '</th>';
        })
        .join('') +
      '</tr></thead>';
    var body = (rubric.rows || [])
      .map(function (row) {
        var cells = order
          .map(function (lv) {
            var on = row.level === lv;
            return (
              '<td' +
              (on ? ' class="fb-on"' : '') +
              '>' +
              (on ? _markHtml(row) : '') +
              _e(row.levels && row.levels[lv]) +
              (advanced && row.checks ? _checksHtml(row.checks[lv]) : '') +
              '</td>'
            );
          })
          .join('');
        return '<tr><th class="fb-crit">' + _e(row.name) + '</th>' + cells + '</tr>' + _commentRow(row.comment, cols);
      })
      .join('');
    return '<table class="fb-rb">' + head + '<tbody>' + body + '</tbody></table>';
  }

  /* Criterion | Work On | Proficient Standard | Went Beyond. The Work On
     column is the teacher's comment, so there is no comment row. */
  function _singlePointTable(rubric) {
    var head =
      '<thead><tr><th class="fb-c1">' +
      _e(rubric.name) +
      '</th><th class="fb-c2">Work On</th><th class="fb-c3">Proficient Standard</th><th>Went Beyond</th></tr></thead>';
    var body = (rubric.rows || [])
      .map(function (row) {
        // The level with its ± as Print Rubrics names it: "Proficient +".
        var name = row.level > 0 ? _levelName(row.level) + (row.mod > 0 ? ' +' : row.mod < 0 ? ' −' : '') : '';
        var std =
          '<td' +
          (row.level > 0 ? ' class="fb-on"' : '') +
          '>' +
          (name ? '<b class="fb-lvl">' + _e(name) + '</b>' : '') +
          _e(row.levels && row.levels[3]) +
          '</td>';
        return (
          '<tr><th class="fb-crit">' +
          _e(row.name) +
          '</th><td>' +
          _e(row.comment) +
          '</td>' +
          std +
          '<td>' +
          _e(row.beyond) +
          '</td></tr>'
        );
      })
      .join('');
    return '<table class="fb-rb">' + head + '<tbody>' + body + '</tbody></table>';
  }

  function _rubricTable(rubric) {
    if (!rubric) return '';
    return rubric.style === 'single_point' ? _singlePointTable(rubric) : _levelTable(rubric);
  }

  /* ── The cards ─────────────────────────────────────────── */

  function cardHtml(item, opts) {
    if (!item) return '';
    var number = opts && opts.number != null ? opts.number : null;
    var meta = [item.category, item.date]
      .filter(function (s) {
        return s;
      })
      .join(' · ');
    var bar = _titleBar(item.title, meta, item.grade, item.status, number);
    var feedback = _feedbackBox(item.feedback);
    var body;
    if (item.kind === 'points') body = _splitBody(_scoreBox(item), feedback);
    else if (item.kind === 'complete') body = _splitBody(_completeBox(item), feedback);
    else body = _rubricTable(item.rubric) + feedback;
    return '<div class="fb-card fb-' + _e(item.kind || 'general') + '">' + bar + body + '</div>';
  }

  /* opts.continued: the later piece of a card split across columns. */
  function _continued(opts) {
    return opts && opts.continued ? ' (continued)' : '';
  }

  /* The student's observations: a row each, date first, tags after. */
  function observationsCardHtml(list, opts) {
    if (!list || !list.length) return '';
    var rows = list
      .map(function (o) {
        var tags = o.tags && o.tags.length ? ' <span class="fb-tags">' + _e(o.tags.join(', ')) + '</span>' : '';
        return '<div class="fb-obs"><b>' + _e(o.date) + '</b> ' + _e(String(o.text || '').trim()) + tags + '</div>';
      })
      .join('');
    return (
      '<div class="fb-card fb-observations">' +
      _titleBar('Observations' + _continued(opts), '', null, '', null) +
      rows +
      '</div>'
    );
  }

  /* The Term Questionnaire's comment, a paragraph per line. */
  function termCommentCardHtml(text, opts) {
    var paras = String(text || '')
      .split(/\n+/)
      .map(function (p) {
        return p.trim();
      })
      .filter(Boolean);
    if (!paras.length) return '';
    var body = paras
      .map(function (p) {
        return '<p class="fb-para">' + _e(p) + '</p>';
      })
      .join('');
    return (
      '<div class="fb-card fb-term">' +
      _titleBar('Term Comment' + _continued(opts), '', null, '', null) +
      body +
      '</div>'
    );
  }

  window.ReportFeedback = window.ReportFeedback || {};
  window.ReportFeedback.cardHtml = cardHtml;
  window.ReportFeedback.observationsCardHtml = observationsCardHtml;
  window.ReportFeedback.termCommentCardHtml = termCommentCardHtml;
})();
