import { access } from 'node:fs/promises';
import { ResourceReservationError, ResourceReservationService } from '../src/resource-reservations.js';

const [, , dataDir, barrier, operationId, approvalId, runId] = process.argv;
if (!dataDir || !barrier || !operationId || !approvalId || !runId) throw new Error('worker arguments are required');

const service = new ResourceReservationService({
  dataDir,
  authorization: {
    authorize: (input) => ({
      status: 'approved',
      approvalId: input.approvalId ?? `approval-${input.operationId}`,
      expiresAt: '2026-09-24T00:00:00.000Z',
    }),
  },
  problemSnapshot: { verify: () => true },
  capacity: { read: () => 10 },
  clock: () => new Date('2026-09-23T00:00:00.000Z'),
});

console.log('READY');
for (;;) {
  try {
    await access(barrier);
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

try {
  const result = await service.reserve({
    operationId,
    tenantId: 'tenant-a',
    principal: 'owner-a',
    scopeId: 'scope-a',
    resourceId: 'calendar-hours',
    period: {
      startsAt: '2026-09-23T10:00:00.000Z',
      endsAt: '2026-09-23T18:00:00.000Z',
    },
    amount: 8,
    unit: 'hour',
    runId,
    problem: {
      problem_snapshot_id: `sha256:${'a'.repeat(64)}`,
      problem_id: 'problem-resource-capacity',
      revision: 'r1',
    },
    approvalId,
  });
  console.log(JSON.stringify({ status: 'ok', reservationId: result.reservation.reservationId }));
} catch (error) {
  const code = error instanceof ResourceReservationError ? error.code : 'unknown';
  console.log(JSON.stringify({ status: 'error', code }));
  process.exitCode = 0;
}
