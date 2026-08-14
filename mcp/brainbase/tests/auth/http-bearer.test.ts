import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isAuthorizedMcpHttpRequest } from '../../src/server.js';

describe('MCP HTTP Bearer authentication', () => {
  it('accepts only the exact configured bearer token', () => {
    assert.strictEqual(isAuthorizedMcpHttpRequest('Bearer expected-token', 'expected-token'), true);
    assert.strictEqual(isAuthorizedMcpHttpRequest(undefined, 'expected-token'), false);
    assert.strictEqual(isAuthorizedMcpHttpRequest('Basic expected-token', 'expected-token'), false);
    assert.strictEqual(isAuthorizedMcpHttpRequest('Bearer other-token', 'expected-token'), false);
    assert.strictEqual(isAuthorizedMcpHttpRequest('Bearer expected-token', ''), false);
  });
});
