/**
 * Download All My Data (teacher/export-all.js): the sheets a teacher's
 * workbook holds, built from the loaded classes. Every grade comes through
 * calc.js, so the tests compare the sheets with calc.js's own answers
 * rather than retyping figures. The completeness test at the end keeps the
 * export honest as the app grows: a new per-class accessor in
 * shared/data.js must be exported or listed here with a reason.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(resolve(root, 'teacher/export-all.js'), 'utf-8');
runInThisContext(SOURCE, { filename: 'export-all.js' });

const CID = 'course-xa';
const TAG = 'T1';
const STUDENTS = [
  { id: 's1', firstName: 'Theodore', preferred: 'Teddy', lastName: 'Okafor' },
  { id: 's2', firstName: 'Noor', lastName: 'Ahmed' },
  { id: 's3', firstName: 'Sam', lastName: 'Zhou' },
];

const level = (id, extra) =>
  Object.assign(
    { id, title: id, scoreMode: 'proficiency', tagIds: [TAG], type: 'summative', date: '2026-10-10' },
    extra,
  );
const points = (id, max, extra) =>
  Object.assign({ id, title: id, scoreMode: 'points', maxPoints: max, tagIds: [], date: '2026-09-20' }, extra);
const complete = (id, extra) =>
  Object.assign({ id, title: id, scoreMode: 'complete', maxPoints: 1, tagIds: [], date: '2026-11-01' }, extra);
const entry = (assessmentId, value, tagId = TAG, extra) =>
  Object.assign({ assessmentId, tagId, score: value, date: '2026-10-10' }, extra);

function seed(o) {
  o = o || {};
  COURSES[CID] = {
    id: CID,
    name: o.name || 'Science 9',
    gradingSystem: o.gradingSystem || 'proficiency',
    block: o.block,
  };
  _cache.assessments[CID] = o.assessments || [];
  _cache.scores[CID] = o.scores || {};
  _cache.statuses[CID] = o.statuses || {};
  _cache.rubrics[CID] = o.rubrics || [];
  _cache.categories[CID] = o.categories || [];
  _cache.observations[CID] = o.obs || {};
  _cache.students[CID] = o.students || STUDENTS;
  _cache.withdrawn[CID] = o.withdrawn || [];
  _cache.termRatings[CID] = o.ratings || {};
  _cache.goals[CID] = o.goals || {};
  _cache.goalDates[CID] = o.goalDates || {};
  _cache.reflections[CID] = o.reflections || {};
  _cache.overrides[CID] = o.overrides || {};
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: o.sections || [
      {
        id: 'sec1',
        name: 'Questioning and Predicting',
        shortName: 'Questioning',
        tags: [{ id: TAG, label: 'Questioning', code: 'T1' }],
      },
    ],
    _customized: true,
    _version: 1,
  };
  _cache.courseConfigs[CID] = Object.assign({ roundPercent: true }, o.config || {});
  clearProfCache();
}

const sheet = (sheets, name) => sheets.find(s => s.name === name);
const rows = opts => ExportAll.rows(Object.assign({ cids: [CID], teacher: 'Colin Brown', date: '2026-11-06' }, opts));

afterEach(() => {
  delete COURSES[CID];
  localStorage.clear();
});

describe('the workbook', () => {
  it('starts with Contents and Summary, then one gradebook sheet per class, and leaves empty sheets out', () => {
    seed({ assessments: [level('Quiz')], scores: { s1: [entry('Quiz', 3)] } });
    const sheets = rows();
    expect(sheets.map(s => s.name)).toEqual(['Contents', 'Summary', 'Science 9']);
    const c = sheets[0];
    expect(c.teacher).toBe('Colin Brown');
    expect(c.date).toBe('2026-11-06');
    expect(c.lines.map(l => l[0])).toEqual(['Summary', 'Science 9']);
  });

  it('names a class sheet after the class, safe for Excel and unique', () => {
    expect(ExportAll.sheetName('Humanities 8: Block A/B?', {})).toBe('Humanities 8 Block A B');
    const taken = {};
    expect(ExportAll.sheetName('Science 8', taken)).toBe('Science 8');
    expect(ExportAll.sheetName('Science 8', taken)).toBe('Science 8 (2)');
    expect(ExportAll.sheetName('A very long class name that runs past thirty-one characters', {})).toHaveLength(31);
  });
});

describe('Summary', () => {
  it('names students as the app does, with the course grade as shown and the Missing and Late counts', () => {
    const quiz = level('Quiz');
    const lab = level('Lab', { date: '2026-10-20' });
    seed({
      assessments: [quiz, lab],
      scores: { s1: [entry('Quiz', 3), entry('Lab', 4)], s2: [entry('Lab', 2)] },
      statuses: { 's2:Quiz': 'NS', 's1:Lab': 'LATE', 's3:Quiz': 'EXC' },
    });
    const s = sheet(rows(), 'Summary');
    expect(s.columns.map(c => c.header)).toEqual(['Class', 'Student', 'Course Grade', 'Missing', 'Late', 'Withdrawn']);
    expect(s.rows.map(r => r[1])).toEqual(['Noor Ahmed', 'Teddy Okafor', 'Sam Zhou']);
    expect(s.rows[1][2]).toBe(studentGradeSummary(CID, 's1').text);
    expect(s.rows[1][2]).not.toBe('');
    expect(s.rows[0].slice(3)).toEqual([1, 0, '']);
    expect(s.rows[1].slice(3)).toEqual([0, 1, '']);
    expect(s.rows[2].slice(3)).toEqual([0, 0, '']);
  });

  it('lists withdrawn students, marked, and leaves deleted classes out', () => {
    seed({
      withdrawn: [{ student: { id: 'w1', firstName: 'Wen', lastName: 'Lee' }, withdrawnAt: '2026-10-01' }],
    });
    const s = sheet(rows(), 'Summary');
    expect(s.rows.map(r => [r[1], r[5]])).toContainEqual(['Wen Lee', 'Yes']);
    COURSES[CID].archived = true;
    expect(ExportAll.classIds()).not.toContain(CID);
  });

  it('uses the block in the class name', () => {
    seed({ block: 'B' });
    expect(sheet(rows(), 'Summary').rows[0][0]).toBe('B · Science 9');
  });
});

describe('a class gradebook sheet', () => {
  const quiz = level('Quiz');
  const test = points('Test', 20);
  const hw = complete('Homework');

  it('puts dates, categories and titles over the grid, oldest work first, and a Class Average under it', () => {
    seed({
      assessments: [quiz, test, hw],
      categories: [{ id: 'cat1', name: 'Quizzes' }],
      scores: { s1: [entry('Quiz', 3), entry('Test', 15, 'overall')], s2: [entry('Quiz', 2)] },
    });
    _cache.assessments[CID][0].categoryId = 'cat1';
    const g = sheet(rows(), 'Science 9').grid;
    expect(g.header).toEqual(['Student', 'Course Grade', 'Test', 'Quiz', 'Homework']);
    expect(g.dates).toEqual(['Date', '', '2026-09-20', '2026-10-10', '2026-11-01']);
    expect(g.categories).toEqual(['Category', '', 'No Category', 'Quizzes', 'No Category']);
    expect(g.rows.map(r => r.cells[0])).toEqual(['Noor Ahmed', 'Teddy Okafor', 'Sam Zhou']);
    expect(g.average[0]).toBe('Class Average');
    const students = sortStudents(getStudents(CID), 'lastName');
    expect(g.average[3]).toBe(
      classColumnAverageText(CID, quiz, classColumnAverage(CID, students, { assessment: quiz })),
    );
  });

  it('reads each cell as the Scores view shows it, coloured by its level', () => {
    seed({
      assessments: [quiz, test, hw],
      scores: {
        s1: [entry('Quiz', 3), entry('Test', 15, 'overall')],
        s2: [entry('Quiz', 1)],
        s3: [],
      },
      statuses: { 's2:Test': 'NS', 's3:Quiz': 'EXC', 's1:Quiz': 'LATE' },
    });
    setCompletionMark(CID, 's3', 'Homework', 'complete');
    setCompletionMark(CID, 's2', 'Homework', 'incomplete');
    const g = sheet(rows(), 'Science 9').grid;
    const teddy = g.rows[1];
    const noor = g.rows[0];
    const sam = g.rows[2];
    expect(teddy.cells.slice(2)).toEqual(['15/20', assessmentCellValue(CID, 's1', quiz).text + ' (Late)', '']);
    expect(teddy.levels.slice(2)).toEqual([pointsToProf(15, 20, getGradingScale(CID)), 3, 0]);
    expect(noor.cells.slice(2)).toEqual(['Missing', assessmentCellValue(CID, 's2', quiz).text, 'Incomplete']);
    expect(noor.levels.slice(2)).toEqual([1, 1, 0]);
    expect(sam.cells.slice(2)).toEqual(['', 'Excused', 'Complete']);
    expect(sam.levels.slice(2)).toEqual([0, 0, 0]);
  });

  it('follows the grading style: a Letter class shows percents, a Both class both', () => {
    seed({ gradingSystem: 'letter', assessments: [quiz], scores: { s1: [entry('Quiz', 3)] } });
    let cell = sheet(rows(), 'Science 9').grid.rows[1].cells[2];
    expect(cell).toBe(assessmentCellValue(CID, 's1', quiz).text);
    expect(cell).toMatch(/^\d+%$/);
    seed({ gradingSystem: 'both', assessments: [quiz], scores: { s1: [entry('Quiz', 3)] } });
    cell = sheet(rows(), 'Science 9').grid.rows[1].cells[2];
    expect(cell).toBe(assessmentCellValue(CID, 's1', quiz).text);
    expect(cell).toMatch(/^3\.0 · \d+%$/);
  });
});

describe('Rubric Levels and Feedback', () => {
  const rubric = {
    id: 'rb',
    name: 'Lab Rubric',
    criteria: [
      { id: 'c2', name: 'Analysis', tagIds: [TAG], displayOrder: 1 },
      { id: 'c1', name: 'Method', tagIds: [TAG], displayOrder: 0 },
    ],
  };
  const lab = level('Lab', { rubricId: 'rb' });

  it('gives each scored criterion its level, figure and notes, in rubric order', () => {
    seed({
      assessments: [lab],
      rubrics: [rubric],
      scores: {
        s1: [
          entry('Lab', 3, 'c1', { mod: 1, critNote: 'Label the axes.' }),
          entry('Lab', 1, 'c2', { critBeyond: 'Extra trial.' }),
        ],
        s2: [entry('Lab', 2, 'c1')],
      },
      statuses: { 's3:Lab': 'NS' },
    });
    const s = sheet(rows(), 'Rubric Levels');
    expect(s.columns.map(c => c.header)).toEqual([
      'Class',
      'Assessment',
      'Date',
      'Student',
      'Criterion',
      'Level',
      'Figure',
      'Work On',
      'Went Beyond',
    ]);
    expect(s.rows).toEqual([
      ['Science 9', 'Lab', '2026-10-10', 'Noor Ahmed', 'Method', 'Developing', '2', '', ''],
      ['Science 9', 'Lab', '2026-10-10', 'Teddy Okafor', 'Method', 'Proficient +', '3+', 'Label the axes.', ''],
      ['Science 9', 'Lab', '2026-10-10', 'Teddy Okafor', 'Analysis', 'Emerging', '1', '', 'Extra trial.'],
    ]);
  });

  it('lists overall comments, Notes for the Report and competency comments', () => {
    const quiz = level('Quiz');
    seed({
      assessments: [quiz],
      scores: {
        s1: [entry('Quiz', 3, TAG, { note: 'Clear reasoning.', reportNote: 'linked cause and effect' })],
        s2: [entry('Quiz', 2, TAG, { critNote: 'Check your units.' })],
      },
    });
    const s = sheet(rows(), 'Feedback');
    expect(s.rows).toEqual([
      ['Science 9', 'Quiz', '2026-10-10', 'Noor Ahmed', 'T1 Questioning', 'Check your units.', ''],
      ['Science 9', 'Quiz', '2026-10-10', 'Teddy Okafor', '', 'Clear reasoning.', 'linked cause and effect'],
    ]);
  });
});

describe('Observations, Reports, Questionnaires, Goals and Overrides', () => {
  it('lists observations oldest first with their type, linked work and competency', () => {
    const quiz = level('Quiz');
    seed({
      assessments: [quiz],
      obs: {
        s1: [
          {
            id: 'o2',
            text: 'Led the group.',
            sentiment: 'strength',
            date: '2026-10-12',
            created: '2026-10-12T10:00:00Z',
          },
          {
            id: 'o1',
            text: 'Left early.',
            sentiment: 'concern',
            created: '2026-10-02T10:00:00Z',
            assignmentContext: { assessmentId: 'Quiz', assessmentTitle: 'Quiz' },
            competencyId: TAG,
            level: 2,
          },
        ],
      },
    });
    const s = sheet(rows(), 'Observations');
    expect(s.rows).toEqual([
      ['2026-10-02', 'Science 9', 'Teddy Okafor', 'Concern', 'Quiz', 'T1 Questioning · 2', 'Left early.'],
      ['2026-10-12', 'Science 9', 'Teddy Okafor', 'Strength', '', '', 'Led the group.'],
    ]);
  });

  it('gives each report its comment as plain text, work habits, attendance and approval', () => {
    seed({
      config: { reportingTerms: [{ ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-30' }] },
      ratings: {
        s1: {
          'term-1': {
            narrative: '<p>Teddy asks <b>good</b> questions.</p><p>Next: show the work.</p>',
            habits: { completes: 4, ready: 2, others: 9 },
            absences: 3,
            lates: 1,
            approvedAt: '2026-11-20T00:00:00Z',
          },
          'term-2': { narrative: '' },
        },
      },
    });
    const s = sheet(rows(), 'Reports');
    expect(s.rows).toEqual([
      [
        'Science 9',
        'Term 1',
        'Teddy Okafor',
        'Teddy asks good questions.\nNext: show the work.',
        'Completes Work: Consistently; Comes Ready, Uses Class Time: Sometimes',
        3,
        1,
        'Yes',
      ],
    ]);
  });

  it('writes each questionnaire answer on its own row', () => {
    seed({});
    const entries = (cid, sid) =>
      sid === 's2'
        ? [
            {
              title: 'About Me',
              at: '2026-09-15T12:00:00Z',
              items: [
                { q: { prompt: 'What should I call you?' }, v: { text: 'Noor' } },
                { q: { prompt: 'Skipped' }, v: null },
                { q: { prompt: 'Pick any' }, v: { json: ['Reading', 'Art'] } },
                { q: { prompt: 'Where are you?' }, v: { json: { levels: { COM: 3 }, why: { COM: 'I speak up.' } } } },
              ],
            },
          ]
        : [];
    const s = sheet(rows({ entries }), 'Questionnaires');
    expect(s.rows).toEqual([
      ['Science 9', 'Noor Ahmed', 'About Me', '2026-09-15', 'What should I call you?', 'Noor'],
      ['Science 9', 'Noor Ahmed', 'About Me', '2026-09-15', 'Pick any', 'Reading, Art'],
      ['Science 9', 'Noor Ahmed', 'About Me', '2026-09-15', 'Where are you?', 'Communicating: 3 (I speak up.)'],
    ]);
    expect(sheet(rows(), 'Questionnaires')).toBeUndefined();
  });

  it('lists goals, reflections and grade overrides by competency area', () => {
    seed({
      goals: { s1: { sec1: 'Ask one question a day.', sec9: '  ' } },
      goalDates: { s1: { sec1: '2026-10-03T08:00:00Z' } },
      reflections: {
        s3: { sec1: { confidence: 3, text: 'Getting better at predicting.', date: '2026-10-30T08:00:00Z' } },
      },
      overrides: { s1: { sec1: { level: 3, calculated: 2.4, reason: 'Oral evidence in class.', date: '2026-11-02' } } },
    });
    const sheets = rows();
    expect(sheet(sheets, 'Goals & Reflections').rows).toEqual([
      ['Science 9', 'Teddy Okafor', '2026-10-03', 'Goal', 'Questioning', 'Ask one question a day.', ''],
      ['Science 9', 'Sam Zhou', '2026-10-30', 'Reflection', 'Questioning', 'Getting better at predicting.', 3],
    ]);
    expect(sheet(sheets, 'Grade Overrides').rows).toEqual([
      [
        'Science 9',
        'Teddy Okafor',
        'Questioning',
        formatLevel(CID, 3, ''),
        formatLevel(CID, 2.4, ''),
        'Oral evidence in class.',
        '2026-11-02',
      ],
    ]);
  });
});

describe('the export stays complete', () => {
  // Per-class readers in shared/data.js that the export leaves out, and why.
  // A new `function getX(cid…)` in data.js must be used by export-all.js or
  // added here with its reason, so nothing a teacher wrote goes missing.
  const LEFT_OUT = {
    getAllTags: 'the learning map, not student data',
    getAssignmentStatus: 'read through getAssignmentStatuses',
    getAssignmentObs: 'a subset of getAllQuickObs',
    getCategories: 'read through getAssessmentCategoryName',
    getCategoryById: 'read through getAssessmentCategoryName',
    getCategoryDraft: 'category edits not yet saved, kept on this device until they are; not a record',
    getCompetencyGroupById: 'the learning map, not student data',
    getCompetencyGroups: 'the learning map, not student data',
    getCoreSelf: 'Core Competency steps entered from reflection sheets; shown on the Dashboard only',
    getCardsWorkUntil: 'the last day the class’s student cards open; a class setting, not student data',
    getCourseConfig: 'class settings, not student data',
    getCourseFeedbackOptions: 'two class switches (Reflect on Feedback, Show My Learning), not student data',
    getCustomTags: 'observation tag names, not student data',
    getDibelsScore: 'read through assessmentCellValue (the reading level)',
    getDibelsScores: 'read through assessmentCellValue (the reading level)',
    getFlags: 'the roster flag is a working marker, not a record',
    getGradeReturn: 'read through getGradeReturns',
    getGradeReturns: 'which grades are drafts; the export shows all work, as the teacher sees it (build plan 1.3)',
    getGradingScale: 'class settings, not student data',
    getGroupedSections: 'the learning map, not student data',
    getLearningMap: 'the learning map, not student data',
    getModuleById: 'the learning map, not student data',
    getModules: 'the learning map, not student data',
    getNotes: 'legacy; nothing in the app writes it',
    getPointsScore: 'read through assessmentCellValue',
    getQuickObs: 'read through getAllQuickObs',
    getQuickObsByDim: 'a subset of getAllQuickObs',
    getRemovedSections: 'the learning map, not student data',
    getReportConfig: 'report layout settings, not student data',
    getRubricById: 'read through _assessmentRubric',
    getRubricCheckIds: 'Advanced Rubric ticks; the level they suggest is on Rubric Levels',
    getRubricChecks: 'Advanced Rubric ticks; the level they suggest is on Rubric Levels',
    getRubricPrint: 'a log of what was printed',
    getRubricPrints: 'a log of what was printed',
    getRubrics: 'read through _assessmentRubric',
    getScores: 'read through assessmentCellValue, getScoreComment and getTagComment',
    getSectionForTag: 'the learning map, not student data',
    getStudentAssignmentFeedback: 'a subset of getAllQuickObs',
    getStudentProfileSummaries: 'a cache of the roster',
    getStudentQuickObs: 'a subset of getAllQuickObs',
    getStudentTermRating: 'read through getTermRatings',
    getSubjects: 'the learning map, not student data',
    getCompletionMark: 'read through assessmentCellValue',
    // Student work (S5-F5): photos of student work are not in this file (Q22).
    getCourseSubmissions: 'student work, kept out with its photos',
    getStudentSubmission: 'student work, kept out with its photos',
    getAssessmentStudentWork: 'student work settings, kept out with the photos',
    getStudentWork: 'the student page’s view of student work',
    // Group work (S12-T1): student work read by group, kept out with its photos.
    getStudentWorkGroup: 'the group on the assessment, already in the class file',
    getGroupSubmissions: 'student work, kept out with its photos',
    getGroupWorkFiles: 'student work, kept out with its photos',
    getStudentGroupWork: 'the student page’s view of group work',
    // Mark Up (S9): drawing data over the photos, kept out with them.
    getPageMarkup: 'Mark Up on a page of student work, kept out with the photos',
    getAssessmentMarkup: 'Mark Up on student work, kept out with the photos',
    getStudentMarkup: 'the student page’s view of Mark Up',
    getStudentMarkCounts: 'the student page’s count of Mark Up notes',
    // Reflect on Feedback (S10): Demo Mode only until S10-W1; kept out with student work.
    getReflectOnFeedback: 'a class switch, not student data',
    getCourseFeedback: 'reflections on student work, Demo Mode only for now',
    getQuestionsWaiting: 'a subset of getCourseFeedback',
    getStudentReflections: 'a subset of getCourseFeedback',
    getStudentLastPlan: 'a subset of getCourseFeedback',
    getStudentFeedback: 'the student page’s view of its own feedback',
    // Revisions (S11): Demo Mode only until S11-W1; kept out with student work.
    getRevisionRequest: 'a revision request on student work, Demo Mode only for now',
    getStudentRevision: 'the student page’s view of its own revision',
    getSubmissionVersions: 'student work, kept out with its photos',
    getRevisionFirstCell: 'the first version’s result, read through assessmentCellValue',
  };

  it('uses every per-class reader in shared/data.js, or says why not', () => {
    const data =
      readFileSync(resolve(root, 'shared/data.js'), 'utf-8') +
      readFileSync(resolve(root, 'shared/data-learning-map.js'), 'utf-8') +
      readFileSync(resolve(root, 'shared/data-categories.js'), 'utf-8') +
      readFileSync(resolve(root, 'shared/data-rubrics.js'), 'utf-8') +
      readFileSync(resolve(root, 'shared/data-assessments.js'), 'utf-8') +
      readFileSync(resolve(root, 'shared/data-config-settings.js'), 'utf-8') +
      readFileSync(resolve(root, 'shared/data-observations.js'), 'utf-8') +
      readFileSync(resolve(root, 'shared/data-student-cards.js'), 'utf-8') +
      readFileSync(resolve(root, 'shared/data-student-records.js'), 'utf-8') +
      readFileSync(resolve(root, 'shared/data-term-ratings.js'), 'utf-8');
    const readers = [...data.matchAll(/^function (get\w+)\(cid\b/gm)].map(m => m[1]);
    expect(readers.length).toBeGreaterThan(40);
    const used = readers.filter(name => new RegExp('\\b' + name + '\\(').test(SOURCE));
    const missing = readers.filter(name => !used.includes(name) && !LEFT_OUT[name]);
    expect(missing).toEqual([]);
    // A reader that is used, or gone, comes off the list.
    const stale = Object.keys(LEFT_OUT).filter(name => !readers.includes(name) || used.includes(name));
    expect(stale).toEqual([]);
  });
});

describe('photos of student work (S8-F2)', () => {
  const NOTE = 'Photos of student work are not in this file.';

  function withSendWork(on, fn) {
    const wasDemo = window.isDemoMode;
    window.isDemoMode = () => true;
    try {
      saveDemoStudentWork(CID, { course: { send_work: on } });
      return fn();
    } finally {
      window.isDemoMode = wasDemo;
    }
  }

  it('says on Contents that photos are not in the file, for a class with its student page and Send Work on', () => {
    seed({ config: { student_page_enabled: true } });
    withSendWork(true, () => expect(sheet(rows(), 'Contents').notes).toContain(NOTE));
  });

  it('says nothing new while either is off', () => {
    seed();
    expect(sheet(rows(), 'Contents').notes).not.toContain(NOTE);
    withSendWork(true, () => expect(sheet(rows(), 'Contents').notes).not.toContain(NOTE));
    seed({ config: { student_page_enabled: true } });
    withSendWork(false, () => expect(sheet(rows(), 'Contents').notes).not.toContain(NOTE));
  });

  it('puts nothing of the work sent in the file: no page, no note, no file name', () => {
    const wasDemo = window.isDemoMode;
    window.isDemoMode = () => true;
    try {
      seed({ config: { student_page_enabled: true }, assessments: [level('a1')] });
      saveDemoStudentWork(CID, {
        course: { send_work: true },
        assessments: [{ id: 'a1', students_send: 'photos' }],
        submissions: [
          {
            id: 'sub-1',
            assessment_id: 'a1',
            enrollment_id: 's1',
            state: 'sent',
            sent_by: 'student',
            note: 'ZZSENT my note',
            sent_at: '2026-10-11T16:00:00.000Z',
            files: [
              { id: 'f1', page: 1, path: 'zz-page.jpg', thumb_path: 'zz-page-thumb.jpg', sha256: 'ab'.repeat(32) },
            ],
          },
        ],
      });
      expect(getCourseSubmissions(CID).submissions).toHaveLength(1);
      const out = JSON.stringify(rows());
      ['ZZSENT', 'zz-page', 'sub-1', 'ab'.repeat(32)].forEach(v => expect(out).not.toContain(v));
    } finally {
      window.isDemoMode = wasDemo;
    }
  });
});
