/**
 * See Your Work, with Show Marks (S9-F3; s/feedback.js, s/page-view.js,
 * shared/student-view.js): the teacher's Mark Up on the student's page.
 *
 * - Only on returned work, only the copy given at Return: a mark the
 *   teacher made or erased since waits on the working copy, which never
 *   reaches the page; a draft's marks never do.
 * - Students See Your Mark Up off, Missing or Excused: nothing.
 * - Show Marks turns the marks off and on; the photo is shown as sent.
 * - Every answer draws only while See Your Work is still open on the same
 *   piece, for the same student, from the same ask; a reply of the wrong
 *   kind shows Try Again, never a stuck screen.
 * - Preview as Student shows the same, from the teacher's cache.
 *
 * Demo Mode only (#demo-card-send). Nothing is sent anywhere.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';

const q = (page, sel) => page.root().querySelector(sel);
const qa = (page, sel) => [...page.root().querySelectorAll(sel)];
const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

async function demo(hash) {
  const page = openStudentPage();
  await page.start(hash || '#demo-card-send');
  await page.submit('form[data-form="card"]');
  page.type('#sp-ident', page.T.DEMO.number);
  await page.click('[data-act="card-yes"]');
  return page;
}

const viewOf = page => page.T.viewOf(page.T.state());
const piece = (page, title) => viewOf(page).work.find(p => p.title === title);

async function openFeedback(page, title) {
  await page.click('[data-segment="back"]');
  const p = piece(page, title);
  await page.click('.sp-piece[data-piece="' + p.id + '"] [data-act="feedback"]');
  return p;
}

async function openWork(page, title) {
  await openFeedback(page, title || 'Cell Microscope Lab');
  await page.click('[data-act="work"]');
}

// A promise the test settles itself.
function held() {
  let settle;
  const promise = new Promise(r => (settle = r));
  return { promise, settle };
}

const LAB_NOTES = [
  'Careful drawing: the rows show each cell wall.',
  'Label the membrane on one more cell.',
  'Good: you said why the nucleus was easier to see.',
];

describe('Send Work off (#demo-card, and every class until Batch C): nothing of Mark Up shows', () => {
  it('no See Your Work, no feedback reply, nothing asked', async () => {
    const page = await demo('#demo-card');
    expect(page.T.feedbackOf(page.T.state())).toBeNull();
    await openFeedback(page, 'Cell Microscope Lab');
    expect(q(page, '[data-act="work"]')).toBeNull();
    expect(viewOf(page).work.every(p => p.marks === null)).toBe(true);
    expect(page.calls).toEqual([]);
  });
});

describe('S9-F3: the marks the student was given, on returned work only', () => {
  it('the stand-in sends the given copy only: 3 notes, not the note added since', async () => {
    const page = await demo();
    const fb = page.T.feedbackOf(page.T.state());
    expect(fb).toMatchObject({ ok: true, v: 1 });
    // Energy Transfer hides its marks; the poster is a draft never returned.
    expect(fb.assessments).toEqual([
      { id: 'demo-lab', marks: { pages: 1, notes: 3 }, revision: null, reflection: null },
    ]);
    const working = page.T.demoMarkup()['demo-lab'].pages[0].working.marks.filter(m => m.type === 'note');
    expect(working).toHaveLength(4);
    expect(working.map(m => m.text)).toContain('Add the date you did the lab.');
  });

  it('Your Feedback has See Your Work with the board’s line; no other piece has it', async () => {
    const page = await demo();
    await openFeedback(page, 'Cell Microscope Lab');
    const b = q(page, '[data-act="work"]');
    expect(words(b.querySelector('.sp-fb-work-title'))).toBe('See Your Work');
    expect(words(b.querySelector('.sp-fb-work-line'))).toBe('1 page · 3 notes on your work');
    const marked = viewOf(page).work.filter(p => p.marks);
    expect(marked.map(p => p.title)).toEqual(['Cell Microscope Lab']);
  });

  it('See Your Work: the title, the page, the given marks over it, the notes by number', async () => {
    const page = await demo();
    await openWork(page);
    expect(page.T.state().work).toBe('demo-lab');
    expect(words(q(page, '#sp-work-title'))).toBe('Cell Microscope Lab');
    expect(words(q(page, '.sp-work .sp-fb-sub'))).toBe('Page 1 of 1');
    const img = q(page, '.sp-work-img');
    expect(img.getAttribute('src')).toBe('../assets/sample-work/cell-lab-cece-1.jpg');
    expect(img.getAttribute('alt')).toBe('Your page 1 with your teacher’s marks');
    expect(qa(page, '.sp-work-over .sp-work-pin').map(words)).toEqual(['1', '2', '3']);
    expect(qa(page, '.sp-work-notes li span:last-child').map(words)).toEqual(LAB_NOTES);
    expect(qa(page, '.sp-work-notes li .sp-work-pin').map(words)).toEqual(['1', '2', '3']);
    expect(qa(page, '.sp-work-over .sp-work-mark').map(words)).toEqual(['✓']);
    expect(qa(page, '.sp-work-ink polyline').map(p => p.getAttribute('class'))).toEqual([
      'sp-work-pen sp-ink-red',
      'sp-work-highlight sp-ink-blue',
    ]);
    // The teacher's working copy is nowhere on the page.
    expect(page.root().innerHTML).not.toMatch(/Add the date you did the lab/);
    expect(page.calls).toEqual([]);
  });

  it('Show Marks off shows the photo as sent; on again brings the marks back', async () => {
    const page = await demo();
    await openWork(page);
    const sw = () => q(page, '[data-act="work-marks"]');
    expect(sw().getAttribute('role')).toBe('switch');
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(words(sw())).toBe('Show Marks');
    await page.click('[data-act="work-marks"]');
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(q(page, '.sp-work-over').innerHTML).toBe('');
    expect(q(page, '.sp-work-notes')).toBeNull();
    expect(q(page, '.sp-work-img').getAttribute('alt')).toBe('Your page 1');
    await page.click('[data-act="work-marks"]');
    expect(qa(page, '.sp-work-notes li')).toHaveLength(3);
  });

  it('Back goes to Your Feedback; another press leaves See Your Work', async () => {
    const page = await demo();
    await openWork(page);
    await page.click('[data-act="work-close"]');
    expect(q(page, '.sp-work')).toBeNull();
    expect(words(q(page, '#sp-fb-title'))).toBe('Cell Microscope Lab');
    await page.click('[data-act="work"]');
    expect(q(page, '.sp-work-img')).not.toBeNull();
    await page.click('[data-tab="assignments"]');
    expect(page.T.state().work).toBe('');
    expect(q(page, '.sp-work')).toBeNull();
  });

  it('a piece with no marks given cannot open See Your Work, even by a press made up by hand', async () => {
    const page = await demo();
    await openFeedback(page, 'Energy Transfer Investigation');
    expect(q(page, '[data-act="work"]')).toBeNull();
    const view = viewOf(page);
    const fake = { getAttribute: n => (n === 'data-piece' ? 'demo-energy' : '') };
    expect(StudentPageView.press({}, view, 'work', fake)).toBeNull();
  });

  it('the stand-in gives nothing under Missing or Excused, or on work not returned', async () => {
    const page = await demo();
    const st = page.T.state();
    const lab = st.reply.assessments.find(a => a.id === 'demo-lab');
    lab.status = 'NS';
    expect(page.T.feedbackOf(st).assessments).toEqual([]);
    lab.status = 'EXC';
    expect(page.T.feedbackOf(st).assessments).toEqual([]);
    lab.status = null;
    const back = lab.returned_at;
    lab.returned_at = null;
    expect(page.T.feedbackOf(st).assessments).toEqual([]);
    lab.returned_at = back;
    expect(page.T.feedbackOf(st).assessments).toHaveLength(1);
  });

  it('a page whose marks were never given is not counted, and has no marks to show', async () => {
    const page = await demo();
    const lab = page.T.demoMarkup()['demo-lab'];
    lab.pages.push({ file_id: 'demo-file-lab-2', page: 2, image: 'cell-lab-cece-1.jpg', given: null, working: null });
    try {
      expect(page.T.feedbackOf(page.T.state()).assessments[0].marks).toEqual({ pages: 1, notes: 3 });
      await openWork(page);
      expect(words(q(page, '.sp-work .sp-fb-sub'))).toBe('Page 1 of 2');
      await page.click('[aria-label="Next Page"]');
      expect(q(page, '.sp-work-over').innerHTML).toBe('');
      expect(q(page, '.sp-work-img').getAttribute('alt')).toBe('Your page 2');
    } finally {
      lab.pages.pop();
    }
  });
});

describe('the view keeps Mark Up off anything not returned with a grade', () => {
  const reply = {
    student: { enrollment_id: 'e1', first_name: 'Ada' },
    course: {},
    assessments: [
      { id: 'a1', title: 'Back', date: '2026-11-01', returned_at: '2026-11-03T18:00:00Z', grade: { v: 1, value: 3 } },
      { id: 'a2', title: 'Not Back', date: '2026-11-01' },
      { id: 'a3', title: 'Missing', date: '2026-11-01', status: 'NS', returned_at: '2026-11-03T18:00:00Z' },
    ],
  };
  const marks = { pages: 2, notes: 3 };
  const fb = ids => ({ ok: true, assessments: ids.map(id => ({ id, marks })) });

  it('marks show only on the returned piece', () => {
    const v = StudentView.build(reply, 'c', null, null, fb(['a1', 'a2', 'a3']));
    expect(v.work.find(p => p.id === 'a1').marks).toEqual(marks);
    expect(v.work.find(p => p.id === 'a2').marks).toBeNull();
    expect(v.work.find(p => p.id === 'a3').marks).toBeNull();
  });

  it('a reply of the wrong shape reads as none', () => {
    const odd = [
      { ok: false, assessments: [{ id: 'a1', marks }] },
      { ok: true, assessments: 'a1' },
      { ok: true, assessments: [{ id: 'a1', marks: { pages: '2', notes: 1 } }] },
      { ok: true, assessments: [{ id: 'a1', marks: { pages: 0, notes: 1 } }] },
      { ok: true, assessments: [{ id: 'a1', marks: { pages: 1, notes: -1 } }] },
      { ok: true, assessments: [{ id: 1, marks }] },
    ];
    odd.forEach(f =>
      expect(StudentView.build(reply, 'c', null, null, f).work.find(p => p.id === 'a1').marks).toBeNull(),
    );
    expect(StudentPageView.marksLine({ pages: 1, notes: 0 })).toBe('1 page with marks');
    expect(StudentPageView.marksLine({ pages: 2, notes: 1 })).toBe('2 pages · 1 note on your work');
  });
});

describe('answers that arrive late, or wrong', () => {
  it('an answer that lands after Back draws nothing', async () => {
    const page = await demo();
    const h = held();
    page.T.setFeedbackAnswer(() => h.promise);
    await openWork(page);
    expect(words(q(page, '.sp-work [role="status"]'))).toBe('Getting your work…');
    await page.click('[data-act="work-close"]');
    h.settle({ ok: true, files: [{ file_id: 'f1', page: 1, url: '../assets/sample-work/cell-lab-cece-1.jpg' }] });
    await page.settle();
    expect(page.T.state().workPages.state).toBe('loading');
    expect(q(page, '.sp-work')).toBeNull();
  });

  it('an answer that lands after Done draws nothing', async () => {
    const page = await demo();
    const h = held();
    page.T.setFeedbackAnswer(() => h.promise);
    await openWork(page);
    await page.click('[data-act="card-done"]');
    h.settle({ ok: true, files: [] });
    await page.settle();
    expect(q(page, '.sp-work')).toBeNull();
    expect(page.T.state().workPages).toBeNull();
  });

  it('an older ask never draws over a newer one', async () => {
    const page = await demo();
    const first = held();
    page.T.setFeedbackAnswer(() => first.promise);
    await openWork(page);
    await page.click('[data-act="work-close"]');
    // The pages were never in, so opening again asks again; this one answers at once.
    page.T.setFeedbackAnswer(null);
    await page.click('[data-act="work"]');
    expect(page.T.state().workPages.state).toBe('ready');
    first.settle({ ok: false, error: 'network' });
    await page.settle();
    expect(page.T.state().workPages.state).toBe('ready');
    expect(q(page, '.sp-work-img')).not.toBeNull();
  });

  it('a reply of the wrong kind shows Try Again; Try Again fetches again', async () => {
    const page = await demo();
    page.T.setFeedbackAnswer(route => (route === 'markup' ? { ok: true, files: 'none' } : { ok: true, files: [] }));
    await openWork(page);
    expect(words(q(page, '.sp-work [role="alert"]'))).toBe('Your work didn’t load. Check your internet and try again.');
    page.T.setFeedbackAnswer(null);
    await page.click('[data-act="work-retry"]');
    expect(q(page, '.sp-work-img')).not.toBeNull();
  });
});

describe('what is drawn over the photo', () => {
  async function withPages(pages) {
    const page = await demo();
    page.T.setFeedbackAnswer(route =>
      route === 'file-links'
        ? { ok: true, files: pages.map((p, i) => ({ file_id: 'f' + i, page: i + 1, url: p.url })) }
        : { ok: true, files: pages.map((p, i) => ({ file_id: 'f' + i, marks: p.marks })) },
    );
    await openWork(page);
    return page;
  }

  it('two pages: Page 1 of 2, Next Page and Previous Page', async () => {
    const page = await withPages([
      { url: '../assets/sample-work/a.jpg', marks: { v: 1, marks: [{ type: 'note', x: 0.5, y: 0.5, text: 'One' }] } },
      { url: '../assets/sample-work/b.jpg', marks: { v: 1, marks: [{ type: 'note', x: 0.5, y: 0.5, text: 'Two' }] } },
    ]);
    expect(words(q(page, '.sp-work .sp-fb-sub'))).toBe('Page 1 of 2');
    expect(q(page, '.sp-work-dots').getAttribute('aria-label')).toBe('Page 1 of 2');
    expect(q(page, '[aria-label="Previous Page"]').hasAttribute('disabled')).toBe(true);
    await page.click('[aria-label="Next Page"]');
    expect(words(q(page, '.sp-work .sp-fb-sub'))).toBe('Page 2 of 2');
    expect(q(page, '.sp-work-img').getAttribute('src')).toBe('../assets/sample-work/b.jpg');
    expect(qa(page, '.sp-work-notes li span:last-child').map(words)).toEqual(['Two']);
    expect(q(page, '[aria-label="Next Page"]').hasAttribute('disabled')).toBe(true);
  });

  it('a note’s words are text; a mark of another kind or off the page is left out; a page with no marks is the photo', async () => {
    const page = await withPages([
      {
        url: 'blob:x-1',
        marks: {
          v: 1,
          marks: [
            { type: 'note', x: 0.2, y: 0.2, text: '<img src=x onerror=alert(1)>' },
            { type: 'note', x: 2, y: 0.2, text: 'Off the page' },
            { type: 'stamp', x: 0.2, y: 0.2 },
            { type: 'tick', x: 0.5, y: '0.5' },
            { type: 'pen', points: [[0.1, 0.1]] },
            { type: 'cross', x: 0.3, y: 0.3, color: 'url(evil)' },
          ],
        },
      },
    ]);
    expect(qa(page, '.sp-work-notes li span:last-child').map(words)).toEqual(['<img src=x onerror=alert(1)>']);
    expect(q(page, '.sp-work-notes img')).toBeNull();
    expect(qa(page, '.sp-work-mark').map(m => m.getAttribute('class'))).toEqual(['sp-work-mark sp-ink-red']);
    expect(q(page, '.sp-work-ink')).toBeNull();
  });

  it('a picture this page did not make is not shown', async () => {
    const page = await withPages([{ url: 'https://elsewhere.example/p.jpg', marks: null }]);
    expect(q(page, '.sp-work-img')).toBeNull();
    expect(words(q(page, '.sp-work .sp-lead'))).toBe('Your pages can’t be shown here.');
  });
});
