/**
 * The personal bank (plan PR 10, teacher/comment-personal.js): after a
 * comment is approved, each sentence the teacher wrote or changed is split
 * out, the student's details become slots, and the template is bound to the
 * condition that was true. Filters leave out another student's name, a
 * date, a quotation, a one-time marker, a capitalised word FullVision does
 * not know, a health or designation word, under 6 or over 20 words, the
 * lint's findings, and near-duplicates. Nothing enters the bank until the
 * teacher keeps it; kept sentences rank above the shared bank when their
 * condition holds, pass verify(), and show as "Yours" in Browse Sentences.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
const SHE = { subj: 'she', obj: 'her', poss: 'her', refl: 'herself' };
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };
const PB = PersonalBank;
const REAL_V2 = window.v2;

const pts = vs => vs.map((v, i) => ({ id: 'w' + i, d: '2026-09-' + String(10 + i), v, title: 'Task ' + i }));
const comp = (id, name, level, n = 3) => ({
  id,
  name,
  scores: pts(Array.from({ length: n }, () => level)),
  start: level,
  now: level,
  level,
  iCans: [],
});
/* One student's term, built by hand (CommentBank.facts' shape). */
function facts(over) {
  return Object.assign(
    {
      cid: 'c1',
      sid: 's1',
      name: 'Gabriel',
      first: 'Gabriel',
      course: 'History 12',
      family: 'socials',
      pronouns: HE,
      pronounsOnFile: true,
      comps: [comp('a', 'Evidence', 3.5), comp('b', 'Significance', 3), comp('c', 'Perspective', 2.5)],
      work: [{ id: 'x1', title: '4.2 The Poster', d: '2026-09-20', v: 3.5, pct: null, note: '' }],
      voice: {},
      confidence: [],
      record: { total: 6, handed: 6, late: 0, missing: 0 },
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
      absent: 0,
      late: 0,
    },
    over,
  );
}
const GABRIEL = { id: 's1', firstName: 'Gabriel', lastName: 'Wong' };
const AMELIA = { id: 's2', firstName: 'Amelia', lastName: 'Tavares' };
const OTHERS = ['Amelia', 'Tavares', 'Jessie', 'Jin', 'Owen', 'Price'];
/* The base sentence most rows replace: the bank's n11 (an Overall frame
   saying the proficiency word and a strength), cut in round three, kept
   here as the test's own, since PB.suggest reads it from the row alone. */
const N11 = {
  id: 'n11',
  part: 'now',
  group: 'Overall',
  text: '{He} [is|are] working at {standing} overall, and {he} can {strengths}.',
  needs: ['standing', 'strengths'],
  claims: ['grade', 'strength'],
};
const byId = id => (id === 'n11' ? N11 : COMMENT_BANK.sentences.find(s => s.id === id));

/* A row of the Sentences card the teacher changed: in a step, replacing a
   bank sentence (with its provenance) or none. */
function rowFor(step, text, baseId, ctx) {
  const s = baseId ? byId(baseId) : null;
  return { step, text, edited: true, classLine: false, s, prov: s ? CommentBank.provenance(s, ctx) : null };
}
function suggestFor(text, opts = {}) {
  const f = opts.f || facts();
  const ctx = CommentBank.context(f, {});
  const row = rowFor(opts.step || 'overall', text, opts.base === undefined ? 'n11' : opts.base, ctx);
  return PB.suggest(text, row, ctx, f, opts.student || GABRIEL, { others: OTHERS });
}
const reason = (text, opts) => suggestFor(text, opts).reason;

// Kept sentences save through window.v2; here nothing reaches a server.
beforeEach(() => {
  localStorage.clear();
  window.v2 = Object.assign({}, REAL_V2, { saveCommentTemplate: () => Promise.resolve({ data: null, error: null }) });
  PB._reset();
  PB.install();
});
afterEach(() => {
  localStorage.clear();
  window.v2 = REAL_V2;
  PB._reset();
  PB.install();
});

describe('the filters', () => {
  it('leaves out a sentence that names another student', () => {
    expect(reason('Gabriel and Amelia wrote a report on the treaty together this term.')).toBe(
      'another student: Amelia',
    );
    expect(reason('Gabriel read his notes to Owen before each quiz this term.')).toBe('another student: Owen');
  });

  it('keeps a classmate who shares the student’s own name', () => {
    const f = facts();
    const ctx = CommentBank.context(f, {});
    const out = PB.suggest(
      'Gabriel explains how causes connect in each unit of the course.',
      rowFor('overall', '', 'n11', ctx),
      ctx,
      f,
      GABRIEL,
      { others: ['Gabriel', 'Amelia'] },
    );
    expect(out.template).toBeTruthy();
  });

  /* A classmate whose name is one letter ("J", "O") was never checked, so a
     kept template could name them. A one-letter name matches only as a
     whole word with its capital, so "a" and "I" in an ordinary sentence
     never block. */
  describe('a classmate with a one-letter name', () => {
    const CLASS = ['Amelia', 'Tavares', 'J', 'O', 'Owen'];
    const sug = (text, others = CLASS) => {
      const f = facts();
      const ctx = CommentBank.context(f, {});
      return PB.suggest(text, rowFor('overall', text, 'n11', ctx), ctx, f, GABRIEL, { others });
    };
    const comp = text => {
      const f = facts();
      return PB.compose(text, { step: 'overall' }, CommentBank.context(f, {}), f, GABRIEL, { others: CLASS });
    };
    it('leaves out a sentence that names them', () => {
      expect(sug('Gabriel worked with J on every lab report this term.').reason).toBe('another student: J');
      expect(sug('Gabriel and O built the trench model as a pair.').reason).toBe('another student: O');
      expect(sug('Gabriel read J’s notes before each quiz this term.').reason).toBe('another student: J');
      expect(comp('Gabriel worked with J on every lab report this term.').blocked).toBe(
        '“J” is a classmate’s name; a bank sentence cannot name another student.',
      );
    });
    it('does not block "a", "I", a lowercase letter or a longer name that starts with the letter', () => {
      const ok = [
        'Gabriel wrote a clear essay and I was glad to see his revisions.',
        'Gabriel can explain part j of the unit guide in his own words.',
        'Gabriel asked Jin and O’Brien careful questions in every discussion.',
        'Gabriel explains how causes connect in each unit of the course.',
      ];
      ok.forEach(t => expect(sug(t).reason || '', t).not.toMatch(/another student/));
      ok.forEach(t => expect(comp(t).blocked, t).not.toMatch(/classmate/));
    });
    it('a lowercase one-letter entry is not a classmate’s name', () => {
      const text = 'Gabriel wrote a clear essay and I was glad to see his revisions.';
      expect(sug(text, ['a', 'i']).reason || '').not.toMatch(/another student/);
    });
  });

  it('leaves out a date', () => {
    expect(reason('The map project can still be handed in until December 4.')).toBe('a date');
    expect(reason('Gabriel finished the first unit by 10/21 with time to spare.')).toBe('a date');
    expect(reason('Gabriel kept every reading log in order through 2026.')).toBe('a date');
  });

  it('leaves out a one-time marker', () => {
    expect(reason('Gabriel led the group discussion on Tuesday with real care.')).toBe('about one day');
    expect(reason('He was away for the field trip on October 21, so the poster is still coming.')).toBe(
      'about one day',
    );
    expect(reason('Gabriel asked three good questions in class yesterday about the treaty.')).toBe('about one day');
    expect(reason('Last week Gabriel explained the causes of the war to his group.')).toBe('about one day');
  });

  it('leaves out a quotation', () => {
    expect(reason('Gabriel said “I finally get it” after the map lesson this term.')).toBe('a quotation');
  });

  it('leaves out an unknown capitalised word', () => {
    expect(reason('Gabriel writes about Canada with a sense of who was involved.')).toBe('unknown word: Canada');
    expect(reason('Gabriel asks Ms. Patel for help with each source he reads.')).toBe('unknown word: Ms');
    // A proficiency word that is not the student's overall.
    expect(reason('Gabriel is now Developing in how he explains each source.')).toBe('unknown word: Developing');
  });

  it('leaves out a word on the health and designation list', () => {
    expect(reason('His counsellor and I agreed on a lighter load this month.')).toBe('private: counsellor');
    expect(reason('Gabriel has an IEP goal for reading longer sources this term.')).toBe('private: IEP');
    expect(reason('His anxiety before tests has eased as the term went on.')).toBe('private: anxiety');
    // The BC designations' names (shared/constants.js).
    expect(reason('Gabriel works with his learning disability by using the class notes.')).toBe(
      'private: learning disability',
    );
    expect(reason('Gabriel uses a timer to help with his ADHD during long tasks.')).toBe('private: ADHD');
  });

  it('keeps sentences to 6–20 words', () => {
    expect(reason('Gabriel works hard.')).toBe('under six words');
    expect(
      reason(
        'Gabriel reads each source with care and then writes a summary of it and then explains it to the class in his own words.',
      ),
    ).toBe('over 20 words');
    expect(suggestFor('Gabriel explains how causes connect in history.').template).toBeTruthy();
  });

  it('leaves out wording the vocabulary lint flags', () => {
    expect(reason('Gabriel explains how causes build on each other in every unit.')).toBe('phrasal verb: build on');
    expect(reason('Gabriel is a bright student who reads every source we use.')).toBe('person praise: bright');
    expect(reason('Gabriel writes insightful answers about each event in the unit.')).toBe(
      'evaluative word: insightful',
    );
  });

  it('leaves out a near-duplicate of the shared bank, of the teacher’s bank, and of another suggestion', () => {
    const f = facts();
    const ctx = CommentBank.context(f, {});
    const item = t => PB.suggest(t, rowFor('home', t, 'f03', ctx), ctx, f, GABRIEL, { others: OTHERS });
    // Nearly f03: "At home, you can ask {him} what a news story means …".
    const nearBank = item('At home, you could ask him what one news story means for the people in it.');
    const fresh = item('At home, you could ask him which map in his notes he would redraw and why.');
    const twin = item('At home, you could ask him which map in his notes he would draw once more and why.');
    expect(nearBank.template && fresh.template && twin.template).toBeTruthy();
    PB.noteApproved('c1', 'term-1', 's1', 'Gabriel Wong', [nearBank, fresh, twin]);
    let r = PB.review('c1', 'term-1', ['s1']);
    expect(r.pending.map(x => x.text)).toEqual([fresh.text]);
    expect(r.left).toEqual([{ text: nearBank.text, reason: 'already in the bank' }]);
    // Once kept, the same sentence from another comment is already yours.
    PB.keep(fresh.template);
    PB.noteApproved('c1', 'term-2', 's1', 'Gabriel Wong', [twin]);
    r = PB.review('c1', 'term-2', ['s1']);
    expect(r.pending).toEqual([]);
    expect(r.left).toEqual([{ text: twin.text, reason: 'already in your bank' }]);
  });

  it('tells near-duplicates by their words, a slot counting as one', () => {
    expect(PB.near('{He} [reads|read] every source with care.', '{He} [reads|read] each source with care.')).toBe(true);
    expect(
      PB.near('{He} [reads|read] every source with care.', '{He} [checks|check] each date on {his} timeline.'),
    ).toBe(false);
    expect(
      PB.near(
        'At home, you can ask {him} what a news story means for the people in it.',
        'At home, you could ask {him} what one news story means for the people in it.',
      ),
    ).toBe(true);
  });
});

describe('the student’s details as slots', () => {
  it('turns the name and pronouns into role slots, with chips, and the verb into both forms', () => {
    const out = suggestFor('Gabriel explains how causes connect, and his timelines are always in order.');
    expect(out.template.text).toBe(
      '{He} [explains|explain] how causes connect, and {his} timelines are always in order.',
    );
    expect(out.chips).toEqual([
      { from: 'Gabriel', to: 'student’s name' },
      { from: 'his', to: 'his, her or their' },
    ]);
  });

  it('reads "her" as him or his from the words around it', () => {
    const f = facts({ name: 'Amelia', first: 'Amelia', pronouns: SHE });
    const ctx = CommentBank.context(f, {});
    const sl = t => PB.slotify(t, PB.entities(ctx, f, AMELIA, t));
    expect(sl('At home, you could ask her what one news story means for the people in it.').text).toBe(
      'At home, you could ask {him} what one news story means for the people in it.',
    );
    expect(sl('Amelia shows her thinking in every map she makes.').text).toBe(
      '{He} [shows|show] {his} thinking in every map {he} [makes|make].',
    );
    expect(sl('A weekly plan would help her improve each draft.').text).toBe(
      'A weekly plan would help {him} improve each draft.',
    );
    expect(sl('Ask her to read her brother the notes each week.').text).toBe(
      'Ask {him} to read {his} brother the notes each week.',
    );
  });

  it('gives a they/them student’s verbs both forms the other way round', () => {
    const f = facts({ name: 'Sam', first: 'Sam', pronouns: THEY });
    const ctx = CommentBank.context(f, {});
    const t = 'Sam explains each source, and they compare the sources they find with care.';
    expect(PB.slotify(t, PB.entities(ctx, f, { firstName: 'Sam' }, t)).text).toBe(
      '{He} [explains|explain] each source, and {he} [compares|compare] the sources {he} [finds|find] with care.',
    );
  });

  it('slots the assignment, the competency, the proficiency word and the class name', () => {
    const out = suggestFor('In History 12, Gabriel used Evidence in “The Poster” at a Proficient standard.');
    expect(out.template.text).toBe('In {course}, {he} used {strengths} in {assignment} at a {standingWord} standard.');
    expect(out.chips).toEqual(
      expect.arrayContaining([
        { from: '“The Poster”', to: 'best piece' },
        { from: 'Evidence', to: 'strongest competency' },
        { from: 'Proficient', to: 'overall proficiency' },
        { from: 'History 12', to: 'class name' },
      ]),
    );
    expect(out.template.condition.claims).toEqual(expect.arrayContaining(['strength', 'bestPiece', 'grade']));
  });

  it('slots a count and binds it to one or more, so the noun and verb agree', () => {
    const f = facts({ notHandedIn: { count: 1, titles: ['Map Quiz'], groups: [] } });
    const out = suggestFor('One assignment is missing, and Gabriel can bring it to class soon.', {
      f,
      step: 'notHandedIn',
      base: null,
    });
    expect(out.template.text).toBe('{missingCount} assignment is missing, and {he} can bring it to class soon.');
    expect(out.chips[0]).toEqual({ from: 'One assignment', to: 'how many' });
    expect(out.template.condition.counts).toEqual({ missingCount: 'one' });
    expect(out.offered).toBe('Offered when one assignment is not handed in, in Socials classes');
  });

  it('leaves out a number it cannot place', () => {
    expect(reason('Gabriel read 14 sources for the final project this term.')).toBe('a number');
  });
});

describe('the condition that was true', () => {
  it('binds the competencies the replaced sentence was about, the kind of class and its claims', () => {
    const out = suggestFor('Gabriel explains how causes connect, and his timelines are always in order.');
    expect(out.template.condition).toMatchObject({
      step: 'overall',
      part: 'now',
      group: 'Overall',
      family: 'socials',
      comps: { strengths: ['Evidence'] },
    });
    expect(out.template.condition.needs).toContain('strengths');
    expect(out.template.condition.claims).toContain('strength');
    expect(out.offered).toBe('Offered when Evidence is a strength, in Socials classes');
  });

  it('says the next step, the habits and the picture in plain words', () => {
    expect(PB.offeredWhen({ comps: { nextSkill: ['Perspective', 'Significance'] } })).toBe(
      'Offered when the next step is Perspective or Significance',
    );
    expect(PB.offeredWhen({ needs: ['missingWork'], family: 'science' })).toBe(
      'Offered when work is not handed in, in Science classes',
    );
    expect(PB.offeredWhen({ when: { picture: 'strong' } })).toBe('Offered when the term’s picture is strong');
    expect(PB.offeredWhen({})).toBe('Offered for every student');
  });

  it('reads only sentences the teacher wrote or changed, in a part a sentence of their own can take', () => {
    const f = facts();
    const ctx = CommentBank.context(f, {});
    const t = 'Gabriel explains how causes connect in each unit of the course.';
    const rows = [
      Object.assign(rowFor('overall', t, 'n11', ctx), { edited: false }),
      rowFor('grade', t, null, ctx),
      Object.assign(rowFor('closer', t, null, ctx), { classLine: true }),
      rowFor('support', t, null, ctx),
      rowFor('ieProblem', t, null, ctx),
      Object.assign(rowFor(null, t, null, ctx), { step: null }),
      rowFor('overall', t, 'n11', ctx),
    ];
    expect(PB.fromRows(rows, ctx, f, GABRIEL, {}).length).toBe(1);
  });
});

describe('kept sentences in Generate', () => {
  const homeText = 'At home, you could ask him which map in his notes he would redraw and why.';
  const keepFromGabriel = (text, step, base) => {
    const f = facts();
    const ctx = CommentBank.context(f, {});
    const out = PB.suggest(text, rowFor(step, text, base, ctx), ctx, f, GABRIEL, { others: OTHERS });
    expect(out.template).toBeTruthy();
    return PB.keep(out.template);
  };
  const ameliaFacts = over =>
    facts(Object.assign({ sid: 's2', name: 'Amelia', first: 'Amelia', pronouns: SHE }, over || {}));

  it('enters the bank only when kept, marked mine', () => {
    expect(COMMENT_BANK.sentences.some(s => s.mine)).toBe(false);
    const e = keepFromGabriel(homeText, 'home', 'f03');
    const s = COMMENT_BANK.sentences.find(x => x.id === 'mine:' + e.id);
    expect(s).toMatchObject({ mine: true, part: 'how', group: 'For the Family', subjects: ['socials'] });
    expect(CommentBank.stepOf(s)).toBe('home');
    expect(PB.count()).toBe(1);
  });

  it('ranks above the shared bank when its condition holds, and passes verify()', () => {
    keepFromGabriel(homeText, 'home', 'f03');
    for (let seed = 1; seed <= 6; seed++) {
      const d = CommentBank.draft(CommentBank.context(ameliaFacts(), {}), { seed });
      const home = d.sentences.find(x => x.step === 'home');
      expect(home.id).toMatch(/^mine:/);
      expect(home.text).toBe('At home, you could ask her which map in her notes she would redraw and why.');
      expect(d.replaced).toEqual([]);
    }
  });

  it('is not offered where its condition does not hold', () => {
    keepFromGabriel(homeText, 'home', 'f03');
    const science = ameliaFacts({ family: 'science', course: 'Science 10' });
    const d = CommentBank.draft(CommentBank.context(science, {}), { seed: 2 });
    expect(d.ids.some(id => /^mine:/.test(id))).toBe(false);
  });

  it('holds a competency it was bound to: the next step is the same competency', () => {
    keepFromGabriel('Next, he can say how two people saw the same event in different ways.', 'nextStep', 'g310');
    const mine = COMMENT_BANK.sentences.find(s => s.mine);
    expect(mine.comps).toEqual({ nextSkill: ['Perspective'] });
    const same = CommentBank.context(ameliaFacts(), {});
    expect(CommentBank.fits(mine, same)).toBe(true);
    const d = CommentBank.draft(same, { seed: 4 });
    expect(d.sentences.find(x => x.step === 'nextStep').text).toBe(
      'Next, she can say how two people saw the same event in different ways.',
    );
    expect(d.replaced).toEqual([]);
    // Significance lowest: another next step, so the sentence is not offered.
    const other = CommentBank.context(
      ameliaFacts({
        comps: [comp('a', 'Evidence', 3.5), comp('b', 'Significance', 2.5), comp('c', 'Perspective', 3)],
      }),
      {},
    );
    expect(CommentBank.fits(mine, other)).toBe(false);
  });

  it('holds a count to one or more', () => {
    const f = facts({ notHandedIn: { count: 1, titles: ['Map Quiz'], groups: [] } });
    const ctx = CommentBank.context(f, {});
    const t = 'One assignment is missing, and Gabriel can bring it to class soon.';
    PB.keep(PB.suggest(t, rowFor('notHandedIn', t, null, ctx), ctx, f, GABRIEL, {}).template);
    const mine = COMMENT_BANK.sentences.find(s => s.mine);
    const one = CommentBank.context(ameliaFacts({ notHandedIn: { count: 1, titles: ['Essay'], groups: [] } }), {});
    const three = CommentBank.context(
      ameliaFacts({ notHandedIn: { count: 3, titles: ['A', 'B', 'C'], groups: [] } }),
      {},
    );
    expect(CommentBank.fits(mine, one)).toBe(true);
    expect(CommentBank.fill(mine, one, { first: true })).toBe(
      'One assignment is missing, and Amelia can bring it to class soon.',
    );
    expect(CommentBank.fits(mine, three)).toBe(false);
  });

  it('fails verify() when a slot it was filled with is no longer true', () => {
    const f = facts({ notHandedIn: { count: 1, titles: ['Map Quiz'], groups: [] } });
    const ctx = CommentBank.context(f, {});
    const t = 'One assignment is missing, and Gabriel can bring it to class soon.';
    PB.keep(PB.suggest(t, rowFor('notHandedIn', t, null, ctx), ctx, f, GABRIEL, {}).template);
    const mine = COMMENT_BANK.sentences.find(s => s.mine);
    const pv = CommentBank.provenance(mine, ctx);
    expect(CommentBank.CLAIMS.notHandedIn(pv, f)).toBe(true);
    const later = facts({ notHandedIn: { count: 2, titles: ['Map Quiz', 'Essay'], groups: [] } });
    expect(CommentBank.CLAIMS.notHandedIn(pv, later)).toBe(false);
  });

  it('shows as Yours in Browse Sentences', () => {
    keepFromGabriel(homeText, 'home', 'f03');
    const ctx = CommentBank.context(ameliaFacts(), {});
    const list = ReportQuestionnaire.browseList('nextStep', ctx, { fits: true });
    const mine = list.rows.filter(r => r.mine);
    expect(mine.length).toBe(1);
    expect(mine[0].text).toBe('At home, you could ask her which map in her notes she would redraw and why.');
    expect(list.rows.filter(r => !r.mine).length).toBeGreaterThan(0);
  });

  it('passes the vocabulary lint, every one', () => {
    keepFromGabriel(homeText, 'home', 'f03');
    PB.sentences().forEach(s => expect(CommentLint.findings(s.text)).toEqual([]));
  });
});

describe('the bank on the device and the server', () => {
  const originalV2 = REAL_V2;

  it('saves a kept sentence through window.v2 and takes the server’s id', async () => {
    const calls = [];
    window.v2 = Object.assign({}, originalV2, {
      saveCommentTemplate: p => {
        calls.push(p);
        return Promise.resolve({ data: { id: '11111111-1111-4111-8111-111111111111' }, error: null });
      },
    });
    const e = PB.keep({ text: '{He} [reads|read] each source with care.', slots: ['He'], condition: { part: 'now' } });
    expect(calls).toEqual([
      { text: '{He} [reads|read] each source with care.', slots: ['He'], condition: { part: 'now' } },
    ]);
    expect(e.id).toMatch(/^ct-/);
    await Promise.resolve();
    await Promise.resolve();
    expect(PB.list()[0].id).toBe('11111111-1111-4111-8111-111111111111');
    expect(JSON.parse(localStorage.getItem('gb-comment-templates'))[0].id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('keeps the device copy when the list fails (no table yet, offline): an empty bank to start', async () => {
    window.v2 = Object.assign({}, originalV2, {
      listCommentTemplates: () => Promise.resolve({ data: null, error: { message: 'function does not exist' } }),
    });
    expect(await PB.load(true)).toBe(false);
    expect(PB.list()).toEqual([]);
    expect(COMMENT_BANK.sentences.some(s => s.mine)).toBe(false);
  });

  it('takes the server’s rows on load, with a sentence kept here and not yet saved in front', async () => {
    const f = facts();
    const ctx = CommentBank.context(f, {});
    const t = 'At home, you could ask him which map in his notes he would redraw and why.';
    const tpl = PB.suggest(t, rowFor('home', t, 'f03', ctx), ctx, f, GABRIEL, {}).template;
    window.v2 = Object.assign({}, originalV2, {
      saveCommentTemplate: () => new Promise(() => {}),
      listCommentTemplates: () =>
        Promise.resolve({
          data: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              text: 'Next, {he} can say how two people saw the same event in different ways.',
              slots: ['he'],
              condition: { part: 'go', group: 'Next Step', needs: ['nextSkill'], claims: ['nextStep'] },
              uses: 0,
            },
          ],
          error: null,
        }),
    });
    PB.keep(tpl);
    expect(await PB.load(true)).toBe(true);
    expect(PB.list().map(x => x.text)).toEqual([
      tpl.text,
      'Next, {he} can say how two people saw the same event in different ways.',
    ]);
    expect(COMMENT_BANK.sentences.filter(s => s.mine).length).toBe(2);
  });

  it('removes a kept sentence here and on the server', () => {
    const del = [];
    window.v2 = Object.assign({}, originalV2, { deleteCommentTemplate: id => del.push(id) });
    PB._reset();
    localStorage.setItem(
      'gb-comment-templates',
      JSON.stringify([
        {
          id: '33333333-3333-4333-8333-333333333333',
          text: 'Next, {he} can say how two people saw the same event in different ways.',
          condition: { part: 'go', group: 'Next Step', needs: ['nextSkill'], claims: ['nextStep'] },
        },
      ]),
    );
    PB.install();
    expect(COMMENT_BANK.sentences.some(s => s.mine)).toBe(true);
    expect(PB.remove('mine:33333333-3333-4333-8333-333333333333')).toBe(true);
    expect(del).toEqual(['33333333-3333-4333-8333-333333333333']);
    expect(COMMENT_BANK.sentences.some(s => s.mine)).toBe(false);
  });
});

describe('the data layer', () => {
  let originalGetSupabase;
  let originalUseSupabase;
  let calls;
  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    _teacherId = 'teacher-uuid';
    calls = [];
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        calls.push({ name, payload: payload || {} });
        return Promise.resolve({ data: name === 'list_comment_templates' ? [] : null, error: null });
      },
    });
  });
  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  it('saves with the template, its slots and condition, and an idempotency key', async () => {
    await REAL_V2.saveCommentTemplate({
      text: ' {He} [reads|read] each source. ',
      slots: ['He'],
      condition: { part: 'now' },
    });
    expect(calls[0].name).toBe('save_comment_template');
    expect(calls[0].payload).toMatchObject({
      p_text: '{He} [reads|read] each source.',
      p_slots: ['He'],
      p_condition: { part: 'now' },
      p_id: null,
      p_uses: null,
    });
    expect(_isUuid(calls[0].payload.p_idempotency_key)).toBe(true);
  });

  it('deletes by server id with a key, and sends nothing for a local id', async () => {
    await REAL_V2.deleteCommentTemplate('ct-local');
    expect(calls).toEqual([]);
    await REAL_V2.deleteCommentTemplate('44444444-4444-4444-8444-444444444444');
    expect(calls[0].name).toBe('delete_comment_template');
    expect(calls[0].payload.p_id).toBe('44444444-4444-4444-8444-444444444444');
    expect(_isUuid(calls[0].payload.p_idempotency_key)).toBe(true);
  });

  it('lists as an array, and a failed list as null', async () => {
    expect((await REAL_V2.listCommentTemplates()).data).toEqual([]);
    globalThis.getSupabase = () => ({
      rpc: () => Promise.resolve({ data: null, error: { message: 'function does not exist' } }),
    });
    expect((await REAL_V2.listCommentTemplates()).data).toBeNull();
  });

  it('matches the migration’s functions', () => {
    const sql = readFileSync('migrations/20261031_comment_template.sql', 'utf-8');
    expect(sql).toMatch(/function public\.save_comment_template\(\s*p_text text,\s*p_slots jsonb/);
    expect(sql).toMatch(/function public\.list_comment_templates\(\)/);
    expect(sql).toMatch(/function public\.delete_comment_template\(p_id uuid, p_idempotency_key uuid/);
    expect(sql).not.toMatch(/student_id|enrollment_id/);
  });
});

describe('Suggested for Your Bank', () => {
  const f = facts();
  const ctx = CommentBank.context(f, {});
  const item = t => PB.suggest(t, rowFor('overall', t, 'n11', ctx), ctx, f, GABRIEL, { others: OTHERS });
  const four = [
    'Gabriel explains how causes connect, and his timelines are always in order.',
    'Gabriel reads each source twice and marks who made it in the margin.',
    'Gabriel checks each date on his timeline against two sources in the unit.',
    'Gabriel asks a question about every source before he writes about it.',
  ];

  it('shows three at a time with the approved wording, and nothing is kept until Keep', () => {
    PB.noteApproved(
      'c1',
      'term-1',
      's1',
      'Gabriel Wong',
      four.map(item).concat([item('His counsellor and I agreed on a lighter load this month.')]),
    );
    const html = PB.sheetHtml({ cid: 'c1', termId: 'term-1', order: ['s1'], course: 'History 12', total: 30 });
    expect(html).toContain('Suggested for Your Bank');
    expect(html).toContain('History 12 · all 30 comments approved');
    expect(html).toContain(
      'Sentences you wrote or changed in this class. Keep the ones you would use again, and Generate will offer them first for students they fit. Nothing is kept unless you choose Keep.',
    );
    expect(html).toContain('From Gabriel Wong’s comment');
    expect(html).toContain('For other students:');
    expect(html).toContain('Gabriel → student’s name');
    expect(html).toContain('his → his, her or their');
    expect(html).toContain('Offered when Evidence is a strength, in Socials classes');
    expect(html).toContain('Left out (1)');
    expect(html).toContain('“His counsellor and I agreed on a lighter load this month.” · private: counsellor');
    expect(html).toContain('3 of 4 shown · your bank has 0 sentences');
    expect((html.match(/data-bank="keep"/g) || []).length).toBe(3);
    ['Skip', 'Keep', 'Later', 'Done'].forEach(b => expect(html).toMatch(new RegExp('title="[^"]+">' + b + '<')));
    expect(PB.count()).toBe(0);
  });

  it('Keep adds it to the bank and Skip leaves it out; the next one moves up', () => {
    PB.noteApproved('c1', 'term-1', 's1', 'Gabriel Wong', four.map(item));
    let r = PB.review('c1', 'term-1', ['s1']);
    PB.keep(r.pending[0].template);
    PB.decide('c1', 'term-1', r.pending[0].key, 'kept');
    PB.decide('c1', 'term-1', r.pending[1].key, 'skipped');
    r = PB.review('c1', 'term-1', ['s1']);
    expect(r.pending.map(x => x.text)).toEqual(four.slice(2));
    expect(PB.count()).toBe(1);
    const html = PB.sheetHtml({ cid: 'c1', termId: 'term-1', order: ['s1'], course: 'History 12', total: 30 });
    expect(html).toContain('2 of 2 shown · your bank has 1 sentence');
  });

  it('opens once after the last approval; Later brings it back once a page, Done never', () => {
    expect(PB.shouldOffer('c1', 'term-1', false)).toBe(false);
    expect(PB.shouldOffer('c1', 'term-1', true)).toBe(true);
    PB.setStatus('c1', 'term-1', 'later');
    expect(PB.shouldOffer('c1', 'term-1', false)).toBe(true);
    PB.setStatus('c1', 'term-1', 'done');
    expect(PB.shouldOffer('c1', 'term-1', false)).toBe(false);
    expect(PB.shouldOffer('c1', 'term-1', true)).toBe(false);
  });

  it('keeps Demo Mode’s bank apart from a signed-in teacher’s', () => {
    const was = window.isDemoMode;
    window.isDemoMode = () => true;
    try {
      PB._reset();
      PB.keep({ text: '{He} [reads|read] each source with care and patience.', condition: {} });
      expect(localStorage.getItem('gb-comment-templates-demo')).toBeTruthy();
      expect(localStorage.getItem('gb-comment-templates')).toBeNull();
    } finally {
      window.isDemoMode = was;
      PB._reset();
    }
  });

  it('is wired into approval: suggestions are noted on Approve and Next and offered after the last one', () => {
    const src = readFileSync('teacher/report-questionnaire.js', 'utf-8');
    const approve = src.slice(src.indexOf('function tqApproveNext'), src.indexOf('function _noteForBank'));
    expect(approve).toMatch(/_noteForBank\(st, true\);[\s\S]*_nextUnapproved\(\);[\s\S]*_offerBank\(true\);/);
    expect(src).toMatch(/PersonalBank\.load\(\);/);
  });
});

/* A sentence the teacher writes for the bank (Colin, Nov 1: "Can teachers
   just write their own and add to a bank easily?"): one line for the
   student on screen, slotted like a suggestion, bound to a row's case or
   a part (and a case picked), the lint as advice only, the save blocked
   only by a classmate's name or a health or designation word. */
describe('a sentence of the teacher’s own', () => {
  const setup = over => {
    const f = facts(over);
    const ctx = CommentBank.context(f, {});
    return { f, ctx };
  };
  const composeFor = (text, bind, over) => {
    const { f, ctx } = setup(over);
    return PB.compose(text, bind, ctx, f, GABRIEL, { others: OTHERS });
  };
  const bestPieceRow = ctx => rowFor('example', '', 'n36', ctx);

  it('slots the name, pronouns and an unquoted title, and previews in plain words', () => {
    const out = composeFor('Gabriel used feedback on 4.2 The Poster to improve his draft.', { step: 'example' });
    expect(out.blocked).toBe('');
    expect(out.template.text).toBe('{He} used feedback on {assignment} to improve {his} draft.');
    expect(out.preview).toBe('[Name] used feedback on [best piece] to improve [his/her/their] draft.');
    expect(out.template.slots).toEqual(['He', 'assignment', 'his']);
    expect(out.template.condition.own).toBe(true);
    expect(out.advice).toEqual([]);
    expect(PB.plainWords('{He} [brings|bring] {his} notebook to {course}.')).toBe(
      '[Name] brings [his/her/their] notebook to [class name].',
    );
    expect(PB.plainWords('In {course}, {he} [is|are] ready.')).toBe('In [class name], [he/she/they] is ready.');
  });

  it('gives the lint, the word count, a date and a one-day marker as advice in plain words, and still saves', () => {
    const out = composeFor('Gabriel needs to keep up his bright work.', { step: 'overall' });
    expect(out.blocked).toBe('');
    expect(out.template).toBeTruthy();
    expect(out.advice).toEqual([
      '“keep up” is a phrase families may not know; try “continue”.',
      '“bright” praises the person; say what the work or the habit showed instead.',
    ]);
    expect(composeFor('Gabriel reads.', { step: 'overall' }).advice).toEqual([
      'This is 2 words; a bank sentence needs six or more.',
    ]);
    expect(
      composeFor(
        'Gabriel reads every page of every chapter of every unit of the course twice before each and every quiz in class.',
        { step: 'overall' },
      ).advice[0],
    ).toMatch(/^This is 2\d words; a report sentence has 20 or fewer\.$/);
    expect(composeFor('Gabriel led the group discussion on Tuesday with care.', { step: 'overall' }).advice).toEqual([
      'This is about one day; a bank sentence is used every term.',
    ]);
    expect(composeFor('The map project can still be handed in until December 4.', { step: 'overall' }).advice).toEqual(
      expect.arrayContaining(['A date fits one report only; a bank sentence is used every term.']),
    );
    expect(
      composeFor('Gabriel finished the Treaty unit with care and time to spare.', { step: 'overall' }).advice,
    ).toEqual(['“Treaty” is a name FullVision cannot turn into a slot, so every student’s comment would say it.']);
    // Advice only: the template is kept and installed, the lint notwithstanding.
    const e = PB.keep(out.template);
    const s = COMMENT_BANK.sentences.find(x => x.id === 'mine:' + e.id);
    expect(s).toBeTruthy();
    expect(s.mine).toBe(true);
  });

  it('blocks only a classmate’s name and a health or designation word', () => {
    expect(composeFor('Gabriel and Amelia wrote the report together this term.', { step: 'overall' }).blocked).toBe(
      '“Amelia” is a classmate’s name; a bank sentence cannot name another student.',
    );
    const out = composeFor('Gabriel worked on his IEP goals in every lab this term.', { step: 'overall' });
    expect(out.blocked).toMatch(/is a health or designation word; a bank sentence cannot hold one\.$/);
    expect(out.template).toBeTruthy();
  });

  it('binds to a row’s case, or to a part with a case, or to a part alone as general', () => {
    const { ctx } = setup();
    const row = composeFor('Gabriel used feedback on 4.2 The Poster to improve his draft.', { row: bestPieceRow(ctx) });
    expect(row.template.condition).toMatchObject({ step: 'example', part: 'now', group: 'Examples From Work' });
    expect(row.template.condition.general).toBeUndefined();
    expect(row.template.condition.needs).toEqual(expect.arrayContaining(['assignment']));
    const cased = composeFor('Gabriel asks a question when a step is unclear.', {
      step: 'habits',
      needs: ['habitToBuild'],
      group: 'Work Habits',
    });
    expect(cased.template.condition).toMatchObject({ step: 'habits', needs: ['habitToBuild'], claims: [] });
    expect(cased.template.condition.general).toBeUndefined();
    expect(cased.offered).toBe('Offered when one habit is rated Sometimes or Rarely, in Socials classes');
    const general = composeFor('Gabriel asks a question when a step is unclear.', { step: 'habits' });
    expect(general.template.condition).toMatchObject({ step: 'habits', general: true, when: {}, claims: [] });
    expect(general.offered).toBe('Offered in Socials classes');
    const e = PB.keep(general.template);
    expect(COMMENT_BANK.sentences.find(x => x.id === 'mine:' + e.id).general).toBe(true);
  });

  it('Generate picks a general sentence only when nothing more specific fits; a cased one ranks first', () => {
    // A hand-made bank for the family step (as comment-bank-selection does):
    // a shared sentence with a `when`, a shared no-claim sentence, the
    // teacher's own general sentence and the teacher's own cased one.
    const home = (id, text, when, extra) =>
      Object.assign({ id, part: 'how', group: 'For the Family', text, when, claims: [] }, extra || {});
    const parts = [{ id: 'how', title: 'How They Will Get There' }];
    const ctx = { _p: THEY, _habits: {}, _family: '', picture: 'steady', name: 'Noor' };
    const shared = home('s1', 'At home, you could ask what a steady week of work looked like.', { picture: 'steady' });
    const plain = home('s0', 'At home, you could ask what the class worked on this week.', undefined);
    const general = home('mine:g', 'At home, you could ask which idea from class came up at dinner.', undefined, {
      mine: true,
      general: true,
    });
    const cased = home(
      'mine:c',
      'At home, you could ask what made this a steady term.',
      { picture: 'steady' },
      {
        mine: true,
      },
    );
    const pick = sentences =>
      CommentBank.draft(ctx, { bank: { parts, sentences }, seed: 2 }).sentences.find(x => x.step === 'home').id;
    // A shared sentence with a `when` it meets beats the general one.
    expect(pick([shared, plain, general])).toBe('s1');
    // Nothing more specific: the general one goes first, above the shared no-claim sentence.
    expect(pick([plain, general])).toBe('mine:g');
    // A cased sentence of the teacher's own ranks above everything, as before.
    expect(pick([shared, plain, general, cased])).toBe('mine:c');
  });

  it('forget takes a sentence out with its entry for Undo; restore puts it back; purge tells the server', () => {
    const calls = [];
    window.v2 = Object.assign({}, REAL_V2, {
      saveCommentTemplate: () => Promise.resolve({ data: null, error: null }),
      deleteCommentTemplate: id => {
        calls.push(id);
        return Promise.resolve({ data: null, error: null });
      },
    });
    const e = PB.keep(composeFor('Gabriel asks a question when a step is unclear.', { step: 'habits' }).template);
    const gone = PB.forget('mine:' + e.id);
    expect(gone.id).toBe(e.id);
    expect(COMMENT_BANK.sentences.some(s => s.mine)).toBe(false);
    expect(PB.restore(gone)).toBe(true);
    expect(COMMENT_BANK.sentences.some(s => s.id === 'mine:' + e.id)).toBe(true);
    PB.forget('mine:' + e.id);
    PB.purge(gone);
    expect(calls).toEqual([]); // a local id never reaches the server
    const srv = Object.assign({}, gone, { id: '11111111-2222-4333-8444-555555555555' });
    PB.purge(srv);
    expect(calls).toEqual(['11111111-2222-4333-8444-555555555555']);
  });
});
