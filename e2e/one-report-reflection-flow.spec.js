import { test, expect } from '@playwright/test';
import { reportPagesStill } from './helpers.js';

/* A reflection on One Report flows down the page (teacher/report-one.js,
   report-sheets.js pack) and its rows can be reached and dragged
   (teacher/report-one-words.js). Demo Mode's Science 8. What teachers
   reported (Colin, 2026-11-25):
   - "How I See Myself as a Learner" started on the Back with the Front a
     third empty, and the Parent / Guardian Response went on to a second
     sheet: the questions under its table were counted against every
     piece of it.
   - A reflection with no line under its statements ran past the foot of
     its page on screen and pushed the response off it: a line to type in
     took room in every row.
   - ⋯ and ⠿ went as the pointer left the row for them. */

const NAME = 'Cece Adeyemi';
const LEARNING = 'student-reflection-learning';
const HABITS = 'student-reflection-habits';
test.setTimeout(120_000);

/* A font wider than any a teacher's machine prints in (as e2e/one-report.spec.js). */
const WIDE_FONT = `.report-sheet, .report-sheet * {
  font-family: Verdana, 'DejaVu Sans', sans-serif !important;
  letter-spacing: 0.03em !important;
}`;

/* The ten latest assessments, then the reflection, then the response:
   the list leaves most of the Front, and the reflection is too long for it. */
async function openWith(page, key, wide) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
  if (wide) await page.addStyleTag({ content: WIDE_FONT });
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  await page.evaluate(k => {
    const one = ReportOne.normalize({
      parts: ['header', 'assessments', k, 'parent-response'],
      options: { assessments: { range: 'last10' } },
    });
    saveReportConfig('sci8', Object.assign({}, getReportConfig('sci8'), { one }));
  }, key);
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  await page.locator('a', { hasText: NAME }).first().click();
  await expect(page.locator('#rb-preview .sheet-student')).toContainText(NAME);
  return errors;
}

/* Each side: its parts, how far its content runs past its foot, and each
   part's height on screen against the room the layout gave it. */
async function sides(page) {
  return page.locator('#rb-preview .sheet-student .sheet-zoom').evaluateAll(zooms =>
    zooms.map(z => {
      const body = z.querySelector('.sheet-body');
      const cells = Array.from(z.querySelectorAll('.sheet-cell[data-part]'));
      // The last thing printed on the side, the docked response apart: a
      // part's room can be taller than what is in it.
      const lastCell = cells.filter(c => c.dataset.part !== 'parent-response').pop();
      const inside = lastCell ? lastCell.querySelectorAll('tbody tr, .report-reflect-q, .report-reflect-checks') : [];
      const last = inside.length ? inside[inside.length - 1] : lastCell;
      return {
        label: z.querySelector('.sheet-label').textContent,
        parts: cells.map(c => c.dataset.part),
        past: body ? Math.max(0, body.scrollHeight - body.clientHeight) : 0,
        taller: cells.map(c => Math.round(c.offsetHeight - parseFloat(c.style.minHeight))),
        rated: z.querySelectorAll('tr[data-wrow]').length,
        questions: z.querySelectorAll('.report-reflect-q').length,
        // The room left under it.
        left:
          body && last
            ? Math.round(
                (body.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom) /
                  (body.getBoundingClientRect().height / body.clientHeight),
              )
            : null,
      };
    }),
  );
}

for (const wide of [false, true]) {
  const font = wide ? ' (a wider font)' : '';

  test('a reflection starts in the room left on the Front and goes on the Back' + font, async ({ page }) => {
    const errors = await openWith(page, LEARNING, wide);
    const s = await sides(page);
    // One sheet: the Front, and the Back with the rest and the response.
    expect(s.map(x => x.label)).toEqual(['Front', 'Back']);
    expect(s[0].parts).toEqual(['header', 'assessments', LEARNING]);
    expect(s[1].parts).toEqual([LEARNING, 'parent-response']);
    // The Front is filled: less room left under it than a question takes.
    expect(s[0].rated).toBeGreaterThan(0);
    expect(s[0].left).toBeLessThan(150);
    // Every statement and question prints once.
    expect(s[0].rated + s[1].rated).toBe(9);
    expect(s[0].questions + s[1].questions).toBe(3);
    // Nothing is taller than the room it was given, and no side runs over.
    s.forEach(x => {
      expect(x.past, x.label).toBe(0);
      x.taller.forEach(d => expect(d, x.label).toBeLessThanOrEqual(1));
    });
    await expect(page.locator(`#rb-preview [data-part="${LEARNING}"] .report-block-title`).nth(1)).toHaveText(
      'How I See Myself as a Learner (continued)',
    );
    expect(errors).toEqual([]);
  });

  test('statements with no line under them are as tall on screen as they print' + font, async ({ page }) => {
    const errors = await openWith(page, HABITS, wide);
    const check = async () =>
      (await sides(page)).forEach(x => {
        expect(x.past, x.label).toBe(0);
        x.taller.forEach(d => expect(d, x.label).toBeLessThanOrEqual(1));
      });
    await check();
    // Pointing at a statement offers its line without moving a row.
    const row = page.locator('#rb-preview tr[data-wrow="items.1"]');
    const before = await row.boundingBox();
    await row.hover();
    await expect(row.locator('.one-w-ph')).toBeVisible();
    expect((await row.boundingBox()).height).toBe(before.height);
    await check();
    expect(errors).toEqual([]);
  });
}

test('⋯ and ⠿ stay while the pointer goes to them, and a statement drags under another heading', async ({ page }) => {
  const errors = await openWith(page, LEARNING, false);
  const mid = async loc => {
    const r = await loc.boundingBox();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const row = page.locator('#rb-preview tr[data-wrow="items.1"]');
  await row.scrollIntoViewIfNeeded();
  // Where the row is, once the pages have stopped moving: under load the test aimed mid-scroll and the
  // pointer went to the row beside it, whose ⋯ showed instead (Nov 25, 2026).
  await reportPagesStill(page);
  const words = await mid(row.locator('.report-habit-name'));

  // Slowly from the statement to its ⋯ in the right margin: it is still there to click.
  const more = page.locator('#rb-preview [data-wmore="items.1"]');
  await page.mouse.move(words.x, words.y);
  const m = await mid(more);
  await page.mouse.move(m.x, m.y, { steps: 50 });
  await expect(more).toHaveClass(/one-w-on/);
  await page.mouse.click(m.x, m.y);
  await expect(page.getByRole('menuitem', { name: 'Move Up' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The same to its ⠿ in the left margin; then down under Relational & Identity.
  const grip = page.locator('#rb-preview [data-wgrip="items.1"]');
  await page.mouse.move(words.x, words.y);
  const g = await mid(grip);
  await page.mouse.move(g.x, g.y, { steps: 50 });
  await expect(grip).toHaveClass(/one-w-on/);
  // In the margin beside another row, that row's ⠿ shows.
  const other = page.locator('#rb-preview tr[data-wrow="items.2"]');
  await page.mouse.move(g.x, (await mid(other)).y, { steps: 10 });
  await expect(page.locator('#rb-preview [data-wgrip="items.2"]')).toHaveClass(/one-w-on/);
  await page.mouse.move(g.x, g.y, { steps: 10 });

  const target = page.locator('#rb-preview tr[data-wrow="items.5"]');
  const t = await target.boundingBox();
  await page.mouse.down();
  await page.mouse.move(g.x, t.y + t.height + 4, { steps: 30 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        k =>
          (ReportOne.forConfig(getReportConfig('sci8')).wording[k] || { items: [] }).items.map(
            i => i.label + '/' + i.group,
          ),
        LEARNING,
      ),
    )
    .toContain('Curiosity & Exploration/Relational & Identity');

  // Escape during a drag puts the row back.
  const again = page.locator('#rb-preview tr[data-wrow="items.0"]');
  await again.scrollIntoViewIfNeeded();
  await reportPagesStill(page);
  await again.hover();
  const g0 = await mid(page.locator('#rb-preview [data-wgrip="items.0"]'));
  const wording = () =>
    page.evaluate(k => JSON.stringify(ReportOne.forConfig(getReportConfig('sci8')).wording[k]), LEARNING);
  const was = await wording();
  await page.mouse.move(g0.x, g0.y, { steps: 10 });
  await page.mouse.down();
  await page.mouse.move(g0.x, g0.y + 160, { steps: 12 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await wording()).toBe(was);
  expect(errors).toEqual([]);
});
