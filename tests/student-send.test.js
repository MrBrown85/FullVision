/**
 * Sending work from the student's page (S5-F2 and S5-F3; s/send.js): Send
 * My Work, Check and Send, Sending Late, Closed, Sent, Not Sent Yet, One
 * Page Didn't Send, the blurry check, Unsend and Replace.
 *
 * Demo Mode only (#demo-card-send: the sample with Send Work on). The page
 * runs as a browser loads it (tests/helpers/student-page-context.js). The
 * shrinking is a stand-in for shared/photo-shrink.js's prepare, and the
 * clock is the page's own, moved by the test: nothing waits on real time.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';

const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const cards = page => [...page.root().querySelectorAll('.sp-deck .sp-piece')];
const card = (page, title) => cards(page).find(c => c.querySelector('.sp-piece-title').textContent === title);
const has = (page, sel) => !!page.root().querySelector(sel);
const text = (page, sel) => words(page.root().querySelector(sel));

// A stand-in for PhotoShrink.prepare: one JPEG page a file, or what the file says.
function fakePrepare(calls) {
  return (file, opts) => {
    calls.push({ file, opts });
    if (file.refuse) {
      return Promise.resolve({
        ok: false,
        reason: file.refuse,
        kind: file.kind,
        locked: file.locked,
        limit: file.limit,
      });
    }
    const n = file.pages || 1;
    return Promise.resolve({
      ok: true,
      kind: file.kind || 'jpeg',
      pages: Array.from({ length: n }, (_, i) => ({
        blob: { size: 1000 },
        thumb: { size: 100 },
        hash: 'h' + i,
        blurry: !!file.blurry,
      })),
    });
  };
}

async function demo(hash) {
  const page = openStudentPage();
  const calls = [];
  await page.start(hash || '#demo-card-send');
  page.T.setPrepare(fakePrepare(calls));
  await page.submit('form[data-form="card"]');
  page.type('#sp-ident', page.T.DEMO.number);
  await page.click('[data-act="card-yes"]');
  return { page, calls };
}

// Send My Work on a piece, then files chosen.
async function openSend(page, title) {
  await page.click('.sp-piece[data-piece="' + idOf(page, title) + '"] [data-act="send-open"]');
}
const idOf = (page, title) => page.T.state().reply.assessments.find(a => a.title === title).id;
async function choose(page, files) {
  await page.T.sendFiles(files, -1);
  await page.settle();
}

describe('Send Work off (every class, and #demo-card): nothing about sending shows', () => {
  it('no Send My Work, no Closed, no Sent; the page is as it was', async () => {
    const { page } = await demo('#demo-card');
    expect(page.T.workOf(page.T.state())).toBeNull();
    expect(page.root().innerHTML).not.toMatch(/sp-send|Send My Work|Hand this one in on paper/);
    expect(text(page, '[data-segment="sent"]')).toBe('Sent 0');
    expect(page.calls).toEqual([]);
  });

  it('a `work` reply with send_work false, or of the wrong shape, draws nothing about sending', () => {
    const reply = {
      student: {},
      course: {},
      assessments: [{ id: 'a1', title: 'One', date: '2026-11-01', due_date: '2026-11-09' }],
    };
    const off = StudentView.build(reply, 'c', null, {
      send_work: false,
      assessments: [{ id: 'a1', students_send: 'photos', open: true }],
    });
    expect(off.work[0].send).toBeNull();
    const odd = StudentView.build(reply, 'c', null, {
      send_work: true,
      assessments: [{ id: 'a1', students_send: 'video', open: 'yes', sent: 'no' }],
    });
    expect(odd.work[0].send).toBeNull();
    const sent = StudentView.build(reply, 'c', null, {
      send_work: true,
      assessments: [
        {
          id: 'a1',
          students_send: 'photos',
          open: true,
          sent: {
            sent_at: '2026-11-05T17:41:09Z',
            pages: '2',
            grading: 'yes',
            can_change: true,
            thumbs: ['javascript:x'],
          },
        },
      ],
    });
    expect(sent.work[0].kind).toBe('sent');
    expect(sent.work[0].send.sent).toMatchObject({ pages: 0, grading: false, canChange: true, thumbs: [] });
    expect(sent.counts).toMatchObject({ toDo: 0, sent: 1 });
  });
});

describe('a PDF becomes pages: the PDF reader is fetched only when a send opens', () => {
  it.each(['', '#demo', '#demo-card-send'])('a page with no send open (%s) fetches neither file', async hash => {
    const page = openStudentPage();
    await page.start(hash);
    expect(page.fetched.filter(src => /photo-(shrink|readers)|pdfjs/.test(src))).toEqual([]);
  });

  it('opening a send fetches photo-shrink.js and photo-readers.js, never pdf.js itself; prepare is given its openPdf', async () => {
    const page = openStudentPage();
    await page.start('#demo-card-send');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    await page.click('.sp-piece[data-piece="demo-fair"] [data-act="send-open"]');
    await page.settle();
    expect(page.fetched.filter(src => /photo-|pdfjs/.test(src)).sort()).toEqual([
      '../shared/photo-readers.js',
      '../shared/photo-shrink.js',
    ]);
    const calls = [];
    page.T.setPrepare(fakePrepare(calls));
    await choose(page, [{ name: 'two.pdf', kind: 'pdf', pages: 2 }]);
    expect(calls[0].opts.openPdf).toBe(page.run('PhotoReaders.openPdf'));
    expect(page.fetched.some(src => /pdfjs/.test(src))).toBe(false);
  });
});

describe('S5-F2: Send My Work, Check and Send, Sent, Sending Late, Closed', () => {
  it('the To Do cards: Send My Work while open; Closed and "Hand this one in on paper" once the last day has passed', async () => {
    const { page } = await demo();
    const fair = card(page, 'Science Fair Proposal');
    expect(words(fair.querySelector('[data-act="send-open"]'))).toBe('Send My Work');
    expect(words(card(page, 'Disease Research Poster').querySelector('[data-act="send-open"]'))).toBe('Send My Work');
    const quick = card(page, 'Immune System Quick Check');
    expect(quick.querySelector('[data-act="send-open"]')).toBeNull();
    expect(words(quick.querySelector('.sp-send-closed-title'))).toMatch(/^Closed \S+ \d+$/);
    expect(words(quick.querySelector('.sp-send-closed-line'))).toBe('Hand this one in on paper');
  });

  it('Check and Send opens with the camera and the file chooser; a piece that takes files also takes PDFs', async () => {
    const { page } = await demo();
    await openSend(page, 'Science Fair Proposal');
    expect(page.T.state().screen).toBe('send');
    expect(text(page, '#sp-send-title')).toBe('Check and Send');
    expect(text(page, '.sp-send-piece')).toBe('Science Fair Proposal');
    const inputs = [...page.root().querySelectorAll('.sp-send-input')];
    expect(inputs.map(i => [words(i.parentNode), i.getAttribute('accept'), i.hasAttribute('capture')])).toEqual([
      ['Use the Camera', 'image/*', true],
      ['Choose a File', 'image/*,application/pdf', false],
    ]);
    expect(text(page, '.sp-send-hint')).toBe(
      'Photos or PDFs. Working in Word, PowerPoint or Google? Save it as a PDF, then choose it here.',
    );
    expect(text(page, '.sp-send-note-label')).toBe('Note for Your Teacher');
    expect(page.root().querySelector('[data-act="send-go"]').hasAttribute('disabled')).toBe(true);
  });

  it('pages in order with Remove; Send names how many; the note goes with them; Sent says to whom and when', async () => {
    const { page } = await demo();
    await openSend(page, 'Science Fair Proposal');
    await choose(page, [{ name: 'a.jpg' }, { name: 'b.jpg' }]);
    expect([...page.root().querySelectorAll('.sp-send-page-x')].map(b => b.getAttribute('aria-label'))).toEqual([
      'Remove page 1',
      'Remove page 2',
    ]);
    expect(text(page, '[data-act="send-go"]')).toBe('Send 2 Photos');
    await page.click('.sp-send-page-x');
    expect(text(page, '[data-act="send-go"]')).toBe('Send 1 Photo');
    await choose(page, [{ name: 'c.jpg' }]);
    page.type('#sp-send-note', 'Page 2 has my answers.');
    await page.click('[data-act="send-go"]');
    await page.settle();
    expect(text(page, '#sp-send-title')).toBe('Sent to Your Teacher');
    expect(text(page, '.sp-send-when')).toMatch(/^\w+day, \S+ \d+ · \d{1,2}:\d\d (am|pm)$/);
    const rec = Object.values(page.T.state().demoSent)[0];
    expect(rec.note).toBe('Page 2 has my answers.');
    expect(rec.pages).toHaveLength(2);
    expect(rec.late).toBe(false);
    await page.click('[data-act="send-done"]');
    expect(page.T.state().screen).toBe('assignments');
    expect(text(page, '[data-segment="sent"]')).toBe('Sent 1');
    expect(text(page, '[data-segment="todo"]')).toBe('To Do 2');
    await page.click('[data-segment="sent"]');
    const sent = card(page, 'Science Fair Proposal');
    expect(words(sent.querySelector('.sp-flag-sent'))).toMatch(/^Sent \S+ \d+$/);
    expect(words(sent.querySelector('.sp-send-line'))).toBe(
      'Your teacher hasn’t started grading it. You can still change it.',
    );
    expect([...sent.querySelectorAll('.sp-send-change .sp-btn')].map(words)).toEqual(['Replace Photos', 'Unsend']);
    expect(page.calls).toEqual([]);
  });

  it('a piece past its due date: Sending Late, and the work is marked Late; work on a graded piece is locked at once', async () => {
    const { page } = await demo();
    await openSend(page, 'Disease Research Poster');
    expect(text(page, '.sp-send-late')).toBe('This will be marked Late.');
    expect(text(page, '.sp-send-due')).toMatch(/^Due \w{3}, \S+ \d+$/);
    // It takes photos only.
    expect([...page.root().querySelectorAll('.sp-send-input')].map(i => i.getAttribute('accept'))).toEqual([
      'image/*',
      'image/*',
    ]);
    expect(text(page, '.sp-send-hint')).toBe('Take a photo of each page.');
    await choose(page, [{ name: 'a.jpg' }]);
    expect(text(page, '[data-act="send-go"]')).toBe('Send Late');
    await page.click('[data-act="send-go"]');
    await page.settle();
    await page.click('[data-act="send-done"]');
    await page.click('[data-segment="sent"]');
    const poster = card(page, 'Disease Research Poster');
    expect(words(poster.querySelector('.sp-send-line'))).toBe('Your teacher is grading this');
    expect(poster.querySelector('.sp-send-change')).toBeNull();
    // Even a press made up by hand asks nothing: the work cannot be changed.
    const forged = page.root().ownerDocument.createElement('button');
    forged.setAttribute('data-act', 'send-unsend');
    forged.setAttribute('data-piece', idOf(page, 'Disease Research Poster'));
    page.root().appendChild(forged);
    forged.click();
    await page.settle();
    expect(has(page, '.sp-send-ask')).toBe(false);
    const row = page.T.rowView(page.T.viewOf(page.T.state()).work.find(p => p.title === 'Disease Research Poster'));
    expect(row.sub).toMatch(/^Sent \S+ \d+ · Late · 1 photo$/);
  });

  it('what a file that cannot be used says, and 30 pages at most', async () => {
    const { page, calls } = await demo();
    await openSend(page, 'Science Fair Proposal');
    await choose(page, [{ name: 'essay.docx', refuse: 'office' }]);
    expect(text(page, '.sp-send-msg')).toBe('Save it as a PDF first, then choose the PDF.');
    await choose(page, [{ name: 'notes.pdf', kind: 'pdf', refuse: 'no_decoder' }]);
    expect(text(page, '.sp-send-msg')).toBe('That PDF couldn’t be opened. Check your internet and try again.');
    await choose(page, [{ name: 'locked.pdf', kind: 'pdf', refuse: 'unreadable', locked: true }]);
    expect(text(page, '.sp-send-msg')).toBe('This PDF has a password. Save a copy without one, then choose it here.');
    await choose(page, [{ name: 'long.pdf', kind: 'pdf', refuse: 'too_many_pages', limit: 20 }]);
    expect(text(page, '.sp-send-msg')).toBe('A PDF can have 20 pages at most.');
    // A PDF is asked for 20 pages at most, even with 30 to fill (ruling 18).
    await choose(page, [{ name: 'big.pdf', kind: 'pdf', pages: 20 }]);
    expect(calls.at(-1).opts.maxPages).toBe(20);
    await choose(page, [{ name: 'more.pdf', kind: 'pdf', pages: 9 }]);
    expect(calls.at(-1).opts.maxPages).toBe(10);
    await choose(page, [{ name: 'two.pdf', kind: 'pdf', pages: 2 }]);
    // Only one more page fits: the PDF is asked for at most that many, and its two are refused.
    expect(calls.at(-1).opts.maxPages).toBe(1);
    expect(text(page, '.sp-send-msg')).toBe('You can send 30 pages at most.');
    expect(page.T.state().send.pages).toHaveLength(29);
    await choose(page, [{ name: 'last.jpg' }]);
    expect(page.T.state().send.pages).toHaveLength(30);
    expect(has(page, '.sp-send-add')).toBe(false);
    expect(text(page, '.sp-send-hint')).toBe('You can send 30 pages at most.');
  });

  it('files still being shrunk when the student goes Back, or is signed out: nothing is drawn or kept', async () => {
    const { page } = await demo();
    await openSend(page, 'Science Fair Proposal');
    let finish;
    page.T.setPrepare(() => new Promise(r => (finish = r)));
    const one = { ok: true, kind: 'jpeg', pages: [{ blob: {}, thumb: {}, hash: 'h', blurry: false }] };
    let going = page.T.sendFiles([{ name: 'a.jpg' }], -1);
    await page.settle();
    await page.click('[data-act="send-back"]');
    // Nothing is drawn for a send no longer on screen.
    page.run(
      'window.__paints = 0; var __p = StudentPage.paint; StudentPage.paint = function () { window.__paints += 1; return __p.apply(this, arguments); };',
    );
    finish(one);
    await going;
    await page.settle();
    expect(page.run('window.__paints')).toBe(0);
    expect(page.T.state().send).toBeNull();
    expect(page.T.state().screen).toBe('assignments');
    // Signed out (Done, fifteen idle minutes, midnight all move the page's turn on) while shrinking.
    await openSend(page, 'Science Fair Proposal');
    going = page.T.sendFiles([{ name: 'a.jpg' }], -1);
    await page.settle();
    page.run('StudentPage.newTurn()');
    finish(one);
    await page.settle();
    expect(page.T.state().send.pages).toEqual([]);
    expect(page.T.state().send.busy).toBe(true);
  });
});

describe('S5-F3: Not Sent Yet, One Page Didn’t Send, the blurry check, Unsend and Replace', () => {
  it('a blurry photo is shown first: Use It Anyway keeps it, Cancel takes it out', async () => {
    const { page } = await demo();
    await openSend(page, 'Science Fair Proposal');
    await choose(page, [{ name: 'a.jpg', blurry: true }]);
    expect(text(page, '#sp-send-blurry-title')).toBe('This photo looks blurry');
    expect(text(page, '.sp-send-panel .sp-send-line')).toBe(
      'Your teacher may not be able to read it. Hold the phone still, right above the page.',
    );
    expect(text(page, '.sp-send-head-page')).toBe('Page 1');
    const retake = page.root().querySelector('.sp-send-blurry-buttons .sp-send-input');
    expect([words(retake.parentNode), retake.hasAttribute('capture')]).toEqual(['Retake', true]);
    await page.click('[data-act="send-blur-keep"]');
    expect(text(page, '[data-act="send-go"]')).toBe('Send 1 Photo');
    await choose(page, [{ name: 'b.jpg', blurry: true }]);
    await page.click('[data-act="send-blur-cancel"]');
    expect(page.T.state().send.pages).toHaveLength(1);
  });

  it('Retake puts the new photo in place of the blurry one', async () => {
    const { page } = await demo();
    await openSend(page, 'Science Fair Proposal');
    await choose(page, [{ name: 'a.jpg' }, { name: 'b.jpg', blurry: true }]);
    const key = page.T.state().send.blurryKey;
    const input = page.root().querySelector('.sp-send-blurry-buttons .sp-send-input');
    input.files = [{ name: 'b2.jpg' }];
    await page.T.sendChange(input);
    await page.settle();
    const pages = page.T.state().send.pages;
    expect(pages).toHaveLength(2);
    expect(pages[1].key).not.toBe(key);
    expect(page.T.state().send.step).toBe('check');
  });

  it('offline: Not Sent Yet, the photos kept on this phone; Try Again Now sends them', async () => {
    const { page } = await demo();
    await openSend(page, 'Science Fair Proposal');
    await choose(page, [{ name: 'a.jpg' }, { name: 'b.jpg' }]);
    page.ctx.navigator = { onLine: false };
    await page.click('[data-act="send-go"]');
    expect(text(page, '#sp-send-title')).toBe('Not sent yet');
    expect(text(page, '.sp-send-line')).toBe(
      'Your 2 photos are saved on this phone. They’ll send when you’re back online.',
    );
    expect(page.T.state().demoSent).toEqual({});
    page.ctx.navigator = { onLine: true };
    await page.click('[data-act="send-again"]');
    await page.settle();
    expect(text(page, '#sp-send-title')).toBe('Sent to Your Teacher');
  });

  it('one page didn’t send: Colin’s words with the clock time two hours from the start; nothing handed in until every page is up', async () => {
    const { page } = await demo();
    let now = new Date(2026, 10, 11, 9, 40).getTime();
    page.T.setClock(() => now);
    await openSend(page, 'Science Fair Proposal');
    await choose(page, [{ name: 'a.jpg' }, { name: 'b.jpg' }]);
    page.T.state().demoFail = n => n === 2;
    await page.click('[data-act="send-go"]');
    await page.settle();
    expect(text(page, '#sp-send-title')).toBe('Page 2 didn’t send');
    expect(text(page, '.sp-send-line')).toBe(
      'Page 1 is sent. Page 2 is still on this phone. Finish by 11:40, or you’ll need to send both pages again. Your teacher sees your work once every page is sent.',
    );
    expect(text(page, '[data-act="send-again"]')).toBe('Send Page 2 Again');
    expect(words(page.root().querySelector('.sp-send-col .sp-send-input').parentNode)).toBe('Retake Page 2');
    expect(text(page, '[data-act="send-drop"]')).toBe('Remove Page 2');
    expect(text(page, '.sp-send-hint')).toBe('If it keeps failing, show your teacher this screen.');
    // Ruling 17: the teacher never gets a submission with a page missing.
    expect(page.T.state().demoSent).toEqual({});
    // An hour later it still goes, and the clock time does not move.
    page.T.state().demoFail = null;
    now += 60 * 60 * 1000;
    await page.click('[data-act="send-again"]');
    await page.settle();
    expect(text(page, '#sp-send-title')).toBe('Sent to Your Teacher');
    expect(Object.values(page.T.state().demoSent)[0].pages).toHaveLength(2);
  });

  it('after two hours the send is stopped: Colin’s words, and Send Again starts over', async () => {
    const { page } = await demo();
    let now = new Date(2026, 10, 11, 9, 40).getTime();
    page.T.setClock(() => now);
    await openSend(page, 'Science Fair Proposal');
    await choose(page, [{ name: 'a.jpg' }, { name: 'b.jpg' }]);
    page.T.state().demoFail = n => n === 2;
    await page.click('[data-act="send-go"]');
    await page.settle();
    page.T.state().demoFail = null;
    now += page.T.HOLD_MS + 1;
    await page.click('[data-act="send-again"]');
    expect(text(page, '.sp-send-line')).toBe(
      'This send took too long and was stopped. Your photos are still on this phone. Send them again.',
    );
    expect(page.T.state().demoSent).toEqual({});
    await page.click('[data-act="send-restart"]');
    await page.settle();
    expect(text(page, '#sp-send-title')).toBe('Sent to Your Teacher');
  });

  it('Remove the Page hands in the pages that are up', async () => {
    const { page } = await demo();
    await openSend(page, 'Science Fair Proposal');
    await choose(page, [{ name: 'a.jpg' }, { name: 'b.jpg' }]);
    page.T.state().demoFail = n => n === 2;
    await page.click('[data-act="send-go"]');
    await page.settle();
    await page.click('[data-act="send-drop"]');
    await page.settle();
    expect(text(page, '#sp-send-title')).toBe('Sent to Your Teacher');
    expect(Object.values(page.T.state().demoSent)[0].pages).toHaveLength(1);
  });

  async function sentFair() {
    const d = await demo();
    await openSend(d.page, 'Science Fair Proposal');
    await choose(d.page, [{ name: 'a.jpg' }, { name: 'b.jpg' }]);
    await d.page.click('[data-act="send-go"]');
    await d.page.settle();
    await d.page.click('[data-act="send-done"]');
    await d.page.click('[data-segment="sent"]');
    return d;
  }

  it('Unsend: Colin’s words; Keep It Sent changes nothing; Unsend puts the piece back in To Do', async () => {
    const { page } = await sentFair();
    await page.click('[data-act="send-unsend"]');
    expect(text(page, '#sp-send-ask-title')).toBe('Unsend Your Work?');
    expect(text(page, '#sp-send-ask-body')).toBe(
      'Your 2 photos are deleted and Science Fair Proposal goes back to To Do. Deleted photos can’t come back. After grading starts, ask your teacher instead.',
    );
    expect([...page.root().querySelectorAll('.sp-send-ask .sp-btn')].map(words)).toEqual(['Unsend', 'Keep It Sent']);
    await page.click('.sp-send-ask [data-act="send-ask-no"]');
    expect(has(page, '.sp-send-ask')).toBe(false);
    expect(text(page, '[data-segment="sent"]')).toBe('Sent 1');
    await page.click('[data-act="send-unsend"]');
    await page.click('[data-act="send-ask-yes"]');
    expect(page.T.state().demoSent).toEqual({});
    expect(text(page, '[data-segment="sent"]')).toBe('Sent 0');
    expect(text(page, '[data-segment="todo"]')).toBe('To Do 3');
  });

  it('Unsend when the teacher added a page: Colin’s words; that page stays and the work stays in, as the teacher’s', async () => {
    const { page } = await sentFair();
    Object.values(page.T.state().demoSent)[0].teacherPages = 1;
    await page.click('[data-act="send-unsend"]');
    expect(text(page, '#sp-send-ask-body')).toBe(
      'Your 2 photos are deleted. The page your teacher added stays. Deleted photos can’t come back.',
    );
    await page.click('[data-act="send-ask-yes"]');
    expect(text(page, '[data-segment="sent"]')).toBe('Sent 1');
    expect(card(page, 'Science Fair Proposal').querySelector('.sp-send-change')).toBeNull();
  });

  it('Replace: Colin’s words, with the past-due sentence after the due date; the new pages take the old ones’ place', async () => {
    const { page } = await sentFair();
    await page.click('[data-act="send-replace"]');
    expect(text(page, '#sp-send-ask-title')).toBe('Replace Your Photos?');
    expect(text(page, '#sp-send-ask-body')).toBe(
      'Your 2 photos are deleted when the new ones are sent. Deleted photos can’t come back.',
    );
    expect([...page.root().querySelectorAll('.sp-send-ask .sp-btn')].map(words)).toEqual(['Replace Photos', 'Cancel']);
    // Past the due date (the clock moved on a week).
    const later = Date.now() + 7 * 24 * 60 * 60 * 1000;
    page.T.setClock(() => later);
    await page.click('[data-act="send-ask-no"]');
    await page.click('[data-act="send-replace"]');
    expect(text(page, '#sp-send-ask-body')).toBe(
      'Your 2 photos are deleted when the new ones are sent. Deleted photos can’t come back. It’s past the due date, so your new photos are marked Late.',
    );
    await page.click('[data-act="send-ask-yes"]');
    expect(page.T.state().screen).toBe('send');
    await choose(page, [{ name: 'new.jpg' }]);
    expect(text(page, '[data-act="send-go"]')).toBe('Send Late');
    await page.click('[data-act="send-go"]');
    await page.settle();
    const rec = Object.values(page.T.state().demoSent)[0];
    expect(rec.pages).toHaveLength(1);
    expect(rec.late).toBe(true);
  });

  it('no Unsend or Replace once grading has started, even from a card drawn before', async () => {
    const { page } = await sentFair();
    await page.click('[data-act="send-unsend"]');
    Object.values(page.T.state().demoSent)[0].grading = true;
    await page.click('[data-act="send-ask-yes"]');
    expect(Object.keys(page.T.state().demoSent)).toHaveLength(1);
    expect(words(card(page, 'Science Fair Proposal').querySelector('.sp-send-line'))).toBe(
      'Your teacher is grading this',
    );
  });

  it('Done forgets what the sample sent and lets go of its photos', async () => {
    const { page } = await sentFair();
    await page.click('[data-act="card-done"]');
    expect(page.T.state().demoSent).toEqual({});
    expect(page.T.madeUrls()).toEqual([]);
    expect(page.calls).toEqual([]);
  });
});
