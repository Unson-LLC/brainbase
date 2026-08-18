import { readFileSync } from 'node:fs';
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
    expect(start).toContain('fetch --quiet "$REMOTE" "$BRANCH" || fail');
    expect(start).toContain('git -C "$RUNTIME_ROOT" reset --hard');
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

  it('runs UI and MCP from the exact same runtime checkout', () => {
    expect(read('scripts/reconcile-brainbase-mcp-runtime.sh')).toContain('MCP_RUNTIME="${BRAINBASE_MCP_RUNTIME_ROOT:-$UI_RUNTIME}"');
    expect(read('config/com.brainbase.mcp-brainbase.plist')).toContain('/Users/ksato/workspace/repos/.runtime/brainbase-31013');
    const install = read('scripts/install-brainbase-runtime-launchd.sh');
    expect(install).toContain('plutil -replace ProgramArguments.1');
    expect(install).toContain('plutil -replace EnvironmentVariables.BRAINBASE_REPO_ROOT');
    expect(install).toContain('launchctl bootstrap "$DOMAIN" "$MCP_PLIST"');
  });
});
