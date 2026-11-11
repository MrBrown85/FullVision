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

export type Read = { bytes: Uint8Array } | 'missing' | 'too_large';

export type Store = {
  signUpload: (path: string) => Promise<string>;
  signDownloads: (paths: string[], seconds: number) => Promise<Record<string, string>>;
  read: (path: string, maxBytes: number) => Promise<Read>;
  overwrite: (path: string, bytes: Uint8Array) => Promise<void>;
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

async function drop(res: Response): Promise<void> {
  try {
    if (res.body) await res.body.cancel();
  } catch {
    /* nothing to release */
  }
}

export function storageRest(fetcher: typeof fetch, supabaseUrl: string, serviceKey: string): Store {
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
      const res = await fetcher(`${api}/object/upload/sign/${object(path)}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const said = (await json(res, 'sign-upload')) as { url?: unknown };
      return absolute(said && said.url, 'sign-upload');
    },

    async signDownloads(paths, seconds) {
      if (!paths.length) return {};
      paths.forEach(checked);
      const res = await fetcher(`${api}/object/sign/${BUCKET}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: seconds, paths }),
      });
      const said = await json(res, 'sign-download');
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
      const res = await fetcher(`${api}/object/authenticated/${object(path)}`, { method: 'GET', headers: auth });
      // The Storage service answers a file that is not there with 404, or with 400 and a body saying 404.
      if (res.status === 404 || res.status === 400) {
        await drop(res);
        return 'missing';
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
    },

    async overwrite(path, bytes) {
      const res = await fetcher(`${api}/object/${object(path)}`, {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'Cache-Control': 'private, no-store' },
        body: bytes,
      });
      await json(res, 'overwrite');
    },

    async remove(paths) {
      if (!paths.length) return;
      paths.forEach(checked);
      const res = await fetcher(`${api}/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
      });
      await json(res, 'remove');
    },
  };
}
