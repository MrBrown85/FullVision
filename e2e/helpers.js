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

export const SMOKE_WELCOME_COURSE = {
  id: 'welcome-class-smoke',
  name: 'Smoke Class',
  gradingSystem: 'proficiency',
  calcMethod: 'mostRecent',
  decayWeight: 0.65,
  curriculumTags: ['SCI8'],
};

export const SMOKE_WELCOME_STUDENTS = [
  {
    id: 'welcome-stu-001',
    firstName: 'Avery',
    lastName: 'Adams',
    preferred: 'Avery',
    pronouns: '',
    studentNumber: '2001',
    email: '',
    dateOfBirth: '',
    designations: [],
    enrolledDate: '',
    attendance: [],
    sortName: 'Adams Avery',
  },
  {
    id: 'welcome-stu-002',
    firstName: 'Jordan',
    lastName: 'Bennett',
    preferred: 'Jordan',
    pronouns: '',
    studentNumber: '2002',
    email: '',
    dateOfBirth: '',
    designations: [],
    enrolledDate: '',
    attendance: [],
    sortName: 'Bennett Jordan',
  },
];

export const SMOKE_WELCOME_ASSESSMENT = {
  id: 'welcome-assess-001',
  title: 'Welcome Lab',
  date: '2026-04-21',
  type: 'summative',
  tagIds: ['WELCOME-QAP'],
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
  created: new Date('2026-04-21').toISOString(),
};

export const SMOKE_WELCOME_LEARNING_MAP = {
  _flatVersion: 2,
  subjects: [{ id: 'SCI8', name: 'Science 8', color: '#0891b2' }],
  sections: [
    {
      id: 'WELCOME-QAP-SEC',
      subject: 'SCI8',
      name: 'Questioning and Predicting',
      shortName: 'Questioning',
      color: '#0891b2',
      tags: [
        {
          id: 'WELCOME-QAP',
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
  ],
};

// ── Mock auth ─────────────────────────────────────────────────

/**
 * Sign in a fake teacher and stand in for Supabase with a fake server that
 * answers the v2 RPCs the app calls: bootstrap_teacher, list_teacher_courses
 * and get_class_bundle. Writes succeed and change nothing on the server.
 * A spec can make writes fail like a 504 (window.__e2eFailWrites = true) or
 * answer late (window.__e2eWriteDelayMs); window.__e2eRpcLog records every
 * call with its time.
 *
 * The server's data is whatever the seed helpers (seedCourse, seedStudents,
 * …) or a spec's own addInitScript put in localStorage, read once when the
 * app first talks to Supabase. Seeds are written in the app's own cache
 * shape; the server converts them to the bundle shape, so the app runs its
 * real load path (_bundleToCache) on them.
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

    // requireAuth's fast path reads this synchronously.
    localStorage.setItem('sb-novsfeqjhbleyyaztmlh-auth-token', JSON.stringify(fakeSession));
    // Stops loadSeedIfNeeded from adding Demo Mode data.
    localStorage.setItem('gb-data-wiped', '1');

    // ── The fake server's data ──
    // Read once, on the first call: every init script (the seeds) has run by
    // then, and the app hasn't yet replaced the seeded keys with what the
    // server sends.
    let db = null;
    function readLS(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    }
    function serverDb() {
      if (db) return db;
      const courses = readLS('gb-courses', {}) || {};
      const config = readLS('gb-config', {}) || {};
      const perCourse = {};
      Object.keys(courses).forEach(cid => {
        const get = (field, fallback) => readLS('gb-' + field + '-' + cid, fallback);
        perCourse[cid] = {
          students: get('students', []) || [],
          assessments: get('assessments', []) || [],
          scores: get('scores', {}) || {},
          statuses: get('statuses', {}) || {},
          learningMap: get('learningMaps', {}) || {},
          categories: get('categories', []) || [],
          modules: get('modules', []) || [],
          rubrics: get('rubrics', []) || [],
          observations: get('observations', {}) || {},
          flags: get('flags', {}) || {},
          goals: get('goals', {}) || {},
          reflections: get('reflections', {}) || {},
          overrides: get('overrides', {}) || {},
          notes: get('notes', {}) || {},
          termRatings: get('termRatings', {}) || {},
          customTags: get('customTags', []) || [],
          reportConfig: get('reportConfig', {}) || {},
          courseConfig: get('courseConfigs', {}) || {},
        };
      });
      db = { courses, config, perCourse, versions: {} };
      return db;
    }

    // ── Converters: app cache shape → v2 RPC shape ──
    function courseRows() {
      const { courses } = serverDb();
      return Object.keys(courses).map((cid, i) => {
        const c = courses[cid] || {};
        return {
          id: cid,
          name: c.name || '',
          grade_level: c.gradeLevel || '',
          description: c.description || '',
          color: c.color || '',
          is_archived: !!c.archived,
          display_order: c.displayOrder != null ? c.displayOrder : i,
          grading_system: c.gradingSystem || null,
          calc_method: c.calcMethod || null,
          decay_weight: c.decayWeight != null ? c.decayWeight : null,
          timezone: c.timezone || null,
          late_work_policy: c.lateWorkPolicy || null,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        };
      });
    }

    function learningMapPayload(map) {
      const sections = (map && map.sections) || [];
      const subjects = ((map && map.subjects) || []).map((subj, si) => ({
        id: subj.id,
        name: subj.name || '',
        color: subj.color || null,
        display_order: si,
        sections: sections
          .filter(sec => sec.subject === subj.id)
          .map((sec, ci) => ({
            id: sec.id,
            name: sec.name || '',
            short_name: sec.shortName || '',
            color: sec.color || null,
            display_order: ci,
            competency_group_id: sec.groupId || null,
            tags: (sec.tags || []).map((tag, ti) => ({
              id: tag.id,
              code: tag.code || tag.id,
              label: tag.label || '',
              i_can_text: tag.text || '',
              i_can_statements: tag.i_can_statements || [],
              color: tag.color || null,
              display_order: ti,
            })),
          })),
      }));
      return { competency_groups: [], subjects };
    }

    function rubricsPayload(rubrics) {
      const out = { rubrics: [], criteria: [], criterion_tags: [] };
      (rubrics || []).forEach((r, ri) => {
        out.rubrics.push({ id: r.id, name: r.name || '', created_at: '2026-09-01T00:00:' + String(10 + ri) + 'Z' });
        (r.criteria || []).forEach((c, ci) => {
          const levels = c.levels || {};
          const values = c.levelValues || {};
          out.criteria.push({
            id: c.id,
            rubric_id: r.id,
            name: c.name || c.label || '',
            level_4_descriptor: levels[4] || '',
            level_3_descriptor: levels[3] || '',
            level_2_descriptor: levels[2] || '',
            level_1_descriptor: levels[1] || '',
            level_4_value: values[4] != null ? values[4] : 4,
            level_3_value: values[3] != null ? values[3] : 3,
            level_2_value: values[2] != null ? values[2] : 2,
            level_1_value: values[1] != null ? values[1] : 1,
            weight: c.weight != null ? c.weight : 1,
            display_order: c.displayOrder != null ? c.displayOrder : ci,
          });
          (c.tagIds || []).forEach(tagId => out.criterion_tags.push({ criterion_id: c.id, tag_id: tagId }));
        });
      });
      return out;
    }

    function observationsPayload(blob) {
      const byId = {};
      Object.keys(blob || {}).forEach(sid => {
        (Array.isArray(blob[sid]) ? blob[sid] : []).forEach((ob, i) => {
          const id = ob.id || 'ob-' + sid + '-' + i;
          if (!byId[id]) {
            byId[id] = {
              id,
              body: ob.text || '',
              sentiment: ob.sentiment || null,
              context_type: ob.context || null,
              assessment_id: (ob.assignmentContext && ob.assignmentContext.assessmentId) || null,
              created_at: ob.created || '2026-09-01T00:00:00Z',
              enrollment_ids: [],
              tag_ids: [],
              custom_tag_ids: [],
            };
          }
          byId[id].enrollment_ids.push(sid);
        });
      });
      const observations = Object.values(byId);
      return { observations, total: observations.length };
    }

    function gradebookPayload(cid, data) {
      const students = data.students.map((s, i) => ({
        enrollment_id: s.id,
        student_id: s.personId || s.id,
        first_name: s.firstName || '',
        last_name: s.lastName || '',
        preferred_name: s.preferred || '',
        pronouns: s.pronouns || '',
        student_number: s.studentNumber || '',
        email: s.email || '',
        date_of_birth: s.dateOfBirth || null,
        designations: s.designations || [],
        roster_position: i + 1,
        is_flagged: !!data.flags[s.id],
      }));
      const assessments = data.assessments.map((a, i) => ({
        id: a.id,
        title: a.title || '',
        description: a.description || '',
        assessment_kind: a.type || null,
        category_id: a.categoryId || null,
        score_mode: a.scoreMode || 'proficiency',
        max_points: a.maxPoints || null,
        weight: a.weight != null ? a.weight : 1,
        evidence_type: a.evidenceType || '',
        rubric_id: a.rubricId || null,
        module_id: a.moduleId || null,
        collab_mode: null,
        collab_config: {
          pairs: a.pairs || [],
          groups: a.groups || [],
          excludedStudents: a.excludedStudents || [],
        },
        has_rubric: !!a.rubricId,
        date_assigned: a.date || null,
        due_date: a.dueDate || null,
        display_order: i,
        tag_ids: a.tagIds || [],
      }));
      const sIndex = {};
      students.forEach((s, i) => (sIndex[s.enrollment_id] = i));
      const aIndex = {};
      assessments.forEach((a, i) => (aIndex[a.id] = i));
      const tagIndex = [];
      const tIndex = {};
      const tagRows = [];
      const scoreCells = {};
      function scoreCell(si, ai) {
        const key = si + ':' + ai;
        return scoreCells[key] || (scoreCells[key] = [si, ai, null, null, '']);
      }
      Object.keys(data.scores).forEach(sid => {
        (data.scores[sid] || []).forEach(entry => {
          const si = sIndex[sid];
          const ai = aIndex[entry.assessmentId];
          if (si == null || ai == null) return;
          const mode = assessments[ai].score_mode;
          if (mode === 'points' || !entry.tagId) {
            const cell = scoreCell(si, ai);
            cell[2] = entry.score;
            cell[4] = entry.note || '';
            return;
          }
          if (tIndex[entry.tagId] == null) {
            tIndex[entry.tagId] = tagIndex.length;
            tagIndex.push(entry.tagId);
          }
          tagRows.push([si, ai, tIndex[entry.tagId], entry.score, entry.mod || 0]);
          if (entry.note) scoreCell(si, ai)[4] = entry.note;
        });
      });
      Object.keys(data.statuses).forEach(key => {
        const parts = key.split(':');
        const si = sIndex[parts[0]];
        const ai = aIndex[parts[1]];
        if (si == null || ai == null) return;
        scoreCell(si, ai)[3] = data.statuses[key];
      });
      return {
        course: { id: cid },
        students,
        assessments,
        categories: data.categories.map((c, i) => ({
          id: c.id,
          name: c.name || '',
          weight: c.weight || 0,
          display_order: c.displayOrder != null ? c.displayOrder : i,
        })),
        modules: data.modules.map((m, i) => ({
          id: m.id,
          course_id: cid,
          name: m.name || '',
          color: m.color || null,
          display_order: m.sortOrder != null ? m.sortOrder : i,
        })),
        tag_index: tagIndex,
        criterion_index: [],
        score_rows: Object.values(scoreCells),
        tag_rows: tagRows,
        criterion_rows: [],
      };
    }

    function profilesPayload(data) {
      return data.students.map((s, i) => ({
        student: {
          id: s.personId || s.id,
          first_name: s.firstName || '',
          last_name: s.lastName || '',
          preferred_name: s.preferred || '',
          pronouns: s.pronouns || '',
          student_number: s.studentNumber || '',
          email: s.email || '',
        },
        enrollment: { id: s.id, roster_position: i + 1, designations: s.designations || [] },
        goals: data.goals[s.id] || {},
        reflections: data.reflections[s.id] || {},
        section_overrides: data.overrides[s.id] || {},
        is_flagged: !!data.flags[s.id],
        recent_observations: [],
        notes: data.notes[s.id] ? [{ id: 'note-' + s.id, body: data.notes[s.id] }] : [],
      }));
    }

    function termRatingRows(blob) {
      const rows = [];
      Object.keys(blob || {}).forEach(sid => {
        Object.keys(blob[sid] || {}).forEach(termId => {
          const t = blob[sid][termId] || {};
          const term = Number(String(termId).replace(/^term-/, ''));
          if (!term) return;
          rows.push({
            enrollment_id: sid,
            term,
            narrative_html: t.narrative || '',
            work_habits_rating: t.workHabits || 0,
            participation_rating: t.participation || 0,
            social_traits: t.socialTraits || [],
            strength_tags: t.strengths || [],
            growth_tags: t.growthAreas || [],
            mention_assessments: t.mentionAssessments || [],
            mention_observations: t.mentionObs || [],
          });
        });
      });
      return rows;
    }

    function classBundle(cid, ifVersion) {
      const store = serverDb();
      const data = store.perCourse[cid];
      if (!data) return { error: { message: 'course not found', code: 'P0002' } };
      const version = store.versions[cid] || (store.versions[cid] = 1);
      if (ifVersion != null && Number(ifVersion) === version) {
        return { data: { not_modified: true, version } };
      }
      const { _preset, ...blocks } = data.reportConfig || {};
      const cc = data.courseConfig || {};
      return {
        data: {
          bundle_schema: 3,
          version,
          gradebook: gradebookPayload(cid, data),
          learning_map: learningMapPayload(data.learningMap),
          rubrics: rubricsPayload(data.rubrics),
          observations: observationsPayload(data.observations),
          profiles: profilesPayload(data),
          term_ratings: termRatingRows(data.termRatings),
          report_config: Object.keys(blocks).length > 0 ? { blocks_config: blocks, preset: _preset || null } : null,
          custom_tags: data.customTags,
          course_config: { grading_scale: cc.gradingScale || null, category_weights: cc.categoryWeights || null },
        },
      };
    }

    // Every RPC the fake server was asked for, for specs to inspect.
    window.__e2eRpcLog = [];
    window.__e2eFailWrites = false;
    window.__e2eWriteDelayMs = 0;

    // A write as the server would answer it, with the failure switch and
    // delay read when the call is made.
    function fakeWrite() {
      const res = window.__e2eFailWrites
        ? { data: null, error: { message: 'simulated 504 timeout', code: '504' }, status: 504 }
        : { data: null, error: null };
      const delay = window.__e2eWriteDelayMs || 0;
      if (!delay) return Promise.resolve(res);
      return new Promise(resolve => setTimeout(() => resolve(res), delay));
    }

    function fakeRpc(name, params) {
      window.__e2eRpcLog.push({ name, params: params || null, at: Date.now() });
      let res;
      if (name === 'bootstrap_teacher') {
        const { config } = serverDb();
        const rows = courseRows();
        res = {
          data: {
            id: teacher.id,
            email: teacher.email,
            display_name: teacher.display_name,
            created_at: '2026-09-01T00:00:00Z',
            deleted_at: null,
            preferences: {
              active_course_id: config.activeCourse || (rows[0] && rows[0].id) || null,
              view_mode: config.viewMode || null,
              mobile_view_mode: null,
              mobile_sort_mode: null,
              card_widget_config: null,
            },
          },
        };
      } else if (name === 'list_teacher_courses') {
        res = { data: courseRows() };
      } else if (name === 'get_class_bundle') {
        res = classBundle(params && params.p_course_id, params && params.p_if_version);
      } else if (/^(get|list)_/.test(name)) {
        // Reads the bundle replaced: nothing.
        res = { data: null };
      } else {
        return fakeWrite();
      }
      return Promise.resolve({ data: res.data === undefined ? null : res.data, error: res.error || null });
    }

    const noopPromise = val => Promise.resolve(val);
    const makeFakeClient = () => ({
      auth: {
        getSession: () => noopPromise({ data: { session: { ...fakeSession, user: fakeSession.user } }, error: null }),
        getUser: () => noopPromise({ data: { user: fakeSession.user }, error: null }),
        onAuthStateChange: cb => {
          setTimeout(() => cb('SIGNED_IN', { ...fakeSession, user: fakeSession.user }), 50);
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        refreshSession: () => noopPromise({ data: { session: { ...fakeSession } }, error: null }),
        signOut: () => noopPromise({ error: null }),
        resetPasswordForEmail: () => noopPromise({ data: {}, error: null }),
        signInWithPassword: () => noopPromise({ data: fakeSession, error: null }),
        signUp: () => noopPromise({ data: fakeSession, error: null }),
      },
      rpc: fakeRpc,
      // Table reads the v2 app still makes (rubric fallback, sync cursor).
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          neq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          single: () => noopPromise({ data: null, error: null }),
          maybeSingle: () => noopPromise({ data: null, error: null }),
          upsert: () => noopPromise({ data: [], error: null }),
          insert: () => noopPromise({ data: [], error: null }),
          update: () => chain,
          delete: () => chain,
          then: resolve => resolve({ data: [], error: null }),
        };
        return chain;
      },
    });

    // Pin the fake client so the real one can't replace it.
    const fakeSupabase = { createClient: () => window._supabase || makeFakeClient() };
    window._supabase = makeFakeClient();
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get: function () {
        return fakeSupabase;
      },
      set: function () {
        return true;
      },
    });

    window.__ENV = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'fake-key' };

    // Keep the idle timeout from signing the test out.
    window._idleTimeout = null;
    window._resetIdleTimer = () => {};
  }, TEACHER);

  // The fake client above stands in for the real library.
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

/**
 * Mock the full sign-up -> sign-in -> app -> sign-out -> sign-in flow with a
 * durable fake backend that survives the app's normal localStorage wipe.
 *
 * This keeps the smoke test honest about the browser round-trip even when no
 * real Supabase project / SMTP config is present in the local checkout.
 */
export async function mockPersistentAuthFlow(
  page,
  seed = {
    course: SMOKE_WELCOME_COURSE,
    learningMap: SMOKE_WELCOME_LEARNING_MAP,
    students: SMOKE_WELCOME_STUDENTS,
    assessment: SMOKE_WELCOME_ASSESSMENT,
  },
) {
  await page.addInitScript(fixtures => {
    const TOKEN_KEY = 'sb-novsfeqjhbleyyaztmlh-auth-token';
    const DB_KEY = 'e2e-auth-smoke-db';
    const SESSION_KEY = 'e2e-auth-smoke-session';

    function clone(value) {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function normalizeEmail(email) {
      return String(email || '')
        .trim()
        .toLowerCase();
    }

    function teacherIdFor(email) {
      return (
        'e2e-teacher-' +
        normalizeEmail(email)
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
      );
    }

    function loadDb() {
      try {
        return JSON.parse(localStorage.getItem(DB_KEY) || '{"users":{}}');
      } catch (e) {
        return { users: {} };
      }
    }

    function saveDb(db) {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    }

    function loadSession() {
      try {
        return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      } catch (e) {
        return null;
      }
    }

    function persistSession(session) {
      if (!session) return;
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      localStorage.setItem(TOKEN_KEY, JSON.stringify(session));
    }

    function clearSession() {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(TOKEN_KEY);
    }

    function buildAppState(user) {
      const course = clone(fixtures.course);
      const learningMap = clone(fixtures.learningMap);
      const students = clone(fixtures.students);
      const assessment = clone(fixtures.assessment);
      const cid = course.id;
      const appState = {};
      const config = {
        activeCourse: cid,
        displayName: user.display_name,
        email: user.email,
      };

      appState['gb-courses'] = JSON.stringify({ [cid]: course });
      appState['gb-config'] = JSON.stringify(config);
      appState['gb-lastActiveCourse'] = cid;
      appState['gb-learningMaps-' + cid] = JSON.stringify(learningMap);
      appState['gb-students-' + cid] = JSON.stringify(students);
      appState['gb-assessments-' + cid] = JSON.stringify([assessment]);
      appState['gb-scores-' + cid] = JSON.stringify({});
      appState['gb-observations-' + cid] = JSON.stringify({});
      appState['gb-modules-' + cid] = JSON.stringify([]);
      appState['gb-rubrics-' + cid] = JSON.stringify([]);
      appState['gb-flags-' + cid] = JSON.stringify({});
      appState['gb-goals-' + cid] = JSON.stringify({});
      appState['gb-reflections-' + cid] = JSON.stringify({});
      appState['gb-overrides-' + cid] = JSON.stringify({});
      appState['gb-statuses-' + cid] = JSON.stringify({});
      appState['gb-notes-' + cid] = JSON.stringify({});
      appState['gb-termRatings-' + cid] = JSON.stringify({});
      appState['gb-customTags-' + cid] = JSON.stringify([]);
      appState['gb-courseConfigs-' + cid] = JSON.stringify({});
      appState['gb-reportConfig-' + cid] = JSON.stringify({});
      appState['gb-gradingScales-' + cid] = JSON.stringify({});
      appState['gb-data-wiped'] = '1';
      return appState;
    }

    function applyAppState(appState) {
      var keysToRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && (key.indexOf('gb-') === 0 || key.indexOf('gb_') === 0 || key.indexOf('td-') === 0)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(function (key) {
        localStorage.removeItem(key);
      });
      Object.keys(appState || {}).forEach(function (key) {
        localStorage.setItem(key, appState[key]);
      });
    }

    function publicUser(record) {
      return {
        id: record.id,
        email: record.email,
        user_metadata: {
          display_name: record.display_name,
          portal: 'teacher',
        },
      };
    }

    function buildSession(record) {
      const user = publicUser(record);
      return {
        access_token: 'e2e-smoke-token-' + Date.now(),
        token_type: 'bearer',
        expires_in: 86400,
        expires_at: Math.floor(Date.now() / 1000) + 86400,
        refresh_token: 'e2e-smoke-refresh-' + Date.now(),
        user: user,
      };
    }

    function loadCurrentUserRecord() {
      const session = loadSession();
      if (!session || !session.user || !session.user.email) return null;
      const db = loadDb();
      return db.users[normalizeEmail(session.user.email)] || null;
    }

    const originalSetItem = Storage.prototype.setItem;
    if (!window.__e2ePatchedStorage) {
      window.__e2ePatchedStorage = true;
      Storage.prototype.setItem = function (key, value) {
        originalSetItem.call(this, key, value);
        if (this !== localStorage || typeof key !== 'string' || key.indexOf('gb-') !== 0) return;
        const record = loadCurrentUserRecord();
        if (!record) return;
        if (!record.appState) record.appState = {};
        record.appState[key] = String(value);
        const db = loadDb();
        db.users[normalizeEmail(record.email)] = record;
        saveDb(db);
      };
    }

    const existingSession = loadSession();
    if (existingSession && existingSession.access_token) {
      localStorage.setItem(TOKEN_KEY, JSON.stringify(existingSession));
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }

    window.__ENV = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'fake-key' };
    window._idleTimeout = null;
    window._resetIdleTimer = () => {};
    window.__e2eAuthListeners = window.__e2eAuthListeners || [];

    const noopPromise = value => Promise.resolve(value);
    const emitAuthChange = (event, session) => {
      (window.__e2eAuthListeners || []).forEach(cb => {
        try {
          cb(event, session ? clone(session) : null);
        } catch (e) {
          /* no-op */
        }
      });
    };

    function resolveTeacherRecord(email, displayName) {
      const normalizedEmail = normalizeEmail(email);
      const db = loadDb();
      let record = db.users[normalizedEmail];
      if (!record) {
        record = {
          id: teacherIdFor(normalizedEmail),
          email: normalizedEmail,
          password: '',
          display_name: displayName || 'Smoke Teacher',
          created_at: new Date().toISOString(),
          deleted_at: null,
          appState: null,
        };
      }
      if (!record.appState) record.appState = buildAppState(record);
      db.users[normalizedEmail] = record;
      saveDb(db);
      return record;
    }

    function fakeRpc(name, params) {
      if (name === 'bootstrap_teacher') {
        const record =
          loadCurrentUserRecord() || resolveTeacherRecord(params && params.p_email, params && params.p_display_name);
        return noopPromise({
          data: {
            id: record.id,
            email: record.email,
            display_name: record.display_name,
            created_at: record.created_at,
            deleted_at: record.deleted_at,
            preferences: {
              active_course_id: fixtures.course.id,
              view_mode: null,
              mobile_view_mode: null,
              mobile_sort_mode: null,
              card_widget_config: null,
            },
          },
          error: null,
        });
      }
      if (name === 'restore_teacher') {
        const record = loadCurrentUserRecord();
        if (record) {
          record.deleted_at = null;
          const db = loadDb();
          db.users[normalizeEmail(record.email)] = record;
          saveDb(db);
        }
        return noopPromise({ data: { restored: true }, error: null });
      }
      if (name === 'list_teacher_courses') {
        return noopPromise({
          data: [
            {
              id: fixtures.course.id,
              name: fixtures.course.name,
              grade_level: '',
              description: '',
              color: '',
              is_archived: false,
              display_order: 0,
              grading_system: fixtures.course.gradingSystem,
              calc_method: fixtures.course.calcMethod,
              decay_weight: fixtures.course.decayWeight,
              timezone: null,
              late_work_policy: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          error: null,
        });
      }
      if (name === 'get_gradebook') {
        return noopPromise({
          data: {
            categories: [],
            students: (fixtures.students || []).map(function (student, index) {
              return {
                enrollment_id: student.id,
                student_id: student.id,
                first_name: student.firstName,
                last_name: student.lastName,
                roster_position: index,
                is_flagged: false,
              };
            }),
            assessments: [
              {
                id: fixtures.assessment.id,
                title: fixtures.assessment.title,
                category_id: null,
                score_mode: fixtures.assessment.scoreMode || 'proficiency',
                max_points: fixtures.assessment.maxPoints || null,
                has_rubric: false,
                date_assigned: fixtures.assessment.date,
                due_date: fixtures.assessment.dueDate || '',
                display_order: 0,
              },
            ],
            cells: {},
            row_summaries: {},
          },
          error: null,
        });
      }
      return noopPromise({ data: null, error: null });
    }

    const makeFakeClient = () => ({
      auth: {
        getSession: () => {
          const session = loadSession();
          if (window.location.pathname.indexOf('/teacher/app') !== -1) {
            return noopPromise({ data: { session: null }, error: null });
          }
          return noopPromise({ data: { session: session ? clone(session) : null }, error: null });
        },
        getUser: () => {
          const session = loadSession();
          return noopPromise({ data: { user: session && session.user ? clone(session.user) : null }, error: null });
        },
        onAuthStateChange: cb => {
          window.__e2eAuthListeners.push(cb);
          const session = loadSession();
          if (session) {
            setTimeout(() => cb('SIGNED_IN', clone(session)), 0);
          }
          return {
            data: {
              subscription: {
                unsubscribe: () => {
                  window.__e2eAuthListeners = (window.__e2eAuthListeners || []).filter(function (fn) {
                    return fn !== cb;
                  });
                },
              },
            },
          };
        },
        signOut: () => {
          clearSession();
          emitAuthChange('SIGNED_OUT', null);
          return noopPromise({ error: null });
        },
        resetPasswordForEmail: () => noopPromise({ data: {}, error: null }),
        refreshSession: () => {
          const session = loadSession();
          if (!session) return noopPromise({ data: { session: null }, error: { message: 'No session' } });
          persistSession(session);
          emitAuthChange('TOKEN_REFRESHED', session);
          return noopPromise({ data: { session: clone(session) }, error: null });
        },
        signUp: ({ email, password, options }) => {
          const normalizedEmail = normalizeEmail(email);
          const db = loadDb();
          if (db.users[normalizedEmail]) {
            return noopPromise({ data: null, error: { message: 'User already exists' } });
          }
          const record = {
            id: teacherIdFor(normalizedEmail),
            email: normalizedEmail,
            password: password,
            display_name:
              (options && options.data && options.data.display_name) ||
              normalizedEmail.split('@')[0] ||
              'Smoke Teacher',
            created_at: new Date().toISOString(),
            deleted_at: null,
            appState: null,
          };
          record.appState = buildAppState(record);
          db.users[normalizedEmail] = record;
          saveDb(db);
          return noopPromise({ data: { user: publicUser(record), session: null }, error: null });
        },
        signInWithPassword: ({ email, password }) => {
          const normalizedEmail = normalizeEmail(email);
          const db = loadDb();
          const record = db.users[normalizedEmail];
          if (!record || record.password !== password) {
            return noopPromise({ data: null, error: { message: 'Invalid login credentials' } });
          }
          if (!record.appState) record.appState = buildAppState(record);
          applyAppState(record.appState);
          const session = buildSession(record);
          persistSession(session);
          db.users[normalizedEmail] = record;
          saveDb(db);
          emitAuthChange('SIGNED_IN', session);
          return noopPromise({ data: { user: publicUser(record), session: clone(session) }, error: null });
        },
      },
      rpc: fakeRpc,
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          neq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          single: () => noopPromise({ data: null, error: null }),
          upsert: () => noopPromise({ data: [], error: null }),
          insert: () => noopPromise({ data: [], error: null }),
          update: () => chain,
          delete: () => chain,
          then: resolve => resolve({ data: [], error: null }),
        };
        return chain;
      },
    });

    const fakeSupabase = { createClient: () => window._supabase || makeFakeClient() };
    window._supabase = makeFakeClient();
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get: function () {
        return fakeSupabase;
      },
      set: function () {
        return true;
      },
    });

    const seedObserver = new MutationObserver(() => {
      if (typeof window.seedIfNeeded === 'function' && !window._seedStubbed) {
        window._seedStubbed = true;
        window.seedIfNeeded = async () => {};
        window.migrateAllStudents = async () => {};
      }
    });
    seedObserver.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      if (typeof window.seedIfNeeded === 'function') window.seedIfNeeded = async () => {};
      if (typeof window.migrateAllStudents === 'function') window.migrateAllStudents = async () => {};
      seedObserver.disconnect();
    }, 3000);
  }, seed);

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
