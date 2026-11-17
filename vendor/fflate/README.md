# fflate, for opening an EPUB

fflate by Arjun Barrett, as published on npm, unchanged. `shared/handout-viewer.js` loads it the first time an EPUB handout is opened (on the student page or in Preview as Student), never on page load, and uses only `unzipSync` to read the book's files. Licence: MIT (`LICENSE`).

## Version

- Package: `fflate` **0.8.2** (published 2024-02-07)
- Tarball: https://registry.npmjs.org/fflate/-/fflate-0.8.2.tgz
- Integrity (npm registry): `sha512-cPJU47OaAoCbg0pBvzsgpTPhmhqI5eJjh/JIu8tPj5q+T7iLvW/JAYUqmE7KOB4R1ZyEhzBaIQpQpardBF5z8A==`
- SHA-256 of `fflate.min.js` as copied: `c3b34f2e9f5e74d4d7d64e01cac7a0c01954c6c406414d42185c7b53d6875ddf`

## What was copied

| Here             | From the package | Why                                                                |
| ---------------- | ---------------- | ------------------------------------------------------------------ |
| `fflate.min.js`  | `umd/index.js`   | The library, as a plain script that sets `window.fflate`.          |
| `LICENSE`        | `LICENSE`        | Its licence.                                                       |

## Why this and not an EPUB reader

The readers that paginate a book (epub.js among them) draw it in frames of their own that share the page's origin, so the book would not be sealed off from the student's session. FullVision reads the book's files with fflate, then shows each chapter in the same sealed frame a web-page handout uses (`shared/handout-frame.html`), which turns its pages itself.
