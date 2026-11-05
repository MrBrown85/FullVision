import { test, expect } from '@playwright/test';

/* Import Roster explains the file before the picker opens, and the roster's
   proficiency codes have a key and tooltips. Demo Mode. */

async function enterDemo(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function openStudents(page) {
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Students/ }).click();
}

test('Import Roster shows the file format, a template and Choose File', async ({ page }) => {
  await enterDemo(page);
  await openStudents(page);
  await page.locator('[data-action="cmImportRoster"]').click();
  const panel = page.getByRole('region', { name: 'Import Roster' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('The file is a CSV file with a header row and one row per student.');
  await expect(panel.getByRole('link', { name: 'Download Template' })).toHaveAttribute('href', '/roster-template.csv');
  await expect(panel.getByRole('button', { name: 'Choose File' })).toBeFocused();

  // Every column the panel names is one the reader takes.
  const text = await panel.innerText();
  const names = [];
  for (const line of text.split('\n')) {
    const m = /^(Name|Other) columns: (.*)\.$/.exec(line.trim());
    if (!m) continue;
    m[2]
      .replace(/\s*\([^)]*\)/g, '')
      .split(/, (?:or )?| and /)
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(n => names.push(n));
  }
  expect(names).toEqual([
    'Last Name',
    'First Name',
    'Full Name',
    'Preferred Name',
    'Pronouns',
    'Student Number',
    'Date of Birth',
    'Student Email',
    'Parent Email',
    'Parent Email 2',
    'Designations',
    'ELL',
  ]);
  const map = await page.evaluate(h => DashClassManager.rosterImportTable(h.join(',') + '\nx').map, names);
  expect(map.every(Boolean)).toBe(true);
  for (const myEd of ['Legal Surname', 'Pupil #']) {
    expect(text).toContain(myEd);
    expect(await page.evaluate(h => DashClassManager.rosterImportTable(h + '\nx').map[0], myEd)).not.toBe('');
  }

  // The template the link downloads is read in full.
  const csv = await page.evaluate(() => fetch('/roster-template.csv').then(r => r.text()));
  const tmap = await page.evaluate(t => DashClassManager.rosterImportTable(t).map, csv);
  expect(tmap.every(Boolean)).toBe(true);

  // Choose File opens the picker; the review then takes the panel's place.
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Choose File' }).click();
  await (await chooser).setFiles({ name: 'roster.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('.cm-import-review')).toBeVisible();
  await expect(panel).toHaveCount(0);
});

test('Cancel closes the format panel and returns focus to Import Roster', async ({ page }) => {
  await enterDemo(page);
  await openStudents(page);
  await page.locator('[data-action="cmImportRoster"]').click();
  const panel = page.getByRole('region', { name: 'Import Roster' });
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('[data-action="cmImportRoster"]')).toBeFocused();
});

test('The roster has a key for its codes, and each code a tooltip', async ({ page }) => {
  await enterDemo(page);
  const legend = page.locator('#gb-roster-legend');
  await expect(legend).toBeVisible();
  await expect(legend).toHaveText('EXTExtendingPRFProficientDEVDevelopingEMGEmergingIEInsufficient Evidence');
  const titles = await page
    .locator('#gb-roster-list .student-row-prof')
    .evaluateAll(els => [...new Set(els.map(e => e.textContent + '=' + e.title))]);
  const names = {
    EXT: 'Extending',
    PRF: 'Proficient',
    DEV: 'Developing',
    EMG: 'Emerging',
    IE: 'Insufficient Evidence',
  };
  expect(titles.length).toBeGreaterThan(0);
  for (const t of titles) {
    const [code, title] = t.split('=');
    if (names[code]) expect(title).toBe(names[code]);
  }
  // Show: None hides the codes, and the key with them.
  await page.locator('#sb-show-btn').click();
  await page.locator('#sb-show-menu [role="menuitemradio"]', { hasText: 'None' }).click();
  await expect(legend).toBeHidden();
});
