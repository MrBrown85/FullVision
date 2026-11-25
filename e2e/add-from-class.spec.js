/**
 * Add From Another Class (teacher/add-from-class.js; Colin, Nov 17: "add
 * from another class looks janky- redesign this so it's cleaner and more
 * intuitive"). Demo Mode: Science 8 is the class copied from; a second
 * section, Block B, is the class in view. Block B already holds a linked
 * copy of one piece and its own piece with another's title.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openToolbarMenu } from './helpers.js';

const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);
const IPAD_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

async function twoClasses(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => typeof getAssessments === 'function' && getAssessments('sci8').length > 0);
  return page.evaluate(() => {
    const reId = (list, pre) => list.map(x => Object.assign(structuredClone(x), { id: pre + x.id }));
    COURSES.sci8b = Object.assign(structuredClone(COURSES.sci8), { id: 'sci8b', name: 'Science 8', block: 'B' });
    COURSES.sci7 = Object.assign(structuredClone(COURSES.sci8), {
      id: 'sci7',
      name: 'Science 7',
      block: '',
      curriculumTags: ['SCI7'],
    });
    saveCourses(COURSES);
    saveLearningMap('sci8b', Object.assign(structuredClone(getLearningMap('sci8')), { _customized: true }));
    saveCategories('sci8b', reId(getCategories('sci8'), 'b-'));
    saveRubrics('sci8b', reId(getRubrics('sci8'), 'b-'));
    saveModules('sci8b', reId(getModules('sci8'), 'b-'));

    // This test is about plain pieces: the sample quizzes (Quizzes, on since Q6) are set aside.
    saveAssessments(
      'sci8',
      getAssessments('sci8').filter(a => !/^sci8-quiz-/.test(a.id)),
    );
    // Newest first, as the dialog lists them.
    const src = getAssessments('sci8')
      .slice()
      .sort((x, y) => String(y.dateAssigned || y.date).localeCompare(String(x.dateAssigned || x.date)));
    const linked = src[1];
    const twin = src[3];
    const draft = src[4];
    saveAssessments(
      'sci8',
      getAssessments('sci8').map(a =>
        a.id === linked.id
          ? Object.assign({}, a, { copyGroup: 'grp-linked' })
          : a.id === draft.id
            ? Object.assign({}, a, { isDraft: true })
            : a,
      ),
    );
    saveAssessments('sci8b', [
      {
        id: 'b-linked',
        title: linked.title,
        date: linked.date,
        dateAssigned: linked.date,
        tagIds: [],
        copyGroup: 'grp-linked',
      },
      { id: 'b-twin', title: twin.title, date: twin.date, dateAssigned: twin.date, tagIds: [] },
    ]);
    window.Router.navigate('/assignments?course=sci8b');
    return {
      total: src.length,
      linked: linked.id,
      twin: twin.id,
      draft: draft.id,
      first: src[0].id,
      firstTitle: src[0].title,
    };
  });
}

const open = async page => {
  // It is an item of the ▾ beside + New Assessment.
  const menu = await openToolbarMenu(page, 'new');
  await menu.getByRole('menuitem', { name: 'Add From Another Class' }).click();
  await expect(page.locator('.afrom-row').first()).toBeVisible();
};
const row = (page, id) => page.locator('.afrom-row[data-afrom-row="' + id + '"]');
const addBtn = page => page.locator('[data-afrom-add]');

test('pick from another class: columns, search, Select All, the count on Add, and what a copy holds', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewportSize({ width: 1366, height: 900 });
  const ids = await twoClasses(page);
  await open(page);

  const dialog = page.getByRole('dialog', { name: 'Add From Another Class' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.afrom-what')).toContainText('Student scores are never copied.');
  // The other section of the course is first, and already chosen.
  const chips = dialog.getByRole('radio');
  await expect(chips).toHaveText(['Block A · Science 8', 'Science 7']);
  await expect(chips.first()).toHaveAttribute('aria-checked', 'true');
  await expect(chips.first()).toBeFocused();
  await expect(page.locator('.afrom-row')).toHaveCount(ids.total);
  await expect(page.locator('#afrom-status')).toHaveText(ids.total + ' assessments, 1 already here.');
  await expect(addBtn(page)).toBeDisabled();
  await expect(addBtn(page)).toHaveText('Add');
  await shot(page, 'after-1-open');

  // The list scrolls inside the dialog; the title and the buttons stay in view.
  const box = async sel => page.locator(sel).first().boundingBox();
  const list = await box('#afrom-list');
  expect(await page.locator('#afrom-list').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.locator('#afrom-list').evaluate(el => (el.scrollTop = el.scrollHeight));
  for (const sel of [
    '#afrom-title',
    '.afrom-classes',
    '#afrom-search',
    '.afrom-cols',
    '[data-afrom-add]',
    '[data-afrom-cancel]',
  ]) {
    const b = await box(sel);
    expect(b.y, sel).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height, sel).toBeLessThanOrEqual(900);
    expect(b.y + b.height <= list.y + 1 || b.y >= list.y + list.height - 1, sel + ' is outside the list').toBe(true);
  }
  await page.locator('#afrom-list').evaluate(el => (el.scrollTop = 0));

  // Columns line up, and a date reads "Nov 4", never 2026-11-04.
  const lefts = sel =>
    page.locator('.afrom-row ' + sel).evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().left)));
  for (const sel of ['.afrom-cat', '.afrom-scoring', '.afrom-date'])
    expect(new Set(await lefts(sel)).size, sel).toBe(1);
  const dates = await page.locator('.afrom-row .afrom-date').allTextContents();
  expect(dates.every(d => /^[A-Z][a-z]{2}\.? \d{1,2}(, \d{4})?$/.test(d))).toBe(true);

  // A piece this class already has can't be ticked; a same-titled one is flagged; a Draft says so.
  await expect(row(page, ids.linked).locator('.afrom-chip')).toHaveText('Already Here');
  await expect(row(page, ids.linked).locator('.afrom-box')).toBeDisabled();
  await expect(row(page, ids.twin).locator('.afrom-chip')).toHaveText('Same Title Here');
  await expect(row(page, ids.draft).locator('.draft-badge')).toHaveText('Draft');

  // Select All ticks what can be added, and leaves the same-titled one to the teacher.
  await page.locator('#afrom-all').check();
  await expect(addBtn(page)).toHaveText('Add ' + (ids.total - 2));
  await expect(page.locator('#afrom-status')).toContainText(
    'Select All left out 1 with a title this class already has.',
  );
  await expect(page.locator('#afrom-status')).toContainText('A Draft stays a Draft until you assign it here.');
  await expect(row(page, ids.twin).locator('.afrom-box')).not.toBeChecked();
  await page.locator('[data-afrom-clear]').click();
  await expect(addBtn(page)).toHaveText('Add');

  // Search narrows the list; what is ticked stays ticked when the search is cleared.
  await page.fill('#afrom-search', 'zzzz');
  await expect(page.locator('.afrom-row')).toHaveCount(0);
  await expect(page.locator('#afrom-list')).toContainText('No assessments match.');
  await page.locator('[data-afrom-reset]').click();
  await expect(page.locator('.afrom-row')).toHaveCount(ids.total);
  const word = ids.firstTitle.split(/\s+/)[0];
  await page.fill('#afrom-search', word);
  await expect(row(page, ids.first)).toBeVisible();
  expect(await page.locator('.afrom-row').count()).toBeLessThan(ids.total);
  // The whole row is the target: a click on the title ticks it.
  await row(page, ids.first).locator('.afrom-name').click();
  await expect(row(page, ids.first).locator('.afrom-box')).toBeChecked();
  await expect(addBtn(page)).toHaveText('Add 1');
  await page.fill('#afrom-search', '');
  await expect(row(page, ids.first).locator('.afrom-box')).toBeChecked();
  await shot(page, 'after-2-one-ticked');

  // Category narrows it too.
  const cat = page.locator('#afrom-cat');
  await expect(cat).toBeVisible();
  const pick = await cat.locator('option').nth(1).getAttribute('value');
  await cat.selectOption(pick);
  const n = await page.locator('.afrom-row').count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(ids.total);
  await expect(page.locator('#afrom-status')).toContainText('1 selected');
  await cat.selectOption('');

  // The arrow keys walk the rows; Space ticks the Draft.
  await row(page, ids.first).locator('.afrom-box').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect(row(page, ids.draft).locator('.afrom-box')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(addBtn(page)).toHaveText('Add 2');

  // Escape closes and gives the focus back to the toolbar's ▾; nothing was added.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More Ways to Add' })).toBeFocused();
  expect(await page.evaluate(() => getAssessments('sci8b').length)).toBe(2);

  // Add 2: the copies land in this class, linked, with no scores; the Draft is a Draft.
  await open(page);
  await row(page, ids.first).click();
  await row(page, ids.draft).click();
  await expect(addBtn(page)).toHaveText('Add 2');
  await addBtn(page).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#sync-toast')).toContainText('Added 2 assessments from Block A · Science 8.');
  const after = await page.evaluate(ids => {
    const mine = getAssessments('sci8b');
    const from = id => getAssessments('sci8').find(a => a.id === id);
    const copyOf = id => mine.find(a => a.copyGroup && a.copyGroup === from(id).copyGroup);
    const first = copyOf(ids.first);
    const draft = copyOf(ids.draft);
    const scores = getScores('sci8b');
    return {
      count: mine.length,
      firstTitle: first && first.title,
      firstDate: first && first.dateAssigned === (from(ids.first).dateAssigned || from(ids.first).date),
      firstDraft: !!(first && first.isDraft),
      draftIsDraft: !!(draft && draft.isDraft),
      scored: JSON.stringify(scores).includes(first.id) || JSON.stringify(scores).includes(draft.id),
    };
  }, ids);
  expect(after).toEqual({
    count: 4,
    firstTitle: ids.firstTitle,
    firstDate: true,
    firstDraft: false,
    draftIsDraft: true,
    scored: false,
  });

  // Open again: both are now marked, and the class last copied from is chosen.
  await open(page);
  await expect(row(page, ids.first).locator('.afrom-chip')).toHaveText('Already Here');
  await expect(row(page, ids.draft).locator('.afrom-chip')).toHaveText('Already Here');
  await expect(page.locator('#afrom-status')).toHaveText(ids.total + ' assessments, 3 already here.');
  // Another class: its own list, and nothing carried over.
  await dialog.getByRole('radio', { name: 'Science 7' }).click();
  await expect(page.locator('#afrom-list')).toHaveText('Science 7 has no assessments yet.');
  await expect(page.locator('#afrom-all')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('on an iPad held upright the dialog fits: nothing off the side, the buttons in view', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 744, height: 1133 },
    hasTouch: true,
    userAgent: IPAD_UA,
  });
  await context.addInitScript(() => Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }));
  const page = await context.newPage();
  const ids = await twoClasses(page);
  expect(await page.evaluate(() => document.documentElement.classList.contains('fv-tablet'))).toBe(true);
  await open(page);
  await expect(page.locator('.afrom-row')).toHaveCount(ids.total);
  const card = await page.locator('.afrom-card').boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(744);
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.y + card.height).toBeLessThanOrEqual(1133);
  // No row or control is wider than the dialog, and the list doesn't scroll sideways.
  expect(await page.locator('#afrom-list').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const wide = await page
    .locator('.afrom-card *')
    .evaluateAll(
      (els, right) => els.filter(el => el.getBoundingClientRect().right > right + 0.5).length,
      card.x + card.width,
    );
  expect(wide).toBe(0);
  // Rows a finger can hit.
  const h = await page
    .locator('.afrom-row')
    .first()
    .evaluate(el => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(44);
  await page.locator('.afrom-row').nth(0).tap();
  await expect(page.locator('[data-afrom-add]')).toHaveText('Add 1');
  await shot(page, 'after-3-ipad');
  await context.close();
});

// Nov 17: Wipr (EasyList) hid the old checkbox class `.afc-box`, so in Colin's
// Safari each title fell into the checkbox's column, one letter to a line.
// Here every EasyList name is hidden, as a blocker would, and the dialog
// must still show its checkboxes and give the titles their wide column.
test('with an ad blocker on, the checkboxes show and the titles keep their column', async ({ page }) => {
  const names = readFileSync('tests/fixtures/adblock-hidden-names.txt', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('!'));
  const css = names.join(',\n') + ' { display: none !important; }';
  await page.addInitScript(rules => {
    const add = () => {
      const st = document.createElement('style');
      st.textContent = rules;
      document.documentElement.appendChild(st);
    };
    if (document.documentElement) add();
    else document.addEventListener('DOMContentLoaded', add);
  }, css);
  await page.setViewportSize({ width: 1000, height: 850 });
  await twoClasses(page);
  await open(page);
  const first = page.locator('.afrom-row').first();
  await expect(first.locator('.afrom-box')).toBeVisible();
  await expect(page.locator('#afrom-all')).toBeVisible();
  const w = await first.locator('.afrom-title-cell').evaluate(el => el.getBoundingClientRect().width);
  expect(w).toBeGreaterThan(200);
});
