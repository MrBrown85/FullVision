/**
 * The run's check on itself: build A and build B must be asked exactly the
 * same things, in the same order. A read is not free. Calling into the app
 * can change what it holds in memory (getScores marks its scores as checked
 * against the rubrics, for one), so a read made in A and not in B leaves the
 * two builds apart, and a later step reports a difference the builds do not
 * have.
 *
 * Every page.evaluate the run makes is noted per build (watch). At every
 * comparison the two lists must be the same (firstUnlike), or the run stops
 * and says it is at fault.
 *
 * Left out: the run's own waiting, which looks only at what the page-init
 * script keeps (window.__diff…) and at storage, never calls the app, and is
 * repeated until a page is quiet, so its count follows real time.
 */

const WAITING = /__diffPending|__diffBarrierSend|__diffDeliver|__diffSeen/;

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

/* What one page.evaluate asks, as a short line: the start of its code and a
   hash of all of it with its argument. null for the run's own waiting. */
export function fingerprint(fn, arg) {
  const src = typeof fn === 'function' ? fn.toString() : String(fn);
  if (WAITING.test(src)) return null;
  let given = '';
  try {
    given = arg === undefined ? '' : JSON.stringify(arg);
  } catch {
    given = '(not JSON)';
  }
  return src.replace(/\s+/g, ' ').slice(0, 70) + ' #' + hash(src + '|' + given);
}

/* Note every page.evaluate made on `page` in `list`, as `tab` names it. */
export function watch(page, list, tab) {
  const evaluate = page.evaluate.bind(page);
  page.evaluate = (fn, arg) => {
    const line = fingerprint(fn, arg);
    if (line) list.push(tab() + ': ' + line);
    return evaluate(fn, arg);
  };
  return page;
}

/* Where two builds' lists first differ: { at, a, b }, or null when they are
   the same. */
export function firstUnlike(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return { at: i + 1, a: a[i] || '(nothing more)', b: b[i] || '(nothing more)' };
  }
  return null;
}
