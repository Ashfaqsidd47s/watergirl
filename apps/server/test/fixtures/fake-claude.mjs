#!/usr/bin/env node
// Stand-in for the Claude Code CLI in tests. Speaks the same stream-json
// protocol and changes files in its cwd depending on keywords in the prompt.
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const prompt = arg('-p') ?? '';
const sessionId = arg('--resume') ?? arg('--session-id');
if (process.env.FAKE_CLAUDE_LOG) {
  appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(args) + '\n');
  const leaked = Object.keys(process.env).filter((k) => k.startsWith('WG_'));
  appendFileSync(process.env.FAKE_CLAUDE_LOG + '.env', JSON.stringify(leaked) + '\n');
}

const emit = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const git = (...a) => execFileSync('git', a, { cwd: process.cwd() });
const say = (text) => emit({ type: 'assistant', message: { content: [{ type: 'text', text }] }, parent_tool_use_id: null });
const tool = (name, input) =>
  emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name, input }] }, parent_tool_use_id: null });
const result = (text, isError = false) =>
  emit({ type: 'result', subtype: isError ? 'error_during_execution' : 'success', is_error: isError, result: text, session_id: sessionId, total_cost_usd: 0.25 });

emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model' });

if (prompt.includes('FAIL')) {
  process.stderr.write('boom: something exploded\n');
  process.exit(1);
}

if (prompt.includes('SLOW')) {
  say('Taking my time…');
  await new Promise((r) => setTimeout(r, Number(process.env.FAKE_CLAUDE_SLOW_MS ?? 10_000)));
}

if (prompt.includes('ASK')) {
  say('Looking at refunds.');
  result('I looked at the refund flow.\n\nQUESTION: Should refunds support partial amounts?');
  process.exit(0);
}

if (prompt.includes('NOTHING')) {
  result('Nothing to change, the code already does that.');
  process.exit(0);
}

const file = prompt.includes('NOCOMMIT') ? 'leftover.txt' : 'hello.txt';
say('I will add a file.');
tool('Write', { file_path: join(process.cwd(), file), content: prompt });
writeFileSync(join(process.cwd(), file), prompt + '\n');
tool('Bash', { command: 'git commit -am "Add file"' });
if (!prompt.includes('NOCOMMIT')) {
  git('add', '-A');
  git('commit', '-m', `Add ${file}`);
}
emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'lint warning: trailing space' }] }, parent_tool_use_id: null });
result(`Added ${file}.\nChecked it by reading it back.`);
