// student-submit: where a student's phone opens a questionnaire and sends
// its answers (docs/STUDENT-VOICE-PLAN.md, PR 6). Deployed with
// verify_jwt off, since the phone holds no key; the slip's code is the
// credential, checked in SQL.
//
// The phone calls it with ?forceFunctionRegion=ca-central-1 so it runs
// beside gradebook-prod; handler.ts refuses anywhere else. It reaches the
// database over SUPABASE_DB_URL, so the student_submit schema never has to
// be exposed through the API.
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js';
import { makeHandler } from './handler.ts';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20 });

const handle = makeHandler({
  region: Deno.env.get('SB_REGION'),
  // A secret only this function holds; rotating it just resets the rate
  // limit windows.
  ipKey: Deno.env.get('STUDENT_SUBMIT_IP_KEY') || Deno.env.get('SUPABASE_DB_URL')!,
  db: {
    async open(code, ipHash) {
      const [row] = await sql`select student_submit.open(${code}, ${ipHash}) as r`;
      return row.r;
    },
    async check(token, birthday, ipHash) {
      const [row] = await sql`select student_submit.check(${token}, ${birthday}, ${ipHash}) as r`;
      return row.r;
    },
    async submit(token, answers, ipHash) {
      const [row] = await sql`select student_submit.submit(${token}, ${sql.json(answers)}, ${ipHash}) as r`;
      return row.r;
    },
  },
});

Deno.serve(handle);
