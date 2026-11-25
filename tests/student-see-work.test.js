/**
 * See Your Work from My Learning (DECISIONS, "See Your Work from My
 * Learning (2026-11-18)"; s/page-view.js, s/feedback.js, s/send.js,
 * shared/student-view.js): every piece with pages in opens them, sent by
 * the student or added by the teacher, with the marks drawn over them only
 * where the student was given marks.
 *
 * - A row with feedback opens Your Feedback, which offers See Your Work
 *   when there are pages ("2 pages"; with marks, the old line).
 * - A row with pages and no feedback opens See Your Work; Back goes to the
 *   row. A row with neither stays still.
 * - The card of work sent has See Your Work under its photos.
 * - The page counts come from `work` (Send Work on or off) and the
 *   `feedback` reply's marks; on paper is no pages.
 * - A real card fetches each page once from the link its own session was
 *   given, and shows it from a blob: address; only the newest version.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { openStudentPage } from './helpers/student-page-context.js';
import { CECE, OMAR, WORK, fakeStudentSubmit, sampleCard } from './helpers/fake-student-submit.js';
import { C1, PAGE_JPEG } from './helpers/fake-send-world.js';

const TODAY = new Date().toLocaleDateString('en-CA');
const q = (page, sel) => page.root().querySelector(sel);
const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const viewOf = page => page.T.viewOf(page.T.state());
const pieceOf = (page, id) => viewOf(page).work.find(p => p.id === id);
const row = id => '.sp-ml-row[data-piece="' + id + '"]';

async function demo(hash) {
  const page = openStudentPage();
  await page.start(hash || '#demo-card-send');
  await page.submit('form[data-form="card"]');
  page.type('#sp-ident', page.T.DEMO.number);
  await page.click('[data-act="card-yes"]');
  return page;
}

describe('Demo Mode (#demo-card-send): pages with marks, pages without, and neither', () => {
  it('counts the pages in on each returned piece', async () => {
    const page = await demo();
    const pages = Object.fromEntries(viewOf(page).work.map(p => [p.id, p.pages]));
    expect(pages).toMatchObject({ 'demo-lab': 1, 'demo-energy': 1, 'demo-quiz': 2, 'demo-kmt': 0, 'demo-poster': 0 });
  });

  it('the scanned quiz (added by the teacher, no marks): Your Feedback, then its two pages, no Show Marks', async () => {
    const page = await demo();
    await page.click('[data-tab="learning"]');
    await page.click(row('demo-quiz'));
    expect(words(q(page, '#sp-fb-title'))).toBe('Cell Structure Quiz');
    expect(words(q(page, '[data-act="work"] .sp-fb-work-line'))).toBe('2 pages');
    await page.click('[data-act="work"]');
    expect(words(q(page, '.sp-work .sp-fb-sub'))).toBe('Page 1 of 2');
    expect(q(page, '.sp-work-img').getAttribute('src')).toBe('../assets/sample-work/cell-quiz-cece-1.jpg');
    expect(q(page, '[data-act="work-marks"]')).toBeNull();
    await page.click('[aria-label="Next Page"]');
    expect(words(q(page, '.sp-work .sp-fb-sub'))).toBe('Page 2 of 2');
    expect(q(page, '.sp-work-img').getAttribute('src')).toBe('../assets/sample-work/cell-quiz-cece-2.jpg');
    // A press made up for Show Marks does nothing on a piece with no marks.
    expect(StudentPageView.press(page.T.state(), viewOf(page), 'work-marks', null)).toBeNull();
    await page.click('[data-act="work-close"]');
    expect(words(q(page, '#sp-fb-title'))).toBe('Cell Structure Quiz');
  });

  it('the lab keeps its marks line and its marks', async () => {
    const page = await demo();
    await page.click('[data-tab="learning"]');
    await page.click(row('demo-lab'));
    expect(words(q(page, '[data-act="work"] .sp-fb-work-line'))).toBe('1 page · 3 notes on your work');
    await page.click('[data-act="work"]');
    expect(page.root().querySelectorAll('.sp-work-over .sp-work-pin')).toHaveLength(3);
    expect(q(page, '[data-act="work-marks"]').getAttribute('aria-checked')).toBe('true');
  });

  it('a piece with neither pages nor marks has no See Your Work', async () => {
    const page = await demo();
    await page.click('[data-tab="learning"]');
    await page.click(row('demo-kmt'));
    expect(words(q(page, '#sp-fb-title'))).toBe('KMT & States of Matter Lab');
    expect(q(page, '[data-act="work"]')).toBeNull();
  });

  it('Send Work off (#demo-card): as it was, no pages', async () => {
    const page = await demo('#demo-card');
    expect(viewOf(page).work.every(p => p.pages === 0)).toBe(true);
  });
});

describe('the view: where the page counts come from', () => {
  const reply = {
    student: { enrollment_id: 'e1', first_name: 'Ada' },
    course: {},
    assessments: [
      { id: 'a1', title: 'Back', date: '2026-11-01', returned_at: '2026-11-03T18:00:00Z', grade: { v: 1, value: 3 } },
      { id: 'a2', title: 'To Do', date: '2026-11-01', due_date: '2099-01-01' },
      { id: 'a3', title: 'Paper', date: '2026-11-01', returned_at: '2026-11-03T18:00:00Z', grade: { v: 1, value: 2 } },
    ],
  };
  const sent = (id, more) => ({ id, students_send: 'nothing', sent: Object.assign({ pages: 2 }, more) });

  it('Send Work off: the counts only; nothing of sending, and work still to do stays to do', () => {
    const work = { ok: true, v: 1, send_work: false, assessments: [sent('a1'), sent('a2', { sent_by: 'teacher' })] };
    const v = StudentView.build(reply, 'c', null, work, null);
    const a1 = v.work.find(p => p.id === 'a1');
    const a2 = v.work.find(p => p.id === 'a2');
    expect([a1.pages, a1.send, a2.pages, a2.send, a2.kind]).toEqual([2, null, 2, null, 'due']);
  });

  it('work on paper has no pages; the marks’ work_pages count; a count of the wrong shape is none', () => {
    const work = { ok: true, v: 1, send_work: true, assessments: [sent('a3', { on_paper: true, pages: 0 })] };
    const fb = { ok: true, assessments: [{ id: 'a1', marks: { pages: 1, notes: 0, work_pages: 3 } }] };
    const v = StudentView.build(reply, 'c', null, work, fb);
    expect(v.work.find(p => p.id === 'a3').pages).toBe(0);
    expect(v.work.find(p => p.id === 'a1').pages).toBe(3);
    const odd = { ok: true, send_work: false, assessments: [sent('a1', { pages: '4' }), sent('a3', { pages: -1 })] };
    expect(StudentView.build(reply, 'c', null, odd, null).work.map(p => p.pages)).toEqual([0, 0, 0]);
  });
});

describe('the rows: pages and no feedback open See Your Work straight away', () => {
  const piece = more =>
    Object.assign(
      {
        id: 'x1',
        title: 'Field Notes',
        date: '2026-11-01',
        dueDate: '2026-11-02',
        kind: 'excused',
        result: { kind: 'none', text: '', word: '' },
        pages: 2,
        marks: null,
        group: null,
        send: null,
        resources: [],
      },
      more,
    );
  const viewWith = p => ({ course: { gradingSystem: 'proficiency' }, today: '2026-11-18', work: [p], counts: {} });
  const html = (view, ui) =>
    parseHTML('<main>' + StudentPageView.html(view, Object.assign({ tab: 'learning' }, ui)) + '</main>').document;
  const btn = (act, id) => ({ getAttribute: n => (n === 'data-piece' ? id : n === 'data-act' ? act : '') });

  it('an Excused piece with pages: its row opens See Your Work, and Back goes to the row', () => {
    const view = viewWith(piece());
    const el = html(view, {});
    expect(el.querySelector(row('x1')).getAttribute('data-act')).toBe('work');
    const out = StudentPageView.press({ tab: 'learning' }, view, 'work', btn('work', 'x1'));
    expect(out).toMatchObject({ work: 'x1', ui: { work: 'x1', feedback: '', tab: 'learning' } });
    const open = html(view, Object.assign({}, out.ui, { workPages: { id: 'x1', state: 'loading', pages: [] } }));
    expect(words(open.querySelector('#sp-work-title'))).toBe('Field Notes');
    expect(words(open.querySelector('.sp-work [role="status"]'))).toBe('Getting your work…');
    const back = StudentPageView.press(out.ui, view, 'work-close', null);
    expect(back.focus).toBe('.sp-ml-row[data-piece="x1"]');
    expect(html(view, back.ui).querySelector('.sp-ml-work')).toBeTruthy();
  });

  it('a returned piece with no result and pages does the same; with no pages its row stays still', () => {
    const back = piece({ kind: 'back', returnedAt: '2026-11-03T18:00:00Z' });
    expect(html(viewWith(back), {}).querySelector(row('x1')).getAttribute('data-act')).toBe('work');
    const none = piece({ kind: 'back', pages: 0 });
    const el = html(viewWith(none), {});
    expect(el.querySelector('.sp-ml-row-still')).toBeTruthy();
    expect(StudentPageView.press({}, viewWith(none), 'work', btn('work', 'x1'))).toBeNull();
  });

  it('the card of work sent has See Your Work; Back from it goes to the card', () => {
    const p = piece({ kind: 'sent', send: { takes: 'photos', open: true, sent: { at: '', pages: 2, thumbs: [] } } });
    const view = viewWith(p);
    const card = StudentPageView.press({ tab: 'learning' }, view, 'open-piece', btn('open-piece', 'x1'));
    const el = html(view, card.ui);
    expect(words(el.querySelector('.sp-ml-card-open [data-act="work"] .sp-fb-work-line'))).toBe('2 pages');
    const out = StudentPageView.press(card.ui, view, 'work', btn('work', 'x1'));
    expect(out.ui).toMatchObject({ work: 'x1', card: 'x1', feedback: '' });
    const back = StudentPageView.press(out.ui, view, 'work-close', null);
    expect(back).toMatchObject({ focus: '[data-act="work"]', ui: { card: 'x1', work: '' } });
  });

  it('the line: "1 page", "2 pages"; with marks, the marks’ line', () => {
    expect(StudentPageView.pagesLine(1)).toBe('1 page');
    expect(StudentPageView.pagesLine(2)).toBe('2 pages');
    expect(StudentPageView.canSeeWork({ pages: 0, marks: null })).toBe(false);
    expect(StudentPageView.canSeeWork({ pages: 0, marks: { pages: 1, notes: 0 } })).toBe(true);
  });
});

/* A real card, against the function's own handler and routes over a
   stand-in database and bucket. The teacher scanned Cece's quiz in (Add
   Work for the Class): pages handed in by the teacher, on returned work. */
let made = 0;
function handIn(world, assessment, enrollment, opts) {
  made += 1;
  const n = String(made).padStart(4, '0');
  const id = `5b${n}00-0000-4000-8000-000000000000`;
  const files = [];
  for (let i = 1; i <= (opts.pages || 1); i++) {
    const file = `f2${n}0${i}-0000-4000-8000-000000000000`;
    const base = `${C1}/${assessment}/${enrollment}/${id}/${file}`;
    files.push({ id: file, page: i, path: base + '.jpg', thumb_path: base + '-thumb.jpg', added_by: opts.by });
    for (const p of [base + '.jpg', base + '-thumb.jpg']) {
      world.objects.set(p, { bytes: PAGE_JPEG, type: 'image/jpeg', cache: 'private' });
    }
  }
  world.subs.set(id, {
    id,
    course: C1,
    assessment,
    enrollment,
    state: 'sent',
    intent: 'new',
    sent_by: opts.by,
    request_id: `9f${n}00-0000-4000-8000-000000000000`,
    note: null,
    version: opts.version || 1,
    sent_at: '2026-11-01T19:00:00+00:00',
    files,
  });
  return id;
}

function school() {
  const fn = fakeStudentSubmit({
    cards: [sampleCard(TODAY)],
    sendWork: { [WORK.quiz]: { students_send: 'nothing', open: false } },
  });
  const dev = { fn, store: {}, downloads: [] };
  dev.open = async () => {
    const page = openStudentPage({ store: dev.store, objectUrls: true });
    page.server = body => fn.handle(body);
    page.storage = async url => {
      dev.downloads.push(url);
      const got = fn.world.phoneDownload(url);
      return { status: got.status, blob: got.bytes && { size: got.bytes.length } };
    };
    await page.start('#P3R8-WDK4');
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    await page.settle();
    return page;
  };
  return dev;
}

describe('a real card: the pages come from its own session, as pictures on the device', () => {
  it('the teacher’s scan of a returned quiz: Your Feedback, See Your Work "2 pages", each page fetched once', async () => {
    const dev = school();
    handIn(dev.fn.world, WORK.quiz, CECE, { by: 'teacher', pages: 2 });
    // Omar's work on the same piece is never Cece's to see.
    handIn(dev.fn.world, WORK.quiz, OMAR, { by: 'student', pages: 1 });
    const page = await dev.open();
    expect(pieceOf(page, WORK.quiz).pages).toBe(2);
    await page.click('.sp-tabs-bottom [data-tab="learning"]');
    await page.click(row(WORK.quiz));
    expect(words(q(page, '[data-act="work"] .sp-fb-work-line'))).toBe('2 pages');
    await page.click('[data-act="work"]');
    await page.settle();
    const asks = page.calls.filter(c => c.body.route === 'file-links').map(c => c.body);
    expect(asks).toEqual([expect.objectContaining({ enrollment_id: CECE, assessment_id: WORK.quiz })]);
    // Only Cece's pages were signed and fetched: Omar's are not in the answer.
    expect(dev.downloads.filter(u => !/-thumb\.jpg/.test(u))).toHaveLength(2);
    expect(dev.downloads.every(u => u.includes('/' + CECE + '/'))).toBe(true);
    expect(page.T.state().workPages).toMatchObject({ id: WORK.quiz, state: 'ready' });
    expect(q(page, '.sp-work-img').getAttribute('src')).toMatch(/^blob:/);
    expect(words(q(page, '.sp-work .sp-fb-sub'))).toBe('Page 1 of 2');
  });

  it('a revision sent: only the newest version shows', async () => {
    const dev = school();
    handIn(dev.fn.world, WORK.quiz, CECE, { by: 'student', pages: 2, version: 1 });
    handIn(dev.fn.world, WORK.quiz, CECE, { by: 'student', pages: 1, version: 2 });
    const page = await dev.open();
    await page.click('.sp-tabs-bottom [data-tab="learning"]');
    await page.click(row(WORK.quiz));
    await page.click('[data-act="work"]');
    await page.settle();
    expect(page.T.state().workPages.pages).toHaveLength(1);
  });

  it('a picture that does not come is Try Again, never an empty screen', async () => {
    const dev = school();
    handIn(dev.fn.world, WORK.quiz, CECE, { by: 'teacher', pages: 1 });
    const page = await dev.open();
    page.storage = async () => ({ status: 403 });
    await page.click('.sp-tabs-bottom [data-tab="learning"]');
    await page.click(row(WORK.quiz));
    await page.click('[data-act="work"]');
    await page.settle();
    expect(page.T.state().workPages.state).toBe('failed');
    expect(q(page, '[data-act="work-retry"]')).toBeTruthy();
  });

  it('another student’s pages, asked for through this session, are refused by the function', async () => {
    const dev = school();
    handIn(dev.fn.world, WORK.quiz, OMAR, { by: 'student', pages: 1 });
    const page = await dev.open();
    const session = page.calls.find(c => c.body.route === 'work').body.session;
    const theirs = await dev.fn.handle({
      route: 'file-links',
      session,
      enrollment_id: OMAR,
      assessment_id: WORK.quiz,
    });
    expect(theirs).toMatchObject({ ok: false, error: 'not_found' });
    const mine = await dev.fn.handle({ route: 'file-links', session, enrollment_id: CECE, assessment_id: WORK.quiz });
    expect(mine).toEqual({ ok: true, files: [] });
    // Nothing in: Cece's quiz has no See Your Work.
    expect(pieceOf(page, WORK.quiz).pages).toBe(0);
  });
});
