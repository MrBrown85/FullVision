/* The amber note under the habit sentences echoes the frequency word the
   sentence itself uses (Term Questionnaire, slice 8). */
import './setup.js';
import { describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;
const he = { subj: 'he', poss: 'his' };
const nh = { count: 10, titles: [], groups: [] };

describe('habitNoteText', () => {
  it('says always when the sentence says always', () => {
    expect(RQ.habitNoteText('He always hands in his work on time and comes to class ready to start.', he, nh)).toBe(
      'This says he always hands in his work on time. Ten assignments are not handed in.',
    );
  });
  it('says usually and consistently when the sentence does', () => {
    expect(RQ.habitNoteText('He usually hands in his work on time.', he, nh)).toContain('he usually hands in');
    expect(
      RQ.habitNoteText('Cece consistently hands in her work on time.', { subj: 'she', poss: 'her' }, nh),
    ).toContain('she consistently hands in her work');
  });
  it('uses no frequency word when the sentence has none, and they hand', () => {
    expect(RQ.habitNoteText('He hands in his work on time.', he, nh)).toMatch(
      /^This says he hands in his work on time\./,
    );
    expect(RQ.habitNoteText('Sam is on time with work.', { subj: 'they', poss: 'their' }, nh)).toMatch(
      /^This says they hand in their work on time\./,
    );
  });
});
