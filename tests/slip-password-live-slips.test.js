/**
 * A slip password printed before a roster import added a birthday or number
 * still works (DECISIONS.md, Student voice 2). Printing a slip for another
 * questionnaire or another class used to clear it from the student, so a
 * live slip that printed it stopped offering it (Nov 3 bug sweep, Database
 * changes group 2). migrations/20261103_slip_password_kept_for_live_slips.sql
 * clears it only once no older slip is live. The SQL itself is exercised by
 * migrations/local-test/questionnaire_identity.py on a throwaway Postgres.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

const sql = readFileSync('migrations/20261103_slip_password_kept_for_live_slips.sql', 'utf-8');
const issue = readFileSync('migrations/20261101_questionnaire_identity_check.sql', 'utf-8');

describe('the slip password on a reprint', () => {
  it('is cleared only when no older questionnaire slip for the student is live', () => {
    expect(sql).toMatch(
      /if _pw is not null and not exists \(\s+select 1 from student_access_code c join enrollment e on e\.id = c\.enrollment_id\s+where e\.student_id = _sid and e\.withdrawn_at is null\s+and c\.questionnaire_id is not null\s+and c\.used_at is null and c\.revoked_at is null\s+and c\.expires_at > now\(\)\s+and c\.created_at < now\(\)\) then\s+update student set slip_password = null where id = _sid;/,
    );
    // No other path clears it.
    expect(sql.match(/slip_password = null/g)).toHaveLength(1);
  });

  it('leaves out the slip this print made, which issue_access_codes inserts in the same call', () => {
    expect(issue).toMatch(
      /update student_access_code set revoked_at = now\(\)\s+where enrollment_id = _eid and questionnaire_id = _q\.id[^;]*;\s+_out := _out \|\| jsonb_build_object\('enrollment_id', _eid, 'code', _issue_access_code\(_eid, _q\.id, _expires\),\s+'password', _slip_password\(_eid\)\);/,
    );
  });

  it('keeps its grants', () => {
    expect(sql).toContain('revoke all on function public._slip_password(uuid) from public, anon;');
    expect(sql).toContain('grant execute on function public._slip_password(uuid) to authenticated;');
  });
});
