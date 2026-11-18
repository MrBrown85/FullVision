/**
 * The student page's shell (S4-F1; redesigned 2026-11-14): the three tabs,
 * Outstanding and Upcoming with their counts, My Learning's list of work,
 * and Log Out, drawn from shared/student-view.js.
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
// The titles of the cards on Outstanding or Upcoming.
const titles = page => [...page.root().querySelectorAll('.sp-deck .sp-piece-title')].map(el => el.textContent);
// My Learning's Your Work rows: [title, the chip's words].
const learning = page =>
  [...page.root().querySelectorAll('.sp-ml-work .sp-ml-row')].map(row => [
    row.querySelector('.sp-row-title').textContent,
    (row.querySelector('.sp-level') || {}).textContent || '',
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

describe('the three tabs', () => {
  it('Assignments, My Learning and Reflect, the first one current', async () => {
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
      'Reflect',
    ]);
    expect(tabs.map(t => t.getAttribute('data-tab'))).toEqual(['assignments', 'learning', 'questionnaires']);
    expect(tabs.map(t => t.getAttribute('aria-current'))).toEqual(['page', null, null]);
    // No Reports tab any more.
    expect(page.root().querySelector('[data-tab="reports"]')).toBeNull();
  });

  it('each tab opens with nothing asked, says what it holds, and Assignments comes back on Outstanding', async () => {
    const { page } = await real();
    const asked = page.calls.length;
    await page.click('[data-tab="questionnaires"]');
    expect(page.root().querySelector('.sp-tab[aria-current="page"]').getAttribute('data-tab')).toBe('questionnaires');
    expect(page.root().querySelector('.sp-segments')).toBeNull();
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Reflect');
    expect(page.root().querySelector('.sp-empty').textContent).toBe('Reflections from your teacher will show here.');
    // My Learning lists the work even with Show My Learning off, and shows no grade above it.
    await page.click('[data-tab="learning"]');
    expect(page.root().querySelector('.sp-tab[aria-current="page"]').getAttribute('data-tab')).toBe('learning');
    expect(page.root().querySelector('.sp-segments')).toBeNull();
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('My Learning');
    expect(page.root().querySelector('.sp-ml-overall')).toBeNull();
    expect(page.root().querySelector('.sp-ml-work .sp-ml-card-title').textContent).toBe('Your Work');
    expect(text(page)).not.toContain('This Year So Far');
    await page.click('[data-tab="assignments"]');
    expect(pressed(page)).toBe('Outstanding 2');
    expect(page.calls.length).toBe(asked);
  });

  it('a tab that is not one of the three opens nothing, not even the old Reports', async () => {
    const page = await demo();
    const tab = page.root().querySelector('[data-tab="questionnaires"]');
    tab.setAttribute('data-tab', 'reports');
    await page.click('[data-tab="reports"]');
    expect(page.root().querySelector('.sp-tab[aria-current="page"]').getAttribute('data-tab')).toBe('assignments');
  });
});

describe('Outstanding and Upcoming', () => {
  it('Outstanding is what is due by today and what is Missing; Upcoming what is due after today', async () => {
    const page = await demo();
    expect(segments(page)).toEqual(['Outstanding 2', 'Upcoming 1']);
    const view = page.T.viewOf(page.T.state());
    expect(view.counts).toEqual({ toDo: 2, sent: 0, back: 6, missing: 1 });
    expect(page.T.counts(view)).toEqual({ outstanding: 2, upcoming: 1 });
    // The tab opens on Outstanding, the oldest due date first.
    expect(pressed(page)).toBe('Outstanding 2');
    expect(titles(page)).toEqual(['Immune System Quick Check', 'Disease Research Poster']);
    await page.click('[data-segment="upcoming"]');
    expect(pressed(page)).toBe('Upcoming 1');
    expect(titles(page)).toEqual(['Science Fair Proposal']);
  });

  it('a draft is Outstanding like work never graded: no result, no mark, and it is not on My Learning', async () => {
    const page = await demo();
    const card = [...page.root().querySelectorAll('.sp-deck .sp-piece')].find(el => el.textContent.includes('Poster'));
    expect(card.className).toContain('sp-piece-due');
    expect(card.querySelector('.sp-level')).toBeNull();
    expect(card.hasAttribute('data-unseen')).toBe(false);
    expect(page.root().innerHTML).not.toContain('two of your sources');
    await page.click('[data-tab="learning"]');
    expect(learning(page).map(r => r[0])).not.toContain('Disease Research Poster');
  });

  it('My Learning lists what came back, newest first, each result as student-view.js and calc.js give it', async () => {
    const page = await demo();
    await page.click('[data-tab="learning"]');
    const view = page.T.viewOf(page.T.state());
    const back = view.work.filter(p => p.kind === 'back');
    const rows = learning(page);
    // Missing work is listed too; what came back follows in the view's order.
    expect(rows.filter(r => r[1] !== 'Missing')).toEqual(back.map(p => [p.title, p.result.text]));
    const result = Object.fromEntries(rows);
    expect(result['Cell Structure Quiz']).toBe('8 / 10');
    expect(result['Ecosystem Connections Essay']).toBe('Developing');
    expect(result['Immune System Quick Check']).toBe('Missing');
  });

  it('nothing due after today: Upcoming says so', async () => {
    const { page } = await real({
      page: Object.assign(sampleCard(TODAY).page, {
        assessments: sampleCard(TODAY).page.assessments.filter(a => a.id !== WORK.fair),
      }),
    });
    expect(segments(page)).toEqual(['Outstanding 2', 'Upcoming 0']);
    await page.click('[data-segment="upcoming"]');
    expect(page.root().querySelector('.sp-deck')).toBeNull();
    expect(page.root().querySelector('.sp-empty').textContent).toBe('Nothing coming up yet.');
  });

  it('nothing outstanding: All caught up, and See What’s Coming Up opens Upcoming', async () => {
    const { page } = await real({
      page: Object.assign(sampleCard(TODAY).page, {
        assessments: sampleCard(TODAY).page.assessments.filter(a => a.returned_at || a.id === WORK.fair),
      }),
    });
    expect(pressed(page)).toBe('Outstanding 0');
    expect(page.root().querySelector('.sp-caught-up-words').textContent).toBe('All caught up');
    expect(page.root().querySelector('.sp-caught-up [data-segment="upcoming"]').textContent).toBe(
      'See What’s Coming Up',
    );
    await page.click('.sp-caught-up [data-segment="upcoming"]');
    expect(pressed(page)).toBe('Upcoming 1');
    expect(titles(page)).toEqual(['Science Fair Proposal']);
  });

  it('nothing outstanding and nothing coming: All caught up, with no button', async () => {
    const { page } = await real({
      page: Object.assign(sampleCard(TODAY).page, {
        assessments: sampleCard(TODAY).page.assessments.filter(a => a.returned_at),
      }),
    });
    expect(pressed(page)).toBe('Outstanding 0');
    expect(page.root().querySelector('.sp-caught-up-words').textContent).toBe('All caught up');
    expect(page.root().querySelector('.sp-caught-up button')).toBeNull();
  });

  it('a segment that is not one of the two changes nothing', async () => {
    const page = await demo();
    page.root().querySelector('[data-segment="upcoming"]').setAttribute('data-segment', 'back');
    await page.click('[data-segment="back"]');
    expect(pressed(page)).toBe('Outstanding 2');
  });

  it('a row on My Learning is watched for "opened" once My Learning is showing, and told to the server once', async () => {
    const { page } = await real();
    const seen = () => page.calls.filter(c => c.body.route === 'seen').map(c => c.body.assessment_ids);
    // On Assignments nothing that came back is on screen.
    page.onScreen(() => true);
    page.advance(700);
    await page.T.tellSeen();
    await page.settle();
    expect(seen()).toEqual([]);
    await page.click('[data-tab="learning"]');
    expect(page.root().querySelectorAll('.sp-ml-work li[data-unseen]').length).toBe(6);
    page.onScreen(() => true);
    page.advance(700);
    await page.T.tellSeen();
    await page.settle();
    expect(seen()).toEqual([[WORK.energy, WORK.quiz, WORK.lab, WORK.essay, WORK.kmt, WORK.contract]]);
  });
});

describe('the page draws from student-view.js, and never throws into a draw', () => {
  it('every piece is somewhere: Outstanding, Upcoming or My Learning, in the view’s order, with its results', async () => {
    const page = await demo();
    const view = page.T.viewOf(page.T.state());
    const outstanding = titles(page);
    await page.click('[data-segment="upcoming"]');
    const upcoming = titles(page);
    await page.click('[data-tab="learning"]');
    const rows = learning(page);
    expect(outstanding.concat(upcoming).sort()).toEqual(
      view.work
        .filter(p => p.kind === 'due' || p.kind === 'missing')
        .map(p => p.title)
        .sort(),
    );
    // My Learning: everything but work still due, in the view's order (nothing sent here to go first).
    expect(rows.map(r => r[0])).toEqual(view.work.filter(p => p.kind !== 'due').map(p => p.title));
    expect(rows.filter(r => r[1] !== 'Missing').map(r => r[1])).toEqual(
      view.work.filter(p => p.kind === 'back').map(p => p.result.text),
    );
  });

  it('before the reply is here, or with student-view.js missing, a plain waiting line', async () => {
    const page = await demo();
    const s = page.T.state();
    const html = page.T.render(Object.assign({}, s, { reply: null }));
    expect(html).toContain('Opening your page…');
    expect(html).not.toContain('sp-piece');
    page.run('window.__keep = StudentView; delete window.StudentView');
    expect(page.T.render(s)).toContain('Opening your page…');
    page.run('window.StudentView = window.__keep');
  });

  it('with constants.js out of reach the list still draws: what came back shows with no result, and says so', async () => {
    const page = await demo();
    page.run('window.__keep = scoreLevelText; window.scoreLevelText = undefined');
    await page.click('[data-tab="learning"]');
    const rows = learning(page).filter(r => r[1] !== 'Missing');
    expect(rows.length).toBe(6);
    expect(rows.every(r => r[1] === '')).toBe(true);
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
  it('the class’s name with its block, and the gear (Settings) where Log Out was', async () => {
    const { page } = await real();
    const head = page.root().querySelector('.sp-view .sp-head');
    expect(head.querySelector('.sp-head-title').textContent).toBe('Science 8');
    expect(head.querySelector('.sp-pill').textContent).toBe('Block B');
    // The header holds no Log Out and no class picker: one gear, the header's last button.
    expect(head.querySelector('[data-act="logout-ask"]')).toBeNull();
    expect(head.querySelector('[data-act="classes-open"]')).toBeNull();
    const gear = [...head.querySelectorAll('button')].pop();
    expect(gear.getAttribute('data-act')).toBe('settings-open');
    expect(gear.getAttribute('aria-label')).toBe('Settings');
    expect(gear.getAttribute('aria-haspopup')).toBe('dialog');
    expect(gear.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
    // Settings is not drawn until the gear is pressed.
    expect(page.root().querySelector('.sp-set')).toBeNull();
    // The session ends only from the sheet, and no list button or search is left.
    expect(head.querySelector('[data-act="card-done"]')).toBeNull();
    expect(page.root().querySelector('[data-act="all-open"]')).toBeNull();
    expect(page.root().querySelector('#sp-search')).toBeNull();
  });

  it('Log Out asks first; Cancel, or a tap off the sheet, leaves the page as it was', async () => {
    const { page } = await real();
    const asked = page.calls.length;
    await page.click('[data-act="settings-open"]');
    await page.click('.sp-set [data-act="logout-ask"]');
    // Log Out? takes presses once it has been up a moment (a double tap is not a yes).
    page.advance(500);
    const sheet = page.root().querySelector('.sp-logout');
    expect(sheet.getAttribute('role')).toBe('alertdialog');
    expect(sheet.querySelector('#sp-logout-title').textContent).toBe('Log Out?');
    expect(sheet.querySelector('.sp-lead').textContent).toBe('You’ll need your card to open your page again.');
    // One under the other, Cancel last: where Settings' Log Out was, so a double tap cancels.
    expect([...sheet.querySelectorAll('button')].map(b => [b.textContent, b.getAttribute('data-act')])).toEqual([
      ['Log Out', 'card-done'],
      ['Cancel', 'logout-cancel'],
    ]);
    // Log Out? stands in for Settings, and Cancel goes back to the page.
    expect(page.root().querySelector('.sp-set')).toBeNull();
    await page.click('.sp-logout [data-act="logout-cancel"]');
    expect(page.root().querySelector('.sp-logout')).toBeNull();
    expect(page.root().querySelector('.sp-set')).toBeNull();
    expect(pressed(page)).toBe('Outstanding 2');
    await page.click('[data-act="settings-open"]');
    await page.click('.sp-set [data-act="logout-ask"]');
    // Log Out? takes presses once it has been up a moment (a double tap is not a yes).
    page.advance(500);
    await page.click('.sp-sheet-back[data-act="logout-cancel"]');
    expect(page.root().querySelector('.sp-logout')).toBeNull();
    expect(page.calls.length).toBe(asked);
    expect(page.T.state().screen).toBe('assignments');
  });

  it('opening another class starts it on Assignments, Outstanding', async () => {
    const page = await demo();
    await page.click('[data-tab="questionnaires"]');
    await page.click('[data-act="settings-open"]');
    await page.click('.sp-sheet [data-act="card-add"]');
    page.type('#sp-code', 'ABCD-EFGH');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    expect(page.root().querySelector('.sp-tab[aria-current="page"]').getAttribute('data-tab')).toBe('assignments');
    expect(pressed(page)).toMatch(/^Outstanding \d+$/);
    expect(page.calls).toEqual([]);
  });
});

describe('Preview as Student draws what the student page draws', () => {
  /* The teacher's preview (teacher/preview-student.js, loaded here by
     tests/setup.js) and the student page (its own context) are each handed
     the same view, and draw the same HTML. */
  it.each(['proficiency', 'letter', 'both'])('a %s class: the same HTML, character for character', async system => {
    const { page } = await real({ page: samplePage(TODAY, system) });
    const view = JSON.parse(JSON.stringify(page.T.viewOf(page.T.state())));
    // Read back through the same parser as the student page's, so both are written out alike.
    const box = page.root().ownerDocument.createElement('div');
    const same = ui => {
      box.innerHTML = globalThis.PreviewStudent.drawPage(view, ui);
      expect(box.innerHTML).toBe(page.root().querySelector('.sp-view').outerHTML);
      return box.innerHTML;
    };
    expect(same({})).toContain('Disease Research Poster');
    await page.click('[data-tab="learning"]');
    const mine = same({ tab: 'learning' });
    expect(mine).toContain('Cell Structure Quiz');
    expect(mine).toContain('8 / 10');
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
