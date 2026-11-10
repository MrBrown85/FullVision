/* grade-state.js — the Draft and Returned rule.
 *
 * Every grade is Draft or Returned
 * (docs/plans/student-page-build-plan.md, 1.2). The teacher's working copy
 * stays in the scores, as always. Beside it, one row per student per
 * assessment says what the student has been given. This file is the rule
 * that keeps that row, as plain functions: no DOM, no network, and nothing
 * read from the data layer but in afterSave and stateOf at the bottom.
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
 * other class returns every save at once.
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

  /* 'draft', 'returned' or 'none', from the row and the working copy. */
  function stateOfRow(row, working) {
    if (row && row.is_draft) return DRAFT;
    if (row && row.returned_at) return RETURNED;
    // No row: a grade that is here was here before the rule was kept.
    return !row && copyOf(working) ? RETURNED : NONE;
  }

  /* The grade the student is given: nothing when it was never returned, the
     returned copy while a draft sits on a returned grade, the working copy
     otherwise. A draft is never in it. */
  function studentCopy(row, working) {
    if (row && row.is_draft) return row.returned_copy ? copyOf(row.returned_copy) : null;
    return stateOfRow(row, working) === RETURNED ? copyOf(working) : null;
  }

  /* ── The returned set of scores ────────────────────────────────
     What grade math reads in returned-only mode (plan 1.3), in the shape of
     the working scores, { studentId: [entry] }: the working entries where
     nothing is a draft, the returned copy where a draft sits on a returned
     grade, nothing where a grade was never returned.
     `rows` is { assessmentId: { studentId: row } }. `entriesOf(sid, aid,
     copy, own)` turns a copy into score entries; `own` is the student's
     working entries for that assessment. */
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
      var own = working[sid] || [];
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
     null while it has no grade returned and none waiting. A status alone is
     not a grade. In a class that keeps no rows (the student page is off),
     a piece is Returned once it has a score or feedback. */
  function stateOf(cid, sid, aid) {
    var row = typeof getGradeReturn === 'function' ? getGradeReturn(cid, sid, aid) : null;
    if (row && row.is_draft) return DRAFT;
    if (row && row.returned_at) return RETURNED;
    return !row && hasScoreOrFeedback(cid, sid, aid) ? RETURNED : null;
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
    stateOfRow: stateOfRow,
    studentCopy: studentCopy,
    returnedScores: returnedScores,
    afterSave: afterSave,
    stateOf: stateOf,
  };
})();
