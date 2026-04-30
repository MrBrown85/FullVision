import { test, expect } from '@playwright/test';
import { signIn, recycleSession } from '../helpers/auth.js';
import { archiveTestCourses, makeCourseName } from '../helpers/course.js';
import { readCourseRowCounts } from '../helpers/db.js';
import {
  openWizardFromClassManager,
  pickGrade,
  pickSubject,
  toggleCurriculumTag,
  wizardGoToStep,
  setWizardClassName,
  finishWizard,
} from '../helpers/ui.js';
import { makeStudent, makeAssessment, makeObservation } from '../helpers/fixtures.js';

/**
 * Full-class smoke — the regression that catches "my class disappeared."
 *
 * Builds a complete class through the same UI helpers a real teacher uses,
 * recycles the session, and asserts every entity round-trips through
 * Supabase. This is the test that should run on every PR touching
 * persistence and would have caught the user-reported data-loss bug
 * before PR #102.
 *
 * Single test, ~90s runtime. Tagged "@smoke" so it can be filtered via
 *   npx playwright test --config=playwright.real.config.js -g "@smoke"
 */

const ENV_OK = !!(
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY
);

test.describe('Full-class smoke — persistence across sign-out', () => {
  test.skip(!ENV_OK, 'Real-Supabase tests require .env (see e2e-real/README.md)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveTestCourses(page);
  });

  test('@smoke full-class round-trips across sign-out', async ({ page }) => {
    const courseName = makeCourseName('smoke-fullclass');

    // ── 1. Class creation via the wizard (mints subjects/sections/tags). ──
    await openWizardFromClassManager(page);
    await pickGrade(page, 8);
    await pickSubject(page, 'Science');
    await toggleCurriculumTag(page, 'SCI8');
    await wizardGoToStep(page, 2);
    await setWizardClassName(page, courseName);
    await wizardGoToStep(page, 3);
    await finishWizard(page);

    const courseId = await page.evaluate(async name => {
      const sb = window._supabase;
      const r = await sb.from('course').select('id').eq('name', name).maybeSingle();
      return r.data ? r.data.id : null;
    }, courseName);
    expect(courseId, 'wizard produced a canonical course id').toBeTruthy();

    // Grab the first section + the first curriculum tag for use below.
    const { sectionId, tagId } = await page.evaluate(async cid => {
      const sb = window._supabase;
      const sec = await sb.from('section').select('id').eq('course_id', cid).limit(1).maybeSingle();
      const tag = await sb
        .from('tag')
        .select('id, section!inner(course_id)')
        .eq('section.course_id', cid)
        .limit(1)
        .maybeSingle();
      return {
        sectionId: sec.data ? sec.data.id : null,
        tagId: tag.data ? tag.data.id : null,
      };
    }, courseId);
    expect(sectionId, 'curriculum produced at least one section').toBeTruthy();
    expect(tagId, 'curriculum produced at least one tag').toBeTruthy();

    // ── 2. Course config — grading_system + calc_method on the course row. ──
    await page.evaluate(({ cid }) => window.saveCourseConfig(cid, { gradingSystem: 'both', calcMethod: 'mean' }), {
      cid: courseId,
    });

    // ── 3. Categories — two via window.v2.upsertCategory. ──
    await page.evaluate(async cid => {
      await window.v2.upsertCategory({ id: null, courseId: cid, name: 'Quizzes', weight: 40, displayOrder: 0 });
      await window.v2.upsertCategory({ id: null, courseId: cid, name: 'Projects', weight: 60, displayOrder: 1 });
    }, courseId);

    // ── 4. Modules — two via saveModules. ──
    await page.evaluate(cid => {
      window.saveModules(cid, [
        { id: 'mod-1-' + Date.now(), name: 'Unit 1: Cells', color: '#0891b2', sortOrder: 0 },
        { id: 'mod-2-' + Date.now(), name: 'Unit 2: Energy', color: '#a16207', sortOrder: 1 },
      ]);
    }, courseId);

    // ── 5. Custom tags — two labels via addCustomTag. ──
    await page.evaluate(cid => {
      window.addCustomTag(cid, 'Effort');
      window.addCustomTag(cid, 'Curiosity');
    }, courseId);

    // ── 6. Students — five via saveStudents, then wait for canonical IDs. ──
    const students = [
      makeStudent({ firstName: 'Ada', lastName: 'Lovelace' }),
      makeStudent({ firstName: 'Blaise', lastName: 'Pascal' }),
      makeStudent({ firstName: 'Carl', lastName: 'Gauss' }),
      makeStudent({ firstName: 'Donna', lastName: 'Strickland' }),
      makeStudent({ firstName: 'Emmy', lastName: 'Noether' }),
    ];
    await page.evaluate(({ cid, s }) => window.saveStudents(cid, s), { cid: courseId, s: students });
    await page.waitForFunction(
      cid => {
        const all = window.getStudents(cid);
        if (!all || all.length !== 5) return false;
        return all.every(s => /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(s.id || ''));
      },
      courseId,
      { timeout: 15_000 },
    );
    const enrollmentIds = await page.evaluate(cid => window.getStudents(cid).map(s => s.id), courseId);

    // ── 7. Assessments — three via saveAssessments. ──
    // Plain (no category, no tag), Categorized (Quizzes), and Tag-linked
    // (one curriculum tag) — covers the three flavours of grading.
    const categoryIds = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb.from('category').select('id, name').eq('course_id', cid);
      return r.data || [];
    }, courseId);
    const quizzesId = (categoryIds.find(c => c.name === 'Quizzes') || {}).id || null;
    expect(quizzesId, 'Quizzes category id available').toBeTruthy();

    const assessments = [
      makeAssessment({ title: 'Plain Quiz', categoryId: null, tagIds: [] }),
      makeAssessment({ title: 'Cat Quiz', categoryId: quizzesId, tagIds: [] }),
      makeAssessment({ title: 'Tag Quiz', categoryId: null, tagIds: [tagId] }),
    ];
    await page.evaluate(({ cid, a }) => window.saveAssessments(cid, a), { cid: courseId, a: assessments });
    await page.waitForFunction(
      cid => {
        const all = window.getAssessments(cid);
        if (!all || all.length !== 3) return false;
        return all.every(a => /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(a.id || ''));
      },
      courseId,
      { timeout: 15_000 },
    );
    const assessmentIds = await page.evaluate(cid => {
      const a = window.getAssessments(cid);
      return {
        plain: a.find(x => x.title === 'Plain Quiz').id,
        cat: a.find(x => x.title === 'Cat Quiz').id,
        tagged: a.find(x => x.title === 'Tag Quiz').id,
      };
    }, courseId);

    // ── 8. Scores — every (student × plain assessment) cell, plus a tag
    // score for the first student on the tagged assessment. Covers both
    // `score` and `tag_score` tables. ──
    await page.evaluate(
      ({ cid, eids, plainAid, taggedAid, tid }) => {
        eids.forEach((eid, idx) => {
          const cellValue = (idx % 4) + 1; // 1..4 cycling
          window.upsertCellScore(cid, eid, plainAid, cellValue);
        });
        // First student gets a tag-score on the tag-linked assessment.
        window.upsertScore(cid, eids[0], taggedAid, tid, 4);
      },
      {
        cid: courseId,
        eids: enrollmentIds,
        plainAid: assessmentIds.plain,
        taggedAid: assessmentIds.tagged,
        tid: tagId,
      },
    );

    // ── 9. Notes — one per student. ──
    await page.evaluate(
      ({ cid, eids }) => {
        const all = {};
        eids.forEach((eid, idx) => {
          all[eid] = `Smoke note ${idx + 1}: solid effort this week.`;
        });
        window.saveNotes(cid, all);
      },
      { cid: courseId, eids: enrollmentIds },
    );

    // ── 10. Goals + reflections — one each per student on first section. ──
    await page.evaluate(
      async ({ eids, secId }) => {
        for (const eid of eids) {
          await window.v2.saveGoal(eid, secId, 'Master core ideas this term.');
          await window.v2.saveReflection(eid, secId, 'I am learning to ask better questions.', 3);
        }
      },
      { eids: enrollmentIds, secId: sectionId },
    );

    // ── 11. Section override — one for the first student. ──
    await page.evaluate(
      ({ eid, secId }) => window.v2.saveSectionOverride(eid, secId, 4, 'Demonstrated mastery in capstone.'),
      { eid: enrollmentIds[0], secId: sectionId },
    );

    // ── 12. Term ratings — one per student, term 1. ──
    await page.evaluate(
      async ({ eids }) => {
        for (const eid of eids) {
          await window.v2.saveTermRating(eid, 1, { workHabitsRating: 3, participationRating: 4 });
        }
      },
      { eids: enrollmentIds },
    );

    // ── 13. Observation — one rich observation linking 3 students. ──
    const obs = makeObservation({
      body: "Whole-group discussion: students built on each other's ideas.",
      sentiment: 'positive',
      contextType: 'group',
      enrollmentIds: enrollmentIds.slice(0, 3),
    });
    await page.evaluate(o => window.createObservationRich(o), { ...obs, courseId });

    // ── 14. Wait for queue drain, then recycle session. ──
    await page.waitForTimeout(2000);

    await recycleSession(page);

    // ── 15. Count assertions against Supabase. ──
    const counts = await readCourseRowCounts(page, { courseId });
    expect(counts.found, 'course row exists after recycle').toBe(true);
    expect(counts.enrollments, 'students').toBe(5);
    expect(counts.categories, 'categories').toBe(2);
    expect(counts.subjects, 'subjects').toBeGreaterThan(0);
    expect(counts.sections, 'sections').toBeGreaterThan(0);
    expect(counts.tags, 'curriculum tags').toBeGreaterThan(0);
    expect(counts.assessments, 'assessments').toBe(3);
    expect(counts.scores, 'overall cell scores').toBeGreaterThanOrEqual(5);
    expect(counts.observations, 'observations').toBe(1);
    expect(counts.modules, 'modules').toBe(2);
    expect(counts.notes, 'notes').toBe(5);
    expect(counts.goals, 'goals').toBe(5);
    expect(counts.reflections, 'reflections').toBe(5);
    expect(counts.termRatings, 'term ratings').toBe(5);
    expect(counts.tagScores, 'tag scores').toBeGreaterThanOrEqual(1);
    expect(counts.customTags, 'custom tags').toBe(2);
    expect(counts.sectionOverrides, 'section overrides').toBe(1);

    // ── 16. Round-trip checks — non-trivial values come back exactly. ──
    const noteRow = await page.evaluate(async eid => {
      const sb = window._supabase;
      const r = await sb.from('note').select('body').eq('enrollment_id', eid).maybeSingle();
      return r.data;
    }, enrollmentIds[0]);
    expect(noteRow, 'note row exists').not.toBeNull();
    expect(noteRow.body, 'note body round-trips').toBe('Smoke note 1: solid effort this week.');

    const overrideRow = await page.evaluate(
      async ({ eid, secId }) => {
        const sb = window._supabase;
        const r = await sb
          .from('section_override')
          .select('level, reason')
          .eq('enrollment_id', eid)
          .eq('section_id', secId)
          .maybeSingle();
        return r.data;
      },
      { eid: enrollmentIds[0], secId: sectionId },
    );
    expect(overrideRow, 'section_override row exists').not.toBeNull();
    expect(Number(overrideRow.level), 'override level round-trips').toBe(4);
    expect(overrideRow.reason).toBe('Demonstrated mastery in capstone.');

    const tagScoreRow = await page.evaluate(
      async ({ eid, aid, tid }) => {
        const sb = window._supabase;
        const r = await sb
          .from('tag_score')
          .select('value')
          .eq('enrollment_id', eid)
          .eq('assessment_id', aid)
          .eq('tag_id', tid)
          .maybeSingle();
        return r.data;
      },
      { eid: enrollmentIds[0], aid: assessmentIds.tagged, tid: tagId },
    );
    expect(tagScoreRow, 'tag_score row exists').not.toBeNull();
    expect(Number(tagScoreRow.value), 'tag score value round-trips').toBe(4);

    const termRow = await page.evaluate(async eid => {
      const sb = window._supabase;
      const r = await sb
        .from('term_rating')
        .select('work_habits_rating, participation_rating')
        .eq('enrollment_id', eid)
        .eq('term', 1)
        .maybeSingle();
      return r.data;
    }, enrollmentIds[0]);
    expect(termRow, 'term_rating row exists').not.toBeNull();
    expect(termRow.work_habits_rating).toBe(3);
    expect(termRow.participation_rating).toBe(4);

    const customTagLabels = await page.evaluate(async cid => {
      const sb = window._supabase;
      const r = await sb.from('custom_tag').select('label').eq('course_id', cid);
      return (r.data || []).map(x => x.label).sort();
    }, courseId);
    expect(customTagLabels, 'custom-tag labels round-trip').toEqual(['Curiosity', 'Effort']);
  });
});
