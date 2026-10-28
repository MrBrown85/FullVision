/* report-questionnaire.js — the Term Questionnaire (DECISIONS 14,
   docs/questionnaire-plan.md). One student at a time, the whole picture on
   one screen, and the teacher leaves with the comment: the student strip
   (About Me, the goal, attendance from MyEd), what FullVision has, the
   Comment Bank, and the Teacher Comment pinned on the right. The comment is
   hand-written plain text; the bank only offers wording
   (teacher/comment-bank.js). The class's roster is the app's sidebar, which
   this page marks Needs Approval or ticked. */
window.ReportQuestionnaire = (function () {
  'use strict';

  /* ── Parent state injection ──────────────────────────────── */
  var _activeCourse = null;
  var _renderReports = null;
  var _onLastStudent = null;
  var _commentFit = null;

  function configure(opts) {
    _activeCourse = opts.activeCourse;
    _renderReports = opts.renderReports;
    if (opts.onLastStudent) _onLastStudent = opts.onLastStudent;
    if (opts.commentFit) _commentFit = opts.commentFit;
  }
  function rerender() {
    if (_renderReports) _renderReports();
  }

  var getTermId = ReportBlocks.getTermId;

  var tqStudentIndex = 0;
  var tqNarrativeDirty = false;
  var _notReadyOnly = false;
  var _commentTab = 'this'; // 'this' or an earlier report's term id
  var _saveTimer = null;

  function getTqStudents() {
    return sortStudents(getStudents(_activeCourse), 'lastName');
  }
  function _current() {
    return getTqStudents()[tqStudentIndex] || null;
  }

  /* ── Moving between students ─────────────────────────────── */
  function _goTo(idx) {
    tqSaveCurrentIfNeeded();
    var students = getTqStudents();
    tqStudentIndex = Math.max(0, Math.min(students.length - 1, idx));
    _commentTab = 'this';
    rerender();
  }
  function tqPrevStudent() {
    _goTo(tqStudentIndex - 1);
  }
  function tqNextStudent() {
    var students = getTqStudents();
    if (tqStudentIndex >= students.length - 1) {
      tqSaveCurrentIfNeeded();
      if (_onLastStudent) _onLastStudent();
      return;
    }
    _goTo(tqStudentIndex + 1);
  }
  function tqSelectStudent(sid) {
    var idx = getTqStudents().findIndex(function (s) {
      return s.id === sid;
    });
    if (idx >= 0) _goTo(idx);
  }

  /* ── The comment ─────────────────────────────────────────── */

  /* A comment saved as HTML by the old editor, as plain text: block ends
     and line breaks become new lines, tags go, entities are read. */
  function plainComment(stored) {
    var s = String(stored || '');
    if (!/<[a-z][\s\S]*>/i.test(s)) return s;
    s = s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '')
      .replace(/<[^>]*>/g, '');
    s = s
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, function (m, n) {
        return String.fromCharCode(Number(n));
      })
      .replace(/&#x([0-9a-f]+);/gi, function (m, n) {
        return String.fromCharCode(parseInt(n, 16));
      })
      .replace(/&amp;/g, '&');
    return s
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function _box() {
    return document.getElementById('tq-narrative');
  }

  /* Saves the box's text for the student on screen. An edit after approval
     clears it (upsertTermRating does, as the server does). */
  function tqSaveNarrative() {
    var el = _box();
    var st = _current();
    if (!el || !st) return;
    clearTimeout(_saveTimer);
    var termId = getTermId();
    var before = getStudentTermRating(_activeCourse, st.id, termId) || {};
    var text = el.value.replace(/\s+$/, '');
    if (text === plainComment(before.narrative || '').replace(/\s+$/, '')) {
      tqNarrativeDirty = false;
      return;
    }
    upsertTermRating(_activeCourse, st.id, termId, { narrative: text });
    tqNarrativeDirty = false;
    _syncStatus();
  }
  function tqSaveCurrentIfNeeded() {
    if (tqNarrativeDirty) tqSaveNarrative();
  }

  /* Typing: save shortly after the teacher pauses. */
  function tqNarrativeInput() {
    tqNarrativeDirty = true;
    _syncNote();
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(tqSaveNarrative, 600);
  }

  function tqClear() {
    var el = _box();
    if (!el || !el.value) return;
    if (!document.execCommand || !_tryDelete(el)) el.value = '';
    tqNarrativeDirty = true;
    tqSaveNarrative();
    _syncNote();
  }
  function _tryDelete(el) {
    el.focus();
    el.select();
    try {
      return document.execCommand('delete') && el.value === '';
    } catch (e) {
      return false;
    }
  }

  /* Copy: the comment as plain text, to paste into MyEd. */
  function tqCopyNarrative() {
    var el = _box();
    var text = el ? el.value : '';
    var btn = document.getElementById('tq-copy-btn');
    if (!text.trim() || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(function () {
      if (!btn) return;
      btn.textContent = 'Copied';
      setTimeout(function () {
        btn.textContent = 'Copy';
      }, 1600);
    });
  }

  /* Approve Comment, or take the approval back. Saves the text with it. */
  function tqApprove() {
    var st = _current();
    var el = _box();
    if (!st) return;
    var termId = getTermId();
    var rating = getStudentTermRating(_activeCourse, st.id, termId) || {};
    var data = { approvedAt: rating.approvedAt ? null : new Date().toISOString() };
    if (el && el.value.replace(/\s+$/, '') !== plainComment(rating.narrative || '').replace(/\s+$/, '')) {
      data.narrative = el.value.replace(/\s+$/, '');
    }
    clearTimeout(_saveTimer);
    upsertTermRating(_activeCourse, st.id, termId, data);
    tqNarrativeDirty = false;
    _syncStatus();
  }

  function _approved(sid) {
    var r = getStudentTermRating(_activeCourse, sid, getTermId());
    return !!(r && r.approvedAt);
  }

  /* ── In-place updates (no redraw while the teacher types) ─── */
  function _syncNote() {
    var el = _box();
    var note = document.getElementById('tq-text-note');
    if (el && note)
      note.textContent = el.value.trim() ? 'Edit any word.' : 'Empty. Type, or add from the Comment Bank.';
    if (_commentFit) _commentFit();
  }

  /* The approve button, the card's ring, the Ready count and the roster. */
  function _syncStatus() {
    var st = _current();
    if (!st) return;
    var on = _approved(st.id);
    var btn = document.getElementById('tq-approve');
    if (btn) {
      btn.textContent = on ? '✓ Approved' : 'Approve Comment';
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('on', on);
    }
    var card = document.getElementById('tq-comment-card');
    if (card) card.classList.toggle('waiting', !on);
    syncRoster();
  }

  /* ── The roster (the app's sidebar) ───────────────────────── */

  /* Under each name, Needs Approval until the comment is approved, then a
     tick in place of the grade; All · Not Ready above the list. The grades
     come back on any other tab (restoreRoster). */
  function syncRoster() {
    var cid = _activeCourse;
    var students = getTqStudents();
    var ready = students.filter(function (s) {
      return _approved(s.id);
    }).length;
    var line = document.getElementById('tq-ready');
    if (line) line.textContent = ready + ' of ' + students.length + ' Ready';
    var top = document.getElementById('gb-sidebar-top');
    if (top) {
      var seg = document.getElementById('qn-roster-filter');
      if (!seg) {
        seg = document.createElement('div');
        seg.id = 'qn-roster-filter';
        seg.className = 'seg qn-roster-filter';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'Show students');
        top.appendChild(seg);
      }
      seg.innerHTML =
        '<button type="button" class="seg-btn' +
        (_notReadyOnly ? '' : ' active') +
        '" data-action="tqRosterFilter" data-filter="all" aria-pressed="' +
        !_notReadyOnly +
        '">All ' +
        students.length +
        '</button><button type="button" class="seg-btn' +
        (_notReadyOnly ? ' active' : '') +
        '" data-action="tqRosterFilter" data-filter="not-ready" aria-pressed="' +
        _notReadyOnly +
        '">Not Ready ' +
        (students.length - ready) +
        '</button>';
    }
    var cur = _current();
    document.querySelectorAll('#gb-sidebar .student-row[data-sid]').forEach(function (row) {
      var sid = row.getAttribute('data-sid');
      var ok = _approved(sid);
      var tick = row.querySelector('.qn-tick');
      if (!tick) {
        tick = document.createElement('span');
        tick.className = 'qn-tick';
        row.appendChild(tick);
      }
      tick.textContent = ok ? '\u2713' : '';
      tick.setAttribute('aria-label', ok ? 'Ready' : '');
      var info = row.querySelector('.student-info');
      var needs = info && info.querySelector('.qn-needs');
      if (info && !needs) {
        needs = document.createElement('span');
        needs.className = 'qn-needs';
        info.appendChild(needs);
      }
      if (needs) needs.textContent = ok ? '' : 'Needs Approval';
      row.classList.toggle('qn-ready', ok);
      row.classList.toggle('qn-hidden', _notReadyOnly && ok && !(cur && cur.id === sid));
      row.classList.toggle('selected', !!cur && cur.id === sid);
    });
    if (cid && typeof document !== 'undefined') document.body.classList.add('qn-roster');
  }
  function restoreRoster() {
    var seg = document.getElementById('qn-roster-filter');
    if (seg) seg.remove();
    document.querySelectorAll('#gb-sidebar .qn-needs, #gb-sidebar .qn-tick').forEach(function (n) {
      n.remove();
    });
    document.querySelectorAll('#gb-sidebar .student-row').forEach(function (row) {
      row.classList.remove('qn-ready', 'qn-hidden');
    });
    document.body.classList.remove('qn-roster');
  }
  function tqRosterFilter(which) {
    _notReadyOnly = which === 'not-ready';
    syncRoster();
  }

  /* ── Attendance ──────────────────────────────────────────── */

  /* The report a term id names, as the report picker shows it. */
  function _reportLabel(termId) {
    var sel = document.getElementById('report-period');
    var n = String(termId || '').match(/(\d+)$/);
    var opt = sel && n ? Array.prototype.find.call(sel.options, o => o.value === 'Report ' + n[1]) : null;
    return opt ? opt.text : n ? 'Report ' + n[1] : '';
  }

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /* Under the attendance boxes: the change since the last report with
     totals, or a warning when a total is lower than that report's. */
  function _attendanceNoteHtml(att) {
    var lower = ['absences', 'lates'].find(function (f) {
      var prev = att['prev' + f[0].toUpperCase() + f.slice(1)];
      return att[f] != null && prev != null && att[f] < prev;
    });
    if (lower) {
      var prev = att[lower === 'absences' ? 'prevAbsences' : 'prevLates'];
      var what = lower === 'absences' ? _plural(prev, 'absence', 'absences') : _plural(prev, 'late', 'lates');
      return `<span class="qn-att-warn">Lower than the ${what} entered for the ${esc(
        _reportLabel(att[lower + 'PrevTerm']),
      )} report. Enter the total to date from MyEd.</span>`;
    }
    var prevTerm = att.absencesPrevTerm || att.latesPrevTerm;
    var entered = att.absences != null || att.lates != null;
    if (!prevTerm) {
      return entered ? 'No earlier report has attendance, so these are this term’s totals too.' : '';
    }
    var was = [
      att.prevAbsences != null ? att.prevAbsences + ' absent' : '',
      att.prevLates != null ? att.prevLates + ' late' : '',
    ]
      .filter(Boolean)
      .join(', ');
    if (!entered) return `The ${esc(_reportLabel(prevTerm))} report had ${was}.`;
    var since = [
      att.absencesThisTerm != null ? att.absencesThisTerm + ' absent' : '',
      att.latesThisTerm != null ? att.latesThisTerm + ' late' : '',
    ]
      .filter(Boolean)
      .join(', ');
    return `Since the ${esc(_reportLabel(prevTerm))} report (${was}): <strong>${since}</strong>`;
  }

  function _attChip(att) {
    var done = att.absences != null && att.lates != null;
    return done
      ? '<span class="qn-chip ok" id="tq-att-chip">✓ Entered</span>'
      : '<span class="qn-chip" id="tq-att-chip">Optional</span>';
  }

  /* A box changed: save both totals and redraw only the note, so the
     cursor stays where the teacher put it. */
  function tqSetAttendance(sid) {
    var abs = document.getElementById('tq-att-absences');
    var late = document.getElementById('tq-att-lates');
    if (!abs || !late) return;
    var termId = getTermId();
    saveTermAttendance(_activeCourse, sid, termId, abs.value, late.value);
    var att = getTermAttendance(_activeCourse, sid, termId);
    var note = document.getElementById('tq-att-note');
    if (note) {
      note.innerHTML = _attendanceNoteHtml(att);
      note.hidden = !note.textContent;
    }
    var chip = document.getElementById('tq-att-chip');
    if (chip) chip.outerHTML = _attChip(att);
    abs.classList.toggle('warn', att.absences != null && att.prevAbsences != null && att.absences < att.prevAbsences);
    late.classList.toggle('warn', att.lates != null && att.prevLates != null && att.lates < att.prevLates);
  }

  /* ── The student strip ───────────────────────────────────── */

  /* About Me in one line: how to say the name (or the name they go by),
     pronouns, student number, languages, how they learn best. */
  function _aboutLine(student, voice) {
    var a = voice && voice.profile && voice.profile.about;
    var answer = function (it) {
      return it && it.v && it.v.text ? String(it.v.text).trim() : '';
    };
    var parts = [];
    if (student.preferred && student.preferred !== student.firstName) parts.push('Goes by ' + student.preferred);
    if (answer(a && a.say)) parts.push('Says it “' + answer(a.say) + '”');
    if (student.pronouns) parts.push(student.pronouns);
    if (student.studentNumber) parts.push(student.studentNumber);
    if (answer(a && a.languages)) parts.push(answer(a.languages));
    var learns = answer(a && a.learns);
    if (learns) parts.push('Learns best ' + learns.charAt(0).toLowerCase() + learns.slice(1));
    return parts.join(' · ');
  }

  function _stripHtml(cid, student, f) {
    var sid = student.id;
    var first = displayNameFirst(student);
    var termId = getTermId();
    var att = getTermAttendance(cid, sid, termId);
    var goal = f.voice.goal;
    var note = _attendanceNoteHtml(att);
    var warn = function (k, p) {
      return att[k] != null && att[p] != null && att[k] < att[p] ? ' warn' : '';
    };
    return `<div class="qn-strip">
      <span class="qn-avatar" style="background:${_avatarColor(sid)}" aria-hidden="true">${esc(initials(student))}</span>
      <div class="qn-who">
        <div class="qn-name">${esc(fullName(student))}</div>
        <div class="qn-about">${esc(_aboutLine(student, f.voice))}</div>
      </div>
      <div class="qn-goal">
        <span class="qn-goal-label">${esc(first + '’s Goal' + (goal && f.voice.goalStatus ? ' · ' + f.voice.goalStatus : ''))}</span>
        <span class="qn-goal-text">${goal ? esc('“' + goal.replace(/[“”"]/g, '') + '”') : 'Not set yet'}</span>
      </div>
      <div class="qn-att">
        <div class="qn-att-head"><span>Attendance · from MyEd</span>${_attChip(att)}</div>
        <div class="qn-att-fields">
          <label>Classes Absent<input type="number" min="0" step="1" inputmode="numeric" class="qn-att-input${warn('absences', 'prevAbsences')}" id="tq-att-absences" data-tq-att="absences" data-sid="${sid}" value="${att.absences == null ? '' : att.absences}"></label>
          <label>Times Late<input type="number" min="0" step="1" inputmode="numeric" class="qn-att-input${warn('lates', 'prevLates')}" id="tq-att-lates" data-tq-att="lates" data-sid="${sid}" value="${att.lates == null ? '' : att.lates}"></label>
        </div>
        <div class="qn-att-note" id="tq-att-note" aria-live="polite"${note ? '' : ' hidden'}>${note}</div>
      </div>
      <button type="button" class="qn-bc-btn" data-action="tqToggleBc" aria-expanded="false">
        <span class="qn-bc-btn-label">BC Requirements</span>
        <span class="qn-bc-btn-short" id="tq-bc-short">${esc(_bcShort(cid, student, f))}</span>
      </button>
    </div>`;
  }

  /* ── The BC Written Learning Update (PR 7) ───────────────── */
  function _bcShort() {
    return '';
  }
  function _bcCardHtml() {
    return '';
  }

  /* ── The middle columns (PRs 5 and 6) ────────────────────── */
  function _evidenceHtml() {
    return '<div class="qn-col-title">What FullVision Has</div>';
  }
  function _bankHtml() {
    return '';
  }

  /* ── The Teacher Comment ─────────────────────────────────── */

  /* Earlier reports with a comment, newest first, as tabs beside This Report. */
  function _earlierReports(cid, sid, termId) {
    var n = Number(String(termId).replace(/\D/g, ''));
    var mine = (getTermRatings(cid) || {})[sid] || {};
    return Object.keys(mine)
      .filter(function (k) {
        var m = Number(String(k).replace(/\D/g, ''));
        return /^term-\d+$/.test(k) && m < n && plainComment(mine[k].narrative).trim();
      })
      .sort(function (a, b) {
        return Number(b.replace(/\D/g, '')) - Number(a.replace(/\D/g, ''));
      });
  }

  function _commentHtml(cid, student) {
    var sid = student.id;
    var termId = getTermId();
    var rating = getStudentTermRating(cid, sid, termId) || {};
    var text = plainComment(rating.narrative || '');
    var earlier = _earlierReports(cid, sid, termId);
    if (_commentTab !== 'this' && earlier.indexOf(_commentTab) < 0) _commentTab = 'this';
    var thisTab = _commentTab === 'this';
    var on = !!rating.approvedAt;
    var tabs = [['this', 'This Report']]
      .concat(
        earlier.map(function (k) {
          return [k, _reportLabel(k)];
        }),
      )
      .map(function (t) {
        var pressed = _commentTab === t[0];
        return `<button type="button" class="seg-btn${pressed ? ' active' : ''}" data-action="tqCommentTab" data-tab="${esc(t[0])}" aria-pressed="${pressed}">${esc(t[1])}</button>`;
      })
      .join('');
    var body;
    if (thisTab) {
      body = `<label class="qn-text-wrap">
          <span class="qn-hint">Your comment. Type it, or add sentences from the Comment Bank and edit them. Prints as one paragraph.</span>
          <textarea id="tq-narrative" class="qn-text" rows="4" spellcheck="true" data-sid="${sid}">${esc(text)}</textarea>
        </label>
        <div class="qn-text-actions">
          <span class="qn-text-note" id="tq-text-note">${text.trim() ? 'Edit any word.' : 'Empty. Type, or add from the Comment Bank.'}</span>
          <button type="button" class="qn-link" data-action="tqClear">Clear</button>
          <button type="button" class="qn-link" data-action="tqCopyNarrative" id="tq-copy-btn">Copy</button>
          <button type="button" class="qn-approve${on ? ' on' : ''}" id="tq-approve" data-action="tqApprove" aria-pressed="${on}">${on ? '✓ Approved' : 'Approve Comment'}</button>
        </div>`;
    } else {
      var old = (getStudentTermRating(cid, sid, _commentTab) || {}).narrative;
      body = `<div class="qn-hint">Went home in ${esc(_reportLabel(_commentTab))} · read only</div>
        <div class="qn-earlier">${plainComment(old)
          .split(/\n\s*\n/)
          .map(function (p) {
            return '<p>' + esc(p.trim()) + '</p>';
          })
          .join('')}</div>`;
    }
    return `<div class="qn-comment-card${thisTab && !on ? ' waiting' : ''}${thisTab ? '' : ' earlier'}" id="tq-comment-card">
        <div class="qn-comment-head">
          <div class="qn-card-title">Teacher Comment</div>
          <div class="seg seg-sm qn-comment-tabs" role="group" aria-label="Report">${tabs}</div>
          <div class="qn-meter" id="tq-meter"${thisTab ? '' : ' hidden'}>
            <span class="qn-meter-track"><span class="qn-meter-bar" id="tq-meter-bar"></span></span>
            <span class="qn-meter-label" id="tq-meter-label"></span>
          </div>
        </div>
        ${body}
      </div>`;
  }

  /* The line meter: the comment's printed lines against the form's box. */
  function setMeter(lines, room) {
    var bar = document.getElementById('tq-meter-bar');
    var label = document.getElementById('tq-meter-label');
    if (!bar || !label) return;
    var over = room > 0 && lines > room;
    label.textContent = lines + ' of ' + room + ' lines';
    label.classList.toggle('over', over);
    bar.classList.toggle('over', over);
    bar.style.width = room > 0 ? Math.min(100, Math.round((lines / room) * 100)) + '%' : '0%';
  }

  function tqCommentTab(tab) {
    tqSaveCurrentIfNeeded();
    _commentTab = tab || 'this';
    rerender();
  }

  /* ── The page ────────────────────────────────────────────── */
  function renderTermQuestionnaire(cid) {
    var students = getTqStudents();
    if (students.length === 0) return '<div class="empty-state"><div class="empty-state-title">No students</div></div>';
    if (tqStudentIndex >= students.length) tqStudentIndex = 0;
    var student = students[tqStudentIndex];
    var termId = getTermId();
    var f = CommentBank.facts(cid, student, termId);

    var name = document.getElementById('tq-student-name');
    if (name) name.textContent = displayName(student);
    var pos = document.getElementById('tq-student-pos');
    if (pos) pos.textContent = tqStudentIndex + 1 + ' of ' + students.length;

    var last = tqStudentIndex >= students.length - 1;
    return `<div class="qn" data-sid="${student.id}">
      ${_stripHtml(cid, student, f)}
      <div class="qn-body">
        <div class="qn-mid">
          <div class="qn-cols">
            <div class="qn-col qn-evidence" id="tq-evidence">${_evidenceHtml(cid, student, f)}</div>
            <div class="qn-col qn-bank" id="tq-bank">${_bankHtml(cid, student, f)}</div>
          </div>
          <div class="qn-bottom">
            <button type="button" class="qn-btn" data-action="tqPrevStudent"${tqStudentIndex === 0 ? ' disabled' : ''}>‹ Previous</button>
            <span class="qn-bottom-hint">${tqStudentIndex + 1} of ${students.length} · ⌘ Return saves and moves on · ↑ ↓ change student</span>
            <button type="button" class="qn-btn primary" data-action="tqNextStudent">${last ? 'Save and Finish' : 'Save and Next ›'}</button>
          </div>
        </div>
        <div class="qn-side">
          <div class="qn-side-title">Teacher Comment · Built From FullVision</div>
          ${_commentHtml(cid, student)}
          ${_bcCardHtml(cid, student, f)}
        </div>
      </div>
    </div>`;
  }

  /* After the page is drawn: the roster, the meter. */
  function afterRender() {
    syncRoster();
    if (_commentFit) _commentFit();
  }

  /* ⌘ Return (or Ctrl Return) saves and moves on; ↑ ↓ change the student
     outside a text field (the sidebar handles them while it has the focus). */
  function handleKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      tqNextStudent();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    var t = e.target;
    if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('#gb-sidebar'))) return;
    e.preventDefault();
    if (e.key === 'ArrowDown') tqNextStudent();
    else tqPrevStudent();
  }

  /* ── Namespace ──────────────────────────────────────────── */
  return {
    configure: configure,
    getTqStudents: getTqStudents,
    tqPrevStudent: tqPrevStudent,
    tqNextStudent: tqNextStudent,
    tqSaveCurrentIfNeeded: tqSaveCurrentIfNeeded,
    tqSaveNarrative: tqSaveNarrative,
    tqNarrativeInput: tqNarrativeInput,
    tqCopyNarrative: tqCopyNarrative,
    tqClear: tqClear,
    tqApprove: tqApprove,
    tqCommentTab: tqCommentTab,
    tqRosterFilter: tqRosterFilter,
    tqSetAttendance: tqSetAttendance,
    tqSelectStudent: tqSelectStudent,
    renderTermQuestionnaire: renderTermQuestionnaire,
    afterRender: afterRender,
    syncRoster: syncRoster,
    restoreRoster: restoreRoster,
    setMeter: setMeter,
    handleKey: handleKey,
    plainComment: plainComment,
    get tqStudentIndex() {
      return tqStudentIndex;
    },
    set tqStudentIndex(v) {
      tqStudentIndex = v;
    },
    get tqNarrativeDirty() {
      return tqNarrativeDirty;
    },
    set tqNarrativeDirty(v) {
      tqNarrativeDirty = v;
    },
  };
})();
