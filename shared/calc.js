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
var _assessMapCache = {}; // cid → Map<assessmentId, assessment> — avoids O(n) find per score
var _sectionByIdCache = {}; // cid → Map<sectionId, section>      — avoids repeated getSections().find()
var _assessmentOverallCache = {};
var _categoryAvgCache = {};
var _courseLetterCache = {};

/** Clear all proficiency caches. Call when scores, assessments, overrides, or statuses change. */
function clearProfCache() {
  _tagScoresCache = {};
  _tagProfCache = {};
  _awCache = {};
  _assessMapCache = {};
  _sectionByIdCache = {};
  _assessmentOverallCache = {};
  _categoryAvgCache = {};
  _courseLetterCache = {};
}

/** Get or build assessment weights map for a course. */
function _getAW(cid) {
  if (_awCache[cid]) return _awCache[cid];
  var assessments = getAssessments(cid);
  var aw = {};
  assessments.forEach(function (a) {
    aw[a.id] = a.weight || 1;
  });
  _awCache[cid] = aw;
  return aw;
}

/** Get or build a Map<assessmentId, assessment> for O(1) lookups instead of O(n) find(). */
function _getAssessMap(cid) {
  if (_assessMapCache[cid]) return _assessMapCache[cid];
  var m = new Map(
    getAssessments(cid).map(function (a) {
      return [a.id, a];
    }),
  );
  _assessMapCache[cid] = m;
  return m;
}

/** Get a section by id using a cached Map — avoids repeated getSections().find() in hot loops. */
function _getSectionById(cid, sectionId) {
  if (!_sectionByIdCache[cid]) {
    _sectionByIdCache[cid] = new Map(
      getSections(cid).map(function (s) {
        return [s.id, s];
      }),
    );
  }
  return _sectionByIdCache[cid].get(sectionId);
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
function getAssessmentWeight(assessment) {
  return assessment.weight || 1;
}

function _scoreBucket(score, opts) {
  if (opts && typeof opts.getScoreBucket === 'function') return opts.getScoreBucket(score);
  if (score && (score.categoryId || score.category_id)) return 'categorized';
  return score && score.type === 'formative' ? 'uncategorized' : 'categorized';
}

function _isScoredEvidence(score) {
  return !!(score && Number(score.score) > 0);
}

function courseShowsLetterGrades(course) {
  return !!course && (course.gradingSystem === 'letter' || course.gradingSystem === 'both');
}

function _normalizeAssessmentEntryValue(assessment, rawScore) {
  if (rawScore == null || rawScore === '') return null;
  var num = Number(rawScore);
  if (!isFinite(num)) return null;
  if (isPointsScored(assessment) && assessment.maxPoints > 0) {
    return Math.max(0, Math.min(4, (num / assessment.maxPoints) * 4));
  }
  return num;
}

/* A rubric level's value on one criterion: its custom point value, or the
   level itself. A + or − moves a third of the way to the next level's value,
   as fv_rubric_level_value does on the server. Null for anything but 1–4
   (0 is a cleared score). */
function _rubricLevelValue(criterion, level, mod) {
  var n = Number(level);
  if (!(n === 1 || n === 2 || n === 3 || n === 4)) return null;
  var custom = (criterion && criterion.levelValues) || {};
  function valueOf(l) {
    var v = custom[l] != null && custom[l] !== '' ? Number(custom[l]) : NaN;
    return isFinite(v) ? v : l;
  }
  var value = valueOf(n);
  var m = normalizeScoreMod(n, mod);
  if (m > 0) return value + (valueOf(n + 1) - value) * SCORE_MOD_STEP;
  if (m < 0) return value - (value - valueOf(n - 1)) * SCORE_MOD_STEP;
  return value;
}

// A criterion's top value: the most any level is worth (4 by default).
function _rubricCriterionMax(criterion) {
  var max = 0;
  [1, 2, 3, 4].forEach(function (l) {
    var v = _rubricLevelValue(criterion, l, 0);
    if (v > max) max = v;
  });
  return max;
}

function _rubricCriterionWeight(criterion) {
  var weight = criterion.weight == null || criterion.weight === '' ? 1 : Number(criterion.weight);
  return isFinite(weight) && weight >= 0 ? weight : 1;
}

/* A rubric assessment's scored criteria: { value, max, weight } each, where
   value is the average of the criterion's competency scores in its own
   points. Undefined when the assessment isn't rubric-scored, null when no
   criterion is scored. When every criterion weighs 0 they count equally. */
function _rubricScoredCriteria(cid, assessment, entries) {
  var rubricId = assessment && (assessment.rubricId || assessment.rubric_id);
  if (!rubricId || isPointsScored(assessment) || typeof getRubricById !== 'function') return undefined;
  var rubric = getRubricById(cid, rubricId);
  var criteria = (rubric && rubric.criteria) || [];
  if (criteria.length === 0) return undefined;

  var scored = [];
  criteria.forEach(function (criterion) {
    if (!criterion) return;
    // A criterion with no competencies stores its score under its own id.
    var tagIds = rubricCriterionScoreKeys(criterion);
    var values = (entries || [])
      .filter(function (entry) {
        return entry.assessmentId === assessment.id && tagIds.indexOf(entry.tagId) >= 0;
      })
      .map(function (entry) {
        return _rubricLevelValue(criterion, entry.score, entry.mod);
      })
      .filter(function (value) {
        return value != null;
      });
    if (values.length === 0) return;
    var avg =
      values.reduce(function (sum, value) {
        return sum + value;
      }, 0) / values.length;
    scored.push({ value: avg, max: _rubricCriterionMax(criterion), weight: _rubricCriterionWeight(criterion) });
  });
  if (scored.length === 0) return null;
  var totalWeight = scored.reduce(function (sum, c) {
    return sum + c.weight;
  }, 0);
  if (!(totalWeight > 0))
    scored.forEach(function (c) {
      c.weight = 1;
    });
  return scored;
}

/* A rubric assessment's overall on the 0–4 scale (read-paths §1.1,
   fv_assessment_overall on the server). Scores are stored per competency,
   so each criterion is the average of its competencies' scores and counts
   once, as a share of its top value (6 of 10 points = 2.4). Criteria combine
   by weight; unscored criteria and weight-0 criteria are left out (all
   scored criteria at 0 count equally). `entries` may hold the student's
   other scores too. Statuses are not applied. Returns null when no criterion
   is scored, and undefined when the assessment isn't rubric-scored, so the
   caller averages its entries as before. */
function getRubricAssessmentScore(cid, assessment, entries) {
  var scored = _rubricScoredCriteria(cid, assessment, entries);
  if (!scored) return scored;
  var totalWeight = 0;
  var weightedSum = 0;
  scored.forEach(function (c) {
    totalWeight += c.weight;
    weightedSum += c.weight * (c.max > 0 ? (c.value / c.max) * 4 : 0);
  });
  return Math.max(0, Math.min(4, weightedSum / totalWeight));
}

/* A rubric assessment's points for one student, for the course %: each
   scored criterion's value out of its top value, times its weight. Excused
   is null; not submitted is 0 out of every criterion's top value.
   Undefined when the assessment isn't rubric-scored. */
function _rubricAssessmentPoints(cid, studentId, assessment) {
  var entries = (getScores(cid)[studentId] || []).filter(function (entry) {
    return entry.assessmentId === assessment.id;
  });
  var scored = _rubricScoredCriteria(cid, assessment, entries);
  if (scored === undefined) return undefined;
  var status = getAssignmentStatus(cid, studentId, assessment.id);
  if (status === 'EXC') return null;
  if (status === 'NS') {
    var criteria = getRubricById(cid, assessment.rubricId || assessment.rubric_id).criteria.filter(Boolean);
    var weights = criteria.map(_rubricCriterionWeight);
    var anyWeight = weights.some(function (w) {
      return w > 0;
    });
    var full = criteria.reduce(function (sum, c, i) {
      return sum + (anyWeight ? weights[i] : 1) * _rubricCriterionMax(c);
    }, 0);
    return full > 0 ? { earned: 0, possible: full } : null;
  }
  if (!scored) return null;
  var earned = 0;
  var possible = 0;
  scored.forEach(function (c) {
    earned += c.weight * c.value;
    possible += c.weight * c.max;
  });
  return possible > 0 ? { earned: earned, possible: possible } : null;
}

function getAssessmentOverallScore(cid, studentId, assessmentId) {
  var cacheKey = cid + ':' + studentId + ':' + assessmentId;
  if (_assessmentOverallCache[cacheKey] !== undefined) return _assessmentOverallCache[cacheKey];

  var assessment = _getAssessMap(cid).get(assessmentId);
  if (!assessment) {
    _assessmentOverallCache[cacheKey] = null;
    return null;
  }

  var status = getAssignmentStatus(cid, studentId, assessmentId);
  // Status enum matches the server CHECK constraint on set_score_status:
  // 'NS' | 'EXC' | 'LATE'. Long-form desktop-era values are rewritten by
  // _migrateAssignmentStatusFormat() on boot.
  if (status === 'EXC') {
    _assessmentOverallCache[cacheKey] = null;
    return null;
  }
  if (status === 'NS') {
    _assessmentOverallCache[cacheKey] = 0;
    return 0;
  }

  var entries = (getScores(cid)[studentId] || []).filter(function (entry) {
    return entry.assessmentId === assessmentId;
  });
  var rubricResult = getRubricAssessmentScore(cid, assessment, entries);
  if (rubricResult !== undefined) {
    _assessmentOverallCache[cacheKey] = rubricResult;
    return rubricResult;
  }

  // A leftover overall score (from before the assessment was linked to a
  // competency) must not count beside the new scores.
  var countsOverallKey = isPointsScored(assessment) || isUnlinkedTag(scoreTagIds(assessment, cid)[0]);
  var values = entries
    .filter(function (entry) {
      return countsOverallKey || !isUnlinkedTag(entry.tagId);
    })
    .map(function (entry) {
      // A proficiency level counts with its + or − (3+ = 3.33).
      var raw = isPointsScored(assessment) ? entry.score : entry.score > 0 ? scoreModValue(entry) : entry.score;
      return _normalizeAssessmentEntryValue(assessment, raw);
    })
    .filter(function (value) {
      return value != null;
    });

  if (values.length === 0) {
    _assessmentOverallCache[cacheKey] = null;
    return null;
  }

  var result =
    values.reduce(function (sum, value) {
      return sum + value;
    }, 0) / values.length;
  _assessmentOverallCache[cacheKey] = result;
  return result;
}

function getCategoryAverage(cid, studentId, categoryId) {
  var cacheKey = cid + ':' + studentId + ':' + categoryId;
  if (_categoryAvgCache[cacheKey] !== undefined) return _categoryAvgCache[cacheKey];

  var values = getAssessments(cid)
    .filter(function (assessment) {
      return (assessment.categoryId || assessment.category_id || null) === categoryId;
    })
    .map(function (assessment) {
      return getAssessmentOverallScore(cid, studentId, assessment.id);
    })
    .filter(function (value) {
      return value != null;
    });

  if (values.length === 0) {
    _categoryAvgCache[cacheKey] = null;
    return null;
  }

  var result =
    values.reduce(function (sum, value) {
      return sum + value;
    }, 0) / values.length;
  _categoryAvgCache[cacheKey] = result;
  return result;
}

function qToPercentage(Q) {
  if (Q == null) return null;
  if (Q <= 0) return 0;
  if (Q <= 2) return 55 + (Q - 1) * 13;
  if (Q <= 3) return 68 + (Q - 2) * 14;
  return Math.min(100, 82 + (Q - 3) * 14);
}

function percentageToLetter(R) {
  if (R == null) return null;
  if (R >= 86) return 'A';
  if (R >= 73) return 'B';
  if (R >= 67) return 'C+';
  if (R >= 60) return 'C';
  if (R >= 50) return 'C-';
  return 'F';
}

/* A points-scored assessment's points for one student, or null when it
   doesn't count: excused, or not graded yet. Not submitted counts as 0.
   Points work can earn extra credit up to twice its maximum. */
function _assessmentPoints(cid, studentId, assessment) {
  var status = getAssignmentStatus(cid, studentId, assessment.id);
  if (status === 'EXC') return null;
  var possible = isCompletionScored(assessment) ? COMPLETE_MAX_POINTS : Number(assessment.maxPoints) || 0;
  if (!(possible > 0)) return null;
  if (status === 'NS') return { earned: 0, possible: possible };
  var entry = (getScores(cid)[studentId] || []).find(function (e) {
    return e.assessmentId === assessment.id && e.score != null && e.score !== '';
  });
  if (!isScoreEntered(assessment, entry)) return null;
  var cap = isCompletionScored(assessment) ? possible : possible * POINTS_EXTRA_CREDIT_FACTOR;
  return { earned: Math.max(0, Math.min(cap, Number(entry.score) || 0)), possible: possible };
}

/* A student's percentage on a group of assessments (one category, or the
   whole class when it has none), counted like a traditional gradebook:
   points earned out of points possible. Points-scored work counts its own
   points, so 2.75/6 + 14.25/24 is 17/30 = 56.7%. Rubric work counts its
   criteria's points, like Schoology and Teams (four 4-point criteria = 16).
   A proficiency level counts as that many points out of 4 (3 = 75%,
   3+ = 83.3%). Returns { pct, count }
   (count = graded assessments), or null when nothing in the group is graded. */
function getAssessmentGroupPercentage(cid, studentId, assessments) {
  var earned = 0;
  var possible = 0;
  var count = 0;
  (assessments || []).forEach(function (assessment) {
    if (isPointsScored(assessment)) {
      var pts = _assessmentPoints(cid, studentId, assessment);
      if (!pts) return;
      earned += pts.earned;
      possible += pts.possible;
    } else {
      // Rubric work counts its own points (6 of 10 = 60%), not a level.
      var rubricPts = _rubricAssessmentPoints(cid, studentId, assessment);
      if (rubricPts !== undefined) {
        if (!rubricPts) return;
        earned += rubricPts.earned;
        possible += rubricPts.possible;
        count++;
        return;
      }
      var level = getAssessmentOverallScore(cid, studentId, assessment.id);
      if (level == null) return;
      earned += Math.max(0, Math.min(4, level));
      possible += 4;
    }
    count++;
  });
  return count > 0 && possible > 0 ? { pct: (earned / possible) * 100, count: count } : null;
}

function getCourseLetterData(cid, studentId) {
  var cacheKey = cid + ':' + studentId;
  if (_courseLetterCache[cacheKey]) return _courseLetterCache[cacheKey];

  var categories = getCategories(cid) || [];
  var assessments = getAssessments(cid);
  var Q = null;
  var R = null;

  if (categories.length > 0) {
    var weightedSum = 0;
    var weightTotal = 0;
    var pctSum = 0;
    var pctWeight = 0;
    categories.forEach(function (category) {
      var weight = Number(category.weight || 0);
      var avg = getCategoryAverage(cid, studentId, category.id);
      if (avg != null) {
        weightedSum += weight * avg;
        weightTotal += weight;
      }
      var pct = getAssessmentGroupPercentage(
        cid,
        studentId,
        assessments.filter(function (assessment) {
          return (assessment.categoryId || assessment.category_id || null) === category.id;
        }),
      );
      if (pct == null) return;
      pctSum += weight * pct.pct;
      pctWeight += weight;
    });
    if (weightTotal > 0) Q = weightedSum / weightTotal;
    if (pctWeight > 0) R = pctSum / pctWeight;
  } else {
    var values = getAssessments(cid)
      .map(function (assessment) {
        return getAssessmentOverallScore(cid, studentId, assessment.id);
      })
      .filter(function (value) {
        return value != null;
      });
    if (values.length > 0) {
      Q =
        values.reduce(function (sum, value) {
          return sum + value;
        }, 0) / values.length;
    }
    var all = getAssessmentGroupPercentage(cid, studentId, assessments);
    if (all) R = all.pct;
  }

  // The letter comes from the % as shown, so 85.95 shows as 86% and an A.
  // toPrecision drops float noise (85.94999…) before rounding.
  var shown = R == null ? null : Math.round(Number((R * 10).toPrecision(12))) / 10;
  var result = {
    Q: Q,
    R: shown,
    S: percentageToLetter(shown),
  };
  _courseLetterCache[cacheKey] = result;
  return result;
}

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
  valid.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  switch (method) {
    case 'mostRecent':
      return valid[valid.length - 1].score;
    case 'highest':
      return Math.max(...valid.map(s => s.score)); // safe: valid.length > 0 guaranteed by guard on line 79
    case 'average': {
      // Weighted mean — every valid score contributes equally by default; per-assessment weights scale contributions.
      let sum = 0,
        weightSum = 0;
      valid.forEach(s => {
        const w = (assessmentWeights && assessmentWeights[s.assessmentId]) || 1;
        sum += s.score * w;
        weightSum += w;
      });
      return weightSum > 0 ? Math.round(sum / weightSum) : 0;
    }
    case 'median': {
      // Sorted-middle — robust against one unusually low/high score.
      // Tie-break on even-length lists: take the higher of the two middles
      // (matches the "cleanest-recent" spirit of FullVision's mode + decay semantics).
      const sorted = valid.map(s => s.score).sort((a, b) => a - b);
      const n = sorted.length;
      if (n % 2 === 1) return sorted[(n - 1) / 2];
      return Math.round((sorted[n / 2 - 1] + sorted[n / 2]) / 2);
    }
    case 'mode': {
      const freq = {};
      valid.forEach(s => {
        const w = (assessmentWeights && assessmentWeights[s.assessmentId]) || 1;
        freq[s.score] = (freq[s.score] || 0) + w;
      });
      const maxFreq = Math.max(...Object.values(freq)); // safe: freq is non-empty since valid.length > 0
      const modes = Object.keys(freq)
        .filter(k => freq[k] === maxFreq)
        .map(Number);
      if (modes.length === 1) return modes[0];
      for (let i = valid.length - 1; i >= 0; i--) {
        if (modes.includes(valid[i].score)) return valid[i].score;
      }
      return modes[0];
    }
    case 'decayingAvg': {
      const dw = Math.max(0.01, Math.min(1, decayWeight || 0.65));
      let avg = valid[0].score;
      for (let i = 1; i < valid.length; i++) {
        const w = (assessmentWeights && assessmentWeights[valid[i].assessmentId]) || 1;
        const denom = 1 - dw + dw * w;
        avg = (avg * (1 - dw) + valid[i].score * dw * w) / denom;
      }
      return Math.round(avg);
    }
    default:
      return valid[valid.length - 1].score;
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
  const categorized = scores.filter(s => _scoreBucket(s, opts) === 'categorized');
  const uncategorized = scores.filter(s => _scoreBucket(s, opts) !== 'categorized');

  const summProf = _calcGroup(categorized, method, decayWeight, aw);
  const uncategorizedProf = _calcGroup(uncategorized, method, decayWeight, aw);

  // If no category weights or formative weight is 0, behave as before
  if (!cw || !cw.formative || cw.formative <= 0) return summProf || uncategorizedProf;

  const formProf = uncategorizedProf;
  if (formProf === 0) return summProf; // no formative evidence, use summative only
  if (summProf === 0) return formProf; // no summative evidence, use formative only

  const summW = Number(cw.summative) || 0;
  const formW = Number(cw.formative) || 0;
  const weightTotal = summW + formW;
  if (weightTotal <= 0) return summProf || formProf || 0;
  const raw = (summProf * summW + formProf * formW) / weightTotal;
  return Math.min(4, Math.round(raw));
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
    if (status === 'EXC') return false;
    return true;
  });
  // Convert points-mode scores to proficiency
  // Use Map for O(1) lookup instead of O(n) find() per score entry
  const assessMap = _getAssessMap(cid);
  const scale = getGradingScale(cid);
  var result = filtered.map(s => {
    const assess = assessMap.get(s.assessmentId);
    if (isPointsScored(assess) && assess.maxPoints > 0) {
      // A points 0 is a score: 0% is the lowest level, like Incomplete.
      if (!isScoreEntered(assess, s)) return { ...s, rawPoints: s.score, score: 0 };
      return { ...s, rawPoints: s.score, score: pointsToProf(s.score, assess.maxPoints, scale) };
    }
    // A + or − counts in every calculation (3+ = 3.33). `level` keeps the
    // whole-number level for display.
    if (s.score > 0 && normalizeScoreMod(s.score, s.mod)) {
      return { ...s, level: s.score, score: scoreModValue(s) };
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
  const dw = cc.decayWeight != null ? cc.decayWeight : course.decayWeight || 0.65;
  const scores = getTagScores(cid, studentId, tagId);
  const cw = getCategoryWeights(cid);
  const aw = _getAW(cid);
  var assessMap = _getAssessMap(cid);
  var result = calcProficiency(scores, method, dw, {
    categoryWeights: cw,
    assessmentWeights: aw,
    getScoreBucket: function (score) {
      var assessment = assessMap.get(score.assessmentId);
      if (!assessment) return score && score.type === 'formative' ? 'uncategorized' : 'categorized';
      if (assessment.categoryId || assessment.category_id) return 'categorized';
      return assessment.type === 'formative' ? 'uncategorized' : 'categorized';
    },
  });
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
  const section = _getSectionById(cid, sectionId);
  if (!section) return 0;
  const profs = section.tags.map(t => getTagProficiency(cid, studentId, t.id)).filter(p => p > 0);
  if (profs.length === 0) return 0;
  const calculated = profs.reduce((a, b) => a + b, 0) / profs.length;
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
  const section = _getSectionById(cid, sectionId);
  if (!section) return 0;
  const profs = section.tags.map(t => getTagProficiency(cid, studentId, t.id)).filter(p => p > 0);
  if (profs.length === 0) return 0;
  return profs.reduce((a, b) => a + b, 0) / profs.length;
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
      date: typeof courseToday === 'function' ? courseToday(cid) : new Date().toISOString().slice(0, 10),
      calculated: Math.round(raw * 10) / 10,
    };
  } else {
    delete overrides[studentId][sectionId];
    if (Object.keys(overrides[studentId]).length === 0) delete overrides[studentId];
  }
  saveOverrides(cid, overrides);
  if (window.v2 && _isUuid && _isUuid(studentId)) {
    if (level > 0 && reason) window.v2.saveSectionOverride(studentId, sectionId, level, reason);
    else window.v2.clearSectionOverride(studentId, sectionId);
  }
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
  return profs.reduce((a, b) => a + b, 0) / profs.length;
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
    return profs.reduce((a, b) => a + b, 0) / profs.length;
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
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Convert an average proficiency to a letter grade and percentage for PHIL12.
 * @param {number} avgProf - Average proficiency (0-4)
 * @returns {{letter: string, pct: number}} Letter grade and corresponding percentage
 */
function calcLetterGrade(avgProf) {
  var pct = qToPercentage(avgProf);
  return { letter: percentageToLetter(pct), pct: pct == null ? null : Math.round(pct * 10) / 10 };
}

/** Determine the trend direction for a section by comparing the two most recent summative scores.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} sectionId - Section ID
 * @returns {'up'|'down'|'flat'} Trend direction
 */
function getSectionTrend(cid, studentId, sectionId) {
  const section = _getSectionById(cid, sectionId);
  if (!section) return 'flat';
  // Compare the two most recent scored evidence entries for the section.
  const allScores = [];
  section.tags.forEach(tag => {
    getTagScores(cid, studentId, tag.id)
      .filter(_isScoredEvidence)
      .forEach(s => allScores.push(s));
  });
  if (allScores.length < 2) return 'flat';
  allScores.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const recent = allScores[allScores.length - 1].score;
  const prev = allScores[allScores.length - 2].score;
  if (recent > prev) return 'up';
  if (recent < prev) return 'down';
  return 'flat';
}

/** Count the number of scored evidence entries across all tags in a section.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} sectionId - Section ID
 * @returns {number} Total evidence count
 */
function getSectionEvidenceCount(cid, studentId, sectionId) {
  const section = _getSectionById(cid, sectionId);
  if (!section) return 0;
  let count = 0;
  section.tags.forEach(tag => {
    count += getTagScores(cid, studentId, tag.id).filter(_isScoredEvidence).length;
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
  const scored = tags.map(t => ({
    tag: t,
    prof: getTagProficiency(cid, studentId, t.id),
    section: getSectionForTag(cid, t.id),
  }));
  // Tags with no evidence first, then lowest proficiency
  scored.sort((a, b) => {
    if (a.prof === 0 && b.prof === 0) return 0;
    if (a.prof === 0) return -1;
    if (b.prof === 0) return 1;
    return a.prof - b.prof;
  });
  return scored.slice(0, maxItems || 3);
}

/** Calculate the percentage of tags that have at least one scored evidence entry.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @returns {number} Completion percentage (0-100)
 */
function getCompletionPct(cid, studentId) {
  const tags = getAllTags(cid);
  if (tags.length === 0) return 0;
  const covered = tags.filter(t => {
    const scores = getTagScores(cid, studentId, t.id);
    return scores.some(_isScoredEvidence);
  }).length;
  return Math.round((covered / tags.length) * 100);
}

/** Render an SVG completion ring showing a percentage value.
 * @param {number} pct - Percentage to display (0-100)
 * @param {string} [color] - CSS color for the ring stroke, defaults to --active
 * @returns {string} HTML string containing the SVG ring element
 */
function completionRing(pct, color) {
  const r = 22,
    c = 2 * Math.PI * r;
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
  const section = _getSectionById(cid, sectionId);
  if (!section) return [];
  const cc = getCourseConfig(cid);
  const course = COURSES[cid];
  const method = cc.calcMethod || course.calcMethod || 'mostRecent';
  const dw = cc.decayWeight != null ? cc.decayWeight : course.decayWeight || 0.65;

  // Collect all scored evidence across all tags in this section.
  const allScores = [];
  section.tags.forEach(tag => {
    getTagScores(cid, studentId, tag.id)
      .filter(_isScoredEvidence)
      .forEach(s => allScores.push({ ...s, _tagId: tag.id }));
  });
  if (allScores.length === 0) return [];

  // Get unique dates sorted chronologically
  const dates = [...new Set(allScores.map(s => s.date))].sort();

  // Build opts for calcProficiency (matching getTagProficiency pattern)
  const cw = getCategoryWeights(cid);
  const aw = _getAW(cid);
  const opts = { categoryWeights: cw, assessmentWeights: aw };

  // Sort allScores once by date, then use a running pointer — O(n) instead of O(n²).
  // For each date, advance the pointer to include all scores up to that date,
  // accumulating them into a per-tag Map so grouping is also O(1) per score.
  allScores.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const runningByTag = new Map(section.tags.map(t => [t.id, []]));
  let ri = 0;

  const points = [];
  dates.forEach(date => {
    // Advance running pointer: include all scores with date <= current date
    while (ri < allScores.length && allScores[ri].date <= date) {
      const s = allScores[ri++];
      const bucket = runningByTag.get(s._tagId);
      if (bucket) bucket.push(s);
    }
    // Calc each tag's proficiency from its accumulated scores
    const tagProfs = [];
    section.tags.forEach(tag => {
      const tagScores = runningByTag.get(tag.id);
      if (tagScores && tagScores.length > 0) {
        tagProfs.push(calcProficiency(tagScores, method, dw, opts));
      }
    });
    if (tagProfs.length > 0) {
      const avg = tagProfs.reduce((a, b) => a + b, 0) / tagProfs.length;
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
  return `<div class="growth-sparkline">${points
    .map((p, i) => {
      const color = PROF_COLORS[Math.round(p.prof)] || PROF_COLORS[0];
      return `${i > 0 ? '<span class="sparkline-line"></span>' : ''}<span class="sparkline-dot" style="background:${color}" title="${formatDate(p.date)}: ${PROF_LABELS[Math.round(p.prof)] || '—'}"></span>`;
    })
    .join('')}</div>`;
}

/* ── Namespace ──────────────────────────────────────────────── */
window.Calc = {
  clearProfCache,
  courseShowsLetterGrades,
  pointsToProf,
  getCategoryWeights,
  getAssessmentWeight,
  getAssessmentOverallScore,
  getRubricAssessmentScore,
  getCategoryAverage,
  qToPercentage,
  percentageToLetter,
  getCourseLetterData,
  getAssessmentGroupPercentage,
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
