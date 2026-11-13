/**
 * When a piece of work was made, as this device knows it, and what that
 * means across a reload (S0-F1e: on the same date, the piece made later
 * counts later).
 *
 * shared/calc.js can only order by what the data layer holds:
 *
 * - A piece loaded from the server carries the server's created_at when the
 *   class bundle sends it (the loader keeps it; one line in shared/data.js).
 *   The bundle has sent it since 2026-11-10 (migration
 *   2026111001_assessment_created_at_in_bundle.sql). A bundle without it
 *   (an older copy, or a piece the server has no time for) leaves a loaded
 *   piece with no time known, and same-date pieces fall to id order.
 * - A piece made on this device carries this device's clock
 *   (assessment.created) until the class is next loaded. At that load the
 *   server's copy takes its place, with the server's time and id.
 *
 * So this file pins, for a class as get_class_bundle sends it:
 *   1. what the loader keeps;
 *   2. that loading the same class again gives the same grades, order and
 *      trend, however the pieces and scores are arranged in the bundle, with
 *      created_at and without;
 *   3. the window between making a piece and the next load: where the order
 *      is the same before and after, and where it cannot be.
 */
import './setup.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { syntheticClass } from './eval-fixture.js';
import { loadClass } from '../scripts/eval/app.mjs';
import { FROZEN_AT, canonical, recordClass } from './helpers/golden-grades.js';

const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const LATE = '2026-10-20';
const CHANGE = id(402); // the competency Continuity and Change
const CHANGE_SECTION = id(702);

/* The synthetic class with two groups of same-date work:
     Current Events: Week 1, 2 and 3, all on Continuity and Change, on
     Oct 20 (the class's latest date);
     Primary Source Analysis and Lesson 4: Treaty Debate, both on
     Perspective, on Oct 9.
   `made` (optional) gives each of the seven pieces its created_at. */
function sameDateClass(made) {
  const bundle = syntheticClass();
  const pieces = bundle.gradebook.assessments;
  [1, 2, 3].forEach(i => (pieces[i].date_assigned = pieces[i].due_date = LATE));
  pieces[4].date_assigned = pieces[4].due_date = '2026-10-09';
  if (made) pieces.forEach((a, i) => (a.created_at = made[i]));
  return bundle;
}

/* The server's times: the pieces were made in an order that is not the
   order of their ids. Week 3 first, then Week 1, then Week 2; the Treaty
   Debate before Primary Source Analysis. Microseconds, as the server sends. */
const MADE = [
  '2026-09-01T16:00:00.000000+00:00', // 1.1 Causes of the War
  '2026-09-02T16:00:00.120000+00:00', // Week 1
  '2026-09-02T16:05:00.450000+00:00', // Week 2
  '2026-09-01T16:30:00.000000+00:00', // Week 3
  '2026-09-03T16:00:00.000000+00:00', // Primary Source Analysis
  '2026-09-02T17:00:00.000000+00:00', // Lesson 4: Treaty Debate
  '2026-09-04T16:00:00.000000+00:00', // the poster
];

/* The same class as another load might send it: the pieces in the opposite
   order (as after a drag on the Assignments page) and the score rows in
   another order. Nothing about any piece or score is changed. */
function rearranged(bundle) {
  const out = JSON.parse(JSON.stringify(bundle));
  const g = out.gradebook;
  const last = g.assessments.length - 1;
  g.assessments.reverse();
  g.assessments.forEach((a, i) => (a.display_order = i));
  ['score_rows', 'tag_rows', 'criterion_rows'].forEach(rows => {
    g[rows].forEach(r => (r[1] = last - r[1]));
    g[rows].reverse();
  });
  return out;
}

function load(bundle) {
  const { cid } = loadClass(bundle, 1);
  setActiveTerm(cid, null);
  clearProfCache();
  return cid;
}

const sidOf = (cid, first) => getStudents(cid).find(s => s.firstName === first).id;
const titleOf = (cid, aid) => (getAssessments(cid).find(a => a.id === aid) || {}).title;
// The titles of a student's Continuity and Change work, in the order it counts.
const countedTitles = (cid, first) =>
  sectionCountedEvidence(cid, sidOf(cid, first), CHANGE_SECTION).map(e => titleOf(cid, e.assessmentId));
function mostRecent(cid, first) {
  const config = getCourseConfig(cid);
  const own = config.calcMethod;
  config.calcMethod = 'mostRecent';
  clearProfCache();
  const level = getTagProficiency(cid, sidOf(cid, first), CHANGE);
  config.calcMethod = own;
  clearProfCache();
  return level;
}

/* Everything a class's grades come to: every level in every view, style and
   method (the golden file's record), and for every student and section the
   order the evidence counts in, the trend and the growth line. */
function everything(cid) {
  const { record, drift } = recordClass(cid);
  expect(drift).toEqual([]);
  const order = {};
  getStudents(cid).forEach(s => {
    getSections(cid).forEach(sec => {
      order[s.firstName + ' › ' + sec.name] = [
        sectionCountedEvidence(cid, s.id, sec.id)
          .map(e => titleOf(cid, e.assessmentId))
          .join(' > '),
        String(getSectionTrend(cid, s.id, sec.id)),
        JSON.stringify(getSectionGrowthData(cid, s.id, sec.id)),
      ].join(' | ');
    });
  });
  const before = {};
  getAssessments(cid).forEach(a => {
    before[a.title] = (earlierInCategory(cid, a, 6) || []).map(x => x.assessment.title).join(' > ');
  });
  return JSON.stringify(canonical({ record, order, before }));
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(FROZEN_AT));
});
afterAll(() => {
  vi.useRealTimers();
  localStorage.clear();
  clearProfCache();
});

describe('what the loader keeps of when a piece was made', () => {
  it('the server’s created_at, when the bundle sends it', () => {
    const cid = load(sameDateClass(MADE));
    expect(_pieceOrderFacts(cid)).toEqual(
      MADE.map((t, i) => ({ id: id(300 + i), made: Date.parse(t), here: false, stored: i })),
    );
    expect(_pieceOrderFacts(cid)[1].made).toBe(Date.UTC(2026, 8, 2, 16, 0, 0, 120));
    getAssessments(cid).forEach((a, i) => expect(a.created_at, a.title).toBe(MADE[i]));
  });

  it('nothing, when the bundle does not send it (a bundle without it)', () => {
    const cid = load(sameDateClass());
    expect(_pieceOrderFacts(cid)).toEqual(
      MADE.map((t, i) => ({ id: id(300 + i), made: null, here: false, stored: i })),
    );
    getAssessments(cid).forEach(a => {
      expect(a.created, a.title).toBeUndefined();
      expect(a.created_at, a.title).toBeUndefined();
    });
    // Nor does a null or an empty time count as one.
    const empty = sameDateClass();
    empty.gradebook.assessments[0].created_at = null;
    empty.gradebook.assessments[1].created_at = '';
    expect(
      _pieceOrderFacts(load(empty))
        .slice(0, 2)
        .map(f => f.made),
    ).toEqual([null, null]);
  });

  it('a piece made on this device has this device’s time, under a local id', () => {
    const cid = load(sameDateClass(MADE));
    // As the Assignments page makes one: a local id and its own clock.
    const made = {
      id: uid(),
      title: 'New Quiz',
      scoreMode: 'proficiency',
      tagIds: [],
      date: '2026-11-09',
      created: new Date().toISOString(),
    };
    getAssessments(cid).push(made);
    clearProfCache();
    expect(_pieceOrderFacts(cid).find(f => f.id === made.id)).toEqual({
      id: made.id,
      made: Date.parse(FROZEN_AT),
      here: true,
      stored: 7,
    });
    // The local id is not the server's: 's', the time in milliseconds, then random characters.
    expect(made.id).toMatch(/^s\d{13}[a-z0-9]+$/);
  });
});

describe('loading the same class again gives the same grades', () => {
  it('with created_at in the bundle: same-date work counts in the order made, on every load', () => {
    const bundle = sameDateClass(MADE);
    const cid = load(bundle);
    const first = everything(cid);
    // Week 3 was made first, Week 2 last: Priya's 2, 3 (Week 1, Week 2) follow her Week 3's 2.
    expect(countedTitles(cid, 'Priya').slice(-3)).toEqual([
      'Current Events: Week 3',
      'Current Events: Week 1',
      'Current Events: Week 2',
    ]);
    expect(mostRecent(cid, 'Priya')).toBe(3);

    expect(everything(load(JSON.parse(JSON.stringify(bundle))))).toBe(first);
    const again = load(rearranged(bundle));
    expect(getAssessments(again)[0].title).toBe('What Does the Poster Show, and What Does It Hide?');
    expect(everything(again)).toBe(first);
    expect(mostRecent(again, 'Priya')).toBe(3);
  });

  it('without it (a bundle without it): same-date work counts in id order, on every load', () => {
    const bundle = sameDateClass();
    const cid = load(bundle);
    const first = everything(cid);
    expect(countedTitles(cid, 'Priya').slice(-3)).toEqual([
      'Current Events: Week 1',
      'Current Events: Week 2',
      'Current Events: Week 3',
    ]);
    expect(mostRecent(cid, 'Priya')).toBe(2);

    expect(everything(load(JSON.parse(JSON.stringify(bundle))))).toBe(first);
    const again = load(rearranged(bundle));
    expect(everything(again)).toBe(first);
    expect(mostRecent(again, 'Priya')).toBe(2);
  });

  it('the pieces before one in its category (the Class Results card) are listed in the same order, later first', () => {
    // The poster moved to Oct 27, so every other piece is before it.
    const later = made => {
      const bundle = sameDateClass(made);
      bundle.gradebook.assessments[6].date_assigned = bundle.gradebook.assessments[6].due_date = '2026-10-27';
      return bundle;
    };
    const before = bundle => {
      const cid = load(bundle);
      const poster = getAssessments(cid).find(a => a.title.startsWith('What Does the Poster'));
      return earlierInCategory(cid, poster, 6).map(x => x.assessment.title);
    };
    const MADE_ORDER = [
      'Current Events: Week 2',
      'Current Events: Week 1',
      'Current Events: Week 3',
      'Primary Source Analysis',
      'Lesson 4: Treaty Debate',
      '1.1 Causes of the War',
    ];
    const ID_ORDER = [
      'Current Events: Week 3',
      'Current Events: Week 2',
      'Current Events: Week 1',
      'Lesson 4: Treaty Debate',
      'Primary Source Analysis',
      '1.1 Causes of the War',
    ];
    expect(before(later(MADE))).toEqual(MADE_ORDER);
    expect(before(rearranged(later(MADE)))).toEqual(MADE_ORDER);
    expect(before(later())).toEqual(ID_ORDER);
    expect(before(rearranged(later()))).toEqual(ID_ORDER);
  });

  it('the two are not the same class to the grades: the order made is not the order of the ids', () => {
    const withTimes = everything(load(sameDateClass(MADE)));
    const without = everything(load(sameDateClass()));
    expect(withTimes).not.toBe(without);
  });

  it('under Average (every live class’s method) no level moves between the two; only the order does', () => {
    const levels = bundle => JSON.stringify(canonical(recordClass(load(bundle)).record.views));
    expect(levels(sameDateClass(MADE))).toBe(levels(sameDateClass()));
  });
});

/* ── Between making a piece and the next load ─────────────────────
   The teacher makes two pieces on this device, Quiz A then Quiz B, both on
   Continuity and Change and both dated Oct 20, and scores Priya 4 on Quiz A
   and 1 on Quiz B. Then the class is loaded again: the server's copies of
   the two pieces arrive under the server's ids, with the server's times. */
describe('a piece made on this device, before and after the next load', () => {
  const NOW = Date.parse(FROZEN_AT);
  const iso = ms => new Date(ms).toISOString();

  /* Makes the two pieces on this device. `a` and `b`: { id, created }. */
  function makeOnDevice(cid, a, b) {
    const priya = sidOf(cid, 'Priya');
    [
      ['Quiz A', a, 4],
      ['Quiz B', b, 1],
    ].forEach(([title, p, score]) => {
      getAssessments(cid).push({
        id: p.id,
        title,
        scoreMode: 'proficiency',
        tagIds: [CHANGE],
        date: LATE,
        categoryId: id(500),
        created: p.created,
      });
      getScores(cid)[priya].push({ assessmentId: p.id, tagId: CHANGE, score, date: LATE });
    });
    clearProfCache();
  }

  /* The bundle the next load brings: the same class with the server's
     copies of the two pieces. `a` and `b`: { id, created_at }. */
  function afterSync(bundle, a, b) {
    const out = JSON.parse(JSON.stringify(bundle));
    const g = out.gradebook;
    [
      ['Quiz A', a, 4],
      ['Quiz B', b, 1],
    ].forEach(([title, p, score]) => {
      const row = Object.assign({}, g.assessments[1], {
        id: p.id,
        title,
        display_order: g.assessments.length,
        tag_ids: [CHANGE],
      });
      delete row.created_at;
      if (p.created_at) row.created_at = p.created_at;
      g.assessments.push(row);
      g.score_rows.push([2, g.assessments.length - 1, score, null, '']);
      g.tag_rows.push([2, g.assessments.length - 1, 2, score, 0]);
    });
    return out;
  }
  const lastTwo = cid => countedTitles(cid, 'Priya').slice(-2);
  // The server's ids for the two, in the opposite order to the order made.
  const SERVER_A = id(399);
  const SERVER_B = id(398);

  describe('once the bundle sends created_at', () => {
    it('made apart in time: Quiz B counts later, before the load and after it', () => {
      const bundle = sameDateClass(MADE);
      const cid = load(bundle);
      // Local ids in the opposite order too: only the times say which was made later.
      makeOnDevice(
        cid,
        { id: 's1799999999999zz', created: iso(NOW) },
        { id: 's1700000000000aa', created: iso(NOW + 60000) },
      );
      expect(lastTwo(cid)).toEqual(['Quiz A', 'Quiz B']);
      expect(mostRecent(cid, 'Priya')).toBe(1);
      // They follow the loaded same-date pieces, which the server made in September.
      expect(countedTitles(cid, 'Priya').slice(-5, -2)).toEqual([
        'Current Events: Week 3',
        'Current Events: Week 1',
        'Current Events: Week 2',
      ]);

      // The server saved each a moment after it was made.
      const reloaded = load(
        afterSync(bundle, { id: SERVER_A, created_at: iso(NOW + 900) }, { id: SERVER_B, created_at: iso(NOW + 60700) }),
      );
      expect(lastTwo(reloaded)).toEqual(['Quiz A', 'Quiz B']);
      expect(mostRecent(reloaded, 'Priya')).toBe(1);
      expect(countedTitles(reloaded, 'Priya')).toEqual(countedTitles(cid, 'Priya'));
    });

    it('made offline and saved hours later, in the order made: the same', () => {
      const bundle = sameDateClass(MADE);
      const cid = load(bundle);
      makeOnDevice(
        cid,
        { id: 's1799999999999zz', created: iso(NOW) },
        { id: 's1700000000000aa', created: iso(NOW + 5000) },
      );
      expect(lastTwo(cid)).toEqual(['Quiz A', 'Quiz B']);
      const reloaded = load(
        afterSync(
          bundle,
          { id: SERVER_A, created_at: iso(NOW + 4 * 3600000) },
          { id: SERVER_B, created_at: iso(NOW + 4 * 3600000 + 350) },
        ),
      );
      expect(lastTwo(reloaded)).toEqual(['Quiz A', 'Quiz B']);
      expect(mostRecent(reloaded, 'Priya')).toBe(1);
    });

    it('once the server has given the piece its id but the class is not yet loaded again: the device’s time still decides', () => {
      const cid = load(sameDateClass(MADE));
      makeOnDevice(cid, { id: SERVER_A, created: iso(NOW) }, { id: SERVER_B, created: iso(NOW + 60000) });
      expect(lastTwo(cid)).toEqual(['Quiz A', 'Quiz B']);
    });

    /* What Priya's grades come to, with no id in it: the order her work
       counts in, her level under each method, her trend and growth line. */
    const withoutIds = cid => {
      const priya = sidOf(cid, 'Priya');
      const config = getCourseConfig(cid);
      const own = config.calcMethod;
      const levels = ['average', 'mostRecent', 'highest', 'median', 'mode', 'decayingAvg'].map(method => {
        config.calcMethod = method;
        clearProfCache();
        return [getTagProficiency(cid, priya, CHANGE), getOverallProficiency(cid, priya)];
      });
      config.calcMethod = own;
      clearProfCache();
      return JSON.stringify([
        countedTitles(cid, 'Priya'),
        levels,
        getSectionTrend(cid, priya, CHANGE_SECTION),
        getSectionGrowthData(cid, priya, CHANGE_SECTION),
        getAssessments(cid).map(a => (earlierInCategory(cid, a, 9) || []).map(x => x.assessment.title)),
      ]);
    };

    it('made in the same instant: they count in the order made, and a save landing (the id changing) moves no value', () => {
      const LOCAL_A = 's1700000000000bb';
      const LOCAL_B = 's1700000000000aa'; // sorts before Quiz A's, though Quiz B was made second
      const land = { A: [LOCAL_A, SERVER_A], B: [LOCAL_B, SERVER_B] }; // SERVER_B sorts before SERVER_A too
      // The two saves landing in either order, and one alone.
      [['A'], ['B'], ['A', 'B'], ['B', 'A']].forEach(landing => {
        const cid = load(sameDateClass(MADE));
        makeOnDevice(cid, { id: LOCAL_A, created: iso(NOW) }, { id: LOCAL_B, created: iso(NOW) });
        expect(lastTwo(cid)).toEqual(['Quiz A', 'Quiz B']);
        expect(mostRecent(cid, 'Priya')).toBe(1);
        const before = withoutIds(cid);
        landing.forEach(which => {
          // The data layer's own re-key: the piece and its scores take the server's id.
          _rekey(cid, 'assessment', land[which][0], land[which][1]);
          clearProfCache();
          expect(getAssessments(cid).filter(a => a.id === land[which][1])).toHaveLength(1);
          expect(getScores(cid)[sidOf(cid, 'Priya')].filter(e => e.assessmentId === land[which][0])).toEqual([]);
          expect(withoutIds(cid), landing.join(' then ') + ', after ' + which).toBe(before);
        });
      });
    });

    it('made apart in time: a save landing moves no value either', () => {
      const cid = load(sameDateClass(MADE));
      makeOnDevice(
        cid,
        { id: 's1700000000000bb', created: iso(NOW) },
        { id: 's1700000000000aa', created: iso(NOW + 5) },
      );
      const before = withoutIds(cid);
      _rekey(cid, 'assessment', 's1700000000000aa', SERVER_B);
      clearProfCache();
      expect(withoutIds(cid)).toBe(before);
      _rekey(cid, 'assessment', 's1700000000000bb', SERVER_A);
      clearProfCache();
      expect(withoutIds(cid)).toBe(before);
    });

    it('made in the same instant and saved in the same instant: at the next load the server’s ids decide, so the order can change once, and then stays', () => {
      const bundle = sameDateClass(MADE);
      const cid = load(bundle);
      // Before the load: the order made (their place in the class's list), whatever their ids.
      makeOnDevice(cid, { id: 's1700000000000bb', created: iso(NOW) }, { id: 's1700000000000aa', created: iso(NOW) });
      expect(lastTwo(cid)).toEqual(['Quiz A', 'Quiz B']);
      expect(mostRecent(cid, 'Priya')).toBe(1);

      // After it: the server saved both in one instant; its ids sort Quiz B first.
      const synced = afterSync(
        bundle,
        { id: SERVER_A, created_at: iso(NOW + 900) },
        { id: SERVER_B, created_at: iso(NOW + 900) },
      );
      const reloaded = load(synced);
      expect(lastTwo(reloaded)).toEqual(['Quiz B', 'Quiz A']);
      expect(mostRecent(reloaded, 'Priya')).toBe(4);
      const settled = everything(reloaded);
      // From then on it is fixed.
      expect(everything(load(rearranged(synced)))).toBe(settled);
    });

    it('a device whose clock is wrong by more than the time between two pieces: the server’s time puts it right at the load', () => {
      // Week 2 was made on the server's clock a minute ago; this device's clock runs an hour behind.
      const made = MADE.slice();
      made[2] = iso(NOW - 60000);
      const bundle = sameDateClass(made);
      const cid = load(bundle);
      makeOnDevice(
        cid,
        { id: 's1700000000000aa', created: iso(NOW - 3600000) },
        { id: 's1700000000000bb', created: iso(NOW - 3540000) },
      );
      // Until the load, the new pieces count before Week 2.
      expect(countedTitles(cid, 'Priya').slice(-3)).toEqual(['Quiz A', 'Quiz B', 'Current Events: Week 2']);
      const reloaded = load(
        afterSync(bundle, { id: SERVER_A, created_at: iso(NOW) }, { id: SERVER_B, created_at: iso(NOW + 60000) }),
      );
      expect(countedTitles(reloaded, 'Priya').slice(-3)).toEqual(['Current Events: Week 2', 'Quiz A', 'Quiz B']);
    });
  });

  describe('when the bundle sends no created_at', () => {
    it('a new piece counts after the loaded same-date pieces, and two new pieces in the order made, until the next load', () => {
      const cid = load(sameDateClass());
      makeOnDevice(
        cid,
        { id: 's1799999999999zz', created: iso(NOW) },
        { id: 's1700000000000aa', created: iso(NOW + 60000) },
      );
      expect(countedTitles(cid, 'Priya').slice(-5)).toEqual([
        'Current Events: Week 1',
        'Current Events: Week 2',
        'Current Events: Week 3',
        'Quiz A',
        'Quiz B',
      ]);
      expect(mostRecent(cid, 'Priya')).toBe(1);
    });

    it('after the next load nothing says when any piece was made: ids decide, so the order can change at that load, and then stays', () => {
      const bundle = sameDateClass();
      const cid = load(bundle);
      makeOnDevice(
        cid,
        { id: 's1700000000000aa', created: iso(NOW) },
        { id: 's1700000000000bb', created: iso(NOW + 60000) },
      );
      expect(lastTwo(cid)).toEqual(['Quiz A', 'Quiz B']);

      // The server's ids here sort Quiz B before Quiz A, and both after the Weeks.
      const synced = afterSync(bundle, { id: SERVER_A }, { id: SERVER_B });
      const reloaded = load(synced);
      expect(countedTitles(reloaded, 'Priya').slice(-5)).toEqual([
        'Current Events: Week 1',
        'Current Events: Week 2',
        'Current Events: Week 3',
        'Quiz B',
        'Quiz A',
      ]);
      expect(mostRecent(reloaded, 'Priya')).toBe(4);
      const settled = everything(reloaded);
      expect(everything(load(rearranged(synced)))).toBe(settled);

      // An id that sorts before the Weeks' puts the new piece before them.
      const early = load(afterSync(bundle, { id: id(1) }, { id: id(2) }));
      expect(countedTitles(early, 'Priya').slice(-5)).toEqual([
        'Quiz A',
        'Quiz B',
        'Current Events: Week 1',
        'Current Events: Week 2',
        'Current Events: Week 3',
      ]);
    });
  });
});
