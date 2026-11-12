#!/usr/bin/env node
/**
 * Writes each precached file's fingerprint into dist/sw.js (run by
 * scripts/build.sh after it names the cache).
 *
 * A fingerprint is the SHA-256 of the file exactly as it is in dist/, in
 * base64. On install, the new worker copies a file from the previous
 * version's cache instead of downloading it only when the copy's own bytes
 * hash to this value (sw.js, keepUnchanged). HTML pages get none: the edge
 * function (netlify/edge-functions/inject-env.js) rewrites every HTML
 * response with a fresh nonce, so the stored copy never matches the file and
 * pages are always downloaded.
 *
 * The source sw.js keeps `const PRECACHE_FINGERPRINTS = null;`, and with
 * null the worker installs exactly as it did before fingerprints existed.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const LIST = /const PRECACHE_URLS = (\[[\s\S]*?\]);/;
const LINE = /^const PRECACHE_FINGERPRINTS = .*;$/m;

export function fingerprint(bytes) {
  return createHash('sha256').update(bytes).digest('base64');
}

export function precacheUrls(swSource) {
  const match = swSource.match(LIST);
  if (!match) throw new Error('sw.js: PRECACHE_URLS not found');
  return new Function('return ' + match[1])();
}

/* Pages the edge function rewrites per request. */
export function isPage(url) {
  const path = url.split('?')[0];
  return path.endsWith('/') || path.endsWith('.html');
}

/* The file an address is served from: the path without its query. */
export function fileFor(url) {
  return url.split('?')[0].slice(1);
}

/**
 * Returns swSource with its PRECACHE_FINGERPRINTS line filled in.
 * readFile(relativePath) returns the file's bytes as served; a missing file
 * throws, so a precached address with no file fails the build instead of
 * every install.
 */
export function withFingerprints(swSource, readFile) {
  if (!LINE.test(swSource)) throw new Error('sw.js: PRECACHE_FINGERPRINTS line not found');
  const prints = {};
  for (const url of precacheUrls(swSource)) {
    if (isPage(url)) continue;
    prints[url] = fingerprint(readFile(fileFor(url)));
  }
  return swSource.replace(LINE, () => 'const PRECACHE_FINGERPRINTS = ' + JSON.stringify(prints) + ';');
}

/* The fingerprints a built sw.js carries (null in the source). */
export function fingerprintsIn(swSource) {
  const match = swSource.match(LINE);
  if (!match) throw new Error('sw.js: PRECACHE_FINGERPRINTS line not found');
  return JSON.parse(match[0].replace(/^const PRECACHE_FINGERPRINTS = /, '').replace(/;$/, ''));
}

// Run as a script (build.sh); imported by tests, it only exports.
if (/sw-fingerprints\.mjs$/.test(process.argv[1] || '')) {
  const dist = resolve(process.argv[2] || 'dist');
  const swPath = join(dist, 'sw.js');
  const built = withFingerprints(readFileSync(swPath, 'utf-8'), rel => readFileSync(join(dist, rel)));
  writeFileSync(swPath, built);
  console.log('sw.js: ' + Object.keys(fingerprintsIn(built)).length + ' fingerprints written');
}
