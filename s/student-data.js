/* The student's own page data, for shared/calc.js and shared/constants.js
   (docs/plans/student-page-build-plan.md, 1.9).

   The teacher's apps feed calc.js from shared/data.js. The student page has
   no data layer, no cache and no key: it has one reply, the student's page
   for one class (the edge function's `page` route; Demo Mode builds the
   same reply on the device). This file turns that reply into the one shape
   the screens read (fromServer, the only adapter) and gives calc.js the few
   readers it calls, so a result on the student page is worked out and
   formatted by the same code as the teacher's gradebook cell.

   The page holds returned grades only. A draft never arrives: the server
   sends `grade: null` for a piece that was never returned, and the grade as
   last returned while a newer draft waits. fromServer checks again, keeping
   a grade only where `returned_at` is set, and copies named fields only. */
var StudentData = (function () {
  'use strict';

  var G = typeof window !== 'undefined' ? window : globalThis;
  var page = null;
  var byStudent = {}; // { student id: [score entries] }, as getScores gives the teacher's apps

  function str(v) {
    return v == null ? '' : String(v);
  }

  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  var STATUSES = { NS: 'NS', EXC: 'EXC', LATE: 'LATE' };
  var MODES = { points: 'points', complete: 'complete' };
  var SYSTEMS = { letter: 'letter', both: 'both' };

  /* A criterion's own point values per level, where they differ from the
     level itself (rubric_criterion.level_N_value). */
  function levelValues(row) {
    var out = {};
    [1, 2, 3, 4].forEach(function (l) {
      var v = num(row['level_' + l + '_value']);
      if (v != null && v !== l) out[l] = v;
    });
    return out;
  }

  function rubricFrom(row) {
    return {
      id: str(row.id),
      criteria: (row.criteria || [])
        .filter(function (c) {
          return c && c.id;
        })
        .map(function (c) {
          return { id: str(c.id), name: str(c.name), weight: num(c.weight), levelValues: levelValues(c) };
        }),
    };
  }

  function assessmentFrom(row) {
    return {
      id: str(row.id),
      title: str(row.title),
      date: str(row.date).slice(0, 10),
      dueDate: str(row.due_date).slice(0, 10),
      scoreMode: MODES[row.score_mode] || 'proficiency',
      maxPoints: num(row.max_points),
      weight: num(row.weight),
      tagIds: (row.tag_ids || []).map(str),
      rubricId: row.rubric_id ? str(row.rubric_id) : '',
      status: STATUSES[row.status] || null,
      returnedAt: row.returned_at ? str(row.returned_at) : '',
    };
  }

  /* One returned grade as the score entries calc.js reads: a level per
     competency, or per rubric criterion, or the one score of points and
     Complete/Incomplete work. `rubric` is the assessment's rubric when the
     page has it. */
  function entriesFrom(a, grade, rubric) {
    var note = str(grade.score && grade.score.comment);
    function entry(tagId, value, modifier) {
      var e = { assessmentId: a.id, tagId: tagId, score: value, note: note };
      var mod = normalizeScoreMod(value, modifier);
      if (mod) e.mod = mod;
      return e;
    }
    var one = num(grade.score && grade.score.value);
    if (isPointsScored(a)) return one == null ? [] : [entry(scoreTagIds(a)[0], one)];
    var out = [];
    if (rubric) {
      (grade.rubric_scores || []).forEach(function (r) {
        var level = num(r && r.value);
        if (r && r.criterion_id && level != null) out.push(entry(str(r.criterion_id), level, r.modifier));
      });
      return out;
    }
    (grade.tag_scores || []).forEach(function (t) {
      var level = num(t && t.value);
      if (t && t.tag_id && level != null) out.push(entry(str(t.tag_id), level, t.modifier));
    });
    // Work linked to no competency keeps its one level on the score itself.
    if (!out.length && one != null) out.push(entry(scoreTagIds(a)[0], one));
    return out;
  }

  /* The server's `page` reply as the screens read it. The only adapter:
     nothing else on the student page reads the reply. */
  function fromServer(res) {
    res = res || {};
    var course = res.course || {};
    var student = res.student || {};
    var rubrics = (res.rubrics || [])
      .filter(function (r) {
        return r && r.id;
      })
      .map(rubricFrom);
    var assessments = [];
    var scores = [];
    (res.assessments || []).forEach(function (row) {
      // A DIBELS benchmark is a reading record, not work a student gets back.
      if (!row || !row.id || row.score_mode === 'dibels') return;
      var a = assessmentFrom(row);
      assessments.push(a);
      // Returned grades only. A grade with no return date is not shown.
      if (!a.returnedAt || !row.grade) return;
      var rubric = a.rubricId
        ? rubrics.filter(function (r) {
            return r.id === a.rubricId;
          })[0]
        : null;
      Array.prototype.push.apply(scores, entriesFrom(a, row.grade, rubric));
    });
    return {
      v: 1,
      student: { id: str(student.enrollment_id), firstName: str(student.first_name) },
      course: {
        id: str(course.id),
        name: str(course.name),
        block: str(course.block),
        gradingSystem: SYSTEMS[course.grading_system] || 'proficiency',
        gradingScale: course.grading_scale && typeof course.grading_scale === 'object' ? course.grading_scale : null,
      },
      assessments: assessments,
      rubrics: rubrics,
      scores: scores,
    };
  }

  /* Hands a page to the readers below. One class at a time. */
  function use(p) {
    page = p || null;
    byStudent = {};
    Object.keys(G.COURSES).forEach(function (id) {
      delete G.COURSES[id];
    });
    if (!page) return;
    byStudent[page.student.id] = page.scores;
    G.COURSES[page.course.id] = {
      id: page.course.id,
      name: page.course.name,
      block: page.course.block,
      gradingSystem: page.course.gradingSystem,
    };
  }

  function isThis(cid) {
    return !!page && page.course.id === cid;
  }

  /* ── What calc.js and constants.js read ─────────────────────────
     The same names shared/data.js gives the teacher's apps, answered from
     the page. Read-only: the student page writes no grade. */
  G.COURSES = {};

  G.getCourseConfig = function (cid) {
    return isThis(cid) && page.course.gradingScale ? { gradingScale: page.course.gradingScale } : {};
  };

  G.getGradingScale = function (cid) {
    return G.getCourseConfig(cid).gradingScale || DEFAULT_GRADING_SCALE;
  };

  G.getScores = function (cid) {
    return isThis(cid) ? byStudent : {};
  };

  G.getAssignmentStatus = function (cid, sid, aid) {
    if (!isThis(cid) || sid !== page.student.id) return null;
    var a = page.assessments.filter(function (x) {
      return x.id === aid;
    })[0];
    return (a && a.status) || null;
  };

  G.getRubricById = function (cid, rubricId) {
    if (!isThis(cid)) return undefined;
    return page.rubrics.filter(function (r) {
      return r.id === rubricId;
    })[0];
  };

  // A piece's points, or null with no score. A 0 is a score.
  G.getPointsScore = function (cid, sid, aid) {
    var entry = (G.getScores(cid)[sid] || []).filter(function (e) {
      return e.assessmentId === aid && e.score != null && e.score !== '';
    })[0];
    return entry ? Number(entry.score) : null;
  };

  // 'complete', 'incomplete', or null when unmarked.
  G.getCompletionMark = function (cid, sid, aid) {
    var entry = (G.getScores(cid)[sid] || []).filter(function (e) {
      return e.assessmentId === aid;
    })[0];
    if (!entry || entry.score == null) return null;
    return Number(entry.score) > 0 ? 'complete' : 'incomplete';
  };

  return {
    fromServer: fromServer,
    use: use,
    page: function () {
      return page;
    },
  };
})();
