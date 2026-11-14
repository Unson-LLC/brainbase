import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { nodeRequestToFetch } from '../src/local-web-fetch-bridge.js';

describe('local Web fetch bridge', () => {
  it('forwards the idempotency key together with JSON mutation headers', async () => {
    const request = Object.assign(
      Readable.from(['{"title":"会議"}']),
      {
        method: 'POST',
        url: '/api/meeting-minutes',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'idempotency-key': 'bridge-create-1'
        }
      }
    ) as unknown as IncomingMessage;
    const bridged = await nodeRequestToFetch(request, { limitBytes: 1024 });
    expect(bridged.headers.get('accept')).toBe('application/json');
    expect(bridged.headers.get('content-type')).toBe('application/json');
    expect(bridged.headers.get('idempotency-key')).toBe('bridge-create-1');
    expect(await bridged.text()).toBe('{"title":"会議"}');
  });
});
