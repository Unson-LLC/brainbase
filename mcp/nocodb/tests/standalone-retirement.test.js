import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(packageRoot, '../..');
const launcher = join(repositoryRoot, 'scripts/run-nocodb-mcp.sh');
const mcpConfig = join(repositoryRoot, '.mcp.json');
const plist = join(repositoryRoot, 'config/com.brainbase.mcp-nocodb.plist');

execFileSync('npm', ['run', 'build'], { cwd: packageRoot, stdio: 'pipe' });

test('standalone NocoDB registration and launchd template are retired', () => {
  const config = JSON.parse(readFileSync(mcpConfig, 'utf8'));

  assert.equal(config.mcpServers.nocodb, undefined);
  assert.equal(existsSync(plist), false);
  assert.equal(existsSync(join(packageRoot, 'src/canonical-task-write-guard.ts')), true);
  assert.equal(existsSync(join(packageRoot, 'src/nocodb-client.ts')), true);
});

test('retired launcher exits before Infisical or npx can run', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'nocodb-mcp-retired-'));
  const marker = join(sandbox, 'invoked');
  const infisical = join(sandbox, 'infisical');
  const npx = join(sandbox, 'npx');
  const markerScript = `#!/bin/sh\nprintf '%s\\n' invoked > "$RETIREMENT_MARKER"\n`;

  writeFileSync(infisical, markerScript);
  writeFileSync(npx, markerScript);
  chmodSync(infisical, 0o755);
  chmodSync(npx, 0o755);

  try {
    const result = spawnSync('bash', [launcher], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: sandbox,
        RETIREMENT_MARKER: marker,
        INFISICAL_BIN: infisical,
        NOCODB_MCP_NPX: npx,
        NOCODB_MCP_INFISICAL_AUTH_FILE: join(sandbox, 'missing.env'),
        INFISICAL_TOKEN: 'must-not-be-used',
      },
    });

    assert.equal(result.status, 78, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /NOCODB_MCP_RETIRED/);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('retired entry exits before reading NocoDB settings or opening a transport', () => {
  const entry = join(packageRoot, 'build/index.js');
  const result = spawnSync('node', [entry], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NOCODB_URL: 'http://127.0.0.1:9/should-not-connect',
      NOCODB_TOKEN: 'must-not-be-read',
      MCP_HTTP_PORT: '9',
    },
  });

  assert.equal(result.status, 78, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /NOCODB_MCP_RETIRED/);
  assert.doesNotMatch(result.stderr, /must-not-be-read/);
});
