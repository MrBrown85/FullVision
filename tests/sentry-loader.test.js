/**
 * Sentry's loader script comes from the project's own region. FullVision's
 * project is in the EU (ingest.de.sentry.io), whose loader is served from
 * js-de.sentry-cdn.com; the US address, js.sentry-cdn.com, answers an EU key
 * with a stand-in that does nothing. Until Nov 26, 2026 the app asked the US
 * address, and no error, overwrite count or refused write reached Sentry.
 * This pins the loader to the DSN's region, and the page's CSP to the loader.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(new URL('../shared/sentry-init.js', import.meta.url), 'utf-8');
const EDGE = readFileSync(new URL('../netlify/edge-functions/inject-env.js', import.meta.url), 'utf-8');

/* Runs sentry-init.js on fullvision.ca and returns the loader's address. */
function loaderSrc(src = SRC) {
  const added = [];
  const head = { appendChild: el => added.push(el) };
  const sandbox = {
    location: { hostname: 'fullvision.ca', href: 'https://fullvision.ca/dashboard' },
    document: { head, documentElement: head, createElement: () => ({}), querySelector: () => null },
    console,
  };
  sandbox.window = sandbox;
  runInNewContext(src, sandbox);
  return added.length ? added[0].src : null;
}

const DSN = SRC.match(/SENTRY_DSN = '([^']+)'/)[1];

describe('the Sentry loader', () => {
  it("is the EU loader for FullVision's EU key", () => {
    expect(DSN).toContain('.ingest.de.sentry.io/');
    const key = DSN.match(/^https:\/\/([^@]+)@/)[1];
    expect(loaderSrc()).toBe('https://js-de.sentry-cdn.com/' + key + '.min.js');
  });

  it('a key outside the EU gets the main loader', () => {
    const other = SRC.replace(/SENTRY_DSN = '[^']+'/, "SENTRY_DSN = 'https://abc123@o1.ingest.sentry.io/2'");
    expect(loaderSrc(other)).toBe('https://js.sentry-cdn.com/abc123.min.js');
  });

  it("is allowed by the page's script-src", () => {
    const scriptSrc = EDGE.match(/`script-src ([^`]+)`/)[1].split(/\s+/);
    expect(scriptSrc).toContain('https://' + new URL(loaderSrc()).host);
    // The SDK bundle the loader fetches.
    expect(scriptSrc).toContain('https://browser.sentry-cdn.com');
  });
});
