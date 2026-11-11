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

  /* The keys S4-M1 added (migrations/local-test/s4-m1-contract.md), each
     read as the contract types it. A key the reply lacks, or holds as
     another type, reads as its empty value: never a throw. */
  function text(v) {
    return typeof v === 'string' ? v : '';
  }
  function textList(v) {
    return Array.isArray(v)
      ? v.filter(function (s) {
          return typeof s === 'string';
        })
      : [];
  }
  function idList(v) {
    return textList(v).filter(Boolean);
  }
  // A whole number, 0 or more, or null.
  function count(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v ? v : null;
  }

  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /* A time as the server writes it, in milliseconds, or null. The server
     writes to the microsecond; a browser is only sure to read three decimal
     places, so the rest are dropped first. */
  function when(v) {
    var t = v ? Date.parse(String(v).replace(/(\.\d{3})\d+/, '$1')) : NaN;
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
          return {
            id: str(c.id),
            name: str(c.name),
            weight: num(c.weight),
            levelValues: levelValues(c),
            tagIds: idList(c.tag_ids),
          };
        }),
    };
  }

  function tagsFrom(byId) {
    var out = {};
    if (!byId || typeof byId !== 'object' || Array.isArray(byId)) return out;
    Object.keys(byId).forEach(function (id) {
      var t = byId[id];
      if (!t || typeof t !== 'object') return;
      out[id] = { label: str(t.label), code: str(t.code), iCan: textList(t.i_can) };
    });
    return out;
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
      description: text(row.description),
      moduleName: text(row.module_name),
      categoryName: text(row.category_name),
      categoryPercent:
        typeof row.category_percent === 'number' && isFinite(row.category_percent) && row.category_percent >= 0
          ? row.category_percent
          : null,
      coreCompetencies: (Array.isArray(row.core_competencies) ? row.core_competencies : [])
        .filter(function (c) {
          return c && typeof c === 'object' && text(c.id) && text(c.name);
        })
        .map(function (c) {
          return { id: c.id, name: c.name };
        }),
      updated: false, // set by fromServer, with `unseen`
      unseen: false,
      // My Learning's What Makes Up Your Grade groups pieces by it (S13-W1); null when not sent.
      categoryId: row.category_id ? str(row.category_id) : null,
    };
  }

  /* ── My Learning (S13-W1) ──────────────────────────────────────
     With Show My Learning on, `page` sends `show_my_learning: true` and
     `learning`: the class's calculation settings, categories, folders and
     learning map, in get_class_bundle's own shapes (my-learning-contract.md,
     Batch E E9). They are turned here into the shapes shared/data.js gives
     the teacher's apps, so calc.js and shared/student-view.js work My
     Learning out on the device exactly as Preview as Student does. The
     student's returned scores are the ones the page already holds. With the
     switch off nothing of this is kept, and the readers below are not on
     the page at all. */
  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  }
  function order(v, i) {
    var n = num(v);
    return n == null ? i : n;
  }
  function byOrder(x, y) {
    return x.sortOrder - y.sortOrder;
  }
  function learningFrom(l) {
    var c = obj(l.course) || {};
    var config = { show_my_learning: true };
    config.calcMethod = text(c.calc_method) || 'mostRecent';
    if (num(c.decay_weight) != null) config.decayWeight = num(c.decay_weight);
    if (num(c.recent_score_limit) >= 1) config.recentScoreLimit = num(c.recent_score_limit);
    if (typeof c.round_percent === 'boolean') config.roundPercent = c.round_percent;
    config.levelOrder = c.level_order === 'asc' ? 'asc' : 'desc';
    if (obj(c.grading_scale)) config.gradingScale = c.grading_scale;
    if (obj(c.category_weights)) config.categoryWeights = c.category_weights;
    if (Array.isArray(c.reporting_terms)) config.reportingTerms = c.reporting_terms;
    if (c.folders_count_as_one === false) config.foldersCountAsOne = false;
    if (c.courses_count_equally === true) config.coursesCountEqually = true;
    var groups = (Array.isArray(l.competency_groups) ? l.competency_groups : [])
      .filter(function (g) {
        return g && g.id;
      })
      .map(function (g, i) {
        return {
          id: str(g.id),
          name: str(g.name),
          color: str(g.color) || '#6366f1',
          sortOrder: order(g.display_order, i),
          displayOrder: order(g.display_order, i),
          countsAsOne: g.counts_as_one !== false,
        };
      })
      .sort(byOrder);
    var subjects = [];
    var sections = [];
    (Array.isArray(l.subjects) ? l.subjects : []).forEach(function (subject, si) {
      if (!subject || !subject.id) return;
      subjects.push({ id: str(subject.id), name: str(subject.name), sortOrder: order(subject.display_order, si) });
      (Array.isArray(subject.sections) ? subject.sections : []).forEach(function (sec, i) {
        if (!sec || !sec.id) return;
        var name = str(sec.name) || 'Standard';
        var tags = (Array.isArray(sec.tags) ? sec.tags : [])
          .filter(function (t) {
            return t && t.id;
          })
          .map(function (t, ti) {
            return {
              id: str(t.id),
              code: str(t.code),
              label: str(t.label) || str(t.code) || name,
              text: text(t.i_can_text),
              i_can_statements: textList(t.i_can_statements),
              bank_id: t.bank_id ? str(t.bank_id) : null,
              subject: str(subject.id),
              name: name,
              sortOrder: order(t.display_order, ti),
            };
          })
          .sort(byOrder);
        var folder = sec.competency_group_id ? str(sec.competency_group_id) : null;
        sections.push({
          id: str(sec.id),
          subject: str(subject.id),
          name: name,
          shortName: name,
          groupId: folder,
          competencyGroupId: folder,
          tags: tags,
          sortOrder: order(sec.display_order, i),
          outcome: tags[0] || null,
        });
      });
    });
    subjects.sort(byOrder);
    var categories = (Array.isArray(l.categories) ? l.categories : [])
      .filter(function (k) {
        return k && k.id;
      })
      .map(function (k, i) {
        return {
          id: str(k.id),
          name: str(k.name),
          weight: num(k.weight),
          displayOrder: order(k.display_order, i),
          calcMode: k.calc_mode === 'percent' ? 'percent' : 'points',
        };
      });
    return {
      config: config,
      calcMethod: config.calcMethod,
      decayWeight: config.decayWeight,
      timezone: text(c.timezone) || 'America/Vancouver',
      groups: groups,
      subjects: subjects,
      sections: sections,
      categories: categories,
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
        // course.teacher_name is never read: the page never names the
        // teacher (Colin's ruling 112, "Leave the name off.").
      },
      // My Learning (S13-W1): only when the class shows it and the server sent what it needs.
      learning: res.show_my_learning === true && obj(res.learning) ? learningFrom(res.learning) : null,
      // The class's competencies: name, code and I Can statements (blanks kept, as sent).
      tags: tagsFrom(res.tags),
      assessments: assessments,
      rubrics: rubrics,
      grades: grades,
      // The classes this device's session has opened, for Switching Classes.
      classes: (Array.isArray(res.classes) ? res.classes : [])
        .filter(function (c) {
          return c && str(c.enrollment_id);
        })
        .map(function (c) {
          var k = c.course || {};
          // toDo: how many pieces wait in that class, null when the server does not say.
          return { enrollmentId: str(c.enrollment_id), name: str(k.name), block: str(k.block), toDo: count(c.to_do) };
        }),
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
    // My Learning's readers are on the page only while its class shows My Learning.
    Object.keys(LEARNING_READERS).forEach(function (name) {
      if (page && page.learning) {
        G[name] = LEARNING_READERS[name];
        return;
      }
      // Taken off only if it is this file's own (looked at without reading it).
      var own = Object.getOwnPropertyDescriptor(G, name);
      if (own && own.value === LEARNING_READERS[name]) delete G[name];
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
    if (page.learning) {
      G.COURSES[page.course.id].calcMethod = page.learning.calcMethod;
      if (page.learning.decayWeight != null) G.COURSES[page.course.id].decayWeight = page.learning.decayWeight;
      G.COURSES[page.course.id].timezone = page.learning.timezone;
    }
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

  /* What calc.js and shared/student-view.js read for My Learning (S13-W1),
     answered from `learning` as shared/data.js answers them from the
     teacher's cache. Set by use() only for a class that shows My Learning. */
  function L() {
    return page && page.learning;
  }
  // The folders (competency groups) come only through getGroupedSections: calc.js reads no other way to them.
  var LEARNING_READERS = {
    getCourseConfig: function (cid) {
      return isThis(cid) && L() ? L().config : {};
    },
    getAssessments: function (cid) {
      return isThis(cid) ? page.assessments : [];
    },
    getSections: function (cid) {
      return isThis(cid) && L() ? L().sections : [];
    },
    getSubjects: function (cid) {
      return isThis(cid) && L() ? L().subjects : [];
    },
    getGroupedSections: function (cid) {
      var byId = {};
      var groups = (isThis(cid) && L() ? L().groups : []).map(function (g) {
        return (byId[g.id] = { group: g, sections: [] });
      });
      var ungrouped = [];
      LEARNING_READERS.getSections(cid).forEach(function (sec) {
        if (sec.groupId && byId[sec.groupId]) byId[sec.groupId].sections.push(sec);
        else ungrouped.push(sec);
      });
      return { groups: groups, ungrouped: ungrouped };
    },
    getAllTags: function (cid) {
      var out = [];
      LEARNING_READERS.getSections(cid).forEach(function (sec) {
        Array.prototype.push.apply(out, sec.tags);
      });
      return out;
    },
    getSectionForTag: function (cid, tagId) {
      return LEARNING_READERS.getSections(cid).filter(function (sec) {
        return sec.tags.some(function (t) {
          return t.id === tagId;
        });
      })[0];
    },
    getCategories: function (cid) {
      return isThis(cid) && L() ? L().categories : [];
    },
    getCategoryById: function (cid, id) {
      if (!id) return null;
      return (
        LEARNING_READERS.getCategories(cid).filter(function (k) {
          return k.id === id;
        })[0] || null
      );
    },
    // Every score on this page is a returned one: calc.js's returned-only set is the page's own.
    getReturnedScores: function (cid) {
      return READERS.getScores(cid);
    },
    // A category's Calculation: 'percent', or 'points' (the default), as shared/data.js reads it.
    categoryCalcMode: function (category) {
      var mode = category && (category.calcMode || category.calc_mode);
      return mode === 'percent' ? 'percent' : 'points';
    },
    // Today in the class's time zone (America/Vancouver unless the class says otherwise), YYYY-MM-DD.
    courseToday: function (cid) {
      var tz = (isThis(cid) && L() && L().timezone) || 'America/Vancouver';
      var at = new Date();
      try {
        var parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
          .formatToParts(at)
          .reduce(function (o, x) {
            o[x.type] = x.value;
            return o;
          }, {});
        if (parts.year && parts.month && parts.day) return parts.year + '-' + parts.month + '-' + parts.day;
      } catch (e) {
        /* an unknown time zone: the device's own day below */
      }
      return (
        at.getFullYear() +
        '-' +
        String(at.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(at.getDate()).padStart(2, '0')
      );
    },
    // A teacher's level set by hand on a competency: `page` sends none, so none is read.
    getOverrides: function () {
      return {};
    },
  };

  return {
    fromServer: fromServer,
    use: use,
    readers: Object.keys(READERS),
    learningReaders: Object.keys(LEARNING_READERS),
    page: function () {
      return page;
    },
  };
})();
