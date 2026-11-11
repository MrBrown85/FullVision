/**
 * Sending work from a real card (S5-W1; s/send.js): `work` beside `page`,
 * then send-start or replace, each page and thumbnail put to its upload
 * link, send-finish, unsend and file-links.
 *
 * The page runs as a browser loads it (tests/helpers/student-page-context.js)
 * against the function's real handler and send routes
 * (supabase/functions/student-submit/handler.ts, send-routes.ts) over a
 * stand-in database and bucket (tests/helpers/fake-student-submit.js with
 * tests/helpers/fake-send-world.js). An upload is checked by the bucket's
 * own rules and every page is read and checked by the route before it is
 * handed in, so the pages here are real JPEGs. The shrinking is a stand-in
 * for PhotoShrink.prepare; the device's store is a stand-in for IndexedDB
 * with the same shape as shared/photo-queue.js's.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { CECE, WORK, fakeStudentSubmit, sampleCard } from './helpers/fake-student-submit.js';
import { PAGE_JPEG, THUMB_JPEG } from './helpers/fake-send-world.js';

const TODAY = new Date().toISOString().slice(0, 10);
const KEY = 'fv-s-session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HOLD = 2 * 60 * 60 * 1000;

const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const text = (page, sel) => words(page.root().querySelector(sel));
const routes = page => page.calls.map(c => c.body.route);
const bodyOf = (page, route) => page.calls.filter(c => c.body.route === route).map(c => c.body);
const puts = page => page.storageCalls.filter(c => c.method === 'PUT');
const piece = id => '.sp-piece[data-piece="' + id + '"]';

// shared/photo-queue.js's store, kept in memory: the same five calls, the same shapes.
function memoryStore() {
  const rows = new Map();
  return {
    rows,
    list: async () => [...rows.values()].map(r => JSON.parse(JSON.stringify(r.meta))),
    putAll: async items =>
      items.forEach(i => rows.set(i.meta.id, { meta: { ...i.meta }, photo: i.photo, thumb: i.thumb })),
    update: async (id, patch) => {
      if (rows.has(id)) Object.assign(rows.get(id).meta, patch);
    },
    blobs: async id => (rows.has(id) ? { photo: rows.get(id).photo, thumb: rows.get(id).thumb } : null),
    remove: async ids => ids.forEach(id => rows.delete(id)),
    clear: async () => rows.clear(),
  };
}

// PhotoShrink.prepare's answer: one real JPEG page and its thumbnail for each file.
const page1 = () => ({
  blob: { size: PAGE_JPEG.length, bytes: PAGE_JPEG },
  thumb: { size: THUMB_JPEG.length, bytes: THUMB_JPEG },
  hash: 'h',
  width: 900,
  height: 1200,
});
const prepare = () => Promise.resolve({ ok: true, kind: 'jpeg', pages: [page1()] });

/* One school device, its function, the bucket behind it, and the device's
   store for waiting pages. `dev.answer(body)` can stand in for the
   function on one request; `dev.upload(url, n)` for the bucket on the n-th
   upload (a status, or 'network'). */
function school(more) {
  const fn = fakeStudentSubmit({
    cards: [sampleCard(TODAY)],
    sendWork: {
      [WORK.fair]: { students_send: 'photos_files', open: true },
      [WORK.poster]: { students_send: 'photos', open: true },
    },
    ...more,
  });
  const dev = { fn, store: {}, kept: memoryStore(), answer: null, upload: null, clock: null };
  let n = 0;
  dev.open = async hash => {
    const page = openStudentPage({ store: dev.store, objectUrls: true });
    page.server = body => (dev.answer && dev.answer(body)) || fn.handle(body);
    page.storage = async (url, init) => {
      if (init.method === 'PUT') {
        n += 1;
        const said = dev.upload && dev.upload(url, n);
        if (said === 'network') throw new TypeError('Failed to fetch');
        return { status: said || fn.world.phoneUpload(url, init.body.bytes, init.headers['Content-Type']) };
      }
      const got = fn.world.phoneDownload(url);
      return { status: got.status, blob: got.bytes && { size: got.bytes.length } };
    };
    page.T.setSendStore(dev.kept);
    page.T.setPrepare(prepare);
    if (dev.clock) page.T.setClock(dev.clock);
    await page.start(hash);
    return page;
  };
  return dev;
}

async function signIn(dev) {
  const page = await dev.open('#P3R8-WDK4');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  return page;
}

// Send My Work on Science Fair Proposal, with `n` pages chosen.
async function sendFair(page, n, note) {
  await page.click(piece(WORK.fair) + ' [data-act="send-open"]');
  await page.T.sendFiles(
    Array.from({ length: n }, () => ({})),
    -1,
  );
  await page.settle();
  if (note) page.type('#sp-send-note', note);
  await page.click('[data-act="send-go"]');
}

describe('a class with Send Work off: nothing about sending, and the page as it was drawn', () => {
  it.each([
    ['Send Work off', null],
    ['the function from before these routes', { ok: false, error: 'bad_request' }],
    ['a server error', { ok: false, error: 'server' }],
  ])('%s: `work` is asked once, after `page`, and the page is not drawn again', async (why, said) => {
    const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)] });
    let open;
    const held = new Promise(r => (open = r));
    const page = openStudentPage({ objectUrls: true });
    page.server = body => (body.route === 'work' ? held.then(() => said || fn.handle(body)) : fn.handle(body));
    await page.start('#P3R8-WDK4');
    page.type('#sp-ident', '0123456');
    page.tap('[data-act="card-yes"]');
    for (let i = 0; i < 50 && !routes(page).includes('work'); i++) await page.tick();
    for (let i = 0; i < 5; i++) await page.tick();
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'work', 'forms']);
    const drawn = page.root().innerHTML;
    expect(drawn).toContain('sp-page-title');
    open();
    await page.settle();
    // Byte for byte what was drawn before `work` answered.
    expect(page.root().innerHTML).toBe(drawn);
    expect(drawn).not.toMatch(/sp-send|Send My Work|Hand this one in on paper/);
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'work', 'forms']);
    expect(page.fetched).toEqual(['../shared/constants.js', '../shared/calc.js']);
    expect(page.storageCalls).toEqual([]);
  });
});

describe('a real send: start, each file to its link, finish', () => {
  it('two pages go up and are handed in; the Sent card shows them from blob: addresses', async () => {
    const dev = school();
    const page = await signIn(dev);
    const token = JSON.parse(dev.store[KEY]).t;
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'work', 'forms', 'feedback', 'group-work']);
    expect(page.root().querySelector(piece(WORK.fair) + ' [data-act="send-open"]')).toBeTruthy();
    // A piece the class does not take work for says nothing of sending.
    expect(page.root().querySelector(piece(WORK.quick) + ' .sp-send-closed')).toBeNull();

    await sendFair(page, 2, 'Page 2 has my answers.');
    expect(text(page, '#sp-send-title')).toBe('Sent to Your Teacher');
    const [start] = bodyOf(page, 'send-start');
    expect(start).toEqual({
      route: 'send-start',
      assessment_id: WORK.fair,
      request_id: expect.stringMatching(UUID),
      pages: [
        { width: 900, height: 1200, bytes: PAGE_JPEG.length, thumb_bytes: THUMB_JPEG.length },
        { width: 900, height: 1200, bytes: PAGE_JPEG.length, thumb_bytes: THUMB_JPEG.length },
      ],
      note: 'Page 2 has my answers.',
      followed_plan: null,
      session: token,
      enrollment_id: CECE,
    });
    // Each page, then its thumbnail, PUT to its own link with its type and nothing else.
    expect(puts(page).map(c => [new URL(c.url).pathname.replace(/[0-9a-f-]{36}/g, 'id'), c.headers])).toEqual([
      ['/storage/v1/object/upload/sign/student-photos/id/id/id/id/id.jpg', { 'Content-Type': 'image/jpeg' }],
      ['/storage/v1/object/upload/sign/student-photos/id/id/id/id/id-thumb.jpg', { 'Content-Type': 'image/jpeg' }],
      ['/storage/v1/object/upload/sign/student-photos/id/id/id/id/id.jpg', { 'Content-Type': 'image/jpeg' }],
      ['/storage/v1/object/upload/sign/student-photos/id/id/id/id/id-thumb.jpg', { 'Content-Type': 'image/jpeg' }],
    ]);
    const sub = [...dev.fn.world.subs.values()][0];
    expect(bodyOf(page, 'send-finish')).toEqual([
      {
        route: 'send-finish',
        submission_id: sub.id,
        files: sub.files.map(f => f.id),
        session: token,
        enrollment_id: CECE,
      },
    ]);
    expect(sub).toMatchObject({ state: 'sent', note: 'Page 2 has my answers.', assessment: WORK.fair });
    // Nothing waits on the device once the server has it.
    expect(dev.kept.rows.size).toBe(0);

    await page.click('[data-act="send-done"]');
    expect(routes(page)).toEqual([
      'card',
      'verify',
      'page',
      'work',
      'forms',
      'feedback',
      'group-work',
      'send-start',
      'send-finish',
      'work',
      'file-links',
    ]);
    expect(text(page, '[data-segment="sent"]')).toBe('Sent 1');
    await page.click('[data-segment="sent"]');
    const thumbs = [...page.root().querySelectorAll(piece(WORK.fair) + ' .sp-send-thumb')];
    expect(thumbs.map(img => img.getAttribute('src'))).toEqual([
      expect.stringMatching(/^blob:/),
      expect.stringMatching(/^blob:/),
    ]);
    expect(text(page, piece(WORK.fair) + ' .sp-send-line')).toBe(
      'Your teacher hasn’t started grading it. You can still change it.',
    );
    // The thumbnails came from their 60-second links (Batch E, E8), with nothing of the session.
    const gets = page.storageCalls.filter(c => c.method === 'GET');
    expect(gets).toHaveLength(2);
    gets.forEach(g => expect(g.url).toMatch(/\/object\/sign\/student-photos\/.+-thumb\.jpg\?token=dl&s=60$/));
    // No token, id or name in any address the page asked, or in anything the function logged.
    [...page.calls, ...page.storageCalls].forEach(c => expect(c.url).not.toContain(token));
    page.calls.forEach(c =>
      expect(c.url).toBe('https://x.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1'),
    );
    const logged = JSON.stringify(dev.fn.logs);
    [token, CECE, WORK.fair, sub.id, 'Cece', 'Page 2 has my answers.'].forEach(s => expect(logged).not.toContain(s));
  });

  it('One Page Didn’t Send: Send Page 2 Again asks the same send for fresh links and sends only that page', async () => {
    const dev = school();
    const page = await signIn(dev);
    dev.upload = (url, n) => (n === 3 ? 403 : null); // page 2's photo
    await sendFair(page, 2);
    expect(text(page, '#sp-send-title')).toBe('Page 2 didn’t send');
    expect(text(page, '.sp-send-line')).toMatch(
      /^Page 1 is sent\. Page 2 is still on this phone\. Finish by \d+:\d\d, or you’ll need to send both pages again\./,
    );
    expect(routes(page)).not.toContain('send-finish');
    expect(dev.kept.rows.size).toBe(2);

    await page.click('[data-act="send-again"]');
    expect(text(page, '#sp-send-title')).toBe('Sent to Your Teacher');
    const starts = bodyOf(page, 'send-start');
    expect(starts).toHaveLength(2);
    expect(starts[1].request_id).toBe(starts[0].request_id);
    // Page 1 and its thumbnail were up: only page 2's two files went again.
    expect(puts(page)).toHaveLength(5);
    expect([...dev.fn.world.subs.values()].map(s => [s.state, s.files.length])).toEqual([['sent', 2]]);
  });

  it.each([
    [
      'send-start',
      { ok: false, error: 'work_closed', closed_on: '2026-11-13' },
      'This one closed Nov 13. Hand it in on paper.',
      0,
    ],
    [
      'send-start',
      { ok: false, error: 'grading_started' },
      'Your teacher has started grading this. Ask your teacher instead.',
      0,
    ],
    [
      'send-start',
      { ok: false, error: 'too_many', retry_after_s: 600 },
      'You’ve sent a lot this hour. Try again in 10 minutes.',
      1,
    ],
    [
      'send-finish',
      { ok: false, error: 'too_many_pages', room: 1 },
      'Only 1 page fits with the pages your teacher added. Remove some, then send again.',
      1,
    ],
    [
      'send-finish',
      { ok: false, error: 'bad_file', files: [] },
      'One of your pages couldn’t be sent. Check your pages, then send again.',
      1,
    ],
    // The piece hidden or the student withdrawn: sending again won't help.
    ['send-start', { ok: false, error: 'not_found' }, 'This one can’t take your work right now. Ask your teacher.', 1],
    ['send-finish', { ok: false, error: 'not_found' }, 'This one can’t take your work right now. Ask your teacher.', 1],
    // An answer the page doesn't understand, from a connection that works: not Not Sent Yet.
    [
      'send-start',
      { ok: false, error: 'bad_request' },
      'Something went wrong sending this. Try again later, or ask your teacher.',
      1,
    ],
  ])('%s answers %j: the check screen says so', async (route, said, line, kept) => {
    const dev = school();
    const page = await signIn(dev);
    dev.answer = body => (body.route === route ? said : null);
    await sendFair(page, 1);
    expect(text(page, '#sp-send-title')).toBe('Check and Send');
    expect(text(page, '.sp-send-msg[role="alert"]')).toBe(line);
    // A refusal that a retry won't change lets the device's copy go; the photos stay on screen.
    expect(dev.kept.rows.size).toBe(kept);
    expect(page.root().querySelectorAll('.sp-send-page')).toHaveLength(1);
  });

  it('expired at the finish, or no answer at the start: Not Sent, Not Sent Yet', async () => {
    const dev = school();
    const page = await signIn(dev);
    dev.answer = body => (body.route === 'send-finish' ? { ok: false, error: 'expired' } : null);
    await sendFair(page, 1);
    expect(text(page, '#sp-send-title')).toBe('Not sent');
    expect(text(page, '.sp-send-line')).toBe(
      'This send took too long and was stopped. Your photos are still on this phone. Send them again.',
    );
    dev.answer = body => (body.route === 'send-start' ? { ok: false, error: 'network' } : null);
    await page.click('[data-act="send-restart"]');
    expect(text(page, '#sp-send-title')).toBe('Not sent yet');
    const starts = bodyOf(page, 'send-start');
    expect(starts[1].request_id).not.toBe(starts[0].request_id);
  });

  it.each([
    ['too_many', { ok: false, error: 'too_many', retry_after_s: 60 }],
    ['card_locked', { ok: false, error: 'card_locked' }],
    ['too_many_pages', { ok: false, error: 'too_many_pages', room: 5 }],
  ])('a page added after %s is kept on the device with the others', async (why, said) => {
    const dev = school();
    const page = await signIn(dev);
    dev.answer = body => (body.route === 'send-start' ? said : null);
    await sendFair(page, 1);
    expect(text(page, '#sp-send-title')).toBe('Check and Send');
    expect(dev.kept.rows.size).toBe(1);
    await page.T.sendFiles([{}], -1);
    await page.settle();
    page.type('#sp-send-note', 'Two pages now.');
    dev.answer = body => (body.route === 'send-start' ? { ok: false, error: 'network' } : null);
    await page.click('[data-act="send-go"]');
    expect(text(page, '#sp-send-title')).toBe('Not sent yet');
    expect(dev.kept.rows.size).toBe(2);
    expect([...dev.kept.rows.values()].map(r => r.meta.note)).toEqual(['Two pages now.', 'Two pages now.']);
  });

  it('a send names its student: nothing is asked while someone else is signed in', async () => {
    const dev = school();
    const page = await signIn(dev);
    const before = page.calls.length;
    const said = await page.run('StudentPage.askClass("send-start", { assessment_id: "x" }, "someone-else")');
    expect(said).toEqual({ ok: false, error: 'other_student' });
    expect(page.calls.length).toBe(before);
  });

  it('a session that ended while sending: the card’s first screen, signed out', async () => {
    const dev = school();
    const page = await signIn(dev);
    dev.answer = body => (body.route === 'send-start' ? { ok: false, error: 'signed_out' } : null);
    await sendFair(page, 1);
    expect(text(page, '.sp-msg')).toBe('You are signed out. Scan or type your card to open your page again.');
  });
});

describe('a send survives a reload, within its two hours', () => {
  it('no answer at Send: the pages wait on the device, and the page opened again finishes the same send', async () => {
    const dev = school();
    const first = await signIn(dev);
    dev.answer = body => (body.route === 'send-start' ? { ok: false, error: 'network' } : null);
    await sendFair(first, 2, 'For Thursday.');
    expect(text(first, '#sp-send-title')).toBe('Not sent yet');
    expect(text(first, '.sp-send-line')).toBe(
      'Your 2 photos are saved on this phone. They’ll send when you’re back online.',
    );
    const kept = [...dev.kept.rows.values()].map(r => r.meta);
    expect(kept.map(r => [r.enrollment, r.piece, r.order])).toEqual([
      [CECE, WORK.fair, 0],
      [CECE, WORK.fair, 1],
    ]);
    // What the device keeps: ids, the note and the page sizes. No token, no name, no link.
    const token = JSON.parse(dev.store[KEY]).t;
    expect(JSON.stringify(kept)).not.toMatch(new RegExp(token + '|Cece|https?:'));
    const request = bodyOf(first, 'send-start')[0].request_id;

    dev.answer = null;
    const again = await dev.open('');
    // The send carries on beside `feedback`; the group's counts are asked once `feedback` has answered.
    expect(routes(again)).toEqual([
      'page',
      'work',
      'forms',
      'feedback',
      'send-start',
      'group-work',
      'send-finish',
      'work',
      'file-links',
    ]);
    expect(text(again, '#sp-send-title')).toBe('Sent to Your Teacher');
    expect(bodyOf(again, 'send-start')[0]).toMatchObject({ request_id: request, note: 'For Thursday.' });
    expect([...dev.fn.world.subs.values()].map(s => [s.state, s.files.length, s.note])).toEqual([
      ['sent', 2, 'For Thursday.'],
    ]);
    expect(dev.kept.rows.size).toBe(0);
  });

  it('past the two hours: the page opened again says the send stopped, and Send Again starts a new one', async () => {
    const dev = school();
    const first = await signIn(dev);
    dev.upload = () => 'network';
    await sendFair(first, 1);
    expect(text(first, '#sp-send-title')).toBe('Page 1 didn’t send');
    const request = bodyOf(first, 'send-start')[0].request_id;
    expect([...dev.kept.rows.values()][0].meta.finish_by).toBeGreaterThan(0);

    dev.upload = null;
    const finishBy = [...dev.kept.rows.values()][0].meta.finish_by;
    dev.clock = () => finishBy + 60 * 1000;
    const again = await dev.open('');
    expect(text(again, '#sp-send-title')).toBe('Not sent');
    expect(routes(again)).toEqual(['page', 'work', 'forms', 'feedback', 'group-work']);
    await again.click('[data-act="send-restart"]');
    expect(text(again, '#sp-send-title')).toBe('Sent to Your Teacher');
    expect(bodyOf(again, 'send-start')[0].request_id).not.toBe(request);
    void HOLD;
  });

  it('Done empties the device: nothing of a waiting send is left for the next student', async () => {
    const dev = school();
    const page = await signIn(dev);
    dev.answer = body => (body.route === 'send-start' ? { ok: false, error: 'network' } : null);
    await sendFair(page, 1);
    expect(dev.kept.rows.size).toBe(1);
    await page.click('[data-act="send-done"]');
    await page.click('[data-act="card-done"]');
    expect(dev.kept.rows.size).toBe(0);
  });
});

describe('Unsend and Replace, and the teacher’s pages', () => {
  it('Unsend asks the server, and the piece is back to To Do; Replace sends through `replace`', async () => {
    const dev = school();
    const page = await signIn(dev);
    await sendFair(page, 2);
    await page.click('[data-act="send-done"]');
    await page.click('[data-segment="sent"]');

    await page.click(piece(WORK.fair) + ' [data-act="send-replace"]');
    await page.click('[data-act="send-ask-yes"]');
    expect(text(page, '#sp-send-title')).toBe('Check and Send');
    await page.T.sendFiles([{}], -1);
    await page.settle();
    await page.click('[data-act="send-go"]');
    expect(text(page, '#sp-send-title')).toBe('Sent to Your Teacher');
    expect(bodyOf(page, 'replace')).toHaveLength(1);
    expect([...dev.fn.world.subs.values()].map(s => [s.state, s.files.length])).toEqual([['sent', 1]]);
    await page.click('[data-act="send-done"]');

    dev.answer = body => (body.route === 'unsend' ? { ok: false, error: 'grading_started' } : null);
    await page.click(piece(WORK.fair) + ' [data-act="send-unsend"]');
    await page.click('[data-act="send-ask-yes"]');
    expect(text(page, '#sp-send-ask-title')).toBe('Not Unsent');
    expect(text(page, '#sp-send-ask-body')).toBe('Your teacher has started grading this. Ask your teacher instead.');
    await page.click('[data-act="send-ask-no"]');

    // A refusal is not a lost connection.
    dev.answer = body => (body.route === 'unsend' ? { ok: false, error: 'not_found' } : null);
    await page.click(piece(WORK.fair) + ' [data-act="send-unsend"]');
    await page.click('[data-act="send-ask-yes"]');
    expect(text(page, '#sp-send-ask-body')).toBe('This one can’t be unsent right now. Ask your teacher.');
    await page.click('[data-act="send-ask-no"]');

    dev.answer = null;
    await page.click(piece(WORK.fair) + ' [data-act="send-unsend"]');
    await page.click('[data-act="send-ask-yes"]');
    expect(bodyOf(page, 'unsend').slice(-1)[0]).toMatchObject({ assessment_id: WORK.fair, enrollment_id: CECE });
    expect(page.root().querySelector('.sp-send-ask')).toBeNull();
    expect(text(page, '[data-segment="sent"]')).toBe('Sent 0');
    await page.click('[data-segment="todo"]');
    expect(page.root().querySelector(piece(WORK.fair) + ' [data-act="send-open"]')).toBeTruthy();
    expect(dev.fn.world.subs.size).toBe(0);
  });

  it('work the teacher added that takes the student’s pages too: Send My Work, and theirs go first', async () => {
    const dev = school();
    dev.answer = body =>
      body.route === 'work'
        ? {
            ok: true,
            v: 1,
            send_work: true,
            assessments: [
              {
                id: WORK.fair,
                students_send: 'photos',
                open: true,
                closes_on: null,
                late_now: false,
                sent: {
                  sent_at: TODAY + 'T17:00:00Z',
                  sent_by: 'teacher',
                  pages: 2,
                  grading: false,
                  can_change: false,
                  can_send: true,
                },
                sending: null,
              },
            ],
          }
        : null;
    const page = await signIn(dev);
    await page.click('[data-segment="sent"]');
    expect(text(page, piece(WORK.fair) + ' .sp-send-line')).toBe(
      'Your photos go before the 2 pages your teacher added.',
    );
    await page.click(piece(WORK.fair) + ' [data-act="send-open"]');
    expect(text(page, '#sp-send-title')).toBe('Check and Send');
    expect(page.T.state().send.room).toBe(28);
  });
});
