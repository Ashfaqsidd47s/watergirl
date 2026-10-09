import { spawn } from 'node:child_process';
import { relative } from 'node:path';
import { createInterface } from 'node:readline';
import type { AgentAdapter, AgentEvent, AgentResult, AgentRunOptions, RunningAgent } from './types.ts';

/**
 * Runs the Claude Code CLI headless:
 *   claude -p <prompt> --output-format stream-json --verbose --session-id <uuid>
 * and on follow-ups `--resume <uuid>`, so every message you send from the app
 * lands in the same conversation.
 *
 * Auth comes from the CLI itself: either a logged-in Claude subscription
 * (`claude setup-token` → CLAUDE_CODE_OAUTH_TOKEN) or ANTHROPIC_API_KEY.
 */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly kind = 'claude-code';
  private readonly bin: string;
  private readonly permissionMode: string;

  constructor(opts: { bin: string; permissionMode: string }) {
    this.bin = opts.bin;
    this.permissionMode = opts.permissionMode;
  }

  buildArgs(opts: AgentRunOptions): string[] {
    return [
      '-p',
      opts.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      this.permissionMode,
      '--append-system-prompt',
      opts.systemPrompt,
      ...(opts.resume ? ['--resume', opts.sessionId] : ['--session-id', opts.sessionId]),
      ...(opts.model ? ['--model', opts.model] : []),
    ];
  }

  start(opts: AgentRunOptions): RunningAgent {
    const child = spawn(this.bin, this.buildArgs(opts), {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let finalText: string | null = null;
    let costUsd = 0;
    let resultError: string | null = null;
    let sawResult = false;
    let stderrTail = '';
    let stopped = false;

    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });

    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (!line.trim()) return;
      let msg: StreamMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type === 'result') {
        sawResult = true;
        finalText = typeof msg.result === 'string' ? msg.result : null;
        costUsd = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : 0;
        if (msg.is_error) resultError = finalText || msg.subtype || 'Agent reported an error';
        return;
      }
      for (const e of translate(msg, opts.cwd)) opts.onEvent(e);
    });

    const done = new Promise<AgentResult>((resolve) => {
      let settled = false;
      const finish = (r: AgentResult) => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };
      child.on('error', (err) => {
        finish({ ok: false, finalText: null, costUsd: 0, error: `Could not start ${this.bin}: ${err.message}` });
      });
      child.on('close', (code) => {
        // Let readline flush any buffered last line first.
        lines.close();
        if (stopped) return finish({ ok: false, finalText, costUsd, error: 'Stopped' });
        if (resultError) return finish({ ok: false, finalText, costUsd, error: resultError });
        if (code !== 0 || !sawResult) {
          const why = stderrTail.trim().split('\n').slice(-5).join('\n') || `exit code ${code}`;
          return finish({ ok: false, finalText, costUsd, error: why });
        }
        finish({ ok: true, finalText, costUsd, error: null });
      });
    });

    return {
      done,
      stop() {
        stopped = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
        }, 5000).unref();
      },
    };
  }
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  is_error?: boolean;
  content?: unknown;
}

interface StreamMessage {
  type: string;
  subtype?: string;
  model?: string;
  message?: { content?: ContentBlock[] | string };
  result?: unknown;
  is_error?: boolean;
  total_cost_usd?: number;
  parent_tool_use_id?: string | null;
}

/** Flatten one stream-json message into timeline events. */
export function translate(msg: StreamMessage, cwd: string): AgentEvent[] {
  if (msg.type === 'system' && msg.subtype === 'init') {
    return [{ kind: 'status', text: `Agent started${msg.model ? ` (${msg.model})` : ''}` }];
  }
  // Skip subagent chatter; the parent's tool_use already summarises it.
  if (msg.parent_tool_use_id) return [];
  const content = msg.message?.content;
  if (!Array.isArray(content)) return [];

  const out: AgentEvent[] = [];
  if (msg.type === 'assistant') {
    for (const block of content) {
      if (block.type === 'text' && block.text?.trim()) out.push({ kind: 'assistant', text: block.text.trim() });
      if (block.type === 'tool_use' && block.name) out.push({ kind: 'tool', text: describeTool(block.name, block.input ?? {}, cwd) });
    }
  } else if (msg.type === 'user') {
    for (const block of content) {
      if (block.type === 'tool_result' && block.is_error) {
        out.push({ kind: 'tool', text: `⚠ ${clip(contentText(block.content), 300)}` });
      }
    }
  }
  return out;
}

function contentText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b?.text === 'string' ? b.text : '')).join(' ');
  return '';
}

function clip(s: string, n: number) {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

export function describeTool(name: string, input: Record<string, unknown>, cwd: string): string {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  const file = () => {
    const p = str('file_path') || str('notebook_path') || str('path');
    return p ? relative(cwd, p) || p : '';
  };
  switch (name) {
    case 'Bash':
      return `$ ${clip(str('command'), 160)}`;
    case 'Read':
      return `Read ${file()}`;
    case 'Edit':
    case 'MultiEdit':
      return `Edited ${file()}`;
    case 'Write':
      return `Wrote ${file()}`;
    case 'NotebookEdit':
      return `Edited notebook ${file()}`;
    case 'Glob':
      return `Looked for files ${str('pattern')}`;
    case 'Grep':
      return `Searched for "${clip(str('pattern'), 80)}"`;
    case 'WebFetch':
      return `Opened ${str('url')}`;
    case 'WebSearch':
      return `Searched the web for "${clip(str('query'), 80)}"`;
    case 'TodoWrite':
      return 'Updated its plan';
    case 'Task':
    case 'Agent':
      return `Started a helper: ${clip(str('description') || str('prompt'), 100)}`;
    default:
      return name;
  }
}
