// @ts-check
/* The handout's pages on a card still to do, to swipe through like a post
   (Colin, 2026-11-17: "As students scroll the missing assignments on their
   app, it should look like Instagram — the assignment images they can
   scroll and swipe to see multiple pages").

   A card that is due or Missing (page-view.js's "to do") and has a handout
   shows the handout's pages in the card, one page wide, at the page's own
   shape (letter until the first page arrives), no taller than 70% of the
   screen. More than one page: a sideways swipe moves between them (CSS
   scroll-snap: the browser's own scrolling, nothing animated here), dots
   under the picture and "1 / 2" on it; with a mouse or a trackpad, Previous
   Page and Next Page on the picture, and the Left and Right arrow keys while
   the pages have the keyboard. More than one handout: their pages follow one
   another, in the handouts' order, and the name under the picture is the
   name of the handout showing. A tap opens the page full size in the
   handout's own pane (data-act="handout", data-page; page-view.js press).

   Two halves. html(p) is pure: the markup for a piece, from the view alone,
   every name through esc (shared/html.js). attach(root, source) is the
   page's: once the page is drawn it watches each carousel, and asks
   `source` for a page's picture only when it is wanted:
     - a carousel within NEAR of the screen: the page it shows;
     - a carousel on screen, or swiped: the page after it too.
   source: { known(rid, i) -> an address already on this device, or '';
             load(piece, rid, i) -> Promise of an address, or '' }.
   The student page's source is s/handouts.js (one handout-links call per
   handout, its 60-second links asked again when they have run out); the
   teacher's Preview as Student's is teacher/preview-student.js. A picture
   that has not come shows a plain grey box, the same size. Nothing here
   reaches the network itself, and nothing is said when a page does not
   come. */
var StudentPageCarousel = (function () {
  'use strict';

  var SEP = ' · ';
  // How far below (or above) the screen a carousel starts fetching its first page.
  var NEAR = '200px 0px';
  // The only addresses a page is drawn from: this device's own copies, or Demo Mode's pictures.
  var PAGE_URL = /^(blob:|(\.\.)?\/assets\/sample-handouts\/)[^"'<>\s]*$/;

  var ARROW =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';

  /* ── The pure half ─────────────────────────────────────────── */

  function isTodo(p) {
    return !!p && (p.kind === 'due' || p.kind === 'missing');
  }

  // A piece's handouts in order: [ { rid, title, pages } ], 1 to 20 pages each.
  function handoutsOf(p) {
    return (p && Array.isArray(p.resources) ? p.resources : []).filter(function (r) {
      var n = r && Number(r.pages);
      return !!r && r.kind === 'handout' && typeof r.id === 'string' && !!r.id && n >= 1 && n <= 20 && n % 1 === 0;
    });
  }

  /* Every page of every handout on the piece, in order: [ { rid, title,
     page (from 0, within its handout), of (its handout's pages), at (from 0,
     in the carousel) } ]. */
  function slidesOf(p) {
    var out = [];
    handoutsOf(p).forEach(function (r) {
      var n = Number(r.pages);
      for (var k = 0; k < n; k++) {
        out.push({ rid: r.id, title: r.title || 'Handout', page: k, of: n, at: out.length });
      }
    });
    return out;
  }

  // Does this piece's card show its pages? A card still to do, with a handout.
  function shows(p) {
    return isTodo(p) && handoutsOf(p).length > 0;
  }

  // i kept to 0 … n − 1.
  function clamp(i, n) {
    var x = Math.floor(Number(i) || 0);
    return n > 0 ? Math.max(0, Math.min(n - 1, x)) : 0;
  }

  // The page a track scrolled to `left` of a page `width` wide is showing.
  function indexAt(left, width, n) {
    return width > 0 ? clamp(Math.round((Number(left) || 0) / width), n) : 0;
  }

  // "1 / 2" on the picture.
  function countText(i, n) {
    return clamp(i, n) + 1 + ' / ' + n;
  }

  /* The pages to fetch for a carousel showing page i of n: that page, and
     the next when the student is looking at it (on screen, or swiping). */
  function wanted(i, n, looking) {
    var at = clamp(i, n);
    if (!n) return [];
    return looking && at + 1 < n ? [at, at + 1] : [at];
  }

  // A page's shape as CSS aspect-ratio (its width / its height), kept between 1 / 2 and 2 / 1; '' when unknown.
  function ratioOf(w, h) {
    var x = Number(w);
    var y = Number(h);
    if (!(x > 0) || !(y > 0)) return '';
    if (x > 2 * y) return '2 / 1';
    if (y > 2 * x) return '1 / 2';
    return x + ' / ' + y;
  }

  // What the slide's button is called: which page of what, and that it opens full size.
  function slideName(s) {
    return s.title + ', page ' + (s.page + 1) + ' of ' + s.of + '. Open full size';
  }

  function slideHtml(p, s) {
    return (
      '<button type="button" class="sp-car-slide" data-act="handout" data-piece="' +
      esc(p.id) +
      '" data-resource="' +
      esc(s.rid) +
      '" data-page="' +
      s.page +
      '" data-at="' +
      s.at +
      '" data-name="' +
      esc(s.title) +
      '" aria-label="' +
      esc(slideName(s)) +
      '"></button>'
    );
  }

  /* The carousel of piece `p`, or '' when its card does not show one. The
     pictures are not in it: attach() puts each in when it is here. */
  function html(p) {
    if (!shows(p)) return '';
    var slides = slidesOf(p);
    var n = slides.length;
    var many = n > 1;
    var handouts = handoutsOf(p);
    var name =
      handouts.length === 1
        ? handouts[0].title + SEP + (n === 1 ? '1 page' : n + ' pages')
        : handouts.length + ' handouts' + SEP + n + ' pages';
    var dots = '';
    for (var k = 0; many && k < n; k++) dots += '<span class="sp-car-dot' + (k ? '' : ' sp-car-dot-on') + '"></span>';
    return (
      '<section class="sp-car" data-car="' +
      esc(p.id) +
      '" aria-label="' +
      esc('Pages for ' + p.title) +
      '"><div class="sp-car-frame"><div class="sp-car-track" tabindex="0" role="group" aria-roledescription="carousel" aria-label="' +
      esc(name) +
      '">' +
      slides
        .map(function (s) {
          return slideHtml(p, s);
        })
        .join('') +
      '</div>' +
      (many
        ? '<span class="sp-car-count" aria-hidden="true">' +
          countText(0, n) +
          '</span>' +
          '<button type="button" class="sp-car-arrow sp-car-prev" data-car-go="-1" aria-label="Previous Page" hidden>' +
          ARROW +
          '</button><button type="button" class="sp-car-arrow sp-car-next" data-car-go="1" aria-label="Next Page">' +
          ARROW +
          '</button>'
        : '') +
      '</div>' +
      (many ? '<div class="sp-car-dots" aria-hidden="true">' + dots + '</div>' : '') +
      '<p class="sp-car-caption">' +
      esc(slides[0].title) +
      '</p></section>'
    );
  }

  /* ── The page's half ───────────────────────────────────────── */

  var at = {}; // piece id → the page its carousel shows, kept across a redraw
  var ratios = {}; // piece id → its first page's shape, so a redraw keeps it
  var wired = new WeakMap(); // a carousel on the page → { near, look }: what to fetch as it comes near, or into view
  var watching = new WeakMap(); // a page drawn → its two observers

  function reduceMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function slidesIn(el) {
    return Array.prototype.slice.call(el.querySelectorAll('.sp-car-slide'));
  }

  // The picture into its slide, once; a picture that fails is asked for again once, quietly.
  function put(el, slide, url, source) {
    if (!url || !PAGE_URL.test(url) || !slide.isConnected) return;
    var img = slide.querySelector('img');
    if (img && img.getAttribute('src') === url) return;
    if (!img) {
      img = document.createElement('img');
      img.className = 'sp-car-img';
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      img.addEventListener('load', function () {
        slide.classList.add('sp-car-in');
        if (slide.getAttribute('data-at') !== '0') return;
        var r = ratioOf(img.naturalWidth, img.naturalHeight);
        var pid = el.getAttribute('data-car') || '';
        if (!r || ratios[pid] === r) return;
        ratios[pid] = r;
        var track = el.querySelector('.sp-car-track');
        if (track) track.style.setProperty('--sp-car-ratio', r);
      });
      img.addEventListener('error', function () {
        if (img.getAttribute('data-again')) return img.remove();
        img.setAttribute('data-again', '1');
        var rid = slide.getAttribute('data-resource');
        var page = Number(slide.getAttribute('data-page'));
        Promise.resolve(source.load(el.getAttribute('data-car'), rid, page, true)).then(function (again) {
          if (again && PAGE_URL.test(again) && again !== img.getAttribute('src')) img.src = again;
          else img.remove();
        });
      });
      slide.appendChild(img);
    }
    img.src = url;
  }

  function fetchPage(el, i, source) {
    var slide = slidesIn(el)[i];
    if (!slide || slide.querySelector('img')) return;
    var rid = slide.getAttribute('data-resource');
    var page = Number(slide.getAttribute('data-page'));
    var known = source.known(rid, page);
    if (known) return put(el, slide, known, source);
    Promise.resolve(source.load(el.getAttribute('data-car'), rid, page, false)).then(
      function (url) {
        put(el, slide, url, source);
      },
      function () {
        /* stays grey */
      },
    );
  }

  // Dots, count, name and arrows for page i.
  function mark(el, i) {
    var slides = slidesIn(el);
    var n = slides.length;
    var dots = el.querySelectorAll('.sp-car-dot');
    for (var k = 0; k < dots.length; k++) dots[k].classList.toggle('sp-car-dot-on', k === i);
    var count = el.querySelector('.sp-car-count');
    if (count) count.textContent = countText(i, n);
    var cap = el.querySelector('.sp-car-caption');
    var s = slides[i];
    if (cap && s) {
      var title = s.getAttribute('data-name') || '';
      if (cap.textContent !== title) cap.textContent = title;
    }
    var prev = el.querySelector('.sp-car-prev');
    var next = el.querySelector('.sp-car-next');
    var had = document.activeElement;
    if (prev) prev.hidden = i <= 0;
    if (next) next.hidden = i >= n - 1;
    // An arrow that went away had the keyboard: the pages keep it.
    if ((had === prev && prev.hidden) || (had === next && next.hidden)) {
      var track = el.querySelector('.sp-car-track');
      if (track) track.focus({ preventScroll: true });
    }
  }

  function wire(el, source) {
    var track = el.querySelector('.sp-car-track');
    if (!track || wired.has(el)) return;
    var pid = el.getAttribute('data-car') || '';
    var n = slidesIn(el).length;
    var cur = clamp(at[pid], n);
    if (ratios[pid]) track.style.setProperty('--sp-car-ratio', ratios[pid]);
    // A redraw keeps the page the student was on.
    if (cur && track.clientWidth) track.scrollLeft = cur * track.clientWidth;
    mark(el, cur);
    var me = {
      near: function () {
        wanted(cur, n, false).forEach(function (i) {
          fetchPage(el, i, source);
        });
      },
      look: function () {
        wanted(cur, n, true).forEach(function (i) {
          fetchPage(el, i, source);
        });
      },
    };
    wired.set(el, me);
    /* The count, dots and name follow the strip on every scroll, as it
       moves: a swipe, a fling, the arrows, the keys, scroll-snap settling,
       Reduce Motion's jump. Nothing waits for an animation frame or for the
       scroll to end, and a page between two (snap not landed yet) counts as
       the one more than half in view. */
    function follow() {
      var i = indexAt(track.scrollLeft, track.clientWidth, n);
      if (i !== cur) {
        cur = i;
        at[pid] = i;
        mark(el, i);
      }
      me.look();
    }
    track.addEventListener('scroll', follow, { passive: true });
    track.addEventListener('scrollend', follow, { passive: true });
    function go(d) {
      var to = clamp(cur + d, n);
      if (to === cur) return;
      fetchPage(el, to, source);
      track.scrollTo({ left: to * track.clientWidth, behavior: reduceMotion() ? 'auto' : 'smooth' });
    }
    el.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-car-go]') : null;
      if (!b || !el.contains(b)) return;
      e.preventDefault();
      go(Number(b.getAttribute('data-car-go')) || 0);
    });
    track.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      go(e.key === 'ArrowLeft' ? -1 : 1);
    });
  }

  /* After the page is drawn into `root`: each carousel in it is wired and
     watched. opts.scrollRoot: the box the page scrolls in, when it is not
     the window (the preview's device). */
  function attach(root, source, opts) {
    if (!root || !root.querySelectorAll || !source) return;
    var els = Array.prototype.slice.call(root.querySelectorAll('.sp-car'));
    var was = watching.get(root);
    if (was)
      was.forEach(function (o) {
        o.disconnect();
      });
    watching.delete(root);
    if (!els.length) return;
    els.forEach(function (el) {
      wire(el, source);
    });
    if (typeof IntersectionObserver !== 'function') {
      els.forEach(function (el) {
        var w = wired.get(el);
        if (w) w.near();
      });
      return;
    }
    var box = (opts && opts.scrollRoot) || null;
    var near = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          var w = e.isIntersecting && wired.get(e.target);
          if (w) w.near();
        });
      },
      { root: box, rootMargin: NEAR },
    );
    var seen = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          var w = e.isIntersecting && wired.get(e.target);
          if (w) w.look();
        });
      },
      { root: box, threshold: 0.5 },
    );
    els.forEach(function (el) {
      near.observe(el);
      seen.observe(el);
    });
    watching.set(root, [near, seen]);
  }

  return {
    html: html,
    attach: attach,
    shows: shows,
    slidesOf: slidesOf,
    clamp: clamp,
    indexAt: indexAt,
    countText: countText,
    wanted: wanted,
    ratioOf: ratioOf,
  };
})();
