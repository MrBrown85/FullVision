/**
 * The student page's shell (S4-F1; the artboard's "To Do Card", "All Caught
 * Up" and "Page on a Chromebook"): the four tabs, To Do, Sent and Back with
 * their counts, and All Assignments, drawn from shared/student-view.js.
 *
 * The page runs as a browser loads it (tests/helpers/student-page-context.js),
 * in Demo Mode and against the student-submit function's real handler over a
 * stand-in database. No test waits on real time.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { WORK, fakeStudentSubmit, sampleCard, samplePage } from './helpers/fake-student-submit.js';

const TODAY = new Date().toISOString().slice(0, 10);

const text = page => page.root().textContent;
// The titles on screen: All Assignments' rows, or the cards of To Do, Sent or Back (S4-F2).
const titles = page =>
  [...page.root().querySelectorAll('.sp-row-title, .sp-deck .sp-piece-title')].map(el => el.textContent);
// Each piece's result: a row's, or a card's Your Result.
const results = page =>
  Object.fromEntries([
    ...[...page.root().querySelectorAll('.sp-row')].map(li => [
      li.querySelector('.sp-row-title').textContent,
      (li.querySelector('.sp-row-result') || {}).textContent || '',
    ]),
    ...[...page.root().querySelectorAll('.sp-deck .sp-piece')].map(card => {
      const first = card.querySelector('.sp-piece-row');
      const mine = first && first.querySelector('.sp-piece-row-name').textContent === 'Your Result';
      return [
        card.querySelector('.sp-piece-title').textContent,
        mine ? first.querySelector('.sp-level').textContent : '',
      ];
    }),
  ]);
const segments = page => [...page.root().querySelectorAll('.sp-segment')].map(b => b.textContent);
const pressed = page => page.root().querySelector('.sp-segment[aria-pressed="true"]').textContent;

async function demo(hash) {
  const page = openStudentPage();
  await page.start(hash || '#demo-card');
  await page.submit('form[data-form="card"]');
  page.type('#sp-ident', page.T.DEMO.number);
  await page.click('[data-act="card-yes"]');
  return page;
}

async function real(card) {
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY, card)] });
  const page = openStudentPage();
  page.server = body => fn.handle(body);
  await page.start('#P3R8-WDK4');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  return { page, fn };
}

describe('the four tabs', () => {
  it('Assignments, My Learning, Questionnaires and Reports, the first one current', async () => {
    const page = await demo();
    // Drawn twice: in the header for a Chromebook, along the bottom for a phone; page-view.css shows one.
    expect(page.root().querySelector('.sp-tabs-top').tagName).toBe('NAV');
    expect(page.root().querySelector('.sp-tabs-top').innerHTML.replace('sp-tabs-top', '')).toBe(
      page.root().querySelector('.sp-tabs-bottom').innerHTML.replace('sp-tabs-bottom', ''),
    );
    const tabs = [...page.root().querySelectorAll('.sp-tabs-bottom .sp-tab')];
    expect(tabs.map(t => t.querySelector('.sp-tab-label').textContent)).toEqual([
      'Assignments',
      'My Learning',
      'Questionnaires',
      'Reports',
    ]);
    expect(tabs.map(t => t.getAttribute('aria-current'))).toEqual(['page', null, null, null]);
  });

  it('each tab opens with nothing asked, says what it holds, and Assignments comes back on To Do', async () => {
    const { page } = await real();
    const asked = page.calls.length;
    const lines = {};
    for (const tab of ['learning', 'questionnaires', 'reports']) {
      await page.click('[data-tab="' + tab + '"]');
      expect(page.root().querySelector('.sp-tab[aria-current="page"]').getAttribute('data-tab')).toBe(tab);
      expect(page.root().querySelector('.sp-row')).toBeNull();
      expect(page.root().querySelector('.sp-segments')).toBeNull();
      lines[page.root().querySelector('.sp-page-title').textContent] = page
        .root()
        .querySelector('.sp-empty').textContent;
    }
    expect(lines).toEqual({
      'My Learning': 'Your teacher hasn’t turned on My Learning for this class.',
      Questionnaires: 'Questionnaires from your teacher will show here.',
      'My Reports': 'Reports from your teacher will show here.',
    });
    // No grade anywhere on them.
    await page.click('[data-tab="learning"]');
    expect(text(page)).not.toMatch(/Proficient|Extending|Developing|\d\.\d/);
    await page.click('[data-tab="assignments"]');
    expect(pressed(page)).toBe('To Do 3');
    expect(page.calls.length).toBe(asked);
  });

  it('a tab that is not one of the four opens nothing', async () => {
    const page = await demo();
    const tab = page.root().querySelector('[data-tab="reports"]');
    tab.setAttribute('data-tab', 'grades');
    await page.click('[data-tab="grades"]');
    expect(page.root().querySelector('.sp-tab[aria-current="page"]').getAttribute('data-tab')).toBe('assignments');
  });
});

describe('To Do, Sent and Back', () => {
  it('the counts are student-view.js’s: To Do is what is due and what is Missing; Back what came back', async () => {
    const page = await demo();
    expect(segments(page)).toEqual(['To Do 3', 'Sent 0', 'Back 6']);
    const view = page.T.viewOf(page.T.state());
    expect(view.counts).toEqual({ toDo: 2, sent: 0, back: 6, missing: 1 });
    expect(page.T.counts(view)).toEqual({ todo: 3, sent: 0, back: 6 });
    // The tab opens on To Do.
    expect(pressed(page)).toBe('To Do 3');
    expect(titles(page)).toEqual(['Science Fair Proposal', 'Disease Research Poster', 'Immune System Quick Check']);
  });

  it('a draft is To Do like work never graded: no result, no mark, and it does not count as Back', async () => {
    const page = await demo();
    expect(results(page)['Disease Research Poster']).toBe('');
    const li = [...page.root().querySelectorAll('.sp-deck .sp-piece')].find(el => el.textContent.includes('Poster'));
    expect(li.className).toContain('sp-piece-due');
    expect(li.querySelector('.sp-piece-rows')).toBeNull();
    expect(li.hasAttribute('data-unseen')).toBe(false);
    expect(page.root().innerHTML).not.toContain('two of your sources');
    await page.click('[data-segment="back"]');
    expect(titles(page)).not.toContain('Disease Research Poster');
  });

  it('Back lists what came back, newest first, each result as student-view.js and calc.js give it', async () => {
    const page = await demo();
    await page.click('[data-segment="back"]');
    expect(pressed(page)).toBe('Back 6');
    const view = page.T.viewOf(page.T.state());
    const back = view.work.filter(p => p.kind === 'back');
    expect(titles(page)).toEqual(back.map(p => p.title));
    expect(results(page)).toEqual(Object.fromEntries(back.map(p => [p.title, p.result.text])));
    expect(results(page)['Cell Structure Quiz']).toBe('8 / 10');
    expect(results(page)['Ecosystem Connections Essay']).toBe('Developing');
  });

  it('Sent is empty until students can send work', async () => {
    const page = await demo();
    await page.click('[data-segment="sent"]');
    expect(page.root().querySelector('.sp-empty').textContent).toBe('Nothing sent yet.');
  });

  it('nothing to do: All caught up, and See What’s Back opens Back', async () => {
    const { page } = await real({
      page: Object.assign(sampleCard(TODAY).page, {
        assessments: sampleCard(TODAY).page.assessments.filter(a => a.returned_at),
      }),
    });
    expect(pressed(page)).toBe('To Do 0');
    expect(page.root().querySelector('.sp-caught-up-words').textContent).toBe('All caught up');
    expect(page.root().querySelector('.sp-caught-up [data-segment="back"]').textContent).toBe('See What’s Back');
    await page.click('.sp-caught-up [data-segment="back"]');
    expect(pressed(page)).toMatch(/^Back \d+$/);
    expect(page.root().querySelector('.sp-deck .sp-piece')).toBeTruthy();
  });

  it('a segment that is not one of the three changes nothing', async () => {
    const page = await demo();
    page.root().querySelector('[data-segment="sent"]').setAttribute('data-segment', 'drafts');
    await page.click('[data-segment="drafts"]');
    expect(pressed(page)).toBe('To Do 3');
  });

  it('a row on Back is watched for "opened" once Back is showing, and told to the server once', async () => {
    const { page } = await real();
    const seen = () => page.calls.filter(c => c.body.route === 'seen').map(c => c.body.assessment_ids);
    // On To Do nothing that came back is on screen.
    page.onScreen(() => true);
    page.advance(700);
    await page.T.tellSeen();
    await page.settle();
    expect(seen()).toEqual([]);
    await page.click('[data-segment="back"]');
    page.onScreen(() => true);
    page.advance(700);
    await page.T.tellSeen();
    await page.settle();
    expect(seen()).toEqual([[WORK.energy, WORK.quiz, WORK.lab, WORK.essay, WORK.kmt, WORK.contract]]);
  });
});

describe('All Assignments', () => {
  it('the header’s list button opens every piece in one list; Back to Assignments returns to the segments', async () => {
    const page = await demo();
    const button = page.root().querySelector('[data-act="all-open"]');
    expect(button.getAttribute('aria-label')).toBe('All assignments');
    await page.click('[data-act="all-open"]');
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('All Assignments');
    expect(page.root().querySelector('[data-act="all-open"]').getAttribute('aria-pressed')).toBe('true');
    expect(titles(page)).toHaveLength(9);
    expect(page.root().querySelector('.sp-segments')).toBeNull();
    await page.click('[data-act="all-close"]');
    expect(pressed(page)).toBe('To Do 3');
  });
});

describe('the page draws from student-view.js, and never throws into a draw', () => {
  it('the rows are the view’s pieces, in its order, with its results', async () => {
    const page = await demo();
    page.showAll();
    const view = page.T.viewOf(page.T.state());
    expect(titles(page)).toEqual(view.work.map(p => p.title));
    expect(Object.values(results(page))).toEqual(view.work.map(p => p.result.text));
  });

  it('before the reply is here, or with student-view.js missing, a plain waiting line', async () => {
    const page = await demo();
    const s = page.T.state();
    const html = page.T.render(Object.assign({}, s, { reply: null }));
    expect(html).toContain('Opening your page…');
    expect(html).not.toContain('sp-row');
    page.run('window.__keep = StudentView; delete window.StudentView');
    expect(page.T.render(s)).toContain('Opening your page…');
    page.run('window.StudentView = window.__keep');
  });

  it('with constants.js out of reach the list still draws: what came back shows with no result, and says so', async () => {
    const page = await demo();
    page.run('window.__keep = scoreLevelText; window.scoreLevelText = undefined');
    await page.click('[data-segment="back"]');
    expect(titles(page).length).toBe(6);
    expect(Object.values(results(page)).every(r => r === '')).toBe(true);
    expect(page.root().querySelector('.sp-no-results')).toBeTruthy();
    page.run('window.scoreLevelText = window.__keep');
  });

  it('a view that throws while it is built draws the waiting line, not a broken page', async () => {
    const page = await demo();
    page.run('window.__keep = StudentView.fromPage; StudentView.fromPage = function () { throw new Error("x"); }');
    expect(() => page.T.render(page.T.state())).not.toThrow();
    expect(page.T.render(page.T.state())).toContain('Opening your page…');
    page.run('StudentView.fromPage = window.__keep');
  });
});

describe('the frame', () => {
  it('the class’s name with its block, Done, and the list button, as the board draws them', async () => {
    const { page } = await real();
    const head = page.root().querySelector('.sp-view .sp-head');
    expect(head.querySelector('.sp-head-title').textContent).toBe('Science 8');
    expect(head.querySelector('.sp-pill').textContent).toBe('Block B');
    expect(head.querySelector('[data-act="card-done"]').textContent).toBe('Done');
    expect(head.querySelector('[data-act="all-open"]')).toBeTruthy();
  });

  it('opening another class starts it on Assignments, To Do', async () => {
    const page = await demo();
    await page.click('[data-tab="reports"]');
    await page.click('[data-act="classes-open"]');
    await page.click('.sp-sheet [data-act="card-add"]');
    page.type('#sp-code', 'ABCD-EFGH');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    expect(page.root().querySelector('.sp-tab[aria-current="page"]').getAttribute('data-tab')).toBe('assignments');
    expect(pressed(page)).toBe('To Do 2');
    expect(page.calls).toEqual([]);
  });
});

describe('Preview as Student draws what the student page draws', () => {
  /* The teacher's preview (teacher/preview-student.js, loaded here by
     tests/setup.js) and the student page (its own context) are each handed
     the same view, and draw the same HTML. */
  it.each(['proficiency', 'letter', 'both'])('a %s class: the same HTML, character for character', async system => {
    const { page } = await real({ page: samplePage(TODAY, system) });
    page.showAll();
    const view = JSON.parse(JSON.stringify(page.T.viewOf(page.T.state())));
    const student = page.root().querySelector('.sp-view').outerHTML;
    const preview = globalThis.PreviewStudent.drawPage(view, { all: true });
    // Read back through the same parser as the student page's, so both are written out alike.
    const box = page.root().ownerDocument.createElement('div');
    box.innerHTML = preview;
    expect(box.innerHTML).toBe(student);
    expect(preview).toContain('Cell Structure Quiz');
    expect(preview).toContain('8 / 10');
  });

  it('the preview’s drawing is s/page-view.js’s: no second copy', () => {
    const src = readFileSync(new URL('../teacher/preview-student.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('function drawPage('), src.indexOf('/* ── The two lists'));
    expect(body).toContain('StudentPageView.html(');
    expect(readFileSync(new URL('../teacher/app.html', import.meta.url), 'utf8')).toContain(
      '<script src="/s/page-view.js"></script>',
    );
  });
});
