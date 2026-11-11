/**
 * A student card on the student page (s/app.js, s/assignments.js,
 * s/student-data.js; docs/plans/student-page-build-plan.md, S0-F3), in Demo
 * Mode: the card's code, Is This You?, then the Assignments list.
 *
 * The line this build protects: a grade the teacher has not returned shows
 * nothing at all. The sample class holds a draft that was never returned
 * and a draft over a returned grade; their levels and comments must be
 * nowhere in the page's data or its HTML.
 *
 * Each test opens the page in a context of its own with the scripts
 * s/index.html names (tests/helpers/student-page-context.js), so calc.js
 * formats every result here from s/student-data.js alone.
 */
import { describe, expect, it } from 'vitest';
import { asServerSends, openStudentPage, studentPageScripts } from './helpers/student-page-context.js';

const CID = 'demo-science-8';
const SID = 'demo-cece';

// Every piece, as All Assignments lists it (S4-F1: the tab opens on To Do).
const rows = page =>
  (page.showAll(), [...page.root().querySelectorAll('.sp-row')]).map(li => ({
    title: li.querySelector('.sp-row-title').textContent,
    sub: (li.querySelector('.sp-row-sub') || {}).textContent || '',
    result: (li.querySelector('.sp-row-result') || {}).textContent || '',
    dot: li.querySelector('.sp-dot').getAttribute('class'),
  }));
const row = (page, title) => rows(page).find(r => r.title === title);

/* Card, Is This You? (the sample student's number), Assignments. */
async function walk(hash) {
  const page = openStudentPage();
  await page.start(hash || '#demo-card');
  await page.submit('form[data-form="card"]');
  page.type('#sp-ident', page.T.DEMO.number);
  await page.click('[data-act="card-yes"]');
  return page;
}

const GRADES_IN = 'typeof PROF_LABELS + " " + typeof formatLevel + " " + typeof assessmentCellValue';
const CALC = ['../shared/constants.js', '../shared/calc.js'];

describe('the student page fetches calc.js only when a grade is about to show', () => {
  it('the page itself names no calc.js, constants.js, Supabase client, key or Sentry', () => {
    // What main loads for a slip, then the card's three small files.
    expect(studentPageScripts()).toEqual([
      'shared/html.js',
      'shared/phone-report-view.js',
      'shared/loading-screen.js',
      's/student-data.js',
      'shared/student-view.js',
      's/page-view.js',
      's/student.js',
      's/questionnaire.js',
      's/report.js',
      's/app.js',
      's/assignments.js',
      // Sending work (S5-F2); it fetches shared/photo-shrink.js only when a send opens.
      's/send.js',
      // The teacher's Mark Up on returned work (S9-F3), Demo Mode's answers until Batch C.
      's/feedback.js',
      // Reflect on Feedback (S10-F1 and F2), Demo Mode only until Batch C.
      's/reflect.js',
    ]);
    const page = openStudentPage();
    expect(page.run(GRADES_IN)).toBe('undefined undefined undefined');
    expect(page.run('typeof getSupabase + " " + typeof _cache + " " + typeof Sentry')).toBe(
      'undefined undefined undefined',
    );
  });

  it.each(['', '#demo', '#demo-about', '#demo-report'])('a slip page (%s) fetches neither', async hash => {
    const page = openStudentPage();
    await page.start(hash);
    expect(page.fetched.filter(src => /calc|constants|student-data/.test(src))).toEqual([]);
    expect(page.run(GRADES_IN)).toBe('undefined undefined undefined');
  });

  it('a real slip, opened and answered to the identity check, fetches nothing', async () => {
    const page = openStudentPage();
    page.replies.push({
      ok: true,
      token: 'a'.repeat(64),
      student: { first_name: 'Cece' },
      course: { name: 'Science 8', block: 'B' },
      preview: [{ title: 'November Reflection', count: 1 }],
      check: 'identity',
    });
    await page.start('#k7m-4qx');
    page.replies.push({
      ok: true,
      parts: [
        {
          id: 'p1',
          kind: 'core_reflection',
          title: 'November Reflection',
          questions: [{ id: 'q1', kind: 'text', prompt: 'How did it go?', options: {}, core_ids: [] }],
        },
      ],
      context: {},
    });
    page.type('#sp-ident', '1234567');
    await page.click('[data-act="start"]');
    expect(page.calls.map(c => c.body.route)).toEqual(['open', 'verify']);
    expect(page.root().textContent).toContain('How did it go?');
    expect(page.fetched).toEqual([]);
  });

  it('the card and Is This You? fetch neither; reaching Assignments fetches both, once', async () => {
    const page = openStudentPage();
    await page.start('#demo-card');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', '999');
    await page.click('[data-act="card-yes"]');
    expect(page.fetched).toEqual([]);
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    expect(page.fetched).toEqual(CALC);
    expect(page.run(GRADES_IN)).toBe('object function function');
    expect(row(page, 'Energy Transfer Investigation').result).toBe('4.0');
    // The card opened again on this device: nothing is fetched a second time.
    page.T.openCard('P3R-8WD');
    await page.settle();
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    expect(row(page, 'Energy Transfer Investigation').result).toBe('4.0');
    expect(page.fetched).toEqual(CALC);
  });

  it('draws nothing of the list until calc.js is in: Is This You? waits on Checking', async () => {
    const page = openStudentPage();
    await page.start('#demo-card');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', page.T.DEMO.number);
    page.T.checkCard();
    // The check has passed and the page's data is here; calc.js is on its way.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(page.fetched).toEqual(CALC);
    expect(page.run('typeof assessmentCellValue')).toBe('undefined');
    expect(page.root().querySelector('.sp-row')).toBeNull();
    expect(page.root().querySelector('.sp-row-result')).toBeNull();
    const yes = page.root().querySelector('[data-act="card-yes"]');
    expect(yes.textContent).toBe('Checking…');
    expect(yes.hasAttribute('disabled')).toBe(true);
    expect(page.root().querySelector('#sp-ident').getAttribute('value')).toBe(page.T.DEMO.number);
    await page.settle();
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    expect(row(page, 'Cell Microscope Lab').result).toBe('2.7');
  });

  it('with calc.js out of reach the list opens without results and says so; Try Again brings them', async () => {
    const page = openStudentPage();
    page.net.fail = src => /calc\.js$/.test(src);
    await page.start('#demo-card-both');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    expect(page.root().querySelector('.sp-no-results .sp-msg').textContent).toBe(
      'Your results didn’t load. Check your internet and try again.',
    );
    expect(page.root().querySelector('[data-act="grades-retry"]').textContent).toBe('Try Again');
    // Every piece is listed, with its date; none has a result or a level.
    expect(rows(page)).toHaveLength(9);
    expect(rows(page).map(r => r.result)).toEqual(Array(9).fill(''));
    expect(row(page, 'Energy Transfer Investigation').sub).toMatch(/^Back \S+ \d+$/);
    expect(row(page, 'KMT & States of Matter Lab').sub).toMatch(/^Back \S+ \d+ · Late$/);
    expect(row(page, 'Immune System Quick Check').sub).toMatch(/^Missing · Due /);
    // No raw value stands in for a result.
    const cells = page.root().querySelector('.sp-list').textContent;
    expect(cells).not.toMatch(/Extending|Proficient|Developing|%|\d\.\d| \/ |Complete/);

    page.net.fail = () => false;
    await page.click('[data-act="grades-retry"]');
    expect(page.fetched).toEqual([...CALC, '../shared/calc.js']);
    expect(page.root().querySelector('.sp-no-results')).toBeNull();
    expect(row(page, 'Energy Transfer Investigation').result).toBe('4.0 · 100%');
    expect(row(page, 'Cell Structure Quiz').result).toBe('8 / 10');
    expect(page.calls).toHaveLength(0);
  });

  it('a class with nothing returned says nothing about results', () => {
    const page = openStudentPage();
    const reply = {
      student: { enrollment_id: 'e1', first_name: 'Sam' },
      course: { id: 'c1', name: 'Socials 10', block: 'C' },
      assessments: [{ id: 'a1', title: 'Map Quiz', date: '2026-10-20', due_date: '2026-10-22' }],
    };
    const read = page.run('StudentData.fromServer')(reply);
    page.run('StudentData.use')(read);
    const html = page.T.render({ screen: 'assignments', page: read, reply, all: true, demo: false });
    expect(html).toContain('Map Quiz');
    expect(html).not.toContain('sp-no-results');
  });
});

describe('student card: the demo walk', () => {
  it('shows Scan or Type Your Card', async () => {
    const page = openStudentPage();
    await page.start('#demo-card');
    const text = page.root().textContent;
    expect(text).toContain('FullVision');
    expect(text).toContain('Scan the code on your card');
    expect(text).toContain('or type it');
    expect(page.root().querySelector('label[for="sp-code"]').textContent).toBe('Card Code');
    expect(page.root().querySelector('#sp-code').getAttribute('value')).toBe('P3R8-WDK4');
    expect(page.root().querySelector('form[data-form="card"] button[type="submit"]').textContent).toBe('Continue');
    expect(page.calls).toHaveLength(0);
  });

  it('a code that is not six letters and numbers stays on the card screen', async () => {
    const page = openStudentPage();
    await page.start('#demo-card');
    page.type('#sp-code', 'HELLO');
    await page.submit('form[data-form="card"]');
    expect(page.root().querySelector('.sp-msg').textContent).toBe(
      "That code didn't work. Check the letters and numbers on your card.",
    );
    expect(page.root().querySelector('form[data-form="card"]')).toBeTruthy();
    expect(page.calls).toHaveLength(0);
  });

  it('asks Is This You? with the birthday or the student number', async () => {
    const page = openStudentPage();
    await page.start('#demo-card');
    await page.submit('form[data-form="card"]');
    expect(page.root().querySelector('.sp-head-title').textContent).toBe('Science 8 · Block B');
    expect(page.root().querySelector('.sp-head-sub').textContent).toBe('Student Page');
    expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
    const text = page.root().textContent;
    expect(text).toContain('This page is just for you.');
    expect(text).toContain('To make sure it’s you, enter your birthday or your student number.');
    expect(page.root().querySelectorAll('.sp-bday select')).toHaveLength(3);
    expect(page.root().querySelector('label[for="sp-ident"]').textContent).toBe('Student Number');
    expect(page.root().querySelector('[data-act="card-yes"]').textContent).toBe('Yes, That’s Me');
    expect(page.root().querySelector('[data-act="card-notme"]').textContent).toBe('No, That’s Not Me');
    expect(text).toContain('No camera? Type the code on your card');
  });

  it('the birthday opens the Assignments list', async () => {
    const page = openStudentPage();
    await page.start('#demo-card');
    await page.submit('form[data-form="card"]');
    const [y, m, d] = page.T.demoBirthday().split('-').map(Number);
    page.choose('#sp-bm', m);
    page.choose('#sp-bd', d);
    page.choose('#sp-by', y);
    await page.click('[data-act="card-yes"]');
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    expect(page.root().querySelector('.sp-head-title').textContent).toBe('Science 8');
    expect(page.root().querySelector('.sp-pill').textContent).toBe('Block B');
    expect(rows(page).map(r => r.title)).toEqual([
      'Science Fair Proposal',
      'Disease Research Poster',
      'Immune System Quick Check',
      'Energy Transfer Investigation',
      'Cell Structure Quiz',
      'Cell Microscope Lab',
      'Ecosystem Connections Essay',
      'KMT & States of Matter Lab',
      'Lab Safety Contract',
    ]);
    expect(page.calls).toHaveLength(0);
  });

  it('a card with no birthday or number on file asks for the card’s password', async () => {
    const page = openStudentPage();
    await page.start('#demo-card-password');
    await page.submit('form[data-form="card"]');
    expect(page.root().textContent).toContain('To make sure it’s you, type the password printed on your card.');
    expect(page.root().querySelector('label[for="sp-ident"]').textContent).toBe('Password');
    expect(page.root().querySelector('.sp-bday')).toBeNull();
    await page.click('[data-act="card-yes"]');
    expect(page.root().querySelector('.sp-msg').textContent).toBe('Type the password printed on your card.');
    page.type('#sp-ident', '0000');
    await page.click('[data-act="card-yes"]');
    expect(page.root().querySelector('.sp-msg').textContent).toBe(
      "That password doesn't match. Check the password on your card. 4 tries left.",
    );
    page.type('#sp-ident', page.T.DEMO.password);
    await page.click('[data-act="card-yes"]');
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    expect(page.calls).toHaveLength(0);
  });

  it('No, That’s Not Me asks for the card back and starts again', async () => {
    const page = openStudentPage();
    await page.start('#demo-card');
    await page.submit('form[data-form="card"]');
    await page.click('[data-act="card-notme"]');
    expect(page.root().querySelector('.sp-big').textContent).toBe('Give This Card Back');
    await page.click('[data-act="card-restart"]');
    expect(page.root().querySelector('form[data-form="card"]')).toBeTruthy();
    expect(page.T.state().data).toBeNull();
    expect(page.T.state().page).toBeNull();
  });
});

describe('student card: wrong tries', () => {
  it('counts the tries down, warns before the last, then locks the card', async () => {
    const page = openStudentPage();
    await page.start('#demo-card');
    await page.submit('form[data-form="card"]');
    await page.click('[data-act="card-yes"]');
    expect(page.root().querySelector('.sp-msg').textContent).toBe('Choose your birthday or type your student number.');

    const wrong = "That doesn't match. Check your birthday or student number.";
    const said = [];
    for (let i = 0; i < 4; i++) {
      page.choose('#sp-bm', 5);
      page.choose('#sp-bd', 16);
      page.choose('#sp-by', page.T.demoBirthday().slice(0, 4));
      await page.click('[data-act="card-yes"]');
      said.push(page.root().querySelector('.sp-msg').textContent);
    }
    expect(said).toEqual([
      wrong + ' 4 tries left.',
      wrong + ' 3 tries left.',
      wrong + ' 2 tries left.',
      wrong + ' 1 try left. One more wrong try locks this card, and your teacher will need to unlock it.',
    ]);
    // The picked birthday is still there to correct.
    expect(page.root().querySelector('#sp-bm').value).toBe('5');

    await page.click('[data-act="card-yes"]');
    expect(page.root().textContent).toContain(
      'This card is locked after too many wrong tries. Ask your teacher to unlock it.',
    );
    expect(page.root().querySelector('#sp-ident')).toBeNull();
    expect(page.root().querySelector('.sp-row')).toBeNull();
    expect(page.T.state().page).toBeNull();
    expect(page.calls).toHaveLength(0);
  });

  it('a right answer after wrong ones still opens the page', async () => {
    const page = openStudentPage();
    await page.start('#demo-card');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', '999');
    await page.click('[data-act="card-yes"]');
    expect(page.root().querySelector('.sp-msg').textContent).toContain('4 tries left.');
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
  });
});

describe('student card: a returned result follows the class’s grading style', () => {
  const STYLES = [
    // hash, a level of 4, the rubric's 3 and 2+ (2.67), a level of 2, a level of 3
    ['#demo-card', '4.0', '2.7', '2.0', '3.0'],
    ['#demo-card-letter', '100%', '67%', '50%', '75%'],
    ['#demo-card-both', '4.0 · 100%', '2.7 · 67%', '2.0 · 50%', '3.0 · 75%'],
  ];

  it.each(STYLES)('%s shows what formatLevel gives', async (hash, four, rubric, two, three) => {
    const page = await walk(hash);
    const format = v => page.run('formatLevel(' + JSON.stringify(CID) + ', ' + v + ')');
    // The text on the page is calc.js's own, and is the text pinned here.
    expect(format(4)).toBe(four);
    expect(format((3 + 7 / 3) / 2)).toBe(rubric);
    expect(format(2)).toBe(two);
    expect(format(3)).toBe(three);
    expect(row(page, 'Energy Transfer Investigation').result).toBe(four);
    expect(row(page, 'Cell Microscope Lab').result).toBe(rubric);
    expect(row(page, 'Ecosystem Connections Essay').result).toBe(two);
    expect(row(page, 'KMT & States of Matter Lab').result).toBe(three);
    // Points and Complete/Incomplete work read the same in every style.
    expect(row(page, 'Cell Structure Quiz').result).toBe('8 / 10');
    expect(row(page, 'Lab Safety Contract').result).toBe('Complete');
  });

  it('names the level beside the date, except in a Letter class', async () => {
    const day = (page, iso) => page.run('StudentPage.fmtDate')(iso, { month: 'short', day: 'numeric' });
    const prof = await walk('#demo-card');
    const back = title => prof.T.state().page.assessments.find(a => a.title === title).returnedAt;
    expect(row(prof, 'Energy Transfer Investigation').sub).toBe(
      'Back ' + day(prof, back('Energy Transfer Investigation')) + ' · Extending',
    );
    expect(row(prof, 'Cell Microscope Lab').sub).toMatch(/^Back \S+ \d+ · Proficient$/);
    expect(row(prof, 'KMT & States of Matter Lab').sub).toMatch(/^Back \S+ \d+ · Proficient · Late$/);
    expect(row(prof, 'Cell Structure Quiz').sub).toMatch(/^Back \S+ \d+$/);
    expect(row(prof, 'Energy Transfer Investigation').dot).toContain('sp-dot-back');

    const letter = await walk('#demo-card-letter');
    expect(row(letter, 'Energy Transfer Investigation').sub).toMatch(/^Back \S+ \d+$/);
    expect(letter.root().textContent).not.toMatch(/Extending|Proficient|Developing|Emerging/);
  });

  it('shows Missing at once, with its due date and no result', async () => {
    const page = await walk();
    const missing = row(page, 'Immune System Quick Check');
    expect(missing.sub).toMatch(/^Missing · Due \S+ \S+ \d+$/);
    expect(missing.result).toBe('');
    expect(missing.dot).toContain('sp-dot-missing');
  });
});

describe('student card: a draft is nowhere on the page', () => {
  const HASHES = ['#demo-card', '#demo-card-letter', '#demo-card-both'];

  it('the sample class does hold drafts, so the checks below mean something', () => {
    const page = openStudentPage();
    const cls = page.T.demoClass();
    const poster = cls.work.find(w => w.id === 'demo-poster');
    const essay = cls.work.find(w => w.id === 'demo-essay');
    expect(poster.ret).toMatchObject({ is_draft: true, returned_at: null });
    expect(poster.working.tag_scores.map(t => t.value)).toEqual([1, 1]);
    expect(poster.working.score.comment).toBe('Draft: two of your sources are missing.');
    expect(essay.ret.is_draft).toBe(true);
    expect(essay.ret.returned_at).toBeTruthy();
    expect(essay.working.tag_scores[0]).toMatchObject({ value: 3, modifier: 1 });
    expect(essay.working.score.comment).toBe('Draft: much clearer after your rewrite.');
    expect(essay.ret.returned_copy.tag_scores[0]).toMatchObject({ value: 2, modifier: 0 });
    // The one reader: nothing, then the returned copy, then the working copy.
    expect(page.T.returnedGrade(poster)).toBeNull();
    expect(page.T.returnedGrade(essay).tag_scores[0].value).toBe(2);
    expect(page.T.returnedGrade(cls.work.find(w => w.id === 'demo-energy')).tag_scores[0].value).toBe(4);
    expect(page.T.returnedGrade(cls.work.find(w => w.id === 'demo-fair'))).toBeNull();
  });

  it.each(HASHES)('%s: no draft level, no draft comment, and no word "draft"', async hash => {
    const page = await walk(hash);
    const format = v => page.run('formatLevel(' + JSON.stringify(CID) + ', ' + v + ')');
    const html = page.root().innerHTML;
    const reply = JSON.stringify(page.T.demoPage(page.T.state().page.course.gradingSystem));
    const read = JSON.stringify(page.T.state().page);

    // What the drafts would read as, had they leaked: the never-returned
    // poster at Emerging (1), and the essay's waiting change to Proficient +.
    const leaks = [
      'Draft: two of your sources are missing.',
      'Draft: much clearer after your rewrite.',
      'sources are missing',
      'much clearer',
      format(1),
      format(10 / 3),
      'Emerging',
    ];
    expect(new Set(leaks.slice(4, 6)).size).toBe(2);
    leaks.forEach(text => {
      expect(html, text).not.toContain(text);
    });
    expect(html).not.toMatch(/draft/i);
    // Nor in the reply the page was built from, nor in what the screens read.
    ['Draft', 'sources are missing', 'much clearer', 'is_draft', 'returned_copy', 'working'].forEach(text => {
      expect(reply, text).not.toContain(text);
      expect(read, text).not.toContain(text);
    });
    const poster = JSON.parse(reply).assessments.find(a => a.id === 'demo-poster');
    expect(poster.grade).toBeNull();
    expect(poster.returned_at).toBeNull();
    expect(page.T.state().page.grades['demo-poster']).toBeUndefined();
    const scores = page.run('getScores(' + JSON.stringify(CID) + ')')[SID];
    expect(scores.filter(s => s.assessmentId === 'demo-poster')).toEqual([]);
    // The essay's only score is the one that was returned.
    expect(scores.filter(s => s.assessmentId === 'demo-essay')).toEqual([
      { assessmentId: 'demo-essay', tagId: 'demo-com', score: 2, note: expect.any(String) },
    ]);
  });

  it('a draft’s row is a not-graded row: the title and the date, nothing else', async () => {
    const page = await walk();
    const drafted = row(page, 'Disease Research Poster');
    const ungraded = row(page, 'Science Fair Proposal');
    expect(drafted.sub).toMatch(/^Due \S+ \S+ \d+$/);
    expect(drafted.result).toBe('');
    expect(drafted.dot).toBe(ungraded.dot);
    const li = title => [...page.root().querySelectorAll('.sp-row')].find(el => el.textContent.includes(title));
    const shape = el =>
      el.outerHTML
        .replace(/>[^<]+</g, '><')
        .replace(/sp-row-title">.*?<\/span>/, 'sp-row-title"></span>')
        .replace(/data-piece="[^"]*"/g, 'data-piece=""');
    expect(shape(li('Disease Research Poster'))).toBe(shape(li('Science Fair Proposal')));
    // A returned grade with a newer draft over it keeps what was returned.
    const essay = row(page, 'Ecosystem Connections Essay');
    expect(essay.result).toBe('2.0');
    expect(essay.sub).toMatch(/· Developing$/);
  });
});

describe('student-data.js: the one adapter', () => {
  // Each grade below is written as the score tables' rows and reaches the
  // adapter as the copy the server sends (asServerSends; S0-W1).
  const REPLY = asServerSends({
    ok: true,
    v: 1,
    student: { enrollment_id: 'e1', first_name: 'Sam' },
    course: { id: 'c1', name: 'Socials 10', block: 'C', grading_system: 'both', grading_scale: null },
    rubrics: [],
    assessments: [
      {
        id: 'a1',
        title: 'Returned',
        date: '2026-10-20',
        due_date: '2026-10-22',
        score_mode: 'proficiency',
        tag_ids: ['t1'],
        returned_at: '2026-11-03T20:00:00Z',
        grade: { score: { value: null, comment: 'Good.' }, tag_scores: [{ tag_id: 't1', value: 3, modifier: 1 }] },
      },
      {
        // A grade the server should never send: no return date.
        id: 'a2',
        title: 'Sent By Mistake',
        date: '2026-10-21',
        score_mode: 'proficiency',
        tag_ids: ['t1'],
        returned_at: null,
        grade: { score: { value: null, comment: 'SECRET NOTE' }, tag_scores: [{ tag_id: 't1', value: 1 }] },
        draft: { tag_scores: [{ tag_id: 't1', value: 1 }], comment: 'SECRET NOTE' },
        is_draft: true,
      },
      { id: 'a3', title: 'Excused Work', date: '2026-10-23', due_date: '2026-10-24', status: 'EXC', tag_ids: ['t1'] },
      { id: 'a4', title: 'Reading Benchmark', date: '2026-10-01', score_mode: 'dibels' },
      {
        id: 'a5',
        title: 'Unlinked',
        date: '2026-10-02',
        tag_ids: [],
        returned_at: '2026-10-05T20:00:00Z',
        grade: { score: { value: 2, comment: '' }, tag_scores: [] },
      },
      {
        id: 'a6',
        title: 'Zero Points',
        date: '2026-10-03',
        score_mode: 'points',
        max_points: 5,
        returned_at: '2026-10-06T20:00:00Z',
        grade: { score: { value: 0, comment: '' } },
      },
      {
        id: 'a7',
        title: 'Late And Waiting',
        date: '2026-10-04',
        due_date: '2026-10-05',
        status: 'LATE',
        tag_ids: ['t1'],
        returned_at: null,
        grade: null,
      },
    ],
  });

  it('keeps a grade only where it was returned, and copies named fields only', () => {
    const page = openStudentPage();
    const read = page.run('StudentData.fromServer')(REPLY);
    expect(read.student).toEqual({ id: 'e1', firstName: 'Sam' });
    expect(read.course).toEqual({
      id: 'c1',
      name: 'Socials 10',
      block: 'C',
      gradingSystem: 'both',
      gradingScale: null,
    });
    expect(read.assessments.map(a => a.id)).toEqual(['a1', 'a2', 'a3', 'a5', 'a6', 'a7']);
    expect(JSON.stringify(read)).not.toContain('SECRET NOTE');
    expect(JSON.stringify(read)).not.toMatch(/draft/i);
    expect(Object.keys(read.grades)).toEqual(['a1', 'a5', 'a6']);
    expect(read.grades.a1).toEqual({
      value: null,
      comment: 'Good.',
      tagScores: [{ id: 't1', value: 3, modifier: 1 }],
      rubricScores: [],
    });
  });

  it('the list reads each kind of piece from it', async () => {
    const page = openStudentPage();
    const read = page.run('StudentData.fromServer')(REPLY);
    page.run('StudentData.use')(read);
    page.T.whenGradesAreIn();
    await page.settle();
    const v = page.T.viewOf({ page: read, reply: REPLY });
    const view = id => page.T.rowView(v.work.find(p => p.id === id));
    expect(view('a1')).toMatchObject({ kind: 'back', result: '3.3 · 83%' });
    expect(view('a1').sub).toMatch(/^Back \S+ \d+ · Proficient$/);
    expect(view('a2')).toMatchObject({ kind: 'due', result: '' });
    expect(view('a3')).toMatchObject({ kind: 'excused', result: '' });
    expect(view('a3').sub).toMatch(/^Excused · Due \S+ \S+ \d+$/);
    expect(view('a5')).toMatchObject({ kind: 'back', result: '2.0 · 50%' });
    expect(view('a6')).toMatchObject({ kind: 'back', result: '0 / 5' });
    expect(view('a7')).toMatchObject({ kind: 'due', result: '' });
    expect(view('a7').sub).toMatch(/^Late · Due \S+ \S+ \d+$/);
    const none = Object.assign({}, REPLY, { assessments: [] });
    expect(
      page.T.render({
        screen: 'assignments',
        page: page.run('StudentData.fromServer')(none),
        reply: none,
        demo: false,
      }),
    ).toContain('No assignments yet.');
  });

  it('answers calc.js for this student and this class only', async () => {
    const page = openStudentPage();
    const read = page.run('StudentData.fromServer')(REPLY);
    page.run('StudentData.use')(read);
    page.T.whenGradesAreIn();
    await page.settle();
    expect(page.run('courseGradeMode("c1")')).toBe('both');
    expect(page.run('getScores("c1").e1.length')).toBe(3);
    expect(page.run('getScores("c1").e1[0]')).toEqual({
      assessmentId: 'a1',
      tagId: 't1',
      score: 3,
      note: 'Good.',
      mod: 1,
    });
    expect(page.run('JSON.stringify(getScores("other"))')).toBe('{}');
    expect(page.run('getAssignmentStatuses("c1")')).toEqual({ 'e1:a3': 'EXC', 'e1:a7': 'LATE' });
    expect(page.run('JSON.stringify(getAssignmentStatuses("other"))')).toBe('{}');
    expect(page.run('getRubricById("c1", "nope")')).toBeUndefined();
    expect(page.run('getGradingScale("c1") === DEFAULT_GRADING_SCALE')).toBe(true);
    // calc.js's own reader, fed by those: a status, a points score that is 0.
    expect(page.run('_scoreRead.status("c1", "e1", "a3")')).toBe('EXC');
    expect(page.run('_scoreRead.status("c1", "someone-else", "a3")')).toBeNull();
    expect(page.run('_scoreRead.pointsScore("c1", "e1", "a6")')).toBe(0);
    page.run('StudentData.use')(null);
    expect(page.run('JSON.stringify(getScores("c1"))')).toBe('{}');
    expect(page.run('JSON.stringify(getAssignmentStatuses("c1"))')).toBe('{}');
    expect(page.run('Object.keys(COURSES).length')).toBe(0);
  });

  it('reads the sample class for the sample student', async () => {
    const page = await walk();
    expect(page.T.state().page.student.id).toBe(SID);
    expect(page.run('Object.keys(COURSES)')).toEqual([CID]);
  });
});

/* calc.js is another agent's file and changes under this page (S0-T1 moved
   every score read behind one reader; S0-F1 adds a returned-only set). The
   teacher's apps would not notice a new read: shared/data.js defines
   everything. The student page has only s/student-data.js, so a read it
   lacks throws, or, behind a `typeof` guard, quietly changes a result. */
describe('calc.js on the student page reads only what student-data.js gives it', () => {
  // The files whose reads are watched: the math, its helpers, and the page's own.
  const WATCHED = [
    'shared/calc.js',
    'shared/constants.js',
    'shared/student-view.js',
    's/student-data.js',
    's/assignments.js',
    's/app.js',
  ];
  const at = '2026-11-03T20:00:00Z';
  const level = (tag_id, value, modifier) => ({ tag_id, value, modifier: modifier || 0, comment: null });
  // Every kind of piece the list can show, in a class of the given style.
  // Grades are written as rows and sent as the server's copies (asServerSends).
  const everyKind = (system, scale) => asServerSends(everyKindRows(system, scale));
  const everyKindRows = (system, scale) => ({
    ok: true,
    v: 1,
    student: { enrollment_id: 'e1', first_name: 'Sam' },
    course: { id: 'c1', name: 'Socials 10', block: 'C', grading_system: system, grading_scale: scale || null },
    rubrics: [
      {
        id: 'r1',
        criteria: [
          {
            id: 'k1',
            name: 'Evidence',
            weight: 2,
            level_1_value: 1,
            level_2_value: 2,
            level_3_value: 3,
            level_4_value: 4,
          },
          {
            id: 'k2',
            name: 'Voice',
            weight: 1,
            level_1_value: 2,
            level_2_value: 4,
            level_3_value: 6,
            level_4_value: 10,
          },
        ],
      },
    ],
    assessments: [
      {
        id: 'comp',
        title: 'Competency Work',
        date: '2026-10-01',
        tag_ids: ['t1', 't2'],
        returned_at: at,
        grade: { score: { value: null, comment: 'Good.' }, tag_scores: [level('t1', 3, 1), level('t2', 2, -1)] },
      },
      {
        id: 'unlinked',
        title: 'Unlinked Work',
        date: '2026-10-02',
        tag_ids: [],
        returned_at: at,
        grade: { score: { value: 4, comment: '' }, tag_scores: [] },
      },
      {
        id: 'rubric',
        title: 'Rubric Work',
        date: '2026-10-03',
        tag_ids: ['t1'],
        rubric_id: 'r1',
        returned_at: at,
        grade: {
          score: { value: null, comment: '' },
          rubric_scores: [
            { criterion_id: 'k1', value: 3, modifier: 0 },
            { criterion_id: 'k2', value: 2, modifier: 1 },
          ],
        },
      },
      {
        id: 'points',
        title: 'Points Work',
        date: '2026-10-04',
        score_mode: 'points',
        max_points: 20,
        weight: 2,
        tag_ids: ['t1'],
        returned_at: at,
        grade: { score: { value: 17.5, comment: '' } },
      },
      {
        id: 'done',
        title: 'Complete Work',
        date: '2026-10-05',
        score_mode: 'complete',
        returned_at: at,
        grade: { score: { value: 1, comment: '' } },
      },
      {
        id: 'notdone',
        title: 'Incomplete Work',
        date: '2026-10-06',
        score_mode: 'complete',
        returned_at: at,
        grade: { score: { value: 0, comment: '' } },
      },
      {
        id: 'missing',
        title: 'Missing Points',
        date: '2026-10-07',
        score_mode: 'points',
        max_points: 10,
        status: 'NS',
      },
      // Missing on work that was returned earlier: the status stands in for the result.
      {
        id: 'missing2',
        title: 'Missing Competency',
        date: '2026-10-08',
        tag_ids: ['t1'],
        status: 'NS',
        returned_at: at,
        grade: { score: { value: null, comment: '' }, tag_scores: [level('t1', 2)] },
      },
      {
        id: 'excused',
        title: 'Excused Work',
        date: '2026-10-09',
        due_date: '2026-10-10',
        tag_ids: ['t1'],
        status: 'EXC',
      },
      {
        id: 'excused2',
        title: 'Excused Rubric',
        date: '2026-10-11',
        rubric_id: 'r1',
        status: 'EXC',
        returned_at: at,
        grade: { score: { value: null, comment: '' }, rubric_scores: [{ criterion_id: 'k1', value: 4 }] },
      },
      {
        id: 'late',
        title: 'Late Work',
        date: '2026-10-12',
        tag_ids: ['t2'],
        status: 'LATE',
        returned_at: at,
        grade: { score: { value: null, comment: '' }, tag_scores: [level('t2', 3)] },
      },
      {
        id: 'late2',
        title: 'Late And Waiting',
        date: '2026-10-13',
        due_date: '2026-10-14',
        tag_ids: ['t1'],
        status: 'LATE',
      },
      {
        id: 'latepts',
        title: 'Late Points',
        date: '2026-10-15',
        score_mode: 'points',
        max_points: 5,
        status: 'LATE',
        returned_at: at,
        grade: { score: { value: 0, comment: '' } },
      },
      {
        id: 'noted',
        title: 'Comment Only',
        date: '2026-10-16',
        tag_ids: ['t1'],
        returned_at: at,
        grade: { score: { value: null, comment: 'See me.' }, tag_scores: [] },
      },
      { id: 'todo', title: 'Not Graded', date: '2026-10-17', due_date: '2026-10-20', tag_ids: ['t1'] },
    ],
  });
  const OWN_SCALE = {
    boundaries: [
      { min: 90, proficiency: 4 },
      { min: 70, proficiency: 3 },
      { min: 50, proficiency: 2 },
      { min: 0, proficiency: 1 },
    ],
    percents: { 4: 95, 3: 80, 2: 60, 1: 40 },
  };

  async function watched() {
    const page = openStudentPage();
    page.T.whenGradesAreIn();
    await page.settle();
    const reached = page.watchGlobals(WATCHED);
    const used = page.spyGlobals(page.run('StudentData.readers'));
    const list = reply => {
      const read = page.run('StudentData.fromServer')(reply);
      page.run('StudentData.use')(read);
      const html = page.T.render({ screen: 'assignments', page: read, reply, all: true, demo: false });
      const v = page.T.viewOf({ page: read, reply });
      return Object.fromEntries(v.work.map(p => [p.id, page.T.rowView(p)]).concat([['html', html]]));
    };
    return { page, reached, used, list };
  }

  it('the watch sees a read of a name the page lacks, guarded or not', async () => {
    const { page, reached } = await watched();
    expect(page.run('typeof getStudents === "function" ? 1 : 0')).toBe(0);
    expect(() => page.run('getAssessments("c1")')).toThrow();
    expect([...reached].sort()).toEqual(['getAssessments', 'getStudents']);
  });

  it.each(['proficiency', 'letter', 'both'])(
    'a %s class: every kind of piece is listed with no read the page lacks and no reader unused',
    async system => {
      const { page, reached, used, list } = await watched();
      const demo = list(page.T.demoPage(system));
      const own = list(everyKind(system, OWN_SCALE));
      // Last, so the class in use below is the one on the default scale.
      const kinds = list(everyKind(system));

      // One name is reached and not given, on purpose: constants.js asks
      // (typeof getSectionForTag) whether the class's competency list is
      // here, to leave out a competency removed from the class. The page
      // carries no competency list; `tag_ids` arrives holding only the
      // competencies still on the class. Anything else here is a reader
      // s/student-data.js must add (getReturnedScores, when S0-F1 lands).
      expect([...reached]).toEqual(['getSectionForTag']);
      // And student-data.js defines nothing that nothing reads.
      expect(page.run('StudentData.readers')).toEqual([
        'getScores',
        'getAssignmentStatuses',
        'getRubricById',
        'getGradingScale',
      ]);
      expect([...used].sort()).toEqual([...page.run('StudentData.readers')].sort());

      // The list really did work each kind out.
      expect(demo.html).toContain('Energy Transfer Investigation');
      expect(kinds.comp.result).toBe(page.run('formatLevel("c1", ' + (10 / 3 + 5 / 3) / 2 + ')'));
      expect(kinds.unlinked.result).toBe(page.run('formatLevel("c1", 4)'));
      expect(kinds.rubric.kind).toBe('back');
      expect(kinds.rubric.result).not.toBe('');
      expect(kinds.points.result).toBe('17.5 / 20');
      expect(kinds.done.result).toBe('Complete');
      expect(kinds.notdone.result).toBe('Incomplete');
      expect(kinds.missing).toMatchObject({ kind: 'missing', result: '' });
      expect(kinds.missing2).toMatchObject({ kind: 'missing', result: '' });
      expect(kinds.excused).toMatchObject({ kind: 'excused', result: '' });
      expect(kinds.excused2).toMatchObject({ kind: 'excused', result: '' });
      expect(kinds.late.result).toBe(page.run('formatLevel("c1", 3)'));
      expect(kinds.late.sub).toMatch(/ · Late$/);
      expect(kinds.late2).toMatchObject({ kind: 'due', result: '' });
      expect(kinds.late2.sub).toMatch(/^Late · Due /);
      expect(kinds.latepts.result).toBe('0 / 5');
      expect(kinds.noted).toMatchObject({ kind: 'back', result: '' });
      expect(kinds.todo).toMatchObject({ kind: 'due', result: '' });
      // The class's own Counts As percents reach calc.js through getGradingScale.
      if (system !== 'proficiency') {
        expect(own.unlinked.result).toContain('95%');
        expect(kinds.unlinked.result).toContain('100%');
      }
    },
  );
});

describe('student card: slips still open as before', () => {
  const OPEN = {
    ok: true,
    token: 'a'.repeat(64),
    student: { first_name: 'Cece' },
    course: { name: 'Science 8', block: 'B' },
    parts: [
      {
        id: 'p1',
        kind: 'core_reflection',
        title: 'November Reflection',
        questions: [{ id: 'q1', kind: 'text', prompt: 'How did it go?', options: {}, core_ids: [] }],
      },
    ],
    context: {},
  };

  it('a slip code goes to open and asks if it is them, as it did', async () => {
    const page = openStudentPage();
    page.replies.push(OPEN);
    await page.start('#k7m-4qx');
    expect(page.calls).toHaveLength(1);
    expect(page.calls[0].body).toEqual({ route: 'open', code: 'K7M4QX' });
    expect(page.root().querySelector('.sp-big').textContent).toBe('Hi Cece!');
    expect(page.root().querySelector('.sp-head-sub').textContent).toBe('Student Questions');
    expect(page.root().querySelector('[data-act="start"]').textContent).toBe('Yes, Start');
  });

  it('the page with no code is still the slip screen', async () => {
    const page = openStudentPage();
    await page.start('');
    expect(page.root().querySelector('.sp-big').textContent).toBe('Answer Your Teacher’s Questions');
    expect(page.root().querySelector('form[data-form="code"] label').textContent).toBe('Type the code on your slip');
    expect(page.root().textContent).not.toContain('card');
  });

  it('a card’s code typed today gets what an unknown code gets: one open, then "didn’t work"', async () => {
    const page = openStudentPage();
    await page.start('');
    page.replies.push({ ok: false, error: 'not_found' });
    page.type('#sp-code', 'P3R-8WD');
    await page.submit('form[data-form="code"]');
    expect(page.calls.map(c => c.body)).toEqual([{ route: 'open', code: 'P3R8WD' }]);
    expect(page.root().textContent).toContain(
      "That code didn't work. Check the letters and numbers on your slip. If you have a newer slip, use that one. If not, ask your teacher for a new slip.",
    );
    expect(page.root().querySelector('[data-act="card-yes"]')).toBeNull();
    expect(page.T.state().page).toBeNull();
  });

  it('a slip’s identity check keeps the slip’s words', async () => {
    const page = openStudentPage();
    page.replies.push(
      Object.assign({}, OPEN, { parts: undefined, preview: [{ title: 'Q', count: 1 }], check: 'password' }),
    );
    await page.start('#k7m-4qx');
    expect(page.root().textContent).toContain('type the password printed on your slip.');
    page.replies.push({ ok: false, error: 'wrong_identity', tries_left: 1 });
    page.type('#sp-ident', '1111');
    await page.click('[data-act="start"]');
    expect(page.root().querySelector('.sp-msg').textContent).toBe(
      "That password doesn't match. Check the password on your slip. 1 try left. One more wrong try locks this slip, and you will need a new one from your teacher.",
    );
    expect(page.calls[1].body).toMatchObject({ route: 'verify', password: '1111' });
  });
});
