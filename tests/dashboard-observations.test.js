/**
 * The dashboard's Observations card (teacher/dash-observations.js): By week
 * and By competency tabs, flags, the no-strength diamond, and how the
 * students split into columns. docs/DECISIONS.md, "Observations
 * (2026-10-18)", item 4.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const D = () => globalThis.DashObservations;
const ob = (date, sentiment = null, extra = {}) => ({
  id: 'o-' + date + '-' + (sentiment || 'none') + '-' + Math.random().toString(36).slice(2, 6),
  date,
  created: date + 'T15:00:00.000Z',
  sentiment,
  text: 'note',
  ...extra,
});

describe('DashObservations columns', () => {
  it('uses 1 column up to 15 students, 2 to 30, 3 from 31', () => {
    expect([1, 15, 16, 30, 31, 60].map(n => D().columnRule(n))).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('uses fewer columns when they do not fit, never fewer than 1', () => {
    const fixed = D().FIXED.week;
    const block = D().blockMinWidth(fixed, 8, 20);
    expect(D().obsGridColumns({ n: 27, cells: 8, minCell: 20, width: 2 * block + 24, fixed })).toBe(2);
    expect(D().obsGridColumns({ n: 27, cells: 8, minCell: 20, width: 2 * block + 23, fixed })).toBe(1);
    expect(D().obsGridColumns({ n: 40, cells: 8, minCell: 20, width: 10, fixed })).toBe(1);
    expect(D().obsGridColumns({ n: 40, cells: 8, minCell: 20, width: 5000, fixed })).toBe(3);
    // No width yet: the rule alone.
    expect(D().obsGridColumns({ n: 20, cells: 8, minCell: 20, width: 0, fixed })).toBe(2);
  });

  it('splits in roster order and pads the shorter columns to the same length', () => {
    const list = Array.from({ length: 7 }, (_, i) => 's' + i);
    expect(D().splitColumns(list, 2)).toEqual([
      ['s0', 's1', 's2', 's3'],
      ['s4', 's5', 's6', null],
    ]);
    const three = D().splitColumns(
      Array.from({ length: 31 }, (_, i) => i),
      3,
    );
    expect(three.map(c => c.length)).toEqual([11, 11, 11]);
    expect(three[2].filter(x => x === null)).toHaveLength(2);
    expect(D().splitColumns(['a'], 1)).toEqual([['a']]);
    expect(D().splitColumns([], 2)).toEqual([]);
  });
});

describe('DashObservations week marks', () => {
  it('shows one mark per observation up to 3, newest first', () => {
    const m = D().weekMarks([ob('2026-10-12', 'strength'), ob('2026-10-14', null), ob('2026-10-13', 'concern')]);
    expect(m).toMatchObject({ marks: ['none', 'concern', 'strength'], more: 0, moreLabel: '', total: 3 });
  });

  it('with more than 3, shows every type present once, then the newest, then +N', () => {
    const obs = [
      ob('2026-10-16', 'strength'),
      ob('2026-10-15', 'strength'),
      ob('2026-10-14', 'strength'),
      ob('2026-10-13', 'growth'),
      ob('2026-10-12', 'concern'),
    ];
    const m = D().weekMarks(obs);
    expect(m.marks).toEqual(['strength', 'growth', 'concern']);
    expect(m.more).toBe(2);
    expect(m.moreLabel).toBe('+2');
  });

  it('keeps a concern and an untyped note visible among many strengths', () => {
    const obs = [
      ...Array.from({ length: 6 }, (_, i) => ob('2026-10-1' + i, 'strength')),
      ob('2026-10-09', null),
      ob('2026-10-08', 'concern'),
    ];
    const m = D().weekMarks(obs);
    expect(m.marks.sort()).toEqual(['concern', 'none', 'strength']);
    expect(m.moreLabel).toBe('+5');
  });

  it('reads 9+ from ten more', () => {
    const obs = Array.from({ length: 13 }, (_, i) => ob('2026-10-' + String(10 + (i % 5)), 'growth'));
    expect(D().weekMarks(obs)).toMatchObject({ more: 10, moreLabel: '9+', total: 13 });
  });

  it('counts an unknown sentiment as untyped', () => {
    expect(D().obType({ sentiment: 'mixed' })).toBe('none');
    expect(D().obType({ sentiment: 'growth' })).toBe('growth');
  });
});

describe('DashObservations no strength recorded', () => {
  it('needs at least one observation and no strength', () => {
    expect(D().noStrength([])).toBe(false);
    expect(D().noStrength([ob('2026-10-12', 'growth'), ob('2026-10-13', null)])).toBe(true);
    expect(D().noStrength([ob('2026-10-12', 'growth'), ob('2026-10-13', 'strength')])).toBe(false);
  });
});

describe('DashObservations week window', () => {
  it('is the last 8 weeks with no term', () => {
    const w = D().weekWindow('2026-10-18', null);
    expect(w.weeks).toHaveLength(8);
    expect(w.weeks[0]).toBe('2026-08-24');
    expect(w.start).toBe('2026-08-24');
    expect(w.end).toBe('2026-10-18');
    expect(w.label).toBe('last 8 weeks');
  });

  it("is the picked term's weeks, bounded by the term's dates", () => {
    const term = { label: 'Term 1', startsOn: '2026-09-02', endsOn: '2026-11-20' };
    const w = D().weekWindow('2026-10-18', term);
    expect(w.weeks[0]).toBe('2026-08-31');
    expect(w.weeks[w.weeks.length - 1]).toBe('2026-10-12');
    expect(w.start).toBe('2026-09-02');
    expect(w.label).toBe('Term 1');
  });

  it('buckets a row by week and keeps overdue measured from today', () => {
    const win = D().weekWindow('2026-10-18', { label: 'Term 1', startsOn: '2026-09-02', endsOn: '2026-11-20' });
    const row = D().weekRow(
      { id: 's1' },
      [ob('2026-09-20', 'growth'), ob('2026-09-01', 'strength'), ob('2026-08-01', 'strength')],
      win,
      '2026-10-18',
    );
    // Sep 1 is before the term starts, though it is in the first week shown.
    expect(row.total).toBe(1);
    expect(row.noStrength).toBe(true);
    expect(row.overdue).toBe(true);
    expect(row.daysSince).toBe(28);
    const cell = row.cells.find(c => c.week === '2026-09-14');
    expect(cell.obs).toHaveLength(1);
  });

  it('reads the day from created when an observation has no date', () => {
    const win = D().weekWindow('2026-10-18', null);
    const row = D().weekRow({ id: 's1' }, [{ id: 'x', created: '2026-10-17T20:00:00.000Z' }], win, '2026-10-18');
    expect(row.total).toBe(1);
    expect(row.overdue).toBe(false);
    expect(row.daysSince).toBe(1);
  });
});

describe('DashObservations flags', () => {
  it('lists only flags above 0, per tab', () => {
    expect(
      D()
        .flagList('week', { overdue: 3, noStrength: 0, gap: 4 }, 'last 8 weeks')
        .map(f => f.key),
    ).toEqual(['overdue']);
    expect(
      D()
        .flagList('competency', { overdue: 3, noStrength: 2, gap: 4 }, 'last 8 weeks')
        .map(f => f.key),
    ).toEqual(['gap', 'nostr']);
    expect(D().flagList('week', { overdue: 0, noStrength: 0, gap: 0 }, 'last 8 weeks')).toEqual([]);
  });

  it('words the flags with the right verb and names the window on By competency', () => {
    const one = D().flagList('competency', { gap: 1, noStrength: 1 }, 'last 8 weeks');
    expect(one[0].text).toBe('has a competency with no evidence');
    expect(one[0].aria).toBe('Highlight 1 student with a competency that has no evidence');
    expect(one[1].text).toBe('with no strength recorded in the last 8 weeks');
    const many = D().flagList('competency', { gap: 2, noStrength: 0 }, 'Term 1');
    expect(many[0].text).toBe('have a competency with no evidence');
    expect(D().flagList('competency', { gap: 0, noStrength: 3 }, 'Term 1')[0].text).toBe(
      'with no strength recorded in Term 1',
    );
  });

  it('dims the students a highlight does not match', () => {
    const row = { overdue: true, noStrength: false, gaps: 0 };
    expect(D().rowMatches(row, null)).toBe(true);
    expect(D().rowMatches(row, 'overdue')).toBe(true);
    expect(D().rowMatches(row, 'nostr')).toBe(false);
    expect(D().rowMatches(row, 'gap')).toBe(false);
  });
});

describe('DashObservations competency evidence', () => {
  const term = { startsOn: '2026-09-01', endsOn: '2026-11-30' };

  it('counts distinct assessments scored above 0 across the tags, and linked observations', () => {
    const scores = [
      [
        { assessmentId: 'a1', score: 3 },
        { assessmentId: 'a2', score: 0 },
      ],
      [
        { assessmentId: 'a1', score: 2 },
        { assessmentId: 'a3', score: 4 },
      ],
    ];
    const obs = [ob('2026-10-01', null, { competencyId: 't1' }), ob('2026-10-02', null, { competencyId: 'other' })];
    expect(D().sectionEvidenceCount(scores, obs, ['t1', 't2'], null)).toBe(3);
  });

  it('counts only observations inside the term', () => {
    const obs = [ob('2026-06-01', null, { competencyId: 't1' }), ob('2026-10-02', null, { competencyId: 't1' })];
    expect(D().sectionEvidenceCount([], obs, ['t1'], term)).toBe(1);
    expect(D().sectionEvidenceCount([], obs, ['t1'], null)).toBe(2);
  });

  it('is a gap only with no evidence; a level of 0 with evidence is a dash', () => {
    expect(D().competencyCell('c-x', 0, 0)).toMatchObject({ gap: true, level: 0 });
    expect(D().competencyCell('c-x', 0, 2)).toMatchObject({ gap: false, level: 0, text: '—' });
  });

  describe('as the class shows grades', () => {
    const CID = 'c-dash-obs-mode';
    afterEach(() => delete COURSES[CID]);
    const setting = gradingSystem => (COURSES[CID] = { id: CID, name: 'Test', gradingSystem });

    it('shows a level in a Proficiency class', () => {
      setting('proficiency');
      expect(D().competencyCell(CID, 3.33, 4)).toMatchObject({ text: '3.3', level: 3, gap: false });
    });

    it('shows a % and no proficiency word in a Letter class', () => {
      setting('letter');
      const c = D().competencyCell(CID, 3, 4);
      expect(c.text).toBe('75%');
      expect(c.text).not.toMatch(/Extending|Proficient|Developing|Emerging/);
    });

    it('shows both in a Both class', () => {
      setting('both');
      expect(D().competencyCell(CID, 2, 1).text).toBe('2.0 · 50%');
    });
  });
});

describe('DashObservations labels', () => {
  it("uses the first tag's label, cut at about 24 characters", () => {
    expect(D().headerLabel({ name: 'Questioning and Predicting', tags: [{ label: 'Question and Predict' }] })).toBe(
      'Question and Predict',
    );
    expect(D().headerLabel({ name: 'Evaluating', tags: [] })).toBe('Evaluating');
    const long = D().headerLabel({ name: 'x', tags: [{ label: 'Communicate scientific ideas and information' }] });
    expect(long.length).toBeLessThanOrEqual(24);
    expect(long.endsWith('…')).toBe(true);
  });

  it('gives the full name as "Section: tag"', () => {
    expect(D().headerFull({ name: 'Questioning and Predicting', tags: [{ label: 'Question and Predict' }] })).toBe(
      'Questioning and Predicting: Question and Predict',
    );
    expect(D().headerFull({ name: 'Evaluating', tags: [{ label: 'Evaluating' }] })).toBe('Evaluating');
  });

  it('shortens a row name to first name and last initial', () => {
    expect(D().rowName({ firstName: 'Christopher', lastName: 'Vance' })).toBe('Christopher V.');
    expect(D().rowName({ firstName: 'Ana', preferred: 'Annie', lastName: 'Lopez' })).toBe('Annie L.');
    expect(D().rowName({ firstName: 'Ana', lastName: '' })).toBe('Ana');
  });
});
