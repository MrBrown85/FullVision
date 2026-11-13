/**
 * Signed in, the score writers read a piece of work as this page holds it
 * (getAssessments), not as the class load sent it (_cache.v2Gradebook). The
 * load's row has no `collaboration`, `groups` or `gradedSeparately` (it has
 * collab_mode and collab_config), and it keeps whatever the piece was when
 * the class loaded. So, signed in:
 *  - grading one member of a group filled nobody else (Demo Mode fills
 *    every member);
 *  - a competency added since the load was sent as the piece's overall
 *    score (upsert_score), and lost on reload;
 *  - a piece switched from points to proficiency sent each competency as
 *    upsert_score, the last one winning;
 *  - a points piece given a rubric sent its criteria as upsert_score.
 * And the page's own row kept the load's snake_case copies (score_mode,
 * max_points, tag_ids, due_date) after an edit, which isPointsScored and the
 * due-date readers fall back to. Every save now makes them agree.
 *
 * The class is built by the real load path (_v2GradebookToCache) from rows
 * shaped as get_class_bundle sends them, with server-shaped ids.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, signIn, seedClass, clearClass, stored, settle } from './helpers/pin-save-paths.js';

const CID = U(801);
const S = [U(811), U(812), U(813), U(814), U(815)];
const NAMES = ['Ann', 'Ben', 'Cal', 'Dee', 'Eve'];
const T1 = U(821);
const T2 = U(822);
const RUBRIC = U(871);
const CRIT = U(872);
const GROUP = U(831); // groups: Ann, Ben, Cal together; Dee alone
const NULL_CONFIG = U(832); // collab_mode groups, no groups ever saved (Karen's piece)
const EMPTY_GROUPS = U(833); // collab_mode groups, an empty list
const ADD = U(834); // T1, gains T2
const POINTS = U(835); // points out of 10, becomes proficiency
const POINTS_RUBRIC = U(836); // points out of 10, given the rubric
const PLAIN = U(837); // never edited, not group work
const PLAIN_POINTS = U(838); // never edited, points
const DUO = U(839); // groups: Dee and Eve, on two competencies

const row = (id, title, extra) =>
  Object.assign(
    {
      id,
      title,
      description: '',
      assessment_kind: 'summative',
      category_id: null,
      score_mode: 'proficiency',
      max_points: null,
      weight: 1,
      evidence_type: null,
      rubric_id: null,
      module_id: null,
      core_competency_ids: [],
      collab_mode: 'none',
      collab_config: null,
      has_rubric: false,
      date_assigned: '2026-10-01',
      due_date: null,
      display_order: 0,
      tag_ids: [T1],
    },
    extra,
  );

function load() {
  seedClass(CID, {
    learningMaps: {
      subjects: [],
      sections: [
        { id: U(851), name: 'Questioning', tags: [{ id: T1, label: 'Question', text: 'Ask' }] },
        { id: U(852), name: 'Planning', tags: [{ id: T2, label: 'Plan', text: 'Plan' }] },
      ],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    rubrics: [{ id: RUBRIC, name: 'Lab', criteria: [{ id: CRIT, name: 'Method', tagIds: [T1], levels: {} }] }],
  });
  _noteRubricsSet(CID);
  _v2GradebookToCache(CID, {
    categories: [],
    students: S.map((id, i) => ({
      enrollment_id: id,
      student_id: id.replace(/^0/, 'f'),
      first_name: NAMES[i],
      last_name: 'Test',
      roster_position: i + 1,
    })),
    assessments: [
      row(GROUP, 'Group Lab', {
        collab_mode: 'groups',
        collab_config: { groups: [[S[0], S[1], S[2]], [S[3]]], groupCount: 2 },
        tag_ids: [T1, T2],
      }),
      row(DUO, 'Duo Lab', { collab_mode: 'groups', collab_config: { groups: [[S[3], S[4]]] }, tag_ids: [T1, T2] }),
      row(NULL_CONFIG, 'Groups, None Saved', { collab_mode: 'groups', collab_config: null }),
      row(EMPTY_GROUPS, 'Groups, Empty', { collab_mode: 'groups', collab_config: { groups: [] } }),
      row(ADD, 'Add a Competency'),
      row(POINTS, 'Points Quiz', { score_mode: 'points', max_points: 10 }),
      row(POINTS_RUBRIC, 'Points Lab', { score_mode: 'points', max_points: 10 }),
      row(PLAIN, 'Plain'),
      row(PLAIN_POINTS, 'Plain Points', { score_mode: 'points', max_points: 10 }),
    ],
    cells: {},
  });
}

const piece = aid => getAssessments(CID).find(a => a.id === aid);
// An edit as the assessment form saves it: the stored row changed in place
// (a field the teacher cleared becomes undefined), then the list saved.
function edit(aid, change) {
  const list = getAssessments(CID);
  Object.assign(
    list.find(a => a.id === aid),
    change,
  );
  saveAssessments(CID, list);
}
const level = (sid, aid, tid, value) => upsertScore(CID, sid, aid, tid, value, '2026-10-01', 'summative', '', 0);
// A withdrawn student's levels, as their withdrawn entry holds them.
const heldWhileWithdrawn = sid => {
  const w = getWithdrawnStudents(CID).find(x => x.student.id === sid);
  return [((w && w.records && w.records.scores) || []).map(e => e.tagId + '=' + e.score).join(' ')];
};
const scoreCalls = calls => calls.filter(([name]) => /score|collab/.test(name));
const onPiece = (calls, aid) => scoreCalls(calls).filter(([, p]) => p.p_assessment_id === aid || p.p_id === aid);
const levelsOn = (blob, aid) =>
  S.map(sid =>
    ((blob || {})[sid] || [])
      .filter(e => e.assessmentId === aid)
      .map(e => e.tagId + '=' + e.score)
      .join(' '),
  );

describe('signed in, the score writers read the piece as this page holds it', () => {
  let session;
  beforeEach(() => {
    localStorage.clear();
    session = signIn();
    load();
    session.since();
  });
  afterEach(() => {
    session.signOut();
    if (_cache.v2Gradebook) delete _cache.v2Gradebook[CID];
    clearClass(CID);
  });

  describe('group work', () => {
    it('grading one member fills the group, on the page, in the saved copy and on the server', async () => {
      level(S[0], GROUP, T1, 3);
      await settle();
      const filled = [T1 + '=3', T1 + '=3', T1 + '=3', '', ''];
      expect(levelsOn(getScores(CID), GROUP)).toEqual(filled);
      expect(levelsOn(stored('scores', CID), GROUP)).toEqual(filled);
      expect(onPiece(session.since(), GROUP)).toEqual(
        [S[0], S[1], S[2]].map(sid => [
          'upsert_tag_score',
          expect.objectContaining({ p_enrollment_id: sid, p_tag_id: T1, p_value: 3 }),
        ]),
      );
    });

    it('Grade Separately grades that student alone', async () => {
      level(S[0], GROUP, T1, 3);
      await settle();
      Grader.gradeSeparately(CID, GROUP, S[1]);
      await settle();
      session.since();
      level(S[1], GROUP, T1, 1);
      await settle();
      expect(levelsOn(getScores(CID), GROUP)).toEqual([T1 + '=3', T1 + '=1', T1 + '=3', '', '']);
      expect(onPiece(session.since(), GROUP)).toEqual([
        ['upsert_tag_score', expect.objectContaining({ p_enrollment_id: S[1], p_tag_id: T1, p_value: 1 })],
      ]);
    });

    it('a group of one fills nobody else', async () => {
      level(S[3], GROUP, T1, 4);
      await settle();
      expect(levelsOn(getScores(CID), GROUP)).toEqual(['', '', '', T1 + '=4', '']);
      expect(onPiece(session.since(), GROUP)).toEqual([
        ['upsert_tag_score', expect.objectContaining({ p_enrollment_id: S[3], p_value: 4 })],
      ]);
    });

    for (const [aid, what] of [
      [NULL_CONFIG, 'no groups ever saved'],
      [EMPTY_GROUPS, 'an empty list of groups'],
    ])
      it(`group work with ${what} grades each student alone`, async () => {
        level(S[0], aid, T1, 2);
        await settle();
        expect(levelsOn(getScores(CID), aid)).toEqual([T1 + '=2', '', '', '', '']);
        expect(onPiece(session.since(), aid)).toEqual([
          ['upsert_tag_score', expect.objectContaining({ p_enrollment_id: S[0], p_tag_id: T1, p_value: 2 })],
        ]);
      });

    it('the groups the page holds are enrollment ids, the ids the grader passes', () => {
      expect(getStudents(CID).map(s => s.id)).toEqual(S);
      expect(piece(GROUP).groups).toEqual([[S[0], S[1], S[2]], [S[3]]]);
      expect(S.map(sid => isLinkedGroupMember(CID, GROUP, sid))).toEqual([true, true, true, true, false]);
    });
  });

  describe('a withdrawn member is left alone', () => {
    // GROUP is Ann, Ben, Cal: Cal is withdrawn. DUO is Dee and Eve: Eve is.
    async function withdrawOne(aid, members, gone) {
      level(members[0], aid, T1, 3);
      level(members[0], aid, T2, 2);
      await settle();
      withdrawStudent(CID, gone);
      await settle();
      session.since();
    }
    const touches = (calls, sid) => calls.filter(([, p]) => p && p.p_enrollment_id === sid);
    const held = [T1 + '=3 ' + T2 + '=2'];

    it('grading the other member of a pair sends nothing for the withdrawn one', async () => {
      await withdrawOne(DUO, [S[3], S[4]], S[4]);
      level(S[3], DUO, T1, 4);
      await settle();
      const calls = session.since();
      expect(touches(calls, S[4])).toEqual([]);
      expect(onPiece(calls, DUO)).toEqual([
        ['upsert_tag_score', expect.objectContaining({ p_enrollment_id: S[3], p_tag_id: T1, p_value: 4 })],
      ]);
      expect(getScores(CID)[S[4]]).toBeUndefined();
      expect(stored('scores', CID)[S[4]]).toBeUndefined();
      expect(heldWhileWithdrawn(S[4])).toEqual(held);
      reenrolStudent(CID, S[4]);
      await settle();
      expect(levelsOn(getScores(CID), DUO)[4]).toBe(held[0]);
      expect(levelsOn(getScores(CID), DUO)[3]).toBe(T1 + '=4 ' + T2 + '=2');
    });

    it('the members left still fill each other', async () => {
      await withdrawOne(GROUP, [S[0], S[1], S[2]], S[2]);
      level(S[0], GROUP, T1, 4);
      await settle();
      const calls = session.since();
      expect(touches(calls, S[2])).toEqual([]);
      expect(levelsOn(getScores(CID), GROUP).slice(0, 2)).toEqual([T1 + '=4 ' + T2 + '=2', T1 + '=4 ' + T2 + '=2']);
      expect(heldWhileWithdrawn(S[2])).toEqual(held);
    });

    it('Back to Group Grade takes nothing from, and sends nothing for, the withdrawn member', async () => {
      await withdrawOne(GROUP, [S[0], S[1], S[2]], S[2]);
      Grader.gradeSeparately(CID, GROUP, S[1]);
      level(S[1], GROUP, T1, 1);
      level(S[0], GROUP, T1, 4);
      await settle();
      session.since();
      Grader.backToGroupGrade(CID, GROUP, S[1]);
      await settle();
      expect(touches(session.since(), S[2])).toEqual([]);
      expect(levelsOn(getScores(CID), GROUP).slice(0, 2)).toEqual([T1 + '=4 ' + T2 + '=2', T1 + '=4 ' + T2 + '=2']);
      expect(heldWhileWithdrawn(S[2])).toEqual(held);

      // In a pair, Back to Group Grade with the partner withdrawn keeps the
      // member's own grade: there is nobody on the roster to copy from.
      await withdrawOne(DUO, [S[3], S[4]], S[4]);
      Grader.gradeSeparately(CID, DUO, S[3]);
      level(S[3], DUO, T1, 1);
      await settle();
      session.since();
      Grader.backToGroupGrade(CID, DUO, S[3]);
      await settle();
      expect(touches(session.since(), S[4])).toEqual([]);
      expect(levelsOn(getScores(CID), DUO)[3]).toBe(T1 + '=1 ' + T2 + '=2');
      expect(heldWhileWithdrawn(S[4])).toEqual(held);
    });

    it('Missing, then cleared, on the member left sends nothing for the withdrawn one', async () => {
      await withdrawOne(DUO, [S[3], S[4]], S[4]);
      expect(setAssignmentStatus(CID, S[3], DUO, 'NS')).toBeTruthy();
      await settle();
      expect(levelsOn(getScores(CID), DUO)[3]).toBe('');
      setAssignmentStatus(CID, S[3], DUO, '');
      await settle();
      expect(touches(session.since(), S[4])).toEqual([]);
      expect(levelsOn(getScores(CID), DUO)[3]).toBe(held[0]);
      expect(getScores(CID)[S[4]]).toBeUndefined();
      expect(heldWhileWithdrawn(S[4])).toEqual(held);

      await withdrawOne(GROUP, [S[0], S[1], S[2]], S[2]);
      setAssignmentStatus(CID, S[0], GROUP, 'NS');
      await settle();
      setAssignmentStatus(CID, S[0], GROUP, '');
      await settle();
      expect(touches(session.since(), S[2])).toEqual([]);
      expect(levelsOn(getScores(CID), GROUP).slice(0, 2)).toEqual([held[0], held[0]]);
      expect(heldWhileWithdrawn(S[2])).toEqual(held);
    });
  });

  it('a competency added since the load goes up as that competency', async () => {
    edit(ADD, { tagIds: [T1, T2] });
    await settle();
    session.since();
    level(S[0], ADD, T2, 3);
    await settle();
    expect(onPiece(session.since(), ADD)).toEqual([
      ['upsert_tag_score', expect.objectContaining({ p_enrollment_id: S[0], p_tag_id: T2, p_value: 3 })],
    ]);
  });

  it('points work switched to proficiency sends each competency as itself', async () => {
    edit(POINTS, { scoreMode: undefined, maxPoints: undefined, tagIds: [T1, T2] });
    await settle();
    expect(isPointsScored(piece(POINTS))).toBe(false);
    session.since();
    level(S[1], POINTS, T1, 3);
    level(S[1], POINTS, T2, 2);
    await settle();
    expect(onPiece(session.since(), POINTS)).toEqual([
      ['upsert_tag_score', expect.objectContaining({ p_enrollment_id: S[1], p_tag_id: T1, p_value: 3 })],
      ['upsert_tag_score', expect.objectContaining({ p_enrollment_id: S[1], p_tag_id: T2, p_value: 2 })],
    ]);
  });

  it('points work given a rubric sends its criterion as a rubric score', async () => {
    edit(POINTS_RUBRIC, { scoreMode: undefined, maxPoints: undefined, rubricId: RUBRIC });
    await settle();
    expect(isPointsScored(piece(POINTS_RUBRIC))).toBe(false);
    session.since();
    level(S[0], POINTS_RUBRIC, CRIT, 4);
    await settle();
    expect(onPiece(session.since(), POINTS_RUBRIC)).toEqual([
      ['upsert_rubric_score', expect.objectContaining({ p_enrollment_id: S[0], p_criterion_id: CRIT, p_value: 4 })],
    ]);
  });

  it('an edit leaves no stale snake_case copy on the page’s row or in the saved copy', () => {
    edit(POINTS, { scoreMode: undefined, maxPoints: undefined, tagIds: [T1, T2], dueDate: '2026-10-09' });
    edit(PLAIN, { dueDate: '2026-10-09' });
    edit(PLAIN, { dueDate: undefined });
    const savedRow = aid => JSON.parse(localStorage.getItem('gb-assessments-' + CID)).find(a => a.id === aid);
    for (const a of [piece(POINTS), savedRow(POINTS)]) {
      expect(a.score_mode).toBe('proficiency');
      expect(a.max_points == null).toBe(true);
      expect(a.tag_ids).toEqual([T1, T2]);
      expect(a.due_date).toBe('2026-10-09');
    }
    for (const a of [piece(PLAIN), savedRow(PLAIN)]) expect(a.due_date == null || a.due_date === '').toBe(true);
  });

  it('work nobody edited sends what it always sent', async () => {
    level(S[0], PLAIN, T1, 3);
    setPointsScore(CID, S[1], PLAIN_POINTS, 7);
    await settle();
    expect(scoreCalls(session.since())).toEqual([
      [
        'upsert_tag_score',
        {
          p_enrollment_id: S[0],
          p_assessment_id: PLAIN,
          p_tag_id: T1,
          p_value: 3,
          p_modifier: 0,
          p_comment: null,
        },
      ],
      ['upsert_score', { p_enrollment_id: S[1], p_assessment_id: PLAIN_POINTS, p_value: 7 }],
    ]);
  });

  it('a page row it does not hold is read from the load', () => {
    const raw = _cache.v2Gradebook[CID].assessments.find(a => a.id === PLAIN);
    _cache.assessments[CID] = getAssessments(CID).filter(a => a.id !== PLAIN);
    expect(_assessmentById(CID, PLAIN)).toBe(raw);
  });
});

describe('Demo Mode (this device only), for contrast', () => {
  beforeEach(() => {
    localStorage.clear();
    load();
    delete _cache.v2Gradebook[CID];
  });
  afterEach(() => clearClass(CID));

  it('grading one member fills the group; no groups, or a group of one, fills nobody', () => {
    level(S[0], GROUP, T1, 3);
    level(S[3], GROUP, T1, 4);
    level(S[0], NULL_CONFIG, T1, 2);
    level(S[0], EMPTY_GROUPS, T1, 2);
    expect(levelsOn(getScores(CID), GROUP)).toEqual([T1 + '=3', T1 + '=3', T1 + '=3', T1 + '=4', '']);
    expect(levelsOn(getScores(CID), NULL_CONFIG)).toEqual([T1 + '=2', '', '', '', '']);
    expect(levelsOn(getScores(CID), EMPTY_GROUPS)).toEqual([T1 + '=2', '', '', '', '']);
  });

  it('a withdrawn member is left alone, and comes back with their own grade', () => {
    level(S[3], DUO, T1, 3);
    level(S[3], DUO, T2, 2);
    withdrawStudent(CID, S[4]);
    level(S[3], DUO, T1, 4);
    expect(getScores(CID)[S[4]]).toBeUndefined();
    Grader.gradeSeparately(CID, DUO, S[3]);
    level(S[3], DUO, T1, 1);
    Grader.backToGroupGrade(CID, DUO, S[3]);
    setAssignmentStatus(CID, S[3], DUO, 'NS');
    setAssignmentStatus(CID, S[3], DUO, '');
    expect(getScores(CID)[S[4]]).toBeUndefined();
    expect(heldWhileWithdrawn(S[4])).toEqual([T1 + '=3 ' + T2 + '=2']);
    expect(levelsOn(getScores(CID), DUO)[3]).toBe(T1 + '=1 ' + T2 + '=2');
    reenrolStudent(CID, S[4]);
    expect(levelsOn(getScores(CID), DUO)[4]).toBe(T1 + '=3 ' + T2 + '=2');
    expect(levelsOn(getScores(CID), DUO)[3]).toBe(T1 + '=1 ' + T2 + '=2');
  });
});
