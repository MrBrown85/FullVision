// @ts-check
/* assign-crud.js — Assignments: creating, saving and deleting an assessment. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignCrud = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _blankWritten,
    _formChanges,
    _hideAfTip,
    _markFormStart,
    _refreshCountsToward,
    _refreshUntaggedNote,
    _syncCodes,
    pageState,
    renderAssessForm,
    _resetCollabState,
    _studentPageOn,
    renderCollabPanel;
  function configure(h) {
    if ('_blankWritten' in h) _blankWritten = h._blankWritten;
    if ('_formChanges' in h) _formChanges = h._formChanges;
    if ('_hideAfTip' in h) _hideAfTip = h._hideAfTip;
    if ('_markFormStart' in h) _markFormStart = h._markFormStart;
    if ('_refreshCountsToward' in h) _refreshCountsToward = h._refreshCountsToward;
    if ('_refreshUntaggedNote' in h) _refreshUntaggedNote = h._refreshUntaggedNote;
    if ('_syncCodes' in h) _syncCodes = h._syncCodes;
    if ('pageState' in h) pageState = h.pageState;
    if ('renderAssessForm' in h) renderAssessForm = h.renderAssessForm;
    if ('_resetCollabState' in h) _resetCollabState = h._resetCollabState;
    if ('_studentPageOn' in h) _studentPageOn = h._studentPageOn;
    if ('renderCollabPanel' in h) renderCollabPanel = h.renderCollabPanel;
  }

  /* ── Assessment CRUD ────────────────────────────────────── */
  function showNewForm() {
    _resetCollabState();
    pageState._showingNewForm = true;
    pageState._editingAssessId = null;
    var form = document.getElementById('new-assess-form');
    if (form) {
      form.style.display = 'block';
      form.innerHTML = renderAssessForm(pageState.activeCourse, null);
      form.scrollIntoView({ behavior: 'smooth' });
      renderCollabPanel();
      _refreshCountsToward();
      _syncCodes();
      _markFormStart();
      var title = document.getElementById('af-title');
      if (title) title.focus({ preventScroll: true });
    }
  }
  // What a card would stay for under Show's options: point to preview dims the rest.
  function _cardHas(n) {
    var words = [
      n.submitted > 0 ? 'submitted' : '',
      n.tograde > 0 ? 'tograde' : '',
      n.drafts > 0 ? 'toreturn' : '',
      n.notin > 0 ? 'notin' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return words ? ' data-has="' + words + '"' : '';
  }
  // New Quiz (Colin, Nov 24): offered with quizzes on, the builder loaded and the Student Page on.
  function _quizOn(cid) {
    return !!(window.QuizBuilder && BuildFlags.on('quizzes') && _studentPageOn(cid));
  }
  function _newQuizBtn(cid) {
    return _quizOn(cid)
      ? '<button class="tb-action-btn tb-action-secondary" data-action="newQuiz">+ New Quiz</button>'
      : '';
  }
  function hideNewForm() {
    _hideAfTip();
    pageState._showingNewForm = false;
    pageState._editingAssessId = null;
    pageState._pendingFormRubric = null;
    pageState._scoreMoveAfterSave = null;
    pageState._formStart = null;
    var form = document.getElementById('new-assess-form');
    if (form) form.style.display = 'none';
  }

  /* Saves the rubric made for this assessment, if it's the one chosen, then
     calls `then` again; true while that's under way. The teacher's own
     wording in it starts their next drafts, as a saved rubric's does. */
  function _persistPendingFormRubric(then) {
    var held = pageState._pendingFormRubric;
    var dd = /** @type {any} */ (document.getElementById('af-rubric'));
    var mode = (document.getElementById('af-scoremode') || /** @type {any} */ ({})).value || 'proficiency';
    if (!held || !dd || dd.value !== held.id || mode !== 'proficiency') return false;
    var cid = pageState.activeCourse;
    pageState._pendingFormRubric = null;
    var copiedFrom = held._copiedFrom;
    var editing = pageState._editingAssessId;
    held = structuredClone(held);
    delete held._copiedFrom;
    // Signed in, saving gives `held` and its criteria the server's ids in
    // place; the form's option and copiedFrom still use the ids it was sent with.
    var sent = structuredClone(held);
    var list = structuredClone(getRubrics(cid)).concat([held]);
    if (window.RubricDraft && typeof saveCompetencyDescriptors === 'function') {
      saveCompetencyDescriptors(
        RubricDraft.savedEntries(
          held,
          function (id) {
            return getTagById(cid, id);
          },
          getCompetencyDescriptor,
        ),
      );
    }
    Promise.resolve(saveRubrics(cid, list)).then(function (result) {
      var finalId = result && result.idMap && result.idMap[sent.id] ? result.idMap[sent.id] : held.id;
      if (copiedFrom && editing)
        pageState._scoreMoveAfterSave = _scoreMoveMaps(cid, editing, finalId, copiedFrom, sent, result);
      var box = /** @type {any} */ (document.getElementById('af-rubric'));
      if (box) {
        var opt = /** @type {any} */ (box.querySelector('option[value="' + sent.id + '"]'));
        if (opt) opt.value = finalId;
        box.value = finalId;
      }
      then();
    });
    return true;
  }

  /* Original → saved criterion and checkbox ids for a copy. `held` is the
     copy as sent and `saved` the same rubric as stored, criteria in the same
     order; each held id leads back to its original through copiedFrom, so
     edits in the copy editor never move a score onto the wrong criterion.
     A checkbox takes the first saved one at its level with its wording that
     no earlier checkbox took, so two with the same wording keep two ids.
     Nothing moves unless the copy reached the server with server ids: a
     failed save leaves the scores where the server has them. */
  function _scoreMoveMaps(cid, aid, rid, copiedFrom, held, result) {
    var saved =
      ((result && result.rubrics) || []).find(function (r) {
        return r.id === rid;
      }) || getRubricById(cid, rid);
    var sent = (held && held.criteria) || [];
    if (!saved || (saved.criteria || []).length !== sent.length) return null;
    var online = typeof _writesEnabled === 'function' && _writesEnabled();
    if (
      online &&
      !(
        _isUuid(rid) &&
        saved.criteria.every(function (c) {
          return _isUuid(c.id);
        })
      )
    )
      return null;
    var maps = { aid: aid, rubricId: rid, criteria: {}, checks: {} };
    sent.forEach(function (c, i) {
      var to = saved.criteria[i];
      var orig = copiedFrom.criteria[c.id];
      if (!to || !orig) return;
      maps.criteria[orig] = to.id;
      var taken = {};
      (c.checks || []).forEach(function (k) {
        var origCheck = copiedFrom.checks[k.id];
        var match = (to.checks || []).find(function (tk) {
          return !taken[tk.id] && tk.level === k.level && tk.label === k.label;
        });
        if (match) taken[match.id] = true;
        if (origCheck && match) maps.checks[origCheck] = match.id;
      });
    });
    return Object.keys(maps.criteria).length ? maps : null;
  }

  /* Cancel asks first when the form differs from how it opened: a new
     assessment from the blank form, an edit from the stored values. A
     rubric made for it is kept only when the assessment is saved. */
  /* Cancel, or leaving the form for another page (`then`, after it
     closes): a form with changes asks first. */
  function cancelAssessForm(then) {
    var title = ((document.getElementById('af-title') || /** @type {any} */ ({})).value || '').trim();
    var editing = !!pageState._editingAssessId;
    var dirty = _formChanges().length > 0 || !!pageState._pendingFormRubric || _blankWritten();
    var close = function () {
      hideNewForm();
      if (typeof then === 'function') then();
    };
    if (!dirty) {
      close();
      return;
    }
    _formDialog(
      editing ? 'Discard Your Changes?' : 'Discard This Assessment?',
      editing
        ? 'Your changes to ' + (title || 'this assessment') + ' aren\u2019t saved.'
        : (title || 'This assessment') +
            ' hasn\u2019t been created.' +
            (pageState._pendingFormRubric ? ' The rubric you made for it isn\u2019t kept either.' : ''),
      [
        { label: 'Keep Editing', style: 'cancel' },
        { label: 'Discard', style: 'danger', run: close },
      ],
    );
  }

  /* A small dialog: a title, a message and buttons, the last the default. */
  function _formDialog(title, message, buttons) {
    var trigger = /** @type {any} */ (document.activeElement);
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'af-dialog-title');
    // html-safe: the title, message and labels go through esc()
    overlay.innerHTML =
      '<div class="confirm-card af-dialog-card"><div class="confirm-title" id="af-dialog-title">' +
      esc(title) +
      '</div><div class="confirm-message">' +
      esc(message) +
      '</div><div class="confirm-actions">' +
      buttons
        .map(function (b, i) {
          return (
            '<button type="button" class="' +
            (b.style === 'cancel' || b.style === 'secondary' ? 'confirm-cancel' : 'confirm-ok ' + esc(b.style)) +
            '" data-i="' +
            i +
            '"' +
            (b.disabled ? ' disabled' : '') +
            '>' +
            esc(b.label) +
            '</button>'
          );
        })
        .join('') +
      '</div></div>';
    var close = function () {
      overlay.remove();
      if (trigger && document.body.contains(trigger) && trigger.focus) trigger.focus();
    };
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) return close();
      var b = /** @type {any} */ (e.target).closest('[data-i]');
      if (!b) return;
      var def = buttons[Number(b.dataset.i)];
      close();
      if (def && def.run) def.run();
    });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    document.body.appendChild(overlay);
    // A dialog that can throw work away starts on the safe button.
    var danger = buttons.some(function (b) {
      return b.style === 'danger';
    });
    var first = danger
      ? overlay.querySelector('.confirm-actions .confirm-cancel')
      : overlay.querySelector('.confirm-actions button:last-child:not([disabled])');
    if (first) /** @type {any} */ (first).focus();
  }

  function toggleSectionTags(secId) {
    var cbs = document.querySelectorAll('.af-tag-cb[data-section="' + secId + '"]');
    var allChecked = Array.from(cbs).every(function (cb) {
      return /** @type {any} */ (cb).checked;
    });
    cbs.forEach(function (cb) {
      /** @type {any} */ (cb).checked = !allChecked;
      /** @type {any} */ (cb.parentElement).classList.toggle('checked', !allChecked);
    });
    updateSectionBadge(secId);
  }
  function onTagChange(cb, secId) {
    cb.parentElement.classList.toggle('checked', cb.checked);
    var tc = /** @type {any} */ (document.querySelector('.af-tags-container'));
    if (tc) tc.style.border = '';
    updateSectionBadge(secId);
  }
  function updateSectionBadge(secId) {
    _refreshUntaggedNote();
    var cbs = document.querySelectorAll('.af-tag-cb[data-section="' + secId + '"]');
    var count = Array.from(cbs).filter(function (cb) {
      return /** @type {any} */ (cb).checked;
    }).length;
    var group = cbs[0] ? cbs[0].closest('.af-section-group') : null;
    if (!group) return;
    var badge = group.querySelector('.af-section-badge');
    if (count > 0) {
      if (badge) {
        badge.textContent = /** @type {any} */ (count);
      } else {
        var header = /** @type {any} */ (group.querySelector('.af-section-header'));
        var selectAll = header.querySelector('.af-select-all');
        var sec = getSections(pageState.activeCourse).find(function (s) {
          return s.id === secId;
        });
        var b = document.createElement('span');
        b.className = 'af-section-badge';
        b.style.background = sec ? sec.color : 'var(--text-3)';
        b.textContent = /** @type {any} */ (count);
        header.insertBefore(b, selectAll);
      }
    } else {
      if (badge) badge.remove();
    }
  }

  return {
    configure: configure,
    _cardHas: _cardHas,
    _formDialog: _formDialog,
    _newQuizBtn: _newQuizBtn,
    _persistPendingFormRubric: _persistPendingFormRubric,
    _quizOn: _quizOn,
    cancelAssessForm: cancelAssessForm,
    hideNewForm: hideNewForm,
    onTagChange: onTagChange,
    showNewForm: showNewForm,
    toggleSectionTags: toggleSectionTags,
    updateSectionBadge: updateSectionBadge,
  };
})();
