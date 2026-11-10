/* grade-state.js — the Draft and Returned rule.
 *
 * Every grade is Draft or Returned
 * (docs/plans/student-page-build-plan.md, 1.2). The teacher's working copy
 * stays in the scores, as always. Beside it, one row per student per
 * assessment says what the student has been given. This file is the rule
 * that keeps that row, as plain functions: no DOM, no network, and nothing
 * read from the data layer but in afterSave, stateOf and draftsWaiting at
 * the bottom.
 *
 * The server keeps the same rule in database triggers. One file of worked
 * cases (tests/fixtures/grade-state-cases.json) runs through both, so the
 * two cannot drift.
 *
 * A COPY of a grade:
 *   { v: 1, value, modifier, comment,          the score row: points, a mark
 *                                              or the Overall level, its + or
 *                                              −, the Overall Comment
 *     tags:     { id: { value, modifier, comment } },           competencies
 *     criteria: { id: { value, modifier, comment, beyond } },   rubric rows
 *     checks:   [ id, … ] }                    ticked boxes, sorted
 * A blank comment is null. A row with no level and no note is left out. A
 * grade with nothing in it is null, never an empty copy. A status (Missing,
 * Excused, Late) and the Note for the Report are not in a copy, so neither
 * ever makes a draft.
 *
 * A ROW (the server's grade_return row, nulls left out):
 *   { is_draft, returned_at, returned_copy, previous_copy, updated_at,
 *     seen_at }
 *   is_draft       the working copy holds something the student has not
 *                  been given
 *   returned_at    when the grade was last returned
 *   returned_copy  the grade as last returned, kept only while a draft sits
 *                  on a returned grade
 *   previous_copy  the grade the student had before the newest return
 *   updated_at     when a returned grade last changed for the student
 *   seen_at        when the student last opened the piece
 * No row and no grade: nothing is returned and nothing waits. No row and a
 * grade: the grade was there before the rule was kept, so it is Returned
 * (existing scores become Returned).
 *
 * A CLASS: { student_page, return_grades }. It holds grades when the student
 * page is on and Return Grades is When I Return Them ('on_return'). Any
 * other class returns every save at once. A class that stops holding grades
 * (As Soon As I Save is chosen, or the student page is turned off) returns
 * every waiting draft as part of that change (afterSettingChange).
 *
 * WHAT A STUDENT IS GIVEN is read from the row and the working copy, never
 * stored (studentCopy, and returnedScores for grade math):
 * - A draft is never in it. While a draft sits on a returned grade it is
 *   the returned copy; with nothing waiting, the working copy.
 * - Only the part the work is scored by now (partInUse). A stored copy is
 *   complete: it may hold a level on a rubric the work no longer uses, or a
 *   competency since deleted. Those drop off at once, with no Return.
 * - Missing and Excused win at once (Colin, 2026-11-09). While a piece is
 *   Missing or Excused the student is given no grade, even one returned
 *   before. Take the mark off before any Return and the returned grade is
 *   back. Late is only a label and hides nothing. The row itself does not
 *   change: a draft under Missing is still a draft there, though a screen
 *   shows the status, not Draft (stateOf). In grade math the same holds
 *   for every set of scores, and calc.js is where: a Missing or Excused
 *   piece counts no level, whatever entries a set holds for it.
 *
 * shared/data.js applies afterWrite on every score write and afterReturn on
 * Return, and keeps the rows beside the scores. What lands here later: the
 * other states a piece can be in (Not In, To Grade, Revising).
 */
window.GradeState = (function () {
  'use strict';

  var DRAFT = 'draft';
  var RETURNED = 'returned';
  var NONE = 'none';

  /* ── A copy of a grade ─────────────────────────────────────── */

  function _text(v) {
    var s = v == null ? '' : String(v).trim();
    return s || null;
  }
  function _number(v) {
    return v == null || v === '' || !isFinite(Number(v)) ? null : Number(v);
  }
  // One competency's or criterion's part of a copy, or null with nothing in
  // it. A level of 0 is no level.
  function _part(row, criterion) {
    row = row || {};
    var value = _number(row.value) || null;
    var out = {
      value: value,
      modifier: value == null ? 0 : Number(row.modifier) || 0,
      comment: _text(row.comment),
    };
    if (criterion) out.beyond = _text(row.beyond);
    return out.value == null && !out.comment && !out.beyond ? null : out;
  }
  function _parts(rows, criterion) {
    var out = {};
    Object.keys(rows || {})
      .sort()
      .forEach(function (id) {
        var part = _part(rows[id], criterion);
        if (part) out[id] = part;
      });
    return out;
  }

  /* A copy in its one written form: keys in order, blanks as null, empty
     rows left out. null when nothing is in it. On the score row a 0 is a
     score (0 points, Incomplete), so `value` keeps it. */
  function copyOf(grade) {
    if (!grade) return null;
    var value = _number(grade.value);
    var copy = {
      v: 1,
      value: value,
      modifier: value == null ? 0 : Number(grade.modifier) || 0,
      comment: _text(grade.comment),
      tags: _parts(grade.tags, false),
      criteria: _parts(grade.criteria, true),
      checks: (grade.checks || [])
        .map(String)
        .filter(function (id, i, all) {
          return all.indexOf(id) === i;
        })
        .sort(),
    };
    var empty =
      copy.value == null &&
      !copy.comment &&
      !Object.keys(copy.tags).length &&
      !Object.keys(copy.criteria).length &&
      !copy.checks.length;
    return empty ? null : copy;
  }

  // Two copies are the same grade when they hold the same things, keys in
  // any order, 7 the same as 7.0.
  function sameCopy(a, b) {
    return JSON.stringify(copyOf(a)) === JSON.stringify(copyOf(b));
  }

  /* ── The row ───────────────────────────────────────────────── */

  // True when the class holds grades until the teacher returns them.
  function holds(klass) {
    return !!klass && klass.student_page === true && klass.return_grades === 'on_return';
  }

  var _FIELDS = ['returned_at', 'returned_copy', 'previous_copy', 'updated_at', 'seen_at'];

  // The row as it is kept: nulls left out, and no row at all when it says
  // nothing.
  function _kept(row) {
    var out = { is_draft: !!row.is_draft };
    _FIELDS.forEach(function (f) {
      if (row[f] != null) out[f] = row[f];
    });
    return out.is_draft || Object.keys(out).length > 1 ? out : null;
  }
  function _time(iso) {
    var t = Date.parse(iso);
    return isNaN(t) ? 0 : t;
  }

  /* One cell's working copy went from `before` to `after` in a class with
     these settings, at `now` (an ISO time). Returns the row to keep, or
     null for none. A save that changes nothing changes nothing: the same
     save twice, a 0 where there was no level, a status, a Note for the
     Report. */
  function afterWrite(klass, row, before, after, now) {
    before = copyOf(before);
    after = copyOf(after);
    if (sameCopy(before, after)) return row || null;
    var g = row ? Object.assign({}, row) : null;

    if (holds(klass)) {
      // When I Return Them: the change waits as a draft.
      if (!g) {
        // A grade with no row was returned before the rule was kept: the
        // student keeps it. With no grade before, they are given nothing.
        g = { is_draft: true };
        if (before) g.returned_copy = before;
        else if (!after) return null;
      } else if (!g.is_draft) {
        if (g.returned_at && before) {
          g.is_draft = true;
          g.returned_copy = before;
        } else {
          g.is_draft = !!after;
          g.returned_at = g.previous_copy = g.updated_at = null;
        }
      } else if (g.returned_copy) {
        // Put back to what was returned (by hand, or Undo): not a draft.
        if (sameCopy(after, g.returned_copy)) {
          g.is_draft = false;
          g.returned_copy = null;
        }
      } else if (!after) {
        // A draft never returned, cleared: nothing is left.
        g.is_draft = false;
      }
      return _kept(g);
    }

    // Any other class: the save is returned at once.
    if (!g) return after ? { is_draft: false, returned_at: now } : null;
    if (!after) {
      g.is_draft = false;
      g.returned_at = g.returned_copy = g.previous_copy = g.updated_at = null;
    } else if (g.is_draft) {
      // A draft left from When I Return Them: this save returns it.
      if (g.returned_copy && !sameCopy(g.returned_copy, after)) {
        g.previous_copy = g.returned_copy;
        g.updated_at = now;
      }
      g.is_draft = false;
      g.returned_at = now;
      g.returned_copy = null;
    } else if (!g.returned_at) {
      g.returned_at = now;
    } else if (g.seen_at && _time(g.seen_at) >= _time(g.returned_at) && before) {
      // The student had seen it: it is marked Updated, with what it was.
      g.returned_at = now;
      g.previous_copy = before;
      g.updated_at = now;
    } else if (g.previous_copy && sameCopy(g.previous_copy, after)) {
      // Changed and put back before they looked again.
      g.returned_at = now;
      g.previous_copy = g.updated_at = null;
    } else {
      g.returned_at = now;
      if (g.previous_copy) g.updated_at = now;
    }
    return _kept(g);
  }

  /* The teacher returns the grade, whose working copy is `working`. Only a
     draft is returned. The copy the student had moves to previous_copy. A
     draft with nothing left (a returned grade, cleared) returns as no
     grade. */
  function afterReturn(row, working, now) {
    if (!row || !row.is_draft) return row || null;
    var g = Object.assign({}, row);
    g.is_draft = false;
    if (!copyOf(working)) {
      g.returned_at = g.returned_copy = g.previous_copy = g.updated_at = null;
    } else {
      g.returned_at = now;
      if (g.returned_copy) {
        g.previous_copy = g.returned_copy;
        g.updated_at = now;
      }
      g.returned_copy = null;
    }
    return _kept(g);
  }

  // The student opened the piece.
  function afterSeen(row, now) {
    return _kept(Object.assign({}, row, { seen_at: now }));
  }

  /* The class's settings went from `was` to `now`. A class that stops
     holding grades returns every waiting draft as part of the change, so
     nothing is left waiting where nothing can be returned. `rows` is
     { assessmentId: { studentId: row } }; `workingOf(sid, aid)` gives a
     cell's working copy. Returns the rows to keep: the same object when
     nothing changed. */
  function afterSettingChange(was, now, rows, workingOf, at) {
    if (!holds(was) || holds(now)) return rows;
    var out = rows;
    Object.keys(rows || {}).forEach(function (aid) {
      Object.keys(rows[aid] || {}).forEach(function (sid) {
        var row = rows[aid][sid];
        if (!row || !row.is_draft) return;
        if (out === rows) out = Object.assign({}, rows);
        if (out[aid] === rows[aid]) out[aid] = Object.assign({}, rows[aid]);
        var kept = afterReturn(row, workingOf(sid, aid), at);
        if (kept) out[aid][sid] = kept;
        else delete out[aid][sid];
        if (!Object.keys(out[aid]).length) delete out[aid];
      });
    });
    return out;
  }

  /* Edit a Copy: the work moved to a copy of its rubric, whose criteria
     and checkboxes have new ids (`criteria` and `checks`, old id to new).
     The grade keeps its state; the ids inside the copies the row keeps
     follow. Also how a re-keyed id reaches a kept copy (`tags`). Returns
     the same row when it holds none of the ids. */
  function afterMove(row, criteria, checks, tags) {
    if (!row) return row || null;
    var out = row;
    ['returned_copy', 'previous_copy'].forEach(function (field) {
      var moved = _movedCopy(row[field], criteria, checks, tags);
      if (moved === row[field]) return;
      if (out === row) out = Object.assign({}, row);
      out[field] = moved;
    });
    return out;
  }
  // A copy with its ids re-pointed; the same object when none is in it.
  function _movedCopy(copy, criteria, checks, tags) {
    if (!copy) return copy;
    var changed = false;
    var renamed = function (rows, map) {
      var next = {};
      Object.keys(rows || {}).forEach(function (id) {
        var to = map && map[id] !== undefined ? map[id] : id;
        if (to !== id) changed = true;
        next[to] = rows[id];
      });
      return next;
    };
    var next = Object.assign({}, copy, {
      tags: renamed(copy.tags, tags),
      criteria: renamed(copy.criteria, criteria),
      checks: (copy.checks || []).map(function (id) {
        var to = checks && checks[id] !== undefined ? checks[id] : id;
        if (to !== id) changed = true;
        return to;
      }),
    });
    return changed ? copyOf(next) : copy;
  }

  /* 'draft', 'returned' or 'none', from the row and the working copy. */
  function stateOfRow(row, working) {
    if (row && row.is_draft) return DRAFT;
    if (row && row.returned_at) return RETURNED;
    // No row: a grade that is here was here before the rule was kept.
    return !row && copyOf(working) ? RETURNED : NONE;
  }

  /* The part of a copy the work is scored by now. `scoring` is
     { kind, tags, criteria, checks }:
       'rubric'        the levels and ticks of the rubric's own criteria
                       and checkboxes (`criteria`, `checks`: their ids)
       'points'        the score (also Complete/Incomplete); a 0 is a score
       'competencies'  the levels of the linked competencies still on the
                       class (`tags`: their ids). A grade that holds no
                       competency or criterion row at all, only an Overall
                       level, gives that level: the app shows it under the
                       first competency (the loader's fallbackTag rule)
       'overall'       the one Overall level; a 0 is none
     The Overall Comment is always in it. null with nothing left; the whole
     copy when no scoring is given. */
  function partInUse(copy, scoring) {
    copy = copyOf(copy);
    if (!copy || !scoring) return copy;
    var kind = scoring.kind;
    var only = function (rows, ids) {
      var out = {};
      (ids || []).forEach(function (id) {
        if (rows[id]) out[id] = rows[id];
      });
      return out;
    };
    // An Overall level counts on work scored as a whole, and on competency
    // work whose grade holds nothing else.
    var bare = !Object.keys(copy.tags).length && !Object.keys(copy.criteria).length;
    var level = kind === 'overall' || (kind === 'competencies' && bare);
    return copyOf({
      value: kind === 'points' ? copy.value : level ? copy.value || null : null,
      modifier: copy.modifier,
      comment: copy.comment,
      tags: kind === 'competencies' ? only(copy.tags, scoring.tags) : {},
      criteria: kind === 'rubric' ? only(copy.criteria, scoring.criteria) : {},
      checks:
        kind === 'rubric'
          ? copy.checks.filter(function (id) {
              return (scoring.checks || []).indexOf(id) >= 0;
            })
          : [],
    });
  }

  // Missing and Excused: the student is given no grade while either is on.
  function _hidesGrade(status) {
    return status === 'NS' || status === 'EXC';
  }

  /* The grade the student is given: nothing when it was never returned or
     the piece is Missing or Excused; the returned copy while a draft sits
     on a returned grade; the working copy otherwise. Only the part the
     work is scored by now (`scoring`, see partInUse). A draft is never in
     it. */
  function studentCopy(row, working, status, scoring) {
    if (_hidesGrade(status)) return null;
    if (row && row.is_draft) return partInUse(row.returned_copy, scoring);
    return stateOfRow(row, working) === RETURNED ? partInUse(working, scoring) : null;
  }

  /* The grade the student had before the newest return, read the same way,
     or null. */
  function studentPrevious(row, status, scoring) {
    if (_hidesGrade(status) || !row) return null;
    return partInUse(row.previous_copy, scoring);
  }

  /* ── The returned set of scores ────────────────────────────────
     What grade math reads in returned-only mode (plan 1.3), in the shape of
     the working scores, { studentId: [entry] }:
     - the working entries where nothing is a draft;
     - the returned grade where a draft sits on a returned grade;
     - nothing where a grade was never returned.
     That is all it decides. calc.js reads both sets by the same rules:
     what a piece measures now, a Missing or Excused piece counting no
     level, and same-date pieces in the class's assignment-list order,
     whatever order the entries sit in. So a returned grade goes where its
     working entries are, or at the end when it has none left.

     The set is a plain object with a list for every student in the working
     copy or the rows: an empty list when nothing of theirs is returned.

     `rows` is { assessmentId: { studentId: row } }. `entriesOf(sid, aid,
     copy, own)` turns a returned copy into score entries; `own` is the
     student's working entries for that assessment. */
  function returnedScores(working, rows, entriesOf) {
    working = working || {};
    rows = rows || {};
    var rowOf = function (sid, aid) {
      return (rows[aid] || {})[sid] || null;
    };
    var sids = Object.keys(working);
    Object.keys(rows).forEach(function (aid) {
      Object.keys(rows[aid] || {}).forEach(function (sid) {
        if (sids.indexOf(sid) < 0) sids.push(sid);
      });
    });
    var out = {};
    sids.forEach(function (sid) {
      var own = Array.isArray(working[sid]) ? working[sid] : [];
      var list = [];
      var placed = {};
      var place = function (aid) {
        if (placed[aid]) return;
        placed[aid] = true;
        var copy = rowOf(sid, aid).returned_copy;
        if (!copy) return;
        var mine = own.filter(function (e) {
          return e && e.assessmentId === aid;
        });
        entriesOf(sid, aid, copy, mine).forEach(function (e) {
          list.push(e);
        });
      };
      own.forEach(function (entry) {
        var row = entry ? rowOf(sid, entry.assessmentId) : null;
        if (row && row.is_draft) place(entry.assessmentId);
        else list.push(entry);
      });
      // A returned grade cleared since has no working entry; it still counts.
      Object.keys(rows).forEach(function (aid) {
        var row = rowOf(sid, aid);
        if (row && row.is_draft) place(aid);
      });
      out[sid] = list;
    });
    return out;
  }

  /* ── For the screens ───────────────────────────────────────── */

  /* The state `sid`'s piece of work on `aid` is in: 'draft', 'returned', or
     null while it has no grade returned and none waiting. This is what a
     screen shows: a status alone is not a grade, and a Missing or Excused
     piece shows its status, never Draft. A piece with nothing waiting is
     Returned once it has a score or feedback: every save that is not held
     is returned at once. */
  function stateOf(cid, sid, aid) {
    var row = typeof getGradeReturn === 'function' ? getGradeReturn(cid, sid, aid) : null;
    if (row && row.is_draft) return _hidesGrade(getAssignmentStatus(cid, sid, aid)) ? null : DRAFT;
    // A tick is part of a grade: work with only ticks left has one.
    return hasScoreOrFeedback(cid, sid, aid) || getRubricCheckIds(cid, sid, aid).length ? RETURNED : null;
  }

  /* A grade was saved for student `sid` on assessment `aid`; `what` names
     the kind of save ('level', 'points', 'status' …). shared/data.js has
     applied the rule by now; this answers with the state the piece is in.
     Where every save is returned at once, that is Returned. */
  function afterSave(cid, sid, aid, what) {
    var klass = typeof getReturnSettings === 'function' ? getReturnSettings(cid) : null;
    if (!sid || !aid || !klass || !klass.student_page) return RETURNED;
    return stateOf(cid, sid, aid);
  }

  /* How many grades in the class wait as drafts: every cell a screen shows
     as Draft (stateOf), counted from the class's rows. A draft under Missing
     or Excused shows its status and is not counted. Nor is a row whose
     student or assessment is no longer in the class: it is on no screen. */
  function draftsWaiting(cid) {
    var rows = typeof getGradeReturns === 'function' ? getGradeReturns(cid) : null;
    if (!rows) return 0;
    var ids = function (list) {
      var out = {};
      (list || []).forEach(function (x) {
        if (x && x.id) out[x.id] = true;
      });
      return out;
    };
    var students = ids(getStudents(cid));
    var assessments = ids(getAssessments(cid));
    var n = 0;
    Object.keys(rows).forEach(function (aid) {
      if (!assessments[aid]) return;
      Object.keys(rows[aid] || {}).forEach(function (sid) {
        if (students[sid] && stateOf(cid, sid, aid) === DRAFT) n++;
      });
    });
    return n;
  }

  return {
    DRAFT: DRAFT,
    RETURNED: RETURNED,
    NONE: NONE,
    copyOf: copyOf,
    sameCopy: sameCopy,
    holds: holds,
    afterWrite: afterWrite,
    afterReturn: afterReturn,
    afterSeen: afterSeen,
    afterSettingChange: afterSettingChange,
    afterMove: afterMove,
    partInUse: partInUse,
    studentPrevious: studentPrevious,
    stateOfRow: stateOfRow,
    studentCopy: studentCopy,
    returnedScores: returnedScores,
    afterSave: afterSave,
    stateOf: stateOf,
    draftsWaiting: draftsWaiting,
  };
})();
