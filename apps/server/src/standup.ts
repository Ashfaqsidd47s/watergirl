import type { Store, TaskRecord } from './db.ts';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const firstLine = (s: string | null) => (s ?? '').split('\n').find((l) => l.trim())?.trim() ?? '';

/**
 * Plain-language status, the way a teammate would give it at standup.
 * Deterministic for now; an LLM-written version can replace it later.
 */
export function standup(store: Store, tasks: TaskRecord[]): string[] {
  const lines: string[] = [];
  const by = (s: TaskRecord['status']) => tasks.filter((t) => t.status === s);

  for (const t of by('needs_input')) {
    lines.push(`${t.projectName} · ${t.title} needs you: ${clip(t.question ?? 'has a question', 140)}`);
  }
  for (const t of by('failed')) {
    lines.push(`${t.projectName} · ${t.title} got stuck: ${clip(firstLine(t.error) || 'unknown error', 120)}`);
  }
  for (const t of by('working')) {
    const last = store.lastActivity(t.id);
    lines.push(`${t.projectName} · ${t.title} is in progress${last ? ` — ${clip(firstLine(last), 90)}` : ''}.`);
  }
  for (const t of by('review')) {
    lines.push(`${t.projectName} · ${t.title} has PR #${t.prNumber} waiting for your review.`);
  }
  const queued = by('queued').length;
  if (queued) lines.push(`${queued} task${queued === 1 ? ' is' : 's are'} waiting for a free agent.`);

  if (!lines.length) {
    lines.push(tasks.length ? 'Everything is wrapped up. What should we build next?' : 'All quiet. Tell me what to build and where.');
  }
  return lines;
}
