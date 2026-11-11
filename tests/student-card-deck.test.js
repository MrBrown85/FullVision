/**
 * The assignment cards and All Assignments (S4-F2; the artboard's "To Do
 * Card", "Returned Work", "All Assignments" and "Page on a Chromebook"),
 * drawn by s/page-view.js from shared/student-view.js's view.
 *
 * The page runs as a browser loads it (tests/helpers/student-page-context.js),
 * in Demo Mode and against the student-submit function's real handler over a
 * stand-in database. No test waits on real time.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { WORK, fakeStudentSubmit, sampleCard } from './helpers/fake-student-submit.js';

const TODAY = new Date().toISOString().slice(0, 10);

const cards = page => [...page.root().querySelectorAll('.sp-deck .sp-piece')];
const card = (page, title) => cards(page).find(c => c.querySelector('.sp-piece-title').textContent === title);
const tags = c => [...c.querySelectorAll('.sp-flag')].map(t => t.textContent);
const rowsOf = c =>
  [...c.querySelectorAll('.sp-piece-row')].map(r => [
    r.querySelector('.sp-piece-row-name').textContent,
    r.querySelector('.sp-level').textContent,
  ]);
const listed = page => [...page.root().querySelectorAll('.sp-row-title')].map(el => el.textContent);

async function demo(hash) {
  const page = openStudentPage();
  await page.start(hash || '#demo-card');
  await page.submit('form[data-form="card"]');
  page.type('#sp-ident', page.T.DEMO.number);
  await page.click('[data-act="card-yes"]');
  return page;
}

async function real() {
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)] });
  const page = openStudentPage();
  page.server = body => fn.handle(body);
  await page.start('#P3R8-WDK4');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  return { page, fn };
}

const viewOf = page => page.T.viewOf(page.T.state());
const piece = (page, title) => viewOf(page).work.find(p => p.title === title);

describe('the cards of To Do', () => {
  it('one card a piece, newest first, each with when it is due; Missing says so', async () => {
    const page = await demo();
    expect(cards(page).map(c => c.querySelector('.sp-piece-title').textContent)).toEqual([
      'Science Fair Proposal',
      'Disease Research Poster',
      'Immune System Quick Check',
    ]);
    expect(tags(card(page, 'Science Fair Proposal'))[0]).toMatch(/^Due \S+ \S+ \d+$/);
    expect(tags(card(page, 'Immune System Quick Check'))[0]).toBe('Missing');
    // Work still to do shows no result and no comment.
    cards(page).forEach(c => {
      expect(c.querySelector('.sp-piece-rows')).toBeNull();
      expect(c.querySelector('.sp-piece-comment')).toBeNull();
    });
  });

  it('a draft’s card is a not-graded card: no level, no comment, nothing that says a draft exists', async () => {
    const page = await demo();
    const draft = card(page, 'Disease Research Poster');
    const plain = card(page, 'Science Fair Proposal');
    const shape = el =>
      el.outerHTML
        .replace(/>[^<]+</g, '><')
        .replace(/(data-piece|aria-labelledby|id)="[^"]*"/g, '$1=""')
        .replace(' sp-picked', '');
    expect(shape(draft)).toBe(shape(plain));
    expect(page.root().innerHTML).not.toContain('two of your sources');
  });

  it('“1 of 3” under the cards; the first card is the one picked', async () => {
    const page = await demo();
    expect(page.root().querySelector('.sp-deck-count').textContent).toBe('1 of 3');
    expect(page.root().querySelector('.sp-piece.sp-picked .sp-piece-title').textContent).toBe('Science Fair Proposal');
  });
});

describe('the cards of Back', () => {
  it('Returned and the date, Your Result, each competency’s level, and the comment, all as the view gives them', async () => {
    const page = await demo();
    await page.click('[data-segment="back"]');
    const energy = card(page, 'Energy Transfer Investigation');
    const p = piece(page, 'Energy Transfer Investigation');
    expect(tags(energy)[0]).toMatch(/^Returned \S+ \d+$/);
    expect(rowsOf(energy)).toEqual([['Your Result', p.result.text]].concat(p.competencies.map(r => [r.name, r.text])));
    expect(energy.querySelector('.sp-piece-comment').textContent).toBe(p.comment);
    expect(p.comment).toBe('Your data table shows every transfer. Well done.');
    // Each level beside its competency's name.
    expect(rowsOf(energy)[1]).toEqual(['Processing and Analyzing Data', 'Extending']);
  });

  it('a rubric piece lists each criterion with its level; points and Complete show their result alone', async () => {
    const page = await demo();
    await page.click('[data-segment="back"]');
    const lab = piece(page, 'Cell Microscope Lab');
    expect(rowsOf(card(page, 'Cell Microscope Lab'))).toEqual(
      [['Your Result', lab.result.text]].concat(lab.rubric.rows.map(r => [r.name, r.text])),
    );
    expect(rowsOf(card(page, 'Cell Structure Quiz'))).toEqual([['Your Result', '8 / 10']]);
    expect(rowsOf(card(page, 'Lab Safety Contract'))).toEqual([['Your Result', 'Complete']]);
  });

  it('a returned grade changed since: Updated; the grade shown is the one returned, not the draft over it', async () => {
    const page = await demo();
    await page.click('[data-segment="back"]');
    // Updated, with the day it was updated (S4-F5), in place of Returned.
    expect(tags(card(page, 'Lab Safety Contract'))[0]).toMatch(/^Updated \S+ \d+$/);
    const essay = card(page, 'Ecosystem Connections Essay');
    expect(rowsOf(essay)[0]).toEqual(['Your Result', '2.0']);
    expect(essay.textContent).not.toContain('much clearer after your rewrite');
    expect(essay.querySelector('.sp-piece-comment').textContent).toBe(
      'Explain how the food web changes when one species goes.',
    );
  });

  it('a returned card not yet opened is watched for "opened", and told to the server once', async () => {
    const { page } = await real();
    await page.click('[data-segment="back"]');
    const unseen = cards(page)
      .filter(c => c.hasAttribute('data-unseen'))
      .map(c => c.getAttribute('data-unseen'));
    expect(unseen).toEqual([WORK.energy, WORK.quiz, WORK.lab, WORK.essay, WORK.kmt, WORK.contract]);
    // Only the card on screen counts.
    page.onScreen(el => el.getAttribute('data-unseen') === WORK.energy);
    page.advance(700);
    await page.T.tellSeen();
    await page.settle();
    expect(page.calls.filter(c => c.body.route === 'seen').map(c => c.body.assessment_ids)).toEqual([[WORK.energy]]);
  });
});

describe('on a Chromebook: the list on the left, the card picked on the right', () => {
  it('pressing a piece in the list shows its card; the list says which is showing', async () => {
    const page = await demo();
    await page.click('[data-segment="back"]');
    const side = () => [...page.root().querySelectorAll('.sp-side-row')];
    expect(side().map(b => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);
    const quiz = side().find(b => b.textContent.includes('Cell Structure Quiz'));
    await page.click('.sp-side-row[data-piece="' + quiz.getAttribute('data-piece') + '"]');
    expect(page.root().querySelector('.sp-piece.sp-picked .sp-piece-title').textContent).toBe('Cell Structure Quiz');
    expect(page.root().querySelector('.sp-side-row[aria-pressed="true"]').textContent).toContain('Cell Structure Quiz');
    expect(page.root().querySelector('.sp-deck-count').textContent).toBe('2 of 6');
    expect(page.calls).toEqual([]);
  });
});

describe('All Assignments: search, filters, and a row opens its card', () => {
  it('the board’s header, search box and filters', async () => {
    const page = await demo();
    await page.click('[data-act="all-open"]');
    expect(page.root().querySelector('[data-act="all-close"]').getAttribute('aria-label')).toBe('Back to cards');
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('All Assignments');
    const search = page.root().querySelector('#sp-search');
    expect(search.getAttribute('placeholder')).toBe('Search assignments');
    expect(page.root().querySelector('label[for="sp-search"]').textContent).toBe('Search assignments');
    expect([...page.root().querySelectorAll('.sp-filter')].map(b => b.textContent)).toEqual([
      'All',
      'To Do',
      'Sent',
      'Back',
      // What changed since the student last looked (S4-F5).
      'New ' + viewOf(page).changes.length,
    ]);
    expect(listed(page)).toHaveLength(9);
  });

  it('search narrows by the title’s words, any case; nothing found says so', async () => {
    const page = await demo();
    await page.click('[data-act="all-open"]');
    page.type('#sp-search', 'cell');
    expect(listed(page)).toEqual(['Cell Structure Quiz', 'Cell Microscope Lab']);
    page.type('#sp-search', 'LAB cell');
    expect(listed(page)).toEqual(['Cell Microscope Lab']);
    page.type('#sp-search', 'volcano');
    expect(listed(page)).toEqual([]);
    expect(page.root().querySelector('.sp-empty').textContent).toBe('Nothing matches.');
    expect(page.root().querySelector('#sp-search').getAttribute('value')).toBe('volcano');
    expect(page.calls).toEqual([]);
  });

  it('the filters: To Do, Sent, Back and All, with the search still applied', async () => {
    const page = await demo();
    await page.click('[data-act="all-open"]');
    await page.click('[data-filter="todo"]');
    expect(listed(page)).toEqual(['Science Fair Proposal', 'Disease Research Poster', 'Immune System Quick Check']);
    await page.click('[data-filter="back"]');
    expect(listed(page)).toHaveLength(6);
    page.type('#sp-search', 'lab');
    expect(listed(page)).toEqual(['Cell Microscope Lab', 'KMT & States of Matter Lab', 'Lab Safety Contract']);
    await page.click('[data-filter="sent"]');
    expect(page.root().querySelector('.sp-empty').textContent).toBe('Nothing matches.');
    await page.click('[data-filter="todo"]');
    expect(page.root().querySelector('.sp-empty').textContent).toBe('Nothing matches.');
    await page.click('[data-filter="all"]');
    expect(listed(page)).toEqual(['Cell Microscope Lab', 'KMT & States of Matter Lab', 'Lab Safety Contract']);
  });

  it('a row opens its card in To Do or Back, picked, with the keyboard on its title', async () => {
    const page = await demo();
    await page.click('[data-act="all-open"]');
    const lab = piece(page, 'Cell Microscope Lab');
    await page.click('[data-act="open-piece"][data-piece="' + lab.id + '"]');
    expect(page.root().querySelector('.sp-segment[aria-pressed="true"]').textContent).toBe('Back 6');
    expect(page.root().querySelector('.sp-piece.sp-picked .sp-piece-title').textContent).toBe('Cell Microscope Lab');
    expect(page.root().querySelector('.sp-deck-count').textContent).toBe('3 of 6');
  });

  it('Back to cards returns to the segment that was showing', async () => {
    const page = await demo();
    await page.click('[data-segment="back"]');
    await page.click('[data-act="all-open"]');
    await page.click('[data-act="all-close"]');
    expect(page.root().querySelector('.sp-segment[aria-pressed="true"]').textContent).toBe('Back 6');
  });
});

describe('what a press changes is decided in one place, for the page and the preview', () => {
  const press = (page, ui, act, attrs) => {
    const el = { getAttribute: name => (attrs && attrs[name]) || null, closest: () => null };
    return page.run('StudentPageView.press')(ui, viewOf(page), act, el);
  };

  it('an id that is no piece, an Excused piece, or a press that is not the page’s own changes nothing', async () => {
    const page = await demo();
    expect(press(page, {}, 'open-piece', { 'data-piece': 'nope' })).toBeNull();
    expect(press(page, {}, 'filter', { 'data-filter': 'drafts' })).toBeNull();
    expect(press(page, {}, 'card-done')).toBeNull();
    expect(press(page, {}, 'classes-open')).toBeNull();
    const excused = { kind: 'excused', id: 'x', title: 'Excused Piece' };
    const ui = page.run('StudentPageView.press')({}, { work: [excused] }, 'open-piece', {
      getAttribute: () => 'x',
      closest: () => null,
    });
    expect(ui).toBeNull();
  });

  it('opening a piece picks it in its own segment', async () => {
    const page = await demo();
    const quiz = piece(page, 'Cell Structure Quiz');
    expect(press(page, { all: true }, 'open-piece', { 'data-piece': quiz.id }).ui).toMatchObject({
      tab: 'assignments',
      segment: 'back',
      all: false,
      pick: quiz.id,
    });
  });
});

/* S4-W1: what the server now sends about each piece and class, in Demo
   Mode's sample (which sends it as the database does since S4-M1). */
describe('what the server also tells, in Demo Mode (S4-W1)', () => {
  it('a card still to do: its unit, category, Description, I Can lines and Core Competencies', async () => {
    const page = await demo();
    const fair = card(page, 'Science Fair Proposal');
    const text = sel => [...fair.querySelectorAll(sel)].map(el => el.textContent);
    expect(text('.sp-piece-unit')).toEqual(['Unit 2: Body Systems']);
    expect(text('.sp-piece-category')).toEqual(['Projects']);
    expect(text('.sp-piece-about')).toEqual([
      'Choose a question you can test. Write your question, what you predict, and the steps you will follow.',
    ]);
    expect(text('.sp-graded-on-name')).toEqual(['Questioning and Predicting', 'Planning and Conducting']);
    expect(text('.sp-graded-on-ican')).toEqual([
      'I can ask a question that can be tested and say what I expect to happen.',
      'I can plan a fair test and carry it out safely.',
    ]);
    expect(text('.sp-core-name')).toEqual(['Creative Thinking', 'Critical & Reflective Thinking']);
  });

  it('a returned card: no teacher’s name over the comment, though the sample sends one (ruling 112)', async () => {
    const page = await demo();
    await page.click('[data-segment="back"]');
    const lab = card(page, 'Cell Microscope Lab');
    expect(lab.querySelector('.sp-piece-from')).toBe(null);
    expect(lab.querySelector('.sp-piece-comment')).not.toBe(null);
    expect(page.root().innerHTML).not.toContain('Rivera');
    expect(lab.querySelector('.sp-piece-unit').textContent).toBe('Unit 1: Cells');
  });

  it('Your Classes says how many pieces wait in each class; none where nothing waits or the server does not say', async () => {
    const page = await demo();
    await page.click('[data-act="classes-open"]');
    expect([...page.root().querySelectorAll('.sp-class-todo')].map(el => el.textContent)).toEqual(['3 to do']);
    const html = page.run('StudentPage.classesSheet')({
      student: { id: 'e1' },
      classes: [
        { enrollmentId: 'e1', name: 'Science 8', block: 'B', toDo: 0 },
        { enrollmentId: 'e2', name: 'Humanities 8', block: 'A', toDo: null },
        { enrollmentId: 'e3', name: 'Socials 8', block: 'C', toDo: 1 },
      ],
    });
    expect(html.match(/sp-class-todo">[^<]*/g)).toEqual(['sp-class-todo">1 to do']);
  });
});
