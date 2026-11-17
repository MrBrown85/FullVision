# jsQR, for reading sticker codes on a scanned page

jsQR as published on npm, unchanged. `shared/scan-label-read.js` loads it the first time a sticker is read, never on page load, to find a FullVision sticker's QR code on a page of a scanned pile (Add Work for the Class, B4). It reads the picture in the browser; nothing is sent anywhere.

- Package: `jsqr` **1.4.0**
- Tarball: https://registry.npmjs.org/jsqr/-/jsqr-1.4.0.tgz (`npm pack jsqr@1.4.0`)
- Copied: `dist/jsQR.js` as `jsQR.js`, and `LICENSE`. Nothing else from the package (the type definitions and the source split into files are left out).
- SHA-256 of `jsQR.js` as copied: `bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859`
- Licence: Apache-2.0 (`LICENSE`, the package's own copy; `package.json` says `"license": "Apache-2.0"`).

Not in `package.json`: the app loads this copy, not an installed package. Prettier, ESLint and the type check skip `vendor/`, as they do the other vendor files.
