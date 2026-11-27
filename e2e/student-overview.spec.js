/**
 * The student Overview pictures the grade (DECISIONS, "The student Overview
 * pictures the grade (2026-11-17)"). Demo Mode, Science 8: the grade's line
 * over the year with what is behind each day, the competencies pointing at
 * the days they were assessed, a competency narrowing All Your Work, the
 * Missing tile showing the missing work, and each piece's feedback open to
 * read without a click. At a desk and on an iPad held upright.
 *
 * Your Competencies at a glance (DECISIONS, 2026-11-27): the strongest and
 * the next to work on by name, the same picks as the Competencies tab's
 * line, and every bar inside its card with room for its name, in the
 * page's own font and in a wide one.
 */
import { test, expect } from '@playwright/test';

async function openStudent(page, first) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const sid = await page.evaluate(name => getStudents('sci8').find(s => s.firstName === name).id, first);
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid + '&course=sci8&tab=overview');
  await page.locator('.stu-gp').waitFor();
  return sid;
}

test('the grade over the year and the competencies point at each other', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openStudent(page, 'Sam');
  await expect(page.locator('.stu-ov-todo, .stu-ov-better')).toHaveCount(0);

  // One point a day work counted, then today; the last is now.
  const points = page.locator('.stu-gp-pt');
  expect(await points.count()).toBeGreaterThan(10);
  await expect(points.last()).toHaveAttribute('aria-label', /^Today: \d\.\d Proficient/);

  // Pointing at a day: what was assessed, and the competencies it counted toward light up.
  // Your Competencies names a few, so take a day one of them was assessed.
  const shown = await page.locator('.stu-gp-tile').evaluateAll(els => els.map(el => el.dataset.sec));
  const at = await page
    .locator('.stu-gp-pt')
    .evaluateAll(
      (els, secs) => els.findIndex(el => (el.dataset.secs || '').split(' ').some(s => secs.includes(s))),
      shown,
    );
  expect(at).toBeGreaterThanOrEqual(0);
  const day = page.locator('.stu-gp-pt').nth(at);
  await day.hover();
  await expect(day.locator('.stu-gp-tip')).toBeVisible();
  await expect(page.locator('.stu-gp')).toHaveClass(/linking/);
  const lit = await page.locator('.stu-gp-tile.hl').count();
  expect(lit).toBeGreaterThan(0);
  await page.mouse.move(2, 2);
  await expect(page.locator('.stu-gp')).not.toHaveClass(/linking/);

  // A competency narrows All Your Work to its work; its chip puts everything back.
  const all = await page.locator('.stu-ov-all .stu-ov-item').count();
  const tile = page.locator('.stu-gp-tile:not([disabled])').first();
  const n = (await tile.getAttribute('data-aids')).split(' ').length;
  await tile.click();
  await expect(page.locator('.stu-ov-all .stu-ov-item')).toHaveCount(n);
  await expect(page.locator('.stu-gp-tile[aria-pressed="true"]')).toHaveCount(1);
  await page.locator('.stu-ov-comp-chip').click();
  await expect(page.locator('.stu-ov-all .stu-ov-item')).toHaveCount(all);

  // A day's work is shown below when the day is clicked.
  await day.click();
  const aid = (await day.getAttribute('data-aids')).split(' ')[0];
  await expect(page.locator('#stu-ov-row-' + aid)).toBeInViewport();

  // The feedback reads without a click: a Single-Point Rubric's Work On, with each criterion's level.
  const journal = page.locator('.stu-ov-item', { hasText: 'Biodiversity Field Journal' });
  await expect(journal.locator('.stu-ov-fb-crit')).toHaveCount(3);
  await expect(journal.locator('.stu-ov-fb-part.work')).toContainText('Work On');
  await expect(page.locator('.stu-ov-row-btn')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the Missing tile shows the missing work', async ({ page }) => {
  await openStudent(page, 'Ethan');
  await page.locator('button.stu-ov-miss').click();
  await expect(page.locator('.stu-ov-chip[data-filter="missing"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.stu-ov-all .stu-ov-item')).toHaveCount(1);
  await expect(page.locator('.stu-ov-all .stu-ov-item .stu-ov-pill.miss')).toHaveText('Missing');
});

test('on an iPad held upright, nothing runs off the side', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await openStudent(page, 'Sam');
  const wide = await page.evaluate(() => {
    const ov = document.querySelector('.stu-ov');
    const right = ov.getBoundingClientRect().right + 1;
    return Array.from(ov.querySelectorAll('.stu-gp-tile, .stu-gp-x span, .stu-ov-fb-crit, .stu-ov-item-head'))
      .filter(el => el.getBoundingClientRect().right > right)
      .map(el => el.className);
  });
  expect(wide).toEqual([]);
});

/* ── Your Competencies at a glance ───────────────────────────── */

const WIDE_FONT =
  '*, *::before, *::after { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }';

// Every bar inside its card, its name and its level side by side with neither cut nor overlapping.
async function barFaults(page) {
  return page.evaluate(() => {
    const card = document.querySelector('.stu-gp-comps').getBoundingClientRect();
    return Array.from(document.querySelectorAll('.stu-gp-tile')).flatMap(bar => {
      const b = bar.getBoundingClientRect();
      const name = bar.querySelector('.stu-gp-name').getBoundingClientRect();
      const val = bar.querySelector('.stu-gp-val').getBoundingClientRect();
      const out = [];
      if (b.left < card.left || b.right > card.right + 0.5) out.push('outside the card: ' + bar.dataset.sec);
      if (name.right > val.left + 0.5) out.push('name runs into the level: ' + bar.dataset.sec);
      if (val.right > b.right + 0.5 || name.left < b.left) out.push('cut off: ' + bar.dataset.sec);
      if (name.width < 60) out.push('no room for the name: ' + bar.dataset.sec);
      return out;
    });
  });
}

test('Your Competencies names the strongest and the next to work on, as the Competencies tab does', async ({
  page,
}) => {
  await openStudent(page, 'Hannah');
  const card = page.locator('.stu-gp-comps');
  const labels = await card.locator('.stu-gp-group > .stu-ov-label').allTextContents();
  expect(labels).toEqual(['Strongest', 'Next to Work On']);
  const strongest = card.locator('.stu-gp-group').nth(0).locator('.stu-gp-tile');
  const next = card.locator('.stu-gp-group').nth(1).locator('.stu-gp-tile');
  await expect(strongest).toHaveCount(3);
  await expect(next).toHaveCount(3);
  // A name and the level as the class shows it, never a bare code.
  await expect(strongest.first().locator('.stu-gp-name')).not.toBeEmpty();
  await expect(strongest.first().locator('.stu-gp-val')).toHaveText(
    /^\d\.\d\s*(Emerging|Developing|Proficient|Extending)/,
  );
  // The level split stays above them.
  await expect(card.locator('.stu-gp-seg-part').first()).toBeVisible();
  // Strongest is never lower than Next to Work On.
  const level = loc => loc.locator('.stu-gp-val b').allTextContents();
  const hi = (await level(strongest)).map(Number);
  const lo = (await level(next)).map(Number);
  expect(Math.min(...hi)).toBeGreaterThan(Math.max(...lo));

  const first = {
    hi: await strongest.first().locator('.stu-gp-name').textContent(),
    lo: await next.first().locator('.stu-gp-name').textContent(),
  };
  // See All opens the Competencies tab, whose line names the same two.
  await card.locator('.stu-gp-all').click();
  await expect(page.locator('#stu-tab-comps')).toHaveAttribute('aria-selected', 'true');
  const line = page.locator('.stu-cp-summary');
  await expect(line.locator('.stu-cp-sum-item', { hasText: 'Strongest' })).toContainText(first.hi);
  await expect(line.locator('.stu-cp-sum-item', { hasText: 'Next to Work On' })).toContainText(first.lo);
});

for (const width of [1440, 1280, 1024, 820, 744]) {
  test('Your Competencies fits at ' + width + ' wide, in the page’s font and a wide one', async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await openStudent(page, 'Hannah');
    expect(await barFaults(page)).toEqual([]);
    await page.addStyleTag({ content: WIDE_FONT });
    expect(await barFaults(page)).toEqual([]);
  });
}
