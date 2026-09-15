import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('root manifest is a private brainbase-unson overlay', () => {
  const manifest = readJson('package.json');
  const lock = readJson('package-lock.json');

  assert.equal(manifest.name, 'brainbase-unson');
  assert.equal(manifest.private, true);
  assert.equal(manifest.repository.url, 'https://github.com/Unson-LLC/brainbase-unson.git');
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.packages[''].name, manifest.name);
});

test('migrated organization client and duplicate workflow are absent', () => {
  for (const path of [
    'packages/organization-client',
    'vitest.organization-client.config.mjs',
    '.github/workflows/organization-client-windows.yml',
    'docs/specs/organization-client-delivery.md',
  ]) {
    assert.equal(existsSync(path), false, `${path} must be owned by brainbase-organization`);
  }
});

test('handoff contract retains NocoDB but forbids direct organization UI access', () => {
  const contract = readFileSync('docs/specs/repository-target-handoff.md', 'utf8');

  assert.match(contract, /既存本番NocoDBは.+証拠が揃うまで削除しない/);
  assert.match(contract, /共通組織UIは.+正規APIだけを利用/);
  assert.match(contract, /NocoDBのURL、token、base\/table IDを受け取らず、直接read\/writeしない/);
});
