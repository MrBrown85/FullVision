/**
 * Same-date work in assignment-list order, on the Demo class (S0-F1d, rule
 * A): a named example for the pull request.
 *
 * The Demo class has no two pieces on one date, so this test adds a pair to
 * a copy of it in memory (the Demo seed is not changed): two pieces dated
 * Nov 6, both on the competency PA5, listed in the Assignments list as
 *   1. Body Systems Exit Ticket   (Cece Adeyemi: Extending, 4)
 *   2. Body Systems Reflection    (Cece: Developing, 2)
 * and graded in both orders.
 *
 * The Demo class uses the Average method, as every class on the live
 * database does. Under Average the competency's level is the same either
 * way; what follows the order is which piece is "the latest". Under Most
 * Recent the level itself follows it.
 */
import './setup.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';

describe('Science 8 (a copy): Cece’s two PA5 pieces dated the same day', () => {
  const DAY = '2026-11-06';
  const TAG = 'PA5';
  let cid;
  let cece;
  let earlier;
  let wasDemo;

  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    cid = loadDemoClass();
    setActiveTerm(cid, null);
    cece = getStudents(cid).find(s => s.firstName === 'Cece').id;
    const make = (id, title) => ({
      id,
      title,
      scoreMode: 'proficiency',
      tagIds: [TAG],
      date: DAY,
      categoryId: 'sci8-cat-checks',
      category_id: 'sci8-cat-checks',
    });
    // Made in this order, never dragged: Exit Ticket above Reflection.
    getAssessments(cid).push(make('ticket', 'Body Systems Exit Ticket'), make('reflection', 'Body Systems Reflection'));
    earlier = getScores(cid)[cece].slice();
    clearProfCache();
  });
  afterAll(() => {
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  const ticket = () => ({ assessmentId: 'ticket', tagId: TAG, score: 4, date: DAY });
  const reflection = () => ({ assessmentId: 'reflection', tagId: TAG, score: 2, date: DAY });
  // Cece's score list with the two new scores entered in the order given.
  const graded = list => {
    getScores(cid)[cece] = earlier.concat(list);
    clearProfCache();
  };
  const setMethod = method => {
    getCourseConfig(cid).calcMethod = method;
    clearProfCache();
  };
  // The rule before S0-F1d: by date, a tie going to whichever sits later in the score list.
  const lastInScoreList = () =>
    getScores(cid)
      [cece].filter(e => e.tagId === TAG && e.score > 0)
      .slice()
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .pop().assessmentId;
  // The latest piece of evidence, as the student's page and the reports pick it.
  const latest = () =>
    getTagScores(cid, cece, TAG)
      .filter(e => e.score > 0)
      .slice()
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .pop().assessmentId;

  it('Average (the class’s own method): the level is the same either way; the latest piece is the Reflection', () => {
    setMethod('average');
    graded([ticket(), reflection()]);
    const first = {
      level: getTagProficiency(cid, cece, TAG),
      overall: getOverallProficiency(cid, cece),
      latest: latest(),
    };
    graded([reflection(), ticket()]); // the Exit Ticket entered last
    const second = {
      level: getTagProficiency(cid, cece, TAG),
      overall: getOverallProficiency(cid, cece),
      latest: latest(),
    };

    expect(second).toEqual(first);
    expect(first.level).toBeCloseTo(3, 12); // eleven pieces: the earlier nine average 3, then a 4 and a 2
    expect(first.latest).toBe('reflection');
    // Before, "the latest" was whichever was entered last.
    expect(lastInScoreList()).toBe('ticket');
    graded([ticket(), reflection()]);
    expect(lastInScoreList()).toBe('reflection');
  });

  it('Most Recent: Cece’s level is the Reflection’s Developing, whichever was entered last', () => {
    setMethod('mostRecent');
    graded([ticket(), reflection()]);
    expect(getTagProficiency(cid, cece, TAG)).toBe(2);
    expect(formatLevel(cid, getTagProficiency(cid, cece, TAG))).toBe('2.0');
    graded([reflection(), ticket()]);
    // Before S0-F1d this read 4.0, Extending: the Exit Ticket's entry is last in the list.
    expect(lastInScoreList()).toBe('ticket');
    expect(getTagProficiency(cid, cece, TAG)).toBe(2);
    setMethod('average');
  });

  it('dragging the Reflection above the Exit Ticket makes the Exit Ticket the later one', () => {
    getAssessments(cid).forEach((a, i) => (a.display_order = i + 1));
    const all = getAssessments(cid);
    const t = all.find(a => a.id === 'ticket');
    const r = all.find(a => a.id === 'reflection');
    [t.display_order, r.display_order] = [r.display_order, t.display_order];
    setMethod('mostRecent');
    graded([ticket(), reflection()]);
    expect(getTagProficiency(cid, cece, TAG)).toBe(4);
    graded([reflection(), ticket()]);
    expect(getTagProficiency(cid, cece, TAG)).toBe(4);
    expect(latest()).toBe('ticket');
    setMethod('average');
  });
});
