// The four security headers every page must carry. Today they come from
// _headers. The move to netlify.toml (S19-A9) can point the same
// assertions at the new file by changing HEADERS_FILE and parseBlocks.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(resolve(ROOT, rel), 'utf8');

const HEADERS_FILE = '_headers';
const ALL_PAGES = '/*';
const EXPECTED_HEADERS = [
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
];

// A path line with no leading space starts a block. Indented
// "Name: value" lines belong to the block above them.
function parseBlocks(text) {
  const blocks = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = line.trim();
      blocks[current] = blocks[current] || [];
      continue;
    }
    const m = line.trim().match(/^([^:]+):\s*(.*)$/);
    if (m && current) blocks[current].push([m[1].trim(), m[2].trim()]);
  }
  return blocks;
}

describe('security headers', () => {
  const blocks = parseBlocks(read(HEADERS_FILE));

  it('the all-pages block exists', () => {
    expect(Object.keys(blocks)).toContain(ALL_PAGES);
  });

  it('the all-pages block has exactly the four security headers', () => {
    expect(blocks[ALL_PAGES]).toEqual(EXPECTED_HEADERS);
  });

  it('each security header has its expected value', () => {
    const found = Object.fromEntries(blocks[ALL_PAGES]);
    for (const [name, value] of EXPECTED_HEADERS) {
      expect(found[name], name).toBe(value);
    }
  });

  it('the build copies the headers file into dist', () => {
    expect(read('scripts/build.sh')).toContain('cp roster-template.csv _headers dist/');
  });
});
