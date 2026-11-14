/**
 * Reports read grades through one entry, teacher/report-scores.js
 * (student page build plan 1.3, S2 and section 5, "A draft leaks to a
 * family"; S2-T1).
 *
 * 1. The source guard. No report file names one of the data layer's
 *    readers of scores, comments, notes, ticks or statuses, reaches into
 *    its cache, or switches the set of scores itself. Each reads through
 *    ReportScores. The functions each file runs inside withReportScores
 *    are pinned by name.
 * 2. The seam itself: the table, withReportScores, scoped, the readers.
 * 3. Behaviour, on Demo Mode's Science 8. Every score read made while a
 *    report surface is drawn happens inside withReportScores, and no
 *    function run there leaves work for later.
 * 4. The plan's test, ready for S2-F1 and S2-F2: with a surface's row set
 *    to 'returned' and drafts in the class, the report is exactly the
 *    report of a class that has only the returned grades, a draft's
 *    comment, note and tick are nowhere in it, and Print Grades and Export
 *    still give all work. The tests below start from every report row on
 *    'all' and turn the rows themselves (they load the seam's source with
 *    the rows edited, loadSeam), so they test the mechanism whatever the
 *    table says. What the table says is pinned on its own (S2-F1 turned
 *    Progress Reports and the rubric handout to 'returned').
 *
 * tests/report-surfaces-output.test.js holds what each surface prints today.
 */
import './setup.js';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { parse } from 'acorn';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';
import { freshGenerate, surfaceOf, surfaces } from './helpers/report-surfaces.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(ROOT, file), 'utf-8');
const SEAM = 'teacher/report-scores.js';
const SEAM_SOURCE = read(SEAM);

/* ── 1. The source guard ─────────────────────────────────────── */

/* A report file: anything in teacher/ named for a report, a comment, a
   printout or the export, and the student page's report view. A new one is
   guarded as soon as it is added. */
const REPORT_FILE = /^(page-reports|report-.*|comment-.*|grade-report|grades-print|rubric-print|export-all)\.js$/;
const REPORT_FILES = readdirSync(resolve(ROOT, 'teacher'))
  .filter(name => REPORT_FILE.test(name))
  .map(name => 'teacher/' + name)
  .filter(file => file !== SEAM)
  .concat(['shared/phone-report-view.js'])
  .sort();

/* The data layer's readers of a score, a status, a comment, a note, a tick
   or a DIBELS number (the list tests/calc-score-reader.test.js holds
   calc.js to), and the returned set's builders. */
const DATA_READERS = [
  'getScores',
  'getAssignmentStatuses',
  'getAssignmentStatus',
  'getPointsScore',
  'getCompletionMark',
  'getScoreComment',
  'getScoreReportNote',
  'getTagComment',
  'getRubricCriterionComment',
  'getRubricCriterionBeyond',
  'getDibelsScores',
  'getDibelsScore',
  'getRubricChecks',
  'getRubricCheckIds',
  'isRubricCheckOn',
  'hasScoreOrFeedback',
  'canSetAssignmentStatus',
  'isScoreLocked',
  'isGroupWithheld',
  'backToGroupGradeSource',
  '_rubricCriterionNoteFor',
  '_rubricCriterionCommentFor',
  '_getRubricCriterionNote',
  '_groupGradeHolder',
  '_holdsGroupCopy',
  'getReturnedScores',
  'getReturnedRubricCheckIds',
];
// calc.js's own switch and reader: only the seam turns a report to returned grades.
const SET_SWITCHES = ['withReturnedOnly', '_scoreSet', '_scoreRead'];
const FORBIDDEN = new Set(DATA_READERS.concat(SET_SWITCHES, ['_cache']));
// Where the data layer keeps scores, statuses and ticks on the device.
const STORED = /gb-(scores|statuses|rubric-checks)-/;
// Sorting the roster by name reads no score; by Missing or by grade it does.
const NAME_SORTS = ['lastName', 'firstName'];

function eachNode(node, visit, parent, grandparent) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent, grandparent);
  Object.keys(node).forEach(key => {
    const value = node[key];
    if (Array.isArray(value)) value.forEach(child => eachNode(child, visit, node, parent));
    else if (value && typeof value.type === 'string') eachNode(value, visit, node, parent);
  });
}

/* ReportScores' readers have the data layer's names, so that
   `ReportScores.getScoreComment(…)` is how a report file reads a comment.
   A name written that way is the seam's reader, not the data layer's. */
const isSeamReader = (node, parent) =>
  !!parent &&
  parent.type === 'MemberExpression' &&
  !parent.computed &&
  parent.property === node &&
  parent.object.type === 'Identifier' &&
  parent.object.name === 'ReportScores';

// A key in an object being made ({ getScores: … }) names nothing that is read.
const isKeyBeingMade = (node, parent, grandparent) =>
  !!parent &&
  parent.type === 'Property' &&
  !parent.computed &&
  parent.key === node &&
  parent.value !== node &&
  !!grandparent &&
  grandparent.type === 'ObjectExpression';

const isNameSort = arg =>
  !!arg &&
  ((arg.type === 'Literal' && NAME_SORTS.indexOf(arg.value) >= 0) ||
    (arg.type === 'ConditionalExpression' && isNameSort(arg.consequent) && isNameSort(arg.alternate)));

/* Every way a piece of source goes around the seam, counted by name:
   a forbidden name as an identifier, a property of anything but
   ReportScores, or a string (comments are not code and do not count), a
   stored-scores key, and a roster sort that is not by name. */
function aroundTheSeam(source) {
  const found = {};
  const add = what => (found[what] = (found[what] || 0) + 1);
  const sortCalls = new Set();
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  eachNode(ast, node => {
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      const name =
        callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' ? callee.property.name : '';
      if (name === 'sortStudents') {
        sortCalls.add(callee.type === 'Identifier' ? callee : callee.property);
        if (!isNameSort(node.arguments[1])) add('sortStudents (not by name)');
      }
    }
  });
  eachNode(ast, (node, parent, grandparent) => {
    if (node.type === 'Identifier') {
      if (FORBIDDEN.has(node.name) && !isSeamReader(node, parent) && !isKeyBeingMade(node, parent, grandparent))
        add(node.name);
      // sortStudents kept under another name, or handed on, could sort by anything.
      if (node.name === 'sortStudents' && !sortCalls.has(node)) add('sortStudents (not called)');
    }
    if (node.type === 'Literal' && typeof node.value === 'string') {
      if (FORBIDDEN.has(node.value)) add(node.value);
      if (STORED.test(node.value)) add('stored scores (' + node.value + ')');
    }
    if (node.type === 'TemplateElement' && STORED.test(node.value.raw)) add('stored scores (' + node.value.raw + ')');
  });
  return found;
}

/* The reads left outside the seam, each with its reason. Anything else
   fails. None is left: S2-F1 moved the last one (teacher/report-preview.js,
   whether the class has any score at all, for "No report data yet") to
   ReportScores.getScores. */
const LEFT_OUTSIDE = {};

/* The functions each file runs inside withReportScores, by surface: the
   lines `name = _inReportScores(name)` or `name = ReportScores.scoped(…)`
   at the top of the file, before anything can call or keep the function.
   `late` names any that is wrapped anywhere else: further down, or inside a
   function that might not have run yet. */
function doorsOf(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  const out = { surface: null, names: [], late: [] };
  let surfaceOfHelper = null;
  // The file's module: the first function called where it is written.
  let moduleBody = null;
  eachNode(ast, (node, parent) => {
    const called = parent && parent.type === 'CallExpression' && parent.callee === node;
    if (!moduleBody && called && /Function/.test(node.type)) moduleBody = node.body.body;
  });
  // Its first lines: 'use strict', the helper, and the wrapped functions, up to anything else.
  const firstLines = new Set();
  for (const statement of moduleBody || []) {
    const helper =
      statement.type === 'VariableDeclaration' && statement.declarations.every(d => d.id.name === '_inReportScores');
    const wraps = statement.type === 'ExpressionStatement' && statement.expression.type === 'AssignmentExpression';
    if (!statement.directive && !helper && !wraps) break;
    firstLines.add(statement);
  }
  const scopedSurface = call =>
    call &&
    call.type === 'CallExpression' &&
    call.callee.type === 'MemberExpression' &&
    call.callee.object.name === 'ReportScores' &&
    call.callee.property.name === 'scoped'
      ? call.arguments[0].value
      : null;
  eachNode(ast, node => {
    // The file's own helper: fn => ReportScores.scoped('surface', fn).
    if (node.type === 'VariableDeclarator' && node.id.name === '_inReportScores') {
      eachNode(node.init, inner => {
        if (scopedSurface(inner)) surfaceOfHelper = scopedSurface(inner);
      });
    }
  });
  eachNode(ast, (node, parent) => {
    if (node.type !== 'AssignmentExpression' || node.left.type !== 'Identifier') return;
    const call = node.right;
    if (!call || call.type !== 'CallExpression') return;
    const viaHelper = call.callee.type === 'Identifier' && call.callee.name === '_inReportScores';
    const surface = viaHelper ? surfaceOfHelper : scopedSurface(call);
    if (!surface) return;
    const arg = call.arguments[viaHelper ? 0 : 1];
    expect(arg && arg.name, 'a door wraps the function it is named for').toBe(node.left.name);
    expect(out.surface === null || out.surface === surface, 'one surface for each file').toBe(true);
    out.surface = surface;
    out.names.push(node.left.name);
    if (!firstLines.has(parent)) out.late.push(node.left.name);
  });
  return out;
}

const BLOCKS = [
  'renderReportBlock',
  'focusArea',
  'renderBlockHeader',
  'renderBlockAcademicSummary',
  'renderBlockLearnerDimensions',
  'renderBlockTeacherNarrative',
  'renderBlockCompetencyTable',
  'renderBlockObservations',
  'renderBlockSectionOutcomes',
  'renderBlockNextSteps',
  'renderBlockProgress',
  'renderBlockProficiency',
  'renderBlockLegend',
  'renderBlockParentResponse',
  'renderBlockStudentReflectionLearning',
  'renderBlockStudentReflectionHabits',
  'renderBlockSectionChart',
  'renderBlockScoreDistribution',
  'renderBlockCoreCompetencies',
  'renderBlockTermGlance',
  'renderBlockGrowth',
  'renderBlockAttendance',
  'renderBlockSelfAssessment',
];
const DOORS = {
  'teacher/report-blocks.js': { surface: 'progress', names: BLOCKS },
  'teacher/grade-report.js': {
    surface: 'progress',
    names: [
      'rows',
      'categorySummary',
      'feedbackItems',
      'extraCards',
      'listPart',
      'printedRows',
      '_summaryHtml',
      '_termHtml',
      '_feedbackPages',
    ],
  },
  // One Report draws its parts with the blocks' and grade-report.js's own
  // code; these are the functions the Reports page calls it through.
  'teacher/report-one.js': { surface: 'progress', names: ['partHtml', 'rowsOf', 'layoutStudent'] },
  'teacher/report-feedback.js': { surface: 'progress', names: ['forStudent'] },
  'teacher/page-reports.js': {
    surface: 'progress',
    names: ['renderReportPreview', 'renderStudioPanels', '_classSummary', '_draftsInPrint'],
  },
  'teacher/comment-bank.js': { surface: 'questionnaire', names: ['facts', 'compsOf', 'markedCounts'] },
  'teacher/report-questionnaire.js': {
    surface: 'questionnaire',
    names: ['headerGrade', 'notHandedIn', 'missingAndLate', '_basisHtml', '_requiredSource'],
  },
  'teacher/grades-print.js': { surface: 'printGrades', names: ['buildModel', 'cellText', 'columnAverageText'] },
  'teacher/export-all.js': { surface: 'exportData', names: ['rows'] },
  /* The rubric handout's doors (S2-F1): what prints and its preview, who
     prints, the dialog's list and Already Printed box, who the question
     asks about, what a print records, and the Printed marks. Not the
     helpers that read one sheet: they read in their caller's set (a
     Feedback Page's, or the Rubric Bank's all-work Delete Rubric count). */
  'teacher/rubric-print.js': {
    surface: 'handout',
    names: [
      'renderPages',
      'selectStudents',
      '_studentsGroupHtml',
      '_printedSummaryText',
      '_mayPrint',
      'markPrinted',
      '_markState',
    ],
  },
};

describe('report files read scores only through ReportScores', () => {
  it('covers the report files S2 names, and their neighbours', () => {
    [
      'teacher/page-reports.js',
      'teacher/report-blocks.js',
      'teacher/report-questionnaire.js',
      'teacher/comment-bank.js',
      'teacher/grade-report.js',
      'teacher/report-feedback.js',
      'teacher/rubric-print.js',
      'teacher/grades-print.js',
      'teacher/export-all.js',
      'teacher/report-preview.js',
      'teacher/report-sheets.js',
      'teacher/report-issues.js',
      'teacher/report-feedback-cards.js',
      'teacher/comment-personal.js',
      'shared/phone-report-view.js',
    ].forEach(file => expect(REPORT_FILES, file).toContain(file));
    expect(REPORT_FILES).not.toContain(SEAM);
  });

  it.each(REPORT_FILES)('%s names no reader of scores, comments, notes, ticks or statuses', file => {
    expect(aroundTheSeam(read(file))).toEqual(LEFT_OUTSIDE[file] || {});
  });

  it('keeps Print Grades and Export on all work', () => {
    // Plan 1.3: Print Grades and Export use all work (the artboard). A PR
    // that changes either row changes this test, and says why.
    expect(ReportScores.reportScoreSet('exportData')).toBe('all');
    expect(ReportScores.reportScoreSet('printGrades')).toBe('all');
    expect(SEAM_SOURCE).toMatch(/\n\s*printGrades: 'all',/);
    expect(SEAM_SOURCE).toMatch(/\n\s*exportData: 'all',/);
  });

  it('the guard sees each way around the seam, and no way through a comment', () => {
    const caught = source => Object.keys(aroundTheSeam(source));
    expect(caught('var all = getScores(cid)[sid] || [];')).toEqual(['getScores']);
    expect(caught('var s = getAssignmentStatus(cid, sid, aid);')).toEqual(['getAssignmentStatus']);
    expect(caught('var s = typeof getScoreReportNote === "function" ? 1 : 0;')).toEqual(['getScoreReportNote']);
    expect(caught('var read = window.getScoreComment;')).toEqual(['getScoreComment']);
    expect(caught('var c = dataLayer.getScoreComment(cid, sid, aid);')).toEqual(['getScoreComment']);
    expect(caught('var c = ReportScores["getScoreComment"](cid, sid, aid);')).toEqual(['getScoreComment']);
    expect(caught('var readers = { note: getScoreReportNote };')).toEqual(['getScoreReportNote']);
    expect(caught('var { getTagComment } = window;')).toEqual(['getTagComment']);
    expect(caught('var read = window["getRubricCheckIds"];')).toEqual(['getRubricCheckIds']);
    expect(caught('var { getPointsScore: read } = window;')).toEqual(['getPointsScore']);
    expect(caught('var x = _cache.scores[cid];')).toEqual(['_cache']);
    expect(caught('var x = JSON.parse(localStorage.getItem("gb-scores-" + cid));')).toEqual([
      'stored scores (gb-scores-)',
    ]);
    expect(caught('var x = localStorage.getItem(`gb-rubric-checks-${cid}`);')).toEqual([
      'stored scores (gb-rubric-checks-)',
    ]);
    expect(caught('withReturnedOnly(function () { return draw(); });')).toEqual(['withReturnedOnly']);
    expect(caught('if (_scoreSet === "returned") draw();')).toEqual(['_scoreSet']);
    expect(caught('var list = sortStudents(getStudents(cid), "missing", cid);')).toEqual([
      'sortStudents (not by name)',
    ]);
    expect(caught('var list = sortStudents(getStudents(cid), mode, cid);')).toEqual(['sortStudents (not by name)']);
    expect(caught('var sort = sortStudents;')).toEqual(['sortStudents (not called)']);
    // What a report file may write.
    expect(caught('var list = sortStudents(getStudents(cid), "lastName");')).toEqual([]);
    expect(caught('var list = sortStudents(getStudents(cid), first ? "firstName" : "lastName");')).toEqual([]);
    expect(
      caught('var all = ReportScores.entries(cid, sid); var s = ReportScores.getAssignmentStatus(cid, sid, aid);'),
    ).toEqual([]);
    expect(caught('var c = ReportScores.getScoreComment(cid, sid, aid) || ReportScores.getScores(cid)[sid];')).toEqual(
      [],
    );
    expect(caught('var api = { getScores: scores, getScoreComment: comment };')).toEqual([]);
    expect(caught('/* getScores(cid) is read through ReportScores */ var x = 1; // getAssignmentStatus')).toEqual([]);
  });

  it('the seam is the only file that names the returned set or turns a report to returned grades', () => {
    const named = aroundTheSeam(SEAM_SOURCE);
    // Built on these, and nothing else of the data layer's.
    expect(Object.keys(named).sort()).toEqual(
      [
        '_scoreSet',
        'getAssignmentStatuses',
        'getCompletionMark',
        'getPointsScore',
        'getReturnedRubricCheckIds',
        'getReturnedScores',
        'getRubricCheckIds',
        'getRubricCriterionBeyond',
        'getRubricCriterionComment',
        'getScoreComment',
        'getScoreReportNote',
        'getScores',
        'getTagComment',
        'withReturnedOnly',
      ].sort(),
    );
    expect(named.withReturnedOnly).toBe(1);
    expect(named.getScores).toBe(1);
  });

  it.each(Object.keys(DOORS))('%s runs these functions inside withReportScores, from its first lines', file => {
    const doors = doorsOf(read(file));
    expect(doors.surface).toBe(DOORS[file].surface);
    expect(doors.names).toEqual(DOORS[file].names);
    expect(doors.late).toEqual([]);
  });

  it('sees a function wrapped too late to count', () => {
    const file = wrapping =>
      "window.X = (function () {\n  'use strict';\n" +
      wrapping +
      '\n  function draw() {}\n  return { draw: draw };\n})();';
    const first = "  draw = ReportScores.scoped('progress', draw);";
    expect(doorsOf(file(first))).toEqual({ surface: 'progress', names: ['draw'], late: [] });
    const helper =
      "  var _inReportScores = function (fn) {\n    return ReportScores.scoped('questionnaire', fn);\n  };\n";
    expect(doorsOf(file(helper + '  draw = _inReportScores(draw);'))).toEqual({
      surface: 'questionnaire',
      names: ['draw'],
      late: [],
    });
    // After something else has run, or inside a function, the function may already be kept unwrapped.
    expect(doorsOf(file('  var kept = draw;\n' + first)).late).toEqual(['draw']);
    expect(doorsOf(file('  function later() {\n  ' + first + '\n  }\n  later();')).late).toEqual(['draw']);
    expect(doorsOf(file('  if (window.fast) {\n  ' + first + '\n  }')).late).toEqual(['draw']);
  });

  it('no other report file has functions of its own to run there', () => {
    REPORT_FILES.filter(file => !DOORS[file]).forEach(file => {
      expect(doorsOf(read(file)).names, file).toEqual([]);
    });
  });

  it('every block renderer report-blocks.js gives out is one of them', () => {
    const given = Object.keys(ReportBlocks).filter(name => /^renderBlock|^renderReportBlock$|^focusArea$/.test(name));
    expect(given.length).toBeGreaterThan(20);
    expect(given.filter(name => BLOCKS.indexOf(name) < 0)).toEqual([]);
  });

  /* What a report keeps to draw faster holds the set of scores in its key,
     so a level or a page read from one set is never given to the other. */
  it.each([
    ['teacher/report-blocks.js', '_passCache', "key = ReportScores.setInUse() + '#' + key;"],
    [
      'teacher/report-questionnaire.js',
      '_factsCache',
      "var key = _activeCourse + '|' + student.id + '|' + getTermId() + '|' + _scoreSetKey();",
    ],
    [
      'teacher/report-questionnaire.js',
      '_staleCache',
      "var key = cid + '|' + student.id + '|' + termId + '|' + _scoreSetKey();",
    ],
    ['teacher/report-questionnaire.js', '_claimCache (read)', "var hit = _claimCache[key + '|' + _scoreSetKey()];"],
    [
      'teacher/report-questionnaire.js',
      '_claimCache (kept)',
      "_claimCache[key + '|' + _scoreSetKey()] = { sig: sig, v: v };",
    ],
    ['teacher/report-questionnaire.js', '_shared', "var key = cid + '|' + termId + '|' + _scoreSetKey();"],
    [
      'teacher/report-questionnaire.js',
      'the set in those keys',
      "return ReportScores.reportScoreSet('questionnaire');",
    ],
    [
      'teacher/page-reports.js',
      '_classFit',
      "return [activeCourse, ctx.termId, reportPaper, form, _reportSet(), _day()].join('|');",
    ],
    ['teacher/page-reports.js', '_lastSummary (kept)', '_lastSummary = summary;\n    _lastSummarySet = _reportSet();'],
    [
      'teacher/page-reports.js',
      '_lastSummary (read)',
      'var s = (_lastSummarySet === _reportSet() && _lastSummary) || {',
    ],
    ['teacher/page-reports.js', 'the set in those keys', "return ReportScores.reportScoreSet('progress');"],
  ])('%s keys %s by the set of scores', (file, what, text) => {
    expect(read(file)).toContain(text);
  });

  it('every surface a file names is in the one table', () => {
    const named = Object.keys(DOORS).map(file => DOORS[file].surface);
    // 'grader' is named by the grader, not a report file: the Note for the Report's preview (S2-F2).
    expect(ReportScores.surfaces().slice().sort()).toEqual(Array.from(new Set(named.concat(['grader']))).sort());
    expect(read('teacher/page-assignments.js')).toContain("ReportScores.withReportScores('grader', function () {");
  });
});

/* ── Loading the seam with a row changed, as S2-F1 will change it ── */

/* The report rows the tests below start from: every one on all work, so
   they test the mechanism, not the table (which is pinned on its own). */
const REPORT_ROWS = ['progress', 'handout', 'questionnaire'];
const ALL_WORK = Object.fromEntries(REPORT_ROWS.map(surface => [surface, 'all']));

/* The seam's source with every report row on all work and then these
   surfaces' rows set ({ progress: 'returned' }), run in place of the one
   loaded. With no rows, every row on all work. loadSeam(null, true) runs
   the seam as it is written. */
function loadSeam(rows, asWritten) {
  let source = SEAM_SOURCE;
  Object.keys(Object.assign({}, asWritten ? {} : ALL_WORK, rows || {})).forEach(surface => {
    const row = new RegExp('(\\n\\s*' + surface + ": )'(all|returned)',");
    expect(row.test(source), surface + ' has a row in the table').toBe(true);
    source = source.replace(row, "$1'" + Object.assign({}, asWritten ? {} : ALL_WORK, rows)[surface] + "',");
  });
  runInThisContext(source, { filename: SEAM });
}
const REPORTS_ON_RETURNED = {
  progress: 'returned',
  handout: 'returned',
  questionnaire: 'returned',
};

/* ── 2. The seam itself ──────────────────────────────────────── */

describe('ReportScores', () => {
  beforeAll(() => loadSeam());
  afterAll(() => loadSeam(null, true));
  afterEach(() => {
    loadSeam();
    delete globalThis.getReturnedScores;
    delete globalThis.getReturnedRubricCheckIds;
    _scoreSet = 'all';
  });

  it('puts every surface on all work when every report row is on all work', () => {
    expect(ReportScores.surfaces()).toEqual([
      'progress',
      'handout',
      'questionnaire',
      'grader',
      'printGrades',
      'exportData',
    ]);
    ReportScores.surfaces().forEach(surface => expect(ReportScores.reportScoreSet(surface), surface).toBe('all'));
  });

  it('the table as written: what a family or a student reads on returned grades (S2-F1, S2-F2), the teacher’s own on all work', () => {
    loadSeam(null, true);
    expect(
      Object.fromEntries(ReportScores.surfaces().map(surface => [surface, ReportScores.reportScoreSet(surface)])),
    ).toEqual({
      progress: 'returned',
      handout: 'returned',
      questionnaire: 'returned',
      grader: 'all',
      printGrades: 'all',
      exportData: 'all',
    });
  });

  it('refuses a surface that is not in the table, when it is named and when it is run', () => {
    expect(() => ReportScores.reportScoreSet('gradebook')).toThrow(/not a report surface/);
    expect(() => ReportScores.withReportScores('gradebook', () => 1)).toThrow(/not a report surface/);
    expect(() => ReportScores.scoped('gradebook', () => 1)).toThrow(/not a report surface/);
  });

  it('withReportScores runs the function, gives back what it returns, and says which surface is running', () => {
    expect(ReportScores.running()).toBe(null);
    const got = ReportScores.withReportScores('progress', () => ({ running: ReportScores.running(), set: _scoreSet }));
    expect(got).toEqual({ running: 'progress', set: 'all' });
    expect(ReportScores.running()).toBe(null);
  });

  it('lets go of the surface when the function throws', () => {
    expect(() =>
      ReportScores.withReportScores('progress', () => {
        throw new Error('a block failed');
      }),
    ).toThrow('a block failed');
    expect(ReportScores.running()).toBe(null);
  });

  it('the outermost surface decides: a report drawn inside another takes its set', () => {
    const seen = ReportScores.withReportScores('questionnaire', () =>
      ReportScores.withReportScores('progress', () => ReportScores.running()),
    );
    expect(seen).toBe('questionnaire');
  });

  it('scoped keeps the arguments, `this` and the result', () => {
    const owner = {
      base: 10,
      add: ReportScores.scoped('questionnaire', function (a, b) {
        return { sum: this.base + a + b, running: ReportScores.running(), count: arguments.length };
      }),
    };
    expect(owner.add(1, 2)).toEqual({ sum: 13, running: 'questionnaire', count: 2 });
    expect(ReportScores.running()).toBe(null);
  });

  it('follows the set calc.js is using: inside withReturnedOnly everything here is returned grades', () => {
    globalThis.getReturnedScores = () => ({ s1: [{ assessmentId: 'a1', tagId: 't', score: 4, note: 'Returned.' }] });
    expect(ReportScores.setInUse()).toBe('all');
    const inside = withReturnedOnly(() => ({
      set: ReportScores.setInUse(),
      // A surface on all work is never given all work inside returned grades.
      surface: ReportScores.reportScoreSet('printGrades'),
      nested: ReportScores.withReportScores('printGrades', () => _scoreSet),
      entries: ReportScores.entries('c', 's1'),
      comment: ReportScores.getScoreComment('c', 's1', 'a1'),
    }));
    expect(inside.set).toBe('returned');
    expect(inside.surface).toBe('returned');
    expect(inside.nested).toBe('returned');
    expect(inside.entries).toHaveLength(1);
    expect(inside.comment).toBe('Returned.');
    expect(ReportScores.setInUse()).toBe('all');
  });

  describe('with a surface’s row set to returned', () => {
    it('runs that surface’s reports in returned grades and leaves the others on all work', () => {
      loadSeam({ progress: 'returned' });
      globalThis.getReturnedScores = () => ({});
      expect(ReportScores.reportScoreSet('progress')).toBe('returned');
      expect(ReportScores.reportScoreSet('questionnaire')).toBe('all');
      expect(ReportScores.withReportScores('progress', () => [_scoreSet, ReportScores.setInUse()])).toEqual([
        'returned',
        'returned',
      ]);
      expect(ReportScores.withReportScores('questionnaire', () => _scoreSet)).toBe('all');
      expect(_scoreSet).toBe('all');
      // A function wrapped before the row changed follows the row as it is now.
      const scopedBefore = ReportScores.scoped('progress', () => _scoreSet);
      loadSeam();
      expect(scopedBefore()).toBe('all');
      loadSeam({ progress: 'returned' });
      expect(scopedBefore()).toBe('returned');
    });

    it('a report drawn inside an all-work surface stays on all work, and inside a returned one on returned', () => {
      loadSeam({ progress: 'returned' });
      globalThis.getReturnedScores = () => ({});
      // Print Grades calling a block: the class sheet stays the teacher's.
      expect(
        ReportScores.withReportScores('printGrades', () =>
          ReportScores.withReportScores('progress', () => [_scoreSet, ReportScores.reportScoreSet('progress')]),
        ),
      ).toEqual(['all', 'all']);
      // The questionnaire (all work here) drawn inside a Progress Report takes the report's set.
      expect(
        ReportScores.withReportScores('progress', () =>
          ReportScores.withReportScores('questionnaire', () => _scoreSet),
        ),
      ).toBe('returned');
    });

    it('refuses a report that leaves work for later, as calc.js does', () => {
      loadSeam({ progress: 'returned' });
      expect(() => ReportScores.withReportScores('progress', async () => 1)).toThrow(/does not finish at once/);
      expect(ReportScores.running()).toBe(null);
      expect(_scoreSet).toBe('all');
    });

    it('fails closed: with nothing to give the returned set, a read stops with an error', () => {
      loadSeam({ progress: 'returned' });
      const draw = () => ReportScores.withReportScores('progress', () => ReportScores.entries('c', 's1'));
      expect(draw).toThrow(/nothing loaded here can give them/);
      globalThis.getReturnedScores = () => null;
      expect(draw).toThrow(/not a set of scores/);
      globalThis.getReturnedScores = () => [];
      expect(draw).toThrow(/not a set of scores/);
      globalThis.getReturnedScores = () => ({ s1: 'x' });
      expect(draw).toThrow(/not a set of scores/);
      globalThis.getReturnedScores = () => Promise.resolve({});
      expect(draw).toThrow(/not a set of scores/);
      globalThis.getReturnedScores = () => ({});
      // A student who is not in the set has no returned grade.
      expect(draw()).toEqual([]);
      expect(ReportScores.running()).toBe(null);
    });

    it('checklist ticks have no returned reader yet: on returned grades they stop with an error, never the draft ticks', () => {
      loadSeam({ progress: 'returned' });
      globalThis.getReturnedScores = () => ({});
      const ticks = () =>
        ReportScores.withReportScores('progress', () => ReportScores.getRubricCheckIds('c', 's1', 'a1'));
      expect(ticks).toThrow(/returned checklist ticks/);
      globalThis.getReturnedRubricCheckIds = (cid, sid, aid) => [cid, sid, aid];
      expect(ticks()).toEqual(['c', 's1', 'a1']);
    });
  });
});

/* ── 3 and 4. Behaviour, on the Demo class ───────────────────── */

/* The calc.js functions that read no score: they format a number they are
   given, read a setting or the report's term, or do arithmetic on what is
   passed in. A report file may call them anywhere. Every other function
   calc.js gives out is taken to read grades, and a report file calls it
   only inside withReportScores; a new one is watched until it is listed
   here. */
const NO_SCORE = new Set([
  // The class's grading style: Proficiency, Letter or Both (a setting).
  'courseGradeMode',
  // A level it is given, as the class shows it.
  'formatLevel',
  // A level it is given, as its proficiency word.
  'levelWord',
  // The report's term: which one is in view, and putting one in view (the Reports page).
  'getActiveTerm',
  'setActiveTerm',
  // A level, %, or points figure it is given, as calc.js prints and reads it.
  'printedLevel',
  'roundLevel',
  'wholePercent',
  'oneDecimal',
  'nearestScoreLevelName',
  // A level it is given, as a student reads it (calc.js; DECISIONS, "Student-facing levels are proficiencies").
  'studentLevelText',
  'studentMarkText',
  'studentLevelChange',
  'studentGroupGradeText',
  'studentLevelBarPercent',
  'studentLevelStep',
]);

// Each drawing of the class takes a few seconds; a slow runner gets a minute.
describe('report surfaces on the Demo class', { timeout: 60000 }, () => {
  const REPORTS = ['progress', 'quick', 'questionnaire'];
  const TEACHERS = ['printGrades', 'export'];
  let cid;
  let working; // the teacher's working copy, drafts and all
  let ticks;
  let wasDemo;

  // Lets a render's kept levels go (report-blocks.js keeps them until the task ends).
  const settle = () => new Promise(done => setTimeout(done, 0));

  // Every surface, drawn from a clean start.
  async function draw(only) {
    await settle();
    clearProfCache();
    freshGenerate();
    return surfaces(cid, only, { handout: false });
  }

  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    loadSeam();
    cid = loadDemoClass();
    setActiveTerm(cid, null);
    working = structuredClone(getScores(cid));
    ticks = structuredClone(getRubricChecks(cid));
  });

  const reset = () => {
    loadSeam();
    delete globalThis.getReturnedScores;
    delete globalThis.getReturnedRubricCheckIds;
    _cache.scores[cid] = structuredClone(working);
    _cache.rubricChecks[cid] = structuredClone(ticks);
    _scoreSet = 'all';
    clearProfCache();
  };
  afterEach(reset);

  afterAll(() => {
    loadSeam(null, true);
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  /* Runs `fn` and gives back every read of the class's scores, statuses or
     ticks made while no report surface was running: "reader at file:line". */
  function readsOutsideTheSeam(fn) {
    const names = ['getScores', 'getAssignmentStatuses', 'getRubricChecks'];
    const kept = {};
    const outside = new Set();
    let inside = 0;
    names.forEach(name => {
      kept[name] = globalThis[name];
      globalThis[name] = function () {
        if (ReportScores.running() === null) {
          const frame = (new Error().stack || '').split('\n').find(line => /teacher\/[a-z-]+\.js/.test(line)) || '';
          outside.add(name + ' at ' + ((frame.match(/teacher\/[a-z-]+\.js:\d+/) || [])[0] || 'unknown'));
        } else inside++;
        return kept[name].apply(this, arguments);
      };
    });
    try {
      fn();
    } finally {
      names.forEach(name => (globalThis[name] = kept[name]));
    }
    return { outside: Array.from(outside).sort(), inside };
  }

  /* calc.js keeps what it has worked out, so a grade asked for twice is read
     once: a read outside the seam can hide behind an earlier one. This
     watches the asking instead. Runs `fn` and gives back every call a
     report file made to calc.js for a grade while no report surface was
     running: "function from file:line". */
  function gradesAskedOutsideTheSeam(fn) {
    const names = Object.keys(Calc).filter(name => typeof globalThis[name] === 'function' && !NO_SCORE.has(name));
    const kept = {};
    const outside = new Set();
    let inside = 0;
    names.forEach(name => {
      kept[name] = globalThis[name];
      globalThis[name] = function () {
        if (ReportScores.running() !== null) inside++;
        else {
          // The line that called calc.js: the frame above this one.
          const caller = ((new Error().stack || '').split('\n')[2] || '').match(/(teacher|shared)\/[a-z-]+\.js:\d+/);
          if (caller && REPORT_FILES.indexOf(caller[0].split(':')[0]) >= 0) outside.add(name + ' from ' + caller[0]);
        }
        return kept[name].apply(this, arguments);
      };
    });
    try {
      fn();
    } finally {
      names.forEach(name => (globalThis[name] = kept[name]));
    }
    return { outside: Array.from(outside).sort(), inside, watched: names.length };
  }

  it('the spy sees a read made outside the seam', () => {
    const student = getStudents(cid)[0];
    const bare = readsOutsideTheSeam(() => getOverallProficiency(cid, student.id));
    clearProfCache();
    const inSeam = readsOutsideTheSeam(() =>
      ReportScores.withReportScores('progress', () => getOverallProficiency(cid, student.id)),
    );
    expect(bare.outside.length).toBeGreaterThan(0);
    expect(inSeam.outside).toEqual([]);
    expect(inSeam.inside).toBeGreaterThan(0);
    // One rubric sheet asked for on its own is a helper: it reads where it is called (here, outside every surface).
    const lab = getAssessments(cid).find(a => a.rubricId);
    const sheet = readsOutsideTheSeam(() => RubricPrint.sheetData(cid, lab.id, student.id));
    expect(sheet.outside.join(' ')).toContain('teacher/rubric-print.js');
    // The handout as Print Rubrics draws it is a report surface of its own (S2-F1): its reads are inside.
    const opts = Object.assign({}, RubricPrint.DEFAULT_OPTIONS, { mode: 'completed', students: 'all', layout: 'full' });
    const handout = readsOutsideTheSeam(() => RubricPrint.renderPages(cid, lab.id, opts));
    expect(handout.outside).toEqual([]);
    expect(handout.inside).toBeGreaterThan(0);
  });

  /* One drawing of every surface with all three spies on: the reads, the
     asks of calc.js, and the functions run inside withReportScores. */
  let spied = null;
  async function spiedDraw() {
    if (spied) return spied;
    await settle();
    // No cache is left to hide a read: and a grade calc.js already holds is still a grade asked for.
    clearProfCache();
    freshGenerate();
    const real = ReportScores.withReportScores;
    const later = [];
    let runs = 0;
    ReportScores.withReportScores = function (surface, fn) {
      const result = real.call(this, surface, fn);
      runs++;
      if (result && typeof result.then === 'function') later.push(surface);
      return result;
    };
    const found = {};
    try {
      found.reads = readsOutsideTheSeam(() => {
        found.asked = gradesAskedOutsideTheSeam(() => surfaces(cid, null, { handout: false }));
      });
    } finally {
      ReportScores.withReportScores = real;
    }
    found.later = later;
    found.runs = runs;
    spied = found;
    return spied;
  }

  it('every score, status and tick read while a surface is drawn is made inside withReportScores', async () => {
    const { reads } = await spiedDraw();
    expect(reads.outside).toEqual([]);
    // And there were reads to see: the reports were drawn from scores.
    expect(reads.inside).toBeGreaterThan(1000);
  });

  it('every grade a report file asks calc.js for while a surface is drawn is asked for inside withReportScores', async () => {
    const { asked } = await spiedDraw();
    expect(asked.outside).toEqual([]);
    expect(asked.inside).toBeGreaterThan(1000);
    expect(asked.watched).toBeGreaterThan(60);
    // It sees one: a single rubric sheet asked for outside every surface (a helper reads in its caller's set).
    const lab = getAssessments(cid).find(a => a.rubricId);
    const scored = getStudents(cid).find(s => getAssessmentOverallScore(cid, s.id, lab.id) > 0);
    const sheet = gradesAskedOutsideTheSeam(() => RubricPrint.sheetData(cid, lab.id, scored.id));
    expect(sheet.outside.join(' ')).toContain('getAssessmentOverallScore from teacher/rubric-print.js');
    // The handout as Print Rubrics draws it asks inside its own surface (S2-F1).
    const opts = Object.assign({}, RubricPrint.DEFAULT_OPTIONS, { mode: 'completed', students: 'all', layout: 'full' });
    const handout = gradesAskedOutsideTheSeam(() => RubricPrint.renderPages(cid, lab.id, opts));
    expect(handout.outside).toEqual([]);
    expect(handout.inside).toBeGreaterThan(0);
  });

  it('no function run inside withReportScores leaves work for later (S2-F1 would refuse it)', async () => {
    const { later, runs } = await spiedDraw();
    expect(later).toEqual([]);
    expect(runs).toBeGreaterThan(1000);
  });

  /* The class with drafts.
     Never returned: for every second student everything dated after July,
     and for every student the last two pieces of the year. One of those
     students' labs (an Advanced Rubric) also has a draft Overall Comment,
     criterion comment, Note for the Report and tick.
     Changed since they were returned: another student's quiz, their
     Complete/Incomplete piece and their lab. The working copy holds the
     new score, comment and ticks; the returned set holds what the student
     was given. */
  function classWithDrafts() {
    const assessments = getAssessments(cid);
    const late = new Set(assessments.filter(a => a.date > '2026-10-28').map(a => a.id));
    const afterJuly = new Set(assessments.filter(a => a.date > '2026-07-31').map(a => a.id));
    expect(late.size).toBeGreaterThan(0);
    expect(afterJuly.size).toBeGreaterThan(late.size);
    const drafts = {};
    getStudents(cid).forEach((s, i) => (drafts[s.id] = i % 2 ? afterJuly : late));
    // The marked draft: a rubric piece dated after July, for a student whose later work is all draft.
    const student = getStudents(cid).find(
      (s, i) => i % 2 && (working[s.id] || []).some(e => afterJuly.has(e.assessmentId)),
    );
    const advanced = a => !!a.rubricId && rubricStyle(getRubricById(cid, a.rubricId)) === 'advanced';
    const lab = assessments.find(
      a =>
        advanced(a) &&
        afterJuly.has(a.id) &&
        (working[student.id] || []).some(e => e.assessmentId === a.id && e.score > 0),
    );
    expect(lab, 'a scored Advanced Rubric piece among the drafts').toBeTruthy();
    const scores = structuredClone(working);
    scores[student.id].forEach(e => {
      if (e.assessmentId !== lab.id) return;
      e.note = 'ZZDRAFT overall comment.';
      e.critNote = 'ZZDRAFT criterion comment.';
      e.reportNote = 'ZZDRAFT note for the report';
    });
    const rubric = getRubricById(cid, lab.rubricId);
    const checks = structuredClone(ticks);
    const someCheck = (rubric.criteria || []).flatMap(c => c.checks || [])[0];
    expect(someCheck, 'the lab has checkboxes').toBeTruthy();
    checks[student.id + ':' + lab.id] = [someCheck.id];
    // What students have been given: the working copy without the drafts.
    const returned = {};
    Object.keys(scores).forEach(sid => {
      returned[sid] = structuredClone(scores[sid]).filter(e => !(drafts[sid] && drafts[sid].has(e.assessmentId)));
    });
    const returnedTicks = {};
    Object.keys(checks).forEach(key => {
      const [sid, aid] = key.split(':');
      if (!(drafts[sid] && drafts[sid].has(aid))) returnedTicks[key] = checks[key];
    });
    // Changed since they were returned.
    const other = getStudents(cid).find((s, i) => !(i % 2));
    const given = a =>
      !late.has(a.id) &&
      (returned[other.id] || []).some(e => e.assessmentId === a.id && e.score != null && e.score !== '');
    const quiz = assessments.find(a => isPointsScored(a) && !isCompletionScored(a) && given(a));
    const check = assessments.find(a => isCompletionScored(a) && given(a));
    const lab2 = assessments.find(a => advanced(a) && given(a));
    expect(quiz && check && lab2, 'a returned quiz, Complete/Incomplete piece and lab').toBeTruthy();
    const change = (a, now, was) => {
      scores[other.id].filter(e => e.assessmentId === a.id).forEach(now);
      returned[other.id].filter(e => e.assessmentId === a.id).forEach(was);
    };
    change(
      quiz,
      e => Object.assign(e, { score: Number(e.score) > 0 ? 0 : 1, note: 'ZZDRAFT changed quiz comment.' }),
      e => Object.assign(e, { note: 'Returned quiz comment.' }),
    );
    change(
      check,
      e => Object.assign(e, { score: Number(e.score) > 0 ? 0 : 1, note: 'ZZDRAFT changed check comment.' }),
      e => Object.assign(e, { note: 'Returned check comment.' }),
    );
    change(
      lab2,
      e => Object.assign(e, { score: e.score >= 4 ? 2 : 4, critNote: 'ZZDRAFT changed criterion comment.' }),
      e => Object.assign(e, { critNote: 'Returned criterion comment.' }),
    );
    const key2 = other.id + ':' + lab2.id;
    const was = (checks[key2] || []).slice();
    const every = (getRubricById(cid, lab2.rubricId).criteria || []).flatMap(c => (c.checks || []).map(x => x.id));
    returnedTicks[key2] = was;
    // The draft ticks are the ones that were not ticked before.
    checks[key2] = every.filter(id => was.indexOf(id) < 0);
    expect(checks[key2].length && was.length, 'ticks before and after').toBeTruthy();
    return { scores, checks, returned, returnedTicks, student, lab, tick: someCheck, other, quiz, check, lab2 };
  }

  /* The class with drafts, drawn once for the tests below: on all work, with
     the reports' rows on returned, and as a class whose working copy is the
     returned grades. */
  let drafts;
  let drawn;
  beforeAll(async () => {
    const c = classWithDrafts();
    // All work, as every surface is today.
    _cache.scores[cid] = structuredClone(c.scores);
    _cache.rubricChecks[cid] = structuredClone(c.checks);
    const allWork = await draw();

    // The rows turned, as S2-F1 and S2-F2 will turn them; the class unchanged.
    loadSeam(REPORTS_ON_RETURNED);
    globalThis.getReturnedScores = () => c.returned;
    globalThis.getReturnedRubricCheckIds = (id, sid, aid) => (c.returnedTicks[sid + ':' + aid] || []).slice();
    const onReturned = await draw();

    // A class whose working copy is the returned grades, on all work.
    loadSeam();
    delete globalThis.getReturnedScores;
    delete globalThis.getReturnedRubricCheckIds;
    _cache.scores[cid] = structuredClone(c.returned);
    _cache.rubricChecks[cid] = structuredClone(c.returnedTicks);
    const returnedClass = await draw();
    drafts = c;
    drawn = { allWork, onReturned, returnedClass };
    reset();
  }, 120000);

  it('with the reports’ rows on returned, each report is the report of a class that has only the returned grades', () => {
    const { allWork, onReturned, returnedClass } = drawn;
    const keys = Object.keys(allWork);
    expect(Object.keys(onReturned)).toEqual(keys);
    expect(Object.keys(returnedClass)).toEqual(keys);
    const of = names => keys.filter(k => names.indexOf(surfaceOf(k)) >= 0);

    // Every report surface, part for part: nothing in it came from a draft.
    const leaked = of(REPORTS).filter(k => onReturned[k] !== returnedClass[k]);
    expect(leaked).toEqual([]);
    // The drafts matter in this class: all work prints something else.
    const moved = of(REPORTS).filter(k => onReturned[k] !== allWork[k]);
    REPORTS.forEach(surface => expect(moved.filter(k => surfaceOf(k) === surface).length, surface).toBeGreaterThan(0));

    // Print Grades and Export stay on all work: the same with the rows turned.
    expect(of(TEACHERS).filter(k => onReturned[k] !== allWork[k])).toEqual([]);
    expect(of(TEACHERS).filter(k => onReturned[k] !== returnedClass[k]).length).toBeGreaterThan(0);
  });

  it('a draft’s comment, note and tick are nowhere in a report on returned grades, and still in the teacher’s own', () => {
    const c = drafts;
    const holding = (drawn, names, needle) =>
      Object.keys(drawn).filter(k => names.indexOf(surfaceOf(k)) >= 0 && drawn[k].indexOf(needle) >= 0);

    // On all work the draft is on the reports: the test has something to find.
    const { allWork, onReturned } = drawn;
    expect(holding(allWork, ['quick'], 'ZZDRAFT overall comment.').length).toBeGreaterThan(0);
    expect(holding(allWork, ['quick'], 'ZZDRAFT criterion comment.').length).toBeGreaterThan(0);
    expect(holding(allWork, ['questionnaire'], 'ZZDRAFT note for the report').length).toBeGreaterThan(0);
    expect(holding(allWork, ['quick'], 'ZZDRAFT changed quiz comment.').length).toBeGreaterThan(0);
    expect(holding(allWork, ['quick'], 'ZZDRAFT changed check comment.').length).toBeGreaterThan(0);
    expect(holding(allWork, ['quick'], 'ZZDRAFT changed criterion comment.').length).toBeGreaterThan(0);
    // The ticks on a Feedback Page's card, as ids.
    const ticksOn = (drawn, sid, aid) =>
      JSON.parse(drawn['year › quick › ' + sid])
        .feedback.filter(item => item.id === aid)
        .flatMap(item => item.rubric.rows)
        .flatMap(row => Object.values(row.checks || {}).flat())
        .filter(x => x.ticked)
        .map(x => x.id)
        .sort();
    expect(ticksOn(allWork, c.student.id, c.lab.id)).toEqual([c.tick.id]);
    expect(ticksOn(allWork, c.other.id, c.lab2.id)).toEqual(c.checks[c.other.id + ':' + c.lab2.id].slice().sort());

    expect(holding(onReturned, REPORTS, 'ZZDRAFT')).toEqual([]);
    // The piece itself is not on the student's Feedback Pages: its grade was never returned.
    const feedback = JSON.parse(onReturned['year › quick › ' + c.student.id]).feedback;
    expect(feedback.find(item => item.id === c.lab.id)).toBeUndefined();
    // What was changed since it was returned prints as it was returned: the comments and the ticks.
    expect(holding(onReturned, ['quick'], 'Returned quiz comment.').length).toBeGreaterThan(0);
    expect(holding(onReturned, ['quick'], 'Returned check comment.').length).toBeGreaterThan(0);
    expect(holding(onReturned, ['quick'], 'Returned criterion comment.').length).toBeGreaterThan(0);
    expect(ticksOn(onReturned, c.other.id, c.lab2.id)).toEqual(
      c.returnedTicks[c.other.id + ':' + c.lab2.id].slice().sort(),
    );
    // The teacher's own record keeps it.
    expect(holding(onReturned, ['export'], 'ZZDRAFT overall comment.').length).toBe(1);
    expect(holding(onReturned, ['export'], 'ZZDRAFT note for the report').length).toBe(1);
    expect(holding(onReturned, ['export'], 'ZZDRAFT changed quiz comment.').length).toBe(1);
  });

  it('levels a render keeps are kept for one set: a block drawn on all work, then on returned grades in the same task', async () => {
    const c = drafts;
    _cache.scores[cid] = structuredClone(c.scores);
    /* One student's first-term work was never returned: on all work they
       have a level at the last report, on returned grades they have none,
       and the blocks print the change since then. */
    const [first, second] = getReportingTerms(cid);
    const since = new Set(
      getAssessments(cid)
        .filter(a => a.date > first.ends_on)
        .map(a => a.id),
    );
    const student = c.other;
    const returned = Object.assign({}, c.returned, {
      [student.id]: c.returned[student.id].filter(e => since.has(e.assessmentId)),
    });
    expect(returned[student.id].length).toBeGreaterThan(0);
    expect(returned[student.id].length).toBeLessThan(c.returned[student.id].length);
    globalThis.getReturnedScores = () => returned;
    const ctx = { termId: 'term-' + second.ordinal, termLabel: second.label };
    const autos = ReportBlocks.showDefaults(cid);
    // The blocks that read the start of the term and the last report's levels (report-blocks.js _pass).
    const blocks = () =>
      ['proficiency', 'progress', 'next-steps', 'academic-summary']
        .map(id => ReportBlocks.renderReportBlock(id, cid, student, ctx, ReportSheets.optionsFor({ block: id }, autos)))
        .join('\n');
    setActiveTerm(cid, second.ordinal);
    try {
      await settle();
      clearProfCache();
      const allWork = blocks();
      // No pause: what the all-work render kept is still held.
      const straightAfter = withReturnedOnly(blocks);
      await settle();
      clearProfCache();
      const fromClean = withReturnedOnly(blocks);
      expect(straightAfter).toBe(fromClean);
      expect(fromClean).not.toBe(allWork);
      // And the other way round.
      await settle();
      clearProfCache();
      withReturnedOnly(blocks);
      expect(blocks()).toBe(allWork);
    } finally {
      setActiveTerm(cid, null);
    }
  });

  it('a Note for the Report prints only once that piece’s grade has been returned (ruling 11)', () => {
    const c = drafts;
    _cache.scores[cid] = structuredClone(c.scores);
    // A second note, on a piece of the same student's that was returned.
    const returnedPiece = c.returned[c.student.id].find(e => e.score > 0);
    _cache.scores[cid][c.student.id].forEach(e => {
      if (e.assessmentId === returnedPiece.assessmentId) e.reportNote = 'Linked the poster to the Act';
    });
    globalThis.getReturnedScores = () => c.returned;
    const notes = () => [
      ReportScores.getScoreReportNote(cid, c.student.id, c.lab.id),
      ReportScores.getScoreReportNote(cid, c.student.id, returnedPiece.assessmentId),
    ];
    expect(notes()).toEqual(['ZZDRAFT note for the report', 'Linked the poster to the Act']);
    expect(withReturnedOnly(notes)).toEqual(['', 'Linked the poster to the Act']);
  });

  it('on a class with nothing in draft, every reader gives on returned grades what the data layer gives', () => {
    const c = drafts;
    _cache.scores[cid] = structuredClone(c.scores);
    _cache.rubricChecks[cid] = structuredClone(c.checks);
    globalThis.getReturnedScores = id => getScores(id);
    globalThis.getReturnedRubricCheckIds = (id, sid, aid) => getRubricCheckIds(id, sid, aid);
    const readAll = via => {
      const out = [];
      getStudents(cid).forEach(s => {
        out.push(via.entries(cid, s.id));
        getAssessments(cid).forEach(a => {
          const rubric = a.rubricId ? getRubricById(cid, a.rubricId) : null;
          out.push([
            via.getPointsScore(cid, s.id, a.id),
            via.getCompletionMark(cid, s.id, a.id),
            via.getScoreComment(cid, s.id, a.id),
            via.getScoreReportNote(cid, s.id, a.id),
            via.getRubricCheckIds(cid, s.id, a.id),
            via.getAssignmentStatus(cid, s.id, a.id),
            (a.tagIds || []).map(t => via.getTagComment(cid, s.id, a.id, t)),
            ((rubric && rubric.criteria) || []).map(crit => [
              via.getRubricCriterionComment(cid, s.id, a.id, crit),
              via.getRubricCriterionBeyond(cid, s.id, a.id, crit),
            ]),
          ]);
        });
      });
      return JSON.stringify(out);
    };
    const dataLayer = readAll({
      entries: (id, sid) => getScores(id)[sid] || [],
      getPointsScore,
      getCompletionMark,
      getScoreComment,
      getScoreReportNote,
      getRubricCheckIds,
      getAssignmentStatus,
      getTagComment,
      getRubricCriterionComment,
      getRubricCriterionBeyond,
    });
    expect(ReportScores.getScores(cid)).toBe(getScores(cid));
    expect(withReturnedOnly(() => ReportScores.getScores(cid))).toBe(getScores(cid));
    // On all work the readers are the data layer's own.
    expect(readAll(ReportScores)).toBe(dataLayer);
    // On returned grades they work it out from the returned set: the same, with nothing in draft.
    expect(withReturnedOnly(() => readAll(ReportScores))).toBe(dataLayer);
    expect(dataLayer).toContain('ZZDRAFT criterion comment.');
    expect(ReportScores.getAssignmentStatuses(cid)).toBe(getAssignmentStatuses(cid));
  });
});
