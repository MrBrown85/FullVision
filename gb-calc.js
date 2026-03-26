/* gb-calc.js — Proficiency calculation engine for FullVision */

/**
 * @typedef {Object} Score
 * @property {number} score - Proficiency level (0-4)
 * @property {string} date - ISO date string (YYYY-MM-DD)
 * @property {string} type - 'summative' or 'formative'
 * @property {string} tagId - Learning tag ID
 * @property {string} assessmentId - Assessment ID
 * @property {number} [rawPoints] - Original points if converted from points mode
 */

/* ── Memoization caches ─────────────────────────────────────── */
var _tagScoresCache = {};
var _tagProfCache = {};
var _awCache = {};

/** Clear all proficiency caches. Call when scores, assessments, overrides, or statuses change. */
function clearProfCache() {
  _tagScoresCache = {};
  _tagProfCache = {};
  _awCache = {};
}

/** Get or build assessment weights map for a course. */
function _getAW(cid) {
  if (_awCache[cid]) return _awCache[cid];
  var assessments = getAssessments(cid);
  var aw = {};
  assessments.forEach(function(a) { aw[a.id] = a.weight || 1; });
  _awCache[cid] = aw;
  return aw;
}

/** Convert a raw point score to a proficiency level using percentage boundaries.
 * @param {number} rawScore - Raw points earned
 * @param {number} maxPoints - Maximum possible points
 * @param {Object} [scale] - Grading scale with boundaries array
 * @param {Array<{min: number, proficiency: number}>} [scale.boundaries] - Percentage boundaries sorted descending
 * @returns {number} Proficiency level (0-4)
 */
function pointsToProf(rawScore, maxPoints, scale) {
  if (!maxPoints || maxPoints <= 0) return 0;
  const pct = (rawScore / maxPoints) * 100;
  const boundaries = (scale && scale.boundaries) || DEFAULT_GRADING_SCALE.boundaries;
  for (let i = 0; i < boundaries.length; i++) {
    if (pct >= boundaries[i].min) return boundaries[i].proficiency;
  }
  return 1;
}
/** Get the summative/formative category weights for a course.
 * @param {string} cid - Course ID
 * @returns {{summative: number, formative: number}} Category weight object
 */
function getCategoryWeights(cid) {
  const cc = getCourseConfig(cid);
  return cc.categoryWeights || { summative: 1.0, formative: 0.0 };
}
/** Get the weight multiplier for an assessment.
 * @param {Object} assessment - Assessment object
 * @param {number} [assessment.weight] - Weight value, defaults to 1
 * @returns {number} Assessment weight
 */
function getAssessmentWeight(assessment) { return assessment.weight || 1; }

/* ── Proficiency Calculation ────────────────────────────────── */
/** Core algorithm: calculate a proficiency level from a group of scores using the specified method.
 * Filters out zero-scores, sorts by date, then applies the chosen calculation strategy.
 * For 'mode', ties are broken by the most recent score among tied values.
 * For 'decayingAvg', scores are weighted so later entries have more influence.
 * @param {Score[]} scores - Array of score entries to evaluate
 * @param {string} method - Calculation method: 'mostRecent'|'highest'|'mode'|'decayingAvg'
 * @param {number} decayWeight - Weight for decaying average (0-1), default 0.65
 * @param {Object} [assessmentWeights] - Map of assessmentId to weight multiplier
 * @returns {number} Calculated proficiency level (0-4), or 0 if no valid scores
 */
function _calcGroup(scores, method, decayWeight, assessmentWeights) {
  const valid = scores.filter(s => s.score > 0);
  if (valid.length === 0) return 0;
  valid.sort((a,b) => (a.date||'').localeCompare(b.date||''));
  switch (method) {
    case 'mostRecent': return valid[valid.length - 1].score;
    case 'highest': return Math.max(...valid.map(s => s.score)); // safe: valid.length > 0 guaranteed by guard on line 79
    case 'mode': {
      const freq = {};
      valid.forEach(s => {
        const w = (assessmentWeights && assessmentWeights[s.assessmentId]) || 1;
        freq[s.score] = (freq[s.score]||0) + w;
      });
      const maxFreq = Math.max(...Object.values(freq)); // safe: freq is non-empty since valid.length > 0
      const modes = Object.keys(freq).filter(k => freq[k] === maxFreq).map(Number);
      if (modes.length === 1) return modes[0];
      for (let i = valid.length - 1; i >= 0; i--) { if (modes.includes(valid[i].score)) return valid[i].score; }
      return modes[0];
    }
    case 'decayingAvg': {
      const dw = decayWeight || 0.65;
      let avg = valid[0].score;
      for (let i = 1; i < valid.length; i++) {
        const w = (assessmentWeights && assessmentWeights[valid[i].assessmentId]) || 1;
        avg = avg * (1 - dw) + valid[i].score * dw * w / ((1 - dw) + dw * w);
      }
      return Math.round(avg);
    }
    default: return valid[valid.length - 1].score;
  }
}

/** Calculate proficiency from an array of scores, splitting by category and applying weights.
 * @param {Score[]} scores - Array of score entries (mixed summative/formative)
 * @param {string} method - Calculation method: 'mostRecent'|'highest'|'mode'|'decayingAvg'
 * @param {number} decayWeight - Weight for decaying average (0-1), default 0.65
 * @param {Object} [opts] - Additional options
 * @param {Object} [opts.categoryWeights] - { summative: number, formative: number }
 * @param {Object} [opts.assessmentWeights] - Map of assessmentId to weight multiplier
 * @returns {number} Proficiency level (0-4)
 */
function calcProficiency(scores, method, decayWeight, opts) {
  const aw = opts && opts.assessmentWeights;
  const cw = opts && opts.categoryWeights;
  const summative = scores.filter(s => s.type === 'summative');
  const formative = scores.filter(s => s.type === 'formative');

  const summProf = _calcGroup(summative, method, decayWeight, aw);

  // If no category weights or formative weight is 0, behave as before
  if (!cw || !cw.formative || cw.formative <= 0) return summProf;

  const formProf = _calcGroup(formative, method, decayWeight, aw);
  if (formProf === 0) return summProf; // no formative evidence, use summative only
  if (summProf === 0) return formProf; // no summative evidence, use formative only

  const raw = summProf * cw.summative + formProf * cw.formative;
  return Math.round(raw);
}

/** Get all score entries for a student on a specific tag, excluding excused and converting points-mode scores.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} tagId - Learning tag ID
 * @returns {Score[]} Filtered and converted score entries
 */
function getTagScores(cid, studentId, tagId) {
  var cacheKey = cid + ':' + studentId + ':' + tagId;
  if (_tagScoresCache[cacheKey]) return _tagScoresCache[cacheKey];

  const allScores = getScores(cid);
  const studentScores = allScores[studentId] || [];
  const statuses = getAssignmentStatuses(cid);
  const filtered = studentScores.filter(s => {
    if (s.tagId !== tagId) return false;
    const status = statuses[studentId + ':' + s.assessmentId];
    if (status === 'excused') return false;
    return true;
  });
  // Convert points-mode scores to proficiency
  const assessments = getAssessments(cid);
  const scale = getGradingScale(cid);
  var result = filtered.map(s => {
    const assess = assessments.find(a => a.id === s.assessmentId);
    if (assess && assess.scoreMode === 'points' && assess.maxPoints > 0) {
      return { ...s, rawPoints: s.score, score: pointsToProf(s.score, assess.maxPoints, scale) };
    }
    return s;
  });
  _tagScoresCache[cacheKey] = result;
  return result;
}

/** Calculate proficiency for a single tag using the course's configured method and weights.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} tagId - Learning tag ID
 * @returns {number} Proficiency level (0-4)
 */
function getTagProficiency(cid, studentId, tagId) {
  var cacheKey = cid + ':' + studentId + ':' + tagId;
  if (_tagProfCache[cacheKey] !== undefined) return _tagProfCache[cacheKey];

  const cc = getCourseConfig(cid);
  const course = COURSES[cid];
  const method = cc.calcMethod || course.calcMethod || 'mostRecent';
  const dw = cc.decayWeight != null ? cc.decayWeight : (course.decayWeight || 0.65);
  const scores = getTagScores(cid, studentId, tagId);
  const cw = getCategoryWeights(cid);
  const aw = _getAW(cid);
  var result = calcProficiency(scores, method, dw, { categoryWeights: cw, assessmentWeights: aw });
  _tagProfCache[cacheKey] = result;
  return result;
}

/** Calculate section proficiency as the average of its tags, using teacher override if one exists.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} sectionId - Section ID
 * @returns {number} Proficiency level (0-4), or 0 if no evidence
 */
function getSectionProficiency(cid, studentId, sectionId) {
  const section = getSections(cid).find(s => s.id === sectionId);
  if (!section) return 0;
  const profs = section.tags.map(t => getTagProficiency(cid, studentId, t.id)).filter(p => p > 0);
  if (profs.length === 0) return 0;
  const calculated = profs.reduce((a,b) => a+b, 0) / profs.length;
  // Check for teacher override
  const overrides = getOverrides(cid);
  const override = overrides[studentId]?.[sectionId];
  if (override && override.level > 0) return override.level;
  return calculated;
}

/** Calculate section proficiency ignoring any teacher overrides, for use in override UI display.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} sectionId - Section ID
 * @returns {number} Calculated proficiency level (0-4), or 0 if no evidence
 */
function getSectionProficiencyRaw(cid, studentId, sectionId) {
  const section = getSections(cid).find(s => s.id === sectionId);
  if (!section) return 0;
  const profs = section.tags.map(t => getTagProficiency(cid, studentId, t.id)).filter(p => p > 0);
  if (profs.length === 0) return 0;
  return profs.reduce((a,b) => a+b, 0) / profs.length;
}

/** Get the teacher override for a section, if one exists.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} sectionId - Section ID
 * @returns {?{level: number, reason: string, date: string, calculated: number}} Override object or null
 */
function getSectionOverride(cid, studentId, sectionId) {
  const overrides = getOverrides(cid);
  return overrides[studentId]?.[sectionId] || null;
}

/** Set or clear a teacher override for a section's proficiency level.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} sectionId - Section ID
 * @param {number} level - Override proficiency level (0 to clear)
 * @param {string} reason - Justification for the override
 * @returns {void}
 */
function setSectionOverride(cid, studentId, sectionId, level, reason) {
  const overrides = getOverrides(cid);
  if (!overrides[studentId]) overrides[studentId] = {};
  if (level > 0 && reason) {
    const raw = getSectionProficiencyRaw(cid, studentId, sectionId);
    overrides[studentId][sectionId] = {
      level: level,
      reason: reason,
      date: new Date().toISOString().slice(0, 10),
      calculated: Math.round(raw * 10) / 10
    };
  } else {
    delete overrides[studentId][sectionId];
    if (Object.keys(overrides[studentId]).length === 0) delete overrides[studentId];
  }
  saveOverrides(cid, overrides);
}

/** Calculate the averaged proficiency for a competency group.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} groupId - Competency group ID
 * @returns {number} Group proficiency (0-4), or 0 if no evidence
 */
function getGroupProficiency(cid, studentId, groupId) {
  const grouped = getGroupedSections(cid);
  const gi = grouped.groups.find(g => g.group.id === groupId);
  if (!gi || gi.sections.length === 0) return 0;
  const profs = gi.sections.map(s => getSectionProficiency(cid, studentId, s.id)).filter(p => p > 0);
  if (profs.length === 0) return 0;
  return profs.reduce((a,b) => a+b, 0) / profs.length;
}

/** Calculate overall proficiency — group-aware when competency groups exist.
 * Each group's sections are averaged into a single value; ungrouped sections count individually.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @returns {number} Overall proficiency (0-4), or 0 if no evidence
 */
function getOverallProficiency(cid, studentId) {
  const grouped = getGroupedSections(cid);
  const hasGroups = grouped.groups.some(g => g.sections.length > 0);
  if (!hasGroups) {
    // No groups — original behavior: average all sections
    const sections = getSections(cid);
    const profs = sections.map(s => getSectionProficiency(cid, studentId, s.id)).filter(p => p > 0);
    if (profs.length === 0) return 0;
    return profs.reduce((a,b) => a+b, 0) / profs.length;
  }
  // Group-aware: one value per group + one per ungrouped section
  const values = [];
  grouped.groups.forEach(gi => {
    if (gi.sections.length === 0) return;
    const gp = getGroupProficiency(cid, studentId, gi.group.id);
    if (gp > 0) values.push(gp);
  });
  grouped.ungrouped.forEach(sec => {
    const sp = getSectionProficiency(cid, studentId, sec.id);
    if (sp > 0) values.push(sp);
  });
  if (values.length === 0) return 0;
  return values.reduce((a,b) => a+b, 0) / values.length;
}

/** Convert an average proficiency to a letter grade and percentage for PHIL12.
 * @param {number} avgProf - Average proficiency (0-4)
 * @returns {{letter: string, pct: number}} Letter grade and corresponding percentage
 */
function calcLetterGrade(avgProf) {
  if (avgProf >= 3.50) return { letter:'A', pct: Math.min(100, Math.round(86 + (avgProf - 3.50) / 0.50 * 14)) };
  if (avgProf >= 3.00) return { letter:'B', pct: Math.round(73 + (avgProf - 3.00) / 0.50 * 12) };
  if (avgProf >= 2.00) return { letter:'C+', pct: Math.round(60 + (avgProf - 2.00) / 1.00 * 12) };
  if (avgProf >= 1.25) return { letter:'D', pct: Math.round(50 + (avgProf - 1.25) / 0.75 * 9) };
  return { letter:'F', pct: Math.round(avgProf / 1.25 * 50) };
}

/** Determine the trend direction for a section by comparing the two most recent summative scores.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} sectionId - Section ID
 * @returns {'up'|'down'|'flat'} Trend direction
 */
function getSectionTrend(cid, studentId, sectionId) {
  const section = getSections(cid).find(s => s.id === sectionId);
  if (!section) return 'flat';
  // Collect all summative scores across all tags in this section, sorted by date
  const allScores = [];
  section.tags.forEach(tag => {
    getTagScores(cid, studentId, tag.id).filter(s => s.type === 'summative' && s.score > 0)
      .forEach(s => allScores.push(s));
  });
  if (allScores.length < 2) return 'flat';
  allScores.sort((a,b) => (a.date||'').localeCompare(b.date||''));
  const recent = allScores[allScores.length - 1].score;
  const prev = allScores[allScores.length - 2].score;
  if (recent > prev) return 'up';
  if (recent < prev) return 'down';
  return 'flat';
}

/** Count the number of summative score entries across all tags in a section.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} sectionId - Section ID
 * @returns {number} Total summative evidence count
 */
function getSectionEvidenceCount(cid, studentId, sectionId) {
  const section = getSections(cid).find(s => s.id === sectionId);
  if (!section) return 0;
  let count = 0;
  section.tags.forEach(tag => {
    count += getTagScores(cid, studentId, tag.id).filter(s => s.type === 'summative').length;
  });
  return count;
}

/** Get focus areas: tags with no evidence or the lowest proficiency for a student.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {number} [maxItems=3] - Maximum number of focus areas to return
 * @returns {Array<{tag: Object, prof: number, section: Object}>} Sorted array of weakest tags
 */
function getFocusAreas(cid, studentId, maxItems) {
  const tags = getAllTags(cid);
  const scored = tags.map(t => ({ tag: t, prof: getTagProficiency(cid, studentId, t.id), section: getSectionForTag(cid, t.id) }));
  // Tags with no evidence first, then lowest proficiency
  scored.sort((a, b) => {
    if (a.prof === 0 && b.prof === 0) return 0;
    if (a.prof === 0) return -1;
    if (b.prof === 0) return 1;
    return a.prof - b.prof;
  });
  return scored.slice(0, maxItems || 3);
}

/** Calculate the percentage of tags that have at least one summative score.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @returns {number} Completion percentage (0-100)
 */
function getCompletionPct(cid, studentId) {
  const tags = getAllTags(cid);
  if (tags.length === 0) return 0;
  const covered = tags.filter(t => {
    const scores = getTagScores(cid, studentId, t.id);
    return scores.some(s => s.type === 'summative' && s.score > 0);
  }).length;
  return Math.round(covered / tags.length * 100);
}

/** Render an SVG completion ring showing a percentage value.
 * @param {number} pct - Percentage to display (0-100)
 * @param {string} [color] - CSS color for the ring stroke, defaults to --active
 * @returns {string} HTML string containing the SVG ring element
 */
function completionRing(pct, color) {
  const r = 22, c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return `<div class="completion-ring">
    <svg width="56" height="56" viewBox="0 0 56 56">
      <circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="5"/>
      <circle cx="28" cy="28" r="${r}" fill="none" stroke="${color || 'var(--active)'}" stroke-width="5" stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
    </svg>
    <div class="completion-ring-text">${pct}%</div>
  </div>`;
}

/* ── Growth Sparkline Data ────────────────────────────────── */
/** Build chronological growth data for a section by calculating running proficiency at each score date.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} sectionId - Section ID
 * @returns {Array<{date: string, prof: number}>} Chronologically sorted proficiency snapshots
 */
function getSectionGrowthData(cid, studentId, sectionId) {
  const section = getSections(cid).find(s => s.id === sectionId);
  if (!section) return [];
  const cc = getCourseConfig(cid);
  const course = COURSES[cid];
  const method = cc.calcMethod || course.calcMethod || 'mostRecent';
  const dw = cc.decayWeight != null ? cc.decayWeight : (course.decayWeight || 0.65);

  // Collect all summative scores across all tags in this section
  const allScores = [];
  section.tags.forEach(tag => {
    getTagScores(cid, studentId, tag.id)
      .filter(s => s.type === 'summative' && s.score > 0)
      .forEach(s => allScores.push({ ...s, _tagId: tag.id }));
  });
  if (allScores.length === 0) return [];

  // Get unique dates sorted chronologically
  const dates = [...new Set(allScores.map(s => s.date))].sort();

  // Build opts for calcProficiency (matching getTagProficiency pattern)
  const cw = getCategoryWeights(cid);
  const aw = _getAW(cid);
  const opts = { categoryWeights: cw, assessmentWeights: aw };

  // For each date, calculate section proficiency using scores up to that date
  const points = [];
  dates.forEach(date => {
    const scoresUpToDate = allScores.filter(s => s.date <= date);
    // Group by tag, calc each tag's proficiency using only scores up to this date
    const tagProfs = [];
    section.tags.forEach(tag => {
      const tagScores = scoresUpToDate.filter(s => s._tagId === tag.id);
      if (tagScores.length > 0) {
        tagProfs.push(calcProficiency(tagScores, method, dw, opts));
      }
    });
    if (tagProfs.length > 0) {
      const avg = tagProfs.reduce((a,b) => a+b, 0) / tagProfs.length;
      points.push({ date, prof: avg });
    }
  });
  return points;
}

/** Render a CSS-only sparkline as colored dots connected by lines.
 * @param {Array<{date: string, prof: number}>} points - Growth data from getSectionGrowthData
 * @returns {string} HTML string for the sparkline element
 */
function renderGrowthSparkline(points) {
  if (!points || points.length === 0) return '<span style="font-size:0.65rem;color:var(--text-3)">No data yet</span>';
  return `<div class="growth-sparkline">${points.map((p, i) => {
    const color = PROF_COLORS[Math.round(p.prof)] || PROF_COLORS[0];
    return `${i > 0 ? '<span class="sparkline-line"></span>' : ''}<span class="sparkline-dot" style="background:${color}" title="${formatDate(p.date)}: ${PROF_LABELS[Math.round(p.prof)] || '—'}"></span>`;
  }).join('')}</div>`;
}

/* ── Namespace ──────────────────────────────────────────────── */
window.Calc = {
  clearProfCache,
  pointsToProf,
  getCategoryWeights,
  getAssessmentWeight,
  calcProficiency,
  getTagScores,
  getTagProficiency,
  getSectionProficiency,
  getSectionProficiencyRaw,
  getSectionOverride,
  setSectionOverride,
  getGroupProficiency,
  getOverallProficiency,
  calcLetterGrade,
  getSectionTrend,
  getSectionEvidenceCount,
  getFocusAreas,
  getCompletionPct,
  completionRing,
  getSectionGrowthData,
  renderGrowthSparkline,
};
