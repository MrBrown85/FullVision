// student-submit: where a student's phone opens a questionnaire and sends
// its answers (docs/STUDENT-VOICE-PLAN.md, PR 6), and where a student's card
// opens their page (docs/plans/student-page-build-plan.md 1.8). Deployed
// with verify_jwt off, since the phone holds no key; the slip's or the
// card's code is the credential. A slip's is checked in SQL. A card's is
// turned into a tag here with STUDENT_CARD_KEY and the tag is checked in
// SQL: the database never sees a card's code and never has the key.
//
// The phone calls it with ?forceFunctionRegion=ca-central-1 so it runs
// beside gradebook-prod; handler.ts refuses anywhere else. It reaches the
// database over SUPABASE_DB_URL, so the student_submit schema never has to
// be exposed through the API.
//
// The routes a student sends work through (send-routes.ts) also reach the
// student-photos bucket, through the Storage service's API with the
// service key that Supabase gives every function (SUPABASE_SERVICE_ROLE_KEY).
// `sweep` asks Supabase Auth whose a teacher's sign-in token is, with the
// project's public key (SUPABASE_ANON_KEY), as teacher-cards does. Without
// either, only the routes that need it answer a server error.
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js';
import { loadCardKey } from '../_shared/card-key.ts';
import { storageRest } from '../_shared/storage-rest.ts';
import { authUser } from '../_shared/teacher-auth.ts';
import { makeHandler } from './handler.ts';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20 });

// The card key: exactly 64 hex characters, or no key. No fallback, and
// nothing derived from another secret. Each time the function starts, one
// line says which, with the key's id and never the key. The secret's text
// is read and let go inside loadCardKey; nothing here holds it.
const cardKey = await loadCardKey('student-submit', () => Deno.env.get('STUDENT_CARD_KEY'));

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

const handle = makeHandler({
  region: Deno.env.get('SB_REGION'),
  cardKey,
  store: supabaseUrl && serviceKey ? storageRest(fetch, supabaseUrl, serviceKey) : null,
  whoIs: supabaseUrl && anonKey ? authUser(fetch, supabaseUrl, anonKey) : null,
  // A secret only this function holds; rotating it just resets the rate
  // limit windows.
  ipKey: Deno.env.get('STUDENT_SUBMIT_IP_KEY') || Deno.env.get('SUPABASE_DB_URL')!,
  db: {
    async open(code, ipHash) {
      const [row] = await sql`select student_submit.open(${code}, ${ipHash}) as r`;
      return row.r;
    },
    async verify(token, who, ipHash) {
      const [row] =
        await sql`select student_submit.verify(${token}, ${who.birthday}, ${who.studentNumber}, ${who.password}, ${ipHash}) as r`;
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
    // The card routes: one statement each, written in card-routes.ts.
    async call(text, params) {
      const [row] = await sql.unsafe(text, params);
      return row.r;
    },
  },
});

Deno.serve(handle);
