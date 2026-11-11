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
  // Text as sent, or '' for anything that is not text (a new key of the wrong type shows nothing).
  function text(v) {
    return typeof v === 'string' ? v : '';
  }
  // Text, or null when there is none (the server sends an empty name or Description as null).
  function textOrNull(v) {
    return v != null && String(v) !== '' ? String(v) : null;
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

  /* What a category counts toward the course grade, as the server states it
     (migrations/local-test/s4-m1-contract.md, "category_percent"): the
     category's weight where "counts N% of your grade" is true as the class
     is set up, 0 where its work counts toward nothing, null where no percent
     would be true. The class's setup, never this student's arithmetic. */
  function categoryPercent(cid, a, category) {
    if (!category || isDibelsScored(a)) return null;
    if (Number(category.weight) === 0) return 0;
    var total = ((typeof getCategories === 'function' && getCategories(cid)) || []).reduce(function (sum, c) {
      return sum + Number((c && c.weight) || 0);
    }, 0);
    return courseGradeMode(cid) !== 'proficiency' && Math.abs(total - 100) < 1e-9 ? Number(category.weight) : null;
  }

  // A piece's Core Competencies, each once, in the Ministry's order, by their names.
  function coreCompetenciesOf(a) {
    var ids = typeof _coreCompetencyIdsOf === 'function' ? _coreCompetencyIdsOf(a.coreCompetencyIds) : [];
    return ids
      .map(function (id) {
        var cc = typeof getCoreCompetency === 'function' ? getCoreCompetency(id) : null;
        return cc ? { id: str(id), name: str(cc.label) } : null;
      })
      .filter(Boolean);
  }

  function rubricReply(rubric, tags) {
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
        // The competencies this row counts toward, only those still on the class, by id.
        row.tag_ids = (Array.isArray(c.tagIds) ? c.tagIds : [])
          .map(str)
          .filter(function (id, i, all) {
            return !!tags[id] && all.indexOf(id) === i;
          })
          .sort();
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
      if (!t || !t.id) return;
      // Its I Can statements as the class has them: in order, not trimmed, blanks kept (as the server sends them).
      var iCan = t.i_can_statements || t.iCanStatements;
      tags[t.id] = {
        label: str(t.label),
        code: str(t.code),
        i_can: (Array.isArray(iCan) ? iCan : []).filter(function (s) {
          return typeof s === 'string';
        }),
      };
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
      .map(function (r) {
        return rubricReply(r, tags);
      })
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
      var moduleId = a.moduleId || a.module_id;
      var unit = moduleId && typeof getModuleById === 'function' ? getModuleById(cid, moduleId) : null;
      var categoryId = a.categoryId || a.category_id;
      var category = categoryId && typeof getCategoryById === 'function' ? getCategoryById(cid, categoryId) : null;
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
        description: textOrNull(a.description),
        module_name: unit && unit.name != null ? str(unit.name) : null,
        category_name: category && category.name != null ? str(category.name) : null,
        category_percent: categoryPercent(cid, a, category),
        core_competencies: coreCompetenciesOf(a),
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
        // No teacher_name: the student page never names the teacher (Colin's ruling 112).
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
  function rubricView(rubric, grade, tags) {
    tags = tags || {};
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
        // The competencies this row counts toward, by name ("Counts toward Perspective").
        row.toward = list(c.tag_ids)
          .map(str)
          .filter(function (id, i, all) {
            return all.indexOf(id) === i && tags[id] && tags[id].label;
          })
          .map(function (id) {
            return str(tags[id].label);
          });
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
    /* A piece with a result only (points, or Complete/Incomplete) has no
       rows: its Your Result says what it was, worded as resultOf words a
       result ("6 / 10", "Incomplete"), so Updated says what changed. */
    var res = piece.result || {};
    var v = num(previous.value);
    var then = '';
    if (res.kind === 'complete' && v != null) then = v > 0 ? 'Complete' : 'Incomplete';
    else if (res.kind === 'points' && v != null && typeof formatPoints === 'function') {
      then = formatPoints(v) + ' / ' + res.outOf;
    }
    if (then && res.text && then !== res.text) res.was = then;
  }

  // A list from a reply, or none when what came is not a list.
  function list(v) {
    return Array.isArray(v) ? v : [];
  }

  // A competency's I Can lines as the page shows them: text only, blanks left out.
  function iCanOf(tag) {
    return list(tag && tag.i_can)
      .map(function (s) {
        return text(s).trim();
      })
      .filter(Boolean);
  }

  /* What a piece is graded on: its competencies by name, in the reply's
     order, then those its rubric's rows count toward; each once, with its
     I Can lines (none until the server sends them). */
  function gradedOn(row, tags, rubric) {
    var ids = list(row.tag_ids).slice();
    if (rubric) {
      list(rubric.criteria).forEach(function (c) {
        Array.prototype.push.apply(ids, list(c && c.tag_ids));
      });
    }
    return ids
      .map(str)
      .filter(function (id, i, all) {
        return all.indexOf(id) === i && tags[id] && tags[id].label;
      })
      .map(function (id) {
        return { id: id, name: str(tags[id].label), iCan: iCanOf(tags[id]) };
      });
  }

  /* What the reply says about a piece beyond its grade (S4-M1; each is
     left out while the server does not send it, and a value of the wrong
     type is read as none): its unit, its category and what that counts
     toward the grade, the teacher's Description, its Core Competencies. */
  function aboutOf(row) {
    var percent = row.category_percent;
    var name = text(row.category_name);
    return {
      unit: text(row.module_name),
      category: name
        ? { name: name, percent: typeof percent === 'number' && isFinite(percent) && percent >= 0 ? percent : null }
        : null,
      description: text(row.description),
      coreCompetencies: list(row.core_competencies)
        .filter(function (c) {
          return c && typeof c === 'object' && text(c.id) && text(c.name);
        })
        .map(function (c) {
          return { id: c.id, name: c.name };
        }),
    };
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
     piece: { id, title, date, dueDate, kind: 'due' | 'sent' | 'back' | 'missing' |
              'excused', late, returnedAt, updated, unseen,
              result: { kind: 'level' | 'points' | 'complete' | 'none',
                        text, word, and for a level or points: level (its
                        1-4 band); for points: points, outOf, percent,
                        bar },
              comment, competencies: [ row ], gradedOn: [ { id, name } ],
              updatedAt (when updated), and on a row that moved, was,
              marks: null | { pages, notes } (the teacher's Mark Up given
              on returned work, from the `feedback` reply),
              rubric: null | { id, name, style, rows: [ row + beyond,
              descriptors, checks, levelName, descriptor, shown, next,
              goal, whole ] } }
     row: { id, name, level, text, comment }
     A piece not back yet has its rubric's words and no level in it.
     sent counts work sent and not back yet; it is 0 without a `work` reply
     (S5-F2). A piece's send: null, or { takes, open, closesOn, lateNow,
     sent: null | { at, pages, late, note, byTeacher, onPaper, grading,
     canChange, canSend, teacherPages, thumbs } } (sendOf). */
  /* What the `work` reply says about sending one piece (S5-F2; the
     contract is migrations/local-test/batch-b-contract.md, `work`), or null
     when the class takes no work or the piece takes none and has none in.
     Read as the contract types it; anything else reads as none. thumbs is
     the student's own pages to show, as addresses on this device (Demo
     Mode's, or fetched through `file-links` by s/send.js). */
  var TAKES = { photos: 'photos', photos_files: 'photos_files' };
  function sendOf(entry) {
    if (!entry || typeof entry !== 'object') return null;
    var sent = entry.sent && typeof entry.sent === 'object' ? entry.sent : null;
    var takes = TAKES[entry.students_send] || '';
    if (!takes && !sent) return null;
    var whole = function (v) {
      return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : 0;
    };
    return {
      takes: takes,
      open: entry.open === true,
      closesOn: text(entry.closes_on).slice(0, 10),
      lateNow: entry.late_now === true,
      sent: sent
        ? {
            at: text(sent.sent_at),
            pages: whole(sent.pages),
            late: sent.is_late === true,
            note: text(sent.note),
            byTeacher: sent.sent_by === 'teacher',
            onPaper: sent.on_paper === true,
            grading: sent.grading === true,
            canChange: sent.can_change === true,
            // Work the teacher added that the student can send onto (ruling 107: their pages go first).
            canSend: sent.sent_by === 'teacher' && sent.can_send === true,
            // How many of the pages the teacher added. Not in the contract's `work` yet (Demo Mode's own):
            // the Unsend line that names them needs it from the server.
            teacherPages: whole(sent.teacher_pages),
            thumbs: list(sent.thumbs).filter(function (u) {
              return typeof u === 'string' && /^(blob:|data:image\/jpeg)/.test(u);
            }),
          }
        : null,
    };
  }

  /* What the `feedback` reply says of the teacher's Mark Up on one piece
     (S9-F3; migrations/local-test/batch-c-contract.md, `feedback`): how
     many of the student's pages carry the marks they were given, and how
     many of those marks are notes ("2 pages · 3 notes on your work"). The
     server sends it only for work returned with marks, and none for a
     piece set not to show them or with Missing or Excused on it; build()
     also gives it only to a piece that came back with a grade. Anything of
     the wrong shape reads as none. */
  function marksOf(m) {
    if (!m || typeof m !== 'object') return null;
    var whole = function (v) {
      return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : -1;
    };
    var pages = whole(m.pages);
    var notes = whole(m.notes);
    return pages >= 1 && notes >= 0 ? { pages: pages, notes: notes } : null;
  }

  // The `feedback` reply's pieces by id (Mark Up only, for now), or none for a reply that is not one.
  function marksBy(feedback) {
    var out = {};
    if (!feedback || typeof feedback !== 'object' || feedback.ok !== true) return out;
    list(feedback.assessments).forEach(function (entry) {
      if (!entry || typeof entry.id !== 'string') return;
      var m = marksOf(entry.marks);
      if (m) out[entry.id] = m;
    });
    return out;
  }

  /* The student's own reflection on one piece, from the `feedback` reply
     (S10-F1; the contract's `reflection`), or null. Only the student's own
     words and the teacher's answer once sent: the server sends nothing
     else, and anything of the wrong type reads as none. */
  var SENSE = { yes: 'yes', not_sure: 'not_sure' };
  function reflectionOf(r) {
    if (!r || typeof r !== 'object' || !SENSE[r.makes_sense] || !text(r.sent_at)) return null;
    return {
      makesSense: SENSE[r.makes_sense],
      question: text(r.question),
      plan: text(r.plan),
      wentWell: text(r.went_well),
      sentAt: text(r.sent_at),
      answer: text(r.answer),
      answeredAt: text(r.answered_at),
      senseNow: SENSE[r.sense_now] || '',
      followUp: text(r.follow_up),
      followUpAnswer: text(r.follow_up_answer),
      followUpAnsweredAt: text(r.follow_up_answered_at),
    };
  }

  function reflectionsBy(feedback) {
    var out = {};
    if (!feedback || typeof feedback !== 'object' || feedback.ok !== true) return out;
    list(feedback.assessments).forEach(function (entry) {
      if (!entry || typeof entry.id !== 'string') return;
      var r = reflectionOf(entry.reflection);
      if (r) out[entry.id] = r;
    });
    return out;
  }

  /* The student's own revision request on one piece (S11-F2), from the
     `feedback` reply (Batch C's contract: the student's shape of
     revision_request, shared/data.js's _studentRevisionOf), or null. The
     state is the student's: open (Needs Revision), sent (the revision is
     in; a draft regrade also reads as sent, since a draft is never theirs
     to see) or returned. A request taken back is not sent at all. Anything
     of the wrong shape reads as none. first_thumbs and thumbs are the
     pages to show (Demo Mode's own, as `work`'s thumbs are), checked to be
     a picture this page made or ships. */
  var REVISION_STATES = { open: 'open', sent: 'sent', returned: 'returned' };
  var REVISION_PAGE = /^(blob:|data:image\/jpeg|\/assets\/sample-work\/|\.\.\/assets\/sample-work\/)[^"'<>\s]*$/;
  function revisionOf(r) {
    if (!r || typeof r !== 'object' || !REVISION_STATES[r.state] || !text(r.what_to_fix).trim()) return null;
    var pages = function (v) {
      return list(v).filter(function (u) {
        return typeof u === 'string' && REVISION_PAGE.test(u);
      });
    };
    var by = text(r.revise_by).slice(0, 10);
    return {
      state: REVISION_STATES[r.state],
      whatToFix: text(r.what_to_fix),
      reviseBy: /^\d{4}-\d{2}-\d{2}$/.test(by) ? by : '',
      criterionIds: list(r.criterion_ids).filter(function (id) {
        return typeof id === 'string';
      }),
      firstGrade: r.first_grade && typeof r.first_grade === 'object' ? r.first_grade : null,
      firstSentAt: text(r.first_sent_at),
      sentAt: r.state === 'open' ? '' : text(r.revision_sent_at),
      note: r.state === 'open' ? '' : text(r.revision_note),
      late: r.state !== 'open' && r.revision_late === true,
      askedAt: text(r.asked_at),
      firstThumbs: pages(r.first_thumbs),
      thumbs: r.state === 'open' ? [] : pages(r.thumbs),
    };
  }

  function revisionsBy(feedback) {
    var out = {};
    if (!feedback || typeof feedback !== 'object' || feedback.ok !== true) return out;
    list(feedback.assessments).forEach(function (entry) {
      if (!entry || typeof entry.id !== 'string') return;
      var r = revisionOf(entry.revision);
      if (r) out[entry.id] = r;
    });
    return out;
  }

  /* The rows of a grade as the page names them: a rubric's criteria, or the
     piece's competencies (an Overall level alone under the first), each
     with its level's words (constants.js's scoreLevelText). */
  function gradeRows(row, grade, tags, rubric) {
    if (rubric) return rubricView(rubric, grade, tags).rows;
    if (row.score_mode === 'points' || row.score_mode === 'complete') return [];
    var parts = grade.tags || {};
    var ids = row.tag_ids || [];
    if (!Object.keys(parts).length && num(grade.value) > 0 && ids.length) {
      parts = {};
      parts[ids[0]] = { value: grade.value, modifier: grade.modifier, comment: null };
    }
    return ids
      .filter(function (id) {
        return parts[id];
      })
      .map(function (id) {
        return levelRow(id, (tags[id] || {}).label, parts[id]);
      });
  }

  /* What the piece's card and screens draw of its revision: the request,
     the criteria by name, and once the revision's grade is returned, Before
     and After: the first version's result (calc.js's, through cellOf) and
     each row's level then and now. Nothing is worked out here. */
  function revisionView(piece, rev, row, tags, rubric, cid, cellOf) {
    var names = {};
    (rubric ? rubricView(rubric, null, tags).rows : []).forEach(function (r) {
      names[r.id] = r.name;
    });
    var out = {
      state: rev.state,
      whatToFix: rev.whatToFix,
      reviseBy: rev.reviseBy,
      criteria: rev.criterionIds
        .filter(function (id) {
          return names[id];
        })
        .map(function (id) {
          return names[id];
        }),
      firstSentAt: rev.firstSentAt,
      sentAt: rev.sentAt,
      note: rev.note,
      late: rev.late,
      askedAt: rev.askedAt,
      firstThumbs: rev.firstThumbs,
      thumbs: rev.thumbs,
      before: null,
    };
    if (rev.state !== 'returned' || !rev.firstGrade || piece.result.kind === 'none') return out;
    var first = resultOf(cid, row, typeof cellOf === 'function' ? cellOf(piece.id, rev.firstGrade) : null);
    var then = {};
    gradeRows(row, rev.firstGrade, tags, rubric).forEach(function (r) {
      if (r.text) then[r.id] = r;
    });
    var now = (piece.rubric ? piece.rubric.rows : piece.competencies || []).filter(function (r) {
      return r.text;
    });
    out.before = {
      result: first,
      rows: now.map(function (r) {
        var was = then[r.id] || null;
        return {
          name: r.name,
          before: was ? was.text : '',
          beforeLevel: was ? was.level : null,
          after: r.text,
          level: r.level,
          same: !!was && was.text === r.text,
        };
      }),
    };
    return out;
  }

  /* Your Plan From Last Time (S10-F2): the plan from the student's latest
     reflection in this class, and the piece it goes on: the next piece
     still to do, the one due soonest on or after the day the plan was
     made (never the piece it was made on). Worked out from the reply's
     dates, with no clock. null with no plan, or nothing to do after it. */
  function planFor(feedback, work) {
    var lp = feedback && typeof feedback === 'object' && feedback.ok === true ? feedback.last_plan : null;
    if (!lp || typeof lp !== 'object' || !text(lp.plan).trim() || !text(lp.sent_at)) return null;
    var from = text(lp.assessment_id);
    var made = text(lp.sent_at).slice(0, 10);
    var next = null;
    work.forEach(function (p) {
      if (p.kind !== 'due' || p.id === from) return;
      var due = p.dueDate || p.date || '';
      if (!due || due < made) return;
      if (!next || due < (next.dueDate || next.date)) next = p;
    });
    if (!next) return null;
    var source = work.filter(function (p) {
      return p.id === from;
    })[0];
    return { pieceId: next.id, text: text(lp.plan).trim(), fromTitle: source ? source.title : '' };
  }

  /* The `feedback` reply for one student from the teacher's cache, in the
     contract's shape, for Preview as Student: the marks the student was
     given on each piece, as the data layer's getStudentMarkCounts counts
     them (the given copy only, none while the piece hides its Mark Up or
     Missing or Excused is on it). Before that reader exists, none. */
  function feedbackReply(cid, sid, page) {
    var counts = typeof getStudentMarkCounts === 'function' ? getStudentMarkCounts : null;
    // The student's own revision on each piece (S11-F2): getStudentRevision, the student's shape.
    var revisionFor = typeof getStudentRevision === 'function' ? getStudentRevision : null;
    var assessments = [];
    list(page && page.assessments).forEach(function (row) {
      var m = counts && row && row.id ? counts(cid, sid, row.id) : null;
      var rev = revisionFor && row && row.id ? revisionFor(cid, sid, row.id) : null;
      if (!m && !rev) return;
      var entry = { id: str(row.id), marks: m ? { pages: m.pages, notes: m.notes } : null };
      if (rev) entry.revision = rev;
      assessments.push(entry);
    });
    // Reflect on Feedback, the class's switch (Batch C's course column, as the data layer reads it
    // for Demo Mode and for a signed-in class): the preview shows its button.
    var on = typeof getReflectOnFeedback === 'function' && getReflectOnFeedback(cid) === true;
    return { ok: true, v: 1, reflect_on_feedback: on, assessments: assessments };
  }

  /* The `group_work` reply (S12-F1; Batch C's contract), by piece: how
     many are in the student's group, whether the group's work is in, how
     many pages, whether the student sent any of them, and when it was
     first sent. Counts only: no name of anyone in the group. Anything of
     the wrong shape reads as none. */
  function groupsBy(groups) {
    var out = {};
    if (!groups || typeof groups !== 'object' || groups.ok !== true) return out;
    var whole = function (v) {
      return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : -1;
    };
    list(groups.assessments).forEach(function (g) {
      if (!g || typeof g.id !== 'string' || whole(g.members) < 2 || typeof g.sent !== 'boolean') return;
      out[g.id] = {
        members: whole(g.members),
        sent: g.sent,
        pages: g.sent ? Math.max(0, whole(g.pages)) : 0,
        youSent: g.you_sent === true,
        sentAt: g.sent ? text(g.first_sent_at) : '',
      };
    });
    return out;
  }

  /* work: the `work` reply for this class (sending, S5-F2), or nothing.
     With Send Work off, or no reply, no piece says anything of sending and
     the page is as it was. */
  function build(page, cid, cellOf, work, feedback, groups) {
    page = page || {};
    var grouped = groupsBy(groups);
    var marked = marksBy(feedback);
    var reflections = reflectionsBy(feedback);
    var revisions = revisionsBy(feedback);
    var sending = {};
    if (work && typeof work === 'object' && work.send_work === true) {
      list(work.assessments).forEach(function (entry) {
        var send = entry && typeof entry.id === 'string' ? sendOf(entry) : null;
        if (send) sending[entry.id] = send;
      });
    }
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
        gradedOn: gradedOn(row, tags, row.rubric_id ? rubrics[row.rubric_id] : null),
        created_at: str(row.created_at),
        // The teacher's Mark Up on the student's pages (S9-F3): only on work that came back with a grade.
        marks: null,
        reflection: null,
        // Your Plan From Last Time, on the next piece to do (S10-F2): { text, fromTitle }.
        plan: null,
        // One per Group (S12-F1): { members, sent, pages, youSent, sentAt }, counts only.
        group: null,
        // A revision asked for (S11-F2): revisionView's, or null.
        revision: null,
        reviseUnseen: false,
      };
      Object.assign(piece, aboutOf(row));
      // Sending: what this piece takes, and what is in. Work sent and not back yet is Sent.
      piece.send = sending[piece.id] || null;
      // A group's work is in once any member has sent it: the piece is Sent for every member.
      piece.group = hidden ? null : grouped[piece.id] || null;
      if (piece.group && piece.group.sent && (piece.kind === 'due' || piece.kind === 'missing')) piece.kind = 'sent';
      if (piece.send && piece.send.sent && (piece.kind === 'due' || piece.kind === 'missing')) {
        piece.kind = 'sent';
        piece.late = piece.late || piece.send.sent.late;
      }
      // Work not back yet shows its rubric's words (See the Rubric), with no level.
      if (!grade && !hidden && row.rubric_id && rubrics[row.rubric_id]) {
        piece.rubric = rubricView(rubrics[row.rubric_id], null, tags);
      }
      if (grade) {
        var returned = when(row.returned_at);
        var changed = when(row.updated_at);
        var seen = when(row.seen_at);
        piece.updated = changed != null && !(seen != null && seen >= changed) && canon(row.previous) !== canon(grade);
        piece.unseen = !(seen != null && seen >= Math.max(returned || 0, changed || 0));
        piece.result = resultOf(cid, row, typeof cellOf === 'function' ? cellOf(piece.id) : null);
        piece.comment = str(grade.comment);
        piece.marks = marked[piece.id] || null;
        // The student's reflection on it (S10-F1): only on work that came back with a grade.
        piece.reflection = reflections[piece.id] || null;
        if (row.rubric_id && rubrics[row.rubric_id]) {
          piece.rubric = rubricView(rubrics[row.rubric_id], grade, tags);
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
      /* A revision asked for (S11-F2): Needs Revision while nothing is in,
         Sent again once the revision is in, and Back with Before and After
         once its grade is returned. Missing and Excused show their status. */
      var rev = hidden ? null : revisions[piece.id] || null;
      if (rev && (rev.state !== 'returned' || grade)) {
        piece.revision = revisionView(
          piece,
          rev,
          row,
          tags,
          row.rubric_id ? rubrics[row.rubric_id] : null,
          cid,
          cellOf,
        );
        if (rev.state === 'open') piece.kind = 'revise';
        else if (rev.state === 'sent') piece.kind = 'sent';
        var asked = when(rev.askedAt);
        var seenAt = when(row.seen_at);
        piece.reviseUnseen = rev.state === 'open' && asked != null && !(seenAt != null && seenAt >= asked);
      }
      work.push(piece);
    });
    work = inOrder(work);
    var plan = planFor(feedback, work);
    work.forEach(function (p) {
      if (plan && p.id === plan.pieceId) p.plan = { text: plan.text, fromTitle: plan.fromTitle };
    });
    var count = function (kind) {
      return work.filter(function (p) {
        return p.kind === kind;
      }).length;
    };
    var changes = work
      .filter(function (p) {
        return (p.kind === 'back' && p.result.kind !== 'none' && (p.updated || p.unseen)) || p.reviseUnseen;
      })
      .map(function (p) {
        return { id: p.id, title: p.title, why: p.reviseUnseen ? 'revise' : p.updated ? 'updated' : 'back' };
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
        // course.teacher_name is never read (Colin's ruling 112, "Leave the name off.").
      },
      // To Do holds work still to hand in, a revision asked for among it (S11-F2).
      counts: {
        toDo: count('due') + count('revise'),
        sent: count('sent'),
        back: count('back'),
        missing: count('missing'),
      },
      work: work,
      changes: changes,
      levels: levelsLegend(),
      questionnaires: questionnairesOf(page),
      reports: reportsOf(page),
      // My Learning: fromCache fills it when the class shows it. The
      // server's `page` sends nothing for it yet, so on the student's own
      // device it stays null and the tab says it is off.
      learning: null,
      // Reflect on Feedback (S10): on only when the class's switch is (the `feedback` reply says so).
      reflectOn: !!(
        feedback &&
        typeof feedback === 'object' &&
        feedback.ok === true &&
        feedback.reflect_on_feedback === true
      ),
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
    var bankTag = (sec.tags || []).find(function (t) {
      return !!(t && t.bank_id);
    });
    var bankId = bankTag ? str(bankTag.bank_id) : null;
    return {
      id: str(sec.id),
      name: str(sec.name || sec.shortName || sec.id),
      level: bandOf(value),
      text: has ? (letter ? formatLevel(cid, value) : levelWord(cid, value)) : '',
      code: has && !letter ? levelCode(value) : '',
      iCan: iCan,
      pieces: pieces,
      next: has ? nextStepOfSkill(cid, sid, sec.id, bankId) : null,
      value: has ? value : 0,
      bankId: bankId,
    };
  }

  /* A skill's Next Step (ruling 114): calc.js's nextStepLevel says which
     level's step applies, and the comment bank says it, word for word, as
     Generate reads a competency's bank entry (CommentBank.bankEntry, for
     the first of the skill's competencies from the BC bank). { top: true }
     at Extending ("You've Reached the Top Step"); { top: false, text }
     below it; null when nothing is returned on the skill, the bank has no
     step for it, or the comment bank is not on the page (the student's own
     device, until the server sends My Learning). */
  function nextStepOfSkill(cid, sid, sectionId, bankId) {
    if (typeof nextStepLevel !== 'function') return null;
    var n = nextStepLevel(cid, sid, sectionId);
    if (!n) return null;
    if (n.top) return { top: true, text: '' };
    var bank = typeof CommentBank !== 'undefined' && CommentBank && CommentBank.bankEntry;
    var e = bank && bankId ? CommentBank.bankEntry(bankId) : null;
    var text = e && e.steps ? sentence(e.steps[n.key]) : '';
    return text ? { top: false, text: text } : null;
  }

  // A bank step as a sentence: a capital first, a full stop last (as CompetencyWording writes one).
  function sentence(t) {
    var s = str(t).trim();
    if (!s) return '';
    s = s.charAt(0).toUpperCase() + s.slice(1);
    return /[.!?]$/.test(s) ? s : s + '.';
  }

  /* My Learning's Next Step: the skill the comment bank's Generate names
     (CommentBank.nextStepOf: the lowest with 2 or more returned pieces, not
     among the strongest), with its step. { id, name, text } or null. */
  function overallNextStep(groups) {
    if (typeof CommentBank === 'undefined' || !CommentBank || !CommentBank.nextStepOf) return null;
    var comps = [];
    groups.forEach(function (g) {
      g.skills.forEach(function (s) {
        if (s.value > 0) comps.push({ skill: s, id: s.id, level: s.value, scores: s.pieces, bankId: s.bankId });
      });
    });
    var c = CommentBank.nextStepOf(comps);
    var s = c && c.skill;
    return s && s.next && !s.next.top && s.next.text ? { id: s.id, name: s.name, text: s.next.text } : null;
  }

  /* How the grade has moved in a month (calc.js gradeMonthChange, returned
     work only, as of the class's today): { dir: 1 | -1, from } when the
     word or letter changed, else null (no board shows the same word). */
  function monthChange(cid, sid) {
    if (typeof gradeMonthChange !== 'function' || typeof courseToday !== 'function') return null;
    var m = gradeMonthChange(cid, sid, courseToday(cid));
    return m && m.dir ? { dir: m.dir, from: str(m.from) } : null;
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
     rank, no count of anyone else.
       trend: { dir: 1 | -1, from } | null, how the grade moved in a month;
       next: { id, name, text } | null, the Next Step My Learning names;
       skill.next: { top, text } | null, its own Next Step, or the Top Step. */
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
      var next = overallNextStep(groups);
      groups.forEach(function (g) {
        g.skills.forEach(function (s) {
          delete s.value;
          delete s.bankId;
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
        trend: monthChange(cid, sid),
        next: next,
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
     class shows it, or when opts.learning asks for it, else null. */
  /* Preview never tells the teacher what the student has opened
     (DECISIONS, "Student page build rulings (2026-11-10)" 10; Colin's
     ruling 116, "Take it out"). The cache holds when the student opened
     each returned piece (seen_at), and under As Soon As I Save a grade is
     marked Updated only if the student had opened it (rulings 9), so the
     mark would tell too. So Preview's copy of the reply has no seen_at,
     updated_at or previous on any piece: every returned piece is drawn as
     a student who has not opened it yet sees it (New, in What Changed),
     with no Updated mark. reply() itself stays the server's, field for
     field; the student's own page is not touched. */
  function unopened(page) {
    if (!page) return page;
    var copy = Object.assign({}, page);
    copy.assessments = (page.assessments || []).map(function (a) {
      return Object.assign({}, a, { updated_at: null, seen_at: null, previous: null });
    });
    return copy;
  }

  function fromCache(cid, sid, opts) {
    // opts.learning: work My Learning out as if the class showed it (Preview's See What They'd See,
    // S13-F1). Nothing is saved; the class's switch is not read or changed.
    var showLearning = !!(opts && opts.learning) || learningOn(cid);
    var page = unopened(reply(cid, sid));
    if (!page) return { ready: false };
    var feedback = feedbackReply(cid, sid, page);
    var view = withReturnedOnly(function () {
      var v = build(
        page,
        cid,
        function (aid, firstGrade) {
          // Before and After's first version (S11-F2): the data layer's own reading of it, for the student.
          if (firstGrade) {
            return typeof getRevisionFirstCell === 'function' ? getRevisionFirstCell(cid, sid, aid, true) : null;
          }
          var a = pieceOf(cid, aid);
          return a ? assessmentCellValue(cid, sid, a) : null;
        },
        null,
        feedback,
        // Group work from the cache (S12-T1's reader), counts only, as the student's page gets it.
        typeof getStudentGroupWork === 'function' ? getStudentGroupWork(cid, sid) : null,
      );
      v.learning = showLearning ? learning(cid, sid, v) : null;
      return v;
    });
    return { ready: true, reply: page, feedback: feedback, view: view };
  }

  /* Before and After's first version on the student's own device (S11-F2):
     calc.js's cell for one piece read with the first version's grade in
     place of the one returned, exactly as the rest of the page's results
     are worked out (s/student-data.js reads the reply; calc.js works the
     cell out). The page in use is put back at once, whatever happens, so
     every other result is as it was. Only on the page in use, and only for
     a piece that came back: nothing for anything else. */
  function firstCellOnPage(serverReply, p, aid, firstGrade) {
    if (typeof StudentData === 'undefined' || !StudentData || StudentData.page() !== p) return null;
    var cid = p.course.id;
    var sid = p.student.id;
    var swapped = Object.assign({}, serverReply, {
      assessments: list(serverReply && serverReply.assessments).map(function (row) {
        return row && row.id === aid && row.returned_at ? Object.assign({}, row, { grade: firstGrade }) : row;
      }),
    });
    var other = StudentData.fromServer(swapped);
    if (!other.grades[aid]) return null;
    var a = other.assessments.find(function (x) {
      return x.id === aid;
    });
    var clear = function () {
      if (typeof clearProfCache === 'function') clearProfCache();
    };
    try {
      StudentData.use(other);
      clear();
      return a ? assessmentCellValue(cid, sid, a) : null;
    } finally {
      StudentData.use(p);
      clear();
    }
  }

  /* The student page: the view of the server's reply, once
     s/student-data.js holds it (StudentData.use(StudentData.fromServer(
     reply))). Results come from calc.js on that page's own readers; with
     calc.js not loaded they are blank. */
  function fromPage(serverReply, studentPage, work, feedback, groups) {
    var p = studentPage;
    var cid = p && p.course ? p.course.id : '';
    var sid = p && p.student ? p.student.id : '';
    var ready = typeof assessmentCellValue === 'function';
    return build(
      serverReply,
      cid,
      function (aid, firstGrade) {
        if (!ready || !p) return null;
        if (firstGrade) return firstCellOnPage(serverReply, p, aid, firstGrade);
        var a = (p.assessments || []).find(function (x) {
          return x.id === aid;
        });
        return a ? assessmentCellValue(cid, sid, a) : null;
      },
      work,
      feedback,
      groups,
    );
  }

  return {
    ready: ready,
    reply: reply,
    build: build,
    fromCache: fromCache,
    fromPage: fromPage,
    feedbackReply: feedbackReply,
    learningOn: learningOn,
  };
})();
