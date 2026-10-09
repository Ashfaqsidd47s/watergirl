// API contract between the Water Girl server and the mobile app.
// Type-only on purpose: both sides import with `import type`, so nothing here
// has to be bundled or built.

/**
 * Lifecycle of a task:
 *   queued → working → (needs_input | review | done | failed | stopped)
 *   needs_input / review / done / failed / stopped → working   (when you send a message)
 *   review → merged                                            (when the PR is merged)
 */
export type TaskStatus =
  | 'queued'
  | 'working'
  | 'needs_input'
  | 'review'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'merged';

export type AgentKind = 'claude-code';

export interface Account {
  id: string;
  label: string;
  login: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface Repo {
  id: string;
  projectId: string;
  accountId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  createdAt: string;
}

export interface Task {
  id: string;
  repoId: string;
  projectId: string;
  projectName: string;
  repoFullName: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  agent: AgentKind;
  model: string | null;
  branch: string;
  baseBranch: string;
  sessionId: string;
  /** Question the agent left for you when status is `needs_input`. */
  question: string | null;
  /** The agent's last final message. */
  summary: string | null;
  error: string | null;
  prNumber: number | null;
  prUrl: string | null;
  costUsd: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type TaskEventKind =
  | 'status' // lifecycle notes from Water Girl herself
  | 'user' // what you asked / replied
  | 'assistant' // what the agent said
  | 'tool' // what the agent did (edit file, run command, …)
  | 'result' // agent's final message for a run
  | 'git' // commits, pushes, PRs
  | 'error';

export interface TaskEvent {
  id: number;
  taskId: string;
  ts: string;
  kind: TaskEventKind;
  text: string;
}

export interface TaskDetail {
  task: Task;
  events: TaskEvent[];
}

export interface PullRequestStatus {
  number: number;
  url: string;
  state: 'open' | 'closed';
  merged: boolean;
  mergeable: boolean | null;
  mergeableState: string | null;
  checks: { total: number; passed: number; failed: number; pending: number };
}

export interface ProjectSummary extends Project {
  repos: Repo[];
  counts: Partial<Record<TaskStatus, number>>;
}

export interface Overview {
  /** Human, standup-style lines: "Nucleus — order management needs you: …" */
  standup: string[];
  projects: ProjectSummary[];
  /** Non-archived tasks, most recently updated first. */
  tasks: Task[];
  limits: { maxParallel: number; running: number; queued: number };
}

export interface GithubRepoOption {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

// ---- request bodies ----

export interface CreateAccountBody {
  label?: string;
  token: string;
}

export interface CreateProjectBody {
  name: string;
  color?: string;
}

export interface CreateRepoBody {
  projectId: string;
  accountId: string;
  fullName: string;
  /** Advanced: clone from somewhere other than github.com (used by tests). */
  cloneUrl?: string;
}

export interface CreateTaskBody {
  repoId: string;
  prompt: string;
  title?: string;
  baseBranch?: string;
  model?: string;
}

export interface SendMessageBody {
  text: string;
}

export interface MergeBody {
  method?: 'squash' | 'merge' | 'rebase';
}
