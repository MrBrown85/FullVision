/**
 * Student cards (S0-W1, docs/plans/student-page-build-plan.md 1.5 and S3;
 * migrations/2026110903_student_card.sql): the bare list in Class Settings
 * › Student Page, with Make Cards and Print All, so a real card exists.
 *
 * - shared/data.js: the cards are the server's for a signed-in teacher
 *   (list_student_cards, issue_student_cards, mark_student_cards_printed)
 *   and are made and kept on the device in Demo Mode. A class whose student
 *   page is off has none and is sent nothing.
 * - teacher/student-cards.js: the list, and the printed card on the sheet
 *   the questionnaire slips print on.
 */
import './setup.js';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, signIn, seedClass, clearClass, settle } from './helpers/pin-save-paths.js';

const CID = 'c-cards';
const LIVE = U(1);
const ON = { student_page_enabled: true, return_grades: 'on_return' };
const CODE = /^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{3}-[ABCDEFGHJKMNPQRTUVWXYZ2346789]{3}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STUDENTS = [
  { id: 's1', firstName: 'Jordan', lastName: 'Abel', dateOfBirth: '2012-03-04' },
  { id: 's2', firstName: 'Avery', lastName: 'Byrne', studentNumber: '1234567' },
  { id: 's3', firstName: 'Noor', lastName: 'Chen' }, // nothing on file: a card password
];
const LIVE_STUDENTS = [
  { id: U(11), firstName: 'Jordan', lastName: 'Abel', dateOfBirth: '2012-03-04' },
  { id: U(12), firstName: 'Avery', lastName: 'Byrne' },
];
const card = (n, sid, more) => ({
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

function seedDemo(config, students) {
  clearClass(CID);
  seedClass(CID, { students: students || STUDENTS, courseConfigs: config || ON });
}
const storedCards = cid => JSON.parse(localStorage.getItem('gb-student-cards-' + (cid || CID)) || 'null');
const cardKeys = () => Object.keys(localStorage._store).filter(k => k.indexOf('student-cards') >= 0);

beforeEach(() => {
  localStorage.clear();
  StudentCards._reset();
});
afterEach(() => {
  clearClass(CID);
  clearClass(LIVE);
  StudentCards._reset();
  localStorage.clear();
});

describe('Demo Mode: cards are made and kept on this device', () => {
  beforeEach(() => seedDemo());

  it('Make Cards gives every student one card, with a password only where nothing is on file', async () => {
    expect((await listStudentCards(CID)).data).toEqual([]);
    const out = (await issueStudentCards(CID)).data;
    expect(out.issued).toBe(3);
    expect(out.cards.map(c => c.enrollment_id)).toEqual(['s1', 's2', 's3']);
    out.cards.forEach(c => {
      expect(c.code).toMatch(CODE);
      expect(c.printed_at).toBe(null);
      expect(c.locked_at).toBe(null);
      expect(c.works_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    expect(new Set(out.cards.map(c => c.code)).size).toBe(3);
    expect(out.cards.map(c => c.check)).toEqual(['identity', 'identity', 'password']);
    expect(out.cards.map(c => c.password === null)).toEqual([true, true, false]);
    expect(out.cards[2].password).toMatch(/^\d{4}$/);
    expect(storedCards().length).toBe(3);
    expect((await listStudentCards(CID)).data).toEqual(out.cards);
  });

  it('a student who has a card keeps it; a new student gets one', async () => {
    const first = (await issueStudentCards(CID)).data.cards;
    const again = (await issueStudentCards(CID)).data;
    expect(again.issued).toBe(0);
    expect(again.cards).toEqual(first);
    saveStudents(CID, getStudents(CID).concat([{ id: 's4', firstName: 'Lena', lastName: 'Dorn' }]));
    const more = (await issueStudentCards(CID)).data;
    expect(more.issued).toBe(1);
    expect(more.cards.slice(0, 3)).toEqual(first);
    expect(more.cards[3].enrollment_id).toBe('s4');
  });

  it('only the students asked for, when some are named', async () => {
    const out = (await issueStudentCards(CID, ['s2'])).data;
    expect(out.issued).toBe(1);
    expect(out.cards.map(c => c.enrollment_id)).toEqual(['s2']);
    expect((await listStudentCards(CID)).data.map(c => c.enrollment_id)).toEqual(['s2']);
  });

  it('the list is in roster order and leaves out a student no longer in the class', async () => {
    await issueStudentCards(CID);
    saveStudents(CID, [STUDENTS[2], STUDENTS[0]]);
    expect((await listStudentCards(CID)).data.map(c => c.enrollment_id)).toEqual(['s3', 's1']);
  });

  it('a card works until the class’s last reporting date, or the next June 30 with none ahead', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-10T18:00:00.000Z'));
      expect((await issueStudentCards(CID)).data.cards[0].works_until).toBe('2027-06-30');
      seedDemo({
        ...ON,
        reportingTerms: [
          { ordinal: 1, label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-06' },
          { ordinal: 2, label: 'Term 2', starts_on: '2026-11-09', ends_on: '2027-01-29' },
        ],
      });
      localStorage.removeItem('gb-student-cards-' + CID);
      expect((await issueStudentCards(CID)).data.cards[0].works_until).toBe('2027-01-29');
      vi.setSystemTime(new Date('2027-07-02T18:00:00.000Z'));
      localStorage.removeItem('gb-student-cards-' + CID);
      expect((await issueStudentCards(CID)).data.cards[0].works_until).toBe('2028-06-30');
    } finally {
      vi.useRealTimers();
    }
  });

  it('marking cards printed keeps the time', async () => {
    const cards = (await issueStudentCards(CID)).data.cards;
    const out = (await markStudentCardsPrinted(CID, [cards[0].id, cards[2].id])).data;
    expect(out.printed).toBe(2);
    const now = (await listStudentCards(CID)).data;
    expect(now.map(c => c.printed_at)).toEqual([out.printed_at, null, out.printed_at]);
  });

  it('a class whose student page is off has no cards: nothing is made, read or kept', async () => {
    seedDemo({ return_grades: 'on_return' });
    expect((await listStudentCards(CID)).data).toBe(null);
    expect((await issueStudentCards(CID)).data).toBe(null);
    expect((await markStudentCardsPrinted(CID, ['x'])).data).toBe(null);
    expect(cardKeys()).toEqual([]);
  });

  it('deleting the class takes its cards off the device', async () => {
    await issueStudentCards(CID);
    expect(cardKeys()).toEqual(['gb-student-cards-' + CID]);
    _clearCourseLocalState(CID);
    expect(cardKeys()).toEqual([]);
  });
});

describe('a signed-in teacher: the cards are the server’s', () => {
  let session;
  beforeEach(() => {
    seedClass(LIVE, { students: LIVE_STUDENTS, courseConfigs: ON });
    session = signIn();
  });
  afterEach(() => session.signOut());

  it('the list is list_student_cards, and is kept nowhere on this device', async () => {
    const cards = [card(1, U(11)), card(2, U(12), { check: 'password', password: '4821' })];
    session.fake.on('list_student_cards', () => ({ data: cards, error: null }));
    const out = await listStudentCards(LIVE);
    expect(out).toEqual({ data: cards, error: null });
    expect(session.sent()).toEqual([['list_student_cards', { p_course_id: LIVE }]]);
    expect(cardKeys()).toEqual([]);
    expect(JSON.stringify(localStorage._store)).not.toMatch(/K7M-4Q|4821/);
  });

  it('Make Cards is issue_student_cards for the whole class, with a key', async () => {
    const cards = [card(1, U(11)), card(2, U(12))];
    session.fake.on('issue_student_cards', () => ({ data: { issued: 2, cards }, error: null }));
    const out = await issueStudentCards(LIVE);
    expect(out).toEqual({ data: { issued: 2, cards }, error: null });
    const sent = session.fake.calls;
    expect(sent.map(c => c.name)).toEqual(['issue_student_cards']);
    expect(Object.keys(sent[0].params).sort()).toEqual(['p_course_id', 'p_enrollment_ids', 'p_idempotency_key']);
    expect(sent[0].params.p_course_id).toBe(LIVE);
    expect(sent[0].params.p_enrollment_ids).toBe(null);
    expect(sent[0].params.p_idempotency_key).toMatch(UUID);
    expect(cardKeys()).toEqual([]);
  });

  it('only server ids are named when some students are asked for', async () => {
    session.fake.on('issue_student_cards', () => ({ data: { issued: 1, cards: [card(1, U(11))] }, error: null }));
    await issueStudentCards(LIVE, [U(11), 'slocal-1']);
    expect(session.fake.calls[0].params.p_enrollment_ids).toEqual([U(11)]);
  });

  it('a call that fails answers with no data and its error, and makes nothing up', async () => {
    session.fake.on('issue_student_cards', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
    session.fake.on('list_student_cards', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
    expect((await issueStudentCards(LIVE)).data).toBe(null);
    expect((await issueStudentCards(LIVE)).error.message).toMatch(/failed to fetch/);
    expect((await listStudentCards(LIVE)).data).toBe(null);
    expect(cardKeys()).toEqual([]);
  });

  it('marking cards printed is mark_student_cards_printed, with a key and server ids only', async () => {
    const out = await markStudentCardsPrinted(LIVE, [U(901), 'not-a-card', U(902)]);
    expect(out.data.printed).toBe(2);
    await settle();
    const sent = session.fake.calls;
    expect(sent.map(c => c.name)).toEqual(['mark_student_cards_printed']);
    expect(Object.keys(sent[0].params).sort()).toEqual(['p_card_ids', 'p_idempotency_key']);
    expect(sent[0].params.p_card_ids).toEqual([U(901), U(902)]);
    expect(sent[0].params.p_idempotency_key).toMatch(UUID);
  });

  it('a class whose student page is off is sent nothing', async () => {
    seedClass(LIVE, { students: LIVE_STUDENTS, courseConfigs: { return_grades: 'on_return' } });
    expect((await listStudentCards(LIVE)).data).toBe(null);
    expect((await issueStudentCards(LIVE)).data).toBe(null);
    expect((await markStudentCardsPrinted(LIVE, [U(901)])).data).toBe(null);
    await settle();
    expect(session.sent()).toEqual([]);
    expect(StudentCards.render(LIVE)).toContain('sc-card'); // drawn only if asked; the tab never asks
    await settle();
    expect(session.sent()).toEqual([]);
  });
});

describe('the list in Class Settings › Student Page', () => {
  function parse(html) {
    const doc = parseHTML('<!doctype html><html><head></head><body></body></html>').document;
    const box = doc.createElement('div');
    box.innerHTML = html;
    return box;
  }
  const rowsOf = box =>
    Array.from(box.querySelectorAll('.sc-table tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent));
  const buttons = box => Array.from(box.querySelectorAll('button')).map(b => b.textContent);

  beforeEach(() => seedDemo());

  it('first says it is loading, then lists every student, A to Z, with no card yet', async () => {
    let box = parse(StudentCards.render(CID));
    expect(box.querySelector('h2').textContent).toBe('Student Cards');
    expect(box.querySelector('.sc-note').textContent).toBe('Loading cards…');
    expect(box.querySelector('.sc-table')).toBe(null);
    expect(buttons(box)).toEqual([]);
    await settle();
    box = parse(StudentCards.render(CID));
    expect(box.querySelector('.sc-note')).toBe(null);
    expect(Array.from(box.querySelectorAll('.sc-table thead th')).map(th => th.textContent)).toEqual([
      'Student',
      'Card Code',
      'Status',
    ]);
    expect(rowsOf(box)).toEqual([
      ['Jordan Abel', 'No Card Yet', ''],
      ['Avery Byrne', 'No Card Yet', ''],
      ['Noor Chen', 'No Card Yet', ''],
    ]);
    // Nothing to print yet.
    expect(buttons(box)).toEqual(['Make Cards']);
    expect(box.querySelector('[data-cid]').dataset.cid).toBe(CID);
  });

  it('Make Cards fills in the codes and offers Print All; with every student carded it is gone', async () => {
    StudentCards.render(CID);
    await settle();
    await StudentCards.make(CID);
    const box = parse(StudentCards.render(CID));
    const rows = rowsOf(box);
    expect(rows.map(r => r[0])).toEqual(['Jordan Abel', 'Avery Byrne', 'Noor Chen']);
    rows.forEach(r => {
      expect(r[1]).toMatch(CODE);
      expect(r[2]).toBe('Not Printed');
    });
    expect(buttons(box)).toEqual(['Print All']);
    // The password is on the printed card, not in the list.
    expect(box.textContent).not.toContain(storedCards()[2].password);
  });

  it('a printed card says when, and a locked one says Locked', async () => {
    const session = signIn();
    try {
      seedClass(LIVE, { students: LIVE_STUDENTS, courseConfigs: ON });
      session.fake.on('list_student_cards', () => ({
        data: [
          card(1, U(11), { printed_at: '2026-11-10T19:30:00+00:00', locked_at: '2026-11-10T20:00:00+00:00' }),
          card(2, U(12)),
        ],
        error: null,
      }));
      StudentCards.render(LIVE);
      await settle();
      const box = parse(StudentCards.render(LIVE));
      expect(rowsOf(box)).toEqual([
        ['Jordan Abel', 'K7M-4Q1', 'Printed Nov 10Locked'],
        ['Avery Byrne', 'K7M-4Q2', 'Not Printed'],
      ]);
      expect(box.querySelector('.sc-lock').textContent).toBe('Locked');
      expect(buttons(box)).toEqual(['Print All']);
    } finally {
      session.signOut();
    }
  });

  it('a list that could not be read says so, and offers nothing to press', async () => {
    const session = signIn();
    try {
      seedClass(LIVE, { students: LIVE_STUDENTS, courseConfigs: ON });
      session.fake.on('list_student_cards', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
      StudentCards.render(LIVE);
      await settle();
      const box = parse(StudentCards.render(LIVE));
      expect(box.querySelector('.sc-note').textContent).toBe(
        'Could not load the cards. Check the connection and try again.',
      );
      expect(box.querySelector('.sc-table')).toBe(null);
      expect(buttons(box)).toEqual([]);
      // Drawn again at once, it does not ask again: one read a minute at most.
      StudentCards.render(LIVE);
      await settle();
      expect(session.sent().length).toBe(1);
    } finally {
      session.signOut();
    }
  });

  it('Make Cards that fails says so and keeps the list', async () => {
    const session = signIn();
    try {
      seedClass(LIVE, { students: LIVE_STUDENTS, courseConfigs: ON });
      session.fake.on('list_student_cards', () => ({ data: [card(1, U(11))], error: null }));
      session.fake.on('issue_student_cards', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
      StudentCards.render(LIVE);
      await settle();
      await StudentCards.make(LIVE);
      const box = parse(StudentCards.render(LIVE));
      expect(box.querySelector('.sc-note').textContent).toBe(
        'Could not make the cards. Check the connection and try again.',
      );
      expect(rowsOf(box)).toEqual([
        ['Jordan Abel', 'K7M-4Q1', 'Not Printed'],
        ['Avery Byrne', 'No Card Yet', ''],
      ]);
      expect(buttons(box)).toEqual(['Make Cards', 'Print All']);
    } finally {
      session.signOut();
    }
  });

  it('a class with no students says so', async () => {
    seedDemo(ON, []);
    StudentCards.render(CID);
    await settle();
    const box = parse(StudentCards.render(CID));
    expect(box.querySelector('.sc-note').textContent).toBe('No students to make cards for.');
    expect(buttons(box)).toEqual([]);
  });

  it('a name is escaped', async () => {
    seedDemo(ON, [{ id: 's1', firstName: '<img src=x onerror=alert(1)>', lastName: 'O’Neil & Co' }]);
    StudentCards.render(CID);
    await settle();
    const html = StudentCards.render(CID);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; O’Neil &amp; Co');
  });

  it('the clicks are handed over by the tab only for a class whose student page is on', async () => {
    const el = cid => ({ closest: () => ({ dataset: { cid } }) });
    seedDemo({ return_grades: 'on_return' });
    expect(CmStudentPage.handleAction('spCardsMake', el(CID))).toBe(false);
    expect(CmStudentPage.handleAction('spCardsPrint', el(CID))).toBe(false);
    await settle();
    expect(cardKeys()).toEqual([]);
    seedDemo();
    expect(CmStudentPage.handleAction('spCardsMake', el(CID))).toBe(true);
    await settle();
    expect(storedCards().length).toBe(3);
  });
});

describe('the printed card', () => {
  const cards = [
    card(1, 's1'),
    card(2, 's2'),
    card(3, 's3', { check: 'password', password: '4821' }),
    card(4, 'gone'), // a student no longer in the class
  ];

  it('one item for each student who has a card, A to Z by last name', () => {
    const items = StudentCards.cardItems(
      [STUDENTS[2], STUDENTS[0], STUDENTS[1], { id: 's9', firstName: 'No', lastName: 'Card' }],
      cards,
      'https://fullvision.ca',
    );
    expect(items.map(i => [i.id, i.name, i.code, i.url, i.password])).toEqual([
      [U(901), 'Jordan Abel', 'K7M-4Q1', 'https://fullvision.ca/s/#K7M-4Q1', ''],
      [U(902), 'Avery Byrne', 'K7M-4Q2', 'https://fullvision.ca/s/#K7M-4Q2', ''],
      [U(903), 'Noor Chen', 'K7M-4Q3', 'https://fullvision.ca/s/#K7M-4Q3', '4821'],
    ]);
  });

  it('the QR opens the student page with the code after #, as a slip’s does; Demo Mode’s opens the demo', () => {
    expect(StudentCards.cardUrl(cards[0], 'https://fullvision.ca/')).toBe(
      QrSlips.slipUrl('K7M-4Q1', 'https://fullvision.ca'),
    );
    expect(StudentCards.cardUrl(cards[0], 'https://fullvision.ca', true)).toBe('https://fullvision.ca/s/#demo-card');
    expect(StudentCards.cardUrl(cards[2], 'https://fullvision.ca', true)).toBe(
      'https://fullvision.ca/s/#demo-card-password',
    );
  });

  it('carries the name, the class, the QR and the code to type, and the password only when the card has one', () => {
    const doc = parseHTML('<!doctype html><html><body></body></html>').document;
    const cell = html => {
      const box = doc.createElement('div');
      box.innerHTML = html;
      return box;
    };
    const items = StudentCards.cardItems(STUDENTS, cards, 'https://fullvision.ca');
    const plain = cell(StudentCards.cardHtml(items[0], 'Science 8 · Block B', '<svg data-qr="1"></svg>'));
    expect(plain.querySelector('.qs-name').textContent).toBe('Jordan Abel');
    expect(plain.querySelector('.qs-class').textContent).toBe('Science 8 · Block B');
    expect(plain.querySelector('.qs-title').textContent).toBe('Student Card');
    expect(plain.querySelector('.qs-qr').getAttribute('aria-label')).toBe('QR code for Jordan Abel');
    expect(plain.querySelector('.qs-qr svg')).not.toBe(null);
    expect(plain.querySelector('.qs-scan').textContent).toBe('Scan with your phone camera.');
    expect(plain.querySelector('.qs-type').textContent).toBe('No camera? Go to fullvision.ca/s and typeK7M-4Q1');
    expect(plain.querySelector('.qs-pass')).toBe(null);
    // A card is kept, so it does not carry the slip's "works once" line.
    expect(plain.textContent).not.toMatch(/once/i);
    const withPassword = cell(StudentCards.cardHtml(items[2], 'Science 8', ''));
    expect(withPassword.querySelector('.qs-pass').textContent).toBe('Password4821');
  });

  it('every value on it is escaped', () => {
    const html = StudentCards.cardHtml(
      { name: '<b>Jo</b>', code: 'A<B', url: 'https://x.test/s/#A<B', password: '1<2' },
      'Sci & Tech',
      '',
    );
    expect(html).not.toMatch(/<b>|A<B|1<2/);
    expect(html).toContain('&lt;b&gt;Jo&lt;/b&gt;');
    expect(html).toContain('Sci &amp; Tech');
  });

  describe('Print All', () => {
    let doc;
    let orig;
    beforeEach(() => {
      doc = parseHTML('<!doctype html><html><head></head><body><main id="app"></main></body></html>').document;
      orig = {
        document: globalThis.document,
        print: window.print,
        origin: location.origin,
        add: window.addEventListener,
        remove: window.removeEventListener,
      };
      globalThis.document = doc;
      location.origin = 'https://fullvision.ca';
      window.addEventListener = () => {};
      window.removeEventListener = () => {};
    });
    afterEach(() => {
      globalThis.document = orig.document;
      window.print = orig.print;
      location.origin = orig.origin;
      window.addEventListener = orig.add;
      window.removeEventListener = orig.remove;
    });

    function manyStudents(n) {
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push({ id: 'e' + i, firstName: 'Student', lastName: 'N' + String(i).padStart(2, '0'), studentNumber: '1' });
      }
      return out;
    }

    it.each([1, 8, 9, 27])('%i cards go on the slips’ sheet, eight to a page, then are marked printed', async n => {
      seedDemo(ON, manyStudents(n));
      COURSES[CID].block = 'B';
      StudentCards.render(CID);
      await settle();
      await StudentCards.make(CID);
      let shot = null;
      window.print = () => {
        const root = doc.getElementById('qr-slips-root');
        shot = {
          pages: Array.from(root.querySelectorAll('.qs-page')).map(p => p.children.length),
          names: Array.from(root.querySelectorAll('.qs-name')).map(e => e.textContent),
          classes: Array.from(root.querySelectorAll('.qs-class')).map(e => e.textContent),
          codes: Array.from(root.querySelectorAll('.qs-type strong')).map(e => e.textContent),
          qrs: root.querySelectorAll('.qs-qr svg').length,
          active: doc.body.classList.contains('qr-slips-active'),
        };
      };
      expect(StudentCards.printAll(CID)).toBe(n);
      expect(shot.active).toBe(true);
      expect(shot.pages.length).toBe(Math.ceil(n / 8));
      expect(shot.pages.reduce((a, b) => a + b, 0)).toBe(n);
      shot.pages.forEach(count => expect(count).toBeLessThanOrEqual(8));
      expect(shot.names).toEqual(manyStudents(n).map(s => 'Student ' + s.lastName));
      expect(new Set(shot.classes)).toEqual(new Set(['Science 8 · Block B']));
      expect(shot.codes).toEqual(storedCards().map(c => c.code));
      expect(shot.qrs).toBe(n);
      await settle();
      // The sheet is taken off the page again, and every card is marked.
      await new Promise(r => setTimeout(r, 5));
      expect(doc.getElementById('qr-slips-root').innerHTML).toBe('');
      expect(storedCards().every(c => !!c.printed_at)).toBe(true);
      const drawn = StudentCards.render(CID);
      expect(drawn).toContain('Printed ');
      expect(drawn).not.toContain('Not Printed');
    });

    it('with no cards there is nothing to print and no dialog', async () => {
      seedDemo();
      let printed = 0;
      window.print = () => printed++;
      StudentCards.render(CID);
      await settle();
      expect(StudentCards.printAll(CID)).toBe(0);
      expect(printed).toBe(0);
    });
  });
});

describe('what the files name', () => {
  it('teacher/student-cards.js reaches the cards only through shared/data.js', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../teacher/student-cards.js', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|_writeRpc|\.rpc\(|getSupabase|localStorage/);
  });

  it('shared/data.js names the three card functions it calls, each once, where the drift check reads them', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../shared/data.js', import.meta.url), 'utf-8');
    expect(src.match(/_callRpcWithAuthGuard\('list_student_cards'/g).length).toBe(1);
    expect(src.match(/_callRpcWithAuthGuard\('issue_student_cards'/g).length).toBe(1);
    expect(src.match(/_writeRpc\('mark_student_cards_printed'/g).length).toBe(1);
    // Not built yet (S3): nothing names these.
    expect(src).not.toMatch(/unlock_student_card|unlock_all_student_cards|reissue_student_card|set_cards_work_until/);
  });
});
