/* comment-realiser.js — the realiser (plan PR 9, "Sentence grammar"). Every
   Generate draft passes through it after selection and before verify
   (teacher/comment-bank.js); it fills a bank template's slots by the
   plan's rules:

   - Name and pronouns. The student is named in the first sentence that
     mentions them; later sentences use their pronouns, or the name again
     when none are on file (every mention: FullVision never assumes
     pronouns). Possessive is always ’s ("Chris’s"). A
     [singular|plural] verb agrees with the student mention before it, so
     singular they takes plural verbs ("they come to class ready").
     Moving a sentence first moves the name to it (realise()).
   - a or an by sound ("an A", "a B", "an F", "an IE", "an Extending").
   - Assignment titles quoted, the lesson number dropped; a title's own
     question mark stays inside the quotes, a sentence-ending period goes
     inside the closing quote, any other punctuation after it.
   - Numbers spelled out at the start of a sentence and from one to ten
     inside one; numerals for 11 and up inside a sentence.
   - Lists: "A and B", "A, B and C" (no serial comma).
   - Length: at most 20 words a sentence, a quoted title counting as one.

   Teacher text (support lines, the closing sentence, the late-work line,
   and any sentence the teacher kept as written) is used exactly as typed.

   A template: text with {slots}; {He} {he} {him} {His} {his} {himself}
   are the student, in that role; {name} is always the name; [a|b] is the
   verb for one person (he, she, the name) | for they. Slot values go in as
   written: a note or an answer holding "{name}" or "[a|b]" is never read
   as a slot. */
window.CommentRealiser = (function () {
  'use strict';

  var MAX_WORDS = 20;

  /* ── Numbers ───────────────────────────────────────────────────────── */

  var ONES = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
  ];
  var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

  /* A whole number in words, up to 999 ("fifteen", "twenty-one", "one
     hundred twelve"); numerals past that. */
  function numberWords(n) {
    n = Math.floor(Number(n));
    if (!(n >= 0)) return '';
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
    if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberWords(n % 100) : '');
    return String(n);
  }
  /* A number inside a sentence: words from one to ten, numerals from 11. */
  function numberIn(n) {
    n = Math.floor(Number(n));
    if (!(n >= 0)) return '';
    return n <= 10 ? ONES[n] : String(n);
  }
  /* A number that starts a sentence: always words, with a capital. */
  function numberStart(n) {
    return cap(numberWords(n));
  }
  /* How many times: "once", "twice", then "three times", "12 times". */
  function times(n) {
    n = Math.floor(Number(n));
    if (!(n > 0)) return '';
    return n === 1 ? 'once' : n === 2 ? 'twice' : numberIn(n) + ' times';
  }

  function cap(w) {
    w = String(w || '');
    return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
  }

  /* ── Lists ─────────────────────────────────────────────────────────── */

  /* "a", "a and b", "a, b and c" (no serial comma); a value given twice
     once. */
  function list(xs) {
    xs = (xs || []).filter(function (x, i, all) {
      return x && all.indexOf(x) === i;
    });
    return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
  }

  /* ── a or an ───────────────────────────────────────────────────────── */

  // Letters said one by one that start with a vowel sound: "an F", "an MRI".
  var VOWEL_LETTERS = /^[AEFHILMNORSX]/;
  // Words that start with a vowel letter and a consonant sound, or the
  // other way round.
  var A_WORDS = /^(?:uni(?!n)|use|usu|uti|ure|uri|uro|ubi|uku|eu|ew|one\b|once\b)/i;
  var AN_WORDS = /^(?:hour|honest|honou?r|heir)/i;

  /* "a" or "an" for the word that follows, by how it sounds: a letter
     grade or initialism is said letter by letter ("an A", "a B", "an
     IE"), a number as it is said ("an 8", "an 11", "a 12"), a word by its
     first sound ("an Extending", "a unit", "an hour"). An opening quote is
     skipped: "an “Energy Lab”". */
  function article(w) {
    var t = String(w || '')
      .trim()
      .replace(/^[“‘"'(]+/, '');
    var first = (t.match(/^[^\s,.;:!?”’)]+/) || [''])[0];
    if (!first) return 'a';
    if (/^\d/.test(first)) {
      var digits = first.match(/^\d+/)[0];
      return /^8/.test(digits) || /^1[18](\d{3})*$/.test(digits) ? 'an' : 'a';
    }
    if (/^[A-Z]{1,4}[+-]?$/.test(first)) return VOWEL_LETTERS.test(first) ? 'an' : 'a';
    if (AN_WORDS.test(first)) return 'an';
    if (A_WORDS.test(first)) return 'a';
    return /^[aeiou]/i.test(first) ? 'an' : 'a';
  }
  /* The word with its article: "an A", "a B". */
  function aOrAn(w) {
    return article(w) + ' ' + String(w || '');
  }

  /* ── Assignment titles ─────────────────────────────────────────────── */

  /* A title as a comment quotes it: the lesson number ("4.3 ", "Lesson 2:")
     dropped. A title that is only a number keeps it. */
  function workTitle(title) {
    var t = String(title || '')
      .replace(/\s+/g, ' ')
      .trim();
    var bare = t.replace(
      /^(?:lesson\s+\d+(?:\.\d+)*[a-z]?\s*[.:)\-–—]?|\d+(?:\.\d+)+[a-z]?\s*[.:)\-–—]?|\d+[a-z]?\s*[.:)\-–—])\s+/i,
      '',
    );
    return bare || t;
  }
  /* A title in quotes, inside a sentence: “What Does the Poster Show?”.
     Its own closing period is dropped (finish() puts the sentence's period
     inside the quote when the title ends the sentence). '' with none. */
  function quoteTitle(title) {
    var t = workTitle(title).replace(/\.+$/, '');
    return t ? '“' + t + '”' : '';
  }

  /* ── Length ────────────────────────────────────────────────────────── */

  /* Words in a sentence, a quotation counting as one: “What Does the
     Poster Show, and What Does It Hide?” is one word. */
  function wordCount(text) {
    return String(text || '')
      .replace(/“[^”]*”?/g, ' Q ')
      .split(/\s+/)
      .filter(function (w) {
        return /[A-Za-z0-9]/.test(w);
      }).length;
  }
  function tooLong(text) {
    return wordCount(text) > MAX_WORDS;
  }

  /* ── Templates ─────────────────────────────────────────────────────── */

  var ROLES = { He: 'subj', he: 'subj', him: 'obj', His: 'poss', his: 'poss', himself: 'refl' };
  // The slots that hold one assignment title, quoted by the realiser.
  var TITLE_SLOTS = { assignment: 1, assignment2: 1, seeWork: 1, aboutWork: 1 };

  /* A template as tokens: literal strings; { ref: 'subj' | 'obj' | 'poss'
     | 'refl' } for the student; { name: true } for the name always; {
     verb: [one, many] }; { value, title } for a slot's value. get(slot)
     gives the value: a string, or an array of tokens to put in its place
     (a sentence built whole, like the best piece). */
  function tokens(text, get) {
    var out = [];
    var re = /\{(\w+)\}|\[([^|\]]*)\|([^\]]*)\]/g;
    var src = String(text == null ? '' : text);
    var from = 0;
    var m;
    while ((m = re.exec(src))) {
      if (m.index > from) out.push(src.slice(from, m.index));
      from = m.index + m[0].length;
      var k = m[1];
      if (k === undefined) out.push({ verb: [m[2], m[3]] });
      else if (Object.prototype.hasOwnProperty.call(ROLES, k)) out.push({ ref: ROLES[k] });
      else if (k === 'name') out.push({ name: true });
      else {
        var v = get ? get(k) : '';
        if (Array.isArray(v)) out.push.apply(out, v);
        else out.push({ value: v == null ? '' : String(v), title: !!TITLE_SLOTS[k] });
      }
    }
    if (from < src.length) out.push(src.slice(from));
    return out;
  }

  var THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };

  /* Who a sentence is about: { name, p: pronouns { subj, obj, poss, refl
     }, onFile }. With no pronouns on file every mention is the name:
     "they" only when they/them is on file. */
  function _who(who) {
    who = who || {};
    return { name: String(who.name || ''), p: who.p || THEY, onFile: !!who.onFile };
  }
  function possessive(name) {
    return name + '’s';
  }

  /* One sentence's tokens as text. state.named: whether the comment has
     named the student yet; the first mention in the comment takes the name
     and sets it. */
  function render(toks, who, state) {
    who = _who(who);
    state = state || { named: true };
    var p = who.p;
    var out = '';
    var mentioned = false; // the student is mentioned earlier in this sentence
    var one = p.subj !== 'they'; // the last subject mention takes a singular verb
    var atStart = function () {
      return !/[A-Za-z0-9]/.test(out);
    };
    (toks || []).forEach(function (tok) {
      if (typeof tok === 'string') {
        out += tok;
        return;
      }
      if (tok.verb) {
        out += one ? tok.verb[0] : tok.verb[1];
        return;
      }
      if (tok.name || tok.ref) {
        var role = tok.name ? 'subj' : tok.ref;
        // The name: the first mention in the comment, an explicit {name},
        // and, with no pronouns on file, every mention (FullVision never
        // assumes pronouns: "Ava’s best piece was “X”, where Ava linked …").
        // The bank writes no reflexive, so no "Ava sees Ava".
        var useName = !!tok.name || !who.onFile || (role !== 'refl' && !state.named);
        var w;
        if (useName && who.name) {
          w = role === 'poss' ? possessive(who.name) : who.name;
          state.named = true;
          if (role === 'subj') one = true;
        } else {
          w = String(p[role] || THEY[role]);
          if (role === 'subj') one = w !== 'they';
        }
        out += atStart() ? cap(w) : w;
        mentioned = true;
        return;
      }
      var v = tok.value == null ? '' : String(tok.value);
      if (tok.title) v = quoteTitle(v);
      else if (/^\d+$/.test(v)) v = atStart() ? numberStart(v) : numberIn(v);
      // "a" or "an" before the value, by its sound.
      var art = out.match(/(^|[\s(])([Aa]n?) $/);
      if (art && v) {
        var a = article(v);
        out = out.slice(0, out.length - art[2].length - 1) + (art[2].charAt(0) === 'A' ? cap(a) : a) + ' ';
      }
      out += v;
    });
    return finish(out);
  }

  /* A sentence's last touches: one space between words, a capital first
     (after an opening quote), and a sentence-ending period inside a closing
     quote, or dropped when the quotation already ends with . ? ! or …. */
  function finish(text) {
    var t = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    t = t.replace(/^([“‘"(]*)([a-z])/, function (m, q, c) {
      return q + c.toUpperCase();
    });
    t = t.replace(/([.?!…])”\.$/, '$1”').replace(/([^.?!…])”\.$/, '$1.”');
    return t;
  }

  /* Whether teacher text names the student: the name as a whole word. */
  function _names(text, name) {
    if (!name) return false;
    var esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^A-Za-zÀ-ɏ])' + esc + '($|[^A-Za-zÀ-ɏ])').test(String(text || ''));
  }

  /* A comment's sentences in order, each filled for its place: the student
     named in the first sentence that mentions them, pronouns after (or the
     name again with none on file). sentences: the draft's sentences, each
     { text, toks, who } as Generate gives them, or { text } for teacher
     text, used exactly as typed (one that holds the name counts as naming
     the student). order: the new order, as positions or sentence ids;
     sentences it leaves out follow in their own order. Returns { text,
     sentences }, each sentence a copy with its new text and word count. */
  function realise(sentences, order) {
    var xs = (sentences || []).slice();
    if (order && order.length) {
      var picked = [];
      order.forEach(function (k) {
        var at =
          typeof k === 'number'
            ? k
            : xs.findIndex(function (x, i) {
                return x && x.id === k && picked.indexOf(i) < 0;
              });
        if (at >= 0 && at < xs.length && picked.indexOf(at) < 0) picked.push(at);
      });
      xs.forEach(function (x, i) {
        if (picked.indexOf(i) < 0) picked.push(i);
      });
      xs = picked.map(function (i) {
        return xs[i];
      });
    }
    var who = null;
    xs.forEach(function (x) {
      if (!who && x && x.who) who = x.who;
    });
    var state = { named: false };
    var out = xs.map(function (x) {
      var copy = Object.assign({}, x);
      if (x && x.toks) copy.text = render(x.toks, x.who || who, state);
      else if (who && _names(copy.text, who.name)) state.named = true;
      copy.words = wordCount(copy.text);
      return copy;
    });
    return {
      text: out
        .map(function (x) {
          return x.text;
        })
        .filter(Boolean)
        .join(' '),
      sentences: out,
    };
  }

  return {
    MAX_WORDS: MAX_WORDS,
    TITLE_SLOTS: TITLE_SLOTS,
    numberWords: numberWords,
    numberIn: numberIn,
    numberStart: numberStart,
    times: times,
    list: list,
    article: article,
    aOrAn: aOrAn,
    workTitle: workTitle,
    quoteTitle: quoteTitle,
    wordCount: wordCount,
    tooLong: tooLong,
    tokens: tokens,
    render: render,
    finish: finish,
    realise: realise,
  };
})();
