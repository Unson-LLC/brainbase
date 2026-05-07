import { describe, expect, it } from 'vitest';

import {
  checkGraphifyImpactGate,
  getGraphifyRequiredFiles,
  hasGraphifyImpactEvidence,
  requiresGraphifyImpactReview,
} from '../../scripts/vibepro-graphify-impact-gate.mjs';

describe('vibepro-graphify-impact-gate', () => {
  it('active indicator and realtime session files require Graphify impact review', () => {
    expect(requiresGraphifyImpactReview('server/services/session-core/activity-service-methods.js')).toBe(true);
    expect(requiresGraphifyImpactReview('public/modules/session-indicators.js')).toBe(true);
    expect(requiresGraphifyImpactReview('public/modules/ui/views/session-view.js')).toBe(true);
    expect(requiresGraphifyImpactReview('docs/README.md')).toBe(false);
  });

  it('filters changed files to graph-sensitive paths', () => {
    expect(getGraphifyRequiredFiles([
      './docs/README.md',
      'public/modules/session-ui-state.js',
      'scripts/codex-pty-shim.py',
    ])).toEqual([
      'public/modules/session-ui-state.js',
      'scripts/codex-pty-shim.py',
    ]);
  });

  it('accepts PR body with explicit Graphify impact evidence', () => {
    expect(hasGraphifyImpactEvidence(`
## Graphify Impact Review
- command: vibepro graph . --run-graphify
- command: graphify path "session-indicators.js" "session-view.js"
`)).toBe(true);
  });

  it('fails graph-sensitive changes when evidence is missing', () => {
    const result = checkGraphifyImpactGate({
      changedFiles: ['server/services/session-core/activity-service-methods.js'],
      prBody: '## Summary\n- fix active state',
    });

    expect(result).toMatchObject({
      status: 'failed',
      requiredFiles: ['server/services/session-core/activity-service-methods.js'],
    });
    expect(result.reason).toContain('docs/brainbase-capabilities/runbooks/vibepro-impact-review.md');
    expect(result.reason).toContain('docs/brainbase-capabilities/capabilities/vibepro.impact-review.yml');
  });

  it('passes graph-sensitive changes when evidence exists', () => {
    const result = checkGraphifyImpactGate({
      changedFiles: ['public/modules/session-indicators.js'],
      prBody: '## Graphify Impact Review\n- graphify query "active indicator"',
    });

    expect(result.status).toBe('passed');
  });

  it('passes ordinary changes without evidence', () => {
    const result = checkGraphifyImpactGate({
      changedFiles: ['docs/README.md'],
      prBody: '',
    });

    expect(result.status).toBe('passed');
  });
});
