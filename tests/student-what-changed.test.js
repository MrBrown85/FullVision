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

const day = iso =>
  new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
const rowOf = (page, id) => q(page, '.sp-ml-row[data-piece="' + id + '"]');

describe('the count on My Learning', () => {
  it('shows how many pieces came back or were updated, and says it to a screen reader; Assignments has none', async () => {
    const page = await real(updatedPage());
    const changes = viewOf(page).changes;
    expect([changes.filter(c => c.why === 'back').length, changes.filter(c => c.why === 'updated').length]).toEqual([
      4, 2,
    ]);
    qa(page, '.sp-tab[data-tab="learning"]').forEach(tab => {
      expect(words(tab.querySelector('.sp-tab-badge'))).toBe('6');
      expect(tab.querySelector('.sp-tab-badge').getAttribute('aria-hidden')).toBe('true');
      expect(words(tab)).toBe('6My Learning6 new');
    });
    expect(q(page, '.sp-tab[data-tab="assignments"] .sp-tab-badge')).toBeNull();
    expect(q(page, '.sp-tab[data-tab="questionnaires"] .sp-tab-badge')).toBeNull();
    expect(q(page, '.sp-tab[data-tab="reports"]')).toBeNull();
    expect(page.calls.filter(c => c.body.route !== 'seen').map(c => c.body.route)).toEqual([
      'card',
      'verify',
      'page',
      'bulletins',
      'work',
      'forms',
    ]);
  });

  it('one thing reads in the singular; work returned for revision counts on Assignments', async () => {
    const reply = seenPage();
    reply.assessments.find(a => a.id === WORK.quiz).seen_at = null;
    const page = await real(reply);
    expect(words(q(page, '.sp-tabs-bottom .sp-tab[data-tab="learning"]'))).toBe('1My Learning1 new');
    const html = page.run('StudentPageView.html');
    const box = page.root().ownerDocument.createElement('div');
    box.innerHTML = html(Object.assign({}, viewOf(page), { changes: [{ id: 'x', title: 'X', why: 'revise' }] }), {});
    expect(words(box.querySelector('.sp-tabs-bottom .sp-tab[data-tab="assignments"]'))).toBe('1Assignments1 new');
    expect(box.querySelector('.sp-tab[data-tab="learning"] .sp-tab-badge')).toBeNull();
  });

  it('with nothing changed: no count on any tab, and no row marked New', async () => {
    const page = await real(seenPage());
    expect(viewOf(page).changes).toEqual([]);
    expect(q(page, '.sp-tab-badge')).toBeNull();
    await page.click('.sp-tabs-bottom [data-tab="learning"]');
    expect(q(page, '.sp-ml-new-on')).toBeNull();
    expect(q(page, '[data-unseen]')).toBeNull();
  });
});

describe('Your Work marks what is new', () => {
  it('each piece back or updated since the student last looked has the blue dot and says New, until it is opened', async () => {
    const page = await real(updatedPage());
    await page.click('.sp-tabs-bottom [data-tab="learning"]');
    const changes = viewOf(page).changes;
    const marked = qa(page, '.sp-ml-work li')
      .filter(li => li.querySelector('.sp-ml-new-on'))
      .map(li => li.getAttribute('data-unseen'));
    expect(marked.sort()).toEqual(changes.map(c => c.id).sort());
    marked.forEach(id => expect(words(rowOf(page, id).querySelector('.sp-hidden-title'))).toBe('New'));
    // The rest (here the Missing Quick Check) carry no dot and are not watched.
    const plain = qa(page, '.sp-ml-work li').filter(li => !li.querySelector('.sp-ml-new-on'));
    expect(plain.map(li => words(li.querySelector('.sp-row-title')))).toEqual(['Immune System Quick Check']);
    plain.forEach(li => expect(li.hasAttribute('data-unseen')).toBe(false));
  });
});

describe('a returned grade that was updated', () => {
  it('its row says Updated, the day, and what it was; Your Feedback shows Was beside the level that moved', async () => {
    const page = await real(updatedPage());
    await page.click('.sp-tabs-bottom [data-tab="learning"]');
    const p = viewOf(page).work.find(x => x.id === WORK.energy);
    expect(p.updated).toBe(true);
    expect(p.competencies[0].was).toBe('Developing');
    const row = rowOf(page, WORK.energy);
    // The view gives a was only to a result that is the whole grade (points, Complete); here the competency moved.
    expect(p.result.was).toBeUndefined();
    expect(words(row.querySelector('.sp-row-sub'))).toBe('Updated ' + day(p.updatedAt));
    expect(words(row.querySelector('.sp-level'))).toBe(p.result.text);
    expect(row.getAttribute('data-act')).toBe('feedback');
    await page.click('.sp-ml-row[data-piece="' + WORK.energy + '"]');
    expect(words(q(page, '.sp-fb-sub'))).toBe('Updated ' + day(p.updatedAt));
    expect(words(q(page, '.sp-fb-row .sp-was'))).toBe('Was Developing');
  });

  it('a result-only piece (Complete) says what it was (Demo Mode’s Lab Safety Contract)', async () => {
    const page = openStudentPage();
    await page.start('#demo-card');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    await page.click('.sp-tabs-bottom [data-tab="learning"]');
    const p = viewOf(page).work.find(x => x.title === 'Lab Safety Contract');
    expect(p.updated).toBe(true);
    expect(p.result).toMatchObject({ kind: 'complete', text: 'Complete', was: 'Incomplete' });
    const row = rowOf(page, p.id);
    expect(words(row.querySelector('.sp-row-sub'))).toBe('Updated ' + day(p.updatedAt) + ' · was Incomplete');
    expect(words(row.querySelector('.sp-level'))).toBe('Complete');
  });

  it('a level that did not move has no Was; a piece not updated has neither', async () => {
    const page = await real(updatedPage());
    const work = viewOf(page).work;
    const lab = work.find(x => x.id === WORK.lab);
    expect(lab.updated).toBe(false);
    expect(lab.rubric.rows.some(r => 'was' in r)).toBe(false);
    expect(lab.updatedAt).toBeUndefined();
    await page.click('.sp-tabs-bottom [data-tab="learning"]');
    expect(words(rowOf(page, WORK.lab).querySelector('.sp-row-sub'))).toBe('Returned ' + day(lab.returnedAt));
  });
});

describe('Preview as Student draws the same', () => {
  it.each([
    ['My Learning', { tab: 'learning' }],
    ['the updated piece’s feedback', { tab: 'learning', feedback: WORK.energy }],
  ])('%s: the same HTML, character for character', async (name, ui) => {
    const page = await real(updatedPage());
    Object.assign(page.T.state(), { tab: 'assignments', segment: 'outstanding' }, ui);
    page.run('StudentPage.paint')();
    const view = JSON.parse(JSON.stringify(viewOf(page)));
    const box = page.root().ownerDocument.createElement('div');
    box.innerHTML = globalThis.PreviewStudent.drawPage(
      view,
      Object.assign({ tab: 'assignments', segment: 'outstanding' }, ui),
    );
    expect(box.innerHTML).toBe(q(page, '.sp-view').outerHTML);
  });
});
