// @ts-check
/* report-wc-draw.js — Write Comments: the boxes drawn as HTML
   (docs/plans/write-comments-plan.md, decisions 4 to 7). It takes the boxes
   ReportWcBoxes built and returns markup; every text goes through esc().
   Pieces that belong to the main file's own state (a habit's slider, the
   attendance boxes, the observation cards, a class line's menu) are drawn
   by the host and put in place here. */
window.ReportWcDraw = (function () {
  'use strict';

  var host = /** @type {any} */ (null);
  function configure(h) {
    host = h;
  }

  var GRIP =
    '<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.4"></circle><circle cx="7" cy="3" r="1.4"></circle><circle cx="3" cy="8" r="1.4"></circle><circle cx="7" cy="8" r="1.4"></circle><circle cx="3" cy="13" r="1.4"></circle><circle cx="7" cy="13" r="1.4"></circle></svg>';
  var CHEV =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5l3 3 3-3"></path></svg>';

  function tile(b) {
    return `<span class="wc-tile" style="background:${b.tint}" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${b.icon}"></path></svg></span>`;
  }
  function chip(text, cls, title) {
    return text
      ? `<span class="wc-chip${cls ? ' ' + cls : ''}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`
      : '';
  }
  function button(b, cls) {
    if (b.href)
      return `<a role="link" tabindex="0" data-href="${esc(b.href)}" class="${cls || 'wc-link'}" title="${esc(b.title || '')}">${esc(b.label)}</a>`;
    var data = Object.keys(b.data || {})
      .map(function (k) {
        return ` data-${k.replace(/[A-Z]/g, function (m) {
          return '-' + m.toLowerCase();
        })}="${esc(b.data[k])}"`;
      })
      .join('');
    var act = /^tq/.test(b.act) ? b.act : 'tqSentences';
    var doAttr = /^tq/.test(b.act) ? '' : ` data-do="${esc(b.act)}"`;
    return `<button type="button" class="${cls || 'wc-link'}" data-action="${act}"${doAttr}${data}${b.on ? ' aria-pressed="true"' : ''}>${esc(b.label)}</button>`;
  }

  /* ── One sentence of the comment, in its box ─────────────── */

  // html-safe: the text and every label esc()'d; indexes are numbers
  function line(l) {
    var badge = l.yours ? chip('Yours', 'own') : '';
    if (l.last) badge += chip('In Last Report', 'warn', 'This sentence was in the last report.');
    var edit = l.fixed
      ? `<button type="button" class="wc-text" data-action="tqLine" data-do="${esc(l.fixed)}" title="Change this line for the class.">${esc(l.text)}</button>`
      : `<button type="button" class="wc-text" data-action="tqSentences" data-do="wcEdit" data-row="${l.ri}" title="Click to edit">${esc(l.text)}</button>`;
    var ways = l.hasWays
      ? `<button type="button" class="wc-btn" data-action="tqSentences" data-do="wcWays" data-row="${l.ri}" aria-expanded="${!!l.waysOpen}" aria-haspopup="true">Other Ways ▾</button>`
      : '';
    var keep = l.earlier
      ? `<button type="button" class="wc-btn" data-action="tqSentences" data-do="keepEarlier" data-row="${l.ri}" title="Makes this sentence yours. Generate keeps it.">Keep This Sentence</button>`
      : '';
    var bank =
      l.yours && /** @type {any} */ (window).PersonalBank && !l.classLine
        ? `<button type="button" class="wc-btn" data-action="tqSentences" data-do="ownAdd" data-row="${l.ri}" title="Adds this sentence to your bank, for other students it fits.">Add to My Bank</button>`
        : '';
    var cls = 'wc-line' + (l.added ? ' added' : '') + (l.claim ? ' flag' : '');
    return `<div class="${cls}" data-row="${l.ri}" data-rk="${esc(l.rk)}" data-wc-part="${esc(l.box)}">
      <div class="wc-line-main">
        <span class="wc-grip" role="button" tabindex="0" data-wc-grip="${l.ri}" aria-label="Move this sentence. Drag it, or use the arrow keys." title="Drag to move">${GRIP}</span>
        ${edit}${badge}${keep}${bank}${ways}
        <button type="button" class="wc-btn wc-x" data-action="tqSentences" data-do="remove" data-row="${l.ri}" aria-label="Remove From Comment" title="Remove From Comment">✕</button>
      </div>
      ${l.waysOpen ? waysHtml(l) : ''}${l.own || ''}${l.claimHtml || ''}${l.pronounNote || ''}
    </div>`;
  }
  function waysHtml(l) {
    var items = (l.ways || [])
      .map(function (w) {
        return `<div class="wc-way"><span class="wc-way-text">${esc(w.text)}</span>${chip(w.used, '', w.usedTip)}<button type="button" class="wc-btn" data-action="tqSentences" data-do="wcUse" data-row="${l.ri}" data-sentence="${esc(w.id)}">Use</button></div>`;
      })
      .join('');
    return `<div class="wc-ways" role="group" aria-label="Other ways to say this">${
      items || '<div class="wc-way"><span class="wc-way-text">No other wording fits.</span></div>'
    }</div>`;
  }

  /* ── A fact ──────────────────────────────────────────────── */

  function sliderHtml(f) {
    return f.slider ? host.habitSlider(f.slider) : '';
  }
  function rightOf(f) {
    var out = '';
    if (f.up) out += chip(f.up, 'up');
    if (f.chip) out += chip(f.chip, f.chip === 'Private' ? 'priv' : '');
    if (f.bar != null)
      out += `<span class="wc-bar" aria-hidden="true"><span style="width:${Math.max(0, Math.min(1, Number(f.bar))) * 100}%"></span></span>`;
    if (f.slider) out += sliderHtml(f);
    if (f.val) out += `<span class="wc-val">${esc(f.val)}</span>`;
    return out;
  }
  function extraHtml(f) {
    return f.extra.map(function (b) {
      return button(b, 'wc-btn');
    });
  }
  /* The row of a fact: its name and what it rests on at the left, its
     marks and buttons at the right. */
  // html-safe: names, quotes, chips and marks esc()'d; markup from the host is built there with esc()
  function factRow(f, box) {
    if (f.html === 'att') return host.attFields(f, box) + sayButton(f);
    if (/^cls:/.test(f.html)) return f.look;
    var tag = f.tag ? `<span class="wc-tag" style="background:${esc(f.tagTint)}">${esc(f.tag)}</span>` : '';
    var main = `<span class="wc-fact-main"><span class="wc-fact-name"${f.tip ? ` title="${esc(f.tip)}"` : ''}>${esc(f.name)}</span>${f.quote ? `<span class="wc-fact-quote">${esc(f.quote)}</span>` : ''}</span>`;
    return tag + main + rightOf(f) + sayButton(f) + extraHtml(f).join('');
  }
  function sayButton(f) {
    if (!f.sayData) return '';
    var data = Object.keys(f.sayData)
      .map(function (k) {
        return ` data-${k}="${esc(f.sayData[k])}"`;
      })
      .join('');
    return `<button type="button" class="wc-btn say" data-action="tqSentences" data-do="wcSay"${data}>${esc(f.sayLabel)}</button>`;
  }
  function subsHtml(f) {
    return f.subs
      .map(function (m) {
        return `<div class="wc-sub"><span class="wc-sub-name">${esc(m.name)}</span>${chip(m.chip)}<button type="button" class="wc-btn" data-action="tqOpenGrader" data-aid="${esc(m.aid)}" title="Opens the grader on this piece. This page never changes the gradebook.">Open in Grader</button></div>`;
      })
      .join('');
  }
  function factHtml(f, box) {
    if (f.html === 'obs') return `<div class="wc-fact-wrap">${host.obsHtml()}</div>`;
    return `<div class="wc-fact-wrap" data-fact="${esc(f.id)}">
      <div class="wc-fact">${factRow(f, box)}</div>
      ${f.lines.map(line).join('')}${subsHtml(f)}
    </div>`;
  }

  /* ── A box ───────────────────────────────────────────────── */

  function writeHtml(w) {
    return `<div class="wc-write"><input type="text" id="tq-wc-write" class="wc-write-input" aria-label="Your sentence" placeholder="Write a sentence" value="${esc(w.text)}" data-wc-write="1"><button type="button" class="wc-btn" data-action="tqSentences" data-do="wcWriteCancel">Cancel</button><button type="button" class="wc-btn wc-btn-main" data-action="tqSentences" data-do="wcWriteAdd">Add</button></div>`;
  }
  // html-safe: every text esc()'d; markup from the host is html the host built with esc()
  function boxHtml(b, ui) {
    var said = b.said ? chip(b.said + ' in the Comment', 'own') : '';
    var head = `<h2 class="wc-h"><button type="button" class="wc-head" id="wc-head-${b.key}" aria-expanded="${b.open}" data-action="tqSentences" data-do="wcToggle" data-box="${b.key}">
      ${tile(b)}<span class="wc-head-name">${esc(b.label)}</span>
      ${b.only ? chip(b.only, '', 'Only you see this. It never goes in the comment.') : ''}
      ${b.head ? `<span class="wc-head-fact">${esc(b.head)}</span>` : ''}${said}
      <span class="wc-chev${b.open ? ' open' : ''}" aria-hidden="true">${CHEV}</span></button></h2>`;
    if (!b.open)
      return `<section class="wc-box" data-bk="${b.key}" data-part="${b.key}" aria-label="${esc(b.label)}" style="--tint:${b.tint}">${head}</section>`;
    var write = ui.write && ui.write.box === b.key ? writeHtml(ui.write) : '';
    var foot = b.foot.map(function (x) {
      return button(x, 'wc-link');
    });
    if (b.key !== 'yours' && b.key !== 'obs' && b.writable)
      foot.push(
        `<button type="button" class="wc-link" data-action="tqSentences" data-do="wcWrite" data-box="${b.key}">+ Write Your Own</button>`,
      );
    if (b.browse)
      foot.push(
        `<button type="button" class="wc-link" data-action="tqSentences" data-do="wcBrowse" data-part="${esc(b.browse.part)}">${esc(b.browse.label)}</button>`,
      );
    return `<section class="wc-box open" data-bk="${b.key}" data-part="${b.key}" aria-label="${esc(b.label)}" style="--tint:${b.tint}">
      ${head}
      <div class="wc-body">
        ${b.required || ''}${b.top.map(line).join('')}${b.facts
          .map(function (f) {
            return factHtml(f, b);
          })
          .join('')}${write}
        ${foot.length ? `<div class="wc-foot">${foot.join('')}</div>` : ''}
      </div>
    </section>`;
  }

  function boxes(list, ui) {
    return list
      .map(function (b) {
        return boxHtml(b, ui);
      })
      .join('');
  }

  return { configure: configure, boxes: boxes, line: line, chip: chip, GRIP: GRIP, CHEV: CHEV };
})();
