/**
 * Pin: the phone's Overall Comment (teacher-mobile/tab-grade.js), S0-P1.
 *
 * The box on each student's grading card saves when the teacher leaves it
 * and 800 ms after the last key. The save is private to the tab, so this
 * draws the real grading screen (MGrade.renderSwiper) on a linkedom
 * document, wires it (MGrade.setupSwiper) and types in the box. It records
 * what is saved and sent today so the tidying PRs cannot change it
 * unnoticed.
 */
import './setup-mobile.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { U, signIn, seedClass, clearClass, entries, storedMatchesCache, settle } from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const ESSAY = U(31); // competency levels
const QUIZ = U(32); // points
const LAB = U(33); // a rubric
const QUESTION = U(41);
const PLAN = U(42);
const RUBRIC = U(71);
const SAFETY = U(72);
const METHOD = U(73);

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

function seed(more) {
  seedClass(CID, {
    students: [
      { id: AVA, firstName: 'Ava', lastName: 'Adams' },
      { id: BEN, firstName: 'Ben', lastName: 'Brown' },
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
    rubrics: [
      {
        id: RUBRIC,
        name: 'Lab Skills',
        criteria: [
          { id: SAFETY, name: 'Safety', tagIds: [], levels: {} },
          { id: METHOD, name: 'Method', tagIds: [], levels: {} },
        ],
      },
    ],
    assessments: [
      { id: ESSAY, title: 'Essay', tagIds: [QUESTION, PLAN], date: '2026-10-10', type: 'summative' },
      { id: QUIZ, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [QUESTION], date: '2026-10-11' },
      { id: LAB, title: 'Lab', rubricId: RUBRIC, tagIds: [], date: '2026-10-12', type: 'summative' },
    ],
    scores: {
      [AVA]: [entry(AVA, ESSAY, QUESTION, 3, { mod: 1 }), entry(AVA, ESSAY, PLAN, 2)],
    },
    ...more,
  });
}

const comment = (sid, aid, text) => [
  'save_score_comment',
  { p_enrollment_id: sid, p_assessment_id: aid, p_comment: text },
];

describe('pin: the phone’s Overall Comment', () => {
  let session = null;
  let stubDocument;
  let win;

  /* The grading screen for one assessment, drawn and wired as shell.js does. */
  function openSwiper(aid) {
    const dom = parseHTML('<!DOCTYPE html><html><body><div id="m-nav-stack"></div></body></html>');
    win = dom.window;
    globalThis.document = dom.document;
    // html-safe: MGrade.renderSwiper escapes names and text; a test page
    document.getElementById('m-nav-stack').innerHTML = MGrade.renderSwiper(CID, aid);
    MGrade.setupSwiper(CID, aid);
  }
  const box = (sid, aid) => document.getElementById('m-overall-' + sid + '-' + aid);
  const send = (el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));
  function typeAndLeave(el, text) {
    el.value = text;
    send(el, 'focusout');
  }

  beforeEach(() => {
    localStorage.clear();
    stubDocument = globalThis.document;
  });
  afterEach(() => {
    vi.useRealTimers();
    if (session) session.signOut();
    session = null;
    globalThis.document = stubDocument;
    clearClass(CID);
  });

  it('draws one box per student, holding the saved comment', () => {
    seed({ scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3, { note: 'Clear thesis' })] } });
    openSwiper(ESSAY);
    expect(box(AVA, ESSAY).value).toBe('Clear thesis');
    expect(box(AVA, ESSAY).dataset.sid).toBe(AVA);
    expect(box(AVA, ESSAY).dataset.aid).toBe(ESSAY);
    expect(box(BEN, ESSAY).value).toBe('');
  });

  it('on leaving the box, puts the trimmed text on every entry of the work and sends save_score_comment', async () => {
    seed();
    openSwiper(ESSAY);
    session = signIn();
    typeAndLeave(box(AVA, ESSAY), '  Clear thesis.  ');
    await settle();

    expect(entries(CID, AVA, ESSAY).map(e => [e.tagId, e.score, e.mod, e.note])).toEqual([
      [QUESTION, 3, 1, 'Clear thesis.'],
      [PLAN, 2, undefined, 'Clear thesis.'],
    ]);
    expect(getScoreComment(CID, AVA, ESSAY)).toBe('Clear thesis.');
    expect(storedMatchesCache('scores', CID)).toBe(true);
    // One write: the comment alone, no level.
    expect(session.sent()).toEqual([comment(AVA, ESSAY, 'Clear thesis.')]);
  });

  it('saves nothing when the text is as saved', async () => {
    seed({ scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3, { note: 'Clear thesis' })] } });
    openSwiper(ESSAY);
    session = signIn();
    typeAndLeave(box(AVA, ESSAY), ' Clear thesis ');
    typeAndLeave(box(BEN, ESSAY), '   ');
    await settle();
    expect(session.sent()).toEqual([]);
    expect(getScores(CID)[BEN]).toBeUndefined();
  });

  it('clears the comment with an empty box, sending an empty string', async () => {
    seed({
      scores: {
        [AVA]: [
          entry(AVA, ESSAY, QUESTION, 3, { note: 'Clear thesis' }),
          entry(AVA, ESSAY, PLAN, 2, { note: 'Clear thesis' }),
        ],
      },
    });
    openSwiper(ESSAY);
    session = signIn();
    typeAndLeave(box(AVA, ESSAY), '');
    await settle();
    expect(entries(CID, AVA, ESSAY).map(e => [e.score, e.note])).toEqual([
      [3, ''],
      [2, ''],
    ]);
    expect(session.sent()).toEqual([comment(AVA, ESSAY, '')]);
  });

  describe('on work with no score yet, the comment gets an entry of its own', () => {
    it('competency work: score 0 under the first competency', async () => {
      seed();
      openSwiper(ESSAY);
      session = signIn();
      typeAndLeave(box(BEN, ESSAY), 'Hand it in');
      await settle();
      expect(entries(CID, BEN)).toEqual([
        {
          id: BEN + ':' + ESSAY + ':' + QUESTION,
          assessmentId: ESSAY,
          tagId: QUESTION,
          score: 0,
          date: '2026-10-10',
          type: 'summative',
          note: 'Hand it in',
        },
      ]);
      expect(session.sent()).toEqual([comment(BEN, ESSAY, 'Hand it in')]);
    });

    it('points work: score null, so no 0 is read as a score', async () => {
      seed();
      openSwiper(QUIZ);
      session = signIn();
      typeAndLeave(box(BEN, QUIZ), 'Rewrite Friday');
      await settle();
      expect(entries(CID, BEN)).toEqual([
        {
          id: BEN + ':' + QUIZ + ':' + QUESTION,
          assessmentId: QUIZ,
          tagId: QUESTION,
          score: null,
          date: '2026-10-11',
          // No category and no type of its own: formative (scoreTypeFor).
          type: 'formative',
          note: 'Rewrite Friday',
        },
      ]);
      expect(getPointsScore(CID, BEN, QUIZ)).toBe(null);
      expect(session.sent()).toEqual([comment(BEN, QUIZ, 'Rewrite Friday')]);
    });

    it('rubric work: score 0 under the first criterion', async () => {
      seed();
      openSwiper(LAB);
      session = signIn();
      typeAndLeave(box(BEN, LAB), 'Goggles next time');
      await settle();
      expect(entries(CID, BEN).map(e => [e.tagId, e.score, e.note])).toEqual([[SAFETY, 0, 'Goggles next time']]);
      expect(session.sent()).toEqual([comment(BEN, LAB, 'Goggles next time')]);
    });
  });

  it('saves a comment on work marked Missing: the lock is on scores, not comments', async () => {
    seed({ statuses: { [BEN + ':' + ESSAY]: 'NS' } });
    openSwiper(ESSAY);
    session = signIn();
    typeAndLeave(box(BEN, ESSAY), 'Not handed in');
    await settle();
    expect(getScoreComment(CID, BEN, ESSAY)).toBe('Not handed in');
    expect(getAssignmentStatus(CID, BEN, ESSAY)).toBe('NS');
    expect(session.sent()).toEqual([comment(BEN, ESSAY, 'Not handed in')]);
  });

  it('saves 800 ms after the last key, once, and leaving the box then sends nothing more', async () => {
    seed();
    openSwiper(ESSAY);
    session = signIn();
    vi.useFakeTimers();
    const el = box(AVA, ESSAY);
    el.value = 'Cle';
    send(el, 'input');
    vi.advanceTimersByTime(700);
    el.value = 'Clear thesis';
    send(el, 'input');
    vi.advanceTimersByTime(799);
    expect(session.sent()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(session.sent()).toEqual([comment(AVA, ESSAY, 'Clear thesis')]);
    send(el, 'focusout');
    vi.advanceTimersByTime(2000);
    expect(session.sent()).toEqual([comment(AVA, ESSAY, 'Clear thesis')]);
  });

  it('leaving the box before the 800 ms saves at once and drops the timer', async () => {
    seed();
    openSwiper(ESSAY);
    session = signIn();
    vi.useFakeTimers();
    const el = box(AVA, ESSAY);
    el.value = 'Clear thesis';
    send(el, 'input');
    send(el, 'focusout');
    expect(session.sent()).toEqual([comment(AVA, ESSAY, 'Clear thesis')]);
    vi.advanceTimersByTime(2000);
    expect(session.sent()).toEqual([comment(AVA, ESSAY, 'Clear thesis')]);
  });

  it('saves on this device and sends nothing with writes off, as in Demo Mode', async () => {
    seed();
    openSwiper(ESSAY);
    typeAndLeave(box(AVA, ESSAY), 'Clear thesis');
    await settle();
    expect(getScoreComment(CID, AVA, ESSAY)).toBe('Clear thesis');
    expect(storedMatchesCache('scores', CID)).toBe(true);
  });
});
