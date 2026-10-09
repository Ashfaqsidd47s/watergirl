import { DatabaseSync } from 'node:sqlite';
import type {
  Account,
  Project,
  Repo,
  Task,
  TaskEvent,
  TaskEventKind,
  TaskStatus,
} from '@watergirl/shared';
import { shortId } from './crypto.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  login TEXT NOT NULL,
  github_id INTEGER NOT NULL,
  avatar_url TEXT,
  token_enc TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  clone_url TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT,
  branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  session_id TEXT NOT NULL,
  has_run INTEGER NOT NULL DEFAULT 0,
  question TEXT,
  summary TEXT,
  error TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_task ON events(task_id, id);
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
`;

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();

const PROJECT_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#fb7185', '#2dd4bf', '#818cf8'];

export interface AccountRecord extends Account {
  githubId: number;
  tokenEnc: string;
}

export interface RepoRecord extends Repo {
  cloneUrl: string | null;
}

export interface TaskRecord extends Task {
  hasRun: boolean;
}

function toAccount(r: Row): AccountRecord {
  return {
    id: r.id as string,
    label: r.label as string,
    login: r.login as string,
    githubId: r.github_id as number,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    tokenEnc: r.token_enc as string,
    createdAt: r.created_at as string,
  };
}

function toProject(r: Row): Project {
  return { id: r.id as string, name: r.name as string, color: r.color as string, createdAt: r.created_at as string };
}

function toRepo(r: Row): RepoRecord {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    accountId: r.account_id as string,
    owner: r.owner as string,
    name: r.name as string,
    fullName: `${r.owner}/${r.name}`,
    defaultBranch: r.default_branch as string,
    cloneUrl: (r.clone_url as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

function toTask(r: Row): TaskRecord {
  return {
    id: r.id as string,
    repoId: r.repo_id as string,
    projectId: r.project_id as string,
    projectName: r.project_name as string,
    repoFullName: `${r.owner}/${r.repo_name}`,
    title: r.title as string,
    prompt: r.prompt as string,
    status: r.status as TaskStatus,
    agent: r.agent as Task['agent'],
    model: (r.model as string | null) ?? null,
    branch: r.branch as string,
    baseBranch: r.base_branch as string,
    sessionId: r.session_id as string,
    hasRun: Boolean(r.has_run),
    question: (r.question as string | null) ?? null,
    summary: (r.summary as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    prNumber: (r.pr_number as number | null) ?? null,
    prUrl: (r.pr_url as string | null) ?? null,
    costUsd: (r.cost_usd as number) ?? 0,
    archived: Boolean(r.archived),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

const TASK_SELECT = `
SELECT t.*, r.owner, r.name AS repo_name, r.project_id, p.name AS project_name
FROM tasks t JOIN repos r ON r.id = t.repo_id JOIN projects p ON p.id = r.project_id`;

/** Strip internal fields before sending a task to the app. */
export function publicTask(t: TaskRecord): Task {
  const { hasRun: _hasRun, ...rest } = t;
  return rest;
}

export function publicAccount(a: AccountRecord): Account {
  const { githubId: _id, tokenEnc: _tok, ...rest } = a;
  return rest;
}

export function publicRepo(r: RepoRecord): Repo {
  const { cloneUrl: _c, ...rest } = r;
  return rest;
}

export type TaskPatch = Partial<{
  status: TaskStatus;
  hasRun: boolean;
  question: string | null;
  summary: string | null;
  error: string | null;
  prNumber: number | null;
  prUrl: string | null;
  costUsd: number;
  archived: boolean;
}>;

const PATCH_COLUMNS: Record<keyof TaskPatch, string> = {
  status: 'status',
  hasRun: 'has_run',
  question: 'question',
  summary: 'summary',
  error: 'error',
  prNumber: 'pr_number',
  prUrl: 'pr_url',
  costUsd: 'cost_usd',
  archived: 'archived',
};

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  // ---- accounts ----

  createAccount(a: { label: string; login: string; githubId: number; avatarUrl: string | null; tokenEnc: string }): AccountRecord {
    const id = shortId('acc');
    this.db
      .prepare('INSERT INTO accounts (id, label, login, github_id, avatar_url, token_enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, a.label, a.login, a.githubId, a.avatarUrl, a.tokenEnc, now());
    return this.getAccount(id)!;
  }

  getAccount(id: string): AccountRecord | undefined {
    const r = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    return r ? toAccount(r) : undefined;
  }

  listAccounts(): AccountRecord[] {
    return this.db.prepare('SELECT * FROM accounts ORDER BY created_at').all().map(toAccount);
  }

  deleteAccount(id: string): boolean {
    const used = this.db.prepare('SELECT COUNT(*) AS n FROM repos WHERE account_id = ?').get(id) as { n: number };
    if (used.n > 0) throw new Error('Account still has repos linked to it; remove them first');
    return this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes > 0;
  }

  // ---- projects ----

  createProject(name: string, color?: string): Project {
    const id = shortId('prj');
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n;
    this.db
      .prepare('INSERT INTO projects (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, color ?? PROJECT_COLORS[count % PROJECT_COLORS.length], now());
    return this.getProject(id)!;
  }

  getProject(id: string): Project | undefined {
    const r = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return r ? toProject(r) : undefined;
  }

  listProjects(): Project[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE').all().map(toProject);
  }

  deleteProject(id: string): boolean {
    return this.db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
  }

  // ---- repos ----

  createRepo(r: { projectId: string; accountId: string; owner: string; name: string; defaultBranch: string; cloneUrl?: string | null }): RepoRecord {
    const id = shortId('rep');
    this.db
      .prepare('INSERT INTO repos (id, project_id, account_id, owner, name, default_branch, clone_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, r.projectId, r.accountId, r.owner, r.name, r.defaultBranch, r.cloneUrl ?? null, now());
    return this.getRepo(id)!;
  }

  getRepo(id: string): RepoRecord | undefined {
    const r = this.db.prepare('SELECT * FROM repos WHERE id = ?').get(id);
    return r ? toRepo(r) : undefined;
  }

  listRepos(projectId?: string): RepoRecord[] {
    const rows = projectId
      ? this.db.prepare('SELECT * FROM repos WHERE project_id = ? ORDER BY owner, name').all(projectId)
      : this.db.prepare('SELECT * FROM repos ORDER BY owner, name').all();
    return rows.map(toRepo);
  }

  deleteRepo(id: string): boolean {
    return this.db.prepare('DELETE FROM repos WHERE id = ?').run(id).changes > 0;
  }

  // ---- tasks ----

  createTask(t: {
    repoId: string;
    title: string;
    prompt: string;
    agent: Task['agent'];
    model: string | null;
    branch: string;
    baseBranch: string;
    sessionId: string;
  }): TaskRecord {
    const id = shortId('tsk');
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO tasks (id, repo_id, title, prompt, status, agent, model, branch, base_branch, session_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, t.repoId, t.title, t.prompt, t.agent, t.model, t.branch, t.baseBranch, t.sessionId, ts, ts);
    return this.getTask(id)!;
  }

  getTask(id: string): TaskRecord | undefined {
    const r = this.db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id);
    return r ? toTask(r) : undefined;
  }

  listTasks(opts: { includeArchived?: boolean; projectId?: string; status?: TaskStatus[] } = {}): TaskRecord[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (!opts.includeArchived) where.push('t.archived = 0');
    if (opts.projectId) {
      where.push('r.project_id = ?');
      args.push(opts.projectId);
    }
    if (opts.status?.length) {
      where.push(`t.status IN (${opts.status.map(() => '?').join(',')})`);
      args.push(...opts.status);
    }
    const sql = `${TASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.updated_at DESC`;
    return this.db.prepare(sql).all(...args).map(toTask);
  }

  updateTask(id: string, patch: TaskPatch): TaskRecord {
    const sets: string[] = [];
    const args: (string | number | null)[] = [];
    for (const [key, value] of Object.entries(patch) as [keyof TaskPatch, unknown][]) {
      if (value === undefined) continue;
      sets.push(`${PATCH_COLUMNS[key]} = ?`);
      args.push(typeof value === 'boolean' ? Number(value) : (value as string | number | null));
    }
    sets.push('updated_at = ?');
    args.push(now(), id);
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    return this.getTask(id)!;
  }

  // ---- events ----

  addEvent(taskId: string, kind: TaskEventKind, text: string): TaskEvent {
    const ts = now();
    const res = this.db.prepare('INSERT INTO events (task_id, ts, kind, text) VALUES (?, ?, ?, ?)').run(taskId, ts, kind, text);
    this.db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(ts, taskId);
    return { id: Number(res.lastInsertRowid), taskId, ts, kind, text };
  }

  listEvents(taskId: string, afterId = 0, limit = 500): TaskEvent[] {
    return this.db
      .prepare('SELECT * FROM events WHERE task_id = ? AND id > ? ORDER BY id LIMIT ?')
      .all(taskId, afterId, limit)
      .map((r) => ({ id: r.id as number, taskId: r.task_id as string, ts: r.ts as string, kind: r.kind as TaskEventKind, text: r.text as string }));
  }

  /** Latest thing the agent said or did, for one-line status. */
  lastActivity(taskId: string): string | null {
    const r = this.db
      .prepare("SELECT text FROM events WHERE task_id = ? AND kind IN ('tool', 'assistant') ORDER BY id DESC LIMIT 1")
      .get(taskId);
    return r ? (r.text as string) : null;
  }

  // ---- push tokens ----

  addPushToken(token: string) {
    this.db.prepare('INSERT OR IGNORE INTO push_tokens (token, created_at) VALUES (?, ?)').run(token, now());
  }

  removePushToken(token: string) {
    this.db.prepare('DELETE FROM push_tokens WHERE token = ?').run(token);
  }

  listPushTokens(): string[] {
    return this.db.prepare('SELECT token FROM push_tokens').all().map((r) => r.token as string);
  }
}
