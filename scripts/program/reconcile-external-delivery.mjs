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
    return canonicalDeliveryIdentityKeys.every((key) => identity[key] === expectedIdentity[key]);
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
