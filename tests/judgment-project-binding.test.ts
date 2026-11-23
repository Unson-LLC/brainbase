import { describe, expect, it } from 'vitest';

import { selectJudgmentProjectBinding } from '../src/judgment-project-binding.js';

describe('selectJudgmentProjectBinding', () => {
  const all = {
    configuredProjectCode: 'zeims',
    relayProjectCode: 'brainbase',
    ownerRepositoryProjectCode: 'owner-project',
    sourceRepository: 'brainbase-unson'
  };

  it('story-judgment-project-binding-common:ac:1 uses the project a Claude Code turn named over the relay mapping', () => {
    expect(selectJudgmentProjectBinding({ hostRuntime: 'claude-code', ...all })).toBe('zeims');
  });

  it('story-judgment-project-binding-common:ac:2 keeps the relay mapping over a project left in a Codex environment', () => {
    expect(selectJudgmentProjectBinding({ hostRuntime: 'codex', ...all })).toBe('brainbase');
  });

  it('story-judgment-project-binding-common:ac:3 falls back to the configured project, the owner mapping, then the repository', () => {
    for (const hostRuntime of ['codex', 'claude-code']) {
      expect(selectJudgmentProjectBinding({ hostRuntime, ...all, relayProjectCode: null, configuredProjectCode: null }))
        .toBe('owner-project');
      expect(selectJudgmentProjectBinding({ hostRuntime, sourceRepository: 'brainbase-unson' })).toBe('brainbase-unson');
      expect(selectJudgmentProjectBinding({ hostRuntime })).toBeNull();
    }
    expect(selectJudgmentProjectBinding({ hostRuntime: 'codex', ...all, relayProjectCode: null })).toBe('zeims');
  });

  it('story-judgment-project-binding-common:ac:3 treats blank candidates as absent', () => {
    expect(selectJudgmentProjectBinding({
      hostRuntime: 'claude-code', configuredProjectCode: '   ', relayProjectCode: '', sourceRepository: ' harness '
    })).toBe('harness');
  });
});
