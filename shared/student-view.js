/* student-view.js — what one student sees on their page
   (docs/plans/student-page-build-plan.md 1.9 and S4-T1).

   Two halves, so the student page and Preview as Student draw from one
   thing and cannot differ:

   1. reply(cid, sid): one student's page for one class, built from the
      teacher's cache, in the shape the server's `page` route returns
      (student_submit.page, migrations/2026110904_student_sessions_page.sql;
      supabase/functions/student-submit/card-routes.ts copies it field by
      field). Returned grades only. Used by Preview as Student, where there
      is a cache and no server reply. null while the class's returned
      grades cannot be read yet (not ready).

   2. build(reply, cid, cellOf): the plain data the page draws, from such a
      reply: what is due, what came back with its result, feedback and
      rubric rows, and what changed since the student last looked. The
      student page calls it on the server's reply (fromPage); Preview calls
      it on reply() (fromCache). Each piece's result comes from `cellOf`,
      which asks shared/calc.js for that piece's cell as the class's grading
      style shows it: on the teacher's side inside withReturnedOnly, on the
      student's side from s/student-data.js. Nothing here formats a grade:
      words and figures come from calc.js and constants.js only.

   The line this file holds: a grade never returned is not here at all,
   nor its comment, nor a number worked out from it. Grades are read only
   through the data layer's returned set (getReturnedScores and
   getReturnedRubricCheckIds) and the rule in shared/grade-state.js. While
   a signed-in class that holds grades has not loaded its Draft and
   Returned rows, the answer is "not ready" ({ ready: false }), never a
   throw into a draw and never every score.

   Pure: no DOM, no network, no storage, no clock. Nothing uses it yet. */
window.StudentView = (function () {
  'use strict';

  var NOT_READY = 'RETURNED_NOT_LOADED';

  function str(v) {
    return v == null ? '' : String(v);
  }
  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  // A time as the server writes it, in milliseconds, or null (as s/student-data.js reads it).
  function when(v) {
    var t = v ? Date.parse(String(v).replace(/(\.\d{3})\d+/, '$1')) : NaN;
    return isFinite(t) ? t : null;
  }
  // One value as text with its keys in order, so two copies compare equal whatever order their keys came in.
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

  /* ── Ready, or waiting ─────────────────────────────────────── */

  /* Can this class's returned grades be read now? The seam's own question
     (teacher/report-scores.js, ReportScores.ready) where it is loaded; the
     same test where it is not. Only the data layer's not-loaded refusal is
     waited out; any other error is a fault and is thrown. */
  function ready(cid) {
    if (typeof ReportScores !== 'undefined' && ReportScores && typeof ReportScores.ready === 'function') {
      return ReportScores.ready(cid);
    }
    if (typeof getReturnedScores !== 'function') return false;
    try {
      getReturnedScores(cid);
      return true;
    } catch (e) {
      if (e && e.code === NOT_READY) return false;
      throw e;
    }
  }

  /* ── 1. The reply, from the teacher's cache ────────────────── */

  function pieceOf(cid, aid) {
    return (getAssessments(cid) || []).find(function (a) {
      return a && a.id === aid;
    });
  }

  /* How a piece is scored now, as GradeState.partInUse takes it: the part
     of a grade the student is given (migrations/2026110902_grade_return.sql
     3b, _grade_copy_in_use). */
  function scoringOf(cid, a) {
    if (isPointsScored(a)) return { kind: 'points' };
    var rubricId = a.rubricId || a.rubric_id;
    if (rubricId) {
      var rubric = getRubricById(cid, rubricId) || { criteria: [] };
      var criteria = (rubric.criteria || []).filter(Boolean);
      var checks = [];
      criteria.forEach(function (c) {
        (c.checks || []).forEach(function (k) {
          if (k && k.id) checks.push(String(k.id));
        });
      });
      return {
        kind: 'rubric',
        criteria: criteria.map(function (c) {
          return String(c.id);
        }),
        checks: checks,
      };
    }
    var tags = scoreTagIds(a, cid).filter(function (id) {
      return !isUnlinkedTag(id);
    });
    return tags.length ? { kind: 'competencies', tags: tags } : { kind: 'overall' };
  }

  /* The grade the student has been given on one piece, as a copy, or null.
     Read from the returned set only: its entries for the piece and its
     ticks, put into a copy by the data layer's own reader of a cell
     (_gradeOf, the copy the rule keeps), then only the part the piece is
     scored by now. Missing and Excused win at once: nothing. */
  function givenCopy(cid, sid, a, status, scoring, returned) {
    if (status === 'NS' || status === 'EXC') return null;
    var entries = (returned[sid] || []).filter(function (e) {
      return e && e.assessmentId === a.id;
    });
    var checks = getReturnedRubricCheckIds(cid, sid, a.id) || [];
    if (!entries.length && !checks.length) return null;
    return GradeState.partInUse(GradeState.copyOf(_gradeOf(a, entries, checks)), scoring);
  }

  function rubricReply(rubric) {
    var out = {
      id: str(rubric.id),
      name: str(rubric.name || rubric.title),
      style: typeof rubricStyle === 'function' ? rubricStyle(rubric) : str(rubric.style) || 'standard',
      criteria: (rubric.criteria || []).filter(Boolean).map(function (c) {
        var levels = c.levels || {};
        var values = c.levelValues || {};
        var row = { id: str(c.id), name: str(c.name || c.label), weight: num(c.weight) };
        [1, 2, 3, 4].forEach(function (l) {
          row['level_' + l + '_value'] = num(values[l]) != null ? num(values[l]) : l;
        });
        [1, 2, 3, 4].forEach(function (l) {
          row['level_' + l + '_descriptor'] = str(levels[l]);
        });
        row.checks = (c.checks || [])
          .filter(function (k) {
            return k && k.id;
          })
          .slice()
          .sort(function (x, y) {
            return (
              Number(x.level) - Number(y.level) ||
              (Number(x.displayOrder) || 0) - (Number(y.displayOrder) || 0) ||
              (String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0)
            );
          })
          .map(function (k) {
            return { id: str(k.id), level: num(k.level), label: str(k.label) };
          });
        return row;
      }),
    };
    return out;
  }

  /* One student's page for one class, as the server's `page` route returns
     it, from the cache. null when the class's returned grades cannot be
     read yet, or the class or student is not here. What the server sends
     and this does not: expires_at and classes (the device's session). */
  function reply(cid, sid) {
    if (!cid || !sid || !ready(cid)) return null;
    var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || null;
    var student = (getStudents(cid) || []).find(function (s) {
      return s && s.id === sid;
    });
    if (!course || !student) return null;
    var returned = getReturnedScores(cid);
    var today = courseToday(cid);

    var tags = {};
    (getAllTags(cid) || []).forEach(function (t) {
      if (t && t.id) tags[t.id] = { label: str(t.label), code: str(t.code) };
    });

    // An assessment is listed once its date has come; one with no date as soon as it exists.
    var listed = (getAssessments(cid) || []).filter(function (a) {
      return a && a.id && (!a.date || String(a.date).slice(0, 10) <= today);
    });
    // Undated first, then oldest first; the class's own order within a day.
    listed = listed
      .map(function (a, i) {
        return { a: a, i: i };
      })
      .sort(function (x, y) {
        var p = x.a.date ? String(x.a.date).slice(0, 10) : '';
        var q = y.a.date ? String(y.a.date).slice(0, 10) : '';
        if (p !== q) return p < q ? -1 : 1;
        return x.i - y.i;
      })
      .map(function (x) {
        return x.a;
      });

    var rubricIds = {};
    listed.forEach(function (a) {
      if (a.rubricId || a.rubric_id) rubricIds[a.rubricId || a.rubric_id] = true;
    });
    var rubrics = (getRubrics(cid) || [])
      .filter(function (r) {
        return r && rubricIds[r.id];
      })
      .map(rubricReply)
      .sort(function (x, y) {
        return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
      });

    var assessments = listed.map(function (a) {
      var dibels = isDibelsScored(a);
      var status = getAssignmentStatus(cid, sid, a.id) || null;
      var row = dibels ? null : getGradeReturn(cid, sid, a.id);
      var scoring = scoringOf(cid, a);
      var grade = dibels ? null : givenCopy(cid, sid, a, status, scoring, returned);
      var hidden = status === 'NS' || status === 'EXC';
      // When it came back. A grade given with no return date was there before
      // the rule was kept (no row; or a row this device made when a draft
      // was saved over it, which keeps the old grade as returned_copy and no
      // date). The server's first batch dated those the day it was applied,
      // which this device does not know, so the piece's own date stands in.
      var returnedAt = row && row.returned_at ? row.returned_at : null;
      if (!returnedAt && grade) returnedAt = a.date || a.dueDate || today;
      var tagIds = (a.tagIds || a.tag_ids || []).filter(function (id) {
        return !!tags[id];
      });
      return {
        id: str(a.id),
        title: str(a.title),
        date: a.date ? String(a.date).slice(0, 10) : null,
        due_date: a.dueDate || a.due_date ? String(a.dueDate || a.due_date).slice(0, 10) : null,
        created_at: a.created_at || a.createdAt || null,
        score_mode: dibels ? 'dibels' : str(a.scoreMode || a.score_mode) || 'proficiency',
        max_points: num(a.maxPoints != null ? a.maxPoints : a.max_points),
        weight: num(a.weight),
        rubric_id: a.rubricId || a.rubric_id || null,
        tag_ids: tagIds.slice().sort(),
        status: status,
        returned_at: returnedAt,
        updated_at: (row && row.updated_at) || null,
        seen_at: (row && row.seen_at) || null,
        grade: grade,
        previous: hidden || !returnedAt || !row ? null : GradeState.studentPrevious(row, status, scoring),
      };
    });

    return {
      ok: true,
      v: 1,
      student: { enrollment_id: str(sid), first_name: str(displayNameFirst(student)) },
      course: {
        id: str(cid),
        name: str(course.name),
        block: str(course.block),
        grading_system: courseGradeMode(cid),
        // The class's own Counts As percents and points bands, or the defaults (calc.js reads them).
        grading_scale: getGradingScale(cid) || null,
      },
      tags: tags,
      rubrics: rubrics,
      assessments: assessments,
    };
  }

  /* ── 2. What the page draws, from a reply ──────────────────── */

  var STATUSES = { NS: 'NS', EXC: 'EXC', LATE: 'LATE' };

  /* The result line, worded by calc.js and constants.js as the student
     page's list words it. A level or points result also carries the 1-4
     band its colour comes from (calc.js's), and points their parts for
     Your Feedback: the score, the most, the percent (formatPointsPercent)
     and how full its bar is. */
  function resultOf(cid, a, cell) {
    var out = { kind: 'none', text: '', word: '' };
    if (!cell) return out;
    if (cell.kind === 'level') {
      out.kind = 'level';
      out.text = str(cell.text);
      out.word = levelWord(cid, cell.value) || '';
      out.level = num(cell.level) || 0;
    } else if (cell.kind === 'points') {
      var max = num(a.max_points) || 100;
      out.kind = 'points';
      out.text = formatPoints(cell.value) + ' / ' + formatPoints(max);
      out.level = num(cell.level) || 0;
      out.points = formatPoints(cell.value);
      out.outOf = formatPoints(max);
      out.percent = formatPointsPercent(cell.value, max);
      // A bar, not a grade: how much of it is filled, 0 to 100.
      out.bar = Math.max(0, Math.min(100, (Number(cell.value) / max) * 100));
    } else if (cell.kind === 'complete') {
      out.kind = 'complete';
      out.text = cell.mark === 'complete' ? 'Complete' : 'Incomplete';
    }
    return out;
  }

  // A level's name alone, "Developing": constants.js's scoreLevelText with no + or −.
  function levelName(level) {
    var l = Number(level);
    return [1, 2, 3, 4].indexOf(l) >= 0 && typeof scoreLevelText === 'function' ? scoreLevelText(l, 0) : '';
  }

  /* What the Levels Mean: the four levels by name, Emerging to Extending,
     when constants.js is in to name them. */
  function levelsLegend() {
    var names = [1, 2, 3, 4].map(levelName);
    return names[0]
      ? names.map(function (name, i) {
          return { level: i + 1, name: name };
        })
      : [];
  }

  // A level as one row's name for it, "Proficient +": constants.js's scoreLevelText.
  function levelRow(id, name, part) {
    var value = part ? num(part.value) : null;
    var mod = part ? num(part.modifier) || 0 : 0;
    return {
      id: str(id),
      name: str(name),
      level: value,
      text: value ? scoreLevelText(value, mod) : '',
      comment: str(part && part.comment),
    };
  }

  /* The rubric rows of a piece: every criterion on its rubric, in order,
     with the level given (or none), its comment and Went Beyond, and each
     checkbox with whether it was ticked. With no grade (work not back yet)
     the rows hold the rubric's own words and no level.
     For Your Feedback, each row also says, by the level's name: what the
     level given means here (its descriptor), and what the next level up
     asks (its descriptor, and on an Advanced Rubric its boxes not ticked);
     the Proficient wording (a Single-Point Rubric's goal); and each of the
     four levels for The Whole Rubric, the one given marked. */
  function rubricView(rubric, grade) {
    var criteria = (grade && grade.criteria) || {};
    var ticked = {};
    ((grade && grade.checks) || []).forEach(function (id) {
      ticked[id] = true;
    });
    return {
      id: rubric.id,
      name: str(rubric.name),
      style: str(rubric.style) || 'standard',
      rows: (rubric.criteria || []).map(function (c) {
        var part = criteria[c.id] || null;
        var row = levelRow(c.id, c.name, part);
        row.beyond = str(part && part.beyond);
        row.descriptors = [1, 2, 3, 4].map(function (l) {
          return str(c['level_' + l + '_descriptor']);
        });
        row.checks = (c.checks || []).map(function (k) {
          return { id: k.id, level: num(k.level), label: str(k.label), ticked: !!ticked[k.id] };
        });
        var given = row.level >= 1 && row.level <= 4 ? row.level : 0;
        var at = function (l) {
          return row.checks.filter(function (k) {
            return k.level === l;
          });
        };
        row.levelName = levelName(given);
        row.descriptor = given ? row.descriptors[given - 1] : '';
        row.shown = row.checks.filter(function (k) {
          return k.ticked;
        });
        row.next =
          given && given < 4
            ? {
                level: given + 1,
                name: levelName(given + 1),
                descriptor: row.descriptors[given],
                checks: at(given + 1).filter(function (k) {
                  return !k.ticked;
                }),
              }
            : null;
        row.goal = row.descriptors[2];
        row.whole = [1, 2, 3, 4].map(function (l) {
          return { level: l, name: levelName(l), descriptor: row.descriptors[l - 1], checks: at(l), you: l === given };
        });
        return row;
      }),
    };
  }

  /* A returned grade changed since the student last looked (the
     artboard's "A Returned Grade Was Updated"): when, and on each row whose
     level moved, the level the student saw before ("Was Developing"),
     named by constants.js's scoreLevelText. The reply's `previous` is the
     grade before the newest return. */
  function markWas(piece, row) {
    var previous = row.previous;
    var tagIds = row.tag_ids || [];
    piece.updatedAt = str(row.updated_at);
    if (!previous || typeof previous !== 'object') return;
    var rows = piece.rubric ? piece.rubric.rows : piece.competencies;
    var before = (piece.rubric ? previous.criteria : previous.tags) || {};
    // An Overall level alone stands under the first competency, as the page shows it.
    if (!piece.rubric && !Object.keys(before).length && num(previous.value) > 0 && tagIds.length) {
      before = {};
      before[tagIds[0]] = { value: previous.value, modifier: previous.modifier };
    }
    rows.forEach(function (r) {
      var p = before[r.id];
      var was = p && num(p.value) > 0 ? scoreLevelText(num(p.value), num(p.modifier) || 0) : '';
      if (was && was !== r.text) r.was = was;
    });
  }

  // What a piece is graded on: its competencies by name, in the reply's order.
  function gradedOn(row, tags) {
    return (row.tag_ids || [])
      .filter(function (id) {
        return tags[id] && tags[id].label;
      })
      .map(function (id) {
        return { id: str(id), name: str(tags[id].label) };
      });
  }

  /* The plain data the student page draws, from a `page` reply (the
     server's, or reply() above). `cellOf(piece)` gives calc.js's cell for
     one returned piece (assessmentCellValue) in this class; it is asked
     only for a piece that came back with a grade. With no cellOf, results
     are left blank (the page then says they did not load).

     { student: { id, firstName },
       course:  { name, block, gradingSystem },
       counts:  { toDo, sent, back, missing },
       work:    [ piece ], newest first,
       changes: [ { id, title, why: 'updated' | 'back' } ],
       levels:  [ { level, name } ], Emerging to Extending (What the
                Levels Mean), or none while constants.js is not in,
       questionnaires: [ { id, title, line, minutes, state: 'open' |
                'sent' | 'soon', opensOn, until, sentOn } ],
       reports: [ { id, title, issued, until, isNew, result: { word, text,
                level }, comment } ],
       learning: null here; fromCache's My Learning (learning() below) }
     piece: { id, title, date, dueDate, kind: 'due' | 'back' | 'missing' |
              'excused', late, returnedAt, updated, unseen,
              result: { kind: 'level' | 'points' | 'complete' | 'none',
                        text, word, and for a level or points: level (its
                        1-4 band); for points: points, outOf, percent,
                        bar },
              comment, competencies: [ row ], gradedOn: [ { id, name } ],
              updatedAt (when updated), and on a row that moved, was,
              rubric: null | { id, name, style, rows: [ row + beyond,
              descriptors, checks, levelName, descriptor, shown, next,
              goal, whole ] } }
     row: { id, name, level, text, comment }
     A piece not back yet has its rubric's words and no level in it.
     sent is 0: the page sends no work yet (S5). */
  function build(page, cid, cellOf) {
    page = page || {};
    var course = page.course || {};
    var student = page.student || {};
    var tags = page.tags || {};
    var rubrics = {};
    (page.rubrics || []).forEach(function (r) {
      if (r && r.id) rubrics[r.id] = r;
    });
    var work = [];
    (page.assessments || []).forEach(function (row) {
      // A DIBELS benchmark is a reading record, not work a student gets back.
      if (!row || !row.id || row.score_mode === 'dibels') return;
      var status = STATUSES[row.status] || null;
      var hidden = status === 'NS' || status === 'EXC';
      var grade = !hidden && row.returned_at && row.grade && typeof row.grade === 'object' ? row.grade : null;
      var piece = {
        id: str(row.id),
        title: str(row.title),
        date: str(row.date).slice(0, 10),
        dueDate: str(row.due_date).slice(0, 10),
        kind: status === 'NS' ? 'missing' : status === 'EXC' ? 'excused' : row.returned_at ? 'back' : 'due',
        late: status === 'LATE',
        returnedAt: hidden ? '' : str(row.returned_at),
        updated: false,
        unseen: false,
        result: { kind: 'none', text: '', word: '' },
        comment: '',
        competencies: [],
        rubric: null,
        gradedOn: gradedOn(row, tags),
        created_at: str(row.created_at),
      };
      // Work not back yet shows its rubric's words (See the Rubric), with no level.
      if (!grade && !hidden && row.rubric_id && rubrics[row.rubric_id]) {
        piece.rubric = rubricView(rubrics[row.rubric_id], null);
      }
      if (grade) {
        var returned = when(row.returned_at);
        var changed = when(row.updated_at);
        var seen = when(row.seen_at);
        piece.updated = changed != null && !(seen != null && seen >= changed) && canon(row.previous) !== canon(grade);
        piece.unseen = !(seen != null && seen >= Math.max(returned || 0, changed || 0));
        piece.result = resultOf(cid, row, typeof cellOf === 'function' ? cellOf(piece.id) : null);
        piece.comment = str(grade.comment);
        if (row.rubric_id && rubrics[row.rubric_id]) {
          piece.rubric = rubricView(rubrics[row.rubric_id], grade);
        } else if (row.score_mode !== 'points' && row.score_mode !== 'complete') {
          var parts = grade.tags || {};
          var ids = row.tag_ids || [];
          // An Overall level alone shows under the first competency, as the app shows it.
          if (!Object.keys(parts).length && num(grade.value) > 0 && ids.length) {
            parts = {};
            parts[ids[0]] = { value: grade.value, modifier: grade.modifier, comment: null };
          }
          piece.competencies = ids
            .filter(function (id) {
              return parts[id];
            })
            .map(function (id) {
              return levelRow(id, (tags[id] || {}).label, parts[id]);
            });
        }
        if (piece.updated) markWas(piece, row);
      }
      work.push(piece);
    });
    work = inOrder(work);
    var count = function (kind) {
      return work.filter(function (p) {
        return p.kind === kind;
      }).length;
    };
    var changes = work
      .filter(function (p) {
        return p.kind === 'back' && p.result.kind !== 'none' && (p.updated || p.unseen);
      })
      .map(function (p) {
        return { id: p.id, title: p.title, why: p.updated ? 'updated' : 'back' };
      });
    return {
      student: { id: str(student.enrollment_id), firstName: str(student.first_name) },
      course: {
        name: str(course.name),
        block: str(course.block),
        gradingSystem:
          course.grading_system === 'letter' || course.grading_system === 'both'
            ? course.grading_system
            : 'proficiency',
      },
      counts: { toDo: count('due'), sent: 0, back: count('back'), missing: count('missing') },
      work: work,
      changes: changes,
      levels: levelsLegend(),
      questionnaires: questionnairesOf(page),
      reports: reportsOf(page),
      // My Learning: fromCache fills it when the class shows it. The
      // server's `page` sends nothing for it yet, so on the student's own
      // device it stays null and the tab says it is off.
      learning: null,
    };
  }

  /* The Questionnaires and Reports tabs (S4-F4), from the reply's
     `questionnaires` and `reports` when it has them. The server's `page`
     sends neither yet (see the S4-F4 pull request): until it does both lists
     are empty, from either door. The server decides each questionnaire's
     state, so nothing here reads a clock.
       questionnaire: { id, title, description, minutes, state: 'open' |
                        'sent' | 'not_open_yet', opens_on, closes_on, sent_at }
       report:        { id, title, issued_at, expires_on, opened_at,
                        overall: { word, text, level }, comment: [ text ] }
     The report's overall and comment are the phone report as the teacher
     sent it (worded by calc.js when it was sent), as s/report.js shows it. */
  var Q_STATES = { open: 'open', sent: 'sent', not_open_yet: 'soon' };
  function questionnairesOf(page) {
    return (Array.isArray(page.questionnaires) ? page.questionnaires : [])
      .filter(function (q) {
        return q && q.id && Q_STATES[q.state];
      })
      .map(function (q) {
        return {
          id: str(q.id),
          title: str(q.title),
          line: str(q.description),
          minutes: num(q.minutes),
          state: Q_STATES[q.state],
          opensOn: str(q.opens_on).slice(0, 10),
          until: str(q.closes_on).slice(0, 10),
          sentOn: str(q.sent_at),
        };
      });
  }
  function reportsOf(page) {
    return (Array.isArray(page.reports) ? page.reports : [])
      .filter(function (r) {
        return r && r.id;
      })
      .map(function (r) {
        var o = r.overall && typeof r.overall === 'object' ? r.overall : {};
        return {
          id: str(r.id),
          title: str(r.title),
          issued: str(r.issued_at),
          until: str(r.expires_on).slice(0, 10),
          isNew: !r.opened_at,
          result: { word: str(o.word), text: str(o.text), level: num(o.level) },
          comment: Array.isArray(r.comment) ? str(r.comment[0]) : str(r.comment),
        };
      });
  }

  /* Newest first, by due date, or the date with none. Two pieces with the
     same date: the one made later first (Colin, Nov 10); two made at the
     same instant by id. As s/assignments.js orders its list. */
  function inOrder(list) {
    var madeAt = function (p) {
      return when(p.created_at);
    };
    return list.slice().sort(function (x, y) {
      var a = x.dueDate || x.date || '';
      var b = y.dueDate || y.date || '';
      if (a !== b) return a < b ? 1 : -1;
      var m = madeAt(x);
      var n = madeAt(y);
      if (m == null || n == null) return 0;
      if (m !== n) return m < n ? 1 : -1;
      return x.id < y.id ? 1 : x.id > y.id ? -1 : 0;
    });
  }

  /* ── My Learning (S13-T1) ──────────────────────────────────── */

  /* Show My Learning, the class's switch (Class Settings › Student Page,
     S13-F1): on only when the class's settings say so. Missing is off. */
  function learningOn(cid) {
    var cfg = (typeof getCourseConfig === 'function' && getCourseConfig(cid)) || {};
    return cfg.show_my_learning === true;
  }

  // A whole level, 1 to 4, for a level's colour and its step on the ladder; 0 with none (calc.js's).
  function bandOf(value) {
    return nearestScoreLevel(Number(value)).level;
  }

  /* One skill's mark on one returned piece: the piece, its date, and the
     mark named by constants.js's scoreLevelText ("Proficient +") in a class
     that uses levels, or calc.js's formatLevel ("78%") in a Letter class.
     `value` places it on How It's Going (a + or − a third of a level, as
     every calculation counts it). */
  function markOf(cid, p, e) {
    var value = scoreModValue(e);
    var whole = e.level != null ? Number(e.level) : Number(e.score);
    var letter = courseGradeMode(cid) === 'letter';
    return {
      id: p.id,
      title: p.title,
      date: p.dueDate || p.date || '',
      value: value,
      level: bandOf(value),
      text: letter ? formatLevel(cid, value) : scoreLevelText(whole, e.mod) || levelText(cid, value),
      code: letter ? '' : levelCode(value),
    };
  }

  /* One skill (a competency of the learning map): its name, its I Can
     statements as the learning map holds them (the curriculum bank's), the
     level calc.js gives it from returned work (getSectionProficiency),
     worded as the class grades, and its marks on each returned piece,
     newest first. */
  function skillOf(cid, sid, sec, back) {
    var value = getSectionProficiency(cid, sid, sec.id);
    var letter = courseGradeMode(cid) === 'letter';
    var iCan = [];
    var pieces = [];
    (sec.tags || []).forEach(function (t) {
      (t.i_can_statements || t.iCanStatements || []).forEach(function (s) {
        var line = str(s).trim();
        if (line) iCan.push(line);
      });
      tagMarksByAssessment(cid, sid, t.id).forEach(function (e) {
        var p = back[e.assessmentId];
        if (p && Number(e.score) > 0) pieces.push(markOf(cid, p, e));
      });
    });
    pieces.sort(function (x, y) {
      return x.date === y.date ? 0 : x.date < y.date ? 1 : -1;
    });
    var has = value > 0;
    return {
      id: str(sec.id),
      name: str(sec.name || sec.shortName || sec.id),
      level: bandOf(value),
      text: has ? (letter ? formatLevel(cid, value) : levelWord(cid, value)) : '',
      code: has && !letter ? levelCode(value) : '',
      iCan: iCan,
      pieces: pieces,
      value: has ? value : 0,
    };
  }

  /* The class's skills in the learning map's order, in its folders, under
     each course's name when the class holds more than one. */
  function skillGroups(cid, sid, back) {
    var grouped = getGroupedSections(cid) || { groups: [], ungrouped: [] };
    var subjects = {};
    ((typeof getSubjects === 'function' && getSubjects(cid)) || []).forEach(function (s) {
      if (s && s.id) subjects[s.id] = str(s.name || s.label);
    });
    var out = [];
    var add = function (folder, sections) {
      var bySubject = [];
      sections.forEach(function (sec) {
        var subject = subjects[sec.subject] || '';
        var last = bySubject[bySubject.length - 1];
        if (!last || last.subject !== subject) bySubject.push((last = { subject: subject, sections: [] }));
        last.sections.push(sec);
      });
      bySubject.forEach(function (g) {
        out.push({
          subject: g.subject,
          folder: folder,
          skills: g.sections.map(function (sec) {
            return skillOf(cid, sid, sec, back);
          }),
        });
      });
    };
    (grouped.groups || []).forEach(function (g) {
      if (g && g.sections && g.sections.length) add(str(g.group.name || g.group.label), g.sections);
    });
    if ((grouped.ungrouped || []).length) add('', grouped.ungrouped);
    // One course's name says nothing; two or more head their skills.
    var names = {};
    out.forEach(function (g) {
      if (g.subject) names[g.subject] = true;
    });
    if (Object.keys(names).length < 2) {
      out.forEach(function (g) {
        g.subject = '';
      });
    }
    return out;
  }

  /* What Makes Up Your Grade: each category with a grade, its weight and
     the student's letter and % on its work (calc.js's assessmentGroupGrade,
     the category's own way of adding up). Letter and Both classes only. */
  function categoriesOf(cid, sid) {
    if (courseGradeMode(cid) === 'proficiency') return [];
    var all = getAssessments(cid) || [];
    return ((typeof getCategories === 'function' && getCategories(cid)) || [])
      .slice()
      .sort(function (x, y) {
        return (Number(x.displayOrder) || 0) - (Number(y.displayOrder) || 0);
      })
      .map(function (category) {
        var g = assessmentGroupGrade(
          cid,
          sid,
          all.filter(function (a) {
            return (a.categoryId || a.category_id || null) === category.id;
          }),
          typeof categoryCalcMode === 'function' ? categoryCalcMode(category) : 'points',
        );
        if (!g || !g.letter) return null;
        return {
          id: str(category.id),
          name: str(category.name),
          weight: num(category.weight),
          text: g.letter,
          level: g.level,
        };
      })
      .filter(Boolean);
  }

  /* The student's My Learning, from the teacher's cache. Called inside
     withReturnedOnly (fromCache), so every level, letter and % is calc.js's
     on returned work only, for the year so far. `view` is the page built
     from the same reply (its returned pieces and its Missing work).
       { mode: 'proficiency' | 'letter' | 'both', empty,
         overall: { text, level, word, letter: null | { grade, pct } },
         categories: [ { id, name, weight, text, level } ],
         strongest: skill | null, missing: [ piece ], work: [ piece ]
         (returned pieces with a result, newest first),
         groups: [ { subject, folder, skills: [ skill ] } ],
         steps: [ { level, name, code } ], Emerging to Extending }
       skill: { id, name, level, text, code, iCan: [ text ], pieces:
         [ { id, title, date, value, level, text, code } ] }
     Nothing in it is another student's or the class's: no average, no
     rank, no count of anyone else. Left out until calc.js has them (Colin's
     review): how the grade moved in a month, and the Next Step. */
  function learning(cid, sid, view) {
    return readAsOfTerm(cid, null, function () {
      var mode = courseGradeMode(cid);
      var back = {};
      var work = [];
      view.work.forEach(function (p) {
        if (p.kind === 'back' && p.result && p.result.text) {
          back[p.id] = p;
          work.push(p);
        }
      });
      var groups = skillGroups(cid, sid, back);
      var strongest = null;
      groups.forEach(function (g) {
        g.skills.forEach(function (s) {
          if (s.value > 0 && (!strongest || s.value > strongest.value)) strongest = s;
        });
      });
      var badges = studentGradeBadges(cid, sid);
      var summary = studentGradeSummary(cid, sid);
      var overall = {
        text: summary.text,
        level: summary.level,
        word: badges.prof ? levelWord(cid, getOverallProficiency(cid, sid)) : '',
        letter: badges.letter ? { grade: str(badges.letter.grade), pct: str(badges.letter.pct) } : null,
      };
      groups.forEach(function (g) {
        g.skills.forEach(function (s) {
          delete s.value;
        });
      });
      var missing = view.work
        .filter(function (p) {
          return p.kind === 'missing';
        })
        .reverse();
      return {
        mode: mode,
        empty: !summary.text && !work.length,
        overall: overall,
        categories: categoriesOf(cid, sid),
        strongest: strongest,
        missing: missing,
        work: work,
        groups: groups,
        // The four steps of a skill's ladder, Emerging to Extending, named by constants.js and calc.js.
        steps: [1, 2, 3, 4].map(function (l) {
          return { level: l, name: levelName(l), code: levelCode(l) };
        }),
      };
    });
  }

  /* ── The two doors ─────────────────────────────────────────── */

  /* Preview as Student: one student's page from the teacher's cache.
     { ready: false } while the class's returned grades cannot be read;
     otherwise { ready: true, reply, view }. Every result is worked out by
     calc.js on returned grades only. view.learning is My Learning when the
     class shows it, else null. */
  function fromCache(cid, sid) {
    var page = reply(cid, sid);
    if (!page) return { ready: false };
    var view = withReturnedOnly(function () {
      var v = build(page, cid, function (aid) {
        var a = pieceOf(cid, aid);
        return a ? assessmentCellValue(cid, sid, a) : null;
      });
      v.learning = learningOn(cid) ? learning(cid, sid, v) : null;
      return v;
    });
    return { ready: true, reply: page, view: view };
  }

  /* The student page: the view of the server's reply, once
     s/student-data.js holds it (StudentData.use(StudentData.fromServer(
     reply))). Results come from calc.js on that page's own readers; with
     calc.js not loaded they are blank. */
  function fromPage(serverReply, studentPage) {
    var p = studentPage;
    var cid = p && p.course ? p.course.id : '';
    var sid = p && p.student ? p.student.id : '';
    var ready = typeof assessmentCellValue === 'function';
    return build(serverReply, cid, function (aid) {
      if (!ready || !p) return null;
      var a = (p.assessments || []).find(function (x) {
        return x.id === aid;
      });
      return a ? assessmentCellValue(cid, sid, a) : null;
    });
  }

  return {
    ready: ready,
    reply: reply,
    build: build,
    fromCache: fromCache,
    fromPage: fromPage,
    learningOn: learningOn,
  };
})();
