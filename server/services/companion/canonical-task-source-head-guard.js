import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFileCb);

// Paths whose changes can alter Canonical Task mutation semantics.
// A deploy that touches none of these between the blessed source_head and the
// running HEAD is safe to auto-rebind; anything else stays fail-closed.
export const CANONICAL_TASK_GUARDED_PATHS = [
    'server/services/companion/',
    'server/sql/',
    'server/bootstrap/core-services.js',
    'config/canonical-task-store.json'
];

export function createCanonicalTaskSourceHeadGuard({
    repoDir,
    guardedPaths = CANONICAL_TASK_GUARDED_PATHS,
    execFile = execFileAsync
} = {}) {
    return async function canRebindSourceHead({ fromHead, toHead } = {}) {
        if (!repoDir) return { allowed: false, reason: 'source_head_guard_repo_missing' };
        if (!fromHead || !toHead) return { allowed: false, reason: 'source_head_guard_head_missing' };
        if (fromHead === toHead) return { allowed: true, changedPaths: [] };
        try {
            const { stdout } = await execFile('git', [
                '-C', repoDir,
                'diff', '--name-only',
                `${fromHead}..${toHead}`,
                '--', ...guardedPaths
            ]);
            const changedPaths = String(stdout).split('\n').map(line => line.trim()).filter(Boolean);
            if (changedPaths.length > 0) {
                return { allowed: false, reason: 'canonical_task_paths_changed', changedPaths };
            }
            return { allowed: true, changedPaths: [] };
        } catch (error) {
            // Unknown commits (shallow clone, rewritten history) must stay fail-closed.
            return { allowed: false, reason: 'source_head_diff_failed', error: error?.message || String(error) };
        }
    };
}
