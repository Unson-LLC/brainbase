import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('npm prepublication evidence', () => {
  it('binds production audit, tarball hashes, and registry absence to the clean current HEAD', () => {
    const root = process.cwd();
    const output = execFileSync(process.execPath, ['scripts/npm-prepublication-evidence.mjs'], {
      cwd: root,
      encoding: 'utf8'
    });
    const evidence = JSON.parse(output);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim();
    const { name, version } = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
      name: string;
      version: string;
    };

    expect(evidence).toMatchObject({
      status: 'pass',
      head_sha: head,
      package: `${name}@${version}`,
      production_dependency_audit: { vulnerabilities: 0 },
      registry: { target_version_absent: true, evidence: 'E404' }
    });
    expect(evidence.tarball.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(evidence.tarball.sha512).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/u);
    expect(evidence.tarball.npm_integrity).toBe(evidence.tarball.sha512);
    expect(evidence.tarball.npm_shasum).toMatch(/^[a-f0-9]{40}$/u);
  }, 120_000);
});
