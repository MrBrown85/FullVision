/**
 * The differential run's command line (scripts/differential-run.mjs).
 */

import { WRITERS } from './writers.mjs';

export const USAGE =
  'node scripts/differential-run.mjs --a <dir or URL> --b <dir or URL> --seed <n> --steps <n>\n' +
  '  [--mode signed-in|demo|both] [--offline] [--two-tabs] [--screens-every <n>] [--must-reach <writer,writer,...>]';

/* A whole number written in digits and nothing else, at least `min`. A typo
   ("7 a", "1e3", "") is refused: run as it stood it would name one sequence
   and run another. */
function wholeNumber(option, text, min) {
  if (typeof text !== 'string' || !/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < min) {
    throw new Error(
      option +
        ' takes a whole number' +
        (min > 0 ? ' of ' + min + ' or more' : '') +
        ', written in digits; it was given ' +
        (text === undefined ? 'nothing' : JSON.stringify(text)),
    );
  }
  return Number(text);
}

/* --must-reach: writer names from writers.mjs, comma-separated. A name
   that is not a writer is refused, so a typo cannot pass unseen. */
function mustReach(text) {
  const names = text
    .split(',')
    .map(n => n.trim())
    .filter(Boolean);
  const unknown = names.filter(n => !(n in WRITERS));
  if (!names.length || unknown.length) {
    throw new Error(
      '--must-reach takes writer names from scripts/differential/writers.mjs; ' +
        (names.length ? 'not writers: ' + unknown.join(', ') : 'it was given none'),
    );
  }
  return names;
}

/* The options, or an Error saying what is wrong with them. */
export function parseArgs(argv) {
  const opts = { mode: 'both', seed: 1, steps: 100, offline: false, twoTabs: false, screensEvery: 25, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => {
      if (i + 1 >= argv.length) throw new Error(k + ' needs a value');
      return argv[++i];
    };
    if (k === '--a') opts.a = v();
    else if (k === '--b') opts.b = v();
    else if (k === '--seed') opts.seed = wholeNumber(k, v(), 0);
    else if (k === '--steps') opts.steps = wholeNumber(k, v(), 1);
    else if (k === '--mode') opts.mode = v();
    else if (k === '--offline') opts.offline = true;
    else if (k === '--two-tabs') opts.twoTabs = true;
    else if (k === '--screens-every') opts.screensEvery = wholeNumber(k, v(), 0);
    else if (k === '--must-reach') opts.mustReach = mustReach(v());
    else if (k === '--quiet') opts.quiet = true;
    else if (k === '--help' || k === '-h') opts.help = true;
    else throw new Error('Unknown option ' + k);
  }
  if (!['signed-in', 'demo', 'both'].includes(opts.mode)) throw new Error('--mode is signed-in, demo or both');
  return opts;
}
