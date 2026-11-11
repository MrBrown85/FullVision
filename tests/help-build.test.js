/**
 * The help site builds (scripts/build-help.mjs), and every page the in-app
 * Help panel can ask for exists: each index.json entry has a full page at
 * help/<slug>.html and a fragment at help/fragments/<slug>.html.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import {
  build,
  markdown,
  parseFrontMatter,
  readArticles,
  readShortcuts,
  shortcutsMarkdown,
} from '../scripts/build-help.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let out;
let index;

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'fv-help-'));
  build({ outDir: out });
  index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf-8'));
});

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe('help site build', () => {
  it('writes index.json in the shape the Help panel reads', () => {
    expect(index.length).toBe(readArticles().length);
    for (const e of index) {
      expect(Object.keys(e).sort()).toEqual(['demo', 'pages', 'section', 'slug', 'summary', 'title', 'video']);
      expect(Array.isArray(e.pages)).toBe(true);
      expect(e.title).toBeTruthy();
      expect(e.summary).toBeTruthy();
    }
  });

  it('has a page and a fragment for every entry, and a landing page', () => {
    expect(existsSync(join(out, 'index.html'))).toBe(true);
    for (const e of index) {
      expect(existsSync(join(out, e.slug + '.html')), e.slug + '.html').toBe(true);
      expect(existsSync(join(out, 'fragments', e.slug + '.html')), 'fragments/' + e.slug + '.html').toBe(true);
    }
  });

  it('puts the five Getting Started articles first, in order', () => {
    expect(index.slice(0, 5).map(e => e.slug)).toEqual([
      'create-a-class',
      'add-your-students',
      'get-a-class-list-from-myeducation-bc',
      'set-up-grading',
      'create-your-first-assessment',
    ]);
  });

  it('every picture an article shows is in help/img', () => {
    for (const e of index) {
      const html = readFileSync(join(out, 'fragments', e.slug + '.html'), 'utf-8');
      for (const [, src] of html.matchAll(/<img src="\/help\/(img\/[^"]+)"/g))
        expect(existsSync(join(root, 'help', src)), e.slug + ': ' + src).toBe(true);
    }
  });

  it('pages carry the footer and no email address', () => {
    for (const e of [...index.map(x => x.slug), 'index']) {
      const html = readFileSync(join(out, e + '.html'), 'utf-8');
      expect(html).toMatch(/Updated [A-Z][a-z]{2} \d{1,2}, \d{4}/);
      expect(html).toContain('>Report a Problem</a>');
      expect(html).not.toMatch(/mailto:|[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    }
  });

  it('fragments are the article alone, with no Try It link to the sign-in page', () => {
    for (const e of index) {
      const html = readFileSync(join(out, 'fragments', e.slug + '.html'), 'utf-8');
      expect(html.startsWith('<article class="help-article">')).toBe(true);
      expect(html).not.toMatch(/<html|<script|<style|login\.html/);
    }
  });
});

describe('Keyboard Shortcuts', () => {
  it('lists every shortcut the app declares, once shared/constants.js has them', () => {
    const list = readShortcuts();
    const page = readFileSync(join(out, 'fragments', 'keyboard-shortcuts.html'), 'utf-8');
    if (!list) return; // the list arrives with the in-app shortcut sheet
    for (const s of list) expect(page, s.action).toContain(s.action);
  });

  it('writes Ctrl for Control, ⌘ only when there is no Ctrl form, and Esc', () => {
    expect(
      shortcutsMarkdown([
        { context: 'Criterion Comment', action: 'Save and Next', keys: 'Meta+Enter Control+Enter' },
        { context: 'Help', action: 'Close Help', keys: 'Escape' },
      ]),
    ).toBe('## Criterion Comment\n\n- Save and Next: Ctrl+Enter\n\n## Help\n\n- Close Help: Esc');
  });
});

describe('the Markdown subset', () => {
  it('escapes text and turns marks into tags', () => {
    expect(markdown('Choose **Save** & <b>go</b>.')).toBe(
      '<p>Choose <strong>Save</strong> &amp; &lt;b&gt;go&lt;/b&gt;.</p>',
    );
  });

  it('keeps a numbered list going after a picture', () => {
    const html = markdown("1. One\n2. Two\n\n![Alt](img/x.jpg 'Cap.')\n\n3. Three");
    expect(html).toContain('<ol><li>One</li><li>Two</li></ol>');
    expect(html).toContain(
      '<figure><div class="pic"><a href="/help/img/x.jpg"><img src="/help/img/x.jpg" alt="Alt" loading="lazy" /></a></div><figcaption>Cap.</figcaption></figure>',
    );
    expect(html).toContain('<ol start="3"><li>Three</li></ol>');
  });

  it('links article slugs under /help', () => {
    expect(markdown('See [Set Up Grading](set-up-grading).')).toBe(
      '<p>See <a href="/help/set-up-grading">Set Up Grading</a>.</p>',
    );
  });

  it('reads nested front matter', () => {
    const fm = parseFrontMatter(
      "title: A # a comment\nlabels:\n  - 'Import Roster: Review Changes'\nshots:\n  - file: a.jpg\n    steps:\n      - click x\n    clip: 1,2,3,4\n",
    );
    expect(fm).toEqual({
      title: 'A',
      labels: ['Import Roster: Review Changes'],
      shots: [{ file: 'a.jpg', steps: ['click x'], clip: '1,2,3,4' }],
    });
  });
});

describe('inline Markdown', () => {
  it('reads *italic* and _italic_, and leaves underscores inside words', async () => {
    const { inline } = await import('../scripts/build-help.mjs');
    expect(inline('choose *CSV* or _CSV_.')).toBe('choose <em>CSV</em> or <em>CSV</em>.');
    expect(inline('a file_name_here stays')).toBe('a file_name_here stays');
  });
});
