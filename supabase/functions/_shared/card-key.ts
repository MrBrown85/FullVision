// The student card key, and everything made with it.
//
// A card's code is never stored. The database keeps a tag of it: an
// HMAC-SHA-256 made with a key the database never sees, so a copy of the
// table cannot be turned back into codes or even tested against a guess.
// The key is the edge function secret STUDENT_CARD_KEY: 32 random bytes
// written as 64 hex characters. student-submit uses it to check a card or
// a slip; teacher-cards uses it to make one. Nothing else reads it. Slips
// use the same key under labels of their own (plan S3-S1), so a slip's tag
// can never be a card's.
//
// THE MESSAGE FORMATS BELOW ARE PERMANENT. Every live card's tag, and every
// questionnaire and phone-report slip's (plan S3-S1), was made with them. A
// change to a label, to the newline between the parts, to how a typed code
// is tidied, or to the hex of the output makes every card or slip in every
// class stop opening, with no error anywhere: the tags simply stop
// matching. tests/card-key.test.js holds known answers for all five. If
// that test fails, this file is wrong; the answers are never regenerated.
// A new kind of tag gets a new label; an existing label never changes.
//
//   card code tag      HMAC(key, "fv.card.code.v1" + "\n" + CODE)
//   card password tag  HMAC(key, "fv.card.pass.v1" + "\n" + CODE + "\n" + DIGITS)
//   key id             the first 8 hex characters of HMAC(key, "fv.card.keyid.v1")
//   slip code tag      HMAC(key, "fv.slip.code.v1" + "\n" + SLIP)
//   slip password tag  HMAC(key, "fv.slip.pass.v1" + "\n" + SLIP + "\n" + DIGITS)
//
// CODE is a card's eight characters, tidied: upper case, letters and digits
// only, no dash. SLIP is a slip's six, tidied the same way. DIGITS is the
// password as typed, tidied the same way. Each tag is 64 lower-case hex
// characters. A slip's password tag is bound to its slip's code, as a
// card's is to its card's: the same digits on two slips are two tags.
//
// The key is never logged, never sent to the database and never put in a
// reply. It is held as a CryptoKey that cannot be exported, so nothing in
// this process can read its bytes back, this file included.
//
// No Deno and no Node imports: Web Crypto only, so the functions run it
// under Deno and the tests run it under Node.

/** The 29 characters a slip's code is drawn from, and a card's: no I, L, O, S, 0, 1 or 5. */
export const ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZ2346789';
/** A card's code is eight characters; a slip's is six. That is how the two are told apart. */
export const CODE_LENGTH = 8;
export const SLIP_CODE_LENGTH = 6;

const CODE_LABEL = 'fv.card.code.v1';
const PASSWORD_LABEL = 'fv.card.pass.v1';
const KEY_ID_LABEL = 'fv.card.keyid.v1';
const SLIP_CODE_LABEL = 'fv.slip.code.v1';
const SLIP_PASSWORD_LABEL = 'fv.slip.pass.v1';

export type CardKey = {
  /** Which key this is, to tell a card made under another key. It gives nothing of the key away. */
  readonly id: string;
  /** The tag of a card's code. `code` must already be tidied and eight characters. */
  codeTag: (code: string) => Promise<string>;
  /** The tag of a card's password, bound to its card. `typed` must already be tidied. */
  passwordTag: (code: string, typed: string) => Promise<string>;
  /** The tag of a slip's code. `code` must already be tidied and six characters. */
  slipCodeTag: (code: string) => Promise<string>;
  /** The tag of a slip's password, bound to its slip. `typed` must already be tidied. */
  slipPasswordTag: (code: string, typed: string) => Promise<string>;
};

const bytesOf = (n: number) => new Uint8Array(n);
type Bytes = ReturnType<typeof bytesOf>;
/** Fills the bytes it is given with random values, as crypto.getRandomValues does. */
export type RandomSource = (into: Bytes) => unknown;

const systemRandom: RandomSource = into => crypto.getRandomValues(into);

/* What a student typed, as the code or the password is compared: letters
   and digits only, upper case. "k7m4-qx2p" and "K7M4 QX2P" are one code.
   Permanent, as the formats above are. */
export function tidy(typed: string): string {
  return String(typed == null ? '' : typed)
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

/** A code as it is printed and shown: K7M4-QX2P. */
export function prettyCode(code: string): string {
  return code.length === CODE_LENGTH ? code.slice(0, 4) + '-' + code.slice(4) : code;
}

/** A slip's code as it is printed and shown: K7M-4QX, as the database's slips always were. */
export function prettySlipCode(code: string): string {
  return code.length === SLIP_CODE_LENGTH ? code.slice(0, 3) + '-' + code.slice(3) : code;
}

const SLIP_CODE = new RegExp('^[' + ALPHABET + ']{' + SLIP_CODE_LENGTH + '}$');
/** Is this tidied code a slip's: six characters of the slip alphabet? Anything else is no slip. */
export function isSlipCode(code: string): boolean {
  return typeof code === 'string' && SLIP_CODE.test(code);
}

/* Reads the key. The value must be exactly 64 hex characters: no spaces, no
   quotes, no newline. Anything else is no key at all (null). There is no
   fallback and nothing is derived from another secret: without the key the
   card routes answer a server error, which is also how cards are stopped in
   an emergency (unset the secret). */
export async function readCardKey(value: string | null | undefined): Promise<CardKey | null> {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) return null;
  const raw = bytesOf(32);
  for (let i = 0; i < 32; i++) raw[i] = parseInt(value.slice(2 * i, 2 * i + 2), 16);
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  raw.fill(0);

  const encoder = new TextEncoder();
  const tag = async (message: string): Promise<string> => {
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
    return Array.from(sig, b => b.toString(16).padStart(2, '0')).join('');
  };
  /* The parts of a message are joined by a newline, so no part may hold
     one. A tidied value cannot; this refuses anything that was not tidied,
     and a code of the wrong length, before it is tagged. */
  const code = (c: string): string => {
    if (typeof c !== 'string' || !/^[A-Z0-9]+$/.test(c) || c.length !== CODE_LENGTH) throw new TypeError('code');
    return c;
  };
  const slip = (c: string): string => {
    if (typeof c !== 'string' || !/^[A-Z0-9]+$/.test(c) || c.length !== SLIP_CODE_LENGTH) throw new TypeError('code');
    return c;
  };
  const typedPassword = (p: string): string => {
    if (typeof p !== 'string' || !/^[A-Z0-9]{0,32}$/.test(p)) throw new TypeError('password');
    return p;
  };

  const id = (await tag(KEY_ID_LABEL)).slice(0, 8);
  return Object.freeze({
    id,
    codeTag: (c: string) => tag(CODE_LABEL + '\n' + code(c)),
    passwordTag: (c: string, p: string) => tag(PASSWORD_LABEL + '\n' + code(c) + '\n' + typedPassword(p)),
    slipCodeTag: (c: string) => tag(SLIP_CODE_LABEL + '\n' + slip(c)),
    slipPasswordTag: (c: string, p: string) => tag(SLIP_PASSWORD_LABEL + '\n' + slip(c) + '\n' + typedPassword(p)),
  });
}

/* The one line a function logs when it starts: the key is present, with its
   id, or it is missing, or it is set to something that is not 64 hex
   characters. Never the value, its length or any part of it. */
export function keyLine(fn: string, value: string | null | undefined, key: CardKey | null): Record<string, string> {
  if (key) return { start: fn, card_key: 'present', key_id: key.id };
  return { start: fn, card_key: value ? 'malformed' : 'missing' };
}

/* What a function does with the key when it starts: reads the secret, makes
   the key from it, logs the one line and gives back the key (or null). The
   hex is read, used and let go inside this call: no name outside it ever
   holds it. `read` is how the secret is read (Deno.env.get); `log` writes
   the line. */
export async function loadCardKey(
  fn: string,
  read: () => string | null | undefined,
  log: (line: string) => void = line => console.log(line),
): Promise<CardKey | null> {
  const value = read();
  const key = await readCardKey(value);
  log(JSON.stringify(keyLine(fn, value, key)));
  return key;
}

/* `count` characters from `symbols`, each equally likely. A byte is 0 to
   255, and 256 is not a multiple of 29 or of 10, so taking a byte modulo
   the alphabet would make some characters a little likelier than others.
   A byte at or past the largest multiple is thrown away and another drawn
   (rejection sampling). */
function draw(symbols: string, count: number, random: RandomSource): string {
  const limit = 256 - (256 % symbols.length);
  const buffer = bytesOf(count * 2);
  let out = '';
  for (let round = 0; out.length < count; round++) {
    // A source that only ever gives rejected bytes is broken: stop, do not spin.
    if (round >= 64) throw new Error('random');
    random(buffer);
    for (let i = 0; i < buffer.length && out.length < count; i++) {
      if (buffer[i] < limit) out += symbols[buffer[i] % symbols.length];
    }
  }
  buffer.fill(0);
  return out;
}

/** A new card's code: eight characters, no dash. The random source is crypto.getRandomValues unless a test gives another. */
export function drawCode(random: RandomSource = systemRandom): string {
  return draw(ALPHABET, CODE_LENGTH, random);
}

/** A new card's password, or a new slip's: four digits. */
export function drawPassword(random: RandomSource = systemRandom): string {
  return draw('0123456789', 4, random);
}

/** A new slip's code: six characters of the same alphabet, no dash. */
export function drawSlipCode(random: RandomSource = systemRandom): string {
  return draw(ALPHABET, SLIP_CODE_LENGTH, random);
}
