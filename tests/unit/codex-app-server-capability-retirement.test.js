import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';

const capabilityPath = 'docs/brainbase-capabilities/capabilities/codex.app-server.yml';
const capability = yaml.load(readFileSync(capabilityPath, 'utf8'));

describe('codex.app-server retirement record', () => {
  it('keeps the retired adapter free of active surfaces and legacy instructions', () => {
    expect(capability.id).toBe('codex.app-server');
    expect(capability.lifecycle).toBe('retired');
    expect(capability.surfaces).toEqual({ ui: [], api: [], code: [], data: [] });
    expect(capability.depends_on).toEqual([]);

    const activeContract = [
      capability.purpose,
      capability.surfaces,
      capability.depends_on,
      capability.visibility_rules,
      capability.verification,
      capability.common_failures,
      capability.runbooks,
      capability.troubleshooting,
    ];
    expect(JSON.stringify(activeContract)).not.toMatch(
      /(?:\/api\/(?:sessions|state)|session\.codexAppServer|restore|codex-app-server-(?:adapter|activity|session|transcript)|codex-app-repl|xterm|tmux)/i,
    );
    expect(capability.verification.commands).toEqual([
      'npm run test:run -- tests/unit/codex-app-server-capability-retirement.test.js',
      'VIBEPRO_EVIDENCE_ID=brainbase-boundary-cleanup npm run test:e2e -- tests/e2e/story-codex-appserver-thread-session-foundation-contract.spec.ts tests/e2e/story-codex-appserver-session-create-contract.spec.ts',
    ]);
  });

  it('points to ADR-019 and the current Run Receipt boundary while preserving history separately', () => {
    expect(capability.visibility_rules.join('\n')).toContain('Codex app/CLI owns task, thread, worktree, branch, terminal, and process lifecycle under ADR-019.');
    expect(capability.visibility_rules.join('\n')).toContain('Brainbase receives execution evidence through durable Run Receipts under the `run-receipt.inbox` capability; it does not own Codex task or turn execution.');
    expect(capability.history.documents).toEqual(expect.arrayContaining([
      'docs/architecture/codex-app-server-adapter-architecture.md',
      'docs/stories/story-codex-appserver-thread-session-foundation.md',
      'docs/specs/codex-appserver-thread-session-foundation-spec.md',
      'docs/stories/story-codex-appserver-session-create.md',
    ]));
    expect(capability.architecture_decision).toBe('docs/architecture/ADR-019-codex-owns-development-runtime.md');
    expect(capability.current_evidence_capability).toBe('docs/brainbase-capabilities/capabilities/run-receipt.inbox.yml');

    const verificationTargets = capability.verification.commands.flatMap((command) =>
      [...command.matchAll(/(?:^|\s)(tests\/[^\s]+)/g)].map(([, path]) => path),
    );
    const referencedTargets = [
      ...capability.history.documents,
      capability.architecture_decision,
      capability.current_evidence_capability,
      ...verificationTargets,
    ];
    for (const target of referencedTargets) {
      expect(existsSync(target), `missing referenced path: ${target}`).toBe(true);
    }
  });

  it('provides only a live retirement regression command', () => {
    expect(capability.verification.expected).toEqual(expect.arrayContaining([
      'The retired capability remains empty of active surfaces and dependencies.',
    ]));
  });
});
