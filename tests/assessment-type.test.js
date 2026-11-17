/**
 * An assessment's Type (Colin, Nov 17: "There's no oral or presentation,
 * but there are media types ... maybe the teacher can just add more?").
 * The list in shared/constants.js, how stored words read (Audio as Oral,
 * nothing rewritten), the form's field (teacher/assessment-type-field.js)
 * and the Student page's Group By Type (teacher/student-groups.js).
 */
import './setup.js';
import { describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';

describe('the type list', () => {
  it('is the ten kinds of task, in the form order, with no media types', () => {
    expect(ASSESSMENT_TYPES.map(assessmentTypeLabel)).toEqual([
      'Written',
      'Test',
      'Quiz',
      'Project',
      'Lab',
      'Presentation',
      'Oral',
      'Performance',
      'Observation',
      'Conversation',
    ]);
    ['audio', 'video', 'photo'].forEach(t => expect(ASSESSMENT_TYPES).not.toContain(t));
  });

  it('reads Audio as Oral and keeps Video and Photo as their own word', () => {
    expect(assessmentTypeOf({ evidenceType: 'audio' })).toBe('oral');
    expect(assessmentTypeLabel('audio')).toBe('Oral');
    expect(assessmentTypeOf({ evidenceType: 'video' })).toBe('video');
    expect(assessmentTypeLabel('photo')).toBe('Photo');
  });

  it("matches a built-in whatever its case, and keeps a teacher's own word as typed", () => {
    expect(assessmentTypeKey('  ORAL ')).toBe('oral');
    expect(assessmentTypeKey('Socratic   Seminar')).toBe('Socratic Seminar');
    expect(assessmentTypeLabel('debate')).toBe('Debate');
    expect(assessmentTypeLabel('')).toBe('No Type');
    expect(assessmentTypeKey('x'.repeat(50))).toHaveLength(ASSESSMENT_TYPE_MAX_LENGTH);
  });

  it("lists a class's added types once each, A to Z, leaving out the list and retired words", () => {
    const added = addedAssessmentTypes([
      { evidenceType: 'Socratic Seminar' },
      { evidenceType: 'debate' },
      { evidenceType: 'Debate' },
      { evidenceType: 'written' },
      { evidenceType: 'audio' },
      { evidenceType: 'video' },
      { evidenceType: '' },
    ]);
    expect(added).toEqual(['debate', 'Socratic Seminar']);
  });
});

describe('the form field', () => {
  const field = (stored, assessments = []) => {
    const spy = vi.spyOn(globalThis, 'getAssessments').mockReturnValue(assessments);
    const { document } = parseHTML(
      '<!DOCTYPE html><html><body>' + AssessmentTypeField.fieldHtml('c1', stored) + '</body></html>',
    );
    spy.mockRestore();
    return document;
  };
  const values = doc => Array.from(doc.querySelectorAll('#af-evidence option')).map(o => o.value);

  it('is labelled Type, starts on Written for a new assessment and ends with Add a Type…', () => {
    const doc = field(undefined);
    expect(doc.querySelector('label[for="af-evidence"]').textContent).toBe('Type');
    expect(doc.querySelector('#af-evidence option[selected]').value).toBe('written');
    expect(values(doc)).toEqual(ASSESSMENT_TYPES.concat([AssessmentTypeField.ADD]));
    expect(doc.querySelector('#af-evidence option:last-child').textContent).toBe('Add a Type…');
    expect(doc.querySelector('#af-type-add').hasAttribute('hidden')).toBe(true);
  });

  it('shows an Audio assessment as Oral, so saving with no change writes nothing', () => {
    const doc = field('audio');
    expect(doc.querySelector('#af-evidence option[selected]').value).toBe('oral');
    expect(values(doc)).not.toContain('audio');
  });

  it('offers Video only on the assessment that has it', () => {
    expect(values(field('video'))).toContain('video');
    expect(values(field('written', [{ evidenceType: 'video' }]))).not.toContain('video');
  });

  it("puts the class's added types under This Class, with this one chosen", () => {
    const doc = field('Debate', [{ evidenceType: 'Socratic Seminar' }]);
    const group = doc.querySelector('optgroup#af-type-added');
    expect(group.getAttribute('label')).toBe('This Class');
    expect(Array.from(group.querySelectorAll('option')).map(o => o.value)).toEqual(['Debate', 'Socratic Seminar']);
    expect(doc.querySelector('#af-evidence option[selected]').value).toBe('Debate');
  });

  it('escapes a typed type', () => {
    const doc = field('<b>x</b>');
    expect(doc.querySelector('#af-type-added b')).toBeNull();
    expect(doc.querySelector('#af-type-added option').textContent).toBe('<b>x</b>');
  });
});

describe("the Student page's Group By Type", () => {
  it('groups Audio with Oral, in the list order, with added types after', () => {
    const groups = StudentGroups.assessGroups(
      'c1',
      [
        { id: 'a', evidenceType: 'Debate' },
        { id: 'b', evidenceType: 'audio' },
        { id: 'c', evidenceType: 'oral' },
        { id: 'd', evidenceType: 'test' },
        { id: 'e', evidenceType: '' },
      ],
      'type',
    );
    expect(groups.map(g => [g.name, g.assessments.map(a => a.id)])).toEqual([
      ['Test', ['d']],
      ['Oral', ['b', 'c']],
      ['Debate', ['a']],
      ['No Type', ['e']],
    ]);
  });
});
