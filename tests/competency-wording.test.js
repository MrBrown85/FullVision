/**
 * A competency level's three lines for the hovers (Nov 2 mockup): the level
 * and its descriptor by the printed rubric's rule (the teacher's own, else
 * the bank's, else the BC general wording), what Proficient means as the I
 * Can statements, and the bank cluster's next step below Extending.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const BANK = {
  ids: { 'bc.sci8.cc.14': 0 },
  levels: [
    [
      'The student is beginning to find patterns and connections in data.',
      'The student finds patterns and connections in data with growing consistency.',
      'The student consistently finds patterns and connections in data.',
      'The student finds patterns and connections in data with depth and complexity.',
    ],
  ],
};
const tag = (over = {}) =>
  Object.assign(
    {
      id: 'IP',
      label: 'Identify Patterns',
      bank_id: 'bc.sci8.cc.14',
      i_can_statements: ['I can find patterns in data', ' ', 'I can find connections in data'],
    },
    over,
  );
const step = lv => {
  const b = window.BANK_COMMENT;
  return b.clusters[b.ids['bc.sci8.cc.14']][lv + 1];
};

describe('CompetencyWording', () => {
  afterEach(() => {
    delete window.BANK_PROFICIENCY;
    localStorage.removeItem('gb-competency-descriptors');
    _competencyDescriptors = null;
  });

  it('gives the bank’s descriptor as the level’s name, the I Can statements and the next step', () => {
    window.BANK_PROFICIENCY = BANK;
    const l = CompetencyWording.lines(tag(), 2);
    expect(l.word).toBe('Developing');
    expect(l.descriptor).toBe('Finds patterns and connections in data with growing consistency.');
    expect(l.iCans).toEqual(['I can find patterns in data', 'I can find connections in data']);
    expect(l.next.toLowerCase()).toBe(step(2).toLowerCase() + '.');
    expect(l.ready).toBe(true);
    const html = CompetencyWording.html(l);
    expect(html).toContain('<b>Developing:</b> Finds patterns');
    expect(html).toContain('<b>Proficient means:</b> I can find patterns in data · I can find connections in data');
    expect(html).toContain('<b>Next step:</b> ');
  });

  it('has no next step at Extending', () => {
    window.BANK_PROFICIENCY = BANK;
    expect(CompetencyWording.lines(tag(), 4).next).toBe('');
    expect(CompetencyWording.html(CompetencyWording.lines(tag(), 4))).not.toContain('Next step');
  });

  it('uses the general wording, not ready, until the bank’s wording loads', () => {
    const l = CompetencyWording.lines(tag(), 3);
    expect(l.ready).toBe(false);
    expect(l.descriptor).toBe(
      RubricPrint.GENERAL_LEVELS[3].replace(/^The student /, '').replace(/^./, c => c.toUpperCase()),
    );
  });

  it('lets the teacher’s own wording win, as the printed rubric does', () => {
    window.BANK_PROFICIENCY = BANK;
    const t = tag();
    localStorage.setItem(
      'gb-competency-descriptors',
      JSON.stringify({ [RubricDraft.competencyKey(t)]: { 3: 'finds a trend and names the outlier' } }),
    );
    _competencyDescriptors = null;
    expect(CompetencyWording.lines(t, 3).descriptor).toBe('Finds a trend and names the outlier.');
  });

  it('a competency with no bank id has no next step and is ready at once', () => {
    const l = CompetencyWording.lines(tag({ bank_id: undefined }), 2);
    expect(l.next).toBe('');
    expect(l.ready).toBe(true);
    expect(l.descriptor).toBeTruthy();
  });

  it('escapes its text', () => {
    const l = CompetencyWording.lines(tag({ bank_id: undefined, i_can_statements: ['I can <b>bold</b>'] }), 1);
    expect(CompetencyWording.html(l)).toContain('I can &lt;b&gt;bold&lt;/b&gt;');
  });
});
