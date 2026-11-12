/**
 * What a differential run reads from a page: the device's saved copy, the
 * calls the fake server was sent, the state the next action is picked from,
 * and the text of the screens. Also how it waits for a page to finish
 * what a step started.
 */

/* Keys the run itself keeps (page-init.js) and the fake sign-in's token
   (e2e/helpers.js mockAuth writes it on every load). Nothing else is left
   out. */
const HARNESS_KEY = /^(__diff-|sb-[a-z0-9]+-auth-token$|e2e-)/;

/* Every localStorage key, as the exact text stored. */
export function readStorage(page) {
  return page.evaluate(src => {
    const skip = new RegExp(src);
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!skip.test(k)) out[k] = localStorage.getItem(k);
    }
    return out;
  }, HARNESS_KEY.source);
}

/* Every IndexedDB database the page has, each store's records as text (a
   Blob as its type and size). { 'db/store': { key: text } }. */
export function readIndexedDb(page) {
  return page.evaluate(async () => {
    if (!indexedDB.databases) return {};
    const out = {};
    const dbs = await indexedDB.databases();
    for (const info of dbs.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const db = await new Promise((ok, fail) => {
        const req = indexedDB.open(info.name);
        req.onsuccess = () => ok(req.result);
        req.onerror = () => fail(req.error);
      });
      for (const store of [...db.objectStoreNames].sort()) {
        const rows = await new Promise((ok, fail) => {
          const tx = db.transaction(store, 'readonly');
          const os = tx.objectStore(store);
          const keysReq = os.getAllKeys();
          const valsReq = os.getAll();
          tx.oncomplete = () => ok(keysReq.result.map((k, i) => [k, valsReq.result[i]]));
          tx.onerror = () => fail(tx.error);
        });
        const shown = {};
        for (const [k, v] of rows) {
          shown[JSON.stringify(k)] = JSON.stringify(v, (_, x) =>
            typeof Blob !== 'undefined' && x instanceof Blob ? { blob: x.type, size: x.size } : x,
          );
        }
        out[info.name + '/' + store] = shown;
      }
      db.close();
    }
    return out;
  });
}

/* The calls the fake server took since the last read, and forget them. */
export function takeCalls(page) {
  return page.evaluate(() => {
    const log = window.__e2eRpcLog || [];
    return log.splice(0, log.length).map(c => ({ name: c.name, params: c.params }));
  });
}

/* Wait until the page has finished its real work (scripts loading, IndexedDB,
   other tabs' messages): the saved copy, the calls, the outbox and the
   page's elements stay the same over `polls` looks `everyMs` apart, in real
   time. The app's own timers wait for the run's clock (session.mjs
   advance), so they do not count here. Answers false if it never settled. */
export function settle(page, polls = 2, everyMs = 8, maxMs = 3000) {
  return page
    .evaluate(
      ({ polls, everyMs, maxMs }) =>
        new Promise(resolve => {
          const wait = window.__diffRealSetTimeout || setTimeout;
          function sig() {
            let s = '';
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              const v = localStorage.getItem(k) || '';
              // A cheap fingerprint: each key's length and a sum of its text.
              let h = 0;
              for (let j = 0; j < v.length; j += 7) h = (h * 31 + v.charCodeAt(j)) | 0;
              s += k + ':' + v.length + ':' + h + ';';
            }
            const calls = (window.__e2eRpcLog || []).length;
            const dom = document.getElementsByTagName('*').length;
            return s + '|' + calls + '|' + dom + '|' + document.readyState + '|' + (window.__diffPending || 0);
          }
          let last = sig();
          let same = 0;
          let spent = 0;
          (function tick() {
            const cur = sig();
            if (cur === last) same++;
            else {
              same = 0;
              last = cur;
            }
            spent += everyMs;
            if (spent > maxMs) return resolve(false);
            if (same < polls || window.__diffPending) return wait(tick, everyMs);
            // A Web Lock asked for and free to be granted (the outbox's
            // owner, when a tab opens or goes) is still to come.
            if (!navigator.locks || !navigator.locks.query) return resolve(true);
            navigator.locks.query().then(
              st => {
                const held = new Set((st.held || []).map(l => l.name));
                if ((st.pending || []).every(l => held.has(l.name))) resolve(true);
                else wait(tick, everyMs);
              },
              () => resolve(true),
            );
          })();
        }),
      { polls, everyMs, maxMs },
    )
    .catch(() => false);
}

/* What the next action is picked from: the active class, its roster,
   withdrawn students, pieces, categories and sections. Read from build A
   (B holds the same, or the run has already stopped). */
export function readView(page) {
  return page.evaluate(() => {
    const cid = getActiveCourse();
    const courses = loadCourses() || {};
    const rubricsById = {};
    (getRubrics(cid) || []).forEach(r => (rubricsById[r.id] = r));
    const course = courses[cid] || {};
    return {
      cid,
      courseIds: Object.keys(courses).sort(),
      gradingSystem: course.gradingSystem || '',
      calcMethod: course.calcMethod || '',
      students: getStudents(cid).map(s => ({ id: s.id, name: (s.preferred || s.firstName) + ' ' + s.lastName })),
      withdrawn: (getWithdrawnStudents(cid) || []).map(w => w && w.student && w.student.id).filter(Boolean),
      assessments: getAssessments(cid).map(a => ({
        id: a.id,
        title: a.title,
        scoreMode: a.scoreMode || '',
        maxPoints: a.maxPoints || 0,
        rubricId: a.rubricId || '',
        tagIds: a.tagIds || [],
        categoryId: a.categoryId || '',
        collaboration: a.collaboration || 'individual',
        criteria: a.rubricId && rubricsById[a.rubricId] ? rubricsById[a.rubricId].criteria.map(c => c.id) : [],
        date: a.date || '',
      })),
      rubrics: Object.keys(rubricsById),
      categories: (getCategories(cid) || []).map(c => ({ id: c.id, name: c.name, weight: c.weight })),
      sections: (getSections(cid) || []).map(s => s.id),
      studentPage: !!(getCourseConfig(cid) || {}).student_page_enabled,
      demo: typeof isDemoMode === 'function' && isDemoMode(),
    };
  });
}

/* Navigate inside the app (the router, as a link does) and wait. */
export async function go(page, path) {
  await page.evaluate(p => window.Router.navigate(p), path);
  await tick(page);
}

/* Close what could sit over a screen and take a click: the grader dialog,
   a menu, Preview as Student. A toast is left: it is part of what the last
   action did (its Undo, or its commit when it times out). */
export async function closeOverlays(page) {
  const open = await page.evaluate(() => {
    const was = [];
    const done = document.querySelector('.grader-dialog [data-grader="close"]');
    if (done) {
      done.click();
      was.push('grader');
    }
    if (document.querySelector('.gb-ctx-menu')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      was.push('menu');
    }
    if (window.PreviewStudent && window.PreviewStudent.isOpen()) {
      window.PreviewStudent.close();
      was.push('preview');
    }
    const cancel = document.getElementById('confirm-cancel-btn');
    if (cancel) {
      cancel.click();
      was.push('confirm');
    }
    return was;
  });
  if (open.length) await tick(page, 100);
  return open.join(', ');
}

/* Let a screen draw: real work done, then the clock moved a little, the
   same in A and B. */
export async function tick(page, ms = 500) {
  await settle(page);
  await runClock(page.context(), ms);
  await settle(page);
}

/* Move a session's clock on by `ms`, firing the timers due. The run keeps
   the time it should be (context.__diffNow), so a tab opened later can be
   put at exactly that time (session.mjs openTab). */
export async function runClock(context, ms) {
  context.__diffNow = (context.__diffNow || 0) + ms;
  await context.clock.runFor(ms);
}

function layoutText(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#page-layout');
    return el ? el.innerText : '(no page)';
  });
}

/* The text of what a teacher and a student see, screen by screen. `who`
   names the students and the piece: { grader: [sid, aid], student, preview:
   [sid, sid] }, picked by name by the runner. */
export async function readScreens(page, cid, who) {
  const out = {};
  const left = await closeOverlays(page);
  if (left) out.leftOpen = left;
  await go(page, '/gradebook?course=' + cid);
  if (!(await page.locator('#gb-data td.gb-scores-cell').count())) {
    const scoresTab = page.locator('[data-action="setView"][data-mode="scores"]');
    if (await scoresTab.count()) await scoresTab.click({ timeout: 5000 });
    await tick(page);
  }
  out.gradebook = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#gb-rowheads .gb-grid-rowhead-name')].map(e => e.innerText.trim());
    const cells = [...document.querySelectorAll('#gb-data td.gb-scores-cell')].map(
      td => td.dataset.sid + ' ' + td.dataset.aid + ': ' + td.innerText.replace(/\s+/g, ' ').trim(),
    );
    const heads = document.querySelector('#gb-colheads');
    return [
      'rows: ' + rows.join(' | '),
      'columns: ' + (heads ? heads.innerText.replace(/\s+/g, ' ') : ''),
      ...cells,
    ].join('\n');
  });
  if (who.grader) {
    const [sid, aid] = who.grader;
    const cell = page.locator('#gb-data td.gb-scores-cell[data-sid="' + sid + '"][data-aid="' + aid + '"]');
    if (await cell.count()) {
      await cell.click();
      await page.locator('.grader-dialog').waitFor({ timeout: 5000 });
      await tick(page);
      out.grader = await page.evaluate(() => document.querySelector('.grader-dialog').innerText);
      await closeOverlays(page);
    } else out.grader = '(no cell for the grader)';
  }
  await go(page, '/assignments?course=' + cid);
  out.assignments = await layoutText(page);
  if (who.student) {
    await go(page, '/student?id=' + who.student + '&course=' + cid);
    out.student = await layoutText(page);
  }
  for (const [i, sid] of (who.preview || []).entries()) {
    const opened = await page.evaluate(
      ([cid, sid]) => window.PreviewStudent && window.PreviewStudent.open(cid, sid),
      [cid, sid],
    );
    if (opened === false) {
      out['preview' + (i + 1)] = '(Preview as Student did not open)';
      continue;
    }
    await tick(page);
    out['preview' + (i + 1)] = await page.evaluate(() => {
      const el = document.getElementById('preview-student');
      return el ? el.innerText : '(no preview)';
    });
    await page.evaluate(() => window.PreviewStudent.close());
  }
  await go(page, '/reports?course=' + cid);
  out.quickReport = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll('#report-output .report-sheet')];
    return sheets.length ? sheets.map(s => s.innerText).join('\n---\n') : '(no Quick Report sheet)';
  });
  return out;
}

/* Wait for `fn` (run in the page) to answer true, moving the clock a little
   between looks. Answers whether it did. */
export async function until(page, fn, arg, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(fn, arg).catch(() => false)) return true;
    await tick(page, 50);
  }
  return false;
}
