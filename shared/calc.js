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
var _criterionIndexCache = {};
var _tagProfCache = {};
var _awCache = {};
var _assessMapCache = {}; // cid → Map<assessmentId, assessment> — avoids O(n) find per score
var _sectionByIdCache = {}; // cid → Map<sectionId, section>      — avoids repeated getSections().find()
var _assessmentOverallCache = {};
var _categoryAvgCache = {};
var _courseLetterCache = {};
var _pieceIndexCache = {}; // cid → { rank, keys }: each piece's place in the assignment list and what it measures
var _orderedEntriesCache = {}; // class, term, set and student → the student's score entries in counting order

/* ── The score set and its reader ──────────────────────────────
   Every score, status, points score, Complete/Incomplete mark, Overall
   Comment and DIBELS number this file works with is read through _scoreRead,
   and nowhere else in it (tests/calc-score-reader.test.js fails on a direct
   read). No calculation asks the data layer for a score itself.

   _scoreSet names the set of scores in use
   (docs/plans/student-page-build-plan.md 1.2 and 1.3):
   - 'all': the teacher's working copy, every score the data layer holds.
     Every calculation uses it unless it is run inside withReturnedOnly.
   - 'returned': only what students have been given. For each student and
     piece of work: the working copy where nothing is a draft, the grade as
     it was last returned where a draft sits on a returned grade, and
     nothing where a grade was never returned.
   The two sets differ only in what scores() gives. Everything below this
   block is the same calculation for both. The set is part of every cache
   key (_ck), so the two never share a cached number. */
var _scoreSet = 'all';

/** Run `fn` with returned grades only, and give back what it returns: every
 * grade worked out inside it leaves drafts out. The set in use before is put
 * back when `fn` ends, also when it throws, the way readAsOfTerm puts the
 * report in view back. Calls can sit inside each other. `fn` must finish at
 * once: one that returns a promise would do the rest of its work with every
 * score, drafts included, so that is refused. */
function withReturnedOnly(fn) {
  var was = _scoreSet;
  var result;
  _scoreSet = 'returned';
  try {
    result = fn();
  } finally {
    _scoreSet = was;
  }
  if (result && typeof result.then === 'function') {
    throw new Error(
      'withReturnedOnly was given work that does not finish at once (it returned a promise). ' +
        'The rest of that work would count drafts. Work the grades out first, then wait.',
    );
  }
  return result;
}

/* Whether a value is a set of scores as the reader's scores() gives it: a
   plain object of { studentId: [entries] }. A list, a Map, a promise or a
   student whose scores are not a list would not throw further down. Each
   would read as "this student has no scores", and every grade would come
   out blank with no error. */
function _isScoreMap(value) {
  if (!value || typeof value !== 'object') return false;
  // A plain object only: a list, a Map, a promise each has its own prototype.
  var proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.keys(value).every(function (sid) {
    return Array.isArray(value[sid]);
  });
}

var _scoreRead = {
  // Every student's score entries in the class: { [studentId]: [entry] }.
  scores: function (cid) {
    if (_scoreSet === 'all') return getScores(cid);
    /* Returned only. The data layer builds that set (getReturnedScores), in
       the shape above, from the working copy and each grade's returned
       copy; this file works no draft rule out itself. When the set cannot
       be had (an unknown set, no builder loaded, a builder that gives
       nothing, or gives anything but that shape) this stops with an error.
       It never falls back to every score: that would show a draft to a
       family. A student who is not in the set, or whose list is empty, has
       no returned grade, and is given none. */
    if (_scoreSet !== 'returned') {
      throw new Error('calc.js has no set of scores called "' + _scoreSet + '". No grade was worked out.');
    }
    if (typeof getReturnedScores !== 'function') {
      throw new Error(
        'Returned grades were asked for, but nothing loaded here can give them. ' +
          'No grade was worked out, so no draft is shown.',
      );
    }
    var returned = getReturnedScores(cid);
    if (!returned || typeof returned !== 'object') {
      throw new Error(
        'Returned grades were asked for, but none came back for this class. ' +
          'No grade was worked out, so no draft is shown.',
      );
    }
    if (!_isScoreMap(returned)) {
      throw new Error(
        'Returned grades were asked for, but what came back for this class is not a set of scores ' +
          '(each student with a list). No grade was worked out, so no draft is shown.',
      );
    }
    return returned;
  },
  /* Every status in the class: { 'studentId:assessmentId': 'NS' | 'EXC' | 'LATE' }.
     The same in both sets: Missing, Excused and Late are never drafts. They
     show and count as soon as they are set (plan 1.2; Colin's answer 7). */
  statuses: function (cid) {
    return getAssignmentStatuses(cid);
  },
  // One student's status on one assessment, or null.
  status: function (cid, sid, aid) {
    return _scoreRead.statuses(cid)[sid + ':' + aid] || null;
  },
  // A points score, or null when none is entered; 0 is a score.
  pointsScore: function (cid, sid, aid) {
    var entry = (_scoreRead.scores(cid)[sid] || []).find(function (e) {
      return e.assessmentId === aid && e.score != null && e.score !== '';
    });
    return entry ? Number(entry.score) : null;
  },
  // A Complete/Incomplete mark: 'complete', 'incomplete', or null when unmarked.
  completionMark: function (cid, sid, aid) {
    var entry = (_scoreRead.scores(cid)[sid] || []).find(function (e) {
      return e.assessmentId === aid;
    });
    if (!entry || entry.score == null) return null;
    return Number(entry.score) > 0 ? 'complete' : 'incomplete';
  },
  // The Overall Comment on one piece of work, or ''.
  comment: function (cid, sid, aid) {
    var entry = (_scoreRead.scores(cid)[sid] || []).find(function (e) {
      return e && e.assessmentId === aid && e.note;
    });
    return entry ? String(entry.note) : '';
  },
  /* One window's DIBELS numbers, or null. A reading record, never a grade,
     and it has no Draft or Returned state: the same in both sets. */
  dibels: function (cid, sid, aid, period) {
    return getDibelsScore(cid, sid, aid, period);
  },
};

/* ── Reporting term scope ──────────────────────────────────────
   Teachers grade cumulatively; a reporting term is a checkpoint
   (docs/DECISIONS.md, "Reporting periods" 2; Colin, 2026-11-03). While a
   term is active for a class (the Reports page makes the report's term
   active), every grade is the year to date as of that term's end date:
   every assessment dated on or before it, and undated work. Work dated
   after it doesn't count. With no term active (the gradebook, dashboard
   and student page, which always show the year so far) nothing here
   changes a result. The term's own window (assessmentInTermWindow) is for
   what describes this term only: Start of Term, Generate's trend, the This
   Term lists. Cache keys carry the term, so switching terms never needs a
   cache clear. */
var _activeTerm = {}; // cid → { ordinal, label, startsOn, endsOn } | undefined

/** Make one reporting term (by ordinal) the report in view for a class, or null for the year so far. */
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

/** The reporting term a class's grades are read as of, or null for the year so far. */
function getActiveTerm(cid) {
  return _activeTerm[cid] || null;
}

function _termKey(cid) {
  var t = _activeTerm[cid];
  return t ? '@' + t.ordinal : '';
}

/* Cache key prefix for a class: the class id, the active term and the score
   set in use ('c1#all', 'c1@2#all', 'c1@2#returned'). */
function _ck(cid) {
  return cid + _termKey(cid) + '#' + _scoreSet;
}

function _assessmentDate(a) {
  return (a && (a.date || a.dateAssigned || a.assigned_at || a.date_assigned)) || '';
}

/** Whether an assessment counts in the grade in view: the year to date as of
 * the active term's end (undated, or dated on or before it); true when no
 * term is active. */
function assessmentInYearToDate(cid, a) {
  var t = _activeTerm[cid];
  if (!t) return true;
  var d = _assessmentDate(a);
  if (!d) return true;
  return !t.endsOn || d <= t.endsOn;
}

/** Whether an assessment is dated inside the active term's own dates (true
 * when no term is active). For what describes this term only, never a grade. */
function assessmentInTermWindow(cid, a) {
  var t = _activeTerm[cid];
  if (!t) return true;
  var d = _assessmentDate(a);
  if (!d) return false;
  return d >= t.startsOn && d <= t.endsOn;
}

/* The class's assessments in the year to date as of the active term's end; all of them when none is active. */
function _scopedAssessments(cid) {
  var all = getAssessments(cid);
  if (!_activeTerm[cid]) return all;
  return all.filter(function (a) {
    return assessmentInYearToDate(cid, a);
  });
}

/* Every assessment id the class has, whatever is in view. */
function _everyAssessmentIds(cid) {
  return new Set(
    (getAssessments(cid) || []).map(function (a) {
      return a.id;
    }),
  );
}

/* The reporting term before a report: the one before the active term, or
   with none active (the year so far) the last term that ended before
   today. null when there is none. */
function previousReportTerm(cid) {
  var terms = typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [];
  var active = _activeTerm[cid];
  var prev = null;
  if (active) {
    terms.forEach(function (t) {
      if (Number(t.ordinal) < active.ordinal && (!prev || Number(t.ordinal) > Number(prev.ordinal))) prev = t;
    });
    return prev;
  }
  var today = typeof courseToday === 'function' ? courseToday(cid) : '';
  if (!today) return null;
  terms.forEach(function (t) {
    var end = t.ends_on || t.endsOn;
    if (end && end < today && (!prev || Number(t.ordinal) > Number(prev.ordinal))) prev = t;
  });
  return prev;
}

/* Read something with the class's grades as of another report (an ordinal,
   or null for the year so far), and put the report in view back after. */
function readAsOfTerm(cid, ordinal, read) {
  var was = _activeTerm[cid] ? _activeTerm[cid].ordinal : null;
  try {
    setActiveTerm(cid, ordinal);
    return read();
  } finally {
    setActiveTerm(cid, was);
  }
}

/** Clear all proficiency caches. Call when scores, assessments, overrides, or statuses change. */
function clearProfCache() {
  _tagScoresCache = {};
  _criterionIndexCache = {};
  _tagProfCache = {};
  _awCache = {};
  _assessMapCache = {};
  _sectionByIdCache = {};
  _assessmentOverallCache = {};
  _categoryAvgCache = {};
  _courseLetterCache = {};
  _pieceIndexCache = {};
  _orderedEntriesCache = {};
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
 * Holds only the assessments in scope (the year to date as of the active term), so an id missing here is out of scope. */
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

/* ── What each piece of work measures, and the order work counts in ──
   Two rules read the class's pieces of work the same way, so they share one
   index, built once per class and thrown away by clearProfCache.

   keys: what each piece measures now, as its score keys (scoreTagIds, the
   list the gradebook cell is drawn from): on competency work the
   competencies linked to it that are still on the class; on rubric work the
   criteria of the rubric it has now; on points and Complete/Incomplete work
   its linked competencies; and the one Overall key when it has none of
   these.

   rank: each piece's place in the class's assignment list, for telling
   same-date work apart. The Assignments page lists by display_order (a
   teacher's drag sets 1..n; 0 is never placed, and sits first), then for
   pieces with the same date by the order they are stored in, which is the
   order they were made (the server sends display_order, created_at, id). */
function _pieceIndex(cid) {
  if (_pieceIndexCache[cid]) return _pieceIndexCache[cid];
  var all = (getAssessments(cid) || []).filter(Boolean);
  var rank = new Map();
  all
    .map(function (a, i) {
      return { id: a.id, placed: Number(a.display_order || 0) || 0, stored: i };
    })
    .sort(function (x, y) {
      return x.placed - y.placed || x.stored - y.stored;
    })
    .forEach(function (x, n) {
      rank.set(x.id, n);
    });
  var keys = new Map();
  all.forEach(function (a) {
    keys.set(a.id, scoreTagIds(a, cid));
  });
  _pieceIndexCache[cid] = { rank: rank, keys: keys };
  return _pieceIndexCache[cid];
}

/* Only what a piece measures now counts (Colin, 2026-11-09: "Yes, count
   nowhere"). A level left under a competency that has since been taken off
   the piece, under a criterion of a rubric the piece no longer has, or under
   a competency when the piece now has a rubric, counts nowhere, in either
   set of scores. The entry itself stays in the data, so putting the
   competency or the rubric back brings its level back. A piece that is no
   longer in the class has no say: its scores are left as they were. */
function _pieceMeasures(cid, assessmentId, key) {
  var keys = _pieceIndex(cid).keys.get(assessmentId);
  if (!keys) return true;
  if (isUnlinkedTag(key)) return isUnlinkedTag(keys[0]);
  return keys.indexOf(key) >= 0;
}

/* The order evidence counts in: by date; work with the same date in the
   order it sits in the class's assignment list (_pieceIndex's rank),
   whatever order it was graded in (Colin, 2026-11-09: "Order in the
   assignment list"); and the scores of one piece in the order the piece
   lists what it measures (its competencies, or its rubric's criteria).
   Never by where an entry sits in the student's score list: re-entering a
   score moves it to the end of that list, and Most Recent, Mode's tie and
   Decaying Average must not move with it. Two entries under the same key of
   one piece are one score stored twice; they keep the order given. */
function _evidenceCompare(cid) {
  var index = _pieceIndex(cid);
  function place(entry) {
    var keys = index.keys.get(entry.assessmentId) || [];
    var at = keys.indexOf(entry.criterionId || entry.tagId);
    return at < 0 ? keys.length : at;
  }
  return function (a, b) {
    var byDate = (a.date || '').localeCompare(b.date || '');
    if (byDate) return byDate;
    if (a.assessmentId !== b.assessmentId) {
      var ra = index.rank.get(a.assessmentId);
      var rb = index.rank.get(b.assessmentId);
      // A piece no longer in the class sorts after those that are, by its id.
      if (ra == null && rb == null) return String(a.assessmentId) < String(b.assessmentId) ? -1 : 1;
      if (ra == null) return 1;
      if (rb == null) return -1;
      return ra - rb;
    }
    var byPlace = place(a) - place(b);
    if (byPlace) return byPlace;
    var ka = String(a.criterionId || a.tagId || '');
    var kb = String(b.criterionId || b.tagId || '');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
}

/* One student's score entries in counting order (_evidenceCompare), from
   the set of scores in use. Everything that turns entries into evidence
   reads them here, so no result depends on the order of the score list. */
function _orderedEntries(cid, studentId) {
  var key = _ck(cid) + ':' + studentId;
  if (_orderedEntriesCache[key]) return _orderedEntriesCache[key];
  var ordered = (_scoreRead.scores(cid)[studentId] || []).slice().sort(_evidenceCompare(cid));
  _orderedEntriesCache[key] = ordered;
  return ordered;
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
  // Highest start first, however the table was saved.
  const boundaries = ((scale && scale.boundaries) || DEFAULT_GRADING_SCALE.boundaries)
    .slice()
    .sort((a, b) => b.min - a.min);
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
/** Get an assessment's Factor, as in Schoology: it counts that many times.
 * Its points earned and possible are multiplied in the course % (6 points at
 * 4x count as 24), and its scores count that many times toward competency
 * proficiency and level averages. Any kind of scoring can have one.
 * @param {Object} assessment - Assessment object
 * @param {number} [assessment.weight] - The Factor, defaults to 1
 * @returns {number} Assessment Factor
 */
function getAssessmentWeight(assessment) {
  var factor = assessment ? Number(assessment.weight) : NaN;
  return factor > 0 ? factor : 1;
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

/* A score entry's value on the 0–4 scale. Points and Complete/Incomplete
   work read as the level the class's Points to Proficiency table gives
   (72% is Developing on the default table), the same level its competency
   and its gradebook cell show; a proficiency level is itself. */
function _normalizeAssessmentEntryValue(cid, assessment, rawScore) {
  if (rawScore == null || rawScore === '') return null;
  var num = Number(rawScore);
  if (!isFinite(num)) return null;
  if (isPointsScored(assessment)) {
    var max = isCompletionScored(assessment) ? COMPLETE_MAX_POINTS : Number(assessment.maxPoints) || 0;
    if (max > 0) return pointsToProf(Math.max(0, num), max, getGradingScale(cid));
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

// A criterion still on the standard values, 1 to 4 points for levels 1 to 4.
function _isStandardCriterion(criterion) {
  return [1, 2, 3, 4].every(function (l) {
    return _rubricLevelValue(criterion, l, 0) === l;
  });
}

function _rubricCriterionWeight(criterion) {
  var weight = criterion.weight == null || criterion.weight === '' ? 1 : Number(criterion.weight);
  return isFinite(weight) && weight >= 0 ? weight : 1;
}

/* A rubric assessment's scored criteria: { value, max, weight } each, where
   value is the average of the criterion's competency scores in its own
   points. Undefined when the assessment isn't rubric-scored, null when no
   criterion is scored. When every criterion weighs 0 they count equally.
   `forPercent`: for the course %, a criterion on the standard 1–4 values
   counts each level as its Counts As percent of 4 points; a criterion with
   its own point values keeps them. */
function _rubricScoredCriteria(cid, assessment, entries, forPercent) {
  var rubricId = assessment && (assessment.rubricId || assessment.rubric_id);
  if (!rubricId || isPointsScored(assessment) || typeof getRubricById !== 'function') return undefined;
  var rubric = getRubricById(cid, rubricId);
  var criteria = (rubric && rubric.criteria) || [];
  if (criteria.length === 0) return undefined;

  var scored = [];
  criteria.forEach(function (criterion) {
    if (!criterion) return;
    var asPercent = forPercent && _isStandardCriterion(criterion);
    // A criterion with no competencies stores its score under its own id.
    var tagIds = rubricCriterionScoreKeys(criterion);
    var values = (entries || [])
      .filter(function (entry) {
        return entry.assessmentId === assessment.id && tagIds.indexOf(entry.tagId) >= 0;
      })
      .map(function (entry) {
        var value = _rubricLevelValue(criterion, entry.score, entry.mod);
        return value != null && asPercent ? _levelPoints(cid, value) : value;
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
  var entries = (_scoreRead.scores(cid)[studentId] || []).filter(function (entry) {
    return entry.assessmentId === assessment.id;
  });
  var scored = _rubricScoredCriteria(cid, assessment, entries, true);
  if (scored === undefined) return undefined;
  var status = _scoreRead.status(cid, studentId, assessment.id);
  if (status === 'EXC') return null;
  if (status === 'NS') {
    var full = _rubricFullPoints(cid, assessment).possible;
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

/* A rubric's points when every criterion is at its top value, by weight:
   { possible, criteria } (criteria = how many), as not-submitted work
   counts out of. When every criterion weighs 0 they count equally. */
function _rubricFullPoints(cid, assessment) {
  // assessment.rubric: a rubric not saved yet (the assessment form's draft).
  var rubric = assessment.rubric || getRubricById(cid, assessment.rubricId || assessment.rubric_id);
  var criteria = ((rubric && rubric.criteria) || []).filter(Boolean);
  var weights = criteria.map(_rubricCriterionWeight);
  var anyWeight = weights.some(function (w) {
    return w > 0;
  });
  var possible = criteria.reduce(function (sum, c, i) {
    return sum + (anyWeight ? weights[i] : 1) * _rubricCriterionMax(c);
  }, 0);
  return { possible: possible, criteria: criteria.length };
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
  // A DIBELS benchmark is a reading record, not graded work: it counts
  // toward no grade, whatever its status.
  if (!assessment || isDibelsScored(assessment)) {
    _assessmentOverallCache[cacheKey] = null;
    return null;
  }

  var status = _scoreRead.status(cid, studentId, assessmentId);
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

  var entries = _orderedEntries(cid, studentId).filter(function (entry) {
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
      // Nor does a level under a competency the piece no longer measures.
      if (!points && !_pieceMeasures(cid, assessmentId, entry.tagId)) return false;
      // A proficiency entry with no level (a cleared level, or one that only
      // holds a comment) is unscored, not a 0.
      if (!points && !(Number(entry.score) > 0)) return false;
      return countsOverallKey || !isUnlinkedTag(entry.tagId);
    })
    .map(function (entry) {
      // A proficiency level counts with its + or − (3+ = 3.33).
      var raw = isPointsScored(assessment) ? entry.score : entry.score > 0 ? scoreModValue(entry) : entry.score;
      return _normalizeAssessmentEntryValue(cid, assessment, raw);
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

/* The mean of a student's overall levels on a group of assessments, each
   counted its Factor times. { mean, count }, or null when none is scored.
   Missing work follows the class's grading style (Colin, 2026-11-03): in a
   Proficiency or Both class it is no evidence here, as in competency
   proficiency (the BC scale has no level 0); in a Letter class all of it,
   points, proficiency and rubric work, is a 0 level, so the level agrees
   with the % beside it. Competency proficiency leaves it out in every
   class; the % and the column Class Averages keep their rules. */
function _factoredMeanLevel(cid, studentId, assessments) {
  var sum = 0;
  var factors = 0;
  var count = 0;
  var noEvidence = courseGradeMode(cid) !== 'letter';
  (assessments || []).forEach(function (assessment) {
    if (noEvidence && _scoreRead.status(cid, studentId, assessment.id) === 'NS') return;
    var value = getAssessmentOverallScore(cid, studentId, assessment.id);
    if (value == null) return;
    var factor = getAssessmentWeight(assessment);
    sum += factor * value;
    factors += factor;
    count++;
  });
  return count ? { mean: sum / factors, count: count } : null;
}

function getCategoryAverage(cid, studentId, categoryId) {
  var cacheKey = _ck(cid) + ':' + studentId + ':' + categoryId;
  if (_categoryAvgCache[cacheKey] !== undefined) return _categoryAvgCache[cacheKey];

  var levels = _factoredMeanLevel(
    cid,
    studentId,
    _scopedAssessments(cid).filter(function (assessment) {
      return (assessment.categoryId || assessment.category_id || null) === categoryId;
    }),
  );
  var result = levels ? levels.mean : null;
  _categoryAvgCache[cacheKey] = result;
  return result;
}

/* What each step (COUNTS_AS_STEPS, 1 to 4 with + and −) counts as in the
   course %, lowest first, from a Counts As percents object: a whole level's
   own value or the default, and a step left out a third of the way between
   its whole levels. */
function countsAsStepPercents(percents) {
  var d = DEFAULT_GRADING_SCALE.percents;
  var p = percents || d;
  function num(key) {
    var v = p[key] === '' || p[key] == null ? NaN : Number(p[key]);
    return isFinite(v) ? Math.max(0, Math.min(100, v)) : null;
  }
  var whole = {};
  [1, 2, 3, 4].forEach(function (l) {
    var v = num(l);
    whole[l] = v == null ? d[l] : v;
  });
  return COUNTS_AS_STEPS.map(function (step) {
    var own = num(step.key);
    if (own != null) return own;
    var l = parseInt(step.key, 10);
    if (step.key.slice(-1) === '+') return whole[l] + (whole[l + 1] - whole[l]) / 3;
    return whole[l] - (whole[l] - whole[l - 1]) / 3;
  });
}
// The class's steps; with no class, the defaults.
function _levelPercents(cid) {
  var scale = cid && typeof getGradingScale === 'function' ? getGradingScale(cid) : null;
  return countsAsStepPercents(scale && scale.percents);
}
// Level ÷ 4 at every step, the default.
function _isLinearPercents(steps) {
  return COUNTS_AS_STEPS.every(function (step, i) {
    return Math.abs(steps[i] - step.at * 25) < 1e-9;
  });
}

/* A level from 0 to 4 as the percent it counts as. A step (3+ is 3.33)
   counts as its own Counts As value; between steps (an average of 2.9) it
   is that far along the line to the next step. Below 1 it runs down to 0.
   With the default percents this is level ÷ 4, worked out the same way as
   before so no grade moves by a rounding hair. */
function levelToPercent(cid, value) {
  if (value == null) return null;
  var v = Math.max(0, Math.min(4, Number(value)));
  if (!(v > 0)) return 0;
  var p = _levelPercents(cid);
  if (_isLinearPercents(p)) return (v / 4) * 100;
  if (v <= 1) return p[0] * v;
  for (var i = 0; i < COUNTS_AS_STEPS.length - 1; i++) {
    var a = COUNTS_AS_STEPS[i].at;
    var b = COUNTS_AS_STEPS[i + 1].at;
    if (v <= b + 1e-9) return p[i] + ((p[i + 1] - p[i]) * (v - a)) / (b - a);
  }
  return p[p.length - 1];
}

/* A level as points out of 4 for the course %: the level itself with the
   default percents, else its percent of 4. */
function _levelPoints(cid, value) {
  var v = Math.max(0, Math.min(4, Number(value) || 0));
  var p = _levelPercents(cid);
  if (_isLinearPercents(p)) return v;
  return (levelToPercent(cid, v) / 100) * 4;
}

/* BC reporting: under 50% is IE (Insufficient Evidence) until the course
   ends, and F only after (Colin, 2026-10-27). Whatever way the % was earned
   (points, proficiency, Complete/Incomplete); proficiency words such as
   Emerging are never replaced. The course has ended once today reaches the
   class's last reporting term's end (the final report's date), or while
   that last term is the one in view, as the final report is. A class with
   no reporting terms never ends, so it shows IE. With no class given, F. */
function percentageToLetter(R, cid) {
  if (R == null) return null;
  // Every band but the last (F, which turns on whether the course ended).
  for (var i = 0; i < BC_LETTER_BANDS.length - 1; i++) {
    if (R >= BC_LETTER_BANDS[i].min) return BC_LETTER_BANDS[i].label;
  }
  return cid == null || courseHasEnded(cid) ? 'F' : 'IE';
}

/** Whether a class's course is over, so a failing grade shows F, not IE. */
function courseHasEnded(cid) {
  var terms = typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [];
  if (!terms.length) return false;
  var last = terms[terms.length - 1];
  var active = _activeTerm[cid];
  if (active && Number(active.ordinal) === Number(last.ordinal)) return true;
  var today = typeof courseToday === 'function' ? courseToday(cid) : '';
  return !!(today && last.ends_on && today >= last.ends_on);
}

/* A points-scored assessment's points for one student, or null when it
   doesn't count: excused, or not graded yet. Not submitted counts as 0.
   Points work can earn extra credit up to twice its maximum. */
function _assessmentPoints(cid, studentId, assessment) {
  var status = _scoreRead.status(cid, studentId, assessment.id);
  if (status === 'EXC') return null;
  var possible = isCompletionScored(assessment) ? COMPLETE_MAX_POINTS : Number(assessment.maxPoints) || 0;
  if (!(possible > 0)) return null;
  if (status === 'NS') return { earned: 0, possible: possible };
  var entry = (_scoreRead.scores(cid)[studentId] || []).find(function (e) {
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
   - Proficiency and rubric work, as in competency proficiency: Excused and
     Not Submitted are both left out. Missing work is no evidence, not a
     level of 0; the BC proficiency scale has none.
   - Except in a Letter class, where the column follows the grading style
     (Colin, 2026-11-03: "Follow the grading style"): Missing proficiency
     and rubric work counts as 0 there, as it does in the % and the level
     averages (letterProficiency).
   Students without a score are left out. */
var COLUMN_STATUS_RULES = {
  points: { EXC: 'out', NS: 'zero' },
  proficiency: { EXC: 'out', NS: 'out' },
  letterProficiency: { EXC: 'out', NS: 'zero' },
};

/* What one student counts for in one column, or null when they don't.
   `col.assessment` is the assessment. `col.tagIds` narrows it to one
   competency, or a rubric criterion's competencies (each student's value is
   the mean of their scores on them). `col.measure: 'level'` reads points
   work as a proficiency, as the printed sheet can. Returns { value } (a
   level), or { earned, possible } for points work read as points. */
function columnCountedValue(cid, sid, col) {
  var a = col.assessment;
  if (!a || isDibelsScored(a)) return null;
  var status = _scoreRead.status(cid, sid, a.id);
  if (isPointsScored(a)) {
    var pointsRule = COLUMN_STATUS_RULES.points[status];
    if (pointsRule === 'out') return null;
    if (col.measure === 'level') {
      var level = pointsRule === 'zero' ? 0 : getAssessmentOverallScore(cid, sid, a.id);
      return level == null ? null : { value: level };
    }
    return _assessmentPoints(cid, sid, a);
  }
  var rules =
    courseGradeMode(cid) === 'letter' ? COLUMN_STATUS_RULES.letterProficiency : COLUMN_STATUS_RULES.proficiency;
  var profRule = rules[status];
  if (profRule === 'out') return null;
  if (profRule === 'zero') return { value: 0 };
  if (col.tagIds && col.tagIds.length) {
    var entries = _scoreRead.scores(cid)[sid] || [];
    var vals = [];
    _columnScoreKeys(cid, a, col.tagIds).forEach(function (key) {
      if (!_pieceMeasures(cid, a.id, key)) return;
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
   3+ = 83.3%). Each assessment's points earned and possible are multiplied
   by its Factor (4/6 at 4x counts as 16/24). Returns { pct, count }
   (count = graded assessments), or null when nothing in the group is graded.
   calcMode 'percent' (a category set to Average of Percentages,
   categoryCalcMode): each assessment becomes its own percent first, and the
   percents are averaged, each counted its Factor times, so a 20-point
   rubric and an 8-point one count the same. */
function getAssessmentGroupPercentage(cid, studentId, assessments, calcMode) {
  var averaged = calcMode === 'percent';
  var earned = 0;
  var possible = 0;
  var pctSum = 0;
  var factors = 0;
  var count = 0;
  (assessments || []).forEach(function (assessment) {
    var pts = _assessmentEarnedPossible(cid, studentId, assessment);
    if (!pts) return;
    var factor = getAssessmentWeight(assessment);
    if (averaged) {
      if (!(pts.possible > 0)) return;
      pctSum += factor * (pts.earned / pts.possible) * 100;
      factors += factor;
    } else {
      earned += factor * pts.earned;
      possible += factor * pts.possible;
    }
    count++;
  });
  if (averaged) return count > 0 && factors > 0 ? { pct: pctSum / factors, count: count } : null;
  return count > 0 && possible > 0 ? { pct: (earned / possible) * 100, count: count } : null;
}

/* What one assessment is worth in the course %, for the line under its
   scoring ("Counts as 20 points in Current Events"):
     { kind: 'points', points, base, criteria, factor, category }
        Total Points category, or a class with no categories. base is the
        points before the Factor; criteria is a rubric's criterion count.
     { kind: 'percent', factor, category }  Average of Percentages category.
     { kind: 'uncategorized' }  the class has categories and this has none.
     { kind: 'zero', category } its category is worth 0%.
   null when no % is shown (a Proficiency class) or the work counts toward
   no grade (DIBELS). category is the category's name, or null. */
function assessmentCourseWorth(cid, assessment) {
  if (!assessment || isDibelsScored(assessment) || courseGradeMode(cid) === 'proficiency') return null;
  var categories = (typeof getCategories === 'function' && getCategories(cid)) || [];
  var categoryId = assessment.categoryId || assessment.category_id || null;
  var category = null;
  if (categories.length) {
    category =
      categories.find(function (c) {
        return c.id === categoryId;
      }) || null;
    if (!category) return { kind: 'uncategorized' };
    if (!(Number(category.weight || 0) > 0)) return { kind: 'zero', category: category.name || '' };
  }
  var factor = getAssessmentWeight(assessment);
  var name = category ? category.name || '' : null;
  if (category && _categoryMode(category) === 'percent') return { kind: 'percent', factor: factor, category: name };
  var base = 4;
  var criteria = null;
  if (isPointsScored(assessment)) {
    base = isCompletionScored(assessment) ? COMPLETE_MAX_POINTS : Number(assessment.maxPoints) || 0;
  } else if (
    (assessment.rubric || assessment.rubricId || assessment.rubric_id) &&
    typeof getRubricById === 'function'
  ) {
    var full = _rubricFullPoints(cid, assessment);
    if (full.criteria) {
      base = full.possible;
      criteria = full.criteria;
    }
  }
  return { kind: 'points', points: base * factor, base: base, criteria: criteria, factor: factor, category: name };
}

/* One assessment's share of its category, as the course % counts it, for
   the share bar under the assessment form's scoring. Read-only: it uses the
   same weights getAssessmentGroupPercentage gives each assessment, assuming
   every one is scored.
     Total Points category (or a class with no categories): its points times
       its Factor over the category's total (assessmentCourseWorth's points).
     Average of Percentages category: its Factor over the sum of Factors.
   assessment is the form's live values; one with an id stands in for the
   saved assessment with that id. Returns
     { kind: 'share', share, category, mode, parts }
        share 0–1; category the category's name, or null in a class with no
        categories; parts [{ id, title, share, self }], this one first, then
        the others in the class's order, leaving out any that count nothing.
   or assessmentCourseWorth's { kind: 'uncategorized' } / { kind: 'zero' },
   or null when no % is shown or the work counts toward no grade. */
function assessmentCategoryShare(cid, assessment) {
  var worth = assessmentCourseWorth(cid, assessment);
  if (!worth || (worth.kind !== 'points' && worth.kind !== 'percent')) return worth;
  var averaged = worth.kind === 'percent';
  var hasCategories = ((typeof getCategories === 'function' && getCategories(cid)) || []).length > 0;
  var categoryId = assessment.categoryId || assessment.category_id || null;
  var selfId = assessment.id || null;
  var weightOf = function (a, w) {
    if (averaged) return getAssessmentWeight(a);
    return w && w.kind === 'points' ? w.points : 0;
  };
  var parts = [{ id: selfId, title: assessment.title || '', weight: weightOf(assessment, worth), self: true }];
  ((typeof getAssessments === 'function' && getAssessments(cid)) || []).forEach(function (a) {
    if (!a || (selfId && a.id === selfId) || isDibelsScored(a)) return;
    if (hasCategories && (a.categoryId || a.category_id || null) !== categoryId) return;
    parts.push({
      id: a.id,
      title: a.title || '',
      weight: weightOf(a, averaged ? null : assessmentCourseWorth(cid, a)),
      self: false,
    });
  });
  var total = parts.reduce(function (sum, p) {
    return sum + (p.weight > 0 ? p.weight : 0);
  }, 0);
  var shown = parts
    .filter(function (p) {
      return p.self || p.weight > 0;
    })
    .map(function (p) {
      return { id: p.id, title: p.title, share: total > 0 && p.weight > 0 ? p.weight / total : 0, self: p.self };
    });
  return {
    kind: 'share',
    share: shown[0].share,
    category: worth.category,
    mode: averaged ? 'percent' : 'points',
    parts: shown,
  };
}

/* A share (0–1) as a whole percent: "70%", "< 1%" for a sliver. approx puts
   "≈ " before a share the whole number only rounds to (69.7% is "≈ 70%";
   50% stays "50%"). */
function formatShare(share, approx) {
  var pct = Number(share) * 100;
  if (!(pct > 0)) return '0%';
  if (pct < 0.5) return '< 1%';
  var whole = Math.round(pct);
  return (approx && Math.abs(pct - whole) > 1e-9 ? '\u2248 ' : '') + whole + '%';
}

// A category's Calculation (shared/data.js categoryCalcMode); points when
// the data layer isn't loaded.
function _categoryMode(category) {
  return typeof categoryCalcMode === 'function' ? categoryCalcMode(category) : 'points';
}

/* One assessment's { earned, possible } for the course %, before its Factor,
   or null when it doesn't count (not graded, excused). Points work counts
   its points, rubric work its criteria's points (6 of 10 = 60%), not a
   level; other proficiency work its level as points out of 4. */
function _assessmentEarnedPossible(cid, studentId, assessment) {
  if (isPointsScored(assessment)) return _assessmentPoints(cid, studentId, assessment) || null;
  var rubricPts = _rubricAssessmentPoints(cid, studentId, assessment);
  if (rubricPts !== undefined) return rubricPts || null;
  var level = getAssessmentOverallScore(cid, studentId, assessment.id);
  if (level == null) return null;
  return { earned: _levelPoints(cid, level), possible: 4 };
}

/* A student's grade on any group of assessments (a category, a module, an
   assignment type, a rubric's assessments), as the class shows grades.
   prof: the mean of the scored assessments' overall levels, each counted
   its Factor times, as a category's
   average is worked out (getCategoryAverage). pct: points earned out of
   points possible (getAssessmentGroupPercentage), or the average of
   percents for a category set to it (calcMode, as categoryCalcMode gives
   it; any other group is points). A Proficiency class shows the level, a
   Letter class the letter and %, a Both class both.
   Returns { text, level, prof, pct, count, letter } or null when nothing is
   scored. letter is the letter and % alone ("B 80%"), null in a Proficiency
   class. */
function assessmentGroupGrade(cid, studentId, assessments, calcMode) {
  var levels = _factoredMeanLevel(cid, studentId, assessments);
  var group = getAssessmentGroupPercentage(cid, studentId, assessments, calcMode);
  return _groupGrade(
    cid,
    levels ? levels.mean : null,
    group ? group.pct : null,
    Math.max(levels ? levels.count : 0, group ? group.count : 0),
  );
}

/* The class average on a group of assessments: each student's group grade,
   averaged, as assessmentGroupGrade shows it. */
function classAssessmentGroupGrade(cid, studentIds, assessments, calcMode) {
  var profs = [];
  var pcts = [];
  (studentIds || []).forEach(function (sid) {
    var g = assessmentGroupGrade(cid, sid, assessments, calcMode);
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
  var pctText = shownPct == null ? null : percentageToLetter(shownPct, cid) + ' ' + shownPct + '%';
  var text = mode === 'letter' ? pctText : mode === 'both' ? [profText, pctText].filter(Boolean).join(' · ') : profText;
  var level = mode === 'letter' ? (shownPct == null ? 0 : _percentLevel(shownPct)) : prof > 0 ? Math.round(prof) : 0;
  if (!text) return null;
  return {
    text: text,
    level: level,
    prof: prof,
    pct: pct,
    count: count,
    letter: mode === 'proficiency' ? null : pctText,
  };
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

/* How one group grade sits against another (a type against all the
   student's work), in the grade the class shows first: { value, text, dir },
   value in % points in a Letter class, else in levels; text "+8.0%", "−0.3". */
function groupGradeDiff(cid, mine, ref) {
  if (!mine || !ref) return null;
  var asPct = courseGradeMode(cid) === 'letter';
  var a = asPct ? mine.pct : mine.prof;
  var b = asPct ? ref.pct : ref.prof;
  if (a == null || b == null) return null;
  var d = Math.round((a - b) * 10) / 10;
  var sign = d > 0 ? '+' : d < 0 ? '\u2212' : '';
  return { value: d, text: sign + Math.abs(d).toFixed(1) + (asPct ? '%' : ''), dir: d > 0 ? 1 : d < 0 ? -1 : 0 };
}

/* A group grade on the 0–4 scale, for charts: the level, or in a Letter
   class the % as a level (75% is 3), so formatLevel labels the axis. */
function groupGradeValue(cid, g) {
  if (!g) return null;
  if (courseGradeMode(cid) === 'letter') return g.pct == null ? null : g.pct / 25;
  return g.prof != null ? g.prof : g.pct == null ? null : g.pct / 25;
}

/* A run of dated values on the 0–4 scale, as where it started and where it
   is now: the mean of the first four weeks of values and of the last four.
   A run under eight weeks long splits into its first and second halves.
   points: [{ t (a day number), v }]. Null with fewer than two values or a
   run under two weeks. */
function startAndNow(points) {
  var pts = (points || [])
    .filter(function (p) {
      return p && p.v != null && p.t != null && isFinite(p.v);
    })
    .slice()
    .sort(function (a, b) {
      return a.t - b.t;
    });
  if (pts.length < 2) return null;
  var t0 = pts[0].t;
  var t1 = pts[pts.length - 1].t;
  if (t1 - t0 < 14) return null;
  var win = t1 - t0 >= 56 ? 28 : (t1 - t0) / 2;
  var mean = function (list) {
    return (
      list.reduce(function (s, p) {
        return s + p.v;
      }, 0) / list.length
    );
  };
  var first = pts.filter(function (p) {
    return p.t <= t0 + win;
  });
  var last = pts.filter(function (p) {
    return p.t >= t1 - win;
  });
  return { start: mean(first), now: mean(last), startCount: first.length, nowCount: last.length };
}

/* Where a student's work started and where it is now (the phone card's
   growth line), in the grade the class shows first. A Letter class reads
   each piece's % as the course % counts it (Missing is 0, Excused left
   out); a Proficiency or Both class reads each competency score that counts
   (tagIds; no 0% category work). Start and now are the means of the first
   and last weeks (startAndNow), so one early or late score doesn't decide
   it. Returns { startText, nowText, change, dir, count } (count:
   assessments), with startText null when the work spans under two weeks;
   null when there is no work. */
function studentGrowthLine(cid, sid, tagIds) {
  var letter = courseGradeMode(cid) === 'letter';
  var points = [];
  var ids = {};
  var day = function (d) {
    var t = d ? Math.floor(Date.parse(d) / 86400000) : NaN;
    return isFinite(t) ? t : null;
  };
  if (letter) {
    _scopedAssessments(cid).forEach(function (a) {
      if (isDibelsScored(a) || !countsTowardGrades(cid, a)) return;
      var g = getAssessmentGroupPercentage(cid, sid, [a]);
      if (!g) return;
      ids[a.id] = true;
      points.push({ t: day(a.date), v: g.pct });
    });
  } else {
    (tagIds || []).forEach(function (tid) {
      getCountedTagScores(cid, sid, tid).forEach(function (e) {
        if (!(e.score > 0)) return;
        ids[e.assessmentId] = true;
        points.push({ t: day(e.date), v: Number(e.score) });
      });
    });
  }
  if (!points.length) return null;
  var digits = getRoundWholePercent(cid) ? 0 : 1;
  var text = function (v) {
    if (letter) return _roundPercent(v, digits) + '%';
    var word = levelWord(cid, v);
    return formatLevel(cid, v) + (word ? ' ' + word : '');
  };
  var count = Object.keys(ids).length;
  var run = startAndNow(points);
  if (!run) {
    var mean =
      points.reduce(function (t, p) {
        return t + p.v;
      }, 0) / points.length;
    return { startText: null, nowText: text(mean), change: '', dir: 0, count: count };
  }
  var change;
  var dir;
  if (letter) {
    var d = Math.round((_roundPercent(run.now, digits) - _roundPercent(run.start, digits)) * 10) / 10;
    dir = d > 0 ? 1 : d < 0 ? -1 : 0;
    change = dir ? (dir > 0 ? '+' : '\u2212') + Math.abs(d) + '%' : '';
  } else {
    change = levelChange(run.start, run.now);
    dir = change.charAt(0) === '+' ? 1 : change.charAt(0) === '\u2212' ? -1 : 0;
    if (!dir) change = '';
  }
  return { startText: text(run.start), nowText: text(run.now), change: change, dir: dir, count: count };
}

/* The mean of a student's score entries (getTagScores), each at the value
   the calculations use (3+ is 3.33). Null when there are none. */
function averageLevels(entries) {
  var vals = (entries || [])
    .map(function (e) {
      return Number(e.score);
    })
    .filter(function (v) {
      return v > 0;
    });
  return vals.length
    ? vals.reduce(function (s, v) {
        return s + v;
      }, 0) / vals.length
    : null;
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
      _categoryMode(category),
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
  var status = _scoreRead.status(cid, studentId, assessment.id);
  if (status === 'EXC' || status === 'NS') return null;
  var keys = rubricCriterionScoreKeys(criterion);
  var values = (_scoreRead.scores(cid)[studentId] || [])
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
        _categoryMode(category),
      );
      if (pct == null) return;
      pctSum += weight * pct.pct;
      pctWeight += weight;
    });
    if (weightTotal > 0) Q = weightedSum / weightTotal;
    if (pctWeight > 0) R = pctSum / pctWeight;
  } else {
    var levels = _factoredMeanLevel(cid, studentId, assessments);
    if (levels) Q = levels.mean;
    var all = getAssessmentGroupPercentage(cid, studentId, assessments);
    if (all) R = all.pct;
  }

  // The letter comes from the % as shown, so 85.95 shows as 86% and an A,
  // and in a class that rounds to a whole %, 85.5 does too.
  var shown = R == null ? null : _roundPercent(R, getRoundWholePercent(cid) ? 0 : 1);
  var result = {
    Q: Q,
    R: shown,
    S: percentageToLetter(shown, cid),
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
/* The course's rubric criteria by id: { tagIds, name, rubricId }, for
   rolling a criterion's score up to its competencies. */
function _criterionIndex(cid) {
  var key = _ck(cid);
  if (_criterionIndexCache[key]) return _criterionIndexCache[key];
  var index = {};
  var rubrics = typeof getRubrics === 'function' ? getRubrics(cid) || [] : [];
  rubrics.forEach(function (rubric) {
    ((rubric && rubric.criteria) || []).forEach(function (c) {
      if (c && c.id)
        index[c.id] = { tagIds: (c.tagIds || []).slice(), name: c.name || 'Criterion', rubricId: rubric.id };
    });
  });
  _criterionIndexCache[key] = index;
  return index;
}

/* The course's rubrics' whole-rubric competencies by rubric id. */
function _rubricWholeIndex(cid) {
  var key = _ck(cid) + ':whole';
  if (_criterionIndexCache[key]) return _criterionIndexCache[key];
  var index = {};
  var rubrics = typeof getRubrics === 'function' ? getRubrics(cid) || [] : [];
  rubrics.forEach(function (rubric) {
    if (rubric && rubric.id && (rubric.tagIds || []).length) index[rubric.id] = rubric.tagIds.slice();
  });
  _criterionIndexCache[key] = index;
  return index;
}

// The rubric an assessment is scored with, or null.
function _assessmentRubric(cid, assessment) {
  var rubricId = assessment && (assessment.rubricId || assessment.rubric_id);
  if (!rubricId || isPointsScored(assessment) || typeof getRubricById !== 'function') return null;
  return getRubricById(cid, rubricId) || null;
}

/* The competencies an assessment's rubric scores as a whole (rubric.tagIds):
   each gets one combined level per student (wholeRubricLevel), not one per
   criterion. A competency is on the whole rubric or on criteria, never both;
   where both, the whole rubric wins. [] for work with no rubric. */
function rubricWholeTagIds(cid, assessment) {
  var rubric = _assessmentRubric(cid, assessment);
  return ((rubric && rubric.tagIds) || []).slice();
}

/* The competencies a rubric scores, each once: its criteria's in criterion
   order, then the whole rubric's (rubric.tagIds). Every view that lists a
   rubric's competencies reads them here. */
function rubricScoredTagIds(rubric) {
  var out = [];
  ((rubric && rubric.criteria) || []).forEach(function (c) {
    ((c && c.tagIds) || []).forEach(function (t) {
      if (out.indexOf(t) < 0) out.push(t);
    });
  });
  ((rubric && rubric.tagIds) || []).forEach(function (t) {
    if (out.indexOf(t) < 0) out.push(t);
  });
  return out;
}

/* A student's combined level on a rubric assessment, for a whole-rubric
   competency: the rubric's weighted 0-4 average (getRubricAssessmentScore)
   as a percent of 4, read through the class's Points to Proficiency table,
   as a points score is. { score, mod: 0, mixed: false, whole: true,
   average }, or null when no criterion is scored. `entries` may hold the
   student's other scores too. */
function wholeRubricLevel(cid, sid, assessment, entries) {
  var average = getRubricAssessmentScore(cid, assessment, entries || _scoreRead.scores(cid)[sid] || []);
  if (average == null) return null;
  return {
    score: pointsToProf(average, 4, getGradingScale(cid)),
    mod: 0,
    mixed: false,
    whole: true,
    average: average,
  };
}

/* The criteria of an assessment's rubric that feed a competency (every
   criterion, for a whole-rubric competency); [] for work with no rubric. A
   view can look them up once per column and pass them to
   competencyLevelFromCriteria. */
function rubricCriteriaForTag(cid, assessment, tagId) {
  var rubric = _assessmentRubric(cid, assessment);
  var whole = ((rubric && rubric.tagIds) || []).indexOf(tagId) >= 0;
  return ((rubric && rubric.criteria) || []).filter(function (c) {
    return c && c.id && (whole || (c.tagIds || []).indexOf(tagId) >= 0);
  });
}

/* The competencies a rubric assessment scores, through its criteria in
   criterion order, then the whole rubric's, without repeats; [] for work
   with no rubric. */
function rubricCompetencyIds(cid, assessment) {
  return rubricScoredTagIds(_assessmentRubric(cid, assessment));
}

/* A student's level on one competency of a rubric assessment, from the
   criteria that feed it: one scored criterion gives its level and ±;
   several that agree give that; several that disagree give the lowest,
   ± counted (3− is below 3), with its ±, marked mixed. Null when none is scored or
   the work has no rubric. Competency proficiency itself counts each
   criterion as its own evidence (getTagScores). A whole-rubric competency
   gets its one combined level (wholeRubricLevel). */
function competencyLevelFromCriteria(cid, sid, assessment, tagId, criteria) {
  if (rubricWholeTagIds(cid, assessment).indexOf(tagId) >= 0) return wholeRubricLevel(cid, sid, assessment);
  if (!criteria) criteria = rubricCriteriaForTag(cid, assessment, tagId);
  if (!criteria.length) return null;
  var entries = _scoreRead.scores(cid)[sid] || [];
  var levels = [];
  var mods = [];
  criteria.forEach(function (c) {
    var e = entries.find(function (x) {
      return x.assessmentId === assessment.id && x.tagId === c.id;
    });
    var v = e ? Number(e.score) || 0 : 0;
    if (!v) return;
    levels.push(v);
    mods.push(normalizeScoreMod(v, e.mod));
  });
  if (!levels.length) return null;
  var same = levels.every(function (l, i) {
    return l === levels[0] && mods[i] === mods[0];
  });
  if (same) return { score: levels[0], mod: mods[0], mixed: false };
  var low = 0;
  levels.forEach(function (l, i) {
    if (l + mods[i] * SCORE_MOD_STEP < levels[low] + mods[low] * SCORE_MOD_STEP) low = i;
  });
  return { score: levels[low], mod: mods[low], mixed: true };
}

/* The rows of a rubric assessment's Competencies view, on desktop and
   phone alike: each competency its criteria feed, then any criterion that
   feeds none, by its own id. A whole-rubric competency has no row: its
   level is worked out from all the criteria. Work with no rubric
   competencies gets its usual score keys (scoreTagIds). */
function rubricCompetencyRowKeys(cid, assessment) {
  var comps = rubricCompetencyIds(cid, assessment);
  if (!comps.length) return scoreTagIds(assessment, cid);
  var rubric = _assessmentRubric(cid, assessment);
  var whole = rubricWholeTagIds(cid, assessment);
  return comps
    .filter(function (t) {
      return whole.indexOf(t) < 0;
    })
    .concat(
      ((rubric && rubric.criteria) || [])
        .filter(function (c) {
          return c && c.id && !(c.tagIds || []).length;
        })
        .map(function (c) {
          return c.id;
        }),
    );
}

/* Where a level set on one row of that view is saved: a competency's level
   goes to every criterion that feeds it; a whole-rubric competency takes
   none (its criteria are scored one by one); any other key is itself. */
function rubricRowScoreKeys(cid, assessment, key) {
  if (rubricWholeTagIds(cid, assessment).indexOf(key) >= 0) return [];
  var crits = rubricCriteriaForTag(cid, assessment, key);
  return crits.length
    ? crits.map(function (c) {
        return c.id;
      })
    : [key];
}

/* The score keys a column's ids name on an assessment: a criterion id is
   itself; on rubric work a competency id is every criterion that feeds it. */
function _columnScoreKeys(cid, assessment, ids) {
  var keys = [];
  ids.forEach(function (id) {
    var crits = rubricCriteriaForTag(cid, assessment, id);
    (crits.length
      ? crits.map(function (c) {
          return c.id;
        })
      : [id]
    ).forEach(function (k) {
      if (keys.indexOf(k) < 0) keys.push(k);
    });
  });
  return keys;
}

function getTagScores(cid, studentId, tagId) {
  var cacheKey = _ck(cid) + ':' + studentId + ':' + tagId;
  if (_tagScoresCache[cacheKey]) return _tagScoresCache[cacheKey];

  // In counting order, so the evidence below comes out in it too.
  const studentScores = _orderedEntries(cid, studentId);
  const statuses = _scoreRead.statuses(cid);
  // Use Map for O(1) lookup instead of O(n) find() per score entry
  const assessMap = _getAssessMap(cid);
  const criteria = _criterionIndex(cid);
  const wholeByRubric = _rubricWholeIndex(cid);
  const wholeSeen = {};
  // As of a report, a score only counts when its assessment is in the year
  // to date (dated on or before the report's end, or undated). Both keep a
  // score whose assessment is gone.
  const termActive = !!_activeTerm[cid];
  const everyIds = termActive ? _everyAssessmentIds(cid) : null;
  const filtered = [];
  studentScores.forEach(s => {
    // Only what the piece measures now is evidence (_pieceMeasures).
    if (!_pieceMeasures(cid, s.assessmentId, s.tagId)) return;
    let entry = s;
    if (s.tagId !== tagId) {
      const crit = criteria[s.tagId];
      if (!crit) return;
      const a = assessMap.get(s.assessmentId);
      if (a && (a.rubricId || a.rubric_id) !== crit.rubricId) return;
      if ((wholeByRubric[crit.rubricId] || []).indexOf(tagId) >= 0) {
        // A whole-rubric competency: the rubric's criteria give one
        // combined entry per assessment (wholeRubricLevel), made at the
        // first of them.
        if (!a || wholeSeen[s.assessmentId]) return;
        wholeSeen[s.assessmentId] = true;
        const whole = wholeRubricLevel(cid, studentId, a, studentScores);
        if (!whole) return;
        entry = { ...s, tagId: tagId, score: whole.score, wholeRubric: true, rubricAverage: whole.average };
        delete entry.mod;
      } else {
        // A rubric criterion's score, under the criterion's id, is evidence
        // for each competency the criterion feeds.
        if (crit.tagIds.indexOf(tagId) < 0) return;
        entry = { ...s, tagId: tagId, criterionId: s.tagId, criterionName: crit.name };
      }
    }
    // As of a report, a score drops out only when its assessment is dated
    // after the report's end. A score whose assessment is gone stays, as it
    // does in the year so far, so the gradebook and the report agree.
    if (termActive && !assessMap.has(entry.assessmentId) && everyIds.has(entry.assessmentId)) return;
    /* Excused work is left out. So is Missing work (Colin, 2026-11-09:
       "Missing wins everywhere"): a piece marked Missing counts no level,
       even if one is still stored for it. What Missing does to the course %
       and to the average of levels is decided where those are worked out,
       and is not changed. */
    const status = statuses[studentId + ':' + entry.assessmentId];
    if (status === 'EXC' || status === 'NS') return;
    filtered.push(entry);
  });
  // Convert points-mode scores to proficiency
  const scale = getGradingScale(cid);
  var result = filtered.map(s => {
    const assess = assessMap.get(s.assessmentId);
    if (isPointsScored(assess) && assess.maxPoints > 0) {
      // A points 0 is a score (0% is the lowest level, like Incomplete); an
      // entry with no score, which only carries a comment, is no score.
      if (!isScoreEntered(assess, s)) return null;
      return { ...s, rawPoints: s.score, score: pointsToProf(s.score, assess.maxPoints, scale) };
    }
    // A + or − counts in every calculation (3+ = 3.33). `level` keeps the
    // whole-number level for display.
    if (s.score > 0 && normalizeScoreMod(s.score, s.mod)) {
      return { ...s, level: s.score, score: scoreModValue(s) };
    }
    return s;
  });
  result = result.filter(Boolean);
  _tagScoresCache[cacheKey] = result;
  return result;
}

/* A competency's scores with one entry per assessment, for a timeline: the
   rubric criteria that feed the competency on one assessment average into
   one point (its score is their mean, with no whole level or ±, and
   criterionIds names them). Other entries pass through. Proficiency itself
   counts each criterion as its own evidence (getTagScores). */
function tagScoresByAssessment(cid, studentId, tagId) {
  var out = [];
  var merged = {};
  getTagScores(cid, studentId, tagId).forEach(function (s) {
    if (!(s.score > 0) || !s.criterionId) {
      out.push(s);
      return;
    }
    var cur = merged[s.assessmentId];
    if (!cur) {
      cur = Object.assign({}, s, { criterionIds: [s.criterionId] });
      merged[s.assessmentId] = cur;
      out.push(cur);
      return;
    }
    var n = cur.criterionIds.length;
    cur.score = (cur.score * n + Number(s.score)) / (n + 1);
    cur.criterionIds.push(s.criterionId);
    delete cur.level;
    delete cur.mod;
    delete cur.criterionId;
    delete cur.criterionName;
  });
  return out;
}

/* A competency's mark on each piece of work, one entry per assessment, as
   the gradebook's competency cell shows it: rubric criteria that feed the
   competency give their one level, or the lowest when they disagree
   (competencyLevelFromCriteria), its ± counted in score. Other entries pass
   through as getTagScores gives them. */
function tagMarksByAssessment(cid, studentId, tagId) {
  var out = [];
  var seen = {};
  var assessMap = _getAssessMap(cid);
  getTagScores(cid, studentId, tagId).forEach(function (s) {
    if (!s.criterionId) {
      out.push(s);
      return;
    }
    if (seen[s.assessmentId]) return;
    seen[s.assessmentId] = true;
    var a = assessMap.get(s.assessmentId);
    var lv = a ? competencyLevelFromCriteria(cid, studentId, a, tagId) : null;
    if (!lv) return;
    var mark = Object.assign({}, s, { score: scoreModValue(lv), mixed: lv.mixed });
    delete mark.criterionId;
    delete mark.criterionName;
    delete mark.level;
    delete mark.mod;
    if (lv.mod) Object.assign(mark, { level: lv.score, mod: lv.mod });
    out.push(mark);
  });
  return out;
}

/* Whether an assessment counts toward a student's grades. Work in a 0%
   category counts toward nothing: not the course % and not competency
   proficiency. It still shows as evidence. */
function countsTowardGrades(cid, assessment) {
  var categoryId = assessment && (assessment.categoryId || assessment.category_id);
  if (!categoryId) return true;
  var category = getCategoryById(cid, categoryId);
  return !category || Number(category.weight || 0) > 0;
}

/** getTagScores without the scores that count toward nothing (0% category work).
 * The proficiency calculations use these; evidence lists use getTagScores.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} tagId - Learning tag ID
 * @returns {Score[]} Score entries that count toward the competency level
 */
function getCountedTagScores(cid, studentId, tagId) {
  var assessMap = _getAssessMap(cid);
  return getTagScores(cid, studentId, tagId).filter(function (s) {
    var assessment = assessMap.get(s.assessmentId);
    return !assessment || countsTowardGrades(cid, assessment);
  });
}

/* Which side of the legacy summative / formative split a score falls on:
   work in a category is 'categorized', work with none 'uncategorized'
   (counted only when a competency has no categorized evidence). Read from
   the assessment's category alone: the server loads uncategorized work as
   formative, while work just made on this device was created summative, so
   reading its type made a level change on reload. */
function _assessmentScoreBucket(cid) {
  var assessMap = _getAssessMap(cid);
  return function (score) {
    var assessment = assessMap.get(score.assessmentId);
    if (!assessment) return score && score.type === 'formative' ? 'uncategorized' : 'categorized';
    return assessment.categoryId || assessment.category_id ? 'categorized' : 'uncategorized';
  };
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
  const method = cc.calcMethod || course.calcMethod || 'average';
  const dw = cc.decayWeight != null ? cc.decayWeight : course.decayWeight || 0.65;
  const scores = getCountedTagScores(cid, studentId, tagId);
  const cw = getCategoryWeights(cid);
  const aw = _getAW(cid);
  var result = calcProficiency(scores, method, dw, {
    categoryWeights: cw,
    assessmentWeights: aw,
    recentLimit: getRecentScoreLimit(cid),
    getScoreBucket: _assessmentScoreBucket(cid),
  });
  _tagProfCache[cacheKey] = result;
  return result;
}

/** A section's proficiency: the level the teacher set by hand when there is
 * one in view (sectionOverrideInView), else the average of its tags.
 *
 * A level set by hand stands on its own. It applies whether or not the
 * section has scored work under it, in all work and in returned grades alike
 * (Colin, 2026-11-09: "Show the hand-set level now"; DECISIONS, "Student
 * page build rulings" 14). So it counts in the folder and the overall like
 * any other section's level. It is not evidence: the section's evidence
 * count, trend, growth and calculated level (getSectionProficiencyRaw) still
 * say there is none, and it never touches the course % or letter, which come
 * from the work itself.
 * @param {string} cid - Course ID
 * @param {string} studentId - Student ID
 * @param {string} sectionId - Section ID
 * @returns {number} Proficiency level (0-4), or 0 with no evidence and no level set by hand
 */
function getSectionProficiency(cid, studentId, sectionId) {
  const section = _getSectionById(cid, sectionId);
  if (!section) return 0;
  const override = sectionOverrideInView(cid, studentId, sectionId);
  if (override) return override.level;
  return getSectionProficiencyRaw(cid, studentId, sectionId);
}

/** The teacher's override for a section when it applies to the grade in
 * view: always for the year so far; for a report, only when the override's
 * date is on or before the report's end (an undated override applies
 * everywhere). Null otherwise (DECISIONS, Reporting periods 4). */
function sectionOverrideInView(cid, studentId, sectionId) {
  const override = getSectionOverride(cid, studentId, sectionId);
  if (!override || !(override.level > 0)) return null;
  const t = _activeTerm[cid];
  const d = override.date ? String(override.date).slice(0, 10) : '';
  if (t && t.endsOn && d && d > t.endsOn) return null;
  return override;
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
      // 0 when the section has no scored work: nothing was calculated.
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
  return rollUpSectionLevels(cid, function (sec) {
    return getSectionProficiency(cid, studentId, sec.id);
  });
}

/* "Folders Count as One" (course.folders_count_as_one): on by default, a
   class averages each folder first and counts it as one competency. Off,
   the overall is the plain mean of every competency. */
function getFoldersCountAsOne(cid) {
  var cc = (typeof getCourseConfig === 'function' && getCourseConfig(cid)) || {};
  return cc.foldersCountAsOne !== false;
}

/* Whether a folder is averaged first in the overall: the class counts
   folders as one and the folder's own "Counts as One"
   (competency_group.counts_as_one) is on. Both default on. */
function folderCountsAsOne(cid, groupOrId) {
  if (!getFoldersCountAsOne(cid)) return false;
  var group = groupOrId;
  if (typeof groupOrId === 'string') {
    group = (typeof getCompetencyGroupById === 'function' && getCompetencyGroupById(cid, groupOrId)) || null;
  }
  return !group || group.countsAsOne !== false;
}

/* The note a teacher view shows beside a folder's average when that
   folder isn't counted as one, so its average isn't read as part of the
   overall. Empty when it is. */
function folderAverageNote(cid, groupOrId) {
  return folderCountsAsOne(cid, groupOrId) ? '' : 'Each competency counts on its own.';
}

/* "Each Course Counts Equally" (course.courses_count_equally): off by
   default. On, a combined class rolls up each course (subject) on its own
   and averages the courses, so a course with more competencies or folders
   doesn't outweigh the other. Only matters with two or more courses. */
function getCoursesCountEqually(cid) {
  var cc = (typeof getCourseConfig === 'function' && getCourseConfig(cid)) || {};
  return cc.coursesCountEqually === true;
}

/* The courses (subjects) that hold competencies, in learning-map order. */
function courseSubjectIds(cid) {
  var ids = [];
  getSections(cid).forEach(function (sec) {
    if (sec.subject && ids.indexOf(sec.subject) < 0) ids.push(sec.subject);
  });
  return ids;
}

/* An overall level from a level per competency, rolled up as
   getOverallProficiency does: with no groups, the mean of the competencies;
   with groups, one mean per folder that counts as one, plus each other
   competency, then the mean of those. With Folders Count as One off, the
   mean of every competency. With Each Course Counts Equally on and two or
   more courses, each course rolls up that way on its own and the overall
   is the mean of the courses. `levelOf(section)` is 0 for a competency with
   no level, which is left out. A report's "then" column rolls up the same
   way as its "now". */
function rollUpSectionLevels(cid, levelOf) {
  var mean = function (list) {
    var v = list.filter(function (p) {
      return p > 0;
    });
    return v.length
      ? v.reduce(function (a, b) {
          return a + b;
        }, 0) / v.length
      : 0;
  };
  var grouped = getGroupedSections(cid);
  // The roll-up of the competencies `keep` lets through.
  var rollUp = function (keep) {
    var groups = grouped.groups.map(function (gi) {
      return { group: gi.group, sections: gi.sections.filter(keep) };
    });
    var hasGroups = groups.some(function (g) {
      return g.sections.length > 0;
    });
    if (!hasGroups || !getFoldersCountAsOne(cid)) return mean(getSections(cid).filter(keep).map(levelOf));
    var values = [];
    groups.forEach(function (gi) {
      if (!gi.sections.length) return;
      if (folderCountsAsOne(cid, gi.group)) values.push(mean(gi.sections.map(levelOf)));
      else
        gi.sections.forEach(function (sec) {
          values.push(levelOf(sec));
        });
    });
    grouped.ungrouped.filter(keep).forEach(function (sec) {
      values.push(levelOf(sec));
    });
    return mean(values);
  };
  var all = function () {
    return true;
  };
  if (getCoursesCountEqually(cid)) {
    var subjects = courseSubjectIds(cid);
    if (subjects.length > 1)
      return mean(
        subjects.map(function (subjectId) {
          return rollUp(function (sec) {
            return sec.subject === subjectId;
          });
        }),
      );
  }
  return rollUp(all);
}

/** Convert an average proficiency to a letter grade and percentage for PHIL12.
 * @param {number} avgProf - Average proficiency (0-4)
 * @param {string} [cid] - Class, for IE before the course ends
 * @returns {{letter: string, pct: number}} Letter grade and corresponding percentage
 */
function calcLetterGrade(avgProf, cid) {
  var pct = levelToPercent(cid, avgProf);
  return { letter: percentageToLetter(pct, cid), pct: pct == null ? null : Math.round(pct * 10) / 10 };
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
    getCountedTagScores(cid, studentId, tag.id)
      .filter(_isScoredEvidence)
      .forEach(s => allScores.push(s));
  });
  if (allScores.length < 2) return 'flat';
  allScores.sort(_evidenceCompare(cid));
  const recent = allScores[allScores.length - 1].score;
  const prev = allScores[allScores.length - 2].score;
  if (recent > prev) return 'up';
  if (recent < prev) return 'down';
  return 'flat';
}

/* How a run of evidence moved, in the words a teacher reads: its first and
   last scored entries by date, compared by the whole level their words name,
   so 3 to 3+ is Proficient both times, no change. { first, last (1–4), dir
   (1 up, -1 down, 0), same (every entry at one level), count }, or null with
   fewer than two. */
function evidenceChange(entries) {
  var list = (entries || [])
    .filter(_isScoredEvidence)
    .slice()
    .sort(function (a, b) {
      return (a.date || '').localeCompare(b.date || '');
    });
  if (list.length < 2) return null;
  var lv = function (e) {
    return Math.max(1, Math.min(4, Math.round(Number(e.score))));
  };
  var first = lv(list[0]);
  var last = lv(list[list.length - 1]);
  return {
    first: first,
    last: last,
    dir: last > first ? 1 : last < first ? -1 : 0,
    same: list.every(function (e) {
      return lv(e) === first;
    }),
    count: list.length,
  };
}

/* A section's evidence that counts toward its level (getCountedTagScores),
   every competency in it together. */
function sectionCountedEvidence(cid, studentId, sectionId) {
  var section = _getSectionById(cid, sectionId);
  if (!section) return [];
  var out = [];
  section.tags.forEach(function (tag) {
    getCountedTagScores(cid, studentId, tag.id)
      .filter(_isScoredEvidence)
      .forEach(function (s) {
        out.push(s);
      });
  });
  return out.sort(_evidenceCompare(cid));
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
  // The student's weakest assessed competencies, lowest first. Ones nobody
  // has assessed yet are the same for every student in the class and say
  // nothing about this one, so they are left out (Step 4 sweep, Nov 3).
  return scored
    .filter(x => x.prof > 0)
    .sort((a, b) => a.prof - b.prof)
    .slice(0, maxItems || 3);
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
  var method = cc.calcMethod || course.calcMethod || 'average';
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
  const method = cc.calcMethod || course.calcMethod || 'average';
  const dw = cc.decayWeight != null ? cc.decayWeight : course.decayWeight || 0.65;

  // Collect all scored evidence across all tags in this section.
  const allScores = [];
  section.tags.forEach(tag => {
    getCountedTagScores(cid, studentId, tag.id)
      .filter(_isScoredEvidence)
      .forEach(s => allScores.push({ ...s, _tagId: tag.id }));
  });
  if (allScores.length === 0) return [];

  // Get unique dates sorted chronologically
  const dates = [...new Set(allScores.map(s => s.date))].sort();

  // Build opts for calcProficiency (matching getTagProficiency pattern)
  const cw = getCategoryWeights(cid);
  const aw = _getAW(cid);
  const opts = {
    categoryWeights: cw,
    assessmentWeights: aw,
    recentLimit: getRecentScoreLimit(cid),
    getScoreBucket: _assessmentScoreBucket(cid),
  };

  // Sort allScores once by date, then use a running pointer — O(n) instead of O(n²).
  // For each date, advance the pointer to include all scores up to that date,
  // accumulating them into a per-tag Map so grouping is also O(1) per score.
  allScores.sort(_evidenceCompare(cid));
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
  for (var i = 0; i < BC_LETTER_BANDS.length; i++) {
    if (pct >= BC_LETTER_BANDS[i].min) return BC_LETTER_BANDS[i].level;
  }
  return 1;
}

/* A level from 0 to 4 as the class shows it; `empty` (default "—") when
   there is none. */
function formatLevel(cid, value, empty) {
  if (!(value > 0)) return empty === undefined ? '\u2014' : empty;
  return _levelAtPercent(cid, value, levelToPercent(cid, value));
}

/* A level as the class shows it, with the percent it is shown as. */
function _levelAtPercent(cid, value, percent) {
  var mode = courseGradeMode(cid);
  var num = Number(value).toFixed(1);
  var pct = Math.round(percent) + '%';
  if (mode === 'letter') return pct;
  if (mode === 'both') return num + ' \u00B7 ' + pct;
  return num;
}

/* How full a bar for a level from 0 to 4 is, 0–100, so it agrees with the
   figure beside it (formatLevel): the % the level counts as (Counts As) in a
   Letter or Both class, level ÷ 4 in a Proficiency class. */
function levelBarPercent(cid, value) {
  if (!(value > 0)) return 0;
  var v = Math.min(4, Number(value));
  if (courseGradeMode(cid) === 'proficiency') return (v / 4) * 100;
  return Math.min(100, levelToPercent(cid, v));
}

/* A level from 0 to 4 as a figure, "3.3", for a block that prints the
   score out of 4 whatever the class's grading style; `empty` when there is
   none. The one place a level is rounded to a decimal. */
function levelFigure(value, empty) {
  if (!(value > 0)) return empty === undefined ? '\u2014' : empty;
  return Number(value).toFixed(1);
}

/* The change between two printed figures, so 3.1 to 3.0 reads "−0.1";
   "—" when either side has no level. */
function levelChange(before, after) {
  if (!(before > 0 && after > 0)) return '\u2014';
  var d = Math.round(after * 10) - Math.round(before * 10);
  return (d > 0 ? '+' : d < 0 ? '\u2212' : '') + (Math.abs(d) / 10).toFixed(1);
}

/* The change between two levels as the class reads it: levels for a
   Proficiency or Both class ("+0.2", levelChange), points of a percent for a
   Letter class ("+5%", each level's percent rounded first, as formatLevel
   prints it). "—" when either side has no level. */
function levelChangeAs(cid, before, after) {
  if (courseGradeMode(cid) !== 'letter') return levelChange(before, after);
  if (!(before > 0 && after > 0)) return '\u2014';
  var d = Math.round(levelToPercent(cid, after)) - Math.round(levelToPercent(cid, before));
  return (d > 0 ? '+' : d < 0 ? '\u2212' : '') + Math.abs(d) + '%';
}

/* A level printed as the teacher chose rather than as the class shows it:
   'percent' gives "75%" (the percent the level counts as in the class),
   anything else the proficiency, "3.0". The printed grade sheet's Scores
   choice. */
function formatLevelAs(cid, value, as, empty) {
  if (!(value > 0)) return empty === undefined ? '\u2014' : empty;
  if (as === 'percent') return Math.round(levelToPercent(cid, value)) + '%';
  return Number(value).toFixed(1);
}

/* A points score as a % of the assessment's most, "90%". */
function formatPointsPercent(points, maxPoints) {
  var max = Number(maxPoints) || 100;
  return Math.round((Number(points) / max) * 100) + '%';
}

/* What one gradebook cell shows: one student on one assessment, as the
   Scores view draws it and the printed grade sheet prints it. Work is
   missing only when it is labelled Missing (status 'NS'), whatever its due
   date; an empty cell past its due date is still kind 'none'.

   Returns { kind, value, level, text, status, late, mark, outOfRange }:
   - kind 'status': Not submitted or Excused replaces the score (status 'NS'
     or 'EXC', text the same).
   - kind 'complete': a Complete/Incomplete mark (mark 'complete' or
     'incomplete', value 1 or 0, text ✓ or ✗).
   - kind 'points' or 'level': a score; value is the points or the level
     (with its ±), level the 1-4 band the cell's colour comes from, text
     through formatPoints or formatLevel. A level also has percent and
     percentText ("87%"), the % the piece counts as in its category, so a
     piece alone in its category shows the category's %: rubric work its
     criteria's percents by weight (Colin, 2026-11-03), other work the % its
     level counts as. text uses that %.
   - kind 'none': no score yet, text '—'.
   `late` is true when the cell is marked Late (it keeps its score). */
function assessmentCellValue(cid, sid, assessment) {
  var a = assessment;
  var entries = _scoreRead.scores(cid)[sid] || [];
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
  var pointsVal = isPoints && !isComplete ? _scoreRead.pointsScore(cid, sid, a.id) : null;
  if (pointsVal != null) val = pointsVal;
  var status = _scoreRead.status(cid, sid, a.id);
  var out = {
    kind: 'none',
    value: 0,
    level: 0,
    text: '—',
    status: status || null,
    late: status === 'LATE',
    mark: null,
    outOfRange: false,
  };
  if (status === 'NS' || status === 'EXC') {
    out.kind = 'status';
    out.value = val;
    // Missing work shows as M; the stored status stays 'NS'.
    out.text = status === 'NS' ? 'M' : status;
    return out;
  }
  // A DIBELS benchmark shows the latest window's reading level, as a word;
  // it is never a score and never missing as 0.
  if (isDibelsScored(a)) {
    out.kind = 'dibels';
    var latest = null;
    ['eoy', 'moy', 'boy'].some(function (p) {
      var row = typeof getDibelsScore === 'function' ? _scoreRead.dibels(cid, sid, a.id, p) : null;
      if (row && row.orfWrc != null) latest = { period: p, level: dibelsLevel('orf', p, row.orfWrc) };
      return !!latest;
    });
    if (latest && latest.level) {
      out.text = DIBELS_LEVELS[latest.level].label;
      out.dibels = latest;
    }
    return out;
  }
  var mark = isComplete ? _scoreRead.completionMark(cid, sid, a.id) : null;
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
    out.outOfRange = isScoreOutOfRange(a, val);
    if (isPoints) {
      out.text = formatPoints(val);
      return out;
    }
    var own = rubricVal !== undefined ? getAssessmentGroupPercentage(cid, sid, [a]) : null;
    out.percent = own && own.pct != null ? own.pct : levelToPercent(cid, val);
    out.percentText = Math.round(out.percent) + '%';
    out.text = _levelAtPercent(cid, val, out.percent);
    return out;
  }
  return out;
}

/* The proficiency word shown under a level ("Proficient"). Letter classes
   don't use proficiency words. */
function levelWord(cid, value) {
  if (!(value > 0) || courseGradeMode(cid) === 'letter') return '';
  return PROF_LABELS[Math.round(value)] || '';
}

/* A student's or competency's level (an average) as the class describes it
   on its own: the proficiency word, or the level's % in a Letter class,
   which doesn't use proficiency words. `empty` (default '') with no level.
   One assessment's score keeps its level name (scoreLevelText). */
function levelText(cid, value, empty) {
  if (!(value > 0)) return empty === undefined ? '' : empty;
  return levelWord(cid, value) || formatLevel(cid, value);
}

/* ── What a report prints for the grade ──────────────────────────
   Per student and report, the teacher can report something other than the
   letter (term_rating.reporting_basis; Generate plan PR 3, approved by
   Colin on 2026-10-30): 'ie' prints IE in place of the letter and %, and
   'language_goals' or 'iep_goals' print no letter and no %. Only in Letter
   and Both classes (grades 10–12); a Proficiency class always shows its
   proficiency. 'grade', a missing value (a server without the column) and
   anything unknown are the grade as calculated, IE under 50% included. */
var REPORTING_BASES = ['grade', 'ie', 'language_goals', 'iep_goals'];
var REPORTING_BASIS_TEXT = {
  ie: 'IE',
  language_goals: 'No Letter Grade',
  iep_goals: 'No Letter Grade',
};
/* The line under "No Letter Grade" on the report and the review screen. */
var REPORTING_BASIS_NOTE = {
  ie: 'Insufficient Evidence',
  language_goals: 'Assessed on language goals',
  iep_goals: 'Assessed on IEP goals',
};

/* The report's id for a term ('term-2'), from an id or an ordinal. */
function _reportTermId(term) {
  if (term == null || term === '') return null;
  var m = String(term).match(/(\d+)$/);
  return m ? 'term-' + Number(m[1]) : null;
}

/** The basis a student's report for one term (`termId` 'term-N' or N) prints. */
function reportingBasis(cid, sid, termId) {
  var id = _reportTermId(termId);
  if (!id || courseGradeMode(cid) === 'proficiency') return 'grade';
  var r = typeof getStudentTermRating === 'function' ? getStudentTermRating(cid, sid, id) : null;
  var b = r && r.reportingBasis;
  return REPORTING_BASES.indexOf(b) > 0 ? b : 'grade';
}

/** The report the gradebook's grade follows: the term in view ('term-2'), none in All Time. */
function viewedReportTerm(cid) {
  var t = _activeTerm[cid];
  return t ? 'term-' + t.ordinal : null;
}

/* A student's overall grade in parts: `prof` (the level out of 4) unless the
   class is Letter, `letter` (letter and %) unless it is Proficiency. Each is
   null when the student has nothing to show yet. With `termId` (a report,
   'term-N'), the letter follows that report's reporting basis: IE, or "No
   Letter Grade" for language or IEP goals, each with no %, and `basis` set. */
function studentGradeBadges(cid, sid, termId) {
  var mode = courseGradeMode(cid);
  var out = { prof: null, letter: null };
  if (mode !== 'letter') {
    var overall = getOverallProficiency(cid, sid);
    if (overall > 0) out.prof = { text: overall.toFixed(1), level: Math.round(overall) };
  }
  if (mode !== 'proficiency') {
    var lg = getCourseLetterData(cid, sid);
    if (lg && lg.R != null)
      out.letter = {
        text: (lg.S ? lg.S + ' ' : '') + lg.R + '%',
        grade: lg.S || '',
        pct: lg.R + '%',
        level: _percentLevel(lg.R),
      };
    var basis = termId ? reportingBasis(cid, sid, termId) : 'grade';
    if (basis !== 'grade') {
      out.letter = {
        text: REPORTING_BASIS_TEXT[basis],
        grade: basis === 'ie' ? 'IE' : '',
        pct: '',
        level: basis === 'ie' ? 1 : 0,
        basis: basis,
      };
    }
  }
  return out;
}

/* A level as its short code: EXT, PRF, DEV or EMG for the whole level it
   rounds to (the level its colour and word come from), IE (Insufficient
   Evidence) with none. A +
   or − is already in the value, so 2.67 (3−) is PRF and 3.33 (3+) is PRF. */
function levelCode(value) {
  if (!(value > 0)) return PROF_CODES[0];
  return PROF_CODES[Math.max(1, Math.min(4, Math.round(value)))];
}

/* The grades beside a name in the roster: studentGradeBadges with the
   proficiency as its code ("PRF", titled "Proficient") instead of the level
   out of 4, and IC until the student has a score. Letter classes show only
   the letter and %, as before. */
function studentRosterBadges(cid, sid) {
  var badges = studentGradeBadges(cid, sid);
  var prof = null;
  if (courseGradeMode(cid) !== 'letter') {
    var level = badges.prof ? Math.max(1, Math.min(4, badges.prof.level)) : 0;
    prof = { text: levelCode(level), level: level, title: PROF_LABELS[level] };
  }
  return { prof: prof, letter: badges.letter };
}

/* A student's overall grade as one line, and the level its colour comes
   from (the letter's in a Letter class, else the proficiency's). With
   `termId`, the letter follows that report's reporting basis
   (studentGradeBadges). */
function studentGradeSummary(cid, sid, termId) {
  var b = studentGradeBadges(cid, sid, termId);
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

/* The figure a student's overall grade sorts by, so a sorted list follows
   the grade shown: the course % in a Letter class, else the overall
   proficiency. null when the student has none yet. */
function studentOverallSortValue(cid, sid) {
  if (courseGradeMode(cid) === 'letter') {
    var lg = getCourseLetterData(cid, sid);
    return lg && lg.R != null ? lg.R : null;
  }
  var overall = getOverallProficiency(cid, sid);
  return overall > 0 ? overall : null;
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
    parts.push(percentageToLetter(pct, cid) + ' ' + pct + '%');
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

/* "Report 2": a reporting term by the number the Reports page gives it. */
function reportName(term) {
  return term ? 'Report ' + Number(term.ordinal) : '';
}

/* How the class average moved since the last report, in the grade the
   class shows first (the % in a Letter class, else the proficiency): the
   year to date at the last report's end beside the year to date now (or,
   with a report in view, at its end; Colin, 2026-11-03).
   { text: '\u25B2 0.1', dir: 1, since: 'Report 1' }, dir -1 for down and
   0 (text 'No Change') when it rounds to nothing. Null before the first
   report has ended, or when either has no grades. */
function classGradeChange(cid, studentIds) {
  var prev = previousReportTerm(cid);
  if (!prev) return null;
  var key = courseGradeMode(cid) === 'letter' ? 'pct' : 'prof';
  var now = _classGradeMeans(cid, studentIds)[key];
  var before = readAsOfTerm(cid, prev.ordinal, function () {
    return _classGradeMeans(cid, studentIds)[key];
  });
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
    since: reportName(prev),
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

/* ── A competency month by month (the dashboard's Change view) ──────────
   GRADE MATH (docs/plans/dashboard-cards-plan.md, B.2; for Colin's review).
   competencyMonthlyAverages(cid, studentIds, which, todayStr) averages the
   raw evidence, not the competency level: for each calendar month up to
   today's (todayStr, 'YYYY-MM-DD', defaults to today), each student's mean
   of their counted scores that month (getCountedTagScores: Excused work and
   work that doesn't count toward grades left out, a + or − worth a third of
   a level, points work as its level; scores of 0 left out) on the column's
   competencies (`which.sectionId`, or every section in `which.groupId`),
   then the mean of those students' means, each student counting once. A
   score's month is its own date, else its assessment's; undated scores and
   scores dated after today are left out. Months in which nobody has a
   score are skipped, so the class's first month is its first counted score.
   It is never a grade: the calculation method (average, most recent, decay)
   does not apply, only the month's mean.
   → [{ month: 'YYYY-MM', avg: level 1–4, students: n }] oldest first */
function competencyMonthlyAverages(cid, studentIds, which, todayStr) {
  var today = String(todayStr || (typeof getTodayStr === 'function' ? getTodayStr() : '')).slice(0, 10);
  var thisMonth = today.slice(0, 7);
  var sections = [];
  if (which && which.groupId) {
    var gi = getGroupedSections(cid).groups.find(function (g) {
      return g.group.id === which.groupId;
    });
    sections = gi ? gi.sections : [];
  } else if (which && which.sectionId) {
    var sec = _getSectionById(cid, which.sectionId);
    if (sec) sections = [sec];
  }
  var tagIds = [];
  sections.forEach(function (s) {
    (s.tags || []).forEach(function (t) {
      if (tagIds.indexOf(t.id) < 0) tagIds.push(t.id);
    });
  });
  var assessMap = _getAssessMap(cid);
  var byMonth = {}; // month -> [student means]
  (studentIds || []).forEach(function (sid) {
    var sums = {}; // month -> { total, n }
    tagIds.forEach(function (tid) {
      getCountedTagScores(cid, sid, tid).forEach(function (sc) {
        var v = Number(sc.score);
        if (!(v > 0)) return;
        var d = String(sc.date || _assessmentDate(assessMap.get(sc.assessmentId)) || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || (today && d > today)) return;
        var m = d.slice(0, 7);
        if (thisMonth && m > thisMonth) return;
        var s = sums[m] || (sums[m] = { total: 0, n: 0 });
        s.total += v;
        s.n++;
      });
    });
    Object.keys(sums).forEach(function (m) {
      (byMonth[m] = byMonth[m] || []).push(sums[m].total / sums[m].n);
    });
  });
  return Object.keys(byMonth)
    .sort()
    .map(function (m) {
      var list = byMonth[m];
      return {
        month: m,
        avg:
          list.reduce(function (a, b) {
            return a + b;
          }, 0) / list.length,
        students: list.length,
      };
    });
}

/* How far a competency's class average moved from one level to another, as
   the Change view prints it: points of a percent in a Letter or Both class
   ("↑ 12", each level's percent rounded first, as formatLevel prints it),
   levels to one decimal in a Proficiency class ("↓ 0.4"); "→ 0" when it
   rounds to nothing. { text, dir: 1 | 0 | -1 }; null when either side has
   no level. */
function levelMoveText(cid, first, last) {
  if (!(first > 0 && last > 0)) return null;
  var d, amount;
  if (courseGradeMode(cid) === 'proficiency') {
    d = Math.round(last * 10) - Math.round(first * 10);
    amount = (Math.abs(d) / 10).toFixed(1);
  } else {
    d = Math.round(levelToPercent(cid, last)) - Math.round(levelToPercent(cid, first));
    amount = String(Math.abs(d));
  }
  var dir = d > 0 ? 1 : d < 0 ? -1 : 0;
  return { text: (dir > 0 ? '↑ ' : dir < 0 ? '↓ ' : '→ ') + amount, dir: dir };
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
  return formatColumnAverageLevel(cid, res.avg);
}

/* A Class Average that is a level (classColumnAverage's avg), as `as` asks
   (formatLevelAs's 'percent' or 'proficiency'), or as the class shows it
   (formatLevel) when `as` is left out. Call it only when someone counted.
   In a Letter class Missing counts as 0 in every column, so a column whose
   counted students are all Missing averages 0 and reads "0%", not the "—"
   of a column nobody counts in (Nov 3 bug sweep). It says 0% where the
   column prints proficiency figures too (the CSV, the printed sheet), as
   the screen does: a Letter class has no 0.0 level (Colin, 2026-11-03). */
function formatColumnAverageLevel(cid, avg, as) {
  if (!(avg > 0) && courseGradeMode(cid) === 'letter') return '0%';
  return as ? formatLevelAs(cid, avg, as) : formatLevel(cid, avg);
}

/* How many students sit at each grade, best first: by letter grade (A to F)
   in a Letter class, else by proficiency level (Extending to Emerging).
   A Both class counts by level, the grade it shows first. Each band has the
   `level` its colour comes from and the `ids` of its students; students
   with nothing to show yet aren't counted. */
/* The letter band above a course % (as shown): { letter, min }, the next
   letter up and the % it starts at (82.9 → A at 86). Null at A or with no
   %. Under 50 the next letter is C-. */
function nextLetterBand(R) {
  if (R == null || isNaN(Number(R))) return null;
  for (var i = BC_LETTER_BANDS.length - 1; i >= 0; i--) {
    if (BC_LETTER_BANDS[i].min > Number(R)) return { letter: BC_LETTER_BANDS[i].label, min: BC_LETTER_BANDS[i].min };
  }
  return null;
}

function classGradeDistribution(cid, studentIds) {
  var bands;
  if (courseGradeMode(cid) === 'letter') {
    var under50 = percentageToLetter(0, cid);
    bands = BC_LETTER_BANDS.map(function (b) {
      return { label: b.min === 0 ? under50 : b.label, level: _percentLevel(b.min), ids: [] };
    });
    (studentIds || []).forEach(function (sid) {
      var lg = getCourseLetterData(cid, sid);
      if (!lg || lg.R == null) return;
      var letter = percentageToLetter(lg.R, cid);
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

/* What turning Folders Count as One on or off would do, for its confirm:
   how many students' overall proficiency changes, out of how many, and one
   example. `change` is { on } for the class, or { groupId, on } for one
   folder's Counts as One. Runs the class's own math with the change and
   puts the saved value back. */
function previewFolderCountChange(cid, change) {
  change = change || {};
  var cc = getCourseConfig(cid);
  var group = change.groupId ? getCompetencyGroupById(cid, change.groupId) : null;
  var target = group || cc;
  var field = group ? 'countsAsOne' : 'foldersCountAsOne';
  return _previewOverallChange(cid, target, field, !!change.on);
}

/* What a change to the class's competencies would do to the overall
   proficiency, for its confirm, counted as previewFolderCountChange counts:
   `change(copy)` makes the change on a copy of the learning map, the class's
   own math runs on the copy, and the saved map is put back. */
function previewLearningMapChange(cid, change) {
  var students = getStudents(cid);
  var shown = function (v) {
    return v > 0 ? Number(v).toFixed(1) : '';
  };
  var before = students.map(function (s) {
    return shown(getOverallProficiency(cid, s.id));
  });
  var saved = _cache.learningMaps[cid];
  var copy = structuredClone(getLearningMap(cid));
  var after;
  try {
    change(copy);
    _cache.learningMaps[cid] = copy;
    if (typeof clearProfCache === 'function') clearProfCache();
    after = students.map(function (s) {
      return shown(getOverallProficiency(cid, s.id));
    });
  } finally {
    _cache.learningMaps[cid] = saved;
    if (typeof clearProfCache === 'function') clearProfCache();
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

/* What turning Each Course Counts Equally on or off would do, for its
   confirm, counted as previewFolderCountChange counts. */
function previewCoursesEqualChange(cid, on) {
  return _previewOverallChange(cid, getCourseConfig(cid), 'coursesCountEqually', !!on);
}

/* Runs the class's own math with target[field] = value and puts the saved
   value back: how many students' overall proficiency changes, out of how
   many, and one example. */
function _previewOverallChange(cid, target, field, value) {
  var students = getStudents(cid);
  var shown = function (v) {
    return v > 0 ? Number(v).toFixed(1) : '';
  };
  var before = students.map(function (s) {
    return shown(getOverallProficiency(cid, s.id));
  });
  var had = Object.prototype.hasOwnProperty.call(target, field);
  var kept = target[field];
  var after;
  try {
    target[field] = value;
    after = students.map(function (s) {
      return shown(getOverallProficiency(cid, s.id));
    });
  } finally {
    if (had) target[field] = kept;
    else delete target[field];
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

/* ── Class Results ─────────────────────────────────────────────
   The numbers behind the Class Average's hover card and the Class Results
   panel (docs/plans/class-results-plan.md; Colin, 2026-11-05). Each takes
   the gradebook's whole roster, and counts a student exactly as the Class
   Average does (columnCountedValue, COLUMN_STATUS_RULES): in a Letter class
   Missing is 0, in a Proficiency or Both class it is left out, Excused is
   always left out. None of them compares a group of students (a designation,
   ELL) with the class: a designation is only ever a tag beside a name. */

/* The middle of a list of numbers (the mean of the two middle ones for an
   even count); null for an empty list. The Assignments page's Median uses
   it too, so the two can't disagree. */
function medianOf(list) {
  var sorted = (list || [])
    .filter(function (v) {
      return v != null && isFinite(Number(v));
    })
    .map(Number)
    .sort(function (x, y) {
      return x - y;
    });
  if (!sorted.length) return null;
  var mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* What each counted student has in one column, lowest first, with the
   median, lowest and highest. A level column gives { value } per student (a
   level, 0 for a Letter class's Missing); points work read as points gives
   { value: earned, possible, pct }. Null when nobody counts. */
function classColumnSpread(cid, students, col) {
  var a = col && col.assessment;
  if (!a) return null;
  var asPoints = isPointsScored(a) && col.measure !== 'level';
  var values = [];
  (students || []).forEach(function (s) {
    var v = columnCountedValue(cid, s.id, col);
    if (!v) return;
    if (asPoints)
      values.push({
        sid: s.id,
        value: v.earned,
        possible: v.possible,
        pct: v.possible > 0 ? (v.earned / v.possible) * 100 : 0,
      });
    else values.push({ sid: s.id, value: v.value });
  });
  if (!values.length) return null;
  values.sort(function (x, y) {
    return x.value - y.value;
  });
  return {
    values: values,
    median: medianOf(
      values.map(function (v) {
        return v.value;
      }),
    ),
    low: values[0].value,
    high: values[values.length - 1].value,
    count: values.length,
    points: asPoints,
  };
}

// A counted value's band, 1–4: a level rounded, or points through the
// class's Points to Proficiency table. A Letter class's Missing (0) is 1.
function _spreadBand(cid, v, asPoints) {
  var level = asPoints ? pointsToProf(v.value, v.possible, getGradingScale(cid)) : Math.round(v.value);
  return Math.max(1, Math.min(4, level || 1));
}

/* How many counted students sit at each level on one column, from the
   rounded level of what they count for (classColumnSpread). { counts: {1..4},
   ids: {1..4: [sid]}, scored }. */
function classColumnLevelCounts(cid, students, col) {
  var counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  var ids = { 1: [], 2: [], 3: [], 4: [] };
  var spread = classColumnSpread(cid, students, col);
  if (spread)
    spread.values.forEach(function (v) {
      var band = _spreadBand(cid, v, spread.points);
      counts[band]++;
      ids[band].push(v.sid);
    });
  return { counts: counts, ids: ids, scored: spread ? spread.count : 0 };
}

/* The four levels in the order the class draws them (levelOrderFor), each
   with its name for a legend or a bar ("Proficient"), whatever the
   grading style: [{ level, label }]. */
function levelBands(cid) {
  return levelOrderFor(cid).map(function (level) {
    return { level: level, label: PROF_LABELS[level] };
  });
}

// One row of a results grid from each student's level on it (null: not
// scored), banded by the rounded level.
function _gridRow(students, levelOf) {
  var counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  var ids = { 1: [], 2: [], 3: [], 4: [] };
  var total = 0;
  var n = 0;
  (students || []).forEach(function (s) {
    var v = levelOf(s.id);
    if (v == null || !(v > 0)) return;
    var band = Math.max(1, Math.min(4, Math.round(v)));
    counts[band]++;
    ids[band].push(s.id);
    total += v;
    n++;
  });
  return { counts: counts, ids: ids, avg: n ? total / n : null, count: n };
}

/* A rubric assessment's results by criterion: one row per criterion in the
   rubric's order, each student's level on it from rubricCriterionLevel
   (Missing and Excused leave a student out). Null with no rubric. */
function classRubricGrid(cid, students, assessment) {
  var rubric = _assessmentRubric(cid, assessment);
  if (!rubric || !(rubric.criteria || []).length) return null;
  var criteria = rubric.criteria.slice().sort(function (x, y) {
    return (Number(x.displayOrder) || 0) - (Number(y.displayOrder) || 0);
  });
  return {
    rows: criteria
      .filter(function (c) {
        return c && c.id;
      })
      .map(function (c) {
        var row = _gridRow(students, function (sid) {
          return rubricCriterionLevel(cid, sid, assessment, c);
        });
        row.id = c.id;
        row.kind = 'criterion';
        row.name = c.name || c.label || '';
        return row;
      }),
  };
}

/* An assessment's results by competency: one row per row of its
   Competencies view (rubricCompetencyRowKeys). On rubric work a student's
   mark is competencyLevelFromCriteria's (several criteria that disagree give
   the lowest); a criterion that feeds no competency is its own row. On other
   work it is the student's score on that competency. Missing and Excused
   leave a student out. Null when the work scores no competency. */
function classCompetencyGrid(cid, students, assessment) {
  if (!assessment || isPointsScored(assessment) || isDibelsScored(assessment)) return null;
  var keys = rubricCompetencyRowKeys(cid, assessment).filter(function (k) {
    return !isUnlinkedTag(k);
  });
  if (!keys.length) return null;
  var rubric = _assessmentRubric(cid, assessment);
  var critById = {};
  ((rubric && rubric.criteria) || []).forEach(function (c) {
    if (c && c.id) critById[c.id] = c;
  });
  function out(sid) {
    var st = _scoreRead.status(cid, sid, assessment.id);
    return st === 'NS' || st === 'EXC';
  }
  return {
    rows: keys.map(function (key) {
      var crit = critById[key];
      var row = _gridRow(students, function (sid) {
        if (out(sid)) return null;
        if (crit) return rubricCriterionLevel(cid, sid, assessment, crit);
        if (rubric) {
          var m = competencyLevelFromCriteria(cid, sid, assessment, key);
          return m ? scoreModValue({ score: m.score, mod: m.mod }) : null;
        }
        var entry = (_scoreRead.scores(cid)[sid] || []).find(function (e) {
          return e.assessmentId === assessment.id && e.tagId === key;
        });
        return entry && entry.score > 0 ? scoreModValue(entry) : null;
      });
      row.id = key;
      row.kind = crit ? 'criterion' : 'competency';
      row.name = crit ? crit.name || crit.label || '' : '';
      return row;
    }),
  };
}

/* Who has what on one assessment: Missing, Excused and Late (Late keeps its
   score), the students with nothing yet (unmarked), and how many are
   scored (Late included). Each list holds student ids in roster order. */
function classColumnStatusCounts(cid, students, assessment) {
  var res = { scored: 0, total: (students || []).length, missing: [], excused: [], late: [], unmarked: [] };
  (students || []).forEach(function (s) {
    var status = _scoreRead.status(cid, s.id, assessment.id);
    if (status === 'NS') return res.missing.push(s.id);
    if (status === 'EXC') return res.excused.push(s.id);
    if (status === 'LATE') res.late.push(s.id);
    var cell = assessmentCellValue(cid, s.id, assessment);
    if (cell.kind === 'none' || (cell.kind === 'dibels' && !cell.dibels)) res.unmarked.push(s.id);
    else res.scored++;
  });
  return res;
}

/* Of the students scored on an assessment, who has written feedback on it:
   an overall comment, or a comment on any rubric criterion. Observations
   are not feedback here. { withComment: [sid], without: [sid] }. */
function classFeedbackCounts(cid, students, assessment) {
  var res = { withComment: [], without: [] };
  (students || []).forEach(function (s) {
    var status = _scoreRead.status(cid, s.id, assessment.id);
    if (status === 'NS' || status === 'EXC') return;
    var cell = assessmentCellValue(cid, s.id, assessment);
    if (cell.kind === 'none' || (cell.kind === 'dibels' && !cell.dibels)) return;
    var has =
      !!String(_scoreRead.comment(cid, s.id, assessment.id) || '').trim() ||
      (_scoreRead.scores(cid)[s.id] || []).some(function (e) {
        return e && e.assessmentId === assessment.id && String(e.critNote || '').trim();
      });
    (has ? res.withComment : res.without).push(s.id);
  });
  return res;
}

// What kind of score a piece takes, for comparing like with like.
function _scoreKind(a) {
  if (isDibelsScored(a)) return 'dibels';
  if (isCompletionScored(a)) return 'complete';
  if (isPointsScored(a)) return 'points';
  return 'level';
}

/* The `n` pieces before this one in its category (or with no category,
   when it has none) that are scored the same way (points, levels or
   Complete/Incomplete) and have a Class Average, newest first:
   [{ assessment, average (classColumnAverage), text }]. Null when there are
   none, and for DIBELS. */
function earlierInCategory(cid, assessment, n) {
  if (!assessment || isDibelsScored(assessment)) return null;
  var limit = n == null ? 3 : n;
  var date = _assessmentDate(assessment);
  if (!date) return null;
  var cat = assessment.categoryId || assessment.category_id || null;
  var kind = _scoreKind(assessment);
  var students = typeof getStudents === 'function' ? getStudents(cid) : [];
  var out = (getAssessments(cid) || [])
    .filter(function (x) {
      var d = _assessmentDate(x);
      return (
        x.id !== assessment.id &&
        (x.categoryId || x.category_id || null) === cat &&
        _scoreKind(x) === kind &&
        d &&
        d < date
      );
    })
    .sort(function (x, y) {
      return _assessmentDate(y).localeCompare(_assessmentDate(x));
    })
    .map(function (x) {
      var avg = classColumnAverage(cid, students, { assessment: x });
      return avg ? { assessment: x, average: avg, text: classColumnAverageText(cid, x, avg) } : null;
    })
    .filter(Boolean)
    .slice(0, limit);
  return out.length ? out : null;
}

/* A points piece's scores in bands of `bandSize` points (default a tenth
   of its most, at least 1), for the Score Spread chart, lowest first. Each
   band is { lo, hi, ids, byLevel: {1..4: [sid]} }, the level from the
   class's Points to Proficiency table; the last band runs to the most (and
   holds extra credit). levelRanges names the points each level takes, from
   that table: { 1: 'under 25', 2: '25–32', … }. Null with no maximum. */
function pointsBands(cid, students, assessment, bandSize) {
  var max = Number(assessment && assessment.maxPoints) || 0;
  if (!(max > 0) || isCompletionScored(assessment)) return null;
  var size = bandSize > 0 ? bandSize : Math.max(1, Math.round(max / 10));
  var count = Math.max(1, Math.floor(max / size));
  var scale = getGradingScale(cid);
  var bands = [];
  for (var i = 0; i < count; i++) {
    bands.push({
      lo: i * size,
      hi: i === count - 1 ? max : i * size + size - 1,
      ids: [],
      byLevel: { 1: [], 2: [], 3: [], 4: [] },
    });
  }
  var spread = classColumnSpread(cid, students, { assessment: assessment });
  ((spread && spread.values) || []).forEach(function (v) {
    var at = Math.min(count - 1, Math.max(0, Math.floor(v.value / size)));
    bands[at].ids.push(v.sid);
    bands[at].byLevel[_spreadBand(cid, v, true)].push(v.sid);
  });
  var starts = {};
  ((scale && scale.boundaries) || DEFAULT_GRADING_SCALE.boundaries).forEach(function (b) {
    var p = Math.ceil((Number(b.min) / 100) * max - 1e-9);
    if (starts[b.proficiency] == null || p < starts[b.proficiency]) starts[b.proficiency] = p;
  });
  var levelRanges = {};
  [1, 2, 3, 4].forEach(function (level) {
    if (starts[level] == null) return;
    var next = null;
    [1, 2, 3, 4].forEach(function (l) {
      if (starts[l] != null && starts[l] > starts[level] && (next == null || starts[l] < next)) next = starts[l];
    });
    var hi = next == null ? max : next - 1;
    levelRanges[level] =
      starts[level] <= 0 && next != null
        ? 'under ' + formatPoints(next)
        : formatPoints(starts[level]) + (hi > starts[level] ? '–' + formatPoints(hi) : '');
  });
  return { size: size, bands: bands, levelRanges: levelRanges, max: max };
}

/* A Complete/Incomplete piece: who is Complete, Incomplete, unmarked,
   Missing and Excused, and its Class Average % (Missing as 0, Excused left
   out, as getClassPointsAverage counts it; null when nobody counts). */
function completionCounts(cid, students, assessment) {
  var res = { complete: [], incomplete: [], unmarked: [], missing: [], excused: [], pct: null };
  (students || []).forEach(function (s) {
    var status = _scoreRead.status(cid, s.id, assessment.id);
    if (status === 'NS') return res.missing.push(s.id);
    if (status === 'EXC') return res.excused.push(s.id);
    var mark = _scoreRead.completionMark(cid, s.id, assessment.id);
    if (mark === 'complete') res.complete.push(s.id);
    else if (mark === 'incomplete') res.incomplete.push(s.id);
    else res.unmarked.push(s.id);
  });
  var avg = getClassPointsAverage(cid, students, assessment);
  res.pct = avg ? avg.pct : null;
  return res;
}

// DIBELS support levels, lowest first.
var DIBELS_RANK = { intensive: 1, strategic: 2, core: 3, above: 4 };

/* A DIBELS benchmark's reading levels (Oral Reading Fluency) for the class,
   per window: { periods: { boy|moy|eoy: { counts, ids, tested,
   medianWrc, medianAccuracy (null when no errors are entered) } },
   rows: { sid: { boy|moy|eoy: { wrc, accuracy, level } } }, latest (the
   last window anyone was tested in, or null), previous (the tested window
   before it), moved: { up, same, down: [{ sid, from, to }] } between those
   two }. Missing and Excused students are left out. */
function dibelsClassResults(cid, students, assessment) {
  var periods = {};
  var rows = {};
  DIBELS_PERIODS.forEach(function (p) {
    periods[p] = {
      counts: { intensive: 0, strategic: 0, core: 0, above: 0 },
      ids: { intensive: [], strategic: [], core: [], above: [] },
      tested: 0,
      medianWrc: null,
      medianAccuracy: null,
    };
  });
  var wrcs = {};
  var accs = {};
  (students || []).forEach(function (s) {
    var status = _scoreRead.status(cid, s.id, assessment.id);
    if (status === 'NS' || status === 'EXC') return;
    DIBELS_PERIODS.forEach(function (p) {
      var row = _scoreRead.dibels(cid, s.id, assessment.id, p);
      if (!row || row.orfWrc == null) return;
      var level = dibelsLevel('orf', p, row.orfWrc);
      if (!level) return;
      var acc = dibelsAccuracy(row.orfWrc, row.orfErrors);
      if (!rows[s.id]) rows[s.id] = {};
      rows[s.id][p] = { wrc: row.orfWrc, accuracy: acc, level: level };
      periods[p].counts[level]++;
      periods[p].ids[level].push(s.id);
      periods[p].tested++;
      (wrcs[p] = wrcs[p] || []).push(row.orfWrc);
      if (acc != null) (accs[p] = accs[p] || []).push(acc);
    });
  });
  var tested = DIBELS_PERIODS.filter(function (p) {
    periods[p].medianWrc = medianOf(wrcs[p] || []);
    periods[p].medianAccuracy = medianOf(accs[p] || []);
    return periods[p].tested > 0;
  });
  var latest = tested.length ? tested[tested.length - 1] : null;
  var previous = tested.length > 1 ? tested[tested.length - 2] : null;
  var moved = { up: [], same: [], down: [] };
  if (latest && previous)
    Object.keys(rows).forEach(function (sid) {
      var now = rows[sid][latest];
      var before = rows[sid][previous];
      if (!now || !before) return;
      var d = DIBELS_RANK[now.level] - DIBELS_RANK[before.level];
      moved[d > 0 ? 'up' : d < 0 ? 'down' : 'same'].push({ sid: sid, from: before.level, to: now.level });
    });
  return { periods: periods, rows: rows, latest: latest, previous: previous, moved: moved };
}

/* Roughly how much of the course % one assessment carries as the class is
   set up, for the line under the Class Results title ("12% of the course
   grade"): its category's weight over the weights of the categories that
   hold counted work, times its share of the category (its points, or its
   Factor in an Average of Percentages category, over the category's). A
   class with no categories shares by points alone. A whole percent, or
   null when the class shows no % or the work counts toward no grade. Each
   student's real share moves with what they have handed in. */
function assessmentCourseShare(cid, assessment) {
  var worth = assessmentCourseWorth(cid, assessment);
  if (!worth || (worth.kind !== 'points' && worth.kind !== 'percent')) return null;
  var own = worth.kind === 'points' ? worth.points : worth.factor;
  var counted = _scopedAssessments(cid).filter(function (x) {
    return !isDibelsScored(x) && countsTowardGrades(cid, x);
  });
  var catOf = function (x) {
    return x.categoryId || x.category_id || null;
  };
  var categories = (getCategories(cid) || []).filter(function (c) {
    return (
      Number(c.weight || 0) > 0 &&
      counted.some(function (x) {
        return catOf(x) === c.id;
      })
    );
  });
  var cat = catOf(assessment);
  var mates = counted.filter(function (x) {
    return categories.length ? catOf(x) === cat : true;
  });
  var total = 0;
  mates.forEach(function (x) {
    var w = assessmentCourseWorth(cid, x);
    if (w && w.kind === worth.kind) total += worth.kind === 'points' ? w.points : w.factor;
  });
  if (!(total > 0) || !(own > 0)) return null;
  var catShare = 1;
  if (categories.length) {
    var weightSum = 0;
    var mine = 0;
    categories.forEach(function (c) {
      weightSum += Number(c.weight || 0);
      if (c.id === cat) mine = Number(c.weight || 0);
    });
    if (!(weightSum > 0) || !(mine > 0)) return null;
    catShare = mine / weightSum;
  }
  return Math.round(catShare * (own / total) * 100);
}

/* A figure from classColumnSpread as the class reads it: points as
   "38/50", a level through formatColumnAverageLevel ("86%", "3.0",
   "3.0 · 75%"). */
function classSpreadText(cid, assessment, value, points) {
  if (value == null) return '—';
  if (points)
    return formatPoints(Math.round(value * 10) / 10) + '/' + formatPoints(Number(assessment.maxPoints) || 100);
  return formatColumnAverageLevel(cid, value);
}

/* A spread's lowest to highest as the class reads it: "63–100%" in a
   Letter class, "1.0–4.0" in a Proficiency or Both class, "18–50/50" for
   points. */
function classSpreadRangeText(cid, assessment, spread) {
  if (!spread) return '—';
  if (spread.points)
    return (
      formatPoints(Math.round(spread.low * 10) / 10) +
      '–' +
      formatPoints(Math.round(spread.high * 10) / 10) +
      '/' +
      formatPoints(Number(assessment.maxPoints) || 100)
    );
  if (courseGradeMode(cid) === 'letter')
    return (
      formatColumnAverageLevel(cid, spread.low).replace('%', '') + '–' + formatColumnAverageLevel(cid, spread.high)
    );
  return levelFigure(spread.low, '0.0') + '–' + levelFigure(spread.high);
}

/* ── Namespace ──────────────────────────────────────────────── */
window.Calc = {
  withReturnedOnly,
  medianOf,
  classColumnSpread,
  classColumnLevelCounts,
  levelBands,
  classRubricGrid,
  classCompetencyGrid,
  classColumnStatusCounts,
  classFeedbackCounts,
  earlierInCategory,
  pointsBands,
  completionCounts,
  dibelsClassResults,
  classSpreadText,
  classSpreadRangeText,
  assessmentCourseShare,
  calcMethodExample,
  getRecentScoreLimit,
  getFoldersCountAsOne,
  getCoursesCountEqually,
  courseSubjectIds,
  previewCoursesEqualChange,
  previewLearningMapChange,
  folderCountsAsOne,
  folderAverageNote,
  previewFolderCountChange,
  previewCompetencyRemoval,
  formatCoursePercent,
  previewCalcMethodChange,
  clearProfCache,
  setActiveTerm,
  getActiveTerm,
  assessmentInYearToDate,
  assessmentInTermWindow,
  previousReportTerm,
  readAsOfTerm,
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
  levelToPercent,
  countsAsStepPercents,
  percentageToLetter,
  courseHasEnded,
  getCourseLetterData,
  courseGradeMode,
  formatLevel,
  assessmentCellValue,
  levelWord,
  studentGradeBadges,
  reportingBasis,
  viewedReportTerm,
  levelCode,
  studentRosterBadges,
  studentGradeSummary,
  classGradeSummary,
  classGradeChange,
  reportName,
  classGradeDistribution,
  competencyDistribution,
  classColumnAverageText,
  formatColumnAverageLevel,
  getAssessmentGroupPercentage,
  rubricCompetencyIds,
  rubricCriteriaForTag,
  rubricWholeTagIds,
  rubricScoredTagIds,
  wholeRubricLevel,
  competencyLevelFromCriteria,
  rubricCompetencyRowKeys,
  rubricRowScoreKeys,
  tagScoresByAssessment,
  tagMarksByAssessment,
  assessmentCourseWorth,
  assessmentGroupGrade,
  classAssessmentGroupGrade,
  groupGradeGap,
  groupGradeDiff,
  groupGradeValue,
  startAndNow,
  studentGrowthLine,
  averageLevels,
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
  sectionOverrideInView,
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
