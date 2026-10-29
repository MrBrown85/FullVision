import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, gotoApp, TEST_COURSE } from './helpers.js';

/* One capture strip on every surface (docs/DECISIONS.md, "Observations
   (2026-10-18)"). A comment captured from the Assignments popover is a full
   observation: it shows on the Observations page with its type, tags and
   assessment. */

async function storedObs(page) {
  return page.evaluate(cid => {
    const all = JSON.parse(localStorage.getItem('gb-quick-obs-' + cid) || '{}');
    return Object.values(all).flat();
  }, TEST_COURSE.id);
}

test.describe('Observation capture strip', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page);
  });

  test('a comment from the Assignments popover shows on the Observations page with its type and tags', async ({
    page,
  }) => {
    await gotoApp(page, '/assignments?open=assess-001');
    await page.locator('.comment-btn[data-sid="stu-001"]').first().click();

    const pop = page.locator('#comment-popover-overlay .comment-popover');
    await expect(pop).toBeVisible();
    // Student and assessment are fixed by the popover.
    await expect(pop.locator('.obsc-chip-student')).toContainText('Alice');
    await expect(pop.locator('.obsc-chip-assessment')).toContainText('Lab Report 1');
    await expect(pop.locator('#asg-student-btn')).toHaveCount(0);

    await pop.getByRole('button', { name: 'Strength' }).click();
    await pop.locator('#asg-tag-btn').click();
    await pop.locator('#asg-tag-dropdown .obsc-menu-search').fill('collab');
    await pop.locator('#asg-tag-dropdown .obsc-item', { hasText: 'Collaboration' }).first().click();
    await pop.locator('#asg-capture-input').click();
    await pop.locator('#asg-capture-input').fill('Explained the method to her group');
    await page.keyboard.press('Enter');

    await expect(pop.locator('.comment-entry-text')).toHaveText('Explained the method to her group');
    await expect(pop.locator('.comment-entry .obs-pill-type')).toHaveText('Strength');
    await expect(page.locator('.comment-btn[data-sid="stu-001"] .comment-count').first()).toHaveText('1');

    const saved = await storedObs(page);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      text: 'Explained the method to her group',
      sentiment: 'strength',
      dims: ['collaboration'],
      assignmentContext: { assessmentId: 'assess-001', assessmentTitle: 'Lab Report 1' },
    });

    await page.locator('.comment-popover-close').click();
    await page.evaluate(r => window.Router.navigate(r), `/observations?course=${TEST_COURSE.id}`);
    const card = page.locator('.obs-card', { hasText: 'Explained the method to her group' });
    await expect(card).toBeVisible();
    await expect(card.locator('.obs-type')).toHaveText('Strength');
    await expect(card.locator('.obs-card-assessment')).toHaveText('Lab Report 1');
    await expect(card.locator('.obs-card-dim')).toHaveText('Collaboration');
  });

  test('shorthand picks the student, tag and type; a concern offers the flag', async ({ page }) => {
    await gotoApp(page, '/observations');
    const input = page.locator('#capture-input');
    await input.click();
    await input.pressSequentially('@Bob ');
    await expect(page.locator('#obs-capture .obsc-chip-student')).toContainText('Bob');
    await input.pressSequentially('Did not start the task !conc');
    // Enter on a suggestion picks it; the next Enter sends.
    await page.keyboard.press('Enter');
    await expect(page.locator('#obs-capture .obsc-chip-type[data-value="concern"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(input).toHaveValue('Did not start the task ');
    await page.keyboard.press('Enter');

    const card = page.locator('.obs-card', { hasText: 'Did not start the task' });
    await expect(card).toBeVisible();
    await expect(card.locator('.obs-type')).toHaveText('Concern');

    const offer = page.locator('#obs-capture [data-part="flag"]');
    await expect(offer).toContainText('Not Now');
    await offer.getByRole('button', { name: /^Flag Bob/ }).click();
    await expect(offer).toBeEmpty();
    const flagged = await page.evaluate(
      cid => JSON.parse(localStorage.getItem('gb-flags-' + cid) || '{}'),
      TEST_COURSE.id,
    );
    expect(flagged['stu-002']).toBe(true);
    // The next note starts with no student.
    await expect(page.locator('#obs-capture .obsc-chip-student')).toHaveCount(0);
  });

  test('after Add the strip is empty and the note box has focus for the next one', async ({ page }) => {
    await gotoApp(page, '/observations');
    const strip = page.locator('#obs-capture');
    await page.locator('#student-btn').click();
    await page.locator('#student-dropdown .obsc-item', { hasText: 'Alice' }).click();
    await strip.getByRole('button', { name: 'Growth' }).click();
    await page.locator('#tag-btn').click();
    await page.locator('#tag-dropdown .obsc-item', { hasText: 'Collaboration' }).first().click();
    await page.locator('#context-btn').click();
    await strip.locator('[data-obsc="setContext"][data-value="small-group"]').click();
    await page.locator('#link-btn').click();
    await page.locator('#assessment-btn').click();
    await page.locator('[data-menu="assessment"] .obsc-item', { hasText: 'Lab Report 1' }).click();
    await page.locator('#capture-input').fill('Checked her group’s units');
    await page.locator('#capture-add-btn').click();

    await expect(page.locator('.obs-card', { hasText: 'Checked her group’s units' })).toBeVisible();
    await expect(strip.locator('.obsc-chip-student')).toHaveCount(0);
    await expect(strip.locator('.obsc-chip-type.is-on')).toHaveCount(0);
    await expect(strip.locator('.obsc-chip-tag')).toHaveCount(0);
    await expect(strip.locator('.obsc-chip-assessment')).toHaveCount(0);
    await expect(page.locator('#context-btn')).toHaveText(/\+ Context/);
    await expect(page.locator('#capture-input')).toHaveValue('');
    await expect(page.locator('#capture-input')).toBeFocused();
    await expect(page.locator('#capture-add-btn')).toBeDisabled();
  });

  test('+ Add Tag adds the one tag picked and closes; another needs another click', async ({ page }) => {
    await gotoApp(page, '/observations');
    const tags = page.locator('#obs-capture .obsc-chip-tag');
    await page.locator('#tag-btn').click();
    await page.locator('#tag-dropdown .obsc-item', { hasText: 'Collaboration' }).first().click();
    await expect(page.locator('#tag-dropdown')).toHaveCount(0);
    await expect(tags).toHaveText(['Collaboration×']);
    await expect(page.locator('#capture-input')).toBeFocused();

    await page.locator('#tag-btn').click();
    await page.locator('#tag-dropdown .obsc-menu-search').fill('engag');
    await page.keyboard.press('Enter');
    await expect(page.locator('#tag-dropdown')).toHaveCount(0);
    await expect(tags).toHaveText(['Collaboration×', 'Engagement×']);
  });

  test('unsent text survives a trip to another page', async ({ page }) => {
    await gotoApp(page, '/observations');
    await page.locator('#capture-input').fill('Half a thought about Alice');
    await page.evaluate(() => window.Router.navigate('/dashboard'));
    await expect(page.locator('#capture-input')).toHaveCount(0);
    await page.evaluate(() => window.Router.navigate('/observations'));
    await expect(page.locator('#capture-input')).toHaveValue('Half a thought about Alice');
  });

  test('the gradebook cell menu opens the strip with student and assessment filled in', async ({ page }) => {
    await gotoApp(page, '/gradebook');
    await page.getByRole('tab', { name: 'Scores' }).click();
    const cell = page.locator('td.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]').first();
    await cell.click({ button: 'right' });
    await page.locator('.gb-ctx-item[data-ctx="addObservation"]').click();
    const dlg = page.getByRole('dialog', { name: 'Add observation' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.obsc-chip-student')).toContainText('Alice');
    await expect(dlg.locator('.obsc-chip-assessment')).toContainText('Lab Report 1');
    await dlg.locator('#dlg-capture-input').fill('Strong data table');
    await page.keyboard.press('Enter');
    await expect(dlg).toHaveCount(0);
    const saved = await storedObs(page);
    expect(saved.map(o => o.text)).toEqual(['Strong data table']);
    expect(saved[0].assignmentContext.assessmentId).toBe('assess-001');
  });
});
