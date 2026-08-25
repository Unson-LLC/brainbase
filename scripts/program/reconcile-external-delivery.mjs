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
  const matches = candidates.filter((candidate, index) => {
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
  return matches[0];
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
  if (candidate.mergeable !== 'MERGEABLE') {
    invalid.push('mergeable');
  }
  if (candidate.merge_state_status !== 'CLEAN') {
    invalid.push('merge_state_status');
  }
  const expectedSourceUrl = `https://github.com/${identity.repository}/pull/${identity.pull_request}`;
  if (candidate.source_url !== expectedSourceUrl) invalid.push('source_url');
  if (invalid.length > 0) {
    throw new Error(
      `canonical external delivery candidate[${index}] is not verified merged delivery; invalid: ${invalid.join(', ')}`,
    );
  }
}

function isNonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
