import { describe, expect, it } from 'vitest';

import {
  AutomationRunService,
  type AutomationReceiptPort,
  type AutomationRunPorts,
  type AutomationRunStorePort
} from '../src/automation-run.js';
import {
  createRoutineRuntime,
  createRoutineCycleRuntime,
  createRoutineLivenessRuntime,
  finalizeRoutineCycleResult,
  parseRoutineExpectations,
  routineScheduleMatches,
  type RoutineReceiptPort,
  type RoutineRuntimePorts
} from '../src/routines.js';
import { resolveRuntimeHostContext } from '../src/runtime-host.js';
import { createRunReceiptIdentity, type RunReceiptSourceType } from '../src/run-receipt.js';
import { assertRunReceiptPort } from '../src/run-receipt-port.js';

function makeReceipt(externalRunId: string, sourceType = 'codex_automations') {
  const projectId = 'portable-project';
  const workflowId = `${sourceType}:workflow`;
  const identity = createRunReceiptIdentity({
    projectId,
    sourceType: sourceType as RunReceiptSourceType,
    externalRunId,
    sourceWorkflowId: workflowId
  });
  return {
    contract_version: 'run_receipt.v1',
    source: {
      type: sourceType,
      workflow_id: workflowId,
      runtime_target: 'test'
    },
    run: {
      project_id: projectId,
      external_run_id: externalRunId,
      status: 'success',
      evidence_state: 'confirmed',
      started_at: '2026-10-18T09:00:00+09:00',
      finished_at: '2026-10-18T09:01:00+09:00',
      evidence_refs: [{ kind: 'log_ref', ref: 'test:run' }]
    },
    delivery: {
      idempotency_key: identity.idempotency_key,
      attempt: 1,
      sent_at: '2026-10-18T09:01:01+09:00'
    }
  };
}

function hostPorts() {
  const calls: string[] = [];
  const host = {
    storageRoot: {
      resolve: () => '/host/injected/storage'
    },
    clock: {
      now: () => new Date('2026-10-18T00:00:00.000Z')
    },
    identity: {
      resolve: ({ tenantId }: { tenantId: string }) => {
        calls.push(`identity:${tenantId}`);
        return {
          principal: 'host-principal',
          tenantId,
          organizationId: 'org-injected',
          actorId: 'actor-injected'
        };
      }
    },
    tenant: {
      resolve: () => 'tenant-injected'
    },
    auth: {
      authorize: ({ tenantId }: { tenantId: string }) => {
        calls.push(`auth:${tenantId}`);
        return { allowed: true, context: { authorization: 'host' } };
      }
    },
    graph: {
      resolve: ({ tenantId }: { tenantId: string }) => {
        calls.push(`graph:${tenantId}`);
        return { graphRevision: 'revision-injected', tenantId };
      }
    }
  };
  return { host, calls };
}

function memoryRunStore(): AutomationRunStorePort {
  const records = new Map<string, {
    status: 'in_progress' | 'retryable' | 'uncertain' | 'completed';
    phase: 'claimed' | 'runner_started' | 'receipt_persisted' | 'retryable' | 'uncertain' | 'unknown' | 'completed';
    fingerprint: string;
    operation: string;
    namespace: unknown;
    claimToken?: string;
    attempt: number;
    payload?: unknown;
    normalized?: unknown;
    runnerResult?: unknown;
    persistedReceipt?: unknown;
  }>();
  let sequence = 0;
  const sameNamespace = (left: unknown, right: unknown) => (
    JSON.stringify(left) === JSON.stringify(right)
  );
  return {
    claim: ({ key, fingerprint, operation, namespace }) => {
      const existing = records.get(key);
      if (existing && (
        existing.fingerprint !== fingerprint
        || existing.operation !== operation
        || !sameNamespace(existing.namespace, namespace)
      )) {
        return { status: 'conflict', reason: 'identity_mismatch', phase: existing.phase };
      }
      if (existing?.status === 'completed') {
        return {
          status: 'replay',
          payload: existing.payload,
          normalized: existing.normalized as never,
          runnerResult: existing.runnerResult,
          persistedReceipt: existing.persistedReceipt,
          phase: 'completed'
        };
      }
      if (existing?.status === 'uncertain') {
        return { status: 'conflict', reason: 'uncertain', phase: existing.phase };
      }
      if (existing?.status === 'in_progress') {
        return { status: 'in_progress', attempt: existing.attempt, phase: existing.phase };
      }
      const attempt = (existing?.attempt || 0) + 1;
      const claimToken = `claim-${++sequence}`;
      records.set(key, {
        status: 'in_progress',
        phase: 'claimed',
        fingerprint,
        operation,
        namespace,
        claimToken,
        attempt
      });
      return { status: 'claimed', claimToken, attempt, phase: 'claimed' };
    },
    markRunnerStarted: ({ key, claimToken }) => {
      const existing = records.get(key);
      if (!existing || existing.status !== 'in_progress' || existing.claimToken !== claimToken
        || existing.phase !== 'claimed') {
        throw new Error('runner start checkpoint lost');
      }
      existing.phase = 'runner_started';
    },
    markReceiptPersisted: ({ key, claimToken, payload, normalized, runnerResult, persistedReceipt }) => {
      const existing = records.get(key);
      if (!existing || existing.status !== 'in_progress' || existing.claimToken !== claimToken
        || existing.phase !== 'runner_started') {
        throw new Error('receipt checkpoint lost');
      }
      existing.phase = 'receipt_persisted';
      existing.payload = payload;
      existing.normalized = normalized;
      existing.runnerResult = runnerResult;
      existing.persistedReceipt = persistedReceipt;
    },
    complete: ({ key, claimToken, payload, normalized, runnerResult, persistedReceipt }) => {
      const existing = records.get(key);
      if (!existing || existing.status !== 'in_progress' || existing.claimToken !== claimToken
        || existing.phase !== 'receipt_persisted') {
        throw new Error('claim lost');
      }
      records.set(key, {
        status: 'completed',
        phase: 'completed',
        fingerprint: existing.fingerprint,
        operation: existing.operation,
        namespace: existing.namespace,
        attempt: existing.attempt,
        payload,
        normalized,
        runnerResult,
        persistedReceipt
      });
    },
    release: ({ key, claimToken, outcome, phase, error }) => {
      const existing = records.get(key);
      if (existing?.status === 'in_progress' && existing.claimToken === claimToken) {
        if (outcome === 'retryable' && phase !== 'retryable') {
          throw new Error('retryable release requires a pre-run phase');
        }
        records.set(key, {
          status: outcome,
          phase,
          fingerprint: existing.fingerprint,
          operation: existing.operation,
          namespace: existing.namespace,
          attempt: existing.attempt,
          payload: error
        });
      }
    },
    read: ({ key, fingerprint, operation, namespace }) => {
      const existing = records.get(key);
      if (!existing) return { status: 'missing' };
      if (existing.fingerprint !== fingerprint
        || existing.operation !== operation
        || !sameNamespace(existing.namespace, namespace)) {
        return { status: 'uncertain', phase: 'unknown' };
      }
      if (existing.status === 'completed') {
        return {
          status: 'completed',
          phase: 'completed',
          payload: existing.payload,
          normalized: existing.normalized as never,
          runnerResult: existing.runnerResult,
          persistedReceipt: existing.persistedReceipt
        };
      }
      return { status: existing.status, phase: existing.phase, attempt: existing.attempt };
    }
  };
}

describe('Stage 3c injected runtime contracts', () => {
  it('shares the receipt persist/query boundary across consumers', () => {
    const port = { persist: () => ({ ok: true }), query: () => [] };
    expect(() => assertRunReceiptPort(port, 'shared receipt')).not.toThrow();
    expect(() => assertRunReceiptPort({ persist: () => ({ ok: true }) }, 'shared receipt'))
      .toThrow('shared receipt port with persist and query is required');
  });

  it('routes the consumer handlers through the portable routine cycle boundary', async () => {
    const calls: string[] = [];
    const runtime = createRoutineCycleRuntime({
      handlers: {
        ohayo: async (input, context) => {
          calls.push(`${String(input.routine)}:${String(context)}`);
          return { status: 'completed', value: 1 };
        }
      },
      onError: (error, routine) => ({ status: 'failed', routine, message: String(error) }),
      summarize: (routine, result) => ({ routine, ...result as Record<string, unknown> }),
      contentAvailable: (_routine, result) => result?.status === 'completed' ? true : undefined,
      postprocess: (_routine, result) => ({ ...result as Record<string, unknown>, decorated: true })
    });
    await expect(runtime.execute({ routine: 'ohayo' }, 'injected-context')).resolves.toEqual({
      routine: 'ohayo',
      status: 'completed',
      value: 1,
      anomalies: [],
      coverage: 'confirmed',
      summary: { routine: 'ohayo', status: 'completed', coverage: 'confirmed', anomaly_count: 0 },
      decorated: true
    });
    await expect(runtime.execute({ routine: 'unsupported' })).resolves.toMatchObject({
      routine: 'unsupported', status: 'failed', routine: 'unsupported', coverage: 'unavailable'
    });
    expect(calls).toEqual(['ohayo:injected-context']);
  });

  it('preserves common status, coverage, and anomaly semantics during finalization', () => {
    expect(finalizeRoutineCycleResult('ohayo', {
      status: 'completed',
      anomalies: [{ code: 'source_unavailable' }]
    })).toMatchObject({
      status: 'completed',
      coverage: 'partial',
      anomalies: [{ code: 'source_unavailable' }],
      summary: { routine: 'ohayo', status: 'completed', coverage: 'partial', anomaly_count: 1 }
    });
    expect(finalizeRoutineCycleResult('retro', { status: 'completed' }, {
      contentAvailable: false
    })).toMatchObject({
      status: 'partial',
      coverage: 'partial',
      anomalies: [{ code: 'routine_content_empty' }]
    });
  });

  it('moves receipt liveness scheduling and required-artifact checks behind injected ports', async () => {
    const runtime = createRoutineLivenessRuntime({
      expectations: [{
        routine: 'morning',
        automation_id: 'portable-morning',
        source_type: 'portable_scheduler',
        project_id: 'portable-project',
        timezone: 'Asia/Tokyo',
        schedule: { kind: 'daily', hour: 6, minute: 0 },
        grace_minutes: 20,
        required_artifacts: ['routine_summary']
      }],
      runReceiptQueryService: {
        listHistory: () => ({ items: [] })
      },
      now: () => new Date('2026-10-18T21:20:00.001Z')
    });

    await expect(runtime.listExceptions()).resolves.toEqual([
      expect.objectContaining({
        code: 'missing_receipt',
        automation_id: 'portable-morning',
        scheduled_at: '2026-10-18T21:00:00.000Z',
        grace_deadline_at: '2026-10-18T21:20:00.000Z'
      })
    ]);
  });

  it('keeps routine expectations portable until the consumer supplies constraints', () => {
    const expectations = parseRoutineExpectations([{
      routine: 'morning',
      automation_id: 'portable-morning',
      source_type: 'custom_scheduler',
      project_id: 'tenant-project',
      timezone: 'UTC',
      schedule: { kind: 'daily', hour: 7, minute: 30 },
      grace_minutes: 30,
      required_artifacts: ['artifact-a']
    }]);

    expect(expectations[0]).toMatchObject({
      source_type: 'custom_scheduler',
      project_id: 'tenant-project',
      timezone: 'UTC'
    });
    expect(() => parseRoutineExpectations(expectations, { projectId: 'brainbase' }))
      .toThrow('must be brainbase');
  });

  it('runs routine start, receipt persistence, retry, and history through injected ports', async () => {
    const { host, calls } = hostPorts();
    const persisted: unknown[] = [];
    const history = [{ runId: 'history-1' }];
    const runner = {
      start: ({ context }: { context: { tenantId: string; storageRoot: string } }) => ({
        receipt: makeReceipt('routine-start-1'),
        result: { tenantId: context.tenantId, storageRoot: context.storageRoot }
      }),
      retry: () => ({ receipt: makeReceipt('routine-retry-1') })
    };
    const receipt: RoutineReceiptPort = {
      persist: (input) => {
        persisted.push(input);
        return { persisted: true };
      },
      query: () => history
    };
    const runtime = createRoutineRuntime({
      ...host,
      runner,
      receipt
    } as RoutineRuntimePorts);

    const request = { routine: 'morning', automationId: 'portable-morning' };
    const started = await runtime.start(request);
    const retried = await runtime.retry(request, 'routine-start-1');
    const listed = await runtime.history(request);

    expect(started.normalizedReceipt.run.external_run_id).toBe('routine-start-1');
    expect(retried.normalizedReceipt.run.external_run_id).toBe('routine-retry-1');
    expect(started.runnerResult).toEqual({
      tenantId: 'tenant-injected',
      storageRoot: '/host/injected/storage'
    });
    expect(persisted).toHaveLength(2);
    expect(listed).toEqual(history);
    expect(calls).toEqual([
      'identity:tenant-injected', 'auth:tenant-injected', 'graph:tenant-injected',
      'identity:tenant-injected', 'auth:tenant-injected', 'graph:tenant-injected',
      'identity:tenant-injected', 'auth:tenant-injected', 'graph:tenant-injected'
    ]);
  });

  it('runs automation start, receipt persistence, retry, and history through the same host boundary', async () => {
    const { host } = hostPorts();
    const persisted: unknown[] = [];
    const receipt: AutomationReceiptPort = {
      persist: (input) => {
        persisted.push(input);
        return input.normalized.identity;
      },
      query: ({ request }) => ({ workflowId: request.workflowId, entries: persisted.length })
    };
    const runner = {
      start: () => ({ receipt: makeReceipt('automation-start-1', 'github_actions') }),
      retry: () => ({ receipt: makeReceipt('automation-retry-1', 'github_actions') })
    };
    const service = new AutomationRunService({
      ...host,
      runner,
      receipt,
      runStore: memoryRunStore()
    } as AutomationRunPorts);
    const request = {
      workflowId: 'portable-workflow',
      automationId: 'portable-automation',
      projectId: 'portable-project',
      organizationId: 'org-injected',
      actorId: 'actor-injected',
      externalRunId: 'automation-start-1'
    };

    const started = await service.start(request);
    const retried = await service.rerun({ ...request, externalRunId: 'automation-retry-1' }, 'automation-start-1');
    const listed = await service.history(request);

    expect(started.normalizedReceipt.run.external_run_id).toBe('automation-start-1');
    expect(retried.normalizedReceipt.run.external_run_id).toBe('automation-retry-1');
    expect(persisted).toHaveLength(2);
    expect(listed).toEqual({ workflowId: 'portable-workflow', entries: 2 });
  });

  it('requires an explicit authorization decision and rejects undefined/legacy approvals', async () => {
    const { host } = hostPorts();
    await expect(resolveRuntimeHostContext({
      ...host,
      auth: { authorize: () => undefined }
    }, { operation: 'auth-undefined' })).rejects.toThrow('runtime authorization denied');
    await expect(resolveRuntimeHostContext({
      ...host,
      auth: { authorize: () => ({ approved: true }) as never }
    }, { operation: 'auth-legacy-approved' })).rejects.toThrow('runtime authorization denied');
    await expect(resolveRuntimeHostContext({
      ...host,
      auth: { authorize: () => false }
    }, { operation: 'auth-denied' })).rejects.toThrow('runtime authorization denied');
    await expect(resolveRuntimeHostContext({
      ...host,
      auth: { authorize: () => true }
    }, { operation: 'auth-true' })).resolves.toMatchObject({ tenantId: 'tenant-injected' });
    await expect(resolveRuntimeHostContext({
      ...host,
      tenant: { resolve: () => 'tenant-outside-scope' },
      auth: {
        authorize: ({ tenantId }) => ({
          allowed: tenantId === 'tenant-injected'
        })
      }
    }, { operation: 'auth-wrong-tenant-scope' })).rejects.toThrow('runtime authorization denied');
  });

  it('claims an external run before the runner and replays after durable completion', async () => {
    const { host } = hostPorts();
    const runStore = memoryRunStore();
    const persisted: unknown[] = [];
    let runnerCalls = 0;
    let releaseRunner!: () => void;
    const runnerStarted = new Promise<void>((resolve) => { releaseRunner = resolve; });
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const service = new AutomationRunService({
      ...host,
      runner: {
        start: async () => {
          runnerCalls += 1;
          releaseRunner();
          await blocked;
          return { receipt: makeReceipt('automation-race-1', 'github_actions'), result: { runnerCalls } };
        }
      },
      receipt: {
        persist: ({ normalized }) => {
          persisted.push(normalized);
          return normalized.identity;
        },
        query: () => []
      },
      runStore
    } as AutomationRunPorts);
    const request = {
      workflowId: 'portable-workflow',
      automationId: 'portable-automation',
      projectId: 'portable-project',
      organizationId: 'org-injected',
      actorId: 'actor-injected',
      externalRunId: 'automation-race-1'
    };
    const first = service.start(request);
    await runnerStarted;
    await expect(service.start(request)).rejects.toMatchObject({ code: 'automation_run_in_progress', status: 409 });
    unblock();
    const completed = await first;
    const replay = await service.start(request);
    expect(completed.replayed).toBeUndefined();
    expect(replay.replayed).toBe(true);
    expect(runnerCalls).toBe(1);
    expect(persisted).toHaveLength(1);
  });

  it('fails closed after runner failure so a retry cannot invoke it twice', async () => {
    const { host } = hostPorts();
    const runStore = memoryRunStore();
    let runnerCalls = 0;
    const service = new AutomationRunService({
      ...host,
      runner: {
        start: async () => {
          runnerCalls += 1;
          if (runnerCalls === 1) throw new Error('temporary runner failure');
          return { receipt: makeReceipt('automation-retryable-1', 'github_actions') };
        }
      },
      receipt: { persist: () => ({ ok: true }), query: () => [] },
      runStore
    } as AutomationRunPorts);
    const request = {
      workflowId: 'portable-workflow',
      automationId: 'portable-automation',
      projectId: 'portable-project',
      organizationId: 'org-injected',
      actorId: 'actor-injected',
      externalRunId: 'automation-retryable-1'
    };
    await expect(service.start(request)).rejects.toThrow('temporary runner failure');
    await expect(service.start(request)).rejects.toMatchObject({
      code: 'automation_run_uncertain', status: 409
    });
    expect(runnerCalls).toBe(1);
  });

  it('rejects a same-key payload change without invoking the runner', async () => {
    const { host } = hostPorts();
    const runStore = memoryRunStore();
    let runnerCalls = 0;
    const service = new AutomationRunService({
      ...host,
      runner: {
        start: async () => {
          runnerCalls += 1;
          return { receipt: makeReceipt('automation-conflict-1', 'github_actions') };
        }
      },
      receipt: { persist: () => ({ ok: true }), query: () => [] },
      runStore
    } as AutomationRunPorts);
    const request = {
      workflowId: 'portable-workflow',
      automationId: 'portable-automation',
      projectId: 'portable-project',
      organizationId: 'org-injected',
      actorId: 'actor-injected',
      externalRunId: 'automation-conflict-1',
      payload: { value: 1 }
    };
    await service.start(request);
    await expect(service.start({ ...request, payload: { value: 2 } })).rejects.toMatchObject({
      code: 'automation_run_identity_conflict', status: 409
    });
    expect(runnerCalls).toBe(1);
  });

  it('does not duplicate the runner when completion readback is lost', async () => {
    const { host } = hostPorts();
    let runnerCalls = 0;
    let reads = 0;
    const baseStore = memoryRunStore();
    const runStore: AutomationRunStorePort = {
      ...baseStore,
      read: async (input) => {
        reads += 1;
        const result = await baseStore.read(input);
        if (reads === 1 && result.status === 'completed') return { status: 'missing' };
        return result;
      }
    };
    const service = new AutomationRunService({
      ...host,
      runner: {
        start: async () => {
          runnerCalls += 1;
          return { receipt: makeReceipt('automation-readback-1', 'github_actions') };
        }
      },
      receipt: { persist: () => ({ ok: true }), query: () => [] },
      runStore
    } as AutomationRunPorts);
    const request = {
      workflowId: 'portable-workflow',
      automationId: 'portable-automation',
      projectId: 'portable-project',
      organizationId: 'org-injected',
      actorId: 'actor-injected',
      externalRunId: 'automation-readback-1'
    };
    await expect(service.start(request)).rejects.toMatchObject({
      code: 'automation_run_uncertain', status: 409
    });
    await expect(service.start(request)).resolves.toMatchObject({ replayed: true });
    expect(runnerCalls).toBe(1);
  });

  it('fails closed after receipt persistence fails without rerunning the runner', async () => {
    const { host } = hostPorts();
    const runStore = memoryRunStore();
    let runnerCalls = 0;
    const service = new AutomationRunService({
      ...host,
      runner: {
        start: async () => {
          runnerCalls += 1;
          return { receipt: makeReceipt('automation-persist-failure-1', 'github_actions') };
        }
      },
      receipt: {
        persist: () => { throw new Error('receipt persistence lost'); },
        query: () => []
      },
      runStore
    } as AutomationRunPorts);
    const request = {
      workflowId: 'portable-workflow',
      automationId: 'portable-automation',
      projectId: 'portable-project',
      organizationId: 'org-injected',
      actorId: 'actor-injected',
      externalRunId: 'automation-persist-failure-1'
    };
    await expect(service.start(request)).rejects.toThrow('receipt persistence lost');
    await expect(service.start(request)).rejects.toMatchObject({
      code: 'automation_run_uncertain', status: 409
    });
    expect(runnerCalls).toBe(1);
  });

  it('fails closed after completion checkpoint fails without rerunning the runner', async () => {
    const { host } = hostPorts();
    const baseStore = memoryRunStore();
    let completeCalls = 0;
    let runnerCalls = 0;
    const runStore: AutomationRunStorePort = {
      ...baseStore,
      complete: async (input) => {
        completeCalls += 1;
        if (completeCalls === 1) throw new Error('completion checkpoint lost');
        return baseStore.complete(input);
      }
    };
    const service = new AutomationRunService({
      ...host,
      runner: {
        start: async () => {
          runnerCalls += 1;
          return { receipt: makeReceipt('automation-complete-failure-1', 'github_actions') };
        }
      },
      receipt: { persist: () => ({ ok: true }), query: () => [] },
      runStore
    } as AutomationRunPorts);
    const request = {
      workflowId: 'portable-workflow',
      automationId: 'portable-automation',
      projectId: 'portable-project',
      organizationId: 'org-injected',
      actorId: 'actor-injected',
      externalRunId: 'automation-complete-failure-1'
    };
    await expect(service.start(request)).rejects.toThrow('completion checkpoint lost');
    await expect(service.start(request)).rejects.toMatchObject({
      code: 'automation_run_uncertain', status: 409
    });
    expect(completeCalls).toBe(1);
    expect(runnerCalls).toBe(1);
  });

  it('keeps lookup, gates, checkpoints, and transitions host-owned while ordering them around the runner', async () => {
    const { host } = hostPorts();
    const events: string[] = [];
    const service = new AutomationRunService({
      ...host,
      lifecycle: {
        lookup: ({ phase }) => {
          events.push(`lookup:${phase}`);
          return { id: 'workflow-host-record' };
        },
        designGate: ({ phase, workflow }) => {
          events.push(`design:${phase}:${String((workflow as { id: string }).id)}`);
          return { allowed: true, context: { source: 'host' } };
        },
        humanGate: ({ phase }) => {
          events.push(`human:${phase}`);
          return true;
        },
        checkpoint: ({ phase }) => {
          events.push(`checkpoint:${phase}`);
        },
        transition: ({ from, to }) => {
          events.push(`transition:${from}->${to}`);
        }
      },
      runner: {
        start: async () => {
          events.push('runner');
          return { receipt: makeReceipt('automation-lifecycle-1', 'github_actions') };
        }
      },
      receipt: { persist: () => ({ ok: true }), query: () => [] },
      runStore: memoryRunStore()
    } as AutomationRunPorts);
    const request = {
      workflowId: 'portable-workflow',
      projectId: 'portable-project',
      organizationId: 'org-injected',
      actorId: 'actor-injected',
      externalRunId: 'automation-lifecycle-1'
    };

    await expect(service.start(request)).resolves.toBeDefined();
    expect(events).toEqual([
      'lookup:prepared',
      'design:prepared:workflow-host-record',
      'human:prepared',
      'checkpoint:claimed',
      'transition:claimed->runner_started',
      'runner',
      'transition:runner_started->receipt_persisted',
      'transition:receipt_persisted->completed'
    ]);
  });

  it('rejects a host HITL decision before claiming and never invokes the runner', async () => {
    const { host } = hostPorts();
    const runStore = memoryRunStore();
    let runnerCalls = 0;
    const service = new AutomationRunService({
      ...host,
      lifecycle: {
        lookup: () => ({ id: 'workflow-host-record' }),
        designGate: () => true,
        humanGate: () => ({ allowed: false, reason: 'approval pending' })
      },
      runner: {
        start: async () => {
          runnerCalls += 1;
          return { receipt: makeReceipt('automation-human-gate-1', 'github_actions') };
        }
      },
      receipt: { persist: () => ({ ok: true }), query: () => [] },
      runStore
    } as AutomationRunPorts);
    const request = {
      workflowId: 'portable-workflow',
      projectId: 'portable-project',
      organizationId: 'org-injected',
      actorId: 'actor-injected',
      externalRunId: 'automation-human-gate-1'
    };

    await expect(service.start(request)).rejects.toMatchObject({
      code: 'automation_workflow_human_gate_denied', status: 409
    });
    expect(runnerCalls).toBe(0);
  });

  it('fails closed when a post-run lifecycle transition is lost', async () => {
    const { host } = hostPorts();
    const runStore = memoryRunStore();
    let runnerCalls = 0;
    let transitionCalls = 0;
    const service = new AutomationRunService({
      ...host,
      lifecycle: {
        lookup: () => ({ id: 'workflow-host-record' }),
        designGate: () => true,
        humanGate: () => true,
        transition: ({ to }) => {
          transitionCalls += 1;
          if (to === 'completed' && transitionCalls === 3) throw new Error('workflow transition lost');
        }
      },
      runner: {
        start: async () => {
          runnerCalls += 1;
          return { receipt: makeReceipt('automation-transition-failure-1', 'github_actions') };
        }
      },
      receipt: { persist: () => ({ ok: true }), query: () => [] },
      runStore
    } as AutomationRunPorts);
    const request = {
      workflowId: 'portable-workflow',
      projectId: 'portable-project',
      organizationId: 'org-injected',
      actorId: 'actor-injected',
      externalRunId: 'automation-transition-failure-1'
    };

    await expect(service.start(request)).rejects.toThrow('workflow transition lost');
    await expect(service.start(request)).resolves.toMatchObject({ replayed: true });
    expect(transitionCalls).toBe(4);
    expect(runnerCalls).toBe(1);
  });

  it('keeps summary and postprocess failures inside the routine error boundary', async () => {
    const summaryRuntime = createRoutineCycleRuntime({
      handlers: { ohayo: () => ({ status: 'completed' }) },
      onError: (error) => ({
        status: 'failed',
        anomalies: [{ code: 'routine_stage_failed', stage: (error as { stage?: string }).stage, summary: String(error) }]
      }),
      summarize: () => { throw new Error('summary failed'); }
    });
    await expect(summaryRuntime.execute({ routine: 'ohayo' })).resolves.toMatchObject({
      status: 'failed',
      coverage: 'unavailable',
      anomalies: [{ code: 'routine_stage_failed', stage: 'summary' }]
    });

    const postprocessRuntime = createRoutineCycleRuntime({
      handlers: { ohayo: () => ({ status: 'completed' }) },
      onError: (error) => ({
        status: 'failed',
        anomalies: [{ code: 'routine_stage_failed', stage: (error as { stage?: string }).stage, summary: String(error) }]
      }),
      postprocess: () => { throw new Error('postprocess failed'); }
    });
    await expect(postprocessRuntime.execute({ routine: 'ohayo' })).resolves.toMatchObject({
      status: 'failed',
      coverage: 'unavailable',
      anomalies: [{ code: 'routine_stage_failed', stage: 'postprocess' }]
    });
  });

  it('uses the expectation timezone and weekday supplied by the consumer', () => {
    expect(routineScheduleMatches({
      routine: 'sunday',
      automation_id: 'sunday',
      source_type: 'custom',
      project_id: 'project',
      timezone: 'UTC',
      schedule: { kind: 'weekly', hour: 0, minute: 0, day_of_week: 0 },
      grace_minutes: 5,
      required_artifacts: ['artifact']
    }, new Date('2026-10-18T00:00:00.000Z'))).toBe(true);
  });
});
