#!/usr/bin/env node
/**
 * Retakes the help site's pictures (help/img/*.jpg) from Demo Mode.
 *
 * Each article lists its pictures under `shots:` in its front matter. For each
 * one this opens a fresh Demo Mode at 1440 wide (or `width`) and 2x, goes to `route`, runs
 * the `steps`, and saves the `selector` element or the `clip` area. macOS
 * `sips` then scales it to 1800px on the long side as JPEG quality 78, the
 * same as the splash page's pictures in assets/splash.
 *
 * Run by hand after a UI change, not in CI:
 *   node scripts/help-shots.mjs                 every article's pictures
 *   node scripts/help-shots.mjs create-a-class  one article's
 *
 * It builds dist/ (scripts/build-e2e.sh) and serves it through
 * scripts/e2e-server.mjs, so pages get the production CSP. Set
 * HELP_SHOTS_URL=http://localhost:<port> to use a server already running.
 *
 * Steps, one per line (selectors are Playwright selectors):
 *   click <selector>
 *   fill <selector> | <text>
 *   select <selector> | <option label>
 *   upload <selector> | <file in the repo>
 *   hover <selector>
 *   press <key>
 *   scroll <selector>          scrolls the element into view
 *   wait <ms>
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { readArticles } from './build-help.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMG = join(ROOT, 'help', 'img');
const TMP = join(ROOT, 'test-results', 'help-shots');

const only = process.argv.slice(2);
const articles = readArticles().filter(a => a.shots.length && (!only.length || only.includes(a.slug)));
if (!articles.length) {
  console.log('No shots to take.');
  process.exit(0);
}
if (spawnSync('which', ['sips']).status !== 0) {
  console.error('help-shots needs macOS sips to scale the pictures.');
  process.exit(1);
}

let server = null;
let base = process.env.HELP_SHOTS_URL;
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

function splitArg(rest) {
  const i = rest.indexOf(' | ');
  return i < 0 ? [rest, ''] : [rest.slice(0, i), rest.slice(i + 3)];
}

async function runStep(page, step) {
  const m = String(step).match(/^(\w+)\s*(.*)$/);
  if (!m) throw new Error('Step not understood: ' + step);
  const [, verb, rest] = m;
  const [sel, arg] = splitArg(rest);
  // The first match that is on screen: hidden copies (tooltips, closed menus) are skipped.
  const el = () => page.locator(sel).filter({ visible: true }).first();
  switch (verb) {
    case 'click':
      return el().click();
    case 'fill':
      return el().fill(arg);
    case 'select':
      return el().selectOption({ label: arg });
    case 'upload':
      return page.locator(sel).first().setInputFiles(join(ROOT, arg));
    case 'hover':
      return el().hover();
    case 'press':
      return page.keyboard.press(rest);
    case 'scroll':
      return page.locator(sel).first().scrollIntoViewIfNeeded();
    case 'wait':
      return page.waitForTimeout(Number(rest));
    default:
      throw new Error('Unknown step: ' + step);
  }
}

mkdirSync(IMG, { recursive: true });
mkdirSync(TMP, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
try {
  for (const a of articles) {
    for (const shot of a.shots) {
      if (!shot.file || !/\.jpg$/.test(shot.file)) throw new Error(`${a.slug}: each shot needs a .jpg file name`);
      const context = await browser.newContext({
        viewport: { width: Number(shot.width) || 1440, height: Number(shot.height) || 900 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      page.on('dialog', d => d.accept());
      try {
        await page.goto(base + '/login.html?demo=1');
        await page.waitForURL(/\/(dashboard|teacher-mobile)/, { timeout: 20000 });
        await page.waitForTimeout(1200);
        if (shot.route && !page.url().endsWith(shot.route)) {
          await page.goto(base + shot.route);
          await page.waitForTimeout(1200);
        }
        for (const step of shot.steps || []) {
          await runStep(page, step).catch(e => {
            throw new Error(`step "${step}": ${e.message}`);
          });
          await page.waitForTimeout(350);
        }
        await page.waitForTimeout(500);
        const png = join(TMP, shot.file.replace(/\.jpg$/, '.png'));
        const opts = { path: png, animations: 'disabled', caret: 'hide' };
        if (shot.selector) {
          await page.locator(shot.selector).first().screenshot(opts);
        } else {
          if (shot.clip) {
            const [x, y, width, height] = String(shot.clip).split(',').map(Number);
            opts.clip = { x, y, width, height };
          }
          await page.screenshot(opts);
        }
        const out = join(IMG, shot.file);
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
        console.log('✓', a.slug, '→ help/img/' + shot.file);
      } catch (e) {
        failed++;
        console.error('✗', a.slug, shot.file, e.message.split('\n')[0]);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  if (server) server.kill();
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
}
process.exit(failed ? 1 : 0);
