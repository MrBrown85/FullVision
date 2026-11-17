/**
 * The CSP the edge function sends (netlify/edge-functions/inject-env.js),
 * read from a real response: scripts only from 'self' and the nonce, and
 * no <base> or plugin content from injected markup.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

async function cspFor(html, path = '/', headers = {}) {
  globalThis.Netlify = {
    env: { get: name => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'k' })[name] || '' },
  };
  const src = readFileSync(new URL('../netlify/edge-functions/inject-env.js', import.meta.url), 'utf-8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const res = await mod.default(new Request('https://fullvision.ca' + path), {
    next: async () => new Response(html, { headers: { 'content-type': 'text/html', ...headers } }),
  });
  return path === '/' ? res.headers.get('Content-Security-Policy') || '' : res;
}

const directivesOf = csp =>
  Object.fromEntries(
    csp.split(';').map(d => {
      const [name, ...rest] = d.trim().split(/\s+/);
      return [name, rest.join(' ')];
    }),
  );

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

  /* The sealed frame a teacher's web page or EPUB opens in (shared/handout-frame.html; 2026111706):
     its own policy, sealed by the sandbox directive whoever opens it, framed only by FullVision. */
  it('gives the handout frame a sealed policy of its own, and only that address', async () => {
    const res = await cspFor('<html><body><script>x</script></body></html>', '/shared/handout-frame.html', {
      'x-frame-options': 'DENY',
    });
    const d = directivesOf(res.headers.get('Content-Security-Policy'));
    expect(d.sandbox).toBe('allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals');
    expect(d.sandbox).not.toContain('allow-same-origin');
    expect(d.sandbox).not.toContain('allow-top-navigation');
    expect(d['frame-ancestors']).toBe("'self'");
    expect(d['default-src']).toBe("'none'");
    expect(d['form-action']).toBe("'none'");
    expect(d['script-src']).toBe("'unsafe-inline' 'unsafe-eval' data: blob:");
    // Nothing from the internet (Colin's privacy call, Nov 17 2026): inline and data: only.
    expect(d['img-src']).toBe('data: blob:');
    expect(d['style-src']).toBe("'unsafe-inline' data: blob:");
    expect(d['font-src']).toBe('data: blob:');
    expect(d['media-src']).toBe('data: blob:');
    expect(d['connect-src']).toBe("'none'");
    expect(d['frame-src']).toBe("'none'");
    expect(res.headers.get('Content-Security-Policy')).not.toMatch(/https?:|\*/);
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    // Any other page keeps the nonce policy, and cannot be framed.
    const other = directivesOf(await cspFor('<html></html>'));
    expect(other['frame-ancestors']).toBe("'none'");
    expect(other.sandbox).toBeUndefined();
  });
});
