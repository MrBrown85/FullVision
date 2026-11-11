/* Student cards: the list in Class Settings › Student Page, and the printed
   card (docs/plans/student-page-build-plan.md, S0-W1 and S3-W1; DECISIONS,
   "Student cards" and ruling 63).

   One card for each student for the course. Its code opens the student's
   page: scanned from the QR, or typed. The database cannot read a card's
   code, so neither can this screen: the list shows no code, ever.

   - The list: Student, Card ("Card 2 · Made Nov 12", or No Card Yet) and
     Status (Not Printed, Printed Nov 12, Last Opened Nov 14, Locked, Needs
     a New Card, Past Its Last Day).
   - Make and Print N Cards: N is the students with no card plus those
     whose card was never printed and never opened. One press makes the
     cards (a new card replaces a never-printed one) and opens the
     browser's print dialog. A code exists only in that moment, so there is
     no making without printing and no preview.
   - Print Again: the codes of the last press, held in `_held` below and
     nowhere else, until the teacher leaves this screen (Class Settings
     closes, another tab or class is shown, the teacher signs out, the tab
     closes) or ten minutes pass. After that, printing makes new codes.

   S3-F1 and S3-F2 build the rest (filters, Unlock, Print New Card, New
   Codes for This Class, Cards Work Until).

   The cards come from shared/data.js (listStudentCards, makeStudentCards,
   markStudentCardsPrinted): the server's for a signed-in teacher, made on
   this device in Demo Mode. They are read only when this list is on the
   page: Class Settings builds every tab's panel each time it draws, so
   render() reads nothing itself. It looks, a moment after the draw, for
   its own card on the page (_readIfShown), and reads then.

   An answer is used only by the screen that asked. While cards are being
   made, or codes are held, this file watches for its card leaving the page
   (_watch). If it leaves, even for a moment, a late answer draws nothing
   and prints nothing, and held codes are let go.

   teacher/cm-student-page.js draws render(cid) under Return Grades, only
   for a class whose student page is on, and hands over the spCards*
   actions.

   cardItems and cardHtml are pure and exposed for tests. */
var StudentCards = (function () {
  'use strict';

  var STALE_MS = 60000; // the list is read again when it is drawn after this long
  var HOLD_MS = 10 * 60 * 1000; // Print Again works this long at most
  var _state = {}; // cid → { cards, at, loading, looking, making, failed, msg }

  /* The codes of the last Make and Print, for Print Again: { cid, items,
     count, timer }. Only here, in this variable: never saved, logged or
     put on the page outside the print dialog. */
  var _held = null;
  /* The screen that asked: { cid, gen, observer, interval }. gen changes
     whenever that screen goes away. */
  var _watch = null;
  var _gen = 0;

  function _st(cid) {
    return (
      _state[cid] ||
      (_state[cid] = { cards: null, at: 0, loading: null, looking: false, making: null, failed: false, msg: '' })
    );
  }

  function _rerender() {
    if (typeof DashClassManager === 'undefined' || !DashClassManager.renderClassManager) return;
    // An answer that comes after Class Settings has closed draws nothing.
    if (DashClassManager.classManagerOpen) DashClassManager.renderClassManager();
  }

  function _fmtDay(iso) {
    var t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso + 'T12:00:00' : iso);
    return isNaN(t) ? '' : t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function _name(st) {
    var first = (st.preferred || st.firstName || '').trim();
    return (first + ' ' + (st.lastName || '')).trim();
  }

  function _roster(cid) {
    return sortStudents(getStudents(cid), 'lastName');
  }

  /* ── The screen that asked ─────────────────────────────────── */

  // True when this class's Student Cards card is on the page now.
  function _onPage(cid) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false;
    var el = document.querySelector('.sc-card');
    return !!el && !!el.dataset && el.dataset.cid === cid;
  }

  function _shown(cid) {
    if (typeof DashClassManager !== 'undefined' && !DashClassManager.classManagerOpen) return false;
    return _onPage(cid);
  }

  function _unwatch() {
    if (!_watch) return;
    if (_watch.observer) _watch.observer.disconnect();
    if (_watch.interval) clearInterval(_watch.interval);
    _watch = null;
  }

  // Let go of the held codes.
  function _drop() {
    if (!_held) return;
    if (_held.timer) clearTimeout(_held.timer);
    _held = null;
  }

  // The screen that asked has gone: nothing it asked for is drawn or printed, and its codes go.
  function _left() {
    _gen += 1;
    _drop();
    _unwatch();
  }

  function _check() {
    if (_watch && !_shown(_watch.cid)) _left();
  }

  /* Start watching the screen for this class (a press, or codes held).
     Every change to the page is checked, so the card leaving the page is
     seen even if it comes straight back; a timer checks too, where the
     page cannot be watched. */
  function _watchScreen(cid) {
    if (_watch && _watch.cid === cid) return _watch.gen;
    _left();
    _watch = { cid: cid, gen: _gen, observer: null, interval: null };
    if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.body) {
      try {
        _watch.observer = new MutationObserver(_check);
        _watch.observer.observe(document.body, { childList: true, subtree: true });
      } catch (e) {
        _watch.observer = null;
      }
    }
    _watch.interval = setInterval(_check, 1000);
    return _watch.gen;
  }

  // True when the answer to a press made under `gen` may still be drawn.
  function _stillAsking(cid, gen) {
    _check();
    return !!_watch && _watch.cid === cid && _watch.gen === gen && _shown(cid);
  }

  /* ── Reading the cards ─────────────────────────────────────── */

  // Read the class's cards. One read at a time for a class.
  function load(cid) {
    var st = _st(cid);
    if (st.loading) return st.loading;
    st.loading = listStudentCards(cid).then(function (res) {
      st.loading = null;
      st.at = Date.now();
      if (res && Array.isArray(res.data)) {
        st.cards = res.data;
        st.failed = false;
      } else {
        st.failed = true;
      }
      _rerender();
    });
    return st.loading;
  }

  /* After a draw: if the card is on the page (the Student Page tab is the
     open one, for this class) and its cards have not been read, or were
     read a minute or more ago, read them. Never in a loop, whether the
     last read worked or not: a failed one waits for Try Again. */
  function _readIfShown(cid) {
    var st = _st(cid);
    if (st.looking || st.loading || st.making) return;
    if (st.at && (st.failed || Date.now() - st.at <= STALE_MS)) return;
    st.looking = true;
    setTimeout(function () {
      st.looking = false;
      if (_onPage(cid) && !st.loading && !st.making) load(cid);
    }, 0);
  }

  function _byStudent(cards) {
    var out = {};
    (cards || []).forEach(function (c) {
      if (c && c.enrollment_id) out[c.enrollment_id] = c;
    });
    return out;
  }

  // The students Make and Print is for: no card, or a card never printed and never opened.
  function _toMake(students, byStudent) {
    return students.filter(function (s) {
      var c = byStudent[s.id];
      return !c || (!c.printed_at && !c.last_opened_at);
    });
  }

  /* ── The printed card ──────────────────────────────────────── */

  function _className(cid) {
    var c = typeof COURSES !== 'undefined' ? COURSES[cid] : null;
    if (!c) return '';
    var block = typeof courseBlockLabel === 'function' ? courseBlockLabel(c) : '';
    return (c.name || '') + (block ? ' · ' + block : '');
  }

  /* The address a card's QR opens: <site>/s/#<code>, as a slip's is (the
     code sits after # so it never reaches a server log). Demo Mode's cards
     open no real page, so theirs is the student page's own demo. */
  function cardUrl(card, origin, demo) {
    if (!demo) return QrSlips.slipUrl(card.code, origin);
    var base = origin || (typeof location !== 'undefined' ? location.origin : 'https://fullvision.ca');
    return base.replace(/\/$/, '') + '/s/#demo-card' + (card.password ? '-password' : '');
  }

  /* One item to print for each card just made, A to Z by last name:
     { id, name, code, url, password, seq }. `made` is makeStudentCards'
     results; only a made card whose code came back is printed. */
  function cardItems(students, made, origin, demo) {
    var byStudent = {};
    (made || []).forEach(function (r) {
      if (r && r.result === 'made' && r.code && r.card_id) byStudent[r.enrollment_id] = r;
    });
    return (students || [])
      .filter(function (st) {
        return st && byStudent[st.id];
      })
      .map(function (st) {
        var r = byStudent[st.id];
        return {
          id: r.card_id,
          name: _name(st),
          sortName: ((st.lastName || '') + ' ' + (st.preferred || st.firstName || '')).toLowerCase(),
          code: String(r.code),
          url: cardUrl(r, origin, demo),
          password: r.password ? String(r.password) : '',
          seq: Number(r.seq) > 0 ? Number(r.seq) : null,
        };
      })
      .sort(function (a, b) {
        return a.sortName.localeCompare(b.sortName);
      });
  }

  /* What goes inside one card's cell on the sheet: the student, the class,
     the card number, the QR, and the code to type, with the card's
     password when the student has no birthday or student number on file.
     The cell and its words are the slip's (teacher/qr-slips.css). */
  // html-safe: name, class, card number, address, code and password all esc()'d; svg is vendor qrcode's own rect markup
  function cardHtml(item, className, svg) {
    return (
      '<div class="qs-head"><div class="qs-who"><div class="qs-name">' +
      esc(item.name) +
      '</div><div class="qs-class">' +
      esc(className) +
      '</div></div><div class="qs-what"><div class="qs-title">Student Card</div>' +
      (item.seq ? '<div class="qs-dates">' + esc('Card ' + item.seq) + '</div>' : '') +
      '</div></div>' +
      '<div class="qs-body"><div class="qs-qr" role="img" aria-label="QR code for ' +
      esc(item.name) +
      '">' +
      svg +
      '</div><div class="qs-how"><div class="qs-scan">Scan with your phone camera.</div>' +
      '<div class="qs-type"><span>No camera? Go to ' +
      esc(
        item.url
          .replace(/^https?:\/\//, '')
          .replace(/#.*$/, '')
          .replace(/\/$/, ''),
      ) +
      ' and type</span><strong>' +
      esc(item.code) +
      '</strong></div>' +
      (item.password
        ? '<div class="qs-type qs-pass"><span>Password</span><strong>' + esc(item.password) + '</strong></div>'
        : '') +
      '</div></div>'
    );
  }

  function _demo() {
    return typeof isDemoMode === 'function' && isDemoMode();
  }

  function _print(cid, items) {
    var className = _className(cid);
    QrSlips.printSheet(items, function (item) {
      return cardHtml(item, className, QrSlips.qrSvg(item.url));
    });
  }

  /* ── Make and Print ────────────────────────────────────────── */

  /* The list, as it is after a press: each made card in place of the
     student's old one. No code goes into it. */
  function _putMade(st, results) {
    var cards = (st.cards || []).slice();
    var now = new Date().toISOString();
    results.forEach(function (r) {
      if (!r || r.result !== 'made' || !r.card_id) return;
      var card = {
        id: r.card_id,
        enrollment_id: r.enrollment_id,
        created_at: now,
        printed_at: null,
        last_opened_at: null,
        locked_at: null,
        wrong_tries: 0,
        wrong_tries_7d: 0,
        works_until: r.works_until || null,
        needs_new: false,
      };
      if (Number(r.seq) > 0) card.seq = Number(r.seq);
      var at = -1;
      cards.forEach(function (c, i) {
        if (c && c.enrollment_id === r.enrollment_id) at = i;
      });
      if (at >= 0) cards[at] = card;
      else cards.push(card);
    });
    st.cards = cards;
  }

  /* One press: make a card for each student Make and Print is for, then
     print them. A second press while it is out is the first. */
  function makeAndPrint(cid) {
    var st = _st(cid);
    if (st.making) return st.making;
    var students = _roster(cid);
    var byStudent = _byStudent(st.cards);
    var asked = _toMake(students, byStudent).map(function (s) {
      var c = byStudent[s.id];
      return { enrollment_id: s.id, replaces: c ? c.id : null };
    });
    if (!asked.length) return Promise.resolve(0);
    // A new press lets go of the last one's codes.
    _drop();
    var gen = _watchScreen(cid);
    st.msg = 'Making cards…';
    st.making = makeStudentCards(cid, asked).then(function (res) {
      st.making = null;
      var results = res && res.data && Array.isArray(res.data.results) ? res.data.results : null;
      if (!_stillAsking(cid, gen)) {
        // Late: the screen that asked has gone. Nothing is drawn or printed, and the codes go with this
        // answer. Any card that was made shows Not Printed the next time the list is read.
        st.msg = '';
        st.at = 0;
        return 0;
      }
      if (!results) {
        st.msg = 'Could not make the cards. Check the connection and try again.';
        _unwatch();
        _rerender();
        return 0;
      }
      _putMade(st, results);
      st.failed = false;
      // A student another tab changed, or one no longer in the class: the list is read again.
      if (
        results.some(function (r) {
          return !r || r.result !== 'made';
        })
      ) {
        st.at = 0;
      }
      var items = cardItems(students, results, null, _demo());
      if (!items.length) {
        st.msg = 'Could not make the cards. Check the connection and try again.';
        _unwatch();
        _rerender();
        return 0;
      }
      st.msg = '';
      _held = {
        cid: cid,
        items: items,
        count: items.length,
        timer: setTimeout(function () {
          _drop();
          _unwatch();
          _rerender();
        }, HOLD_MS),
      };
      _print(cid, items);
      var ids = items.map(function (item) {
        return item.id;
      });
      markStudentCardsPrinted(cid, ids).then(function (out) {
        var at = out && out.data && out.data.printed_at;
        if (!at) return;
        (st.cards || []).forEach(function (c) {
          if (ids.indexOf(c.id) >= 0) c.printed_at = at;
        });
        _rerender();
      });
      _rerender();
      return items.length;
    });
    _rerender();
    return st.making;
  }

  // Print the held codes again. Returns how many were printed.
  function printAgain(cid) {
    _check();
    if (!_held || _held.cid !== cid) return 0;
    _print(cid, _held.items);
    return _held.count;
  }

  /* ── The list ──────────────────────────────────────────────── */

  function _today(cid) {
    return typeof courseToday === 'function' ? courseToday(cid) : new Date().toISOString().slice(0, 10);
  }

  function _cardText(card) {
    if (!card) return 'No Card Yet';
    var made = card.created_at ? 'Made ' + _fmtDay(card.created_at) : '';
    var seq = Number(card.seq) > 0 ? 'Card ' + Number(card.seq) : '';
    return [seq, made].filter(Boolean).join(' · ');
  }

  function _status(cid, card) {
    if (!card) return '';
    if (card.needs_new === true) return 'Needs a New Card';
    if (card.works_until && String(card.works_until).slice(0, 10) < _today(cid)) return 'Past Its Last Day';
    if (card.locked_at) return 'Locked';
    if (card.last_opened_at) return 'Last Opened ' + _fmtDay(card.last_opened_at);
    if (card.printed_at) return 'Printed ' + _fmtDay(card.printed_at);
    return 'Not Printed';
  }

  function _rowHtml(cid, st, card) {
    var status = _status(cid, card);
    return (
      '<tr class="sc-row' +
      (card ? '' : ' sc-none') +
      '"><th scope="row" class="sc-name">' +
      esc(_name(st)) +
      '</th><td class="sc-which">' +
      esc(_cardText(card)) +
      '</td><td class="sc-status">' +
      (status === 'Locked' ? '<span class="sc-lock">Locked</span>' : esc(status)) +
      '</td></tr>'
    );
  }

  function _heldLine(n) {
    return (
      (n === 1 ? '1 card went' : n + ' cards went') +
      ' to the printer. Print Again works until you leave this screen. After that, printing makes new codes.'
    );
  }

  // The Student Cards card for a class whose student page is on.
  function render(cid) {
    var st = _st(cid);
    // Another class's card is drawn: the codes held for this screen's class go.
    if (_watch && _watch.cid !== cid) _left();
    _readIfShown(cid);
    var students = _roster(cid);
    var byStudent = _byStudent(st.cards);
    var known = st.cards !== null;
    var n = known ? _toMake(students, byStudent).length : 0;
    var held = _held && _held.cid === cid && !st.making ? _held : null;
    var failed = st.failed && !st.loading;
    var note = st.msg
      ? st.msg
      : held
        ? _heldLine(held.count)
        : failed
          ? 'Could not load the cards. Check the connection and try again.'
          : !known
            ? 'Loading cards…'
            : !students.length
              ? 'No students to make cards for.'
              : '';
    return (
      '<div class="cm-section sc-card" data-cid="' +
      esc(cid) +
      '">' +
      '<div class="sc-head"><div class="sc-titles"><h2 class="cm-grade-title">Student Cards</h2>' +
      '<div class="cm-hint">' +
      esc('One card for each student. They scan it, or type its code, to open their page.') +
      '</div></div>' +
      '<div class="sc-actions">' +
      (failed ? '<button type="button" class="cm-action-btn" data-action="spCardsRetry">Try Again</button>' : '') +
      (held ? '<button type="button" class="cm-action-btn" data-action="spCardsPrintAgain">Print Again</button>' : '') +
      (known && n
        ? '<button type="button" class="btn btn-primary" data-action="spCardsMake"' +
          (st.making ? ' disabled' : '') +
          '>' +
          esc('Make and Print ' + n + (n === 1 ? ' Card' : ' Cards')) +
          '</button>'
        : '') +
      '</div></div>' +
      (note ? '<div class="cm-hint sc-note" role="status">' + esc(note) + '</div>' : '') +
      (known && students.length
        ? '<table class="sc-table"><thead><tr><th scope="col">Student</th><th scope="col">Card</th>' +
          '<th scope="col">Status</th></tr></thead><tbody>' +
          students
            .map(function (s) {
              return _rowHtml(cid, s, byStudent[s.id]);
            })
            .join('') +
          '</tbody></table>'
        : '') +
      '</div>'
    );
  }

  // True when the click was one of this card's.
  function handleAction(action, el) {
    var box = el && el.closest ? el.closest('[data-cid]') : null;
    var cid = box ? box.dataset.cid : null;
    if (action === 'spCardsMake') {
      if (cid) makeAndPrint(cid);
      return true;
    }
    if (action === 'spCardsPrintAgain') {
      if (cid) printAgain(cid);
      return true;
    }
    if (action === 'spCardsRetry') {
      if (cid) {
        // At once: it does not wait for the list to be a minute old.
        load(cid);
        _rerender();
      }
      return true;
    }
    return false;
  }

  // True while codes are held for Print Again (tests).
  function _holding(cid) {
    return !!_held && (!cid || _held.cid === cid);
  }

  // Forget every class's cards and any held codes (tests). Signing out leaves the app, and with it these.
  function _reset() {
    _left();
    _state = {};
  }

  return {
    render: render,
    handleAction: handleAction,
    load: load,
    makeAndPrint: makeAndPrint,
    printAgain: printAgain,
    cardItems: cardItems,
    cardHtml: cardHtml,
    cardUrl: cardUrl,
    _holding: _holding,
    _reset: _reset,
  };
})();
if (typeof window !== 'undefined') window.StudentCards = StudentCards;
