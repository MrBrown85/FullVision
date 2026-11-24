// @ts-check
/* shared/handout-out.js — print a handout, or keep it as a PDF on the phone

   Colin, Nov 24 2026: students could not print or keep a teacher's handout.
   The pages are already on the device (s/handouts.js keeps them for the
   session; Preview as Student opens them the same way), so both are built
   from those pages. Nothing is sent: a printout goes to the student's own
   print sheet, a PDF to the student's own share sheet or download.

   HandoutOut.print(pages)        pages: [ { url, blob? } ], every one here
   HandoutOut.save(pages, title)  → 'shared' | 'saved' | 'cancelled'
   HandoutOut.fileName(title)     the title as a file name, plus .pdf

   A page with its original JPEG (blob) goes into the PDF as it is; any
   other picture (Demo Mode's samples, Preview's) is drawn once on a canvas
   and kept as a JPEG. The page's Content Security Policy lets a picture
   load from a blob: address and not fetch one, so a picture is read
   through an image and a canvas, never fetch.

   Print: the pages go in a container at the end of the body that only
   the print stylesheet shows (shared/handout-out.css), one per sheet. It
   is taken away after printing.
*/
/** @type {any} */ (window).HandoutOut = (function () {
  'use strict';

  var LONG_SIDE = 2000;
  /** @type {HTMLElement | null} */
  var sheet = null; // the print container, while there is one
  var sheetTimer = 0;

  // The title as the EPUB viewer's Save to Phone cleans it, plus .pdf.
  function fileName(title) {
    var name = String(title || '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return (name || 'Handout') + '.pdf';
  }

  function readBlob(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        resolve(r.result);
      };
      r.onerror = function () {
        reject(new Error('read failed'));
      };
      r.readAsArrayBuffer(blob);
    });
  }

  // A picture at `url`, loaded.
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error('picture failed'));
      };
      img.src = url;
    });
  }

  // The picture at `url` drawn on white and kept as a JPEG.
  function redraw(url) {
    return loadImage(url).then(function (img) {
      var w = img.naturalWidth || img.width || 1000;
      var h = img.naturalHeight || img.height || 1300;
      var scale = Math.min(1, LONG_SIDE / Math.max(w, h));
      // A drawing that names no size, or a small one, is drawn larger so it stays sharp on paper.
      if (Math.max(w, h) < 1200) scale = 1200 / Math.max(w, h);
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      var ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(
          function (b) {
            if (b) resolve(b);
            else reject(new Error('no jpeg'));
          },
          'image/jpeg',
          0.92,
        );
      });
    });
  }

  // One page as { bytes, width, height, components } for the PDF writer.
  function jpegOf(page) {
    var Pdf = /** @type {any} */ (window).HandoutPdf;
    function parse(blob) {
      return readBlob(blob).then(function (buf) {
        var bytes = new Uint8Array(buf);
        var info = Pdf.jpegInfo(bytes);
        return info ? { bytes: bytes, width: info.width, height: info.height, components: info.components } : null;
      });
    }
    return (page.blob ? parse(page.blob) : Promise.resolve(null)).then(function (got) {
      if (got) return got;
      return redraw(page.url)
        .then(parse)
        .then(function (again) {
          if (!again) throw new Error('not a picture');
          return again;
        });
    });
  }

  function pdfFile(pages, title) {
    return Promise.all(pages.map(jpegOf)).then(function (list) {
      var bytes = /** @type {any} */ (window).HandoutPdf.build(list);
      return new File([bytes], fileName(title), { type: 'application/pdf' });
    });
  }

  function download(file) {
    var url = URL.createObjectURL(file);
    var a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.rel = 'noopener';
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 60000);
  }

  /* The share sheet where the phone has one for a file (on an iPhone it
     has Print, Save to Files and Google Drive), else a download. A student
     who closes the sheet has changed their mind: that is not an error. */
  function save(pages, title) {
    return pdfFile(pages, title).then(function (file) {
      var nav = /** @type {any} */ (navigator);
      var canShare = false;
      try {
        canShare = !!(nav.canShare && nav.share && nav.canShare({ files: [file] }));
      } catch (e) {
        canShare = false;
      }
      if (!canShare) {
        download(file);
        return 'saved';
      }
      return nav.share({ files: [file], title: String(title || '') }).then(
        function () {
          return 'shared';
        },
        function (err) {
          if (err && err.name === 'AbortError') return 'cancelled';
          // The sheet would not open (Safari wants a tap more recent than this): the file still comes.
          download(file);
          return 'saved';
        },
      );
    });
  }

  function clearSheet() {
    clearTimeout(sheetTimer);
    window.removeEventListener('afterprint', clearSheet);
    if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet);
    sheet = null;
    document.body.classList.remove('fv-printing');
  }

  /* Every page in a print-only container, one to a sheet, then the print
     sheet. Resolves when the container has been taken away. */
  function print(pages) {
    clearSheet();
    var box = document.createElement('div');
    box.className = 'fv-print-sheet';
    box.setAttribute('aria-hidden', 'true');
    var imgs = pages.map(function (pg) {
      var img = document.createElement('img');
      img.className = 'fv-print-page';
      img.alt = '';
      img.src = pg.url;
      box.appendChild(img);
      return img;
    });
    sheet = box;
    document.body.appendChild(box);
    document.body.classList.add('fv-printing');
    var ready = Promise.all(
      imgs.map(function (img) {
        if (img.complete && img.naturalWidth) return Promise.resolve();
        return new Promise(function (resolve) {
          img.onload = img.onerror = function () {
            resolve(undefined);
          };
        });
      }),
    );
    return ready.then(function () {
      if (sheet !== box) return;
      return new Promise(function (resolve) {
        function done() {
          if (sheet === box) clearSheet();
          resolve(undefined);
        }
        window.addEventListener('afterprint', done, { once: true });
        // Some phones never say the print sheet closed: the container goes after a minute regardless.
        sheetTimer = setTimeout(done, 60000);
        try {
          window.print();
        } catch (e) {
          done();
        }
      });
    });
  }

  return { print: print, save: save, fileName: fileName, pdfFile: pdfFile };
})();
