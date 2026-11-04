/**
 * Bank frames the Nov 3 sweep found awkward (step 4, group 3 #71): the
 * proficiency frames that opened on the bare word ("Proficient, his
 * proficiency this term, means …"), the one that dangled ("Proficient in
 * Science 9 on the BC proficiency scale, Liam’s work meets …"), the habit
 * frames that ended "… is the thing to do", and "they can plan each one
 * before that date". Each now reads as a plain sentence, with its id, case
 * and claims unchanged.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

// The grade frames here were retired on Nov 4 2026 (the pipeline's frames
// replace them); a saved comment may still hold one, so the bank keeps their
// text (COMMENT_BANK.retired), and it still reads plainly.
const byId = id => COMMENT_BANK.sentences.find(s => s.id === id) || COMMENT_BANK.retired.find(s => s.id === id);
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };

describe('the reworded frames', () => {
  it('no frame ends "is the thing to do" or opens on a bare proficiency word and a comma', () => {
    COMMENT_BANK.sentences.forEach(s => {
      expect(s.text, s.id).not.toMatch(/is the thing to do\.$/);
      expect(s.text, s.id).not.toMatch(
        /^(Extending|Proficient|Developing|Emerging)( in \{course\})?,? (\{his\} proficiency|on the BC)/,
      );
      expect(s.text, s.id).not.toMatch(/that is where \{his\}/);
    });
  });

  it('read plainly when filled for a student', () => {
    const ctx = CommentBank.context(
      {
        name: 'Liam',
        first: 'Liam',
        course: 'Science 9',
        pronouns: THEY,
        comps: [],
        work: [],
        voice: {},
        confidence: [],
        record: { total: 0, handed: 0, late: 0, missing: 0 },
        habits: {},
        overall: 3,
        standing: 'Proficient',
        letter: '',
        levelText: () => '',
        grade: { mode: 'proficiency', pieces: [] },
      },
      {},
    );
    const fill = id => CommentBank.fill(byId(id), ctx, { first: true });
    expect(fill('gr55')).toBe(
      'Liam’s work meets what Science 9 expects, which is Proficient on the BC proficiency scale.',
    );
    expect(fill('gr57')).toBe(
      'Liam’s work this term earns Proficient on the proficiency scale for its complete understanding of the course.',
    );
    expect(fill('gr58')).toBe(
      'The BC proficiency scale calls Liam’s work in Science 9 Proficient, which means a complete understanding.',
    );
    expect(fill('hl013')).toBe(
      'Liam completes some tasks by the due date, and they can make a plan to finish the others on time.',
    );
    expect(byId('hl094').text).toBe(
      'In some pieces {his} revisions follow the feedback; next comes using feedback on every piece.',
    );
    ['gr47', 'gr48', 'gr55', 'gr57', 'gr58', 'gr67', 'gr68', 'gr77', 'gr78'].forEach(id =>
      expect(byId(id), id).toMatchObject({ group: 'Grade', claims: ['grade'], when: { grade: 'proficiency' } }),
    );
  });
});
