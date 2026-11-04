/**
 * The Sentences card and Browse Sentences (teacher/report-questionnaire.js,
 * fullvision-generate-plan PR 11b): one row per sentence with its part and
 * source, the rows following the box, moving rows (the comment follows,
 * the name moving to the first sentence), Other Wording's alternatives,
 * Edited sentences kept by Generate, Reset Order, and the Browse list.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;

describe('partOf and rowLabel', () => {
  it('labels each draft step with its part, the IE parts by name, the goals statement', () => {
    expect(RQ.partOf('example').label).toBe('Best Piece');
    expect(RQ.partOf('overall').label).toBe('Strengths');
    expect(RQ.partOf('attendance').label).toBe('Habits');
    expect(RQ.partOf('lateWork').label).toBe('Not Handed In');
    expect(RQ.partOf('home').label).toBe('Next Step');
    expect(RQ.partOf('closer').label).toBe('Closing');
    expect(RQ.partOf('ieProblem')).toBeNull();
    expect(RQ.rowLabel({ step: 'grade' }, null)).toBe('Grade');
    expect(RQ.rowLabel({ step: 'grade' }, 'ie')).toBe('Grade');
    expect(RQ.rowLabel({ step: 'grade' }, 'language_goals')).toBe('Statement');
    expect(RQ.rowLabel({ step: 'ieDeadline' }, 'ie')).toBe('Deadline');
    expect(RQ.rowLabel({ step: 'attendance' }, null)).toBe('Attendance');
    expect(RQ.rowLabel({ step: null }, null)).toBe('Your Sentence');
    expect(RQ.rowLabel({ step: null, placeholder: true }, null)).toBe('');
  });
  it('lists the eight parts of Browse Sentences in the mockup’s order', () => {
    expect(RQ.PARTS.map(p => p.label)).toEqual([
      'Grade',
      'Best Piece',
      'Strengths',
      'Habits',
      'Not Handed In',
      'Next Step',
      'Support',
      'Closing',
    ]);
  });
});

describe('sentencesOf', () => {
  it('splits after . ! ? and a closing quote, keeping a period inside quotes', () => {
    expect(
      RQ.sentencesOf(
        'Two assignments are not handed in: “Lab 3” and “Quiz 2.” Late work is accepted. Next, she can revise.',
      ),
    ).toEqual([
      'Two assignments are not handed in: “Lab 3” and “Quiz 2.”',
      'Late work is accepted.',
      'Next, she can revise.',
    ]);
    expect(RQ.sentencesOf('')).toEqual([]);
  });
  it('never ends a sentence after a title, e.g., i.e. or an initial (live run: “He also helped Ms.” / “Lee clean up.”)', () => {
    expect(
      RQ.sentencesOf('Liam asked great questions in the lab. He also helped Ms. Lee clean up. He is kind!'),
    ).toEqual(['Liam asked great questions in the lab.', 'He also helped Ms. Lee clean up.', 'He is kind!']);
    const one = [
      'She thanked Mr. Singh, Mrs. Ortiz and Dr. Patel for their help.',
      'They walked along St. George Street to the park.',
      'She read tall tales, e.g. Paul Bunyan, all term.',
      'He chose one planet, i.e. Mars, for the project.',
      'She read a book by J. K. Rowling for the report.',
      'J. K. Rowling was her author for the report.',
      'She brought pencils, rulers, etc. to every lab.',
    ];
    one.forEach(s => expect(RQ.sentencesOf(s + ' Next, she can revise.')).toEqual([s, 'Next, she can revise.']));
  });
  it('keeps a quoted title ending in ? or ! in its sentence, and never splits inside a quotation', () => {
    expect(
      RQ.sentencesOf('Her best piece was “Why Do Leaves Fall?” and it showed her thinking. Next, she can revise.'),
    ).toEqual(['Her best piece was “Why Do Leaves Fall?” and it showed her thinking.', 'Next, she can revise.']);
    expect(RQ.sentencesOf('Her best piece was “Why? A Study of Rain” this term. She explained it well.')).toEqual([
      'Her best piece was “Why? A Study of Rain” this term.',
      'She explained it well.',
    ]);
    expect(RQ.sentencesOf('He wrote "Stop! Look Both Ways" for the poster. It was clear.')).toEqual([
      'He wrote "Stop! Look Both Ways" for the poster.',
      'It was clear.',
    ]);
    // A title that ends the sentence still ends it, and a grade letter does too.
    expect(RQ.sentencesOf('Her best piece was “What Does the Poster Show?” Next, she can revise.')).toEqual([
      'Her best piece was “What Does the Poster Show?”',
      'Next, she can revise.',
    ]);
    expect(RQ.sentencesOf('Ava is earning a B. Her work habits are good. She is close to an A.')).toEqual([
      'Ava is earning a B.',
      'Her work habits are good.',
      'She is close to an A.',
    ]);
  });
});

const row = (id, step, text, extra = {}) =>
  Object.assign({ id, step, text, drafted: text, edited: false, raw: { id, step, text }, prov: null, s: null }, extra);

describe('alignRows', () => {
  const rows = [
    row('a', 'grade', 'Ava is earning a B this term.'),
    row('b', 'habits', 'Her work habits are good.'),
    row('c', 'home', 'At home, you can ask her about class.'),
  ];
  it('keeps every row when the box still holds the sentences', () => {
    const out = RQ.alignRows(rows, rows.map(r => r.text).join(' '));
    expect(out.map(r => [r.id, r.edited])).toEqual([
      ['a', false],
      ['b', false],
      ['c', false],
    ]);
  });
  it('marks a changed sentence Edited, in the row it replaced', () => {
    const out = RQ.alignRows(
      rows,
      'Ava is earning a B this term. Her work habits are excellent. At home, you can ask her about class.',
    );
    expect(out.map(r => [r.id, r.edited])).toEqual([
      ['a', false],
      ['b', true],
      ['c', false],
    ]);
    expect(out[1].text).toBe('Her work habits are excellent.');
    expect(out[1].drafted).toBe('Her work habits are good.');
    // Put back as it was, it is no longer Edited.
    const back = RQ.alignRows(out, rows.map(r => r.text).join(' '));
    expect(back[1].edited).toBe(false);
  });
  it('gives a new sentence its own row and drops a deleted one', () => {
    const out = RQ.alignRows(
      rows,
      'Ava is earning a B this term. She asks good questions. At home, you can ask her about class.',
    );
    expect(out.map(r => [r.id, r.step, r.edited])).toEqual([
      ['a', 'grade', false],
      ['b', 'habits', true],
      ['c', 'home', false],
    ]);
    const fewer = RQ.alignRows(rows, 'Ava is earning a B this term. At home, you can ask her about class.');
    expect(fewer.map(r => r.id)).toEqual(['a', 'c']);
    const more = RQ.alignRows(rows, rows.map(r => r.text).join(' ') + ' One more thing.');
    expect(more.map(r => r.step)).toEqual(['grade', 'habits', 'home', null]);
    expect(more[3]).toMatchObject({ text: 'One more thing.', edited: true });
  });
  it('a sentence added after a row is the teacher’s own; a changed run fills the row; a teacher line of two sentences matches as one', () => {
    const out = RQ.alignRows(
      rows,
      'Ava is earning a B this term. Her work habits are good. She is kind. At home, you can ask her about class.',
    );
    expect(out.map(r => r.step)).toEqual(['grade', 'habits', null, 'home']);
    expect(out[2]).toMatchObject({ text: 'She is kind.', edited: true });
    const joined = RQ.alignRows(
      rows,
      'Ava is earning a B this term. Her habits are good. She is kind. At home, you can ask her about class.',
    );
    expect(joined.map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(joined[1]).toMatchObject({ text: 'Her habits are good. She is kind.', edited: true });
    const line = [
      row('a', 'grade', 'Ava is earning a B this term.'),
      row('class:support', 'support', 'In class, I will check in. At lunch, help is there.'),
    ];
    const kept = RQ.alignRows(line, line.map(r => r.text).join(' '));
    expect(kept.map(r => r.edited)).toEqual([false, false]);
  });
});

describe('typed rows: keepTyped and insertRow (the InsertRows mockup)', () => {
  const a = row('a', 'grade', 'Ava is earning a B this term.');
  const b = row('b', 'example', 'Her best piece was “Lab 3.”');
  const h = row('h', 'habits', 'Her work habits are good.');
  const c = row('c', 'home', 'At home, you can ask her about class.');
  const mine = RQ.typedRow('Ava explained her results to the class.', 1);
  it('isTyped: a row with no step that is not a class line or a placeholder', () => {
    expect(RQ.isTyped(mine)).toBe(true);
    expect(RQ.isTyped(a)).toBe(false);
    expect(RQ.isTyped({ step: 'support', placeholder: true })).toBe(false);
    expect(mine).toMatchObject({ id: 'text:1', step: null, edited: true, drafted: null, s: null });
  });
  it('keepTyped puts a typed sentence back after the row it followed, by text or step', () => {
    const old = [a, b, mine, h, c];
    const b2 = row('b2', 'example', 'Her best piece was “Lab 3”, where she measured carefully.');
    const h2 = row('h2', 'habits', 'Her work habits are excellent.');
    expect(RQ.keepTyped(old, [a, b2, h2, c]).map(r => r.id)).toEqual(['a', 'b2', 'text:1', 'h2', 'c']);
    // The step it followed is gone: before the row that followed it.
    expect(RQ.keepTyped(old, [a, h2, c]).map(r => r.id)).toEqual(['a', 'text:1', 'h2', 'c']);
    // Typed first stays first; typed last stays last; two in a row stay together.
    expect(RQ.keepTyped([mine, a, h], [a, h]).map(r => r.id)).toEqual(['text:1', 'a', 'h']);
    expect(RQ.keepTyped([a, h, mine], [a, h]).map(r => r.id)).toEqual(['a', 'h', 'text:1']);
    const two = RQ.typedRow('She also helps others.', 2);
    expect(RQ.keepTyped([a, mine, two, h], [a, h2]).map(r => r.id)).toEqual(['a', 'text:1', 'text:2', 'h2']);
    // Nothing in common: at the index it had, after a grade sentence Generate
    // put first; a sentence the teacher put before the grade stays there.
    expect(RQ.keepTyped([a, mine], [h2, c]).map(r => r.id)).toEqual(['h2', 'text:1', 'c']);
    expect(RQ.keepTyped([mine, two], [a, h]).map(r => r.id)).toEqual(['a', 'text:1', 'text:2', 'h']);
    expect(RQ.keepTyped([mine, a], [a, h]).map(r => r.id)).toEqual(['text:1', 'a', 'h']);
    // A comment typed entirely by hand: every sentence kept, in order, the
    // bank's parts around them.
    expect(RQ.keepTyped([mine, two], [a, b, h]).map(r => r.id)).toEqual(['a', 'text:1', 'text:2', 'b', 'h']);
    // Already there (a kept sentence): not twice.
    expect(RQ.keepTyped([a, mine], [a, mine]).map(r => r.id)).toEqual(['a', 'text:1']);
  });
  it('insertRow puts a row at a gap, clamped to the ends', () => {
    expect(RQ.insertRow([a, h], mine, 1).map(r => r.id)).toEqual(['a', 'text:1', 'h']);
    expect(RQ.insertRow([a, h], mine, 0).map(r => r.id)).toEqual(['text:1', 'a', 'h']);
    expect(RQ.insertRow([a, h], mine, 9).map(r => r.id)).toEqual(['a', 'h', 'text:1']);
    expect(RQ.insertRow([], mine, 3).map(r => r.id)).toEqual(['text:1']);
  });
  it('alignRows gives a sentence typed into the comment a Your Sentence row', () => {
    const out = RQ.alignRows(
      [a, h],
      'Ava is earning a B this term. She explained her results. Her work habits are good.',
    );
    expect(out.map(r => [r.step, RQ.isTyped(r)])).toEqual([
      ['grade', false],
      [null, true],
      ['habits', false],
    ]);
    expect(RQ.rowLabel(out[1], null)).toBe('Your Sentence');
  });
});

describe('moveRow, dropRow and resetOrder', () => {
  const rows = [
    row('a', 'grade', 'A.'),
    row('m', 'notHandedIn', 'M.'),
    row('l', 'lateWork', 'L.'),
    row('h', 'habits', 'H.'),
    row('c', 'closer', 'C.'),
  ];
  it('shows the next-step sentences as one row, with the support row after them', () => {
    const next = [
      row('g', 'grade', 'G.'),
      row('n', 'nextStep', 'N.'),
      row('s', 'support', 'S.'),
      row('h', 'home', 'H.'),
      row('c', 'closer', 'C.'),
    ];
    expect(RQ.units(next).map(u => u.map(r => r.id))).toEqual([['g'], ['n', 'h'], ['s'], ['c']]);
    // Moved as one; the support row keeps its place after them.
    expect(RQ.moveRow(next, 1, -1).map(r => r.id)).toEqual(['n', 'h', 'g', 's', 'c']);
    expect(RQ.units(rows).map(u => u.map(r => r.id))).toEqual([['a'], ['m', 'l'], ['h'], ['c']]);
  });
  it('moves a row one place, the Not Handed In sentence and its late line as one', () => {
    expect(RQ.moveRow(rows, 3, -1).map(r => r.id)).toEqual(['a', 'h', 'm', 'l', 'c']);
    expect(RQ.moveRow(rows, 1, 1).map(r => r.id)).toEqual(['a', 'h', 'm', 'l', 'c']);
    expect(RQ.moveRow(rows, 0, -1)).toBeNull();
    expect(RQ.moveRow(rows, 4, 1)).toBeNull();
  });
  it('drops a row before or after another', () => {
    expect(RQ.dropRow(rows, 4, 0, true).map(r => r.id)).toEqual(['c', 'a', 'm', 'l', 'h']);
    expect(RQ.dropRow(rows, 0, 3, false).map(r => r.id)).toEqual(['m', 'l', 'h', 'a', 'c']);
    expect(RQ.dropRow(rows, 1, 2, true)).toBeNull();
  });
  it('puts the draft’s order back, a teacher’s own sentence staying after the row it follows', () => {
    const moved = [
      row('h', 'habits', 'H.'),
      row('x', null, 'Mine.'),
      row('a', 'grade', 'A.'),
      row('c', 'closer', 'C.'),
    ];
    expect(RQ.resetOrder(moved, ['grade', 'habits', 'closer']).map(r => r.id)).toEqual(['a', 'h', 'x', 'c']);
  });
});

describe('sheetHeight', () => {
  it('is the mockup’s 420 until dragged, then what was saved; a broken storage is survived', () => {
    localStorage.removeItem('fv-browse-sentences-height');
    expect(RQ.sheetHeight()).toBe(420);
    localStorage.setItem('fv-browse-sentences-height', '560');
    expect(RQ.sheetHeight()).toBe(560);
    localStorage.setItem('fv-browse-sentences-height', '12');
    expect(RQ.sheetHeight()).toBe(420);
    const get = localStorage.getItem;
    localStorage.getItem = () => {
      throw new Error('blocked');
    };
    expect(RQ.sheetHeight()).toBe(420);
    localStorage.getItem = get;
    localStorage.removeItem('fv-browse-sentences-height');
  });
});

describe('Demo Mode (Science 8, Report 2)', () => {
  let cid, saved, hadDoc, oldDoc;
  beforeAll(() => {
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    cid = 'sci8';
    setActiveTerm(cid, 2);
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
    RQ.configure({ activeCourse: cid, renderReports: () => {} });
  });
  afterAll(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });
  const cece = () => getStudents(cid).find(s => s.firstName === 'Cece');
  const draftFor = st => {
    const f = CommentBank.facts(cid, st, 'term-2');
    const ctx = CommentBank.context(f, {});
    return { f, ctx, d: CommentBank.draft(ctx, { seed: CommentBank.seedFor(st.id) }) };
  };
  /* A press whose draft has every one of these steps (the pipeline says
     what is worth saying, so a step can be left out of one press: a home
     line is for a third of the class at a time). */
  const draftWith = (st, steps) => {
    const f = CommentBank.facts(cid, st, 'term-2');
    const ctx = CommentBank.context(f, {});
    for (let n = 0; n < 40; n++) {
      const d = CommentBank.draft(ctx, { seed: CommentBank.seedFor(st.id + '|term-2') + n, quiet: true });
      if (steps.every(k => d.sentences.some(x => x.step === k))) return { f, ctx, d };
    }
    throw new Error('no press has ' + steps.join(', '));
  };

  it('rowsFromDraft: one row per sentence, its step and part, none Edited; a kept sentence keeps its row', () => {
    const { d } = draftFor(cece());
    const rows = RQ.rowsFromDraft(d);
    expect(rows.length).toBe(d.sentences.length);
    expect(rows.every(r => r.step && !r.edited && r.drafted === r.text)).toBe(true);
    expect(rows[0].step).toBe('grade');
    expect(rows.every(r => r.classLine || r.s)).toBe(true);
    const edited = Object.assign({}, rows[1], { text: 'My own words.', edited: true, drafted: rows[1].text });
    const again = RQ.rowsFromDraft(
      {
        sentences: [{ id: 'kept:' + rows[1].step, step: rows[1].step, text: 'My own words.', kept: true }],
        provenance: [{}],
      },
      [rows[0], edited],
    );
    expect(again[0]).toMatchObject({ id: rows[1].id, edited: true, drafted: rows[1].text, text: 'My own words.' });
  });

  it('Generate keeps a typed sentence at its place: rowsFromDraft, then keepTyped', () => {
    const { d, ctx } = draftFor(cece());
    const rows = RQ.rowsFromDraft(d);
    const mine = RQ.typedRow('Cece explained her results to the class.', 7);
    const withMine = RQ.insertRow(rows, mine, 2);
    const again = CommentBank.draft(ctx, { seed: CommentBank.seedFor(cece().id) + 1 });
    const next = RQ.keepTyped(withMine, RQ.rowsFromDraft(again, withMine));
    expect(next.filter(RQ.isTyped).map(r => r.text)).toEqual(['Cece explained her results to the class.']);
    expect(next.indexOf(mine)).toBeGreaterThanOrEqual(1);
    expect(RQ.composeRows(next)).toContain('explained her results to the class.');
  });

  it('insertChoices: only the parts missing from the comment, each with a sentence that fits; nothing Required', () => {
    const { d, ctx } = draftWith(cece(), ['grade', 'overall', 'example', 'nextStep']);
    const rows = RQ.rowsFromDraft(d);
    // A part the draft has is never offered again.
    const have = rows.map(r => (RQ.partOf(r.step) || {}).id);
    RQ.insertChoices(rows, ctx, { seed: 3 }).forEach(c => expect(have).not.toContain(c.part));
    // Without the strengths and best-piece rows, those two parts are
    // offered, each with a bank sentence that fits Cece in a step of that
    // part, filled with no slot left.
    const fewer = rows.filter(r => r.step !== 'overall' && r.step !== 'example');
    const choices = RQ.insertChoices(fewer, ctx, { seed: 3 });
    expect(choices.map(c => c.part).sort()).toEqual(['bestPiece', 'strengths']);
    choices.forEach(c => {
      expect(RQ.partOf(c.step).id).toBe(c.part);
      expect(c.label).toBe(RQ.PARTS.find(p => p.id === c.part).label);
      expect(c.classLine).toBe(false);
      expect(CommentBank.fits(c.s, ctx)).toBe(true);
      expect(c.text).not.toMatch(/[{}[\]]/);
      expect(fewer.map(r => r.id)).not.toContain(c.id);
    });
    // Put in at a gap, the row is the sentence filled for Cece.
    const strengths = choices.find(c => c.part === 'strengths');
    const put = RQ.insertRow(fewer, RQ.rowFromSentence(strengths.s, ctx, strengths.step), 1);
    expect(put[1].step).toBe(strengths.step);
    expect(RQ.composeRows(put)).toContain(put[1].text);
    // A comment with only typed sentences: the grade is offered once, with
    // the best piece, strengths and next step; never a second advising
    // sentence.
    const typedOnly = [RQ.typedRow('Cece explained her results.', 1)];
    const fresh = RQ.insertChoices(typedOnly, ctx, { seed: 3 });
    expect(fresh.filter(c => c.part === 'grade').length).toBe(1);
    expect(fresh.map(c => c.part)).toEqual(expect.arrayContaining(['grade', 'bestPiece', 'strengths', 'nextStep']));
    expect(new Set(fresh.map(c => c.part)).size).toBe(fresh.length);
    expect(fresh.filter(c => !c.classLine && CommentBank.advises(c.s)).length).toBeLessThanOrEqual(1);
    // With a next step in the comment, no second one is offered.
    const withNext = typedOnly.concat(rows.filter(r => r.step === 'nextStep'));
    expect(RQ.insertChoices(withNext, ctx, { seed: 3 }).map(c => c.part)).not.toContain('nextStep');
    // On the IE path the grade is Required, so it is never offered.
    expect(RQ.insertChoices(typedOnly, ctx, { seed: 3, path: 'ie' }).map(c => c.part)).not.toContain('grade');
  });

  it('gapPart: Browse opens on a part that can go in', () => {
    const { d, ctx } = draftFor(cece());
    const rows = RQ.rowsFromDraft(d);
    // Browse from a gap: the first part that can go in; with every drafted
    // part in, the first part with no row (Habits for Cece: nothing rated);
    // with every part in, Grade.
    const fewer = rows.filter(r => r.step !== 'overall');
    expect(RQ.gapPart(fewer, ctx, { seed: 3 })).toBe('strengths');
    expect(RQ.gapPart(rows, ctx, { seed: 3 })).toBe('habits');
    const every = RQ.PARTS.map(p => ({ id: 'x:' + p.id, step: p.steps[0], text: 'X.' }));
    expect(RQ.gapPart(every, ctx, { seed: 3 })).toBe('grade');
  });

  it('a typed sentence with Ms., e.g. or an initial stays one row through reorder and regenerate', () => {
    const { d, ctx } = draftFor(cece());
    const rows = RQ.rowsFromDraft(d);
    const mine = ' Cece also helped Ms. Lee clean up. She read J. K. Rowling, e.g. the first book, at home.';
    const typed = RQ.alignRows(rows, RQ.composeRows(rows) + mine);
    expect(typed.filter(RQ.isTyped).map(r => r.text)).toEqual([
      'Cece also helped Ms. Lee clean up.',
      'She read J. K. Rowling, e.g. the first book, at home.',
    ]);
    // Moved to the top: still one row each, and the box reads back the same rows.
    const at = typed.findIndex(RQ.isTyped);
    const moved = RQ.dropRow(typed, at, 0, true);
    const text = RQ.composeRows(moved);
    expect(text.startsWith('Cece also helped Ms. Lee clean up.')).toBe(true);
    const back = RQ.alignRows(moved, text);
    expect(back.map(r => r.id)).toEqual(moved.map(r => r.id));
    expect(back.some(r => r.edited && !RQ.isTyped(r))).toBe(false);
    // Generate again: the typed rows come back whole, at their place.
    const again = CommentBank.draft(ctx, { seed: CommentBank.seedFor(cece().id) + 1 });
    const next = RQ.keepTyped(back, RQ.rowsFromDraft(again, back));
    expect(next.filter(RQ.isTyped).map(r => r.text)).toEqual([
      'Cece also helped Ms. Lee clean up.',
      'She read J. K. Rowling, e.g. the first book, at home.',
    ]);
    const after = RQ.composeRows(next);
    expect(RQ.alignRows(next, after).map(r => r.id)).toEqual(next.map(r => r.id));
    expect(
      RQ.recoverRows(after, ctx)
        .filter(r => r.step === null)
        .map(r => r.text),
    ).toEqual(['Cece also helped Ms. Lee clean up.', 'She read J. K. Rowling, e.g. the first book, at home.']);
  });

  it('composeRows: the comment follows the rows, and the name moves to whichever sentence comes first', () => {
    const { d } = draftFor(cece());
    const rows = RQ.rowsFromDraft(d);
    expect(RQ.composeRows(rows)).toBe(d.text);
    const moved = RQ.moveRow(rows, 0, 1);
    const text = RQ.composeRows(moved);
    expect(text.startsWith(moved[0].text)).toBe(true);
    expect(moved[0].text).toContain('Cece');
    expect(moved[1].text.indexOf('Cece')).toBe(-1);
    expect(moved[1].text).toMatch(/\b(she|her)\b/i);
    // An edited sentence is used as written.
    const own = Object.assign({}, rows[2], { text: 'Cece asks good questions.', edited: true });
    const withOwn = rows.slice(0, 2).concat(own).concat(rows.slice(3));
    expect(RQ.composeRows(withOwn)).toContain('Cece asks good questions.');
  });

  it('recoverRows: a saved draft finds its bank sentences again; a hand-written one is Edited rows', () => {
    const { d, ctx } = draftFor(cece());
    const rows = RQ.recoverRows(d.text, ctx);
    expect(rows.map(r => r.id)).toEqual(d.ids);
    expect(rows.every(r => !r.edited)).toBe(true);
    // Recorded as typed by the teacher (draft_meta.teacher_text): theirs.
    const own = RQ.recoverRows('Cece had a good term. She asks questions.', ctx, {
      teacher_text: ['Cece had a good term.', 'She asks questions.'],
    });
    expect(own.map(r => [r.step, r.edited, !!r.earlier])).toEqual([
      [null, true, false],
      [null, true, false],
    ]);
    // With no record (saved before it, or the old generator's): the
    // Earlier Comment's, which Generate replaces.
    const old = RQ.recoverRows('Cece had a good term. She asks questions.', ctx);
    expect(old.map(r => [r.step, r.edited, !!r.earlier])).toEqual([
      [null, false, true],
      [null, false, true],
    ]);
  });

  it('alternatives: up to two other sentences of the step that fit and claim the same, least used first', () => {
    const { d, ctx } = draftWith(cece(), ['home']);
    const rows = RQ.rowsFromDraft(d);
    const taken = {};
    rows.forEach(r => (taken[r.id] = true));
    const habits = rows.find(r => r.step === 'home');
    const alts = RQ.alternatives(habits, ctx, {}, taken);
    expect(alts.length).toBeLessThanOrEqual(2);
    alts.forEach(s => {
      expect(CommentBank.stepOf(s)).toBe('home');
      expect(CommentBank.fits(s, ctx)).toBe(true);
      expect(taken[s.id]).toBeUndefined();
      expect((s.claims || []).slice().sort()).toEqual((habits.s.claims || []).slice().sort());
    });
    const usage = {};
    alts.forEach((s, i) => (usage[s.id] = alts.length - i));
    const sorted = RQ.alternatives(habits, ctx, usage, taken);
    expect(sorted.map(s => usage[s.id] || 0)).toEqual(sorted.map(s => usage[s.id] || 0).sort((a, b) => a - b));
    expect(RQ.alternatives({ step: 'closer', s: null }, ctx, {}, {})).toEqual([]);
  });

  it('useSentence: a sentence is added where its step falls, after any row of that step, never in its place', () => {
    const { d, ctx } = draftWith(cece(), ['home']);
    const rows = RQ.rowsFromDraft(d);
    const at = rows.findIndex(r => r.step === 'home');
    const home = rows[at];
    const other = COMMENT_BANK.sentences.find(
      s => CommentBank.stepOf(s) === 'home' && s.id !== home.id && CommentBank.fits(s, ctx),
    );
    const out = RQ.useSentence(rows, other, ctx);
    expect(out.length).toBe(rows.length + 1);
    expect(out[at].id).toBe(home.id);
    expect(out[at + 1].id).toBe(other.id);
    expect(out[at + 1].text).toMatch(/^At home, you can ask her/);
    const without = rows.filter(r => r.step !== 'home');
    const added = RQ.useSentence(without, other, ctx);
    expect(added.length).toBe(without.length + 1);
    expect(added.findIndex(r => r.step === 'home')).toBe(added.length - 1);
  });

  it('browseList: the part’s sentences, least used first, with how many fit; Fits leaves the rest out', () => {
    const { ctx } = draftFor(cece());
    const usage = {};
    const all = RQ.browseList('habits', ctx, { fits: false, usage });
    expect(all.total).toBeGreaterThan(all.fit);
    // One row per sentence, plus one per extra case a frame serves.
    expect(all.rows.length).toBeGreaterThanOrEqual(all.total);
    expect(new Set(all.rows.map(r => r.id)).size).toBe(all.total);
    expect(all.rows.filter(r => r.fits).length).toBe(all.fit);
    expect(all.rows.some(r => !r.fits && /…/.test(r.text))).toBe(true);
    const fit = RQ.browseList('habits', ctx, { fits: true, usage, inUse: { [all.rows.find(r => r.fits).id]: true } });
    expect(fit.rows.length).toBe(all.fit);
    expect(fit.rows.filter(r => r.inUse).length).toBe(1);
    usage[fit.rows[0].id] = 3;
    const sorted = RQ.browseList('habits', ctx, { fits: true, usage });
    expect(sorted.rows[sorted.rows.length - 1].id).toBe(fit.rows[0].id);
    expect(RQ.browseList('grade', ctx, { fits: true, q: 'zzzz' }).rows).toEqual([]);
    expect(RQ.browseList('grade', ctx, { fits: true }).rows[0].text).toContain('Cece');
  });

  it('browseCase: every bank sentence lands under named cases, read from its fields or derived from when and needs', () => {
    const labels = {};
    RQ.PARTS.forEach(p => RQ.browseCases(p.id).forEach(c => (labels[p.id + '|' + c.id] = c.label)));
    const other = [];
    COMMENT_BANK.sentences.forEach(s => {
      const p = RQ.partOf(CommentBank.stepOf(s));
      if (!p) return;
      const cs = RQ.browseCase(p.id, s);
      expect(cs.length, s.id).toBeGreaterThan(0);
      cs.forEach(c => {
        expect(labels[p.id + '|' + c], s.id).toBeTruthy();
        if (c === 'other') other.push(s.id);
      });
    });
    expect(other).toEqual([]);
    // Headings: Title Case, no codes, no pronouns, no range headings.
    Object.values(labels).forEach(l => {
      expect(l).toMatch(/^[A-Z]/);
      expect(l).not.toMatch(/\b(he|she|they|his|her|their|him|them)\b/i);
      expect(l).not.toMatch(
        /^(Excellent to Satisfactory|Extending to Emerging|Absences or Lates|Any Number|With or Without a Note)$/,
      );
    });
    // Grade: a frame with the letter as a slot serves every standing it can
    // print; "close to" frames every standing with a letter above it; an
    // explicit standing wins.
    expect(RQ.browseCase('grade', { when: { grade: 'letter' } })).toEqual(['w:A', 'w:B', 'w:C+', 'w:C']);
    expect(RQ.browseCase('grade', { when: { grade: 'letterClose' } })).toEqual(['w:B', 'w:C+', 'w:C']);
    expect(RQ.browseCase('grade', { when: { grade: 'cminus' } })).toEqual(['w:C-']);
    expect(RQ.browseCase('grade', { when: { grade: 'cminusClose' } })).toEqual(['w:C-']);
    expect(RQ.browseCase('grade', { when: { grade: 'letter' }, standing: 'very good' })).toEqual(['w:B']);
    expect(RQ.browseCase('grade', { when: { grade: 'letter' }, standing: 'A' })).toEqual(['w:A']);
    expect(RQ.browseCase('grade', { when: { grade: 'proficiency' } })).toEqual([
      'p:Extending',
      'p:Proficient',
      'p:Developing',
      'p:Emerging',
    ]);
    expect(RQ.browseCase('grade', { when: { grade: 'proficiency' }, standing: 'Proficient' })).toEqual([
      'p:Proficient',
    ]);
    expect(RQ.browseCase('grade', { when: { grade: 'ie' } })).toEqual(['ie']);
    expect(RQ.browseCases('grade').map(c => c.label)).toEqual([
      'Excellent',
      'Very Good',
      'Good',
      'Satisfactory',
      'Minimally Acceptable',
      'Extending',
      'Proficient',
      'Developing',
      'Emerging',
      'Not Enough Evidence',
      'Language Goals',
      'IEP Goals',
      'Other',
    ]);
    // Best piece: with a note or without; the plan's sentence serves both.
    expect(RQ.browseCase('bestPiece', { needs: ['assignment', 'bestNote'] })).toEqual(['note']);
    expect(RQ.browseCase('bestPiece', { needs: ['assignment'] })).toEqual(['noNote']);
    expect(RQ.browseCase('bestPiece', { needs: ['bestPiece'] })).toEqual(['note', 'noNote']);
    // Strengths: the story, else the family and standing, else the standing, else steady.
    expect(RQ.browseCase('strengths', { needs: ['climb', 'strengths'] })).toEqual(['climb']);
    expect(RQ.browseCase('strengths', { story: 'hidden', needs: ['strengths'] })).toEqual(['hidden']);
    expect(RQ.browseCase('strengths', { story: 'building', needs: ['strengths'] })).toEqual(['steady']);
    expect(RQ.browseCase('strengths', { when: { standing: 'Extending' }, subjects: ['socials'] })).toEqual([
      'fam:socials:Extending',
    ]);
    expect(RQ.browseCase('strengths', { when: { standing: 'Emerging' } })).toEqual(['st:Emerging']);
    expect(RQ.browseCase('strengths', { needs: ['strengths'] })).toEqual(['steady']);
    // The strongest skill under its kind of class; even results under the
    // word the frame's verb is bound to.
    expect(
      RQ.browseCase('strengths', { when: { strongSkill: 'evidence' }, needs: ['strongSkill'], subjects: ['socials'] }),
    ).toEqual(['skill:socials:evidence']);
    expect(RQ.browseCase('strengths', { when: { evenWord: 'Proficient' }, needs: ['evenWord', 'evenSkill'] })).toEqual([
      'even:Proficient',
    ]);
    expect(RQ.browseCases('strengths').find(c => c.id === 'even:Proficient').label).toBe('Even Results · Proficient');
    expect(RQ.browseCases('strengths').find(c => c.id === 'skill:socials:evidence').label).toBe(
      'Social Studies · Evidence',
    );
    // Habits: a habit at a rating from the fields or from `when`; the summary,
    // strong habits and attendance by needs; the one-slot attendance
    // sentence serves every attendance case.
    expect(RQ.browseCase('habits', { habit: 'feedback', level: 2 })).toEqual(['cell:feedback:2']);
    expect(RQ.browseCase('habits', { habit: 'feedback', level: 'Sometimes' })).toEqual(['cell:feedback:2']);
    expect(RQ.browseCase('habits', { when: { devices: 1 } })).toEqual(['cell:devices:1']);
    expect(RQ.browseCase('habits', { needs: ['habitsExcellent'] })).toEqual(['sum:excellent']);
    expect(RQ.browseCase('habits', { needs: ['habitsToBuild'] })).toEqual(['sum:two']);
    expect(RQ.browseCase('habits', { group: 'Strong Habits', needs: ['habitsExcellent'] })).toEqual(['strong']);
    expect(RQ.browseCase('habits', { group: 'Attendance', needs: ['attendance'] })).toEqual([
      'att:absent',
      'att:late',
      'att:both',
    ]);
    expect(RQ.browseCase('habits', { group: 'Attendance', needs: ['absentClasses', 'absentOnly'] })).toEqual([
      'att:absent',
    ]);
    expect(RQ.browseCase('habits', { group: 'Attendance', needs: ['lateTimes', 'lateOnly'] })).toEqual(['att:late']);
    expect(RQ.browseCase('habits', { group: 'Attendance', needs: ['absentClasses', 'lateTimes'] })).toEqual([
      'att:both',
    ]);
    const cells = RQ.browseCases('habits').filter(c => /^cell:/.test(c.id));
    expect(cells.length).toBe(24);
    expect(cells.slice(0, 5).map(c => c.label)).toEqual([
      'Completes Work · Consistently',
      'Completes Work · Usually',
      'Completes Work · Sometimes',
      'Completes Work · Rarely',
      'Comes Ready and Uses Class Time · Consistently',
    ]);
    expect(RQ.browseCases('habits').findIndex(c => c.id === 'sum:excellent')).toBe(24);
    // Not handed in: one title, two, a count, a count and a group; the
    // one-slot sentence serves all four.
    expect(RQ.browseCase('notHandedIn', { needs: ['missingTitle'] })).toEqual(['one']);
    expect(RQ.browseCase('notHandedIn', { needs: ['missingTitles'] })).toEqual(['two']);
    expect(RQ.browseCase('notHandedIn', { needs: ['missingCount', 'missingMany'] })).toEqual(['count']);
    expect(RQ.browseCase('notHandedIn', { needs: ['missingCount', 'missingGroup'] })).toEqual(['group']);
    expect(RQ.browseCase('notHandedIn', { needs: ['missingWork'] })).toEqual(['one', 'two', 'count', 'group']);
    // Next step: the skill under its kind of class; family lines under theirs.
    expect(RQ.browseCase('nextStep', { when: { nextSkill: 'evidence' }, subjects: ['socials'] })).toEqual([
      'skill:socials:evidence',
    ]);
    expect(RQ.browseCase('nextStep', { skill: 'evaluating' })).toEqual(['skill:science:evaluating']);
    expect(RQ.browseCase('nextStep', { needs: ['focus', 'nextStep'] })).toEqual(['any']);
    expect(RQ.browseCase('nextStep', { when: { feedback: 2 }, subjects: ['math'] })).toEqual(['fam:math']);
    expect(RQ.browseCase('nextStep', { group: 'For the Family', subjects: ['ela'] })).toEqual(['home:ela']);
    expect(RQ.browseCase('nextStep', { group: 'For the Family' })).toEqual(['home:any']);
    expect(
      RQ.browseCase('nextStep', { group: 'For the Family', subjects: ['socials'], when: { nextSkill: 'evidence' } }),
    ).toEqual(['home:socials:evidence']);
    expect(RQ.browseCases('nextStep').find(c => c.id === 'skill:socials:evidence').label).toBe(
      'Social Studies · Evidence',
    );
    expect(RQ.browseCases('nextStep').find(c => c.id === 'home:socials:evidence').label).toBe(
      'Social Studies · Evidence · For the Family',
    );
  });

  it('browseOwn and groups: the student’s own cases first, then the fixed order; a frame under every case it serves', () => {
    const { f, ctx } = draftFor(cece());
    expect(RQ.browseOwn('grade', ctx)).toEqual(['p:' + f.standing]);
    const habits = RQ.browseOwn('habits', ctx);
    const rated = Object.keys(ctx._habits).filter(k => ctx._habits[k] >= 1 && ctx._habits[k] <= 4);
    expect(habits.slice(0, rated.length).every(id => /^cell:/.test(id))).toBe(true);
    expect(habits.some(id => /^sum:/.test(id))).toBe(true);
    expect(RQ.browseOwn('strengths', ctx)).toContain('fam:' + ctx._family);
    // Cece's results are even (CommentBank.evenComps): her own case first.
    expect(RQ.browseOwn('strengths', ctx)[0]).toBe('even:' + f.standing);
    expect(RQ.browseOwn('nextStep', ctx)).toContain('home:' + ctx._family);
    expect(RQ.browseOwn('bestPiece', ctx)).toEqual([ctx._bestNote ? 'note' : 'noNote']);
    // Grade, every sentence: the proficiency frames under each word,
    // previewed for that word, fitting only under Cece's own; with Fits,
    // only her own case.
    const grade = RQ.browseList('grade', ctx, { fits: false });
    const frame = COMMENT_BANK.sentences.find(s => s.when && s.when.grade === 'proficiency' && !s.when.standing);
    const under = grade.rows.filter(r => r.id === frame.id);
    expect(under.map(r => r.case)).toEqual(['p:Extending', 'p:Proficient', 'p:Developing', 'p:Emerging']);
    under.forEach(r => {
      expect(r.text).toContain(r.case.slice(2));
      expect(r.fits).toBe(r.case === 'p:' + f.standing);
    });
    expect(grade.groups[0].id).toBe('p:' + f.standing);
    expect(grade.groups[0].own).toBe(true);
    const letter = grade.rows.find(r => r.case === 'w:C' && COMMENT_BANK.sentences.find(s => s.id === r.id).needs);
    expect(letter.text).toMatch(/a C\b/);
    expect(letter.text).toContain('satisfactory');
    expect(letter.fits).toBe(false);
    const fits = RQ.browseList('grade', ctx, { fits: true });
    expect(fits.groups.map(g => g.id)).toEqual(['p:' + f.standing]);
    expect(fits.rows.every(r => r.fits)).toBe(true);
    expect(fits.fit).toBe(fits.rows.length);
    // Habits, every sentence: all 24 cells stay, empty ones too; with Fits,
    // only the rated ones.
    const list = RQ.browseList('habits', ctx, { fits: false });
    expect(list.groups.filter(g => /^cell:/.test(g.id)).length).toBe(24);
    expect(list.groups.filter(g => !/^cell:/.test(g.id)).every(g => g.rows.length > 0)).toBe(true);
    expect(list.groups.reduce((n, g) => n + g.rows.length, 0)).toBe(list.rows.length);
    const ownFirst = list.groups.findIndex(g => !g.own);
    expect(list.groups.slice(0, ownFirst).every(g => g.own)).toBe(true);
    expect(list.groups.slice(ownFirst).some(g => g.own)).toBe(false);
    const cases = RQ.browseCases('habits').map(c => c.id);
    const rest = list.groups.slice(ownFirst).map(g => cases.indexOf(g.id));
    expect(rest).toEqual(rest.slice().sort((a, b) => a - b));
    const fitHabits = RQ.browseList('habits', ctx, { fits: true });
    expect(fitHabits.groups.filter(g => /^cell:/.test(g.id)).map(g => g.id)).toEqual(
      habits.filter(id => /^cell:/.test(id)),
    );
    // Within a group, least used first.
    const full = list.groups.find(g => g.rows.length > 2);
    const usage = {};
    full.rows.forEach((r, i) => (usage[r.id] = full.rows.length - i));
    const again = RQ.browseList('habits', ctx, { fits: false, usage });
    const g0 = again.groups.find(g => g.id === full.id);
    expect(g0.rows.map(r => usage[r.id])).toEqual(g0.rows.map(r => usage[r.id]).sort((a, b) => a - b));
    // A search keeps only the groups with a match, empty cells included.
    const q = RQ.browseList('grade', ctx, { fits: false, q: 'proficiency scale' });
    expect(q.rows.length).toBeGreaterThan(0);
    expect(q.groups.every(g => g.rows.length && g.rows.every(r => /proficiency scale/i.test(r.text)))).toBe(true);
    expect(RQ.browseList('habits', ctx, { fits: false, q: 'zzzz' }).groups).toEqual([]);
  });

  it('rowSource: the grade from the scores, the ratings behind the habits, the piece behind the example, Edited', () => {
    const st = cece();
    const { d, f, ctx } = draftWith(st, ['grade', 'example', 'home', 'overall']);
    const rows = RQ.rowsFromDraft(d);
    const src = r => RQ.rowSource(r, cid, st, f, ctx);
    expect(src(rows.find(r => r.step === 'grade'))).toMatch(/overall, from the year’s scores to this report$/);
    expect(src({ step: 'habits', edited: false, prov: null })).toMatch(
      /rated|From the record: |From your Work Habits ratings/,
    );
    const example = rows.find(r => r.step === 'example');
    expect(src(example)).toMatch(/ · (Emerging|Developing|Proficient|Extending)/);
    const home = rows.find(r => r.step === 'home');
    // A family sentence for the next step's skill names that competency; a
    // general one states no fact.
    const homeS = COMMENT_BANK.sentences.find(s => s.id === home.id);
    if (homeS && (homeS.when || homeS.v === 2))
      expect(src(home)).toMatch(/ · (Emerging|Developing|Proficient|Extending)$/);
    else expect(src(home)).toBe('A general sentence. It states no fact about Cece.');
    // Cece has no competency past the "strongest" gate; her results are
    // even, so the strengths row (the pipeline names one even skill) names
    // the competency behind it, as one by hand does.
    const even = rows.find(r => r.step === 'overall');
    expect(even).toBeTruthy();
    expect(src(even)).toMatch(/ · (Emerging|Developing|Proficient|Extending)/);
    const c = f.comps[0];
    expect(src({ step: 'overall', edited: false, prov: { factKeys: ['comp:' + c.id] } })).toBe(
      c.name + ' · ' + f.levelText(c.level),
    );
    expect(
      src(
        Object.assign(
          {},
          rows.find(r => r.step === 'grade'),
          { edited: true },
        ),
      ),
    ).toBe('Edited by you · kept when you regenerate');
    expect(src({ step: null, edited: false, prov: null })).toBe('Typed by you · kept when you regenerate');
    expect(src({ step: null, classLine: true, edited: false, prov: null })).toBe(
      'A general sentence. It states no fact about Cece.',
    );
  });
});

describe('the card drawn for a Demo Mode student', () => {
  let cid, saved, hadDoc, oldDoc;
  beforeAll(() => {
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    if (typeof seedIfNeeded !== 'function')
      runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    cid = 'sci8';
    setActiveTerm(cid, 2);
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
    RQ.configure({ activeCourse: cid, renderReports: () => {} });
  });
  afterAll(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });

  it('labels only the best-piece sentence Best Piece; a Voice quote is Voice, another example Example', () => {
    expect(RQ.rowLabel({ step: 'example', id: 'n36' }, null)).toBe('Best Piece');
    expect(RQ.rowLabel({ step: 'example', id: 'n31', s: { group: 'Examples From Work' } }, null)).toBe('Example');
    expect(RQ.rowLabel({ step: 'example', id: 'n50', s: { group: "In the Student's Words" } }, null)).toBe('Voice');
    expect(RQ.rowLabel({ step: 'grade', id: 'gr01' }, null)).toBe('Grade');
  });

  it('a saved draft: one row per sentence with its part, source, handle and Other Wording; Browse Sentences…', () => {
    const students = RQ.getTqStudents();
    const st = students.find(s => s.firstName === 'Noor');
    RQ.tqStudentIndex = students.indexOf(st);
    // The page reads the report picker's term; with no picker, the first.
    const termId = ReportBlocks.getTermId();
    // A Note for the Report on the best piece, so the draft carries the
    // best-piece sentence (plan PR 7).
    const best = RQ.bestPiece(CommentBank.facts(cid, st, termId));
    saveScoreReportNote(cid, st.id, best.id, 'labelled every part of the circuit');
    const f = CommentBank.facts(cid, st, termId);
    // A press with a home line, so the next-step sentences share a row.
    let d = null;
    for (let n = 0; n < 40 && !(d && d.sentences.some(x => x.step === 'home')); n++)
      d = CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id) + n, quiet: true });
    upsertTermRating(cid, st.id, termId, { narrative: d.text });
    const html = RQ.renderTermQuestionnaire(cid);
    saveScoreReportNote(cid, st.id, best.id, '');
    const card = html.slice(html.indexOf('id="tq-sentences"'));
    expect(card).toContain('Reword, edit or drag to reorder. The comment above follows.');
    expect(card).toContain('Browse Sentences…');
    expect(card).not.toContain('Reset Order');
    // One row per unit: the next-step sentences share a row.
    const units = RQ.units(RQ.rowsFromDraft(d)).length;
    expect(units).toBeLessThan(d.sentences.length);
    expect((card.match(/class="qn-srow-handle" draggable="true"/g) || []).length).toBe(units);
    expect((card.match(/data-do="wording"/g) || []).length).toBe(units);
    expect((card.match(/<span class="qn-req-label">Next Step<\/span>/g) || []).length).toBe(1);
    expect(card).toContain('<span class="qn-req-label">Grade</span>');
    expect(card).toContain('<span class="qn-req-label">Best Piece</span>');
    // The best-piece row alone is tinted and names the note.
    expect((card.match(/qn-srow best/g) || []).length).toBe(1);
    expect(card).toContain('· your note for the report');
    expect(card).toContain('<span class="qn-req-label">Next Step</span>');
    expect(card).toContain('Drag to move this sentence. ⌥↑ and ⌥↓ move it too.');
    // The class rows the comment has no sentence for are there too (plan PR 8).
    expect(card).toContain('<span class="qn-req-label">Support</span>');
    expect(card).toContain('<span class="qn-req-label">Closing</span>');
    expect(card).not.toContain('Edited');
    // The class rows sit where their steps fall: Support before the home
    // sentence, Closing last.
    const at = s => card.indexOf(s);
    expect(at('>Support<')).toBeGreaterThan(at('>Next Step<'));
    expect(at('>Closing<')).toBeGreaterThan(at('>Support<'));
  });

  it('a hand-written comment: every sentence a Your Sentence row with Options, typed by you', () => {
    const students = RQ.getTqStudents();
    const st = students.find(s => s.firstName === 'Hannah');
    RQ.tqStudentIndex = students.indexOf(st);
    upsertTermRating(cid, st.id, ReportBlocks.getTermId(), {
      narrative: 'Hannah had a steady term. She asks good questions.',
      draftMeta: { v: 1, sentences: [], teacher_text: ['Hannah had a steady term.', 'She asks good questions.'] },
    });
    const html = RQ.renderTermQuestionnaire(cid);
    const card = html.slice(html.indexOf('id="tq-sentences"'));
    expect((card.match(/class="qn-edited"/g) || []).length).toBe(0);
    expect((card.match(/<span class="qn-req-label">Your Sentence<\/span>/g) || []).length).toBe(2);
    expect((card.match(/data-do="options"/g) || []).length).toBe(2);
    expect(card).toContain('Typed by you · kept when you regenerate');
    expect(card).not.toContain('data-do="wording"');
    // A gap after each row, with its + and tooltip; none before the first.
    expect((card.match(/class="qn-gap" data-gap="\d+"/g) || []).length).toBe(2);
    expect(card).toContain('data-gap="1"');
    expect(card).toContain('data-gap="2"');
    expect(card).not.toContain('data-gap="0"');
    expect(card).toContain('aria-label="Add a sentence here"');
    expect(card).toContain('<span class="qn-gap-tip" role="tooltip">Add a sentence here</span>');
  });
});
