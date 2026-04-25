import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArchiveFinalizerService } from '../../../server/services/archive-finalizer-service.js';

function createStateStore(initialSessions) {
    const state = { sessions: initialSessions };
    return {
        get: vi.fn(() => state),
        patchSession: vi.fn(async (sessionId, patch) => {
            state.sessions = state.sessions.map((session) => {
                if (session.id !== sessionId) return session;
                const computedPatch = typeof patch === 'function' ? patch(session) : patch;
                const next = { ...session, ...computedPatch };
                for (const [key, value] of Object.entries(computedPatch || {})) {
                    if (value === undefined) delete next[key];
                }
                return next;
            });
            return state;
        }),
        mutateSessions: vi.fn(async (mutator) => {
            state.sessions = await mutator([...state.sessions], state);
            return state;
        })
    };
}

describe('ArchiveFinalizerService', () => {
    let stateStore;
    let worktreeService;
    let recordPublisher;
    let service;

    beforeEach(() => {
        worktreeService = {
            getStatus: vi.fn(),
            merge: vi.fn(),
            remove: vi.fn()
        };
        recordPublisher = vi.fn(async () => ({
            recordPath: 'docs/session-archives/2026/04/session-1.md',
            recordPrUrl: 'https://github.com/Unson-LLC/brainbase/pull/100'
        }));
    });

    function buildService(sessions) {
        stateStore = createStateStore(sessions);
        service = new ArchiveFinalizerService({
            stateStore,
            worktreeService,
            recordPublisher,
            now: () => new Date('2026-04-25T00:00:00.000Z')
        });
        return service;
    }

    it('finalize呼び出し時_worktreeなしセッションは記録後cleanedになる', async () => {
        buildService([
            { id: 'session-1', name: 'No diff', intendedState: 'archived', archive: { status: 'queued' } }
        ]);

        const result = await service.finalize('session-1');

        expect(result.success).toBe(true);
        expect(recordPublisher).toHaveBeenCalled();
        expect(stateStore.get().sessions[0].archive.status).toBe('cleaned');
        expect(stateStore.get().sessions[0].archive.recordPath).toBe('docs/session-archives/2026/04/session-1.md');
    });

    it('dirty working copy は統合も削除もせずblockedにする', async () => {
        buildService([
            {
                id: 'session-1',
                name: 'Dirty',
                intendedState: 'archived',
                archive: { status: 'queued' },
                worktree: { repo: '/repo', path: '/worktree', startCommit: 'abc123' }
            }
        ]);
        worktreeService.getStatus.mockResolvedValue({
            hasWorkingCopyChanges: true,
            changesNotPushed: 0,
            needsMerge: true
        });

        const result = await service.finalize('session-1');

        expect(result.success).toBe(false);
        expect(result.status).toBe('blocked');
        expect(worktreeService.merge).not.toHaveBeenCalled();
        expect(worktreeService.remove).not.toHaveBeenCalled();
        expect(stateStore.get().sessions[0].archive.status).toBe('blocked');
        expect(stateStore.get().sessions[0].archive.blockerReason).toContain('working copy');
        expect(stateStore.get().sessions[0].worktree).toBeTruthy();
    });

    it('未マージcommitがあるclean sessionはmerge後cleanedにする', async () => {
        buildService([
            {
                id: 'session-1',
                name: 'Needs merge',
                intendedState: 'archived',
                archive: { status: 'queued' },
                worktree: { repo: '/repo', path: '/worktree', startCommit: 'abc123' }
            }
        ]);
        worktreeService.getStatus.mockResolvedValue({
            hasWorkingCopyChanges: false,
            changesNotPushed: 0,
            needsMerge: true
        });
        worktreeService.merge.mockResolvedValue({
            success: true,
            prUrl: 'https://github.com/Unson-LLC/brainbase/pull/101',
            mergedAt: '2026-04-25T01:00:00.000Z'
        });

        const result = await service.finalize('session-1');

        expect(result.success).toBe(true);
        expect(worktreeService.merge).toHaveBeenCalledWith('session-1', '/repo', 'Needs merge');
        const session = stateStore.get().sessions[0];
        expect(session.archive.status).toBe('cleaned');
        expect(session.merged).toBe(true);
        expect(session.mergedPrUrl).toBe('https://github.com/Unson-LLC/brainbase/pull/101');
        expect(session.worktree).toBeUndefined();
    });

    it('既に統合済みのworktreeはremove後cleanedにする', async () => {
        buildService([
            {
                id: 'session-1',
                name: 'Already merged',
                intendedState: 'archived',
                archive: { status: 'queued' },
                worktree: { repo: '/repo', path: '/worktree' }
            }
        ]);
        worktreeService.getStatus.mockResolvedValue({
            hasWorkingCopyChanges: false,
            changesNotPushed: 0,
            needsMerge: false
        });
        worktreeService.remove.mockResolvedValue(true);

        const result = await service.finalize('session-1');

        expect(result.success).toBe(true);
        expect(worktreeService.remove).toHaveBeenCalledWith('session-1', '/repo');
        expect(stateStore.get().sessions[0].archive.status).toBe('cleaned');
        expect(stateStore.get().sessions[0].worktree).toBeUndefined();
    });

    it('drainQueued呼び出し時_recordingなどの途中状態も再開する', async () => {
        buildService([
            { id: 'session-recording', name: 'Recording', intendedState: 'archived', archive: { status: 'recording' } },
            { id: 'session-blocked', name: 'Blocked', intendedState: 'archived', archive: { status: 'blocked' } }
        ]);
        const finalizeSpy = vi.spyOn(service, 'finalize').mockResolvedValue({ success: true });

        await service.drainQueued();

        expect(finalizeSpy).toHaveBeenCalledWith('session-recording');
        expect(finalizeSpy).not.toHaveBeenCalledWith('session-blocked');
    });

    it('archive record PR mergeがbase更新で失敗した場合_rebaseして再試行する', async () => {
        buildService([]);
        const execPromise = vi.fn()
            .mockRejectedValueOnce(new Error('GraphQL: Base branch was modified. Review and try the merge again.'))
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' });
        service.execPromise = execPromise;

        const warning = await service._mergeArchiveRecordPr('/tmp/archive', 'https://github.com/o/r/pull/1', 'main');

        expect(warning).toBeNull();
        expect(execPromise).toHaveBeenNthCalledWith(
            1,
            "cd '/tmp/archive' && gh pr merge 'https://github.com/o/r/pull/1' --merge --delete-branch"
        );
        expect(execPromise).toHaveBeenNthCalledWith(2, "cd '/tmp/archive' && git fetch origin 'main'");
        expect(execPromise).toHaveBeenNthCalledWith(3, "cd '/tmp/archive' && git rebase 'origin/main'");
        expect(execPromise).toHaveBeenNthCalledWith(4, "cd '/tmp/archive' && git push --force-with-lease");
        expect(execPromise).toHaveBeenNthCalledWith(
            5,
            "cd '/tmp/archive' && gh pr merge 'https://github.com/o/r/pull/1' --merge --delete-branch"
        );
    });
});
