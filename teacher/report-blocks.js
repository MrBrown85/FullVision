/* report-blocks.js — Report block renderers (extracted from page-reports.js) */
window.ReportBlocks = (function() {
  'use strict';

  /* ── Term ID helper ──────────────────────────────────────── */
function getTermId() {
  const period = (document.getElementById('report-period')?.value || 'Report 1').trim();
  // Map "Report N" → "term-N" for backwards compatibility with stored data
  const m = period.match(/Report\s+(\d+)/i);
  if (m) return 'term-' + m[1];
  return period.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
}

  /* ── Pronoun helpers ─────────────────────────────────────── */
function getPronouns(student) {
  const p = (student.pronouns || 'they/them').toLowerCase().split('/');
  const subj = p[0] || 'they';
  const obj = p[1] || 'them';
  let poss, refl, verb;
  if (subj === 'she') { poss = 'her'; refl = 'herself'; verb = 's'; }
  else if (subj === 'he') { poss = 'his'; refl = 'himself'; verb = 's'; }
  else { poss = 'their'; refl = 'themselves'; verb = ''; }
  return { subj, obj, poss, refl, verb, capSubj: subj[0].toUpperCase() + subj.slice(1) };
}

/* sanitizeNarrativeHtml — delegates to shared sanitizeHtml in gb-ui.js */
function sanitizeNarrativeHtml(raw) { return sanitizeHtml(raw); }

const OBS_DESCRIPTORS = {
  engagement:      { prompt:'I participate actively and stay focused on my learning', desc:'Active participation and focus in learning', example:'Stays on task, asks questions, contributes ideas' },
  collaboration:   { prompt:'I work well with others and support my group', desc:'Working effectively with others', example:'Shares ideas, listens to peers, supports group goals' },
  selfRegulation:  { prompt:'I manage my time, stay organized, and handle my emotions', desc:'Managing time, emotions, and work habits', example:'Plans ahead, handles setbacks, stays organized' },
  resilience:      { prompt:'I keep trying when things are difficult', desc:'Persevering through challenges', example:'Tries again after mistakes, seeks help, doesn\'t give up' },
  curiosity:       { prompt:'I explore new ideas and take risks in my thinking', desc:'Exploring ideas and taking intellectual risks', example:'Asks "what if?", tries new approaches, goes deeper' },
  respect:         { prompt:'I show care for my classmates and our community', desc:'Showing care for others and the community', example:'Kind words, active listening, inclusive behavior' }
};

/* ══════════════════════════════════════════════════════════════
   REPORT BLOCK RENDERERS — Each renders one configurable block
   ══════════════════════════════════════════════════════════════ */
function renderBlockHeader(cid, student) {
  const course = COURSES[cid];
  const period = document.getElementById('report-period').value;
  return `<div class="report-header">
    <div class="report-course-title">${esc(course.name)} Student Learning Report</div>
    <div class="report-student-name">${esc(fullName(student))}${student.studentNumber ? ` <span style="font-size:0.7em;color:var(--text-3);font-weight:400">(${esc(student.studentNumber)})</span>` : ''}</div>
    <div class="report-period">${esc(period)}</div>
  </div>`;
}

function renderBlockAcademicSummary(cid, student) {
  const sections = getSections(cid);
  const overall = getOverallProficiency(cid, student.id);
  const overallRound = Math.round(overall);
  const cc = getCourseConfig(cid);
  const usePercentage = cc.reportAsPercentage || false;
  let overallDisplay, overallHeading;
  if (usePercentage && overall > 0) {
    const letterData = calcLetterGrade(overall);
    overallDisplay = letterData ? letterData.pct + '%' : Math.round((overall / 4) * 100) + '%';
    overallHeading = 'Overall Grade';
  } else {
    overallDisplay = overall > 0 ? PROF_LABELS[overallRound] : 'No Evidence';
    overallHeading = 'Overall Proficiency';
  }
  let html = `<div class="report-overall">
    <div class="report-overall-main">
      <div class="report-overall-label">${overallHeading}</div>
      <div class="report-overall-word">${overallDisplay}</div>
    </div>
    <div class="report-overall-sections">`;
  const _rptGrouped = getGroupedSections(cid);
  const _renderChip = (name, prof, color) => {
    const sr = Math.round(prof);
    const slabel = prof > 0 ? PROF_LABELS[sr] : 'No Evidence';
    const scolor = PROF_COLORS[sr] || PROF_COLORS[0];
    return `<div class="report-section-chip">
      <div class="report-section-chip-name" style="color:${color}">${esc(name)}</div>
      <div class="report-section-chip-value" data-prof="${sr}" style="color:${scolor}">${slabel}</div>
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

function renderBlockLearnerDimensions(cid, student) {
  const termId = getTermId();
  const rating = getStudentTermRating(cid, student.id, termId);
  if (!rating) return '';
  const dims = rating.dims || {};
  let html = `<div class="report-learner-profile">`;
  html += `<div class="report-learner-title">👁 Disposition Dimensions</div>`;
  html += `<div class="report-learner-dims">`;
  OBS_DIMS.forEach(dim => {
    const val = dims[dim] || 0;
    const pct = val > 0 ? (val / 4 * 100) : 0;
    const label = val > 0 ? OBS_LEVEL_LABELS[val] : 'Not Assessed';
    const color = val > 0 ? OBS_LEVEL_COLORS[val] : 'var(--text-3)';
    const info = OBS_DESCRIPTORS[dim] || {};
    html += `<div class="report-learner-dim">
      <span class="report-learner-dim-icon">${OBS_ICONS[dim]}</span>
      <div class="report-learner-dim-info">
        <div class="report-learner-dim-label">${OBS_LABELS[dim]}</div>
        <div class="report-dim-desc">${info.desc || ''}</div>
        <div class="report-dim-example">e.g. ${info.example || ''}</div>
        <div class="report-learner-dim-value" data-prof="${val}" style="color:${color};margin-top:4px">${label}</div>
        <div class="report-learner-dim-bar">
          <div class="report-learner-dim-fill" data-prof-bg="${val}" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>
    </div>`;
  });
  html += `</div></div>`;
  return html;
}

function renderBlockTeacherNarrative(cid, student) {
  const termId = getTermId();
  const rating = getStudentTermRating(cid, student.id, termId);
  if (!rating || !rating.narrative || !rating.narrative.trim()) return '';
  const isHtml = /<[a-z][\s\S]*>/i.test(rating.narrative);
  const content = isHtml ? sanitizeNarrativeHtml(rating.narrative.trim()) : esc(rating.narrative.trim());
  let html = `<div class="report-block-box" style="page-break-inside:avoid">`;
  html += `<div class="report-block-title">Teacher Comment</div>`;
  html += `<div style="font-size:0.88rem;color:var(--text);line-height:1.6;padding:4px 0">${content}</div>`;
  html += `</div>`;
  return html;
}

function renderBlockObservations(cid, student) {
  const quickObs = getStudentQuickObs(cid, student.id);
  const recentObs = quickObs.slice(0, 5);
  if (recentObs.length === 0) return '';
  let html = `<div class="report-learner-profile">`;
  html += `<div class="report-learner-title">📝 Observation Evidence</div>`;
  html += `<div class="report-obs-notes">`;
  recentObs.forEach(ob => {
    const dimPills = (ob.dims || []).map(d => {
      const info = resolveTag(d);
      return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:0.62rem;padding:1px 6px;border-radius:8px;background:var(--overlay-hover);color:var(--text-2);margin-left:4px;"><span style="width:5px;height:5px;border-radius:50%;background:${info.color};display:inline-block;"></span>${esc(info.label)}</span>`;
    }).join('');
    const assignPill = ob.assignmentContext ? `<span style="font-size:0.55rem;font-weight:600;color:var(--active);background:rgba(0,122,255,0.08);padding:1px 6px;border-radius:8px;margin-right:4px">${esc(ob.assignmentContext.assessmentTitle)}</span>` : '';
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
    <div class="report-block-title">Learning Outcomes</div>`;
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
      html += `<div style="font-size:0.62rem;color:var(--text-3);font-style:italic;margin:2px 0 6px;padding-left:2px">Teacher override (calculated: ${secOverride.calculated} ${PROF_LABELS[Math.round(secOverride.calculated)] || ''}): ${esc(secOverride.reason)}</div>`;
    }
    sec.tags.forEach(tag => {
      const prof = getTagProficiency(cid, student.id, tag.id);
      const r = Math.round(prof);
      const color = PROF_COLORS[r] || PROF_COLORS[0];
      const tint = PROF_TINT[r] || PROF_TINT[0];
      const label = prof > 0 ? PROF_LABELS[r] : 'Not yet assessed';
      const barPct = prof > 0 ? (prof / 4 * 100) : 0;
      // Gather per-tag assessment evidence
      const tagScores = allScores.filter(s => s.tagId === tag.id && s.score > 0);
      const evidenceMap = {};
      tagScores.forEach(s => {
        if (!evidenceMap[s.assessmentId]) evidenceMap[s.assessmentId] = [];
        evidenceMap[s.assessmentId].push(s.score);
      });
      const evidence = Object.keys(evidenceMap).map(aId => {
        const a = assessments.find(x => x.id === aId);
        if (!a) return null;
        const avg = evidenceMap[aId].reduce((s,x) => s+x, 0) / evidenceMap[aId].length;
        const ar = Math.round(avg);
        return { title: a.title, r: ar, label: (PROF_LABELS[ar]||'?') };
      }).filter(Boolean);
      html += `<div class="report-outcome-row">
        <div class="report-outcome-info">
          <div class="report-outcome-label">${esc(tag.label || tag.text)}</div>`;
      // Evidence: assignment names with proficiency in brackets — displayed as a wrapping block
      if (evidence.length > 0) {
        const evStr = evidence.map(e =>
          `<span class="report-outcome-ev" data-prof="${e.r}" style="color:${PROF_COLORS[e.r]||'var(--text-3)'}">${esc(e.title)}\u2009<span style="font-weight:600">[${e.label[0]}]</span></span>`
        ).join('<span style="color:var(--text-3);margin:0 3px">·</span>');
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
          <span class="report-outcome-pill" data-prof="${r}" data-prof-bg="${r}" style="background:${prof > 0 ? tint : 'var(--overlay-hover)'};color:${prof > 0 ? color : 'var(--text-3)'}">${label}</span>
        </div>
      </div>`;
    });
    html += `</div>`;
  });
  html += `</div>`;
  return html;
}

function renderBlockNextSteps(cid, student) {
  const focusAreas = getFocusAreas(cid, student.id, 3);
  const realFocus = focusAreas.filter(f => f.prof <= 2);
  if (realFocus.length === 0) return '';
  let html = `<div class="report-next-steps"><div class="report-next-steps-title">Suggested Next Steps</div>`;
  realFocus.forEach((f, i) => {
    const secName = f.section ? f.section.name : '';
    const profLabel = f.prof > 0 ? PROF_LABELS[Math.round(f.prof)] : 'No Evidence';
    const profColor = PROF_COLORS[Math.round(f.prof)] || PROF_COLORS[0];
    let nextStepDesc = `<strong>${esc(secName)}</strong> &mdash; ${esc(f.tag.label)}: ${esc(profLabel)}.`;
    // Add I Can statements as actionable goals for improvement
    if (f.tag.i_can_statements && f.tag.i_can_statements.length > 0) {
      nextStepDesc += ` <span style="color:var(--text-2)">Focus areas:</span>`;
      nextStepDesc += `<ul class="report-ican-list" style="margin-top:4px">`;
      f.tag.i_can_statements.forEach(stmt => {
        nextStepDesc += `<li class="report-ican-item">${esc(stmt)}</li>`;
      });
      nextStepDesc += `</ul>`;
    } else {
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

function renderBlockLegend() {
  return `<div class="report-legend">
    <div class="report-legend-item"><span class="report-legend-dot" data-prof-bg="1" style="background:var(--score-1)"></span><div class="report-legend-text"><span class="report-legend-word">Emerging</span><span class="report-legend-desc">Beginning to develop understanding; requires consistent support</span></div></div>
    <div class="report-legend-item"><span class="report-legend-dot" data-prof-bg="2" style="background:var(--score-2)"></span><div class="report-legend-text"><span class="report-legend-word">Developing</span><span class="report-legend-desc">Growing understanding; demonstrates learning with some support</span></div></div>
    <div class="report-legend-item"><span class="report-legend-dot" data-prof-bg="3" style="background:var(--score-3)"></span><div class="report-legend-text"><span class="report-legend-word">Proficient</span><span class="report-legend-desc">Solid, independent understanding of grade-level expectations</span></div></div>
    <div class="report-legend-item"><span class="report-legend-dot" data-prof-bg="4" style="background:var(--score-4)"></span><div class="report-legend-text"><span class="report-legend-word">Extending</span><span class="report-legend-desc">Deep, sophisticated understanding; applies learning in new contexts</span></div></div>
  </div>`;
}

/* ── Parent / Guardian Response ── */
function renderBlockParentResponse(cid, student) {
  const name = esc(displayNameFirst(student));
  let html = `<div class="report-block-box report-parent-response">`;
  html += `<div class="report-block-title">Parent / Guardian Response</div>`;
  html += `<div style="font-size:0.78rem;color:var(--text-2);margin-bottom:14px;line-height:1.5">Please review this report with your child and return this section to the school.</div>`;
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
  html += `<div style="margin-top:14px">
    <div class="report-parent-label" style="margin-bottom:6px">Comments or Questions</div>
    <div style="border:1.5px solid var(--border);border-radius:8px;min-height:60px;padding:8px"></div>
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
  scale.forEach(s => { html += `<span style="width:68px;text-align:center;font-size:0.56rem;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:var(--text-3)">${s}</span>`; });
  html += `</div>`;
  // Disposition rows
  OBS_DIMS.forEach(dim => {
    const info = OBS_DESCRIPTORS[dim];
    html += `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--divider-subtle)">
      <span style="font-size:1.1rem;flex-shrink:0">${OBS_ICONS[dim]}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:0.82rem;font-weight:700;color:var(--text)">${OBS_LABELS[dim]}</div>
        <div style="font-size:0.7rem;color:var(--text-2);font-style:italic;line-height:1.3">${info.prompt}</div>
      </div>
      <div style="display:flex;gap:0;flex-shrink:0">`;
    scale.forEach(() => { html += `<span style="width:68px;display:flex;justify-content:center"><span class="report-reflect-bubble"></span></span>`; });
    html += `</div></div>`;
  });
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
    { icon:'📅', text:'I arrive to class on time' },
    { icon:'📋', text:'I come prepared with materials' },
    { icon:'✋', text:'I participate in class discussions' },
    { icon:'📝', text:'I hand in assignments on time' },
    { icon:'🔄', text:'When I miss class, I check in and catch up' },
    { icon:'🤝', text:'I am respectful to classmates and teachers' },
    { icon:'📱', text:'I manage distractions (phone, talking, etc.)' },
    { icon:'💪', text:'I put my best effort into my work' },
  ];
  const scale = ['Needs Work', 'Getting There', 'Good', 'Great'];
  const checks = [
    { text:'Missed more than 3 classes', icon:'📉' },
    { text:'Was late more than 3 times', icon:'⏰' },
    { text:'Had missing assignments', icon:'📂' },
    { text:'Asked for help when I needed it', icon:'🙋' },
    { text:'Used feedback to improve my work', icon:'🔁' },
    { text:'Set a goal and worked toward it', icon:'🎯' },
  ];
  let html = `<div class="report-block-box" style="page-break-inside:avoid">`;
  html += `<div class="report-block-title">My Classroom Habits & Responsibilities</div>`;
  html += `<div style="font-size:0.76rem;color:var(--text-2);margin-bottom:12px">${name}, think honestly about your habits this term. Fill in one circle per row.</div>`;
  // Rating table
  html += `<table class="report-habits-table"><thead><tr><th></th>`;
  scale.forEach(s => { html += `<th>${s}</th>`; });
  html += `</tr></thead><tbody>`;
  habits.forEach(h => {
    html += `<tr><td>${h.icon} ${h.text}</td>`;
    scale.forEach(() => { html += `<td><span class="report-habits-bubble"></span></td>`; });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  // Quick-check section
  html += `<div style="margin-top:14px;padding-top:12px;border-top:1.5px solid var(--border)">
    <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);margin-bottom:10px">This term, I…</div>
    <div class="report-habits-checks">`;
  checks.forEach(c => {
    html += `<div class="report-parent-check"><span class="report-parent-checkbox"></span> ${c.icon} ${c.text}</div>`;
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
  let html = `<div class="report-block-box" style="page-break-inside:avoid">
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
    const strengths = assessed.filter(t => t.r >= 3).sort((a,b) => b.prof - a.prof);
    const growth = assessed.filter(t => t.r <= 2).sort((a,b) => a.prof - b.prof);
    const notYet = tagData.filter(t => t.prof === 0);

    // Assessments that touched this section + student performance
    const secTagIds = new Set(sec.tags.map(t => t.id));
    const secScores = allScores.filter(s => secTagIds.has(s.tagId) && s.score > 0);
    const touchedAssessIds = new Set(secScores.map(s => s.assessmentId));
    const touchedAssess = assessments.filter(a => touchedAssessIds.has(a.id));
    // Per-assessment avg for this section's tags
    const assessPerf = touchedAssess.map(a => {
      const aScores = secScores.filter(s => s.assessmentId === a.id);
      if (aScores.length === 0) return null;
      const avg = aScores.reduce((s,x) => s + x.score, 0) / aScores.length;
      return { title: a.title, avg, r: Math.round(avg) };
    }).filter(Boolean).sort((a,b) => b.avg - a.avg);
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
    html += `<div style="font-weight:700;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);margin-bottom:2px">Strengths</div>`;
    if (strengths.length > 0) {
      strengths.forEach(t => {
        html += `<div style="display:flex;align-items:baseline;gap:4px;color:var(--text)">
          <span style="font-size:0.64rem;font-weight:600;color:var(--text-3);flex-shrink:0">${(PROF_LABELS[t.r]||'?')[0]}</span>
          <span>${esc(t.tag.label)}</span>
        </div>`;
      });
    } else {
      html += `<div style="color:var(--text-3);font-style:italic;font-size:0.72rem">None yet</div>`;
    }
    html += `</div>`;

    // Col 2: Growth
    html += `<div style="flex:1;min-width:0">`;
    html += `<div style="font-weight:700;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);margin-bottom:2px">Areas for Growth</div>`;
    if (growth.length > 0) {
      growth.forEach(t => {
        html += `<div style="display:flex;align-items:baseline;gap:4px;color:var(--text)">
          <span style="font-size:0.64rem;font-weight:600;color:var(--text-3);flex-shrink:0">${(PROF_LABELS[t.r]||'?')[0]}</span>
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
    html += `<div style="font-weight:700;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);margin-bottom:2px">Assessments</div>`;
    if (assessPerf.length > 0) {
      assessPerf.slice(0, 4).forEach(a => {
        html += `<div style="display:flex;align-items:baseline;gap:4px;color:var(--text)">
          <span style="font-size:0.64rem;font-weight:600;color:var(--text-3);flex-shrink:0">${(PROF_LABELS[a.r]||'?')[0]}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.title)}</span>
        </div>`;
      });
      if (assessPerf.length > 4) {
        html += `<div style="font-size:0.64rem;color:var(--text-3);font-style:italic">+${assessPerf.length - 4} more</div>`;
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
  const scored = allScores.filter(s => s.score > 0);
  if (scored.length === 0) return '';

  // Count by proficiency level
  const counts = { 1:0, 2:0, 3:0, 4:0 };
  scored.forEach(s => { if (s.score >= 1 && s.score <= 4) counts[s.score]++; });
  const total = scored.length;
  const rawColors = { 1:'var(--score-1)', 2:'var(--score-2)', 3:'var(--score-3)', 4:'var(--score-4)' };

  // Build donut chart SVG
  const cx = 50, cy = 50, r = 40, inner = 24;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  let arcs = '';
  [1,2,3,4].forEach(level => {
    if (counts[level] === 0) return;
    const pct = counts[level] / total;
    const dash = circ * pct;
    const gap = circ - dash;
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${rawColors[level]}" stroke-width="14"
      data-prof-stroke="${level}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += dash;
  });

  // Per-assessment averages for top/bottom
  const assessAvgs = assessments.map(a => {
    const aScores = allScores.filter(s => s.assessmentId === a.id && s.score > 0);
    if (aScores.length === 0) return null;
    const avg = aScores.reduce((s, x) => s + x.score, 0) / aScores.length;
    return { title: a.title, avg, r: Math.round(avg), type: a.type, id: a.id };
  }).filter(Boolean);
  const sorted = [...assessAvgs].sort((a, b) => b.avg - a.avg);
  const top = sorted.filter(a => a.r >= 3).slice(0, 3);
  const bottom = sorted.filter(a => a.r <= 2).reverse().slice(0, 3);

  // Missing assignments (no scores at all for this student)
  const missing = assessments.filter(a => {
    const aScores = allScores.filter(s => s.assessmentId === a.id && s.score > 0);
    return aScores.length === 0;
  });

  // Proficient+ percentage for circle gauge
  const profPlus = counts[3] + counts[4];
  const profPct = total > 0 ? Math.round(profPlus / total * 100) : 0;
  const gaugeR = 40, gaugeCirc = 2 * Math.PI * gaugeR;
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
        <text x="${cx}" y="${cy + 8}" text-anchor="middle" style="font-size:6.5px;fill:var(--text-3);text-transform:uppercase;letter-spacing:0.5px">scores</text>
      </svg>
      <div style="display:flex;flex-direction:column;gap:4px;flex:1">`;
  [4,3,2,1].forEach(level => {
    const pct = total > 0 ? Math.round(counts[level] / total * 100) : 0;
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
    html += `<div style="font-weight:700;font-size:0.56rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);margin:6px 0 3px">Top Assignments</div>`;
    top.forEach(a => {
      html += `<div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;line-height:1.6">
        <span data-prof="${a.r}" style="font-weight:600;color:${PROF_COLORS[a.r]};font-size:0.64rem;width:14px;flex-shrink:0">${(PROF_LABELS[a.r]||'?')[0]}</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.title)}</span>
      </div>`;
    });
  }
  // Bottom assignments
  if (bottom.length > 0) {
    html += `<div style="font-weight:700;font-size:0.56rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);margin:6px 0 3px">Needs Improvement</div>`;
    bottom.forEach(a => {
      html += `<div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;line-height:1.6">
        <span data-prof="${a.r}" style="font-weight:600;color:${PROF_COLORS[a.r]};font-size:0.64rem;width:14px;flex-shrink:0">${(PROF_LABELS[a.r]||'?')[0]}</span>
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
      <text x="50" y="60" text-anchor="middle" style="font-size:6px;fill:var(--text-3);text-transform:uppercase;letter-spacing:0.5px">at or above</text>
      <text x="50" y="68" text-anchor="middle" style="font-size:6px;fill:var(--text-3);text-transform:uppercase;letter-spacing:0.5px">proficient</text>
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
      <div class="report-missing-title" style="font-weight:700;font-size:0.56rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--score-1);margin-bottom:4px">Missing Assignments (${missing.length})</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px">`;
    missing.forEach(a => {
      html += `<div style="font-size:0.68rem;color:var(--text);line-height:1.6;display:flex;align-items:baseline;gap:4px;min-width:0">
        <span style="color:var(--text-3);font-size:0.56rem;flex-shrink:0;font-weight:600">${a.type === 'summative' ? 'S' : 'F'}</span>
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
function renderBlockGradeTable(cid, student) {
  const assessments = getAssessments(cid).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const scores = getScores(cid)[student.id] || [];
  if (assessments.length === 0) return '';
  const scale = getGradingScale(cid);
  const scaleLabels = scale.labels || null;
  function profLabel(level) {
    if (scaleLabels && scaleLabels[level-1]) return scaleLabels[level-1];
    return PROF_LABELS[level] || '';
  }
  // Split into summative and formative
  const summative = assessments.filter(a => a.type === 'summative');
  const formative = assessments.filter(a => a.type !== 'summative');

  // Get tag objects for inline display
  const sections = getSections(cid);
  const allTags = sections.flatMap(sec => (sec.tags || []).map(t => ({ ...t, color: sec.color })));

  function renderRows(list) {
    let rows = '';
    list.forEach(a => {
      const aScores = scores.filter(s => s.assessmentId === a.id && s.score > 0);
      const isPoints = a.scoreMode === 'points';
      const max = a.maxPoints || 100;
      const weightLabel = (a.weight && a.weight !== 1) ? ` <span style="font-size:0.62rem;color:var(--text-3);font-weight:400">${a.weight}×</span>` : '';
      const dateStr = a.date ? new Date(a.date + 'T00:00:00').toLocaleDateString('en-CA', { month:'short', day:'numeric' }) : '—';
      // Learning areas column — use readable labels, deduplicate by section
      const tagSections = new Set();
      (a.tagIds || []).forEach(tid => {
        const sec = sections.find(s => (s.tags || []).some(t => t.id === tid));
        if (sec) tagSections.add(sec.shortName || sec.name);
      });
      const tagPills = Array.from(tagSections).map(name =>
        `<span style="display:inline-block;font-size:0.62rem;font-weight:500;color:var(--text-2);line-height:1.3">${esc(name)}</span>`
      ).join('<span style="color:var(--text-3);margin:0 2px">·</span>');
      if (aScores.length === 0) {
        rows += `<tr>
          <td style="font-weight:500">${esc(a.title)}${weightLabel}</td>
          <td style="color:var(--text-3);font-size:0.76rem">${dateStr}</td>
          <td style="font-size:0.68rem">${tagPills}</td>
          <td style="color:var(--text-3);font-style:italic" colspan="2">Not assessed</td></tr>`;
        return;
      }
      let scoreDisplay, profDisplay;
      if (isPoints) {
        const rawAvg = aScores.reduce((s, x) => s + x.score, 0) / aScores.length;
        const pct = Math.round((rawAvg / max) * 100);
        const profLevel = pointsToProf(rawAvg, max, scale);
        const color = PROF_COLORS[profLevel] || 'var(--text-3)';
        scoreDisplay = `<td style="text-align:center;font-weight:600;font-size:1rem">${Math.round(rawAvg)}<span style="color:var(--text-3);font-weight:400">/${max}</span></td>`;
        profDisplay = `<td style="text-align:center"><span data-prof="${profLevel}" data-prof-bg="${profLevel}" style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:0.74rem;font-weight:600;background:${PROF_TINT[profLevel]||'transparent'};color:${color}">${profLabel(profLevel)} <span style="font-weight:400;opacity:0.7">${pct}%</span></span></td>`;
      } else {
        const avg = aScores.reduce((s, x) => s + x.score, 0) / aScores.length;
        const r = Math.round(avg);
        const color = PROF_COLORS[r] || 'var(--text-3)';
        scoreDisplay = `<td data-prof="${r}" style="text-align:center;font-weight:600;font-size:1rem;color:${color}">${r}<span style="color:var(--text-3);font-weight:400">/4</span></td>`;
        profDisplay = `<td style="text-align:center"><span data-prof="${r}" data-prof-bg="${r}" style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:0.74rem;font-weight:600;background:${PROF_TINT[r]||'transparent'};color:${color}">${profLabel(r)}</span></td>`;
      }
      rows += `<tr>
        <td style="font-weight:500">${esc(a.title)}${weightLabel}</td>
        <td style="color:var(--text-3);font-size:0.76rem">${dateStr}</td>
        <td style="font-size:0.68rem">${tagPills}</td>
        ${scoreDisplay}${profDisplay}</tr>`;
    });
    return rows;
  }

  let html = `<div class="report-block-box" style="page-break-inside:avoid">
    <div class="report-block-title">Assignment Grades</div>
    <table class="report-tag-table report-grade-table" style="margin-top:4px">
      <thead><tr>
        <th style="width:36%;text-align:left">Assignment</th>
        <th style="width:10%;text-align:left">Date</th>
        <th style="width:18%;text-align:left">Learning Area</th>
        <th style="width:12%;text-align:center">Score</th>
        <th style="width:24%;text-align:center">Proficiency</th>
      </tr></thead><tbody>`;
  if (summative.length > 0) {
    html += `<tr class="report-grade-section"><td colspan="5" style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);padding:10px 0 4px;border-bottom:1.5px solid var(--border)">Summative</td></tr>`;
    html += renderRows(summative);
  }
  if (formative.length > 0) {
    html += `<tr class="report-grade-section"><td colspan="5" style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);padding:10px 0 4px;border-bottom:1.5px solid var(--border)">Formative</td></tr>`;
    html += renderRows(formative);
  }
  html += `</tbody></table></div>`;
  return html;
}

/* ── Core Competencies ── */
function renderBlockCoreCompetencies(cid, student) {
  const assessments = getAssessments(cid);
  const scores = getScores(cid)[student.id] || [];
  // Count competency exposure: how many assessments touched each competency, and avg score
  const compData = {};
  CORE_COMPETENCIES.forEach(c => { compData[c.id] = { count: 0, totalScore: 0, scored: 0 }; });
  assessments.forEach(a => {
    const ccIds = a.coreCompetencyIds || [];
    if (ccIds.length === 0) return;
    const aScores = scores.filter(s => s.assessmentId === a.id && s.score > 0);
    const avg = aScores.length > 0 ? aScores.reduce((sum, s) => sum + s.score, 0) / aScores.length : 0;
    ccIds.forEach(ccId => {
      if (compData[ccId]) {
        compData[ccId].count++;
        if (avg > 0) { compData[ccId].totalScore += avg; compData[ccId].scored++; }
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
    <div style="font-size:0.7rem;color:var(--text-2);margin:-2px 0 8px;line-height:1.35">Core competencies are the skills, habits, and dispositions students develop across all areas of learning. Progress is based on observations from classroom assessments.</div>
    <div style="display:flex;flex-wrap:wrap;gap:16px;padding:2px 0">`;
  Object.entries(groups).forEach(([groupName, comps]) => {
    html += `<div style="flex:1;min-width:180px">
      <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-3);font-weight:600;margin-bottom:6px">${esc(groupName)}</div>`;
    comps.forEach(c => {
      const d = compData[c.id];
      const avg = d.scored > 0 ? d.totalScore / d.scored : 0;
      const r = Math.round(avg);
      const pct = avg > 0 ? (avg / 4 * 100) : 0;
      const color = avg > 0 ? (PROF_COLORS[r] || 'var(--text-3)') : 'var(--border)';
      const profLabel = d.count === 0 ? 'Not yet assessed' : (avg > 0 ? PROF_LABELS[r] : 'Not yet assessed');
      const labelColor = avg > 0 ? color : 'var(--text-3)';
      html += `<div style="margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:2px">
          <span style="font-size:0.75rem;font-weight:500;color:var(--text)">${esc(c.label)}</span>
          <span data-prof="${r}" style="font-size:0.65rem;font-weight:600;color:${labelColor};white-space:nowrap">${profLabel}</span>
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

/* ── Block dispatcher ── */
function renderReportBlock(blockId, cid, student) {
  switch (blockId) {
    case 'header':            return renderBlockHeader(cid, student);
    case 'academic-summary':  return renderBlockAcademicSummary(cid, student);
    case 'section-chart':     return renderBlockSectionChart(cid, student);
    case 'score-distribution':return renderBlockScoreDistribution(cid, student);
    case 'grade-table':       return renderBlockGradeTable(cid, student);
    case 'section-outcomes':  return renderBlockSectionOutcomes(cid, student);
    case 'core-competencies': return renderBlockCoreCompetencies(cid, student);
    case 'learner-dimensions': return renderBlockLearnerDimensions(cid, student);
    case 'teacher-narrative':  return renderBlockTeacherNarrative(cid, student);
    case 'observations':      return renderBlockObservations(cid, student);
    case 'next-steps':        return renderBlockNextSteps(cid, student);
    case 'legend':            return renderBlockLegend();
    case 'parent-response':   return renderBlockParentResponse(cid, student);
    case 'student-reflection-learning': return renderBlockStudentReflectionLearning(cid, student);
    case 'student-reflection-habits':   return renderBlockStudentReflectionHabits(cid, student);
    default: return '';
  }
}

  /* ── Namespace ──────────────────────────────────────────── */
  return {
    getTermId: getTermId,
    getPronouns: getPronouns,
    OBS_DESCRIPTORS: OBS_DESCRIPTORS,
    renderBlockHeader: renderBlockHeader,
    renderBlockAcademicSummary: renderBlockAcademicSummary,
    renderBlockLearnerDimensions: renderBlockLearnerDimensions,
    renderBlockTeacherNarrative: renderBlockTeacherNarrative,
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
    renderReportBlock: renderReportBlock,
  };
})();
