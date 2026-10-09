import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Account, Project, Repo, Task, TaskDetail, Overview, PullRequestStatus } from '@watergirl/shared';
import { buildApp, type App } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import type { Notice } from '../src/notify.ts';
import { FAKE_TOKEN, startFakeGithub } from './fixtures/fake-github.ts';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const AUTH = { authorization: 'Bearer test-token' };

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** A bare "GitHub" remote with one commit on main. */
function makeRemote(root: string) {
  const bare = join(root, 'origin.git');
  execFileSync('git', ['init', '--bare', '-b', 'main', bare]);
  const seed = join(root, 'seed');
  execFileSync('git', ['clone', bare, seed], { stdio: 'ignore' });
  writeFileSync(join(seed, 'README.md'), '# nucleus\n');
  git(seed, 'add', '.');
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init');
  git(seed, 'push', 'origin', 'HEAD:main');
  return bare;
}

describe('Water Girl end to end (fake Claude + fake GitHub + local git remote)', () => {
  let root: string;
  let app: App;
  let gh: Awaited<ReturnType<typeof startFakeGithub>>;
  let bare: string;
  let repo: Repo;
  const notices: Notice[] = [];
  const claudeLog = () => readFileSync(join(root, 'claude.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);

  async function call<T>(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, expect = 200): Promise<T> {
    const res = await app.server.inject({ method, url, headers: AUTH, payload: payload as object });
    assert.equal(res.statusCode, expect, `${method} ${url} → ${res.statusCode}: ${res.body}`);
    return res.json() as T;
  }

  async function newTask(prompt: string): Promise<Task> {
    const t = await call<Task>('POST', '/api/tasks', { repoId: repo.id, prompt });
    await app.runner.idle();
    return (await call<TaskDetail>('GET', `/api/tasks/${t.id}`)).task;
  }

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'wg-test-'));
    bare = makeRemote(root);
    gh = await startFakeGithub();
    process.env.FAKE_CLAUDE_LOG = join(root, 'claude.log');
    process.env.WG_PROBE_SECRET = 'must-not-reach-agents';
    const config = loadConfig({
      WG_DATA_DIR: join(root, 'data'),
      WG_TOKEN: 'test-token',
      WG_CLAUDE_BIN: FAKE_CLAUDE,
      WG_GITHUB_API_URL: gh.url,
      WG_MAX_PARALLEL: '2',
    });
    app = buildApp({ config, notify: async (n) => void notices.push(n) });
  });

  after(async () => {
    delete process.env.WG_PROBE_SECRET;
    await app.server.close();
    await gh.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects requests without the token', async () => {
    assert.equal((await app.server.inject({ url: '/api/health' })).statusCode, 200);
    assert.equal((await app.server.inject({ url: '/api/overview' })).statusCode, 401);
    const wrong = await app.server.inject({ url: '/api/overview', headers: { authorization: 'Bearer nope' } });
    assert.equal(wrong.statusCode, 401);
  });

  it('connects a GitHub account, a project and a repo', async () => {
    const bad = await app.server.inject({ method: 'POST', url: '/api/accounts', headers: AUTH, payload: { token: 'wrong' } });
    assert.equal(bad.statusCode, 400);

    const acc = await call<Account>('POST', '/api/accounts', { token: FAKE_TOKEN });
    assert.equal(acc.login, 'ash');
    assert.ok(!('tokenEnc' in acc), 'token must never be returned');
    await call('POST', '/api/accounts', { token: FAKE_TOKEN }, 409);

    const options = await call<{ fullName: string }[]>('GET', `/api/accounts/${acc.id}/github-repos`);
    assert.deepEqual(options.map((o) => o.fullName), ['ash/nucleus']);

    const project = await call<Project>('POST', '/api/projects', { name: 'Nucleus' });
    repo = await call<Repo>('POST', '/api/repos', { projectId: project.id, accountId: acc.id, fullName: 'ash/nucleus', cloneUrl: bare });
    assert.equal(repo.defaultBranch, 'main');
    await call('POST', '/api/repos', { projectId: project.id, accountId: acc.id, fullName: 'ash/nucleus' }, 409);
  });

  it('runs a task in its own worktree, pushes the branch and opens a PR', async () => {
    const task = await newTask('Add a hello file for order management');
    assert.equal(task.status, 'review', task.error ?? '');
    assert.equal(task.prNumber, 1);
    assert.match(task.branch, /^wg\/add-a-hello-file-for-order-management-[0-9a-f]{6}$/);
    assert.equal(task.costUsd, 0.25);

    const detail = await call<TaskDetail>('GET', `/api/tasks/${task.id}`);
    const texts = detail.events.map((e) => `${e.kind}: ${e.text}`);
    assert.ok(texts.includes('user: Add a hello file for order management'));
    assert.ok(texts.includes('status: Agent started (fake-model)'));
    assert.ok(texts.includes('tool: Wrote hello.txt'), texts.join('\n'));
    assert.ok(texts.some((t) => t.startsWith('tool: ⚠ lint warning')));
    assert.ok(texts.includes(`git: Pushed 1 commit to ${task.branch}.`));
    assert.ok(texts.includes('git: Opened PR #1.'));

    // The branch really landed on the remote with the agent's file.
    assert.equal(git(bare, 'show', `${task.branch}:hello.txt`), 'Add a hello file for order management');
    assert.equal(gh.pulls[0].head, task.branch);
    assert.match(gh.pulls[0].body, /Added hello.txt/);

    // First run starts a session with our id.
    const firstRun = claudeLog().at(-1)!;
    assert.equal(firstRun[firstRun.indexOf('--session-id') + 1], task.sessionId);

    assert.equal(notices.at(-1)?.title, 'PR ready · Nucleus · Add a hello file for order management');

    // Water Girl's own secrets are not passed down to agents.
    assert.equal(readFileSync(join(root, 'claude.log.env'), 'utf8').trim(), '[]');

    // Incremental polling only returns newer events.
    const lastId = detail.events.at(-1)!.id;
    assert.equal((await call<TaskDetail>('GET', `/api/tasks/${task.id}?after=${lastId}`)).events.length, 0);
  });

  it('asks you a question and resumes the same session when you answer', async () => {
    const [task] = (await call<Task[]>('GET', '/api/tasks')).filter((t) => t.prNumber === 1);
    await call('POST', `/api/tasks/${task.id}/messages`, { text: 'ASK me about refunds' });
    await app.runner.idle();

    const after = (await call<TaskDetail>('GET', `/api/tasks/${task.id}`)).task;
    assert.equal(after.status, 'needs_input');
    assert.equal(after.question, 'Should refunds support partial amounts?');
    assert.equal(after.prNumber, 1, 'keeps the same PR');

    const resumed = claudeLog().at(-1)!;
    assert.equal(resumed[resumed.indexOf('--resume') + 1], task.sessionId);
    assert.ok(!resumed.includes('--session-id'));
    assert.equal(notices.at(-1)?.title, 'Nucleus · Add a hello file for order management needs you');

    const overview = await call<Overview>('GET', '/api/overview');
    assert.match(overview.standup[0], /needs you: Should refunds support partial amounts\?/);
    assert.equal(overview.projects[0].counts.needs_input, 1);
  });

  it('shows PR status and merges it, cleaning up the worktree', async () => {
    const [task] = (await call<Task[]>('GET', '/api/tasks')).filter((t) => t.prNumber === 1);
    const pr = await call<PullRequestStatus>('GET', `/api/tasks/${task.id}/pr`);
    assert.deepEqual(pr.checks, { total: 2, passed: 1, failed: 0, pending: 1 });

    const worktree = join(root, 'data', 'worktrees', task.id);
    assert.ok(existsSync(worktree));
    const merged = await call<Task>('POST', `/api/tasks/${task.id}/merge`, {});
    assert.equal(merged.status, 'merged');
    assert.ok(!existsSync(worktree), 'worktree removed after merge');
    assert.deepEqual(gh.deletedBranches, [task.branch]);

    await call('POST', `/api/tasks/${task.id}/messages`, { text: 'more' }, 409);
  });

  it('commits work the agent forgot to commit', async () => {
    const task = await newTask('NOCOMMIT write a leftover');
    assert.equal(task.status, 'review');
    const detail = await call<TaskDetail>('GET', `/api/tasks/${task.id}`);
    assert.ok(detail.events.some((e) => e.text === 'Committed the changes the agent left uncommitted.'));
    assert.equal(git(bare, 'show', `${task.branch}:leftover.txt`), 'NOCOMMIT write a leftover');
  });

  it('finishes as done when nothing changed', async () => {
    const task = await newTask('NOTHING to do here');
    assert.equal(task.status, 'done');
    assert.equal(task.prNumber, null);
  });

  it('reports failures with the reason', async () => {
    const task = await newTask('FAIL please');
    assert.equal(task.status, 'failed');
    assert.match(task.error ?? '', /boom: something exploded/);
    assert.match(notices.at(-1)!.title, /^Stuck · /);
    const overview = await call<Overview>('GET', '/api/overview');
    assert.ok(overview.standup.some((l) => l.includes('got stuck: boom')));
  });

  it('stops a running agent, and runs at most maxParallel at once', async () => {
    const a = await call<Task>('POST', '/api/tasks', { repoId: repo.id, prompt: 'SLOW one' });
    const b = await call<Task>('POST', '/api/tasks', { repoId: repo.id, prompt: 'SLOW two' });
    const c = await call<Task>('POST', '/api/tasks', { repoId: repo.id, prompt: 'SLOW three' });
    const overview = await call<Overview>('GET', '/api/overview');
    assert.equal(overview.limits.running, 2);
    assert.equal(overview.limits.queued, 1);
    assert.equal(overview.tasks.find((t) => t.id === c.id)?.status, 'queued');

    await call('POST', `/api/tasks/${c.id}/stop`);
    assert.equal((await call<TaskDetail>('GET', `/api/tasks/${c.id}`)).task.status, 'stopped');

    // Wait until the agents are really running, then stop them.
    for (let i = 0; i < 100; i++) {
      const tasks = await call<Task[]>('GET', '/api/tasks');
      const ids = [a.id, b.id];
      const ready = await Promise.all(ids.map((id) => call<TaskDetail>('GET', `/api/tasks/${id}`)));
      if (ready.every((d) => d.events.some((e) => e.text === 'Taking my time…'))) break;
      void tasks;
      await new Promise((r) => setTimeout(r, 100));
    }
    await call('POST', `/api/tasks/${a.id}/stop`);
    await call('POST', `/api/tasks/${b.id}/stop`);
    await app.runner.idle();
    for (const id of [a.id, b.id]) {
      const t = (await call<TaskDetail>('GET', `/api/tasks/${id}`)).task;
      assert.equal(t.status, 'stopped');
      assert.equal(t.error, null);
    }
  });

  it('archives a task and frees its worktree', async () => {
    const [task] = (await call<Task[]>('GET', '/api/tasks')).filter((t) => t.status === 'done');
    const archived = await call<Task>('POST', `/api/tasks/${task.id}/archive`);
    assert.equal(archived.archived, true);
    assert.ok(!existsSync(join(root, 'data', 'worktrees', task.id)));
    assert.ok(!(await call<Task[]>('GET', '/api/tasks')).some((t) => t.id === task.id));
  });
});
