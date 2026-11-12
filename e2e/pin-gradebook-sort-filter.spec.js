import { test, expect } from '@playwright/test';
import { gotoApp, clickAction, getText } from './helpers.js';

/* Pins what the gradebook's sorting and filters do today, in Demo Mode on
   Science 8 (sci8), before any split of teacher/page-gradebook.js: the
   Student and Overall sort buttons, the sort kept across the Scores and
   Competencies switch, the filter strip's chips and Clear All, the To Grade,
   To Return and Questions filters, search with a sort, and the Rubric
   Columns picker remembered after a reload. Tests only: nothing in the app
   is changed. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function openGradebook(page) {
  await gotoApp(page, '/gradebook?course=sci8');
  await expect(page.locator('#gb-data tr[data-sid]').first()).toBeVisible();
}

// The student rows on screen, top to bottom: the names in the left column,
// and the grid's rows beside them, which must agree.
async function rowIds(page) {
  const names = await page
    .locator('#gb-rowheads .gb-grid-rowhead-name')
    .evaluateAll(els => els.map(el => el.dataset.sid));
  const rows = await page.locator('#gb-data tr[data-sid]').evaluateAll(els => els.map(el => el.dataset.sid));
  expect(rows).toEqual(names);
  return names;
}

// The assessment columns on screen, by their headers.
const colIds = page =>
  page.locator('#gb-colheads .gb-grid-colhead[data-aid]').evaluateAll(els => els.map(el => el.dataset.aid));

// The class list as the store has it, sorted by name as a teacher reads it.
async function roster(page) {
  return page.evaluate(() =>
    getStudents('sci8').map(s => ({
      id: s.id,
      first: (s.firstName || '').toLowerCase(),
      last: (s.lastName || '').toLowerCase(),
      overall: getOverallProficiency('sci8', s.id),
    })),
  );
}
const byKey = (list, key, dir) =>
  list
    .slice()
    .sort((a, b) => (key(a) < key(b) ? -dir : key(a) > key(b) ? dir : 0))
    .map(s => s.id);
const lastFirst = s => s.last + ' ' + s.first;
const firstLast = s => s.first + ' ' + s.last;

const studentSort = page => page.locator('.gb-name-sort[data-sortkey="name"]');
const overallSort = page => page.locator('.gb-overall-sort[data-sortkey="overall"]');

test.describe('Gradebook sorting and filters (pinned)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
  });

  test('the Student button cycles Last A-Z, Last Z-A, First A-Z, First Z-A and the rows follow', async ({ page }) => {
    const list = await roster(page);
    await openGradebook(page);
    const button = studentSort(page);

    // No sort chosen yet reads Last Name A-Z, the class's own order.
    await expect(button.locator('.gb-sort-order')).toHaveText('Last Name A–Z');
    await expect(button).toHaveAttribute('title', 'Sorted by Last Name A–Z. Click for Last Name Z–A.');
    expect(await rowIds(page)).toEqual(byKey(list, lastFirst, 1));

    const steps = [
      ['Last Name Z–A', 'First Name A–Z', byKey(list, lastFirst, -1)],
      ['First Name A–Z', 'First Name Z–A', byKey(list, firstLast, 1)],
      ['First Name Z–A', 'Last Name A–Z', byKey(list, firstLast, -1)],
      ['Last Name A–Z', 'Last Name Z–A', byKey(list, lastFirst, 1)],
    ];
    for (const [now, next, order] of steps) {
      await clickAction(page, 'toggleSort');
      await expect(button.locator('.gb-sort-order')).toHaveText(now);
      await expect(button).toHaveAttribute('title', 'Sorted by ' + now + '. Click for ' + next + '.');
      expect(await rowIds(page)).toEqual(order);
    }
  });

  test('Overall sorts lowest first, then highest, and Student goes back to Last A-Z', async ({ page }) => {
    const list = await roster(page);
    await openGradebook(page);
    const button = overallSort(page);
    await expect(button).toHaveAttribute('title', 'Click to sort by Overall, lowest first.');
    await expect(button.locator('.gb-sort-arrow')).toHaveCount(0);

    await button.click();
    await expect(button.locator('.gb-sort-arrow')).toHaveText('▲');
    await expect(button).toHaveAttribute('title', 'Sorted by Overall, lowest first. Click for highest first.');
    const lowFirst = byKey(list, s => s.overall, 1);
    expect(await rowIds(page)).toEqual(lowFirst);
    // While Overall leads, the Student button names no order.
    await expect(studentSort(page).locator('.gb-sort-order')).toHaveCount(0);

    await overallSort(page).click();
    await expect(overallSort(page).locator('.gb-sort-arrow')).toHaveText('▼');
    await expect(overallSort(page)).toHaveAttribute(
      'title',
      'Sorted by Overall, highest first. Click for lowest first.',
    );
    expect(await rowIds(page)).toEqual(byKey(list, s => s.overall, -1));

    await studentSort(page).click();
    await expect(studentSort(page).locator('.gb-sort-order')).toHaveText('Last Name A–Z');
    await expect(overallSort(page).locator('.gb-sort-arrow')).toHaveCount(0);
    expect(await rowIds(page)).toEqual(byKey(list, lastFirst, 1));
  });

  test('the sort holds across the Scores and Competencies switch', async ({ page }) => {
    const list = await roster(page);
    await openGradebook(page);
    await clickAction(page, 'toggleSort');
    await clickAction(page, 'toggleSort');
    const firstAZ = byKey(list, firstLast, 1);
    expect(await rowIds(page)).toEqual(firstAZ);

    await page.locator('[data-action="setView"][data-mode="detailed"]').click();
    await expect(page.locator('[data-action="setView"][data-mode="detailed"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('.gb-grid-comp')).toBeVisible();
    await expect(studentSort(page).locator('.gb-sort-order')).toHaveText('First Name A–Z');
    expect(await rowIds(page)).toEqual(firstAZ);

    await overallSort(page).click();
    const lowFirst = byKey(list, s => s.overall, 1);
    expect(await rowIds(page)).toEqual(lowFirst);

    await page.locator('[data-action="setView"][data-mode="scores"]').click();
    await expect(page.locator('[data-action="setView"][data-mode="scores"]')).toHaveAttribute('aria-selected', 'true');
    await expect(overallSort(page).locator('.gb-sort-arrow')).toHaveText('▲');
    expect(await rowIds(page)).toEqual(lowFirst);
  });

  test('a category, a module and a section each narrow the columns and the filter count; Clear All restores them', async ({
    page,
  }) => {
    const CAT = 'sci8-cat-checks';
    const MOD = 'sci8-mod-chem';
    const SEC = 'PA4';
    // What each chip should leave, read from the store.
    const want = await page.evaluate(
      ([cat, mod, sec]) => {
        const all = getAssessments('sci8');
        const inCat = all.filter(a => (a.categoryId || a.category_id) === cat);
        const inMod = inCat.filter(a => a.moduleId === mod);
        const inSec = inMod.filter(a =>
          (a.tagIds || []).some(t => {
            const s = getSectionForTag('sci8', t);
            return s && s.id === sec;
          }),
        );
        const ids = list => list.map(a => a.id).sort();
        return { all: ids(all), cat: ids(inCat), mod: ids(inMod), sec: ids(inSec) };
      },
      [CAT, MOD, SEC],
    );
    // Each step leaves fewer, and never none.
    expect(want.all.length).toBeGreaterThan(want.cat.length);
    expect(want.cat.length).toBeGreaterThan(want.mod.length);
    expect(want.mod.length).toBeGreaterThan(want.sec.length);
    expect(want.sec.length).toBeGreaterThan(0);

    await openGradebook(page);
    const trigger = page.locator('.gb-filter-trigger');
    const count = trigger.locator('.filter-count');
    const sorted = async () => (await colIds(page)).sort();
    expect(await sorted()).toEqual(want.all);
    await expect(count).toHaveClass(/is-empty/);
    await expect(trigger).toHaveAttribute('aria-label', 'Toggle filters');
    await expect(page.locator('.gb-filter-clear')).toHaveCount(0);

    await clickAction(page, 'toggleFilterStrip');
    await expect(page.locator('#gb-filter-strip')).toHaveClass(/open/);

    const chip = (attr, id) => page.locator('#gb-filter-strip .gb-filter-chip[' + attr + '="' + id + '"]');
    const steps = [
      [chip('data-catid', CAT), want.cat, '1'],
      [chip('data-moduleid', MOD), want.mod, '2'],
      [chip('data-secid', SEC), want.sec, '3'],
    ];
    for (const [c, ids, n] of steps) {
      await c.click();
      await expect(c).toHaveClass(/active/);
      await expect(count).toHaveText(n);
      await expect(count).not.toHaveClass(/is-empty/);
      await expect(trigger).toHaveClass(/has-filters/);
      await expect(trigger).toHaveAttribute('aria-label', 'Toggle filters, ' + n + ' active');
      expect(await sorted()).toEqual(ids);
    }
    // The strip stays open while the chips redraw it.
    await expect(page.locator('#gb-filter-strip')).toHaveClass(/open/);

    await page.locator('.gb-filter-clear').click();
    expect(await sorted()).toEqual(want.all);
    await expect(count).toHaveClass(/is-empty/);
    await expect(trigger).not.toHaveClass(/has-filters/);
    await expect(trigger).toHaveAttribute('aria-label', 'Toggle filters');
    await expect(page.locator('#gb-filter-strip .gb-filter-chip.active')).toHaveCount(0);
    await expect(page.locator('.gb-filter-clear')).toHaveCount(0);
  });

  test('search and sort work together', async ({ page }) => {
    const list = await roster(page);
    await openGradebook(page);
    // Each sort's full order, kept to the students the search leaves.
    await clickAction(page, 'toggleSort');
    const zaAll = await rowIds(page);
    expect(zaAll).toEqual(byKey(list, lastFirst, -1));

    const search = page.locator('.gb-search-input');
    await search.fill('ma');
    await expect(page.locator('.gb-search-clear')).toBeVisible();
    const matches = await page.evaluate(() =>
      getStudents('sci8')
        .filter(s =>
          [displayName(s), s.firstName, s.lastName, s.studentNumber].some(v =>
            String(v || '')
              .toLowerCase()
              .includes('ma'),
          ),
        )
        .map(s => s.id),
    );
    expect(matches.length).toBeGreaterThan(2);
    expect(matches.length).toBeLessThan(list.length);
    const onScreen = await rowIds(page);
    expect(onScreen).toEqual(zaAll.filter(id => matches.includes(id)));
    // Every name left on screen holds the search.
    for (const text of await page.locator('#gb-rowheads .gb-grid-rowhead-name').allTextContents()) {
      expect(text.toLowerCase()).toContain('ma');
    }

    // A sort with the search on keeps the search and sorts what it leaves.
    await studentSort(page).click();
    await expect(studentSort(page).locator('.gb-sort-order')).toHaveText('First Name A–Z');
    await expect(search).toHaveValue('ma');
    expect(await rowIds(page)).toEqual(byKey(list, firstLast, 1).filter(id => matches.includes(id)));
    await overallSort(page).click();
    expect(await rowIds(page)).toEqual(byKey(list, s => s.overall, 1).filter(id => matches.includes(id)));

    // Clearing the search brings everyone back in the sort chosen.
    await page.locator('.gb-search-clear').click();
    await expect(search).toHaveValue('');
    expect(await rowIds(page)).toEqual(byKey(list, s => s.overall, 1));
  });

  test('Rubric Columns switches between criterion and competency columns and is remembered after a reload', async ({
    page,
  }) => {
    const LAB = 'sci8a1'; // Cell Microscope Lab, scored on a rubric
    const at = await page.evaluate(lab => {
      const a = getAssessments('sci8').find(x => x.id === lab);
      return { criteria: rubricCriterionColumns(a, 'sci8').length, tags: (a.tagIds || []).slice().sort() };
    }, LAB);
    expect(at.criteria).toBeGreaterThan(0);
    expect(at.tags.length).toBeGreaterThan(at.criteria);

    await openGradebook(page);
    // Scores has no picker: it lives in the Competencies corner.
    await expect(page.locator('.gb-rubric-cols-select')).toHaveCount(0);
    await page.locator('[data-action="setView"][data-mode="detailed"]').click();
    const picker = page.locator('.gb-rubric-cols-select');
    await expect(picker).toHaveValue('criteria');
    await expect(picker.locator('option:checked')).toHaveText('Rubrics by Criterion');

    const firstRowCells = () =>
      page
        .locator('#gb-data tr[data-sid]')
        .first()
        .locator('td[data-aid="' + LAB + '"]');
    await expect(firstRowCells()).toHaveCount(at.criteria);

    await picker.selectOption('competencies');
    await expect(page.locator('.gb-rubric-cols-select')).toHaveValue('competencies');
    await expect(firstRowCells()).toHaveCount(at.tags.length);
    const tids = await firstRowCells().evaluateAll(els => els.map(el => el.dataset.tid).sort());
    expect(tids).toEqual(at.tags);
    expect(await page.evaluate(() => getViewPref('gb_rubricColumns_sci8'))).toBe('competencies');

    // After a reload the gradebook opens on Scores; Competencies keeps the choice.
    await page.reload();
    await openGradebook(page);
    await expect(page.locator('[data-action="setView"][data-mode="scores"]')).toHaveAttribute('aria-selected', 'true');
    await page.locator('[data-action="setView"][data-mode="detailed"]').click();
    await expect(page.locator('.gb-rubric-cols-select')).toHaveValue('competencies');
    await expect(firstRowCells()).toHaveCount(at.tags.length);

    await page.locator('.gb-rubric-cols-select').selectOption('criteria');
    await expect(firstRowCells()).toHaveCount(at.criteria);
    await page.reload();
    await openGradebook(page);
    await page.locator('[data-action="setView"][data-mode="detailed"]').click();
    await expect(page.locator('.gb-rubric-cols-select')).toHaveValue('criteria');
    await expect(firstRowCells()).toHaveCount(at.criteria);
  });
});

/* To Grade, To Return and Questions come from Demo Mode's sample once the
   student page's build switch, Send Work and Reflect on Feedback are on (as
   e2e/demo-sample-to-grade.spec.js and e2e/questions-from-students.spec.js
   turn them on). */
test.describe('Gradebook work filters (pinned)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await page.waitForFunction(() => getCourseSubmissions('sci8').submissions.length > 0);
    await page.evaluate(async () => {
      setStudentPageSwitch('sci8', true, 'on_return');
      const work = getCourseSubmissions('sci8');
      work.course.send_work = true;
      saveDemoStudentWork('sci8', work);
      await setCourseFeedbackOptions('sci8', { reflect_on_feedback: true }, 'e2e-pin-gb-filters');
    });
    // Demo Mode opened again: the class holds grades now, so the drafts are made.
    await gotoApp(page, '/dashboard');
    await page.waitForFunction(() => GradeState.draftsWaiting('sci8') > 0 && getQuestionsWaiting('sci8').length > 0);
  });

  test('To Grade, To Return and Questions each narrow the rows and set aria-pressed', async ({ page }) => {
    // Who and what each filter should leave, read from the store's counts.
    const want = await page.evaluate(() => {
      const cid = 'sci8';
      const pick = fn => {
        const sids = [];
        const aids = [];
        getAssessments(cid).forEach(a => {
          const ids = fn(a);
          if (!ids.length) return;
          aids.push(a.id);
          ids.forEach(sid => sids.includes(sid) || sids.push(sid));
        });
        return { sids, aids: aids.sort() };
      };
      const q = getQuestionsWaiting(cid);
      const all = getStudents(cid).map(s => s.id);
      return {
        tograde: pick(a => (GraderWork.workOn(cid, a) ? GraderWork.workCounts(cid, a.id, all).ids.tograde : [])),
        toreturn: pick(a => GraderWork.draftsIn(cid, a.id, all)),
        questions: pick(a => q.filter(r => r.assessment_id === a.id).map(r => r.enrollment_id)),
      };
    });

    await openGradebook(page);
    const everyone = await rowIds(page);
    const everyColumn = await colIds(page);

    // Each filter: its button, the cells its mark is on, and what it leaves.
    const filters = [
      ['.gb-to-grade-btn', '.gb-to-grade', / to grade$/, want.tograde],
      ['.gb-to-return', '.gb-draft', / to return$/, want.toreturn],
      ['.gb-questions-btn', '.gb-question', / questions?$/, want.questions],
    ];
    for (const [btn, mark, words, left] of filters) {
      expect(left.sids.length).toBeGreaterThan(0);
      expect(left.sids.length).toBeLessThan(everyone.length);
      const pill = page.locator(btn);
      await expect(pill).toHaveAttribute('aria-pressed', 'false');
      await expect(pill).toHaveText(words);
      expect(Number((await getText(page, btn)).match(/^\d+/)[0])).toBeGreaterThan(0);
      // The cells that show the mark on screen, before the filter.
      const marked = await page
        .locator('#gb-data td.gb-scores-cell:has(' + mark + '), #gb-data td.gb-scores-cell' + mark)
        .evaluateAll(els => els.map(el => el.dataset.sid));
      expect(marked.length).toBeGreaterThan(0);

      await pill.click();
      await expect(page.locator(btn)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(btn)).toHaveClass(/active/);
      await expect(page.locator(btn)).toBeFocused();
      const rows = await rowIds(page);
      expect(rows).toEqual(everyone.filter(id => left.sids.includes(id)));
      for (const sid of marked) expect(rows).toContain(sid);
      expect((await colIds(page)).sort()).toEqual(left.aids);

      await page.locator(btn).click();
      await expect(page.locator(btn)).toHaveAttribute('aria-pressed', 'false');
      expect(await rowIds(page)).toEqual(everyone);
      expect(await colIds(page)).toEqual(everyColumn);
    }
  });
});
