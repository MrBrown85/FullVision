// @ts-check
/* shared/handout-files.js — a teacher's files, made ready to attach as handouts

   Colin, Nov 17 2026: "+ Add a PDF" becomes "+ Add a File". A PDF still
   becomes pages (shared/photo-shrink.js). A web page (.html, .htm), a text
   file (.txt) or an EPUB (.epub) is kept as the teacher chose it, 20 MB at
   most (the bucket handout-files, migrations/2026111706_handout_files.sql).

   A web page's pictures often sit beside it on disk (<img src="map.png">).
   The teacher picks the page and its pictures together; each picture the
   page names is put inside the one stored file as a data: address, so the
   file needs nothing beside it. Pictures are matched by file name (a
   browser gives no folders), whatever folder the page names. What the
   page names and was not picked is said plainly (missing), and so is a
   picture picked that no page uses.

   Text is read as UTF-8, or as Windows-1252 when it is not UTF-8, and kept
   as UTF-8: the student page reads it as UTF-8.

   Nothing here draws, sends or keeps anything: HandoutFiles.prepare(files)
   answers what to attach (shared/data.js addAssessmentHandoutFile keeps
   it) and what to say. Every window.HandoutFiles.* is its public surface.
*/
/** @type {any} */ (window).HandoutFiles = (function () {
  'use strict';

  var MAX_BYTES = 20971520; // 20 MB: the bucket's limit
  var TYPES = { html: 'text/html', txt: 'text/plain', epub: 'application/epub+zip' };
  var PICTURE_TYPES = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    ico: 'image/x-icon',
  };
  var PICTURE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif|ico)$/i;

  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  /* What a picked file is: 'pdf' | 'html' | 'txt' | 'epub' | 'picture', or
     null for anything else. By its name first (a browser often gives an
     EPUB no type), then by its type. */
  function kindOf(file) {
    var ext = extOf(file && file.name);
    var type = String((file && file.type) || '').toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'html';
    if (ext === 'txt' || ext === 'text') return 'txt';
    if (ext === 'epub') return 'epub';
    if (PICTURE_TYPES[ext]) return 'picture';
    if (ext) return null;
    if (type === 'application/pdf') return 'pdf';
    if (type === 'text/html') return 'html';
    if (type === 'text/plain') return 'txt';
    if (type === 'application/epub+zip') return 'epub';
    if (/^image\//.test(type)) return 'picture';
    return null;
  }

  // The name students see: the file's name without its ending, at most 200 characters.
  function titleOf(name) {
    var t = String(name || '')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/_+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return (t || 'Handout').slice(0, 200);
  }

  // A size as a teacher reads it: 900 bytes, 52 KB, 2.9 MB.
  function sizeWord(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + (n === 1 ? ' byte' : ' bytes');
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    // A file size, not a grade: one figure after the point, by Math.round.
    return String(Math.round((n / (1024 * 1024)) * 10) / 10) + ' MB';
  }

  /* Text from bytes: UTF-8 (a byte-order mark dropped), or Windows-1252
     when the bytes are not UTF-8. */
  function decodeText(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || new ArrayBuffer(0));
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
    } catch (e) {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  // An address inside the page that names a file beside it: no scheme, not //host, not #anchor.
  function isLocal(ref) {
    var s = String(ref || '').trim();
    return !!s && !/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^\/\//.test(s) && s.charAt(0) !== '#';
  }

  // The file name an address names, as picked files are matched: decoded, lower case, no folder.
  function nameOf(ref) {
    var s = String(ref || '')
      .trim()
      .replace(/[?#].*$/, '');
    var last = s.split(/[\\/]/).pop() || '';
    try {
      last = decodeURIComponent(last);
    } catch (e) {
      /* kept as written */
    }
    return last.toLowerCase();
  }

  // The file name as the page wrote it, for saying which is missing.
  function shownName(ref) {
    var last =
      String(ref || '')
        .trim()
        .replace(/[?#].*$/, '')
        .split(/[\\/]/)
        .pop() || '';
    try {
      return decodeURIComponent(last);
    } catch (e) {
      return last;
    }
  }

  /* Put each picked picture the page names into the page.
     pictures: { lowercased file name: data: address }. Where a page names a
     picture: src, poster and srcset values; url(...) in its styles; and any
     quoted address ending in a picture's name (a script that sets a
     picture's address). → { html, used: [names], missing: [names as the
     page wrote them, each once] } — missing are the pictures the page names
     in src, poster, srcset or url(...) that were not picked. */
  function inlinePictures(html, pictures) {
    pictures = pictures || {};
    /** @type {Record<string, boolean>} */
    var used = {};
    /** @type {string[]} */
    var missing = [];
    /** @type {Record<string, boolean>} */
    var seenMissing = {};
    function swap(ref) {
      if (!isLocal(ref)) return null;
      var n = nameOf(ref);
      if (Object.prototype.hasOwnProperty.call(pictures, n)) {
        used[n] = true;
        return pictures[n];
      }
      return null;
    }
    function note(ref) {
      if (!isLocal(ref) || !PICTURE_EXT.test(nameOf(ref)) || swap(ref)) return;
      var key = nameOf(ref);
      if (!seenMissing[key]) {
        seenMissing[key] = true;
        missing.push(shownName(ref));
      }
    }
    var out = String(html || '');
    // srcset: each address in the list.
    out = out.replace(/(\ssrcset\s*=\s*)(["'])([\s\S]*?)\2/gi, function (all, lead, q, list) {
      var next = list
        .split(',')
        .map(function (part) {
          var bits = part.trim().split(/\s+/);
          note(bits[0]);
          var to = swap(bits[0]);
          if (to) bits[0] = to;
          return bits.join(' ');
        })
        .join(', ');
      return lead + q + next + q;
    });
    // src and poster, quoted or not.
    out = out.replace(/(\s(?:src|poster|xlink:href|href)\s*=\s*)(["'])([^"']*)\2/gi, function (all, lead, q, ref) {
      var attr = lead.trim().toLowerCase();
      var isHref = /href/.test(attr);
      if (isHref && !PICTURE_EXT.test(nameOf(ref))) return all;
      note(ref);
      var to = swap(ref);
      return to ? lead + q + to + q : all;
    });
    out = out.replace(/(\s(?:src|poster)\s*=\s*)([^\s"'>]+)/gi, function (all, lead, ref) {
      note(ref);
      var to = swap(ref);
      return to ? lead + '"' + to + '"' : all;
    });
    // url(...) in styles.
    out = out.replace(/url\(\s*(["']?)([^"')]+?)\1\s*\)/gi, function (all, q, ref) {
      note(ref);
      var to = swap(ref);
      return to ? 'url("' + to + '")' : all;
    });
    // Any other quoted address ending in a picked picture's name (a script's).
    out = out.replace(/(["'])([^"'\s<>]+\.(?:png|jpe?g|gif|svg|webp|bmp|avif|ico))\1/gi, function (all, q, ref) {
      var to = swap(ref);
      return to ? q + to + q : all;
    });
    return { html: out, used: Object.keys(used), missing: missing };
  }

  function readBuffer(file) {
    if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        resolve(r.result);
      };
      r.onerror = function () {
        reject(r.error || new Error('The file could not be read'));
      };
      r.readAsArrayBuffer(file);
    });
  }

  function base64(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(out);
  }

  // A picture as a data: address, typed by its name (or its own type).
  function pictureAddress(file) {
    var type = PICTURE_TYPES[extOf(file.name)] || String(file.type || 'image/png');
    return readBuffer(file).then(function (buf) {
      return 'data:' + type + ';base64,' + base64(new Uint8Array(buf));
    });
  }

  /* The files a teacher picked, made ready to attach.
     → Promise of {
         ready:   [ { kind: 'html' | 'txt' | 'epub', title, name, blob, bytes,
                      missing: [picture names] } ], in the order picked
         pdfs:    [ File ], for photo-shrink.js
         refused: [ { name, why: 'kind' | 'too_large' | 'empty' | 'not_epub' |
                      'unreadable' } ]
         unused:  [ picture names no page used ]
         noPage:  true when pictures were picked with no web page } */
  function prepare(files) {
    var list = Array.prototype.slice.call(files || []);
    /** @type {{ ready: any[], pdfs: any[], refused: { name: string, why: string }[], unused: string[], noPage: boolean }} */
    var out = { ready: [], pdfs: [], refused: [], unused: [], noPage: false };
    /** @type {{ kind: string, file: any }[]} */
    var pages = [];
    /** @type {any[]} */
    var pictureFiles = [];
    list.forEach(function (f) {
      var k = kindOf(f);
      if (k === 'pdf') out.pdfs.push(f);
      else if (k === 'picture') pictureFiles.push(f);
      else if (k === 'html' || k === 'txt' || k === 'epub') pages.push({ kind: k, file: f });
      else out.refused.push({ name: String((f && f.name) || ''), why: 'kind' });
    });
    var hasPage = pages.some(function (p) {
      return p.kind === 'html';
    });
    if (pictureFiles.length && !hasPage) {
      out.noPage = true;
      pictureFiles = [];
    }
    /** @type {Record<string, string>} */
    var pictures = {};
    return Promise.all(
      pictureFiles.map(function (f) {
        return pictureAddress(f).then(
          function (addr) {
            var n = String(f.name || '').toLowerCase();
            if (!Object.prototype.hasOwnProperty.call(pictures, n)) pictures[n] = addr;
          },
          function () {
            out.refused.push({ name: String(f.name || ''), why: 'unreadable' });
          },
        );
      }),
    )
      .then(function () {
        /** @type {Record<string, boolean>} */
        var used = {};
        return pages
          .reduce(function (p, item) {
            return p.then(function () {
              var f = item.file;
              var name = String(f.name || '');
              if (!(f.size > 0)) return void out.refused.push({ name: name, why: 'empty' });
              if (item.kind !== 'html' && f.size > MAX_BYTES)
                return void out.refused.push({ name: name, why: 'too_large' });
              return readBuffer(f).then(
                function (buf) {
                  var bytes = new Uint8Array(buf);
                  var blob;
                  /** @type {string[]} */
                  var missing = [];
                  if (item.kind === 'epub') {
                    // A ZIP file: it starts PK\x03\x04.
                    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
                      return void out.refused.push({ name: name, why: 'not_epub' });
                    }
                    blob = new Blob([bytes], { type: TYPES.epub });
                  } else {
                    var text = decodeText(bytes);
                    if (item.kind === 'html') {
                      var done = inlinePictures(text, pictures);
                      done.used.forEach(function (n) {
                        used[n] = true;
                      });
                      missing = done.missing;
                      text = done.html;
                    }
                    blob = new Blob([text], { type: TYPES[item.kind] });
                  }
                  if (blob.size > MAX_BYTES) return void out.refused.push({ name: name, why: 'too_large' });
                  out.ready.push({
                    kind: item.kind,
                    title: titleOf(name),
                    name: name,
                    blob: blob,
                    bytes: blob.size,
                    missing: missing,
                  });
                },
                function () {
                  out.refused.push({ name: name, why: 'unreadable' });
                },
              );
            });
          }, Promise.resolve())
          .then(function () {
            out.unused = Object.keys(pictures).filter(function (n) {
              return !used[n];
            });
            return out;
          });
      })
      .then(function () {
        return out;
      });
  }

  /* What to tell the teacher about what prepare() answered, in plain
     sentences ('' when there is nothing to say). */
  function sayAbout(out) {
    var words = [];
    (out.ready || []).forEach(function (r) {
      if (r.missing && r.missing.length) {
        words.push(
          r.title +
            ' was added, but ' +
            (r.missing.length === 1 ? 'this picture it shows was' : 'these pictures it shows were') +
            ' not chosen, so ' +
            (r.missing.length === 1 ? 'it' : 'they') +
            ' won’t appear: ' +
            r.missing.join(', ') +
            '. To include ' +
            (r.missing.length === 1 ? 'it' : 'them') +
            ', remove the page and add it again with its pictures.',
        );
      }
    });
    (out.refused || []).forEach(function (r) {
      var n = r.name || 'That file';
      if (r.why === 'too_large') words.push(n + ' is over 20 MB, too large to add.');
      else if (r.why === 'empty') words.push(n + ' is empty.');
      else if (r.why === 'not_epub') words.push(n + ' isn’t a working EPUB. Save it again, then add it.');
      else if (r.why === 'unreadable') words.push(n + ' couldn’t be read. Try another copy of it.');
      else words.push(n + ' can’t be added. Add a PDF, a web page, a text file or an EPUB.');
    });
    if (out.noPage) words.push('Pictures go with a web page. Choose the page and its pictures together.');
    else if (out.unused && out.unused.length) {
      words.push(
        (out.unused.length === 1 ? 'This picture isn’t' : 'These pictures aren’t') +
          ' in any page you chose, so ' +
          (out.unused.length === 1 ? 'it wasn’t' : 'they weren’t') +
          ' added: ' +
          out.unused.join(', ') +
          '.',
      );
    }
    return words.join(' ');
  }

  return {
    MAX_BYTES: MAX_BYTES,
    TYPES: TYPES,
    kindOf: kindOf,
    titleOf: titleOf,
    sizeWord: sizeWord,
    decodeText: decodeText,
    inlinePictures: inlinePictures,
    prepare: prepare,
    sayAbout: sayAbout,
  };
})();
