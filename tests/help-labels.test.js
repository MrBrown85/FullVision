/**
 * Help articles quote the app's labels word for word (docs/help-authoring.md).
 *
 * Every entry in an article's `labels` front matter must appear in the app's
 * source exactly, as a whole string or element text (after a quote or ">",
 * before a quote, "<", ":", "…" or a ▾ or › mark), so "Save" is not found inside "Save
 * Categories". Every **bold** phrase in its steps must be one of its labels.
 * Rename a button and this fails until the help article is updated.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readArticles } from '../scripts/build-help.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles() {
  const files = [];
  const add = (dir, test) =>
    readdirSync(join(root, dir))
      .filter(test)
      .forEach(f => files.push(join(root, dir, f)));
  add('teacher', f => f.endsWith('.js') || f.endsWith('.html'));
  add('teacher-mobile', f => f.endsWith('.js') || f === 'index.html');
  add('shared', f => f.endsWith('.js'));
  files.push(join(root, 'login.html'));
  return files;
}

// The app writes labels inside JS strings and HTML, so undo the escapes a
// label can carry there before matching.
function unescape(text) {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(['"`])/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

const source = sourceFiles()
  .map(f => unescape(readFileSync(f, 'utf-8')))
  .join('\n');
const articles = readArticles();
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const onScreen = label =>
  new RegExp('(^|[>\'"`]\\s*)' + reEsc(String(label)) + '(\\s*[<\'"`:…▾›]|\\s*$)', 'm').test(source);

describe('help articles quote real labels', () => {
  it('has articles', () => {
    expect(articles.length).toBeGreaterThan(0);
  });

  for (const a of articles) {
    it(`${a.slug}: every label is in the app`, () => {
      const missing = a.labels.filter(label => !onScreen(label));
      expect(missing, `Labels in help/articles/${a.slug}.md not found in the app`).toEqual([]);
    });

    it(`${a.slug}: every bold phrase is a listed label`, () => {
      const bold = [...a.body.matchAll(/\*\*([^*]+)\*\*/g)].map(m => m[1].replace(/:$/, '').trim());
      const unlisted = [...new Set(bold)].filter(b => !a.labels.includes(b));
      expect(unlisted, `Bold phrases in help/articles/${a.slug}.md missing from its labels`).toEqual([]);
    });
  }
});
