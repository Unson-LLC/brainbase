import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, ErrorCodes, asyncHandler, logger } from '../src/server-support.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DEBUG;
});

function lastLine(spy: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const call = spy.mock.calls.at(-1);
  return JSON.parse(String(call?.[0])) as Record<string, unknown>;
}

describe('logger', () => {
  it('writes one JSON line and masks sensitive keys, tokens, and secret paths', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.info('connected', {
      user: 'owner',
      apiKey: 'value',
      nested: { refresh_token: 'value', note: 'ok' },
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
      hex: 'a'.repeat(32),
      file: '/home/me/.ssh/id_rsa',
    });
    const entry = lastLine(spy);
    expect(entry).toMatchObject({
      level: 'info',
      msg: 'connected',
      user: 'owner',
      apiKey: '[REDACTED]',
      nested: { refresh_token: '[REDACTED]', note: 'ok' },
      jwt: '[JWT_REDACTED]',
      hex: '[HEX_KEY_REDACTED]',
      file: '[SENSITIVE_PATH_REDACTED]',
    });
    expect(typeof entry.timestamp).toBe('string');
  });

  it('keeps the message and stack of an error but not its secrets', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logger.error('failed', { error: new Error('boom'), password: 'value' });
    const entry = lastLine(spy);
    expect(entry).toMatchObject({ level: 'error', error: 'boom', password: '[REDACTED]' });
    expect(String(entry.stack)).toContain('boom');
  });

  it('writes debug lines only when DEBUG is set and warn lines to console.warn', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logger.debug('hidden');
    expect(log).not.toHaveBeenCalled();
    process.env.DEBUG = '1';
    logger.debug('shown');
    expect(lastLine(log)).toMatchObject({ level: 'debug', msg: 'shown' });
    logger.warn('careful');
    expect(lastLine(warn)).toMatchObject({ level: 'warn', msg: 'careful' });
  });

  it('stops at a bounded depth instead of recursing forever', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let index = 0; index < 20; index += 1) deep = { child: deep };
    logger.info('deep', { deep });
    expect(JSON.stringify(lastLine(spy))).toContain('[MAX_DEPTH]');
  });
});

describe('asyncHandler', () => {
  it('passes a rejected handler error to next', async () => {
    const failure = AppError.validation('bad input');
    const next = vi.fn();
    asyncHandler(async () => { throw failure; })({}, {}, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(failure));
  });

  it('does not call next when the handler resolves', async () => {
    const next = vi.fn();
    const handler = vi.fn(async () => 'ok');
    asyncHandler(handler)({ id: 1 }, {}, next);
    await Promise.resolve();
    await Promise.resolve();
    expect(handler).toHaveBeenCalledWith({ id: 1 }, {}, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('keeps the same error codes the hosts map to HTTP statuses', () => {
    expect(ErrorCodes.PROJECT_CATALOG_UNAVAILABLE).toEqual({ code: 'PROJECT_CATALOG_UNAVAILABLE', statusCode: 503 });
    expect(AppError.forbidden('no', { reason: 'scope' }).toLog()).toMatchObject({ statusCode: 403, details: { reason: 'scope' } });
  });
});
