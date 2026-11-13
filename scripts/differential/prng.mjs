/**
 * The seeded pseudo-random sequence a differential run picks its actions
 * from. The same seed gives the same sequence on every machine, so build A
 * and build B are driven through the same steps, and a run can be repeated.
 */

/* mulberry32: small, fast, and the same everywhere. */
export function makeRng(seed) {
  let state = seed >>> 0;
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rng = {
    next,
    /* A whole number from 0 to n - 1. */
    int: n => Math.floor(next() * n),
    /* True with probability p. */
    chance: p => next() < p,
    /* One item of a list, or undefined for an empty one. */
    pick: list => (list.length ? list[Math.floor(next() * list.length)] : undefined),
    /* `count` different items of a list, in the list's order. */
    some: (list, count) => {
      const idx = list.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      return idx
        .slice(0, Math.min(count, list.length))
        .sort((a, b) => a - b)
        .map(i => list[i]);
    },
    /* One of `items` ({ weight }), chosen by weight. */
    weighted: items => {
      const total = items.reduce((n, it) => n + it.weight, 0);
      let r = next() * total;
      for (const it of items) {
        r -= it.weight;
        if (r < 0) return it;
      }
      return items[items.length - 1];
    },
  };
  return rng;
}
