// student-submit: where a student's phone opens a questionnaire and sends
// its answers (docs/STUDENT-VOICE-PLAN.md, PR 6), and where a student's card
// opens their page (docs/plans/student-page-build-plan.md 1.8). Deployed
// with verify_jwt off, since the phone holds no key; the slip's or the
// card's code is the credential. Each is turned into a tag here with
// STUDENT_CARD_KEY and the tag is checked in SQL: the database never has
// the key, and sees a slip's plain code only once, to convert a slip
// printed before it could be tagged (slip-routes.ts).
//
// The phone calls it with ?forceFunctionRegion=ca-central-1 so it runs
// beside gradebook-prod; handler.ts refuses anywhere else. It reaches the
// database over its own login, fv_student_submit (STUDENT_SUBMIT_DB_URL,
// ../_shared/db-login.ts), which can run only the student_submit functions
// it calls, so the student_submit schema never has to be exposed through the
// API and a bug here has no other right in the database.
//
// The routes a student sends work through (send-routes.ts) also reach the
// student-photos bucket, through the Storage service's API with the
// service key that Supabase gives every function (SUPABASE_SERVICE_ROLE_KEY).
// `sweep` asks Supabase Auth whose a teacher's sign-in token is, with the
// project's public key (SUPABASE_ANON_KEY), as teacher-cards does. Without
// either, only the routes that need it answer a server error. Every call
// to Storage or Auth gives up after 10 seconds. The removal worker that
// follows a phone's route runs after the answer is sent, through
// EdgeRuntime.waitUntil, where the runtime has it; otherwise before it.
// `scheduled-sweep` is the database's timer (pg_cron through pg_net): it
// carries PHOTO_SWEEP_SECRET, which this function and Vault both hold.
import { loadCardKey } from '../_shared/card-key.ts';
import { dbLogin } from '../_shared/db-login.ts';
import { storageRest } from '../_shared/storage-rest.ts';
import { authUser } from '../_shared/teacher-auth.ts';
import { makeHandler } from './handler.ts';
import { sweepSecret } from './send-routes.ts';

const sql = dbLogin(Deno.env.get('STUDENT_SUBMIT_DB_URL'));

// The card key: exactly 64 hex characters, or no key. No fallback, and
// nothing derived from another secret. Each time the function starts, one
// line says which, with the key's id and never the key. The secret's text
// is read and let go inside loadCardKey; nothing here holds it.
const cardKey = await loadCardKey('student-submit', () => Deno.env.get('STUDENT_CARD_KEY'));

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

// The database timer's secret for scheduled-sweep (migrations/2026111140,
// section 6): exactly 64 lower-case hex characters, the same value as the
// Vault secret fv_photo_sweep_secret, or none (then that route answers a
// server error, and its log line says so). Never logged.
const photoSweepSecret = sweepSecret(Deno.env.get('PHOTO_SWEEP_SECRET'));

// The address key: a secret only this function holds, never the database's
// address or anything else someone holding the database could know, so the
// 30-day log's address hashes cannot be turned back into addresses. No
// fallback: without it every route answers a server error. Rotating it just
// resets the rate limit windows. A request that finds it missing logs
// no_ip_key, never the key.
const ipKey = Deno.env.get('STUDENT_SUBMIT_IP_KEY') || null;

const edge = (globalThis as { EdgeRuntime?: { waitUntil?: (work: Promise<unknown>) => void } }).EdgeRuntime;
const waitUntil = edge && typeof edge.waitUntil === 'function' ? edge.waitUntil.bind(edge) : null;

const handle = makeHandler({
  region: Deno.env.get('SB_REGION'),
  cardKey,
  store: supabaseUrl && serviceKey ? storageRest(fetch, supabaseUrl, serviceKey) : null,
  whoIs: supabaseUrl && anonKey ? authUser(fetch, supabaseUrl, anonKey) : null,
  defer: waitUntil ? (work: Promise<void>) => waitUntil(work) : null,
  sweepSecret: photoSweepSecret,
  ipKey,
  db: {
    async check(token, birthday, ipHash) {
      const [row] = await sql()`select student_submit.check(${token}, ${birthday}, ${ipHash}) as r`;
      return row.r;
    },
    async submit(token, answers, ipHash) {
      const [row] = await sql()`select student_submit.submit(${token}, ${sql().json(answers)}, ${ipHash}) as r`;
      return row.r;
    },
    // The card routes and a slip's open and verify: one statement each, written in card-routes.ts and
    // slip-routes.ts.
    async call(text, params) {
      const [row] = await sql().unsafe(text, params);
      return row.r;
    },
  },
});

Deno.serve(handle);
