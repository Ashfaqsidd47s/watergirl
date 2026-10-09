import type { TaskStatus } from '@watergirl/shared';
import type { AgentAdapter, AgentResult, RunningAgent } from './agents/types.ts';
import type { Config } from './config.ts';
import { decrypt } from './crypto.ts';
import type { AccountRecord, RepoRecord, Store, TaskRecord } from './db.ts';
import { RepoGit } from './git.ts';
import { Github } from './github.ts';
import type { Notifier } from './notify.ts';

export class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function agentSystemPrompt(task: TaskRecord): string {
  return [
    'You are a coding agent dispatched by Water Girl, the owner\'s personal engineering assistant.',
    `You are in a dedicated git worktree for ${task.repoFullName} on branch "${task.branch}" (based on "${task.baseBranch}"). Work only inside it.`,
    'Commit your work with clear messages as you go. Do NOT push and do NOT open pull requests: Water Girl pushes the branch and opens the PR when you finish.',
    'Nobody is watching live. Prefer sensible assumptions over stopping, and mention them in your summary.',
    'If you are truly blocked on a decision only the owner can make, stop and make the last line of your final message: "QUESTION: <one clear question>".',
    'Finish with a short plain-language summary: what you changed, how you checked it, and anything left to do.',
  ].join('\n');
}

const QUESTION_RE = /^\s*\**QUESTION:?\**:?\s*(.+)$/gim;

export function extractQuestion(text: string | null): string | null {
  if (!text) return null;
  const matches = [...text.matchAll(QUESTION_RE)];
  return matches.length ? matches[matches.length - 1][1].trim() : null;
}

interface Job {
  taskId: string;
  prompt: string;
}

interface TaskContext {
  task: TaskRecord;
  repo: RepoRecord;
  account: AccountRecord;
  gh: Github;
  git: RepoGit;
  worktree: string;
}

export interface RunnerDeps {
  config: Config;
  store: Store;
  adapters: Record<string, AgentAdapter>;
  notify: Notifier;
  log: (msg: string) => void;
}

/**
 * The worker: a small in-process queue that runs up to `maxParallel` agents,
 * each in its own worktree, and turns their output into task events.
 */
export class Runner {
  private readonly deps: RunnerDeps;
  private queue: Job[] = [];
  /** taskId → running agent (null while the workspace is being prepared). */
  private active = new Map<string, RunningAgent | null>();
  private stopRequested = new Set<string>();
  private idleWaiters: (() => void)[] = [];

  constructor(deps: RunnerDeps) {
    this.deps = deps;
  }

  get runningCount() {
    return this.active.size;
  }

  get queuedCount() {
    return this.queue.length;
  }

  isBusy(taskId: string) {
    return this.active.has(taskId) || this.queue.some((j) => j.taskId === taskId);
  }

  /** Resolves when nothing is running or queued (used by tests). */
  idle(): Promise<void> {
    if (!this.active.size && !this.queue.length) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  /** On boot: nothing can still be running, so settle what the last process left behind. */
  recover() {
    const { store } = this.deps;
    for (const t of store.listTasks({ status: ['working', 'queued'] })) {
      if (t.status === 'queued' && !t.hasRun) {
        this.queue.push({ taskId: t.id, prompt: t.prompt });
      } else {
        store.updateTask(t.id, { status: 'stopped' });
        store.addEvent(t.id, 'status', 'Water Girl restarted while this was running. Send a message to pick it back up.');
      }
    }
    this.pump();
  }

  start(task: TaskRecord) {
    this.deps.store.addEvent(task.id, 'user', task.prompt);
    this.enqueue({ taskId: task.id, prompt: task.prompt });
  }

  /** Reply to / steer an agent. Delivered right away, or after its current run if it's busy. */
  send(taskId: string, text: string) {
    const { store } = this.deps;
    const task = this.mustTask(taskId);
    if (task.status === 'merged') throw new HttpError(409, 'This task is merged; start a new task instead.');
    store.addEvent(taskId, 'user', text);
    if (task.archived) store.updateTask(taskId, { archived: false });
    if (this.active.has(taskId)) {
      store.addEvent(taskId, 'status', 'Got it — I\'ll pass this on as soon as the agent finishes its current step.');
    }
    this.enqueue({ taskId, prompt: text });
  }

  stop(taskId: string) {
    const { store } = this.deps;
    this.mustTask(taskId);
    const hadQueued = this.queue.some((j) => j.taskId === taskId);
    this.queue = this.queue.filter((j) => j.taskId !== taskId);
    if (this.active.has(taskId)) {
      this.stopRequested.add(taskId);
      this.active.get(taskId)?.stop();
      store.addEvent(taskId, 'status', 'Stopping…');
    } else if (hadQueued) {
      store.updateTask(taskId, { status: 'stopped' });
      store.addEvent(taskId, 'status', 'Stopped before it started.');
    }
  }

  async merge(taskId: string, method: 'squash' | 'merge' | 'rebase' = 'squash') {
    const ctx = this.context(taskId);
    const { task, repo, gh } = ctx;
    if (!task.prNumber) throw new HttpError(409, 'There is no pull request to merge yet.');
    if (this.isBusy(taskId)) throw new HttpError(409, 'The agent is still working on this; stop it or wait first.');
    const res = await gh.merge(repo.owner, repo.name, task.prNumber, method);
    if (!res.merged) throw new HttpError(409, res.message || 'GitHub refused the merge.');
    await this.markMerged(ctx);
    return this.mustTask(taskId);
  }

  async prStatus(taskId: string) {
    const ctx = this.context(taskId);
    const { task, repo, gh } = ctx;
    if (!task.prNumber) return null;
    const status = await gh.pullStatus(repo.owner, repo.name, task.prNumber);
    if (status.merged && task.status !== 'merged' && !this.isBusy(taskId)) await this.markMerged(ctx);
    return status;
  }

  /** Hide from the board and free the worktree (the pushed branch / PR stay on GitHub). */
  async archive(taskId: string) {
    const ctx = this.context(taskId);
    if (this.isBusy(taskId)) this.stop(taskId);
    await this.waitUntilFree(taskId);
    await ctx.git.removeWorktree(ctx.worktree, ctx.task.branch).catch(() => undefined);
    return this.deps.store.updateTask(taskId, { archived: true });
  }

  // ---- internals ----

  private mustTask(taskId: string): TaskRecord {
    const t = this.deps.store.getTask(taskId);
    if (!t) throw new HttpError(404, 'Task not found');
    return t;
  }

  private context(taskId: string): TaskContext {
    const { store, config } = this.deps;
    const task = this.mustTask(taskId);
    const repo = store.getRepo(task.repoId);
    const account = repo && store.getAccount(repo.accountId);
    if (!repo || !account) throw new HttpError(409, 'Repo or GitHub account for this task was removed.');
    const token = decrypt(account.tokenEnc, config.secretKey);
    const git = new RepoGit({
      dataDir: config.dataDir,
      owner: repo.owner,
      name: repo.name,
      remoteUrl: repo.cloneUrl ?? `${config.githubWebUrl}/${repo.owner}/${repo.name}.git`,
      token,
      identity: { name: account.login, email: `${account.githubId}+${account.login}@users.noreply.github.com` },
    });
    return { task, repo, account, gh: new Github(config.githubApiUrl, token), git, worktree: RepoGit.worktreePath(config.dataDir, task.id) };
  }

  private async waitUntilFree(taskId: string) {
    while (this.isBusy(taskId)) await new Promise((r) => setTimeout(r, 100));
  }

  private enqueue(job: Job) {
    const { store } = this.deps;
    this.queue.push(job);
    if (!this.active.has(job.taskId)) store.updateTask(job.taskId, { status: 'queued' });
    this.pump();
  }

  private pump() {
    while (this.active.size < this.deps.config.maxParallel) {
      const idx = this.queue.findIndex((j) => !this.active.has(j.taskId));
      if (idx === -1) break;
      const [job] = this.queue.splice(idx, 1);
      this.active.set(job.taskId, null);
      void this.run(job).finally(() => {
        this.active.delete(job.taskId);
        this.stopRequested.delete(job.taskId);
        this.pump();
        if (!this.active.size && !this.queue.length) this.idleWaiters.splice(0).forEach((r) => r());
      });
    }
  }

  private async run(job: Job) {
    const { store, adapters, notify, log } = this.deps;
    const id = job.taskId;
    let ctx: TaskContext;
    try {
      ctx = this.context(id);
    } catch (err) {
      store.updateTask(id, { status: 'failed', error: (err as Error).message });
      return;
    }
    const { task, git, worktree } = ctx;

    store.updateTask(id, { status: 'working', question: null, error: null });
    store.addEvent(id, 'status', task.hasRun ? 'Passing your message to the agent.' : 'Setting up a fresh workspace.');

    let result: AgentResult;
    try {
      await git.ensureClone();
      await git.ensureWorktree(worktree, task.branch, task.baseBranch);
      if (this.stopRequested.has(id)) {
        result = { ok: false, finalText: null, costUsd: 0, error: 'Stopped' };
      } else {
        const adapter = adapters[task.agent];
        if (!adapter) throw new Error(`No adapter for agent "${task.agent}"`);
        let sawEvent = false;
        const agent = adapter.start({
          cwd: worktree,
          prompt: job.prompt,
          sessionId: task.sessionId,
          resume: task.hasRun,
          model: task.model,
          systemPrompt: agentSystemPrompt(task),
          onEvent: (e) => {
            if (!sawEvent) {
              sawEvent = true;
              // The session now exists on disk, so later messages must resume it.
              if (!task.hasRun) store.updateTask(id, { hasRun: true });
            }
            store.addEvent(id, e.kind, e.text);
          },
        });
        this.active.set(id, agent);
        if (this.stopRequested.has(id)) agent.stop();
        result = await agent.done;
      }
    } catch (err) {
      result = { ok: false, finalText: null, costUsd: 0, error: (err as Error).message };
    }

    const fresh = this.mustTask(id);
    if (result.finalText) store.addEvent(id, 'result', result.finalText);
    const question = result.ok ? extractQuestion(result.finalText) : null;

    // Save whatever the agent produced — even a failed or stopped run may have useful commits.
    let publishError: string | null = null;
    try {
      await this.publish({ ...ctx, task: fresh }, result.finalText);
    } catch (err) {
      publishError = (err as Error).message;
      store.addEvent(id, 'error', `Couldn't push / open the PR: ${publishError}`);
      log(`publish ${id}: ${publishError}`);
    }

    const after = this.mustTask(id);
    let status: TaskStatus;
    const stopped = this.stopRequested.has(id);
    if (stopped) status = 'stopped';
    else if (!result.ok) status = 'failed';
    else if (question) status = 'needs_input';
    else if (publishError) status = 'failed';
    else if (after.prNumber) status = 'review';
    else status = 'done';

    const error = stopped ? null : (result.error ?? publishError);
    store.updateTask(id, {
      status,
      question,
      error,
      summary: result.finalText ?? after.summary,
      costUsd: after.costUsd + result.costUsd,
    });
    if (stopped) store.addEvent(id, 'status', 'Stopped.');
    else if (error) store.addEvent(id, 'error', error);

    const label = `${after.projectName} · ${after.title}`;
    const firstLine = (s: string | null) => (s ?? '').split('\n').find((l) => l.trim())?.slice(0, 180) ?? '';
    if (status === 'needs_input') await notify({ title: `${label} needs you`, body: question!, taskId: id });
    else if (status === 'review') await notify({ title: `PR ready · ${label}`, body: `#${after.prNumber} — ${firstLine(result.finalText)}`, taskId: id });
    else if (status === 'done') await notify({ title: `Done · ${label}`, body: firstLine(result.finalText) || 'Finished with no code changes.', taskId: id });
    else if (status === 'failed') await notify({ title: `Stuck · ${label}`, body: firstLine(error), taskId: id });
  }

  /** Commit leftovers, push the branch, open the PR if there isn't one. */
  private async publish(ctx: TaskContext, finalText: string | null) {
    const { store } = this.deps;
    const { task, repo, gh, git, worktree } = ctx;
    if (await git.commitAll(worktree, `${task.title}\n\nUncommitted work saved by Water Girl.`)) {
      store.addEvent(task.id, 'git', 'Committed the changes the agent left uncommitted.');
    }
    const ahead = await git.commitsAhead(worktree, task.baseBranch);
    if (ahead === 0) return;

    const unpushed = await git.unpushedCommits(worktree, task.branch);
    if (unpushed > 0) {
      await git.push(worktree, task.branch);
      const n = Number.isFinite(unpushed) ? unpushed : ahead;
      store.addEvent(task.id, 'git', `Pushed ${n} commit${n === 1 ? '' : 's'} to ${task.branch}.`);
    }

    if (!task.prNumber) {
      const commits = await git.lastCommitSubjects(worktree, task.baseBranch);
      const summary = (finalText ?? '').replace(QUESTION_RE, '').trim();
      const body = [
        summary || '_No summary from the agent._',
        '',
        '<details><summary>Original request</summary>',
        '',
        task.prompt,
        '',
        '</details>',
        '',
        '**Commits**',
        ...commits.map((c) => `- ${c}`),
        '',
        '---',
        '_Opened by Water Girl._',
      ].join('\n');
      const pr =
        (await gh.findOpenPull(repo.owner, repo.name, task.branch)) ??
        (await gh.createPull(repo.owner, repo.name, { title: task.title, head: task.branch, base: task.baseBranch, body }));
      store.updateTask(task.id, { prNumber: pr.number, prUrl: pr.html_url });
      store.addEvent(task.id, 'git', `Opened PR #${pr.number}.`);
    }
  }

  private async markMerged(ctx: TaskContext) {
    const { store, log } = this.deps;
    const { task, repo, gh, git, worktree } = ctx;
    store.updateTask(task.id, { status: 'merged', question: null });
    store.addEvent(task.id, 'git', `PR #${task.prNumber} merged. Cleaned up the workspace.`);
    await git.removeWorktree(worktree, task.branch).catch((e) => log(`cleanup ${task.id}: ${e.message}`));
    await gh.deleteBranch(repo.owner, repo.name, task.branch).catch(() => undefined);
  }
}
