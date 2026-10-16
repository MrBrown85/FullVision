/**
 * Categories and the letter grade (docs/grading-compliance-plan.md 1.4).
 * In a class with categories, work with no category counts toward no letter
 * grade. Deleting a category used to leave its work with none (category_id
 * is `on delete set null`). Like Schoology, the class manager now moves a
 * category's work to another category before deleting it, and lists work
 * that has no category so it can be given one.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-cats';

describe('category integrity', () => {
  var originalV2;
  var originalGetById;
  var deleted;
  var moveTarget;

  beforeEach(async () => {
    localStorage.clear();
    saveCourses({ [CID]: { id: CID, name: 'Math 10', gradingSystem: 'letter' } });
    _cache.assessments[CID] = [
      { id: 'x1', title: 'Quiz 1', categoryId: 'k1', tagIds: [] },
      { id: 'x2', title: 'Quiz 2', categoryId: 'k1', tagIds: [] },
      { id: 'x3', title: 'Old work', tagIds: [] },
      { id: 'x4', title: 'Homework 1', categoryId: 'k2', tagIds: [] },
    ];
    deleted = [];
    moveTarget = 'k2';
    originalV2 = { list: window.v2.listCategories, del: window.v2.deleteCategory };
    window.v2.listCategories = () =>
      Promise.resolve({
        data: [
          { id: 'k1', name: 'Tests', weight: 60, display_order: 0 },
          { id: 'k2', name: 'Homework', weight: 40, display_order: 1 },
        ],
      });
    window.v2.deleteCategory = id => {
      deleted.push(id);
      return Promise.resolve({ data: null, error: null });
    };
    originalGetById = document.getElementById;
    document.getElementById = id =>
      id === 'cm-cat-move-target' || id === 'cm-cat-uncat-target' ? { value: moveTarget } : originalGetById(id);

    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    _useSupabase = true;
    DashClassManager.openClassManager();
    await new Promise(r => setTimeout(r, 20));
    _useSupabase = false;
  });

  afterEach(() => {
    window.v2.listCategories = originalV2.list;
    window.v2.deleteCategory = originalV2.del;
    document.getElementById = originalGetById;
    DashClassManager.resetState();
  });

  const categoryOf = id => getAssessments(CID).find(a => a.id === id).categoryId;

  it('moves a category’s work before deleting it', async () => {
    DashClassManager.handleAction('cmCatDelete', { dataset: { idx: '0' } });
    // Nothing is deleted until the teacher picks where the work goes.
    expect(deleted).toEqual([]);

    DashClassManager.handleAction('cmCatMoveDelete', { dataset: { idx: '0' } });
    await new Promise(r => setTimeout(r, 20));

    expect(categoryOf('x1')).toBe('k2');
    expect(categoryOf('x2')).toBe('k2');
    expect(deleted).toEqual(['k1']);
    expect(getCategories(CID).map(c => c.id)).toEqual(['k2']);
  });

  it('deletes an unused category straight away', async () => {
    _cache.assessments[CID] = _cache.assessments[CID].filter(a => a.categoryId !== 'k1');
    DashClassManager.handleAction('cmCatDelete', { dataset: { idx: '0' } });
    await new Promise(r => setTimeout(r, 20));
    expect(deleted).toEqual(['k1']);
  });

  it('gives work with no category the one the teacher picks', () => {
    DashClassManager.handleAction('cmCatAssignUncategorized', { dataset: {} });
    expect(categoryOf('x3')).toBe('k2');
    expect(categoryOf('x1')).toBe('k1');
  });
});
