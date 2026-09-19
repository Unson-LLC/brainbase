import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const readinessHelper = resolve(root, 'scripts/launchd/brainbase-runtime-readiness.sh');
const reconcileScript = resolve(root, 'scripts/reconcile-brainbase-mcp-runtime.sh');

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

function createReconcileRuntimeFixture() {
  const sandbox = mkdtempSync(resolve(tmpdir(), 'brainbase-mcp-reconcile-runtime-'));
  const source = resolve(sandbox, 'source');
  const runtime = resolve(sandbox, 'runtime');
  mkdirSync(resolve(source, 'scripts'), { recursive: true });
  mkdirSync(resolve(source, 'mcp/brainbase'), { recursive: true });
  execFileSync('git', ['init', '-q', source]);
  execFileSync('git', ['-C', source, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', source, 'config', 'user.name', 'Test']);
  const mcpLauncher = resolve(source, 'scripts/run-brainbase-mcp.sh');
  writeFileSync(mcpLauncher, '#!/bin/bash\nexit 0\n');
  chmodSync(mcpLauncher, 0o755);
  writeFileSync(resolve(source, 'mcp/brainbase/package.json'), '{"name":"fixture-mcp"}\n');
  writeFileSync(resolve(source, 'fixture.txt'), 'old target\n');
  execFileSync('git', ['-C', source, 'add', 'scripts/run-brainbase-mcp.sh', 'mcp/brainbase/package.json', 'fixture.txt']);
  execFileSync('git', ['-C', source, 'commit', '-qm', 'old reconcile target']);
  const oldSha = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  writeFileSync(resolve(source, 'fixture.txt'), 'latest target\n');
  execFileSync('git', ['-C', source, 'add', 'fixture.txt']);
  execFileSync('git', ['-C', source, 'commit', '-qm', 'latest reconcile target']);
  const expectedSha = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', source, 'worktree', 'add', '--detach', '--quiet', runtime, expectedSha]);
  return { sandbox, runtime, oldSha, expectedSha };
}

function createProbe(sandbox, responses, { onSleepScript = '' } = {}) {
  const bin = resolve(sandbox, 'bin');
  const counter = resolve(sandbox, 'curl.count');
  const responseFile = resolve(sandbox, 'curl.responses');
  const sleepCounter = resolve(sandbox, 'sleep.count');
  mkdirSync(bin);
  writeFileSync(counter, '0\n');
  writeFileSync(sleepCounter, '0\n');
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
  writeFileSync(
    sleep,
    `#!/bin/bash
set -euo pipefail
count="$(cat ${quote(sleepCounter)})"
count=$((count + 1))
printf '%s\\n' "$count" > ${quote(sleepCounter)}
${onSleepScript}
exit 0
`,
  );
  chmodSync(sleep, 0o755);
  return {
    counter,
    sleepCounter,
    responseFile,
    bin,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH || ''}` },
  };
}

function configureSuccessfulReconcile({ sandbox, runtime, targetSha, previousSha, probe, runtimeLock = '' }) {
  const receipt = resolve(sandbox, 'reconcile.receipt');
  const mvMarker = resolve(sandbox, 'receipt-mv.called');
  const runtimeLockProcessingMarker = resolve(sandbox, 'runtime-lock.processing');
  const runtimeLockReceiptMarker = resolve(sandbox, 'runtime-lock.receipt');
  const quote = (value) => JSON.stringify(value);
  const npm = resolve(probe.bin, 'npm');
  writeFileSync(npm, '#!/bin/bash\nexit 0\n');
  chmodSync(npm, 0o755);
  const launchctl = resolve(probe.bin, 'launchctl');
  writeFileSync(
    launchctl,
    `#!/bin/bash
set -euo pipefail
if [[ "$1" == "print" ]]; then printf "state = running\\n"; exit 0; fi
if [[ "$1" == "kickstart" ]]; then
${runtimeLock ? `  [[ -d ${quote(runtimeLock)} ]] || exit 95
  printf 'held\\n' > ${quote(runtimeLockProcessingMarker)}
` : ''}  exit 0
fi
exit 2
`,
  );
  chmodSync(launchctl, 0o755);
  const mv = resolve(probe.bin, 'mv');
  writeFileSync(
    mv,
    `#!/bin/bash
set -euo pipefail
[[ "$#" -eq 4 && "$1" == "-f" && "$2" == "--" && "$4" == ${quote(receipt)} ]] || exit 90
tmp="$3"
[[ "$(dirname "$tmp")" == "$(dirname ${quote(receipt)})" ]] || exit 91
[[ -f ${quote(receipt)} ]] || exit 92
grep -Fxq ${quote(`sha=${previousSha}`)} ${quote(receipt)} || exit 93
grep -Fxq ${quote(`sha=${targetSha}`)} "$tmp" || exit 94
${runtimeLock ? `[[ -d ${quote(runtimeLock)} ]] || exit 95
printf 'held\\n' > ${quote(runtimeLockReceiptMarker)}
` : ''}
printf 'called\\n' > ${quote(mvMarker)}
exec /bin/mv "$@"
`,
  );
  chmodSync(mv, 0o755);
  return {
    ...probe,
    receipt,
    mvMarker,
    runtimeLockProcessingMarker,
    runtimeLockReceiptMarker,
    env: {
      ...probe.env,
      BRAINBASE_UI_RUNTIME_ROOT: runtime,
      BRAINBASE_MCP_RUNTIME_ROOT: runtime,
      BRAINBASE_MCP_LAUNCHD_LABEL: 'test.mcp',
      BRAINBASE_CHATGPT_TUNNEL_LAUNCHD_LABEL: 'test.chatgpt-tunnel',
    },
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

function runReconcile({ sandbox, targetSha = 'a'.repeat(40), probe, extraEnv = {} }) {
  return spawnSync('bash', [reconcileScript, targetSha], {
    encoding: 'utf8',
    env: {
      ...probe.env,
      BRAINBASE_MCP_RECONCILE_LOCK: resolve(sandbox, 'reconcile.lock'),
      BRAINBASE_MCP_RECONCILE_RECEIPT: resolve(sandbox, 'reconcile.receipt'),
      BRAINBASE_RUNTIME_LOCK: resolve(sandbox, 'runtime-update.lock'),
      BRAINBASE_MCP_RECONCILE_WAIT_ATTEMPTS: '1',
      BRAINBASE_MCP_RECONCILE_LOCK_WAIT_SECONDS: '1',
      BRAINBASE_RUNTIME_LOCK_WAIT_SECONDS: '1',
      ...extraEnv,
    },
  });
}

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
    expect(plist).toContain('<key>BRAINBASE_UI_RUNTIME_ROOT</key><string>__RUNTIME_ROOT__</string>');
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
    expect(runbook).toMatch(/CAPTURE_CONNECT_TIMEOUT_SECONDS[\s\S]*curl -fsS \\\n\s+--connect-timeout "\$CAPTURE_CONNECT_TIMEOUT_SECONDS" \\\n\s+--max-time "\$CAPTURE_MAX_TIMEOUT_SECONDS"/);
    expect(rollback).toMatch(/curl -fsS \\\n\s+--connect-timeout "\$LIGHTSAIL_CONNECT_TIMEOUT_SECONDS" \\\n\s+--max-time "\$LIGHTSAIL_MAX_TIMEOUT_SECONDS" \\\n\s+-o \/dev\/null/);
    expect(restartRunbook).toContain('BRAINBASE_RUNTIME_READINESS_CONNECT_TIMEOUT_SECONDS');
    expect(restartRunbook).toContain('BRAINBASE_RUNTIME_READINESS_MAX_TIMEOUT_SECONDS');
    expect(restartRunbook).toMatch(/## Verify[\s\S]*curl -fsS \\\n\s+--connect-timeout "\$CONNECT_TIMEOUT_SECONDS" \\\n\s+--max-time "\$MAX_TIMEOUT_SECONDS"/);
  });

  it('bounds the MCP reconcile UI probe with finite positive curl timeouts', () => {
    const sandbox = mkdtempSync(resolve(tmpdir(), 'brainbase-mcp-reconcile-timeout-'));
    const probe = createTimeoutProbe(sandbox, versionResponse('b'.repeat(40), false));
    try {
      const result = runReconcile({
        sandbox,
        probe,
        extraEnv: {
          BRAINBASE_MCP_RECONCILE_CONNECT_TIMEOUT_SECONDS: '0.05',
          BRAINBASE_MCP_RECONCILE_MAX_TIMEOUT_SECONDS: '0.2',
        },
      });
      expect(result.status).not.toBe(0);
      const args = readFileSync(probe.argsFile, 'utf8');
      expect(args).toContain('--connect-timeout 0.05');
      expect(args).toContain('--max-time 0.2');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('fails closed before probing and preserves the last successful receipt when MCP reconcile timeout is non-finite', () => {
    const sandbox = mkdtempSync(resolve(tmpdir(), 'brainbase-mcp-reconcile-invalid-timeout-'));
    const probe = createProbe(sandbox, [versionResponse('a'.repeat(40), false)]);
    const receipt = resolve(sandbox, 'reconcile.receipt');
    const previousReceipt = `sha=${'b'.repeat(40)}\ncompleted_at=2026-09-19T15:53:07Z\nchatgpt_tunnel=running\n`;
    writeFileSync(receipt, previousReceipt);
    try {
      const result = runReconcile({
        sandbox,
        probe,
        extraEnv: { BRAINBASE_MCP_RECONCILE_MAX_TIMEOUT_SECONDS: 'Infinity' },
      });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/timeout|finite positive/i);
      expect(probeCount(probe)).toBe(0);
      expect(readFileSync(receipt, 'utf8')).toBe(previousReceipt);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('waits boundedly for a live MCP lock owner and preserves the last successful receipt', () => {
    const sandbox = mkdtempSync(resolve(tmpdir(), 'brainbase-mcp-reconcile-lock-'));
    const probe = createProbe(sandbox, [versionResponse('a'.repeat(40), false)]);
    const receipt = resolve(sandbox, 'reconcile.receipt');
    const lockFile = resolve(sandbox, 'reconcile.lock');
    const previousReceipt = `sha=${'b'.repeat(40)}\ncompleted_at=2026-09-19T15:53:07Z\nchatgpt_tunnel=running\n`;
    writeFileSync(receipt, previousReceipt);
    writeFileSync(lockFile, `${process.pid}\n`);
    try {
      const result = runReconcile({
        sandbox,
        probe,
        extraEnv: { BRAINBASE_MCP_RECONCILE_LOCK_WAIT_SECONDS: '2' },
      });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/already running/i);
      expect(Number(readFileSync(probe.sleepCounter, 'utf8').trim())).toBe(2);
      expect(probeCount(probe)).toBe(0);
      expect(readFileSync(receipt, 'utf8')).toBe(previousReceipt);
      expect(readFileSync(lockFile, 'utf8')).toBe(`${process.pid}\n`);
      expect(existsSync(lockFile)).toBe(true);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('waits for the UI runtime lock, holds it through the receipt commit, then releases it', () => {
    const fixture = createReconcileRuntimeFixture();
    const previousSha = 'b'.repeat(40);
    const runtimeLock = resolve(fixture.sandbox, 'runtime-update.lock');
    const contendedMarker = resolve(fixture.sandbox, 'runtime-lock.contended');
    mkdirSync(runtimeLock);
    const quote = (value) => JSON.stringify(value);
    const rawProbe = createProbe(fixture.sandbox, [versionResponse(fixture.expectedSha, false)], {
      onSleepScript: `
if [[ "$count" == "1" ]]; then
  [[ -d ${quote(runtimeLock)} ]] && printf 'contended\\n' > ${quote(contendedMarker)}
  rmdir ${quote(runtimeLock)}
fi
`,
    });
    const probe = configureSuccessfulReconcile({
      sandbox: fixture.sandbox,
      runtime: fixture.runtime,
      targetSha: fixture.expectedSha,
      previousSha,
      probe: rawProbe,
      runtimeLock,
    });
    writeFileSync(
      probe.receipt,
      `sha=${previousSha}\ncompleted_at=2026-09-19T15:53:07Z\nchatgpt_tunnel=running\n`,
    );
    try {
      const result = runReconcile({ sandbox: fixture.sandbox, targetSha: fixture.expectedSha, probe });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(existsSync(contendedMarker)).toBe(true);
      expect(existsSync(probe.runtimeLockProcessingMarker)).toBe(true);
      expect(existsSync(probe.runtimeLockReceiptMarker)).toBe(true);
      expect(existsSync(probe.mvMarker)).toBe(true);
      expect(readFileSync(probe.receipt, 'utf8')).toMatch(new RegExp(`^sha=${fixture.expectedSha}$`, 'm'));
      expect(existsSync(runtimeLock)).toBe(false);
    } finally {
      rmSync(fixture.sandbox, { recursive: true, force: true });
    }
  });

  it('runs a single reconciliation and atomically replaces the prior receipt on success', () => {
    const fixture = createReconcileRuntimeFixture();
    const previousSha = 'b'.repeat(40);
    const probe = configureSuccessfulReconcile({
      sandbox: fixture.sandbox,
      runtime: fixture.runtime,
      targetSha: fixture.expectedSha,
      previousSha,
      probe: createProbe(fixture.sandbox, [versionResponse(fixture.expectedSha, false)]),
    });
    writeFileSync(
      probe.receipt,
      `sha=${previousSha}\ncompleted_at=2026-09-19T15:53:07Z\nchatgpt_tunnel=running\n`,
    );
    try {
      const result = runReconcile({ sandbox: fixture.sandbox, targetSha: fixture.expectedSha, probe });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(existsSync(probe.mvMarker)).toBe(true);
      const receipt = readFileSync(probe.receipt, 'utf8');
      expect(receipt).toMatch(new RegExp(`^sha=${fixture.expectedSha}$`, 'm'));
      expect(receipt).toMatch(/^completed_at=\S+$/m);
      expect(receipt).toContain('chatgpt_tunnel=running\n');
      expect(readdirSync(fixture.sandbox).filter((name) => name.startsWith('reconcile.receipt.tmp.'))).toEqual([]);
      expect(existsSync(resolve(fixture.sandbox, 'reconcile.lock'))).toBe(false);
    } finally {
      rmSync(fixture.sandbox, { recursive: true, force: true });
    }
  });

  it('waits for the lock, then converges on the current UI API and checkout SHA', () => {
    const fixture = createReconcileRuntimeFixture();
    const previousSha = 'b'.repeat(40);
    const lockFile = resolve(fixture.sandbox, 'reconcile.lock');
    const quote = (value) => JSON.stringify(value);
    execFileSync('git', ['-C', fixture.runtime, 'checkout', '--detach', '--quiet', fixture.oldSha]);
    const rawProbe = createProbe(fixture.sandbox, [
      versionResponse(fixture.oldSha, false),
      versionResponse(fixture.oldSha, false),
    ], {
      onSleepScript: `
if [[ "$count" == "1" ]]; then
  git -C ${quote(fixture.runtime)} checkout --detach --quiet ${quote(fixture.expectedSha)}
  rm -f -- ${quote(lockFile)}
elif [[ "$count" == "2" ]]; then
  temp="$(mktemp ${quote(`${resolve(fixture.sandbox, 'curl.responses')}.test.XXXXXX`)})"
  printf '%s\\n%s\\n' ${quote(versionResponse(fixture.oldSha, false))} ${quote(versionResponse(fixture.expectedSha, false))} > "$temp"
  /bin/mv -f -- "$temp" ${quote(resolve(fixture.sandbox, 'curl.responses'))}
fi
`,
    });
    const probe = configureSuccessfulReconcile({
      sandbox: fixture.sandbox,
      runtime: fixture.runtime,
      targetSha: fixture.expectedSha,
      previousSha,
      probe: rawProbe,
    });
    writeFileSync(
      probe.receipt,
      `sha=${previousSha}\ncompleted_at=2026-09-19T15:53:07Z\nchatgpt_tunnel=running\n`,
    );
    writeFileSync(lockFile, `${process.pid}\n`);
    try {
      const result = runReconcile({
        sandbox: fixture.sandbox,
        targetSha: fixture.oldSha,
        probe,
        extraEnv: {
          BRAINBASE_MCP_RECONCILE_LOCK_WAIT_SECONDS: '3',
          BRAINBASE_MCP_RECONCILE_WAIT_ATTEMPTS: '3',
        },
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(probeCount(probe)).toBe(2);
      expect(Number(readFileSync(probe.sleepCounter, 'utf8').trim())).toBe(2);
      expect(execFileSync('git', ['-C', fixture.runtime, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(fixture.expectedSha);
      expect(readFileSync(probe.responseFile, 'utf8')).toBe(`${versionResponse(fixture.oldSha, false)}\n${versionResponse(fixture.expectedSha, false)}\n`);
      expect(result.stderr).toContain(`requested SHA ${fixture.oldSha.slice(0, 12)}`);
      expect(result.stderr).toContain(`UI API and checkout agree on ${fixture.expectedSha.slice(0, 12)}`);
      expect(existsSync(probe.mvMarker)).toBe(true);
      expect(readFileSync(probe.receipt, 'utf8')).toMatch(new RegExp(`^sha=${fixture.expectedSha}$`, 'm'));
      expect(existsSync(lockFile)).toBe(false);
    } finally {
      rmSync(fixture.sandbox, { recursive: true, force: true });
    }
  });

  it('recovers a stale PID lock with shlock without disturbing its last successful receipt', () => {
    const fixture = createReconcileRuntimeFixture();
    const previousSha = 'b'.repeat(40);
    const lockFile = resolve(fixture.sandbox, 'reconcile.lock');
    const probe = configureSuccessfulReconcile({
      sandbox: fixture.sandbox,
      runtime: fixture.runtime,
      targetSha: fixture.expectedSha,
      previousSha,
      probe: createProbe(fixture.sandbox, [versionResponse(fixture.expectedSha, false)]),
    });
    writeFileSync(
      probe.receipt,
      `sha=${previousSha}\ncompleted_at=2026-09-19T15:53:07Z\nchatgpt_tunnel=running\n`,
    );
    const staleOwnerPidFile = resolve(fixture.sandbox, 'stale-owner.pid');
    execFileSync('bash', ['-c', 'printf "%s\\n" "$$" > "$1"', '--', staleOwnerPidFile]);
    const staleOwnerPid = readFileSync(staleOwnerPidFile, 'utf8').trim();
    expect(staleOwnerPid).toMatch(/^\d+$/);
    writeFileSync(lockFile, `${staleOwnerPid}\n`);
    const sleepStub = resolve(probe.bin, 'sleep');
    writeFileSync(sleepStub, '#!/bin/bash\nexec /bin/sleep "$@"\n');
    chmodSync(sleepStub, 0o755);
    try {
      const result = runReconcile({
        sandbox: fixture.sandbox,
        targetSha: fixture.expectedSha,
        probe,
        extraEnv: { BRAINBASE_MCP_RECONCILE_LOCK_WAIT_SECONDS: '3' },
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(probeCount(probe)).toBe(1);
      expect(readFileSync(probe.receipt, 'utf8')).toMatch(new RegExp(`^sha=${fixture.expectedSha}$`, 'm'));
      expect(existsSync(lockFile)).toBe(false);
    } finally {
      rmSync(fixture.sandbox, { recursive: true, force: true });
    }
  }, 10_000);

  it('runs UI and MCP from the exact same runtime checkout', () => {
    const start = read('scripts/launchd/brainbase-ui-start.sh');
    expect(start).toContain('brainbase_resolve_runtime_target');
    expect(start).toContain('brainbase-runtime-pinned.sha');
    expect(read('scripts/launchd/brainbase-runtime-update.sh')).toContain('brainbase_resolve_runtime_target');
    expect(start).toContain('npm --prefix "$RUNTIME_ROOT/mcp/brainbase" ci --ignore-scripts');
    expect(start).toContain('BRAINBASE_MCP_RECONCILE_LOG');
    expect(start).toContain('>> "$RECONCILE_LOG" 2>&1');
    expect(start).not.toMatch(/reconcile-brainbase-mcp-runtime\.sh[^\n]*\&\)[^\n]*\/dev\/null/);
    expect(read('scripts/reconcile-brainbase-mcp-runtime.sh')).toContain('MCP_RUNTIME="${BRAINBASE_MCP_RUNTIME_ROOT:-$UI_RUNTIME}"');
    expect(read('scripts/reconcile-brainbase-mcp-runtime.sh')).toContain('BRAINBASE_MCP_RECONCILE_LAUNCHD_WAIT_ATTEMPTS:-60');
    expect(read('scripts/reconcile-brainbase-mcp-runtime.sh')).toContain('attempt <= LAUNCHD_WAIT_ATTEMPTS');
    expect(read('scripts/reconcile-brainbase-mcp-runtime.sh')).not.toMatch(/launchctl print[^\n]+\| grep -q/);
    expect(read('config/com.brainbase.mcp-brainbase.plist')).toContain('/Users/ksato/workspace/repos/.runtime/brainbase-31013');
    const install = read('scripts/install-brainbase-runtime-launchd.sh');
    expect(install).toContain('plutil -replace ProgramArguments -json');
    expect(install).toContain('plutil -replace EnvironmentVariables.BRAINBASE_REPO_ROOT');
    expect(install).toContain('plutil -replace EnvironmentVariables.BRAINBASE_UI_RUNTIME_ROOT -string "$RUNTIME_ROOT"');
    expect(install).toContain('plutil -insert EnvironmentVariables.BRAINBASE_UI_RUNTIME_ROOT -string "$RUNTIME_ROOT" "$UI_PLIST"');
    expect(install).toContain('wait_until_unloaded');
    expect(install).toContain('launchctl bootout "$DOMAIN/com.brainbase.ui"');
    expect(install).toContain('launchctl bootstrap "$DOMAIN" "$UI_PLIST"');
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
      'scripts/run-nocodb-mcp.sh',
      'scripts/ai-session-adapter/codex-envelope-builder.mjs',
    ];

    for (const path of runtimeFiles) {
      expect(read(path), path).not.toContain('/Users/ksato/workspace/code/brainbase');
    }
    for (const path of [
      'config/com.brainbase.sns-feedback-metrics-poller.plist',
      'config/com.brainbase.sns-scheduled-publisher.plist',
    ]) {
      expect(existsSync(resolve(root, path)), path).toBe(false);
    }
  });
});
