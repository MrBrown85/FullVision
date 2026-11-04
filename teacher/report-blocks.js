/* report-blocks.js — Report block renderers (extracted from page-reports.js) */
window.ReportBlocks = (function () {
  'use strict';

  /* ── Report context ──────────────────────────────────────────
     Block renderers are pure: they take the report's term as an argument
     and never read the page. The one place that reads the term picker is
     reportContext(), for the Reports page and the questionnaire. */
  function termIdFromPeriod(period) {
    period = (period || 'Report 1').trim();
    // Map "Report N" → "term-N" for backwards compatibility with stored data
    const m = period.match(/Report\s+(\d+)/i);
    if (m) return 'term-' + m[1];
    return period
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+$/, '');
  }

  /** { termId: 'term-2', termLabel: 'Nov Report Card' } from the term picker. */
  function reportContext() {
    const sel = typeof document !== 'undefined' ? document.getElementById('report-period') : null;
    const opt = sel && sel.options ? sel.options[sel.selectedIndex] : null;
    return { termId: termIdFromPeriod(sel && sel.value), termLabel: opt ? opt.text : '' };
  }

  function getTermId() {
    return reportContext().termId;
  }

  /* The year's attendance as one sentence for the comment, from the totals
     to date (getTermAttendance). Empty when neither number is entered. */
  function attendanceSentence(student, att) {
    const first = displayNameFirst(student);
    const a = att ? att.absences : null;
    const l = att ? att.lates : null;
    const missed =
      a == null ? '' : a === 0 ? 'has not missed any classes' : 'has missed ' + a + (a === 1 ? ' class' : ' classes');
    const late =
      l == null
        ? ''
        : l === 0
          ? a === 0
            ? 'has always been on time'
            : 'has not been late'
          : 'has been late ' + l + (l === 1 ? ' time' : ' times');
    if (!missed && !late) return '';
    if (missed && late) return first + ' ' + missed + ' this year and ' + late + '.';
    return first + ' ' + (missed || late) + ' this year.';
  }

  /* ── Pronoun helpers ─────────────────────────────────────── */
  /* The pronouns a sentence about this student uses. A stored value counts
     only when it parses as a set: he/him, she/her, they/them, or a custom
     subject/object[/possessive] (ze/zir/zir). "prefer not to say", "not
     set", empty, or anything else means no pronouns on file, and the
     student reads as they/them/their with plural verbs (Colin, Nov 1,
     #596). onFile says whether a set parsed.
     A known subject (she, he, they, xe, ze, zie, ey, fae, ve, it) followed
     by another subject ("she/they", "xe/they") or by forms of its own set
     ("he/his", "she/hers", "they/theirs", "xe/xem") reads as its full set:
     she/her/her, he/him/his, they/them/their, xe/xem/xyr, ze/zir/zir,
     fae/faer/faer. An unknown subject followed by a subject ("co/they")
     takes them/their. Anything else, such as "ze/hir/hir", is used as
     written. */
  // subject: [object, possessive, possessive pronoun, reflexive]
  const PRONOUN_SETS = {
    she: ['her', 'her', 'hers', 'herself'],
    he: ['him', 'his', 'his', 'himself'],
    they: ['them', 'their', 'theirs', 'themselves'],
    xe: ['xem', 'xyr', 'xyrs', 'xemself'],
    ze: ['zir', 'zir', 'zirs', 'zirself'],
    zie: ['zir', 'zir', 'zirs', 'zirself'],
    ey: ['em', 'eir', 'eirs', 'emself'],
    fae: ['faer', 'faer', 'faers', 'faerself'],
    ve: ['ver', 'vis', 'vis', 'verself'],
    it: ['it', 'its', 'its', 'itself'],
  };
  function getPronouns(student) {
    const raw = String((student && student.pronouns) || '')
      .trim()
      .toLowerCase();
    const parts = raw ? raw.split('/').map(x => x.trim()) : [];
    const word = x => /^[a-z]{2,}$/.test(x || '');
    const ok = parts.length >= 2 && parts.length <= 3 && parts.every(word) && parts[0] !== parts[1];
    const subj = ok ? parts[0] : 'they';
    const set = PRONOUN_SETS[subj];
    const isSubject = x => Object.prototype.hasOwnProperty.call(PRONOUN_SETS, x);
    const rest = ok ? parts.slice(1) : [];
    let obj, poss, refl;
    const ownForms = set && rest.every(x => set.indexOf(x) >= 0);
    if (!ok || (set && (isSubject(rest[0]) || ownForms))) {
      [obj, poss, , refl] = set;
    } else if (!set && isSubject(rest[0])) {
      obj = 'them';
      poss = 'their';
      refl = 'themself';
    } else if (subj === 'she' || subj === 'he' || subj === 'they') {
      obj = parts[1];
      poss = set[1];
      refl = set[3];
    } else {
      obj = parts[1];
      poss = parts[2] || obj;
      refl = obj + 'self';
    }
    const verb = subj === 'they' ? '' : 's';
    return { subj, obj, poss, refl, verb, capSubj: subj[0].toUpperCase() + subj.slice(1), onFile: ok };
  }

  /* ●●●○ for level 3: the level as a shape, so a photocopy still reads it
     (DECISIONS.md, "Report forms" 6). Nothing for no evidence. */
  function levelDots(level) {
    const n = Math.max(0, Math.min(4, Math.round(Number(level) || 0)));
    if (n === 0) return '';
    return `<span class="report-dots" aria-hidden="true">${'\u25CF'.repeat(n)}${'\u25CB'.repeat(4 - n)}</span>`;
  }

  /* sanitizeNarrativeHtml — delegates to shared sanitizeHtml in gb-ui.js */
  function sanitizeNarrativeHtml(raw) {
    return sanitizeHtml(raw);
  }

  /* A student's scores as levels: points work becomes its level on the
     grading scale (18/20 is Extending, not level 18), a + or − is counted in
     (3+ = 3.33), and excused work is left out. Same as the proficiency calc. */
  function _levelScores(cid, sid) {
    const tagIds = [...new Set((getScores(cid)[sid] || []).map(s => s.tagId))];
    return tagIds.flatMap(tagId => getTagScores(cid, sid, tagId));
  }

  const OBS_DESCRIPTORS = {
    // Learning Dispositions
    engagement: {
      prompt: 'I participate actively and stay focused on my learning',
      desc: 'Active participation and focus in learning',
      example: 'Stays on task, asks questions, contributes ideas',
    },
    curiosity: {
      prompt: 'I explore new ideas, take risks in my thinking, and connect learning to the world around me',
      desc: 'Exploring ideas, taking intellectual risks, and connecting to place',
      example: 'Asks "what if?", tries new approaches, ventures into unfamiliar territory',
    },
    selfRegulation: {
      prompt: 'I manage my time, reflect on my learning, and understand my own growth',
      desc: 'Managing time and emotions while developing reflective awareness',
      example: 'Plans ahead, reflects on what worked, recognizes own growth areas',
    },
    resilience: {
      prompt: 'I keep trying when things are difficult and learn from setbacks',
      desc: 'Persevering through challenges and adapting',
      example: "Tries again after mistakes, seeks help, doesn't give up",
    },
    // Relational & Identity
    belonging: {
      prompt: 'I feel part of our learning community and connected to the people and places around me',
      desc: 'Feeling connected to community, place, and learning environment',
      example: 'Seeks connection with teacher and classmates, feels at home in class, engages with community',
    },
    identity: {
      prompt: 'I know my strengths, explore who I am, and bring my whole self to learning',
      desc: 'Developing self-knowledge, personal identity, and awareness of gifts',
      example: 'Can name own strengths, brings personal/cultural knowledge to learning, growing self-awareness',
    },
    collaboration: {
      prompt: 'I work well with others and support my group',
      desc: 'Working effectively with others',
      example: 'Shares ideas, listens to peers, supports group goals',
    },
    respect: {
      prompt: 'I show care for my classmates and our community',
      desc: 'Showing care for others and the community',
      example: 'Kind words, active listening, inclusive behavior',
    },
    responsibility: {
      prompt: 'I think about how my actions affect others and give back to my community',
      desc: 'Recognizing consequences of actions and contributing to community',
      example: 'Shares what they learn, considers impact on others, takes on roles that help the group',
    },
  };

  /* ══════════════════════════════════════════════════════════════
   REPORT BLOCK RENDERERS — Each renders one configurable block
   ══════════════════════════════════════════════════════════════ */
  /* "Sep 2 – Nov 14, 2026": one year when both dates share it. */
  function _formatDateRange(a, b) {
    if (!a || !b) return '';
    const da = parseLocalDate(a);
    const db = parseLocalDate(b);
    const short = { month: 'short', day: 'numeric' };
    const long = { month: 'short', day: 'numeric', year: 'numeric' };
    const first = da.toLocaleDateString('en-CA', da.getFullYear() === db.getFullYear() ? short : long);
    return first + ' \u2013 ' + db.toLocaleDateString('en-CA', long);
  }

  /* The letterhead: school (when the class uses a school's preset terms),
     class and block, the student; then the report by its name, the term's
     dates, the teacher and the student number. DECISIONS.md, "Report forms" 7. */
  function renderBlockHeader(cid, student, ctx, options) {
    options = options || {};
    const course = COURSES[cid];
    const period = (ctx && ctx.termLabel) || '';
    const terms = typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [];
    const match =
      terms.length && typeof reportingTermsSchoolMatch === 'function' ? reportingTermsSchoolMatch(terms) : null;
    const school = options.school !== false && match && match.school ? match.school.name : '';
    const n = Number((((ctx && ctx.termId) || '').match(/^term-(\d+)$/) || [])[1]);
    const term = terms.find(t => Number(t.ordinal) === n) || null;
    const block = typeof courseBlockLabel === 'function' ? courseBlockLabel(course) : '';
    const teacher = (typeof getConfig === 'function' && getConfig().displayName) || '';

    const titleParts = [school, course.name, block, period].filter(Boolean);
    let dates = term && options.dates !== false ? _formatDateRange(term.starts_on, term.ends_on) : '';
    if (dates && term.label && term.label !== period) dates = esc(term.label) + ' \u00B7 ' + dates;
    const meta = [
      dates ? ['Term', dates] : null,
      teacher && options.teacher !== false ? ['Teacher', esc(teacher)] : null,
      student.studentNumber && options.studentNumber !== false ? ['Student No.', esc(student.studentNumber)] : null,
    ]
      .filter(Boolean)
      .map(([k, v]) => `<span class="report-header-k">${k}</span><span>${v}</span>`)
      .join('');

    return `<div class="report-header">
    <div class="report-header-main">
      <div class="report-course-title">${esc(titleParts.join(' \u00B7 '))}</div>
      <div class="report-student-name">${esc(printedStudentName(student, options.name))}</div>
    </div>
    <div class="report-header-meta">${meta}</div>
  </div>`;
  }

  /* The line at the top of every side after the Front, so a loose sheet names its
     student: the name as the letterhead prints it, the class and block.
     options: the letterhead's ({ name }). */
  function renderContinuedLine(cid, student, options) {
    const course = COURSES[cid] || {};
    const block = typeof courseBlockLabel === 'function' ? courseBlockLabel(course) : '';
    const parts = [printedStudentName(student, (options || {}).name), course.name, block].filter(Boolean);
    return `<div class="sheet-name-line">${esc(parts.join(' \u00B7 '))} (continued)</div>`;
  }

  /* ctx: the report ({ termId }); its reporting basis can print IE, or No
     Letter Grade for language or IEP goals, in place of the letter
     (calc.js reportingBasis). */
  function renderBlockAcademicSummary(cid, student, ctx) {
    const sections = getSections(cid);
    const overall = getOverallProficiency(cid, student.id);
    const overallRound = Math.round(overall);
    const cc = getCourseConfig(cid);
    const usePercentage = cc.reportAsPercentage || false;
    const course = COURSES[cid];
    const isLetter = courseShowsLetterGrades(course);
    const letterData = getCourseLetterData(cid, student.id);
    const profDisplay = overall > 0 ? PROF_LABELS[overallRound] : 'No Evidence';
    let overallDisplay, overallHeading;
    // Letter and Both classes lead with the letter and %, as Class Summary
    // does ("A (97%)"). Both also keeps the proficiency word under it.
    let profLine = '';
    if (isLetter) {
      overallHeading = 'Overall Grade';
      overallDisplay = letterData && letterData.S ? `${letterData.S} (${letterData.R}%)` : 'No Evidence';
      const basis = reportingBasis(cid, student.id, ctx && ctx.termId);
      if (basis !== 'grade') {
        overallDisplay = REPORTING_BASIS_TEXT[basis];
        profLine = `<div class="report-overall-label" style="margin-top:6px">${esc(REPORTING_BASIS_NOTE[basis])}</div>`;
      }
      if (course.gradingSystem === 'both') {
        profLine += `<div class="report-overall-label" style="margin-top:6px">Overall Proficiency: ${profDisplay}</div>`;
      }
    } else if (usePercentage && (overall > 0 || (letterData && letterData.R != null))) {
      overallDisplay =
        letterData && letterData.R != null ? letterData.R + '%' : Math.round(levelToPercent(cid, overall)) + '%';
      overallHeading = 'Overall Grade';
    } else {
      overallDisplay = profDisplay;
      overallHeading = 'Overall Proficiency';
    }
    let html = `<div class="report-overall">
    <div class="report-overall-main">
      <div class="report-overall-label">${overallHeading}</div>
      <div class="report-overall-word">${overallDisplay}</div>${profLine}
    </div>
    <div class="report-overall-sections">`;
    const _rptGrouped = getGroupedSections(cid);
    const _renderChip = (name, prof, color) => {
      const sr = Math.round(prof);
      const slabel = prof > 0 ? esc(levelText(cid, prof)) : 'No Evidence';
      const scolor = PROF_COLORS[sr] || PROF_COLORS[0];
      return `<div class="report-section-chip">
      <div class="report-section-chip-name" style="color:${cssColor(color)}">${esc(name)}</div>
      <div class="report-section-chip-value" data-prof="${sr}" style="color:${scolor}">${prof > 0 ? levelDots(sr) : ''}${slabel}</div>
    </div>`;
    };
    if (_rptGrouped.groups.some(gi => gi.sections.length > 0)) {
      // One chip per group (averaged) + one per ungrouped section
      _rptGrouped.groups.forEach(gi => {
        if (gi.sections.length === 0) return;
        const gp = getGroupProficiency(cid, student.id, gi.group.id);
        html += _renderChip(gi.group.name, gp, gi.group.color);
      });
      _rptGrouped.ungrouped.forEach(sec => {
        const sp = getSectionProficiency(cid, student.id, sec.id);
        html += _renderChip(sec.shortName || sec.name, sp, sec.color);
      });
    } else {
      sections.forEach(sec => {
        const sp = getSectionProficiency(cid, student.id, sec.id);
        html += _renderChip(sec.shortName || sec.name, sp, sec.color);
      });
    }
    html += `</div></div>`;
    return html;
  }

  // renderBlockNarrative removed — teacher-narrative block now handles all narrative output

  /* ── Learning Dispositions ────────────────────────────────────────
     The six work habits the teacher rated in the Term Questionnaire
     (term_rating.habits, DECISIONS 14), as how often: Rarely · Sometimes ·
     Usually · Consistently. Not Seen and unrated habits are left off (Only
     Rated off lists the unrated with a dash); a student with none rated
     prints no block. Three columns at Row width, one at Side by Side. No
     dots, no bars; Developing only means proficiency. */
  function renderBlockLearnerDimensions(cid, student, ctx, options) {
    options = options || {};
    const half = options.size === 'half';
    const termId = ctx && ctx.termId;
    const rating = getStudentTermRating(cid, student.id, termId);
    const habits = (rating && rating.habits) || {};
    const bank = window.CommentBank;
    const scale = bank.SCALE;
    const rated = h => habits[h.key] >= 1 && habits[h.key] <= 4;
    if (!bank.HABITS.some(rated)) return '';
    const rows = bank.HABITS.filter(h => rated(h) || (options.rated === false && habits[h.key] !== bank.NOT_SEEN))
      .map(
        h =>
          `<div class="report-disp-row"><span>${esc(h.name)}</span><span class="report-disp-word" data-level="${rated(h) ? habits[h.key] : 0}">${esc(rated(h) ? scale[habits[h.key] - 1] : '\u2014')}</span></div>`,
      )
      .join('');
    return `<div class="report-block-box report-learner-profile${half ? ' report-disp-half' : ''}">
    <div class="report-prof-head report-disp-head"><div class="report-block-title">Learning Dispositions</div>${options.scale !== false ? '<div class="report-prof-meta">Teacher observation · Rarely · Sometimes · Usually · Consistently</div>' : ''}</div>
    <div class="report-disp">${rows}</div>
  </div>`;
  }

  /* The Teacher Comment box around already-safe HTML. The sheet engine
     measures one line of it to size the room the form reserves. */
  function renderCommentBox(contentHtml) {
    let html = `<div class="report-block-box report-comment-box" style="page-break-inside:avoid">`;
    html += `<div class="report-block-title">Teacher Comment</div>`;
    html += `<div class="report-comment-text" style="font-size:0.88rem;color:var(--text);line-height:1.6;padding:4px 0">${contentHtml}</div>`;
    html += `</div>`;
    return html;
  }

  // A comment saved by the old editor is HTML until it is next edited; the
  // questionnaire saves plain text, a paragraph per line.
  const HTML_COMMENT = /<\/?(p|div|br|ul|ol|li|b|i|u|strong|em|span)\b[^>]*>/i;

  /* A term comment as it goes home: the report card, the Quick Report's
     Term Comment card and phone reports all print it through this. A
     comment saved before Nov 2 may say [date] in its Deadline sentence: it
     never prints. The sentence is left out until a deadline is picked, then
     says the date; a saved date that has passed or falls after the school
     year counts as none. An approved comment is printed as approved. */
  function printableComment(cid, rating, narrative) {
    narrative = String(narrative == null ? '' : narrative);
    if (HTML_COMMENT.test(narrative) || (rating && rating.approvedAt)) return narrative;
    if (typeof CommentBank === 'undefined' || !CommentBank.withDeadline) return narrative;
    const iso = rating && rating.ieDeadline;
    const ok = !iso || !CommentBank.deadlineOk || CommentBank.deadlineOk(cid, iso);
    return CommentBank.withDeadline(narrative, iso, ok);
  }

  function renderBlockTeacherNarrative(cid, student, ctx) {
    const termId = ctx && ctx.termId;
    // ctx.narrativeOverride is the questionnaire's unsaved draft, so the
    // editor can say how the comment will sit on the form while it is typed.
    let narrative;
    const rating = getStudentTermRating(cid, student.id, termId);
    if (ctx && ctx.narrativeOverride != null) narrative = ctx.narrativeOverride;
    else narrative = rating && rating.narrative;
    if (!narrative || !String(narrative).trim()) return '';
    const isHtml = HTML_COMMENT.test(String(narrative));
    narrative = printableComment(cid, rating, narrative);
    const content = isHtml
      ? sanitizeNarrativeHtml(narrative.trim())
      : narrative
          .trim()
          .split(/\n+/)
          .map(p => p.trim())
          .filter(Boolean)
          .map(p => `<p>${esc(p)}</p>`)
          .join('');
    return renderCommentBox(content);
  }

  /* ── Curricular Competencies table ──────────────────────────────
     One row per competency (grouped when the class groups them), the level
     as dots and a word that follows the class's grading setting, and how
     many assessments the level rests on. A fixed block: its rows come from
     the learning map, so its height is the same for every student. */
  /* A competency's level as the class's grading setting shows it: dots and
     the word, the letter, or both with the %. Nothing computes a grade
     here; calc.js does (formatLevel). */
  function _levelHtml(cid, sp) {
    const r = Math.round(sp);
    const mode = courseGradeMode(cid);
    if (!(sp > 0)) return '<span class="report-ct-none">No evidence yet</span>';
    if (mode === 'proficiency') return levelDots(r) + esc(PROF_LABELS[r] || '');
    if (mode === 'letter') return levelDots(r) + esc(formatLevel(cid, sp));
    return (
      levelDots(r) +
      esc(PROF_LABELS[r] || '') +
      ' <span class="report-ct-pct">' +
      esc(formatLevel(cid, sp).split(' \u00B7 ').pop()) +
      '</span>'
    );
  }

  /* The class's competencies in report order: grouped sections first, then
     the ungrouped, else every section. */
  function _reportSections(cid) {
    const grouped = getGroupedSections(cid);
    if (grouped.groups.some(g => g.sections.length)) {
      const out = [];
      grouped.groups.forEach(g => g.sections.forEach(sec => out.push(sec)));
      grouped.ungrouped.forEach(sec => out.push(sec));
      return out;
    }
    return getSections(cid);
  }

  function renderBlockCompetencyTable(cid, student, ctx, options) {
    options = options || {};
    const showEvidence = options.evidence !== false;
    const hideEmpty = options.noEvidence === 'hide';
    const titles = {};
    if (options.assignments) getAssessments(cid).forEach(a => (titles[a.id] = a.title));
    const cols = showEvidence ? 3 : 2;
    const grouped = getGroupedSections(cid);
    const row = sec => {
      const sp = getSectionProficiency(cid, student.id, sec.id);
      const r = Math.round(sp);
      const ids = new Set();
      (sec.tags || []).forEach(tag => {
        getTagScores(cid, student.id, tag.id).forEach(sc => {
          if (sc.score > 0) ids.add(sc.assessmentId);
        });
      });
      if (!(sp > 0) && hideEmpty) return '';
      const level = _levelHtml(cid, sp);
      let notes = '';
      if (options.ican) {
        const icans = (sec.tags || [])
          .map(t => (t.i_can_statements || [])[0])
          .filter(Boolean)
          .slice(0, 3);
        if (icans.length) notes += `<div class="report-ct-note">${icans.map(esc).join(' \u00B7 ')}</div>`;
      }
      if (options.assignments && ids.size) {
        const names = Array.from(ids)
          .map(id => titles[id])
          .filter(Boolean);
        const shown = names.slice(0, 4).map(esc).join(', ');
        notes += `<div class="report-ct-note">${shown}${names.length > 4 ? ` and ${names.length - 4} more` : ''}</div>`;
      }
      return `<tr><td class="report-ct-name">${esc(sec.shortName || sec.name)}${notes}</td><td class="report-ct-level" data-prof="${sp > 0 ? r : 0}">${level}</td>${showEvidence ? `<td class="report-ct-evidence">${ids.size}</td>` : ''}</tr>`;
    };
    let rows = '';
    if (grouped.groups.some(g => g.sections.length)) {
      grouped.groups.forEach(g => {
        if (!g.sections.length) return;
        rows += `<tr class="report-ct-group"><td colspan="${cols}">${esc(g.group.name)}</td></tr>`;
        g.sections.forEach(sec => (rows += row(sec)));
      });
      grouped.ungrouped.forEach(sec => (rows += row(sec)));
    } else {
      getSections(cid).forEach(sec => (rows += row(sec)));
    }
    if (!rows) return '';
    return `<div class="report-block-box report-competency-table">
    <div class="report-block-title">Curricular Competencies</div>
    <table class="report-ct"><thead><tr><th>Competency</th><th>Level</th>${showEvidence ? '<th class="report-ct-evidence">Evidence</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>
    <div class="report-ct-legend">${levelDots(1)}Emerging &nbsp; ${levelDots(2)}Developing &nbsp; ${levelDots(3)}Proficient &nbsp; ${levelDots(4)}Extending</div>
  </div>`;
  }

  function renderBlockObservations(cid, student) {
    // Private (Concern, Note) observations never print.
    const quickObs = getStudentQuickObs(cid, student.id).filter(ob => !isPrivateObservation(ob));
    const recentObs = quickObs.slice(0, 5);
    if (recentObs.length === 0) return '';
    let html = `<div class="report-learner-profile">`;
    html += `<div class="report-learner-title">Observation Evidence</div>`;
    html += `<div class="report-obs-notes">`;
    recentObs.forEach(ob => {
      const dimPills = (ob.dims || [])
        .map(d => {
          const info = resolveTag(d);
          return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:0.62rem;padding:1px 6px;border-radius:8px;background:var(--overlay-hover);color:var(--text-2);margin-left:4px;"><span style="width:5px;height:5px;border-radius:50%;background:${info.color};display:inline-block;"></span>${esc(info.label)}</span>`;
        })
        .join('');
      const assignPill = ob.assignmentContext
        ? `<span style="font-size:0.55rem;font-weight:600;color:var(--link);background:rgba(0,122,255,0.08);padding:1px 6px;border-radius:8px;margin-right:4px">${esc(ob.assignmentContext.assessmentTitle)}</span>`
        : '';
      html += `<div class="report-obs-note">${assignPill}${esc(ob.text)}${dimPills}
      <div class="report-obs-note-date">${formatDate(ob.created || ob.date)}</div>
    </div>`;
    });
    html += `</div></div>`;
    return html;
  }

  function renderBlockSectionOutcomes(cid, student) {
    const sections = getSections(cid);
    const assessments = getAssessments(cid);
    const allScores = getScores(cid)[student.id] || [];
    let html = `<div class="report-block-box">
    <div class="report-block-title">Learning Outcomes</div>
    <div style="font-size:0.62rem;color:var(--text-3);margin:-2px 0 6px">Competency levels: ${esc(describeCalcMethod(cid))}</div>`;
    sections.forEach(sec => {
      const secProf = getSectionProficiency(cid, student.id, sec.id);
      const sr = Math.round(secProf);
      // Only an override that applies to this report (dated by its end).
      const secOverride = sectionOverrideInView(cid, student.id, sec.id);
      html += `<div class="report-outcome-section" style="page-break-inside:avoid">
      <div class="report-outcome-section-header" style="display:flex;align-items:center;justify-content:space-between">
        <span>${esc(sec.shortName || sec.name)}</span>`;
      if (secProf > 0) {
        html += `<span data-prof="${sr}" style="font-size:0.68rem;font-weight:600;color:${PROF_COLORS[sr]}">${esc(levelText(cid, secProf))}</span>`;
      }
      html += `</div>`;
      if (secOverride) {
        // The level the scores give now, worked out here rather than taken
        // from the server.
        const calculated = getSectionProficiencyRaw(cid, student.id, sec.id);
        html += `<div style="font-size:0.62rem;color:var(--text-3);font-style:italic;margin:2px 0 6px;padding-left:2px">Teacher override (calculated: ${esc([formatLevel(cid, calculated), levelWord(cid, calculated)].filter(Boolean).join(' '))}): ${esc(secOverride.reason)}</div>`;
      }
      sec.tags.forEach(tag => {
        const prof = getTagProficiency(cid, student.id, tag.id);
        const r = Math.round(prof);
        const color = PROF_COLORS[r] || PROF_COLORS[0];
        const tint = PROF_TINT[r] || PROF_TINT[0];
        const label = prof > 0 ? esc(levelText(cid, prof)) : 'Not yet assessed';
        const barPct = levelBarPercent(cid, prof);
        // Gather per-tag assessment evidence. getTagScores turns points into
        // a level (18/20 is Extending, not level 18) and leaves out excused work.
        const tagScores = getTagScores(cid, student.id, tag.id).filter(s => s.score > 0);
        const evidenceMap = {};
        tagScores.forEach(s => {
          if (!evidenceMap[s.assessmentId]) evidenceMap[s.assessmentId] = [];
          evidenceMap[s.assessmentId].push(s.score);
        });
        const evidence = Object.keys(evidenceMap)
          .map(aId => {
            const a = assessments.find(x => x.id === aId);
            if (!a) return null;
            const avg = evidenceMap[aId].reduce((s, x) => s + x, 0) / evidenceMap[aId].length;
            const ar = Math.round(avg);
            return { title: a.title, r: ar, label: PROF_LABELS[ar] || '?' };
          })
          .filter(Boolean);
        html += `<div class="report-outcome-row">
        <div class="report-outcome-info">
          <div class="report-outcome-label">${esc(tag.label || tag.text)}</div>`;
        // Evidence: assignment names with proficiency in brackets — displayed as a wrapping block
        if (evidence.length > 0) {
          const evStr = evidence
            .map(
              e =>
                `<span class="report-outcome-ev" data-prof="${e.r}" style="color:${PROF_COLORS[e.r] || 'var(--text-3)'}">${esc(e.title)}\u2009<span style="font-weight:600">[${e.label[0]}]</span></span>`,
            )
            .join('<span style="color:var(--text-3);margin:0 3px">·</span>');
          html += `<div class="report-outcome-evidence">${evStr}</div>`;
        }
        if (tag.text && tag.text !== tag.label) {
          html += `<div class="report-outcome-statement">${esc(tag.text)}</div>`;
        }
        // Render I Can statements as student-facing language
        if (tag.i_can_statements && tag.i_can_statements.length > 0) {
          html += `<ul class="report-ican-list">`;
          tag.i_can_statements.forEach(stmt => {
            html += `<li class="report-ican-item">${esc(stmt)}</li>`;
          });
          html += `</ul>`;
        }
        html += `</div>
        <div class="report-outcome-status">
          <div class="report-outcome-bar"><div class="report-outcome-bar-fill" data-prof-bg="${r}" style="width:${barPct}%;background:${color}"></div></div>
          <span class="report-outcome-pill report-level-pill" data-prof="${r}" data-prof-bg="${r}" style="background:${prof > 0 ? tint : 'var(--overlay-hover)'};color:${prof > 0 ? color : 'var(--text-3)'}">${prof > 0 ? levelDots(r) : ''}${label}</span>
        </div>
      </div>`;
      });
      html += `</div>`;
    });
    html += `</div>`;
    return html;
  }

  /* ── The Focus Area ─────────────────────────────────────────────
     One competency per student, used by Next Steps, Ways to Support at
     Home and Progress in One Area: the one picked in the Term
     Questionnaire (rating.focusSectionId) when there is one, else the one
     whose level changed most since the last report (or the start of this
     term), ties to the lowest now. Returns { sec, name, then, now } or
     null without evidence. */
  function _areaRows(cid, student, ctx) {
    const sid = student.id;
    const sections = _reportSections(cid);
    const last = _lastReportLevels(cid, sid, sections);
    return sections
      .map((sec, i) => {
        const now = getSectionProficiency(cid, sid, sec.id);
        const then = last ? last.levels[i] : _startLevel(cid, sid, sec);
        return {
          sec,
          name: _competencyLabel(sec),
          then: then > 0 ? then : 0,
          now,
          thenLabel: last ? last.label : 'Start of Term',
        };
      })
      .filter(r => r.now > 0);
  }
  function focusArea(cid, student, ctx, which) {
    const rows = _areaRows(cid, student, ctx);
    if (!rows.length) return null;
    const termId = ctx && ctx.termId;
    const rating = typeof getStudentTermRating === 'function' ? getStudentTermRating(cid, student.id, termId) : null;
    const picked = rating && rating.focusSectionId ? rows.find(r => r.sec.id === rating.focusSectionId) : null;
    if ((!which || which === 'focus') && picked) return Object.assign({ picked: true }, picked);
    const sorted = rows.slice();
    if (which === 'highest') sorted.sort((a, b) => b.now - a.now);
    else if (which === 'lowest') sorted.sort((a, b) => a.now - b.now);
    else {
      // The biggest change, then the lowest now. by says which picked it,
      // so a block never calls a change of 0.0 the biggest (step 4 group 3
      // #63).
      const change = r => (r.then > 0 ? Math.abs(Math.round(r.now * 10) - Math.round(r.then * 10)) : -1);
      sorted.sort((a, b) => change(b) - change(a) || a.now - b.now);
      return Object.assign({ by: change(sorted[0]) > 0 ? 'change' : 'lowest' }, sorted[0]);
    }
    return sorted[0];
  }
  /* A section's scored work, in date order: [{ a, d, score }], the highest
     mark per assessment. Each mark is the competency's on the piece, as the
     gradebook shows it: rubric criteria that disagree give the lowest
     (Colin, 2026-11-03). Progress in One Area, Next Steps and Ways to
     Support at Home read it. */
  function _sectionWork(cid, sid, sec) {
    const byId = {};
    getAssessments(cid).forEach(a => (byId[a.id] = a));
    const best = {};
    (sec.tags || []).forEach(tag => {
      // One mark per piece of work on each competency (tagMarksByAssessment).
      tagMarksByAssessment(cid, sid, tag.id).forEach(sc => {
        if (!(sc.score > 0) || !byId[sc.assessmentId]) return;
        if (!best[sc.assessmentId] || sc.score > best[sc.assessmentId]) best[sc.assessmentId] = sc.score;
      });
    });
    return Object.keys(best)
      .map(id => ({
        a: byId[id],
        d: typeof _assessmentDate === 'function' ? _assessmentDate(byId[id]) : byId[id].date || '',
        score: best[id],
      }))
      .sort((x, y) => (x.d || '').localeCompare(y.d || ''));
  }
  /* "Chemical Reactions Lab, Oct 12 · 3.3 / 4 Proficient" */
  /* A mark as the class reads it: "3.3 / 4 Proficient", "83%" for a
     letter class, "3.3 / 4 · 83% Proficient" for Both. `word` false drops
     the proficiency word. `own`: the piece's own % (_ownPercent), printed
     in place of the % its level counts as. */
  function _mark(cid, v, word, own) {
    if (!(v > 0)) return '\u2014';
    const mode = courseGradeMode(cid);
    const pct = own || formatLevelAs(cid, v, 'percent');
    if (mode === 'letter') return pct;
    const fig = levelFigure(v) + ' / 4' + (mode === 'both' ? ' \u00B7 ' + pct : '');
    return word === false ? fig : fig + ' ' + _profWord(v);
  }
  /* Points and Complete/Incomplete work's own %, points earned out of
     possible (calc.js), as Generate prints it (#565): its level is only a
     band of that %, so the % its level counts as is not what it earned.
     null for other work. */
  function _ownPct(cid, sid, a) {
    if (!a || !isPointsScored(a)) return null;
    const pc = getAssessmentGroupPercentage(cid, sid, [a]);
    return pc && pc.pct != null ? pc.pct : null;
  }
  function _ownPercent(cid, sid, a) {
    const pct = _ownPct(cid, sid, a);
    return pct == null ? null : formatPointsPercent(pct, 100);
  }
  /* One piece's mark: w is { a, score }, or a whole piece (_wholeWork)
     with the text it prints. */
  function _workMark(cid, sid, w, word) {
    if (w.text) return w.text;
    return _mark(cid, w.score, word, _ownPercent(cid, sid, w.a));
  }
  /* A piece's whole mark as Assignment Grades prints it by default
     (assessmentCellValue, _rowMarks): { a, score, ownPct, text }, or null
     for work with no level (Complete/Incomplete, Missing, Excused, DIBELS)
     (step 4 group 2 #3). */
  function _wholeWork(cid, sid, a) {
    const cv = assessmentCellValue(cid, sid, a);
    const mode = courseGradeMode(cid);
    if (cv.kind === 'points') {
      const m = _rowMarks(cid, a, cv);
      const text = mode === 'letter' ? m.percent : mode === 'both' ? m.score + ' \u00B7 ' + m.percent : m.score;
      return { a, score: cv.level, ownPct: _ownPct(cid, sid, a), text };
    }
    if (cv.kind === 'level' && cv.value > 0) {
      return { a, score: cv.value, ownPct: cv.percent, text: _mark(cid, cv.value, false, cv.percentText) };
    }
    return null;
  }
  /* Orders pieces { a, score } best first (or lowest first, best false).
     A Letter or Both class ranks them by the % it prints for them (points
     work's own %, else the % the level counts as), level as tie-break, so
     a 17/20 (85%) is above a 3+ (83%); a Proficiency class by level. */
  function _byMark(cid, sid, best) {
    const pctOn = courseGradeMode(cid) !== 'proficiency';
    const shown = w => {
      const own = w.ownPct != null ? w.ownPct : _ownPct(cid, sid, w.a);
      return own != null ? own : levelToPercent(cid, w.score);
    };
    return (x, y) => {
      const [p, q] = best ? [y, x] : [x, y];
      // Whole pieces at one level (16/20 and 17/20) go by the % they earned.
      return (pctOn ? shown(p) - shown(q) : 0) || p.score - q.score || (p.text && q.text ? shown(p) - shown(q) : 0);
    };
  }
  /* The pieces a Best or Lowest line names: at the highest (or lowest)
     mark (_byMark), at most two, sharing the mark the line prints.
     Returns { list, mark } or null. */
  function _namedWork(cid, sid, items, best) {
    if (!items.length) return null;
    const sorted = items.slice().sort(_byMark(cid, sid, best));
    // A piece that scored two of the tied competencies is named once, at
    // its best (or lowest) mark among them.
    const once = sorted.filter((w, i) => sorted.findIndex(x => x.a === w.a) === i);
    const mark = _workMark(cid, sid, once[0], false);
    return { list: once.filter(w => _workMark(cid, sid, w, false) === mark).slice(0, 2), mark };
  }
  /* "Chemical Reactions Lab, Oct 12 · 3.3 / 4 Proficient" */
  function _workLine(cid, sid, w) {
    const when = _assessmentWhen(w.a);
    return esc(w.a.title || '') + (when ? ', ' + when : '') + ' \u00B7 ' + esc(_workMark(cid, sid, w));
  }
  function _firstICan(sec) {
    const tag = (sec.tags || []).find(t => (t.i_can_statements || []).length);
    return tag ? String(tag.i_can_statements[0]).trim() : '';
  }

  /* ── Next Steps ───────────────────────────────────────────────────
     The Focus Area (and the next lowest competency on request): its I Can
     statement and the student's latest score on it. The student's goal
     prints in Self-Assessment and Goal, not here. */
  function renderBlockNextSteps(cid, student, ctx, options) {
    options = options || {};
    const half = options.size === 'half';
    const focus = focusArea(cid, student, ctx, 'focus');
    if (!focus) return '';
    const areas = [focus];
    if (options.areas === 'two') {
      const next = _areaRows(cid, student, ctx)
        .filter(r => r.sec.id !== focus.sec.id)
        .sort((a, b) => a.now - b.now)[0];
      if (next) areas.push(next);
    }
    const rows = areas
      .map(r => {
        const ican = _firstICan(r.sec);
        const work = _sectionWork(cid, student.id, r.sec);
        const latest = work[work.length - 1];
        return (
          `<div class="report-steps-k">${esc(r.name)}</div><div class="report-steps-v">${ican ? '“' + esc(ican) + '”' : 'Keep building on this competency.'}</div>` +
          (options.latest !== false && latest
            ? `<div></div><div class="report-steps-latest">Latest: ${_workLine(cid, student.id, latest)}</div>`
            : '')
        );
      })
      .join('');
    return `<div class="report-block-box report-next-steps${half ? ' report-steps-half' : ''}">
    <div class="report-block-title">Next Steps</div>
    <div class="report-steps">${rows}</div>
  </div>`;
  }

  /* ── Progress in One Area ──────────────────────────────────────────
     One competency (the Focus Area, or the lowest or highest now) as
     figures: every score this term with its date and work, the level at
     the start of the term and now with the change, the best and latest
     work, and the first I Can statement to work toward. Side by Side
     stacks the facts over the list. */
  function renderBlockProgress(cid, student, ctx, options) {
    options = options || {};
    const half = options.size === 'half';
    const which = options.area === 'lowest' || options.area === 'highest' ? options.area : 'focus';
    const area = focusArea(cid, student, ctx, which);
    if (!area) return '';
    const work = _sectionWork(cid, student.id, area.sec).filter(w => assessmentInTermWindow(cid, w.a));
    // Now is the competency's level as calc.js grades it (override
    // included), the year to date as of the report's end, the figure the
    // Proficiency block prints. Then is the same competency at the last
    // report, the year to date as of its end, as the Proficiency block's
    // column (_lastReportLevels); on the first report, the start of the
    // term on the same footing, each rubric criterion its own score
    // (_sectionStart): the first weeks' mean, or with too few dated scores
    // the first piece's. A start inside a later term beside a year-to-date
    // Now would compare two different spans of work. The pieces below show
    // the gradebook's mark on each (_sectionWork).
    const sinceLast = area.thenLabel && area.thenLabel !== 'Start of Term';
    const startV = sinceLast ? area.then : _startLevel(cid, student.id, area.sec);
    const nowV = area.now;
    const bests = _namedWork(cid, student.id, work, true);
    const latest = work[work.length - 1];
    const sub = (area.sec.tags || [])[0] && area.sec.tags[0].label !== area.sec.name ? area.sec.name : '';
    const why =
      which === 'lowest'
        ? 'Lowest now'
        : which === 'highest'
          ? 'Highest now'
          : area.picked
            ? 'Focus area'
            : area.by === 'lowest'
              ? 'Focus area (lowest now)'
              : 'Focus area (biggest change)';
    const when = a => (_assessmentWhen(a) ? ', ' + _assessmentWhen(a) : '');
    const facts = [];
    if (options.startNow !== false && (startV > 0 || nowV > 0)) {
      // Figures as the class reads them: a level and its word, or a % for a letter class.
      const letter = courseGradeMode(cid) === 'letter';
      const plain = v => formatLevel(cid, v) + (letter ? '' : ' ' + _profWord(v));

      facts.push([sinceLast ? esc(area.thenLabel) : 'Start of term', esc(plain(startV))]);
      facts.push([
        'Now',
        `<b>${esc(plain(nowV))}</b> <span class="report-progress-chg">(${esc(levelChangeAs(cid, startV, nowV))} ${sinceLast ? 'since ' + esc(area.thenLabel) : 'this term'})</span>`,
      ]);
    }
    if (options.best !== false && bests) {
      facts.push(['Best', bests.list.map(w => esc(w.a.title || '') + when(w.a)).join(' · ') + ' · ' + esc(bests.mark)]);
    }
    if (options.latest !== false && latest) {
      facts.push([
        'Latest',
        esc(latest.a.title || '') + when(latest.a) + ' · ' + esc(_workMark(cid, student.id, latest, false)),
      ]);
    }
    const ican = _firstICan(area.sec);
    if (options.toward !== false && ican) facts.push(['Working toward', '“' + esc(ican) + '”']);
    const factsHtml = facts.map(([k, v]) => `<span class="report-progress-k">${k}</span><span>${v}</span>`).join('');
    let list = '';
    if (options.list !== false && work.length) {
      list =
        `<div class="report-progress-list"><div class="report-progress-lh"><span>Date</span><span>Every score this term</span><span class="report-progress-n">Score</span></div>` +
        work
          .map(
            w =>
              `<div class="report-progress-li"><span class="report-progress-date">${esc(_assessmentWhen(w.a))}</span><span class="report-progress-title">${esc(w.a.title || '')}</span><span class="report-progress-n">${esc(courseGradeMode(cid) === 'letter' ? _workMark(cid, student.id, w) : levelFigure(w.score))}</span></div>`,
          )
          .join('') +
        '</div>';
    }
    if (!factsHtml && !list) return '';
    return `<div class="report-block-box report-progress${half ? ' report-progress-half' : ''}">
    <div class="report-prof-head"><div class="report-block-title">Progress: ${esc(area.name)}${sub ? ` <span class="report-progress-sub">· ${esc(sub)}</span>` : ''}</div><div class="report-prof-meta">${esc(why)}</div></div>
    <div class="report-progress-body">${factsHtml ? `<div class="report-progress-facts">${factsHtml}</div>` : ''}${list}</div>
  </div>`;
  }

  /* ── Proficiency ────────────────────────────────────────────────
     Each competency's level as figures: the score out of 4 at the last
     report (or the start of this term) and now, the proficiency word, the
     change, and how many assessments the level rests on; Overall on top;
     two lines of facts under the table naming the highest and lowest
     competencies now and the best and lowest work. Rows are the class's
     competencies in curriculum order (or lowest first), named by the
     competency's own label; a class with groups prints a heading per
     group and Other Competencies for the rest, or one averaged row per
     group. More than 12 rows go in two columns, a group never split. No
     dots, no colour. Replaces Overall and Competencies, the Competency
     Table and Growth Since Last Report (DECISIONS "Report forms" 13). */
  function _competencyLabel(sec) {
    const tag = (sec.tags || [])[0];
    return (tag && tag.label) || sec.name || '';
  }
  /* The assessments a section's level rests on: distinct, scored, and
     the best and lowest of them with their dates. */
  function _sectionEvidence(cid, sid, sec) {
    const titles = {};
    getAssessments(cid).forEach(a => (titles[a.id] = a));
    const byId = {};
    (sec.tags || []).forEach(tag => {
      // The competency's mark on each piece, as the gradebook shows it.
      tagMarksByAssessment(cid, sid, tag.id).forEach(sc => {
        if (!(sc.score > 0)) return;
        const prev = byId[sc.assessmentId];
        if (!prev || sc.score > prev.score) byId[sc.assessmentId] = { score: sc.score, a: titles[sc.assessmentId] };
      });
    });
    const list = Object.keys(byId).map(id => byId[id]);
    return { count: list.length, list };
  }
  /* A section's scores on one piece of work, each rubric criterion its own
     (calc.js getTagScores), as one level (averageLevels); 0 without any. */
  function _pieceLevel(cid, sid, sec, a) {
    const entries = [];
    (sec.tags || []).forEach(tag =>
      getTagScores(cid, sid, tag.id).forEach(sc => {
        if (sc.assessmentId === a.id) entries.push(sc);
      }),
    );
    return averageLevels(entries) || 0;
  }
  /* A section's level at the start of this term, from its scores in date
     order (calc.js startAndNow); null without enough dated scores. */
  function _sectionStart(cid, sid, sec) {
    const now = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    return _pass('start|' + cid + '|' + sid + '|' + (now ? now.ordinal : '') + '|' + sec.id, () =>
      _sectionStartNow(cid, sid, sec),
    );
  }
  /* A section's Start of Term as every block prints it: _sectionStart, or
     with too few dated scores the first piece's level this term; 0 without
     any. The Proficiency table printed "—" where Progress in One Area
     printed the first piece's level (step 4 group 3 #63). */
  function _startLevel(cid, sid, sec) {
    const start = _sectionStart(cid, sid, sec);
    if (start != null) return start;
    const work = _sectionWork(cid, sid, sec).filter(w => assessmentInTermWindow(cid, w.a));
    return work.length ? _pieceLevel(cid, sid, sec, work[0].a) : 0;
  }
  function _sectionStartNow(cid, sid, sec) {
    // The start is measured inside the report's own term (the scores read
    // are the year to date as of its end; Colin, 2026-11-03).
    const dates = {};
    getAssessments(cid).forEach(a => {
      const d = typeof _assessmentDate === 'function' ? _assessmentDate(a) : a.date || a.dueDate || null;
      if (d && assessmentInTermWindow(cid, a)) dates[a.id] = d;
    });
    const points = [];
    (sec.tags || []).forEach(tag => {
      getTagScores(cid, sid, tag.id).forEach(sc => {
        const d = dates[sc.assessmentId];
        if (!(sc.score > 0) || !d) return;
        points.push({ t: Math.round(parseLocalDate(d).getTime() / 86400000), v: sc.score });
      });
    });
    const r = startAndNow(points);
    return r ? r.start : null;
  }
  /* Every section's level at the last report: the year to date as of the
     previous reporting term's end, read through calc.js with that term in
     view and put back (Colin, 2026-11-03); null without one. Labelled by
     its report ("Report 1"). */
  /* The previous term's levels and the start-of-term levels are read by
     Proficiency and by every Focus Area block for the same student in one
     render; they are kept until the current task ends (scores can't change
     inside it). */
  let _passCache = null;
  function _pass(key, make) {
    if (!_passCache) {
      _passCache = {};
      Promise.resolve().then(() => (_passCache = null));
    }
    if (!(key in _passCache)) _passCache[key] = make();
    return _passCache[key];
  }
  function _lastReportLevels(cid, sid, sections) {
    const now = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    const key = 'last|' + cid + '|' + sid + '|' + (now ? now.ordinal : '') + '|' + sections.map(s => s.id).join(',');
    return _pass(key, () => _lastReportLevelsNow(cid, sid, sections));
  }
  function _lastReportLevelsNow(cid, sid, sections) {
    const now = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    if (!now) return null;
    const prev = previousReportTerm(cid);
    if (!prev) return null;
    const before = readAsOfTerm(cid, prev.ordinal, () => sections.map(sec => getSectionProficiency(cid, sid, sec.id)));
    if (!before.some(v => v > 0)) return null;
    return { label: reportName(prev), levels: before };
  }
  /* The course % (calc.js getCourseLetterData), null without one. */
  function _coursePct(cid, sid) {
    const lg = getCourseLetterData(cid, sid);
    return lg && lg.R != null ? lg.R : null;
  }
  /* The course grade at the last report (the year to date as of its end),
     read as _lastReportLevels reads levels: { text, pct, level }, or null
     without a previous term. */
  function _lastReportCourse(cid, sid) {
    const now = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    if (!now) return null;
    const prev = previousReportTerm(cid);
    if (!prev) return null;
    return _pass('course|' + cid + '|' + sid + '|' + now.ordinal, () =>
      readAsOfTerm(cid, prev.ordinal, () => {
        const g = studentGradeSummary(cid, sid);
        return g.text ? { text: g.text, pct: _coursePct(cid, sid), level: getOverallProficiency(cid, sid) } : null;
      }),
    );
  }
  function _profWord(v) {
    return v > 0 ? PROF_LABELS[Math.min(4, Math.max(1, Math.round(v)))] : '';
  }
  function _assessmentWhen(a) {
    const d = a && (typeof _assessmentDate === 'function' ? _assessmentDate(a) : a.date || a.dueDate);
    if (!d) return '';
    const dt = parseLocalDate(d);
    return dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function renderBlockProficiency(cid, student, ctx, options) {
    options = options || {};
    const sid = student.id;
    const half = options.size === 'half';
    const showScore = options.score !== false;
    const autoWord = showDefaults(cid).word;
    const showWord = (options.word === 'auto' || options.word == null ? autoWord : options.word !== false) && !half;
    const showChange = options.change !== false;
    const showAssessed = options.assessed !== false;
    const hideEmpty = options.noEvidence === 'hide';
    const lowestFirst = options.order === 'lowest';
    const mode = courseGradeMode(cid);
    const grouped = getGroupedSections(cid);
    const hasGroups = grouped.groups.some(g => g.sections.length);
    const sections = _reportSections(cid);
    if (!sections.length) return '';

    // Then and now, per section. After the first report the comparison is
    // always the last report's year-to-date level, Start of Term or not: a
    // start inside this term beside a year-to-date Now would compare two
    // spans of work (2026-11-03). Start of Term is the first report's.
    const last = _lastReportLevels(cid, sid, sections);
    const thenLabel = last ? last.label : 'Start of Term';
    const nowLabel = 'Now';
    const rowsBySection = {};
    sections.forEach((sec, i) => {
      const now = getSectionProficiency(cid, sid, sec.id);
      const then = last ? last.levels[i] : _startLevel(cid, sid, sec);
      const ev = _sectionEvidence(cid, sid, sec);
      rowsBySection[sec.id] = { sec, name: _competencyLabel(sec), then: then > 0 ? then : 0, now, ev };
    });
    const live = sections.map(sec => rowsBySection[sec.id]).filter(r => r.now > 0 || !hideEmpty);
    if (!live.length) return '';

    // A figure as the class shows it: the score out of 4, or the % for a
    // letter class, with the proficiency word where it is on.
    const fig = v => {
      if (!(v > 0)) return '<span class="report-ct-none">—</span>';
      // The class's figure: 3.2, 80%, or 3.2 · 80% for Both (calc.js).
      const num = formatLevel(cid, v);
      const parts = [];
      if (showScore) parts.push(esc(num));
      if (showWord) parts.push(esc(_profWord(v)));
      if (!parts.length) parts.push(esc(num));
      return parts.join(' ');
    };
    const change = (a, b) => levelChangeAs(cid, a, b);
    const colCount = 2 + (showChange ? 1 : 0) + (showAssessed ? 1 : 0) + 1;
    const head = (nameLabel, short) =>
      `<tr><th>${nameLabel}</th><th class="report-prof-n">${esc(short ? thenLabel.replace(/^(Term|Start of Term)$/, m => (m === 'Start of Term' ? 'Start' : m)) : thenLabel)}</th><th class="report-prof-n">${nowLabel}</th>${showChange ? '<th class="report-prof-n">Change</th>' : ''}${showAssessed ? `<th class="report-prof-n">${short ? 'Ev.' : 'Assessed'}</th>` : ''}</tr>`;
    const tr = (name, then, now, n, cls, count) =>
      `<tr${cls ? ` class="${cls}"` : ''}><td class="report-ct-name">${esc(name)}${count ? `<span class="report-prof-count"> · ${count} competenc${count === 1 ? 'y' : 'ies'}</span>` : ''}</td><td class="report-prof-n">${fig(then)}</td><td class="report-prof-n">${fig(now)}</td>${showChange ? `<td class="report-prof-n">${esc(change(then, now))}</td>` : ''}${showAssessed ? `<td class="report-prof-n report-prof-ev">${n}</td>` : ''}</tr>`;
    const headRow = name => `<tr class="report-ct-group"><td colspan="${colCount}">${esc(name)}</td></tr>`;
    const sortRows = list => (lowestFirst ? list.slice().sort((a, b) => (a.now || 9) - (b.now || 9)) : list);
    const avg = (list, k) => {
      const v = list.map(r => r[k]).filter(x => x > 0);
      return v.length ? v.reduce((t, x) => t + x, 0) / v.length : 0;
    };

    // Overall: the class's roll-up now, and then from the same rows.
    const overallNow = getOverallProficiency(cid, sid);
    // Then rolls up through competency groups as Now does.
    const overallThen = rollUpSectionLevels(cid, sec => {
      const r = rowsBySection[sec.id];
      return r && live.indexOf(r) >= 0 ? r.then : 0;
    });
    // Assessed: each assessment once, however many competencies it scored.
    const assessedOnce = rs => {
      const ids = new Set();
      rs.forEach(r => r.ev.list.forEach(w => ids.add(w.a || w)));
      return ids.size;
    };
    // A Letter or Both class's Overall is the course grade, as the Back's
    // Course Grade prints it (studentGradeSummary), so a report has one
    // overall figure; then is the course grade at the last report (step 4
    // group 2 #2). A Proficiency class rolls its competencies up.
    let overallRow = '';
    if (options.overall !== false && mode === 'proficiency') {
      overallRow = tr('Overall', overallThen, overallNow, assessedOnce(live), 'report-prof-overall');
    } else if (options.overall !== false) {
      const termId = ctx && ctx.termId;
      const nowG = { text: studentGradeSummary(cid, sid, termId).text, pct: _coursePct(cid, sid), level: overallNow };
      const thenG = last ? _lastReportCourse(cid, sid) : null;
      const cell = (g, lvl) =>
        g && g.text
          ? esc(g.text) + (showWord && mode === 'both' && lvl > 0 ? ' ' + esc(_profWord(lvl)) : '')
          : '<span class="report-ct-none">—</span>';
      let ch = '\u2014';
      if (thenG && mode === 'both') ch = levelChange(thenG.level, nowG.level);
      else if (thenG && thenG.pct != null && nowG.pct != null) {
        const d = Math.round((nowG.pct - thenG.pct) * 10) / 10;
        ch = (d > 0 ? '+' : d < 0 ? '\u2212' : '') + Math.abs(d) + '%';
      }
      overallRow = `<tr class="report-prof-overall"><td class="report-ct-name">Overall</td><td class="report-prof-n">${cell(thenG, thenG && thenG.level)}</td><td class="report-prof-n">${cell(nowG, overallNow)}</td>${showChange ? `<td class="report-prof-n">${esc(ch)}</td>` : ''}${showAssessed ? `<td class="report-prof-n report-prof-ev">${assessedOnce(live)}</td>` : ''}</tr>`;
    }

    // The rows: blocks that never split across columns. A folder prints as
    // one row (its competencies averaged, as calc.js does) or as its
    // competencies under its name. Rows (options.rows): As Graded ('auto',
    // the default) prints a folder as one row where the grade counts it as
    // one (folderCountsAsOne); Each Folder ('group') every folder; Each
    // Competency ('each') none. Competencies in no folder print one by one.
    const blocks = [];
    const printed = [];
    const rowsMode = options.rows === 'group' || options.rows === 'each' ? options.rows : 'auto';
    const asOne = g =>
      rowsMode === 'group' ||
      (rowsMode === 'auto' && (typeof folderCountsAsOne !== 'function' || folderCountsAsOne(cid, g.group)));
    // A folder's work: each assessment once, at its best score in the folder.
    const folderEvidence = rs => {
      const byA = new Map();
      rs.forEach(r =>
        r.ev.list.forEach(w => {
          const prev = byA.get(w.a || w);
          if (!prev || w.score > prev.score) byA.set(w.a || w, w);
        }),
      );
      const list = Array.from(byA.values());
      return { count: list.length, list };
    };
    let folderRowsOnly = hasGroups;
    if (hasGroups) {
      const loose = grouped.ungrouped.map(sec => rowsBySection[sec.id]).filter(r => live.indexOf(r) >= 0);
      let run = [];
      const flush = () => {
        if (run.length)
          blocks.push(sortRows(run).map(r => tr(r.name, r.then, r.now, r.ev.count, 'report-prof-group', r.count)));
        run = [];
      };
      grouped.groups.forEach(g => {
        const rs = g.sections.map(sec => rowsBySection[sec.id]).filter(r => live.indexOf(r) >= 0);
        if (!rs.length) return;
        if (asOne(g)) {
          const row = {
            name: g.group.name,
            then: avg(rs, 'then'),
            now: getGroupProficiency(cid, sid, g.group.id),
            ev: folderEvidence(rs),
            count: rs.length,
          };
          run.push(row);
          printed.push(row);
        } else {
          flush();
          folderRowsOnly = false;
          blocks.push([headRow(g.group.name)].concat(sortRows(rs).map(r => tr(r.name, r.then, r.now, r.ev.count))));
          rs.forEach(r => printed.push(r));
        }
      });
      flush();
      if (loose.length) {
        folderRowsOnly = false;
        blocks.push(
          [headRow('Other Competencies')].concat(sortRows(loose).map(r => tr(r.name, r.then, r.now, r.ev.count))),
        );
        loose.forEach(r => printed.push(r));
      }
    } else {
      blocks.push(sortRows(live).map(r => tr(r.name, r.then, r.now, r.ev.count)));
      live.forEach(r => printed.push(r));
    }
    const byGroup = hasGroups && folderRowsOnly;
    const total = blocks.reduce((t, b) => t + b.length, 0);
    const twoCols = !half && !byGroup && total > 12;
    const nameLabel = byGroup ? 'Group' : 'Competency';
    let body;
    if (twoCols) {
      let left = [];
      let right = [];
      if (blocks.length === 1) {
        const cut = Math.ceil(blocks[0].length / 2);
        left = blocks[0].slice(0, cut);
        right = blocks[0].slice(cut);
      } else {
        let acc = 0;
        blocks.forEach(b => {
          if (!right.length && acc + b.length / 2 <= total / 2) {
            left = left.concat(b);
            acc += b.length;
          } else right = right.concat(b);
        });
      }
      const table = rows =>
        `<table class="report-ct report-prof"><thead>${head(nameLabel, true)}</thead><tbody>${rows.join('')}</tbody></table>`;
      body =
        (overallRow
          ? `<table class="report-ct report-prof report-prof-top"><tbody>${overallRow}</tbody></table>`
          : '') + `<div class="report-prof-cols">${table(left)}${table(right)}</div>`;
    } else {
      body = `<table class="report-ct report-prof"><thead>${head(nameLabel, half)}</thead><tbody>${overallRow}${blocks.map(b => b.join('')).join('')}</tbody></table>`;
    }

    // The facts: the highest and lowest competencies now, and the best and
    // lowest work in them.
    let facts = '';
    if (options.facts !== false) {
      const ranked = printed
        .filter(r => r.now > 0)
        .slice()
        .sort((a, b) => b.now - a.now);
      if (ranked.length) {
        const ties = (list, pick) => list.filter(r => Math.round(r.now * 10) === Math.round(pick.now * 10)).slice(0, 3);
        const names = list =>
          list
            .map(r => r.name)
            .join(', ')
            .replace(/, ([^,]*)$/, list.length > 2 ? ', and $1' : ' and $1');
        // A piece named as best work is not named again as lowest work
        // (step 4 group 2 #2): a rubric can put one piece at the top of one
        // competency and the bottom of another.
        const namedBest = new Set();
        // Each piece prints its whole mark, as Assignment Grades does, not
        // its mark on one competency, so one piece shows one score on the
        // report; work with no level is left out (step 4 group 2 #3).
        const whole = new Map();
        const wholeOf = a => {
          if (!whole.has(a)) whole.set(a, _wholeWork(cid, sid, a));
          return whole.get(a);
        };
        const work = (list, best) => {
          const items = [];
          list.forEach(r =>
            r.ev.list.forEach(w => {
              const piece = w.a && (best || !namedBest.has(w.a)) && wholeOf(w.a);
              if (piece) items.push(piece);
            }),
          );
          const top = _namedWork(cid, sid, items, best);
          if (!top) return '';
          if (best) top.list.forEach(w => namedBest.add(w.a));
          const named = top.list
            .map(w => esc(w.a.title) + (_assessmentWhen(w.a) ? ' (' + _assessmentWhen(w.a) + ')' : ''))
            .join(' and ');
          return ` ${best ? 'Best' : 'Lowest'} work: ${named}, ${esc(top.mark)}.`;
        };
        const hi = ties(ranked, ranked[0]);
        const lo = ties(ranked.slice().reverse(), ranked[ranked.length - 1]);
        facts += `<div class="report-prof-fact"><b>Highest now:</b> ${esc(names(hi))} ${esc(formatLevel(cid, hi[0].now))}.${work(hi, true)}</div>`;
        if (ranked.length > 1 && Math.round(lo[0].now * 10) !== Math.round(hi[0].now * 10)) {
          facts += `<div class="report-prof-fact"><b>Lowest now:</b> ${esc(names(lo))} ${esc(formatLevel(cid, lo[0].now))}.${work(lo, false)}</div>`;
        }
      }
    }
    const course = COURSES[cid] || {};
    const meta = (half ? '' : 'Curricular Competencies · ') + esc(course.name || '');
    return `<div class="report-block-box report-proficiency${half ? ' report-prof-half' : ''}">
    <div class="report-prof-head"><div class="report-block-title">Proficiency</div><div class="report-prof-meta">${meta}</div></div>
    ${body}${facts ? `<div class="report-prof-facts">${facts}</div>` : ''}
  </div>`;
  }

  /* The BC Proficiency Scale as one strip: the figure and the word for
     each level, with a few words of what it means. Two by two at Side by
     Side width. No dots. */
  const LEGEND_LEVELS = [
    [1, PROF_LABELS[1], 'Initial understanding'],
    [2, PROF_LABELS[2], 'Partial understanding'],
    [3, PROF_LABELS[3], 'Complete understanding'],
    [4, PROF_LABELS[4], 'Sophisticated understanding'],
  ];
  /* A Letter class prints its levels as percents, so its legend gives
     the % each level counts as (formatLevel) and no "out of 4" (step 4
     group 2 #2). */
  function renderBlockLegend(options, cid) {
    const half = options && options.size === 'half';
    const asPct = cid != null && courseGradeMode(cid) === 'letter';
    const items = LEGEND_LEVELS.map(
      ([n, word, what]) =>
        `<div class="report-legend-item"><div class="report-legend-word">${asPct ? esc(formatLevel(cid, n)) : n} \u00B7 ${word}</div><div class="report-legend-desc">${what}</div></div>`,
    ).join('');
    return `<div class="report-block-box report-legend${half ? ' report-legend-half' : ''}">
    <div class="report-legend-title">${asPct ? 'BC Proficiency Scale' : 'BC Proficiency Scale, out of 4'}</div>
    <div class="report-legend-items">${items}</div>
  </div>`;
  }

  /* ── Parent / Guardian Response ── */
  /* options.lines: the comments box's writing room, from the form. */
  function renderBlockParentResponse(cid, student, options) {
    const lines = Math.max(1, Number((options && options.lines) || 3));
    const name = esc(displayNameFirst(student));
    let html = `<div class="report-block-box report-parent-response">`;
    html += `<div class="report-block-title">Parent / Guardian Response</div>`;
    html += `<div class="report-parent-intro" style="font-size:0.78rem;color:var(--text-2);margin-bottom:14px;line-height:1.5">Please review this report with your child and return this section to the school.</div>`;
    // Signature + Date
    html += `<div class="report-parent-lines">
    <div class="report-parent-line"><span class="report-parent-label">Signature</span><span class="report-parent-field"></span></div>
    <div class="report-parent-line" style="max-width:180px"><span class="report-parent-label">Date</span><span class="report-parent-field"></span></div>
  </div>`;
    // Phone + Email
    html += `<div class="report-parent-lines">
    <div class="report-parent-line"><span class="report-parent-label">Phone</span><span class="report-parent-field"></span></div>
    <div class="report-parent-line"><span class="report-parent-label">Email</span><span class="report-parent-field"></span></div>
  </div>`;
    // Checkboxes
    html += `<div class="report-parent-checks">
    <div class="report-parent-check"><span class="report-parent-checkbox"></span> I have reviewed this report with my child</div>
    <div class="report-parent-check"><span class="report-parent-checkbox"></span> I would like to schedule a meeting with the teacher</div>
    <div class="report-parent-check"><span class="report-parent-checkbox"></span> I have questions about my child's progress</div>
  </div>`;
    // Comments
    html += `<div class="report-parent-comments" style="margin-top:14px">
    <div class="report-parent-label" style="margin-bottom:6px">Comments or Questions</div>
    <div class="report-parent-comments-box" style="border:1.5px solid var(--border);border-radius:8px;min-height:${lines * 22 + 16}px;padding:8px"></div>
  </div>`;
    html += `</div>`;
    return html;
  }

  /* ── Student Self-Reflection: My Learning ── */
  function renderBlockStudentReflectionLearning(cid, student) {
    const name = esc(displayNameFirst(student));
    const scale = ['Rarely', 'Sometimes', 'Usually', 'Consistently'];
    let html = `<div class="report-block-box" style="page-break-inside:avoid">`;
    html += `<div class="report-block-title">How I See Myself as a Learner</div>`;
    html += `<div style="font-size:0.76rem;color:var(--text-2);margin-bottom:12px">${name}, rate yourself honestly on each learning disposition. Fill in one circle per row.</div>`;
    // Scale header
    html += `<div style="display:flex;justify-content:flex-end;gap:0;margin-bottom:4px;padding-right:4px">`;
    scale.forEach(s => {
      html += `<span style="width:68px;text-align:center;font-size:0.56rem;font-weight:700;color:var(--text-3)">${s}</span>`;
    });
    html += `</div>`;
    // Disposition rows — grouped
    const _reflectGroup = (dims, title) => {
      html += `<div style="font-size:0.72rem;font-weight:700;color:var(--text-2);padding:10px 0 2px;border-top:1.5px solid var(--border)">${title}</div>`;
      dims.forEach(dim => {
        const info = OBS_DESCRIPTORS[dim];
        html += `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--divider-subtle)">
        <div style="flex:1;min-width:0">
          <div style="font-size:0.82rem;font-weight:700;color:var(--text)">${OBS_LABELS[dim]}</div>
          <div style="font-size:0.7rem;color:var(--text-2);font-style:italic;line-height:1.3">${info.prompt}</div>
        </div>
        <div style="display:flex;gap:0;flex-shrink:0">`;
        scale.forEach(() => {
          html += `<span style="width:68px;display:flex;justify-content:center"><span class="report-reflect-bubble"></span></span>`;
        });
        html += `</div></div>`;
      });
    };
    _reflectGroup(LEARNING_DIMS, 'Learning Dispositions');
    _reflectGroup(RELATIONAL_DIMS, 'Relational & Identity');
    // Open response
    html += `<div class="report-reflect-open" style="margin-top:16px;padding-top:14px;border-top:1.5px solid var(--border)">
    <div class="report-reflect-open-line"><span class="report-reflect-open-label">My biggest strength as a learner:</span><span class="report-reflect-open-field"></span></div>
    <div class="report-reflect-open-line"><span class="report-reflect-open-label">One thing I want to work on:</span><span class="report-reflect-open-field"></span></div>
    <div class="report-reflect-open-line"><span class="report-reflect-open-label">What helps me learn best:</span><span class="report-reflect-open-field"></span></div>
  </div>`;
    html += `</div>`;
    return html;
  }

  /* ── Student Self-Reflection: My Habits ── */
  function renderBlockStudentReflectionHabits(cid, student) {
    const name = esc(displayNameFirst(student));
    const habits = [
      { text: 'I arrive to class on time' },
      { text: 'I come prepared with materials' },
      { text: 'I participate in class discussions' },
      { text: 'I hand in assignments on time' },
      { text: 'When I miss class, I check in and catch up' },
      { text: 'I am respectful to classmates and teachers' },
      { text: 'I manage distractions (phone, talking, etc.)' },
      { text: 'I put my best effort into my work' },
    ];
    const scale = ['Needs Work', 'Getting There', 'Good', 'Great'];
    const checks = [
      { text: 'Missed more than 3 classes' },
      { text: 'Was late more than 3 times' },
      { text: 'Had missing assignments' },
      { text: 'Asked for help when I needed it' },
      { text: 'Used feedback to improve my work' },
      { text: 'Set a goal and worked toward it' },
    ];
    let html = `<div class="report-block-box" style="page-break-inside:avoid">`;
    html += `<div class="report-block-title">My Classroom Habits & Responsibilities</div>`;
    html += `<div style="font-size:0.76rem;color:var(--text-2);margin-bottom:12px">${name}, think honestly about your habits this term. Fill in one circle per row.</div>`;
    // Rating table
    html += `<table class="report-habits-table"><thead><tr><th></th>`;
    scale.forEach(s => {
      html += `<th>${s}</th>`;
    });
    html += `</tr></thead><tbody>`;
    habits.forEach(h => {
      html += `<tr><td>${h.text}</td>`;
      scale.forEach(() => {
        html += `<td><span class="report-habits-bubble"></span></td>`;
      });
      html += `</tr>`;
    });
    html += `</tbody></table>`;
    // Quick-check section
    html += `<div style="margin-top:14px;padding-top:12px;border-top:1.5px solid var(--border)">
    <div style="font-size:0.72rem;font-weight:700;color:var(--text-2);margin-bottom:10px">This term, I…</div>
    <div class="report-habits-checks">`;
    checks.forEach(c => {
      html += `<div class="report-parent-check"><span class="report-parent-checkbox"></span> ${c.text}</div>`;
    });
    html += `</div></div>`;
    // Open response
    html += `<div style="margin-top:14px;padding-top:12px;border-top:1.5px solid var(--border)">
    <div class="report-reflect-open-line"><span class="report-reflect-open-label">One habit I'm proud of:</span><span class="report-reflect-open-field"></span></div>
    <div class="report-reflect-open-line"><span class="report-reflect-open-label">One habit I want to improve:</span><span class="report-reflect-open-field"></span></div>
  </div>`;
    html += `</div>`;
    return html;
  }

  /* ── Section Proficiency Bar Chart (horizontal bars) ── */
  function renderBlockSectionChart(cid, student) {
    const sections = getSections(cid);
    const assessments = getAssessments(cid);
    const levelScores = _levelScores(cid, student.id);
    let html = `<div class="report-block-box report-section-chart">
    <div class="report-block-title">Section Proficiency Breakdown</div>`;

    sections.forEach((sec, si) => {
      const secProf = getSectionProficiency(cid, student.id, sec.id);
      const sr = Math.round(secProf);
      const secLabel = secProf > 0 ? esc(levelText(cid, secProf)) : 'No Evidence';

      // Tag-level breakdown
      const tagData = sec.tags.map(tag => {
        const prof = getTagProficiency(cid, student.id, tag.id);
        const r = Math.round(prof);
        return { tag, prof, r };
      });
      const assessed = tagData.filter(t => t.prof > 0);
      const strengths = assessed.filter(t => t.r >= 3).sort((a, b) => b.prof - a.prof);
      const growth = assessed.filter(t => t.r <= 2).sort((a, b) => a.prof - b.prof);
      const notYet = tagData.filter(t => t.prof === 0);

      // Assessments that touched this section + student performance
      const secTagIds = new Set(sec.tags.map(t => t.id));
      const secScores = levelScores.filter(s => secTagIds.has(s.tagId) && s.score > 0);
      const touchedAssessIds = new Set(secScores.map(s => s.assessmentId));
      const touchedAssess = assessments.filter(a => touchedAssessIds.has(a.id));
      // Per-assessment avg for this section's tags
      const assessPerf = touchedAssess
        .map(a => {
          const aScores = secScores.filter(s => s.assessmentId === a.id);
          if (aScores.length === 0) return null;
          const avg = aScores.reduce((s, x) => s + x.score, 0) / aScores.length;
          return { title: a.title, avg, r: Math.round(avg) };
        })
        .filter(Boolean)
        .sort((a, b) => b.avg - a.avg);
      // Missing: assessments with tags in this section labelled Missing.
      const missingAssess = assessments.filter(
        a => (a.tagIds || []).some(tid => secTagIds.has(tid)) && getAssignmentStatus(cid, student.id, a.id) === 'NS',
      );

      // 4-dot proficiency indicator
      let dots = '';
      for (let i = 1; i <= 4; i++) {
        const filled = secProf > 0 && i <= sr;
        dots += `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;border:1.5px solid ${secProf > 0 ? 'var(--text)' : 'var(--border)'};${filled ? 'background:var(--text);' : ''}margin-right:3px"></span>`;
      }

      html += `<div style="${si > 0 ? 'margin-top:12px;padding-top:10px;border-top:1.5px solid var(--border);' : ''}page-break-inside:avoid">`;
      // Header row
      html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:5px">
      <div style="font-size:0.88rem;font-weight:700;color:var(--text);flex:1">${esc(sec.shortName || sec.name)}</div>
      <div style="display:flex;align-items:center;gap:2px">${dots}</div>
      <div style="font-size:0.82rem;font-weight:700;color:var(--text)">${secLabel}</div>
      <div style="font-size:0.64rem;color:var(--text-3);font-weight:500">${assessed.length}/${tagData.length} outcomes</div>
    </div>`;

      // 3-column layout: strengths | growth | assessments
      html += `<div style="display:flex;gap:14px;font-size:0.76rem;line-height:1.55">`;

      // Col 1: Strengths
      html += `<div style="flex:1;min-width:0">`;
      html += `<div style="font-weight:700;font-size:0.6rem;color:var(--text-2);margin-bottom:2px">Strengths</div>`;
      if (strengths.length > 0) {
        strengths.forEach(t => {
          html += `<div style="display:flex;align-items:baseline;gap:4px;color:var(--text)">
          <span style="font-size:0.64rem;font-weight:600;color:var(--text-3);flex-shrink:0">${(PROF_LABELS[t.r] || '?')[0]}</span>
          <span>${esc(t.tag.label)}</span>
        </div>`;
        });
      } else {
        html += `<div style="color:var(--text-3);font-style:italic;font-size:0.72rem">None yet</div>`;
      }
      html += `</div>`;

      // Col 2: Growth
      html += `<div style="flex:1;min-width:0">`;
      html += `<div style="font-weight:700;font-size:0.6rem;color:var(--text-2);margin-bottom:2px">Areas for Growth</div>`;
      if (growth.length > 0) {
        growth.forEach(t => {
          html += `<div style="display:flex;align-items:baseline;gap:4px;color:var(--text)">
          <span style="font-size:0.64rem;font-weight:600;color:var(--text-3);flex-shrink:0">${(PROF_LABELS[t.r] || '?')[0]}</span>
          <span>${esc(t.tag.label)}</span>
        </div>`;
        });
      } else if (assessed.length > 0) {
        html += `<div style="color:var(--text-3);font-style:italic;font-size:0.72rem">All at/above proficient</div>`;
      }
      if (notYet.length > 0) {
        html += `<div style="font-size:0.66rem;color:var(--text-3);margin-top:2px;font-style:italic">${notYet.length} not yet assessed</div>`;
      }
      html += `</div>`;

      // Col 3: Assessments & Evidence
      html += `<div style="flex:1;min-width:0">`;
      html += `<div style="font-weight:700;font-size:0.6rem;color:var(--text-2);margin-bottom:2px">Assessments</div>`;
      if (assessPerf.length > 0) {
        // Three assessments per competency; the rest are counted. With the
        // flat learning map the same titles repeat under every competency.
        assessPerf.slice(0, 3).forEach(a => {
          html += `<div style="display:flex;align-items:baseline;gap:4px;color:var(--text)">
          <span style="font-size:0.64rem;font-weight:600;color:var(--text-3);flex-shrink:0">${(PROF_LABELS[a.r] || '?')[0]}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.title)}</span>
        </div>`;
        });
        if (assessPerf.length > 3) {
          html += `<div style="font-size:0.64rem;color:var(--text-3);font-style:italic">+${assessPerf.length - 3} more</div>`;
        }
      } else {
        html += `<div style="color:var(--text-3);font-style:italic;font-size:0.72rem">No evidence yet</div>`;
      }
      if (missingAssess.length > 0) {
        html += `<div class="report-missing-title" style="font-size:0.64rem;color:var(--score-1);font-weight:600;margin-top:3px">Missing:</div>`;
        missingAssess.slice(0, 3).forEach(a => {
          html += `<div style="font-size:0.68rem;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">· ${esc(a.title)}</div>`;
        });
        if (missingAssess.length > 3) {
          html += `<div style="font-size:0.64rem;color:var(--text-3);font-style:italic">+${missingAssess.length - 3} more</div>`;
        }
      }
      html += `</div>`;

      html += `</div>`; // close 3-col
      html += `</div>`; // close section
    });

    html += `</div>`;
    return html;
  }

  /* ── Score Distribution & Assignment Highlights ── */
  function renderBlockScoreDistribution(cid, student) {
    const allScores = getScores(cid)[student.id] || [];
    const assessments = getAssessments(cid);
    const scored = _levelScores(cid, student.id).filter(s => s.score > 0);
    if (scored.length === 0) return '';

    // Count by proficiency level
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    scored.forEach(s => {
      const level = Math.round(s.score);
      if (level >= 1 && level <= 4) counts[level]++;
    });
    const total = scored.length;
    const rawColors = { 1: 'var(--score-1)', 2: 'var(--score-2)', 3: 'var(--score-3)', 4: 'var(--score-4)' };

    // Build donut chart SVG
    const cx = 50,
      cy = 50,
      r = 40,
      inner = 24;
    const circ = 2 * Math.PI * r;
    let offset = 0;
    let arcs = '';
    levelOrderFor(cid).forEach(level => {
      if (counts[level] === 0) return;
      const pct = counts[level] / total;
      const dash = circ * pct;
      const gap = circ - dash;
      arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${rawColors[level]}" stroke-width="14"
      data-prof-stroke="${level}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += dash;
    });

    // Per-assessment averages for top/bottom
    const assessAvgs = assessments
      .map(a => {
        const aScores = scored.filter(s => s.assessmentId === a.id);
        if (aScores.length === 0) return null;
        let avg = aScores.reduce((s, x) => s + x.score, 0) / aScores.length;
        // Rubric work counts each criterion once, at its weight.
        const rawScores = allScores.filter(s => s.assessmentId === a.id && s.score > 0);
        const rubricAvg = getRubricAssessmentScore(cid, a, rawScores);
        if (rubricAvg != null) avg = rubricAvg;
        return { title: a.title, avg, r: Math.round(avg), type: a.type, id: a.id };
      })
      .filter(Boolean);
    const sorted = [...assessAvgs].sort((a, b) => b.avg - a.avg);
    const top = sorted.filter(a => a.r >= 3).slice(0, 3);
    const bottom = sorted
      .filter(a => a.r <= 2)
      .reverse()
      .slice(0, 3);

    // Missing assignments: work labelled Missing.
    const missing = assessments.filter(a => getAssignmentStatus(cid, student.id, a.id) === 'NS');

    // Proficient+ percentage for circle gauge
    const profPlus = counts[3] + counts[4];
    const profPct = total > 0 ? Math.round((profPlus / total) * 100) : 0;
    const gaugeR = 40,
      gaugeCirc = 2 * Math.PI * gaugeR;
    const gaugeDash = gaugeCirc * (profPct / 100);

    let html = `<div class="report-block-box" style="page-break-inside:avoid">
    <div class="report-block-title">Score Distribution & Highlights</div>
    <div style="display:flex;gap:16px;padding:4px 0">`;

    // LEFT HALF: donut + bars
    html += `<div style="flex:1;min-width:0">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">
      <svg width="100" height="100" viewBox="0 0 100 100" style="flex-shrink:0">
        ${arcs}
        <circle cx="${cx}" cy="${cy}" r="${inner}" fill="var(--surface)"/>
        <text x="${cx}" y="${cy - 3}" text-anchor="middle" style="font-size:16px;font-weight:800;fill:var(--text)">${total}</text>
        <text x="${cx}" y="${cy + 8}" text-anchor="middle" style="font-size:6.5px;fill:var(--text-3);">scores</text>
      </svg>
      <div style="display:flex;flex-direction:column;gap:4px;flex:1">`;
    levelOrderFor(cid).forEach(level => {
      const pct = total > 0 ? Math.round((counts[level] / total) * 100) : 0;
      html += `<div style="display:flex;align-items:center;gap:6px">
      <span data-prof-bg="${level}" style="width:7px;height:7px;border-radius:50%;background:${rawColors[level]};flex-shrink:0"></span>
      <span style="font-size:0.68rem;font-weight:600;color:var(--text);width:65px">${PROF_LABELS[level]}</span>
      <div style="flex:1;height:8px;background:var(--overlay-hover);border-radius:3px;overflow:hidden">
        <div data-prof-bg="${level}" style="height:100%;width:${pct}%;background:${rawColors[level]};border-radius:3px"></div>
      </div>
      <span style="font-size:0.62rem;color:var(--text-2);width:32px;text-align:right">${counts[level]}</span>
    </div>`;
    });
    html += `</div></div>`;

    // Top assignments
    if (top.length > 0) {
      html += `<div style="font-weight:700;font-size:0.56rem;color:var(--text-2);margin:6px 0 3px">Top Assignments</div>`;
      top.forEach(a => {
        html += `<div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;line-height:1.6">
        <span data-prof="${a.r}" style="font-weight:600;color:${PROF_COLORS[a.r]};font-size:0.64rem;width:14px;flex-shrink:0">${(PROF_LABELS[a.r] || '?')[0]}</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.title)}</span>
      </div>`;
      });
    }
    // Bottom assignments
    if (bottom.length > 0) {
      html += `<div style="font-weight:700;font-size:0.56rem;color:var(--text-2);margin:6px 0 3px">Needs Improvement</div>`;
      bottom.forEach(a => {
        html += `<div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;line-height:1.6">
        <span data-prof="${a.r}" style="font-weight:600;color:${PROF_COLORS[a.r]};font-size:0.64rem;width:14px;flex-shrink:0">${(PROF_LABELS[a.r] || '?')[0]}</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.title)}</span>
      </div>`;
      });
    }
    html += `</div>`;

    // RIGHT HALF: proficient gauge + missing assignments + late policy
    html += `<div style="flex:1;min-width:0;display:flex;flex-direction:column">`;
    // Top row: gauge left, late policy note right
    html += `<div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:10px">`;
    // Gauge — left aligned
    html += `<div style="flex-shrink:0">
    <svg width="90" height="90" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="${gaugeR}" fill="none" stroke="var(--divider-subtle)" stroke-width="8"/>
      <circle cx="50" cy="50" r="${gaugeR}" fill="none" stroke="var(--text)" stroke-width="8"
        stroke-dasharray="${gaugeDash} ${gaugeCirc - gaugeDash}" stroke-dashoffset="${gaugeCirc * 0.25}"
        stroke-linecap="round"/>
      <text x="50" y="46" text-anchor="middle" style="font-size:22px;font-weight:800;fill:var(--text)">${profPct}%</text>
      <text x="50" y="60" text-anchor="middle" style="font-size:6px;fill:var(--text-3);">at or above</text>
      <text x="50" y="68" text-anchor="middle" style="font-size:6px;fill:var(--text-3);">proficient</text>
    </svg>
  </div>`;
    // Late policy note: the class's saved policy, the one value Copy grading
    // setup and the server keep.
    const latePolicy = (COURSES[cid] && COURSES[cid].lateWorkPolicy) || '';
    html += `<div style="flex:1;min-width:0;padding-top:6px">
    <div style="font-size:0.68rem;font-weight:700;color:var(--text-2);margin-bottom:4px">Late Work Policy</div>
    <div contenteditable="true" data-action="latePolicyEdit" style="font-size:0.68rem;color:${latePolicy ? 'var(--text-2)' : 'var(--text-3)'};line-height:1.45;font-style:${latePolicy ? 'normal' : 'italic'};outline:none;min-height:1.4em"
    >${latePolicy ? esc(latePolicy) : 'No late work policy set'}</div>
  </div>`;
    html += `</div>`;

    // Missing assignments — 2-column grid
    if (missing.length > 0) {
      html += `<div style="padding-top:8px;border-top:1px solid var(--border)">
      <div class="report-missing-title" style="font-weight:700;font-size:0.56rem;color:var(--score-1);margin-bottom:4px">Missing Assignments (${missing.length})</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px">`;
      missing.forEach(a => {
        html += `<div style="font-size:0.68rem;color:var(--text);line-height:1.6;display:flex;align-items:baseline;gap:4px;min-width:0">
        <span style="color:var(--text-3);font-size:0.56rem;flex-shrink:0;font-weight:600">${esc(getAssessmentCategoryName(cid, a))}</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.title)}</span>
      </div>`;
      });
      html += `</div></div>`;
    } else {
      html += `<div style="padding-top:8px;border-top:1px solid var(--border)">
      <div class="report-no-missing" style="font-size:0.72rem;color:var(--score-3);font-weight:600">✓ No missing assignments</div>
    </div>`;
    }
    html += `</div>`;

    html += `</div></div>`;
    return html;
  }

  /* ── Assignment Grades ──────────────────────────────────────────
     One row per assessment: the date, the full title, and the marks the
     teacher picks under Show: the Score (12/15, or 3.3 / 4 for work scored
     on proficiency), the Percent and the Proficiency Word. Percent and the
     word start from the class grading setting (showDefaults). Organized by
     Category, by Date (a heading per month) or by Competency (a heading per
     competency over its latest few pieces of work, each row the mark on
     that competency). Newest or oldest first; one column or two, a
     heading never split across columns. Range: the last 10, this term or
     the year to date (all); each leaves out work dated after today. It starts in one column, by date, year to
     date. Side by Side is one column of the last 10 (never by competency). No dots (DECISIONS "Report forms" 13). */
  function showDefaults(cid) {
    const mode = courseGradeMode(cid);
    return { percent: mode !== 'proficiency', word: mode !== 'letter' };
  }
  function _monthName(d) {
    return parseLocalDate(d).toLocaleDateString('en-CA', { month: 'long' });
  }
  /* The marks for one row: { score, percent, word } as strings ('' when
     there is none). cv: calc.js assessmentCellValue. level: the mark on
     one competency instead of the whole assessment, for student sid;
     points work keeps its own % (_ownPercent). A whole piece prints the %
     its category counts it as (cv.percentText). */
  function _rowMarks(cid, a, cv, level, sid) {
    if (level != null) {
      if (!(level > 0)) return { score: '—', percent: '', word: '' };
      return {
        score: levelFigure(level) + ' / 4',
        percent: _ownPercent(cid, sid, a) || formatLevelAs(cid, level, 'percent'),
        word: _profWord(level),
      };
    }
    if (cv.kind === 'status') return { score: cv.status === 'EXC' ? 'Excused' : 'Missing', percent: '', word: '' };
    if (cv.kind === 'complete') {
      return { score: cv.mark === 'complete' ? '✓ Complete' : '✗ Incomplete', percent: '', word: '' };
    }
    if (cv.kind === 'dibels') return { score: cv.text, percent: '', word: '' };
    if (cv.kind === 'points') {
      const max = Number(a.maxPoints) || 100;
      return {
        score: formatPoints(cv.value) + '/' + formatPoints(max),
        percent: formatPointsPercent(cv.value, max),
        word: _profWord(cv.level),
      };
    }
    if (cv.kind === 'level' && cv.value > 0) {
      return {
        score: levelFigure(cv.value) + ' / 4',
        percent: cv.percentText,
        word: _profWord(cv.value),
      };
    }
    return { score: '\u2014', percent: '', word: '' };
  }

  function renderBlockGradeTable(cid, student, options, ctx) {
    options = options || {};
    const sid = student.id;
    const half = options.size === 'half';
    const autos = showDefaults(cid);
    const pick = (k, dflt) => (options[k] === 'auto' || options[k] == null ? dflt : options[k] !== false);
    const showScore = pick('score', true);
    const showPct = pick('percent', autos.percent);
    const showWord = pick('word', autos.word);
    const showCourse = pick('course', true);
    const showCatGrade = pick('categoryGrade', true);
    const organize = half && options.organize === 'competency' ? 'category' : options.organize || 'date';
    const oldest = options.order === 'oldest';
    const one = half || options.columns !== 'two';
    const range = half ? 'last10' : options.range === 'term' || options.range === 'last10' ? options.range : 'all';
    const per = Math.max(1, Number(options.per) || 5);

    const dated = getAssessments(cid)
      .filter(a => !isDibelsScored || !isDibelsScored(a))
      .map(a => ({ a, d: typeof _assessmentDate === 'function' ? _assessmentDate(a) : a.date || '' }))
      .sort((x, y) => (y.d || '').localeCompare(x.d || ''));
    // Every range leaves out work dated after today (This Term too:
    // Colin, 2026-11-03).
    const today = typeof courseToday === 'function' ? courseToday(cid) : new Date().toISOString().slice(0, 10);
    // A report reads the year to date as of its end, so work dated after
    // the report's end is left out too (Colin, 2026-11-03).
    const report = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    const until = report && report.endsOn && report.endsOn < today ? report.endsOn : today;
    let pool = dated.filter(x => !x.d || x.d <= until);
    if (range === 'term') pool = pool.filter(x => assessmentInTermWindow(cid, x.a));
    else if (range === 'last10') pool = pool.slice(0, 10);
    if (oldest) pool = pool.slice().reverse();
    if (!pool.length) return '';

    const figs = m => [showScore && m.score, showPct && m.percent].filter(Boolean).join(' · ') || m.score;
    const when = d => (d ? parseLocalDate(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '—');
    const rowHtml = (x, marks) =>
      `<div class="report-grades-row"><span class="report-grades-date">${esc(when(x.d))}</span><span class="report-grades-title">${esc(x.a.title || '')}</span><span class="report-grades-figs">${esc(figs(marks))}</span>${showWord ? `<span class="report-grades-word">${esc(marks.word)}</span>` : ''}</div>`;

    // The groups: a heading and its rows, in the order they print.
    const groups = [];
    if (organize === 'competency') {
      const sections = _reportSections(cid);
      // The marks are read as of the report (the year to date to its end),
      // which holds every range's pieces.
      const marks = {};
      // The competency's mark on each piece, as the gradebook shows it.
      sections.forEach(sec =>
        (sec.tags || []).forEach(tag => (marks[tag.id] = tagMarksByAssessment(cid, sid, tag.id))),
      );
      sections.forEach(sec => {
        const byAssessment = {};
        (sec.tags || []).forEach(tag => {
          marks[tag.id].forEach(sc => {
            if (sc.score > 0 && (byAssessment[sc.assessmentId] == null || sc.score > byAssessment[sc.assessmentId])) {
              byAssessment[sc.assessmentId] = sc.score;
            }
          });
        });
        const rows = pool.filter(x => byAssessment[x.a.id] != null).slice(0, per);
        if (rows.length) {
          groups.push({
            name: _competencyLabel(sec),
            rows: rows.map(x => rowHtml(x, _rowMarks(cid, x.a, null, byAssessment[x.a.id], sid))),
          });
        }
      });
    } else {
      const cells = {};
      pool.forEach(x => (cells[x.a.id] = assessmentCellValue(cid, sid, x.a)));
      if (organize === 'date') {
        const months = [];
        pool.forEach(x => {
          const key = x.d ? x.d.slice(0, 7) : '';
          let g = months.find(m => m.key === key);
          if (!g) months.push((g = { key, name: x.d ? _monthName(x.d) : 'Undated', rows: [] }));
          g.rows.push(rowHtml(x, _rowMarks(cid, x.a, cells[x.a.id])));
        });
        months.forEach(m => groups.push({ name: m.name, rows: m.rows }));
      } else {
        // Each category heading carries its weight and the student's grade
        // in it, the year to date as of the report's end, worked out as the
        // gradebook does (the Course Grade's footing; Colin, 2026-11-03).
        const termWork = getAssessments(cid).filter(a => assessmentInYearToDate(cid, a));
        const catGrade = c => {
          if (!showCatGrade) return '';
          const g = assessmentGroupGrade(
            cid,
            sid,
            termWork.filter(a => (a.categoryId || a.category_id || null) === c.id),
            categoryCalcMode(c),
          );
          return [Number(c.weight || 0) + '% of grade', g && g.text].filter(Boolean).join(' · ');
        };
        const cats = (getCategories(cid) || []).map(c => ({ id: c.id, name: c.name, grade: catGrade(c), rows: [] }));
        const none = { id: null, name: 'No Category', rows: [] };
        pool.forEach(x => {
          const id = x.a.categoryId || x.a.category_id || null;
          const g = cats.find(c => c.id === id) || none;
          g.rows.push(rowHtml(x, _rowMarks(cid, x.a, cells[x.a.id])));
        });
        cats.concat([none]).forEach(g => {
          if (g.rows.length) groups.push({ name: g.name, grade: g.grade, rows: g.rows });
        });
      }
    }
    if (!groups.length) return '';

    const groupHtml = g =>
      `<div class="report-grades-head"><span>${esc(g.name)}</span>${g.grade ? `<span class="report-grades-headgrade">${esc(g.grade)}</span>` : ''}</div>${g.rows.join('')}`;
    let body;
    if (one) body = `<div class="report-grades-col">${groups.map(groupHtml).join('')}</div>`;
    else {
      // The rows split evenly between the columns, read down the left and
      // then the right. A group cut by the split carries on at the top of the
      // right column under its name again; a heading never ends a column.
      const total = groups.reduce((t, g) => t + g.rows.length + 1, 0);
      const cut = Math.ceil(total / 2);
      const left = [];
      const right = [];
      let used = 0;
      groups.forEach(g => {
        const room = cut - used;
        if (room >= g.rows.length + 1) left.push(g);
        else if (room >= 2 && !right.length) {
          left.push(Object.assign({}, g, { rows: g.rows.slice(0, room - 1) }));
          right.push({ name: g.name + ' (continued)', rows: g.rows.slice(room - 1) });
        } else right.push(g);
        used += g.rows.length + 1;
      });
      body = `<div class="report-grades-cols"><div class="report-grades-col">${left.map(groupHtml).join('')}</div><div class="report-grades-col">${right.map(groupHtml).join('')}</div></div>`;
    }
    const n = pool.length;
    const meta = half
      ? 'Last 10'
      : (range === 'last10' ? 'Last 10' : range === 'all' ? 'Year to date' : 'This term') +
        (organize === 'competency'
          ? ` · latest ${per} for each competency`
          : ` · ${n} assessment${n === 1 ? '' : 's'}`);
    // The course grade, the year to date as of the report's end, as the
    // gradebook shows it, with the report's reporting basis (IE, or No
    // Letter Grade for goals).
    const course = showCourse ? studentGradeSummary(cid, sid, ctx && ctx.termId).text : '';
    const courseHtml = course
      ? `<div class="report-grades-course">Course Grade <strong>${esc(course)}</strong></div>`
      : '';
    const legend = [
      showScore ? 'Points shown as scored; other work scored out of 4.' : '',
      showWord ? 'Proficiency: 1 Emerging · 2 Developing · 3 Proficient · 4 Extending.' : '',
      organize === 'competency' ? 'Each mark is for that competency.' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<div class="report-block-box report-grades${half ? ' report-grades-half' : ''}${showWord ? '' : ' report-grades-noword'}">
    <div class="report-prof-head"><div class="report-block-title">Assignment Grades</div>${courseHtml}<div class="report-prof-meta">${esc(meta)}</div></div>
    ${body}
    <div class="report-grades-legend">${legend}</div>
  </div>`;
  }

  /* ── Core Competencies ── */
  function renderBlockCoreCompetencies(cid, student, options) {
    options = options || {};
    const assessments = getAssessments(cid);
    // Count competency exposure: how many assessments touched each competency, and avg score
    const compData = {};
    CORE_COMPETENCIES.forEach(c => {
      compData[c.id] = { count: 0, totalScore: 0, scored: 0 };
    });
    let hasAny = false;
    assessments.forEach(a => {
      const ccIds = a.coreCompetencyIds || [];
      if (ccIds.length === 0) return;
      if (!assessmentInYearToDate(cid, a)) return;
      if (ccIds.some(ccId => compData[ccId])) hasAny = true;
      // Work in a 0% category counts toward nothing, as for competencies.
      if (!countsTowardGrades(cid, a)) return;
      // The assessment's level as calc.js gives it: points as a share of 4
      // (18/20 is 3.6, not level 18), rubric criteria by weight, Excused left
      // out, Missing no evidence. Each counts its Factor times, and only
      // work with a level counts toward "Based on N assessments".
      const avg = getAssessmentOverallScore(cid, student.id, a.id) || 0;
      if (!(avg > 0)) return;
      const factor = getAssessmentWeight(a);
      ccIds.forEach(ccId => {
        if (compData[ccId]) {
          compData[ccId].count++;
          compData[ccId].totalScore += factor * avg;
          compData[ccId].scored += factor;
        }
      });
    });
    if (!hasAny) return '';
    // Group by competency group
    const groups = {};
    CORE_COMPETENCIES.forEach(c => {
      if (!groups[c.group]) groups[c.group] = [];
      groups[c.group].push(c);
    });
    let html = `<div class="report-block-box" style="page-break-inside:avoid">
    <div class="report-block-title">Core Competencies</div>
    ${options.intro !== false ? '<div style="font-size:0.7rem;color:var(--text-2);margin:-2px 0 8px;line-height:1.35">Core competencies are the skills, habits, and dispositions students develop across all areas of learning. Progress is based on observations from classroom assessments.</div>' : ''}
    <div style="display:flex;flex-wrap:wrap;gap:16px;padding:2px 0">`;
    Object.entries(groups).forEach(([groupName, comps]) => {
      html += `<div style="flex:1;min-width:180px">
      <div style="font-size:0.62rem;color:var(--text-3);font-weight:600;margin-bottom:6px">${esc(groupName)}</div>`;
      comps.forEach(c => {
        const d = compData[c.id];
        const avg = d.scored > 0 ? d.totalScore / d.scored : 0;
        if (!(avg > 0) && options.noEvidence === 'hide') return;
        const r = Math.round(avg);
        const pct = levelBarPercent(cid, avg);
        const color = avg > 0 ? PROF_COLORS[r] || 'var(--text-3)' : 'var(--border)';
        const profLabel = d.count === 0 ? 'Not yet assessed' : avg > 0 ? esc(levelText(cid, avg)) : 'Not yet assessed';
        const labelColor = avg > 0 ? color : 'var(--text-3)';
        html += `<div style="margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:2px">
          <span style="font-size:0.75rem;font-weight:500;color:var(--text)">${esc(c.label)}</span>
          <span data-prof="${r}" style="font-size:0.65rem;font-weight:600;color:${labelColor};white-space:nowrap">${avg > 0 ? levelDots(r) : ''}${profLabel}</span>
        </div>
        <div style="height:8px;background:var(--overlay-hover);border-radius:4px;overflow:hidden">
          <div data-prof-bg="${r}" style="height:100%;width:${pct}%;background:${color};border-radius:4px"></div>
        </div>
        <div style="font-size:0.58rem;color:var(--text-3);margin-top:1px">Based on ${d.count} assessment${d.count !== 1 ? 's' : ''}</div>
      </div>`;
      });
      html += `</div>`;
    });
    html += `</div></div>`;
    return html;
  }

  /* ── Ways to Support at Home ──
     Lines for the family from the I-can statements of the student's
     weakest assessed competencies ("I can plan a fair test" becomes "Ask
     Cece to show you how she can plan a fair test."), and the teacher's
     own line for the class. Nothing generated beyond that wording. */
  /* ── Ways to Support at Home ──
     Lines for the family from the I-can statements of the student's
     weakest assessed competencies ("I can plan a fair test" becomes "Ask
     Cece to show you how she can plan a fair test."), and the teacher's
     own line for the class. Nothing generated beyond that wording. */
  function _forFamily(student, stmt) {
    const p = getPronouns(student);
    const name = displayNameFirst(student);
    const m = String(stmt || '')
      .trim()
      .match(/^I can (.+?)\.?$/i);
    if (!m) return `Talk with ${name} about this: ${String(stmt).trim()}`;
    const rest = m[1]
      .replace(/\bmyself\b/gi, p.refl)
      .replace(/\bmy\b/gi, p.poss)
      .replace(/\bme\b/gi, p.obj)
      .replace(/\bI\b/g, p.subj)
      .replace(/\bI'm\b/g, p.subj + (p.subj === 'they' ? "'re" : "'s"));
    return `Ask ${name} to show you how ${p.subj} can ${rest}.`;
  }
  /* ── Ways to Support at Home ────────────────────────────────────
     The student's best and lowest work in the Focus Area this term, for
     the family to ask to see and ask about, and the teacher's own line.
     The student's goal prints in Self-Assessment and Goal, not here. */
  function renderBlockSupportHome(cid, student, ctx, options) {
    options = options || {};
    const half = options.size === 'half';
    const p = getPronouns(student);
    const lines = [];
    const focus = focusArea(cid, student, ctx, 'focus');
    if (focus) {
      const work = _sectionWork(cid, student.id, focus.sec).filter(w => assessmentInTermWindow(cid, w.a));
      if (work.length) {
        const hi = _byMark(cid, student.id, true);
        const lo = _byMark(cid, student.id, false);
        const best = work.slice().sort((a, b) => hi(a, b) || (b.d || '').localeCompare(a.d || ''))[0];
        const low = work.slice().sort((a, b) => lo(a, b) || (b.d || '').localeCompare(a.d || ''))[0];
        if (options.see !== false && best) lines.push(['Ask to see', _workLine(cid, student.id, best)]);
        if (options.about !== false && low && (work.length > 1 || options.see === false)) {
          lines.push([
            'Ask about',
            _workLine(cid, student.id, low) + (low !== best ? ', ' + esc(p.poss) + ' lowest this term' : ''),
          ]);
        }
      }
    }
    const note = String(options.note || '').trim();
    if (note) lines.push(['', esc(note)]);
    if (!lines.length) return '';
    return `<div class="report-block-box report-support-home${half ? ' report-support-half' : ''}">
    <div class="report-block-title">Ways to Support at Home</div>
    <div class="report-support">${lines.map(([k, v]) => `<span class="report-support-k">${k}</span><span>${v}</span>`).join('')}</div>
  </div>`;
  }

  /* The assessments dated in the report's term (all when no term is
     active), each with its cell as the Scores view shows it. */
  function _termCells(cid, student) {
    return getAssessments(cid)
      .filter(a => assessmentInTermWindow(cid, a))
      .map(a => ({ a: a, cell: assessmentCellValue(cid, student.id, a) }));
  }
  /* Work labelled Missing up to the report's end, whatever term it was
     assigned in, undated work included (Colin, 2026-11-03): the year to
     date the grade counts. */
  function _missingCells(cid, student) {
    return getAssessments(cid)
      .filter(a => assessmentInYearToDate(cid, a))
      .map(a => ({ a: a, cell: assessmentCellValue(cid, student.id, a) }))
      .filter(c => c.cell.status === 'NS');
  }
  function _inActiveTerm(cid, day) {
    const t = getActiveTerm(cid);
    if (!t) return true;
    return !!day && day >= t.startsOn && day <= t.endsOn;
  }

  /* ── This Term at a Glance ── six figures in a row. */
  function renderBlockTermGlance(cid, student) {
    const cells = _termCells(cid, student);
    if (!cells.length) return '';
    const assessed = cells.filter(c => ['level', 'points', 'complete'].includes(c.cell.kind)).length;
    const late = cells.filter(c => c.cell.late).length;
    // Missing is everything still Missing up to the report's end, as the
    // Missing Work block lists it; the rest are this term's.
    const missing = _missingCells(cid, student).length;
    const obs = getStudentQuickObs(cid, student.id).filter(o =>
      _inActiveTerm(cid, String(o.date || o.created || '').slice(0, 10)),
    ).length;
    // Strongest and Growing by the comment's evidence gates (CommentBank
    // strongestOf: 3+ pieces; nextStepOf: 2+ pieces; both counted in the
    // year to date), so the box, At a Glance and the comment name the same
    // competencies; a dash when none passes.
    const secs = _reportSections(cid);
    const bank = typeof CommentBank !== 'undefined' ? CommentBank : null;
    const comps = bank ? bank.compsOf(cid, student) : [];
    const secOf = c => (c ? secs.find(s => s.id === c.id) || null : null);
    const name = sec => (sec ? esc(sec.shortName || sec.name) : '\u2014');
    const strongest = bank ? secOf(bank.strongestOf(comps)[0]) : null;
    const growing = bank ? secOf(bank.nextStepOf(comps)) : null;
    const fig = (value, label, word) =>
      `<div class="report-glance-fig${word ? ' word' : ''}"><div class="report-glance-value">${value}</div><div class="report-glance-label">${label}</div></div>`;
    return `<div class="report-block-box report-term-glance">
    <div class="report-block-title">This Term at a Glance</div>
    <div class="report-glance">${fig(assessed, 'Assessed')}${fig(late, 'Late')}${fig(missing, 'Missing')}${fig(obs, 'Observations')}${fig(name(strongest), 'Strongest', true)}${fig(name(growing), 'Growing', true)}</div>
  </div>`;
  }

  /* ── Growth Since Last Report ──
     Each competency's year-to-date level at the last report's end beside
     its year-to-date level at this report's end (Colin, 2026-11-03), headed
     by the reports ("Report 1", "Report 2"). calc.js reads the last report
     with its term in view and puts this one back (readAsOfTerm). Nothing
     when there is no previous term or no evidence by its end. */
  function renderBlockGrowth(cid, student) {
    const now = getActiveTerm(cid);
    if (!now) return '';
    const prev = previousReportTerm(cid);
    if (!prev) return '';
    const sections = _reportSections(cid);
    const current = sections.map(sec => getSectionProficiency(cid, student.id, sec.id));
    const before = readAsOfTerm(cid, prev.ordinal, () =>
      sections.map(sec => getSectionProficiency(cid, student.id, sec.id)),
    );
    if (!before.some(v => v > 0)) return '';
    // The arrow follows the figures beside it: the proficiency word in a
    // Proficiency class, the % in a Letter or Both class (_levelHtml), so
    // 70% to 78% is up even when both are Proficient.
    const shown = v => (courseGradeMode(cid) === 'proficiency' ? Math.round(v) : Math.round(levelToPercent(cid, v)));
    const arrow = (a, b) => {
      if (!(a > 0) || !(b > 0)) return '';
      const d = shown(b) - shown(a);
      if (d > 0) return '<span class="report-growth-up" aria-label="Up">\u2191</span>';
      if (d < 0) return '<span class="report-growth-down" aria-label="Down">\u2193</span>';
      return '<span class="report-growth-same" aria-label="Same">\u2192</span>';
    };
    const rows = sections
      .map(
        (sec, i) =>
          `<tr><td class="report-ct-name">${esc(sec.shortName || sec.name)}</td><td class="report-ct-level col-before" data-prof="${Math.round(before[i])}">${_levelHtml(cid, before[i])}</td><td class="report-ct-level" data-prof="${Math.round(current[i])}">${_levelHtml(cid, current[i])}</td><td class="report-growth-arrow">${arrow(before[i], current[i])}</td></tr>`,
      )
      .join('');
    return `<div class="report-block-box report-growth">
    <div class="report-block-title">Growth Since Last Report</div>
    <table class="report-ct"><thead><tr><th>Competency</th><th class="col-before">${esc(reportName(prev))}</th><th>${esc(reportName(now))}</th><th></th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
  }

  /* ── Missing Work ────────────────────────────────────────────────
     Work labelled Missing up to the report's end, whatever term it was
     assigned in, as of today: one line at Row width ("None", or the
     titles), a count over its words at Side by Side. When there is none it says so, or stays off. The As Of
     date is marked data-print-date: "changed since the last print" skips it. */
  function _asOf(cid) {
    const d = typeof courseToday === 'function' ? courseToday(cid) : new Date().toISOString().slice(0, 10);
    return (
      'As of ' + parseLocalDate(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
    );
  }
  function renderBlockMissingWork(cid, student, ctx, options) {
    options = options || {};
    const half = options.size === 'half';
    const missing = _missingCells(cid, student);
    if (!missing.length && options.none === 'off') return '';
    const n = missing.length;
    const titles = missing.map(c => esc(c.a.title || '')).join(', ');
    const words = n ? (options.titles !== false ? titles : n + (n === 1 ? ' assignment' : ' assignments')) : 'None';
    if (half) {
      return `<div class="report-block-box report-missing-work report-strip-half">
    <div class="report-strip-head"><b>Missing Work</b><span class="report-prof-meta" data-print-date>${esc(_asOf(cid))}</span></div>
    <div class="report-strip-fig"><b>${n}</b><span>${words}</span></div>
  </div>`;
    }
    return `<div class="report-block-box report-missing-work report-strip">
    <b class="report-strip-title">Missing Work</b><span>${words}</span><span class="report-strip-meta" data-print-date>${esc(_asOf(cid))}</span>
  </div>`;
  }

  /* ── Attendance ─────────────────────────────────────────────────
     The totals the teacher copied from MyEd into the Term Questionnaire:
     classes absent and times late, this term or the year to date. One
     line at Row width, two figures at Side by Side. Nothing to print when
     neither number is entered. When an earlier report's attendance is
     blank, this term's share is unknown, so the block prints the year to
     date (Colin, 2026-11-03). */
  function renderBlockAttendance(cid, student, ctx, options) {
    options = options || {};
    const half = options.size === 'half';
    const att = getTermAttendance(cid, student.id, ctx.termId);
    if (att.absences == null && att.lates == null) return '';
    const year = options.period === 'year' || !!att.termUnknown;
    const absent = year ? att.absences : att.absencesThisTerm;
    const late = year ? att.lates : att.latesThisTerm;
    const n = v => (v == null ? '—' : String(v));
    const when = year ? 'Year to Date' : 'This Term';
    const cells = [['Classes Absent', absent]].concat(options.late !== false ? [['Times Late', late]] : []);
    if (half) {
      return `<div class="report-block-box report-attendance report-strip-half">
    <div class="report-strip-head"><b>Attendance</b><span class="report-prof-meta">${when}</span></div>
    <div class="report-strip-figs">${cells.map(([k, v]) => `<div class="report-strip-fig"><b>${n(v)}</b><span>${k}</span></div>`).join('')}</div>
  </div>`;
    }
    return `<div class="report-block-box report-attendance report-strip">
    <b class="report-strip-title">Attendance</b>${cells.map(([k, v]) => `<span><span class="report-strip-k">${k}</span> <b>${n(v)}</b></span>`).join('')}<span class="report-strip-meta">${when}</span>
  </div>`;
  }

  /* ── Self-Assessment and Goal ──────────────────────────────────────
     The student's own words from Student Voice: what they are good at as
     a learner (About Me), their Core Competency reflections (the latest
     reflection's "why" for each competency), and their goal from the
     latest Goal Check-In with how it is going and what they will do next.
     Nothing when the student has answered none of it. */
  function _voiceText(v) {
    if (!v) return '';
    if (v.text != null && String(v.text).trim()) return String(v.text).trim();
    if (Array.isArray(v.json)) return v.json.filter(Boolean).join(', ');
    return '';
  }
  function renderBlockSelfAssessment(cid, student, ctx, options) {
    options = options || {};
    if (typeof StudentVoice === 'undefined') return '';
    const half = options.size === 'half';
    const list = StudentVoice.entries(cid, student.id);
    if (!list.length) return '';
    const profile = StudentVoice.profile(list);
    const first = displayNameFirst(student);
    const sources = [];
    const left = [];
    const right = [];
    const item = (k, v, strong) =>
      `<div class="report-self-item"><div class="report-self-k">${k}</div><div${strong ? ' class="report-self-goal"' : ''}>${esc(v)}</div></div>`;
    const quote = t => '“' + t.replace(/^[“"]|[”"]$/g, '') + '”';
    if (options.strength !== false && profile.about && profile.about.goodAt && profile.about.goodAt.v) {
      left.push(item("What I'm good at as a learner", quote(_voiceText(profile.about.goodAt.v))));
      sources.push('About Me');
    }
    if (options.core !== false) {
      const refl = profile.reflections.find(e => e.kind === 'core_reflection');
      if (refl) {
        let any = false;
        refl.items.forEach(it => {
          if (it.q.kind !== 'scale4' || !it.v || !it.v.json || !it.v.json.why) return;
          (it.q.core_ids || []).forEach(id => {
            const why = String(it.v.json.why[id] || '').trim();
            if (!why) return;
            const core = typeof getCoreCompetency === 'function' ? getCoreCompetency(id) : null;
            left.push(item(esc(core ? core.label.replace(/ & /g, ' and ') : id), quote(why)));
            any = true;
          });
        });
        if (any) sources.push(refl.title || 'Reflection');
      }
    }
    const c = profile.checkin;
    if (options.goal !== false && c) {
      const goal = c.coreGoal && _voiceText(c.coreGoal.v);
      const status = c.status && _voiceText(c.status.v);
      const next = (c.next && _voiceText(c.next.v)) || (c.coreStep && _voiceText(c.coreStep.v));
      if (goal) right.push(item('My goal', quote(goal), true));
      if (status) right.push(item("How it's going", status));
      if (next) right.push(item("What I'll do next", quote(next)));
      if (goal || status || next) {
        const entry = list.find(e => e.kind === 'goal_checkin');
        sources.push((entry && entry.title) || 'Goal Check-In');
      }
    }
    if (!left.length && !right.length) return '';
    const uniq = sources.filter((x, i) => sources.indexOf(x) === i);
    const sub = `In ${esc(first)}'s own words` + (uniq.length ? ', ' + esc(uniq.join(' and ')) : '');
    return `<div class="report-block-box report-self${half ? ' report-self-half' : ''}">
    <div class="report-prof-head report-self-head"><div class="report-block-title">Self-Assessment and Goal</div><div class="report-prof-meta">${sub}</div></div>
    <div class="report-self-body"><div class="report-self-col">${left.join('')}</div>${right.length ? `<div class="report-self-col report-self-right">${right.join('')}</div>` : ''}</div>
  </div>`;
  }

  /* ── Block dispatcher ── */
  /* ctx is { termId, termLabel }. Callers on the Reports page build it once
     with reportContext() and pass it for every student. */
  /* A block the teacher writes once for every student: a title and a few
     lines. Empty until the Studio's inspector gives it text (options.text). */
  function renderBlockText(options) {
    const text = String((options && options.text) || '').trim();
    if (!text) return '';
    const title = String((options && options.title) || '').trim();
    const body = esc(text).replace(/\n/g, '<br>');
    return `<div class="report-block-box report-text-block">${title ? `<div class="report-block-title">${esc(title)}</div>` : ''}<div class="report-text-body">${body}</div></div>`;
  }

  /* options: the cell's options from the form (report-sheets.js), read by
     the renderers that offer choices; the rest ignore it. */
  function renderReportBlock(blockId, cid, student, ctx, options) {
    ctx = ctx || reportContext();
    options = options || {};
    switch (blockId) {
      case 'text-block':
        return renderBlockText(options);
      case 'header':
        return renderBlockHeader(cid, student, ctx, options);
      case 'academic-summary':
        return renderBlockAcademicSummary(cid, student, ctx);
      case 'section-chart':
        return renderBlockSectionChart(cid, student);
      case 'score-distribution':
        return renderBlockScoreDistribution(cid, student);
      case 'grade-table':
        return renderBlockGradeTable(cid, student, options, ctx);
      case 'section-outcomes':
        return renderBlockSectionOutcomes(cid, student);
      case 'core-competencies':
        return renderBlockCoreCompetencies(cid, student, options);
      case 'competency-table':
        return renderBlockCompetencyTable(cid, student, ctx, options);
      case 'learner-dimensions':
        return renderBlockLearnerDimensions(cid, student, ctx, options);
      case 'teacher-narrative':
        return renderBlockTeacherNarrative(cid, student, ctx);
      case 'observations':
        return renderBlockObservations(cid, student);
      case 'next-steps':
        return renderBlockNextSteps(cid, student, ctx, options);
      case 'progress':
        return renderBlockProgress(cid, student, ctx, options);
      case 'proficiency':
        return renderBlockProficiency(cid, student, ctx, options);
      case 'legend':
        return renderBlockLegend(options, cid);
      case 'parent-response':
        return renderBlockParentResponse(cid, student, options);
      case 'student-reflection-learning':
        return renderBlockStudentReflectionLearning(cid, student);
      case 'student-reflection-habits':
        return renderBlockStudentReflectionHabits(cid, student);
      case 'support-home':
        return renderBlockSupportHome(cid, student, ctx, options);
      case 'term-glance':
        return renderBlockTermGlance(cid, student);
      case 'growth':
        return renderBlockGrowth(cid, student);
      case 'missing-work':
        return renderBlockMissingWork(cid, student, ctx, options);
      case 'self-assessment':
        return renderBlockSelfAssessment(cid, student, ctx, options);
      case 'term-attendance':
        return renderBlockAttendance(cid, student, ctx, options);
      default:
        return '';
    }
  }

  /* ── Namespace ──────────────────────────────────────────── */
  return {
    getTermId: getTermId,
    termIdFromPeriod: termIdFromPeriod,
    reportContext: reportContext,
    levelDots: levelDots,
    getPronouns: getPronouns,
    PRONOUN_SETS: PRONOUN_SETS,
    OBS_DESCRIPTORS: OBS_DESCRIPTORS,
    renderBlockHeader: renderBlockHeader,
    renderContinuedLine: renderContinuedLine,
    renderBlockAcademicSummary: renderBlockAcademicSummary,
    renderBlockLearnerDimensions: renderBlockLearnerDimensions,
    renderBlockTeacherNarrative: renderBlockTeacherNarrative,
    renderCommentBox: renderCommentBox,
    printableComment: printableComment,
    renderBlockCompetencyTable: renderBlockCompetencyTable,
    renderBlockObservations: renderBlockObservations,
    renderBlockSectionOutcomes: renderBlockSectionOutcomes,
    renderBlockNextSteps: renderBlockNextSteps,
    renderBlockLegend: renderBlockLegend,
    renderBlockProficiency: renderBlockProficiency,
    renderBlockProgress: renderBlockProgress,
    renderBlockSelfAssessment: renderBlockSelfAssessment,
    focusArea: focusArea,
    reportSections: _reportSections,
    competencyLabel: _competencyLabel,
    showDefaults: showDefaults,
    renderBlockParentResponse: renderBlockParentResponse,
    renderBlockStudentReflectionLearning: renderBlockStudentReflectionLearning,
    renderBlockStudentReflectionHabits: renderBlockStudentReflectionHabits,
    renderBlockSectionChart: renderBlockSectionChart,
    renderBlockScoreDistribution: renderBlockScoreDistribution,
    renderBlockGradeTable: renderBlockGradeTable,
    renderBlockCoreCompetencies: renderBlockCoreCompetencies,
    renderBlockSupportHome: renderBlockSupportHome,
    renderBlockTermGlance: renderBlockTermGlance,
    renderBlockGrowth: renderBlockGrowth,
    renderBlockMissingWork: renderBlockMissingWork,
    renderBlockAttendance: renderBlockAttendance,
    attendanceSentence: attendanceSentence,
    renderReportBlock: renderReportBlock,
  };
})();
