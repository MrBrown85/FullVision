/**
 * One assessment in several classes (teacher/assessment-copy.js,
 * migrations/20261018_assessment_copy_group.sql). A teacher with two
 * sections of the same course creates an assessment once and adds it to the
 * other class. Category, competencies, rubric and module are matched by name;
 * the copies share a copyGroup so an edit can offer to update the others.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
    // Defaults to the first category in display order.
    expect(plan.category.id).toBe('b-quiz');
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
