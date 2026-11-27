// @ts-check
/* assign-grader-queue.js — Work to grade on the Assignments page. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignGraderQueue = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var RES_LINK_WORDS,
    _CLASS_RESULTS_ICON,
    _GRADER_MORE_ICON,
    _checklistMode,
    _isAdvancedRubric,
    editAssess,
    openGrader,
    pageState,
    render,
    _workLineText,
    _workShortName,
    _workStudent,
    _workSubOf;
  function configure(h) {
    if ('RES_LINK_WORDS' in h) RES_LINK_WORDS = h.RES_LINK_WORDS;
    if ('_CLASS_RESULTS_ICON' in h) _CLASS_RESULTS_ICON = h._CLASS_RESULTS_ICON;
    if ('_GRADER_MORE_ICON' in h) _GRADER_MORE_ICON = h._GRADER_MORE_ICON;
    if ('_checklistMode' in h) _checklistMode = h._checklistMode;
    if ('_isAdvancedRubric' in h) _isAdvancedRubric = h._isAdvancedRubric;
    if ('editAssess' in h) editAssess = h.editAssess;
    if ('openGrader' in h) openGrader = h.openGrader;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('_workLineText' in h) _workLineText = h._workLineText;
    if ('_workShortName' in h) _workShortName = h._workShortName;
    if ('_workStudent' in h) _workStudent = h._workStudent;
    if ('_workSubOf' in h) _workSubOf = h._workSubOf;
  }

  /* ── Work to grade on the Assignments page (S6-F4) ───────────
     In a class whose student page and Send Work are on: the Show bar
     (All | Submitted | To Grade 9 | Not In, assign-show.js) on the toolbar, "6 to grade" on a card, Grade Submissions,
     which opens the grader dialog on the work waiting (Show on To Grade),
     and on one student's grader, what came in and Add Work. Every number is
     GraderWork.workCounts', as the gradebook's and the dashboard's are. */
  // html-safe: ids are ours; fixed words
  function _gradeSubmissionsHtml(cid, a, shownIds, tograde) {
    if (pageState.focusStudentId || !GraderWork.workOn(cid, a)) return '';
    if (!(tograde != null ? tograde : GraderWork.workCounts(cid, a.id, shownIds).tograde)) return '';
    return (
      '<button type="button" class="assess-grade-work-btn" data-action="gradeSubmissions" data-aid="' +
      a.id +
      '">Grade Submissions</button>'
    );
  }

  /* The open card's header (AssignmentsPage board): Grade Submissions
     and a ⋯ menu, so the title keeps its room. Every action the old row
     of buttons had is in the ⋯ menu: Class Results, Print, the Work Wall
     (while the piece takes work), Grade by Competencies or Rubric, Show or
     Hide Checklists, Set Everyone To (Colin, Nov 16: in the menu, not a
     button of its own on the bar), Edit Assessment, Duplicate, Copy to
     Another Class… and Delete…. One menu is open at a time; a click
     elsewhere or Esc closes it. */
  var _ARROW_RIGHT_ICON =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8h11M9 3.5L13.5 8 9 12.5"/></svg>';
  var _SUB_CARET =
    '<svg class="assess-sub-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  var _WALL_ICON =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="2" width="5.5" height="5" rx="1"/><rect x="9" y="2" width="5.5" height="5" rx="1"/><rect x="1.5" y="9" width="5.5" height="5" rx="1"/><rect x="9" y="9" width="5.5" height="5" rx="1"/></svg>';

  // html-safe: attrs are built from our ids and fixed words; label and icon are fixed
  function _cardMenuItem(attrs, icon, label, cls) {
    return (
      '<button type="button" role="menuitem" class="assess-menu-item' +
      (cls ? ' ' + cls : '') +
      '" ' +
      attrs +
      '>' +
      (icon || '<span class="assess-menu-icon" aria-hidden="true"></span>') +
      '<span>' +
      label +
      '</span></button>'
    );
  }

  /* The ⋯ menu's Set Everyone To › while the class's levels grid shows
     (the competency or rubric grid, not one student's grader, points, a
     mark or DIBELS): a submenu of the four levels in the class's order
     (teacher/card-menu.js). Points and Complete/Incomplete keep their Set
     Unmarked To buttons above their grid. */
  // html-safe: ids are ours; level names are fixed
  function _setEveryoneMenuHtml(cid, a) {
    if (pageState.focusStudentId || isDibelsScored(a) || isCompletionScored(a) || a.scoreMode === 'points') return '';
    var rubric = a.rubricId && getRubricById(cid, a.rubricId);
    var showRubric = pageState.rubricViewStates[a.id] !== undefined ? pageState.rubricViewStates[a.id] : true;
    var action = rubric && showRubric ? 'confirmFillRubricAll' : 'confirmFillAll';
    var items = levelOrderFor(cid)
      .map(function (l) {
        return _cardMenuItem(
          'data-action="' +
            action +
            '" data-aid="' +
            a.id +
            '" data-score="' +
            l +
            '" data-label="' +
            PROF_LABELS[l] +
            '"',
          '<span class="assess-menu-dot l' + l + '" aria-hidden="true"></span>',
          PROF_LABELS[l],
        );
      })
      .join('');
    return (
      '<div class="assess-setto">' +
      '<span class="assess-menu-sep" role="separator"></span>' +
      '<button type="button" role="menuitem" class="assess-menu-item assess-sub-btn" data-action="openCardSubmenu" aria-haspopup="menu" aria-expanded="false">' +
      '<span class="assess-menu-icon" aria-hidden="true"></span><span>Set Everyone To</span>' +
      _SUB_CARET +
      '</button>' +
      '<div class="assess-menu assess-submenu" role="menu" aria-label="Set Everyone To" hidden>' +
      items +
      '</div></div>'
    );
  }

  // The ⋯ menu's Print: the same print the card always offered.
  function _cardPrintItem(cid, a) {
    var attrs = function (action, title) {
      return 'data-action="' + action + '" data-aid="' + a.id + '" title="' + title + '"';
    };
    if (a.rubricId && getRubricById(cid, a.rubricId))
      return _cardMenuItem(
        attrs('printRubrics', 'Print a graded rubric for each student'),
        LINE_ICONS.print,
        'Print Rubrics',
      );
    if (isDibelsScored(a))
      return _cardMenuItem(
        attrs('printDibels', 'Print this window’s scores for the class'),
        LINE_ICONS.print,
        'Print Class Sheet',
      );
    if (!isPointsScored(a)) {
      // No rubric of its own: a Tag Rubric, or a General Rubric when it
      // has no competencies, with the proficiency scale's wording.
      var kind = scoreTagIds(a, cid).some(function (t) {
        return !isUnlinkedTag(t);
      })
        ? 'tag'
        : 'general';
      return _cardMenuItem(
        attrs('printRubrics', 'Print a graded ' + kind + ' rubric for each student'),
        LINE_ICONS.print,
        'Print Rubrics',
      );
    }
    // Points and Complete/Incomplete: a score sheet per student.
    return _cardMenuItem(
      attrs('printRubrics', 'Print each student’s ' + (isCompletionScored(a) ? 'mark' : 'score') + ' and feedback'),
      LINE_ICONS.print,
      'Print Scores',
    );
  }

  // html-safe: ids are ours; labels and icons are fixed
  function _cardMoreMenuHtml(cid, a) {
    var aid = 'data-aid="' + a.id + '"';
    // A Draft has no grading: Assign, Print, then what any piece has (assign-draft.js).
    var html =
      (a.isDraft
        ? AssignDraft.menuItemsHtml(cid, a, _cardMenuItem)
        : _cardMenuItem(
            'data-action="classResults" data-cid="' + esc(cid) + '" ' + aid,
            _CLASS_RESULTS_ICON,
            'Class Results',
          )) + _cardPrintItem(cid, a);
    html += ViewAsStudent.menuItemHtml(cid, a, _cardMenuItem);
    // Work Wall (S14, shared/work-wall.js): every student's work side by side, only while the piece takes work.
    var workShown = !a.isDraft && !pageState.focusStudentId && GraderWork.workShown(cid, a);
    if (workShown && window.WorkWall)
      html += _cardMenuItem('data-action="openWorkWall" ' + aid, _WALL_ICON, 'Work Wall', 'assess-work-wall-btn');
    // Add Work for the Class (teacher/add-work-class.js): in every class, on
    // every piece it is offered on, never while one student is focused.
    if (!a.isDraft && !pageState.focusStudentId && window.AddWorkClass && AddWorkClass.offered(cid, a))
      html += _cardMenuItem(
        'data-action="openAddWorkClass" ' + aid,
        LINE_ICONS.plus,
        'Add Work for the Class',
        'assess-add-class-btn',
      );
    var rubric = !a.isDraft && a.rubricId && getRubricById(cid, a.rubricId);
    if (rubric) {
      var showRubric = pageState.rubricViewStates[a.id] !== undefined ? pageState.rubricViewStates[a.id] : true;
      html +=
        '<span class="assess-menu-sep" role="separator"></span>' +
        _cardMenuItem(
          'data-action="setRubricView" ' + aid + ' data-rubric="' + !showRubric + '"',
          null,
          showRubric ? 'Grade by Competencies' : 'Grade by Rubric',
        );
      if (showRubric && _isAdvancedRubric(rubric)) {
        var show = _checklistMode() === 'show';
        html += _cardMenuItem(
          'data-action="setChecklistMode" data-mode="' + (show ? 'hide' : 'show') + '"',
          null,
          show ? 'Hide Checklists' : 'Show Checklists',
        );
      } else if (showRubric && rubricStyle(rubric) === 'standard') {
        // A Standard rubric's words, beside where an Advanced one keeps its checklists (Colin, Nov 18).
        html += _cardMenuItem('data-rw="toggle"', null, RubricWords.shown() ? 'Hide Level Words' : 'Show Level Words');
      }
    }
    html +=
      (a.isDraft ? '' : _setEveryoneMenuHtml(cid, a)) +
      '<span class="assess-menu-sep" role="separator"></span>' +
      _cardMenuItem('data-action="editAssess" ' + aid, LINE_ICONS.edit, 'Edit Assessment') +
      _cardMenuItem('data-action="dupeAssess" ' + aid, LINE_ICONS.copy, 'Duplicate');
    var targets = window.AssessmentCopy ? AssessmentCopy.copyTargets(cid) : null;
    if (targets && (targets.sameCourse.length || targets.other.length))
      html += _cardMenuItem('data-action="copyAssessToClass" ' + aid, _ARROW_RIGHT_ICON, 'Copy to Another Class…');
    html +=
      (a.isDraft ? '' : AssignDraft.menuItemsHtml(cid, a, _cardMenuItem)) +
      '<span class="assess-menu-sep" role="separator"></span>' +
      _cardMenuItem('data-action="deleteAssess" ' + aid, LINE_ICONS.trash, 'Delete…', 'is-delete');
    return (
      '<div class="assess-menu-wrap assess-more">' +
      '<button type="button" class="assess-more-btn" data-action="toggleCardMenu" aria-haspopup="menu" aria-expanded="false" aria-label="More for ' +
      esc(a.title || 'this assessment') +
      '">' +
      _GRADER_MORE_ICON +
      '</button>' +
      '<div class="assess-menu" role="menu" aria-label="More" hidden>' +
      html +
      '</div></div>'
    );
  }

  /* Copy to Another Class…: the edit form, at its Classes row (the copy is
     made when the form is saved, as from the form itself). */
  function copyAssessToClass(aid) {
    editAssess(aid);
    var field = document.getElementById('af-copy-field');
    if (!field) return;
    field.scrollIntoView({ block: 'center' });
    var chip = /** @type {any} */ (field.querySelector('button.af-copy-chip:not([disabled])'));
    if (chip) chip.focus({ preventScroll: true });
  }

  /* One student's grader on the page: what came in ("Submitted Oct 30 ·
     2 photos", "Not In · 7 days late"), Same photo as, and the work icon
     (See the Work, or + to attach work when nothing is in). */
  // html-safe: names go through esc; ids are ours
  function _inlineWorkHtml(cid, a, sid) {
    if (!GraderWork.workShown(cid, a)) return '';
    var sub = _workSubOf(cid, sid, a.id);
    var st = _workStudent(cid, sid);
    var html = '<span class="grader-inline-work">' + esc(_workLineText(cid, a, sid, sub)) + '</span>';
    GraderWork.samePhotoAs(cid, a.id, sid).forEach(function (other) {
      var o = _workStudent(cid, other);
      if (o)
        html +=
          '<button type="button" class="grader-work-same" data-action="gradeSubmissions" data-aid="' +
          a.id +
          '" data-sid="' +
          other +
          '">' +
          esc('Same photo as ' + _workShortName(o)) +
          '</button>';
    });
    if (st) html += _workIconHtml(cid, a.id, st, sub);
    return html;
  }

  /* The work icon on a student's row (Colin, Nov 13: an icon in place of
     the words). Work in: See the Work, the page icon, which opens the
     grader on their pages; pointing at it still shows the glance
     (shared/work-wall.js, which finds it by .rsg-see-work). Nothing in: +,
     Attach Work, a menu of Image or PDF… (the grader's Add Work, from the
     row) and, where links can be kept, Link…. What is attached shows as
     the teacher's added work, and the + becomes See the Work. */
  var _attachBusy = {}; // 'aid|sid' → true while the row's + adds files

  // html-safe: ids are ours (and go through esc); the name goes through esc; icons and labels are fixed
  // known: the student's work when the caller has looked it up already
  // (null for none), so a row's work is read once: the speed guard counts it.
  function _workIconHtml(cid, aid, st, known) {
    if (!st || !window.GraderWork) return '';
    var ids = ' data-cid="' + esc(cid) + '" data-aid="' + esc(aid) + '" data-sid="' + esc(st.id) + '"';
    if (window.WorkWall) {
      // See the Work: WorkWall draws it (and wires the glance), as an icon;
      // '' when the piece shows no work, null when none is in.
      var see = WorkWall.seeWorkHtml(cid, aid, st.id, LINE_ICONS.work, known === undefined ? undefined : !!known);
      if (see) return see;
      if (see === '') return '';
    } else {
      var a = _assessmentById(cid, aid);
      if (!a || !GraderWork.workShown(cid, a)) return '';
      if (known !== undefined ? known : _workSubOf(cid, st.id, aid))
        return (
          '<button type="button" class="rsg-work-btn rsg-see-work" data-stop-prop="true" data-action="gradeSubmissions"' +
          ids +
          ' aria-label="See the Work" title="See the Work">' +
          LINE_ICONS.work +
          '</button>'
        );
    }
    var label = 'Attach Work for ' + displayNameFirst(st);
    if (_attachBusy[aid + '|' + st.id])
      return (
        '<button type="button" class="rsg-work-btn rsg-attach-btn is-busy" disabled aria-label="' +
        esc('Adding work for ' + displayNameFirst(st)) +
        '"><span class="rsg-attach-spin" aria-hidden="true"></span></button>'
      );
    // The menu and its file picker are made when the + is first clicked
    // (_attachMenuOpen): a class's grid has a + on most rows.
    return (
      '<div class="assess-menu-wrap rsg-attach">' +
      '<button type="button" class="rsg-work-btn rsg-attach-btn" data-stop-prop="true" data-action="attachWorkMenu" aria-haspopup="menu" aria-expanded="false"' +
      ids +
      ' aria-label="' +
      esc(label) +
      '" title="' +
      esc(label) +
      '">' +
      LINE_ICONS.plus +
      '</button></div>'
    );
  }

  /* The + menu for one row, made the first time it opens: Image or PDF…
     and, where links can be kept, Link…, with the hidden file picker. */
  // html-safe: ids are ours (and go through esc); the label goes through esc; icons and words are fixed
  function _attachMenuHtml(cid, aid, sid, label) {
    var ids = ' data-cid="' + esc(cid) + '" data-aid="' + esc(aid) + '" data-sid="' + esc(sid) + '"';
    var item = function (action, icon, text) {
      return (
        '<button type="button" role="menuitem" class="assess-menu-item" data-stop-prop="true" data-action="' +
        action +
        '"' +
        ids +
        '>' +
        icon +
        '<span>' +
        text +
        '</span></button>'
      );
    };
    return (
      '<div class="assess-menu rsg-attach-menu" role="menu" aria-label="' +
      esc(label) +
      '" hidden>' +
      item('attachWorkFiles', LINE_ICONS.image, 'Image or PDF…') +
      (typeof studentWorkLinksOffered === 'function' && studentWorkLinksOffered(cid)
        ? item('attachWorkLink', LINE_ICONS.link, 'Link…')
        : '') +
      '</div>' +
      '<input type="file" class="rsg-attach-file" multiple accept="image/*,.heic,.heif,application/pdf" hidden tabindex="-1" aria-hidden="true" data-action-change="attachWorkFile"' +
      ids +
      '>'
    );
  }
  function _attachMenuOpen(btn) {
    var wrap = btn.closest('.rsg-attach');
    if (!wrap) return;
    if (!wrap.querySelector('.rsg-attach-menu')) {
      var cid = btn.getAttribute('data-cid');
      var aid = btn.getAttribute('data-aid');
      var sid = btn.getAttribute('data-sid');
      // html-safe: _attachMenuHtml escapes its ids and label; the rest is fixed
      wrap.insertAdjacentHTML('beforeend', _attachMenuHtml(cid, aid, sid, btn.getAttribute('aria-label') || ''));
    }
    CardMenu.toggle(btn);
  }

  // The row's work icon for `sid`, once the page is drawn again.
  function _focusWorkIcon(aid, sid) {
    var sel = '.rsg-work-btn[data-aid="' + aid + '"][data-sid="' + sid + '"]';
    /** @type {any} */ var btn = null;
    try {
      btn = document.querySelector(sel);
    } catch (e) {
      btn = null;
    }
    if (btn && !btn.disabled) btn.focus({ preventScroll: true });
  }

  // A file the row's + couldn't use, or an answer that isn't "added": said once, in a toast.
  function _attachSay(text) {
    if (!text || typeof showSyncToast !== 'function') return;
    try {
      showSyncToast(text, 'info');
    } catch (e) {
      /* a toast is only a courtesy */
    }
  }

  // Image or PDF…: the files go in as the grader's Add Work puts them (shrunk, in order).
  function _attachWorkFiles(input) {
    var files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    var cid = pageState.activeCourse;
    var aid = input.getAttribute('data-aid');
    var sid = input.getAttribute('data-sid');
    var key = aid + '|' + sid;
    if (!files.length || !window.PhotoShrink || !cid || !aid || !sid || _attachBusy[key]) return;
    _attachBusy[key] = true;
    render();
    AddWorkFiles.prepare(files)
      .then(function (got) {
        if (got.said || !got.pages.length) return { result: 'refused', said: got.said };
        return addStudentWorkPages(cid, sid, aid, got.pages, { mode: 'new' });
      })
      .then(null, function () {
        return { result: 'store_failed' };
      })
      .then(function (res) {
        delete _attachBusy[key];
        if (res.result !== 'sent') _attachSay(res.said || AddWorkFiles.answer(res));
        if (pageState.activeCourse !== cid) return;
        render();
        if (!document.activeElement || document.activeElement === document.body) _focusWorkIcon(aid, sid);
      });
  }

  /* Link…: a small form under the +, a web address and an optional name,
     checked as the assessment form's links are (assessmentLinkCheck). */
  // html-safe: the name goes through esc; ids are ours (and go through esc); labels are fixed
  function _attachLinkHtml(cid, aid, sid) {
    var st = _workStudent(cid, sid);
    return (
      '<div class="rsg-attach-link" role="dialog" aria-label="' +
      esc('Attach a Link for ' + (st ? displayNameFirst(st) : 'this student')) +
      '" data-aid="' +
      esc(aid) +
      '" data-sid="' +
      esc(sid) +
      '">' +
      '<input class="af-input rsg-attach-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" aria-label="Web Address" placeholder="Paste a web address">' +
      '<input class="af-input rsg-attach-title" type="text" autocomplete="off" maxlength="200" aria-label="Name (optional)" placeholder="Name (optional)">' +
      '<p class="rsg-attach-msg" role="status" hidden></p>' +
      '<div class="rsg-attach-actions">' +
      '<button type="button" class="btn btn-ghost" data-stop-prop="true" data-action="attachLinkCancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-stop-prop="true" data-action="attachLinkAdd">Add Link</button>' +
      '</div></div>'
    );
  }
  function _openAttachLink(el) {
    var wrap = el && el.closest('.rsg-attach');
    if (!wrap) return;
    _closeAttachLink(false);
    CardMenu.close();
    // html-safe: built by _attachLinkHtml, which escapes the name and the ids
    wrap.insertAdjacentHTML('beforeend', _attachLinkHtml(pageState.activeCourse, el.dataset.aid, el.dataset.sid));
    var btn = wrap.querySelector('.rsg-attach-btn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    var url = wrap.querySelector('.rsg-attach-url');
    if (url) url.focus({ preventScroll: true });
  }
  function _closeAttachLink(refocus) {
    var open = document.querySelector('.rsg-attach-link');
    if (!open) return;
    var wrap = open.closest('.rsg-attach');
    open.remove();
    var btn = /** @type {any} */ (wrap && wrap.querySelector('.rsg-attach-btn'));
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      if (refocus) btn.focus({ preventScroll: true });
    }
  }
  function _attachLinkAdd(form) {
    if (!form || form.dataset.busy) return;
    var cid = pageState.activeCourse;
    var aid = form.dataset.aid;
    var sid = form.dataset.sid;
    var urlEl = form.querySelector('.rsg-attach-url');
    var msg = form.querySelector('.rsg-attach-msg');
    var say = function (text) {
      if (!msg) return;
      msg.textContent = text;
      msg.hidden = !text;
    };
    var check = typeof assessmentLinkCheck === 'function' ? assessmentLinkCheck(urlEl ? urlEl.value : '') : null;
    if (!check || !check.ok) {
      say(RES_LINK_WORDS[(check && check.reason) || 'not_web'] || RES_LINK_WORDS.not_web);
      if (urlEl) {
        urlEl.setAttribute('aria-invalid', 'true');
        urlEl.focus();
      }
      return;
    }
    var titleEl = form.querySelector('.rsg-attach-title');
    form.dataset.busy = '1';
    addStudentWorkLink(cid, sid, aid, check.url, titleEl ? titleEl.value : '').then(function (res) {
      delete form.dataset.busy;
      if (res.result !== 'sent') {
        say(
          res.result === 'invalid'
            ? RES_LINK_WORDS[res.reason] || RES_LINK_WORDS.not_web
            : res.result === 'on_paper'
              ? 'This was handed in on paper.'
              : res.result === 'not_found'
                ? 'This student is no longer in this class.'
                : 'Links can be added in Demo Mode only for now.',
        );
        return;
      }
      if (pageState.activeCourse !== cid) return;
      render();
      _focusWorkIcon(aid, sid);
    });
  }
  // Enter adds the link and Esc closes the form; every other key is the field's own.
  function _attachLinkKeydown(e) {
    var form = e.target && e.target.closest ? e.target.closest('.rsg-attach-link') : null;
    if (!form) return false;
    if (e.key === 'Escape') {
      e.preventDefault();
      _closeAttachLink(true);
    } else if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      _attachLinkAdd(form);
    }
    return true;
  }

  /* The grader dialog over this page, on `sid` or the first student whose
     work waits, with Show on To Grade when work waits. */
  function _openGraderOnWork(aid, sid) {
    var cid = pageState.activeCourse;
    if (pageState._grader || !aid || !_assessmentById(cid, aid)) return;
    var ids = sortStudents(getStudents(cid), 'lastName').map(function (s) {
      return s.id;
    });
    var waiting = GraderWork.workCounts(cid, aid, ids).ids.tograde;
    var to = sid || waiting[0];
    if (!to) return;
    // closeGrader puts the page back as it was before the dialog opened.
    openGrader(cid, aid, to, { show: !sid && waiting.length ? 'tograde' : 'all', overPage: true, onClose: render });
  }

  return {
    configure: configure,
    _attachLinkAdd: _attachLinkAdd,
    _attachLinkKeydown: _attachLinkKeydown,
    _attachMenuOpen: _attachMenuOpen,
    _attachWorkFiles: _attachWorkFiles,
    _cardMoreMenuHtml: _cardMoreMenuHtml,
    _closeAttachLink: _closeAttachLink,
    _gradeSubmissionsHtml: _gradeSubmissionsHtml,
    _inlineWorkHtml: _inlineWorkHtml,
    _openAttachLink: _openAttachLink,
    _openGraderOnWork: _openGraderOnWork,
    _workIconHtml: _workIconHtml,
    copyAssessToClass: copyAssessToClass,
  };
})();
