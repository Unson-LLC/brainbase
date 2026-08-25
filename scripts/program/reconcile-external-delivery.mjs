export function deliveryIdentity(delivery) {
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
  const invalidKeys = canonicalDeliveryIdentityKeys.filter((key) => (
    !Object.hasOwn(expectedIdentity ?? {}, key)
      || !isNonemptyIdentityValue(expectedIdentity[key])
  ));
  if (invalidKeys.length > 0) {
    throw new Error(
      `canonical external delivery identity requires nonempty ${canonicalDeliveryIdentityKeys.join(', ')}; invalid: ${invalidKeys.join(', ')}`,
    );
  }
  const matches = candidates.filter((candidate) => {
    const identity = deliveryIdentity(candidate);
    return canonicalDeliveryIdentityKeys.every((key) => identity[key] === expectedIdentity[key]);
  });
  if (matches.length !== 1) {
    throw new Error(`canonical external delivery match count must be 1, received ${matches.length}`);
  }
  return matches[0];
}

function isNonemptyIdentityValue(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return value !== null && value !== undefined;
}
