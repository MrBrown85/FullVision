/**
 * The Dashboard's Inbox tile, By Assessment (D4 of
 * docs/plans/dashboard-inbox-plan.md), behind the dashRow switch. Demo Mode,
 * Science 8, the student page and Send Work on, so the sample work shows:
 * Light Refraction Lab has work waiting.
 */
import { test, expect } from '@playwright/test';

const LIGHT = 'sci8a21';
const SHOTS = process.env.FV_SHOTS || '';
const shot = async (page, name) => {
  if (!SHOTS) return;
  // The app's own loading screen has gone by the time the picture is taken.
  await page.waitForFunction(() => {
    const el = document.getElementById('app-loading');
    return (
      !el ||
      getComputedStyle(el).display === 'none' ||
      getComputedStyle(el).visibility === 'hidden' ||
      +getComputedStyle(el).opacity === 0
    );
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + '/' + name + '.png' });
};

async function open(page, { flag = true, bulletins = false, sendWork = true, dark = false } = {}) {
  await page.addInitScript(
    ([flag, bulletins]) => {
      try {
        if (flag) localStorage.setItem('fv-build-dashRow', '1');
        if (bulletins) {
          localStorage.setItem('fv-build-bulletins', '1');
        }
      } catch (e) {
        /* storage blocked */
      }
    },
    [flag, bulletins],
  );
  if (dark) await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-glance').waitFor();
  if (sendWork) {
    await page.evaluate(() => {
      const cid = getActiveCourse();
      setStudentPageSwitch(cid, true, 'on_return');
      const work = getCourseSubmissions(cid);
      work.course.send_work = true;
      saveDemoStudentWork(cid, work);
      PageDashboard.render();
    });
    if (flag) await page.locator('#dash-inbox').waitFor();
  }
}

const box = (page, sel) =>
  page
    .locator(sel)
    .first()
    .evaluate(el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    });

test.use({ viewport: { width: 1280, height: 800 } });

test('the rows match the model, and the top bar and the Inbox give one To Grade', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page);
  const got = await page.evaluate(() => {
    const cid = getActiveCourse();
    const ids = getStudents(cid).map(s => s.id);
    const m = DashInboxModel.build(cid, { seen: localStorage.getItem('fv-dash-inbox-seen:' + cid) });
    return {
      shown: [...document.querySelectorAll('.dash-inbox-row')].map(r => ({
        aid: r.getAttribute('data-aid'),
        counts: r.querySelector('.dash-inbox-main').textContent,
      })),
      model: m.rows.map(p => ({
        aid: p.aid,
        counts:
          p.in +
          ' in · ' +
          p.tograde +
          ' to grade · ' +
          p.notin +
          ' not in' +
          (p.toreturn ? ' · ' + p.toreturn + ' to return' : ''),
      })),
      sumRows: m.pieces.reduce((n, p) => n + p.tograde, 0),
      topBar: Number(document.querySelector('.dash-glance-tograde .dash-glance-value').textContent),
      classCount: GraderWork.classWorkCounts(cid, ids).tograde,
    };
  });
  expect(got.shown.length).toBeGreaterThan(0);
  expect(got.shown).toEqual(got.model);
  expect(got.shown[0].aid).toBe(LIGHT);
  expect(got.sumRows).toBe(got.topBar);
  expect(got.sumRows).toBe(got.classCount);
  expect(got.topBar).toBeGreaterThan(0);
  // No count in the header; one view pill; one link.
  await expect(page.locator('.dash-inbox-head')).not.toContainText(/\d/);
  await expect(page.locator('.dash-inbox-head .dash-view-btn')).toHaveText('By Assessment');
  expect(errors).toEqual([]);
});

test('the title opens the Work Wall', async ({ page }) => {
  await open(page);
  await page.locator('.dash-inbox-row[data-aid="' + LIGHT + '"] .dash-inbox-name').click();
  await expect(page.locator('#work-wall-overlay')).toBeVisible();
  await expect(page.locator('#work-wall-overlay')).toContainText('Light Refraction Lab');
  await page.locator('#work-wall-overlay .ww-back').click();
  await expect(page.locator('#work-wall-overlay')).toHaveCount(0);
  await expect(page.locator('#dash-inbox')).toBeVisible();
});

test('Grade Submissions opens the grader on the first student in the order the work came in', async ({ page }) => {
  await open(page);
  const first = await page.evaluate(aid => {
    const cid = getActiveCourse();
    const p = DashInboxModel.build(cid, { seen: null }).pieces.find(x => x.aid === aid);
    const st = getStudents(cid).find(s => s.id === DashInboxModel.gradeOrder(cid, aid)[0]);
    return { name: displayName(st), n: p.tograde };
  }, LIGHT);
  await page.locator('.dash-inbox-row[data-aid="' + LIGHT + '"] .dash-inbox-grade').click();
  const dialog = page.locator('.grader-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('.grader-student')).toContainText(first.name.split(' ')[0]);
  await expect(page.locator('.grader-show [data-show="tograde"]')).toHaveAttribute('aria-pressed', 'true');
  // The same number the row said (a pair counts once).
  await expect(page.locator('.grader-show [data-show="tograde"] .grader-show-n')).toHaveText(String(first.n));
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // Closing draws the Dashboard again with the tile in place.
  await expect(page.locator('#dash-inbox')).toBeVisible();
});

test('To Grade in the top bar scrolls to the Inbox and rings it; the ring is gone at rest', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  const tile = page.locator('#dash-inbox');
  await expect(tile).not.toHaveClass(/is-ring/);
  // Scroll the page down so the Inbox is out of view and the top bar's cell is too.
  await page.evaluate(() => {
    const main = document.getElementById('main');
    main.scrollTop = main.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  });
  const before = await box(page, '#dash-inbox');
  expect(before.bottom <= 0 || before.top >= 800 || before.top < 0).toBe(true);
  // The ring's own life: when the class goes on and when it comes off.
  await page.evaluate(() => {
    window.__ring = {};
    new MutationObserver(() => {
      const on = document.getElementById('dash-inbox').classList.contains('is-ring');
      if (on && !window.__ring.on) window.__ring.on = performance.now();
      if (!on && window.__ring.on && !window.__ring.off) window.__ring.off = performance.now();
    }).observe(document.getElementById('dash-inbox'), { attributes: true, attributeFilter: ['class'] });
  });
  // Enter on the focused cell, as a keyboard teacher would.
  await page.locator('.dash-glance-tograde').evaluate(el => el.focus({ preventScroll: true }));
  await page.keyboard.press('Enter');
  await expect(tile).toHaveClass(/is-ring/);
  await expect.poll(async () => (await box(page, '#dash-inbox')).bottom).toBeGreaterThan(100);
  const after = await box(page, '#dash-inbox');
  expect(after.top).toBeLessThan(800);
  // Still on the Dashboard: the link was not followed.
  expect(new URL(page.url()).pathname).toBe('/dashboard');
  await expect(tile).not.toHaveClass(/is-ring/, { timeout: 2000 });
  // The ring lasts 200 to 250 ms (a 1,000 ms ring would fail this).
  const ring = await page.evaluate(() => window.__ring);
  expect(ring.off - ring.on).toBeGreaterThanOrEqual(180);
  expect(ring.off - ring.on).toBeLessThanOrEqual(400);
});

test('a counts line too long for its box loses its quiet words, never Late, in the page font or a wide one', async ({
  page,
}) => {
  await open(page);
  for (const wide of [false, true]) {
    const r = await page.evaluate(wide => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:260px;z-index:9999;background:#fff';
      if (wide) host.style.cssText += ';font-family:Verdana,"DejaVu Sans",sans-serif;letter-spacing:0.04em';
      host.innerHTML =
        '<p class="dash-inbox-counts">' +
        DashInbox.countsHtml({ in: 12, tograde: 4, notin: 20, toreturn: 2, late: 3, addedByTeacher: 9, onPaper: 4 }) +
        '</p>';
      document.body.appendChild(host);
      const p = host.querySelector('.dash-inbox-counts').getBoundingClientRect();
      const late = host.querySelector('.dash-inbox-late').getBoundingClientRect();
      const out = {
        pRight: p.right,
        lateRight: late.right,
        lateText: host.querySelector('.dash-inbox-late').textContent,
      };
      host.remove();
      return out;
    }, wide);
    expect(r.lateText).toBe('· Late 3');
    expect(r.lateRight, wide ? 'wide font' : 'own font').toBeLessThanOrEqual(r.pRight + 0.5);
  }
});

test('a paper hand-in with no scan is a sheet that holds its name and its words', async ({ page }) => {
  await open(page);
  await page.evaluate(aid => {
    const cid = getActiveCourse();
    const work = getCourseSubmissions(cid);
    const st = getStudents(cid).find(
      s => !work.submissions.some(x => x.assessment_id === aid && x.enrollment_id === s.id),
    );
    // A long name, to see it wrap rather than run out of the sheet.
    st.firstName = 'Maximilian-Alexander';
    st.lastName = 'Featherstonehaugh-Smythe';
    work.submissions.push({
      id: 'paper-x',
      assessment_id: aid,
      enrollment_id: st.id,
      version: 1,
      state: 'sent',
      sent_by: 'teacher',
      on_paper: true,
      is_late: false,
      note: null,
      sent_at: '2999-01-01T00:00:00Z',
      created_at: '2999-01-01T00:00:00Z',
      files: [],
    });
    saveDemoStudentWork(cid, work);
    PageDashboard.render();
  }, LIGHT);
  const sheet = page.locator('.dash-inbox-sheet').first();
  await expect(sheet).toBeVisible();
  // The sheet is measured twice: in the page's own font, and in a wider one
  // (Verdana, with a little more space between letters), as a Windows laptop
  // or a Chromebook may draw it. Both must hold.
  const FONTS = {
    own: '',
    wide: 'body, .dash-inbox-sheet, .dash-inbox-sheet * { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }',
  };
  for (const [fontName, css] of Object.entries(FONTS)) {
    await page.evaluate(c => {
      let t = document.getElementById('__font');
      if (!t) {
        t = document.createElement('style');
        t.id = '__font';
        document.head.appendChild(t);
      }
      t.textContent = c;
    }, css);
    const m = await sheet.evaluate(el => {
      const r = el.getBoundingClientRect();
      const name = el.querySelector('.dash-inbox-sheet-name');
      const note = el.querySelector('.dash-inbox-sheet-note');
      const lines = n => Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight));
      // Each note line's words, measured as drawn: none runs out of the note's box.
      const noteBox = note.getBoundingClientRect();
      const words = [...note.children].map(c => {
        const range = document.createRange();
        range.selectNodeContents(c);
        return range.getBoundingClientRect().right - noteBox.right;
      });
      return {
        w: r.width,
        h: r.height,
        fits: el.scrollHeight <= el.clientHeight + 1,
        nameLines: lines(name),
        noteLines: lines(note),
        over: Math.max(...words),
        label: el.getAttribute('aria-label'),
      };
    });
    const at = fontName + ' font';
    expect(m.w, at).toBeGreaterThanOrEqual(66);
    expect(m.h, at).toBeGreaterThanOrEqual(80);
    expect(m.fits, at).toBe(true);
    expect(m.noteLines, at).toBeLessThanOrEqual(2);
    expect(m.nameLines, at).toBeLessThanOrEqual(2);
    expect(m.over, at).toBeLessThanOrEqual(0.5);
    expect(m.label, at).toMatch(/Featherstonehaugh-Smythe: Handed In on Paper$/);
  }
  await page.evaluate(() => document.getElementById('__font').remove());
  await shot(page, 'inbox-paper-sheet');
});

test('a redraw keeps the tile and asks for no picture twice', async ({ page }) => {
  await open(page);
  const pics = page.locator('#dash-inbox .dash-inbox-img');
  await expect
    .poll(async () => pics.evaluateAll(imgs => imgs.filter(i => i.complete && i.naturalWidth > 0).length))
    .toBeGreaterThan(0);
  const n = await pics.count();
  await page.evaluate(() => {
    window.__asked = 0;
    const was = window.openStudentWorkPage;
    window.openStudentWorkPage = function () {
      window.__asked++;
      return was.apply(this, arguments);
    };
  });
  await page.evaluate(() => {
    PageDashboard.render();
    PageDashboard.render();
  });
  await expect(page.locator('#dash-inbox')).toBeVisible();
  expect(await pics.count()).toBe(n);
  await expect.poll(async () => pics.evaluateAll(imgs => imgs.filter(i => i.getAttribute('src')).length)).toBe(n);
  expect(await page.evaluate(() => window.__asked)).toBe(0);
});

test('the view menu is not visible at rest, opens on the pill and closes on Escape', async ({ page }) => {
  await open(page);
  const menu = page.locator('#dash-view-menu-inbox');
  const hidden = async () =>
    menu.evaluate(el => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display === 'none' || cs.visibility === 'hidden' || (r.width === 0 && r.height === 0);
    });
  expect(await hidden()).toBe(true);
  await page.locator('#dash-view-btn-inbox').click();
  expect(await hidden()).toBe(false);
  await expect(menu.locator('[role="menuitemradio"]').first()).toContainText('By Assessment');
  await expect(menu).toContainText('One row per assessment, newest work first.');
  await page.keyboard.press('Escape');
  expect(await hidden()).toBe(true);
  // The ring and the rest of the tile's own overlays are not drawn at rest either.
  expect(await page.locator('#dash-inbox').evaluate(el => getComputedStyle(el).boxShadow)).not.toContain(
    '0px 0px 0px 3px',
  );
});

test('beside a Bulletins tile the Inbox is 299 px: whole rows, pictures of 80 px or more, nothing sideways', async ({
  page,
}) => {
  await open(page, { bulletins: true });
  const tile = await box(page, '#dash-inbox');
  expect(Math.round(tile.height)).toBe(299);
  const m = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.dash-inbox-row')].map(r => {
      const b = r.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom };
    });
    const list = document.getElementById('dash-inbox-list');
    const lb = list.getBoundingClientRect();
    const pics = [...document.querySelectorAll('#dash-inbox .dash-inbox-img')].map(
      i => i.getBoundingClientRect().height,
    );
    const sheets = [...document.querySelectorAll('#dash-inbox .dash-inbox-sheet')].map(
      i => i.getBoundingClientRect().height,
    );
    const main = document.getElementById('main');
    return {
      rows,
      list: { top: lb.top, bottom: lb.bottom, scrolls: list.scrollHeight > list.clientHeight },
      pics,
      sheets,
      sideways: [
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        main.scrollWidth - main.clientWidth,
        list.scrollWidth - list.clientWidth,
      ],
      pageH: document.documentElement.scrollHeight,
    };
  });
  for (let i = 1; i < m.rows.length; i++) expect(m.rows[i].top).toBeGreaterThanOrEqual(m.rows[i - 1].bottom - 0.5);
  // The first row sits whole inside the list.
  expect(m.rows[0].top).toBeGreaterThanOrEqual(m.list.top - 0.5);
  expect(m.rows[0].bottom).toBeLessThanOrEqual(m.list.bottom + 0.5);
  expect(m.pics.length).toBeGreaterThan(0);
  m.pics.concat(m.sheets).forEach(h => expect(h).toBeGreaterThanOrEqual(80));
  expect(m.sideways).toEqual([0, 0, 0]);
  // The tile did not make the row taller: it is still 510 px beside Bulletins.
  expect(Math.round((await box(page, '.dash-row')).height)).toBe(510);
  const bulletins = await box(page, '.dash-row-bulletins');
  expect(bulletins.top).toBeGreaterThanOrEqual(tile.bottom + 11);
  await shot(page, 'inbox-299-light');
});

test('with the whole column the Inbox is the row tall, and a row is 109 px', async ({ page }) => {
  await open(page);
  const tile = await box(page, '#dash-inbox');
  expect(Math.round(tile.height)).toBe(510);
  const row = await box(page, '.dash-inbox-row');
  expect(Math.round(row.height)).toBe(109);
  const pic = await box(page, '.dash-inbox-img');
  expect(pic.height).toBeGreaterThanOrEqual(80);
  await shot(page, 'inbox-510-light');
});

test('dark: the tile draws on the dark surface', async ({ page }) => {
  await open(page, { dark: true });
  await shot(page, 'inbox-510-dark');
  await expect(page.locator('#dash-inbox')).toBeVisible();
  const bg = await page.locator('#dash-inbox').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgb(255, 255, 255)');
});

test('dark beside Bulletins', async ({ page }) => {
  await open(page, { dark: true, bulletins: true });
  await shot(page, 'inbox-299-dark');
  expect(Math.round((await box(page, '#dash-inbox')).height)).toBe(299);
});

test('with the switch off there is no Inbox and To Grade opens Assignments', async ({ page }) => {
  await open(page, { flag: false });
  await expect(page.locator('#dash-inbox')).toHaveCount(0);
  await expect(page.locator('.dash-inbox')).toHaveCount(0);
  await expect(page.locator('.dash-glance-tograde')).not.toHaveAttribute('data-dash-inbox-jump', /.*/);
  await page.locator('.dash-glance-tograde').click();
  await page.waitForURL(/\/assignments/);
  expect(page.url()).toContain('show=tograde');
});

test('with Send Work off the slot keeps Recent Assessments', async ({ page }) => {
  await open(page, { sendWork: false });
  await expect(page.locator('#dash-inbox')).toHaveCount(0);
  await expect(page.locator('.dash-recent')).toBeVisible();
});

test('the view menu keeps one fixed order, whatever order the scripts load in', async ({ page }) => {
  await open(page);
  await page.locator('#dash-view-btn-inbox').click();
  const keys = await page.locator('#dash-view-menu-inbox [data-view]').evaluateAll(els => els.map(e => e.dataset.view));
  const want = ['assessment', 'side', 'flip', 'roll'];
  expect(keys).toContain('roll');
  expect(keys[0]).toBe('assessment');
  // An ordered match: each shown view comes in the fixed order.
  const ranks = keys.map(k => want.indexOf(k));
  expect(ranks.every(r => r >= 0)).toBe(true);
  expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
});
