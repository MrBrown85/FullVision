/* How many times a printed secret (a card's code or password) is found in
   what a device keeps, for the checks that a card's code and password are
   never written anywhere (tests/student-cards.test.js,
   e2e/cm-student-cards.spec.js).

   A card password is four digits, and a device already keeps hundreds of
   four-digit strings (dates, ids, scores), so "not found anywhere" fails by
   chance about once in thirty runs. The checks instead take what is kept
   before the cards are made and ask that afterwards the secret is found no
   more often than before: a secret written anywhere adds one.

   What making cards itself adds is left out before counting, since it is
   made from the clock and random numbers, never from a card's secret:
   dates and times (2026-11-11, 2026-11-11T08:49:28.948Z), uuids, and the
   app's ids made from Date.now() (s1794386968948oo9t62a8, a run of twelve
   or more digits and what follows it). */
const MADE_BY_THE_CLOCK = [
  /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  /\d{12,}[0-9a-z]*/g,
];

export function withoutClockMade(text) {
  return MADE_BY_THE_CLOCK.reduce((t, re) => t.replace(re, '·'), String(text));
}

export function timesKept(text, secret) {
  const hay = withoutClockMade(text);
  let n = 0;
  for (let at = hay.indexOf(secret); at >= 0; at = hay.indexOf(secret, at + 1)) n++;
  return n;
}

/* The secret is found in `after` no more often than in `before`; the
   message names it and both counts. */
export function notAdded(expect, before, after, secret) {
  const was = timesKept(before, secret);
  const now = timesKept(after, secret);
  expect(
    now,
    secret + ' was found ' + was + ' times before the cards were made and ' + now + ' after',
  ).toBeLessThanOrEqual(was);
}
