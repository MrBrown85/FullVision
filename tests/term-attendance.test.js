/**
 * Attendance on the Term Questionnaire (Colin, 2026-10-24): at each report
 * the teacher copies the totals to date from MyEd. FullVision works out the
 * change since the last report that has totals, so nobody subtracts; the
 * report card prints both, and the comment can say it in a sentence.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
    expect(html).toContain('This Term');
    const year = ReportBlocks.renderBlockAttendance(CID, MAX, ctx, { period: 'year' });
    expect(year).toContain('Classes Absent</span> <b>10</b>');
    expect(year).toContain('Times Late</span> <b>5</b>');
    expect(year).toContain('Year to Date');
    expect(ReportBlocks.renderBlockAttendance(CID, MAX, ctx, { late: false })).not.toContain('Times Late');
  });

  it('keeps only whole numbers from 0 to 200: no rounding, no huge numbers', () => {
    saveTermAttendance(CID, MAX.id, 'term-2', 2.7, '1.2');
    expect(getTermAttendance(CID, MAX.id, 'term-2')).toMatchObject({ absences: null, lates: null });
    saveTermAttendance(CID, MAX.id, 'term-2', 99999999, '1e+21');
    expect(getTermAttendance(CID, MAX.id, 'term-2')).toMatchObject({ absences: null, lates: null });
    saveTermAttendance(CID, MAX.id, 'term-2', '200', 0);
    expect(getTermAttendance(CID, MAX.id, 'term-2')).toMatchObject({ absences: 200, lates: 0 });
    saveTermAttendance(CID, MAX.id, 'term-2', 201, '7');
    expect(getTermAttendance(CID, MAX.id, 'term-2')).toMatchObject({ absences: null, lates: 7 });
  });
});

describe('Report 2 with Report 1’s attendance blank (Colin, 2026-11-03: “Year total, no ‘this term’”)', () => {
  // The teacher left Report 1's attendance blank and entered Max's year
  // total of 14 at Report 2: nobody knows how many of the 14 were this term.
  beforeEach(() => {
    localStorage.clear();
    delete _cache.termRatings[CID];
    _cache.students[CID] = [MAX];
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
    saveTermAttendance(CID, MAX.id, 'term-2', 14, '');
  });

  it('knows this term’s share is unknown, not the whole total', () => {
    const att = getTermAttendance(CID, MAX.id, 'term-2');
    expect(att).toMatchObject({ absences: 14, absencesThisTerm: null, termUnknown: true });
    // Report 1 has its totals: the share is known again.
    saveTermAttendance(CID, MAX.id, 'term-1', 5, '');
    expect(getTermAttendance(CID, MAX.id, 'term-2')).toMatchObject({ absencesThisTerm: 9, termUnknown: false });
    // Report 1 itself has no earlier report.
    expect(getTermAttendance(CID, MAX.id, 'term-1')).toMatchObject({ absencesThisTerm: 5, termUnknown: false });
  });

  it('prints the total under Year to Date, not This Term', () => {
    const html = ReportBlocks.renderBlockAttendance(CID, MAX, { termId: 'term-2' }, {});
    expect(html).toContain('Classes Absent</span> <b>14</b>');
    expect(html).toContain('Year to Date');
    expect(html).not.toContain('This Term');
    const half = ReportBlocks.renderBlockAttendance(CID, MAX, { termId: 'term-2' }, { size: 'half' });
    expect(half).toContain('Year to Date');
    expect(half).not.toContain('This Term');
  });

  it('Generate states the year total with no “this term” sentence', () => {
    const ctx = CommentBank.context(CommentBank.facts(CID, MAX, 'term-2'), {});
    const habits = CommentBank.parts(ctx, '', { more: { habits: true } })[0];
    const att = habits.rows.filter(r => r.group === 'Attendance').map(r => r.text);
    // h63 only: the other absences-only frames (h62, h64-h66) say "this term".
    expect(att).toEqual(['In attendance, he has missed 14 classes so far.']);
    for (let seed = 1; seed <= 20; seed++) {
      const d = CommentBank.draft(ctx, { seed });
      const said = d.sentences.filter(x => x.step === 'attendance').map(x => x.text);
      expect(said).toHaveLength(1);
      expect(said[0]).toMatch(/^In attendance, (he|Max) has missed 14 classes so far\.$/);
    }
  });

  it('offers no teacher-written attendance sentence that says “this term”', () => {
    const ctx = CommentBank.context(CommentBank.facts(CID, MAX, 'term-2'), {});
    const mine = text => ({
      id: 'mine:t',
      part: 'habits',
      group: 'Attendance',
      text,
      needs: ['absentCount'],
      claims: ['attendance'],
      mine: true,
      src: 'yours',
    });
    expect(CommentBank.fits(mine('This term, {he} has missed {absentCount} classes.'), ctx)).toBe(false);
    expect(CommentBank.fits(mine('{He} has missed {absentCount} classes so far this year.'), ctx)).toBe(true);
  });
});

describe('the Attendance card’s boxes (live run: 99999999 and 1e+21 printed, 2.7 became “two”)', () => {
  const RQ = ReportQuestionnaire;
  let hadDoc, oldDoc, els;
  const input = (value, badInput) => {
    const cls = new Set();
    const attrs = {};
    return {
      value,
      validity: { badInput: !!badInput },
      classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: c => cls.has(c) },
      setAttribute: (k, v) => (attrs[k] = v),
      removeAttribute: k => delete attrs[k],
      attrs,
    };
  };
  beforeEach(() => {
    localStorage.clear();
    delete _cache.termRatings[CID];
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    els = { 'tq-att-absences': input(''), 'tq-att-lates': input(''), 'tq-att-note': { innerHTML: '' } };
    globalThis.document = {
      getElementById: id => els[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    // No student on screen: the card saves and redraws its note only.
    RQ.configure({ activeCourse: CID, renderReports: () => {} });
    RQ.tqStudentIndex = 0;
  });
  afterEach(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
  });
  const enter = (a, l) => {
    els['tq-att-absences'].value = a;
    els['tq-att-lates'].value = l;
    RQ.tqSetAttendance(MAX.id);
    return getTermAttendance(CID, MAX.id, ReportBlocks.getTermId());
  };

  it('reads a box as a whole number from 0 to 200, or not at all', () => {
    expect(RQ.attendanceValue(input('3'))).toBe(3);
    expect(RQ.attendanceValue(input(' 0 '))).toBe(0);
    expect(RQ.attendanceValue(input('200'))).toBe(200);
    expect(RQ.attendanceValue(input(''))).toBe('');
    ['2.7', '-4', '201', '99999999', '1e+21', 'abc'].forEach(v => expect(RQ.attendanceValue(input(v))).toBeNull());
    expect(RQ.attendanceValue(input('', true))).toBeNull();
  });

  it('saves nothing from a box that holds anything else, and says so plainly', () => {
    expect(enter('3', '1')).toMatchObject({ absences: 3, lates: 1 });
    expect(els['tq-att-note'].innerHTML).toBe('Added to the comment.');
    for (const [a, l] of [
      ['99999999', '1e+21'],
      ['2.7', '1.2'],
      ['-4', '-1'],
      ['5', '201'],
    ]) {
      expect(enter(a, l)).toMatchObject({ absences: 3, lates: 1 });
      expect(els['tq-att-note'].innerHTML).toContain('Enter a whole number from 0 to 200.');
    }
    expect(els['tq-att-absences'].classList.contains('bad')).toBe(false);
    expect(els['tq-att-lates'].classList.contains('bad')).toBe(true);
    expect(els['tq-att-lates'].attrs['aria-invalid']).toBe('true');
    expect(enter('4', '2')).toMatchObject({ absences: 4, lates: 2 });
    expect(els['tq-att-lates'].classList.contains('bad')).toBe(false);
    expect(els['tq-att-note'].innerHTML).toBe('Added to the comment.');
  });
});
