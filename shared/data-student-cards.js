// @ts-check
/* Student cards: the printed cards that open a student's page (list, make, print, unlock) and Cards Work Until.
   Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

/* ── Student cards (S0-W1, S3-W1; docs/plans/student-page-build-plan.md 1.5) ──
   One card for each student in a class: a printed code that opens the
   student's page. The database cannot read a card's code (DECISIONS,
   ruling 63): it keeps a keyed fingerprint of it, and the code exists only
   in the one reply that made the card.

   A card, as this file hands it out and as it is ever kept:
     { id, enrollment_id, seq, created_at, printed_at, last_opened_at,
       locked_at, wrong_tries, wrong_tries_7d, works_until, check,
       has_password, needs_new }
   Never a code and never a password. `seq` is the card number (Card 2);
   the server's list before the S3-M1 migration has none, and still
   carries the old readable code and password: both are dropped here, as
   they arrive, and so is a code an older build saved in Demo Mode.

   Making cards (makeStudentCards) asks the teacher-cards edge function,
   online, with the teacher's own sign-in, and never through the outbox. Its
   reply's codes and passwords are handed to the caller and go nowhere
   else: not localStorage, sessionStorage, IndexedDB, the outbox, a log or
   any cache. teacher/student-cards.js prints them and holds them for Print
   Again only.

   Only a class whose student page is on has cards (the build switch): for
   any other class each function here answers with no data and calls
   nothing. Each answers a promise of { data, error }. In Demo Mode the
   cards are made and kept on this device (gb-student-cards-<cid>), by the
   same rules, and nothing is sent. */
var _CARD_CODE_LETTERS = 'ABCDEFGHJKMNPQRTUVWXYZ2346789'; // the slip alphabet (shared/questionnaires.js)
var _CARD_FIELDS = [
  'id',
  'enrollment_id',
  'seq',
  'created_at',
  'printed_at',
  'last_opened_at',
  'locked_at',
  'wrong_tries',
  'wrong_tries_7d',
  'works_until',
  'check',
  'has_password',
  'needs_new',
];

function _cardsAnswer(data, error) {
  return Promise.resolve({ data: data == null ? null : data, error: error || null });
}
/* A card with only the fields above: whatever else a reply or an older
   build's copy carries (a code, a password) is left behind. */
function _cardWithoutCode(c) {
  var out = {};
  if (!c || typeof c !== 'object') return null;
  _CARD_FIELDS.forEach(function (k) {
    if (c[k] !== undefined) out[k] = c[k];
  });
  if (out.seq != null && !(Number(out.seq) > 0)) delete out.seq;
  return out;
}
function _demoStudentCards(cid) {
  var kept = _safeParseLS('gb-student-cards-' + cid, []);
  if (!Array.isArray(kept)) return [];
  // A card an older build saved still carries its code and password: kept without them from now on.
  var old = kept.some(function (c) {
    return c && (c.code !== undefined || c.password !== undefined);
  });
  kept = kept.map(_cardWithoutCode).filter(Boolean);
  if (old) _saveDemoStudentCards(cid, kept);
  return kept;
}
function _saveDemoStudentCards(cid, cards) {
  _safeLSSet('gb-student-cards-' + cid, JSON.stringify(cards.map(_cardWithoutCode).filter(Boolean)));
}
/* When the app starts: every class's cards an older build saved on this
   device with their codes and passwords are kept without them, at once,
   not only when that class's list is next read. */
function _dropOldCardCodes() {
  try {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('gb-student-cards-') === 0) keys.push(k);
    }
    keys.forEach(function (k) {
      _demoStudentCards(k.slice('gb-student-cards-'.length));
    });
  } catch (e) {
    /* nothing readable, nothing to drop */
  }
}
_dropOldCardCodes();

/* Cards this browser has sent to the printer: card id → { at, cid }. Ids,
   class ids and times only. Kept on this device (gb-cards-printed-here,
   wiped at sign-out with every gb- key) until the server's list shows the
   card printed, or a list read that began after the note was made no longer
   shows the card (it was replaced).

   A list read from the server is overlaid with these and with every mark
   still waiting in the outbox, so a read never erases a write still on its
   way: a card printed here never shows Not Printed, never counts toward
   Make and Print, and is never replaced without the teacher asking.

   It is kept on the device, not only in this page, for a mark that never
   reaches the server (refused for good, or dropped on its last try after a
   reload): the cards went to the printer, so after a reload they still
   show Printed here, and Print New Card asks before replacing one. Such a
   mark is sent once more, through the outbox, the first time this page
   reads a list that still shows the card Not Printed.

   Every tab of the app shares the one stored copy: each change reads it,
   changes it and writes it back at once (_changePrintedHere), so one
   tab's notes never overwrite another's. */
var _CARDS_PRINTED_KEY = 'gb-cards-printed-here';
var _cardsPrintSending = {}; // card id → true while its mark is on its way from this page
var _cardsPrintResent = {}; // card id → true once its mark has been sent again from this page
// The stored notes, read fresh.
function _printedHere() {
  var kept = _safeParseLS(_CARDS_PRINTED_KEY, {});
  var out = {};
  if (kept && typeof kept === 'object' && !Array.isArray(kept)) {
    Object.keys(kept).forEach(function (id) {
      var e = kept[id];
      if (_isUuid(id) && e && typeof e.at === 'string' && typeof e.cid === 'string') out[id] = { at: e.at, cid: e.cid };
    });
  }
  return out;
}
// Read the stored notes, let `change` change them (it answers true when it did), and write them back at once.
function _changePrintedHere(change) {
  var here = _printedHere();
  if (!change(here)) return;
  if (Object.keys(here).length) {
    _safeLSSet(_CARDS_PRINTED_KEY, JSON.stringify(here));
    return;
  }
  try {
    localStorage.removeItem(_CARDS_PRINTED_KEY);
  } catch (e) {
    /* nothing kept, nothing to remove */
  }
}
// The outbox's waiting entries for one endpoint.
function _queuedCardWrites(endpoint) {
  try {
    var q = JSON.parse(localStorage.getItem('fv-sync-queue-v1') || '{}');
    return (q.entries || []).filter(function (entry) {
      return entry && entry.endpoint === endpoint && entry.payload;
    });
  } catch (err) {
    return []; // an unreadable queue only means nothing is known to be pending
  }
}
function _cardsPrintedQueued() {
  var out = {};
  _queuedCardWrites('mark_student_cards_printed').forEach(function (entry) {
    (entry.payload.p_card_ids || []).forEach(function (id) {
      if (!out[id]) out[id] = entry.created_at || new Date().toISOString();
    });
  });
  return out;
}
// Tests: forget this device's marks and unlocks, as a fresh page on a fresh device would.
function _forgetCardsPrintedHere() {
  _reloadCardsPrintedHere();
  try {
    localStorage.removeItem(_CARDS_PRINTED_KEY);
  } catch (e) {
    /* nothing kept */
  }
}
// Tests: a reload. What the page held goes; what the device keeps stays.
function _reloadCardsPrintedHere() {
  _cardsPrintSending = {};
  _cardsPrintResent = {};
  _cardsUnlockedHere = {};
  _cardsUnlockedAllHere = {};
  _cardsWorkUntilHere = {};
  _cardsWorkUntilServer = {};
}
function _sendCardsPrinted(ids) {
  ids.forEach(function (id) {
    _cardsPrintSending[id] = true;
  });
  return _trackPendingSync(
    Promise.resolve(
      _writeRpc('mark_student_cards_printed', { p_card_ids: ids, p_idempotency_key: _newEntryId() }),
    ).then(function (res) {
      ids.forEach(function (id) {
        delete _cardsPrintSending[id];
      });
      if (res && res.error && !res.error.handledSessionExpired) {
        console.warn('mark_student_cards_printed failed:', res.error);
      }
      return res;
    }),
  );
}
/* `asked` is when the read began (ISO time): a note made after that is
   newer than the list, so the list not showing its card says nothing. */
function _withPendingPrints(cid, cards, asked) {
  var here = _printedHere();
  var queued = _cardsPrintedQueued();
  var listed = {};
  var gone = [];
  var again = [];
  var out = cards.map(function (c) {
    listed[c.id] = true;
    if (c.printed_at) {
      if (here[c.id]) gone.push(c.id);
      return c;
    }
    var mine = here[c.id];
    var at = queued[c.id] || (mine && mine.at);
    if (at) c.printed_at = at;
    // A mark this device made that is no longer on its way: sent once more from this page.
    if (mine && !queued[c.id] && !_cardsPrintSending[c.id] && !_cardsPrintResent[c.id]) again.push(c.id);
    return c;
  });
  // A card printed here that its class no longer lists, in a read begun after the note, was replaced.
  Object.keys(here).forEach(function (id) {
    if (here[id].cid === cid && !listed[id] && asked && here[id].at < asked) gone.push(id);
  });
  if (gone.length) {
    _changePrintedHere(function (now) {
      var changed = false;
      gone.forEach(function (id) {
        // Only the note this read judged: one another tab has written since is left alone.
        if (now[id] && here[id] && now[id].at === here[id].at) {
          delete now[id];
          changed = true;
        }
      });
      return changed;
    });
  }
  if (again.length) {
    again.forEach(function (id) {
      _cardsPrintResent[id] = true;
    });
    _sendCardsPrinted(again);
  }
  return out;
}

/* Cards unlocked from this page whose unlock the server has not answered
   yet: card id → true (Unlock), and class id → true (Unlock All). While
   one is on its way, here or still waiting in the outbox, a list read shows
   the card unlocked, whatever the server's list says: the server has not
   heard yet. Once the server has answered, the list shows what it has:
   no comparison of this computer's clock with the server's. An unlock the
   server refuses is forgotten at once. */
var _cardsUnlockedHere = {};
var _cardsUnlockedAllHere = {};
function _withPendingUnlocks(cid, cards) {
  var one = {};
  Object.keys(_cardsUnlockedHere).forEach(function (id) {
    one[id] = true;
  });
  _queuedCardWrites('unlock_student_card').forEach(function (entry) {
    if (entry.payload.p_card_id) one[entry.payload.p_card_id] = true;
  });
  var all = !!_cardsUnlockedAllHere[cid];
  _queuedCardWrites('unlock_all_student_cards').forEach(function (entry) {
    if (entry.payload.p_course_id === cid) all = true;
  });
  return cards.map(function (c) {
    if (c.locked_at && (all || one[c.id])) {
      c.locked_at = null;
      c.wrong_tries = 0;
      c.wrong_tries_7d = 0;
    }
    return c;
  });
}

/* The class's last reporting date when that is still ahead, else the next
   June 30: the day a card made on this device works until, as the server
   works it out for its own. */
function _demoCardsWorkUntil(cid) {
  var today = courseToday(cid);
  var last = '';
  (getReportingTerms(cid) || []).forEach(function (t) {
    if (t && /^\d{4}-\d{2}-\d{2}$/.test(t.ends_on) && t.ends_on > last) last = t.ends_on;
  });
  if (last && last >= today) return last;
  var year = Number(today.slice(0, 4));
  return (today <= year + '-06-30' ? year : year + 1) + '-06-30';
}
// A whole number from 0 to n - 1, for n up to 256.
function _cardRandom(n) {
  if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
    // Rejection sampling: every value below n equally likely.
    var limit = 256 - (256 % n);
    var b = new Uint8Array(1);
    do crypto.getRandomValues(b);
    while (b[0] >= limit);
    return b[0] % n;
  }
  return Math.floor(Math.random() * n);
}
// Eight characters, shown K7M4-QX2P, as a card made by teacher-cards.
function _demoCardCode(taken) {
  var code;
  do {
    code = '';
    for (var i = 0; i < 8; i++) code += _CARD_CODE_LETTERS.charAt(_cardRandom(_CARD_CODE_LETTERS.length));
    code = code.slice(0, 4) + '-' + code.slice(4);
  } while (taken[code]);
  taken[code] = true;
  return code;
}
// The cards of students still in the class, in roster order.
function _demoCardsListed(cid) {
  var order = {};
  getStudents(cid).forEach(function (st, i) {
    order[st.id] = i + 1;
  });
  return _demoStudentCards(cid)
    .filter(function (c) {
      return c && order[c.enrollment_id];
    })
    .sort(function (a, b) {
      return order[a.enrollment_id] - order[b.enrollment_id];
    });
}

/* The class's cards: [card], one for each student who has one. */
function listStudentCards(cid) {
  if (!cid || !_gradesKept(cid)) return _cardsAnswer(null);
  if (!_writesEnabled()) return _cardsAnswer(_demoCardsListed(cid));
  if (!_useSupabase || !_isUuid(cid)) return _cardsAnswer(null);
  // When this read began: a printed note made after it is newer than the list (_withPendingPrints).
  var asked = new Date().toISOString();
  return _callRpcWithAuthGuard('list_student_cards', { p_course_id: cid }, { suppressSessionExpiredModal: true }).then(
    function (res) {
      if (res && res.error && !res.error.handledSessionExpired) console.warn('list_student_cards failed:', res.error);
      var ok = res && !res.error && res.data != null;
      return {
        data: ok
          ? _withPendingWorkUntil(
              cid,
              _withPendingUnlocks(
                cid,
                _withPendingPrints(cid, _rpcRows(res.data).map(_cardWithoutCode).filter(Boolean), asked),
              ),
            )
          : null,
        error: (res && res.error) || null,
      };
    },
  );
}

/* Demo Mode's teacher-cards: the same request and the same reply, on this
   device. The saved card keeps no code or password; the reply carries
   them once. A student whose live card is not the one named is
   `changed`, as the server answers a second tab. */
function _demoMakeCards(cid, items) {
  var kept = _demoStudentCards(cid);
  var students = {};
  getStudents(cid).forEach(function (st) {
    students[st.id] = st;
  });
  var until = getCardsWorkUntil(cid).date;
  var taken = {};
  var results = items.map(function (it) {
    var st = students[it.enrollment_id];
    if (!st) return { enrollment_id: it.enrollment_id, result: 'not_found' };
    var at = -1;
    kept.forEach(function (c, i) {
      if (c.enrollment_id === it.enrollment_id) at = i;
    });
    var live = at >= 0 ? kept[at] : null;
    if ((live ? live.id : null) !== (it.replaces || null))
      return { enrollment_id: it.enrollment_id, result: 'changed' };
    var hasPassword = !(st.dateOfBirth || st.studentNumber);
    var card = {
      id: uid(),
      enrollment_id: st.id,
      seq: (live && Number(live.seq) > 0 ? Number(live.seq) : live ? 1 : 0) + 1,
      created_at: new Date().toISOString(),
      printed_at: null,
      last_opened_at: null,
      locked_at: null,
      wrong_tries: 0,
      wrong_tries_7d: 0,
      works_until: until,
      check: hasPassword ? 'password' : 'identity',
      has_password: hasPassword,
      needs_new: false,
    };
    if (at >= 0) kept[at] = card;
    else kept.push(card);
    var out = {
      enrollment_id: st.id,
      result: 'made',
      card_id: card.id,
      seq: card.seq,
      works_until: until,
      code: _demoCardCode(taken),
    };
    if (hasPassword) {
      out.password = '';
      for (var d = 0; d < 4; d++) out.password += String(_cardRandom(10));
    }
    return out;
  });
  _saveDemoStudentCards(cid, kept);
  return { replayed: false, results: results };
}

function _teacherCardsUrl() {
  var base = ((window.__ENV && window.__ENV.SUPABASE_URL) || '').replace(/\/$/, '');
  return base ? base + '/functions/v1/teacher-cards?forceFunctionRegion=ca-central-1' : '';
}
async function _teacherToken() {
  var sb = getSupabase();
  if (!sb || !sb.auth || typeof sb.auth.getSession !== 'function') return null;
  if (_signInWait) await _signInWait; // teacher-cards waits for start-up's re-check
  try {
    var got = await sb.auth.getSession();
    var session = got && got.data && got.data.session;
    return (session && session.access_token) || null;
  } catch (e) {
    return null;
  }
}
/* One POST to teacher-cards. Answers { status, body }, or { status: 0 }
   when no reply came (the network, or a reply that is not JSON). Nothing
   about the reply is logged: it holds codes. */
async function _askTeacherCards(url, token, body) {
  try {
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        apikey: (window.__ENV && window.__ENV.SUPABASE_KEY) || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
    });
    /** @type {{ replayed?: unknown; results?: unknown; error?: unknown } | null} */
    var json = null;
    try {
      json = await res.json();
    } catch (e) {
      json = null;
    }
    return { status: res.status, body: json };
  } catch (e) {
    return { status: 0, body: null };
  }
}
/* One request to teacher-cards, under one request_id. A reply that never
   came is asked once more with the same id, so the server makes nothing
   twice; a sign-in that ran out is renewed once and asked again, the same
   way. */
async function _teacherCardsRequest(cid, items) {
  return _teacherCardsAsk({ course_id: cid, items: items, request_id: _newEntryId() });
}
async function _teacherCardsAsk(body) {
  var url = _teacherCardsUrl();
  var token = await _teacherToken();
  if (!url || !token) return { data: null, error: { status: 401, error: 'unauthorized' } };
  var got = await _askTeacherCards(url, token, body);
  if (got.status === 0) got = await _askTeacherCards(url, token, body);
  if (got.status === 401 && typeof refreshSupabaseSession === 'function') {
    /** @type {Awaited<ReturnType<typeof refreshSupabaseSession>> | null} */
    var renewed = null;
    try {
      renewed = await refreshSupabaseSession();
    } catch (e) {
      renewed = null;
    }
    var fresh = renewed && renewed.session && renewed.session.access_token;
    if (fresh) got = await _askTeacherCards(url, fresh, body);
    else if (typeof showSessionExpiredToast === 'function') showSessionExpiredToast();
  }
  var out = got.body;
  if (got.status === 200 && out && typeof out.replayed === 'boolean' && Array.isArray(out.results)) {
    return { data: { replayed: out.replayed, results: out.results }, error: null };
  }
  var error = got.status === 0 ? 'network' : (out && typeof out.error === 'string' && out.error) || 'server';
  console.warn('teacher-cards failed:', got.status, error);
  return { data: null, error: { status: got.status, error: error } };
}

/* Make a card for each of `items`: [{ enrollment_id, replaces }], where
   `replaces` is the id of the card the caller believes is the student's
   live one, or null for a student with none. The server stops that card
   and makes the new one together, or answers `changed` when the student's
   live card is another (a second tab got there first).

   Answers { data: { results }, error }, each result
     { enrollment_id, result: 'made' | 'changed' | 'not_found' | 'failed',
       card_id, seq, works_until, code, password }
   with card_id, seq and works_until for a card that was made, its code
   (K7M4-QX2P) when it could be had, and its password only for a student
   with no birthday or student number on file. The codes are the caller's
   alone: nothing here keeps them.

   A reply lost on the way back (the card-codes design, section 7): the
   retry under the same request_id comes back `replayed`, with the new
   cards' ids and no codes, since nothing ever kept them. Those cards are
   then asked for again, each naming itself as the card to replace, and
   their fresh codes are the answer. If that fails too, the card is
   answered made with no code: it exists, unprinted, and the next Make and
   Print replaces it. */
function makeStudentCards(cid, items) {
  if (!cid || !_gradesKept(cid)) return _cardsAnswer(null);
  var asked = (Array.isArray(items) ? items : [])
    .filter(function (it) {
      return it && it.enrollment_id;
    })
    .map(function (it) {
      return { enrollment_id: it.enrollment_id, replaces: it.replaces || null };
    });
  if (!asked.length) return _cardsAnswer(null);
  if (!_writesEnabled()) return _cardsAnswer(_demoMakeCards(cid, asked));
  if (!_useSupabase || !_isUuid(cid)) return _cardsAnswer(null);
  asked = asked.filter(function (it) {
    return _isUuid(it.enrollment_id) && (it.replaces === null || _isUuid(it.replaces));
  });
  if (!asked.length) return _cardsAnswer(null);
  return _trackPendingSync(
    (async function () {
      var first = await _teacherCardsRequest(cid, asked);
      if (!first.data) return { data: null, error: first.error };
      var results = first.data.results.slice();
      var lost = results.filter(function (r) {
        return r && r.result === 'made' && !r.code && _isUuid(r.card_id);
      });
      if (lost.length) {
        var again = await _teacherCardsRequest(
          cid,
          lost.map(function (r) {
            return { enrollment_id: r.enrollment_id, replaces: r.card_id };
          }),
        );
        var fresh = {};
        ((again.data && again.data.results) || []).forEach(function (r) {
          if (r && r.result === 'made' && r.code) fresh[r.enrollment_id] = r;
        });
        results = results.map(function (r) {
          return r && fresh[r.enrollment_id] && r.result === 'made' && !r.code ? fresh[r.enrollment_id] : r;
        });
      }
      return { data: { results: results }, error: null };
    })(),
  );
}

/* These cards were printed. Answers { printed, printed_at } with the time
   this device gave them; a signed-in teacher's go up through the outbox,
   so a failure shows on the sync dot and nowhere else. */
function markStudentCardsPrinted(cid, cardIds) {
  var ids = (Array.isArray(cardIds) ? cardIds : []).filter(Boolean);
  if (!cid || !ids.length || !_gradesKept(cid)) return _cardsAnswer(null);
  var at = new Date().toISOString();
  if (!_writesEnabled()) {
    var kept = _demoStudentCards(cid);
    var n = 0;
    kept.forEach(function (c) {
      if (ids.indexOf(c.id) < 0) return;
      c.printed_at = at;
      n++;
    });
    if (n) _saveDemoStudentCards(cid, kept);
    return _cardsAnswer({ printed: n, printed_at: at });
  }
  ids = ids.filter(_isUuid);
  if (!_useSupabase || !_isUuid(cid) || !ids.length) return _cardsAnswer(null);
  _changePrintedHere(function (here) {
    ids.forEach(function (id) {
      here[id] = { at: at, cid: cid };
    });
    return true;
  });
  _sendCardsPrinted(ids);
  return _cardsAnswer({ printed: ids.length, printed_at: at });
}

/* Unlock one card, or every locked card in the class (Unlock All): the
   lock and the wrong-try count are cleared. Ids only. Answers at once with
   { unlocked, unlocked_at }; a signed-in teacher's goes up through the
   outbox, so a failure shows on the sync dot and nowhere else. `onFailed`,
   if given, is called when the server refuses it for good, after this
   page has forgotten it: the caller reads the list again. */
/* `sent` is the write (each RPC is named at its own call, so the database
   drift check sees it). Once the server has answered, either way, this
   page forgets the unlock: the server's list is the truth from then on. */
function _unlockSent(name, sent, forget, onFailed) {
  _trackPendingSync(
    Promise.resolve(sent).then(function (res) {
      forget();
      if (!res || !res.error) return;
      if (!res.error.handledSessionExpired) console.warn(name + ' failed:', res.error);
      if (typeof onFailed === 'function') onFailed(res.error);
    }),
  );
}
function unlockStudentCard(cid, cardId, onFailed) {
  if (!cid || !cardId || !_gradesKept(cid)) return _cardsAnswer(null);
  var at = new Date().toISOString();
  if (!_writesEnabled()) {
    var kept = _demoStudentCards(cid);
    var n = 0;
    kept.forEach(function (c) {
      if (c.id !== cardId) return;
      c.locked_at = null;
      c.wrong_tries = 0;
      c.wrong_tries_7d = 0;
      n++;
    });
    if (n) _saveDemoStudentCards(cid, kept);
    return _cardsAnswer({ unlocked: n, unlocked_at: at });
  }
  if (!_useSupabase || !_isUuid(cid) || !_isUuid(cardId)) return _cardsAnswer(null);
  _cardsUnlockedHere[cardId] = at;
  _unlockSent(
    'unlock_student_card',
    _writeRpc('unlock_student_card', { p_card_id: cardId, p_idempotency_key: _newEntryId() }),
    function () {
      if (_cardsUnlockedHere[cardId] === at) delete _cardsUnlockedHere[cardId];
    },
    onFailed,
  );
  return _cardsAnswer({ unlocked: 1, unlocked_at: at });
}
function unlockAllStudentCards(cid, onFailed) {
  if (!cid || !_gradesKept(cid)) return _cardsAnswer(null);
  var at = new Date().toISOString();
  if (!_writesEnabled()) {
    var kept = _demoStudentCards(cid);
    var n = 0;
    kept.forEach(function (c) {
      if (!c.locked_at) return;
      c.locked_at = null;
      c.wrong_tries = 0;
      c.wrong_tries_7d = 0;
      n++;
    });
    if (n) _saveDemoStudentCards(cid, kept);
    return _cardsAnswer({ unlocked: n, unlocked_at: at });
  }
  if (!_useSupabase || !_isUuid(cid)) return _cardsAnswer(null);
  _cardsUnlockedAllHere[cid] = at;
  _unlockSent(
    'unlock_all_student_cards',
    _writeRpc('unlock_all_student_cards', { p_course_id: cid, p_idempotency_key: _newEntryId() }),
    function () {
      if (_cardsUnlockedAllHere[cid] === at) delete _cardsUnlockedAllHere[cid];
    },
    onFailed,
  );
  return _cardsAnswer({ unlocked: null, unlocked_at: at });
}

/* Cards Work Until: the last day a class's cards open. The class's own
   choice (course.cards_work_until), or none, which means the default: the
   class's last reporting date while it is still ahead, else the next June
   30 (_demoCardsWorkUntil, the server's rule). The choice is written on
   every live card in the class when it is set (set_cards_work_until), and
   on each card when it is made.

   A signed-in class's choice comes on its course row with the class
   (get_class_bundle): _noteCardsWorkUntil keeps it, here in this page
   only. A change made here is laid over it, and over the cards of a list
   read before the server has it, as a printed mark is; a change the server
   refuses is forgotten and `onFailed` is called. Demo Mode keeps the
   choice on the device (gb-cards-work-until-<cid>) and writes it on the
   saved cards at once. */
var _cardsWorkUntilServer = {}; // cid → 'YYYY-MM-DD' or null, as the class's course row said
var _cardsWorkUntilHere = {}; // cid → { date, at }: set from this page, not yet known to have landed
function _isDay(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T12:00:00Z'));
}
function _noteCardsWorkUntil(cid, courseRow) {
  if (!cid || !courseRow || typeof courseRow !== 'object' || !('cards_work_until' in courseRow)) return;
  var d = courseRow.cards_work_until;
  _cardsWorkUntilServer[cid] = _isDay(String(d || '').slice(0, 10)) ? String(d).slice(0, 10) : null;
}
// A change to Cards Work Until on its way to the server: { date, at }, or null.
function _cardsWorkUntilPending(cid) {
  var out = _cardsWorkUntilHere[cid] || null;
  _queuedCardWrites('set_cards_work_until').forEach(function (entry) {
    if (entry.payload.p_course_id !== cid) return;
    var at = entry.created_at || '';
    if (!out || at > out.at) out = { date: entry.payload.p_date || null, at: at };
  });
  return out;
}
/* The class's Cards Work Until: { chosen, date, known, reporting }.
   chosen is the day the teacher chose, or null for the default; date is
   the day it works out to; known is false for a signed-in class whose
   choice has not come from the server yet (date is then the default);
   reporting is true when the default is the class's last reporting date
   (false: the next June 30). */
function getCardsWorkUntil(cid) {
  if (!cid) return { chosen: null, date: '', known: false, reporting: false };
  var fallback = _demoCardsWorkUntil(cid);
  var reporting =
    !/-06-30$/.test(fallback) ||
    (getReportingTerms(cid) || []).some(function (t) {
      return t && t.ends_on === fallback;
    });
  var out = function (chosen, known) {
    return { chosen: chosen, date: chosen || fallback, known: known, reporting: reporting };
  };
  if (!_writesEnabled()) {
    var kept = _safeParseLS('gb-cards-work-until-' + cid, null);
    return out(kept && _isDay(kept.date) ? kept.date : null, true);
  }
  var pending = _cardsWorkUntilPending(cid);
  if (pending) return out(pending.date, true);
  if (!(cid in _cardsWorkUntilServer)) return out(null, false);
  return out(_cardsWorkUntilServer[cid], true);
}
function _withPendingWorkUntil(cid, cards) {
  var pending = _cardsWorkUntilPending(cid);
  if (!pending) return cards;
  var date = pending.date || _demoCardsWorkUntil(cid);
  return cards.map(function (c) {
    c.works_until = date;
    return c;
  });
}
/* Set the class's Cards Work Until to `date` ('YYYY-MM-DD'), or back to
   the default with null. Answers at once with { works_until }, the day it
   works out to; a signed-in teacher's goes up through the outbox. */
function setCardsWorkUntil(cid, date, onFailed) {
  if (!cid || !_gradesKept(cid)) return _cardsAnswer(null);
  if (date !== null && !_isDay(date)) return _cardsAnswer(null);
  var until = date || _demoCardsWorkUntil(cid);
  if (!_writesEnabled()) {
    if (date) _safeLSSet('gb-cards-work-until-' + cid, JSON.stringify({ date: date }));
    else {
      try {
        localStorage.removeItem('gb-cards-work-until-' + cid);
      } catch (e) {
        /* nothing kept */
      }
    }
    var kept = _demoStudentCards(cid);
    kept.forEach(function (c) {
      c.works_until = until;
    });
    if (kept.length) _saveDemoStudentCards(cid, kept);
    return _cardsAnswer({ works_until: until });
  }
  if (!_useSupabase || !_isUuid(cid)) return _cardsAnswer(null);
  var mine = { date: date, at: new Date().toISOString() };
  _cardsWorkUntilHere[cid] = mine;
  _trackPendingSync(
    Promise.resolve(
      _writeRpc('set_cards_work_until', { p_course_id: cid, p_date: date, p_idempotency_key: _newEntryId() }),
    ).then(function (res) {
      var still = _cardsWorkUntilHere[cid] === mine;
      if (res && !res.error) {
        if (still) {
          delete _cardsWorkUntilHere[cid];
          _cardsWorkUntilServer[cid] = date;
        }
        return;
      }
      if (res && res.error && !res.error.handledSessionExpired) console.warn('set_cards_work_until failed:', res.error);
      if (still) delete _cardsWorkUntilHere[cid];
      if (typeof onFailed === 'function') onFailed(res && res.error);
    }),
  );
  return _cardsAnswer({ works_until: until });
}
/* ── end Student cards ── */
