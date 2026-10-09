import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface GitIdentity {
  name: string;
  email: string;
}

/**
 * Git operations for one repo. Layout under the data dir:
 *   repos/<owner>/<name>/          main clone (never worked in directly)
 *   worktrees/<taskId>/            one worktree + branch per task
 *
 * The account token is passed per command as an HTTP header, so it is never
 * written into .git/config and the agent working in the worktree cannot push.
 */
export class RepoGit {
  readonly clonePath: string;
  readonly remoteUrl: string;
  private readonly token: string;
  private readonly identity: GitIdentity;

  constructor(opts: { dataDir: string; owner: string; name: string; remoteUrl: string; token: string; identity: GitIdentity }) {
    this.clonePath = join(opts.dataDir, 'repos', opts.owner, opts.name);
    this.remoteUrl = opts.remoteUrl;
    this.token = opts.token;
    this.identity = opts.identity;
  }

  static worktreePath(dataDir: string, taskId: string) {
    return join(dataDir, 'worktrees', taskId);
  }

  private authArgs(): string[] {
    if (!/^https?:\/\//.test(this.remoteUrl)) return [];
    const basic = Buffer.from(`x-access-token:${this.token}`).toString('base64');
    return ['-c', `http.extraHeader=Authorization: Basic ${basic}`];
  }

  async git(cwd: string, args: string[], opts: { auth?: boolean } = {}): Promise<string> {
    try {
      const { stdout } = await exec('git', [...(opts.auth ? this.authArgs() : []), ...args], {
        cwd,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      return stdout.trim();
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      // Never echo the auth header back in errors.
      const msg = (e.stderr || e.message).replace(/Authorization: Basic [A-Za-z0-9+/=]+/g, 'Authorization: ***');
      throw new Error(`git ${args[0]} failed: ${msg.trim()}`);
    }
  }

  /** Clone once, fetch every time after. */
  async ensureClone(): Promise<void> {
    if (!existsSync(join(this.clonePath, '.git'))) {
      mkdirSync(dirname(this.clonePath), { recursive: true });
      await this.git(dirname(this.clonePath), ['clone', '--no-checkout', this.remoteUrl, this.clonePath], { auth: true });
    } else {
      await this.git(this.clonePath, ['fetch', '--prune', 'origin'], { auth: true });
    }
    await this.git(this.clonePath, ['config', 'user.name', this.identity.name]);
    await this.git(this.clonePath, ['config', 'user.email', this.identity.email]);
  }

  async remoteBranchExists(branch: string): Promise<boolean> {
    try {
      await this.git(this.clonePath, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  /** Create the task's worktree on a fresh branch from base (or re-attach to its pushed branch). */
  async ensureWorktree(path: string, branch: string, base: string): Promise<void> {
    if (existsSync(join(path, '.git'))) return;
    await this.git(this.clonePath, ['worktree', 'prune']);
    mkdirSync(dirname(path), { recursive: true });
    const localExists = await this.git(this.clonePath, ['branch', '--list', branch]).then((s) => s.length > 0);
    if (localExists) {
      await this.git(this.clonePath, ['worktree', 'add', path, branch]);
    } else if (await this.remoteBranchExists(branch)) {
      await this.git(this.clonePath, ['worktree', 'add', '-b', branch, path, `origin/${branch}`]);
    } else {
      await this.git(this.clonePath, ['worktree', 'add', '-b', branch, path, `origin/${base}`]);
    }
  }

  /** Commit anything the agent left uncommitted. Returns true if a commit was made. */
  async commitAll(path: string, message: string): Promise<boolean> {
    await this.git(path, ['add', '-A']);
    const status = await this.git(path, ['status', '--porcelain']);
    if (!status) return false;
    await this.git(path, ['commit', '-m', message]);
    return true;
  }

  async commitsAhead(path: string, base: string): Promise<number> {
    return Number(await this.git(path, ['rev-list', '--count', `origin/${base}..HEAD`]));
  }

  async unpushedCommits(path: string, branch: string): Promise<number> {
    if (!(await this.remoteBranchExists(branch))) return Number.POSITIVE_INFINITY;
    return Number(await this.git(path, ['rev-list', '--count', `origin/${branch}..HEAD`]));
  }

  async push(path: string, branch: string): Promise<void> {
    await this.git(path, ['push', '-u', 'origin', `HEAD:refs/heads/${branch}`], { auth: true });
  }

  async lastCommitSubjects(path: string, base: string, max = 20): Promise<string[]> {
    const out = await this.git(path, ['log', '--format=%s', `-n${max}`, `origin/${base}..HEAD`]);
    return out ? out.split('\n') : [];
  }

  async removeWorktree(path: string, branch: string): Promise<void> {
    if (existsSync(path)) {
      try {
        await this.git(this.clonePath, ['worktree', 'remove', '--force', path]);
      } catch {
        rmSync(path, { recursive: true, force: true });
      }
    }
    if (existsSync(this.clonePath)) {
      await this.git(this.clonePath, ['worktree', 'prune']);
      await this.git(this.clonePath, ['branch', '-D', branch]).catch(() => undefined);
    }
  }
}
