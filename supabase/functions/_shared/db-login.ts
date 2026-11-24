// The database login an edge function signs in with
// (migrations/2026112402_edge_function_logins.sql).
//
// Each function has its own: fv_student_submit for student-submit and
// fv_teacher_cards for teacher-cards, each able to run only the
// student_submit functions it calls. Its connection string is the function's
// own secret (STUDENT_SUBMIT_DB_URL, TEACHER_CARDS_DB_URL). There is no
// fallback to SUPABASE_DB_URL, which signs in as the database's owner:
// without the secret, every statement throws NoDatabaseLogin and the handler
// answers a plain server error, logging that name and never the string.
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js';

type Sql = ReturnType<typeof postgres>;

export function dbLogin(url: string | undefined): () => Sql {
  const sql = url ? postgres(url, { prepare: false, max: 2, idle_timeout: 20 }) : null;
  return () => {
    if (sql) return sql;
    const e = new Error('no database login');
    e.name = 'NoDatabaseLogin';
    throw e;
  };
}
