/**
 * Serves a build for a differential run through scripts/e2e-server.mjs, the
 * server the browser specs use (it runs the production edge function, so
 * pages get the live site's CSP).
 *
 * A build is one of:
 * - a URL: used as it is, nothing is started;
 * - a repo checkout with a built dist/ (npm run build:e2e): its own
 *   scripts/e2e-server.mjs serves its own dist/;
 * - a built site folder (a dist/ on its own, for example a throwaway copy
 *   with one change): this repo's e2e-server.mjs and edge function serve it,
 *   from a small temporary folder that links to it as dist/.
 *
 * Each server is started on a free port and stopped by its PID.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);
const REPO = resolve(HERE, '..', '..');

export function freePort() {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

/* The folder whose scripts/e2e-server.mjs serves `target`, and a clean-up. */
function serverRoot(target) {
  if (existsSync(join(target, 'scripts', 'e2e-server.mjs')) && existsSync(join(target, 'dist'))) {
    return { root: target, cleanup: () => {} };
  }
  if (!existsSync(join(target, 'teacher', 'app.html'))) {
    throw new Error(target + ' is neither a repo checkout with a built dist/ nor a built site folder');
  }
  const root = mkdtempSync(join(tmpdir(), 'fv-diff-serve-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'netlify', 'edge-functions'), { recursive: true });
  for (const f of [
    'scripts/e2e-server.mjs',
    'scripts/edge-function-paths.mjs',
    'netlify/edge-functions/inject-env.js',
    'netlify.toml',
  ]) {
    copyFileSync(join(REPO, f), join(root, f));
  }
  symlinkSync(resolve(target), join(root, 'dist'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/* Start serving `build` (a path or URL). Answers { url, stop }. */
export async function serve(build, label) {
  if (/^https?:\/\//.test(build)) return { url: build.replace(/\/$/, ''), stop: async () => {} };
  const target = resolve(build);
  const { root, cleanup } = serverRoot(target);
  const port = await freePort();
  const child = spawn(process.execPath, [join(root, 'scripts', 'e2e-server.mjs')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => (log += d));
  child.stderr.on('data', d => (log += d));
  const url = 'http://localhost:' + port;
  const started = Date.now();
  for (;;) {
    if (child.exitCode != null) throw new Error('The server for ' + label + ' stopped: ' + log);
    try {
      const res = await fetch(url + '/login.html');
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > 20000) {
      process.kill(child.pid);
      throw new Error('The server for ' + label + ' did not start: ' + log);
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return {
    url,
    pid: child.pid,
    stop: async () => {
      if (child.exitCode == null) {
        process.kill(child.pid);
        await new Promise(r => child.once('exit', r));
      }
      cleanup();
    },
  };
}
