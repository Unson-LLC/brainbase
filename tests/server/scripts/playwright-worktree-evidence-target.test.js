import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve('@playwright/test/cli');
const playwrightNodeModules = resolve(dirname(playwrightCli), '../..');
const canonicalEvidenceTarget = 'tests/e2e/story-companion-canonical-task-provider-contract.spec.ts';
const evidenceEnvironmentKeys = [
  'VIBEPRO_EVIDENCE_ID',
  'VIBEPRO_EVIDENCE_RESULT',
  'VIBEPRO_EVIDENCE_NONCE',
];

function listFixtureTarget({ configPath, cwd, evidenceId }) {
  const environment = { ...process.env, FORCE_COLOR: '0' };
  for (const key of evidenceEnvironmentKeys) delete environment[key];
  if (evidenceId !== undefined) {
    environment.VIBEPRO_EVIDENCE_ID = evidenceId;
    environment.VIBEPRO_EVIDENCE_RESULT = '.vibepro/verification/canonical-task-cutover/runner/test.json';
    environment.VIBEPRO_EVIDENCE_NONCE = 'a'.repeat(64);
  }

  try {
    const output = execFileSync(process.execPath, [
      playwrightCli,
      'test',
      canonicalEvidenceTarget,
      '--grep',
      'SC-001',
      '--list',
      `--config=${configPath}`,
    ], { cwd, encoding: 'utf8', env: environment });
    return { output, status: 0 };
  } catch (error) {
    return {
      output: [error.stdout, error.stderr].filter(Boolean).join('\n'),
      status: error.status,
    };
  }
}

describe('Playwright worktree discovery boundary', () => {
  it('collects only the exact registered target from a worktree fixture', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'brainbase-evidence-worktree-'));
    const worktreeRoot = join(fixtureRoot, '.worktrees', 'collector');
    const canonicalSpec = join(worktreeRoot, canonicalEvidenceTarget);
    const nestedDuplicate = join(
      worktreeRoot,
      '.worktrees',
      'duplicate',
      canonicalEvidenceTarget,
    );
    const configPath = join(worktreeRoot, 'playwright.config.js');
    const registryPath = join(worktreeRoot, 'config/canonical-task-evidence-registry.json');

    try {
      mkdirSync(dirname(canonicalSpec), { recursive: true });
      mkdirSync(dirname(nestedDuplicate), { recursive: true });
      mkdirSync(dirname(registryPath), { recursive: true });
      symlinkSync(playwrightNodeModules, join(worktreeRoot, 'node_modules'), 'dir');
      writeFileSync(join(worktreeRoot, 'package.json'), '{"type":"module"}\n');
      writeFileSync(configPath, readFileSync(join(repoRoot, 'playwright.config.js')));
      writeFileSync(
        registryPath,
        readFileSync(join(repoRoot, 'config/canonical-task-evidence-registry.json')),
      );
      writeFileSync(
        canonicalSpec,
        "import { test } from '@playwright/test';\n"
          + "test('scenario.SC-001 canonical fixture', async () => {});\n",
      );
      writeFileSync(nestedDuplicate, "throw new Error('NESTED_DUPLICATE_WAS_IMPORTED');\n");

      const ordinaryDiscovery = listFixtureTarget({ configPath, cwd: worktreeRoot });
      expect(ordinaryDiscovery.output).toMatch(/Total:\s+0 tests/);

      const unregisteredEvidence = listFixtureTarget({
        configPath,
        cwd: worktreeRoot,
        evidenceId: 'scenario.SC-999',
      });
      expect(unregisteredEvidence.output).toMatch(/Total:\s+0 tests/);

      const evidenceCollection = listFixtureTarget({
        configPath,
        cwd: worktreeRoot,
        evidenceId: 'scenario.SC-001',
      });
      expect(evidenceCollection.status, evidenceCollection.output).toBe(0);
      expect(evidenceCollection.output).toMatch(/scenario\.SC-001 canonical fixture/);
      expect(evidenceCollection.output).toMatch(/Total:\s+1 test/);
      expect(evidenceCollection.output).not.toContain('NESTED_DUPLICATE_WAS_IMPORTED');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }, 180_000);
});
