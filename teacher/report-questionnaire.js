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
    var btn = document.getElementById('tq-count-btn');
    if (el && btn) btn.classList.toggle('over', _overLimit(el.value));
    syncApprove();
  }

  /* ── The character limit (plan PR 8) ─────────────────────── */

  /* The class's character limit, or null for no limit. */
  function _limit() {
    return CommentBank.classSettings(_activeCourse).charLimit;
  }
  function _overLimit(text) {
    var lim = _limit();
    return !!lim && String(text || '').length > lim;
  }
  /* "· no limit" or "· limit 1000" after the count. */
  function _limitText() {
    var lim = _limit();
    return lim ? ' · limit ' + lim : ' · no limit';
  }
  var _limitOpen = false;
  /* The count as a button that opens the limit, and the limit's popover. */
  function _countHtml(cid, text) {
    var course = _courseName(cid);
    var pop = _limitOpen
      ? `<div class="qn-limit" role="dialog" aria-label="Character limit" id="tq-limit">
          <label class="qn-limit-field">Character limit for ${esc(course)}<input type="number" min="1" step="1" inputmode="numeric" placeholder="No limit" aria-label="Character limit" data-tq-limit="1" id="tq-limit-input" title="Leave it empty for no limit." value="${_limit() || ''}"></label>
          <span class="qn-limit-hint">The longest comment your school’s report card allows. Approve stays off past it.</span>
        </div>`
      : '';
    return `<span class="qn-count-wrap"><button type="button" class="qn-count-btn${_overLimit(text) ? ' over' : ''}" id="tq-count-btn" data-action="tqLine" data-do="limitMenu" aria-haspopup="dialog" aria-expanded="${_limitOpen}" title="The comment’s length. Click to set the longest comment ${esc(course)} allows."><span class="qn-count-text" id="tq-count">${esc(_countText(text))}</span><span id="tq-limit-text">${esc(_limitText())}</span> ▾</button>${pop}</span>`;
  }
  /* A limit typed: saved for the class (empty: no limit). */
  function _setLimit(value) {
    var n = Math.floor(Number(value));
    _saveSettings({ charLimit: value !== '' && n > 0 ? n : null });
    var t = document.getElementById('tq-limit-text');
    if (t) t.textContent = _limitText();
    _syncCount();
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
    if (approveBlockers(st).length) {
      syncApprove();
      return;
    }
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
     or the proficiency word (grades 8–9), with the assignments handed in.
     With the report's term id, a reporting basis the teacher chose shows as
     the report prints it: "IE" over "Insufficient Evidence", or "No Letter
     Grade" over "Assessed on language goals" (calc.js). An IE from calc.js
     says Insufficient Evidence under it too. */
  function headerGrade(cid, sid, f, termId) {
    var mode = courseGradeMode(cid);
    var b = studentGradeBadges(cid, sid, termId);
    var big = [];
    if (b.prof) big.push(b.prof.text);
    var basis = b.letter && b.letter.basis;
    if (b.letter) big.push(basis || mode !== 'letter' ? b.letter.text : b.letter.grade + ' · ' + b.letter.pct);
    if (basis) return { big: big.join(' · '), small: REPORTING_BASIS_NOTE[basis] };
    if (b.letter && b.letter.grade === 'IE') return { big: big.join(' · '), small: REPORTING_BASIS_NOTE.ie };
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
    var g = headerGrade(cid, sid, f, getTermId());
    // The designations that offer language or IEP goals, as the goals mockup
    // shows them beside the pronouns.
    var des = CommentBank.goalsOffered(f).map(function (b) {
      return b === 'language_goals' ? 'ELL' : 'IEP';
    });
    var link = `<a role="link" tabindex="0" data-href="/student?id=${esc(sid)}&course=${esc(cid)}" class="qn-head-link" title="${esc(
      'Opens ' + first + '’s Student Dashboard. Its Term Questionnaire button returns here, to the same student.',
    )}">Student Dashboard ›</a>`;
    return `<div class="qn-head">
      <span class="qn-avatar" style="background:${_avatarColor(sid)}" aria-hidden="true">${esc(initials(student))}</span>
      <div class="qn-who">
        <span class="qn-name">${esc(fullName(student))}</span>
        <span class="qn-head-sub">${student.pronouns ? esc(student.pronouns) + ' · ' : ''}${des.map(d => esc(d) + ' · ').join('')}${link}</span>
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
     grid, the count and the comment's habits sentence change in place,
     nothing else redraws. */
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
    _redrawHabits(st);
  }

  /* After a rating: the comment's habits sentence written again for the new
     ratings (plan PR 7), when Generate wrote this comment and the teacher
     has not edited that sentence or approved the comment. The rest of the
     comment stays as it is. A comment with no habits sentence gets one only
     while it is exactly as Generate wrote it. */
  function _redrawHabits(st) {
    var termId = getTermId();
    var key = _activeCourse + '|' + st.id + '|' + termId;
    var last = _lastDraft[key];
    var el = _box();
    if (!last || !el || String(el.dataset.sid) !== String(st.id) || _approved(st.id)) return;
    var d = CommentBank.redrawHabits(_bankContext(_activeCourse, st, _facts(st)), last, {
      comments: _classmateComments(_activeCourse, st.id, termId),
      exclude: [],
    });
    if (!d) return;
    var text = el.value;
    var before = d.habits.before;
    var after = d.habits.after;
    var next;
    if (text.trim() === last.text.trim()) next = d.text;
    else if (before && text.indexOf(before) >= 0) next = _swapSentence(text, before, after);
    else return;
    _lastDraft[key] = d;
    if (next === text) return;
    el.value = next;
    tqNarrativeDirty = true;
    tqSaveNarrative();
    _syncNote();
  }

  /* One sentence of the comment in place of another; with none, the old one
     and a space beside it taken out. */
  function _swapSentence(text, before, after) {
    if (after) return text.replace(before, after);
    if (text.indexOf(before + ' ') >= 0) return text.replace(before + ' ', '');
    if (text.indexOf(' ' + before) >= 0) return text.replace(' ' + before, '');
    return text.replace(before, '');
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

  /* Strongest: the competencies past the comment's "strongest" evidence
     gate (CommentBank.strongestOf), so the tag and the comment agree; Next
     step: the competency the comment's next step names
     (CommentBank.nextStepOf), the lowest with 3+ scored pieces. */
  function skillTags(comps) {
    var list = (comps || []).filter(function (c) {
      return c.level > 0;
    });
    var out = {};
    CommentBank.strongestOf(list).forEach(function (c) {
      out[c.id] = 'Strongest';
    });
    var low = CommentBank.nextStepOf(list);
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

  /* Classmates' comments this report as { sid, text }, for the bank's
     least-used order (CommentBank.classUsage). */
  function _classmateComments(cid, sid, termId) {
    var all = getTermRatings(cid) || {};
    return Object.keys(all)
      .filter(function (k) {
        return k !== sid && all[k] && all[k][termId] && all[k][termId].narrative;
      })
      .map(function (k) {
        return { sid: k, text: plainComment(all[k][termId].narrative) };
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
  // The last draft Generate wrote per student and report (as draft() gives
  // it), so choosing IE or goals can redraw a draft the teacher has not
  // edited, and a habit rating can redraw its habits sentence.
  var _lastDraft = {};
  // And the seed it was drafted with, so a class line's change can draft it
  // again with only that line different.
  var _lastSeed = {};
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
      // Last term's approved sentences are left out once each approval
      // stores its sentence ids (draft_meta); none are stored yet.
      exclude: [],
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
    _lastDraft[_activeCourse + '|' + st.id + '|' + termId] = d;
    _lastSeed[_activeCourse + '|' + st.id + '|' + termId] = d.seed;
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
          ${_countHtml(cid, text)}
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
        ${thisTab ? _basisHtml(cid, student, _facts(student)) : ''}
        ${body}
      </div>`;
  }

  function tqCommentTab(tab) {
    tqSaveCurrentIfNeeded();
    _commentTab = tab || 'this';
    rerender();
  }

  /* ── IE, language goals and IEP goals (plan PR 3) ────────── */

  /* What the Teacher Comment card's switch offers: { ie, goals, basis }.
     IE when the student has marks on fewer than half the class's marked
     work (CommentBank.ieOffered), unless calc.js already reports IE (that
     path needs no switch); Language Goals for an ELL designation and IEP
     Goals for an IEP; a stored choice always stays on offer so it can be
     undone. Nothing in a Proficiency class. */
  function basisChoices(f) {
    var g = f.grade || {};
    var basis = g.basis || 'grade';
    var ie = basis === 'ie' || (CommentBank.ieOffered(f) && g.letter !== 'IE');
    var goals = CommentBank.goalsOffered(f);
    if ((basis === 'language_goals' || basis === 'iep_goals') && goals.indexOf(basis) < 0) goals = goals.concat(basis);
    return { ie: ie, goals: goals, basis: basis };
  }

  var BASIS_LABEL = { grade: 'Letter Grade', ie: 'IE', language_goals: 'Language Goals', iep_goals: 'IEP Goals' };
  var BASIS_TIP = {
    ie: 'Report IE. The comment then must give the problem, a plan, a deadline and a chance to meet.',
    language_goals: 'No letter grade. The comment must say the student is assessed against language goals.',
    iep_goals: 'No letter grade. The comment must say the student is assessed against the goals in the IEP.',
  };

  /* The line beside the switch, per choice on offer, in plain sentences. */
  function _basisLines(student, f, c) {
    var first = student.firstName || displayNameFirst(student);
    var p = ReportBlocks.getPronouns(student);
    var m = (f.grade && f.grade.marked) || { mine: 0, all: 0 };
    var they = p.subj === 'they';
    var lines = [];
    if (c.ie)
      lines.push(
        'Only ' +
          m.mine +
          ' of ' +
          m.all +
          ' assignments are marked. You can report IE (Insufficient Evidence) instead of a letter grade.',
      );
    if (c.goals.indexOf('language_goals') >= 0)
      lines.push(
        first +
          ' has an ELL designation. If ' +
          p.poss +
          ' English level keeps ' +
          p.obj +
          ' from showing the learning, assess ' +
          p.obj +
          ' against ' +
          p.poss +
          ' language goals instead of a letter grade.',
      );
    if (c.goals.indexOf('iep_goals') >= 0)
      lines.push(
        first +
          ' has an IEP. If ' +
          p.subj +
          (they ? ' are' : ' is') +
          ' working on the goals in ' +
          p.poss +
          ' IEP instead of the course, assess ' +
          p.obj +
          ' against those goals instead of a letter grade.',
      );
    return lines;
  }

  /* The switch at the top of the Teacher Comment card: "Letter Grade | IE",
     "Letter Grade | Language Goals" or "Letter Grade | IEP Goals" (one
     group when more than one is on offer). Letter Grade is the default. */
  function _basisHtml(cid, student, f) {
    var c = basisChoices(f);
    var opts = ['grade'];
    if (c.ie) opts.push('ie');
    opts = opts.concat(c.goals);
    if (opts.length < 2) return '';
    var lg = getCourseLetterData(cid, student.id);
    var m = (f.grade && f.grade.marked) || { mine: 0 };
    var letterTip =
      c.ie && lg && lg.S && lg.R != null
        ? 'Report ' + lg.S + ' ' + lg.R + '% from the ' + m.mine + ' marked assignments.'
        : 'Report a letter grade, as for every other student.';
    var btns = opts
      .map(function (b) {
        var on = c.basis === b;
        return `<button type="button" role="radio" class="seg-btn" aria-checked="${on}" data-action="tqSetBasis" data-basis="${b}" title="${esc(b === 'grade' ? letterTip : BASIS_TIP[b])}">${esc(BASIS_LABEL[b])}</button>`;
      })
      .join('');
    var lines = _basisLines(student, f, c)
      .map(function (t) {
        return `<span>${esc(t)}</span>`;
      })
      .join('');
    return `<div class="qn-basis" id="tq-basis">
      <span class="qn-basis-text">${lines}</span>
      <div class="seg seg-sm qn-basis-seg" role="radiogroup" aria-label="${c.ie ? 'Report this term as' : 'Assess this student against'}">${btns}</div>
    </div>`;
  }

  /* A choice on the switch: saved with the deadline for this report (the
     report and gradebook read it), then the screen redraws. A comment
     Generate wrote and the teacher has not edited is written again for the
     new path; an edited one is left as it is. */
  function tqSetBasis(basis) {
    var st = _current();
    if (!st || !BASIS_LABEL[basis]) return;
    tqSaveCurrentIfNeeded();
    var termId = getTermId();
    var rating = getStudentTermRating(_activeCourse, st.id, termId) || {};
    if ((rating.reportingBasis || 'grade') === basis) return;
    var text = plainComment(rating.narrative || '').trim();
    var last = _lastDraft[_activeCourse + '|' + st.id + '|' + termId];
    var redraft = !!text && !!last && text === last.text.trim();
    upsertTermRating(_activeCourse, st.id, termId, { reportingBasis: basis, ieDeadline: rating.ieDeadline || null });
    _cal = null;
    _facts(st, true);
    rerender();
    if (redraft) tqGenerate();
  }

  /* ── Checks before approving ─────────────────────────────── */

  /* Rows the teacher ticks "I checked this" on before Approve and Next
     (plan PR 3; PR 11c adds the general checks). Only the missing-work row
     of an IE comment for now. Ticks last for this session. */
  var _checked = {};
  function _checkKey(sid, id) {
    return _activeCourse + '|' + sid + '|' + getTermId() + '|' + id;
  }
  function _checksFor(f) {
    return CommentBank.ieProblemOf(f) === 'missing' ? ['missing'] : [];
  }
  function tqSetCheck(id, on) {
    var st = _current();
    if (!st) return;
    _checked[_checkKey(st.id, id)] = !!on;
    syncApprove();
  }

  /* What keeps Approve and Next off for the student on screen: 'deadline'
     until an IE's deadline is picked, and each check not yet ticked. */
  function approveBlockers(st) {
    if (!st) return [];
    var f = _facts(st);
    var out = [];
    if (CommentBank.reportPath(f) === 'ie') {
      if (!f.grade.ieDeadline) out.push('deadline');
      _checksFor(f).forEach(function (id) {
        if (!_checked[_checkKey(st.id, id)]) out.push(id);
      });
    }
    // Past the class's character limit (plan PR 8).
    var el = _box();
    var text =
      el && el.dataset.sid === String(st.id)
        ? el.value
        : plainComment((getStudentTermRating(_activeCourse, st.id, getTermId()) || {}).narrative || '');
    if (_overLimit(text.replace(/\s+$/, ''))) out.push('limit');
    return out;
  }

  var APPROVE_TIP = 'Saves this comment to the report card and opens the next student.';
  function syncApprove() {
    var btn = document.getElementById('tq-approve-next');
    if (!btn) return;
    var blocked = approveBlockers(_current());
    var date = blocked.indexOf('deadline') >= 0;
    var tick = blocked.some(function (b) {
      return b !== 'deadline' && b !== 'limit';
    });
    var tail =
      date && tick
        ? ' Pick the deadline and tick “I checked this” first.'
        : date
          ? ' Pick the deadline first.'
          : tick
            ? ' Tick “I checked this” first.'
            : '';
    if (blocked.indexOf('limit') >= 0) tail += ' Shorten the comment to ' + _limit() + ' characters first.';
    btn.disabled = blocked.length > 0;
    btn.title = APPROVE_TIP + (tail || ' ⌘ Return');
  }

  /* ── The deadline calendar ───────────────────────────────── */

  /* The school year the deadline is picked in: the class's first reporting
     term's start to its last term's end; with no terms, September 1 to June
     30 of the school year today falls in. { start, end } as YYYY-MM-DD. */
  function schoolYear(cid, today) {
    var terms = typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [];
    var starts = terms
      .map(function (t) {
        return t.starts_on;
      })
      .filter(Boolean)
      .sort();
    var ends = terms
      .map(function (t) {
        return t.ends_on;
      })
      .filter(Boolean)
      .sort();
    if (starts.length && ends.length) return { start: starts[0], end: ends[ends.length - 1] };
    var y = Number(String(today).slice(0, 4));
    var fall = Number(String(today).slice(5, 7)) >= 8;
    return { start: (fall ? y : y - 1) + '-09-01', end: (fall ? y + 1 : y) + '-06-30' };
  }

  function _today() {
    return typeof courseToday === 'function' ? courseToday(_activeCourse) : new Date().toISOString().slice(0, 10);
  }
  function _pad(n) {
    return (n < 10 ? '0' : '') + n;
  }
  function _ymd(y, m, d) {
    return y + '-' + _pad(m) + '-' + _pad(d);
  }
  /* "January 26" for a YYYY-MM-DD. */
  function _longDay(iso) {
    var d = parseLocalDate(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }

  var _cal = null; // { month: 'YYYY-MM' } while the calendar is open

  /* The days a deadline can fall on: from today (or the year's start) to
     the end of the school year. */
  function _deadlineRange() {
    var today = _today();
    var yr = schoolYear(_activeCourse, today);
    return { min: today > yr.start ? today : yr.start, max: yr.end };
  }

  function _calendarHtml(picked) {
    if (!_cal) return '';
    var range = _deadlineRange();
    var y = Number(_cal.month.slice(0, 4));
    var mo = Number(_cal.month.slice(5, 7));
    var first = new Date(y, mo - 1, 1);
    var days = new Date(y, mo, 0).getDate();
    var title = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    var cells = '';
    for (var i = 0; i < first.getDay(); i++) cells += '<span></span>';
    for (var d = 1; d <= days; d++) {
      var iso = _ymd(y, mo, d);
      var dow = new Date(y, mo - 1, d).getDay();
      var out = iso < range.min || iso > range.max;
      var cls = 'qn-cal-day' + (iso === picked ? ' on' : '') + (dow === 0 || dow === 6 ? ' weekend' : '');
      cells += `<button type="button" class="${cls}" data-action="tqPickDeadline" data-date="${iso}"${out ? ' disabled' : ''} aria-label="${esc(_longDay(iso))}"${iso === picked ? ' aria-pressed="true"' : ''}>${d}</button>`;
    }
    var prevOk = _cal.month > range.min.slice(0, 7);
    var nextOk = _cal.month < range.max.slice(0, 7);
    var term = typeof getActiveTerm === 'function' ? getActiveTerm(_activeCourse) : null;
    var note =
      term && term.endsOn && term.endsOn >= range.min
        ? `<span class="qn-cal-note">${esc(term.label || 'This term')} ends ${esc(_longDay(term.endsOn))}. Pick a date before then.</span>`
        : '';
    return `<div class="qn-cal" role="dialog" aria-label="Pick a deadline" id="tq-cal">
      <div class="qn-cal-top"><span class="qn-cal-title">${esc(title)}</span>
        <span class="qn-cal-nav"><button type="button" data-action="tqDeadlineMonth" data-dir="-1" aria-label="Previous month" title="Previous month"${prevOk ? '' : ' disabled'}>‹</button><button type="button" data-action="tqDeadlineMonth" data-dir="1" aria-label="Next month" title="Next month"${nextOk ? '' : ' disabled'}>›</button></span></div>
      <div class="qn-cal-week" aria-hidden="true"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
      <div class="qn-cal-grid">${cells}</div>
      ${note}
    </div>`;
  }

  function tqOpenDeadline() {
    var st = _current();
    if (!st) return;
    var picked = _facts(st).grade.ieDeadline;
    var range = _deadlineRange();
    var start = picked || range.min;
    _cal = { month: start.slice(0, 7) };
    _syncRequired();
    var on =
      document.querySelector('#tq-cal .qn-cal-day.on') || document.querySelector('#tq-cal .qn-cal-day:not([disabled])');
    if (on) on.focus();
  }
  function tqCloseDeadline() {
    if (!_cal) return;
    _cal = null;
    _syncRequired();
    var b = document.getElementById('tq-deadline-btn');
    if (b) b.focus();
  }
  function tqDeadlineMonth(dir) {
    if (!_cal) return;
    var y = Number(_cal.month.slice(0, 4));
    var m = Number(_cal.month.slice(5, 7)) + (Number(dir) || 0);
    if (m < 1) {
      m = 12;
      y--;
    } else if (m > 12) {
      m = 1;
      y++;
    }
    _cal.month = y + '-' + _pad(m);
    _syncRequired();
  }

  /* A day picked: saved with the reporting basis for this report, and the
     deadline sentence in the comment says the new date in place of [date]
     (or the date picked before). */
  function tqPickDeadline(iso) {
    var st = _current();
    if (!st || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return;
    var range = _deadlineRange();
    if (iso < range.min || iso > range.max) return;
    tqSaveCurrentIfNeeded();
    var termId = getTermId();
    var rating = getStudentTermRating(_activeCourse, st.id, termId) || {};
    var sentence = function () {
      var part = CommentBank.requiredParts(_bankContext(_activeCourse, st, _facts(st))).find(function (p) {
        return p.key === 'ieDeadline';
      });
      return part ? part.text : '';
    };
    var before = sentence();
    upsertTermRating(_activeCourse, st.id, termId, {
      reportingBasis: rating.reportingBasis || 'grade',
      ieDeadline: iso,
    });
    _facts(st, true);
    var after = sentence();
    var text = plainComment((getStudentTermRating(_activeCourse, st.id, termId) || {}).narrative || '');
    if (before && after && before !== after && text.indexOf(before) >= 0) {
      upsertTermRating(_activeCourse, st.id, termId, { narrative: text.replace(before, after) });
      var key = _activeCourse + '|' + st.id + '|' + termId;
      var last = _lastDraft[key];
      if (last) {
        last.text = last.text.replace(before, after);
        last.sentences.forEach(function (x) {
          if (x.text !== before) return;
          x.text = after;
          // Its realiser tokens hold the old date: keep the new text as written.
          delete x.toks;
        });
      }
    }
    _cal = null;
    rerender();
    var b = document.getElementById('tq-deadline-btn');
    if (b) b.focus();
  }

  /* ── The Required sentences ──────────────────────────────── */

  var CAL_ICON =
    '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="1.5" y="2.5" width="10" height="9" rx="1.5"></rect><path d="M1.5 5.5 H11.5 M4.5 1 V3.5 M8.5 1 V3.5"></path></svg>';

  /* Where each Required sentence comes from, as the mockup words it. */
  function _requiredSource(cid, student, f, key) {
    var g = f.grade || {};
    var m = g.marked || { mine: 0, all: 0 };
    var problem = CommentBank.ieProblemOf(f);
    if (CommentBank.reportPath(f) !== 'ie')
      return (
        'Required when ' +
        (g.basis === 'iep_goals' ? 'IEP Goals' : 'Language Goals') +
        ' is chosen. Fixed wording; it cannot be reworded.'
      );
    if (key === 'grade') {
      if (CommentBank.ieSource(f) === 'calc') return 'Your gradebook: under 50%, so IE until the course ends';
      var lg = getCourseLetterData(cid, student.id);
      return (
        'You chose IE above' +
        (lg && lg.S && lg.R != null ? ' · ' + lg.S + ' ' + lg.R + '% from the ' + m.mine + ' marked assignments' : '')
      );
    }
    if (key === 'ieProblem') {
      if (problem === 'missing')
        return (
          (f.notHandedIn.count || 0) + ' of ' + (m.all || f.record.total) + ' · check that these are really missing'
        );
      if (problem === 'marks' || problem === 'noMarks') return m.mine + ' of ' + m.all + ' assignments marked';
      return 'Your gradebook';
    }
    if (key === 'iePlan')
      return problem === 'missing'
        ? 'From the work not handed in'
        : problem === 'marks' || problem === 'noMarks'
          ? 'From the work with no mark yet'
          : 'Your gradebook';
    if (key === 'ieDeadline')
      return g.ieDeadline ? 'The date you picked' : 'Approve and Next stays off until you pick a date.';
    return 'Gives the student and family a chance to talk with you';
  }

  /* The Required parts of an IE or goals comment, as rows of the Sentences
     card: the part, Required, the sentence, where it comes from, and on the
     IE path "I checked this" on the missing-work row and Pick a Date on the
     deadline row. Nothing on the grade path. */
  function _requiredRows(cid, student, f) {
    var path = CommentBank.reportPath(f);
    if (!path) return '';
    var parts = CommentBank.requiredParts(_bankContext(cid, student, f));
    var checks = _checksFor(f);
    var picked = (f.grade && f.grade.ieDeadline) || '';
    var rows = parts
      .map(function (p) {
        var check = p.key === 'ieProblem' && checks.indexOf('missing') >= 0;
        var date = p.key === 'ieDeadline';
        var flag = check || (date && !picked);
        var ctrl = check
          ? `<label class="qn-req-ctrl" title="Tick once you have checked these are really missing."><input type="checkbox" data-tq-check="missing"${_checked[_checkKey(student.id, 'missing')] ? ' checked' : ''}>I checked this</label>`
          : date
            ? `<button type="button" class="qn-req-ctrl" id="tq-deadline-btn" data-action="tqOpenDeadline" aria-haspopup="dialog" aria-expanded="${!!_cal}" title="Pick the date by which the IE must become a grade.">${CAL_ICON}${picked ? esc(_longDay(picked)) : 'Pick a Date'}</button>`
            : '';
        return `<div class="qn-req-row${flag ? ' flag' : ''}${path !== 'ie' ? ' statement' : ''}${date ? ' has-cal' : ''}">
          <div class="qn-req-part"><span class="qn-req-label">${esc(p.label)}</span><span class="qn-req-chip">Required</span></div>
          <div class="qn-req-body"><span class="qn-req-text">${esc(p.text)}</span><span class="qn-req-source">${esc(_requiredSource(cid, student, f, p.key))}</span></div>
          ${ctrl}
          ${date ? _calendarHtml(picked) : ''}
        </div>`;
      })
      .join('');
    return rows;
  }

  /* The Sentences card: an IE or goals comment's Required rows, then the
     rows for the class's lines (plan PR 8): Not Handed In with the
     late-work line, Support and Closing. PR 11b adds a row per sentence. */
  function _sentencesHtml(cid, student, f) {
    var path = CommentBank.reportPath(f);
    var hint = !path
      ? ''
      : path === 'ie'
        ? 'An IE comment needs every part marked Required.'
        : 'The grade sentence is replaced by the required statement.';
    return `<div class="qn-card qn-sentences${path ? ' qn-required' : ''}" id="tq-sentences">
      <div class="qn-req-top"><span class="qn-card-title">Sentences</span>${hint ? `<span class="qn-sub">${esc(hint)}</span>` : ''}</div>
      ${_requiredRows(cid, student, f)}
      ${_classRowsHtml(cid, student, f)}
    </div>`;
  }

  /* The card redrawn in place (the calendar opened or moved a month). */
  function _syncRequired() {
    var st = _current();
    var card = document.getElementById('tq-sentences');
    if (!st || !card) return;
    card.outerHTML = _sentencesHtml(_activeCourse, st, _facts(st));
  }

  /* ── The class's lines (plan PR 8) ───────────────────────── */

  /* Each class line is edited where it shows, and saved with the class's
     report settings (report_config, under commentSettings); the late-work
     line is the class's Late Work Policy (course.late_work_policy, as Class
     Management edits it). Teacher text is used exactly as typed. */
  var _lineEdit = null; // 'closing', 'late' or 'own' while its box is open
  var _supportMenu = false;

  function _courseName(cid) {
    return (typeof COURSES !== 'undefined' && COURSES[cid] && COURSES[cid].name) || 'this class';
  }

  /* Merges a patch into the class's comment settings and saves the report
     settings, as Progress Reports saves them. */
  function _saveSettings(patch) {
    var rc = Object.assign({}, (typeof getReportConfig === 'function' && getReportConfig(_activeCourse)) || {});
    rc.commentSettings = Object.assign({}, rc.commentSettings || {}, patch);
    saveReportConfig(_activeCourse, rc);
  }

  function _first(student) {
    return student.firstName || displayNameFirst(student);
  }

  /* "2 of 28 · check that both are really missing before you approve". */
  function _missingSource(f) {
    var n = (f.notHandedIn && f.notHandedIn.count) || 0;
    var total = (f.record && f.record.total) || n;
    var which = n === 1 ? 'it is' : n === 2 ? 'both are' : 'these are';
    return n + ' of ' + total + ' · check that ' + which + ' really missing before you approve';
  }

  function _missingRowHtml(cid, f) {
    var course = _courseName(cid);
    var late = String((COURSES[cid] && COURSES[cid].lateWorkPolicy) || '').trim();
    var sentence = CommentBank.notHandedInSentence(f.notHandedIn);
    var line;
    if (_lineEdit === 'late') {
      line = `<div class="qn-line-edit">
          <input type="text" class="qn-line-input" id="tq-line-late" data-tq-line-input="late" aria-label="Late work line for ${esc(course)}" title="Used exactly as you type it, after the missing-work sentence." value="${esc(late)}">
          <button type="button" class="qn-line-save" data-action="tqLine" data-do="saveLate" title="Saves this as ${esc(course)}’s Late Work Policy.">Save for Class</button>
        </div>
        <span class="qn-req-source">This is the class’s Late Work Policy. It follows the missing-work sentence for every student who has some.</span>`;
    } else if (late) {
      line = '';
    } else {
      line = `<span class="qn-line-empty-row"><span class="qn-line-empty">No late work line for this class.</span><button type="button" class="qn-line-choose" data-action="tqLine" data-do="editLate" title="Write the line that follows the missing-work sentence. It is ${esc(course)}’s Late Work Policy.">Add One…</button></span>`;
    }
    var lateBtn =
      late && _lineEdit !== 'late'
        ? ` <button type="button" class="qn-line-text" data-action="tqLine" data-do="editLate" title="Change ${esc(course)}’s late-work line. It is the class’s Late Work Policy.">${esc(late)}</button>`
        : '';
    return `<div class="qn-req-row flag qn-line-row" id="tq-row-missing">
      <div class="qn-req-part"><span class="qn-req-label">Not Handed In</span></div>
      <div class="qn-req-body">
        <span class="qn-req-text">${esc(sentence)}${lateBtn}</span>
        ${line}
        <span class="qn-req-source">${esc(_missingSource(f))}</span>
      </div>
    </div>`;
  }

  /* What a support line fits, in words: the fit for this student, else the
     first skill or habit it names that this class has. */
  function _fitWords(line, f, fit) {
    if (fit) return CommentBank.fitName(fit, f);
    for (var i = 0; i < line.fits.length; i++) {
      var n = CommentBank.fitName(line.fits[i], f);
      if (n) return n;
    }
    return '';
  }

  function _supportMenuHtml(cid, student, f, choice) {
    var course = _courseName(cid);
    var first = _first(student);
    var habits = CommentBank.effectiveHabits(
      (getStudentTermRating(cid, student.id, getTermId()) || {}).habits || f.habits,
      f.record,
    );
    var lines = CommentBank.supportChecklist(cid, f.family);
    var on = lines.filter(function (l) {
      return l.on;
    });
    var left = f.classLines && f.classLines.pick === 'none';
    var item = function (id, text, meta, checked, tip) {
      return `<button type="button" role="menuitemradio" aria-checked="${checked}" class="qn-menu-item${checked ? ' on' : ''}" data-action="tqLine" data-do="pickSupport" data-line="${esc(id)}" title="${esc(tip)}"><span class="qn-menu-mark" aria-hidden="true">${checked ? '✓' : ''}</span><span class="qn-menu-body"><span class="qn-menu-text">${esc(text)}</span>${meta ? `<span class="qn-menu-meta">${esc(meta)}</span>` : ''}</span></button>`;
    };
    var use = on
      .map(function (l) {
        var inUse = !left && !!choice && choice.line.id === l.id;
        var fit = CommentBank.supportFit(l, f, habits);
        var words = _fitWords(l, f, fit);
        // In use: what it fits for this student, when it does; else what
        // the line is for.
        var meta = inUse ? 'In use' + (fit ? ' · fits ' + words : '') : words ? 'Fits ' + words : '';
        return item(l.id, l.text, meta, inUse, 'Use this line in ' + first + '’s comment.');
      })
      .join('');
    var useHtml = on.length
      ? `<span class="qn-menu-head">Use for ${esc(first)}</span>${use}${item('none', 'Leave this sentence out', 'For ' + first + ' only', left, 'Leaves the support line out of ' + first + '’s comment only.')}<div class="qn-menu-sep" role="separator"></div>`
      : '';
    var checks = lines
      .map(function (l) {
        return `<label class="qn-menu-check" title="${esc(l.on ? 'Untick to stop using this line in ' + course + '.' : 'Tick if you will do this in ' + course + '.')}"><input type="checkbox" data-tq-support="${esc(l.id)}"${l.on ? ' checked' : ''}>${esc(l.text)}</label>`;
      })
      .join('');
    var own =
      _lineEdit === 'own'
        ? `<div class="qn-line-edit qn-menu-own">
            <input type="text" class="qn-line-input" id="tq-line-own" data-tq-line-input="own" aria-label="Your own support line for ${esc(course)}" title="Write what you will do in class. It is used exactly as you type it.">
            <div class="qn-line-actions"><button type="button" class="qn-line-cancel" data-action="tqLine" data-do="cancel" title="Closes without adding a line.">Cancel</button><button type="button" class="qn-line-save" data-action="tqLine" data-do="saveOwn" title="Adds this line to ${esc(course)}’s list and ticks it.">Save for Class</button></div>
          </div>`
        : `<button type="button" class="qn-menu-add" data-action="tqLine" data-do="writeOwn" title="Write a support line of your own for ${esc(course)}.">+ Write Your Own</button>`;
    return `<div class="qn-menu" role="menu" aria-label="Support lines for ${esc(course)}" id="tq-support-menu">
      ${useHtml}
      <span class="qn-menu-head">Lines you will do in ${esc(course)}</span>
      ${checks}
      ${own}
    </div>`;
  }

  function _supportRowHtml(cid, student, f) {
    var course = _courseName(cid);
    var first = _first(student);
    var habits = CommentBank.effectiveHabits(
      (getStudentTermRating(cid, student.id, getTermId()) || {}).habits || f.habits,
      f.record,
    );
    var any = ((f.classLines && f.classLines.support) || []).length > 0;
    var choice = CommentBank.supportChoice(f, habits);
    var menu = _supportMenu ? _supportMenuHtml(cid, student, f, choice) : '';
    var open = ` aria-haspopup="menu" aria-expanded="${_supportMenu}"`;
    if (!any)
      return `<div class="qn-req-row qn-line-row has-menu" id="tq-row-support">
        <div class="qn-req-part"><span class="qn-req-label">Support</span></div>
        <span class="qn-line-empty">No support lines chosen for this class. The comment leaves this sentence out.</span>
        <button type="button" class="qn-line-choose" data-action="tqLine" data-do="supportMenu"${open} title="Tick the support lines you will do in ${esc(course)}.">Choose…</button>
        ${menu}
      </div>`;
    var body = choice
      ? `<span class="qn-req-text">${esc(choice.line.text)}</span><span class="qn-req-source">One of your support lines for ${esc(course)}</span>`
      : `<span class="qn-req-text qn-line-off">Left out of this comment.</span><span class="qn-req-source">For ${esc(first)} only</span>`;
    return `<div class="qn-req-row qn-line-row has-menu" id="tq-row-support">
      <div class="qn-req-part"><span class="qn-req-label">Support</span></div>
      <div class="qn-req-body">${body}</div>
      <button type="button" class="qn-line-menu${_supportMenu ? ' on' : ''}" data-action="tqLine" data-do="supportMenu"${open} title="Pick the support line for ${esc(first)}, or tick the lines you will do in ${esc(course)}.">Support Line ▾</button>
      ${menu}
    </div>`;
  }

  function _closingRowHtml(cid) {
    var course = _courseName(cid);
    var closing = CommentBank.classSettings(cid).closing;
    if (_lineEdit === 'closing')
      return `<div class="qn-req-row qn-line-row" id="tq-row-closing">
        <div class="qn-req-part"><span class="qn-req-label">Closing</span></div>
        <div class="qn-req-body qn-line-edit-body">
          <input type="text" class="qn-line-input" id="tq-line-closing" data-tq-line-input="closing" aria-label="Closing sentence for ${esc(course)}" title="Used exactly as you type it, at the end of each new comment." value="${esc(closing)}">
          <span class="qn-req-source">Ends every new comment in ${esc(course)}. Approved comments are flagged so you can update or keep each one. Leave it empty to end without one.</span>
          <div class="qn-line-actions"><button type="button" class="qn-line-cancel" data-action="tqLine" data-do="cancel" title="Keeps the closing sentence as it was.">Cancel</button><button type="button" class="qn-line-save" data-action="tqLine" data-do="saveClosing" title="Saves this closing sentence for every comment in ${esc(course)}.">Save for Class</button></div>
        </div>
      </div>`;
    if (!closing)
      return `<div class="qn-req-row qn-line-row" id="tq-row-closing">
        <div class="qn-req-part"><span class="qn-req-label">Closing</span></div>
        <span class="qn-line-empty">No closing sentence for this class.</span>
        <button type="button" class="qn-line-choose" data-action="tqLine" data-do="editClosing" title="Write a sentence to end every comment in ${esc(course)}.">Add One…</button>
      </div>`;
    return `<div class="qn-req-row qn-line-row" id="tq-row-closing">
      <div class="qn-req-part"><span class="qn-req-label">Closing</span></div>
      <div class="qn-req-body">
        <button type="button" class="qn-line-text qn-req-text" data-action="tqLine" data-do="editClosing" title="Change the closing sentence for ${esc(course)}.">${esc(closing)}</button>
        <span class="qn-req-source">From your class settings</span>
      </div>
    </div>`;
  }

  /* The rows for the class's lines, in the comment's order. An IE comment
     states its own problem and plan, so it has only the closing row. */
  function _classRowsHtml(cid, student, f) {
    var ie = CommentBank.reportPath(f) === 'ie';
    var rows = '';
    if (!ie && f.notHandedIn && f.notHandedIn.count > 0) rows += _missingRowHtml(cid, f);
    if (!ie) rows += _supportRowHtml(cid, student, f);
    return rows + _closingRowHtml(cid);
  }

  /* After a class line changes: the comment on screen, when it is still
     the draft Generate wrote, is drafted again with the same seed, so only
     the class's lines differ; otherwise the old line is swapped for the new
     where it appears (taken out when the new is empty). With `everyone`,
     every other comment this report not yet approved gets the same swap.
     An approved comment is never rewritten (Decision 1; PR 12 flags it). */
  function _swapLine(oldText, newText, everyone) {
    var st = _current();
    var termId = getTermId();
    var swap = function (text) {
      if (!oldText || text.indexOf(oldText) < 0) return null;
      if (newText) return text.replace(oldText, newText);
      return text
        .replace(oldText, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    };
    var all = getTermRatings(_activeCourse) || {};
    var sids = everyone ? Object.keys(all) : st ? [String(st.id)] : [];
    sids.forEach(function (sid) {
      var r = (all[sid] || {})[termId];
      if (!r || r.approvedAt) return;
      var key = _activeCourse + '|' + sid + '|' + termId;
      var text = plainComment(r.narrative || '');
      var last = _lastDraft[key];
      if (st && String(st.id) === sid && text && last && text.trim() === last.text.trim()) {
        _redraft(st);
        return;
      }
      var next = swap(text);
      if (next == null || next === text) return;
      upsertTermRating(_activeCourse, sid, termId, { narrative: next });
      if (last) {
        last.text = swap(last.text) || last.text;
        last.sentences = last.sentences
          .map(function (x) {
            return x.text === oldText ? Object.assign({}, x, { text: newText }) : x;
          })
          .filter(function (x) {
            return x.text;
          });
      }
    });
  }

  /* The draft on screen again, with the seed it was drafted with. */
  function _redraft(st) {
    var termId = getTermId();
    var key = _activeCourse + '|' + st.id + '|' + termId;
    _facts(st, true);
    var d = CommentBank.draft(_bankContext(_activeCourse, st, _facts(st)), {
      seed: _lastSeed[key] || CommentBank.seedFor(st.id + '|' + termId) + (_generated[st.id] || 1),
      comments: _classmateComments(_activeCourse, st.id, termId),
      exclude: [],
    });
    if (!d.text) return;
    upsertTermRating(_activeCourse, st.id, termId, { narrative: d.text });
    _lastDraft[key] = d;
    _lastSeed[key] = d.seed;
  }

  /* The text in a line's box. */
  function _lineValue(which) {
    var el = document.getElementById('tq-line-' + which);
    return el ? String(el.value || '').trim() : '';
  }

  function _redrawLines(focusId) {
    var st = _current();
    if (st) _facts(st, true);
    rerender();
    var el = focusId && document.getElementById(focusId);
    if (el) el.focus();
  }

  /* The class lines' controls: data-action="tqLine" with data-do. */
  function tqLine(what, el) {
    var st = _current();
    if (!st) return;
    tqSaveCurrentIfNeeded();
    var termId = getTermId();
    var cs = CommentBank.classSettings(_activeCourse);
    // The lines as the comment had them, before a save changes one.
    var before = /^save|^pick/.test(what) ? _bankContext(_activeCourse, st, _facts(st, true)) : null;
    switch (what) {
      case 'limitMenu':
        _limitOpen = !_limitOpen;
        _supportMenu = false;
        _redrawLines(_limitOpen ? 'tq-limit-input' : 'tq-count-btn');
        return;
      case 'supportMenu':
        _supportMenu = !_supportMenu;
        _limitOpen = false;
        if (_lineEdit === 'own') _lineEdit = null;
        _redrawLines(_supportMenu ? null : 'tq-row-support');
        _focusMenu();
        return;
      case 'pickSupport': {
        var picks = Object.assign({}, cs.supportFor);
        picks[termId] = Object.assign({}, picks[termId] || {});
        picks[termId][st.id] = el && el.dataset.line ? String(el.dataset.line) : null;
        _saveSettings({ supportFor: picks });
        _supportMenu = false;
        _afterLine(before, 'supportLine', false);
        _redrawLines(null);
        _focusSel('#tq-row-support .qn-line-menu');
        return;
      }
      case 'writeOwn':
        _lineEdit = 'own';
        _redrawLines('tq-line-own');
        return;
      case 'saveOwn': {
        var text = _lineValue('own');
        if (!text) return;
        var id = 'own-' + Date.now().toString(36);
        _saveSettings({
          supportOwn: cs.supportOwn.concat([{ id: id, text: text }]),
          supportChosen: cs.supportChosen.concat([id]),
        });
        _lineEdit = null;
        _afterLine(before, 'supportLine', false);
        _redrawLines(null);
        _focusSel('#tq-support-menu .qn-menu-add');
        return;
      }
      case 'editClosing':
        _lineEdit = 'closing';
        _supportMenu = false;
        _redrawLines('tq-line-closing');
        return;
      case 'saveClosing':
        _saveSettings({ closing: _lineValue('closing') });
        _lineEdit = null;
        _afterLine(before, 'closingLine', true);
        _redrawLines(null);
        _focusSel('#tq-row-closing button');
        return;
      case 'editLate':
        _lineEdit = 'late';
        _supportMenu = false;
        _redrawLines('tq-line-late');
        return;
      case 'saveLate': {
        var late = _lineValue('late');
        if (late !== String((COURSES[_activeCourse] && COURSES[_activeCourse].lateWorkPolicy) || '').trim())
          updateCourse(_activeCourse, { lateWorkPolicy: late || null });
        _lineEdit = null;
        _afterLine(before, 'lateLine', true);
        _redrawLines(null);
        _focusSel('#tq-row-missing button');
        return;
      }
      case 'cancel': {
        var was = _lineEdit;
        _lineEdit = null;
        _redrawLines(null);
        _focusSel(
          was === 'own' ? '#tq-support-menu .qn-menu-add' : was === 'closing' ? '#tq-row-closing button' : null,
        );
        return;
      }
    }
  }

  /* After a save: the line as it was against the line now, in the comment
     on screen (and, for a class-wide line, the others not yet approved). */
  function _afterLine(before, slot, everyone) {
    var st = _current();
    if (!st || !before) return;
    var after = _bankContext(_activeCourse, st, _facts(st, true));
    if (before[slot] !== after[slot]) _swapLine(before[slot], after[slot], everyone);
  }

  /* A checkbox in the support list, or the character limit, changed. */
  function tqLineChange(el) {
    if (!el || !el.dataset) return;
    if (el.dataset.tqLimit) {
      _setLimit(el.value);
      return;
    }
    var id = el.dataset.tqSupport;
    if (!id) return;
    var st = _current();
    if (!st) return;
    tqSaveCurrentIfNeeded();
    var before = _bankContext(_activeCourse, st, _facts(st, true));
    var chosen = CommentBank.classSettings(_activeCourse).supportChosen.filter(function (x) {
      return x !== id;
    });
    if (el.checked) chosen.push(id);
    _saveSettings({ supportChosen: chosen });
    _afterLine(before, 'supportLine', false);
    _redrawLines(null);
    _focusSel('#tq-support-menu [data-tq-support="' + id + '"]');
  }

  function _focusSel(sel) {
    var el = sel && document.querySelector(sel);
    if (el) el.focus();
  }
  function _focusMenu() {
    _focusSel('#tq-support-menu .qn-menu-item.on, #tq-support-menu .qn-menu-item, #tq-support-menu input');
  }

  /* Whether a popover or a line's box is open. */
  function linesOpen() {
    return _supportMenu || _limitOpen || !!_lineEdit;
  }
  /* A click outside an open menu or the limit closes it; a box being
     edited stays until Cancel, Save for Class or Escape. */
  function clickOutside(target) {
    if (!target || !target.closest) return;
    var redraw = false;
    if (_supportMenu && !target.closest('#tq-support-menu, #tq-row-support [data-do="supportMenu"]')) {
      _supportMenu = false;
      if (_lineEdit === 'own') _lineEdit = null;
      redraw = true;
    }
    if (_limitOpen && !target.closest('#tq-limit, #tq-count-btn')) {
      var input = document.getElementById('tq-limit-input');
      if (input) _setLimit(input.value);
      _limitOpen = false;
      redraw = true;
    }
    if (redraw) _redrawLines(null);
  }
  /* Escape: the open menu, the limit or the box being edited closes. */
  function closeLines() {
    if (!linesOpen()) return false;
    var limit = _limitOpen;
    var menu = _supportMenu;
    if (limit) {
      var input = document.getElementById('tq-limit-input');
      if (input) _setLimit(input.value);
    }
    var was = _lineEdit;
    _supportMenu = false;
    _limitOpen = false;
    _lineEdit = null;
    _redrawLines(null);
    _focusSel(
      limit
        ? '#tq-count-btn'
        : menu
          ? '#tq-row-support [data-do="supportMenu"]'
          : was === 'closing'
            ? '#tq-row-closing button'
            : was === 'late'
              ? '#tq-row-missing button'
              : null,
    );
    return true;
  }
  /* Return in the limit: saved, and only the limit closes. */
  function closeLimit() {
    var input = document.getElementById('tq-limit-input');
    if (input) _setLimit(input.value);
    _limitOpen = false;
    _redrawLines('tq-count-btn');
  }
  /* Return in a line's box saves it. */
  function _saveFromKey(which) {
    tqLine(which === 'own' ? 'saveOwn' : which === 'closing' ? 'saveClosing' : 'saveLate');
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
        ${_commentTab === 'this' ? _sentencesHtml(cid, student, f) : ''}
        <!-- The rest of the Sentences card (PR 11b) goes here. -->
      </div>
    </div>`;
  }

  /* After the page is drawn: the roster and the box's height. */
  function afterRender() {
    syncRoster();
    _fitBox();
    syncApprove();
  }

  /* ⌘ Return approves and moves on; ⌘⇧C copies; ↑ ↓ change the student
     outside a text field (the sidebar handles them while it has the
     focus); Escape closes the sheet. */
  function handleKey(e) {
    // The grader opened from At a Glance keeps its own keys.
    if (window.PageAssignments && PageAssignments.graderOpen && PageAssignments.graderOpen()) return;
    if (e.key === 'Escape') {
      if (document.getElementById(INFO_ID)) tqCloseInfo();
      else if (_cal) tqCloseDeadline();
      else closeLines();
      return;
    }
    if (document.getElementById(INFO_ID)) return;
    // Return in a class line's box saves it; in the limit, closes it.
    var lineBox = (e.target && e.target.dataset && e.target.dataset.tqLineInput) || '';
    if (
      e.key === 'Enter' &&
      !e.metaKey &&
      !e.ctrlKey &&
      (lineBox || (e.target && e.target.dataset && e.target.dataset.tqLimit))
    ) {
      e.preventDefault();
      if (lineBox) _saveFromKey(lineBox);
      else closeLimit();
      return;
    }
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
    tqSetBasis: tqSetBasis,
    tqSetCheck: tqSetCheck,
    tqOpenDeadline: tqOpenDeadline,
    tqCloseDeadline: tqCloseDeadline,
    deadlineOpen: function () {
      return !!_cal;
    },
    tqDeadlineMonth: tqDeadlineMonth,
    tqPickDeadline: tqPickDeadline,
    tqLine: tqLine,
    tqLineChange: tqLineChange,
    linesOpen: linesOpen,
    clickOutside: clickOutside,
    closeLines: closeLines,
    approveBlockers: approveBlockers,
    syncApprove: syncApprove,
    schoolYear: schoolYear,
    basisChoices: basisChoices,
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
