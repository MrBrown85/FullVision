// @ts-check
/* ── crit-comment.js — the criterion comment, typed in place ─────────
   The Assignments page's rubric grid: the comment under one criterion for
   one student or group, and on pair and group work a line for one member
   alone. Moved out of page-assignments.js (Nov 24 2026). The page draws the
   button and the saved comment through buttonHtml and noteHtml, and passes
   its clicks, keys, input and redraws here. */
/** @type {any} */ (window).CritComment = (function () {
  'use strict';

  // What the page lends: the class on screen, a group's row, a criterion
  // by id, and its scroll helper (configure, at the page's init).
  /** @type {any} */
  var _deps = {
    course: function () {
      return null;
    },
    groupRow: function () {
      return null;
    },
    criterion: function () {
      return null;
    },
    scrollIntoView: function (el, opts) {
      if (el && el.scrollIntoView) el.scrollIntoView(opts);
    },
    // The level picked for this student on this criterion (0 for none).
    level: function () {
      return 0;
    },
  };
  function configure(deps) {
    Object.keys(deps || {}).forEach(function (k) {
      _deps[k] = deps[k];
    });
    if (_CB()) _CB().configure(deps);
  }
  // The Comment Bank (teacher/crit-bank.js), loaded before this file.
  /** @returns {any} */
  function _CB() {
    return /** @type {any} */ (window).CritBank;
  }
  /** @type {any} */
  var _critCommentState = null; // { cid, sid, aid, critId, draft, reuse, own } while a field is open

  /* ── Criterion comment ──────────────────────────────────── */
  // One short note per rubric criterion, printed under its row on the rubric
  // handout. Its labelled button sits under the criterion's name, beside the
  // checklist button, solid once the criterion has a comment; the comment's
  // text shows under the levels.
  function criterionCommentButtonHtml(aid, sid, crit) {
    var note = getRubricCriterionComment(_deps.course(), sid, aid, crit);
    var has = !!note || _critOwnLines(_deps.course(), aid, sid, crit).length > 0;
    return (
      '<button type="button" class="rsg-crit-comment' +
      (has ? ' has-comment' : '') +
      '" tabindex="-1" data-action="openCriterionComment" data-aid="' +
      aid +
      '" data-sid="' +
      sid +
      '" data-critid="' +
      crit.id +
      '" data-stop-prop="true" aria-label="Comment on this criterion" aria-keyshortcuts="C" title="' +
      (note ? esc(note) : 'Comment on this criterion (C)') +
      '"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>Comment</button>'
    );
  }
  /* The comment is typed in place, under the criterion's levels (Nov 24
     2026; it was a box over the page). Comment, C on a focused row, or a
     click on the saved comment opens the field. It saves as the teacher
     types and when they leave it. Tab or Enter goes on to the next
     criterion's comment, then the overall comment, then the next student or
     group; Shift+Tab goes back; Shift+Enter is a new line; Escape or a click
     elsewhere puts it away. On pair and group work the row is the group's,
     so the field is named for the group and the comment fills every member.
     While it's empty, comments already written on the same criterion for
     other students or groups are offered under it (Same As).
     On a group's row, Line for One Student adds a line under the group's
     comment for one member alone (rubric_score.own_comment, Grader.
     setCriterionOwn): it prints on their sheet and shows on their page, and
     the group's grade is never copied over it. Saved, each shows under the
     comment as "Hannah Only: ...". */
  // About two printed lines of a criterion comment on a quarter-sheet
  // handout. Sheets clip anything taller, so the count turns amber past it.
  var CRIT_COMMENT_QUARTER_FIT = 140;
  var CRIT_COMMENT_MAX = 500;
  /** @type {any} */
  var _critCommentTimer = null;
  // An overall comment reached by Tab from a criterion comment: its own Tab
  // goes on to the next student's or group's first criterion comment.
  /** @type {any} */
  var _critCommentFlowEl = null;

  function _critCommentOpenFor(aid, sid, critId) {
    var st = _critCommentState;
    return !!st && st.aid === aid && st.sid === sid && st.critId === critId;
  }
  /** @returns {any} */
  function _critRowEl(aid, sid, critId) {
    return document.querySelector(
      '.rsg-criterion-row[data-assess="' + aid + '"][data-student="' + sid + '"][data-criterion="' + critId + '"]',
    );
  }
  /** @returns {any} */
  function _critCommentButton(aid, sid, critId) {
    var row = _critRowEl(aid, sid, critId);
    return row && row.querySelector('.rsg-crit-comment');
  }
  // Who the row is: a pair or group's name, or the student's first name.
  function _critCommentWho(cid, aid, sid) {
    var row = _deps.groupRow(aid, sid);
    if (row && row.view) return row.view.label;
    var st = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    return st ? displayNameFirst(st) : '';
  }
  // Comments on the same criterion for other students or groups, nearest
  // first (those above this row, then below), three at most, no repeats.
  function _critCommentReuse(cid, aid, sid, crit) {
    var a = _assessmentById(cid, aid);
    var ids = sortStudents(getStudents(cid), 'lastName').map(function (s) {
      return s.id;
    });
    var at = ids.indexOf(sid);
    var order = ids
      .slice(0, Math.max(at, 0))
      .reverse()
      .concat(ids.slice(at + 1));
    var seen = {};
    var out = [];
    order.forEach(function (id) {
      if (out.length >= 3) return;
      // A group member's comment is their group's, offered once under its name.
      var row = _deps.groupRow(aid, id);
      if (!(row && row.view) && a && isLinkedGroupMember(cid, aid, id)) return;
      var text = getRubricCriterionComment(cid, id, aid, crit);
      if (!text || seen[text]) return;
      seen[text] = true;
      out.push({ who: _critCommentWho(cid, aid, id), text: text });
    });
    return out;
  }
  function _studentOf(cid, sid) {
    return (
      getStudents(cid).find(function (s) {
        return s.id === sid;
      }) || null
    );
  }
  // Who may have a line of their own on this row: on a group's row, the
  // members who take its grade (not graded separately, not Missing or
  // Excused); on a student's own row, that student once they have one.
  function _critOwnMembers(cid, aid, sid) {
    var row = _deps.groupRow(aid, sid);
    if (!row || !row.view) return [sid];
    var a = _assessmentById(cid, aid);
    return (row.view.members || []).filter(function (m) {
      return !isGradedSeparately(a, m) && !isGroupWithheld(cid, m, aid);
    });
  }
  function _critOwnLines(cid, aid, sid, crit) {
    return _critOwnMembers(cid, aid, sid)
      .map(function (m) {
        return { sid: m, text: getRubricCriterionOwn(cid, m, aid, crit) };
      })
      .filter(function (o) {
        return !!o.text;
      });
  }
  // html-safe: names and lines through esc; ids are ours
  function _critOwnNotesHtml(cid, aid, sid, crit) {
    return _critOwnLines(cid, aid, sid, crit)
      .map(function (o) {
        var who = _studentOf(cid, o.sid);
        return (
          '<div class="rsg-crit-own-note" data-own="' +
          o.sid +
          '"><b>' +
          esc((who ? displayNameFirst(who) : '') + ' Only:') +
          '</b> ' +
          esc(o.text) +
          '</div>'
        );
      })
      .join('');
  }
  // html-safe: names and lines through esc; ids are ours; limits are numbers
  function _critOwnFieldsHtml(cid, aid, sid, crit) {
    var st = _critCommentState;
    var group = _deps.groupRow(aid, sid);
    var members = _critOwnMembers(cid, aid, sid);
    var html = '';
    members.forEach(function (m) {
      if (st.own[m] == null) return;
      var who = _studentOf(cid, m);
      var name = who ? displayNameWithLast(who) : '';
      var first = who ? displayNameFirst(who) : '';
      html +=
        '<div class="rsg-crit-own"><label class="rsg-crit-own-label" for="crit-own-' +
        m +
        '">' +
        esc(name + ' Only') +
        '</label><div class="rsg-crit-edit-box"><textarea class="rsg-crit-input rsg-crit-own-input" id="crit-own-' +
        m +
        '" rows="1" maxlength="' +
        CRIT_COMMENT_MAX +
        '" placeholder="' +
        esc('Only on ' + first + '\u2019s sheet and page') +
        '" data-own="' +
        m +
        '" data-action-input="critOwnInput" data-action-blur="critCommentBlur">' +
        esc(st.own[m]) +
        '</textarea></div></div>';
    });
    var left =
      group && group.view
        ? members.filter(function (m) {
            return st.own[m] == null;
          })
        : [];
    if (left.length)
      html +=
        '<div class="rsg-crit-each"><span class="rsg-crit-each-label">Line for One Student:</span>' +
        left
          .map(function (m) {
            var who = _studentOf(cid, m);
            return (
              '<button type="button" class="rsg-crit-each-btn" data-action="critOwnAdd" data-own="' +
              m +
              '" title="' +
              esc('A line for ' + (who ? displayNameWithLast(who) : '') + ' alone') +
              '">' +
              esc(who ? displayNameFirst(who) : '') +
              '</button>'
            );
          })
          .join('') +
        '</div>';
    return html;
  }
  /* The Comment Bank (teacher/crit-bank.js), behind the commentBank switch:
     Last Time above the box, the Bank row under Same As. */
  function _bankOn() {
    return !!_CB() && _CB().enabled();
  }
  function _bankCtx(cid, aid, sid, crit) {
    var group = _deps.groupRow(aid, sid);
    var isGroup = !!(group && group.view);
    var who = isGroup ? null : _studentOf(cid, sid);
    return {
      kind: 'crit',
      cid: cid,
      aid: aid,
      sid: sid,
      critId: crit.id,
      first: who ? displayNameFirst(who) : '',
      group: isGroup,
    };
  }
  // A comment picked from the Bank is written as a Same As pick is: at once.
  function _critBankSet(text) {
    /** @type {any} */
    var inp = document.getElementById('crit-comment-input');
    if (!inp) return;
    inp.value = text;
    _critCommentInput(inp);
    _saveCriterionCommentDraft();
    _focusCritCommentInput();
  }
  function _bankWire() {
    var st = _critCommentState;
    var inp = document.getElementById('crit-comment-input');
    var edit = st && inp && inp.closest('.rsg-crit-edit');
    var crit = st && _deps.criterion(st.aid, st.critId);
    if (!edit || !crit || !_bankOn()) return;
    _CB().wire(edit, _bankCtx(st.cid, st.aid, st.sid, crit), {
      set: _critBankSet,
      save: _saveCriterionCommentDraft,
      focus: _focusCritCommentInput,
    });
  }
  // html-safe: criterion, student and group names and comments through esc; ids are ours; limits are numbers
  function _critCommentEditorHtml(cid, aid, sid, crit) {
    var st = _critCommentState;
    var text = st.draft != null ? st.draft : getRubricCriterionComment(cid, sid, aid, crit);
    var who = _critCommentWho(cid, aid, sid);
    var label = 'Comment on ' + (crit.name || 'this criterion') + (who ? ' for ' + who : '');
    var len = text.trim().length;
    st.reuse = _critCommentReuse(cid, aid, sid, crit);
    var bank = _bankOn();
    var ctx = bank ? _bankCtx(cid, aid, sid, crit) : null;
    return (
      '<div class="rsg-crit-edit' +
      (bank ? ' has-bank' : '') +
      '" data-stop-prop="true">' +
      (bank ? _CB().lastHtml(ctx) : '') +
      '<div class="rsg-crit-edit-box"><textarea class="rsg-crit-input" id="crit-comment-input" rows="1" maxlength="' +
      CRIT_COMMENT_MAX +
      '" placeholder="' +
      esc(label) +
      '" aria-label="' +
      esc(label) +
      '" aria-describedby="crit-comment-count" title="Prints under this criterion on the rubric handout. About ' +
      CRIT_COMMENT_QUARTER_FIT +
      ' characters fit in two lines on a quarter sheet." aria-keyshortcuts="Enter" data-action-input="critCommentInput" data-action-blur="critCommentBlur">' +
      esc(text) +
      '</textarea><span class="rsg-crit-count' +
      (len > CRIT_COMMENT_QUARTER_FIT ? ' is-long' : '') +
      '" id="crit-comment-count">' +
      len +
      ' / ' +
      CRIT_COMMENT_MAX +
      '</span></div>' +
      (st.reuse.length
        ? '<div class="rsg-crit-reuse"' +
          (text.trim() ? ' hidden' : '') +
          '><span class="rsg-crit-reuse-label">Same As</span>' +
          st.reuse
            .map(function (r, i) {
              return (
                '<button type="button" class="rsg-crit-reuse-chip" data-action="critCommentReuse" data-i="' +
                i +
                '" title="' +
                esc(r.text) +
                '"><b>' +
                esc(r.who) +
                ':</b> ' +
                esc(r.text) +
                '</button>'
              );
            })
            .join('') +
          '</div>'
        : '') +
      (bank ? _CB().rowHtml(ctx) : '') +
      _critOwnFieldsHtml(cid, aid, sid, crit) +
      '</div>'
    );
  }
  // What sits under a criterion's levels: the open field, or the saved
  // comment and lines for one student (the same HTML as before the field,
  // when it isn't open and there are none).
  function _critNoteHtml(cid, aid, sid, crit, note) {
    if (_critCommentOpenFor(aid, sid, crit.id)) return _critCommentEditorHtml(cid, aid, sid, crit);
    return (note ? '<div class="rsg-crit-note">' + esc(note) + '</div>' : '') + _critOwnNotesHtml(cid, aid, sid, crit);
  }
  function _growCritCommentInput(inp) {
    inp.style.height = 'auto';
    if (inp.scrollHeight) inp.style.height = Math.min(inp.scrollHeight + 2, 220) + 'px';
  }
  function _syncCritCommentChip(st) {
    var btn = _critCommentButton(st.aid, st.sid, st.critId);
    if (!btn) return;
    var crit = _deps.criterion(st.aid, st.critId);
    var note = crit ? getRubricCriterionComment(st.cid, st.sid, st.aid, crit) : '';
    var own = crit ? _critOwnLines(st.cid, st.aid, st.sid, crit).length > 0 : false;
    btn.classList.toggle('has-comment', !!note || own);
    btn.classList.toggle('is-open', _critCommentState === st);
    btn.setAttribute('aria-expanded', String(_critCommentState === st));
    btn.title = note || 'Comment on this criterion (C)';
  }
  function _focusCritCommentInput(who) {
    var inp = (who && document.getElementById('crit-own-' + who)) || document.getElementById('crit-comment-input');
    if (!inp) return;
    _growCritCommentInput(inp);
    inp.focus({ preventScroll: true });
    if (inp.setSelectionRange) inp.setSelectionRange(inp.value.length, inp.value.length);
    _deps.scrollIntoView(inp.closest('.rsg-crit-edit') || inp, { block: 'nearest' });
  }
  function openCriterionComment(aid, sid, critId, who) {
    var cid = _deps.course();
    if (_critCommentOpenFor(aid, sid, critId)) {
      closeCriterionComment();
      return;
    }
    if (_critCommentState) closeCriterionComment();
    var crit = _deps.criterion(aid, critId);
    var student = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    var row = _critRowEl(aid, sid, critId);
    var main = row && row.querySelector('.rsg-criterion-main');
    if (!crit || !student || !main) return;
    _critCommentFlowEl = null;
    // own: each line for one student shown in the field, as typed.
    var st = { cid: cid, sid: sid, aid: aid, critId: critId, draft: null, own: {} };
    _critOwnLines(cid, aid, sid, crit).forEach(function (o) {
      st.own[o.sid] = o.text;
    });
    _critCommentState = st;
    var html = _critCommentEditorHtml(cid, aid, sid, crit);
    // The field takes the saved comment's place: after the levels (and the
    // level words), before an open checklist.
    main.querySelectorAll('.rsg-crit-own-note').forEach(function (el) {
      el.remove();
    });
    var note = main.querySelector('.rsg-crit-note');
    var checklist = null;
    Array.prototype.forEach.call(main.children, function (c) {
      if (!checklist && c.classList.contains('rsg-checklist')) checklist = c;
    });
    /** @type {any[]} */
    var at = note ? [note, 'afterend'] : checklist ? [checklist, 'beforebegin'] : [main, 'beforeend'];
    // html-safe: built by _critCommentEditorHtml
    at[0].insertAdjacentHTML(at[1], html);
    if (note) note.remove();
    _syncCritCommentChip(st);
    _bankWire();
    _focusCritCommentInput(who);
  }
  // Line for One Student: a member's own field opens under the group's.
  function _critOwnAdd(who) {
    var st = _critCommentState;
    var row = st && _critRowEl(st.aid, st.sid, st.critId);
    var edit = row && row.querySelector('.rsg-crit-edit');
    var crit = st && _deps.criterion(st.aid, st.critId);
    if (!edit || !crit) return;
    if (st.own[who] == null) st.own[who] = '';
    var box = document.createElement('div');
    // html-safe: built by _critOwnFieldsHtml
    box.innerHTML = _critOwnFieldsHtml(st.cid, st.aid, st.sid, crit);
    edit.querySelectorAll('.rsg-crit-own, .rsg-crit-each').forEach(function (el) {
      el.remove();
    });
    while (box.firstChild) edit.appendChild(box.firstChild);
    _focusCritCommentInput(who);
  }
  function _critOwnInput(inp) {
    var st = _critCommentState;
    if (!st) return;
    st.own[inp.dataset.own] = inp.value;
    _growCritCommentInput(inp);
    clearTimeout(_critCommentTimer);
    _critCommentTimer = setTimeout(_saveCriterionCommentDraft, 800);
  }
  function _critCommentInput(inp) {
    var st = _critCommentState;
    if (!st) return;
    st.draft = inp.value;
    _growCritCommentInput(inp);
    var len = inp.value.trim().length;
    var count = document.getElementById('crit-comment-count');
    if (count) {
      count.textContent = len + ' / ' + CRIT_COMMENT_MAX;
      count.classList.toggle('is-long', len > CRIT_COMMENT_QUARTER_FIT);
    }
    var reuse = inp.closest('.rsg-crit-edit').querySelector('.rsg-crit-reuse');
    if (reuse) reuse.hidden = !!len;
    if (_CB()) _CB().typed();
    clearTimeout(_critCommentTimer);
    _critCommentTimer = setTimeout(_saveCriterionCommentDraft, 800);
  }
  // Writes what has been typed, if it differs from the saved comment.
  function _saveCriterionCommentDraft() {
    clearTimeout(_critCommentTimer);
    _critCommentTimer = null;
    var st = _critCommentState;
    var crit = st && _deps.criterion(st.aid, st.critId);
    if (!crit) return;
    var changed = false;
    if (st.draft != null) {
      var text = st.draft.trim();
      if (text !== getRubricCriterionComment(st.cid, st.sid, st.aid, crit)) {
        /** @type {any} */ (window).Grader.setCriterionComment(st.cid, st.sid, st.aid, st.critId, text);
        changed = true;
      }
    }
    // Each line for one student is theirs alone, after the group's comment
    // (which is copied to every member, their own lines kept).
    Object.keys(st.own || {}).forEach(function (m) {
      var line = String(st.own[m] || '').trim();
      if (line === getRubricCriterionOwn(st.cid, m, st.aid, crit)) return;
      /** @type {any} */ (window).Grader.setCriterionOwn(st.cid, m, st.aid, st.critId, line);
      changed = true;
    });
    if (changed) _syncCritCommentChip(st);
  }
  // Puts the field away, saved; the comment shows under the levels.
  function closeCriterionComment() {
    var st = _critCommentState;
    if (!st) return;
    _saveCriterionCommentDraft();
    _critCommentState = null;
    if (_CB()) _CB().drop();
    var row = _critRowEl(st.aid, st.sid, st.critId);
    var edit = row && row.querySelector('.rsg-crit-edit');
    var crit = _deps.criterion(st.aid, st.critId);
    if (edit && crit) {
      var note = getRubricCriterionComment(st.cid, st.sid, st.aid, crit);
      // html-safe: built by _critNoteHtml (the field is closed: the saved comment and lines)
      edit.insertAdjacentHTML('beforebegin', _critNoteHtml(st.cid, st.aid, st.sid, crit, note));
      edit.remove();
    } else if (edit) edit.remove();
    _syncCritCommentChip(st);
  }
  // Saves and forgets the open field without touching the page (the page
  // is being left or drawn again from scratch).
  function _dropCriterionComment() {
    _saveCriterionCommentDraft();
    _critCommentState = null;
    if (_CB()) _CB().drop();
    _critCommentFlowEl = null;
  }
  // A redraw draws an open field again with what was typed (the row's
  // HTML holds it); it keeps the keyboard, or is saved and forgotten when
  // its row is no longer drawn.
  function _critCommentAfterDraw() {
    var st = _critCommentState;
    if (!st) return;
    if (!document.getElementById('crit-comment-input')) {
      _dropCriterionComment();
      return;
    }
    _syncCritCommentChip(st);
    _bankWire();
    var active = document.activeElement;
    if (!active || active === document.body) _focusCritCommentInput();
  }
  function _critCommentReuseChoose(i) {
    var st = _critCommentState;
    /** @type {any} */
    var inp = document.getElementById('crit-comment-input');
    var pick = st && st.reuse && st.reuse[i];
    if (!pick || !inp) return;
    inp.value = pick.text;
    _critCommentInput(inp);
    _saveCriterionCommentDraft();
    _focusCritCommentInput();
  }
  // Each criterion's Comment, then the overall comment, student by student
  // (group by group), skipping Missing and Excused work.
  function _critCommentStops(aid) {
    var all = document.querySelectorAll(
      '.rsg-crit-comment[data-aid="' + aid + '"], .rsg-overall-comment[data-aid="' + aid + '"]',
    );
    return Array.prototype.filter.call(all, function (el) {
      if (el.classList.contains('grdr-chip')) return false;
      if (el.closest('.rsg-student.has-status')) return false;
      return !!el.getClientRects().length;
    });
  }
  // Tab, Shift+Tab or Enter from a criterion comment (from), or Tab from an
  // overall comment the comments led to.
  function _critCommentMove(from, aid, dir) {
    var stops = _critCommentStops(aid);
    var next = stops[stops.indexOf(from) + dir];
    if (_critCommentState) closeCriterionComment();
    if (!next) {
      if (from && from.isConnected) from.focus({ preventScroll: true });
      return;
    }
    if (next.classList.contains('rsg-overall-comment')) {
      _critCommentFlowEl = next;
      next.focus({ preventScroll: true });
      _deps.scrollIntoView(next, { block: 'nearest' });
      return;
    }
    openCriterionComment(next.dataset.aid, next.dataset.sid, next.dataset.critid);
  }
  // Keys in the field. True when the key was the field's.
  // Tab walks the open fields (the group's, then each line for one
  // student) before moving on; Enter moves on to the next criterion.
  function _critCommentKey(e) {
    var st = _critCommentState;
    /** @type {any} */
    var active = document.activeElement;
    var edit = st && active && active.closest && active.closest('.rsg-crit-edit');
    if (!edit || !active.classList.contains('rsg-crit-input')) return false;
    if (_CB() && _CB().key(e)) return true;
    if (e.key === 'Tab') {
      var fields = Array.prototype.slice.call(edit.querySelectorAll('.rsg-crit-input'));
      var to = fields[fields.indexOf(active) + (e.shiftKey ? -1 : 1)];
      e.preventDefault();
      if (to) {
        to.focus({ preventScroll: true });
        return true;
      }
      _critCommentMove(_critCommentButton(st.aid, st.sid, st.critId), st.aid, e.shiftKey ? -1 : 1);
      return true;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      _critCommentMove(_critCommentButton(st.aid, st.sid, st.critId), st.aid, 1);
      return true;
    }
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      var btn = _critCommentButton(st.aid, st.sid, st.critId);
      closeCriterionComment();
      if (btn) btn.focus({ preventScroll: true });
      return true;
    }
    return false;
  }
  // A click outside the open field puts it away (its own Comment toggles
  // it). On the click, not the press: the rows under it move up as it
  // closes, and a press would leave the click on another row. Selecting
  // text that ends outside it doesn't count.
  function _critCommentClickOutside(e) {
    var st = _critCommentState;
    if (!st || !e.target || !e.target.closest) return;
    if (e.target.closest('.rsg-crit-edit')) return;
    /** @type {any} */
    var inp = document.activeElement;
    if (inp && inp.classList && inp.classList.contains('rsg-crit-input') && inp.selectionStart !== inp.selectionEnd)
      return;
    if (e.target.closest('.rsg-crit-comment') === _critCommentButton(st.aid, st.sid, st.critId)) return;
    closeCriterionComment();
  }

  // Tab from an overall comment the criterion comments led to.
  function flowKey(e) {
    if (e.key !== 'Tab' || !_critCommentFlowEl || document.activeElement !== _critCommentFlowEl) return false;
    e.preventDefault();
    var from = _critCommentFlowEl;
    _critCommentMove(from, from.dataset.aid, e.shiftKey ? -1 : 1);
    return true;
  }
  function flowBlur(el) {
    if (el === _critCommentFlowEl) _critCommentFlowEl = null;
  }
  function input(el) {
    if (el.dataset.actionInput === 'critOwnInput') _critOwnInput(el);
    else _critCommentInput(el);
  }

  return {
    configure: configure,
    buttonHtml: criterionCommentButtonHtml,
    noteHtml: _critNoteHtml,
    open: openCriterionComment,
    close: closeCriterionComment,
    drop: _dropCriterionComment,
    afterDraw: _critCommentAfterDraw,
    save: _saveCriterionCommentDraft,
    input: input,
    reuse: _critCommentReuseChoose,
    ownAdd: _critOwnAdd,
    key: _critCommentKey,
    flowKey: flowKey,
    flowBlur: flowBlur,
    clickOutside: _critCommentClickOutside,
    isOpen: function () {
      return !!_critCommentState;
    },
  };
})();
