/**
 * Pin: _carryOverallToCompetencies (teacher/page-assignments.js), S0-P1.
 *
 * Work scored with one Overall level, before any competency was ticked,
 * gets its level copied onto each competency the teacher then ticks in the
 * edit form. The function is private to the page, so this drives the real
 * Assignments page on a linkedom document: Edit, tick, Save Changes. It
 * records what is saved and sent today so the tidying PRs cannot change it
 * unnoticed.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  entries,
  storedMatchesCache,
  settle,
  click,
  tick,
  openAssignments,
  closePages,
} from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const CARA = U(13);
const DEV = U(14);
const JOURNAL = U(31);
const QUESTION = U(41);
const PLAN = U(42);

const overall = (sid, score, more) => ({
  id: sid + ':' + JOURNAL + ':overall',
  assessmentId: JOURNAL,
  tagId: 'overall',
  score,
  date: '2026-10-08',
  type: 'formative',
  note: '',
  created: '2026-10-08T17:00:00.000Z',
  ...more,
});

function seedWith(assessment, scores) {
  return () =>
    seedClass(CID, {
      students: [
        { id: AVA, firstName: 'Ava', lastName: 'Adams' },
        { id: BEN, firstName: 'Ben', lastName: 'Brown' },
        { id: CARA, firstName: 'Cara', lastName: 'Chen' },
        { id: DEV, firstName: 'Dev', lastName: 'Das' },
      ],
      learningMaps: {
        subjects: [],
        sections: [
          { id: U(51), name: 'Question', tags: [{ id: QUESTION, label: 'Question', text: 'Ask questions' }] },
          { id: U(52), name: 'Plan', tags: [{ id: PLAN, label: 'Plan', text: 'Plan a test' }] },
        ],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      assessments: [
        { id: JOURNAL, title: 'Journal', tagIds: [], date: '2026-10-10', type: 'summative', ...assessment },
      ],
      scores,
    });
}

/* Edit the Journal, tick these competencies, Save Changes. */
function tickAndSave(tagIds) {
  click(document.querySelector('[data-action="editAssess"][data-aid="' + JOURNAL + '"]'));
  const form = document.getElementById('new-assess-form');
  tagIds.forEach(id => tick(form.querySelector('.af-tag-cb[value="' + id + '"]'), true));
  click(form.querySelector('[data-action="saveEditAssess"]'));
}

const tagScore = (sid, tag, value, modifier) => [
  'upsert_tag_score',
  {
    p_enrollment_id: sid,
    p_assessment_id: JOURNAL,
    p_tag_id: tag,
    p_value: value,
    p_modifier: modifier,
    p_comment: null,
  },
];

describe('pin: an Overall level carried onto newly ticked competencies', () => {
  let session = null;

  afterEach(() => {
    if (session) session.signOut();
    session = null;
    closePages();
    clearClass(CID);
  });

  const SCORES = {
    // A level with a +, an Overall Comment and a Note for the Report.
    [AVA]: [overall(AVA, 3, { mod: 1, note: 'Thoughtful entries', reportNote: 'kept a daily log' })],
    [BEN]: [overall(BEN, 2)],
    // An Overall Comment with no level yet: an entry with score 0.
    [CARA]: [overall(CARA, 0, { note: 'Hand it in' })],
    // Dev has nothing.
  };

  it('copies each student’s level and + or − onto every ticked competency', async () => {
    openAssignments(seedWith({}, SCORES), CID);
    session = signIn();
    tickAndSave([QUESTION, PLAN]);
    await settle();

    expect(getAssessments(CID)[0].tagIds).toEqual([QUESTION, PLAN]);
    const copy = (sid, tag, score, more) => ({
      id: sid + ':' + JOURNAL + ':' + tag,
      assessmentId: JOURNAL,
      tagId: tag,
      score,
      // The Overall entry's date and type, not the assessment's.
      date: '2026-10-08',
      type: 'formative',
      // The Overall Comment and the Note for the Report are not copied.
      note: '',
      ...more,
    });
    expect(entries(CID, AVA)).toEqual([
      // The Overall entry stays as it was.
      {
        id: AVA + ':' + JOURNAL + ':overall',
        assessmentId: JOURNAL,
        tagId: 'overall',
        score: 3,
        mod: 1,
        date: '2026-10-08',
        type: 'formative',
        note: 'Thoughtful entries',
        reportNote: 'kept a daily log',
      },
      copy(AVA, QUESTION, 3, { mod: 1 }),
      copy(AVA, PLAN, 3, { mod: 1 }),
    ]);
    expect(entries(CID, BEN).map(e => [e.tagId, e.score, e.mod])).toEqual([
      ['overall', 2, undefined],
      [QUESTION, 2, undefined],
      [PLAN, 2, undefined],
    ]);
    // No level, no copy: a comment alone is not carried.
    expect(entries(CID, CARA).map(e => e.tagId)).toEqual(['overall']);
    expect(getScores(CID)[DEV]).toBeUndefined();
    expect(storedMatchesCache('scores', CID)).toBe(true);
  });

  it('sends one upsert_tag_score per copy, student by student, and nothing for the Overall', async () => {
    openAssignments(seedWith({}, SCORES), CID);
    session = signIn();
    tickAndSave([QUESTION, PLAN]);
    await settle();

    const sent = session.sent();
    expect(sent.filter(c => c[0] !== 'update_assessment' && c[0] !== 'save_collab')).toEqual([
      tagScore(AVA, QUESTION, 3, 1),
      tagScore(AVA, PLAN, 3, 1),
      tagScore(BEN, QUESTION, 2, 0),
      tagScore(BEN, PLAN, 2, 0),
    ]);
    // With no outbox to order them, the level writes reach the client
    // before the update_assessment that links the competencies.
    expect(sent.map(c => c[0])).toEqual([
      'upsert_tag_score',
      'upsert_tag_score',
      'upsert_tag_score',
      'upsert_tag_score',
      'update_assessment',
      'save_collab',
    ]);
    expect(sent[4][1].p_tag_ids).toEqual([QUESTION, PLAN]);
  });

  it('leaves a competency that already holds an entry, even an unscored one', async () => {
    const scores = {
      [AVA]: [
        overall(AVA, 3),
        // Left from an earlier time the competency was ticked.
        { ...overall(AVA, 1), id: AVA + ':' + JOURNAL + ':' + QUESTION, tagId: QUESTION },
        { ...overall(AVA, 0), id: AVA + ':' + JOURNAL + ':' + PLAN, tagId: PLAN },
      ],
    };
    openAssignments(seedWith({}, scores), CID);
    session = signIn();
    tickAndSave([QUESTION, PLAN]);
    await settle();

    expect(entries(CID, AVA).map(e => [e.tagId, e.score])).toEqual([
      ['overall', 3],
      [QUESTION, 1],
      [PLAN, 0],
    ]);
    expect(session.sent().filter(c => /score/.test(c[0]))).toEqual([]);
  });

  it('copies nothing when the work already had a competency', async () => {
    const scores = {
      [AVA]: [overall(AVA, 3), { ...overall(AVA, 4), id: AVA + ':' + JOURNAL + ':' + QUESTION, tagId: QUESTION }],
    };
    openAssignments(seedWith({ tagIds: [QUESTION] }, scores), CID);
    session = signIn();
    tickAndSave([PLAN]);
    await settle();

    expect(getAssessments(CID)[0].tagIds).toEqual([QUESTION, PLAN]);
    expect(entries(CID, AVA).map(e => [e.tagId, e.score])).toEqual([
      ['overall', 3],
      [QUESTION, 4],
    ]);
    expect(session.sent().filter(c => /score/.test(c[0]))).toEqual([]);
  });

  it('copies on this device with writes off, as in Demo Mode', async () => {
    openAssignments(seedWith({}, SCORES), CID);
    tickAndSave([QUESTION]);
    await settle();
    expect(entries(CID, AVA).map(e => [e.tagId, e.score, e.mod])).toEqual([
      ['overall', 3, 1],
      [QUESTION, 3, 1],
    ]);
    expect(storedMatchesCache('scores', CID)).toBe(true);
  });
});
