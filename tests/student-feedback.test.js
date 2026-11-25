/**
 * Your Feedback and The Whole Rubric (S4-F3; the artboard's "Your Feedback"
 * boards for a Rubric, an Advanced Rubric, a Single-Point Rubric and Points,
 * "The Whole Rubric" and "Your Feedback on a Chromebook"), drawn by
 * s/page-view.js from shared/student-view.js's view.
 *
 * Every level, letter, percent and word on these screens is the view's,
 * which calc.js and constants.js gave it; the tests read them back from the
 * view. A grade never returned has no feedback at all. The page runs as a
 * browser loads it (tests/helpers/student-page-context.js), in Demo Mode and
 * against the student-submit function's real handler over a stand-in
 * database. No test waits on real time.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import {
  CRITERIA,
  RUBRIC,
  TAGS,
  WORK,
  fakeStudentSubmit,
  sampleCard,
  samplePage,
} from './helpers/fake-student-submit.js';

const TODAY = new Date().toLocaleDateString('en-CA');

const q = (page, sel) => page.root().querySelector(sel);
const qa = (page, sel) => [...page.root().querySelectorAll(sel)];
const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

async function demo() {
  const page = openStudentPage();
  await page.start('#demo-card');
  await page.submit('form[data-form="card"]');
  page.type('#sp-ident', page.T.DEMO.number);
  await page.click('[data-act="card-yes"]');
  return page;
}

async function real(reply) {
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY, reply ? { page: reply } : undefined)] });
  const page = openStudentPage();
  page.server = body => fn.handle(body);
  await page.start('#P3R8-WDK4');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  return { page, fn };
}

const viewOf = page => page.T.viewOf(page.T.state());
const piece = (page, title) => viewOf(page).work.find(p => p.title === title);

// Opens Your Feedback from the piece's row in My Learning's Your Work.
async function openFeedback(page, title) {
  await page.click('[data-tab="learning"]');
  const p = piece(page, title);
  await page.click('.sp-ml-row[data-act="feedback"][data-piece="' + p.id + '"]');
  return p;
}
const critWords = page =>
  qa(page, '.sp-fb-criterion').map(c => [
    words(c.querySelector('.sp-fb-crit-name')),
    words(c.querySelector('.sp-level')),
    words(c.querySelector('.sp-fb-note')),
  ]);

const crit = (page, name) =>
  qa(page, '.sp-fb-criterion').find(c => words(c.querySelector('.sp-fb-crit-name')) === name);
const parts = c =>
  [...c.querySelectorAll('.sp-fb-part')].map(el => [
    words(el.querySelector('.sp-fb-part-title')),
    [...el.querySelectorAll('.sp-fb-words, .sp-fb-check > span')].map(words),
  ]);

/* A class's page with one piece of each kind the boards draw, returned. */
const LEVEL_WORDS = [
  'Names one group.',
  'Names two groups.',
  'Explains each group’s reason.',
  'Links the groups to unity.',
];
const ADV = '77777777-7777-4777-8777-000000000101';
const SPR = '77777777-7777-4777-8777-000000000102';
const ADV_C = '77777777-7777-4777-8777-000000000103';
const SPR_C1 = '77777777-7777-4777-8777-000000000104';
const SPR_C2 = '77777777-7777-4777-8777-000000000105';
const K = n => '77777777-7777-4777-8777-0000000002' + String(n).padStart(2, '0');
const A_ADV = '77777777-7777-4777-8777-000000000111';
const A_SPR = '77777777-7777-4777-8777-000000000112';
const A_TODO = '77777777-7777-4777-8777-000000000113';
function criterion(id, name, wordsFor, checks) {
  const c = { id, name, weight: 1, checks: checks || [] };
  [1, 2, 3, 4].forEach(l => {
    c['level_' + l + '_value'] = l;
    c['level_' + l + '_descriptor'] = wordsFor ? wordsFor[l - 1] : null;
  });
  return c;
}
const copy = part =>
  Object.assign({ v: 1, value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] }, part);
const at = days => {
  const t = new Date(TODAY + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};
function boardsPage(system) {
  const page = samplePage(TODAY, system);
  page.rubrics = page.rubrics.map(r =>
    r.id === RUBRIC
      ? Object.assign({}, r, {
          criteria: [
            criterion(CRITERIA.method, 'Method', LEVEL_WORDS),
            criterion(CRITERIA.drawing, 'Labelled Drawing', LEVEL_WORDS),
          ],
        })
      : r,
  );
  page.rubrics.push(
    {
      id: ADV,
      name: 'Inquiry',
      style: 'advanced',
      criteria: [
        criterion(ADV_C, 'Support and Opposition', null, [
          { id: K(1), level: 3, label: 'Explains Borden’s reason with a fact' },
          { id: K(2), level: 3, label: 'Gives each group’s own reason' },
          { id: K(3), level: 4, label: 'Links the groups to Canadian unity' },
        ]),
      ],
    },
    {
      id: SPR,
      name: 'Letter',
      style: 'single_point',
      criteria: [
        criterion(SPR_C1, 'Support and Opposition', ['', '', 'Gives each group’s own reason.', '']),
        criterion(SPR_C2, 'Letter to the Editor', ['', '', 'Gives three of his reasons.', '']),
      ],
    },
  );
  const row = (id, title, extra) =>
    Object.assign(
      {
        id,
        title,
        date: at(-3),
        due_date: at(-2),
        created_at: at(-3) + 'T16:00:00+00:00',
        score_mode: 'proficiency',
        max_points: null,
        weight: 1,
        rubric_id: null,
        tag_ids: [],
        status: null,
        returned_at: null,
        updated_at: null,
        seen_at: null,
        grade: null,
        previous: null,
      },
      extra,
    );
  page.assessments.push(
    row(A_ADV, 'Conscription Advanced', {
      rubric_id: ADV,
      returned_at: at(-1) + 'T20:00:00+00:00',
      grade: copy({
        comment: 'Strong reasons.',
        criteria: { [ADV_C]: { value: 3, modifier: 0, comment: 'Add the unity link.', beyond: null } },
        checks: [K(1), K(2)],
      }),
    }),
    row(A_SPR, 'Conscription Single-Point', {
      rubric_id: SPR,
      returned_at: at(-1) + 'T20:00:00+00:00',
      grade: copy({
        criteria: {
          [SPR_C1]: { value: 4, modifier: 0, comment: null, beyond: 'You tied the vote to the split.' },
          [SPR_C2]: { value: 2, modifier: 1, comment: 'Add a third reason.', beyond: null },
        },
      }),
    }),
    row(A_TODO, 'Wartime Elections Letter', {
      rubric_id: RUBRIC,
      tag_ids: [TAGS.questions, TAGS.share],
      date: at(-1),
      due_date: at(5),
    }),
  );
  return page;
}

describe('a returned piece opens Your Feedback from My Learning', () => {
  it('each returned piece with a result opens it from its row in Your Work; no other row, and no card, does', async () => {
    const page = await demo();
    expect(qa(page, '[data-act="feedback"]')).toHaveLength(0);
    await page.click('[data-tab="learning"]');
    const rows = qa(page, '.sp-ml-work .sp-ml-row[data-act="feedback"]').map(r => r.getAttribute('data-piece'));
    expect(rows).toEqual(
      viewOf(page)
        .work.filter(p => p.kind === 'back' && p.result.text)
        .map(p => p.id),
    );
    expect(rows).toContain('demo-lab');
  });

  it('the title and when it came back, with no class name; nothing is asked of the server', async () => {
    const { page } = await real();
    const before = page.calls.length;
    const p = await openFeedback(page, 'Cell Microscope Lab');
    expect(words(q(page, '.sp-fb-title'))).toBe('Cell Microscope Lab');
    expect(words(q(page, '.sp-fb-sub'))).toMatch(/^Returned \S+ \d+$/);
    expect(words(q(page, '.sp-fb-sub'))).not.toContain('Science 8');
    expect(page.T.state().feedback).toBe(p.id);
    expect(page.T.state().tab).toBe('learning');
    expect(page.calls.slice(before).filter(c => c.body.route !== 'seen')).toEqual([]);
    // On a phone the way back is My Learning; it goes back to the piece's row there.
    expect(words(q(page, '[data-act="feedback-close"]'))).toBe('My Learning');
    const back = page.run('StudentPageView.press')(
      page.T.state(),
      viewOf(page),
      'feedback-close',
      q(page, '.sp-fb-back'),
    );
    expect(back.focus).toBe('.sp-ml-row[data-piece="' + p.id + '"]');
    await page.click('[data-act="feedback-close"]');
    expect(q(page, '.sp-feedback')).toBeNull();
    expect(q(page, '.sp-ml-row[data-piece="' + p.id + '"]')).toBeTruthy();
  });

  it('another tab leaves it', async () => {
    const page = await demo();
    for (const sel of ['[data-tab="questionnaires"]', '[data-tab="assignments"]', '[data-tab="learning"]']) {
      await openFeedback(page, 'Cell Microscope Lab');
      expect(q(page, '.sp-feedback')).toBeTruthy();
      await page.click(sel);
      expect(q(page, '.sp-feedback')).toBeNull();
      expect(page.T.state().feedback).toBe('');
    }
  });
});

describe.each(['proficiency', 'letter', 'both'])('Your Result in a %s class', system => {
  it('the level’s word large, the overall comment, then Your Rubric with each criterion’s level, all the view’s', async () => {
    const { page } = await real(boardsPage(system));
    const p = await openFeedback(page, 'Cell Microscope Lab');
    const big = words(q(page, '.sp-fb-big'));
    if (system === 'letter') {
      // A Letter class has no proficiency words: the result itself, large.
      expect(p.result.word).toBe('');
      expect(big).toBe(p.result.text);
      expect(q(page, '.sp-fb-beside')).toBeNull();
    } else {
      // The proficiency with its ± (and a Both class's %) is the result itself, large, with no figure
      // (DECISIONS, "Student-facing levels are proficiencies").
      expect(p.result.word).toBe('');
      expect(big).toBe(p.result.text);
      expect(big).toMatch(/^(Emerging|Developing|Proficient|Extending)/);
      expect(q(page, '.sp-fb-beside')).toBeNull();
    }
    expect(q(page, '.sp-fb-big').className).toContain('sp-lvt-' + p.result.level);
    // A rubric piece lists no rows in its result: its criteria are under Your Rubric.
    expect(qa(page, '.sp-fb-row')).toHaveLength(0);
    expect(words(q(page, '.sp-fb-comment'))).toBe(p.comment);
    expect(critWords(page).map(c => c.slice(0, 2))).toEqual(p.rubric.rows.map(r => [r.name, r.text]));
    expect(p.rubric.rows.every(r => r.text)).toBe(true);
    // The result, then the comment, then Your Rubric.
    const html = page.root().innerHTML;
    expect(html.indexOf('sp-fb-big')).toBeLessThan(html.indexOf('sp-fb-comment'));
    expect(html.indexOf('sp-fb-comment')).toBeLessThan(html.indexOf('>Your Rubric<'));
  });
});

describe('Your Rubric', () => {
  it('a Rubric: each criterion’s name, the level given and the teacher’s comment on it, and nothing more', async () => {
    const page = await demo();
    const p = await openFeedback(page, 'Cell Microscope Lab');
    expect(words(q(page, '.sp-fb-section'))).toBe('Your Rubric');
    expect(q(page, 'ul.sp-fb-crits')).toBeTruthy();
    expect(critWords(page)).toEqual([
      ['Method', 'Proficient', 'Every step is there, in order.'],
      ['Labelled Drawing', 'Developing +', 'Label the nucleus and the cell wall.'],
    ]);
    expect(critWords(page)).toEqual(p.rubric.rows.map(r => [r.name, r.text, r.comment]));
    // What each level means is on The Whole Rubric, not here.
    const fb = words(q(page, '.sp-feedback'));
    for (const gone of ['Means Here', 'To Reach', 'What You Showed', 'The Goal', 'Counts toward']) {
      expect(fb).not.toContain(gone);
    }
    for (const row of p.rubric.rows) {
      for (const d of row.descriptors) expect(fb).not.toContain(d);
    }
    expect(qa(page, '.sp-fb-criterion .sp-fb-part')).toHaveLength(0);
    expect(words(q(page, '[data-act="whole"]'))).toBe('See the Whole Rubric');
  });

  it('a criterion with no comment shows its name and level alone', async () => {
    const reply = boardsPage();
    reply.assessments.find(a => a.id === WORK.lab).grade.criteria[CRITERIA.method].value = 4;
    const { page } = await real(reply);
    await openFeedback(page, 'Cell Microscope Lab');
    expect(critWords(page)).toEqual([
      ['Method', 'Extending', ''],
      ['Labelled Drawing', 'Developing +', ''],
    ]);
    expect(qa(page, '.sp-fb-note')).toHaveLength(0);
    expect(words(q(page, '.sp-feedback'))).not.toContain(LEVEL_WORDS[3]);
  });

  it('an Advanced Rubric: the level and the comment; the boxes are on The Whole Rubric, ticked ones marked', async () => {
    const { page } = await real(boardsPage());
    await openFeedback(page, 'Conscription Advanced');
    expect(critWords(page)).toEqual([['Support and Opposition', 'Proficient', 'Add the unity link.']]);
    expect(qa(page, '.sp-fb-crits .sp-fb-check')).toHaveLength(0);
    expect(words(q(page, '.sp-feedback'))).not.toContain('Explains Borden’s reason with a fact');
    await page.click('[data-act="whole"]');
    const checks = qa(page, '.sp-whole .sp-fb-check').map(k => [
      words(k),
      !k.querySelector('.sp-fb-box').classList.contains('sp-fb-box-open'),
    ]);
    expect(checks).toEqual([
      ['Explains Borden’s reason with a fact', true],
      ['Gives each group’s own reason', true],
      ['Links the groups to Canadian unity', false],
    ]);
  });

  it('a Single-Point Rubric: Went Beyond or Work On, the teacher’s words; no goal and no whole rubric to see', async () => {
    const { page } = await real(boardsPage());
    await openFeedback(page, 'Conscription Single-Point');
    expect(parts(crit(page, 'Support and Opposition'))).toEqual([['Went Beyond', ['You tied the vote to the split.']]]);
    expect(parts(crit(page, 'Letter to the Editor'))).toEqual([['Work On', ['Add a third reason.']]]);
    expect(words(q(page, '.sp-feedback'))).not.toContain('The Goal');
    expect(words(q(page, '.sp-feedback'))).not.toContain('Gives three of his reasons.');
    expect(q(page, '[data-act="whole"]')).toBeNull();
  });

  it('Points: the score out of the most, its percent and a bar; no rubric and no levels', async () => {
    const page = await demo();
    const p = await openFeedback(page, 'Cell Structure Quiz');
    expect(words(q(page, '.sp-fb-score'))).toBe(p.result.points + ' / ' + p.result.outOf);
    expect(words(q(page, '.sp-fb-pct'))).toBe(p.result.percent);
    expect(p.result.percent).toBe('80%');
    expect(q(page, '.sp-fb-fill').getAttribute('style')).toBe('width:80%');
    expect(q(page, '.sp-fb-section')).toBeNull();
    expect(q(page, '[data-act="levels"]')).toBeNull();
  });

  it('competencies alone: their rows and What the Levels Mean, no Your Rubric', async () => {
    const page = await demo();
    const p = await openFeedback(page, 'Energy Transfer Investigation');
    expect(qa(page, '.sp-fb-row').map(r => words(r.querySelector('.sp-level')))).toEqual(
      p.competencies.map(c => c.text),
    );
    expect(q(page, '.sp-fb-section')).toBeNull();
    expect(q(page, '[data-act="levels"]')).toBeTruthy();
  });
});

describe('What the Levels Mean', () => {
  it('at the foot of Your Feedback, closed at first; it opens on the four levels with the board’s lines and what + and − mean', async () => {
    const page = await demo();
    await openFeedback(page, 'Cell Microscope Lab');
    const btn = () => q(page, '[data-act="levels"]');
    expect(words(btn())).toBe('What the Levels Mean');
    expect(btn().getAttribute('aria-expanded')).toBe('false');
    expect(q(page, '.sp-fb-levels-shut')).toBeTruthy();
    const html = page.root().innerHTML;
    expect(html.indexOf('sp-fb-levels')).toBeGreaterThan(html.indexOf('>Your Rubric<'));
    expect(html.indexOf('sp-fb-levels')).toBeGreaterThan(html.indexOf('data-act="whole"'));
    expect(q(page, '.sp-feedback').lastElementChild.classList.contains('sp-fb-levels')).toBe(true);
    await page.click('[data-act="levels"]');
    expect(btn().getAttribute('aria-expanded')).toBe('true');
    expect(q(page, '.sp-fb-levels-shut')).toBeNull();
    expect(
      qa(page, '.sp-fb-legend-row').map(r => [words(r.querySelector('.sp-level')), words(r.lastElementChild)]),
    ).toEqual([
      [viewOf(page).levels[0].name, 'Just starting'],
      [viewOf(page).levels[1].name, 'Partly there'],
      [viewOf(page).levels[2].name, 'You met the goal'],
      [viewOf(page).levels[3].name, 'You went beyond the goal'],
    ]);
    expect(viewOf(page).levels.map(l => l.name)).toEqual(['Emerging', 'Developing', 'Proficient', 'Extending']);
    expect(words(q(page, '.sp-fb-fine'))).toBe(
      'A + means a little past that level. A − means not quite all the way there.',
    );
    await page.click('[data-act="levels"]');
    expect(btn().getAttribute('aria-expanded')).toBe('false');
    expect(q(page, '.sp-fb-levels-shut .sp-fb-legend')).not.toBeNull();
  });
});

describe('The Whole Rubric', () => {
  it('every level of every criterion, the one given marked You with its level; back to Your Feedback', async () => {
    const page = await demo();
    const p = await openFeedback(page, 'Cell Microscope Lab');
    await page.click('[data-act="whole"]');
    expect(words(q(page, '.sp-fb-title'))).toBe('The Whole Rubric');
    expect(words(q(page, '.sp-fb-sub'))).toBe('Cell Microscope Lab');
    const cards = qa(page, '.sp-whole .sp-fb-card');
    expect(cards.map(c => words(c.querySelector('.sp-fb-crit-name')))).toEqual(['Method', 'Labelled Drawing']);
    const levels = [...cards[1].querySelectorAll('.sp-fb-whole-level')].map(li => [
      words(li.querySelector('.sp-fb-whole-name')),
      words(li.querySelector('.sp-fb-whole-words')),
      li.classList.contains('sp-fb-you'),
    ]);
    const drawing = p.rubric.rows[1];
    expect(levels).toEqual([
      ['Emerging', drawing.descriptors[0], false],
      [drawing.text + 'You', drawing.descriptors[1], true],
      ['Proficient', drawing.descriptors[2], false],
      ['Extending', drawing.descriptors[3], false],
    ]);
    expect(drawing.text).toBe('Developing +');
    expect(words(q(page, '[data-act="whole-close"]'))).toBe('Your Feedback');
    await page.click('[data-act="whole-close"]');
    expect(words(q(page, '.sp-fb-title'))).toBe('Cell Microscope Lab');
  });
});

describe('work not back yet', () => {
  it('its Upcoming card has See the Rubric and no What You’re Graded On; the rubric shows with no level, and goes back to the card', async () => {
    const { page } = await real(boardsPage());
    await page.click('[data-segment="upcoming"]');
    const card = qa(page, '.sp-deck .sp-piece').find(
      c => words(c.querySelector('.sp-piece-title')) === 'Wartime Elections Letter',
    );
    expect(card).toBeTruthy();
    expect(card.querySelector('.sp-graded-on-title')).toBeNull();
    expect(words(card)).not.toContain('What You’re Graded On');
    expect(words(card.querySelector('.sp-rubric-link'))).toBe('See the Rubric');
    await page.click('.sp-piece[data-piece="' + A_TODO + '"] .sp-rubric-link');
    expect(words(q(page, '.sp-fb-title'))).toBe('The Whole Rubric');
    expect(qa(page, '.sp-fb-you')).toHaveLength(0);
    expect(qa(page, '.sp-fb-whole-level')).toHaveLength(8);
    expect(words(q(page, '.sp-whole'))).toContain(LEVEL_WORDS[0]);
    expect(words(q(page, '[data-act="whole-close"]'))).toBe('Assignments');
    await page.click('[data-act="whole-close"]');
    expect(page.T.state().segment).toBe('upcoming');
    expect(q(page, '.sp-piece.sp-picked .sp-piece-title').textContent).toBe('Wartime Elections Letter');
  });

  it('a draft has no feedback: no button, and a press naming it changes nothing', async () => {
    const page = await demo();
    const draft = piece(page, 'Disease Research Poster');
    const press = (ui, act, id) =>
      page.run('StudentPageView.press')(ui, viewOf(page), act, { getAttribute: () => id, closest: () => null });
    expect(press({}, 'feedback', draft.id)).toBeNull();
    expect(press({}, 'feedback', 'nope')).toBeNull();
    // A stale choice that names it draws the page as before.
    const html = page.run('StudentPageView.html');
    expect(html(viewOf(page), { feedback: draft.id })).toBe(html(viewOf(page), {}));
    expect(page.root().innerHTML).not.toContain('two of your sources');
  });
});

describe('opened means opened', () => {
  it('a piece not opened since it came back is told to the server once its feedback has been on screen', async () => {
    const { page } = await real();
    await openFeedback(page, 'Cell Structure Quiz');
    const head = q(page, '.sp-fb-head');
    expect(head.getAttribute('data-unseen')).toBe(WORK.quiz);
    page.onScreen(el => el === q(page, '.sp-fb-head'));
    page.advance(700);
    await page.T.tellSeen();
    await page.settle();
    expect(page.calls.filter(c => c.body.route === 'seen').map(c => c.body.assessment_ids)).toEqual([[WORK.quiz]]);
  });
});

describe('Preview as Student draws the same feedback', () => {
  it.each([
    ['Your Feedback', { feedback: WORK.lab, pick: WORK.lab, levels: true }],
    ['The Whole Rubric', { feedback: WORK.lab, whole: true, pick: WORK.lab }],
    ['a points piece', { feedback: WORK.quiz, pick: WORK.quiz }],
  ])('%s: the same HTML, character for character', async (name, ui) => {
    const { page } = await real(boardsPage('both'));
    Object.assign(page.T.state(), ui, { tab: 'learning' });
    page.run('StudentPage.paint')();
    const view = JSON.parse(JSON.stringify(viewOf(page)));
    const student = q(page, '.sp-view').outerHTML;
    expect(student).toContain('sp-feedback');
    const box = page.root().ownerDocument.createElement('div');
    box.innerHTML = globalThis.PreviewStudent.drawPage(view, Object.assign({ tab: 'learning' }, ui));
    expect(box.innerHTML).toBe(student);
  });
});
