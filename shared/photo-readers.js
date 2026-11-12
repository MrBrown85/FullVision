/* shared/photo-readers.js — what reads a file the browser cannot draw itself
 *
 * shared/photo-shrink.js takes its PDF reader as a seam (openPdf). This file
 * is that reader, backed by Mozilla's pdf.js in vendor/pdfjs/ (see its
 * README for the version). The library is fetched the first time a PDF is
 * opened, never on page load: a page that loads this file and opens no PDF
 * downloads nothing more.
 *
 *   PhotoReaders.openPdf(blob, { longSide }) → Promise of
 *     { pages: n, page(i) → Promise of page i drawn on a canvas, close() }
 *
 * exactly the shape PhotoShrink asks for. Each page is drawn white-backed
 * with its long side at longSide (a small page is enlarged at most
 * MAX_SCALE times), one page at a time. PhotoShrink then makes each one a
 * JPEG and refuses a PDF of more than 20 pages before any page is drawn.
 *
 * It never throws. A failure is a rejected promise whose error carries
 * reason, one of PhotoShrink's REASONS, which PhotoShrink turns into its
 * refusal:
 *   no_decoder   the library could not be fetched or started (offline on a
 *                device that never cached it, a blocked file)
 *   unreadable   not a PDF, damaged, or locked with a password; a locked
 *                PDF also carries extra: { locked: true }, so a screen can
 *                say "This PDF has a password" if it wants to
 *
 * The Content Security Policy is not loosened for any of this. The library
 * is a same-origin ES module (script-src 'self'), its worker a same-origin
 * module worker (worker-src 'self'), and pdf.js uses no eval. Pictures
 * inside a scan (JBIG2, JPEG 2000) are decoded by WebAssembly in the
 * worker, or by the plain-JavaScript copies beside them when WebAssembly
 * is not allowed. Fonts are drawn as shapes (disableFontFace), so no font
 * is loaded into the page.
 *
 * Everything here is a window.PhotoReaders.* public surface; no other
 * globals.
 */
window.PhotoReaders = (function () {
  'use strict';

  var BASE = '/vendor/pdfjs/';
  var LIBRARY_URL = BASE + 'pdf.min.js';
  var WORKER_URL = BASE + 'pdf.worker.min.js';
  var LONG_SIDE = 2000; // px, when the caller gives none (PhotoShrink.LONG_SIDE)
  var MAX_SCALE = 4; // a page smaller than a postcard is enlarged at most this much

  var REASONS = { NO_DECODER: 'no_decoder', UNREADABLE: 'unreadable' };

  function _fail(reason, message, extra) {
    var err = new Error(message || reason);
    err.reason = reason;
    if (extra) err.extra = extra;
    return err;
  }

  /* How the library is fetched. A dynamic import of a same-origin file;
     tests swap it through configure({ load }). */
  function _importLibrary() {
    return import(LIBRARY_URL);
  }

  var _load = _importLibrary;
  var _canvas = function (w, h) {
    var el = document.createElement('canvas');
    el.width = w;
    el.height = h;
    return el;
  };
  var _lib = null; // Promise of the library, once asked for

  /* Swap how the library is fetched or how a canvas is made (tests). */
  function configure(opts) {
    opts = opts || {};
    if ('load' in opts) {
      _load = opts.load || _importLibrary;
      _lib = null;
    }
    if ('canvas' in opts && opts.canvas) _canvas = opts.canvas;
  }

  /* The library, fetched once. A failed fetch is forgotten, so the next PDF
     tries again (the device may be back online). */
  function library() {
    if (_lib) return _lib;
    _lib = Promise.resolve()
      .then(function () {
        return _load(LIBRARY_URL);
      })
      .then(function (mod) {
        var lib = mod && typeof mod.getDocument === 'function' ? mod : mod && mod.default;
        if (!lib || typeof lib.getDocument !== 'function' || !lib.GlobalWorkerOptions) {
          throw new Error('pdf.js did not load');
        }
        if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
        return lib;
      })
      .catch(function (err) {
        _lib = null;
        throw _fail(REASONS.NO_DECODER, 'The PDF reader could not load: ' + (err && err.message ? err.message : err));
      });
    return _lib;
  }

  /* Has the library been fetched yet? (The tests check it is not, until a
     PDF is opened.) */
  function loaded() {
    return !!_lib;
  }

  function _bytes(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') {
      return blob.arrayBuffer().then(function (buf) {
        return new Uint8Array(buf);
      });
    }
    if (blob instanceof Uint8Array) return Promise.resolve(blob);
    return Promise.reject(_fail(REASONS.UNREADABLE, 'Nothing to read'));
  }

  /* pdf.js's refusal, as one of ours. */
  function _why(err) {
    if (err && err.reason) return err;
    var name = (err && err.name) || '';
    var message = err && err.message ? err.message : String(err);
    if (name === 'PasswordException') return _fail(REASONS.UNREADABLE, 'The PDF is locked', { locked: true });
    return _fail(REASONS.UNREADABLE, 'The PDF could not be read: ' + message);
  }

  function _options(lib, bytes) {
    return {
      data: bytes,
      cMapUrl: BASE + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: BASE + 'standard_fonts/',
      wasmUrl: BASE + 'wasm/',
      iccUrl: BASE + 'iccs/',
      // Glyphs are drawn as shapes: nothing is added to the page's fonts.
      disableFontFace: true,
      useSystemFonts: false,
      // A form's scripts never run; links and other web lookups never happen.
      enableXfa: false,
      isEvalSupported: false,
      stopAtErrors: false,
      verbosity: lib.VerbosityLevel ? lib.VerbosityLevel.ERRORS : 0,
    };
  }

  /* Page n drawn on a white canvas with its long side at longSide. */
  function _draw(lib, doc, n, longSide) {
    var canvas = null;
    return doc
      .getPage(n)
      .then(function (page) {
        var one = page.getViewport({ scale: 1 });
        var scale = Math.min(MAX_SCALE, longSide / Math.max(one.width, one.height));
        var viewport = page.getViewport({ scale: scale });
        var w = Math.max(1, Math.round(viewport.width));
        var h = Math.max(1, Math.round(viewport.height));
        canvas = _canvas(w, h);
        var ctx = canvas.getContext('2d');
        if (!ctx) throw _fail(REASONS.UNREADABLE, 'The browser could not open a canvas');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        var task = page.render({
          canvasContext: ctx,
          canvas: canvas,
          viewport: viewport,
          // As it would print: filled-in form fields included.
          intent: 'print',
          annotationMode: lib.AnnotationMode ? lib.AnnotationMode.ENABLE_STORAGE : 3,
          background: '#ffffff',
        });
        return task.promise.then(function () {
          page.cleanup();
          var drawn = canvas;
          return {
            width: w,
            height: h,
            source: drawn,
            close: function () {
              // Frees the canvas's memory now; a phone runs out fast.
              drawn.width = 0;
              drawn.height = 0;
            },
          };
        });
      })
      .catch(function (err) {
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
        throw _why(err);
      });
  }

  /* The seam photo-shrink.js asks for. */
  function openPdf(blob, opts) {
    var longSide = (opts && opts.longSide) || LONG_SIDE;
    return library().then(function (lib) {
      return _bytes(blob).then(function (bytes) {
        var task;
        try {
          task = lib.getDocument(_options(lib, bytes));
        } catch (err) {
          throw _why(err);
        }
        return task.promise.then(
          function (doc) {
            var closed = false;
            return {
              pages: doc.numPages,
              page: function (n) {
                if (closed) return Promise.reject(_fail(REASONS.UNREADABLE, 'The PDF was closed'));
                return _draw(lib, doc, n, longSide);
              },
              close: function () {
                if (closed) return;
                closed = true;
                Promise.resolve(task.destroy()).catch(function () {});
              },
            };
          },
          function (err) {
            Promise.resolve(task.destroy()).catch(function () {});
            throw _why(err);
          },
        );
      });
    });
  }

  return {
    openPdf: openPdf,
    configure: configure,
    loaded: loaded,
    WORKER_URL: WORKER_URL,
    MAX_SCALE: MAX_SCALE,
  };
})();
