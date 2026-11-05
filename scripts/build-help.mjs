#!/usr/bin/env node
/**
 * Builds the help site at fullvision.ca/help from help/articles/*.md.
 *
 * Writes, all under help/ (generated, not committed; see .gitignore):
 *   help/<slug>.html            the full page, on the splash page's look
 *   help/index.html             the landing page (Getting Started, then every topic)
 *   help/fragments/<slug>.html  the article body alone, for the in-app Help panel
 *   help/index.json             [{slug, title, section, summary, pages, video, demo}]
 *
 * Plain node, no dependencies. The Markdown is a small subset: ## headings,
 * paragraphs, numbered and bulleted lists, **bold**, [links](slug), and
 * ![pictures](img/file.jpg "caption"). See docs/help-authoring.md.
 *
 * Run: node scripts/build-help.mjs   (scripts/build.sh runs it on every deploy)
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HELP = join(ROOT, 'help');
const ARTICLES = join(HELP, 'articles');

// Topic order for the nav. "Reference" holds the standing pages (Glossary,
// What's New, …), shown under the line at the foot of the nav.
export const SECTIONS = [
  'Getting Started',
  'Class Management',
  'Assignments',
  'Gradebook',
  'Observations',
  'Reports',
  'Student Page and Student Voice',
  'Phone App',
  'Privacy and Your Data',
  'Reference',
];

const REQUIRED = ['title', 'section', 'summary', 'checked'];

/* ── Front matter: a small YAML subset ─────────────────────────
   key: value, key: followed by "- item" lines, and list items that are maps
   ("- file: x" then "  route: y"), which may hold their own lists. Values may
   be quoted with ' or ". */

function scalar(raw) {
  // An unquoted value ends at " #" (a YAML comment).
  const v = /^["']/.test(raw.trim()) ? raw.trim() : raw.replace(/\s+#.*$/, '').trim();
  if (/^".*"$/.test(v)) return JSON.parse(v);
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (v === '[]') return [];
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === 'true' || v === 'false') return v === 'true';
  return v;
}

export function parseFrontMatter(text) {
  const lines = text.split('\n').filter(l => l.trim() !== '' && !/^\s*#/.test(l));
  let i = 0;
  const indentOf = l => l.match(/^ */)[0].length;

  function block(indent) {
    // A list if the first line at this indent starts with "- ".
    if (i < lines.length && lines[i].trim().startsWith('- ') && indentOf(lines[i]) === indent) {
      const list = [];
      while (i < lines.length && indentOf(lines[i]) === indent && lines[i].trim().startsWith('- ')) {
        const rest = lines[i].trim().slice(2);
        const kv = rest.match(/^([A-Za-z_][\w-]*):(\s|$)(.*)$/);
        if (kv) {
          // A map item: its first key sits on the "- " line, the rest are
          // indented two more than the dash.
          const map = {};
          const inner = indent + 2;
          i++;
          if (kv[3].trim() !== '') map[kv[1]] = scalar(kv[3]);
          else map[kv[1]] = block(nextIndent(inner));
          Object.assign(map, mapBlock(inner));
          list.push(map);
        } else {
          list.push(scalar(rest));
          i++;
        }
      }
      return list;
    }
    return mapBlock(indent);
  }

  function nextIndent(min) {
    return i < lines.length && indentOf(lines[i]) >= min ? indentOf(lines[i]) : min;
  }

  function mapBlock(indent) {
    const map = {};
    while (i < lines.length && indentOf(lines[i]) === indent && !lines[i].trim().startsWith('- ')) {
      const m = lines[i].trim().match(/^([A-Za-z_][\w-]*):(\s|$)(.*)$/);
      if (!m) throw new Error('Front matter line not understood: ' + lines[i]);
      i++;
      if (m[3].trim() !== '') map[m[1]] = scalar(m[3]);
      else if (i < lines.length && indentOf(lines[i]) > indent) map[m[1]] = block(indentOf(lines[i]));
      else if (i < lines.length && indentOf(lines[i]) === indent && lines[i].trim().startsWith('- '))
        map[m[1]] = block(indent);
      else map[m[1]] = '';
    }
    return map;
  }

  const out = block(0);
  if (i < lines.length) throw new Error('Front matter line not understood: ' + lines[i]);
  return out;
}

/* ── Markdown: the subset the articles use ──────────────────── */

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// An article link is a bare slug ("add-your-students") or "slug#anchor";
// anything with a scheme or a leading slash is left as written.
function href(target) {
  if (/^(https?:|mailto:|\/|#)/.test(target)) return target;
  return '/help/' + target;
}

function imgSrc(target) {
  if (/^(https?:|\/)/.test(target)) return target;
  return '/help/' + target.replace(/^\.\//, '');
}

export function inline(text) {
  // Escape first, then turn the Markdown marks back into tags.
  let s = esc(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, target) => `<a href="${href(target)}">${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return s;
}

export function markdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isOl = l => /^\d+\.\s/.test(l);
  const isUl = l => /^[-*]\s/.test(l);
  const isImg = l => /^!\[[^\]]*\]\([^)]*\)\s*$/.test(l.trim());

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    let m;
    if ((m = line.match(/^(#{2,3})\s+(.*)$/))) {
      const level = m[1].length;
      const text = m[2].trim();
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
    } else if (isImg(line)) {
      const im = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+(["'])(.*)\3)?\)$/);
      if (!im) throw new Error('Picture not understood: ' + line);
      const cap = im[4] ? `<figcaption>${inline(im[4])}</figcaption>` : '';
      // The picture opens full size; on a phone it scrolls sideways at a readable size.
      const src = esc(imgSrc(im[2]));
      out.push(
        `<figure><div class="pic"><a href="${src}"><img src="${src}" alt="${esc(im[1])}" loading="lazy" /></a></div>${cap}</figure>`,
      );
      i++;
    } else if (isOl(line) || isUl(line)) {
      const ordered = isOl(line);
      const start = ordered ? Number(line.match(/^(\d+)\./)[1]) : 1;
      const items = [];
      while (i < lines.length && (ordered ? isOl(lines[i]) : isUl(lines[i]))) {
        let item = lines[i].replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, '');
        i++;
        // Indented lines continue the item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
        // A blank line between items keeps the same list.
        if (i < lines.length && lines[i].trim() === '' && i + 1 < lines.length) {
          const next = lines[i + 1];
          if (ordered ? isOl(next) : isUl(next)) i++;
        }
      }
      const tag = ordered ? 'ol' : 'ul';
      const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
      out.push(`<${tag}${startAttr}>${items.join('')}</${tag}>`);
    } else if (/^>\s?/.test(line)) {
      const para = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) para.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<p class="note">${inline(para.join(' '))}</p>`);
    } else {
      const para = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !/^#{2,3}\s/.test(lines[i]) &&
        !isOl(lines[i]) &&
        !isUl(lines[i]) &&
        !isImg(lines[i]) &&
        !/^>\s?/.test(lines[i])
      )
        para.push(lines[i++].trim());
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

/* ── Reading the articles ───────────────────────────────────── */

export function readArticle(file) {
  const text = readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(file + ': no front matter');
  const meta = parseFrontMatter(m[1]);
  const slug = file.split('/').pop().replace(/\.md$/, '');
  for (const key of REQUIRED) if (!meta[key]) throw new Error(`${slug}: front matter needs "${key}"`);
  if (!SECTIONS.includes(meta.section)) throw new Error(`${slug}: unknown section "${meta.section}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error(`${slug}: slugs are lower-case words joined by -`);
  return {
    slug,
    title: meta.title,
    section: meta.section,
    summary: meta.summary,
    order: Number(meta.order) || 100,
    checked: meta.checked,
    pages: meta.pages || [],
    labels: meta.labels || [],
    video: meta.video || '',
    length: meta.length || '',
    demo: meta.demo || '',
    keywords: meta.keywords || [],
    next: meta.next || [],
    shots: meta.shots || [],
    body: m[2],
  };
}

export function readArticles(dir = ARTICLES) {
  const list = readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => readArticle(join(dir, f)));
  list.sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.order - b.order);
  const slugs = new Set(list.map(a => a.slug));
  for (const a of list) {
    for (const n of a.next) if (!slugs.has(n)) throw new Error(`${a.slug}: next names "${n}", which has no article`);
    for (const [, target] of a.body.matchAll(/\]\(([a-z0-9-]+)(#[\w-]*)?\)/g))
      if (!slugs.has(target)) throw new Error(`${a.slug}: links to "${target}", which has no article`);
  }
  return list;
}

/* ── Pages ──────────────────────────────────────────────────── */

function formatDate(iso) {
  const d = new Date(String(iso) + 'T12:00:00Z');
  if (isNaN(d)) throw new Error('Bad checked date: ' + iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export const sectionId = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// The article body shared by the page and the fragment: lead sentence, Try It,
// steps and the Next box. Links and pictures are absolute so the fragment works
// inside the app at any address.
export function articleBody(a, bySlug, { fragment = false } = {}) {
  // Try It starts Demo Mode, which replaces this device's data; LINK_SCRIPT
  // sends a signed-in teacher through the sign-in page, which asks first.
  // Inside the app the Help panel decides what to offer from index.json.
  const tryIt =
    a.demo && !fragment
      ? `<a class="btn btn-grey btn-sm" href="/login.html?demo=1" data-link="demo" data-route="${esc(a.demo)}">Try It in Demo Mode</a>`
      : '';
  const videoLine = ['Video', a.length, 'Captioned, no audio'].filter(Boolean).join(' · ');
  const video = a.video
    ? `<div class="media"><video controls preload="none" src="/help/video/${esc(a.video)}"></video>` +
      `<div class="media-row"><span>${esc(videoLine)}</span>${tryIt}</div></div>`
    : tryIt
      ? `<div class="media-row">${tryIt}</div>`
      : '';
  const next = a.next.length
    ? `<div class="next"><div class="next-h">Next</div><div class="next-links">` +
      a.next.map(s => `<a href="/help/${s}">${esc(bySlug[s].title)}</a>`).join('') +
      `</div></div>`
    : '';
  return `<p class="lead">${inline(a.summary)}</p>\n` + video + '\n' + markdown(a.body) + '\n' + next;
}

const LOGO =
  '<svg width="32" height="32" viewBox="0 0 64 64" aria-hidden="true">' +
  '<rect x="0" y="0" width="64" height="64" rx="15" fill="#0071e3"></rect>' +
  '<rect x="13" y="38" width="8" height="10" rx="2" fill="#ffffff" opacity="0.55"></rect>' +
  '<rect x="23" y="31" width="8" height="17" rx="2" fill="#ffffff" opacity="0.7"></rect>' +
  '<rect x="33" y="24" width="8" height="24" rx="2" fill="#ffffff" opacity="0.85"></rect>' +
  '<rect x="43" y="17" width="8" height="31" rx="2" fill="#ffffff"></rect></svg>';

const STYLE = `
body { margin: 0; background: #f5f5f7; color-scheme: light; }
.fv { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif; color: #1d1d1f; -webkit-font-smoothing: antialiased; min-height: 100vh; }
a { color: #0071e3; }
a:hover { color: #0058b0; }
.skip { position: absolute; left: 16px; top: -48px; padding: 10px 14px; background: #fff; color: #1d1d1f; border-radius: 10px; box-shadow: 0 0 0 2px #0071e3; z-index: 10; }
.skip:focus { top: 12px; }
header { background: #fff; border-bottom: 1px solid #e5e5ea; }
.bar { max-width: 1240px; margin: 0 auto; padding: 0 32px; min-height: 72px; display: flex; align-items: center; gap: 24px; box-sizing: border-box; }
.brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: #1d1d1f; flex: none; }
.brand:hover { color: #1d1d1f; }
.brand b { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
.brand span { font-size: 20px; color: #58585d; }
.search { position: relative; flex: 1; max-width: 460px; margin-left: 24px; }
.search label { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-radius: 10px; background: #f2f2f4; color: #58585d; }
.search input { flex: 1; min-width: 0; border: 0; background: transparent; font: inherit; font-size: 15px; color: #1d1d1f; outline: none; }
.search label:focus-within { box-shadow: 0 0 0 2px #0071e3; }
.results { position: absolute; top: 46px; left: 0; right: 0; z-index: 5; background: #fff; border-radius: 12px; box-shadow: 0 0 0 1px rgba(0,0,0,0.08), 0 12px 32px rgba(0,0,0,0.12); padding: 6px; display: none; max-height: 420px; overflow-y: auto; }
.results.open { display: block; }
.results a { display: block; padding: 10px 12px; border-radius: 8px; text-decoration: none; color: #1d1d1f; }
.results a:hover, .results a:focus { background: #f2f2f4; outline: none; }
.results a b { display: block; font-size: 15px; font-weight: 600; }
.results a span { display: block; font-size: 13px; color: #58585d; margin-top: 2px; }
.results p { margin: 0; padding: 10px 12px; font-size: 14px; color: #58585d; }
.spacer { flex: 1; }
.ctas { display: flex; gap: 10px; flex: none; }
.btn { display: inline-flex; align-items: center; min-height: 44px; padding: 0 18px; border-radius: 12px; font-size: 15px; font-weight: 600; text-decoration: none; box-sizing: border-box; }
.btn-grey { background: #e8e8ed; color: #1d1d1f; }
.btn-grey:hover { color: #1d1d1f; background: #dedee3; }
.btn-blue { background: #0071e3; color: #fff; }
.btn-blue:hover { color: #fff; filter: brightness(0.92); }
.layout { max-width: 1240px; margin: 0 auto; padding: 32px 32px 48px; box-sizing: border-box; display: flex; gap: 32px; align-items: flex-start; }
nav.topics { width: 260px; flex: none; display: flex; flex-direction: column; gap: 2px; font-size: 15px; position: sticky; top: 16px; }
nav.topics a { padding: 8px 12px; border-radius: 8px; color: #1d1d1f; text-decoration: none; }
nav.topics a:hover { background: #ebebef; }
nav.topics a.sec-on { background: #e3eefc; color: #0058b0; font-weight: 600; }
nav.topics a.art { padding: 6px 12px 6px 24px; }
nav.topics a.art-on { color: #0058b0; font-weight: 600; }
nav.topics .rule { height: 1px; background: #d8d8dd; margin: 12px; }
main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.card { background: #fff; border-radius: 16px; box-shadow: 0 0 0 1px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.05); padding: 40px 48px; display: flex; flex-direction: column; gap: 20px; }
.crumbs { font-size: 14px; color: #58585d; }
.crumbs a { text-decoration: none; }
h1 { margin: 0; font-size: 40px; line-height: 1.1; letter-spacing: -0.02em; font-weight: 700; }
.card h2 { margin: 12px 0 0; font-size: 24px; font-weight: 700; }
.card h3 { margin: 4px 0 0; font-size: 19px; font-weight: 700; }
.card p { margin: 0; font-size: 17px; line-height: 1.5; }
.card p.lead { font-size: 18px; }
.card p.note { padding: 12px 16px; border-radius: 10px; background: #f2f2f4; font-size: 16px; }
.card ol, .card ul { margin: 0; padding-left: 24px; display: flex; flex-direction: column; gap: 14px; font-size: 17px; line-height: 1.5; }
.card ul { gap: 8px; }
.card figure { margin: 4px 0; display: flex; flex-direction: column; gap: 8px; }
.media { display: flex; flex-direction: column; gap: 10px; }
.media video { width: 100%; aspect-ratio: 16 / 9; border-radius: 12px; background: #1d1d1f; }
.media-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; color: #58585d; }
.btn-sm { min-height: 40px; padding: 0 16px; border-radius: 10px; }
.card figure img, .card figure video { width: 100%; height: auto; border-radius: 10px; box-shadow: 0 0 0 1px rgba(0,0,0,0.1); background: #fff; }
.card figure .pic { display: block; }
.card figure .pic a { display: block; }
.card figcaption { font-size: 14px; color: #58585d; }
.card dl { margin: 0; display: flex; flex-direction: column; gap: 14px; font-size: 17px; line-height: 1.5; }
.next { margin-top: 8px; padding: 16px 20px; border-radius: 12px; background: #f2f2f4; display: flex; flex-direction: column; gap: 6px; }
.next-h { font-size: 15px; font-weight: 600; }
.next-links { display: flex; flex-wrap: wrap; gap: 8px 24px; font-size: 16px; }
.next-links a { text-decoration: none; font-weight: 600; }
.foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 24px; padding: 4px 8px 0; font-size: 14px; color: #58585d; }
.foot a { text-decoration: none; font-weight: 600; }
.toc { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.toc section { background: #fff; border-radius: 16px; box-shadow: 0 0 0 1px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.05); padding: 24px 28px; }
.toc h2 { margin: 0 0 10px; font-size: 19px; font-weight: 700; }
.toc ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 16px; }
.toc a { text-decoration: none; }
.card ol.steps-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.steps-list li { display: flex; gap: 16px; align-items: flex-start; }
.steps-list .n { flex: none; width: 32px; height: 32px; border-radius: 16px; background: #e3eefc; color: #0058b0; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 15px; }
.steps-list a { font-size: 18px; font-weight: 600; text-decoration: none; }
.steps-list p { margin: 4px 0 0; font-size: 16px; color: #48484d; line-height: 1.45; }
@media (max-width: 980px) {
  .search { margin-left: 0; }
  .layout { flex-direction: column; }
  nav.topics { order: 2; width: 100%; position: static; }
  main { width: 100%; }
}
@media (max-width: 760px) {
  .bar { flex-wrap: wrap; padding: 12px 16px; gap: 12px; }
  .search { order: 3; flex-basis: 100%; max-width: none; }
  .spacer { display: none; }
  .ctas { margin-left: auto; }
  .layout { padding: 16px 16px 32px; }
  .card { padding: 24px 20px; border-radius: 14px; }
  h1 { font-size: 30px; }
  .toc { grid-template-columns: minmax(0, 1fr); }
  .card figure .pic { overflow-x: auto; -webkit-overflow-scrolling: touch; border-radius: 10px; padding: 1px; }
  .card figure .pic img { width: 960px; max-width: none; }
}
@media (max-width: 620px) {
  .cta-demo { display: none; }
}
`;

// The splash page's rule (index.html): a teacher who is signed in, or in Demo
// Mode, gets Open FullVision instead of Sign In. Demo links go through the
// sign-in page for a signed-in teacher (it asks before replacing this device's
// data) and straight to the page for someone already in Demo Mode.
const LINK_SCRIPT = `
(function () {
  var signedIn = false, inDemo = false;
  try {
    Object.keys(localStorage).forEach(function (k) {
      if (k.indexOf('sb-') === 0 && k.indexOf('-auth-token') > 0) signedIn = true;
      if (k === 'gb-demo-mode') inDemo = true;
    });
  } catch (e) {
    /* storage blocked: stay a visitor */
  }
  if (!signedIn && !inDemo) return;
  document.querySelectorAll('[data-link="signin"]').forEach(function (a) {
    a.textContent = 'Open FullVision';
    a.href = '/dashboard';
  });
  document.querySelectorAll('[data-link="demo"]').forEach(function (a) {
    a.href = inDemo && !signedIn ? a.getAttribute('data-route') || '/dashboard' : '/login.html';
  });
})();
`;

// Search Help: plain text over titles, summaries and the labels each article
// quotes, in the page. No network.
const SEARCH_SCRIPT = `
(function () {
  var data = [];
  try { data = JSON.parse(document.getElementById('help-index').textContent); } catch (e) { return; }
  var input = document.getElementById('help-search');
  var box = document.getElementById('help-results');
  if (!input || !box) return;
  function norm(s) { return String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9+−-]+/g, ' ').trim(); }
  function show(q) {
    var words = norm(q).split(' ').filter(Boolean);
    box.textContent = '';
    if (!words.length) { box.classList.remove('open'); return; }
    var hits = data
      .map(function (a) {
        var title = norm(a.title), all = title + ' ' + norm(a.summary) + ' ' + norm(a.section) + ' ' + norm(a.keywords);
        if (!words.every(function (w) { return all.indexOf(w) >= 0; })) return null;
        var score = words.filter(function (w) { return title.indexOf(w) >= 0; }).length;
        return { a: a, score: score };
      })
      .filter(Boolean)
      .sort(function (x, y) { return y.score - x.score; })
      .slice(0, 8);
    if (!hits.length) {
      var p = document.createElement('p');
      p.textContent = 'No matching help pages.';
      box.appendChild(p);
    }
    hits.forEach(function (h) {
      var link = document.createElement('a');
      link.href = '/help/' + h.a.slug;
      var b = document.createElement('b');
      b.textContent = h.a.title;
      var s = document.createElement('span');
      s.textContent = h.a.summary;
      link.appendChild(b);
      link.appendChild(s);
      box.appendChild(link);
    });
    box.classList.add('open');
  }
  input.addEventListener('input', function () { show(input.value); });
  input.addEventListener('focus', function () { if (input.value) show(input.value); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { input.value = ''; show(''); }
    if (e.key === 'Enter') { var first = box.querySelector('a'); if (first) location.href = first.href; }
    if (e.key === 'ArrowDown') { var f = box.querySelector('a'); if (f) { e.preventDefault(); f.focus(); } }
  });
  box.addEventListener('keydown', function (e) {
    var links = Array.prototype.slice.call(box.querySelectorAll('a'));
    var i = links.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < links.length - 1) { e.preventDefault(); links[i + 1].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? links[i - 1] : input).focus(); }
    if (e.key === 'Escape') { input.focus(); show(''); }
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.search')) box.classList.remove('open');
  });
})();
`;

// The Report a Problem link opens the app, where the form lives.
export const REPORT_HREF = '/dashboard?report=1';

function nav(articles, current) {
  const curSection = current ? current.section : 'Getting Started';
  const parts = [];
  for (const section of SECTIONS) {
    const inSec = articles.filter(a => a.section === section);
    if (!inSec.length) continue;
    if (section === 'Reference') {
      parts.push('<div class="rule"></div>');
      for (const a of inSec)
        parts.push(
          `<a href="/help/${a.slug}"${current && current.slug === a.slug ? ' class="sec-on" aria-current="page"' : ''}>${esc(a.title)}</a>`,
        );
      continue;
    }
    const on = section === curSection;
    parts.push(`<a href="/help#${sectionId(section)}"${on ? ' class="sec-on"' : ''}>${esc(section)}</a>`);
    if (on)
      for (const a of inSec) {
        const here = current && current.slug === a.slug;
        parts.push(
          `<a class="art${here ? ' art-on' : ''}" href="/help/${a.slug}"${here ? ' aria-current="page"' : ''}>${esc(a.title)}</a>`,
        );
      }
  }
  return `<nav class="topics" aria-label="Help Topics">${parts.join('')}</nav>`;
}

function page({ title, description, articles, current, mainHtml, indexJson }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="description" content="${esc(description)}" />
<title>${esc(title)}</title>
<meta name="theme-color" content="#0071e3" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<script src="/shared/sentry-init.js"></script>
<style>${STYLE}</style>
</head>
<body>
<a class="skip" href="#content">Skip to Content</a>
<div class="fv">
<header>
<div class="bar">
<a class="brand" href="/help">${LOGO}<b>FullVision</b><span>Help</span></a>
<div class="search">
<label><svg aria-hidden="true" width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="6" cy="6" r="4.5"></circle><path d="M9.5 9.5L13 13"></path></svg><input id="help-search" type="search" placeholder="Search Help" aria-label="Search Help" autocomplete="off" /></label>
<div id="help-results" class="results" aria-live="polite"></div>
</div>
<div class="spacer"></div>
<div class="ctas">
<a class="btn btn-grey" href="/login.html" data-link="signin">Sign In</a>
<a class="btn btn-blue cta-demo" href="/login.html?demo=1" data-link="demo">Try Demo Mode</a>
</div>
</div>
</header>
<div class="layout">
${nav(articles, current)}
<main id="content">
${mainHtml}
</main>
</div>
</div>
<script type="application/json" id="help-index">${indexJson.replace(/</g, '\\u003c')}</script>
<script>${SEARCH_SCRIPT}</script>
<script>${LINK_SCRIPT}</script>
</body>
</html>
`;
}

function foot(checked) {
  return (
    `<div class="foot"><span>Updated ${formatDate(checked)}</span>` +
    `<a href="${REPORT_HREF}">Report a Problem</a></div>`
  );
}

export function indexEntries(articles) {
  return articles.map(a => ({
    slug: a.slug,
    title: a.title,
    section: a.section,
    summary: a.summary,
    pages: a.pages,
    video: a.video || null,
    demo: a.demo || null,
  }));
}

export function build({ outDir = HELP, articlesDir = ARTICLES } = {}) {
  const articles = readArticles(articlesDir);
  const bySlug = Object.fromEntries(articles.map(a => [a.slug, a]));
  const entries = indexEntries(articles);
  // The page's own search data adds each article's labels, keywords and headings.
  const indexJson = JSON.stringify(
    entries.map((e, i) => {
      const a = articles[i];
      const headings = [...a.body.matchAll(/^#{2,3}\s+(.*)$/gm)].map(m => m[1]);
      return { ...e, keywords: [...a.labels, ...a.keywords, ...headings].join(' ') };
    }),
  );

  const fragDir = join(outDir, 'fragments');
  if (existsSync(fragDir)) rmSync(fragDir, { recursive: true });
  mkdirSync(fragDir, { recursive: true });

  for (const a of articles) {
    if (a.slug === 'index') throw new Error('"index" is not a usable slug');
    const body = articleBody(a, bySlug);
    writeFileSync(
      join(fragDir, a.slug + '.html'),
      `<article class="help-article">\n<h1>${esc(a.title)}</h1>\n${articleBody(a, bySlug, { fragment: true })}\n</article>\n`,
    );
    const crumbs =
      a.section === 'Reference'
        ? `<div class="crumbs"><a href="/help">Help</a></div>`
        : `<div class="crumbs"><a href="/help">Help</a> › <a href="/help#${sectionId(a.section)}">${esc(a.section)}</a></div>`;
    const mainHtml = `<article class="card">\n${crumbs}\n<h1>${esc(a.title)}</h1>\n${body}\n</article>\n${foot(a.checked)}`;
    writeFileSync(
      join(outDir, a.slug + '.html'),
      page({
        title: `${a.title} · FullVision Help`,
        description: a.summary,
        articles,
        current: a,
        mainHtml,
        indexJson,
      }),
    );
  }

  // The landing page: Getting Started in order, then every topic.
  const start = articles.filter(a => a.section === 'Getting Started');
  const startList = start
    .map(
      (a, i) =>
        `<li><span class="n">${i + 1}</span><div><a href="/help/${a.slug}">${esc(a.title)}</a><p>${inline(a.summary)}</p></div></li>`,
    )
    .join('');
  const toc = SECTIONS.filter(s => s !== 'Getting Started')
    .map(s => {
      const inSec = articles.filter(a => a.section === s);
      if (!inSec.length) return '';
      const heading = s === 'Reference' ? 'More Help' : s;
      return (
        `<section id="${sectionId(s)}"><h2>${esc(heading)}</h2><ul>` +
        inSec.map(a => `<li><a href="/help/${a.slug}">${esc(a.title)}</a></li>`).join('') +
        '</ul></section>'
      );
    })
    .join('');
  const latest = articles
    .map(a => String(a.checked))
    .sort()
    .pop();
  const landing =
    `<article class="card" id="getting-started">\n<h1>Getting Started</h1>\n` +
    `<p class="lead">A new class is set up in four tasks, in this order.</p>\n` +
    `<ol class="steps-list">${startList}</ol>\n` +
    `<p><a href="/login.html?demo=1" data-link="demo">Demo Mode</a> opens a sample Science 8 class on this device. Nothing is saved to an account.</p>\n</article>\n` +
    (toc ? `<div class="toc">${toc}</div>\n` : '') +
    foot(latest);
  writeFileSync(
    join(outDir, 'index.html'),
    page({
      title: 'FullVision Help',
      description: 'How to set up and use FullVision, the gradebook and report writer for BC teachers.',
      articles,
      current: null,
      mainHtml: landing,
      indexJson,
    }),
  );
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(entries, null, 2) + '\n');
  return { articles, entries };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outArg = process.argv.indexOf('--out');
  const outDir = outArg > 0 ? resolve(process.argv[outArg + 1]) : HELP;
  mkdirSync(outDir, { recursive: true });
  const { articles } = build({ outDir });
  console.log(`Help: ${articles.length} pages written to ${outDir}`);
}
