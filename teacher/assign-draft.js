// @ts-check
/* ── assign-draft.js — Drafts on the Assignments page ─────────────────
   A teacher keeps a new assessment as a Draft, as in Teams, and assigns it
   when ready (Colin, Nov 16 2026; docs/DECISIONS.md, "Draft assessments"):
   - Save as Draft in the New Assessment form's footer, left of Create and
     Add Another and Create Assessment, which assign as before. Editing a
     Draft: Cancel, Save Changes, Assign.
   - A Draft is on the Assignments page only, marked Draft, with an Assign
     button. It is in no gradebook, grading, report or student page, and it
     takes no grades (isDraftAssessment, getAssignedAssessments in
     shared/data-assessments.js). The server keeps it from students.
   - Assign keeps a future Date Assigned (students see it from that day;
     the card says "Students See It Nov 20") and moves a past one to today.
   - Unassign (the card's ⋯ menu) only while no student has a grade, a
     status or sent work on it; the server refuses it too.

   PageAssignments draws what this returns; clicks on [data-draft-act] come
   here through listen(). */
/** @type {any} */ (window).AssignDraft = (function () {
  'use strict';

  var G = /** @type {any} */ (window);

  // The Draft being assigned from its edit form (its id), until the save goes ahead.
  /** @type {string | null} */
  var assigning = null;

  /** @param {any} a */
  function isDraft(a) {
    return !!(a && a.isDraft);
  }

  /** @param {string} cid */
  function _today(cid) {
    return typeof G.courseToday === 'function' ? G.courseToday(cid) : new Date().toISOString().slice(0, 10);
  }

  /** @param {any} a */
  function _dateOf(a) {
    return String((a && (a.dateAssigned || a.date)) || '').slice(0, 10);
  }

  /** @param {string} cid */
  function _pageOn(cid) {
    return typeof G.getReturnSettings === 'function' && !!G.getReturnSettings(cid).student_page;
  }

  /* Whether any student has something on the piece: a grade or any score
     row, a status (Missing, Excused, Late…), or work sent in. While one
     does, it can't go back to being a Draft. */
  /** @param {string} cid @param {string} aid */
  function hasWork(cid, aid) {
    var scores = (typeof G.getScores === 'function' && G.getScores(cid)) || {};
    var scored = Object.keys(scores).some(function (sid) {
      return (scores[sid] || []).some(function (/** @type {any} */ s) {
        return s && s.assessmentId === aid;
      });
    });
    if (scored) return true;
    var statuses = (typeof G.getAssignmentStatuses === 'function' && G.getAssignmentStatuses(cid)) || {};
    var suffix = ':' + aid;
    if (
      Object.keys(statuses).some(function (k) {
        return k.slice(-suffix.length) === suffix && statuses[k];
      })
    )
      return true;
    return typeof G._workSentIn === 'function' && G._workSentIn(cid, 'piece', aid).length > 0;
  }

  /* Sets `a` to assigned: a Date Assigned already past moves to today. */
  /** @param {string} cid @param {any} a */
  function assignInto(cid, a) {
    var today = _today(cid);
    delete a.isDraft;
    if (_dateOf(a) < today) {
      a.date = today;
      a.dateAssigned = today;
    }
    return a;
  }

  /* Assigns the Drafts among `aids`; returns how many. */
  /** @param {string} cid @param {string[]} aids */
  function assign(cid, aids) {
    var list = G.getAssessments(cid) || [];
    var n = 0;
    list.forEach(function (/** @type {any} */ a) {
      if (a && isDraft(a) && aids.indexOf(a.id) >= 0) {
        assignInto(cid, a);
        n++;
      }
    });
    if (n) G.saveAssessments(cid, list);
    return n;
  }

  /** @param {string} cid @param {string} aid */
  function unassign(cid, aid) {
    if (hasWork(cid, aid)) return false;
    var list = G.getAssessments(cid) || [];
    var a = list.find(function (/** @type {any} */ x) {
      return x && x.id === aid;
    });
    if (!a || isDraft(a)) return false;
    a.isDraft = true;
    G.saveAssessments(cid, list);
    return true;
  }

  /* ── What the page draws ─────────────────────────────────── */

  /** @param {string} cid @param {any} a */
  function _ids(cid, a) {
    return 'data-cid="' + G.esc(cid) + '" data-aid="' + G.esc(a.id) + '"';
  }

  /* The form's footer buttons, after its notes. */
  // html-safe: fixed labels; the id is ours
  /** @param {boolean} isEdit @param {any} assess */
  function footerHtml(isEdit, assess) {
    var cancel = '<button class="btn btn-ghost" data-action="cancelAssessForm">Cancel</button>';
    if (isEdit) {
      var aid = 'data-aid="' + G.esc(assess.id) + '"';
      return (
        cancel +
        (isDraft(assess)
          ? '<button class="btn btn-ghost" data-action="saveEditAssess" ' +
            aid +
            '>Save Changes</button>' +
            '<button class="btn btn-primary" data-action="saveEditAssess" data-assign="1" ' +
            aid +
            '>Assign</button>'
          : '<button class="btn btn-primary" data-action="saveEditAssess" ' + aid + '>Save Changes</button>')
      );
    }
    return (
      cancel +
      '<button class="btn btn-ghost" data-action="saveNewAssess" data-draft="1" title="Only you see it until you assign it">Save as Draft</button>' +
      // Create and Add Another (redesign PR 11): saves, then a fresh form
      // keeping the settings a run of similar work shares.
      '<button class="btn btn-ghost" data-action="saveAndAddAnother" aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter" title="Ctrl/⌘+Shift+Enter">Create and Add Another</button>' +
      '<button class="btn btn-primary" data-action="saveNewAssess">Create Assessment</button>'
    );
  }

  /* The card's chip: Draft, or on assigned work whose day hasn't come,
     "Students See It Nov 20" (only with the student page on). */
  // html-safe: fixed words and a formatted date
  /** @param {string} cid @param {any} a */
  function chipHtml(cid, a) {
    if (isDraft(a)) return '<span class="draft-badge" title="Only you see it until you assign it">Draft</span>';
    var d = _dateOf(a);
    var today = _today(cid);
    if (!d || d <= today || !_pageOn(cid)) return '';
    return '<span class="draft-sees-badge">Students See It ' + G.esc(G.formatShortDate(d, today)) + '</span>';
  }

  // html-safe: fixed label; the id and title go through esc
  /** @param {string} cid @param {any} a */
  function assignButtonHtml(cid, a) {
    if (!isDraft(a)) return '';
    return (
      '<button type="button" class="btn btn-primary draft-assign-btn" data-draft-act="assign" ' +
      _ids(cid, a) +
      ' aria-label="Assign ' +
      G.esc(a.title || 'this assessment') +
      '">Assign</button>'
    );
  }

  /* An open Draft's body, in place of the grading grid. */
  // html-safe: fixed words; the id is ours
  /** @param {string} cid @param {any} a */
  function bodyHtml(cid, a) {
    var d = _dateOf(a);
    var today = _today(cid);
    var when = d > today ? ' Once assigned, students see it from ' + G.esc(G.formatShortDate(d, today)) + '.' : '';
    return (
      '<div class="draft-body"><p>Students can’t see this yet, and it isn’t in the gradebook.' +
      when +
      '</p><button type="button" class="btn btn-ghost" data-action="editAssess" data-aid="' +
      G.esc(a.id) +
      '">Edit Assessment</button></div>'
    );
  }

  /* The ⋯ menu's Assign (a Draft) or Unassign (greyed once a student has
     a grade or sent work). `item` is the page's menu item builder. */
  // html-safe: fixed labels; the id is ours
  /** @param {string} cid @param {any} a @param {(attrs: string, icon: string | null, label: string, cls?: string) => string} item */
  function menuItemsHtml(cid, a, item) {
    var aid = _ids(cid, a);
    if (isDraft(a)) return item('data-draft-act="assign" ' + aid, null, 'Assign');
    if (hasWork(cid, a.id))
      return item('disabled title="Students have work or grades on this."', null, 'Unassign', 'draft-unassign-off');
    return item(
      'data-draft-act="unassign" ' + aid + ' title="Hides it from students until you assign it again."',
      null,
      'Unassign',
    );
  }

  /* ── Clicks ─────────────────────────────────────────────── */

  /** @param {Event} e */
  function _onClick(e) {
    var el = /** @type {HTMLElement} */ (e.target);
    var t = /** @type {HTMLElement | null} */ (el && el.closest ? el.closest('[data-draft-act]') : null);
    if (!t) return;
    var cid = t.dataset.cid || '';
    var aid = t.dataset.aid || '';
    if (!cid || !aid) return;
    e.preventDefault();
    e.stopPropagation();
    if (t.dataset.draftAct === 'assign') assign(cid, [aid]);
    else if (t.dataset.draftAct === 'unassign') unassign(cid, aid);
    if (G.PageAssignments) G.PageAssignments.render();
  }

  /** @param {(type: string, fn: (e: Event) => void, opts?: any) => void} add */
  function listen(add) {
    add('click', _onClick, true);
  }

  return {
    isDraft: isDraft,
    hasWork: hasWork,
    assign: assign,
    assignInto: assignInto,
    unassign: unassign,
    footerHtml: footerHtml,
    chipHtml: chipHtml,
    assignButtonHtml: assignButtonHtml,
    bodyHtml: bodyHtml,
    menuItemsHtml: menuItemsHtml,
    listen: listen,
    get assigning() {
      return assigning;
    },
    set assigning(v) {
      assigning = v;
    },
  };
})();
