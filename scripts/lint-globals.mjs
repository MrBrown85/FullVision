// scripts/lint-globals.mjs (proposed): the globals each page defines, read from
// its <script src> tags plus the files it lazy-loads. Used by eslint.config.mjs.
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

let root;

// Files a page fetches later with document.createElement('script').
// Found with: rg -n "createElement\(['\"]script" shared teacher teacher-mobile s
const LAZY = {
  desktop: [
    'shared/bank-core-competencies.js', // teacher/page-assignments.js:2298
    'shared/bank-proficiency.js', // teacher/rubric-print.js:225, shared/competency-wording.js:77
    'shared/bank-comment.js', // shared/competency-wording.js:80
    'shared/bank-sets.js', // teacher/comment-bank.js:1224
    'shared/comment-bank.js', // teacher/comment-bank.js:8244
    'curriculum_data.js', // shared/data-curriculum-index.js:23
    'shared/seed-data.js', // shared/data-demo.js:12
    // Reports' own scripts, loaded the first time Reports opens (teacher/router.js _onDemand).
    'teacher/report-sheets.js',
    'teacher/report-issues.js',
    'teacher/report-qn-browse-cases.js',
    'teacher/report-qn-voice-observations.js',
    'teacher/report-questionnaire.js',
    'teacher/grade-report.js',
    'teacher/report-preview.js',
    'teacher/report-feedback.js',
    'teacher/report-feedback-cards.js',
    'teacher/report-one.js',
    'teacher/report-one-panel.js',
    'teacher/report-one-page.js',
    'teacher/report-one-comment.js',
    'teacher/report-one-zoom.js',
    'teacher/report-one-head.js',
    'teacher/report-print-paper.js',
    'teacher/page-reports.js',
    // Assignments' rubric scripts, loaded before Assignments first draws (teacher/router.js _onDemand).
    'teacher/rubric-library.js',
    'teacher/rubric-bank.js',
    // Loaded the first time a button uses them (teacher/router.js withScripts).
    'teacher/grades-print.js',
    'teacher/grading-setup-copy.js',
    'vendor/qrcode.js',
  ],
  phone: ['shared/bank-proficiency.js', 'shared/bank-comment.js', 'curriculum_data.js', 'shared/seed-data.js'],
  student: [
    'shared/constants.js', // s/app.js:2072 (GRADE_FILES)
    'shared/calc.js', // s/app.js:2078
    'shared/photo-shrink.js', // s/send.js
    'shared/photo-readers.js', // s/send.js
    'shared/photo-queue.js', // s/send.js:813
    'shared/questionnaire-templates.js', // s/student.js:635
  ],
  login: [],
};
const PAGES = {
  desktop: 'teacher/app.html',
  phone: 'teacher-mobile/index.html',
  student: 's/index.html',
  login: 'login.html',
};
const VENDOR_GLOBALS = {
  'vendor/supabase.min.js': ['supabase'],
  'vendor/qrcode.js': ['qrcode', 'QRCode'],
};

function scriptsOf(htmlRel) {
  const html = fs.readFileSync(path.join(root, htmlRel), 'utf8');
  const dir = path.posix.dirname(htmlRel);
  const out = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    let src = m[1].split('?')[0];
    if (/^https?:/.test(src)) continue;
    src = src.startsWith('/') ? src.slice(1) : path.posix.normalize(path.posix.join(dir, src));
    out.push(src);
  }
  return out;
}

const asts = new Map();
function parse(rel) {
  if (asts.has(rel)) return asts.get(rel);
  const file = path.join(root, rel);
  let ast = null;
  if (fs.existsSync(file)) {
    try {
      ast = acorn.parse(fs.readFileSync(file, 'utf8'), {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowHashBang: true,
      });
    } catch (e) {
      console.error('parse failed', rel, e.message);
    }
  }
  asts.set(rel, ast);
  return ast;
}

// The scripts a page adds while it runs, read from the code rather than LAZY:
// every string in a loaded script that names a .js file in the repo (such as
// '/shared/seed-data.js?v=46' or the paths in teacher/router.js's _onDemand)
// and is not one of the page's <script> tags, and the same for those files.
// Used by scripts/lint-ratchet.mjs; LAZY stays for the report-only lint.
function runtimeScriptsOf(htmlRel, tagged) {
  const dir = path.posix.dirname(htmlRel);
  const seen = new Set(tagged);
  const found = [];
  const queue = [...tagged];
  while (queue.length) {
    const ast = parse(queue.shift());
    if (!ast) continue;
    const strings = [];
    walk.simple(ast, {
      Literal(n) {
        if (typeof n.value === 'string') strings.push(n.value);
      },
      TemplateLiteral(n) {
        if (!n.expressions.length) strings.push(n.quasis[0].value.cooked);
      },
    });
    for (const str of strings) {
      const m = /^([\w./-]+\.js)(\?.*)?$/.exec(str);
      if (!m) continue;
      const rel = m[1].startsWith('/') ? m[1].slice(1) : path.posix.normalize(path.posix.join(dir, m[1]));
      if (seen.has(rel) || !fs.existsSync(path.join(root, rel))) continue;
      seen.add(rel);
      found.push(rel);
      queue.push(rel);
    }
  }
  return found;
}

function definedBy(rel) {
  if (VENDOR_GLOBALS[rel]) return VENDOR_GLOBALS[rel];
  const ast = parse(rel);
  if (!ast) return [];
  const names = new Set();
  for (const node of ast.body) {
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) if (d.id.type === 'Identifier') names.add(d.id.name);
    } else if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) {
      names.add(node.id.name);
    }
  }
  walk.simple(ast, {
    AssignmentExpression(n) {
      const l = n.left;
      if (
        l.type === 'MemberExpression' &&
        !l.computed &&
        l.object.type === 'Identifier' &&
        ['window', 'globalThis', 'self'].includes(l.object.name) &&
        l.property.type === 'Identifier'
      ) {
        names.add(l.property.name);
      }
    },
  });
  return [...names];
}

export function pageGlobals(rootDir) {
  root = path.resolve(rootDir);
  const result = { pages: {}, fileToPages: {} };
  for (const [page, html] of Object.entries(PAGES)) {
    const tagged = scriptsOf(html);
    const lazy = LAZY[page];
    const globals = {};
    const definedIn = {};
    for (const rel of [...tagged, ...lazy]) {
      for (const g of definedBy(rel)) {
        globals[g] = 'writable';
        (definedIn[g] ||= []).push(rel);
      }
      (result.fileToPages[rel] ||= []).includes(page) || result.fileToPages[rel].push(page);
    }
    const runtime = runtimeScriptsOf(html, tagged);
    const tagGlobals = {};
    for (const rel of tagged) for (const g of definedBy(rel)) tagGlobals[g] = 'writable';
    const runtimeDefinedIn = {};
    for (const rel of runtime) for (const g of definedBy(rel)) (runtimeDefinedIn[g] ||= []).push(rel);
    result.pages[page] = {
      html,
      scripts: tagged,
      lazy,
      runtime,
      count: Object.keys(globals).length,
      globals,
      tagGlobals,
      runtimeDefinedIn,
      definedIn,
    };
  }
  return { pages: result.pages, byFile: result.fileToPages };
}
