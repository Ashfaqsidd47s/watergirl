import type {
  Account,
  CreateRepoBody,
  CreateTaskBody,
  GithubRepoOption,
  Overview,
  Project,
  PullRequestStatus,
  Repo,
  Task,
  TaskDetail,
} from '@watergirl/shared';

export interface Connection {
  url: string;
  token: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function normalizeUrl(url: string) {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

export function createApi(conn: Connection) {
  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${conn.url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${conn.token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, `Can't reach Water Girl at ${conn.url}`);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
      throw new ApiError(res.status, msg);
    }
    return data as T;
  }

  return {
    health: () => req<{ ok: boolean }>('GET', '/api/health'),
    overview: () => req<Overview>('GET', '/api/overview'),

    accounts: () => req<Account[]>('GET', '/api/accounts'),
    addAccount: (token: string, label?: string) => req<Account>('POST', '/api/accounts', { token, label }),
    removeAccount: (id: string) => req('DELETE', `/api/accounts/${id}`),
    githubRepos: (accountId: string) => req<GithubRepoOption[]>('GET', `/api/accounts/${accountId}/github-repos`),

    projects: () => req<Project[]>('GET', '/api/projects'),
    addProject: (name: string) => req<Project>('POST', '/api/projects', { name }),
    removeProject: (id: string) => req('DELETE', `/api/projects/${id}`),

    repos: (projectId?: string) => req<Repo[]>('GET', `/api/repos${projectId ? `?projectId=${projectId}` : ''}`),
    addRepo: (body: CreateRepoBody) => req<Repo>('POST', '/api/repos', body),
    removeRepo: (id: string) => req('DELETE', `/api/repos/${id}`),

    tasks: (projectId?: string) => req<Task[]>('GET', `/api/tasks${projectId ? `?projectId=${projectId}` : ''}`),
    createTask: (body: CreateTaskBody) => req<Task>('POST', '/api/tasks', body),
    task: (id: string, after = 0) => req<TaskDetail>('GET', `/api/tasks/${id}?after=${after}`),
    send: (id: string, text: string) => req<Task>('POST', `/api/tasks/${id}/messages`, { text }),
    stop: (id: string) => req<Task>('POST', `/api/tasks/${id}/stop`),
    pr: (id: string) => req<PullRequestStatus | null>('GET', `/api/tasks/${id}/pr`),
    merge: (id: string) => req<Task>('POST', `/api/tasks/${id}/merge`, { method: 'squash' }),
    archive: (id: string) => req<Task>('POST', `/api/tasks/${id}/archive`),

    registerPush: (token: string) => req('POST', '/api/push-tokens', { token }),
  };
}

export type Api = ReturnType<typeof createApi>;
