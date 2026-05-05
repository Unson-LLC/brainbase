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

    describe('_publishMarkdownRecord (archive-records direct push)', () => {
        let session;
        let execCalls;
        let execPromise;

        beforeEach(() => {
            session = {
                id: 'session-XYZ',
                name: 'Test Session',
                project: 'brainbase',
                engine: 'claude',
                createdAt: '2026-04-01T00:00:00.000Z',
                worktree: { repo: '/repo', path: '/wt', startCommit: 'abc' }
            };
            execCalls = [];
        });

        function makeService(execImpl) {
            execPromise = vi.fn(async (cmd) => {
                execCalls.push(cmd);
                return execImpl(cmd, execCalls.length);
            });
            const svc = new ArchiveFinalizerService({
                stateStore: createStateStore([]),
                worktreeService: { getStatus: vi.fn(), merge: vi.fn(), remove: vi.fn() },
                execPromise,
                repoRoot: '/repo',
                now: () => new Date('2026-05-06T00:00:00.000Z')
            });
            return svc;
        }

        it('archive-records branchが既に存在する場合_fetch経由でcheckoutしてpushする', async () => {
            const svc = makeService((cmd) => {
                if (cmd.includes('remote get-url origin')) return { stdout: 'git@github.com:o/r.git\n' };
                if (cmd.includes('--branch \'archive-records\'')) return { stdout: '' };
                return { stdout: '' };
            });

            const result = await svc._publishMarkdownRecord(session);

            expect(result.recordPath).toMatch(/^docs\/session-archives\/2026\/05\/session-XYZ\.md$/);
            expect(result.recordPrUrl).toBeNull();
            expect(result.branchName).toBe('archive-records');

            const joined = execCalls.join('\n');
            expect(joined).not.toMatch(/gh pr create/);
            expect(joined).not.toMatch(/gh pr merge/);
            expect(joined).toMatch(/git clone --depth 1 --branch 'archive-records'/);
            expect(joined).toMatch(/git -C .+ add .+session-XYZ\.md/);
            expect(joined).toMatch(/git -C .+ commit -m 'docs\(session\): archive session-XYZ'/);
            expect(joined).toMatch(/git -C .+ push origin 'archive-records'/);
        });

        it('archive-records branchが存在しない場合_orphanで初期化してpushする', async () => {
            const svc = makeService((cmd) => {
                if (cmd.includes('remote get-url origin')) return { stdout: 'git@github.com:o/r.git\n' };
                if (cmd.includes('--branch \'archive-records\'')) {
                    throw new Error("Remote branch 'archive-records' not found in upstream origin");
                }
                return { stdout: '' };
            });

            const result = await svc._publishMarkdownRecord(session);

            expect(result.recordPrUrl).toBeNull();
            expect(result.branchName).toBe('archive-records');

            const joined = execCalls.join('\n');
            expect(joined).toMatch(/git clone --depth 1 --branch 'archive-records'/);
            expect(joined).toMatch(/checkout --orphan 'archive-records'/);
            expect(joined).toMatch(/git -C .+ rm -rf \./);
            expect(joined).toMatch(/git -C .+ push origin 'archive-records'/);
            expect(joined).not.toMatch(/gh pr create/);
        });

        it('push競合時_fetch+reset+recommitで再試行する', async () => {
            let pushAttempts = 0;
            const svc = makeService((cmd) => {
                if (cmd.includes('remote get-url origin')) return { stdout: 'git@github.com:o/r.git\n' };
                if (cmd.includes('push origin')) {
                    pushAttempts += 1;
                    if (pushAttempts === 1) {
                        throw new Error('error: failed to push some refs (non-fast-forward)');
                    }
                }
                return { stdout: '' };
            });

            const result = await svc._publishMarkdownRecord(session);

            expect(result.recordPrUrl).toBeNull();
            expect(pushAttempts).toBe(2);
            const joined = execCalls.join('\n');
            expect(joined).toMatch(/git -C .+ fetch origin 'archive-records'/);
            expect(joined).toMatch(/git -C .+ reset --hard 'origin\/archive-records'/);
            expect(joined).not.toMatch(/gh pr create/);
        });

        it('_mergeArchiveRecordPrとisBaseModifiedPrErrorは削除されている', async () => {
            const svc = makeService(() => ({ stdout: '' }));
            expect(svc._mergeArchiveRecordPr).toBeUndefined();
        });
    });
});
