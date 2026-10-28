/**
 * Attendance on the Term Questionnaire (Colin, 2026-10-24): at each report
 * the teacher copies the totals to date from MyEd. FullVision works out the
 * change since the last report that has totals, so nobody subtracts; the
 * report card prints both, and the comment can say it in a sentence.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'term-attendance';
const MAX = { id: 'stu-max', firstName: 'Max', lastName: 'Lind', pronouns: 'he/him' };

describe('term attendance', () => {
  beforeEach(() => {
    localStorage.clear();
    delete _cache.termRatings[CID];
  });

  it('works out this term against the last report with totals', () => {
    saveTermAttendance(CID, MAX.id, 'term-1', 4, 3);
    saveTermAttendance(CID, MAX.id, 'term-3', '10', '5');
    const att = getTermAttendance(CID, MAX.id, 'term-3');
    expect(att).toMatchObject({ absences: 10, lates: 5, prevAbsences: 4, prevLates: 3 });
    expect(att.absencesThisTerm).toBe(6);
    expect(att.latesThisTerm).toBe(2);
    expect(att.absencesPrevTerm).toBe('term-1');
  });

  it('counts the first report of the year as this term too', () => {
    saveTermAttendance(CID, MAX.id, 'term-1', 4, 0);
    const att = getTermAttendance(CID, MAX.id, 'term-1');
    expect(att.absencesThisTerm).toBe(4);
    expect(att.latesThisTerm).toBe(0);
    expect(att.prevAbsences).toBeNull();
  });

  it('clears a blank box and refuses negatives', () => {
    saveTermAttendance(CID, MAX.id, 'term-2', '', -3);
    const att = getTermAttendance(CID, MAX.id, 'term-2');
    expect(att.absences).toBeNull();
    expect(att.lates).toBeNull();
  });

  it('keeps the questionnaire’s other answers', () => {
    upsertTermRating(CID, MAX.id, 'term-2', { workHabits: 3, narrative: '<p>Hi.</p>' });
    saveTermAttendance(CID, MAX.id, 'term-2', 2, 1);
    const r = getStudentTermRating(CID, MAX.id, 'term-2');
    expect(r).toMatchObject({ workHabits: 3, narrative: '<p>Hi.</p>', absences: 2, lates: 1 });
  });

  it('says the year’s attendance in one sentence', () => {
    const say = (absences, lates) => ReportBlocks.attendanceSentence(MAX, { absences, lates });
    expect(say(10, 5)).toBe('Max has missed 10 classes this year and has been late 5 times.');
    expect(say(1, 1)).toBe('Max has missed 1 class this year and has been late 1 time.');
    expect(say(3, 0)).toBe('Max has missed 3 classes this year and has not been late.');
    expect(say(0, 0)).toBe('Max has not missed any classes this year and has always been on time.');
    expect(say(2, null)).toBe('Max has missed 2 classes this year.');
    expect(say(null, null)).toBe('');
  });

  it('prints this year and this term on the report card, and nothing without totals', () => {
    _cache.students[CID] = [MAX];
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
    const ctx = { termId: 'term-3', termLabel: 'Year-End' };
    expect(ReportBlocks.renderBlockAttendance(CID, MAX, ctx, {})).toBe('');
    saveTermAttendance(CID, MAX.id, 'term-1', 4, 3);
    saveTermAttendance(CID, MAX.id, 'term-3', 10, 5);
    const html = ReportBlocks.renderBlockAttendance(CID, MAX, ctx, {});
    // This term by default (the totals less the last report's), the year on request.
    expect(html).toContain('Classes Absent</span> <b>6</b>');
    expect(html).toContain('Times Late</span> <b>2</b>');
    expect(html).toContain('This term');
    const year = ReportBlocks.renderBlockAttendance(CID, MAX, ctx, { period: 'year' });
    expect(year).toContain('Classes Absent</span> <b>10</b>');
    expect(year).toContain('Times Late</span> <b>5</b>');
    expect(year).toContain('Year to date');
    expect(ReportBlocks.renderBlockAttendance(CID, MAX, ctx, { late: false })).not.toContain('Times Late');
  });
});
