import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

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
