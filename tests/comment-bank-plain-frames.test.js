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

const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
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
    expect(fill('hl013')).toBe(
      'Liam completes some tasks by the due date, and they can make a plan to finish the others on time.',
    );
    expect(byId('hl094').text).toBe(
      'In some pieces {his} revisions follow the feedback; next comes using feedback on every piece.',
    );
    // The reworded grade frames (gr47-gr78) were retired for the sample
    // voice (Nov 4): none of the grade frames names the scale.
    COMMENT_BANK.sentences
      .filter(s => s.group === 'Grade')
      .forEach(s => expect(s.text, s.id).not.toMatch(/proficiency scale|this term|calls/));
  });
});
