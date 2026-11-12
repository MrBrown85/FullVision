/**
 * report: the tests that were tests/report-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'acorn';
import { parseHTML } from 'linkedom';
import { runInThisContext } from 'vm';

describe('report-academic-summary-letter', () => {
  /**
   * The Progress Report's Academic Summary block. Letter and Both classes
   * show the letter and course % ("A (95%)"), as Class Summary does; Both
   * keeps the proficiency word under it. Proficiency classes are unchanged.
   */

  const CID = 'course-report-letter';
  const SID = 'stu-1';
  const TAG = 'tag-1';
  const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan' };

  const points = (id, max) => ({
    id,
    title: id,
    scoreMode: 'points',
    maxPoints: max,
    tagIds: [TAG],
    type: 'summative',
  });
  const score = (assessmentId, value) => ({ assessmentId, tagId: TAG, score: value, date: '2026-10-10' });

  const stubbed = ['getSections', 'getGroupedSections', 'getOverallProficiency'];
  const originals = {};

  function seed(gradingSystem, scores) {
    COURSES[CID] = { id: CID, name: 'Socials 9', gradingSystem };
    _cache.students[CID] = [STUDENT];
    _cache.categories[CID] = [];
    _cache.assessments[CID] = [points('a', 10), points('b', 10)];
    _cache.scores[CID] = { [SID]: scores };
    _cache.statuses[CID] = {};
    _cache.courseConfigs[CID] = {};
    clearProfCache();
  }

  function summary() {
    return ReportBlocks.renderBlockAcademicSummary(CID, STUDENT);
  }

  describe('Academic Summary overall grade', () => {
    beforeEach(() => {
      localStorage.clear();
      stubbed.forEach(name => (originals[name] = globalThis[name]));
      globalThis.getSections = () => [];
      globalThis.getGroupedSections = () => ({ groups: [], ungrouped: [] });
      globalThis.getOverallProficiency = () => 3;
    });

    afterEach(() => {
      stubbed.forEach(name => (globalThis[name] = originals[name]));
      delete COURSES[CID];
    });

    it('shows the letter and % for a Letter class', () => {
      seed('letter', [score('a', 10), score('b', 9)]);
      const html = summary();
      expect(html).toContain('Overall Grade');
      expect(html).toContain('A (95%)');
      expect(html).not.toContain('Overall Proficiency');
    });

    it('shows the letter and % with the proficiency word for a Both class', () => {
      seed('both', [score('a', 7), score('b', 7)]);
      const html = summary();
      expect(html).toContain('C+ (70%)');
      expect(html).toContain('Overall Proficiency: Proficient');
    });

    it('shows the letter and percent for a Letter class', () => {
      seed('letter', [score('a', 10), score('b', 9)]);
      expect(summary()).toContain('A (95%)');
    });

    it('shows No Evidence for a Letter class with nothing graded', () => {
      seed('letter', []);
      expect(summary()).toContain('No Evidence');
    });

    it('keeps the proficiency word for a Proficiency class', () => {
      seed('proficiency', [score('a', 10), score('b', 9)]);
      const html = summary();
      expect(html).toContain('Overall Proficiency');
      expect(html).toContain('Proficient');
      expect(html).not.toContain('A (95%)');
    });
  });
});

describe('report-best-work-once', () => {
  /**
   * The Proficiency block's Best work names a piece once (Nov 3 bug sweep,
   * reports group 3). Two competencies tied for highest and one assessment
   * scored both, so the line read "Best work: Primary Source Analysis (Oct 2)
   * and Primary Source Analysis (Oct 2), 4.0 / 4."
   */

  const CID = 'report-best-once';
  const SID = 'stu-1';
  const STUDENT = { id: SID, firstName: 'Owen', lastName: 'Martens' };

  function seed(assessments, scores) {
    COURSES[CID] = { id: CID, name: 'Socials 10', gradingSystem: 'proficiency' };
    _cache.students[CID] = [STUDENT];
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [
        { id: 'sec-1', name: 'Evidence', tags: [{ id: 't1', label: 'Evidence' }] },
        { id: 'sec-2', name: 'Perspective', tags: [{ id: 't2', label: 'Perspective' }] },
      ],
      competencyGroups: [],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = assessments;
    _cache.scores[CID] = { [SID]: scores };
    _cache.statuses[CID] = {};
    _cache.rubrics[CID] = [];
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = { calcMethod: 'average' };
    clearProfCache();
  }
  const sc = (assessmentId, tagId, score) => ({ assessmentId, tagId, score, date: '2026-10-10' });
  const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  describe('Best work in the Proficiency block', () => {
    afterEach(() => delete COURSES[CID]);

    it('names a piece that scored two tied competencies once', () => {
      seed(
        [
          { id: 'psa', title: 'Primary Source Analysis', date: '2026-10-02', tagIds: ['t1', 't2'] },
          { id: 'map', title: 'Map Study', date: '2026-10-06', tagIds: ['t2'] },
        ],
        [sc('psa', 't1', 4), sc('psa', 't2', 4), sc('map', 't2', 4)],
      );
      const prof = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
      expect(prof).toContain('Highest now: Evidence and Perspective');
      expect(prof).toContain('Best work: Primary Source Analysis (Oct 2) and Map Study (Oct 6), 4.0 / 4.');
    });

    it('names it once when it is the only piece', () => {
      seed(
        [{ id: 'psa', title: 'Primary Source Analysis', date: '2026-10-02', tagIds: ['t1', 't2'] }],
        [sc('psa', 't1', 4), sc('psa', 't2', 4)],
      );
      const prof = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
      expect(prof).toContain('Best work: Primary Source Analysis (Oct 2), 4.0 / 4.');
    });
  });
});

describe('report-blocks-calc', () => {
  /**
   * Report blocks read levels through calc.js (2026-11-01 math audit).
   * - Core Competencies averaged raw scores, so points work counted as its
   *   points (18 of 20 as level 18, a bar past 100%), Excused work counted,
   *   and the Factor and the report's term were ignored.
   * - Core Competencies let 0% category work lower a level, and counted
   *   Excused and unscored work in "Based on N assessments" (Nov 3 sweep).
   * - The override note rounded the calculated level twice, so 3.46 read
   *   "3.5 Extending".
   * - The Proficiency block's Overall "then" was a flat mean of competencies
   *   while "now" rolls up through competency groups (rollUpSectionLevels).
   */

  const CID = 'report-calc';
  const SID = 'stu-1';
  const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan' };

  function seed({ assessments, scores, statuses = {}, overrides = {}, sections, groups, categories = [] }) {
    COURSES[CID] = { id: CID, name: 'Socials 10', gradingSystem: 'proficiency' };
    _cache.students[CID] = [STUDENT];
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: sections || [{ id: 'sec-1', name: 'Inquiry', tags: [{ id: 't1', label: 'Inquiry' }] }],
      competencyGroups: groups || [],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = categories;
    _cache.assessments[CID] = assessments;
    _cache.scores[CID] = { [SID]: scores };
    _cache.statuses[CID] = statuses;
    _cache.rubrics[CID] = [];
    _cache.overrides[CID] = overrides;
    _cache.courseConfigs[CID] = { calcMethod: 'average' };
    clearProfCache();
  }
  const sc = (assessmentId, score, extra) => ({ assessmentId, tagId: 't1', score, date: '2026-10-10', ...extra });
  const cc = (id, extra) => ({ id, title: id, tagIds: ['t1'], coreCompetencyIds: ['CT'], ...extra });
  // The Creative Thinking row of the Core Competencies block.
  const ctRow = html => {
    const i = html.indexOf('Creative Thinking');
    return html.slice(i, html.indexOf('Based on', i) + 30);
  };

  describe('Core Competencies block', () => {
    afterEach(() => delete COURSES[CID]);

    it('reads points work as its level, not its points', () => {
      seed({ assessments: [cc('a', { scoreMode: 'points', maxPoints: 20 })], scores: [sc('a', 18)] });
      const row = ctRow(ReportBlocks.renderBlockCoreCompetencies(CID, STUDENT));
      // 18 of 20 is 90%: Extending on Points to Proficiency, a full bar
      expect(row).toContain('Extending');
      expect(row).toContain('width:100%');
    });

    it('leaves Excused work out and counts each Factor', () => {
      seed({
        assessments: [cc('a', { weight: 3 }), cc('b'), cc('c')],
        scores: [sc('a', 2), sc('b', 4), sc('c', 1)],
        statuses: { [SID + ':c']: 'EXC' },
      });
      // (2 × 3 + 4) / 4 = 2.5: a 62.5% bar
      expect(ctRow(ReportBlocks.renderBlockCoreCompetencies(CID, STUDENT))).toContain('width:62.5%');
    });

    it('leaves 0% category work out and counts only work with a level', () => {
      seed({
        categories: [
          { id: 'tests', name: 'Tests', weight: 100 },
          { id: 'practice', name: 'Practice', weight: 0 },
        ],
        assessments: [
          cc('lab', { categoryId: 'tests' }),
          cc('quiz', { categoryId: 'tests' }),
          cc('project', { categoryId: 'tests' }),
          cc('practice', { categoryId: 'practice' }),
        ],
        scores: [sc('lab', 4), sc('practice', 1)],
        statuses: { [SID + ':quiz']: 'EXC' },
      });
      const row = ctRow(ReportBlocks.renderBlockCoreCompetencies(CID, STUDENT));
      // Only the Lab counts, as for the curricular competency: Extending
      expect(row).toContain('Extending');
      expect(row).toContain('width:100%');
      expect(row).toContain('Based on 1 assessment<');
    });

    it('still shows the block when tagged work has no level yet', () => {
      seed({ assessments: [cc('a')], scores: [] });
      const row = ctRow(ReportBlocks.renderBlockCoreCompetencies(CID, STUDENT));
      expect(row).toContain('Not yet assessed');
      expect(row).toContain('Based on 0 assessments');
    });
  });

  describe('override note', () => {
    afterEach(() => delete COURSES[CID]);

    it('words the calculated level as it is printed', () => {
      seed({
        assessments: [cc('a', { weight: 54 }), cc('b', { weight: 46 })],
        scores: [sc('a', 3), sc('b', 4)],
        overrides: { [SID]: { 'sec-1': { level: 2, reason: 'Conference' } } },
      });
      // (3 × 54 + 4 × 46) / 100 = 3.46, printed 3.5: Extending, as printed
      // (DECISIONS, "A level reads as it is printed", 2026-11-11).
      expect(getSectionProficiencyRaw(CID, SID, 'sec-1')).toBeCloseTo(3.46, 9);
      expect(ReportBlocks.renderBlockSectionOutcomes(CID, STUDENT)).toContain('calculated: 3.5 Extending');
    });
  });

  describe('rollUpSectionLevels', () => {
    afterEach(() => delete COURSES[CID]);

    it('rolls up through groups exactly as the overall level does', () => {
      seed({
        sections: [
          { id: 's1', name: 'S1', groupId: 'g', tags: [{ id: 't1' }] },
          { id: 's2', name: 'S2', groupId: 'g', tags: [{ id: 't2' }] },
          { id: 's3', name: 'S3', tags: [{ id: 't3' }] },
        ],
        groups: [{ id: 'g', name: 'G' }],
        assessments: [{ id: 'a', title: 'a', tagIds: ['t1', 't2', 't3'] }],
        scores: [sc('a', 2), sc('a', 4, { tagId: 't2' }), sc('a', 1, { tagId: 't3' })],
      });
      // group (2 + 4) / 2 = 3, then (3 + 1) / 2 = 2; a flat mean would be 2.33
      expect(getOverallProficiency(CID, SID)).toBe(2);
      const then = { s1: 2, s2: 4, s3: 1 };
      expect(rollUpSectionLevels(CID, sec => then[sec.id])).toBe(2);
      expect(rollUpSectionLevels(CID, () => 0)).toBe(0);
    });
  });

  /* Progress in One Area and Generate named a competency's level "now" as the
   mean of its last four weeks of scores (startAndNow), so a report could
   print Evidence at 3.0 Proficient in the Proficiency block and 4.0
   Extending beside it, and a teacher's override never reached either
   (Nov 3 bug sweep). Now is the level calc.js grades. */
  describe('the level now is the graded level on every block and the comment', () => {
    afterEach(() => delete COURSES[CID]);
    const run = overrides => {
      seed({
        assessments: [
          cc('a', { date: '2026-09-01' }),
          cc('b', { date: '2026-09-15' }),
          cc('c', { date: '2026-10-15' }),
          cc('d', { date: '2026-10-30' }),
        ],
        scores: [sc('a', 2), sc('b', 2), sc('c', 4), sc('d', 4)],
        overrides,
      });
      _cache.observations[CID] = {};
      _cache.reflections[CID] = {};
      _cache.termRatings[CID] = {};
      const t = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      return {
        level: getSectionProficiency(CID, SID, 'sec-1'),
        prog: t(ReportBlocks.renderBlockProgress(CID, STUDENT, {}, {})),
        prof: t(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {})),
        comp: CommentBank.facts(CID, STUDENT, null).comps[0],
      };
    };

    it('prints the Mean level, not the last weeks’ mean', () => {
      const r = run();
      expect(r.level).toBe(3);
      expect(r.prof).toContain('3.0 Proficient');
      expect(r.prog).toContain('Now 3.0 Proficient (+1.0 this term)');
      expect(r.prog).not.toContain('Extending');
      // The comment works from the same level; its trend stays the trend.
      expect(r.comp.level).toBe(3);
      expect(r.comp.now).toBe(4);
    });

    it('prints the teacher’s override', () => {
      const r = run({ [SID]: { 'sec-1': { level: 2, reason: 'Conference' } } });
      expect(r.level).toBe(2);
      expect(r.prog).toContain('Now 2.0 Developing');
      expect(r.comp.level).toBe(2);
    });
  });
});

describe('report-blocks-context', () => {
  /**
   * Report block renderers are pure: given { termId, termLabel } they render
   * without touching the page. The Reports page builds that context once from
   * the term picker (ReportBlocks.reportContext) and passes it for every
   * student, so the same renderers can run in a measuring stage, a worker, or
   * a server later (docs/report-forms-plan.md, Phase 1).
   */

  const CID = 'course-ctx';
  const SID = 'stu-ctx';
  const STUDENT = { id: SID, firstName: 'Cece', lastName: 'Adeyemi', studentNumber: 'STU-201' };

  let savedGetElementById;
  let savedRating;
  let savedTerms;

  beforeEach(() => {
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency', block: 'A' };
    _cache.students[CID] = [STUDENT];
    _cache.courseConfigs[CID] = {};
    savedRating = globalThis.getStudentTermRating;
    savedTerms = globalThis.getReportingTerms;
    globalThis.getStudentTermRating = (cid, sid, termId) =>
      termId === 'term-2' ? { narrative: 'Cece has grown this term.', habits: { completes: 4, others: 3 } } : null;
    globalThis.getReportingTerms = () => [
      { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-14' },
      { ordinal: 2, label: 'Term 2', starts_on: '2026-11-15', ends_on: '2027-01-29' },
    ];
    savedGetElementById = document.getElementById;
    document.getElementById = () => {
      throw new Error('renderer read the page');
    };
  });

  afterEach(() => {
    document.getElementById = savedGetElementById;
    globalThis.getStudentTermRating = savedRating;
    globalThis.getReportingTerms = savedTerms;
  });

  describe('report block renderers take the term as context', () => {
    const ctx = { termId: 'term-2', termLabel: 'Jan Report Card' };

    it('header prints the report label, the term dates and the student number without reading the page', () => {
      const html = ReportBlocks.renderReportBlock('header', CID, STUDENT, ctx);
      expect(html).toContain('Jan Report Card');
      expect(html).toContain('Term 2');
      expect(html).toContain('Nov 15');
      expect(html).toContain('Student No.</span><span>STU-201');
      expect(html).toContain('Science 8 · Block A');
    });

    it('teacher comment and dispositions use the context term', () => {
      expect(ReportBlocks.renderReportBlock('teacher-narrative', CID, STUDENT, ctx)).toContain(
        'Cece has grown this term.',
      );
      expect(ReportBlocks.renderReportBlock('learner-dimensions', CID, STUDENT, ctx)).toContain('Consistently');
      const other = { termId: 'term-1', termLabel: 'Nov Report Card' };
      expect(ReportBlocks.renderReportBlock('teacher-narrative', CID, STUDENT, other)).toBe('');
      expect(ReportBlocks.renderReportBlock('learner-dimensions', CID, STUDENT, other)).toBe('');
    });

    it('the Teacher Comment prints plain text as paragraphs, one per line, and escapes it', () => {
      const ctx2 = {
        termId: 'term-2',
        narrativeOverride: 'Cece asks <good> questions.\n\nNext: labs on time.\nKeep going.',
      };
      const html = ReportBlocks.renderReportBlock('teacher-narrative', CID, STUDENT, ctx2);
      expect(html).toContain('<p>Cece asks &lt;good&gt; questions.</p><p>Next: labs on time.</p><p>Keep going.</p>');
      const old = { termId: 'term-2', narrativeOverride: '<p>Saved by the old editor.</p>' };
      expect(ReportBlocks.renderReportBlock('teacher-narrative', CID, STUDENT, old)).toContain(
        '<p>Saved by the old editor.</p>',
      );
    });

    it('every block renders with a context and no page', () => {
      const ids = Object.keys(ReportSheets.BLOCKS);
      for (const id of ids) {
        expect(() => ReportBlocks.renderReportBlock(id, CID, STUDENT, ctx), id).not.toThrow();
      }
    });
  });

  describe('reportContext reads the term picker once', () => {
    it('maps "Report N" to term-N and keeps the option text as the label', () => {
      document.getElementById = id =>
        id === 'report-period' ? { value: 'Report 3', selectedIndex: 0, options: [{ text: 'Apr Report Card' }] } : null;
      expect(ReportBlocks.reportContext()).toEqual({ termId: 'term-3', termLabel: 'Apr Report Card' });
      expect(ReportBlocks.termIdFromPeriod('Report 6')).toBe('term-6');
      expect(ReportBlocks.termIdFromPeriod('Spring Update')).toBe('spring-update');
    });

    it('falls back to term-1 when there is no picker', () => {
      document.getElementById = () => null;
      expect(ReportBlocks.reportContext()).toEqual({ termId: 'term-1', termLabel: '' });
    });
  });
});

describe('report-calc-callers', () => {
  /**
   * Which functions in each report file ask calc.js for a grade, pinned
   * (S2-F1; the S2-T1 review's first point).
   *
   * The seam's behaviour tests watch calc.js while the report surfaces are
   * drawn, so they only see what those draws reach. A new function in a
   * report file that asks calc.js for a grade from somewhere they never run
   * (a dialog, a count beside a button) would pass them, and on returned
   * grades it would count drafts. This reads the source instead: every call a
   * report file makes to a calc.js function that reads grades, by the
   * function it sits in. A function new to this list must be one that runs
   * inside withReportScores (one of the file's doors, or reached only from
   * them), and is added here with that said in review.
   *
   *   UPDATE_REPORT_CALC_CALLERS=1 npx vitest run tests/report-calc-callers.test.js
   *   prints the list as it is now.
   */

  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const REPORT_FILE =
    /^(page-reports|report-.*|comment-.*|grade-report|grades-print|rubric-print|phone-reports|export-all)\.js$/;
  const FILES = readdirSync(resolve(ROOT, 'teacher'))
    .filter(name => REPORT_FILE.test(name) && name !== 'report-scores.js')
    .map(name => 'teacher/' + name)
    .concat(['shared/phone-report-view.js'])
    .sort();

  // calc.js functions that read no score (as tests/report-score-seam.test.js lists them).
  const NO_SCORE = new Set([
    'courseGradeMode',
    'formatLevel',
    'levelWord',
    'getActiveTerm',
    'setActiveTerm',
    'printedLevel',
    'roundLevel',
    'wholePercent',
    'oneDecimal',
    'nearestScoreLevelName',
  ]);
  const CALC = new Set(Object.keys(Calc).filter(name => !NO_SCORE.has(name)));

  /* { functionName: [calc functions it calls] } for one file. A call outside
   any named function is filed under '(top level)'. */
  function callers(source) {
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
    const out = {};
    const walk = (node, owner) => {
      if (!node || typeof node.type !== 'string') return;
      let here = owner;
      if (node.type === 'FunctionDeclaration' && node.id) here = node.id.name;
      if (
        node.type === 'VariableDeclarator' &&
        node.id.type === 'Identifier' &&
        node.init &&
        /Function/.test(node.init.type)
      )
        here = node.id.name;
      if (node.type === 'Property' && node.key && /Function/.test((node.value || {}).type || ''))
        here = node.key.name || node.key.value || here;
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && CALC.has(node.callee.name)) {
        const list = (out[here] = out[here] || []);
        if (list.indexOf(node.callee.name) < 0) list.push(node.callee.name);
      }
      Object.keys(node).forEach(key => {
        const value = node[key];
        if (Array.isArray(value)) value.forEach(child => walk(child, here));
        else if (value && typeof value.type === 'string') walk(value, here);
      });
    };
    walk(ast, '(top level)');
    const sorted = {};
    Object.keys(out)
      .sort()
      .forEach(name => (sorted[name] = Object.keys(out[name]).length ? out[name].slice().sort() : []));
    return sorted;
  }

  const now = () => {
    const map = {};
    FILES.forEach(file => {
      const found = callers(readFileSync(resolve(ROOT, file), 'utf-8'));
      if (Object.keys(found).length) map[file] = Object.keys(found);
    });
    return map;
  };

  /* The functions, file by file, that ask calc.js for a grade today. Each
   runs inside withReportScores: it is one of the file's doors (pinned in
   tests/report-score-seam.test.js), or it is reached only from one. */
  const PINNED = JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/report-calc-callers.json'), 'utf-8'));

  describe('the functions in report files that ask calc.js for a grade', () => {
    it('are the ones pinned', () => {
      if (process.env.UPDATE_REPORT_CALC_CALLERS === '1') {
        console.log(JSON.stringify(now(), null, 2));
        return;
      }
      expect(now()).toEqual(PINNED);
    });

    it('page-reports.js asks calc.js only from inside the seam', () => {
      // The Reports page itself draws through the blocks; the one function of its own that asks is a door.
      expect(PINNED['teacher/page-reports.js']).toEqual(['_draftsInPrint']);
      expect(readFileSync(resolve(ROOT, 'teacher/page-reports.js'), 'utf-8')).toContain(
        '_draftsInPrint = _inReportScores(_draftsInPrint);',
      );
    });

    it('sees a new function that asks', () => {
      const found = callers(
        '(function () { function _issueCounts(cid, sid) { return getOverallProficiency(cid, sid); } var x = function () { formatLevel(1); }; })();',
      );
      expect(found).toEqual({ _issueCounts: ['getOverallProficiency'] });
    });
  });
});

describe('report-card-name', () => {
  /**
   * The name at the top of a report card (the Letterhead block) and a printed
   * rubric: the preferred name or the first name, always with the last name
   * (printedStudentName in shared/data.js).
   */

  const NORA = { id: 'st-nora', firstName: 'Eleanor', preferred: 'Nora', lastName: 'Kim' };

  describe('printed student name', () => {
    it('is the preferred name, or the first name, then the last name', () => {
      expect(printedStudentName(NORA, 'preferred')).toBe('Nora Kim');
      expect(printedStudentName(NORA, 'first')).toBe('Eleanor Kim');
      expect(printedStudentName(NORA)).toBe('Nora Kim');
    });

    it('falls back to the first name when there is no preferred name', () => {
      expect(printedStudentName({ firstName: 'Alan', lastName: 'Turing' }, 'preferred')).toBe('Alan Turing');
    });
  });

  describe('report card Letterhead', () => {
    it('offers Preferred Name or First Name, Preferred by default', () => {
      const opt = ReportSheets.BLOCKS.header.options.find(o => o.key === 'name');
      expect(opt.def).toBe('preferred');
      expect(opt.choices.map(c => c.v)).toEqual(['preferred', 'first']);
    });

    it('prints the chosen name with the last name', () => {
      COURSES['c-name'] = { id: 'c-name', name: 'Science 8' };
      const head = style => ReportBlocks.renderBlockHeader('c-name', NORA, { termLabel: 'Term 1' }, { name: style });
      expect(head('preferred')).toContain('<div class="report-student-name">Nora Kim</div>');
      expect(head('first')).toContain('<div class="report-student-name">Eleanor Kim</div>');
      delete COURSES['c-name'];
    });
  });
});

describe('report-continued-name', () => {
  /**
   * Every side after the Front (the Back, a Continued side, an After the
   * Report side) starts with a line naming the student and the class, so a
   * sheet printed single-sided can be matched to its student (Nov 3 bug
   * sweep, step 4 group 1 #5; Colin, Nov 3: "Yes, all three"). The engine
   * keeps room for the line, so nothing runs past the foot of a side.
   */

  const H = 996;
  const HEAD = 16;
  const TOP = HEAD + 12;
  const P = (sides, opts) => ReportSheets.pack(sides, { H, gap: 12, pinned: null, head: HEAD, ...opts });
  const c = (id, px, more) => ({ id, size: 'row', px, ...more });
  const NORA = { id: 'st-nora', firstName: 'Eleanor', preferred: 'Nora', lastName: 'Kim' };
  const kinds = r => r.sides.map(s => [s.kind, s.from, !!s.head, s.rows.map(x => x.y)]);

  describe('ReportSheets.pack: room for the name line', () => {
    it('the Front starts at the top; the Back and a Continued side start under the line', () => {
      const r = P([[[c('header', 600)], [c('a', 300)], [c('b', 300)]], [[c('dims', 200)]]]);
      expect(kinds(r)).toEqual([
        ['side', 0, false, [0, 612]],
        ['continued', 0, true, [TOP]],
        ['side', 1, true, [TOP]],
      ]);
    });

    it('a row too tall to fit under the line goes after the report instead of running past the foot; a table goes on', () => {
      // H - 10 fits a bare side but not one with the line: it would have been
      // placed at y = 28 on a Continued side and cut off in print.
      const r = P([[[c('header', 81)], [c('reflection', H - 10)]]]);
      expect(kinds(r)).toEqual([
        ['side', 0, false, [0]],
        ['after', null, true, [TOP]],
      ]);
      expect(r.after).toEqual(['reflection']);
      expect(r.sides[1].rows[0].h).toBe(H - TOP);
      expect(r.over).toBe(true);
      // A table that tall starts under the letterhead and goes on under the
      // line on the next side, cut at its rows, and nothing is over.
      const rows = Array.from({ length: 31 }, () => 30);
      const t = P([[[c('header', 81)], [c('grades', 60 + 31 * 30, { rows, chrome: 60 })]]]);
      expect(t.sides.map(s => s.kind)).toEqual(['side', 'continued']);
      expect(t.sides[0].rows[1].cells[0].part).toEqual({ start: 0, end: 28 });
      expect(t.sides[1].rows[0].y).toBe(TOP);
      expect(t.sides[1].rows[0].cells[0].part).toEqual({ start: 28, end: 31 });
      t.sides.forEach(s => s.rows.forEach(r => expect(r.y + r.h).toBeLessThanOrEqual(H)));
      expect(t.over).toBe(false);
    });

    it('a row that tall still fits where it is on the Front', () => {
      const r = P([[[c('reflection', H - 10)]]]);
      expect(kinds(r)).toEqual([['side', 0, false, [0]]]);
    });

    it('never leaves a Continued side empty for a row that fits under the line', () => {
      const r = P([[[c('header', 100)], [c('a', H - TOP)]]]);
      expect(kinds(r)).toEqual([
        ['side', 0, false, [0]],
        ['continued', 0, true, [TOP]],
      ]);
    });

    it('a block docked to the bottom of the Back stays under the line', () => {
      const r = P([[[c('header', 81)]], [[c('response', H)]]], { pinned: 'response' });
      expect(r.sides[1].pinned).toEqual({ id: 'response', size: 'row', h: H - TOP, y: TOP });
      expect(r.over).toBe(true);
    });

    it('without a line (head 0) nothing moves', () => {
      const r = ReportSheets.pack([[[c('header', 600)], [c('a', 500)]], [[c('b', 100)]]], { H, gap: 12, pinned: null });
      expect(r.sides.map(s => s.rows.map(x => x.y))).toEqual([[0], [0], [0]]);
    });
  });

  describe('ReportBlocks.renderContinuedLine', () => {
    afterEach(() => {
      delete COURSES['c-cont'];
    });
    it('names the student as the letterhead does, then the class and block', () => {
      COURSES['c-cont'] = { id: 'c-cont', name: 'Science 8', block: 'A' };
      expect(ReportBlocks.renderContinuedLine('c-cont', NORA, { name: 'preferred' })).toBe(
        '<div class="sheet-name-line">Nora Kim · Science 8 · Block A (continued)</div>',
      );
      expect(ReportBlocks.renderContinuedLine('c-cont', NORA, { name: 'first' })).toContain('Eleanor Kim');
    });
  });

  describe('ReportSheets.layoutStudent: every side after the Front names its student', () => {
    const LINE = 'Nora Kim · Science 8 · Block A (continued)';
    let origDoc;
    afterEach(() => {
      globalThis.document = origDoc;
      delete COURSES['c-cont'];
    });
    /* Lays Nora out on `sides` with each block `px` tall, and returns each
     printed side's kind and its first line (or null). */
    const layout = (sides, px) => {
      COURSES['c-cont'] = { id: 'c-cont', name: 'Science 8', block: 'A' };
      const dom = parseHTML('<!doctype html><html><body></body></html>');
      origDoc = globalThis.document;
      globalThis.document = dom.document;
      // linkedom has no layout: each block is `px` tall, the line 16px.
      Object.defineProperty(dom.HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get() {
          return this.classList.contains('sheet-name-line') ? HEAD : px[this.dataset.block] || 0;
        },
      });
      const form = ReportSheets.normalizeForm({ v: 6, sides, pinned: null });
      const stage = document.createElement('div');
      document.body.appendChild(stage);
      const probe = { linePx: 22, boxChromePx: 40 };
      const r = ReportSheets.layoutStudent('c-cont', NORA, {}, { form, paper: 'letter', stage, probe });
      stage.remove();
      const host = document.createElement('div');
      host.innerHTML = r.html;
      return [...host.querySelectorAll('.report-sheet')].map(s => {
        const first = s.querySelector('.sheet-body').firstElementChild;
        return [
          s.dataset.kind || 'blank',
          first && first.classList.contains('sheet-name-line') ? first.textContent : null,
          s.querySelectorAll('.sheet-name-line').length,
        ];
      });
    };
    const text = { block: 'text-block', size: 'row', options: { title: 'Notes', text: 'Field trip on Friday.' } };
    const row = cell => ({ cells: [cell] });

    it('prints the line on the Back, a Continued side and an After the Report side, not on the Front', () => {
      const sides = layout(
        [
          { rows: [row({ block: 'header', size: 'row' }), row(text)] },
          { rows: [row({ block: 'teacher-narrative', size: 'row' }), row({ block: 'parent-response', size: 'row' })] },
        ],
        { header: 600, 'text-block': 600, 'teacher-narrative': 300, 'parent-response': H - 10 },
      );
      expect(sides).toEqual([
        ['side', null, 0],
        ['continued', LINE, 1],
        ['side', LINE, 1],
        ['after', LINE, 1],
      ]);
    });

    it('an empty Back prints no line', () => {
      const sides = layout([{ rows: [row({ block: 'header', size: 'row' }), row(text)] }, { rows: [] }], {
        header: 100,
        'text-block': 100,
      });
      expect(sides).toEqual([
        ['side', null, 0],
        ['side', null, 0],
      ]);
    });
  });
});

describe('report-feedback-cards', () => {
  /**
   * The Quick Report's Feedback Pages cards (teacher/report-feedback-cards.js):
   * the HTML for each kind of item from ReportFeedback.forStudent, plus the
   * observations and Term Comment cards.
   */

  const F = ReportFeedback;

  /* The tests run without a DOM, so this is a small parser for the markup the
   cards produce: nested tags, class and colspan attributes, text with the
   five escaped entities. querySelector takes compound selectors (b.fb-lvl)
   joined by spaces (thead th). */
  const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

  class El {
    constructor(tag, attrs) {
      this.tag = tag;
      this.attrs = attrs || {};
      this.nodes = [];
    }
    get className() {
      return this.attrs.class || '';
    }
    get classList() {
      const list = this.className.split(/\s+/).filter(Boolean);
      return { contains: c => list.indexOf(c) >= 0 };
    }
    get children() {
      return this.nodes.filter(n => n instanceof El);
    }
    get firstElementChild() {
      return this.children[0] || null;
    }
    get lastElementChild() {
      return this.children[this.children.length - 1] || null;
    }
    get textContent() {
      return this.nodes.map(n => (typeof n === 'string' ? n : n.textContent)).join('');
    }
    getAttribute(name) {
      return this.attrs[name] == null ? null : this.attrs[name];
    }
    matches(compound) {
      const m = compound.match(/^([a-z0-9]*)((?:\.[\w-]+)*)$/i);
      if (m[1] && m[1] !== this.tag) return false;
      return m[2]
        .split('.')
        .filter(Boolean)
        .every(c => this.classList.contains(c));
    }
    querySelectorAll(selector) {
      const parts = selector.split(/\s+/);
      const out = [];
      const walk = (el, idx) => {
        el.children.forEach(child => {
          const hit = child.matches(parts[idx]);
          if (hit && idx === parts.length - 1) out.push(child);
          walk(child, hit && idx < parts.length - 1 ? idx + 1 : idx);
        });
      };
      walk(this, 0);
      return out;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  }

  function dom(html) {
    const root = new El('root');
    const stack = [root];
    const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;
    let m;
    while ((m = re.exec(html))) {
      const top = stack[stack.length - 1];
      if (m[4] != null) {
        top.nodes.push(m[4].replace(/&(amp|lt|gt|quot|#39);/g, e => ENT[e]));
      } else if (m[1]) {
        stack.pop();
      } else {
        const attrs = {};
        m[3].replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => (attrs[k] = v));
        const el = new El(m[2].toLowerCase(), attrs);
        top.nodes.push(el);
        stack.push(el);
      }
    }
    return root;
  }

  function fb(text) {
    return { text: text, date: 'Oct 6', dateIso: '2026-10-06' };
  }

  function row(over) {
    return Object.assign(
      {
        criterionId: 'k1',
        name: 'Inquiry',
        codes: [],
        levels: { 4: 'Four.', 3: 'Three.', 2: 'Two.', 1: 'One.' },
        level: 3,
        mod: 0,
        mixed: false,
        comment: '',
        beyond: '',
        checks: null,
      },
      over,
    );
  }

  function item(over) {
    return Object.assign(
      {
        id: 'a1',
        title: 'Cell Lab',
        date: 'Oct 3',
        dateIso: '2026-10-03',
        category: 'Labs',
        kind: 'rubric',
        grade: { text: 'Proficient', word: 'Proficient', letter: '' },
        status: '',
        feedback: [],
        rubric: { name: 'Lab Rubric', style: 'standard', levelOrder: [4, 3, 2, 1], rows: [row()] },
      },
      over,
    );
  }

  const pointsItem = over =>
    item(
      Object.assign(
        {
          kind: 'points',
          title: 'Energy Quiz',
          rubric: null,
          score: '8',
          outOf: '10',
          percent: '80%',
          feedback: [fb('Review questions 4 and 7.')],
        },
        over,
      ),
    );

  const completeItem = over =>
    item(
      Object.assign(
        {
          kind: 'complete',
          title: 'Reading Log',
          rubric: null,
          mark: 'complete',
          grade: { text: 'Complete', word: '', letter: '' },
          feedback: [fb('All five entries done.')],
        },
        over,
      ),
    );

  describe('card title bar', () => {
    it('shows the title, "Category · Date", the grade pill and no student name', () => {
      const el = dom(F.cardHtml(item()));
      expect(el.querySelector('.fb-title').textContent).toBe('Cell Lab');
      expect(el.querySelector('.fb-meta').textContent).toBe('Labs · Oct 3');
      expect(el.querySelector('.fb-pill').textContent).toBe('Proficient');
      expect(el.querySelector('.fb-status')).toBeNull();
    });

    it('shows a Letter class grade as the pill text', () => {
      const el = dom(F.cardHtml(pointsItem({ grade: { text: 'C+ 70%', word: '', letter: 'C+ 70%' } })));
      expect(el.querySelector('.fb-pill').textContent).toBe('C+ 70%');
    });

    it('puts Late, Missing or Excused under the pill, or alone with no grade', () => {
      const late = dom(F.cardHtml(item({ status: 'Late' })));
      expect(late.querySelector('.fb-right').children[0].className).toBe('fb-pill');
      expect(late.querySelector('.fb-right').children[1].textContent).toBe('Late');
      const missing = dom(F.cardHtml(item({ status: 'Missing', grade: null, feedback: [fb('Hand it in.')] })));
      expect(missing.querySelector('.fb-pill')).toBeNull();
      expect(missing.querySelector('.fb-status').textContent).toBe('Missing');
    });

    it('shows the number box only when opts.number is given', () => {
      expect(dom(F.cardHtml(item())).querySelector('.fb-num')).toBeNull();
      expect(dom(F.cardHtml(item(), {})).querySelector('.fb-num')).toBeNull();
      const el = dom(F.cardHtml(item(), { number: 17 }));
      expect(el.querySelector('.fb-num').textContent).toBe('17');
      // The box sits before the title.
      expect(el.querySelector('.fb-title-row').firstElementChild.className).toBe('fb-num');
    });

    it('returns an empty string with no item', () => {
      expect(F.cardHtml(null)).toBe('');
    });
  });

  describe('points and Complete/Incomplete cards', () => {
    it('points: a score box with the percent and "Points", beside the Feedback', () => {
      const el = dom(F.cardHtml(pointsItem()));
      expect(el.querySelector('.fb-score-n').textContent).toBe('8');
      expect(el.querySelector('.fb-score-of').textContent).toBe('out of 10');
      expect(el.querySelector('.fb-score').textContent).toContain('80% · Points');
      const split = el.querySelector('.fb-split');
      expect(split.children).toHaveLength(2);
      expect(split.children[0].className).toBe('fb-score');
      expect(split.children[1].textContent).toBe('Feedback Review questions 4 and 7.');
      expect(el.querySelector('.fb-rb')).toBeNull();
    });

    it('points with no score (Missing) leaves the score box off', () => {
      const el = dom(F.cardHtml(pointsItem({ score: '', percent: '', grade: null, status: 'Missing' })));
      expect(el.querySelector('.fb-score')).toBeNull();
      expect(el.querySelector('.fb-feedback')).not.toBeNull();
    });

    it('complete: a filled ✓ square and "Complete", beside the Feedback', () => {
      const el = dom(F.cardHtml(completeItem()));
      expect(el.querySelector('.fb-sq').classList.contains('is-on')).toBe(true);
      expect(el.querySelector('.fb-sq').textContent).toBe('✓');
      expect(el.querySelector('.fb-complete-word').textContent).toBe('Complete');
      expect(el.querySelector('.fb-split').children).toHaveLength(2);
    });

    it('incomplete: an empty square and "Incomplete"', () => {
      const el = dom(
        F.cardHtml(completeItem({ mark: 'incomplete', grade: { text: 'Incomplete', word: '', letter: '' } })),
      );
      expect(el.querySelector('.fb-sq').classList.contains('is-on')).toBe(false);
      expect(el.querySelector('.fb-sq').textContent).toBe('');
      expect(el.querySelector('.fb-complete-word').textContent).toBe('Incomplete');
    });

    it('with no feedback there is no Feedback box and never filler text', () => {
      const html = F.cardHtml(pointsItem({ feedback: [] }));
      expect(dom(html).querySelector('.fb-feedback')).toBeNull();
      expect(html).not.toMatch(/No feedback/i);
    });
  });

  describe('rubric tables', () => {
    it('header = rubric name + the four level names, rows in the class order', () => {
      const el = dom(F.cardHtml(item()));
      const heads = [...el.querySelectorAll('thead th')].map(h => h.textContent);
      expect(heads).toEqual(['Lab Rubric', 'Extending', 'Proficient', 'Developing', 'Emerging']);
      const cells = [...el.querySelectorAll('tbody tr')[0].querySelectorAll('td')].map(c => c.textContent);
      expect(cells.map(c => c.replace('✓', ''))).toEqual(['Four.', 'Three.', 'Two.', 'One.']);
    });

    it('reverses the columns when the class lists Emerging first', () => {
      const rubric = { name: 'Lab Rubric', style: 'standard', levelOrder: [1, 2, 3, 4], rows: [row()] };
      const el = dom(F.cardHtml(item({ rubric })));
      expect([...el.querySelectorAll('thead th')].map(h => h.textContent)).toEqual([
        'Lab Rubric',
        'Emerging',
        'Developing',
        'Proficient',
        'Extending',
      ]);
      const tds = [...el.querySelectorAll('tbody tr')[0].querySelectorAll('td')];
      expect(tds.map(c => c.textContent.replace('✓', ''))).toEqual(['One.', 'Two.', 'Three.', 'Four.']);
      // The chosen level follows its column.
      expect(tds[2].classList.contains('fb-on')).toBe(true);
    });

    it('marks only the chosen level: grey cell, ✓, and ✓+ or ✓− for a modifier', () => {
      const marked = mod =>
        dom(
          F.cardHtml(
            item({ rubric: { name: 'R', style: 'standard', levelOrder: [4, 3, 2, 1], rows: [row({ mod })] } }),
          ),
        );
      const plain = marked(0);
      expect(plain.querySelectorAll('.fb-on')).toHaveLength(1);
      expect(plain.querySelector('.fb-on').textContent).toBe('✓Three.');
      expect(plain.querySelectorAll('.fb-mk')).toHaveLength(1);
      expect(marked(1).querySelector('.fb-mk').textContent).toBe('✓+');
      expect(marked(-1).querySelector('.fb-mk').textContent).toBe('✓−');
    });

    it('marks nothing on an unscored criterion', () => {
      const el = dom(
        F.cardHtml(
          item({ rubric: { name: 'R', style: 'standard', levelOrder: [4, 3, 2, 1], rows: [row({ level: 0 })] } }),
        ),
      );
      expect(el.querySelector('.fb-on')).toBeNull();
      expect(el.querySelector('.fb-mk')).toBeNull();
    });

    it('adds a comment row under a criterion only when it has a comment', () => {
      const rows = [
        row({ name: 'Inquiry', comment: 'Ask a sharper question.' }),
        row({ name: 'Communication', comment: '  ' }),
      ];
      const el = dom(F.cardHtml(item({ rubric: { name: 'R', style: 'standard', levelOrder: [4, 3, 2, 1], rows } })));
      const trs = [...el.querySelectorAll('tbody tr')];
      expect(trs.map(t => t.className)).toEqual(['', 'fb-cm', '']);
      expect(trs[1].textContent).toBe('Comment Ask a sharper question.');
      expect(trs[1].querySelector('td').getAttribute('colspan')).toBe('5');
      expect(trs[0].querySelector('th').textContent).toBe('Inquiry');
    });

    it('a Tag Rubric and a General Rubric use the same table with their own name', () => {
      const tags = dom(
        F.cardHtml(
          item({
            kind: 'tags',
            rubric: {
              name: 'Tag Rubric',
              style: 'standard',
              levelOrder: [4, 3, 2, 1],
              rows: [row({ name: 'Questioning' })],
            },
          }),
        ),
      );
      expect(tags.querySelector('thead th').textContent).toBe('Tag Rubric');
      expect(tags.querySelector('.fb-card').classList.contains('fb-tags')).toBe(true);
      const general = dom(
        F.cardHtml(
          item({
            kind: 'general',
            rubric: {
              name: 'General Rubric',
              style: 'standard',
              levelOrder: [4, 3, 2, 1],
              rows: [row({ name: 'Overall' })],
            },
          }),
        ),
      );
      expect(general.querySelector('tbody th').textContent).toBe('Overall');
    });

    it('Advanced: every check at every level, ticked and unticked', () => {
      const checks = {
        4: [{ id: 'k4', label: 'Tests two designs', ticked: false }],
        3: [
          { id: 'k3a', label: 'Draws a plan', ticked: true },
          { id: 'k3b', label: 'Labels parts', ticked: false },
        ],
        2: [{ id: 'k2', label: 'Builds a model', ticked: true }],
        1: [],
      };
      const el = dom(
        F.cardHtml(
          item({ rubric: { name: 'Build', style: 'advanced', levelOrder: [4, 3, 2, 1], rows: [row({ checks })] } }),
        ),
      );
      const tds = [...el.querySelectorAll('tbody td')];
      expect(tds.map(td => td.querySelectorAll('.fb-ck').length)).toEqual([1, 2, 1, 0]);
      expect(tds[0].querySelector('.fb-bx').classList.contains('is-on')).toBe(false);
      const level3 = [...tds[1].querySelectorAll('.fb-bx')];
      expect(level3.map(b => b.classList.contains('is-on'))).toEqual([true, false]);
      expect(level3.map(b => b.textContent)).toEqual(['✓', '']);
      expect(tds[1].textContent).toContain('Labels parts');
      // Unchosen levels still list their checks; the chosen cell keeps its mark.
      expect(tds[1].classList.contains('fb-on')).toBe(true);
      expect(tds[0].classList.contains('fb-on')).toBe(false);
      expect(tds[2].querySelectorAll('.fb-bx.is-on')).toHaveLength(1);
    });

    it('single-point: Work On | Proficient Standard | Went Beyond, the standard names the level', () => {
      const rubric = {
        name: 'Speech',
        style: 'single_point',
        levelOrder: [4, 3, 2, 1],
        rows: [
          row({
            name: 'Delivery',
            level: 4,
            comment: 'Slow down.',
            beyond: 'Used a prop.',
            levels: { 4: '', 3: 'Speaks clearly.', 2: '', 1: '' },
          }),
          row({ name: 'Volume', level: 0, comment: '', beyond: '' }),
          row({
            name: 'Pace',
            level: 3,
            mod: 1,
            comment: '',
            beyond: '',
            levels: { 4: '', 3: 'Steady.', 2: '', 1: '' },
          }),
        ],
      };
      const el = dom(F.cardHtml(item({ kind: 'rubric', rubric })));
      // The ± goes with the level name, as Print Rubrics names it.
      expect(el.querySelectorAll('tbody tr')[2].querySelector('b.fb-lvl').textContent).toBe('Proficient +');
      expect([...el.querySelectorAll('thead th')].map(h => h.textContent)).toEqual([
        'Speech',
        'Work On',
        'Proficient Standard',
        'Went Beyond',
      ]);
      const tds = [...el.querySelectorAll('tbody tr')[0].querySelectorAll('td')];
      expect(tds.map(t => t.textContent)).toEqual(['Slow down.', 'ExtendingSpeaks clearly.', 'Used a prop.']);
      expect(tds[1].querySelector('b.fb-lvl').textContent).toBe('Extending');
      expect(tds[1].classList.contains('fb-on')).toBe(true);
      expect(el.querySelectorAll('.fb-cm')).toHaveLength(0);
      // An unscored row names no level and has no grey cell.
      const second = el.querySelectorAll('tbody tr')[1];
      expect(second.querySelector('.fb-on')).toBeNull();
      expect(second.querySelector('.fb-lvl')).toBeNull();
    });

    it('puts the Feedback box under the table, and none when feedback is empty', () => {
      const withFb = dom(F.cardHtml(item({ feedback: [fb('Good lab.'), fb('Redo part 2.')] })));
      const box = withFb.querySelector('.fb-card').lastElementChild;
      expect(box.className).toBe('fb-feedback');
      expect(box.textContent).toBe('Feedback Good lab.Redo part 2.');
      const none = F.cardHtml(item());
      expect(dom(none).querySelector('.fb-feedback')).toBeNull();
      expect(none).not.toMatch(/No feedback/i);
    });
  });

  describe('observations and Term Comment cards', () => {
    it('observations: a row each with date, text and tags', () => {
      const el = dom(
        F.observationsCardHtml([
          {
            id: 'o1',
            date: 'Oct 6',
            dateIso: '2026-10-06',
            text: 'Led the group.',
            tags: ['Collaboration', 'Leadership'],
          },
          { id: 'o2', date: 'Oct 9', dateIso: '2026-10-09', text: 'Asked a good question.', tags: [] },
        ]),
      );
      expect(el.querySelector('.fb-title').textContent).toBe('Observations');
      const rows = el.querySelectorAll('.fb-obs');
      expect(rows).toHaveLength(2);
      expect(rows[0].querySelector('b').textContent).toBe('Oct 6');
      expect(rows[0].textContent).toContain('Led the group.');
      expect(rows[0].querySelector('.fb-tags').textContent).toBe('Collaboration, Leadership');
      expect(rows[1].querySelector('.fb-tags')).toBeNull();
      expect(el.querySelector('.fb-pill')).toBeNull();
    });

    it('observations and term comment: a later piece says (continued)', () => {
      const o = [{ id: 'o', date: 'Oct 6', dateIso: '', text: 'Led.', tags: [] }];
      expect(dom(F.observationsCardHtml(o, { continued: true })).querySelector('.fb-title').textContent).toBe(
        'Observations (continued)',
      );
      expect(dom(F.termCommentCardHtml('Hello.', { continued: true })).querySelector('.fb-title').textContent).toBe(
        'Term Comment (continued)',
      );
    });

    it('observations: nothing for an empty list', () => {
      expect(F.observationsCardHtml([])).toBe('');
      expect(F.observationsCardHtml(null)).toBe('');
    });

    it('term comment: a paragraph per line, nothing when empty', () => {
      const el = dom(F.termCommentCardHtml('First thought.\nSecond thought.'));
      expect(el.querySelector('.fb-title').textContent).toBe('Term Comment');
      expect([...el.querySelectorAll('.fb-para')].map(p => p.textContent)).toEqual([
        'First thought.',
        'Second thought.',
      ]);
      expect(F.termCommentCardHtml('')).toBe('');
      expect(F.termCommentCardHtml('  \n ')).toBe('');
    });
  });

  describe('escaping', () => {
    const evil = '<img src=x onerror=alert(1)> & "quoted"';

    it('escapes every field on a rubric card', () => {
      const html = F.cardHtml(
        item({
          title: evil,
          category: evil,
          status: evil,
          grade: { text: evil, word: '', letter: '' },
          feedback: [fb(evil)],
          rubric: {
            name: evil,
            style: 'advanced',
            levelOrder: [4, 3, 2, 1],
            rows: [
              row({
                name: evil,
                comment: evil,
                levels: { 4: evil, 3: evil, 2: evil, 1: evil },
                checks: { 4: [{ id: 'x', label: evil, ticked: true }], 3: [], 2: [], 1: [] },
              }),
            ],
          },
        }),
        { number: evil },
      );
      expect(html).not.toContain('<img');
      expect(dom(html).querySelector('img')).toBeNull();
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;');
    });

    it('escapes points, single-point, observation and term comment text', () => {
      const htmls = [
        F.cardHtml(pointsItem({ title: evil, score: evil, outOf: evil, percent: evil, feedback: [fb(evil)] })),
        F.cardHtml(
          item({
            rubric: {
              name: 'S',
              style: 'single_point',
              levelOrder: [4, 3, 2, 1],
              rows: [row({ name: evil, comment: evil, beyond: evil, levels: { 3: evil } })],
            },
          }),
        ),
        F.observationsCardHtml([{ id: 'o', date: evil, dateIso: '', text: evil, tags: [evil] }]),
        F.termCommentCardHtml(evil),
      ];
      htmls.forEach(html => {
        expect(dom(html).querySelector('img')).toBeNull();
        expect(html).not.toContain('<img');
      });
    });
  });
});

describe('report-feedback', () => {
  /**
   * The data behind the Quick Report's Feedback Pages (teacher/report-feedback.js):
   * which assessments get a card, what each card carries, the student's
   * observations and the term comment.
   */

  const F = ReportFeedback;
  const CID = 'f1111111-1111-4111-8111-111111111111';
  const SID = 'f3333333-3333-4333-8333-333333333333';
  const ST = { id: SID, firstName: 'Ada', lastName: 'Lovelace' };
  const RUBRIC = 'f5555555-5555-4555-8555-555555555551';
  const RUBRIC_SP = 'f5555555-5555-4555-8555-555555555552';
  const RUBRIC_ADV = 'f5555555-5555-4555-8555-555555555553';
  const CRIT_A = 'f6666666-6666-4666-8666-666666666661';
  const CRIT_B = 'f6666666-6666-4666-8666-666666666662';
  const CRIT_SP = 'f6666666-6666-4666-8666-666666666663';
  const CRIT_ADV = 'f6666666-6666-4666-8666-666666666664';
  const TAG_1 = 'f8888888-8888-4888-8888-888888888881';
  const TAG_2 = 'f8888888-8888-4888-8888-888888888882';

  const LEVELS = { 4: 'Four.', 3: 'Three.', 2: 'Two.', 1: 'One.' };

  // Each assessment is named for what it tests; dates set the order.
  const WORK = [
    { id: 'score-only', title: 'Score Only', date: '2026-09-10', categoryId: 'c2', scoreMode: 'points', maxPoints: 10 },
    { id: 'points', title: 'Energy Quiz', date: '2026-10-01', categoryId: 'c2', scoreMode: 'points', maxPoints: 20 },
    { id: 'done', title: 'Reading Log', date: '2026-10-02', categoryId: 'c1', scoreMode: 'complete' },
    { id: 'not-done', title: 'Exit Slip', date: '2026-10-02', categoryId: 'c1', scoreMode: 'complete' },
    { id: 'rubric', title: 'Cell Lab', date: '2026-10-03', categoryId: 'c1', tagIds: [TAG_1, TAG_2], rubricId: RUBRIC },
    { id: 'tags', title: 'Lab Write-Up', date: '2026-10-05', categoryId: 'c1', tagIds: [TAG_1, TAG_2] },
    { id: 'missing', title: 'Poster', date: '2026-10-06', categoryId: 'c1', tagIds: [TAG_1] },
    { id: 'excused', title: 'Field Trip', date: '2026-10-07', categoryId: 'c1', tagIds: [TAG_1] },
    { id: 'unscored', title: 'Not Marked', date: '2026-10-08', categoryId: 'c1', tagIds: [TAG_1] },
    { id: 'single', title: 'Speech', date: '2026-10-09', categoryId: 'c1', tagIds: [], rubricId: RUBRIC_SP },
    { id: 'advanced', title: 'Model Build', date: '2026-10-10', categoryId: 'c1', tagIds: [], rubricId: RUBRIC_ADV },
    { id: 'dibels', title: 'Fall Benchmark', date: '2026-10-11', scoreMode: 'dibels' },
  ];

  function entry(aid, tagId, score, extra) {
    return Object.assign({ id: aid + ':' + tagId, assessmentId: aid, tagId: tagId, score: score, note: '' }, extra);
  }

  function comment(id, aid, text, date) {
    return {
      id: id,
      text: text,
      dims: [],
      created: date + 'T15:00:00.000Z',
      date: date,
      assignmentContext: { assessmentId: aid, assessmentTitle: '' },
    };
  }

  function seed() {
    saveStudents(CID, [{ id: SID, firstName: 'Ada', lastName: 'Lovelace' }]);
    saveCategories(CID, [
      { id: 'c1', name: 'Labs', weight: 50 },
      { id: 'c2', name: 'Quizzes', weight: 50 },
    ]);
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [
        { id: 'sec1', name: 'Inquiry', tags: [{ id: TAG_1, label: 'Questioning', code: 'QAP' }] },
        { id: 'sec2', name: 'Planning', tags: [{ id: TAG_2, label: 'Planning' }] },
      ],
      _customized: true,
      _flatVersion: 2,
    };
    saveRubrics(CID, [
      {
        id: RUBRIC,
        name: 'Lab Rubric',
        criteria: [
          { id: CRIT_A, name: 'Inquiry', tagIds: [TAG_1, TAG_2], levels: LEVELS },
          { id: CRIT_B, name: 'Communication', tagIds: [], levels: LEVELS },
        ],
      },
      {
        id: RUBRIC_SP,
        name: 'Speech Rubric',
        style: 'single_point',
        criteria: [{ id: CRIT_SP, name: 'Delivery', tagIds: [], levels: { 3: 'Speaks clearly.' } }],
      },
      {
        id: RUBRIC_ADV,
        name: 'Build Rubric',
        style: 'advanced',
        criteria: [
          {
            id: CRIT_ADV,
            name: 'Design',
            tagIds: [],
            levels: LEVELS,
            checks: [
              { id: 'k4', level: 4, label: 'Tests two designs', displayOrder: 0 },
              { id: 'k3b', level: 3, label: 'Labels parts', displayOrder: 1 },
              { id: 'k3a', level: 3, label: 'Draws a plan', displayOrder: 0 },
              { id: 'k2', level: 2, label: 'Builds a model', displayOrder: 0 },
            ],
          },
        ],
      },
    ]);
    saveAssessments(CID, WORK);
    saveScores(CID, {
      [SID]: [
        entry('score-only', '', 8),
        entry('points', '', 16, { note: 'Check question 3.\nShow the units.' }),
        entry('done', '', 1, { note: 'Neat and on time.' }),
        entry('not-done', '', 0),
        entry('rubric', TAG_1, 3, { mod: 1, critNote: 'Ask a sharper question.' }),
        entry('rubric', TAG_2, 3, { mod: 1, critNote: 'Ask a sharper question.' }),
        entry('rubric', CRIT_B, 2),
        entry('tags', TAG_1, 3),
        entry('tags', TAG_2, 0, { critNote: 'Plan before you start.' }),
        entry('single', CRIT_SP, 3, { critNote: 'Slow down.', critBeyond: 'Used a prop.' }),
        entry('advanced', CRIT_ADV, 3),
        entry('excused', TAG_1, 0, { note: 'Joined the next trip instead.' }),
      ],
    });
    saveAssignmentStatuses(CID, { [SID + ':rubric']: 'LATE', [SID + ':missing']: 'NS', [SID + ':excused']: 'EXC' });
    setRubricCheck(CID, SID, 'advanced', 'k3a', true);
    saveQuickObs(CID, {
      [SID]: [
        comment('o2', 'points', 'Show the units.', '2026-10-04'),
        comment('o1', 'points', 'Check question 3.', '2026-10-02'),
        comment('o3', 'excused', 'Joined the next trip instead.', '2026-10-08'),
        comment('o4', 'dibels', 'Read with expression.', '2026-10-11'),
        {
          id: 'ob-late',
          text: 'Helped a partner fix the circuit.',
          dims: ['collaboration', 'tag:Kindness'],
          competencyId: TAG_1,
          created: '2026-10-12T18:00:00.000Z',
          date: '2026-10-12',
        },
        {
          id: 'ob-early',
          text: 'Asked why the leaf changed colour.',
          dims: [],
          created: '2026-09-15T18:00:00.000Z',
          date: '2026-09-15',
        },
        { id: 'ob-old', text: 'Last spring.', dims: [], created: '2026-03-01T18:00:00.000Z', date: '2026-03-01' },
      ],
    });
  }

  const FIELDS = [
    'students',
    'categories',
    'assessments',
    'scores',
    'rubrics',
    'rubricChecks',
    'statuses',
    'observations',
    'termRatings',
    'courseConfigs',
    'learningMaps',
  ];

  beforeEach(() => {
    localStorage.clear();
    FIELDS.forEach(f => {
      if (_cache[f]) delete _cache[f][CID];
    });
    if (typeof COURSES === 'undefined') globalThis.COURSES = {};
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
    seed();
    clearProfCache();
  });

  afterEach(() => {
    delete COURSES[CID];
    setActiveTerm(CID, null);
    clearProfCache();
  });

  function byId(items) {
    const out = {};
    items.forEach(i => (out[i.id] = i));
    return out;
  }

  describe('forStudent: which assessments get a card', () => {
    it('keeps work with a rubric or written feedback, oldest first', () => {
      expect(F.forStudent(CID, ST).map(i => i.id)).toEqual([
        'points',
        'done',
        'rubric',
        'tags',
        'excused',
        'single',
        'advanced',
      ]);
    });

    it('leaves out score-only work, Missing work with nothing written, unscored work and DIBELS', () => {
      const ids = F.forStudent(CID, ST).map(i => i.id);
      ['score-only', 'not-done', 'missing', 'unscored', 'dibels'].forEach(id => expect(ids).not.toContain(id));
    });

    it('runs newest first on request', () => {
      expect(F.forStudent(CID, ST, { order: 'newest' }).map(i => i.id)[0]).toBe('advanced');
    });

    it("keeps to the year to date as of the report's end", () => {
      saveCourseConfig(CID, {
        reportingTerms: [{ ordinal: 1, label: 'Term 1', starts_on: '2026-10-03', ends_on: '2026-10-06' }],
      });
      setActiveTerm(CID, 1);
      // Work dated before the term counts (the year to date); work after its end doesn't.
      expect(F.forStudent(CID, ST).map(i => i.id)).toEqual(['points', 'done', 'rubric', 'tags']);
    });
  });

  describe('forStudent: what a card carries', () => {
    it('points work: the score, out of, percent and the Overall Comment, a line per paragraph', () => {
      const item = byId(F.forStudent(CID, ST)).points;
      expect(item).toMatchObject({
        title: 'Energy Quiz',
        date: 'Oct 1',
        dateIso: '2026-10-01',
        category: 'Quizzes',
        kind: 'points',
        status: '',
        score: '16',
        outOf: '20',
        percent: '80%',
        rubric: null,
      });
      expect(item.feedback).toEqual([
        { text: 'Check question 3.', date: '', dateIso: '' },
        { text: 'Show the units.', date: '', dateIso: '' },
      ]);
      expect(item.grade.text).toBeTruthy();
      expect(item.grade.text).toBe(item.grade.word);
    });

    it('Complete/Incomplete work: the mark, and the score comment as feedback', () => {
      const item = byId(F.forStudent(CID, ST)).done;
      expect(item).toMatchObject({ kind: 'complete', mark: 'complete', grade: { text: 'Complete', word: '' } });
      expect(item.feedback).toEqual([{ text: 'Neat and on time.', date: '', dateIso: '' }]);
    });

    it('Incomplete work with a comment is kept, marked incomplete', () => {
      const scores = getScores(CID);
      scores[SID].find(e => e.assessmentId === 'not-done').note = 'Hand it in Monday.';
      saveScores(CID, scores);
      const item = byId(F.forStudent(CID, ST))['not-done'];
      expect(item).toMatchObject({ kind: 'complete', mark: 'incomplete', grade: { text: 'Incomplete' } });
    });

    it('a standard rubric: every row with its descriptors, level, ± and comment, Late status', () => {
      const item = byId(F.forStudent(CID, ST)).rubric;
      expect(item.kind).toBe('rubric');
      expect(item.status).toBe('Late');
      expect(item.feedback).toEqual([]);
      expect(item.rubric).toMatchObject({ name: 'Lab Rubric', style: 'standard', levelOrder: [4, 3, 2, 1] });
      expect(item.rubric.rows).toHaveLength(2);
      expect(item.rubric.rows[0]).toEqual({
        criterionId: CRIT_A,
        name: 'Inquiry',
        // A competency with no code shows its name (Print Rubrics' rule).
        codes: ['QAP', 'Planning'],
        levels: { 4: 'Four.', 3: 'Three.', 2: 'Two.', 1: 'One.' },
        level: 3,
        mod: 1,
        mixed: false,
        comment: 'Ask a sharper question.',
        beyond: '',
        checks: null,
      });
      expect(item.rubric.rows[1]).toMatchObject({ name: 'Communication', level: 2, mod: 0, comment: '' });
    });

    it('follows the class’s Rubric Levels order', () => {
      saveCourseConfig(CID, { levelOrder: 'asc' });
      expect(byId(F.forStudent(CID, ST)).rubric.rubric.levelOrder).toEqual([1, 2, 3, 4]);
    });

    it('a single-point rubric: Work On is the comment, Went Beyond its own field', () => {
      const item = byId(F.forStudent(CID, ST)).single;
      expect(item.rubric.style).toBe('single_point');
      expect(item.rubric.rows[0]).toMatchObject({
        name: 'Delivery',
        level: 3,
        comment: 'Slow down.',
        beyond: 'Used a prop.',
        checks: null,
      });
      expect(item.rubric.rows[0].levels[3]).toBe('Speaks clearly.');
    });

    it('an Advanced Rubric: every checkbox at every level, ticked and unticked, in display order', () => {
      const item = byId(F.forStudent(CID, ST)).advanced;
      expect(item.rubric.style).toBe('advanced');
      expect(item.rubric.rows[0].checks).toEqual({
        4: [{ id: 'k4', label: 'Tests two designs', ticked: false }],
        3: [
          { id: 'k3a', label: 'Draws a plan', ticked: true },
          { id: 'k3b', label: 'Labels parts', ticked: false },
        ],
        2: [{ id: 'k2', label: 'Builds a model', ticked: false }],
        1: [],
      });
    });

    it('a Tag Rubric: a row per competency with the general wording and the competency comment', () => {
      const item = byId(F.forStudent(CID, ST)).tags;
      expect(item.kind).toBe('tags');
      expect(item.rubric.name).toBe('Competency Rubric');
      expect(item.rubric.rows.map(r => r.name)).toEqual(['Questioning', 'Planning']);
      expect(item.rubric.rows[0]).toMatchObject({ level: 3, comment: '', checks: null });
      expect(item.rubric.rows[0].levels[3]).toBe(RubricPrint.GENERAL_LEVELS[3]);
      expect(item.rubric.rows[1]).toMatchObject({ level: 0, comment: 'Plan before you start.' });
      expect(item.grade).toEqual({ text: 'Proficient', word: 'Proficient', letter: '' });
    });

    it('a Tag Rubric with nothing written stays on the grade sheet; one of the teacher’s own always prints', () => {
      const scores = getScores(CID);
      scores[SID] = scores[SID].map(e => (e.assessmentId === 'tags' ? Object.assign({}, e, { critNote: '' }) : e));
      saveScores(CID, scores);
      clearProfCache();
      const items = byId(F.forStudent(CID, ST));
      expect(items.tags).toBeUndefined();
      expect(items.rubric).toBeDefined();
    });

    it('a General Rubric: one Overall row for work with no competencies', () => {
      saveAssessments(
        CID,
        WORK.concat([{ id: 'general', title: 'Reading Check', date: '2026-10-04', categoryId: 'c1', tagIds: [] }]),
      );
      const scores = getScores(CID);
      scores[SID].push(entry('general', UNLINKED_TAG_ID, 4));
      saveScores(CID, scores);
      clearProfCache();
      // Scored with nothing written: the grade sheet has it; no card.
      expect(byId(F.forStudent(CID, ST)).general).toBeUndefined();
      scores[SID] = scores[SID].map(e =>
        e.assessmentId === 'general' ? Object.assign({}, e, { note: 'Read with expression.' }) : e,
      );
      saveScores(CID, scores);
      clearProfCache();
      const item = byId(F.forStudent(CID, ST)).general;
      expect(item.kind).toBe('general');
      expect(item.feedback.map(f => f.text)).toEqual(['Read with expression.']);
      expect(item.rubric.rows.map(r => r.name)).toEqual(['Overall']);
      expect(item.grade.text).toBe('Extending');
    });

    it('Excused work with a comment: the status, no grade', () => {
      const item = byId(F.forStudent(CID, ST)).excused;
      expect(item).toMatchObject({ status: 'Excused', grade: null });
      expect(item.feedback.map(f => f.text)).toEqual(['Joined the next trip instead.']);
    });
  });

  describe('forStudent: the grade follows the class setting', () => {
    it('Proficiency: the proficiency word', () => {
      const items = byId(F.forStudent(CID, ST));
      expect(items.tags.grade.text).toBe('Proficient');
      expect(items.rubric.grade.word).toBeTruthy();
    });

    it('Letter: the letter and percent, no proficiency word', () => {
      COURSES[CID].gradingSystem = 'letter';
      clearProfCache();
      const items = byId(F.forStudent(CID, ST));
      expect(items.points.grade).toEqual({ text: 'B 80%', word: '', letter: 'B 80%' });
      expect(items.tags.grade).toEqual({ text: 'B 75%', word: '', letter: 'B 75%' });
      // Rubric columns keep their proficiency names in any class.
      expect(items.rubric.rubric.levelOrder).toEqual([4, 3, 2, 1]);
    });

    it('Both: the word and the letter', () => {
      COURSES[CID].gradingSystem = 'both';
      clearProfCache();
      expect(byId(F.forStudent(CID, ST)).tags.grade).toEqual({
        text: 'Proficient · B 75%',
        word: 'Proficient',
        letter: 'B 75%',
      });
    });
  });

  describe('observations', () => {
    it('lists the student’s observations, oldest first, with their tags, and leaves assignment comments to their card', () => {
      expect(F.observations(CID, ST)).toEqual([
        { id: 'ob-old', date: 'Mar 1', dateIso: '2026-03-01', text: 'Last spring.', tags: [] },
        {
          id: 'ob-early',
          date: 'Sep 15',
          dateIso: '2026-09-15',
          text: 'Asked why the leaf changed colour.',
          tags: [],
        },
        {
          id: 'ob-late',
          date: 'Oct 12',
          dateIso: '2026-10-12',
          text: 'Helped a partner fix the circuit.',
          tags: ['Questioning', resolveTag('collaboration').label, 'Kindness'],
        },
      ]);
    });

    it('leaves out Concern and Note observations: they are private and never go home', () => {
      const all = getQuickObs(CID);
      saveQuickObs(CID, {
        [SID]: all[SID].concat([
          {
            id: 'ob-concern',
            text: 'Meeting with parents.',
            sentiment: 'concern',
            date: '2026-10-05',
            created: '2026-10-05T18:00:00.000Z',
          },
          {
            id: 'ob-note',
            text: 'Away on vacation.',
            sentiment: 'note',
            date: '2026-10-06',
            created: '2026-10-06T18:00:00.000Z',
          },
          {
            id: 'ob-str',
            text: 'Led the group.',
            sentiment: 'strength',
            date: '2026-10-07',
            created: '2026-10-07T18:00:00.000Z',
          },
          {
            id: 'ob-gr',
            text: 'Check units.',
            sentiment: 'growth',
            date: '2026-10-08',
            created: '2026-10-08T18:00:00.000Z',
          },
        ]),
      });
      const ids = F.observations(CID, ST).map(o => o.id);
      expect(ids).toEqual(['ob-old', 'ob-early', 'ob-str', 'ob-gr', 'ob-late']);
    });

    it('linked observations never print as the feedback on the work', () => {
      const all = getQuickObs(CID);
      const priv = comment('o-priv', 'points', 'Parents meeting about this.', '2026-10-09');
      priv.sentiment = 'concern';
      saveQuickObs(CID, { [SID]: all[SID].concat([comment('o-log', 'points', 'From the log.', '2026-10-09'), priv]) });
      expect(RubricPrint.feedbackItems(CID, SID, 'points').map(f => f.text)).toEqual([
        'Check question 3.',
        'Show the units.',
      ]);
    });

    it('prints the Overall Comment alone once the work has one, a line per paragraph', () => {
      const scores = getScores(CID);
      scores[SID] = scores[SID].map(e =>
        e.assessmentId === 'points' ? Object.assign({}, e, { note: 'Great effort.\nShow the units.' }) : e,
      );
      saveScores(CID, scores);
      expect(RubricPrint.feedbackItems(CID, SID, 'points')).toEqual([
        { text: 'Great effort.', date: '' },
        { text: 'Show the units.', date: '' },
      ]);
      expect(byId(F.forStudent(CID, ST)).points.feedback.map(f => f.text)).toEqual([
        'Great effort.',
        'Show the units.',
      ]);
    });

    it('prints nothing for work with no Overall Comment, whatever observations it has', () => {
      const scores = getScores(CID);
      scores[SID] = scores[SID].map(e => (e.assessmentId === 'points' ? Object.assign({}, e, { note: '' }) : e));
      saveScores(CID, scores);
      expect(RubricPrint.feedbackItems(CID, SID, 'points')).toEqual([]);
    });

    it('keeps to the report’s term', () => {
      saveCourseConfig(CID, {
        reportingTerms: [
          { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-30' },
          { ordinal: 2, label: 'Term 2', starts_on: '2026-12-01', ends_on: '2027-03-15' },
        ],
      });
      expect(F.observations(CID, ST, 'term-1').map(o => o.id)).toEqual(['ob-early', 'ob-late']);
      expect(F.observations(CID, ST, 'term-2')).toEqual([]);
      // No such report term: the term in view, else all time.
      setActiveTerm(CID, 1);
      expect(F.observations(CID, ST, 'term-9').map(o => o.id)).toEqual(['ob-early', 'ob-late']);
    });
  });

  describe('termComment', () => {
    it('reads the Term Questionnaire comment as plain text, a paragraph per line', () => {
      saveTermRatings(CID, { [SID]: { 'term-1': { narrative: 'Ada works hard.\n\nShe asks good questions.' } } });
      expect(F.termComment(CID, ST, 'term-1')).toBe('Ada works hard.\nShe asks good questions.');
      expect(F.termComment(CID, ST, 'term-2')).toBe('');
    });

    it('turns a comment from the old editor’s HTML into plain text', () => {
      saveTermRatings(CID, {
        [SID]: { 'term-1': { narrative: '<p>Ada &amp; Alan <b>built</b> it.</p><p>Next: test it.</p>' } },
      });
      expect(F.termComment(CID, ST, 'term-1')).toBe('Ada & Alan built it.\nNext: test it.');
    });
  });
});

describe('report-generation', () => {
  /**
   * Report-specific data-layer tests — shared/data.js
   *
   * Pins the two contracts the report generator uniquely depends on:
   * saveReportConfig/getReportConfig shape, and the reportAsPercentage
   * course-config toggle. Proficiency/trend functions are covered in
   * calc-integration.test.js and calc-advanced.test.js.
   */

  const CID = 'rpttest';

  beforeEach(() => {
    localStorage.clear();
    _cache.reportConfig[CID] = undefined;
    _cache.courseConfigs[CID] = undefined;
  });

  describe('report config persistence', () => {
    it('saveReportConfig stores and getReportConfig retrieves blocks + preset', () => {
      const config = {
        preset: 'standard',
        blocks: [
          { id: 'header', label: 'Header', enabled: true, locked: true },
          { id: 'academic-summary', label: 'Academic Summary', enabled: true, locked: false },
        ],
      };
      saveReportConfig(CID, config);
      const loaded = getReportConfig(CID);
      expect(loaded.preset).toBe('standard');
      expect(loaded.blocks).toHaveLength(2);
      expect(loaded.blocks[0].id).toBe('header');
    });

    it('getReportConfig returns null for an unconfigured course', () => {
      expect(getReportConfig(CID)).toBeNull();
    });
  });

  describe('course config reportAsPercentage toggle', () => {
    it('roundtrips the reportAsPercentage flag alongside calcMethod', () => {
      saveCourseConfig(CID, { reportAsPercentage: true, calcMethod: 'mostRecent' });
      const cc = getCourseConfig(CID);
      expect(cc.reportAsPercentage).toBe(true);
      expect(cc.calcMethod).toBe('mostRecent');
    });
  });
});

describe('report-grades-competency-range', () => {
  /**
   * Assignment Grades by Competency follows its own Range (Nov 3 bug sweep,
   * reports group 2). On Report 2 the Reports page makes Term 2 the active
   * term, and the competency view read its marks from getTagScores, which
   * keeps only that term's work. Year to Date then printed only Term 2's
   * pieces under a "Year to date" heading, and Last 10 lost Term 1's pieces
   * too, while By Date printed the whole year. The marks are now read all
   * time for those ranges, and the term is put back.
   */

  const CID = 'report-grades-range';
  const SID = 'stu-1';
  const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan' };
  const TERMS = [
    { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-10-15' },
    { ordinal: 2, label: 'Term 2', starts_on: '2026-10-16', ends_on: '2027-01-29' },
  ];
  const work = (id, date) => ({ id, title: 'Work ' + id, date, tagIds: ['t1'] });
  const sc = (assessmentId, score) => ({ assessmentId, tagId: 't1', score, date: '2026-10-20' });

  function seed() {
    COURSES[CID] = { id: CID, name: 'Socials 10', gradingSystem: 'proficiency' };
    _cache.students[CID] = [STUDENT];
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [{ id: 'sec-1', name: 'Inquiry', tags: [{ id: 't1', label: 'Inquiry' }] }],
      competencyGroups: [],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = [
      work('A', '2026-09-10'),
      work('B', '2026-10-01'),
      work('C', '2026-10-17'),
      work('D', '2026-10-18'),
    ];
    _cache.scores[CID] = { [SID]: [sc('A', 2), sc('B', 3), sc('C', 3), sc('D', 4)] };
    _cache.statuses[CID] = {};
    _cache.rubrics[CID] = [];
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = { calcMethod: 'average', reportingTerms: TERMS };
    clearProfCache();
  }
  const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const grades = range =>
    text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { organize: 'competency', range, per: 8 }));

  describe('Assignment Grades by Competency on Report 2', () => {
    afterEach(() => {
      setActiveTerm(CID, null);
      delete COURSES[CID];
    });

    it('prints Term 1 work for Year to Date and Last 10, and only Term 2 for This Term', () => {
      seed();
      setActiveTerm(CID, 2);
      ['all', 'last10'].forEach(range => {
        const out = grades(range);
        ['Work A', 'Work B', 'Work C', 'Work D'].forEach(t => expect(out).toContain(t));
        expect(out).toContain('Work A 2.0 / 4');
      });
      const term = grades('term');
      expect(term).toContain('Work C');
      expect(term).not.toContain('Work A');
      // The report's term is put back.
      expect(getActiveTerm(CID).ordinal).toBe(2);
    });
  });
});

describe('report-grades-last10-future', () => {
  /**
   * Assignment Grades on Last 10 leaves out work not yet due (Nov 3 bug
   * sweep, reports group 3). Last 10 took the ten newest assessments with no
   * date filter, so three December pieces made ahead of time printed at the
   * top as dashes and pushed three graded October pieces off. Side by Side
   * always uses Last 10. Year to Date and the Quick Report already left work
   * dated after today out; Last 10 now does too, and so does This Term
   * (Colin, 2026-11-03).
   */

  const CID = 'report-grades-last10';
  const SID = 'stu-1';
  const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan' };
  const pad = n => String(n).padStart(2, '0');

  function seed() {
    const october = Array.from({ length: 12 }, (_, i) => ({
      id: 'oct' + (i + 1),
      title: 'October ' + pad(i + 1),
      date: '2026-10-' + pad(i + 1),
      tagIds: ['t1'],
    }));
    const december = [1, 5, 10].map(d => ({
      id: 'dec' + d,
      title: 'December ' + pad(d),
      date: '2026-12-' + pad(d),
      tagIds: ['t1'],
    }));
    COURSES[CID] = { id: CID, name: 'Socials 10', gradingSystem: 'proficiency' };
    _cache.students[CID] = [STUDENT];
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [{ id: 'sec-1', name: 'Inquiry', tags: [{ id: 't1', label: 'Inquiry' }] }],
      competencyGroups: [],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = october.concat(december);
    _cache.scores[CID] = { [SID]: october.map(a => ({ assessmentId: a.id, tagId: 't1', score: 3, date: a.date })) };
    _cache.statuses[CID] = {};
    _cache.rubrics[CID] = [];
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = { calcMethod: 'average' };
    clearProfCache();
  }
  const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  describe('Assignment Grades on Last 10', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-03T19:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
      delete COURSES[CID];
    });

    it('lists the ten newest pieces dated up to today, at either size', () => {
      seed();
      [{ range: 'last10' }, { size: 'half' }].forEach(options => {
        const out = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, options));
        expect(out).not.toContain('December');
        for (let d = 3; d <= 12; d++) expect(out).toContain('October ' + pad(d));
        expect(out).not.toContain('October 02');
      });
    });

    it('This Term leaves out work dated after today too', () => {
      seed();
      _cache.courseConfigs[CID].reportingTerms = [
        { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-12-20' },
      ];
      setActiveTerm(CID, 1);
      try {
        const out = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { range: 'term' }));
        expect(out).toContain('This term');
        expect(out).not.toContain('December');
        for (let d = 1; d <= 12; d++) expect(out).toContain('October ' + pad(d));
      } finally {
        setActiveTerm(CID, null);
      }
    });
  });
});

describe('report-growth-arrow', () => {
  /**
   * Growth Since Last Report: the arrow follows the figures beside it
   * (2026-11-01 math audit). It compared whole levels, so in a Letter class a
   * competency going from 67% to 83% (3− to 3+) showed "Same" beside the two
   * percents. A Proficiency class shows the word, so there it still compares
   * whole levels.
   */

  const CID = 'report-growth';
  const SID = 'stu-1';
  const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan' };
  const TERMS = [
    { ordinal: 1, label: 'Report 1', starts_on: '2026-09-01', ends_on: '2026-09-30' },
    { ordinal: 2, label: 'Report 2', starts_on: '2026-10-01', ends_on: '2026-10-31' },
  ];

  function seed(gradingSystem) {
    COURSES[CID] = { id: CID, name: 'History 12', gradingSystem, gradeLevel: '12' };
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [{ id: 'sec', name: 'Inquiry', tags: [{ id: 't1', label: 'Inquiry' }] }],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = [
      { id: 'a1', title: 'Essay 1', date: '2026-09-15', tagIds: ['t1'] },
      { id: 'a2', title: 'Essay 2', date: '2026-10-15', tagIds: ['t1'] },
    ];
    _cache.scores[CID] = {
      [SID]: [
        { assessmentId: 'a1', tagId: 't1', score: 3, mod: -1, date: '2026-09-15' },
        { assessmentId: 'a2', tagId: 't1', score: 3, mod: 1, date: '2026-10-15' },
      ],
    };
    _cache.statuses[CID] = {};
    _cache.rubrics[CID] = [];
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = { calcMethod: 'average', reportingTerms: TERMS };
    setActiveTerm(CID, 2);
    clearProfCache();
  }
  const arrowOf = html => (html.match(/aria-label="(Up|Down|Same)"/) || [])[1];

  describe('Growth Since Last Report arrow', () => {
    afterEach(() => {
      setActiveTerm(CID, null);
      delete COURSES[CID];
    });

    it('is up in a Letter class when the % beside it rises', () => {
      seed('letter');
      const html = ReportBlocks.renderBlockGrowth(CID, STUDENT);
      // Report 1: the 3− alone (67%). Report 2: the year to date, the 3− and
      // the 3+ (Mean 3.0, 75%; Colin, 2026-11-03).
      expect(html).toContain('67%');
      expect(html).toContain('75%');
      expect(arrowOf(html)).toBe('Up');
    });

    it('is the same in a Proficiency class while the word is the same', () => {
      seed('proficiency');
      expect(arrowOf(ReportBlocks.renderBlockGrowth(CID, STUDENT))).toBe('Same');
    });
  });
});

describe('report-issues', () => {
  /**
   * ReportIssues: the pure parts (hash, the index, "changed since") and that
   * issuing still records the index when IndexedDB is not there.
   */

  const CID = 'course-issues';

  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  describe('ReportIssues', () => {
    it('hashes stably and differently', () => {
      expect(ReportIssues.hash('<div>a</div>')).toBe(ReportIssues.hash('<div>a</div>'));
      expect(ReportIssues.hash('<div>a</div>')).not.toBe(ReportIssues.hash('<div>b</div>'));
    });

    it('issues into the index without IndexedDB and lists newest first', async () => {
      const one = await ReportIssues.issue({
        cid: CID,
        termId: 'term-1',
        termLabel: 'Nov Report Card',
        paper: 'letter',
        students: [{ sid: 's1', name: 'A', sheets: 1, html: '<p>a</p>' }],
      });
      expect(one.stored).toBe(false);
      expect(one.entry.count).toBe(1);
      expect(one.entry.hashes.s1).toBe(ReportIssues.hash('<p>a</p>'));
      const two = await ReportIssues.issue({
        cid: CID,
        termId: 'term-1',
        termLabel: 'Nov Report Card',
        paper: 'letter',
        students: [{ sid: 's1', name: 'A', sheets: 1, html: '<p>b</p>' }],
      });
      expect(ReportIssues.list(CID, 'term-1').map(e => e.id)).toEqual([two.entry.id, one.entry.id]);
      expect(ReportIssues.list(CID, 'term-2')).toEqual([]);
      expect(ReportIssues.latest(CID, 'term-1').id).toBe(two.entry.id);
    });

    it('changedSince names the students whose sheets differ or who are new', async () => {
      const res = await ReportIssues.issue({
        cid: CID,
        termId: 'term-1',
        termLabel: 'Nov Report Card',
        paper: 'letter',
        students: [
          { sid: 's1', name: 'A', sheets: 1, html: '<p>a</p>' },
          { sid: 's2', name: 'B', sheets: 1, html: '<p>b</p>' },
        ],
      });
      const now = {
        s1: ReportIssues.hash('<p>a</p>'),
        s2: ReportIssues.hash('<p>b2</p>'),
        s3: ReportIssues.hash('<p>c</p>'),
      };
      expect(ReportIssues.changedSince(res.entry, now)).toEqual(['s2', 's3']);
      expect(ReportIssues.changedSince(null, now)).toEqual(['s1', 's2', 's3']);
    });

    it('a report printed another day is not changed: the Missing Work "As of" date is left out of the hash', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const MW = 'course-issues-asof';
      const st = { id: 's1', firstName: 'Noor', lastName: 'Khan' };
      COURSES[MW] = { id: MW, name: 'Socials 9', gradingSystem: 'proficiency' };
      _cache.students[MW] = [st];
      _cache.assessments[MW] = [];
      _cache.scores[MW] = {};
      _cache.statuses[MW] = {};
      const on = (day, options) => {
        vi.setSystemTime(new Date(day + 'T19:00:00Z'));
        return ReportBlocks.renderReportBlock('missing-work', MW, st, {}, options);
      };
      ['row', 'half'].forEach(size => {
        const nov20 = on('2026-11-20', { size });
        const nov21 = on('2026-11-21', { size });
        expect(nov20).toContain('As of Nov 20, 2026');
        expect(nov21).toContain('As of Nov 21, 2026');
        expect(ReportIssues.hash(nov21)).toBe(ReportIssues.hash(nov20));
      });
      // Anything else in the report still counts.
      expect(ReportIssues.hash(on('2026-11-21', {}) + '<p>a</p>')).not.toBe(ReportIssues.hash(on('2026-11-20', {})));
      delete COURSES[MW];
    });

    it('after a partial print each student is compared with their own last printed copy', async () => {
      const s = (sid, html) => ({ sid, name: sid, sheets: 1, html });
      const issue = students =>
        ReportIssues.issue({ cid: CID, termId: 'term-1', termLabel: 'Nov Report Card', paper: 'letter', students });
      await issue([s('s1', '<p>a</p>'), s('s2', '<p>b</p>'), s('s3', '<p>c</p>')]);
      // s2 changed and was printed alone ("Changed since the last print").
      await issue([s('s2', '<p>b2</p>')]);
      const printed = ReportIssues.printedHashes(CID, 'term-1');
      const now = h => ReportIssues.hash(h);
      expect(
        ReportIssues.changedSince(
          { hashes: printed },
          { s1: now('<p>a</p>'), s2: now('<p>b2</p>'), s3: now('<p>c</p>') },
        ),
      ).toEqual([]);
      expect(
        ReportIssues.changedSince(
          { hashes: printed },
          { s1: now('<p>a2</p>'), s2: now('<p>b</p>'), s3: now('<p>c</p>'), s4: now('<p>d</p>') },
        ),
      ).toEqual(['s1', 's2', 's4']);
      // Another term's copies are not used.
      expect(ReportIssues.printedHashes(CID, 'term-2')).toEqual({});
    });

    it('labels an issue by when it went home', () => {
      expect(ReportIssues.label({ issuedAt: '2026-10-20T22:40:00.000Z' }, '2026-11-01')).toMatch(/^Printed Oct 20, \d/);
      expect(ReportIssues.label({ issuedAt: '2026-10-20T22:40:00.000Z' }, '2027-02-01')).toMatch(
        /^Printed Oct 20, 2026/,
      );
    });
  });
});

describe('report-note-glance', () => {
  /**
   * At a Glance and the Note for the Report (Generate plan, PR 7): when the
   * best piece has no note, "Add a note for the report ›", which opens the
   * grader on that piece for the student on screen, as Open in Grader and
   * each piece's title do. Demo Mode (Science 8, Report 2).
   */

  const RQ = ReportQuestionnaire;

  describe('At a Glance: the note for the report', () => {
    let cid, saved, hadDoc, oldDoc, oldPA;
    beforeAll(() => {
      saved = window.isDemoMode;
      window.isDemoMode = () => true;
      localStorage.clear();
      runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
      seedIfNeeded();
      cid = 'sci8';
      setActiveTerm(cid, 2);
      hadDoc = 'document' in globalThis;
      oldDoc = globalThis.document;
      globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
      RQ.configure({ activeCourse: cid, renderReports: () => {} });
      oldPA = window.PageAssignments;
    });
    afterAll(() => {
      if (hadDoc) globalThis.document = oldDoc;
      else delete globalThis.document;
      window.PageAssignments = oldPA;
      setActiveTerm(cid, null);
      window.isDemoMode = saved;
      localStorage.clear();
    });
    const cece = () => getStudents(cid).find(s => s.firstName === 'Cece');
    const show = st => {
      RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === st.id);
      return RQ.renderTermQuestionnaire(cid);
    };

    it('asks for a note on the best piece when it has none', () => {
      const st = cece();
      const best = RQ.bestPiece(CommentBank.facts(cid, st, 'term-2'));
      const html = show(st);
      expect(html).toContain('data-action="tqAddReportNote" data-aid="' + best.id + '"');
      expect(html).toContain('>Add a note for the report ›</button>');
    });

    it('shows the note under the best piece once it has one', () => {
      const st = cece();
      const best = RQ.bestPiece(CommentBank.facts(cid, st, 'term-2'));
      saveScoreReportNote(cid, st.id, best.id, 'kept a field journal with dated sketches');
      try {
        const html = show(st);
        expect(html).not.toContain('Add a note for the report');
        expect(html).toContain('Note for the report: “kept a field journal with dated sketches”');
      } finally {
        saveScoreReportNote(cid, st.id, best.id, '');
      }
    });

    it('Add a note and Open in Grader open the grader on that piece for this student only', () => {
      const st = cece();
      show(st);
      const calls = [];
      window.PageAssignments = { openGrader: (...args) => calls.push(args), graderOpen: () => false };
      RQ.tqAddReportNote('assess-x');
      RQ.tqOpenGrader('assess-y');
      expect(calls).toHaveLength(2);
      expect(calls[1].slice(0, 3)).toEqual([cid, 'assess-y', st.id]);
      expect(calls[0].slice(0, 3)).toEqual([cid, 'assess-x', st.id]);
      expect(calls[0][3].studentIds).toEqual([st.id]);
      expect(typeof calls[0][3].onClose).toBe('function');
    });

    it('leaves the keys to the grader while it is open', () => {
      const st = cece();
      show(st);
      const at = RQ.tqStudentIndex;
      window.PageAssignments = { openGrader() {}, graderOpen: () => true };
      const e = { key: 'ArrowDown', target: { closest: () => null }, preventDefault() {} };
      RQ.handleKey(e);
      expect(RQ.tqStudentIndex).toBe(at);
    });

    it('is wired to the reports page', () => {
      const src = readFileSync('teacher/page-reports.js', 'utf-8');
      expect(src).toContain('RQ.tqAddReportNote(el.dataset.aid)');
      expect(src).toContain('RQ.tqOpenGrader(el.dataset.aid)');
      expect(src).toContain('RQ.tqGlanceToggle(el.dataset.row)');
    });
  });
});

describe('report-paper-named', () => {
  /**
   * Report sheets name the paper ("legal portrait") rather than giving inches,
   * so the print dialog picks the Legal tray instead of shrinking the sheet
   * onto Letter, as the class grade sheet already does (DECISIONS "Printed
   * class grade sheet" 11; step 4 group 2 #7).
   */

  describe('report sheet @page size', () => {
    it('names Letter and Legal with portrait', () => {
      expect(ReportSheets.paperSize('letter')).toBe('letter portrait');
      expect(ReportSheets.paperSize('legal')).toBe('legal portrait');
      expect(ReportSheets.paperSize('nonsense')).toBe('letter portrait');
    });

    it('no report print rule gives the paper in inches', () => {
      ['teacher/report-sheets.js', 'teacher/page-reports.js'].forEach(f => {
        const src = readFileSync(f, 'utf8');
        expect(src).not.toMatch(/8\.5in 1[14]in/);
      });
    });
  });
});

describe('report-points-evidence', () => {
  /**
   * Report blocks that list evidence by level read points work as its level
   * on the grading scale. They used the raw points (18 of 20 as level 18),
   * which has no label, so the report showed a "?" glyph.
   */

  const CID = 'course-report-points';
  const SID = 'stu-1';
  const TAG = 'tag-inquiry';
  const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan' };

  const points = (id, title, max) => ({
    id,
    title,
    scoreMode: 'points',
    maxPoints: max,
    tagIds: [TAG],
    type: 'summative',
  });
  const level = (id, title) => ({ id, title, scoreMode: 'proficiency', tagIds: [TAG], type: 'summative' });
  const score = (assessmentId, value, extra) => ({
    assessmentId,
    tagId: TAG,
    score: value,
    date: '2026-10-10',
    ...extra,
  });

  function seed({ assessments, scores, statuses = {} }) {
    COURSES[CID] = { id: CID, name: 'Socials 9', gradingSystem: 'proficiency' };
    _cache.students[CID] = [STUDENT];
    _cache.learningMaps[CID] = {
      sections: [{ id: 'sec-1', name: 'Inquiry', color: '#336699', tags: [{ id: TAG, label: 'Inquiry' }] }],
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = assessments;
    _cache.scores[CID] = { [SID]: scores };
    _cache.statuses[CID] = statuses;
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = {};
    clearProfCache();
  }

  describe('report evidence for points work', () => {
    beforeEach(() => localStorage.clear());

    it('labels points evidence by its level in Learning Outcomes', () => {
      seed({ assessments: [points('a', 'Essay', 20)], scores: [score('a', 18)] });
      const html = ReportBlocks.renderBlockSectionOutcomes(CID, STUDENT);
      expect(html).toContain('Essay');
      expect(html).toContain('[E]');
      expect(html).not.toContain('[?]');
    });

    it('labels points evidence by its level in the Section Proficiency Breakdown', () => {
      seed({
        assessments: [points('a', 'Essay', 20), points('b', 'Quiz', 10)],
        scores: [score('a', 18), score('b', 6)],
      });
      const html = ReportBlocks.renderBlockSectionChart(CID, STUDENT);
      expect(html).toContain('Essay');
      expect(html).not.toMatch(/>\?</);
      // 18/20 = 90% is Extending, 6/10 = 60% is Developing.
      expect(html).toMatch(/>E<\/span>\s*<span[^>]*>Essay/);
      expect(html).toMatch(/>D<\/span>\s*<span[^>]*>Quiz/);
    });

    it('counts points work by level in the Score Distribution', () => {
      seed({
        assessments: [points('a', 'Essay', 20), level('b', 'Seminar')],
        scores: [score('a', 18), score('b', 3, { mod: 1 })],
      });
      const html = ReportBlocks.renderBlockScoreDistribution(CID, STUDENT);
      expect(html).not.toMatch(/>\?</);
      expect(html).toContain('Top Assignments');
      expect(html).toMatch(/>E<\/span>\s*<span[^>]*>Essay/);
      expect(html).toMatch(/>P<\/span>\s*<span[^>]*>Seminar/);
    });

    it('leaves excused work out of the evidence', () => {
      seed({
        assessments: [points('a', 'Essay', 20), points('b', 'Quiz', 10)],
        scores: [score('a', 18), score('b', 6)],
        statuses: { [SID + ':b']: 'EXC' },
      });
      const html = ReportBlocks.renderBlockSectionOutcomes(CID, STUDENT);
      expect(html).toContain('Essay');
      expect(html).not.toContain('Quiz');
    });
  });
});

describe('report-points-own-percent', () => {
  /**
   * Points work's mark on the report blocks (Nov 3 bug sweep, reports group
   * 2). In a Letter or Both class a 17/20 quiz tagged to a competency printed
   * the % its level counts as (Proficient, 75%) in Assignment Grades by
   * Competency, the Proficiency block's Best and Lowest work, Progress in One
   * Area, Next Steps' Latest line and Ways to Support at Home, while By Date
   * printed 17/20 · 85%. Each now prints the piece's own % from calc.js, as
   * Generate does (#565).
   */

  const CID = 'report-own-pct';
  const SID = 'stu-1';
  const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan' };

  function seed(mode, assessments, scores) {
    COURSES[CID] = { id: CID, name: 'Socials 10', gradingSystem: mode };
    _cache.students[CID] = [STUDENT];
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [
        { id: 'sec-1', name: 'Inquiry', tags: [{ id: 't1', label: 'Inquiry', i_can_statements: ['I can ask'] }] },
      ],
      competencyGroups: [],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = assessments;
    _cache.scores[CID] = { [SID]: scores };
    _cache.statuses[CID] = {};
    _cache.rubrics[CID] = [];
    _cache.overrides[CID] = {};
    _cache.observations[CID] = {};
    _cache.reflections[CID] = {};
    _cache.termRatings[CID] = {};
    _cache.courseConfigs[CID] = { calcMethod: 'average' };
    clearProfCache();
  }
  const quiz = (id, date) => ({ id, title: 'Quiz ' + id, date, tagIds: ['t1'], scoreMode: 'points', maxPoints: 20 });
  const sc = (assessmentId, score) => ({ assessmentId, tagId: 't1', score, date: '2026-10-10' });
  const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  describe('points work prints its own % on the report blocks', () => {
    afterEach(() => delete COURSES[CID]);

    it('prints 17/20 as 85% on every block in a Letter class', () => {
      seed('letter', [quiz('A', '2026-10-01')], [sc('A', 17)]);
      const a = getAssessments(CID)[0];
      expect(getAssessmentGroupPercentage(CID, SID, [a]).pct).toBeCloseTo(85, 9);
      // Its level (Proficient on Points to Proficiency) counts as 75%.
      expect(formatLevelAs(CID, getTagScores(CID, SID, 't1')[0].score, 'percent')).toBe('75%');

      const byComp = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { organize: 'competency' }));
      const byDate = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { organize: 'date' }));
      expect(byDate).toContain('17/20 · 85%');
      expect(byComp).toContain('85%');
      expect(byComp).not.toContain('75%');

      const prof = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
      expect(prof).toContain('Best work: Quiz A (Oct 1), 85%.');
      const prog = text(ReportBlocks.renderBlockProgress(CID, STUDENT, {}, {}));
      expect(prog).toContain('Best Quiz A, Oct 1 · 85%');
      expect(prog).toContain('Latest Quiz A, Oct 1 · 85%');
      expect(prog).toContain('Oct 1 Quiz A 85%');
      // Start of term and Now are the competency's level, not the piece's.
      expect(prog).toContain('Now 75%');
      const steps = text(ReportBlocks.renderBlockNextSteps(CID, STUDENT, {}, {}));
      expect(steps).toContain('Latest: Quiz A, Oct 1 · 85%');
      const home = text(ReportBlocks.renderBlockSupportHome(CID, STUDENT, {}, {}));
      expect(home).toContain('Ask to see Quiz A, Oct 1 · 85%');
    });

    it('prints its own % beside the level in a Both class', () => {
      seed('both', [quiz('A', '2026-10-01')], [sc('A', 17)]);
      const byComp = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { organize: 'competency' }));
      expect(byComp).toContain('3.0 / 4 · 85%');
      const steps = text(ReportBlocks.renderBlockNextSteps(CID, STUDENT, {}, {}));
      expect(steps).toContain('Latest: Quiz A, Oct 1 · 3.0 / 4 · 85% Proficient');
    });

    it('names only the pieces at the % it prints when two share a level', () => {
      // 16/20 and 17/20 are both Proficient; the higher % is the best work.
      seed('letter', [quiz('A', '2026-10-01'), quiz('B', '2026-10-05')], [sc('A', 16), sc('B', 17)]);
      const prof = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
      expect(prof).toContain('Best work: Quiz B (Oct 5), 85%.');
      const prog = text(ReportBlocks.renderBlockProgress(CID, STUDENT, {}, {}));
      expect(prog).toContain('Best Quiz B, Oct 5 · 85%');
      expect(prog).not.toContain('Quiz A, Oct 1 · Quiz B');
    });

    it('ranks a 17/20 (85%) above a 3+ (83%) by the % it prints', () => {
      const lab = { id: 'L', title: 'Lab', date: '2026-10-05', tagIds: ['t1'] };
      const pieces = [quiz('Q', '2026-10-01'), lab];
      const scores = [sc('Q', 17), { ...sc('L', 3), mod: 1 }];
      seed('letter', pieces, scores);
      const home = text(ReportBlocks.renderBlockSupportHome(CID, STUDENT, {}, {}));
      expect(home).toContain('Ask to see Quiz Q, Oct 1 · 85%');
      expect(home).toContain('Ask about Lab, Oct 5 · 83%');
      const prog = text(ReportBlocks.renderBlockProgress(CID, STUDENT, {}, {}));
      expect(prog).toContain('Best Quiz Q, Oct 1 · 85%');
      const prof = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
      expect(prof).toContain('Best work: Quiz Q (Oct 1), 85%.');
      // A Both class prints the % too, so it ranks the same way.
      seed('both', pieces, scores);
      expect(text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}))).toContain(
        'Best work: Quiz Q (Oct 1), 17/20 · 85%.',
      );
      // A Proficiency class ranks by level: the 3+ is the best work.
      seed('proficiency', pieces, scores);
      expect(text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}))).toContain(
        'Best work: Lab (Oct 5), 3.3 / 4.',
      );
    });

    it('a Proficiency class names points work at its points, as Assignment Grades prints it', () => {
      seed('proficiency', [quiz('A', '2026-10-01'), quiz('B', '2026-10-05')], [sc('A', 16), sc('B', 17)]);
      const prof = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
      // Step 4 group 2 #3: the whole piece's mark, the higher of the two.
      expect(prof).toContain('Best work: Quiz B (Oct 5), 17/20.');
    });
  });
});

describe('report-problem', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  describe('Report a Problem', () => {
    it('describes the browser in words, never the full user-agent string', () => {
      const mac =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
      expect(reportBrowserText(mac)).toBe('Chrome 131 on macOS');
      expect(
        reportBrowserText(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
        ),
      ).toBe('Edge 130 on Windows');
      expect(
        reportBrowserText(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
        ),
      ).toBe('Safari 18 on macOS');
      expect(reportBrowserText('Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0')).toBe(
        'Firefox 132 on Linux',
      );
      expect(
        reportBrowserText(
          'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
        ),
      ).toBe('Safari 18 on iPadOS');
      expect(
        reportBrowserText(
          'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        ),
      ).toBe('Chrome 129 on ChromeOS');
    });

    it('is in the account menu for every teacher', () => {
      const html = renderDock('dashboard');
      const menu = html.slice(html.indexOf('tb-user-dropdown'));
      expect(menu).toContain('data-action="openReportProblem">Report a Problem</button>');
    });

    it('sends through the outbox as submit_support_report, idempotently', async () => {
      expect(FV_IDEMPOTENT_RPCS.submit_support_report).toBe(true);
      const src = readFileSync(resolve(root, 'shared/data.js'), 'utf8');
      expect(src).toContain("_rpcOrNoop('submit_support_report', {");
      expect(typeof window.submitSupportReport).toBe('function');
    });

    it('caps each field at the database limits before sending', () => {
      const src = readFileSync(resolve(root, 'shared/data.js'), 'utf8');
      const body = src.slice(src.indexOf('window.submitSupportReport = function'));
      expect(body).toContain('.slice(0, 200)');
      expect(body).toContain('.slice(0, 5000)');
      expect(body).toContain('.slice(0, 300)');
      expect(body).toContain('.slice(0, 100)');
    });
  });
});

describe('report-proficiency-one-figure', () => {
  /**
   * The Report Card printed two overall figures in a Letter class: the
   * Proficiency block's Overall was the competencies rolled up as a %
   * ("Overall 92%") while the Back's Course Grade was the category-weighted
   * grade ("C+ 70%"). Its legend said "out of 4" under a table of percents,
   * and a rubric piece could be named as both the best and the lowest work
   * (step 4 group 2 #2).
   */

  const CID = 'report-one-figure';
  const SID = 'stu-1';
  const STUDENT = { id: SID, firstName: 'Zoe', lastName: 'Chen' };
  const text = html =>
    String(html)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  function seed(gradingSystem) {
    COURSES[CID] = { id: CID, name: 'Socials 11', gradingSystem };
    _cache.students[CID] = [STUDENT];
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [
        { id: 's1', name: 'Evidence', tags: [{ id: 't1', label: 'Evidence' }] },
        { id: 's2', name: 'Inquiry', tags: [{ id: 't2', label: 'Inquiry' }] },
      ],
      competencyGroups: [],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [
      { id: 'proj', name: 'Projects', weight: 50 },
      { id: 'test', name: 'Tests', weight: 50 },
    ];
    _cache.assessments[CID] = [
      // One piece scored on both competencies: the top of Evidence, the
      // bottom of Inquiry.
      { id: 'inq', title: 'Local History Inquiry', date: '2026-10-20', tagIds: ['t1', 't2'], categoryId: 'proj' },
      { id: 'quiz', title: 'Unit Quiz', date: '2026-10-21', tagIds: ['t1'], categoryId: 'proj' },
      // Points work on no competency pulls the course grade down.
      {
        id: 'test',
        title: 'Unit Test',
        date: '2026-10-22',
        tagIds: [],
        scoreMode: 'points',
        maxPoints: 10,
        categoryId: 'test',
      },
    ];
    _cache.scores[CID] = {
      [SID]: [
        { assessmentId: 'inq', tagId: 't1', score: 4, date: '2026-10-20' },
        { assessmentId: 'inq', tagId: 't2', score: 2, date: '2026-10-20' },
        { assessmentId: 'quiz', tagId: 't1', score: 3, date: '2026-10-21' },
        { assessmentId: 'test', tagId: null, score: 3, points: 3, date: '2026-10-22' },
      ],
    };
    _cache.statuses[CID] = {};
    _cache.rubrics[CID] = [];
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = { calcMethod: 'average' };
    clearProfCache();
  }
  const overallRow = html =>
    text(html.slice(html.indexOf('report-prof-overall'), html.indexOf('</tr>', html.indexOf('report-prof-overall'))));

  describe('one overall figure on the report', () => {
    afterEach(() => delete COURSES[CID]);

    it('a Letter class prints the course grade as the Overall, the figure the Back prints', () => {
      seed('letter');
      const course = studentGradeSummary(CID, SID).text;
      const html = ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {});
      expect(course).toMatch(/%$/);
      // The competencies alone would be well above the course grade.
      expect(formatLevel(CID, getOverallProficiency(CID, SID))).not.toBe(course.split(' ').pop());
      expect(overallRow(html)).toContain('Overall');
      expect(overallRow(html)).toContain(course);
      expect(overallRow(html)).not.toContain(formatLevel(CID, getOverallProficiency(CID, SID)));
      const back = ReportBlocks.renderBlockGradeTable(CID, STUDENT, {}, {});
      expect(text(back)).toContain('Course Grade ' + course);
    });

    it('a Both class prints the level and the course grade, as the Back does', () => {
      seed('both');
      const html = ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, { word: false });
      expect(overallRow(html)).toContain(studentGradeSummary(CID, SID).text);
    });

    it('a Proficiency class still rolls its competencies up', () => {
      seed('proficiency');
      const html = ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, { word: false });
      expect(overallRow(html)).toContain(formatLevel(CID, getOverallProficiency(CID, SID)));
    });

    it('a Letter class legend gives each level as a % and does not say out of 4', () => {
      seed('letter');
      const t = text(ReportBlocks.renderReportBlock('legend', CID, STUDENT, {}, {}));
      expect(t).not.toContain('out of 4');
      expect(t).toContain(formatLevel(CID, 3) + ' · Proficient');
      seed('proficiency');
      expect(text(ReportBlocks.renderReportBlock('legend', CID, STUDENT, {}, {}))).toContain(
        'BC Proficiency Scale, out of 4',
      );
    });

    it('a piece named as best work is not named as lowest work too', () => {
      seed('proficiency');
      const t = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
      expect(t).toContain('Best work: Local History Inquiry');
      expect(t).not.toMatch(/Lowest work: Local History Inquiry/);
    });
  });

  /* Best Work and Lowest Work gave a piece's mark on one competency
   (Pendulum Lab Report 4.0) while Assignment Grades gave its whole mark
   (3.0), and Complete/Incomplete work printed as 4.0 (step 4 group 2 #3). */
  describe('best and lowest work print the mark Assignment Grades prints', () => {
    afterEach(() => delete COURSES[CID]);

    it('names a piece at its whole mark and leaves out Complete/Incomplete work', () => {
      seed('proficiency');
      _cache.assessments[CID].push({
        id: 'safety',
        title: 'Safety Contract',
        date: '2026-10-01',
        tagIds: ['t1'],
        scoreMode: 'complete',
        categoryId: 'proj',
      });
      _cache.scores[CID][SID].push({ assessmentId: 'safety', tagId: 't1', score: 4, date: '2026-10-01' });
      clearProfCache();
      const t = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
      const back = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { word: false }, {}));
      // The Inquiry is 4 on Evidence and 2 on Inquiry: 3.0 as a whole.
      expect(back).toContain('Local History Inquiry 3.0 / 4');
      expect(t).toMatch(/Best work: Local History Inquiry \(Oct 20\)( and Unit Quiz \(Oct 21\))?, 3\.0 \/ 4\./);
      expect(t).not.toContain('Safety Contract');
      expect(t).not.toContain('4.0 / 4');
    });

    it('a Letter class names a piece at the % Assignment Grades prints', () => {
      seed('letter');
      const back = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { score: false, word: false }, {}));
      const pct = back.match(/Local History Inquiry (\d+%)/)[1];
      expect(text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}))).toContain(
        'Local History Inquiry (Oct 20)',
      );
      expect(text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}))).toMatch(
        new RegExp('Best work: [^.]*, ' + pct + '\\.'),
      );
    });
  });
});

describe('report-rubric-competency-mark', () => {
  /**
   * A competency's mark on rubric work, on the report blocks (Nov 3 bug
   * sweep, reports group 2). Two criteria feed one competency and the student
   * gets 4 on one and 1 on the other: the gradebook's competency cell shows 1,
   * striped as mixed (DECISIONS "Rubric criteria score on their own").
   * Assignment Grades by Competency printed 4.0 / 4 Extending, and the
   * Proficiency block's Lowest work skipped the low criterion, because both
   * kept each assessment's highest criterion. Both now read the mark through
   * calc.js (tagMarksByAssessment), as the gradebook does.
   */

  const CID = 'report-rubric-mark';
  const SID = 'stu-1';
  const STUDENT = { id: SID, firstName: 'Owen', lastName: 'Martens' };

  const rubric = {
    id: 'rub-1',
    name: 'Essay',
    criteria: [
      { id: 'crit-thesis', name: 'Thesis', tagIds: ['t1'], levels: {} },
      { id: 'crit-evidence', name: 'Evidence Use', tagIds: ['t1'], levels: {} },
    ],
  };
  const essay = { id: 'essay', title: 'Causes of the War', date: '2026-10-01', tagIds: ['t1'], rubricId: 'rub-1' };
  const debate = { id: 'debate', title: 'Treaty Debate', date: '2026-10-09', tagIds: ['t1'] };
  const sc = (assessmentId, tagId, score, extra) => ({ assessmentId, tagId, score, date: '2026-10-10', ...extra });

  function seed(scores) {
    COURSES[CID] = { id: CID, name: 'Socials 10', gradingSystem: 'proficiency' };
    _cache.students[CID] = [STUDENT];
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [{ id: 'sec-1', name: 'Significance', tags: [{ id: 't1', label: 'Significance' }] }],
      competencyGroups: [],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = [essay, debate];
    _cache.scores[CID] = { [SID]: scores };
    _cache.statuses[CID] = {};
    _cache.rubrics[CID] = [rubric];
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = { calcMethod: 'average' };
    clearProfCache();
  }
  const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  describe('a competency fed by two rubric criteria', () => {
    afterEach(() => delete COURSES[CID]);

    it('prints the lowest criterion when they disagree, as the gradebook does', () => {
      seed([sc('essay', 'crit-thesis', 4), sc('essay', 'crit-evidence', 1), sc('debate', 't1', 3)]);
      expect(competencyLevelFromCriteria(CID, SID, essay, 't1')).toMatchObject({ score: 1, mixed: true });
      expect(tagMarksByAssessment(CID, SID, 't1').find(m => m.assessmentId === 'essay')).toMatchObject({
        score: 1,
        mixed: true,
      });

      const grades = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { organize: 'competency' }));
      expect(grades).toContain('Causes of the War 1.0 / 4 Emerging');
      expect(grades).not.toContain('4.0 / 4');

      const prof = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
      expect(prof).toContain('Best work: Treaty Debate (Oct 9), 3.0 / 4.');
    });

    it('prints the one level, with its ±, when they agree', () => {
      seed([sc('essay', 'crit-thesis', 3, { mod: 1 }), sc('essay', 'crit-evidence', 3, { mod: 1 })]);
      const grades = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { organize: 'competency' }));
      expect(grades).toContain('Causes of the War 3.3 / 4 Proficient');
    });
  });
});

describe('report-sheets', () => {
  /**
   * ReportSheets.pack: the rows engine as a pure function over measured
   * heights. A row takes the taller of its cells and sits a gap under the
   * row before it; the pinned block docks to the bottom of its side; a row
   * past the limit, and the rest of its side, continues on a side of its
   * own; a row taller than a whole side prints after the report, a table
   * cut at its rows.
   */

  const H = 996;
  const P = (sides, opts) => ReportSheets.pack(sides, { H, gap: 12, pinned: null, ...opts });
  const c = (id, px, more) => ({ id, size: 'row', px, ...more });
  const h = (id, px, more) => ({ id, size: 'half', px, ...more });
  const rowsOf = side => side.rows.map(r => [r.y, r.h, r.cells.map(x => x.id + '/' + x.size + '@' + x.h).join('+')]);

  describe('ReportSheets.pack', () => {
    it('stacks rows down a side with the gap between them; a pair takes the taller cell', () => {
      const r = P([[[c('header', 81)], [c('table', 246)], [h('att', 44), h('miss', 80)]]]);
      expect(r.sides).toHaveLength(1);
      expect(r.sides[0].kind).toBe('side');
      expect(rowsOf(r.sides[0])).toEqual([
        [0, 81, 'header/row@81'],
        [93, 246, 'table/row@246'],
        [351, 80, 'att/half@80+miss/half@80'],
      ]);
      expect(r.continued).toEqual([]);
      expect(r.after).toEqual([]);
      expect(r.over).toBe(false);
    });

    it('docks the pinned block to the bottom of its side and keeps the rows above its gap', () => {
      const r = P([[[c('dims', 281)], [c('response', 304)]]], { pinned: 'response' });
      expect(r.sides[0].pinned).toEqual({ id: 'response', size: 'row', h: 304, y: H - 304 });
      expect(rowsOf(r.sides[0])).toEqual([[0, 281, 'dims/row@281']]);
      // A row that would reach into the docked block continues instead.
      const tight = P([[[c('a', 400)], [c('b', 300)], [c('response', 304)]]], { pinned: 'response' });
      expect(tight.sides.map(s => s.kind)).toEqual(['side', 'continued']);
      expect(rowsOf(tight.sides[0])).toEqual([[0, 400, 'a/row@400']]);
      expect(rowsOf(tight.sides[1])).toEqual([[0, 300, 'b/row@300']]);
      expect(tight.continued).toEqual(['b']);
    });

    it('a row past the side, and every row after it, continues on a side inserted after it', () => {
      const r = P([
        [[c('header', 81)], [c('comment', 700)], [c('steps', 300)], [c('legend', 100)]],
        [[c('dims', 281)]],
      ]);
      expect(r.sides.map(s => [s.kind, s.from])).toEqual([
        ['side', 0],
        ['continued', 0],
        ['side', 1],
      ]);
      expect(rowsOf(r.sides[0])).toEqual([
        [0, 81, 'header/row@81'],
        [93, 700, 'comment/row@700'],
      ]);
      expect(rowsOf(r.sides[1])).toEqual([
        [0, 300, 'steps/row@300'],
        [312, 100, 'legend/row@100'],
      ]);
      expect(r.continued).toEqual(['steps', 'legend']);
      expect(r.over).toBe(false);
    });

    it('a cell that prints nothing takes no room; a pair with one empty cell prints the other alone; an empty row keeps its place at no height', () => {
      const r = P([
        [
          [c('header', 81)],
          [h('att', 0, { empty: true }), h('miss', 60)],
          [c('gone', 0, { empty: true })],
          [c('legend', 100)],
        ],
      ]);
      expect(rowsOf(r.sides[0])).toEqual([
        [0, 81, 'header/row@81'],
        [93, 60, 'miss/half@60'],
        [165, 0, 'gone/row@0'],
        [165, 100, 'legend/row@100'],
      ]);
      expect(r.sides[0].rows[2].empty).toBe(true);
      expect(r.sides[0].rows[3].empty).toBeUndefined();
    });

    it('a table taller than a side goes on side by side; anything else taller prints after the report, alone and over', () => {
      const rows = Array.from({ length: 60 }, () => 30); // 1800px of rows
      const r = P([
        [[c('header', 81)], [c('grades', 1860, { rows, chrome: 60 })], [c('legend', 100)]],
        [[c('response', 304)]],
      ]);
      // The Front: the letterhead and as many rows as fit (60 + 28 × 30 =
      // 900, from 93 to 993). The Back: the next 31 (990), then a continued
      // side with the last row, the legend and the Back's own block.
      expect(r.sides.map(s => [s.kind, s.from])).toEqual([
        ['side', 0],
        ['side', 1],
        ['continued', 1],
      ]);
      expect(rowsOf(r.sides[0])).toEqual([
        [0, 81, 'header/row@81'],
        [93, 900, 'grades/row@900'],
      ]);
      const parts = r.sides.map(s => s.rows[s === r.sides[0] ? 1 : 0].cells[0].part);
      expect(parts).toEqual([
        { start: 0, end: 28 },
        { start: 28, end: 59 },
        { start: 59, end: 60 },
      ]);
      expect(rowsOf(r.sides[2])).toEqual([
        [0, 90, 'grades/row@90'],
        [102, 100, 'legend/row@100'],
        [214, 304, 'response/row@304'],
      ]);
      expect(r.after).toEqual([]);
      expect(r.over).toBe(false);
      const tall = P([[[c('reflection', 1200)]]]);
      expect(tall.sides.map(s => s.kind)).toEqual(['side', 'after']);
      expect(tall.sides[1].rows[0].h).toBe(H);
      expect(tall.over).toBe(true);
    });

    it('a pinned block taller than a side is docked at the top and flagged', () => {
      const r = P([[[c('response', 1100)]]], { pinned: 'response' });
      expect(r.sides[0].pinned).toEqual({ id: 'response', size: 'row', h: H, y: 0 });
      expect(r.over).toBe(true);
    });

    it('an empty side stays an empty side', () => {
      const r = P([[[c('header', 81)]], []]);
      expect(r.sides.map(s => [s.kind, s.rows.length])).toEqual([
        ['side', 1],
        ['side', 0],
      ]);
    });
  });

  /* A long Assignment Grades table starts on the side it is on and goes on
   side by side, so a new report (the name on the Front, the table under
   it, an empty Back) never prints a blank Back with the table on a second
   sheet (PR 1094's "After main moved"). Sides after the Front keep 28 px
   for the line naming the student. Rows are 30 px, the table's title and
   heading 60: after the letterhead the Front holds 28 rows; a side under
   the line holds 30 (60 + 900 ≤ 996 − 28 − 1). */
  describe('ReportSheets.pack: a long table goes on side by side', () => {
    const HEAD = 16;
    const TOP = HEAD + 12;
    const PH = (sides, opts) => P(sides, { head: HEAD, ...opts });
    const grades = n => c('grades', 60 + n * 30, { rows: Array.from({ length: n }, () => 30), chrome: 60 });
    const newReport = (n, back = []) => PH([[[c('header', 81)], [grades(n)]], back]);
    const where = r =>
      r.sides.map(s => [
        s.kind,
        s.from,
        s.rows.map(x => x.cells.map(cl => cl.id + (cl.part ? ' ' + cl.part.start + '-' + cl.part.end : '')).join('+')),
      ]);
    /* No side runs past its foot, or into its docked block; the table's parts
     run on from each other with no row lost or doubled; no side is blank. */
    const sound = (r, n) => {
      r.sides.forEach(s => {
        const foot = s.pinned ? s.pinned.y - 12 : H;
        s.rows.forEach(x => expect(x.y + x.h).toBeLessThanOrEqual(foot));
        expect(s.rows.length + (s.pinned ? 1 : 0)).toBeGreaterThan(0);
      });
      const parts = r.sides.flatMap(s =>
        s.rows.flatMap(x => x.cells.filter(cl => cl.id === 'grades').map(cl => cl.part || { start: 0, end: n })),
      );
      parts.forEach((p, i) => expect(p.start).toBe(i ? parts[i - 1].end : 0));
      expect(parts[parts.length - 1].end).toBe(n);
      expect(r.over).toBe(false);
      expect(r.after).toEqual([]);
    };

    it('1 row: whole, under the name', () => {
      const r = newReport(1);
      expect(where(r)).toEqual([
        ['side', 0, ['header', 'grades']],
        ['side', 1, []],
      ]);
    });

    it('as many rows as the Front holds after the name: whole, on the Front', () => {
      const r = newReport(28);
      expect(where(r)).toEqual([
        ['side', 0, ['header', 'grades']],
        ['side', 1, []],
      ]);
      expect(r.sides[0].rows[1].y + r.sides[0].rows[1].h).toBe(993);
    });

    it('a side’s worth, too long for the room after the name: whole on the Back, not on a side of its own', () => {
      const r = newReport(30);
      expect(where(r)).toEqual([
        ['side', 0, ['header']],
        ['side', 1, ['grades']],
      ]);
      expect(r.sides[1].rows[0].y).toBe(TOP);
      expect(r.sides[1].rows[0].carried).toBe(true);
      expect(r.sides[0].passed).toBe(true);
      sound(r, 30);
    });

    it('a side plus one row: starts under the name and ends on the Back, one sheet', () => {
      const r = newReport(31);
      expect(where(r)).toEqual([
        ['side', 0, ['header', 'grades 0-28']],
        ['side', 1, ['grades 28-31']],
      ]);
      expect(r.sides[0].rows[1].y).toBe(93);
      expect(r.sides[1].rows[0].y).toBe(TOP);
      expect(r.continued).toEqual(['grades']);
      sound(r, 31);
    });

    it('two sides plus one row: the Front, the Back, then a new sheet, with no blank side', () => {
      const r = newReport(59);
      expect(where(r)).toEqual([
        ['side', 0, ['header', 'grades 0-28']],
        ['side', 1, ['grades 28-58']],
        ['continued', 1, ['grades 58-59']],
      ]);
      expect(r.sides[2].rows[0].y).toBe(TOP);
      sound(r, 59);
    });

    it('after a full Front: starts at the top of the Back', () => {
      const r = PH([[[c('header', 81)], [c('comment', 880)], [grades(40)]], []]);
      expect(where(r)).toEqual([
        ['side', 0, ['header', 'comment']],
        ['side', 1, ['grades 0-30']],
        ['continued', 1, ['grades 30-40']],
      ]);
      expect(r.sides[1].rows[0].y).toBe(TOP);
      sound(r, 40);
    });

    it('the rows after the table follow where it ends, then the Back’s own rows', () => {
      const r = PH([[[c('header', 81)], [grades(31)], [c('legend', 100)]], [[c('dims', 200)]]]);
      expect(where(r)).toEqual([
        ['side', 0, ['header', 'grades 0-28']],
        ['side', 1, ['grades 28-31', 'legend', 'dims']],
      ]);
      expect(r.sides[1].rows.map(x => [x.y, !!x.carried])).toEqual([
        [TOP, true],
        [TOP + 150 + 12, true],
        [TOP + 150 + 12 + 100 + 12, false],
      ]);
      sound(r, 31);
    });

    it('the Conference Pack: on the Back between its blocks and the docked Parent Response, then on', () => {
      const r = PH(
        [
          [[c('header', 81)], [c('comment', 800)]],
          [[c('dims', 281)], [grades(38)], [c('response', 120)]],
        ],
        { pinned: 'response' },
      );
      // The Back: dims from 28 to 309, the table from 321 to 861 (16 rows),
      // above the response docked at 876.
      expect(where(r)).toEqual([
        ['side', 0, ['header', 'comment']],
        ['side', 1, ['dims', 'grades 0-16']],
        ['continued', 1, ['grades 16-38']],
      ]);
      expect(r.sides[1].pinned).toEqual({ id: 'response', size: 'row', h: 120, y: 876 });
      sound(r, 38);
    });

    it('a table moved to the Back that does not fit above its docked block starts there and goes on', () => {
      const r = PH([[[c('header', 81)], [c('comment', 700)], [grades(20)]], [[c('response', 400)]]], {
        pinned: 'response',
      });
      expect(where(r)).toEqual([
        ['side', 0, ['header', 'comment']],
        ['side', 1, ['grades 0-16']],
        ['continued', 1, ['grades 16-20']],
      ]);
      sound(r, 20);
    });

    it('a table that fits a side still goes whole onto a continued side past the last side', () => {
      const r = PH([[[c('header', 81)], [c('comment', 700)], [grades(20)]]]);
      expect(where(r)).toEqual([
        ['side', 0, ['header', 'comment']],
        ['continued', 0, ['grades']],
      ]);
    });

    it('a row taller than a whole side prints alone, over, and the rest goes on', () => {
      const r = PH([[[c('header', 81)], [c('grades', 60 + 30 + 2000, { rows: [30, 2000], chrome: 60 })]]]);
      expect(where(r)).toEqual([
        ['side', 0, ['header', 'grades 0-1']],
        ['continued', 0, ['grades 1-2']],
      ]);
      expect(r.sides[1].rows[0].y + r.sides[1].rows[0].h).toBe(H);
      expect(r.over).toBe(true);
    });
  });

  describe('ReportSheets sizes', () => {
    it('a side is the paper less the sheet padding; cells are 720 or 354 wide', () => {
      expect(ReportSheets.sideHeight('letter')).toBe(11 * 96 - 60);
      expect(ReportSheets.sideHeight('legal')).toBe(14 * 96 - 60);
      expect(ReportSheets.cellWidth('row')).toBe(720);
      expect(ReportSheets.cellWidth('half')).toBe(354);
      expect(ReportSheets.sideLabel({ kind: 'side', from: 0 })).toBe('Front');
      expect(ReportSheets.sideLabel({ kind: 'side', from: 1 })).toBe('Back');
      expect(ReportSheets.sideLabel({ kind: 'side', from: 2 })).toBe('Page 3');
      expect(ReportSheets.sideLabel({ kind: 'continued', from: 0 })).toBe('Continued');
      expect(ReportSheets.sideLabel({ kind: 'after' })).toBe('After the Report');
      expect(ReportSheets.sideLabel(null)).toBe('Blank');
    });
  });

  describe('ReportSheets.fitText', () => {
    it('says how a comment sits in its lines, and names the second sheet when the report runs to one', () => {
      expect(ReportSheets.fitText(null)).toBe('');
      expect(ReportSheets.fitText({ room: 10, noComment: true })).toBe('No comment yet. The box holds 10 lines.');
      expect(ReportSheets.fitText({ room: 10, commentLines: 4, sheets: 1 })).toBe('Fits. 4 lines; room for 6 more.');
      expect(ReportSheets.fitText({ room: 10, commentLines: 13, sheets: 1 })).toBe(
        '13 lines, 3 past the box; what is under it moves down. Nothing is cut.',
      );
      expect(ReportSheets.fitText({ room: 10, commentLines: 18, sheets: 2 })).toBe(
        '18 lines, 8 past the box; this report runs to 2 sheets. Nothing is cut.',
      );
    });
  });

  describe('review fixes', () => {
    it('a pair row taller than a side sends only the tall cell after the report; the short partner stays', () => {
      const r = ReportSheets.pack(
        [
          [
            [{ id: 'header', size: 'row', px: 81 }],
            [
              { id: 'tall', size: 'half', px: 1200 },
              { id: 'short', size: 'half', px: 80 },
            ],
          ],
        ],
        { H: 996, gap: 12, pinned: null },
      );
      expect(r.after).toEqual(['tall']);
      expect(r.sides[0].rows.map(row => row.cells.map(c => c.id + '@' + c.h).join('+'))).toEqual([
        'header@81',
        'short@80',
      ]);
    });

    it('pairsWell: the shorter is at least half the taller; unmeasured blocks pair', () => {
      expect(ReportSheets.pairsWell('legend', 'support-home', { legend: 116, 'support-home': 118 })).toBe(true);
      expect(ReportSheets.pairsWell('missing-work', 'legend', { 'missing-work': 44, legend: 116 })).toBe(false);
      expect(ReportSheets.pairsWell('legend', 'support-home', {})).toBe(true);
      expect(ReportSheets.pairsWell('legend', 'parent-response', {})).toBe(false);
    });

    it('Side by Side does not pair blocks of very different heights', () => {
      const f = ReportSheets.setSize(ReportSheets.form(), 'legend', 'half');
      const uneven = ReportSheets.setSize(f, 'proficiency', 'half', { legend: 116, proficiency: 360 });
      expect(uneven.sides[0].rows[1].cells.map(c => c.block)).toEqual(['proficiency']);
      const even = ReportSheets.setSize(f, 'proficiency', 'half', { legend: 200, proficiency: 360 });
      expect(even.sides[0].rows[1].cells.map(c => c.block)).toEqual(['proficiency', 'legend']);
    });
  });

  describe('calc.js levelChangeAs', () => {
    it('reads the change in levels, or in percent for a letter class', () => {
      COURSES.lc1 = { id: 'lc1', gradingSystem: 'letter' };
      COURSES.lc2 = { id: 'lc2', gradingSystem: 'both' };
      COURSES.lc3 = { id: 'lc3', gradingSystem: 'proficiency' };
      expect(levelChangeAs('lc3', 3.1, 3.3)).toBe('+0.2');
      expect(levelChangeAs('lc2', 3.3, 3.1)).toBe('−0.2');
      expect(levelChangeAs('lc1', 3, 3.33)).toBe('+8%');
      expect(levelChangeAs('lc1', 3, 3)).toBe('0%');
      expect(levelChangeAs('lc1', 0, 3)).toBe('—');
    });
  });
});

describe('report-studio-words', () => {
  /**
   * Page Studio's words (step 4 group 3 #63): "to the Page 3", folder counts
   * with no word for what they count, a Start of Term of "—" in the
   * Proficiency table where Progress in One Area printed the first piece's
   * level, a "Focus area (biggest change)" that changed 0.0, and "black" in
   * lower case in the print dialog.
   */

  const CID = 'studio-words';
  const SID = 'stu-1';
  const STUDENT = { id: SID, firstName: 'Mateo', lastName: 'Alvarez' };
  const text = html =>
    String(html)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  function seed() {
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
    _cache.students[CID] = [STUDENT];
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [
        { id: 's1', name: 'Questioning', tags: [{ id: 't1', label: 'Questioning' }] },
        { id: 's2', name: 'Evaluating', tags: [{ id: 't2', label: 'Evaluating' }] },
      ],
      competencyGroups: [],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [];
    // One piece on each competency: too few dated scores for a start.
    _cache.assessments[CID] = [
      { id: 'lab', title: 'Lab 1 Observations', date: '2026-10-27', tagIds: ['t1'] },
      { id: 'quiz', title: 'Quiz', date: '2026-10-28', tagIds: ['t2'] },
    ];
    _cache.scores[CID] = {
      [SID]: [
        { assessmentId: 'lab', tagId: 't1', score: 2.33, date: '2026-10-27' },
        { assessmentId: 'quiz', tagId: 't2', score: 3, date: '2026-10-28' },
      ],
    };
    _cache.statuses[CID] = {};
    _cache.rubrics[CID] = [];
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = { calcMethod: 'average' };
    clearProfCache();
  }

  describe('Page Studio words', () => {
    afterEach(() => delete COURSES[CID]);

    it('names a side as a sentence does', () => {
      expect(ReportStudio.sideWhere(0)).toBe('the Front');
      expect(ReportStudio.sideWhere(1)).toBe('the Back');
      expect(ReportStudio.sideWhere(2)).toBe('Page 3');
    });

    it('the Proficiency table starts a competency where Progress in One Area does', () => {
      seed();
      const prog = text(ReportBlocks.renderBlockProgress(CID, STUDENT, {}, {}));
      const start = prog.match(/Start of term (\d\.\d)/)[1];
      const table = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, { word: false }));
      expect(table).toMatch(new RegExp('Questioning ' + start.replace('.', '\\.') + ' '));
      expect(table).not.toMatch(/Questioning — /);
    });

    it('a focus area with no change is not called the biggest change', () => {
      seed();
      const prog = text(ReportBlocks.renderBlockProgress(CID, STUDENT, {}, {}));
      expect(prog).toContain('Focus area (lowest now)');
      expect(prog).not.toContain('biggest change');
    });
  });
});

describe('report-studio', () => {
  /**
   * Page Studio's pure parts (teacher/report-studio.js): the two panes, the
   * palette with its ticks and greyed blocks, where a block lands, the fit
   * line, the selected block's card, the Options popover, the live-region
   * text and the canvas zoom.
   */

  const per = list =>
    Object.fromEntries(
      list.map((p, i) => [`s${i}`, { name: `S ${i}`, sheets: 1, over: false, used: 100, free: [500, 500], ...p }]),
    );
  const fit = list => ({ perStudent: per(list), sideHeight: 996 });

  describe('ReportStudio', () => {
    it('lays out two panes: the palette and the canvas with the fit line and the view switch', () => {
      const html = ReportStudio.layoutHtml({ view: 'one' });
      expect(html).toContain('id="studio-palette"');
      expect(html).toContain('id="studio-fit"');
      expect(html).toContain('One Student');
      expect(html).toContain('Everyone');
      expect(html).not.toContain('studio-inspector');
    });

    it('the Quick Report fit line names each cause on its own flag, a student with both counted in each', () => {
      const text = {
        over: 'Too many assessments to fit on one sheet for ',
        feedbackOver: 'A feedback card is taller than a page for ',
      };
      const both = { over: true, gradeOver: true, feedbackOver: true };
      const cut = { over: true, gradeOver: true };
      const tall = { over: true, feedbackOver: true };
      expect(ReportStudio.fitLineHtml(fit([both, cut]), null, text)).toContain(
        'Too many assessments to fit on one sheet for 2 students; A feedback card is taller than a page for 1 student<',
      );
      const mixed = ReportStudio.fitLineHtml(fit([both]), null, text);
      expect(mixed).toContain(
        'Too many assessments to fit on one sheet for 1 student; A feedback card is taller than a page for 1 student',
      );
      const apart = ReportStudio.fitLineHtml(fit([cut, tall]), null, text);
      expect(apart).toContain('for 1 student; A feedback card is taller than a page for 1 student');
    });

    it('the fit line counts sheets: one for all, or how many need more (a link to Everyone)', () => {
      const f = ReportSheets.form();
      expect(ReportStudio.fitLineHtml(fit([{}, {}, {}]), f)).toBe('1 sheet for all 3 students');
      expect(ReportStudio.fitLineHtml(fit([{}]), f)).toBe('1 sheet for 1 student');
      const more = ReportStudio.fitLineHtml(fit([{ sheets: 2 }, {}, { sheets: 2 }]), f);
      expect(more).toContain('2 sheets for 2 students');
      expect(more).toContain('data-action="studioView" data-view="all"');
      expect(ReportStudio.fitLineHtml(fit([{ sheets: 3 }]), f)).toContain('3 sheets for 1 student<');
      // Students who need different counts: the range, not the most any one
      // needs (it read "8 sheets for 30 students"; step 4 group 2 #9).
      expect(ReportStudio.fitLineHtml(fit([{ sheets: 2 }, { sheets: 8 }, {}, { sheets: 5 }]), f)).toContain(
        '2 to 8 sheets for 3 students<',
      );
      const over = ReportStudio.fitLineHtml(fit([{ sheets: 2, over: true }, {}]), f);
      expect(over).toContain('A block is taller than a page for 1 student');
      expect(ReportStudio.fitLineHtml(fit([{}, {}]), ReportSheets.setSides(f, 1))).toBe(
        'Front only · 1 page for all 2 students',
      );
      expect(ReportStudio.fitLineHtml(fit([{ sides: 2 }, { sides: 1 }]), ReportSheets.setSides(f, 1))).toContain(
        'Continues on the back for 1 student<',
      );
      expect(ReportStudio.fitLineHtml(null, f)).toBe('');
    });

    it('names the student whose report is longest', () => {
      expect(ReportStudio.longestStudent({ perStudent: per([{ used: 900 }, { used: 1800 }, { used: 700 }]) })).toBe(
        's1',
      );
      expect(ReportStudio.longestStudent(null)).toBeNull();
    });

    it('a block lands on the first side with room for every student, after the report when taller than a side, nowhere when nothing fits', () => {
      const f = ReportSheets.form();
      const sizes = {
        observations: { row: 400, half: 600 },
        legend: { row: 100, half: 200 },
        big: { row: 1200, half: null },
      };
      expect(ReportStudio.landing(f, 'legend', sizes, fit([{ free: [300, 50] }, { free: [120, 400] }]))).toEqual({
        side: 0,
      });
      expect(ReportStudio.landing(f, 'observations', sizes, fit([{ free: [300, 500] }, { free: [900, 420] }]))).toEqual(
        {
          side: 1,
        },
      );
      expect(ReportStudio.landing(f, 'observations', sizes, fit([{ free: [300, 400] }]))).toEqual({
        reason: 'No room on either side',
        fix: 'Add a page or remove a block',
      });
      expect(ReportStudio.landing(ReportSheets.setSides(f, 1), 'observations', sizes, fit([{ free: [300] }]))).toEqual({
        reason: 'No room on the Front',
        fix: 'Choose Front and Back',
      });
      expect(ReportStudio.landing(f, 'big', sizes, fit([{}]))).toEqual({ after: true });
      // An empty side has room for anything up to a side.
      expect(ReportStudio.landing(f, 'observations', sizes, fit([{ free: [0, 996] }]))).toEqual({ side: 1 });
      expect(ReportStudio.landing(f, 'legend', null, fit([{}]))).toBeNull();
      expect(ReportStudio.landing(f, 'legend', sizes, null)).toBeNull();
    });

    it('scales two pages side by side when there is room beside the gutter, else one above the other', () => {
      expect(ReportStudio.fitZoom(1600)).toEqual({ zoom: 0.62, stacked: false });
      const narrow = ReportStudio.fitZoom(1100);
      expect(narrow.stacked).toBe(false);
      expect(narrow.zoom).toBeLessThan(0.62);
      expect(ReportStudio.fitZoom(900).stacked).toBe(true);
    });

    it('renders the palette with every block grouped, the placed ones ticked and the ones with no room greyed', () => {
      const f = ReportSheets.form();
      const sizes = { 'student-reflection-habits': { row: 600, half: null } };
      const html = ReportStudio.paletteHtml(f, 'blocks', [], sizes, fit([{ free: [100, 100] }]));
      expect(html).toContain('Grades');
      expect(html).toMatch(/class="studio-blk placed"[^>]*data-block="proficiency"[^>]*aria-pressed="true"/);
      expect(html).toContain('Click to find it');
      expect(html).toMatch(
        /class="studio-blk nofit"[^>]*data-block="student-reflection-habits"[^>]*aria-disabled="true"/,
      );
      expect(html).toContain('No room on either side. Add a page or remove a block.');
      expect(html).not.toContain('Letterhead');
      expect(html).not.toMatch(/studio-sz|>S<|>XL</);
      // Retired blocks stay out unless placed.
      expect(html).not.toContain('data-block="section-chart"');
      // Before the class is measured nothing is greyed.
      expect(ReportStudio.paletteHtml(f, 'blocks', [], null, null)).not.toContain('nofit');
      const tpl = ReportStudio.paletteHtml(f, 'templates', [{ id: 't1', name: 'Mine' }]);
      expect(tpl).toContain('Starters');
      expect(tpl).toContain('Report Card');
      expect(tpl).toContain('Mine');
      expect(tpl).toContain('aria-label="Delete Mine"');
    });

    it('the selected block’s inspector says where it is and offers Lines, Size, Move, its options, Leave Off and Remove', () => {
      const f = ReportSheets.form();
      const who = { id: 'st1', name: 'Ethan Dubois' };
      const comment = ReportStudio.blockToolbarHtml(f, 'teacher-narrative', who);
      expect(comment).toContain('On the Front');
      expect(comment).toContain('Teacher Comment');
      expect(comment).toContain('<b>10</b>');
      expect(comment).toContain('data-action="studioLines"');
      expect(comment).toContain('Room for the longest comment in the class');
      expect(comment).toContain('data-action="studioSize"');
      expect(comment).toContain('aria-label="Move Up"');
      expect(comment).toContain('aria-label="Move Down"');
      expect(comment).toContain('aria-label="Move to Back"');
      expect(comment).toContain('>To Back<');
      expect(comment).toContain('Leave Off Ethan');
      expect(comment).toContain('>Remove<');
      expect(comment).not.toContain('studioOption');
      // The legend: no lines; the table's options are in the inspector.
      expect(ReportStudio.blockToolbarHtml(f, 'legend', who)).not.toContain('studioLines');
      expect(ReportStudio.blockToolbarHtml(f, 'proficiency', who)).toContain('data-action="studioOption"');
      // The letterhead: its options and a line, nothing to move.
      const head = ReportStudio.blockToolbarHtml(f, 'header', who);
      expect(head).toContain('Always first on the Front');
      expect(head).not.toContain('Move');
      expect(head).not.toContain('Remove');
      expect(head).not.toContain('studioSize');
      // The pinned Response: Comment Lines, no Move, no Size.
      const resp = ReportStudio.blockToolbarHtml(f, 'parent-response', who);
      expect(resp).toContain('On the Back');
      expect(resp).toContain('Always last on the Back');
      expect(resp).toContain('Comment Lines');
      expect(resp).not.toContain('Move');
      expect(resp).not.toContain('studioSize');
      // Move Up is off for the first row under the letterhead; Move Down for the last.
      expect(ReportStudio.blockToolbarHtml(f, 'proficiency', who)).toMatch(/data-dir="-1"[^>]* disabled>/);
      expect(ReportStudio.blockToolbarHtml(f, 'grade-table', who)).toMatch(/data-dir="1"[^>]* disabled>/);
      expect(ReportStudio.blockToolbarHtml(f, 'nope', who)).toBe('');
      // Everyone view: no Leave Off.
      expect(ReportStudio.blockToolbarHtml(f, 'legend', null)).not.toContain('Leave Off');
    });

    it('the inspector holds the block’s Show checkboxes, choices, no-evidence rule or text fields', () => {
      const f = ReportSheets.form();
      const table = ReportStudio.blockToolbarHtml(f, 'proficiency', null);
      expect(table).toContain('role="region"');
      expect(table).toContain('aria-label="Proficiency Settings"');
      expect(table).toContain('data-key="score"');
      // No Compare With: the first report compares with the start of the
      // term, every later one with the last report (2026-11-03).
      expect(table).not.toContain('aria-label="Compare With"');
      expect(table).toContain('Hide Row');
      expect(table).not.toMatch(/Width|Height|row \d/);
      const withSteps = ReportSheets.insert(f, 'next-steps', { side: 0 });
      expect(ReportStudio.blockToolbarHtml(withSteps, 'next-steps', null)).toContain('aria-label="Competencies"');
      const text = ReportStudio.blockToolbarHtml(ReportSheets.insert(f, 'text-block', { side: 1 }), 'text-block', null);
      expect(text).toContain('id="studio-text-title"');
      expect(text).toContain('id="studio-text-body"');
      expect(ReportStudio.hasOptions('text-block')).toBe(true);
      expect(ReportStudio.hasOptions('legend')).toBe(false);
      expect(ReportStudio.hasOptions('teacher-narrative')).toBe(false);
    });

    it('says where a block is for the live region', () => {
      const f = ReportSheets.form();
      expect(ReportStudio.placeText(f, 'teacher-narrative')).toBe('Teacher Comment, Front, row 4 of 5');
      expect(ReportStudio.placeText(f, 'term-attendance')).toBe('Attendance, Front, row 5 of 5, beside Missing Work');
      expect(ReportStudio.placeText(f, 'parent-response')).toBe('Parent / Guardian Response, Back, row 3 of 3');
      expect(ReportStudio.placeText(f, 'nope')).toBe('');
    });
  });

  describe('ReportStudio drag targets', () => {
    const row = (top, bottom, cells, more) => ({ top, bottom, cells, ...more });
    const c = (id, size, right) => ({ id, size, right: right ?? 720 });
    const rows = [
      row(0, 81, [c('header', 'row')]),
      row(93, 339, [c('proficiency', 'row')]),
      row(351, 468, [c('legend', 'half', 354)]),
      row(480, 606, [c('teacher-narrative', 'row')]),
      row(700, 996, [c('parent-response', 'row')], { pinned: true }),
    ];
    const T = (x, y, opts) => ReportStudio.targetFor(rows, x, y, { lo: 1, ...opts });

    it('a drop lands in the gap under every row whose midpoint is above the pointer, never above the letterhead or after the pinned row', () => {
      expect(T(100, 10)).toEqual({ kind: 'row', index: 1 });
      expect(T(100, 100)).toEqual({ kind: 'row', index: 1 });
      expect(T(100, 300)).toEqual({ kind: 'row', index: 2 });
      expect(T(100, 400)).toEqual({ kind: 'row', index: 2 });
      expect(T(100, 460)).toEqual({ kind: 'row', index: 3 });
      expect(T(100, 600)).toEqual({ kind: 'row', index: 4 });
      expect(T(100, 900)).toEqual({ kind: 'row', index: 4 });
    });

    it('over the empty half beside a lone Side by Side block the drop lands beside it, when the pair is allowed', () => {
      const ok = { canBeside: () => true };
      expect(T(500, 400, ok)).toEqual({ kind: 'beside', target: 'legend' });
      expect(T(200, 400, ok)).toEqual({ kind: 'row', index: 2 });
      expect(T(500, 400, { canBeside: () => false })).toEqual({ kind: 'row', index: 2 });
      expect(T(500, 400)).toEqual({ kind: 'row', index: 2 });
    });

    it('the held block’s own row is neither a target nor counted', () => {
      const held = rows.map(r => (r.cells[0].id === 'proficiency' ? { ...r, held: true } : r));
      expect(ReportStudio.targetFor(held, 100, 300, { lo: 1 })).toEqual({ kind: 'row', index: 1 });
      expect(ReportStudio.targetFor(held, 100, 460, { lo: 1 })).toEqual({ kind: 'row', index: 2 });
    });

    it('fitsOn says whether a side has room for the block for every student', () => {
      const f = ReportSheets.form();
      const sizes = { observations: { row: 400, half: 600 } };
      const fit = list => ({ perStudent: per(list), sideHeight: 996 });
      expect(ReportStudio.fitsOn(f, 'observations', 0, sizes, fit([{ free: [500, 0] }, { free: [420, 0] }]))).toBe(
        true,
      );
      expect(ReportStudio.fitsOn(f, 'observations', 0, sizes, fit([{ free: [500, 0] }, { free: [300, 0] }]))).toBe(
        false,
      );
      expect(ReportStudio.fitsOn(f, 'observations', 1, sizes, fit([{ free: [0, 996] }]))).toBe(true);
      // A block already on the side moves within it.
      expect(ReportStudio.fitsOn(f, 'legend', 0, { legend: { row: 2000 } }, fit([{ free: [0, 0] }]))).toBe(true);
      expect(ReportStudio.fitsOn(f, 'observations', 0, null, fit([{}]))).toBeNull();
    });

    it('peekHtml wraps the block at Row width with its caption', () => {
      const html = ReportStudio.peekHtml('Teacher Comment', 'Ethan Dubois', '<div>x</div>');
      expect(html).toContain('studio-peek-box');
      expect(html).toContain('width:720px');
      expect(html).toContain('Teacher Comment for Ethan Dubois, at print size');
    });
  });

  describe('ReportStudio Everyone order and the Templates tab', () => {
    it('Everyone leads with the students on more than one sheet, most first, then roster order', () => {
      const students = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
      const summary = { perStudent: { a: { sheets: 1 }, b: { sheets: 2 }, c: { sheets: 3 }, d: { sheets: 1 } } };
      expect(ReportStudio.orderBySheets(students, summary).map(s => s.id)).toEqual(['c', 'b', 'a', 'd']);
      expect(ReportStudio.orderBySheets(students, null).map(s => s.id)).toEqual(['a', 'b', 'c', 'd']);
      expect(ReportStudio.orderBySheets(students, { perStudent: {} }).map(s => s.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('the Templates tab draws each template with the real report and its sheet count, and marks the current one', () => {
      const f = ReportSheets.form();
      const thumbs = {
        'report-card': {
          html: '<span class="studio-tpl-side">x</span><span class="studio-tpl-side">y</span>',
          sheets: 1,
        },
        'interim-update': { html: '<span class="studio-tpl-side">x</span>', sheets: 1 },
        t1: { html: '<span class="studio-tpl-side">x</span>', sheets: 2 },
      };
      const html = ReportStudio.paletteHtml(f, 'templates', [{ id: 't1', name: 'Mine' }], null, null, thumbs);
      expect(html).toMatch(/class="studio-blk studio-tpl current"[^>]*data-starter="report-card"/);
      expect(html).toMatch(/data-starter="interim-update"[^>]*>(?!.*current)/);
      expect((html.match(/studio-tpl-side/g) || []).length).toBe(4);
      expect(html).toContain('Report Card</span><span class="studio-tpl-count">1 sheet</span>');
      expect(html).toContain('Mine</span><span class="studio-tpl-count">2 sheets</span>');
      // Without thumbs the cards still list the templates.
      const bare = ReportStudio.paletteHtml(f, 'templates', []);
      expect(bare).toContain('Conference Pack');
      expect(bare).not.toContain('studio-tpl-thumbs');
    });
  });

  describe('review fixes: the Templates tab', () => {
    it('marks a starter current only while the layout is as it came', () => {
      const f = ReportSheets.form();
      expect(ReportStudio.sameLayout(f, ReportSheets.starter('report-card'))).toBe(true);
      const edited = ReportSheets.removeCell(f, 'legend');
      expect(ReportStudio.sameLayout(edited, ReportSheets.starter('report-card'))).toBe(false);
      expect(ReportStudio.paletteHtml(edited, 'templates', [])).not.toContain('studio-tpl current');
      expect(ReportStudio.paletteHtml(f, 'templates', [])).toMatch(/studio-tpl current[^>]*data-starter="report-card"/);
    });
  });
});
