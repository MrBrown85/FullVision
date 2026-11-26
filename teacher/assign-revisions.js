// @ts-check
/* assign-revisions.js — Revisions in the grader. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignRevisions = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _criterionState, _refreshGraderChrome, _scoreTagObjs, _tagState, _workStudent, pageState, render;
  function configure(h) {
    if ('_criterionState' in h) _criterionState = h._criterionState;
    if ('_refreshGraderChrome' in h) _refreshGraderChrome = h._refreshGraderChrome;
    if ('_scoreTagObjs' in h) _scoreTagObjs = h._scoreTagObjs;
    if ('_tagState' in h) _tagState = h._tagState;
    if ('_workStudent' in h) _workStudent = h._workStudent;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
  }

  /* ── Revisions in the grader (S11-F1, S11-F3) ───────────────
     The boards "Teacher: Return for Revision" and "Teacher: Grading a
     Revision, Both Versions". In a class whose revisions are on (Demo Mode,
     the build switch and Send Work: GraderWork.revisionsOnInClass), on one
     student's own piece (not a group's):
     - Return for Revision beside Return opens the sheet: What to Fix,
       Revise By and which criteria (a rubric's). The grade is kept until
       the new version replaces it: the board's Hide is left out (Colin,
       Nov 11). It returns the work, then asks for another try
       (Grader.returnForRevision);
     - out for revision, the row says so in place of Return, with the
       Revise By date, and Take Back (Grader.cancelRevision);
     - once the revision is in: "Revised Nov 9, 7:12 pm · 1 new page", New
       and First pages, the Revision card (what was asked, the student's
       note), "Was Developing + on the Oct 30 version" on each criterion,
       and Before and After once the new grade is in. While the new grade
       is a draft these screens show it, marked Draft (Colin, Nov 11); the
       student keeps the old grade until it is returned.
     With the revisions off none of it is drawn: the dialog is as it was.
     Every answer is drawn only while the dialog still shows the same class,
     piece and student; the sheet's Return for Revision acts only while the
     sheet is still open on them. */
  function _graderRevisionOf(cid, a, sid) {
    if (!a || isDibelsScored(a) || !GraderWork.revisionsOnInClass(cid)) return null;
    var r = typeof getRevisionRequest === 'function' ? getRevisionRequest(cid, sid, a.id) : null;
    return r && r.state !== 'cancelled' ? r : null;
  }
  // The revision is in (sent, being graded, or its grade returned).
  function _revisionIn(r) {
    return !!r && !!r.revision_submission_id && r.state !== 'open';
  }
  // "Tue, Nov 10" for a 'YYYY-MM-DD'.
  function _reviseByText(day) {
    var d = parseLocalDate(String(day || ''));
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  // "Nov 9, 7:12 pm", on the teacher's own clock.
  function _revisionWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return (
      formatShortDate(ts) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
    );
  }
  // The first version's submission, or null.
  function _revisionFirstSub(cid, a, sid, r) {
    var all = typeof getSubmissionVersions === 'function' ? getSubmissionVersions(cid, sid, a.id) : [];
    return (
      all.find(function (s) {
        return s.id === r.first_submission_id;
      }) ||
      all[0] ||
      null
    );
  }
  // "Oct 30": when the first version came in, or '' when it is not known.
  function _revisionFirstDay(cid, a, sid, r) {
    var sub = _revisionFirstSub(cid, a, sid, r);
    var at = (sub && (sub.sent_at || sub.created_at)) || r.first_returned_at;
    return at ? formatShortDate(at) : '';
  }

  // Return for Revision, or the state of the request and Take Back, after the row's Return.
  // html-safe: fixed labels; the name and the dates go through esc
  function _graderRevisionReturnHtml(cid, a, sid, area, buttons) {
    var g = pageState._grader;
    var busy = !!(g && g.revisionBusy);
    if (area.revise) {
      if (!buttons) return '';
      return (
        '<button type="button" class="grader-revise-btn" data-grader="revision-open"' +
        (busy ? ' disabled' : '') +
        '>Return for Revision</button>'
      );
    }
    var r = area.revision;
    if (!r) return '';
    var html = '<div class="grader-draft grader-revision-line">';
    if (area.kind === 'revising') {
      html +=
        '<p class="grader-draft-line"><span class="grader-revising-mark">Revising</span><span class="grader-draft-text">' +
        esc('Returned for Revision' + (r.revise_by ? ' · Revise by ' + _reviseByText(r.revise_by) : '')) +
        '</span></p>';
    }
    html += '</div>';
    if (!buttons) return html;
    var msg = g && g.revisionMsg ? '<p class="grader-revision-msg" role="status">' + esc(g.revisionMsg) + '</p>' : '';
    return (
      html +
      msg +
      '<button type="button" class="grader-takeback-btn" data-grader="revision-takeback" data-id="' +
      esc(r.id) +
      '"' +
      (busy ? ' disabled' : '') +
      '>' +
      (busy ? 'Taking Back…' : 'Take Back') +
      '</button>'
    );
  }

  function _graderRevisionAction(what, btn) {
    if (!pageState._grader) return;
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    var sid = pageState.focusStudentId;
    if (!a || !sid || pageState._grader.revisionBusy) return;
    if (what === 'revision-open') return _graderOpenRevisionSheet(cid, a, sid);
    if (what === 'revision-takeback') return _graderTakeBack(cid, a, sid, btn.dataset.id);
  }

  function _revisionKey(prefix) {
    return window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /* Take Back: the request is withdrawn. */
  function _graderTakeBack(cid, a, sid, requestId) {
    var r = _graderRevisionOf(cid, a, sid);
    if (!r || r.id !== requestId) return;
    var g = pageState._grader;
    g.revisionBusy = true;
    g.revisionMsg = null;
    _refreshGraderChrome();
    Grader.cancelRevision(cid, sid, a.id, r.id, _revisionKey('rc')).then(function (res) {
      g.revisionBusy = false;
      if (
        pageState._grader !== g ||
        pageState.activeCourse !== cid ||
        g.aid !== a.id ||
        pageState.focusStudentId !== sid
      )
        return;
      var ok = res && (res.result === 'cancelled' || res.result === 'not_open');
      g.revisionMsg = ok ? null : 'This couldn’t be taken back. Try again.';
      render();
      var back = g.overlay.querySelector('[data-grader="revision-open"], [data-grader="revision-takeback"]');
      (back || g.overlay.querySelector('.grader-dialog')).focus({ preventScroll: true });
    });
  }

  /* The Return for Revision sheet, over the grader. */
  // html-safe: names, titles and criterion names go through esc; ids are escaped; labels are fixed words
  function _revisionSheetHtml(cid, a, st) {
    var rubric = a.rubricId ? getRubricById(cid, a.rubricId) : null;
    var criteria = ((rubric && rubric.criteria) || []).filter(Boolean);
    return (
      '<div class="grader-sheet" role="dialog" aria-modal="true" aria-labelledby="grader-sheet-title" tabindex="-1">' +
      '<h2 class="grader-sheet-title" id="grader-sheet-title">Return for Revision</h2>' +
      '<p class="grader-sheet-sub">' +
      esc(displayNameWithLast(st) + ' · ' + (a.title || 'Assessment')) +
      '</p>' +
      '<label class="grader-sheet-label" for="grader-sheet-fix">What to Fix</label>' +
      '<textarea id="grader-sheet-fix" class="grader-sheet-fix" rows="3" maxlength="2000"></textarea>' +
      '<label class="grader-sheet-label" for="grader-sheet-by">Revise By</label>' +
      '<input type="date" id="grader-sheet-by" class="grader-sheet-by">' +
      (criteria.length > 1
        ? '<label class="grader-sheet-label" for="grader-sheet-crit">Revise</label>' +
          '<select id="grader-sheet-crit" class="grader-sheet-crit"><option value="">The Whole Assignment</option>' +
          criteria
            .map(function (c) {
              return '<option value="' + esc(c.id) + '">' + esc((c.name || 'Criterion') + ' only') + '</option>';
            })
            .join('') +
          '</select>'
        : '') +
      // The grade until then: kept (Hide is left out, Colin, Nov 11).
      '<h3 class="grader-sheet-label">Until the New Version Is Graded</h3>' +
      '<p class="grader-sheet-keep">Keep this grade. The new version replaces it.</p>' +
      '<p class="grader-sheet-msg" role="status"></p>' +
      '<div class="grader-sheet-actions">' +
      '<button type="button" class="btn btn-secondary" data-rv="cancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-rv="send">Return for Revision</button>' +
      '</div></div>'
    );
  }

  function _graderOpenRevisionSheet(cid, a, sid) {
    var g = pageState._grader;
    var st = _workStudent(cid, sid);
    if (!st || g.overlay.querySelector('.grader-sheet-back')) return;
    var back = document.createElement('div');
    back.className = 'grader-sheet-back';
    // html-safe: built by _revisionSheetHtml
    back.innerHTML = _revisionSheetHtml(cid, a, st);
    g.overlay.appendChild(back);
    var sheet = /** @type {any} */ (back.querySelector('.grader-sheet'));
    var fix = /** @type {any} */ (sheet.querySelector('.grader-sheet-fix'));
    var busy = false;
    var fields = function () {
      return Array.prototype.slice.call(sheet.querySelectorAll('button, textarea, input, select'));
    };
    var close = function () {
      back.remove();
      if (pageState._grader !== g) return;
      var to = g.overlay.querySelector('[data-grader="revision-open"]') || g.overlay.querySelector('.grader-dialog');
      if (to) to.focus({ preventScroll: true });
    };
    var say = function (text) {
      sheet.querySelector('.grader-sheet-msg').textContent = text;
    };
    var send = function () {
      if (busy) return;
      var text = fix.value;
      if (!text.trim()) {
        say('Write what to fix first.');
        fix.focus();
        return;
      }
      var crit = /** @type {any} */ (sheet.querySelector('.grader-sheet-crit'));
      var request = {
        what_to_fix: text.slice(0, 2000),
        revise_by: /** @type {any} */ (sheet.querySelector('.grader-sheet-by')).value || null,
        criterion_ids: crit && crit.value ? [crit.value] : [],
      };
      var was = fields().map(function (el) {
        return el.disabled;
      });
      busy = true;
      fields().forEach(function (el) {
        el.disabled = true;
      });
      sheet.querySelector('[data-rv="send"]').textContent = 'Returning…';
      Grader.returnForRevision(cid, sid, a.id, request, _revisionKey('rv')).then(function (res) {
        // The sheet or the dialog went, or moved on: nothing more happens here.
        if (
          !back.isConnected ||
          pageState._grader !== g ||
          pageState.activeCourse !== cid ||
          g.aid !== a.id ||
          pageState.focusStudentId !== sid
        )
          return;
        var result = res && res.result;
        if (result === 'made' || result === 'already_open') {
          back.remove();
          render();
          var tb = g.overlay.querySelector('[data-grader="revision-takeback"]');
          (tb || g.overlay.querySelector('.grader-dialog')).focus({ preventScroll: true });
          return;
        }
        busy = false;
        fields().forEach(function (el, i) {
          el.disabled = was[i];
        });
        sheet.querySelector('[data-rv="send"]').textContent = 'Return for Revision';
        say(
          result === 'invalid'
            ? 'Check What to Fix and the date, then try again.'
            : 'This couldn’t be returned for revision. Try again.',
        );
      });
    };
    back.addEventListener('click', function (e) {
      var b = /** @type {any} */ (e.target).closest('[data-rv]');
      if (!b || b.disabled) return;
      if (b.dataset.rv === 'cancel') close();
      else if (b.dataset.rv === 'send') send();
    });
    // The sheet keeps its keys: no scoring shortcut, step or close below it.
    back.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        if (!busy) close();
        return;
      }
      if (e.key !== 'Tab') return;
      var all = fields().filter(function (el) {
        return !el.disabled;
      });
      if (!all.length) return;
      var at = all.indexOf(document.activeElement);
      if (e.shiftKey && at <= 0) {
        e.preventDefault();
        all[all.length - 1].focus();
      } else if (!e.shiftKey && at === all.length - 1) {
        e.preventDefault();
        all[0].focus();
      }
    });
    back.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    /** @type {any} */ (fix).focus();
  }

  /* The Revision card above the scoring, once the revision is in: what was
     asked, the student's note, and Before and After once the new grade is
     in (the first version's result and the grade now, a draft marked so). */
  function _cellShown(cid, cell) {
    if (!cell) return '';
    if (cell.kind === 'level') return formatLevel(cid, cell.value);
    return cell.kind === 'none' ? '' : String(cell.text || '');
  }
  // The levels of the first version and now, per criterion (or competency): [{ id, name, before, after }].
  function _revisionLevelRows(cid, a, sid, r) {
    var firstCopy = r.first_grade || {};
    var rows = [];
    var rubric = a.rubricId ? getRubricById(cid, a.rubricId) : null;
    if (rubric) {
      (rubric.criteria || []).filter(Boolean).forEach(function (crit) {
        /** @type {any} */ var was = null;
        rubricCriterionScoreKeys(crit).some(function (k) {
          var p = (firstCopy.criteria || {})[k];
          if (p && p.value > 0) was = p;
          return !!was;
        });
        var now = _criterionState(cid, sid, a.id, crit);
        rows.push({
          id: crit.id,
          name: crit.name || 'Criterion',
          before: was ? scoreLevelText(was.value, was.modifier) : '',
          after: now.level ? scoreLevelText(now.level, now.mod) : '',
        });
      });
      return rows;
    }
    if (isPointsScored(a) || isCompletionScored(a)) return rows;
    _scoreTagObjs(cid, a).forEach(function (tag) {
      var p = (firstCopy.tags || {})[tag.id];
      var now = _tagState(cid, sid, a.id, tag.id);
      rows.push({
        id: tag.id,
        name: tag.label || 'Competency',
        before: p && p.value > 0 ? scoreLevelText(p.value, p.modifier) : '',
        after: now.level ? scoreLevelText(now.level, now.mod) : '',
      });
    });
    return rows;
  }

  // "(a day early)", "(3 days late)": when the revision came in against Revise By.
  function _revisionTiming(r) {
    if (!r.revise_by || !r.revision_sent_at) return '';
    var sent = new Date(r.revision_sent_at);
    if (isNaN(sent.getTime())) return '';
    var day = new Date(sent.getFullYear(), sent.getMonth(), sent.getDate());
    // @ts-expect-error Date minus Date is the number of milliseconds between them.
    var days = Math.round((parseLocalDate(r.revise_by) - day) / 86400000);
    if (days > 1) return ' (' + days + ' days early)';
    if (days === 1) return ' (a day early)';
    if (days === 0) return ' (on the day)';
    return days === -1 ? ' (a day late)' : ' (' + -days + ' days late)';
  }

  // html-safe: the student's words, names, dates and levels go through esc; labels are fixed words
  function _graderRevisionCardHtml(cid, a, st) {
    var r = _graderRevisionOf(cid, a, st.id);
    if (!_revisionIn(r)) return '';
    var when = r.revision_sent_at ? formatShortDate(r.revision_sent_at) : '';
    var html =
      '<section class="grader-revision" aria-labelledby="grader-revision-title">' +
      '<h3 class="grader-revision-title" id="grader-revision-title">' +
      esc('Revision, Sent' + (when ? ' ' + when : '') + _revisionTiming(r)) +
      '</h3>' +
      '<p class="grader-revision-who">You asked:</p><p class="grader-revision-said">' +
      esc(r.what_to_fix || '') +
      '</p>';
    if (r.revision_note)
      html +=
        '<p class="grader-revision-who">' +
        esc(displayNameFirst(st) + '’s note:') +
        '</p><p class="grader-revision-said">' +
        esc(r.revision_note) +
        '</p>';
    // Before and After: once the new grade is in (a draft, or returned).
    var firstCell = r.state === 'grading' || r.state === 'returned' ? getRevisionFirstCell(cid, st.id, a.id) : null;
    if (firstCell) {
      var draft = GradeState.stateOf(cid, st.id, a.id) === GradeState.DRAFT;
      html += '<div class="grader-revision-ba"><h4 class="grader-revision-ba-title">Before and After</h4><dl>';
      _revisionLevelRows(cid, a, st.id, r).forEach(function (row) {
        if (!row.before && !row.after) return;
        html +=
          '<div class="grader-revision-ba-row"><dt>' +
          esc(row.name) +
          '</dt><dd class="grader-revision-before">' +
          esc(row.before === row.after ? 'No change' : row.before || '—') +
          '</dd><dd class="grader-revision-after">' +
          esc(row.after || '—') +
          '</dd></div>';
      });
      html +=
        '<div class="grader-revision-ba-row is-result"><dt>Result</dt><dd class="grader-revision-before">' +
        esc(_cellShown(cid, firstCell)) +
        '</dd><dd class="grader-revision-after">' +
        esc(_cellShown(cid, assessmentCellValue(cid, st.id, a)) || '—') +
        (draft ? ' <span class="grader-draft-mark">Draft</span>' : '') +
        '</dd></div></dl></div>';
    }
    return html + '</section>';
  }

  function _refreshGraderRevision(dialog, cid, a, st) {
    var html = _graderRevisionCardHtml(cid, a, st);
    var box = dialog.querySelector('.grader-revision-host');
    if (!html) {
      if (box) box.remove();
      pageState._grader.revisionHtml = null;
      return;
    }
    if (!box) {
      var anchor = dialog.querySelector('.grader-separate-line');
      if (!anchor) return;
      box = document.createElement('div');
      box.className = 'grader-revision-host';
      anchor.insertAdjacentElement('beforebegin', box);
      pageState._grader.revisionHtml = null;
    }
    if (pageState._grader.revisionHtml === html) return;
    pageState._grader.revisionHtml = html;
    // html-safe: built by _graderRevisionCardHtml
    box.innerHTML = html;
  }

  /* "Was Developing + on the Oct 30 version" on each criterion (or
     competency) the first version had a level for, once the revision is
     in; and "Pick the level for the new version." while the revision is not
     graded yet, on the criteria the request named (all, when it named none). */
  function _refreshGraderWas(dialog, cid, a, sid) {
    var r = _graderRevisionOf(cid, a, sid);
    var rows = _revisionIn(r) ? _revisionLevelRows(cid, a, sid, r) : [];
    var day = rows.length ? _revisionFirstDay(cid, a, sid, r) : '';
    var named = (r && r.criterion_ids) || [];
    var cards = dialog.querySelectorAll('.grader-body .grdt-crit[data-critid], .grader-body .grdl-card[data-tag]');
    Array.prototype.forEach.call(cards, function (card) {
      var id = String(card.dataset.critid || card.dataset.tag);
      var row = rows.find(function (x) {
        return String(x.id) === id;
      });
      var text = row && row.before ? 'Was ' + row.before + ' on the ' + (day ? day + ' version' : 'first version') : '';
      var pick = !!text && r.state === 'sent' && (!named.length || named.indexOf(id) >= 0);
      var key = text + (pick ? '|pick' : '');
      var was = card.querySelector('.grader-was');
      if ((was ? was._fvKey : '') === key) return;
      if (was) was.remove();
      if (!text) return;
      // An amber chip under the level bar (MainRevised).
      var bar = card.querySelector('.grdl-controls, .grsp-controls');
      if (!bar) return;
      was = document.createElement('div');
      was.className = 'grader-was';
      var line = document.createElement('p');
      line.className = 'grader-was-line';
      line.textContent = text;
      was.appendChild(line);
      if (pick) {
        var hint = document.createElement('p');
        hint.className = 'grader-was-hint';
        hint.textContent = 'Pick the level for the new version.';
        was.appendChild(hint);
      }
      was._fvKey = key;
      bar.parentNode.insertBefore(was, bar.nextSibling);
    });
  }

  return {
    configure: configure,
    _graderRevisionAction: _graderRevisionAction,
    _graderRevisionOf: _graderRevisionOf,
    _graderRevisionReturnHtml: _graderRevisionReturnHtml,
    _refreshGraderRevision: _refreshGraderRevision,
    _refreshGraderWas: _refreshGraderWas,
    _revisionFirstDay: _revisionFirstDay,
    _revisionFirstSub: _revisionFirstSub,
    _revisionIn: _revisionIn,
    _revisionWhen: _revisionWhen,
  };
})();
