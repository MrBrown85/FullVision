/**
 * The pure parts of scripts/check-live-caching.mjs: reading the nonce, the
 * script tags, the placeholders, the page list and the verdict.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  cspNonce,
  pageAddresses,
  pageProblems,
  parseArgs,
  placeholdersGone,
  routerRoutes,
  scriptNonces,
} from '../scripts/check-live-caching.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const router = readFileSync(resolve(root, 'teacher/router.js'), 'utf-8');

const goodPage = {
  path: '/login.html',
  status: 200,
  csp: true,
  nonce: true,
  nonceChanges: true,
  scripts: 3,
  withNonce: 3,
  placeholdersGone: true,
  security: {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000',
  },
};

describe('check-live-caching', () => {
  it('reads the nonce from a policy', () => {
    expect(cspNonce("default-src 'self'; script-src 'self' 'nonce-abc-123' https://x")).toBe('abc-123');
    expect(cspNonce("default-src 'self'")).toBeNull();
    expect(cspNonce(null)).toBeNull();
  });

  it('counts script tags carrying the nonce, not <scripted> look-alikes', () => {
    const html = '<script nonce="n1" src="a.js"></script><script>x</script><scripted></scripted><SCRIPT nonce="n1">';
    expect(scriptNonces(html, 'n1')).toEqual({ scripts: 3, withNonce: 2 });
    expect(scriptNonces(html, null)).toEqual({ scripts: 3, withNonce: 0 });
  });

  it('sees a placeholder left in the HTML', () => {
    expect(placeholdersGone('<script>var u="https://x.supabase.co"</script>')).toBe(true);
    expect(placeholdersGone('<script>var u="__SUPABASE_URL__"</script>')).toBe(false);
    expect(placeholdersGone('__SUPABASE_KEY__')).toBe(false);
  });

  it('lists every clean route from the router, and the HTML pages', () => {
    const routes = routerRoutes(router);
    expect(routes).toContain('/dashboard');
    const pages = pageAddresses(router, name => name === 'launch.html');
    for (const p of ['/', '/login.html', '/s/', '/teacher-mobile/', '/launch.html', '/help/', ...routes])
      expect(pages).toContain(p);
    expect(pageAddresses(router, () => false)).not.toContain('/launch.html');
  });

  it('a complete page has no problems; each missing piece is named', () => {
    expect(pageProblems(goodPage)).toEqual([]);
    expect(pageProblems({ ...goodPage, csp: false, nonce: false, nonceChanges: false })).toContain('no policy');
    expect(pageProblems({ ...goodPage, nonceChanges: false })).toContain('nonce repeats');
    expect(pageProblems({ ...goodPage, withNonce: 2 })).toContain('script tags without the nonce');
    expect(pageProblems({ ...goodPage, placeholdersGone: false })).toContain('Supabase address not injected');
    expect(pageProblems({ ...goodPage, status: 404 })).toContain('status 404');
  });

  it('takes a base address and the two expect flags', () => {
    expect(parseArgs([])).toEqual({ base: 'https://fullvision.ca', expect304: false, expectPagesOk: false });
    expect(parseArgs(['http://localhost:8347/', '--expect-304', '--expect-pages-ok'])).toEqual({
      base: 'http://localhost:8347',
      expect304: true,
      expectPagesOk: true,
    });
    expect(parseArgs(['--base=http://127.0.0.1:1']).base).toBe('http://127.0.0.1:1');
    expect(() => parseArgs(['--nope'])).toThrow();
  });
});
