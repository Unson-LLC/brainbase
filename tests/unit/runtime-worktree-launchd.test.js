import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const readinessHelper = resolve(root, 'scripts/launchd/brainbase-runtime-readiness.sh');

const versionResponse = (sha, dirty) => JSON.stringify({ runtime: { git: { sha, dirty } } });

function createRuntimeFixture() {
  const sandbox = mkdtempSync(resolve(tmpdir(), 'brainbase-runtime-readiness-'));
  const source = resolve(sandbox, 'source');
  const runtime = resolve(sandbox, 'runtime');
  execFileSync('git', ['init', '-q', source]);
  execFileSync('git', ['-C', source, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', source, 'config', 'user.name', 'Test']);
  writeFileSync(resolve(source, 'fixture.txt'), 'old-runtime\n');
  execFileSync('git', ['-C', source, 'add', 'fixture.txt']);
  execFileSync('git', ['-C', source, 'commit', '-qm', 'old runtime']);
  const oldSha = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  writeFileSync(resolve(source, 'fixture.txt'), 'known-good-runtime\n');
  execFileSync('git', ['-C', source, 'add', 'fixture.txt']);
  execFileSync('git', ['-C', source, 'commit', '-qm', 'known good runtime']);
  const expectedSha = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', source, 'worktree', 'add', '--detach', '--quiet', runtime, expectedSha]);
  return { sandbox, source, runtime, oldSha, expectedSha };
}

function createProbe(sandbox, responses) {
  const bin = resolve(sandbox, 'bin');
  const counter = resolve(sandbox, 'curl.count');
  const responseFile = resolve(sandbox, 'curl.responses');
  mkdirSync(bin);
  writeFileSync(counter, '0\n');
  writeFileSync(responseFile, `${responses.join('\n')}\n`);
  const quote = (value) => JSON.stringify(value);
  const curl = resolve(bin, 'curl');
  writeFileSync(
    curl,
    `#!/bin/bash
set -euo pipefail
count="$(cat ${quote(counter)})"
count=$((count + 1))
printf '%s\\n' "$count" > ${quote(counter)}
response="$(sed -n "\${count}p" ${quote(responseFile)})"
[[ "$response" != "__FAIL__" && -n "$response" ]] || exit 7
printf '%s\\n' "$response"
`,
  );
  chmodSync(curl, 0o755);
  const sleep = resolve(bin, 'sleep');
  writeFileSync(sleep, '#!/bin/bash\nexit 0\n');
  chmodSync(sleep, 0o755);
  return {
    counter,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH || ''}` },
  };
}

function createTimeoutProbe(sandbox, response) {
  const bin = resolve(sandbox, 'timeout-bin');
  const argsFile = resolve(sandbox, 'curl.args');
  mkdirSync(bin);
  const quote = (value) => JSON.stringify(value);
  const curl = resolve(bin, 'curl');
  writeFileSync(
    curl,
    `#!/bin/bash
set -euo pipefail
has_connect_timeout=0
has_max_time=0
for arg in "$@"; do
  [[ "$arg" == "--connect-timeout" ]] && has_connect_timeout=1
  [[ "$arg" == "--max-time" ]] && has_max_time=1
done
printf '%s\n' "$*" > ${quote(argsFile)}
if (( has_connect_timeout != 1 || has_max_time != 1 )); then
  sleep 0.1
  exit 124
fi
printf '%s\n' ${quote(response)}
`,
  );
  chmodSync(curl, 0o755);
  const sleep = resolve(bin, 'sleep');
  writeFileSync(sleep, '#!/bin/bash\nexit 0\n');
  chmodSync(sleep, 0o755);
  return {
    argsFile,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH || ''}` },
  };
}

function runReadiness({ runtime, expectedSha, url, attempts, delay, connectTimeout = '5', maxTimeout = '10', probe }) {
  const command = 'set -euo pipefail; source "$1"; brainbase_wait_for_runtime_ready "$2" "$3" "$4" "$5" "$6" "$7" "$8"';
  return spawnSync(
    'bash',
    [
      '-c',
      command,
      '--',
      readinessHelper,
      runtime,
      expectedSha,
      url,
      String(attempts),
      String(delay),
      String(connectTimeout),
      String(maxTimeout),
    ],
    { encoding: 'utf8', env: probe.env },
  );
}

const probeCount = (probe) => Number(readFileSync(probe.counter, 'utf8').trim());

describe('managed launchd runtime contract', () => {
  it('uses a linked worktree owned by workspace/repos and never the retired clone', () => {
    const start = read('scripts/launchd/brainbase-ui-start.sh');
    expect(start).toContain('/Users/ksato/workspace/repos/brainbase');
    expect(start).toContain('/Users/ksato/workspace/repos/.runtime/brainbase-31013');
    expect(start).toContain('worktree add --force --detach');
    expect(start).not.toContain('/workspace/code/brainbase');
  });

  it('fails when fetch fails and updates only the disposable runtime', () => {
    const start = read('scripts/launchd/brainbase-ui-start.sh');
    const target = read('scripts/launchd/brainbase-runtime-target.sh');
    expect(target).toContain('fetch --quiet "$remote" "$branch:$target_ref"');
    expect(target).toContain('rev-parse --show-toplevel');
    expect(start).toContain('refs/brainbase-runtime/origin-develop');
    expect(start).toContain('git -C "$RUNTIME_ROOT" reset --hard');
    expect(start).toContain('rmdir "$LOCK_DIR"');
    expect(start).toContain('trap - EXIT');
    expect(start).not.toContain('git -C "$SOURCE_REPO" reset');
  });

  it('checks merged develop periodically and restarts only on SHA drift', () => {
    const update = read('scripts/launchd/brainbase-runtime-update.sh');
    const plist = read('config/com.brainbase.runtime-update.plist');
    expect(update).toContain('CURRENT_SHA');
    expect(update).toContain('if [[ "$CURRENT_SHA" != "$TARGET_SHA" ]]');
    expect(update).toContain('launchctl kickstart -k');
    expect(plist).toContain('<integer>60</integer>');
  });

  it('keeps an explicit known-good SHA pinned across launchd restarts and fails closed on invalid roots or pins', () => {
    const helper = resolve(root, 'scripts/launchd/brainbase-runtime-target.sh');
    const sandbox = mkdtempSync(resolve(tmpdir(), 'brainbase-runtime-target-'));
    const repo = resolve(sandbox, 'source');
    const pin = resolve(sandbox, 'runtime.sha');
    try {
      execFileSync('git', ['init', '-q', repo]);
      execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
      execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test']);
      writeFileSync(resolve(repo, 'fixture.txt'), 'known-good\n');
      execFileSync('git', ['-C', repo, 'add', 'fixture.txt']);
      execFileSync('git', ['-C', repo, 'commit', '-qm', 'fixture']);
      const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      writeFileSync(pin, `${sha}\n`);

      const command = `source "$1"; brainbase_resolve_runtime_target "$2" origin develop refs/test "$3"`;
      expect(execFileSync('bash', ['-c', command, '--', helper, repo, pin], { encoding: 'utf8' }).trim()).toBe(sha);

      execFileSync('git', ['-C', repo, 'tag', '-a', 'annotated-runtime', '-m', 'annotated runtime']);
      const annotatedTagSha = execFileSync('git', ['-C', repo, 'rev-parse', 'annotated-runtime'], {
        encoding: 'utf8',
      }).trim();
      writeFileSync(pin, `${annotatedTagSha}\n`);
      expect(spawnSync('bash', ['-c', command, '--', helper, repo, pin]).status).not.toBe(0);

      writeFileSync(pin, 'not-a-sha\n');
      expect(spawnSync('bash', ['-c', command, '--', helper, repo, pin]).status).not.toBe(0);
      rmSync(pin);
      expect(spawnSync('bash', ['-c', command, '--', helper, resolve(sandbox, 'missing'), pin]).status).not.toBe(0);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('polls past a transient probe failure before accepting exact clean runtime readiness', () => {
    const fixture = createRuntimeFixture();
    const probe = createProbe(fixture.sandbox, ['__FAIL__', versionResponse(fixture.expectedSha, false)]);
    try {
      const result = runReadiness({
        runtime: fixture.runtime,
        expectedSha: fixture.expectedSha,
        url: 'http://127.0.0.1:31013/api/version',
        attempts: 3,
        delay: 0,
        probe,
      });
      expect(result.status).toBe(0);
      expect(probeCount(probe)).toBe(2);
    } finally {
      rmSync(fixture.sandbox, { recursive: true, force: true });
    }
  });

  it('rejects an old API SHA and dirty API response before accepting the exact clean SHA', () => {
    const fixture = createRuntimeFixture();
    const probe = createProbe(fixture.sandbox, [
      versionResponse(fixture.oldSha, false),
      versionResponse(fixture.expectedSha, true),
      versionResponse(fixture.expectedSha, false),
    ]);
    try {
      const result = runReadiness({
        runtime: fixture.runtime,
        expectedSha: fixture.expectedSha,
        url: 'http://127.0.0.1:31013/api/version',
        attempts: 3,
        delay: 0,
        probe,
      });
      expect(result.status).toBe(0);
      expect(probeCount(probe)).toBe(3);
    } finally {
      rmSync(fixture.sandbox, { recursive: true, force: true });
    }
  });

  it('rejects runtime worktree HEAD mismatch and tracked or untracked dirtiness', () => {
    const fixture = createRuntimeFixture();
    const probe = createProbe(fixture.sandbox, Array.from({ length: 6 }, () => versionResponse(fixture.expectedSha, false)));
    try {
      execFileSync('git', ['-C', fixture.runtime, 'checkout', '--detach', '--quiet', fixture.oldSha]);
      const mismatched = runReadiness({
        runtime: fixture.runtime,
        expectedSha: fixture.expectedSha,
        url: 'http://127.0.0.1:31013/api/version',
        attempts: 2,
        delay: 0,
        probe,
      });
      expect(mismatched.status).not.toBe(0);
      expect(`${mismatched.stdout}\n${mismatched.stderr}`).toMatch(/HEAD|runtime worktree/i);

      execFileSync('git', ['-C', fixture.runtime, 'checkout', '--detach', '--quiet', fixture.expectedSha]);
      writeFileSync(resolve(fixture.runtime, 'fixture.txt'), 'dirty-runtime\n');
      const dirty = runReadiness({
        runtime: fixture.runtime,
        expectedSha: fixture.expectedSha,
        url: 'http://127.0.0.1:31013/api/version',
        attempts: 2,
        delay: 0,
        probe,
      });
      expect(dirty.status).not.toBe(0);
      expect(`${dirty.stdout}\n${dirty.stderr}`).toMatch(/dirty|worktree/i);

      execFileSync('git', ['-C', fixture.runtime, 'checkout', '--detach', '--quiet', '--force', fixture.expectedSha]);
      writeFileSync(resolve(fixture.runtime, 'untracked.txt'), 'untracked-runtime\n');
      const untracked = runReadiness({
        runtime: fixture.runtime,
        expectedSha: fixture.expectedSha,
        url: 'http://127.0.0.1:31013/api/version',
        attempts: 2,
        delay: 0,
        probe,
      });
      expect(untracked.status).not.toBe(0);
      expect(`${untracked.stdout}\n${untracked.stderr}`).toMatch(/dirty|worktree/i);
    } finally {
      rmSync(fixture.sandbox, { recursive: true, force: true });
    }
  });

  it('returns a non-zero timeout after the bounded readiness attempts are exhausted', () => {
    const fixture = createRuntimeFixture();
    const probe = createProbe(fixture.sandbox, ['__FAIL__', '__FAIL__', '__FAIL__']);
    try {
      const result = runReadiness({
        runtime: fixture.runtime,
        expectedSha: fixture.expectedSha,
        url: 'http://127.0.0.1:31013/api/version',
        attempts: 3,
        delay: 0,
        probe,
      });
      expect(result.status).not.toBe(0);
      expect(probeCount(probe)).toBe(3);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/timed out|timeout/i);
    } finally {
      rmSync(fixture.sandbox, { recursive: true, force: true });
    }
  });

  it('passes finite connect and total timeout flags to a potentially hanging local API probe', () => {
    const fixture = createRuntimeFixture();
    const probe = createTimeoutProbe(fixture.sandbox, versionResponse(fixture.expectedSha, false));
    try {
      const result = runReadiness({
        runtime: fixture.runtime,
        expectedSha: fixture.expectedSha,
        url: 'http://127.0.0.1:31013/api/version',
        attempts: 1,
        delay: 0,
        connectTimeout: '0.05',
        maxTimeout: '0.2',
        probe,
      });
      expect(result.status).toBe(0);
      const args = readFileSync(probe.argsFile, 'utf8');
      expect(args).toContain('--connect-timeout');
      expect(args).toContain('--max-time');
      expect(args).toContain('0.05');
      expect(args).toContain('0.2');
    } finally {
      rmSync(fixture.sandbox, { recursive: true, force: true });
    }
  });

  it('returns non-zero within the configured maximum time when the API accepts a connection but never responds', async () => {
    const fixture = createRuntimeFixture();
    const server = createServer(() => {});
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected an ephemeral TCP port');
    }

    try {
      const startedAt = performance.now();
      const result = runReadiness({
        runtime: fixture.runtime,
        expectedSha: fixture.expectedSha,
        url: `http://127.0.0.1:${address.port}/api/version`,
        attempts: 1,
        delay: 0,
        connectTimeout: '0.1',
        maxTimeout: '0.2',
        probe: { env: process.env },
      });
      const elapsedMs = performance.now() - startedAt;

      expect(result.status).not.toBe(0);
      expect(elapsedMs).toBeLessThan(2_000);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/unavailable|timed out/i);
    } finally {
      server.close();
      await once(server, 'close');
      rmSync(fixture.sandbox, { recursive: true, force: true });
    }
  });

  it('rejects missing, zero, and non-finite probe timeout values before invoking curl', () => {
    const fixture = createRuntimeFixture();
    const probe = createProbe(fixture.sandbox, [versionResponse(fixture.expectedSha, false)]);
    try {
      for (const timeout of [
        { connectTimeout: '', maxTimeout: '10' },
        { connectTimeout: '0', maxTimeout: '10' },
        { connectTimeout: 'NaN', maxTimeout: '10' },
        { connectTimeout: '5', maxTimeout: '0' },
        { connectTimeout: '5', maxTimeout: 'Infinity' },
      ]) {
        const result = runReadiness({
          runtime: fixture.runtime,
          expectedSha: fixture.expectedSha,
          url: 'http://127.0.0.1:31013/api/version',
          attempts: 1,
          delay: 0,
          ...timeout,
          probe,
        });
        expect(result.status).not.toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toMatch(/timeout|finite positive/i);
      }
      expect(probeCount(probe)).toBe(0);
    } finally {
      rmSync(fixture.sandbox, { recursive: true, force: true });
    }
  });

  it('requires finite curl timeouts on every rollback readiness surface', () => {
    const helper = read('scripts/launchd/brainbase-runtime-readiness.sh');
    const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
    const restartRunbook = read('docs/brainbase-capabilities/runbooks/restart-31013-launchd.md');
    const rollback = runbook.slice(runbook.indexOf('### Rollback'));
    const remoteProbe = rollback.slice(rollback.indexOf("<<'REMOTE'"), rollback.indexOf('REMOTE\nTARGET_SHA'));
    const publicProbe = rollback.slice(rollback.indexOf('PUBLIC_ATTEMPTS'), rollback.indexOf('# 3. Restore'));

    expect(helper).toContain('--connect-timeout');
    expect(helper).toContain('--max-time');
    expect(remoteProbe).toContain('--connect-timeout');
    expect(remoteProbe).toContain('--max-time');
    expect(publicProbe).toContain('--connect-timeout');
    expect(publicProbe).toContain('--max-time');
    expect(rollback).toContain('BRAINBASE_LIGHTSAIL_READINESS_CONNECT_TIMEOUT_SECONDS');
    expect(rollback).toContain('BRAINBASE_LIGHTSAIL_READINESS_MAX_TIMEOUT_SECONDS');
    expect(restartRunbook).toContain('BRAINBASE_RUNTIME_READINESS_CONNECT_TIMEOUT_SECONDS');
    expect(restartRunbook).toContain('BRAINBASE_RUNTIME_READINESS_MAX_TIMEOUT_SECONDS');
  });

  it('runs UI and MCP from the exact same runtime checkout', () => {
    const start = read('scripts/launchd/brainbase-ui-start.sh');
    expect(start).toContain('brainbase_resolve_runtime_target');
    expect(start).toContain('brainbase-runtime-pinned.sha');
    expect(read('scripts/launchd/brainbase-runtime-update.sh')).toContain('brainbase_resolve_runtime_target');
    expect(start).toContain('npm --prefix "$RUNTIME_ROOT/mcp/brainbase" ci --ignore-scripts');
    expect(read('scripts/reconcile-brainbase-mcp-runtime.sh')).toContain('MCP_RUNTIME="${BRAINBASE_MCP_RUNTIME_ROOT:-$UI_RUNTIME}"');
    expect(read('config/com.brainbase.mcp-brainbase.plist')).toContain('/Users/ksato/workspace/repos/.runtime/brainbase-31013');
    const install = read('scripts/install-brainbase-runtime-launchd.sh');
    expect(install).toContain('plutil -replace ProgramArguments -json');
    expect(install).toContain('plutil -replace EnvironmentVariables.BRAINBASE_REPO_ROOT');
    expect(install).toContain('wait_until_unloaded');
    expect(install).toContain('launchctl bootstrap "$DOMAIN" "$MCP_PLIST"');
  });

  it('does not let installable runtime configuration revive the retired clone', () => {
    const runtimeFiles = [
      'config/com.brainbase.mcp-brainbase.plist',
      'config/com.brainbase.mcp-nocodb.plist',
      'config/com.brainbase.mcp-slack-unson.plist',
      'config/com.brainbase.mcp-slack-salestailor.plist',
      'config/com.brainbase.mcp-slack-techknight.plist',
      'config/com.brainbase.mcp-slack-t0882t8n9uh.plist',
      'config/com.brainbase.mcp-slack-t0882t8n9uh-upload.plist',
      'config/com.brainbase.sns-feedback-metrics-poller.plist',
      'config/com.brainbase.sns-scheduled-publisher.plist',
      'scripts/run-nocodb-mcp.sh',
      'scripts/ai-session-adapter/codex-envelope-builder.mjs',
    ];

    for (const path of runtimeFiles) {
      expect(read(path), path).not.toContain('/Users/ksato/workspace/code/brainbase');
    }
  });
});
