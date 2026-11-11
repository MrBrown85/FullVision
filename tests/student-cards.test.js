/**
 * Student cards, the teacher's side (S0-W1, S3-W1; the card-codes design,
 * sections 2, 4, 7 and 8): the list in Class Settings › Student Page,
 * Make and Print, and Print Again.
 *
 * The database cannot read a card's code. So:
 *
 * - shared/data.js: making cards asks the teacher-cards edge function with
 *   the teacher's own sign-in, one request_id per press reused on a retry,
 *   never through the outbox; the reply's codes are handed back and kept
 *   nowhere. The list (list_student_cards) keeps no code or password,
 *   whether the server still sends them (today) or not (after S3-M1). A
 *   lost reply is made good without the teacher. Demo Mode keeps the same
 *   contract on the device.
 * - teacher/student-cards.js: Student, Card, Status and no code anywhere;
 *   Make and Print N Cards; Print Again from memory until the screen goes.
 *   An answer that comes after the screen that asked has gone is ignored.
 *
 * Signed-in tests run the real teacher-cards handler over a stand-in
 * database (tests/helpers/fake-teacher-cards.js).
 */
import './setup.js';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, signIn, seedClass, clearClass, settle, serverSaysStudentPageOn } from './helpers/pin-save-paths.js';
import { fakeTeacherCards, fetchFrom } from './helpers/fake-teacher-cards.js';

const CID = 'c-cards';
const LIVE = U(1);
const ON = { student_page_enabled: true, return_grades: 'on_return' };
const LETTER = '[ABCDEFGHJKMNPQRTUVWXYZ2346789]';
const CODE = new RegExp('^' + LETTER + '{4}-' + LETTER + '{4}$');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = 'teacher-access-token-0123456789';
const FN_URL = 'https://sb.test/functions/v1/teacher-cards?forceFunctionRegion=ca-central-1';

const STUDENTS = [
  { id: 's1', firstName: 'Jordan', lastName: 'Abel', dateOfBirth: '2012-03-04' },
  { id: 's2', firstName: 'Avery', lastName: 'Byrne', studentNumber: '1234567' },
  { id: 's3', firstName: 'Noor', lastName: 'Chen' }, // nothing on file: a card password
];
const LIVE_STUDENTS = [
  { id: U(11), firstName: 'Jordan', lastName: 'Abel', dateOfBirth: '2012-03-04' },
  { id: U(12), firstName: 'Avery', lastName: 'Byrne' }, // nothing on file
  { id: U(13), firstName: 'Cam', lastName: 'Cole', studentNumber: '7654321' },
];
const FN_STUDENTS = [
  { id: U(11), first: 'Jordan', birthday: '2012-03-04' },
  { id: U(12), first: 'Avery' },
  { id: U(13), first: 'Cam', number: '7654321' },
];

/* A card as list_student_cards answers today, before S3-M1: the old
   readable code and password, no card number. */
const todays = (n, sid, more) => ({
  id: U(900 + n),
  enrollment_id: sid,
  code: 'K7M-4Q' + n,
  created_at: '2026-11-10T17:00:00+00:00',
  printed_at: null,
  last_opened_at: null,
  locked_at: null,
  wrong_tries: 0,
  wrong_tries_7d: 0,
  works_until: '2027-06-25',
  check: 'identity',
  password: null,
  ...more,
});
// The same card as it answers after S3-M1.
const after = (n, sid, more) => {
  const c = { ...todays(n, sid), seq: 1, has_password: false, needs_new: false, ...more };
  delete c.code;
  delete c.password;
  return c;
};

function seedDemo(config, students) {
  clearClass(CID);
  seedClass(CID, { students: students || STUDENTS, courseConfigs: config || ON });
}
const storedCards = cid => JSON.parse(localStorage.getItem('gb-student-cards-' + (cid || CID)) || 'null');
const cardKeys = () => Object.keys(localStorage._store).filter(k => k.indexOf('student-cards') >= 0);
// Everything this device keeps, as text.
const everythingKept = () => JSON.stringify(localStorage._store) + JSON.stringify(sessionStorage._store);

function parse(html) {
  const doc = parseHTML('<!doctype html><html><head></head><body></body></html>').document;
  const box = doc.createElement('div');
  box.innerHTML = html;
  return box;
}
const rowsOf = box =>
  Array.from(box.querySelectorAll('.sc-table tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent));
const buttons = box => Array.from(box.querySelectorAll('button')).map(b => b.textContent);
const noteOf = box => (box.querySelector('.sc-note') ? box.querySelector('.sc-note').textContent : null);
const el = cid => ({ closest: () => ({ dataset: { cid } }) });

/* The list reads its cards only when its own card is on the page
   (StudentCards looks for .sc-card a moment after a draw). `onPage` is the
   class whose card the page holds; shown() draws the card as the open
   Student Page tab does and waits for the read. */
let onPage = null;
const realQuery = document.querySelector;
const afterDraw = async () => {
  await new Promise(r => setTimeout(r, 5));
  await settle();
};
async function shown(cid) {
  onPage = cid;
  StudentCards.render(cid);
  await afterDraw();
}

/* Print with the dialog held shut: what is on the sheet while it is open.
   The sheet is drawn into a linkedom document for the test's length. */
let sheets;
let restore;
function catchPrints() {
  const doc = parseHTML('<!doctype html><html><head></head><body><main id="app"></main></body></html>').document;
  restore = {
    document: globalThis.document,
    print: window.print,
    origin: location.origin,
    add: window.addEventListener,
    remove: window.removeEventListener,
  };
  doc.querySelector = function (selector) {
    if (selector === '.sc-card') return onPage ? { dataset: { cid: onPage } } : null;
    return Object.getPrototypeOf(doc).querySelector.call(doc, selector);
  };
  globalThis.document = doc;
  location.origin = 'https://fullvision.ca';
  window.addEventListener = () => {};
  window.removeEventListener = () => {};
  sheets = [];
  window.print = () => {
    const root = doc.getElementById('qr-slips-root');
    sheets.push({
      pages: Array.from(root.querySelectorAll('.qs-page')).map(p => p.children.length),
      names: Array.from(root.querySelectorAll('.qs-name')).map(e => e.textContent),
      classes: Array.from(new Set(Array.from(root.querySelectorAll('.qs-class')).map(e => e.textContent))),
      numbers: Array.from(root.querySelectorAll('.qs-what .qs-dates')).map(e => e.textContent),
      codes: Array.from(root.querySelectorAll('.qs-type:not(.qs-pass) strong')).map(e => e.textContent),
      passwords: Array.from(root.querySelectorAll('.qs-pass strong')).map(e => e.textContent),
      qrs: root.querySelectorAll('.qs-qr svg').length,
      text: root.textContent,
    });
  };
  return doc;
}
function releasePrints() {
  if (!restore) return;
  globalThis.document = restore.document;
  window.print = restore.print;
  location.origin = restore.origin;
  window.addEventListener = restore.add;
  window.removeEventListener = restore.remove;
  restore = null;
}

let wasOpen;
let realFetch;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  StudentCards._reset();
  onPage = null;
  document.querySelector = function (selector) {
    if (selector === '.sc-card') return onPage ? { dataset: { cid: onPage } } : null;
    return realQuery.call(document, selector);
  };
  // Class Settings is open: an answer to a press may draw.
  wasOpen = { open: DashClassManager.classManagerOpen, draw: DashClassManager.renderClassManager };
  DashClassManager.classManagerOpen = true;
  // Class Settings itself is not on this page: a redraw draws nothing.
  DashClassManager.renderClassManager = () => {};
  realFetch = globalThis.fetch;
  window.__ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_KEY: 'anon-key-for-tests' };
});
afterEach(() => {
  releasePrints();
  document.querySelector = realQuery;
  DashClassManager.classManagerOpen = wasOpen.open;
  DashClassManager.renderClassManager = wasOpen.draw;
  globalThis.fetch = realFetch;
  delete window.__ENV;
  serverSaysStudentPageOn(LIVE, false);
  clearClass(CID);
  clearClass(LIVE);
  StudentCards._reset();
  localStorage.clear();
  sessionStorage.clear();
});

/* A signed-in teacher with the class LIVE, its student page on, and the
   teacher-cards function answered by its real handler. */
async function signedIn(opts = {}) {
  seedClass(LIVE, { students: opts.students || LIVE_STUDENTS, courseConfigs: ON });
  serverSaysStudentPageOn(LIVE);
  const session = signIn();
  const tokens = [TOKEN];
  session.fake.auth = {
    getSession: async () => ({ data: { session: { access_token: tokens[0] } }, error: null }),
  };
  const fn = await fakeTeacherCards({ course: LIVE, students: opts.fnStudents || FN_STUDENTS, tokens: [TOKEN] });
  const fetcher = fetchFrom(fn, opts.fetch || {});
  globalThis.fetch = fetcher;
  session.fake.on('list_student_cards', () => ({ data: opts.list ? opts.list(fn) : fn.cardsListed(), error: null }));
  session.fake.on('mark_student_cards_printed', p => ({ data: fn.markPrinted(p.p_card_ids), error: null }));
  return { session, fn, fetcher, tokens };
}

describe('Demo Mode: the same contract, on this device', () => {
  beforeEach(() => seedDemo());
  const firsts = ids => ids.map(enrollment_id => ({ enrollment_id, replaces: null }));

  it('making cards returns each code once, eight characters; the saved card keeps no code or password', async () => {
    expect((await listStudentCards(CID)).data).toEqual([]);
    const out = (await makeStudentCards(CID, firsts(['s1', 's2', 's3']))).data;
    expect(out.results.map(r => [r.enrollment_id, r.result, r.seq])).toEqual([
      ['s1', 'made', 1],
      ['s2', 'made', 1],
      ['s3', 'made', 1],
    ]);
    out.results.forEach(r => {
      expect(r.code).toMatch(CODE);
      expect(r.card_id).toBeTruthy();
      expect(r.works_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    expect(new Set(out.results.map(r => r.code)).size).toBe(3);
    // A password only for the student with nothing on file.
    expect(out.results.map(r => 'password' in r)).toEqual([false, false, true]);
    expect(out.results[2].password).toMatch(/^\d{4}$/);
    // Saved: the cards, and not one code or password.
    const kept = storedCards();
    expect(kept.length).toBe(3);
    kept.forEach(c => {
      expect('code' in c).toBe(false);
      expect('password' in c).toBe(false);
    });
    out.results.forEach(r => expect(everythingKept()).not.toContain(r.code));
    expect(everythingKept()).not.toContain(out.results[2].password);
    const listed = (await listStudentCards(CID)).data;
    expect(listed.map(c => [c.id, c.enrollment_id, c.seq, c.has_password])).toEqual(
      out.results.map((r, i) => [r.card_id, r.enrollment_id, 1, i === 2]),
    );
    expect(JSON.stringify(listed)).not.toMatch(/"(code|password)":/);
  });

  it('a new card replaces the one named, with the next number; one whose live card is another is changed', async () => {
    const one = (await makeStudentCards(CID, firsts(['s1', 's2']))).data.results;
    const two = (
      await makeStudentCards(CID, [
        { enrollment_id: 's1', replaces: one[0].card_id },
        { enrollment_id: 's2', replaces: null }, // s2 has a card: another tab's view
        { enrollment_id: 'gone', replaces: null },
      ])
    ).data.results;
    expect(two.map(r => [r.enrollment_id, r.result, r.seq || null])).toEqual([
      ['s1', 'made', 2],
      ['s2', 'changed', null],
      ['gone', 'not_found', null],
    ]);
    expect(two[0].code).toMatch(CODE);
    expect(two[0].code).not.toBe(one[0].code);
    expect('code' in two[1]).toBe(false);
    const listed = (await listStudentCards(CID)).data;
    expect(listed.map(c => [c.id, c.seq])).toEqual([
      [two[0].card_id, 2],
      [one[1].card_id, 1],
    ]);
  });

  it('a code and password an older build saved are dropped on read, and from the device', async () => {
    localStorage.setItem(
      'gb-student-cards-' + CID,
      JSON.stringify([{ ...todays(1, 's3'), id: 'old-1', code: 'K7M-4QX', check: 'password', password: '4821' }]),
    );
    const listed = (await listStudentCards(CID)).data;
    expect(listed.length).toBe(1);
    expect(listed[0]).not.toHaveProperty('code');
    expect(listed[0]).not.toHaveProperty('password');
    expect(listed[0].check).toBe('password');
    expect(everythingKept()).not.toMatch(/K7M-4QX|4821/);
  });

  it('the list is in roster order and leaves out a student no longer in the class', async () => {
    await makeStudentCards(CID, firsts(['s1', 's3']));
    saveStudents(CID, [STUDENTS[2], STUDENTS[0]]);
    expect((await listStudentCards(CID)).data.map(c => c.enrollment_id)).toEqual(['s3', 's1']);
  });

  it('a card works until the class’s last reporting date, or the next June 30 with none ahead', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-10T18:00:00.000Z'));
      expect((await makeStudentCards(CID, firsts(['s1']))).data.results[0].works_until).toBe('2027-06-30');
      seedDemo({
        ...ON,
        reportingTerms: [
          { ordinal: 1, label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-06' },
          { ordinal: 2, label: 'Term 2', starts_on: '2026-11-09', ends_on: '2027-01-29' },
        ],
      });
      localStorage.removeItem('gb-student-cards-' + CID);
      expect((await makeStudentCards(CID, firsts(['s1']))).data.results[0].works_until).toBe('2027-01-29');
      vi.setSystemTime(new Date('2027-07-02T18:00:00.000Z'));
      localStorage.removeItem('gb-student-cards-' + CID);
      expect((await makeStudentCards(CID, firsts(['s1']))).data.results[0].works_until).toBe('2028-06-30');
    } finally {
      vi.useRealTimers();
    }
  });

  it('marking cards printed keeps the time', async () => {
    const made = (await makeStudentCards(CID, firsts(['s1', 's2', 's3']))).data.results;
    const out = (await markStudentCardsPrinted(CID, [made[0].card_id, made[2].card_id])).data;
    expect(out.printed).toBe(2);
    const now = (await listStudentCards(CID)).data;
    expect(now.map(c => c.printed_at)).toEqual([out.printed_at, null, out.printed_at]);
  });

  it('nothing is fetched: Demo Mode never asks the function', async () => {
    let fetched = 0;
    globalThis.fetch = async () => {
      fetched += 1;
      throw new TypeError('no');
    };
    await makeStudentCards(CID, firsts(['s1']));
    expect(fetched).toBe(0);
  });

  it('a class whose student page is off has no cards: nothing is made, read or kept', async () => {
    seedDemo({ return_grades: 'on_return' });
    expect((await listStudentCards(CID)).data).toBe(null);
    expect((await makeStudentCards(CID, firsts(['s1']))).data).toBe(null);
    expect((await markStudentCardsPrinted(CID, ['x'])).data).toBe(null);
    expect(cardKeys()).toEqual([]);
  });

  it('deleting the class takes its cards off the device', async () => {
    await makeStudentCards(CID, firsts(['s1']));
    expect(cardKeys()).toEqual(['gb-student-cards-' + CID]);
    _clearCourseLocalState(CID);
    expect(cardKeys()).toEqual([]);
  });
});

describe('a signed-in teacher: the list', () => {
  afterEach(() => {
    if (globalThis.__session) globalThis.__session.signOut();
    delete globalThis.__session;
  });

  it('today’s reply still carries the code and password: both are dropped as it arrives', async () => {
    const t = await signedIn({
      list: () => [todays(1, U(11)), todays(2, U(12), { check: 'password', password: '4821' })],
    });
    globalThis.__session = t.session;
    const out = await listStudentCards(LIVE);
    expect(out.error).toBe(null);
    expect(out.data.map(c => c.id)).toEqual([U(901), U(902)]);
    out.data.forEach(c => {
      expect(c).not.toHaveProperty('code');
      expect(c).not.toHaveProperty('password');
      expect(c).not.toHaveProperty('seq');
    });
    expect(t.session.sent()).toEqual([['list_student_cards', { p_course_id: LIVE }]]);
    expect(cardKeys()).toEqual([]);
    expect(everythingKept()).not.toMatch(/K7M-4Q|4821/);
  });

  it('the reply after S3-M1 is kept as it is: card number, has_password, needs_new', async () => {
    const t = await signedIn({ list: () => [after(1, U(11), { seq: 2, has_password: true, needs_new: true })] });
    globalThis.__session = t.session;
    const out = await listStudentCards(LIVE);
    expect(out.data).toEqual([after(1, U(11), { seq: 2, has_password: true, needs_new: true })]);
  });

  it('a list that could not be read answers no data and its error', async () => {
    const t = await signedIn();
    globalThis.__session = t.session;
    t.session.fake.on('list_student_cards', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
    expect((await listStudentCards(LIVE)).data).toBe(null);
  });
});

describe('a signed-in teacher: making cards asks teacher-cards', () => {
  let t;
  afterEach(() => t && t.session.signOut());
  const firsts = ids => ids.map(enrollment_id => ({ enrollment_id, replaces: null }));

  it('one POST with the teacher’s own sign-in; the codes come back once and are kept nowhere', async () => {
    t = await signedIn();
    const warned = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((...a) => warned.push(a));
    try {
      const out = await makeStudentCards(LIVE, firsts([U(11), U(12), U(13)]));
      expect(out.error).toBe(null);
      expect(out.data.results.map(r => [r.enrollment_id, r.result, r.seq])).toEqual([
        [U(11), 'made', 1],
        [U(12), 'made', 1],
        [U(13), 'made', 1],
      ]);
      out.data.results.forEach(r => {
        expect(r.code).toMatch(CODE);
        expect(r.card_id).toBe(t.fn.live(r.enrollment_id).id);
      });
      // Avery has nothing on file: only her card carries a password.
      expect(out.data.results.map(r => typeof r.password)).toEqual(['undefined', 'string', 'undefined']);
      // The request: the function's address in Canada, the teacher's own token, a request id, and ids only.
      expect(t.fn.posts.length).toBe(1);
      const post = t.fn.posts[0];
      expect(post.url).toBe(FN_URL);
      expect(post.headers.authorization).toBe('Bearer ' + TOKEN);
      expect(post.headers.apikey).toBe('anon-key-for-tests');
      expect(Object.keys(post.body).sort()).toEqual(['course_id', 'items', 'request_id']);
      expect(post.body.course_id).toBe(LIVE);
      expect(post.body.request_id).toMatch(UUID);
      expect(post.body.items).toEqual(firsts([U(11), U(12), U(13)]));
      // No RPC, nothing queued, nothing kept, nothing logged.
      expect(t.session.sent()).toEqual([]);
      expect(localStorage.getItem('fv-sync-queue-v1')).toBe(null);
      const codes = out.data.results.map(r => r.code).concat(out.data.results[1].password);
      codes.forEach(code => {
        expect(everythingKept()).not.toContain(code);
        expect(everythingKept()).not.toContain(code.replace('-', ''));
        expect(JSON.stringify(warned)).not.toContain(code);
      });
      // The database was handed tags, never a code.
      expect(JSON.stringify(t.fn.db.state.handed)).not.toContain(codes[0].replace('-', ''));
    } finally {
      warn.mockRestore();
    }
  });

  it('a card is replaced by naming it; one another tab replaced first is changed and gets no code', async () => {
    t = await signedIn();
    const one = (await makeStudentCards(LIVE, firsts([U(11), U(12)]))).data.results;
    const two = (
      await makeStudentCards(LIVE, [
        { enrollment_id: U(11), replaces: one[0].card_id },
        { enrollment_id: U(12), replaces: null },
      ])
    ).data.results;
    expect(two.map(r => [r.result, r.seq || null])).toEqual([
      ['made', 2],
      ['changed', null],
    ]);
    expect(two[0].code).toMatch(CODE);
    expect('code' in two[1]).toBe(false);
    // Each press is a request of its own.
    expect(t.fn.posts[1].body.request_id).not.toBe(t.fn.posts[0].body.request_id);
  });

  it('a request that never arrived is sent again under the same request id, and makes each card once', async () => {
    t = await signedIn({ fetch: { fail: (post, n) => n === 1 } });
    const out = await makeStudentCards(LIVE, firsts([U(11)]));
    expect(out.data.results[0].code).toMatch(CODE);
    expect(t.fetcher.count()).toBe(2);
    expect(t.fn.posts.length).toBe(1);
    expect(t.fn.db.state.cards.length).toBe(1);
  });

  it('a reply lost on the way back: the retry is a replay with no codes, and the cards are asked for again', async () => {
    t = await signedIn({ fetch: { lose: (post, n) => n === 1 } });
    const out = await makeStudentCards(LIVE, firsts([U(11), U(12)]));
    expect(out.error).toBe(null);
    const [lost, retry, again] = t.fn.posts;
    expect(t.fn.posts.length).toBe(3);
    // The retry is the same request: the server answers what it did, with no codes.
    expect(retry.body).toEqual(lost.body);
    // Then a new request naming the cards the first one made.
    const firstCards = t.fn.db.state.cards.slice(0, 2);
    expect(again.body.request_id).not.toBe(lost.body.request_id);
    expect(again.body.items).toEqual(firstCards.map(k => ({ enrollment_id: k.enrollment_id, replaces: k.id })));
    // Fresh codes, for the live cards, numbered 2; the unprinted first cards are stopped.
    expect(out.data.results.map(r => [r.result, r.seq])).toEqual([
      ['made', 2],
      ['made', 2],
    ]);
    out.data.results.forEach(r => {
      expect(r.code).toMatch(CODE);
      expect(r.card_id).toBe(t.fn.live(r.enrollment_id).id);
    });
    expect(firstCards.every(k => k.stopped)).toBe(true);
  });

  it('if the second ask fails too, the cards are answered made with no code: unprinted, and nothing is said', async () => {
    t = await signedIn({ fetch: { lose: (post, n) => n === 1, fail: (post, n) => n >= 3 } });
    const out = await makeStudentCards(LIVE, firsts([U(11)]));
    expect(out.error).toBe(null);
    expect(out.data.results).toEqual([
      expect.objectContaining({ enrollment_id: U(11), result: 'made', card_id: t.fn.live(U(11)).id }),
    ]);
    expect(out.data.results[0].code).toBe(undefined);
  });

  it.each([
    [404, 'not_found'],
    [400, 'bad_request'],
    [500, 'server'],
    [421, 'wrong_region'],
  ])('a refusal (%i) answers no data and makes nothing', async (status, error) => {
    t = await signedIn({ fetch: { answer: () => ({ status, json: { ok: false, error } }) } });
    const out = await makeStudentCards(LIVE, firsts([U(11)]));
    expect(out.data).toBe(null);
    expect(out.error).toEqual({ status, error });
    expect(t.fn.db.state.cards).toEqual([]);
  });

  it('no connection at all: no data, after one retry', async () => {
    t = await signedIn({ fetch: { fail: () => true } });
    const out = await makeStudentCards(LIVE, firsts([U(11)]));
    expect(out).toEqual({ data: null, error: { status: 0, error: 'network' } });
    expect(t.fetcher.count()).toBe(2);
  });

  it('a sign-in that ran out is renewed once, and the same request is sent again', async () => {
    t = await signedIn();
    t.tokens[0] = 'an-expired-token-0123456789';
    const was = globalThis.refreshSupabaseSession;
    globalThis.refreshSupabaseSession = async () => ({ session: { access_token: TOKEN } });
    try {
      const out = await makeStudentCards(LIVE, firsts([U(11)]));
      expect(out.data.results[0].code).toMatch(CODE);
      expect(t.fn.posts.map(p => p.headers.authorization)).toEqual([
        'Bearer an-expired-token-0123456789',
        'Bearer ' + TOKEN,
      ]);
      expect(t.fn.posts[1].body).toEqual(t.fn.posts[0].body);
    } finally {
      globalThis.refreshSupabaseSession = was;
    }
  });

  it('only server ids are sent; a class whose student page is off is sent nothing', async () => {
    t = await signedIn();
    await makeStudentCards(LIVE, [
      { enrollment_id: U(11), replaces: null },
      { enrollment_id: 'slocal-1', replaces: null },
      { enrollment_id: U(12), replaces: 'c-local' },
    ]);
    expect(t.fn.posts[0].body.items).toEqual([{ enrollment_id: U(11), replaces: null }]);
    seedClass(LIVE, { students: LIVE_STUDENTS, courseConfigs: { return_grades: 'on_return' } });
    expect((await makeStudentCards(LIVE, firsts([U(11)]))).data).toBe(null);
    expect(t.fetcher.count()).toBe(1);
  });

  it('marking cards printed is mark_student_cards_printed, with a key and server ids only', async () => {
    t = await signedIn();
    const out = await markStudentCardsPrinted(LIVE, [U(901), 'not-a-card', U(902)]);
    expect(out.data.printed).toBe(2);
    await settle();
    const sent = t.session.fake.calls;
    expect(sent.map(c => c.name)).toEqual(['mark_student_cards_printed']);
    expect(Object.keys(sent[0].params).sort()).toEqual(['p_card_ids', 'p_idempotency_key']);
    expect(sent[0].params.p_card_ids).toEqual([U(901), U(902)]);
    expect(sent[0].params.p_idempotency_key).toMatch(UUID);
  });
});

describe('the list in Class Settings › Student Page', () => {
  it('first says it is loading, then lists every student, A to Z, with no card yet', async () => {
    seedDemo();
    onPage = CID;
    let box = parse(StudentCards.render(CID));
    expect(box.querySelector('h2').textContent).toBe('Student Cards');
    expect(noteOf(box)).toBe('Loading cards…');
    expect(box.querySelector('.sc-table')).toBe(null);
    expect(buttons(box)).toEqual([]);
    await afterDraw();
    box = parse(StudentCards.render(CID));
    expect(noteOf(box)).toBe(null);
    expect(Array.from(box.querySelectorAll('.sc-table thead th')).map(th => th.textContent)).toEqual([
      'Student',
      'Card',
      'Status',
    ]);
    expect(rowsOf(box)).toEqual([
      ['Jordan Abel', 'No Card Yet', ''],
      ['Avery Byrne', 'No Card Yet', ''],
      ['Noor Chen', 'No Card Yet', ''],
    ]);
    expect(buttons(box)).toEqual(['Make and Print 3 Cards']);
    expect(box.querySelector('[data-cid]').dataset.cid).toBe(CID);
  });

  it('draws today’s reply with no code and no number, and each status', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T18:00:00.000Z'));
    const students = [
      ...LIVE_STUDENTS,
      { id: U(14), firstName: 'Dee', lastName: 'Dunn' },
      { id: U(15), firstName: 'Eli', lastName: 'Eng' },
      { id: U(16), firstName: 'Fay', lastName: 'Fox' },
    ];
    const t = await signedIn({
      students,
      list: () => [
        todays(1, U(11), { printed_at: '2026-11-12T19:30:00+00:00' }),
        todays(2, U(12), { check: 'password', password: '4821' }),
        todays(3, U(13), { printed_at: '2026-11-12T19:30:00+00:00', last_opened_at: '2026-11-14T16:00:00+00:00' }),
        todays(4, U(14), { printed_at: '2026-11-12T19:30:00+00:00', locked_at: '2026-11-15T16:00:00+00:00' }),
        todays(5, U(15), { printed_at: '2026-11-12T19:30:00+00:00', works_until: '2026-11-19' }),
      ],
    });
    try {
      await shown(LIVE);
      const box = parse(StudentCards.render(LIVE));
      expect(rowsOf(box)).toEqual([
        ['Jordan Abel', 'Made Nov 10', 'Printed Nov 12'],
        ['Avery Byrne', 'Made Nov 10', 'Not Printed'],
        ['Cam Cole', 'Made Nov 10', 'Last Opened Nov 14'],
        ['Dee Dunn', 'Made Nov 10', 'Locked'],
        ['Eli Eng', 'Made Nov 10', 'Past Its Last Day'],
        ['Fay Fox', 'No Card Yet', ''],
      ]);
      expect(box.querySelector('.sc-lock').textContent).toBe('Locked');
      expect(box.textContent).not.toMatch(/K7M|4821/);
      // Avery's never-printed card, and Fay with none.
      expect(buttons(box)).toEqual(['Make and Print 2 Cards']);
    } finally {
      vi.useRealTimers();
      t.session.signOut();
    }
  });

  it('draws the reply after S3-M1: the card number, and Needs a New Card', async () => {
    const t = await signedIn({
      list: () => [
        after(1, U(11), { seq: 2, printed_at: '2026-11-12T19:30:00+00:00' }),
        after(2, U(12), { seq: 1, needs_new: true, printed_at: '2026-11-12T19:30:00+00:00' }),
        after(3, U(13), { seq: 3 }),
      ],
    });
    try {
      await shown(LIVE);
      const box = parse(StudentCards.render(LIVE));
      expect(rowsOf(box)).toEqual([
        ['Jordan Abel', 'Card 2 · Made Nov 10', 'Printed Nov 12'],
        ['Avery Byrne', 'Card 1 · Made Nov 10', 'Needs a New Card'],
        ['Cam Cole', 'Card 3 · Made Nov 10', 'Not Printed'],
      ]);
      expect(buttons(box)).toEqual(['Make and Print 1 Card']);
    } finally {
      t.session.signOut();
    }
  });

  it('a list that could not be read says so, with Try Again, and does not ask again by itself', async () => {
    const t = await signedIn();
    try {
      t.session.fake.on('list_student_cards', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
      await shown(LIVE);
      const box = parse(StudentCards.render(LIVE));
      expect(noteOf(box)).toBe('Could not load the cards. Check the connection and try again.');
      expect(box.querySelector('.sc-table')).toBe(null);
      expect(buttons(box)).toEqual(['Try Again']);
      await shown(LIVE);
      await shown(LIVE);
      expect(t.session.sent().length).toBe(1);
      t.session.fake.on('list_student_cards', () => ({ data: [after(1, U(11), { seq: 1 })], error: null }));
      expect(CmStudentPage.handleAction('spCardsRetry', el(LIVE))).toBe(true);
      expect(noteOf(parse(StudentCards.render(LIVE)))).toBe('Loading cards…');
      await afterDraw();
      expect(t.session.sent().length).toBe(2);
      const again = parse(StudentCards.render(LIVE));
      expect(noteOf(again)).toBe(null);
      expect(rowsOf(again)[0]).toEqual(['Jordan Abel', 'Card 1 · Made Nov 10', 'Not Printed']);
      expect(buttons(again)).toEqual(['Make and Print 3 Cards']);
    } finally {
      t.session.signOut();
    }
  });

  it('the cards are read only when the list is on the page', async () => {
    const t = await signedIn();
    try {
      onPage = null;
      StudentCards.render(LIVE);
      CmStudentPage.render(LIVE);
      await afterDraw();
      expect(t.session.sent()).toEqual([]);
      onPage = CID;
      StudentCards.render(LIVE);
      await afterDraw();
      expect(t.session.sent()).toEqual([]);
      await shown(LIVE);
      await shown(LIVE);
      expect(t.session.sent()).toEqual([['list_student_cards', { p_course_id: LIVE }]]);
    } finally {
      t.session.signOut();
    }
  });

  it('a class with no students says so', async () => {
    seedDemo(ON, []);
    await shown(CID);
    const box = parse(StudentCards.render(CID));
    expect(noteOf(box)).toBe('No students to make cards for.');
    expect(buttons(box)).toEqual([]);
  });

  it('a name is escaped', async () => {
    seedDemo(ON, [{ id: 's1', firstName: '<img src=x onerror=alert(1)>', lastName: 'O’Neil & Co' }]);
    await shown(CID);
    const html = StudentCards.render(CID);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; O’Neil &amp; Co');
  });

  it('the clicks are handed over by the tab only for a class whose student page is on', async () => {
    catchPrints();
    seedDemo({ return_grades: 'on_return' });
    expect(CmStudentPage.handleAction('spCardsMake', el(CID))).toBe(false);
    expect(CmStudentPage.handleAction('spCardsPrintAgain', el(CID))).toBe(false);
    await settle();
    expect(cardKeys()).toEqual([]);
    seedDemo();
    await shown(CID);
    expect(CmStudentPage.handleAction('spCardsMake', el(CID))).toBe(true);
    await afterDraw();
    expect(storedCards().length).toBe(3);
  });
});

describe('Make and Print, and Print Again', () => {
  beforeEach(() => catchPrints());

  it('Demo Mode: one press makes every card and prints it; the list shows no code; Print Again prints the same', async () => {
    seedDemo();
    COURSES[CID].block = 'B';
    await shown(CID);
    const done = await StudentCards.makeAndPrint(CID);
    expect(done).toBe(3);
    expect(sheets.length).toBe(1);
    const sheet = sheets[0];
    expect(sheet.names).toEqual(['Jordan Abel', 'Avery Byrne', 'Noor Chen']);
    expect(sheet.classes).toEqual(['Science 8 · Block B']);
    expect(sheet.numbers).toEqual(['Card 1', 'Card 1', 'Card 1']);
    sheet.codes.forEach(code => expect(code).toMatch(CODE));
    expect(new Set(sheet.codes).size).toBe(3);
    // Only Noor's card carries a password.
    expect(sheet.passwords.length).toBe(1);
    expect(sheet.passwords[0]).toMatch(/^\d{4}$/);
    expect(sheet.qrs).toBe(3);
    expect(sheet.text).toContain('Scan with your phone camera.');
    expect(sheet.text).not.toMatch(/once/i);
    // The sheet comes off the page once the dialog closes.
    await new Promise(r => setTimeout(r, 5));
    expect(document.getElementById('qr-slips-root').innerHTML).toBe('');
    await settle();

    // The list: no code, every card printed, the line and Print Again.
    let box = parse(StudentCards.render(CID));
    rowsOf(box).forEach(r => {
      expect(r[1]).toMatch(/^Card 1 · Made /);
      expect(r[2]).toMatch(/^Printed /);
    });
    sheet.codes.concat(sheet.passwords).forEach(code => {
      expect(box.textContent).not.toContain(code);
      expect(everythingKept()).not.toContain(code);
    });
    expect(noteOf(box)).toBe(
      '3 cards went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
    );
    expect(buttons(box)).toEqual(['Print Again']);
    expect(storedCards().every(c => !!c.printed_at)).toBe(true);

    // Print Again: the same codes, and nothing made.
    const before = JSON.stringify(storedCards());
    expect(CmStudentPage.handleAction('spCardsPrintAgain', el(CID))).toBe(true);
    expect(sheets.length).toBe(2);
    expect(sheets[1].codes).toEqual(sheet.codes);
    expect(sheets[1].passwords).toEqual(sheet.passwords);
    expect(JSON.stringify(storedCards())).toBe(before);
  });

  it('a press replaces the never-printed cards and makes the missing ones; printed cards are left alone', async () => {
    seedDemo();
    await shown(CID);
    const first = (
      await makeStudentCards(CID, [
        { enrollment_id: 's1', replaces: null },
        { enrollment_id: 's2', replaces: null },
      ])
    ).data.results;
    await markStudentCardsPrinted(CID, [first[0].card_id]);
    StudentCards._reset();
    await shown(CID);
    expect(buttons(parse(StudentCards.render(CID)))).toEqual(['Make and Print 2 Cards']);
    await StudentCards.makeAndPrint(CID);
    expect(sheets[0].names).toEqual(['Avery Byrne', 'Noor Chen']);
    expect(sheets[0].numbers).toEqual(['Card 2', 'Card 1']);
    const listed = (await listStudentCards(CID)).data;
    expect(listed.map(c => [c.enrollment_id, c.seq])).toEqual([
      ['s1', 1],
      ['s2', 2],
      ['s3', 1],
    ]);
    expect(listed[0].id).toBe(first[0].card_id);
    expect(buttons(parse(StudentCards.render(CID)))).toEqual(['Print Again']);
  });

  it('signed in: the request names the cards it replaces, and the printed codes are the function’s', async () => {
    const t = await signedIn({
      list: () => [after(2, U(12), { seq: 1 }), after(3, U(13), { seq: 1, printed_at: '2026-11-12T19:30:00+00:00' })],
    });
    try {
      // The stand-in function's own record of Avery's never-printed card.
      t.fn.db.state.cards.push({
        id: U(902),
        enrollment_id: U(12),
        code_hmac: 'x',
        pw_hmac: null,
        seq: 1,
        stopped: false,
      });
      await shown(LIVE);
      expect(buttons(parse(StudentCards.render(LIVE)))).toEqual(['Make and Print 2 Cards']);
      await StudentCards.makeAndPrint(LIVE);
      expect(t.fn.posts[0].body.items).toEqual([
        { enrollment_id: U(11), replaces: null },
        { enrollment_id: U(12), replaces: U(902) },
      ]);
      expect(sheets[0].names).toEqual(['Jordan Abel', 'Avery Byrne']);
      expect(sheets[0].numbers).toEqual(['Card 1', 'Card 2']);
      expect(sheets[0].passwords.length).toBe(1);
      await settle();
      const marked = t.session.fake.calls.filter(c => c.name === 'mark_student_cards_printed');
      expect(marked.length).toBe(1);
      expect(marked[0].params.p_card_ids).toEqual([t.fn.live(U(11)).id, t.fn.live(U(12)).id]);
      const box = parse(StudentCards.render(LIVE));
      sheets[0].codes.forEach(code => {
        expect(box.textContent).not.toContain(code);
        expect(everythingKept()).not.toContain(code);
      });
      expect(rowsOf(box).map(r => [r[1].replace(/Made .*/, 'Made'), r[2].replace(/ .*/, '')])).toEqual([
        ['Card 1 · Made', 'Printed'],
        ['Card 2 · Made', 'Printed'],
        ['Card 1 · Made', 'Printed'],
      ]);
    } finally {
      t.session.signOut();
    }
  });

  it('a lost reply ends with printed cards and no message', async () => {
    const t = await signedIn({ fetch: { lose: (post, n) => n === 1 } });
    try {
      await shown(LIVE);
      await StudentCards.makeAndPrint(LIVE);
      expect(sheets.length).toBe(1);
      expect(sheets[0].names).toEqual(['Jordan Abel', 'Avery Byrne', 'Cam Cole']);
      expect(t.fn.posts.length).toBe(3);
      // The codes printed are the live cards'.
      expect(sheets[0].numbers).toEqual(['Card 2', 'Card 2', 'Card 2']);
      await settle();
      const box = parse(StudentCards.render(LIVE));
      expect(noteOf(box)).toBe(
        '3 cards went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
      );
      rowsOf(box).forEach(r => expect(r[2]).toMatch(/^Printed /));
    } finally {
      t.session.signOut();
    }
  });

  it('a refusal or no connection: one line near the button, nothing printed, nothing held', async () => {
    const t = await signedIn({ fetch: { fail: () => true } });
    try {
      await shown(LIVE);
      await StudentCards.makeAndPrint(LIVE);
      expect(sheets).toEqual([]);
      expect(StudentCards._holding()).toBe(false);
      const box = parse(StudentCards.render(LIVE));
      expect(noteOf(box)).toBe('Could not make the cards. Check the connection and try again.');
      expect(buttons(box)).toEqual(['Make and Print 3 Cards']);
      expect(rowsOf(box).map(r => r[1])).toEqual(['No Card Yet', 'No Card Yet', 'No Card Yet']);
      expect(t.fn.db.state.cards).toEqual([]);
    } finally {
      t.session.signOut();
    }
  });

  it('pressed twice is one request; the button is off while it is out', async () => {
    let release;
    const gate = new Promise(r => (release = r));
    const t = await signedIn({ fetch: { hold: () => gate } });
    try {
      await shown(LIVE);
      CmStudentPage.handleAction('spCardsMake', el(LIVE));
      CmStudentPage.handleAction('spCardsMake', el(LIVE));
      CmStudentPage.handleAction('spCardsMake', el(LIVE));
      await settle();
      expect(t.fetcher.count()).toBe(1);
      const waiting = parse(StudentCards.render(LIVE));
      expect(noteOf(waiting)).toBe('Making cards…');
      expect(waiting.querySelector('[data-action="spCardsMake"]').hasAttribute('disabled')).toBe(true);
      release();
      await afterDraw();
      expect(sheets.length).toBe(1);
      expect(t.fn.posts.length).toBe(1);
    } finally {
      t.session.signOut();
    }
  });

  it.each([
    ['Class Settings closes', () => (DashClassManager.classManagerOpen = false)],
    ['another tab is shown', () => (onPage = null)],
    ['another class is shown', () => (onPage = CID)],
  ])('an answer that comes after %s draws nothing and prints nothing', async (what, leave) => {
    let release;
    const gate = new Promise(r => (release = r));
    const t = await signedIn({ fetch: { hold: () => gate } });
    try {
      await shown(LIVE);
      const pressed = StudentCards.makeAndPrint(LIVE);
      await settle();
      leave();
      release();
      expect(await pressed).toBe(0);
      expect(sheets).toEqual([]);
      expect(StudentCards._holding()).toBe(false);
      // The cards were made; back on the screen they read again and show Not Printed.
      DashClassManager.classManagerOpen = true;
      await shown(LIVE);
      const box = parse(StudentCards.render(LIVE));
      expect(noteOf(box)).toBe(null);
      expect(rowsOf(box).map(r => r[2])).toEqual(['Not Printed', 'Not Printed', 'Not Printed']);
      expect(buttons(box)).toEqual(['Make and Print 3 Cards']);
    } finally {
      t.session.signOut();
    }
  });

  it('an answer that comes after the screen went and came back is still ignored', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let release;
    const gate = new Promise(r => (release = r));
    const t = await signedIn({ fetch: { hold: () => gate } });
    try {
      await shown(LIVE);
      const pressed = StudentCards.makeAndPrint(LIVE);
      await settle();
      onPage = null;
      vi.advanceTimersByTime(1000); // the watch sees the card gone
      onPage = LIVE;
      release();
      expect(await pressed).toBe(0);
      expect(sheets).toEqual([]);
    } finally {
      vi.useRealTimers();
      t.session.signOut();
    }
  });

  it.each([
    ['Class Settings closes', () => (DashClassManager.classManagerOpen = false)],
    ['another tab is shown', () => (onPage = null)],
    ['another class is drawn', () => StudentCards.render(CID)],
  ])('Print Again is gone once %s', async (what, leave) => {
    seedDemo();
    await shown(CID);
    await StudentCards.makeAndPrint(CID);
    expect(StudentCards._holding(CID)).toBe(true);
    if (what === 'another class is drawn') {
      seedClass('c-other', { students: STUDENTS, courseConfigs: ON });
      StudentCards.render('c-other');
    } else {
      leave();
    }
    expect(StudentCards.printAgain(CID)).toBe(0);
    expect(StudentCards._holding()).toBe(false);
    DashClassManager.classManagerOpen = true;
    onPage = CID;
    const box = parse(StudentCards.render(CID));
    expect(buttons(box)).toEqual([]);
    expect(noteOf(box)).toBe(null);
    expect(sheets.length).toBe(1);
    clearClass('c-other');
  });

  it('Print Again is gone after ten minutes', async () => {
    seedDemo();
    await shown(CID);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const pressed = StudentCards.makeAndPrint(CID);
      await vi.advanceTimersByTimeAsync(10);
      await pressed;
      expect(StudentCards._holding(CID)).toBe(true);
      await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
      expect(StudentCards._holding(CID)).toBe(true);
      await vi.advanceTimersByTimeAsync(60 * 1000);
      expect(StudentCards._holding()).toBe(false);
      expect(StudentCards.printAgain(CID)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([1, 8, 9, 27])('%i cards go on the slips’ sheet, eight to a page', async n => {
    const many = [];
    for (let i = 0; i < n; i++) {
      many.push({ id: 'e' + i, firstName: 'Student', lastName: 'N' + String(i).padStart(2, '0'), studentNumber: '1' });
    }
    seedDemo(ON, many);
    await shown(CID);
    expect(await StudentCards.makeAndPrint(CID)).toBe(n);
    const shot = sheets[0];
    expect(shot.pages.length).toBe(Math.ceil(n / 8));
    expect(shot.pages.reduce((a, b) => a + b, 0)).toBe(n);
    shot.pages.forEach(count => expect(count).toBeLessThanOrEqual(8));
    expect(shot.names).toEqual(many.map(s => 'Student ' + s.lastName));
    expect(shot.qrs).toBe(n);
    await settle();
    expect(noteOf(parse(StudentCards.render(CID)))).toMatch(
      new RegExp('^' + (n === 1 ? '1 card went' : n + ' cards went') + ' to the printer\\.'),
    );
  });
});

describe('the printed card', () => {
  const made = [
    { enrollment_id: 's1', result: 'made', card_id: U(901), seq: 1, code: 'K7M4-QX21' },
    { enrollment_id: 's2', result: 'made', card_id: U(902), seq: 2, code: 'K7M4-QX22' },
    { enrollment_id: 's3', result: 'made', card_id: U(903), seq: 1, code: 'K7M4-QX23', password: '4821' },
    { enrollment_id: 's9', result: 'changed' },
    { enrollment_id: 'gone', result: 'made', card_id: U(904), seq: 1, code: 'K7M4-QX24' },
    { enrollment_id: 's4', result: 'made', card_id: U(905), seq: 1 }, // its code could not be had
  ];
  const students = [
    STUDENTS[2],
    STUDENTS[0],
    STUDENTS[1],
    { id: 's9', firstName: 'No', lastName: 'Card' },
    { id: 's4', firstName: 'Lost', lastName: 'Reply' },
  ];

  it('one item for each card made with its code, A to Z by last name', () => {
    const items = StudentCards.cardItems(students, made, 'https://fullvision.ca');
    expect(items.map(i => [i.id, i.name, i.code, i.url, i.password, i.seq])).toEqual([
      [U(901), 'Jordan Abel', 'K7M4-QX21', 'https://fullvision.ca/s/#K7M4-QX21', '', 1],
      [U(902), 'Avery Byrne', 'K7M4-QX22', 'https://fullvision.ca/s/#K7M4-QX22', '', 2],
      [U(903), 'Noor Chen', 'K7M4-QX23', 'https://fullvision.ca/s/#K7M4-QX23', '4821', 1],
    ]);
  });

  it('the QR opens the student page with the code after #; Demo Mode’s opens the demo', () => {
    expect(StudentCards.cardUrl(made[0], 'https://fullvision.ca/')).toBe(
      QrSlips.slipUrl('K7M4-QX21', 'https://fullvision.ca'),
    );
    expect(StudentCards.cardUrl(made[0], 'https://fullvision.ca', true)).toBe('https://fullvision.ca/s/#demo-card');
    expect(StudentCards.cardUrl(made[2], 'https://fullvision.ca', true)).toBe(
      'https://fullvision.ca/s/#demo-card-password',
    );
  });

  it('carries the name, the class, the card number, the QR and the code, and the password only when given', () => {
    const items = StudentCards.cardItems(STUDENTS, made, 'https://fullvision.ca');
    const plain = parse(StudentCards.cardHtml(items[1], 'Science 8 · Block B', '<svg data-qr="1"></svg>'));
    expect(plain.querySelector('.qs-name').textContent).toBe('Avery Byrne');
    expect(plain.querySelector('.qs-class').textContent).toBe('Science 8 · Block B');
    expect(plain.querySelector('.qs-title').textContent).toBe('Student Card');
    expect(plain.querySelector('.qs-what .qs-dates').textContent).toBe('Card 2');
    expect(plain.querySelector('.qs-qr').getAttribute('aria-label')).toBe('QR code for Avery Byrne');
    expect(plain.querySelector('.qs-qr svg')).not.toBe(null);
    expect(plain.querySelector('.qs-type').textContent).toBe('No camera? Go to fullvision.ca/s and typeK7M4-QX22');
    expect(plain.querySelector('.qs-pass')).toBe(null);
    expect(plain.textContent).not.toMatch(/once/i);
    const withPassword = parse(StudentCards.cardHtml(items[2], 'Science 8', ''));
    expect(withPassword.querySelector('.qs-pass').textContent).toBe('Password4821');
    // No number known: none printed.
    const none = parse(StudentCards.cardHtml({ ...items[0], seq: null }, 'Science 8', ''));
    expect(none.querySelector('.qs-what .qs-dates')).toBe(null);
  });

  it('every value on it is escaped', () => {
    const html = StudentCards.cardHtml(
      { name: '<b>Jo</b>', code: 'A<B', url: 'https://x.test/s/#A<B', password: '1<2', seq: '<i>' },
      'Sci & Tech',
      '',
    );
    expect(html).not.toMatch(/<b>|A<B|1<2|<i>/);
    expect(html).toContain('&lt;b&gt;Jo&lt;/b&gt;');
    expect(html).toContain('Sci &amp; Tech');
  });
});

describe('what the files name', () => {
  const source = file => readFileSync(new URL('../' + file, import.meta.url), 'utf-8');

  it('teacher/student-cards.js reaches the cards only through shared/data.js, and keeps codes nowhere', () => {
    const src = source('teacher/student-cards.js');
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|_writeRpc|\.rpc\(|getSupabase/);
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|Sentry|console\.|v2Queue/);
  });

  it('shared/data.js: the two card RPCs once each, teacher-cards once, and no RPC the migration drops', () => {
    const src = source('shared/data.js');
    expect(src.match(/_callRpcWithAuthGuard\('list_student_cards'/g).length).toBe(1);
    expect(src.match(/_writeRpc\('mark_student_cards_printed'/g).length).toBe(1);
    expect(src.match(/functions\/v1\/teacher-cards\?forceFunctionRegion=ca-central-1/g).length).toBe(1);
    expect(src).not.toMatch(/issue_student_cards|reissue_student_card/);
    // Not built yet (S3-F2): nothing names these.
    expect(src).not.toMatch(/unlock_student_card|unlock_all_student_cards|set_cards_work_until/);
  });

  it('the card block keeps no reply anywhere: no storage, outbox or Sentry inside makeStudentCards', () => {
    const src = source('shared/data.js');
    const block = src.slice(src.indexOf('function _teacherCardsUrl'), src.indexOf('function markStudentCardsPrinted'));
    expect(block).not.toMatch(/localStorage|sessionStorage|indexedDB|_safeLSSet|_writeRpc|v2Queue|Sentry|_cache\b/);
    // The only log line names the status and the refusal, never the reply.
    expect(block.match(/console\.\w+\(/g)).toEqual(['console.warn(']);
    expect(block).toContain("console.warn('teacher-cards failed:', got.status, error);");
  });
});
