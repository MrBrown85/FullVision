/**
 * Same-date work counts in assignment-list order (S0-F1d, rule A).
 *
 * Colin, 2026-11-09, "Order in the assignment list": when two pieces of work
 * on the same competency have the same date, they count in the order they
 * sit in the class's assignment list, whatever order they were graded in.
 *
 * Before, shared/calc.js sorted evidence by date alone and a tie fell to
 * where each score sat in the student's score list, so re-entering a score
 * (which moves it to the end of that list) could change Most Recent, Mode's
 * tie, Decaying Average and the trend.
 *
 * The order, as calc.js now reads it:
 *   1. by date;
 *   2. same date: the piece higher in the Assignments list counts first, the
 *      one below it later (so the lower one is the "most recent"). The list
 *      is ordered by display_order (a teacher's drag sets 1..n; a piece never
 *      dragged is 0 and sits first), then, for same-date pieces, by the
 *      order the pieces are stored in, which is the order they were made;
 *   3. the scores of one piece: in the order the piece lists what it
 *      measures (its competencies, or its rubric's criteria);
 *   never by position in the score list.
 *
 * Neither golden class has two pieces with the same date, so the golden
 * file cannot see this rule: the small class below pins it by hand. The
 * property test at the end then shuffles every student's score list in the
 * Demo class and the eval fixture and gets the golden file back, byte for
 * byte, in all work and in returned-only grades.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, GOLDEN, canonical, loadDemoClass, loadEvalClass, recordClass } from './helpers/golden-grades.js';

/* ── A small class: three pieces on one day ──────────────────── */

const CID = 'course-order';
const DAY = '2026-10-05';
const METHODS = ['mostRecent', 'highest', 'average', 'median', 'mode', 'decayingAvg'];

// Every order a list can be in.
function orders(list) {
  if (list.length < 2) return [list.slice()];
  const out = [];
  list.forEach((item, i) => {
    orders(list.slice(0, i).concat(list.slice(i + 1))).forEach(rest => out.push([item].concat(rest)));
  });
  return out;
}

let pieces;
function piece(id, extra) {
  return Object.assign(
    { id, title: id, scoreMode: 'proficiency', tagIds: ['T1'], date: DAY, categoryId: 'cat', display_order: 0 },
    extra,
  );
}
const score = (assessmentId, level, extra) =>
  Object.assign({ assessmentId, tagId: 'T1', score: level, date: DAY }, extra);

function seed(list, method, config) {
  pieces = list;
  COURSES[CID] = { id: CID, name: 'Science 9', gradingSystem: 'proficiency', levelOrder: 'asc' };
  _cache.students[CID] = [{ id: 'sam', firstName: 'Sam', lastName: 'Test' }];
  _cache.assessments[CID] = pieces;
  _cache.scores[CID] = { sam: [] };
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.categories[CID] = [{ id: 'cat', name: 'Work', weight: 100 }];
  _cache.learningMaps[CID] = {
    _flatVersion: 2,
    subjects: [{ id: 'SUB', name: 'Science 9' }],
    sections: [
      { id: 'S1', subject: 'SUB', name: 'Inquiry', tags: [{ id: 'T1', label: 'Inquiry' }] },
      { id: 'S2', subject: 'SUB', name: 'Method', tags: [{ id: 'T2', label: 'Method' }] },
    ],
  };
  _cache.courseConfigs[CID] = Object.assign({ calcMethod: method || 'mostRecent', decayWeight: 0.65 }, config);
  setActiveTerm(CID, null);
  clearProfCache();
}
function drop() {
  delete globalThis.getReturnedScores;
  _scoreSet = 'all';
  delete COURSES[CID];
  localStorage.clear();
  clearProfCache();
}
// Sam's score list in the order given, read from cold caches.
function graded(list) {
  _cache.scores[CID] = { sam: list };
  clearProfCache();
}
const level = () => getTagProficiency(CID, 'sam', 'T1');
const setMethod = method => {
  _cache.courseConfigs[CID].calcMethod = method;
  clearProfCache();
};

describe('same-date pieces count in assignment-list order', () => {
  afterEach(drop);

  // The list: A, then B, then C. Scores: A 1, B 4, C 2.
  const A = () => score('A', 1);
  const B = () => score('B', 4);
  const C = () => score('C', 2);

  /* By hand, in list order:
     two pieces (1 then 4): most recent 4; highest 4; average 2.5; median 2.5;
       mode: one of each, so the most recent, 4; decaying 1×0.35 + 4×0.65 = 2.95.
     three (1, 4, 2): most recent 2; highest 4; average 7/3; median 2;
       mode: one of each, so the most recent, 2;
       decaying 2.95×0.35 + 2×0.65 = 2.3325. */
  const TWO = { mostRecent: 4, highest: 4, average: 2.5, median: 2.5, mode: 4, decayingAvg: 2.95 };
  const THREE = { mostRecent: 2, highest: 4, average: 7 / 3, median: 2, mode: 2, decayingAvg: 2.3325 };

  it.each(METHODS)('two pieces, %s: the same whichever was graded first', method => {
    seed([piece('A'), piece('B')], method);
    orders([A(), B()]).forEach(list => {
      graded(list);
      expect(level(), list.map(e => e.assessmentId).join(',')).toBeCloseTo(TWO[method], 12);
    });
  });

  it.each(METHODS)('three pieces, %s: the same in all six grading orders', method => {
    seed([piece('A'), piece('B'), piece('C')], method);
    const got = orders([A(), B(), C()]).map(list => {
      graded(list);
      return level();
    });
    got.forEach(v => expect(v).toBeCloseTo(THREE[method], 12));
    // Not merely close: the very same number each time.
    expect(new Set(got).size).toBe(1);
  });

  it('re-entering a score, or clearing it and entering it again, does not move it', () => {
    seed([piece('A'), piece('B'), piece('C')], 'mostRecent');
    graded([A(), B(), C()]);
    expect(level()).toBe(2); // C, the last in the list
    // B is re-entered: its entry now sits at the end of the score list.
    graded([A(), C(), B()]);
    expect(level()).toBe(2);
    // C is cleared: B is now the last piece with a score.
    graded([A(), B()]);
    expect(level()).toBe(4);
    // C is entered again, then A re-entered after it.
    graded([B(), C(), A()]);
    expect(level()).toBe(2);
    METHODS.forEach(method => {
      setMethod(method);
      expect(level(), method).toBeCloseTo(THREE[method], 12);
    });
  });

  it('Mode’s tie goes to the piece lower in the list, however the scores were entered', () => {
    // A 3, B 3, C 1, D 1: two at each level; the most recent of those is D.
    seed([piece('A'), piece('B'), piece('C'), piece('D')], 'mode');
    const four = [score('A', 3), score('B', 3), score('C', 1), score('D', 1)];
    orders(four).forEach(list => {
      graded(list);
      expect(level()).toBe(1);
    });
    // Drag D above the rest: now B is the lowest of the tied pieces.
    seed(
      [
        piece('A', { display_order: 2 }),
        piece('B', { display_order: 4 }),
        piece('C', { display_order: 3 }),
        piece('D', { display_order: 1 }),
      ],
      'mode',
    );
    orders(four).forEach(list => {
      graded(list);
      expect(level()).toBe(3);
    });
  });

  it('Count Only the Most Recent 2 keeps the two lowest in the list', () => {
    seed([piece('A'), piece('B'), piece('C')], 'average', { recentScoreLimit: 2 });
    orders([A(), B(), C()]).forEach(list => {
      graded(list);
      expect(level()).toBe(3); // B 4 and C 2
    });
  });

  it('the trend and the first-to-last change follow the list too', () => {
    seed([piece('A'), piece('B'), piece('C')], 'mostRecent');
    orders([A(), B(), C()]).forEach(list => {
      graded(list);
      // The last two are B (4) then C (2): down.
      expect(getSectionTrend(CID, 'sam', 'S1')).toBe('down');
      expect(sectionCountedEvidence(CID, 'sam', 'S1').map(e => e.assessmentId)).toEqual(['A', 'B', 'C']);
      expect(evidenceChange(sectionCountedEvidence(CID, 'sam', 'S1'))).toMatchObject({ first: 1, last: 2, dir: 1 });
      expect(getTagScores(CID, 'sam', 'T1').map(e => e.assessmentId)).toEqual(['A', 'B', 'C']);
      expect(getSectionGrowthData(CID, 'sam', 'S1')).toEqual([{ date: DAY, prof: 2 }]);
    });
  });
});

describe('what "the assignment list" is', () => {
  afterEach(drop);
  const scores = () => [score('A', 1), score('B', 4), score('C', 2)];
  const mostRecent = list => {
    seed(list, 'mostRecent');
    const got = orders(scores()).map(order => {
      graded(order);
      return level();
    });
    expect(new Set(got).size).toBe(1);
    return got[0];
  };

  it('pieces a teacher has dragged: the order they were dragged into', () => {
    // Dragged to C, B, A: A is now the lowest, so it is the most recent.
    expect(
      mostRecent([
        piece('A', { display_order: 3 }),
        piece('B', { display_order: 2 }),
        piece('C', { display_order: 1 }),
      ]),
    ).toBe(1);
    // The stored order of the pieces does not matter once they are dragged.
    expect(
      mostRecent([
        piece('C', { display_order: 1 }),
        piece('A', { display_order: 3 }),
        piece('B', { display_order: 2 }),
      ]),
    ).toBe(1);
  });

  it('pieces never dragged (display_order 0): the order they are stored in, the order they were made', () => {
    expect(mostRecent([piece('A'), piece('B'), piece('C')])).toBe(2); // C made last
    expect(mostRecent([piece('C'), piece('A'), piece('B')])).toBe(4); // B made last
    expect(mostRecent([piece('B'), piece('C'), piece('A')])).toBe(1); // A made last
  });

  it('a piece never dragged sits above the dragged ones, as on the Assignments page', () => {
    // C is new (0); A and B were dragged to 1 and 2. The list: C, A, B.
    expect(mostRecent([piece('A', { display_order: 1 }), piece('B', { display_order: 2 }), piece('C')])).toBe(4);
  });

  it('the date still comes first: a later date beats a lower place in the list', () => {
    seed([piece('A'), piece('B'), piece('C')], 'mostRecent');
    orders([score('A', 1, { date: '2026-10-09' }), score('B', 4), score('C', 2)]).forEach(order => {
      graded(order);
      expect(level()).toBe(1); // A is dated later than B and C
      expect(getTagScores(CID, 'sam', 'T1').map(e => e.assessmentId)).toEqual(['B', 'C', 'A']);
      // The last two are C (2) then A (1): down.
      expect(getSectionTrend(CID, 'sam', 'S1')).toBe('down');
      expect(sectionCountedEvidence(CID, 'sam', 'S1').map(e => e.assessmentId)).toEqual(['B', 'C', 'A']);
    });
  });

  it('a score whose piece is no longer in the class counts after same-date pieces that are', () => {
    seed([piece('A'), piece('B')], 'mostRecent');
    orders([score('A', 1), score('B', 4), score('gone', 3)]).forEach(order => {
      graded(order);
      expect(level()).toBe(3);
      expect(getTagScores(CID, 'sam', 'T1').map(e => e.assessmentId)).toEqual(['A', 'B', 'gone']);
    });
  });
});

describe('ties the list cannot settle are still fixed', () => {
  afterEach(drop);

  it('two same-date scores whose pieces are both gone from the class: by the pieces’ ids', () => {
    seed([piece('A')], 'mostRecent');
    orders([score('gone-b', 4), score('gone-a', 1), score('A', 2)]).forEach(order => {
      graded(order);
      expect(getTagScores(CID, 'sam', 'T1').map(e => e.assessmentId)).toEqual(['A', 'gone-a', 'gone-b']);
      expect(level()).toBe(4);
    });
  });

  it('two scores of one piece under keys the piece does not list: by the keys', () => {
    // A rubric piece with two entries left under criteria of another rubric,
    // both feeding T1. Neither is evidence; their order is fixed all the same.
    seed([piece('A')], 'mostRecent');
    const x = { assessmentId: 'A', tagId: 'zz-old', score: 1, date: DAY };
    const y = { assessmentId: 'A', tagId: 'aa-old', score: 4, date: DAY };
    orders([x, y, score('A', 3)]).forEach(order => {
      graded(order);
      expect(_orderedEntries(CID, 'sam').map(e => e.tagId)).toEqual(['T1', 'aa-old', 'zz-old']);
      expect(level()).toBe(3);
    });
  });
});

describe('the one place the order of same-date pieces is decided', () => {
  afterEach(drop);

  it('_pieceOrderFacts names what is known about each piece', () => {
    seed(
      [piece('A', { display_order: 2, moduleId: 'm2' }), piece('B', { created: '2026-10-05T17:00:00.000Z' })],
      'mostRecent',
    );
    _cache.modules[CID] = [
      { id: 'm1', name: 'Unit 1' },
      { id: 'm2', name: 'Unit 2' },
    ];
    expect(_pieceOrderFacts(CID)).toEqual([
      { id: 'A', placed: 2, stored: 0, made: '', folder: 'm2', folderPlace: 1 },
      { id: 'B', placed: 0, stored: 1, made: '2026-10-05T17:00:00.000Z', folder: '', folderPlace: Infinity },
    ]);
    delete _cache.modules[CID];
  });

  it('changing _sameDatePieceOrder alone changes every reading of same-date work', () => {
    seed([piece('A'), piece('B'), piece('C')], 'mostRecent');
    graded([score('A', 1), score('B', 4), score('C', 2)]);
    expect(level()).toBe(2);
    expect(getSectionTrend(CID, 'sam', 'S1')).toBe('down');
    const asBuilt = _sameDatePieceOrder;
    try {
      // Read the other way round.
      _sameDatePieceOrder = (x, y) => asBuilt(y, x);
      clearProfCache();
      expect(level()).toBe(1);
      expect(getTagScores(CID, 'sam', 'T1').map(e => e.assessmentId)).toEqual(['C', 'B', 'A']);
      expect(getSectionTrend(CID, 'sam', 'S1')).toBe('down'); // B 4 then A 1
      expect(sectionCountedEvidence(CID, 'sam', 'S1').map(e => e.assessmentId)).toEqual(['C', 'B', 'A']);
    } finally {
      _sameDatePieceOrder = asBuilt;
      clearProfCache();
    }
  });
});

describe('the scores of one piece count in the order the piece lists them', () => {
  afterEach(drop);

  it('a rubric: two criteria feeding one competency count in the rubric’s order', () => {
    seed([piece('lab', { rubricId: 'R', tagIds: ['T1'] })], 'mostRecent');
    _cache.rubrics[CID] = [
      {
        id: 'R',
        name: 'Lab',
        criteria: [
          { id: 'c-method', name: 'Method', tagIds: ['T1'] },
          { id: 'c-data', name: 'Data', tagIds: ['T1'] },
        ],
      },
    ];
    const method = { assessmentId: 'lab', tagId: 'c-method', score: 2, date: DAY };
    const data = { assessmentId: 'lab', tagId: 'c-data', score: 4, date: DAY };
    orders([method, data]).forEach(order => {
      graded(order);
      expect(level()).toBe(4); // Data is the second criterion
      expect(getTagScores(CID, 'sam', 'T1').map(e => e.criterionId)).toEqual(['c-method', 'c-data']);
      // The section's evidence and its trend read the criteria in the same order: Method's 2, then Data's 4.
      expect(sectionCountedEvidence(CID, 'sam', 'S1').map(e => e.criterionId)).toEqual(['c-method', 'c-data']);
      expect(getSectionTrend(CID, 'sam', 'S1')).toBe('up');
      setMethod('decayingAvg');
      expect(level()).toBeCloseTo(2 * 0.35 + 4 * 0.65, 12);
      setMethod('mostRecent');
    });
    // Reorder the rubric's criteria: Method is now second.
    _cache.rubrics[CID][0].criteria.reverse();
    orders([method, data]).forEach(order => {
      graded(order);
      expect(level()).toBe(2);
    });
  });

  it('a piece on two competencies: its overall level adds them in the piece’s order', () => {
    seed([piece('essay', { tagIds: ['T1', 'T2'] })], 'average');
    const ask = { assessmentId: 'essay', tagId: 'T1', score: 3, mod: 1, date: DAY };
    const plan = { assessmentId: 'essay', tagId: 'T2', score: 2, mod: -1, date: DAY };
    const got = orders([ask, plan]).map(order => {
      graded(order);
      return getAssessmentOverallScore(CID, 'sam', 'essay');
    });
    expect(new Set(got).size).toBe(1);
    expect(got[0]).toBeCloseTo((3 + 1 / 3 + 2 - 1 / 3) / 2, 12);
  });

  it('a piece on three competencies: the very same number in all six score-list orders', () => {
    // 3+, 1− and 2+ add up differently, in the last decimal place, in different orders.
    seed([piece('essay', { tagIds: ['T1', 'T2', 'T3'] })], 'average');
    _cache.learningMaps[CID].sections.push({
      id: 'S3',
      subject: 'SUB',
      name: 'Report',
      tags: [{ id: 'T3', label: 'Report' }],
    });
    const entries = [
      { assessmentId: 'essay', tagId: 'T1', score: 3, mod: 1, date: DAY },
      { assessmentId: 'essay', tagId: 'T2', score: 1, mod: -1, date: DAY },
      { assessmentId: 'essay', tagId: 'T3', score: 2, mod: 1, date: DAY },
    ];
    const sums = orders(entries).map(order => order.reduce((t, e) => t + scoreModValue(e), 0));
    // The plain sums really do differ by order; the piece's level must not.
    expect(new Set(sums).size).toBeGreaterThan(1);
    const got = orders(entries).map(order => {
      graded(order);
      return getAssessmentOverallScore(CID, 'sam', 'essay');
    });
    expect(new Set(got).size).toBe(1);
    expect(got[0]).toBe((scoreModValue(entries[0]) + scoreModValue(entries[1]) + scoreModValue(entries[2])) / 3);
  });
});

describe('a section with two competencies', () => {
  afterEach(drop);

  it('the trend follows the assignment list across its competencies, not their order in the section', () => {
    // One section holding T1 then T2. First in the list: a piece on T2
    // scored 4. Second: a piece on T1 scored 1. Same date.
    seed([piece('first', { tagIds: ['T2'] }), piece('second', { tagIds: ['T1'] })], 'mostRecent');
    _cache.learningMaps[CID].sections = [
      {
        id: 'S1',
        subject: 'SUB',
        name: 'Inquiry',
        tags: [
          { id: 'T1', label: 'Ask' },
          { id: 'T2', label: 'Plan' },
        ],
      },
    ];
    const first = { assessmentId: 'first', tagId: 'T2', score: 4, date: DAY };
    const second = { assessmentId: 'second', tagId: 'T1', score: 1, date: DAY };
    orders([first, second]).forEach(order => {
      graded(order);
      expect(sectionCountedEvidence(CID, 'sam', 'S1').map(e => e.assessmentId)).toEqual(['first', 'second']);
      // The most recent is the second piece's 1, after the first piece's 4.
      expect(getSectionTrend(CID, 'sam', 'S1')).toBe('down');
      expect(evidenceChange(sectionCountedEvidence(CID, 'sam', 'S1'))).toMatchObject({ first: 4, last: 1, dir: -1 });
    });
  });
});

describe('the same in returned-only grades', () => {
  afterEach(drop);

  it('the returned set’s order does not matter either', () => {
    seed([piece('A'), piece('B'), piece('C')], 'mostRecent');
    graded([score('A', 1), score('B', 4), score('C', 2)]);
    orders([score('A', 1), score('B', 4), score('C', 2)]).forEach(order => {
      globalThis.getReturnedScores = () => ({ sam: order });
      clearProfCache();
      METHODS.forEach(method => {
        setMethod(method);
        expect(withReturnedOnly(level), method).toBe(level());
      });
      setMethod('mostRecent');
      expect(withReturnedOnly(level)).toBe(2);
    });
  });
});

/* ── The property: shuffle every score list, get the golden file ── */

// A seeded shuffle (mulberry32, Fisher–Yates), so a failure can be run again.
function shuffler(seed) {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return list => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
}
function shuffled(scores, seed) {
  const shuffle = shuffler(seed);
  const out = {};
  Object.keys(scores).forEach(sid => (out[sid] = shuffle(scores[sid])));
  return out;
}

describe('no grade depends on the order of a student’s score list', () => {
  const SEEDS = [1, 7, 20261109, 4242];
  const CLASSES = [
    ['demo-science-8', loadDemoClass],
    ['eval-history-12', loadEvalClass],
  ];
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf-8'));
  const asText = record => JSON.stringify(canonical(record, ''), null, 2);
  const results = {};
  let wasDemo;

  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    CLASSES.forEach(([name, load]) => {
      const cid = load();
      const original = getScores(cid);
      const moved = [];
      const run = { allWork: [], returnedOnly: [], moved };
      SEEDS.forEach(seed => {
        // All work, read from a shuffled working copy.
        const mixed = shuffled(original, seed);
        moved.push(Object.keys(original).filter(sid => original[sid].some((e, i) => mixed[sid][i] !== e)).length);
        _cache.scores[cid] = mixed;
        clearProfCache();
        run.allWork.push(asText(recordClass(cid).record));
        // Returned only: the working copy as it was, the returned set shuffled another way.
        _cache.scores[cid] = original;
        const returnedSet = shuffled(original, seed + 1000);
        globalThis.getReturnedScores = () => returnedSet;
        clearProfCache();
        run.returnedOnly.push(asText(withReturnedOnly(() => recordClass(cid).record)));
        delete globalThis.getReturnedScores;
      });
      _cache.scores[cid] = original;
      clearProfCache();
      results[name] = run;
    });
  }, 120000);

  afterAll(() => {
    delete globalThis.getReturnedScores;
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  it.each(CLASSES)('%s: the shuffles really moved the scores', name => {
    // Nearly every student's list came out in a new order, every time.
    results[name].moved.forEach(n =>
      expect(n).toBeGreaterThanOrEqual(Object.keys(golden.classes[name].views.year.levels).length - 1),
    );
  });

  it.each(CLASSES)('%s: all work, shuffled, is the golden file', name => {
    const want = asText(golden.classes[name]);
    results[name].allWork.forEach((got, i) => expect(got === want, 'seed ' + SEEDS[i]).toBe(true));
  });

  it.each(CLASSES)('%s: returned only, shuffled, is the golden file', name => {
    const want = asText(golden.classes[name]);
    results[name].returnedOnly.forEach((got, i) => expect(got === want, 'seed ' + SEEDS[i]).toBe(true));
  });
});
