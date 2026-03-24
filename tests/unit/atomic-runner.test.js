import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAtomicRunner } from '../../lib/utils/atomic-runner.js';

describe('createAtomicRunner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects with TypeError when a non-function is passed by default', async () => {
    const runner = createAtomicRunner({ label: 'Test Runner' });

    await expect(runner('not-a-function')).rejects.toThrow('operation is not a function');
  });

  it('warns and skips when strict mode is enabled', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runner = createAtomicRunner({ label: 'Test Runner', strict: true });

    await expect(runner('not-a-function')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith('Test Runner skipped: operation is not a function');
  });
});
