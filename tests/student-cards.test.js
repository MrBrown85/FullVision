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
import { notAdded } from './helpers/kept-secret.js';

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
// A password is four digits, which the device may already hold by chance:
// it is found no more often than in `before`, what was kept before the cards.
const passwordNotKept = (before, password) => notAdded(expect, before, everythingKept(), password);

function parse(html) {
  const doc = parseHTML('<!doctype html><html><head></head><body></body></html>').document;
  const box = doc.createElement('div');
  box.innerHTML = html;
  return box;
}
// Student, Card and Status of each row; a row's own buttons are rowButtons'.
const rowsOf = box =>
  Array.from(box.querySelectorAll('.sc-table tbody tr')).map(tr =>
    Array.from(tr.children)
      .filter(td => !td.classList.contains('sc-do'))
      .map(td => td.textContent),
  );
// The card's own buttons, above the list.
const buttons = box => Array.from(box.querySelectorAll('.sc-actions button')).map(b => b.textContent);
// Each row's buttons, by the label a screen reader says.
const rowButtons = box =>
  Array.from(box.querySelectorAll('.sc-table tbody tr')).map(tr =>
    Array.from(tr.querySelectorAll('.sc-do button')).map(b => b.getAttribute('aria-label')),
  );
// The lines under the buttons, one string each; null with none.
const notesOf = box => {
  const lines = Array.from(box.querySelectorAll('.sc-note .sc-note-line')).map(e => e.textContent);
  return lines.length ? lines : null;
};
const noteOf = box => (notesOf(box) ? notesOf(box).join(' ') : null);
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
afterEach(async () => {
  // A print's own clean-up runs a moment after the dialog (teacher/ui.js printThen): it runs while the
  // test's stand-in window is still there, never after, whichever test printed last.
  await new Promise(r => setTimeout(r, 5));
  releasePrints();
  document.querySelector = realQuery;
  DashClassManager.classManagerOpen = wasOpen.open;
  DashClassManager.renderClassManager = wasOpen.draw;
  globalThis.fetch = realFetch;
  delete window.__ENV;
  serverSaysStudentPageOn(LIVE, false);
  _forgetCardsPrintedHere();
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
    const keptBefore = everythingKept();
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
    passwordNotKept(keptBefore, out.results[2].password);
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
    const keptBefore = everythingKept();
    localStorage.setItem(
      'gb-student-cards-' + CID,
      JSON.stringify([{ ...todays(1, 's3'), id: 'old-1', code: 'K7M-4QX', check: 'password', password: '4821' }]),
    );
    const listed = (await listStudentCards(CID)).data;
    expect(listed.length).toBe(1);
    expect(listed[0]).not.toHaveProperty('code');
    expect(listed[0]).not.toHaveProperty('password');
    expect(listed[0].check).toBe('password');
    expect(everythingKept()).not.toContain('K7M-4QX');
    passwordNotKept(keptBefore, '4821');
  });

  it('when the app starts, codes an older build saved are erased for every class at once', () => {
    const old = (id, code) => ({ ...todays(1, 's1'), id, code, check: 'password', password: '4821' });
    const keptBefore = everythingKept();
    localStorage.setItem('gb-student-cards-c-one', JSON.stringify([old('a', 'K7M-4QX')]));
    localStorage.setItem('gb-student-cards-c-two', JSON.stringify([old('b', 'P3R-8WD')]));
    _dropOldCardCodes();
    expect(everythingKept()).not.toMatch(/K7M-4QX|P3R-8WD/);
    passwordNotKept(keptBefore, '4821');
    expect(storedCards('c-one').map(c => c.id)).toEqual(['a']);
    expect(storedCards('c-two').map(c => c.id)).toEqual(['b']);
    // shared/data.js does this as it loads.
    const src = readFileSync(new URL('../shared/data.js', import.meta.url), 'utf-8');
    expect(src).toMatch(/\n_dropOldCardCodes\(\);\n/);
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
    const keptBefore = everythingKept();
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
    expect(everythingKept()).not.toContain('K7M-4Q');
    passwordNotKept(keptBefore, '4821');
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
      const keptBefore = everythingKept();
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
      // No cache anywhere keeps the reply, and no cookie goes with it.
      expect(t.fetcher.inits.map(i => [i.method, i.cache, i.credentials])).toEqual([['POST', 'no-store', 'omit']]);
      // No RPC, nothing queued, nothing kept, nothing logged.
      expect(t.session.sent()).toEqual([]);
      expect(localStorage.getItem('fv-sync-queue-v1')).toBe(null);
      const password = out.data.results[1].password;
      const codes = out.data.results.map(r => r.code);
      codes.forEach(code => {
        expect(everythingKept()).not.toContain(code);
        expect(everythingKept()).not.toContain(code.replace('-', ''));
        expect(JSON.stringify(warned)).not.toContain(code);
      });
      passwordNotKept(keptBefore, password);
      expect(JSON.stringify(warned)).not.toContain(password);
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
      '',
    ]);
    // No card yet: nothing on a row to press.
    expect(rowButtons(box)).toEqual([[], [], []]);
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
      // Avery's never-printed card, and Fay with none; cards students hold, so New Codes for This Class.
      expect(buttons(box)).toEqual(['New Codes for This Class', 'Make and Print 2 Cards']);
      // Dee's is locked: Unlock on her row. Every card can be replaced.
      expect(rowButtons(box)).toEqual([
        ['Print a New Card for Jordan Abel'],
        ['Print a New Card for Avery Byrne'],
        ['Print a New Card for Cam Cole'],
        ['Unlock Dee Dunn’s Card', 'Print a New Card for Dee Dunn'],
        ['Print a New Card for Eli Eng'],
        [],
      ]);
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
      expect(buttons(box)).toEqual(['New Codes for This Class', 'Make and Print 1 Card']);
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
    const keptBefore = everythingKept();
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
    sheet.codes.forEach(code => {
      expect(box.textContent).not.toContain(code);
      expect(everythingKept()).not.toContain(code);
    });
    sheet.passwords.forEach(password => {
      expect(box.textContent).not.toContain(password);
      passwordNotKept(keptBefore, password);
    });
    expect(noteOf(box)).toBe(
      '3 cards went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
    );
    expect(buttons(box)).toEqual(['Print Again', 'New Codes for This Class']);
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
    expect(buttons(parse(StudentCards.render(CID)))).toEqual(['New Codes for This Class', 'Make and Print 2 Cards']);
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
    expect(buttons(parse(StudentCards.render(CID)))).toEqual(['Print Again', 'New Codes for This Class']);
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
      expect(buttons(parse(StudentCards.render(LIVE)))).toEqual(['New Codes for This Class', 'Make and Print 2 Cards']);
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
    expect(buttons(box)).toEqual(['New Codes for This Class']);
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

/* What the independent review of Nov 10 found, each held by a test: Print
   Again by the clock; a read never erasing a mark still on its way; the
   screen there now drawn and read again after a late or unclean answer; a
   list a minute old read again. */
describe('after the review', () => {
  beforeEach(() => catchPrints());

  it.each([
    ['ten minutes and a second', 10 * 60 * 1000 + 1000],
    ['three hours', 3 * 60 * 60 * 1000],
  ])('Print Again goes by the clock: after %s with the timer held back, it prints nothing', async (what, ms) => {
    seedDemo();
    await shown(CID);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-10T18:00:00.000Z'));
      await StudentCards.makeAndPrint(CID);
      expect(sheets.length).toBe(1);
      vi.setSystemTime(new Date(Date.parse('2026-11-10T18:00:00.000Z') + 9 * 60 * 1000));
      expect(StudentCards.printAgain(CID)).toBe(3);
      // The clock moves on; no timer has fired.
      vi.setSystemTime(new Date(Date.parse('2026-11-10T18:00:00.000Z') + ms));
      const box = parse(StudentCards.render(CID));
      expect(buttons(box)).toEqual(['New Codes for This Class']);
      expect(noteOf(box)).toBe(null);
      expect(StudentCards.printAgain(CID)).toBe(0);
      expect(StudentCards._holding()).toBe(false);
      expect(sheets.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the one-second watch lets the codes go by the clock too', async () => {
    seedDemo();
    await shown(CID);
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      vi.setSystemTime(new Date('2026-11-10T18:00:00.000Z'));
      await StudentCards.makeAndPrint(CID);
      expect(StudentCards._holding(CID)).toBe(true);
      const drawn = [];
      DashClassManager.renderClassManager = () => drawn.push(1);
      vi.setSystemTime(new Date('2026-11-10T21:00:00.000Z'));
      vi.advanceTimersByTime(1000);
      expect(drawn.length).toBe(1);
      expect(StudentCards.printAgain(CID)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a list read again before Mark Printed lands still shows the cards printed, and Make and Print leaves them', async () => {
    const t = await signedIn();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-10T18:00:00.000Z'));
      // Mark Printed is held back: the server never hears it.
      t.session.fake.on('mark_student_cards_printed', () => new Promise(() => {}));
      await shown(LIVE);
      await StudentCards.makeAndPrint(LIVE);
      expect(sheets.length).toBe(1);
      const made = t.fn.db.state.cards.map(k => k.id);
      // A minute later the list is drawn again, and read again from the server, which says Not Printed.
      vi.setSystemTime(new Date('2026-11-10T18:01:30.000Z'));
      const reads = () => t.session.sent().filter(c => c[0] === 'list_student_cards').length;
      const before = reads();
      await shown(LIVE);
      expect(reads()).toBe(before + 1);
      expect(t.fn.cardsListed().every(c => c.printed_at === null)).toBe(true);
      const box = parse(StudentCards.render(LIVE));
      expect(rowsOf(box).map(r => r[2].replace(/ .*/, ''))).toEqual(['Printed', 'Printed', 'Printed']);
      expect(buttons(box).filter(b => /^Make and Print/.test(b))).toEqual([]);
      // Nothing to press, nothing replaced.
      expect(await StudentCards.makeAndPrint(LIVE)).toBe(0);
      expect(t.fn.posts.length).toBe(1);
      expect(t.fn.db.state.cards.map(k => k.id)).toEqual(made);
    } finally {
      vi.useRealTimers();
      t.session.signOut();
    }
  });

  it('the re-read after another tab changed one student keeps this tab’s printed cards printed', async () => {
    const t = await signedIn();
    try {
      t.session.fake.on('mark_student_cards_printed', () => new Promise(() => {}));
      await shown(LIVE);
      // Another tab makes Cam's card first; this list does not know.
      t.fn.db.state.cards.push({
        id: U(950),
        enrollment_id: U(13),
        code_hmac: 'x',
        pw_hmac: null,
        seq: 1,
        stopped: false,
      });
      await StudentCards.makeAndPrint(LIVE);
      expect(sheets[0].names).toEqual(['Jordan Abel', 'Avery Byrne']);
      await afterDraw();
      const box = parse(StudentCards.render(LIVE));
      expect(rowsOf(box).map(r => r[2].replace(/ .*/, ''))).toEqual(['Printed', 'Printed', 'Not']);
      // Only the other tab's never-printed card is offered, by its own id.
      expect(buttons(box)).toContain('Make and Print 1 Card');
      await StudentCards.makeAndPrint(LIVE);
      expect(t.fn.posts[1].body.items).toEqual([{ enrollment_id: U(13), replaces: U(950) }]);
      expect(sheets[1].names).toEqual(['Cam Cole']);
    } finally {
      t.session.signOut();
    }
  });

  it('a mark still waiting in the outbox from before a reload is laid over the list', async () => {
    const t = await signedIn({ list: () => [after(1, U(11)), after(2, U(12))] });
    try {
      localStorage.setItem(
        'fv-sync-queue-v1',
        JSON.stringify({
          entries: [
            {
              id: 'e1',
              endpoint: 'mark_student_cards_printed',
              payload: { p_card_ids: [U(901)] },
              created_at: '2026-11-12T19:30:00.000Z',
            },
          ],
        }),
      );
      const listed = (await listStudentCards(LIVE)).data;
      expect(listed.map(c => c.printed_at)).toEqual(['2026-11-12T19:30:00.000Z', null]);
    } finally {
      localStorage.removeItem('fv-sync-queue-v1');
      t.session.signOut();
    }
  });

  it('a late answer after leaving and coming back: the screen is drawn as it is, button on, and the list read again', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let release;
    const gate = new Promise(r => (release = r));
    const t = await signedIn({ fetch: { hold: () => gate } });
    try {
      await shown(LIVE);
      const drawn = [];
      DashClassManager.renderClassManager = () => drawn.push(1);
      const pressed = StudentCards.makeAndPrint(LIVE);
      await settle();
      expect(noteOf(parse(StudentCards.render(LIVE)))).toBe('Making cards…');
      onPage = null;
      vi.advanceTimersByTime(1000);
      onPage = LIVE;
      const reads = () => t.session.sent().filter(c => c[0] === 'list_student_cards').length;
      const before = reads();
      const drawsBefore = drawn.length;
      release();
      expect(await pressed).toBe(0);
      expect(drawn.length).toBeGreaterThan(drawsBefore);
      await shown(LIVE);
      expect(reads()).toBe(before + 1);
      const box = parse(StudentCards.render(LIVE));
      expect(noteOf(box)).toBe(null);
      expect(box.querySelector('[data-action="spCardsMake"]').hasAttribute('disabled')).toBe(false);
      expect(rowsOf(box).map(r => r[2])).toEqual(['Not Printed', 'Not Printed', 'Not Printed']);
      expect(sheets).toEqual([]);
    } finally {
      vi.useRealTimers();
      t.session.signOut();
    }
  });

  it('a lost reply made good: one press prints', async () => {
    const t = await signedIn({ fetch: { lose: (post, n) => n === 1 } });
    try {
      await shown(LIVE);
      expect(await StudentCards.makeAndPrint(LIVE)).toBe(3);
      expect(sheets.length).toBe(1);
    } finally {
      t.session.signOut();
    }
  });

  it('a lost reply whose recovery is lost too: the list is read again and the second press prints', async () => {
    const t = await signedIn({ fetch: { lose: (post, n) => n === 1, fail: (post, n) => n === 3 || n === 4 } });
    try {
      await shown(LIVE);
      expect(await StudentCards.makeAndPrint(LIVE)).toBe(0);
      await afterDraw();
      let box = parse(StudentCards.render(LIVE));
      expect(noteOf(box)).toBe('Could not make the cards. Check the connection and try again.');
      // The cards the server made are in the list now, unprinted: the second press replaces them by id.
      expect(rowsOf(box).map(r => r[2])).toEqual(['Not Printed', 'Not Printed', 'Not Printed']);
      const lost = [U(11), U(12), U(13)].map(sid => t.fn.live(sid).id);
      expect(await StudentCards.makeAndPrint(LIVE)).toBe(3);
      const last = t.fn.posts[t.fn.posts.length - 1].body.items;
      expect(last.map(i => i.replaces)).toEqual(lost);
      expect(sheets.length).toBe(1);
      box = parse(StudentCards.render(LIVE));
      expect(noteOf(box)).toMatch(/^3 cards went to the printer\./);
    } finally {
      t.session.signOut();
    }
  });

  it('another tab’s change: the list is read again, and the second press works', async () => {
    const t = await signedIn();
    try {
      await shown(LIVE);
      // Another tab makes all three cards first; this list does not know.
      [U(11), U(12), U(13)].forEach((sid, i) =>
        t.fn.db.state.cards.push({
          id: U(960 + i),
          enrollment_id: sid,
          code_hmac: 'y' + i,
          pw_hmac: null,
          seq: 1,
          stopped: false,
        }),
      );
      expect(await StudentCards.makeAndPrint(LIVE)).toBe(0);
      await afterDraw();
      expect(await StudentCards.makeAndPrint(LIVE)).toBe(3);
      expect(t.fn.posts[1].body.items.map(i => i.replaces)).toEqual([U(960), U(961), U(962)]);
    } finally {
      t.session.signOut();
    }
  });

  it('a refusal: the list is read again', async () => {
    const t = await signedIn({ fetch: { answer: () => ({ status: 404, json: { ok: false, error: 'not_found' } }) } });
    try {
      await shown(LIVE);
      const reads = () => t.session.sent().filter(c => c[0] === 'list_student_cards').length;
      const before = reads();
      await StudentCards.makeAndPrint(LIVE);
      await afterDraw();
      expect(reads()).toBe(before + 1);
    } finally {
      t.session.signOut();
    }
  });

  it('a list a minute old is read again when shown; if that fails the old list stays, with Try Again', async () => {
    const t = await signedIn({ list: () => [after(1, U(11))] });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-10T18:00:00.000Z'));
      await shown(LIVE);
      vi.setSystemTime(new Date('2026-11-10T18:00:30.000Z'));
      await shown(LIVE);
      expect(t.session.sent().length).toBe(1);
      vi.setSystemTime(new Date('2026-11-10T18:01:30.000Z'));
      t.session.fake.on('list_student_cards', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
      await shown(LIVE);
      expect(t.session.sent().length).toBe(2);
      const box = parse(StudentCards.render(LIVE));
      expect(noteOf(box)).toBe('Could not load the cards. Check the connection and try again.');
      expect(rowsOf(box)[0]).toEqual(['Jordan Abel', 'Card 1 · Made Nov 10', 'Not Printed']);
      expect(buttons(box)).toEqual(['Try Again', 'Make and Print 3 Cards']);
    } finally {
      vi.useRealTimers();
      t.session.signOut();
    }
  });
});

/* S3-F2: Print New Card, New Codes for This Class, Unlock and Unlock All,
   and three faults the review of S3-W1 left. */

// The questions put up (teacher/ui.js showConfirm), answered by the test.
let asked;
let realConfirm;
function catchQuestions() {
  asked = [];
  realConfirm = globalThis.showConfirm;
  globalThis.showConfirm = (title, message, ok, style, onOk) => asked.push({ title, message, ok, style, onOk });
}
function releaseQuestions() {
  if (realConfirm) globalThis.showConfirm = realConfirm;
  realConfirm = null;
}
const press = (action, cid, data) =>
  CmStudentPage.handleAction(action, { closest: () => ({ dataset: { cid } }), dataset: data || {} });
const printed = '2026-11-12T19:30:00+00:00';

describe('Print New Card', () => {
  beforeEach(() => {
    catchPrints();
    catchQuestions();
  });
  afterEach(() => releaseQuestions());

  it('a card never printed and never opened is replaced without asking', async () => {
    seedDemo();
    await shown(CID);
    const first = (await makeStudentCards(CID, [{ enrollment_id: 's1', replaces: null }])).data.results[0];
    StudentCards._reset();
    await shown(CID);
    expect(rowButtons(parse(StudentCards.render(CID)))[0]).toEqual(['Print a New Card for Jordan Abel']);
    press('spCardsNewCard', CID, { student: 's1' });
    await afterDraw();
    expect(asked).toEqual([]);
    expect(sheets.length).toBe(1);
    expect(sheets[0].names).toEqual(['Jordan Abel']);
    expect(sheets[0].numbers).toEqual(['Card 2']);
    const listed = (await listStudentCards(CID)).data;
    expect(listed.length).toBe(1);
    expect(listed[0].id).not.toBe(first.card_id);
    expect(listed[0].seq).toBe(2);
    const box = parse(StudentCards.render(CID));
    expect(noteOf(box)).toBe(
      '1 card went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
    );
    sheets[0].codes.forEach(code => {
      expect(box.textContent).not.toContain(code);
      expect(everythingKept()).not.toContain(code);
    });
  });

  it('a printed card asks first, in the design’s words; Cancel changes nothing', async () => {
    const t = await signedIn({
      students: [{ id: U(11), firstName: 'Jordan', preferred: 'Cece', lastName: 'Abel', dateOfBirth: '2012-03-04' }],
      fnStudents: [FN_STUDENTS[0]],
    });
    try {
      t.fn.db.state.cards.push({
        id: U(901),
        enrollment_id: U(11),
        code_hmac: 'x',
        pw_hmac: null,
        seq: 1,
        stopped: false,
      });
      t.fn.markPrinted([U(901)]);
      await shown(LIVE);
      expect(rowButtons(parse(StudentCards.render(LIVE)))).toEqual([['Print a New Card for Cece Abel']]);
      press('spCardsNewCard', LIVE, { student: U(11) });
      expect(asked.length).toBe(1);
      expect(asked[0].title).toBe('Print a New Card for Cece?');
      expect(asked[0].message).toBe(
        'The card Cece has now stops working as soon as the new one is made. Everything Cece has sent stays.',
      );
      expect(asked[0].ok).toBe('Print New Card');
      // Cancel: the dialog closes and nothing was asked of anyone.
      await afterDraw();
      expect(t.fn.posts).toEqual([]);
      expect(sheets).toEqual([]);
      expect(t.fn.live(U(11)).id).toBe(U(901));
      expect(StudentCards._holding()).toBe(false);
      expect(rowsOf(parse(StudentCards.render(LIVE)))[0][2]).toMatch(/^Printed /);
    } finally {
      t.session.signOut();
    }
  });

  it('Print New Card: the request names the live card, the old one stops, and the new one prints', async () => {
    const t = await signedIn();
    try {
      t.fn.db.state.cards.push({
        id: U(901),
        enrollment_id: U(12),
        code_hmac: 'x',
        pw_hmac: null,
        seq: 1,
        stopped: false,
      });
      t.fn.markPrinted([U(901)]);
      await shown(LIVE);
      press('spCardsNewCard', LIVE, { student: U(12) });
      expect(asked[0].title).toBe('Print a New Card for Avery?');
      asked[0].onOk();
      await StudentCards._making(LIVE);
      await afterDraw();
      expect(t.fn.posts.length).toBe(1);
      expect(t.fn.posts[0].body.items).toEqual([{ enrollment_id: U(12), replaces: U(901) }]);
      expect(t.fn.db.state.cards.find(k => k.id === U(901)).stopped).toBe(true);
      expect(sheets.length).toBe(1);
      expect(sheets[0].names).toEqual(['Avery Byrne']);
      expect(sheets[0].numbers).toEqual(['Card 2']);
      // Avery has nothing on file: the new card prints its own password.
      expect(sheets[0].passwords[0]).toMatch(/^\d{4}$/);
      const box = parse(StudentCards.render(LIVE));
      expect(rowsOf(box)[1]).toEqual([
        'Avery Byrne',
        expect.stringMatching(/^Card 2 · Made /),
        expect.stringMatching(/^Printed /),
      ]);
      expect(notesOf(box)).toEqual([
        '1 card went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
      ]);
      expect(box.textContent).not.toContain(sheets[0].codes[0]);
      expect(everythingKept()).not.toContain(sheets[0].codes[0]);
    } finally {
      t.session.signOut();
    }
  });

  it('a card that was opened asks too, and one with no card yet gets its first without asking', async () => {
    seedDemo();
    await shown(CID);
    const made = (await makeStudentCards(CID, [{ enrollment_id: 's1', replaces: null }])).data.results[0];
    const kept = storedCards();
    kept[0].last_opened_at = '2026-11-14T16:00:00.000Z';
    localStorage.setItem('gb-student-cards-' + CID, JSON.stringify(kept));
    StudentCards._reset();
    await shown(CID);
    press('spCardsNewCard', CID, { student: 's1' });
    expect(asked.map(q => q.title)).toEqual(['Print a New Card for Jordan?']);
    expect(storedCards()[0].id).toBe(made.card_id);
    // A student with no card has no Print New Card; asked for anyway, it is a first card, with no question.
    expect(rowButtons(parse(StudentCards.render(CID)))[1]).toEqual([]);
    expect(await StudentCards.printNewCard(CID, 's2')).toBe(1);
    expect(asked.length).toBe(1);
    expect(sheets[0].names).toEqual(['Avery Byrne']);
  });

  it.each([
    ['Class Settings closes', () => (DashClassManager.classManagerOpen = false)],
    ['another tab is shown', () => (onPage = null)],
    ['another class is shown', () => (onPage = CID)],
  ])('a Yes after %s, while the question was up, makes nothing', async (what, leave) => {
    const t = await signedIn();
    try {
      t.fn.db.state.cards.push({
        id: U(901),
        enrollment_id: U(11),
        code_hmac: 'x',
        pw_hmac: null,
        seq: 1,
        stopped: false,
      });
      t.fn.markPrinted([U(901)]);
      await shown(LIVE);
      press('spCardsNewCard', LIVE, { student: U(11) });
      expect(asked.length).toBe(1);
      leave();
      asked[0].onOk();
      await afterDraw();
      expect(t.fn.posts).toEqual([]);
      expect(sheets).toEqual([]);
      expect(t.fn.live(U(11)).id).toBe(U(901));
    } finally {
      t.session.signOut();
    }
  });

  it('a Yes after the screen went and came back makes nothing', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const t = await signedIn();
    try {
      t.fn.db.state.cards.push({
        id: U(901),
        enrollment_id: U(11),
        code_hmac: 'x',
        pw_hmac: null,
        seq: 1,
        stopped: false,
      });
      t.fn.markPrinted([U(901)]);
      await shown(LIVE);
      press('spCardsNewCard', LIVE, { student: U(11) });
      onPage = null;
      vi.advanceTimersByTime(1000); // the watch sees the card gone
      onPage = LIVE;
      asked[0].onOk();
      await afterDraw();
      expect(t.fn.posts).toEqual([]);
      expect(sheets).toEqual([]);
    } finally {
      vi.useRealTimers();
      t.session.signOut();
    }
  });

  it('an answer that comes after the screen went prints nothing and holds nothing', async () => {
    let release;
    const gate = new Promise(r => (release = r));
    const t = await signedIn({ fetch: { hold: () => gate } });
    try {
      t.fn.db.state.cards.push({
        id: U(901),
        enrollment_id: U(11),
        code_hmac: 'x',
        pw_hmac: null,
        seq: 1,
        stopped: false,
      });
      await shown(LIVE);
      const out = StudentCards.printNewCard(LIVE, U(11));
      await settle();
      expect(noteOf(parse(StudentCards.render(LIVE)))).toBe('Making cards…');
      DashClassManager.classManagerOpen = false;
      release();
      expect(await out).toBe(0);
      expect(sheets).toEqual([]);
      expect(StudentCards._holding()).toBe(false);
    } finally {
      t.session.signOut();
    }
  });

  it('a refusal: one line, nothing printed, the old card named as still held, and the list read again', async () => {
    const t = await signedIn({ fetch: { answer: () => ({ status: 500, json: { ok: false, error: 'server' } }) } });
    try {
      t.fn.db.state.cards.push({
        id: U(901),
        enrollment_id: U(13),
        code_hmac: 'x',
        pw_hmac: null,
        seq: 1,
        stopped: false,
      });
      t.fn.markPrinted([U(901)]);
      await shown(LIVE);
      const reads = () => t.session.sent().filter(c => c[0] === 'list_student_cards').length;
      const before = reads();
      press('spCardsNewCard', LIVE, { student: U(13) });
      asked[0].onOk();
      await StudentCards._making(LIVE);
      await afterDraw();
      expect(sheets).toEqual([]);
      expect(reads()).toBe(before + 1);
      expect(notesOf(parse(StudentCards.render(LIVE)))).toEqual([
        'Could not make the card. Check the connection and try again.',
        '1 student still has their old card: Cam Cole. Use Print New Card on their row to try again.',
      ]);
    } finally {
      t.session.signOut();
    }
  });
});

describe('New Codes for This Class', () => {
  beforeEach(() => {
    catchPrints();
    catchQuestions();
  });
  afterEach(() => {
    releaseQuestions();
    StudentCards._setBatch(250);
  });

  it.each([
    [28, 0, 'New Codes for All 28 Students?', '28 cards stop working now. ', 'Make 28 New Cards'],
    [
      26,
      2,
      'New Codes for All 28 Students?',
      '26 cards stop working now. 2 students get their first card. ',
      'Make 28 New Cards',
    ],
    [
      1,
      1,
      'New Codes for All 2 Students?',
      '1 card stops working now. 1 student gets their first card. ',
      'Make 2 New Cards',
    ],
    [1, 0, 'New Code for 1 Student?', '1 card stops working now. ', 'Make 1 New Card'],
  ])('%i cards and %i students with none: the words', (stop, first, title, starts, ok) => {
    const q = StudentCards.newCodesQuestion(stop, first);
    expect(q.title).toBe(title);
    expect(q.message).toBe(
      starts +
        "Print the new cards and hand them out. Students can't open their page until they have their new card. Everything they have sent stays.",
    );
    expect(q.ok).toBe(ok);
  });

  it('is offered once a student may hold a card, and counts every student', async () => {
    seedDemo();
    await shown(CID);
    // No card held yet: Make and Print does it all.
    expect(buttons(parse(StudentCards.render(CID)))).toEqual(['Make and Print 3 Cards']);
    const made = (
      await makeStudentCards(CID, [
        { enrollment_id: 's1', replaces: null },
        { enrollment_id: 's2', replaces: null },
      ])
    ).data.results;
    await markStudentCardsPrinted(CID, [made[0].card_id]);
    StudentCards._reset();
    await shown(CID);
    expect(buttons(parse(StudentCards.render(CID)))).toEqual(['New Codes for This Class', 'Make and Print 2 Cards']);
    press('spCardsNewCodes', CID);
    expect(asked.length).toBe(1);
    expect(asked[0].title).toBe('New Codes for All 3 Students?');
    expect(asked[0].message).toBe(
      "2 cards stop working now. 1 student gets their first card. Print the new cards and hand them out. Students can't open their page until they have their new card. Everything they have sent stays.",
    );
    expect(asked[0].ok).toBe('Make 3 New Cards');
  });

  it('Cancel changes nothing', async () => {
    const t = await signedIn();
    try {
      [U(11), U(12), U(13)].forEach((sid, i) =>
        t.fn.db.state.cards.push({
          id: U(960 + i),
          enrollment_id: sid,
          code_hmac: 'y' + i,
          pw_hmac: null,
          seq: 1,
          stopped: false,
        }),
      );
      t.fn.markPrinted([U(960), U(961), U(962)]);
      await shown(LIVE);
      const before = parse(StudentCards.render(LIVE)).innerHTML;
      press('spCardsNewCodes', LIVE);
      expect(asked[0].title).toBe('New Codes for All 3 Students?');
      expect(asked[0].message.startsWith('3 cards stop working now. Print the new cards')).toBe(true);
      await afterDraw();
      expect(t.fn.posts).toEqual([]);
      expect(sheets).toEqual([]);
      expect(t.fn.db.state.cards.every(k => !k.stopped)).toBe(true);
      expect(parse(StudentCards.render(LIVE)).innerHTML).toBe(before);
    } finally {
      t.session.signOut();
    }
  });

  it('one request for the class: every card stops, every student prints, A to Z', async () => {
    const t = await signedIn();
    try {
      t.fn.db.state.cards.push({
        id: U(960),
        enrollment_id: U(11),
        code_hmac: 'y0',
        pw_hmac: null,
        seq: 1,
        stopped: false,
      });
      t.fn.db.state.cards.push({
        id: U(961),
        enrollment_id: U(13),
        code_hmac: 'y1',
        pw_hmac: null,
        seq: 1,
        stopped: false,
      });
      t.fn.markPrinted([U(960)]);
      await shown(LIVE);
      const keptBefore = everythingKept();
      press('spCardsNewCodes', LIVE);
      expect(asked[0].message.startsWith('2 cards stop working now. 1 student gets their first card.')).toBe(true);
      asked[0].onOk();
      await StudentCards._making(LIVE);
      await afterDraw();
      expect(t.fn.posts.length).toBe(1);
      expect(t.fn.posts[0].body.items).toEqual([
        { enrollment_id: U(11), replaces: U(960) },
        { enrollment_id: U(12), replaces: null },
        { enrollment_id: U(13), replaces: U(961) },
      ]);
      expect(
        t.fn.db.state.cards
          .filter(k => !k.stopped)
          .map(k => k.enrollment_id)
          .sort(),
      ).toEqual([U(11), U(12), U(13)]);
      expect(sheets[0].names).toEqual(['Jordan Abel', 'Avery Byrne', 'Cam Cole']);
      expect(sheets[0].numbers).toEqual(['Card 2', 'Card 1', 'Card 2']);
      const box = parse(StudentCards.render(LIVE));
      expect(notesOf(box)).toEqual([
        '3 cards went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
      ]);
      sheets[0].codes.forEach(code => {
        expect(box.textContent).not.toContain(code);
        expect(everythingKept()).not.toContain(code);
      });
      sheets[0].passwords.forEach(password => {
        expect(box.textContent).not.toContain(password);
        passwordNotKept(keptBefore, password);
      });
    } finally {
      t.session.signOut();
    }
  });

  it('a class of more than 250 goes in batches of 250', async () => {
    const many = [];
    const fnMany = [];
    for (let i = 0; i < 260; i++) {
      many.push({ id: U(2000 + i), firstName: 'S', lastName: 'N' + String(i).padStart(3, '0'), studentNumber: '1' });
      fnMany.push({ id: U(2000 + i), number: '1' });
    }
    const t = await signedIn({ students: many, fnStudents: fnMany });
    try {
      many.forEach((s, i) =>
        t.fn.db.state.cards.push({
          id: U(5000 + i),
          enrollment_id: s.id,
          code_hmac: 'z' + i,
          pw_hmac: null,
          seq: 1,
          stopped: false,
        }),
      );
      t.fn.markPrinted(many.map((s, i) => U(5000 + i)));
      await shown(LIVE);
      press('spCardsNewCodes', LIVE);
      expect(asked[0].title).toBe('New Codes for All 260 Students?');
      asked[0].onOk();
      await vi.waitFor(() => expect(sheets.length).toBe(1), { timeout: 10000 });
      expect(t.fn.posts.map(p => p.body.items.length)).toEqual([250, 10]);
      expect(t.fn.posts[0].body.request_id).not.toBe(t.fn.posts[1].body.request_id);
      expect(sheets.length).toBe(1);
      expect(sheets[0].names.length).toBe(260);
    } finally {
      t.session.signOut();
    }
  });

  it('a part-failed run prints what was made and says plainly which students still have their old card', async () => {
    StudentCards._setBatch(1);
    // The first student's request is answered; the second never arrives, nor its one retry; the third is never sent.
    const t = await signedIn({ fetch: { fail: (post, n) => n === 2 || n === 3 } });
    try {
      [U(11), U(12), U(13)].forEach((sid, i) =>
        t.fn.db.state.cards.push({
          id: U(960 + i),
          enrollment_id: sid,
          code_hmac: 'y' + i,
          pw_hmac: null,
          seq: 1,
          stopped: false,
        }),
      );
      t.fn.markPrinted([U(960), U(961), U(962)]);
      await shown(LIVE);
      const reads = () => t.session.sent().filter(c => c[0] === 'list_student_cards').length;
      const before = reads();
      press('spCardsNewCodes', LIVE);
      asked[0].onOk();
      await StudentCards._making(LIVE);
      await afterDraw();
      expect(t.fetcher.count()).toBe(3);
      expect(sheets.length).toBe(1);
      expect(sheets[0].names).toEqual(['Jordan Abel']);
      // The list is read again.
      expect(reads()).toBe(before + 1);
      const box = parse(StudentCards.render(LIVE));
      expect(notesOf(box)).toEqual([
        '1 card went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
        '2 students still have their old card: Avery Byrne, Cam Cole. Use Print New Card on their rows to try again.',
      ]);
      // Print New Card on one of them: the line names the other only.
      StudentCards._setBatch(250);
      t.fetcher.count = () => 0;
      globalThis.fetch = fetchFrom(t.fn);
      press('spCardsNewCard', LIVE, { student: U(12) });
      asked[1].onOk();
      await StudentCards._making(LIVE);
      await afterDraw();
      expect(notesOf(parse(StudentCards.render(LIVE)))).toEqual([
        '1 card went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
        '1 student still has their old card: Cam Cole. Use Print New Card on their row to try again.',
      ]);
    } finally {
      t.session.signOut();
    }
  });

  it('a student another tab gave a new card first is not named as holding the old one, once the list is read', async () => {
    const t = await signedIn();
    try {
      [U(11), U(12), U(13)].forEach((sid, i) =>
        t.fn.db.state.cards.push({
          id: U(960 + i),
          enrollment_id: sid,
          code_hmac: 'y' + i,
          pw_hmac: null,
          seq: 1,
          stopped: false,
        }),
      );
      t.fn.markPrinted([U(960), U(961), U(962)]);
      await shown(LIVE);
      // Another tab replaces Cam's card; this list does not know.
      t.fn.db.state.cards.find(k => k.id === U(962)).stopped = true;
      t.fn.db.state.cards.push({
        id: U(970),
        enrollment_id: U(13),
        code_hmac: 'w',
        pw_hmac: null,
        seq: 2,
        stopped: false,
      });
      // ...and prints it there.
      t.fn.markPrinted([U(970)]);
      press('spCardsNewCodes', LIVE);
      asked[0].onOk();
      await StudentCards._making(LIVE);
      await afterDraw();
      expect(sheets[0].names).toEqual(['Jordan Abel', 'Avery Byrne']);
      // Read again: Cam has the other tab's printed card. Nothing is said about him.
      const box = parse(StudentCards.render(LIVE));
      expect(notesOf(box)).toEqual([
        '2 cards went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
      ]);
      expect(rowsOf(box)[2][2]).toMatch(/^Printed /);
    } finally {
      t.session.signOut();
    }
  });

  it('the screen going between two requests: the rest are not sent, nothing prints', async () => {
    StudentCards._setBatch(1);
    let release;
    const gate = new Promise(r => (release = r));
    const t = await signedIn({ fetch: { hold: (post, n) => (n === 1 ? gate : null) } });
    try {
      await shown(LIVE);
      // No card held: New Codes is not offered, but it works the same way when asked.
      [U(11), U(12), U(13)].forEach((sid, i) =>
        t.fn.db.state.cards.push({
          id: U(960 + i),
          enrollment_id: sid,
          code_hmac: 'y' + i,
          pw_hmac: null,
          seq: 1,
          stopped: false,
        }),
      );
      t.fn.markPrinted([U(960), U(961), U(962)]);
      StudentCards._reset();
      await shown(LIVE);
      press('spCardsNewCodes', LIVE);
      asked[0].onOk();
      await settle();
      onPage = null;
      release();
      await afterDraw();
      expect(t.fetcher.count()).toBe(1);
      expect(sheets).toEqual([]);
      expect(StudentCards._holding()).toBe(false);
    } finally {
      t.session.signOut();
    }
  });

  it('Demo Mode: every card replaced on the device, nothing sent', async () => {
    seedDemo();
    await shown(CID);
    const keptBefore = everythingKept();
    await StudentCards.makeAndPrint(CID);
    const firstCodes = sheets[0].codes;
    const before = storedCards().map(c => c.id);
    press('spCardsNewCodes', CID);
    expect(asked[0].title).toBe('New Codes for All 3 Students?');
    asked[0].onOk();
    await StudentCards._making(CID);
    await afterDraw();
    expect(sheets.length).toBe(2);
    expect(sheets[1].numbers).toEqual(['Card 2', 'Card 2', 'Card 2']);
    sheets[1].codes.forEach(code => expect(firstCodes).not.toContain(code));
    expect(
      storedCards()
        .map(c => c.id)
        .some(id => before.includes(id)),
    ).toBe(false);
    expect(localStorage.getItem('fv-sync-queue-v1')).toBe(null);
    sheets[1].codes.forEach(code => expect(everythingKept()).not.toContain(code));
    sheets[1].passwords.forEach(password => passwordNotKept(keptBefore, password));
  });
});

describe('Unlock and Unlock All', () => {
  // A card locked an hour ago.
  const locked = (n, sid, more) =>
    after(n, sid, {
      printed_at: printed,
      locked_at: new Date(Date.now() - 3600000).toISOString(),
      wrong_tries: 5,
      ...more,
    });

  it('Demo Mode: Unlock on a locked row clears the lock on the device; Unlock All shows for two or more', async () => {
    seedDemo();
    await shown(CID);
    const made = (
      await makeStudentCards(
        CID,
        ['s1', 's2', 's3'].map(id => ({ enrollment_id: id, replaces: null })),
      )
    ).data.results;
    await markStudentCardsPrinted(
      CID,
      made.map(r => r.card_id),
    );
    const kept = storedCards();
    kept[0].locked_at = '2026-11-15T16:00:00.000Z';
    kept[0].wrong_tries = 5;
    localStorage.setItem('gb-student-cards-' + CID, JSON.stringify(kept));
    StudentCards._reset();
    await shown(CID);
    let box = parse(StudentCards.render(CID));
    expect(buttons(box)).toEqual(['New Codes for This Class']);
    expect(rowButtons(box)[0]).toEqual(['Unlock Jordan Abel’s Card', 'Print a New Card for Jordan Abel']);
    press('spCardsUnlock', CID, { card: made[0].card_id });
    await settle();
    expect(storedCards()[0].locked_at).toBe(null);
    expect(storedCards()[0].wrong_tries).toBe(0);
    box = parse(StudentCards.render(CID));
    expect(rowsOf(box)[0][2]).toMatch(/^Printed /);
    expect(rowButtons(box)[0]).toEqual(['Print a New Card for Jordan Abel']);

    // Two locked: Unlock All, and it clears both.
    const again = storedCards();
    again[1].locked_at = '2026-11-15T16:00:00.000Z';
    again[2].locked_at = '2026-11-15T16:00:00.000Z';
    localStorage.setItem('gb-student-cards-' + CID, JSON.stringify(again));
    StudentCards._reset();
    await shown(CID);
    expect(buttons(parse(StudentCards.render(CID)))).toEqual(['Unlock All', 'New Codes for This Class']);
    press('spCardsUnlockAll', CID);
    await settle();
    expect(storedCards().every(c => !c.locked_at)).toBe(true);
    box = parse(StudentCards.render(CID));
    expect(buttons(box)).toEqual(['New Codes for This Class']);
    expect(rowsOf(box).map(r => r[2].replace(/ .*/, ''))).toEqual(['Printed', 'Printed', 'Printed']);
  });

  it('signed in: unlock_student_card with the card’s id and a key, nothing else; a list read before it lands still shows it unlocked', async () => {
    let list = () => [locked(1, U(11)), after(2, U(12), { printed_at: printed })];
    const t = await signedIn({ list: () => list() });
    try {
      let release;
      t.session.fake.on('unlock_student_card', () => new Promise(r => (release = r)));
      await shown(LIVE);
      expect(StudentCards.unlock(LIVE, U(901))).toBe(1);
      await settle();
      const sent = t.session.fake.calls.filter(c => c.name === 'unlock_student_card');
      expect(sent.length).toBe(1);
      expect(Object.keys(sent[0].params).sort()).toEqual(['p_card_id', 'p_idempotency_key']);
      expect(sent[0].params.p_card_id).toBe(U(901));
      expect(sent[0].params.p_idempotency_key).toMatch(UUID);
      expect(rowsOf(parse(StudentCards.render(LIVE)))[0][2]).toMatch(/^Printed /);
      // Read again while the unlock is on its way: the server still says Locked, with a lock time two
      // minutes ahead of this computer's clock. Shown unlocked: no clock is compared.
      list = () => [locked(1, U(11), { locked_at: new Date(Date.now() + 120000).toISOString() })];
      await StudentCards.load(LIVE);
      expect(rowsOf(parse(StudentCards.render(LIVE)))[0][2]).toMatch(/^Printed /);
      // The server has answered: from now on its list is the truth. Locked again: Locked.
      release({ data: {}, error: null });
      await settle();
      await StudentCards.load(LIVE);
      expect(rowsOf(parse(StudentCards.render(LIVE)))[0][2]).toBe('Locked');
    } finally {
      t.session.signOut();
    }
  });

  it('signed in: Unlock All is unlock_all_student_cards with the class id and a key', async () => {
    const t = await signedIn({ list: () => [locked(1, U(11)), locked(2, U(12)), after(3, U(13))] });
    try {
      let release;
      t.session.fake.on('unlock_all_student_cards', () => new Promise(r => (release = r)));
      await shown(LIVE);
      expect(buttons(parse(StudentCards.render(LIVE)))).toContain('Unlock All');
      press('spCardsUnlockAll', LIVE);
      await settle();
      const sent = t.session.fake.calls.filter(c => c.name === 'unlock_all_student_cards');
      expect(sent.length).toBe(1);
      expect(Object.keys(sent[0].params).sort()).toEqual(['p_course_id', 'p_idempotency_key']);
      expect(sent[0].params.p_course_id).toBe(LIVE);
      const box = parse(StudentCards.render(LIVE));
      expect(buttons(box)).not.toContain('Unlock All');
      expect(rowsOf(box).map(r => r[2].replace(/ .*/, ''))).toEqual(['Printed', 'Printed', 'Not']);
      // A read before the server's list catches up still shows them unlocked.
      await StudentCards.load(LIVE);
      expect(rowsOf(parse(StudentCards.render(LIVE))).map(r => r[2].replace(/ .*/, ''))).toEqual([
        'Printed',
        'Printed',
        'Not',
      ]);
      release({ data: { unlocked: 2 }, error: null });
      await settle();
    } finally {
      t.session.signOut();
    }
  });

  it('an unlock the server refuses: the list is read again and shows the card Locked', async () => {
    const t = await signedIn({ list: () => [locked(1, U(11))] });
    try {
      t.session.fake.on('unlock_student_card', () => ({
        data: null,
        error: { message: 'card not found', code: 'P0002' },
      }));
      await shown(LIVE);
      const reads = () => t.session.sent().filter(c => c[0] === 'list_student_cards').length;
      const before = reads();
      press('spCardsUnlock', LIVE, { card: U(901) });
      await afterDraw();
      expect(reads()).toBe(before + 1);
      expect(rowsOf(parse(StudentCards.render(LIVE)))[0][2]).toBe('Locked');
    } finally {
      t.session.signOut();
    }
  });

  it('a refusal that comes after the screen went reads and draws nothing', async () => {
    const t = await signedIn({ list: () => [locked(1, U(11))] });
    try {
      let refuse;
      t.session.fake.on('unlock_student_card', () => new Promise(r => (refuse = r)));
      await shown(LIVE);
      press('spCardsUnlock', LIVE, { card: U(901) });
      await settle();
      const drawn = [];
      DashClassManager.renderClassManager = () => drawn.push(1);
      DashClassManager.classManagerOpen = false;
      const reads = () => t.session.sent().filter(c => c[0] === 'list_student_cards').length;
      const before = reads();
      refuse({ data: null, error: { message: 'card not found', code: 'P0002' } });
      await afterDraw();
      expect(reads()).toBe(before);
      expect(drawn).toEqual([]);
      // Back on the screen: read again, and Locked.
      DashClassManager.classManagerOpen = true;
      await shown(LIVE);
      expect(reads()).toBe(before + 1);
      expect(rowsOf(parse(StudentCards.render(LIVE)))[0][2]).toBe('Locked');
    } finally {
      t.session.signOut();
    }
  });

  it('a card that is not locked, or not in the list, sends nothing', async () => {
    const t = await signedIn({ list: () => [after(1, U(11), { printed_at: printed })] });
    try {
      await shown(LIVE);
      expect(StudentCards.unlock(LIVE, U(901))).toBe(0);
      expect(StudentCards.unlock(LIVE, U(999))).toBe(0);
      expect(StudentCards.unlockAll(LIVE)).toBe(0);
      await settle();
      expect(t.session.fake.calls.filter(c => /unlock/.test(c.name))).toEqual([]);
    } finally {
      t.session.signOut();
    }
  });
});

describe('the three faults the review of S3-W1 left', () => {
  beforeEach(() => {
    catchPrints();
    catchQuestions();
  });
  afterEach(() => releaseQuestions());

  it('after a failed press the buttons stay off until the list read again lands', async () => {
    const t = await signedIn({ fetch: { fail: () => true } });
    try {
      await shown(LIVE);
      let land;
      t.session.fake.on('list_student_cards', () => new Promise(r => (land = r)));
      const drawn = [];
      DashClassManager.renderClassManager = () => drawn.push(parse(StudentCards.render(LIVE)));
      await StudentCards.makeAndPrint(LIVE);
      // Every draw since the press, and the screen now: the button is off while the list is read.
      const make = box => box.querySelector('[data-action="spCardsMake"]');
      expect(drawn.length).toBeGreaterThan(0);
      drawn.forEach(box => expect(make(box).hasAttribute('disabled')).toBe(true));
      expect(make(parse(StudentCards.render(LIVE))).hasAttribute('disabled')).toBe(true);
      land({ data: [], error: null });
      await afterDraw();
      const box = parse(StudentCards.render(LIVE));
      expect(make(box).hasAttribute('disabled')).toBe(false);
      expect(noteOf(box)).toBe('Could not make the cards. Check the connection and try again.');
    } finally {
      t.session.signOut();
    }
  });

  it('a late answer back on this class’s list: the list is read at once, the button off until it lands', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let release;
    const gate = new Promise(r => (release = r));
    const t = await signedIn({ fetch: { hold: () => gate } });
    try {
      await shown(LIVE);
      const pressed = StudentCards.makeAndPrint(LIVE);
      await settle();
      onPage = null;
      vi.advanceTimersByTime(1000);
      onPage = LIVE;
      let land;
      t.session.fake.on('list_student_cards', () => new Promise(r => (land = r)));
      release();
      expect(await pressed).toBe(0);
      expect(
        parse(StudentCards.render(LIVE)).querySelector('[data-action="spCardsMake"]').hasAttribute('disabled'),
      ).toBe(true);
      land({ data: t.fn.cardsListed(), error: null });
      await afterDraw();
      expect(
        parse(StudentCards.render(LIVE)).querySelector('[data-action="spCardsMake"]').hasAttribute('disabled'),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
      t.session.signOut();
    }
  });

  it('back from the browser’s Back cache: the list is drawn again with no Print Again', async () => {
    seedDemo();
    await shown(CID);
    await StudentCards.makeAndPrint(CID);
    expect(buttons(parse(StudentCards.render(CID)))).toContain('Print Again');
    const drawn = [];
    DashClassManager.renderClassManager = () => drawn.push(parse(StudentCards.render(CID)));
    // The page's own pagehide and pageshow (this test's window has no events; the browser test sends real ones).
    StudentCards._pagehide();
    expect(StudentCards._holding()).toBe(false);
    // A page shown fresh, not from the Back cache: nothing to draw again.
    StudentCards._pageshow({ persisted: false });
    expect(drawn).toEqual([]);
    StudentCards._pageshow({ persisted: true });
    expect(drawn.length).toBe(1);
    expect(buttons(drawn[0])).not.toContain('Print Again');
    expect(noteOf(drawn[0])).toBe(null);
  });

  it('a Mark Printed refused for good: after a reload the cards still show Printed, Make and Print leaves them, and Print New Card asks', async () => {
    const t = await signedIn();
    try {
      t.session.fake.on('mark_student_cards_printed', () => ({
        data: null,
        error: { message: 'refused', code: '42501' },
      }));
      await shown(LIVE);
      await StudentCards.makeAndPrint(LIVE);
      await settle();
      const made = [U(11), U(12), U(13)].map(sid => t.fn.live(sid).id);
      // The server never heard: its list says Not Printed.
      expect(t.fn.cardsListed().every(c => c.printed_at === null)).toBe(true);
      // The device keeps ids and times only.
      const kept = JSON.parse(localStorage.getItem('gb-cards-printed-here'));
      expect(Object.keys(kept).sort()).toEqual(made.slice().sort());
      Object.values(kept).forEach(v => expect(Object.keys(v).sort()).toEqual(['at', 'cid']));
      sheets[0].codes.forEach(code => expect(everythingKept()).not.toContain(code));

      // A reload.
      _reloadCardsPrintedHere();
      StudentCards._reset();
      const marks = () => t.session.fake.calls.filter(c => c.name === 'mark_student_cards_printed');
      const sentBefore = marks().length;
      await shown(LIVE);
      const box = parse(StudentCards.render(LIVE));
      expect(rowsOf(box).map(r => r[2].replace(/ .*/, ''))).toEqual(['Printed', 'Printed', 'Printed']);
      expect(buttons(box)).toEqual(['New Codes for This Class']);
      expect(await StudentCards.makeAndPrint(LIVE)).toBe(0);
      // The mark is sent once more, through the outbox, ids only.
      await settle();
      expect(marks().length).toBe(sentBefore + 1);
      expect(marks()[marks().length - 1].params.p_card_ids.slice().sort()).toEqual(made.slice().sort());
      // And only once from this page.
      StudentCards._reset();
      await shown(LIVE);
      await settle();
      expect(marks().length).toBe(sentBefore + 1);
      press('spCardsNewCard', LIVE, { student: U(11) });
      expect(asked.map(q => q.title)).toEqual(['Print a New Card for Jordan?']);
      expect(t.fn.posts.length).toBe(1);
    } finally {
      t.session.signOut();
    }
  });

  it('a mark kept on the device goes once the server shows the card printed, or the card is replaced', async () => {
    const t = await signedIn();
    try {
      await shown(LIVE);
      await StudentCards.makeAndPrint(LIVE);
      await afterDraw();
      expect(Object.keys(JSON.parse(localStorage.getItem('gb-cards-printed-here'))).length).toBe(3);
      await StudentCards.load(LIVE);
      expect(localStorage.getItem('gb-cards-printed-here')).toBe(null);
    } finally {
      t.session.signOut();
    }
  });
});

/* The review of S3-F2. */
const printedCard = (t, id, sid) => {
  t.fn.db.state.cards.push({ id, enrollment_id: sid, code_hmac: 'x' + id, pw_hmac: null, seq: 1, stopped: false });
  t.fn.markPrinted([id]);
};

describe('an old card stopped and the new one not printed', () => {
  beforeEach(() => {
    catchPrints();
    catchQuestions();
  });
  afterEach(() => {
    releaseQuestions();
    StudentCards._setBatch(250);
  });

  it('Print New Card, the reply lost and its recovery lost too: said from the list read afterwards', async () => {
    // 1 reaches the function and its reply is lost; 2 is its replay (no code); 3 and its retry 4 never arrive.
    const t = await signedIn({ fetch: { lose: (post, n) => n === 1, fail: (post, n) => n === 3 || n === 4 } });
    try {
      printedCard(t, U(901), U(11));
      await shown(LIVE);
      let land;
      t.session.fake.on('list_student_cards', () => new Promise(r => (land = r)));
      press('spCardsNewCard', LIVE, { student: U(11) });
      asked[0].onOk();
      await StudentCards._making(LIVE);
      await afterDraw();
      expect(sheets).toEqual([]);
      // The server stopped the old card and made a new one nobody printed.
      expect(t.fn.db.state.cards.find(k => k.id === U(901)).stopped).toBe(true);
      // Until the list read again lands, nothing is said about what became of the card, and the buttons are off.
      let box = parse(StudentCards.render(LIVE));
      expect(notesOf(box)).toEqual(['Checking which cards were made…']);
      expect(box.querySelector('[data-action="spCardsNewCard"]').hasAttribute('disabled')).toBe(true);
      land({ data: t.fn.cardsListed(), error: null });
      await afterDraw();
      box = parse(StudentCards.render(LIVE));
      expect(notesOf(box)).toEqual([
        // The button's own words: Avery and Cam have no card yet, so it makes three.
        "Jordan's old card has stopped, but the new one didn't print. Press Make and Print 3 Cards to print it.",
      ]);
      expect(rowsOf(box)[0]).toEqual(['Jordan Abel', expect.stringMatching(/^Card 2 · Made /), 'Not Printed']);
      expect(buttons(box)).toContain('Make and Print 3 Cards');
      // Make and Print prints it, and the line goes.
      t.fetcher.count = () => 0;
      globalThis.fetch = fetchFrom(t.fn);
      t.session.fake.on('list_student_cards', () => ({ data: t.fn.cardsListed(), error: null }));
      await StudentCards.makeAndPrint(LIVE);
      await afterDraw();
      expect(sheets[0].names).toContain('Jordan Abel');
      expect(notesOf(parse(StudentCards.render(LIVE)))[1]).toBe(undefined);
    } finally {
      t.session.signOut();
    }
  });

  it('New Codes for This Class: one student printed, one with the old card stopped, one still on the old card', async () => {
    StudentCards._setBatch(1);
    // 1: Jordan. 2: Avery's, its reply lost; 3: the replay; 4 and 5: the ask again, never arriving. 6 and 7: Cam's, never arriving.
    const t = await signedIn({
      fetch: { lose: (post, n) => n === 2, fail: (post, n) => n === 4 || n === 5 || n === 6 || n === 7 },
    });
    try {
      printedCard(t, U(960), U(11));
      printedCard(t, U(961), U(12));
      printedCard(t, U(962), U(13));
      await shown(LIVE);
      press('spCardsNewCodes', LIVE);
      asked[0].onOk();
      // Seven requests, one after another, each card's key made by WebCrypto off the event loop: wait for
      // the press itself to finish, not a fixed number of turns.
      await StudentCards._making(LIVE);
      await afterDraw();
      expect(t.fetcher.count()).toBe(7);
      expect(sheets[0].names).toEqual(['Jordan Abel']);
      expect(t.fn.db.state.cards.find(k => k.id === U(961)).stopped).toBe(true);
      expect(t.fn.live(U(13)).id).toBe(U(962));
      const box = parse(StudentCards.render(LIVE));
      expect(notesOf(box)).toEqual([
        '1 card went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
        '1 student still has their old card: Cam Cole. Use Print New Card on their row to try again.',
        "1 student's old card has stopped and the new one didn't print: Avery Byrne. Press Make and Print 1 Card to print it.",
      ]);
    } finally {
      t.session.signOut();
    }
  });

  it('the plural form', () => {
    // Words only; the class run above shows where they go.
    expect(StudentCards._stoppedLine(['Bea Bell', 'Cam Cole'], null, 2)).toBe(
      "2 students' old cards have stopped and the new ones didn't print: Bea Bell, Cam Cole. Press Make and Print 2 Cards to print them.",
    );
  });
});

describe('a read and a press never cross', () => {
  beforeEach(() => {
    catchPrints();
    catchQuestions();
  });
  afterEach(() => releaseQuestions());

  it('a minute-old list read again when shown: drawn at once with every button off until it lands', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t = await signedIn();
    try {
      vi.setSystemTime(new Date('2026-11-10T18:00:00.000Z'));
      printedCard(t, U(901), U(11));
      await shown(LIVE);
      vi.setSystemTime(new Date('2026-11-10T18:01:30.000Z'));
      let land;
      t.session.fake.on('list_student_cards', () => new Promise(r => (land = r)));
      const drawn = [];
      DashClassManager.renderClassManager = () => drawn.push(parse(StudentCards.render(LIVE)));
      await shown(LIVE);
      expect(drawn.length).toBe(1);
      // Every button that acts on the cards (a filter only changes which rows show).
      const off = box =>
        Array.from(box.querySelectorAll('button[data-action^="spCards"]:not([data-action="spCardsFilter"])')).every(b =>
          b.hasAttribute('disabled'),
        );
      expect(off(drawn[0])).toBe(true);
      // Pressed anyway: nothing is made.
      expect(await StudentCards.makeAndPrint(LIVE)).toBe(0);
      expect(await StudentCards.printNewCard(LIVE, U(12))).toBe(0);
      expect(t.fn.posts).toEqual([]);
      land({ data: t.fn.cardsListed(), error: null });
      await afterDraw();
      expect(off(parse(StudentCards.render(LIVE)))).toBe(false);
    } finally {
      vi.useRealTimers();
      t.session.signOut();
    }
  });

  it('a Yes while a read is out waits for it, and the read cannot undo the press', async () => {
    const t = await signedIn();
    try {
      printedCard(t, U(901), U(11));
      await shown(LIVE);
      press('spCardsNewCard', LIVE, { student: U(11) });
      // A read starts while the question is up; it will answer with the list as it is now.
      const before = t.fn.cardsListed();
      let land;
      t.session.fake.on('list_student_cards', () => new Promise(r => (land = r)));
      StudentCards.load(LIVE);
      asked[0].onOk();
      await afterDraw();
      expect(t.fn.posts).toEqual([]);
      t.session.fake.on('list_student_cards', () => ({ data: t.fn.cardsListed(), error: null }));
      land({ data: before, error: null });
      await afterDraw();
      expect(t.fn.posts.length).toBe(1);
      expect(sheets.length).toBe(1);
      const box = parse(StudentCards.render(LIVE));
      expect(rowsOf(box)[0]).toEqual([
        'Jordan Abel',
        expect.stringMatching(/^Card 2 · /),
        expect.stringMatching(/^Printed /),
      ]);
      expect(Object.keys(JSON.parse(localStorage.getItem('gb-cards-printed-here')))).toContain(t.fn.live(U(11)).id);
    } finally {
      t.session.signOut();
    }
  });

  // S3-F2 follow-up: the screen is never silent after Yes. A reviewer of PR 1014 saw no word while the Yes waited.
  it.each([
    ['Print New Card', 'spCardsNewCard', { student: U(11) }, 1],
    ['New Codes for This Class', 'spCardsNewCodes', undefined, 3],
  ])(
    '%s: a Yes waiting on the list read says Making cards… until the cards are made',
    async (what, action, data, n) => {
      const t = await signedIn();
      try {
        printedCard(t, U(901), U(11));
        await shown(LIVE);
        press(action, LIVE, data);
        let land;
        t.session.fake.on('list_student_cards', () => new Promise(r => (land = r)));
        StudentCards.load(LIVE);
        const drawn = [];
        DashClassManager.renderClassManager = () => drawn.push(parse(StudentCards.render(LIVE)));
        asked[0].onOk();
        // Drawn at once with the line, and every button that acts on the list off.
        expect(drawn.length).toBe(1);
        expect(notesOf(drawn[0])).toEqual(['Making cards…']);
        await afterDraw();
        let box = parse(StudentCards.render(LIVE));
        expect(notesOf(box)).toEqual(['Making cards…']);
        expect(
          Array.from(box.querySelectorAll('button[data-action^="spCards"]:not([data-action="spCardsFilter"])')).every(
            b => b.hasAttribute('disabled'),
          ),
        ).toBe(true);
        expect(t.fn.posts).toEqual([]);
        t.session.fake.on('list_student_cards', () => ({ data: t.fn.cardsListed(), error: null }));
        land({ data: t.fn.cardsListed(), error: null });
        await settle();
        await StudentCards._making(LIVE);
        await afterDraw();
        expect(t.fn.posts.length).toBe(1);
        expect(sheets.length).toBe(1);
        expect(sheets[0].names.length).toBe(n);
        box = parse(StudentCards.render(LIVE));
        expect(notesOf(box) || []).not.toContain('Making cards…');
      } finally {
        t.session.signOut();
      }
    },
  );

  it.each([
    [
      'Class Settings closes',
      () => (DashClassManager.classManagerOpen = false),
      () => (DashClassManager.classManagerOpen = true),
    ],
    ['another tab is shown', () => (onPage = null), () => (onPage = LIVE)],
    ['another class is shown', () => (onPage = CID), () => (onPage = LIVE)],
  ])(
    'a Yes waiting on the read, and then %s: the line goes, and nothing is made when the read lands',
    async (what, leave, back) => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const t = await signedIn();
      try {
        printedCard(t, U(901), U(11));
        await shown(LIVE);
        press('spCardsNewCard', LIVE, { student: U(11) });
        let land;
        t.session.fake.on('list_student_cards', () => new Promise(r => (land = r)));
        StudentCards.load(LIVE);
        asked[0].onOk();
        expect(notesOf(parse(StudentCards.render(LIVE)))).toEqual(['Making cards…']);
        leave();
        vi.advanceTimersByTime(1000); // the watch sees the screen gone
        back();
        // Back on the list before the read lands: the Yes came to nothing, so nothing says cards are being made.
        expect(notesOf(parse(StudentCards.render(LIVE))) || []).not.toContain('Making cards…');
        land({ data: t.fn.cardsListed(), error: null });
        await afterDraw();
        expect(t.fn.posts).toEqual([]);
        expect(sheets).toEqual([]);
        expect(notesOf(parse(StudentCards.render(LIVE))) || []).not.toContain('Making cards…');
      } finally {
        vi.useRealTimers();
        t.session.signOut();
      }
    },
  );

  it('an answer to a read begun before a press finished is dropped, and the list read again', async () => {
    let release;
    const gate = new Promise(r => (release = r));
    const t = await signedIn({ fetch: { hold: () => gate } });
    try {
      t.session.fake.on('mark_student_cards_printed', () => new Promise(() => {})); // the server never hears
      await shown(LIVE);
      const pressed = StudentCards.makeAndPrint(LIVE);
      await settle();
      // A read begun while the press is out (as Try Again could), answered with the list from before.
      const before = t.fn.cardsListed();
      let land;
      t.session.fake.on('list_student_cards', () => new Promise(r => (land = r)));
      StudentCards.load(LIVE);
      release();
      expect(await pressed).toBe(3);
      t.session.fake.on('list_student_cards', () => ({ data: t.fn.cardsListed(), error: null }));
      const reads = () => t.session.sent().filter(c => c[0] === 'list_student_cards').length;
      const n = reads();
      land({ data: before, error: null });
      await afterDraw();
      // Dropped: the cards just printed still show, and their notes are kept.
      expect(reads()).toBe(n + 1);
      const box = parse(StudentCards.render(LIVE));
      expect(rowsOf(box).map(r => r[2].replace(/ .*/, ''))).toEqual(['Printed', 'Printed', 'Printed']);
      expect(Object.keys(JSON.parse(localStorage.getItem('gb-cards-printed-here'))).length).toBe(3);
    } finally {
      t.session.signOut();
    }
  });

  it('data.js: a printed note is erased only by a read that began after it was made', async () => {
    const t = await signedIn();
    try {
      let land;
      t.session.fake.on('list_student_cards', () => new Promise(r => (land = r)));
      const reading = listStudentCards(LIVE);
      await settle();
      await new Promise(r => setTimeout(r, 2));
      await markStudentCardsPrinted(LIVE, [U(901)]);
      land({ data: [], error: null });
      await reading;
      expect(Object.keys(JSON.parse(localStorage.getItem('gb-cards-printed-here')))).toEqual([U(901)]);
      // A read begun after the note, with no such card: it was replaced, and the note goes.
      await new Promise(r => setTimeout(r, 2));
      t.session.fake.on('list_student_cards', () => ({ data: [], error: null }));
      await listStudentCards(LIVE);
      expect(localStorage.getItem('gb-cards-printed-here')).toBe(null);
    } finally {
      t.session.signOut();
    }
  });

  it('data.js: another tab’s printed notes survive this tab’s', async () => {
    const t = await signedIn();
    try {
      await markStudentCardsPrinted(LIVE, [U(901)]);
      // Another tab of the app writes its own note.
      const kept = JSON.parse(localStorage.getItem('gb-cards-printed-here'));
      kept[U(902)] = { at: new Date().toISOString(), cid: LIVE };
      localStorage.setItem('gb-cards-printed-here', JSON.stringify(kept));
      await markStudentCardsPrinted(LIVE, [U(903)]);
      expect(Object.keys(JSON.parse(localStorage.getItem('gb-cards-printed-here'))).sort()).toEqual([
        U(901),
        U(902),
        U(903),
      ]);
    } finally {
      t.session.signOut();
    }
  });
});

/* S3-F1: the filters and Cards Work Until. */

const filtersOf = box =>
  Array.from(box.querySelectorAll('.sc-filters [role="radio"]')).map(b => [
    b.textContent,
    b.getAttribute('aria-checked'),
  ]);
const emptyOf = box => (box.querySelector('.sc-empty') ? box.querySelector('.sc-empty').textContent : null);
const untilOf = box => ({
  value: box.querySelector('#sc-until-date').getAttribute('value'),
  label: box.querySelector('label[for="sc-until-date"]').textContent,
  hint: box.querySelector('#sc-until-hint').textContent,
  button: box.querySelector('[data-action="spCardsWorkUntilDefault"]')
    ? box.querySelector('[data-action="spCardsWorkUntilDefault"]').textContent
    : null,
});
const changeDay = (cid, value) =>
  CmStudentPage.handleChange({
    dataset: { actionChange: 'spCardsWorkUntil' },
    value,
    closest: () => ({ dataset: { cid } }),
  });

describe('the filters', () => {
  const states = () => [
    after(1, U(11), { printed_at: printed, last_opened_at: '2026-11-14T16:00:00+00:00' }),
    after(2, U(12)), // never printed
    after(3, U(13), { printed_at: printed, locked_at: new Date(Date.now() - 3600000).toISOString() }),
    after(4, U(14), { printed_at: printed }), // printed, never opened
  ];
  const students = [
    ...LIVE_STUDENTS,
    { id: U(14), firstName: 'Dee', lastName: 'Dunn' },
    { id: U(15), firstName: 'Eli', lastName: 'Eng' },
  ];

  it('All, Not Printed, Locked and Never Opened, each with its count; All first', async () => {
    const t = await signedIn({ students, list: states });
    try {
      await shown(LIVE);
      const box = parse(StudentCards.render(LIVE));
      expect(box.querySelector('.sc-filters').getAttribute('role')).toBe('radiogroup');
      expect(box.querySelector('.sc-filters').getAttribute('aria-label')).toBe('Show');
      expect(filtersOf(box)).toEqual([
        ['All 5', 'true'],
        ['Not Printed 2', 'false'],
        ['Locked 1', 'false'],
        ['Never Opened 2', 'false'],
      ]);
      expect(rowsOf(box).map(r => r[0])).toEqual(['Jordan Abel', 'Avery Byrne', 'Cam Cole', 'Dee Dunn', 'Eli Eng']);
    } finally {
      t.session.signOut();
    }
  });

  it.each([
    ['not_printed', ['Avery Byrne', 'Eli Eng']],
    ['locked', ['Cam Cole']],
    ['never_opened', ['Cam Cole', 'Dee Dunn']],
    ['all', ['Jordan Abel', 'Avery Byrne', 'Cam Cole', 'Dee Dunn', 'Eli Eng']],
  ])(
    '%s shows only its students, with their own buttons; the buttons above the list are the class’s',
    async (value, names) => {
      const t = await signedIn({ students, list: states });
      try {
        await shown(LIVE);
        const all = buttons(parse(StudentCards.render(LIVE)));
        press('spCardsFilter', LIVE, { value });
        const box = parse(StudentCards.render(LIVE));
        expect(rowsOf(box).map(r => r[0])).toEqual(names);
        expect(filtersOf(box).filter(f => f[1] === 'true').length).toBe(1);
        expect(box.querySelector('[data-value="' + value + '"]').getAttribute('aria-checked')).toBe('true');
        expect(buttons(box)).toEqual(all);
        // Nothing was asked of the server for a filter.
        expect(t.session.sent().filter(c => c[0] !== 'list_student_cards')).toEqual([]);
      } finally {
        t.session.signOut();
      }
    },
  );

  it.each([
    ['not_printed', 'Every student has a printed card.'],
    ['locked', 'No cards are locked.'],
    ['never_opened', 'Every student with a printed card has opened it.'],
  ])('%s with nobody in it says so', async (value, line) => {
    const t = await signedIn({
      list: () => [
        after(1, U(11), { printed_at: printed, last_opened_at: printed }),
        after(2, U(12), { printed_at: printed, last_opened_at: printed }),
        after(3, U(13), { printed_at: printed, last_opened_at: printed }),
      ],
    });
    try {
      await shown(LIVE);
      press('spCardsFilter', LIVE, { value });
      const box = parse(StudentCards.render(LIVE));
      expect(emptyOf(box)).toBe(line);
      expect(box.querySelector('.sc-table')).toBe(null);
    } finally {
      t.session.signOut();
    }
  });

  it('a filter stays chosen as the list changes, and its count follows', async () => {
    seedDemo();
    await shown(CID);
    press('spCardsFilter', CID, { value: 'not_printed' });
    expect(rowsOf(parse(StudentCards.render(CID))).length).toBe(3);
    catchPrints();
    await StudentCards.makeAndPrint(CID);
    await afterDraw();
    const box = parse(StudentCards.render(CID));
    expect(filtersOf(box)[1]).toEqual(['Not Printed 0', 'true']);
    expect(emptyOf(box)).toBe('Every student has a printed card.');
  });

  it('no list yet, or no students: no filters', async () => {
    seedDemo();
    onPage = CID;
    expect(parse(StudentCards.render(CID)).querySelector('.sc-filters')).toBe(null);
    seedDemo(ON, []);
    await shown(CID);
    expect(parse(StudentCards.render(CID)).querySelector('.sc-filters')).toBe(null);
  });
});

describe('Cards Work Until', () => {
  afterEach(() => vi.useRealTimers());

  it('Demo Mode: the default with no reporting date ahead is June 30; a chosen day goes on every card; Use June 30 goes back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T18:00:00.000Z'));
    seedDemo();
    await shown(CID);
    await makeStudentCards(CID, [{ enrollment_id: 's1', replaces: null }]);
    StudentCards._reset();
    await shown(CID);
    let box = parse(StudentCards.render(CID));
    expect(untilOf(box)).toEqual({
      value: '2027-06-30',
      label: 'Cards Work Until',
      hint: "A card stops opening after this day. It's June 30 until you choose another day, since the class has no reporting date ahead.",
      button: null,
    });
    expect(changeDay(CID, '2027-01-29')).toBe(true);
    await settle();
    expect(JSON.parse(localStorage.getItem('gb-student-cards-' + CID))[0].works_until).toBe('2027-01-29');
    expect(getCardsWorkUntil(CID).chosen).toBe('2027-01-29');
    box = parse(StudentCards.render(CID));
    expect(untilOf(box)).toEqual({
      value: '2027-01-29',
      label: 'Cards Work Until',
      hint: 'A card stops opening after this day.',
      button: 'Use June 30',
    });
    // A card made now takes the chosen day.
    const made = (await makeStudentCards(CID, [{ enrollment_id: 's2', replaces: null }])).data.results[0];
    expect(made.works_until).toBe('2027-01-29');
    press('spCardsWorkUntilDefault', CID);
    await settle();
    expect(getCardsWorkUntil(CID).chosen).toBe(null);
    expect(localStorage.getItem('gb-cards-work-until-' + CID)).toBe(null);
    expect(JSON.parse(localStorage.getItem('gb-student-cards-' + CID)).map(c => c.works_until)).toEqual([
      '2027-06-30',
      '2027-06-30',
    ]);
    expect(untilOf(parse(StudentCards.render(CID))).button).toBe(null);
  });

  it('with a reporting date ahead, that is the default, and the way back says so', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T18:00:00.000Z'));
    seedDemo({ ...ON, reportingTerms: [{ id: 't1', name: 'Term 1', starts_on: '2026-09-02', ends_on: '2027-01-29' }] });
    const terms = getReportingTerms(CID);
    if (!terms.length) {
      // The seed keeps reporting terms on the course; put them where getReportingTerms reads them.
      COURSES[CID].reportingTerms = [{ id: 't1', name: 'Term 1', starts_on: '2026-09-02', ends_on: '2027-01-29' }];
    }
    await shown(CID);
    let box = parse(StudentCards.render(CID));
    expect(untilOf(box).value).toBe('2027-01-29');
    expect(untilOf(box).hint).toBe(
      "A card stops opening after this day. It's the class's last reporting date until you choose another day.",
    );
    changeDay(CID, '2027-03-12');
    await settle();
    box = parse(StudentCards.render(CID));
    expect(untilOf(box).button).toBe('Use Last Reporting Date');
  });

  it('a day already past says so, and the cards show Past Its Last Day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T18:00:00.000Z'));
    seedDemo();
    await shown(CID);
    await makeStudentCards(CID, [{ enrollment_id: 's1', replaces: null }]);
    StudentCards._reset();
    await shown(CID);
    changeDay(CID, '2026-11-01');
    await settle();
    const box = parse(StudentCards.render(CID));
    expect(untilOf(box).hint).toBe('A card stops opening after this day. That day has passed, so no card opens now.');
    expect(rowsOf(box)[0][2]).toBe('Past Its Last Day');
  });

  it('a value that is not a day changes nothing; the same day twice sends once', async () => {
    const t = await signedIn();
    try {
      await shown(LIVE);
      changeDay(LIVE, 'soon');
      changeDay(LIVE, '2027-02-30x');
      await settle();
      expect(t.session.fake.calls.filter(c => c.name === 'set_cards_work_until')).toEqual([]);
      changeDay(LIVE, '2027-02-26');
      changeDay(LIVE, '2027-02-26');
      await settle();
      expect(t.session.fake.calls.filter(c => c.name === 'set_cards_work_until').length).toBe(1);
    } finally {
      t.session.signOut();
    }
  });

  it('signed in: the class’s day comes with the class, and is never sent up as a setting', async () => {
    const t = await signedIn();
    try {
      expect(getCardsWorkUntil(LIVE).known).toBe(false);
      _applyBundleCourseConfig(
        LIVE,
        {},
        { student_page_enabled: true, return_grades: 'on_return', cards_work_until: '2027-05-14' },
      );
      expect(getCardsWorkUntil(LIVE)).toMatchObject({ chosen: '2027-05-14', date: '2027-05-14', known: true });
      expect(JSON.stringify(getCourseConfig(LIVE))).not.toContain('2027-05-14');
      await settle();
      expect(t.session.fake.calls.filter(c => c.name === 'update_course')).toEqual([]);
      _applyBundleCourseConfig(LIVE, {}, { cards_work_until: null });
      expect(getCardsWorkUntil(LIVE)).toMatchObject({ chosen: null, known: true });
    } finally {
      t.session.signOut();
    }
  });

  it('signed in: set_cards_work_until with the class, the day and a key; a list read before it lands shows the new day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T18:00:00.000Z'));
    const t = await signedIn({ list: () => [after(1, U(11), { printed_at: printed, works_until: '2026-11-19' })] });
    try {
      let land;
      t.session.fake.on('set_cards_work_until', () => new Promise(r => (land = r)));
      await shown(LIVE);
      expect(rowsOf(parse(StudentCards.render(LIVE)))[0][2]).toBe('Past Its Last Day');
      changeDay(LIVE, '2027-06-25');
      await settle();
      const sent = t.session.fake.calls.filter(c => c.name === 'set_cards_work_until');
      expect(sent.length).toBe(1);
      expect(Object.keys(sent[0].params).sort()).toEqual(['p_course_id', 'p_date', 'p_idempotency_key']);
      expect(sent[0].params.p_course_id).toBe(LIVE);
      expect(sent[0].params.p_date).toBe('2027-06-25');
      expect(rowsOf(parse(StudentCards.render(LIVE)))[0][2]).toMatch(/^Printed /);
      // Read again before the server has it: the cards still show the new day.
      await StudentCards.load(LIVE);
      let box = parse(StudentCards.render(LIVE));
      expect(rowsOf(box)[0][2]).toMatch(/^Printed /);
      expect(untilOf(box).value).toBe('2027-06-25');
      land({ data: { works_until: '2027-06-25' }, error: null });
      await settle();
      expect(getCardsWorkUntil(LIVE)).toMatchObject({ chosen: '2027-06-25', known: true });
      // Back to the default: p_date null.
      t.session.fake.on('set_cards_work_until', () => ({ data: { works_until: '2027-06-30' }, error: null }));
      press('spCardsWorkUntilDefault', LIVE);
      await settle();
      const last = t.session.fake.calls.filter(c => c.name === 'set_cards_work_until').pop();
      expect(last.params.p_date).toBe(null);
      expect(getCardsWorkUntil(LIVE).chosen).toBe(null);
    } finally {
      t.session.signOut();
    }
  });

  it('signed in: a change the server refuses goes back to the server’s day, and the list is read again', async () => {
    const t = await signedIn({ list: () => [after(1, U(11), { printed_at: printed })] });
    try {
      _applyBundleCourseConfig(LIVE, {}, { cards_work_until: '2027-05-14' });
      t.session.fake.on('set_cards_work_until', () => ({
        data: null,
        error: { message: 'course not found', code: 'P0002' },
      }));
      await shown(LIVE);
      const reads = () => t.session.sent().filter(c => c[0] === 'list_student_cards').length;
      const before = reads();
      changeDay(LIVE, '2027-06-25');
      await afterDraw();
      expect(reads()).toBe(before + 1);
      expect(untilOf(parse(StudentCards.render(LIVE))).value).toBe('2027-05-14');
    } finally {
      t.session.signOut();
    }
  });

  it('a refusal that comes after the screen went reads and draws nothing', async () => {
    const t = await signedIn({ list: () => [after(1, U(11), { printed_at: printed })] });
    try {
      let refuse;
      t.session.fake.on('set_cards_work_until', () => new Promise(r => (refuse = r)));
      await shown(LIVE);
      changeDay(LIVE, '2027-06-25');
      await settle();
      const drawn = [];
      DashClassManager.renderClassManager = () => drawn.push(1);
      onPage = null;
      const reads = () => t.session.sent().filter(c => c[0] === 'list_student_cards').length;
      const before = reads();
      refuse({ data: null, error: { message: 'course not found', code: 'P0002' } });
      await afterDraw();
      expect(reads()).toBe(before);
      expect(drawn).toEqual([]);
    } finally {
      t.session.signOut();
    }
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
    // Unlock, Unlock All and Cards Work Until through the outbox, once each, named at the call.
    expect(src.match(/_writeRpc\('unlock_student_card'/g).length).toBe(1);
    expect(src.match(/_writeRpc\('unlock_all_student_cards'/g).length).toBe(1);
    expect(src.match(/_writeRpc\('set_cards_work_until'/g).length).toBe(1);
  });

  it('the database drift check sees every card RPC the client calls', async () => {
    const { extractRpcNames } = await import('../scripts/check-db-drift.mjs');
    const names = extractRpcNames(source('shared/data.js'));
    [
      'list_student_cards',
      'mark_student_cards_printed',
      'unlock_student_card',
      'unlock_all_student_cards',
      'set_cards_work_until',
    ].forEach(name => expect(names.has(name), name).toBe(true));
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
