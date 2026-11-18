/**
 * student_submit._bulletin_session_enrollments (Bulletins, 2026111803) mirrors
 * the tests of student_submit._session_classes: which classes a device's
 * session may name. The feed's counts use the mirror so as not to compute
 * every class's to-do count; the two must never drift apart. This compares
 * their text from `from device_session_enrollment` to the end of the
 * statement, comments and spacing aside, so a later migration that changes
 * one without the other fails here.
 *
 * Until 2026111803 is applied and migrations/baseline/ refreshed, the mirror
 * is read from the migration file. IN THE BASELINE REFRESH PR: read both
 * functions from migrations/baseline/30-functions.sql (set MIRROR_FROM to
 * BASELINE below).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const BASELINE = 'migrations/baseline/30-functions.sql';
const MIRROR_FROM = 'migrations/2026111803_bulletins_student.sql';

/* A function's body as the given file defines it last: from its header to the closing $function$. */
function body(file, name) {
  const text = read(file);
  const re = new RegExp('create or replace function ' + name.replace('.', '\\.') + '\\(', 'gi');
  let at = -1;
  for (let m; (m = re.exec(text)); ) at = m.index;
  expect(at, name + ' in ' + file).toBeGreaterThan(-1);
  const open = text.indexOf('$function$', at);
  return text.slice(open + '$function$'.length, text.indexOf('$function$', open + 1));
}

/* From `from device_session_enrollment` to the statement's end, without comments, spacing made one space. */
function tail(text) {
  const plain = text.replace(/--.*$/gm, '').replace(/\s+/g, ' ');
  const from = plain.indexOf('from device_session_enrollment');
  expect(from).toBeGreaterThan(-1);
  return plain.slice(from, plain.indexOf(';', from) + 1).trim();
}

describe('the mirror of _session_classes', () => {
  it('names its classes by exactly the same joins and tests', () => {
    const classes = tail(body(BASELINE, 'student_submit._session_classes'));
    const mirror = tail(body(MIRROR_FROM, 'student_submit._bulletin_session_enrollments'));
    expect(mirror).toBe(classes);
    // The tests that matter, named, so a reader sees what is held equal.
    for (const test of [
      'k.stopped_at is null',
      'e.withdrawn_at is null',
      'c.deleted_at is null',
      'c.student_page_enabled',
      'e.page_paused_at is null',
    ]) {
      expect(mirror).toContain(test);
    }
  });

  it('keeps the same order: the classes in the order the device added them', () => {
    expect(body(BASELINE, 'student_submit._session_classes')).toContain('order by x.added_at, e.id)');
    expect(body(MIRROR_FROM, 'student_submit._bulletin_session_enrollments')).toContain('order by x.added_at, e.id)');
  });
});
