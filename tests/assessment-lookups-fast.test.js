/**
 * A piece of work by its id, and the rubric-key check behind every getScores,
 * answer from what they kept unless the class's list of work changed.
 *
 * What was slow (docs/plans/speed-assessment.md, finding 4): getScores is
 * asked for each cell of a draw, and each ask built a string from every piece
 * of the class (_rubricKeySig) to see whether marks needed moving to a
 * rubric's criteria: 44 to 88 ms a draw on a slow machine. _assessmentById,
 * asked per cell too, looked through the whole list each time. Both now keep
 * what they found with the list (shared/data-assessments.js) and check it on
 * every ask, because the list and its pieces are changed in place.
 *
 * This file holds the old way beside the new over a whole class, and each
 * kind of in-place change, so no stale answer is given.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const RUBRIC = U(60);
const CRIT = [U(61), U(62)];
const TAGS = [U(41), U(42)];
const IDS = Array.from({ length: 4 }, (_, i) => U(100 + i));
const AIDS = Array.from({ length: 36 }, (_, i) => U(300 + i));
const GB_ONLY = U(398); // a piece only the class load's row holds
const NONE = U(399);

function seed() {
  seedClass(CID, {
    students: IDS.map((id, i) => ({ id, firstName: 'F' + i, lastName: 'L' + i })),
    rubrics: [
      {
        id: RUBRIC,
        name: 'Thinking',
        criteria: [
          { id: CRIT[0], name: 'A', tagIds: [TAGS[0]], levels: {}, checks: [] },
          { id: CRIT[1], name: 'B', tagIds: [TAGS[1]], levels: {}, checks: [] },
        ],
      },
    ],
    assessments: AIDS.map((id, i) => ({
      id,
      title: 'Piece ' + i,
      tagIds: TAGS,
      rubricId: i % 2 === 0 ? RUBRIC : '',
      scoreMode: i % 6 === 4 ? 'points' : undefined,
    })),
  });
  _cache.v2Gradebook = { [CID]: { assessments: [{ id: GB_ONLY, title: 'From the load' }] } };
}

// The old ways, as shared/data.js had them.
function oldById(aid) {
  const mine = (getAssessments(CID) || []).find(a => a && a.id === aid);
  if (mine) return mine;
  const gb = _cache.v2Gradebook && _cache.v2Gradebook[CID];
  return (gb && (gb.assessments || []).find(a => a && a.id === aid)) || null;
}
function oldSig() {
  let sig = String(_rubricsRev[CID] || 0);
  (getAssessments(CID) || []).forEach(a => {
    const rubricId = a && (a.rubricId || a.rubric_id);
    if (rubricId && !isPointsScored(a)) sig += '|' + a.id + '=' + rubricId;
  });
  return sig;
}
// The same piece, not a copy; with no list held, each ask reads its own copy from storage.
function same(copies) {
  AIDS.concat([GB_ONLY, NONE, undefined, '']).forEach(aid =>
    copies
      ? expect(_assessmentById(CID, aid)).toEqual(oldById(aid))
      : expect(_assessmentById(CID, aid)).toBe(oldById(aid)),
  );
  expect(_rubricKeySig(CID)).toBe(oldSig());
}

let wasGb;
beforeEach(() => {
  wasGb = _cache.v2Gradebook;
  localStorage.clear();
  seed();
});
afterEach(() => {
  clearClass(CID);
  _cache.v2Gradebook = wasGb;
  localStorage.clear();
});

describe('a piece by id, and the rubric key', () => {
  it('are what the old way gave, for every piece, asked again and again', () => {
    same();
    same();
    expect(_assessmentById(CID, AIDS[3]).title).toBe('Piece 3');
    expect(_assessmentById(CID, GB_ONLY).title).toBe('From the load');
    expect(_assessmentById(CID, NONE)).toBeNull();
  });

  it('follow every in-place change at once', () => {
    const list = getAssessments(CID);
    same();
    // A piece added, as the New Assessment form pushes it.
    list.push({ id: U(350), title: 'New', rubricId: RUBRIC });
    same();
    // A piece replaced where it stands, by one with another id.
    list[5] = { id: U(351), title: 'Swapped in', rubricId: RUBRIC };
    same();
    // One taken out of the middle: every later piece moves up.
    list.splice(2, 1);
    same();
    // Order changed, length the same.
    list.reverse();
    same();
    // A rubric given, changed and taken off in place, as the edit form writes it back.
    list[0].rubricId = '';
    same();
    list[1].rubricId = RUBRIC;
    same();
    list[1].rubric_id = U(70);
    list[1].rubricId = '';
    same();
    // Scoring switched in place, both spellings.
    list[3].scoreMode = 'points';
    same();
    list[3].scoreMode = undefined;
    list[3].score_mode = 'complete';
    same();
    // A hole and an empty slot.
    list[4] = null;
    same();
  });

  it('follow a re-key of a piece, and the rubrics being set', () => {
    same();
    const local = 'c' + Date.now().toString(36);
    getAssessments(CID)[7].id = local;
    _assessmentsRekeyed++; // as a hand edit of an id would need; the re-key below counts for itself
    same();
    _rekeyField('assessments', CID, rows => _rekeyRowId(rows, local, U(352)));
    same();
    expect(_assessmentById(CID, U(352)).title).toBe('Piece 7');
    expect(_assessmentById(CID, local)).toBeNull();
    saveRubrics(CID, getRubrics(CID).slice());
    same();
    // A whole new list, as a load or another tab gives.
    _cache.assessments[CID] = structuredClone(getAssessments(CID)).slice(0, 10);
    same();
    // No list held: each ask reads this device's copy, as before.
    delete _cache.assessments[CID];
    same(true);
  });

  it('a rubric given to work in place moves its marks on the next read', () => {
    const aid = AIDS[1];
    const sid = IDS[0];
    _cache.scores[CID] = {
      [sid]: [{ id: 'e1', assessmentId: aid, tagId: TAGS[0], score: 3, type: 'summative', date: '2026-10-02' }],
    };
    expect(getScores(CID)[sid].map(e => e.tagId)).toEqual([TAGS[0]]);
    getAssessments(CID).find(a => a.id === aid).rubricId = RUBRIC;
    expect(getScores(CID)[sid].map(e => e.tagId)).toEqual([CRIT[0]]);
  });
});
