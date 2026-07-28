import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('infisical-target-run', () => {
  it('pins the project and config directory even when cwd has a hostile Infisical config', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'infisical-wrapper-'));
    const hostileRoot = path.join(tempRoot, 'hostile');
    const nestedCwd = path.join(hostileRoot, 'nested');
    const fakeBin = path.join(tempRoot, 'infisical');
    const captureFile = path.join(tempRoot, 'args.txt');

    fs.mkdirSync(nestedCwd, { recursive: true });
    fs.writeFileSync(
      path.join(hostileRoot, '.infisical.json'),
      JSON.stringify({ workspaceId: 'wrong-project-from-parent' }),
    );
    fs.writeFileSync(fakeBin, '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE_FILE"\n');
    fs.chmodSync(fakeBin, 0o700);

    execFileSync(
      path.join(repoRoot, 'scripts', 'infisical-target-run.sh'),
      ['--target', 'brainbase-mcp', '--', 'true'],
      {
        cwd: nestedCwd,
        env: {
          ...process.env,
          BRAINBASE_REPO_ROOT: repoRoot,
          CAPTURE_FILE: captureFile,
          INFISICAL_BIN: fakeBin,
          INFISICAL_TOKEN: 'non-secret-test-token',
        },
      },
    );

    const args = fs.readFileSync(captureFile, 'utf8').trim().split('\n');
    const target = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'config', 'infisical-targets.json'), 'utf8'),
    ).targets['brainbase-mcp'];

    expect(args).toContain(`--projectId=${target.projectId}`);
    expect(args).toContain('--project-config-dir');
    expect(args).toContain(path.join(repoRoot, 'config'));
    expect(args).not.toContain(hostileRoot);
    expect(args).not.toContain('wrong-project-from-parent');
  });
});
