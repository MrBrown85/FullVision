// @ts-check
/* tab-bulletins.js — Bulletins on the phone (docs/plans/bulletins-plan.md,
   slice B1f; boards T1 to T4).

   The fourth tab, last in the bar, only while the build flag `bulletins` is
   on (teacher-mobile/tab-bar.js). Bulletins is a one-way class feed: the
   teacher posts, students read, the teacher sees who has seen each one.

   T1 the feed: Post a Photo (the main use) and Write a Bulletin, then the
     class's bulletins with Seen By. Read when the tab shows, then every 15
     seconds while it shows and the page is visible; pull to refresh.
   T2 who has seen it, a sheet, with Show It Again on the phones that have
     not.
   T3 Post a Photo: Add Work's camera screen as it is (its overlay, its round
     shutter, MAddWork.shutterHtml), the photo made smaller and its location
     removed by PhotoShrink.prepare, a caption, the reminder to check for
     faces, Retake and Post.
   T4 Write a Bulletin, a sheet: Announcement or Reminder, words, Stays Pinned
     Until and Linked To for a reminder, a link, a photo or a PDF, Let
     Students React.

   Every read and write is shared/data-bulletins.js's, the desktop page's own
   functions. A post with a photo or a file waits in the photo queue
   ({ queue: true }), so Post works with no connection; a bulletin waiting
   shows in the feed as Not Sent Yet, and any trouble only on the sync dot.
   In Demo Mode everything stays on the device. */
window.MBulletins = (function () {
  'use strict';

  /** @type {any} */
  var W = window;
  var MC = W.MComponents;
  var REFRESH_MS = 15000;
  var MAX_PAGES = 20;
  var MAX_WORDS = 2000;

  var CAMERA_SVG =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.5"/><path d="M9 6l1.5-2h3L15 6"/></svg>';

  var _cid = ''; // the class on screen, while the tab shows
  var _drawnHead = ''; // what the head shows now, so a read that changed nothing draws nothing
  var _timer = 0;
  var _bound = false;
  var _booted = false;
  /** @type {Record<string, any>} */
  var _drafts = {}; // cid → Write a Bulletin's words, kept while the app is open
  /** @type {{ url: string, release: () => void }[]} */
  var _pictures = []; // the waiting bulletins' photos from the device, let go when the tab is left
  /** @type {any} */
  var _cam = null; // Post a Photo, while it is open
  /** @type {any} */
  var _seen = null; // the Seen sheet, while it is open
  /** @type {any} */
  var _prepare = null; // tests pass their own PhotoShrink.prepare

  /** @param {{ prepare?: any }} opts */
  function configure(opts) {
    if (opts && 'prepare' in opts) _prepare = typeof opts.prepare === 'function' ? opts.prepare : null;
  }

  function on() {
    return !!(W.BuildFlags && typeof W.BuildFlags.on === 'function' && W.BuildFlags.on('bulletins'));
  }

  /* The model: pure, in teacher-mobile/bulletins-model.js (loaded first). */
  var MM = W.MBulletinsModel;
  var dayText = MM.dayText;
  var timeText = MM.timeText;
  var kindLabel = MM.kindLabel;
  var seenLine = MM.seenLine;
  var pausedText = MM.pausedText;
  var noCardText = MM.noCardText;
  var feedModel = MM.feedModel;

  /* ── Small helpers ──────────────────────────────────────────── */

  /** @param {string} s */
  function esc(s) {
    return MC.esc(s);
  }

  function _isDemo() {
    return typeof W.isDemoMode === 'function' && !!W.isDemoMode();
  }

  /** @param {string} cid */
  function _className(cid) {
    var c = typeof COURSES !== 'undefined' && COURSES && COURSES[cid];
    return c && c.name ? String(c.name) : 'your class';
  }

  /** @param {string} cid @param {string} id */
  function _student(cid, id) {
    var list = (typeof W.getStudents === 'function' && W.getStudents(cid)) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** @param {string} cid @param {string} id */
  function _name(cid, id) {
    var st = _student(cid, id);
    return st ? W.displayName(st) : 'A student';
  }

  /** @param {string} cid */
  function _offered(cid) {
    if (_isDemo()) return true;
    if (W.bulletinsOffered(cid)) return true;
    // Read before and could not reach the server: Post still works (it waits on the phone).
    return W.bulletinsState(cid) === 'failed';
  }

  /** @param {string} cid @param {string} id */
  function _bulletinOf(cid, id) {
    return (
      W.getBulletins(cid).filter(function (/** @type {any} */ x) {
        return x.id === id;
      })[0] || null
    );
  }

  /* ── T1: the feed ───────────────────────────────────────────── */

  /** The tab's first screen. html-safe: every word, name and title goes through esc; the rest is fixed markup. @param {string} cid */
  function render(cid) {
    _cid = cid;
    _drawnHead = _headHtml(cid);
    var nav = MC.navBar({
      id: 'bulletins',
      title: 'Bulletins',
      classId: cid,
      rightHTML:
        '<div class="m-sync" role="status"><div class="tb-sync-dot idle" id="sync-indicator-dot" title="All changes saved" aria-label="All changes saved"></div></div>' +
        '<button class="m-nav-bar-action" data-action="m-settings" title="Settings">' +
        MC.ICONS.settings +
        '</button>',
    });
    return (
      '<div class="m-screen" id="m-screen-bulletins">' +
      nav +
      '<div class="m-screen-content m-bulletin-content">' +
      '<div class="m-title-large">Bulletins</div>' +
      '<div id="m-bulletin-head">' +
      _drawnHead +
      '</div>' +
      // The cards are drawn by shown() (_drawFeed), so each is known and updated in place.
      '<div id="m-bulletin-feed" class="m-bulletin-feed" aria-live="polite"></div>' +
      '</div></div>'
    );
  }

  /** @param {string} cid */
  function _headHtml(cid) {
    var state = _isDemo() ? 'ok' : W.bulletinsState(cid);
    if (state === 'missing') return '<p class="m-bulletin-note">Bulletins are not ready for this class yet.</p>';
    if (!_offered(cid)) return '<p class="m-bulletin-note">Loading Bulletins…</p>';
    var meta = W.getBulletinsMeta(cid);
    var note = meta.page_on
      ? ''
      : '<p class="m-bulletin-note">Students cannot see Bulletins until the Student Page is turned on in Class Settings.</p>';
    return (
      '<div class="m-bulletin-actions">' +
      '<button type="button" class="m-bulletin-btn m-bulletin-btn-main" data-m-bulletin="photo">' +
      CAMERA_SVG +
      '<span>Post a Photo</span></button>' +
      '<button type="button" class="m-bulletin-btn" data-m-bulletin="write">Write a Bulletin</button>' +
      '</div>' +
      note
    );
  }

  /**
   * A card's parts, each drawn on its own, so a changed Seen count changes
   * that line only and a photo already shown is never fetched again.
   * html-safe: every word, title and name goes through esc; the rest is fixed markup.
   * @param {any} c @returns {Record<string, string>}
   */
  function _cardParts(c) {
    var seen = c.seen.waiting
      ? '<div class="m-bulletin-seen-row"><span class="m-bulletin-seen is-waiting">Not Sent Yet</span>' +
        (c.key && W.bulletinCanTakeBack(_cid, c.key)
          ? '<button type="button" class="m-bulletin-text-btn" data-m-bulletin="take-back" data-key="' +
            esc(c.key) +
            '">Take It Back</button>'
          : '') +
        '</div>'
      : '<button type="button" class="m-bulletin-seen" data-m-bulletin="seen" data-id="' +
        esc(c.id) +
        '">' +
        esc(c.seen.main) +
        (c.seen.rest ? ' · <span class="m-bulletin-not-seen">' + esc(c.seen.rest) + '</span>' : '') +
        '</button>';
    return {
      head:
        '<div class="m-bulletin-card-head"><span class="m-bulletin-kind' +
        (c.reminder ? ' is-reminder' : '') +
        '">' +
        esc(c.kind) +
        '</span><span class="m-bulletin-time' +
        (c.fresh ? ' is-fresh' : '') +
        '">' +
        esc(c.time) +
        '</span></div>',
      words: c.body ? '<div class="m-bulletin-words">' + esc(c.body) + '</div>' : '',
      photo: c.photo
        ? '<div class="m-bulletin-photo"><img alt="' +
          esc(c.kind === 'Photo of the Board' ? 'Photo of the board' : 'Photo') +
          '" data-m-bulletin-img="' +
          esc(c.id) +
          '" data-file="' +
          esc(c.photo.id) +
          '" data-key="' +
          esc(c.key) +
          '"></div>'
        : '',
      files: c.pdfs
        .map(function (/** @type {any} */ f) {
          return (
            '<div class="m-bulletin-file-line">PDF · ' +
            esc(f.title) +
            ' · ' +
            esc(f.pages + (f.pages === 1 ? ' Page' : ' Pages')) +
            '</div>'
          );
        })
        .join(''),
      link: c.link
        ? '<div class="m-bulletin-link"><span class="m-bulletin-link-title">' +
          esc(c.link.title) +
          '</span><span class="m-bulletin-link-host">' +
          esc(c.link.host) +
          '</span></div>'
        : '',
      seen: _notes[c.id] ? seen + '<p class="m-bulletin-note-line" role="status">' + esc(_notes[c.id]) + '</p>' : seen,
    };
  }

  var PARTS = ['head', 'words', 'photo', 'files', 'link', 'seen'];

  /** html-safe: the parts are _cardParts', escaped there. @param {any} c @param {Record<string, string>} parts */
  function _cardHtml(c, parts) {
    return (
      '<article class="m-bulletin-card' +
      (c.waiting ? ' is-waiting' : '') +
      '" data-id="' +
      esc(c.id) +
      '">' +
      PARTS.map(function (k) {
        return '<div class="m-bulletin-part" data-part="' + k + '">' + parts[k] + '</div>';
      }).join('') +
      '</article>'
    );
  }

  /** @type {IntersectionObserver | null} */
  var _io = null;
  /** @type {WeakMap<Element, Record<string, string>>} */
  var _drawn = new WeakMap(); // card → the parts it shows

  function _releasePictures() {
    if (_io) _io.disconnect();
    _io = null;
    _pictures.forEach(function (p) {
      try {
        p.release();
      } catch (e) {
        /* already let go */
      }
    });
    _pictures = [];
    // The server's pictures, held as blob: addresses (shared/data-bulletins.js), and the device's.
    if (typeof W.releaseBulletinPictures === 'function') W.releaseBulletinPictures();
    if (typeof W.releaseBulletinWaitingPictures === 'function') W.releaseBulletinWaitingPictures();
  }

  /** One card's photo: from the device for one waiting, else from the server (or the device in Demo Mode). @param {HTMLImageElement} img */
  function _loadPicture(img) {
    var cid = _cid;
    var id = img.getAttribute('data-m-bulletin-img') || '';
    var b = W.getBulletins(cid).filter(function (/** @type {any} */ x) {
      return x.id === id;
    })[0];
    if (!b || img.getAttribute('data-asked')) return;
    img.setAttribute('data-asked', '1');
    var ask;
    if (b.waiting && b.key) ask = W.getBulletinWaitingPicture(b.key);
    else {
      var f = (b.files || []).filter(function (/** @type {any} */ x) {
        return x.id === img.getAttribute('data-file');
      })[0];
      ask = f ? W.getBulletinPage(cid, f, 0) : Promise.resolve(null);
    }
    Promise.resolve(ask).then(function (/** @type {any} */ pic) {
      if (!pic || cid !== _cid || !img.isConnected) return;
      img.src = pic.url;
      _pictures.push(pic);
    });
  }

  /** Photos are fetched as they come near the screen. */
  function _watchPictures() {
    var imgs = /** @type {HTMLImageElement[]} */ (
      Array.prototype.slice.call(
        document.querySelectorAll('#m-bulletin-feed img[data-m-bulletin-img]:not([data-asked])'),
      )
    );
    if (typeof IntersectionObserver !== 'function') return imgs.forEach(_loadPicture);
    if (!_io) {
      _io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting) return;
            if (_io) _io.unobserve(en.target);
            _loadPicture(/** @type {HTMLImageElement} */ (en.target));
          });
        },
        { rootMargin: '400px 0px' },
      );
    }
    imgs.forEach(function (img) {
      if (_io) _io.observe(img);
    });
  }

  function _motionOk() {
    return !(typeof W.matchMedia === 'function' && W.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /**
   * The feed drawn again in place: a card that did not change is left as it
   * is, a changed one changes only its changed parts, and cards that moved
   * glide to their new places (FLIP, 200 ms); a new one glides in. Nothing
   * fades, and nothing moves under Reduce Motion.
   */
  function _drawFeed() {
    if (!_cid) return;
    var head = document.getElementById('m-bulletin-head');
    var found = document.getElementById('m-bulletin-feed');
    if (!found) return;
    /** @type {HTMLElement} */
    var feed = found;
    var headHtml = _headHtml(_cid);
    // html-safe: _headHtml is fixed markup and one fixed sentence.
    if (head && _drawnHead !== headHtml) {
      head.innerHTML = headHtml;
      _drawnHead = headHtml;
    }
    var cards = _offered(_cid) ? feedModel(W.getBulletins(_cid)) : [];
    _adoptDeleteRefusals(
      cards.map(function (c) {
        return c.id;
      }),
    );
    if (!cards.length) {
      var none = _offered(_cid) ? '<p class="m-bulletin-empty">Nothing Posted Yet</p>' : '';
      // html-safe: fixed markup.
      if (feed.innerHTML !== none) feed.innerHTML = none;
      return;
    }
    var empty = feed.querySelector('.m-bulletin-empty');
    if (empty) empty.remove();
    /** @type {Record<string, HTMLElement>} */
    var had = {};
    /** @type {Record<string, number>} */
    var was = {};
    Array.prototype.forEach.call(
      feed.querySelectorAll(':scope > .m-bulletin-card'),
      function (/** @type {HTMLElement} */ n) {
        had[n.getAttribute('data-id') || ''] = n;
        was[n.getAttribute('data-id') || ''] = n.getBoundingClientRect().top;
      },
    );
    var motion = _motionOk();
    /** @type {HTMLElement[]} */
    var fresh = [];
    cards.forEach(function (c) {
      var parts = _cardParts(c);
      var node = had[c.id];
      if (!node) {
        var tmp = document.createElement('div');
        // html-safe: _cardHtml's parts are escaped in _cardParts.
        tmp.innerHTML = _cardHtml(c, parts);
        node = /** @type {HTMLElement} */ (tmp.firstElementChild);
        fresh.push(node);
      } else {
        delete had[c.id];
        node.classList.toggle('is-waiting', !!c.waiting);
        var before = _drawn.get(node) || {};
        PARTS.forEach(function (k) {
          var part = /** @type {HTMLElement | null} */ (node && node.querySelector('[data-part="' + k + '"]'));
          // html-safe: one part from _cardParts, escaped there.
          if (part && before[k] !== parts[k]) part.innerHTML = parts[k];
        });
      }
      _drawn.set(node, parts);
      feed.appendChild(node); // in order: a node already there moves, it is not drawn again
    });
    Object.keys(had).forEach(function (id) {
      had[id].remove();
    });
    if (motion) {
      Array.prototype.forEach.call(
        feed.querySelectorAll(':scope > .m-bulletin-card'),
        function (/** @type {HTMLElement} */ n) {
          var id = n.getAttribute('data-id') || '';
          var from = id in was ? was[id] - n.getBoundingClientRect().top : fresh.indexOf(n) >= 0 ? -12 : 0;
          if (!from) return;
          n.style.transition = 'none';
          n.style.transform = 'translateY(' + from + 'px)';
          requestAnimationFrame(function () {
            n.style.transition = 'transform 200ms ease-out';
            n.style.transform = '';
          });
        },
      );
    }
    _watchPictures();
  }

  /** Read the class again; the feed draws when it changes. @param {boolean} [force] */
  function refresh(force) {
    var cid = _cid;
    if (!cid) return Promise.resolve(false);
    return W.refreshBulletins(cid, {
      force: force !== false,
      stillShown: function () {
        return cid === _cid;
      },
    });
  }

  function _startTimer() {
    _stopTimer();
    if (!_cid || document.visibilityState === 'hidden') return;
    _timer = W.setInterval(function () {
      if (_cid && document.visibilityState !== 'hidden') refresh(true);
    }, REFRESH_MS);
  }

  function _stopTimer() {
    if (_timer) W.clearInterval(_timer);
    _timer = 0;
  }

  function _onVisibility() {
    if (!_cid) return;
    if (document.visibilityState === 'hidden') _stopTimer();
    else {
      refresh(true);
      _startTimer();
    }
  }

  /** @param {any} e */
  function _onChanged(e) {
    var cid = e && e.detail && e.detail.cid;
    if (!_cid || (cid && cid !== _cid)) return;
    _drawFeed();
    if (_seen && _seen.cid === _cid) _drawSeen();
  }

  /** The tab is on screen for class cid: read it now and every 15 seconds. @param {string} cid */
  function shown(cid) {
    _bind();
    _cid = cid;
    _drawFeed();
    refresh(true);
    _startTimer();
  }

  /** The tab is left: no more reads, every picture let go. */
  function left() {
    _stopTimer();
    _releasePictures();
    _cid = '';
    _drawnHead = '';
  }

  var _drawSeq = 0; // goes up with each tab draw, so a late shown() never follows a newer draw

  /**
   * The shell's one call (teacher-mobile/shell.js, _renderTab): whatever tab
   * is drawn, Bulletins stops reading while it is not showing; with the flag
   * on, the first draw takes up posts waiting on this phone; and the
   * Bulletins tab's screen is drawn here, then read when it is in the page.
   * @param {string} name @param {string} cid @param {string} html the shell's own screen for the other tabs
   */
  function tab(name, cid, html) {
    left();
    if (!on()) return html;
    boot();
    if (name !== 'bulletins') return html;
    var seq = ++_drawSeq;
    var out = render(cid);
    Promise.resolve().then(function () {
      if (seq === _drawSeq && document.getElementById('m-screen-bulletins')) shown(cid);
    });
    return out;
  }

  /** The app opened with the flag on: posts waiting on this phone go on. */
  function boot() {
    _bind();
    if (_booted) return;
    _booted = true;
    if (typeof W.resumeBulletinUploads === 'function') W.resumeBulletinUploads();
  }

  /* ── T2: who has seen it ────────────────────────────────────── */

  /** @param {string} id */
  function openSeen(id) {
    var cid = _cid;
    var b = _bulletinOf(cid, id);
    if (!b || b.waiting) return;
    _seen = { cid: cid, id: id, data: null, again: false, open: false };
    MC.presentSheet('<div class="m-bulletin-sheet" id="m-bulletin-seen-sheet"></div>', {
      onClose: function () {
        _seen = null;
      },
    });
    _drawSeen();
    W.getBulletinSeen(cid, id).then(function (/** @type {any} */ data) {
      if (!_seen || _seen.id !== id) return;
      _seen.data = data;
      _drawSeen();
    });
  }

  /** @param {string} cid @param {string[]} ids */
  function _cellsHtml(cid, ids) {
    return (
      '<div class="m-list m-bulletin-names">' +
      ids
        .map(function (id) {
          var st = _student(cid, id);
          var initials = st ? MC.avatarInitials(st) : '';
          return (
            '<div class="m-cell"><div class="m-cell-avatar" style="background:' +
            esc(MC.avatarColor(id)) +
            '">' +
            esc(initials) +
            '</div><div class="m-cell-body"><div class="m-cell-title">' +
            esc(_name(cid, id)) +
            '</div></div></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /** html-safe: names and words go through esc. */
  function _drawSeen() {
    var box = document.getElementById('m-bulletin-seen-sheet');
    if (!box || !_seen) return;
    var cid = _seen.cid;
    var b = _bulletinOf(cid, _seen.id);
    if (!b) return;
    var line = seenLine(b);
    var words = String(b.body || '').trim();
    var hint = words.length > 80 ? words.slice(0, 79) + '…' : words || kindLabel(b);
    var head =
      '<div class="m-bulletin-sheet-head"><h2 class="m-bulletin-sheet-title" id="m-bulletin-seen-title">' +
      esc(line.main) +
      '</h2><button type="button" class="m-bulletin-head-btn" data-m-bulletin="close">Done</button></div>' +
      '<p class="m-bulletin-hint">' +
      esc(hint) +
      '</p>';
    var d = _seen.data;
    var body;
    if (!d) body = '<p class="m-bulletin-hint">Loading…</p>';
    else if (!d.ok) body = '<p class="m-bulletin-hint">Who has seen it shows when the phone is back online.</p>';
    else {
      var paused = pausedText(
        d.paused.map(function (/** @type {string} */ id) {
          return _name(cid, id);
        }),
      );
      body =
        (d.not_seen.length
          ? '<h3 class="m-bulletin-sec">' +
            esc('Not Seen Yet · ' + d.not_seen.length) +
            '</h3>' +
            _cellsHtml(cid, d.not_seen) +
            '<button type="button" class="m-bulletin-btn m-bulletin-btn-wide" data-m-bulletin="again"' +
            (_seen.again ? ' disabled' : '') +
            '>' +
            esc(
              _seen.again
                ? 'Shown Again'
                : 'Show It Again on ' +
                    (d.not_seen.length === 1 ? 'This Phone' : 'These ' + d.not_seen.length + ' Phones'),
            ) +
            '</button>'
          : '<p class="m-bulletin-hint">Everyone who can see it has seen it.</p>') +
        (paused ? '<p class="m-bulletin-hint">' + esc(paused) + '</p>' : '') +
        (d.no_card.length ? '<p class="m-bulletin-hint">' + esc(noCardText(d.no_card.length)) + '</p>' : '') +
        (d.seen.length
          ? '<button type="button" class="m-bulletin-text-btn" data-m-bulletin="show-seen" aria-expanded="' +
            (_seen.open ? 'true' : 'false') +
            '">' +
            esc('Show Who Has Seen It (' + d.seen.length + ')') +
            '</button>' +
            (_seen.open ? _cellsHtml(cid, d.seen) : '')
          : '');
    }
    // A wrong photo can be removed from the phone that posted it.
    body +=
      '<button type="button" class="m-bulletin-text-btn m-bulletin-delete" data-m-bulletin="delete" data-id="' +
      esc(b.id) +
      '">Delete This Bulletin</button>';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-labelledby', 'm-bulletin-seen-title');
    // html-safe: head and body escape every word and name with esc; the rest is fixed markup.
    box.innerHTML = head + body;
  }

  function _showAgain() {
    if (!_seen || _seen.again) return;
    _seen.again = true;
    _drawSeen();
    W.showBulletinAgain(_seen.cid, _seen.id);
  }

  /* ── T3: Post a Photo ───────────────────────────────────────── */

  function openCamera() {
    if (!_cid) return;
    closeCamera();
    _cam = { cid: _cid, page: null, url: '', busy: false, msg: '', caption: '' };
    var root = document.createElement('div');
    root.id = 'm-bulletin-camera';
    root.className = 'm-addwork m-bulletin-camera';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'm-bulletin-camera-title');
    document.body.appendChild(root);
    root.addEventListener('click', _onCameraClick);
    root.addEventListener('change', _onCameraChange);
    document.addEventListener('keydown', _onCameraKey);
    _drawCamera();
    var shutter = /** @type {HTMLElement | null} */ (root.querySelector('.m-addwork-shutter'));
    if (shutter) shutter.focus();
  }

  function closeCamera() {
    var root = document.getElementById('m-bulletin-camera');
    if (root) root.remove();
    document.removeEventListener('keydown', _onCameraKey);
    if (_cam && _cam.url) URL.revokeObjectURL(_cam.url);
    _cam = null;
  }

  /** html-safe: the class name, the caption and messages go through esc; the picture is a blob: address made here. */
  function _drawCamera() {
    var root = document.getElementById('m-bulletin-camera');
    if (!root || !_cam) return;
    var where =
      '<p class="m-bulletin-where">' + esc('Posts to ' + _className(_cam.cid) + ': every student’s phone.') + '</p>';
    var top =
      '<div class="m-addwork-top"><button type="button" class="m-addwork-close" data-m-bulletin-cam="close">Done</button>' +
      '<div class="m-addwork-title" id="m-bulletin-camera-title">Post a Photo</div></div>';
    var msg = '<div class="m-addwork-msg" role="status">' + esc(_cam.msg) + '</div>';
    if (!_cam.page) {
      root.innerHTML =
        top +
        '<div class="m-addwork-view">' +
        '<div class="m-addwork-empty">' +
        esc(_cam.busy ? 'Getting the photo ready…' : 'Take a photo of the board.') +
        '</div>' +
        W.MAddWork.shutterHtml({ label: 'Take a photo', accept: 'image/*', multiple: false, busy: _cam.busy }) +
        '</div>' +
        msg +
        where;
      return;
    }
    // html-safe: the caption, the class name and the messages go through esc; the picture is a blob: address made here.
    root.innerHTML =
      top +
      '<div class="m-addwork-view m-bulletin-shot"><img class="m-bulletin-shot-img" alt="The photo to post" src="' +
      esc(_cam.url) +
      '"></div>' +
      '<label class="m-bulletin-cap-label" for="m-bulletin-caption">Caption</label>' +
      '<input type="text" class="m-bulletin-caption" id="m-bulletin-caption" maxlength="' +
      MAX_WORDS +
      '" placeholder="Add a line (optional)" value="' +
      esc(_cam.caption) +
      '">' +
      '<p class="m-bulletin-faces">Check the photo for students’ faces before you post.</p>' +
      where +
      msg +
      '<div class="m-bulletin-two">' +
      '<label class="m-addwork-choice m-bulletin-retake" tabindex="0">Retake' +
      '<input type="file" class="m-addwork-input" accept="image/*" capture="environment"' +
      (_cam.busy ? ' disabled' : '') +
      '></label>' +
      '<button type="button" class="m-addwork-save" data-m-bulletin-cam="post"' +
      (_cam.busy ? ' disabled' : '') +
      '>Post</button></div>';
  }

  /** @param {any} e */
  function _onCameraChange(e) {
    var input = e.target;
    if (!_cam || !input || !input.classList || !input.classList.contains('m-addwork-input')) return;
    var file = input.files && input.files[0];
    input.value = '';
    if (file && !_cam.busy) takePhoto(file);
  }

  /** What a refused photo says. @param {any} res */
  function _refusal(res) {
    var R = (W.PhotoShrink && W.PhotoShrink.REASONS) || {};
    if (res && res.kind === 'heic' && res.reason === R.NO_DECODER)
      return 'Take the photo here, or save it as a JPEG first.';
    return "That photo couldn't be used. Try another.";
  }

  /** The photo taken: made smaller, its location removed (PhotoShrink.prepare), and shown. @param {File | Blob} file */
  function takePhoto(file) {
    if (!_cam) return Promise.resolve();
    var cam = _cam;
    var prepare = _prepare || (W.PhotoShrink && W.PhotoShrink.prepare);
    if (typeof prepare !== 'function') {
      cam.msg = "Photos can't be added on this page.";
      _drawCamera();
      return Promise.resolve();
    }
    _readCaption();
    cam.busy = true;
    cam.msg = '';
    _drawCamera();
    return Promise.resolve()
      .then(function () {
        return prepare(file, { maxPages: 1 });
      })
      .then(null, function () {
        return { ok: false };
      })
      .then(function (/** @type {any} */ res) {
        if (_cam !== cam) return;
        cam.busy = false;
        var p = res && res.ok && res.pages && res.pages[0];
        if (!p || res.kind === 'pdf') {
          cam.msg = _refusal(res);
        } else {
          if (cam.url) URL.revokeObjectURL(cam.url);
          cam.page = p;
          // The whole page, as it will be posted: faces are checked on the real picture, not a small copy.
          cam.url = URL.createObjectURL(p.blob);
        }
        _drawCamera();
      });
  }

  function _readCaption() {
    var input = /** @type {HTMLInputElement | null} */ (document.getElementById('m-bulletin-caption'));
    if (input && _cam) _cam.caption = input.value;
  }

  function postPhoto() {
    if (!_cam || _cam.busy || !_cam.page) return Promise.resolve();
    _readCaption();
    var cam = _cam;
    cam.busy = true;
    cam.msg = '';
    _drawCamera();
    var draft = { kind: 'announcement', body: cam.caption, reactions_on: false };
    var files = [{ kind: 'photo', title: 'Photo of the Board', pages: [cam.page] }];
    return Promise.resolve(W.postBulletin(cam.cid, draft, files, { queue: true })).then(
      function (/** @type {any} */ out) {
        if (_cam !== cam) return out;
        if (out && out.ok) {
          closeCamera();
          _drawFeed();
          return out;
        }
        cam.busy = false;
        cam.msg = (out && out.message) || "The photo couldn't be posted. Try again.";
        _drawCamera();
        return out;
      },
    );
  }

  /** @param {any} e */
  function _onCameraClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-m-bulletin-cam]') : null;
    if (!btn || btn.disabled) return;
    var what = btn.getAttribute('data-m-bulletin-cam');
    if (what === 'close') closeCamera();
    else if (what === 'post') postPhoto();
  }

  /** @param {KeyboardEvent} e */
  function _onCameraKey(e) {
    if (!_cam) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCamera();
      return;
    }
    // The shutter and Retake are labels: Enter and Space open the camera from the keyboard.
    var t = /** @type {HTMLElement | null} */ (e.target);
    if (
      (e.key === 'Enter' || e.key === ' ') &&
      t &&
      t.classList &&
      (t.classList.contains('m-addwork-shutter') || t.classList.contains('m-bulletin-retake'))
    ) {
      e.preventDefault();
      var input = /** @type {HTMLInputElement | null} */ (t.querySelector('input'));
      if (input && !input.disabled) input.click();
    }
  }

  /* ── T4: Write a Bulletin ───────────────────────────────────── */

  /** @param {string} cid */
  function _draft(cid) {
    if (!_drafts[cid]) {
      _drafts[cid] = {
        kind: 'announcement',
        body: '',
        until: '',
        assessmentId: '',
        linkOn: false,
        linkUrl: '',
        linkTitle: '',
        reactions: false,
        files: [],
        msg: '',
        busy: false,
      };
    }
    return _drafts[cid];
  }

  /** @param {any} d */
  function _draftEmpty(d) {
    return !String(d.body || '').trim() && !(d.linkOn && String(d.linkUrl || '').trim()) && !d.files.length;
  }

  /** A returned bulletin's words into the box. @param {any} d @param {any} e */
  function _loadReturned(d, e) {
    var b = e.bulletin || {};
    d.kind = b.kind === 'reminder' ? 'reminder' : 'announcement';
    d.body = String(b.body || '');
    d.until = String(b.pinned_until || '');
    d.assessmentId = String(b.assessment_id || '');
    d.linkOn = !!b.link_url;
    d.linkUrl = String(b.link_url || '');
    d.linkTitle = String(b.link_title || '');
    d.reactions = b.reactions_on === true;
  }

  /** @param {string} cid */
  function _returned(cid) {
    return typeof W.getReturnedBulletins === 'function' ? W.getReturnedBulletins(cid) : [];
  }

  function openWrite() {
    var cid = _cid;
    if (!cid) return;
    var d = _draft(cid);
    // A bulletin that was not posted comes back into an empty box, with one plain sentence;
    // into a box that holds words it is only offered (Put It Back in the Box, which asks first).
    var list = _returned(cid);
    if (list.length && !d.busy && _draftEmpty(d)) {
      var e = list[list.length - 1];
      _loadReturned(d, e);
      W.dropReturnedBulletin(cid, e.key);
      d.msg = 'This bulletin was not posted, so its words are back in the box.' + (e.message ? ' ' + e.message : '');
    }
    MC.presentSheet('<div class="m-bulletin-sheet m-bulletin-write" id="m-bulletin-write"></div>', {
      onClose: function () {
        var cur = _drafts[cid];
        if (cur) cur.msg = '';
      },
    });
    _drawWrite();
    var words = /** @type {HTMLElement | null} */ (document.getElementById('m-bulletin-words'));
    if (words) words.focus({ preventScroll: true });
  }

  /** The bulletins not posted, each offered back. html-safe: their words and sentences go through esc. @param {string} cid */
  function _returnedHtml(cid) {
    return _returned(cid)
      .map(function (/** @type {any} */ e) {
        var words = String((e.bulletin && e.bulletin.body) || '').trim();
        return (
          '<div class="m-bulletin-returned" role="status"><span>' +
          esc('Not posted: “' + (words.length > 60 ? words.slice(0, 59) + '…' : words) + '”') +
          (e.message ? ' ' + esc(e.message) : '') +
          '</span><span class="m-bulletin-returned-acts"><button type="button" class="m-bulletin-text-btn" data-m-bulletin="put-back" data-key="' +
          esc(e.key) +
          '">Put It Back in the Box</button><button type="button" class="m-bulletin-text-btn" data-m-bulletin="drop-returned" data-key="' +
          esc(e.key) +
          '">Dismiss</button></span></div>'
        );
      })
      .join('');
  }

  /** @param {string} key @param {{ x: number, y: number } | null} tap */
  function _putBack(key, tap) {
    var cid = _cid;
    var e = _returned(cid).filter(function (/** @type {any} */ x) {
      return x.key === key;
    })[0];
    if (!e) return;
    _readWrite();
    var go = function () {
      var d = _draft(cid);
      _loadReturned(d, e);
      d.msg = '';
      W.dropReturnedBulletin(cid, key);
      if (document.getElementById('m-bulletin-write')) _drawWrite();
      else openWrite();
    };
    if (_draftEmpty(_draft(cid))) return go();
    _confirm(
      'Put It Back in the Box?',
      'The box holds words you have not posted. What is in the box now is replaced.',
      'Put It Back',
      go,
      tap,
      'Keep What I Have',
    );
  }

  function _readWrite() {
    var box = document.getElementById('m-bulletin-write');
    if (!box || !_cid) return;
    var d = _draft(_cid);
    /** @param {string} id */
    var val = function (id) {
      var el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
      return el ? el.value : null;
    };
    var words = val('m-bulletin-words');
    if (words != null) d.body = words;
    var until = val('m-bulletin-until');
    if (until != null) d.until = until;
    var linked = val('m-bulletin-linked');
    if (linked != null) d.assessmentId = linked;
    var url = val('m-bulletin-link-url');
    if (url != null) d.linkUrl = url;
    var name = val('m-bulletin-link-name');
    if (name != null) d.linkTitle = name;
    var react = /** @type {HTMLInputElement | null} */ (document.getElementById('m-bulletin-react'));
    if (react) d.reactions = !!react.checked;
  }

  /** html-safe: words, titles, names and messages go through esc. */
  function _drawWrite() {
    var box = document.getElementById('m-bulletin-write');
    if (!box || !_cid) return;
    var cid = _cid;
    var d = _draft(cid);
    var reminder = d.kind === 'reminder';
    // Only assessments the server has (a local id is never sent: B1c's _bltAssessmentOk); Demo Mode's are all local.
    var assessments = ((typeof W.getAssessments === 'function' && W.getAssessments(cid)) || []).filter(
      function (/** @type {any} */ a) {
        return typeof W._bltAssessmentOk !== 'function' || W._bltAssessmentOk(a.id);
      },
    );
    // The class's date (courseToday), not the phone's.
    var today = typeof W._bltToday === 'function' ? W._bltToday(cid) : W.getTodayStr();
    var seg = function (/** @type {string} */ kind, /** @type {string} */ label) {
      var onNow = d.kind === kind;
      return (
        '<button type="button" class="m-seg-btn' +
        (onNow ? ' m-seg-active' : '') +
        '" aria-pressed="' +
        (onNow ? 'true' : 'false') +
        '" data-m-bulletin="kind" data-kind="' +
        kind +
        '">' +
        label +
        '</button>'
      );
    };
    var files = d.files
      .map(function (/** @type {any} */ f, /** @type {number} */ i) {
        return (
          '<div class="m-bulletin-file-row"><span>' +
          esc(
            (f.kind === 'pdf' ? 'PDF · ' : 'Photo · ') +
              f.title +
              ' · ' +
              f.pages.length +
              (f.pages.length === 1 ? ' Page' : ' Pages'),
          ) +
          '</span><button type="button" class="m-bulletin-text-btn" data-m-bulletin="drop-file" data-i="' +
          i +
          '">Remove</button></div>'
        );
      })
      .join('');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-labelledby', 'm-bulletin-write-title');
    // html-safe: the words, titles, dates and messages go through esc; the rest is fixed markup.
    box.innerHTML =
      '<div class="m-bulletin-sheet-head"><button type="button" class="m-bulletin-head-btn" data-m-bulletin="close">Cancel</button>' +
      '<h2 class="m-bulletin-sheet-title" id="m-bulletin-write-title">Write a Bulletin</h2><span class="m-bulletin-head-gap"></span></div>' +
      '<p class="m-bulletin-hint m-bulletin-to">' +
      esc('Posts to ' + _className(cid) + ': every student’s phone.') +
      '</p>' +
      _returnedHtml(cid) +
      '<div class="m-segmented m-bulletin-kinds" role="group" aria-label="Kind of bulletin">' +
      seg('announcement', 'Announcement') +
      seg('reminder', 'Reminder') +
      '</div>' +
      '<label class="m-sheet-label m-bulletin-label" for="m-bulletin-words">Words</label>' +
      '<textarea class="m-sheet-textarea" id="m-bulletin-words" rows="3" maxlength="' +
      MAX_WORDS +
      '">' +
      esc(d.body) +
      '</textarea>' +
      (reminder
        ? '<label class="m-bulletin-row" for="m-bulletin-until"><span>Stays Pinned Until</span>' +
          '<input type="date" id="m-bulletin-until" min="' +
          esc(today) +
          '" value="' +
          esc(d.until) +
          '"></label>' +
          '<label class="m-bulletin-row" for="m-bulletin-linked"><span>Linked To</span>' +
          '<select id="m-bulletin-linked"><option value="">None</option>' +
          assessments
            .map(function (/** @type {any} */ a) {
              return (
                '<option value="' +
                esc(a.id) +
                '"' +
                (a.id === d.assessmentId ? ' selected' : '') +
                '>' +
                esc(a.title || 'Untitled') +
                '</option>'
              );
            })
            .join('') +
          '</select></label>'
        : '') +
      (d.linkOn
        ? '<label class="m-sheet-label m-bulletin-label" for="m-bulletin-link-url">Link</label>' +
          '<input type="url" class="m-bulletin-input" id="m-bulletin-link-url" inputmode="url" autocomplete="off" placeholder="https://" value="' +
          esc(d.linkUrl) +
          '">' +
          '<label class="m-sheet-label m-bulletin-label" for="m-bulletin-link-name">Link Name</label>' +
          '<input type="text" class="m-bulletin-input" id="m-bulletin-link-name" maxlength="200" placeholder="Optional" value="' +
          esc(d.linkTitle) +
          '">'
        : '') +
      files +
      '<div class="m-bulletin-two">' +
      (d.linkOn ? '' : '<button type="button" class="m-bulletin-btn" data-m-bulletin="add-link">Add a Link</button>') +
      '<label class="m-bulletin-btn" tabindex="0">Add a File' +
      '<input type="file" class="m-bulletin-file-input" accept="image/*,application/pdf"' +
      (d.busy ? ' disabled' : '') +
      '></label></div>' +
      '<label class="m-bulletin-switch" for="m-bulletin-react"><input type="checkbox" role="switch" id="m-bulletin-react"' +
      (d.reactions ? ' checked' : '') +
      '><span>Let Students React</span></label>' +
      '<p class="m-bulletin-msg" role="status">' +
      esc(d.msg) +
      '</p>' +
      '<button type="button" class="m-btn-primary m-bulletin-post" data-m-bulletin="post"' +
      (d.busy ? ' disabled' : '') +
      '>Post</button>';
  }

  /** A photo or a PDF from the phone, made into pages by PhotoShrink. @param {File} file */
  function addFile(file) {
    var cid = _cid;
    if (!cid || !file) return Promise.resolve();
    var d = _draft(cid);
    var prepare = _prepare || (W.PhotoShrink && W.PhotoShrink.prepare);
    _readWrite();
    if (typeof prepare !== 'function') {
      d.msg = "Files can't be added on this page.";
      _drawWrite();
      return Promise.resolve();
    }
    d.busy = true;
    d.msg = 'Getting the file ready…';
    _drawWrite();
    return Promise.resolve()
      .then(function () {
        return prepare(file, { openPdf: W.PhotoReaders && W.PhotoReaders.openPdf, maxPages: MAX_PAGES });
      })
      .then(null, function () {
        return { ok: false };
      })
      .then(function (/** @type {any} */ res) {
        d.busy = false;
        d.msg = '';
        var R = (W.PhotoShrink && W.PhotoShrink.REASONS) || {};
        if (!res || !res.ok) {
          d.msg =
            res && res.reason === R.TOO_MANY_PAGES
              ? 'That PDF has more than ' + MAX_PAGES + ' pages.'
              : res && res.reason === R.OFFICE
                ? 'Save it as a PDF first.'
                : "That file couldn't be used. Choose a photo or a PDF.";
        } else {
          var have = d.files.reduce(function (/** @type {number} */ n, /** @type {any} */ f) {
            return n + f.pages.length;
          }, 0);
          if (have + res.pages.length > MAX_PAGES) d.msg = 'A bulletin can hold up to ' + MAX_PAGES + ' pages in all.';
          else {
            var isPdf = res.kind === 'pdf';
            var title = String((file && file.name) || '')
              .replace(/\.[A-Za-z0-9]{1,5}$/, '')
              .replace(/[_]+/g, ' ')
              .trim();
            d.files.push({
              kind: isPdf ? 'pdf' : 'photo',
              title: (title || (isPdf ? 'PDF' : 'Photo')).slice(0, 200),
              pages: res.pages,
            });
          }
        }
        if (cid === _cid) _drawWrite();
      });
  }

  /** The draft as data-bulletins takes it. @param {any} d */
  function _asDraft(d) {
    var reminder = d.kind === 'reminder';
    return {
      kind: d.kind,
      body: d.body,
      link_url: d.linkOn ? d.linkUrl : '',
      link_title: d.linkOn ? d.linkTitle : '',
      pinned: reminder,
      pinned_until: reminder ? d.until : '',
      assessment_id: reminder ? d.assessmentId : '',
      reactions_on: d.reactions,
    };
  }

  function postWritten() {
    var cid = _cid;
    if (!cid) return Promise.resolve();
    _readWrite();
    var d = _draft(cid);
    if (d.busy) return Promise.resolve();
    var draft = _asDraft(d);
    var problem = W.bulletinDraftProblem(
      Object.assign({}, draft, {
        files: d.files.map(function (/** @type {any} */ f) {
          return { pages: f.pages.length };
        }),
      }),
    );
    if (problem) {
      d.msg = problem;
      _drawWrite();
      return Promise.resolve();
    }
    var files = d.files.map(function (/** @type {any} */ f) {
      return { kind: f.kind, title: f.title, pages: f.pages };
    });
    if (files.length) {
      d.busy = true;
      d.msg = '';
      _drawWrite();
    } else {
      // Words only: it waits in the outbox as Not Sent Yet; the sheet closes at once.
      delete _drafts[cid];
      MC.dismissSheet();
    }
    return Promise.resolve(W.postBulletin(cid, draft, files, { queue: true })).then(function (/** @type {any} */ out) {
      if (files.length) {
        var cur = _draft(cid);
        cur.busy = false;
        if (out && out.ok) {
          delete _drafts[cid];
          MC.dismissSheet();
        } else {
          cur.msg = (out && out.message) || 'This was not posted. Try again.';
          if (cid === _cid) _drawWrite();
        }
      }
      // Words only and refused: the data layer gives them back (getReturnedBulletins), offered when the sheet opens.
      if (cid === _cid) _drawFeed();
      return out;
    });
  }

  /* ── A confirm whose main button is never under the tap that opened it ── */

  /**
   * A question in a sheet whose main button is never where the tap that
   * opened it was: of the two orders (main button first or last), the one
   * that keeps the tap point off the main button's resting place is drawn.
   * @param {string} title @param {string} text @param {string} okLabel
   * @param {(tap: { x: number, y: number } | null) => void} onOk given where the main button was tapped
   * @param {{ x: number, y: number } | null} tap @param {string} [cancelLabel] @param {boolean} [danger] red, for a delete
   */
  function _confirm(title, text, okLabel, onOk, tap, cancelLabel, danger) {
    MC.presentSheet(
      '<div class="m-bulletin-sheet m-bulletin-confirm" role="dialog" aria-modal="true" aria-labelledby="m-bulletin-confirm-title">' +
        '<h2 class="m-bulletin-sheet-title" id="m-bulletin-confirm-title">' +
        esc(title) +
        '</h2><p class="m-bulletin-hint">' +
        esc(text) +
        '</p><div class="m-bulletin-confirm-acts">' +
        '<button type="button" class="m-bulletin-btn m-bulletin-confirm-ok' +
        (danger ? ' is-danger' : '') +
        '">' +
        esc(okLabel) +
        '</button>' +
        '<button type="button" class="m-bulletin-btn m-bulletin-confirm-cancel" data-m-bulletin="close">' +
        esc(cancelLabel || 'Cancel') +
        '</button></div></div>',
      { half: true },
    );
    var sheet = /** @type {HTMLElement | null} */ (document.querySelector('#m-sheet-container .m-sheet'));
    var acts = document.querySelector('#m-sheet-container .m-bulletin-confirm-acts');
    var ok = /** @type {HTMLButtonElement | null} */ (
      document.querySelector('#m-sheet-container .m-bulletin-confirm-ok')
    );
    var cancel = /** @type {HTMLButtonElement | null} */ (
      document.querySelector('#m-sheet-container .m-bulletin-confirm-cancel')
    );
    if (!sheet || !ok || !cancel || !acts) return;
    var box = sheet;
    var main = ok;
    // Where the main button rests once the sheet has slid up: the sheet sits on the bottom edge (its slide is not counted).
    var under = function () {
      if (!tap) return false;
      var r = main.getBoundingClientRect();
      var top = window.innerHeight - box.offsetHeight + (r.top - box.getBoundingClientRect().top);
      return tap.y >= top - 4 && tap.y <= top + r.height + 4 && tap.x >= r.left - 4 && tap.x <= r.right + 4;
    };
    if (under()) {
      acts.appendChild(ok); // the main button last: the two never overlap, so the tap is now off it
      if (under()) acts.insertBefore(ok, cancel);
    }
    var done = false;
    ok.onclick = function (/** @type {MouseEvent} */ ev) {
      if (done) return;
      done = true;
      MC.dismissSheet();
      onOk(ev && (ev.clientX || ev.clientY) ? { x: ev.clientX, y: ev.clientY } : null);
    };
    cancel.focus({ preventScroll: true });
  }

  /* ── Take It Back and Delete ────────────────────────────────── */

  /** Where Take It Back stands now: 'waiting', 'sent' or 'none'. @param {string} cid @param {string} key */
  function _takeBackState(cid, key) {
    return typeof W.bulletinTakeBackState === 'function' ? W.bulletinTakeBackState(cid, key) : 'waiting';
  }

  /**
   * Take It Back always ends with the bulletin gone or the teacher told. The
   * words are true for where it stands when OK is tapped: if that changed
   * since the question opened, the question is asked again with the new
   * words before anything is done.
   * @param {string} cid @param {string} key @param {{ x: number, y: number } | null} tap
   */
  function _askTakeBack(cid, key, tap) {
    var state = _takeBackState(cid, key);
    var sent = state === 'sent';
    _confirm(
      'Take It Back?',
      sent
        ? 'Students may already have seen it. It will be deleted.'
        : 'It will not be posted, and students will never see it.',
      sent ? 'Delete It' : 'Take It Back',
      function (okTap) {
        var now = _takeBackState(cid, key);
        // Moved on while the question was open: ask again in words that are true now (after this sheet has gone),
        // its main button kept off the place the first OK was tapped.
        if ((now === 'sent') !== sent && now !== 'none') return void setTimeout(_askTakeBack, 380, cid, key, okTap);
        _takeBackNow(cid, key, true);
      },
      tap,
      undefined,
      sent,
    );
  }

  /** @param {string} cid @param {string} key @param {boolean} retry */
  function _takeBackNow(cid, key, retry) {
    if (W.takeBackBulletin(cid, key)) return _drawFeed();
    if (!retry) {
      // Said on its card, as a refused delete is.
      var card = feedModel(W.getBulletins(cid)).filter(function (c) {
        return c.key === key || c.id === 'waiting:' + key;
      })[0];
      if (card) _notes[card.id] = 'It could not be taken back. Open it and choose Delete This Bulletin.';
      return _drawFeed();
    }
    // Not known here yet (its answer has not been read): read the class, then try once more.
    Promise.resolve(W.refreshBulletins(cid, { force: true })).then(function () {
      _takeBackNow(cid, key, false);
    });
  }

  /** @type {Record<string, string>} */
  var _notes = {}; // bulletin id → the plain sentence of a refused delete (or a Take It Back that could not be done), on its card

  /** Delete a sent bulletin: gone from the feed at once (and while it waits in the outbox); a refusal brings it back with its sentence. @param {string} cid @param {string} id */
  function _deleteNow(cid, id) {
    delete _notes[id];
    Promise.resolve(W.deleteBulletin(cid, id)).then(function (/** @type {any} */ out) {
      if (out && !out.ok && !out.gone) {
        _notes[id] = out.message || 'It could not be deleted.';
        _dismissDeleteRefusal(id);
      }
      if (cid === _cid) _drawFeed();
    });
    _drawFeed();
  }

  /** The outbox's failed delete of a bulletin, once its sentence is on the card. @param {string} id */
  function _dismissDeleteRefusal(id) {
    var q = W.v2Queue;
    if (!q || typeof q.deadLetter !== 'function' || typeof q.dismissDeadLetter !== 'function') return;
    (q.deadLetter() || []).forEach(function (/** @type {any} */ e) {
      if (e && e.endpoint === 'delete_bulletin' && e.payload && e.payload.p_bulletin_id === id)
        q.dismissDeadLetter(e.id);
    });
  }

  /** A delete refused while the page was closed: its sentence goes on the card, and the outbox forgets it. @param {string[]} ids */
  function _adoptDeleteRefusals(ids) {
    var q = W.v2Queue;
    if (!q || typeof q.deadLetter !== 'function') return;
    (q.deadLetter() || []).forEach(function (/** @type {any} */ e) {
      var id = e && e.endpoint === 'delete_bulletin' && e.payload ? String(e.payload.p_bulletin_id || '') : '';
      if (!id || ids.indexOf(id) < 0 || _notes[id]) return;
      _notes[id] =
        typeof W._bltMessage === 'function'
          ? W._bltMessage({ code: e.last_code, message: e.last_error }, 'delete_bulletin')
          : 'It could not be deleted.';
      _dismissDeleteRefusal(id);
    });
  }

  /* ── Events ─────────────────────────────────────────────────── */

  function _bind() {
    if (_bound) return;
    _bound = true;
    document.addEventListener('click', _onClick);
    document.addEventListener('change', _onChange);
    document.addEventListener('visibilitychange', _onVisibility);
    document.addEventListener('fv:bulletins-changed', _onChanged);
    // A delete answered or given up by the outbox (after a reload too): the card goes, or comes back with its sentence.
    if (W.v2Queue && typeof W.v2Queue.subscribe === 'function') {
      W.v2Queue.subscribe(function (/** @type {any} */ evt) {
        if (_cid && evt && evt.meta && evt.meta.endpoint === 'delete_bulletin') _drawFeed();
      });
    }
  }

  /** @param {any} e */
  function _onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-m-bulletin]') : null;
    if (!el || el.disabled) return;
    var what = el.getAttribute('data-m-bulletin');
    if (what === 'photo') return openCamera();
    if (what === 'write') return openWrite();
    if (what === 'seen') return openSeen(el.getAttribute('data-id') || '');
    if (what === 'close') return MC.dismissSheet();
    if (what === 'again') return _showAgain();
    if (what === 'show-seen') {
      if (_seen) _seen.open = !_seen.open;
      return _drawSeen();
    }
    if (what === 'kind') {
      _readWrite();
      var d = _draft(_cid);
      d.kind = el.getAttribute('data-kind') === 'reminder' ? 'reminder' : 'announcement';
      return _drawWrite();
    }
    if (what === 'add-link') {
      _readWrite();
      _draft(_cid).linkOn = true;
      _drawWrite();
      var url = document.getElementById('m-bulletin-link-url');
      if (url) url.focus();
      return;
    }
    if (what === 'drop-file') {
      _readWrite();
      _draft(_cid).files.splice(Number(el.getAttribute('data-i')) || 0, 1);
      return _drawWrite();
    }
    if (what === 'post') return postWritten();
    var tap = typeof e.clientX === 'number' && (e.clientX || e.clientY) ? { x: e.clientX, y: e.clientY } : null;
    var cid = _cid;
    if (what === 'put-back') return _putBack(el.getAttribute('data-key') || '', tap);
    if (what === 'drop-returned') {
      _readWrite();
      W.dropReturnedBulletin(cid, el.getAttribute('data-key') || '');
      return _drawWrite();
    }
    if (what === 'take-back') return _askTakeBack(cid, el.getAttribute('data-key') || '', tap);
    if (what === 'delete') {
      var id = el.getAttribute('data-id') || '';
      return _confirm(
        'Delete This Bulletin?',
        'It is removed from every student’s phone, with who has seen it. This cannot be undone.',
        'Delete',
        function () {
          _deleteNow(cid, id);
        },
        tap,
        undefined,
        true,
      );
    }
  }

  /** @param {any} e */
  function _onChange(e) {
    var input = e.target;
    if (!input || !input.classList || !input.classList.contains('m-bulletin-file-input')) return;
    var file = input.files && input.files[0];
    input.value = '';
    if (file) addFile(file);
  }

  return {
    on: on,
    boot: boot,
    tab: tab,
    configure: configure,
    render: render,
    shown: shown,
    left: left,
    refresh: refresh,
    openSeen: openSeen,
    openCamera: openCamera,
    closeCamera: closeCamera,
    takePhoto: takePhoto,
    postPhoto: postPhoto,
    openWrite: openWrite,
    addFile: addFile,
    postWritten: postWritten,
    // The model, for the tests.
    feedModel: feedModel,
    kindLabel: kindLabel,
    seenLine: seenLine,
    timeText: timeText,
    dayText: dayText,
    pausedText: pausedText,
    noCardText: noCardText,
  };
})();
