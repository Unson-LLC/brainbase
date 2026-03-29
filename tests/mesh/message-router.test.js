import { describe, it, expect, vi } from 'vitest';
import { MessageRouter } from '../../server/mesh/message-router.js';

describe('MessageRouter', () => {
  it('registerHandler and route calls the right handler', async () => {
    const router = new MessageRouter();
    const handler = vi.fn();

    router.registerHandler('query', handler);

    const envelope = { type: 'query', payload: { question: 'hello' } };
    await router.route(envelope);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(envelope);
  });

  it('route with unregistered type logs warning and does not throw', async () => {
    const router = new MessageRouter();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Should not throw
    await router.route({ type: 'unknown_type', payload: null });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No handler registered for type: unknown_type')
    );

    warnSpy.mockRestore();
  });

  it('routes different types to different handlers', async () => {
    const router = new MessageRouter();
    const queryHandler = vi.fn();
    const responseHandler = vi.fn();

    router.registerHandler('query', queryHandler);
    router.registerHandler('response', responseHandler);

    await router.route({ type: 'query', payload: 'q' });
    await router.route({ type: 'response', payload: 'r' });

    expect(queryHandler).toHaveBeenCalledOnce();
    expect(responseHandler).toHaveBeenCalledOnce();
  });
});
