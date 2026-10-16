/**
 * No inline event-handler attributes.
 *
 * The CSP (netlify/edge-functions/inject-env.js) allows scripts only from
 * 'self' and a per-request nonce, so browsers silently ignore inline
 * attributes like onchange="…". Three survived the switch to that policy:
 * the sidebar class picker and roster search did nothing, and the report
 * narrative never marked itself unsaved. Handlers must be wired with
 * addEventListener or the data-action delegation the pages already use.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, dirname, relative, join } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['teacher', 'teacher-mobile', 'shared'];
const ROOT_PAGES = ['index.html', 'login.html', 'privacy.html'];

function sourceFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(js|html)$/.test(name) ? [path] : [];
  });
}

// An on<event>= attribute written into markup: preceded by whitespace and
// followed by a quote, so property assignments like el.onload = fn don't match.
const INLINE_HANDLER = /\son[a-z]+\s*=\s*["'`\\]/gi;

describe('inline event handlers', () => {
  it('appear nowhere in pages or templates', () => {
    const files = [...DIRS.flatMap(d => sourceFiles(resolve(root, d))), ...ROOT_PAGES.map(p => resolve(root, p))];
    const hits = [];
    files.forEach(file => {
      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (INLINE_HANDLER.test(line)) hits.push(relative(root, file) + ':' + (i + 1) + '  ' + line.trim());
          INLINE_HANDLER.lastIndex = 0;
        });
    });
    expect(hits).toEqual([]);
  });
});
