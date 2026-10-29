import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { headings } from '../scripts/draft-release-notes.mjs';
import { assertVersionHistoryDocuments, parsePublicReleaseState } from '../scripts/lib/public-release-state.mjs';

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
    expect(() => parsePublicReleaseState('## Released — v0.6.0\n## Candidate — v0.6.1（npm公開前）', '0.7.0'))
      .toThrow('## Candidate — v0.7.0（npm公開前）');
    expect(() => parsePublicReleaseState('## Released — v0.6.0\n## Candidate — v0.6.1（npm公開前）', '0.7.0'))
      .toThrow('docs/manual/guide/status.md');
  });

  it('rejects a version history that omits the package version heading', () => {
    const state = parsePublicReleaseState('## Released — v0.6.0\n## Candidate — v0.7.0（npm公開前）', '0.7.0');
    expect(() => assertVersionHistoryDocuments([{ level: 2, title: 'Unreleased — develop' }], state, '0.7.0'))
      .toThrow('version-history missing heading: ## 0.7.0 candidate — npm公開前');
  });

  it('documents this repository package version in status.md and version-history.md', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const status = await readFile(new URL('../docs/manual/guide/status.md', import.meta.url), 'utf8');
    const history = await readFile(new URL('../docs/manual/reference/version-history.md', import.meta.url), 'utf8');
    const state = parsePublicReleaseState(status, packageJson.version);
    expect(assertVersionHistoryDocuments(headings(history), state, packageJson.version)).toMatch(/^\d+\.\d+\.\d+/u);
  });
});
