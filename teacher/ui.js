/* gb-ui.js — Shared UI components for FullVision */

/* ── Colour popover ────────────────────────────────────────── */
/* A colour swatch opens this small popover under it: the preset colours,
   then a Custom row (a colour well and a hex box), so a teacher can pick
   any colour in any browser. It lives on <body> so a page render doesn't
   remove it, and follows its swatch as the page scrolls or re-renders.
   opts: key (which swatch is open), colors, current, label,
   findSwatch() (the live swatch after a render), onPick(color). */
var _colorPopOpts = null;
var _COLOR_POP_HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
function normHexColor(v) {
  var m = _COLOR_POP_HEX_RE.exec(String(v || '').trim());
  if (!m) return null;
  var h = m[1].toLowerCase();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return '#' + h;
}
function closeColorPop() {
  if (!_colorPopOpts) return;
  var pop = document.getElementById('color-pop');
  if (pop) pop.remove();
  _colorPopOpts = null;
  document.removeEventListener('mousedown', _colorPopOutside, true);
  document.removeEventListener('keydown', _colorPopKey, true);
  window.removeEventListener('scroll', _placeColorPop, true);
  window.removeEventListener('resize', _placeColorPop);
}
function _placeColorPop() {
  var pop = document.getElementById('color-pop');
  if (!pop || !_colorPopOpts) return;
  var sw = _colorPopOpts.findSwatch();
  if (!sw) return _colorPopAway();
  var r = sw.getBoundingClientRect();
  var w = pop.offsetWidth;
  var h = pop.offsetHeight;
  var top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  pop.style.top = top + 'px';
}
// Closing by clicking away or on the swatch keeps a custom colour the
// teacher has previewed; Escape drops it.
function _colorPopAway() {
  var opts = _colorPopOpts;
  var pending = opts && opts.pending;
  closeColorPop();
  if (pending) opts.onPick(pending);
}
function _colorPopOutside(e) {
  if (e.target.closest('#color-pop')) return;
  var sw = _colorPopOpts && _colorPopOpts.findSwatch();
  if (sw && sw.contains(e.target)) return;
  _colorPopAway();
}
function _colorPopKey(e) {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  var opts = _colorPopOpts;
  closeColorPop();
  var sw = opts && opts.findSwatch();
  if (sw) {
    sw.style.background = opts.orig;
    sw.focus();
  }
}
function openColorPop(swatch, opts) {
  var wasThis = _colorPopOpts && _colorPopOpts.key === opts.key;
  _colorPopAway();
  if (wasThis) return;
  var current = normHexColor(opts.current) || opts.colors[0];
  _colorPopOpts = opts;
  opts.orig = current;
  opts.pending = '';
  var pop = document.createElement('div');
  pop.id = 'color-pop';
  pop.className = 'color-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', opts.label || 'Colour');
  var grid = document.createElement('div');
  grid.className = 'color-pop-grid';
  opts.colors.forEach(function (c) {
    var opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'color-pop-opt' + (c === current ? ' selected' : '');
    opt.dataset.color = c;
    opt.style.background = c;
    opt.setAttribute('aria-label', c);
    opt.setAttribute('aria-pressed', String(c === current));
    grid.appendChild(opt);
  });
  var custom = document.createElement('div');
  custom.className = 'color-pop-custom';
  var label = document.createElement('span');
  label.className = 'color-pop-custom-label';
  label.textContent = 'Custom';
  var well = document.createElement('input');
  well.type = 'color';
  well.className = 'color-pop-well';
  well.value = current;
  well.setAttribute('aria-label', 'Choose a custom colour');
  var hex = document.createElement('input');
  hex.type = 'text';
  hex.className = 'color-pop-hex';
  hex.value = current;
  hex.maxLength = 7;
  hex.spellcheck = false;
  hex.autocomplete = 'off';
  hex.setAttribute('aria-label', 'Hex colour');
  custom.appendChild(label);
  custom.appendChild(well);
  custom.appendChild(hex);
  pop.appendChild(grid);
  pop.appendChild(custom);
  document.body.appendChild(pop);
  _placeColorPop();

  function apply(color) {
    closeColorPop();
    if (color && color !== current) opts.onPick(color);
  }
  pop.addEventListener('click', function (e) {
    var opt = e.target.closest('.color-pop-opt');
    if (opt) apply(opt.dataset.color);
  });
  // The well and the hex box preview on the swatch as the teacher picks;
  // the colour is saved when the well's picker closes or Enter is pressed.
  function preview(color) {
    var sw = opts.findSwatch();
    if (sw) sw.style.background = color;
    opts.pending = color === current ? '' : color;
  }
  well.addEventListener('input', function () {
    hex.value = well.value;
    hex.classList.remove('invalid');
    preview(well.value);
  });
  well.addEventListener('change', function () {
    apply(normHexColor(well.value));
  });
  hex.addEventListener('input', function () {
    var c = normHexColor(hex.value);
    hex.classList.toggle('invalid', !c && hex.value.trim() !== '');
    if (c) {
      well.value = c;
      preview(c);
    }
  });
  hex.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var c = normHexColor(hex.value);
    if (c) apply(c);
    else hex.classList.add('invalid');
  });

  document.addEventListener('mousedown', _colorPopOutside, true);
  document.addEventListener('keydown', _colorPopKey, true);
  window.addEventListener('scroll', _placeColorPop, true);
  window.addEventListener('resize', _placeColorPop);
  var sel = pop.querySelector('.color-pop-opt.selected') || pop.querySelector('.color-pop-opt');
  if (sel) sel.focus({ preventScroll: true });
}

/* ── HTML sanitizer for contenteditable output ──────────────── */
function sanitizeHtml(raw) {
  var allowed = ['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'SPAN'];
  // Parsed into a <template>, whose content is inert: an <img onerror> in
  // it doesn't load or fire while it is cleaned, as it could in a <div>.
  var holder = document.createElement('template');
  // html-safe: parsed into an inert <template> only to be cleaned; never shown as is.
  holder.innerHTML = raw;
  var root = holder.content || holder;
  (function walk(node) {
    for (var i = node.childNodes.length - 1; i >= 0; i--) {
      var child = node.childNodes[i];
      if (child.nodeType === 1) {
        if (allowed.indexOf(child.tagName) === -1) {
          child.replaceWith(document.createTextNode(child.textContent));
        } else {
          [].slice.call(child.attributes).forEach(function (a) {
            child.removeAttribute(a.name);
          });
          walk(child);
        }
      }
    }
  })(root);
  if (root === holder) return holder.innerHTML;
  var out = document.createElement('div');
  out.appendChild(root);
  return out.innerHTML;
}

/* ── Printing one sheet (grade sheets, rubrics, QR slips) ──── */
/* The page rule for a sheet that prints on its own: the paper ("letter
   portrait", "legal portrait") and one margin on every page, :left, :right
   and :first included, so reports.css's duplex margins can't apply. */
function printPageCss(size, margin) {
  return (
    '@page { size: ' +
    size +
    '; margin: ' +
    margin +
    '; }\n@page :left { margin: ' +
    margin +
    '; }\n@page :right { margin: ' +
    margin +
    '; }\n@page :first { margin: ' +
    margin +
    '; }'
  );
}

/* Turns a sheet's print mode on: its page rule, last in <head> every time
   so a page rule another screen left behind can't win, and the body class
   that shows only the sheet. */
function setPrintMode(styleId, bodyClass, size, margin) {
  var style = document.getElementById(styleId) || document.createElement('style');
  style.id = styleId;
  style.textContent = printPageCss(size, margin);
  document.head.appendChild(style);
  document.body.classList.add(bodyClass);
}

function clearPrintMode(styleId, bodyClass) {
  document.body.classList.remove(bodyClass);
  var style = document.getElementById(styleId);
  if (style) style.remove();
}

/* window.print(), then `cleanup` once. Chrome returns from print() when its
   dialog closes; a browser that returns at once fires afterprint later. */
function printThen(cleanup) {
  var finished = false;
  function done() {
    if (finished) return;
    finished = true;
    window.removeEventListener('afterprint', done);
    cleanup();
  }
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 0);
}

/* ── Course-switch input lock (P7.3) ───────────────────────── */
/* While a class loads, the previous class is still on screen. setPageLock
   (shared/data.js) makes the page inert, which blocks the keyboard as well
   as the mouse, so nothing can be typed into the old class while
   activeCourse already names the new one. */
async function withSwitchingLock(fn) {
  setPageLock('switching', true);
  try {
    return await fn();
  } finally {
    setPageLock('switching', false);
  }
}
window.withSwitchingLock = withSwitchingLock;

/* ── Shared HTML: Unified Toolbar ──────────────────────────── */
const OFFLINE_BANNER_COPY = "You're offline. Changes will sync when connection returns.";
let _syncUIBound = false;
let _syncUIUnsubscribe = null;
let _sessionExpiredRetries = {};
let _sessionExpiredCopyDraft = null;
let _sessionExpiredModalOpen = false;

/* The Demo Mode pill at the left of the top bar, in Demo Mode only. Its
   panel says what Demo Mode is and offers the ways out: Create an Account
   and Sign In, which leave Demo Mode first (leaveDemoMode in shared/data.js),
   and Reset Demo Data, the same action as the account menu's. It is a small
   dialog, not a menu, because it holds a sentence. */
const DEMO_CHEVRON_SVG =
  '<svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5l3 3 3-3"/></svg>';
const DEMO_MENU_TITLE = 'Demo Mode';
const DEMO_MENU_TEXT = 'A sample Science 8 class. Nothing is saved to an account.';

// html-safe: fixed strings only.
function demoPillHTML() {
  if (typeof isDemoMode !== 'function' || !isDemoMode()) return '';
  return `<div class="tb-demo-menu">
      <button type="button" class="tb-demo-pill" data-action="toggleDemoMenu" aria-expanded="false" aria-haspopup="dialog" aria-controls="tb-demo-panel" aria-label="Demo Mode">Demo<span class="tb-demo-pill-more"> Mode</span>${DEMO_CHEVRON_SVG}</button>
      <div class="tb-demo-panel" id="tb-demo-panel" role="dialog" aria-labelledby="tb-demo-title" hidden>
        <div class="tb-demo-head">
          <h2 class="tb-demo-title" id="tb-demo-title">${DEMO_MENU_TITLE}</h2>
          <p class="tb-demo-text">${DEMO_MENU_TEXT}</p>
        </div>
        <div class="tb-demo-actions">
          <a class="btn btn-primary tb-demo-btn" href="/login.html#signup" data-action="leaveDemoMode">Create an Account</a>
          <a class="btn btn-ghost tb-demo-btn" href="/login.html" data-action="leaveDemoMode">Sign In</a>
        </div>
        <div class="tb-demo-rule"></div>
        <button type="button" class="tb-demo-reset" data-action="resetDemoData">Reset Demo Data</button>
      </div>
    </div>`;
}

function _setDemoMenu(open, focusButton) {
  var wrap = document.querySelector('.tb-demo-menu');
  if (!wrap) return;
  var btn = wrap.querySelector('.tb-demo-pill');
  var panel = wrap.querySelector('.tb-demo-panel');
  wrap.classList.toggle('open', !!open);
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (!open && focusButton) btn.focus();
}

document.addEventListener('click', function (e) {
  var wrap = document.querySelector('.tb-demo-menu.open');
  if (!wrap) return;
  // A click outside closes it; so does Reset Demo Data, which opens its own confirm.
  if (!wrap.contains(e.target) || e.target.closest('[data-action="resetDemoData"]')) _setDemoMenu(false);
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape' || !document.querySelector('.tb-demo-menu.open')) return;
  _setDemoMenu(false, true);
  e.preventDefault();
});

/* ── Help panel ──────────────────────────────────────────────
   The Help button (between the sync dot and the account button) opens a
   400px panel beside the page: #page-layout gains it as a last column, so
   the page narrows, as with the roster, and the top bar is never covered.
   The panel lists the help site's articles for this page and Getting
   Started, searches titles and summaries, and shows an article inside the
   panel. Articles come from the help site: /help/index.json
   ([{slug, title, section, pages, summary, video, demo}]) and
   /help/fragments/<slug>.html. Open or closed is remembered per device. */
const HELP_ICON_SVG =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><path d="M6.2 6.2a1.9 1.9 0 0 1 3.6.7c0 1.3-1.8 1.6-1.8 2.7"/><circle cx="8" cy="11.6" r="0.4" fill="currentColor"/></svg>';
const HELP_SEARCH_SVG =
  '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="6" cy="6" r="4.5"/><path d="M9.5 9.5L13 13"/></svg>';
const HELP_OPEN_KEY = 'td-help-open';
const HELP_LOAD_ERROR = 'Help articles could not be loaded.';
let _helpOpen = false;
try {
  _helpOpen = localStorage.getItem(HELP_OPEN_KEY) === '1';
} catch (e) {
  _helpOpen = false;
}
let _helpIndex = null; // the article list, once loaded
let _helpIndexState = 'idle'; // idle | loading | ready | error
let _helpSlug = null; // the article shown, or null for the list
let _helpQuery = '';

// html-safe: the icon is fixed markup.
function helpButtonHTML() {
  return `<button type="button" class="tb-help-btn${_helpOpen ? ' is-open' : ''}" data-action="toggleHelp" aria-expanded="${_helpOpen ? 'true' : 'false'}" aria-controls="help-panel" aria-label="Help">${HELP_ICON_SVG}<span class="tb-help-label">Help</span></button>`;
}

/* The open page: its name for the section heading, and the addresses an
   article's `pages` may list for it. */
function _helpPage() {
  var path = (location && location.pathname) || '/dashboard';
  var params = new URLSearchParams((location && location.search) || '');
  if (path === '/dashboard' && params.get('manage') && params.get('manage') !== 'starters') {
    return { name: 'Class Settings', routes: ['/class-management', '/dashboard?manage'] };
  }
  var names = {
    '/dashboard': 'Dashboard',
    '/assignments': 'Assignments',
    '/student': 'Student',
    '/gradebook': 'Gradebook',
    '/observations': 'Observations',
    '/observations/starters': 'Observations',
    '/reports': 'Reports',
  };
  var route = path === '/observations/starters' ? '/observations' : path;
  return { name: names[path] || 'Dashboard', routes: [names[path] ? route : '/dashboard'] };
}

function _helpLoadIndex() {
  if (_helpIndexState === 'loading' || _helpIndexState === 'ready') return;
  _helpIndexState = 'loading';
  fetch('/help/index.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('help index ' + r.status);
      return r.json();
    })
    .then(function (list) {
      if (!Array.isArray(list)) throw new Error('help index is not a list');
      _helpIndex = list.filter(function (a) {
        return a && typeof a.slug === 'string' && typeof a.title === 'string';
      });
      _helpIndexState = 'ready';
      _helpRenderBody();
    })
    .catch(function (err) {
      console.warn('Help index could not be loaded:', err);
      _helpIndexState = 'error';
      _helpRenderBody();
    });
}

function _helpArticle(slug) {
  return (_helpIndex || []).find(function (a) {
    return a.slug === slug;
  });
}
// Titles compare with straight and curly apostrophes alike (What's New).
function _helpSameTitle(a, b) {
  return String(a).replace(/’/g, "'") === String(b).replace(/’/g, "'");
}
function _helpArticleTitled(title) {
  return (_helpIndex || []).find(function (a) {
    return _helpSameTitle(a.title, title);
  });
}

// html-safe: titles and slugs are escaped.
function _helpRowsHTML(list) {
  return list
    .map(function (a) {
      return (
        '<button type="button" class="help-row" data-action="helpOpenArticle" data-slug="' +
        esc(a.slug) +
        '"><span class="help-row-title">' +
        esc(a.title) +
        '</span>' +
        (a.video ? '<span class="help-chip">Video</span>' : '') +
        '<span class="help-chev" aria-hidden="true">›</span></button>'
      );
    })
    .join('');
}

// html-safe: the heading and rows are escaped.
function _helpSectionHTML(heading, list) {
  if (!list.length) return '';
  return (
    '<section class="help-section"><h3 class="help-section-title">' +
    esc(heading) +
    '</h3><div class="help-list">' +
    _helpRowsHTML(list) +
    '</div></section>'
  );
}

/* Glossary, Keyboard Shortcuts, What's New and Report a Problem. Report a
   Problem appears once its form exists (window.openReportProblem). */
// html-safe: fixed labels; slugs are escaped.
function _helpBoxHTML() {
  function articleCell(title, slug) {
    var a = _helpArticle(slug) || _helpArticleTitled(title);
    return a
      ? '<button type="button" class="help-box-cell" data-action="helpOpenArticle" data-slug="' +
          esc(a.slug) +
          '">' +
          esc(title) +
          '</button>'
      : '<a class="help-box-cell" href="/help" target="_blank" rel="noopener">' + esc(title) + '</a>';
  }
  var cells = [
    articleCell('Glossary', 'glossary'),
    '<button type="button" class="help-box-cell" data-action="openKeyboardShortcuts" aria-keyshortcuts="?">Keyboard Shortcuts</button>',
    articleCell('What’s New', 'whats-new'),
  ];
  if (typeof window.openReportProblem === 'function') {
    cells.push(
      '<button type="button" class="help-box-cell help-box-report" data-action="openReportProblem">Report a Problem</button>',
    );
  }
  return '<div class="help-box">' + cells.join('') + '</div>';
}

// html-safe: every part is built by the escaping helpers above or is fixed text.
function _helpHomeHTML() {
  var list = _helpIndex || [];
  if (_helpQuery) {
    var words = _helpQuery.toLowerCase().split(/\s+/).filter(Boolean);
    var hits = list.filter(function (a) {
      var hay = (a.title + ' ' + (a.summary || '')).toLowerCase();
      return words.every(function (w) {
        return hay.indexOf(w) >= 0;
      });
    });
    return hits.length
      ? _helpSectionHTML('Search Results', hits)
      : '<p class="help-note">No articles match the search.</p>';
  }
  var page = _helpPage();
  // The page's own articles; Getting Started has its own list below.
  var onPage = list.filter(function (a) {
    return (
      a.section !== 'Getting Started' &&
      Array.isArray(a.pages) &&
      a.pages.some(function (p) {
        return page.routes.indexOf(p) >= 0;
      })
    );
  });
  var started = list.filter(function (a) {
    return (
      a.section === 'Getting Started' && !_helpSameTitle(a.title, 'Glossary') && !_helpSameTitle(a.title, 'What’s New')
    );
  });
  return (
    _helpSectionHTML(page.name, onPage) +
    _helpSectionHTML('Getting Started', started) +
    '<div class="help-spacer"></div>' +
    _helpBoxHTML() +
    '<a class="help-all-link" href="/help" target="_blank" rel="noopener">All Help Articles</a>'
  );
}

function _helpRenderBody() {
  var body = document.getElementById('help-body');
  if (!body) return;
  var search = document.getElementById('help-search-row');
  if (_helpIndexState === 'error') {
    if (search) search.hidden = true;
    // html-safe: HELP_LOAD_ERROR is a fixed sentence.
    body.innerHTML = '<p class="help-note">' + HELP_LOAD_ERROR + '</p>';
    return;
  }
  if (search) search.hidden = !!_helpSlug;
  if (_helpIndexState !== 'ready') {
    body.innerHTML = '';
    return;
  }
  if (_helpSlug) {
    _helpRenderArticle(body, _helpSlug);
    return;
  }
  // html-safe: _helpHomeHTML escapes every title, slug and heading.
  body.innerHTML = _helpHomeHTML();
  // Screen readers hear how a search came out.
  var status = document.getElementById('help-status');
  if (status) {
    var n = body.querySelectorAll('.help-row').length;
    status.textContent = !_helpQuery
      ? ''
      : n === 0
        ? 'No articles match the search.'
        : n === 1
          ? '1 article found.'
          : n + ' articles found.';
  }
}

/* An article inside the panel: Back, the help site's fragment, and Open in
   Help Site. The fragment is the help site's own built page section; it is
   parsed, and anything that could run (scripts, frames, on* handlers,
   javascript: links) is dropped before it is shown. Relative links and
   pictures resolve against /help/. */
function _helpRenderArticle(body, slug) {
  var a = _helpArticle(slug);
  body.innerHTML =
    '<button type="button" class="help-back" data-action="helpBack"><span aria-hidden="true">‹</span> Back</button>' +
    '<div class="help-article-wrap" id="help-article" aria-busy="true"></div>' +
    '<a class="help-all-link" href="/help/' +
    esc(slug) +
    '" target="_blank" rel="noopener">Open in Help Site</a>';
  var holder = document.getElementById('help-article');
  fetch('/help/fragments/' + encodeURIComponent(slug) + '.html', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('help fragment ' + r.status);
      return r.text();
    })
    .then(function (html) {
      if (_helpSlug !== slug || !holder.isConnected) return;
      holder.removeAttribute('aria-busy');
      // The help site's fragment is one <article class="help-article">;
      // anything else is put in one, so it shows on the same card.
      var nodes = _helpCleanFragment(html);
      var root =
        nodes.length === 1 && nodes[0].classList && nodes[0].classList.contains('help-article') ? nodes[0] : null;
      if (!root) {
        root = document.createElement('article');
        root.className = 'help-article';
        root.replaceChildren.apply(root, nodes);
      }
      if (a && !root.querySelector('h1, h2')) {
        var h = document.createElement('h1');
        h.textContent = a.title;
        root.prepend(h);
      }
      holder.replaceChildren(root);
    })
    .catch(function (err) {
      console.warn('Help article could not be loaded:', err);
      if (_helpSlug !== slug || !holder.isConnected) return;
      holder.removeAttribute('aria-busy');
      var p = document.createElement('p');
      p.className = 'help-note';
      p.textContent = 'The article could not be loaded.';
      holder.replaceChildren(p);
    });
}

/* Only the tags and attributes a help article uses are kept; anything
   else (scripts, frames, SVG, forms, on* handlers, styles) is dropped. */
const HELP_TAGS = {
  ARTICLE: 1,
  SECTION: 1,
  DIV: 1,
  SPAN: 1,
  P: 1,
  H1: 1,
  H2: 1,
  H3: 1,
  H4: 1,
  OL: 1,
  UL: 1,
  LI: 1,
  STRONG: 1,
  B: 1,
  EM: 1,
  I: 1,
  CODE: 1,
  KBD: 1,
  BR: 1,
  HR: 1,
  A: 1,
  IMG: 1,
  FIGURE: 1,
  FIGCAPTION: 1,
  BLOCKQUOTE: 1,
  TABLE: 1,
  THEAD: 1,
  TBODY: 1,
  TR: 1,
  TH: 1,
  TD: 1,
  VIDEO: 1,
  SOURCE: 1,
};
const HELP_ATTRS = {
  class: 1,
  id: 1,
  href: 1,
  src: 1,
  alt: 1,
  title: 1,
  width: 1,
  height: 1,
  colspan: 1,
  rowspan: 1,
  controls: 1,
  poster: 1,
  loading: 1,
  type: 1,
};
function _helpCleanUrl(value) {
  var url;
  try {
    url = new URL(value, location.origin + '/help/');
  } catch (e) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:') return null;
  return url.origin === location.origin ? url.pathname + url.search + url.hash : url.href;
}
function _helpCleanFragment(html) {
  var doc = new DOMParser().parseFromString(String(html), 'text/html');
  (function clean(parent) {
    Array.prototype.slice.call(parent.children).forEach(function (el) {
      if (!HELP_TAGS[el.tagName]) {
        el.remove();
        return;
      }
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        if (!HELP_ATTRS[name]) {
          el.removeAttribute(attr.name);
        } else if (name === 'href' || name === 'src' || name === 'poster') {
          var url = _helpCleanUrl(attr.value);
          if (url === null) el.removeAttribute(attr.name);
          else el.setAttribute(attr.name, url);
        }
      });
      if (el.tagName === 'A' && el.getAttribute('href')) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener');
      }
      clean(el);
    });
  })(doc.body);
  return Array.prototype.slice
    .call(doc.body.childNodes)
    .filter(function (n) {
      return n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim());
    })
    .map(function (n) {
      return document.importNode(n, true);
    });
}

// html-safe: the icons and labels are fixed markup.
function _helpPanelHTML() {
  return `<div class="help-head">
      <div class="help-head-row">
        <h2 class="help-title" id="help-title">Help</h2>
        <button type="button" class="help-close" data-action="closeHelp" aria-label="Close Help" aria-keyshortcuts="Escape">×</button>
      </div>
      <label class="help-search" id="help-search-row">${HELP_SEARCH_SVG}<input type="search" id="help-search" placeholder="Search Help" aria-label="Search Help" autocomplete="off"></label>
    </div>
    <p class="help-sr-only" id="help-status" role="status"></p>
    <div class="help-body" id="help-body"></div>`;
}

/* Draws or removes the panel to match _helpOpen, and refreshes the list
   for the open page. */
function _helpSync() {
  var layout = document.getElementById('page-layout');
  if (!layout || typeof layout.appendChild !== 'function') return;
  var panel = document.getElementById('help-panel');
  if (!_helpOpen) {
    if (panel && typeof panel.remove === 'function') panel.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement('aside');
    panel.id = 'help-panel';
    panel.className = 'help-panel';
    panel.setAttribute('aria-labelledby', 'help-title');
    // html-safe: _helpPanelHTML is fixed markup.
    panel.innerHTML = _helpPanelHTML();
    layout.appendChild(panel);
    var input = panel.querySelector('#help-search');
    input.value = _helpQuery;
    input.addEventListener('input', function () {
      _helpQuery = input.value.trim();
      _helpSlug = null;
      _helpRenderBody();
    });
  }
  _helpLoadIndex();
  // An open article stays as it is (scroll and focus too) when the teacher
  // moves to another page to follow its steps.
  if (!_helpSlug || !document.getElementById('help-article')) _helpRenderBody();
}

function setHelpOpen(open, focusButton) {
  _helpOpen = !!open;
  // Help and Class Results share the side of the page: one at a time.
  if (_helpOpen && window.ClassResults && ClassResults.isOpen()) ClassResults.close();
  try {
    localStorage.setItem(HELP_OPEN_KEY, _helpOpen ? '1' : '0');
  } catch (e) {
    /* the choice lasts for this page only */
  }
  document.querySelectorAll('[data-action="toggleHelp"]').forEach(function (btn) {
    btn.classList.toggle('is-open', _helpOpen);
    btn.setAttribute('aria-expanded', _helpOpen ? 'true' : 'false');
  });
  _helpSync();
  if (_helpOpen) {
    var input = document.getElementById('help-search');
    if (input && !_helpSlug) input.focus();
  } else if (focusButton) {
    var btn = document.querySelector('[data-action="toggleHelp"]');
    if (btn) btn.focus();
  }
}

function _helpOpenArticle(slug) {
  _helpSlug = slug;
  _helpRenderBody();
  var back = document.querySelector('#help-body .help-back');
  if (back) back.focus();
}

// A link inside an article to another help article opens it in the panel.
document.addEventListener('click', function (e) {
  var link = e.target.closest && e.target.closest('#help-article a[href^="/help/"]');
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  var slug = link
    .getAttribute('href')
    .replace(/^\/help\//, '')
    .replace(/[?#].*$/, '');
  if (!_helpArticle(slug)) return;
  e.preventDefault();
  _helpOpenArticle(slug);
});

/* Escape closes the panel when the focus is in it (or on nothing), and no
   dialog is open over the page. */
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape' || !_helpOpen) return;
  if (document.querySelector('.confirm-overlay, [aria-modal="true"], .tb-demo-menu.open, .tb-user-menu.open')) return;
  var panel = document.getElementById('help-panel');
  var active = document.activeElement;
  var inPanel = panel && active && panel.contains(active);
  var onButton = active && active.matches && active.matches('[data-action="toggleHelp"]');
  if (!inPanel && !onButton && active && active !== document.body) return;
  e.preventDefault();
  setHelpOpen(false, true);
});

/* ── Report a Problem ────────────────────────────────────────
   A form from the Help panel, the account menu, and the help site
   (/dashboard?report=1). The teacher describes the problem; the form shows
   what goes with it, the page's name, the build and the browser, and never
   student data. Send goes through the outbox (submitSupportReport in
   shared/data.js). Demo Mode has no account to send from: Copy Text copies
   the report instead. */

/* The browser and system, in words: "Chrome 131 on macOS". */
function reportBrowserText(ua) {
  ua = String(ua || '');
  var name = 'Browser';
  var m;
  if ((m = ua.match(/Edg\/(\d+)/))) name = 'Edge ' + m[1];
  else if ((m = ua.match(/Firefox\/(\d+)/))) name = 'Firefox ' + m[1];
  else if ((m = ua.match(/(?:Chrome|CriOS)\/(\d+)/))) name = 'Chrome ' + m[1];
  else if ((m = ua.match(/Version\/(\d+)[.\d]* .*Safari/))) name = 'Safari ' + m[1];
  var os = '';
  if (/iPad/.test(ua)) os = 'iPadOS';
  else if (/iPhone/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';
  return os ? name + ' on ' + os : name;
}

/* This deploy's build: the service worker's cache is named after the commit
   Netlify built (scripts/build.sh). */
function _reportBuildId() {
  if (!window.caches || typeof caches.keys !== 'function') return Promise.resolve('');
  return caches
    .keys()
    .then(function (keys) {
      // While a new deploy installs there are two; the newest is last.
      var ours = keys.filter(function (x) {
        return /^fullvision-/.test(x);
      });
      var k = ours[ours.length - 1];
      return k ? k.replace(/^fullvision-/, '') : '';
    })
    .catch(function () {
      return '';
    });
}

function _reportAttachedText(page, build) {
  return ['Page: ' + page, 'FullVision' + (build ? ' ' + build : ''), reportBrowserText(navigator.userAgent)].join(
    ' · ',
  );
}

function openReportProblem(opts) {
  opts = opts || {};
  if (document.getElementById('report-problem')) return;
  // Close the menus it can be opened from.
  document.querySelectorAll('.tb-user-menu.open').forEach(function (m) {
    m.classList.remove('open');
    var b = m.querySelector('.tb-user-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
  });
  var page = opts.page || _helpPage().name;
  var build = '';
  var demo = typeof isDemoMode === 'function' && isDemoMode();
  var trigger = document.activeElement;
  // From the account menu, which closes: the focus goes back to its button.
  var menu = trigger && trigger.closest && trigger.closest('.tb-user-menu');
  if (menu) trigger = menu.querySelector('.tb-user-btn');
  var overlay = document.createElement('div');
  overlay.className = 'confirm-overlay cm-help-overlay';
  overlay.id = 'report-problem';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'report-problem-title');
  // html-safe: the page name is escaped; the rest is fixed markup.
  overlay.innerHTML =
    '<div class="cm-help-card report-card">' +
    '<div class="cm-help-head">' +
    '<h2 class="cm-help-title" id="report-problem-title">Report a Problem</h2>' +
    '<button type="button" class="cm-help-close" data-report="close" aria-label="Close">×</button>' +
    '</div>' +
    '<div class="report-body" id="report-body">' +
    '<label class="report-label" for="report-message">Describe the Problem</label>' +
    '<textarea class="report-message" id="report-message" rows="6" maxlength="5000" aria-describedby="report-hint"></textarea>' +
    '<p class="report-hint" id="report-hint">Do not include student names.</p>' +
    '<p class="report-attached" id="report-attached">' +
    esc(_reportAttachedText(page, build)) +
    '</p>' +
    '<div class="report-actions">' +
    (demo
      ? '<p class="report-demo-note">Reports are sent from a signed-in account.</p>' +
        '<button type="button" class="btn btn-ghost" data-report="cancel">Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-report="copy">Copy Text</button>'
      : '<span class="report-spacer"></span>' +
        '<button type="button" class="btn btn-ghost" data-report="cancel">Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-report="send" disabled>Send</button>') +
    '</div></div></div>';
  document.body.appendChild(overlay);
  var text = overlay.querySelector('#report-message');
  var attached = overlay.querySelector('#report-attached');
  var send = overlay.querySelector('[data-report="send"]');
  _reportBuildId().then(function (id) {
    build = id;
    if (attached.isConnected) attached.textContent = _reportAttachedText(page, build);
  });
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    try {
      if (trigger && typeof trigger.focus === 'function') trigger.focus();
    } catch (e) {
      /* the trigger may be gone */
    }
  }
  function focusables() {
    return Array.prototype.filter.call(overlay.querySelectorAll('button, textarea'), function (el) {
      return !el.disabled;
    });
  }
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      var f = focusables();
      var i = f.indexOf(document.activeElement);
      if (i < 0) {
        e.preventDefault();
        f[0].focus();
      } else if (e.shiftKey && i === 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    }
  }
  function done(message) {
    var body = overlay.querySelector('#report-body');
    // html-safe: message is one of two fixed sentences.
    body.innerHTML =
      '<p class="report-done" role="status">' +
      message +
      '</p><div class="report-actions"><span class="report-spacer"></span>' +
      '<button type="button" class="btn btn-primary" data-report="close">Done</button></div>';
    body.querySelector('[data-report="close"]').focus();
  }
  if (send) {
    text.addEventListener('input', function () {
      send.disabled = !text.value.trim();
    });
  }
  overlay.addEventListener('click', function (e) {
    // A click beside the form closes it only when nothing has been typed.
    if (e.target === overlay) {
      if (!text.isConnected || !text.value.trim()) close();
      return;
    }
    var b = e.target.closest('[data-report]');
    if (!b) return;
    var act = b.getAttribute('data-report');
    if (act === 'close' || act === 'cancel') close();
    else if (act === 'send') {
      var message = text.value.trim();
      if (!message || b.disabled) return;
      b.disabled = true;
      b.textContent = 'Sending';
      var sent = window.submitSupportReport({
        page: page,
        message: message,
        browser: reportBrowserText(navigator.userAgent),
        appVersion: build,
      });
      // Sent once the server has it. A write that has to wait (offline, or
      // the server is slow) stays in the outbox and is sent later; the sync
      // dot shows it until then.
      var waited = new Promise(function (resolve) {
        setTimeout(function () {
          resolve(null);
        }, 8000);
      });
      Promise.race([Promise.resolve(sent), waited]).then(function (res) {
        if (!overlay.isConnected) return;
        done(
          res && !res.error
            ? 'The report has been sent.'
            : 'The report is saved on this device and will be sent when the connection allows.',
        );
      });
    } else if (act === 'copy') {
      var copy = (text.value.trim() ? text.value.trim() + '\n\n' : '') + _reportAttachedText(page, build);
      _copyTextToClipboard(copy).then(function (ok) {
        if (!ok) return;
        b.textContent = 'Copied';
        setTimeout(function () {
          if (b.isConnected) b.textContent = 'Copy Text';
        }, 1500);
      });
    }
  });
  document.addEventListener('keydown', onKey, true);
  text.focus();
}
window.openReportProblem = openReportProblem;

/* The help site's Report a Problem links to /dashboard?report=1: the form
   opens once, with Page "Help site", and the address drops the parameter. */
let _reportFromUrlDone = false;
function _reportFromUrl() {
  if (_reportFromUrlDone) return;
  var params = new URLSearchParams((location && location.search) || '');
  if (params.get('report') !== '1') return;
  _reportFromUrlDone = true;
  params.delete('report');
  var q = params.toString();
  var url = location.pathname + (q ? '?' + q : '');
  // Through the router, so it knows the address it is on.
  if (window.Router && typeof Router.setUrl === 'function') Router.setUrl(url);
  else history.replaceState(history.state, '', url + location.hash);
  openReportProblem({ page: 'Help site' });
}

/* ── Keyboard Shortcuts sheet ─────────────────────────────────
   Every shortcut in KEYBOARD_SHORTCUTS (shared/constants.js), grouped by
   where it works, in the Where These Appear modal's chrome. Opens from the
   Help panel and from ? when no field has the focus. */
function _isMacKeyboard() {
  var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent;
  return /mac|iphone|ipad/i.test(p || '');
}

/* The key names to show for one aria-keyshortcuts value: the ⌘ form on a
   Mac, the Ctrl form elsewhere. */
function shortcutKeys(value, mac) {
  var alts = String(value).split(' ').filter(Boolean);
  var pick =
    alts.find(function (a) {
      return mac ? a.indexOf('Meta') >= 0 : a.indexOf('Meta') < 0;
    }) || alts[0];
  var names = { Control: 'Ctrl', Meta: '⌘', Escape: 'Esc' };
  return pick.split('+').map(function (k) {
    return names[k] || k;
  });
}

// html-safe: every label comes from KEYBOARD_SHORTCUTS and is escaped.
function _shortcutsBodyHTML(mac) {
  var groups = [];
  KEYBOARD_SHORTCUTS.forEach(function (s) {
    var g = groups.find(function (x) {
      return x.context === s.context;
    });
    if (!g) groups.push((g = { context: s.context, rows: [] }));
    g.rows.push(s);
  });
  return groups
    .map(function (g) {
      return (
        '<section class="kbd-group"><h3 class="kbd-group-title">' +
        esc(g.context) +
        '</h3><dl class="kbd-list">' +
        g.rows
          .map(function (s) {
            return (
              '<div class="kbd-row"><dt>' +
              esc(s.action) +
              '</dt><dd>' +
              shortcutKeys(s.keys, mac)
                .map(function (k) {
                  return '<kbd>' + esc(k) + '</kbd>';
                })
                .join('<span class="kbd-plus" aria-hidden="true">+</span>') +
              '</dd></div>'
            );
          })
          .join('') +
        '</dl></section>'
      );
    })
    .join('');
}

function openKeyboardShortcuts() {
  if (document.getElementById('kbd-sheet')) return;
  var trigger = document.activeElement;
  var overlay = document.createElement('div');
  overlay.className = 'confirm-overlay cm-help-overlay';
  overlay.id = 'kbd-sheet';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'kbd-sheet-title');
  // html-safe: _shortcutsBodyHTML escapes every label; the rest is fixed markup.
  overlay.innerHTML =
    '<div class="cm-help-card kbd-card">' +
    '<div class="cm-help-head">' +
    '<h2 class="cm-help-title" id="kbd-sheet-title">Keyboard Shortcuts</h2>' +
    '<button type="button" class="cm-help-close" aria-label="Close">×</button>' +
    '</div>' +
    '<div class="kbd-body">' +
    _shortcutsBodyHTML(_isMacKeyboard()) +
    '</div></div>';
  document.body.appendChild(overlay);
  var closeBtn = overlay.querySelector('.cm-help-close');
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    try {
      if (trigger && typeof trigger.focus === 'function') trigger.focus();
    } catch (e) {
      /* the trigger may be gone */
    }
  }
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      // The close button is the only control: the focus stays on it.
      e.preventDefault();
      closeBtn.focus();
    }
  }
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey, true);
  closeBtn.focus();
}

// ? opens the sheet when no field has the focus and nothing is open over the page.
document.addEventListener('keydown', function (e) {
  if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
  var t = document.activeElement;
  if (
    t &&
    t.closest &&
    t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]')
  )
    return;
  if (document.querySelector('.confirm-overlay, [aria-modal="true"]')) return;
  e.preventDefault();
  openKeyboardShortcuts();
});

// html-safe: TB_PAGES, OFFLINE_BANNER_COPY and the icons are fixed; the only caller (router.js) passes no rightHTML.
function renderDock(activePage, rightHTML) {
  _ensureSyncStatusUI();
  // The router draws the dock on every route change; the Help panel then
  // shows the new page's articles.
  setTimeout(function () {
    _helpSync();
    _reportFromUrl();
  }, 0);
  const ap = activePage === 'student' ? 'dashboard' : activePage;
  const seg = TB_PAGES.map(
    p =>
      `<a role="link" tabindex="0" data-href="${p.href}" class="seg-btn tb-seg-link${p.id === ap ? ' tb-seg-active" aria-current="page' : ''}">${p.label}</a>`,
  ).join('');

  // Reset Demo deletes every class before reseeding, so it exists only in
  // Demo Mode, never for a signed-in teacher.
  const resetDemo =
    typeof isDemoMode === 'function' && isDemoMode()
      ? '<button class="tb-user-signout" data-action="resetDemoData">Reset Demo Data</button>'
      : '';
  const userMenu = `<div class="tb-user-menu">
    <button class="tb-user-btn" data-action="toggleUserMenu" title="Account" aria-label="Account menu" aria-expanded="false" aria-haspopup="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3 2.5-5 6-5s6 2 6 5"/></svg>
      <span class="tb-user-name" id="tb-user-name"></span>
    </button>
    <div class="tb-user-dropdown">
      <button class="tb-user-item tb-user-help" data-action="openHelpFromMenu">Help</button><button class="tb-user-item" data-action="openReportProblem">Report a Problem</button>${resetDemo}<button class="tb-user-signout" data-action="signOut">Sign Out</button>
    </div>
  </div>`;

  return `<div class="offline-banner" id="offline-banner" role="status" aria-live="polite" hidden>${OFFLINE_BANNER_COPY}</div>
  <nav id="app-dock" role="navigation" aria-label="Main navigation">
    <div class="tb-group tb-left">
      <button class="tb-btn" data-action="toggleSidebar" title="Toggle Sidebar" aria-label="Toggle Sidebar">${TB_SIDEBAR_SVG}</button>${demoPillHTML()}
    </div>
    <div class="tb-group tb-center">
      <div class="seg tb-seg">${seg}</div>
    </div>
    <div class="tb-group tb-right">${rightHTML || ''}<div class="tb-sync" role="status" aria-label="Sync status" data-action="retry-sync-dot"><div class="tb-sync-dot idle" id="sync-indicator-dot" title="All changes saved" aria-label="All changes saved"></div></div>${helpButtonHTML()}${userMenu}</div>
  </nav>`;
}

function _getQueueStats() {
  if (!window.v2Queue || typeof window.v2Queue.stats !== 'function') {
    return {
      queued: 0,
      deadLettered: 0,
      signedOut: false,
      lastFlushAt: null,
      online: navigator.onLine !== false,
      flushing: false,
    };
  }
  var stats = window.v2Queue.stats() || {};
  return {
    queued: Number(stats.queued || 0),
    deadLettered: Number(stats.deadLettered || 0),
    signedOut: !!stats.signedOut,
    lastFlushAt: stats.lastFlushAt || null,
    online: stats.online !== false,
    flushing: !!stats.flushing,
  };
}

// Sync shows only as the dot: no count, popover or list of failed writes
// (Oct 2026). Teachers found the number confusing; the dot's colour and
// tooltip say all they need, and the tooltip carries no count either.
function refreshSyncStatusUI() {
  var stats = _getQueueStats();
  var banner = document.getElementById('offline-banner');
  var body = document.body;

  if (banner) {
    banner.hidden = !!stats.online;
  }
  if (body && body.classList && typeof body.classList.toggle === 'function') {
    body.classList.toggle('offline-active', !stats.online);
  }

  // The dot is drawn in one place (shared/data.js getSyncDotState), so the
  // phone and desktop agree and two painters can't contradict each other.
  if (typeof _updateSyncIndicator === 'function') _updateSyncIndicator();
}

/* A click on a red sync dot tries again at once: paused cloud sync probes
   the server, a class that couldn't load loads again. Otherwise it does
   nothing; the outbox already retries on its own. */
function _retryFromSyncDot() {
  var dot = document.getElementById('sync-indicator-dot');
  if (!dot || !/\berror\b/.test(dot.className || '')) return;
  if (window.GB && typeof window.GB.isSupabaseDegraded === 'function' && window.GB.isSupabaseDegraded()) {
    if (typeof window.GB.retrySupabaseRecovery === 'function') window.GB.retrySupabaseRecovery();
    return;
  }
  var cid = typeof getActiveCourse === 'function' ? getActiveCourse() : null;
  if (cid && typeof courseLoadFailed === 'function' && courseLoadFailed(cid)) {
    if (typeof window.retryActiveCourseLoad === 'function') window.retryActiveCourseLoad();
  }
}

function _ensureSyncStatusUI() {
  if (_syncUIBound) return;
  _syncUIBound = true;
  if (window.v2Queue && typeof window.v2Queue.subscribe === 'function') {
    _syncUIUnsubscribe = window.v2Queue.subscribe(function () {
      refreshSyncStatusUI();
    });
  }
  window.addEventListener('online', refreshSyncStatusUI);
  window.addEventListener('offline', refreshSyncStatusUI);
}

async function retrySyncQueue() {
  var q = window.v2Queue;
  if (!q || typeof q.flush !== 'function') return;
  // resume() also lifts a pause left by an expired session.
  var result = typeof q.resume === 'function' ? await q.resume() : await q.flush();
  refreshSyncStatusUI();
  if (typeof showSyncToast === 'function') {
    if (result && result.succeeded > 0) showSyncToast('Queued changes synced.', 'success');
  }
}

function _getLocalStorageKeys() {
  if (!localStorage) return [];
  if (typeof localStorage.length === 'number' && typeof localStorage.key === 'function') {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      keys.push(localStorage.key(i));
    }
    return keys.filter(Boolean);
  }
  if (localStorage._store) return Object.keys(localStorage._store);
  return Object.keys(localStorage).filter(function (key) {
    return typeof localStorage[key] !== 'function';
  });
}

function _getStoredAuthEmail() {
  var keys = _getLocalStorageKeys();
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (!/^sb-.*-auth-token$/.test(key || '')) continue;
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || 'null') || {};
      var email =
        (parsed.user && parsed.user.email) ||
        (parsed.currentSession && parsed.currentSession.user && parsed.currentSession.user.email) ||
        (parsed.session && parsed.session.user && parsed.session.user.email) ||
        '';
      if (email) return email;
    } catch (e) {
      /* ignore malformed auth cache */
    }
  }
  return '';
}

function _clearSessionExpiredState() {
  _sessionExpiredRetries = {};
  _sessionExpiredCopyDraft = null;
  _sessionExpiredModalOpen = false;
}

function _copySessionExpiredDraft() {
  if (!_sessionExpiredCopyDraft) return Promise.resolve(false);
  var text = (_sessionExpiredCopyDraft() || '').trim();
  if (!text) return Promise.resolve(false);
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text).then(
      function () {
        return true;
      },
      function () {
        return false;
      },
    );
  }
  return Promise.resolve(false);
}

function _showSessionExpiredDraftToast() {
  dismissSyncToast();
  var toast = document.createElement('div');
  toast.className = 'sync-toast error';
  toast.id = 'sync-toast';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.innerHTML =
    '<span>Session expired. Copy your draft before it is lost.</span><button class="sync-toast-btn" data-action="copy-session-draft">Copy Draft</button>';
  document.body.appendChild(toast);
}

function queueSessionExpiredRetry(opts) {
  opts = opts || {};
  if (typeof opts.retry !== 'function') return;
  var key = opts.key || 'default';
  _sessionExpiredRetries[key] = opts.retry;
  if (typeof opts.getDraftText === 'function') {
    _sessionExpiredCopyDraft = opts.getDraftText;
  }
  if (_sessionExpiredModalOpen) return;
  _sessionExpiredModalOpen = true;

  var email = opts.email || _getStoredAuthEmail();
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'session-expired-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'session-expired-title');
  overlay.innerHTML = `<div class="modal-box session-expired-modal">
    <div class="confirm-title" id="session-expired-title">Session Expired</div>
    <div class="confirm-message">Enter your password to keep working without losing this draft.</div>
    <div class="confirm-form">
      <label class="confirm-field">
        <span class="confirm-label">Email</span>
        <input class="confirm-input" id="session-expired-email" type="email" value="${esc(email)}" autocomplete="email">
      </label>
      <label class="confirm-field">
        <span class="confirm-label">Password</span>
        <input class="confirm-input" id="session-expired-password" type="password" autocomplete="current-password" placeholder="Current password">
      </label>
    </div>
    <div class="session-expired-note">Your draft stays on screen while you reconnect.</div>
    <div class="confirm-error" id="session-expired-error" aria-live="polite"></div>
    <div class="session-expired-actions">
      <button class="confirm-cancel" id="session-expired-cancel">Not now</button>
      <button class="confirm-ok primary" id="session-expired-submit">Continue</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  var emailInput = overlay.querySelector('#session-expired-email');
  var passwordInput = overlay.querySelector('#session-expired-password');
  var errorEl = overlay.querySelector('#session-expired-error');
  var cancelBtn = overlay.querySelector('#session-expired-cancel');
  var submitBtn = overlay.querySelector('#session-expired-submit');

  function closeModal(showDraftToast) {
    overlay.remove();
    _sessionExpiredModalOpen = false;
    if (showDraftToast) _showSessionExpiredDraftToast();
  }

  cancelBtn.onclick = function () {
    _sessionExpiredRetries = {};
    closeModal(true);
  };

  overlay.addEventListener('click', function (evt) {
    if (evt.target === overlay) {
      _sessionExpiredRetries = {};
      closeModal(true);
    }
  });

  submitBtn.onclick = async function () {
    errorEl.textContent = '';
    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      await signIn(emailInput.value.trim(), passwordInput.value);
      var retryKeys = Object.keys(_sessionExpiredRetries);
      for (var i = 0; i < retryKeys.length; i++) {
        var res = await _sessionExpiredRetries[retryKeys[i]]();
        if (res && res.error) throw res.error.sourceError || res.error;
      }
      _clearSessionExpiredState();
      overlay.remove();
      if (typeof showSyncToast === 'function') {
        showSyncToast('Session restored. Draft saved.', 'success');
      }
    } catch (err) {
      errorEl.textContent = (err && err.message) || 'Could not restore your session.';
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  };

  passwordInput.focus();
}

/* ── Populate user display name in dock ────────────────────── */
function _populateDockUser() {
  const el = document.getElementById('tb-user-name');
  if (!el || typeof getSupabase !== 'function') return;
  const sb = getSupabase();
  if (!sb) return;
  sb.auth
    .getSession()
    .then(({ data: { session } }) => {
      if (!session) return;
      const user = session.user;
      const name = user.user_metadata?.display_name || user.email?.split('@')[0] || 'User';
      el.textContent = name;
    })
    .catch(err => {
      console.warn('Could not load user session for dock:', err);
      el.textContent = 'User';
    });
}
// Run after DOM renders (next tick)
setTimeout(_populateDockUser, 0);

/* ── Prefetch (disabled in SPA — all modules already loaded) ── */

// Close user dropdown on click outside
document.addEventListener('click', function (e) {
  const menu = document.querySelector('.tb-user-menu');
  if (menu && !menu.contains(e.target)) {
    menu.classList.remove('open');
    const button = menu.querySelector('.tb-user-btn');
    if (button) button.setAttribute('aria-expanded', 'false');
  }
});
// Escape closes it too, and puts the focus back on the account button.
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  const menu = document.querySelector('.tb-user-menu.open');
  if (!menu) return;
  menu.classList.remove('open');
  const button = menu.querySelector('.tb-user-btn');
  if (button) {
    button.setAttribute('aria-expanded', 'false');
    button.focus();
  }
  e.preventDefault();
});

/* ── Upcoming Birthdays ────────────────────────────────────── */
function getUpcomingBirthdays(cid) {
  const students = getStudents(cid);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();

  return students
    .filter(s => s.dateOfBirth)
    .map(s => {
      const dob = parseLocalDate(s.dateOfBirth);
      let nextBday = new Date(thisYear, dob.getMonth(), dob.getDate());
      nextBday.setHours(0, 0, 0, 0);
      if (nextBday < today) nextBday.setFullYear(thisYear + 1);
      const daysUntil = Math.round((nextBday - today) / (1000 * 60 * 60 * 24));
      return { student: s, nextBday, daysUntil };
    })
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 3);
}

/* ── Shared HTML: Student Header ────────────────────────────── */
/* ── Segmented control (.seg in styles.css) ─────────────────── */
/* The chosen segment carries the ARIA state its role calls for:
   aria-selected on a tab, aria-checked on a radio, aria-pressed on a plain
   button, aria-current on a page link. segAttr() writes it into markup;
   segSelect() moves it to btn within its .seg, along with the .active class
   older selectors still read. */
function _segStateAttr(role, tag) {
  if (role === 'tab') return 'aria-selected';
  if (role === 'radio') return 'aria-checked';
  if (tag === 'A') return 'aria-current';
  return 'aria-pressed';
}
function segAttr(on, role) {
  var name = _segStateAttr(role, '');
  return (role ? ' role="' + role + '"' : '') + ' ' + name + '="' + (on ? 'true' : 'false') + '"';
}
function segSelect(btn) {
  var seg = btn && btn.closest('.seg');
  if (!seg) return;
  seg.querySelectorAll('.seg-btn').forEach(function (b) {
    var on = b === btn;
    var name = _segStateAttr(b.getAttribute('role'), b.tagName);
    b.classList.toggle('active', on);
    if (name === 'aria-current') {
      if (on) b.setAttribute(name, 'page');
      else b.removeAttribute(name);
    } else {
      b.setAttribute(name, on ? 'true' : 'false');
    }
  });
}

/* ── Breadcrumb ────────────────────────────────────────────────
   Screens that belong to the dashboard (a student page, Class Settings)
   keep "Dashboard" lit in the top nav and show where they are at the left
   of their toolbar: "Dashboard › Mei Wong". The first part links back.
   parentAction is a data-action for screens that close in place. */
// html-safe: every argument goes through esc.
function renderBreadcrumb(parentLabel, parentHref, currentLabel, parentAction) {
  return (
    '<nav class="tb-breadcrumb" aria-label="Breadcrumb"><ol>' +
    '<li><a role="link" tabindex="0" data-href="' +
    esc(parentHref) +
    '"' +
    (parentAction ? ' data-action="' + esc(parentAction) + '"' : '') +
    '>' +
    esc(parentLabel) +
    '</a></li>' +
    '<li><span aria-current="page">' +
    esc(currentLabel) +
    '</span></li>' +
    '</ol></nav>'
  );
}

function renderStudentHeader(cid, sid, opts) {
  opts = opts || {};
  const course = COURSES[cid];
  const students = getStudents(cid);
  const student = students.find(s => s.id === sid);
  if (!student) return '';

  // The header's work counts cover the work its grade counts (the year so far, or a report's year to date).
  const inTerm = typeof assessmentInYearToDate === 'function';
  const assessments = getAssessments(cid).filter(a => !inTerm || assessmentInYearToDate(cid, a));
  const overall = getOverallProficiency(cid, sid);
  const overallRounded = Math.round(overall);
  const profColor = PROF_COLORS[overallRounded] || PROF_COLORS[0];

  // Missing / Excused / Late work
  const statuses = getAssignmentStatuses(cid);
  const nsAssignments = [],
    excAssignments = [],
    lateAssignments = [];
  assessments.forEach(a => {
    const st = statuses[sid + ':' + a.id];
    if (st === 'NS') nsAssignments.push(a.title);
    else if (st === 'EXC') excAssignments.push(a.title);
    else if (st === 'LATE') lateAssignments.push(a.title);
  });

  // Designations sit beside the name, where they are seen first.
  let tags = '';
  let hasIep = false,
    hasMod = false;
  (student.designations || []).forEach(code => {
    const d = designationInfo(code);
    if (!d) return;
    tags += `<span class="sh-tag sh-tag-desig${d.level > 0 ? ' low-inc' : ''}" title="${code} \u2014 ${d.name}${d.iep ? ' \u00b7 IEP Required' : ''}${d.modified ? ' \u00b7 Modified Program' : ''}"><strong>${code}</strong> ${d.name}</span>`;
    if (d.iep) hasIep = true;
    if (d.modified) hasMod = true;
  });
  if (hasIep) tags += `<span class="sh-tag sh-tag-iep">IEP</span>`;
  if (hasMod) tags += `<span class="sh-tag sh-tag-mod">Modified</span>`;

  // One line under the name: pronouns, student number and email (each
  // copies on a click), birthday.
  const meta = [];
  if (student.pronouns) meta.push(`<span>${esc(student.pronouns)}</span>`);
  if (student.studentNumber)
    meta.push(
      `<button type="button" class="sh-copy" data-action="copy-student-field" data-copy="${esc(student.studentNumber)}" title="Copy student number" aria-label="Student number ${esc(student.studentNumber)}, copy">${esc(student.studentNumber)}</button>`,
    );
  if (student.dateOfBirth) meta.push(`<span title="Birthday">${formatDate(student.dateOfBirth)}</span>`);
  if (student.email)
    meta.push(
      `<button type="button" class="sh-copy" data-action="copy-student-field" data-copy="${esc(student.email)}" title="Copy email" aria-label="Email ${esc(student.email)}, copy">${esc(student.email)}</button>`,
    );

  let html = `<div class="student-header-top">`;
  html += `<div class="student-avatar-xl" aria-hidden="true">${initials(student)}</div>`;
  html += `<div class="student-identity-text">
    <div class="sh-name-row"><span class="student-name-xl">${esc(displayNameWithLast(student))}</span>${tags}</div>
    ${meta.length ? `<div class="sh-meta">${meta.join('<span class="sh-dot" aria-hidden="true">\u00b7</span>')}</div>` : ''}
  </div>`;
  html += `<div class="sh-spacer"></div>`;

  const work = [
    [nsAssignments, 'Missing', 'var(--score-1)'],
    [excAssignments, 'Excused', ''],
    [lateAssignments, 'Late', 'var(--score-2)'],
  ].filter(w => w[0].length);
  if (work.length) {
    html += `<div class="sh-stats">`;
    work.forEach(([list, label, color]) => {
      html += `<div class="sh-stat" title="${list.map(t => esc(t)).join('\n')}">
      <div class="sh-stat-val"${color ? ` style="color:${color}"` : ''}>${list.length}</div>
      <div class="sh-stat-label">${label}</div>
    </div>`;
    });
    html += `</div>`;
  }

  // A Letter class shows only the letter grade; Proficiency only the level;
  // Both shows both (courseGradeMode).
  const letterOnly = courseGradeMode(cid) === 'letter';
  if (!letterOnly) {
    html += `<div class="overall-card" style="--grade-c:${profColor}">
    <span class="overall-val">${levelFigure(overall)}</span>
    <span class="overall-word">${PROF_LABELS[overallRounded] || 'No Evidence'}</span>
  </div>`;
  }
  // A points class with no linked competencies has a % but no proficiency.
  const lg =
    typeof getCourseLetterData === 'function' && courseShowsLetterGrades(course)
      ? getCourseLetterData(cid, student.id)
      : null;
  if (lg && (lg.R != null || overall > 0 || letterOnly)) {
    html += `<div class="letter-card">
      <span class="letter-val">${lg && lg.S ? lg.S : '—'}</span>
      <span class="letter-pct">${lg && lg.R != null ? lg.R + '%' : '—'}</span>
    </div>`;
  }
  if (opts.buttonLabel && opts.buttonHref) {
    // A link to another screen is navigation, so it is secondary unless it is
    // the screen's main action (docs/DECISIONS.md, "Buttons").
    const btnCls = 'page-toggle-btn' + (opts.buttonSecondary ? ' page-toggle-btn--secondary' : '');
    html += `<a class="${btnCls}" role="link" tabindex="0" data-href="${opts.buttonHref}">${esc(opts.buttonLabel)}</a>`;
  }
  html += `</div>`; // end student-header-top
  return html;
}

/* ── Shared HTML: Sidebar ───────────────────────────────────── */
function _avatarColor(sid) {
  let h = 0;
  for (let i = 0; i < sid.length; i++) h = ((h << 5) - h + sid.charCodeAt(i)) | 0;
  return _AVATAR_COLORS[Math.abs(h) % _AVATAR_COLORS.length];
}

// The roster's order, remembered per class on this computer.
const ROSTER_SORTS = [
  ['firstName', 'First Name'],
  ['lastName', 'Last Name'],
  ['gradeLow', 'Grade, Lowest First'],
  ['missing', 'Most Missing Work'],
  ['flagged', 'Flagged First'],
];
function _rosterSortMode(cid) {
  let mode = null;
  try {
    mode = localStorage.getItem('gb-roster-sort-' + cid);
  } catch (e) {}
  return ROSTER_SORTS.some(o => o[0] === mode) ? mode : 'lastName';
}
function _rosterSortLabel(mode) {
  return ROSTER_SORTS.find(o => o[0] === mode)[1];
}
// Ties in the other sorts keep last-name order (the sort is stable).
function _sortedRoster(cid, mode) {
  const byLast = sortStudents(getStudents(cid), 'lastName');
  return mode === 'lastName' ? byLast : sortStudents(byLast, mode, cid);
}

// Which grades show beside each name, remembered per class on this computer.
// A Proficiency class has no percentage, so it offers Proficiency or None.
const ROSTER_SHOWS = [
  ['grade', 'Grade'],
  ['percent', 'Percentage'],
  ['both', 'Both'],
  ['none', 'None'],
];
const ROSTER_SHOWS_PROFICIENCY = [
  ['grade', 'Proficiency'],
  ['none', 'None'],
];
function _rosterShowOptions(cid) {
  return courseGradeMode(cid) === 'proficiency' ? ROSTER_SHOWS_PROFICIENCY : ROSTER_SHOWS;
}
function _rosterShowMode(cid) {
  let mode = null;
  try {
    mode = localStorage.getItem('gb-roster-show-' + cid);
  } catch (e) {}
  const opts = _rosterShowOptions(cid);
  return opts.some(o => o[0] === mode) ? mode : opts === ROSTER_SHOWS ? 'both' : 'grade';
}
function _rosterShowLabel(cid, mode) {
  return _rosterShowOptions(cid).find(o => o[0] === mode)[1];
}
// The Show button beside Sort has room for a short word: % for Percentage.
// "Proficiency" doesn't fit beside "Sort: Last Name", so a Proficiency class
// shows the icon alone, its choice in the button's title.
function _rosterShowShort(cid, mode) {
  if (_rosterShowOptions(cid) === ROSTER_SHOWS_PROFICIENCY) return '';
  return mode === 'percent' ? '%' : _rosterShowLabel(cid, mode);
}

/* The grades beside the names are the year so far, except on the Reports
   page, where they are the year to date as of the report's end (calc.js,
   Colin 2026-11-03). The roster says so while a report is in view. */
// html-safe: the term label and date go through esc.
function _sidebarTermNote(cid) {
  var term = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
  if (!term || !term.endsOn) return '';
  var end = typeof formatShortDate === 'function' ? formatShortDate(term.endsOn) : formatDate(term.endsOn);
  var tip =
    'The grades are the year to date as of ' +
    (term.label || 'the report') +
    '’s end: all work dated on or before ' +
    end +
    ', and undated work.';
  return `<div class="sb-term-note" id="sb-term-note" title="${esc(tip)}">Grades to ${esc(end)}</div>`;
}

// html-safe: names and initials go through esc; ids, the avatar colour and the flag mark are ours.
function _sidebarRowsHtml(cid, students, selectedStudentId, onStudentClick) {
  const flags = getFlags(cid);
  let html = '';
  students.forEach(s => {
    const href = `/student?id=${s.id}&course=${cid}`;
    const flagged = flags[s.id];
    const avatarBg = _avatarColor(s.id);
    // A row that runs a page function is a button, so the browser shows no
    // link target in its status bar; a row that opens the student is a link.
    const tag = onStudentClick ? 'button' : 'a';
    const clickAttr = onStudentClick
      ? `type="button" data-action="sidebarStudentClick"`
      : `role="link" tabindex="0" data-href="${href}"`;
    html += `<${tag} class="student-row${s.id === selectedStudentId ? ' selected' : ''}" ${clickAttr} data-sid="${s.id}" data-search="${esc((displayName(s) + ' ' + fullName(s)).toLowerCase())}">
      <span class="student-avatar" style="background:${avatarBg}">${esc(initials(s))}</span>
      <span class="student-info">
        <span class="student-row-name">${flagged ? '<span style="color:var(--priority);margin-right:3px">\u2691</span>' : ''}${esc(displayName(s))}</span>
      </span>
      <span class="student-row-grades" data-prof-sid="${s.id}"></span>
    </${tag}>`;
  });
  return html;
}

// html-safe: every option and label comes from the fixed ROSTER_SORTS / ROSTER_SHOWS lists.
function _rosterMenuHtml(options, mode, key) {
  return options
    .map(
      ([m, label]) =>
        `<button type="button" role="menuitemradio" aria-checked="${m === mode}" class="sb-sort-item${m === mode ? ' is-on' : ''}" data-${key}="${m}">${label}</button>`,
    )
    .join('');
}
function _rosterSortMenuHtml(mode) {
  return _rosterMenuHtml(ROSTER_SORTS, mode, 'sort');
}
function _rosterShowMenuHtml(cid, mode) {
  return _rosterMenuHtml(_rosterShowOptions(cid), mode, 'show');
}

let _sidebarCid = null;
// The class picker's last option, which opens the New Class wizard.
const CLASS_PICKER_NEW = '__new_class__';
// html-safe: course names are escaped; labels come from the fixed roster lists; rows come from _sidebarRowsHtml.
function renderSidebar(activeCourse, selectedStudentId, onStudentClick) {
  _sidebarClickFnName = onStudentClick || null;
  const cid = activeCourse;
  _sidebarCid = cid;
  const mode = _rosterSortMode(cid);
  const students = _sortedRoster(cid, mode);
  const show = _rosterShowMode(cid);

  let html = `<aside id="gb-sidebar" aria-label="Student roster">
    <div id="gb-sidebar-top">
      <select id="gb-course-select" class="class-picker" data-action="sidebarSwitchCourse" aria-label="Select course">
        ${getPickerCourses(cid)
          .map(c => `<option value="${c.id}"${c.id === cid ? ' selected' : ''}>${esc(c.name)}</option>`)
          .join('')}
        <option value="${CLASS_PICKER_NEW}">New Class…</option>
      </select>
      <div class="sb-search-row">
        <input id="gb-roster-search" type="text" placeholder="Search..." aria-label="Search students">
      </div>
      <div class="sb-sort">
        <button type="button" class="sb-sort-btn" id="sb-sort-btn" aria-haspopup="menu" aria-expanded="false">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 1.5v9M1.5 8.5l2 2 2-2M8.5 10.5v-9M6.5 3.5l2-2 2 2"/></svg>
          <span>Sort: <span id="sb-sort-label">${_rosterSortLabel(mode)}</span></span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4l2.5 2.5L7.5 4"/></svg>
        </button>
        <div class="sb-sort-menu" id="sb-sort-menu" role="menu" aria-label="Sort students" hidden>${_rosterSortMenuHtml(mode)}</div>
        <button type="button" class="sb-sort-btn" id="sb-show-btn" aria-haspopup="menu" aria-expanded="false" title="Show: ${_rosterShowLabel(cid, show)}" aria-label="Show: ${_rosterShowLabel(cid, show)}">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 6s1.8-3.5 5-3.5S11 6 11 6 9.2 9.5 6 9.5 1 6 1 6z"/><circle cx="6" cy="6" r="1.5"/></svg>
          <span id="sb-show-label">${_rosterShowShort(cid, show)}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4l2.5 2.5L7.5 4"/></svg>
        </button>
        <div class="sb-sort-menu" id="sb-show-menu" role="menu" aria-label="Grades beside each name" hidden>${_rosterShowMenuHtml(cid, show)}</div>
      </div>${_sidebarTermNote(cid)}
    </div>
    <div id="gb-roster-list" role="list">${_sidebarRowsHtml(cid, students, selectedStudentId, onStudentClick)}</div>
    <div id="gb-roster-legend" class="sb-legend" aria-label="Key" hidden></div>
  </aside>`;
  // Auto-fill badges after caller mounts this HTML
  setTimeout(function () {
    fillSidebarBadges(cid);
  }, 0);
  return html;
}

// The roster's two menus: Sort and Show.
const _ROSTER_MENUS = [
  { btn: 'sb-sort-btn', menu: 'sb-sort-menu', key: 'sort', apply: m => _applyRosterSort(m) },
  { btn: 'sb-show-btn', menu: 'sb-show-menu', key: 'show', apply: m => _applyRosterShow(m) },
];
function _closeRosterSortMenu() {
  _ROSTER_MENUS.forEach(function (m) {
    const menu = document.getElementById(m.menu);
    const btn = document.getElementById(m.btn);
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}

// Show other grades beside the names, keeping the list as it is.
function _applyRosterShow(mode) {
  const cid = _sidebarCid;
  if (!cid || !document.getElementById('gb-roster-list')) return;
  try {
    localStorage.setItem('gb-roster-show-' + cid, mode);
  } catch (e) {}
  const btn = document.getElementById('sb-show-btn');
  btn.title = 'Show: ' + _rosterShowLabel(cid, mode);
  btn.setAttribute('aria-label', btn.title);
  document.getElementById('sb-show-label').textContent = _rosterShowShort(cid, mode);
  document.getElementById('sb-show-menu').innerHTML = _rosterShowMenuHtml(cid, mode);
  fillSidebarBadges(cid);
}

// Redraw only the list, keeping the selected student, the search and any
// page annotations.
function _applyRosterSort(mode) {
  const cid = _sidebarCid;
  const list = document.getElementById('gb-roster-list');
  if (!cid || !list) return;
  try {
    localStorage.setItem('gb-roster-sort-' + cid, mode);
  } catch (e) {}
  const sel = list.querySelector('.student-row.selected');
  list.innerHTML = _sidebarRowsHtml(cid, _sortedRoster(cid, mode), sel ? sel.dataset.sid : null, _sidebarClickFnName);
  document.getElementById('sb-sort-label').textContent = _rosterSortLabel(mode);
  document.getElementById('sb-sort-menu').innerHTML = _rosterSortMenuHtml(mode);
  fillSidebarBadges(cid);
  filterRoster();
}

document.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  for (const m of _ROSTER_MENUS) {
    const btn = e.target.closest('#' + m.btn);
    if (btn) {
      const menu = document.getElementById(m.menu);
      const open = menu.hidden;
      _closeRosterSortMenu();
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) (menu.querySelector('.is-on') || menu.firstElementChild).focus();
      return;
    }
    const item = e.target.closest('#' + m.menu + ' [data-' + m.key + ']');
    if (item) {
      _closeRosterSortMenu();
      m.apply(item.dataset[m.key]);
      document.getElementById(m.btn).focus();
      return;
    }
  }
  if (!e.target.closest('.sb-sort-menu')) _closeRosterSortMenu();
});
document.addEventListener(
  'keydown',
  function (e) {
    const m = _ROSTER_MENUS.find(x => {
      const el = document.getElementById(x.menu);
      return el && !el.hidden;
    });
    if (!m) return;
    const menu = document.getElementById(m.menu);
    if (e.key === 'Escape') {
      _closeRosterSortMenu();
      document.getElementById(m.btn).focus();
      e.stopPropagation();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...menu.querySelectorAll('[data-' + m.key + ']')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);

/* The grade beside each name, as the class is set to grade
   (studentRosterBadges): proficiency code (EXT, PRF, DEV, EMG, IE), letter
   and %, or both. */
// html-safe: colours come from PROF_COLORS / PROF_TINT; title and text go through esc.
function _sidebarGradeBadge(part) {
  // IE has no level colour; the level-0 grey (#bbb) is too faint to read as text.
  var color = part.level ? PROF_COLORS[part.level] || PROF_COLORS[0] : 'var(--text-2)';
  var tint = PROF_TINT[part.level] || 'transparent';
  var title = part.title ? ` title="${esc(part.title)}"` : '';
  return `<span class="student-row-prof" style="color:${color};background:${tint}"${title}>${esc(part.text)}</span>`;
}

/* What each proficiency code beside a name means: its tooltip, and the key
   under the roster. IE is BC's Insufficient Evidence: nothing scored yet. */
const ROSTER_CODE_NAMES = (function () {
  const names = {};
  [4, 3, 2, 1].forEach(function (lv) {
    names[PROF_CODES[lv]] = PROF_LABELS[lv];
  });
  names[PROF_CODES[0]] = 'Insufficient Evidence';
  return names;
})();

/* The key under the roster, while the codes show beside the names (not in a
   Letter class, under Show: Percentage or None, with no students, or while a
   page marks the roster for its own job). */
// html-safe: codes and names come from ROSTER_CODE_NAMES; colours from PROF_COLORS / PROF_TINT.
function _fillRosterLegend(cid) {
  const el = document.getElementById('gb-roster-legend');
  if (!el) return;
  const show = _rosterShowMode(cid);
  const on =
    !_sidebarAnnotator &&
    show !== 'none' &&
    show !== 'percent' &&
    courseGradeMode(cid) !== 'letter' &&
    getStudents(cid).length > 0;
  el.hidden = !on;
  if (!on) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = [4, 3, 2, 1, 0]
    .map(function (lv) {
      const code = PROF_CODES[lv];
      return (
        '<span class="sb-legend-item">' +
        _sidebarGradeBadge({ text: code, level: lv }) +
        esc(ROSTER_CODE_NAMES[code]) +
        '</span>'
      );
    })
    .join('');
}

/* After a score changes: redraw only the grade beside one student (`sid`),
   or beside every student, and leave the names and the roster's scroll as
   they are. Without a roster for this class it rebuilds (refreshSidebar). */
function refreshSidebarGrades(sid) {
  const cid = typeof activeCourse !== 'undefined' ? activeCourse : getActiveCourse();
  const picker = document.getElementById('gb-course-select');
  if (!document.getElementById('gb-roster-list') || !picker || picker.value !== cid) {
    refreshSidebar();
    return;
  }
  if (!sid) {
    fillSidebarBadges(cid);
    return;
  }
  if (_sidebarAnnotator) {
    applySidebarAnnotations();
    return;
  }
  const el = document.querySelector('[data-prof-sid="' + sid + '"]');
  if (el) el.innerHTML = _sidebarBadgesHtml(cid, sid);
}

/* The grades the roster's Show menu asks for. Grade (Proficiency in a
   Proficiency class) is the proficiency code and the letter; Percentage is
   the course %; Both is the grade and the %; None is nothing. */
function _sidebarBadgesHtml(cid, sid) {
  var show = _rosterShowMode(cid);
  if (show === 'none') return '';
  var badges = studentRosterBadges(cid, sid);
  if (badges.prof && ROSTER_CODE_NAMES[badges.prof.text])
    badges.prof = Object.assign({}, badges.prof, { title: ROSTER_CODE_NAMES[badges.prof.text] });
  var letter = badges.letter;
  if (letter && show !== 'both') {
    letter = Object.assign({}, letter, { text: show === 'percent' ? letter.pct : letter.grade || letter.pct });
  }
  return (
    (badges.prof && show !== 'percent' ? _sidebarGradeBadge(badges.prof) : '') +
    (letter ? _sidebarGradeBadge(letter) : '')
  );
}

/** Fill sidebar grade badges asynchronously after sidebar is mounted. */
function fillSidebarBadges(cid) {
  requestAnimationFrame(function () {
    _fillRosterLegend(cid);
    if (_sidebarAnnotator) {
      applySidebarAnnotations();
      return;
    }
    document.querySelectorAll('[data-prof-sid]').forEach(function (el) {
      el.innerHTML = _sidebarBadgesHtml(cid, el.getAttribute('data-prof-sid'));
    });
  });
}

/* ── Roster annotations ──────────────────────────────────────
   A page may mark the roster for its own job: a line under each name, a
   mark in place of the grade, rows left out, and controls above the list
   (the Term Questionnaire: Needs Approval, a tick, All · Not Ready). The
   annotator is a function (sid) -> { sub, mark (HTML), hidden }, with an
   optional .top() giving the HTML above the list. Every drawing of the
   sidebar applies it, so a redraw (a score changed, the class switched)
   keeps the marks; null gives the grades back. */
let _sidebarAnnotator = null;
function setSidebarAnnotator(fn) {
  const had = !!_sidebarAnnotator;
  _sidebarAnnotator = fn || null;
  applySidebarAnnotations();
  _fillRosterLegend(typeof activeCourse !== 'undefined' ? activeCourse : getActiveCourse());
  if (had && !_sidebarAnnotator)
    fillSidebarBadges(typeof activeCourse !== 'undefined' ? activeCourse : getActiveCourse());
}
function applySidebarAnnotations() {
  const a = _sidebarAnnotator;
  const top = document.getElementById('gb-sidebar-top');
  let extra = document.getElementById('gb-sidebar-extra');
  if (a && a.top && top) {
    if (!extra) {
      extra = document.createElement('div');
      extra.id = 'gb-sidebar-extra';
      top.appendChild(extra);
    }
    // html-safe: the only annotator (report-questionnaire.js syncRoster) returns fixed buttons with counts.
    extra.innerHTML = a.top();
  } else if (extra) {
    extra.remove();
  }
  document.querySelectorAll('#gb-roster-list .student-row[data-sid]').forEach(function (row) {
    const n = (a && a(row.dataset.sid)) || {};
    let sub = row.querySelector('.student-row-note');
    if (n.sub) {
      if (!sub) {
        sub = document.createElement('span');
        sub.className = 'student-row-note';
        row.querySelector('.student-info').appendChild(sub);
      }
      sub.textContent = n.sub;
    } else if (sub) {
      sub.remove();
    }
    const cell = row.querySelector('.student-row-grades');
    // html-safe: the only annotator (report-questionnaire.js syncRoster) returns fixed tick/flag spans.
    if (cell && a) cell.innerHTML = n.mark || '';
    row.classList.toggle('roster-hidden', !!n.hidden);
  });
}

function filterRoster() {
  const q = (document.getElementById('gb-roster-search').value || '').toLowerCase().trim();
  document.querySelectorAll('.student-row').forEach(row => {
    // The row shows the preferred name; its search key holds the legal name too.
    const name = row.dataset.search || row.querySelector('.student-row-name')?.textContent?.toLowerCase() || '';
    row.style.display = !q || name.includes(q) ? '' : 'none';
  });
}

/* The CSP blocks inline on* attributes, so the sidebar's class picker and
   roster search are wired here, once, by delegation. */
document.addEventListener('change', function (e) {
  if (!e.target.matches('[data-action="sidebarSwitchCourse"]')) return;
  // "New Class…" opens the New Class wizard; the picker stays on this class.
  if (e.target.value === CLASS_PICKER_NEW) {
    e.target.value = _sidebarCid || '';
    if (window.Router) Router.navigate('/dashboard?manage=new');
    return;
  }
  if (window._pageSwitchCourse) window._pageSwitchCourse(e.target.value);
});
document.addEventListener('input', function (e) {
  if (e.target.id === 'gb-roster-search') filterRoster();
});

/* Up and down arrows step through the student list once the teacher has
   picked a name in it (clicked it, or put the focus on it): the next shown
   name is opened as a click would open it, and takes the focus so the keys
   keep working. With no name selected they only move the focus. A click
   anywhere else gives the arrows back to scrolling. */
let _rosterActive = false;
document.addEventListener(
  'pointerdown',
  function (e) {
    _rosterActive = !!(e.target.closest && e.target.closest('#gb-roster-list .student-row'));
  },
  true,
);
document.addEventListener('keydown', function (e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const list = document.getElementById('gb-roster-list');
  if (!list || !list.offsetParent) return;
  const inList = list.contains(e.target);
  const onPage = e.target === document.body || e.target === document.documentElement;
  if (!inList && !(onPage && _rosterActive)) return;
  const rows = Array.prototype.filter.call(list.querySelectorAll('.student-row'), function (r) {
    return r.style.display !== 'none' && !r.classList.contains('roster-hidden');
  });
  const selected = list.querySelector('.student-row.selected');
  const from = (inList && e.target.closest('.student-row')) || selected;
  const i = rows.indexOf(from);
  if (i < 0) return;
  e.preventDefault();
  const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
  if (!next) return;
  _rosterActive = true;
  if (!selected) {
    next.focus();
    return;
  }
  const sid = next.dataset.sid;
  next.click();
  _focusRosterRow(sid, 0);
});

/* The page may redraw the list after the click: focus the student's row
   once it is there. */
function _focusRosterRow(sid, tries) {
  const row = document.querySelector('#gb-roster-list .student-row[data-sid="' + sid + '"]');
  if (row && row.classList.contains('selected')) {
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (tries < 20) setTimeout(_focusRosterRow, 25, sid, tries + 1);
  else if (row) row.focus();
}

/* ── Proficiency badge HTML ─────────────────────────────────── */
function profBadge(score, size) {
  const s = Math.round(score);
  const sz = size || 'sm';
  return `<span class="prof-badge prof-${s} prof-${sz}">${s || '\u2014'}</span>`;
}

function profBar(value, max, color) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return `<div class="prof-bar"><div class="prof-bar-fill" style="width:${pct}%;background:${color || 'var(--active)'}"></div></div>`;
}

/* The roster keeps its scroll position when the sidebar is drawn again.
   Pages replace the whole sidebar on almost every change (picking a student
   on Assignments, a score landing, moving between students), and a new
   list starts at the top, so clicking a student low in the list threw the
   teacher back to the first name. The position is remembered as the
   teacher scrolls and put back, before the browser paints, whenever the
   sidebar is replaced with the same class's roster. Switching class starts
   at the top. */
var _rosterScroll = { course: null, top: 0 };

function _rosterCourse() {
  var sel = document.getElementById('gb-course-select');
  return sel ? sel.value : null;
}

function _rememberRosterScroll(e) {
  var target = e && e.target;
  var list = target && target.closest ? target.closest('#gb-roster-list') : null;
  if (!list) return;
  _rosterScroll = { course: _rosterCourse(), top: list.scrollTop };
}

function _restoreRosterScroll() {
  var list = document.getElementById('gb-roster-list');
  if (!list || !_rosterScroll.top || _rosterCourse() !== _rosterScroll.course) return;
  if (list.scrollTop !== _rosterScroll.top) list.scrollTop = _rosterScroll.top;
}

function _keepRosterScroll() {
  // Scroll events don't bubble, so listen in the capture phase. A click on
  // a student is captured too: it runs before the page redraws the sidebar,
  // so the position is right even if no scroll event has arrived yet.
  document.addEventListener('scroll', _rememberRosterScroll, true);
  document.addEventListener('click', _rememberRosterScroll, true);
  var mount = document.getElementById('sidebar-mount');
  if (mount && typeof MutationObserver === 'function') {
    new MutationObserver(_restoreRosterScroll).observe(mount, { childList: true });
  }
}
if (typeof document !== 'undefined' && document.addEventListener) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _keepRosterScroll);
  else _keepRosterScroll();
}

// Redraw the roster rows (a flag set or cleared), keeping the sort, the
// selected student and the search.
function refreshRosterRows() {
  if (_sidebarCid && document.getElementById('gb-roster-list')) _applyRosterSort(_rosterSortMode(_sidebarCid));
}

// Refresh sidebar in place (call after score changes)
function refreshSidebar() {
  const mount = document.getElementById('sidebar-mount');
  if (!mount) return;
  const cid = typeof activeCourse !== 'undefined' ? activeCourse : getActiveCourse();
  const clickFn = _sidebarClickFnName || null;
  // Use focusStudentId if available (assignments page), otherwise parse from selected row href
  let selId = typeof focusStudentId !== 'undefined' ? focusStudentId : null;
  if (!selId) {
    const sel = document.querySelector('.student-row.selected');
    if (sel) {
      // Support both route links (/student?id=x) and data-sid attributes
      const sid = sel.dataset.sid;
      if (sid) {
        selId = sid;
      } else if (sel.dataset.href) {
        try {
          const hrefStr = sel.dataset.href;
          const qIdx = hrefStr.indexOf('?');
          if (qIdx >= 0) {
            selId = new URLSearchParams(hrefStr.substring(qIdx + 1)).get('id');
          }
        } catch (e) {
          console.warn('Sidebar href parse error:', e);
        }
      }
    }
  }
  mount.innerHTML = renderSidebar(cid, selId, clickFn);
}

/* ── Collapsible sidebar (shared across all pages) ─────────── */
let _sidebarVisible = true;
try {
  _sidebarVisible = localStorage.getItem('gb-sidebar-vis') !== 'false';
} catch (e) {
  console.warn('Sidebar state read error:', e);
}

/* At 1024px and below there is no room for the student list beside the
   page, so Toggle Sidebar opens it over the page instead (styles.css,
   .sidebar-overlay). Picking a student, Escape or a click outside closes
   it. The saved wide-screen choice is left alone. */
const SIDEBAR_OVERLAY_QUERY = '(max-width: 1024px)';
function _sidebarIsOverlay() {
  return !!(window.matchMedia && window.matchMedia(SIDEBAR_OVERLAY_QUERY).matches);
}

function toggleSidebar() {
  if (_sidebarIsOverlay()) {
    const layout = document.getElementById('page-layout');
    setSidebarOverlay(!(layout && layout.classList.contains('sidebar-overlay')));
    return;
  }
  _sidebarVisible = !_sidebarVisible;
  localStorage.setItem('gb-sidebar-vis', _sidebarVisible);
  applySidebarState();
}

function _onSidebarOverlayKey(e) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  setSidebarOverlay(false);
}
function _onSidebarOverlayPointer(e) {
  if (e.target.closest('#sidebar-mount, [data-action="toggleSidebar"]')) return;
  setSidebarOverlay(false);
}
// A student picked: close once the page has handled the click.
function _onSidebarOverlayClick(e) {
  if (e.target.closest('#sidebar-mount .student-row')) setTimeout(() => setSidebarOverlay(false), 0);
}
function setSidebarOverlay(open) {
  const layout = document.getElementById('page-layout');
  if (!layout) return;
  open = !!open;
  layout.classList.toggle('sidebar-overlay', open);
  document.querySelectorAll('[data-action="toggleSidebar"]').forEach(btn => {
    if (_sidebarIsOverlay()) btn.setAttribute('aria-expanded', String(open));
    else btn.removeAttribute('aria-expanded');
  });
  const method = open ? 'addEventListener' : 'removeEventListener';
  document[method]('keydown', _onSidebarOverlayKey, true);
  document[method]('pointerdown', _onSidebarOverlayPointer, true);
  document[method]('click', _onSidebarOverlayClick, true);
}
if (window.matchMedia) {
  const mq = window.matchMedia(SIDEBAR_OVERLAY_QUERY);
  const closeWhenWide = () => {
    if (!mq.matches) setSidebarOverlay(false);
  };
  if (mq.addEventListener) mq.addEventListener('change', closeWhenWide);
}

function applySidebarState() {
  const layout = document.getElementById('page-layout');
  if (!layout) return;
  layout.classList.toggle('sidebar-hidden', !_sidebarVisible);
}

function initSidebarToggle() {
  setSidebarOverlay(false);
  applySidebarState();
}

/* ── Undo Toast ───────────────────────────────────────────── */
let _undoState = null;
let _undoTimer = null;

/* commitFn runs when the toast closes without Undo: it times out, another
   toast replaces it, or it is dismissed. durationMs defaults to 5 seconds. */
function showUndoToast(message, undoFn, commitFn, durationMs) {
  // Clear any existing toast
  dismissUndoToast();

  _undoState = { fn: undoFn, commit: commitFn };

  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.id = 'undo-toast';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.innerHTML = `<span>${esc(message)}</span><button class="undo-toast-btn" data-action="executeUndo">Undo</button>`;
  document.body.appendChild(toast);

  _undoTimer = setTimeout(dismissUndoToast, durationMs || 5000);
}

function executeUndo() {
  const state = _undoState;
  // Undo taken: the toast closes without committing.
  _undoState = null;
  if (state && state.fn) state.fn();
  dismissUndoToast();
}

function dismissUndoToast() {
  clearTimeout(_undoTimer);
  const state = _undoState;
  _undoState = null;
  const el = document.getElementById('undo-toast');
  if (el) el.remove();
  if (state && state.commit) state.commit();
}

/* ── Sync Toast ──────────────────────────────────────────── */
let _syncToastTimer = null;

function showSyncToast(message, type) {
  dismissSyncToast();
  const toast = document.createElement('div');
  // A failed class load and paused cloud sync show only on the sync dot
  // (CLAUDE.md rule 5), so there is no persistent load toast here.
  toast.className = 'sync-toast ' + (type || 'error');
  toast.id = 'sync-toast';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  if (type === 'error') {
    toast.innerHTML = `<span>${esc(message)}</span><button class="sync-toast-btn" data-action="retry-sync">Retry Now</button>`;
  } else {
    toast.innerHTML = `<span>${esc(message)}</span>`;
    _syncToastTimer = setTimeout(dismissSyncToast, 3000);
  }
  document.body.appendChild(toast);
}

function dismissSyncToast() {
  clearTimeout(_syncToastTimer);
  const el = document.getElementById('sync-toast');
  if (el) el.remove();
}

/* Re-render a page but keep one element as it is, so a form the teacher is
   filling in keeps what they typed. renderFn rebuilds the page, including a
   fresh copy of the element; the kept one goes back in its place. */
function rerenderKeeping(id, renderFn) {
  var kept = document.getElementById(id);
  renderFn();
  if (!kept) return;
  var fresh = document.getElementById(id);
  if (fresh && fresh !== kept) fresh.replaceWith(kept);
}

/* The mark a gradebook cell shows for a status that replaces its score:
   M (missing, stored as NS) or EXC (excused, not counted). Its tooltip says how M
   counts, by the class's grading style (Colin, 2026-11-03; DECISIONS
   "Class Averages and statuses" 7): 0 in a Letter class, though on
   proficiency and rubric work not in competency proficiency; 0 in the
   course % and no evidence in proficiency in a Both class; no evidence in
   a Proficiency class, where a points column's Class Average still counts
   it as 0 (calc.js's COLUMN_STATUS_RULES). Empty for no status or Late,
   which keeps its score. */
function scoreStatusMarker(status, cid, assessment) {
  if (status === 'NS') {
    var nsTitle = 'Missing: counts as 0';
    if (assessment) {
      var mode = courseGradeMode(cid);
      if (mode === 'letter' && !isPointsScored(assessment))
        nsTitle = 'Missing: counts as 0 in the % and averages, not in competency proficiency';
      else if (mode === 'both') nsTitle = 'Missing: 0 in the course %, not counted in proficiency';
      else if (mode === 'proficiency')
        nsTitle = isPointsScored(assessment)
          ? 'Missing: no evidence yet, 0 in the Class Average'
          : 'Missing: not counted, no evidence yet';
    }
    return '<span class="gb-status gb-status-ns" title="' + nsTitle + '">M</span>';
  }
  if (status === 'EXC') return '<span class="gb-status gb-status-exc" title="Excused: not counted">EXC</span>';
  return '';
}

/* ── Confirm Modal ────────────────────────────────────────── */
function showConfirm(title, message, okLabel, okStyle, onConfirm) {
  var triggerEl = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'confirm-title');
  overlay.innerHTML = `<div class="confirm-card">
    <div class="confirm-title" id="confirm-title">${esc(title)}</div>
    <div class="confirm-message">${esc(message)}</div>
    <div class="confirm-actions">
      <button class="confirm-cancel" id="confirm-cancel-btn">Cancel</button>
      <button class="confirm-ok ${esc(okStyle || 'primary')}" id="confirm-ok-btn">${esc(okLabel || 'OK')}</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  // Focus the cancel button for keyboard users
  overlay.querySelector('#confirm-cancel-btn').focus();
  // Shared cleanup: remove overlay + escHandler + trapHandler in all close paths
  function closeOverlay() {
    overlay.remove();
    document.removeEventListener('keydown', escHandler);
    document.removeEventListener('keydown', trapHandler);
    try {
      if (triggerEl && typeof triggerEl.focus === 'function') triggerEl.focus();
    } catch (e) {
      /* trigger may have been removed */
    }
  }
  overlay.querySelector('#confirm-ok-btn').onclick = () => {
    closeOverlay();
    onConfirm();
  };
  overlay.querySelector('#confirm-cancel-btn').onclick = () => {
    closeOverlay();
  };
  // Close on backdrop click
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeOverlay();
  });
  // Close on Escape
  const escHandler = e => {
    if (e.key === 'Escape') closeOverlay();
  };
  document.addEventListener('keydown', escHandler);
  // Focus trap
  const trapHandler = e => {
    if (e.key !== 'Tab') return;
    const focusable = overlay.querySelectorAll('button');
    const first = focusable[0],
      last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', trapHandler);
}

/* ── Shared delegated click handler for gb-ui.js components ── */
var _sidebarClickFnName = null;

document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-action]');
  if (!el) return;
  var action = el.dataset.action;
  var handlers = {
    toggleUserMenu: function () {
      var isOpen = el.parentElement.classList.toggle('open');
      el.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    },
    // Create an Account and Sign In leave Demo Mode first (shared/data.js).
    leaveDemoMode: async function () {
      var href = el.getAttribute('href');
      var res = await window.leaveDemoMode(href);
      if (!res || !res.unsent) return;
      showConfirm('Unsent Changes', window.leaveDemoUnsentText(res.unsent), 'Leave Demo Mode', 'danger', function () {
        window.leaveDemoMode(href, { force: true });
      });
    },
    toggleHelp: function () {
      setHelpOpen(!_helpOpen);
    },
    closeHelp: function () {
      setHelpOpen(false, true);
    },
    helpOpenArticle: function () {
      _helpOpenArticle(el.dataset.slug);
    },
    helpBack: function () {
      _helpSlug = null;
      _helpRenderBody();
      var input = document.getElementById('help-search');
      if (input) input.focus();
    },
    openKeyboardShortcuts: function () {
      openKeyboardShortcuts();
    },
    openReportProblem: function () {
      openReportProblem();
    },
    // Under 600 px Help is in the account menu (styles.css).
    openHelpFromMenu: function () {
      var menu = el.closest('.tb-user-menu');
      if (menu) {
        menu.classList.remove('open');
        var b = menu.querySelector('.tb-user-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      }
      setHelpOpen(true);
    },
    toggleDemoMenu: function () {
      _setDemoMenu(!el.parentElement.classList.contains('open'));
    },
    signOut: async function () {
      var res = await signOut();
      if (!res || !res.unsent) return;
      showConfirm(
        'Unsaved changes',
        res.unsent === 1
          ? '1 change hasn’t reached the server yet. If you sign out now, it will be lost.'
          : res.unsent + ' changes haven’t reached the server yet. If you sign out now, they will be lost.',
        'Sign out anyway',
        'danger',
        function () {
          signOut({ force: true });
        },
      );
    },
    resetDemoData: function () {
      if (typeof isDemoMode !== 'function' || !isDemoMode()) return;
      showConfirm(
        'Reset Demo Data',
        'All classes are deleted and the sample Science 8 class is restored. This cannot be undone.',
        'Reset',
        'danger',
        async function () {
          await window.resetDemoData();
          Router.navigate('/dashboard');
        },
      );
    },
    toggleSidebar: function () {
      toggleSidebar();
    },
    sidebarStudentClick: function () {
      if (!_sidebarClickFnName) return;
      // Support dot-path names like 'PageStudent.switchStudent'
      var parts = _sidebarClickFnName.split('.');
      var fn = window;
      for (var i = 0; i < parts.length; i++) {
        fn = fn ? fn[parts[i]] : null;
      }
      if (typeof fn === 'function') fn(el.dataset.sid);
    },
    executeUndo: function () {
      executeUndo();
    },
    retrySyncQueue: async function () {
      await retrySyncQueue();
    },
  };
  if (handlers[action]) {
    e.preventDefault();
    handlers[action]();
  }
});

// Delegated click handler for sync toast buttons
document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  switch (btn.dataset.action) {
    case 'retry-sync':
      retrySyncQueue();
      dismissSyncToast();
      break;
    case 'retry-sync-dot':
      _retryFromSyncDot();
      break;
    case 'copy-session-draft':
      _copySessionExpiredDraft().then(function (copied) {
        if (copied && typeof showSyncToast === 'function') {
          showSyncToast('Draft copied to clipboard.', 'success');
        }
      });
      dismissSyncToast();
      break;
    case 'copy-student-field':
      _handleCopyStudentField(btn);
      break;
  }
});

/* The header's student number or email: a click copies it, and the button
   says Copied for a moment. */
function _handleCopyStudentField(btn) {
  var text = btn.dataset.copy;
  if (!text) return;
  _copyTextToClipboard(text).then(function (ok) {
    if (!ok) return;
    var original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function () {
      if (btn.textContent === 'Copied!') btn.textContent = original;
    }, 1500);
  });
}

function _copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(
      function () {
        return true;
      },
      function () {
        return _execCommandCopy(text);
      },
    );
  }
  return Promise.resolve(_execCommandCopy(text));
}

function _execCommandCopy(text) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

// Global error monitoring — cache teacher_id synchronously from the data layer
function _getTeacherId() {
  try {
    return typeof _teacherId !== 'undefined' ? _teacherId : null;
  } catch (e) {
    return null;
  }
}

function _recordClientError(source, details) {
  try {
    var key = 'gb-client-errors';
    var current = JSON.parse(localStorage.getItem(key) || '[]');
    current.push({
      source: source,
      page: window.location.pathname,
      teacher_id: _getTeacherId(),
      created_at: new Date().toISOString(),
      details: details,
    });
    if (current.length > 25) current = current.slice(current.length - 25);
    localStorage.setItem(key, JSON.stringify(current));
  } catch (e) {
    // Storage is best-effort only.
  }
}

window.addEventListener('error', function (event) {
  _recordClientError('error', {
    message: event.message || 'Unknown error',
    stack: event.error ? event.error.stack : '',
    user_agent: navigator.userAgent,
  });
});

window.addEventListener('unhandledrejection', function (event) {
  _recordClientError('unhandledrejection', {
    message: event.reason ? event.reason.message || String(event.reason) : 'Unhandled rejection',
    stack: event.reason ? event.reason.stack || '' : '',
    user_agent: navigator.userAgent,
  });
});

/* ── Namespace ──────────────────────────────────────────────── */
window.UI = {
  renderDock,
  getUpcomingBirthdays,
  renderStudentHeader,
  renderSidebar,
  fillSidebarBadges,
  refreshSidebarGrades,
  filterRoster,
  profBadge,
  profBar,
  refreshSidebar,
  toggleSidebar,
  applySidebarState,
  initSidebarToggle,
  showUndoToast,
  executeUndo,
  dismissUndoToast,
  showSyncToast,
  dismissSyncToast,
  showConfirm,
  refreshSyncStatusUI,
  retrySyncQueue,
  queueSessionExpiredRetry,
};
