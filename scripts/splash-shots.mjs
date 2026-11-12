#!/usr/bin/env node
/**
 * Retakes the splash page's pictures (assets/splash/*.jpg) from Demo Mode.
 *
 * Each shot opens a fresh Demo Mode at 1440 wide and 2x (a phone shot at 390
 * wide), walks to its screen, and saves the element or area. macOS `sips`
 * then scales it to 1800px on the long side as JPEG quality 78, as
 * scripts/help-shots.mjs does for the help site.
 *
 * Shots of the student's side and of sent work turn the class's Student Page
 * on first, through the build address, as a tester would. Those screens are
 * the January pilot's; the splash page labels them so.
 *
 * Run by hand after a UI change, not in CI:
 *   node scripts/splash-shots.mjs            every picture
 *   node scripts/splash-shots.mjs grader     one picture, by file name
 *
 * It builds dist/ (scripts/build-e2e.sh) and serves it through
 * scripts/e2e-server.mjs, so pages get the production CSP. Set
 * SPLASH_SHOTS_URL=http://localhost:<port> to use a server already running.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'splash');
const TMP = join(ROOT, 'test-results', 'splash-shots');

if (spawnSync('which', ['sips']).status !== 0) {
  console.error('splash-shots needs macOS sips to scale the pictures.');
  process.exit(1);
}

const pause = (page, ms) => page.waitForTimeout(ms);

// The class's Student Page, Send Work, Reflect on Feedback and Show My
// Learning on, and grades returned by hand: the pilot's setup.
async function studentPageOn(page, base) {
  await page.goto(base + '/dashboard?manage=student-page&build=student-page');
  await page.waitForSelector('#sp-build-switch', { state: 'attached', timeout: 15000 });
  for (const id of ['sp-build-switch', 'sp-send-switch', 'sp-reflect-switch', 'sp-learning-switch']) {
    await page.waitForSelector('#' + id, { state: 'attached', timeout: 5000 });
    await page.evaluate(i => {
      const el = document.getElementById(i);
      if (el && !el.checked) el.click();
    }, id);
    await pause(page, 700);
  }
  await page
    .getByRole('button', { name: 'When I Return Them' })
    .click()
    .catch(() => {});
  await pause(page, 500);
}

// The Light Refraction Lab's sent work, open in the grader on the first
// student waiting.
async function openGrader(page, base) {
  await studentPageOn(page, base);
  await page.goto(base + '/assignments');
  await pause(page, 1200);
  await page
    .getByText(/^\d+ to grade$/)
    .first()
    .click();
  await pause(page, 800);
  await page.locator('[data-action=gradeSubmissions]').first().click();
  await pause(page, 1500);
}

// What a teacher ticks on the Advanced Rubric: Proficient on each
// criterion, and one Extending point on the first.
async function tickRubric(page) {
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('#grader-overlay input[data-action=graderTick]')]
      .map(i => i.dataset.checkid)
      .filter(id => /_(2a|3a|3b|3c)$/.test(id) || /lab_inquiry_4a$/.test(id)),
  );
  for (const id of ids) {
    const box = page.locator('#grader-overlay input[data-checkid="' + id + '"]').first();
    await box.scrollIntoViewIfNeeded();
    if (!(await box.isChecked())) await box.click({ force: true });
    await pause(page, 300);
  }
  await page.locator('.grader-dialog .rsg-crit, .grader-dialog [data-critid]').first().scrollIntoViewIfNeeded();
  return ids.length;
}

async function openPreview(page, base) {
  await studentPageOn(page, base);
  await page.locator('#sp-preview-open').click();
  await page.waitForSelector('.ps-screen', { timeout: 10000 });
  await pause(page, 1500);
}

const SHOTS = [
  {
    file: 'grader.jpg',
    async run(page, base) {
      await openGrader(page, base);
      await tickRubric(page);
      await pause(page, 600);
      return page.locator('.grader-dialog');
    },
  },
  {
    file: 'rubric.jpg',
    async run(page, base) {
      await openGrader(page, base);
      await tickRubric(page);
      await pause(page, 600);
      // The rubric half of the grader: ticks and the suggested level.
      return { clip: [740, 225, 640, 540] };
    },
  },
  {
    file: 'markup.jpg',
    async run(page, base) {
      await openGrader(page, base);
      await page.locator('[data-grader=work-markup]').click();
      await page.waitForSelector('.markup-img', { timeout: 10000 });
      await pause(page, 800);
      const img = await page.locator('.markup-img').boundingBox();
      const at = (fx, fy) => ({ x: img.x + img.width * fx, y: img.y + img.height * fy });
      await page.locator('[data-mk-color=green]').click();
      await page.locator('[data-mk-tool=tick]').click();
      for (const [fx, fy] of [
        [0.6, 0.605],
        [0.6, 0.655],
        [0.6, 0.705],
      ]) {
        const p = at(fx, fy);
        await page.mouse.click(p.x, p.y);
        await pause(page, 200);
      }
      await page.locator('[data-mk-color=red]').click();
      await page.locator('[data-mk-tool=pen]').click();
      // A ring around the refracted ray's angle.
      const c = at(0.405, 0.35);
      await page.mouse.move(c.x + 44, c.y);
      await page.mouse.down();
      for (let a = 0; a <= 370; a += 10) {
        const r = (a * Math.PI) / 180;
        await page.mouse.move(c.x + 44 * Math.cos(r), c.y + 22 * Math.sin(r));
      }
      await page.mouse.up();
      await page.locator('[data-mk-tool=note]').click();
      const n = at(0.8, 0.9);
      await page.mouse.click(n.x, n.y);
      await pause(page, 500);
      await page.keyboard.type('Great pattern! Can you explain why light bends toward the normal?');
      await pause(page, 300);
      await page.getByRole('button', { name: 'Save Note' }).click();
      await pause(page, 800);
      return null;
    },
  },
  {
    file: 'dashboard.jpg',
    async run(page, base) {
      await studentPageOn(page, base);
      await page.goto(base + '/dashboard');
      await pause(page, 1800);
      return { clip: [0, 0, 1440, 900] };
    },
  },
  {
    file: 'gradebook.jpg',
    async run(page, base) {
      await page.goto(base + '/gradebook');
      await pause(page, 1800);
      // A corner of the grid: ten students and the newest pieces.
      return { clip: [0, 100, 920, 600] };
    },
  },

  {
    file: 'questionnaire.jpg',
    async run(page, base) {
      await page.goto(base + '/reports');
      await pause(page, 1500);
      for (const [h, v] of [
        ['completes', 4],
        ['ready', 3],
        ['others', 4],
      ]) {
        await page
          .locator(`.qn-hs-stop[data-habit="${h}"][data-value="${v}"]`)
          .first()
          .click()
          .catch(() => {});
        await pause(page, 300);
      }
      await page.getByText('Teacher Comment', { exact: true }).first().click();
      await pause(page, 300);
      return { clip: [0, 0, 1440, 900] };
    },
  },
  {
    file: 'custom-report.jpg',
    async run(page, base) {
      await page.goto(base + '/reports');
      await pause(page, 1200);
      await page.locator('role=tab[name="Progress Reports"]').first().click();
      await pause(page, 800);
      await page.locator('main >> text="Custom"').first().click();
      await pause(page, 500);
      await page.locator('.studio-palette >> text="Templates"').first().click();
      await pause(page, 500);
      await page.locator('.studio-palette >> text="Report Card"').first().click();
      await pause(page, 7000);
      // The sheet itself, without the Undo toast below it.
      return { clip: [555, 150, 590, 672] };
    },
  },

  {
    file: 'student-learning.jpg',
    async run(page, base) {
      await openPreview(page, base);
      await page.locator('.ps-screen').getByText('My Learning', { exact: true }).last().click();
      await pause(page, 1200);
      return page.locator('.ps-screen');
    },
  },

  {
    file: 'student-feedback.jpg',
    async run(page, base) {
      await openPreview(page, base);
      await page.locator('.ps-screen').getByText(/^Back/).first().click();
      await pause(page, 1000);
      await page.locator('.ps-screen').getByText('See Your Feedback').first().click();
      await pause(page, 1500);
      return page.locator('.ps-screen');
    },
  },
  {
    file: 'phone-app.jpg',
    width: 390,
    height: 844,
    async run(page, base) {
      if (!/teacher-mobile/.test(page.url())) await page.goto(base + '/teacher-mobile/');
      await pause(page, 1500);
      // Observe: the day's notes, not the competency table.
      await page.getByText('Observe', { exact: true }).last().click();
      await pause(page, 1200);
      return { clip: [0, 0, 390, 844] };
    },
  },
];

const only = process.argv.slice(2).map(s => s.replace(/\.jpg$/, ''));
const shots = SHOTS.filter(s => !only.length || only.includes(s.file.replace(/\.jpg$/, '')));
if (!shots.length) {
  console.log('No shots to take.');
  process.exit(0);
}

let server = null;
let base = process.env.SPLASH_SHOTS_URL;
if (!base) {
  const port = Number(process.env.PORT) || 8479;
  const build = spawnSync('bash', ['scripts/build-e2e.sh'], { cwd: ROOT, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status || 1);
  server = spawn(process.execPath, ['scripts/e2e-server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((ok, fail) => {
    server.stdout.on('data', d => String(d).includes('E2E server') && ok());
    server.on('exit', code => fail(new Error('e2e-server exited ' + code)));
  });
  base = 'http://localhost:' + port;
}

mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
try {
  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: { width: shot.width || 1440, height: shot.height || 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.on('dialog', d => d.accept());
    try {
      await page.goto(base + '/login.html?demo=1');
      await page.waitForURL(/\/(dashboard|teacher-mobile)/, { timeout: 20000 });
      await pause(page, 1200);
      const target = await shot.run(page, base);
      await pause(page, 500);
      const png = join(TMP, shot.file.replace(/\.jpg$/, '.png'));
      // The Demo Mode badge is not on a signed-in teacher's screen.
      const opts = {
        path: png,
        animations: 'disabled',
        caret: 'hide',
        style: '.tb-demo-pill { display: none !important; }',
      };
      if (target && typeof target.screenshot === 'function') {
        await target.first().screenshot(opts);
      } else {
        if (target && target.clip) {
          const [x, y, width, height] = target.clip;
          opts.clip = { x, y, width, height };
        }
        await page.screenshot(opts);
      }
      const out = join(OUT, shot.file);
      const sips = spawnSync('sips', [
        '-Z',
        '1800',
        '-s',
        'format',
        'jpeg',
        '-s',
        'formatOptions',
        '78',
        png,
        '--out',
        out,
      ]);
      if (sips.status !== 0) throw new Error(String(sips.stderr));
      console.log('✓ assets/splash/' + shot.file);
    } catch (e) {
      failed++;
      console.error('✗', shot.file, e.message.split('\n')[0]);
    }
    await context.close();
  }
} finally {
  await browser.close();
  if (server) server.kill();
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
}
process.exit(failed ? 1 : 0);
