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

test('Unson production overlay owns its domain and deployment coordinates without secrets', () => {
  const env = readFileSync('infra/brainbase-organization/production.env.example', 'utf8');
  const runbook = readFileSync('docs/runbooks/deploy-brainbase-organization-web.md', 'utf8');

  assert.match(env, /^ORGANIZATION_WEB_HOST=bb-app\.unson\.jp$/m);
  assert.match(env, /^ORGANIZATION_ID=unson$/m);
  assert.match(env, /^ORGANIZATION_DISPLAY_NAME=雲孫$/m);
  assert.match(
    env,
    /^ORGANIZATION_DIRECTORY_JSON=\[{"organization_id":"unson","display_name":"雲孫","app_origin":"https:\/\/bb-app\.unson\.jp"}\]$/m,
  );
  assert.match(env, /^BRAINBASE_API_URL=https:\/\/bb\.unson\.jp$/m);
  assert.match(env, /^PROXY_NETWORK=ubuntu_nocodb-network$/m);
  assert.match(env, /^BRAINBASE_SERVICE_TOKEN_FILE_HOST=\/etc\/brainbase-organization\/brainbase-service-token$/m);
  assert.doesNotMatch(env, /BRAINBASE_ORGANIZATION_SERVICE_TOKEN=/);
  assert.match(runbook, /176\.34\.20\.239/);
  assert.match(runbook, /正本APIだけへ接続し、NocoDBへ直接接続しない/);
  assert.match(runbook, /メールアドレスのドメインや送信元IPでは制限しない/);
  assert.match(runbook, /SlackワークスペースのURLや未確定の候補ドメインは載せない/);
  assert.match(runbook, /BRAINBASE_AUTH_ALLOWED_ORIGINS=https:\/\/bb-app\.unson\.jp/);
});
