// Proposed eslint.config.mjs for FullVision (no bundler, script-tag globals).
// Two rules only, no-undef and no-unused-vars, both warnings except no-undef
// in the files listed in scripts/lint-ratchet.mjs, where it is an error.
// Page globals come from the <script src> tags of the four pages, computed at
// load time by scripts/lint-globals.mjs (so nothing generated is committed).
import globals from 'globals';
import { pageGlobals } from './scripts/lint-globals.mjs';
import { NO_UNDEF_FILES, strictGlobals } from './scripts/lint-ratchet.mjs';

const { byFile, pages } = pageGlobals(import.meta.dirname);

const RULES = {
  'no-undef': 'warn',
  // vars:'local' — a top-level var/function in a classic script is a page
  // global other files use, so only locals are checked.
  'no-unused-vars': ['warn', { vars: 'local', args: 'after-used', caughtErrors: 'none' }],
};

// One block per page-file, its globals the union of the pages that load it.
// The files in scripts/lint-ratchet.mjs instead get only the globals every
// page loading them defines, and no-undef is an error there (S19-D15).
const perFile = Object.entries(byFile).map(([file, pageNames]) =>
  NO_UNDEF_FILES[file]
    ? {
        files: [file],
        languageOptions: { globals: strictGlobals(file, byFile, pages) },
        rules: { 'no-undef': 'error' },
      }
    : {
        files: [file],
        languageOptions: {
          globals: Object.assign({}, ...pageNames.map(p => pages[p].globals)),
        },
      },
);

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'vendor/**',
      '**/*.min.js',
      'curriculum_data.js',
      'shared/bank-*.js',
      'help/**',
      'supabase/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  // Browser code: classic scripts sharing one global scope per page.
  {
    files: ['shared/**/*.js', 'teacher/**/*.js', 'teacher-mobile/**/*.js', 's/**/*.js', 'login-auth.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.browser, Sentry: 'readonly', module: 'readonly' },
    },
    rules: RULES,
  },
  ...perFile,
  // The service worker.
  {
    files: ['sw.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } },
    rules: RULES,
  },
  // Node scripts and configs.
  {
    files: ['scripts/**/*.{js,mjs,cjs}', '*.config.js', 'eslint.config.mjs', 'netlify/**/*.{js,mjs}'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node, Netlify: 'readonly' } },
    rules: RULES,
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  // Vitest: modules whose globals are the desktop page plus vitest's.
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.vitest,
        ...pages.desktop.globals,
        ...pages.phone.globals,
      },
    },
    rules: RULES,
  },
  // Playwright specs: Node modules; code inside page.evaluate runs in the page.
  {
    files: ['e2e/**/*.js', 'e2e-real/**/*.js', 'e2e-perf/**/*.js', 'e2e-visual/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, ...pages.desktop.globals, ...pages.phone.globals },
    },
    rules: RULES,
  },
];
