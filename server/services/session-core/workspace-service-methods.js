import fs from 'fs';
import path from 'path';

function isEphemeralTmpPath(candidate) {
    return typeof candidate === 'string'
        && (candidate === '/tmp'
            || candidate === '/tmp/'
            || candidate === '/private/tmp'
            || candidate === '/private/tmp/');
}

export const workspaceServiceMethods = {
    _getStoredWorkspacePath(session) {
        return session?.worktree?.path || session?.path || null;
    },

    _getWorkspaceName(session) {
        if (!session?.id) return null;

        const repoPath = session?.worktree?.repo || null;
        if (repoPath) {
            return `${session.id}-${path.basename(repoPath)}`;
        }

        const storedPath = this._getStoredWorkspacePath(session);
        if (!storedPath) return null;

        const basename = path.basename(storedPath.replace(/\/+$/, ''));
        return basename.startsWith(`${session.id}-`) ? basename : null;
    },

    _getCandidateWorkspacePaths(session) {
        const candidates = [];
        const workspaceName = this._getWorkspaceName(session);
        const repoPath = session?.worktree?.repo || null;

        const pushCandidate = (candidate) => {
            if (!candidate || typeof candidate !== 'string') return;
            if (!candidates.includes(candidate)) {
                candidates.push(candidate);
            }
        };

        pushCandidate(session?.worktree?.path);
        pushCandidate(session?.path);

        if (workspaceName) {
            pushCandidate(path.join(this.worktreeService?.worktreesDir || '', workspaceName));

            const configuredRoot = process.env.BRAINBASE_WORKTREES_DIR;
            if (configuredRoot) {
                pushCandidate(path.join(configuredRoot, workspaceName));
            }

            if (repoPath) {
                pushCandidate(path.join(repoPath, '.worktrees', workspaceName));
            }

            try {
                for (const entry of fs.readdirSync('/Volumes', { withFileTypes: true })) {
                    if (!entry.isDirectory()) continue;
                    pushCandidate(path.join('/Volumes', entry.name, 'brainbase-worktrees', workspaceName));
                }
            } catch {
                // Ignore missing /Volumes or permission issues
            }
        }

        return candidates;
    },

    async _getTmuxCurrentPath(sessionId) {
        if (!sessionId) return null;
        try {
            const { stdout } = await this.execPromise(
                `tmux list-panes -t "${sessionId}" -F "#{pane_current_path}" 2>/dev/null || true`
            );
            const existingPaths = stdout
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean)
                .filter(candidate => fs.existsSync(candidate));
            if (existingPaths.length === 0) return null;

            return existingPaths.find(candidate => !isEphemeralTmpPath(candidate)) || null;
        } catch {
            return null;
        }
    },

    async resolveSessionWorkspacePath(sessionOrId, options = {}) {
        const { persist = true, preferTmux = true, reuseExistingPath = false } = options;
        const state = this.stateStore.get();
        const session = typeof sessionOrId === 'string'
            ? (state.sessions || []).find((item) => item.id === sessionOrId)
            : sessionOrId;

        if (!session) return null;

        // Fast path for hot callers (e.g. terminal ensure on every session switch):
        // the workspace path is persisted to session.path after the first resolve, so
        // when it still points at a real directory we can skip the per-call
        // `tmux list-panes` subprocess + candidate fs scan entirely. Only the
        // already-persisted value is trusted; resolution falls through to the full
        // (tmux-preferring) path when it is missing or stale.
        if (reuseExistingPath && typeof session.path === 'string' && session.path && fs.existsSync(session.path)) {
            return session.path;
        }

        const seen = new Set();
        const orderedCandidates = [];
        const pushOrdered = (candidate) => {
            if (!candidate || seen.has(candidate)) return;
            seen.add(candidate);
            orderedCandidates.push(candidate);
        };

        if (preferTmux) {
            pushOrdered(await this._getTmuxCurrentPath(session.id));
        }

        for (const candidate of this._getCandidateWorkspacePaths(session)) {
            pushOrdered(candidate);
        }

        const resolvedPath = orderedCandidates.find((candidate) => fs.existsSync(candidate)) || null;
        if (resolvedPath && persist) {
            await this._persistResolvedWorkspacePath(session.id, resolvedPath);
        }

        return resolvedPath;
    },

    async reconcileSessionWorkspacePaths() {
        const state = this.stateStore.get();
        const sessions = state.sessions || [];

        for (const session of sessions) {
            if (!session?.id) continue;
            await this.resolveSessionWorkspacePath(session, { persist: true, preferTmux: true });
        }
    }
};
