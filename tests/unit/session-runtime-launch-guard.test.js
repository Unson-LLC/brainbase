import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('session runtime launch guard', () => {
  it('ensure_session_runtimeはworkspace pathなしでtmuxを作らない', () => {
    const script = readFileSync(path.join(repoRoot, 'scripts/ensure_session_runtime.sh'), 'utf8');

    expect(script).toContain('session state missing worktree.path/path');
    expect(script).toContain('exit 74');
    expect(script).toContain('tmux new-session -d -s "$SESSION_NAME" -c "$WORKTREE_PATH"');
    expect(script).toContain('tmux cwd preflight failed');
    expect(script).toContain('_CWD_TARGET="$WORKTREE_PATH"');
    expect(script).not.toContain('_CWD_TARGET="${WORKTREE_PATH:-/tmp}"');
  });

  it('login_scriptもworkspace pathなしでtmuxを作らない', () => {
    const script = readFileSync(path.join(repoRoot, 'scripts/login_script.sh'), 'utf8');

    expect(script).toContain('tmux has-session -t "$SESSION_NAME"');
    expect(script).toContain("EXISTING_TMUX_CWD=\"$(tmux display-message -p -t \"$SESSION_NAME\" '#{pane_current_path}'");
    expect(script).toContain('session state missing worktree.path/path');
    expect(script).toContain('exit 74');
    expect(script).toContain('tmux new-session -d -s "$SESSION_NAME" -c "$WORKTREE_PATH"');
    expect(script).toContain('tmux cwd preflight failed');
  });

  it('runtime lifecycleは明示cwdを起動scriptへ渡す', () => {
    const source = readFileSync(path.join(repoRoot, 'server/services/session-runtime/runtime-lifecycle-methods.js'), 'utf8');
    const matches = source.match(/spawnOptions\.env\.BRAINBASE_RUNTIME_CWD = cwd/g) || [];

    expect(matches).toHaveLength(2);
    expect(source).toContain("'-m', '4'");
  });

  it('Codex起動前にworktreeをtrusted projectへ登録する', () => {
    const ensureRuntime = readFileSync(path.join(repoRoot, 'scripts/ensure_session_runtime.sh'), 'utf8');
    const loginScript = readFileSync(path.join(repoRoot, 'scripts/login_script.sh'), 'utf8');

    expect(ensureRuntime).toContain('source "$SCRIPT_DIR/lib/brainbase-common.sh"');
    expect(ensureRuntime).toContain('ensure_codex_workspace_trusted "$WORKTREE_PATH"');
    expect(loginScript).toContain('source "$SCRIPT_DIR/lib/brainbase-common.sh"');
    expect(loginScript).toContain('ensure_codex_workspace_trusted "$WORKTREE_PATH"');
  });

  it('ensure_codex_workspace_trustedはconfig.tomlへ一度だけtrusted entryを追記する', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'brainbase-codex-trust-'));
    const workspacePath = path.join(tempRoot, 'session-worktree');
    mkdirSync(workspacePath);

    try {
      const script = [
        `source ${JSON.stringify(path.join(repoRoot, 'scripts/lib/brainbase-common.sh'))}`,
        `export HOME=${JSON.stringify(tempRoot)}`,
        `ensure_codex_workspace_trusted ${JSON.stringify(workspacePath)}`,
        `ensure_codex_workspace_trusted ${JSON.stringify(workspacePath)}`,
        `cat ${JSON.stringify(path.join(tempRoot, '.codex/config.toml'))}`,
      ].join('\n');

      const output = execFileSync('bash', ['-lc', script], {
        cwd: repoRoot,
        encoding: 'utf8',
      });

      const header = `[projects."${realpathSync(workspacePath)}"]`;
      const matches = output.match(new RegExp(header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || [];
      expect(matches).toHaveLength(1);
      expect(output).toContain('trust_level = "trusted"');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
