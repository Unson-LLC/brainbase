import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RequestTokenContext } from '../../src/auth/request-token-context.js';

describe('request-scoped MCP token propagation', () => {
  it('uses the personal JWT only inside its request and falls back outside it', async () => {
    const context = new RequestTokenContext({ getToken: async () => 'service-token' });
    assert.strictEqual(await context.getToken(), 'service-token');
    await context.run({ token: 'personal-token' }, async () => {
      assert.strictEqual(await context.getToken(), 'personal-token');
    });
    assert.strictEqual(await context.getToken(), 'service-token');
  });

  it('keeps concurrent principals isolated', async () => {
    const context = new RequestTokenContext({ getToken: async () => 'fallback' });
    const [first, second] = await Promise.all([
      context.run({ token: 'kato' }, async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return context.getToken();
      }),
      context.run({ token: 'kawamura' }, async () => context.getToken()),
    ]);
    assert.deepStrictEqual([first, second], ['kato', 'kawamura']);
  });
});
