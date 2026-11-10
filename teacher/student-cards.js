/* Student cards: the list in Class Settings › Student Page, and the printed
   card (docs/plans/student-page-build-plan.md, S0-W1; DECISIONS, "Student
   cards").

   One card for each student for the course. Its code opens the student's
   page: scanned from the QR, or typed (board "Student: Scan or Type Your
   Card"). This is the bare list S0-W1 asks for, so a real card exists:

   - Make Cards: a card for every student who has none. A student who has
     one keeps it.
   - The list: each student's code, whether the card has been printed, and
     whether it is locked.
   - Print All: every card, eight to a letter page, on the sheet the
     questionnaire slips print on (QrSlips.printSheet); the cards are then
     marked printed.

   S3 builds the rest on top of it (filters, Print N New Cards, the print
   preview, Cards Work Until, Unlock, Reissue).

   The cards come from shared/data.js (listStudentCards, issueStudentCards,
   markStudentCardsPrinted): the server's for a signed-in teacher, made on
   this device in Demo Mode. A signed-in teacher's are held here, in
   memory, only while the app is open: a card's code and password are
   never saved on the device. And they are read only when this list is on
   the page: Class Settings builds every tab's panel each time it draws,
   so render() reads nothing itself. It looks, a moment after the draw,
   for its own card on the page (_readIfShown), and reads then.

   teacher/cm-student-page.js draws render(cid) under Return Grades, only
   for a class whose student page is on, and hands over the spCards*
   actions.

   cardItems and cardHtml are pure and exposed for tests. */
var StudentCards = (function () {
  'use strict';

  var STALE_MS = 60000; // the list is read again when it is drawn after this long
  var _state = {}; // cid → { cards, at, loading, failed, msg }

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
    var t = new Date(iso);
    return isNaN(t) ? '' : t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function _name(st) {
    var first = (st.preferred || st.firstName || '').trim();
    return (first + ' ' + (st.lastName || '')).trim();
  }

  function _roster(cid) {
    return sortStudents(getStudents(cid), 'lastName');
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

  // True when this class's Student Cards card is on the page now.
  function _onPage(cid) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false;
    var el = document.querySelector('.sc-card');
    return !!el && !!el.dataset && el.dataset.cid === cid;
  }

  /* After a draw: if the card is on the page (the Student Page tab is the
     open one, for this class) and its cards have not been read, or were
     read a minute or more ago, read them. Never in a loop, whether the
     last read worked or not: a failed one waits for Try Again. */
  function _readIfShown(cid) {
    var st = _st(cid);
    if (st.looking || st.loading) return;
    if (st.at && (st.failed || Date.now() - st.at <= STALE_MS)) return;
    st.looking = true;
    setTimeout(function () {
      st.looking = false;
      if (_onPage(cid) && !st.loading) load(cid);
    }, 0);
  }

  function _byStudent(cards) {
    var out = {};
    (cards || []).forEach(function (c) {
      if (c && c.enrollment_id) out[c.enrollment_id] = c;
    });
    return out;
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
    return base.replace(/\/$/, '') + '/s/#demo-card' + (card.check === 'password' ? '-password' : '');
  }

  /* One item to print for each student who has a card, A to Z by last
     name: { id, name, code, url, password }. */
  function cardItems(students, cards, origin, demo) {
    var byStudent = _byStudent(cards);
    return (students || [])
      .filter(function (st) {
        return st && byStudent[st.id] && byStudent[st.id].code;
      })
      .map(function (st) {
        var card = byStudent[st.id];
        return {
          id: card.id,
          name: _name(st),
          sortName: ((st.lastName || '') + ' ' + (st.preferred || st.firstName || '')).toLowerCase(),
          code: card.code,
          url: cardUrl(card, origin, demo),
          password: card.check === 'password' && card.password ? String(card.password) : '',
        };
      })
      .sort(function (a, b) {
        return a.sortName.localeCompare(b.sortName);
      });
  }

  /* What goes inside one card's cell on the sheet: the student, the class,
     the QR, and the code to type, with the card's password when the student
     has no birthday or student number on file. The cell and its words are
     the slip's (teacher/qr-slips.css). */
  // html-safe: name, class, address, code and password all esc()'d; svg is vendor qrcode's own rect markup
  function cardHtml(item, className, svg) {
    return (
      '<div class="qs-head"><div class="qs-who"><div class="qs-name">' +
      esc(item.name) +
      '</div><div class="qs-class">' +
      esc(className) +
      '</div></div><div class="qs-what"><div class="qs-title">Student Card</div></div></div>' +
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

  /* Print every card in the class, then mark them printed. Returns how many
     were printed. */
  function printAll(cid) {
    var st = _st(cid);
    var items = cardItems(_roster(cid), st.cards, null, _demo());
    if (!items.length) return 0;
    var className = _className(cid);
    QrSlips.printSheet(items, function (item) {
      return cardHtml(item, className, QrSlips.qrSvg(item.url));
    });
    var ids = items.map(function (item) {
      return item.id;
    });
    markStudentCardsPrinted(cid, ids).then(function (res) {
      var at = res && res.data && res.data.printed_at;
      if (!at) return;
      (st.cards || []).forEach(function (c) {
        if (ids.indexOf(c.id) >= 0) c.printed_at = at;
      });
      _rerender();
    });
    return items.length;
  }

  /* ── Making cards ──────────────────────────────────────────── */

  // One press makes one request: a second press while it is out is the first.
  function make(cid) {
    var st = _st(cid);
    if (st.making) return st.making;
    st.msg = 'Making cards…';
    st.making = issueStudentCards(cid).then(function (res) {
      st.making = null;
      var out = res && res.data;
      if (!out) {
        st.msg = 'Could not make the cards. Check the connection and try again.';
        _rerender();
        return;
      }
      st.msg = '';
      // The answer is every card in the class, the new ones among them.
      st.cards = out.cards;
      st.at = Date.now();
      st.failed = false;
      _rerender();
    });
    _rerender();
    return st.making;
  }

  /* ── The list ──────────────────────────────────────────────── */

  function _status(card) {
    if (!card) return '';
    return card.printed_at ? 'Printed ' + _fmtDay(card.printed_at) : 'Not Printed';
  }

  function _rowHtml(st, card) {
    return (
      '<tr class="sc-row' +
      (card ? '' : ' sc-none') +
      '"><th scope="row" class="sc-name">' +
      esc(_name(st)) +
      '</th><td class="sc-code">' +
      (card ? esc(card.code) : 'No Card Yet') +
      '</td><td class="sc-status">' +
      esc(_status(card)) +
      (card && card.locked_at ? '<span class="sc-lock">Locked</span>' : '') +
      '</td></tr>'
    );
  }

  // The Student Cards card for a class whose student page is on.
  function render(cid) {
    var st = _st(cid);
    _readIfShown(cid);
    var students = _roster(cid);
    var byStudent = _byStudent(st.cards);
    var known = st.cards !== null;
    var without = students.filter(function (s) {
      return !byStudent[s.id];
    }).length;
    var withCard = students.length - without;
    var failed = st.failed && !st.loading;
    var note = st.msg
      ? st.msg
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
      (known && without
        ? '<button type="button" class="cm-action-btn" data-action="spCardsMake"' +
          (st.making ? ' disabled' : '') +
          '>Make Cards</button>'
        : '') +
      (known && withCard
        ? '<button type="button" class="btn btn-primary" data-action="spCardsPrint">Print All</button>'
        : '') +
      '</div></div>' +
      (note ? '<div class="cm-hint sc-note" role="status">' + esc(note) + '</div>' : '') +
      (known && students.length
        ? '<table class="sc-table"><thead><tr><th scope="col">Student</th><th scope="col">Card Code</th>' +
          '<th scope="col">Status</th></tr></thead><tbody>' +
          students
            .map(function (s) {
              return _rowHtml(s, byStudent[s.id]);
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
      if (cid) make(cid);
      return true;
    }
    if (action === 'spCardsPrint') {
      if (cid) printAll(cid);
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

  // Forget every class's cards (tests). Signing out leaves the app, and with it these.
  function _reset() {
    _state = {};
  }

  return {
    render: render,
    handleAction: handleAction,
    load: load,
    make: make,
    printAll: printAll,
    cardItems: cardItems,
    cardHtml: cardHtml,
    cardUrl: cardUrl,
    _reset: _reset,
  };
})();
if (typeof window !== 'undefined') window.StudentCards = StudentCards;
