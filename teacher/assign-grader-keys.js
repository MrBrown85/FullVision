// @ts-check
/* assign-grader-keys.js — The grader's keys and redraw. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignGraderKeys = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _focusGraderPoints,
    _scrollIntoViewIfNeeded,
    pageState,
    stepFocusStudent,
    _drawGraderHead,
    _drawGraderPanel,
    _drawGraderToolbar,
    _drawGraderWork,
    _graderAid,
    _graderForgetDrawn,
    _graderGroupView,
    _graderPart,
    _graderReturnNext,
    _graderRoot,
    _graderSetLevel,
    _graderSetMod,
    _graderSetTagLevel,
    _graderSetTagMod,
    _graderShellHtml,
    _graderWorkShellHtml,
    _graderWorkStudentChanged,
    _refreshGraderChrome,
    _refreshGraderReflection,
    closeGrader;
  function configure(h) {
    if ('_focusGraderPoints' in h) _focusGraderPoints = h._focusGraderPoints;
    if ('_scrollIntoViewIfNeeded' in h) _scrollIntoViewIfNeeded = h._scrollIntoViewIfNeeded;
    if ('pageState' in h) pageState = h.pageState;
    if ('stepFocusStudent' in h) stepFocusStudent = h.stepFocusStudent;
    if ('_drawGraderHead' in h) _drawGraderHead = h._drawGraderHead;
    if ('_drawGraderPanel' in h) _drawGraderPanel = h._drawGraderPanel;
    if ('_drawGraderToolbar' in h) _drawGraderToolbar = h._drawGraderToolbar;
    if ('_drawGraderWork' in h) _drawGraderWork = h._drawGraderWork;
    if ('_graderAid' in h) _graderAid = h._graderAid;
    if ('_graderForgetDrawn' in h) _graderForgetDrawn = h._graderForgetDrawn;
    if ('_graderGroupView' in h) _graderGroupView = h._graderGroupView;
    if ('_graderPart' in h) _graderPart = h._graderPart;
    if ('_graderReturnNext' in h) _graderReturnNext = h._graderReturnNext;
    if ('_graderRoot' in h) _graderRoot = h._graderRoot;
    if ('_graderSetLevel' in h) _graderSetLevel = h._graderSetLevel;
    if ('_graderSetMod' in h) _graderSetMod = h._graderSetMod;
    if ('_graderSetTagLevel' in h) _graderSetTagLevel = h._graderSetTagLevel;
    if ('_graderSetTagMod' in h) _graderSetTagMod = h._graderSetTagMod;
    if ('_graderShellHtml' in h) _graderShellHtml = h._graderShellHtml;
    if ('_graderWorkShellHtml' in h) _graderWorkShellHtml = h._graderWorkShellHtml;
    if ('_graderWorkStudentChanged' in h) _graderWorkStudentChanged = h._graderWorkStudentChanged;
    if ('_refreshGraderChrome' in h) _refreshGraderChrome = h._refreshGraderChrome;
    if ('_refreshGraderReflection' in h) _refreshGraderReflection = h._refreshGraderReflection;
    if ('closeGrader' in h) closeGrader = h.closeGrader;
  }

  /* Escape closes the dialog once nothing inside it (a comment box, the
     rubric window, a confirm) is using the key. In a points box it first
     puts back the saved points (_graderCardKey); a second Escape closes. */
  function _graderKeydown(e) {
    if (!pageState._grader || e.defaultPrevented) return;
    // ⌘/Ctrl+Enter: Return & Next, from anywhere in the dialog, a comment box too.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      var rn = pageState._grader.overlay.querySelector('[data-grader="return-next"]:not(:disabled)');
      if (rn && !pageState._grader.caughtUp && !CritComment.isOpen() && !pageState._commentPopoverState) {
        e.preventDefault();
        _graderReturnNext();
        return;
      }
    }
    if (_graderCardKey(e)) return;
    if (e.key !== 'Escape') return;
    var t = e.target;
    var typing =
      t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'checkbox'));
    if (typing) return;
    if (CritComment.isOpen() || pageState._commentPopoverState) return;
    if (document.getElementById('rubric-modal') || document.querySelector('.confirm-overlay')) return;
    if (window.RubricBank && RubricBank.isOpen()) return;
    e.preventDefault();
    if (pageState._grader.menuSid) {
      pageState._grader.menuSid = null;
      _refreshGraderChrome();
      return;
    }
    closeGrader();
  }

  /* Keys on a grader card, in the dialog or on the page: Enter in a points
     box saves it and moves to the next student's box; Escape puts back the
     saved points and leaves the box (a second Escape, or one with nothing
     typed, closes the dialog);
     1–4 picks a level and + / − fine-tunes it on a focused criterion or
     competency card, and ↓ / ↑ move to the next or previous one. True when
     the key was used. */
  function _graderCardKey(e) {
    var t = e.target;
    var cls = t && t.classList;
    if (!cls) return false;
    if (e.key === 'Enter' && cls.contains('grdp-input')) {
      e.preventDefault();
      var enterAid = _graderAid(t);
      t.blur();
      stepFocusStudent(1);
      _focusGraderPoints(enterAid);
      return true;
    }
    // ← → in the points box change student, as the hint says, while the
    // box holds the saved points (nothing new typed); once the teacher
    // types, they move the caret to fix a typo.
    if (
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
      cls.contains('grdp-input') &&
      pageState._grader &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      var arrowAid = _graderAid(t);
      var held =
        arrowAid && pageState.focusStudentId
          ? getPointsScore(pageState.activeCourse, pageState.focusStudentId, arrowAid)
          : null;
      if (t.value.trim() !== (held != null ? formatPoints(held) : '')) return false;
      e.preventDefault();
      stepFocusStudent(e.key === 'ArrowRight' ? 1 : -1);
      return true;
    }
    if (e.key === 'Escape' && cls.contains('grdp-input')) {
      e.preventDefault();
      var escAid = _graderAid(t);
      var saved =
        escAid && pageState.focusStudentId
          ? getPointsScore(pageState.activeCourse, pageState.focusStudentId, escAid)
          : null;
      var savedText = saved != null ? formatPoints(saved) : '';
      // Nothing typed: nothing to put back, so the dialog closes at once.
      if (pageState._grader && t.value.trim() === savedText) {
        closeGrader();
        return true;
      }
      t.value = savedText;
      t.blur();
      return true;
    }
    var card = cls.contains('grdt-crit') ? t : null;
    var tagCard = cls.contains('grdl-card') ? t : null;
    if (!(card || tagCard) || e.metaKey || e.ctrlKey || e.altKey) return false;
    var aid = _graderAid(t);
    var up = e.key === '+' || e.key === '=';
    // A Six-Point criterion takes 1 to 6, the scores themselves.
    if (card && card.classList.contains('is-six') && ['5', '6'].indexOf(e.key) >= 0) {
      e.preventDefault();
      _graderSetLevel(aid, card.dataset.critid, parseInt(e.key, 10));
      return true;
    }
    if (['1', '2', '3', '4'].indexOf(e.key) >= 0) {
      e.preventDefault();
      if (card) _graderSetLevel(aid, card.dataset.critid, parseInt(e.key, 10));
      else _graderSetTagLevel(aid, tagCard.dataset.tag, parseInt(e.key, 10));
      return true;
    }
    if (up || e.key === '-' || e.key === '_') {
      e.preventDefault();
      if (card) _graderSetMod(aid, card.dataset.critid, up ? 1 : -1);
      else _graderSetTagMod(aid, tagCard.dataset.tag, up ? 1 : -1);
      return true;
    }
    // ↓ and ↑ move to the next and previous criterion or competency, so
    // 1–4 scores it; they used to scroll the dialog and leave the focus.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.shiftKey) {
      var root = _graderRoot(aid);
      var cards = root ? Array.prototype.slice.call(root.querySelectorAll(card ? '.grdt-crit' : '.grdl-card')) : [];
      var to = cards[cards.indexOf(t) + (e.key === 'ArrowDown' ? 1 : -1)];
      e.preventDefault();
      if (to) {
        to.focus({ preventScroll: true });
        _scrollIntoViewIfNeeded(to, { block: 'nearest' });
      }
      return true;
    }
    return false;
  }

  function _renderGrader() {
    var cid = pageState.activeCourse;
    var dialog = pageState._grader.overlay.querySelector('.grader-dialog');
    var a = getAssessments(cid).find(function (x) {
      return x.id === pageState._grader.aid;
    });
    var st = getStudents(cid).find(function (x) {
      return x.id === pageState.focusStudentId;
    });
    if (!a || !st) {
      closeGrader();
      return;
    }
    // The toolbar and student header are drawn once and only updated, so a
    // save that redraws the controls (a points box on blur) doesn't swap out
    // the button being clicked.
    // The student's work beside the scoring (S6-F1), while the piece takes
    // work; the dialog is otherwise as it always was.
    var work = GraderWork.workShown(cid, a);
    if (!dialog.firstChild || pageState._grader.workShell !== work) {
      if (dialog.firstChild) _graderForgetDrawn();
      // html-safe: fixed markup and icon constants; text is set with textContent below
      dialog.innerHTML = work ? _graderWorkShellHtml() : _graderShellHtml();
      pageState._grader.workShell = work;
    }
    dialog.classList.toggle('has-work', work);
    dialog.classList.toggle('is-focus', work && pageState._grader.work.focus);
    // Group work shows the group: its grade is drawn from (and saved for)
    // the member it copies from, so that member is the focus.
    var view = _graderGroupView(cid, a, st.id);
    if (view && view.source !== st.id) {
      pageState.focusStudentId = view.source;
      st = getStudents(cid).find(function (x) {
        return x.id === view.source;
      });
    }
    _graderWorkStudentChanged();
    _drawGraderToolbar(dialog, cid, a);
    _drawGraderHead(_graderPart(dialog, 'head'), cid, a, st, view);
    pageState._grader.source = view ? view.source : null;
    _drawGraderPanel(_graderPart(dialog, 'panel'), cid, a, st);
    if (work) _drawGraderWork(dialog, cid, a, st, view);
    _refreshGraderReflection(dialog, cid, a, st);
    _refreshGraderChrome();
  }

  return {
    configure: configure,
    _graderCardKey: _graderCardKey,
    _graderKeydown: _graderKeydown,
    _renderGrader: _renderGrader,
  };
})();
