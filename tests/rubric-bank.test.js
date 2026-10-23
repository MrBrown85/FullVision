/**
 * The Rubric Bank window (teacher/rubric-bank.js): the list groups rubrics
 * by whether an assessment uses them, search matches names and linked
 * competencies, the grid follows the class's level order, and Duplicate and
 * Rename save within the class.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const A = 'cls-bank-a';
const B = 'cls-bank-b';

function seedClass(cid, opts) {
  _cache.categories[cid] = [];
  _cache.learningMaps[cid] = {
    subjects: [],
    sections: [
      {
        id: cid + '-s1',
        name: 'Questioning',
        color: '#123456',
        tags: [
          { id: cid + '-t1', label: 'Questioning and Predicting', text: 'Ask questions' },
          { id: cid + '-t2', label: 'Planning and Conducting', text: 'Plan' },
        ],
      },
    ],
    _customized: true,
    _version: 1,
  };
  _cache.rubrics[cid] = opts.rubrics || [];
  _cache.modules[cid] = [];
  _cache.assessments[cid] = opts.assessments || [];
}

function rubric(id, name, tagIds, extra) {
  return Object.assign(
    {
      id: id,
      name: name,
      criteria: [
        {
          id: id + '-c1',
          name: 'Question and Prediction',
          tagIds: tagIds,
          weight: 1,
          levels: { 4: 'Explains why', 3: 'Predicts', 2: 'Asks', 1: 'Asks with help' },
        },
      ],
    },
    extra || {},
  );
}

describe('Rubric Bank', () => {
  beforeEach(() => {
    localStorage.clear();
    _useSupabase = false;
    globalThis.initData = () => Promise.resolve();
    saveCourses({
      [A]: { id: A, name: 'Science 8' },
      [B]: { id: B, name: 'Science 8 Block D' },
    });
    seedClass(A, {
      rubrics: [
        rubric('r-lab', 'Lab Investigation Rubric', [A + '-t1'], { copyGroup: 'g1' }),
        rubric('r-graph', 'Graphing Rubric', [A + '-t2']),
        rubric('r-talk', 'Presentation Rubric', []),
      ],
      assessments: [
        { id: 'a1', title: 'Density Lab', date: '2026-09-18', rubricId: 'r-lab' },
        { id: 'a2', title: 'Pendulum Lab', date: '2026-10-02', rubricId: 'r-lab' },
        { id: 'a3', title: 'Talks', date: '2026-10-05', rubricId: 'r-talk' },
      ],
    });
    seedClass(B, { rubrics: [rubric('r-lab-b', 'Lab Investigation Rubric', [B + '-t1'], { copyGroup: 'g1' })] });
  });

  it('lists used rubrics before unused ones', () => {
    var g = RubricBank.groups(A, '');
    expect(g.used.map(r => r.id)).toEqual(['r-lab', 'r-talk']);
    expect(g.unused.map(r => r.id)).toEqual(['r-graph']);
  });

  it('lists the assessments that use a rubric, newest first', () => {
    expect(RubricBank.usesOf(A, 'r-lab').map(a => a.id)).toEqual(['a2', 'a1']);
    expect(RubricBank.rowMeta(A, getRubricById(A, 'r-lab'))).toBe('1 Criterion · 2 Assessments');
    expect(RubricBank.rowMeta(A, getRubricById(A, 'r-graph'))).toBe('1 Criterion · Not Used');
  });

  it('searches rubric names and linked competencies', () => {
    expect(RubricBank.groups(A, 'graph').unused.map(r => r.id)).toEqual(['r-graph']);
    var byCompetency = RubricBank.groups(A, 'planning');
    expect(byCompetency.used.length + byCompetency.unused.length).toBe(1);
    expect(byCompetency.unused[0].id).toBe('r-graph');
    var none = RubricBank.groups(A, 'zzz');
    expect(none.used.length + none.unused.length).toBe(0);
  });

  it('names the class a linked copy lives in', () => {
    expect(RubricBank.linkedLabel(A, getRubricById(A, 'r-lab'))).toBe('Linked With Science 8 Block D');
    expect(RubricBank.linkedLabel(A, getRubricById(A, 'r-graph'))).toBe('');
  });

  it('draws the grid in the class level order', () => {
    var r = getRubricById(A, 'r-lab');
    var desc = RubricBank.gridHtml(A, r);
    expect(desc.indexOf('Extending')).toBeLessThan(desc.indexOf('Emerging'));
    saveCourseConfig(A, Object.assign({}, getCourseConfig(A), { levelOrder: 'asc' }));
    var asc = RubricBank.gridHtml(A, r);
    expect(asc.indexOf('Emerging')).toBeLessThan(asc.indexOf('Extending'));
    expect(asc).toContain('Questioning and Predicting');
    expect(asc).toContain('Weight 1');
  });

  it('duplicates within the class with a numbered name and no link', () => {
    var copy = RubricBank.duplicate(A, 'r-lab');
    expect(copy.name).toBe('Lab Investigation Rubric (2)');
    expect(copy.copyGroup).toBeUndefined();
    expect(copy.id).not.toBe('r-lab');
    expect(copy.criteria[0].id).not.toBe('r-lab-c1');
    expect(getRubrics(A).length).toBe(4);
  });

  it('renames, refusing blanks and names another rubric has', () => {
    expect(RubricBank.rename(A, 'r-graph', '   ')).toBe(false);
    expect(RubricBank.rename(A, 'r-graph', 'lab investigation rubric')).toBe(false);
    expect(RubricBank.rename(A, 'r-graph', 'Data and Graphing Rubric')).toBe(true);
    expect(getRubricById(A, 'r-graph').name).toBe('Data and Graphing Rubric');
  });

  it('lists the other live classes', () => {
    expect(RubricBank.otherClasses(A).map(c => c.id)).toEqual([B]);
  });

  it('counts how many competencies match another class by name', () => {
    var lab = getRubricById(A, 'r-lab');
    expect(RubricBank.matchInfo(A, B, lab)).toEqual({ total: 1, matched: 1, byTag: { [A + '-t1']: true } });
    _cache.learningMaps[B].sections[0].tags[0].label = 'Something Else';
    _cache.learningMaps[B].sections[0].tags[0].text = 'Something else';
    var after = RubricBank.matchInfo(A, B, lab);
    expect(after.matched).toBe(0);
    expect(after.byTag[A + '-t1']).toBe(false);
  });

  it('marks chips with no match when showing another class rubric', () => {
    _cache.learningMaps[A].sections[0].tags[0].label = 'Something Else';
    _cache.learningMaps[A].sections[0].tags[0].text = 'Something else';
    var src = getRubricById(B, 'r-lab-b');
    var match = RubricBank.matchInfo(B, A, src);
    var html = RubricBank.gridHtml(A, src, { srcCid: B, match: match });
    expect(html).toContain('rb-chip is-missing');
    expect(html).toContain('Questioning and Predicting');
  });
});
