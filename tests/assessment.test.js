/**
 * assessment: the tests that were tests/assessment-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

describe('assessment-category-share', () => {
  /**
   * An assessment's share of its category (assessmentCategoryShare), for the
   * share bar under the assessment form's scoring. A CSL-expert teacher asked
   * to set an exact Factor ("I often use 70% and 30%"); the bar shows what a
   * Factor means. The share must be what the course % does: a student with
   * full marks on this one and nothing on the rest gets exactly its share.
   */

  const CID = 'course-share';
  const SID = 'stu-1';

  function seed({ mode, assessments, categories, scores, gradingSystem }) {
    COURSES[CID] = { id: CID, name: 'Chemistry 11', gradingSystem: gradingSystem || 'letter' };
    _cache.courseConfigs[CID] = { roundPercent: false };
    _cache.categories[CID] = categories || [
      { id: 'k-tests', name: 'Unit Tests', weight: 80, displayOrder: 0, calcMode: mode },
      { id: 'k-hw', name: 'Homework', weight: 20, displayOrder: 1 },
    ];
    _cache.rubrics[CID] = [];
    _cache.assessments[CID] = assessments || [];
    _cache.scores[CID] = { [SID]: scores || [] };
    _cache.statuses[CID] = {};
    clearProfCache();
  }

  const test1 = factor => ({
    id: 'a1',
    title: 'Unit Test 1',
    scoreMode: 'points',
    maxPoints: 50,
    weight: factor,
    categoryId: 'k-tests',
  });
  const test2 = { id: 'a2', title: 'Unit Test 2', scoreMode: 'points', maxPoints: 50, categoryId: 'k-tests' };
  const hw = { id: 'h1', title: 'Homework 1', scoreMode: 'points', maxPoints: 10, categoryId: 'k-hw' };

  // Full marks on a1, nothing on a2: the category's % is a1's share.
  const fullOnFirst = [
    { assessmentId: 'a1', tagId: 'a1', score: 50, date: '2026-10-01' },
    { assessmentId: 'a2', tagId: 'a2', score: 0, date: '2026-10-02' },
  ];

  describe('assessmentCategoryShare', () => {
    beforeEach(() => localStorage.clear());

    it('is points × Factor over the category in a Total Points category', () => {
      seed({ assessments: [test1(2.3), test2, hw] });
      const info = assessmentCategoryShare(CID, test1(2.3));
      expect(info.kind).toBe('share');
      expect(info.mode).toBe('points');
      expect(info.category).toBe('Unit Tests');
      // 115 / (115 + 50)
      expect(info.share).toBeCloseTo(115 / 165, 10);
      expect(formatShare(info.share, true)).toBe('≈ 70%');
      expect(info.parts.map(p => [p.title, p.self, Math.round(p.share * 100)])).toEqual([
        ['Unit Test 1', true, 70],
        ['Unit Test 2', false, 30],
      ]);
    });

    it('matches the course % for two assessments in a Total Points category', () => {
      seed({
        assessments: [test1(2.3), test2],
        categories: [{ id: 'k-tests', name: 'Unit Tests', weight: 100, displayOrder: 0 }],
        scores: fullOnFirst,
      });
      const share = assessmentCategoryShare(CID, test1(2.3)).share;
      expect(getCourseLetterData(CID, SID).R).toBeCloseTo(share * 100, 1);
    });

    it('is Factor over the sum of Factors in an Average of Percentages category', () => {
      seed({
        mode: 'percent',
        assessments: [test1(2.3), { ...test2, maxPoints: 10 }, hw],
      });
      const info = assessmentCategoryShare(CID, test1(2.3));
      expect(info.mode).toBe('percent');
      // Points don't matter here: 2.3 / (2.3 + 1)
      expect(info.share).toBeCloseTo(2.3 / 3.3, 10);
      expect(formatShare(info.share, true)).toBe('≈ 70%');
    });

    it('matches the course % for two assessments in an Average of Percentages category', () => {
      seed({
        mode: 'percent',
        assessments: [test1(2.3), { ...test2, maxPoints: 20 }],
        categories: [{ id: 'k-tests', name: 'Unit Tests', weight: 100, displayOrder: 0, calcMode: 'percent' }],
        scores: [
          { assessmentId: 'a1', tagId: 'a1', score: 50, date: '2026-10-01' },
          { assessmentId: 'a2', tagId: 'a2', score: 0, date: '2026-10-02' },
        ],
      });
      const share = assessmentCategoryShare(CID, test1(2.3)).share;
      expect(getCourseLetterData(CID, SID).R).toBeCloseTo(share * 100, 1);
    });

    it("uses the form's live values in place of the saved assessment", () => {
      seed({ assessments: [test1(1), test2] });
      // Saved at 1 (50%); the form now says 3 and 100 points.
      const info = assessmentCategoryShare(CID, { ...test1(3), maxPoints: 100 });
      expect(info.share).toBeCloseTo(300 / 350, 10);
      expect(info.parts).toHaveLength(2);
    });

    it('counts a new assessment beside every one in its category', () => {
      seed({ assessments: [test1(1), test2, hw] });
      const info = assessmentCategoryShare(CID, {
        title: 'Unit Test 3',
        scoreMode: 'points',
        maxPoints: 50,
        weight: 1,
        categoryId: 'k-tests',
      });
      expect(info.share).toBeCloseTo(1 / 3, 10);
      expect(info.parts.map(p => p.title)).toEqual(['Unit Test 3', 'Unit Test 1', 'Unit Test 2']);
    });

    it('is all of a category it is alone in', () => {
      seed({ assessments: [hw] });
      const info = assessmentCategoryShare(CID, test1(2.3));
      expect(info.share).toBe(1);
      expect(formatShare(info.share, true)).toBe('100%');
    });

    it('covers the whole course % in a class with no categories', () => {
      seed({ assessments: [test1(1), test2], categories: [] });
      const info = assessmentCategoryShare(CID, test1(1));
      expect(info.category).toBe(null);
      expect(info.share).toBe(0.5);
    });

    it('leaves DIBELS work out of the others', () => {
      seed({ assessments: [test1(1), { id: 'd1', title: 'DIBELS', scoreMode: 'dibels', categoryId: 'k-tests' }] });
      expect(assessmentCategoryShare(CID, test1(1)).parts).toHaveLength(1);
    });

    it('names work with no category or in a 0% category, and is null with no % shown', () => {
      seed({ assessments: [test2] });
      expect(assessmentCategoryShare(CID, { ...test1(2), categoryId: '' })).toEqual({ kind: 'uncategorized' });
      seed({
        assessments: [test2],
        categories: [
          { id: 'k-tests', name: 'Practice', weight: 0, displayOrder: 0 },
          { id: 'k-hw', name: 'Homework', weight: 100, displayOrder: 1 },
        ],
      });
      expect(assessmentCategoryShare(CID, test1(2))).toEqual({ kind: 'zero', category: 'Practice' });
      expect(assessmentCategoryShare(CID, { ...test1(2), scoreMode: 'dibels' })).toBe(null);
      seed({ assessments: [test2], gradingSystem: 'proficiency' });
      expect(assessmentCategoryShare(CID, test1(2))).toBe(null);
    });
  });

  describe('formatShare and formatFactor', () => {
    it('writes a share as a whole percent, ≈ only when it rounds', () => {
      expect(formatShare(0.5, true)).toBe('50%');
      expect(formatShare(0.697, true)).toBe('≈ 70%');
      expect(formatShare(0.697, false)).toBe('70%');
      expect(formatShare(0.003, true)).toBe('< 1%');
      expect(formatShare(0, true)).toBe('0%');
    });

    it('writes any Factor cleanly', () => {
      expect(formatFactor(2.3)).toBe('2.3×');
      expect(formatFactor(1)).toBe('1×');
      expect(formatFactor(0.5)).toBe('0.5×');
      expect(formatFactor(0.1 + 0.2)).toBe('0.3×');
      expect(formatFactor('1.25')).toBe('1.25×');
      expect(formatFactor(0)).toBe('1×');
    });
  });
});

describe('assessment-copy', () => {
  /**
   * One assessment in several classes (teacher/assessment-copy.js,
   * migrations/20261018_assessment_copy_group.sql). A teacher with two
   * sections of the same course creates an assessment once and adds it to the
   * other class. Category, competencies, rubric and module are matched by name;
   * the copies share a copyGroup so an edit can offer to update the others.
   */

  const A = 'cls-eng9-a';
  const B = 'cls-eng9-b';
  const H = 'cls-hist12';
  const OLD = 'cls-old';

  function section(id, name, tagId, label) {
    return { id: id, name: name, color: '#123456', tags: [{ id: tagId, label: label, text: label + ' text' }] };
  }

  function seedClass(cid, opts) {
    _cache.categories[cid] = opts.categories || [];
    _cache.learningMaps[cid] = { subjects: [], sections: opts.sections || [], _customized: true, _version: 1 };
    _cache.rubrics[cid] = opts.rubrics || [];
    _cache.modules[cid] = opts.modules || [];
    _cache.assessments[cid] = opts.assessments || [];
  }

  describe('assessment copies across classes', () => {
    var originalInit;

    beforeEach(() => {
      localStorage.clear();
      _useSupabase = false;
      originalInit = globalThis.initData;
      // The classes are already in the cache; loading is a no-op here.
      globalThis.initData = () => Promise.resolve();
      saveCourses({
        [A]: { id: A, name: 'English 9 - Block A' },
        [B]: { id: B, name: 'English 9 B' },
        [H]: { id: H, name: 'History 12' },
        [OLD]: { id: OLD, name: 'English 9 2025', archived: true },
      });
      seedClass(A, {
        categories: [
          { id: 'a-quiz', name: 'Quizzes', weight: 40, displayOrder: 0 },
          { id: 'a-ess', name: 'Essays', weight: 60, displayOrder: 1 },
        ],
        sections: [
          section('a-s1', 'Comprehend and connect', 'a-t1', 'Reading strategies'),
          section('a-s2', 'Create and communicate', 'a-t2', 'Writing process'),
          section('a-s3', 'Create and communicate', 'a-t3', 'Oral presentation'),
        ],
        rubrics: [
          {
            id: 'a-rub',
            name: 'Essay rubric',
            criteria: [{ id: 'a-c1', name: 'Ideas', tagIds: ['a-t2'], weight: 1 }],
          },
        ],
        modules: [{ id: 'a-mod', name: 'Short stories' }],
      });
      seedClass(B, {
        categories: [
          { id: 'b-ess', name: 'essays', weight: 50, displayOrder: 1 },
          { id: 'b-quiz', name: 'Tests', weight: 50, displayOrder: 0 },
        ],
        sections: [
          section('b-s1', 'Comprehend and connect', 'b-t1', 'Reading strategies'),
          section('b-s2', 'Create and communicate', 'b-t2', 'Writing process'),
        ],
        modules: [{ id: 'b-mod', name: 'short stories' }],
      });
      seedClass(H, { categories: [] });
    });

    afterEach(() => {
      globalThis.initData = originalInit;
    });

    const essay = () => ({
      id: 'asm-1',
      title: 'Personal essay',
      date: '2026-10-20',
      dateAssigned: '2026-10-20',
      dueDate: '2026-10-27',
      categoryId: 'a-ess',
      tagIds: ['a-t1', 'a-t2', 'a-t3'],
      rubricId: 'a-rub',
      moduleId: 'a-mod',
      scoreMode: 'points',
      maxPoints: 20,
      evidenceType: 'written',
      copyGroup: '11111111-2222-4333-8444-555555555555',
    });

    it('suggests the other section of the same course first and leaves out archived classes', () => {
      var t = AssessmentCopy.copyTargets(A);
      expect(t.sameCourse.map(c => c.id)).toEqual([B]);
      expect(t.other.map(c => c.id)).toEqual([H]);
    });

    it('treats block, section and period labels as the same course', () => {
      var key = AssessmentCopy._courseKey;
      expect(key('English 9 - Block A')).toBe('english 9');
      expect(key('English 9 (B)')).toBe('english 9');
      expect(key('English 9 Period 3')).toBe('english 9');
      expect(key('History 12')).toBe('history 12');
    });

    it('matches category, competencies and module by name and lists what it cannot match', () => {
      var plan = AssessmentCopy.planCopy(A, essay(), B);
      expect(plan.category.id).toBe('b-ess');
      expect(plan.category.needsChoice).toBe(false);
      expect(plan.tagIds).toEqual(['b-t1', 'b-t2']);
      expect(plan.droppedTags).toEqual(['Oral presentation']);
      expect(plan.moduleId).toBe('b-mod');
      expect(plan.rubric.mode).toBe('copy');
      expect(plan.needsReview).toBe(true);
      expect(plan.notes.join(' ')).toMatch(/Oral presentation/);
      expect(plan.notes.join(' ')).toMatch(/Essay rubric/);
    });

    it('asks for a category when the other class has none of that name', () => {
      var a = Object.assign(essay(), { categoryId: 'a-quiz' });
      var plan = AssessmentCopy.planCopy(A, a, B);
      expect(plan.category.needsChoice).toBe(true);
      // The teacher picks it: nothing is chosen for them.
      expect(plan.category.id).toBe(null);
      expect(plan.category.required).toBe(true);
    });

    it('needs no category in a class that has none', () => {
      var plan = AssessmentCopy.planCopy(A, essay(), H);
      expect(plan.category.id).toBe(null);
      expect(plan.category.needsChoice).toBe(false);
      expect(plan.tagIds).toEqual([]);
    });

    it('builds the copy with the link, the class dates and a rubric clone with mapped competencies', () => {
      var a = essay();
      var plan = AssessmentCopy.planCopy(A, a, B);
      var built = AssessmentCopy.buildCopy(a, plan, { dateAssigned: '2026-10-21', dueDate: '2026-10-29' }, a.copyGroup);
      expect(built.assessment.id).not.toBe(a.id);
      expect(built.assessment.copyGroup).toBe(a.copyGroup);
      expect(built.assessment.dateAssigned).toBe('2026-10-21');
      expect(built.assessment.date).toBe('2026-10-21');
      expect(built.assessment.dueDate).toBe('2026-10-29');
      expect(built.assessment.categoryId).toBe('b-ess');
      expect(built.assessment.scoreMode).toBe('points');
      expect(built.assessment.maxPoints).toBe(20);
      expect(built.rubric).toBeTruthy();
      expect(built.rubric.id).not.toBe('a-rub');
      expect(built.rubric.criteria[0].tagIds).toEqual(['b-t2']);
      expect(built.assessment.rubricId).toBe(built.rubric.id);
    });

    it('uses the same dates when none are given for the class', () => {
      var a = essay();
      var built = AssessmentCopy.buildCopy(a, AssessmentCopy.planCopy(A, a, B), null, a.copyGroup);
      expect(built.assessment.dateAssigned).toBe('2026-10-20');
      expect(built.assessment.dueDate).toBe('2026-10-27');
    });

    it('saves the copy into the other class and never copies scores', () => {
      var a = essay();
      _cache.scores[A] = { s1: [{ assessmentId: 'asm-1', score: 18 }] };
      AssessmentCopy.applyCopy(a, AssessmentCopy.planCopy(A, a, B), null, a.copyGroup);
      var copies = getAssessments(B).filter(x => x.copyGroup === a.copyGroup);
      expect(copies).toHaveLength(1);
      expect(copies[0].title).toBe('Personal essay');
      expect(getRubrics(B).map(r => r.name)).toEqual(['Essay rubric']);
      var bScores = getScores(B) || {};
      expect(JSON.stringify(bScores)).not.toMatch(/asm-1|18/);
    });

    it('copies to several classes and links them through the copy group', async () => {
      var a = essay();
      _cache.assessments[A] = [a];
      // No competencies or rubric to match and the category exists in B, so
      // there is nothing to review and the copies are saved straight away.
      var plans = await AssessmentCopy.copyToClasses(A, Object.assign({}, a, { tagIds: [], rubricId: '' }), [
        { cid: B },
        { cid: H, dateAssigned: '2026-11-02', dueDate: '' },
      ]);
      expect(plans).toHaveLength(2);
      expect(getAssessments(B).some(x => x.copyGroup === a.copyGroup)).toBe(true);
      var h = getAssessments(H).find(x => x.copyGroup === a.copyGroup);
      expect(h.dateAssigned).toBe('2026-11-02');
      expect(h.dueDate).toBeUndefined();
      var found = await AssessmentCopy.findCopies(A, a);
      expect(found.map(f => f.cid).sort()).toEqual([B, H].sort());
    });

    describe('editing a linked assessment', () => {
      it('carries changes the copy still shares, and leaves the copy’s own changes alone', () => {
        var before = essay();
        var after = Object.assign({}, before, {
          title: 'Personal essay (final)',
          dueDate: '2026-10-30',
          categoryId: 'a-quiz',
        });
        var copy = {
          id: 'b-1',
          title: 'Personal essay',
          date: '2026-10-21',
          dateAssigned: '2026-10-21',
          dueDate: '2026-10-29',
          categoryId: 'b-ess',
          tagIds: ['b-t1', 'b-t2'],
          scoreMode: 'points',
          maxPoints: 20,
          evidenceType: 'written',
          moduleId: 'b-mod',
          copyGroup: before.copyGroup,
        };
        var plan = AssessmentCopy.planLinkedEdit(A, before, after, B, copy);
        expect(plan.patch.title).toBe('Personal essay (final)');
        // B set its own due date, so it stays.
        expect(plan.patch.dueDate).toBeUndefined();
        expect(plan.skipped).toContain('due date');
        // "Quizzes" doesn't exist in B: reported, not guessed.
        expect(plan.patch.categoryId).toBeUndefined();
        expect(plan.skipped).toContain('category');
        expect(plan.changed).toBe(true);
      });

      it('maps a competency change by name', () => {
        var before = essay();
        var after = Object.assign({}, before, { tagIds: ['a-t1'] });
        var copy = Object.assign({}, before, {
          id: 'b-1',
          tagIds: ['b-t1', 'b-t2'],
          categoryId: 'b-ess',
          moduleId: 'b-mod',
        });
        var plan = AssessmentCopy.planLinkedEdit(A, before, after, B, copy);
        expect(plan.patch.tagIds).toEqual(['b-t1']);
      });

      it('applies the patch to the copy in its class', () => {
        _cache.assessments[B] = [{ id: 'b-1', title: 'Old', dueDate: '2026-10-29', copyGroup: 'g' }];
        AssessmentCopy.applyLinkedEdit(B, 'b-1', { title: 'New', dueDate: undefined });
        var row = getAssessments(B)[0];
        expect(row.title).toBe('New');
        expect('dueDate' in row).toBe(false);
      });
    });
  });

  describe('copy_group on the server write path', () => {
    it('sends copy_group in the update patch only when it is set', () => {
      var linked = _assessmentPatchOf({ title: 'x', copyGroup: '11111111-2222-4333-8444-555555555555' });
      expect(linked.copy_group).toBe('11111111-2222-4333-8444-555555555555');
      var plain = _assessmentPatchOf({ title: 'x' });
      expect('copy_group' in plain).toBe(false);
    });

    it('sends the Assignments list order and counts a reorder as a change', () => {
      expect(_assessmentPatchOf({ title: 'x', display_order: 3 }).display_order).toBe(3);
      expect(_assessmentPatchOf({ title: 'x' }).display_order).toBe(0);
      expect(_assessmentChanged({ title: 'x', display_order: 1 }, { title: 'x', display_order: 2 })).toBe(true);
      expect(_assessmentChanged({ title: 'x' }, { title: 'x', display_order: 0 })).toBe(false);
    });

    it('counts a new link as a change to save', () => {
      expect(_assessmentChanged({ title: 'x' }, { title: 'x', copyGroup: 'g' })).toBe(true);
      expect(_assessmentChanged({ title: 'x', copyGroup: 'g' }, { title: 'x', copyGroup: 'g' })).toBe(false);
    });

    it('reads copy_group from the class bundle', () => {
      var next = _assessmentFromDetail(
        { id: 'a1', title: 'T' },
        { assessment: { id: 'a1', copy_group: '11111111-2222-4333-8444-555555555555' }, linked_tags: [] },
      );
      expect(next.copyGroup).toBe('11111111-2222-4333-8444-555555555555');
    });
  });

  describe('the Classes row, card chips and sibling toggle', () => {
    const A = 'cls-eng9-a';
    const B = 'cls-eng9-b';
    const H = 'cls-hist12';

    beforeEach(() => {
      localStorage.clear();
      saveCourses({
        [A]: { id: A, name: 'English 9 - Block A' },
        [B]: { id: B, name: 'English 9 B' },
        [H]: { id: H, name: 'History 12' },
      });
      _cache.assessments[A] = [{ id: 'a1', title: 'Essay', copyGroup: 'g1', tagIds: [] }];
      _cache.assessments[B] = [{ id: 'b1', title: 'Essay', copyGroup: 'g1', tagIds: [] }];
      _cache.assessments[H] = [];
      [A, B, H].forEach(cid => {
        _cache.categories[cid] = [];
        _cache.rubrics[cid] = [];
        _cache.modules[cid] = [];
        _cache.learningMaps[cid] = { subjects: [], sections: [], _customized: true, _version: 1 };
      });
    });

    it('labels a section by what is left after the course name', () => {
      expect(AssessmentCopy.sectionLabel('English 9 - Block A')).toBe('Block A');
      expect(AssessmentCopy.sectionLabel('English 9 B')).toBe('B');
      expect(AssessmentCopy.sectionLabel('English 9 (Period 3)')).toBe('Period 3');
      expect(AssessmentCopy.sectionLabel('History 12')).toBe('History 12');
    });

    it('remembers the classes ticked last time, dropping ones that are gone', () => {
      AssessmentCopy.rememberTargets(A, [B, 'cls-deleted']);
      expect(AssessmentCopy.rememberedTargets(A)).toEqual([B]);
      AssessmentCopy.rememberTargets(A, []);
      expect(AssessmentCopy.rememberedTargets(A)).toEqual([]);
    });

    it('pre-ticks remembered classes for a new assessment but not when editing', () => {
      AssessmentCopy.rememberTargets(A, [B]);
      var fresh = AssessmentCopy.renderClassesField(A, null);
      expect(fresh).toMatch(/data-cid="cls-eng9-b" aria-pressed="true"/);
      var editing = AssessmentCopy.renderClassesField(A, { id: 'a1', title: 'Essay' });
      expect(editing).toMatch(/data-cid="cls-eng9-b" aria-pressed="false"/);
      expect(fresh).toMatch(/English 9 - Block A/);
      // Every class is a chip in the one row: no "More classes" drop-down.
      expect(fresh).not.toMatch(/More classes|Other classes|<details/);
      expect(fresh.match(/class="af-copy-chip[ "]/g).length).toBe(
        Object.keys(COURSES).filter(function (id) {
          return id !== A && !(COURSES[id] || {}).deletedAt && !(COURSES[id] || {}).archived;
        }).length + 1,
      );
    });

    it('finds local copies and builds the card chip, delete note and sibling toggle', () => {
      var copies = AssessmentCopy.localCopies(A, _cache.assessments[A][0]);
      expect(copies).toEqual([{ cid: B, assessmentId: 'b1', className: 'English 9 B' }]);
      var chip = AssessmentCopy.renderCardCopies(A, _cache.assessments[A][0]);
      expect(chip).toMatch(/data-action="openCopyIn"/);
      expect(chip).toMatch(/data-aid="b1"/);
      expect(chip).toMatch(/Also in B/);
      expect(AssessmentCopy.deleteNote(A, _cache.assessments[A][0])).toMatch(/also in English 9 B; that copy stays/);
      expect(AssessmentCopy.deleteNote(H, { id: 'x' })).toBe('');
      var toggle = AssessmentCopy.renderSiblingToggle(A);
      expect(toggle).toMatch(/Block A/);
      expect(toggle).toMatch(/data-cid="cls-eng9-b"/);
      expect(AssessmentCopy.renderSiblingToggle(H)).toBe('');
    });

    it('says a linked copy stays in the Gradebook delete dialog too', () => {
      // DECISIONS "One assessment in several classes" 9: every delete confirmation.
      const src = readFileSync('teacher/page-gradebook.js', 'utf-8');
      const branch = src.slice(
        src.indexOf("action === 'deleteAssess'"),
        src.indexOf('_deleteAssessWithUndo(activeCourse'),
      );
      expect(branch).toContain('AssessmentCopy.deleteNote(activeCourse, assess)');
      expect(branch).toMatch(/will be removed\.' \+\s+copyNote \+\s+' You can undo/);
    });

    it('describes a linked edit in plain words', () => {
      _cache.categories[B] = [{ id: 'bc', name: 'Essays', weight: 100, displayOrder: 0 }];
      var lines = AssessmentCopy.describePatch(B, {
        title: 'Essay (final)',
        dueDate: '2026-10-30',
        categoryId: 'bc',
        scoreMode: 'points',
        maxPoints: 20,
        rubricId: undefined,
      });
      expect(lines).toContain('Title → Essay (final)');
      expect(lines.some(l => /^Due date → /.test(l))).toBe(true);
      expect(lines).toContain('Category → Essays');
      expect(lines).toContain('Scoring → Points out of 20');
      expect(lines).toContain('Rubric → none');
    });
  });
});

describe('assessment-course-worth', () => {
  /**
   * What one assessment is worth in the course % (assessmentCourseWorth), for
   * the "Counts as 20 points in Current Events" line in the assignment form
   * and the grader. A rubric is worth its criteria's top points, so a
   * 5-criterion rubric is 20 and a 2-criterion one 8; in an Average of
   * Percentages category every assessment counts once.
   */

  const CID = 'course-worth';
  const crit = id => ({ id, name: id, tagIds: [], levels: { 4: '', 3: '', 2: '', 1: '' }, weight: 1 });

  function seed({ mode, categories, gradingSystem }) {
    _cache.rubrics[CID] = [
      { id: 'r5', name: 'Five', criteria: ['a', 'b', 'c', 'd', 'e'].map(crit) },
      { id: 'r2', name: 'Two', criteria: ['a', 'b'].map(crit) },
    ];
    _cache.categories[CID] = categories || [
      { id: 'k1', name: 'Current Events', weight: 100, displayOrder: 0, calcMode: mode },
    ];
    _cache.courseConfigs[CID] = {};
    COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: gradingSystem || 'letter' };
    clearProfCache();
  }

  describe('assessmentCourseWorth', () => {
    beforeEach(() => localStorage.clear());

    it("gives a rubric its criteria's points", () => {
      seed({});
      expect(assessmentCourseWorth(CID, { rubricId: 'r5', categoryId: 'k1' })).toEqual({
        kind: 'points',
        points: 20,
        base: 20,
        criteria: 5,
        factor: 1,
        category: 'Current Events',
      });
      expect(assessmentCourseWorth(CID, { rubricId: 'r2', categoryId: 'k1', weight: 2 })).toMatchObject({
        points: 16,
        base: 8,
        criteria: 2,
        factor: 2,
      });
    });

    it('gives points work its maximum and other proficiency work 4', () => {
      seed({});
      expect(assessmentCourseWorth(CID, { scoreMode: 'points', maxPoints: 36, categoryId: 'k1' })).toMatchObject({
        points: 36,
        criteria: null,
      });
      expect(assessmentCourseWorth(CID, { scoreMode: 'complete', categoryId: 'k1' })).toMatchObject({ points: 1 });
      expect(assessmentCourseWorth(CID, { categoryId: 'k1' })).toMatchObject({ points: 4 });
    });

    it('counts once in an Average of Percentages category', () => {
      seed({ mode: 'percent' });
      expect(assessmentCourseWorth(CID, { rubricId: 'r5', categoryId: 'k1' })).toEqual({
        kind: 'percent',
        factor: 1,
        category: 'Current Events',
      });
    });

    it('names work that counts toward no %', () => {
      seed({});
      expect(assessmentCourseWorth(CID, { rubricId: 'r5', categoryId: '' })).toEqual({ kind: 'uncategorized' });
      seed({ categories: [{ id: 'k1', name: 'Practice', weight: 0, displayOrder: 0 }] });
      expect(assessmentCourseWorth(CID, { categoryId: 'k1' })).toEqual({ kind: 'zero', category: 'Practice' });
      expect(assessmentCourseWorth(CID, { scoreMode: 'dibels', categoryId: 'k1' })).toBe(null);
    });

    it('counts toward the whole % in a class with no categories, and is null with no % shown', () => {
      seed({ categories: [] });
      expect(assessmentCourseWorth(CID, { rubricId: 'r2' })).toMatchObject({
        kind: 'points',
        points: 8,
        category: null,
      });
      seed({ gradingSystem: 'proficiency' });
      expect(assessmentCourseWorth(CID, { rubricId: 'r2', categoryId: 'k1' })).toBe(null);
    });
  });
});

describe('assessment-factor', () => {
  /**
   * Every assessment has a Factor, as in Schoology (docs/DECISIONS.md,
   * Assessment Factor, 2026-10-25; supersedes D2). Its points earned and
   * possible are multiplied in the course %, and its scores count that many
   * times toward competencies and level averages.
   */

  const CID = 'course-factor';
  const SID = 'stu-1';
  const TAG = 'tag-1';

  describe('getAssessmentWeight', () => {
    it('uses the Factor on every kind of scoring', () => {
      expect(getAssessmentWeight({ weight: 2 })).toBe(2);
      expect(getAssessmentWeight({ scoreMode: 'proficiency', weight: 0.5 })).toBe(0.5);
      expect(getAssessmentWeight({ scoreMode: 'points', maxPoints: 6, weight: 4 })).toBe(4);
      expect(getAssessmentWeight({ score_mode: 'complete', weight: '1.5' })).toBe(1.5);
    });

    it('is 1 when unset, 0 or not a number', () => {
      expect(getAssessmentWeight({ scoreMode: 'proficiency' })).toBe(1);
      expect(getAssessmentWeight({ weight: 0 })).toBe(1);
      expect(getAssessmentWeight({ weight: 'x' })).toBe(1);
      expect(getAssessmentWeight(null)).toBe(1);
    });
  });

  function seedCourse(assessments, scores, categories) {
    saveCourses({ [CID]: { id: CID, name: 'English 12', calcMethod: 'mode', gradingSystem: 'letter' } });
    _cache.courseConfigs[CID] = { calcMethod: 'mode' };
    _cache.categories[CID] = categories || [];
    _cache.assessments[CID] = assessments;
    _cache.scores[CID] = { [SID]: scores };
    _cache.statuses[CID] = {};
    clearProfCache();
  }

  describe('Factor in the course %', () => {
    beforeEach(() => localStorage.clear());

    const iliad = factor => [
      { id: 'ann', title: 'Annotations', scoreMode: 'points', maxPoints: 6, weight: factor, tagIds: [TAG] },
      { id: 'qs', title: 'Questions', scoreMode: 'points', maxPoints: 24, tagIds: [TAG] },
    ];
    const scores = [
      { assessmentId: 'ann', tagId: TAG, score: 3, date: '2026-10-01' },
      { assessmentId: 'qs', tagId: TAG, score: 24, date: '2026-10-02' },
    ];

    it('multiplies points earned and possible', () => {
      // 3/6 at 4x is 12/24; with 24/24 that is 36/48 = 75%.
      seedCourse(iliad(4), scores);
      expect(getCourseLetterData(CID, SID).R).toBe(75);
    });

    it('counts once at 1', () => {
      // 27/30 = 90%.
      seedCourse(iliad(1), scores);
      expect(getCourseLetterData(CID, SID).R).toBe(90);
    });

    it('multiplies a proficiency level the same way', () => {
      seedCourse(
        [
          { id: 'essay', title: 'Essay', tagIds: [TAG], weight: 3 },
          { id: 'quiz', title: 'Quiz', scoreMode: 'points', maxPoints: 4, tagIds: [TAG] },
        ],
        [
          { assessmentId: 'essay', tagId: TAG, score: 2, date: '2026-10-01' },
          { assessmentId: 'quiz', tagId: TAG, score: 4, date: '2026-10-02' },
        ],
      );
      // 2/4 three times and 4/4: 10/16 = 62.5%.
      expect(getAssessmentGroupPercentage(CID, SID, _cache.assessments[CID]).pct).toBe(62.5);
    });

    it('applies inside a category', () => {
      seedCourse(
        iliad(4).map(a => ({ ...a, categoryId: 'sum' })),
        scores,
        [{ id: 'sum', name: 'Summative', weight: 100 }],
      );
      expect(getCourseLetterData(CID, SID).R).toBe(75);
    });
  });

  describe('Factor toward a competency level', () => {
    beforeEach(() => localStorage.clear());

    function level(levelFactor, pointsFactor) {
      seedCourse(
        [
          { id: 'lvl', title: 'Essay', tagIds: [TAG], type: 'summative', weight: levelFactor },
          {
            id: 'pts',
            title: 'Quiz',
            scoreMode: 'points',
            maxPoints: 10,
            tagIds: [TAG],
            type: 'summative',
            weight: pointsFactor,
          },
        ],
        [
          { assessmentId: 'lvl', tagId: TAG, score: 4, date: '2026-10-01', type: 'summative' },
          { assessmentId: 'pts', tagId: TAG, score: 5, date: '2026-10-02', type: 'summative' },
        ],
      );
      return getTagProficiency(CID, SID, TAG);
    }

    // Mode: the Essay's 4 and the Quiz's 2 (5/10) each count their Factor;
    // a tie goes to the most recent, the Quiz.
    it('counts proficiency work its Factor times', () => {
      expect(level(1, undefined)).toBe(2);
      expect(level(2, undefined)).toBe(4);
    });

    it('counts points work its Factor times', () => {
      expect(level(2, 3)).toBe(2);
    });

    it('weights a category average', () => {
      level(3, 1);
      // (3 × 4 + 1 × 2) / 4 = 3.5.
      expect(_factoredMeanLevel(CID, SID, _cache.assessments[CID]).mean).toBe(3.5);
      expect(assessmentGroupGrade(CID, SID, _cache.assessments[CID]).prof).toBe(3.5);
    });
  });
});

describe('assessment-group-grade', () => {
  /**
   * A student's grade on a group of assessments (a category, module,
   * assignment type or rubric), as the student page's Grade Breakdown tab and
   * the Assessments tab's Group By show it. The % is points earned out of
   * points possible, as the course % counts each category; the level is the
   * mean of the assessments' overall levels, as a category's average is.
   */

  const CID = 'course-groups';
  const A = 'stu-a';
  const B = 'stu-b';
  const TAG = 'tag-1';

  const points = (id, max, categoryId) => ({
    id,
    title: id,
    scoreMode: 'points',
    maxPoints: max,
    tagIds: [TAG],
    categoryId,
    type: 'summative',
  });
  const level = (id, categoryId, extra) =>
    Object.assign({ id, title: id, tagIds: [TAG], categoryId, type: 'summative' }, extra);
  const score = (assessmentId, value, mod) => ({
    assessmentId,
    tagId: TAG,
    score: value,
    mod: mod || 0,
    date: '2026-10-10',
  });

  function seed({ gradingSystem, categories, assessments, scores, rubrics, statuses }) {
    COURSES[CID] = { id: CID, name: 'Philosophy 12', gradingSystem: gradingSystem || 'letter' };
    _cache.categories[CID] = categories || [];
    _cache.assessments[CID] = assessments;
    _cache.scores[CID] = scores;
    _cache.statuses[CID] = statuses || {};
    _cache.rubrics[CID] = rubrics || [];
    _cache.courseConfigs[CID] = { roundPercent: false };
    clearProfCache();
  }

  describe('assessment group grades', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => {
      delete COURSES[CID];
    });

    const cats = [
      { id: 'tests', name: 'Tests', weight: 60 },
      { id: 'labs', name: 'Labs', weight: 40 },
    ];
    const work = [points('t1', 20, 'tests'), points('t2', 30, 'tests'), points('l1', 10, 'labs')];

    it('counts points earned out of possible and shows the letter in a Letter class', () => {
      seed({
        categories: cats,
        assessments: work,
        scores: { [A]: [score('t1', 15), score('t2', 18), score('l1', 9)] },
      });
      const g = assessmentGroupGrade(CID, A, work.slice(0, 2));
      // 33 of 50
      expect(g.pct).toBeCloseTo(66, 5);
      expect(g.text).toBe('C 66%');
      expect(g.level).toBe(2);
    });

    it('shows the level in a Proficiency class and both in a Both class', () => {
      const lv = [level('x', 'tests'), level('y', 'tests')];
      seed({ gradingSystem: 'proficiency', assessments: lv, scores: { [A]: [score('x', 3), score('y', 2)] } });
      expect(assessmentGroupGrade(CID, A, lv).text).toBe('2.5');
      seed({ gradingSystem: 'both', assessments: lv, scores: { [A]: [score('x', 3), score('y', 2)] } });
      // 5 of 8 points
      expect(assessmentGroupGrade(CID, A, lv).text).toBe('2.5 · C 62.5%');
    });

    it('is null when nothing in the group is scored', () => {
      seed({ assessments: work, scores: { [A]: [] } });
      expect(assessmentGroupGrade(CID, A, work)).toBeNull();
    });

    it('averages the class and says how a student sits against it', () => {
      seed({
        categories: cats,
        assessments: work,
        scores: { [A]: [score('t1', 10)], [B]: [score('t1', 20)] },
      });
      const list = [work[0]];
      const mine = assessmentGroupGrade(CID, A, list);
      const cls = classAssessmentGroupGrade(CID, [A, B], list);
      expect(cls.pct).toBeCloseTo(75, 5);
      expect(groupGradeGap(CID, mine, cls).text).toBe('25.0% below class');
      expect(groupGradeGap(CID, cls, cls).text).toBe('Same as class');
    });

    it("splits the course % into each category's share", () => {
      seed({
        categories: cats,
        assessments: work,
        scores: { [A]: [score('t1', 15), score('t2', 18), score('l1', 9)] },
      });
      const shares = categoryCourseShares(CID, A);
      // 60% × 66% and 40% × 90%
      expect(shares.tests.text).toBe('39.6');
      expect(shares.labs.text).toBe('36.0');
      expect(shares.tests.points + shares.labs.points).toBeCloseTo(getCourseLetterData(CID, A).R, 5);
    });

    it('reads one rubric criterion on one assessment, skipping excused work', () => {
      const rubric = {
        id: 'r1',
        name: 'Lab rubric',
        criteria: [{ id: 'c1', name: 'Inquiry', tagIds: [TAG], levels: { 4: '', 3: '', 2: '', 1: '' }, weight: 1 }],
      };
      const labs = [level('a1', 'labs', { rubricId: 'r1' }), level('a2', 'labs', { rubricId: 'r1' })];
      seed({
        assessments: labs,
        rubrics: [rubric],
        scores: { [A]: [score('a1', 3, 1), score('a2', 2)] },
        statuses: { [A + ':a2']: 'EXC' },
      });
      expect(rubricCriterionLevel(CID, A, labs[0], rubric.criteria[0])).toBeCloseTo(3 + 1 / 3, 5);
      expect(rubricCriterionLevel(CID, A, labs[1], rubric.criteria[0])).toBeNull();
    });

    it('compares a group with all of the student’s work and places it on the 0–4 scale', () => {
      seed({
        categories: cats,
        assessments: work,
        scores: { [A]: [score('t1', 15), score('t2', 18), score('l1', 9)] },
      });
      const all = assessmentGroupGrade(CID, A, work);
      const labs = assessmentGroupGrade(CID, A, [work[2]]);
      // 42 of 60 = 70%; labs 90%
      expect(groupGradeDiff(CID, labs, all)).toEqual({ value: 20, text: '+20.0%', dir: 1 });
      expect(groupGradeDiff(CID, all, labs).text).toBe('−20.0%');
      expect(groupGradeValue(CID, labs)).toBeCloseTo(3.6, 5);
      const lv = [level('x', 'tests'), level('y', 'tests')];
      seed({ gradingSystem: 'proficiency', assessments: lv, scores: { [A]: [score('x', 3), score('y', 2)] } });
      const g = assessmentGroupGrade(CID, A, lv);
      expect(groupGradeValue(CID, g)).toBe(2.5);
      expect(groupGradeDiff(CID, assessmentGroupGrade(CID, A, [lv[0]]), g).text).toBe('+0.5');
    });

    it('says where a run of scores started and where it is now', () => {
      const run = pairs => pairs.map(([t, v]) => ({ t, v }));
      // Over eight weeks: the first four weeks against the last four.
      const long = startAndNow(
        run([
          [0, 2],
          [10, 2],
          [27, 3],
          [40, 3],
          [70, 3],
          [84, 4],
        ]),
      );
      expect(long.start).toBeCloseTo(7 / 3, 5);
      expect(long.now).toBeCloseTo(3.5, 5);
      expect(long.startCount).toBe(3);
      // Under eight weeks: the two halves.
      const short = startAndNow(
        run([
          [0, 2],
          [10, 2],
          [20, 3],
          [30, 4],
        ]),
      );
      expect(short).toEqual({ start: 2, now: 3.5, startCount: 2, nowCount: 2 });
      // Too short to say.
      expect(
        startAndNow(
          run([
            [0, 2],
            [5, 3],
          ]),
        ),
      ).toBeNull();
      expect(startAndNow(run([[0, 2]]))).toBeNull();
    });

    it('averages score entries at the values the calculations use', () => {
      expect(averageLevels([{ score: 3 + 1 / 3, level: 3 }, { score: 2 }])).toBeCloseTo(8 / 3, 5);
      expect(averageLevels([{ score: 0 }])).toBeNull();
    });

    it('names a value by the nearest level a teacher can enter', () => {
      expect(nearestScoreLevel(3 + 1 / 3)).toEqual({ level: 3, text: '3+' });
      expect(nearestScoreLevel(2 + 2 / 3)).toEqual({ level: 3, text: '3−' });
      expect(nearestScoreLevel(2)).toEqual({ level: 2, text: '2' });
      expect(nearestScoreLevel(0).text).toBe('');
    });
  });
});
