/**
 * Reflect on the student's page (S4-F4; the artboard's "Questionnaires
 * Tab" and "Questions on a Chromebook"; the tab called Questionnaires until
 * Colin's ruling of 2026-11-14). Phone reports are not on the student page
 * any more (Colin, 2026-11-14): no Reports tab, and the reply's `reports`
 * is not read.
 *
 * The server's `page` reply lists no questionnaire yet, so a real card
 * shows the tab's plain line. The view reads the list the reply will carry
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
  it('questionnaires by the server’s state, anything else left out; phone reports not read', async () => {
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
    // Phone reports in the reply are not read: the page has no place for them.
    expect(view).not.toHaveProperty('reports');
    // The reply of today has none: the list is empty, from either door.
    expect(viewOf(page).questionnaires).toEqual([]);
    expect(viewOf(page)).not.toHaveProperty('reports');
  });

  it('a real card shows the plain line on Reflect, has no Reports tab, and Start or See Your Report pressed anyway opens nothing', async () => {
    const page = await real();
    expect(qa(page, '.sp-tabs-bottom .sp-tab-label').map(words)).toEqual([
      'Bulletins',
      'Assignments',
      'My Learning',
      'Reflect',
    ]);
    expect(q(page, '[data-tab="reports"]')).toBeNull();
    await page.click('[data-tab="questionnaires"]');
    expect(words(q(page, '.sp-page-title'))).toBe('Reflect');
    expect(words(q(page, '.sp-empty'))).toBe('Reflections from your teacher will show here.');
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

describe('Reflect in Demo Mode', () => {
  it('Open Now as a card with Start, then Done and Coming Up as lists; on a Chromebook the list and the one picked', async () => {
    const page = await demo();
    await page.click('[data-tab="questionnaires"]');
    expect(words(q(page, '.sp-page-title'))).toBe('Reflect');
    expect(qa(page, '.sp-forms-phone .sp-list-head').map(words)).toEqual(['Open Now', 'Done', 'Coming Up']);
    // Each part holds its own: the open one under Open Now, About Me under Done, March under Coming Up.
    const under = head => {
      const h = qa(page, '.sp-forms-phone .sp-list-head').find(x => words(x) === head);
      const out = [];
      for (let el = h.nextElementSibling; el && !el.matches('.sp-list-head'); el = el.nextElementSibling) {
        out.push(...[...el.querySelectorAll('.sp-form-title, .sp-row-title')].map(words));
      }
      return out;
    };
    expect(under('Open Now')).toEqual(['November Reflection', 'Unit 2 Exit Reflection']);
    expect(under('Done')).toEqual(['About Me']);
    expect(under('Coming Up')).toEqual(['March Reflection']);
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
    expect(qa(page, '.sp-side-row').map(b => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
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

describe('no phone reports in Demo Mode', () => {
  it('no Reports tab, nothing of a report on the page, and See Your Report pressed anyway opens nothing', async () => {
    const page = await demo();
    expect(q(page, '[data-tab="reports"]')).toBeNull();
    expect(page.root().textContent).not.toContain('My Reports');
    const b = page.root().ownerDocument.createElement('button');
    b.setAttribute('data-act', 'r-open');
    b.setAttribute('data-form-id', 'demo-r-1');
    q(page, '.sp-page').appendChild(b);
    await page.click('.sp-page > button[data-act="r-open"]');
    expect(page.T.state().screen).toBe('assignments');
    expect(q(page, '.pr-view')).toBeNull();
    expect(page.calls).toEqual([]);
  });
});

describe('Preview as Student draws the same tab', () => {
  it('Reflect: the same HTML, character for character', async () => {
    const page = await demo();
    await page.click('[data-tab="questionnaires"]');
    const view = JSON.parse(JSON.stringify(viewOf(page)));
    const box = page.root().ownerDocument.createElement('div');
    box.innerHTML = globalThis.PreviewStudent.drawPage(view, {
      tab: 'questionnaires',
      segment: 'outstanding',
      pick: '',
      card: '',
      logout: false,
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
