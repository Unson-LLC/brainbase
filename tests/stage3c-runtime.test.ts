import { describe, expect, it } from 'vitest';

import {
  AutomationRunService,
  type AutomationReceiptPort,
  type AutomationRunPorts
} from '../src/automation-run.js';
import {
  createRoutineRuntime,
  parseRoutineExpectations,
  routineScheduleMatches,
  type RoutineReceiptPort,
  type RoutineRuntimePorts
} from '../src/routines.js';
import { createRunReceiptIdentity, type RunReceiptSourceType } from '../src/run-receipt.js';

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
        return { principal: 'host-principal', tenantId };
      }
    },
    tenant: {
      resolve: () => 'tenant-injected'
    },
    auth: {
      authorize: ({ tenantId }: { tenantId: string }) => {
        calls.push(`auth:${tenantId}`);
        return { approved: true, context: { authorization: 'host' } };
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

describe('Stage 3c injected runtime contracts', () => {
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
      receipt
    } as AutomationRunPorts);
    const request = { workflowId: 'portable-workflow', automationId: 'portable-automation' };

    const started = await service.start(request);
    const retried = await service.rerun(request, 'automation-start-1');
    const listed = await service.history(request);

    expect(started.normalizedReceipt.run.external_run_id).toBe('automation-start-1');
    expect(retried.normalizedReceipt.run.external_run_id).toBe('automation-retry-1');
    expect(persisted).toHaveLength(2);
    expect(listed).toEqual({ workflowId: 'portable-workflow', entries: 2 });
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
