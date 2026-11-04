/**
 * The Generate pipeline's small pieces (teacher/comment-pipeline.js, Nov 4
 * 2026; plan ~/reports/generate-ideal-comments-plan-v2.md): salience, the
 * comment's shape rotated along the roster, joins, distance and the
 * candidate score. Each is a plain function of its inputs: no model, no
 * network, the same answer every time.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const CP = CommentPipeline;

describe('shapes along the roster', () => {
  const all = { grade: true, strength: true, growth: true, piece: true };
  it('fits a shape only to facts that allow it, IE on its own', () => {
    expect(CP.shapesFor(all)).toEqual(['grade', 'strength', 'piece', 'growth']);
    expect(CP.shapesFor({ grade: true, piece: true })).toEqual(['grade', 'piece']);
    expect(CP.shapesFor({ ie: true, grade: true })).toEqual(['ie']);
  });

  it('never gives two roster neighbours the same shape, at any press', () => {
    const profiles = Array.from({ length: 27 }, (_, i) => ({
      grade: true,
      strength: i % 3 !== 0,
      piece: true,
      growth: i % 5 === 0,
    }));
    for (let press = 0; press < 6; press++) {
      const shapes = CP.rosterShapes(profiles, press);
      for (let i = 1; i < shapes.length; i++) expect(shapes[i], press + ':' + i).not.toBe(shapes[i - 1]);
      // No shape takes more than half the class.
      const n = {};
      shapes.forEach(s => (n[s] = (n[s] || 0) + 1));
      Object.values(n).forEach(c => expect(c).toBeLessThanOrEqual(14));
    }
  });

  it('moves a student’s shape from one press to the next', () => {
    const profiles = [all, all, all];
    expect(CP.rosterShapes(profiles, 1)[1]).not.toBe(CP.rosterShapes(profiles, 2)[1]);
  });
});

describe('salience: what is worth saying', () => {
  it('ranks growth over a strength, a teacher’s note over a plain piece, and says no habit that is not news', () => {
    const s = CP.salience({ growth: true, piece: true, pieceNote: true, habitInvite: false, habitNews: false });
    expect(s.overall).toBe(0.9);
    expect(s.example).toBe(0.9);
    expect(s.habits).toBe(0);
    expect(CP.chosen(s, 3)).toEqual(['example', 'overall']);
  });
  it('says a quiz less when a strength is said, and a fact the last report said less', () => {
    expect(CP.salience({ piece: true, pieceScored: true, strength: true }).example).toBe(0.3);
    expect(CP.salience({ piece: true, said: { example: true } }).example).toBeCloseTo(0.3);
  });
});

describe('joins', () => {
  const frame = (id, step, text, claims) => ({ id, step, text, claims, v: 2, part: 'now', group: 'G' });
  it('joins two one-claim sentences about the student with "and", claims and needs both', () => {
    const a = frame('a', 'grade', '{He} [is|are] working at {standing} in {course}.', ['grade']);
    const b = frame('b', 'overall', '{He} {strengthAt}.', ['strength']);
    b.needs = ['strengthAt'];
    a.needs = ['standing'];
    expect(CP.joinable(a, b)).toBe('and');
    const j = CP.joined(a, b, 'and');
    expect(j.text).toBe('{He} [is|are] working at {standing} in {course}, and {he} {strengthAt}.');
    expect(j.claims).toEqual(['grade', 'strength']);
    expect(j.needs).toEqual(['standing', 'strengthAt']);
    expect(j.id).toBe('j:a+b:and');
    expect(CP.parseJoin(j.id)).toEqual(['a', 'b', 'and']);
  });
  it('never joins a sentence that already has a clause, two of one claim, or a second that does not open on the student', () => {
    const b = frame('b', 'overall', '{He} {strengthAt}.', ['strength']);
    expect(
      CP.joinable(
        frame('a', 'grade', 'In {course}, {his} work is at {standing}: it shows {levelMeaning}.', ['grade']),
        b,
      ),
    ).toBe('');
    expect(CP.joinable(frame('a', 'grade', '{He} has {gradeLetter}, and that is good.', ['grade']), b)).toBe('');
    expect(CP.joinable(frame('a', 'grade', '{He} is here.', ['strength']), b)).toBe('');
    expect(
      CP.joinable(
        frame('a', 'grade', '{He} is here.', ['grade']),
        frame('c', 'overall', 'In class, {he} {strengthAt}.', ['strength']),
      ),
    ).toBe('');
    expect(CP.joinable(frame('a', 'habits', '{He} is here.', ['habits']), b)).toBe('');
  });
});

describe('distance and the score', () => {
  it('measures word-level edit distance with the name and pronouns as one word', () => {
    expect(CP.distance('Noor is at Extending.', 'Noor is at Extending.', 'Noor')).toBe(0);
    expect(CP.distance('She is here.', 'He is here.')).toBe(0);
    expect(CP.distance('a b c d', 'w x y z')).toBe(1);
    expect(CP.opening('Noor’s best piece is her journal.', 'Noor')).toBe('NAME best piece');
  });
  it('rules out a candidate with two openers in a row, "so far" twice or a sentence over the cap', () => {
    const ok = {
      sentences: [
        'Noor is here.',
        'Her work is good.',
        'Next, she can try.',
        'At home, ask her.',
        'In class she joins in.',
      ].map(text => ({ text })),
    };
    const twin = {
      sentences: [
        'Her work is here.',
        'Her marks so far are up.',
        'So far it holds.',
        'Next, she can try.',
        'At home, ask her.',
      ].map(text => ({ text })),
    };
    expect(CP.score(ok, { name: 'Noor' })).toBeGreaterThan(CP.score(twin, { name: 'Noor' }));
    expect(CP.score(twin, { name: 'Noor' })).toBeLessThan(-100);
  });
  it('prefers the candidate furthest from the text on screen', () => {
    const prev =
      'Noor is at Extending. Her best piece is her journal. Next, she can explain errors. At home, ask her. In class she joins in.';
    const same = { sentences: prev.split(/(?<=\.) /).map(text => ({ text })) };
    const other = {
      sentences: [
        'Science 8 is going well for Noor.',
        'The journal stands out.',
        'From here, she can find errors.',
        'Some time this month, ask her.',
        'Most days, she joins discussions.',
      ].map(text => ({ text })),
    };
    expect(CP.score(other, { name: 'Noor', previous: prev })).toBeGreaterThan(
      CP.score(same, { name: 'Noor', previous: prev }),
    );
  });
});
