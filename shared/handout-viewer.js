// @ts-check
/* shared/handout-viewer.js — a teacher's handout file, open on the student's screen

   Colin, Nov 17 2026: a teacher can attach a web page (HTML), a text file
   (TXT) or an EPUB to an assessment, and the student opens it from For This
   Assignment. The student page (s/handouts.js) and Preview as Student
   (teacher/preview-student.js) both open it here, so the teacher sees what
   the student sees.

     HandoutViewer.open({ host, title, kind, load, returnTo, onClose })
       kind   'html' | 'txt' | 'epub'
       load() → Promise of the file's Blob, or null when it did not come
       host   where the viewer lies over: document.body (the default, the
              whole screen) or the preview's device screen
     It draws over the page, on its own, so nothing the page draws again
     can close it or lose what a student typed into a worksheet.

   How each kind is shown:
     txt    as plain text, through textContent: never as HTML.
     html   in the sealed frame, shared/handout-frame.html, framed with
            sandbox="allow-scripts allow-forms allow-popups
            allow-popups-to-escape-sandbox allow-modals" and never
            allow-same-origin. The frame's own address carries a policy
            that seals it too (netlify/edge-functions/inject-env.js). Its
            scripts run, with an origin of their own: they cannot read this
            page, its storage, its cookies or its sign-in. The page's text
            is handed to the frame by postMessage, once it says it is ready.
     epub   its files read here with fflate (vendor/fflate, loaded the
            first time a book is opened), every picture, font and style it
            names put inside its chapter, and the chapters handed to the
            same sealed frame, which turns their pages. Previous Page and
            Next Page here, the arrow keys and a swipe there. Save to Phone
            keeps the .epub on the device, for a book app.
   A message from the frame is read only when it comes from that frame,
   and only for its page numbers. Nothing here is sent anywhere. */
/** @type {any} */ (window).HandoutViewer = (function () {
  'use strict';

  /** @type {any} */
  var w = window;

  var FRAME_URL = '/shared/handout-frame.html';
  var FFLATE_URL = '/vendor/fflate/fflate.min.js';
  // No allow-popups: nothing in the frame can open a window (a web link goes through askToOpen).
  var SANDBOX = 'allow-scripts allow-forms allow-modals';
  var KIND_WORDS = { html: 'Web Page', txt: 'Text File', epub: 'Book' };
  /** @type {{ layer: HTMLElement, close: () => void } | null} */
  var open_ = null; // the viewer on screen
  /** @type {Promise<any> | null} */
  var fflateLoading = null;

  /** @returns {any} an element (a button's type and disabled are set on it) */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function backIcon() {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M15 5l-7 7 7 7');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2.2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }

  // Text from bytes: UTF-8, or Windows-1252 when it is not (shared/handout-files.js stores UTF-8).
  function decode(bytes) {
    if (w.HandoutFiles && typeof w.HandoutFiles.decodeText === 'function') return w.HandoutFiles.decodeText(bytes);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
    } catch (e) {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  function bytesOf(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') {
      return blob.arrayBuffer().then(function (b) {
        return new Uint8Array(b);
      });
    }
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        resolve(new Uint8Array(/** @type {ArrayBuffer} */ (r.result)));
      };
      r.onerror = function () {
        reject(r.error);
      };
      r.readAsArrayBuffer(blob);
    });
  }

  /* ── An EPUB's chapters ── */

  function loadFflate() {
    if (w.fflate && typeof w.fflate.unzipSync === 'function') return Promise.resolve(w.fflate);
    if (fflateLoading) return fflateLoading;
    var loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = FFLATE_URL;
      s.async = true;
      s.onload = function () {
        if (w.fflate && typeof w.fflate.unzipSync === 'function') resolve(w.fflate);
        else reject(new Error('fflate did not load'));
      };
      s.onerror = function () {
        reject(new Error('fflate did not load'));
      };
      document.head.appendChild(s);
    });
    fflateLoading = loading;
    loading.then(null, function () {
      fflateLoading = null;
    });
    return loading;
  }

  var MEDIA = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    css: 'text/css',
    ttf: 'font/ttf',
    otf: 'font/otf',
    woff: 'font/woff',
    woff2: 'font/woff2',
  };

  // A path inside the book, from `href` written in the file at `base`.
  function resolvePath(base, href) {
    try {
      var u = new URL(String(href || ''), 'https://book.invalid/' + String(base || ''));
      if (u.origin !== 'https://book.invalid') return null;
      return decodeURIComponent(u.pathname.slice(1));
    } catch (e) {
      return null;
    }
  }

  function base64(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 0x8000)
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }

  // The most an EPUB may unzip to here (a book of 20 MB that unzips past it is a bomb, or too big to read).
  var BOOK_MAX_BYTES = 100 * 1024 * 1024;
  var BOOK_MAX_FILES = 10000;

  /* What the book unzips to, read from the zip's own directory before
     anything is inflated: each entry's stated size, summed. Throws
     Error('too_large') past BOOK_MAX_BYTES or BOOK_MAX_FILES, or for a
     ZIP64 entry (its sizes are not in the plain fields), and Error('not a
     zip') when there is no directory. fflate inflates each entry into a
     buffer of its stated size, so the stated sizes bound what is made. */
  function unzippedSize(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var end = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error('not a zip');
    var count = dv.getUint16(end + 10, true);
    var at = dv.getUint32(end + 16, true);
    if (count === 0xffff || at === 0xffffffff || count > BOOK_MAX_FILES) throw new Error('too_large');
    var total = 0;
    for (var n = 0; n < count; n++) {
      if (at + 46 > bytes.length || dv.getUint32(at, true) !== 0x02014b50) throw new Error('not a zip');
      var size = dv.getUint32(at + 24, true);
      if (size === 0xffffffff) throw new Error('too_large');
      total += size;
      if (total > BOOK_MAX_BYTES) throw new Error('too_large');
      at += 46 + dv.getUint16(at + 28, true) + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true);
    }
    return total;
  }

  /* Read an EPUB: { chapters: [ { path, html, css } ] }, in reading order.
     Each picture, font and stylesheet a chapter names is put inside it as
     a data: address; scripts are left out. Throws when it is not a book. */
  function readBook(bytes, zip) {
    var lib = zip || w.fflate;
    unzippedSize(bytes);
    var files = lib.unzipSync(bytes);
    var types = {};
    var dataOf = function (path) {
      var b = path && files[path];
      if (!b) return null;
      var ext = (/\.([a-z0-9]+)$/i.exec(path) || [])[1];
      var type = types[path] || MEDIA[String(ext || '').toLowerCase()] || 'application/octet-stream';
      return 'data:' + type + ';base64,' + base64(b);
    };
    var textOf = function (path) {
      return path && files[path] ? decode(files[path]) : null;
    };
    var parse = function (text, type) {
      var doc = new DOMParser().parseFromString(text, type);
      return doc.getElementsByTagName('parsererror').length ? null : doc;
    };
    var container = parse(textOf('META-INF/container.xml') || '', 'application/xml');
    var root = container && container.getElementsByTagName('rootfile')[0];
    var opfPath = root && root.getAttribute('full-path');
    var opf = opfPath ? parse(textOf(opfPath) || '', 'application/xml') : null;
    if (!opf) throw new Error('not an EPUB');
    var items = {};
    Array.prototype.forEach.call(opf.getElementsByTagName('item'), function (it) {
      var path = resolvePath(opfPath, it.getAttribute('href'));
      if (!path) return;
      items[it.getAttribute('id')] = path;
      if (it.getAttribute('media-type')) types[path] = it.getAttribute('media-type');
    });
    var spine = [];
    Array.prototype.forEach.call(opf.getElementsByTagName('itemref'), function (ref) {
      var path = items[ref.getAttribute('idref')];
      if (path && files[path] && ref.getAttribute('linear') !== 'no') spine.push(path);
    });
    if (!spine.length) throw new Error('an EPUB with no chapters');
    var inCss = function (css, base) {
      return String(css || '').replace(/url\(\s*(["']?)([^"')]+?)\1\s*\)/gi, function (all, q, ref) {
        if (/^(data|https?):/i.test(ref)) return all;
        var d = dataOf(resolvePath(base, ref));
        return d ? 'url("' + d + '")' : all;
      });
    };
    var chapters = spine.slice(0, 500).map(function (path) {
      var text = textOf(path) || '';
      var doc = parse(text, 'application/xhtml+xml') || new DOMParser().parseFromString(text, 'text/html');
      var css = '';
      Array.prototype.slice.call(doc.getElementsByTagName('link')).forEach(function (l) {
        if (!/stylesheet/i.test(l.getAttribute('rel') || '')) return;
        var p = resolvePath(path, l.getAttribute('href'));
        if (p && files[p]) css += inCss(textOf(p), p) + '\n';
      });
      Array.prototype.slice.call(doc.getElementsByTagName('style')).forEach(function (s) {
        css += inCss(s.textContent, path) + '\n';
        if (s.parentNode) s.parentNode.removeChild(s);
      });
      Array.prototype.slice.call(doc.getElementsByTagName('script')).forEach(function (s) {
        if (s.parentNode) s.parentNode.removeChild(s);
      });
      Array.prototype.forEach.call(doc.getElementsByTagName('img'), function (img) {
        var d = dataOf(resolvePath(path, img.getAttribute('src')));
        if (d) img.setAttribute('src', d);
        img.removeAttribute('srcset');
      });
      Array.prototype.forEach.call(doc.getElementsByTagName('image'), function (img) {
        var XL = 'http://www.w3.org/1999/xlink';
        var ref = img.getAttribute('href') || img.getAttributeNS(XL, 'href');
        var d = dataOf(resolvePath(path, ref));
        if (!d) return;
        img.setAttribute('href', d);
        if (img.hasAttributeNS(XL, 'href')) img.setAttributeNS(XL, 'xlink:href', d);
      });
      var body = doc.body || doc.getElementsByTagName('body')[0];
      var html = '';
      if (body) {
        var ser = new XMLSerializer();
        Array.prototype.forEach.call(body.childNodes, function (n) {
          html += ser.serializeToString(n);
        });
      }
      return { path: path, html: html, css: css };
    });
    return { chapters: chapters };
  }

  /* ── The viewer ── */

  function close() {
    if (open_) open_.close();
  }

  function open(opts) {
    opts = opts || {};
    close();
    var kind = KIND_WORDS[opts.kind] ? opts.kind : '';
    var host = opts.host || document.body;
    var title = String(opts.title || 'Handout');
    var urls = [];
    /** @type {any} */
    var frame = null;
    var where = { page: 0, pages: 0, chapter: 0, chapters: 0 };
    /** @type {Blob | null} */
    var savedBlob = null;
    var closed = false;

    var layer = el('div', 'hv-layer' + (host === document.body ? ' hv-whole' : ''));
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'hv-title');
    layer.setAttribute('data-kind', kind);
    var head = el('div', 'hv-head');
    var back = el('button', 'hv-back');
    back.type = 'button';
    back.setAttribute('aria-label', 'Back');
    back.appendChild(backIcon());
    var words = el('div', 'hv-words');
    var h1 = el('h1', 'hv-title', title);
    h1.id = 'hv-title';
    h1.tabIndex = -1;
    var sub = el('p', 'hv-sub', KIND_WORDS[kind] || 'Handout');
    words.appendChild(h1);
    words.appendChild(sub);
    head.appendChild(back);
    head.appendChild(words);
    // A book's own controls; drawn for an EPUB only.
    var save = el('button', 'hv-save', 'Save to Phone');
    save.type = 'button';
    save.disabled = true;
    if (kind === 'epub') head.appendChild(save);
    var body = el('div', 'hv-body');
    var msg = el('p', 'hv-msg', 'Getting the handout…');
    msg.setAttribute('role', 'status');
    body.appendChild(msg);
    layer.appendChild(head);
    layer.appendChild(body);
    var bar = el('div', 'hv-bar');
    var prev = el('button', 'hv-turn hv-prev', 'Previous Page');
    var next = el('button', 'hv-turn hv-next', 'Next Page');
    prev.type = next.type = 'button';
    var count = el('span', 'hv-count', '');
    count.setAttribute('aria-live', 'polite');
    bar.appendChild(prev);
    bar.appendChild(count);
    bar.appendChild(next);
    bar.hidden = true;
    if (kind === 'epub') layer.appendChild(bar);
    host.appendChild(layer);

    function say(text, retry) {
      while (body.firstChild) body.removeChild(body.firstChild);
      var p = el('p', 'hv-msg', text);
      p.setAttribute('role', retry ? 'alert' : 'status');
      body.appendChild(p);
      if (retry) {
        var again = el('button', 'hv-retry', 'Try Again');
        again.type = 'button';
        again.addEventListener('click', start);
        body.appendChild(again);
      }
    }

    function showWhere() {
      if (kind !== 'epub') return;
      bar.hidden = false;
      var book = where.chapters > 1 ? 'Part ' + (where.chapter + 1) + ' of ' + where.chapters + ' · ' : '';
      count.textContent = book + 'Page ' + (where.page + 1) + ' of ' + Math.max(1, where.pages);
      sub.textContent = 'Book';
      prev.disabled = where.chapter === 0 && where.page === 0;
      next.disabled = where.chapter >= where.chapters - 1 && where.page >= where.pages - 1;
    }

    function turn(by) {
      if (frame && frame.contentWindow) frame.contentWindow.postMessage({ fv: 'handout-turn', by: by }, '*');
    }

    /* A web link the student clicked in the handout (or so the frame says:
       a handout's script could say it too). Nothing opens until the student
       presses Open Website, here in FullVision's own page, with the address
       in front of them; then it opens in a new tab, with no way back. The
       question is the one Bulletins asks too (shared/website-ask.js). */
    function askToOpen(url) {
      if (w.WebsiteAsk) w.WebsiteAsk.open({ host: layer, url: url, cls: 'hv-ask' });
    }

    // Only the frame's own messages: its page numbers, and a link to ask about.
    function onMessage(e) {
      if (!frame || e.source !== frame.contentWindow || !e.data) return;
      if (e.data.fv === 'handout-link' && typeof e.data.url === 'string') return askToOpen(e.data.url);
      if (e.data.fv !== 'handout-frame') return;
      var d = e.data;
      if (d.ready === true && frame._fvSend) {
        var send = frame._fvSend;
        frame._fvSend = null;
        frame.contentWindow.postMessage(send, '*');
        return;
      }
      var whole = function (n) {
        return typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n && n < 100000;
      };
      if (whole(d.page) && whole(d.pages) && whole(d.chapter) && whole(d.chapters)) {
        where = { page: d.page, pages: d.pages, chapter: d.chapter, chapters: d.chapters };
        showWhere();
      }
    }

    function sealed(message) {
      while (body.firstChild) body.removeChild(body.firstChild);
      frame = document.createElement('iframe');
      frame.className = 'hv-frame';
      frame.setAttribute('sandbox', SANDBOX);
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('title', title);
      frame._fvSend = message;
      frame.src = opts.frameUrl || FRAME_URL;
      body.appendChild(frame);
    }

    function showText(text) {
      while (body.firstChild) body.removeChild(body.firstChild);
      var pre = el('pre', 'hv-text');
      pre.textContent = text;
      pre.tabIndex = 0;
      body.appendChild(pre);
    }

    function start() {
      say('Getting the handout…');
      Promise.resolve()
        .then(function () {
          return opts.load ? opts.load() : null;
        })
        .then(function (blob) {
          if (closed) return;
          if (!blob) return say('The handout didn’t load. Check your internet and try again.', true);
          return bytesOf(blob).then(function (bytes) {
            if (closed) return;
            if (kind === 'txt') return showText(decode(bytes));
            if (kind === 'html') return sealed({ fv: 'handout-show', mode: 'page', html: decode(bytes) });
            if (kind === 'epub') {
              savedBlob = new Blob([bytes], { type: 'application/epub+zip' });
              save.disabled = false;
              return loadFflate().then(
                function (lib) {
                  if (closed) return;
                  var book;
                  try {
                    book = readBook(bytes, lib);
                  } catch (e) {
                    if (e instanceof Error && e.message === 'too_large') {
                      return say('This book is too large to open here; use Save to Phone.');
                    }
                    return say('This book couldn’t be opened here. Save it to your phone to read it in a book app.');
                  }
                  sealed({ fv: 'handout-show', mode: 'book', chapters: book.chapters });
                },
                function () {
                  say('The book reader didn’t load. Check your internet and try again.', true);
                },
              );
            }
            say('This handout can’t be shown here.');
          });
        })
        .then(null, function () {
          if (!closed) say('The handout didn’t load. Check your internet and try again.', true);
        });
    }

    function saveToPhone() {
      if (!savedBlob || typeof URL === 'undefined' || !URL.createObjectURL) return;
      var url = URL.createObjectURL(savedBlob);
      urls.push(url);
      var a = document.createElement('a');
      a.href = url;
      a.download =
        title
          .replace(/[\\/:*?"<>|]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120) + '.epub';
      a.rel = 'noopener';
      a.hidden = true;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    function onKey(e) {
      if (e.key === 'Escape' && layer.querySelector('.hv-ask')) {
        e.preventDefault();
        if (w.WebsiteAsk) w.WebsiteAsk.close();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      } else if (kind === 'epub' && frame && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        var t = e.target;
        if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
        e.preventDefault();
        turn(e.key === 'ArrowRight' ? 1 : -1);
      }
    }

    function finish() {
      if (closed) return;
      closed = true;
      window.removeEventListener('message', onMessage);
      document.removeEventListener('keydown', onKey, true);
      urls.forEach(function (u) {
        try {
          URL.revokeObjectURL(u);
        } catch (e) {
          /* already gone */
        }
      });
      urls = [];
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      if (open_ && open_.layer === layer) open_ = null;
      var to = opts.returnTo;
      if (to && to.isConnected && typeof to.focus === 'function') to.focus();
      if (typeof opts.onClose === 'function') opts.onClose();
    }

    back.addEventListener('click', finish);
    save.addEventListener('click', saveToPhone);
    prev.addEventListener('click', function () {
      turn(-1);
    });
    next.addEventListener('click', function () {
      turn(1);
    });
    window.addEventListener('message', onMessage);
    document.addEventListener('keydown', onKey, true);
    open_ = { layer: layer, close: finish };
    if (!kind) say('This handout can’t be shown here.');
    else start();
    h1.focus();
    return { close: finish, layer: layer };
  }

  return {
    open: open,
    close: close,
    isOpen: function () {
      return !!open_;
    },
    readBook: readBook,
    unzippedSize: unzippedSize,
    BOOK_MAX_BYTES: BOOK_MAX_BYTES,
    FRAME_URL: FRAME_URL,
    SANDBOX: SANDBOX,
  };
})();
