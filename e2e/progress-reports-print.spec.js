/**
 * Progress Reports as they print (One Report: teacher/report-one.js and its
 * panel and page, report-sheets.js, report-blocks.js, grade-report.js,
 * page-reports.js). Demo Mode's Science 8 class, 27 students. What a
 * report prints, the class's Quick Report choices and a Page Studio form
 * read as One Report's parts, the Feedback Pages, Print Reports with its
 * saved copy, and page counts from Chromium's print engine. The panel and
 * the page's own controls are in e2e/one-report.spec.js.
 *
 * These tests were Page Studio's and the Quick Report's
 * (e2e/report-studio.spec.js); the ones about that editor went with it.
 */
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'parallel' });

/* Fit and page counts depend on text width. The app's font stack is the
   system font: SF Pro on a Mac, DejaVu Sans (much wider) on the Linux CI
   runner. Arial is on macOS and Windows, and Linux renders it with the
   metric-identical Liberation Sans, so these tests lay out the same
   everywhere. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Init scripts run before <html> exists: set the font as soon as it does.
    new MutationObserver((_, observer) => {
      if (!document.documentElement) return;
      document.documentElement.style.setProperty('--font-base', "Arial, 'Liberation Sans', sans-serif");
      observer.disconnect();
    }).observe(document, { childList: true });
  });
});

const STUDENTS = 27;

/* Progress Reports as a class with nothing saved opens it: its Quick
   Report choices (none yet) read as One Report's parts. */
async function openGrade(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
  await expect(page.locator('.report-sheet')).toHaveCount(2);
}

/* A Report Card built in Page Studio, saved for the class as main saved
   it, with Assignment Grades set to This Term, two columns, by category so
   it fits the Back. One Report reads it as its parts in the same order
   (DECISIONS, "One Report is the Progress Reports screen", 3). */
const STARTING_LAYOUT = {
  progressMode: 'build',
  form: {
    v: 6,
    id: 'report-card',
    name: 'Report Card',
    type: 'standard',
    sides: [
      {
        rows: [
          { cells: [{ block: 'header', size: 'row' }] },
          { cells: [{ block: 'proficiency', size: 'row' }] },
          { cells: [{ block: 'legend', size: 'row' }] },
          { cells: [{ block: 'teacher-narrative', size: 'row', lines: 10 }] },
          {
            cells: [
              { block: 'term-attendance', size: 'half' },
              { block: 'missing-work', size: 'half' },
            ],
          },
        ],
      },
      {
        rows: [
          { cells: [{ block: 'self-assessment', size: 'row' }] },
          {
            cells: [
              {
                block: 'grade-table',
                size: 'row',
                options: { range: 'term', columns: 'two', organize: 'category' },
              },
            ],
          },
          { cells: [{ block: 'parent-response', size: 'row', lines: 3 }] },
        ],
      },
    ],
    pinned: 'parent-response',
    perStudent: {},
  },
  preset: 'standard',
};

async function openStudio(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(layout => saveReportConfig(getActiveCourse(), layout), STARTING_LAYOUT);
  await page.reload();
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
  await expect(page.locator('.sheet-cell[data-part="parent-response"]')).toHaveCount(1);
}

/* Feedback Pages on, with Assignment Numbers, saved as the Quick Report
   saved them. */
async function openFeedback(page) {
  await openGrade(page);
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const c = getReportConfig(cid) || {};
    saveReportConfig(cid, { ...c, gradeReport: { ...(c.gradeReport || {}), feedback: true, numbers: true } });
  });
  await page.reload();
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('.fb-sheet').first()).toBeVisible();
}

/* A Setup from the panel's Setup menu. */
async function applySetup(page, id) {
  await page.locator('#studio-palette [data-action="oneSetupMenu"]').click();
  await page.locator(`#studio-palette [data-action="oneSetup"][data-value="${id}"]`).click();
}

/* A part's options in the panel, opened. */
async function openOptions(page, key) {
  const name = page.locator(`#studio-palette [data-action="oneOpen"][data-part="${key}"]`);
  if ((await name.getAttribute('aria-expanded')) !== 'true') await name.click();
  const opts = page.locator('#one-opts-' + key);
  await expect(opts).toBeVisible();
  return opts;
}

const partSwitch = (page, key) => page.locator(`#studio-palette [data-action="oneSwitch"][data-part="${key}"]`);

/* Add a Part, unfolded: the parts that are off. */
async function openAddList(page) {
  const head = page.locator('#studio-palette [data-action="oneFold"][data-value="add"]');
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
}

/* Everyone: every student's pages on the canvas, which is what prints.
   sides: how many each student takes (2 for one sheet, Front and Back). */
async function showEveryone(page, sides = 2) {
  await page.locator('.studio-view [data-view="all"]').click();
  await expect(page.locator('.report-sheet')).toHaveCount(STUDENTS * sides);
}

/* Every student's sheets on the page, however many sides each has. */
async function showAllStudents(page) {
  await page.locator('.studio-view [data-view="all"]').click();
  await expect(page.locator('.sheet-student')).toHaveCount(STUDENTS);
}

/* Sheets whose body or a cell overflows, named by student and part. */
async function overflowing(page) {
  return page.locator('.report-sheet').evaluateAll(sheets =>
    sheets.flatMap(s => {
      const who = s.closest('.sheet-student')?.querySelector('.sheet-student-name')?.textContent || '?';
      const body = s.querySelector('.sheet-body');
      const out = [];
      if (body && (body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1)) {
        out.push(who + ' · body ' + body.scrollHeight + '/' + body.clientHeight);
      }
      [...s.querySelectorAll('.sheet-cell')].forEach(c => {
        if (c.scrollWidth > c.clientWidth + 1)
          out.push(who + ' · ' + c.dataset.part + ' ' + c.scrollWidth + '/' + c.clientWidth);
      });
      return out;
    }),
  );
}

/* The parts a side prints, row by row, as "part" or "a+b" strings, a half
   width part marked "/half". */
async function rowsOf(page, side) {
  return page
    .locator(`#rb-preview .sheet-zoom[data-side="${side}"] .sheet-row`)
    .evaluateAll(rows =>
      rows.map(r =>
        [...r.querySelectorAll('.sheet-cell')]
          .map(c => c.dataset.part + (c.dataset.size === 'half' ? '/half' : ''))
          .join('+'),
      ),
    );
}

const cellOf = (page, key) => page.locator(`#rb-preview .sheet-cell[data-part="${key}"]`).first();

/* Chromium writes one "/Type /Page" object per page (and one "/Type /Pages"
   tree node, which the trailing character class excludes). */
function countPages(pdf) {
  const text = pdf.toString('latin1');
  return (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
}

function pageBoxes(pdf) {
  const text = pdf.toString('latin1');
  return [...text.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+(\d+)\s+(\d+)\s*\]/g)].map(m => [Number(m[1]), Number(m[2])]);
}

async function printToPdf(page) {
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  return pdf;
}

/* Words in a rubric cell wider than the room they have, so the browser
   would break them: each word measured in its own font on a canvas
   against its box's content width. Run with print media (zoom 1). */
async function brokenWords(page) {
  return page.locator('.fb-rb').evaluateAll(tables => {
    const ctx = document.createElement('canvas').getContext('2d');
    const out = [];
    tables.forEach(t =>
      t.querySelectorAll('th, td').forEach(cell => {
        const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walk.nextNode())) {
          let box = n.parentElement;
          while (box !== cell && getComputedStyle(box).display === 'inline') box = box.parentElement;
          const bs = getComputedStyle(box);
          const room = box.clientWidth - parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight);
          const fs = getComputedStyle(n.parentElement);
          ctx.font = `${fs.fontStyle} ${fs.fontWeight} ${fs.fontSize} ${fs.fontFamily}`;
          // A hyphen is a place to break, not a broken word.
          n.textContent
            .split(/\s+|(?<=-)/)
            .filter(Boolean)
            .forEach(w => {
              if (ctx.measureText(w).width > room + 0.5) out.push(`${w} (${Math.round(room)}px)`);
            });
        }
      }),
    );
    return out;
  });
}

/* Each card's bottom against its column's and the side's, and any card
   wider than its column. */
async function cardSpill(page) {
  return page.locator('.fb-sheet').evaluateAll(sheets =>
    sheets.flatMap(s => {
      const body = s.querySelector('.sheet-body').getBoundingClientRect();
      return [...s.querySelectorAll('.fb-card')]
        .filter(c => {
          const r = c.getBoundingClientRect();
          return r.bottom > body.bottom + 0.5 || c.scrollWidth > c.clientWidth + 1;
        })
        .map(c => c.querySelector('.fb-title').textContent);
    }),
  );
}

/* Every student's sheets as the layout counted them. */
async function totalSheets(page) {
  return page
    .locator('.sheet-student')
    .evaluateAll(list => list.reduce((sum, el) => sum + Number(el.dataset.sheets || 0), 0));
}

/* What each of a student's sides is: the report, a Feedback Page, or blank. */
const sideKinds = student =>
  student.locator('.sheet-zoom').evaluateAll(list =>
    list.map(z => {
      const s = z.querySelector('.report-sheet');
      return s.classList.contains('fb-sheet')
        ? 'feedback'
        : s.classList.contains('sheet-blank-side')
          ? 'blank'
          : 'report';
    }),
  );

test.describe('A Page Studio form, read as parts', () => {
  test.setTimeout(120_000);

  /* A saved form opens as a Setup and flows as one list: its sides are
     not kept (DECISIONS, "One Report", Parts flow). */
  test('the parts print once each in the form’s order, flowing over the sides; the Response docks at the foot', async ({
    page,
  }) => {
    await openStudio(page);
    const student = page.locator('#rb-preview .sheet-student').first();
    // Each side's parts, in print order.
    const sides = await student
      .locator('.sheet-zoom')
      .evaluateAll(zooms => zooms.map(z => [...z.querySelectorAll('.sheet-cell[data-part]')].map(c => c.dataset.part)));
    // A part cut between sides runs on from one side to the next: taken
    // once, the list is the form's order. Attendance prints nothing in
    // Demo Mode (none is entered), so it is not on the page.
    const flat = sides.flat().filter((k, i, a) => k !== a[i - 1]);
    expect(flat).toEqual([
      'header',
      'proficiency',
      'legend',
      'teacher-narrative',
      'missing-work',
      'self-assessment',
      'grade-table',
      'parent-response',
    ]);
    // The list flows over the sides: the Front holds the form's Front and
    // goes on into what the form put on the Back.
    expect(sides.length).toBeGreaterThan(1);
    expect(sides[0].slice(0, 5)).toEqual(['header', 'proficiency', 'legend', 'teacher-narrative', 'missing-work']);
    expect(sides[0].length).toBeGreaterThan(5);
    expect(sides[1].length).toBeGreaterThan(0);
    expect(await overflowing(page)).toEqual([]);
    // The Response docks at the foot of the report's last side.
    const pinned = student.locator('.sheet-pinned');
    await expect(pinned.locator('.report-parent-response')).toHaveCount(1);
    const docked = await pinned.evaluate(el => {
      const body = el.closest('.sheet-body').getBoundingClientRect();
      return Math.round(body.bottom - el.getBoundingClientRect().bottom);
    });
    expect(Math.abs(docked)).toBeLessThanOrEqual(1);
    await expect(pinned).toContainText('I have reviewed this report with my child');
    await expect(pinned).toContainText(
      'Please review this report with your child and return this section to the school.',
    );
    // No running footer; no Page 1 of 2.
    await expect(page.locator('.sheet-footer')).toHaveCount(0);
    // The saved form is read, never rewritten: opening writes nothing, and a
    // change writes only the model.
    const saved = () => page.evaluate(() => getReportConfig(getActiveCourse()));
    let now = await saved();
    expect('one' in now).toBe(false);
    expect(now.form).toEqual(STARTING_LAYOUT.form);
    expect(now.progressMode).toBe('build');
    await partSwitch(page, 'legend').click();
    await expect(cellOf(page, 'legend')).toHaveCount(0);
    now = await saved();
    expect(now.one.parts).not.toContain('legend');
    expect(now.form).toEqual(STARTING_LAYOUT.form);
    expect(now.progressMode).toBe('build');
    expect(now.preset).toBe('standard');
  });

  test('every student is one sheet and nothing overflows; a student in Everyone opens that student', async ({
    page,
  }) => {
    await openStudio(page);
    await showEveryone(page);
    await expect(page.locator('.sheet-overflow')).toHaveCount(0);
    const sheets = await page.locator('.sheet-student').evaluateAll(els => els.map(el => el.dataset.sheets));
    expect(sheets.every(n => n === '1')).toBe(true);
    expect(await overflowing(page)).toEqual([]);
    await page.locator('.sheet-student[data-sid="st2"]').click();
    await expect(page.locator('.report-sheet')).toHaveCount(2);
    await expect(page.locator('.report-sheet').first().locator('.report-student-name')).toHaveText('Noor Al-Rashid');
  });

  test('Lines sets the ruled room for a student with no comment', async ({ page }) => {
    await openStudio(page);
    const opts = await openOptions(page, 'teacher-narrative');
    await expect(opts.locator('.one-step-n')).toHaveText('10');
    await opts.getByRole('button', { name: 'More Lines' }).click();
    await expect(page.locator('#one-opts-teacher-narrative .one-step-n')).toHaveText('11');
    expect(await page.evaluate(() => getReportConfig(getActiveCourse()).one.lines['teacher-narrative'])).toBe(11);
    // A student with no comment: the box is the ruled lines, one more than before.
    const heights = await page.evaluate(() => {
      const cid = getActiveCourse();
      const st = getStudents(cid)[0];
      const ctx = ReportBlocks.reportContext();
      ctx.narrativeOverride = '';
      const m = ReportOne.modelFor(getReportConfig(cid));
      const boxOf = lines => {
        const div = document.createElement('div');
        div.innerHTML = ReportOne.partHtml(
          ReportOne.setOption(m, 'teacher-narrative', 'lines', lines),
          'teacher-narrative',
          cid,
          st,
          ctx,
        );
        const ruled = div.querySelector('.report-ruled-empty');
        return ruled ? parseFloat(ruled.style.height) : null;
      };
      return [boxOf(10), boxOf(11)];
    });
    expect(heights[0]).toBeGreaterThan(0);
    expect(heights[1] - heights[0]).toBeCloseTo(heights[0] / 10, 5);
    await opts.getByRole('button', { name: 'Fewer Lines' }).click();
    await expect(page.locator('#one-opts-teacher-narrative .one-step-n')).toHaveText('10');
  });

  test('the paper stays white with dark ink in dark mode; the screen around it goes dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openStudio(page);
    const sheet = page.locator('#rb-preview .report-sheet').first();
    expect(await sheet.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    for (const sel of ['.report-student-name', '.report-proficiency', '.report-comment-box']) {
      const colors = await sheet
        .locator(sel)
        .first()
        .evaluate(el => {
          const box = el.closest('.report-block-box') || el;
          return [getComputedStyle(el).color, getComputedStyle(box).backgroundColor];
        });
      expect(colors[0]).toMatch(/^rgb\((0|29), (0|29), (0|31)\)$/);
      expect(colors[1]).toMatch(/^rgb(a?)\((255, 255, 255|0, 0, 0, 0)/);
    }
    expect(await page.locator('.studio-palette').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(
      'rgb(255, 255, 255)',
    );
    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('Tab stays in the Print Reports dialog; on a phone Escape closes the Parts panel (step 4 group 3 #64)', async ({
    page,
  }) => {
    await openStudio(page);
    await page.getByRole('button', { name: 'Print Reports' }).click();
    const dialog = page.locator('#issue-overlay');
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(d => d.contains(document.activeElement))).toBe(true);
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate(d => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Parts', exact: true }).click();
    await expect(page.locator('#studio-palette')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#studio-palette')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Parts', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('Print Reports saves a copy of every report and lists it as Printed', async ({ page }) => {
    await openStudio(page);
    await page.getByRole('button', { name: 'Print Reports' }).click();
    const dialog = page.locator('#issue-overlay');
    await expect(dialog).toContainText('Print 27 Reports');
    await expect(dialog).toContainText('27 students · 1 sheet each');
    await expect(dialog).toContainText('Letter, 2-sided, flip on long edge');
    // Demo Mode has no attendance entered: said once, never blocking.
    await expect(dialog.locator('.issue-warn')).toContainText(
      'No attendance is entered for this report. Their reports print without it.',
    );
    await expect(dialog.locator('[data-issue="attendance"]')).toHaveText('Enter it now');
    await expect(dialog).not.toContainText(/Issue/);
    await expect(dialog.locator('[data-issue="go"]')).toHaveText('Print');
    await dialog.locator('[data-issue="go"]').click();
    await expect(dialog).toHaveCount(0);
    const copies = page.locator('#report-copy');
    await expect(copies).toBeVisible();
    await expect(copies.locator('option').nth(1)).toHaveText(/^Printed /);
    await copies.selectOption({ index: 1 });
    await expect(page.locator('.report-sheet')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Print This Copy' })).toBeVisible();
    await copies.selectOption({ index: 0 });
    await expect(page.getByRole('button', { name: 'Print Reports' })).toBeVisible();
  });

  test('Print This Copy in One Student view prints every student in the copy', async ({ page }) => {
    await openStudio(page);
    await page.getByRole('button', { name: 'Print Reports' }).click();
    await page.locator('#issue-overlay [data-issue="go"]').click();
    await expect(page.locator('#issue-overlay')).toHaveCount(0);
    await page.locator('#report-copy').selectOption({ index: 1 });
    await expect(page.locator('.report-sheet')).toHaveCount(2);
    // What is in the preview when the print dialog opens.
    await page.evaluate(() => {
      window.__printed = [];
      window.print = () => {
        const sids = [...document.querySelectorAll('#rb-preview .sheet-student')].map(el => el.dataset.sid);
        window.__printed.push(sids);
      };
    });
    await page.getByRole('button', { name: 'Print This Copy' }).click();
    const printed = await page.evaluate(() => window.__printed);
    expect(printed).toHaveLength(1);
    expect(new Set(printed[0]).size).toBe(STUDENTS);
    // The canvas goes back to the one student afterwards.
    await expect(page.locator('.report-sheet')).toHaveCount(2);
  });

  test('Enter it now opens the Term Questionnaire on a student with no attendance; with totals entered the note names the rest', async ({
    page,
  }) => {
    await openStudio(page);
    await page.evaluate(() => {
      const cid = getActiveCourse();
      const ctx = ReportBlocks.reportContext();
      getStudents(cid)
        .slice(1)
        .forEach(st => saveTermAttendance(cid, st.id, ctx.termId, 2, 1));
    });
    await page.locator('.studio-view [data-view="all"]').click();
    await page.locator('.studio-view [data-view="one"]').click();
    await page.getByRole('button', { name: 'Print Reports' }).click();
    const dialog = page.locator('#issue-overlay');
    await expect(dialog.locator('.issue-warn')).toContainText(
      /^Before you print.*\w+ \w+ has no attendance entered\. Their reports print without it\./,
    );
    await dialog.locator('[data-issue="attendance"]').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Term Questionnaire' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Print Reports sets the name on the reports: preferred or first, always the last name', async ({ page }) => {
    await openStudio(page);
    await showEveryone(page);
    const jas = page.locator('.report-student-name', { hasText: 'Gill' });
    await expect(jas.first()).toHaveText('Jas Gill');
    await page.getByRole('button', { name: 'Print Reports' }).click();
    const dialog = page.locator('#issue-overlay');
    await expect(dialog.getByRole('group', { name: 'Name' })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /Preferred Name/ })).toBeChecked();
    await dialog.getByRole('radio', { name: 'First Name', exact: true }).check();
    await expect(jas.first()).toHaveText('Jasper Gill');
    // Cancel and Escape change nothing: the class keeps the name it had
    // (step 4 group 2 #6).
    await dialog.locator('[data-issue="cancel"]').click();
    await expect(dialog).toHaveCount(0);
    await expect(jas.first()).toHaveText('Jas Gill');
    await page.getByRole('button', { name: 'Print Reports' }).click();
    await expect(dialog.getByRole('radio', { name: /Preferred Name/ })).toBeChecked();
    await dialog.getByRole('radio', { name: 'First Name', exact: true }).check();
    await expect(jas.first()).toHaveText('Jasper Gill');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(jas.first()).toHaveText('Jas Gill');
    await page.getByRole('button', { name: 'Print Reports' }).click();
    await expect(dialog.getByRole('radio', { name: /Preferred Name/ })).toBeChecked();
  });

  test('a long comment typed on the questionnaire continues on the printed report, nothing is cut', async ({
    page,
  }) => {
    // The questionnaire shows the comment's character count; the comment
    // box takes the overflow onto the next side, and that is what is
    // checked here.
    await openStudio(page);
    await page.locator('.report-seg-btn[data-tab="questionnaire"]').click();
    const editor = page.locator('#tq-narrative');
    await editor.click();
    await page.keyboard.press('End');
    for (let i = 0; i < 12; i++)
      await page.keyboard.type(
        ' She keeps asking questions that move the whole class forward and writes it all down with care.',
      );
    await expect(page.locator('#tq-count')).toHaveText(/^\d{4} characters$/);
    await page.locator('.report-seg-btn[data-tab="progress"]').click();
    await expect(page.locator('.report-sheet').first()).toBeVisible();
    expect(await overflowing(page)).toEqual([]);
  });

  test('on a phone the pages fit the width and the panel opens from a button; at 1100 wide Print Reports is on screen', async ({
    page,
  }) => {
    await openStudio(page);
    await page.setViewportSize({ width: 1100, height: 800 });
    const right = await page.locator('#tb-print-btn').evaluate(el => el.getBoundingClientRect().right);
    expect(right).toBeLessThanOrEqual(1100);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const box = await page.locator('.report-sheet').first().boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
    await expect(page.locator('#studio-palette')).toBeHidden();
    await page.getByRole('button', { name: 'Parts', exact: true }).click();
    await expect(page.locator('#studio-palette')).toBeVisible();
    await page.getByRole('button', { name: 'Parts', exact: true }).click();
    await expect(page.locator('#studio-palette')).toBeHidden();
  });

  test('turning Assessed Count off takes the column off and keeps the choice focused', async ({ page }) => {
    await openStudio(page);
    await expect(page.locator('.report-sheet .report-prof thead th')).toHaveCount(5);
    const opts = await openOptions(page, 'proficiency');
    const chip = opts.getByRole('button', { name: 'Assessed Count' });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await chip.click();
    await expect(page.locator('.report-sheet .report-prof thead th')).toHaveCount(4);
    const again = page.locator('#one-opts-proficiency').getByRole('button', { name: 'Assessed Count' });
    await expect(again).toHaveAttribute('aria-pressed', 'false');
    await expect(again).toBeFocused();
  });

  /* Rows (As Graded, Each Folder, Each Competency) is a long choice; its
     buttons once squeezed onto one line and overlapped, then (in One
     Report's panel) were narrower than their labels. They wrap onto two
     lines instead. */
  test("Proficiency's choices in the panel do not overlap at 1440, 1280 and 1024 wide", async ({ page }) => {
    await openStudio(page);
    // A fresh Report Card: one Rows choice is shown as chosen, As Graded.
    await applySetup(page, 'report-card');
    const rows = (await openOptions(page, 'proficiency')).getByRole('radiogroup', { name: 'Rows' });
    await expect(rows.locator('[role="radio"][aria-checked="true"]')).toHaveCount(1);
    await expect(rows.getByRole('radio', { name: 'As Graded' })).toHaveAttribute('aria-checked', 'true');
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [1024, 768],
    ]) {
      await page.setViewportSize({ width, height });
      const opts = await openOptions(page, 'proficiency');
      await expect(opts.getByRole('radiogroup', { name: 'Rows' }).getByRole('radio')).toHaveCount(3);
      const problems = await opts.locator('.seg').evaluateAll(segs =>
        segs.flatMap(seg => {
          const track = seg.getBoundingClientRect();
          const btns = [...seg.querySelectorAll('.seg-btn')];
          return btns.flatMap((btn, i) => {
            const box = btn.getBoundingClientRect();
            const name = (seg.getAttribute('aria-labelledby') || '') + ' ' + btn.textContent;
            const out = [];
            if (btn.scrollWidth > btn.clientWidth + 1) out.push(name + ' is cut off');
            if (box.left < track.left - 0.5 || box.right > track.right + 0.5) out.push(name + ' leaves the track');
            btns.slice(i + 1).forEach(other => {
              const o = other.getBoundingClientRect();
              const overlap = box.left < o.right - 0.5 && o.left < box.right - 0.5;
              const sameLine = box.top < o.bottom - 0.5 && o.top < box.bottom - 0.5;
              if (overlap && sameLine) out.push(name + ' overlaps ' + other.textContent);
            });
            return out;
          });
        }),
      );
      expect(problems, width + ' wide').toEqual([]);
    }
  });

  test('Your Own Text prints what the teacher writes', async ({ page }) => {
    await openStudio(page);
    await openAddList(page);
    await partSwitch(page, 'text-block').click();
    await expect(partSwitch(page, 'text-block')).toHaveAttribute('aria-checked', 'true');
    const opts = await openOptions(page, 'text-block');
    await opts.getByLabel('Heading').fill('Science Fair');
    await opts.getByLabel('Heading').blur();
    await page
      .locator('#one-opts-text-block')
      .getByLabel('Text')
      .fill('Projects are due Nov 30.\nBring a tri-fold board.');
    await page.locator('#one-opts-text-block').getByLabel('Text').blur();
    await expect(cellOf(page, 'text-block')).toContainText('Science Fair');
    await expect(cellOf(page, 'text-block')).toContainText('Bring a tri-fold board.');
    expect(await overflowing(page)).toEqual([]);
  });
});

test.describe('Assignment Grades', () => {
  test.setTimeout(120_000);

  test('Assignment Grades starts in one column, a heading per month, year to date', async ({ page }) => {
    await openGrade(page);
    await page.evaluate(() =>
      saveReportConfig(getActiveCourse(), {
        ...getReportConfig(getActiveCourse()),
        one: ReportOne.normalize({ parts: ['header', 'grade-table'], feedback: {} }),
      }),
    );
    await page.evaluate(r => window.Router.navigate(r), '/dashboard');
    await page.evaluate(r => window.Router.navigate(r), '/reports');
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    const opts = await openOptions(page, 'grade-table');
    await expect(opts.getByRole('radiogroup', { name: 'Per Competency' })).toHaveCount(0);
    for (const [group, choice] of [
      ['Columns', 'One'],
      ['Organize By', 'Date'],
      ['Range', 'Year to Date'],
    ]) {
      await expect(opts.getByRole('radiogroup', { name: group }).getByRole('radio', { name: choice })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    }
    const table = page.locator('#rb-preview .report-grades').first();
    await expect(table.locator('.report-prof-meta')).toContainText('Year to date ·');
    await expect(table.locator('.report-grades-cols')).toHaveCount(0);
    await expect(table).toContainText('October');
  });
});

test.describe('The Quick Report’s choices, read as parts', () => {
  test.setTimeout(120_000);

  test('a new class prints a list of this term, one sheet each, two Letter pages per student', async ({ page }) => {
    await openGrade(page);
    const sheet = page.locator('#rb-preview .report-sheet').first();
    await expect(sheet.locator('.report-student-name')).toHaveText(/\w+ \w+/);
    // One Report heads the title column Assessment (it was Assignment).
    await expect(sheet.locator('.gr-head').first()).toContainText('Assessment');
    await expect(sheet.locator('.gr-head').first()).not.toContainText('Assignment');
    // Demo's Science 8 is a Proficiency class: one Result column, no Score
    // or Out Of, and the last line is Overall Proficiency (Colin, 2026-11-12).
    await expect(sheet.locator('.gr-head').first()).toContainText('Result');
    await expect(sheet.locator('.gr-head').first()).not.toContainText('Out Of');
    await expect(page.locator('#rb-preview .gr-term')).toContainText('Overall Proficiency');
    // Grades only: no comment, attendance or other feedback on the sheet.
    await expect(page.locator('#rb-preview .report-comment-box, #rb-preview .report-attendance')).toHaveCount(0);
    await expect(page.locator('#rb-preview .fb-sheet')).toHaveCount(0);
    // The list's choices: Numbers off, Work Not Yet Assessed on.
    const opts = await openOptions(page, 'assessments');
    await expect(opts.getByRole('button', { name: 'Numbers' })).toHaveAttribute('aria-pressed', 'false');
    await expect(sheet.locator('.gr-head').first()).not.toContainText('#');
    await expect(opts.getByRole('button', { name: 'Work Not Yet Assessed' })).toHaveAttribute('aria-pressed', 'true');
    // No Proficiency column, nothing cut off in a row.
    await expect(sheet.locator('.gr-head').first()).not.toContainText('Proficiency');
    const cut = await page
      .locator('#rb-preview .gr-row:not(.gr-head) .gr-c')
      .evaluateAll(cells => cells.filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.textContent));
    expect(cut).toEqual([]);
    // The panel's buttons stay inside it and show their whole labels, once
    // the options have opened. An open part's chevron is turned a quarter
    // turn, which counts as overflow without cutting a word: it is measured
    // unturned.
    const spill = () =>
      page.locator('#studio-palette').evaluate(pal => {
        const edge = pal.getBoundingClientRect().right - parseFloat(getComputedStyle(pal).paddingRight);
        const chevs = [...pal.querySelectorAll('.one-chev')];
        chevs.forEach(c => {
          c.style.transition = 'none';
          c.style.transform = 'none';
        });
        const out = [...pal.querySelectorAll('button, label')]
          .filter(
            b => b.offsetParent && (b.getBoundingClientRect().right > edge + 0.5 || b.scrollWidth > b.clientWidth + 1),
          )
          .map(b => b.textContent.trim());
        chevs.forEach(c => {
          c.style.transform = '';
          c.style.transition = '';
        });
        return out;
      });
    await expect.poll(spill).toEqual([]);
    await showEveryone(page);
    expect(await page.locator('.sheet-student[data-sheets="1"]').count()).toBe(STUDENTS);
    expect(await overflowing(page)).toEqual([]);
    const pdf = await printToPdf(page);
    expect(countPages(pdf)).toBe(STUDENTS * 2);
  });

  test('Numbers adds a # column and numbers the rows 1, 2, 3', async ({ page }) => {
    await openGrade(page);
    await expect(page.locator('#rb-preview .gr-n')).toHaveCount(0);
    const opts = await openOptions(page, 'assessments');
    await opts.getByRole('button', { name: 'Numbers' }).click();
    const sheet = page.locator('#rb-preview .report-sheet').first();
    await expect(sheet.locator('.gr-head .gr-n').first()).toHaveText('#');
    const nums = await sheet.locator('.gr-row:not(.gr-head) .gr-n').allTextContents();
    expect(nums.length).toBeGreaterThan(3);
    expect(nums.slice(0, 3)).toEqual(['1', '2', '3']);
    const cut = await page
      .locator('#rb-preview .gr-row:not(.gr-head) .gr-c')
      .evaluateAll(cells => cells.filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.textContent));
    expect(cut).toEqual([]);
    // Still two Letter pages per student, nothing overflowing.
    await showEveryone(page);
    expect(await overflowing(page)).toEqual([]);
    expect(countPages(await printToPdf(page))).toBe(STUDENTS * 2);
  });

  test('the Feedback Pages switches: off for a new class, the cards follow the report, the choices persist', async ({
    page,
  }) => {
    await openGrade(page);
    for (const key of ['fb-rubrics', 'fb-comments', 'fb-observations'])
      await expect(partSwitch(page, key)).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('.fb-sheet')).toHaveCount(0);

    await partSwitch(page, 'fb-rubrics').click();
    await partSwitch(page, 'fb-comments').click();
    const student = page.locator('.sheet-student').first();
    await expect(student.locator('.fb-sheet').first()).toBeVisible();
    // The cards come after the report.
    const kinds = await sideKinds(student);
    expect(kinds[0]).toBe('report');
    expect(kinds).toContain('feedback');
    await expect(page.locator('#studio-fit')).toContainText('sheets for');
    await expect(page.locator('.fb-rb').first()).toBeVisible();

    // Rubrics off takes the rubric tables off.
    await partSwitch(page, 'fb-rubrics').click();
    await expect(page.locator('.fb-rb')).toHaveCount(0);

    // The choices stay after a reload.
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(partSwitch(page, 'fb-rubrics')).toHaveAttribute('aria-checked', 'false');
    await expect(partSwitch(page, 'fb-comments')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.fb-sheet').first()).toBeVisible();
    await expect(page.locator('.fb-rb')).toHaveCount(0);
    // Rubrics back on: the cards with their tables are back.
    await partSwitch(page, 'fb-rubrics').click();
    await expect(page.locator('.fb-rb').first()).toBeVisible();

    // Every Feedback Page off: the cards go.
    await partSwitch(page, 'fb-rubrics').click();
    await partSwitch(page, 'fb-comments').click();
    await expect(page.locator('.fb-sheet')).toHaveCount(0);
  });

  test('Observations adds a card after the assessments, only where the student has some', async ({ page }) => {
    await openFeedback(page);
    await showAllStudents(page);
    const titles = () =>
      page.locator('.sheet-student').evaluateAll(list =>
        list.map(st => ({
          sid: st.dataset.sid,
          titles: [...st.querySelectorAll('.fb-card .fb-title')].map(t => t.textContent),
        })),
      );
    // Off by default: no such cards.
    expect((await titles()).flatMap(s => s.titles).filter(t => /^Observations/.test(t))).toEqual([]);

    const expected = await page.evaluate(() => {
      const cid = getActiveCourse();
      const termId = ReportBlocks.reportContext().termId;
      return getStudents(cid).map(st => ({
        sid: st.id,
        obs: ReportFeedback.observations(cid, st, termId).map(o => o.text),
      }));
    });
    expect(expected.some(e => e.obs.length)).toBe(true);

    await partSwitch(page, 'fb-observations').click();
    await expect(page.locator('.fb-card.fb-observations').first()).toBeVisible();
    const now = await titles();
    for (const e of expected) {
      const mine = now.find(s => s.sid === e.sid).titles;
      const o = mine.filter(t => t.startsWith('Observations'));
      expect(o.length > 0, e.sid).toBe(e.obs.length > 0);
      // After the assessments.
      if (o.length) expect(mine.indexOf(o[0])).toBe(mine.length - o.length);
    }
    // The card lists the student's observations with date, text and tags.
    const withObs = expected.find(e => e.obs.length);
    const card = page.locator(`.sheet-student[data-sid="${withObs.sid}"] .fb-card.fb-observations`).first();
    await expect(card.locator('.fb-obs')).not.toHaveCount(0);
    await expect(card.locator('.fb-obs b').first()).toHaveText(/^[A-Z][a-z]{2} \d{1,2}$/);
    await expect(card).toContainText(withObs.obs[0].slice(0, 40));
    expect(await cardSpill(page)).toEqual([]);
    expect(await overflowing(page)).toEqual([]);
  });

  test('a class saved with Term Comment on its Feedback Pages prints the Teacher Comment part and no Term Comment card', async ({
    page,
  }) => {
    await openGrade(page);
    await page.evaluate(() => {
      const cid = getActiveCourse();
      const c = getReportConfig(cid) || {};
      saveReportConfig(cid, { ...c, gradeReport: { ...(c.gradeReport || {}), feedback: true, termComment: true } });
    });
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await showAllStudents(page);
    const withTerm = await page.evaluate(() => {
      const cid = getActiveCourse();
      const termId = ReportBlocks.reportContext().termId;
      const st = getStudents(cid).find(s => ReportFeedback.termComment(cid, s, termId));
      return { sid: st.id, term: ReportFeedback.termComment(cid, st, termId) };
    });
    // The comment prints on the report itself.
    await expect(
      page.locator(`.sheet-student[data-sid="${withTerm.sid}"] .sheet-cell[data-part="teacher-narrative"]`).first(),
    ).toContainText(withTerm.term.split('\n')[0].slice(0, 40));
    expect(
      await page.evaluate(
        () => getReportConfig(getActiveCourse()) && ReportOne.modelFor(getReportConfig(getActiveCourse())).parts,
      ),
    ).toContain('teacher-narrative');
    // The Feedback Pages print, with no Term Comment card for anyone.
    await expect(page.locator('.fb-sheet').first()).toBeVisible();
    await expect(page.locator('.fb-card.fb-term')).toHaveCount(0);
    const titles = await page.locator('.fb-card .fb-title').allTextContents();
    expect(titles.filter(t => t.startsWith('Term Comment'))).toEqual([]);
  });

  test('a long Observations card splits between entries, its title repeated with (continued)', async ({ page }) => {
    await openFeedback(page);
    await showAllStudents(page);
    // A student with observations gets forty entries.
    await page.evaluate(() => {
      const orig = ReportFeedback.observations;
      ReportFeedback.observations = (cid, st, termId) =>
        orig(cid, st, termId).length
          ? Array.from({ length: 40 }, (_, i) => ({
              id: 'x' + i,
              date: 'Oct ' + ((i % 28) + 1),
              dateIso: '',
              text: 'Entry ' + i + ': works with others, explains the steps and checks the result before moving on.',
              tags: ['Collaboration'],
            }))
          : [];
    });
    await partSwitch(page, 'fb-observations').click();
    await expect(page.locator('.fb-card.fb-observations').first()).toBeVisible();
    const titles = await page.locator('.fb-card.fb-observations .fb-title').allTextContents();
    expect(titles.length).toBeGreaterThan(1);
    const per = await page.locator('.sheet-student').evaluateAll(list =>
      list
        .map(st => ({
          titles: [...st.querySelectorAll('.fb-card.fb-observations .fb-title')].map(t => t.textContent),
          entries: st.querySelectorAll('.fb-card.fb-observations .fb-obs').length,
        }))
        .filter(x => x.titles.length),
    );
    expect(per.some(x => x.titles.length > 1)).toBe(true);
    for (const x of per) {
      expect(x.titles[0]).toBe('Observations');
      expect(x.titles.slice(1).every(t => t === 'Observations (continued)')).toBe(true);
      // Every entry prints once across the pieces.
      expect(x.entries).toBe(40);
    }
    expect(await cardSpill(page)).toEqual([]);
    expect(await overflowing(page)).toEqual([]);
  });

  test('the print dialog counts every student by their sheets with Feedback Pages on', async ({ page }) => {
    await openFeedback(page);
    await page.getByRole('button', { name: 'Print Reports' }).click();
    const dialog = page.locator('.issue-card');
    // Every student's own sheet count, as the class is laid out.
    await page.locator('.studio-view [data-view="all"]').evaluate(el => el.click());
    await expect(page.locator('.sheet-student')).toHaveCount(STUDENTS);
    const counts = await page.locator('.sheet-student').evaluateAll(list => list.map(el => Number(el.dataset.sheets)));
    expect(counts).toHaveLength(27);
    if (new Set(counts).size === 1) await expect(dialog).toContainText(`27 students · ${counts[0]} sheets each`);
    else {
      // "23 on 2, 4 on 3": how many students on each sheet count, fewest sheets first.
      const by = {};
      counts.forEach(n => (by[n] = (by[n] || 0) + 1));
      const line = Object.keys(by)
        .map(Number)
        .sort((x, y) => x - y)
        .map(k => by[k] + ' on ' + k + (k === 1 ? ' sheet' : ''))
        .join(', ');
      await expect(dialog).toContainText('27 students · ' + line);
    }
    await expect(dialog).not.toContainText('1 sheet each');
  });

  test('Feedback Pages follow the report: a numbered card per assessment, two columns, page numbers', async ({
    page,
  }) => {
    await openFeedback(page);
    const student = page.locator('.sheet-student').first();
    const kinds = await sideKinds(student);
    // The report first; the feedback starts on its back when it has only a
    // front, else on the next side; an odd last side is left blank.
    const report = kinds.filter(k => k === 'report').length;
    expect(kinds[0]).toBe('report');
    expect(kinds.indexOf('feedback')).toBe(report);
    expect(kinds.slice(report).every((k, i, a) => k === 'feedback' || (k === 'blank' && i === a.length - 1))).toBe(
      true,
    );
    expect(kinds.length % 2).toBe(0);
    const pages = kinds.filter(k => k !== 'blank').length;
    const sheets = kinds.length / 2;
    expect(sheets).toBeGreaterThan(1);
    await expect(student).toHaveAttribute('data-sheets', String(sheets));
    await expect(student.locator('.sheet-badge')).toHaveText(sheets + ' sheets');
    await expect(page.locator('#studio-fit')).toContainText('sheets for');

    // The head: the name, the class, block and term, and Page X of Y.
    const first = student.locator('.fb-sheet').first();
    await expect(first.locator('.fb-page-name')).toHaveText(/\w+ \w+/);
    await expect(first.locator('.fb-page-meta')).toContainText('Science 8 · Block A');
    await expect(first.locator('.fb-page-n')).toHaveText(`Page ${report + 1} of ${pages}`);
    await expect(student.locator('.fb-sheet').last().locator('.fb-page-n')).toHaveText(`Page ${pages} of ${pages}`);
    // Two columns 352px wide, 16px apart.
    const cols = await first.locator('.fb-col').evaluateAll(list => list.map(c => c.getBoundingClientRect()));
    expect(cols).toHaveLength(2);
    const k = await first.evaluate(s => s.getBoundingClientRect().width / s.offsetWidth);
    expect(Math.round(cols[0].width / k)).toBe(352);
    expect(Math.round((cols[1].left - cols[0].right) / k)).toBe(16);

    // Each card's number is its row in the Assessments list.
    const rows = await student
      .locator('.sheet-cell[data-part="assessments"] .gr-table .gr-row:not(.gr-head)')
      .evaluateAll(list =>
        Object.fromEntries(
          list.map(r => [r.querySelector('.gr-n')?.textContent || '', r.querySelector('.gr-title').textContent]),
        ),
      );
    const cards = await student
      .locator('.fb-card')
      .evaluateAll(list =>
        list.map(c => [c.querySelector('.fb-num')?.textContent || '', c.querySelector('.fb-title').textContent]),
      );
    expect(cards.length).toBeGreaterThan(3);
    for (const [n, title] of cards) {
      expect(n).not.toBe('');
      expect(rows[n]).toBe(title.replace(/ \(continued\)$/, ''));
    }
    // In the list's order.
    const order = cards.map(([n]) => Number(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test('a rubric taller than a column splits between criterion rows, its title and level headings repeated', async ({
    page,
  }) => {
    await openFeedback(page);
    // Demo Mode's rubrics all fit a column: give every student one with
    // fifteen criteria, each with a comment under it.
    await page.evaluate(() => {
      const forStudent = ReportFeedback.forStudent;
      ReportFeedback.forStudent = (cid, st, opts) => {
        const list = forStudent(cid, st, opts);
        const base = list.find(it => it.rubric && it.rubric.rows.length);
        if (!base) return list;
        const rows = Array.from({ length: 15 }, (_, i) => ({
          ...base.rubric.rows[i % base.rubric.rows.length],
          name: 'Criterion ' + (i + 1),
          comment: 'Comment for criterion ' + (i + 1) + '. Checked each step and wrote the result down clearly.',
        }));
        return [...list, { ...base, id: 'tall', title: 'Tall Rubric', rubric: { ...base.rubric, rows } }];
      };
    });
    // Redraw: Observations on and off.
    await partSwitch(page, 'fb-observations').click();
    await partSwitch(page, 'fb-observations').click();
    const student = page.locator('.sheet-student').first();
    await expect(student.locator('.fb-title', { hasText: 'Tall Rubric' }).first()).toBeVisible();
    const pieces = await student.locator('.fb-card').evaluateAll(cards =>
      cards
        .filter(c => /^Tall Rubric/.test(c.querySelector('.fb-title').textContent))
        .map(c => ({
          title: c.querySelector('.fb-title').textContent,
          head: c.querySelectorAll('.fb-rb thead th').length,
          crit: [...c.querySelectorAll('.fb-rb tbody .fb-crit')].map(th => th.textContent),
          comments: [...c.querySelectorAll('.fb-rb tbody tr')].map(tr => (tr.classList.contains('fb-cm') ? 'c' : 'r')),
          feedback: c.querySelectorAll('.fb-feedback').length,
        })),
    );
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces[0].title).toBe('Tall Rubric');
    for (const p of pieces.slice(1)) expect(p.title).toBe('Tall Rubric (continued)');
    for (const p of pieces) {
      expect(p.head).toBe(pieces[0].head);
      // Every criterion row has its comment right under it, in the same piece.
      expect(p.comments.join('')).toBe('rc'.repeat(p.crit.length));
    }
    expect(pieces.flatMap(p => p.crit)).toEqual(Array.from({ length: 15 }, (_, i) => 'Criterion ' + (i + 1)));
    expect(pieces.slice(0, -1).every(p => p.feedback === 0)).toBe(true);
    expect(await cardSpill(page)).toEqual([]);
    expect(await overflowing(page)).toEqual([]);
  });

  for (const paper of ['Letter', 'Legal']) {
    test(`Feedback Pages on ${paper}: nothing overflows, no word breaks, two pages per sheet in print`, async ({
      page,
    }) => {
      await openFeedback(page);
      if (paper === 'Legal') {
        await page.getByRole('radio', { name: 'Legal' }).click();
        await expect(page.locator('.report-sheet[data-paper="legal"]').first()).toBeVisible();
      }
      await page.locator('.studio-view [data-view="all"]').click();
      await expect(page.locator('.sheet-student')).toHaveCount(STUDENTS);
      const sheets = await totalSheets(page);
      expect(sheets).toBeGreaterThan(STUDENTS);
      await expect(page.locator('.report-sheet')).toHaveCount(sheets * 2);
      expect(await overflowing(page)).toEqual([]);
      await page.emulateMedia({ media: 'print' });
      expect(await cardSpill(page)).toEqual([]);
      expect(await brokenWords(page)).toEqual([]);
      await page.emulateMedia({ media: 'screen' });
      const pdf = await printToPdf(page);
      expect(countPages(pdf)).toBe(sheets * 2);
      const box = paper === 'Legal' ? [612, 1008] : [612, 792];
      for (const b of pageBoxes(pdf)) expect(b).toEqual(box);
    });
  }

  test('Categories off takes the summary off, and the choice is remembered', async ({ page }) => {
    await openGrade(page);
    await expect(page.locator('#rb-preview .gr-summary')).toHaveCount(1);
    await partSwitch(page, 'category-summary').click();
    await expect(page.locator('#rb-preview .gr-summary')).toHaveCount(0);
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(partSwitch(page, 'category-summary')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#rb-preview .gr-summary')).toHaveCount(0);
  });
});

test.describe('Printed progress reports', () => {
  test.setTimeout(120_000);

  test('the Report Card prints two Letter pages per student', async ({ page }) => {
    await openStudio(page);
    await showEveryone(page);
    const pdf = await printToPdf(page);
    expect(countPages(pdf)).toBe(STUDENTS * 2);
    for (const [w, h] of pageBoxes(pdf)) {
      expect([w, h]).toEqual([612, 792]);
    }
  });

  test('the Interim Update prints one side per student, with its back left blank for duplex', async ({ page }) => {
    await openStudio(page);
    await applySetup(page, 'interim-update');
    await showEveryone(page);
    expect(countPages(await printToPdf(page))).toBe(STUDENTS * 2);
    await expect(page.locator('.report-sheet .report-legend')).toHaveCount(STUDENTS);
    // The "left blank" note is a screen hint only; the printed back is empty.
    const note = page.locator('.sheet-blank').first();
    await expect(note).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(note).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
  });

  test('the letterhead names the class, block, report, term dates and student number; no footer', async ({ page }) => {
    await openStudio(page);
    const header = page.locator('.report-sheet').first().locator('.report-header');
    await expect(header.locator('.report-course-title')).toHaveText(/^Science 8 · Block A · .+/);
    await expect(header.locator('.report-student-name')).toHaveText(/\w+ \w+/);
    await expect(header.locator('.report-course-title')).toContainText(
      await page.locator('#report-period option:checked').innerText(),
    );
    const meta = header.locator('.report-header-meta');
    await expect(meta).toContainText(/Term\w{3} \d{1,2}(, \d{4})? – \w{3} \d{1,2}, \d{4}/);
    await expect(meta).toContainText(/Student No\.STU-\d+/);
    await expect(page.locator('.sheet-footer')).toHaveCount(0);
    // The letterhead sits near the top: 24px of padding.
    const top = await page
      .locator('.report-sheet')
      .first()
      .locator('.sheet-body')
      .evaluate(el => el.offsetTop);
    expect(Math.round(top)).toBe(24);
  });

  // Group 3 #62: reports print black and white, so the screen shows the
  // levels black as they print, and there is no Ink choice.
  test('levels print as their proficiency, in black, with no dots, and the screen shows them black too', async ({
    page,
  }) => {
    await openStudio(page);
    const level = page.locator('#rb-preview .report-prof td.report-prof-n').first();
    expect(await level.evaluate(el => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
    await expect(page.locator('#report-ink')).toHaveCount(0);
    await expect(page.locator('.studio-head')).not.toContainText('Ink');
    // A Proficiency class prints the proficiency, no figure out of 4 (DECISIONS, "Student-facing levels are proficiencies").
    await expect(level).toContainText(/^(Emerging|Developing|Proficient|Extending)$/);
    await expect(page.locator('#rb-preview .report-proficiency').first()).not.toContainText(/[●○]/);
    await expect(page.locator('#rb-preview .report-legend').first()).not.toContainText(/[●○]/);
    await expect(page.locator('#rb-preview .report-legend')).toContainText('BC Proficiency Scale');
    await expect(page.locator('#rb-preview .report-legend')).not.toContainText(/out of 4|\d · Emerging/);
    await page.emulateMedia({ media: 'print' });
    expect(await level.evaluate(el => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
    await page.emulateMedia({ media: 'screen' });
  });

  test('Legal gives the same rows a taller side, prints a 14 in page and is remembered for the class on this device', async ({
    page,
  }) => {
    await openStudio(page);
    const pinnedTop = () =>
      page.locator('#rb-preview .sheet-zoom[data-side="1"] .sheet-pinned').evaluate(el => {
        // In sheet px: the canvas scales the pages to fit beside the panel.
        const zoom = parseFloat(getComputedStyle(el.closest('.sheet-zoom')).getPropertyValue('--sheet-zoom')) || 1;
        return Math.round(
          (el.getBoundingClientRect().top - el.closest('.sheet-body').getBoundingClientRect().top) / zoom,
        );
      });
    const letter = await pinnedTop();
    const front = await rowsOf(page, 0);
    await page.getByRole('radio', { name: 'Legal' }).click();
    await expect(page.locator('#rb-preview .report-sheet[data-paper="legal"]')).toHaveCount(2);
    // 3in more paper (288 sheet px), less the margins the body keeps.
    expect((await pinnedTop()) - letter).toBeGreaterThan(270);
    expect(await rowsOf(page, 0)).toEqual(front);
    await showEveryone(page);
    const pdf = await printToPdf(page);
    const boxes = pageBoxes(pdf);
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box).toEqual([612, 1008]);
    expect(countPages(pdf)).toBeLessThanOrEqual(STUDENTS * 2);

    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.getByRole('radio', { name: 'Legal' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Letter' }).click();
    for (const box of pageBoxes(await printToPdf(page))) expect(box).toEqual([612, 792]);
  });

  test('Work Habits prints the six habits from the questionnaire; an unrated class prints none', async ({ page }) => {
    await openStudio(page);
    await applySetup(page, 'conference-pack');
    await page.locator('.studio-view [data-view="all"]').click();
    await expect(page.locator('.report-sheet').first()).toBeVisible();
    // The Demo class has the old nine dispositions on this device and no habits: nothing prints.
    await expect(page.locator('.report-sheet .report-learner-profile')).toHaveCount(0);
    await page.evaluate(() =>
      upsertTermRating(getActiveCourse(), 'st1', ReportBlocks.getTermId(), {
        habits: { completes: 4, part: 2, ready: 5 },
      }),
    );
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await page.locator('.studio-view [data-view="all"]').click();
    await expect(page.locator('.report-sheet').first()).toBeVisible();
    const block = page.locator('.report-sheet .report-learner-profile');
    await expect(block).toHaveCount(1);
    await expect(block.locator('.report-disp-row')).toHaveText([
      /Completes Work\s*Consistently/,
      /Takes Part\s*Sometimes/,
    ]);
    await expect(block).not.toContainText('Not Seen');
  });

  test('a dimension the teacher did not rate is left off the printed report', async ({ page }) => {
    await openStudio(page);
    await expect(page.locator('#rb-preview')).not.toContainText('Not Assessed');
  });
});
