/* report-questionnaire.js — the Term Questionnaire's review screen
   (fullvision-generate-plan, PR 11a; the "Review screen" mockup). One
   student at a time: the header with the grade, Work Habits as a radio
   grid, At a Glance (Work and Skills), the student's Voice, the Teacher
   Comment with Generate Comment, and the one-line Attendance card. The
   comment is plain text; Generate drafts it from the bank
   (teacher/comment-bank.js). The class's roster is the app's sidebar, which
   this page marks Needs Approval or ticked. Approve and Next in the toolbar
   saves the comment as approved and opens the next student. */
window.ReportQuestionnaire = (function () {
  'use strict';

  /* ── Parent state injection ──────────────────────────────── */
  var _activeCourse = null;
  var _renderReports = null;
  var _onLastStudent = null;
  var _openEditStudent = null;

  function configure(opts) {
    _activeCourse = opts.activeCourse;
    _renderReports = opts.renderReports;
    if (opts.onLastStudent) _onLastStudent = opts.onLastStudent;
    if (opts.openEditStudent) _openEditStudent = opts.openEditStudent;
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

  /* What FullVision has for the student on screen, read once per drawing
     and again only after something it depends on changes (a habit,
     attendance); typing never re-reads it. */
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
  /* The roster and ↑ ↓ move without approving. */
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

  /* Typing: the box grows with its text, the count follows, and the text is
     saved shortly after the teacher pauses. */
  function tqNarrativeInput() {
    tqNarrativeDirty = true;
    _syncNote();
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(tqSaveNarrative, 600);
  }

  /* The comment grows with its text: no inner scrolling. */
  function _fitBox() {
    var el = _box();
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }
  function _countText(text) {
    return _plural(String(text || '').length, 'character', 'characters');
  }
  function _syncCount() {
    var el = _box();
    var out = document.getElementById('tq-count');
    if (el && out) out.textContent = _countText(el.value);
  }

  /* Copy: the comment as plain text, ready to paste (⌘⇧C too). */
  function tqCopyNarrative() {
    var el = _box();
    var text = el ? el.value : '';
    var btn = document.getElementById('tq-copy-btn');
    if (!text.trim() || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(function () {
      if (!btn) return;
      var label = btn.querySelector('.qn-copy-label');
      if (!label) return;
      label.textContent = 'Copied';
      setTimeout(function () {
        label.textContent = 'Copy';
      }, 1600);
    });
  }

  /* Approve and Next: saves the comment as approved and opens the next
     student (⌘ Return too). On the last student it hands over to the
     parent, as Save and Next did. */
  function tqApproveNext() {
    var st = _current();
    var el = _box();
    if (!st) return;
    var termId = getTermId();
    var rating = getStudentTermRating(_activeCourse, st.id, termId) || {};
    var data = { approvedAt: new Date().toISOString() };
    if (el && el.value.replace(/\s+$/, '') !== plainComment(rating.narrative || '').replace(/\s+$/, '')) {
      data.narrative = el.value.replace(/\s+$/, '');
    }
    clearTimeout(_saveTimer);
    upsertTermRating(_activeCourse, st.id, termId, data);
    tqNarrativeDirty = false;
    _syncStatus();
    tqNextStudent();
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
    _fitBox();
    _syncCount();
    _syncQuotedSoon();
  }

  /* The Ready count and the roster. */
  function _syncStatus() {
    syncRoster();
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
        mark: ok ? '<span class="student-row-mark ok" aria-label="Ready">✓</span>' : '',
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

  /* ── The header ──────────────────────────────────────────── */

  /* The Letter Grades Order word for a letter, as the grade sentence says
     it (the plan's "The target comment", 1). Nothing for IE or F. */
  var STANDING = {
    A: 'Excellent',
    B: 'Very good',
    'C+': 'Good',
    C: 'Satisfactory',
    'C-': 'Minimally acceptable',
  };
  function standingWord(letter) {
    return STANDING[String(letter || '').trim()] || '';
  }

  /* The grade on the right of the header: the big line as the class shows
     it ("B · 82.9%" in a Letter class, the level in a Proficiency class,
     both in a Both class), and under it the standing word (a Letter class)
     or the proficiency word (grades 8–9), with the assignments handed in. */
  function headerGrade(cid, sid, f) {
    var mode = courseGradeMode(cid);
    var b = studentGradeBadges(cid, sid);
    var big = [];
    if (b.prof) big.push(b.prof.text);
    if (b.letter) big.push(mode === 'letter' ? b.letter.grade + ' · ' + b.letter.pct : b.letter.text);
    var standing = mode === 'proficiency' ? levelWord(cid, f.overall) : b.letter ? standingWord(b.letter.grade) : '';
    var rec = f.record || { handed: 0, total: 0 };
    var count = rec.total ? rec.handed + ' of ' + rec.total + ' assignments' : '';
    return {
      big: big.join(' · ') || '—',
      small: [standing, count].filter(Boolean).join(' · '),
    };
  }

  function _headerHtml(cid, student, f) {
    var sid = student.id;
    var first = student.firstName || displayNameFirst(student);
    var g = headerGrade(cid, sid, f);
    var link = `<a role="link" tabindex="0" data-href="/student?id=${esc(sid)}&course=${esc(cid)}" class="qn-head-link" title="${esc(
      'Opens ' + first + '’s Student Dashboard. Its Term Questionnaire button returns here, to the same student.',
    )}">Student Dashboard ›</a>`;
    return `<div class="qn-head">
      <span class="qn-avatar" style="background:${_avatarColor(sid)}" aria-hidden="true">${esc(initials(student))}</span>
      <div class="qn-who">
        <span class="qn-name">${esc(fullName(student))}</span>
        <span class="qn-head-sub">${student.pronouns ? esc(student.pronouns) + ' · ' : ''}${link}</span>
      </div>
      <div class="qn-grade">
        <span class="qn-grade-big">${esc(g.big)}</span>
        <span class="qn-grade-sub">${esc(g.small)}</span>
      </div>
    </div>`;
  }

  /* ── Work Habits ─────────────────────────────────────────── */

  /* The names and hints on the grid, as the mockup words them. */
  var HABIT_LABELS = { ready: 'Comes Ready, Uses Class Time' };
  var SCALE_TIPS = {
    Rarely: 'Rarely: hardly ever this term',
    Sometimes: 'Sometimes: some of the time, not most',
    Usually: 'Usually: most of the time',
    Consistently: 'Consistently: almost every time',
    'Not Seen': 'Not Seen: no chance to see it yet. The comment leaves it out.',
  };

  function _ratedCount(habits) {
    return CommentBank.HABITS.filter(function (h) {
      return habits && habits[h.key] != null;
    }).length;
  }

  function _habitsHtml(cid, f) {
    var stored = (getStudentTermRating(cid, f.sid, getTermId()) || {}).habits || {};
    var head = CommentBank.SCALE.map(function (label) {
      return `<span title="${esc(SCALE_TIPS[label] || label)}">${esc(label)}</span>`;
    }).join('');
    var rows = CommentBank.HABITS.map(function (h) {
      var v = stored[h.key];
      var name = HABIT_LABELS[h.key] || h.name;
      var opts = CommentBank.SCALE.map(function (label, i) {
        var val = i + 1;
        var on = v === val;
        return `<span class="qn-habit-cell"><button type="button" role="radio" aria-checked="${on}" class="qn-radio${on ? ' on' : ''}" data-action="tqRate" data-habit="${h.key}" data-value="${val}" aria-label="${esc(name + ': ' + label)}" title="${esc(SCALE_TIPS[label] || label)}"></button></span>`;
      }).join('');
      return `<div class="qn-habit-row" role="radiogroup" aria-label="${esc(name)}">
        <span class="qn-habit-name" title="${esc(h.hint)}">${esc(name)}</span>${opts}
      </div>`;
    }).join('');
    return `<div class="qn-card qn-habits">
      <div class="qn-card-top"><span class="qn-card-title">Work Habits</span><span class="qn-sub" id="tq-rated">${_ratedCount(stored)} of 6 rated</span></div>
      <div class="qn-habit-head"><span></span>${head}</div>
      ${rows}
    </div>`;
  }

  /* A habit picked on the grid: saved with the others (the whole map); the
     grid and the count change in place, nothing else redraws. */
  function tqRate(key, value) {
    var st = _current();
    if (!st) return;
    tqSaveCurrentIfNeeded();
    var termId = getTermId();
    var habits = Object.assign({}, (getStudentTermRating(_activeCourse, st.id, termId) || {}).habits || {});
    habits[key] = Number(value);
    upsertTermRating(_activeCourse, st.id, termId, { habits: habits });
    document.querySelectorAll('.qn-radio[data-habit="' + key + '"]').forEach(function (b) {
      var on = Number(b.dataset.value) === Number(value);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    var rated = document.getElementById('tq-rated');
    if (rated) rated.textContent = _ratedCount(habits) + ' of 6 rated';
    _facts(st, true);
  }

  /* ── At a Glance ─────────────────────────────────────────── */

  /* Under the best piece, when it has no Note for the Report: Add one
     opens the grader on that piece for this student. */
  function _reportNoteNudge(best) {
    if (!best || !best.id || String(best.note || '').trim()) return '';
    return `<span class="qn-muted qn-note-nudge">No note for the report yet · <button type="button" class="qn-card-link qn-note-add" data-action="tqAddReportNote" data-aid="${esc(best.id)}" title="Opens the grader on this piece. Write one line about what the student did, for the comment.">Add one</button></span>`;
  }

  /* Add one: the grader on the best piece, this student only. Closing it
     reads the facts again, so the note shows in the comment's sentence. */
  function tqAddReportNote(aid) {
    var st = _current();
    if (!st || !aid || !window.PageAssignments || !PageAssignments.openGrader) return;
    PageAssignments.openGrader(_activeCourse, aid, st.id, {
      studentIds: [st.id],
      onClose: function () {
        _facts(st, true);
        rerender();
      },
    });
  }

  /* The highest-marked piece this term; the latest when two tie. */
  function bestPiece(work) {
    var best = null;
    (work || []).forEach(function (w) {
      if (!best || w.v > best.v || (w.v === best.v && String(w.d) > String(best.d))) best = w;
    });
    return best;
  }

  /* Work labelled Missing this term (status NS), whatever its due date:
     the one rule everywhere (Decision 4; facts().notHandedIn counts the
     same work). */
  function notHandedIn(cid, sid) {
    return (getAssessments(cid) || [])
      .filter(function (a) {
        return assessmentInActiveTerm(cid, a) && assessmentCellValue(cid, sid, a).status === 'NS';
      })
      .map(function (a) {
        return a.title || '';
      });
  }

  /* Strongest: every competency at the highest level; Next step: the
     lowest, when it is below the highest. */
  function skillTags(comps) {
    var list = (comps || []).filter(function (c) {
      return c.level > 0;
    });
    if (list.length < 2) return {};
    var max = Math.max.apply(
      null,
      list.map(function (c) {
        return c.level;
      }),
    );
    var min = Math.min.apply(
      null,
      list.map(function (c) {
        return c.level;
      }),
    );
    var out = {};
    if (max === min) return out;
    list.forEach(function (c) {
      if (c.level === max) out[c.id] = 'Strongest';
    });
    var low = list.find(function (c) {
      return c.level === min;
    });
    if (low) out[low.id] = 'Next step';
    return out;
  }

  function _glanceHtml(cid, student, f) {
    var best = bestPiece(f.work);
    var missing = notHandedIn(cid, student.id);
    var tags = skillTags(f.comps);
    var skills = f.comps
      .map(function (c) {
        var tag = tags[c.id];
        return `<div class="qn-skill">
          <span class="qn-skill-name">${esc(c.name)}</span>
          ${tag ? `<span class="qn-tag${tag === 'Strongest' ? ' strongest' : ''}">${tag}</span>` : ''}
          <span class="qn-level" data-level="${Math.max(1, Math.min(4, Math.round(c.level)))}">${esc(f.levelText(c.level))}</span>
        </div>`;
      })
      .join('');
    return `<div class="qn-card qn-glance">
      <div class="qn-card-top"><span class="qn-card-title">At a Glance</span></div>
      <div class="qn-band">Work</div>
      <div class="qn-fact qn-best">
        <span class="qn-fact-label">Best piece</span>
        <div class="qn-fact-body">${best ? `<span>${esc(best.title)} · ${esc(formatLevel(cid, best.v))}</span>${_reportNoteNudge(best)}` : '<span class="qn-muted">No marked work this term yet</span>'}</div>
      </div>
      <div class="qn-fact">
        <span class="qn-fact-label">Not handed in</span>
        <div class="qn-fact-body">${
          missing.length
            ? missing
                .map(function (t) {
                  return `<span>${esc(t)}</span>`;
                })
                .join('')
            : '<span class="qn-muted">None this term</span>'
        }</div>
        ${missing.length ? `<span class="qn-count">${missing.length}</span>` : ''}
      </div>
      <div class="qn-band">Skills</div>
      ${skills || '<div class="qn-fact"><span class="qn-muted">No scores this term yet</span></div>'}
    </div>`;
  }

  /* ── The student's Voice ─────────────────────────────────── */

  function _answer(it) {
    return it && it.v && it.v.text ? String(it.v.text).trim() : '';
  }

  /* The rows: the goal from the Goal Check-In, then the About Me answers
     with the mockup's labels; the "To you only" answer is marked Private.
     An answer the comment quotes is marked "In the comment". */
  function voiceRows(f) {
    var prof = f.voice && f.voice.profile;
    var about = prof && prof.about;
    var ck = prof && prof.checkin;
    var rows = [];
    var goal = ck ? _answer(ck.coreGoal) : '';
    rows.push({
      label: 'Goal',
      text: goal ? '“' + goal.replace(/[“”"]/g, '') + '”' + (f.voice.goalStatus ? ' · ' + f.voice.goalStatus : '') : '',
      empty: 'Not set yet',
    });
    var add = function (label, it, extra) {
      var a = _answer(it);
      if (!a) return;
      rows.push(Object.assign({ label: label, text: a, quote: true }, extra || {}));
    };
    add('Good at', about && about.goodAt);
    add('Hard right now', about && about.hard);
    add('Wants to get better at', about && about.goal);
    add('Learns best', about && about.learns, { quote: false });
    add('To you only', about && about.note, { quote: false, priv: true });
    return rows;
  }

  function _voiceHtml(cid, student, f, comment) {
    var first = student.firstName || displayNameFirst(student);
    var rows = voiceRows(f)
      .map(function (r) {
        var quoted = r.quote && r.text && _quotes(comment, r.text);
        var chip = r.priv
          ? '<span class="qn-chip-private" title="Only you see this. It is never printed and never used in the comment.">Private</span>'
          : r.quote
            ? `<span class="qn-chip-quoted" data-answer="${esc(r.text)}" title="Generate can quote this in the comment."${quoted ? '' : ' hidden'}>In the comment</span>`
            : '';
        return `<div class="qn-voice-row">
          <span class="qn-fact-label">${esc(r.label)}</span>
          <span class="qn-voice-text${r.text ? '' : ' qn-muted'}">${esc(r.text || r.empty)}</span>
          ${chip}
        </div>`;
      })
      .join('');
    return `<div class="qn-card qn-voice">
      <div class="qn-card-top">
        <span class="qn-card-title">${esc(first)}’s Voice</span>
        <a role="link" tabindex="0" data-href="/dashboard?course=${esc(cid)}&manage=questionnaires" class="qn-card-link" title="Opens this class’s Questionnaires in Class Management, where you choose and send the questions students answer.">Questionnaires ›</a>
      </div>
      ${rows}
    </div>`;
  }

  /* Whether the comment quotes an answer (its words, without a closing
     full stop). */
  function _quotes(comment, text) {
    var t = String(text || '')
      .replace(/[“”"]/g, '')
      .replace(/[.\s]+$/, '');
    return !!t && String(comment || '').indexOf(t) >= 0;
  }

  /* After the comment changes: which answers it quotes. */
  function _syncQuoted() {
    var el = _box();
    if (!el) return;
    var comment = el.value;
    document.querySelectorAll('.qn-chip-quoted[data-answer]').forEach(function (chip) {
      chip.hidden = !_quotes(comment, chip.dataset.answer);
    });
  }

  /* ── Attendance ──────────────────────────────────────────── */

  /* The report a term id names, as the report picker shows it. */
  function _reportLabel(termId) {
    var sel = document.getElementById('report-period');
    var n = String(termId || '').match(/(\d+)$/);
    var opt = sel && n ? Array.prototype.find.call(sel.options, o => o.value === 'Report ' + n[1]) : null;
    return opt ? opt.text : n ? 'Report ' + n[1] : '';
  }

  /* The line at the right of the card: the change since the last report
     with its totals, a warning when a total is lower than that report's
     (totals are to date), or the mockup's note until something is
     entered. */
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
      )} report. Enter the total to date.</span>`;
    }
    var prevTerm = att.absencesPrevTerm || att.latesPrevTerm;
    var entered = att.absences != null || att.lates != null;
    if (!prevTerm) {
      return entered
        ? 'No earlier report has attendance, so these are this term’s totals too.'
        : 'Optional. Left out until entered.';
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

  function _attendanceHtml(cid, student) {
    var sid = student.id;
    var att = getTermAttendance(cid, sid, getTermId());
    var warn = function (k, p) {
      return att[k] != null && att[p] != null && att[k] < att[p] ? ' warn' : '';
    };
    return `<div class="qn-card qn-att">
      <span class="qn-att-title">Attendance</span>
      <label class="qn-att-field">Classes Absent<input type="number" min="0" step="1" inputmode="numeric" class="qn-att-input${warn('absences', 'prevAbsences')}" id="tq-att-absences" data-tq-att="absences" data-sid="${sid}" aria-label="Classes Absent" title="Classes absent so far this year, as a total to date. Optional." value="${att.absences == null ? '' : att.absences}"></label>
      <label class="qn-att-field">Times Late<input type="number" min="0" step="1" inputmode="numeric" class="qn-att-input${warn('lates', 'prevLates')}" id="tq-att-lates" data-tq-att="lates" data-sid="${sid}" aria-label="Times Late" title="Times late so far this year, as a total to date. Optional." value="${att.lates == null ? '' : att.lates}"></label>
      <span class="qn-att-note" id="tq-att-note" aria-live="polite">${_attendanceNoteHtml(att)}</span>
    </div>`;
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
    if (note) note.innerHTML = _attendanceNoteHtml(att);
    abs.classList.toggle('warn', att.absences != null && att.prevAbsences != null && att.absences < att.prevAbsences);
    late.classList.toggle('warn', att.lates != null && att.prevLates != null && att.lates < att.prevLates);
    var st = _current();
    if (st) _facts(st, true);
  }

  /* ── The class's report form ───────────────────────────── */

  function _form(cid) {
    return ReportSheets.formFor((typeof getReportConfig === 'function' && getReportConfig(cid)) || {});
  }
  function _blockLabel(id) {
    var b = ReportSheets.BLOCKS[id];
    return b ? b.label : id;
  }

  /* ── Where This Information Comes From ───────────────────── */

  var SCREEN_SOURCES = [
    ['Grade', 'Your gradebook: this term’s marks, with your category weights.', 'FullVision'],
    ['Work Habits', 'Your six ratings, Rarely to Consistently.', 'You'],
    ['Best Piece', 'The highest-marked assignment this term.', 'FullVision'],
    ['Not Handed In', 'Assignments labelled Missing.', 'FullVision'],
    ['Skills', 'This term’s competency scores.', 'FullVision'],
    ['Goal and Voice', 'Answers to About Me and the goal check-in, sent from the student’s phone.', 'Student'],
    [
      'Attendance',
      'Classes absent and times late, typed in by you. Optional; left out of the comment until entered.',
      'You',
    ],
    [
      'Teacher Comment',
      'Written by Generate from everything above and your class settings. You edit and approve it.',
      'You',
    ],
  ];

  /* Where each block on the class's form gets its content. */
  function _blockSource(cid, id) {
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
      header: ['Nothing to fill in. Comes from Class Settings.', 'FullVision'],
      proficiency: ['Nothing to fill in. Comes from scores.', 'FullVision'],
      legend: ['Nothing to fill in. Same for everyone.', 'FullVision'],
      'competency-table': ['Nothing to fill in. Comes from scores.', 'FullVision'],
      'grade-table': ['Nothing to fill in. Comes from scores.', 'FullVision'],
      'missing-work': ['Nothing to fill in. Comes from assignments.', 'FullVision'],
      'teacher-narrative': [SCREEN_SOURCES[7][1], 'You'],
      'term-attendance': [SCREEN_SOURCES[6][1], 'You'],
      'learner-dimensions': [SCREEN_SOURCES[1][1], 'You'],
      'next-steps': ['The Focus Area: the competency that changed most this term.', 'FullVision'],
      progress: ['The Focus Area: the competency that changed most this term.', 'FullVision'],
      'support-home': [
        'The Focus Area: the competency that changed most this term. The work comes from scores.',
        'FullVision',
      ],
      'self-assessment': [
        (phones.length ? CommentBank.list(phones) : 'The reflection and Goal Check-In') + ', on phones.',
        'Student',
      ],
      'student-reflection-learning': ['Nothing to fill in. The student writes on the printed page.', 'Student'],
      'student-reflection-habits': ['Nothing to fill in. The student writes on the printed page.', 'Student'],
      'parent-response': ['Nothing to fill in. The family writes it.', 'Family'],
      'text-block': ['Nothing to fill in. Your text on the form, in Progress Reports.', 'You'],
    };
    return map[id] || ['Nothing to fill in. Comes from FullVision.', 'FullVision'];
  }

  function _whoChip(who) {
    return `<span class="qn-info-who who-${who.toLowerCase()}">${esc(who)}</span>`;
  }
  function _sourceRow(part, from, who) {
    return `<div class="qn-info-row"><span class="qn-info-part">${esc(part)}</span><span class="qn-info-from">${esc(from)}</span>${_whoChip(who)}</div>`;
  }

  var INFO_ID = 'tq-info-overlay';
  function _infoHtml(cid) {
    var form = _form(cid);
    var on = ReportSheets.onForm(form);
    var course = (typeof COURSES !== 'undefined' && COURSES[cid] && COURSES[cid].name) || '';
    var report = _reportLabel(getTermId());
    var screen = SCREEN_SOURCES.map(function (r) {
      return _sourceRow(r[0], r[1], r[2]);
    }).join('');
    var blocks = on
      .map(function (id) {
        var s = _blockSource(cid, id);
        return _sourceRow(_blockLabel(id), s[0], s[1]);
      })
      .join('');
    var off = Object.keys(ReportSheets.BLOCKS)
      .filter(function (id) {
        var b = ReportSheets.BLOCKS[id];
        return !b.retired && on.indexOf(id) < 0 && id !== 'header';
      })
      .map(_blockLabel);
    return `<div class="qn-info" role="document">
      <div class="qn-info-top"><span class="qn-info-title" id="tq-info-title">Where This Information Comes From</span><button type="button" class="qn-btn" data-action="tqCloseInfo">Done</button></div>
      <span class="qn-info-label">On This Screen</span>
      <div class="qn-info-card">${screen}</div>
      <span class="qn-info-label">On ${esc(course)}’s ${esc(report)}</span>
      <div class="qn-info-card">
        ${blocks}
        ${
          off.length
            ? `<div class="qn-info-off"><span class="qn-info-off-title">Not on this report</span><span>${esc(off.join(' · '))}</span><span>Add them in Progress Reports.</span></div>`
            : ''
        }
      </div>
      <div class="qn-info-card qn-info-never"><span class="qn-info-part">Never printed</span><span class="qn-info-from">Student Voice answers marked Private.</span></div>
    </div>`;
  }

  function tqOpenInfo() {
    tqCloseInfo();
    var overlay = document.createElement('div');
    overlay.id = INFO_ID;
    overlay.className = 'confirm-overlay qn-info-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'tq-info-title');
    overlay.innerHTML = _infoHtml(_activeCourse);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) tqCloseInfo();
    });
    document.body.appendChild(overlay);
    var done = overlay.querySelector('[data-action="tqCloseInfo"]');
    if (done) done.focus();
  }
  function tqCloseInfo() {
    var o = document.getElementById(INFO_ID);
    if (!o) return;
    o.remove();
    var b = document.getElementById('tq-info-btn');
    if (b) b.focus();
  }

  /* The Edit Student icon: the Student Dashboard's own dialog, for the
     student on screen. */
  function tqEditStudent() {
    var st = _current();
    if (!st || !_openEditStudent) return;
    tqSaveCurrentIfNeeded();
    _openEditStudent(_activeCourse, st.id);
  }

  /* ── The Teacher Comment ─────────────────────────────────── */

  /* Classmates' comments this report, for the bank's least-used order. */
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
    return CommentBank.context(f, {
      habits: rating.habits || {},
      focus: rating.focusSectionId || f.focusId,
    });
  }

  /* Generate Comment: a draft from the bank, filled in for the student, in
     the box in place of what was there (typed in, so ⌘ Z brings the old
     text back). Each press gives another version; the student's own seed
     keeps the first draft the same between visits. */
  var _generated = {};
  function tqGenerate() {
    var st = _current();
    var el = _box();
    if (!st || !el) return;
    var termId = getTermId();
    var f = _facts(st, true);
    var n = (_generated[st.id] || 0) + 1;
    _generated[st.id] = n;
    var d = CommentBank.draft(_bankContext(_activeCourse, st, f), {
      seed: CommentBank.seedFor(st.id + '|' + termId) + n,
      comments: _classmateComments(_activeCourse, st.id, termId),
      // Each press gives another version: never the text already in the box.
      previous: el.value,
    });
    if (!d.text) return;
    el.focus();
    el.select();
    var ok = false;
    try {
      ok = document.execCommand('insertText', false, d.text);
    } catch (e) {
      ok = false;
    }
    if (!ok || el.value !== d.text) el.value = d.text;
    tqNarrativeDirty = true;
    tqSaveNarrative();
    _syncNote();
  }

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

  var COPY_ICON =
    '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="4" y="4" width="7.5" height="7.5" rx="1.5"></rect><path d="M8.5 4 V2.5 A1 1 0 0 0 7.5 1.5 H2.5 A1 1 0 0 0 1.5 2.5 V7.5 A1 1 0 0 0 2.5 8.5 H4"></path></svg>';

  function _commentHtml(cid, student) {
    var sid = student.id;
    var termId = getTermId();
    var rating = getStudentTermRating(cid, sid, termId) || {};
    var text = plainComment(rating.narrative || '');
    var earlier = _earlierReports(cid, sid, termId);
    if (_commentTab !== 'this' && earlier.indexOf(_commentTab) < 0) _commentTab = 'this';
    var thisTab = _commentTab === 'this';
    var tabs = earlier.length
      ? `<div class="seg seg-sm qn-comment-tabs" role="group" aria-label="Report">${[['this', 'This Report']]
          .concat(
            earlier.map(function (k) {
              return [k, _reportLabel(k)];
            }),
          )
          .map(function (t) {
            var pressed = _commentTab === t[0];
            return `<button type="button" class="seg-btn${pressed ? ' active' : ''}" data-action="tqCommentTab" data-tab="${esc(t[0])}" aria-pressed="${pressed}">${esc(t[1])}</button>`;
          })
          .join('')}</div>`
      : '';
    var body;
    if (thisTab) {
      body = `<textarea id="tq-narrative" class="qn-text" rows="1" spellcheck="true" aria-label="Teacher Comment" data-cid="${esc(cid)}" data-sid="${esc(sid)}" data-term="${esc(termId)}">${esc(text)}</textarea>
        <div class="qn-comment-foot">
          <span class="qn-count-text" id="tq-count">${esc(_countText(text))}</span>
          <button type="button" class="qn-copy" data-action="tqCopyNarrative" id="tq-copy-btn" title="Copies the comment as plain text, ready to paste. ⌘⇧C">${COPY_ICON}<span class="qn-copy-label">Copy</span></button>
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
    return `<div class="qn-comment" id="tq-comment-card">
        <div class="qn-comment-top">
          <span class="qn-comment-title">Teacher Comment</span>
          ${tabs}
          ${thisTab ? '<button type="button" class="qn-generate" data-action="tqGenerate" id="tq-generate" title="Writes the comment from the gradebook, your ratings and Student Voice. Press again for another version. Sentences you edited and your order stay.">Generate Comment</button>' : ''}
        </div>
        ${body}
      </div>`;
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
    var f = _facts(student, true);
    var comment = plainComment((getStudentTermRating(cid, student.id, getTermId()) || {}).narrative || '');
    return `<div class="qn" data-sid="${student.id}">
      <div class="qn-left">
        ${_headerHtml(cid, student, f)}
        ${_habitsHtml(cid, f)}
        ${_glanceHtml(cid, student, f)}
        ${_voiceHtml(cid, student, f, comment)}
      </div>
      <div class="qn-right">
        ${_commentHtml(cid, student)}
        ${_attendanceHtml(cid, student)}
        <!-- The Sentences card (PR 11b) goes here. -->
      </div>
    </div>`;
  }

  /* After the page is drawn: the roster and the box's height. */
  function afterRender() {
    syncRoster();
    _fitBox();
  }

  /* ⌘ Return approves and moves on; ⌘⇧C copies; ↑ ↓ change the student
     outside a text field (the sidebar handles them while it has the
     focus); Escape closes the sheet. */
  function handleKey(e) {
    // The grader opened from At a Glance keeps its own keys.
    if (window.PageAssignments && PageAssignments.graderOpen && PageAssignments.graderOpen()) return;
    if (e.key === 'Escape') {
      if (document.getElementById(INFO_ID)) tqCloseInfo();
      return;
    }
    if (document.getElementById(INFO_ID)) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      tqApproveNext();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      tqCopyNarrative();
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
    tqApproveNext: tqApproveNext,
    tqSaveCurrentIfNeeded: tqSaveCurrentIfNeeded,
    tqSaveNarrative: tqSaveNarrative,
    tqNarrativeInput: tqNarrativeInput,
    tqCopyNarrative: tqCopyNarrative,
    tqCommentTab: tqCommentTab,
    tqRosterFilter: tqRosterFilter,
    tqGenerate: tqGenerate,
    tqRate: tqRate,
    tqOpenInfo: tqOpenInfo,
    tqCloseInfo: tqCloseInfo,
    tqEditStudent: tqEditStudent,
    tqSetAttendance: tqSetAttendance,
    tqAddReportNote: tqAddReportNote,
    tqSelectStudent: tqSelectStudent,
    renderTermQuestionnaire: renderTermQuestionnaire,
    afterRender: afterRender,
    fitBox: _fitBox,
    syncRoster: syncRoster,
    restoreRoster: restoreRoster,
    handleKey: handleKey,
    plainComment: plainComment,
    standingWord: standingWord,
    headerGrade: headerGrade,
    bestPiece: bestPiece,
    notHandedIn: notHandedIn,
    skillTags: skillTags,
    voiceRows: voiceRows,
    SCREEN_SOURCES: SCREEN_SOURCES,
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
