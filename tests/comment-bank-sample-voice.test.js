/**
 * The sample voice (Colin, Nov 4): six approved sample comments are the
 * spec for Generate. Every comment off the IE path has the same parts in the
 * same order: the grade ("Noor is working at an Extending level in Science
 * 8", "Sam has a C+ in Science 8 so far, which is good work"), the best
 * piece owning its title with what it shows, the habits, the next step and
 * a line for home. When the marks are spread thinly (one or two pieces per
 * competency, a class not linked to the bank), every part is still written:
 * the best piece says what it shows from the competency it scored highest
 * on, the strength names the highest competency by its label, the next step
 * is tentative or generic, the family line generic, and one sentence says
 * the picture rests on a few pieces. Every sentence is proven by verify().
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SHE = { subj: 'she', obj: 'her', poss: 'her', refl: 'herself' };
const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);

function day(n) {
  const d = new Date(2026, 8, 1 + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/* A competency scored once on its own piece (or on `ids`). */
const comp = (id, name, level, ids, bankId) => ({
  id,
  name,
  bankId: bankId || null,
  scores: ids.map((w, i) => ({ id: w, d: day(i * 7), v: level, title: 'Piece ' + w })),
  start: 0,
  now: 0,
  level,
  iCans: [],
});
const work = (id, title, v, d) => ({ id, title, d: day(d), v, pct: null, note: '' });

/* Moon (Colin's live class, Nov 4): a Philosophy 12 class whose
   competencies are not linked to the bank and carry their own labels, one
   scored piece each. On main Generate wrote four sentences: the grade, the
   best piece and two habits sentences; no strength (every strength route
   needs three pieces a competency), no next step (it needs two) and so no
   family line. */
function moon(over) {
  return Object.assign(
    {
      cid: 'phil12',
      sid: 's-moon',
      name: 'Moon',
      first: 'Moon',
      course: 'Philosophy 12',
      family: 'socials',
      pronouns: SHE,
      pronounsOnFile: true,
      comps: [
        comp('c1', 'Reasoning and Argument', 3, ['w1']),
        comp('c2', 'Ethical Judgment', 2, ['w2']),
        comp('c3', 'Worldviews', 2, ['w3']),
        comp('c4', 'Philosophical Questions', 2, ['w4']),
      ],
      work: [
        work('w1', 'Thinking It Through: A Changing Worldview', 3, 0),
        work('w2', 'Trolley Problem Reflection', 2, 7),
        work('w3', 'Cave Allegory Response', 2, 14),
        work('w4', 'Socratic Seminar', 2, 21),
      ],
      voice: {},
      confidence: [],
      record: { total: 4, handed: 4, late: 0, missing: 0 },
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: { completes: 4, ready: 4, others: 4, part: 4, feedback: 4, devices: 3 },
      overall: 2.3,
      standing: 'Developing',
      letter: '',
      grade: { mode: 'proficiency', pieces: [] },
      levelText: v => ['', 'Emerging', 'Developing', 'Proficient', 'Extending'][Math.round(v)] || '',
      enrolled: '',
      classStart: '',
      termStart: '',
      classLines: { support: [], pick: null, closing: '', late: '', charLimit: null },
    },
    over,
  );
}
const draftOf = (f, seed = 1) => CommentBank.draft(CommentBank.context(f, {}), { seed });
const stepsOf = d => d.sentences.map(s => s.step);

describe('thin evidence (Moon, Nov 4): every part is written', () => {
  it('writes the grade, the best piece and what it shows, the habits, a strength, a next step and a home line', () => {
    const f = moon();
    expect(CommentBank.nextSkillOf(f)).toBeNull();
    expect(CommentBank.strengthSkills(f)).toEqual([]);
    for (let seed = 1; seed <= 6; seed++) {
      const d = draftOf(f, seed);
      const steps = stepsOf(d);
      ['grade', 'example', 'habits', 'nextStep', 'home'].forEach(k => expect(steps, 'seed ' + seed).toContain(k));
      // The strength: what the best piece shows, by its competency's label.
      const ex = d.sentences.find(x => x.step === 'example');
      expect(ex.text, 'seed ' + seed).toMatch(/reasoning and argument/);
      expect(ex.text).toContain('her Thinking It Through: A Changing Worldview');
      // The next step is tentative: Ethical Judgment, the lowest on one
      // piece, by the table's Socials skill (a class not linked to the bank).
      expect(['nt01', 'nt02', 'nt03']).toContain(d.ids[steps.indexOf('nextStep')]);
      expect(d.replaced).toEqual([]);
      expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    }
  });

  it('says the picture rests on a few pieces, provably from the piece counts', () => {
    const f = moon();
    expect(CommentBank.spreadOf(f)).toMatchObject({ all: true });
    const d = draftOf(f);
    const sp = d.sentences.find(x => x.step === 'spread');
    expect(sp).toBeTruthy();
    expect(sp.text).not.toMatch(/early|this term/i);
    // A third piece on three of the four: the marks are no longer spread
    // thinly, and the sentence is replaced.
    const more = moon();
    more.comps = more.comps.map((c, i) => (i < 3 ? { ...c, scores: c.scores.concat(c.scores, c.scores) } : c));
    expect(CommentBank.spreadOf(more)).toBeNull();
    const v = CommentBank.verify(d, more, {});
    expect(v.replaced.map(x => x.sentenceId)).toContain(sp.id);
  });

  it('names the strength on its own by label when the best piece shows none', () => {
    // No piece at Proficient: nothing the best piece shows; Reasoning is
    // still the highest competency, by itself.
    const f = moon({
      comps: [
        comp('c1', 'Reasoning and Argument', 2.6, ['w1']),
        comp('c2', 'Ethical Judgment', 2, ['w2']),
        comp('c3', 'Worldviews', 1.6, ['w3']),
      ],
      work: [
        work('w1', 'Seminar Notes', 2, 0),
        work('w2', 'Trolley Problem Reflection', 2, 7),
        work('w3', 'Essay', 1, 14),
      ],
    });
    expect(CommentBank.bestPieceSkillOf(f, CommentBank.bestPieceOf(f))).toBeNull();
    expect(CommentBank.highestFallbackOf(f)).toMatchObject({ label: 'reasoning and argument' });
    const d = draftOf(f);
    const o = d.sentences.find(x => x.step === 'overall');
    expect(o && o.text).toMatch(/highest in reasoning and argument/);
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    // Ethics rises above it: the claim fails.
    const later = moon({
      comps: [
        comp('c1', 'Reasoning and Argument', 2.6, ['w1']),
        comp('c2', 'Ethical Judgment', 3, ['w2']),
        comp('c3', 'Worldviews', 1.6, ['w3']),
      ],
      work: f.work,
    });
    expect(CommentBank.verify(d, later, {}).replaced.map(x => x.sentenceId)).toContain(o.id);
  });

  it('a bank-linked class gets a tentative next step from the lowest competency, at its level, and its family line', () => {
    const f = moon({
      course: 'Social Studies 10',
      comps: [
        comp('c1', 'Evidence', 3, ['w1'], 'bc.ss10.cc.3'),
        comp('c2', 'Perspective', 2, ['w2'], 'bc.ss10.cc.6'),
        comp('c3', 'Significance', 2.4, ['w3'], 'bc.ss10.cc.2'),
      ],
      work: [work('w1', 'Treaty Debate', 3, 0), work('w2', 'Source Analysis', 2, 7), work('w3', 'Timeline', 2, 14)],
    });
    const tn = CommentBank.tentSkillOf(f);
    expect(tn.comp.id).toBe('c2');
    expect(tn.text).toBe(CommentBank.skillFor(f, f.comps[1]).steps.Developing);
    for (let seed = 1; seed <= 4; seed++) {
      const d = draftOf(f, seed);
      const next = d.sentences.find(x => x.step === 'nextStep');
      expect(['nt01', 'nt02', 'nt03']).toContain(next.id);
      expect(next.text).toContain(tn.text);
      expect(next.text).toMatch(/^(A next step|One possible next step|For now, a next step)/);
      const home = byId(d.ids[stepsOf(d).indexOf('home')]);
      expect(home).toBeTruthy();
      expect(d.replaced).toEqual([]);
    }
    // A second piece on Perspective: the next step is settled, and the
    // tentative sentence is replaced.
    const d = draftOf(f, 1);
    const settled = {
      ...f,
      comps: f.comps.map(c => (c.id === 'c2' ? { ...c, scores: c.scores.concat(c.scores) } : c)),
    };
    expect(CommentBank.nextSkillOf(settled)).toBeTruthy();
    const nid = d.sentences.find(x => x.step === 'nextStep').id;
    expect(CommentBank.verify(d, settled, {}).replaced.map(x => x.sentenceId)).toContain(nid);
  });
});

describe('the sample shape in Demo Mode (Science 8, Report 2)', () => {
  const cid = 'sci8';
  let saved;
  beforeAll(() => {
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    setActiveTerm(cid, 2);
  });
  afterAll(() => {
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });
  const PROFILES = ['444444', '434334', '333333', '423432', '223123', '443424', '122212', '344344'];
  const KEYS = ['completes', 'ready', 'others', 'part', 'feedback', 'devices'];
  const habitsOf = p => Object.fromEntries(KEYS.map((k, i) => [k, Number(p[i])]));
  const RETIRED_WORDING =
    /proficiency scale|\bcalls\b|this term|is able to|ability to|as (his|her|their) marks show|skill by skill|after this term|can try next|to keep growing|each day|reliably|for (him|her|them), two habits/i;

  it('every comment: the same order, the core parts, no retired wording, "so far" at most once', () => {
    getStudents(cid).forEach((st, i) => {
      const f = CommentBank.facts(cid, st, 'term-2');
      const picks = { habits: habitsOf(PROFILES[i % PROFILES.length]) };
      for (let seed = 1; seed <= 3; seed++) {
        const d = CommentBank.draft(CommentBank.context(f, picks), { seed });
        const steps = stepsOf(d);
        const order = CommentBank.DRAFT_STEPS.map(s => s.key);
        steps.forEach(
          (k, j) => j && expect(order.indexOf(k), st.firstName).toBeGreaterThan(order.indexOf(steps[j - 1])),
        );
        ['grade', 'example', 'habits', 'nextStep', 'home'].forEach(k =>
          expect(steps, st.firstName + ' seed ' + seed).toContain(k),
        );
        // A strength in every comment: its own sentence, what the best
        // piece shows, growth, or even marks joined to the grade.
        const ex = d.sentences.find(x => x.step === 'example');
        const strength =
          steps.indexOf('overall') >= 0 ||
          steps.indexOf('growth') >= 0 ||
          /shows (she|he|they) can|skill in/.test(ex.text) ||
          /marks close/.test(d.sentences[0].text);
        expect(strength, d.text).toBe(true);
        // Grade, best piece and strength wording off the retired list; the
        // habits frames keep "This term" (a term's ratings).
        d.sentences
          .filter(x => !/^habits/.test(x.step))
          .forEach(x => expect(x.text, st.firstName + ': ' + x.text).not.toMatch(RETIRED_WORDING));
        expect((d.text.match(/\bso far\b/gi) || []).length, d.text).toBeLessThanOrEqual(1);
        expect(d.replaced).toEqual([]);
      }
    });
  });

  it('opens on the sample grade sentence, and owns the best piece’s title', () => {
    const noor = getStudents(cid).find(s => s.firstName === 'Noor');
    const f = CommentBank.facts(cid, noor, 'term-2');
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1 });
    expect(d.sentences[0].text).toMatch(
      /Noor is working at an Extending level|Noor’s work is at an Extending level|Noor is working at an Extending level, with marks close/,
    );
    const ex = d.sentences.find(x => x.step === 'example');
    expect(ex.text).toMatch(
      /her [A-Z][\w ]+ is her best piece|best piece (so far )?is her [A-Z]|scored highest on her [A-Z]/i,
    );
    expect(ex.text).not.toMatch(/[“”]/);
    // No two sentences name the same competency: the best piece, the
    // strength and the next step each rest on their own.
    getStudents(cid).forEach(st => {
      const dd = CommentBank.draft(CommentBank.context(CommentBank.facts(cid, st, 'term-2'), {}), { seed: 1 });
      const compsOf = step => {
        const i = dd.sentences.findIndex(x => x.step === step);
        const pv = i >= 0 ? dd.provenance[i] : null;
        const out = new Set();
        Object.keys((pv && pv.sources) || {}).forEach(k =>
          pv.sources[k].forEach(
            x =>
              /^comp:/.test(x) &&
              ['piece', 'evenResults', 'evenWord', 'even', 'highestTop', 'split', 'spread', 'spreadAll'].indexOf(k) <
                0 &&
              out.add(x),
          ),
        );
        return out;
      };
      const a = compsOf('example');
      const b = compsOf('overall');
      const c = compsOf('nextStep');
      [...a].forEach(x => expect(b.has(x) || c.has(x), st.firstName + ' ' + x).toBe(false));
      [...b].forEach(x => expect(c.has(x), st.firstName + ' ' + x).toBe(false));
    });
  });

  it('a quiz, test or check scored highest; other work is the best piece', () => {
    expect(CommentBank.pieceTitle({ title: 'Lesson 4: Treaty Debate' })).toBe('Treaty Debate');
    expect(CommentBank.pieceTitle({ title: 'Thinking It Through: A Changing Worldview' })).toBe(
      'Thinking It Through: A Changing Worldview',
    );
    expect(CommentBank.pieceTitle({ title: 'The Outsiders Essay' })).toBe('Outsiders Essay');
    expect(CommentBank.pieceTitle({ title: 'What Does the Poster Show?' })).toBe('work “What Does the Poster Show?”');
    const liam = getStudents(cid).find(s => s.firstName === 'Liam');
    const f = CommentBank.facts(cid, liam, 'term-2');
    const ctx = CommentBank.context(f, {});
    if (/check|quiz|test/i.test(ctx.piece)) {
      expect(ctx.pieceTest).toBe('yes');
      const d = CommentBank.draft(ctx, { seed: 1 });
      expect(d.sentences.find(x => x.step === 'example').text).toMatch(/scored highest|highest score/);
    }
  });
});
