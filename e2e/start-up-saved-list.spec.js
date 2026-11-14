import { test, expect } from '@playwright/test';
import { mockAuth, TEACHER, TEST_COURSE, TEST_STUDENTS, TEST_LEARNING_MAP } from './helpers.js';

/* Start-up draws the saved class list first (docs/DECISIONS.md; Colin's
   ruling of 2026-11-13). On a repeat visit the sign-in re-check (getUser)
   is asked beside the class list, and this device's saved class is drawn
   while it answers: locked, with nothing sent. Here the re-check answers
   only when the test says so. The data layer's own tests are
   tests/boot-saved-list-first.test.js; this is the real router and page. */
test.use({ viewport: { width: 1440, height: 900 } });

// A class with a server id: only those open from a saved copy.
const CID = 'e2e00000-0000-4000-8000-000000000001';

/* A first visit, on which the class is saved on the device, then a reload
   on which getUser waits for window.__answerGetUser(result). The page notes
   what it holds at the moment the dock is first drawn (window.__atDraw), so
   nothing here depends on how quickly the test can look. */
async function repeatVisitWithTheReCheckHeld(page) {
  await mockAuth(page);
  await page.addInitScript(
    ({ cid, course, students, learningMap }) => {
      if (!sessionStorage.getItem('e2e-first-visit-done')) {
        // The fake server's data, read once: the first visit only. After it
        // the device holds what the app itself saved.
        sessionStorage.setItem('e2e-first-visit-done', '1');
        localStorage.setItem('gb-courses', JSON.stringify({ [cid]: Object.assign({}, course, { id: cid }) }));
        localStorage.setItem('gb-config', JSON.stringify({ activeCourse: cid }));
        localStorage.setItem('gb-students-' + cid, JSON.stringify(students));
        localStorage.setItem('gb-learningMaps-' + cid, JSON.stringify(learningMap));
        return;
      }
      if (!sessionStorage.getItem('e2e-hold-getuser')) return;
      const waiting = [];
      window._supabase.auth.getUser = () => new Promise(resolve => waiting.push(resolve));
      window.__answerGetUser = result => {
        window.__reCheckAnswered = true;
        waiting.splice(0).forEach(resolve => resolve(result));
      };
      // The re-check gives each answer four seconds and then stands aside.
      // It is given as long as the test needs.
      const setTimer = window.setTimeout;
      window.setTimeout = (fn, ms, ...rest) => setTimer(fn, ms === 4000 ? 600000 : ms, ...rest);
      // What the page holds as it leaves (a failed re-check goes to Sign In).
      window.addEventListener('pagehide', () => {
        sessionStorage.setItem(
          'e2e-at-leave',
          JSON.stringify({
            saved: Object.keys(localStorage).filter(k => k.startsWith('gb-') || k.startsWith('gb_')),
            hidden: document.documentElement.style.visibility,
            mainInert: !!document.getElementById('main').inert,
            asked: window.__e2eRpcLog.map(c => c.name),
          }),
        );
      });
      new MutationObserver((_, watcher) => {
        if (!document.querySelector('#dock-mount nav')) return;
        watcher.disconnect();
        const main = document.getElementById('main');
        window.__atDraw = {
          reCheckAnswered: !!window.__reCheckAnswered,
          classes: Object.keys(COURSES),
          students: getStudents(cid).length,
          mainInert: !!main.inert,
          asked: window.__e2eRpcLog.map(c => c.name),
        };
      }).observe(document, { childList: true, subtree: true });
    },
    { cid: CID, course: TEST_COURSE, students: TEST_STUDENTS, learningMap: TEST_LEARNING_MAP },
  );
  await page.goto('/dashboard');
  await page.waitForSelector('#dock-mount nav', { timeout: 15_000 });
  await expect.poll(() => page.evaluate(cid => getStudents(cid).length, CID)).toBe(TEST_STUDENTS.length);
  await expect.poll(() => page.evaluate(cid => _savedCopyUsable(cid), CID)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('gb-owner'))).toBe(TEACHER.id);

  await page.evaluate(() => sessionStorage.setItem('e2e-hold-getuser', '1'));
  await page.reload();
  await page.waitForFunction(() => !!window.__atDraw, null, { timeout: 15_000 });
}

const writes = names => names.filter(n => !/^(get|list)_/.test(n) && n !== 'bootstrap_teacher');

test('a repeat visit draws the saved class before the sign-in re-check answers, locked, and unlocks when it passes', async ({
  page,
}) => {
  await repeatVisitWithTheReCheckHeld(page);

  // Drawn from the device's copy, with the re-check still out.
  const drawn = await page.evaluate(() => window.__atDraw);
  expect(drawn.reCheckAnswered).toBe(false);
  expect(drawn.classes).toEqual([CID]);
  expect(drawn.students).toBe(TEST_STUDENTS.length);
  expect(drawn.mainInert).toBe(true);
  // The class list was asked for beside the re-check, not after it.
  expect(drawn.asked).toEqual(expect.arrayContaining(['bootstrap_teacher', 'list_teacher_courses']));
  expect(writes(drawn.asked)).toEqual([]);
  await expect(page.locator('#main')).not.toBeEmpty();

  // A setting changed meanwhile waits; it goes when the re-check passes.
  await page.evaluate(() => saveConfig(Object.assign({}, getConfig(), { viewMode: 'compact' })));
  await page.waitForTimeout(300);
  const before = await page.evaluate(user => {
    const state = {
      asked: window.__e2eRpcLog.map(c => c.name),
      mainInert: !!document.getElementById('main').inert,
    };
    window.__answerGetUser({ data: { user }, error: null });
    return state;
  }, TEACHER);
  expect(writes(before.asked)).toEqual([]);
  expect(before.mainInert).toBe(true);

  await expect.poll(() => page.evaluate(() => !!document.getElementById('main').inert)).toBe(false);
  await expect
    .poll(() => page.evaluate(() => window.__e2eRpcLog.map(c => c.name)))
    .toContain('save_teacher_preferences');
  expect(new URL(page.url()).pathname).toBe('/dashboard');
});

test('a re-check that fails after the class is drawn removes the saved data, hides the page and goes to Sign In', async ({
  page,
}) => {
  await repeatVisitWithTheReCheckHeld(page);
  expect((await page.evaluate(() => window.__atDraw)).students).toBe(TEST_STUDENTS.length);

  // Sign In itself is not under test: a blank page stands in for it.
  await page.route('**/login.html', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Sign In</title>' }),
  );
  await page.evaluate(() => {
    window.__answerGetUser({ data: { user: null }, error: { name: 'AuthApiError', status: 403, message: 'bad_jwt' } });
  });
  await page.waitForURL(/\/login\.html$/);

  const left = JSON.parse(await page.evaluate(() => sessionStorage.getItem('e2e-at-leave')));
  expect(left.saved).toEqual([]);
  expect(left.hidden).toBe('hidden');
  expect(left.mainInert).toBe(true);
  expect(writes(left.asked)).toEqual([]);
  // Nothing the page did on its way out put any of it back (the test's own
  // marker, set as every page loads, aside).
  const after = await page.evaluate(() =>
    Object.keys(localStorage).filter(k => (k.startsWith('gb-') || k.startsWith('gb_')) && k !== 'gb-data-wiped'),
  );
  expect(after).toEqual([]);
});
