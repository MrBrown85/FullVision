// @ts-check
/* assign-grader-notes.js — A student's reflection and the Note for the Report in the grader. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignGraderNotes = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _checklistKey,
    _checklistMode,
    _closedChecklists,
    _criterionLevelNow,
    _criterionState,
    _graderNotesOpen,
    _hideChipTip,
    _isChecklistOpen,
    _offerClearUndo,
    _openChecklists,
    _pointsOverLimit,
    _refreshGraderChrome,
    _sayPointsCapped,
    _sixRubricOf,
    _sixScoreNow,
    _tagScoreKeys,
    _tagState,
    _writeSixScore,
    getRubricCriterion,
    pageState,
    render,
    _addDocListener,
    _graderReleasePage;
  function configure(h) {
    if ('_checklistKey' in h) _checklistKey = h._checklistKey;
    if ('_checklistMode' in h) _checklistMode = h._checklistMode;
    if ('_closedChecklists' in h) _closedChecklists = h._closedChecklists;
    if ('_criterionLevelNow' in h) _criterionLevelNow = h._criterionLevelNow;
    if ('_criterionState' in h) _criterionState = h._criterionState;
    if ('_graderNotesOpen' in h) _graderNotesOpen = h._graderNotesOpen;
    if ('_hideChipTip' in h) _hideChipTip = h._hideChipTip;
    if ('_isChecklistOpen' in h) _isChecklistOpen = h._isChecklistOpen;
    if ('_offerClearUndo' in h) _offerClearUndo = h._offerClearUndo;
    if ('_openChecklists' in h) _openChecklists = h._openChecklists;
    if ('_pointsOverLimit' in h) _pointsOverLimit = h._pointsOverLimit;
    if ('_refreshGraderChrome' in h) _refreshGraderChrome = h._refreshGraderChrome;
    if ('_sayPointsCapped' in h) _sayPointsCapped = h._sayPointsCapped;
    if ('_sixRubricOf' in h) _sixRubricOf = h._sixRubricOf;
    if ('_sixScoreNow' in h) _sixScoreNow = h._sixScoreNow;
    if ('_tagScoreKeys' in h) _tagScoreKeys = h._tagScoreKeys;
    if ('_tagState' in h) _tagState = h._tagState;
    if ('_writeSixScore' in h) _writeSixScore = h._writeSixScore;
    if ('getRubricCriterion' in h) getRubricCriterion = h.getRubricCriterion;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('_addDocListener' in h) _addDocListener = h._addDocListener;
    if ('_graderReleasePage' in h) _graderReleasePage = h._graderReleasePage;
  }

  /* ── A student's reflection in the grader (S10-F3) ─────────
     The board "Teacher: Grader, Returned Work With a Reflection". In a
     class whose student page (the build switch) and Reflect on Feedback
     are on, a student who has a grade back can say whether the feedback
     makes sense, ask a question and make a plan (shared/data.js, "Reflect
     on Feedback"). Their reflection shows above the scoring, on that
     student's grader only:
     - not sure: what they asked, a box for the answer and Send Answer;
       then, once they say whether it makes sense now, the follow-up and a
       second answer;
     - makes sense: their plan and what went well, and Save as
       Observation, which keeps their words as one of the teacher's notes
       on them (addQuickOb), linked to the piece.
     The student wrote it under "Only Mr. Brown sees this": their words
     show on this student's grader only, and nothing here sends them
     anywhere but the teacher's own notes. Send Answer's answer goes to
     this student alone (answerReflection). Demo Mode only for now: signed
     in no reflection is read (S10-W1). The row is made only when there is
     a reflection, so with the switch off the dialog is as it was. */
  function _graderReflection(cid, a, sid) {
    // getStudentReflections lists none while Reflect on Feedback is off.
    if (typeof getStudentReflections !== 'function' || isDibelsScored(a)) return null;
    return (
      getStudentReflections(cid, sid).find(function (r) {
        return r.assessment_id === a.id;
      }) || null
    );
  }

  // "Nov 4, the day after you returned it"
  function _reflectWhen(cid, a, sid, r) {
    var day = String(r.sent_at || '').slice(0, 10);
    if (!day) return '';
    var out = formatShortDate(day);
    var row = getGradeReturn(cid, sid, a.id);
    var back = row && row.returned_at ? String(row.returned_at).slice(0, 10) : '';
    if (!back || back > day) return out;
    var days = Math.round((Date.parse(day) - Date.parse(back)) / 86400000);
    if (days === 0) return out + ', the day you returned it';
    if (days === 1) return out + ', the day after you returned it';
    return out + ', ' + days + ' days after you returned it';
  }

  // The words Save as Observation keeps: the student's own, quoted.
  function _reflectObservationText(a, r) {
    var out = [];
    if (r.plan) out.push('Plan after ' + (a.title || 'this work') + ': “' + r.plan.trim() + '”');
    if (r.went_well) out.push('Went well: “' + r.went_well.trim() + '”');
    return out.join(' ');
  }
  function _reflectSaved(cid, sid, a, r) {
    var text = _reflectObservationText(a, r);
    if (!text) return false;
    return ((getQuickObs(cid) || {})[sid] || []).some(function (o) {
      return o && o.text === text && o.assignmentContext && o.assignmentContext.assessmentId === a.id;
    });
  }

  // html-safe: the student's words, names and dates go through esc; ids are escaped; labels are fixed words
  function _graderReflectionHtml(cid, a, st) {
    var r = _graderReflection(cid, a, st.id);
    if (!r) return '';
    var first = displayNameFirst(st);
    var said = function (who, text) {
      return '<p class="grader-reflect-who">' + esc(who) + '</p><p class="grader-reflect-said">' + esc(text) + '</p>';
    };
    var on = function (ts) {
      return formatShortDate(String(ts || '').slice(0, 10));
    };
    var html =
      '<section class="grader-reflect" aria-labelledby="grader-reflect-title">' +
      '<div class="grader-reflect-head"><h3 id="grader-reflect-title" class="grader-reflect-title">' +
      esc(first + '’s Reflection') +
      '</h3><p class="grader-reflect-when">' +
      esc(_reflectWhen(cid, a, st.id, r)) +
      '</p></div>';
    if (r.makes_sense === 'not_sure') {
      html += '<p class="grader-reflect-sense is-unsure">Not sure about the feedback</p>';
      html += said(first + ' asks:', r.question || '');
    } else {
      html += '<p class="grader-reflect-sense">The feedback makes sense</p>';
    }
    if (r.plan) html += said(first + '’s plan:', r.plan);
    if (r.went_well) html += said('What went well:', r.went_well);
    if (r.answer) html += said('You answered ' + on(r.answered_at) + ':', r.answer);
    if (r.sense_now === 'yes')
      html += '<p class="grader-reflect-now">' + esc(first + ' says it makes sense now.') + '</p>';
    if (r.follow_up) html += said(first + ' is still not sure and asks:', r.follow_up);
    if (r.follow_up_answer) html += said('You answered ' + on(r.follow_up_answered_at) + ':', r.follow_up_answer);
    var busy = pageState._grader.reflectBusy === r.id;
    if (r.waiting) {
      html +=
        '<label class="grader-reflect-label" for="grader-reflect-answer">' +
        esc('Your answer to ' + first) +
        '</label>' +
        '<textarea id="grader-reflect-answer" class="grader-reflect-input" rows="3" maxlength="2000" data-id="' +
        esc(r.id) +
        '"' +
        (busy ? ' disabled' : '') +
        '></textarea>' +
        '<div class="grader-reflect-actions">' +
        '<button type="button" class="btn btn-primary btn-sm grader-reflect-send" data-grader="reflect-send" data-id="' +
        esc(r.id) +
        '"' +
        (busy ? ' disabled' : '') +
        '>' +
        (busy ? 'Sending…' : 'Send Answer') +
        '</button>' +
        '<span class="grader-reflect-only">' +
        esc('Only ' + first + ' sees your answer.') +
        '</span></div>';
    }
    if (r.plan || r.went_well) {
      var saved = _reflectSaved(cid, st.id, a, r);
      html +=
        '<div class="grader-reflect-actions"><button type="button" class="btn btn-secondary btn-sm grader-reflect-obs" data-grader="reflect-observe" data-id="' +
        esc(r.id) +
        '"' +
        (saved ? ' disabled' : '') +
        '>' +
        (saved ? 'Saved as Observation' : 'Save as Observation') +
        '</button></div>';
    }
    var msg =
      pageState._grader.reflectMsg && pageState._grader.reflectMsg.id === r.id ? pageState._grader.reflectMsg.text : '';
    html += '<p class="grader-reflect-msg" role="status">' + esc(msg) + '</p>';
    return html + '</section>';
  }

  /* The row sits above the scoring, in both layouts, and is made only when
     there is a reflection. Redrawn only when it changes; an answer being
     written goes back in its box. */
  function _refreshGraderReflection(dialog, cid, a, st) {
    var html = _graderReflectionHtml(cid, a, st);
    var box = dialog.querySelector('.grader-reflect-host');
    if (!html) {
      if (box) box.remove();
      pageState._grader.reflectHtml = null;
      return;
    }
    if (!box) {
      var anchor = dialog.querySelector('.grader-separate-line');
      if (!anchor) return;
      box = document.createElement('div');
      box.className = 'grader-reflect-host';
      anchor.insertAdjacentElement('beforebegin', box);
      pageState._grader.reflectHtml = null;
    }
    if (pageState._grader.reflectHtml === html) return;
    pageState._grader.reflectHtml = html;
    var had = document.activeElement && box.contains(document.activeElement) ? document.activeElement : null;
    var typing = !!had && had.classList.contains('grader-reflect-input');
    // html-safe: built by _graderReflectionHtml
    box.innerHTML = html;
    var input = box.querySelector('.grader-reflect-input');
    if (input) {
      input.value = pageState._grader.reflectDrafts[input.dataset.id] || '';
      if (typing) input.focus({ preventScroll: true });
    }
  }

  function _graderReflectAction(what, btn) {
    if (!pageState._grader) return;
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    var sid = pageState.focusStudentId;
    if (!a || !sid) return;
    var r = _graderReflection(cid, a, sid);
    if (!r || r.id !== btn.dataset.id) return;
    if (what === 'reflect-send') return _graderSendAnswer(cid, a, sid, r);
    if (what === 'reflect-observe') return _graderSaveReflection(cid, a, sid, r);
  }

  function _reflectAnswerLine(res) {
    if (res.result === 'already_answered') return 'This was answered already. The answer is shown.';
    if (res.result === 'not_found') return 'This reflection is no longer here.';
    if (res.result === 'not_available') return 'Answers can’t be sent from this class.';
    if (res.result === 'failed') return 'The answer couldn’t be sent. Try again.';
    return 'Write an answer first.';
  }

  /* Send Answer: the answer goes to this student alone. The data layer's
     answer is drawn only while the dialog still shows this piece and
     student; the box keeps what was typed when it was not sent. */
  function _graderSendAnswer(cid, a, sid, r) {
    var g = pageState._grader;
    if (g.reflectBusy) return;
    var input = g.overlay.querySelector('.grader-reflect-input');
    var text = input ? input.value : g.reflectDrafts[r.id] || '';
    g.reflectDrafts[r.id] = text;
    g.reflectMsg = null;
    if (!text.trim()) {
      g.reflectMsg = { id: r.id, text: 'Write an answer first.' };
      render();
      var box = g.overlay.querySelector('.grader-reflect-input');
      if (box) box.focus({ preventScroll: true });
      return;
    }
    g.reflectBusy = r.id;
    render();
    var key =
      window.crypto && crypto.randomUUID
        ? crypto.randomUUID()
        : 'ra-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    answerReflection(cid, r.id, text.slice(0, 2000), key).then(function (res) {
      g.reflectBusy = null;
      if (res && res.result === 'answered') delete g.reflectDrafts[r.id];
      if (
        pageState._grader !== g ||
        pageState.activeCourse !== cid ||
        g.aid !== a.id ||
        pageState.focusStudentId !== sid
      )
        return;
      g.reflectMsg = res && res.result === 'answered' ? null : { id: r.id, text: _reflectAnswerLine(res || {}) };
      render();
    });
  }

  /* Save as Observation: the student's plan and what went well, quoted,
     as a Note on them linked to the piece. Once only. Its context marks it
     as from a reflection (REFLECTION_OBS_CONTEXT, shared/constants.js), so
     no report or comment ever offers or prints it (Colin's ruling 110). */
  function _graderSaveReflection(cid, a, sid, r) {
    var text = _reflectObservationText(a, r);
    if (!text || _reflectSaved(cid, sid, a, r)) return;
    var ok = addQuickOb(cid, sid, text, [], 'note', REFLECTION_OBS_CONTEXT, {
      assessmentId: a.id,
      assessmentTitle: a.title || '',
    });
    pageState._grader.reflectMsg =
      ok === false ? { id: r.id, text: 'The observation couldn’t be kept on this computer. Try again.' } : null;
    render();
    var b = pageState._grader && pageState._grader.overlay.querySelector('[data-grader="reflect-observe"]');
    if (b) b.focus({ preventScroll: true });
  }

  /* ── Note for the Report ──────────────────────────────────
     One line about what the student did, for the comment's best-piece
     sentence (score.report_note). Not on DIBELS or Complete/Incomplete
     work, which is never a best piece. It is saved with the student's
     score, so it waits for one. */
  var _REPORT_NOTE_TITLE = 'What the student did well here. Their report comment uses it if this is their best piece.';
  var _REPORT_NOTE_LOCKED_TITLE = 'Score this work first. The note is saved with the score.';

  function _refreshReportNote(dialog, cid, a, sid) {
    var card = dialog.querySelector('.grader-report-note');
    if (!card) return;
    var never = isDibelsScored(a) || isCompletionScored(a);
    card.hidden = never;
    if (never) return;
    var input = card.querySelector('.grader-report-note-input');
    // The saved note goes in only when the student or work changes: this
    // runs after every click and key, typing in the box too.
    if (input.dataset.sid !== sid || input.dataset.aid !== a.id) {
      input.dataset.sid = sid;
      input.dataset.aid = a.id;
      input.value = getScoreReportNote(cid, sid, a.id);
      // Open where a note is written; closed for the next student otherwise.
      card.open = !!String(input.value || '').trim();
    }
    var scored = (getScores(cid)[sid] || []).some(function (e) {
      return e && e.assessmentId === a.id;
    });
    input.disabled = !scored;
    input.title = scored ? _REPORT_NOTE_TITLE : _REPORT_NOTE_LOCKED_TITLE;
    _reportNotePreview(input);
  }

  /* The best-piece sentence this note makes, as the comment would read it
     (teacher/comment-bank.js), the title's quotes turned single inside the
     preview's own. A note that does not start with a past-tense verb
     (CommentLint.startsPastTense) is saved but not used: the sentence
     shows its no-note form and an orange line, shown only then, says why. */
  var _REPORT_NOTE_HINT =
    'Your note isn\u2019t used yet: start it with what the student did, like \u201Cused \u2026\u201D or \u201Cexplained \u2026\u201D.';
  function _reportNotePreview(input) {
    var cid = pageState.activeCourse;
    var preview = input.parentNode.querySelector('.grader-report-note-preview');
    var st = getStudents(cid).find(function (x) {
      return x.id === input.dataset.sid;
    });
    var a = getAssessments(cid).find(function (x) {
      return x.id === input.dataset.aid;
    });
    if (!preview || !st || !a) return;
    // With no note, the skill the piece shows, as the comment would say it
    // (CommentBank.bestPieceSkillOf).
    var skill = '';
    if (!String(input.value || '').trim() && CommentBank.bestPieceSkillOf) {
      // The grader is the teacher's own screen: all work, whatever the questionnaire's set (S2-F2).
      var f = ReportScores.withReportScores('grader', function () {
        return CommentBank.facts(cid, st);
      });
      var w = (f.work || []).find(function (x) {
        return x.id === a.id;
      });
      skill = (w && (CommentBank.bestPieceSkillOf(f, w) || {}).skill) || '';
    }
    var sentence = CommentBank.bestPieceSentence(
      Object.assign({ title: a.title, note: input.value, skill: skill }, CommentBank.studentRef(st)),
    )
      .replace(/\u201C/g, '\u2018')
      .replace(/\u201D/g, '\u2019');
    var typed = String(input.value || '').trim();
    var off = !!typed && !(window.CommentLint && CommentLint.startsPastTense(typed));
    preview.textContent = '';
    preview.appendChild(document.createElement('span')).textContent =
      'The comment will read: \u201C' + sentence + '\u201D ';
    if (off) {
      var hint = preview.appendChild(document.createElement('span'));
      hint.className = 'grader-report-note-hint';
      hint.textContent = _REPORT_NOTE_HINT;
    }
    preview.classList.toggle('warn', off);
  }

  function _saveReportNote(input) {
    var cid = pageState.activeCourse;
    var sid = input.dataset.sid;
    var aid = input.dataset.aid;
    if (!cid || !sid || !aid || input.disabled) return;
    Grader.setReportNote(cid, sid, aid, input.value);
    input.value = getScoreReportNote(cid, sid, aid);
    _reportNotePreview(input);
  }

  // The assessment's grade for the student, in words, and the colour its
  // capsule takes: a level's own colour, Complete green, Incomplete and
  // Missing red, points dark, Excused and ungraded grey.
  function _graderGrade(cid, a, sid) {
    var cell = assessmentCellValue(cid, sid, a);
    if (cell.kind === 'status')
      return cell.status === 'NS' ? { text: 'Missing', tone: 'l1' } : { text: 'Excused', tone: 'muted' };
    if (cell.kind === 'complete')
      return cell.mark === 'complete' ? { text: 'Complete', tone: 'l3' } : { text: 'Incomplete', tone: 'l1' };
    if (cell.kind === 'level') {
      var lv = Math.max(1, Math.min(4, cell.level));
      return { text: PROF_LABELS[lv] + ' (' + cell.text + ')', tone: 'l' + lv };
    }
    if (cell.kind === 'points') return { text: cell.text + ' of ' + (a.maxPoints || 100), tone: 'ink' };
    return { text: 'Not Graded', tone: 'muted' };
  }

  // The assessment a grading control belongs to: the card it sits in, in
  // the dialog or open on the Assignments page for one student.
  function _graderAid(el) {
    var card = el && el.closest ? el.closest('.assess-card') : null;
    if (card && card.id.indexOf('ac-') === 0) return card.id.slice(3);
    return pageState._grader ? pageState._grader.aid : null;
  }
  function _graderRoot(aid) {
    return pageState._grader ? pageState._grader.overlay : document.getElementById('ac-' + aid);
  }
  function _graderCriterion(aid, critId) {
    return aid ? getRubricCriterion(aid, critId) : null;
  }
  /* Picking the chosen level again clears it; another level replaces it
     and drops any + or −. */
  function _graderSetLevel(aid, critId, level) {
    if (!aid || !pageState.focusStudentId) return;
    var crit = _graderCriterion(aid, critId);
    if (!crit) return;
    // On a Six-Point rubric `level` is the score, 1 to 6.
    if (_sixRubricOf(pageState.activeCourse, aid)) {
      if (!RubricScale.isKey(_sixRubricOf(pageState.activeCourse, aid), level)) return;
      var nowSix = _sixScoreNow(pageState.activeCourse, pageState.focusStudentId, aid, crit);
      var nextSix = nowSix === level ? 0 : level;
      if (nextSix && isScoreLocked(pageState.activeCourse, pageState.focusStudentId, aid)) return;
      var beforeSix = nextSix ? null : structuredClone(getScores(pageState.activeCourse));
      _writeSixScore(pageState.activeCourse, pageState.focusStudentId, aid, crit, nextSix);
      refreshSidebarGrades(pageState.focusStudentId);
      render();
      _focusGraderCard(aid, '.grdt-crit[data-critid="' + critId + '"]');
      if (beforeSix) _offerClearUndo(pageState.activeCourse, beforeSix);
      return;
    }
    var state = _criterionState(pageState.activeCourse, pageState.focusStudentId, aid, crit);
    var next = state.level === level && !state.mixed ? 0 : level;
    var before = next ? null : structuredClone(getScores(pageState.activeCourse));
    rubricCriterionScoreKeys(crit).forEach(function (tid) {
      Grader.setLevel(pageState.activeCourse, pageState.focusStudentId, aid, tid, next, 0);
    });
    refreshSidebarGrades(pageState.focusStudentId);
    render();
    _focusGraderCard(aid, '.grdt-crit[data-critid="' + critId + '"]');
    if (before) _offerClearUndo(pageState.activeCourse, before);
  }
  function _graderSetMod(aid, critId, mod) {
    if (!aid || !pageState.focusStudentId) return;
    if (_sixRubricOf(pageState.activeCourse, aid)) return;
    var crit = _graderCriterion(aid, critId);
    if (!crit) return;
    var state = _criterionState(pageState.activeCourse, pageState.focusStudentId, aid, crit);
    if (!state.level) return;
    var next = state.mod === mod ? 0 : mod;
    if (normalizeScoreMod(state.level, next) !== next) return;
    rubricCriterionScoreKeys(crit).forEach(function (tid) {
      Grader.setPlusMinus(pageState.activeCourse, pageState.focusStudentId, aid, tid, state.level, next);
    });
    refreshSidebarGrades(pageState.focusStudentId);
    render();
    _focusGraderCard(aid, '.grdt-crit[data-critid="' + critId + '"]');
  }
  /* A rubric row's Checklist or Comment chip opens or closes what folds
     under it; the checklist keeps the Assignments page's Show | Hide rule. */
  function _graderToggleRow(aid, critId, what) {
    if (!aid || !pageState.focusStudentId) return;
    var key = _checklistKey(aid, pageState.focusStudentId, critId);
    var opened;
    if (what === 'checks') {
      var open = _isChecklistOpen(aid, pageState.focusStudentId, critId);
      var set = _checklistMode() === 'show' ? _closedChecklists : _openChecklists;
      if (open === (set === _closedChecklists)) set.add(key);
      else set.delete(key);
      opened = !open;
    } else {
      opened = !_graderNotesOpen.has(key);
      if (opened) _graderNotesOpen.add(key);
      else _graderNotesOpen.delete(key);
    }
    render();
    var root = _graderRoot(aid);
    var card = root && root.querySelector('.grdt-crit[data-critid="' + critId + '"]');
    if (!card) return;
    var to =
      what === 'note' && opened
        ? card.querySelector('textarea.grdt-note')
        : card.querySelector(what === 'checks' ? '[data-action="graderChecks"]' : '[data-action="graderNote"]');
    if (to) to.focus({ preventScroll: true });
  }
  /* A tick saves the box and, like the Assignments checklist, moves the
     level to the one the boxes suggest unless the teacher picked another. */
  function _graderTick(aid, critId, checkId, on) {
    if (!aid || !pageState.focusStudentId) return;
    var cid = pageState.activeCourse;
    var crit = _graderCriterion(aid, critId);
    if (!crit) return;
    // Missing and Excused work takes no score (isScoreLocked): redraw the box as saved.
    if (on && isScoreLocked(cid, pageState.focusStudentId, aid)) {
      render();
      return;
    }
    var before = getRubricCheckIds(cid, pageState.focusStudentId, aid);
    var after = Grader.setTick(cid, pageState.focusStudentId, aid, checkId, on);
    if (_sixRubricOf(cid, aid)) {
      var nowSix = _sixScoreNow(cid, pageState.focusStudentId, aid, crit);
      var nextSix = RubricChecks.levelAfterTick(crit, nowSix, before, after);
      if (nextSix !== nowSix) _writeSixScore(cid, pageState.focusStudentId, aid, crit, nextSix);
    } else {
      var current = _criterionLevelNow(cid, aid, pageState.focusStudentId, crit);
      var next = RubricChecks.levelAfterTick(crit, current, before, after);
      if (next !== current)
        rubricCriterionScoreKeys(crit).forEach(function (tid) {
          Grader.setLevel(cid, pageState.focusStudentId, aid, tid, next);
        });
    }
    refreshSidebarGrades(pageState.focusStudentId);
    render();
    var root = _graderRoot(aid);
    var box = root && root.querySelector('.grdt-check input[data-checkid="' + checkId + '"]');
    if (box) box.focus({ preventScroll: true });
  }
  function _graderSetTagLevel(aid, tagId, level) {
    if (!aid || !pageState.focusStudentId) return;
    var state = _tagState(pageState.activeCourse, pageState.focusStudentId, aid, tagId);
    var next = state.level === level && !state.mixed ? 0 : level;
    var before = next ? null : structuredClone(getScores(pageState.activeCourse));
    _tagScoreKeys(pageState.activeCourse, aid, tagId).forEach(function (key) {
      Grader.setLevel(pageState.activeCourse, pageState.focusStudentId, aid, key, next, 0);
    });
    refreshSidebarGrades(pageState.focusStudentId);
    render();
    _focusGraderCard(aid, '.grdl-card[data-tag="' + tagId + '"]');
    if (before) _offerClearUndo(pageState.activeCourse, before);
  }
  function _graderSetTagMod(aid, tagId, mod) {
    if (!aid || !pageState.focusStudentId) return;
    var state = _tagState(pageState.activeCourse, pageState.focusStudentId, aid, tagId);
    if (!state.level || state.mixed) return;
    var next = state.mod === mod ? 0 : mod;
    if (normalizeScoreMod(state.level, next) !== next) return;
    _tagScoreKeys(pageState.activeCourse, aid, tagId).forEach(function (key) {
      Grader.setPlusMinus(pageState.activeCourse, pageState.focusStudentId, aid, key, state.level, next);
    });
    refreshSidebarGrades(pageState.focusStudentId);
    render();
    _focusGraderCard(aid, '.grdl-card[data-tag="' + tagId + '"]');
  }
  // Saves typed points the way the Assignments ledger does: blank clears, a
  // typed 0 is a score, a typo puts the saved score back, leaving an
  // unchanged box saves nothing. `sid` is the box's student (AssignInputs' _boxStudent), not the page's by now.
  function _graderCommitPoints(inp, next, sid) {
    var aid = _graderAid(inp);
    if (!aid || !sid) return;
    var cid = pageState.activeCourse;
    var max = parseFloat(inp.dataset.max) || 100;
    var prev = getPointsScore(cid, sid, aid);
    var over = _pointsOverLimit(inp.value, max);
    var raw = parsePointsInput(inp.value, max, prev);
    if (raw === prev) {
      inp.value = raw != null ? formatPoints(raw) : '';
      return;
    }
    // One save, through Grader.setPoints, as the ledger, gradebook and phone
    // do. A second write under the assessment's own id left an entry later
    // edits elsewhere never updated, so the cell and course % kept the old
    // points.
    Grader.setPoints(cid, sid, aid, raw);
    refreshSidebarGrades(sid);
    var nextId = next && pageState._grader && pageState._grader.overlay.contains(next) ? next.id : '';
    render();
    if (over != null) _sayPointsCapped(cid, sid, aid, over, raw, max, prev);
    // The redraw replaced the control Tab (or a click) was moving to, such
    // as Overall Comment, so focus would fall to the page: give it to the
    // new one.
    if (nextId) {
      var refocus = function () {
        var active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        var again = document.getElementById(nextId);
        if (again && pageState._grader && pageState._grader.overlay.contains(again))
          again.focus({ preventScroll: true });
      };
      refocus();
      setTimeout(refocus, 0);
    }
  }
  // A redraw keeps keyboard scoring on the same card.
  function _focusGraderCard(aid, selector) {
    var root = _graderRoot(aid);
    var card = root && root.querySelector(selector);
    var active = document.activeElement;
    var lost = !active || active === document.body || active.classList.contains('grader-dialog');
    if (card && lost) card.focus({ preventScroll: true });
  }

  // Most grading controls save without redrawing, so the status, comments
  // and grade are brought up to date after each one.
  function _graderAfterEvent() {
    setTimeout(_refreshGraderChrome, 0);
  }

  function closeGrader() {
    if (!pageState._grader) return;
    // A field being typed in saves on blur, so finish it before closing.
    var active = /** @type {any} */ (document.activeElement);
    if (active && pageState._grader.overlay.contains(active) && active.blur) active.blur();
    var g = pageState._grader;
    _graderReleasePage(g);
    pageState._grader = null;
    // Mark Up opened from this dialog goes with it.
    if (window.MarkUp && MarkUp.isOpen()) MarkUp.close();
    _hideChipTip();
    pageState._listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    pageState._listeners = [];
    if (g.pageListeners) {
      g.pageListeners.forEach(function (l) {
        _addDocListener(l.type, l.handler, l.options);
      });
    }
    Object.keys(pageState._statusDebounce).forEach(function (k) {
      delete pageState._statusDebounce[k];
    });
    ['rubric-modal', 'comment-popover-overlay'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
    if (pageState._commentCapture) pageState._commentCapture.destroy();
    pageState._commentCapture = null;
    CritComment.drop();
    pageState._kbFocusEl = null;
    // The student it ended on, so the gradebook selects their cell.
    var lastSid = pageState.focusStudentId;
    pageState.focusStudentId = null;
    // The page under the dialog is as it was, and has not seen what was graded.
    if (g.page) {
      pageState.openAssessIds = g.page.open;
      pageState.focusStudentId = g.page.focus;
      pageState._allExpanded = g.page.expanded;
      pageState._collapsedIds = g.page.collapsed;
      pageState.rubricViewStates = g.page.rubricViews;
      pageState._pageBehind = true;
    }
    g.overlay.remove();
    if (g.onClose) g.onClose(lastSid);
  }

  return {
    configure: configure,
    _graderAfterEvent: _graderAfterEvent,
    _graderAid: _graderAid,
    _graderCommitPoints: _graderCommitPoints,
    _graderCriterion: _graderCriterion,
    _graderGrade: _graderGrade,
    _graderReflectAction: _graderReflectAction,
    _graderRoot: _graderRoot,
    _graderSetLevel: _graderSetLevel,
    _graderSetMod: _graderSetMod,
    _graderSetTagLevel: _graderSetTagLevel,
    _graderSetTagMod: _graderSetTagMod,
    _graderTick: _graderTick,
    _graderToggleRow: _graderToggleRow,
    _refreshGraderReflection: _refreshGraderReflection,
    _refreshReportNote: _refreshReportNote,
    _reportNotePreview: _reportNotePreview,
    _saveReportNote: _saveReportNote,
    closeGrader: closeGrader,
  };
})();
