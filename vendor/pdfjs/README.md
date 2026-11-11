# pdf.js, for turning a PDF into pages

Mozilla's pdf.js, as published on npm, unchanged. `shared/photo-readers.js` loads it the first time a PDF is opened, never on page load, and gives `shared/photo-shrink.js` its `openPdf`. Licence: Apache-2.0 (`LICENSE`); the scan decoders, fonts and colour profile carry their own licence files beside them.

## Version

- Package: `pdfjs-dist` **6.4.299** (published 2026-10-03)
- Tarball: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz
- Integrity (npm registry): `sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==`
- SHA-256 of the two main files as copied: `pdf.min.js` `bccc24ea711db8e44503629519904a5292d73b9daaa214bbe7cdcc282b0f4259`, `pdf.worker.min.js` `145d2dd3ab0c86151011dba95acfa2d5336e2accd59388ea43dbee0efddaaec6`

## What was copied, from the package

| Here                                                                                                         | From the package                                                                | Why                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pdf.min.js`                                                                                                 | `legacy/build/pdf.min.mjs`                                                      | The library. The legacy build runs on older phones and Chromebooks too.                                                       |
| `pdf.worker.min.js`                                                                                          | `legacy/build/pdf.worker.min.mjs`                                               | Its worker, which reads the PDF off the main thread.                                                                          |
| `wasm/jbig2.wasm`, `wasm/openjpeg.wasm`, `wasm/qcms_bg.wasm`, and their `_nowasm_fallback.js` where they have one | `wasm/`                                                                         | Decoders for pictures inside scans (JBIG2, fax, JPEG 2000) and colour profiles. The plain-JavaScript copies are used where WebAssembly is not allowed. |
| `wasm/LICENSE_*`                                                                                             | `wasm/`                                                                         | Their licences.                                                                                                               |
| `standard_fonts/`                                                                                            | `standard_fonts/`                                                               | The 14 standard PDF fonts, for a PDF that names Helvetica or Times without including it.                                      |
| `cmaps/`                                                                                                     | `cmaps/`                                                                        | Character maps for Chinese, Japanese and Korean text in PDFs that do not include their font.                                  |
| `iccs/`                                                                                                      | `iccs/`                                                                         | A colour profile pdf.js uses for print colours.                                                                               |
| `LICENSE`                                                                                                    | `LICENSE`                                                                       | Apache-2.0.                                                                                                                   |

Not copied: the modern (non-legacy) build, source maps, the scripting sandbox (`pdf.sandbox*`, `wasm/quickjs-eval.*`: form scripts never run here), the viewer (`web/`), `image_decoders/` and type definitions.

**Renamed, not edited:** the two `.mjs` files are saved as `.js`. Every server this site uses sends a `.js` file as JavaScript, which a module needs; not every one knows `.mjs`. The contents are byte for byte the package's.

## How it runs under the Content Security Policy

The policy is unchanged. The library is a same-origin ES module fetched by `import()` (`script-src 'self'`); its worker is a same-origin module worker (`worker-src 'self'`). pdf.js 6 uses no `eval`. The only `Function(...)` in the legacy build is core-js's last-resort way to find the global object, never reached in a browser that runs modules. Glyphs are drawn as shapes (`disableFontFace`), so no font is loaded into the page.

## Offline

`sw.js` precaches `pdf.min.js` and `pdf.worker.min.js` with the other vendor files, so a PDF chosen offline on a device that has loaded the app still becomes pages. The decoders, fonts and character maps are cached the first time a PDF needs them.

## Refreshing

1. Pick a released version at least two weeks old: `npm view pdfjs-dist time --json`.
2. `npm pack pdfjs-dist@<version>` in an empty scratch folder, check `npm view pdfjs-dist@<version> dist.integrity` against the tarball, and unpack it.
3. Copy the files in the table above over these, renaming the two `.mjs` files to `.js`. Do not minify or edit them.
4. Update the version, integrity and SHA-256 lines here.
5. Run `npm test` (tests/photo-readers.test.js runs the real library) and `npx playwright test e2e/pdf-pages.spec.js` (it runs under the live CSP and offline).
