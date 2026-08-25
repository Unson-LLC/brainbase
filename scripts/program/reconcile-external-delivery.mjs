export function deliveryIdentity(delivery) {
  assertIdentityObject(delivery, 'candidate');
  return {
    repository: delivery.repository,
    pull_request: delivery.pull_request,
    role: delivery.role,
    merged_sha: delivery.merged_sha ?? delivery.merge?.sha,
  };
}

const canonicalDeliveryIdentityKeys = [
  'repository',
  'pull_request',
  'role',
  'merged_sha',
];

export const canonicalSelectorContract = Object.freeze({
  owner: 'scripts/program/reconcile-external-delivery.mjs',
  trigger: 'external_delivery_readback_before_program_status_evaluation',
  failure_surface: 'throw_fail_closed_reconciliation_gate_needs_review',
});

const preMergeabilityValues = new Set(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']);
const preMergeStateValues = new Set(['CLEAN', 'DIRTY', 'UNKNOWN']);

export function assertUniqueDeliveryReferences(candidates) {
  if (!Array.isArray(candidates)) {
    throw new Error('external delivery candidates must be an array');
  }
  const seen = new Map();
  candidates.forEach((candidate, index) => {
    assertIdentityObject(candidate, `candidate[${index}]`);
    const identity = deliveryIdentity(candidate);
    const invalidKeys = ['repository', 'pull_request'].filter(
      (key) => !isValidIdentityValue(key, identity[key]),
    );
    if (invalidKeys.length > 0) {
      throw new Error(
        `external delivery candidate[${index}] has invalid repository+pull_request identity: ${invalidKeys.join(', ')}`,
      );
    }
    const reference = `${identity.repository}#${identity.pull_request}`;
    const firstIndex = seen.get(reference);
    if (firstIndex !== undefined) {
      throw new Error(
        `external delivery repository+pull_request must be unique: ${reference} (candidate[${firstIndex}] and candidate[${index}])`,
      );
    }
    seen.set(reference, index);
  });
}

export function selectCanonicalDelivery(candidates, expectedIdentity) {
  if (!Array.isArray(candidates)) {
    throw new Error('canonical external delivery candidates must be an array');
  }
  assertIdentityObject(expectedIdentity, 'expected identity');
  const invalidKeys = canonicalDeliveryIdentityKeys.filter((key) => (
    !Object.hasOwn(expectedIdentity ?? {}, key)
      || !isValidIdentityValue(key, expectedIdentity[key])
  ));
  if (invalidKeys.length > 0) {
    throw new Error(
      `canonical external delivery identity requires nonempty ${canonicalDeliveryIdentityKeys.join(', ')}; invalid: ${invalidKeys.join(', ')}`,
    );
  }
  const candidateEntries = candidates.map((candidate, index) => {
    assertIdentityObject(candidate, `candidate[${index}]`);
    const identity = deliveryIdentity(candidate);
    const candidateInvalidKeys = canonicalDeliveryIdentityKeys.filter(
      (key) => !isValidIdentityValue(key, identity[key]),
    );
    if (candidateInvalidKeys.length > 0) {
      throw new Error(
        `canonical external delivery candidate[${index}] has invalid identity fields: ${candidateInvalidKeys.join(', ')}`,
      );
    }
    return { candidate, identity, index };
  });
  assertUniqueDeliveryReferences(candidates);
  const matches = candidateEntries.filter(({ candidate, identity, index }) => {
    const identityMatches = canonicalDeliveryIdentityKeys.every(
      (key) => identity[key] === expectedIdentity[key],
    );
    if (!identityMatches) return false;
    assertVerifiedMergedDelivery(candidate, identity, index);
    return true;
  });
  if (matches.length !== 1) {
    throw new Error(`canonical external delivery match count must be 1, received ${matches.length}`);
  }
  return matches[0].candidate;
}

function assertIdentityObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`canonical external delivery ${label} must be an object`);
  }
}

function isValidIdentityValue(key, value) {
  if (key === 'pull_request') return Number.isInteger(value) && value > 0;
  return typeof value === 'string' && value.trim().length > 0;
}

function assertVerifiedMergedDelivery(candidate, identity, index) {
  const invalid = [];
  const merge = isPlainObject(candidate.merge) ? candidate.merge : null;
  if (candidate.state !== 'MERGED_EXTERNALLY') invalid.push('state');
  if (!merge) invalid.push('merge');
  if (!isNonemptyString(merge?.sha)) invalid.push('merge.sha');
  if (!isNonemptyString(merge?.merged_at)) invalid.push('merge.merged_at');
  if (!isNonemptyString(merge?.merged_by)) invalid.push('merge.merged_by');
  if (Object.hasOwn(candidate, 'merged_sha') && candidate.merged_sha !== merge?.sha) {
    invalid.push('merged_sha/merge.sha');
  } else if (isNonemptyString(merge?.sha) && identity.merged_sha !== merge.sha) {
    invalid.push('merged_sha/merge.sha');
  }
  assertPreMergeHealth(candidate, invalid);
  const expectedSourceUrl = `https://github.com/${identity.repository}/pull/${identity.pull_request}`;
  if (candidate.source_url !== expectedSourceUrl) invalid.push('source_url');
  if (invalid.length > 0) {
    throw new Error(
      `canonical external delivery candidate[${index}] is not verified merged delivery; invalid: ${invalid.join(', ')}`,
    );
  }
}

function assertPreMergeHealth(candidate, invalid) {
  if (!Object.hasOwn(candidate, 'pre_merge_health')) return;
  const health = candidate.pre_merge_health;
  if (!isPlainObject(health)) {
    invalid.push('pre_merge_health');
    return;
  }
  if (!preMergeabilityValues.has(health.mergeable)) {
    invalid.push('pre_merge_health.mergeable');
  }
  if (!preMergeStateValues.has(health.merge_state_status)) {
    invalid.push('pre_merge_health.merge_state_status');
  }
}

function isNonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
