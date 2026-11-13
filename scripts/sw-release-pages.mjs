#!/usr/bin/env node
/**
 * Writes the release's name into each page the service worker saves (run by
 * scripts/build.sh after it names the cache).
 *
 * The name is the worker's cache name, read from dist/sw.js, so the two
 * cannot differ. Each page carries it in one tag:
 *   <meta name="fv-release" content="fullvision-…" />
 * The worker reads that tag from the page it hands to the browser (sw.js,
 * RELEASE_TAG) and answers a file from its saved copy only for a page that
 * names its own release. A page with no tag, or with another release's name,
 * gets its files from the network (docs/plans/caching-plan.md, option (a)).
 *
 * The pages are the ones the worker saves at install (PRECACHE_URLS), by
 * file. "/" is whatever the host serves there and is not one of them. The
 * student page (s/) registers no worker and carries no tag.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileFor, isPage, precacheUrls } from './sw-fingerprints.mjs';

const CACHE_NAME = /const CACHE_NAME = '([^']*)';/;
// The same text sw.js looks for; tests/sw-saved-copy-first.test.js checks
// that the worker reads what this writes.
const TAG = /<meta name="fv-release" content="[^"]*"/g;

export function cacheName(swSource) {
  const match = swSource.match(CACHE_NAME);
  if (!match) throw new Error('sw.js: CACHE_NAME not found');
  return match[1];
}

/* The files that carry the tag: every saved page with a file of its own. */
export function releasePages(swSource) {
  return precacheUrls(swSource)
    .filter(url => isPage(url) && url !== '/')
    .map(fileFor);
}

/* The release a page names, or null. */
export function releaseIn(html) {
  const tags = html.match(TAG) || [];
  return tags.length === 1 ? tags[0].replace(/^.*content="/, '').replace(/"$/, '') : null;
}

/* The page naming `name`. A page without exactly one tag throws, so a page
   that lost its tag fails the build instead of quietly using the network. */
export function withRelease(html, name) {
  const tags = html.match(TAG) || [];
  if (tags.length !== 1) throw new Error('expected one fv-release tag, found ' + tags.length);
  if (!/^[\w.-]+$/.test(name)) throw new Error('not a release name: ' + name);
  return html.replace(TAG, () => '<meta name="fv-release" content="' + name + '"');
}

// Run as a script (build.sh); imported by tests, it only exports.
if (/sw-release-pages\.mjs$/.test(process.argv[1] || '')) {
  const dist = resolve(process.argv[2] || 'dist');
  const sw = readFileSync(join(dist, 'sw.js'), 'utf-8');
  const name = cacheName(sw);
  const pages = releasePages(sw);
  for (const page of pages) {
    const path = join(dist, page);
    let html;
    try {
      html = withRelease(readFileSync(path, 'utf-8'), name);
    } catch (error) {
      throw new Error(page + ': ' + error.message);
    }
    writeFileSync(path, html);
  }
  console.log('release ' + name + ' written into ' + pages.length + ' pages');
}
