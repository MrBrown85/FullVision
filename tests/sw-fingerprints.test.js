/**
 * The fingerprints scripts/build.sh writes into dist/sw.js
 * (scripts/sw-fingerprints.mjs), which let a new service worker copy
 * unchanged files from the previous version's cache.
 *
 * These test the function build.sh runs, on the repository's own files:
 * build.sh copies every precached file into dist/ unchanged (only HTML is
 * changed afterwards, by build-e2e.sh and the edge function, and HTML has no
 * fingerprint). e2e/sw-keep-unchanged.spec.js runs it on a real dist/.
 */
import { describe, expect, it } from 'vitest';
import { createHash, webcrypto } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  fileFor,
  fingerprint,
  fingerprintsIn,
  isPage,
  precacheUrls,
  withFingerprints,
} from '../scripts/sw-fingerprints.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swSource = readFileSync(resolve(root, 'sw.js'), 'utf-8');
const read = rel => readFileSync(resolve(root, rel));

describe('service worker fingerprints', () => {
  const urls = precacheUrls(swSource);
  const built = withFingerprints(swSource, read);
  const prints = fingerprintsIn(built);

  it('the source sw.js has none, so served directly it installs as before', () => {
    expect(fingerprintsIn(swSource)).toBeNull();
  });

  it('build.sh writes them after naming the cache, and checks they are there', () => {
    const build = readFileSync(resolve(root, 'scripts/build.sh'), 'utf-8');
    const named = build.indexOf('const CACHE_NAME');
    const printed = build.indexOf('node scripts/sw-fingerprints.mjs dist');
    expect(named).toBeGreaterThan(-1);
    expect(printed).toBeGreaterThan(named);
    expect(build).toContain('grep -q "^const PRECACHE_FINGERPRINTS = {" dist/sw.js');
  });

  it('every precached file but the HTML pages has one, matching its bytes', () => {
    const files = urls.filter(url => !isPage(url));
    expect(Object.keys(prints).sort()).toEqual(files.sort());
    for (const url of files) {
      const sha = createHash('sha256')
        .update(read(fileFor(url)))
        .digest('base64');
      expect(prints[url], url).toBe(sha);
    }
    for (const url of ['/', '/login.html', '/launch.html', '/teacher/app.html', '/teacher-mobile/index.html']) {
      expect(urls).toContain(url);
      expect(prints[url]).toBeUndefined();
    }
  });

  it('an address with a query string is keyed exactly and hashed from the file without it', () => {
    const versioned = urls.filter(url => url.includes('?'));
    expect(versioned).toEqual(expect.arrayContaining(['/shared/seed-data.js?v=46', '/teacher/styles.css?v=3']));
    for (const url of versioned) {
      expect(prints[url]).toBe(fingerprint(read(url.split('?')[0].slice(1))));
      expect(prints[url.split('?')[0]]).toBeUndefined();
    }
  });

  it('the files Reports and the other loaders fetch on demand are fingerprinted', () => {
    for (const url of ['/teacher/page-reports.js', '/teacher/report-studio.js', '/teacher/competency-wording.js']) {
      expect(prints[url]).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    }
  });

  it('changes only the fingerprint line, and running it twice gives the same file', () => {
    const before = swSource.split('\n');
    const after = built.split('\n');
    expect(after.length).toBe(before.length);
    const changed = after.filter((line, i) => line !== before[i]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatch(/^const PRECACHE_FINGERPRINTS = \{.*\};$/);
    expect(withFingerprints(built, read)).toBe(built);
  });

  it('a changed file changes only its own fingerprint', () => {
    const other = withFingerprints(swSource, rel =>
      rel === 'shared/calc.js' ? Buffer.concat([read(rel), Buffer.from('\n')]) : read(rel),
    );
    const next = fingerprintsIn(other);
    const differ = Object.keys(next).filter(url => next[url] !== prints[url]);
    expect(differ).toEqual(['/shared/calc.js']);
  });

  it('a precached address with no file fails the build', () => {
    expect(() =>
      withFingerprints(swSource, rel => {
        if (rel === 'shared/calc.js') throw new Error('ENOENT');
        return read(rel);
      }),
    ).toThrow('ENOENT');
  });

  it("the worker's hash gives the same text as the build's", async () => {
    const m = swSource.match(/async function sha256\(buffer\) \{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const sha256 = new Function('crypto', 'btoa', m[0] + '\nreturn sha256;')(webcrypto, btoa);
    for (const url of ['/shared/calc.js', '/favicon.svg', '/assets/icons/apple-touch-icon.png']) {
      const bytes = read(fileFor(url));
      expect(await sha256(bytes)).toBe(prints[url]);
    }
  });
});
