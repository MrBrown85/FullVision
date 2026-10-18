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

  it('links the source and its copies with one copy group', async () => {
    const done = await RubricLibrary.copyTo(A, labRubric(), [B]);
    const src = getRubrics(A)[0];
    expect(src.copyGroup).toMatch(/^[0-9a-f-]{36}$/);
    expect(done[0].rubric.copyGroup).toBe(src.copyGroup);
    expect(getRubrics(B)[0].copyGroup).toBe(src.copyGroup);
    expect(RubricLibrary.localCopies(A, src)).toEqual([
      { cid: B, rubricId: getRubrics(B)[0].id, className: 'Science 8 B' },
    ]);
    expect(RubricLibrary.deleteNote(A, src)).toBe(' It is also in Science 8 B; that copy stays.');
    expect(RubricLibrary.renderCopies(A, src)).toContain('Also in');
    // A second copy joins the same group.
    await RubricLibrary.copyTo(A, getRubrics(A)[0], [H]);
    expect(getRubrics(H)[1].copyGroup).toBe(src.copyGroup);
    const copies = await RubricLibrary.findCopies(A, getRubrics(A)[0]);
    expect(copies.map(c => c.cid).sort()).toEqual([B, H].sort());
  });

  describe('linked edit', () => {
    let before, copy;
    beforeEach(async () => {
      await RubricLibrary.copyTo(A, labRubric(), [B]);
      before = structuredClone(getRubrics(A)[0]);
      copy = getRubrics(B)[0];
    });

    it('carries descriptor, value, weight and name changes the copy still shares', () => {
      const after = structuredClone(before);
      after.name = 'Lab rubric v2';
      after.criteria[0].levels[4] = 'Designs independently';
      after.criteria[0].levelValues = { 4: 10 };
      after.criteria[1].weight = 2;
      const plan = RubricLibrary.planLinkedEdit(A, before, after, B, copy);
      expect(plan.changed).toBe(true);
      expect(plan.next.name).toBe('Lab rubric v2');
      expect(plan.next.criteria[0].levels[4]).toBe('Designs independently');
      expect(plan.next.criteria[0].levelValues).toEqual({ 4: 10 });
      expect(plan.next.criteria[1].weight).toBe(2);
      expect(plan.next.criteria[0].tagIds).toEqual(['b-t1', 'b-t2']);
      expect(plan.lines).toEqual([
        'Name → Lab rubric v2',
        'Descriptors of “Scientific inquiry” updated',
        'Point values of “Scientific inquiry” updated',
        'Weight of “Neatness” → 2',
      ]);
      expect(plan.skipped).toEqual([]);
    });

    it('leaves alone what the other class changed on its own', () => {
      copy.criteria[0].levels[4] = 'Their own wording';
      copy.name = 'Lab rubric (B)';
      const after = structuredClone(before);
      after.name = 'Lab rubric v2';
      after.criteria[0].levels[4] = 'Designs independently';
      after.criteria[0].levels[3] = 'Plans carefully';
      const plan = RubricLibrary.planLinkedEdit(A, before, after, B, copy);
      expect(plan.changed).toBe(false);
      expect(plan.next.criteria[0].levels[4]).toBe('Their own wording');
      expect(plan.skipped).toEqual(['name', 'the descriptors of “Scientific inquiry”']);
    });

    it('adds a new criterion with matched competencies and removes an unscored one', () => {
      const after = structuredClone(before);
      after.criteria.splice(1, 1); // Neatness removed, no scores in B
      after.criteria.push({
        id: 'a-c3',
        name: 'Safety',
        tagIds: ['a-t2'],
        weight: 1,
        levels: { 4: 'x', 3: '', 2: '', 1: '' },
      });
      const plan = RubricLibrary.planLinkedEdit(A, before, after, B, copy);
      expect(plan.lines).toEqual(['Remove criterion “Neatness”', 'Add criterion “Safety”']);
      expect(plan.next.criteria.map(c => c.name)).toEqual(['Scientific inquiry', 'Safety']);
      expect(plan.next.criteria[1].tagIds).toEqual(['b-t2']);
      expect(plan.next.criteria[1].id).not.toBe('a-c3');
      expect(plan.removals).toEqual([{ id: copy.criteria[1].id, name: 'Neatness', students: 0, index: 0 }]);
    });

    it('keeps a scored criterion in the copy unless the teacher removes it too', () => {
      _cache.assessments[B] = [{ id: 'b-a1', name: 'Lab 1', rubricId: copy.id }];
      _cache.scores[B] = { st1: [{ assessmentId: 'b-a1', tagId: copy.criteria[1].id, score: 3 }] };
      const after = structuredClone(before);
      after.criteria.splice(1, 1);
      const plan = RubricLibrary.planLinkedEdit(A, before, after, B, copy);
      expect(plan.changed).toBe(true);
      expect(plan.lines).toEqual([]);
      expect(plan.next.criteria.map(c => c.name)).toEqual(['Scientific inquiry', 'Neatness']);
      expect(plan.removals[0]).toMatchObject({ name: 'Neatness', students: 1 });
    });

    it('matches a renamed criterion by position when names differ', () => {
      copy.criteria[0].name = 'Inquiry (B)';
      const after = structuredClone(before);
      after.criteria[0].levels[2] = 'Follows with help';
      const plan = RubricLibrary.planLinkedEdit(A, before, after, B, copy);
      expect(plan.next.criteria[0].levels[2]).toBe('Follows with help');
      expect(plan.lines).toEqual(['Descriptors of “Scientific inquiry” updated']);
    });
  });

  it('skips the source class and ignores unknown targets', async () => {
    const done = await RubricLibrary.copyTo(A, labRubric(), [A, '', B]);
    expect(done.map(d => d.dstCid)).toEqual([B]);
    expect(getRubrics(A)).toHaveLength(1);
  });
});
