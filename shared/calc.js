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

/* ── Reporting term scope ──────────────────────────────────────
   A class can be viewed in one reporting term (docs/DECISIONS.md,
   "Reporting periods"). While a term is active for a class, every grade
   counts only the assessments whose assigned date falls inside it. With no
   term active (the default, "All time") nothing here changes a result.
   Cache keys carry the term, so switching terms never needs a cache clear. */
var _activeTerm = {}; // cid → { ordinal, label, startsOn, endsOn } | undefined

/** Make one reporting term (by ordinal) the scope for a class, or null for all time. */
function setActiveTerm(cid, ordinal) {
  if (ordinal == null || ordinal === '' || ordinal === 'all') {
    delete _activeTerm[cid];
    return null;
  }
  var terms = typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [];
  var term = terms.find(function (t) {
    return Number(t.ordinal) === Number(ordinal);
  });
  if (!term) {
    delete _activeTerm[cid];
    return null;
  }
  _activeTerm[cid] = {
    ordinal: Number(term.ordinal),
    label: term.label,
    startsOn: term.startsOn || term.starts_on,
    endsOn: term.endsOn || term.ends_on,
  };
  return _activeTerm[cid];
}

/** The reporting term a class is being viewed in, or null for all time. */
function getActiveTerm(cid) {
  return _activeTerm[cid] || null;
}

/** Apply the term the teacher last chose for this class on this device. */
function activateSavedTerm(cid) {
  var saved = typeof getSelectedTermOrdinal === 'function' ? getSelectedTermOrdinal(cid) : null;
  return setActiveTerm(cid, saved);
}

function _termKey(cid) {
  var t = _activeTerm[cid];
  return t ? '@' + t.ordinal : '';
}

/* Cache key prefix for a class: the class id plus the active term. */
function _ck(cid) {
  return cid + _termKey(cid);
}

function _assessmentDate(a) {
  return (a && (a.date || a.dateAssigned || a.assigned_at || a.date_assigned)) || '';
}

/** Whether an assessment is dated inside the active term (true when no term is active). */
function assessmentInActiveTerm(cid, a) {
  var t = _activeTerm[cid];
  if (!t) return true;
  var d = _assessmentDate(a);
  if (!d) return false;
  return d >= t.startsOn && d <= t.endsOn;
}

/* The class's assessments inside the active term; all of them when none is active. */
function _scopedAssessments(cid) {
  var all = getAssessments(cid);
  if (!_activeTerm[cid]) return all;
  return all.filter(function (a) {
    return assessmentInActiveTerm(cid, a);
  });
}

/** Assessments the active term leaves out because they have no date. */
function undatedAssessmentCount(cid) {
  if (!_activeTerm[cid]) return 0;
  return getAssessments(cid).filter(function (a) {
    return !_assessmentDate(a);
  }).length;
}

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
  var key = _ck(cid);
  if (_awCache[key]) return _awCache[key];
  var assessments = _scopedAssessments(cid);
  var aw = {};
  assessments.forEach(function (a) {
    aw[a.id] = getAssessmentWeight(a);
  });
  _awCache[key] = aw;
  return aw;
}

/** Get or build a Map<assessmentId, assessment> for O(1) lookups instead of O(n) find().
 * Holds only the assessments in the active term, so an id missing here is out of scope. */
function _getAssessMap(cid) {
  var key = _ck(cid);
  if (_assessMapCache[key]) return _assessMapCache[key];
  var m = new Map(
    _scopedAssessments(cid).map(function (a) {
      return [a.id, a];
    }),
  );
  _assessMapCache[key] = m;
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
/** Get the proficiency weight multiplier for an assessment. Points and
 * Complete/Incomplete work always counts 1: the control is hidden there, as
 * in Schoology and Teams, where a teacher changes max points instead.
 * @param {Object} assessment - Assessment object
 * @param {number} [assessment.weight] - Weight value, defaults to 1
 * @returns {number} Assessment weight
 */
function getAssessmentWeight(assessment) {
  if (!assessment || isPointsScored(assessment)) return 1;
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

/* A competency removed from the class (section.removed_at) keeps its scores
   so it can come back, but they stop counting: only the class's own
   competencies count toward an assessment and the course % (Colin,
   2026-10-22). A class with no competencies yet removes nothing. */
function _isRemovedCompetency(cid, tagId) {
  return !isUnlinkedTag(tagId) && getAllTags(cid).length > 0 && !getSectionForTag(cid, tagId);
}

function getAssessmentOverallScore(cid, studentId, assessmentId) {
  var cacheKey = _ck(cid) + ':' + studentId + ':' + assessmentId;
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
  // A removed competency's scores don't count; a points score is one number
  // for the assessment, so it always does.
  var points = isPointsScored(assessment);
  var values = entries
    .filter(function (entry) {
      if (!points && _isRemovedCompetency(cid, entry.tagId)) return false;
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
  var cacheKey = _ck(cid) + ':' + studentId + ':' + categoryId;
  if (_categoryAvgCache[cacheKey] !== undefined) return _categoryAvgCache[cacheKey];

  var values = _scopedAssessments(cid)
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

/* ── Class Averages ───────────────────────────────────────────
   One rule for what each student counts for in a gradebook column, used by
   every Class Average: the Competencies view, the printed grade sheet and
   the CSV export. A status counts as it does in the student's own grade for
   that kind of work (Colin, 2026-10-22):
   - Points and Complete/Incomplete work, as in the course %: Excused is
     left out, Not Submitted counts as 0 (_assessmentPoints,
     getAssessmentOverallScore follow the same rule).
   - Proficiency work, as in competency proficiency: Excused and Not
     Submitted are both left out. Missing work is no evidence, not a level
     of 0; the BC proficiency scale has none.
   Students without a score are left out. */
var COLUMN_STATUS_RULES = {
  points: { EXC: 'out', NS: 'zero' },
  proficiency: { EXC: 'out', NS: 'out' },
};

/* What one student counts for in one column, or null when they don't.
   `col.assessment` is the assessment. `col.tagIds` narrows it to one
   competency, or a rubric criterion's competencies (each student's value is
   the mean of their scores on them). `col.measure: 'level'` reads points
   work as a proficiency, as the printed sheet can. Returns { value } (a
   level), or { earned, possible } for points work read as points. */
function columnCountedValue(cid, sid, col) {
  var a = col.assessment;
  if (!a) return null;
  var status = getAssignmentStatus(cid, sid, a.id);
  if (isPointsScored(a)) {
    var pointsRule = COLUMN_STATUS_RULES.points[status];
    if (pointsRule === 'out') return null;
    if (col.measure === 'level') {
      var level = pointsRule === 'zero' ? 0 : getAssessmentOverallScore(cid, sid, a.id);
      return level == null ? null : { value: level };
    }
    return _assessmentPoints(cid, sid, a);
  }
  if (COLUMN_STATUS_RULES.proficiency[status] === 'out') return null;
  if (col.tagIds && col.tagIds.length) {
    var entries = getScores(cid)[sid] || [];
    var vals = [];
    col.tagIds.forEach(function (key) {
      var entry = entries.find(function (e) {
        return e.assessmentId === a.id && e.tagId === key;
      });
      if (entry && entry.score > 0) vals.push(scoreModValue(entry));
    });
    if (!vals.length) return null;
    return {
      value:
        vals.reduce(function (x, y) {
          return x + y;
        }, 0) / vals.length,
    };
  }
  var cell = assessmentCellValue(cid, sid, a);
  return cell.kind === 'level' ? { value: cell.value } : null;
}

/* The Class Average of one column: the mean of what each student counts
   for (columnCountedValue). Points work read as points returns
   { avg (points), pct, count }, extra credit up to its cap; everything else
   returns { avg (a level), count }. Null when nobody counts. */
function classColumnAverage(cid, students, col) {
  var asPoints = col.assessment && isPointsScored(col.assessment) && col.measure !== 'level';
  var total = 0;
  var possible = 0;
  var count = 0;
  (students || []).forEach(function (s) {
    var v = columnCountedValue(cid, s.id, col);
    if (!v) return;
    if (asPoints) {
      total += v.earned;
      possible += v.possible;
    } else {
      total += v.value;
    }
    count++;
  });
  if (!count) return null;
  return asPoints
    ? { avg: total / count, pct: (total / possible) * 100, count: count }
    : { avg: total / count, count: count };
}

/* The class average on one points or Complete/Incomplete assessment, as
   the course % counts it (classColumnAverage). */
function getClassPointsAverage(cid, students, assessment) {
  return classColumnAverage(cid, students, { assessment: assessment });
}

/* Whether a score is above what its assessment allows: 4 on proficiency
   work, Complete (1) on Complete/Incomplete work, and twice the maximum on
   points work, which can earn extra credit. */
function isScoreOutOfRange(assessment, value) {
  if (isCompletionScored(assessment)) return value > COMPLETE_MAX_POINTS;
  if (isPointsScored(assessment)) return value > (Number(assessment.maxPoints) || 100) * POINTS_EXTRA_CREDIT_FACTOR;
  return value > 4;
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

/* A student's grade on any group of assessments (a category, a module, an
   assignment type, a rubric's assessments), as the class shows grades.
   prof: the mean of the scored assessments' overall levels, as a category's
   average is worked out (getCategoryAverage). pct: points earned out of
   points possible (getAssessmentGroupPercentage). A Proficiency class shows
   the level, a Letter class the letter and %, a Both class both.
   Returns { text, level, prof, pct, count } or null when nothing is scored. */
function assessmentGroupGrade(cid, studentId, assessments) {
  var levels = (assessments || [])
    .map(function (a) {
      return getAssessmentOverallScore(cid, studentId, a.id);
    })
    .filter(function (v) {
      return v != null;
    });
  var prof = levels.length
    ? levels.reduce(function (s, v) {
        return s + v;
      }, 0) / levels.length
    : null;
  var group = getAssessmentGroupPercentage(cid, studentId, assessments);
  return _groupGrade(cid, prof, group ? group.pct : null, Math.max(levels.length, group ? group.count : 0));
}

/* The class average on a group of assessments: each student's group grade,
   averaged, as assessmentGroupGrade shows it. */
function classAssessmentGroupGrade(cid, studentIds, assessments) {
  var profs = [];
  var pcts = [];
  (studentIds || []).forEach(function (sid) {
    var g = assessmentGroupGrade(cid, sid, assessments);
    if (!g) return;
    if (g.prof != null) profs.push(g.prof);
    if (g.pct != null) pcts.push(g.pct);
  });
  var mean = function (list) {
    return list.length
      ? list.reduce(function (s, v) {
          return s + v;
        }, 0) / list.length
      : null;
  };
  return _groupGrade(cid, mean(profs), mean(pcts), Math.max(profs.length, pcts.length));
}

function _groupGrade(cid, prof, pct, count) {
  if (prof == null && pct == null) return null;
  var mode = courseGradeMode(cid);
  var shownPct = pct == null ? null : _roundPercent(pct, getRoundWholePercent(cid) ? 0 : 1);
  var profText = prof == null ? null : Number(prof).toFixed(1);
  var pctText = shownPct == null ? null : percentageToLetter(shownPct) + ' ' + shownPct + '%';
  var text = mode === 'letter' ? pctText : mode === 'both' ? [profText, pctText].filter(Boolean).join(' · ') : profText;
  var level = mode === 'letter' ? (shownPct == null ? 0 : _percentLevel(shownPct)) : prof > 0 ? Math.round(prof) : 0;
  if (!text) return null;
  return { text: text, level: level, prof: prof, pct: pct, count: count };
}

/* How a student's group grade sits against the class's, in the grade the
   class shows first: "4.2% below class", "0.3 above class". */
function groupGradeGap(cid, mine, cls) {
  if (!mine || !cls) return null;
  var asPct = courseGradeMode(cid) === 'letter';
  var a = asPct ? mine.pct : mine.prof;
  var b = asPct ? cls.pct : cls.prof;
  if (a == null || b == null) return null;
  var d = Math.round((a - b) * 10) / 10;
  if (d === 0) return { text: 'Same as class', dir: 0 };
  var amount = Math.abs(d).toFixed(1) + (asPct ? '%' : '');
  return { text: amount + (d > 0 ? ' above class' : ' below class'), dir: d > 0 ? 1 : -1 };
}

/* Each category's share of the course %: its weight times its % over the
   weights of the categories with a %, as getCourseLetterData adds them up.
   { [categoryId]: { points, text } } ("30.0"), {} when no category has a %. */
function categoryCourseShares(cid, studentId) {
  var assessments = _scopedAssessments(cid);
  var rows = [];
  var weightSum = 0;
  (getCategories(cid) || []).forEach(function (category) {
    var pct = getAssessmentGroupPercentage(
      cid,
      studentId,
      assessments.filter(function (a) {
        return (a.categoryId || a.category_id || null) === category.id;
      }),
    );
    if (pct == null) return;
    var weight = Number(category.weight || 0);
    weightSum += weight;
    rows.push({ id: category.id, value: weight * pct.pct });
  });
  var out = {};
  if (!(weightSum > 0)) return out;
  rows.forEach(function (r) {
    var points = _roundPercent(r.value / weightSum, 1);
    out[r.id] = { points: points, text: points.toFixed(1) };
  });
  return out;
}

/* One rubric criterion's level for a student on one assessment, on the
   0–4 scale (its points as a share of its top value), or null when the
   criterion has no score or the work is excused or not submitted. */
function rubricCriterionLevel(cid, studentId, assessment, criterion) {
  if (!assessment || !criterion) return null;
  var status = getAssignmentStatus(cid, studentId, assessment.id);
  if (status === 'EXC' || status === 'NS') return null;
  var keys = rubricCriterionScoreKeys(criterion);
  var values = (getScores(cid)[studentId] || [])
    .filter(function (e) {
      return e.assessmentId === assessment.id && keys.indexOf(e.tagId) >= 0;
    })
    .map(function (e) {
      return _rubricLevelValue(criterion, e.score, e.mod);
    })
    .filter(function (v) {
      return v != null;
    });
  if (!values.length) return null;
  var max = _rubricCriterionMax(criterion);
  if (!(max > 0)) return null;
  var avg =
    values.reduce(function (s, v) {
      return s + v;
    }, 0) / values.length;
  return Math.max(0, Math.min(4, (avg / max) * 4));
}

/* A 0–4 value as the nearest level a teacher can enter: 3.33 is "3+",
   2.67 is "3−". { level, text }; level is the whole level its colour
   comes from. */
function nearestScoreLevel(value) {
  if (!(value > 0)) return { level: 0, text: '' };
  var steps = Math.round(value / SCORE_MOD_STEP);
  var level = Math.max(1, Math.min(4, Math.round(steps * SCORE_MOD_STEP)));
  var mod = Math.round((steps * SCORE_MOD_STEP - level) / SCORE_MOD_STEP);
  return { level: level, text: formatScoreLevel(level, mod) };
}

/* Whether a class shows its course % as a whole number (86%) rather than
   to one decimal (85.9%). A class setting, like Schoology's; unset, it is on
   for grades 10–12, whose BC report cards show a whole %. */
function getRoundWholePercent(cid) {
  var cc = getCourseConfig(cid) || {};
  if (typeof cc.roundPercent === 'boolean') return cc.roundPercent;
  var course = (typeof COURSES !== 'undefined' && COURSES && COURSES[cid]) || {};
  var m = String(course.gradeLevel || '').match(/\d+/);
  var grade = m ? parseInt(m[0], 10) : NaN;
  return grade >= 10 && grade <= 12;
}

/* R to `digits` decimal places. toPrecision drops float noise (85.94999…)
   before rounding. */
function _roundPercent(R, digits) {
  var f = Math.pow(10, digits);
  return Math.round(Number((R * f).toPrecision(12))) / f;
}

function getCourseLetterData(cid, studentId) {
  var cacheKey = _ck(cid) + ':' + studentId;
  if (_courseLetterCache[cacheKey]) return _courseLetterCache[cacheKey];

  var categories = getCategories(cid) || [];
  var assessments = _scopedAssessments(cid);
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
    var values = assessments
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

  // The letter comes from the % as shown, so 85.95 shows as 86% and an A,
  // and in a class that rounds to a whole %, 85.5 does too.
  var shown = R == null ? null : _roundPercent(R, getRoundWholePercent(cid) ? 0 : 1);
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
      // Not rounded: 3+ and 3 average to 3.17, not 3.
      return weightSum > 0 ? sum / weightSum : 0;
    }
    case 'median': {
      // Sorted-middle — robust against one unusually low/high score.
      // Tie-break on even-length lists: take the higher of the two middles
      // (matches the "cleanest-recent" spirit of FullVision's mode + decay semantics).
      const sorted = valid.map(s => s.score).sort((a, b) => a - b);
      const n = sorted.length;
      if (n % 2 === 1) return sorted[(n - 1) / 2];
      return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    }
    case 'mode': {
      // Counted by whole level, so a 3+ and a 3 are both a 3. The result is
      // the most recent score at the most common level, keeping its + or −.
      const levelOf = s => (s.level != null ? Number(s.level) : Math.round(s.score));
      const freq = {};
      valid.forEach(s => {
        const w = (assessmentWeights && assessmentWeights[s.assessmentId]) || 1;
        freq[levelOf(s)] = (freq[levelOf(s)] || 0) + w;
      });
      const maxFreq = Math.max(...Object.values(freq)); // safe: freq is non-empty since valid.length > 0
      const modes = Object.keys(freq)
        .filter(k => freq[k] === maxFreq)
        .map(Number);
      for (let i = valid.length - 1; i >= 0; i--) {
        if (modes.includes(levelOf(valid[i]))) return valid[i].score;
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
      return avg;
    }
    default:
      return valid[valid.length - 1].score;
  }
}

/* "Count Only the Most Recent N" (course.recent_score_limit): a class can
   count only a competency's last N scored entries. Null counts them all. */
function getRecentScoreLimit(cid) {
  var cc = (typeof getCourseConfig === 'function' && getCourseConfig(cid)) || {};
  var n = Number(cc.recentScoreLimit);
  return n >= 1 ? Math.floor(n) : null;
}

/* A competency's last n scored entries by date, oldest first. Unscored
   entries never count, so they are dropped first. */
function _lastScoredEntries(scores, n) {
  var valid = scores
    .filter(function (s) {
      return s.score > 0;
    })
    .sort(function (a, b) {
      return (a.date || '').localeCompare(b.date || '');
    });
  return valid.length > n ? valid.slice(valid.length - n) : valid;
}

/** Calculate proficiency from an array of scores, splitting by category and applying weights.
 * @param {Score[]} scores - Array of score entries (mixed summative/formative)
 * @param {string} method - Calculation method: 'mostRecent'|'highest'|'mode'|'decayingAvg'
 * @param {number} decayWeight - Weight for decaying average (0-1), default 0.65
 * @param {Object} [opts] - Additional options
 * @param {Object} [opts.categoryWeights] - { summative: number, formative: number }
 * @param {Object} [opts.assessmentWeights] - Map of assessmentId to weight multiplier
 * @param {number} [opts.recentLimit] - Count only the last N scored entries (any method but Most Recent)
 * @returns {number} Proficiency level (0-4)
 */
function calcProficiency(scores, method, decayWeight, opts) {
  // Trimmed before the category split, so "the last 3" means the
  // competency's last 3, whatever their categories.
  if (opts && opts.recentLimit >= 1 && method !== 'mostRecent') scores = _lastScoredEntries(scores, opts.recentLimit);
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
  return Math.min(4, raw);
}

/** Get all score entries for a student on a specific tag, excluding excused and converting points-mode scores.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} tagId - Learning tag ID
 * @returns {Score[]} Filtered and converted score entries
 */
function getTagScores(cid, studentId, tagId) {
  var cacheKey = _ck(cid) + ':' + studentId + ':' + tagId;
  if (_tagScoresCache[cacheKey]) return _tagScoresCache[cacheKey];

  const allScores = getScores(cid);
  const studentScores = allScores[studentId] || [];
  const statuses = getAssignmentStatuses(cid);
  // Use Map for O(1) lookup instead of O(n) find() per score entry
  const assessMap = _getAssessMap(cid);
  // In a term, a score only counts when its assessment is dated inside it.
  // All time keeps every score, including one whose assessment is gone.
  const termActive = !!_activeTerm[cid];
  const filtered = studentScores.filter(s => {
    if (s.tagId !== tagId) return false;
    if (termActive && !assessMap.has(s.assessmentId)) return false;
    const status = statuses[studentId + ':' + s.assessmentId];
    if (status === 'EXC') return false;
    return true;
  });
  // Convert points-mode scores to proficiency
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
  var cacheKey = _ck(cid) + ':' + studentId + ':' + tagId;
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
    recentLimit: getRecentScoreLimit(cid),
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

/* How this class works out a competency level from a student's scores, in
   plain words ("Most recent score", "Decaying average: newer work counts
   more (65%)"). The same method and decay weight getTagProficiency uses. */
function describeCalcMethod(cid) {
  var cc = getCourseConfig(cid) || {};
  var course = (typeof COURSES !== 'undefined' && COURSES && COURSES[cid]) || {};
  var method = cc.calcMethod || course.calcMethod || 'mostRecent';
  var dw = cc.decayWeight != null ? cc.decayWeight : course.decayWeight || 0.65;
  var n = getRecentScoreLimit(cid);
  var of = n ? ' of the last ' + n + ' scores' : '';
  switch (method) {
    case 'highest':
      return 'Highest score' + of;
    case 'average':
      return n ? 'Average' + of : 'Average of all scores';
    case 'median':
      return 'Median score' + of;
    case 'mode':
      return 'Most common score' + of;
    case 'decayingAvg': {
      var pct = Math.round(Math.max(0.01, Math.min(1, Number(dw) || 0.65)) * 100);
      return 'Decaying average' + of + ': newer work counts more (' + pct + '%)';
    }
    default:
      return 'Most recent score';
  }
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
  const opts = { categoryWeights: cw, assessmentWeights: aw, recentLimit: getRecentScoreLimit(cid) };

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
/* ── Showing grades the way the class is set to grade ─────────────────
   A class grades by Proficiency (levels out of 4), Letter (letter grade and
   course %), or Both. Every screen shows grades through these helpers, so a
   class reads the same everywhere:
   - a student's overall grade: "3.0", "B 82%", or "3.0 · B 82%";
   - a competency, group or class average: "2.8", "70%" (level ÷ 4, the
     course's rule for a level as a %), or "2.8 · 70%".
   `level` (1-4) picks the colour; a % uses the band its letter falls in
   (A 4, B 3, C+ and C 2, C- and F 1). */
function courseGradeMode(cid) {
  var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
  if (course.gradingSystem === 'letter') return 'letter';
  if (course.gradingSystem === 'both') return 'both';
  return 'proficiency';
}

function _percentLevel(pct) {
  return pct >= 86 ? 4 : pct >= 73 ? 3 : pct >= 60 ? 2 : 1;
}

/* A level from 0 to 4 as the class shows it; `empty` (default "—") when
   there is none. */
function formatLevel(cid, value, empty) {
  if (!(value > 0)) return empty === undefined ? '\u2014' : empty;
  var mode = courseGradeMode(cid);
  var num = Number(value).toFixed(1);
  var pct = Math.round((value / 4) * 100) + '%';
  if (mode === 'letter') return pct;
  if (mode === 'both') return num + ' \u00B7 ' + pct;
  return num;
}

/* A level printed as the teacher chose rather than as the class shows it:
   'percent' gives "75%" (level ÷ 4, the course's rule for a level as a %),
   anything else the proficiency, "3.0". The printed grade sheet's Scores
   choice. */
function formatLevelAs(value, as, empty) {
  if (!(value > 0)) return empty === undefined ? '\u2014' : empty;
  if (as === 'percent') return Math.round((value / 4) * 100) + '%';
  return Number(value).toFixed(1);
}

/* A points score as a % of the assessment's most, "90%". */
function formatPointsPercent(points, maxPoints) {
  var max = Number(maxPoints) || 100;
  return Math.round((Number(points) / max) * 100) + '%';
}

/* What one gradebook cell shows: one student on one assessment, as the
   Scores view draws it and the printed grade sheet prints it. `today`
   (YYYY-MM-DD) decides whether a missing score is past due; it defaults to
   today's date as the Scores view reads it.

   Returns { kind, value, level, text, status, late, mark, outOfRange }:
   - kind 'status': Not submitted or Excused replaces the score (status 'NS'
     or 'EXC', text the same).
   - kind 'complete': a Complete/Incomplete mark (mark 'complete' or
     'incomplete', value 1 or 0, text ✓ or ✗).
   - kind 'points' or 'level': a score; value is the points or the level
     (with its ±), level the 1-4 band the cell's colour comes from, text
     through formatPoints or formatLevel.
   - kind 'missing': no score past the due date; text '0' when the missing
     policy counts it as zero (zero true), else '—'.
   - kind 'none': no score yet, text '—'.
   `late` is true when the cell is marked Late (it keeps its score). */
function assessmentCellValue(cid, sid, assessment, today) {
  var a = assessment;
  var entries = getScores(cid)[sid] || [];
  var tagScores = scoreTagIds(a, cid)
    .map(function (tid) {
      var entry = entries.find(function (e) {
        return e.assessmentId === a.id && e.tagId === tid;
      });
      return entry ? scoreModValue(entry) : 0;
    })
    .filter(function (v) {
      return v > 0;
    });
  var val =
    tagScores.length > 0
      ? tagScores.reduce(function (x, y) {
          return x + y;
        }, 0) / tagScores.length
      : 0;
  // Rubric work counts each criterion once, at its weight.
  var rubricVal = getRubricAssessmentScore(cid, a, entries);
  if (rubricVal !== undefined) val = rubricVal || 0;
  var isPoints = isPointsScored(a);
  var isComplete = isCompletionScored(a);
  // A points 0 is a score; on proficiency work 0 is none.
  var pointsVal = isPoints && !isComplete ? getPointsScore(cid, sid, a.id) : null;
  if (pointsVal != null) val = pointsVal;
  var status = getAssignmentStatus(cid, sid, a.id);
  var out = {
    kind: 'none',
    value: 0,
    level: 0,
    text: '—',
    status: status || null,
    late: status === 'LATE',
    mark: null,
    zero: false,
    outOfRange: false,
  };
  if (status === 'NS' || status === 'EXC') {
    out.kind = 'status';
    out.value = val;
    out.text = status;
    return out;
  }
  var mark = isComplete ? getCompletionMark(cid, sid, a.id) : null;
  if (mark) {
    out.kind = 'complete';
    out.mark = mark;
    out.value = mark === 'complete' ? 1 : 0;
    out.text = mark === 'complete' ? '✓' : '✗';
    return out;
  }
  if (val > 0 || pointsVal != null) {
    out.kind = isPoints ? 'points' : 'level';
    out.value = val;
    out.level = pointsVal != null ? pointsToProf(val, a.maxPoints || 100, getGradingScale(cid)) : Math.round(val);
    out.text = isPoints ? formatPoints(val) : formatLevel(cid, val);
    out.outOfRange = isScoreOutOfRange(a, val);
    return out;
  }
  var cc = getCourseConfig(cid) || {};
  var missingPolicy = a.missingPolicy || cc.missingPolicy || 'exclude';
  var day = today || new Date().toISOString().slice(0, 10);
  if (a.dueDate && a.dueDate < day) {
    out.kind = 'missing';
    out.zero = missingPolicy === 'zero';
    out.text = out.zero ? '0' : '—';
  }
  return out;
}

/* The proficiency word shown under a level ("Proficient"). Letter classes
   don't use proficiency words. */
function levelWord(cid, value) {
  if (!(value > 0) || courseGradeMode(cid) === 'letter') return '';
  return PROF_LABELS[Math.round(value)] || '';
}

/* A student's overall grade in parts: `prof` (the level out of 4) unless the
   class is Letter, `letter` (letter and %) unless it is Proficiency. Each is
   null when the student has nothing to show yet. */
function studentGradeBadges(cid, sid) {
  var mode = courseGradeMode(cid);
  var out = { prof: null, letter: null };
  if (mode !== 'letter') {
    var overall = getOverallProficiency(cid, sid);
    if (overall > 0) out.prof = { text: overall.toFixed(1), level: Math.round(overall) };
  }
  if (mode !== 'proficiency') {
    var lg = getCourseLetterData(cid, sid);
    if (lg && lg.R != null) out.letter = { text: (lg.S ? lg.S + ' ' : '') + lg.R + '%', level: _percentLevel(lg.R) };
  }
  return out;
}

/* A student's overall grade as one line, and the level its colour comes
   from (the letter's in a Letter class, else the proficiency's). */
function studentGradeSummary(cid, sid) {
  var b = studentGradeBadges(cid, sid);
  var parts = [b.prof, b.letter].filter(Boolean);
  var lead = courseGradeMode(cid) === 'letter' ? b.letter : b.prof || b.letter;
  return {
    text: parts
      .map(function (p) {
        return p.text;
      })
      .join(' \u00B7 '),
    level: lead ? lead.level : 0,
  };
}

/* The class average of the students' overall grades, as the class shows
   them. */
function classGradeSummary(cid, studentIds) {
  var mode = courseGradeMode(cid);
  var means = _classGradeMeans(cid, studentIds);
  var parts = [];
  var level = 0;
  if (means.prof != null) {
    parts.push(means.prof.toFixed(1));
    level = Math.round(means.prof);
  }
  if (means.pct != null) {
    var pct = _roundPercent(means.pct, getRoundWholePercent(cid) ? 0 : 1);
    parts.push(percentageToLetter(pct) + ' ' + pct + '%');
    if (mode === 'letter') level = _percentLevel(pct);
  }
  return { text: parts.join(' \u00B7 '), level: level };
}

/* The class's mean overall proficiency (`prof`) and mean course % (`pct`),
   each null when the class doesn't show it or nobody has one yet. */
function _classGradeMeans(cid, studentIds) {
  var mode = courseGradeMode(cid);
  var profs = [];
  var pcts = [];
  (studentIds || []).forEach(function (sid) {
    if (mode !== 'letter') {
      var overall = getOverallProficiency(cid, sid);
      if (overall > 0) profs.push(overall);
    }
    if (mode !== 'proficiency') {
      var lg = getCourseLetterData(cid, sid);
      if (lg && lg.R != null) pcts.push(lg.R);
    }
  });
  function mean(list) {
    return list.length
      ? list.reduce(function (a, b) {
          return a + b;
        }, 0) / list.length
      : null;
  }
  return { prof: mean(profs), pct: mean(pcts) };
}

/* How the class average moved since the reporting term before the active
   one, in the grade the class shows first (the % in a Letter class, else
   the proficiency): { text: '\u25B2 0.1', dir: 1, since: 'Term 1' }, dir -1 for
   down and 0 (text 'No Change') when it rounds to nothing. Null when no term
   is active, the active term is the first, or either term has no grades. */
function classGradeChange(cid, studentIds) {
  var active = getActiveTerm(cid);
  if (!active) return null;
  var terms = typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [];
  var prev = null;
  terms.forEach(function (t) {
    if (t.ordinal < active.ordinal && (!prev || t.ordinal > prev.ordinal)) prev = t;
  });
  if (!prev) return null;
  var key = courseGradeMode(cid) === 'letter' ? 'pct' : 'prof';
  var now = _classGradeMeans(cid, studentIds)[key];
  setActiveTerm(cid, prev.ordinal);
  var before = _classGradeMeans(cid, studentIds)[key];
  setActiveTerm(cid, active.ordinal);
  if (now == null || before == null) return null;
  var diff =
    key === 'pct'
      ? _roundPercent(now, getRoundWholePercent(cid) ? 0 : 1) - _roundPercent(before, getRoundWholePercent(cid) ? 0 : 1)
      : Math.round(now * 10) / 10 - Math.round(before * 10) / 10;
  diff = Math.round(diff * 10) / 10;
  var dir = diff > 0 ? 1 : diff < 0 ? -1 : 0;
  var amount = key === 'pct' ? Math.abs(diff) + '%' : Math.abs(diff).toFixed(1);
  return {
    text: dir === 0 ? 'No Change' : (dir > 0 ? '\u25B2 ' : '\u25BC ') + amount,
    dir: dir,
    since: prev.label || 'Term ' + prev.ordinal,
  };
}

/* How a class sits on one competency: each student's proficiency on a
   section (`which.sectionId`) or a group of sections (`which.groupId`),
   banded by its rounded level the way the cards colour it. Returns
   { bands: [{ level, label, ids }] Emerging first, values: { sid: level },
   avg: the mean level (0 when nobody is scored) }. Students not yet scored
   on it are left out. */
function competencyDistribution(cid, studentIds, which) {
  var bands = [1, 2, 3, 4].map(function (level) {
    return { level: level, label: PROF_LABELS[level], ids: [] };
  });
  var values = {};
  var total = 0;
  var count = 0;
  (studentIds || []).forEach(function (sid) {
    var v =
      which && which.groupId
        ? getGroupProficiency(cid, sid, which.groupId)
        : getSectionProficiency(cid, sid, which && which.sectionId);
    if (!(v > 0)) return;
    var level = Math.max(1, Math.min(4, Math.round(v)));
    bands[level - 1].ids.push(sid);
    values[sid] = v;
    total += v;
    count++;
  });
  return { bands: bands, values: values, avg: count ? total / count : 0 };
}

/* A classColumnAverage result as the class reads it: a level through
   formatLevel, points work as "7.4/10 \u00B7 74%", Complete/Incomplete work as
   its %. "\u2014" when nobody counts. */
function classColumnAverageText(cid, assessment, res) {
  if (!res) return '\u2014';
  if (res.pct != null) {
    if (isCompletionScored(assessment)) return Math.round(res.pct) + '%';
    return (
      formatPoints(Math.round(res.avg * 10) / 10) +
      '/' +
      formatPoints(Number(assessment.maxPoints) || 100) +
      ' \u00B7 ' +
      Math.round(res.pct) +
      '%'
    );
  }
  return formatLevel(cid, res.avg);
}

/* How many students sit at each grade, best first: by letter grade (A to F)
   in a Letter class, else by proficiency level (Extending to Emerging).
   A Both class counts by level, the grade it shows first. Each band has the
   `level` its colour comes from and the `ids` of its students; students
   with nothing to show yet aren't counted. */
var _LETTER_BANDS = [
  { label: 'A', min: 86 },
  { label: 'B', min: 73 },
  { label: 'C+', min: 67 },
  { label: 'C', min: 60 },
  { label: 'C-', min: 50 },
  { label: 'F', min: 0 },
];

function classGradeDistribution(cid, studentIds) {
  var bands;
  if (courseGradeMode(cid) === 'letter') {
    bands = _LETTER_BANDS.map(function (b) {
      return { label: b.label, level: _percentLevel(b.min), ids: [] };
    });
    (studentIds || []).forEach(function (sid) {
      var lg = getCourseLetterData(cid, sid);
      if (!lg || lg.R == null) return;
      var letter = percentageToLetter(lg.R);
      bands.forEach(function (b) {
        if (b.label === letter) b.ids.push(sid);
      });
    });
  } else {
    bands = [4, 3, 2, 1].map(function (level) {
      return { label: PROF_LABELS[level], level: level, ids: [] };
    });
    (studentIds || []).forEach(function (sid) {
      var level = Math.round(getOverallProficiency(cid, sid));
      if (level >= 1 && level <= 4) bands[4 - level].ids.push(sid);
    });
  }
  return bands;
}

function renderGrowthSparkline(points) {
  if (!points || points.length === 0) return '<span style="font-size:0.75rem;color:var(--text-3)">No data yet</span>';
  return `<div class="growth-sparkline">${points
    .map((p, i) => {
      const color = PROF_COLORS[Math.round(p.prof)] || PROF_COLORS[0];
      return `${i > 0 ? '<span class="sparkline-line"></span>' : ''}<span class="sparkline-dot" style="background:${color}" title="${formatDate(p.date)}: ${PROF_LABELS[Math.round(p.prof)] || '—'}"></span>`;
    })
    .join('')}</div>`;
}

/* A calculation method's result on plain example scores (oldest first), as
   the Grading tab shows beside each method. The same _calcGroup the class
   uses, so the example can't drift from the real rule. recentLimit counts
   only the last N, as the class does. */
function calcMethodExample(levels, method, decayWeight, recentLimit) {
  var scores = (levels || []).map(function (v, i) {
    return { score: v, date: '2000-01-' + String(i + 1).padStart(2, '0') };
  });
  if (recentLimit >= 1 && method !== 'mostRecent') scores = _lastScoredEntries(scores, recentLimit);
  return _calcGroup(scores, method, decayWeight, null);
}

/* A course % as this class shows it: a whole number or one decimal. */
function formatCoursePercent(cid, R) {
  if (R == null || isNaN(R)) return '—';
  return _roundPercent(R, getRoundWholePercent(cid) ? 0 : 1) + '%';
}

/* What switching this class to another calculation method would do: how
   many students' overall proficiency changes, out of how many, and one
   example. Runs the class's own math under the new method and puts the
   saved method back. recentLimit, when given, previews "Count Only the Most
   Recent N" too (null: all scores). */
function previewCalcMethodChange(cid, method, decayWeight, recentLimit) {
  var cc = getCourseConfig(cid);
  var keep = { calcMethod: cc.calcMethod, decayWeight: cc.decayWeight, recentScoreLimit: cc.recentScoreLimit };
  var students = getStudents(cid);
  var shown = function (v) {
    return v > 0 ? Number(v).toFixed(1) : '';
  };
  var before = students.map(function (s) {
    return shown(getOverallProficiency(cid, s.id));
  });
  cc.calcMethod = method;
  if (decayWeight != null) cc.decayWeight = decayWeight;
  if (recentLimit !== undefined) {
    if (recentLimit) cc.recentScoreLimit = recentLimit;
    else delete cc.recentScoreLimit;
  }
  clearProfCache();
  var after = students.map(function (s) {
    return shown(getOverallProficiency(cid, s.id));
  });
  if (keep.calcMethod === undefined) delete cc.calcMethod;
  else cc.calcMethod = keep.calcMethod;
  if (keep.decayWeight === undefined) delete cc.decayWeight;
  else cc.decayWeight = keep.decayWeight;
  if (keep.recentScoreLimit === undefined) delete cc.recentScoreLimit;
  else cc.recentScoreLimit = keep.recentScoreLimit;
  clearProfCache();
  var changed = 0;
  var example = null;
  students.forEach(function (s, i) {
    if (before[i] === after[i]) return;
    changed++;
    if (!example && before[i] && after[i])
      example = {
        name: fullName(s),
        before: before[i],
        after: after[i],
      };
  });
  return { changed: changed, total: students.length, example: example };
}

/* What removing these competencies (section ids) would do to the class:
   how many students' overall grade changes, as the class shows it, out of
   how many, and one example. Works out the grades on a copy of the learning
   map held in memory for the moment, then puts the saved one back; nothing
   is saved. */
function previewCompetencyRemoval(cid, sectionIds) {
  var drop = {};
  (sectionIds || []).forEach(function (id) {
    drop[id] = true;
  });
  var students = getStudents(cid);
  var text = function (sid) {
    return studentGradeSummary(cid, sid).text || '';
  };
  var before = students.map(function (s) {
    return text(s.id);
  });
  var saved = _cache.learningMaps[cid];
  var map = getLearningMap(cid);
  var after;
  try {
    _cache.learningMaps[cid] = Object.assign({}, map, {
      sections: (map.sections || []).filter(function (sec) {
        return !drop[sec.id];
      }),
    });
    clearProfCache();
    after = students.map(function (s) {
      return text(s.id);
    });
  } finally {
    if (saved === undefined) delete _cache.learningMaps[cid];
    else _cache.learningMaps[cid] = saved;
    clearProfCache();
  }
  var changed = 0;
  var example = null;
  students.forEach(function (s, i) {
    if (before[i] === after[i]) return;
    changed++;
    if (!example && before[i] && after[i]) example = { name: fullName(s), before: before[i], after: after[i] };
  });
  return { changed: changed, total: students.length, example: example };
}

/* ── Namespace ──────────────────────────────────────────────── */
window.Calc = {
  calcMethodExample,
  getRecentScoreLimit,
  previewCompetencyRemoval,
  formatCoursePercent,
  previewCalcMethodChange,
  clearProfCache,
  setActiveTerm,
  getActiveTerm,
  activateSavedTerm,
  assessmentInActiveTerm,
  undatedAssessmentCount,
  getClassPointsAverage,
  classColumnAverage,
  columnCountedValue,
  isScoreOutOfRange,
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
  courseGradeMode,
  formatLevel,
  assessmentCellValue,
  levelWord,
  studentGradeBadges,
  studentGradeSummary,
  classGradeSummary,
  classGradeChange,
  classGradeDistribution,
  competencyDistribution,
  classColumnAverageText,
  getAssessmentGroupPercentage,
  assessmentGroupGrade,
  classAssessmentGroupGrade,
  groupGradeGap,
  categoryCourseShares,
  rubricCriterionLevel,
  nearestScoreLevel,
  calcProficiency,
  getTagScores,
  getTagProficiency,
  describeCalcMethod,
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
