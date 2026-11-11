// A slip's open and verify, with the card key (plan S3-S1; migrations/2026111160_slips_keyed.sql).
//
// The database cannot read a slip's code any more than a card's. open takes
// the code the phone sent, tidies it, and hands the database its tag: a
// keyed fingerprint made with STUDENT_CARD_KEY under the slip's own label
// (../_shared/card-key.ts). verify takes the code the phone opened the slip
// with, when the phone sends it, and hands the database the tag of the
// password typed, bound to that code.
//
// Where the plain code or password still goes to the database, and only
// there (each the second call of a pair, made only when the first call's
// answer asks for it with `fallback`):
//   - open, for a slip printed before 2026111160 and not yet scanned: the
//     database knows it only by a salted hash, so it needs the code once.
//     That scan converts the slip; it opens by its tag from then on.
//   - verify, for a slip whose password has no tag yet: the database
//     compares the typed password with the one stored with the student, and
//     on a match keeps the tag.
// The first call of a pair counts nothing and logs nothing, so a wrong code
// or password is counted once. A phone page from before this change sends
// no code with verify: it cannot be given tags, and its password goes as
// it always did. No code, tag, password or token is ever logged.
//
// Until the migration is applied the database has only the old open and
// verify. A statement here that meets a function that does not exist
// (SQLSTATE 42883) is sent the old way instead, word for word as before
// (Db.open and Db.verify), so deploying this function first changes
// nothing for a slip. After the migration those two are never called.
//
// Kept free of Deno and database imports, as handler.ts is.
import { type CardKey, isSlipCode, tidy } from '../_shared/card-key.ts';

type Json = Record<string, unknown>;
// Every parameter goes to the database as text, or as nothing.
type Param = string | null;
type Identity = { birthday: string | null; studentNumber: string | null; password: string | null };

/* The two statements. The caller's hashed address is the last parameter.
   Read by migrations/local-test/slips_keyed.py, which runs them as written. */
export const SLIP_SQL = {
  // p_code_hmac, p_key_id, p_code (null but on the fallback), p_ip_hash
  open: 'select student_submit.open($1, $2, $3, $4) as r',
  // p_token, p_birthday, p_student_number, p_password (null but on the fallback or from an old page),
  // p_code_hmac, p_pw_hmac, p_ip_hash
  verify: 'select student_submit.verify($1, $2, $3, $4, $5, $6, $7) as r',
};

export type SlipDb = {
  call: (sql: string, params: Param[]) => Promise<unknown>;
  // The database before 2026111160: student_submit.open(code, ip) and verify(token, …, ip), as they always were.
  open: (code: string, ipHash: string) => Promise<Record<string, unknown>>;
  verify: (token: string, who: Identity, ipHash: string) => Promise<Record<string, unknown>>;
};

function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/* The database's answer for the phone: everything but `fallback`, which is
   for this file only. */
function forPhone(said: unknown): Json {
  if (!isObject(said)) return { ok: false, error: 'not_found' };
  const out: Json = {};
  for (const k of Object.keys(said)) if (k !== 'fallback') out[k] = said[k];
  return out;
}

// The database before the migration: the new functions are not there yet.
function notYet(e: unknown): boolean {
  return isObject(e) && e.code === '42883';
}

/* open. `typed` is the code as the phone sent it (a string of at most 32
   characters, checked by the handler). */
export async function openSlip(db: SlipDb, key: CardKey, typed: string, ipHash: string): Promise<Json> {
  const code = tidy(typed);
  // Not six characters of the slip alphabet: no tag, and the database logs a bad format, as it always did.
  const tag = isSlipCode(code) ? await key.slipCodeTag(code) : null;
  let said: unknown;
  try {
    said = await db.call(SLIP_SQL.open, [tag, key.id, null, ipHash]);
    if (tag && isObject(said) && said.fallback === true) {
      said = await db.call(SLIP_SQL.open, [tag, key.id, code, ipHash]);
    }
  } catch (e) {
    if (!notYet(e)) throw e;
    return db.open(typed, ipHash);
  }
  return forPhone(said);
}

/* verify for a slip (a token in the body). `who` is what the student typed,
   as the handler checked it. The code rides in the body as `code` from a
   page that sends it; anything else there is no code. Without the key the
   tags cannot be made, and the password goes as from an old page. */
export async function verifySlip(
  db: SlipDb,
  key: CardKey | null,
  body: Json,
  token: string,
  who: Identity,
  ipHash: string,
): Promise<Json> {
  const code = typeof body.code === 'string' && body.code.length <= 32 ? tidy(body.code) : '';
  const slip = !!key && isSlipCode(code);
  const codeTag = slip && key ? await key.slipCodeTag(code) : null;
  const typed = who.password == null ? null : tidy(who.password);
  const pwTag =
    slip && key && typed != null && /^[A-Z0-9]{0,32}$/.test(typed) ? await key.slipPasswordTag(code, typed) : null;
  const ask = (password: string | null, pw: string | null) =>
    db.call(SLIP_SQL.verify, [token, who.birthday, who.studentNumber, password, codeTag, pw, ipHash]);
  let said: unknown;
  try {
    if (pwTag) {
      // The tag first; the typed password only if the database asks for it.
      said = await ask(null, pwTag);
      if (isObject(said) && said.fallback === true) said = await ask(who.password, pwTag);
    } else {
      said = await ask(who.password, null);
    }
  } catch (e) {
    if (!notYet(e)) throw e;
    return db.verify(token, who, ipHash);
  }
  return forPhone(said);
}
