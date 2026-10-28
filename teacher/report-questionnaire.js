/* report-questionnaire.js — Term questionnaire (extracted from page-reports.js) */
window.ReportQuestionnaire = (function () {
  'use strict';

  /* ── Parent state injection ──────────────────────────────── */
  var _activeCourse = null;
  var _renderReports = null;
  var _tqIncludeAssignFeedback = true;
  var _tqObsFilter = 'all';

  function configure(opts) {
    _activeCourse = opts.activeCourse;
    _renderReports = opts.renderReports;
    if (opts.tqIncludeAssignFeedback !== undefined) _tqIncludeAssignFeedback = opts.tqIncludeAssignFeedback;
    if (opts.tqObsFilter !== undefined) _tqObsFilter = opts.tqObsFilter;
  }
  function getActiveCourseLocal() {
    return _activeCourse;
  }
  function rerender() {
    if (_renderReports) _renderReports();
  }

  /* ── Imports from sibling modules ──────────────────────── */
  var getTermId = ReportBlocks.getTermId;
  var getPronouns = ReportBlocks.getPronouns;
  var OBS_DESCRIPTORS = ReportBlocks.OBS_DESCRIPTORS;

  var tqStudentIndex = 0;

  function getTqStudents() {
    return sortStudents(getStudents(_activeCourse), 'lastName');
  }

  function tqPrevStudent() {
    tqSaveCurrentIfNeeded();
    tqStudentIndex = Math.max(0, tqStudentIndex - 1);
    rerender();
  }
  function tqNextStudent() {
    tqSaveCurrentIfNeeded();
    const students = getTqStudents();
    if (tqStudentIndex >= students.length - 1) {
      switchTab('progress');
      return;
    }
    tqStudentIndex = Math.min(students.length - 1, tqStudentIndex + 1);
    rerender();
  }

  function tqSaveCurrentIfNeeded() {
    const students = getTqStudents();
    if (!students[tqStudentIndex]) return;
    const sid = students[tqStudentIndex].id;
    const termId = getTermId();
    const existing = getStudentTermRating(_activeCourse, sid, termId);
    const el = document.getElementById('tq-narrative');
    // A typed narrative is saved even before the student has a rating, so a
    // first comment isn't dropped when the teacher leaves the page.
    if (el && (existing || tqNarrativeDirty)) {
      upsertTermRating(_activeCourse, sid, termId, { narrative: sanitizeHtml(el.innerHTML.trim()) });
      tqNarrativeDirty = false;
    }
  }

  function tqSaveNarrative() {
    const el = document.getElementById('tq-narrative');
    if (!el) return;
    const students = getTqStudents();
    const sid = students[tqStudentIndex]?.id;
    if (!sid) return;
    const termId = getTermId();
    upsertTermRating(_activeCourse, sid, termId, { narrative: sanitizeHtml(el.innerHTML.trim()) });
  }

  /* ── Rich text toolbar commands ── */
  var tqNarrativeDirty = false;

  function tqExec(cmd, value) {
    const editor = document.getElementById('tq-narrative');
    if (!editor) return;
    editor.focus();
    document.execCommand(cmd, false, value || null);
    tqNarrativeDirty = true;
    tqUpdateToolbar();
  }

  function tqUpdateToolbar() {
    const cmds = ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList'];
    cmds.forEach(cmd => {
      const btn = document.querySelector(`.tq-tb-btn[data-cmd="${cmd}"]`);
      if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
    });
  }

  function tqCopyNarrative() {
    const editor = document.getElementById('tq-narrative');
    if (!editor) return;
    const text = editor.innerText;
    if (!text.trim()) return;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('tq-copy-btn');
      btn.classList.add('copied');
      btn.title = 'Copied!';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.title = 'Copy to Clipboard';
      }, 1800);
    });
  }

  // Update active states on selection change & keyup

  function tqSetDim(sid, dim, val) {
    tqSaveNarrative();
    const termId = getTermId();
    const existing = getStudentTermRating(_activeCourse, sid, termId);
    const defaultDims = {};
    OBS_DIMS.forEach(d => {
      defaultDims[d] = 0;
    });
    const currentDims = existing ? { ...defaultDims, ...existing.dims } : defaultDims;
    currentDims[dim] = currentDims[dim] === val ? 0 : val; // Toggle off if same
    upsertTermRating(_activeCourse, sid, termId, { dims: currentDims });
    rerender();
  }

  function tqSetField(sid, field, val) {
    tqSaveNarrative();
    const termId = getTermId();
    const existing = getStudentTermRating(_activeCourse, sid, termId) || {};
    const newVal = existing[field] === val ? 0 : val; // Toggle off if same
    upsertTermRating(_activeCourse, sid, termId, { [field]: newVal });
    rerender();
  }

  function _plainText(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return d.textContent;
  }

  /* The report a term id names, as the report picker shows it. */
  function _reportLabel(termId) {
    const sel = document.getElementById('report-period');
    const n = String(termId || '').match(/(\d+)$/);
    const opt = sel && n ? Array.prototype.find.call(sel.options, o => o.value === 'Report ' + n[1]) : null;
    return opt ? opt.text : n ? 'Report ' + n[1] : '';
  }

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /* Under the attendance boxes: the change since the last report with
     totals, or a warning when a total is lower than that report's. */
  function _attendanceNoteHtml(att) {
    const lower = ['absences', 'lates'].find(f => {
      const prev = att['prev' + f[0].toUpperCase() + f.slice(1)];
      return att[f] != null && prev != null && att[f] < prev;
    });
    if (lower) {
      const prev = att[lower === 'absences' ? 'prevAbsences' : 'prevLates'];
      const what = lower === 'absences' ? _plural(prev, 'absence', 'absences') : _plural(prev, 'late', 'lates');
      return `<span class="tq-att-warn">Lower than the ${what} entered for the ${esc(
        _reportLabel(att[lower + 'PrevTerm']),
      )} report. Enter the total to date from MyEd.</span>`;
    }
    const prevTerm = att.absencesPrevTerm || att.latesPrevTerm;
    const entered = att.absences != null || att.lates != null;
    if (!prevTerm) {
      return entered ? 'No earlier report has attendance, so these are this term’s totals too.' : '';
    }
    const was = [
      att.prevAbsences != null ? att.prevAbsences + ' absent' : '',
      att.prevLates != null ? att.prevLates + ' late' : '',
    ]
      .filter(Boolean)
      .join(', ');
    if (!entered) return `The ${esc(_reportLabel(prevTerm))} report had ${was}.`;
    const since = [
      att.absencesThisTerm != null ? att.absencesThisTerm + ' absent' : '',
      att.latesThisTerm != null ? att.latesThisTerm + ' late' : '',
    ]
      .filter(Boolean)
      .join(', ');
    return `Since the ${esc(_reportLabel(prevTerm))} report (${was}): <strong>${since}</strong>`;
  }

  /* The comment's attendance sentence for a student's current totals. */
  function _attendanceSentenceFor(sid) {
    const student = getStudents(_activeCourse).find(s => s.id === sid);
    return student ? ReportBlocks.attendanceSentence(student, getTermAttendance(_activeCourse, sid, getTermId())) : '';
  }

  /* Takes a sentence out of the comment's text, with the space before it. */
  function _removeSentence(editor, sentence) {
    if (!sentence) return false;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.data.indexOf(sentence);
      if (at < 0) continue;
      const start = at > 0 && node.data[at - 1] === ' ' ? at - 1 : at;
      node.data = node.data.slice(0, start) + node.data.slice(at + sentence.length);
      return true;
    }
    return false;
  }

  function _appendSentence(editor, sentence) {
    const last = editor.lastElementChild;
    const into = last && /^(P|DIV)$/.test(last.tagName) ? last : editor;
    const text = into.textContent.replace(/\s+$/, '');
    into.appendChild(document.createTextNode((text ? ' ' : '') + sentence));
  }

  /* The Mention in Comment row shows whether the comment has the sentence. */
  function _syncAttendanceMention(sid) {
    const row = document.getElementById('tq-att-mention');
    const editor = document.getElementById('tq-narrative');
    if (!row || !editor) return;
    const sentence = _attendanceSentenceFor(sid);
    const on = !!sentence && editor.textContent.indexOf(sentence) >= 0;
    row.classList.toggle('selected', on);
    row.setAttribute('aria-pressed', String(on));
    row.disabled = !sentence;
    const check = row.querySelector('.tq-tag-check');
    if (check) check.textContent = on ? '\u2713' : '';
  }

  /* Mention in Comment: the year's attendance as one sentence at the end
     of the comment, edited like any other text; a second click takes it out.
     Nothing goes in unless the teacher picks it. */
  function tqToggleAttendanceMention(sid) {
    const editor = document.getElementById('tq-narrative');
    const sentence = _attendanceSentenceFor(sid);
    if (!editor || !sentence) return;
    if (!_removeSentence(editor, sentence)) _appendSentence(editor, sentence);
    tqNarrativeDirty = true;
    tqSaveNarrative();
    _syncAttendanceMention(sid);
  }

  /* A box changed: save both totals and redraw only the note, so the
     cursor stays where the teacher put it. */
  function tqSetAttendance(sid) {
    const abs = document.getElementById('tq-att-absences');
    const late = document.getElementById('tq-att-lates');
    if (!abs || !late) return;
    const termId = getTermId();
    const before = _attendanceSentenceFor(sid);
    saveTermAttendance(_activeCourse, sid, termId, abs.value, late.value);
    const att = getTermAttendance(_activeCourse, sid, termId);
    // A comment that mentions the old totals gets the new ones.
    const editor = document.getElementById('tq-narrative');
    const after = _attendanceSentenceFor(sid);
    if (editor && before && before !== after && _removeSentence(editor, before)) {
      if (after) _appendSentence(editor, after);
      tqNarrativeDirty = true;
      tqSaveNarrative();
    }
    _syncAttendanceMention(sid);
    const note = document.getElementById('tq-att-note');
    if (note) note.innerHTML = _attendanceNoteHtml(att);
    abs.classList.toggle('warn', att.absences != null && att.prevAbsences != null && att.absences < att.prevAbsences);
    late.classList.toggle('warn', att.lates != null && att.prevLates != null && att.lates < att.prevLates);
  }

  function tqToggleTrait(sid, traitId) {
    tqSaveNarrative();
    const termId = getTermId();
    const existing = getStudentTermRating(_activeCourse, sid, termId) || {};
    const traits = [...(existing.socialTraits || [])];
    const idx = traits.indexOf(traitId);
    if (idx >= 0) traits.splice(idx, 1);
    else traits.push(traitId);
    upsertTermRating(_activeCourse, sid, termId, { socialTraits: traits });
    rerender();
  }

  function tqToggleAssignment(sid, aId) {
    tqSaveNarrative();
    const termId = getTermId();
    const existing = getStudentTermRating(_activeCourse, sid, termId) || {};
    const list = [...(existing.mentionAssessments || [])];
    const idx = list.indexOf(aId);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(aId);
    upsertTermRating(_activeCourse, sid, termId, { mentionAssessments: list });
    // Toggle in place — full rerender would reset scroll position. The
    // selection only affects this row's checkbox + .selected class; nothing
    // else on screen reads mentionAssessments.
    const row = document.querySelector(`.tq-assignment-row[data-aid="${aId}"][data-sid="${sid}"]`);
    if (row) {
      const nowSelected = idx < 0;
      row.classList.toggle('selected', nowSelected);
      const check = row.querySelector('.tq-tag-check');
      if (check) check.textContent = nowSelected ? '✓' : '';
    }
  }

  function tqToggleOb(sid, obId) {
    tqSaveNarrative();
    const termId = getTermId();
    const existing = getStudentTermRating(_activeCourse, sid, termId) || {};
    const list = [...(existing.mentionObs || [])];
    const idx = list.indexOf(obId);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(obId);
    upsertTermRating(_activeCourse, sid, termId, { mentionObs: list });
    // In place, as assignments: a redraw moved the page under the cursor.
    const row = document.querySelector(`.tq-evidence-item[data-obid="${obId}"][data-sid="${sid}"]`);
    if (row) row.classList.toggle('selected', idx < 0);
    else rerender();
  }

  function tqSelectStudent(sid) {
    tqSaveCurrentIfNeeded();
    const students = getTqStudents();
    const idx = students.findIndex(s => s.id === sid);
    if (idx >= 0) {
      tqStudentIndex = idx;
      rerender();
    }
  }

  function renderTermQuestionnaire(cid) {
    const students = getTqStudents();
    if (students.length === 0) return '<div class="empty-state"><div class="empty-state-title">No students</div></div>';
    if (tqStudentIndex >= students.length) tqStudentIndex = 0;

    const student = students[tqStudentIndex];
    const sid = student.id;
    const name = displayName(student);
    const fName = esc(fullName(student));
    const termId = getTermId();
    const rating = getStudentTermRating(cid, sid, termId) || {};
    const dims = rating.dims || {};
    const narrative = rating.narrative || '';
    const course = COURSES[cid];

    // Update toolbar student nav
    const navName = document.getElementById('tq-student-name');
    if (navName) navName.textContent = name;
    const completedCount = students.filter(s => {
      const r = getStudentTermRating(cid, s.id, termId);
      return r && OBS_DIMS.some(d => (r.dims?.[d] || 0) > 0);
    }).length;
    const ringFill = document.getElementById('tq-ring-fill');
    const ringLabel = document.getElementById('tq-progress-label');
    if (ringFill && ringLabel) {
      const pct = students.length > 0 ? completedCount / students.length : 0;
      const circumference = 75.4; // 2 * π * 12
      ringFill.style.strokeDashoffset = circumference * (1 - pct);
      ringLabel.textContent = `${completedCount}`;
    }

    // ── Gather all auto-populated data ──
    const overall = getOverallProficiency(cid, sid);
    const sections = getSections(cid);
    const allObs = getStudentQuickObs(cid, sid);
    const allTags = getAllTags(cid);
    const reflections = getReflections(cid);
    const studentReflections = reflections[sid] || {};

    // Observation insights
    const obsCount = allObs.length;
    const sentimentCounts = { strength: 0, growth: 0, concern: 0, note: 0 };
    const contextCounts = {};
    allObs.forEach(ob => {
      if (ob.sentiment) sentimentCounts[ob.sentiment] = (sentimentCounts[ob.sentiment] || 0) + 1;
      if (ob.context) contextCounts[ob.context] = (contextCounts[ob.context] || 0) + 1;
    });
    const topContext = Object.entries(contextCounts).sort((a, b) => b[1] - a[1])[0];

    // Strengths & growth areas (auto-populated from tag proficiency)
    const tagProfs = allTags
      .map(t => ({ tag: t, prof: getTagProficiency(cid, sid, t.id), section: getSectionForTag(cid, t.id) }))
      .filter(t => t.prof > 0);
    // By the level shown (2.5 reads as Proficient), like the report.
    const strengths = tagProfs
      .filter(t => Math.round(t.prof) >= 3)
      .sort((a, b) => b.prof - a.prof)
      .slice(0, 6);
    const growthAreas = tagProfs
      .filter(t => t.prof > 0 && Math.round(t.prof) < 3)
      .sort((a, b) => a.prof - b.prof)
      .slice(0, 6);

    // Per-assignment performance.
    //   • `overall` (0–4) drives the row color via PROF_COLORS — uniform across
    //     score modes thanks to Calc.getAssessmentOverallScore's normalization.
    //   • `displayLabel` reflects the score mode the teacher actually used:
    //       points-mode  → "85 / 100" (raw average over maxPoints)
    //       rubric-mode  → proficiency word (rubric crit averages map to 0–4)
    //       proficiency  → proficiency word
    //     This matches the principle that a quiz scored out of 100 should not
    //     be reported as "Proficient" in a place where the assessment method's
    //     own units are clearer.
    const assessments = getAssessments(cid);
    const studentScoresForPerf = getScores(cid)[sid] || [];
    const assignmentPerf = assessments
      .map(a => {
        const overall =
          window.Calc && window.Calc.getAssessmentOverallScore
            ? window.Calc.getAssessmentOverallScore(cid, sid, a.id)
            : null;
        if (overall == null) return null;
        let displayLabel;
        if (isCompletionScored(a)) {
          displayLabel = overall > 0 ? 'Complete' : 'Incomplete';
        } else if (a.scoreMode === 'points' && a.maxPoints > 0) {
          const raw = studentScoresForPerf
            .filter(s => s.assessmentId === a.id && s.score != null && s.score !== '' && isFinite(Number(s.score)))
            .map(s => Number(s.score));
          if (raw.length > 0) {
            const rawAvg = raw.reduce((sum, v) => sum + v, 0) / raw.length;
            const rounded = Math.round(rawAvg * 10) / 10; // one decimal
            displayLabel = `${rounded} / ${a.maxPoints}`;
          } else {
            displayLabel = '—';
          }
        } else {
          const r = Math.round(overall);
          displayLabel = PROF_LABELS[r] || '—';
        }
        return {
          id: a.id,
          title: a.title,
          date: a.date,
          categoryId: a.categoryId || a.category_id || null,
          categoryLabel: getAssessmentCategoryName(cid, a),
          avg: overall,
          displayLabel,
        };
      })
      .filter(a => a != null)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Saved quick-profile data
    const workHabits = rating.workHabits || 0;
    const participation = rating.participation || 0;
    const socialTraits = rating.socialTraits || [];
    const savedStrengths = rating.strengths || strengths.map(s => s.tag.id);
    const savedGrowth = rating.growthAreas || growthAreas.map(g => g.tag.id);
    const mentionAssessments = rating.mentionAssessments || [];

    let html = `<div class="tq-wrap">`;

    // ══ HEADER BAR (shared component) ══
    html += renderStudentHeader(cid, sid, {
      buttonLabel: 'Student Dashboard',
      buttonHref: `/student?course=${cid}&id=${sid}`,
      buttonSecondary: true,
    });

    // ══ ROW 1: Dispositions + Quick Profile (4/4/4) ══
    const PILL_TEXT = OBS_LEVEL_LABELS;
    const ratedLearning = LEARNING_DIMS.filter(d => (dims[d] || 0) > 0).length;
    const ratedRelational = RELATIONAL_DIMS.filter(d => (dims[d] || 0) > 0).length;

    const _renderDimPanel = (dimList, title, ratedCount, panelId) => {
      html += `<div class="tq-panel" data-panel-id="${panelId}">
      <div class="tq-panel-title">${title} <span class="tq-panel-badge">${ratedCount}/${dimList.length}</span></div>`;
      dimList.forEach(dim => {
        const val = dims[dim] || 0;
        html += `<div class="tq-dim-row${val > 0 ? ' rated' : ''}">
        <div class="tq-dim-header">
          <span class="tq-dim-label">${OBS_LABELS[dim]}</span>
        </div>
        <div class="tq-dim-pills">`;
        levelOrderFor(cid).forEach(lvl => {
          html += `<button class="tq-pill pill-${lvl}${val === lvl ? ' active' : ''}"
          data-action="tqSetDim" data-sid="${sid}" data-dim="${dim}" data-lvl="${lvl}">${PILL_TEXT[lvl]}</button>`;
        });
        html += `</div>
      </div>`;
      });
      html += `</div>`;
    };
    _renderDimPanel(LEARNING_DIMS, 'Learning Dispositions', ratedLearning, 'learning-dispositions');
    _renderDimPanel(RELATIONAL_DIMS, 'Relational & Identity', ratedRelational, 'relational-identity');

    // Quick Profile
    const RATE_LABELS = { 1: 'Rarely', 2: 'Sometimes', 3: 'Usually', 4: 'Consistently' };
    html += `<div class="tq-panel" data-panel-id="quick-profile">
    <div class="tq-panel-title">Quick Profile</div>`;
    ['workHabits', 'participation'].forEach(field => {
      const val = rating[field] || 0;
      const label = field === 'workHabits' ? 'Work Habits' : 'Participation';
      html += `<div class="tq-rate-row">
      <span class="tq-rate-label">${label}</span>
      <div class="tq-rate-pills">`;
      levelOrderFor(cid).forEach(lvl => {
        html += `<button class="tq-rate-pill rp-${lvl}${val === lvl ? ' active' : ''}"
        data-action="tqSetField" data-sid="${sid}" data-field="${field}" data-lvl="${lvl}">${RATE_LABELS[lvl]}</button>`;
      });
      html += `</div></div>`;
    });

    // Attendance: the totals so far this year, as MyEd shows them.
    const att = getTermAttendance(cid, sid, termId);
    const attSentence = ReportBlocks.attendanceSentence(student, att);
    const attMentioned = !!attSentence && _plainText(narrative).indexOf(attSentence) >= 0;
    html += `<div class="tq-rate-row tq-att-row">
      <div class="tq-att-head"><span class="tq-rate-label">Attendance</span><span class="tq-att-source">Totals to date, from MyEd</span></div>
      <div class="tq-att-fields">
        <label class="tq-att-field"><span>Classes Absent</span>
          <input type="number" min="0" step="1" inputmode="numeric" class="tq-att-input${
            att.absences != null && att.prevAbsences != null && att.absences < att.prevAbsences ? ' warn' : ''
          }" id="tq-att-absences" data-tq-att="absences" data-sid="${sid}" value="${att.absences == null ? '' : att.absences}" placeholder="—"></label>
        <label class="tq-att-field"><span>Times Late</span>
          <input type="number" min="0" step="1" inputmode="numeric" class="tq-att-input${
            att.lates != null && att.prevLates != null && att.lates < att.prevLates ? ' warn' : ''
          }" id="tq-att-lates" data-tq-att="lates" data-sid="${sid}" value="${att.lates == null ? '' : att.lates}" placeholder="—"></label>
      </div>
      <div class="tq-att-note" id="tq-att-note" aria-live="polite">${_attendanceNoteHtml(att)}</div>
      <button type="button" class="tq-assignment-row tq-att-mention${attMentioned ? ' selected' : ''}" id="tq-att-mention"
        data-action="tqToggleAttendanceMention" data-sid="${sid}" aria-pressed="${attMentioned}"${attSentence ? '' : ' disabled'}>
        <span class="tq-tag-check">${attMentioned ? '\u2713' : ''}</span>
        <span class="tq-assignment-title">Mention in Comment</span>
      </button>
    </div>`;

    // Trait chips
    const SOCIAL_TRAITS = [
      // Positive / character
      { id: 'leader', label: 'Leader' },
      { id: 'collaborative', label: 'Collaborative' },
      { id: 'independent', label: 'Independent' },
      { id: 'peer-mentor', label: 'Peer Mentor' },
      { id: 'risk-taker', label: 'Risk Taker' },
      { id: 'reflective', label: 'Reflective' },
      { id: 'creative', label: 'Creative Thinker' },
      { id: 'persistent', label: 'Persistent' },
      { id: 'organized', label: 'Organized' },
      { id: 'empathetic', label: 'Empathetic' },
      { id: 'curious', label: 'Curious' },
      { id: 'respectful', label: 'Respectful' },
      { id: 'positive-attitude', label: 'Positive Attitude' },
      { id: 'detail-oriented', label: 'Detail-Oriented' },
      { id: 'advocate', label: 'Self-Advocate' },
      // Concerns / areas to grow
      { id: 'needs-support', label: 'Needs Support' },
      { id: 'often-late', label: 'Often Late' },
      { id: 'device-issue', label: 'Device Issue' },
      { id: 'reminders-focus', label: 'Reminders to Focus' },
      { id: 'often-absent', label: 'Often Absent' },
      { id: 'incomplete-work', label: 'Incomplete Work' },
      { id: 'disorganized', label: 'Disorganized' },
      { id: 'off-task', label: 'Off-Task Behaviour' },
      { id: 'social-conflicts', label: 'Social Conflicts' },
      { id: 'low-confidence', label: 'Low Confidence' },
      { id: 'avoids-challenges', label: 'Avoids Challenges' },
      { id: 'rushed-work', label: 'Rushes Work' },
    ];
    const CONCERN_IDS = new Set([
      'needs-support',
      'often-late',
      'device-issue',
      'reminders-focus',
      'often-absent',
      'incomplete-work',
      'disorganized',
      'off-task',
      'social-conflicts',
      'low-confidence',
      'avoids-challenges',
      'rushed-work',
    ]);
    const posTraitList = SOCIAL_TRAITS.filter(t => !CONCERN_IDS.has(t.id));
    const negTraitList = SOCIAL_TRAITS.filter(t => CONCERN_IDS.has(t.id));
    html += `<div class="tq-traits-row">
      <span class="tq-traits-label">Traits</span>
      <div class="tq-traits-content">
        <div class="tq-trait-wrap">`;
    posTraitList.forEach(t => {
      html += `<button class="tq-trait-chip${socialTraits.includes(t.id) ? ' active' : ''}"
      data-action="tqToggleTrait" data-sid="${sid}" data-tid="${t.id}">${t.label}</button>`;
    });
    html += `</div>
        <div class="tq-trait-divider"></div>
        <div class="tq-trait-wrap">`;
    negTraitList.forEach(t => {
      html += `<button class="tq-trait-chip concern${socialTraits.includes(t.id) ? ' active' : ''}"
      data-action="tqToggleTrait" data-sid="${sid}" data-tid="${t.id}">${t.label}</button>`;
    });
    html += `</div>
      </div>
    </div></div>`;

    // ══ ROW 2: Observations (full-bleed, span 12) ══
    const mentionObs = rating.mentionObs || [];
    const recentObs = allObs.slice(0, 8);
    const reflectionEntries = Object.entries(studentReflections).filter(([, r]) => r && r.confidence > 0);

    html += `<div class="tq-panel" data-panel-id="observations">
    <div class="tq-panel-title spread">
      <span>Observations <span class="tq-panel-badge">${obsCount}</span></span>
      <div class="tq-obs-summary">`;
    Object.keys(OBS_SENTIMENTS).forEach(k => {
      if (sentimentCounts[k] > 0)
        html += `<span class="obs-pill obs-pill-type" data-sentiment="${k}">${OBS_SENTIMENTS[k].label} ${sentimentCounts[k]}</span>`;
    });
    if (topContext) html += `<span class="obs-pill">${esc(OBS_CONTEXTS[topContext[0]]?.label || topContext[0])}</span>`;
    html += `</div></div>`;

    if (recentObs.length > 0) {
      const hasAssignObs = recentObs.some(o => o.assignmentContext);
      const hasGenObs = recentObs.some(o => !o.assignmentContext);
      if (hasAssignObs && hasGenObs) {
        html += `<div class="seg seg-sm tq-obs-filter-bar" role="group" aria-label="Show observations">
        <button type="button" class="seg-btn tq-obs-filter-btn"${segAttr(_tqObsFilter === 'all')} data-action="tqObsFilter" data-filter="all">All</button>
        <button type="button" class="seg-btn tq-obs-filter-btn"${segAttr(_tqObsFilter === 'general')} data-action="tqObsFilter" data-filter="general">General</button>
        <button type="button" class="seg-btn tq-obs-filter-btn"${segAttr(_tqObsFilter === 'assignment')} data-action="tqObsFilter" data-filter="assignment">Assignment</button>
      </div>`;
      }
      const filteredObs = recentObs.filter(o =>
        _tqObsFilter === 'all' ? true : _tqObsFilter === 'assignment' ? !!o.assignmentContext : !o.assignmentContext,
      );
      html += `<div class="tq-obs-hint">Select to mention in narrative</div>`;
      html += `<div class="tq-evidence-list">`;
      filteredObs.forEach(ob => {
        const d = new Date(ob.created);
        const dateStr = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
        const sent = ob.sentiment && OBS_SENTIMENTS[ob.sentiment];
        const typePill = sent
          ? `<span class="obs-pill obs-pill-type" data-sentiment="${ob.sentiment}">${sent.label}</span> `
          : '';
        const selected = mentionObs.includes(ob.id);
        html += `<div class="tq-evidence-item${selected ? ' selected' : ''}" data-action="tqToggleOb" data-sid="${sid}" data-obid="${ob.id}">
        <span class="tq-tag-check"></span>
        <span class="tq-evidence-text"><span class="tq-evidence-sentiment">${typePill}</span>${ob.assignmentContext ? `<span class="tq-obs-assign-tag">${esc(ob.assignmentContext.assessmentTitle)}</span>` : ''}${esc(ob.text)}</span>
        <span class="tq-obs-wide-date">${dateStr}</span>
      </div>`;
      });
      html += `</div>`;
    } else {
      html += `<div class="tq-obs-empty">There are no observations for this student.</div>`;
    }
    html += `</div>`; // close observations panel

    // ══ ROW 3: Academic Snapshot (span 6) + Narrative (span 6) ══
    // Overall as the class grades: the proficiency word, the letter and %
    // ("B 78%"), or both. A competency shows its word, or in a Letter class
    // its % (level ÷ 4).
    const gradeMode = courseGradeMode(cid);
    const letterGrade = studentGradeBadges(cid, sid).letter;
    const overallParts = [];
    if (gradeMode !== 'letter' && overall > 0) overallParts.push(PROF_LABELS[Math.round(overall)]);
    if (letterGrade) overallParts.push(letterGrade.text);
    const overallLevel = studentGradeSummary(cid, sid).level;
    html += `<div class="tq-panel" data-panel-id="academic-snapshot">
    <div class="tq-panel-title">Academic Snapshot <span class="tq-panel-badge">${assignmentPerf.length} Assessed</span></div>
    <div class="tq-snapshot-grid">
      <div class="tq-snapshot-item overall">
        <div class="tq-snapshot-item-label">Overall</div>
        <div class="tq-snapshot-item-value" style="color:${PROF_COLORS[overallLevel] || 'var(--text-3)'};background:${PROF_TINT[overallLevel] || 'transparent'}">${overallParts.length ? overallParts.join(' \u00B7 ') : 'No data'}</div>
      </div>`;
    sections.forEach(sec => {
      const prof = getSectionProficiency(cid, sid, sec.id);
      const sr = Math.round(prof);
      html += `<div class="tq-snapshot-item">
      <div class="tq-snapshot-item-label">${esc(sec.shortName || sec.name)}</div>
      <div class="tq-snapshot-item-value" style="color:${PROF_COLORS[sr] || 'var(--text-3)'};background:${PROF_TINT[sr] || 'transparent'}">${levelWord(cid, prof) || formatLevel(cid, prof)}</div>
    </div>`;
    });
    html += `</div>`;

    // Assignment performance rows (toggleable for mention in narrative)
    if (assignmentPerf.length > 0) {
      html += `<div class="tq-assignment-section"><div class="tq-panel-title">Assignments — select to mention</div>
    <div class="tq-assignment-list">`;
      const cidCategories = typeof getCategories === 'function' ? getCategories(cid) || [] : [];
      assignmentPerf.forEach(a => {
        const r = Math.round(a.avg);
        const selected = mentionAssessments.includes(a.id);
        const catIdx = a.categoryId ? cidCategories.findIndex(c => c.id === a.categoryId) : -1;
        const catTint =
          typeof categoryTintByIndex === 'function' ? categoryTintByIndex(catIdx, a.categoryLabel) : { bg: '', fg: '' };
        html += `<div class="tq-assignment-row${selected ? ' selected' : ''}" data-action="tqToggleAssignment" data-sid="${sid}" data-aid="${a.id}">
        <span class="tq-tag-check">${selected ? '✓' : ''}</span>
        <span class="tq-assignment-title">${esc(a.title)}</span>
        <span class="tq-assignment-type" style="background:${catTint.bg};color:${catTint.fg}">${esc(a.categoryLabel)}</span>
        <span class="tq-assignment-score" style="color:${PROF_COLORS[r] || 'var(--text-3)'}">${esc(a.displayLabel)}</span>
      </div>`;
      });
      html += `</div></div>`;
    }

    // Self-reflections folded into academic-snapshot as a collapsed subsection
    if (reflectionEntries.length > 0) {
      html += `<details class="tq-reflections-subsection">
      <summary>Student Self-Reflections <span class="tq-panel-badge">${reflectionEntries.length}</span></summary>
      <div class="tq-reflections-body">`;
      reflectionEntries.forEach(([secId, ref]) => {
        const sec = sections.find(s => s.id === secId);
        const secName = sec ? sec.shortName || sec.name : secId;
        html += `<div class="tq-reflection-row">
        <span class="tq-reflection-label">${esc(secName)}</span>
        <span class="tq-reflection-val" style="color:${CONFIDENCE_COLORS[ref.confidence]}">${CONFIDENCE_LABELS[ref.confidence]}</span>
      </div>`;
      });
      html += `</div></details>`;
    }
    html += `</div>`; // close academic-snapshot panel

    html += `<div class="tq-panel" data-panel-id="narrative-comment">
    <div class="tq-panel-title">Narrative Comment</div>
    <div class="tq-editor-wrap">
      <div class="tq-toolbar">
        <div class="tq-toolbar-group">
          <button type="button" class="tq-tb-btn" data-action="tqExec" data-cmd="bold" title="Bold (⌘B)"><svg viewBox="0 0 24 24"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg></button>
          <button type="button" class="tq-tb-btn" data-action="tqExec" data-cmd="italic" title="Italic (⌘I)"><svg viewBox="0 0 24 24"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg></button>
          <button type="button" class="tq-tb-btn" data-action="tqExec" data-cmd="underline" title="Underline (⌘U)"><svg viewBox="0 0 24 24"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg></button>
        </div>
        <div class="tq-toolbar-group">
          <button type="button" class="tq-tb-btn" data-action="tqExec" data-cmd="insertUnorderedList" title="Bullet List"><svg viewBox="0 0 24 24"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg></button>
          <button type="button" class="tq-tb-btn" data-action="tqExec" data-cmd="insertOrderedList" title="Numbered List"><svg viewBox="0 0 24 24"><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><text x="4" y="8" font-size="7" fill="currentColor" stroke="none" font-weight="600">1</text><text x="4" y="14" font-size="7" fill="currentColor" stroke="none" font-weight="600">2</text><text x="4" y="20" font-size="7" fill="currentColor" stroke="none" font-weight="600">3</text></svg></button>
        </div>
        <div class="tq-toolbar-group">
          <button type="button" class="tq-tb-btn" data-action="tqExec" data-cmd="removeFormat" title="Clear Formatting"><svg viewBox="0 0 24 24"><path d="M17 4H7"/><path d="M12 4v7"/><path d="M4 20l16-16"/></svg></button>
        </div>
        <button type="button" class="tq-tb-btn tq-tb-copy" data-action="tqCopyNarrative" title="Copy to Clipboard" id="tq-copy-btn">
          <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>Copy</span>
        </button>
      </div>
      <div class="tq-narrative-editor" id="tq-narrative" contenteditable="true"
        data-placeholder="Write about ${esc(name)}'s learning dispositions, work habits, and growth…">${sanitizeHtml(narrative || '')}</div>
      <div class="tq-fit" id="tq-fit" hidden>
        <span class="tq-fit-text" id="tq-fit-text"></span>
        <button type="button" class="tq-fit-btn" data-action="tqSeePage" data-sid="${sid}">See the Page</button>
      </div>
    </div>
  </div>`; // close narrative-comment panel

    // ══ NAV FOOTER (full-width) ══
    html += `<div class="tq-nav-footer">
    <button class="tq-nav-btn" data-action="tqPrevStudent" ${tqStudentIndex === 0 ? 'disabled' : ''}>← Previous</button>
    <span class="tq-nav-counter">${tqStudentIndex + 1} of ${students.length}</span>
    <button class="tq-nav-btn primary" data-action="tqNextStudent">${tqStudentIndex >= students.length - 1 ? 'Done ✓' : 'Save & Next →'}</button>
  </div>`;

    html += `</div>`; // close tq-wrap
    return html;
  }

  /* ── Namespace ──────────────────────────────────────────── */
  return {
    configure: configure,
    getTqStudents: getTqStudents,
    tqPrevStudent: tqPrevStudent,
    tqNextStudent: tqNextStudent,
    tqSaveCurrentIfNeeded: tqSaveCurrentIfNeeded,
    tqSaveNarrative: tqSaveNarrative,
    tqExec: tqExec,
    tqUpdateToolbar: tqUpdateToolbar,
    tqCopyNarrative: tqCopyNarrative,
    tqSetDim: tqSetDim,
    tqSetField: tqSetField,
    tqSetAttendance: tqSetAttendance,
    tqToggleAttendanceMention: tqToggleAttendanceMention,
    tqToggleTrait: tqToggleTrait,
    tqToggleAssignment: tqToggleAssignment,
    tqToggleOb: tqToggleOb,
    tqSelectStudent: tqSelectStudent,
    renderTermQuestionnaire: renderTermQuestionnaire,
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
    get tqObsFilter() {
      return _tqObsFilter;
    },
    set tqObsFilter(v) {
      _tqObsFilter = v;
    },
  };
})();
