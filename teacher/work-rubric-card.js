/* ── work-rubric-card.js — how a piece was scored, by its card ─────────
   Moved out of shared/work-wall.js, which calls wire() when the Work tab
   or the Work Wall opens and hide() when either is drawn again or goes.
   Teacher desktop only: it reads the printed handout (rubric-print.js). */
window.WorkRubricCard = (function () {
  'use strict';

  /* The rubric card: how a piece was scored, beside a card on the Work
     tab or the Work Wall while the pointer rests on it (or it has
     keyboard focus). It is the printed handout's rubric
     (RubricPrint.sheetData): the level descriptors with the student's
     level filled in its colour, each criterion's comment, a single-point
     rubric's Work On and Went Beyond, an Advanced Rubric's ticks, and the
     feedback. Points and Complete/Incomplete work show the score and the
     feedback. It reads all work, drafts included and marked: a teacher's
     view, as the cards are. Like the glance, it takes no clicks and no
     focus, and goes on a click, a scroll, Escape, or when the pointer or
     focus leaves. Not on a screen with no pointer that rests (the phone). */
  var RUB_WAIT = 250; // ms the pointer rests on a card before the rubric shows
  var RUB_WIDE = 860; // px, the card's widest
  var RUB_NARROW = 560; // px, the narrowest it is drawn beside a card before it goes over it
  var _rub = null; // { card, el }
  var _rubTimer = null;
  var _rubDoc = null;
  var _rubBankAsked = false;
  function _rubCard(e) {
    var el = e.target && e.target.closest ? e.target.closest('.sw-card[data-sid], .ww-card[data-aid]') : null;
    return el && el.getAttribute('data-cid') ? el : null;
  }
  function wire() {
    if (typeof document === 'undefined' || _rubDoc === document || !document.addEventListener) return;
    if (typeof window === 'undefined' || !window.RubricPrint) return;
    _rubDoc = document;
    document.addEventListener(
      'mouseover',
      function (e) {
        var card = _rubCard(e);
        if (_rub && _rub.card === card) return;
        hide();
        if (!card) return;
        if (window.matchMedia && !window.matchMedia('(hover: hover)').matches) return;
        _rubTimer = setTimeout(function () {
          if (card.isConnected && card.matches(':hover')) _rubShow(card);
        }, RUB_WAIT);
      },
      true,
    );
    document.addEventListener(
      'mouseout',
      function (e) {
        var card = _rubCard(e);
        // Moving between a card's own parts keeps the rubric up.
        if (card && !(e.relatedTarget && card.contains(e.relatedTarget))) hide();
      },
      true,
    );
    document.addEventListener(
      'focusin',
      function (e) {
        var card = _rubCard(e);
        if (card && card.matches(':focus-visible')) _rubShow(card);
      },
      true,
    );
    document.addEventListener('focusout', hide, true);
    document.addEventListener('click', hide, true);
    document.addEventListener('scroll', hide, true);
    document.addEventListener(
      'keydown',
      function (e) {
        if (e.key === 'Escape') hide();
      },
      true,
    );
  }
  function hide() {
    clearTimeout(_rubTimer);
    if (!_rub) return;
    _rub.el.remove();
    _rub = null;
  }

  function _rubChecksHtml(criterion, level, ticked) {
    if (typeof RubricChecks === 'undefined') return '';
    var boxes = RubricChecks.checksAt(criterion, level);
    if (!boxes.length) return '';
    return (
      '<span class="wr-checks">' +
      boxes
        .map(function (check) {
          var on = (ticked || []).indexOf(check.id) >= 0;
          return (
            '<span class="wr-check' +
            (on ? ' is-on' : '') +
            '"><span class="wr-box">' +
            (on ? '✓' : '') +
            '</span>' +
            esc(check.label) +
            '</span>'
          );
        })
        .join('') +
      '</span>'
    );
  }

  function _rubCommentHtml(label, text, cols) {
    if (!text) return '';
    return (
      '<tr class="wr-note-row"><td colspan="' +
      cols +
      '"><span class="wr-note-label">' +
      esc(label) +
      '</span> ' +
      esc(text) +
      '</td></tr>'
    );
  }

  // A rubric of four level columns: the descriptors, the student's level filled in.
  function _rubGridHtml(data) {
    var levels = levelOrderFor(data.cid);
    var cols = levels.length + 1;
    var html =
      '<table class="wr-table"><thead><tr><th class="wr-crit-head">' +
      esc(data.rubric.name || 'Criteria') +
      '</th>' +
      levels
        .map(function (lv) {
          return '<th class="wr-lv-head wr-lv-' + lv + '">' + esc(PROF_LABELS[lv]) + '</th>';
        })
        .join('') +
      '</tr></thead><tbody>';
    data.rows.forEach(function (row) {
      var c = row.criterion;
      html += '<tr class="wr-row"><th class="wr-crit" scope="row">' + esc(c.name || '') + '</th>';
      levels.forEach(function (lv) {
        var on = row.level === lv;
        html +=
          '<td class="wr-cell' +
          (on ? ' is-on wr-lv-' + lv : '') +
          '">' +
          (on
            ? '<span class="wr-mark">✓ ' +
              esc(scoreLevelText(row.level, row.mod)) +
              (row.mixed ? ' (lowest)' : '') +
              '</span>'
            : '') +
          '<span class="wr-desc">' +
          esc((c.levels && (c.levels[lv] || c.levels[String(lv)])) || '') +
          '</span>' +
          _rubChecksHtml(c, lv, data.ticked) +
          '</td>';
      });
      html += '</tr>' + _rubCommentHtml('Comment', row.comment, cols);
    });
    return html + '</tbody></table>';
  }

  // A single-point rubric: the Proficient standard, with Work On and Went Beyond beside it.
  function _rubSinglePointHtml(data) {
    var work = data.rows.some(function (r) {
      return r.comment;
    });
    var beyond = data.rows.some(function (r) {
      return r.beyond;
    });
    var html =
      '<table class="wr-table is-sp"><thead><tr><th class="wr-crit-head">' +
      esc(data.rubric.name || 'Criteria') +
      '</th>' +
      (work ? '<th class="wr-lv-head">Work On</th>' : '') +
      '<th class="wr-lv-head">Proficient Standard</th>' +
      (beyond ? '<th class="wr-lv-head">Went Beyond</th>' : '') +
      '</tr></thead><tbody>';
    data.rows.forEach(function (row) {
      var c = row.criterion;
      html +=
        '<tr class="wr-row"><th class="wr-crit" scope="row">' +
        esc(c.name || '') +
        '</th>' +
        (work ? '<td class="wr-cell wr-sp-note">' + esc(row.comment || '') + '</td>' : '') +
        '<td class="wr-cell' +
        (row.level > 0 ? ' is-on wr-lv-' + row.level : '') +
        '">' +
        (row.level > 0 ? '<span class="wr-mark">' + esc(scoreLevelText(row.level, row.mod)) + '</span>' : '') +
        '<span class="wr-desc">' +
        esc((c.levels && (c.levels[3] || c.levels['3'])) || '') +
        '</span></td>' +
        (beyond ? '<td class="wr-cell wr-sp-note">' + esc(row.beyond || '') + '</td>' : '') +
        '</tr>';
    });
    return html + '</tbody></table>';
  }

  // html-safe: every title, name, descriptor, comment and label goes through esc; the rest is fixed markup
  function _rubHtml(cid, sid, aid) {
    var got = WorkWall.cardMark(cid, sid, aid);
    if (!got) return '';
    var a = got.piece;
    var mark = got.mark;
    var data = RubricPrint.sheetData(cid, aid, sid);
    var sub = getStudentSubmission(cid, sid, aid);
    var day = got.day((sub && (sub.sent_at || sub.created_at)) || a.date);
    var head =
      '<div class="wr-head"><div class="wr-head-main"><div class="wr-title">' +
      esc(a.title || '') +
      '</div><div class="wr-meta">' +
      esc([day, data && data.status === 'Late' ? 'Late' : ''].filter(Boolean).join(' · ')) +
      '</div></div>' +
      (mark.text
        ? '<div class="wr-overall"><span class="wr-label">' +
          (isPointsScored(a) ? 'Score' : isCompletionScored(a) ? 'Mark' : 'Overall') +
          '</span>' +
          got.chip +
          (mark.draft ? '<span class="wr-draft">Draft, not returned</span>' : '') +
          '</div>'
        : '') +
      '</div>';
    if (mark.toGrade) return head + '<div class="wr-empty">Not graded yet.</div>';
    if (!data) return head;
    var body = '';
    if (data.scoreOnly) {
      if (data.overall && data.overall.word)
        body +=
          '<div class="wr-score"><span>' + esc(data.overall.text) + '</span> ' + esc(data.overall.word) + '</div>';
    } else if (data.scored) {
      var sp = typeof rubricStyle === 'function' && !data.rubric.kind && rubricStyle(data.rubric) === 'single_point';
      body += '<div class="wr-body">' + (sp ? _rubSinglePointHtml(data) : _rubGridHtml(data)) + '</div>';
    }
    if (data.feedback)
      body +=
        '<div class="wr-feedback"><div class="wr-label">Feedback</div><div class="wr-feedback-text">' +
        esc(data.feedback).replace(/\n/g, '<br>') +
        '</div></div>';
    if (!body) body = '<div class="wr-empty">' + esc(data.status ? data.status + '.' : 'Not graded yet.') + '</div>';
    return head + body;
  }

  function _rubShow(card) {
    hide();
    var cid = card.getAttribute('data-cid');
    var sid = card.getAttribute('data-sid');
    var aid = card.getAttribute('data-aid');
    var html = _rubHtml(cid, sid, aid);
    if (!html) return;
    // A competency rubric's wording from the curriculum bank loads the first time; the card is drawn again then.
    if (!_rubBankAsked && RubricPrint.classUsesBankLevels(cid)) {
      _rubBankAsked = true;
      RubricPrint.loadBankLevels().then(function () {
        if (_rub && _rub.card === card) _rubShow(card);
      });
    }
    var roomW = (window.innerWidth || 1280) - 24;
    var roomH = (window.innerHeight || 800) - 24;
    // Beside the card, on the side with more room, as wide as that side
    // allows; over the card only when neither side is wide enough.
    var at = card.getBoundingClientRect ? card.getBoundingClientRect() : { left: 0, right: 0, top: 0 };
    var right = roomW + 12 - at.right - 10;
    var left = at.left - 10 - 12;
    var side = Math.max(right, left);
    var w = Math.min(RUB_WIDE, roomW, Math.max(side, RUB_NARROW));
    var el = document.createElement('div');
    el.className = 'wr-card';
    el.setAttribute('aria-hidden', 'true');
    el.style.width = w + 'px';
    el.style.maxHeight = roomH + 'px';
    el.innerHTML = html;
    _rub = { card: card, el: el };
    document.body.appendChild(el);
    // Too tall for the window: the levels not given shorten, then go, then
    // the type gets smaller. The feedback is never the part cut off.
    ['is-tight', 'is-tighter', 'is-tightest'].some(function (cls) {
      var body = el.querySelector('.wr-body');
      if (!body || !(body.scrollHeight > body.clientHeight)) return true;
      el.classList.add(cls);
      return false;
    });
    var h = el.offsetHeight || 0;
    var x;
    if (right >= w) x = at.right + 10;
    else if (left >= w) x = at.left - 10 - w;
    else x = right >= left ? roomW + 12 - w : 12;
    el.style.left = Math.max(12, x) + 'px';
    el.style.top = Math.max(12, Math.min(at.top, roomH + 12 - h)) + 'px';
  }

  return { wire: wire, hide: hide };
})();
