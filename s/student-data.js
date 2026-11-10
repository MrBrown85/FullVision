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
   a grade only where `returned_at` is set, and copies named fields only.

   A grade arrives as a copy (migrations/2026110902_grade_return.sql, 3):
   { v, value, modifier, comment, tags: { id: level }, criteria: { id:
   level }, checks: [id] }. `previous` is the copy the student had before
   the newest return; it is compared with `grade` here, to mark a piece
   Updated, and is not kept.

   This file comes with the page and needs nothing else to read a reply.
   calc.js and constants.js are fetched later, when the Assignments list is
   about to open (app.js): the score entries calc.js reads are built from
   the page's grades the first time calc.js asks. */
var StudentData = (function () {
  'use strict';

  var G = typeof window !== 'undefined' ? window : globalThis;
  var page = null;
  var byStudent = null; // { student id: [score entries] }, as getScores gives the teacher's apps
  var statuses = {}; // { 'student id:assessment id': status }, as getAssignmentStatuses does

  function str(v) {
    return v == null ? '' : String(v);
  }

  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  // A time as the server writes it, in milliseconds, or null.
  function when(v) {
    var t = v ? Date.parse(String(v)) : NaN;
    return isFinite(t) ? t : null;
  }

  /* One value as text with its keys in order, so two copies of a grade
     compare equal whatever order their keys came in (7 and 7.0 are one
     number already). */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return (
        '{' +
        Object.keys(v)
          .sort()
          .map(function (k) {
            return JSON.stringify(k) + ':' + canon(v[k]);
          })
          .join(',') +
        '}'
      );
    }
    return JSON.stringify(v === undefined ? null : v);
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
      // When the teacher made the piece, under the name calc.js reads. Two
      // pieces with one date: the one made later counts later (Colin, Nov
      // 10). '' until the server sends it.
      created_at: row.created_at ? str(row.created_at) : '',
      updated: false, // set by fromServer, with `unseen`
      unseen: false,
    };
  }

  /* One returned grade, named fields only: the one score of points and
     Complete/Incomplete work (or the Overall level of work linked to no
     competency, with its + or −), the Overall Comment, a level per
     competency and a level per rubric criterion. */
  function gradeFrom(copy) {
    function levels(byId) {
      byId = byId && typeof byId === 'object' && !Array.isArray(byId) ? byId : {};
      return Object.keys(byId)
        .filter(function (id) {
          return byId[id] && num(byId[id].value) != null;
        })
        .map(function (id) {
          return { id: str(id), value: num(byId[id].value), modifier: num(byId[id].modifier) || 0 };
        });
    }
    var grade = {
      value: num(copy.value),
      comment: str(copy.comment),
      tagScores: levels(copy.tags),
      rubricScores: levels(copy.criteria),
    };
    if (num(copy.modifier)) grade.modifier = num(copy.modifier);
    return grade;
  }

  /* One returned grade as the score entries calc.js reads. Called only by
     calc.js's readers, so constants.js is in by then. */
  function entriesFrom(a, grade) {
    function entry(tagId, value, modifier) {
      var e = { assessmentId: a.id, tagId: tagId, score: value, note: grade.comment };
      var mod = normalizeScoreMod(value, modifier);
      if (mod) e.mod = mod;
      return e;
    }
    if (isPointsScored(a)) return grade.value == null ? [] : [entry(scoreTagIds(a)[0], grade.value)];
    var rubric = a.rubricId
      ? page.rubrics.filter(function (r) {
          return r.id === a.rubricId;
        })[0]
      : null;
    var out = (rubric ? grade.rubricScores : grade.tagScores).map(function (s) {
      return entry(s.id, s.value, s.modifier);
    });
    // Work linked to no competency keeps its one level on the score itself.
    if (!rubric && !out.length && grade.value != null) out.push(entry(scoreTagIds(a)[0], grade.value, grade.modifier));
    return out;
  }

  function entries() {
    if (byStudent) return byStudent;
    var list = [];
    page.assessments.forEach(function (a) {
      var grade = page.grades[a.id];
      if (grade) Array.prototype.push.apply(list, entriesFrom(a, grade));
    });
    byStudent = {};
    byStudent[page.student.id] = list;
    return byStudent;
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
    var grades = {};
    (res.assessments || []).forEach(function (row) {
      // A DIBELS benchmark is a reading record, not work a student gets back.
      if (!row || !row.id || row.score_mode === 'dibels') return;
      var a = assessmentFrom(row);
      assessments.push(a);
      // Returned grades only. A grade with no return date is not kept.
      // Missing and Excused win at once: the server sends no grade under
      // either, and one sent by mistake is not kept.
      var hidden = a.status === 'NS' || a.status === 'EXC';
      if (!a.returnedAt || hidden || !row.grade || typeof row.grade !== 'object') return;
      grades[a.id] = gradeFrom(row.grade);
      var returned = when(row.returned_at);
      var changed = when(row.updated_at);
      var seen = when(row.seen_at);
      // Updated: the grade was changed and returned again since the student
      // last opened the piece, and it is not the grade they had before.
      a.updated = changed != null && !(seen != null && seen >= changed) && canon(row.previous) !== canon(row.grade);
      // Not opened since it last came back.
      a.unseen = !(seen != null && seen >= Math.max(returned || 0, changed || 0));
    });
    return {
      v: 1,
      student: { id: str(student.enrollment_id), firstName: str(student.first_name) },
      course: {
        // The class's key on this page. The server sends no class id (the
        // page needs none); Demo Mode's sample class has one.
        id: str(course.id) || 'class',
        name: str(course.name),
        block: str(course.block),
        gradingSystem: SYSTEMS[course.grading_system] || 'proficiency',
        gradingScale: course.grading_scale && typeof course.grading_scale === 'object' ? course.grading_scale : null,
      },
      assessments: assessments,
      rubrics: rubrics,
      grades: grades,
    };
  }

  /* Hands a page to the readers below. One class at a time. */
  function use(p) {
    page = p || null;
    byStudent = null;
    statuses = {};
    Object.keys(G.COURSES).forEach(function (id) {
      delete G.COURSES[id];
    });
    if (!page) return;
    page.assessments.forEach(function (a) {
      if (a.status) statuses[page.student.id + ':' + a.id] = a.status;
    });
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
     The names shared/data.js gives the teacher's apps, answered from the
     page. Read-only: the student page writes no grade.

     calc.js reads every score and status through one reader of its own
     (_scoreRead): getScores for the scores, and from them the points,
     Complete or Incomplete and the comment; getAssignmentStatuses for
     Missing, Excused and Late. The rest are the class's settings. These are
     all the list needs and nothing calls any other:
     tests/student-card.test.js fails when calc.js or constants.js reaches
     for a name this page lacks, and when a reader here goes unused.

     Every score on this page is a returned one. When calc.js gains its
     returned-only set (S0-F1, getReturnedScores) it is this same
     getScores. */
  G.COURSES = {};

  var READERS = {
    // Every score entry in the class: { student id: [entry] }.
    getScores: function (cid) {
      return isThis(cid) ? entries() : {};
    },
    // Every status in the class: { 'student id:assessment id': 'NS' | 'EXC' | 'LATE' }.
    getAssignmentStatuses: function (cid) {
      return isThis(cid) ? statuses : {};
    },
    getRubricById: function (cid, rubricId) {
      if (!isThis(cid)) return undefined;
      return page.rubrics.filter(function (r) {
        return r.id === rubricId;
      })[0];
    },
    // The class's own Counts As percents and points bands, or the defaults.
    getGradingScale: function (cid) {
      return (isThis(cid) && page.course.gradingScale) || DEFAULT_GRADING_SCALE;
    },
  };
  Object.keys(READERS).forEach(function (name) {
    G[name] = READERS[name];
  });

  return {
    fromServer: fromServer,
    use: use,
    readers: Object.keys(READERS),
    page: function () {
      return page;
    },
  };
})();
