/* == page-reports.js -- Reports page module ================ */
window.PageReports = (function() {
  'use strict';

  /* -- Listener tracking for cleanup ---------------------- */
  var _listeners = [];
  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    _listeners.push({ type: type, handler: handler, options: options });
  }

  var _beforeUnloadHandler = null;

/* ══════════════════════════════════════════════════════════════
   REPORTS PAGE — Logic
   ══════════════════════════════════════════════════════════════ */

var activeCourse;
var activeTab = 'questionnaire';

/* ══════════════════════════════════════════════════════════════
   REPORT BUILDER — Config, presets, persistence
   ══════════════════════════════════════════════════════════════ */
const DEFAULT_BLOCKS = [
  // Identity
  { id:'header',             label:'Header',                   enabled:true,  locked:true  },
  // Academic
  { id:'academic-summary',   label:'Academic Summary',         enabled:true,  locked:false },
  { id:'teacher-narrative',  label:'Teacher Comment',          enabled:true,  locked:false },
  { id:'section-chart',      label:'Section Proficiency Chart', enabled:false, locked:false },
  { id:'grade-table',        label:'Assignment Grades',        enabled:false, locked:false },
  { id:'score-distribution', label:'Score Distribution',       enabled:false, locked:false },
  { id:'section-outcomes',   label:'Learning Outcomes',        enabled:false, locked:false },
  { id:'core-competencies',  label:'Core Competencies',        enabled:false, locked:false },
  // Profile & narrative
  { id:'learner-dimensions', label:'Disposition Dimensions',   enabled:false, locked:false },
  // Student voice
  { id:'student-reflection-learning', label:'Student Reflection: My Learning', enabled:false, locked:false },
  { id:'student-reflection-habits',   label:'Student Reflection: My Habits',   enabled:false, locked:false },
  // Evidence
  { id:'observations',       label:'Observations & Evidence',  enabled:false, locked:false },
  // Growth
  { id:'next-steps',         label:'Growth & Next Steps',      enabled:false, locked:false },
  // Reference
  { id:'legend',             label:'Proficiency Legend',        enabled:false, locked:false },
  // Parent
  { id:'parent-response',    label:'Parent / Guardian Response', enabled:false, locked:false },
];

const REPORT_PRESETS = {
  brief:    ['header', 'academic-summary', 'teacher-narrative'],
  standard: ['header', 'academic-summary', 'teacher-narrative', 'section-chart', 'learner-dimensions', 'next-steps'],
  detailed: ['header', 'academic-summary', 'teacher-narrative', 'section-chart', 'score-distribution', 'grade-table',
             'section-outcomes', 'core-competencies', 'learner-dimensions',
             'student-reflection-learning', 'student-reflection-habits',
             'observations', 'next-steps', 'legend', 'parent-response'],
};

// getReportConfig / saveReportConfig are now in gb-data.js
// Wrap getReportConfig to validate/migrate blocks against DEFAULT_BLOCKS
function getReportConfigWrapped(cid) {
  const parsed = (typeof getReportConfig === 'function') ? getReportConfig(cid) : {};
  if (parsed && parsed.blocks) {
    const validIds = new Set(DEFAULT_BLOCKS.map(b => b.id));
    parsed.blocks = parsed.blocks.filter(b => validIds.has(b.id));
    parsed.blocks.forEach(b => { const db = DEFAULT_BLOCKS.find(d => d.id === b.id); if (db) b.label = db.label; });
    DEFAULT_BLOCKS.forEach(db => {
      if (!parsed.blocks.find(b => b.id === db.id)) {
        parsed.blocks.push({ ...db });
      }
    });
    return parsed;
  }
  // Default to standard preset
  const blocks = DEFAULT_BLOCKS.map(b => ({ ...b }));
  const std = REPORT_PRESETS.standard;
  blocks.forEach(b => { b.enabled = std.includes(b.id); });
  const ordered = [];
  std.forEach(id => { const b = blocks.find(x => x.id === id); if (b) ordered.push(b); });
  blocks.forEach(b => { if (!std.includes(b.id)) ordered.push(b); });
  return { preset:'standard', blocks: ordered };
}

var reportConfig = null;

/* ── Pronoun helpers ─────────────────────────────────────────── */
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
  sections.forEach(sec => {
    const sp = getSectionProficiency(cid, student.id, sec.id);
    const sr = Math.round(sp);
    const slabel = sp > 0 ? PROF_LABELS[sr] : 'No Evidence';
    const scolor = PROF_COLORS[sr] || PROF_COLORS[0];
    const override = getSectionOverride(cid, student.id, sec.id);
    html += `<div class="report-section-chip">
      <div class="report-section-chip-name">${esc(sec.shortName || sec.name)}${override ? ' <span style="font-size:0.5rem;color:var(--active);font-style:italic;font-weight:400">override</span>' : ''}</div>
      <div class="report-section-chip-value" data-prof="${sr}" style="color:${scolor}">${slabel}</div>
    </div>`;
  });
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

/* sanitizeNarrativeHtml — delegates to shared sanitizeHtml in gb-ui.js */
function sanitizeNarrativeHtml(raw) { return sanitizeHtml(raw); }

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
const OBS_DESCRIPTORS = {
  engagement:      { prompt:'I participate actively and stay focused on my learning', desc:'Active participation and focus in learning', example:'Stays on task, asks questions, contributes ideas' },
  collaboration:   { prompt:'I work well with others and support my group', desc:'Working effectively with others', example:'Shares ideas, listens to peers, supports group goals' },
  selfRegulation:  { prompt:'I manage my time, stay organized, and handle my emotions', desc:'Managing time, emotions, and work habits', example:'Plans ahead, handles setbacks, stays organized' },
  resilience:      { prompt:'I keep trying when things are difficult', desc:'Persevering through challenges', example:'Tries again after mistakes, seeks help, doesn\'t give up' },
  curiosity:       { prompt:'I explore new ideas and take risks in my thinking', desc:'Exploring ideas and taking intellectual risks', example:'Asks "what if?", tries new approaches, goes deeper' },
  respect:         { prompt:'I show care for my classmates and our community', desc:'Showing care for others and the community', example:'Kind words, active listening, inclusive behavior' }
};

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
    <div contenteditable="true" style="font-size:0.68rem;color:${latePolicy ? 'var(--text-2)' : 'var(--text-3)'};line-height:1.45;font-style:${latePolicy ? 'normal' : 'italic'};outline:none;min-height:1.4em"
      onblur="(function(el){const v=el.textContent.trim();const c=getCourseConfig('${cid}');c.lateWorkPolicy=v;saveCourseConfig('${cid}',c);el.style.color=v?'var(--text-2)':'var(--text-3)';el.style.fontStyle=v?'normal':'italic';if(!v)el.textContent='No late work policy set'})(this)"
      onfocus="(function(el){if(!getCourseConfig('${cid}').lateWorkPolicy){el.textContent='';el.style.color='var(--text-2)';el.style.fontStyle='normal'}})(this)"
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

/* ── Render a single student progress report ─────────────────── */
function renderStudentReport(cid, student) {
  let html = `<div class="report-student">`;
  reportConfig.blocks.forEach(b => {
    if (b.enabled) html += renderReportBlock(b.id, cid, student);
  });
  html += `</div>`;
  return html;
}

/* ── Class Summary ───────────────────────────────────────────── */
var classSummaryAnon = false;
var tqIncludeAssignFeedback = true;
var tqObsFilter = 'all'; // 'all'|'general'|'assignment'

function renderClassSummary(cid) {
  const course = COURSES[cid];
  const sections = getSections(cid);
  let students = sortStudents(getStudents(cid), 'lastName');
  if (classSummaryAnon) students = anonymizeStudents(students);
  const isLetter = course.gradingSystem === 'letter';

  let html = `<h2 style="font-family:var(--font-base);font-size:1.3rem;margin-bottom:12px">${esc(course.name)} &mdash; Class Summary</h2>`;
  html += `<table class="class-summary-table">
    <thead><tr>
      <th scope="col">Student</th>`;

  sections.forEach(sec => {
    html += `<th scope="col">${esc(sec.shortName || sec.name)}</th>`;
  });

  html += `<th scope="col">Overall</th>`;
  if (isLetter) html += `<th scope="col">Letter Grade</th>`;
  html += `</tr></thead><tbody>`;

  students.forEach(st => {
    const nameDisplay = classSummaryAnon ? esc(st._anonLabel) : `<a href="#" data-action="summaryStudentClick" data-sid="${st.id}" style="color:inherit;text-decoration:none">${esc(fullName(st))}</a>`;
    html += `<tr><td class="class-summary-name">${nameDisplay}</td>`;
    sections.forEach(sec => {
      const sp = getSectionProficiency(cid, st.id, sec.id);
      const sr = Math.round(sp);
      const slabel = sp > 0 ? PROF_LABELS[sr] : '—';
      const scolor = sp > 0 ? PROF_COLORS[sr] : 'var(--text-3)';
      html += `<td data-prof="${sr}" style="color:${scolor};font-weight:600">${slabel}</td>`;
    });
    const op = getOverallProficiency(cid, st.id);
    const or2 = Math.round(op);
    const olabel = op > 0 ? PROF_LABELS[or2] : '—';
    const ocolor = op > 0 ? PROF_COLORS[or2] : 'var(--text-3)';
    html += `<td data-prof="${or2}" style="color:${ocolor};font-weight:700">${olabel}</td>`;
    if (isLetter) {
      const lg = op > 0 ? calcLetterGrade(op) : null;
      html += `<td style="font-weight:700">${lg ? lg.letter + ' (' + lg.pct + '%)' : '—'}</td>`;
    }
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  return html;
}

/* ── Tab switching ───────────────────────────────────────────── */
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.report-seg-btn').forEach(t => {
    const isActive = (tab === 'progress' && t.textContent.includes('Progress')) ||
        (tab === 'questionnaire' && t.textContent.includes('Questionnaire')) ||
        (tab === 'summary' && t.textContent.includes('Summary'));
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', isActive);
  });
  // Show/hide contextual toolbar elements
  document.getElementById('student-picker').style.display = tab === 'progress' ? '' : 'none';
  document.getElementById('tq-student-nav').style.display = tab === 'questionnaire' ? 'flex' : 'none';
  // Show Print button only on progress reports and class summary
  const tbPrint = document.getElementById('tb-print-btn');
  if (tbPrint) tbPrint.style.display = tab === 'questionnaire' ? 'none' : '';
  // Show Anonymize button only on class summary
  const tbAnon = document.getElementById('tb-anon-btn');
  if (tbAnon) tbAnon.style.display = tab === 'summary' ? '' : 'none';
  renderReports();
}

/* ── Multi-select student picker ─────────────────────────────── */
var selectedStudentIds = null; // null = all students

function populateStudentSelect() {
  const students = sortStudents(getStudents(activeCourse), 'lastName');
  const dd = document.getElementById('picker-dropdown');
  let html = '';
  students.forEach(s => {
    const checked = selectedStudentIds === null || selectedStudentIds.includes(s.id);
    html += `<div class="student-picker-item${checked ? ' checked' : ''}" data-sid="${s.id}" data-action="toggleStudentSelection">
      <div class="student-picker-check">${checked ? '✓' : ''}</div>
      <span>${esc(fullName(s))}</span>
    </div>`;
  });
  html += `<div class="student-picker-actions">
    <button class="student-picker-action" data-action="selectAllStudents">Select All</button>
    <button class="student-picker-action" data-action="selectNoneStudents">Deselect All</button>
  </div>`;
  dd.innerHTML = html;
  updatePickerLabel();
}

function toggleStudentPicker(e) {
  if (e) e.stopPropagation();
  const dd = document.getElementById('picker-dropdown');
  dd.classList.toggle('open');
}


function toggleStudentSelection(sid) {
  const students = getStudents(activeCourse);
  const allIds = students.map(s => s.id);

  if (selectedStudentIds === null) {
    // Was "all" — deselect this one student
    selectedStudentIds = allIds.filter(id => id !== sid);
  } else if (selectedStudentIds.includes(sid)) {
    // Deselect this student
    selectedStudentIds = selectedStudentIds.filter(id => id !== sid);
  } else {
    // Select this student
    selectedStudentIds.push(sid);
  }

  // If all are now selected, go back to null (= all)
  if (selectedStudentIds && selectedStudentIds.length >= allIds.length) {
    selectedStudentIds = null;
  }

  // Update checkmarks without closing dropdown
  const dd = document.getElementById('picker-dropdown');
  dd.querySelectorAll('.student-picker-item').forEach(item => {
    const itemSid = item.dataset.sid;
    const isChecked = selectedStudentIds === null || selectedStudentIds.includes(itemSid);
    item.classList.toggle('checked', isChecked);
    item.querySelector('.student-picker-check').textContent = isChecked ? '✓' : '';
  });

  updatePickerLabel();
  renderReports();
}

function selectAllStudents() {
  selectedStudentIds = null;
  const dd = document.getElementById('picker-dropdown');
  dd.querySelectorAll('.student-picker-item').forEach(item => {
    item.classList.add('checked');
    item.querySelector('.student-picker-check').textContent = '✓';
  });
  updatePickerLabel();
  renderReports();
}

function selectNoneStudents() {
  selectedStudentIds = [];
  const dd = document.getElementById('picker-dropdown');
  dd.querySelectorAll('.student-picker-item').forEach(item => {
    item.classList.remove('checked');
    item.querySelector('.student-picker-check').textContent = '';
  });
  updatePickerLabel();
  renderReports();
}

function updatePickerLabel() {
  const students = getStudents(activeCourse);
  const total = students.length;
  const label = document.getElementById('picker-label');
  if (selectedStudentIds === null) {
    label.textContent = `All Students (${total})`;
  } else if (selectedStudentIds.length === 0) {
    label.textContent = 'No Students Selected';
  } else if (selectedStudentIds.length === 1) {
    const st = students.find(s => s.id === selectedStudentIds[0]);
    label.textContent = st ? fullName(st) : '1 Student';
  } else {
    label.textContent = `${selectedStudentIds.length} of ${total} Students`;
  }
}

/* ── Main render ─────────────────────────────────────────────── */
function renderReports() {
  const cid = activeCourse;
  const output = document.getElementById('report-output');

  if (activeTab === 'summary') {
    output.innerHTML = renderClassSummary(cid);
    return;
  }

  if (activeTab === 'questionnaire') {
    output.innerHTML = renderTermQuestionnaire(cid);
    // Highlight active student in sidebar
    const students = getTqStudents();
    const activeSid = students[tqStudentIndex]?.id;
    document.querySelectorAll('#gb-sidebar .student-row').forEach(row => {
      const href = row.getAttribute('href') || '';
      const match = href.match(/id=([^&]+)/);
      row.classList.toggle('selected', match && match[1] === activeSid);
    });
    return;
  }

  // Progress reports — render two-panel builder layout
  const presetBtns = ['brief','standard','detailed'].map(p =>
    `<button class="rb-preset-btn${reportConfig.preset === p ? ' active' : ''}" data-preset="${p}" data-action="rbApplyPreset">${p.charAt(0).toUpperCase()+p.slice(1)}</button>`
  ).join('');

  output.innerHTML = `<div class="rb-layout">
    <aside class="rb-panel no-print" id="rb-panel">
      <div class="rb-panel-header"><div class="rb-panel-title">Report Builder</div></div>
      <div class="rb-presets">${presetBtns}</div>
      <div class="rb-blocks" id="rb-blocks"></div>
    </aside>
    <div class="rb-preview" id="rb-preview"></div>
  </div>`;

  renderBuilderBlocks();
  renderReportPreview();

  // Highlight selected students in sidebar for progress tab
  if (selectedStudentIds && selectedStudentIds.length > 0) {
    document.querySelectorAll('#gb-sidebar .student-row').forEach(row => {
      const href = row.getAttribute('href') || '';
      const match = href.match(/id=([^&]+)/);
      row.classList.toggle('selected', match && selectedStudentIds.includes(match[1]));
    });
  } else {
    document.querySelectorAll('#gb-sidebar .student-row').forEach(row => row.classList.remove('selected'));
  }
}

/* ══════════════════════════════════════════════════════════════
   REPORT BUILDER — Interaction functions
   ══════════════════════════════════════════════════════════════ */
function renderReportPreview() {
  const preview = document.getElementById('rb-preview');
  if (!preview) return;
  const cid = activeCourse;
  const allStudents = sortStudents(getStudents(cid), 'lastName');
  const students = selectedStudentIds === null ? allStudents : allStudents.filter(s => selectedStudentIds.includes(s.id));
  const allScoresObj = getScores(cid);
  const hasAnyScores = Object.values(allScoresObj).some(arr => Array.isArray(arr) && arr.some(s => s.score > 0));
  if (!hasAnyScores) {
    preview.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📄</div><div class="empty-state-title">No report data yet</div><div class="empty-state-text">Score some assignments to generate progress reports.</div></div>`;
  } else if (students.length === 0) {
    preview.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:40px 0;font-size:0.95rem">Select students above to generate reports.</div>';
  } else {
    preview.innerHTML = students.map(st => renderStudentReport(cid, st)).join('');
  }
}

function renderBuilderBlocks() {
  const container = document.getElementById('rb-blocks');
  if (!container) return;
  let html = '';
  reportConfig.blocks.forEach((block, idx) => {
    const enabledClass = block.enabled ? ' enabled' : '';
    const lockedClass = block.locked ? ' locked' : '';
    html += `<div class="rb-block${enabledClass}${lockedClass}" data-idx="${idx}">
      <span class="rb-drag-grip"${block.locked ? '' : ' data-drag="grip"'}>${block.locked ? '🔒' : '⠿'}</span>
      ${block.locked
        ? `<span class="rb-block-label">${esc(block.label)}</span>`
        : `<label class="rb-block-toggle" data-action="rbToggleBlock" data-blockid="${block.id}"><div class="rb-block-switch"></div></label>
           <span class="rb-block-label">${esc(block.label)}</span>`
      }
    </div>`;
  });
  container.innerHTML = html;
  _initPointerDrag(container);
}

function rbToggleBlock(blockId) {
  const block = reportConfig.blocks.find(b => b.id === blockId);
  if (!block || block.locked) return;
  block.enabled = !block.enabled;
  reportConfig.preset = 'custom';
  saveReportConfig(activeCourse, reportConfig);
  renderBuilderBlocks();
  renderReportPreview();
  rbUpdatePresetBtns();
}

function rbApplyPreset(preset) {
  const order = REPORT_PRESETS[preset];
  if (!order) return;
  const ordered = [];
  const remaining = [];
  order.forEach(id => {
    const b = reportConfig.blocks.find(x => x.id === id);
    if (b) { b.enabled = true; ordered.push(b); }
  });
  reportConfig.blocks.forEach(b => {
    if (!order.includes(b.id)) { b.enabled = false; remaining.push(b); }
  });
  reportConfig.blocks = [...ordered, ...remaining];
  reportConfig.preset = preset;
  saveReportConfig(activeCourse, reportConfig);
  renderBuilderBlocks();
  renderReportPreview();
  rbUpdatePresetBtns();
}

function rbUpdatePresetBtns() {
  document.querySelectorAll('.rb-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === reportConfig.preset);
  });
}

/* ── Pointer-based drag-and-drop reorder ── */
var _rbDragIdx = null;
var _dragAbort = null;

function _initPointerDrag(container) {
  if (!container) return;
  // Remove previous listeners to prevent accumulation
  if (_dragAbort) _dragAbort.abort();
  _dragAbort = new AbortController();
  var signal = _dragAbort.signal;
  var dragEl = null;
  var placeholder = null;
  var offsetY = 0;
  var startIdx = -1;
  var blockHeight = 0;

  container.addEventListener('pointerdown', function(e) {
    var grip = e.target.closest('[data-drag="grip"]');
    if (!grip) return;
    var block = grip.closest('.rb-block');
    if (!block) return;
    startIdx = parseInt(block.dataset.idx, 10);
    if (isNaN(startIdx)) return;
    // Prevent text selection and default drag
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    var rect = block.getBoundingClientRect();
    offsetY = e.clientY - rect.top;
    dragEl = block;
    blockHeight = block.offsetHeight + 1; // +1 for margin
    // Create placeholder
    placeholder = document.createElement('div');
    placeholder.className = 'rb-block-placeholder';
    placeholder.style.height = blockHeight + 'px';
    // Style the dragged element
    block.classList.add('dragging');
    block.style.position = 'fixed';
    block.style.top = rect.top + 'px';
    block.style.left = rect.left + 'px';
    block.style.width = rect.width + 'px';
    block.style.zIndex = '1000';
    block.style.pointerEvents = 'none';
    block.parentNode.insertBefore(placeholder, block);
  }, { signal });

  container.addEventListener('pointermove', function(e) {
    if (!dragEl) return;
    e.preventDefault();
    dragEl.style.top = (e.clientY - offsetY) + 'px';
    // Determine target position
    var blocks = Array.from(container.querySelectorAll('.rb-block:not(.dragging)'));
    for (var i = 0; i < blocks.length; i++) {
      var br = blocks[i].getBoundingClientRect();
      var mid = br.top + br.height / 2;
      if (e.clientY < mid) {
        // Don't insert before locked header
        if (blocks[i].classList.contains('locked')) continue;
        container.insertBefore(placeholder, blocks[i]);
        return;
      }
    }
    // Past all blocks — append at end
    container.appendChild(placeholder);
  }, { signal });

  function finishDrag(e) {
    if (!dragEl) return;
    // Find where placeholder ended up (exclude dragging element and placeholder itself)
    var allItems = Array.from(container.children).filter(function(c) { return c !== dragEl; });
    var targetIdx = allItems.indexOf(placeholder);
    // Clean up
    dragEl.classList.remove('dragging');
    dragEl.style.position = '';
    dragEl.style.top = '';
    dragEl.style.left = '';
    dragEl.style.width = '';
    dragEl.style.zIndex = '';
    dragEl.style.pointerEvents = '';
    if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
    dragEl = null;
    placeholder = null;
    // Apply the reorder if position changed
    if (targetIdx >= 0 && targetIdx !== startIdx) {
      var moved = reportConfig.blocks.splice(startIdx, 1)[0];
      var insertAt = startIdx < targetIdx ? targetIdx - 1 : targetIdx;
      var finalIdx = Math.max(1, insertAt); // Don't insert before locked header
      reportConfig.blocks.splice(finalIdx, 0, moved);
      reportConfig.preset = 'custom';
      saveReportConfig(activeCourse, reportConfig);
      renderBuilderBlocks();
      renderReportPreview();
      rbUpdatePresetBtns();
    } else {
      // Reset position without re-render
      renderBuilderBlocks();
    }
    startIdx = -1;
  }

  container.addEventListener('pointerup', finishDrag, { signal });
  container.addEventListener('pointercancel', finishDrag, { signal });
}

// Legacy stubs (no longer used but kept for safety in case inline attrs remain)
function rbDragStart() {}
function rbDragEnd() {}
function rbDragOver() {}
function rbDragLeave() {}
function rbDrop() {}

/* ── Course switching ────────────────────────────────────────── */
async function switchCourse(cid) {
  activeCourse = cid;
  setActiveCourse(cid);
  await initData(cid);
  selectedStudentIds = null; // reset to all
  reportConfig = getReportConfigWrapped(cid);
  populateStudentSelect();
  renderReports();
  document.getElementById('sidebar-mount').innerHTML = renderSidebar(cid, null);
}

/* ══════════════════════════════════════════════════════════════
   TERM QUESTIONNAIRE
   ══════════════════════════════════════════════════════════════ */
var tqStudentIndex = 0;

function getTermId() {
  const period = (document.getElementById('report-period')?.value || 'Report 1').trim();
  // Map "Report N" → "term-N" for backwards compatibility with stored data
  const m = period.match(/Report\s+(\d+)/i);
  if (m) return 'term-' + m[1];
  return period.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
}

function getTqStudents() {
  return sortStudents(getStudents(activeCourse), 'lastName');
}

function tqPrevStudent() { tqSaveCurrentIfNeeded(); tqStudentIndex = Math.max(0, tqStudentIndex - 1); renderReports(); }
function tqNextStudent() {
  tqSaveCurrentIfNeeded();
  const students = getTqStudents();
  if (tqStudentIndex >= students.length - 1) {
    switchTab('progress');
    return;
  }
  tqStudentIndex = Math.min(students.length - 1, tqStudentIndex + 1);
  renderReports();
}

function tqSaveCurrentIfNeeded() {
  const students = getTqStudents();
  if (!students[tqStudentIndex]) return;
  const sid = students[tqStudentIndex].id;
  const termId = getTermId();
  const existing = getStudentTermRating(activeCourse, sid, termId);
  const el = document.getElementById('tq-narrative');
  if (el && existing) {
    upsertTermRating(activeCourse, sid, termId, { narrative: el.innerHTML.trim() });
  }
}

function tqSaveNarrative() {
  const el = document.getElementById('tq-narrative');
  if (!el) return;
  const students = getTqStudents();
  const sid = students[tqStudentIndex]?.id;
  if (!sid) return;
  const termId = getTermId();
  upsertTermRating(activeCourse, sid, termId, { narrative: el.innerHTML.trim() });
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
    setTimeout(() => { btn.classList.remove('copied'); btn.title = 'Copy to Clipboard'; }, 1800);
  });
}

// Update active states on selection change & keyup

function tqSetDim(sid, dim, val) {
  tqSaveNarrative();
  const termId = getTermId();
  const existing = getStudentTermRating(activeCourse, sid, termId);
  const currentDims = existing ? { ...existing.dims } : { engagement:0, collaboration:0, selfRegulation:0, resilience:0, curiosity:0, respect:0 };
  currentDims[dim] = currentDims[dim] === val ? 0 : val; // Toggle off if same
  upsertTermRating(activeCourse, sid, termId, { dims: currentDims });
  renderReports();
}

function tqSetField(sid, field, val) {
  tqSaveNarrative();
  const termId = getTermId();
  const existing = getStudentTermRating(activeCourse, sid, termId) || {};
  const newVal = existing[field] === val ? 0 : val; // Toggle off if same
  upsertTermRating(activeCourse, sid, termId, { [field]: newVal });
  renderReports();
}

function tqToggleTrait(sid, traitId) {
  tqSaveNarrative();
  const termId = getTermId();
  const existing = getStudentTermRating(activeCourse, sid, termId) || {};
  const traits = [...(existing.socialTraits || [])];
  const idx = traits.indexOf(traitId);
  if (idx >= 0) traits.splice(idx, 1); else traits.push(traitId);
  upsertTermRating(activeCourse, sid, termId, { socialTraits: traits });
  renderReports();
}

function tqToggleAssignment(sid, aId) {
  tqSaveNarrative();
  const termId = getTermId();
  const existing = getStudentTermRating(activeCourse, sid, termId) || {};
  const list = [...(existing.mentionAssessments || [])];
  const idx = list.indexOf(aId);
  if (idx >= 0) list.splice(idx, 1); else list.push(aId);
  upsertTermRating(activeCourse, sid, termId, { mentionAssessments: list });
  renderReports();
}

function tqToggleOb(sid, obId) {
  tqSaveNarrative();
  const termId = getTermId();
  const existing = getStudentTermRating(activeCourse, sid, termId) || {};
  const list = [...(existing.mentionObs || [])];
  const idx = list.indexOf(obId);
  if (idx >= 0) list.splice(idx, 1); else list.push(obId);
  upsertTermRating(activeCourse, sid, termId, { mentionObs: list });
  renderReports();
}

function tqToggleTag(sid, field, tagId) {
  tqSaveNarrative();
  const termId = getTermId();
  const existing = getStudentTermRating(activeCourse, sid, termId) || {};
  const tags = [...(existing[field] || [])];
  const idx = tags.indexOf(tagId);
  if (idx >= 0) tags.splice(idx, 1); else tags.push(tagId);
  upsertTermRating(activeCourse, sid, termId, { [field]: tags });
  renderReports();
}

function tqAutoNarrative(sid) {
  const cid = activeCourse;
  const student = getStudents(cid).find(s => s.id === sid);
  if (!student) return;
  const termId = getTermId();
  const rating = getStudentTermRating(cid, sid, termId) || {};
  const dims = rating.dims || {};
  const name = displayNameFirst(student);
  const pr = getPronouns(student);
  const course = COURSES[cid];
  const courseName = course?.name || 'this course';
  const S = pr.capSubj, s = pr.subj, P = pr.poss.charAt(0).toUpperCase() + pr.poss.slice(1), p = pr.poss, o = pr.obj, v = pr.verb;
  const ve = v === 's' ? "'s" : "'ve"; // contraction: "she's" or "they've"
  const is_ = v === 's' ? 'is' : 'are';  // pronoun subject: "she is" / "they are"
  const nis = 'is';                       // name subject: "Sam is" (always singular)
  const has = v === 's' ? 'has' : 'have';
  const nhas = 'has';                     // name subject: "Sam has" (always singular)
  const does = v === 's' ? 'does' : 'do';

  // ── Helpers ──
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const oxList = (arr, conj = 'and') => {
    if (!arr || arr.length === 0) return '';
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return `${arr[0]} ${conj} ${arr[1]}`;
    return arr.slice(0, -1).join(', ') + `, ${conj} ${arr[arr.length - 1]}`;
  };
  // Avoid starting too many sentences with the same word
  let lastSubject = '';
  const vary = (preferred, fallbacks) => {
    if (preferred.startsWith(name) && lastSubject === 'name') return pick(fallbacks);
    if (preferred.startsWith(S) && lastSubject === 'pronoun') return pick(fallbacks);
    lastSubject = preferred.startsWith(name) ? 'name' : preferred.startsWith(S) ? 'pronoun' : '';
    return preferred;
  };

  // ── Gather ALL data ──
  const overall = getOverallProficiency(cid, sid);
  const overallR = Math.round(overall);
  const overallLabel = (PROF_LABELS[overallR] || '').toLowerCase();
  const sections = getSections(cid);
  const allTags = getAllTags(cid);
  const allObs = getStudentQuickObs(cid, sid);
  const assessments = getAssessments(cid);
  const studentScores = getScores(cid)[sid] || [];
  const completion = getCompletionPct(cid, sid);
  const goals = getGoals(cid);
  const reflections = getReflections(cid);
  const studentGoals = goals[sid] || {};
  const studentReflections = reflections[sid] || {};

  // Dimension analysis
  const dimThrive = OBS_DIMS.filter(d => (dims[d]||0) >= 4).map(d => OBS_LABELS[d].toLowerCase());
  const dimSolid = OBS_DIMS.filter(d => (dims[d]||0) === 3).map(d => OBS_LABELS[d].toLowerCase());
  const dimDev = OBS_DIMS.filter(d => (dims[d]||0) === 2).map(d => OBS_LABELS[d].toLowerCase());
  const dimNeeds = OBS_DIMS.filter(d => (dims[d]||0) === 1).map(d => OBS_LABELS[d].toLowerCase());
  const allDimStrengths = [...dimThrive, ...dimSolid];

  // Traits
  const traits = rating.socialTraits || [];
  const posTraits = traits.filter(t => ['leader','collaborative','independent','peer-mentor','risk-taker','reflective','creative','persistent','organized','empathetic','curious','respectful','positive-attitude','detail-oriented','advocate'].includes(t));
  const negTraits = traits.filter(t => ['needs-support','often-late','device-issue','reminders-focus','often-absent','incomplete-work','disorganized','off-task','social-conflicts','low-confidence','avoids-challenges','rushed-work'].includes(t));

  // Tags
  const savedStrengths = (rating.strengths || []).map(id => allTags.find(t => t.id === id)?.label).filter(Boolean);
  const savedGrowth = (rating.growthAreas || []).map(id => allTags.find(t => t.id === id)?.label).filter(Boolean);

  // Section proficiencies
  const sectionData = sections.map(sec => ({ name: sec.shortName || sec.name, prof: getSectionProficiency(cid, sid, sec.id) })).filter(sec => sec.prof > 0);
  sectionData.sort((a,b) => b.prof - a.prof);
  const topSecs = sectionData.filter(sec => sec.prof >= 3);
  const lowSecs = sectionData.filter(sec => sec.prof > 0 && sec.prof < 2.5);

  // Observation analysis
  const obsCount = allObs.length;
  const strengthObs = allObs.filter(ob => ob.sentiment === 'strength');
  const concernObs = allObs.filter(ob => ob.sentiment === 'concern');
  const contextCounts = {};
  allObs.forEach(ob => { if (ob.context) contextCounts[ob.context] = (contextCounts[ob.context]||0) + 1; });
  const topContextEntry = Object.entries(contextCounts).sort((a,b) => b[1]-a[1])[0];
  const topContext = topContextEntry ? topContextEntry[0] : null;

  // Self-reflection analysis
  const refEntries = Object.entries(studentReflections).filter(([,r]) => r && r.confidence > 0);
  const highConfidence = refEntries.filter(([,r]) => r.confidence >= 3);
  const lowConfidence = refEntries.filter(([,r]) => r.confidence <= 1);
  const selfAware = refEntries.length > 0; // student has done self-assessment

  // Mentioned assignments
  const mentionIds = rating.mentionAssessments || [];
  const mentionedAssignments = mentionIds.map(aId => {
    const a = assessments.find(x => x.id === aId);
    if (!a) return null;
    const aScores = studentScores.filter(sc => sc.assessmentId === aId && sc.score > 0);
    const avg = aScores.length > 0 ? aScores.reduce((sum,sc) => sum + sc.score, 0) / aScores.length : 0;
    const r = Math.round(avg);
    return { title: a.title, avg, r, level: (PROF_LABELS[r]||'').toLowerCase(), type: a.type || 'summative' };
  }).filter(Boolean);
  const strongAssign = mentionedAssignments.filter(m => m.r >= 3);
  const weakAssign = mentionedAssignments.filter(m => m.r < 3);

  // Mentioned observations
  const mentionObIds = rating.mentionObs || [];
  const mentionedObs = allObs.filter(ob => mentionObIds.includes(ob.id));

  // ── Determine student profile archetype ──
  // This shapes the entire narrative arc
  const wh = rating.workHabits || 0;
  const pa = rating.participation || 0;
  let archetype = 'steady'; // default
  if (overall >= 3.5 && allDimStrengths.length >= 3 && wh >= 3) archetype = 'star';
  else if (overall >= 3 && allDimStrengths.length >= 2) archetype = 'strong';
  else if (overall >= 2.5 || (allDimStrengths.length >= 2 && wh >= 3)) archetype = 'steady';
  else if (overall > 0 && overall < 2.5) archetype = 'building';
  else if (overall === 0) archetype = 'early';
  // Override: if concerns dominate
  if (negTraits.length >= 2 || dimNeeds.length >= 3) archetype = 'building';

  // ── PARAGRAPH BUILDERS ──
  // Each function returns a paragraph string. The narrative is composed of 3-4 paragraphs.
  const paras = [];

  // ═══ PARAGRAPH 1: OPENING + LEARNER CHARACTER ═══
  {
    let p1 = '';

    // Opening line — sets tone from archetype
    const openings = {
      star: [
        `${name} has had an outstanding term in ${courseName}. ${S}${ve} brought energy, focus, and genuine curiosity to everything we've done`,
        `It\u2019s been a pleasure watching ${name} this term — ${s} ${has} consistently gone above and beyond in ${courseName}`,
        `${name} is one of those students who makes teaching rewarding. This term in ${courseName}, ${s} ${has} truly excelled`,
        `I can't say enough good things about ${name}'s term in ${courseName}. ${S} ${has} been exceptional in every sense`,
        `${name} has set the bar high in ${courseName} this term — ${p} dedication and talent have been on full display`,
        `What a term for ${name} in ${courseName}. ${S} ${has} risen to every challenge and then some`,
      ],
      strong: [
        `${name} has had a strong term in ${courseName}`,
        `I've been really pleased with ${name}'s work in ${courseName} this term`,
        `${name} has shown a lot of growth and effort in ${courseName} this term`,
        `${name} has had a really good term in ${courseName}, and the effort shows`,
        `There's a lot to celebrate about ${name}'s work in ${courseName} this term`,
        `${name} has made me proud this term in ${courseName} — ${s} ${has} put in consistently strong effort`,
      ],
      steady: [
        `${name} has had a solid term in ${courseName}`,
        `${name} has been steady and consistent in ${courseName} this term`,
        `This has been a good term for ${name} in ${courseName}`,
        `${name} has put together a dependable term in ${courseName}, with some nice highlights along the way`,
        `${name} has been making progress in ${courseName} and I see the foundations getting stronger`,
        `This term in ${courseName}, ${name} has shown the kind of steady growth that builds lasting skills`,
      ],
      building: [
        `${name} has been working through some challenges in ${courseName} this term, but I can see real effort`,
        `This term in ${courseName} has had its ups and downs for ${name}, but there are things to build on`,
        `${name} is still finding ${p} footing in ${courseName}, and I want to highlight both the progress and the areas where ${s} need${v} support`,
        `${name} has faced some real challenges in ${courseName} this term, and I want to be honest about what I see while also recognizing ${p} efforts`,
        `There have been some bumps along the way in ${courseName} for ${name}, but I see potential that's worth investing in`,
      ],
      early: [
        `${name} is getting started in ${courseName} and we're still building a picture of ${p} strengths`,
        `We're early in the process with ${name} in ${courseName}`,
        `${name} is still settling into ${courseName}, and I'm looking forward to getting to know ${p} strengths better`,
        `We're in the early stages with ${name} in ${courseName}, but I'm already starting to see some of who ${s} ${is_} as a learner`,
      ]
    };
    p1 += pick(openings[archetype]) + '. ';

    // Weave in dispositions + traits as CHARACTER, not a list
    if (allDimStrengths.length > 0 && posTraits.length > 0) {
      // Merge character traits and dispositions into one portrait
      const traitNatural = {
        leader: 'a real leader', collaborative: 'genuinely collaborative',
        independent: 'wonderfully self-directed', 'peer-mentor': 'always willing to help others',
        'risk-taker': 'not afraid to take chances', reflective: 'thoughtful about ' + p + ' own learning',
        creative: 'a creative thinker', persistent: 'someone who doesn\'t give up easily',
        organized: 'well-organized', empathetic: 'genuinely empathetic toward others',
        curious: 'naturally curious', respectful: 'consistently respectful',
        'positive-attitude': 'someone who brings a positive energy to the room',
        'detail-oriented': 'impressively detail-oriented', advocate: 'a strong self-advocate'
      };
      const charBits = posTraits.map(t => traitNatural[t]).filter(Boolean);
      const mainTraits = charBits.slice(0, 3);
      const extraTraits = charBits.slice(3);
      if (allDimStrengths.length <= 2) {
        p1 += pick([
          `${S} ${is_} ${oxList(mainTraits)}, and that really comes through in ${p} ${oxList(allDimStrengths)}. `,
          `In the classroom, ${s} ${is_} ${oxList(mainTraits)}. This shows up clearly in ${p} ${oxList(allDimStrengths)}. `,
          `What I notice most about ${name} is that ${s} ${is_} ${oxList(mainTraits)} — qualities that shine through in ${p} ${oxList(allDimStrengths)}. `,
        ]);
      } else {
        p1 += pick([
          `In the classroom, ${name} ${nis} ${oxList(mainTraits)}. ${P} ${oxList(allDimStrengths.slice(0, 3))} ${allDimStrengths.length === 1 ? `${is_} a` : 'are'} particular standout${allDimStrengths.length === 1 ? '' : 's'}. `,
          `${name} ${nis} ${oxList(mainTraits)}, and that translates into real strength across ${p} ${oxList(allDimStrengths.slice(0, 3))}. `,
          `As a person, ${name} ${nis} ${oxList(mainTraits)}. As a learner, that means ${p} ${oxList(allDimStrengths.slice(0, 3))} ${allDimStrengths.length === 1 ? `${is_}` : 'are'} really strong. `,
        ]);
      }
      if (extraTraits.length > 0) {
        p1 += pick([
          `${S} ${is_} also ${oxList(extraTraits)}. `,
          `On top of that, ${s} ${is_} ${oxList(extraTraits)}. `,
          `I'd also add that ${s} ${is_} ${oxList(extraTraits)}. `,
          `It's also worth noting that ${s} ${is_} ${oxList(extraTraits)} — all qualities that make ${o} a valued member of our class. `,
        ]);
      }
    } else if (allDimStrengths.length > 0) {
      if (allDimStrengths.length === 1) {
        p1 += pick([
          `${P} ${allDimStrengths[0]} has been a real strength this term. `,
          `I've been especially impressed by ${p} ${allDimStrengths[0]}. `,
          `One thing that stands out about ${name} is ${p} ${allDimStrengths[0]} — it's been a consistent strength. `,
          `In terms of who ${s} ${is_} as a learner, ${p} ${allDimStrengths[0]} is something I really want to highlight. `,
        ]);
      } else {
        p1 += pick([
          `${S} show${v} real strength in ${oxList(allDimStrengths)} as a learner. `,
          `As a learner, ${p} ${oxList(allDimStrengths)} really stand${allDimStrengths.length === 1 ? 's' : ''} out. `,
          `${P} strongest learning dispositions are in ${oxList(allDimStrengths)}, and those qualities serve ${o} well every day in class. `,
          `I consistently see strong ${oxList(allDimStrengths)} from ${name} — these are the qualities that anchor ${p} learning. `,
        ]);
      }
    } else if (posTraits.length > 0) {
      const traitNatural2 = {
        leader: 'leadership', collaborative: 'ability to collaborate', independent: 'independence',
        'peer-mentor': 'willingness to support classmates', 'risk-taker': 'willingness to take risks',
        reflective: 'reflective nature', creative: 'creative thinking', persistent: 'persistence',
        organized: 'strong organization', empathetic: 'empathy toward classmates',
        curious: 'natural curiosity', respectful: 'respectfulness',
        'positive-attitude': 'positive attitude', 'detail-oriented': 'attention to detail',
        advocate: 'ability to advocate for ' + p + 'self'
      };
      const traitWords = posTraits.map(t => traitNatural2[t]).filter(Boolean);
      p1 += pick([
        `I really value ${p} ${oxList(traitWords)} in our class. `,
        `In our classroom community, ${name} brings ${oxList(traitWords)} — and that makes a real difference. `,
        `${P} ${oxList(traitWords)} ${traitWords.length === 1 ? 'is' : 'are'} qualities I've come to rely on in our class. `,
      ]);
    } else if (archetype !== 'early') {
      // No specific traits or dims — add a general learner observation
      p1 += pick([
        `${S} ${is_} continuing to develop as a learner, and I appreciate ${p} willingness to show up and try. `,
        `While we're still building a complete picture of ${p} learning profile, I can see that ${s} ${is_} someone who cares about doing well. `,
      ]);
    }

    // Developing dimensions — mention briefly, woven in naturally
    if (dimDev.length > 0 && dimDev.length <= 2) {
      p1 += pick([
        `${S}${ve} also been growing in ${oxList(dimDev)}, which is encouraging to see. `,
        `I've also noticed positive growth in ${p} ${oxList(dimDev)} this term. `,
        `It's worth mentioning that ${p} ${oxList(dimDev)} ${dimDev.length === 1 ? 'has' : 'have'} been developing nicely too. `,
      ]);
    } else if (dimDev.length > 2) {
      p1 += pick([
        `${S}${ve} been growing across several areas including ${oxList(dimDev.slice(0, 3))}, and I look forward to that continued development. `,
        `There are several areas where ${s} ${is_} still developing — ${oxList(dimDev.slice(0, 3))} — and each one is moving in the right direction. `,
      ]);
    }

    // Work habits + participation — combine into one flowing thought
    if (wh > 0 && pa > 0) {
      const whpa = {
        '4,4': [
          `${name} comes prepared every day and ${is_} always an active, thoughtful voice in our discussions. That combination of preparation and engagement makes a real difference in ${p} learning.`,
          `${P} work ethic is excellent, and ${s} bring${v} that same energy to class conversations — always engaged, always contributing. It's the kind of consistency that sets a great example.`,
          `On the day-to-day, ${name} ${nis} exactly where I want ${o} to be — consistently prepared, consistently engaged, and always willing to share ${p} thinking with the class.`,
        ],
        '4,3': [
          `${name} has a fantastic work ethic and participates meaningfully in class discussions. ${S} come${v} prepared and ready to learn every day.`,
          `${S} always come${v} prepared and ${is_} a reliable contributor to our conversations. ${P} consistent effort really shows in the quality of ${p} work.`,
          `${name}'s preparation is top-notch, and ${s} ${is_} a solid voice in class discussions — not always the loudest, but always thoughtful when ${s} contribute${v}.`,
        ],
        '4,2': [
          `${name}'s work ethic is impressive — ${s} always come${v} prepared — though I'd love to hear ${p} voice more during class discussions. When ${s} ${does} speak up, it's always worthwhile.`,
          `${S} put${v} in great effort on ${p} work, and the results show it. The next step would be bringing that same confidence into class conversations, because I know ${s} ${has} great ideas to share.`,
          `${name}'s assignments are consistently strong, which tells me ${s} really understand${v} the material. I'd like to see ${o} share that understanding more during our group discussions.`,
        ],
        '4,1': [
          `${name} does excellent work on ${p} own, but ${is_} quite reserved in class. I'd really like to hear ${p} ideas more often — when ${s} ${does} share, it's always insightful.`,
          `The quality of ${name}'s independent work is impressive, but ${s} rarely speak${v} up in group settings. I genuinely believe the class would benefit from hearing ${p} perspective more.`,
        ],
        '3,4': [
          `${name} is a reliable worker and one of our most active contributors in class — always willing to share ideas and ask questions. That enthusiasm really enriches our discussions.`,
          `${S} keep${v} up with ${p} work and ${is_} one of the first to jump into any class conversation. ${P} willingness to participate and take risks with ${p} thinking is wonderful to see.`,
        ],
        '3,3': [
          `${name} is consistent — ${s} come${v} to class prepared and ${is_} always willing to participate. It's the kind of reliable effort that builds a strong foundation.`,
          `${S}${ve} been dependable with ${p} work and a regular participant in class. That consistency is something I value, and it's paying off in ${p} learning.`,
          `Day to day, ${name} ${nis} solid — ${s} get${v} ${p} work done, ${s} engage${v} in discussions, and ${s} ${is_} a steady presence in our classroom.`,
        ],
        '3,2': [
          `${name} generally keeps up with ${p} work, though ${s} tend${v} to be quieter during class discussions. I know ${s} ${has} ideas worth sharing, and I'd love to hear them more.`,
          `${P} work habits are solid, and I can tell ${s} ${is_} keeping up with the material. The one area I'd push on is participation — ${s} tend${v} to sit back during discussions when ${s} could be contributing.`,
        ],
        '3,1': [
          `${name} keeps up with the work but rarely speaks up in class. I think ${s} ${has} valuable ideas to share, and I'd like to find ways to help ${o} feel more comfortable contributing.`,
          `${P} written work and assignments show real understanding, which makes it all the more important that ${s} find${v} ${p} voice in class. I know the ideas are there — they just need to come out.`,
        ],
        '2,4': [
          `${name} is one of our most enthusiastic participants, which I really appreciate. The area to work on is follow-through on assignments — ${p} participation shows ${s} get${v} it, so the work just needs to match.`,
          `${S} bring${v} great energy to discussions but need${v} to match that with more consistent work habits. The good news is that ${p} understanding of the material is clearly there.`,
          `In class, ${name} ${nis} fantastic — engaged, vocal, and willing to take risks with ${p} thinking. Outside of class, though, ${p} work completion has been inconsistent, and that's holding ${o} back.`,
        ],
        '2,3': [
          `${name}'s participation is solid, though ${p} work habits have been a bit up and down — some weeks are great, others need a push. When ${s} ${is_} on, ${s} ${is_} really on.`,
          `${S} participate${v} well in class and ${is_} clearly engaged with the material, but the assignments don't always reflect that. I'd like to see more consistency in ${p} work completion.`,
        ],
        '2,2': [
          `${name} has been somewhat inconsistent this term, both with ${p} work and ${p} participation. There are flashes of great effort, and I'd like to see more of that on a daily basis.`,
          `Consistency has been the challenge for ${name} this term. Some days ${s} ${is_} fully engaged and producing great work; other days, ${s} seem${v} to coast. I know ${s} ${is_} capable of more.`,
        ],
        '2,1': [
          `Both work habits and participation have been a challenge for ${name} this term. ${S} need${v} more consistent effort on assignments and more willingness to engage in class. I want to help ${o} find strategies that work.`,
          `I'm seeing ${name} disengage at times — both in class conversations and in completing assignments. It's something I want to address because I know there's more inside ${o} than what ${s}${ve} been showing.`,
        ],
        '1,4': [
          `${name} is very vocal in class, which I appreciate — ${p} contributions to our discussions are valuable. But ${p} work completion has been a real concern, and it's affecting ${p} ability to show what ${s} know${v}.`,
          `In discussions, ${name} ${nis} one of our strongest voices. Outside of discussions, though, assignments go missing or come in late. If ${s} can bring that same energy to ${p} independent work, it would make a huge difference.`,
        ],
        '1,3': [
          `${name} participates when ${s} ${is_} in class and clearly cares about the content, but keeping up with assignments has been a struggle. We need to find better systems to help ${o} stay on track.`,
          `${name} engages in class and can have really strong contributions, but the assignments aren't getting done consistently. That gap between ${p} classroom presence and ${p} work output is something we need to address.`,
        ],
        '1,2': [
          `I'm concerned about ${name}'s work completion and engagement — both have been below where they need to be. I know ${s} can do better, and I'd like to work together to find what ${s} need${v}.`,
          `This term has been a struggle for ${name} in terms of both getting work done and engaging in class. I don't say that to be discouraging — I say it because I believe ${s} ${is_} capable of so much more.`,
        ],
        '1,1': [
          `Work habits and participation have both been significant challenges for ${name} this term. We need to find strategies to help ${o} engage more — this isn't sustainable, and I want to be part of the solution.`,
          `I want to be honest that ${name} has struggled to engage with ${courseName} this term, both in class and with ${p} assignments. I care about ${p} success and want to work together on a plan to turn things around.`,
        ]
      };
      const key = `${wh},${pa}`;
      p1 += pick(whpa[key] || [`${name} has been working on developing ${p} work habits and participation this term.`]) + ' ';
    } else if (wh > 0) {
      const whOnly = {
        4: [`${P} work ethic has been excellent this term — ${s} consistently turn${v} in high-quality work on time.`, `${name} ${nis} one of the most reliable students when it comes to getting work done well and on time.`],
        3: [`${S}${ve} been reliable with ${p} work, generally turning things in on time and with care.`, `${name} ${nis} dependable with ${p} assignments — not always perfect, but consistently solid.`],
        2: [`${P} work habits have been inconsistent — I know ${s} can be more consistent, and I want to help ${o} get there.`, `Work completion has been hit or miss for ${name}. Some assignments are great; others don't get finished.`],
        1: [`Work completion has been a real challenge, and we need to work on building better habits together.`, `Turning in work has been a significant struggle for ${name} this term, and it's something we need to address head-on.`]
      };
      p1 += pick(whOnly[wh]) + ' ';
    } else if (pa > 0) {
      const paOnly = {
        4: [`${S} ${is_} one of our most active and thoughtful contributors in class — the kind of participant who makes discussions richer for everyone.`, `${name} consistently brings energy and insight to our class conversations. ${P} contributions make a real difference.`],
        3: [`${S}${ve} been a regular and welcome participant in our discussions, and I appreciate ${p} willingness to share.`, `${name} participates regularly and ${p} contributions show real engagement with the material.`],
        2: [`${S} participate${v} when prompted, but I'd like to see ${o} volunteering more — ${p} ideas are worth hearing.`, `${name} can be quiet in class and often needs encouragement to share ${p} thinking. I'd love to hear more from ${o}.`],
        1: [`I'd really like to see ${name} participate more in class — ${p} ideas matter, and the class would be better for hearing them.`, `Participation has been a real challenge — ${name} rarely speak${v} up, and I want to find ways to make ${o} feel more comfortable contributing.`]
      };
      p1 += pick(paOnly[pa]) + ' ';
    }

    paras.push(p1.trim());
  }

  // ═══ PARAGRAPH 2: ACADEMIC PICTURE — evidence, specifics, assignments ═══
  {
    let p2 = '';

    if (overall > 0) {
      // Open with academic standing + sections
      if (topSecs.length > 0 && lowSecs.length > 0) {
        const topNames = topSecs.slice(0, 2).map(sec => sec.name.toLowerCase());
        const lowNames = lowSecs.slice(0, 2).map(sec => sec.name.toLowerCase());
        p2 += pick([
          `Academically, ${name} is working at a ${overallLabel} level overall. ${S} ${does} particularly well in ${oxList(topNames)}, while ${oxList(lowNames)} ${lowSecs.length === 1 ? 'is' : 'are'} where ${s} need${v} more development.`,
          `On the academic side, ${name} is at ${overallLabel}. ${P} strongest work has been in ${oxList(topNames)}, and ${s}${ve} got room to grow in ${oxList(lowNames)}.`,
          `Looking at the academics, ${name} ${nis} performing at a ${overallLabel} level. ${S} ${is_} doing ${p} best work in ${oxList(topNames)} and could use more support in ${oxList(lowNames)}.`,
          `${name}'s overall standing is ${overallLabel}. There's a nice split here: ${oxList(topNames)} ${topSecs.length === 1 ? 'is' : 'are'} clearly ${p} strong suit, while ${oxList(lowNames)} will need more attention going forward.`,
        ]);
      } else if (topSecs.length > 0) {
        const topNames = topSecs.slice(0, 3).map(sec => sec.name.toLowerCase());
        p2 += pick([
          `Academically, ${name} is working at a ${overallLabel} level, with strong results in ${oxList(topNames)}.`,
          `${S}${ve} been performing at ${overallLabel} overall — ${p} work in ${oxList(topNames)} has been especially solid.`,
          `${name}'s academic profile is looking strong at ${overallLabel}, with particularly impressive results in ${oxList(topNames)}.`,
          `On the academic front, ${name} ${nis} at ${overallLabel}. ${P} work in ${oxList(topNames)} has been a real standout.`,
        ]);
      } else if (sectionData.length > 0) {
        // All sections middling — still interesting to comment on
        const allNames = sectionData.slice(0, 3).map(sec => sec.name.toLowerCase());
        p2 += pick([
          `Academically, ${name} is working at a ${overallLabel} level across ${oxList(allNames)}.`,
          `${name}'s academic work sits at ${overallLabel} overall, with fairly even performance across ${p} sections.`,
        ]);
        p2 += ' ';
      } else {
        p2 += `Academically, ${name} is working at a ${overallLabel} level${completion > 0 ? ` with ${Math.round(completion)}% of assessments completed` : ''}. `;
      }
      p2 += ' ';

      // Add a sentence about the spread / pattern if interesting
      if (sectionData.length >= 3) {
        const spread = sectionData[0].prof - sectionData[sectionData.length - 1].prof;
        if (spread >= 2) {
          p2 += pick([
            `There's quite a range across ${p} sections — ${s} ${is_} clearly stronger in some areas than others, which is totally normal and helps us know where to focus. `,
            `The data shows real variation across sections, which gives us a clear picture of where to concentrate ${p} energy. `,
          ]);
        } else if (spread <= 0.5 && overallR >= 3) {
          p2 += pick([
            `What's nice is that ${p} performance is consistently strong across all areas — there's no real weak spot to speak of. `,
            `${S} ${is_} performing steadily across the board, which is a great sign. `,
          ]);
        }
      }
    }

    // Strengths + growth tags woven into academic narrative
    if (savedStrengths.length > 0 && savedGrowth.length > 0) {
      const sNames = savedStrengths.slice(0, 3).map(n => n.toLowerCase());
      const gNames = savedGrowth.slice(0, 3).map(n => n.toLowerCase());
      p2 += pick([
        `${S} ${has} shown particular strength in ${oxList(sNames)}, while ${oxList(gNames)} ${savedGrowth.length === 1 ? 'remains' : 'remain'} areas for continued development. `,
        `Specific curriculum strengths include ${oxList(sNames)}. On the flip side, ${oxList(gNames)} ${savedGrowth.length === 1 ? 'is' : 'are'} where I'd like to see the most improvement. `,
        `When I look at the specifics, ${name}'s strengths in ${oxList(sNames)} are clear. The growth areas to target are ${oxList(gNames)}. `,
        `${name} really shines when it comes to ${oxList(sNames)}. The areas that need the most attention are ${oxList(gNames)}, and those will be our focus going forward. `,
      ]);
    } else if (savedStrengths.length > 0) {
      const sNames = savedStrengths.slice(0, 3).map(n => n.toLowerCase());
      p2 += pick([
        `${S} ${has} shown particular strength in ${oxList(sNames)}. `,
        `I want to specifically call out ${p} work in ${oxList(sNames)} — that's where ${s} really shine${v}. `,
        `Curriculum-wise, ${oxList(sNames)} ${savedStrengths.length === 1 ? 'is' : 'are'} where ${name} ${nis} at ${p} best. `,
      ]);
    } else if (savedGrowth.length > 0) {
      const gNames = savedGrowth.slice(0, 3).map(n => n.toLowerCase());
      p2 += pick([
        `The main areas to focus on going forward are ${oxList(gNames)}. `,
        `Looking ahead, I'd like ${name} to put extra energy into ${oxList(gNames)} — that's where the biggest gains are waiting. `,
        `For next steps, the priority growth areas are ${oxList(gNames)}. `,
      ]);
    }

    // Specific assignments — this is the evidence that makes comments real
    if (strongAssign.length > 0 || weakAssign.length > 0) {
      if (strongAssign.length > 0 && weakAssign.length > 0) {
        if (strongAssign.length === 1 && weakAssign.length === 1) {
          p2 += pick([
            `For example, ${s} did really well on the ${strongAssign[0].title} (${strongAssign[0].level}), while the ${weakAssign[0].title} was more of a challenge (${weakAssign[0].level}). `,
            `The ${strongAssign[0].title} was a highlight at ${strongAssign[0].level}, though ${s} found the ${weakAssign[0].title} tougher, coming in at ${weakAssign[0].level}. `,
            `To give a concrete example: the ${strongAssign[0].title} was strong work (${strongAssign[0].level}), whereas the ${weakAssign[0].title} (${weakAssign[0].level}) showed ${s} still ${has} work to do in that area. `,
          ]);
        } else {
          const sA = strongAssign.map(m => m.title);
          const wA = weakAssign.map(m => m.title);
          p2 += pick([
            `${S} showed strong results on ${oxList(sA)}, while ${oxList(wA)} ${weakAssign.length === 1 ? 'was' : 'were'} more challenging. `,
            `Looking at specific assignments, ${oxList(sA)} ${strongAssign.length === 1 ? 'was' : 'were'} real highlights. ${oxList(wA)}, on the other hand, showed areas that still need work. `,
          ]);
        }
      } else if (strongAssign.length > 0) {
        if (strongAssign.length === 1) {
          p2 += pick([
            `A highlight was the ${strongAssign[0].title}, where ${s} reached ${strongAssign[0].level}. `,
            `${S} did particularly well on the ${strongAssign[0].title} (${strongAssign[0].level}). `,
            `I want to specifically highlight the ${strongAssign[0].title} — ${s} earned ${strongAssign[0].level} and it showed real understanding. `,
            `The ${strongAssign[0].title} was a standout piece of work, coming in at ${strongAssign[0].level}. `,
          ]);
        } else {
          p2 += pick([
            `Notable successes include ${oxList(strongAssign.map(m => `the ${m.title} (${m.level})`))}. `,
            `I want to highlight ${oxList(strongAssign.map(m => `the ${m.title} (${m.level})`))} — these were excellent pieces of work. `,
          ]);
        }
      } else if (weakAssign.length > 0) {
        if (weakAssign.length === 1) {
          p2 += pick([
            `The ${weakAssign[0].title} was a challenge (${weakAssign[0].level}) and something to revisit. `,
            `${S} struggled with the ${weakAssign[0].title} (${weakAssign[0].level}), and that's an area we can work on. `,
          ]);
        } else {
          p2 += pick([
            `${oxList(weakAssign.map(m => `the ${m.title}`))} were areas of difficulty and worth revisiting. `,
            `Assignments like ${oxList(weakAssign.map(m => `the ${m.title}`))} were tougher, and they point to where ${s} need${v} more practice. `,
          ]);
        }
      }
      // Add a reflective bridge after assignments
      if (strongAssign.length > 0 && weakAssign.length > 0) {
        p2 += pick([
          `That mix of highs and lows is actually useful — it tells us exactly where to focus. `,
          `This kind of variation is normal and helps us pinpoint ${p} next steps. `,
          ``,
        ]);
      }
    } else if (overall > 0 && mentionedAssignments.length === 0 && assessments.length > 0) {
      // No mentioned assignments but we have assessment data — add a general note
      const completedCount = studentScores.filter(sc => sc.score > 0).length;
      if (completedCount > 0) {
        p2 += pick([
          `Across ${p} assessed work this term, ${s}${ve} shown ${overallR >= 3 ? 'a solid grasp of the material' : 'progress toward understanding the key concepts'}. `,
          `The body of work ${s}${ve} produced this term ${overallR >= 3 ? 'demonstrates real competence' : 'shows growing understanding, with room to deepen'}.  `,
        ]);
      }
    }

    if (p2.trim()) paras.push(p2.trim());
  }

  // ═══ PARAGRAPH 3: EVIDENCE FROM OBSERVATIONS + SELF-REFLECTION ═══
  {
    let p3 = '';

    // Teacher observations — woven in as specific moments
    // Observations are free-text and can be noun phrases, fragments, or full sentences.
    // Use colon-introduction or "for example" framing to avoid grammar mismatches.
    if (mentionedObs.length > 0) {
      const obData = mentionedObs.map(ob => {
        const raw = esc(ob.text.trim().replace(/\.$/, ''));
        return { text: raw, sentiment: ob.sentiment, context: ob.context };
      });

      const ctxMap = {
        'whole-class': 'during a whole-class activity', 'small-group': 'during small group work',
        'independent': 'while working independently', 'presentation': 'during a presentation',
        'discussion': 'in a class discussion'
      };

      if (obData.length === 1) {
        const ob = obData[0];
        const when = ob.context ? ' ' + (ctxMap[ob.context] || '') : '';

        if (ob.sentiment === 'strength') {
          p3 += pick([
            `One moment that really stood out${when}: "${ob.text}." That's the kind of work I love to see from ${name}. `,
            `I want to highlight a specific moment${when} — "${ob.text}." `,
            `A great example of what ${name} is capable of: "${ob.text}." `,
            `Here's something I wrote down${when} that captures ${name} at ${p} best: "${ob.text}." `,
            `I was especially impressed${when} when I observed: "${ob.text}." This is exactly the kind of thing I hope to see more of. `,
            `This note from my records${when} says it better than I could summarize: "${ob.text}." `,
          ]);
        } else if (ob.sentiment === 'concern') {
          p3 += pick([
            `I did want to mention one thing${when}: "${ob.text}." It's something we can work on together. `,
            `One area I noted${when}: "${ob.text}." I think with some focus, this can improve. `,
            `I want to be transparent about something I observed${when}: "${ob.text}." I'm confident we can address this with the right support. `,
          ]);
        } else {
          p3 += pick([
            `From my notes${when}: "${ob.text}." `,
            `One thing I jotted down${when}: "${ob.text}." `,
            `A recent observation${when}: "${ob.text}." `,
            `Something I noted${when} that I think is worth sharing: "${ob.text}." `,
          ]);
        }
      } else {
        // Multiple observations — group by sentiment, weave naturally
        const posOb = obData.filter(ob => ob.sentiment === 'strength');
        const negOb = obData.filter(ob => ob.sentiment === 'concern');
        const neutOb = obData.filter(ob => ob.sentiment !== 'strength' && ob.sentiment !== 'concern');

        // Open with a framing sentence for multiple obs
        p3 += pick([
          `I keep detailed notes on students throughout the term, and ${name}'s tell a clear story. `,
          `Looking through my observation notes, a few things stand out. `,
          `I want to share some specific moments from class that give a fuller picture of ${name} as a learner. `,
        ]);

        if (posOb.length > 0) {
          if (posOb.length === 1) {
            p3 += pick([
              `A highlight: "${posOb[0].text}." `,
              `On the positive side: "${posOb[0].text}." `,
            ]);
          } else {
            p3 += pick([
              `Some highlights: "${posOb[0].text}"; "${posOb[1].text}."${posOb.length > 2 ? ` I also noted: "${posOb[2].text}."` : ''} `,
              `I recorded these strengths: "${posOb[0].text}" and "${posOb[1].text}."${posOb.length > 2 ? ` Also: "${posOb[2].text}."` : ''} These moments capture what ${name} ${nis} capable of. `,
            ]);
          }
        }
        if (neutOb.length > 0) {
          p3 += pick([
            `I also noted: "${neutOb.map(ob => ob.text).join('"; "')}." `,
            `Other moments I recorded: "${neutOb.map(ob => ob.text).join('"; "')}." `,
          ]);
        }
        if (negOb.length > 0) {
          p3 += pick([
            `Something to keep an eye on: "${negOb.map(ob => ob.text).join('"; "')}." `,
            `On a more challenging note: "${negOb.map(ob => ob.text).join('"; "')}." This is something we'll work on. `,
          ]);
        }
      }
    } else if (obsCount > 0) {
      // No specific obs selected but we have observation data — mention the pattern
      if (strengthObs.length > concernObs.length && strengthObs.length >= 2) {
        p3 += pick([
          `I've recorded ${obsCount} observations for ${name} this term, and the trend is positive — ${strengthObs.length} of those were flagged as strengths. That pattern tells me a lot about the kind of learner ${s} ${is_}.`,
          `My observation notes have been largely positive this term, with ${strengthObs.length} strength notes out of ${obsCount} total. ${name} is building a track record of strong classroom moments.`,
          `Across ${obsCount} classroom observations this term, the story is encouraging — the majority of my notes highlight ${name}'s strengths, with ${strengthObs.length} positive entries.`,
        ]);
        p3 += ' ';
      } else if (concernObs.length >= 2) {
        p3 += pick([
          `I've flagged some concerns in my observation notes this term that are worth discussing. I want us to work together to address these patterns. `,
          `My observation notes this term include ${concernObs.length} concerns, and I think it's important to talk about what I'm seeing so we can make a plan. `,
        ]);
      } else if (obsCount >= 3) {
        p3 += pick([
          `I've been tracking ${name}'s progress through ${obsCount} classroom observations this term, and the picture is coming into focus. `,
          `With ${obsCount} observations recorded this term, I have a good sense of how ${name} operates in different classroom settings. `,
        ]);
      }
      if (topContext) {
        const ctxLabel = { 'whole-class':'whole-class activities', 'small-group':'small group work', 'independent':'independent work',
          'presentation':'presentations', 'discussion':'class discussions' }[topContext] || topContext;
        p3 += pick([
          `Most of my observations have come from ${ctxLabel}. `,
          `I've particularly noticed ${p} patterns during ${ctxLabel}. `,
        ]);
      }
    }

    // Self-reflection data — this is powerful for parents
    if (selfAware) {
      // Bridge sentence if we also had observation content
      if (p3.trim()) {
        p3 += pick([
          `On the self-assessment side, `,
          `It's also worth looking at how ${name} sees ${p}self. `,
          `${name}'s own perspective is telling, too. `,
        ]);
      }
      if (highConfidence.length > 0 && lowConfidence.length > 0) {
        const hNames = highConfidence.slice(0, 2).map(([secId]) => {
          const sec = sections.find(sec2 => sec2.id === secId);
          return sec ? (sec.shortName || sec.name).toLowerCase() : '';
        }).filter(Boolean);
        const lNames = lowConfidence.slice(0, 2).map(([secId]) => {
          const sec = sections.find(sec2 => sec2.id === secId);
          return sec ? (sec.shortName || sec.name).toLowerCase() : '';
        }).filter(Boolean);
        p3 += pick([
          `${p3.trim() ? '' : 'In ' + p + ' own self-assessment, '}${name} feels confident about ${oxList(hNames)} but less sure about ${oxList(lNames)} — that self-awareness is really valuable and shows maturity as a learner. `,
          `${p3.trim() ? '' : 'Interestingly, '}${name}'s self-reflection shows ${s} feel${v} strong in ${oxList(hNames)} but recognize${v} ${s} need${v} growth in ${oxList(lNames)}. I appreciate that honesty — being able to identify your own growth areas is a skill in itself. `,
          `${name} feel${v} good about ${p} work in ${oxList(hNames)} while acknowledging that ${oxList(lNames)} need${v} more work. That kind of self-awareness is something I really value. `,
        ]);
      } else if (highConfidence.length > 0) {
        const hNames = highConfidence.slice(0, 2).map(([secId]) => {
          const sec = sections.find(sec2 => sec2.id === secId);
          return sec ? (sec.shortName || sec.name).toLowerCase() : '';
        }).filter(Boolean);
        p3 += pick([
          `${name}'s own self-assessment shows ${s} feel${v} confident in ${oxList(hNames)}, which aligns with what I'm seeing in ${p} work. `,
          `${name} feel${v} strong in ${oxList(hNames)}, and the data backs that up — ${p} self-perception matches the academic picture nicely. `,
        ]);
      } else if (lowConfidence.length > 0) {
        const lNames = lowConfidence.slice(0, 2).map(([secId]) => {
          const sec = sections.find(sec2 => sec2.id === secId);
          return sec ? (sec.shortName || sec.name).toLowerCase() : '';
        }).filter(Boolean);
        p3 += pick([
          `${name} has identified ${oxList(lNames)} as areas where ${s} feel${v} less confident — it's great that ${s} can recognize that, and we'll make sure to support ${o} there. `,
          `${name}'s self-reflection flags ${oxList(lNames)} as areas of lower confidence, and that's an important insight. Knowing where you need help is the first step to getting better. `,
        ]);
      }
    }

    if (p3.trim()) paras.push(p3.trim());
  }

  // ═══ PARAGRAPH 4: CONCERNS, GROWTH, NEXT STEPS + CLOSER ═══
  {
    let p4 = '';

    // Behavioural concerns — addressed directly but kindly
    if (negTraits.length > 0) {
      const cMap = {
        'needs-support': `benefits from additional support and encouragement`,
        'often-late': `has been arriving late to class more often than I'd like`,
        'device-issue': `sometimes struggles to manage ${p} device use during class time`,
        'reminders-focus': `needs regular check-ins to stay focused`,
        'often-absent': `has had a number of absences that are affecting ${p} continuity in class`,
        'incomplete-work': `has had trouble completing assignments on time`,
        'disorganized': `could use help with organization — materials and work are often misplaced or hard to find`,
        'off-task': `can drift off-task during work time and needs redirection`,
        'social-conflicts': `has had some social conflicts with peers that have affected ${p} focus`,
        'low-confidence': `tends to doubt ${p}self and could use encouragement to trust ${p} own abilities`,
        'avoids-challenges': `tends to avoid challenging tasks and sticks to what feels safe`,
        'rushed-work': `often rushes through work without taking the time to do ${p} best`
      };
      const concerns = negTraits.map(t => cMap[t]).filter(Boolean);
      const mainConcerns = concerns.slice(0, 3);
      const extraConcerns = concerns.slice(3);
      if (archetype === 'star' || archetype === 'strong') {
        p4 += `The main thing I'd flag is that ${name} ${oxList(mainConcerns)}. It's a small thing relative to all the positives. `;
      } else {
        p4 += pick([
          `I do want to be upfront that ${name} ${oxList(mainConcerns)}. `,
          `On the practical side, ${name} ${oxList(mainConcerns)}, and that's something we should address. `,
        ]);
      }
      if (extraConcerns.length > 0) {
        p4 += pick([
          `I've also noticed that ${s} ${oxList(extraConcerns)}. `,
          `Additionally, ${s} ${oxList(extraConcerns)}. `,
        ]);
      }
    }

    // Dimensions that need work
    if (dimNeeds.length > 0) {
      p4 += pick([
        `In terms of learning dispositions, ${oxList(dimNeeds)} ${dimNeeds.length === 1 ? 'is' : 'are'} where ${s} could use the most support. We'll be intentional about creating opportunities for growth in ${dimNeeds.length === 1 ? 'this area' : 'these areas'}. `,
        `I'd like to see ${name} build more confidence in ${oxList(dimNeeds)} going forward. These are skills that develop over time, and I'll be looking for ways to support that growth. `,
        `When it comes to learning dispositions, ${oxList(dimNeeds)} ${dimNeeds.length === 1 ? 'is' : 'are'} the area to watch. I'll be working with ${name} to find strategies that help. `,
      ]);
    }

    // Growth areas + next steps
    if (savedGrowth.length > 0 && !paras.some(p => savedGrowth.some(g => p.toLowerCase().includes(g.toLowerCase())))) {
      const gNames = savedGrowth.slice(0, 3).map(n => n.toLowerCase());
      p4 += pick([
        `Going forward, the key areas to focus on are ${oxList(gNames)}. With targeted practice and support, I'm confident ${s} can make real progress. `,
        `Looking ahead, our priorities will be ${oxList(gNames)}. I'll be designing learning opportunities that help ${name} strengthen ${p} skills in ${gNames.length === 1 ? 'this area' : 'these areas'}. `,
        `The roadmap for growth centers on ${oxList(gNames)}. These aren't weaknesses so much as opportunities — and I'm excited to see how ${name} responds to the challenge. `,
      ]);
    } else if (lowSecs.length > 0 && savedGrowth.length === 0 && !paras.some(pp => lowSecs.some(sec => pp.toLowerCase().includes(sec.name.toLowerCase())))) {
      const sNames = lowSecs.slice(0, 2).map(sec => sec.name.toLowerCase());
      p4 += pick([
        `Going forward, we'll be focusing on building ${p} skills in ${oxList(sNames)}. I have a clear plan for how to support ${o}. `,
        `The plan for next term is to put more energy into ${oxList(sNames)}. These are areas where focused effort can make a meaningful difference. `,
        `Next term, I want to prioritize ${oxList(sNames)} for ${name}. With the right scaffolding and practice, I expect to see improvement. `,
      ]);
    }

    // If no specific growth content yet, add a forward-looking bridge
    if (!p4.trim() && archetype !== 'early') {
      p4 += pick([
        `Looking ahead, I want ${name} to keep building on what's working and stay open to feedback in the areas that need attention. `,
        `For next term, I'll be watching for continued growth and looking for ways to push ${name} to the next level. `,
      ]);
    }

    // Closer — warm, specific to archetype
    const closers = {
      star: [
        `${name} should be really proud of this term. I'm excited to see where ${s} go${v === 's' ? 'es' : ''} from here.`,
        `Fantastic work all around — ${name} ${nis} a joy to have in class, and I can't wait to see what ${s} do${v === 's' ? 'es' : ''} next.`,
        `Keep up the amazing work, ${name}. This has been a standout term, and ${s}${ve} set a high standard for ${p}self.`,
        `What an impressive term. ${name} ${nis} the kind of student who inspires the people around ${o}, and I'm genuinely excited about ${p} future.`,
        `This term has been something special for ${name}. ${S} should celebrate this — and then get ready to keep pushing.`,
      ],
      strong: [
        `${name} should feel good about this term — there's a lot to be proud of here, and the trajectory is pointing up.`,
        `A really strong term for ${name}. I'm looking forward to seeing ${o} continue to grow and challenge ${p}self.`,
        `Great effort this term. ${name} ${nis} heading in a really good direction, and with a few more steps, ${s} could truly excel.`,
        `I'm proud of what ${name} has accomplished this term. The effort is there, the talent is there — it's a great combination.`,
        `${name} has shown me a lot this term. I'm confident that with continued effort, ${s}${ve} got even bigger things ahead.`,
      ],
      steady: [
        `Overall, a positive term for ${name}. With continued effort, ${s}${ve} got a lot of room to grow, and I'm here to support that journey.`,
        `${name} ${nis} in a good place and I'm looking forward to seeing ${p} continued progress. The foundation is solid.`,
        `Solid work this term. The pieces are there — it's about putting them all together, and I'm optimistic about what's next.`,
        `${name} ${nis} building something here, step by step. I want ${o} to know that steady progress is still progress, and it matters.`,
        `I see a student who ${is_} capable of more and ${is_} getting closer to that potential every day. Keep it up, ${name}.`,
      ],
      building: [
        `I believe in ${name}'s potential and I'm committed to helping ${o} get there. Let's work on this together — I'm in ${p} corner.`,
        `There's real potential here, and with more consistent effort and the right support, I know ${name} can make a big jump. I haven't given up, and I don't want ${o} to either.`,
        `I want ${name} to know that growth takes time, and I see the effort ${s}${ve} been putting in. Let's build on that and make next term even stronger.`,
        `The road has been bumpy, but ${name} ${nhas} shown me flashes of what ${s} ${is_} truly capable of. I want to help ${o} find that consistency. Let's make a plan together.`,
        `I care about ${name}'s success and I want to find the right path forward. With some adjustments and support, I'm confident things will improve.`,
      ],
      early: [
        `We're still getting started, and I'm looking forward to learning more about ${name}'s strengths as the term progresses. The best is yet to come.`,
        `There's so much more to learn about ${name} as a student, and I'm excited to see ${p} profile develop as we get further into the term.`,
        `This is just the beginning, and I'm optimistic about what's ahead for ${name}. Stay tuned.`,
      ]
    };
    p4 += pick(closers[archetype]);

    if (p4.trim()) paras.push(p4.trim());
  }

  // ═══ ASSEMBLE ═══
  // Use <p> tags for contenteditable editor; fallback plain-text also works
  const html = paras.map(p => `<p>${p}</p>`).join('');
  upsertTermRating(cid, sid, termId, { narrative: html });
  renderReports();
}

function tqSelectStudent(sid) {
  tqSaveCurrentIfNeeded();
  const students = getTqStudents();
  const idx = students.findIndex(s => s.id === sid);
  if (idx >= 0) { tqStudentIndex = idx; renderReports(); }
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
    return r && OBS_DIMS.some(d => (r.dims?.[d]||0) > 0);
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
  const goals = getGoals(cid);
  const reflections = getReflections(cid);
  const studentGoals = goals[sid] || {};
  const studentReflections = reflections[sid] || {};

  // Observation insights
  const obsCount = allObs.length;
  const sentimentCounts = { strength:0, growth:0, concern:0 };
  const contextCounts = {};
  allObs.forEach(ob => {
    if (ob.sentiment) sentimentCounts[ob.sentiment] = (sentimentCounts[ob.sentiment]||0) + 1;
    if (ob.context) contextCounts[ob.context] = (contextCounts[ob.context]||0) + 1;
  });
  const topContext = Object.entries(contextCounts).sort((a,b) => b[1]-a[1])[0];

  // Strengths & growth areas (auto-populated from tag proficiency)
  const tagProfs = allTags.map(t => ({ tag: t, prof: getTagProficiency(cid, sid, t.id), section: getSectionForTag(cid, t.id) }))
    .filter(t => t.prof > 0);
  const strengths = tagProfs.filter(t => t.prof >= 3).sort((a,b) => b.prof - a.prof).slice(0, 6);
  const growthAreas = tagProfs.filter(t => t.prof > 0 && t.prof < 3).sort((a,b) => a.prof - b.prof).slice(0, 6);

  // Per-assignment performance
  const assessments = getAssessments(cid);
  const studentScores = getScores(cid)[sid] || [];
  const assignmentPerf = assessments.map(a => {
    const aScores = studentScores.filter(s => s.assessmentId === a.id && s.score > 0);
    const avg = aScores.length > 0 ? aScores.reduce((sum,s) => sum + s.score, 0) / aScores.length : 0;
    const high = aScores.length > 0 ? Math.max(...aScores.map(s => s.score)) : 0;
    const low = aScores.length > 0 ? Math.min(...aScores.map(s => s.score)) : 0;
    return { id: a.id, title: a.title, date: a.date, type: a.type || 'summative', avg, high, low, count: aScores.length };
  }).filter(a => a.count > 0).sort((a,b) => (b.date || '').localeCompare(a.date || ''));

  // Saved quick-profile data
  const workHabits = rating.workHabits || 0;
  const participation = rating.participation || 0;
  const socialTraits = rating.socialTraits || [];
  const savedStrengths = rating.strengths || strengths.map(s => s.tag.id);
  const savedGrowth = rating.growthAreas || growthAreas.map(g => g.tag.id);
  const mentionAssessments = rating.mentionAssessments || [];

  // Completion counts
  const ratedDimCount = OBS_DIMS.filter(d => (dims[d]||0) > 0).length;
  let html = `<div class="tq-wrap">`;

  // ══ HEADER BAR (shared component) ══
  html += renderStudentHeader(cid, sid, {
    buttonLabel: 'Student Dashboard',
    buttonHref: `#/student?course=${cid}&id=${sid}`
  });

  // ══ COLUMN 1: RATE — Dispositions + Quick Profile ══
  html += `<div class="tq-col-rate">`;

  // Disposition ratings as compact rows
  html += `<div class="tq-panel">
    <div class="tq-panel-title">Learner Dispositions <span class="tq-panel-badge">${ratedDimCount}/6</span></div>`;
  const PILL_TEXT = {1:'Needs Support', 2:'Developing', 3:'Growing', 4:'Thriving'};
  OBS_DIMS.forEach(dim => {
    const val = dims[dim] || 0;
    const evCount = getQuickObsByDim(cid, sid, dim).length;
    html += `<div class="tq-dim-row${val > 0 ? ' rated' : ''}">
      <div class="tq-dim-header">
        <span class="tq-dim-icon">${OBS_ICONS[dim]}</span>
        <span class="tq-dim-label">${OBS_LABELS[dim]}</span>
      </div>
      <div class="tq-dim-pills">`;
    [1,2,3,4].forEach(lvl => {
      html += `<button class="tq-pill pill-${lvl}${val === lvl ? ' active' : ''}"
        data-action="tqSetDim" data-sid="${sid}" data-dim="${dim}" data-lvl="${lvl}">${PILL_TEXT[lvl]}</button>`;
    });
    html += `</div>
    </div>`;
  });
  html += `</div>`;

  // Quick Profile
  const RATE_LABELS = {1:'Rarely', 2:'Sometimes', 3:'Usually', 4:'Consistently'};
  html += `<div class="tq-panel">
    <div class="tq-panel-title">Quick Profile</div>`;
  ['workHabits', 'participation'].forEach(field => {
    const val = rating[field] || 0;
    const label = field === 'workHabits' ? 'Work Habits' : 'Participation';
    html += `<div class="tq-rate-row">
      <span class="tq-rate-label">${label}</span>
      <div class="tq-rate-pills">`;
    [1,2,3,4].forEach(lvl => {
      html += `<button class="tq-rate-pill rp-${lvl}${val === lvl ? ' active' : ''}"
        data-action="tqSetField" data-sid="${sid}" data-field="${field}" data-lvl="${lvl}">${RATE_LABELS[lvl]}</button>`;
    });
    html += `</div></div>`;
  });

  // Trait chips
  const SOCIAL_TRAITS = [
    // Positive / character
    {id:'leader', label:'Leader'}, {id:'collaborative', label:'Collaborative'},
    {id:'independent', label:'Independent'}, {id:'peer-mentor', label:'Peer Mentor'},
    {id:'risk-taker', label:'Risk Taker'}, {id:'reflective', label:'Reflective'},
    {id:'creative', label:'Creative Thinker'}, {id:'persistent', label:'Persistent'},
    {id:'organized', label:'Organized'}, {id:'empathetic', label:'Empathetic'},
    {id:'curious', label:'Curious'}, {id:'respectful', label:'Respectful'},
    {id:'positive-attitude', label:'Positive Attitude'}, {id:'detail-oriented', label:'Detail-Oriented'},
    {id:'advocate', label:'Self-Advocate'},
    // Concerns / areas to grow
    {id:'needs-support', label:'Needs Support'}, {id:'often-late', label:'Often Late'},
    {id:'device-issue', label:'Device Issue'}, {id:'reminders-focus', label:'Reminders to Focus'},
    {id:'often-absent', label:'Often Absent'}, {id:'incomplete-work', label:'Incomplete Work'},
    {id:'disorganized', label:'Disorganized'}, {id:'off-task', label:'Off-Task Behaviour'},
    {id:'social-conflicts', label:'Social Conflicts'}, {id:'low-confidence', label:'Low Confidence'},
    {id:'avoids-challenges', label:'Avoids Challenges'}, {id:'rushed-work', label:'Rushes Work'},
  ];
  const CONCERN_IDS = new Set(['needs-support','often-late','device-issue','reminders-focus','often-absent','incomplete-work','disorganized','off-task','social-conflicts','low-confidence','avoids-challenges','rushed-work']);
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

  html += `</div>`; // close col-rate

  // ══ COLUMN 2: DATA — Auto-populated intelligence ══
  html += `<div class="tq-col-data">`;

  // Academic Snapshot + Assignments
  html += `<div class="tq-panel">
    <div class="tq-panel-title">Academic Snapshot <span class="tq-panel-badge">${assignmentPerf.length} assessed</span></div>
    <div class="tq-snapshot-grid">
      <div class="tq-snapshot-item" style="background:var(--overlay-hover)">
        <div class="tq-snapshot-item-label" style="font-weight:700">Overall</div>
        <div class="tq-snapshot-item-value" style="color:${PROF_COLORS[Math.round(overall)]||'var(--text-3)'};background:${PROF_TINT[Math.round(overall)]||'transparent'}">${overall > 0 ? PROF_LABELS[Math.round(overall)] : 'No data'}</div>
      </div>`;
  sections.forEach(sec => {
    const prof = getSectionProficiency(cid, sid, sec.id);
    const sr = Math.round(prof);
    html += `<div class="tq-snapshot-item">
      <div class="tq-snapshot-item-label">${esc(sec.shortName || sec.name)}</div>
      <div class="tq-snapshot-item-value" style="color:${PROF_COLORS[sr]||'var(--text-3)'};background:${PROF_TINT[sr]||'transparent'}">${prof > 0 ? PROF_LABELS[sr] : '—'}</div>
    </div>`;
  });
  html += `</div>`;

  // Assignment performance rows (toggleable for mention in narrative)
  if (assignmentPerf.length > 0) {
    html += `<div style="margin-top:10px"><div class="tq-panel-title" style="font-size:0.5rem;margin-bottom:6px">Assignments — select to mention</div>
    <div class="tq-assignment-list">`;
    assignmentPerf.forEach(a => {
      const r = Math.round(a.avg);
      const selected = mentionAssessments.includes(a.id);
      html += `<div class="tq-assignment-row${selected ? ' selected' : ''}" data-action="tqToggleAssignment" data-sid="${sid}" data-aid="${a.id}">
        <span class="tq-tag-check">${selected ? '✓' : ''}</span>
        <span class="tq-assignment-title">${esc(a.title)}</span>
        <span class="tq-assignment-type">${a.type === 'formative' ? 'Form' : 'Sum'}</span>
        <span class="tq-assignment-score" style="color:${PROF_COLORS[r]||'var(--text-3)'}">${PROF_LABELS[r]}</span>
      </div>`;
    });
    html += `</div></div>`;
  }
  html += `</div>`;


  // Self-reflections (stays in col-data)
  const reflectionEntries = Object.entries(studentReflections).filter(([,r]) => r && r.confidence > 0);
  if (reflectionEntries.length > 0) {
    html += `<div class="tq-panel">
      <div class="tq-panel-title">Student Self-Reflections</div>`;
    reflectionEntries.forEach(([secId, ref]) => {
      const sec = sections.find(s => s.id === secId);
      const secName = sec ? (sec.shortName || sec.name) : secId;
      html += `<div class="tq-reflection-row">
        <span class="tq-reflection-label">${esc(secName)}</span>
        <span class="tq-reflection-val" style="color:${CONFIDENCE_COLORS[ref.confidence]}">${CONFIDENCE_LABELS[ref.confidence]}</span>
      </div>`;
    });
    html += `</div>`;
  }

  html += `</div>`; // close col-data

  // ══ COLUMN 3: WRITE — Narrative workspace ══
  html += `<div class="tq-col-write">`;

  html += `<div class="tq-panel" style="position:absolute;inset:0;display:flex;flex-direction:column">
    <div class="tq-panel-title">Narrative Comment</div>
    <div class="tq-editor-wrap" style="flex:1;min-height:0">
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
        <button type="button" class="tq-tb-btn tq-tb-auto" data-action="tqAutoNarrative" data-sid="${sid}" title="Auto-generate from profile data" id="tq-auto-btn">
          <svg viewBox="0 0 24 24"><path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" fill="currentColor" stroke="none" opacity="0.7"/></svg>
          <span>Generate</span>
        </button>
        <button type="button" class="tq-tb-btn tq-tb-copy" data-action="tqCopyNarrative" title="Copy to Clipboard" id="tq-copy-btn">
          <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>Copy</span>
        </button>
      </div>
      <div class="tq-narrative-editor" id="tq-narrative" contenteditable="true"
        data-placeholder="Write about ${esc(name)}'s learning dispositions, work habits, and growth…"
        oninput="window._tqMarkDirty&&window._tqMarkDirty()">${narrative || ''}</div>
    </div>
  </div>`;

  html += `</div>`; // close col-write

  // ══ OBSERVATIONS — spans cols 2-3, below data+write ══
  html += `<div class="tq-col-obs">`;

  // Observation Insights + Evidence — wide layout
  const mentionObs = rating.mentionObs || [];
  const recentObs = allObs.slice(0, 8);
  html += `<div class="tq-panel">
    <div class="tq-panel-title" style="display:flex;align-items:center;justify-content:space-between">
      <span>Observations <span class="tq-panel-badge">${obsCount}</span></span>
      <div class="tq-obs-summary" style="margin:0;gap:8px">`;
  if (sentimentCounts.strength > 0) html += `<div class="tq-obs-stat" style="color:var(--score-3)">✅ ${sentimentCounts.strength}</div>`;
  if (sentimentCounts.growth > 0) html += `<div class="tq-obs-stat" style="color:var(--active)">🔄 ${sentimentCounts.growth}</div>`;
  if (sentimentCounts.concern > 0) html += `<div class="tq-obs-stat" style="color:var(--score-2)">⚠️ ${sentimentCounts.concern}</div>`;
  if (topContext) html += `<div class="tq-obs-stat">${OBS_CONTEXTS[topContext[0]]?.icon||''} ${OBS_CONTEXTS[topContext[0]]?.label||topContext[0]}</div>`;
  html += `</div></div>`;

  if (recentObs.length > 0) {
    const hasAssignObs = recentObs.some(o => o.assignmentContext);
    const hasGenObs = recentObs.some(o => !o.assignmentContext);
    if (hasAssignObs && hasGenObs) {
      html += `<div style="display:flex;gap:4px;margin-bottom:6px">
        <button class="tq-obs-filter-btn${tqObsFilter==='all'?' active':''}" data-action="tqObsFilter" data-filter="all">All</button>
        <button class="tq-obs-filter-btn${tqObsFilter==='general'?' active':''}" data-action="tqObsFilter" data-filter="general">General</button>
        <button class="tq-obs-filter-btn${tqObsFilter==='assignment'?' active':''}" data-action="tqObsFilter" data-filter="assignment">Assignment</button>
      </div>`;
    }
    const filteredObs = recentObs.filter(o => tqObsFilter === 'all' ? true : tqObsFilter === 'assignment' ? !!o.assignmentContext : !o.assignmentContext);
    html += `<div style="font-size:0.55rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Select to mention in narrative</div>`;
    html += `<div class="tq-evidence-list">`;
    filteredObs.forEach(ob => {
      const d = new Date(ob.created);
      const dateStr = d.toLocaleDateString('en-CA', { month:'short', day:'numeric' });
      const sentIcon = ob.sentiment ? (OBS_SENTIMENTS[ob.sentiment]?.icon || '') + ' ' : '';
      const selected = mentionObs.includes(ob.id);
      html += `<div class="tq-evidence-item${selected ? ' selected' : ''}" data-action="tqToggleOb" data-sid="${sid}" data-obid="${ob.id}" style="align-items:flex-start">
        <span class="tq-tag-check" style="margin-top:2px"></span>
        <span class="tq-evidence-text" style="flex:1;min-width:0"><span class="tq-evidence-sentiment">${sentIcon}</span>${ob.assignmentContext ? `<span style="font-size:0.5rem;font-weight:600;color:var(--active);margin-right:3px">${esc(ob.assignmentContext.assessmentTitle)}</span>` : ''}${esc(ob.text)}</span>
        <span class="tq-obs-wide-date">${dateStr}</span>
      </div>`;
    });
    html += `</div>`;
  } else {
    html += `<div style="font-size:0.78rem;color:var(--text-3);padding:8px 0">No observations yet</div>`;
  }
  html += `</div>`;

  html += `</div>`; // close col-obs

  // ══ NAV FOOTER (spans all 3 cols) ══
  html += `<div class="tq-nav-footer">
    <button class="tq-nav-btn" data-action="tqPrevStudent" ${tqStudentIndex === 0 ? 'disabled style="opacity:0.4"' : ''}>← Previous</button>
    <span style="font-family:'SF Mono',monospace;font-size:0.6rem;color:var(--text-3);text-transform:uppercase">${tqStudentIndex + 1} of ${students.length}</span>
    <button class="tq-nav-btn primary" data-action="tqNextStudent">${tqStudentIndex >= students.length - 1 ? 'Done ✓' : 'Save & Next →'}</button>
  </div>`;

  html += `</div>`; // close tq-wrap
  return html;
}

/* ── Init ────────────────────────────────────────────────────── */

// ── Delegated click handler for reports ──

// Handle report-period select change via delegation

// Intercept sidebar clicks — navigate to that student contextually

  /* -- Delegated click handler ---------------------------- */
  function _handleClick(e) {
    if (!e.target.closest('.student-picker')) {
      var dd = document.getElementById('picker-dropdown');
      if (dd) dd.classList.remove('open');
    }

    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    var handlers = {
      'switchTab':              function() { switchTab(el.dataset.tab); },
      'toggleStudentPicker':    function() { toggleStudentPicker(e); },
      'tqPrevStudent':          function() { tqPrevStudent(); },
      'tqNextStudent':          function() { tqNextStudent(); },
      'toggleAnon':             function() { classSummaryAnon = !classSummaryAnon; el.classList.toggle('active', classSummaryAnon); renderReports(); },
      'printReports':           function() { window.print(); },
      'rbApplyPreset':          function() { rbApplyPreset(el.dataset.preset); },
      'rbToggleBlock':          function() { e.stopPropagation(); rbToggleBlock(el.dataset.blockid); },
      'summaryStudentClick':    function() { e.preventDefault(); tqSelectStudent(el.dataset.sid); switchTab('questionnaire'); },
      'toggleStudentSelection': function() { e.stopPropagation(); toggleStudentSelection(el.dataset.sid); },
      'selectAllStudents':      function() { e.stopPropagation(); selectAllStudents(); },
      'selectNoneStudents':     function() { e.stopPropagation(); selectNoneStudents(); },
      'tqSetDim':               function() { tqSetDim(el.dataset.sid, el.dataset.dim, parseInt(el.dataset.lvl)); },
      'tqSetField':             function() { tqSetField(el.dataset.sid, el.dataset.field, parseInt(el.dataset.lvl)); },
      'tqToggleTrait':          function() { tqToggleTrait(el.dataset.sid, el.dataset.tid); },
      'tqToggleAssignment':     function() { tqToggleAssignment(el.dataset.sid, el.dataset.aid); },
      'tqExec':                 function() { tqExec(el.dataset.cmd); },
      'tqAutoNarrative':        function() { tqAutoNarrative(el.dataset.sid); },
      'tqCopyNarrative':        function() { tqCopyNarrative(); },
      'tqObsFilter':            function() { tqObsFilter = el.dataset.filter; renderReports(); },
      'tqToggleOb':             function() { tqToggleOb(el.dataset.sid, el.dataset.obid); }
    };
    if (handlers[action]) {
      handlers[action]();
    }
  }

  function _handleSelectionChange() {
    var editor = document.getElementById('tq-narrative');
    if (!editor) return;
    var sel = document.getSelection();
    if (sel && sel.anchorNode && editor.contains(sel.anchorNode)) tqUpdateToolbar();
  }

  function _handleKeyup(e) {
    var editor = document.getElementById('tq-narrative');
    if (editor && editor.contains(e.target)) tqUpdateToolbar();
  }

  function _handleReportPeriodChange() {
    renderReports();
  }

  function _handleSidebarClick(e) {
    var row = e.target.closest('.student-row');
    if (!row) return;
    e.preventDefault();
    var href = row.getAttribute('href') || '';
    var match = href.match(/id=([^&]+)/);
    if (!match) return;
    var sid = match[1];
    if (activeTab === 'progress') {
      selectedStudentIds = [sid];
      populateStudentSelect();
      renderReports();
    } else if (activeTab === 'summary') {
      tqSelectStudent(sid);
      switchTab('questionnaire');
    } else {
      tqSelectStudent(sid);
    }
  }

  /* -- init / destroy ------------------------------------- */
  function init(params) {
    activeCourse = params.course || getActiveCourse();
    setActiveCourse(activeCourse);
    activeTab = params.tab || 'questionnaire';
    selectedStudentIds = null;
    tqStudentIndex = 0;
    classSummaryAnon = false;
    tqIncludeAssignFeedback = true;
    tqObsFilter = 'all';
    tqNarrativeDirty = false;

    reportConfig = getReportConfigWrapped(activeCourse);

    // Show sidebar
    document.getElementById('sidebar-mount').style.display = '';
    document.getElementById('page-layout').classList.remove('sidebar-hidden');
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(activeCourse, null);
    initSidebarToggle();

    // Render the toolbar + output container into main
    document.getElementById('main').innerHTML = TOOLBAR_HTML;

    // Wire report-period change
    var reportPeriodEl = document.getElementById('report-period');
    if (reportPeriodEl) reportPeriodEl.addEventListener('change', _handleReportPeriodChange);

    // Wire sidebar clicks
    var sidebarEl = document.getElementById('sidebar-mount');
    if (sidebarEl) sidebarEl.addEventListener('click', _handleSidebarClick);

    populateStudentSelect();

    // Handle params
    if (params.student) {
      var students = getTqStudents();
      var idx = students.findIndex(function(s) { return s.id === params.student; });
      if (idx >= 0) tqStudentIndex = idx;
    }

    switchTab(activeTab);

    // beforeunload handler — save unsaved narrative on browser close/refresh
    _beforeUnloadHandler = function() {
      if (tqNarrativeDirty) tqSaveCurrentIfNeeded();
    };
    window.addEventListener('beforeunload', _beforeUnloadHandler);

    window._pageSwitchCourse = switchCourse;

    _addDocListener('click', _handleClick);
    _addDocListener('selectionchange', _handleSelectionChange);
    _addDocListener('keyup', _handleKeyup);
  }

  function destroy() {
    // Save any unsaved narrative
    if (tqNarrativeDirty) tqSaveCurrentIfNeeded();

    _listeners.forEach(function(l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];

    if (_beforeUnloadHandler) {
      window.removeEventListener('beforeunload', _beforeUnloadHandler);
      _beforeUnloadHandler = null;
    }

    // Clean up report-period and sidebar click listeners
    var reportPeriodEl = document.getElementById('report-period');
    if (reportPeriodEl) reportPeriodEl.removeEventListener('change', _handleReportPeriodChange);
    var sidebarEl = document.getElementById('sidebar-mount');
    if (sidebarEl) sidebarEl.removeEventListener('click', _handleSidebarClick);

    delete window._pageSwitchCourse;
  }

  /* -- Toolbar HTML (rendered into main on init) ---------- */
  var TOOLBAR_HTML = '<div class="report-toolbar no-print">\n      <div class="report-seg-control" role="tablist" aria-label="Report type">\n        <button class="report-seg-btn active" data-action="switchTab" data-tab="questionnaire" role="tab" aria-selected="true">Term Questionnaire</button>\n        <button class="report-seg-btn" data-action="switchTab" data-tab="progress" role="tab" aria-selected="false">Progress Reports</button>\n        <button class="report-seg-btn" data-action="switchTab" data-tab="summary" role="tab" aria-selected="false">Class Summary</button>\n      </div>\n      <div class="student-picker" id="student-picker">\n        <button class="student-picker-btn" data-action="toggleStudentPicker" aria-label="Select students" aria-expanded="false" aria-haspopup="listbox">\n          <span id="picker-label">All Students</span>\n          <span class="arrow" aria-hidden="true">\u25bc</span>\n        </button>\n        <div class="student-picker-dropdown" id="picker-dropdown"></div>\n      </div>\n      <div class="tq-student-nav" id="tq-student-nav" style="display:none">\n        <button class="tq-toolbar-arrow" data-action="tqPrevStudent" title="Previous student" aria-label="Previous student">\n          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n        </button>\n        <span class="tq-student-name" id="tq-student-name"></span>\n        <button class="tq-toolbar-arrow" data-action="tqNextStudent" title="Next student" aria-label="Next student">\n          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n        </button>\n        <div class="tq-progress-ring" id="tq-progress-ring">\n          <svg width="30" height="30" viewBox="0 0 30 30">\n            <circle class="ring-bg" cx="15" cy="15" r="12"/>\n            <circle class="ring-fill" id="tq-ring-fill" cx="15" cy="15" r="12" stroke-dasharray="75.4" stroke-dashoffset="75.4"/>\n          </svg>\n          <span class="tq-progress-label" id="tq-progress-label"></span>\n        </div>\n      </div>\n      <select id="report-period" class="report-term-select" aria-label="Reporting period">\n        <option value="Report 1">Report 1</option>\n        <option value="Report 2">Report 2</option>\n        <option value="Report 3">Report 3</option>\n        <option value="Report 4">Report 4</option>\n        <option value="Report 5">Report 5</option>\n        <option value="Report 6">Report 6</option>\n      </select>\n      <div style="margin-left:auto;display:flex;align-items:center;gap:8px">\n        <button class="tb-toggle-btn" id="tb-anon-btn" style="display:none" data-action="toggleAnon">\n          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>\n          Anonymize\n        </button>\n        <button class="tb-action-btn" id="tb-print-btn" data-action="printReports">Print Reports</button>\n      </div>\n    </div>\n    <div id="report-output" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto"></div>';

  /* -- Expose handlers for inline event attributes --------- */
  window.rbDragStart = rbDragStart;
  window.rbDragEnd = rbDragEnd;
  window.rbDragOver = rbDragOver;
  window.rbDragLeave = rbDragLeave;
  window.rbDrop = rbDrop;
  window._tqMarkDirty = function() { tqNarrativeDirty = true; };

  /* -- Public API ----------------------------------------- */
  return {
    init: init,
    destroy: destroy,
    switchCourse: switchCourse
  };
})();
