/**
 * E2E test helpers — mock auth, seed data, and shared utilities.
 *
 * Usage in tests:
 *   import { mockAuth, seedCourse, seedStudents, seedAssessments, TEST_COURSE, TEST_STUDENTS } from './helpers.js';
 *   test.beforeEach(async ({ page }) => {
 *     await mockAuth(page);
 *     await seedCourse(page);
 *     await page.goto('/teacher/app.html#/dashboard');
 *     await page.waitForSelector('#dock-mount');
 *   });
 */

// ── Test fixtures ─────────────────────────────────────────────

export const TEACHER = {
  id: 'test-teacher-00000000-0000-0000-0000-000000000001',
  email: 'test@school.ca',
  display_name: 'Test Teacher',
};

export const TEST_COURSE = {
  id: 'sci8',
  name: 'Science 8 — Test',
  gradingSystem: 'proficiency',
  calcMethod: 'mostRecent',
  decayWeight: 0.65,
  curriculumTags: ['SCI8'],
};

export const TEST_STUDENTS = [
  {
    id: 'stu-001',
    firstName: 'Alice',
    lastName: 'Anderson',
    preferred: 'Alice',
    pronouns: '',
    studentNumber: '1001',
    email: '',
    dateOfBirth: '',
    designations: [],
    enrolledDate: '',
    attendance: [],
    sortName: 'Anderson Alice',
  },
  {
    id: 'stu-002',
    firstName: 'Bob',
    lastName: 'Baker',
    preferred: 'Bob',
    pronouns: '',
    studentNumber: '1002',
    email: '',
    dateOfBirth: '',
    designations: [],
    enrolledDate: '',
    attendance: [],
    sortName: 'Baker Bob',
  },
  {
    id: 'stu-003',
    firstName: 'Charlie',
    lastName: 'Chen',
    preferred: 'Charlie',
    pronouns: '',
    studentNumber: '1003',
    email: '',
    dateOfBirth: '',
    designations: [],
    enrolledDate: '',
    attendance: [],
    sortName: 'Chen Charlie',
  },
];

export const TEST_ASSESSMENT = {
  id: 'assess-001',
  title: 'Lab Report 1',
  date: '2026-03-20',
  type: 'summative',
  tagIds: ['QAP'],
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
  created: new Date('2026-03-20').toISOString(),
};

export const TEST_LEARNING_MAP = {
  _flatVersion: 2,
  subjects: [{ id: 'SCI8', name: 'Science 8', color: '#0891b2' }],
  sections: [
    {
      id: 'QAP',
      subject: 'SCI8',
      name: 'Questioning and Predicting',
      shortName: 'Questioning',
      color: '#0891b2',
      tags: [
        {
          id: 'QAP',
          label: 'Question and Predict',
          text: '',
          color: '#0891b2',
          subject: 'SCI8',
          name: 'Questioning and Predicting',
          shortName: 'Questioning',
          i_can_statements: [],
        },
      ],
    },
    {
      id: 'PI',
      subject: 'SCI8',
      name: 'Planning and Conducting',
      shortName: 'Planning',
      color: '#0891b2',
      tags: [
        {
          id: 'PI',
          label: 'Plan Investigations',
          text: '',
          color: '#0891b2',
          subject: 'SCI8',
          name: 'Planning and Conducting',
          shortName: 'Planning',
          i_can_statements: [],
        },
      ],
    },
    {
      id: 'IP',
      subject: 'SCI8',
      name: 'Processing and Analyzing',
      shortName: 'Processing',
      color: '#0891b2',
      tags: [
        {
          id: 'IP',
          label: 'Identify Patterns',
          text: '',
          color: '#0891b2',
          subject: 'SCI8',
          name: 'Processing and Analyzing',
          shortName: 'Processing',
          i_can_statements: [],
        },
      ],
    },
  ],
};

// ── Mock auth ─────────────────────────────────────────────────

/**
 * Inject fake Supabase session and stub auth functions so the app
 * boots without hitting a real Supabase instance.
 */
export async function mockAuth(page) {
  await page.addInitScript(teacher => {
    const fakeSession = {
      access_token: 'e2e-test-token',
      token_type: 'bearer',
      expires_in: 86400,
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      refresh_token: 'e2e-refresh',
      user: {
        id: teacher.id,
        email: teacher.email,
        user_metadata: { display_name: teacher.display_name },
      },
    };

    // 1) Seed localStorage BEFORE any script runs.
    //    requireAuth's fast path reads this synchronously.
    localStorage.setItem('sb-novsfeqjhbleyyaztmlh-auth-token', JSON.stringify(fakeSession));

    // Prevent demo data seeding (seedIfNeeded checks this flag)
    localStorage.setItem('gb-data-wiped', '1');

    // 2) Provide a fake `supabase` global so gb-supabase.js _initClient() succeeds.
    //    This must exist before the <script src="vendor/supabase.min.js"> tag runs.
    const noopPromise = val => Promise.resolve(val);
    const makeFakeClient = () => ({
      auth: {
        getSession: () => noopPromise({ data: { session: { ...fakeSession, user: fakeSession.user } }, error: null }),
        getUser: () => noopPromise({ data: { user: fakeSession.user }, error: null }),
        onAuthStateChange: cb => {
          setTimeout(() => cb('SIGNED_IN', { ...fakeSession, user: fakeSession.user }), 50);
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        signOut: () => noopPromise({}),
        resetPasswordForEmail: () => noopPromise({}),
        signInWithPassword: () => noopPromise({ data: fakeSession, error: null }),
        signUp: () => noopPromise({ data: fakeSession, error: null }),
      },
      from: table => {
        // For teacher_config: return courses + config from localStorage
        // For course_data: return per-course data from localStorage
        const _eqs = {};
        const chain = {
          select: () => chain,
          eq: (col, val) => {
            _eqs[col] = val;
            return chain;
          },
          neq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          single: () => noopPromise({ data: null, error: null }),
          upsert: () => noopPromise({ error: null }),
          insert: () => noopPromise({ data: [], error: null }),
          update: () => chain,
          delete: () => chain,
          then: resolve => {
            if (table === 'teacher_config') {
              const courses = JSON.parse(localStorage.getItem('gb-courses') || 'null');
              const config = JSON.parse(localStorage.getItem('gb-config') || '{}');
              const rows = [];
              if (courses) rows.push({ config_key: 'courses', data: courses });
              if (config) rows.push({ config_key: 'config', data: config });
              return resolve({ data: rows, error: null });
            }
            if (table === 'course_data') {
              const cid = _eqs['course_id'] || 'sci8';
              const dataKeys = [
                'students',
                'assessments',
                'scores',
                'learningMaps',
                'modules',
                'rubrics',
                'flags',
                'goals',
                'reflections',
                'overrides',
                'statuses',
                'observations',
                'notes',
                'termRatings',
                'customTags',
                'courseConfigs',
                'reportConfig',
                'gradingScales',
              ];
              const rows = [];
              for (const dk of dataKeys) {
                const val = localStorage.getItem('gb-' + dk + '-' + cid);
                if (val) rows.push({ data_key: dk, data: JSON.parse(val) });
              }
              return resolve({ data: rows, error: null });
            }
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      },
    });

    // Fake the Supabase CDN global so createClient works
    window.supabase = { createClient: () => makeFakeClient() };

    // Also set __ENV so gb-supabase.js doesn't log errors
    window.__ENV = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'fake-key' };

    // Prevent idle-timeout from firing during tests
    window._idleTimeout = null;
    window._resetIdleTimer = () => {};

    // Prevent demo seed from overwriting test data
    // seedIfNeeded is defined in gb-seed-data.js; we stub it after it loads
    const _seedObserver = new MutationObserver(() => {
      if (typeof window.seedIfNeeded === 'function' && !window._seedStubbed) {
        window._seedStubbed = true;
        window.seedIfNeeded = async () => {};
        window.migrateAllStudents = async () => {};
      }
    });
    _seedObserver.observe(document.documentElement, { childList: true, subtree: true });
    // Also try directly in case script already loaded
    setTimeout(() => {
      if (typeof window.seedIfNeeded === 'function') {
        window.seedIfNeeded = async () => {};
      }
      if (typeof window.migrateAllStudents === 'function') {
        window.migrateAllStudents = async () => {};
      }
      _seedObserver.disconnect();
    }, 3000);
  }, TEACHER);

  // Block the real Supabase CDN script from loading (we already injected a fake)
  await page.route('**/vendor/supabase.min.js', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '/* mocked */',
    }),
  );
  await page.route('**/cdn.jsdelivr.net/**supabase**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '/* mocked */',
    }),
  );
}

// ── Data seeding ──────────────────────────────────────────────

/**
 * Seed a test course + learning map into localStorage so the app
 * picks it up during initAllCourses / initData.
 */
export async function seedCourse(page) {
  await page.addInitScript(
    fixtures => {
      const { course, learningMap, teacherId } = fixtures;
      const courses = {};
      courses[course.id] = course;

      // Global course list
      localStorage.setItem('gb-courses', JSON.stringify(courses));
      localStorage.setItem('gb-config', JSON.stringify({ activeCourse: course.id }));
      localStorage.setItem('gb-lastActiveCourse', course.id);

      // Per-course data
      localStorage.setItem('gb-learningMaps-' + course.id, JSON.stringify(learningMap));
      localStorage.setItem('gb-students-' + course.id, JSON.stringify([]));
      localStorage.setItem('gb-assessments-' + course.id, JSON.stringify([]));
      localStorage.setItem('gb-scores-' + course.id, JSON.stringify({}));
      localStorage.setItem('gb-observations-' + course.id, JSON.stringify([]));
      localStorage.setItem('gb-modules-' + course.id, JSON.stringify([]));
      localStorage.setItem('gb-rubrics-' + course.id, JSON.stringify([]));
      localStorage.setItem('gb-flags-' + course.id, JSON.stringify({}));
      localStorage.setItem('gb-goals-' + course.id, JSON.stringify({}));
      localStorage.setItem('gb-reflections-' + course.id, JSON.stringify({}));
      localStorage.setItem('gb-overrides-' + course.id, JSON.stringify({}));
      localStorage.setItem('gb-statuses-' + course.id, JSON.stringify({}));
      localStorage.setItem('gb-notes-' + course.id, JSON.stringify({}));
      localStorage.setItem('gb-termRatings-' + course.id, JSON.stringify({}));
      localStorage.setItem('gb-customTags-' + course.id, JSON.stringify([]));
      localStorage.setItem('gb-courseConfigs-' + course.id, JSON.stringify({}));
      localStorage.setItem('gb-reportConfig-' + course.id, JSON.stringify({}));
      localStorage.setItem('gb-gradingScales-' + course.id, JSON.stringify({}));
    },
    { course: TEST_COURSE, learningMap: TEST_LEARNING_MAP, teacherId: TEACHER.id },
  );
}

/**
 * Seed students into localStorage BEFORE page load.
 * Must be called before gotoApp / page.goto.
 */
export async function seedStudents(page, students = TEST_STUDENTS) {
  await page.addInitScript(
    data => {
      localStorage.setItem('gb-students-' + data.cid, JSON.stringify(data.students));
    },
    { cid: TEST_COURSE.id, students },
  );
}

/**
 * Seed assessments into localStorage BEFORE page load.
 * Must be called before gotoApp / page.goto.
 */
export async function seedAssessments(page, assessments = [TEST_ASSESSMENT]) {
  await page.addInitScript(
    data => {
      localStorage.setItem('gb-assessments-' + data.cid, JSON.stringify(data.assessments));
    },
    { cid: TEST_COURSE.id, assessments },
  );
}

/**
 * Seed scores into localStorage BEFORE page load.
 * Must be called before gotoApp / page.goto.
 * Accepts either the raw score blob shape:
 *   { 'stu-001': [{ assessmentId, tagId, score, ... }] }
 * or a shorthand nested shape:
 *   { 'stu-001': { 'assess-001': { 'QAP': 3 } } }
 */
export async function seedScores(page, scores) {
  await page.addInitScript(
    data => {
      function normalizeScores(rawScores) {
        if (!rawScores || typeof rawScores !== 'object') return {};

        var studentIds = Object.keys(rawScores);
        var alreadyNormalized = studentIds.every(function (sid) {
          return Array.isArray(rawScores[sid]);
        });
        if (alreadyNormalized) return rawScores;

        var normalized = {};
        studentIds.forEach(function (sid) {
          var assessmentMap = rawScores[sid];
          var entries = [];
          if (!assessmentMap || typeof assessmentMap !== 'object') {
            normalized[sid] = entries;
            return;
          }

          Object.keys(assessmentMap).forEach(function (aid) {
            var tagMap = assessmentMap[aid];
            if (!tagMap || typeof tagMap !== 'object') return;

            Object.keys(tagMap).forEach(function (tid) {
              var rawEntry = tagMap[tid];
              if (rawEntry === undefined || rawEntry === null) return;

              var entry = typeof rawEntry === 'object' ? rawEntry : { score: rawEntry };
              if (typeof entry.score !== 'number') return;

              entries.push({
                id: entry.id || ['seed', sid, aid, tid].join('-'),
                assessmentId: aid,
                tagId: tid,
                score: entry.score,
                date: entry.date || new Date().toISOString().slice(0, 10),
                type: entry.type || 'summative',
                note: entry.note || '',
                created: entry.created || new Date().toISOString(),
              });
            });
          });

          normalized[sid] = entries;
        });

        return normalized;
      }

      localStorage.setItem('gb-scores-' + data.cid, JSON.stringify(normalizeScores(data.scores)));
    },
    { cid: TEST_COURSE.id, scores },
  );
}

// ── Navigation helpers ────────────────────────────────────────

/** Navigate to app and wait for the dock to render (app booted). */
export async function gotoApp(page, hash = '/dashboard') {
  await page.goto(`/teacher/app.html#${hash}`);
  await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });
}

/** Navigate to a specific page within the SPA. */
export async function navigateTo(page, route) {
  await page.evaluate(r => {
    window.location.hash = r;
  }, route);
  // Wait for page render
  await page.waitForTimeout(500);
}

// ── Assertion helpers ─────────────────────────────────────────

/** Get visible text content of an element. */
export async function getText(page, selector) {
  return page.locator(selector).textContent();
}

/** Click a data-action button. */
export async function clickAction(page, action) {
  await page.locator(`[data-action="${action}"]`).first().click();
}
