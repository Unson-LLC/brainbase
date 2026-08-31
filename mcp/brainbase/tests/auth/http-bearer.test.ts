import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isAuthorizedMcpHttpRequest, isPublicMcpHttpEndpoint } from '../../src/server.js';

describe('MCP HTTP Bearer authentication', () => {
  it('accepts only the exact configured bearer token', () => {
    assert.strictEqual(isAuthorizedMcpHttpRequest('Bearer expected-token', 'expected-token'), true);
    assert.strictEqual(isAuthorizedMcpHttpRequest(undefined, 'expected-token'), false);
    assert.strictEqual(isAuthorizedMcpHttpRequest('Basic expected-token', 'expected-token'), false);
    assert.strictEqual(isAuthorizedMcpHttpRequest('Bearer other-token', 'expected-token'), false);
    assert.strictEqual(isAuthorizedMcpHttpRequest('Bearer expected-token', ''), false);
  });

  it('allows only the health endpoint without a bearer token', () => {
    assert.strictEqual(isPublicMcpHttpEndpoint('GET', '/health'), true);
    assert.strictEqual(isPublicMcpHttpEndpoint('POST', '/health'), false);
    assert.strictEqual(isPublicMcpHttpEndpoint('POST', '/mcp'), false);
    assert.strictEqual(isPublicMcpHttpEndpoint('POST', '/host/judgment/resolve'), false);
    assert.strictEqual(isPublicMcpHttpEndpoint('POST', '/hooks/judgment'), false);
  });
});
