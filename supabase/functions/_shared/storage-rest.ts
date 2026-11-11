// The student-photos bucket, through the Storage service's own HTTP API,
// with the service key (Batch B's contract, "Storage").
//
// Six things are done with it, and nothing else:
//   signUpload     a link that lets one file be put at one path, once. Never
//                  with upsert: no x-upsert header is sent when it is made,
//                  so a second upload to a path that holds a file is refused.
//   signDownloads  links that let each named file be read for `seconds`.
//                  Storage's sign request takes only expiresIn and paths,
//                  and the link's GET only its token and `download`: there
//                  is no way to ask for a response that is not cacheable.
//                  Storage answers a signed GET with Expires set to the
//                  link's end and no Cache-Control from the stored file
//                  (supabase/storage, src/storage/renderer/renderer.ts:
//                  with `expires` set, only no-transform is passed on). So a
//                  copy cached from a link can live at most to the link's
//                  end, 300 seconds; whether Supabase's CDN keeps one at all
//                  is a live check.
//   read           the file's bytes, stopping at `maxBytes` + 1: a larger
//                  file is never read whole, it is answered 'too_large'.
//   overwrite      a file that is already there, replaced by the bytes the
//                  check passed, typed image/jpeg, with Cache-Control
//                  "private, no-store" (Storage keeps a binary upload's
//                  cache-control header as sent; without one it stores
//                  "no-cache"). So no stored file keeps a cache header the
//                  phone chose.
//   remove         files deleted, by their exact names.
// The bucket is fixed here and is never taken from a caller. Nothing lists
// the bucket (the contract: listing it is slow and nothing needs it).
//
// Every path is checked against the bucket's one layout before it is used:
//   <course>/<assessment>/<enrollment>/<submission>/<file>.jpg
//   <course>/<assessment>/<enrollment>/<submission>/<file>-thumb.jpg
// each part a lower-case id. Only the database names paths; this is a
// second look, so a path with anything else in it (a dot-dot, a slash too
// many, a query) never reaches the Storage service, from any caller.
//
// An error thrown here names the step and the status, never a path, a link
// or a key: the handler logs only an error's class.
//
// Every call has a deadline, TIMEOUT_MS unless the caller gives another
// (review L4): the request is aborted, a read's body let go, and the call
// throws a StorageError ("<step>-timeout"). Nothing waits on a Storage
// service that does not answer.
//
// No Deno imports: `fetcher` is fetch, so the tests can run it under Node.

export const BUCKET = 'student-photos';

const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const PATH = new RegExp(`^(${ID})/(${ID})/(${ID})/(${ID})/(${ID})(-thumb)?\\.jpg$`);

export type PathParts = {
  course: string;
  assessment: string;
  enrollment: string;
  submission: string;
  file: string;
  thumb: boolean;
};

/** A path's parts, or null when it is not one of the bucket's two shapes. */
export function pathParts(path: unknown): PathParts | null {
  if (typeof path !== 'string') return null;
  const m = PATH.exec(path);
  if (!m) return null;
  return { course: m[1], assessment: m[2], enrollment: m[3], submission: m[4], file: m[5], thumb: !!m[6] };
}

// Bytes backed by a plain ArrayBuffer (never a SharedArrayBuffer), as fetch's body and Web Crypto take them.
export type Read = { bytes: Uint8Array<ArrayBuffer> } | 'missing' | 'too_large';

export type Store = {
  signUpload: (path: string) => Promise<string>;
  signDownloads: (paths: string[], seconds: number) => Promise<Record<string, string>>;
  read: (path: string, maxBytes: number) => Promise<Read>;
  overwrite: (path: string, bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
  remove: (paths: string[]) => Promise<void>;
};

class StorageError extends Error {
  constructor(step: string, status: number) {
    super(`storage ${step} ${status}`);
    this.name = 'StorageError';
  }
}

function checked(path: string): string {
  if (!PATH.test(path)) throw new StorageError('path', 0);
  return path;
}

/** How long one call to the Storage service may take. */
export const TIMEOUT_MS = 10_000;

/* Runs one call with its own deadline. The call is given the signal (for
   fetch, and to let a body go); whatever it is doing when the deadline
   comes, the answer is a StorageError, never what it had so far. */
function deadline<T>(step: string, ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(ms);
  const late = () => new StorageError(step + '-timeout', 0);
  let off = () => {};
  const timedOut = new Promise<never>((_, reject) => {
    const on = () => reject(late());
    signal.addEventListener('abort', on, { once: true });
    off = () => signal.removeEventListener('abort', on);
  });
  const done = run(signal).catch(e => {
    throw signal.aborted ? late() : e;
  });
  return Promise.race([done, timedOut]).finally(off);
}

async function drop(res: Response): Promise<void> {
  try {
    if (res.body) await res.body.cancel();
  } catch {
    /* nothing to release */
  }
}

export function storageRest(
  fetcher: typeof fetch,
  supabaseUrl: string,
  serviceKey: string,
  opts: { timeoutMs?: number } = {},
): Store {
  const ms = opts.timeoutMs || TIMEOUT_MS;
  const api = supabaseUrl.replace(/\/+$/, '') + '/storage/v1';
  const auth = { Authorization: 'Bearer ' + serviceKey, apikey: serviceKey };
  // Every part of a path is an id, a slash or ".jpg"; nothing to encode. Checked again here.
  const object = (path: string) => `${BUCKET}/${checked(path)}`;

  async function json(res: Response, step: string): Promise<unknown> {
    if (!res.ok) {
      await drop(res);
      throw new StorageError(step, res.status);
    }
    return res.json();
  }

  // A link the Storage service gives as "/object/...?token=…", made absolute.
  function absolute(link: unknown, step: string): string {
    if (typeof link !== 'string' || !link.startsWith('/object/')) throw new StorageError(step, 0);
    return api + link;
  }

  return {
    async signUpload(path) {
      const url = `${api}/object/upload/sign/${object(path)}`;
      return deadline('sign-upload', ms, async signal => {
        const res = await fetcher(url, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: '{}',
          signal,
        });
        const said = (await json(res, 'sign-upload')) as { url?: unknown };
        return absolute(said && said.url, 'sign-upload');
      });
    },

    async signDownloads(paths, seconds) {
      if (!paths.length) return {};
      paths.forEach(checked);
      const said = await deadline('sign-download', ms, async signal => {
        const res = await fetcher(`${api}/object/sign/${BUCKET}`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: seconds, paths }),
          signal,
        });
        return json(res, 'sign-download');
      });
      if (!Array.isArray(said)) throw new StorageError('sign-download', 0);
      const out: Record<string, string> = {};
      for (const item of said as { path?: unknown; signedURL?: unknown; error?: unknown }[]) {
        if (!item || typeof item.path !== 'string' || item.error) continue;
        if (paths.includes(item.path)) out[item.path] = absolute(item.signedURL, 'sign-download');
      }
      // Every path asked for has its link, or none is given.
      if (paths.some(p => !out[p])) throw new StorageError('sign-download', 0);
      return out;
    },

    async read(path, maxBytes) {
      const url = `${api}/object/authenticated/${object(path)}`;
      return deadline('read', ms, async (signal): Promise<Read> => {
        const res = await fetcher(url, { method: 'GET', headers: auth, signal });
        // The Storage service answers a file that is not there with 404, or with 400 and a body saying 404.
        if (res.status === 404) {
          await drop(res);
          return 'missing';
        }
        // Any other 400 (a wrong or rotated key answers 400 too) is an error, never "missing" (send routes
        // review 2, N2): a phone told its pages are missing would retake them while nothing was wrong with them.
        if (res.status === 400) {
          const said = (await res.json().catch(() => null)) as { statusCode?: unknown } | null;
          if (said && String(said.statusCode) === '404') return 'missing';
          throw new StorageError('read', 400);
        }
        if (!res.ok || !res.body) {
          await drop(res);
          throw new StorageError('read', res.status);
        }
        const told = Number(res.headers.get('content-length'));
        if (Number.isFinite(told) && told > maxBytes) {
          await drop(res);
          return 'too_large';
        }
        const reader = res.body.getReader();
        // At the deadline the body is let go; the deadline's error is the answer, never what was read so far.
        signal.addEventListener('abort', () => reader.cancel().catch(() => {}), { once: true });
        const parts: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxBytes) {
            await reader.cancel();
            return 'too_large';
          }
          parts.push(value);
        }
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const p of parts) {
          bytes.set(p, at);
          at += p.length;
        }
        return { bytes };
      });
    },

    async overwrite(path, bytes) {
      const url = `${api}/object/${object(path)}`;
      await deadline('overwrite', ms, async signal => {
        const res = await fetcher(url, {
          method: 'PUT',
          headers: { ...auth, 'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'Cache-Control': 'private, no-store' },
          body: bytes,
          signal,
        });
        await json(res, 'overwrite');
      });
    },

    async remove(paths) {
      if (!paths.length) return;
      paths.forEach(checked);
      await deadline('remove', ms, async signal => {
        const res = await fetcher(`${api}/object/${BUCKET}`, {
          method: 'DELETE',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: paths }),
          signal,
        });
        await json(res, 'remove');
      });
    },
  };
}
