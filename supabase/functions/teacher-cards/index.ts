// teacher-cards: where a signed-in teacher's browser has student cards made
// (the card-codes design, section 2). handler.ts holds every rule; this
// file only wires the real database, the real Supabase Auth and the key.
//
// The database cannot read a card's code. This function draws each code,
// hands the database its tag (made with STUDENT_CARD_KEY, which the
// database never has), and returns the code once to the browser that
// asked. It keeps nothing.
//
// Deployed with verify_jwt on, so Supabase's gateway turns away a request
// with no valid sign-in before this runs. The check that counts is the
// handler's own: it asks Supabase Auth who the token belongs to, and the
// teacher's id comes only from that answer. If the gateway's check ever
// refuses the app's real tokens, this can be deployed with it off and the
// handler's check is complete by itself.
//
// The browser calls it with ?forceFunctionRegion=ca-central-1 so it runs
// beside gradebook-prod; handler.ts refuses anywhere else. It reaches the
// database over SUPABASE_DB_URL, as student-submit does, so the
// student_submit schema never has to be exposed through the API.
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js';
import { loadCardKey } from '../_shared/card-key.ts';
import { authUser, makeHandler } from './handler.ts';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20 });

// The card key: exactly 64 hex characters, or no key. No fallback, and
// nothing derived from another secret. Each time the function starts, one
// line says which, with the key's id and never the key. The secret's text
// is read and let go inside loadCardKey; nothing here holds it.
const cardKey = await loadCardKey('teacher-cards', () => Deno.env.get('STUDENT_CARD_KEY'));

const handle = makeHandler({
  region: Deno.env.get('SB_REGION'),
  cardKey,
  whoIs: authUser(fetch, Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!),
  db: {
    // One statement. The items are tags and ids; no code is among them.
    async issue(teacherId, courseId, items, keyId, requestId) {
      const [row] = await sql`
        select student_submit.issue_cards(
          ${teacherId}::uuid, ${courseId}::uuid, ${sql.json(items)}::jsonb, ${keyId}::text, ${requestId}::uuid) as r`;
      return row.r;
    },
  },
});

Deno.serve(handle);
