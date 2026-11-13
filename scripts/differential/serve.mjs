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
 * Each server is started on a free port and stopped by its PID. However the
 * run ends (done, a difference, an error, Ctrl+C, a kill it can catch) its
 * servers are stopped and its temporary folders removed. A folder left by a
 * run that was killed outright is removed by the next run.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);
const REPO = resolve(HERE, '..', '..');
// The run's process id is in the name, so a later run can tell a folder
// whose run is gone from one still in use.
const TEMP_PREFIX = 'fv-diff-serve-p';

/* Everything this process started and has not yet put away. */
const live = new Set();
let hooked = false;
function putAway() {
  for (const item of live) {
    try {
      if (item.child && item.child.exitCode == null && item.child.signalCode == null) process.kill(item.child.pid);
    } catch {
      /* already gone */
    }
    try {
      item.cleanup();
    } catch {
      /* nothing to remove */
    }
  }
  live.clear();
}
function hook() {
  if (hooked) return;
  hooked = true;
  process.on('exit', putAway);
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ]) {
    process.on(signal, () => process.exit(code));
  }
}

/* Remove the temporary folders of runs that are no longer running. */
function sweep() {
  let names = [];
  try {
    names = readdirSync(tmpdir());
  } catch {
    return;
  }
  for (const name of names) {
    const m = /^fv-diff-serve-p(\d+)-/.exec(name);
    if (!m || Number(m[1]) === process.pid) continue;
    try {
      process.kill(Number(m[1]), 0);
    } catch (e) {
      if (e.code === 'ESRCH') rmSync(join(tmpdir(), name), { recursive: true, force: true });
    }
  }
}

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
  const root = mkdtempSync(join(tmpdir(), TEMP_PREFIX + process.pid + '-'));
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  try {
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
  } catch (e) {
    cleanup();
    throw e;
  }
  return { root, cleanup };
}

/* Start serving `build` (a path or URL). Answers { url, pid, stop }.
   `onStopped({ label, pid, code, signal })` is called if the server stops
   when the run did not stop it. */
export async function serve(build, label, onStopped) {
  if (/^https?:\/\//.test(build)) return { url: build.replace(/\/$/, ''), stop: async () => {} };
  hook();
  sweep();
  const target = resolve(build);
  const { root, cleanup } = serverRoot(target);
  const item = { child: null, cleanup };
  live.add(item);
  const port = await freePort();
  const child = spawn(process.execPath, [join(root, 'scripts', 'e2e-server.mjs')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  item.child = child;
  let log = '';
  child.stdout.on('data', d => (log += d));
  child.stderr.on('data', d => (log += d));
  let stopping = false;
  let up = false;
  child.once('exit', (code, signal) => {
    if (!stopping && up && onStopped) onStopped({ label, pid: child.pid, code, signal, log: log.slice(-400) });
  });
  const url = 'http://localhost:' + port;
  const started = Date.now();
  const giveUp = message => {
    stopping = true;
    if (child.exitCode == null && child.signalCode == null) process.kill(child.pid);
    cleanup();
    live.delete(item);
    return new Error(message);
  };
  for (;;) {
    if (child.exitCode != null || child.signalCode != null)
      throw giveUp('The server for ' + label + ' stopped: ' + log);
    try {
      const res = await fetch(url + '/login.html');
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > 20000) throw giveUp('The server for ' + label + ' did not start: ' + log);
    await new Promise(r => setTimeout(r, 100));
  }
  up = true;
  return {
    url,
    pid: child.pid,
    stop: async () => {
      stopping = true;
      if (child.exitCode == null && child.signalCode == null) {
        process.kill(child.pid);
        await new Promise(r => child.once('exit', r));
      }
      cleanup();
      live.delete(item);
    },
  };
}
