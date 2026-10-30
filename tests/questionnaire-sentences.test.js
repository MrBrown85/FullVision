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
    expect(RQ.rowLabel({ step: null }, null)).toBe('');
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

describe('moveRow, dropRow and resetOrder', () => {
  const rows = [
    row('a', 'grade', 'A.'),
    row('m', 'notHandedIn', 'M.'),
    row('l', 'lateWork', 'L.'),
    row('h', 'habits', 'H.'),
    row('c', 'closer', 'C.'),
  ];
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

  it('composeRows: the comment follows the rows, and the name moves to whichever sentence comes first', () => {
    const { d } = draftFor(cece());
    const rows = RQ.rowsFromDraft(d);
    expect(RQ.composeRows(rows)).toBe(d.text);
    const moved = RQ.moveRow(rows, 0, 1);
    const text = RQ.composeRows(moved);
    expect(text.startsWith(moved[0].text)).toBe(true);
    expect(moved[0].text).toContain('Cece');
    expect(moved[1].text.indexOf('Cece')).toBe(-1);
    expect(moved[1].text).toMatch(/^(She|Her)\b/);
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
    const own = RQ.recoverRows('Cece had a good term. She asks questions.', ctx);
    expect(own.map(r => [r.step, r.edited])).toEqual([
      [null, true],
      [null, true],
    ]);
  });

  it('alternatives: up to two other sentences of the step that fit and claim the same, least used first', () => {
    const { d, ctx } = draftFor(cece());
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

  it('useSentence: a sentence replaces the row of its step, or takes a new row where its step falls', () => {
    const { d, ctx } = draftFor(cece());
    const rows = RQ.rowsFromDraft(d);
    const home = rows.find(r => r.step === 'home');
    const other = COMMENT_BANK.sentences.find(
      s => CommentBank.stepOf(s) === 'home' && s.id !== home.id && CommentBank.fits(s, ctx),
    );
    const out = RQ.useSentence(rows, other, ctx);
    expect(out.length).toBe(rows.length);
    expect(out.find(r => r.step === 'home').id).toBe(other.id);
    expect(out.find(r => r.step === 'home').text).toMatch(/^At home, you can ask her/);
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
    expect(all.rows.length).toBe(all.total);
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

  it('rowSource: the grade from the scores, the ratings behind the habits, the piece behind the example, Edited', () => {
    const st = cece();
    const { d, f, ctx } = draftFor(st);
    const rows = RQ.rowsFromDraft(d);
    const src = r => RQ.rowSource(r, cid, st, f, ctx);
    expect(src(rows[0])).toMatch(/overall, from this term’s scores$/);
    expect(src({ step: 'habits', edited: false, prov: null })).toMatch(/rated|From your Work Habits ratings/);
    const example = rows.find(r => r.step === 'example');
    expect(src(example)).toMatch(/ · (Emerging|Developing|Proficient|Extending)/);
    const home = rows.find(r => r.step === 'home');
    expect(src(home)).toBe('A general sentence. It states no fact about Cece.');
    const overall = rows.find(r => r.step === 'overall');
    expect(src(overall)).toBe('All six competencies at Proficient');
    expect(src(Object.assign({}, rows[0], { edited: true }))).toBe('Edited by you · kept when you regenerate');
    expect(src({ step: null, edited: false, prov: null })).toBe('A general sentence. It states no fact about Cece.');
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

  it('a saved draft: one row per sentence with its part, source, handle and Other Wording; Browse Sentences…', () => {
    const students = RQ.getTqStudents();
    const st = students.find(s => s.firstName === 'Noor');
    RQ.tqStudentIndex = students.indexOf(st);
    // The page reads the report picker's term; with no picker, the first.
    const termId = ReportBlocks.getTermId();
    const f = CommentBank.facts(cid, st, termId);
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id) });
    upsertTermRating(cid, st.id, termId, { narrative: d.text });
    const html = RQ.renderTermQuestionnaire(cid);
    const card = html.slice(html.indexOf('id="tq-sentences"'));
    expect(card).toContain('Reword, edit or drag to reorder. The comment above follows.');
    expect(card).toContain('Browse Sentences…');
    expect(card).not.toContain('Reset Order');
    expect((card.match(/class="qn-srow-handle" draggable="true"/g) || []).length).toBe(d.sentences.length);
    expect((card.match(/data-do="wording"/g) || []).length).toBe(d.sentences.length);
    expect(card).toContain('<span class="qn-req-label">Grade</span>');
    expect(card).toContain('<span class="qn-req-label">Best Piece</span>');
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

  it('a hand-written comment: every sentence a row of the teacher’s own, Edited, with no part', () => {
    const students = RQ.getTqStudents();
    const st = students.find(s => s.firstName === 'Hannah');
    RQ.tqStudentIndex = students.indexOf(st);
    upsertTermRating(cid, st.id, ReportBlocks.getTermId(), {
      narrative: 'Hannah had a steady term. She asks good questions.',
    });
    const html = RQ.renderTermQuestionnaire(cid);
    const card = html.slice(html.indexOf('id="tq-sentences"'));
    expect((card.match(/class="qn-edited"/g) || []).length).toBe(2);
    expect(card).toContain('Edited by you · kept when you regenerate');
    expect(card).not.toContain('data-do="wording"');
  });
});
