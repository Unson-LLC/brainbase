import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { win32 as winPath } from 'node:path';
import test from 'node:test';
import { runCodex } from '../../packages/organization-client/src/codex.mjs';

import {
  authenticate,
  readToken,
  runClaude,
} from '../../packages/organization-client/src/index.mjs';

const WINDOWS_ONLY = process.platform !== 'win32';

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test('Windows stores token and temporary MCP config with a restricted ACL, then cleans the secret', {
  skip: WINDOWS_ONLY,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'organization-client 日本語 space-'));
  const tokenFile = join(root, 'tokens.json');
  const helperFile = join(root, 'child-helper.mjs');
  const outputFile = join(root, 'child-output.txt');
  const config = {
    organization_id: 'org_windows_fixture',
    api_url: 'https://api.fixture.example',
    mcp_url: 'https://mcp.fixture.example/mcp',
    token_file: tokenFile,
  };

  writeFileSync(helperFile, [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "const configIndex = process.argv.indexOf('--mcp-config');",
    "const outputIndex = process.argv.indexOf('--smoke-output');",
    "if (configIndex < 0 || outputIndex < 0) process.exit(2);",
    "const mcp = JSON.parse(readFileSync(process.argv[configIndex + 1], 'utf8'));",
    "const auth = mcp.mcpServers.brainbase.headers.Authorization;",
    "if (auth !== 'Bearer windows-access-secret') process.exit(3);",
    "writeFileSync(process.argv[outputIndex + 1], 'ok');",
  ].join('\n'));

  const responses = [
    jsonResponse({
      device_code: 'windows-device-code',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://auth.fixture.example/device',
      expires_in: 30,
      interval: 1,
    }),
    jsonResponse({
      access_token: 'windows-access-secret',
      refresh_token: 'windows-refresh-secret',
      expires_in: 3600,
    }),
  ];
  const originalLog = console.log;
  console.log = () => {};
  try {
    await authenticate(config, {
      fetchImpl: async () => responses.shift(),
      sleep: async () => {},
      now: () => 1_700_000_000_000,
      randomBytes: () => randomBytes(32),
      spawnSyncImpl: (command, args, options) => {
        const result = spawnSync(command, args, options);
        // This test uses fixture tokens only. Security commands contain paths
        // and ACLs, never the token payload; retain their output on CI failure.
        process.stderr.write(JSON.stringify({ command, args, status: result.status,
          stdout: result.stdout, stderr: result.stderr, error: result.error?.code }) + '\n');
        return result;
      },
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(readToken(config).access_token, 'windows-access-secret');
  let temporaryConfigPath;
  const spawnImpl = (command, args, options) => {
    assert.equal(options.shell, false);
    assert.equal(command, process.execPath);
    temporaryConfigPath = args[args.indexOf('--mcp-config') + 1];

    const icacls = spawnSync(
      winPath.join(process.env.SystemRoot, 'System32', 'icacls.exe'),
      [temporaryConfigPath],
      { encoding: 'utf8', shell: false, windowsHide: true },
    );
    assert.equal(icacls.status, 0, icacls.stderr || icacls.stdout);
    assert.doesNotMatch(`${icacls.stdout}\n${icacls.stderr}`, /\(I\)|Everyone|Authenticated Users/i);
    return spawn(command, args, options);
  };

  const result = await runClaude(config, ['--smoke-output', outputFile], {
    now: () => 1_700_000_000_000,
    resolveClaudeImpl: () => ({ command: process.execPath, argsPrefix: [helperFile] }),
    spawnImpl,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(readFileSync(outputFile, 'utf8'), 'ok');
  assert.equal(existsSync(temporaryConfigPath), false);
  const codexResult = await runCodex(config, [], {
    now: () => 1_700_000_000_000,
    resolveCodexImpl: () => process.execPath,
    spawnImpl: (command, args, options) => {
      assert.equal(options.shell, false);
      assert.doesNotMatch(args.join(' '), /windows-access-secret/);
      assert.match(args.join(' '), /mcp_servers=/);
      return spawn(command, ['-e', 'process.exit(process.env.ORGANIZATION_CLIENT_ACCESS_TOKEN === "windows-access-secret" ? 0 : 1)'], options);
    },
  });
  assert.equal(codexResult.exitCode, 0);
  assert.equal(readToken(config).access_token, 'windows-access-secret');
  const broadened = spawnSync(
    winPath.join(process.env.SystemRoot, 'System32', 'icacls.exe'),
    [tokenFile, '/grant', '*S-1-1-0:R'],
    { encoding: 'utf8', shell: false, windowsHide: true },
  );
  assert.equal(broadened.status, 0);
  assert.throws(() => readToken(config), /unapproved principal/);
  rmSync(root, { recursive: true, force: true });
});
