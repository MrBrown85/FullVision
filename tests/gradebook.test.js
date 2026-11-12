/**
 * gradebook: the tests that were tests/gradebook-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

describe('gradebook-class-overall', () => {
  /**
   * The class's overall at the foot of the gradebook's Overall column, in the
   * Class Average row (a CSL reviewer, Nov 5: "Is it possible to get an
   * overall class average?"). It is classGradeSummary over the whole class,
   * the figure the dashboard's top bar shows, and nothing when no student has
   * an Overall yet.
   */

  const CID = 'cOv';
  const STUDENTS = [
    { id: 's1', firstName: 'Ava', lastName: 'Test' },
    { id: 's2', firstName: 'Ben', lastName: 'Test' },
  ];
  const quiz = { id: 'a1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, date: '2026-10-10', type: 'summative' };

  function seed(scored) {
    COURSES[CID] = { id: CID, name: 'English 12', gradingSystem: 'letter' };
    _cache.students[CID] = STUDENTS;
    _cache.assessments[CID] = [quiz];
    _cache.scores[CID] = scored
      ? {
          s1: [{ assessmentId: 'a1', tagId: 'a1', score: 9, date: '2026-10-10', type: 'summative' }],
          s2: [{ assessmentId: 'a1', tagId: 'a1', score: 7, date: '2026-10-10', type: 'summative' }],
        }
      : { s1: [], s2: [] };
    _cache.statuses[CID] = {};
    _cache.courseConfigs[CID] = {};
    clearProfCache();
  }

  describe('the gradebook Class Average row', () => {
    let stubDocument;

    function open(scored) {
      seed(scored);
      PageGradebook.init({ course: CID });
    }

    beforeEach(() => {
      localStorage.clear();
      stubDocument = globalThis.document;
      const dom = parseHTML(
        '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
      );
      const doc = dom.document;
      const make = doc.createElement.bind(doc);
      doc.createElement = tag => {
        const el = make(tag);
        if (tag === 'canvas') el.getContext = () => ({ measureText: () => ({ width: 50 }) });
        return el;
      };
      globalThis.document = doc;
      globalThis.CSS = { escape: s => String(s) };
      globalThis.getComputedStyle = () => ({});
      PageAssignments.graderOpen = () => false;
      runInThisContext(readFileSync('teacher/page-gradebook.js', 'utf-8'), { filename: 'teacher/page-gradebook.js' });
    });

    afterEach(() => {
      PageGradebook.destroy();
      globalThis.document = stubDocument;
    });

    it("shows the class's overall under the Overall column, as the dashboard does", () => {
      open(true);
      const cell = document.querySelector('.gb-scores-stats-head .gb-class-overall');
      expect(cell).not.toBeNull();
      const expected = classGradeSummary(CID, ['s1', 's2']).text;
      expect(expected).toMatch(/%/);
      expect(cell.textContent).toBe(expected);
      expect(cell.getAttribute('title')).toBe('The average of every student’s Overall');
    });

    it('shows nothing there before any student has an Overall', () => {
      open(false);
      expect(document.querySelector('.gb-scores-stats-head')).not.toBeNull();
      expect(document.querySelector('.gb-scores-stats-head .gb-class-overall')).toBeNull();
    });
  });
});

describe('gradebook-letter-all-missing-average', () => {
  /**
   * In a Letter class Missing counts as 0 in every column's Class Average
   * (DECISIONS, Class Averages and statuses 7). A proficiency column whose
   * counted students are all Missing averages 0, but the gradebook, the
   * printed grade sheet and the CSV export printed "—", the mark for a column
   * nobody counts in (Nov 3 bug sweep). They now print 0%, also where the
   * column prints proficiency figures (Colin, 2026-11-03: as the screen does).
   */

  const CID = 'cL';
  const STUDENTS = [
    { id: 's1', firstName: 'Ava', lastName: 'Test' },
    { id: 's2', firstName: 'Ben', lastName: 'Test' },
  ];
  const essay = {
    id: 'a1',
    title: 'Essay',
    scoreMode: 'proficiency',
    tagIds: ['T1'],
    date: '2026-10-10',
    type: 'summative',
  };

  function seed(gradingSystem) {
    COURSES[CID] = { id: CID, name: 'English 12', gradingSystem };
    _cache.students[CID] = STUDENTS;
    _cache.assessments[CID] = [essay];
    _cache.scores[CID] = { s1: [], s2: [] };
    _cache.statuses[CID] = { 's1:a1': 'NS', 's2:a1': 'NS' };
    _cache.courseConfigs[CID] = {};
    clearProfCache();
  }

  describe('a Letter column whose counted students are all Missing', () => {
    beforeEach(() => {
      localStorage.clear();
      seed('letter');
    });

    it('averages 0 and reads 0%', () => {
      const res = classColumnAverage(CID, STUDENTS, { assessment: essay });
      expect(res).toEqual({ avg: 0, count: 2 });
      expect(classColumnAverageText(CID, essay, res)).toBe('0%');
    });

    it('prints 0% on the grade sheet, as percent or as proficiency', () => {
      const col = { id: 'a1', assessment: essay };
      expect(GradesPrint.columnAverageText(CID, STUDENTS, col, { scoresAs: 'percent' })).toBe('0%');
      expect(GradesPrint.columnAverageText(CID, STUDENTS, col, { scoresAs: 'proficiency' })).toBe('0%');
    });

    it('still reads "—" in a Proficiency class, where Missing is left out', () => {
      seed('proficiency');
      expect(classColumnAverage(CID, STUDENTS, { assessment: essay })).toBeNull();
      expect(GradesPrint.columnAverageText(CID, STUDENTS, { id: 'a1', assessment: essay }, {})).toBe('—');
    });
  });

  describe('the gradebook and its CSV', () => {
    let stubDocument;
    let csv;
    const originalBlob = globalThis.Blob;
    const originalUrl = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;

    beforeEach(() => {
      localStorage.clear();
      stubDocument = globalThis.document;
      const dom = parseHTML(
        '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
      );
      const doc = dom.document;
      const make = doc.createElement.bind(doc);
      doc.createElement = tag => {
        const el = make(tag);
        if (tag === 'canvas') el.getContext = () => ({ measureText: () => ({ width: 50 }) });
        if (tag === 'a') el.click = () => {};
        return el;
      };
      globalThis.document = doc;
      globalThis.CSS = { escape: s => String(s) };
      globalThis.getComputedStyle = () => ({});
      globalThis.Blob = function (parts) {
        csv = parts.join('');
      };
      URL.createObjectURL = () => 'blob:csv';
      URL.revokeObjectURL = () => {};
      PageAssignments.graderOpen = () => false;
      runInThisContext(readFileSync('teacher/page-gradebook.js', 'utf-8'), { filename: 'teacher/page-gradebook.js' });
      seed('letter');
      PageGradebook.init({ course: CID });
    });

    afterEach(() => {
      PageGradebook.destroy();
      globalThis.document = stubDocument;
      globalThis.Blob = originalBlob;
      URL.createObjectURL = originalUrl;
      URL.revokeObjectURL = originalRevoke;
    });

    it('shows 0% as the Scores view Class Average', () => {
      const avg = document.querySelector('.gb-scores-stats .gb-avg-val');
      expect(avg.textContent).toBe('0%');
    });

    it('exports 0% as the Class Average, as the screen shows it', () => {
      const btn = document.querySelector('[data-action="exportScoresCSV"]');
      btn.dispatchEvent(new document.defaultView.Event('click', { bubbles: true, cancelable: true }));
      const last = csv.split('\n').pop();
      expect(last.split(',').pop()).toBe('"0%"');
    });
  });
});

describe('gradebook-mark-blank-undo', () => {
  /**
   * Count Missing as Zero in the gradebook column menu (Nov 3 bug sweep, Step 4
   * group 1): it marked every blank cell Missing at once with no toast and no
   * count, and Cmd+Z did nothing, so the teacher could not tell which cells had
   * been blank. It is now Mark Blank Cells Missing / Excused; an Undo toast
   * gives the count, and the toast's Undo or Cmd+Z takes off just those marks.
   */

  const hw = {
    id: 'a1',
    title: 'Homework',
    scoreMode: 'proficiency',
    tagIds: ['T1'],
    date: '2026-10-10',
    type: 'summative',
  };

  let stubDocument;
  let win;

  function seed(cid) {
    _cache.students[cid] = [
      { id: 's1', firstName: 'Ava', lastName: 'Test' },
      { id: 's2', firstName: 'Ben', lastName: 'Test' },
      { id: 's3', firstName: 'Cara', lastName: 'Test' },
    ];
    _cache.assessments[cid] = [hw];
    _cache.scores[cid] = { s1: [{ assessmentId: 'a1', tagId: 'T1', score: 3, date: '2026-10-10', note: '' }] };
    _cache.statuses[cid] = {};
    _cache.courseConfigs[cid] = {};
  }
  const statuses = cid => ({ ...getAssignmentStatuses(cid) });

  function open(cid) {
    if (globalThis.PageGradebook.destroy) PageGradebook.destroy();
    PageGradebook.init({ course: cid });
  }
  function menu(ctx) {
    const head = document.querySelector('.gb-grid-colhead[data-aid="a1"]');
    // The slanted titles find their column from the pointer position.
    head.parentNode.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 0 });
    head.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 0 });
    const ev = new win.Event('contextmenu', { bubbles: true, cancelable: true });
    ev.clientX = 10;
    ev.clientY = 0;
    head.dispatchEvent(ev);
    const item = document.querySelector('[data-ctx="' + ctx + '"]');
    const text = item && item.textContent;
    if (item) item.dispatchEvent(new win.Event('click', { bubbles: true }));
    return text;
  }
  function cmdZ() {
    const ev = new win.Event('keydown', { bubbles: true, cancelable: true });
    ev.key = 'z';
    ev.metaKey = true;
    document.body.dispatchEvent(ev);
  }
  const toastText = () => {
    const t = document.querySelector('#undo-toast span');
    return t ? t.textContent : null;
  };

  beforeEach(() => {
    localStorage.clear();
    stubDocument = globalThis.document;
    const dom = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
    );
    win = dom.window;
    const doc = dom.document;
    const make = doc.createElement.bind(doc);
    doc.createElement = tag => {
      const el = make(tag);
      if (tag === 'canvas') el.getContext = () => ({ measureText: () => ({ width: 50 }) });
      return el;
    };
    globalThis.document = doc;
    globalThis.CSS = { escape: s => String(s) };
    globalThis.getComputedStyle = () => ({});
    PageAssignments.graderOpen = () => false;
    runInThisContext(readFileSync('teacher/page-gradebook.js', 'utf-8'), { filename: 'teacher/page-gradebook.js' });
    seed('cA');
    seed('cB');
  });

  afterEach(() => {
    dismissUndoToast();
    PageGradebook.destroy();
    globalThis.document = stubDocument;
  });

  describe('Mark Blank Cells Missing', () => {
    it('says it fills the blank cells', () => {
      open('cA');
      expect(menu('markUngradedNS')).toBe('Mark Blank Cells Missing');
      expect(menu('markUngradedEXC')).toBe('Mark Blank Cells Excused');
    });

    it('shows an Undo toast with the count, and its Undo takes the marks off', () => {
      open('cA');
      menu('markUngradedNS');
      expect(statuses('cA')).toEqual({ 's2:a1': 'NS', 's3:a1': 'NS' });
      expect(toastText()).toBe('2 blank cells marked Missing');
      executeUndo();
      expect(statuses('cA')).toEqual({});
      expect(toastText()).toBe(null);
      // Nothing is left for Undo Marking Blank Cells to take off.
      expect(menu('undoBulkStatus')).toBe(null);
    });

    it('is undone by Cmd+Z, which closes the toast', () => {
      open('cA');
      menu('markUngradedEXC');
      expect(toastText()).toBe('2 blank cells marked Excused');
      cmdZ();
      expect(statuses('cA')).toEqual({});
      expect(toastText()).toBe(null);
    });

    it('Cmd+Z does nothing in another class', () => {
      open('cA');
      menu('markUngradedNS');
      open('cB');
      cmdZ();
      expect(statuses('cA')).toEqual({ 's2:a1': 'NS', 's3:a1': 'NS' });
      open('cA');
      cmdZ();
      expect(statuses('cA')).toEqual({});
    });

    it('Cmd+Z leaves the marks once one of those cells has changed since', () => {
      open('cA');
      menu('markUngradedNS');
      dismissUndoToast();
      // Ben hands it in late: the teacher takes his Missing off and marks Late.
      const st = getAssignmentStatuses('cA');
      st['s2:a1'] = 'LATE';
      saveAssignmentStatuses('cA', st);
      cmdZ();
      expect(statuses('cA')).toEqual({ 's2:a1': 'LATE', 's3:a1': 'NS' });
    });

    it('Undo Marking Blank Cells still takes off every mark it set', () => {
      open('cA');
      menu('markUngradedNS');
      dismissUndoToast();
      expect(menu('undoBulkStatus')).toBe('Undo Marking Blank Cells');
      expect(statuses('cA')).toEqual({});
    });
  });
});

describe('gradebook-name-tip-missing-term', () => {
  /**
   * The name tip's missing count follows the grade beside it (Nov 3 bug
   * sweep, Gradebook group 3). It counted Missing work in a 0% category,
   * which counts toward nothing; it now counts only work the grade counts,
   * outside 0% categories. The gradebook always shows the year so far
   * (Colin, 2026-11-03), so Missing work from every term counts, as it does
   * in the grade.
   */

  const CID = 'cA';
  const quiz = (id, date) => ({ id, title: id, scoreMode: 'points', maxPoints: 10, tagIds: ['T1'], date });

  let stubDocument;
  let win;

  beforeEach(() => {
    localStorage.clear();
    stubDocument = globalThis.document;
    const dom = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div>' +
        '<div id="gb-tooltip"></div></body></html>',
    );
    win = dom.window;
    const doc = dom.document;
    const make = doc.createElement.bind(doc);
    // The slanted header measures its titles on a canvas; the tip places
    // itself under the row.
    doc.createElement = tag => {
      const el = make(tag);
      if (tag === 'canvas') el.getContext = () => ({ measureText: () => ({ width: 50 }) });
      return el;
    };
    win.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, bottom: 20, width: 100, height: 20 });
    globalThis.document = doc;
    globalThis.CSS = { escape: s => String(s) };
    globalThis.getComputedStyle = () => ({});
    PageAssignments.graderOpen = () => false;
    runInThisContext(readFileSync('teacher/page-gradebook.js', 'utf-8'), { filename: 'teacher/page-gradebook.js' });
    COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter' };
    _cache.students[CID] = [{ id: 's1', firstName: 'Ava', lastName: 'Test' }];
    // Two Term 1 quizzes marked Missing; a Term 2 quiz with a score.
    _cache.assessments[CID] = [quiz('t1a', '2026-10-01'), quiz('t1b', '2026-10-08'), quiz('t2', '2026-12-01')];
    _cache.scores[CID] = { s1: [{ assessmentId: 't2', tagId: 'T1', score: 8, date: '2026-12-01', note: '' }] };
    _cache.statuses[CID] = { 's1:t1a': 'NS', 's1:t1b': 'NS' };
    _cache.courseConfigs[CID] = {
      reportingTerms: [
        { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-15' },
        { ordinal: 2, label: 'Term 2', starts_on: '2026-11-16', ends_on: '2027-01-31' },
      ],
    };
  });

  afterEach(() => {
    PageGradebook.destroy();
    delete COURSES[CID];
    delete _cache.categories[CID];
    globalThis.document = stubDocument;
  });

  function nameTip() {
    PageGradebook.init({ course: CID });
    document.querySelector('.gb-grid-rowhead-name').dispatchEvent(new win.Event('focusin', { bubbles: true }));
    return document.getElementById('gb-tooltip').textContent;
  }

  describe('the name tip missing count', () => {
    it('counts Missing work from every term, as the year-so-far grade does', () => {
      expect(nameTip()).toContain('2 assessments missing (count as 0)');
    });

    it('a report in view on the Reports page does not carry over: no term picker, the year so far', () => {
      setActiveTerm(CID, 2);
      const tip = nameTip();
      expect(getActiveTerm(CID)).toBeNull();
      expect(document.querySelector('.term-select')).toBeNull();
      expect(document.querySelector('[data-action="setTerm"]')).toBeNull();
      expect(document.body.textContent).not.toContain('Undated Not Shown');
      expect(tip).toContain('2 assessments missing (count as 0)');
      expect(localStorage.getItem('gb-term-' + CID)).toBeNull();
    });

    it('leaves out Missing work in a 0% category', () => {
      _cache.categories[CID] = [
        { id: 'cat-tests', name: 'Tests', weight: 100 },
        { id: 'cat-practice', name: 'Practice', weight: 0 },
      ];
      _cache.assessments[CID].forEach(a => (a.categoryId = 'cat-tests'));
      _cache.assessments[CID][1].categoryId = 'cat-practice';
      expect(nameTip()).toContain('1 assessment missing (counts as 0)');
    });
  });
});

describe('gradebook-rubric-criterion-columns', () => {
  /**
   * Rubric columns in the Competencies gradebook (2026-10-18). A rubric
   * assessment whose three criteria each feed two competencies showed six
   * identical-looking columns. "Rubric columns: Criteria" shows one column per
   * criterion instead; rubricCriterionColumns lists them with the score keys
   * each criterion stores under. The first key is the one the cell shows.
   */

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const CID = 'course-rubric-cols';
  const RUBRIC = 'rub-lab';

  const rubric = {
    id: RUBRIC,
    name: 'Lab Investigation Rubric',
    criteria: [
      { id: 'crit-inquiry', name: 'Scientific Inquiry', tagIds: ['QAP', 'PI'], levels: {} },
      { id: 'crit-data', name: 'Data & Analysis', tagIds: ['IP', 'EM'], levels: {} },
      { id: 'crit-neat', name: 'Neatness', tagIds: [], levels: {} },
    ],
  };
  const labAssessment = { id: 'a-lab', title: 'Lab', tagIds: ['QAP', 'PI', 'IP', 'EM'], rubricId: RUBRIC };

  beforeEach(() => {
    _cache.rubrics[CID] = [rubric];
  });
  afterEach(() => {
    delete _cache.rubrics[CID];
  });

  describe('rubricCriterionColumns', () => {
    it('lists one column per criterion with its score keys', () => {
      const cols = rubricCriterionColumns(labAssessment, CID);
      expect(cols.map(c => c.criterion.name)).toEqual(['Scientific Inquiry', 'Data & Analysis', 'Neatness']);
      // A criterion's score is kept under the criterion's own id.
      expect(cols.map(c => c.keys)).toEqual([['crit-inquiry'], ['crit-data'], ['crit-neat']]);
    });

    it('shows a criterion under its own key', () => {
      const cols = rubricCriterionColumns(labAssessment, CID);
      expect(cols[0].keys[0]).toBe('crit-inquiry');
      expect(cols[2].keys[0]).toBe('crit-neat');
    });

    it('gives fewer columns than one per competency', () => {
      expect(rubricCriterionColumns(labAssessment, CID).length).toBe(3);
      expect(rubricCompetencyIds(CID, labAssessment)).toEqual(['QAP', 'PI', 'IP', 'EM']);
    });

    it('is empty for an assessment with no rubric', () => {
      expect(rubricCriterionColumns({ id: 'a-quiz', tagIds: ['QAP'] }, CID)).toEqual([]);
    });

    it('is empty for a points assessment, even with a rubric', () => {
      expect(rubricCriterionColumns({ ...labAssessment, scoreMode: 'points', maxPoints: 20 }, CID)).toEqual([]);
    });

    it('is empty when the rubric is gone or no class is given', () => {
      expect(rubricCriterionColumns({ id: 'a', rubricId: 'missing', tagIds: ['QAP'] }, CID)).toEqual([]);
      expect(rubricCriterionColumns(labAssessment)).toEqual([]);
    });

    it('skips a criterion with no id', () => {
      _cache.rubrics[CID] = [{ id: RUBRIC, criteria: [{ name: 'Broken', tagIds: ['QAP'] }, rubric.criteria[0]] }];
      expect(rubricCriterionColumns(labAssessment, CID).map(c => c.criterion.id)).toEqual(['crit-inquiry']);
    });
  });

  describe('the Competencies view uses them', () => {
    const src = readFileSync(resolve(root, 'teacher/page-gradebook.js'), 'utf-8');

    it('remembers the choice per class and defaults to criteria', () => {
      expect(src).toContain("getViewPref('gb_rubricColumns_' + cid) === 'competencies' ? 'competencies' : 'criteria'");
    });

    it('builds criterion columns from rubricCriterionColumns', () => {
      expect(src).toContain('rubricCriterionColumns(a, cid)');
      expect(src).toContain('tagId: c.keys[0]');
    });

    it('scores every key of a criterion cell', () => {
      expect(src).toContain('data-tids=');
      expect(src.match(/_cellScoreKeys\(td\)/g).length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('gradebook-status-range-average', () => {
  /**
   * Gradebook fixes from the 2026-10-16 Demo Mode test:
   *   - Not Submitted and Excused cells showed "·" or "—", with nothing to say
   *     NS counts as 0. They now show an NS or EXC mark.
   *   - Extra credit (up to 2× max) got the orange out-of-range warning.
   *   - The Competencies view's Class Average was blank for points and
   *     Complete/Incomplete columns.
   */

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const CID = 'course-gb';
  const STUDENTS = ['s1', 's2', 's3', 's4'].map(id => ({ id, firstName: id, lastName: 'Test' }));

  const points = (id, max) => ({ id, title: id, scoreMode: 'points', maxPoints: max, tagIds: [], type: 'summative' });
  const complete = id => ({ id, title: id, scoreMode: 'complete', maxPoints: 1, tagIds: [], type: 'summative' });
  const score = (assessmentId, value) => ({ assessmentId, tagId: 'overall', score: value, date: '2026-10-10' });

  function seed(assessments, scoresBySid, statuses = {}) {
    _cache.assessments[CID] = assessments;
    _cache.scores[CID] = scoresBySid;
    _cache.statuses[CID] = statuses;
    _cache.courseConfigs[CID] = {};
    clearProfCache();
  }

  describe('scoreStatusMarker', () => {
    it('marks Not submitted and Excused', () => {
      expect(scoreStatusMarker('NS')).toContain('>M<');
      expect(scoreStatusMarker('NS')).toContain('counts as 0');
      expect(scoreStatusMarker('EXC')).toContain('>EXC<');
    });

    it('leaves Late and no status to the score', () => {
      expect(scoreStatusMarker('LATE')).toBe('');
      expect(scoreStatusMarker(null)).toBe('');
    });
  });

  describe('isScoreOutOfRange', () => {
    it('allows extra credit up to twice the maximum on points work', () => {
      expect(isScoreOutOfRange(points('a', 10), 10)).toBe(false);
      expect(isScoreOutOfRange(points('a', 10), 15)).toBe(false);
      expect(isScoreOutOfRange(points('a', 10), 20)).toBe(false);
      expect(isScoreOutOfRange(points('a', 10), 21)).toBe(true);
    });

    it('flags a level above 4 and Complete above 1', () => {
      expect(isScoreOutOfRange({ id: 'p', scoreMode: 'proficiency' }, 4)).toBe(false);
      expect(isScoreOutOfRange({ id: 'p', scoreMode: 'proficiency' }, 4.5)).toBe(true);
      expect(isScoreOutOfRange(complete('c'), 1)).toBe(false);
      expect(isScoreOutOfRange(complete('c'), 2)).toBe(true);
    });
  });

  describe('getClassPointsAverage', () => {
    beforeEach(() => localStorage.clear());

    it('counts not submitted as 0 and leaves out excused and ungraded work', () => {
      const a = points('quiz', 20);
      seed(
        [a],
        { s1: [score('quiz', 18)], s2: [], s3: [score('quiz', 20)], s4: [] },
        { 's2:quiz': 'NS', 's3:quiz': 'EXC' },
      );
      expect(getClassPointsAverage(CID, STUDENTS, a)).toEqual({ avg: 9, pct: 45, count: 2 });
    });

    it('counts extra credit', () => {
      const a = points('quiz', 20);
      seed([a], { s1: [score('quiz', 30)], s2: [score('quiz', 10)], s3: [], s4: [] });
      expect(getClassPointsAverage(CID, STUDENTS, a)).toEqual({ avg: 20, pct: 100, count: 2 });
    });

    it('gives the % complete on Complete/Incomplete work', () => {
      const a = complete('hw');
      seed([a], { s1: [score('hw', 1)], s2: [score('hw', 0)], s3: [score('hw', 1)], s4: [] });
      expect(getClassPointsAverage(CID, STUDENTS, a).pct).toBeCloseTo(66.67, 1);
    });

    it('is null when nobody has a grade', () => {
      const a = points('quiz', 20);
      seed([a], { s1: [], s2: [], s3: [], s4: [] });
      expect(getClassPointsAverage(CID, STUDENTS, a)).toBeNull();
    });
  });

  describe('gradebook views use them', () => {
    const src = readFileSync(resolve(root, 'teacher/page-gradebook.js'), 'utf-8');

    it('marks NS and EXC cells in both views', () => {
      expect(src.match(/scoreStatusMarker\(/g).length).toBeGreaterThanOrEqual(2);
    });

    it('warns only above the extra-credit cap', () => {
      // The Scores view reads the flag from assessmentCellValue (calc.js).
      const calc = readFileSync(resolve(root, 'shared/calc.js'), 'utf-8');
      expect(calc).toContain('isScoreOutOfRange(a, val)');
      expect(src).toContain('cell.outOfRange');
      expect(src).not.toContain('if (val > maxVal)');
    });

    it('fills the Class Average for points columns', () => {
      expect(src).toContain('getClassPointsAverage(cid, students, assess)');
    });
  });

  // Every Class Average (Competencies view, printed sheet, CSV export) comes
  // from calc.js's one column rule, classColumnAverage. A status counts as it
  // does in the student's own grade for that work: on points and
  // Complete/Incomplete work Excused is left out and Not Submitted is 0; on
  // proficiency work both are left out (no evidence).
  describe('classColumnAverage', () => {
    const level = { id: 'lv', title: 'lv', scoreMode: 'proficiency', tagIds: ['T1'], type: 'summative' };
    const entry = (value, mod, tagId = 'T1') => ({ assessmentId: 'lv', tagId, score: value, mod, date: '2026-10-10' });
    const comp = tagIds => ({ assessment: level, tagIds });

    it('averages the scored students on a competency, + and − included', () => {
      seed([level], { s1: [entry(3, 1)], s2: [entry(3, -1)], s3: [entry(2)], s4: [] });
      const stats = classColumnAverage(CID, STUDENTS, comp(['T1']));
      expect(stats.count).toBe(3);
      expect(stats.avg).toBeCloseTo((scoreModValue(entry(3, 1)) + scoreModValue(entry(3, -1)) + 2) / 3, 10);
    });

    it('returns null when nobody counts', () => {
      seed([level], { s1: [entry(0)], s2: [] });
      expect(classColumnAverage(CID, STUDENTS, comp(['T1']))).toBeNull();
    });

    it('leaves Excused and Not Submitted out of proficiency work, even with a score left', () => {
      seed([level], { s1: [entry(4)], s2: [entry(2)], s3: [entry(1)] }, { 's2:lv': 'EXC', 's3:lv': 'NS' });
      expect(classColumnAverage(CID, STUDENTS, comp(['T1']))).toEqual({ avg: 4, count: 1 });
      // The whole assessment, as the printed sheet reads it, follows the same rule.
      expect(classColumnAverage(CID, STUDENTS, { assessment: level })).toEqual({ avg: 4, count: 1 });
    });

    it('averages every competency a rubric criterion feeds, each student once', () => {
      const twoKeys = { ...level, tagIds: ['T1', 'T2'] };
      seed([twoKeys], { s1: [entry(4, 0, 'T1'), entry(2, 0, 'T2')], s2: [entry(3, 0, 'T1')] });
      expect(classColumnAverage(CID, STUDENTS, { assessment: twoKeys, tagIds: ['T1', 'T2'] })).toEqual({
        avg: 3,
        count: 2,
      });
    });

    it('counts Not Submitted as 0 and leaves Excused out on points work', () => {
      const pts = points('pt', 10);
      seed(
        [pts],
        { s1: [score('pt', 8)], s2: [score('pt', 6)], s3: [score('pt', 9)], s4: [] },
        {
          's2:pt': 'NS',
          's3:pt': 'EXC',
        },
      );
      expect(classColumnAverage(CID, STUDENTS, { assessment: pts })).toEqual({ avg: 4, pct: 40, count: 2 });
      // Read as a proficiency (the printed sheet's Proficiency choice), the same students count.
      expect(classColumnAverage(CID, STUDENTS, { assessment: pts, measure: 'level' }).count).toBe(2);
      // getClassPointsAverage is the same rule.
      expect(getClassPointsAverage(CID, STUDENTS, pts)).toEqual(classColumnAverage(CID, STUDENTS, { assessment: pts }));
    });

    it('writes each status rule once, matching how the course % counts points work', () => {
      expect(COLUMN_STATUS_RULES.points).toEqual({ EXC: 'out', NS: 'zero' });
      expect(COLUMN_STATUS_RULES.proficiency).toEqual({ EXC: 'out', NS: 'out' });
      const pts = points('pt', 10);
      seed([pts], { s1: [score('pt', 8)], s2: [score('pt', 8)] }, { 's1:pt': 'NS', 's2:pt': 'EXC' });
      expect(getAssessmentOverallScore(CID, 's1', 'pt')).toBe(0);
      expect(getAssessmentOverallScore(CID, 's2', 'pt')).toBeNull();
    });
  });

  describe('scoreStatusMarker tooltip', () => {
    const pts = points('pt', 10);
    const prof = { id: 'lv', title: 'lv', scoreMode: 'proficiency', tagIds: ['T1'], type: 'summative' };
    it('says how Not Submitted counts for the work', () => {
      COURSES[CID] = { id: CID, gradingSystem: 'proficiency' };
      expect(scoreStatusMarker('NS', CID, pts)).toContain('no evidence yet, 0 in the Class Average');
      expect(scoreStatusMarker('NS', CID, prof)).toContain('not counted, no evidence yet');
      COURSES[CID].gradingSystem = 'letter';
      expect(scoreStatusMarker('NS', CID, pts)).toContain('title="Missing: counts as 0"');
      expect(scoreStatusMarker('NS', CID, prof)).toContain(
        'title="Missing: counts as 0 in the % and averages, not in competency proficiency"',
      );
      COURSES[CID].gradingSystem = 'both';
      expect(scoreStatusMarker('NS', CID, pts)).toContain('0 in the course %, not counted in proficiency');
      expect(scoreStatusMarker('NS', CID, prof)).toContain('0 in the course %, not counted in proficiency');
      delete COURSES[CID];
    });
  });
});

describe('gradebook-undo-scope', () => {
  /**
   * Cmd+Z in the gradebook (Nov 3 bug sweep, Gradebook group 1): the undo list
   * was never cleared and never checked, so Cmd+Z in one class changed a score
   * in another, and an old edit was put back over newer grading done in the
   * grader or on the Assignments page. Undo now acts only on the class on
   * screen, and leaves a cell that has changed since the edit.
   */

  const lab = {
    id: 'a1',
    title: 'Lab',
    scoreMode: 'proficiency',
    tagIds: ['T1'],
    date: '2026-10-10',
    type: 'summative',
  };
  const level = (score, note) => ({ assessmentId: 'a1', tagId: 'T1', score, date: '2026-10-10', note: note || '' });

  let stubDocument;
  let win;

  function seed(cid, score) {
    _cache.students[cid] = [{ id: 's1', firstName: 'Ava', lastName: 'Test' }];
    _cache.assessments[cid] = [lab];
    _cache.scores[cid] = { s1: [level(score)] };
    _cache.statuses[cid] = {};
    _cache.courseConfigs[cid] = {};
  }
  const scoreIn = cid => (getScores(cid).s1 || []).map(e => e.score);

  function open(cid) {
    if (globalThis.PageGradebook.destroy) PageGradebook.destroy();
    PageGradebook.init({ course: cid });
  }
  function clearScore() {
    const cell = document.querySelector('.gb-scores-cell[data-aid="a1"][data-sid="s1"]');
    const ev = new win.Event('contextmenu', { bubbles: true, cancelable: true });
    ev.clientX = 10;
    ev.clientY = 10;
    cell.dispatchEvent(ev);
    document.querySelector('[data-ctx="clearCell"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  }
  function cmdZ() {
    const ev = new win.Event('keydown', { bubbles: true, cancelable: true });
    ev.key = 'z';
    ev.metaKey = true;
    document.body.dispatchEvent(ev);
  }

  beforeEach(() => {
    localStorage.clear();
    stubDocument = globalThis.document;
    const dom = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
    );
    win = dom.window;
    const doc = dom.document;
    const make = doc.createElement.bind(doc);
    // The slanted header measures its titles on a canvas.
    doc.createElement = tag => {
      const el = make(tag);
      if (tag === 'canvas') el.getContext = () => ({ measureText: () => ({ width: 50 }) });
      return el;
    };
    globalThis.document = doc;
    globalThis.CSS = { escape: s => String(s) };
    globalThis.getComputedStyle = () => ({});
    PageAssignments.graderOpen = () => false;
    runInThisContext(readFileSync('teacher/page-gradebook.js', 'utf-8'), { filename: 'teacher/page-gradebook.js' });
    seed('cA', 3);
    seed('cB', 2);
  });

  afterEach(() => {
    PageGradebook.destroy();
    globalThis.document = stubDocument;
  });

  describe('Cmd+Z in the gradebook', () => {
    it('puts back a cleared score', () => {
      open('cA');
      clearScore();
      expect(scoreIn('cA')).toEqual([]);
      cmdZ();
      expect(scoreIn('cA')).toEqual([3]);
    });

    it('does nothing to another class', () => {
      open('cA');
      clearScore();
      open('cB');
      cmdZ();
      expect(scoreIn('cA')).toEqual([]);
      expect(scoreIn('cB')).toEqual([2]);
      // Back in Science 8 the edit can still be undone.
      open('cA');
      cmdZ();
      expect(scoreIn('cA')).toEqual([3]);
    });

    it('leaves a cell graded again since the edit', () => {
      open('cA');
      clearScore();
      // The grader, or the Assignments page, gives Ava a 4 with a comment.
      upsertScore('cA', 's1', 'a1', 'T1', 4, '2026-10-10', 'summative', 'Clear labels.');
      cmdZ();
      expect(scoreIn('cA')).toEqual([4]);
      expect(getScoreComment('cA', 's1', 'a1')).toBe('Clear labels.');
    });

    it('still undoes after a refresh brings back a cleared cell as an empty row', () => {
      open('cA');
      clearScore();
      // A class refresh gives the cleared cell back as a level row with no score.
      _cache.scores.cA.s1 = [level(0)];
      cmdZ();
      expect(scoreIn('cA')).toEqual([3]);
    });

    it('still undoes an older edit to another cell', () => {
      _cache.students.cA.push({ id: 's2', firstName: 'Ben', lastName: 'Test' });
      _cache.scores.cA.s2 = [level(2)];
      open('cA');
      const ben = document.querySelector('.gb-scores-cell[data-aid="a1"][data-sid="s2"]');
      const ev = new win.Event('contextmenu', { bubbles: true, cancelable: true });
      ben.dispatchEvent(ev);
      document.querySelector('[data-ctx="clearCell"]').dispatchEvent(new win.Event('click', { bubbles: true }));
      expect(getScores('cA').s2).toEqual([]);
      cmdZ();
      expect(getScores('cA').s2.map(e => e.score)).toEqual([2]);
    });
  });
});

describe('gradebook-zero-on-points', () => {
  /**
   * Typing 0 on a points cell in the Competencies view deleted the score
   * instead of entering 0 (Nov 3 bug sweep, Gradebook group 2). A blank
   * counts toward nothing and a 0 counts as 0%, so a student who earned 0
   * got a higher course %. On points work 0 is now typed like any other
   * digit; on a level it still clears, and Delete still clears both.
   */

  const CID = 'cA';
  const quiz = { id: 'qz', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['T1'], date: '2026-10-10' };
  const lab = { id: 'lv', title: 'Lab', scoreMode: 'proficiency', tagIds: ['T1'], date: '2026-10-09' };
  const entry = (aid, score) => ({ assessmentId: aid, tagId: 'T1', score, date: '2026-10-10', note: '' });

  let stubDocument;
  let nodeEvent;
  let win;

  beforeEach(() => {
    localStorage.clear();
    stubDocument = globalThis.document;
    const dom = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
    );
    win = dom.window;
    const doc = dom.document;
    const make = doc.createElement.bind(doc);
    // The slanted header measures its titles on a canvas; a number box
    // selects its text when it opens; a selected cell scrolls into view.
    doc.createElement = tag => {
      const el = make(tag);
      if (tag === 'canvas') el.getContext = () => ({ measureText: () => ({ width: 50 }) });
      return el;
    };
    win.HTMLElement.prototype.select = () => {};
    win.HTMLElement.prototype.scrollIntoView = () => {};
    globalThis.document = doc;
    nodeEvent = globalThis.Event;
    globalThis.Event = win.Event;
    globalThis.CSS = { escape: s => String(s) };
    globalThis.getComputedStyle = () => ({});
    PageAssignments.graderOpen = () => false;
    runInThisContext(readFileSync('teacher/page-gradebook.js', 'utf-8'), { filename: 'teacher/page-gradebook.js' });
    _cache.students[CID] = [{ id: 's1', firstName: 'Ava', lastName: 'Test' }];
    _cache.assessments[CID] = [quiz, lab];
    _cache.scores[CID] = { s1: [entry('qz', 7), entry('lv', 3)] };
    _cache.statuses[CID] = {};
    _cache.courseConfigs[CID] = {};
    PageGradebook.init({ course: CID });
    document.querySelector('[data-action="setView"][data-mode="detailed"]').click();
  });

  afterEach(() => {
    PageGradebook.destroy();
    globalThis.document = stubDocument;
    globalThis.Event = nodeEvent;
  });

  const scoreOf = aid => (getScores(CID).s1 || []).filter(e => e.assessmentId === aid).map(e => e.score);
  function press(selector, key) {
    const cell = document.querySelector(selector);
    cell.classList.add('gb-focus');
    const ev = new win.Event('keydown', { bubbles: true, cancelable: true });
    ev.key = key;
    document.body.dispatchEvent(ev);
    return cell;
  }
  const PTS = 'td.gb-score[data-aid="qz"][data-sid="s1"][data-pts="1"]';

  describe('typing 0 in the Competencies view', () => {
    it('opens the points box with 0 on points work, and saves a score of 0', () => {
      const cell = press(PTS, '0');
      const inp = cell.querySelector('.gb-pts-input');
      expect(inp).not.toBeNull();
      expect(inp.value).toBe('0');
      expect(scoreOf('qz')).toEqual([7]);
      inp.dispatchEvent(new win.Event('blur'));
      expect(scoreOf('qz')).toEqual([0]);
    });

    it('still clears a level', () => {
      press('td.gb-score[data-aid="lv"][data-sid="s1"][data-tid="T1"]', '0');
      expect(scoreOf('lv').filter(v => v > 0)).toEqual([]);
    });

    it('leaves Delete clearing a points score', () => {
      press(PTS, 'Delete');
      expect(scoreOf('qz')).toEqual([]);
    });
  });
});
