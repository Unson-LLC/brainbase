export function deliveryIdentity(delivery) {
  return {
    repository: delivery.repository,
    pull_request: delivery.pull_request,
    role: delivery.role,
    merged_sha: delivery.merged_sha ?? delivery.merge?.sha,
  };
}

export function selectCanonicalDelivery(candidates, expectedIdentity) {
  const matches = candidates.filter((candidate) => {
    const identity = deliveryIdentity(candidate);
    return Object.entries(expectedIdentity).every(([key, value]) => identity[key] === value);
  });
  if (matches.length !== 1) {
    throw new Error(`canonical external delivery match count must be 1, received ${matches.length}`);
  }
  return matches[0];
}
