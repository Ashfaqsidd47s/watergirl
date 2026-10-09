import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { describeTool, translate } from '../src/agents/claude-code.ts';
import { decrypt, encrypt, safeEqual } from '../src/crypto.ts';
import { extractQuestion } from '../src/runner.ts';

describe('crypto', () => {
  it('round-trips and detects tampering', () => {
    const key = randomBytes(32);
    const sealed = encrypt('ghp_secret', key);
    assert.notEqual(sealed, 'ghp_secret');
    assert.equal(decrypt(sealed, key), 'ghp_secret');
    assert.throws(() => decrypt(sealed, randomBytes(32)));
  });

  it('compares tokens', () => {
    assert.ok(safeEqual('abc', 'abc'));
    assert.ok(!safeEqual('abc', 'abcd'));
  });
});

describe('extractQuestion', () => {
  it('takes the last QUESTION line', () => {
    assert.equal(extractQuestion('Did stuff.\nQUESTION: A?\nmore\nQUESTION: B?'), 'B?');
    assert.equal(extractQuestion('**QUESTION:** Use Stripe or Razorpay?'), 'Use Stripe or Razorpay?');
    assert.equal(extractQuestion('All done, no questions.'), null);
    assert.equal(extractQuestion(null), null);
  });
});

describe('stream-json translation', () => {
  it('turns tool calls into readable lines', () => {
    assert.equal(describeTool('Edit', { file_path: '/w/src/orders.ts' }, '/w'), 'Edited src/orders.ts');
    assert.equal(describeTool('Bash', { command: 'npm test' }, '/w'), '$ npm test');
    assert.equal(describeTool('Grep', { pattern: 'Order' }, '/w'), 'Searched for "Order"');
    assert.equal(describeTool('mcp__x__y', {}, '/w'), 'mcp__x__y');
  });

  it('flattens assistant messages and skips subagent chatter', () => {
    const events = translate(
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: ' Hi ' }, { type: 'tool_use', name: 'Read', input: { file_path: '/w/a.ts' } }] },
      },
      '/w',
    );
    assert.deepEqual(events, [
      { kind: 'assistant', text: 'Hi' },
      { kind: 'tool', text: 'Read a.ts' },
    ]);
    assert.deepEqual(translate({ type: 'assistant', parent_tool_use_id: 'x', message: { content: [{ type: 'text', text: 'sub' }] } }, '/w'), []);
    assert.deepEqual(translate({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }, '/w'), []);
  });
});
