/**
 * Pin: what the phone's Grade tab writes (teacher-mobile/tab-grade.js),
 * S1-T2. This was committed before the tab's writes moved onto
 * shared/grader.js and passes on both sides of that move.
 *
 * The real grading screen is drawn on a linkedom document
 * (MGrade.renderSwiper), wired (MGrade.setupSwiper) and worked as a teacher
 * works it: a level, + and −, a rubric criterion, the Competencies view of
 * rubric work, a checklist tick, a criterion comment, points typed and
 * stepped, Complete and Incomplete, Missing, Excused and Late, the Overall
 * Comment, pair work with Grade Separately and Back to Group Grade, and
 * Undo. A tap is sent the way teacher-mobile/shell.js sends it: the
 * control's own data attributes, to the MGrade function shell.js calls.
 *
 * After each one this records three things:
 * - which score writers in shared/data.js the screen called, with which
 *   arguments, in which order (a writer called by another writer is not
 *   the screen's call and is left out);
 * - the score entries in the data.js cache, and that localStorage holds
 *   the same;
 * - the RPCs sent, with their params, in order.
 * It records today's behaviour, oddities included; the PR that added it
 * lists them.
 *
 * Undo: no control on the phone calls MGrade.undoLastScore today (the
 * Score Cleared toast that offered it went in PR 916), so the Undo pins
 * call it directly, as the older tests do.
 */
import './setup-mobile.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  entries,
  levels,
  storedMatchesCache,
  settle,
} from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const CARA = U(13);
const ESSAY = U(31); // competency levels: Question and Plan
const QUIZ = U(32); // points, out of 10
const LAB = U(33); // an Advanced rubric; two of its criteria feed Question
const EXIT = U(34); // Complete/Incomplete
const NOTES = U(35); // competency levels, no date
const TALK = U(37); // pair work: Ava and Ben are graded together; Cara is in no pair
const QUESTION = U(41);
const PLAN = U(42);
const LAB_RUBRIC = U(71);
const SAFETY = U(72); // feeds Question; has the checklist
const METHOD = U(73); // feeds Question
const CARE = U(77); // feeds no competency
const GOGGLES = U(74); // Safety, level 3
const STATION = U(75); // Safety, level 3
const REMINDS = U(76); // Safety, level 4

// What each level of a criterion says; any wording does.
const WORDS = { 1: 'With help', 2: 'With reminders', 3: 'On their own', 4: 'And helps others' };

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
      { id: CARA, firstName: 'Cara', lastName: 'Chen' },
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
        id: LAB_RUBRIC,
        name: 'Lab Skills',
        style: 'advanced',
        criteria: [
          {
            id: SAFETY,
            name: 'Safety',
            tagIds: [QUESTION],
            levels: WORDS,
            checks: [
              { id: GOGGLES, level: 3, label: 'Goggles on' },
              { id: STATION, level: 3, label: 'Cleans the station' },
              { id: REMINDS, level: 4, label: 'Reminds others' },
            ],
          },
          { id: METHOD, name: 'Method', tagIds: [QUESTION], levels: WORDS, checks: [] },
          { id: CARE, name: 'Care', tagIds: [], levels: WORDS, checks: [] },
        ],
      },
    ],
    assessments: [
      { id: ESSAY, title: 'Essay', tagIds: [QUESTION, PLAN], date: '2026-10-10', type: 'summative' },
      { id: QUIZ, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [QUESTION], date: '2026-10-11' },
      { id: LAB, title: 'Lab', rubricId: LAB_RUBRIC, tagIds: [QUESTION], date: '2026-10-12', type: 'summative' },
      { id: EXIT, title: 'Exit Ticket', scoreMode: 'complete', maxPoints: 1, tagIds: [QUESTION], date: '2026-10-13' },
      { id: NOTES, title: 'Notes', tagIds: [QUESTION], type: 'summative' },
      {
        id: TALK,
        title: 'Pair Talk',
        tagIds: [QUESTION],
        date: '2026-10-16',
        type: 'summative',
        collaboration: 'pair',
        pairs: [[AVA, BEN]],
      },
    ],
    ...more,
  });
}

/* ── The RPCs, as the recorder lists them ─────────────────────────────── */
const tagScore = (sid, aid, tag, value, modifier, comment = null) => [
  'upsert_tag_score',
  {
    p_enrollment_id: sid,
    p_assessment_id: aid,
    p_tag_id: tag,
    p_value: value,
    p_modifier: modifier,
    p_comment: comment,
  },
];
const rubricScore = (sid, aid, criterion, value, modifier, comment = null, beyond = null) => [
  'upsert_rubric_score',
  {
    p_enrollment_id: sid,
    p_assessment_id: aid,
    p_criterion_id: criterion,
    p_value: value,
    p_modifier: modifier,
    p_comment: comment,
    p_beyond: beyond,
  },
];
const score = (sid, aid, value) => ['upsert_score', { p_enrollment_id: sid, p_assessment_id: aid, p_value: value }];
const comment = (sid, aid, text) => [
  'save_score_comment',
  { p_enrollment_id: sid, p_assessment_id: aid, p_comment: text },
];
const status = (sid, aid, value) => [
  'set_score_status',
  { p_enrollment_id: sid, p_assessment_id: aid, p_status: value },
];
const check = (sid, aid, id, on) => [
  'set_rubric_check',
  { p_enrollment_id: sid, p_assessment_id: aid, p_check_id: id, p_on: on },
];
// Who is graded separately is kept on the assessment, in its group setup
// (save_collab). The first save of a seeded class sends the assessment too
// (update_assessment, shortened here to its id): the seed gives data.js no
// server copy of the assessments to compare with.
const collab = list => [
  'save_collab',
  {
    p_id: TALK,
    p_mode: 'pairs',
    p_config: list ? { pairs: [[AVA, BEN]], gradedSeparately: list } : { pairs: [[AVA, BEN]] },
  },
];
const shortened = sent =>
  sent.map(([name, params]) => (name === 'update_assessment' ? [name, params.p_id] : [name, params]));

/* ── The score writers in shared/data.js (the list in
   tests/grader-guard.test.js). Each is wrapped so a call from the screen
   is recorded; a writer called from inside another is that writer's own
   business and is not. ─────────────────────────────────────────────── */
const WRITERS = [
  'upsertScore',
  'setPointsScore',
  'setCompletionMark',
  'setRubricCheck',
  'saveRubricCriterionComment',
  'saveRubricCriterionBeyond',
  'saveTagComment',
  'saveScoreComment',
  'saveScoreReportNote',
  'setAssignmentStatus',
  'applyAssignmentStatus',
  'saveDibelsScore',
  'setGradedSeparately',
  'saveScores',
  'persistScoreDiffToCanonical',
  'clearScoreEntries',
  'restoreScoreCells',
  'saveAssignmentStatuses',
  'saveRubricChecks',
  'moveRubricScores',
];

function watchWriters() {
  const real = {};
  let calls = [];
  let depth = 0;
  WRITERS.forEach(name => {
    real[name] = globalThis[name];
    globalThis[name] = function () {
      if (depth === 0) {
        // A score list is recorded as "<scores>": what it holds is pinned
        // from the cache. An argument left off the end and one passed as
        // undefined are the same call to data.js, so neither is recorded.
        const args = Array.from(arguments).map(a => (a && typeof a === 'object' ? '<scores>' : a));
        while (args.length && args[args.length - 1] === undefined) args.pop();
        calls.push([name].concat(args));
      }
      depth++;
      try {
        return real[name].apply(this, arguments);
      } finally {
        depth--;
      }
    };
  });
  return {
    /* The screen's writer calls since the last look, as [name, ...args]. */
    since() {
      const out = calls;
      calls = [];
      return out;
    },
    stop() {
      WRITERS.forEach(name => (globalThis[name] = real[name]));
    },
  };
}

describe('pin: the phone Grade tab’s writes', () => {
  let session = null;
  let writers = null;
  let stubDocument;
  let win;

  /* The grading screen for one assessment, drawn and wired as shell.js
     does, with the sheet and toast holders teacher-mobile/index.html has. */
  function open(aid, more) {
    seed(more);
    // The class is on this device as a loaded class is, so data.js is told
    // it is loaded. Without that, the load of the teacher's other classes
    // that teacher/router.js starts 1.5 s after the test setup loads it
    // (preloadClasses) fetches this class from the recording client, which
    // holds nothing, and empties it under a test that is waiting. That only
    // happened when a slow machine took 1.5 s to reach the first such wait.
    _classLoads[CID] = true;
    const dom = parseHTML(
      '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
        '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
        '<div id="m-toast"></div></body></html>',
    );
    win = dom.window;
    // linkedom has no layout: scrolling is a no-op.
    win.HTMLElement.prototype.scrollTo = function () {};
    win.HTMLElement.prototype.scrollIntoView = function () {};
    globalThis.document = dom.document;
    // html-safe: MGrade.renderSwiper escapes names and text; a test page
    document.getElementById('m-nav-stack').innerHTML = MGrade.renderSwiper(CID, aid);
    MGrade.setupSwiper(CID, aid);
    // The tab remembers the view picked for a piece of work, from one test
    // to the next: rubric work starts in the Rubric view, as it first opens.
    const rubricView = document.querySelector('[data-action="m-grade-view"][data-view="rubric"]');
    if (rubricView && rubricView.getAttribute('aria-pressed') !== 'true') MGrade.setGradeView(CID, aid, 'rubric');
    session = signIn();
    writers = watchWriters();
  }

  /* A tap, sent as teacher-mobile/shell.js sends it. A disabled button
     takes no tap. `on` is a checkbox's new state. */
  function tap(el, on) {
    if (!el) throw new Error('no such control on the screen');
    if (el.disabled || el.hasAttribute('disabled')) return 'disabled';
    const a = name => el.getAttribute('data-' + name);
    const action = a('action');
    if (action === 'm-grade-score') return MGrade.setScore(CID, a('sid'), a('aid'), a('tid'), parseInt(a('score'), 10));
    if (action === 'm-grade-crit')
      return MGrade.setCriterionScore(CID, a('sid'), a('aid'), a('critid'), parseInt(a('score'), 10));
    if (action === 'm-grade-view') return MGrade.setGradeView(CID, a('aid'), a('view'));
    if (action === 'm-grade-checks') return MGrade.toggleChecklist(CID, a('sid'), a('aid'), a('critid'));
    if (action === 'm-grade-crit-comment') return MGrade.openCritComment(el);
    if (action === 'm-grade-tick') return MGrade.tickCheck(CID, a('sid'), a('aid'), a('critid'), a('checkid'), on);
    if (action === 'm-grade-mod') {
      const box = el.closest('.m-score-mods');
      const b = name => box.getAttribute('data-' + name);
      if (b('critid')) return MGrade.setCriterionMod(CID, b('sid'), b('aid'), b('critid'), parseInt(a('mod'), 10));
      return MGrade.setScoreMod(CID, b('sid'), b('aid'), b('tid'), parseInt(a('mod'), 10));
    }
    if (action === 'm-grade-completion') {
      const group = el.closest('.m-cmp-group');
      return MGrade.setCompletion(CID, group.getAttribute('data-sid'), group.getAttribute('data-aid'), a('mark'));
    }
    if (action === 'm-grade-points-inc' || action === 'm-grade-points-dec')
      return MGrade.adjustPointsScore(
        CID,
        a('sid'),
        a('aid'),
        action === 'm-grade-points-inc' ? 1 : -1,
        parseFloat(a('max')) || 100,
      );
    if (action === 'm-grade-status') return MGrade.setStatus(CID, a('sid'), a('aid'), a('val'));
    const group = {
      'm-grade-group-more': MGrade.openMemberSheet,
      'm-grade-separate': MGrade.gradeSeparately,
      'm-grade-rejoin': MGrade.confirmBackToGroup,
      'm-grade-rejoin-yes': MGrade.backToGroup,
    }[action];
    if (group) return group(CID, a('aid'), a('sid'));
    throw new Error('not a grading control: ' + action);
  }

  /* The screen's controls, looked up when used: a card redraws after most
     saves. */
  const card = sid => document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
  const on = (sid, selector) => card(sid).querySelector(selector);
  const level = (sid, tid, n) =>
    on(sid, '[data-action="m-grade-score"][data-tid="' + tid + '"][data-score="' + n + '"]');
  const plusMinus = (sid, tid, mod) =>
    on(sid, '.m-score-mods[data-tid="' + tid + '"] [data-action="m-grade-mod"][data-mod="' + mod + '"]');
  const critLevel = (sid, crit, n) =>
    on(sid, '[data-action="m-grade-crit"][data-critid="' + crit + '"][data-score="' + n + '"]');
  const critPlusMinus = (sid, crit, mod) =>
    on(sid, '.m-score-mods[data-critid="' + crit + '"] [data-action="m-grade-mod"][data-mod="' + mod + '"]');
  const checklist = (sid, crit) => on(sid, '[data-action="m-grade-checks"][data-critid="' + crit + '"]');
  // The tab remembers which checklists are open, from one test to the next.
  function openChecklist(sid, crit) {
    if (checklist(sid, crit).getAttribute('aria-expanded') !== 'true') tap(checklist(sid, crit));
  }
  const box = (sid, id) => on(sid, '[data-action="m-grade-tick"][data-checkid="' + id + '"]');
  const critComment = (sid, crit) => on(sid, '.m-crit-comment[data-critid="' + crit + '"]');
  const overall = (sid, aid) => document.getElementById('m-overall-' + sid + '-' + aid);
  const points = (sid, aid) => document.getElementById('m-pts-' + sid + '-' + aid);
  const step = (sid, which) => on(sid, '[data-action="m-grade-points-' + which + '"]');
  const mark = (sid, which) => on(sid, '[data-action="m-grade-completion"][data-mark="' + which + '"]');
  const pill = (sid, which) => on(sid, '.m-status-row [data-action="m-grade-status"][data-val="' + which + '"]');
  const memberPill = (member, which) =>
    document.querySelector('.m-group-pill[data-sid="' + member + '"][data-val="' + which + '"]');
  const view = which => document.querySelector('[data-action="m-grade-view"][data-view="' + which + '"]');
  const inSheet = action => document.querySelector('#m-sheet-container [data-action="' + action + '"]');

  const send = (el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));
  function typeAndLeave(el, text) {
    el.value = text;
    send(el, 'focusout');
  }

  const today = () => courseToday(CID);
  const statusOf = (sid, aid) => getAssignmentStatus(CID, sid, aid);
  const talk = () => getAssessments(CID).find(a => a.id === TALK);

  beforeEach(() => {
    localStorage.clear();
    stubDocument = globalThis.document;
  });
  afterEach(() => {
    vi.useRealTimers();
    // Empty the tab's undo list, so one test's taps are not undone in the next.
    for (let i = 0; i < 25; i++) MGrade.undoLastScore();
    if (writers) writers.stop();
    writers = null;
    if (session) session.signOut();
    session = null;
    globalThis.document = stubDocument;
    clearClass(CID);
    delete _classLoads[CID];
  });

  describe('a competency level', () => {
    it('a level makes one entry under the competency and sends one upsert_tag_score', () => {
      open(ESSAY);
      tap(level(AVA, QUESTION, 3));

      // No + or − is passed.
      expect(writers.since()).toEqual([['upsertScore', CID, AVA, ESSAY, QUESTION, 3, '2026-10-10', 'summative', '']]);
      expect(entries(CID, AVA)).toEqual([
        {
          id: AVA + ':' + ESSAY + ':' + QUESTION,
          assessmentId: ESSAY,
          tagId: QUESTION,
          score: 3,
          date: '2026-10-10', // the assessment's date, not today's
          type: 'summative',
          note: '',
        },
      ]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([tagScore(AVA, ESSAY, QUESTION, 3, 0)]);
    });

    it('+ and − go with the level; a second tap takes it off; a new level drops it; Extending takes no +', () => {
      open(ESSAY);
      tap(level(AVA, QUESTION, 3));
      tap(plusMinus(AVA, QUESTION, 1));
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: '3+' });
      tap(plusMinus(AVA, QUESTION, 1));
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 3 });
      tap(plusMinus(AVA, QUESTION, -1));
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: '3-' });
      tap(level(AVA, QUESTION, 4));
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 4 });
      // The + button is disabled on Extending.
      expect(tap(plusMinus(AVA, QUESTION, 1))).toBe('disabled');

      const essay = [CID, AVA, ESSAY, QUESTION];
      expect(writers.since()).toEqual([
        ['upsertScore', ...essay, 3, '2026-10-10', 'summative', ''],
        ['upsertScore', ...essay, 3, '2026-10-10', 'summative', '', 1],
        ['upsertScore', ...essay, 3, '2026-10-10', 'summative', '', 0],
        ['upsertScore', ...essay, 3, '2026-10-10', 'summative', '', -1],
        ['upsertScore', ...essay, 4, '2026-10-10', 'summative', ''],
      ]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([
        tagScore(AVA, ESSAY, QUESTION, 3, 0),
        tagScore(AVA, ESSAY, QUESTION, 3, 1),
        tagScore(AVA, ESSAY, QUESTION, 3, 0),
        tagScore(AVA, ESSAY, QUESTION, 3, -1),
        tagScore(AVA, ESSAY, QUESTION, 4, 0),
      ]);
    });

    it('a + on work with an Overall Comment passes the comment along, and it is sent again', () => {
      open(ESSAY, { scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3, { note: 'Clear thesis' })] } });
      tap(plusMinus(AVA, QUESTION, 1));

      expect(writers.since()).toEqual([
        ['upsertScore', CID, AVA, ESSAY, QUESTION, 3, '2026-10-10', 'summative', 'Clear thesis', 1],
      ]);
      expect(entries(CID, AVA).map(e => [e.score, e.mod, e.note])).toEqual([[3, 1, 'Clear thesis']]);
      expect(session.sent()).toEqual([tagScore(AVA, ESSAY, QUESTION, 3, 1), comment(AVA, ESSAY, 'Clear thesis')]);
    });

    it('a new level on work with an Overall Comment keeps the comment and sends the level alone', () => {
      open(ESSAY, { scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3, { note: 'Clear thesis' })] } });
      tap(level(AVA, QUESTION, 2));
      expect(entries(CID, AVA).map(e => [e.score, e.note])).toEqual([[2, 'Clear thesis']]);
      expect(session.sent()).toEqual([tagScore(AVA, ESSAY, QUESTION, 2, 0)]);
    });

    it('the chosen level tapped again clears it: the entry stays with score 0, a 0 is sent, no toast', () => {
      open(ESSAY);
      tap(level(AVA, QUESTION, 4));
      tap(plusMinus(AVA, QUESTION, -1));
      session.since();
      writers.since();
      tap(level(AVA, QUESTION, 4));

      expect(writers.since()).toEqual([['upsertScore', CID, AVA, ESSAY, QUESTION, 0, '2026-10-10', 'summative', '']]);
      expect(entries(CID, AVA).map(e => [e.tagId, e.score, e.mod])).toEqual([[QUESTION, 0, undefined]]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.since()).toEqual([tagScore(AVA, ESSAY, QUESTION, 0, 0)]);
      expect(document.getElementById('m-toast').innerHTML).toBe('');
    });

    it('on work with no date, a first level is dated today, and a changed level is dated today again', () => {
      open(NOTES, { scores: { [AVA]: [entry(AVA, NOTES, QUESTION, 2, { date: '2026-09-01' })] } });
      tap(level(AVA, QUESTION, 3));
      tap(level(BEN, QUESTION, 3));

      expect(writers.since()).toEqual([
        ['upsertScore', CID, AVA, NOTES, QUESTION, 3, today(), 'summative', ''],
        ['upsertScore', CID, BEN, NOTES, QUESTION, 3, today(), 'summative', ''],
      ]);
      // Ava's entry was dated Sept 1; the new level moves it to today.
      expect(entries(CID, AVA).map(e => [e.score, e.date])).toEqual([[3, today()]]);
      expect(entries(CID, BEN).map(e => [e.score, e.date])).toEqual([[3, today()]]);
    });

    it('a level on Missing work is asked for and refused: nothing is saved or sent', () => {
      open(ESSAY, { statuses: { [BEN + ':' + ESSAY]: 'NS' } });
      tap(level(BEN, QUESTION, 3));
      expect(writers.since()).toEqual([['upsertScore', CID, BEN, ESSAY, QUESTION, 3, '2026-10-10', 'summative', '']]);
      expect(entries(CID, BEN)).toEqual([]);
      expect(session.sent()).toEqual([]);
    });
  });

  describe('a rubric criterion (the Rubric view)', () => {
    it('a level makes one entry under the criterion’s id and sends one upsert_rubric_score', () => {
      open(LAB);
      tap(critLevel(AVA, METHOD, 3));

      expect(writers.since()).toEqual([['upsertScore', CID, AVA, LAB, METHOD, 3, '2026-10-12', 'summative', '', 0]]);
      expect(entries(CID, AVA)).toEqual([
        {
          id: AVA + ':' + LAB + ':' + METHOD,
          assessmentId: LAB,
          tagId: METHOD,
          score: 3,
          date: '2026-10-12',
          type: 'summative',
          note: '',
        },
      ]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([rubricScore(AVA, LAB, METHOD, 3, 0)]);
    });

    it('+ and −, a second tap, a new level and a clear', () => {
      open(LAB);
      tap(critLevel(AVA, METHOD, 3));
      tap(critPlusMinus(AVA, METHOD, 1));
      expect(levels(CID, AVA)).toEqual({ [METHOD]: '3+' });
      tap(critPlusMinus(AVA, METHOD, 1));
      tap(critPlusMinus(AVA, METHOD, -1));
      expect(levels(CID, AVA)).toEqual({ [METHOD]: '3-' });
      tap(critLevel(AVA, METHOD, 4));
      expect(tap(critPlusMinus(AVA, METHOD, 1))).toBe('disabled');
      tap(critLevel(AVA, METHOD, 4));
      expect(levels(CID, AVA)).toEqual({ [METHOD]: 0 });

      const lab = [CID, AVA, LAB, METHOD];
      expect(writers.since()).toEqual([
        ['upsertScore', ...lab, 3, '2026-10-12', 'summative', '', 0],
        ['upsertScore', ...lab, 3, '2026-10-12', 'summative', '', 1],
        ['upsertScore', ...lab, 3, '2026-10-12', 'summative', '', 0],
        ['upsertScore', ...lab, 3, '2026-10-12', 'summative', '', -1],
        ['upsertScore', ...lab, 4, '2026-10-12', 'summative', '', 0],
        ['upsertScore', ...lab, 0, '2026-10-12', 'summative', '', 0],
      ]);
      expect(session.sent()).toEqual([
        rubricScore(AVA, LAB, METHOD, 3, 0),
        rubricScore(AVA, LAB, METHOD, 3, 1),
        rubricScore(AVA, LAB, METHOD, 3, 0),
        rubricScore(AVA, LAB, METHOD, 3, -1),
        rubricScore(AVA, LAB, METHOD, 4, 0),
        rubricScore(AVA, LAB, METHOD, 0, 0),
      ]);
    });

    it('a comment saves on leaving the box, trimmed, with the level it sits beside', () => {
      open(LAB);
      tap(critLevel(AVA, METHOD, 3));
      session.since();
      writers.since();
      typeAndLeave(critComment(AVA, METHOD), '  Label the axes  ');

      expect(writers.since()).toEqual([['saveRubricCriterionComment', CID, AVA, LAB, METHOD, 'Label the axes']]);
      expect(entries(CID, AVA).map(e => [e.tagId, e.score, e.critNote])).toEqual([[METHOD, 3, 'Label the axes']]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.since()).toEqual([rubricScore(AVA, LAB, METHOD, 3, 0, 'Label the axes')]);

      // Left as saved: nothing more.
      typeAndLeave(critComment(AVA, METHOD), 'Label the axes ');
      expect(writers.since()).toEqual([]);
      expect(session.since()).toEqual([]);
    });

    it('a comment with no level yet makes an unscored entry and sends a null value', () => {
      open(LAB);
      typeAndLeave(critComment(BEN, CARE), 'Slow down');
      expect(writers.since()).toEqual([['saveRubricCriterionComment', CID, BEN, LAB, CARE, 'Slow down']]);
      expect(entries(CID, BEN).map(e => [e.tagId, e.score, e.critNote])).toEqual([[CARE, 0, 'Slow down']]);
      expect(session.sent()).toEqual([rubricScore(BEN, LAB, CARE, null, 0, 'Slow down')]);
    });

    it('a comment saves 800 ms after the last key, once', () => {
      open(LAB);
      vi.useFakeTimers();
      const el = critComment(AVA, METHOD);
      el.value = 'Label';
      send(el, 'input');
      vi.advanceTimersByTime(799);
      expect(session.sent()).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(writers.since()).toEqual([['saveRubricCriterionComment', CID, AVA, LAB, METHOD, 'Label']]);
      send(el, 'focusout');
      vi.advanceTimersByTime(2000);
      expect(writers.since()).toEqual([]);
      expect(session.sent()).toEqual([rubricScore(AVA, LAB, METHOD, null, 0, 'Label')]);
    });
  });

  describe('a checklist tick (Advanced Rubric)', () => {
    it('a tick is saved first, then the level the boxes suggest; unticking takes the level off', () => {
      open(LAB);
      openChecklist(AVA, SAFETY);
      tap(box(AVA, GOGGLES), true);
      // One of the two level-3 boxes: no level yet.
      expect(writers.since()).toEqual([['setRubricCheck', CID, AVA, LAB, GOGGLES, true]]);
      expect(entries(CID, AVA)).toEqual([]);

      tap(box(AVA, STATION), true);
      expect(writers.since()).toEqual([
        ['setRubricCheck', CID, AVA, LAB, STATION, true],
        ['upsertScore', CID, AVA, LAB, SAFETY, 3, '2026-10-12', 'summative', '', 0],
      ]);
      expect(getRubricCheckIds(CID, AVA, LAB)).toEqual([GOGGLES, STATION]);
      expect(levels(CID, AVA)).toEqual({ [SAFETY]: 3 });
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(storedMatchesCache('rubricChecks', CID)).toBe(true);

      tap(box(AVA, STATION), false);
      expect(writers.since()).toEqual([
        ['setRubricCheck', CID, AVA, LAB, STATION, false],
        ['upsertScore', CID, AVA, LAB, SAFETY, 0, '2026-10-12', 'summative', '', 0],
      ]);
      expect(levels(CID, AVA)).toEqual({ [SAFETY]: 0 });

      expect(session.sent()).toEqual([
        check(AVA, LAB, GOGGLES, true),
        check(AVA, LAB, STATION, true),
        rubricScore(AVA, LAB, SAFETY, 3, 0),
        check(AVA, LAB, STATION, false),
        rubricScore(AVA, LAB, SAFETY, 0, 0),
      ]);
    });

    it('a level picked by hand is kept: the tick is saved alone', () => {
      open(LAB);
      tap(critLevel(AVA, SAFETY, 2));
      openChecklist(AVA, SAFETY);
      session.since();
      writers.since();
      tap(box(AVA, GOGGLES), true);
      tap(box(AVA, STATION), true);
      expect(writers.since()).toEqual([
        ['setRubricCheck', CID, AVA, LAB, GOGGLES, true],
        ['setRubricCheck', CID, AVA, LAB, STATION, true],
      ]);
      expect(levels(CID, AVA)).toEqual({ [SAFETY]: 2 });
      expect(session.since()).toEqual([check(AVA, LAB, GOGGLES, true), check(AVA, LAB, STATION, true)]);
    });
  });

  describe('rubric work in the Competencies view', () => {
    it('a level on a competency goes to each criterion that feeds it, in the rubric’s order', () => {
      open(LAB);
      tap(view('tags'));
      tap(level(AVA, QUESTION, 3));

      expect(writers.since()).toEqual([
        ['upsertScore', CID, AVA, LAB, SAFETY, 3, '2026-10-12', 'summative', '', 0],
        ['upsertScore', CID, AVA, LAB, METHOD, 3, '2026-10-12', 'summative', '', 0],
      ]);
      expect(levels(CID, AVA)).toEqual({ [SAFETY]: 3, [METHOD]: 3 });
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([rubricScore(AVA, LAB, SAFETY, 3, 0), rubricScore(AVA, LAB, METHOD, 3, 0)]);
    });

    it('its + goes to each of them, and the level tapped again clears each', () => {
      open(LAB);
      tap(view('tags'));
      tap(level(AVA, QUESTION, 3));
      session.since();
      writers.since();
      tap(plusMinus(AVA, QUESTION, 1));
      expect(levels(CID, AVA)).toEqual({ [SAFETY]: '3+', [METHOD]: '3+' });
      tap(level(AVA, QUESTION, 3));
      expect(levels(CID, AVA)).toEqual({ [SAFETY]: 0, [METHOD]: 0 });

      expect(writers.since()).toEqual([
        ['upsertScore', CID, AVA, LAB, SAFETY, 3, '2026-10-12', 'summative', '', 1],
        ['upsertScore', CID, AVA, LAB, METHOD, 3, '2026-10-12', 'summative', '', 1],
        ['upsertScore', CID, AVA, LAB, SAFETY, 0, '2026-10-12', 'summative', '', 0],
        ['upsertScore', CID, AVA, LAB, METHOD, 0, '2026-10-12', 'summative', '', 0],
      ]);
      expect(session.since()).toEqual([
        rubricScore(AVA, LAB, SAFETY, 3, 1),
        rubricScore(AVA, LAB, METHOD, 3, 1),
        rubricScore(AVA, LAB, SAFETY, 0, 0),
        rubricScore(AVA, LAB, METHOD, 0, 0),
      ]);
    });

    it('a criterion that feeds no competency has a row of its own', () => {
      open(LAB);
      tap(view('tags'));
      tap(level(AVA, CARE, 2));
      // Scored as a competency row is on work with no rubric: no + or − passed.
      expect(writers.since()).toEqual([['upsertScore', CID, AVA, LAB, CARE, 2, '2026-10-12', 'summative', '']]);
      expect(session.sent()).toEqual([rubricScore(AVA, LAB, CARE, 2, 0)]);
    });
  });

  describe('points', () => {
    it('typed points save on leaving the box and send one upsert_score', () => {
      open(QUIZ);
      typeAndLeave(points(AVA, QUIZ), '7.5');

      expect(writers.since()).toEqual([['setPointsScore', CID, AVA, QUIZ, 7.5]]);
      expect(entries(CID, AVA).map(e => [e.assessmentId, e.tagId, e.score, e.date, e.type])).toEqual([
        // No category and no type of its own: formative (scoreTypeFor).
        [QUIZ, QUESTION, 7.5, '2026-10-11', 'formative'],
      ]);
      expect(getPointsScore(CID, AVA, QUIZ)).toBe(7.5);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([score(AVA, QUIZ, 7.5)]);
    });

    it('over twice the maximum saves the limit; a typo keeps the score; unchanged saves nothing; blank clears', () => {
      open(QUIZ);
      typeAndLeave(points(AVA, QUIZ), '25');
      expect(getPointsScore(CID, AVA, QUIZ)).toBe(20);
      typeAndLeave(points(AVA, QUIZ), 'abc');
      typeAndLeave(points(AVA, QUIZ), '20');
      expect(getPointsScore(CID, AVA, QUIZ)).toBe(20);
      typeAndLeave(points(AVA, QUIZ), '0');
      expect(getPointsScore(CID, AVA, QUIZ)).toBe(0);
      typeAndLeave(points(AVA, QUIZ), '');
      expect(getPointsScore(CID, AVA, QUIZ)).toBe(null);
      expect(entries(CID, AVA)).toEqual([]);

      expect(writers.since()).toEqual([
        ['setPointsScore', CID, AVA, QUIZ, 20],
        ['setPointsScore', CID, AVA, QUIZ, 0],
        ['setPointsScore', CID, AVA, QUIZ, null],
      ]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([score(AVA, QUIZ, 20), score(AVA, QUIZ, 0), score(AVA, QUIZ, null)]);
    });

    it('+ and − step by one from the saved score; − on work with no score saves a 0', () => {
      open(QUIZ);
      tap(step(AVA, 'inc'));
      tap(step(AVA, 'inc'));
      tap(step(AVA, 'dec'));
      expect(getPointsScore(CID, AVA, QUIZ)).toBe(1);
      tap(step(BEN, 'dec'));
      expect(getPointsScore(CID, BEN, QUIZ)).toBe(0);

      expect(writers.since()).toEqual([
        ['setPointsScore', CID, AVA, QUIZ, 1],
        ['setPointsScore', CID, AVA, QUIZ, 2],
        ['setPointsScore', CID, AVA, QUIZ, 1],
        ['setPointsScore', CID, BEN, QUIZ, 0],
      ]);
      expect(session.sent()).toEqual([
        score(AVA, QUIZ, 1),
        score(AVA, QUIZ, 2),
        score(AVA, QUIZ, 1),
        score(BEN, QUIZ, 0),
      ]);
    });

    it('+ stops at twice the maximum and asks for the same score again, which sends nothing', () => {
      open(QUIZ, { scores: { [AVA]: [entry(AVA, QUIZ, QUESTION, 20, { type: 'formative' })] } });
      tap(step(AVA, 'inc'));
      expect(writers.since()).toEqual([['setPointsScore', CID, AVA, QUIZ, 20]]);
      expect(session.sent()).toEqual([]);
    });
  });

  describe('Complete and Incomplete', () => {
    it('Complete saves 1, Incomplete saves 0, and the chosen mark tapped again clears it', () => {
      open(EXIT);
      tap(mark(AVA, 'complete'));
      expect(getCompletionMark(CID, AVA, EXIT)).toBe('complete');
      expect(entries(CID, AVA).map(e => [e.tagId, e.score])).toEqual([[QUESTION, 1]]);
      tap(mark(AVA, 'incomplete'));
      expect(getCompletionMark(CID, AVA, EXIT)).toBe('incomplete');
      expect(entries(CID, AVA).map(e => [e.tagId, e.score])).toEqual([[QUESTION, 0]]);
      tap(mark(AVA, 'incomplete'));
      expect(getCompletionMark(CID, AVA, EXIT)).toBe(null);
      expect(entries(CID, AVA)).toEqual([]);

      expect(writers.since()).toEqual([
        ['setCompletionMark', CID, AVA, EXIT, 'complete'],
        ['setCompletionMark', CID, AVA, EXIT, 'incomplete'],
        ['setCompletionMark', CID, AVA, EXIT, null],
      ]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([score(AVA, EXIT, 1), score(AVA, EXIT, 0), score(AVA, EXIT, null)]);
    });
  });

  describe('Missing, Excused and Late', () => {
    it('Missing on unscored competency work sends the status, then a 0 for each competency', () => {
      open(ESSAY);
      tap(pill(BEN, 'NS'));

      expect(writers.since()).toEqual([['applyAssignmentStatus', CID, BEN, ESSAY, 'NS']]);
      expect(statusOf(BEN, ESSAY)).toBe('NS');
      expect(entries(CID, BEN).map(e => [e.tagId, e.score])).toEqual([
        [QUESTION, 0],
        [PLAN, 0],
      ]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(storedMatchesCache('statuses', CID)).toBe(true);
      expect(session.sent()).toEqual([
        status(BEN, ESSAY, 'NS'),
        tagScore(BEN, ESSAY, QUESTION, 0, 0),
        tagScore(BEN, ESSAY, PLAN, 0, 0),
      ]);
    });

    it('Missing tapped again takes it off and puts no level back', () => {
      open(ESSAY, { statuses: { [BEN + ':' + ESSAY]: 'NS' } });
      tap(pill(BEN, 'NS'));
      expect(writers.since()).toEqual([['applyAssignmentStatus', CID, BEN, ESSAY, null]]);
      expect(statusOf(BEN, ESSAY)).toBe(null);
      expect(entries(CID, BEN)).toEqual([]);
      expect(session.sent()).toEqual([status(BEN, ESSAY, null)]);
    });

    it('Missing and Excused are disabled on work with a level; Late is not, and keeps the level', () => {
      open(ESSAY, { scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3)] } });
      expect(tap(pill(AVA, 'NS'))).toBe('disabled');
      expect(tap(pill(AVA, 'EXC'))).toBe('disabled');
      tap(pill(AVA, 'LATE'));

      expect(writers.since()).toEqual([['applyAssignmentStatus', CID, AVA, ESSAY, 'LATE']]);
      expect(statusOf(AVA, ESSAY)).toBe('LATE');
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 3 });
      expect(session.sent()).toEqual([status(AVA, ESSAY, 'LATE')]);
    });

    it('Excused sends the status alone; changing it to Missing sends the new status and the 0s', () => {
      open(ESSAY);
      tap(pill(BEN, 'EXC'));
      expect(entries(CID, BEN)).toEqual([]);
      tap(pill(BEN, 'NS'));
      expect(statusOf(BEN, ESSAY)).toBe('NS');
      expect(writers.since()).toEqual([
        ['applyAssignmentStatus', CID, BEN, ESSAY, 'EXC'],
        ['applyAssignmentStatus', CID, BEN, ESSAY, 'NS'],
      ]);
      expect(session.sent()).toEqual([
        status(BEN, ESSAY, 'EXC'),
        status(BEN, ESSAY, 'NS'),
        tagScore(BEN, ESSAY, QUESTION, 0, 0),
        tagScore(BEN, ESSAY, PLAN, 0, 0),
      ]);
    });

    it('Missing on points work and on Complete/Incomplete work sends the status alone', () => {
      open(QUIZ);
      tap(pill(BEN, 'NS'));
      expect(writers.since()).toEqual([['applyAssignmentStatus', CID, BEN, QUIZ, 'NS']]);
      expect(entries(CID, BEN)).toEqual([]);
      expect(session.sent()).toEqual([status(BEN, QUIZ, 'NS')]);
    });

    it('Missing on rubric work sends the status, then a 0 for each criterion', () => {
      open(LAB);
      tap(pill(BEN, 'NS'));
      expect(writers.since()).toEqual([['applyAssignmentStatus', CID, BEN, LAB, 'NS']]);
      expect(session.sent()).toEqual([
        status(BEN, LAB, 'NS'),
        rubricScore(BEN, LAB, SAFETY, 0, 0),
        rubricScore(BEN, LAB, METHOD, 0, 0),
        rubricScore(BEN, LAB, CARE, 0, 0),
      ]);
    });
  });

  describe('the Overall Comment', () => {
    // What it saves and sends, case by case, is in
    // tests/pin-phone-overall-comment.test.js; this adds the writer it calls.
    it('calls saveScoreComment with the trimmed text, and not at all when the text is as saved', () => {
      open(ESSAY, { scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3)] } });
      typeAndLeave(overall(AVA, ESSAY), '  Clear thesis.  ');
      typeAndLeave(overall(AVA, ESSAY), 'Clear thesis.');
      expect(writers.since()).toEqual([['saveScoreComment', CID, AVA, ESSAY, 'Clear thesis.']]);
      expect(session.sent()).toEqual([comment(AVA, ESSAY, 'Clear thesis.')]);
    });
  });

  describe('pair work', () => {
    it('a level on the pair’s card is saved for the first member and copied to the other', () => {
      open(TALK);
      tap(level(AVA, QUESTION, 3));

      expect(writers.since()).toEqual([['upsertScore', CID, AVA, TALK, QUESTION, 3, '2026-10-16', 'summative', '']]);
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 3 });
      expect(levels(CID, BEN)).toEqual({ [QUESTION]: 3 });
      expect(entries(CID, CARA)).toEqual([]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.sent()).toEqual([tagScore(AVA, TALK, QUESTION, 3, 0), tagScore(BEN, TALK, QUESTION, 3, 0)]);
    });

    it('a + and the pair’s Overall Comment are copied too', () => {
      open(TALK);
      tap(level(AVA, QUESTION, 3));
      session.since();
      writers.since();
      tap(plusMinus(AVA, QUESTION, 1));
      typeAndLeave(overall(AVA, TALK), 'Good listening');

      expect(writers.since()).toEqual([
        ['upsertScore', CID, AVA, TALK, QUESTION, 3, '2026-10-16', 'summative', '', 1],
        ['saveScoreComment', CID, AVA, TALK, 'Good listening'],
      ]);
      expect(entries(CID, AVA).map(e => [e.score, e.mod, e.note])).toEqual([[3, 1, 'Good listening']]);
      expect(entries(CID, BEN).map(e => [e.score, e.mod, e.note])).toEqual([[3, 1, 'Good listening']]);
      expect(session.since()).toEqual([
        tagScore(AVA, TALK, QUESTION, 3, 1),
        tagScore(BEN, TALK, QUESTION, 3, 1),
        comment(AVA, TALK, 'Good listening'),
        // The copy to Ben saves his whole grade again: the level, then the comment.
        tagScore(BEN, TALK, QUESTION, 3, 1),
        comment(BEN, TALK, 'Good listening'),
      ]);
    });

    it('a member’s Late is theirs alone', () => {
      open(TALK);
      tap(memberPill(BEN, 'LATE'));
      expect(writers.since()).toEqual([['applyAssignmentStatus', CID, BEN, TALK, 'LATE']]);
      expect(statusOf(BEN, TALK)).toBe('LATE');
      expect(statusOf(AVA, TALK)).toBe(null);
      expect(session.sent()).toEqual([status(BEN, TALK, 'LATE')]);
    });

    /* The assessment's save is sent a moment after the tap (data.js queues
       it behind any earlier one), so these wait for it, as the time between
       a teacher's taps does. */
    it('Grade Separately keeps the member’s copy of the grade and saves who is separate', async () => {
      open(TALK);
      tap(level(AVA, QUESTION, 3));
      session.since();
      writers.since();
      tap(document.querySelector('[data-action="m-grade-group-more"][data-sid="' + BEN + '"]'));
      tap(inSheet('m-grade-separate'));
      await settle();

      expect(writers.since()).toEqual([['setGradedSeparately', CID, TALK, BEN, true]]);
      expect(talk().gradedSeparately).toEqual([BEN]);
      expect(levels(CID, BEN)).toEqual({ [QUESTION]: 3 });
      expect(storedMatchesCache('assessments', CID)).toBe(true);
      expect(shortened(session.since())).toEqual([['update_assessment', TALK], collab([BEN])]);

      // Ben's own card now takes a level that is his alone.
      tap(level(BEN, QUESTION, 2));
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 3 });
      expect(levels(CID, BEN)).toEqual({ [QUESTION]: 2 });
      expect(session.since()).toEqual([tagScore(BEN, TALK, QUESTION, 2, 0)]);
    });

    it('Back to Group Grade asks first, then replaces the member’s grade with the pair’s', async () => {
      open(TALK, {
        assessments: [
          {
            id: TALK,
            title: 'Pair Talk',
            tagIds: [QUESTION],
            date: '2026-10-16',
            type: 'summative',
            collaboration: 'pair',
            pairs: [[AVA, BEN]],
            gradedSeparately: [BEN],
          },
        ],
        scores: {
          [AVA]: [entry(AVA, TALK, QUESTION, 3, { date: '2026-10-16' })],
          [BEN]: [entry(BEN, TALK, QUESTION, 2, { date: '2026-10-16', note: 'His own' })],
        },
      });
      tap(document.querySelector('[data-action="m-grade-rejoin"][data-sid="' + BEN + '"]'));
      // The sheet is up; nothing is saved until it is answered.
      expect(writers.since()).toEqual([]);
      tap(inSheet('m-grade-rejoin-yes'));
      await settle();

      expect(writers.since()).toEqual([['setGradedSeparately', CID, TALK, BEN, false]]);
      expect(talk().gradedSeparately).toBeUndefined();
      expect(entries(CID, BEN).map(e => [e.score, e.note])).toEqual([[3, '']]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      // His comment is cleared and the pair's level copied at once; the
      // assessment's save follows a moment later.
      expect(shortened(session.sent())).toEqual([
        comment(BEN, TALK, ''),
        tagScore(BEN, TALK, QUESTION, 3, 0),
        ['update_assessment', TALK],
        collab(null),
      ]);
    });
  });

  /* ── Undo ───────────────────────────────────────────────────────────
     The tab keeps a list of the last 20 level changes (a level, a + or −,
     a clear, a level a tick set) and Undo puts the newest one back: the
     score entries under the keys it wrote, as they were. Points, marks,
     statuses, ticks and comments are not on the list. */

  // What Undo calls: it saves the class's score list, then sends what
  // changed between the list before and the list after.
  const UNDO_CALLS = [
    ['saveScores', CID, '<scores>'],
    ['persistScoreDiffToCanonical', CID, '<scores>', '<scores>'],
  ];
  // So each cell Undo puts back is sent twice: saveScores sends what
  // changed in the list, and then the tab sends the same change itself.
  const undoSends = cells => cells.concat(cells);

  describe('Undo', () => {
    const undo = () => MGrade.undoLastScore();
    const toast = () => document.getElementById('m-toast').textContent;

    it('after a first level: the entry goes, and a 0 is sent', () => {
      open(ESSAY);
      tap(level(AVA, QUESTION, 3));
      session.since();
      writers.since();
      undo();

      expect(writers.since()).toEqual(UNDO_CALLS);
      expect(entries(CID, AVA)).toEqual([]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.since()).toEqual(undoSends([tagScore(AVA, ESSAY, QUESTION, 0, 0)]));
      expect(toast()).toBe('Score reverted');
    });

    it('after a changed level: the entry goes back as it was, last in the student’s list', () => {
      open(ESSAY, {
        scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 2, { mod: -1 }), entry(AVA, ESSAY, PLAN, 4)] },
      });
      tap(level(AVA, QUESTION, 3));
      session.since();
      writers.since();
      undo();

      expect(writers.since()).toEqual(UNDO_CALLS);
      const was = { assessmentId: ESSAY, date: '2026-10-10', type: 'summative', note: '' };
      expect(entries(CID, AVA)).toEqual([
        { ...was, id: AVA + ':' + ESSAY + ':' + PLAN, tagId: PLAN, score: 4 },
        { ...was, id: AVA + ':' + ESSAY + ':' + QUESTION, tagId: QUESTION, score: 2, mod: -1 },
      ]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.since()).toEqual(undoSends([tagScore(AVA, ESSAY, QUESTION, 2, -1)]));
    });

    it('after a +: the level without it', () => {
      open(ESSAY, { scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 2)] } });
      tap(plusMinus(AVA, QUESTION, 1));
      session.since();
      writers.since();
      undo();

      expect(writers.since()).toEqual(UNDO_CALLS);
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 2 });
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.since()).toEqual(undoSends([tagScore(AVA, ESSAY, QUESTION, 2, 0)]));
    });

    it('after a clear: the level and its − go back', () => {
      open(ESSAY, { scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3, { mod: -1 })] } });
      tap(level(AVA, QUESTION, 3));
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 0 });
      session.since();
      writers.since();
      undo();

      expect(writers.since()).toEqual(UNDO_CALLS);
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: '3-' });
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.since()).toEqual(undoSends([tagScore(AVA, ESSAY, QUESTION, 3, -1)]));
    });

    it('twice walks back two levels; a third finds nothing and saves nothing', () => {
      open(ESSAY, { scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 2)] } });
      tap(level(AVA, QUESTION, 3));
      tap(level(AVA, QUESTION, 4));
      session.since();
      writers.since();

      undo();
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 3 });
      expect(session.since()).toEqual(undoSends([tagScore(AVA, ESSAY, QUESTION, 3, 0)]));
      undo();
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 2 });
      expect(session.since()).toEqual(undoSends([tagScore(AVA, ESSAY, QUESTION, 2, 0)]));
      expect(writers.since()).toEqual(UNDO_CALLS.concat(UNDO_CALLS));

      undo();
      expect(writers.since()).toEqual([]);
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 2 });
      expect(session.since()).toEqual([]);
    });

    it('after a rubric criterion’s + and its level: one step back each time', () => {
      open(LAB, { scores: { [AVA]: [entry(AVA, LAB, METHOD, 2)] } });
      tap(critLevel(AVA, METHOD, 3));
      tap(critPlusMinus(AVA, METHOD, 1));
      session.since();
      writers.since();

      undo();
      expect(levels(CID, AVA)).toEqual({ [METHOD]: 3 });
      expect(session.since()).toEqual(undoSends([rubricScore(AVA, LAB, METHOD, 3, 0)]));
      undo();
      expect(levels(CID, AVA)).toEqual({ [METHOD]: 2 });
      expect(session.since()).toEqual(undoSends([rubricScore(AVA, LAB, METHOD, 2, 0)]));
      expect(writers.since()).toEqual(UNDO_CALLS.concat(UNDO_CALLS));
      expect(storedMatchesCache('scores', CID)).toBe(true);
    });

    it('after a level in the Competencies view of rubric work: each criterion it wrote goes back', () => {
      open(LAB, { scores: { [AVA]: [entry(AVA, LAB, SAFETY, 2)] } });
      tap(view('tags'));
      tap(level(AVA, QUESTION, 3));
      expect(levels(CID, AVA)).toEqual({ [SAFETY]: 3, [METHOD]: 3 });
      session.since();
      writers.since();
      undo();

      expect(writers.since()).toEqual(UNDO_CALLS);
      // Safety had a 2; Method had no entry, and has none again.
      expect(levels(CID, AVA)).toEqual({ [SAFETY]: 2 });
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.since()).toEqual(
        undoSends([rubricScore(AVA, LAB, SAFETY, 2, 0), rubricScore(AVA, LAB, METHOD, 0, 0)]),
      );
    });

    it('after a tick that set a level: the level goes and the ticks stay', () => {
      open(LAB);
      openChecklist(AVA, SAFETY);
      tap(box(AVA, GOGGLES), true);
      tap(box(AVA, STATION), true);
      expect(levels(CID, AVA)).toEqual({ [SAFETY]: 3 });
      session.since();
      writers.since();
      undo();

      expect(writers.since()).toEqual(UNDO_CALLS);
      expect(entries(CID, AVA)).toEqual([]);
      expect(getRubricCheckIds(CID, AVA, LAB)).toEqual([GOGGLES, STATION]);
      expect(session.since()).toEqual(undoSends([rubricScore(AVA, LAB, SAFETY, 0, 0)]));
    });

    it('points, a status and a comment are not on the list: Undo after them does nothing', () => {
      open(QUIZ);
      typeAndLeave(points(AVA, QUIZ), '7');
      tap(pill(BEN, 'NS'));
      typeAndLeave(overall(CARA, QUIZ), 'Rewrite Friday');
      session.since();
      writers.since();
      undo();

      expect(writers.since()).toEqual([]);
      expect(getPointsScore(CID, AVA, QUIZ)).toBe(7);
      expect(statusOf(BEN, QUIZ)).toBe('NS');
      expect(getScoreComment(CID, CARA, QUIZ)).toBe('Rewrite Friday');
      expect(session.since()).toEqual([]);
    });

    it('a mark, and a tick that set no level, are not on the list either', () => {
      open(EXIT);
      tap(mark(AVA, 'complete'));
      session.since();
      writers.since();
      undo();
      expect(writers.since()).toEqual([]);
      expect(getCompletionMark(CID, AVA, EXIT)).toBe('complete');
      expect(session.since()).toEqual([]);
      writers.stop();
      session.signOut();
      clearClass(CID);

      open(LAB);
      openChecklist(AVA, SAFETY);
      tap(box(AVA, GOGGLES), true);
      session.since();
      writers.since();
      undo();
      expect(writers.since()).toEqual([]);
      expect(getRubricCheckIds(CID, AVA, LAB)).toEqual([GOGGLES]);
      expect(session.since()).toEqual([]);
    });

    it('a level, then Late: Undo takes the level off and leaves Late', () => {
      open(ESSAY);
      tap(level(AVA, QUESTION, 3));
      tap(pill(AVA, 'LATE'));
      session.since();
      writers.since();
      undo();

      expect(writers.since()).toEqual(UNDO_CALLS);
      expect(entries(CID, AVA)).toEqual([]);
      expect(statusOf(AVA, ESSAY)).toBe('LATE');
      expect(session.since()).toEqual(undoSends([tagScore(AVA, ESSAY, QUESTION, 0, 0)]));
    });

    it('a level cleared, then Missing: Undo puts no level back under Missing', () => {
      open(ESSAY, { scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3)] } });
      tap(level(AVA, QUESTION, 3));
      tap(pill(AVA, 'NS'));
      // Missing put a 0 under each competency.
      expect(levels(CID, AVA)).toEqual({ [QUESTION]: 0, [PLAN]: 0 });
      session.since();
      writers.since();
      undo();

      expect(writers.since()).toEqual(UNDO_CALLS);
      // The 3 stays off. The cleared entry goes; the other 0 stays.
      expect(levels(CID, AVA)).toEqual({ [PLAN]: 0 });
      expect(statusOf(AVA, ESSAY)).toBe('NS');
      expect(storedMatchesCache('scores', CID)).toBe(true);
      expect(session.since()).toEqual(undoSends([tagScore(AVA, ESSAY, QUESTION, 0, 0)]));
    });

    it('a level refused on Missing work is on the list all the same: Undo saves the list and sends nothing', () => {
      open(ESSAY, { statuses: { [BEN + ':' + ESSAY]: 'NS' } });
      tap(level(BEN, QUESTION, 3));
      session.since();
      writers.since();
      undo();

      expect(writers.since()).toEqual(UNDO_CALLS);
      expect(entries(CID, BEN)).toEqual([]);
      expect(session.since()).toEqual([]);
    });

    it('a first level, then an Overall Comment: Undo takes the entry off this device, comment and all', () => {
      open(ESSAY);
      tap(level(AVA, QUESTION, 3));
      typeAndLeave(overall(AVA, ESSAY), 'Good');
      session.since();
      writers.since();
      undo();

      expect(writers.since()).toEqual(UNDO_CALLS);
      expect(entries(CID, AVA)).toEqual([]);
      expect(getScoreComment(CID, AVA, ESSAY)).toBe('');
      expect(storedMatchesCache('scores', CID)).toBe(true);
      // The level is cleared on the server. Nothing is sent for the
      // comment, so the server still holds it.
      expect(session.since()).toEqual(undoSends([tagScore(AVA, ESSAY, QUESTION, 0, 0)]));
    });

    it('a changed level, then a criterion comment: Undo puts the entry back as it was, without the comment', () => {
      open(LAB, { scores: { [AVA]: [entry(AVA, LAB, METHOD, 2)] } });
      tap(critLevel(AVA, METHOD, 3));
      typeAndLeave(critComment(AVA, METHOD), 'Label the axes');
      session.since();
      writers.since();
      undo();

      expect(writers.since()).toEqual(UNDO_CALLS);
      expect(entries(CID, AVA).map(e => [e.tagId, e.score, e.critNote])).toEqual([[METHOD, 2, undefined]]);
      expect(storedMatchesCache('scores', CID)).toBe(true);
      // p_comment null leaves the server's comment as it is.
      expect(session.since()).toEqual(undoSends([rubricScore(AVA, LAB, METHOD, 2, 0)]));
    });

    describe('on pair work', () => {
      it('after the pair’s first level: both members’ entries go', () => {
        open(TALK);
        tap(level(AVA, QUESTION, 3));
        session.since();
        writers.since();
        undo();

        expect(writers.since()).toEqual(UNDO_CALLS);
        expect(entries(CID, AVA)).toEqual([]);
        expect(entries(CID, BEN)).toEqual([]);
        expect(storedMatchesCache('scores', CID)).toBe(true);
        expect(session.since()).toEqual(
          undoSends([tagScore(AVA, TALK, QUESTION, 0, 0), tagScore(BEN, TALK, QUESTION, 0, 0)]),
        );
      });

      it('after a changed level: both members go back to the level they had', () => {
        open(TALK, {
          scores: {
            [AVA]: [entry(AVA, TALK, QUESTION, 2, { date: '2026-10-16' })],
            [BEN]: [entry(BEN, TALK, QUESTION, 2, { date: '2026-10-16' })],
          },
        });
        tap(level(AVA, QUESTION, 3));
        expect(levels(CID, BEN)).toEqual({ [QUESTION]: 3 });
        session.since();
        writers.since();
        undo();

        expect(writers.since()).toEqual(UNDO_CALLS);
        expect(levels(CID, AVA)).toEqual({ [QUESTION]: 2 });
        expect(levels(CID, BEN)).toEqual({ [QUESTION]: 2 });
        expect(storedMatchesCache('scores', CID)).toBe(true);
        expect(session.since()).toEqual(
          undoSends([tagScore(AVA, TALK, QUESTION, 2, 0), tagScore(BEN, TALK, QUESTION, 2, 0)]),
        );
      });
    });
  });
});
