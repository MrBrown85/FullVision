/**
 * Generate's selection (plan PR 5). Each step keeps the most specific
 * sentences that fit (the `when` conditions met), then the one no classmate
 * has before any a classmate has, then a seeded pick, so no sentence repeats
 * in a class until its tier is used up. When every top-tier sentence is
 * excluded, a sentence that asserts nothing stands in, never a vaguer claim.
 * Class usage is read off the classmates' saved comments. Observations are
 * never used (Colin, Oct 30). After the drafts, nearIdentical() flags pairs
 * of comments sharing five or more sentences.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };
const PARTS = [
  { id: 'habits', title: 'Work Habits' },
  { id: 'now', title: 'Where They Are Now' },
  { id: 'go', title: 'Where They Need to Go' },
  { id: 'how', title: 'How They Will Get There' },
];

/* A context built by hand: no facts, so the steps run in DRAFT_STEPS order
   and verify() does not run. */
const handCtx = over =>
  Object.assign({ _p: THEY, _habits: { completes: 4 }, _family: '', picture: 'steady', name: 'Noor' }, over || {});

const opening = (id, text, when, claims) => ({ id, part: 'now', group: 'Openings', text, when, claims });

describe('most specific wins', () => {
  const bank = {
    parts: PARTS,
    sentences: [
      opening('o0', 'Noor had a full term of science with the class.', undefined, ['strength']),
      opening('o1a', 'This was a steady term of work in every unit.', { picture: 'steady' }, ['picture']),
      opening('o1b', 'The term went steadily from the first week on.', { picture: 'steady' }, ['picture']),
      opening('o2', 'A steady term, with every assignment handed in complete.', { picture: 'steady', completes: 4 }, [
        'picture',
        'habits',
      ]),
      opening('n0', 'Here is a summary of the term in this class.', undefined, []),
    ],
  };
  const ids = d => d.ids;

  it('scores a sentence by the `when` conditions it meets', () => {
    const ctx = handCtx();
    const sp = id =>
      CommentBank.specificity(
        bank.sentences.find(s => s.id === id),
        ctx,
      );
    expect([sp('o0'), sp('o1a'), sp('o2'), sp('n0')]).toEqual([0, 1, 2, 0]);
  });

  it('counts the sentence that carries the Note for the Report as more specific', () => {
    const bp = { id: 'bp', part: 'now', text: '{bestPiece}', needs: ['bestPiece'] };
    expect(CommentBank.specificity(bp, handCtx({ _bestNote: true }))).toBe(1);
    expect(CommentBank.specificity(bp, handCtx({ _bestNote: false }))).toBe(0);
  });

  it('keeps the top tier on every seed, even when a classmate already has it', () => {
    const ctx = handCtx();
    for (let seed = 1; seed <= 20; seed++) expect(ids(CommentBank.draft(ctx, { bank, seed }))).toEqual(['o2']);
    const comments = [{ sid: 'x', text: 'A steady term, with every assignment handed in complete.' }];
    expect(ids(CommentBank.draft(ctx, { bank, seed: 3, comments }))).toEqual(['o2']);
  });

  it('takes the next tier only when the top one does not fit', () => {
    const ctx = handCtx({ _habits: { completes: 3 } });
    for (let seed = 1; seed <= 10; seed++)
      expect(['o1a', 'o1b']).toContain(ids(CommentBank.draft(ctx, { bank, seed }))[0]);
  });

  it('puts a no-claim sentence in place of an excluded top tier, never a vaguer claim', () => {
    const ctx = handCtx();
    for (let seed = 1; seed <= 10; seed++)
      expect(ids(CommentBank.draft(ctx, { bank, seed, exclude: ['o2'] }))).toEqual(['n0']);
    const noStandIn = { parts: PARTS, sentences: bank.sentences.filter(s => s.id !== 'n0') };
    const d = CommentBank.draft(ctx, { bank: noStandIn, seed: 1, exclude: ['o2'] });
    expect(d.ids).toEqual([]);
    expect(d.text).toBe('');
  });

  it('leaves the exclude list empty on the screen until approvals store their sentence ids', () => {
    const src = readFileSync('teacher/report-questionnaire.js', 'utf-8');
    expect(src).toMatch(/exclude: \[\],/);
  });
});

describe('exhaust before repeat', () => {
  const bank = {
    parts: PARTS,
    sentences: [
      opening('a', 'This term was steady work in every single unit.', { picture: 'steady' }, ['picture']),
      opening('b', 'Work went at a steady pace through the whole term.', { picture: 'steady' }, ['picture']),
      opening('c', 'The whole term showed steady and careful effort here.', { picture: 'steady' }, ['picture']),
      // Less specific: never used while the tier above fits.
      opening('z', 'Noor had a full term of science with the class.', undefined, ['strength']),
    ],
  };

  it('gives each sentence of the tier to one classmate before any gets a second', () => {
    const ctx = handCtx();
    const comments = [];
    const picks = [];
    for (let i = 0; i < 7; i++) {
      const d = CommentBank.draft(ctx, { bank, seed: 11 + i, comments });
      picks.push(d.ids[0]);
      comments.push({ sid: 's' + i, text: d.text });
    }
    expect(new Set(picks.slice(0, 3)).size).toBe(3);
    expect(new Set(picks.slice(3, 6)).size).toBe(3);
    expect(picks).not.toContain('z');
    const count = id => picks.filter(p => p === id).length;
    expect([count('a'), count('b'), count('c')].sort()).toEqual([2, 2, 3]);
  });

  it('reads usage off saved comments, plain or with a sid, never the student’s own', () => {
    const comments = [
      { sid: 's1', text: 'Noor did well. This term was steady work in every single unit.' },
      'Ava: work went at a steady pace through the whole term.',
      { sid: 'me', text: 'The whole term showed steady and careful effort here.' },
    ];
    expect(CommentBank.classUsage(bank, comments, 'cls-u', 'me')).toEqual({ a: 1, b: 1 });
  });
});

/* Facts with only what the story, the draft and verify read: a C+ student
   with eight even pieces and Comes Ready rated Consistently. */
function piece(day, pct) {
  const d = new Date(2026, 8, 1 + day);
  const iso =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return { id: 'p' + day, d: iso, pct };
}
function facts(cid, sid, name) {
  return {
    cid,
    sid,
    name,
    first: name,
    course: 'History 12',
    family: 'socials',
    pronouns: THEY,
    pronounsOnFile: false,
    comps: [],
    work: [],
    voice: {},
    confidence: [],
    record: { total: 8, handed: 8, late: 0, missing: 0 },
    notHandedIn: { count: 0, titles: [], groups: [] },
    habits: { ready: 4 },
    overall: 2.7,
    standing: '',
    letter: '',
    levelText: () => '',
    grade: {
      mode: 'letter',
      letter: 'C+',
      pct: 70,
      next: null,
      pieces: Array.from({ length: 8 }, (_, i) => piece(i * 7, 70)),
    },
    enrolled: '2026-09-03',
    classStart: '2026-09-03',
    termStart: '2026-09-03',
  };
}

describe('class usage for a sentence that is mostly slots', () => {
  // Neither has four words of its own, so neither has a pattern to find in a
  // saved comment: only this session's record of the draft can count them.
  const bank = {
    parts: PARTS,
    sentences: [
      {
        id: 'p1',
        part: 'habits',
        group: 'From Your Ratings',
        text: '{name} {strengthHabits}.',
        needs: ['strengthHabits'],
        claims: ['habits'],
      },
      {
        id: 'p2',
        part: 'habits',
        group: 'From Your Ratings',
        text: 'Also, {name} {strengthHabits}.',
        needs: ['strengthHabits'],
        claims: ['habits'],
      },
    ],
  };
  const cid = 'cls-slots';

  it('counts a classmate’s drafted sentence while their saved comment holds it', () => {
    bank.sentences.forEach(s => expect(CommentBank.pattern(s)).toBeNull());
    const fa = facts(cid, 'a', 'Noor');
    const da = CommentBank.draft(CommentBank.context(fa, {}), { bank, seed: 1 });
    expect(da.ids).toHaveLength(1);
    const used = da.ids[0];
    const saved = [{ sid: 'a', text: da.text }];
    expect(CommentBank.classUsage(bank, saved, cid, 'b')).toEqual({ [used]: 1 });
    // The next classmate gets the other one.
    const fb = facts(cid, 'b', 'Ava');
    for (let seed = 1; seed <= 5; seed++) {
      const db = CommentBank.draft(CommentBank.context(fb, {}), { bank, seed, comments: saved });
      expect(db.ids).toEqual([used === 'p1' ? 'p2' : 'p1']);
    }
  });

  it('stops counting it once the classmate’s comment no longer holds it', () => {
    const fa = facts(cid, 'c', 'Sam');
    CommentBank.draft(CommentBank.context(fa, {}), { bank, seed: 1 });
    expect(CommentBank.classUsage(bank, [{ sid: 'c', text: 'Rewritten by the teacher.' }], cid, 'd')).toEqual({});
    // A plain string carries no sid, so the record cannot be matched to it.
    const dc = CommentBank.draft(CommentBank.context(fa, {}), { bank, seed: 1 });
    expect(CommentBank.classUsage(bank, [dc.text], cid, 'd')).toEqual({});
  });
});

describe('near-identical comments', () => {
  const same = [
    '{n} is earning a B this term, which is very good work.',
    '{n} comes to class ready and uses class time well.',
    'Work habits are a strength this term in every way.',
    'The next step is to support each claim with evidence from a source.',
    'At home, ask about one source from this unit and who made it.',
    'Next term, the goal is to build on what is working.',
  ];
  const comment = (name, n, extra) =>
    same
      .slice(0, n)
      .map(s => s.split('{n}').join(name))
      .concat(extra || [])
      .join(' ');

  it('flags two comments sharing five or more sentences, the names set aside', () => {
    const out = CommentBank.nearIdentical([
      { sid: 'j', name: 'Jack', text: comment('Jack', 5, ['Jack’s map was careful.']) },
      { sid: 'a', name: 'Ava', text: comment('Ava', 5, ['Her poster was clear and complete.']) },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ a: 'j', b: 'a', shared: 5 });
    expect(out[0].pairs).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
  });

  it('does not flag four shared sentences', () => {
    expect(
      CommentBank.nearIdentical([
        { sid: 'j', name: 'Jack', text: comment('Jack', 4) },
        { sid: 'a', name: 'Ava', text: comment('Ava', 4) },
      ]),
    ).toEqual([]);
  });

  it('counts a sentence shared when any run of four words matches, each sentence once', () => {
    const a = 'Jack is earning a B this term. One. Two. Three. Four.';
    const b = 'Ava is earning a B, which is very good work.';
    expect(
      CommentBank.nearIdentical(
        [
          { sid: 'j', name: 'Jack', text: a },
          { sid: 'a', name: 'Ava', text: b },
        ],
        { min: 1 },
      ),
    ).toEqual([{ a: 'j', b: 'a', shared: 1, pairs: [[0, 0]] }]);
    // Short sentences have no run of four words.
    expect(
      CommentBank.nearIdentical(
        [
          { sid: 'j', text: 'Good. Nice work. Well done here.' },
          { sid: 'a', text: 'Good. Nice work. Well done here.' },
        ],
        { min: 1 },
      ),
    ).toEqual([]);
  });

  it('lists the pairs most shared first and skips empty comments', () => {
    const out = CommentBank.nearIdentical([
      { sid: 'a', name: 'Ava', text: comment('Ava', 5) },
      { sid: 'b', name: 'Ben', text: comment('Ben', 6) },
      { sid: 'c', name: 'Cy', text: comment('Cy', 6) },
      { sid: 'd', name: 'Dee', text: '' },
    ]);
    expect(out.map(p => [p.a, p.b, p.shared])).toEqual([
      ['b', 'c', 6],
      ['a', 'b', 5],
      ['a', 'c', 5],
    ]);
  });
});

describe('Demo Mode (Science 8, Report 2)', () => {
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

  it('has no observation sentences: no From Your Notes group, no note slot, no note claim', () => {
    expect(COMMENT_BANK.sentences.some(s => s.group === 'From Your Notes')).toBe(false);
    COMMENT_BANK.sentences.forEach(s => {
      expect(s.text, s.id).not.toMatch(/\{(note|when|concernNote|concernWhen)\}/);
      (s.needs || []).forEach(k => expect(['note', 'when', 'concernNote', 'concernWhen'], s.id).not.toContain(k));
      expect(s.claims, s.id).not.toContain('note');
    });
    expect(CommentBank.CLAIMS.note).toBeUndefined();
    CommentBank.DRAFT_STEPS.forEach(st => expect(st.groups || [], st.key).not.toContain('From Your Notes'));
  });

  it('never puts an observation’s words in a draft, private or not', () => {
    const students = getStudents(cid);
    const all = getQuickObs(cid) || {};
    const mark = {};
    students.forEach((st, i) => {
      mark[st.id] = 'Zebra crossing observation number ' + (i + 1) + ' in the lab.';
      all[st.id] = (all[st.id] || []).concat([
        {
          id: 'mark-' + i,
          text: mark[st.id],
          sentiment: i % 2 ? 'growth' : 'strength',
          dims: [],
          date: '2026-11-20',
          created: '2026-11-20T18:00:00.000Z',
        },
      ]);
    });
    saveQuickObs(cid, all);
    const texts = [];
    students.forEach(st => {
      (getStudentQuickObs(cid, st.id) || []).forEach(o => {
        if (
          String(o.text || '')
            .trim()
            .split(/\s+/).length >= 4
        )
          texts.push(String(o.text).trim());
      });
    });
    expect(texts.length).toBeGreaterThan(students.length);
    students.forEach(st => {
      const f = CommentBank.facts(cid, st, 'term-2');
      expect(f.obs).toBeUndefined();
      for (let seed = 1; seed <= 5; seed++) {
        const d = CommentBank.draft(CommentBank.context(f, {}), { seed });
        expect(d.text).not.toMatch(/Zebra crossing/);
        texts.forEach(t => expect(d.text, st.firstName).not.toContain(t.replace(/[.!?]+$/, '')));
      }
    });
  });

  it('drafts the class in turn from saved comments and audits it, each pair sharing five or more', () => {
    const students = getStudents(cid);
    const comments = [];
    students.forEach(st => {
      const f = CommentBank.facts(cid, st, 'term-2');
      const d = CommentBank.draft(CommentBank.context(f, {}), {
        seed: CommentBank.seedFor(st.id + '|term-2'),
        comments,
      });
      expect(d.replaced, st.firstName).toEqual([]);
      comments.push({ sid: st.id, name: f.name, names: [st.firstName], text: d.text });
    });
    const pairs = CommentBank.nearIdentical(comments);
    pairs.forEach((p, i) => {
      expect(p.shared).toBeGreaterThanOrEqual(5);
      if (i) expect(p.shared).toBeLessThanOrEqual(pairs[i - 1].shared);
    });
    // The same comment for two students is flagged with every sentence.
    const twin = Object.assign({}, comments[0], { sid: 'twin' });
    const n = twin.text.split(/(?<=[.!?”])\s+(?=[A-Z“])/).length;
    const flagged = CommentBank.nearIdentical([comments[0], twin]);
    expect(flagged).toHaveLength(n >= 5 ? 1 : 0);
    if (n >= 5) expect(flagged[0].shared).toBe(n);
  });

  it('never repeats an opening in the class until every opening that fits is used', () => {
    const students = getStudents(cid);
    const comments = [];
    const byPicture = {};
    students.forEach(st => {
      const f = CommentBank.facts(cid, st, 'term-2');
      const ctx = CommentBank.context(f, {});
      const d = CommentBank.draft(ctx, { seed: CommentBank.seedFor(st.id), comments });
      comments.push({ sid: st.id, text: d.text });
      const op = d.sentences.find(x => x.step === 'opening');
      if (!op) return;
      const fit = COMMENT_BANK.sentences.filter(s => s.group === 'Openings' && CommentBank.fits(s, ctx));
      const seen = (byPicture[ctx.picture] = byPicture[ctx.picture] || []);
      if (seen.indexOf(op.id) >= 0)
        expect(
          fit.every(s => seen.indexOf(s.id) >= 0),
          st.firstName,
        ).toBe(true);
      seen.push(op.id);
    });
  });
});
