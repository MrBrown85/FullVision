#!/usr/bin/env node
/**
 * Local dev server — mirrors netlify/edge-functions/inject-env.js so the app
 * can run signed-in against gradebook-prod without a Netlify deploy.
 *
 * Reads SUPABASE_URL + SUPABASE_KEY from `.env` at the repo root (or from real
 * env vars if already set), substitutes the `__SUPABASE_URL__` /
 * `__SUPABASE_KEY__` placeholders in every served .html file, and sets the
 * same CSP-with-nonce that the production edge function sets.
 *
 * Run with: npm run dev:local
 *
 * .env format (do NOT commit this file — .gitignore covers it):
 *   SUPABASE_URL=https://novsfeqjhbleyyaztmlh.supabase.co
 *   SUPABASE_KEY=sb_publishable_xxxxxxxxxxxx
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT) || 8347;

const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and/or SUPABASE_KEY not set. Signed-in mode will fail.');
  console.error('Create .env at repo root or export them before running.');
  console.error('Demo Mode will still work.');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function resolvePath(urlPath) {
  if (urlPath === '/' || urlPath === '') return '/login.html';
  if (urlPath === '/app.html') return '/teacher/app.html';
  return urlPath;
}

function processHtml(html) {
  const nonce = randomUUID();
  const processed = html
    .replaceAll('__SUPABASE_URL__', SUPABASE_URL)
    .replaceAll('__SUPABASE_KEY__', SUPABASE_KEY)
    .replace(/<(script|style)(?=[\s>])/gi, `<$1 nonce="${nonce}"`);
  return { html: processed, nonce };
}

function cspHeader(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.nsvcs.net",
    "worker-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const resolved = resolvePath(urlPath);
    const diskPath = join(ROOT, resolved);

    if (!diskPath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let body;
    try {
      body = await readFile(diskPath);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found: ' + resolved);
      return;
    }

    const ext = extname(diskPath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';

    if (ext === '.html') {
      const { html, nonce } = processHtml(body.toString('utf-8'));
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': cspHeader(nonce),
      });
      res.end(html);
      return;
    }

    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(body);
  } catch (error) {
    console.error('500:', error);
    res.writeHead(500).end('Internal server error');
  }
});

server.listen(PORT, () => {
  console.log(`FullVision dev server listening on http://localhost:${PORT}`);
  console.log(`SUPABASE_URL=${SUPABASE_URL || '(not set — Demo Mode only)'}`);
  console.log(`SUPABASE_KEY=${SUPABASE_KEY ? SUPABASE_KEY.slice(0, 20) + '…' : '(not set)'}`);
});
