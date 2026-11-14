import type { FoundationAcl } from './ontology-foundation.js';
import { FoundationStoreError } from './foundation-store.js';
import { canonicalPortableJson } from './portable-graph.js';
import { philosophyRevisionDigest } from './philosophy-revision-reader.js';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const present = (value: Record<string, unknown>) => Object.hasOwn(value, 'acl');
const fail = (code: 'invalid_input' | 'authorization_denied' | 'revision_conflict', message: string): never => {
  throw new FoundationStoreError(code, message);
};

/** An explicit ACL opts a philosophy into owner-only storage; absence is legacy. */
export function privatePhilosophyAcl(payload: unknown): FoundationAcl | undefined {
  if (!record(payload)) return fail('invalid_input', 'Philosophy payload must be an object');
  if (!present(payload)) return undefined;
  const acl = payload.acl;
  if (!record(acl) || typeof acl.ownerId !== 'string' || !acl.ownerId.trim()
    || acl.visibility !== 'private' || !Array.isArray(acl.readerIds) || acl.readerIds.length !== 0
    || !Array.isArray(acl.writerIds) || acl.writerIds.length !== 0) {
    return fail('invalid_input', 'Private philosophy requires one owner and no additional readers or writers');
  }
  return { ownerId: acl.ownerId, visibility: 'private', readerIds: [], writerIds: [] };
}

export function assertPrivatePhilosophyRead(payload: unknown, principal: string): FoundationAcl | undefined {
  const acl = privatePhilosophyAcl(payload);
  if (acl && acl.ownerId !== principal) fail('authorization_denied', 'Private philosophy is owner-only');
  return acl;
}

/** Validate the existing Graph writer, without changing legacy organization philosophy. */
export function assertPrivatePhilosophyWrite(input: {
  payload: Record<string, unknown>; currentPayload?: Record<string, unknown>;
  principal: string; projectCode: string; currentVersion: number; expectedVersion?: number;
}): void {
  const currentAcl = input.currentPayload ? privatePhilosophyAcl(input.currentPayload) : undefined;
  const nextAcl = privatePhilosophyAcl(input.payload);
  if (!currentAcl && !nextAcl) return;
  if (!nextAcl || (currentAcl && currentAcl.ownerId !== input.principal)
    || nextAcl.ownerId !== input.principal) fail('authorization_denied', 'Private philosophy owner cannot change');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion !== input.currentVersion) {
    fail('revision_conflict', 'Private philosophy requires the exact current Graph version');
  }
  if (currentAcl && canonicalPortableJson(currentAcl) !== canonicalPortableJson(nextAcl)) {
    fail('authorization_denied', 'Private philosophy ACL cannot change');
  }
  if (typeof input.payload.statement !== 'string' || !input.payload.statement.trim()) {
    fail('invalid_input', 'Private philosophy statement is required');
  }
  const applicability = input.payload.judgmentApplicability;
  if (!record(applicability) || !record(applicability.scope)
    || applicability.scope.type !== 'project' || applicability.scope.id !== input.projectCode) {
    fail('authorization_denied', 'Private philosophy must remain in its authenticated project');
  }
  // Reuse the immutable revision reader's strict applicability/date contract.
  philosophyRevisionDigest({ kind: 'philosophy', id: 'private-philosophy-validation', revision: '1',
    payload: input.payload as Parameters<typeof philosophyRevisionDigest>[0]['payload'], applicability: applicability as unknown as Parameters<typeof philosophyRevisionDigest>[0]['applicability'] });
  if (currentAcl && canonicalPortableJson(input.currentPayload!.judgmentApplicability)
    !== canonicalPortableJson(applicability)) fail('authorization_denied', 'Private philosophy scope cannot change');
  if (input.currentPayload && !currentAcl) fail('authorization_denied', 'Legacy philosophy privacy requires a reviewed migration');
}
