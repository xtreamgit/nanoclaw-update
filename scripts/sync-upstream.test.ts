/**
 * The weekday upstream sync must leave main alone and must not choose an
 * overlap. These fixtures run scripts/sync-upstream.sh against local repos
 * and check the workflow file still calls that script with the workflow token.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.join(__dirname, 'sync-upstream.sh');
const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'sync-upstream.yml');

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sync-upstream-'));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initRepo(): string {
  const dir = tempDir();
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'sync-test@example.com']);
  git(dir, ['config', 'user.name', 'Sync Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

function commit(dir: string, file: string, content: string, message: string): string {
  writeFileSync(path.join(dir, file), content);
  git(dir, ['add', file]);
  git(dir, ['commit', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']);
}

function point(dir: string, ref: string, sha: string): void {
  git(dir, ['update-ref', ref, sha]);
}

/** origin/main and upstream/main diverge from a shared base, or upstream is already contained. */
function fixture(kind: 'clean' | 'conflict' | 'contained'): { dir: string; origin: string; upstream: string } {
  const dir = initRepo();
  const base = commit(dir, 'shared.txt', 'base\n', 'base');

  if (kind === 'contained') {
    const upstream = commit(dir, 'upstream.txt', 'from upstream\n', 'upstream feature');
    const origin = commit(dir, 'local.txt', 'local\n', 'local commit');
    point(dir, 'refs/remotes/upstream/main', upstream);
    point(dir, 'refs/remotes/origin/main', origin);
    return { dir, origin, upstream };
  }

  const origin = commit(dir, kind === 'conflict' ? 'shared.txt' : 'local.txt', 'local\n', 'local commit');
  git(dir, ['checkout', '--detach', base]);
  const upstream = commit(dir, kind === 'conflict' ? 'shared.txt' : 'upstream.txt', 'upstream\n', 'upstream feature');
  point(dir, 'refs/remotes/upstream/main', upstream);
  point(dir, 'refs/remotes/origin/main', origin);
  git(dir, ['checkout', 'main']);
  return { dir, origin, upstream };
}

function run(dir: string, env: Record<string, string> = {}): string {
  return execFileSync('bash', [script], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

/** A gh that records its arguments. `GH_LIST_NUMBER` makes `pr list` report an open pull request. */
function installFakeGh(log: string): string {
  const bin = tempDir();
  const gh = path.join(bin, 'gh');
  writeFileSync(
    gh,
    `#!/bin/bash
printf '%s\\n' "$*" >> "$GH_LOG"
if [ "$1" = pr ] && [ "$2" = list ]; then
  printf '%s\\n' "\${GH_LIST_NUMBER:-}"
fi
exit 0
`,
  );
  chmodSync(gh, 0o755);
  return bin;
}

function withOrigin(dir: string, origin: string): string {
  const bare = tempDir();
  git(bare, ['init', '--bare', '-b', 'main']);
  git(dir, ['remote', 'add', 'origin', bare]);
  git(dir, ['push', 'origin', `${origin}:refs/heads/main`]);
  return bare;
}

function bodyOf(output: string): string {
  const marker = '--- body ---\n';
  const at = output.indexOf(marker);
  expect(at).toBeGreaterThanOrEqual(0);
  return output.slice(at + marker.length);
}

describe('sync upstream pull request', () => {
  it('stops when main already contains upstream', () => {
    const { dir } = fixture('contained');
    const output = run(dir, { DRY_RUN: '1' });
    expect(output).toContain('Nothing to do.');
    expect(output).not.toContain('push=');
  });

  it('asks for one pull request when the merge is clean, and lists only upstream commits', () => {
    const { dir } = fixture('clean');
    const before = git(dir, ['rev-parse', 'HEAD']);
    const output = run(dir, { DRY_RUN: '1' });
    const body = bodyOf(output);

    expect(output).toContain('status=clean');
    expect(output).toContain('push=upstream/main:refs/heads/sync/upstream-main');
    expect(output).toContain('base=main');
    expect(output).toContain('title=NanoClaw added new commits; review and merge.');
    expect(body).toContain('NanoClaw added new commits. Review them and merge.');
    expect(body).toContain('upstream feature');
    expect(body).not.toContain('local commit');
    expect(body).not.toContain('overlapping');
    expect(git(dir, ['status', '--porcelain'])).toBe('');
    expect(git(dir, ['rev-parse', 'HEAD'])).toBe(before);
  });

  it('still opens the pull request when the sides overlap, and does not choose', () => {
    const { dir } = fixture('conflict');
    const before = git(dir, ['rev-parse', 'HEAD']);
    const output = run(dir, { DRY_RUN: '1' });
    const body = bodyOf(output);

    expect(output).toContain('status=conflict');
    expect(output).toContain('push=upstream/main:refs/heads/sync/upstream-main');
    expect(body).toContain('NanoClaw added new commits. Review them and merge.');
    expect(body).toContain(
      'Some of these changes overlap with commits already on main. A person has to choose the overlapping changes. This workflow does not choose for you.',
    );
    expect(readFileSync(path.join(dir, 'shared.txt'), 'utf8')).toBe('local\n');
    expect(git(dir, ['status', '--porcelain'])).toBe('');
    expect(git(dir, ['rev-parse', 'HEAD'])).toBe(before);
    expect(git(dir, ['diff', '--exit-code'])).toBe('');
  });

  it('caps the listed commits at 30', () => {
    const dir = initRepo();
    const origin = commit(dir, 'shared.txt', 'base\n', 'base');
    let upstream = origin;
    for (let i = 1; i <= 31; i += 1) {
      upstream = commit(dir, 'upstream.txt', `n${i}\n`, `upstream commit ${i}`);
    }
    point(dir, 'refs/remotes/origin/main', origin);
    point(dir, 'refs/remotes/upstream/main', upstream);

    const body = bodyOf(run(dir, { DRY_RUN: '1' }));
    const bullets = body.split('\n').filter((line) => line.startsWith('- '));
    expect(bullets).toHaveLength(30);
    expect(bullets[0]).toBe('- upstream commit 31');
    expect(bullets.some((line) => line === '- upstream commit 1')).toBe(false);
    expect(body).toContain('And 1 more.');
  });

  it('pushes the sync branch and leaves main where it was, including a fast-forward', () => {
    const dir = initRepo();
    const origin = commit(dir, 'shared.txt', 'base\n', 'base');
    const upstream = commit(dir, 'upstream.txt', 'new\n', 'upstream feature');
    point(dir, 'refs/remotes/origin/main', origin);
    point(dir, 'refs/remotes/upstream/main', upstream);

    const bare = tempDir();
    git(bare, ['init', '--bare', '-b', 'main']);
    git(dir, ['remote', 'add', 'origin', bare]);
    git(dir, ['push', 'origin', `${origin}:refs/heads/main`]);

    const output = run(dir, { SYNC_SKIP_PR: '1' });
    expect(output).toContain('Pushed upstream/main to sync/upstream-main.');
    expect(git(bare, ['rev-parse', 'refs/heads/main'])).toBe(origin);
    expect(git(bare, ['rev-parse', 'refs/heads/sync/upstream-main'])).toBe(upstream);
    expect(git(bare, ['show', 'refs/heads/sync/upstream-main:upstream.txt'])).toBe('new');
  });

  it('pushes upstream unchanged when the sides overlap', () => {
    const { dir, origin, upstream } = fixture('conflict');
    const bare = tempDir();
    git(bare, ['init', '--bare', '-b', 'main']);
    git(dir, ['remote', 'add', 'origin', bare]);
    git(dir, ['push', 'origin', `${origin}:refs/heads/main`]);

    run(dir, { SYNC_SKIP_PR: '1' });

    expect(git(bare, ['rev-parse', 'refs/heads/main'])).toBe(origin);
    expect(git(bare, ['rev-parse', 'refs/heads/sync/upstream-main'])).toBe(upstream);
    expect(git(bare, ['rev-parse', 'refs/heads/sync/upstream-main^{tree}'])).toBe(
      git(dir, ['rev-parse', `${upstream}^{tree}`]),
    );
    const shared = git(bare, ['show', 'refs/heads/sync/upstream-main:shared.txt']);
    expect(shared).toBe('upstream');
    expect(shared).not.toContain('<<<<<<<');
  });

  it('does not overwrite a sync branch that already has other commits', () => {
    const { dir, origin, upstream } = fixture('clean');
    const bare = tempDir();
    git(bare, ['init', '--bare', '-b', 'main']);
    git(dir, ['remote', 'add', 'origin', bare]);
    git(dir, ['push', 'origin', `${origin}:refs/heads/main`]);
    git(dir, ['push', 'origin', `${origin}:refs/heads/sync/upstream-main`]);

    expect(() => run(dir, { SYNC_SKIP_PR: '1' })).toThrow(/Did not update sync\/upstream-main/);
    expect(git(bare, ['rev-parse', 'refs/heads/main'])).toBe(origin);
    expect(git(bare, ['rev-parse', 'refs/heads/sync/upstream-main'])).toBe(origin);
    expect(git(bare, ['rev-parse', 'refs/heads/sync/upstream-main'])).not.toBe(upstream);
  });

  it('refuses a branch name that would push to main', () => {
    const { dir } = fixture('clean');
    expect(() => run(dir, { DRY_RUN: '1', SYNC_BRANCH: 'main' })).toThrow(/Refusing to push to main/);
    expect(() => run(dir, { DRY_RUN: '1', SYNC_BRANCH: 'sync/upstream-main:refs/heads/main' })).toThrow(
      /Refusing to push/,
    );
  });

  it('opens a pull request when the sides overlap, and updates that same one', () => {
    const { dir, origin, upstream } = fixture('conflict');
    const bare = withOrigin(dir, origin);
    const log = path.join(tempDir(), 'gh.log');
    const env = {
      PATH: `${installFakeGh(log)}:${process.env.PATH ?? ''}`,
      GH_LOG: log,
      GITHUB_REPOSITORY: 'xtreamgit/nanoclaw-update',
    };

    const created = run(dir, env);
    const createLog = readFileSync(log, 'utf8');
    expect(created).not.toContain('Updated pull request');
    expect(createLog).toContain('pr create --repo xtreamgit/nanoclaw-update --base main --head sync/upstream-main');
    expect(createLog).toContain('NanoClaw added new commits; review and merge.');
    expect(createLog).toContain(
      'Some of these changes overlap with commits already on main. A person has to choose the overlapping changes.',
    );
    expect(createLog).not.toContain('pr edit');
    expect(git(bare, ['rev-parse', 'refs/heads/main'])).toBe(origin);
    expect(git(bare, ['rev-parse', 'refs/heads/sync/upstream-main'])).toBe(upstream);

    writeFileSync(log, '');
    const updated = run(dir, { ...env, GH_LIST_NUMBER: '7' });
    const editLog = readFileSync(log, 'utf8');
    expect(updated).toContain('Updated pull request #7');
    expect(editLog).toContain('pr edit --repo xtreamgit/nanoclaw-update 7');
    expect(editLog).toContain('A person has to choose the overlapping changes. This workflow does not choose for you.');
    expect(editLog).not.toContain('pr create');
    expect(git(bare, ['rev-parse', 'refs/heads/main'])).toBe(origin);
  });

  it('ships a single push, and that push is not a merge', () => {
    const text = readFileSync(script, 'utf8');
    expect(text.match(/\bgit push\b/g)).toHaveLength(1);
    expect(text).toContain('git push origin "${UPSTREAM_REF}:refs/heads/${SYNC_BRANCH}"');
    expect(text).not.toMatch(/^\s*git merge(\s|$)/m);
    expect(text).not.toMatch(/-X[[:space:]]+(ours|theirs)/);
    expect(text).not.toMatch(/--strategy-option/);
    expect(text).not.toMatch(/checkout --(ours|theirs)/);
  });

  it('schedules the workflow on weekdays and uses the workflow token', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    expect([...workflow.matchAll(/cron:\s*'([^']+)'/g)].map((match) => match[1])).toEqual(['17 13 * * 1-5']);
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s*pull_request:/m);
    expect(workflow).toContain('bash scripts/sync-upstream.sh');
    expect(workflow).toContain('https://github.com/nanocoai/nanoclaw.git');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('pull-requests: write');
    expect(workflow).toContain('ubuntu-26.04');
    expect([...workflow.matchAll(/secrets\.[A-Z0-9_]+/g)].map((match) => match[0])).toEqual(['secrets.GITHUB_TOKEN']);
    expect(workflow).not.toContain('x-access-token');
  });
});
