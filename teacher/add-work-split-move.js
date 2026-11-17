// @ts-check
/* ── add-work-split-move.js — Split the Scan: a page onto another piece (B5)
   For a pile that came out of order: a page dragged onto another piece
   ("Drop to Make It Mia’s Page 3") becomes that piece's last page. The
   same move is a button (plan rule 7): each page has a small menu, See
   Full Size and Move to one of the other pieces, which works with the
   keyboard alone. The page full size is AddWorkPageView.

   What a move does to names is the model's (AddWorkSplitModel move): the
   piece it lands on keeps its name; a piece that loses its first page has
   no name; a piece left with no pages goes, with its name. Each of those
   is said in the page's note, so nothing changes out of sight.

   A drag that carries files is always files from the computer, never a
   page still marked as moving (review rule 2): it is never taken here.

   AddWorkSplitMove.tileHtml(s, no)   the page's menu button.
   AddWorkSplitMove.menuHtml(s, p)    the open menu, on piece p.
   AddWorkSplitMove.dropHtml(s, p)    the drop line on piece p.
   AddWorkSplitMove.click(s, what, btn, ctx) → true when taken.
   AddWorkSplitMove.escape(s, ctx)    → true when a menu closed.
   AddWorkSplitMove.listen(overlay, ctx)  drag and drop, before the page's
                                      own "nothing dropped here" listeners.
   AddWorkSplitMove.unlisten()         when the page closes.
   AddWorkSplitMove.view(s, at, no, ctx)  piece `at` full size from page no.
   AddWorkSplitMove.move(s, no, to, ctx)  the move, its note, and a draw. */
/** @type {any} */ (window).AddWorkSplitMove = (function () {
  'use strict';

  var MENU_ICON =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2.2"></circle><circle cx="12" cy="12" r="2.2"></circle><circle cx="19" cy="12" r="2.2"></circle></svg>';
  var TYPE = 'application/x-fv-scan-page';

  function _pieceOf(s, no) {
    return (
      s.m.pieces().find(function (p) {
        return p.nos.indexOf(no) >= 0;
      }) || null
    );
  }

  // "Mia’s Page 3", or "Page 3 of Piece 6" on a piece with no name.
  function _target(s, p, ctx) {
    var n = p.nos.length + 1;
    var who = p.sid ? ctx.call(s, p.sid) : '';
    return who ? who + '’s Page ' + n : 'Page ' + n + ' of Piece ' + (p.at + 1);
  }

  // html-safe: numbers are ours (esc too); the icon is fixed
  function tileHtml(s, no) {
    var open = s.pmenu === no;
    return (
      '<button type="button" class="aws-pmenu" data-aws="pmenu" data-no="' +
      esc(String(no)) +
      '" data-key="pmenu:' +
      esc(String(no)) +
      '" tabindex="-1" aria-haspopup="menu" aria-expanded="' +
      open +
      '" aria-label="' +
      esc('Page ' + no + ': See Full Size or Move') +
      '" title="See full size, or move to another piece">' +
      MENU_ICON +
      '</button>'
    );
  }

  // html-safe: names go through esc; numbers are ours (esc too)
  function menuHtml(s, p, ctx) {
    var no = s.pmenu;
    if (!no || p.nos.indexOf(no) < 0) return '';
    var max = window.AddWorkSplitModel ? AddWorkSplitModel.maxPiece() : 30;
    var num = esc(String(no));
    var items =
      '<button type="button" class="aws-pmenu-item" role="menuitem" data-aws="view" data-at="' +
      esc(String(p.at)) +
      '" data-no="' +
      num +
      '">See Full Size</button>';
    var others = s.m.pieces().filter(function (q) {
      return q.at !== p.at;
    });
    if (others.length) items += '<span class="aws-pmenu-h" role="presentation">Move to</span>';
    // While Turn Every Page runs, nothing moves.
    var busy = !!(ctx.busy && ctx.busy());
    others.forEach(function (q) {
      var full = q.nos.length >= max;
      items +=
        '<button type="button" class="aws-pmenu-item" role="menuitem" data-aws="moveTo" data-no="' +
        num +
        '" data-to="' +
        esc(String(q.at)) +
        '"' +
        (full
          ? ' disabled title="A piece of work can have 30 pages at most."'
          : busy
            ? ' disabled title="Wait for every page to turn."'
            : '') +
        '>' +
        esc('Make It ' + _target(s, q, ctx)) +
        '</button>';
    });
    return '<div class="aws-pmenu-list" role="menu" aria-label="' + esc('Page ' + no) + '">' + items + '</div>';
  }

  function dropHtml() {
    return '<span class="aws-drop-line" aria-hidden="true"></span>';
  }

  /* ── The move ── */
  function move(s, no, to, ctx) {
    if (ctx.busy && ctx.busy()) return { ok: false, reason: 'busy' };
    var dst = s.m.pieces()[to];
    var label = dst ? _target(s, dst, ctx) : '';
    var res = s.m.move(no, to);
    s.pmenu = null;
    if (!res.ok) {
      s.headNote = res.reason === 'too_many_pages' ? 'A piece of work can have 30 pages at most.' : '';
      ctx.draw({ focus: 'pmenu:' + no });
      return res;
    }
    var said = ['Page ' + no + ' is now ' + label + '.'];
    if (res.unnamed)
      said.push('The piece it came from starts on another page now, so ' + ctx.full(s, res.unnamed) + ' came off it.');
    if (res.gone)
      said.push(
        'Piece ' +
          (res.gone.at + 1) +
          ' had no pages left and went' +
          (res.gone.sid ? ', and ' + ctx.full(s, res.gone.sid) + ' with it.' : '.'),
      );
    s.headNote = said.join(' ');
    ctx.draw({ glide: true, focus: 'pmenu:' + no });
    return res;
  }

  function view(s, at, no, ctx) {
    var p = s.m.pieces()[at];
    if (!p || !(/** @type {any} */ (window).AddWorkPageView)) return false;
    var start = Math.max(0, p.nos.indexOf(no));
    var back = s.overlay.querySelector('#aws-name-' + at);
    var key = back ? back.getAttribute('data-key') : null;
    return AddWorkPageView.open({
      title: 'Piece ' + (p.at + 1) + (p.sid ? ', ' + ctx.full(s, p.sid) : ''),
      pages: p.nos.map(function (n) {
        var pg = s.m.page(n);
        return { blob: pg && pg.page && pg.page.blob, label: 'Page ' + n };
      }),
      at: start,
      onClose: function () {
        if (!s.overlay.isConnected) return;
        var el = /** @type {any} */ (key && s.overlay.querySelector('[data-key="' + key + '"]'));
        if (el) el.focus();
      },
    });
  }

  function click(s, what, btn, ctx) {
    var no = Number(btn.getAttribute('data-no'));
    if (what === 'pmenu') {
      s.pmenu = s.pmenu === no ? null : no;
      ctx.draw({ focus: 'pmenu:' + no });
      var first = s.pmenu && s.overlay.querySelector('.aws-pmenu-list .aws-pmenu-item');
      if (first) first.focus();
      return true;
    }
    if (what === 'view') {
      s.pmenu = null;
      ctx.draw({ focus: 'pmenu:' + no });
      view(s, Number(btn.getAttribute('data-at')), no, ctx);
      return true;
    }
    if (what === 'moveTo') {
      move(s, no, Number(btn.getAttribute('data-to')), ctx);
      return true;
    }
    // Anything else closes an open menu first.
    if (s.pmenu) s.pmenu = null;
    return false;
  }

  function escape(s, ctx) {
    if (!s.pmenu) return false;
    var no = s.pmenu;
    s.pmenu = null;
    ctx.draw({ focus: 'pmenu:' + no });
    return true;
  }

  // Up and down move through an open menu.
  function key(s, e) {
    var item = e.target && e.target.closest ? e.target.closest('.aws-pmenu-item') : null;
    if (!item || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return false;
    var items = Array.prototype.slice.call(s.overlay.querySelectorAll('.aws-pmenu-item:not(:disabled)'));
    var i = items.indexOf(item);
    var next = items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
    e.preventDefault();
    if (next) next.focus();
    return true;
  }

  /* ── Drag and drop ── */
  function _hasFiles(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, 'Files') >= 0;
  }

  function _hasPage(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, TYPE) >= 0;
  }

  function _off(s) {
    if (!s.over) return;
    s.over.classList.remove('is-drop');
    var line = s.over.querySelector('.aws-drop-line');
    if (line) line.textContent = '';
    s.over = null;
  }

  /* A page is moved only by a drop that carries this page's own mark
     (TYPE, with its number) for the page this drag started on. A drag
     whose end was never heard (its tile drawn away mid-drag) leaves
     s.drag set; a later drop of text, a link or a picture carries no
     mark and moves nothing. dragend is heard on the document, so a tile
     drawn away still ends its drag. */
  /** @type {any} */
  var _docEnd = null;

  function listen(overlay, ctx) {
    unlisten();
    overlay.addEventListener('dragstart', function (e) {
      var s = ctx.state();
      if (s) s.drag = null;
      var tile = e.target && e.target.closest ? e.target.closest('.aws-tile[data-no]') : null;
      if (!s || !tile || tile.classList.contains('is-out') || s.phase !== 'split' || ctx.busy()) return;
      s.drag = { no: Number(tile.getAttribute('data-no')) };
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(TYPE, String(s.drag.no));
      }
    });
    overlay.addEventListener('dragover', function (e) {
      var s = ctx.state();
      if (!s) return;
      // Files from the computer: never a page, and never taken here.
      if (_hasFiles(e)) {
        s.drag = null;
        return _off(s);
      }
      if (!s.drag || !_hasPage(e)) return _off(s);
      var card = e.target && e.target.closest ? e.target.closest('.aws-card[data-at]') : null;
      var to = card ? Number(card.getAttribute('data-at')) : -1;
      var p = to >= 0 ? s.m.pieces()[to] : null;
      var max = window.AddWorkSplitModel ? AddWorkSplitModel.maxPiece() : 30;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!p || p.nos.indexOf(s.drag.no) >= 0 || p.nos.length >= max || ctx.busy()) {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        return _off(s);
      }
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (s.over === card) return;
      _off(s);
      s.over = card;
      card.classList.add('is-drop');
      var line = card.querySelector('.aws-drop-line');
      if (line) line.textContent = 'Drop to Make It ' + _target(s, p, ctx);
    });
    overlay.addEventListener('drop', function (e) {
      var s = ctx.state();
      if (!s) return;
      var drag = s.drag;
      s.drag = null;
      _off(s);
      if (_hasFiles(e) || !drag || !e.dataTransfer) return;
      var mark = String(e.dataTransfer.getData(TYPE) || '');
      if (!/^\d+$/.test(mark)) return;
      var no = Number(mark);
      // The mark is this drag's page, and that page is in a piece.
      if (no !== drag.no || !_pieceOf(s, no)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var card = e.target && e.target.closest ? e.target.closest('.aws-card[data-at]') : null;
      if (!card || ctx.busy()) return;
      move(s, no, Number(card.getAttribute('data-at')), ctx);
    });
    _docEnd = function () {
      var s = ctx.state();
      if (!s) return;
      s.drag = null;
      _off(s);
    };
    document.addEventListener('dragend', _docEnd, true);
  }

  // Split the Scan closing: the document's dragend listener goes.
  function unlisten() {
    if (_docEnd) document.removeEventListener('dragend', _docEnd, true);
    _docEnd = null;
  }

  return {
    tileHtml: tileHtml,
    menuHtml: menuHtml,
    dropHtml: dropHtml,
    click: click,
    escape: escape,
    key: key,
    listen: listen,
    unlisten: unlisten,
    view: view,
    move: move,
    pieceOf: _pieceOf,
  };
})();
