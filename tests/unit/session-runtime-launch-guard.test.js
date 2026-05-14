import { readFileSync } from 'fs';
import path from 'path';
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
});
