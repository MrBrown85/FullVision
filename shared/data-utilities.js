// @ts-check
/* The small helpers every part of the app uses: student names, dates, colours, ids and RPC results.
   Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

/* ══════════════════════════════════════════════════════════════════
   Utilities (unchanged)
   ══════════════════════════════════════════════════════════════════ */
// esc (text into HTML) lives in shared/html.js, which every page loads first.

/* Returns a safe CSS color value for inline-style interpolation, or a
 * neutral fallback if the input doesn't match one of the accepted shapes.
 *
 * This is defence-in-depth: color values reach the client via user-editable
 * fields (subject/section/module/course), and the server validates them
 * against a hex-format CHECK constraint. But if a bypass ever lands a bad
 * value in the cache (stale LocalStorage, a future non-picker UI, etc.),
 * wrapping interpolations with cssColor() prevents the bad value from
 * breaking out of the style context into DOM injection.
 *
 * Accepted: #rgb / #rgba / #rrggbb / #rrggbbaa hex, rgb()/rgba()/hsl()/hsla()
 * with numeric components only, and var(--token) custom-property refs.
 * Anything with ;, {, }, /*, newlines, url(, javascript:, etc. falls back
 * to var(--text-3). */
var _CSS_COLOR_RE =
  /^(?:#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}(?:\s*,\s*\d{1,3}){2}\s*\)|rgba\(\s*\d{1,3}(?:\s*,\s*\d{1,3}){2}\s*,\s*(?:0|1|0?\.\d+)\s*\)|hsl\(\s*\d{1,3}(?:\s*,\s*\d{1,3}%?){2}\s*\)|hsla\(\s*\d{1,3}(?:\s*,\s*\d{1,3}%?){2}\s*,\s*(?:0|1|0?\.\d+)\s*\)|var\(--[a-zA-Z0-9_-]+\))$/;
function cssColor(c) {
  if (typeof c !== 'string' || c.length > 64) return 'var(--text-3)';
  return _CSS_COLOR_RE.test(c) ? c : 'var(--text-3)';
}
function initials(st) {
  if (!st) return '??';
  if (typeof st === 'string') {
    const p = (st || '').trim().split(/\s+/);
    if (p.length >= 2) return (p[0][0] + p[p.length - 1][0]).toUpperCase();
    return (p[0] || '?').slice(0, 2).toUpperCase();
  }
  // From the name shown on screen, so "Teddy Okafor" is TO.
  const f = (st.preferred || st.firstName || '').trim(),
    l = (st.lastName || '').trim();
  if (f && l) return (f[0] + l[0]).toUpperCase();
  return (f || l || '?').slice(0, 2).toUpperCase();
}

/* ── Student Display Helpers ───────────────────────────────── */
function fullName(st) {
  return ((st.firstName || '') + ' ' + (st.lastName || '')).trim();
}
/* The name shown on screen for a student, everywhere: the preferred name
   (the first name when there is none), then the last name ("Teddy Okafor"
   for Theodore Okafor). fullName stays the legal name for the roster's
   fields, sorting, import matching and exports. */
function displayName(st) {
  return displayNameWithLast(st) || fullName(st);
}
function displayNameFirst(st) {
  return st.preferred || st.firstName || st.lastName || '';
}
/* The name a teacher calls the student by, then the last name: "Cece Adeyemi".
   Keeps a preferred name ("Bobby Smith" for Robert Smith). */
function displayNameWithLast(st) {
  return ((st.preferred || st.firstName || '') + ' ' + (st.lastName || '')).trim();
}
/* The name printed on a report card or rubric: the preferred name (the
   first name when there is none), or the first name when `style` is
   'first', then always the last name. A preferred name that already ends
   in the last name keeps it once ("Bobby Smith"). */
function printedStudentName(st, style) {
  st = st || {};
  var first = String((style === 'first' ? st.firstName || st.preferred : st.preferred || st.firstName) || '').trim();
  var last = String(st.lastName || '').trim();
  if (!last) return first || displayName(st);
  var lower = first.toLowerCase();
  if (lower === last.toLowerCase() || lower.slice(-(last.length + 1)) === ' ' + last.toLowerCase()) return first;
  return (first + ' ' + last).trim();
}

function anonymizeStudents(students) {
  var shuffled = students.slice();
  for (var i = shuffled.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  return shuffled.map(function (st, idx) {
    return Object.assign({}, st, { _anonLabel: 'Student ' + String(idx + 1).padStart(3, '0') });
  });
}

/* Parse a date-only 'YYYY-MM-DD' string as a local calendar date.
   new Date('YYYY-MM-DD') is read as UTC midnight, which lands on the
   previous day in Pacific time. Anything else goes to new Date as-is. */
function parseLocalDate(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const p = v.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  return new Date(v);
}
function formatDate(ts) {
  if (!ts) return '';
  return parseLocalDate(ts).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}
/* Short date for gradebook column headers: "Apr 25" in the current school
   year, "Apr 25, 2025" otherwise. A school year runs August to July, the
   same boundary as reportingSchoolYear. `today` is for tests. */
function formatShortDate(ts, today) {
  if (!ts) return '';
  const d = parseLocalDate(ts);
  if (isNaN(d.getTime())) return '';
  const now = today ? parseLocalDate(today) : new Date();
  const schoolYear = x => (x.getMonth() >= 7 ? x.getFullYear() : x.getFullYear() - 1);
  /** @type {Intl.DateTimeFormatOptions} */
  const opts = { month: 'short', day: 'numeric' };
  if (schoolYear(d) !== schoolYear(now)) opts.year = 'numeric';
  return d.toLocaleDateString('en-CA', opts);
}
function uid() {
  return 's' + Date.now() + Math.random().toString(36).slice(2, 10);
}

/* Mint an idempotency key for a mutating RPC. The v2 write paths accept an
   optional p_idempotency_key uuid and cache the result per
   (key, teacher, endpoint) via fv_idem_check / fv_idem_store, so a retry of a
   call that committed server-side but whose response never reached the client
   returns the original row instead of inserting a duplicate. One key per
   logical user action — reusing it across distinct actions would suppress a
   write the teacher actually asked for.

   Returns null when crypto.randomUUID is unavailable; a null key makes
   fv_idem_check a no-op, which is exactly the pre-existing behaviour. */
function _idempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) {
    /* fall through — dedup is an optimisation, never a hard requirement */
  }
  return null;
}

/* Stamp an idempotency key onto an RPC's params, in place and only once.

   Mutating the caller's object is deliberate. _callRpcWithAuthGuard retries the
   same params twice over — once straight after a token refresh, and again from
   the session-expired queue once the teacher re-authenticates — and both reuse
   the object they were handed. A key minted inside the retry would be a fresh
   key each attempt and would dedup nothing; stamped here, every attempt at the
   same logical write carries the same key, which is the whole point.

   One key per logical write, so distinct writes never share one: two
   deliberate creates, or two successive edits of the same note, each get their
   own key and both land. Only endpoints in FV_IDEMPOTENT_RPCS are stamped —
   PostgREST resolves overloads by argument name, so sending the parameter to an
   RPC that lacks it would fail the call outright. */
function _stampIdempotencyKey(name, params) {
  if (!params || typeof params !== 'object') return params;
  var accepts = typeof FV_IDEMPOTENT_RPCS !== 'undefined' && FV_IDEMPOTENT_RPCS[name];
  if (!accepts) return params;
  if (Object.prototype.hasOwnProperty.call(params, 'p_idempotency_key')) return params;
  var key = _idempotencyKey();
  // A null key leaves fv_idem_check a no-op; don't send the parameter at all
  // rather than pass an explicit null on every write.
  if (key) params.p_idempotency_key = key;
  return params;
}

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _dateOnly(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch (e) {
    return '';
  }
}

/* The local calendar day of a server timestamp. created_at is UTC, so
 * slicing it gives tomorrow's date for anything written after 5 pm
 * Pacific; observations created on this device get getTodayStr() (local),
 * and hydrated rows must agree. A date-only string passes through as is. */
function _localDayOf(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  var d = new Date(value);
  if (isNaN(/** @type {number} */ (/** @type {unknown} */ (d)))) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function _rpcRows(data) {
  if (data == null) return [];
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return [];
    }
  }
  if (Array.isArray(data)) return data;
  if (_plainObject(data)) {
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.rows)) return data.rows;
    if (Array.isArray(data.data)) return data.data;
  }
  return [];
}

function _rpcObject(data) {
  if (data == null) return null;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return null;
    }
  }
  if (Array.isArray(data)) return data[0] || null;
  if (_plainObject(data) && _plainObject(data.data)) return data.data;
  return _plainObject(data) ? data : null;
}

/* UUID detection — distinguishes canonical enrollment_ids from local uid()s */
var _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function _isUuid(v) {
  return typeof v === 'string' && _UUID_RE.test(v);
}

/* A write the outbox refused (full, or the browser's storage is full): the
   warning in the console, and one report to Sentry for each distinct text
   per page load. The text is the function's name and the reason, and
   nothing from the write itself. Never throws into the save. */
/** @type {Record<string, true>} */
var _refusalsReported = {};
/**
 * @param {string} name the server function that was refused
 * @param {unknown} reason the reason the outbox gave
 * @returns {void}
 */
function _warnWriteRefused(name, reason) {
  console.warn(name + ' not queued (' + reason + '): the outbox has no room');
  try {
    var text = 'Write refused: ' + name + ' (' + String(reason) + ')';
    if (_refusalsReported[text]) return;
    _refusalsReported[text] = true;
    var sentry = window.Sentry;
    if (sentry && typeof sentry.captureMessage === 'function') sentry.captureMessage(text, 'warning');
  } catch (e) {
    /* reporting must never reach the save */
  }
}
