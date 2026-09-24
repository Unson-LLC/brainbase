const VERSION_PATTERN = '(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)';

function headingVersion(text, heading) {
  const match = text.match(new RegExp(`^## ${heading} — v${VERSION_PATTERN}(?:\\s|[（(]|$)`, 'mu'));
  return match?.[1] ?? null;
}

export function parsePublicReleaseState(statusText, packageVersion) {
  if (typeof statusText !== 'string' || typeof packageVersion !== 'string') {
    throw new TypeError('statusText and packageVersion must be strings');
  }

  const releasedVersion = headingVersion(statusText, 'Released');
  const candidateVersion = headingVersion(statusText, 'Candidate');
  if (!releasedVersion) {
    throw new Error('status must contain a Released version heading');
  }

  const isReleased = releasedVersion === packageVersion;
  const isCandidate = candidateVersion === packageVersion && !isReleased;
  if (!isReleased && !isCandidate) {
    throw new Error(
      `package version ${packageVersion} must match either the Released version or the Candidate version`
    );
  }

  return Object.freeze({
    releasedVersion,
    candidateVersion,
    state: isCandidate ? 'candidate' : 'released'
  });
}
