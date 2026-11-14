/**
 * The built form a class saved with the old Page Studio (teacher/report-sheets.js):
 * sides of rows, each row one block at Row width or one or two at Side by
 * Side width, migration from every earlier shape, and the block registry.
 * One Report reads a saved form through these (ReportOne.fromForm).
 * docs/DECISIONS.md "Report forms" 13.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

const S = ReportSheets;
const blocksOf = f => f.sides.flatMap(sd => sd.rows.flatMap(r => r.cells.map(c => c.block)));
const cellOf = (f, id) => {
  for (const sd of f.sides) for (const row of sd.rows) for (const c of row.cells) if (c.block === id) return c;
  return null;
};
const rowsOf = (f, side) =>
  f.sides[side].rows.map(r => r.cells.map(c => c.block + (c.size === 'half' ? '/half' : '')).join('+'));

describe('normalizeForm', () => {
  it('is the Report Card when nothing is saved', () => {
    const f = S.normalizeForm(undefined);
    expect(f.v).toBe(6);
    expect(Object.keys(f)).toEqual(['v', 'id', 'name', 'type', 'sides', 'pinned', 'perStudent']);
    expect(f.sides).toHaveLength(2);
    expect(rowsOf(f, 0)).toEqual([
      'header',
      'proficiency',
      'legend',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
    expect(rowsOf(f, 1)).toEqual(['self-assessment', 'grade-table', 'parent-response']);
    expect(cellOf(f, 'teacher-narrative')).toEqual({ block: 'teacher-narrative', size: 'row', lines: 10 });
    expect(cellOf(f, 'parent-response')).toEqual({ block: 'parent-response', size: 'row', lines: 3 });
    expect(f.pinned).toBe('parent-response');
    expect(f.type).toBe('standard');
    expect(f).not.toHaveProperty('pagesPerStudent');
    expect(f).not.toHaveProperty('pages');
  });

  it('migrates a v5 grid form: blocks in (row, column) order become rows, two half-wide blocks on one grid row a pair, a fill block’s rows its lines', () => {
    const f = S.normalizeForm({
      v: 5,
      id: 'mine',
      name: 'Mine',
      pages: [
        {
          blocks: [
            { block: 'header', x: 0, y: 0, w: 12 },
            { block: 'teacher-narrative', x: 0, y: 5, w: 12, h: 13, options: { x: 1 } },
            { block: 'legend', x: 6, y: 18, w: 6, h: 6 },
            { block: 'missing-work', x: 0, y: 18, w: 6, h: 6 },
            { block: 'proficiency', x: 0, y: 24, w: 8, h: 13 },
            { block: 'observations', x: 8, y: 24, w: 4, h: 13 },
            { block: 'growth', x: 0, y: 37, w: 5, h: 8 },
          ],
        },
        { blocks: [{ block: 'parent-response', x: 0, y: 30, w: 12, h: 10 }] },
      ],
      pinned: 'parent-response',
      perStudent: { st1: { hide: ['legend'] } },
    });
    expect(f.v).toBe(6);
    expect(f.id).toBe('mine');
    expect(rowsOf(f, 0)).toEqual([
      'header',
      'teacher-narrative',
      'missing-work/half+legend/half',
      'proficiency',
      'observations/half',
      'growth/half',
    ]);
    // 13 rows × 20px less the box's 40px, in 22px lines: 10.
    expect(cellOf(f, 'teacher-narrative')).toEqual({
      block: 'teacher-narrative',
      size: 'row',
      lines: 10,
      options: { x: 1 },
    });
    expect(cellOf(f, 'parent-response').lines).toBe(7);
    expect(f.pinned).toBe('parent-response');
    expect(f.perStudent).toEqual({ st1: { hide: ['legend'] } });
  });

  it('migrates a v4 form through v5: spans become widths, lines stay lines', () => {
    const f = S.normalizeForm({
      v: 4,
      pages: [
        {
          rows: [
            { cells: [{ block: 'header', span: 12 }] },
            { cells: [{ block: 'teacher-narrative', span: 12, height: 'fixed', lines: 6 }] },
            {
              cells: [
                { block: 'proficiency', span: 6 },
                { block: 'legend', span: 6 },
              ],
            },
          ],
        },
        { rows: [{ cells: [{ block: 'parent-response', span: 12 }] }] },
      ],
      pinned: 'parent-response',
    });
    expect(rowsOf(f, 0)).toEqual(['header', 'teacher-narrative', 'proficiency/half+legend/half']);
    expect(cellOf(f, 'teacher-narrative').lines).toBe(6);
    expect(rowsOf(f, 1)).toEqual(['parent-response']);
  });

  it('migrates a v3 form through v4: a pair is two halves, the pin is the form’s', () => {
    const f = S.normalizeForm({
      v: 3,
      front: [{ block: 'header' }, { pair: [{ block: 'proficiency' }, { block: 'legend' }] }],
      back: [{ block: 'learner-dimensions' }, { block: 'parent-response', pinned: true }],
    });
    expect(rowsOf(f, 0)).toEqual(['header', 'proficiency/half+legend/half']);
    expect(rowsOf(f, 1)).toEqual(['learner-dimensions', 'parent-response']);
    expect(f.pinned).toBe('parent-response');
  });

  it('drops unknown blocks, duplicates and extra fields, keeps empty sides, and makes the pinned block last at Row width', () => {
    const f = S.normalizeForm({
      v: 6,
      sides: [
        {
          rows: [
            {
              cells: [
                { block: 'parent-response', size: 'half', extra: 1 },
                { block: 'legend', size: 'half' },
              ],
            },
            { cells: [{ block: 'nope' }] },
            { cells: [{ block: 'legend' }] },
            {
              cells: [
                { block: 'student-reflection-learning', size: 'half' },
                { block: 'observations', size: 'half' },
              ],
            },
            { cells: [{ block: 'header', options: { school: false } }] },
          ],
        },
        { rows: [] },
        { rows: [{ cells: [{ block: 'teacher-narrative', lines: 99 }] }] },
      ],
      pinned: 'parent-response',
    });
    expect(rowsOf(f, 0)).toEqual([
      'header',
      'legend/half',
      'student-reflection-learning',
      'observations/half',
      'parent-response',
    ]);
    expect(cellOf(f, 'parent-response')).toEqual({ block: 'parent-response', size: 'row', lines: 3 });
    expect(cellOf(f, 'header')).toEqual({ block: 'header', size: 'row', options: { school: false } });
    expect(f.sides[1].rows).toEqual([]);
    expect(cellOf(f, 'teacher-narrative').lines).toBe(16);
    expect(S.canHalf('student-reflection-learning')).toBe(false);
    expect(S.canHalf('parent-response')).toBe(false);
    expect(S.canHalf('legend')).toBe(true);
  });

  it('formFor opens a class with no saved form on the name and Assignment Grades', () => {
    expect(S.formFor({ preset: 'brief' }).id).toBe('grades');
    expect(S.formFor({ preset: 'standard' }).id).toBe('grades');
    expect(blocksOf(S.formFor(null))).toEqual(['header', 'grade-table']);
    // Assignment Grades is One Report's Assessments part now: the form's
    // one column, by month, newest first, as it printed.
    const m = ReportOne.fromForm(S.formFor(null));
    expect(m.parts).toEqual(['header', 'assessments']);
    expect(m.options.assessments).toEqual({ organize: 'month', order: 'newest', columns: 'one' });
    expect(S.formFor({ form: { v: 6, id: 'x', sides: [] } }).id).toBe('x');
  });
});

describe('the block registry', () => {
  it('optionsFor fills the registry defaults and adds the no-evidence rule and the lines', () => {
    expect(S.optionsFor({ block: 'competency-table' })).toEqual({
      evidence: true,
      ican: false,
      assignments: false,
      noEvidence: 'show',
      size: 'row',
    });
    expect(S.optionsFor({ block: 'competency-table', options: { ican: true }, noEvidence: 'hide' })).toMatchObject({
      ican: true,
      noEvidence: 'hide',
    });
    expect(S.optionsFor({ block: 'parent-response', lines: 5 })).toEqual({ lines: 5, size: 'row' });
    expect(S.optionsFor({ block: 'legend' })).toEqual({ size: 'row' });
    expect(S.optionsFor({ block: 'legend', size: 'half' })).toEqual({ size: 'half' });
  });

  it('every option in the registry has a key, a Title Case label and a default; every block a label and a group', () => {
    Object.keys(S.BLOCKS).forEach(id => {
      const def = S.BLOCKS[id];
      expect(def.label).toMatch(/^[A-Z]/);
      if (id !== 'header')
        expect(['Grades', 'Comments and Evidence', 'Student Voice', 'Learner Profile', 'Family']).toContain(def.group);
      expect(def).not.toHaveProperty('rows');
      (def.options || []).forEach(o => {
        expect(o.key).toMatch(/^[a-z][A-Za-z]*$/);
        expect(o.label).toMatch(/^[A-Z]/);
        expect(o).toHaveProperty('def');
      });
      if (def.fill && def.lines) {
        expect(def.minLines).toBeLessThanOrEqual(def.lines);
        expect(def.maxLines).toBeGreaterThanOrEqual(def.lines);
      }
    });
  });
});

describe('rendering with options', () => {
  it('the text block prints its title and text, and nothing when empty', () => {
    expect(ReportBlocks.renderReportBlock('text-block', 'c1', {}, {}, {})).toBe('');
    const html = ReportBlocks.renderReportBlock(
      'text-block',
      'c1',
      {},
      {},
      {
        title: 'Upcoming',
        text: 'Science fair\non Nov 30 <b>',
      },
    );
    expect(html).toContain('Upcoming');
    expect(html).toContain('Science fair<br>on Nov 30 &lt;b&gt;');
  });

  it('the Parent / Guardian Response sizes its comments box by its lines and keeps its wording', () => {
    const three = ReportBlocks.renderReportBlock(
      'parent-response',
      'c1',
      { firstName: 'A', lastName: 'B' },
      {},
      { lines: 3 },
    );
    expect(three).toContain('min-height:82px');
    expect(three).toContain('Please review this report with your child and return this section to the school.');
    const six = ReportBlocks.renderReportBlock(
      'parent-response',
      'c1',
      { firstName: 'A', lastName: 'B' },
      {},
      { lines: 6 },
    );
    expect(six).toContain('min-height:148px');
  });
});

describe('stage 3 blocks', () => {
  const CID = 'course-s3';
  const CECE = { id: 's1', firstName: 'Cece', lastName: 'Adeyemi', pronouns: 'she/her' };
  const keep = {};
  const stub = (name, fn) => {
    if (!(name in keep)) keep[name] = globalThis[name];
    globalThis[name] = fn;
  };
  const text = html =>
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&mdash;/g, '—')
      .replace(/\s+/g, ' ')
      .trim();
  const tags = [
    { id: 't1', label: 'Plan', i_can_statements: ['I can plan a fair test with my partner.'] },
    { id: 't2', label: 'Share', i_can_statements: ['I can explain my thinking to myself and others'] },
    { id: 't3', label: 'Ask', i_can_statements: ['Asks good questions'] },
  ];
  const prof = { t1: 2, t2: 3, t3: 4 };
  beforeEach(() => {
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
    stub('getAllTags', () => tags);
    stub('getTagProficiency', (cid, sid, tid) => prof[tid] || 0);
    stub('getSectionForTag', () => ({ name: 'Questioning and Predicting' }));
  });
  afterEach(() => {
    Object.keys(keep).forEach(k => (globalThis[k] = keep[k]));
    Object.keys(keep).forEach(k => delete keep[k]);
  });

  /* A class of two competencies with dated, scored work for the Focus Area
     helpers: Plan (3.0 → 3.3) and Share (3.0 → 2.7). */
  function focusClass() {
    const work = [
      { id: 'a1', title: 'Lab Report', date: '2026-09-10' },
      { id: 'a2', title: 'Quiz', date: '2026-10-05' },
      { id: 'a3', title: 'Poster', date: '2026-10-20' },
    ];
    const secs = [
      {
        id: 'p',
        name: 'Planning',
        tags: [{ id: 't1', label: 'Plan', i_can_statements: ['I can plan a fair test with my partner.'] }],
      },
      {
        id: 's',
        name: 'Communicating',
        tags: [{ id: 't2', label: 'Share', i_can_statements: ['I can explain my thinking to myself and others'] }],
      },
    ];
    stub('getAssessments', () => work);
    stub('assessmentInYearToDate', () => true);
    stub('assessmentInTermWindow', () => true);
    stub('getActiveTerm', () => null);
    stub('getGroupedSections', () => ({ groups: [], ungrouped: [] }));
    stub('getSections', () => secs);
    stub('getSectionProficiency', (cid, sid, id) => ({ p: 3.3, s: 2.7 })[id]);
    stub('getTagScores', (cid, sid, tid) =>
      tid === 't1'
        ? [
            { assessmentId: 'a1', score: 3 },
            { assessmentId: 'a2', score: 3.33 },
            { assessmentId: 'a3', score: 3.33 },
          ]
        : [
            { assessmentId: 'a1', score: 3 },
            { assessmentId: 'a2', score: 2.67 },
            { assessmentId: 'a3', score: 2.67 },
          ],
    );
    stub('getStudentTermRating', () => null);
  }

  it('the Focus Area is the questionnaire’s pick, else the competency whose level changed most', () => {
    focusClass();
    // Both moved 0.3; the lowest now wins the tie.
    expect(ReportBlocks.focusArea(CID, CECE, {}).name).toBe('Share');
    expect(ReportBlocks.focusArea(CID, CECE, {}, 'highest').name).toBe('Plan');
    expect(ReportBlocks.focusArea(CID, CECE, {}, 'lowest').name).toBe('Share');
    stub('getStudentTermRating', () => ({ focusSectionId: 'p' }));
    expect(ReportBlocks.focusArea(CID, CECE, {}).name).toBe('Plan');
    expect(ReportBlocks.focusArea(CID, CECE, {}).picked).toBe(true);
    stub('getSectionProficiency', () => 0);
    expect(ReportBlocks.focusArea(CID, CECE, {})).toBeNull();
  });

  it('Next Steps prints the Focus Area, its I Can statement and the latest score; the next lowest on request', () => {
    focusClass();
    const html = ReportBlocks.renderReportBlock('next-steps', CID, CECE, {}, {});
    expect(text(html)).toBe(
      // The mark as a student reads it: the level with its ± (DECISIONS, "Student-facing levels are proficiencies").
      'Next Steps Share “I can explain my thinking to myself and others” Latest: Poster, Oct 20 · Proficient −',
    );
    expect(html).not.toMatch(/[●○]/);
    const two = text(ReportBlocks.renderReportBlock('next-steps', CID, CECE, {}, { areas: 'two', latest: false }));
    expect(two).toBe(
      'Next Steps Share “I can explain my thinking to myself and others” Plan “I can plan a fair test with my partner.”',
    );
    stub('getSectionProficiency', () => 0);
    expect(ReportBlocks.renderReportBlock('next-steps', CID, CECE, {}, {})).toBe('');
  });

  it('a letter class reads every mark as a percent: Next Steps, Progress and Proficiency', () => {
    focusClass();
    COURSES[CID].gradingSystem = 'letter';
    try {
      expect(text(ReportBlocks.renderReportBlock('next-steps', CID, CECE, {}, {}))).toContain(
        'Latest: Poster, Oct 20 · 67%',
      );
      const prog = text(ReportBlocks.renderReportBlock('progress', CID, CECE, {}, {}));
      // Now is the level the Proficiency block prints (2.7 is 68%).
      expect(prog).toContain('Start of term 75% Now 68% (−7% this term)');
      expect(prog).toContain('Best Lab Report, Sep 10 · 75%');
      expect(prog).not.toMatch(/Proficient|\/ 4/);
      const prof = text(
        ReportBlocks.renderReportBlock(
          'proficiency',
          CID,
          CECE,
          {},
          S.optionsFor({ block: 'proficiency' }, ReportBlocks.showDefaults(CID)),
        ),
      );
      expect(prof).not.toContain('Proficient');
      expect(prof).toMatch(/Plan \d+% 83% [+−]?\d+% 3/);
      COURSES[CID].gradingSystem = 'both';
      expect(text(ReportBlocks.renderReportBlock('next-steps', CID, CECE, {}, {}))).toContain(
        'Latest: Poster, Oct 20 · Proficient − · 67%',
      );
      // Both: Proficiency shows the proficiency and the %, and the change in words, no figure out of 4.
      const both = text(
        ReportBlocks.renderReportBlock(
          'proficiency',
          CID,
          CECE,
          {},
          S.optionsFor({ block: 'proficiency' }, ReportBlocks.showDefaults(CID)),
        ),
      );
      expect(both).toMatch(/Plan \w+ · \d+% Proficient · 83% (Same|↑ Up|↓ Down) 3/);
      expect(both).not.toMatch(/\d\.\d/);
      expect(text(ReportBlocks.renderReportBlock('progress', CID, CECE, {}, {}))).toContain(
        'Now Proficient · 68% (Same this term)',
      );
    } finally {
      COURSES[CID].gradingSystem = 'proficiency';
    }
  });

  it('Ways to Support at Home is gone: a saved form that has it prints nothing there', () => {
    focusClass();
    expect(ReportBlocks.renderReportBlock('support-home', CID, CECE, {}, {})).toBe('');
    expect(S.BLOCKS['support-home']).toBeUndefined();
  });

  it('Progress in One Area lists every score this term with the start, now, best, latest and the I Can statement', () => {
    focusClass();
    const html = ReportBlocks.renderReportBlock('progress', CID, CECE, {}, {});
    const t = text(html);
    expect(t).toContain('Progress: Share · Communicating Focus area (biggest change)');
    // Words, not figures: 3.0 to 2.7 is Proficient both times (DECISIONS, "Student-facing levels are proficiencies").
    expect(t).toContain('Start of term Proficient Now Proficient (Same this term)');
    expect(t).toContain('Best Lab Report, Sep 10 · Proficient');
    expect(t).toContain('Latest Poster, Oct 20 · Proficient −');
    expect(t).toContain('Working toward “I can explain my thinking to myself and others”');
    expect(t).toContain(
      'Date Every score this term Score Sep 10 Lab Report Proficient Oct 5 Quiz Proficient − Oct 20 Poster Proficient −',
    );
    expect(html).not.toMatch(/[●○]/);
    const high = text(
      ReportBlocks.renderReportBlock('progress', CID, CECE, {}, { area: 'highest', list: false, toward: false }),
    );
    expect(high).toContain('Progress: Plan · Planning Highest now');
    expect(high).toContain('Now Proficient (Same this term)');
    expect(high).not.toContain('Every score');
    expect(high).not.toContain('Working toward');
    expect(ReportBlocks.renderReportBlock('progress', CID, CECE, {}, { size: 'half' })).toContain(
      'report-progress-half',
    );
    stub('getSectionProficiency', () => 0);
    expect(ReportBlocks.renderReportBlock('progress', CID, CECE, {}, {})).toBe('');
  });

  it('Only Missing Work lists the work labelled Missing, or says None as of today', () => {
    const work = [
      { id: 'a1', title: 'Lab Report', dueDate: '2026-10-02' },
      { id: 'a2', title: 'Quiz', date: '2026-10-05' },
      { id: 'a3', title: 'Poster', date: '2026-10-07' },
      { id: 'a4', title: 'Essay', date: '2026-10-08' },
    ];
    stub('getAssessments', () => work);
    stub('assessmentInYearToDate', () => true);
    stub('assessmentInTermWindow', () => true);
    stub('courseToday', () => '2026-10-10');
    // The Lab Report is past due with nothing in it: not missing.
    stub('assessmentCellValue', (cid, sid, a) =>
      a.id === 'a1'
        ? { kind: 'none', status: null }
        : a.id === 'a2' || a.id === 'a4'
          ? { kind: 'status', status: 'NS' }
          : { kind: 'level' },
    );
    // The Missing Work block is the Assessments part's Only Missing Work now.
    expect(ReportBlocks.renderReportBlock('missing-work', CID, CECE, {}, {})).toBe('');
    const stage = { innerHTML: '', firstChild: { offsetHeight: 50 }, querySelectorAll: () => [] };
    const list = o => text(GradeReport.listPart(CID, CECE, Object.assign({ missingOnly: true }, o), stage).html);
    const t = list({});
    expect(t).toContain('Quiz');
    expect(t).toContain('Essay');
    expect(t).not.toContain('Lab Report');
    expect(t).not.toContain('Poster');
    expect(GradeReport.rows(CID, CECE, { missingOnly: true }).map(r => r.title)).toEqual(['Quiz', 'Essay']);
    stub('assessmentCellValue', () => ({ kind: 'level' }));
    expect(list({})).toBe('None As of Oct 10, 2026');
    // The whole list, Missing Work off: its rows and nothing about missing.
    expect(GradeReport.listPart(CID, CECE, { ungraded: false }, stage).html).toBe('');
  });

  it('Attendance prints the questionnaire’s totals for this term or the year, and nothing when none are entered', () => {
    stub('getTermAttendance', () => ({ absences: 5, lates: 2, absencesThisTerm: 3, latesThisTerm: 1 }));
    expect(text(ReportBlocks.renderReportBlock('term-attendance', CID, CECE, { termId: 'term-2' }, {}))).toBe(
      'Attendance Classes Absent 3 Times Late 1 This Term',
    );
    expect(
      text(
        ReportBlocks.renderReportBlock(
          'term-attendance',
          CID,
          CECE,
          { termId: 'term-2' },
          { period: 'year', late: false },
        ),
      ),
    ).toBe('Attendance Classes Absent 5 Year to Date');
    expect(
      text(ReportBlocks.renderReportBlock('term-attendance', CID, CECE, { termId: 'term-2' }, { size: 'half' })),
    ).toBe('Attendance This Term 3 Classes Absent 1 Times Late');
    stub('getTermAttendance', () => ({ absences: null, lates: null }));
    expect(ReportBlocks.renderReportBlock('term-attendance', CID, CECE, { termId: 'term-2' }, {})).toBe('');
  });

  it('Learning Dispositions prints each rated habit as how often, Rarely to Consistently', () => {
    stub('getStudentTermRating', () => ({ habits: { completes: 4, part: 2, ready: 5, devices: 1 } }));
    const html = ReportBlocks.renderReportBlock('learner-dimensions', CID, CECE, { termId: 'term-2' }, {});
    const t = text(html);
    // A table: each rated habit, what it means for a family, the teacher's word.
    expect(t).toContain('Learning Dispositions From my observation in class');
    expect(t).toContain('Work Habit Teacher Completes Work Hands in assignments complete and on time');
    expect(t).toMatch(/Completes Work [^]*? Consistently Takes Part [^]*? Sometimes Uses Devices Well [^]*? Rarely/);
    // What the four words mean.
    expect(t).toContain('Consistently almost always, without reminders');
    expect(html).not.toMatch(/[●○]|Thriving|Developing|Not Seen/);
    expect(html).not.toContain('report-bubble');
    expect((html.match(/<tr>/g) || []).length).toBe(4);
    const all = text(
      ReportBlocks.renderReportBlock(
        'learner-dimensions',
        CID,
        CECE,
        { termId: 'term-2' },
        { rated: false, scale: false },
      ),
    );
    expect(all).toMatch(/Works With Others [^]*? —/);
    expect(all).not.toContain('Comes Ready');
    expect(all).not.toContain('without reminders');
    // Student Self-Assessment: every habit, with a circle under each word for the student.
    const mine = ReportBlocks.renderReportBlock(
      'learner-dimensions',
      CID,
      CECE,
      { termId: 'term-2' },
      { student: true },
    );
    expect(text(mine)).toContain(displayNameFirst(CECE) + '’s Own Rating');
    expect(text(mine)).toContain('Rarely Sometimes Usually Consistently');
    expect((mine.match(/report-bubble/g) || []).length).toBe(6 * 4);
    expect(text(mine)).toContain('Comes Ready, Uses Class Time');
    expect(mine).not.toContain('Not Seen');
    stub('getStudentTermRating', () => ({ habits: { ready: 5 } }));
    expect(ReportBlocks.renderReportBlock('learner-dimensions', CID, CECE, { termId: 'term-2' }, {})).toBe('');
    stub('getStudentTermRating', () => ({ dims: { engagement: 4 } }));
    expect(ReportBlocks.renderReportBlock('learner-dimensions', CID, CECE, { termId: 'term-2' }, {})).toBe('');
    stub('getStudentTermRating', () => ({ dims: {} }));
    expect(ReportBlocks.renderReportBlock('learner-dimensions', CID, CECE, { termId: 'term-2' }, {})).toBe('');
    // With nothing rated, the student's own column still prints.
    expect(
      ReportBlocks.renderReportBlock('learner-dimensions', CID, CECE, { termId: 'term-2' }, { student: true }),
    ).toContain('report-bubble');
  });

  it('Self-Assessment and Goal prints the student’s own words: strength, Core Competency answers, goal, check-in and next step', () => {
    const entries = [
      {
        kind: 'goal_checkin',
        title: 'Goal Check-In',
        at: '2025-11-07',
        items: [
          { q: { kind: 'goal_status' }, v: { num: 2, text: 'Working On It' } },
          { q: { kind: 'text' }, v: { text: 'Ask for the lab sheet a day early.' } },
          { q: { kind: 'core_pick' }, v: { text: 'PAR' } },
          { q: { kind: 'text' }, v: { text: 'Check my goals every Friday.' } },
        ],
      },
      {
        kind: 'core_reflection',
        title: 'November Reflection',
        at: '2025-11-07',
        items: [
          {
            q: { kind: 'scale4', core_ids: ['PAR', 'PPI'] },
            v: {
              json: {
                levels: { PAR: 2, PPI: 3 },
                why: { PAR: 'I set goals but I forget to check on them.', PPI: 'My family matters to me.' },
              },
            },
          },
        ],
      },
      {
        kind: 'about_me',
        title: 'About Me',
        at: '2025-09-16',
        items: [{ q: { kind: 'text', repeated_key: 'good_at' }, v: { text: 'I ask a lot of questions.' } }],
      },
    ];
    stub('StudentVoice', {
      entries: () => entries,
      profile: () => ({
        about: { goodAt: entries[2].items[0] },
        checkin: { status: entries[0].items[0], next: entries[0].items[1], coreGoal: entries[0].items[3] },
        reflections: [entries[1]],
      }),
    });
    {
      const html = ReportBlocks.renderReportBlock('self-assessment', CID, CECE, {}, {});
      expect(text(html)).toBe(
        "Self-Assessment and Goal In Cece's own words, About Me and November Reflection and Goal Check-In What I'm good at as a learner “I ask a lot of questions.” Personal Awareness and Responsibility “I set goals but I forget to check on them.” Personal and Cultural Identity “My family matters to me.” My goal “Check my goals every Friday.” How it's going Working On It What I'll do next “Ask for the lab sheet a day early.”",
      );
      const goalOnly = text(
        ReportBlocks.renderReportBlock('self-assessment', CID, CECE, {}, { strength: false, core: false }),
      );
      expect(goalOnly).toBe(
        "Self-Assessment and Goal In Cece's own words, Goal Check-In My goal “Check my goals every Friday.” How it's going Working On It What I'll do next “Ask for the lab sheet a day early.”",
      );
      expect(ReportBlocks.renderReportBlock('self-assessment', CID, CECE, {}, { size: 'half' })).toContain(
        'report-self-half',
      );
      globalThis.StudentVoice.entries = () => [];
      expect(ReportBlocks.renderReportBlock('self-assessment', CID, CECE, {}, {})).toBe('');
    }
  });

  it('This Term at a Glance counts the term’s work and names the strongest and growing competency', () => {
    const work = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' }];
    const cells = {
      a1: { kind: 'level', late: true },
      a2: { kind: 'points' },
      a3: { kind: 'none', status: null },
      a4: { kind: 'status', status: 'NS' },
    };
    stub('getAssessments', () => work);
    stub('assessmentInYearToDate', () => true);
    stub('assessmentInTermWindow', () => true);
    stub('assessmentCellValue', (cid, sid, a) => cells[a.id]);
    stub('getActiveTerm', () => ({ ordinal: 2, startsOn: '2026-09-01', endsOn: '2026-11-30' }));
    stub('getStudentQuickObs', () => [
      { date: '2026-10-01' },
      { created: '2026-09-15T10:00:00Z' },
      { date: '2026-06-01' },
    ]);
    stub('getGroupedSections', () => ({ groups: [], ungrouped: [] }));
    stub('getSections', () => [
      { id: 'q', name: 'Questioning' },
      { id: 'p', name: 'Planning' },
      { id: 'c', name: 'Communicating', shortName: 'Comm.' },
    ]);
    // The competencies as the comment reads them (CommentBank.compsOf):
    // Strongest and Growing pass its gates: 3+ pieces for Strongest, 2+
    // for Growing (the next step), in the year to date.
    const pieces = n => Array.from({ length: n }, (_, i) => ({ id: 'w' + i, v: 3, d: '2026-09-1' + i }));
    const comps = [
      { id: 'q', level: 3, scores: pieces(3) },
      { id: 'p', level: 2.2, scores: pieces(3) },
      { id: 'c', level: 3.6, scores: pieces(3) },
    ];
    const compsOf = CommentBank.compsOf;
    CommentBank.compsOf = () => comps;
    try {
      expect(text(ReportBlocks.renderReportBlock('term-glance', CID, CECE, {}, {}))).toBe(
        'This Term at a Glance 2 Assessed 1 Late 1 Missing 2 Observations Comm. Strongest Planning Growing',
      );
      // On two pieces Communicating is not Strongest, and on one Planning
      // is not Growing: the box names only what the comment can.
      comps[2].scores = pieces(2);
      comps[1].scores = pieces(1);
      expect(text(ReportBlocks.renderReportBlock('term-glance', CID, CECE, {}, {}))).toBe(
        'This Term at a Glance 2 Assessed 1 Late 1 Missing 2 Observations — Strongest Questioning Growing',
      );
    } finally {
      CommentBank.compsOf = compsOf;
    }
    stub('getAssessments', () => []);
    expect(ReportBlocks.renderReportBlock('term-glance', CID, CECE, {}, {})).toBe('');
  });

  it('Growth Since Last Report reads the last report through calc.js and puts the report back', () => {
    let term = 2;
    const set = [];
    stub('getActiveTerm', () => ({ ordinal: term, label: 'Term ' + term }));
    stub('previousReportTerm', () => (term > 1 ? { ordinal: term - 1, label: 'Term ' + (term - 1) } : null));
    // The last report is read as of its end (the year to date) and this one put back.
    stub('readAsOfTerm', (cid, n, read) => {
      const was = term;
      set.push(n);
      term = n;
      try {
        return read();
      } finally {
        term = was;
        set.push(was);
      }
    });
    stub('getReportingTerms', () => [
      { ordinal: 1, label: 'Term 1' },
      { ordinal: 2, label: 'Term 2' },
    ]);
    stub('getGroupedSections', () => ({ groups: [], ungrouped: [] }));
    stub('getSections', () => [
      { id: 'q', name: 'Questioning' },
      { id: 'p', name: 'Planning' },
    ]);
    stub('getSectionProficiency', (cid, sid, id) => (term === 1 ? { q: 2, p: 3 } : { q: 3, p: 3 })[id]);
    const html = ReportBlocks.renderReportBlock('growth', CID, CECE, {}, {});
    expect(set).toEqual([1, 2]);
    expect(term).toBe(2);
    expect(text(html)).toBe(
      'Growth Since Last Report Competency Report 1 Report 2 Questioning ●●○○ Developing ●●●○ Proficient ↑ Planning ●●●○ Proficient ●●●○ Proficient →',
    );
    // No earlier term, or nothing in it: nothing prints.
    term = 1;
    expect(ReportBlocks.renderReportBlock('growth', CID, CECE, {}, {})).toBe('');
    term = 2;
    stub('getSectionProficiency', (cid, sid, id) => (term === 1 ? 0 : 3));
    expect(ReportBlocks.renderReportBlock('growth', CID, CECE, {}, {})).toBe('');
  });

  it('Proficiency prints figures then and now, the word, the change and the assessed count per competency, Overall on top, and the highest and lowest lines', () => {
    const work = [
      { id: 'a1', title: 'Lab Report', date: '2026-09-10' },
      { id: 'a2', title: 'Quiz', date: '2026-10-05' },
    ];
    stub('getAssessments', () => work);
    stub('getActiveTerm', () => null);
    stub('getGroupedSections', () => ({ groups: [], ungrouped: [] }));
    const secs = [
      {
        id: 'q',
        name: 'Questioning and Predicting',
        shortName: 'Questioning',
        tags: [{ id: 't1', label: 'Question and Predict' }],
      },
      { id: 'p', name: 'Planning', tags: [{ id: 't2', label: 'Plan Investigations' }] },
      { id: 'e', name: 'Evaluating', tags: [{ id: 't3', label: 'Evaluate Methods' }] },
    ];
    stub('getSections', () => secs);
    stub('getSectionProficiency', (cid, sid, id) => ({ q: 3.2, p: 3.4, e: 0 })[id]);
    stub('getOverallProficiency', () => 3.3);
    stub('getTagScores', (cid, sid, tid) =>
      tid === 't1'
        ? [
            { assessmentId: 'a1', score: 3 },
            { assessmentId: 'a2', score: 3.33 },
          ]
        : tid === 't2'
          ? [{ assessmentId: 'a2', score: 4 }]
          : [],
    );
    // Best and lowest work print each piece's whole mark, as Assignment
    // Grades does (step 4 group 2 #3).
    stub('assessmentCellValue', (cid, sid, a) => {
      const v = { a1: 3, a2: 3.67 }[a.id];
      return { kind: 'level', value: v, percent: v * 25, percentText: Math.round(v * 25) + '%' };
    });
    const html = ReportBlocks.renderReportBlock('proficiency', CID, CECE, {}, S.optionsFor({ block: 'proficiency' }));
    const t = text(html);
    expect(t).toContain('Proficiency Curricular Competencies · Science 8');
    expect(t).toContain('Competency Start of Term Now Change Assessed');
    // Assessed counts each assessment once, however many competencies it scored.
    // A competency with too few dated scores starts at its first piece, as
    // Progress in One Area prints it (step 4 group 3 #63).
    // A Proficiency class prints each level as its proficiency and the change in words, never a figure
    // (DECISIONS, "Student-facing levels are proficiencies"): 3.5 to 3.3 is Extending to Proficient.
    expect(t).toContain('Overall Extending Proficient ↓ Down 2');
    expect(t).toContain('Question and Predict Proficient Proficient Same 2');
    expect(t).toContain('Plan Investigations Extending Proficient ↓ Down 1');
    expect(t).toContain('Evaluate Methods — — — 0');
    // 3.2 and 3.4 both read Proficient: with every competency at one word there is no highest or lowest,
    // so neither line prints (Colin, 2026-11-12: "go with your recommendations on all four").
    expect(t).not.toContain('Highest now');
    expect(t).not.toContain('Lowest now');
    // At different words, both print: the highest, then the lowest, each with its work.
    stub('getSectionProficiency', (cid, sid, id) => ({ q: 2.2, p: 3.4, e: 0 })[id]);
    const apart = text(
      ReportBlocks.renderReportBlock('proficiency', CID, CECE, {}, S.optionsFor({ block: 'proficiency' })),
    );
    expect(apart).toContain('Highest now: Plan Investigations Proficient. Best work: Quiz (Oct 5), Extending −.');
    expect(apart).toContain(
      'Lowest now: Question and Predict Developing. Lowest work: Lab Report (Sep 10), Proficient.',
    );
    stub('getSectionProficiency', (cid, sid, id) => ({ q: 3.2, p: 3.4, e: 0 })[id]);
    expect(t).not.toMatch(/\d\.\d|\/ 4/);
    expect(html).not.toMatch(/[●○]/);
    // Options: no word, no facts, hide empty rows, lowest first, no overall.
    const bare = text(
      ReportBlocks.renderReportBlock(
        'proficiency',
        CID,
        CECE,
        {},
        { word: false, facts: false, overall: false, order: 'lowest', noEvidence: 'hide', size: 'row' },
      ),
    );
    expect(bare).not.toContain('Evaluate Methods');
    expect(bare).not.toContain('Overall');
    expect(bare).not.toContain('Highest now');
    expect(bare.indexOf('Question and Predict')).toBeLessThan(bare.indexOf('Plan Investigations'));
    expect(bare).toContain('Question and Predict Proficient Proficient Same 2');
    // Side by Side: short headings; a Proficiency class still prints the proficiency, as it has no figure.
    const half = text(ReportBlocks.renderReportBlock('proficiency', CID, CECE, {}, { size: 'half' }));
    expect(half).toContain('Competency Start Now Change Ev.');
    expect(half).toContain('Overall Extending Proficient ↓ Down 2');
    expect(half).not.toMatch(/\d\.\d/);
    // Folders. As Graded (the default) prints a folder the grade counts as
    // one as one row, averaged as calc.js does; the rest print one by one
    // under Other Competencies. Each Competency puts a heading over each
    // folder's competencies; Each Folder makes every folder one row.
    stub('getGroupedSections', () => ({
      groups: [{ group: { id: 'g1', name: 'Inquiry' }, sections: [secs[0], secs[1]] }],
      ungrouped: [secs[2]],
    }));
    stub('getGroupProficiency', () => 3.3);
    // Evaluate Methods at Developing, so the folder and it read differently and the lines print.
    stub('getSectionProficiency', (cid, sid, id) => ({ q: 3.2, p: 3.4, e: 2.2 })[id]);
    const asGraded = text(ReportBlocks.renderReportBlock('proficiency', CID, CECE, {}, {}));
    expect(asGraded).toContain('Inquiry · 2 competencies Extending Proficient ↓ Down 2');
    expect(asGraded).not.toContain('Inquiry Question and Predict');
    expect(asGraded).toContain('Other Competencies Evaluate Methods');
    // The highest and lowest lines name what the report prints: the folder.
    expect(asGraded).toContain('Highest now: Inquiry Proficient.');
    const each = text(ReportBlocks.renderReportBlock('proficiency', CID, CECE, {}, { rows: 'each' }));
    expect(each).toContain('Inquiry Question and Predict');
    expect(each).toContain('Other Competencies Evaluate Methods');
    const byGroup = text(ReportBlocks.renderReportBlock('proficiency', CID, CECE, {}, { rows: 'group' }));
    expect(byGroup).toContain('Inquiry · 2 competencies Extending Proficient ↓ Down 2');
    expect(byGroup).toContain('Other Competencies Evaluate Methods');
    // A folder the grade doesn't count as one (Folders Count as One off, or
    // the folder's own switch off) prints its competencies under its name.
    stub('folderCountsAsOne', () => false);
    const notOne = text(ReportBlocks.renderReportBlock('proficiency', CID, CECE, {}, {}));
    expect(notOne).toContain('Inquiry Question and Predict');
    expect(text(ReportBlocks.renderReportBlock('proficiency', CID, CECE, {}, { rows: 'group' }))).toContain(
      'Inquiry · 2 competencies',
    );
    // Only folders: the column says Group.
    stub('folderCountsAsOne', () => true);
    stub('getGroupedSections', () => ({
      groups: [{ group: { id: 'g1', name: 'Inquiry' }, sections: [secs[0], secs[1], secs[2]] }],
      ungrouped: [],
    }));
    expect(text(ReportBlocks.renderReportBlock('proficiency', CID, CECE, {}, {}))).toContain(
      'Group Start of Term Now Change Assessed',
    );
    // Nothing to print without competencies.
    stub('getSections', () => []);
    stub('getGroupedSections', () => ({ groups: [], ungrouped: [] }));
    expect(ReportBlocks.renderReportBlock('proficiency', CID, CECE, {}, {})).toBe('');
  });

  it('the legend is one strip of four figures and words, two by two at Side by Side', () => {
    const row = ReportBlocks.renderReportBlock('legend', CID, CECE, {}, { size: 'row' });
    expect(text(row)).toBe(
      // Each level by its name, no number and no "out of 4" (DECISIONS, "Student-facing levels are proficiencies").
      'BC Proficiency Scale Emerging Initial understanding Developing Partial understanding Proficient Complete understanding Extending Sophisticated understanding',
    );
    expect(row).not.toMatch(/[●○]/);
    expect(ReportBlocks.renderReportBlock('legend', CID, CECE, {}, { size: 'half' })).toContain('report-legend-half');
  });

  it('the Assessments part prints its rows as one list, or by month, category or competency, one column or two', () => {
    const work = [
      {
        id: 'a1',
        title: 'Chemical Formulas Quiz',
        date: '2026-09-10',
        categoryId: 'c2',
        scoreMode: 'points',
        maxPoints: 15,
        tagIds: ['t1'],
      },
      { id: 'a2', title: 'Plate Tectonics Presentation', date: '2026-10-05', categoryId: 'c1', tagIds: ['t1', 't2'] },
      {
        id: 'a3',
        title: 'Energy Forms Quiz',
        date: '2026-10-12',
        categoryId: 'c2',
        scoreMode: 'points',
        maxPoints: 10,
        tagIds: ['t2'],
      },
    ];
    const cells = {
      a1: { kind: 'points', value: 12, level: 3 },
      a2: { kind: 'level', value: 3.33, level: 3, percentText: '83%' },
      a3: { kind: 'status', status: 'NS', value: 0, level: 0 },
    };
    stub('getAssessments', () => work);
    stub('assessmentInYearToDate', () => true);
    stub('assessmentInTermWindow', () => true);
    stub('assessmentCellValue', (cid, sid, a) => cells[a.id]);
    stub('getCategories', () => [
      { id: 'c1', name: 'Labs', weight: 40 },
      { id: 'c2', name: 'Quizzes', weight: 60 },
    ]);
    stub('studentGradeSummary', () => ({ text: '3.1 · B 78%', level: 3 }));
    // What a student reads of the course grade and a category's: the proficiency (calc.js studentGradeText,
    // studentGroupGradeText; DECISIONS, "Student-facing levels are proficiencies").
    stub('studentGradeText', () => ({ text: 'Proficient', level: 3 }));
    stub('assessmentGroupGrade', (cid, sid, list) => ({ text: list.map(a => a.id).join('+') + ' grade', prof: 3.1 }));
    stub('getGroupedSections', () => ({ groups: [], ungrouped: [] }));
    stub('getSections', () => [
      { id: 'q', name: 'Questioning', tags: [{ id: 't1', label: 'Question and Predict' }] },
      { id: 'p', name: 'Planning', tags: [{ id: 't2', label: 'Plan Investigations' }] },
    ]);
    stub('getTagScores', (cid, sid, tid) =>
      tid === 't1'
        ? [
            { assessmentId: 'a1', score: 3 },
            { assessmentId: 'a2', score: 3.33 },
          ]
        : [{ assessmentId: 'a2', score: 3.33 }],
    );
    // No DOM here: every block 50px tall, every text 7px a character.
    const stage = {
      innerHTML: '',
      firstChild: { offsetHeight: 50 },
      querySelectorAll() {
        return [...this.innerHTML.matchAll(/class="gr-measure"[^>]*>([^<]*)</g)].map(m => ({
          offsetWidth: m[1].length * 7,
        }));
      },
    };
    const list = o => GradeReport.listPart(CID, CECE, o || {}, stage).html;
    // One List, one column: the table the Assessments list has always been.
    const plain = list({});
    expect(plain).not.toContain('gr-item');
    expect(plain).not.toContain('class="gr-cols"');
    expect(text(plain)).toContain('Sep 10 Chemical Formulas Quiz Quizzes 12 / 15');
    // By month, newest first: a heading over each month's first row.
    const byMonth = list({ organize: 'month', order: 'newest' });
    expect(text(byMonth)).toContain('October Oct 12 Energy Forms Quiz Quizzes Missing Oct 5 Plate Tectonics');
    expect(text(byMonth)).toContain('September Sep 10 Chemical Formulas Quiz');
    // Work dated after the report's end is left out.
    cells.a4 = { kind: 'none' };
    stub('getAssessments', () =>
      work.concat([{ id: 'a4', title: 'Final Exam', date: '2099-06-01', categoryId: 'c2' }]),
    );
    expect(text(list({ organize: 'month' }))).not.toContain('Final Exam');
    stub('getAssessments', () => work);
    // By category, side by side: each heading carries its weight and the
    // student's grade in it; no Category column; a level reads as its
    // proficiency with its ±.
    const byCat = list({ organize: 'category', columns: 'two', order: 'newest' });
    const t = text(byCat);
    expect(byCat).toContain('class="gr-cols"');
    // Each column has its header row; the rows split where the columns come out most even.
    expect(t).toContain(
      'Date Assessment Result Labs 40% of grade · Proficient Oct 5 Plate Tectonics Presentation Proficient +',
    );
    expect(t).toContain(
      'Date Assessment Result Quizzes 60% of grade · Proficient Oct 12 Energy Forms Quiz Missing Sep 10 Chemical Formulas Quiz 12 / 15',
    );
    expect(t).not.toMatch(/\d\.\d|\/ 4|out of 4/);
    expect(t).not.toContain('Category');
    expect(text(list({ organize: 'category', catGrade: false }))).toContain('Labs Oct 5 Plate Tectonics');
    // By competency: the latest few under each, marked on that competency.
    const comp = text(list({ organize: 'competency', per: 1, order: 'newest' }));
    expect(comp).toContain('Question and Predict Oct 5 Plate Tectonics Presentation Labs Proficient +');
    expect(comp).toContain('Plan Investigations Oct 5 Plate Tectonics Presentation Labs Proficient +');
    expect(comp).not.toContain('Energy Forms Quiz');
    // Numbers are left off by competency (a piece can print twice).
    expect(list({ organize: 'competency', numbers: true })).not.toContain('gr-c gr-n ');
    // Range: Last 10 and This Term.
    stub('assessmentInTermWindow', (cid, a) => a.id !== 'a1');
    expect(text(list({ range: 'term' }))).not.toContain('Chemical Formulas Quiz');
    stub('assessmentInTermWindow', () => true);
    // A Letter class: Score and Out Of, %, and the Proficiency Word when asked.
    COURSES[CID].gradingSystem = 'letter';
    const letter = text(list({ word: true }));
    expect(letter).toContain('Score Out Of % Proficiency');
    expect(letter).toContain('Chemical Formulas Quiz Quizzes 12 15 80% Proficient');
    expect(text(list({ hide: { score: true }, percent: false }))).not.toContain('Out Of');
    // Side by side the score and out of print joined, and no word.
    const two = text(list({ columns: 'two', word: true }));
    expect(two).toContain('12 / 15 80%');
    expect(two).not.toContain('Proficiency');
    COURSES[CID].gradingSystem = 'proficiency';
    stub('getAssessments', () => []);
    expect(list({ organize: 'month' })).toBe('');
  });

  it('the Assessments part in groups or side by side cuts between its rows, a group carrying on under “(continued)”', () => {
    const { document: doc } = parseHTML('<!doctype html><html><body></body></html>');
    const was = globalThis.document;
    globalThis.document = doc;
    try {
      const row = (id, t) => `<div class="gr-row" data-row="${id}"><span class="gr-c gr-title">${t}</span></div>`;
      const t = {
        open: '<div class="gr-table gr-regular" style="--gr-cols:1fr">',
        head: '<div class="gr-row gr-head"><span class="gr-c">Assessment</span></div>',
      };
      const items = ['A', 'B', 'C', 'D', 'E', 'F'].map((x, i) => ({
        row: row(x, 'Work ' + x),
        g: i < 4 ? 0 : 1,
        gi: i < 4 ? i : i - 4,
        name: i < 4 ? 'Labs' : 'Quizzes',
        grade: i < 4 ? '40% of grade · Proficient' : '',
        u: 1,
      }));
      // A part as listPart assembles it, side by side: Labs A–D, Quizzes E–F.
      const html =
        '<div class="one-part one-assessments"><div class="report-block-title">Assessments</div><div class="gr-cols">' +
        t.open +
        t.head +
        items
          .slice(0, 3)
          .map(
            x =>
              `<div class="gr-item" data-g="${x.g}" data-gi="${x.gi}" data-gn="${x.name}" data-gg="${x.grade}" data-u="1">${x.row}</div>`,
          )
          .join('') +
        '</div>' +
        t.open +
        t.head +
        items
          .slice(3)
          .map(
            x =>
              `<div class="gr-item" data-g="${x.g}" data-gi="${x.gi}" data-gn="${x.name}" data-gg="${x.grade}" data-u="1">${x.row}</div>`,
          )
          .join('') +
        '</div></div></div>';
      // The second page of it: rows C to F.
      const piece = GradeReport.listPiece(html, 2, 6);
      const p = parseHTML('<div>' + piece + '</div>').document;
      const headings = [...p.querySelectorAll('.gr-ghead')].map(h => h.textContent);
      // Labs began on the page before: it carries on; Quizzes starts here with its own heading.
      expect(headings[0]).toBe('Labs (continued)');
      expect(headings).toContain('Quizzes');
      expect(p.querySelector('.report-block-title').textContent).toBe('Assessments (continued)');
      // Still side by side, every row once, in order.
      expect(p.querySelectorAll('.gr-cols > .gr-table')).toHaveLength(2);
      expect([...p.querySelectorAll('.gr-row[data-row]')].map(r => r.getAttribute('data-row'))).toEqual([
        'C',
        'D',
        'E',
        'F',
      ]);
      // Each table keeps its header row.
      expect(p.querySelectorAll('.gr-head')).toHaveLength(2);
      // The first page: Labs' grade on its first heading.
      const first = parseHTML('<div>' + GradeReport.listPiece(html, 0, 2) + '</div>').document;
      expect(first.querySelector('.gr-ghead').textContent).toBe('Labs40% of grade · Proficient');
      expect(first.querySelector('.report-block-title').textContent).toBe('Assessments');
    } finally {
      globalThis.document = was;
    }
  });

  it('a saved layout keeps a retired block', () => {
    const kept = S.normalizeForm({ v: 6, sides: [{ rows: [] }, { rows: [{ cells: [{ block: 'section-chart' }] }] }] });
    expect(blocksOf(kept)).toContain('section-chart');
  });

  it('Assignment Grades and Missing Work are read from a saved form, and print as the Assessments part', () => {
    expect(S.BLOCKS['grade-table'].retired).toBe(true);
    expect(S.BLOCKS['missing-work'].retired).toBe(true);
    expect(ReportBlocks.renderReportBlock('grade-table', CID, CECE, {}, {})).toBe('');
  });
});

describe('measuring the class for One Report', () => {
  it('measures in the standard type and gives the layout only the paper and the stage, whatever a saved form says', () => {
    const seen = [];
    const old = document.createElement;
    document.createElement = () => ({ setAttribute() {}, style: {}, remove() {} });
    const layout = (cid, st, ctx, o) => {
      seen.push({ cls: o.stage.className, keys: Object.keys(o).sort() });
      return { html: '', sheets: 1, sides: 1 };
    };
    try {
      S.classSummary(
        'x',
        [{ id: 's1', firstName: 'Ada', lastName: 'Lee' }],
        {},
        {
          paper: 'letter',
          form: { v: 6, type: 'compact', sides: [] },
          layout,
        },
      );
    } finally {
      document.createElement = old;
    }
    expect(seen).toEqual([{ cls: 'report-sheet report-sheet-measure one-flat', keys: ['paper', 'stage'] }]);
  });
});
