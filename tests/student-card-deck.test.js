/**
 * The Assignments tab (Colin, 2026-11-14): Outstanding and Upcoming, each
 * piece a card, one under another on a phone and the list on the left on a
 * Chromebook, drawn by s/page-view.js from shared/student-view.js's view.
 * Outstanding is work due by the class's today (or with no due date), work
 * marked Missing and work returned for revision; Upcoming is work due
 * after today. Work sent or returned is on My Learning.
 *
 * The page runs as a browser loads it (tests/helpers/student-page-context.js),
 * in Demo Mode and against the student-submit function's real handler over a
 * stand-in database. No test waits on real time.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { WORK, fakeStudentSubmit, sampleCard } from './helpers/fake-student-submit.js';

const TODAY = new Date().toISOString().slice(0, 10);

const cards = page => [...page.root().querySelectorAll('.sp-deck .sp-piece')];
const titles = page => cards(page).map(c => c.querySelector('.sp-piece-title').textContent);
const card = (page, title) => cards(page).find(c => c.querySelector('.sp-piece-title').textContent === title);
const tags = c => [...c.querySelectorAll('.sp-flag')].map(t => t.textContent);
const segments = page => [...page.root().querySelectorAll('.sp-segment')].map(b => b.textContent);

async function demo(hash) {
  const page = openStudentPage();
  await page.start(hash || '#demo-card');
  await page.submit('form[data-form="card"]');
  page.type('#sp-ident', page.T.DEMO.number);
  await page.click('[data-act="card-yes"]');
  // The sample class has bulletins, so the page opens on Bulletins (B1g); these tests start on Assignments.
  await page.click('.sp-tabs-bottom [data-tab="assignments"]');
  return page;
}

async function real() {
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)] });
  const page = openStudentPage();
  page.server = body => fn.handle(body);
  await page.start('#P3R8-WDK4');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  return { page, fn };
}

const viewOf = page => page.T.viewOf(page.T.state());
const piece = (page, title) => viewOf(page).work.find(p => p.title === title);

// How far a day is from the view's today, in days, and the day as a due pill names it.
const daysOff = (day, today) => Math.round((Date.parse(day + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 864e5);
const shortDay = day => new Date(day + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
const dueDay = day =>
  new Date(day + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

// A view of the page's own shape, with the class's today fixed, for drawing one case.
const TODAY_FIXED = '2026-11-14';
const viewWith = work => ({
  course: { name: 'Science 8', block: 'B', gradingSystem: 'proficiency' },
  today: TODAY_FIXED,
  work,
  changes: [],
  levels: [],
  questionnaires: [],
  learning: null,
});
const due = (id, dueDate, more) => Object.assign({ id, title: 'Piece ' + id, kind: 'due', dueDate, date: '' }, more);

// Draws a view with a choice into an element of the page's own document.
function drawIn(page, view, ui) {
  const box = page.root().ownerDocument.createElement('div');
  box.innerHTML = page.run('StudentPageView.html')(view, ui || {});
  return box;
}
const button = attrs => ({ getAttribute: name => (attrs && attrs[name]) || null, closest: () => null });

describe('Outstanding: work due by today, Missing, and revisions', () => {
  it('the two segments with their counts; Outstanding first, the oldest due first; Missing says so', async () => {
    const page = await demo();
    expect(segments(page)).toEqual(['Outstanding 2', 'Upcoming 1']);
    expect(page.root().querySelector('.sp-segment-on').getAttribute('data-segment')).toBe('outstanding');
    // The Quick Check was due five days ago and is Missing; the Poster was due two days ago.
    expect(titles(page)).toEqual(['Immune System Quick Check', 'Disease Research Poster']);
    expect(tags(card(page, 'Immune System Quick Check'))).toContain('Missing');
    // Work still to do shows no result and no comment.
    cards(page).forEach(c => {
      expect(c.querySelector('.sp-piece-rows')).toBeNull();
      expect(c.querySelector('.sp-piece-comment')).toBeNull();
      expect(c.querySelector('[data-act="feedback"]')).toBeNull();
    });
  });

  it('past its day and not Missing, the band says Not Assessed Yet in grey, never red', async () => {
    const page = await demo();
    const view = viewOf(page);
    const poster = piece(page, 'Disease Research Poster');
    expect(-daysOff(poster.dueDate, view.today)).toBeGreaterThan(0);
    const c = card(page, 'Disease Research Poster');
    const band = c.querySelector('.sp-piece-card > .sp-band');
    expect(band.classList.contains('sp-band-waiting')).toBe(true);
    expect(band.querySelector('.sp-flag').textContent).toBe('Not Assessed Yet');
    expect(band.querySelector('svg')).not.toBeNull();
    expect(band.querySelector('.sp-band-when').textContent).toBe('Was due ' + shortDay(poster.dueDate));
    expect(c.innerHTML).not.toMatch(/days ago|yesterday/);
  });

  it('Missing is the one solid band, with no countdown in it', async () => {
    const page = await demo();
    const c = card(page, 'Immune System Quick Check');
    const band = c.querySelector('.sp-piece-card > .sp-band');
    expect(band.classList.contains('sp-band-missing')).toBe(true);
    expect(band.querySelector('.sp-flag').textContent).toBe('Missing');
    expect(c.querySelector('.sp-band-due, .sp-band-later, .sp-band-waiting')).toBeNull();
  });

  it('a draft’s card is a not-graded card: no level, no comment, nothing that says a draft exists', async () => {
    const page = await demo();
    const shape = el =>
      el.outerHTML
        .replace(/>[^<]+</g, '><')
        .replace(/(data-piece|aria-labelledby|id)="[^"]*"/g, '$1=""')
        .replace(' sp-picked', '')
        .replace(/sp-(flag|band)-(waiting|later)/g, 'sp-$1-due')
        // Each status draws its own icon; the shape is the same.
        .replace(/<(path|rect|circle) [^>]*\/>/g, '')
        // The poster and the proposal carry the teacher's handouts (their pages, to swipe through); that is not a grade.
        .replace(/<section [^>]*class="sp-(res|car)"[\s\S]*?<\/section>/, '');
    const draft = shape(card(page, 'Disease Research Poster'));
    expect(page.root().innerHTML).not.toContain('two of your sources');
    await page.click('[data-segment="upcoming"]');
    expect(draft).toBe(shape(card(page, 'Science Fair Proposal')));
  });

  it('the cards sit one under another, with no count of them; the first is the one picked', async () => {
    const page = await demo();
    expect(page.root().querySelector('.sp-deck-count')).toBeNull();
    expect(page.root().querySelectorAll('.sp-deck > .sp-piece')).toHaveLength(2);
    expect(page.root().querySelector('.sp-piece.sp-picked .sp-piece-title').textContent).toBe(
      'Immune System Quick Check',
    );
  });

  it('work sent, returned or excused is not on Assignments', async () => {
    const page = await demo();
    const view = viewOf(page);
    expect(view.work.filter(p => p.kind === 'back')).toHaveLength(6);
    const shown = [...cards(page)];
    await page.click('[data-segment="upcoming"]');
    shown.push(...cards(page));
    const kinds = shown.map(c => view.work.find(p => p.id === c.getAttribute('data-piece')).kind);
    expect(kinds.sort()).toEqual(['due', 'due', 'missing']);
  });
});

describe('Upcoming: work due after today, soonest first', () => {
  it('the Science Fair Proposal, how many days off and its date in a blue band', async () => {
    const page = await demo();
    await page.click('[data-segment="upcoming"]');
    expect(page.root().querySelector('.sp-segment-on').textContent).toBe('Upcoming 1');
    expect(titles(page)).toEqual(['Science Fair Proposal']);
    const fair = piece(page, 'Science Fair Proposal');
    const n = daysOff(fair.dueDate, viewOf(page).today);
    const band = card(page, 'Science Fair Proposal').querySelector('.sp-band');
    expect(band.classList.contains('sp-band-later')).toBe(true);
    expect(band.querySelector('.sp-flag').textContent).toBe('In ' + n + ' Days');
    expect(band.querySelector('.sp-band-when').textContent).toBe(dueDay(fair.dueDate));
  });
});

describe('which segment and in what order, by the class’s today', () => {
  // Stored newest first, as the view keeps them.
  const WORKS = [
    due('later', '2026-11-30'),
    due('tomorrow', '2026-11-15'),
    due('today', '2026-11-14'),
    due('dated', '', { date: '2026-11-11' }),
    due('late', '2026-11-10'),
    due('undated', ''),
    {
      id: 'revise',
      title: 'Revise',
      kind: 'revise',
      dueDate: '2026-11-12',
      revision: { reviseBy: '2026-11-20', whatToFix: 'Add a label.', criteria: [], firstThumbs: [] },
    },
    { id: 'missing', title: 'Missing', kind: 'missing', dueDate: '2026-11-01' },
    { id: 'sent', title: 'Sent', kind: 'sent', dueDate: '2026-11-13' },
    { id: 'back', title: 'Back', kind: 'back', dueDate: '2026-11-02', result: { kind: 'none', text: '' } },
    { id: 'excused', title: 'Excused', kind: 'excused', dueDate: '2026-11-03' },
  ];

  it('due today is Outstanding, tomorrow Upcoming; no due date is Outstanding; a revision first', async () => {
    const page = await demo();
    const view = viewWith(WORKS);
    const ids = seg =>
      page
        .run('StudentPageView.inSegment')(view, seg)
        .map(p => p.id);
    // A revision, then the oldest due date first; a piece with no due date by its date; nothing dated last.
    expect(ids('outstanding')).toEqual(['revise', 'missing', 'late', 'dated', 'today', 'undated']);
    expect(ids('upcoming')).toEqual(['tomorrow', 'later']);
    expect({ ...page.run('StudentPageView.counts')(view) }).toEqual({ outstanding: 6, upcoming: 2 });
    const segmentOf = page.run('StudentPageView.segmentOf');
    expect(
      ['sent', 'back', 'excused'].map(id =>
        segmentOf(
          WORKS.find(p => p.id === id),
          view,
        ),
      ),
    ).toEqual(['', '', '']);
    // The tab draws the same split.
    expect([...drawIn(page, view, {}).querySelectorAll('.sp-segment')].map(b => b.textContent)).toEqual([
      'Outstanding 6',
      'Upcoming 2',
    ]);
  });
});

describe('the status band (Colin, 2026-11-17)', () => {
  it('In N Days, Due Tomorrow, Due Today, then Not Assessed Yet once the day has passed; Missing is its own', async () => {
    const page = await demo();
    const view = viewWith([
      due('d0', '2026-11-14'),
      due('d1', '2026-11-15'),
      due('d4', '2026-11-18'),
      due('p1', '2026-11-13'),
      due('p2', '2026-11-12'),
      { id: 'm', title: 'Piece m', kind: 'missing', dueDate: '2026-11-01' },
    ]);
    const pill = (ui, id) => {
      const box = drawIn(page, view, ui);
      const band = box.querySelector('.sp-piece[data-piece="' + id + '"] .sp-band');
      return [
        band.className.replace(/^sp-band /, ''),
        band.querySelector('.sp-flag').textContent,
        band.querySelector('.sp-band-when').textContent,
      ];
    };
    const up = { segment: 'upcoming' };
    expect(pill({}, 'd0')).toEqual(['sp-band-due', 'Due Today', 'Sat, Nov 14']);
    expect(pill(up, 'd1')).toEqual(['sp-band-due', 'Due Tomorrow', 'Sun, Nov 15']);
    expect(pill(up, 'd4')).toEqual(['sp-band-later', 'In 4 Days', 'Wed, Nov 18']);
    expect(pill({}, 'p1')).toEqual(['sp-band-waiting', 'Not Assessed Yet', 'Was due Nov 13']);
    expect(pill({}, 'p2')).toEqual(['sp-band-waiting', 'Not Assessed Yet', 'Was due Nov 12']);
    expect(pill({}, 'm')).toEqual(['sp-band-missing', 'Missing', 'Was due Nov 1']);
  });

  it('Missing says only Missing and its date, in every grading style: no "counts as 0" on the card', async () => {
    const page = await demo();
    const work = [{ id: 'm', title: 'Piece m', kind: 'missing', dueDate: '2027-01-31' }];
    const band = system => {
      const view = viewWith(work);
      view.course = Object.assign({}, view.course, { gradingSystem: system });
      return drawIn(page, view, {}).querySelector('.sp-piece[data-piece="m"] .sp-band').textContent;
    };
    // A Missing piece due later (342 such live, Nov 17) shows no countdown.
    ['letter', 'both', 'proficiency'].forEach(system => expect(band(system)).toBe('MissingDue Jan 31'));
  });

  it('a teacher’s Late is its own pale red pill with its own icon', async () => {
    const page = await demo();
    const box = drawIn(page, viewWith([due('l', '2026-11-12', { late: true })]), {});
    const late = box.querySelector('.sp-piece[data-piece="l"] .sp-flag-late');
    expect(late.textContent).toBe('Late');
    expect(late.querySelector('svg')).not.toBeNull();
  });
});

describe('All caught up', () => {
  it('nothing outstanding: All caught up, and See What’s Coming Up only while something is', async () => {
    const page = await demo();
    const view = viewWith([due('d4', '2026-11-18')]);
    const box = drawIn(page, view, {});
    expect(box.querySelector('.sp-caught-up-words').textContent).toBe('All caught up');
    const go = box.querySelector('.sp-caught-up [data-act="segment"]');
    expect([go.textContent, go.getAttribute('data-segment')]).toEqual(['See What’s Coming Up', 'upcoming']);
    expect(
      page.run('StudentPageView.press')({}, view, 'segment', button({ 'data-segment': 'upcoming' })).ui,
    ).toMatchObject({ tab: 'assignments', segment: 'upcoming' });
    // With nothing coming either: All caught up alone; Upcoming says nothing is coming.
    const none = viewWith([]);
    const empty = drawIn(page, none, {});
    expect(empty.querySelector('.sp-caught-up-words').textContent).toBe('All caught up');
    expect(empty.querySelector('.sp-caught-up [data-act="segment"]')).toBeNull();
    expect(drawIn(page, none, { segment: 'upcoming' }).querySelector('.sp-empty').textContent).toBe(
      'Nothing coming up yet.',
    );
    expect(drawIn(page, none, {}).textContent).not.toContain('No assignments yet');
  });
});

describe('a returned piece not yet opened, on My Learning', () => {
  it('its row is watched for "opened", and told to the server once', async () => {
    const { page } = await real();
    await page.click('.sp-tabs-bottom [data-tab="learning"]');
    const unseen = [...page.root().querySelectorAll('.sp-ml-work li[data-unseen]')].map(li =>
      li.getAttribute('data-unseen'),
    );
    expect(unseen).toEqual([WORK.energy, WORK.quiz, WORK.lab, WORK.essay, WORK.kmt, WORK.contract]);
    // Only the row on screen counts.
    page.onScreen(el => el.getAttribute('data-unseen') === WORK.energy);
    page.advance(700);
    await page.T.tellSeen();
    await page.settle();
    expect(page.calls.filter(c => c.body.route === 'seen').map(c => c.body.assessment_ids)).toEqual([[WORK.energy]]);
  });
});

describe('on a Chromebook: the list on the left, the card picked on the right', () => {
  it('pressing a piece in the list picks its card; the list says which is picked', async () => {
    const page = await demo();
    const side = () => [...page.root().querySelectorAll('.sp-side-row')];
    expect(side().map(b => [b.querySelector('.sp-side-title').textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['Immune System Quick Check', 'true'],
      ['Disease Research Poster', 'false'],
    ]);
    const poster = piece(page, 'Disease Research Poster');
    expect(side()[1].getAttribute('data-act')).toBe('pick');
    await page.click('.sp-side-row[data-piece="' + poster.id + '"]');
    expect(page.root().querySelector('.sp-piece.sp-picked .sp-piece-title').textContent).toBe(
      'Disease Research Poster',
    );
    expect(page.root().querySelector('.sp-side-row[aria-pressed="true"]').textContent).toContain(
      'Disease Research Poster',
    );
    expect(page.calls).toEqual([]);
  });
});

describe('what a press changes is decided in one place, for the page and the preview', () => {
  const press = (page, ui, act, attrs) => page.run('StudentPageView.press')(ui, viewOf(page), act, button(attrs));

  it('an id that is no piece, an Excused piece, a removed press, or one that is not the page’s own changes nothing', async () => {
    const page = await demo();
    expect(press(page, {}, 'open-piece', { 'data-piece': 'nope' })).toBeNull();
    // All Assignments and its filters are gone.
    expect(press(page, {}, 'all-open')).toBeNull();
    expect(press(page, {}, 'filter', { 'data-filter': 'todo' })).toBeNull();
    expect(press(page, {}, 'segment', { 'data-segment': 'back' })).toBeNull();
    expect(press(page, {}, 'card-done')).toBeNull();
    expect(press(page, {}, 'classes-open')).toBeNull();
    // Switch Class and Add Another Card reach for the session: the student page's own, not a press.
    expect(press(page, { settings: true }, 'class-open', { 'data-enrollment': 'e1' })).toBeNull();
    expect(press(page, { settings: true }, 'card-add')).toBeNull();
    // A text size only from Settings, and only one of the three.
    expect(press(page, {}, 'text-size', { 'data-size': 'large' })).toBeNull();
    expect(press(page, { settings: true }, 'text-size', { 'data-size': 'huge' })).toBeNull();
    // Settings opens over what is showing (a piece's feedback stays), slides in once, and its
    // closes, Log Out?'s Cancel included, give the focus back to the gear without scrolling.
    const opened = press(page, { tab: 'learning', feedback: 'p1', whole: true }, 'settings-open');
    expect(opened).toMatchObject({ focus: '#sp-set-title', stay: true, slide: true });
    expect(opened.ui).toMatchObject({ settings: true, feedback: 'p1', whole: true });
    expect(press(page, { settings: true }, 'settings-close')).toMatchObject({
      ui: { settings: false },
      focus: '.sp-gear',
      stay: true,
    });
    const sized = press(page, { settings: true }, 'text-size', { 'data-size': 'larger' });
    expect(sized).toMatchObject({ ui: { settings: true, textSize: 'larger' }, stay: true });
    expect(sized.slide).toBeUndefined();
    expect(
      press(page, { settings: true, textSize: 'larger' }, 'text-size', { 'data-size': 'normal' }).ui.textSize,
    ).toBe('');
    expect(press(page, { settings: true }, 'logout-ask')).toMatchObject({
      ui: { settings: false, logout: true },
      focus: '#sp-logout-title',
    });
    expect(press(page, { logout: true }, 'logout-cancel')).toMatchObject({ ui: { logout: false }, focus: '.sp-gear' });
    // Any other press closes Settings.
    expect(press(page, { settings: true }, 'tab', { 'data-tab': 'learning' }).ui.settings).toBe(false);
    const excused = { kind: 'excused', id: 'x', title: 'Excused Piece' };
    expect(
      page.run('StudentPageView.press')({}, { work: [excused] }, 'open-piece', button({ 'data-piece': 'x' })),
    ).toBeNull();
  });

  it('opening a piece picks it in its own segment; a returned one opens its feedback on My Learning', async () => {
    const page = await demo();
    const fair = piece(page, 'Science Fair Proposal');
    const quick = piece(page, 'Immune System Quick Check');
    const quiz = piece(page, 'Cell Structure Quiz');
    expect(press(page, { tab: 'learning' }, 'open-piece', { 'data-piece': fair.id }).ui).toMatchObject({
      tab: 'assignments',
      segment: 'upcoming',
      pick: fair.id,
    });
    expect(
      press(page, { tab: 'learning', segment: 'upcoming' }, 'open-piece', { 'data-piece': quick.id }).ui,
    ).toMatchObject({
      tab: 'assignments',
      segment: 'outstanding',
      pick: quick.id,
    });
    // A returned piece has no card to open; its row opens Your Feedback.
    expect(press(page, {}, 'open-piece', { 'data-piece': quiz.id })).toBeNull();
    expect(press(page, {}, 'feedback', { 'data-piece': quiz.id }).ui).toMatchObject({
      tab: 'learning',
      feedback: quiz.id,
    });
  });
});

/* S4-W1: what the server also sends about each piece and class, in Demo
   Mode's sample (which sends it as the database does since S4-M1). */
describe('what the server also tells, in Demo Mode (S4-W1)', () => {
  it('a card still to do: its band, its unit in plain grey, the title and the Description; nothing more about grading', async () => {
    const page = await demo();
    await page.click('[data-segment="upcoming"]');
    const fair = card(page, 'Science Fair Proposal');
    const text = sel => [...fair.querySelectorAll(sel)].map(el => el.textContent);
    expect(text('.sp-piece-unit')).toEqual(['Unit 2: Body Systems']);
    expect(text('.sp-piece-about')).toEqual([
      'Choose a question you can test. Write your question, what you predict, and the steps you will follow.',
    ]);
    expect(fair.querySelector('.sp-band + .sp-piece-unit')).not.toBeNull();
    expect(fair.querySelector('.sp-piece-head').textContent).toBe('Unit 2: Body Systems');
    expect(fair.querySelector('.sp-band-when').textContent).toMatch(/^\w{3}, \w{3} \d+$/);
    // No category, What You’re Graded On, I Can lines or Core Competencies (Colin, 2026-11-14), though the sample sends them.
    ['.sp-piece-category', '.sp-category-pill', '.sp-graded-on', '.sp-graded-on-ican', '.sp-core'].forEach(sel =>
      expect(fair.querySelector(sel), sel).toBeNull(),
    );
    ['Projects', 'Graded On', 'Questioning and Predicting', 'I can ', 'Creative Thinking'].forEach(w =>
      expect(fair.textContent).not.toContain(w),
    );
    expect(piece(page, 'Science Fair Proposal').coreCompetencies.map(c => c.name)).toEqual([
      'Creative Thinking',
      'Critical & Reflective Thinking',
    ]);
    // No rubric on it, so no See the Rubric.
    expect(fair.querySelector('.sp-rubric-link')).toBeNull();
  });

  it('a returned piece: no teacher’s name on My Learning or over its feedback, though the sample sends one (ruling 112)', async () => {
    const page = await demo();
    await page.click('.sp-tabs-bottom [data-tab="learning"]');
    expect(page.root().innerHTML).not.toContain('Rivera');
    const lab = piece(page, 'Cell Microscope Lab');
    await page.click('.sp-ml-row[data-piece="' + lab.id + '"]');
    expect(page.root().querySelector('.sp-fb-title').textContent).toBe('Cell Microscope Lab');
    expect(page.root().querySelector('.sp-fb-comment').textContent).toBe(lab.comment);
    expect(page.root().querySelector('.sp-piece-from, .sp-fb-from')).toBe(null);
    expect(page.root().innerHTML).not.toContain('Rivera');
  });

  it('Switch Class says how many pieces wait in each class; none where nothing waits or the server does not say', async () => {
    const page = await demo();
    await page.click('[data-act="settings-open"]');
    await page.click('.sp-set [data-act="card-add"]');
    page.type('#sp-code', 'ABCD-EFGH');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    await page.click('[data-act="settings-open"]');
    expect([...page.root().querySelectorAll('.sp-class-todo')].map(el => el.textContent)).toEqual([
      '3 to do',
      '2 to do',
    ]);
    const html = page.run('StudentPageView.html')(viewOf(page), {
      settings: true,
      classOn: 'e1',
      classes: [
        { enrollmentId: 'e1', name: 'Science 8', block: 'B', toDo: 0 },
        { enrollmentId: 'e2', name: 'Humanities 8', block: 'A', toDo: null },
        { enrollmentId: 'e3', name: 'Socials 8', block: 'C', toDo: 1 },
      ],
    });
    expect(html.match(/sp-class-todo">[^<]*/g)).toEqual(['sp-class-todo">1 to do']);
  });
});
