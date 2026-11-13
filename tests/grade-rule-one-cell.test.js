/**
 * The Draft and Returned rule looks at the cell a score write changed, not
 * at the whole class (docs/plans/one-mark-save-design.md, step 9).
 *
 * Before, every one-cell score writer (_upsertScoreOne, the three comment
 * writers) read the class's whole saved copy back from localStorage and
 * compared every cell of it with memory to find the one that changed. Now
 * the writer hands the rule its cell's entries as they were, and the rule
 * compares that cell alone, whenever the saved copy is this tab's own
 * (_savedScoresAreMine). In every other case the whole class is compared
 * with the saved copy, as before.
 *
 * What is held here:
 * - The two ways give the same rows. Each scenario is played twice on the
 *   same class with the same clock: once as before (the whole class,
 *   reached by calling _gradeBefore without a cell, which is the code the
 *   whole-list saves still run) and once as now. After every step the two
 *   must hold the same Draft and Returned rows in memory and in
 *   localStorage, the same scores, and have sent the same calls with the
 *   same contents in the same order.
 * - The new way is the one in use: a plain score click takes it.
 * - It is not used when this tab's memory and the saved copy have parted:
 *   a group copy in the middle of its save, a save the guard refused, a
 *   write the browser's storage refused, another tab's write, a saved copy
 *   that is gone, rubric keys moved in memory, a rubric score kept under a
 *   competency (which a read of the saved copy would move). Those compare
 *   the whole class, so they too give the rows they gave before.
 * - One score click no longer reads the saved copy or looks at any other
 *   cell: counted.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, signIn, seedClass, clearClass, settle, serverSaysStudentPageOn } from './helpers/pin-save-paths.js';

const CID = U(1);
const S = [U(11), U(12), U(13), U(14), U(15)];
const T = [U(41), U(42)];
const RUB = U(60);
const C = [U(61), U(62)];
const K = [U(71), U(72)];
const ESSAY = { id: U(31), title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: T };
const QUIZ = { id: U(32), title: 'Quiz', date: '2026-10-12', scoreMode: 'points', maxPoints: 10, tagIds: T };
const DONE = { id: U(33), title: 'Reading Log', date: '2026-10-13', scoreMode: 'complete', tagIds: [T[0]] };
const LAB = { id: U(34), title: 'Lab', date: '2026-10-14', type: 'summative', tagIds: [], rubricId: RUB };
const TALK = {
  id: U(35),
  title: 'Talk',
  date: '2026-10-15',
  type: 'summative',
  tagIds: [T[0]],
  collaboration: 'pair',
  pairs: [[S[0], S[1]]],
};
const TRIO = {
  id: U(36),
  title: 'Debate',
  date: '2026-10-16',
  type: 'summative',
  tagIds: [T[0]],
  collaboration: 'group',
  groups: [[S[0], S[1], S[2]]],
};
const BENCH = { id: U(37), title: 'Reading Benchmark', date: '2026-10-17', scoreMode: 'dibels', tagIds: [] };
const WORK = [ESSAY, QUIZ, DONE, LAB, TALK, TRIO, BENCH];
const RUBRIC = {
  id: RUB,
  name: 'Lab Report',
  criteria: [
    {
      id: C[0],
      name: 'Method',
      tagIds: [T[0]],
      levels: {},
      checks: [{ id: K[0], level: 3, label: 'Lists every step' }],
    },
    { id: C[1], name: 'Safety', tagIds: [T[1]], levels: {}, checks: [{ id: K[1], level: 3, label: 'Wears goggles' }] },
  ],
};
const HOLDS = { student_page_enabled: true, return_grades: 'on_return' };
const AT_ONCE = { student_page_enabled: true, return_grades: 'on_save' };
const SCORES_KEY = 'gb-scores-' + CID;
const ROWS_KEY = 'gb-grade-returns-' + CID;
const T0 = Date.parse('2026-11-09T18:00:00.000Z');

/* ── What a teacher does, as the data layer hears it ───────────────── */
const level = (sid, a, tid, value, mod) => upsertScore(CID, sid, a.id, tid, value, a.date, 'summative', '', mod || 0);
const points = (sid, a, value) => setPointsScore(CID, sid, a.id, value);
const mark = (sid, a, m) => setCompletionMark(CID, sid, a.id, m);
const comment = (sid, a, text) => saveScoreComment(CID, sid, a.id, text);
const tagComment = (sid, a, tid, text) => saveTagComment(CID, sid, a.id, tid, text);
const critComment = (sid, a, cid, text) => saveRubricCriterionComment(CID, sid, a.id, cid, text);
const beyond = (sid, a, cid, text) => saveRubricCriterionBeyond(CID, sid, a.id, cid, text);
const tick = (sid, a, id, on) => setRubricCheck(CID, sid, a.id, id, on);
const status = (sid, a, st) => setAssignmentStatus(CID, sid, a.id, st);
const give = (a, ...sids) => returnGrades(CID, a.id, sids);
const reportNote = (sid, a, text) => saveScoreReportNote(CID, sid, a.id, text);
const stored = a => _assessmentById(CID, a.id);
// Clear Score, as the gradebook's cell menu does it.
const clearCell = (sid, a) => Grader.clearScore(CID, getScores(CID), sid, stored(a), scoreTagIds(stored(a), CID));
// Cmd+Z of one cell: its entries go back to `entries`, and the list is saved.
function putBack(sid, a, entries) {
  const before = structuredClone(getScores(CID));
  const scores = getScores(CID);
  scores[sid] = (scores[sid] || []).filter(e => e.assessmentId !== a.id).concat(structuredClone(entries));
  Grader.undoCell(CID, sid, a.id, before, scores);
}
const cellNow = (sid, a) => structuredClone((getScores(CID)[sid] || []).filter(e => e.assessmentId === a.id));
// A fill and its Undo, as the Assignments page does them.
function fillThenUndo(a, tid, value) {
  const before = structuredClone(getScores(CID));
  S.forEach(sid => level(sid, a, tid, value));
  Grader.undo(CID, before, structuredClone(getScores(CID)));
}

/* ── Playing a scenario one way ────────────────────────────────────── */
let session = null;
let realBefore = null;
let realRefresh = null;
let realSetItem = null;
let realToast = null;
let paths = []; // which way each one-cell score write took: 'cell', 'whole', or 'off'

function seed(config) {
  localStorage.clear();
  clearClass(CID);
  _serverState = {};
  _localWrites = {};
  _keptText = {};
  _scoresApart = {};
  seedClass(CID, {
    students: S.map((id, i) => ({ id, firstName: ['Jordan', 'Avery', 'Noor', 'Lena', 'Sam'][i], lastName: 'Test' })),
    assessments: WORK.map(a => structuredClone(a)),
    rubrics: [structuredClone(RUBRIC)],
    courseConfigs: config,
  });
}

// Scores without what differs between two plays for no reason: an entry's made-up id.
function plain(scores) {
  const out = {};
  Object.keys(scores || {}).forEach(sid => {
    out[sid] = (scores[sid] || []).map(e => {
      const copy = { ...e };
      delete copy.id;
      return copy;
    });
  });
  return JSON.stringify(out);
}

/* Play `steps` on a fresh class. `way` is 'whole' (as before: the rule is
   never told the cell) or 'cell' (as now). Answers what the class held
   after each step. */
async function play(way, opts, steps) {
  vi.setSystemTime(new Date(T0));
  seed(opts.config || HOLDS);
  let refreshes = 0;
  if (opts.signedIn) {
    session = signIn();
    serverSaysStudentPageOn(CID);
    _loadGradeReturns(CID, {});
    // The read of the server's rows that follows a change is counted, not made.
    globalThis._refreshGradeReturnsSoon = () => {
      refreshes++;
      return Promise.resolve();
    };
  }
  paths = [];
  globalThis._gradeBefore = function (cid, field, sid, aid, entries) {
    const out = way === 'whole' ? realBefore(cid, field) : realBefore(cid, field, sid, aid, entries);
    if (field === 'scores' && entries) paths.push(!out ? 'off' : out.cells ? 'cell' : 'whole');
    return out;
  };
  const seen = [];
  for (let i = 0; i < steps.length; i++) {
    vi.setSystemTime(new Date(T0 + (i + 1) * 60000));
    const answer = steps[i]();
    await settle(3);
    seen.push({
      step: i,
      answer: answer === undefined || typeof answer === 'object' ? null : answer,
      rows: localStorage.getItem(ROWS_KEY),
      memory: JSON.stringify(getGradeReturns(CID)),
      scores: plain(getScores(CID)),
      savedScores: plain(JSON.parse(localStorage.getItem(SCORES_KEY) || '{}')),
      sent: session ? session.since() : null,
      refreshes,
    });
  }
  const took = paths.slice();
  stop();
  return { seen, took };
}

function stop() {
  globalThis._gradeBefore = realBefore;
  globalThis._refreshGradeReturnsSoon = realRefresh;
  localStorage.setItem = realSetItem;
  globalThis.showSyncToast = realToast;
  if (session) {
    session.signOut();
    session = null;
    serverSaysStudentPageOn(CID, false);
  }
}

/* The same steps both ways: every step must leave the same class. */
async function bothWays(opts, steps) {
  const whole = await play('whole', opts, steps);
  const cell = await play('cell', opts, steps);
  expect(whole.took.indexOf('cell'), 'the play "as before" took the new way').toBe(-1);
  for (let i = 0; i < steps.length; i++) expect(cell.seen[i], 'after step ' + (i + 1)).toEqual(whole.seen[i]);
  return cell;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  realBefore = globalThis._gradeBefore;
  realRefresh = globalThis._refreshGradeReturnsSoon;
  realSetItem = localStorage.setItem;
  realToast = globalThis.showSyncToast;
});
afterEach(() => {
  stop();
  vi.useRealTimers();
  clearClass(CID);
  localStorage.clear();
});

/* ── The scenarios ─────────────────────────────────────────────────── */
const SCENARIOS = {
  'a level, a +, a −, another level and a clear': () => [
    () => level(S[0], ESSAY, T[0], 3),
    () => level(S[0], ESSAY, T[0], 3, 1),
    () => level(S[0], ESSAY, T[0], 3, -1),
    () => level(S[0], ESSAY, T[1], 2),
    () => level(S[0], ESSAY, T[0], 4),
    () => level(S[0], ESSAY, T[0], 4), // the same save again
    () => level(S[0], ESSAY, T[0], 0),
    () => level(S[0], ESSAY, T[1], 0),
    () => level(S[3], ESSAY, T[0], 1),
  ],
  'points, Complete and Incomplete': () => [
    () => points(S[0], QUIZ, 7),
    () => points(S[0], QUIZ, 0),
    () => points(S[1], QUIZ, 10),
    () => points(S[0], QUIZ, null),
    () => mark(S[2], DONE, 'complete'),
    () => mark(S[2], DONE, 'incomplete'),
    () => mark(S[2], DONE, null),
    () => level(S[2], ESSAY, T[0], 3), // a level after whole-list saves
    () => points(S[2], QUIZ, 4),
    () => level(S[2], ESSAY, T[0], 2),
  ],
  'rubric criteria, their comments, Went Beyond and ticks': () => [
    () => level(S[0], LAB, C[0], 3),
    () => level(S[0], LAB, C[1], 2, 1),
    () => critComment(S[0], LAB, C[0], 'Number your steps.'),
    () => beyond(S[0], LAB, C[1], 'Checked the fume hood.'),
    () => tick(S[0], LAB, K[0], true),
    () => level(S[0], LAB, C[0], 4),
    () => critComment(S[0], LAB, C[0], ''),
    () => tick(S[0], LAB, K[0], false),
    () => beyond(S[1], LAB, C[0], 'A note with no level yet.'),
    () => level(S[1], LAB, C[0], 2),
  ],
  'comments: Overall, a competency’s, and the Note for the Report': () => [
    () => comment(S[1], ESSAY, 'A comment with no level yet.'),
    () => level(S[1], ESSAY, T[0], 3),
    () => tagComment(S[1], ESSAY, T[0], 'Cite the page.'),
    () => reportNote(S[1], ESSAY, 'linked the poster to the Act'),
    () => comment(S[1], ESSAY, 'Clear and well argued.'),
    () => comment(S[1], ESSAY, ''),
    () => tagComment(S[1], ESSAY, T[0], ''),
    () => tagComment(S[2], ESSAY, T[1], 'A comment with no level yet.'),
    () => comment(S[3], QUIZ, 'On points work.'),
    () => comment(S[3], BENCH, 'On a benchmark: never a row.'),
  ],
  'a draft, returned, regraded, put back and returned again': () => [
    () => level(S[0], ESSAY, T[0], 3),
    () => give(ESSAY, S[0]),
    () => level(S[0], ESSAY, T[0], 4), // a regrade of a returned grade
    () => level(S[0], ESSAY, T[0], 3), // put back to what was returned
    () => level(S[0], ESSAY, T[0], 2, 1),
    () => comment(S[0], ESSAY, 'Regraded after our talk.'),
    () => give(ESSAY, S[0]),
    () => level(S[0], ESSAY, T[1], 1),
    () => level(S[0], ESSAY, T[0], 0),
    () => level(S[0], ESSAY, T[1], 0), // a returned grade, cleared
    () => give(ESSAY, S[0]),
    () => level(S[1], ESSAY, T[0], 2), // a draft never returned
    () => level(S[1], ESSAY, T[0], 0), // and cleared
  ],
  'Missing and Excused': () => [
    () => level(S[0], ESSAY, T[0], 3),
    () => give(ESSAY, S[0]),
    () => status(S[1], ESSAY, 'NS'),
    () => level(S[1], ESSAY, T[0], 3), // refused under Missing
    () => status(S[1], ESSAY, ''),
    () => level(S[1], ESSAY, T[0], 3),
    () => status(S[2], ESSAY, 'EXC'),
    () => comment(S[2], ESSAY, 'Away for the unit.'),
    () => status(S[2], ESSAY, 'LATE'),
    () => level(S[2], ESSAY, T[0], 2),
    () => applyAssignmentStatus(CID, S[3], ESSAY.id, 'NS'),
  ],
  'pair work and a group of three': () => [
    () => level(S[0], TALK, T[0], 3), // copies to the partner
    () => give(TALK, S[0], S[1]),
    () => level(S[1], TALK, T[0], 4), // the partner regrades both
    () => comment(S[0], TALK, 'Shared the talking well.'),
    () => comment(S[0], TALK, ''),
    () => level(S[0], TRIO, T[0], 2),
    () => tagComment(S[2], TRIO, T[0], 'Rebut the other side.'),
    () => give(TRIO, S[0], S[1], S[2]),
    () => level(S[1], TRIO, T[0], 3, 1),
    () => tagComment(S[0], TRIO, T[0], ''),
    () => setGradedSeparately(CID, TRIO.id, S[2], true),
    () => level(S[2], TRIO, T[0], 1),
    () => level(S[0], TRIO, T[0], 4),
    () => setGradedSeparately(CID, TRIO.id, S[2], false),
    () => status(S[1], TRIO, 'EXC'),
    () => level(S[0], TRIO, T[0], 3),
    () => status(S[1], TRIO, ''),
  ],
  'Clear Score, its Undo, and a fill with its Undo': () => {
    let was = null;
    return [
      () => level(S[0], ESSAY, T[0], 3),
      () => level(S[0], ESSAY, T[1], 4, -1),
      () => comment(S[0], ESSAY, 'Stays through Clear Score.'),
      () => give(ESSAY, S[0]),
      () => {
        was = cellNow(S[0], ESSAY);
        return clearCell(S[0], ESSAY);
      },
      () => level(S[1], ESSAY, T[0], 2), // a level after a whole-list save
      () => putBack(S[0], ESSAY, was),
      () => fillThenUndo(ESSAY, T[1], 3),
      () => level(S[4], ESSAY, T[1], 1),
      () => {
        const before = structuredClone(getScores(CID));
        S.forEach(sid => points(sid, QUIZ, 5));
        return Grader.undo(CID, before, structuredClone(getScores(CID)));
      },
    ];
  },
};

const KINDS = [
  ['a class that holds grades, on this device', { config: HOLDS }],
  ['a class that returns each save, on this device', { config: AT_ONCE }],
  ['a class that holds grades, signed in', { config: HOLDS, signedIn: true }],
  ['a class that returns each save, signed in', { config: AT_ONCE, signedIn: true }],
];

describe('the rule on one cell gives the rows the whole-class comparison gave', () => {
  KINDS.forEach(([kind, opts]) => {
    describe(kind, () => {
      Object.keys(SCENARIOS).forEach(name => {
        it(name, async () => {
          const out = await bothWays(opts, SCENARIOS[name]());
          expect(out.took, 'no one-cell score write took the new way').toContain('cell');
          // Something was kept: the comparison is not of two empty classes.
          expect(out.seen.some(s => s.rows && s.rows !== '{}')).toBe(true);
        });
      });
    });
  });

  it('every one-cell score write on its own takes the new way', async () => {
    const out = await bothWays({ config: HOLDS }, SCENARIOS['a level, a +, a −, another level and a clear']());
    expect(out.took.length).toBeGreaterThan(5);
    expect(out.took.every(p => p === 'cell')).toBe(true);
  });

  it('a signed-in play sends calls, and the same ones', async () => {
    const out = await bothWays(
      { config: HOLDS, signedIn: true },
      SCENARIOS['a draft, returned, regraded, put back and returned again'](),
    );
    const names = out.seen.flatMap(s => s.sent.map(c => c[0]));
    expect(names).toContain('upsert_tag_score');
    expect(names).toContain('return_grades');
    expect(out.seen[out.seen.length - 1].refreshes).toBeGreaterThan(0);
  });

  it('with the student page off no rows are kept either way', async () => {
    const out = await bothWays({ config: {} }, SCENARIOS['a level, a +, a −, another level and a clear']());
    expect(out.took.every(p => p === 'off')).toBe(true);
    expect(out.seen.every(s => s.rows === null)).toBe(true);
  });
});

/* A long run of whatever a teacher might do, in an order nobody chose. */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomSteps(seed, count) {
  const rnd = mulberry(seed);
  const pick = list => list[Math.floor(rnd() * list.length)];
  const words = ['', 'Good.', 'Say more here.', 'See me.'];
  const steps = [];
  for (let i = 0; i < count; i++) {
    const sid = pick(S);
    const roll = rnd();
    if (roll < 0.26) {
      const a = pick([ESSAY, ESSAY, TALK, TRIO]);
      const tid = a === ESSAY ? pick(T) : T[0];
      const value = pick([0, 1, 2, 3, 4]);
      const mod = pick([0, 0, 1, -1]);
      steps.push(() => level(sid, a, tid, value, mod));
    } else if (roll < 0.35) {
      const cid = pick(C);
      const value = pick([0, 1, 2, 3, 4]);
      steps.push(() => level(sid, LAB, cid, value));
    } else if (roll < 0.36) {
      // Rubric work scored under a competency, as the gradebook's Competencies view can.
      const tid = pick(T);
      const value = pick([1, 2, 3, 4]);
      steps.push(() => level(sid, LAB, tid, value));
    } else if (roll < 0.44) {
      const value = pick([null, 0, 3, 7, 10]);
      steps.push(() => points(sid, QUIZ, value));
    } else if (roll < 0.5) {
      const m = pick([null, 'complete', 'incomplete']);
      steps.push(() => mark(sid, DONE, m));
    } else if (roll < 0.58) {
      const a = pick([ESSAY, QUIZ, LAB, TALK, TRIO]);
      const text = pick(words);
      steps.push(() => comment(sid, a, text));
    } else if (roll < 0.64) {
      const a = pick([ESSAY, TRIO]);
      const text = pick(words);
      steps.push(() => tagComment(sid, a, T[0], text));
    } else if (roll < 0.7) {
      const cid = pick(C);
      const text = pick(words);
      const fn = pick([critComment, beyond]);
      steps.push(() => fn(sid, LAB, cid, text));
    } else if (roll < 0.75) {
      const id = pick(K);
      const on = rnd() < 0.6;
      steps.push(() => tick(sid, LAB, id, on));
    } else if (roll < 0.83) {
      const a = pick([ESSAY, QUIZ, LAB, TALK, TRIO]);
      const st = pick(['NS', 'EXC', 'LATE', '', '']);
      steps.push(() => status(sid, a, st));
    } else if (roll < 0.93) {
      const a = pick([ESSAY, QUIZ, DONE, LAB, TALK, TRIO]);
      const who = S.filter(() => rnd() < 0.6);
      steps.push(() => give(a, ...who).returned);
    } else if (roll < 0.96) {
      const a = pick([ESSAY, LAB, QUIZ]);
      steps.push(() => clearCell(sid, a));
    } else if (roll < 0.975) {
      const value = pick([1, 2, 3, 4]);
      steps.push(() => fillThenUndo(ESSAY, T[1], value));
    } else if (roll < 0.985) {
      // The Essay is given the rubric, or loses it: its scores move keys.
      steps.push(() => {
        const list = getAssessments(CID);
        const essay = list.find(a => a.id === ESSAY.id);
        essay.rubricId = essay.rubricId ? '' : RUB;
        saveAssessments(CID, list);
      });
    } else if (roll < 0.99) {
      const tid = pick(C);
      const value = pick([1, 2, 3, 4]);
      steps.push(() => level(sid, ESSAY, tid, value));
    } else {
      const text = pick(words);
      steps.push(() => reportNote(sid, ESSAY, text));
    }
  }
  return steps;
}

describe('a long run in no chosen order gives the same rows both ways', () => {
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(seed => {
    it('seed ' + seed + ', a class that ' + (seed % 2 ? 'holds grades' : 'returns each save'), async () => {
      const opts = { config: seed % 2 ? HOLDS : AT_ONCE, signedIn: seed > 6 };
      const out = await bothWays(opts, randomSteps(seed, 300));
      expect(out.took.filter(p => p === 'cell').length).toBeGreaterThan(10);
    });
  });
});

/* ── Where the new way must not be taken ───────────────────────────── */
describe('when memory and the saved copy have parted, the whole class is compared, as before', () => {
  it('a group of three: a copy made in memory is seen by the next member’s comment save', async () => {
    let was = null;
    const steps = [
      () => level(S[0], TRIO, T[0], 3),
      () => give(TRIO, S[0], S[1], S[2]),
      () => {
        was = cellNow(S[0], TRIO);
        return level(S[0], TRIO, T[0], 4);
      },
      () => tagComment(S[0], TRIO, T[0], 'Rebut the other side.'),
      // Cmd+Z on the first member: level 3 and no comment go back in one whole-list save. The copy to
      // the second member is made in memory, then the third member's comment is cleared by a one-cell save.
      () => putBack(S[0], TRIO, was),
    ];
    const out = await bothWays({ config: HOLDS }, steps);
    expect(out.took[out.took.length - 1]).toBe('whole');
    const rows = JSON.parse(out.seen[out.seen.length - 1].rows)[TRIO.id];
    // Each member is back at the grade that was returned: no draft is left on any of them.
    S.slice(0, 3).forEach(sid => {
      expect(rows[sid].is_draft, sid).toBe(false);
      expect(rows[sid].returned_copy, sid).toBeUndefined();
      expect(GradeState.stateOf(CID, sid, TRIO.id)).toBe('returned');
    });
    expect(JSON.parse(out.seen[3].rows)[TRIO.id][S[1]].is_draft).toBe(true);
  });

  it('a save the guard refused leaves memory changed: the next level compares the whole class', async () => {
    const steps = [
      ...S.map(sid => () => level(sid, ESSAY, T[0], 3)),
      ...S.map(sid => () => level(sid, ESSAY, T[1], 2)),
      () => level(S[0], LAB, C[0], 3),
      () => give(ESSAY, ...S),
      () => {
        // A whole-list save of this tab's own list with four of five students gone: refused.
        globalThis.showSyncToast = () => {}; // the red message has no page to show on here
        const scores = getScores(CID);
        S.slice(1).forEach(sid => delete scores[sid]);
        scores[S[0]].find(e => e.assessmentId === ESSAY.id && e.tagId === T[0]).score = 1;
        return saveScores(CID, scores);
      },
      () => level(S[0], ESSAY, T[1], 4),
      () => level(S[0], ESSAY, T[1], 3),
    ];
    const out = await bothWays({ config: HOLDS }, steps);
    expect(out.seen[12].answer).toBe(false);
    expect(out.took.slice(-2)).toEqual(['whole', 'cell']);
    // The change the refused save left in memory was seen: that returned grade is a draft.
    const rows = JSON.parse(out.seen[13].rows)[ESSAY.id];
    expect(rows[S[0]].is_draft).toBe(true);
    expect(rows[S[0]].returned_copy.tags[T[0]].value).toBe(3);
  });

  it('a write the browser’s storage refused: the next level compares the whole class', async () => {
    let full = false;
    const steps = [
      () => level(S[0], ESSAY, T[0], 3),
      () => give(ESSAY, S[0]),
      () => {
        full = true;
        localStorage.setItem = function (k) {
          if (full && k === SCORES_KEY) {
            const e = new Error('full');
            e.name = 'QuotaExceededError';
            throw e;
          }
          return realSetItem.apply(localStorage, arguments);
        };
        return level(S[0], ESSAY, T[0], 4);
      },
      () => level(S[1], ESSAY, T[0], 2),
      () => {
        full = false;
        return level(S[2], ESSAY, T[0], 1);
      },
      () => level(S[3], ESSAY, T[0], 1),
    ];
    const out = await bothWays({ config: HOLDS }, steps);
    expect(out.seen[2].answer).toBe(false);
    expect(out.took).toEqual(['cell', 'cell', 'whole', 'whole', 'cell']);
  });

  it('another tab wrote the saved copy: the whole class is compared', async () => {
    const steps = [
      () => level(S[0], ESSAY, T[0], 3),
      () => level(S[1], ESSAY, T[0], 2),
      () => give(ESSAY, S[0], S[1]),
      () => {
        // The other tab, which holds the same class, regrades a student and saves its whole list.
        const theirs = JSON.parse(localStorage.getItem(SCORES_KEY));
        theirs[S[1]][0].score = 4;
        theirs[S[4]] = [{ ...theirs[S[0]][0], id: 'x', score: 1 }];
        realSetItem.call(localStorage, SCORES_KEY, JSON.stringify(theirs));
      },
      () => level(S[0], ESSAY, T[0], 4),
      () => level(S[0], ESSAY, T[1], 2),
    ];
    const out = await bothWays({ config: HOLDS }, steps);
    expect(out.took).toEqual(['cell', 'cell', 'whole', 'cell']);
  });

  it('the saved copy is gone: the whole class is compared', async () => {
    const steps = [
      () => level(S[0], ESSAY, T[0], 3),
      () => level(S[1], ESSAY, T[0], 2),
      () => give(ESSAY, S[0], S[1]),
      () => localStorage.removeItem(SCORES_KEY),
      () => level(S[0], ESSAY, T[1], 4),
      () => level(S[0], ESSAY, T[1], 2),
    ];
    const out = await bothWays({ config: HOLDS }, steps);
    expect(out.took).toEqual(['cell', 'cell', 'whole', 'cell']);
  });

  it('work given a rubric moves its old keys in memory: the whole class is compared once', async () => {
    const steps = [
      () => level(S[0], ESSAY, T[0], 3),
      () => level(S[0], ESSAY, T[1], 2),
      () => give(ESSAY, S[0]),
      () => {
        const list = getAssessments(CID);
        list.find(a => a.id === ESSAY.id).rubricId = RUB;
        saveAssessments(CID, list);
      },
      () => level(S[0], ESSAY, C[0], 4),
      () => level(S[0], ESSAY, C[1], 1),
    ];
    const out = await bothWays({ config: HOLDS }, steps);
    expect(out.took).toEqual(['cell', 'cell', 'whole', 'cell']);
  });

  it('a level saved under a competency on rubric work: the saved copy reads it under the criterion', async () => {
    const steps = [
      () => level(S[0], LAB, C[0], 3),
      () => give(LAB, S[0]),
      // The gradebook's Competencies view can score rubric work under a competency. Memory keeps the
      // entry there; the saved copy, read back, has it moved under the criterion.
      () => level(S[0], LAB, T[1], 2),
      () => level(S[1], ESSAY, T[0], 3),
      () => level(S[1], ESSAY, T[0], 4),
      () => give(LAB, S[0]),
      () => level(S[2], ESSAY, T[0], 1),
    ];
    const out = await bothWays({ config: HOLDS }, steps);
    // From that save on, every one-cell write compares the whole class, as it did before.
    expect(out.took).toEqual(['cell', 'whole', 'whole', 'whole', 'whole']);
  });

  it('a class with nothing kept for it compares the whole class until its first save', async () => {
    const steps = [
      () => {
        delete _keptText[SCORES_KEY];
      },
      () => level(S[0], ESSAY, T[0], 3),
      () => level(S[0], ESSAY, T[0], 4),
    ];
    const out = await bothWays({ config: HOLDS }, steps);
    expect(out.took).toEqual(['whole', 'cell']);
  });
});

/* ── Counted ───────────────────────────────────────────────────────── */
describe('one score click, counted, on a class of 30 students and 36 pieces', () => {
  const IDS = Array.from({ length: 30 }, (_, i) => U(100 + i));
  const AIDS = Array.from({ length: 36 }, (_, i) => U(300 + i));

  function seedBig() {
    localStorage.clear();
    clearClass(CID);
    const scores = {};
    IDS.forEach((sid, s) => {
      scores[sid] = [];
      AIDS.forEach((aid, a) =>
        T.forEach((tid, k) =>
          scores[sid].push({
            id: 'e' + s + '-' + a + '-' + k,
            assessmentId: aid,
            tagId: tid,
            score: 1 + ((s + a + k) % 4),
            date: '2026-10-02',
            type: 'summative',
            note: '',
            created: '2026-10-02T12:00:00.000Z',
          }),
        ),
      );
    });
    seedClass(CID, {
      students: IDS.map((id, i) => ({ id, firstName: 'First' + i, lastName: 'Last' + i })),
      assessments: AIDS.map((id, i) => ({ id, title: 'Piece ' + i, tagIds: T, date: '2026-10-01', type: 'summative' })),
      scores,
      courseConfigs: HOLDS,
    });
  }

  /* One level click, with the meter on: how many characters went through
     JSON.parse (and the longest text parsed), how many grades the rule
     worked out (_gradeOf), and how many times the saved copy of the scores
     was read. */
  function countedClick(way) {
    seedBig();
    const real = { parse: JSON.parse, gradeOf: globalThis._gradeOf, getItem: localStorage.getItem };
    const count = { parsed: 0, longest: 0, grades: 0, reads: 0 };
    if (way === 'whole') globalThis._gradeBefore = (cid, field) => realBefore(cid, field);
    JSON.parse = function (text) {
      if (typeof text === 'string') {
        count.parsed += text.length;
        count.longest = Math.max(count.longest, text.length);
      }
      return real.parse.apply(JSON, arguments);
    };
    globalThis._gradeOf = function () {
      count.grades++;
      return real.gradeOf.apply(this, arguments);
    };
    localStorage.getItem = function (k) {
      if (k === SCORES_KEY) count.reads++;
      return real.getItem.apply(localStorage, arguments);
    };
    try {
      const was = getScores(CID)[IDS[2]].find(e => e.assessmentId === AIDS[1] && e.tagId === T[0]).score;
      expect(upsertScore(CID, IDS[2], AIDS[1], T[0], was === 4 ? 3 : 4, '2026-10-01', 'summative', '')).toBe(true);
    } finally {
      JSON.parse = real.parse;
      globalThis._gradeOf = real.gradeOf;
      localStorage.getItem = real.getItem;
      globalThis._gradeBefore = realBefore;
    }
    count.row = getGradeReturn(CID, IDS[2], AIDS[1]);
    count.saved = localStorage.getItem(SCORES_KEY).length;
    return count;
  }

  it('before: the whole saved copy was parsed and every cell’s grade worked out twice', () => {
    const count = countedClick('whole');
    expect(count.longest).toBeGreaterThan(300000);
    expect(count.parsed).toBeGreaterThanOrEqual(count.saved - 10);
    expect(count.grades).toBe(2 * 30 * 36);
    expect(count.row.is_draft).toBe(true);
  });

  it('now: the saved copy is not parsed, and two grades are worked out: the cell before and after', () => {
    const count = countedClick('cell');
    expect(count.saved).toBeGreaterThan(300000);
    // All that is parsed is the class's small saved-copy record, not its scores.
    expect(count.parsed).toBeLessThan(1000);
    expect(count.longest).toBeLessThan(1000);
    expect(count.grades).toBe(2);
    // The saved copy is read once, as text, to see that it is still this tab's own. It is not parsed.
    expect(count.reads).toBe(1);
    expect(count.row).toEqual(countedClick('whole').row);
    expect(count.row.is_draft).toBe(true);
  });
});
