// A slip's open and verify, with the card key (plan S3-S1; migrations
// 2026111160, 2026112403 and 2026112406).
//
// The database cannot read a slip's code any more than a card's. open takes
// the code the phone sent, tidies it, and hands the database its tag: a
// keyed fingerprint made with STUDENT_CARD_KEY under the slip's own label
// (../_shared/card-key.ts). verify takes the code the phone opened the slip
// with and hands the database the tag of the password typed, bound to that
// code. A plain code or password never goes to the database, and nothing
// here logs a code, tag, password or token.
//
// A slip's token reaches the database only as its SHA-256: handler.ts hashes
// the token a phone sends, and makes the token for a new slip session itself,
// giving open its hash as p_new_token_hash.
//
// Kept free of Deno and database imports, as handler.ts is.
import { type CardKey, isSlipCode, tidy } from '../_shared/card-key.ts';

type Json = Record<string, unknown>;
// Every parameter goes to the database as text, or as nothing.
type Param = string | null;
type Identity = { birthday: string | null; studentNumber: string | null; password: string | null };

/* The two statements, the caller's hashed address after the slip's values.
   Read by migrations/local-test/slips_keyed.py, which runs them as written. */
export const SLIP_SQL = {
  // p_code_hmac, p_key_id, p_ip_hash, p_new_token_hash
  open: 'select student_submit.open($1, $2, $3, $4) as r',
  // p_token (its hash), p_birthday, p_student_number, p_pw_hmac, p_ip_hash
  verify: 'select student_submit.verify($1, $2, $3, $4, $5) as r',
};

export type SlipDb = {
  call: (sql: string, params: Param[]) => Promise<unknown>;
};

function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/* The database's answer for the phone. open's new_token (true when it
   started a slip session) becomes the token the function made, which the
   database never had; a `token` from the database is never passed on. */
function forPhone(said: unknown, token: string | null = null): Json {
  if (!isObject(said)) return { ok: false, error: 'not_found' };
  const out: Json = {};
  for (const k of Object.keys(said)) {
    if (k === 'token') continue;
    if (k === 'new_token') {
      if (said[k] === true && token) out.token = token;
      continue;
    }
    out[k] = said[k];
  }
  return out;
}

/* open. `typed` is the code as the phone sent it (a string of at most 32
   characters, checked by the handler). Not six characters of the slip
   alphabet: no tag, and the database logs a bad format. */
export async function openSlip(
  db: SlipDb,
  key: CardKey,
  typed: string,
  ipHash: string,
  token: string,
  tokenHash: string,
): Promise<Json> {
  const code = tidy(typed);
  const tag = isSlipCode(code) ? await key.slipCodeTag(code) : null;
  return forPhone(await db.call(SLIP_SQL.open, [tag, key.id, ipHash, tokenHash]), token);
}

/* verify for a slip (a token in the body). `who` is what the student typed,
   as the handler checked it. The code rides in the body as `code`; the
   password is checked only by its tag, bound to that code, so without the
   code or the key a typed password cannot match (a birthday or student
   number still can). */
export async function verifySlip(
  db: SlipDb,
  key: CardKey | null,
  body: Json,
  token: string,
  who: Identity,
  ipHash: string,
): Promise<Json> {
  const code = typeof body.code === 'string' && body.code.length <= 32 ? tidy(body.code) : '';
  const typed = who.password == null ? null : tidy(who.password);
  const pwTag =
    key && isSlipCode(code) && typed != null && /^[A-Z0-9]{0,32}$/.test(typed)
      ? await key.slipPasswordTag(code, typed)
      : null;
  return forPhone(await db.call(SLIP_SQL.verify, [token, who.birthday, who.studentNumber, pwTag, ipHash]));
}
