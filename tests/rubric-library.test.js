/**
 * One rubric in several classes (teacher/rubric-library.js). A rubric is
 * copied into another class with its competencies matched by name; what
 * has no match is listed, and a same-named rubric in the target gives the
 * copy a numbered name. Copies have their own ids, so scores stay put.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const A = 'cls-sci8-a';
const B = 'cls-sci8-b';
const H = 'cls-hist12';

function section(id, name, tags) {
  return {
    id: id,
    name: name,
    color: '#123456',
    tags: tags.map(function (t) {
      return { id: t[0], label: t[1], text: t[1] + ' text' };
    }),
  };
}

function seedClass(cid, opts) {
  _cache.categories[cid] = [];
  _cache.learningMaps[cid] = { subjects: [], sections: opts.sections || [], _customized: true, _version: 1 };
  _cache.rubrics[cid] = opts.rubrics || [];
  _cache.modules[cid] = [];
  _cache.assessments[cid] = opts.assessments || [];
}

function labRubric() {
  return {
    id: 'a-rub',
    name: 'Lab rubric',
    criteria: [
      {
        id: 'a-c1',
        name: 'Scientific inquiry',
        tagIds: ['a-t1', 'a-t2'],
        weight: 1,
        levels: { 4: 'Designs', 3: 'Plans', 2: 'Follows', 1: 'Joins' },
      },
      { id: 'a-c2', name: 'Neatness', tagIds: [], weight: 0.5, levels: { 4: '', 3: '', 2: '', 1: '' } },
    ],
  };
}

describe('rubric library', () => {
  beforeEach(() => {
    localStorage.clear();
    _useSupabase = false;
    globalThis.initData = () => Promise.resolve();
    saveCourses({
      [A]: { id: A, name: 'Science 8 - Block A' },
      [B]: { id: B, name: 'Science 8 B' },
      [H]: { id: H, name: 'History 12' },
    });
    seedClass(A, {
      sections: [
        section('a-s1', 'Questioning', [
          ['a-t1', 'Question and predict'],
          ['a-t2', 'Plan investigations'],
        ]),
      ],
      rubrics: [labRubric()],
    });
    seedClass(B, {
      sections: [
        section('b-s1', 'Questioning', [
          ['b-t1', 'Question and predict'],
          ['b-t2', 'Plan investigations'],
        ]),
      ],
    });
    seedClass(H, {
      sections: [section('h-s1', 'Significance', [['h-t1', 'Assess significance']])],
      rubrics: [{ id: 'h-rub', name: 'lab rubric', criteria: [{ id: 'h-c1', name: 'Other', tagIds: [] }] }],
    });
  });

  it('matches every competency in the other section of the course', () => {
    const plan = RubricLibrary.planCopy(A, labRubric(), B);
    expect(plan.name).toBe('Lab rubric');
    expect(plan.collision).toBe(false);
    expect(plan.matchedCount).toBe(2);
    expect(plan.tagCount).toBe(2);
    expect(plan.mostlyDropped).toBe(false);
    expect(plan.criteria[0].matched).toEqual(['Question and predict', 'Plan investigations']);
    expect(plan.criteria[0].dropped).toEqual([]);
    expect(RubricLibrary.summaryLines(plan)).toEqual(['2 criteria, 2 of 2 competencies matched']);
  });

  it('lists what a different course cannot match and renames on a name clash', () => {
    const plan = RubricLibrary.planCopy(A, labRubric(), H);
    expect(plan.name).toBe('Lab rubric (2)');
    expect(plan.collision).toBe(true);
    expect(plan.matchedCount).toBe(0);
    expect(plan.mostlyDropped).toBe(true);
    expect(plan.criteria[0].dropped).toEqual(['Question and predict', 'Plan investigations']);
    const lines = RubricLibrary.summaryLines(plan);
    expect(lines[0]).toBe('2 criteria, 0 of 2 competencies matched');
    expect(lines[1]).toBe('This class teaches a different course; most competencies will be left off.');
    expect(lines[2]).toBe('History 12 already has a rubric with this name; the copy will be called Lab rubric (2).');
  });

  it('numbers past every taken name', () => {
    const existing = [{ name: 'Lab rubric' }, { name: 'Lab rubric (2)' }];
    expect(RubricLibrary.uniqueName('Lab rubric', existing)).toBe('Lab rubric (3)');
    expect(RubricLibrary.uniqueName('Essay rubric', existing)).toBe('Essay rubric');
  });

  it('copies with new ids, mapped competencies and the descriptors intact', async () => {
    const done = await RubricLibrary.copyTo(A, labRubric(), [B, H]);
    expect(done.map(d => d.dstCid)).toEqual([B, H]);
    const inB = getRubrics(B);
    expect(inB).toHaveLength(1);
    expect(inB[0].id).not.toBe('a-rub');
    expect(inB[0].criteria[0].id).not.toBe('a-c1');
    expect(inB[0].criteria[0].tagIds).toEqual(['b-t1', 'b-t2']);
    expect(inB[0].criteria[0].levels[4]).toBe('Designs');
    expect(inB[0].criteria[1].weight).toBe(0.5);
    const inH = getRubrics(H);
    expect(inH).toHaveLength(2);
    expect(inH[1].name).toBe('Lab rubric (2)');
    expect(inH[1].criteria[0].tagIds).toEqual([]);
    // The source is untouched.
    expect(getRubrics(A)[0].criteria[0].tagIds).toEqual(['a-t1', 'a-t2']);
  });

  it('skips the source class and ignores unknown targets', async () => {
    const done = await RubricLibrary.copyTo(A, labRubric(), [A, '', B]);
    expect(done.map(d => d.dstCid)).toEqual([B]);
    expect(getRubrics(A)).toHaveLength(1);
  });
});
