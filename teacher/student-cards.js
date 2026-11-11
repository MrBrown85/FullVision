/* Student cards: the list in Class Settings › Student Page, and the printed
   card (docs/plans/student-page-build-plan.md, S0-W1, S3-W1 and S3-F2;
   DECISIONS, "Student cards" and "Card codes the database cannot read").

   One card for each student for the course. Its code opens the student's
   page: scanned from the QR, or typed. The database cannot read a card's
   code, so neither can this screen: the list shows no code, ever. A lost
   card is replaced, never shown again.

   - The list: Student, Card ("Card 2 · Made Nov 12", or No Card Yet) and
     Status (Not Printed, Printed Nov 12, Last Opened Nov 14, Locked, Needs
     a New Card, Past Its Last Day), with Unlock and Print New Card on a
     student's row.
   - Make and Print N Cards: N is the students with no card plus those
     whose card was never printed and never opened. One press makes the
     cards (a new card replaces a never-printed one) and opens the
     browser's print dialog. A code exists only in that moment, so there is
     no making without printing and no preview.
   - Print New Card (one student): stops the student's card and prints a
     new one. For a card that was printed or opened it asks first; a card
     never printed and never opened is replaced without asking, since no
     student can be holding it.
   - New Codes for This Class: asks first, then stops every student's card
     and prints new ones, and makes a first card for a student with none.
     One request for the class, or one for each 250 students (the most the
     function takes). If some students keep their old card, a line names
     them.
   - Unlock, Unlock All: clear a card's lock (five wrong tries in a row, or
     15 in 7 days). Ordinary writes, through the outbox.
   - Print Again: the codes of the last press, held in `_held` below and
     nowhere else, until the teacher leaves this screen (Class Settings
     closes, another tab or class is shown, the teacher signs out, the tab
     closes) or ten minutes pass. After that, printing makes new codes.

   - Cards Work Until: the last day the class's cards open, the class's
     last reporting date until the teacher picks another
     (set_cards_work_until, through the outbox).
   - Filters: All, Not Printed, Locked, Never Opened, each with its count.

   The cards come from shared/data.js (listStudentCards, makeStudentCards,
   markStudentCardsPrinted, unlockStudentCard, unlockAllStudentCards): the
   server's for a signed-in teacher, made on this device in Demo Mode.
   They are read only when this list is on the page: Class Settings builds
   every tab's panel each time it draws, so render() reads nothing itself.
   It looks, a moment after the draw, for its own card on the page
   (_readIfShown), and reads then. After any answer that is not a clean
   success the list is read again, and the buttons stay off until that
   read lands.

   An answer is used only by the screen that asked. While cards are being
   made, a question is up, or codes are held, this file watches for its
   card leaving the page (_watch). If it leaves, even for a moment, a late
   answer draws nothing and prints nothing, a Yes to a question makes
   nothing, and held codes are let go.

   teacher/cm-student-page.js draws render(cid) under Return Grades, only
   for a class whose student page is on, and hands over the spCards*
   actions.

   cardItems and cardHtml are pure and exposed for tests. */
var StudentCards = (function () {
  'use strict';

  var STALE_MS = 60000; // the list is read again when it is drawn after this long
  var HOLD_MS = 10 * 60 * 1000; // Print Again works this long at most
  var BATCH = 250; // the most students teacher-cards takes in one request
  /* cid → { cards, at, loading, looking, making, failed, msg, replaced,
     reads, landed, pressed, again }.

     Reads are numbered: `reads` is the number of the last read begun,
     `landed` the last that came back with a list, `pressed` the number of
     the last read begun before the last press finished. An answer to a read
     numbered `pressed` or lower is older than what the press did, so it is
     dropped and the list is read again. `again`: a read was asked for
     while one was out; it starts when that one lands.

     replaced: after Print New Card or New Codes for This Class, what became
     of each student whose card was named: { cards: enrollment id → { id,
     seq } of the card named, after: the read number that must land before
     anything is said (0: the answer was clean, and the list is already
     right), single: the first name when one student was asked, failed:
     true when nothing was printed }. Each student is then decided from the
     list alone: the card named still there is "still has their old card";
     an unprinted card numbered one more than it is "old card stopped, new
     one not printed". A student is dropped once neither is true. */
  var _state = {};

  /* The codes of the last press, for Print Again: { cid, items, count,
     until, timer }. Only here, in this variable: never saved, logged or put
     on the page outside the print dialog. `until` is the clock time they
     go; the timer only hurries that along, since a closed lid, a tab in the
     background or an open print dialog can hold a timer back for hours.
     Every use looks at the clock (_heldFor). */
  var _held = null;
  /* The screen that asked: { cid, gen, observer, interval }. gen changes
     whenever that screen goes away. */
  var _watch = null;
  var _gen = 0;

  function _st(cid) {
    return (
      _state[cid] ||
      (_state[cid] = {
        cards: null,
        at: 0,
        loading: null,
        looking: false,
        making: null,
        failed: false,
        msg: '',
        replaced: null,
        reads: 0,
        landed: 0,
        pressed: 0,
        again: false,
        filter: 'all',
      })
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

  function _first(st) {
    return (st.preferred || st.firstName || '').trim();
  }

  function _name(st) {
    return (_first(st) + ' ' + (st.lastName || '')).trim();
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

  // The held codes for this class, if their ten minutes have not run out by the clock; else none, and they go.
  function _heldFor(cid) {
    if (_held && Date.now() >= _held.until) _drop();
    return _held && _held.cid === cid ? _held : null;
  }

  // The screen that asked has gone: nothing it asked for is drawn, printed or made, and its codes go.
  function _left() {
    _gen += 1;
    _drop();
    _unwatch();
  }

  function _check() {
    if (_held && Date.now() >= _held.until) {
      _drop();
      if (_watch && !_st(_watch.cid).making) _unwatch();
      _rerender();
    }
    if (_watch && !_shown(_watch.cid)) _left();
  }

  /* Start watching the screen for this class (a press, a question, or
     codes held). Every change to the page is checked, so the card leaving
     the page is seen even if it comes straight back; a timer checks too,
     where the page cannot be watched. */
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

  // True when the answer to a press or a question made under `gen` may still be used.
  function _stillAsking(cid, gen) {
    _check();
    return !!_watch && _watch.cid === cid && _watch.gen === gen && _shown(cid);
  }

  /* ── Reading the cards ─────────────────────────────────────── */

  // Read the class's cards. One read at a time for a class.
  function load(cid) {
    var st = _st(cid);
    if (st.loading) {
      // One read at a time: this one starts when the one out lands, so it begins after whatever asked for it.
      st.again = true;
      return st.loading;
    }
    var mine = ++st.reads;
    st.loading = listStudentCards(cid).then(function (res) {
      st.loading = null;
      // Asked before the last press finished: older than what the press did. Dropped, and read again.
      var stale = mine <= st.pressed;
      if (!stale) {
        st.at = Date.now();
        if (res && Array.isArray(res.data)) {
          st.cards = res.data;
          st.failed = false;
          st.landed = mine;
        } else {
          st.failed = true;
        }
      }
      if (stale || st.again) {
        st.again = false;
        if (_onPage(cid)) load(cid);
        else st.at = 0;
      }
      _rerender();
    });
    return st.loading;
  }

  // A press has finished: any read begun before now is older than what it did.
  function _pressDone(st) {
    st.pressed = st.reads;
  }

  /* After an answer that is not a clean success: read the list again, now
     if it is on the page (its buttons stay off until the read lands), else
     the next time it is drawn. */
  function _readAgain(cid) {
    var st = _st(cid);
    st.at = 0;
    if (_shown(cid)) load(cid);
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
      if (_onPage(cid) && !st.loading && !st.making) {
        load(cid);
        // Drawn again at once: every button that acts on the list is off, visibly, until the read lands.
        _rerender();
      }
    }, 0);
  }

  function _byStudent(cards) {
    var out = {};
    (cards || []).forEach(function (c) {
      if (c && c.enrollment_id) out[c.enrollment_id] = c;
    });
    return out;
  }

  // A card a student may be holding: it was printed (here or anywhere) or opened.
  function _handedOut(card) {
    return !!card && !!(card.printed_at || card.last_opened_at);
  }

  // The students Make and Print is for: no card, or a card never printed and never opened.
  function _toMake(students, byStudent) {
    return students.filter(function (s) {
      return !_handedOut(byStudent[s.id]);
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
    var base = origin || (typeof location !== 'undefined' && location.origin) || 'https://fullvision.ca';
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

  /* ── Making cards: one path for every button ───────────────── */

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

  /* Ask teacher-cards for `asked`, at most BATCH students to a request,
     one request after another. Before each request after the first, the
     screen must still be the one that asked; once one request gets no
     answer, the rest are not sent. Answers every student's result, in the
     order asked: a student whose request was not answered, or not sent, is
     { result: 'unanswered' } (a word of this file's, not the function's). */
  function _askInBatches(cid, asked, gen) {
    var results = [];
    var unanswered = function (items) {
      items.forEach(function (it) {
        results.push({ enrollment_id: it.enrollment_id, result: 'unanswered' });
      });
    };
    var next = function (from) {
      if (from >= asked.length) return Promise.resolve(results);
      if (from > 0 && !_stillAsking(cid, gen)) {
        unanswered(asked.slice(from));
        return Promise.resolve(results);
      }
      var chunk = asked.slice(from, from + BATCH);
      return makeStudentCards(cid, chunk).then(function (res) {
        var got = res && res.data && Array.isArray(res.data.results) ? res.data.results : null;
        if (!got) {
          unanswered(asked.slice(from));
          return results;
        }
        var byStudent = _byStudent(got);
        chunk.forEach(function (it) {
          results.push(byStudent[it.enrollment_id] || { enrollment_id: it.enrollment_id, result: 'unanswered' });
        });
        return next(from + BATCH);
      });
    };
    return next(0);
  }

  /* One press: make a card for each of `asked` ([{ enrollment_id,
     replaces }]), then print the ones whose code came back. `replacing` is
     true for Print New Card and New Codes for This Class: a student left
     with the card they had is named afterwards. Answers how many cards
     were printed. */
  function _makeAndPrint(cid, asked, replacing) {
    var st = _st(cid);
    if (st.making) return st.making;
    if (!asked.length) return Promise.resolve(0);
    var students = _roster(cid);
    // A new press lets go of the last one's codes. A student an earlier press left without a working new
    // card stays named until the list shows otherwise.
    _drop();
    var gen = _watchScreen(cid);
    if (replacing) {
      var now = _byStudent(st.cards);
      var named = st.replaced ? st.replaced.cards : {};
      asked.forEach(function (it) {
        if (!it.replaces) return;
        var c = now[it.enrollment_id];
        named[it.enrollment_id] = {
          id: it.replaces,
          seq: c && c.id === it.replaces && Number(c.seq) > 0 ? Number(c.seq) : null,
        };
      });
      var one =
        asked.length === 1
          ? _roster(cid).filter(function (s) {
              return s.id === asked[0].enrollment_id;
            })[0]
          : null;
      st.replaced = {
        cards: named,
        after: Infinity, // nothing is said while the press is out
        single: one ? _first(one) || _name(one) : null,
        count: asked.length,
        failed: false,
      };
    }
    st.msg = 'Making cards…';
    var couldNot =
      (asked.length === 1 ? 'Could not make the card.' : 'Could not make the cards.') +
      ' Check the connection and try again.';
    st.making = _askInBatches(cid, asked, gen).then(function (results) {
      st.making = null;
      // Any read begun before now is older than this press: its answer is dropped and the list read again.
      _pressDone(st);
      var any = results.some(function (r) {
        return r.result !== 'unanswered';
      });
      if (any) _putMade(st, results);
      // Anything short of every card made with its code (a refusal, no connection, another tab's change,
      // a lost reply not made good): the list this screen holds may be wrong, so it is read again and the
      // next press names the right cards. What became of each student whose card was named is said only
      // once that read has landed: the read that begins next is numbered one more than the last begun.
      var clean = results.every(function (r) {
        return r && r.result === 'made' && r.code;
      });
      if (st.replaced) st.replaced.after = clean ? 0 : st.reads + 1;
      if (!_stillAsking(cid, gen)) {
        // Late: the screen that asked has gone. Nothing is drawn or printed, and the codes go with this
        // answer. The screen there now is drawn as it is, and if it is this class's list, read again:
        // any card that was made shows Not Printed.
        st.msg = '';
        if (st.replaced) st.replaced.after = st.reads + 1;
        _readAgain(cid);
        _rerender();
        return 0;
      }
      var items = any ? cardItems(students, results, null, _demo()) : [];
      if (!items.length) {
        // Replacing: whether the old card is still live is for the list read again to say.
        st.msg = replacing ? '' : couldNot;
        if (st.replaced) st.replaced.failed = true;
        _unwatch();
        _readAgain(cid);
        _rerender();
        return 0;
      }
      st.failed = false;
      st.msg = '';
      _held = {
        cid: cid,
        items: items,
        count: items.length,
        until: Date.now() + HOLD_MS,
        // The timer, when it does fire on time, ends them then.
        timer: setTimeout(function () {
          if (_held) _held.until = 0;
          _check();
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
        if (_shown(cid)) _rerender();
      });
      if (!clean) _readAgain(cid);
      _rerender();
      return items.length;
    });
    _rerender();
    return st.making;
  }

  /* Make and Print N Cards: a card for each student with none, and in
     place of each card never printed and never opened. A second press
     while it is out is the first. */
  function makeAndPrint(cid) {
    var st = _st(cid);
    if (st.making) return st.making;
    // Not while the list is being read: the press would name the cards of a list about to change.
    if (st.loading) return Promise.resolve(0);
    var byStudent = _byStudent(st.cards);
    var asked = _toMake(_roster(cid), byStudent).map(function (s) {
      var c = byStudent[s.id];
      return { enrollment_id: s.id, replaces: c ? c.id : null };
    });
    return _makeAndPrint(cid, asked, false);
  }

  /* Put a question up over the screen. A Yes makes cards only if the
     screen that asked is still there and nothing else is being made; a Yes
     while the list is being read waits for the read to land, so the press
     finishes after it and no older answer lands on top of it. Cancel
     changes nothing. */
  function _ask(cid, q, then) {
    var gen = _watchScreen(cid);
    var st = _st(cid);
    var yes = function () {
      if (!_stillAsking(cid, gen) || st.making) return;
      if (st.loading) {
        st.loading.then(yes);
        return;
      }
      then();
    };
    showConfirm(q.title, q.message, q.ok, 'danger', yes);
  }

  // The question Print New Card asks (design section 4).
  function newCardQuestion(first) {
    return {
      title: 'Print a New Card for ' + first + '?',
      message:
        'The card ' +
        first +
        ' has now stops working as soon as the new one is made. Everything ' +
        first +
        ' has sent stays.',
      ok: 'Print New Card',
    };
  }

  // The question New Codes for This Class asks (design section 4): `stop` cards stop, `first` students get their first.
  function newCodesQuestion(stop, first) {
    var all = stop + first;
    return {
      title: all === 1 ? 'New Code for 1 Student?' : 'New Codes for All ' + all + ' Students?',
      message:
        (stop === 1 ? '1 card stops working now. ' : stop + ' cards stop working now. ') +
        (first
          ? first === 1
            ? '1 student gets their first card. '
            : first + ' students get their first card. '
          : '') +
        "Print the new cards and hand them out. Students can't open their page until they have their new card. " +
        'Everything they have sent stays.',
      ok: all === 1 ? 'Make 1 New Card' : 'Make ' + all + ' New Cards',
    };
  }

  /* Print New Card for one student. Answers a promise of how many were
     printed, or null when a question went up instead (its Yes makes it). */
  function printNewCard(cid, enrollmentId) {
    var st = _st(cid);
    if (st.making || st.loading || st.cards === null) return Promise.resolve(0);
    var student = _roster(cid).filter(function (s) {
      return s.id === enrollmentId;
    })[0];
    if (!student) return Promise.resolve(0);
    var card = _byStudent(st.cards)[enrollmentId] || null;
    var asked = [{ enrollment_id: enrollmentId, replaces: card ? card.id : null }];
    if (!_handedOut(card)) return _makeAndPrint(cid, asked, true);
    _ask(cid, newCardQuestion(_first(student) || _name(student)), function () {
      _makeAndPrint(cid, asked, true);
    });
    return Promise.resolve(null);
  }

  /* New Codes for This Class: asks first, then a new card for every
     student, each in place of the card the list shows for them. */
  function newCodes(cid) {
    var st = _st(cid);
    if (st.making || st.loading || st.cards === null) return;
    var byStudent = _byStudent(st.cards);
    var students = _roster(cid);
    if (!students.length) return;
    var asked = students.map(function (s) {
      var c = byStudent[s.id];
      return { enrollment_id: s.id, replaces: c ? c.id : null };
    });
    var stop = asked.filter(function (it) {
      return !!it.replaces;
    }).length;
    _ask(cid, newCodesQuestion(stop, asked.length - stop), function () {
      _makeAndPrint(cid, asked, true);
    });
  }

  // Print the held codes again. Returns how many were printed.
  function printAgain(cid) {
    _check();
    var held = _heldFor(cid);
    if (!held) return 0;
    _print(cid, held.items);
    return held.count;
  }

  /* ── Unlock ────────────────────────────────────────────────── */

  function _unlocked(card) {
    card.locked_at = null;
    card.wrong_tries = 0;
    card.wrong_tries_7d = 0;
  }

  // Unlock one card. Answers how many were unlocked here.
  function unlock(cid, cardId) {
    var st = _st(cid);
    if (st.making || st.loading) return 0;
    var card = (st.cards || []).filter(function (c) {
      return c && c.id === cardId;
    })[0];
    if (!card || !card.locked_at) return 0;
    _pressDone(st);
    unlockStudentCard(cid, cardId, function () {
      // Refused for good: the list shows what the server has.
      _readAgain(cid);
    }).then(function (out) {
      if (!out || !out.data) return;
      _unlocked(card);
      if (_shown(cid)) _rerender();
    });
    return 1;
  }

  // Unlock every locked card in the class. Answers how many the list showed locked.
  function unlockAll(cid) {
    var st = _st(cid);
    if (st.making || st.loading) return 0;
    var locked = (st.cards || []).filter(function (c) {
      return c && c.locked_at;
    });
    if (!locked.length) return 0;
    _pressDone(st);
    unlockAllStudentCards(cid, function () {
      _readAgain(cid);
    }).then(function (out) {
      if (!out || !out.data) return;
      locked.forEach(_unlocked);
      if (_shown(cid)) _rerender();
    });
    return locked.length;
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

  function _rowHtml(cid, st, card, off) {
    var status = _status(cid, card);
    var name = _name(st);
    var dis = off ? ' disabled' : '';
    return (
      '<tr class="sc-row' +
      (card ? '' : ' sc-none') +
      '"><th scope="row" class="sc-name">' +
      esc(name) +
      '</th><td class="sc-which">' +
      esc(_cardText(card)) +
      '</td><td class="sc-status">' +
      (status === 'Locked' ? '<span class="sc-lock">Locked</span>' : esc(status)) +
      '</td><td class="sc-do">' +
      (card && card.locked_at
        ? '<button type="button" class="cm-action-btn sc-row-btn" data-action="spCardsUnlock" data-card="' +
          esc(card.id) +
          '" aria-label="' +
          esc('Unlock ' + name + '’s Card') +
          '"' +
          dis +
          '>Unlock</button>'
        : '') +
      (card
        ? '<button type="button" class="cm-action-btn sc-row-btn" data-action="spCardsNewCard" data-student="' +
          esc(st.id) +
          '" aria-label="' +
          esc('Print a New Card for ' + name) +
          '"' +
          dis +
          '>Print New Card</button>'
        : '') +
      '</td></tr>'
    );
  }

  /* ── Filters ───────────────────────────────────────────────── */

  /* Which students each filter shows, and what it says when it shows none.
     Not Printed is the students Make and Print is for (no card, or a card
     never printed and never opened); Never Opened is a card that was
     printed and has not been opened. */
  var FILTERS = [
    { value: 'all', label: 'All', empty: '' },
    {
      value: 'not_printed',
      label: 'Not Printed',
      empty: 'Every student has a printed card.',
      shows: function (card) {
        return !_handedOut(card);
      },
    },
    {
      value: 'locked',
      label: 'Locked',
      empty: 'No cards are locked.',
      shows: function (card) {
        return !!card && !!card.locked_at;
      },
    },
    {
      value: 'never_opened',
      label: 'Never Opened',
      empty: 'Every student with a printed card has opened it.',
      shows: function (card) {
        return !!card && !!card.printed_at && !card.last_opened_at;
      },
    },
  ];

  function _filter(st) {
    return (
      FILTERS.filter(function (f) {
        return f.value === st.filter;
      })[0] || FILTERS[0]
    );
  }

  function _filterHtml(st, students, byStudent) {
    var on = _filter(st).value;
    return (
      '<div class="seg cm-seg sc-filters" role="radiogroup" aria-label="Show">' +
      FILTERS.map(function (f) {
        var n = f.shows
          ? students.filter(function (s) {
              return f.shows(byStudent[s.id]);
            }).length
          : students.length;
        var chosen = f.value === on;
        return (
          '<button type="button" class="seg-btn cm-seg-btn' +
          (chosen ? ' active' : '') +
          '" role="radio" aria-checked="' +
          chosen +
          '" data-action="spCardsFilter" data-value="' +
          f.value +
          '">' +
          esc(f.label) +
          ' <span class="sc-count">' +
          n +
          '</span></button>'
        );
      }).join('') +
      '</div>'
    );
  }

  /* ── Cards Work Until ──────────────────────────────────────── */

  function _untilHtml(cid, off) {
    var until = getCardsWorkUntil(cid);
    var hints = ['A card stops opening after this day.'];
    if (until.date && until.date < _today(cid)) hints.push('That day has passed, so no card opens now.');
    else if (!until.chosen) {
      hints.push(
        until.reporting
          ? "It's the class's last reporting date until you choose another day."
          : "It's June 30 until you choose another day, since the class has no reporting date ahead.",
      );
    }
    return (
      '<div class="sc-until">' +
      '<label class="sp-row-title" for="sc-until-date">Cards Work Until</label>' +
      '<div class="sc-until-row"><input type="date" class="cm-input sc-until-date" id="sc-until-date"' +
      ' data-action-change="spCardsWorkUntil" aria-describedby="sc-until-hint" value="' +
      esc(until.date || '') +
      '"' +
      (off ? ' disabled' : '') +
      '>' +
      (until.chosen
        ? '<button type="button" class="cm-action-btn sc-row-btn" data-action="spCardsWorkUntilDefault"' +
          (off ? ' disabled' : '') +
          '>' +
          esc(until.reporting ? 'Use Last Reporting Date' : 'Use June 30') +
          '</button>'
        : '') +
      '</div>' +
      '<div class="cm-hint" id="sc-until-hint">' +
      esc(hints.join(' ')) +
      '</div></div>'
    );
  }

  /* Set the class's Cards Work Until (null: back to the default). The list
     shows the new day on every card at once; if the server refuses it, the
     list is read again and the day goes back to what the server has. */
  function workUntil(cid, date) {
    var st = _st(cid);
    if (st.making || st.loading) return null;
    var now = getCardsWorkUntil(cid);
    if ((now.chosen || null) === (date || null)) return null;
    // A read begun before this change is older than it.
    _pressDone(st);
    var out = null;
    setCardsWorkUntil(cid, date || null, function () {
      _readAgain(cid);
      if (_shown(cid)) _rerender();
    }).then(function (res) {
      if (!res || !res.data) return;
      out = res.data.works_until;
      (st.cards || []).forEach(function (c) {
        c.works_until = out;
      });
      if (_shown(cid)) {
        _rerender();
        _focus('#sc-until-date');
      }
    });
    return true;
  }

  function _focus(selector) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    var el = document.querySelector(selector);
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }

  // True when the change was one of this card's: the Cards Work Until day.
  function handleChange(el) {
    if (!el || !el.dataset || el.dataset.actionChange !== 'spCardsWorkUntil') return false;
    var box = el.closest ? el.closest('[data-cid]') : null;
    var cid = box ? box.dataset.cid : null;
    var value = String(el.value || '');
    if (!cid) return true;
    if (!value) workUntil(cid, null);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) workUntil(cid, value);
    return true;
  }

  function _heldLine(n) {
    return (
      (n === 1 ? '1 card went' : n + ' cards went') +
      ' to the printer. Print Again works until you leave this screen. After that, printing makes new codes.'
    );
  }

  function _stillOldLine(names) {
    return names.length === 1
      ? '1 student still has their old card: ' + names[0] + '. Use Print New Card on their row to try again.'
      : names.length +
          ' students still have their old card: ' +
          names.join(', ') +
          '. Use Print New Card on their rows to try again.';
  }

  // `n` is the number on the Make and Print button.
  function _stoppedLine(names, single, n) {
    var press = 'Press Make and Print ' + n + (n === 1 ? ' Card' : ' Cards');
    if (single && names.length === 1) {
      return single + "'s old card has stopped, but the new one didn't print. " + press + ' to print it.';
    }
    return names.length === 1
      ? "1 student's old card has stopped and the new one didn't print: " + names[0] + '. ' + press + ' to print it.'
      : names.length +
          " students' old cards have stopped and the new ones didn't print: " +
          names.join(', ') +
          '. ' +
          press +
          ' to print them.';
  }

  /* What became of the students whose card the last Print New Card or New
     Codes for This Class named, decided from the list alone (see `replaced`
     at the top): null while the list read after the press has not landed;
     else the lines to show, A to Z. */
  function _replacedLines(st, students, byStudent, n) {
    var r = st.replaced;
    if (!r) return [];
    if (st.making || (r.after && st.landed < r.after)) return null;
    var old = [];
    var stopped = [];
    students.forEach(function (s) {
      var named = r.cards[s.id];
      if (!named) return;
      var c = byStudent[s.id];
      if (c && c.id === named.id) old.push(_name(s));
      else if (c && !_handedOut(c) && (named.seq === null || Number(c.seq) === named.seq + 1)) stopped.push(_name(s));
      else delete r.cards[s.id];
    });
    if (!old.length && !stopped.length) {
      st.replaced = null;
      return [];
    }
    var lines = [];
    // Nothing printed, and the list shows the old card still live.
    if (r.failed && old.length) {
      lines.push(
        (r.count === 1 ? 'Could not make the card.' : 'Could not make the cards.') +
          ' Check the connection and try again.',
      );
    }
    if (old.length) lines.push(_stillOldLine(old));
    if (stopped.length) lines.push(_stoppedLine(stopped, r.count === 1 ? r.single : null, n));
    return lines;
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
    var held = !st.making ? _heldFor(cid) : null;
    var failed = st.failed && !st.loading;
    // Nothing that makes or changes a card while one press is out or the list is being read.
    var off = !!st.making || !!st.loading;
    var handedOut =
      known &&
      students.some(function (s) {
        return _handedOut(byStudent[s.id]);
      });
    var locked = known
      ? students.filter(function (s) {
          return byStudent[s.id] && byStudent[s.id].locked_at;
        }).length
      : 0;
    var replaced = known ? _replacedLines(st, students, byStudent, n) : null;
    var notes = [];
    if (st.msg) notes.push(st.msg);
    else if (held) notes.push(_heldLine(held.count));
    if (replaced) notes = notes.concat(replaced);
    else if (known && !st.making && !failed) notes.push('Checking which cards were made…');
    if (!notes.length) {
      if (failed) notes.push('Could not load the cards. Check the connection and try again.');
      else if (!known) notes.push('Loading cards…');
      else if (!students.length) notes.push('No students to make cards for.');
    }
    var dis = off ? ' disabled' : '';
    var filter = _filter(st);
    var shown = students.filter(function (s) {
      return !filter.shows || filter.shows(byStudent[s.id]);
    });
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
      (locked >= 2
        ? '<button type="button" class="cm-action-btn" data-action="spCardsUnlockAll"' + dis + '>Unlock All</button>'
        : '') +
      (handedOut && students.length
        ? '<button type="button" class="cm-action-btn" data-action="spCardsNewCodes"' +
          dis +
          '>New Codes for This Class</button>'
        : '') +
      (known && n
        ? '<button type="button" class="btn btn-primary" data-action="spCardsMake"' +
          dis +
          '>' +
          esc('Make and Print ' + n + (n === 1 ? ' Card' : ' Cards')) +
          '</button>'
        : '') +
      '</div></div>' +
      (notes.length
        ? '<div class="cm-hint sc-note" role="status">' +
          notes
            .map(function (line) {
              return '<div class="sc-note-line">' + esc(line) + '</div>';
            })
            .join('') +
          '</div>'
        : '') +
      _untilHtml(cid, off) +
      (known && students.length ? _filterHtml(st, students, byStudent) : '') +
      (known && students.length && !shown.length
        ? '<div class="cm-hint sc-empty" role="status">' + esc(filter.empty) + '</div>'
        : '') +
      (known && shown.length
        ? '<table class="sc-table"><thead><tr><th scope="col">Student</th><th scope="col">Card</th>' +
          '<th scope="col">Status</th><th scope="col" class="sc-do" aria-label="Actions"></th></tr></thead><tbody>' +
          shown
            .map(function (s) {
              return _rowHtml(cid, s, byStudent[s.id], off);
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
    var data = (el && el.dataset) || {};
    if (action === 'spCardsMake') {
      if (cid) makeAndPrint(cid);
      return true;
    }
    if (action === 'spCardsPrintAgain') {
      if (cid) printAgain(cid);
      return true;
    }
    if (action === 'spCardsNewCard') {
      if (cid && data.student) printNewCard(cid, data.student);
      return true;
    }
    if (action === 'spCardsNewCodes') {
      if (cid) newCodes(cid);
      return true;
    }
    if (action === 'spCardsUnlock') {
      if (cid && data.card) unlock(cid, data.card);
      return true;
    }
    if (action === 'spCardsUnlockAll') {
      if (cid) unlockAll(cid);
      return true;
    }
    if (action === 'spCardsFilter') {
      if (cid && data.value) {
        _st(cid).filter = data.value;
        _rerender();
        // The redraw makes the chosen filter a new button: the focus goes back to it.
        _focus('.sc-filters [data-value="' + data.value + '"]');
      }
      return true;
    }
    if (action === 'spCardsWorkUntilDefault') {
      if (cid) workUntil(cid, null);
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

  // True while codes are held for Print Again (tests). Looks at the clock, as every use does.
  function _holding(cid) {
    if (_held && Date.now() >= _held.until) _drop();
    return !!_held && (!cid || _held.cid === cid);
  }

  // The page is going (closed, reloaded, or left for another site): the codes go now.
  function _pagehide() {
    _left();
  }
  // The page came back from the browser's Back cache: what is on screen was drawn before it went, with a
  // Print Again whose codes are gone. It is drawn again.
  function _pageshow(e) {
    if (!e || !e.persisted) return;
    _left();
    _rerender();
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', _pagehide);
    window.addEventListener('pageshow', _pageshow);
  }

  // Forget every class's cards and any held codes (tests). Signing out leaves the app, and with it these.
  function _reset() {
    _left();
    _state = {};
  }

  return {
    render: render,
    handleAction: handleAction,
    handleChange: handleChange,
    workUntil: workUntil,
    load: load,
    makeAndPrint: makeAndPrint,
    printNewCard: printNewCard,
    newCodes: newCodes,
    unlock: unlock,
    unlockAll: unlockAll,
    printAgain: printAgain,
    cardItems: cardItems,
    cardHtml: cardHtml,
    cardUrl: cardUrl,
    newCardQuestion: newCardQuestion,
    newCodesQuestion: newCodesQuestion,
    _holding: _holding,
    _reset: _reset,
    _stoppedLine: _stoppedLine,
    _pagehide: _pagehide,
    _pageshow: _pageshow,
    _setBatch: function (n) {
      BATCH = n > 0 ? n : 250;
    },
  };
})();
if (typeof window !== 'undefined') window.StudentCards = StudentCards;
