/**
 * The loading screen (shared/loading-screen.js): one copy for the desktop,
 * the phone and the student page. A page's empty <div data-fv-loading>
 * fills in with the logo and a line; the student page draws it with its
 * own lines, which stay kind and never mention marks.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import { parseHTML } from 'linkedom';

const ROOT = resolve(__dirname, '..');
const SRC = readFileSync(resolve(ROOT, 'shared/loading-screen.js'), 'utf8');
// tests/setup.js has loaded shared/html.js and shared/loading-screen.js.
const FVLoading = globalThis.FVLoading;

describe('FVLoading', () => {
  const originalDocument = globalThis.document;
  afterEach(() => {
    globalThis.document = originalDocument;
  });

  it('fills an empty loading screen with the logo and a teacher line', () => {
    const { document } = parseHTML(
      '<!doctype html><html><body><div id="app-loading" data-fv-loading="teacher"></div></body></html>',
    );
    globalThis.document = document;
    runInThisContext(SRC);
    const el = document.getElementById('app-loading');
    expect(el.classList.contains('app-loading')).toBe(true);
    expect(el.querySelector('.app-loading-logo')).not.toBeNull();
    expect(el.querySelector('.app-loading-title').textContent).toBe('FullVision');
    expect(FVLoading.LINES.teacher).toContain(el.querySelector('.app-loading-text').textContent);
  });

  it('draws the student screen in the page with a student line and an escaped label', () => {
    const { document } = parseHTML('<!doctype html><html><body><div id="app"></div></body></html>');
    const app = document.getElementById('app');
    app.innerHTML = FVLoading.html('student', 'Opening <your> page', true);
    const screen = app.querySelector('.app-loading');
    expect(screen.classList.contains('app-loading--inline')).toBe(true);
    expect(screen.getAttribute('role')).toBe('status');
    expect(screen.getAttribute('aria-label')).toBe('Opening <your> page');
    expect(FVLoading.LINES.student).toContain(app.querySelector('.app-loading-text').textContent);
  });

  it('keeps student lines short, in sentence case and off marks', () => {
    for (const line of FVLoading.LINES.student) {
      expect(line).toMatch(/^[A-Z][^A-Z]*…$/);
      expect(line.length).toBeLessThanOrEqual(45);
      expect(line).not.toMatch(/\b(grade|grades|mark|marks|score|scores|percent|test|exam|pass|fail)\b/i);
    }
  });
});

describe('the student page while it opens a link', () => {
  runInThisContext(readFileSync(resolve(ROOT, 's/student.js'), 'utf8'));
  const T = globalThis.StudentPage._test;

  it('shows the loading screen with student lines', () => {
    const state = Object.assign(T.freshState(), { screen: 'loading' });
    const html = T.render(state);
    expect(html).toContain('app-loading app-loading--inline');
    expect(html).toContain('aria-label="Opening your page"');
    const { document } = parseHTML('<!doctype html><html><body><div id="app"></div></body></html>');
    document.getElementById('app').innerHTML = html;
    const line = document.querySelector('.app-loading-text').textContent;
    expect(FVLoading.LINES.student).toContain(line);
  });
});
