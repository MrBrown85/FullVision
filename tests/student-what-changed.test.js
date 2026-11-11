/**
 * What Changed Since You Last Looked (S4-F5; the artboard's "What Changed
 * Since You Last Looked" and "A Returned Grade Was Updated"), drawn by
 * s/page-view.js from the view's `changes` and each piece's `updated`.
 *
 * A piece counts as changed when it came back, or its returned grade was
 * changed, after the student last opened it (the server's seen_at). The
 * page runs as a browser loads it (tests/helpers/student-page-context.js),
 * against the student-submit function's real handler over a stand-in
 * database. No test waits on real time.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { TAGS, WORK, fakeStudentSubmit, sampleCard, samplePage } from './helpers/fake-student-submit.js';

const TODAY = new Date().toISOString().slice(0, 10);
const q = (page, sel) => page.root().querySelector(sel);
const qa = (page, sel) => [...page.root().querySelectorAll(sel)];
const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

async function real(reply) {
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY, reply ? { page: reply } : undefined)] });
  const page = openStudentPage();
  page.server = body => fn.handle(body);
  await page.start('#P3R8-WDK4');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  return page;
}
const viewOf = page => page.T.viewOf(page.T.state());
const copy = part =>
  Object.assign({ v: 1, value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] }, part);
const at = days => {
  const t = new Date(TODAY + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10) + 'T20:15:00+00:00';
};

// The sample page with Energy Transfer's level changed from Developing to Extending after Cece had opened it.
function updatedPage() {
  const reply = samplePage(TODAY);
  const energy = reply.assessments.find(a => a.id === WORK.energy);
  Object.assign(energy, {
    seen_at: at(-5),
    updated_at: at(-2),
    previous: copy({ comment: energy.grade.comment, tags: { [TAGS.data]: { value: 2, modifier: 0, comment: null } } }),
  });
  return reply;
}

// Every piece already opened: nothing has changed.
function seenPage() {
  const reply = samplePage(TODAY);
  reply.assessments.forEach(a => {
    if (a.returned_at) a.seen_at = at(1);
  });
  return reply;
}

describe('All Assignments: N Things Since You Last Looked', () => {
  it('the count and what they are, a New filter, and Returned on each piece back since', async () => {
    const page = await real(updatedPage());
    await page.click('[data-act="all-open"]');
    const changes = viewOf(page).changes;
    const back = changes.filter(c => c.why === 'back').length;
    const updated = changes.filter(c => c.why === 'updated').length;
    expect([back, updated]).toEqual([4, 2]);
    expect(words(q(page, '.sp-since-title'))).toBe('6 Things Since You Last Looked');
    expect(words(q(page, '.sp-since-line'))).toBe('4 pieces came back and 2 results were updated.');
    expect(words(qa(page, '.sp-filter').pop())).toBe('New 6');
    await page.click('[data-filter="new"]');
    expect(qa(page, '.sp-row-title').map(words).sort()).toEqual(changes.map(c => c.title).sort());
    const flagged = qa(page, '.sp-row')
      .filter(r => r.querySelector('.sp-row-flag'))
      .map(r => words(r.querySelector('.sp-row-title')));
    expect(flagged.sort()).toEqual(
      changes
        .filter(c => c.why === 'back')
        .map(c => c.title)
        .sort(),
    );
    expect(words(q(page, '.sp-row-flag'))).toBe('Returned');
    expect(page.calls.filter(c => c.body.route !== 'seen').map(c => c.body.route)).toEqual([
      'card',
      'verify',
      'page',
      'work',
    ]);
  });

  it('one thing reads in the singular', async () => {
    const reply = seenPage();
    reply.assessments.find(a => a.id === WORK.quiz).seen_at = null;
    const page = await real(reply);
    await page.click('[data-act="all-open"]');
    expect(words(q(page, '.sp-since'))).toBe('1 Thing Since You Last Looked1 piece came back.');
  });

  it('with nothing changed: no line, no New filter, no count on the tab; a New filter left over shows everything', async () => {
    const page = await real(seenPage());
    await page.click('[data-act="all-open"]');
    expect(viewOf(page).changes).toEqual([]);
    expect(q(page, '.sp-since')).toBeNull();
    expect(qa(page, '.sp-filter').map(words)).toEqual(['All', 'To Do', 'Sent', 'Back']);
    expect(q(page, '.sp-tab-badge')).toBeNull();
    const html = page.run('StudentPageView.html');
    expect(html(viewOf(page), { all: true, filter: 'new' })).toBe(html(viewOf(page), { all: true, filter: 'all' }));
  });
});

describe('the count on Assignments', () => {
  it('shows how many things changed, and says it to a screen reader', async () => {
    const page = await real(updatedPage());
    const n = viewOf(page).changes.length;
    qa(page, '.sp-tab[data-tab="assignments"]').forEach(tab => {
      expect(words(tab.querySelector('.sp-tab-badge'))).toBe(String(n));
      expect(tab.querySelector('.sp-tab-badge').getAttribute('aria-hidden')).toBe('true');
      expect(words(tab)).toBe(n + 'Assignments' + n + ' new');
    });
    expect(q(page, '.sp-tab[data-tab="reports"] .sp-tab-badge')).toBeNull();
  });
});

describe('a returned grade that was updated', () => {
  it('its card says Updated and the day, Was beside the level that moved, and what moved', async () => {
    const page = await real(updatedPage());
    await page.click('[data-segment="back"]');
    const energy = qa(page, '.sp-deck .sp-piece').find(c => c.getAttribute('data-piece') === WORK.energy);
    const p = viewOf(page).work.find(x => x.id === WORK.energy);
    expect(p.updated).toBe(true);
    expect(words(energy.querySelector('.sp-flag'))).toMatch(/^Updated \S+ \d+$/);
    expect(energy.querySelector('.sp-flag-back')).toBeNull();
    expect(words(energy.querySelector('.sp-was'))).toBe('Was Developing');
    expect(p.competencies[0].was).toBe('Developing');
    expect(words(energy.querySelector('.sp-updated-title'))).toMatch(/^Your result was updated on \S+ \d+$/);
    expect(words(energy.querySelector('.sp-updated-line'))).toBe(
      'Processing and Analyzing Data went from Developing to Extending.',
    );
    // Your Feedback shows it too.
    await page.click('.sp-piece[data-piece="' + WORK.energy + '"] [data-act="feedback"]');
    expect(words(q(page, '.sp-fb-row .sp-was'))).toBe('Was Developing');
  });

  it('a level that did not move has no Was; a piece not updated has neither', async () => {
    const page = await real(updatedPage());
    const work = viewOf(page).work;
    const lab = work.find(x => x.id === WORK.lab);
    expect(lab.updated).toBe(false);
    expect(lab.rubric.rows.some(r => 'was' in r)).toBe(false);
    expect(lab.updatedAt).toBeUndefined();
  });
});

describe('Preview as Student draws the same', () => {
  it.each([
    ['All Assignments, New', { all: true, filter: 'new' }],
    ['the updated card', { segment: 'back', pick: WORK.energy }],
  ])('%s: the same HTML, character for character', async (name, ui) => {
    const page = await real(updatedPage());
    Object.assign(page.T.state(), { tab: 'assignments', segment: 'todo', all: false, filter: 'all' }, ui);
    page.run('StudentPage.paint')();
    const view = JSON.parse(JSON.stringify(viewOf(page)));
    const box = page.root().ownerDocument.createElement('div');
    box.innerHTML = globalThis.PreviewStudent.drawPage(
      view,
      Object.assign({ tab: 'assignments', segment: 'todo', all: false, filter: 'all' }, ui),
    );
    expect(box.innerHTML).toBe(q(page, '.sp-view').outerHTML);
  });
});
