#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim();
}

const packageManifest = JSON.parse(readFileSync('package.json', 'utf8'));
const packageVersion = `${packageManifest.name}@${packageManifest.version}`;
const headBefore = run('git', ['rev-parse', 'HEAD']);
const worktreeBefore = run('git', ['status', '--porcelain']);
if (worktreeBefore !== '') {
  throw new Error('Prepublication evidence requires a clean worktree');
}

const audit = JSON.parse(run('npm', ['audit', '--json']));
if (audit.metadata?.vulnerabilities?.total !== 0) {
  throw new Error('Production dependency audit reported vulnerabilities');
}

const packDirectory = mkdtempSync(path.join(tmpdir(), 'brainbase-npm-pack-'));
try {
  const [pack] = JSON.parse(run('npm', ['pack', '--pack-destination', packDirectory, '--json']));
  const tarballPath = path.join(packDirectory, pack.filename);
  const bytes = readFileSync(tarballPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  if (pack.integrity !== `sha512-${sha512}`) {
    throw new Error('npm pack integrity does not match the generated tarball');
  }

  const registry = spawnSync('npm', ['view', packageVersion, 'version', '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const registryOutput = `${registry.stdout ?? ''}\n${registry.stderr ?? ''}`;
  if (registry.status === 0 || !registryOutput.includes('E404')) {
    throw new Error('Target npm version is not proven absent');
  }

  const headAfter = run('git', ['rev-parse', 'HEAD']);
  const worktreeAfter = run('git', ['status', '--porcelain']);
  if (headAfter !== headBefore || worktreeAfter !== '') {
    throw new Error('Repository changed while prepublication evidence was collected');
  }

  process.stdout.write(`${JSON.stringify({
    status: 'pass',
    head_sha: headBefore,
    package: packageVersion,
    production_dependency_audit: { vulnerabilities: 0 },
    tarball: {
      filename: pack.filename,
      sha256,
      sha512: `sha512-${sha512}`,
      npm_integrity: pack.integrity,
      npm_shasum: pack.shasum
    },
    registry: { target_version_absent: true, evidence: 'E404' }
  }, null, 2)}\n`);
} finally {
  rmSync(packDirectory, { recursive: true, force: true });
}
