/* global window -- page.evaluate code runs in the app page. */
/**
 * The signed-in class a differential run grades: the speed recorder's class
 * (e2e-perf/speed.spec.js: 30 students by 60 pieces, every cell scored),
 * with ids as the server makes them for the class, its students, pieces,
 * rubric, categories, competencies and their sections, so every write is
 * sent as it is live, and with some of its
 * pieces made points, Complete / Incomplete, rubric, pair and group work so
 * every action has something to act on. A second, small class is there to
 * switch to and back.
 *
 * The data is written in the app's own cache shape, as e2e/helpers.js's
 * seed helpers write it; mockAuth's fake server turns it into the class
 * bundle, so the app runs its real load path on it.
 */
import { TEST_LEARNING_MAP } from '../../e2e/helpers.js';

const hex = (n, w = 12) => n.toString(16).padStart(w, '0');
export const CID = 'c1a55e00-0000-4000-8000-0000000d1ff0';
export const CID2 = 'c1a55e00-0000-4000-8000-0000000d1ff2';
const sid = i => 'e0000000-0000-4000-8000-' + hex(i + 1);
const aid = i => 'a5500000-0000-4000-8000-' + hex(i + 1);
export const RUBRIC_ID = 'b0b00000-0000-4000-8000-000000000001';
const CRIT = ['b0c00000-0000-4000-8000-000000000001', 'b0c00000-0000-4000-8000-000000000002'];
const CAT = ['ca700000-0000-4000-8000-000000000001', 'ca700000-0000-4000-8000-000000000002'];

// The learning map of e2e/helpers.js with ids as the server makes them, so a
// competency score and a hand-set level are sent as they are live
// (shared/data.js sends a tag score only for a tag id the server could know).
const SUBJECT = '5c180000-0000-4000-8000-000000000001';
const SECTIONS = [1, 2, 3].map(n => '5ec00000-0000-4000-8000-' + hex(n));
const TAGS = [1, 2, 3].map(n => '7a600000-0000-4000-8000-' + hex(n));
const CODES = ['QAP', 'PI', 'IP'];
export const LEARNING_MAP = {
  _flatVersion: 2,
  subjects: [{ ...TEST_LEARNING_MAP.subjects[0], id: SUBJECT, name: 'Science 9' }],
  sections: TEST_LEARNING_MAP.sections.slice(0, 3).map((sec, i) => ({
    ...sec,
    id: SECTIONS[i],
    subject: SUBJECT,
    tags: sec.tags.slice(0, 1).map(t => ({ ...t, id: TAGS[i], code: CODES[i], subject: SUBJECT })),
  })),
};

export const STUDENTS = Array.from({ length: 30 }, (_, i) => ({
  id: sid(i),
  personId: sid(i).replace(/^e/, 'f'),
  firstName: 'Student' + (i + 1),
  preferred: 'Student' + (i + 1),
  lastName: 'L' + String(i + 1).padStart(2, '0'),
  sortName: 'L' + String(i + 1).padStart(2, '0') + ' Student' + (i + 1),
  pronouns: '',
  studentNumber: String(2000 + i),
  email: '',
  dateOfBirth: '',
  designations: [],
  enrolledDate: '',
  attendance: [],
}));

/* What kind each piece is. Most are scored by competency, as in the speed
   recorder; the rest give the other actions something to act on. */
export function pieceKind(i) {
  // Group work scored by points and by Complete/Incomplete: the group
  // writes reach them through setPointsScore and setCompletionMark.
  if (i === 47) return 'pairPoints';
  if (i === 57) return 'groupComplete';
  if (i % 10 === 1) return 'points';
  if (i % 10 === 3) return 'rubric';
  if (i % 10 === 5) return 'complete';
  if (i % 20 === 7) return 'pair';
  if (i % 20 === 17) return 'group';
  if (i % 10 === 9) return 'twoTags';
  return 'level';
}

export const RUBRIC = {
  id: RUBRIC_ID,
  name: 'Lab Rubric',
  style: 'standard',
  criteria: [
    {
      id: CRIT[0],
      name: 'Safety',
      tagIds: [TAGS[0]],
      weight: 1,
      levels: { 4: 'Leads safe practice', 3: 'Follows every step', 2: 'Needs reminders', 1: 'Many reminders' },
    },
    {
      id: CRIT[1],
      name: 'Data',
      tagIds: [TAGS[1]],
      weight: 1,
      levels: { 4: 'Repeatable', 3: 'Complete', 2: 'Partial', 1: 'Little' },
    },
  ],
};

export const CATEGORIES = [
  { id: CAT[0], name: 'Tests', weight: 60, displayOrder: 0 },
  { id: CAT[1], name: 'Labs', weight: 40, displayOrder: 1 },
];

function pairsOf(ids, size) {
  const out = [];
  for (let i = 0; i + size <= ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export const ASSESSMENTS = Array.from({ length: 60 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 8, 3 + i)).toISOString().slice(0, 10);
  const kind = pieceKind(i);
  const a = {
    id: aid(i),
    title: 'Task ' + (i + 1),
    date: day,
    type: i % 3 === 0 ? 'formative' : 'summative',
    tagIds: [TAGS[i % 3]],
    evidenceType: '',
    notes: '',
    coreCompetencyIds: [],
    rubricId: '',
    scoreMode: '',
    maxPoints: 0,
    weight: 1,
    dueDate: '',
    collaboration: 'individual',
    moduleId: '',
    pairs: [],
    groups: [],
    excludedStudents: [],
    created: day + 'T12:00:00.000Z',
  };
  if (i % 4 === 0) a.categoryId = CAT[i % 8 === 0 ? 0 : 1];
  if (kind === 'points' || kind === 'pairPoints') Object.assign(a, { scoreMode: 'points', maxPoints: 20, tagIds: [] });
  if (kind === 'complete' || kind === 'groupComplete') Object.assign(a, { scoreMode: 'complete', tagIds: [] });
  if (kind === 'rubric') Object.assign(a, { rubricId: RUBRIC_ID, tagIds: [TAGS[0], TAGS[1]] });
  if (kind === 'twoTags') a.tagIds = [TAGS[0], TAGS[2]];
  if (kind === 'pair' || kind === 'pairPoints')
    Object.assign(a, { collaboration: 'pair', pairs: pairsOf(STUDENTS.map(s => s.id).slice(0, 12), 2) });
  if (kind === 'group' || kind === 'groupComplete')
    Object.assign(a, { collaboration: 'group', groups: pairsOf(STUDENTS.map(s => s.id).slice(0, 12), 4) });
  return a;
});

/* Every cell scored, as in the speed recorder, except the last ten pieces,
   which are left blank so there is something to fill. */
export const SCORES = Object.fromEntries(
  STUDENTS.map((s, si) => {
    const entries = [];
    ASSESSMENTS.forEach((a, ai) => {
      if (ai >= 50) return;
      const level = 1 + ((si + ai) % 4);
      const base = {
        assessmentId: a.id,
        date: a.date,
        type: a.type === 'formative' ? 'formative' : 'summative',
        note: '',
      };
      const id = n => 'seed-' + si + '-' + ai + '-' + n;
      const kind = pieceKind(ai);
      if (kind === 'points' || kind === 'pairPoints')
        entries.push({ ...base, id: id(0), tagId: null, score: 8 + ((si + ai) % 13) });
      else if (kind === 'complete') entries.push({ ...base, id: id(0), tagId: null, score: (si + ai) % 5 ? 1 : 0 });
      else if (kind === 'rubric')
        RUBRIC.criteria.forEach((c, ci) =>
          entries.push({ ...base, id: id(ci), tagId: c.id, score: 1 + ((si + ci + ai) % 4) }),
        );
      else a.tagIds.forEach((t, ti) => entries.push({ ...base, id: id(ti), tagId: t, score: 1 + ((level + ti) % 4) }));
    });
    return [s.id, entries];
  }),
);

/* A few statuses already on, so clearing them is an action too. */
export const STATUSES = {
  [STUDENTS[2].id + ':' + ASSESSMENTS[50].id]: 'NS',
  [STUDENTS[4].id + ':' + ASSESSMENTS[51].id]: 'EXC',
  [STUDENTS[6].id + ':' + ASSESSMENTS[52].id]: 'LATE',
};

const SMALL_STUDENTS = STUDENTS.slice(0, 4).map((s, i) => ({
  ...s,
  id: 'e1000000-0000-4000-8000-' + hex(i + 1),
  personId: s.personId,
}));
const SMALL_ASSESSMENTS = ASSESSMENTS.slice(0, 3).map((a, i) => ({
  ...a,
  id: 'a5510000-0000-4000-8000-' + hex(i + 1),
  rubricId: '',
  categoryId: undefined,
  scoreMode: '',
  tagIds: [TAGS[i]],
  collaboration: 'individual',
  pairs: [],
  groups: [],
}));

/* The two classes, in the shape the seeding script writes. */
export function signedInClasses() {
  return {
    activeCourse: CID,
    classes: [
      {
        cid: CID,
        course: {
          id: CID,
          name: 'Science 9 Block A',
          gradingSystem: 'proficiency',
          calcMethod: 'mostRecent',
          decayWeight: 0.65,
        },
        learningMap: LEARNING_MAP,
        students: STUDENTS,
        assessments: ASSESSMENTS,
        scores: SCORES,
        statuses: STATUSES,
        rubrics: [RUBRIC],
        categories: CATEGORIES,
        // What the fake server holds for the class (fake-server.js): its
        // student page on, grades returned When I Return Them, Send Work on.
        server: { student_page_enabled: true, return_grades: 'on_return', send_work: true },
      },
      {
        cid: CID2,
        course: {
          id: CID2,
          name: 'Science 9 Block B',
          gradingSystem: 'proficiency',
          calcMethod: 'mostRecent',
          decayWeight: 0.65,
        },
        learningMap: LEARNING_MAP,
        students: SMALL_STUDENTS,
        assessments: SMALL_ASSESSMENTS,
        scores: {},
        statuses: {},
        rubrics: [],
        categories: [],
      },
    ],
  };
}

/* Runs in the page (page.addInitScript) on the run's first load only
   (window.__diffFirstLoad, scripts/differential/page-init.js), so a reload
   reads back what the page saved. */
export function seedSignedIn(data) {
  if (!window.__diffFirstLoad) return;
  const courses = {};
  data.classes.forEach(c => (courses[c.cid] = c.course));
  localStorage.setItem('gb-courses', JSON.stringify(courses));
  localStorage.setItem('gb-config', JSON.stringify({ activeCourse: data.activeCourse }));
  localStorage.setItem('gb-lastActiveCourse', data.activeCourse);
  data.classes.forEach(c => {
    const set = (k, v) => localStorage.setItem('gb-' + k + '-' + c.cid, JSON.stringify(v));
    set('learningMaps', c.learningMap);
    set('students', c.students);
    set('assessments', c.assessments);
    set('scores', c.scores);
    set('statuses', c.statuses);
    set('rubrics', c.rubrics);
    set('categories', c.categories);
    if (c.server) localStorage.setItem('__diff-srv-course-' + c.cid, JSON.stringify(c.server));
  });
}
