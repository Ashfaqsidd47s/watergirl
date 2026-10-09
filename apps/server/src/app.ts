import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type {
  CreateAccountBody,
  CreateProjectBody,
  CreateRepoBody,
  CreateTaskBody,
  MergeBody,
  Overview,
  ProjectSummary,
  SendMessageBody,
  TaskDetail,
  TaskStatus,
} from '@watergirl/shared';
import { ClaudeCodeAdapter } from './agents/claude-code.ts';
import type { AgentAdapter } from './agents/types.ts';
import type { Config } from './config.ts';
import { decrypt, encrypt, safeEqual } from './crypto.ts';
import { publicAccount, publicRepo, publicTask, Store } from './db.ts';
import { Github, GithubError } from './github.ts';
import { createNotifier, type Notifier } from './notify.ts';
import { HttpError, Runner } from './runner.ts';
import { standup } from './standup.ts';
import { join } from 'node:path';

export interface AppOptions {
  config: Config;
  adapters?: Record<string, AgentAdapter>;
  notify?: Notifier;
  logger?: boolean;
}

export interface App {
  server: FastifyInstance;
  store: Store;
  runner: Runner;
}

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'task'
  );
}

function titleFrom(prompt: string) {
  const line = prompt.split('\n').find((l) => l.trim())?.trim() ?? 'New task';
  return line.length > 70 ? line.slice(0, 69) + '…' : line;
}

function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `"${field}" is required`);
  return v.trim();
}

export function buildApp(opts: AppOptions): App {
  const { config } = opts;
  const server = Fastify({ logger: opts.logger ?? false });
  const store = new Store(join(config.dataDir, 'watergirl.db'));
  const log = (msg: string) => server.log.warn(msg);
  const runner = new Runner({
    config,
    store,
    adapters: opts.adapters ?? {
      'claude-code': new ClaudeCodeAdapter({ bin: config.claudeBin, permissionMode: config.permissionMode }),
    },
    notify: opts.notify ?? createNotifier(config, store, log),
    log,
  });

  void server.register(cors, { origin: true });

  server.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    if (err instanceof GithubError) return reply.status(err.status === 401 ? 400 : 502).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) server.log.error(err);
    return reply.status(status).send({ error: (err as Error).message });
  });

  server.addHook('onRequest', async (req) => {
    if (req.url === '/api/health' || req.method === 'OPTIONS') return;
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !safeEqual(token, config.apiToken)) throw new HttpError(401, 'Wrong or missing Water Girl token');
  });

  server.addHook('onClose', async () => store.close());

  server.get('/api/health', async () => ({ ok: true, name: 'Water Girl' }));

  // ---- overview / standup ----

  server.get('/api/overview', async (): Promise<Overview> => {
    const tasks = store.listTasks();
    const projects: ProjectSummary[] = store.listProjects().map((p) => {
      const counts: Partial<Record<TaskStatus, number>> = {};
      for (const t of tasks) if (t.projectId === p.id) counts[t.status] = (counts[t.status] ?? 0) + 1;
      return { ...p, repos: store.listRepos(p.id).map(publicRepo), counts };
    });
    return {
      standup: standup(store, tasks),
      projects,
      tasks: tasks.map(publicTask),
      limits: { maxParallel: config.maxParallel, running: runner.runningCount, queued: runner.queuedCount },
    };
  });

  // ---- GitHub accounts ----

  server.get('/api/accounts', async () => store.listAccounts().map(publicAccount));

  server.post<{ Body: CreateAccountBody }>('/api/accounts', async (req) => {
    const token = requireString(req.body?.token, 'token');
    const me = await new Github(config.githubApiUrl, token).me();
    const existing = store.listAccounts().find((a) => a.githubId === me.id);
    if (existing) throw new HttpError(409, `${me.login} is already connected`);
    const acc = store.createAccount({
      label: req.body.label?.trim() || me.login,
      login: me.login,
      githubId: me.id,
      avatarUrl: me.avatar_url,
      tokenEnc: encrypt(token, config.secretKey),
    });
    return publicAccount(acc);
  });

  server.delete<{ Params: { id: string } }>('/api/accounts/:id', async (req) => {
    try {
      if (!store.deleteAccount(req.params.id)) throw new HttpError(404, 'Account not found');
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(409, (e as Error).message);
    }
    return { ok: true };
  });

  server.get<{ Params: { id: string } }>('/api/accounts/:id/github-repos', async (req) => {
    const acc = store.getAccount(req.params.id);
    if (!acc) throw new HttpError(404, 'Account not found');
    return new Github(config.githubApiUrl, decrypt(acc.tokenEnc, config.secretKey)).listRepos();
  });

  // ---- projects ----

  server.get('/api/projects', async () => store.listProjects());

  server.post<{ Body: CreateProjectBody }>('/api/projects', async (req) => {
    return store.createProject(requireString(req.body?.name, 'name'), req.body.color);
  });

  server.delete<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const busy = store.listTasks({ projectId: req.params.id }).some((t) => runner.isBusy(t.id));
    if (busy) throw new HttpError(409, 'Agents are still running in this project');
    if (!store.deleteProject(req.params.id)) throw new HttpError(404, 'Project not found');
    return { ok: true };
  });

  // ---- repos ----

  server.get<{ Querystring: { projectId?: string } }>('/api/repos', async (req) => store.listRepos(req.query.projectId).map(publicRepo));

  server.post<{ Body: CreateRepoBody }>('/api/repos', async (req) => {
    const projectId = requireString(req.body?.projectId, 'projectId');
    const accountId = requireString(req.body?.accountId, 'accountId');
    const fullName = requireString(req.body?.fullName, 'fullName');
    const [owner, name] = fullName.split('/');
    if (!owner || !name) throw new HttpError(400, 'fullName must look like "owner/repo"');
    if (!store.getProject(projectId)) throw new HttpError(404, 'Project not found');
    const acc = store.getAccount(accountId);
    if (!acc) throw new HttpError(404, 'Account not found');
    if (store.listRepos(projectId).some((r) => r.fullName.toLowerCase() === fullName.toLowerCase())) {
      throw new HttpError(409, `${fullName} is already in this project`);
    }
    const info = await new Github(config.githubApiUrl, decrypt(acc.tokenEnc, config.secretKey)).repo(owner, name);
    return publicRepo(
      store.createRepo({ projectId, accountId, owner: info.owner, name: info.name, defaultBranch: info.defaultBranch, cloneUrl: req.body.cloneUrl }),
    );
  });

  server.delete<{ Params: { id: string } }>('/api/repos/:id', async (req) => {
    const busy = store.listTasks({ includeArchived: true }).some((t) => t.repoId === req.params.id && runner.isBusy(t.id));
    if (busy) throw new HttpError(409, 'Agents are still running on this repo');
    if (!store.deleteRepo(req.params.id)) throw new HttpError(404, 'Repo not found');
    return { ok: true };
  });

  // ---- tasks ----

  server.get<{ Querystring: { projectId?: string; archived?: string } }>('/api/tasks', async (req) =>
    store.listTasks({ projectId: req.query.projectId, includeArchived: req.query.archived === '1' }).map(publicTask),
  );

  server.post<{ Body: CreateTaskBody }>('/api/tasks', async (req) => {
    const repo = store.getRepo(requireString(req.body?.repoId, 'repoId'));
    if (!repo) throw new HttpError(404, 'Repo not found');
    const prompt = requireString(req.body.prompt, 'prompt');
    const title = req.body.title?.trim() || titleFrom(prompt);
    const sessionId = randomUUID();
    const task = store.createTask({
      repoId: repo.id,
      title,
      prompt,
      agent: 'claude-code',
      model: req.body.model?.trim() || config.defaultModel,
      branch: `wg/${slug(title)}-${sessionId.slice(0, 6)}`,
      baseBranch: req.body.baseBranch?.trim() || repo.defaultBranch,
      sessionId,
    });
    runner.start(task);
    return publicTask(store.getTask(task.id)!);
  });

  server.get<{ Params: { id: string }; Querystring: { after?: string } }>('/api/tasks/:id', async (req): Promise<TaskDetail> => {
    const task = store.getTask(req.params.id);
    if (!task) throw new HttpError(404, 'Task not found');
    return { task: publicTask(task), events: store.listEvents(task.id, Number(req.query.after ?? 0)) };
  });

  server.post<{ Params: { id: string }; Body: SendMessageBody }>('/api/tasks/:id/messages', async (req) => {
    runner.send(req.params.id, requireString(req.body?.text, 'text'));
    return publicTask(store.getTask(req.params.id)!);
  });

  server.post<{ Params: { id: string } }>('/api/tasks/:id/stop', async (req) => {
    runner.stop(req.params.id);
    return publicTask(store.getTask(req.params.id)!);
  });

  server.get<{ Params: { id: string } }>('/api/tasks/:id/pr', async (req) => runner.prStatus(req.params.id));

  server.post<{ Params: { id: string }; Body: MergeBody }>('/api/tasks/:id/merge', async (req) =>
    publicTask(await runner.merge(req.params.id, req.body?.method)),
  );

  server.post<{ Params: { id: string } }>('/api/tasks/:id/archive', async (req) => publicTask(await runner.archive(req.params.id)));

  // ---- push notifications ----

  server.post<{ Body: { token: string } }>('/api/push-tokens', async (req) => {
    store.addPushToken(requireString(req.body?.token, 'token'));
    return { ok: true };
  });

  return { server, store, runner };
}
