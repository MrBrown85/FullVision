/* For the pins that go before a screen's writes move onto shared/grader.js
   (S1-T1 and after; docs/plans/student-page-build-plan.md, 1.4).

   recordWriters() notes each call a screen makes to a score writer in
   shared/data.js: the writer's name and the arguments it was given, in
   order. Only the screen's own calls are kept. A writer that calls another
   (setPointsScore saving the score list, a status that clears levels) is
   one call, the screen's. A call that reaches the writer through
   shared/grader.js is recorded the same way, so a pin holds across the
   move only if the grader passes on the same writer, the same arguments
   and the same order.

   The writers are the list tests/grader-guard.test.js counts, read from
   that file so the two cannot drift, plus any names given in `more`
   (window.clearScore, saveAssessments …). */
import { readFileSync } from 'fs';

const GUARD = readFileSync('tests/grader-guard.test.js', 'utf-8');
const LIST = GUARD.slice(GUARD.indexOf('const WRITERS = ['), GUARD.indexOf('\n];', GUARD.indexOf('const WRITERS = [')));
export const WRITERS = Array.from(LIST.matchAll(/^\s*'(\w+)'/gm), m => m[1]);

/* A copy of an argument as it was when the call was made: the screens
   change their lists after saving them. `created` is the clock, so it is
   left out, as entries() leaves it out. */
function snapshot(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(snapshot);
  const out = {};
  Object.keys(value).forEach(k => {
    if (k !== 'created') out[k] = snapshot(value[k]);
  });
  return out;
}

export function recordWriters(more = []) {
  const names = WRITERS.concat(more).filter(name => typeof globalThis[name] === 'function');
  const real = {};
  const calls = [];
  let depth = 0;
  let from = 0;
  names.forEach(name => {
    real[name] = globalThis[name];
    globalThis[name] = function () {
      if (depth === 0) {
        const args = Array.from(arguments, snapshot);
        // An argument left out and one passed as undefined are the same to
        // the writer.
        while (args.length && args[args.length - 1] === undefined) args.pop();
        calls.push([name].concat(args));
      }
      depth++;
      try {
        return real[name].apply(this, arguments);
      } finally {
        depth--;
      }
    };
  });
  return {
    /* Every call so far, oldest first, as [writer, ...arguments]. */
    calls: () => calls.slice(),
    /* The calls since the last since(). */
    since() {
      const out = calls.slice(from);
      from = calls.length;
      return out;
    },
    stop() {
      names.forEach(name => {
        globalThis[name] = real[name];
      });
    },
  };
}
