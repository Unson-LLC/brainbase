import { describe, expect, it } from 'vitest';
import { parsePublicReleaseState } from '../scripts/lib/public-release-state.mjs';

describe('public release state', () => {
  it('keeps an unpublished package version in the candidate section', () => {
    expect(parsePublicReleaseState(
      '## Released — v0.6.0\n## Candidate — v0.7.0（npm公開前）',
      '0.7.0'
    )).toEqual({
      releasedVersion: '0.6.0',
      candidateVersion: '0.7.0',
      state: 'candidate'
    });
  });

  it('allows the package version to become released after readback', () => {
    expect(parsePublicReleaseState('## Released — v0.7.0', '0.7.0')).toEqual({
      releasedVersion: '0.7.0',
      candidateVersion: null,
      state: 'released'
    });
  });

  it('rejects a package version that is neither released nor candidate', () => {
    expect(() => parsePublicReleaseState('## Released — v0.6.0', '0.7.0'))
      .toThrow('must match either the Released version or the Candidate version');
  });
});
