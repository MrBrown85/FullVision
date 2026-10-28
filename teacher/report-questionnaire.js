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

  /* What FullVision has for the student on screen, read once per drawing and
     again only after something it depends on changes (a habit, the Focus
     Area, attendance); typing never re-reads it. */
  var _factsCache = null;
  function _facts(student, fresh) {
    var key = _activeCourse + '|' + student.id + '|' + getTermId();
    if (fresh || !_factsCache || _factsCache.key !== key) {
      _factsCache = { key: key, f: CommentBank.facts(_activeCourse, student, getTermId()) };
    }
    return _factsCache.f;
  }

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
    if (!/<\/?(p|div|br|ul|ol|li|b|i|u|strong|em|span)\b[^>]*>/i.test(s)) return s;
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

  /* Saves the box's text for the class, student and report the box was
     drawn for (its data attributes), so a save that runs after the report,
     the class or the tab has changed still lands where it was typed. An
     edit after approval clears it (upsertTermRating does, as the server
     does). */
  function tqSaveNarrative() {
    var el = _box();
    clearTimeout(_saveTimer);
    if (!el || !el.dataset.sid) return;
    var cid = el.dataset.cid || _activeCourse;
    var sid = el.dataset.sid;
    var termId = el.dataset.term || getTermId();
    var before = getStudentTermRating(cid, sid, termId) || {};
    var text = el.value.replace(/\s+$/, '');
    tqNarrativeDirty = false;
    if (text === plainComment(before.narrative || '').replace(/\s+$/, '')) return;
    upsertTermRating(cid, sid, termId, { narrative: text });
    _syncStatus();
  }
  /* Before anything replaces the page: the class, the report, the tab, the
     student. */
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
  var _quotedTimer = null;
  function _syncQuotedSoon() {
    clearTimeout(_quotedTimer);
    _quotedTimer = setTimeout(function () {
      _syncQuoted();
    }, 300);
  }
  function _syncNote() {
    _syncQuotedSoon();
    _syncRows();
    _syncBcSoon();
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
    _syncBc();
  }

  /* ── The roster (the app's sidebar) ───────────────────────── */

  /* The sidebar's annotator (ui.js setSidebarAnnotator): under each name
     Needs Approval until the comment is approved, then a tick in place of
     the grade; All · Not Ready above the list. The grades come back on any
     other tab (restoreRoster). */
  function syncRoster() {
    var students = getTqStudents();
    var ready = students.filter(function (s) {
      return _approved(s.id);
    }).length;
    var line = document.getElementById('tq-ready');
    if (line) line.textContent = ready + ' of ' + students.length + ' Ready';
    var cur = _current();
    var annotate = function (sid) {
      var ok = _approved(sid);
      return {
        sub: ok ? '' : 'Needs Approval',
        mark: ok ? '<span class="student-row-mark ok" aria-label="Ready">\u2713</span>' : '',
        hidden: _notReadyOnly && ok && !(cur && cur.id === sid),
      };
    };
    annotate.top = function () {
      var btn = function (filter, label, on) {
        return `<button type="button" class="seg-btn${on ? ' active' : ''}" data-action="tqRosterFilter" data-filter="${filter}" aria-pressed="${on}">${label}</button>`;
      };
      return `<div class="seg qn-roster-filter" role="group" aria-label="Show Students">${btn('all', 'All ' + students.length, !_notReadyOnly)}${btn('not-ready', 'Not Ready ' + (students.length - ready), _notReadyOnly)}</div>`;
    };
    if (typeof setSidebarAnnotator === 'function') setSidebarAnnotator(annotate);
    document.querySelectorAll('#gb-sidebar .student-row[data-sid]').forEach(function (row) {
      row.classList.toggle('selected', !!cur && cur.id === row.getAttribute('data-sid'));
    });
    document.body.classList.add('qn-roster');
  }
  function restoreRoster() {
    if (typeof setSidebarAnnotator === 'function') setSidebarAnnotator(null);
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
    _redrawBank();
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

  function _stripHtml(cid, student, f, bc) {
    var sid = student.id;
    var first = student.firstName || displayNameFirst(student);
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
        <span class="qn-bc-btn-short${bc.all ? ' ok' : ''}" id="tq-bc-short">${esc(_bcShort(bc))}</span>
      </button>
    </div>`;
  }

  /* ── The BC Written Learning Update ──────────────────────── */

  function _form(cid) {
    return ReportSheets.formFor((typeof getReportConfig === 'function' && getReportConfig(cid)) || {});
  }
  function _blockLabel(id) {
    var b = ReportSheets.BLOCKS[id];
    return b ? b.label : id;
  }

  /* BC's six requirements for a written learning update, each met by a
     block on the class's form or by a part of the comment, and where. */
  var _bcOpen = false;
  function _bcState(cid, student, f) {
    var first = student.firstName || displayNameFirst(student);
    var on = ReportSheets.onForm(_form(cid));
    var has = function (id) {
      return on.indexOf(id) >= 0;
    };
    var termId = getTermId();
    var rating = getStudentTermRating(cid, student.id, termId) || {};
    var el = _box();
    var text = el && el.dataset.sid === student.id ? el.value : plainComment(rating.narrative || '');
    var parts = CommentBank.parts(_bankContext(cid, student, f), text, {});
    var inPart = function (i) {
      return parts[i] && parts[i].inComment;
    };
    var rated = Object.keys(rating.habits || {}).some(function (k) {
      return rating.habits[k] >= 1 && rating.habits[k] <= 4;
    });
    var answered = (f.voice.entries || []).some(function (e) {
      return e.kind === 'core_reflection' || e.kind === 'goal_checkin';
    });
    var req = function (name, done, where) {
      return { name: name, done: !!done, where: where };
    };
    var part = function (i, name, block, blockWhere) {
      if (inPart(i)) return req(name, true, 'Teacher Comment · part ' + (i + 1));
      if (block) return req(name, true, blockWhere);
      return req(name, false, 'Nothing from part ' + (i + 1) + ' yet');
    };
    var reqs = [
      has('proficiency')
        ? req('Proficiency in Each Area', true, 'Proficiency · from scores')
        : req('Proficiency in Each Area', false, 'The Proficiency block is not on this report'),
      part(0, 'Work Habits', has('learner-dimensions') && rated, 'Learning Dispositions · from your ratings'),
      part(1, 'Strengths and Growth', has('progress'), 'Progress in One Area · from scores'),
      part(2, 'Next Steps', has('next-steps'), 'Next Steps · from your Focus Area'),
      part(3, 'Ways to Support', has('support-home'), 'Ways to Support at Home · from your Focus Area'),
      has('self-assessment')
        ? req(
            'Self-Reflection and Goals',
            answered,
            'Self-Assessment and Goal · ' + (answered ? 'answered' : 'waiting on ' + first),
          )
        : req('Self-Reflection and Goals', false, 'The Self-Assessment and Goal block is not on this report'),
    ];
    var used = [
      'header',
      'proficiency',
      'teacher-narrative',
      'learner-dimensions',
      'progress',
      'next-steps',
      'support-home',
      'self-assessment',
    ];
    var att = getTermAttendance(cid, student.id, termId);
    var also = on
      .filter(function (id) {
        return used.indexOf(id) < 0;
      })
      .map(function (id) {
        var status = {
          'missing-work': 'From assignments',
          'grade-table': 'From scores',
          'competency-table': 'From scores',
          legend: 'Same for all',
          'parent-response': 'Family writes',
          'text-block': 'Your text',
          'student-reflection-learning': 'Student writes',
          'student-reflection-habits': 'Student writes',
          'term-attendance':
            att.absences != null || att.lates != null
              ? [att.absences != null ? att.absences + ' absent' : '', att.lates != null ? att.lates + ' late' : '']
                  .filter(Boolean)
                  .join(' · ')
              : 'Optional',
        }[id];
        return { name: _blockLabel(id), status: status || 'From FullVision' };
      });
    var done = reqs.filter(function (r) {
      return r.done;
    }).length;
    return {
      reqs: reqs,
      done: done,
      all: done === reqs.length,
      also: also,
      approved: !!rating.approvedAt,
      waiting: has('self-assessment') && !answered,
      first: first,
    };
  }

  function _bcShort(b) {
    return (b.all ? '✓ ' : '') + b.done + ' of ' + b.reqs.length + ' requirements';
  }

  function _bcInnerHtml(b) {
    var shown = _bcOpen
      ? b.reqs
      : b.reqs.filter(function (r) {
          return !r.done;
        });
    return `<div class="qn-card-title">BC Written Learning Update</div>
      <button type="button" class="qn-bc-toggle" data-action="tqToggleBcAll" aria-expanded="${_bcOpen}">
        <span class="qn-bc-count${b.all ? ' ok' : ''}">${_bcShort(b)}</span>
        <span class="qn-link-text">${_bcOpen ? 'Hide' : 'Show All'}</span>
      </button>
      ${shown
        .map(function (r) {
          return `<div class="qn-req"><span class="qn-req-mark${r.done ? ' ok' : ''}" aria-label="${r.done ? 'Met' : 'Not met'}">${r.done ? '✓' : '●'}</span><span class="qn-req-name">${esc(r.name)}</span><span></span><span class="qn-req-where">${esc(r.where)}</span></div>`;
        })
        .join('')}
      ${
        _bcOpen && b.also.length
          ? `<div class="qn-also"><span class="qn-also-title">Also on This Report</span>${b.also
              .map(function (a) {
                return `<div class="qn-also-row"><span>${esc(a.name)}</span><span>${esc(a.status)}</span></div>`;
              })
              .join('')}</div>`
          : ''
      }
      <div class="qn-left">
        <div class="qn-left-list">
          <span class="qn-card-sub">Left for You</span>
          ${b.approved ? `<span class="qn-left-item ok">Nothing. ${esc(b.first)} is ready.</span>` : '<span class="qn-left-item">Approve the Comment</span>'}
          ${b.waiting ? `<span class="qn-card-sub qn-left-wait">Waiting on ${esc(b.first)}</span><span class="qn-left-item">Self-Assessment and Goal</span>` : ''}
        </div>
        <button type="button" class="qn-link" data-action="tqOpenReport">Open in Progress Reports ›</button>
      </div>`;
  }

  function _bcCardHtml(b) {
    return `<div class="qn-card qn-bc-card" id="tq-bc-card">${_bcInnerHtml(b)}</div>`;
  }

  /* The card and the strip's count, after the comment or a rating changes. */
  function _syncBc() {
    var st = _current();
    var card = document.getElementById('tq-bc-card');
    if (!st || !card) return;
    var b = _bcState(_activeCourse, st, _facts(st));
    card.innerHTML = _bcInnerHtml(b);
    var short = document.getElementById('tq-bc-short');
    if (short) {
      short.textContent = _bcShort(b);
      short.classList.toggle('ok', b.all);
    }
  }
  var _bcTimer = null;
  function _syncBcSoon() {
    clearTimeout(_bcTimer);
    _bcTimer = setTimeout(_syncBc, 300);
  }

  function tqToggleBcAll() {
    _bcOpen = !_bcOpen;
    _syncBc();
  }

  /* Below 1400 px the card opens under the strip's button. */
  function tqToggleBc(force) {
    var qn = document.querySelector('.qn');
    var btn = document.querySelector('.qn-bc-btn');
    var card = document.getElementById('tq-bc-card');
    if (!qn || !card) return;
    var open = typeof force === 'boolean' ? force : !qn.classList.contains('bc-open');
    qn.classList.toggle('bc-open', open);
    if (btn) btn.setAttribute('aria-expanded', String(open));
    if (open) {
      var strip = qn.querySelector('.qn-strip');
      card.style.top = strip ? strip.offsetTop + strip.offsetHeight + 6 + 'px' : '';
      card.scrollTop = 0;
    } else {
      card.style.top = '';
    }
  }

  /* ── The Questions sheet ─────────────────────────────────── */

  /* What the questionnaire asks for each block on the class's form. */
  function _asks(cid, id) {
    var mine = function (t) {
      return { ask: t, who: 'You', asks: true };
    };
    var none = function (t, who) {
      return { ask: t, who: who || 'FullVision', asks: false };
    };
    var phones = '';
    if (typeof Questionnaires !== 'undefined' && Questionnaires.list) {
      phones = Questionnaires.list(cid)
        .filter(function (q) {
          return (q.kind === 'core_reflection' || q.kind === 'goal_checkin') && !q.archived_at;
        })
        .map(function (q) {
          return q.title;
        })
        .filter(function (t, i, a) {
          return t && a.indexOf(t) === i;
        });
    }
    var map = {
      header: none('Nothing. Comes from Class Settings.'),
      proficiency: none('Nothing. Comes from scores.'),
      legend: none('Nothing. Same for everyone.'),
      'competency-table': none('Nothing. Comes from scores.'),
      'grade-table': none('Nothing. Comes from scores.'),
      'missing-work': none('Nothing. Comes from assignments.'),
      'teacher-narrative': mine(
        'Written by you. Six habit scales and the Comment Bank (' +
          COMMENT_BANK.sentences.length +
          ' sentences in four parts) supply wording to add and edit.',
      ),
      'term-attendance': mine('Optional. Classes Absent and Times Late, typed from MyEd.'),
      'learner-dimensions': mine('The six habit scales, Rarely to Consistently.'),
      'next-steps': mine('The Focus Area and I Can, picked in the Comment Bank.'),
      progress: mine('The Focus Area, picked in the Comment Bank.'),
      'support-home': mine('The Focus Area, picked in the Comment Bank. The work comes from scores.'),
      'self-assessment': {
        ask: (phones.length ? CommentBank.list(phones) : 'The reflection and Goal Check-In') + ', on phones.',
        who: 'Student',
        asks: true,
      },
      'student-reflection-learning': none('Nothing. The student writes on the printed page.', 'Student'),
      'student-reflection-habits': none('Nothing. The student writes on the printed page.', 'Student'),
      'parent-response': none('Nothing. The family writes it.', 'Family'),
      'text-block': none('Nothing. Your text on the form, in Progress Reports.', 'You'),
    };
    return map[id] || none('Nothing. Comes from FullVision.');
  }

  var QUESTIONS_ID = 'tq-questions-overlay';
  function _questionsHtml(cid) {
    var form = _form(cid);
    var on = ReportSheets.onForm(form);
    var course = (typeof COURSES !== 'undefined' && COURSES[cid] && COURSES[cid].name) || '';
    var rows = on
      .map(function (id) {
        var a = _asks(cid, id);
        return `<div class="qn-q-row"><span class="qn-q-block">${esc(_blockLabel(id))}</span><span class="qn-q-ask${a.asks ? '' : ' none'}">${esc(a.ask)}</span><span class="qn-q-who who-${a.who.toLowerCase()}">${esc(a.who)}</span></div>`;
      })
      .join('');
    var off = Object.keys(ReportSheets.BLOCKS)
      .filter(function (id) {
        var b = ReportSheets.BLOCKS[id];
        return !b.retired && on.indexOf(id) < 0 && id !== 'header';
      })
      .map(_blockLabel);
    var cards = cardsOn(cid);
    var CARDS = [
      ['growth', 'Growth', 'Every score this term and Start → Now per competency'],
      ['obs', 'Observations', 'Quick observations from this term'],
      ['voice', 'Student Voice', 'About Me, reflections and goal check-ins'],
      ['assignments', 'Assignments', 'Handed in, late and missing this term'],
    ];
    return `<div class="qn-q-sheet" role="document">
      <div class="qn-q-top"><div class="confirm-title" id="tq-questions-title">Questions</div><button type="button" class="qn-btn" data-action="tqCloseQuestions">Done</button></div>
      <div class="qn-q-grid">
        <div class="qn-card">
          <div class="qn-card-row"><div class="qn-q-title">Where Each Block Gets Its Content</div><div class="qn-card-sub">Set by the blocks on ${esc(course)}’s report</div></div>
          <div class="qn-q-row qn-q-head"><span>Report Block</span><span>The Questionnaire Asks</span><span>Who</span></div>
          ${rows}
          ${
            off.length
              ? `<div class="qn-q-off"><div><b>Not on This Report</b><span>${esc(off.join(' · '))}</span></div><button type="button" class="qn-btn" data-action="tqOpenProgress">Open Progress Reports</button></div>`
              : ''
          }
        </div>
        <div class="qn-card">
          <div class="qn-card-row"><div class="qn-q-title">What FullVision Has</div><div class="qn-card-sub">Shown beside your questions</div></div>
          ${CARDS.map(function (c) {
            return `<label class="qn-q-card"><span><b>${c[1]}</b><span>${c[2]}</span></span><input type="checkbox" data-tq-card="${c[0]}"${cards[c[0]] ? ' checked' : ''}></label>`;
          }).join('')}
          <div class="qn-q-never"><span class="qn-card-sub">Never Printed</span><span>Student Voice answers marked Private.</span></div>
        </div>
      </div>
    </div>`;
  }

  function tqOpenQuestions() {
    tqCloseQuestions();
    var overlay = document.createElement('div');
    overlay.id = QUESTIONS_ID;
    overlay.className = 'confirm-overlay qn-q-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'tq-questions-title');
    overlay.innerHTML = _questionsHtml(_activeCourse);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) tqCloseQuestions();
    });
    document.body.appendChild(overlay);
    var done = overlay.querySelector('[data-action="tqCloseQuestions"]');
    if (done) done.focus();
  }
  function tqCloseQuestions() {
    var o = document.getElementById(QUESTIONS_ID);
    if (!o) return;
    o.remove();
    var b = document.getElementById('tq-questions-btn');
    if (b) b.focus();
  }

  /* A What FullVision Has box on the sheet: saved on this device, and the
     column redrawn at once. */
  function tqSetCard(key, on) {
    var cid = _activeCourse;
    var cards = cardsOn(cid);
    cards[key] = !!on;
    try {
      localStorage.setItem('gb-tq-cards-' + cid, JSON.stringify(cards));
    } catch (e) {
      /* the choice holds for this visit */
    }
    var st = _current();
    var col = document.getElementById('tq-evidence');
    if (st && col) col.innerHTML = _evidenceHtml(cid, st, _facts(st));
  }

  /* ── What FullVision Has ──────────────────────────────────── */

  /* The cards the teacher shows beside the questions, on this device
     (the Questions sheet; gb-tq-cards-<cid>). All on until changed. */
  var CARD_KEYS = ['growth', 'obs', 'voice', 'assignments'];
  function cardsOn(cid) {
    var out = { growth: true, obs: true, voice: true, assignments: true };
    try {
      var saved = JSON.parse(localStorage.getItem('gb-tq-cards-' + cid) || '{}') || {};
      CARD_KEYS.forEach(function (k) {
        if (saved[k] === false) out[k] = false;
      });
    } catch (e) {
      /* keep the defaults */
    }
    return out;
  }

  var _evTab = 'growth'; // the laptop's one card at a time

  /* A dot per score on three rows by level: Extending on top, Proficient
     in the middle, Developing and Emerging at the bottom. */
  function _dot(v) {
    var lvl = Math.max(1, Math.min(4, Math.round(v)));
    var row = lvl >= 4 ? 'top' : lvl === 3 ? 'mid' : 'low';
    return `<span class="qn-dot ${row}" data-level="${lvl}"></span>`;
  }

  function _growthHtml(cid, f, cards) {
    var rows = f.comps
      .filter(function (c) {
        return c.scores.length;
      })
      .map(function (c) {
        var up = Math.round(c.now * 10) - Math.round(c.start * 10);
        var sn = c.start > 0 ? formatLevel(cid, c.start) + ' → ' + formatLevel(cid, c.now) : '';
        var aria =
          c.name +
          ': ' +
          c.scores.length +
          (c.scores.length === 1 ? ' score' : ' scores') +
          (c.start > 0
            ? ', ' +
              (PROF_LABELS[Math.round(c.start)] || '') +
              ' at the start, ' +
              (PROF_LABELS[Math.round(c.now)] || '') +
              ' now'
            : '');
        return `<div class="qn-growth-row">
          <div class="qn-growth-head"><span class="qn-growth-name">${esc(c.name)}</span><span class="qn-growth-sn ${up > 0 ? 'up' : up < 0 ? 'down' : ''}">${esc(sn)}</span></div>
          <span class="qn-dots" role="img" aria-label="${esc(aria)}">${c.scores
            .map(function (sc) {
              return _dot(sc.v);
            })
            .join('')}</span>
        </div>`;
      })
      .join('');
    var emerging = f.comps.some(function (c) {
      return c.scores.some(function (sc) {
        return Math.round(sc.v) <= 1;
      });
    });
    var rec = f.record;
    return `<div class="qn-card">
      <div class="qn-card-head"><div class="qn-card-title">Growth</div><div class="qn-card-sub">Every score this term, oldest to newest. A higher dot is a higher level.</div></div>
      ${
        rows
          ? `<div class="qn-growth-cols"><span>Competency and Scores</span><span>Start → Now</span></div>${rows}
      <div class="qn-legend"><span><i class="qn-key" data-level="4"></i>Extending</span><span><i class="qn-key" data-level="3"></i>Proficient</span><span><i class="qn-key" data-level="2"></i>Developing</span>${emerging ? '<span><i class="qn-key" data-level="1"></i>Emerging</span>' : ''}</div>`
          : '<div class="qn-empty">No scores this term yet.</div>'
      }
      ${
        cards.assignments
          ? `<div class="qn-record">
        <div><span>Handed In</span><b>${rec.handed} of ${rec.total}</b></div>
        <div><span>Late</span><b>${rec.late}</b></div>
        <div><span>Missing</span><b>${rec.missing}</b></div>
      </div>`
          : ''
      }
    </div>`;
  }

  function _tagLabel(key) {
    var t = typeof resolveTag === 'function' ? resolveTag(key) : { label: key };
    var label = String(t.label || key);
    return t.type === 'dim' ? label.split(' & ')[0] : label.replace(/ & /g, ' and ');
  }

  function _obsHtml(cid, f, comment) {
    var items = f.obs
      .map(function (o) {
        var quoted = !!o.text && comment.indexOf(o.text.replace(/[.\s]+$/, '')) >= 0;
        return `<div class="qn-obs">
          <div class="qn-obs-text">${esc(o.text)}</div>
          <div class="qn-obs-meta"><span class="qn-obs-date">${esc(o.day)}</span>${(o.dims || [])
            .map(function (d) {
              return `<span class="qn-tag">${esc(_tagLabel(d))}</span>`;
            })
            .join(
              '',
            )}<span class="qn-fill"></span>${quoted ? '<span class="qn-quoted">In the Comment</span>' : ''}</div>
        </div>`;
      })
      .join('');
    return `<div class="qn-card">
      <div class="qn-card-row"><div class="qn-card-title">Observations</div><div class="qn-card-sub">This Term · ${f.obs.length}</div></div>
      ${items || '<div class="qn-empty">None this term. The comment works without them: Work Habits is built from your habit ratings.</div>'}
    </div>`;
  }

  /* The student's own words: what they are good at and find hard, their
     shield, the Core Competency goal with its Goal Check-In, the next step,
     the private note (marked, never printed), and forms not answered. */
  function _voiceHtml(cid, student, f) {
    var first = student.firstName || displayNameFirst(student);
    var p = f.pronouns;
    var v = f.voice;
    var prof = v.profile;
    var answer = function (it) {
      return it && it.v && it.v.text ? String(it.v.text).trim() : '';
    };
    var q = function (it, fallback) {
      return (it && it.q && it.q.prompt) || fallback;
    };
    var rows = [];
    var about = prof && prof.about;
    if (answer(about && about.goodAt)) rows.push([q(about.goodAt), '“' + answer(about.goodAt) + '”']);
    if (answer(about && about.hard)) rows.push([q(about.hard), '“' + answer(about.hard) + '”']);
    var refl =
      prof &&
      prof.reflections &&
      prof.reflections.find(function (e) {
        return e.kind === 'core_reflection';
      });
    var shield =
      refl &&
      refl.items.find(function (it) {
        return it.q.kind === 'short_set' && it.v;
      });
    if (shield) {
      var words = Array.isArray(shield.v.json) ? shield.v.json.filter(Boolean).join(' · ') : answer(shield);
      rows.push([String(shield.q.prompt || '').split(':')[0], words]);
    }
    var ck = prof && prof.checkin;
    if (ck && (answer(ck.coreGoal) || answer(ck.status))) {
      var code = answer(ck.core);
      var cc = code && typeof getCoreCompetency === 'function' ? getCoreCompetency(code) : null;
      var ccName = cc ? cc.label.replace(/ & /g, ' and ') : code;
      var a =
        (ccName ? ccName + ': ' : '') +
        (answer(ck.coreGoal) ? '“' + answer(ck.coreGoal) + '” ' : '') +
        (answer(ck.status) ? answer(ck.status) + '.' : '');
      rows.push(['Core Competency to grow · Goal Check-In', a.trim()]);
    }
    if (ck && answer(ck.next)) rows.push([q(ck.next, 'What will you do next?'), '“' + answer(ck.next) + '”']);
    var answered = {};
    (v.entries || []).forEach(function (e) {
      answered[e.qid] = true;
    });
    var forms =
      typeof Questionnaires !== 'undefined' && Questionnaires.list
        ? Questionnaires.list(cid).filter(function (qn) {
            return !answered[qn.id] && qn.kind !== 'report_reply' && !qn.archived_at;
          })
        : [];
    var sub = (v.entries || []).length ? 'From ' + p.poss + ' phone' : 'Nothing from ' + p.poss + ' phone yet';
    return `<div class="qn-card">
      <div class="qn-card-row"><div class="qn-card-title">${esc(first)}’s Voice</div><div class="qn-card-sub">${esc(sub)}</div></div>
      ${rows
        .map(function (r) {
          return `<div class="qn-voice"><div class="qn-voice-q">${esc(r[0])}</div><div class="qn-voice-a">${esc(r[1])}</div></div>`;
        })
        .join('')}
      ${
        v.private
          ? `<div class="qn-private"><div class="qn-private-head"><span>${esc(q(about && about.note, 'Anything else you want me to know?'))}</span><span class="qn-private-chip">Private · Never Printed</span></div><div class="qn-voice-a">“${esc(v.private)}”</div></div>`
          : ''
      }
      ${forms
        .map(function (qn) {
          return `<div class="qn-form"><span>${esc(qn.title || '')}</span><span class="qn-chip warn">Not Answered</span></div>`;
        })
        .join('')}
    </div>`;
  }

  function _evidenceHtml(cid, student, f) {
    var cards = cardsOn(cid);
    var comment = plainComment((getStudentTermRating(cid, student.id, getTermId()) || {}).narrative || '');
    var shown = [
      ['growth', 'Growth', cards.growth || cards.assignments],
      ['obs', 'Observations', cards.obs],
      ['voice', 'Voice', cards.voice],
    ].filter(function (t) {
      return t[2];
    });
    if (
      !shown.some(function (t) {
        return t[0] === _evTab;
      })
    )
      _evTab = shown.length ? shown[0][0] : 'growth';
    var tabs = shown.length
      ? `<div class="seg qn-ev-tabs" role="group" aria-label="What FullVision Has">${shown
          .map(function (t) {
            var on = _evTab === t[0];
            return `<button type="button" class="seg-btn${on ? ' active' : ''}" data-action="tqEvidenceTab" data-tab="${t[0]}" aria-pressed="${on}">${t[1]}</button>`;
          })
          .join('')}</div>`
      : '';
    var card = function (key, html) {
      return `<div class="qn-ev-card${_evTab === key ? ' on' : ''}" data-card="${key}">${html}</div>`;
    };
    return (
      tabs +
      '<div class="qn-col-title">What FullVision Has</div>' +
      (cards.growth || cards.assignments ? card('growth', _growthHtml(cid, f, cards)) : '') +
      (cards.obs ? card('obs', _obsHtml(cid, f, comment)) : '') +
      (cards.voice ? card('voice', _voiceHtml(cid, student, f)) : '') +
      (shown.length ? '' : '<div class="qn-empty">Every card is off. Turn them on in Questions.</div>')
    );
  }

  function tqEvidenceTab(tab) {
    _evTab = tab;
    document.querySelectorAll('.qn-ev-tabs .seg-btn').forEach(function (b) {
      var on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('.qn-ev-card').forEach(function (c) {
      c.classList.toggle('on', c.dataset.card === tab);
    });
  }

  /* After the comment changes: which notes it quotes. */
  function _syncQuoted() {
    var el = _box();
    if (!el) return;
    var comment = el.value;
    var st = _current();
    if (!st) return;
    var f = _facts(st);
    var ev = document.querySelector('.qn-ev-card[data-card="obs"]');
    if (ev) ev.innerHTML = _obsHtml(_activeCourse, f, comment);
  }

  /* ── The Comment Bank ────────────────────────────────────── */

  /* The teacher's picks that are not saved: the note to quote and the I Can
     per Focus Area, for each student, this session. The Focus Area is saved
     on the rating (focusSectionId) so the report's Next Steps follow it. */
  var _picks = {};
  var _more = {};
  function _picksFor(sid) {
    if (!_picks[sid]) _picks[sid] = { note: null, ican: {} };
    return _picks[sid];
  }

  /* Classmates' comments this report, for "used for 3 or more classmates". */
  function _classmateComments(cid, sid, termId) {
    var all = getTermRatings(cid) || {};
    return Object.keys(all)
      .filter(function (k) {
        return k !== sid && all[k] && all[k][termId] && all[k][termId].narrative;
      })
      .map(function (k) {
        return plainComment(all[k][termId].narrative);
      });
  }

  function _bankContext(cid, student, f) {
    var rating = getStudentTermRating(cid, student.id, getTermId()) || {};
    var picks = _picksFor(student.id);
    return CommentBank.context(f, {
      habits: rating.habits || {},
      focus: rating.focusSectionId || f.focusId,
      ican: (picks.ican || {})[rating.focusSectionId || f.focusId] || 0,
      note: picks.note,
    });
  }

  function _ratingsHtml(cid, f, ctx) {
    var stored = (getStudentTermRating(cid, f.sid, getTermId()) || {}).habits || {};
    var rated = CommentBank.HABITS.filter(function (h) {
      return ctx._habits[h.key] != null;
    }).length;
    var rows = CommentBank.HABITS.map(function (h) {
      var v = ctx._habits[h.key];
      var auto = h.key === 'completes' && v != null && stored.completes == null;
      var note =
        v == null
          ? '<span class="qn-rate-note waiting">Not Rated</span>'
          : auto
            ? `<span class="qn-rate-note">From assignments · ${f.record.handed} of ${f.record.total}, ${f.record.late} late, ${f.record.missing} missing</span>`
            : '';
      var opts = CommentBank.SCALE.map(function (label, i) {
        var val = i + 1;
        var on = v === val;
        return `<button type="button" class="qn-rate-opt${on ? ' on' : ''}${val === CommentBank.NOT_SEEN ? ' not-seen' : ''}" data-action="tqRate" data-habit="${h.key}" data-value="${val}" aria-pressed="${on}">${label}</button>`;
      }).join('');
      return `<div class="qn-rate">
        <div class="qn-rate-head"><span class="qn-rate-name">${esc(h.name)}</span><span class="qn-rate-hint">${esc(h.hint)}</span><span class="qn-fill"></span>${note}</div>
        <div class="qn-rate-opts" role="group" aria-label="${esc(h.name)}">${opts}</div>
      </div>`;
    }).join('');
    return `<div class="qn-rates">
      <div class="qn-rates-head"><span>How Often You’ve Seen It This Term</span><span class="qn-card-sub">${rated} of 6 rated</span></div>
      ${rows}
    </div>`;
  }

  function _choosersHtml(cid, f, ctx, part) {
    var chooser = function (label, opts) {
      return `<div class="qn-chooser"><span class="qn-chooser-label">${esc(label)}</span>${opts
        .map(function (o) {
          return `<button type="button" class="qn-choice${o.on ? ' on' : ''}" data-action="${o.action}" data-value="${esc(o.value)}" aria-pressed="${o.on}">${esc(o.label)}</button>`;
        })
        .join('')}</div>`;
    };
    if (part === 'now' && f.obs.length) {
      return chooser(
        'Note to Quote',
        f.obs.map(function (o) {
          return {
            action: 'tqPickNote',
            value: o.id,
            on: !!ctx._note && ctx._note.id === o.id,
            label: o.day + (o.dims && o.dims[0] ? ' · ' + _tagLabel(o.dims[0]) : ''),
          };
        }),
      );
    }
    if (part === 'go' && ctx._options.length) {
      var focus = ctx._focus;
      var html = chooser(
        'Focus Area',
        ctx._options.map(function (c) {
          return {
            action: 'tqPickFocus',
            value: c.id,
            on: !!focus && focus.id === c.id,
            label: c.start > 0 ? c.name + ' ' + formatLevel(cid, c.start) + ' → ' + formatLevel(cid, c.now) : c.name,
          };
        }),
      );
      if (focus && focus.iCans.length) {
        html += chooser(
          'I Can',
          focus.iCans.map(function (s) {
            return {
              action: 'tqPickICan',
              value: String(focus.iCans.indexOf(s)),
              on: ctx.nextStep === s,
              label: s.replace(/^I can /i, '').replace(/\.$/, ''),
            };
          }),
        );
      }
      return html;
    }
    return '';
  }

  function _rowHtml(r) {
    return `${r.first ? `<div class="qn-group">${esc(r.group)}</div>` : ''}<button type="button" class="qn-row${r.added ? ' added' : ''}" data-action="tqAdd" data-id="${r.id}" data-used="${r.used}" data-text="${esc(r.text)}" aria-label="${esc((r.added ? 'Added: ' : 'Add: ') + r.text)}">
        <span class="qn-row-body"><span class="qn-row-text">${esc(r.text)}</span><span class="qn-row-meta"${r.meta ? '' : ' hidden'}>${esc(r.meta)}</span></span>
        <span class="qn-pill">${r.added ? '\u2713 Added' : 'Add'}</span>
      </button>`;
  }

  function _bankHtml(cid, student, f) {
    if (_commentTab !== 'this') {
      return `<div class="qn-card"><div class="qn-card-title">Comment Bank</div><div class="qn-empty">The bank builds this report’s comment. Choose This Report on the Teacher Comment to use it.</div></div>`;
    }
    var termId = getTermId();
    var ctx = _bankContext(cid, student, f);
    var text = plainComment((getStudentTermRating(cid, student.id, termId) || {}).narrative || '');
    var el = _box();
    if (el && el.dataset.sid === student.id) text = el.value;
    var parts = CommentBank.parts(ctx, text, {
      first: student.firstName,
      more: _more,
      comments: _classmateComments(cid, student.id, termId),
    });
    var first = student.firstName || displayNameFirst(student);
    var fit = parts.reduce(function (n, p) {
      return n + p.fit;
    }, 0);
    var html = parts
      .map(function (p) {
        return `<div class="qn-part" data-part="${p.id}">
          <div class="qn-part-head"><span class="qn-part-title"><span class="qn-part-n">${p.n}</span>${esc(p.title)}</span><span class="qn-card-sub">${p.fit} fit ${esc(first)}</span></div>
          ${p.id === 'habits' ? _ratingsHtml(cid, f, ctx) : ''}
          ${_choosersHtml(cid, f, ctx, p.id)}
          ${p.rows.map(_rowHtml).join('')}
          <div class="qn-part-foot"><span class="qn-card-sub">${p.waiting ? p.waiting + ' more appear once ' + esc(first) + ' has the ratings or data they use' : ''}</span>${
            p.canMore
              ? `<button type="button" class="qn-link" data-action="tqMore" data-part="${p.id}">${p.more ? 'Show Fewer' : 'Show All ' + p.fit}</button>`
              : ''
          }</div>
        </div>`;
      })
      .join('');
    return `<div class="qn-card qn-bank-card">
      <div class="qn-card-row"><div class="qn-card-title">Comment Bank</div><div class="qn-card-sub">${COMMENT_BANK.sentences.length} sentences · ${fit} fit ${esc(first)}</div></div>
      <div class="qn-bank-hint">Add puts a sentence, filled in for ${esc(first)}, at the end of your comment. Sentences you have used for ${CommentBank.USED_BY} or more classmates this term sit at the bottom of each list.</div>
      ${html}
    </div>`;
  }

  /* Redraws only the bank column, where it was scrolled to. */
  function _redrawBank() {
    var st = _current();
    var col = document.getElementById('tq-bank');
    if (!st || !col) return;
    var top = col.scrollTop;
    // A habit, the Focus Area or attendance changed: read the facts again.
    col.innerHTML = _bankHtml(_activeCourse, st, _facts(st, true));
    col.scrollTop = top;
    _syncBc();
  }

  /* After the comment changes: each row's Added and "starts like" note, in
     place. */
  function _syncRows() {
    var el = _box();
    if (!el) return;
    var text = el.value;
    var last = CommentBank.lastStart(text);
    document.querySelectorAll('#tq-bank .qn-row').forEach(function (row) {
      var t = row.dataset.text || '';
      var added = text.indexOf(t) >= 0;
      row.classList.toggle('added', added);
      row.setAttribute('aria-label', (added ? 'Added: ' : 'Add: ') + t);
      var pill = row.querySelector('.qn-pill');
      if (pill) pill.textContent = added ? '\u2713 Added' : 'Add';
      var meta = row.querySelector('.qn-row-meta');
      if (meta) {
        meta.textContent = CommentBank.rowMeta(
          !added && CommentBank.repeatsLast(t, last),
          Number(row.dataset.used) || 0,
        );
        meta.hidden = !meta.textContent;
      }
    });
  }

  /* Add: the filled sentence at the end of the comment, typed in so ⌘Z
     undoes it; the row shows ✓ Added where it is. */
  function tqAdd(btn) {
    var el = _box();
    var t = btn && btn.dataset.text;
    if (!el || !t || el.value.indexOf(t) >= 0) return;
    var end = el.value.replace(/\s+$/, '');
    var add = (end ? (/\n$/.test(el.value) ? '' : ' ') : '') + t;
    el.focus();
    el.setSelectionRange(end.length, el.value.length);
    var ok = false;
    try {
      ok = document.execCommand('insertText', false, add);
    } catch (e) {
      ok = false;
    }
    if (!ok) el.value = end + add;
    el.scrollTop = el.scrollHeight;
    tqNarrativeDirty = true;
    tqSaveNarrative();
    _syncNote();
    _syncRows();
  }

  /* A habit picked on the scale: saved with the others (the whole map). */
  function tqRate(key, value) {
    var st = _current();
    if (!st) return;
    tqSaveCurrentIfNeeded();
    var termId = getTermId();
    var habits = Object.assign({}, (getStudentTermRating(_activeCourse, st.id, termId) || {}).habits || {});
    habits[key] = Number(value);
    upsertTermRating(_activeCourse, st.id, termId, { habits: habits });
    _redrawBank();
  }
  function tqPickNote(id) {
    var st = _current();
    if (!st) return;
    _picksFor(st.id).note = id;
    _redrawBank();
  }
  function tqPickFocus(id) {
    var st = _current();
    if (!st) return;
    tqSaveCurrentIfNeeded();
    upsertTermRating(_activeCourse, st.id, getTermId(), { focusSectionId: id });
    _redrawBank();
  }
  function tqPickICan(i) {
    var st = _current();
    if (!st) return;
    var rating = getStudentTermRating(_activeCourse, st.id, getTermId()) || {};
    var focus = rating.focusSectionId || _facts(st).focusId;
    _picksFor(st.id).ican[focus] = Number(i) || 0;
    _redrawBank();
  }
  function tqMore(part) {
    _more[part] = !_more[part];
    _redrawBank();
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
          <textarea id="tq-narrative" class="qn-text" rows="4" spellcheck="true" data-cid="${esc(cid)}" data-sid="${esc(sid)}" data-term="${esc(termId)}">${esc(text)}</textarea>
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
    var f = _facts(student, true);
    var bc = _bcState(cid, student, f);

    var name = document.getElementById('tq-student-name');
    if (name) name.textContent = displayName(student);
    var pos = document.getElementById('tq-student-pos');
    if (pos) pos.textContent = tqStudentIndex + 1 + ' of ' + students.length;

    var last = tqStudentIndex >= students.length - 1;
    return `<div class="qn" data-sid="${student.id}">
      ${_stripHtml(cid, student, f, bc)}
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
          ${_bcCardHtml(bc)}
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
    if (e.key === 'Escape') {
      if (document.getElementById(QUESTIONS_ID)) tqCloseQuestions();
      else tqToggleBc(false);
      return;
    }
    if (document.getElementById(QUESTIONS_ID)) return;
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
    tqEvidenceTab: tqEvidenceTab,
    tqAdd: tqAdd,
    tqRate: tqRate,
    tqPickNote: tqPickNote,
    tqPickFocus: tqPickFocus,
    tqPickICan: tqPickICan,
    tqMore: tqMore,
    tqToggleBc: tqToggleBc,
    tqToggleBcAll: tqToggleBcAll,
    tqOpenQuestions: tqOpenQuestions,
    tqCloseQuestions: tqCloseQuestions,
    tqSetCard: tqSetCard,
    cardsOn: cardsOn,
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
