/**
 * scripts/hooks/guard.mjs is the PreToolUse hook that holds CLAUDE.md's hard
 * limits: nothing into production without Colin's "release", the live
 * database asks first, no skipped checks or force-pushes to main, and a
 * reason for every deleted test. These cases pin what it lets through.
 */
import { describe, expect, it } from 'vitest';
import { decide, isPlainRead, lastUserText, productionTouch } from '../scripts/hooks/guard.mjs';

const said = text => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const toolResult = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'release' }] },
});

function env(over = {}) {
  return {
    transcript: () => said('please tidy the memory'),
    branch: () => 'claude/some-branch',
    deleted: () => [],
    prBase: () => 'main',
    ...over,
  };
}
const bash = command => ({ tool_name: 'Bash', tool_input: { command } });
const decision = answer => answer && answer.hookSpecificOutput.permissionDecision;

describe("Colin's latest message", () => {
  it('skips tool results, app events and skill text', () => {
    const transcript = [
      said('Release it now'),
      toolResult,
      said('<ci-monitor-event>Auto-fix was enabled</ci-monitor-event>'),
      JSON.stringify({
        type: 'user',
        isMeta: true,
        message: { role: 'user', content: 'Base directory for this skill' },
      }),
    ].join('\n');
    expect(lastUserText(transcript)).toBe('Release it now');
  });

  it('reads a message sent as parts', () => {
    const parts = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'yes, release' }] },
    });
    expect(lastUserText(parts)).toBe('yes, release');
  });
});

describe('production', () => {
  it('finds every way into production', () => {
    expect(productionTouch('gh pr create --base production --head main')).toBe('pr-create');
    expect(productionTouch('cd x && gh pr create --repo a/b --base=production --head release/abc')).toBe('pr-create');
    expect(productionTouch('git push origin main:production')).toBe('push');
    expect(productionTouch('git push origin abc123:refs/heads/production')).toBe('push');
    expect(productionTouch('gh pr merge 1911 --squash')).toBe('pr-merge:1911');
    expect(productionTouch('gh pr merge --squash')).toBe('pr-merge:');
  });

  it('leaves release branches and main alone', () => {
    expect(productionTouch('git push origin abc123:refs/heads/release/abc123')).toBe('');
    expect(productionTouch('gh pr create --base main --head claude/x')).toBe('');
    expect(productionTouch('git push -u origin claude/x')).toBe('');
  });

  it('refuses without "release" and allows with it', () => {
    const cmd = bash('gh pr create --base production --head main --title "Release"');
    expect(decision(decide(cmd, env()))).toBe('deny');
    expect(decide(cmd, env({ transcript: () => said('Release it now') }))).toBeNull();
  });

  it('checks which branch a merged PR goes into', () => {
    expect(decide(bash('gh pr merge 1904 --squash'), env())).toBeNull();
    expect(decision(decide(bash('gh pr merge 1905 --squash'), env({ prBase: () => 'production' })))).toBe('deny');
  });
});

describe('the live database', () => {
  const live = (tool, input) => ({
    tool_name: 'mcp__srv__' + tool,
    tool_input: { project_id: 'novsfeqjhbleyyaztmlh', ...input },
  });

  it('asks before a migration or an edge function deploy', () => {
    expect(decision(decide(live('apply_migration', { name: 'x', query: 'create table t()' }), env()))).toBe('ask');
    expect(decision(decide(live('deploy_edge_function', { name: 'student-submit' }), env()))).toBe('ask');
  });

  it('lets plain reads through and asks before anything that may write', () => {
    expect(decide(live('execute_sql', { query: 'select count(*) from course' }), env())).toBeNull();
    expect(decide(live('execute_sql', { query: 'with x as (select 1) select * from x' }), env())).toBeNull();
    expect(decision(decide(live('execute_sql', { query: 'update course set name = 1' }), env()))).toBe('ask');
    expect(
      decision(decide(live('execute_sql', { query: "select set_config('request.jwt.claims', '{}', true)" }), env())),
    ).toBe('ask');
    expect(isPlainRead('begin; set local role authenticated; select start_handout_upload()')).toBe(false);
  });

  it('leaves other projects (branches, local) alone', () => {
    const branch = {
      tool_name: 'mcp__srv__apply_migration',
      tool_input: { project_id: 'otherbranchref', query: 'drop table t' },
    };
    expect(decide(branch, env())).toBeNull();
  });
});

describe('skipped checks and force-pushes', () => {
  it('refuses --no-verify', () => {
    expect(decision(decide(bash('git commit --no-verify -m "x"'), env()))).toBe('deny');
    expect(decision(decide(bash('git push --no-verify origin claude/x'), env()))).toBe('deny');
  });

  it('refuses a force-push to main or production, by name or from the branch checked out', () => {
    expect(decision(decide(bash('git push --force origin main'), env()))).toBe('deny');
    expect(decision(decide(bash('git push -f origin +abc:production'), env()))).toBe('deny');
    expect(decision(decide(bash('git push --force-with-lease'), env({ branch: () => 'main' })))).toBe('deny');
  });

  it('allows a force-push to a work branch', () => {
    expect(decide(bash('git push --force-with-lease origin claude/x'), env())).toBeNull();
  });
});

describe('deleted tests', () => {
  const withDeleted = env({ deleted: () => ['tests/old-screen.test.js', 'teacher/old.js'] });

  it('asks for a reason when a commit deletes a test file', () => {
    expect(decision(decide(bash('git commit -m "Redraw the screen"'), withDeleted))).toBe('deny');
  });

  it('accepts the commit once the reason is in the message', () => {
    const cmd = bash('git commit -m "Redraw the screen\n\nTests removed: covered by tests/new-screen.test.js"');
    expect(decide(cmd, withDeleted)).toBeNull();
  });

  it('ignores deletions that are not tests', () => {
    expect(decide(bash('git commit -m "x"'), env({ deleted: () => ['teacher/old.js'] }))).toBeNull();
  });
});

it('lets everyday commands through', () => {
  for (const command of ['ls', 'npm test', 'git status', 'git commit -m "x"', 'gh pr view 1 --json state']) {
    expect(decide(bash(command), env())).toBeNull();
  }
  expect(decide({ tool_name: 'Read', tool_input: { file_path: 'CLAUDE.md' } }, env())).toBeNull();
});
