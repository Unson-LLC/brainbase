import { describe, expect, it, vi } from 'vitest';

import {
    CANONICAL_TASK_GUARDED_PATHS,
    createCanonicalTaskSourceHeadGuard
} from '../../../server/services/companion/canonical-task-source-head-guard.js';

describe('createCanonicalTaskSourceHeadGuard', () => {
    it('allows rebind when no guarded canonical task path changed between heads', async () => {
        const execFile = vi.fn(async () => ({ stdout: '\n' }));
        const guard = createCanonicalTaskSourceHeadGuard({ repoDir: '/repo', execFile });

        await expect(guard({ fromHead: 'old-head', toHead: 'new-head' })).resolves.toMatchObject({
            allowed: true,
            changedPaths: []
        });
        expect(execFile).toHaveBeenCalledWith('git', [
            '-C', '/repo',
            'diff', '--name-only',
            'old-head..new-head',
            '--', ...CANONICAL_TASK_GUARDED_PATHS
        ]);
    });

    it('refuses rebind when a guarded canonical task path changed', async () => {
        const execFile = vi.fn(async () => ({
            stdout: 'server/services/companion/canonical-task-service.js\n'
        }));
        const guard = createCanonicalTaskSourceHeadGuard({ repoDir: '/repo', execFile });

        await expect(guard({ fromHead: 'old-head', toHead: 'new-head' })).resolves.toMatchObject({
            allowed: false,
            reason: 'canonical_task_paths_changed',
            changedPaths: ['server/services/companion/canonical-task-service.js']
        });
    });

    it('fails closed when the diff cannot be computed', async () => {
        const execFile = vi.fn(async () => {
            throw new Error('fatal: bad object old-head');
        });
        const guard = createCanonicalTaskSourceHeadGuard({ repoDir: '/repo', execFile });

        await expect(guard({ fromHead: 'old-head', toHead: 'new-head' })).resolves.toMatchObject({
            allowed: false,
            reason: 'source_head_diff_failed'
        });
    });

    it('fails closed when a head or the repo dir is missing', async () => {
        const execFile = vi.fn();
        const guard = createCanonicalTaskSourceHeadGuard({ repoDir: '/repo', execFile });

        await expect(guard({ fromHead: null, toHead: 'new-head' })).resolves.toMatchObject({
            allowed: false,
            reason: 'source_head_guard_head_missing'
        });
        await expect(createCanonicalTaskSourceHeadGuard({ execFile })({
            fromHead: 'a', toHead: 'b'
        })).resolves.toMatchObject({ allowed: false, reason: 'source_head_guard_repo_missing' });
        expect(execFile).not.toHaveBeenCalled();
    });

    it('allows identical heads without running git', async () => {
        const execFile = vi.fn();
        const guard = createCanonicalTaskSourceHeadGuard({ repoDir: '/repo', execFile });

        await expect(guard({ fromHead: 'same', toHead: 'same' })).resolves.toMatchObject({ allowed: true });
        expect(execFile).not.toHaveBeenCalled();
    });
});
