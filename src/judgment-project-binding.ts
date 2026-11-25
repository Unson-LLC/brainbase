// The project a judgment turn is resolved and audited for, chosen from the
// candidates a Host already holds. The Host reads the environment, the
// public relay's repository map, and the cwd's repository; this module only
// orders them, so every Host that resolves a turn picks the same project.

export interface JudgmentProjectBindingCandidates {
  /** The Host runtime of the turn (`codex`, `claude-code`, or `antigravity`). */
  hostRuntime: string;
  /** BRAINBASE_JUDGMENT_PROJECT_CODE as the Host received it. */
  configuredProjectCode?: string | null;
  /** The enabled public relay's project for the cwd's repository. */
  relayProjectCode?: string | null;
  /** The owner-local repository mapping's project for the cwd. */
  ownerRepositoryProjectCode?: string | null;
  /** The cwd's repository name, as the last fallback. */
  sourceRepository?: string | null;
}

function present(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : null;
}

/**
 * Order:
 * 1. A Claude Code turn's configured project. The owner's bridge sets it only
 *    from that request's project header and removes it otherwise, so it is
 *    the project the turn named.
 * 2. The enabled public relay's repository mapping. In a Codex environment it
 *    stays authoritative over a configured project left from earlier work.
 *    When a Claude Code turn named another project, the relay refuses the
 *    receipt at delivery (project mapping mismatch) instead of publishing it
 *    under the relay's project.
 * 3. The configured project, then the owner-local repository mapping, then
 *    the repository name.
 */
export function selectJudgmentProjectBinding(candidates: JudgmentProjectBindingCandidates): string | null {
  const configured = present(candidates.configuredProjectCode);
  if ((candidates.hostRuntime === 'claude-code' || candidates.hostRuntime === 'antigravity') && configured) {
    return configured;
  }
  return present(candidates.relayProjectCode)
    ?? configured
    ?? present(candidates.ownerRepositoryProjectCode)
    ?? present(candidates.sourceRepository);
}
