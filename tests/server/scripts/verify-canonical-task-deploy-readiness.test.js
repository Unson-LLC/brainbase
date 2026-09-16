import { describe, expect, it, vi } from 'vitest';

import { verifyCanonicalTaskDeployReadiness } from '../../../scripts/verify-canonical-task-deploy-readiness.mjs';

function response(status, body) {
  return { status, json: vi.fn().mockResolvedValue(body) };
}

describe('verifyCanonicalTaskDeployReadiness', () => {
  it('accepts the validation failure as proof that the mutation gate is open', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(422, { code: 'validation_failed' }));
    const enableReadiness = vi.fn();

    const result = await verifyCanonicalTaskDeployReadiness({
      baseUrl: 'http://127.0.0.1:55123',
      internalApiSecret: 'secret',
      fetchImpl,
      enableReadiness,
    });

    expect(result).toMatchObject({ ready: true, reenabled: false });
    expect(enableReadiness).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:55123/api/companion/tasks',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-internal-api-key': 'secret' }),
        body: '{}',
      }),
    );
  });

  it('fails closed when readiness is disabled and no current evidence is supplied', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(503, {
      code: 'canonical_task_mutation_not_ready',
      details: { reason: 'persisted_readiness_mismatch' },
    }));

    await expect(verifyCanonicalTaskDeployReadiness({
      internalApiSecret: 'secret',
      fetchImpl,
    })).rejects.toThrow(/persisted_readiness_mismatch.*evidence/i);
  });

  it('re-enables with verified evidence and requires a successful second probe', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(503, { code: 'canonical_task_mutation_not_ready' }))
      .mockResolvedValueOnce(response(422, { code: 'validation_failed' }));
    const enableReadiness = vi.fn().mockResolvedValue({ ready: true });

    const result = await verifyCanonicalTaskDeployReadiness({
      evidencePath: 'var/canonical-task-before-enable.json',
      internalApiSecret: 'secret',
      fetchImpl,
      enableReadiness,
      rootDir: '/repo',
    });

    expect(result).toMatchObject({ ready: true, reenabled: true });
    expect(enableReadiness).toHaveBeenCalledWith(expect.objectContaining({
      argv: ['--enable', '--evidence', 'var/canonical-task-before-enable.json'],
      rootDir: '/repo',
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails the deployment when the gate remains closed after re-enable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(503, {
      code: 'canonical_task_mutation_not_ready',
    }));

    await expect(verifyCanonicalTaskDeployReadiness({
      evidencePath: 'before-enable.json',
      internalApiSecret: 'secret',
      fetchImpl,
      enableReadiness: vi.fn().mockResolvedValue({ ready: true }),
    })).rejects.toThrow(/remains disabled/i);
  });

  it.each([
    [201, { id: 'unexpected-created-task' }],
    [403, { code: 'personal_kg_owner_required' }],
    [500, { code: 'canonical_task_error' }],
  ])('rejects unexpected probe response %s', async (status, body) => {
    await expect(verifyCanonicalTaskDeployReadiness({
      internalApiSecret: 'secret',
      fetchImpl: vi.fn().mockResolvedValue(response(status, body)),
    })).rejects.toThrow(/unexpected canonical task readiness probe/i);
  });
});
