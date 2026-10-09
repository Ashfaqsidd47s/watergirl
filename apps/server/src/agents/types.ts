import type { TaskEventKind } from '@watergirl/shared';

/** Something an agent did or said, already flattened for the timeline. */
export interface AgentEvent {
  kind: TaskEventKind;
  text: string;
}

export interface AgentResult {
  ok: boolean;
  /** The agent's final message for this run. */
  finalText: string | null;
  costUsd: number;
  error: string | null;
}

export interface AgentRunOptions {
  cwd: string;
  prompt: string;
  sessionId: string;
  /** Continue an earlier conversation instead of starting one. */
  resume: boolean;
  model: string | null;
  systemPrompt: string;
  onEvent: (e: AgentEvent) => void;
}

export interface RunningAgent {
  done: Promise<AgentResult>;
  stop(): void;
}

/**
 * One coding agent backend. Claude Code is the first; Codex, Gemini CLI, or a
 * cloud-hosted session can be added by implementing this interface.
 */
export interface AgentAdapter {
  readonly kind: string;
  start(opts: AgentRunOptions): RunningAgent;
}
