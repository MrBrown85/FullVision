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

  /* ── Pronoun helpers ─────────────────────────────────────── */
  function getPronouns(student) {
    const p = (student.pronouns || 'they/them').toLowerCase().split('/');
    const subj = p[0] || 'they';
    const obj = p[1] || 'them';
    let poss, refl, verb;
    if (subj === 'she') {
      poss = 'her';
      refl = 'herself';
      verb = 's';
    } else if (subj === 'he') {
      poss = 'his';
      refl = 'himself';
      verb = 's';
    } else {
      poss = 'their';
      refl = 'themselves';
      verb = '';
    }
    return { subj, obj, poss, refl, verb, capSubj: subj[0].toUpperCase() + subj.slice(1) };
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

    const titleParts = [school, course.name, block].filter(Boolean);
    let dates = term && options.dates !== false ? _formatDateRange(term.starts_on, term.ends_on) : '';
    if (dates && term.label && term.label !== period) dates = esc(term.label) + ' \u00B7 ' + dates;
    const who = [
      teacher && options.teacher !== false ? 'Teacher: ' + esc(teacher) : '',
      student.studentNumber && options.studentNumber !== false ? 'Student No. ' + esc(student.studentNumber) : '',
    ]
      .filter(Boolean)
      .join(' \u00B7 ');

    return `<div class="report-header">
    <div class="report-header-main">
      <div class="report-course-title">${esc(titleParts.join(' \u00B7 '))}</div>
      <div class="report-student-name">${esc(fullName(student))}</div>
    </div>
    <div class="report-header-meta">
      <div class="report-period">${esc(period)}</div>${dates ? `<div>${dates}</div>` : ''}${who ? `<div>${who}</div>` : ''}
    </div>
  </div>`;
  }

  function renderBlockAcademicSummary(cid, student) {
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
      if (course.gradingSystem === 'both') {
        profLine = `<div class="report-overall-label" style="margin-top:6px">Overall Proficiency: ${profDisplay}</div>`;
      }
    } else if (usePercentage && (overall > 0 || (letterData && letterData.R != null))) {
      overallDisplay = letterData && letterData.R != null ? letterData.R + '%' : Math.round((overall / 4) * 100) + '%';
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
      const slabel = prof > 0 ? PROF_LABELS[sr] : 'No Evidence';
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

  function _renderDimGroup(dimList, rating, groupTitle, options) {
    options = options || {};
    const dims = rating.dims || {};
    // Only the dimensions the teacher rated this term. "Not Assessed" on a
    // family's copy read as a gap in the teacher's work, not the student's.
    const rated = dimList.filter(dim => (dims[dim] || 0) > 0);
    if (rated.length === 0) return '';
    let html = `<div class="report-learner-title">${groupTitle}</div>`;
    html += `<div class="report-learner-dims">`;
    rated.forEach(dim => {
      const val = dims[dim];
      const pct = (val / 4) * 100;
      const label = OBS_LEVEL_LABELS[val];
      const color = OBS_LEVEL_COLORS[val];
      const info = OBS_DESCRIPTORS[dim] || {};
      html += `<div class="report-learner-dim">
      <div class="report-learner-dim-info">
        <div class="report-learner-dim-label">${OBS_LABELS[dim]}</div>
        ${options.descriptions && info.desc ? `<div class="report-dim-note">${esc(info.desc)}</div>` : ''}${options.examples && info.example ? `<div class="report-dim-note report-dim-example">${esc(info.example)}</div>` : ''}
        <div class="report-learner-dim-value" data-prof="${val}" style="color:${color};margin-top:4px">${levelDots(val)}${label}</div>
        <div class="report-learner-dim-bar">
          <div class="report-learner-dim-fill" data-prof-bg="${val}" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>
    </div>`;
    });
    html += `</div>`;
    return html;
  }

  function renderBlockLearnerDimensions(cid, student, ctx, options) {
    const termId = ctx && ctx.termId;
    const rating = getStudentTermRating(cid, student.id, termId);
    if (!rating) return '';
    const groups =
      _renderDimGroup(LEARNING_DIMS, rating, 'Learning Dispositions', options) +
      _renderDimGroup(RELATIONAL_DIMS, rating, 'Relational & Identity', options);
    if (!groups) return '';
    return `<div class="report-learner-profile">${groups}</div>`;
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

  function renderBlockTeacherNarrative(cid, student, ctx) {
    const termId = ctx && ctx.termId;
    // ctx.narrativeOverride is the questionnaire's unsaved draft, so the
    // editor can say how the comment will sit on the form while it is typed.
    let narrative;
    if (ctx && ctx.narrativeOverride != null) narrative = ctx.narrativeOverride;
    else {
      const rating = getStudentTermRating(cid, student.id, termId);
      narrative = rating && rating.narrative;
    }
    if (!narrative || !String(narrative).trim()) return '';
    narrative = String(narrative);
    const isHtml = /<[a-z][\s\S]*>/i.test(narrative);
    const content = isHtml ? sanitizeNarrativeHtml(narrative.trim()) : esc(narrative.trim());
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
    const quickObs = getStudentQuickObs(cid, student.id);
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
      const secOverride = getSectionOverride(cid, student.id, sec.id);
      html += `<div class="report-outcome-section" style="page-break-inside:avoid">
      <div class="report-outcome-section-header" style="display:flex;align-items:center;justify-content:space-between">
        <span>${esc(sec.shortName || sec.name)}</span>`;
      if (secProf > 0) {
        html += `<span data-prof="${sr}" style="font-size:0.68rem;font-weight:600;color:${PROF_COLORS[sr]}">${PROF_LABELS[sr]}</span>`;
      }
      html += `</div>`;
      if (secOverride) {
        // The level the scores give now, worked out here rather than taken
        // from the server.
        const calculated = Math.round(getSectionProficiencyRaw(cid, student.id, sec.id) * 10) / 10;
        html += `<div style="font-size:0.62rem;color:var(--text-3);font-style:italic;margin:2px 0 6px;padding-left:2px">Teacher override (calculated: ${calculated} ${PROF_LABELS[Math.round(calculated)] || ''}): ${esc(secOverride.reason)}</div>`;
      }
      sec.tags.forEach(tag => {
        const prof = getTagProficiency(cid, student.id, tag.id);
        const r = Math.round(prof);
        const color = PROF_COLORS[r] || PROF_COLORS[0];
        const tint = PROF_TINT[r] || PROF_TINT[0];
        const label = prof > 0 ? PROF_LABELS[r] : 'Not yet assessed';
        const barPct = prof > 0 ? (prof / 4) * 100 : 0;
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

  function renderBlockNextSteps(cid, student, options) {
    const icanCount = options && options.ican != null ? Math.max(0, Math.min(3, Number(options.ican))) : 2;
    const focusAreas = getFocusAreas(cid, student.id, 3);
    const realFocus = focusAreas.filter(f => f.prof <= 2);
    if (realFocus.length === 0) return _keepGoing(cid, student, icanCount);
    let html = `<div class="report-next-steps"><div class="report-next-steps-title">Suggested Next Steps</div>`;
    realFocus.forEach((f, i) => {
      const secName = f.section ? f.section.name : '';
      const profLabel = f.prof > 0 ? PROF_LABELS[Math.round(f.prof)] : 'No Evidence';
      const profColor = PROF_COLORS[Math.round(f.prof)] || PROF_COLORS[0];
      let nextStepDesc = `<strong>${esc(secName)}</strong> &mdash; ${esc(f.tag.label)}: ${esc(profLabel)}.`;
      // The first two I-can statements as goals. Three focus areas with four
      // statements each was a third of a page on its own.
      if (icanCount > 0 && f.tag.i_can_statements && f.tag.i_can_statements.length > 0) {
        nextStepDesc += ` <span style="color:var(--text-2)">Focus areas:</span>`;
        nextStepDesc += `<ul class="report-ican-list" style="margin-top:4px">`;
        f.tag.i_can_statements.slice(0, icanCount).forEach(stmt => {
          nextStepDesc += `<li class="report-ican-item">${esc(stmt)}</li>`;
        });
        nextStepDesc += `</ul>`;
      } else if (icanCount > 0) {
        nextStepDesc += ` Continue building skills in this area.`;
      }
      html += `<div class="report-next-step-item">
      <div class="report-next-step-bullet" data-prof-bg="${Math.round(f.prof)}" style="background:${profColor}">${i + 1}</div>
      <div>${nextStepDesc}</div>
    </div>`;
    });
    html += `</div>`;
    return html;
  }

  /* No area under Proficient: the strongest competency and its next I-can
     statements, so the block always says something true. Nothing when the
     student has no evidence at all. */
  function _keepGoing(cid, student, icanCount) {
    const best = getAllTags(cid)
      .map(t => ({ tag: t, prof: getTagProficiency(cid, student.id, t.id), section: getSectionForTag(cid, t.id) }))
      .filter(x => x.prof > 0)
      .sort((a, b) => b.prof - a.prof)[0];
    if (!best) return '';
    const r = Math.round(best.prof);
    let desc = `<strong>Keep going</strong> &mdash; ${esc(best.section ? best.section.name : '')}: ${esc(best.tag.label)}, ${esc(PROF_LABELS[r] || '')}.`;
    const stmts = (best.tag.i_can_statements || []).slice(0, icanCount);
    if (stmts.length) {
      desc += `<ul class="report-ican-list" style="margin-top:4px">${stmts.map(st => `<li class="report-ican-item">${esc(st)}</li>`).join('')}</ul>`;
    }
    return `<div class="report-next-steps"><div class="report-next-steps-title">Suggested Next Steps</div><div class="report-next-step-item">
      <div class="report-next-step-bullet" data-prof-bg="${r}" style="background:${PROF_COLORS[r] || PROF_COLORS[0]}">1</div>
      <div>${desc}</div>
    </div></div>`;
  }

  function renderBlockLegend() {
    return `<div class="report-legend">
    <div class="report-legend-item">${levelDots(1)}<div class="report-legend-text"><span class="report-legend-word">Emerging</span><span class="report-legend-desc">Beginning to develop understanding; requires consistent support</span></div></div>
    <div class="report-legend-item">${levelDots(2)}<div class="report-legend-text"><span class="report-legend-word">Developing</span><span class="report-legend-desc">Growing understanding; demonstrates learning with some support</span></div></div>
    <div class="report-legend-item">${levelDots(3)}<div class="report-legend-text"><span class="report-legend-word">Proficient</span><span class="report-legend-desc">Solid, independent understanding of grade-level expectations</span></div></div>
    <div class="report-legend-item">${levelDots(4)}<div class="report-legend-text"><span class="report-legend-word">Extending</span><span class="report-legend-desc">Deep, sophisticated understanding; applies learning in new contexts</span></div></div>
  </div>`;
  }

  /* ── Parent / Guardian Response ── */
  function renderBlockParentResponse(cid, student) {
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
    <div class="report-parent-comments-box" style="border:1.5px solid var(--border);border-radius:8px;min-height:60px;padding:8px"></div>
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
    const allScores = getScores(cid)[student.id] || [];
    const levelScores = _levelScores(cid, student.id);
    let html = `<div class="report-block-box report-section-chart">
    <div class="report-block-title">Section Proficiency Breakdown</div>`;

    sections.forEach((sec, si) => {
      const secProf = getSectionProficiency(cid, student.id, sec.id);
      const sr = Math.round(secProf);
      const secLabel = secProf > 0 ? PROF_LABELS[sr] : 'No Evidence';

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
      // Missing: assessments that have tags in this section but student has no scores
      const missingAssess = assessments.filter(a => {
        const hasTags = (a.tagIds || []).some(tid => secTagIds.has(tid));
        if (!hasTags) return false;
        return !allScores.some(s => s.assessmentId === a.id && secTagIds.has(s.tagId) && s.score > 0);
      });

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
    [1, 2, 3, 4].forEach(level => {
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

    // Missing assignments (no scores at all for this student)
    const missing = assessments.filter(a => {
      const aScores = allScores.filter(s => s.assessmentId === a.id && isScoreEntered(a, s));
      return aScores.length === 0;
    });

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
    [4, 3, 2, 1].forEach(level => {
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
    // Late policy note (configurable per course)
    const cc = getCourseConfig(cid);
    const latePolicy = cc.lateWorkPolicy || '';
    html += `<div style="flex:1;min-width:0;padding-top:6px">
    <div style="font-size:0.68rem;font-weight:700;color:var(--text-2);margin-bottom:4px">Late Work Policy</div>
    <div contenteditable="true" data-action="latePolicyEdit" style="font-size:0.68rem;color:${latePolicy ? 'var(--text-2)' : 'var(--text-3)'};line-height:1.45;font-style:${latePolicy ? 'normal' : 'italic'};outline:none;min-height:1.4em"
    >${latePolicy || 'No late work policy set'}</div>
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

  /* ── Assignment Grades Table ── */
  function renderBlockGradeTable(cid, student, options) {
    options = options || {};
    const on = key => options[key] !== false;
    // This term by default; the last ten or everything when the teacher says so.
    const range = options.range === 'all' || options.range === 'last10' ? options.range : 'term';
    let assessments = getAssessments(cid).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (range === 'term') assessments = assessments.filter(a => assessmentInActiveTerm(cid, a));
    else if (range === 'last10') assessments = assessments.slice(0, 10);
    const scores = getScores(cid)[student.id] || [];
    if (assessments.length === 0) return '';
    const scale = getGradingScale(cid);
    const scaleLabels = scale.labels || null;
    function profLabel(level) {
      if (scaleLabels && scaleLabels[level - 1]) return scaleLabels[level - 1];
      return PROF_LABELS[level] || '';
    }
    // Get tag objects for inline display
    const sections = getSections(cid);
    const allTags = sections.flatMap(sec => (sec.tags || []).map(t => ({ ...t, color: sec.color })));

    function renderRows(list) {
      let rows = '';
      list.forEach(a => {
        const cmpEntry = isCompletionScored(a) ? scores.find(s => s.assessmentId === a.id && s.score != null) : null;
        const aScores = cmpEntry ? [cmpEntry] : scores.filter(s => s.assessmentId === a.id && isScoreEntered(a, s));
        const isPoints = a.scoreMode === 'points';
        const max = a.maxPoints || 100;
        const weightLabel =
          getAssessmentWeight(a) !== 1
            ? ` <span style="font-size:0.62rem;color:var(--text-3);font-weight:400">${a.weight}×</span>`
            : '';
        const dateStr = a.date
          ? new Date(a.date + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
          : '—';
        const categoryLabel = getAssessmentCategoryName(cid, a);
        // Learning areas column — use readable labels, deduplicate by section
        const tagSections = new Set();
        (a.tagIds || []).forEach(tid => {
          const sec = sections.find(s => (s.tags || []).some(t => t.id === tid));
          if (sec) tagSections.add(sec.shortName || sec.name);
        });
        const tagPills = Array.from(tagSections)
          .map(
            name =>
              `<span style="display:inline-block;font-size:0.62rem;font-weight:500;color:var(--text-2);line-height:1.3">${esc(name)}</span>`,
          )
          .join('<span style="color:var(--text-3);margin:0 2px">·</span>');
        if (aScores.length === 0) {
          const span = (on('score') ? 1 : 0) + (on('level') ? 1 : 0);
          rows += `<tr>
          <td style="font-weight:500">${esc(a.title)}${weightLabel}</td>
          ${on('date') ? `<td class="col-date" style="color:var(--text-3);font-size:0.76rem">${dateStr}</td>` : ''}
          ${on('category') ? `<td class="col-category" style="font-size:0.68rem;color:var(--text-2)">${esc(categoryLabel)}</td>` : ''}
          ${on('area') ? `<td class="col-area" style="font-size:0.68rem">${tagPills}</td>` : ''}
          ${span ? `<td style="color:var(--text-3);font-style:italic" colspan="${span}">Not assessed</td>` : ''}</tr>`;
          return;
        }
        let scoreDisplay, profDisplay;
        if (cmpEntry) {
          const done = Number(cmpEntry.score) > 0;
          const color = done ? 'var(--score-3)' : 'var(--score-1)';
          scoreDisplay = `<td style="text-align:center;font-weight:600;font-size:1rem;color:${color}">${done ? '\u2713' : '\u2717'}</td>`;
          profDisplay = `<td style="text-align:center;font-size:0.74rem;font-weight:600;color:${color}">${done ? 'Complete' : 'Incomplete'}</td>`;
        } else if (isPoints) {
          const rawAvg = aScores.reduce((s, x) => s + x.score, 0) / aScores.length;
          const pct = Math.round((rawAvg / max) * 100);
          const profLevel = pointsToProf(rawAvg, max, scale);
          const color = PROF_COLORS[profLevel] || 'var(--text-3)';
          scoreDisplay = `<td style="text-align:center;font-weight:600;font-size:1rem">${formatPoints(rawAvg)}<span style="color:var(--text-3);font-weight:400">/${max}</span></td>`;
          profDisplay = `<td style="text-align:center"><span class="report-level-pill" data-prof="${profLevel}" data-prof-bg="${profLevel}" style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:0.74rem;font-weight:600;background:${PROF_TINT[profLevel] || 'transparent'};color:${color}">${levelDots(profLevel)}${profLabel(profLevel)} <span style="font-weight:400;opacity:0.7">${pct}%</span></span></td>`;
        } else {
          let avg = aScores.reduce((s, x) => s + scoreModValue(x), 0) / aScores.length;
          const rubricAvg = getRubricAssessmentScore(cid, a, aScores);
          if (rubricAvg != null) avg = rubricAvg;
          const r = Math.round(avg);
          const color = PROF_COLORS[r] || 'var(--text-3)';
          scoreDisplay = `<td data-prof="${r}" style="text-align:center;font-weight:600;font-size:1rem;color:${color}">${r}<span style="color:var(--text-3);font-weight:400">/4</span></td>`;
          profDisplay = `<td style="text-align:center"><span class="report-level-pill" data-prof="${r}" data-prof-bg="${r}" style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:0.74rem;font-weight:600;background:${PROF_TINT[r] || 'transparent'};color:${color}">${levelDots(r)}${profLabel(r)}</span></td>`;
        }
        scoreDisplay = scoreDisplay.replace('<td ', '<td class="col-score" ');
        rows += `<tr>
        <td style="font-weight:500">${esc(a.title)}${weightLabel}</td>
        ${on('date') ? `<td class="col-date" style="color:var(--text-3);font-size:0.76rem">${dateStr}</td>` : ''}
        ${on('category') ? `<td class="col-category" style="font-size:0.68rem;color:var(--text-2)">${esc(categoryLabel)}</td>` : ''}
        ${on('area') ? `<td class="col-area" style="font-size:0.68rem">${tagPills}</td>` : ''}
        ${on('score') ? scoreDisplay : ''}${on('level') ? profDisplay : ''}</tr>`;
      });
      return rows;
    }

    let html = `<div class="report-block-box" style="page-break-inside:avoid">
    <div class="report-block-title">Assignment Grades</div>
    <table class="report-tag-table report-grade-table" style="margin-top:4px">
      <thead><tr>
        <th style="text-align:left">Assignment</th>
        ${on('date') ? '<th class="col-date" style="width:10%;text-align:left">Date</th>' : ''}
        ${on('category') ? '<th class="col-category" style="width:14%;text-align:left">Category</th>' : ''}
        ${on('area') ? '<th class="col-area" style="width:18%;text-align:left">Learning Area</th>' : ''}
        ${on('score') ? '<th class="col-score" style="width:12%;text-align:center">Score</th>' : ''}
        ${on('level') ? '<th style="width:12%;text-align:center">Proficiency</th>' : ''}
      </tr></thead><tbody>`;
    html += renderRows(assessments);
    html += `</tbody></table></div>`;
    return html;
  }

  /* ── Core Competencies ── */
  function renderBlockCoreCompetencies(cid, student, options) {
    options = options || {};
    const assessments = getAssessments(cid);
    const scores = getScores(cid)[student.id] || [];
    // Count competency exposure: how many assessments touched each competency, and avg score
    const compData = {};
    CORE_COMPETENCIES.forEach(c => {
      compData[c.id] = { count: 0, totalScore: 0, scored: 0 };
    });
    assessments.forEach(a => {
      const ccIds = a.coreCompetencyIds || [];
      if (ccIds.length === 0) return;
      const aScores = scores.filter(s => s.assessmentId === a.id && s.score > 0);
      let avg = aScores.length > 0 ? aScores.reduce((sum, s) => sum + scoreModValue(s), 0) / aScores.length : 0;
      const rubricAvg = getRubricAssessmentScore(cid, a, aScores);
      if (rubricAvg != null) avg = rubricAvg;
      ccIds.forEach(ccId => {
        if (compData[ccId]) {
          compData[ccId].count++;
          if (avg > 0) {
            compData[ccId].totalScore += avg;
            compData[ccId].scored++;
          }
        }
      });
    });
    const hasAny = Object.values(compData).some(d => d.count > 0);
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
        const pct = avg > 0 ? (avg / 4) * 100 : 0;
        const color = avg > 0 ? PROF_COLORS[r] || 'var(--text-3)' : 'var(--border)';
        const profLabel = d.count === 0 ? 'Not yet assessed' : avg > 0 ? PROF_LABELS[r] : 'Not yet assessed';
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
  function renderBlockSupportHome(cid, student, options) {
    options = options || {};
    const count = Math.max(1, Math.min(3, Number(options.lines) || 2));
    const weakest = getAllTags(cid)
      .map(t => ({ tag: t, prof: getTagProficiency(cid, student.id, t.id) }))
      .filter(x => x.prof > 0 && (x.tag.i_can_statements || []).length)
      .sort((a, b) => a.prof - b.prof)
      .slice(0, count);
    const lines = weakest.map(x => _forFamily(student, x.tag.i_can_statements[0]));
    const note = String(options.note || '').trim();
    if (note) lines.push(note);
    if (!lines.length) return '';
    return `<div class="report-block-box report-support-home">
    <div class="report-block-title">Ways to Support at Home</div>
    <ul class="report-support-list">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
  </div>`;
  }

  /* The assessments dated in the report's term (all when no term is
     active), each with its cell as the Scores view shows it. */
  function _termCells(cid, student) {
    return getAssessments(cid)
      .filter(a => assessmentInActiveTerm(cid, a))
      .map(a => ({ a: a, cell: assessmentCellValue(cid, student.id, a) }));
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
    const missing = cells.filter(c => c.cell.kind === 'missing' || c.cell.status === 'NS').length;
    const obs = getStudentQuickObs(cid, student.id).filter(o =>
      _inActiveTerm(cid, String(o.date || o.created || '').slice(0, 10)),
    ).length;
    const levels = _reportSections(cid)
      .map(sec => ({ sec: sec, sp: getSectionProficiency(cid, student.id, sec.id) }))
      .filter(x => x.sp > 0)
      .sort((a, b) => b.sp - a.sp);
    const name = x => (x ? esc(x.sec.shortName || x.sec.name) : '\u2014');
    const strongest = levels[0] || null;
    const growing = levels.length > 1 ? levels[levels.length - 1] : null;
    const fig = (value, label, word) =>
      `<div class="report-glance-fig${word ? ' word' : ''}"><div class="report-glance-value">${value}</div><div class="report-glance-label">${label}</div></div>`;
    return `<div class="report-block-box report-term-glance">
    <div class="report-block-title">This Term at a Glance</div>
    <div class="report-glance">${fig(assessed, 'Assessed')}${fig(late, 'Late')}${fig(missing, 'Missing')}${fig(obs, 'Observations')}${fig(name(strongest), 'Strongest', true)}${fig(name(growing), 'Growing', true)}</div>
  </div>`;
  }

  /* ── Growth Since Last Report ──
     Each competency's level in the previous reporting term beside this
     one. calc.js is scoped to the previous term for the reading and put
     back after (as Print Grades does). Nothing when there is no previous
     term or no evidence in it. */
  function renderBlockGrowth(cid, student) {
    const now = getActiveTerm(cid);
    if (!now) return '';
    const prev = getReportingTerms(cid)
      .filter(t => t.ordinal < now.ordinal)
      .pop();
    if (!prev) return '';
    const sections = _reportSections(cid);
    const current = sections.map(sec => getSectionProficiency(cid, student.id, sec.id));
    let before;
    try {
      setActiveTerm(cid, prev.ordinal);
      before = sections.map(sec => getSectionProficiency(cid, student.id, sec.id));
    } finally {
      setActiveTerm(cid, now.ordinal);
    }
    if (!before.some(v => v > 0)) return '';
    const arrow = (a, b) => {
      if (!(a > 0) || !(b > 0)) return '';
      const d = Math.round(b) - Math.round(a);
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
    <table class="report-ct"><thead><tr><th>Competency</th><th class="col-before">${esc(prev.label || 'Last Report')}</th><th>${esc(now.label || 'This Report')}</th><th></th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
  }

  /* ── Missing Work ── this term's assessments past due with no score, or
     marked not submitted. Nothing for a student with none. */
  function renderBlockMissingWork(cid, student) {
    const missing = _termCells(cid, student).filter(c => c.cell.kind === 'missing' || c.cell.status === 'NS');
    if (!missing.length) return '';
    const day = d =>
      d ? new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '\u2014';
    const rows = missing
      .map(
        c =>
          `<tr><td>${esc(c.a.title)}</td><td class="col-date">${day(c.a.dueDate || c.a.date)}</td><td>${c.cell.status === 'NS' ? 'Not Submitted' : 'Past Due'}</td></tr>`,
      )
      .join('');
    return `<div class="report-block-box report-missing-work">
    <div class="report-block-title">Missing Work</div>
    <table class="report-tag-table"><thead><tr><th style="text-align:left">Assignment</th><th class="col-date" style="text-align:left">Due</th><th style="text-align:left">Status</th></tr></thead><tbody>${rows}</tbody></table>
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
        return renderBlockAcademicSummary(cid, student);
      case 'section-chart':
        return renderBlockSectionChart(cid, student);
      case 'score-distribution':
        return renderBlockScoreDistribution(cid, student);
      case 'grade-table':
        return renderBlockGradeTable(cid, student, options);
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
        return renderBlockNextSteps(cid, student, options);
      case 'legend':
        return renderBlockLegend();
      case 'parent-response':
        return renderBlockParentResponse(cid, student);
      case 'student-reflection-learning':
        return renderBlockStudentReflectionLearning(cid, student);
      case 'student-reflection-habits':
        return renderBlockStudentReflectionHabits(cid, student);
      case 'support-home':
        return renderBlockSupportHome(cid, student, options);
      case 'term-glance':
        return renderBlockTermGlance(cid, student);
      case 'growth':
        return renderBlockGrowth(cid, student);
      case 'missing-work':
        return renderBlockMissingWork(cid, student);
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
    OBS_DESCRIPTORS: OBS_DESCRIPTORS,
    renderBlockHeader: renderBlockHeader,
    renderBlockAcademicSummary: renderBlockAcademicSummary,
    renderBlockLearnerDimensions: renderBlockLearnerDimensions,
    renderBlockTeacherNarrative: renderBlockTeacherNarrative,
    renderCommentBox: renderCommentBox,
    renderBlockCompetencyTable: renderBlockCompetencyTable,
    renderBlockObservations: renderBlockObservations,
    renderBlockSectionOutcomes: renderBlockSectionOutcomes,
    renderBlockNextSteps: renderBlockNextSteps,
    renderBlockLegend: renderBlockLegend,
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
    renderReportBlock: renderReportBlock,
  };
})();
