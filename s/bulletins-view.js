// @ts-check
/* Bulletins on the student's page: the first tab (docs/plans/bulletins-plan.md,
   slice B1d; the Bulletins Artboard, C1 to C3).

   The teacher's bulletins as bubbles, oldest at the top, under day headings,
   with a red New line before the first one this student had not seen. A
   reminder says until when, carries the status band of the assignment it is
   linked to and opens that card; the active one also stays as a slim bar at
   the top of the tab, and a tap brings it into view. A link is a card with
   the site's name (a tap asks first: s/bulletins.js, shared/website-ask.js).
   A file's pages swipe sideways in the bubble, and a tap opens a page full
   size. With Reactions on, three words, one tap, the student's own choice
   shown; nothing about classmates is ever in the view.

   One drawing for two places, as s/page-view.js is: the student page
   (s/bulletins.js builds the view's `bulletins`) and the teacher's Preview as
   Student (teacher/preview-student.js). Two halves, as s/page-carousel.js:
     body(view, ui)  pure: the tab's HTML, every word through esc
                     (shared/html.js); a teacher's words are text, never HTML
     press(next, view, act, el, ui)  what a press on the tab changes
                     ({ ui, focus, stay }), or null
     attach(root, source)  once the page is drawn: each file's strip follows
                     its swipe, and asks source.load(fileId, i) for a page's
                     picture as the strip comes near the screen
   view.bulletins: { list: [ { id, kind, body, link_url, link_title, pinned,
     pinned_until, assessment_id, reactions_on, posted_at, edited_at, files:
     [ { id, kind, title, page_count } ], seen, fresh, reaction, glide } ],
     pictures: { fileId: [ address by page ] }, now, preview }.
   `seen`: this student has seen it (the server's seen_at, or told since);
   `fresh`: it was not seen when this class was opened (the New line sits
   before the first one). Nothing here is a grade (plan rule 14). */
/** @type {any} */ (window).StudentBulletinsView = (function () {
  'use strict';

  /** @type {any} */
  var w = window;
  var SEP = ' · ';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // The three words a student may react with, as the server takes them (the contract, bulletin_react).
  var WORDS = [
    { id: 'got_it', label: 'Got It' },
    { id: 'done', label: 'Done' },
    { id: 'question', label: 'I Have a Question' },
  ];
  // The only addresses a page is drawn from: this device's own copy, or Demo Mode's pictures.
  var PAGE_URL =
    /^(blob:[^"'<>\s]+|(\.\.)?\/assets\/sample-bulletins\/[\w.-]+|data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/;

  var PIN =
    '<svg class="sp-bulletin-pin-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/></svg>';
  var OUT =
    '<svg class="sp-bulletin-link-go" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/></svg>';
  var BACK =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';

  /* ── Words for times (the teacher's page words them the same way:
     teacher/page-bulletins.js dayHeading and timeLabel's time; that file is
     teacher code and is not loaded here, so the rule is written again, and
     tests/bulletins-student.test.js holds the two to the same words) ── */

  function pad(n) {
    return String(n).padStart(2, '0');
  }
  // A time from the server, parsed: the server writes its own offset (-07:00, +00:00), so text is never compared.
  function dateOf(iso) {
    var t = Date.parse(String(iso || ''));
    return isNaN(t) ? null : new Date(t);
  }
  function nowOf(model) {
    var n = model && model.now;
    var t = n instanceof Date ? n.getTime() : Number(n);
    return isFinite(t) && t > 0 ? new Date(t) : new Date();
  }
  // Days from `now` back to the device's own day of `at`.
  function daysBack(at, now) {
    var a = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
    var t = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.round((t - a) / 86400000);
  }
  // The heading a bulletin sits under: Today, Yesterday, a weekday for the last six days, else the date.
  function dayHeading(iso, now) {
    var at = dateOf(iso);
    if (!at) return '';
    var today = now || new Date();
    var back = daysBack(at, today);
    if (back === 0) return 'Today';
    if (back === 1) return 'Yesterday';
    if (back > 1 && back < 7) return DAY_NAMES[at.getDay()];
    return (
      MONTHS[at.getMonth()] +
      ' ' +
      at.getDate() +
      (at.getFullYear() !== today.getFullYear() ? ', ' + at.getFullYear() : '')
    );
  }
  // The time on a bulletin, on the device's clock: "8:42 a.m." (the day is its heading's).
  function timeOf(iso) {
    var d = dateOf(iso);
    if (!d) return '';
    var h = d.getHours();
    return (h % 12 || 12) + ':' + pad(d.getMinutes()) + (h < 12 ? ' a.m.' : ' p.m.');
  }
  // A day (YYYY-MM-DD, a date with no time) as the device's own day.
  function dayOf(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  // "Thu, Nov 19", as the teacher's page says a reminder's last day.
  function dateLabel(ymd) {
    var d = dayOf(ymd);
    return d ? DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() : '';
  }
  function kindLabel(b) {
    if (b.kind === 'reminder')
      return b.pinned_until ? 'Reminder' + SEP + 'Until ' + dateLabel(b.pinned_until) : 'Reminder';
    var files = b.files || [];
    if (!b.link_url && files.length === 1 && files[0].kind === 'photo') return 'Photo of the Board';
    return '';
  }

  /* A link as the card shows it: its address and the site's name, from a real
     parse of the address (the host only). Null when it is not a web address:
     then no card is drawn that could open it. */
  function linkOf(url) {
    var u;
    try {
      u = new URL(String(url || ''));
    } catch (e) {
      return null;
    }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
    return { href: u.href, host: u.hostname.replace(/^www\./i, '') };
  }

  /* ── The pure half ─────────────────────────────────────────── */

  function listOf(model) {
    return model && Array.isArray(model.list) ? model.list : [];
  }
  // The red count on the tab: the bulletins this student has not seen.
  function count(model) {
    return listOf(model).filter(function (b) {
      return b && !b.seen;
    }).length;
  }
  // The active reminder: the newest one pinned now.
  function pinnedReminder(list) {
    var on = list.filter(function (b) {
      return b.kind === 'reminder' && b.pinned;
    });
    return on.length ? on[on.length - 1] : null;
  }
  function cssId(id) {
    return String(id).replace(/[^A-Za-z0-9_-]/g, '');
  }
  function fileIn(model, fid) {
    /** @type {any} */
    var out = null;
    listOf(model).forEach(function (b) {
      (b.files || []).forEach(function (f) {
        if (f && f.id === fid) out = f;
      });
    });
    return out;
  }
  function pictureOf(model, fid, i) {
    var all = model && model.pictures && model.pictures[fid];
    var u = all && all[i];
    return typeof u === 'string' && PAGE_URL.test(u) ? u : '';
  }
  function pagesWord(n) {
    return n === 1 ? '1 page' : n + ' pages';
  }

  // The piece a reminder is linked to, as a small card with its band; a tap opens the card.
  function pieceHtml(view, b) {
    if (!b.assessment_id || !view || !Array.isArray(view.work)) return '';
    var p = view.work.filter(function (x) {
      return x && x.id === b.assessment_id;
    })[0];
    if (!p) return '';
    var band = w.StudentPageView && w.StudentPageView.bandHtml ? w.StudentPageView.bandHtml(p, view) : '';
    var opens =
      !!(w.StudentPageView && w.StudentPageView.segmentOf && w.StudentPageView.segmentOf(p, view)) || p.kind === 'sent';
    var inner = band + '<span class="sp-bulletin-piece-title">' + esc(p.title) + '</span>';
    return opens
      ? '<button type="button" class="sp-bulletin-piece" data-act="pick" data-piece="' +
          esc(p.id) +
          '">' +
          inner +
          '</button>'
      : '<div class="sp-bulletin-piece">' + inner + '</div>';
  }

  function linkHtml(b) {
    var l = b.link_url ? linkOf(b.link_url) : null;
    if (!l) return '';
    var title = String(b.link_title || '').trim() || l.host;
    return (
      '<button type="button" class="sp-bulletin-link" data-act="bulletin-link" data-bulletin="' +
      esc(b.id) +
      '" aria-label="' +
      esc(title + ', ' + l.host + '. Opens a website') +
      '"><span class="sp-bulletin-link-words"><span class="sp-bulletin-link-title">' +
      esc(title) +
      '</span><span class="sp-bulletin-link-host">' +
      esc(l.host) +
      '</span></span>' +
      OUT +
      '</button>'
    );
  }

  // A file's pages, one wide, to swipe through; the pictures as they are here.
  function fileHtml(model, f) {
    var n = Math.max(1, Math.min(20, Math.floor(Number(f.page_count) || 1)));
    var title = String(f.title || '').trim() || (f.kind === 'photo' ? 'Photo' : 'File');
    var slides = '';
    for (var i = 0; i < n; i++) {
      var url = pictureOf(model, f.id, i);
      slides +=
        '<button type="button" class="sp-bulletin-file-slide" data-act="bulletin-page" data-file="' +
        esc(f.id) +
        '" data-page="' +
        i +
        '" aria-label="' +
        esc(title + ', page ' + (i + 1) + ' of ' + n + '. Open full size') +
        '">' +
        (url ? '<img class="sp-bulletin-file-img" src="' + esc(url) + '" alt="" draggable="false">' : '') +
        '</button>';
    }
    var dots = '';
    for (var k = 0; n > 1 && k < n; k++)
      dots += '<span class="sp-bulletin-file-dot' + (k ? '' : ' sp-bulletin-file-dot-on') + '"></span>';
    var named = f.kind !== 'photo' || title !== 'Photo';
    return (
      '<section class="sp-bulletin-file sp-bulletin-file-' +
      (f.kind === 'pdf' ? 'pdf' : 'photo') +
      '" data-bulletin-file="' +
      esc(f.id) +
      '" aria-label="' +
      esc(title) +
      '"><div class="sp-bulletin-file-frame"><div class="sp-bulletin-file-track" tabindex="0" role="group" aria-roledescription="carousel" aria-label="' +
      esc(title + SEP + pagesWord(n)) +
      '">' +
      slides +
      '</div>' +
      (n > 1 ? '<span class="sp-bulletin-file-count" aria-hidden="true">1 / ' + n + '</span>' : '') +
      '</div>' +
      (n > 1 ? '<div class="sp-bulletin-file-dots" aria-hidden="true">' + dots + '</div>' : '') +
      (named ? '<p class="sp-bulletin-file-name">' + esc(title) + '</p>' : '') +
      '</section>'
    );
  }

  function reactsHtml(b, preview) {
    if (!b.reactions_on) return '';
    return (
      '<div class="sp-bulletin-reacts" role="group" aria-label="React">' +
      WORDS.map(function (w) {
        var on = b.reaction === w.id;
        return (
          '<button type="button" class="sp-bulletin-react' +
          (on ? ' sp-bulletin-react-on' : '') +
          '" data-act="bulletin-react" data-bulletin="' +
          esc(b.id) +
          '" data-word="' +
          w.id +
          '" aria-pressed="' +
          (on ? 'true' : 'false') +
          '"' +
          (preview ? ' disabled' : '') +
          '>' +
          esc(w.label) +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function bubbleHtml(view, model, b) {
    var label = kindLabel(b);
    var words = String(b.body || '');
    var watch = !b.seen && !model.preview;
    return (
      '<article class="sp-bulletin' +
      (b.kind === 'reminder' ? ' sp-bulletin-reminder' : '') +
      (b.glide ? ' sp-bulletin-glide' : '') +
      '" id="sp-bulletin-' +
      cssId(b.id) +
      '" data-bulletin="' +
      esc(b.id) +
      '"' +
      (watch ? ' data-bulletin-unseen="' + esc(b.id) + '"' : '') +
      ' tabindex="-1">' +
      (label
        ? '<span class="sp-bulletin-kind' +
          (b.kind === 'reminder' ? ' sp-bulletin-kind-reminder">' + PIN : '">') +
          esc(label) +
          '</span>'
        : '') +
      (words.trim() ? '<p class="sp-bulletin-words">' + esc(words) + '</p>' : '') +
      (b.kind === 'reminder' ? pieceHtml(view, b) : '') +
      linkHtml(b) +
      (b.files || [])
        .map(function (f) {
          return fileHtml(model, f);
        })
        .join('') +
      reactsHtml(b, model.preview) +
      '<span class="sp-bulletin-time"><time datetime="' +
      esc(b.posted_at) +
      '">' +
      esc(timeOf(b.posted_at)) +
      '</time>' +
      (b.edited_at ? esc(SEP + 'Edited') : '') +
      '</span></article>'
    );
  }

  // The active reminder as a slim bar under the header: a tap brings it into view.
  /* The bar's words: the reminder's first line, cut at a space near 48
     characters with an ellipsis, so the bar stays slim and nothing is
     clipped by its box (the whole reminder is a tap away). */
  function shortWords(line) {
    if (line.length <= 48) return line;
    var cut = line.lastIndexOf(' ', 48);
    return line.slice(0, cut > 20 ? cut : 48).replace(/[\s,.;:]+$/, '') + '…';
  }

  function pinBarHtml(b) {
    if (!b) return '';
    var d = dayOf(b.pinned_until);
    var words =
      shortWords(
        String(b.body || '')
          .split('\n')[0]
          .trim(),
      ) || 'Reminder';
    return (
      '<button type="button" class="sp-bulletin-pinbar" data-act="bulletin-pin" data-bulletin="' +
      esc(b.id) +
      '">' +
      PIN +
      '<span class="sp-bulletin-pinbar-words">' +
      esc(words) +
      '</span>' +
      (d ? '<span class="sp-bulletin-pinbar-until">' + esc('Until ' + DAYS[d.getDay()]) + '</span>' : '') +
      '</button>'
    );
  }

  // A page of a file, full size, with the way back and the way between its pages.
  function viewerHtml(model, ui) {
    var f = fileIn(model, ui.bulletinFile);
    if (!f) return '';
    var n = Math.max(1, Math.min(20, Math.floor(Number(f.page_count) || 1)));
    var i = Math.max(0, Math.min(n - 1, Math.floor(Number(ui.bulletinPage) || 0)));
    var title = String(f.title || '').trim() || (f.kind === 'photo' ? 'Photo' : 'File');
    var url = pictureOf(model, f.id, i);
    var dots = '';
    for (var k = 0; k < n; k++)
      dots += '<span class="sp-bulletin-viewer-dot' + (k === i ? ' sp-bulletin-viewer-dot-on' : '') + '"></span>';
    var turn = function (to, label, extra) {
      return (
        '<button type="button" class="sp-bulletin-viewer-turn' +
        extra +
        '" data-act="bulletin-turn" data-page="' +
        to +
        '" aria-label="' +
        label +
        '"' +
        (to < 0 || to >= n ? ' disabled' : '') +
        '>' +
        BACK +
        '</button>'
      );
    };
    return (
      '<section class="sp-bulletin-viewer" aria-labelledby="sp-bulletin-viewer-title">' +
      '<div class="sp-bulletin-viewer-head"><button type="button" class="sp-bulletin-viewer-back" data-act="bulletin-page-close" aria-label="Back">' +
      BACK +
      '</button><div class="sp-bulletin-viewer-words"><h1 class="sp-bulletin-viewer-title" id="sp-bulletin-viewer-title" tabindex="-1">' +
      esc(title) +
      '</h1><p class="sp-bulletin-viewer-sub">' +
      esc('Page ' + (i + 1) + ' of ' + n) +
      '</p></div></div>' +
      (url
        ? '<figure class="sp-bulletin-viewer-page"><img class="sp-bulletin-viewer-img" src="' +
          esc(url) +
          '" alt="' +
          esc(title + ', page ' + (i + 1)) +
          '"></figure>'
        : '<figure class="sp-bulletin-viewer-page sp-bulletin-viewer-wait"><p class="sp-lead sp-msg-calm" role="status">Getting this page…</p></figure>') +
      (n > 1
        ? '<div class="sp-bulletin-viewer-bar">' +
          turn(i - 1, 'Previous Page', '') +
          '<span class="sp-bulletin-viewer-dots" role="img" aria-label="' +
          esc('Page ' + (i + 1) + ' of ' + n) +
          '">' +
          dots +
          '</span>' +
          turn(i + 1, 'Next Page', ' sp-bulletin-viewer-next') +
          '</div>'
        : '') +
      '</section>'
    );
  }

  /* The tab's body. The feed, oldest at the top; a day heading where the
     day changes; the New line before the first bulletin not seen when the
     class was opened. Empty, it says so. */
  function body(view, ui) {
    var model = view && view.bulletins;
    var list = listOf(model);
    var u = ui || {};
    if (u.bulletinFile) {
      var open = viewerHtml(model, u);
      if (open) return '<div class="sp-bulletin-tab">' + open + '</div>';
    }
    if (!list.length) {
      return (
        '<div class="sp-bulletin-tab"><h1 class="sp-page-title" tabindex="-1">Bulletins</h1>' +
        '<p class="sp-lead sp-empty">Bulletins from your teacher will show here.</p></div>'
      );
    }
    var now = nowOf(model);
    var lastDay = '';
    var newDrawn = false;
    var feed = list
      .map(function (b) {
        var out = '';
        // The New line first, so the day under it shows when the tab opens there.
        if (b.fresh && !newDrawn) {
          newDrawn = true;
          out += '<p class="sp-bulletin-new" id="sp-bulletin-new"><span>New</span></p>';
        }
        var day = dayHeading(b.posted_at, now);
        if (day && day !== lastDay) out += '<h2 class="sp-bulletin-day">' + esc(day) + '</h2>';
        lastDay = day;
        return out + bubbleHtml(view, model, b);
      })
      .join('');
    return (
      '<div class="sp-bulletin-tab">' +
      '<h1 class="sp-page-title sp-hidden-title" tabindex="-1">Bulletins</h1>' +
      pinBarHtml(pinnedReminder(list)) +
      '<div class="sp-bulletin-feed">' +
      feed +
      '</div></div>'
    );
  }

  /* What a press on the tab changes: a page of a file opened full size,
     turned, or closed; the reminder's bar brings the reminder into view.
     `next` is the page's ui with every other open thing closed; `was` the ui
     before the press. A link and a reaction are the student page's own
     (s/bulletins.js): nothing here sends anything. */
  function press(next, view, act, el, was) {
    var model = view && view.bulletins;
    var attr = function (name) {
      return (el && el.getAttribute && el.getAttribute(name)) || '';
    };
    var whole = function (v, n) {
      var x = Number(v);
      return x >= 0 && x < n && Math.floor(x) === x;
    };
    if (act === 'bulletin-page') {
      var f = fileIn(model, attr('data-file'));
      if (!f || !whole(attr('data-page'), Number(f.page_count) || 1)) return null;
      next.tab = 'bulletins';
      next.bulletinFile = f.id;
      next.bulletinPage = Number(attr('data-page'));
      return { ui: next, focus: '#sp-bulletin-viewer-title', bulletinFile: f.id };
    }
    if (act === 'bulletin-turn') {
      var on = fileIn(model, next.bulletinFile);
      if (!on || !whole(attr('data-page'), Number(on.page_count) || 1)) return null;
      next.bulletinPage = Number(attr('data-page'));
      return { ui: next, focus: '#sp-bulletin-viewer-title', bulletinFile: on.id };
    }
    if (act === 'bulletin-page-close') {
      var fid = (was && was.bulletinFile) || '';
      var pg = Number(was && was.bulletinPage) || 0;
      return {
        ui: next,
        stay: true,
        focus: fid
          ? '.sp-bulletin-file-slide[data-file="' + cssId(fid) + '"][data-page="' + pg + '"]'
          : '.sp-page-title',
        file: fid,
        page: pg,
      };
    }
    if (act === 'bulletin-pin') {
      var id = attr('data-bulletin');
      var b = listOf(model).filter(function (x) {
        return x && x.id === id;
      })[0];
      if (!b) return null;
      return { ui: next, stay: true, focus: '#sp-bulletin-' + cssId(b.id) };
    }
    return null;
  }

  /* ── The page's half: the strips ───────────────────────────── */

  var at = {}; // file id → the page its strip shows, kept across a redraw
  var watching = new WeakMap(); // a page drawn → its observer

  function reduceMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }
  function clamp(i, n) {
    var x = Math.floor(Number(i) || 0);
    return n > 0 ? Math.max(0, Math.min(n - 1, x)) : 0;
  }

  // A page's picture into its slide (and into the full-size page, when it is that one), in place.
  function put(root, fid, i, url) {
    if (!url || !PAGE_URL.test(url) || !root || !root.querySelectorAll) return;
    var sel = '.sp-bulletin-file-slide[data-file="' + cssId(fid) + '"][data-page="' + i + '"]';
    Array.prototype.forEach.call(root.querySelectorAll(sel), function (slide) {
      var img = slide.querySelector('img');
      if (img && img.getAttribute('src') === url) return;
      if (!img) {
        img = document.createElement('img');
        img.className = 'sp-bulletin-file-img';
        img.alt = '';
        img.draggable = false;
        slide.appendChild(img);
      }
      img.src = url;
    });
  }

  function fetchPage(root, fid, i, source) {
    var known = source.known ? source.known(fid, i) : '';
    if (known) return put(root, fid, i, known);
    Promise.resolve(source.load(fid, i)).then(
      function (url) {
        put(root, fid, i, url);
      },
      function () {
        /* stays grey */
      },
    );
  }

  function mark(el, i, n) {
    var dots = el.querySelectorAll('.sp-bulletin-file-dot');
    for (var k = 0; k < dots.length; k++) dots[k].classList.toggle('sp-bulletin-file-dot-on', k === i);
    var c = el.querySelector('.sp-bulletin-file-count');
    if (c) c.textContent = i + 1 + ' / ' + n;
  }

  function wire(root, el, source) {
    var track = el.querySelector('.sp-bulletin-file-track');
    if (!track) return null;
    var fid = el.getAttribute('data-bulletin-file') || '';
    var n = el.querySelectorAll('.sp-bulletin-file-slide').length;
    var cur = clamp(at[fid], n);
    if (cur && track.clientWidth) track.scrollLeft = cur * track.clientWidth;
    mark(el, cur, n);
    function want() {
      fetchPage(root, fid, cur, source);
      if (cur + 1 < n) fetchPage(root, fid, cur + 1, source);
    }
    function follow() {
      var w = track.clientWidth;
      var i = w > 0 ? clamp(Math.round(track.scrollLeft / w), n) : 0;
      if (i !== cur) {
        cur = i;
        at[fid] = i;
        mark(el, i, n);
      }
      want();
    }
    track.addEventListener('scroll', follow, { passive: true });
    track.addEventListener('keydown', function (/** @type {KeyboardEvent} */ e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var to = clamp(cur + (e.key === 'ArrowLeft' ? -1 : 1), n);
      track.scrollTo({ left: to * track.clientWidth, behavior: reduceMotion() ? 'auto' : 'smooth' });
    });
    return want;
  }

  /* After the page is drawn into `root`: each strip is wired, and asks for
     its pictures once it comes within 200 px of the screen. The full-size
     page asks for its own. source: { known(fid, i) -> an address here or '',
     load(fid, i) -> Promise of an address, or '' }. opts.scrollRoot: the box
     the page scrolls in, when it is not the window (the preview's device). */
  function attach(root, source, opts) {
    if (!root || !root.querySelectorAll || !source) return;
    var was = watching.get(root);
    if (was) was.disconnect();
    watching.delete(root);
    var viewer = root.querySelector('.sp-bulletin-viewer');
    if (viewer && opts && opts.open && opts.open.file) fetchPage(root, opts.open.file, opts.open.page, source);
    var els = Array.prototype.slice.call(root.querySelectorAll('.sp-bulletin-file'));
    if (!els.length) return;
    var wants = new Map();
    els.forEach(function (el) {
      var w = wire(root, el, source);
      if (w) wants.set(el, w);
    });
    if (typeof IntersectionObserver !== 'function') {
      wants.forEach(function (w) {
        w();
      });
      return;
    }
    var near = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (/** @type {any} */ e) {
          var w = e.isIntersecting && wants.get(e.target);
          if (w) w();
        });
      },
      { root: (opts && opts.scrollRoot) || null, rootMargin: '200px 0px' },
    );
    els.forEach(function (el) {
      near.observe(el);
    });
    watching.set(root, near);
  }

  /* ── The link's question, placed ───────────────────────────── */

  /* Puts the question (shared/website-ask.js's box) wholly below the card
     that was tapped, or wholly above it, whichever has room for it; when
     neither has, on the larger side with the address shortened to fit (it
     scrolls inside), and if it is still too tall, inside the screen over the
     card but never over the point that was tapped (the tap point wins over the
     screen's edge). So the finger is never under the question, Open Website
     included. Lengths in the screen's own pixels: the
     question is on <body>, outside the zoomed page. */
  function placeAsk(box, card) {
    if (!box || !card || !card.getBoundingClientRect || typeof window === 'undefined') return;
    var H = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0;
    if (!H) return;
    var GAP = 8;
    var EDGE = 8;
    var r = card.getBoundingClientRect();
    var top = Math.max(0, r.top);
    var bottom = Math.min(H, r.bottom);
    var url = box.querySelector('.sp-bulletin-ask-url');
    box.style.bottom = 'auto';
    box.style.top = EDGE + 'px';
    if (url) {
      url.style.maxHeight = '';
      url.style.overflowY = '';
    }
    var h = box.getBoundingClientRect().height;
    var above = top - GAP - EDGE;
    var below = H - bottom - GAP - EDGE;
    var down = below >= h ? true : above >= h ? false : below >= above;
    var room = down ? below : above;
    if (h > room && url) {
      var uh = url.getBoundingClientRect().height;
      url.style.maxHeight = Math.max(16, uh - (h - room)) + 'px';
      url.style.overflowY = 'auto';
      h = box.getBoundingClientRect().height;
    }
    var t = down ? bottom + GAP : top - GAP - h;
    // Still too tall for either side (a long title at Larger on a short phone): kept inside the
    // screen, over the card if it must, but never over the point the finger tapped (the card's middle).
    if (h > room) {
      t = Math.min(Math.max(t, EDGE), H - EDGE - h);
      var tap = (top + bottom) / 2;
      if (t < tap + GAP && t + h > tap - GAP) {
        var over = tap - GAP - h; // ending above the tap
        var under = tap + GAP; // starting below it
        if (over >= EDGE) t = over;
        else if (under + h <= H - EDGE) t = under;
        // Neither fits the screen: the tap point wins, on the side with more of the question shown.
        else t = tap > H / 2 ? over : under;
      }
    }
    box.style.top = Math.round(t) + 'px';
  }

  /* ── The page full size, fitted ────────────────────────────── */

  /* The picture as tall as the room between where it starts (the page
     scrolled to its top, as it is when the page opens) and the tab bar, less
     the way between pages under it: measured, at this width, Text Size and
     font. opts.scrollRoot: the box the page scrolls in, when it is not the
     window (the preview's device). */
  function fitViewer(root, opts) {
    var img = root && root.querySelector ? root.querySelector('.sp-bulletin-viewer-img') : null;
    if (!img || typeof window === 'undefined') return;
    var fig = img.parentElement;
    if (!fig || !fig.getBoundingClientRect || !fig.offsetWidth) return;
    var box = opts && opts.scrollRoot;
    var frame = box ? box.getBoundingClientRect() : { top: 0, bottom: window.innerHeight || 0 };
    var scrolled = box ? box.scrollTop : window.scrollY || window.pageYOffset || 0;
    var fr = fig.getBoundingClientRect();
    // The zoom the page is drawn at (Text Size): screen pixels per CSS pixel of the picture.
    var z = fr.width / fig.offsetWidth || 1;
    var floor = frame.bottom;
    var tabs = root.querySelector('.sp-tabs-bottom');
    var tr = tabs && tabs.getBoundingClientRect ? tabs.getBoundingClientRect() : null;
    if (tr && tr.height && tr.top > frame.top + (frame.bottom - frame.top) / 2) floor = Math.min(floor, tr.top);
    var bar = root.querySelector('.sp-bulletin-viewer-bar');
    var under = bar ? bar.getBoundingClientRect().height + 10 * z : 0;
    var start = fr.top + scrolled;
    var room = floor - 8 * z - under - start;
    img.style.maxHeight = Math.max(80, Math.floor(room / z)) + 'px';
  }

  /* ── The tab bar with Bulletins in it ──────────────────────── */

  /* How wide a label's longest word is, in ems, in the widest face it may be
     drawn in (Verdana or DejaVu Sans, bold when its tab is on): 0.69 em a
     letter, "Assignments" 7.6 em (s/page-view.css measured 7.3 and kept 7.6). */
  var EM_A_LETTER = 0.69;
  function wordEms(label) {
    var longest = 0;
    String(label || '')
      .split(/\s+/)
      .forEach(function (w) {
        longest = Math.max(longest, w.length);
      });
    return Math.max(1, longest) * EM_A_LETTER;
  }

  /* Sizes the bottom bar that has Bulletins in it, from the bar as drawn.
     The tabs are equal, so the icons are evenly spaced (Colin, Nov 24 2026:
     they sat off-centre when each tab was as wide as its label's longest
     word). Each label is as wide as its longest word and centred under its
     icon; it may reach past its tab into a neighbour's room, never into the
     neighbour's label or off the bar. One label size for all, the largest
     that keeps every two neighbours apart (2 px each side of every tab, on
     the screen) and the end labels on the bar, 12 px at most. Counts the
     tabs that are there (three, four, five), and measures the bar's own
     width and zoom, so it holds in the student's page and in the preview's
     phone frame at every Text Size. A bar without Bulletins is left as
     s/page-view.css draws it. */
  function fitTabs(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('.sp-tabs-bottom'), function (bar) {
      if (!bar.querySelector(':scope > .sp-tab[data-tab="bulletins"]')) return;
      var tabs = Array.prototype.slice.call(bar.querySelectorAll(':scope > .sp-tab'));
      var r = bar.getBoundingClientRect();
      var icon = bar.querySelector('.sp-tab-icon');
      var ir = icon ? icon.getBoundingClientRect() : null;
      if (!r.width || !ir || !ir.width || !tabs.length) return;
      // Screen pixels per CSS pixel: the icon is drawn 22 CSS px wide.
      var z = ir.width / 22;
      var ems = tabs.map(function (t) {
        var l = t.querySelector('.sp-tab-label');
        return wordEms(l ? l.textContent : '');
      });
      // A tab's width less 2 px a side on the screen, in the page's pixels:
      // the room an end label has, and two neighbours share.
      var room = r.width / z / tabs.length - 4 / z;
      var font = Math.min(12, room / ems[0], room / ems[ems.length - 1]);
      for (var k = 0; k + 1 < ems.length; k++) font = Math.min(font, (2 * room) / (ems[k] + ems[k + 1]));
      bar.classList.add('sp-bulletin-tabs');
      bar.style.setProperty('--sp-bulletin-tab-font', font + 'px');
      bar.style.setProperty('--sp-bulletin-tab-pad', 2 / z + 'px');
      var widths = ems.map(function (e) {
        return e * font;
      });
      tabs.forEach(function (t, i) {
        t.style.flexGrow = '';
        var l = t.querySelector('.sp-tab-label');
        if (l) l.style.width = widths[i] + 'px';
      });
      // A label of two words ("My Learning") stays on one line where it
      // fits whole, as drawn, beside its neighbours and on the bar.
      tabs.forEach(function (t, i) {
        var l = t.querySelector('.sp-tab-label');
        if (!l || !/\s/.test(l.textContent.trim())) return;
        l.style.width = 'max-content';
        var whole = Math.ceil(l.getBoundingClientRect().width / z) + 1;
        var fits =
          whole <= (i === 0 || i === tabs.length - 1 ? room : 2 * room) &&
          (i === 0 || (whole + widths[i - 1]) / 2 <= room) &&
          (i === tabs.length - 1 || (whole + widths[i + 1]) / 2 <= room);
        if (fits) widths[i] = Math.max(widths[i], whole);
        l.style.width = widths[i] + 'px';
      });
    });
  }

  return {
    body: body,
    fitTabs: fitTabs,
    wordEms: wordEms,
    placeAsk: placeAsk,
    fitViewer: fitViewer,
    press: press,
    attach: attach,
    count: count,
    put: put,
    linkOf: linkOf,
    dayHeading: dayHeading,
    timeOf: timeOf,
    kindLabel: kindLabel,
    WORDS: WORDS,
    PAGE_URL: PAGE_URL,
  };
})();
