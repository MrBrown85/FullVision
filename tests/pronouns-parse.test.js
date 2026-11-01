/**
 * A stored pronoun value is used only when it parses as a set (he/him,
 * she/her, they/them, or a custom subject/object[/possessive]). "prefer not
 * to say" (an Edit Student choice), "not set", empty, or anything else means
 * no pronouns on file, and the student reads as they/them/their with plural
 * verbs (Colin, Nov 1, #596). Before this, "prefer not to say" was split on
 * "/" and printed in the comment ("…, prefer not to say is Developing…").
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const P = s => ReportBlocks.getPronouns({ pronouns: s });
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves', verb: '', capSubj: 'They' };

describe('getPronouns', () => {
  it('parses the three sets the Edit Student dialog offers', () => {
    expect(P('he/him')).toEqual({
      subj: 'he',
      obj: 'him',
      poss: 'his',
      refl: 'himself',
      verb: 's',
      capSubj: 'He',
      onFile: true,
    });
    expect(P('she/her')).toEqual({
      subj: 'she',
      obj: 'her',
      poss: 'her',
      refl: 'herself',
      verb: 's',
      capSubj: 'She',
      onFile: true,
    });
    expect(P('they/them')).toEqual(Object.assign({}, THEY, { onFile: true }));
    expect(P(' She/Her ')).toEqual(P('she/her'));
  });

  it('treats "prefer not to say", "not set", empty and unparseable values as no pronouns on file', () => {
    [
      'prefer not to say',
      'Prefer not to say',
      'not set',
      'Not Set',
      '',
      '   ',
      undefined,
      'he',
      'he/him/his/himself/x',
      'n/a',
      'he/he',
    ].forEach(v => expect(P(v), JSON.stringify(v)).toEqual(Object.assign({}, THEY, { onFile: false })));
    expect(ReportBlocks.getPronouns({})).toEqual(Object.assign({}, THEY, { onFile: false }));
  });

  it('keeps a custom set typed on the roster, with its own possessive', () => {
    expect(P('ze/zir/zir')).toEqual({
      subj: 'ze',
      obj: 'zir',
      poss: 'zir',
      refl: 'zirself',
      verb: 's',
      capSubj: 'Ze',
      onFile: true,
    });
    expect(P('xe/xem')).toEqual({
      subj: 'xe',
      obj: 'xem',
      poss: 'xem',
      refl: 'xemself',
      verb: 's',
      capSubj: 'Xe',
      onFile: true,
    });
  });
});

describe('the grader note preview and studentRef', () => {
  const S = o => CommentBank.bestPieceSentence(o);
  const note = { title: 'Trench Letter', note: 'wrote from a soldier’s view' };
  it('reads they/their for "prefer not to say", the same as no pronouns', () => {
    const who = CommentBank.studentRef({ firstName: 'Chris', pronouns: 'prefer not to say' });
    expect(who.onFile).toBe(false);
    expect(S(Object.assign({}, note, who))).toBe(
      'Their best piece was “Trench Letter”, where they wrote from a soldier’s view.',
    );
    expect(S(Object.assign({}, note, CommentBank.studentRef({ firstName: 'Chris', pronouns: 'Not Set' })))).toBe(
      'Their best piece was “Trench Letter”, where they wrote from a soldier’s view.',
    );
  });
  it('keeps he/him, she/her and a custom set', () => {
    expect(S(Object.assign({}, note, CommentBank.studentRef({ firstName: 'Chris', pronouns: 'he/him' })))).toBe(
      'His best piece was “Trench Letter”, where he wrote from a soldier’s view.',
    );
    expect(S(Object.assign({}, note, CommentBank.studentRef({ firstName: 'Chris', pronouns: 'she/her' })))).toBe(
      'Her best piece was “Trench Letter”, where she wrote from a soldier’s view.',
    );
    expect(S(Object.assign({}, note, CommentBank.studentRef({ firstName: 'Chris', pronouns: 'ze/zir/zir' })))).toBe(
      'Zir best piece was “Trench Letter”, where ze wrote from a soldier’s view.',
    );
  });
});

describe('a rendered comment (Demo Mode, Science 8, Report 2)', () => {
  let cid, saved;
  beforeAll(() => {
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    cid = 'sci8';
    setActiveTerm(cid, 2);
  });
  afterAll(() => {
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });
  const textFor = (first, pronouns) => {
    const st = Object.assign(
      {},
      getStudents(cid).find(s => s.firstName === first),
      { pronouns },
    );
    const f = CommentBank.facts(cid, st, 'term-2');
    return CommentBank.draft(CommentBank.context(f, {}), { seed: 3 }).text;
  };
  it('never prints "prefer not to say"; the student is they/their after the first sentence', () => {
    const text = textFor('Cece', 'prefer not to say');
    expect(text).not.toMatch(/prefer not to say/i);
    expect(text).not.toMatch(/\b(he|him|his|she|her)\b/);
    expect(text).toMatch(/\b(they|their|them)\b/i);
    expect(text).toBe(textFor('Cece', ''));
    expect(text).toBe(textFor('Cece', 'they/them'));
  });
  it('he/him and she/her are unchanged', () => {
    expect(textFor('Cece', 'she/her')).toMatch(/\b(she|her)\b/i);
    expect(textFor('Cece', 'she/her')).not.toMatch(/\b(they|their)\b/);
    expect(textFor('Cece', 'he/him')).toMatch(/\b(he|his|him)\b/i);
  });
});
