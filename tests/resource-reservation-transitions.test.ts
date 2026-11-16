import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RESOURCE_RESERVATION_TRANSITIONS,
  ResourceReservationError,
  ResourceReservationService,
  transitionResourceReservation,
  type ExternalActionStatus,
  type ResourceReservationRecord,
  type ResourceReservationRequest,
  type ResourceReservationState,
} from '../src/resource-reservations.js';

const dirs: string[] = [];
const ACTIONS = ['approve', 'reserve', 'release', 'cancel', 'consume', 'start_external'] as const;
const EXTERNAL: readonly ExternalActionStatus[] = ['not_started', 'started', 'completed', 'unknown'];
const step = { operationId: 'op-direct', principal: 'owner-a', at: '2026-09-23T09:00:00.000Z' };

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeService(): Promise<ResourceReservationService> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-reservation-transitions-'));
  dirs.push(dir);
  return new ResourceReservationService({
    dataDir: dir,
    authorization: {
      authorize: (input) => ({
        status: 'approved',
        approvalId: input.approvalId ?? `approval-${input.operationId}`,
        evidence: { source: 'test' },
      }),
    },
    problemSnapshot: { verify: () => true },
    capacity: { read: () => 100 },
  });
}

function request(operationId: string): ResourceReservationRequest {
  return {
    operationId,
    tenantId: 'tenant-a',
    principal: 'owner-a',
    scopeId: 'scope-a',
    resourceId: 'calendar-hours',
    period: { startsAt: '2026-09-23T10:00:00.000Z', endsAt: '2026-09-23T18:00:00.000Z' },
    amount: 1,
    unit: 'hour',
    runId: `run-${operationId}`,
    problem: { problem_snapshot_id: `sha256:${'a'.repeat(64)}`, problem_id: 'problem-1', revision: 'r1' },
  };
}

/** Approves one reservation and returns helpers bound to it. */
async function approved(service: ResourceReservationService, name: string) {
  const { reservation } = await service.approve(request(`${name}-approve`));
  const mutation = (operation: string) => ({
    operationId: `${name}-${operation}`,
    tenantId: 'tenant-a',
    principal: 'owner-a',
    scopeId: 'scope-a',
    reservationId: reservation.reservationId,
  });
  return {
    reservation,
    reserve: () => service.reserve({ ...request(`${name}-reserve`), runId: reservation.runId, approvalId: reservation.approval.approvalId }),
    mutation,
  };
}

function steps(record: ResourceReservationRecord): string[] {
  return record.history.map((entry) => `${entry.action}:${entry.fromState ?? '-'}>${entry.toState}`);
}

function tableSteps(): string[] {
  return ACTIONS.flatMap((action) => {
    const rule = RESOURCE_RESERVATION_TRANSITIONS[action];
    const from: readonly (ResourceReservationState | '-')[] = rule.from.length === 0 ? ['-'] : rule.from;
    return from.map((source) => `${action}:${source}>${rule.to}`);
  });
}

describe('resource reservation transition table', () => {
  it('lists every writing action once and cannot be changed at run time', () => {
    expect(Object.keys(RESOURCE_RESERVATION_TRANSITIONS).sort()).toEqual([...ACTIONS].sort());
    expect(Object.isFrozen(RESOURCE_RESERVATION_TRANSITIONS)).toBe(true);
    for (const action of ACTIONS) {
      const rule = RESOURCE_RESERVATION_TRANSITIONS[action];
      expect(Object.isFrozen(rule)).toBe(true);
      expect(Object.isFrozen(rule.from)).toBe(true);
      expect(Object.isFrozen(rule.externalFrom)).toBe(true);
    }
  });

  it('has no way out of a finished reservation and never writes an unknown external action', () => {
    const sources = new Set(ACTIONS.flatMap((action) => RESOURCE_RESERVATION_TRANSITIONS[action].from));
    for (const finished of ['released', 'cancelled', 'consumed'] as const) expect(sources.has(finished)).toBe(false);
    expect(ACTIONS.map((action) => RESOURCE_RESERVATION_TRANSITIONS[action].externalTo)).not.toContain('unknown');
  });

  it('keeps the external-action ranges the operations have always checked', () => {
    expect(RESOURCE_RESERVATION_TRANSITIONS.release.externalFrom).toEqual(['not_started', 'completed']);
    expect(RESOURCE_RESERVATION_TRANSITIONS.cancel.externalFrom).toEqual(['not_started', 'completed']);
    expect(RESOURCE_RESERVATION_TRANSITIONS.start_external.externalFrom).toEqual(['not_started']);
    expect([...RESOURCE_RESERVATION_TRANSITIONS.reserve.externalFrom].sort()).toEqual([...EXTERNAL].sort());
    expect([...RESOURCE_RESERVATION_TRANSITIONS.consume.externalFrom].sort()).toEqual([...EXTERNAL].sort());
  });

  it('rejects a write the table does not list and leaves the record as it was', async () => {
    const service = await makeService();
    const { reservation } = await approved(service, 'direct');
    const before = structuredClone(reservation);

    const outsideState = () => transitionResourceReservation(reservation, { ...step, action: 'consume' });
    expect(outsideState).toThrow(ResourceReservationError);
    expect(outsideState).toThrow(expect.objectContaining({ code: 'reservation_state_conflict' }));
    expect(reservation).toEqual(before);

    const started: ResourceReservationRecord = { ...structuredClone(reservation), state: 'reserved', externalAction: { status: 'started' } };
    const startedBefore = structuredClone(started);
    const outsideExternal = () => transitionResourceReservation(started, { ...step, action: 'release' });
    expect(outsideExternal).toThrow(expect.objectContaining({ code: 'reservation_state_conflict' }));
    expect(started).toEqual(startedBefore);
  });

  it('writes state, time, external action and history from one step', async () => {
    const service = await makeService();
    const { reservation } = await approved(service, 'one-step');
    const reserved = transitionResourceReservation(reservation, { ...step, action: 'reserve' });
    expect(reserved).toBe(reservation);
    expect(reserved).toMatchObject({ state: 'reserved', updatedAt: step.at, externalAction: { status: 'not_started' } });
    expect(reserved.history.at(-1)).toEqual({
      action: 'reserve', operationId: 'op-direct', principal: 'owner-a', occurredAt: step.at,
      fromState: 'approved', toState: 'reserved', amount: 1, externalActionStatus: 'not_started',
    });

    const later = '2026-09-23T09:30:00.000Z';
    transitionResourceReservation(reservation, { ...step, action: 'start_external', at: later });
    expect(reservation.externalAction).toEqual({ status: 'started', startedAt: later });
    expect(reservation.history.at(-1)).toMatchObject({ fromState: 'reserved', toState: 'reserved', externalActionStatus: 'started' });

    transitionResourceReservation(reservation, { ...step, action: 'consume', at: '2026-09-23T10:00:00.000Z' });
    expect(reservation.state).toBe('consumed');
    expect(reservation.externalAction).toEqual({ status: 'completed', startedAt: later });
  });

  it('matches what the service operations really write, in both directions', async () => {
    const service = await makeService();
    const seen = new Set<string>();
    const record = (reservation: ResourceReservationRecord) => { for (const item of steps(reservation)) seen.add(item); };

    const releasedEarly = await approved(service, 'released-early');
    record((await service.release(releasedEarly.mutation('release'))).reservation);

    const cancelledEarly = await approved(service, 'cancelled-early');
    record((await service.cancel(cancelledEarly.mutation('cancel'))).reservation);

    const released = await approved(service, 'released');
    await released.reserve();
    record((await service.release(released.mutation('release'))).reservation);

    const cancelled = await approved(service, 'cancelled');
    await cancelled.reserve();
    record((await service.cancel(cancelled.mutation('cancel'))).reservation);

    const consumed = await approved(service, 'consumed');
    await consumed.reserve();
    await service.startExternalAction(consumed.mutation('start'));
    await expect(service.release(consumed.mutation('release'))).rejects.toMatchObject({ code: 'external_action_reconciliation_required' });
    await expect(service.startExternalAction(consumed.mutation('start-again'))).rejects.toMatchObject({
      code: 'reservation_state_conflict', message: 'External action is already started',
    });
    const done = (await service.consume(consumed.mutation('consume'))).reservation;
    record(done);
    await expect(service.cancel(consumed.mutation('cancel'))).rejects.toMatchObject({
      code: 'reservation_state_conflict', message: `Reservation ${done.reservationId} is consumed`,
    });

    expect([...seen].sort()).toEqual(tableSteps().sort());
  });
});
