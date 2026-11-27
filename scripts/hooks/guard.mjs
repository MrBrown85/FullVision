// scripts/hooks/guard.mjs: Claude Code's PreToolUse hook for FullVision's hard limits.
//
// CLAUDE.md states the rules; this makes the ones a session could break by
// accident impossible to break by accident (docs/testing.md, "Hooks"):
//
//   1. Nothing goes into `production` unless Colin's latest message says
//      "release" (CLAUDE.md rule 8).
//   2. A change to the live database (gradebook-prod) asks him first:
//      every apply_migration and deploy_edge_function, and any execute_sql
//      that is not plainly a read (CLAUDE.md rule 1).
//   3. No --no-verify, and no force-push to main or production.
//   4. A commit that deletes test files names why, in a "Tests removed:" line.
//
// Claude Code pipes the tool call in as JSON on stdin. The answer is JSON on
// stdout (permissionDecision deny or ask), or nothing to let the call go
// ahead. Any error in here lets the call go ahead: a broken guard must never
// stop all work, and CI and the reviewer still stand behind it.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const LIVE_PROJECT = 'novsfeqjhbleyyaztmlh';

// --- reading the input -------------------------------------------------------

/** Colin's latest typed message in the session transcript, or ''. */
export function lastUserText(transcriptText) {
  const lines = String(transcriptText || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!row || row.type !== 'user' || row.isMeta || row.isSidechain) continue;
    const content = row.message && row.message.content;
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
      if (content.some(part => part && part.type === 'tool_result')) continue;
      text = content
        .filter(part => part && part.type === 'text')
        .map(part => part.text)
        .join('\n');
    }
    text = text.trim();
    // Messages the app sends in the user's place (events, reminders) start with a tag.
    if (!text || text.startsWith('<')) continue;
    return text;
  }
  return '';
}

/** Split a shell command into its simple commands (on && || ; | and newlines). */
export function simpleCommands(command) {
  return String(command || '')
    .split(/&&|\|\||;|\||\n/)
    .map(part => part.trim())
    .filter(Boolean);
}

// --- rule 1: production -------------------------------------------------------

/** Does this command put something into production? 'pr-merge:N' when it needs a lookup. */
export function productionTouch(command) {
  for (const cmd of simpleCommands(command)) {
    if (/^gh\s+pr\s+create\b/.test(cmd) && /--base(?:=|\s+)production\b/.test(cmd)) return 'pr-create';
    if (/^git\s+push\b/.test(cmd)) {
      const args = cmd
        .split(/\s+/)
        .slice(2)
        .filter(a => !a.startsWith('-'));
      // The refspecs after the remote: production, x:production, refs/heads/production.
      if (args.slice(1).some(ref => /(^|:|refs\/heads\/)production$/.test(ref))) return 'push';
    }
    const merge = cmd.match(/^gh\s+pr\s+merge\b(?:\s+(\d+))?/);
    if (merge) return 'pr-merge:' + (merge[1] || '');
    const apiMerge = cmd.match(/^gh\s+api\b.*pulls\/(\d+)\/merge\b/);
    if (apiMerge) return 'pr-merge:' + apiMerge[1];
  }
  return '';
}

export function saidRelease(text) {
  return /\brelease\b/i.test(text || '');
}

// --- rule 2: the live database ----------------------------------------------

/** Is this SQL plainly a read? Anything that might write is not. */
export function isPlainRead(sql) {
  const text = String(sql || '')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .toLowerCase();
  if (!/^\s*(select|with|explain|show)\b/.test(text)) return false;
  const writes =
    /\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|comment\s+on|copy|call|do|vacuum|reindex|refresh|lock|set\s+(local\s+)?role|set_config|nextval|setval|pg_terminate_backend|pg_cancel_backend)\b/;
  return !writes.test(text);
}

export function liveDatabaseDecision(toolName, input) {
  if (!input || input.project_id !== LIVE_PROJECT) return null;
  if (/apply_migration$/.test(toolName)) return 'a migration on gradebook-prod';
  if (/deploy_edge_function$/.test(toolName)) return 'an edge function deploy to gradebook-prod';
  if (/execute_sql$/.test(toolName) && !isPlainRead(input.query)) return 'SQL on gradebook-prod that may write';
  return null;
}

// --- rule 3: skipped checks and force-pushes -------------------------------------

export function skippedChecks(command, currentBranch) {
  for (const cmd of simpleCommands(command)) {
    if (!/^git\s+(commit|push|merge|rebase)\b/.test(cmd)) continue;
    if (/\s--no-verify\b/.test(cmd)) return 'it skips the git hooks (--no-verify)';
    if (!/^git\s+push\b/.test(cmd)) continue;
    if (!/\s(--force(-with-lease)?(=\S+)?|-f)(\s|$)/.test(cmd) && !/\s\+\S+/.test(cmd)) continue;
    const args = cmd
      .split(/\s+/)
      .slice(2)
      .filter(a => !a.startsWith('-'));
    const refs = args.slice(1).map(ref => ref.replace(/^\+/, '').split(':').pop());
    const targets = refs.length ? refs : [currentBranch];
    if (targets.some(ref => /^(refs\/heads\/)?(main|production)$/.test(ref || ''))) {
      return 'it force-pushes to main or production';
    }
  }
  return '';
}

// --- rule 4: deleted tests -------------------------------------------------------

export function isTestFile(path) {
  return /^(tests\/.+\.test\.js|e2e\/.+\.spec\.js)$/.test(path);
}

export function deletedTestsProblem(command, deletedPaths) {
  if (!simpleCommands(command).some(cmd => /^git\s+commit\b/.test(cmd))) return '';
  const tests = deletedPaths.filter(isTestFile);
  if (!tests.length || /Tests removed:/i.test(command)) return '';
  return (
    `This commit deletes ${tests.length} test file${tests.length === 1 ? '' : 's'} (${tests.join(', ')}). ` +
    'Say why in the commit message, on a line that starts "Tests removed:" ' +
    '(for example, which new tests now cover what they checked), then commit again. ' +
    'Never delete a test to make a change pass (.claude/agents/builder.md).'
  );
}

// --- the decision ------------------------------------------------------------------

const deny = reason => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
});
const ask = reason => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason },
});

/**
 * @param {any} event the hook's stdin JSON
 * @param {{ transcript: () => string, branch: () => string, deleted: (all: boolean) => string[], prBase: (n: string) => string }} env
 */
export function decide(event, env) {
  const tool = String(event.tool_name || '');
  const input = event.tool_input || {};

  const live = liveDatabaseDecision(tool, input);
  if (live) return ask(`This is ${live}. CLAUDE.md rule 1: Colin sees it and approves it first.`);
  if (tool !== 'Bash') return null;

  const command = String(input.command || '');
  let touch = productionTouch(command);
  if (touch.startsWith('pr-merge:')) touch = env.prBase(touch.slice(9)) === 'production' ? 'pr-merge' : '';
  if (touch && !saidRelease(env.transcript())) {
    return deny(
      'This puts work into production, and Colin\'s latest message does not say "release". ' +
        'A release happens only on his word in that moment (CLAUDE.md rule 8). Tell him it is ready and wait.',
    );
  }

  if (/\bgit\s+(commit|push|merge|rebase)\b/.test(command)) {
    const skipped = skippedChecks(command, /\bgit\s+push\b/.test(command) ? env.branch() : '');
    if (skipped) return deny(`Not allowed: ${skipped}. Fix what the check found instead.`);
  }

  if (/\bgit\s+commit\b/.test(command)) {
    // -a, --all or a bundle such as -am also commits files deleted on disk.
    const all = simpleCommands(command).some(
      cmd => /^git\s+commit\b/.test(cmd) && /\s(--all|-[a-zA-Z]*a[a-zA-Z]*)(\s|$)/.test(cmd),
    );
    const problem = deletedTestsProblem(command, env.deleted(all));
    if (problem) return deny(problem);
  }
  return null;
}

// --- running as the hook -------------------------------------------------------------

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
  } catch {
    return '';
  }
}

function realEnv(event) {
  const cwd = event.cwd || process.cwd();
  return {
    transcript: () => {
      try {
        return readFileSync(event.transcript_path, 'utf-8');
      } catch {
        return '';
      }
    },
    branch: () => git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
    deleted: all => {
      const staged = git(cwd, ['diff', '--cached', '--name-only', '--diff-filter=D']);
      const unstaged = all ? git(cwd, ['diff', '--name-only', '--diff-filter=D']) : '';
      return (staged + '\n' + unstaged).split('\n').filter(Boolean);
    },
    prBase: n => {
      try {
        // No number: the PR of the branch checked out where the command runs.
        const args = n ? ['pr', 'view', n, '--repo', 'MrBrown85/FullVision'] : ['pr', 'view'];
        return execFileSync('gh', [...args, '--json', 'baseRefName', '-q', '.baseRefName'], {
          cwd,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 10000,
        }).trim();
      } catch {
        // Can't tell which branch the PR goes into: treat it as production, the safe side.
        return 'production';
      }
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const event = JSON.parse(readFileSync(0, 'utf-8') || '{}');
    const answer = decide(event, realEnv(event));
    if (answer) process.stdout.write(JSON.stringify(answer));
  } catch {
    // Never block work because the guard itself failed.
  }
}
