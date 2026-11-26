// @ts-check
/* assign-returns.js — Draft and Returned, and what is waiting to return. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignReturns = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _graderGroupView,
    _graderSteps,
    _graderToTop,
    _groupRowFor,
    _refreshGraderChrome,
    _returnState,
    _setHas,
    _unitIds,
    pageState,
    render,
    stepFocusStudent,
    _graderRevisionReturnHtml;
  function configure(h) {
    if ('_graderGroupView' in h) _graderGroupView = h._graderGroupView;
    if ('_graderSteps' in h) _graderSteps = h._graderSteps;
    if ('_graderToTop' in h) _graderToTop = h._graderToTop;
    if ('_groupRowFor' in h) _groupRowFor = h._groupRowFor;
    if ('_refreshGraderChrome' in h) _refreshGraderChrome = h._refreshGraderChrome;
    if ('_returnState' in h) _returnState = h._returnState;
    if ('_setHas' in h) _setHas = h._setHas;
    if ('_unitIds' in h) _unitIds = h._unitIds;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('stepFocusStudent' in h) stepFocusStudent = h.stepFocusStudent;
    if ('_graderRevisionReturnHtml' in h) _graderRevisionReturnHtml = h._graderRevisionReturnHtml;
  }

  /* ── Draft and Returned (S0-F2) ───────────────────────────
     In a class whose student page is on (the build switch) and that returns
     grades When I Return Them, a row above the dialog's footer, which
     never scrolls away, says where the grade stands: Return with the Draft mark and "Saved. Not returned
     yet." while it waits, "Returned Nov 3" once it is given. A change to
     a returned grade adds the one line about what the student still sees.
     A status alone is not a grade, so Missing, Excused and Late show no
     draft, and a piece with a status and nothing in shows no row. A DIBELS
     benchmark is not returned: no row. With the switch off the row is
     never made and the dialog is as it was. Group work is returned to every member still graded with the
     group. */
  function _graderReturnIds(sid, view) {
    return view && view.linked ? view.linked.slice() : [sid];
  }

  // html-safe: fixed labels; the name and the date go through esc; `attrs` is built by the caller from our ids and an escaped title
  function _graderReturnHtml(cid, a, sid, view, attrs) {
    // The dialog's Return; one student's view on the page passes its own.
    var act = attrs || 'data-grader="return"';
    // What the row says is worked out once for both layouts (S11-T1).
    // Marks made since the last Return wait for one too (S9-F1), on a grade
    // already returned: Return gives them (Grader.returnGrades).
    // In the dialog, Return for Revision and Take Back too (S11-F1).
    var area = GraderWork.returnArea(cid, a, sid, _graderReturnIds(sid, view), { marks: true, revisions: true });
    if (!area) return '';
    // The page's own view says where a revision stands; its buttons are the dialog's.
    var own = _graderReturnOwnHtml(cid, a, sid, view, act, area);
    // In the dialog, Return & Next beside Return (Colin's review council, Nov 13):
    // where the eye is after the last level, one click or ⌘/Ctrl+Enter.
    if (!attrs && own.indexOf('class="grader-return-btn" data-grader="return">') >= 0)
      own +=
        '<button type="button" class="grader-return-next" data-grader="return-next" title="Return, then the next student (Ctrl+Enter or ⌘+Enter)">Return &amp; Next ›</button>';
    return own + _graderRevisionReturnHtml(cid, a, sid, area, !attrs);
  }

  // html-safe: fixed labels; the name and the date go through esc; `act` is the caller's
  function _graderReturnOwnHtml(cid, a, sid, view, act, area) {
    // Out for revision (S11-F1): no Return until the revision is in.
    if (area.kind === 'none' || area.kind === 'revising') return '';
    if (area.kind === 'revised') {
      return '<button type="button" class="grader-return-btn" ' + act + ' disabled>Return</button>';
    }
    if (area.kind === 'marks') {
      return (
        '<button type="button" class="grader-return-btn" ' +
        act +
        '>Return</button>' +
        '<div class="grader-draft"><p class="grader-draft-line">' +
        '<span class="grader-draft-mark">Draft</span><span class="grader-draft-text">Marks saved. Not returned yet.</span>' +
        '</p></div>'
      );
    }
    if (area.kind === 'empty') {
      return '<button type="button" class="grader-return-btn" ' + act + ' disabled>Return</button>';
    }
    if (area.kind === 'returned') {
      var on = area.returnedAt ? formatShortDate(area.returnedAt) : '';
      return '<span class="grader-returned">' + esc(on ? 'Returned ' + on : 'Returned') + '</span>';
    }
    var given = area.given;
    var still = '';
    if (given) {
      var st = getStudents(cid).find(function (x) {
        return x.id === sid;
      });
      var who = view ? view.label : st ? displayNameFirst(st) : 'The student';
      var when = given.returnedAt ? ' ' + formatShortDate(given.returnedAt) : '';
      still = '<p class="grader-draft-still">' + esc(who + ' still sees the grade you returned' + when + '.') + '</p>';
    }
    return (
      '<button type="button" class="grader-return-btn" ' +
      act +
      '>Return</button>' +
      '<div class="grader-draft"><p class="grader-draft-line">' +
      '<span class="grader-draft-mark">Draft</span><span class="grader-draft-text">Saved. Not returned yet.</span>' +
      '</p>' +
      still +
      '</div>'
    );
  }

  /* The row is made only when there is something to say, in the footer
     with the grade (Colin's review council, Nov 13: Return where the eye is
     after the last level, beside the grade it returns), so Return is in
     view however long the grading is. It is redrawn only when it changes: a
     button swapped out under the mouse loses its click. */
  function _refreshGraderReturn(dialog, cid, a, sid, view) {
    var html = _graderReturnHtml(cid, a, sid, view);
    var box = dialog.querySelector('.grader-return');
    if (!html) {
      if (box) {
        box.remove();
        dialog.classList.remove('has-return');
      }
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.className = 'grader-return';
      dialog.querySelector('.grader-foot').appendChild(box);
      dialog.classList.add('has-return');
      pageState._grader.returnHtml = null;
    }
    if (pageState._grader.returnHtml === html) return;
    pageState._grader.returnHtml = html;
    // html-safe: built by _graderReturnHtml
    box.innerHTML = html;
  }

  function _graderReturn() {
    if (!pageState._grader || !pageState.focusStudentId) return;
    var cid = pageState.activeCourse;
    var a = getAssessments(cid).find(function (x) {
      return x.id === pageState._grader.aid;
    });
    if (!a) return;
    Grader.returnGrades(
      cid,
      a.id,
      _graderReturnIds(pageState.focusStudentId, _graderGroupView(cid, a, pageState.focusStudentId)),
    );
    _refreshGraderChrome();
    // The button is gone: the dialog keeps the keys.
    var dialog = pageState._grader.overlay.querySelector('.grader-dialog');
    if (dialog && !pageState._grader.overlay.contains(document.activeElement)) dialog.focus({ preventScroll: true });
  }

  // Return & Next: the grade on screen goes back, then the next student opens.
  function _graderReturnNext() {
    if (!pageState._grader || !pageState.focusStudentId) return;
    // A comment being typed is saved first (its change event).
    var t = /** @type {any} */ (document.activeElement);
    if (t && pageState._grader.overlay.contains(t) && typeof t.blur === 'function') t.blur();
    _graderReturn();
    stepFocusStudent(1);
  }

  /* ── What is waiting to return (S1-F2) ────────────────────
     In a class whose student page is on (the build switch) and that returns
     grades When I Return Them, a grade is a draft until it is returned
     (shared/grade-state.js). The Assignments page then shows:
     - on the toolbar, "N to return": the drafts on screen, summed over the
       assessments listed. Pressed, it leaves only the assessments with one;
     - on a card, "N to return" and "N returned" among its chips, and
       Return N Graded among its buttons, which asks first: the button
       names nobody, so the app's confirm dialog says who gets their grade;
     - on a student's row, the Draft mark, or Returned with its date;
     - with one student open, the dialog's row under each grader: Return
       with the Draft mark and "Saved. Not returned yet.", or Returned.
       Return is one click: it returns the grade on screen. On pair or
       group work a partner's draft goes with it, so it asks first.
     The grader dialog gets Show (To Return, Returned, All), which is what
     ← → step through, and Return N Graded, in a bar under its title.
     In any other class none of it is drawn and nothing here runs past
     _holdsGrades: the page's HTML is what it was
     (tests/assignments-return.test.js).

     Every count is GradeState.draftsIn, which asks GradeState.stateOf, as
     the gradebook, the phone and Class Settings do: a Missing or Excused
     piece is never a draft and a DIBELS benchmark has no state. Who a
     Return N Graded returns, its N, the line of names and the question's
     words are GradeState's (draftsReturned, draftsSentence, returnQuestion,
     returnNGraded), so the three screens say the same. Every return goes
     through Grader.returnGrades. Nothing here changes a number. */
  // True when the class's Student Page is on (the build switch, as the
  // server holds it for a signed-in teacher): its students read the page.
  function _studentPageOn(cid) {
    return !!cid && typeof getReturnSettings === 'function' && getReturnSettings(cid).student_page === true;
  }

  function _holdsGrades(cid) {
    if (!cid || typeof getReturnSettings !== 'function') return false;
    var klass = getReturnSettings(cid);
    return !!klass.student_page && GradeState.holds(klass);
  }

  // The students on screen: the one open, or the whole class.
  function _returnShownIds(cid) {
    if (pageState.focusStudentId) return [pageState.focusStudentId];
    return sortStudents(getStudents(cid), 'lastName').map(function (s) {
      return s.id;
    });
  }

  /* A card's chips: the drafts among the students on screen, and with the
     whole class on screen how many have their grade. */
  // `drafts`, when given, is the count render() worked out.
  // html-safe: numbers and fixed words
  function _returnChipsHtml(cid, a, shownIds, drafts) {
    var n = drafts != null ? drafts : GraderWork.draftsIn(cid, a.id, shownIds).length;
    var given = pageState.focusStudentId
      ? 0
      : shownIds.filter(function (sid) {
          return GradeState.stateOf(cid, sid, a.id) === GradeState.RETURNED;
        }).length;
    return (
      (n ? '<span class="assess-to-return">' + n + ' to return</span>' : '') +
      (given ? '<span class="assess-returned">' + given + ' returned</span>' : '')
    );
  }

  /* A card's Return N Graded, with the whole class on screen: drawn only
     while the assessment has drafts. With one student open, the row under
     their grader has Return. */
  // html-safe: the id is ours; the names and the title go through esc
  function _returnDraftsButtonHtml(cid, a, shownIds) {
    if (pageState.focusStudentId) return '';
    var waiting = GraderWork.draftsReturned(cid, a.id, shownIds);
    if (!waiting.length) return '';
    var label = GradeState.returnNGraded(waiting.length);
    return (
      '<button type="button" class="assess-return-btn" data-action="returnDrafts" data-aid="' +
      a.id +
      '" title="' +
      esc(GradeState.draftsSentence(cid, waiting)) +
      '" aria-label="' +
      esc(label + ', ' + (a.title || 'Assessment')) +
      '">' +
      esc(label) +
      '</button>'
    );
  }

  // The students a row stands for: a group's members still graded with it, or one.
  function _returnMarkIds(aid, sid) {
    var row = _groupRowFor(aid, sid);
    return row && row.view ? row.view.linked.slice() : [sid];
  }

  /* A row's mark: Draft while a grade of the row's waits, Returned (with
     its date, when one is known) once it is given, nothing with no grade. */
  // html-safe: fixed words; the date goes through esc
  function _returnMarkInner(cid, aid, ids) {
    if (GraderWork.draftsIn(cid, aid, ids).length) return '<span class="ret-draft">Draft</span>';
    /** @type {any} */ var on = null;
    var given = ids.filter(function (id) {
      if (GradeState.stateOf(cid, id, aid) !== GradeState.RETURNED) return false;
      var row = getGradeReturn(cid, id, aid);
      if (on == null && row && row.returned_at) on = formatShortDate(row.returned_at);
      return true;
    });
    if (!given.length) return '';
    return '<span class="ret-returned">' + esc(on ? 'Returned ' + on : 'Returned') + '</span>';
  }

  /* The mark beside a student's name in a whole-class grid or ledger.
     '' in a class that holds no grades and on a DIBELS benchmark. */
  // html-safe: ids are ours; the inner HTML is _returnMarkInner's
  function _returnMarkHtml(cid, aid, sid) {
    if (!_holdsGrades(cid)) return '';
    var a = _assessmentById(cid, aid);
    if (!a || isDibelsScored(a)) return '';
    var ids = _returnMarkIds(aid, sid);
    return (
      '<span class="ret-mark" data-ret-aid="' +
      aid +
      '" data-ret-sids="' +
      ids.join(',') +
      '">' +
      _drawnReturn('m' + aid + '|' + ids.join(','), _returnMarkInner(cid, aid, ids)) +
      '</span>'
    );
  }

  /* With one student open: the dialog's row under their grader, Return
     with the Draft mark and its line, or Returned. The row is about the
     student on screen, on pair and group work too (the dialog shows the
     group there; the page shows the student), so it agrees with the count
     on the toolbar and with what Return does (_returnOne). */
  // html-safe: ids are ours; the title goes through esc; the row is _graderReturnHtml's
  function _inlineReturnInner(cid, a, sid) {
    return _graderReturnHtml(
      cid,
      a,
      sid,
      null,
      'data-action="returnOne" data-aid="' +
        a.id +
        '" data-sid="' +
        sid +
        '" aria-label="' +
        esc('Return, ' + (a.title || 'Assessment')) +
        '"',
    );
  }
  // html-safe: ids are ours; the row is _inlineReturnInner's
  function _inlineReturnRowHtml(cid, a, sid) {
    if (!_holdsGrades(cid) || isDibelsScored(a)) return '';
    var html = _drawnReturn('r' + a.id + '|' + sid, _inlineReturnInner(cid, a, sid));
    return (
      '<div class="grader-return grader-return-inline" data-return-row-aid="' +
      a.id +
      '" data-return-row-sid="' +
      sid +
      '"' +
      (html ? '' : ' hidden') +
      '>' +
      html +
      '</div>'
    );
  }

  function _drawnReturn(key, html) {
    if (pageState._drawnReturns) pageState._drawnReturns[key] = html;
    return html;
  }
  function _seedReturns(root) {
    if (pageState._grader || !_holdsGrades(pageState.activeCourse) || !document.getElementById('main')) return;
    var kept = pageState._drawnReturns || {};
    root.querySelectorAll('[data-returns-aid]').forEach(function (el) {
      el._drafts = kept['d' + el.dataset.returnsAid];
    });
    // Each piece's selector, its key's letter (_drawnReturn) and the data that names it.
    [
      ['returns-aid', 'c', 'returnsAid'],
      ['return-slot-aid', 's', 'returnSlotAid'],
      ['ret-aid', 'm', 'retAid', 'retSids'],
      ['return-row-aid', 'r', 'returnRowAid', 'returnRowSid'],
    ].forEach(function (k) {
      root.querySelectorAll('[data-' + k[0] + ']').forEach(function (el) {
        var key = k[1] + el.dataset[k[2]] + (k[3] ? '|' + el.dataset[k[3]] : '');
        if (key in kept) el._returnsHtml = kept[key];
      });
    });
  }
  function _refreshReturns(scope) {
    if (pageState._grader) return;
    var cid = pageState.activeCourse;
    /** @type {any} */ var root = document.getElementById('main');
    if (!_holdsGrades(cid) || !root) return;
    var only = scope ? '="' + scope.aid + '"' : '';
    var forStudent = function (sids) {
      return !scope || !scope.sid || sids.indexOf(scope.sid) >= 0;
    };
    var shownIds = _returnShownIds(cid);
    var set = function (el, html) {
      if (el._returnsHtml === html) {
        el._returnsHtml = html;
        return false;
      }
      el._returnsHtml = html;
      // html-safe: every string set here is built by a reviewed builder above
      el.innerHTML = html;
      return true;
    };
    var total = 0;
    root.querySelectorAll('[data-returns-aid]').forEach(function (el) {
      if (!scope || el.dataset.returnsAid === scope.aid) {
        var a = _assessmentById(cid, el.dataset.returnsAid);
        if (!a) return;
        el._drafts = GraderWork.draftsIn(cid, a.id, shownIds).length;
        if (el.closest('.assess-card')) _setHas(el.closest('.assess-card'), 'toreturn', el._drafts > 0);
        set(el, _returnChipsHtml(cid, a, shownIds, el._drafts));
      }
      total += el._drafts || 0;
    });
    root.querySelectorAll('[data-return-slot-aid' + only + ']').forEach(function (el) {
      var a = _assessmentById(cid, el.dataset.returnSlotAid);
      if (a) set(el, _returnDraftsButtonHtml(cid, a, shownIds));
    });
    root.querySelectorAll('[data-ret-aid' + only + ']').forEach(function (el) {
      var sids = el.dataset.retSids.split(',');
      if (forStudent(sids)) set(el, _returnMarkInner(cid, el.dataset.retAid, sids));
    });
    root.querySelectorAll('[data-return-row-aid' + only + ']').forEach(function (el) {
      var a = forStudent([el.dataset.returnRowSid]) && _assessmentById(cid, el.dataset.returnRowAid);
      if (!a) return;
      var html = _inlineReturnInner(cid, a, el.dataset.returnRowSid);
      if (set(el, html)) el.hidden = !html;
    });
    if (total === pageState._toReturnTotal) return;
    pageState._toReturnTotal = total;
    // The last draft is returned: the filter turns off and the list is whole again.
    if (!total && pageState._toReturnOnly) return render();
    AssignShow.syncReturn(pageState.activeCourse, _returnState(pageState.activeCourse));
  }
  function _returnsAfterEvent(scope) {
    if (pageState._grader || !_holdsGrades(pageState.activeCourse)) return;
    setTimeout(function () {
      _refreshReturns(scope);
    }, 0);
  }

  /* Return the drafts `sids` hold on `aid`, and their partners': the
     grader is handed each one's whole pair or group, as the dialog's
     Return hands it, and returns the drafts among them. The drafts are
     counted again here, so a question answered late returns what is
     waiting now. True when any was returned. */
  function _returnDrafts(cid, aid, sids) {
    if (!_holdsGrades(cid)) return false;
    var waiting = GraderWork.draftsIn(cid, aid, sids);
    if (!waiting.length) return false;
    Grader.returnGrades(cid, aid, GradeState.returnTogether(cid, aid, waiting));
    clearProfCache();
    return true;
  }

  /* After a return on the page. With the filter on, a card with nothing
     left to return leaves the list, so the list is drawn again. */
  function _afterPageReturn() {
    if (pageState._toReturnOnly) render();
    else _refreshReturns();
  }

  /* A Return that returns more than the one grade on screen, or names
     nobody, asks first (Colin, 2026-11-10): "Return 3 Grades Now?", who
     is waiting, Return 3 Graded and Cancel. Cancel returns nothing and
     gives `button` the focus back. */
  function _askReturn(cid, waiting, button, then) {
    var n = waiting.length;
    // The dialog gives the focus back to what had it when it opened. Safari
    // does not focus a button it clicks, so the button takes it first.
    if (button && button.focus) button.focus({ preventScroll: true });
    showConfirm(
      GradeState.returnQuestion(n),
      GradeState.draftsSentence(cid, waiting),
      GradeState.returnNGraded(n),
      'primary',
      then,
    );
  }

  /* A card's Return N Graded. The button goes with the drafts, so the
     card's next button takes the focus. */
  function _askReturnDrafts(aid, button) {
    var cid = pageState.activeCourse;
    if (!_holdsGrades(cid) || pageState.focusStudentId) return;
    var waiting = GraderWork.draftsReturned(cid, aid, _returnShownIds(cid));
    if (!waiting.length) return _refreshReturns();
    _askReturn(cid, waiting, button, function () {
      if (pageState.activeCourse !== cid || pageState._grader) return;
      _returnDrafts(cid, aid, _returnShownIds(cid));
      _afterPageReturn();
      var card = document.getElementById('ac-' + aid);
      var next = /** @type {any} */ (card && card.querySelector('.assess-header-actions button'));
      if (!next) next = document.querySelector('.atb-show [data-show="toreturn"], .assess-search-input');
      if (next) next.focus({ preventScroll: true });
    });
  }

  /* Return under one student's grader on the page. It returns the grade
     on screen, so it is one click. On pair or group work a partner's draft
     goes with it: then it asks first and names everyone. */
  function _returnOne(aid, sid, button) {
    var cid = pageState.activeCourse;
    if (!_holdsGrades(cid)) return;
    var waiting = GraderWork.draftsReturned(cid, aid, [sid]);
    if (!waiting.length) return _refreshReturns();
    var done = function () {
      if (pageState.activeCourse !== cid || pageState._grader) return;
      _returnDrafts(cid, aid, [sid]);
      _afterPageReturn();
      // The button is gone: the student's grader keeps the keys.
      var card = document.getElementById('ac-' + aid);
      var box = /** @type {any} */ (card && card.querySelector('.grader-inline'));
      var to = /** @type {any} */ (box && box.querySelector('.grdt-crit, .grdl-card, .grdp-input, .cmp-btn'));
      if (to && !box.contains(document.activeElement)) to.focus({ preventScroll: true });
    };
    if (waiting.length > 1) return _askReturn(cid, waiting, button, done);
    done();
  }

  /* ── Show and Return N Graded in the dialog (S1-F2) ─────────
     A bar under the dialog's title, in a class that holds grades, when the
     dialog steps through more than one student: Show (To Return 3,
     Returned 14, All 28) and Return 3 Graded. The counts are students, as
     the gradebook's and the phone's are. To Return is the drafts among the
     dialog's students; Return N Graded also counts a partner a search has
     hidden, as the gradebook's column does. Show is what ← → step
     through: the student on screen stays until a step, and when the last
     one it lists is gone it goes back to All. */
  var _SHOW_LABELS = {
    tograde: 'To Grade',
    toreturn: 'To Return',
    returned: 'Returned',
    notin: 'Not In',
    all: 'All',
  };

  /* Show's buttons: To Grade and Not In join them while the piece takes
     student work (S6-F3, Grader.workOn). */
  function _graderShowKeys(cid, a) {
    return GraderWork.workOn(cid, a)
      ? ['tograde', 'toreturn', 'returned', 'notin', 'all']
      : ['toreturn', 'returned', 'all'];
  }
  // The bar is drawn: a class that holds grades, or a piece that takes work.
  function _graderShowWanted(cid, a) {
    return (_holdsGrades(cid) || GraderWork.workOn(cid, a)) && !isDibelsScored(a);
  }

  // The dialog's stops, in order: a group or a student each.
  function _graderStops(cid, a) {
    var steps = _graderSteps(cid, a);
    if (steps)
      return steps.map(function (u) {
        return { focus: u.source || u.sid, ids: _unitIds(u) };
      });
    return pageState._grader.studentIds.map(function (sid) {
      return { focus: sid, ids: [sid] };
    });
  }
  /* True when Show lists the stop: one of its students is in what Show
     is on (Grader.workStateOf); for Returned, none of them has a draft. */
  function _stopShown(cid, aid, stop, show) {
    if (!_SHOW_LABELS[show] || show === 'all') return true;
    var states = stop.ids.map(function (id) {
      return GraderWork.workStateOf(cid, aid, id);
    });
    if (show === 'returned' && states.indexOf('toreturn') >= 0) return false;
    return states.indexOf(show) >= 0;
  }
  function _stopIndex(stops, sid) {
    for (var i = 0; i < stops.length; i++) if (stops[i].ids.indexOf(sid) >= 0) return i;
    return -1;
  }
  // The next stop Show lists from the one on screen, or null.
  function _nextShownStop(cid, a, dir) {
    var stops = _graderStops(cid, a);
    var at = _stopIndex(stops, pageState.focusStudentId);
    for (var i = at < 0 && dir < 0 ? stops.length - 1 : at + dir; i >= 0 && i < stops.length; i += dir)
      if (_stopShown(cid, a.id, stops[i], pageState._grader.show)) return stops[i];
    return null;
  }
  function _graderShowOn() {
    return (
      !!pageState._grader &&
      !!pageState._grader.show &&
      pageState._grader.show !== 'all' &&
      !!_SHOW_LABELS[pageState._grader.show]
    );
  }

  // ← → while Show is on To Return or Returned. False when it is on All.
  function _graderStepShown(dir) {
    if (!_graderShowOn()) return false;
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    if (!a || !_graderShowWanted(cid, a)) return false;
    var next = _nextShownStop(cid, a, dir);
    if (!next) return true;
    pageState._grader.menuSid = null;
    pageState.focusStudentId = next.focus;
    render();
    return true;
  }

  /* The bar's counts, among the students the dialog steps through: the
     one counting function the gradebook and the dashboard call too
     (Grader.workCounts). Students, except a group to grade, which counts
     once. */
  function _graderShowCounts(cid, a) {
    return GraderWork.workCounts(cid, a.id, pageState._grader.studentIds);
  }

  // html-safe: fixed labels and numbers; the names in the title go through esc
  function _graderShowHtml(cid, a, counts) {
    var show = pageState._grader.show || 'all';
    var waiting = GraderWork.draftsReturned(cid, a.id, pageState._grader.studentIds);
    var label = GradeState.returnNGraded(waiting.length);
    return (
      '<div class="seg seg-sm grader-show-seg" role="group" aria-label="Show">' +
      _graderShowKeys(cid, a)
        .map(function (key) {
          return (
            '<button type="button" class="seg-btn"' +
            segAttr(show === key) +
            ' data-grader="show" data-show="' +
            key +
            '"' +
            (counts[key] ? '' : ' disabled') +
            '>' +
            _SHOW_LABELS[key] +
            ' <span class="grader-show-n">' +
            counts[key] +
            '</span></button>'
          );
        })
        .join('') +
      '</div>' +
      (waiting.length
        ? '<button type="button" class="grader-return-all" data-grader="returnAll" title="' +
          esc(GradeState.draftsSentence(cid, waiting)) +
          '">' +
          esc(label) +
          '</button>'
        : '')
    );
  }

  /* The bar is made only in a class that holds grades, under the
     dialog's title bar, and redrawn only when it changes. True when it
     drew the whole dialog again: what Show listed has run out. */
  function _refreshGraderShow(dialog, cid, a) {
    var box = dialog.querySelector('.grader-show');
    var on = _graderShowWanted(cid, a) && pageState._grader.studentIds.length > 1;
    if (!on) {
      if (box) box.remove();
      pageState._grader.show = 'all';
      pageState._grader.showHtml = null;
      return false;
    }
    var counts = _graderShowCounts(cid, a);
    if (_graderShowOn() && !counts[pageState._grader.show]) {
      pageState._grader.show = 'all';
      render();
      return true;
    }
    if (!box) {
      box = document.createElement('div');
      box.className = 'grader-show';
      var slot = dialog.querySelector('.grader-show-slot');
      if (slot) slot.appendChild(box);
      else dialog.querySelector('.grader-toolbar').insertAdjacentElement('afterend', box);
      pageState._grader.showHtml = null;
    }
    var html = _graderShowHtml(cid, a, counts);
    if (pageState._grader.showHtml !== html) {
      pageState._grader.showHtml = html;
      // html-safe: built by _graderShowHtml
      box.innerHTML = html;
    }
    // Previous and Next follow what Show lists.
    if (_graderShowOn()) {
      dialog.querySelector('[data-grader="prev"]').disabled = !_nextShownStop(cid, a, -1);
      dialog.querySelector('[data-grader="next"]').disabled = !_nextShownStop(cid, a, 1);
    }
    return false;
  }

  /* A press on To Return, Returned or All. When the student on screen is
     not one it lists, the first one it lists opens. */
  function _graderSetShow(show) {
    if (!pageState._grader || !_SHOW_LABELS[show]) return;
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    if (!a || !_graderShowWanted(cid, a)) return;
    pageState._grader.show = show;
    if (_graderShowOn()) {
      var stops = _graderStops(cid, a);
      var at = _stopIndex(stops, pageState.focusStudentId);
      if (at < 0 || !_stopShown(cid, a.id, stops[at], show)) {
        var first = stops.find(function (stop) {
          return _stopShown(cid, a.id, stop, show);
        });
        if (first) {
          pageState._grader.menuSid = null;
          pageState.focusStudentId = first.focus;
          _graderToTop();
        }
      }
    }
    render();
    var pressed =
      pageState._grader &&
      pageState._grader.overlay.querySelector('.grader-show [data-show="' + pageState._grader.show + '"]');
    if (pressed) pressed.focus({ preventScroll: true });
  }

  /* Return N Graded in the dialog: every draft among the dialog's
     students, and their partners'. It asks first, unless the only drafts
     are the grade on screen, which the dialog's own Return returns in one
     click. */
  function _graderReturnAll(button) {
    if (!pageState._grader) return;
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    if (!a || !_holdsGrades(cid)) return;
    var ids = pageState._grader.studentIds;
    var waiting = GraderWork.draftsReturned(cid, a.id, ids);
    if (!waiting.length) return _refreshGraderChrome();
    var overlay = pageState._grader.overlay;
    var done = function () {
      if (!pageState._grader || pageState._grader.overlay !== overlay || pageState.activeCourse !== cid) return;
      _returnDrafts(cid, a.id, ids);
      _refreshGraderChrome();
      // The button is gone: the dialog keeps the keys.
      var dialog = pageState._grader && pageState._grader.overlay.querySelector('.grader-dialog');
      if (dialog && !pageState._grader.overlay.contains(document.activeElement)) dialog.focus({ preventScroll: true });
    };
    var onScreen = _graderReturnIds(pageState.focusStudentId, _graderGroupView(cid, a, pageState.focusStudentId));
    var justThese = waiting.every(function (sid) {
      return onScreen.indexOf(sid) >= 0;
    });
    if (justThese) return done();
    _askReturn(cid, waiting, button, done);
  }

  return {
    configure: configure,
    _SHOW_LABELS: _SHOW_LABELS,
    _askReturnDrafts: _askReturnDrafts,
    _drawnReturn: _drawnReturn,
    _graderReturn: _graderReturn,
    _graderReturnAll: _graderReturnAll,
    _graderReturnNext: _graderReturnNext,
    _graderSetShow: _graderSetShow,
    _graderShowOn: _graderShowOn,
    _graderShowWanted: _graderShowWanted,
    _graderStepShown: _graderStepShown,
    _graderStops: _graderStops,
    _holdsGrades: _holdsGrades,
    _inlineReturnRowHtml: _inlineReturnRowHtml,
    _nextShownStop: _nextShownStop,
    _refreshGraderReturn: _refreshGraderReturn,
    _refreshGraderShow: _refreshGraderShow,
    _returnChipsHtml: _returnChipsHtml,
    _returnDrafts: _returnDrafts,
    _returnDraftsButtonHtml: _returnDraftsButtonHtml,
    _returnMarkHtml: _returnMarkHtml,
    _returnOne: _returnOne,
    _returnShownIds: _returnShownIds,
    _returnsAfterEvent: _returnsAfterEvent,
    _seedReturns: _seedReturns,
    _stopShown: _stopShown,
    _studentPageOn: _studentPageOn,
  };
})();
