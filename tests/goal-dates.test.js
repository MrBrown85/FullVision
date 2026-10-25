/**
 * When each goal was set (getGoalDates / setGoalDate), for the student
 * page's Goals tab: "Goal · Set Oct 1" and the scores since then. A goal
 * saved on this device dates itself; clearing it drops the date.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'goal-dates';

describe('goal dates', () => {
  beforeEach(() => {
    localStorage.clear();
    delete _cache.goalDates[CID];
  });

  it('keeps a date per student and competency, and drops it when cleared', () => {
    setGoalDate(CID, 'stu-1', 'sec-a', '2026-10-01T15:00:00Z');
    setGoalDate(CID, 'stu-1', 'sec-b', '2026-10-05T15:00:00Z');
    setGoalDate(CID, 'stu-2', 'sec-a', '2026-10-02T15:00:00Z');
    expect(getGoalDates(CID)['stu-1']).toEqual({ 'sec-a': '2026-10-01T15:00:00Z', 'sec-b': '2026-10-05T15:00:00Z' });
    setGoalDate(CID, 'stu-1', 'sec-a', null);
    expect(getGoalDates(CID)['stu-1']).toEqual({ 'sec-b': '2026-10-05T15:00:00Z' });
    expect(getGoalDates(CID)['stu-2']).toEqual({ 'sec-a': '2026-10-02T15:00:00Z' });
  });

  it('survives a reload from this device', () => {
    setGoalDate(CID, 'stu-1', 'sec-a', '2026-10-01T15:00:00Z');
    delete _cache.goalDates[CID];
    expect(getGoalDates(CID)['stu-1']['sec-a']).toBe('2026-10-01T15:00:00Z');
  });
});
