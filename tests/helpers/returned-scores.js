/**
 * A reference builder of the returned set of scores (student page build
 * plan 1.2 and 1.3): what `getReturnedScores(cid)` must give shared/calc.js
 * when a grade is worked out inside `withReturnedOnly`.
 *
 * The rule, for each student and piece of work, from its grade_return row:
 * - not a draft (or no row): the working copy, as it is;
 * - a draft on a grade that was returned (the row holds returned_copy): the
 *   grade as it was returned;
 * - a draft never returned: nothing.
 * Statuses are not here. Missing, Excused and Late are never drafts.
 * Missing wins at once (Colin, 2026-11-09): while a piece is Missing, a
 * returned grade under a draft is left out, so its old level stops counting
 * everywhere without a Return.
 *
 * The app's own builder (shared/data.js, S0-F2) is held to the same tests,
 * so this one stays small. Rows are in the shape list_course_grade_returns
 * gives: { [assessmentId]: { [studentId]: { is_draft, returned_at,
 * returned_copy } } }. A copy is the shape the server keeps (Batch A):
 * { v, value, modifier, comment, tags: { id: { value, modifier, comment } },
 *   criteria: { id: { value, modifier, comment, beyond } }, checks: [] }.
 */

/* A returned copy as the score entries the app's cache would hold for it:
   read the way the loader reads the same grade from the server. */
export function entriesFromCopy(cid, sid, aid, copy) {
  const cell = {
    score: { value: copy.value, modifier: copy.modifier, comment: copy.comment },
    tag_scores: Object.keys(copy.tags || {}).map(id => Object.assign({ tag_id: id }, copy.tags[id])),
    rubric_scores: Object.keys(copy.criteria || {}).map(id => Object.assign({ criterion_id: id }, copy.criteria[id])),
  };
  const built = _gradebookCellsToScoreCache(cid, getAssessments(cid), { [sid]: { [aid]: cell } });
  return built.scores[sid] || [];
}

/** The returned set: { [studentId]: [entry] }, the shape of getScores. */
export function returnedScores(cid, working, gradeReturns) {
  const rows = gradeReturns || {};
  const rowOf = (sid, aid) => (rows[aid] || {})[sid] || null;
  const sids = new Set(Object.keys(working || {}));
  Object.keys(rows).forEach(aid => Object.keys(rows[aid]).forEach(sid => sids.add(sid)));
  const out = {};
  sids.forEach(sid => {
    const list = [];
    const placed = {};
    const place = aid => {
      if (placed[aid]) return;
      placed[aid] = true;
      const copy = rowOf(sid, aid).returned_copy;
      // Never returned: nothing. Returned before: the grade as it was returned,
      // unless the piece is Missing now.
      if (copy && getAssignmentStatus(cid, sid, aid) !== 'NS')
        entriesFromCopy(cid, sid, aid, copy).forEach(e => list.push(e));
    };
    ((working || {})[sid] || []).forEach(entry => {
      const row = entry ? rowOf(sid, entry.assessmentId) : null;
      if (row && row.is_draft) place(entry.assessmentId);
      // Nothing is a draft: the working copy.
      else list.push(entry);
    });
    // A returned grade cleared since has no working entry; it still counts.
    Object.keys(rows).forEach(aid => {
      const row = rowOf(sid, aid);
      if (row && row.is_draft) place(aid);
    });
    out[sid] = list;
  });
  return out;
}

/* Makes `getReturnedScores` the builder above for these tests, reading the
   working copy from the data layer and each class's rows from `rowsByClass`
   ({ [cid]: rows }, read again on every call, so a test can change them).
   `steady: true` is for a test that changes no score in place: the set is
   built once for each working copy and rows object, as the app's builder
   must be (calc.js asks for it many times for one grade).
   Returns { calls(), remove() }. */
export function installReturnedScores(rowsByClass, opts) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'getReturnedScores');
  const was = globalThis.getReturnedScores;
  const steady = !!(opts && opts.steady);
  let calls = 0;
  let kept = null;
  globalThis.getReturnedScores = cid => {
    calls++;
    const working = getScores(cid);
    const rows = rowsByClass[cid];
    if (!steady) return returnedScores(cid, working, rows);
    if (!kept || kept.cid !== cid || kept.working !== working || kept.rows !== rows) {
      kept = { cid, working, rows, set: returnedScores(cid, working, rows) };
    }
    return kept.set;
  };
  return {
    calls: () => calls,
    remove() {
      if (had) globalThis.getReturnedScores = was;
      else delete globalThis.getReturnedScores;
    },
  };
}

/* ── For writing a test's rows ───────────────────────────────── */

/* One student's working grade on one piece as a copy: what the server would
   keep as returned_copy if the grade were returned now. null with nothing
   there. (Points work with more than one competency keeps one score, so a
   copy of it does not read back as the Demo seed's several entries.) */
export function copyOfGrade(cid, sid, aid) {
  const assessment = getAssessments(cid).find(a => a.id === aid);
  const own = (getScores(cid)[sid] || []).filter(e => e && e.assessmentId === aid);
  if (!assessment || !own.length) return null;
  const noted = own.find(e => e.note);
  const copy = {
    v: 1,
    value: null,
    modifier: 0,
    comment: noted ? String(noted.note) : null,
    tags: {},
    criteria: {},
    checks: [],
  };
  const onRubric = !isPointsScored(assessment) && !!(assessment.rubricId || assessment.rubric_id);
  own.forEach(e => {
    const level = { value: e.score > 0 ? e.score : null, modifier: e.score > 0 ? e.mod || 0 : 0 };
    if (isPointsScored(assessment) || isUnlinkedTag(e.tagId)) {
      copy.value = e.score == null || e.score === '' ? null : Number(e.score);
      copy.modifier = isPointsScored(assessment) ? 0 : level.modifier;
    } else if (onRubric) {
      copy.criteria[e.tagId] = Object.assign(level, { comment: e.critNote || null, beyond: e.critBeyond || null });
    } else {
      copy.tags[e.tagId] = Object.assign(level, { comment: e.critNote || null });
    }
  });
  return copy;
}

// A row for a grade changed since it was returned: the copy is what was returned.
export function draftOnReturned(copy) {
  return { is_draft: true, returned_at: '2026-11-03T17:00:00Z', returned_copy: copy };
}

// A row for a grade never returned.
export function draftNeverReturned() {
  return { is_draft: true, returned_at: null, returned_copy: null };
}

// A row for a grade returned with nothing waiting, as the backfill makes for every grade today.
export function returnedRow() {
  return { is_draft: false, returned_at: '2026-11-03T17:00:00Z', returned_copy: null };
}

/* Rows for a class where every grade is returned and none is a draft: one
   returned row for every student and piece that has a score entry. */
export function everyGradeReturned(cid) {
  const rows = {};
  const working = getScores(cid);
  Object.keys(working).forEach(sid =>
    (working[sid] || []).forEach(e => {
      if (!e) return;
      rows[e.assessmentId] = rows[e.assessmentId] || {};
      rows[e.assessmentId][sid] = returnedRow();
    }),
  );
  return rows;
}
