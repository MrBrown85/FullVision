import { test, expect } from '@playwright/test';
import { mockAuth } from './helpers.js';

/* Save Categories sends the class's whole list. If the list changed on
   another device after this form was opened, saving would delete a category
   added there and put old weights back. So the server's list is read first
   (list_categories): changed, nothing is saved and one line says so above
   the current categories; not readable, nothing is saved and the line says a
   connection is needed (docs/DECISIONS.md, "Class settings on two
   computers"). A signed-in teacher: Demo Mode has one device and no server. */

const CID = 'e0000000-0000-4000-8000-0000000000c1';
const CHANGED = 'The categories changed on another device, so nothing was saved. These are the current ones.';
const OFFLINE = 'Categories need a connection to save. Nothing was saved. Try again when you are online.';
const SERVER = [
  {
    id: 'e0000000-0000-4000-8000-0000000000a1',
    name: 'Assignments',
    weight: 60,
    display_order: 0,
    calc_mode: 'points',
  },
  { id: 'e0000000-0000-4000-8000-0000000000a2', name: 'Tests', weight: 40, display_order: 1, calc_mode: 'points' },
];
const ADDED_ELSEWHERE = [
  {
    id: 'e0000000-0000-4000-8000-0000000000a1',
    name: 'Assignments',
    weight: 50,
    display_order: 0,
    calc_mode: 'points',
  },
  { id: 'e0000000-0000-4000-8000-0000000000a2', name: 'Tests', weight: 30, display_order: 1, calc_mode: 'points' },
  { id: 'e0000000-0000-4000-8000-0000000000a3', name: 'Projects', weight: 20, display_order: 2, calc_mode: 'points' },
];

async function openGrading(page) {
  await mockAuth(page);
  await page.addInitScript(
    ({ cid, rows }) => {
      localStorage.setItem(
        'gb-courses',
        JSON.stringify({ [cid]: { id: cid, name: 'Science 8', gradeLevel: '8', gradingSystem: 'letter' } }),
      );
      localStorage.setItem('gb-config', JSON.stringify({ activeCourse: cid }));
      localStorage.setItem('gb-lastActiveCourse', cid);
      // What the server holds: list_categories answers with it, and a save
      // replaces it. A test changes it to stand for another device.
      window.__serverCategories = rows;
      const rpc = window._supabase.rpc;
      window._supabase.rpc = function (name, params) {
        if (name === 'list_categories') {
          window.__e2eRpcLog.push({ name, params, at: Date.now() });
          return Promise.resolve({ data: JSON.parse(JSON.stringify(window.__serverCategories)), error: null });
        }
        if (name === 'save_categories') {
          window.__e2eRpcLog.push({ name, params, at: Date.now() });
          window.__serverCategories = params.p_categories.map((c, i) => Object.assign({ display_order: i }, c));
          return Promise.resolve({ data: params.p_categories.map(c => c.id), error: null });
        }
        return rpc(name, params);
      };
    },
    { cid: CID, rows: SERVER },
  );
  await page.goto('/dashboard?manage=grading');
  await expect(page.locator('.cm-cat-name')).toHaveCount(2);
}

const names = page => page.locator('.cm-cat-name').evaluateAll(els => els.map(el => el.value));
const sent = (page, name) => page.evaluate(n => window.__e2eRpcLog.filter(c => c.name === n).length, name);

test('Save Categories on a list changed on another device saves nothing and shows the current ones', async ({
  page,
}) => {
  await openGrading(page);
  // On another device, since this form was opened.
  await page.evaluate(rows => {
    window.__serverCategories = rows;
  }, ADDED_ELSEWHERE);

  await page.locator('.cm-cat-name').nth(1).fill('Quizzes');
  await page.locator('[data-action="cmCatSave"]').click();

  await expect(page.locator('.cm-cat-notice')).toHaveText(CHANGED);
  expect(await names(page)).toEqual(['Assignments', 'Tests', 'Projects']);
  expect(await sent(page, 'save_categories')).toBe(0);
  await expect(page.locator('[data-action="cmCatSave"]')).toBeDisabled();

  // Edited again on the current list: it saves, and the line goes.
  await page.locator('.cm-cat-name').nth(1).fill('Quizzes');
  await page.locator('[data-action="cmCatSave"]').click();
  await expect(page.locator('.cm-cat-notice')).toHaveCount(0);
  expect(await sent(page, 'save_categories')).toBe(1);
  expect(await page.evaluate(() => window.__serverCategories.map(c => c.name))).toEqual([
    'Assignments',
    'Quizzes',
    'Projects',
  ]);
});

test('Save Categories with no connection saves nothing, says so, and keeps what was typed', async ({
  page,
  context,
}) => {
  await openGrading(page);
  await context.setOffline(true);
  await page.locator('.cm-cat-name').nth(1).fill('Quizzes');
  await page.locator('[data-action="cmCatSave"]').click();

  await expect(page.locator('.cm-cat-notice')).toHaveText(OFFLINE);
  expect(await names(page)).toEqual(['Assignments', 'Quizzes']);
  expect(await sent(page, 'save_categories')).toBe(0);
  expect(await page.evaluate(() => window.v2Queue.stats().queued)).toBe(0);

  await context.setOffline(false);
  await page.locator('[data-action="cmCatSave"]').click();
  await expect(page.locator('.cm-cat-notice')).toHaveCount(0);
  expect(await sent(page, 'save_categories')).toBe(1);
});
