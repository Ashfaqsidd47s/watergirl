import type { GithubRepoOption, PullRequestStatus } from '@watergirl/shared';

export class GithubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Minimal GitHub REST client — one instance per account token. */
export class Github {
  readonly apiUrl: string;
  readonly token: string;

  constructor(apiUrl: string, token: string) {
    this.apiUrl = apiUrl;
    this.token = token;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'watergirl',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new GithubError(res.status, `GitHub ${method} ${path} → ${res.status}: ${data?.message ?? text}`);
    return data as T;
  }

  me() {
    return this.req<{ login: string; id: number; avatar_url: string | null }>('GET', '/user');
  }

  async repo(owner: string, name: string): Promise<GithubRepoOption> {
    const r = await this.req<RawRepo>('GET', `/repos/${owner}/${name}`);
    return toOption(r);
  }

  async listRepos(): Promise<GithubRepoOption[]> {
    const out: GithubRepoOption[] = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await this.req<RawRepo[]>('GET', `/user/repos?per_page=100&sort=pushed&page=${page}`);
      out.push(...batch.map(toOption));
      if (batch.length < 100) break;
    }
    return out;
  }

  createPull(owner: string, name: string, p: { title: string; head: string; base: string; body: string }) {
    return this.req<{ number: number; html_url: string }>('POST', `/repos/${owner}/${name}/pulls`, p);
  }

  async findOpenPull(owner: string, name: string, branch: string): Promise<{ number: number; html_url: string } | null> {
    const list = await this.req<{ number: number; html_url: string }[]>(
      'GET',
      `/repos/${owner}/${name}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    );
    return list[0] ?? null;
  }

  async pullStatus(owner: string, name: string, number: number): Promise<PullRequestStatus> {
    const pr = await this.req<RawPull>('GET', `/repos/${owner}/${name}/pulls/${number}`);
    const checks = { total: 0, passed: 0, failed: 0, pending: 0 };
    try {
      const runs = await this.req<{ check_runs: { status: string; conclusion: string | null }[] }>(
        'GET',
        `/repos/${owner}/${name}/commits/${pr.head.sha}/check-runs?per_page=100`,
      );
      for (const run of runs.check_runs) {
        checks.total++;
        if (run.status !== 'completed') checks.pending++;
        else if (['success', 'neutral', 'skipped'].includes(run.conclusion ?? '')) checks.passed++;
        else checks.failed++;
      }
    } catch {
      // Checks are best-effort (fine-grained tokens may lack the permission).
    }
    return {
      number: pr.number,
      url: pr.html_url,
      state: pr.state,
      merged: pr.merged,
      mergeable: pr.mergeable,
      mergeableState: pr.mergeable_state ?? null,
      checks,
    };
  }

  merge(owner: string, name: string, number: number, method: 'squash' | 'merge' | 'rebase') {
    return this.req<{ merged: boolean; message: string }>('PUT', `/repos/${owner}/${name}/pulls/${number}/merge`, { merge_method: method });
  }

  deleteBranch(owner: string, name: string, branch: string) {
    return this.req<null>('DELETE', `/repos/${owner}/${name}/git/refs/heads/${branch}`);
  }
}

interface RawRepo {
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
}

interface RawPull {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  merged: boolean;
  mergeable: boolean | null;
  mergeable_state?: string;
  head: { sha: string };
}

function toOption(r: RawRepo): GithubRepoOption {
  return { owner: r.owner.login, name: r.name, fullName: r.full_name, defaultBranch: r.default_branch, private: r.private };
}
