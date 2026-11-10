/**
 * Pin: moveRubricScores (shared/data.js), the client half of Edit a Copy on
 * scored work (S0-P1, docs/plans/student-page-build-plan.md).
 *
 * The copy's criteria and checkboxes have new ids, so one assessment's
 * rubric scores and ticks move to them: in the cache and localStorage at
 * once, and on the server through one move_rubric_scores. This records what
 * it does today, oddities included, so the tidying PRs cannot change it
 * unnoticed. The SQL half is pinned on the Postgres harness.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  entries,
  stored,
  storedMatchesCache,
  settle,
} from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const LAB1 = U(31); // the assessment being edited: now on the copy
const LAB2 = U(32); // another assessment still on the original rubric
const ORIGINAL = U(71);
const SAFETY = U(72);
const METHOD = U(73);
const GOGGLES = U(74);
const STATION = U(75);
const COPY = U(81);
const SAFETY_2 = U(82);
const METHOD_2 = U(83);
const GOGGLES_2 = U(84);
const STATION_2 = U(85);

const MAPS = {
  aid: LAB1, // the page passes it; moveRubricScores takes the assessment from its own argument
  rubricId: COPY,
  criteria: { [SAFETY]: SAFETY_2, [METHOD]: METHOD_2 },
  checks: { [GOGGLES]: GOGGLES_2, [STATION]: STATION_2 },
};

const criterion = (id, name, checks) => ({ id, name, tagIds: [], levels: {}, checks: checks || [] });
const entry = (sid, aid, tid, score, more) => ({
  id: sid + ':' + aid + ':' + tid,
  assessmentId: aid,
  tagId: tid,
  score,
  date: '2026-10-10',
  type: 'summative',
  note: '',
  created: '2026-10-10T17:00:00.000Z',
  ...more,
});

function seed() {
  seedClass(CID, {
    students: [
      { id: AVA, firstName: 'Ava', lastName: 'Adams' },
      { id: BEN, firstName: 'Ben', lastName: 'Brown' },
    ],
    rubrics: [
      {
        id: ORIGINAL,
        name: 'Lab Skills',
        style: 'advanced',
        criteria: [
          criterion(SAFETY, 'Safety', [
            { id: GOGGLES, level: 3, label: 'Goggles on' },
            { id: STATION, level: 3, label: 'Cleans the station' },
          ]),
          criterion(METHOD, 'Method'),
        ],
      },
      {
        id: COPY,
        name: 'Lab Skills (Copy)',
        style: 'advanced',
        criteria: [
          criterion(SAFETY_2, 'Safety', [
            { id: GOGGLES_2, level: 3, label: 'Goggles on' },
            { id: STATION_2, level: 3, label: 'Cleans the station' },
          ]),
          criterion(METHOD_2, 'Method'),
        ],
      },
    ],
    assessments: [
      { id: LAB1, title: 'Lab 1', rubricId: COPY, tagIds: [], date: '2026-10-10', type: 'summative' },
      { id: LAB2, title: 'Lab 2', rubricId: ORIGINAL, tagIds: [], date: '2026-10-12', type: 'summative' },
    ],
    scores: {
      [AVA]: [
        entry(AVA, LAB1, SAFETY, 3, { mod: 1, note: 'Good work', critNote: 'Cite it', critBeyond: 'Led cleanup' }),
        entry(AVA, LAB1, METHOD, 2, { note: 'Good work', reportNote: 'ran the test twice' }),
        entry(AVA, LAB2, SAFETY, 4),
      ],
      [BEN]: [entry(BEN, LAB1, SAFETY, 1)],
    },
    rubricChecks: {
      [AVA + ':' + LAB1]: [GOGGLES, STATION, 'a-check-not-in-the-map'],
      [AVA + ':' + LAB2]: [GOGGLES],
    },
  });
}

describe('pin: moveRubricScores', () => {
  let session;

  beforeEach(() => {
    localStorage.clear();
    seed();
    session = signIn();
  });
  afterEach(() => {
    session.signOut();
    clearClass(CID);
  });

  it('moves the assessment’s scores to the new criteria, with everything they carry', async () => {
    await moveRubricScores(CID, LAB1, MAPS);

    expect(entries(CID, AVA)).toEqual([
      {
        // The id is rebuilt as assessment:criterion, with no student in it,
        // where the score writers use student:assessment:key.
        id: LAB1 + ':' + SAFETY_2,
        assessmentId: LAB1,
        tagId: SAFETY_2,
        score: 3,
        mod: 1,
        date: '2026-10-10',
        type: 'summative',
        note: 'Good work',
        critNote: 'Cite it',
        critBeyond: 'Led cleanup',
      },
      {
        id: LAB1 + ':' + METHOD_2,
        assessmentId: LAB1,
        tagId: METHOD_2,
        score: 2,
        date: '2026-10-10',
        type: 'summative',
        note: 'Good work',
        reportNote: 'ran the test twice',
      },
      // Another assessment on the original rubric keeps its keys and its id.
      {
        id: AVA + ':' + LAB2 + ':' + SAFETY,
        assessmentId: LAB2,
        tagId: SAFETY,
        score: 4,
        date: '2026-10-10',
        type: 'summative',
        note: '',
      },
    ]);
    // Two students' moved entries end up with the same id.
    expect(entries(CID, BEN)[0].id).toBe(entries(CID, AVA)[0].id);
    expect(entries(CID, BEN)[0]).toMatchObject({ tagId: SAFETY_2, score: 1 });
  });

  it('keeps the entry’s `created` time', async () => {
    await moveRubricScores(CID, LAB1, MAPS);
    expect(getScores(CID)[AVA].map(e => e.created)).toEqual([
      '2026-10-10T17:00:00.000Z',
      '2026-10-10T17:00:00.000Z',
      '2026-10-10T17:00:00.000Z',
    ]);
  });

  it('moves the ticks on that assessment and leaves the rest', async () => {
    await moveRubricScores(CID, LAB1, MAPS);
    expect(getRubricChecks(CID)).toEqual({
      // A tick whose checkbox is not in the map stays under its old id.
      [AVA + ':' + LAB1]: [GOGGLES_2, STATION_2, 'a-check-not-in-the-map'],
      [AVA + ':' + LAB2]: [GOGGLES],
    });
  });

  it('writes both lists to localStorage as they are in the cache', async () => {
    await moveRubricScores(CID, LAB1, MAPS);
    expect(storedMatchesCache('scores', CID)).toBe(true);
    expect(storedMatchesCache('rubricChecks', CID)).toBe(true);
    expect(stored('scores', CID)[BEN][0].tagId).toBe(SAFETY_2);
  });

  it('sends one move_rubric_scores with both maps and an idempotency key, and no score write', async () => {
    const result = await moveRubricScores(CID, LAB1, MAPS);
    expect(result).toEqual({ data: null, error: null });
    expect(session.sent()).toEqual([
      [
        'move_rubric_scores',
        {
          p_assessment_id: LAB1,
          p_rubric_id: COPY,
          p_criterion_map: { [SAFETY]: SAFETY_2, [METHOD]: METHOD_2 },
          p_check_map: { [GOGGLES]: GOGGLES_2, [STATION]: STATION_2 },
          p_idempotency_key: '<key>',
        },
      ],
    ]);
  });

  it('sends a null rubric id and an empty check map when the maps leave them out', async () => {
    await moveRubricScores(CID, LAB1, { criteria: { [SAFETY]: SAFETY_2 } });
    expect(session.sent()).toEqual([
      [
        'move_rubric_scores',
        {
          p_assessment_id: LAB1,
          p_rubric_id: null,
          p_criterion_map: { [SAFETY]: SAFETY_2 },
          p_check_map: {},
          p_idempotency_key: '<key>',
        },
      ],
    ]);
    // Only the mapped criterion moved.
    expect(entries(CID, AVA, LAB1).map(e => e.tagId)).toEqual([SAFETY_2, METHOD]);
  });

  it('does nothing at all with no criteria to move, even when checkboxes are mapped', async () => {
    const before = JSON.stringify(getScores(CID));
    const ticks = JSON.stringify(getRubricChecks(CID));
    expect(await moveRubricScores(CID, LAB1, { rubricId: COPY, criteria: {}, checks: MAPS.checks })).toEqual({
      data: 0,
      error: null,
    });
    expect(await moveRubricScores(CID, LAB1, null)).toEqual({ data: 0, error: null });
    expect(await moveRubricScores(CID, '', MAPS)).toEqual({ data: 0, error: null });
    expect(JSON.stringify(getScores(CID))).toBe(before);
    expect(JSON.stringify(getRubricChecks(CID))).toBe(ticks);
    expect(session.sent()).toEqual([]);
  });

  it('moves on this device and sends nothing in Demo Mode', async () => {
    // shared/supabase.js is not loaded here; this is its isDemoMode().
    const was = globalThis.isDemoMode;
    globalThis.isDemoMode = () => true;
    localStorage.setItem('gb-demo-mode', '1');
    try {
      expect(await moveRubricScores(CID, LAB1, MAPS)).toEqual({ data: null, error: null });
    } finally {
      globalThis.isDemoMode = was;
    }
    expect(entries(CID, AVA, LAB1).map(e => e.tagId)).toEqual([SAFETY_2, METHOD_2]);
    expect(getRubricChecks(CID)[AVA + ':' + LAB1]).toEqual([GOGGLES_2, STATION_2, 'a-check-not-in-the-map']);
    expect(session.sent()).toEqual([]);
  });

  it('does not ask whether writes are on: signed out with a client still there, it sends', async () => {
    _useSupabase = false;
    await moveRubricScores(CID, LAB1, MAPS);
    expect(session.sent().map(c => c[0])).toEqual(['move_rubric_scores']);
  });

  describe('the next whole-list score save (saveScores)', () => {
    /* moveRubricScores leaves the server baseline (_serverState.scores)
       under the old criterion ids. A class that was loaded has a baseline,
       so the next saveScores diffs against it: every moved score goes up
       again under its new criterion, with the Overall Comment, and a 0 goes
       up for each old criterion id. With no baseline the save diffs against
       localStorage, which the move updated, and sends nothing. */
    it('sends the moved scores again, and a 0 for each old criterion, after a class load', async () => {
      await moveRubricScores(CID, LAB1, MAPS);
      session.since();
      saveScores(CID, getScores(CID));
      await settle();
      const rubricScore = (sid, crit, value, modifier, comment, beyond) => [
        'upsert_rubric_score',
        {
          p_enrollment_id: sid,
          p_assessment_id: LAB1,
          p_criterion_id: crit,
          p_value: value,
          p_modifier: modifier,
          p_comment: comment,
          p_beyond: beyond,
        },
      ];
      const comment = ['save_score_comment', { p_enrollment_id: AVA, p_assessment_id: LAB1, p_comment: 'Good work' }];
      expect(session.since()).toEqual([
        rubricScore(AVA, SAFETY_2, 3, 1, 'Cite it', 'Led cleanup'),
        comment,
        rubricScore(AVA, METHOD_2, 2, 0, null, null),
        comment,
        rubricScore(BEN, SAFETY_2, 1, 0, null, null),
        rubricScore(AVA, SAFETY, 0, 0, null, null),
        rubricScore(AVA, METHOD, 0, 0, null, null),
        rubricScore(BEN, SAFETY, 0, 0, null, null),
      ]);
    });

    it('sends nothing when the session holds no baseline', async () => {
      _serverState = {};
      await moveRubricScores(CID, LAB1, MAPS);
      session.since();
      saveScores(CID, getScores(CID));
      await settle();
      expect(session.since()).toEqual([]);
    });
  });
});
