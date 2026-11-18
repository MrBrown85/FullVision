/**
 * Migration files must reach PostgreSQL exactly as written.
 *
 * On Nov 18, 2026 migration 2026111801 was sent to live twice and refused
 * itself both times. The second time the cause was the route the file is
 * sent through: it turns every backslash, small u and four hex digits in the
 * SQL text into the real character before PostgreSQL sees it. Measured
 * read-only on live through the same route: a bracket class written with
 * three such escapes came back 5 characters long, not 15, and one escape
 * arrived as the bytes e2808b (U+200B). Everything else arrived untouched:
 * '\x41' is 4 characters, 'a\\b' is 4, '\s+' is 3, '\U0000200b' is 10,
 * E'\\u200b' is 6, '\n' is 2. A function whose body held such an escape
 * therefore landed with other text, and its fingerprint could not match.
 *
 * So, from 20261118 on, a migration file (and each listed live check or undo
 * that has been made route-safe) holds no backslash-u-four-hex, no
 * backslash-u-brace, and no byte but printable ASCII and newline: whoever
 * sends or retypes it has nothing to get wrong.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = join(root, 'migrations');

/* Live checks and undos made route-safe. Add each one as it is made so. */
export const LISTED = [
  'migrations/local-test/bulletins-live-precheck.sql',
  'migrations/local-test/bulletins-live-postcheck.sql',
  'migrations/local-test/bulletins-undo.sql',
  'migrations/local-test/bulletins-student-live-precheck.sql',
  'migrations/local-test/bulletins-student-live-postcheck.sql',
  'migrations/local-test/bulletins-student-undo.sql',
  'migrations/local-test/quizzes-live-precheck.sql',
  'migrations/local-test/quizzes-live-postcheck.sql',
  'migrations/local-test/quizzes-undo.sql',
  'migrations/local-test/quiz-results-live-precheck.sql',
  'migrations/local-test/quiz-results-live-postcheck.sql',
  'migrations/local-test/quiz-results-undo.sql',
  'migrations/local-test/quizzes-student-live-precheck.sql',
  'migrations/local-test/quizzes-student-live-postcheck.sql',
  'migrations/local-test/quizzes-student-undo.sql',
  'migrations/local-test/quizzes-student-list-live-precheck.sql',
  'migrations/local-test/quizzes-student-list-live-postcheck.sql',
  'migrations/local-test/quizzes-student-list-undo.sql',
];

const BS = String.fromCharCode(92);
const ESCAPE = new RegExp(BS + BS + 'u([0-9a-fA-F]{4}|' + BS + '{)');

/** What is wrong with a file's text for the route, or [] when nothing is. */
export function routeFaults(buf) {
  const faults = [];
  const text = buf.toString('latin1');
  const m = ESCAPE.exec(text);
  if (m) faults.push(`a backslash-u escape at byte ${m.index}`);
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b !== 10 && (b < 32 || b > 126)) {
      faults.push(`byte 0x${b.toString(16)} at ${i}`);
      break;
    }
  }
  return faults;
}

const dated = readdirSync(migrations)
  .filter(f => /^\d{8}/.test(f) && f.endsWith('.sql') && f.slice(0, 8) >= '20261118')
  .map(f => 'migrations/' + f);

describe('migration files reach PostgreSQL as written', () => {
  it('finds the dated files and the listed checks', () => {
    expect(dated).toContain('migrations/2026111801_bulletins.sql');
    expect(dated).toContain('migrations/2026111803_bulletins_student.sql');
    expect(dated).toContain('migrations/2026111804_quizzes.sql');
    expect(dated).toContain('migrations/2026111805_quiz_results.sql');
    expect(dated).toContain('migrations/2026111806_quizzes_student.sql');
    expect(dated).toContain('migrations/2026111807_quizzes_student_list.sql');
    for (const f of LISTED) expect(() => readFileSync(join(root, f))).not.toThrow();
  });

  for (const f of [...dated, ...LISTED]) {
    it(`${f} is plain ASCII with no backslash-u escape`, () => {
      expect(routeFaults(readFileSync(join(root, f)))).toEqual([]);
    });
  }

  it('catches what broke on Nov 18', () => {
    const bad = Buffer.from(`select x ~ '[${BS}u200b-${BS}u200f]';\n`, 'latin1');
    expect(routeFaults(bad)).not.toEqual([]);
    expect(routeFaults(Buffer.from(`select '${BS}u{200b}';\n`, 'latin1'))).not.toEqual([]);
    expect(routeFaults(Buffer.from('-- ── a box line\n', 'utf8'))).not.toEqual([]);
    expect(routeFaults(Buffer.from('select 1;\tx\n', 'latin1'))).not.toEqual([]);
    expect(routeFaults(Buffer.from(`select length('a${BS}${BS}b'), '${BS}x41';\n`, 'latin1'))).toEqual([]);
  });
});
