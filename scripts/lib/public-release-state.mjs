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
      `package version ${packageVersion} must match either the Released version or the Candidate version in docs/manual/guide/status.md ` +
      `(first Released heading is v${releasedVersion}; first Candidate heading is ${candidateVersion ? `v${candidateVersion}` : 'missing'}). ` +
      `Only those first headings count. ` +
      `A version-bump pull request must add "## Candidate — v${packageVersion}（npm公開前）" above the other Candidate headings, and "## ${packageVersion} candidate — npm公開前" in docs/manual/reference/version-history.md, in the same commit.`
    );
  }

  return Object.freeze({
    releasedVersion,
    candidateVersion,
    state: isCandidate ? 'candidate' : 'released'
  });
}

export function assertVersionHistoryDocuments(headingsList, state, packageVersion) {
  const expected = state.state === 'candidate' ? `${packageVersion} candidate — npm公開前` : packageVersion;
  const documented = headingsList.some((heading) => (
    heading.level === 2 && (
      heading.title === expected || (state.state === 'released' && heading.title.startsWith(`${expected} `))
    )
  ));
  if (!documented) {
    throw new Error(
      `version-history missing heading: ## ${expected} in docs/manual/reference/version-history.md. ` +
      `A version-bump pull request must add it in the same commit as the status.md Candidate or Released heading.`
    );
  }
  return expected;
}
