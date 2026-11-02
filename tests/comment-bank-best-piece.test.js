/**
 * The best piece backs up the strength (Colin, 2026-11-02): of the pieces
 * tied at the top mark (as the level prints, tenths), the one scored on the
 * strength's competency is the best piece. Without a tie, or without a
 * strength, the highest mark and then the most recent piece win as before.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };

function day(n) {
  const d = new Date(2026, 8, 1 + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// A competency scored on the given pieces of work, all at one level.
const comp = (id, name, level, ids) => ({
  id,
  name,
  scores: ids.map((w, i) => ({ id: w, d: day(i * 7), v: level, title: w })),
  start: level,
  now: level,
  level,
  iCans: ['I can explain why it matters'],
});
const piece = (id, title, v, d) => ({ id, title, v, d: day(d), pct: null, note: '' });

function facts(over) {
  return Object.assign(
    {
      cid: 'best',
      sid: 's1',
      name: 'Noor',
      first: 'Noor',
      course: 'History 12',
      family: 'socials',
      pronouns: THEY,
      pronounsOnFile: true,
      // Evidence is the strength: 3+ pieces and half a step over the rest.
      comps: [
        comp('c1', 'Evidence', 3.5, ['a1', 'a3', 'a4']),
        comp('c2', 'Perspective', 3, ['a2', 'a3', 'a4']),
        comp('c3', 'Significance', 2.5, ['a2', 'a3', 'a4']),
      ],
      work: [],
      voice: {},
      confidence: [],
      record: { total: 4, handed: 4, late: 0, missing: 0 },
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: {},
      overall: 3,
      standing: 'Proficient',
      letter: '',
      grade: { mode: 'proficiency', pieces: [] },
      levelText: () => '',
      enrolled: '',
      classStart: '',
      termStart: '',
      classLines: { support: [], pick: null, closing: '', late: '', charLimit: null },
    },
    over,
  );
}
const bestOf = f => CommentBank.context(f, {}).bestPiece;

describe('the best piece', () => {
  it('is the tied top piece scored on the strength, not the more recent one', () => {
    const f = facts({ work: [piece('a1', 'Source Essay', 3.5, 1), piece('a2', 'Timeline Poster', 3.5, 20)] });
    expect(bestOf(f)).toContain('Source Essay');
  });

  it('counts a tie as the level prints it', () => {
    const f = facts({ work: [piece('a1', 'Source Essay', 3.46, 1), piece('a2', 'Timeline Poster', 3.54, 20)] });
    expect(bestOf(f)).toContain('Source Essay');
  });

  it('is the highest mark when there is no tie', () => {
    const f = facts({ work: [piece('a1', 'Source Essay', 3, 1), piece('a2', 'Timeline Poster', 3.5, 20)] });
    expect(bestOf(f)).toContain('Timeline Poster');
  });

  it('is the most recent tied piece when there is no strength', () => {
    const even = [comp('c1', 'Evidence', 3, ['a1']), comp('c2', 'Perspective', 3, ['a2'])];
    const f = facts({
      comps: even,
      work: [piece('a1', 'Source Essay', 3.5, 1), piece('a2', 'Timeline Poster', 3.5, 20)],
    });
    expect(bestOf(f)).toContain('Timeline Poster');
  });
});
