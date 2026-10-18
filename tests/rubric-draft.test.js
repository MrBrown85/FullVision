/**
 * A rubric criterion drafted from a curricular competency
 * (shared/rubric-draft.js): named after it, linked to it, descriptors from
 * its I-can statements and the BC proficiency scale.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const metal = {
  id: 'tag-metal',
  label: 'Design Metal Objects Considering',
  i_can_statements: [
    'I can develop designs for metal fabrication',
    'I can consider metalworking process capabilities',
    'I can design for welding and joining methods',
    'I can design with material and cost constraints',
  ],
};

describe('rubric draft from a competency', () => {
  it('writes the four levels in the student voice from the I-can statements', () => {
    const d = RubricDraft.draftLevels(metal);
    expect(d.generic).toBe(false);
    expect(d.levels[4]).toBe(
      'Independently and in new situations, I can develop designs for metal fabrication, and I can explain my thinking to others.',
    );
    expect(d.levels[3]).toBe(
      'I can develop designs for metal fabrication. I can consider metalworking process capabilities. I can design for welding and joining methods.',
    );
    expect(d.levels[2]).toBe('In familiar situations and with some help, I can develop designs for metal fabrication.');
    expect(d.levels[1]).toBe('With support, I am beginning to develop designs for metal fabrication.');
  });

  it('keeps at most three statements in the Proficient column', () => {
    const d = RubricDraft.draftLevels(metal);
    expect(d.levels[3].split('I can ').length - 1).toBe(RubricDraft.MAX_PROFICIENT);
  });

  it('reads the server text when the class has no statement list', () => {
    const tag = { id: 't', label: 'Question and Predict', i_can_text: 'I can ask questions.\nI can make predictions.' };
    expect(RubricDraft.statementsOf(tag)).toEqual(['I can ask questions', 'I can make predictions']);
    expect(RubricDraft.draftLevels(tag).levels[3]).toBe('I can ask questions. I can make predictions.');
  });

  it('falls back to the scale words when there is no I-can text', () => {
    const d = RubricDraft.draftLevels({ id: 't', label: 'Collaboration' });
    expect(d.generic).toBe(true);
    expect(d.levels[1]).toBe('With support, I am beginning to show this competency.');
  });

  it('keeps a statement that does not start with "I can" as written', () => {
    expect(RubricDraft.actionOf('Use tools safely.')).toBe('Use tools safely');
    expect(RubricDraft.actionOf('  I can   trace   patterns. ')).toBe('trace patterns');
  });

  it('builds a criterion named after and linked to the competency', () => {
    let n = 0;
    const crit = RubricDraft.draftCriterion(metal, () => 'id' + ++n);
    expect(crit).toMatchObject({
      id: 'id1',
      name: 'Design Metal Objects Considering',
      tagIds: ['tag-metal'],
      weight: 1,
      levelValues: null,
    });
    expect(Object.keys(crit.levels).sort()).toEqual(['1', '2', '3', '4']);
  });

  it('knows an untouched criterion from one with work in it', () => {
    const blank = { name: 'Criterion 1', tagIds: [], levels: { 4: '', 3: '', 2: '', 1: '' } };
    expect(RubricDraft.isBlankCriterion(blank)).toBe(true);
    expect(RubricDraft.isBlankCriterion({ ...blank, name: 'Safety' })).toBe(false);
    expect(RubricDraft.isBlankCriterion({ ...blank, tagIds: ['t'] })).toBe(false);
    expect(RubricDraft.isBlankCriterion({ ...blank, levels: { 4: 'x' } })).toBe(false);
    expect(RubricDraft.hasDescriptors(blank)).toBe(false);
    expect(RubricDraft.hasDescriptors({ levels: { 2: ' some ' } })).toBe(true);
  });
});
