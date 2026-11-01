/**
 * The CSP the edge function sends (netlify/edge-functions/inject-env.js),
 * read from a real response: scripts only from 'self' and the nonce, and
 * no <base> or plugin content from injected markup.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

async function cspFor(html) {
  globalThis.Netlify = {
    env: { get: name => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'k' })[name] || '' },
  };
  const src = readFileSync(new URL('../netlify/edge-functions/inject-env.js', import.meta.url), 'utf-8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const res = await mod.default(new Request('https://fullvision.ca/'), {
    next: async () => new Response(html, { headers: { 'content-type': 'text/html' } }),
  });
  return res.headers.get('Content-Security-Policy') || '';
}

describe('Content-Security-Policy', () => {
  it("allows scripts only from 'self' and the nonce, and no <base> or <object>", async () => {
    const csp = await cspFor('<html><head><script src="/x.js"></script></head><body></body></html>');
    const directives = Object.fromEntries(
      csp.split(';').map(d => {
        const [name, ...rest] = d.trim().split(/\s+/);
        return [name, rest.join(' ')];
      }),
    );
    expect(directives['script-src']).toMatch(/^'self' 'nonce-[^']+'/);
    expect(directives['script-src']).not.toContain('unsafe-inline');
    expect(directives['base-uri']).toBe("'self'");
    expect(directives['object-src']).toBe("'none'");
    expect(directives['frame-ancestors']).toBe("'none'");
  });
});
