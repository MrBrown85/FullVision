/**
 * Questionnaires and My Reports on the student's page (S4-F4; the
 * artboard's "Questionnaires Tab", "My Reports Tab", "Questions on a
 * Chromebook" and "Reports on a Chromebook").
 *
 * The server's `page` reply lists no questionnaire or report yet, and no
 * route opens one from a card's session, so a real card shows each tab's
 * plain line. The view reads the lists the reply will carry
 * (shared/student-view.js); Demo Mode shows samples in that shape and opens
 * them on the slip's own screens. No test waits on real time.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { fakeStudentSubmit, sampleCard, samplePage } from './helpers/fake-student-submit.js';

const TODAY = new Date().toISOString().slice(0, 10);
const q = (page, sel) => page.root().querySelector(sel);
const qa = (page, sel) => [...page.root().querySelectorAll(sel)];
const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

async function demo() {
  const page = openStudentPage();
  await page.start('#demo-card');
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
  return page;
}

const viewOf = page => page.T.viewOf(page.T.state());

describe('the view reads the lists the server’s page will send', () => {
  it('questionnaires by the server’s state, reports with New until opened; anything else is left out', async () => {
    const page = await real();
    const build = page.run('StudentView.build');
    const reply = Object.assign(samplePage(TODAY), {
      questionnaires: [
        {
          id: 'q1',
          title: 'Open One',
          description: 'Two questions',
          minutes: 5,
          state: 'open',
          closes_on: '2026-11-20',
        },
        { id: 'q2', title: 'Sent One', state: 'sent', sent_at: '2026-09-12T18:00:00Z' },
        { id: 'q3', title: 'Later One', state: 'not_open_yet', opens_on: '2027-03-02' },
        { id: 'q4', title: 'Closed One', state: 'closed' },
        { title: 'No Id', state: 'open' },
      ],
      reports: [
        {
          id: 'r1',
          title: 'Report 1',
          issued_at: '2026-11-20T18:00:00Z',
          expires_on: '2026-11-27',
          opened_at: null,
          overall: { word: 'Proficient', text: '3.0', level: 3 },
          comment: ['First.', 'Second.'],
        },
        { id: 'r0', title: 'Interim', issued_at: '2026-10-10T18:00:00Z', opened_at: '2026-10-11T18:00:00Z' },
      ],
    });
    const view = build(reply, 'c', () => null);
    expect(view.questionnaires.map(x => [x.id, x.state])).toEqual([
      ['q1', 'open'],
      ['q2', 'sent'],
      ['q3', 'soon'],
    ]);
    expect(view.questionnaires[0]).toMatchObject({ line: 'Two questions', minutes: 5, until: '2026-11-20' });
    expect(view.reports.map(r => [r.id, r.isNew])).toEqual([
      ['r1', true],
      ['r0', false],
    ]);
    expect(view.reports[0]).toMatchObject({ result: { word: 'Proficient', text: '3.0', level: 3 }, comment: 'First.' });
    // The reply of today has neither: both lists are empty, from either door.
    expect(viewOf(page).questionnaires).toEqual([]);
    expect(viewOf(page).reports).toEqual([]);
  });

  it('a real card shows each tab’s plain line, and Start or See Your Report pressed anyway opens nothing', async () => {
    const page = await real();
    await page.click('[data-tab="questionnaires"]');
    expect(words(q(page, '.sp-empty'))).toBe('Questionnaires from your teacher will show here.');
    await page.click('[data-tab="reports"]');
    expect(words(q(page, '.sp-page-title'))).toBe('My Reports');
    expect(words(q(page, '.sp-empty'))).toBe('Reports from your teacher will show here.');
    // A sample's id, pressed on a real card's page: nothing opens and nothing is asked.
    const asked = page.calls.length;
    for (const [act, id] of [
      ['q-start', 'demo-q-reflection'],
      ['r-open', 'demo-r-1'],
    ]) {
      const b = page.root().ownerDocument.createElement('button');
      b.setAttribute('data-act', act);
      b.setAttribute('data-form-id', id);
      q(page, '.sp-page').appendChild(b);
      await page.click('.sp-page > button[data-act="' + act + '"]');
      expect(page.T.state().screen).toBe('assignments');
    }
    expect(page.calls.length).toBe(asked);
  });
});

describe('Questionnaires in Demo Mode', () => {
  it('the open one as a card with Start, the rest as a list; on a Chromebook the list and the one picked', async () => {
    const page = await demo();
    await page.click('[data-tab="questionnaires"]');
    const card = q(page, '.sp-forms-phone .sp-form-card');
    expect(words(card.querySelector('.sp-flag'))).toMatch(/^Open until \S+ \d+$/);
    expect(words(card.querySelector('.sp-form-title'))).toBe('November Reflection');
    expect(words(card.querySelector('.sp-form-sub'))).toBe(
      'Core Competencies and your goal check-in · about 10 minutes',
    );
    expect(words(card.querySelector('[data-act="q-start"]'))).toBe('Start');
    expect(
      qa(page, '.sp-forms-phone .sp-row').map(r => [
        words(r.querySelector('.sp-row-title')),
        words(r.querySelector('.sp-row-sub')),
      ]),
    ).toEqual([
      ['About Me', expect.stringMatching(/^Sent \S+ \d+$/)],
      ['March Reflection', expect.stringMatching(/^Opens \S+ \d+$/)],
    ]);
    // The Chromebook's list: the first is picked; another picked shows its card, with no Start.
    expect(qa(page, '.sp-side-row').map(b => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    await page.click('.sp-side-row[data-form-id="demo-q-about"]');
    expect(words(q(page, '.sp-forms-desk .sp-form-title'))).toBe('About Me');
    expect(q(page, '.sp-forms-desk [data-act="q-start"]')).toBeNull();
    expect(page.calls).toEqual([]);
  });

  it('Start opens the questions with the student known; Back on the first part, and Back to Your Page after Sent, return to the tab', async () => {
    const page = await demo();
    await page.click('[data-tab="questionnaires"]');
    await page.click('.sp-forms-phone [data-act="q-start"]');
    await page.settle();
    expect(page.T.state().screen).toBe('part');
    await page.click('[data-act="back"]');
    expect(page.T.state().screen).toBe('assignments');
    expect(q(page, '.sp-tab[aria-current="page"]').getAttribute('data-tab')).toBe('questionnaires');

    await page.click('.sp-forms-phone [data-act="q-start"]');
    await page.settle();
    const parts = page.T.state().data.parts.length;
    for (let i = 1; i < parts; i++) await page.click('[data-act="next"]');
    // Demo Mode needs one answer to send.
    const text = page.T.state()
      .data.parts.flatMap(p => p.questions)
      .find(x => x.kind === 'text');
    page.T.state().answers[text.id] = 'Sample';
    await page.click('[data-act="send"]');
    await page.settle();
    expect(page.T.state().screen).toBe('sent');
    expect(words(q(page, '[data-act="page-back"]'))).toBe('Back to Your Page');
    await page.click('[data-act="page-back"]');
    expect(q(page, '.sp-tab[aria-current="page"]').getAttribute('data-tab')).toBe('questionnaires');
    expect(page.calls).toEqual([]);
  });
});

describe('My Reports in Demo Mode', () => {
  it('the newest as a card, New until opened, with its result and comment; See Your Report opens it; back to the tab', async () => {
    const page = await demo();
    await page.click('[data-tab="reports"]');
    const card = q(page, '.sp-forms-phone .sp-form-card');
    const r = viewOf(page).reports[0];
    expect(words(card.querySelector('.sp-form-title'))).toBe(r.title);
    expect(words(card.querySelector('.sp-flag-new'))).toBe('New');
    expect(words(card.querySelector('.sp-form-sub'))).toMatch(/^\S+ \d+ · Open until \S+ \d+$/);
    expect(words(card.querySelector('.sp-report-result'))).toBe('Science 8' + r.result.word);
    expect(words(card.querySelector('.sp-report-comment'))).toBe(r.comment);
    expect(qa(page, '.sp-forms-phone .sp-row-title').map(words)).toEqual(['Interim Update']);
    await page.click('.sp-forms-phone .sp-form-card [data-act="r-open"]');
    expect(page.T.state().screen).toBe('report');
    expect(q(page, '.pr-view')).toBeTruthy();
    await page.click('[data-act="page-back"]');
    expect(q(page, '.sp-tab[aria-current="page"]').getAttribute('data-tab')).toBe('reports');
    expect(page.calls).toEqual([]);
  });
});

describe('Preview as Student draws the same tabs', () => {
  it.each(['questionnaires', 'reports'])('%s: the same HTML, character for character', async tab => {
    const page = await demo();
    await page.click('[data-tab="' + tab + '"]');
    const view = JSON.parse(JSON.stringify(viewOf(page)));
    const box = page.root().ownerDocument.createElement('div');
    box.innerHTML = globalThis.PreviewStudent.drawPage(view, {
      tab,
      segment: 'todo',
      all: false,
      pick: '',
      search: '',
      filter: 'all',
      feedback: '',
      whole: false,
      levels: false,
      form: '',
      course: view.course,
      note: 'This is Demo Mode. Cece and her results are samples.',
    });
    expect(box.innerHTML).toBe(q(page, '.sp-view').outerHTML);
  });
});
