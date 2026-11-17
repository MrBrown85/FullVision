// @ts-check
/* ── add-work-split-turn.js — Split the Scan: upside-down pages (B5) ─────
   Turn Every Page: one click turns the whole scan half a turn, for a pile
   fed into the copier upside down. Pressed again, it turns them back: a
   page it turned and nobody turned since gets its own first picture back
   (no picture is redrawn twice); a page turned by hand since is turned
   half a turn again. The Turn button on each page stays as it was.

   Finding upside-down pages on their own. The plan allows it only if a
   trial shows it can be trusted. The trial (Nov 17, 90 made-up pages,
   each right way up and upside down, printed, handwriting-like and harder
   ones) made wrong calls: tall letters against hanging ones was wrong on
   1 handwriting-like page, more ink at the top was wrong on 9 pages with
   a diagram at the top. So nothing here guesses from the picture.
   `finders` is the place for a way that is certain: B4's sticker is read
   with its direction, and a sticker read upside down says its page is.
   A finder is function (page) → Promise of true (upside down), false, or
   null (can't tell); only true marks a page, and a marked page is only
   pointed out (an outline and "Upside down?"), never turned by itself.

   AddWorkSplitTurn.finders              [] for now (see above).
   AddWorkSplitTurn.find(s, ctx)         ask every finder about every page.
   AddWorkSplitTurn.html(s)              Turn Every Page and its line.
   AddWorkSplitTurn.busy(s)              true while pages are turning.
   AddWorkSplitTurn.click(s, what, btn, ctx)
   AddWorkSplitTurn.half(page)           a page turned half a turn. */
/** @type {any} */ (window).AddWorkSplitTurn = (function () {
  'use strict';

  /** @type {Array<(page: any) => Promise<boolean | null>>} */
  var finders = [];

  /* A page turned half a turn, redrawn on a canvas and shrunk again
     through PhotoShrink, so it keeps every guarantee a page has. */
  function half(page) {
    return createImageBitmap(page.blob)
      .then(function (bmp) {
        var c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        var ctx = c.getContext('2d');
        if (!ctx) throw new Error('No canvas');
        ctx.translate(c.width, c.height);
        ctx.rotate(Math.PI);
        ctx.drawImage(bmp, 0, 0);
        if (bmp.close) bmp.close();
        return new Promise(function (resolve, reject) {
          c.toBlob(
            function (b) {
              c.width = 0;
              c.height = 0;
              if (b) resolve(b);
              else reject(new Error('No JPEG'));
            },
            'image/jpeg',
            0.92,
          );
        });
      })
      .then(function (blob) {
        return PhotoShrink.prepare(blob);
      })
      .then(function (res) {
        if (!res || !res.ok || !res.pages || !res.pages[0]) throw new Error('Not shrunk');
        var p = res.pages[0];
        p.name = page.name;
        p.blurry = false;
        p.sharpness = page.sharpness;
        return p;
      });
  }

  function busy(s) {
    return !!(s && s.turnAll);
  }

  // html-safe: fixed words and numbers, through esc
  function html(s) {
    var t = s.turnAll;
    var on = !!s.allTurned;
    var line = t
      ? 'Turning page ' + t.done + ' of ' + t.total + '…'
      : on
        ? 'Every page is turned. Press it again to turn them back.'
        : 'For a pile fed in upside down. The Turn button on a page turns that page only.';
    return (
      '<section class="aws-sec">' +
      '<button type="button" class="aws-turn-all' +
      (on ? ' is-on' : '') +
      '" data-aws="turnAll" data-key="turnAll" aria-pressed="' +
      on +
      '"' +
      (t ? ' disabled' : '') +
      '>Turn Every Page</button>' +
      '<p class="aws-hint aws-turn-line" role="status">' +
      esc(line + (s.turnSaid ? ' ' + s.turnSaid : '')) +
      '</p>' +
      '</section>'
    );
  }

  function _line(s) {
    var el = s.overlay.querySelector('.aws-turn-line');
    if (el && s.turnAll) el.textContent = 'Turning page ' + s.turnAll.done + ' of ' + s.turnAll.total + '…';
  }

  // Every page, one after another; the page closing stops it.
  function _all(s, ctx) {
    var back = !!s.allTurned;
    var nos = s.m.pages().map(function (p) {
      return p.no;
    });
    s.flips = s.flips || {};
    s.turnAll = { done: 0, total: nos.length };
    s.turnSaid = '';
    var failed = 0;
    ctx.draw({ focus: 'turnAll', fallback: '.aws-cancel' });
    return nos
      .reduce(function (chain, no) {
        return chain.then(function () {
          if (ctx.state() !== s || !s.m) return;
          s.turnAll.done++;
          _line(s);
          var p = s.m.page(no);
          if (!p) return;
          var was = p.page;
          var flip = s.flips[no];
          if (back && flip && flip.made === was) {
            s.m.setPage(no, flip.was);
            delete s.flips[no];
            return;
          }
          return api
            .half(was)
            .then(null, function () {
              return null;
            })
            .then(function (page) {
              if (ctx.state() !== s || !s.m) return;
              var now = s.m.page(no);
              if (!page || !now || now.page !== was) {
                if (!page) failed++;
                return;
              }
              s.m.setPage(no, page);
              if (back) delete s.flips[no];
              else s.flips[no] = { was: was, made: page };
            });
        });
      }, Promise.resolve())
      .then(function () {
        if (ctx.state() !== s) return;
        s.turnAll = null;
        s.allTurned = !back;
        s.turnSaid = failed ? failed + (failed === 1 ? ' page' : ' pages') + ' couldn’t be turned. Try again.' : '';
        ctx.draw({ focus: 'turnAll' });
      });
  }

  function click(s, what, btn, ctx) {
    if (what !== 'turnAll') return false;
    if (!s.turnAll) _all(s, ctx);
    return true;
  }

  // Each finder asked about each page; only a sure "upside down" marks one.
  function find(s, ctx) {
    if (!finders.length) return Promise.resolve(0);
    s.upside = {};
    var nos = s.m.pages().map(function (p) {
      return p.no;
    });
    return nos
      .reduce(function (chain, no) {
        return chain.then(function () {
          if (ctx.state() !== s || !s.m) return;
          var p = s.m.page(no);
          return finders
            .reduce(
              function (c, f) {
                return c.then(function (got) {
                  if (got !== null) return got;
                  return Promise.resolve()
                    .then(function () {
                      return f(p.page);
                    })
                    .then(
                      function (v) {
                        return v === true || v === false ? v : null;
                      },
                      function () {
                        return null;
                      },
                    );
                });
              },
              Promise.resolve(/** @type {boolean|null} */ (null)),
            )
            .then(function (v) {
              if (v === true && ctx.state() === s) s.upside[no] = p.page;
            });
        });
      }, Promise.resolve())
      .then(function () {
        if (ctx.state() !== s) return 0;
        ctx.draw();
        return Object.keys(s.upside).length;
      });
  }

  // Whether page `no` was found upside down and is still the same picture.
  function marked(s, no) {
    var p = s.upside && s.upside[no];
    var now = s.m && s.m.page(no);
    return !!(p && now && now.page === p);
  }

  // `half` is called through here, so a test can stand in for the canvas.
  var api = {
    finders: finders,
    find: find,
    html: html,
    busy: busy,
    click: click,
    half: half,
    marked: marked,
    all: _all,
  };
  return api;
})();
