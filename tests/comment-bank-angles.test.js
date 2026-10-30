/**
 * Generate's angles and the Generate Comment button (plan PR 4). Before any
 * sentence is chosen, CommentBank.angle(facts) picks the story of the term,
 * which sets the steps, their order and which leads (the grade sentence
 * first). Ties break on the story used least in the class. draft() is what
 * the button calls: each press gives another version from the same facts,
 * keeps the sentences the teacher kept and the order they set, and every
 * draft is verified before the screen gets it.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };

/* A scored piece on a day counted from Sep 1, 2026. */
function piece(day, pct) {
  const d = new Date(2026, 8, 1 + day);
  const iso =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return { id: 'p' + day, d: iso, pct };
}
const flat = (n, pct) => Array.from({ length: n }, (_, i) => piece(i * 7, pct));
const comp = (id, level, n) => ({
  id,
  name: 'Skill ' + id,
  scores: Array.from({ length: n }, (_, i) => ({ id: 'w' + i, v: level, d: piece(i * 7).d, title: 'Task ' + i })),
  start: level,
  now: level,
  level,
  iCans: [],
});

/* Facts with only what the stories and the draft read: a C+ class member
   with eight even pieces, nothing missing and no habits rated. */
function facts(over) {
  const g = Object.assign({ mode: 'letter', letter: 'C+', pct: 70, next: null, pieces: flat(8, 70) }, over.grade || {});
  return Object.assign(
    {
      name: 'Noor',
      first: 'Noor',
      course: 'History 12',
      family: 'socials',
      pronouns: THEY,
      comps: [comp('c1', 2.8, 4), comp('c2', 2.6, 4)],
      work: [],
      obs: [],
      voice: {},
      confidence: [],
      record: { total: 8, handed: 8, late: 0, missing: 0 },
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: {},
      overall: 2.7,
      standing: '',
      letter: '',
      levelText: () => '',
      enrolled: '2026-09-03',
      classStart: '2026-09-03',
      termStart: '2026-09-03',
    },
    over,
    { grade: g },
  );
}

/* A fixture built for each story. */
const FIXTURES = {
  ie: facts({ grade: { letter: 'IE', pct: 40 } }),
  thin: facts({ grade: { pieces: flat(2, 70) } }),
  newcomer: facts({ enrolled: '2026-10-05' }),
  hidden: facts({
    grade: { letter: 'C', pct: 62, pieces: flat(6, 88) },
    record: { total: 10, handed: 7, late: 0, missing: 3 },
    notHandedIn: { count: 3, titles: ['Lab 1', 'Lab 2', 'Lab 3'], groups: [] },
  }),
  climb: facts({ grade: { pieces: [60, 62, 64, 70, 78, 82].map((p, i) => piece(i * 8, p)) } }),
  slide: facts({ grade: { pieces: [82, 80, 76, 70, 62, 60].map((p, i) => piece(i * 8, p)) } }),
  split: facts({ comps: [comp('c1', 3.8, 3), comp('c2', 2.0, 3)] }),
  habits: facts({ grade: { letter: 'B', pct: 78, pieces: flat(8, 78) }, habits: { completes: 2, part: 1 } }),
  strength: facts({ grade: { letter: 'A', pct: 91, pieces: flat(8, 91) } }),
  building: facts({ grade: { letter: 'C', pct: 63, pieces: flat(8, 63) } }),
  steady: facts({}),
};

describe('angle', () => {
  it('has about ten stories, each with an order of real steps that never repeats one', () => {
    const steps = CommentBank.DRAFT_STEPS.map(s => s.key);
    expect(CommentBank.ANGLES.length).toBeGreaterThanOrEqual(10);
    CommentBank.ANGLES.forEach(a => {
      expect(a.order.length, a.id).toBeGreaterThan(4);
      expect(new Set(a.order).size, a.id).toBe(a.order.length);
      a.order.forEach(k => expect(steps, a.id + ' ' + k).toContain(k));
      expect(a.order, a.id).not.toContain('grade');
    });
    expect(Object.keys(FIXTURES).sort()).toEqual(CommentBank.ANGLES.map(a => a.id).sort());
  });

  Object.keys(FIXTURES).forEach(id => {
    it(`tells the ${id} story on a fixture built for it`, () => {
      const a = CommentBank.angle(FIXTURES[id], {});
      expect(a.id).toBe(id);
      expect(a.lead).toBe(a.order[0]);
    });
  });

  it('reads the habits the teacher picked over the stored ones', () => {
    const f = facts({ grade: { letter: 'B', pct: 78, pieces: flat(8, 78) } });
    expect(CommentBank.angle(f, {}).id).toBe('strength');
    expect(CommentBank.angle(f, { habits: { feedback: 2, devices: 1 } }).id).toBe('habits');
  });

  it('a climb needs four weeks and six pieces, so the earliest third never rests on one score', () => {
    const short = facts({ grade: { pieces: [60, 62, 64, 70, 78, 82].map((p, i) => piece(i * 4, p)) } });
    expect(CommentBank.angle(short, {}).id).toBe('steady');
    const few = facts({ grade: { pieces: [50, 70, 80, 82, 84].map((p, i) => piece(i * 10, p)) } });
    expect(CommentBank.angle(few, {}).id).toBe('steady');
  });

  it('is new to the class only when joining two weeks after the class began, inside this term', () => {
    expect(CommentBank.angle(facts({ enrolled: '2026-09-10' }), {}).id).toBe('steady');
    // A class rostered after the term began: everyone joined together.
    const together = { enrolled: '2026-09-20', classStart: '2026-09-20', termStart: '2026-09-03' };
    expect(CommentBank.angle(facts(together), {}).id).toBe('steady');
    // No enrolment date on file: no story about it.
    expect(CommentBank.angle(facts({ enrolled: '' }), {}).id).toBe('steady');
  });

  it('breaks a tie on the story used least in the class, then the list order', () => {
    const both = facts({
      comps: [comp('c1', 3.8, 3), comp('c2', 2.0, 3)],
      grade: { pieces: [60, 62, 64, 70, 78, 82].map((p, i) => piece(i * 8, p)) },
    });
    expect(CommentBank.angle(both, {}).id).toBe('climb');
    expect(CommentBank.angle(both, {}, { uses: { climb: 3, split: 1 } }).id).toBe('split');
    // A lower tier always wins over a tie.
    expect(CommentBank.angle({ ...both, grade: { ...both.grade, letter: 'IE' } }, {}, { uses: { ie: 9 } }).id).toBe(
      'ie',
    );
  });

  it('counts this session’s drafts in the class for the tie, never the student’s own', () => {
    const both = s =>
      facts({
        cid: 'class-tie',
        sid: s,
        comps: [comp('c1', 3.8, 3), comp('c2', 2.0, 3)],
        grade: { pieces: [60, 62, 64, 70, 78, 82].map((p, i) => piece(i * 8, p)) },
      });
    const first = CommentBank.draft(CommentBank.context(both('s1'), {}), { seed: 1 });
    expect(first.angle).toBe('climb');
    // Again for the same student: the same story.
    expect(CommentBank.draft(CommentBank.context(both('s1'), {}), { seed: 2 }).angle).toBe('climb');
    // A classmate with the same tie gets the story told less.
    expect(CommentBank.draft(CommentBank.context(both('s2'), {}), { seed: 1 }).angle).toBe('split');
  });
});

describe('the angle shapes the draft', () => {
  Object.keys(FIXTURES).forEach(id => {
    it(`the ${id} draft: grade first, then the story's steps in its order, all verified`, () => {
      const f = FIXTURES[id];
      const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 3, angleUses: {} });
      expect(d.angle).toBe(id);
      const seq = ['grade'].concat(CommentBank.angle(f, {}).order);
      const steps = d.sentences.map(s => s.step);
      if (CommentBank.gradeOf(f)) expect(steps[0]).toBe('grade');
      steps.forEach((k, i) => {
        expect(seq, k).toContain(k);
        if (i) expect(seq.indexOf(k)).toBeGreaterThan(seq.indexOf(steps[i - 1]));
      });
      expect(d.replaced).toEqual([]);
      expect(CommentBank.verify(d, f, {}).text).toBe(d.text);
    });
  });

  it('leads with the story: growth for a climb, the best piece for a strong term', () => {
    const climb = CommentBank.angle(FIXTURES.climb, {});
    expect(climb.lead).toBe('growth');
    expect(CommentBank.angle(FIXTURES.strength, {}).lead).toBe('example');
    expect(CommentBank.angle(FIXTURES.hidden, {}).lead).toBe('example');
    expect(CommentBank.angle(FIXTURES.ie, {}).lead).toBe('ieProblem');
  });
});

describe('the Generate Comment button (Demo Mode, Science 8)', () => {
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
  const student = first => getStudents(cid).find(s => s.firstName === first);
  const factsFor = first => CommentBank.facts(cid, student(first), 'term-2');

  it('tells more than one story across the class', () => {
    const told = new Set(getStudents(cid).map(st => CommentBank.angle(CommentBank.facts(cid, st, 'term-2'), {}).id));
    expect(told.size).toBeGreaterThanOrEqual(4);
  });

  it('gives another version on every press, as the screen calls it (seed + press, the box’s text)', () => {
    const st = student('Cece');
    const ctx = CommentBank.context(factsFor('Cece'), {});
    let box = '';
    const seen = new Set();
    for (let n = 1; n <= 6; n++) {
      const d = CommentBank.draft(ctx, { seed: CommentBank.seedFor(st.id + '|term-2') + n, previous: box });
      expect(d.text, 'press ' + n).not.toBe(box);
      expect(d.replaced).toEqual([]);
      seen.add(d.text);
      box = d.text;
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it('tries the next seeds when a press would give the text already on screen', () => {
    const ctx = CommentBank.context(factsFor('Cece'), {});
    const first = CommentBank.draft(ctx, { seed: 11 });
    const again = CommentBank.draft(ctx, { seed: 11, previous: first.text });
    expect(again.text).not.toBe(first.text);
    expect(again.seed).not.toBe(11);
    expect(again.angle).toBe(first.angle);
  });

  it('keeps a sentence the teacher edited, as written, in its place', () => {
    const ctx = CommentBank.context(factsFor('Cece'), {});
    const d1 = CommentBank.draft(ctx, { seed: 1 });
    const edited = d1.sentences[2];
    const mine = 'Cece explained her lab results clearly in the class discussion.';
    for (let seed = 2; seed <= 6; seed++) {
      const d2 = CommentBank.draft(ctx, { seed, kept: { [edited.id]: mine }, previous: d1.text });
      const k = d2.sentences.filter(s => s.text === mine);
      expect(k).toHaveLength(1);
      expect(k[0]).toMatchObject({ id: edited.id, step: edited.step, kept: true });
      expect(d2.text).toContain(mine);
      // Its step is not drafted again, and nothing it said is said again.
      expect(d2.sentences.filter(s => s.step === edited.step)).toHaveLength(1);
      expect(d2.replaced).toEqual([]);
    }
  });

  it('keeps a sentence by its step too, and verify leaves kept text alone', () => {
    const f = factsFor('Cece');
    const ctx = CommentBank.context(f, {});
    const mine = 'Thank you for a good term.';
    const d = CommentBank.draft(ctx, { seed: 4, kept: { closer: mine } });
    expect(d.sentences[d.sentences.length - 1]).toMatchObject({ step: 'closer', text: mine, kept: true });
    const v = CommentBank.verify(d, f, {});
    expect(v.replaced).toEqual([]);
    expect(v.text).toBe(d.text);
  });

  it('keeps the order the teacher set on every press after', () => {
    const ctx = CommentBank.context(factsFor('Cece'), {});
    const d1 = CommentBank.draft(ctx, { seed: 1 });
    const steps = d1.sentences.map(s => s.step);
    // The teacher moved the closer to second and the grade sentence last.
    const order = [steps[steps.length - 1]].concat(steps.slice(1, -1), ['grade']);
    const ids = [d1.sentences[d1.sentences.length - 1].id].concat(
      d1.sentences.slice(1, -1).map(s => s.id),
      [d1.sentences[0].id],
    );
    [order, ids].forEach(o => {
      for (let seed = 2; seed <= 5; seed++) {
        const d2 = CommentBank.draft(ctx, { seed, order: o });
        const got = d2.sentences.map(s => s.step);
        expect(got[0]).toBe('closer');
        expect(got[got.length - 1]).toBe('grade');
        expect(d2.replaced).toEqual([]);
      }
    });
  });

  it('keeps an edited sentence and the order together', () => {
    const ctx = CommentBank.context(factsFor('Noor'), {});
    const d1 = CommentBank.draft(ctx, { seed: 1 });
    const steps = d1.sentences.map(s => s.step);
    const order = steps.slice().reverse();
    const mine = 'Noor’s lab notebook is careful and complete.';
    const d2 = CommentBank.draft(ctx, { seed: 9, order, kept: { [d1.sentences[1].id]: mine }, previous: d1.text });
    expect(d2.sentences.map(s => s.step)).toEqual(order.filter(k => d2.sentences.some(s => s.step === k)));
    expect(d2.sentences.find(s => s.kept).text).toBe(mine);
    expect(d2.text).not.toBe(d1.text);
  });

  it('runs verify on every draft: a sentence whose claim fails never reaches the screen', () => {
    const f = factsFor('Cece');
    const ctx = CommentBank.context(f, {});
    // A bank where the only attendance sentence claims what nothing backs.
    const h59 = COMMENT_BANK.sentences.find(s => s.id === 'h59');
    const bad = { ...h59, id: 'x-unbacked', group: 'Attendance', when: undefined, needs: undefined };
    const bank = { parts: COMMENT_BANK.parts, sentences: COMMENT_BANK.sentences.concat([bad]) };
    expect(CommentBank.fits(bad, ctx)).toBe(true);
    const d = CommentBank.draft(ctx, { seed: 1, bank });
    expect(d.replaced.map(r => r.sentenceId)).toEqual(['x-unbacked']);
    expect(d.replaced[0].failed).toEqual(['support']);
    expect(d.ids).not.toContain('x-unbacked');
    expect(d.text).not.toContain(CommentBank.fill(bad, ctx));
    expect(d.sentences.map(s => s.id)).toEqual(d.ids);
  });

  it('reads the enrolment date and the class’s first one from the roster', () => {
    const st = student('Cece');
    const was = st.enrolledDate;
    const term = getActiveTerm(cid);
    const later = new Date(parseLocalDate(term.startsOn).getTime() + 20 * 86400000);
    st.enrolledDate = later.toISOString().slice(0, 10);
    try {
      const f = CommentBank.facts(cid, st, 'term-2');
      expect(f.enrolled).toBe(st.enrolledDate);
      const first = getStudents(cid)
        .filter(x => x !== st)
        .map(x => x.enrolledDate)
        .sort()[0];
      expect(f.classStart).toBe(first);
      expect(f.termStart).toBe(term.startsOn);
      expect(CommentBank.angle(f, {}).id).toBe('newcomer');
    } finally {
      st.enrolledDate = was;
    }
  });
});
