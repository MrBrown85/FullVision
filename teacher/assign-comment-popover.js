// @ts-check
/* assign-comment-popover.js — Assignments: the comment popover. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignCommentPopover = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var pageState;
  function configure(h) {
    if ('pageState' in h) pageState = h.pageState;
  }

  /* ── Comment Popover ────────────────────────────────────── */
  function openCommentPopover(cid, sid, aid) {
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var student = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    if (!assess || !student) return;
    pageState._commentPopoverState = { cid: cid, sid: sid, aid: aid };
    renderCommentPopover();
  }
  /* The Comment button counts the comments left on the work and its
     overall comment (the note on its score). */
  function _assignmentCommentCount(cid, sid, aid) {
    return getAssignmentObs(cid, sid, aid).length + (getScoreComment(cid, sid, aid) ? 1 : 0);
  }
  var OVERALL_COMMENT_ID = 'overall';
  function _overallCommentHtml(cid, sid, aid) {
    var text = getScoreComment(cid, sid, aid);
    if (!text) return '';
    var pill = '<span class="comment-entry-pills"><span class="obs-pill">Overall Comment</span></span>';
    if (pageState._commentEditId === OVERALL_COMMENT_ID) {
      return (
        '<div class="comment-entry is-editing"><span class="comment-entry-date"></span><span class="comment-entry-main"><textarea class="comment-entry-input" rows="3" aria-label="Edit overall comment">' +
        esc(text) +
        '</textarea><span class="comment-entry-edit-actions"><button type="button" class="btn btn-ghost" data-action="cancelCommentEdit" data-stop-prop="true">Cancel</button><button type="button" class="btn btn-primary" data-action="saveCommentEdit" data-stop-prop="true">Save</button></span></span></div>'
      );
    }
    return (
      '<div class="comment-entry"><span class="comment-entry-date"></span><span class="comment-entry-main"><span class="comment-entry-text">' +
      esc(text) +
      '</span>' +
      pill +
      '</span><button class="comment-entry-edit" data-action="editComment" data-obid="' +
      OVERALL_COMMENT_ID +
      '" data-stop-prop="true" title="Edit" aria-label="Edit overall comment"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5l3 3-8 8h-3v-3z"/></svg></button><button class="comment-entry-del" data-action="deleteComment" data-obid="' +
      OVERALL_COMMENT_ID +
      '" data-stop-prop="true" title="Delete" aria-label="Delete overall comment">✕</button></div>'
    );
  }
  // html-safe: comment text and pill labels through esc; dates are formatted Dates; ids are ours
  function _commentEntriesHtml(cid, sid, aid) {
    var obs = getAssignmentObs(cid, sid, aid);
    var overall = _overallCommentHtml(cid, sid, aid);
    if (obs.length === 0 && !overall) return '<div class="comment-popover-empty">No comments yet</div>';
    return (
      '<div class="comment-popover-entries">' +
      overall +
      obs
        .map(function (o) {
          var d = new Date(o.created);
          var ds = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
          var sent = o.sentiment && OBS_SENTIMENTS[o.sentiment];
          var pills =
            (sent
              ? '<span class="obs-pill obs-pill-type" data-sentiment="' +
                esc(o.sentiment) +
                '">' +
                esc(sent.label) +
                '</span>'
              : '') +
            obsPrivateLabelHtml(o) +
            (o.dims || [])
              .map(function (t) {
                return '<span class="obs-pill">' + esc(resolveTag(t).label) + '</span>';
              })
              .join('') +
            ObsCapture.linkPillsHtml(cid, o);
          if (o.id === pageState._commentEditId) {
            return (
              '<div class="comment-entry is-editing"><span class="comment-entry-date">' +
              ds +
              '</span><span class="comment-entry-main"><textarea class="comment-entry-input" rows="2" aria-label="Edit comment">' +
              esc(o.text) +
              '</textarea><span class="comment-entry-edit-actions"><button type="button" class="btn btn-ghost" data-action="cancelCommentEdit" data-stop-prop="true">Cancel</button><button type="button" class="btn btn-primary" data-action="saveCommentEdit" data-stop-prop="true">Save</button></span></span></div>'
            );
          }
          return (
            '<div class="comment-entry"><span class="comment-entry-date">' +
            ds +
            '</span><span class="comment-entry-main"><span class="comment-entry-text">' +
            esc(o.text) +
            '</span>' +
            (pills ? '<span class="comment-entry-pills">' + pills + '</span>' : '') +
            '</span><button class="comment-entry-edit" data-action="editComment" data-obid="' +
            o.id +
            '" data-stop-prop="true" title="Edit" aria-label="Edit comment"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5l3 3-8 8h-3v-3z"/></svg></button><button class="comment-entry-del" data-action="deleteComment" data-obid="' +
            o.id +
            '" data-stop-prop="true" title="Delete" aria-label="Delete comment">\u2715</button></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function renderCommentPopover() {
    if (!pageState._commentPopoverState) return;
    var cid = pageState._commentPopoverState.cid,
      sid = pageState._commentPopoverState.sid,
      aid = pageState._commentPopoverState.aid;
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var student = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    if (!assess || !student) return;
    /** @type {any} */ var overlay = document.getElementById('comment-popover-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'comment-popover-overlay';
      overlay.className = 'comment-popover-overlay';
      overlay.onclick = function (e) {
        if (e.target === this) closeCommentPopover();
      };
      // A modal: keys typed in it are not scoring shortcuts. Escape closes it.
      overlay.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Escape' && !e.defaultPrevented) closeCommentPopover();
      });
      document.body.appendChild(overlay);
    }
    var key = cid + '|' + sid + '|' + aid;
    if (overlay.dataset.key !== key || !pageState._commentCapture) {
      if (pageState._commentCapture) pageState._commentCapture.destroy();
      overlay.dataset.key = key;
      overlay.innerHTML =
        '<div class="comment-popover" role="dialog" aria-labelledby="comment-popover-title"><div class="comment-popover-header"><div><div class="comment-popover-title" id="comment-popover-title">' +
        esc(displayName(student)) +
        '</div><div class="comment-popover-subtitle">' +
        esc(assess.title) +
        '</div></div><button class="comment-popover-close" data-action="closeCommentPopover" aria-label="Close">\u2715</button></div><div class="comment-popover-body"></div><div class="comment-popover-footer comment-popover-capture"></div></div>';
      pageState._commentCapture = ObsCapture.create({
        cid: cid,
        idPrefix: 'asg-',
        students: [sid],
        lockStudents: true,
        assessmentId: aid,
        lockAssessment: true,
        draftKey: 'asg-comment|' + sid + '|' + aid,
        placeholder: 'Add a comment\u2026',
        onAdd: function () {
          renderCommentPopover();
          updateCommentBadge(sid, aid);
        },
      });
      pageState._commentCapture.mount(overlay.querySelector('.comment-popover-capture'));
      setTimeout(function () {
        if (pageState._commentCapture) pageState._commentCapture.focus();
      }, 50);
    }
    overlay.querySelector('.comment-popover-body').innerHTML = _commentEntriesHtml(cid, sid, aid);
    overlay.style.display = 'flex';
    var input = /** @type {any} */ (overlay.querySelector('.comment-entry-input'));
    if (input) {
      // Enter saves, Shift+Enter starts a new line, Escape cancels the edit
      // without closing the dialog.
      input.addEventListener('keydown', function (e) {
        if (/** @type {any} */ (e).key === 'Enter' && !(/** @type {any} */ (e).shiftKey)) {
          e.preventDefault();
          saveCommentEdit();
        } else if (/** @type {any} */ (e).key === 'Escape') {
          e.preventDefault();
          cancelCommentEdit();
        }
      });
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function editComment(obId) {
    pageState._commentEditId = obId;
    renderCommentPopover();
  }
  function cancelCommentEdit() {
    pageState._commentEditId = null;
    renderCommentPopover();
    if (pageState._commentCapture) pageState._commentCapture.focus();
  }
  function saveCommentEdit() {
    if (!pageState._commentPopoverState || !pageState._commentEditId) return;
    var cid = pageState._commentPopoverState.cid,
      sid = pageState._commentPopoverState.sid;
    var input = /** @type {any} */ (document.querySelector('#comment-popover-overlay .comment-entry-input'));
    var text = input ? input.value.trim() : '';
    if (!text) {
      if (input) input.focus();
      return;
    }
    if (pageState._commentEditId === OVERALL_COMMENT_ID) {
      Grader.setOverallComment(cid, sid, pageState._commentPopoverState.aid, text);
    } else {
      // The comment may have been re-keyed to its server id since the list drew.
      updateQuickOb(cid, sid, resolveObservationId(cid, pageState._commentEditId), { text: text });
    }
    cancelCommentEdit();
  }
  function deleteComment(obId) {
    if (!pageState._commentPopoverState) return;
    var cid = pageState._commentPopoverState.cid,
      sid = pageState._commentPopoverState.sid,
      aid = pageState._commentPopoverState.aid;
    if (obId === pageState._commentEditId) pageState._commentEditId = null;
    var after = function () {
      renderCommentPopover();
      updateCommentBadge(sid, aid);
    };
    if (obId === OVERALL_COMMENT_ID) Grader.setOverallComment(cid, sid, aid, '');
    // An observation with follow-ups asks first (ObsFollowUps.confirmDelete).
    else if (window.ObsFollowUps)
      return ObsFollowUps.confirmDelete(cid, obId, () => (deleteQuickOb(cid, sid, obId), after()));
    else deleteQuickOb(cid, sid, obId);
    after();
  }
  function closeCommentPopover() {
    pageState._commentPopoverState = null;
    pageState._commentEditId = null;
    if (pageState._commentCapture) pageState._commentCapture.destroy();
    pageState._commentCapture = null;
    /** @type {any} */ var overlay = document.getElementById('comment-popover-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.innerHTML = '';
      delete overlay.dataset.key;
    }
  }
  function updateCommentBadge(sid, aid) {
    var cid = pageState.activeCourse;
    var count = _assignmentCommentCount(cid, sid, aid);
    document.querySelectorAll('.comment-btn').forEach(function (btn) {
      if (/** @type {any} */ (btn).dataset.sid === sid && /** @type {any} */ (btn).dataset.aid === aid)
        // html-safe: count is a number
        btn.innerHTML = count > 0 ? 'Comment <span class="comment-count">' + count + '</span>' : 'Comment';
    });
  }

  return {
    configure: configure,
    _assignmentCommentCount: _assignmentCommentCount,
    cancelCommentEdit: cancelCommentEdit,
    closeCommentPopover: closeCommentPopover,
    deleteComment: deleteComment,
    editComment: editComment,
    openCommentPopover: openCommentPopover,
    saveCommentEdit: saveCommentEdit,
  };
})();
