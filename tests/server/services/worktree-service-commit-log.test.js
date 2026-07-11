import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorktreeService } from '../../../server/services/worktree-service.js';

describe('WorktreeService.getCommitLog', () => {
    let service;
    let mockExec;

    beforeEach(() => {
        mockExec = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', mockExec);
    });

    it('workspaceが存在しない場合_空のコミットリストが返される', async () => {
        const result = await service.getCommitLog('session-1', '/tmp/repo', 50);

        expect(result.commits).toEqual([]);
        expect(result.repoType).toBe('unknown');
    });

    it('gitリポジトリの場合_gitログがパースされる', async () => {
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockResolvedValueOnce(undefined);

        const gitOutput = [
            'abc1234\x00feat: add panel\x002026-02-16T10:30:00+09:00\x00ksato\x00HEAD -> main\x00',
            'def9876\x00fix: bug\x002026-02-16T10:00:00+09:00\x00ksato\x00\x00'
        ].join('\n');

        mockExec
            .mockResolvedValueOnce({ stdout: 'https://github.com/example/test-repo.git\n' })
            .mockResolvedValueOnce({ stdout: gitOutput });

        const result = await service.getCommitLog('session-1', '/tmp/repo', 50);

        expect(result.repoType).toBe('git');
        expect(result.repoName).toBe('test-repo');
        expect(result.commits).toHaveLength(2);
        expect(result.commits[0].hash).toBe('abc1234');
        expect(result.commits[0].description).toBe('feat: add panel');
        expect(result.commits[0].isWorkingCopy).toBe(true); // first commit marked as WC
        expect(result.commits[1].isWorkingCopy).toBe(false);
    });
});

describe('WorktreeService._parseGitLog', () => {
    let service;

    beforeEach(() => {
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', vi.fn());
    });

    it('空文字列の場合_空配列が返される', () => {
        expect(service._parseGitLog('')).toEqual([]);
        expect(service._parseGitLog(null)).toEqual([]);
    });

    it('正常なgitログ出力がパースされる', () => {
        const stdout = 'abc1234\x00feat: test\x002026-02-16T10:00:00+09:00\x00ksato\x00HEAD -> main, origin/main\x00\n';
        const result = service._parseGitLog(stdout);

        expect(result).toHaveLength(1);
        expect(result[0].hash).toBe('abc1234');
        expect(result[0].description).toBe('feat: test');
        expect(result[0].bookmarks).toContain('HEAD -> main');
    });

    it('descriptionが空の場合_(empty)が設定される', () => {
        const stdout = 'abc1234\x00\x002026-02-16T10:00:00\x00ksato\x00\x00\x00\n';
        const result = service._parseGitLog(stdout);

        expect(result[0].description).toBe('(empty)');
    });
});

describe('WorktreeService.getStatus', () => {
    let service;
    let mockExec;

    beforeEach(() => {
        mockExec = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', mockExec);
    });

    it('未マージcommitがある場合_cleanでもneedsMergeを返す', async () => {
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([
            { name: 'session/session-1', pushed: true, output: 'session/session-1@origin' }
        ]);
        vi.spyOn(service, '_countCommitsAheadOfBase').mockResolvedValue(2);
        vi.spyOn(service, '_hasWorkingCopyConflicts').mockResolvedValue(false);

        mockExec
            .mockResolvedValueOnce({ stdout: 'develop\n' }) // _getMainBranchName
            .mockResolvedValueOnce({ stdout: '0\n' })        // rev-list --count (changesNotPushed)
            .mockResolvedValueOnce({ stdout: '' });          // status --porcelain (clean)

        const result = await service.getStatus('session-1', '/tmp/repo', 'abc123');

        expect(result.changesNotPushed).toBe(0);
        expect(result.hasWorkingCopyChanges).toBe(false);
        expect(result.needsIntegration).toBe(false);
        expect(result.needsMerge).toBe(true);
        expect(result.hasConflicts).toBe(false);
        expect(result.commitsAheadOfBase).toBe(2);
        expect(service._hasWorkingCopyConflicts).toHaveBeenCalledWith('/tmp/worktrees/session-1-repo');
        expect(mockExec).toHaveBeenNthCalledWith(2, 'git -C "/tmp/worktrees/session-1-repo" rev-list --count "abc123..HEAD"');
    });

    it('statusに変化がない場合_conflict検査を省略する', async () => {
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([]);
        vi.spyOn(service, '_countCommitsAheadOfBase').mockResolvedValue(0);
        vi.spyOn(service, '_hasWorkingCopyConflicts');

        mockExec
            .mockResolvedValueOnce({ stdout: 'develop\n' })
            .mockResolvedValueOnce({ stdout: '0\n' })
            .mockResolvedValueOnce({ stdout: '' });

        const result = await service.getStatus('session-1', '/tmp/repo', 'abc123');

        expect(result.hasConflicts).toBe(false);
        expect(service._hasWorkingCopyConflicts).not.toHaveBeenCalled();
    });

    it('statusに変化がある場合_git ls-files -uでconflictを検出する', async () => {
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([]);
        vi.spyOn(service, '_countCommitsAheadOfBase').mockResolvedValue(0);

        mockExec
            .mockResolvedValueOnce({ stdout: 'develop\n' })
            .mockResolvedValueOnce({ stdout: '0\n' })
            .mockResolvedValueOnce({ stdout: ' M src/app.js\n' })
            .mockResolvedValueOnce({ stdout: 'src/app.js\n' });

        const result = await service.getStatus('session-1', '/tmp/repo', 'abc123');

        expect(result.hasWorkingCopyChanges).toBe(true);
        expect(result.hasConflicts).toBe(true);
        expect(result.conflicted).toBe(true);
        expect(mockExec).toHaveBeenCalledWith(
            'git -C "/tmp/worktrees/session-1-repo" ls-files -u'
        );
    });

    it('fetchRemote=false のとき git fetch origin を実行しない', async () => {
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);
        vi.spyOn(service, '_countCommitsAheadOfBase').mockResolvedValue(0);

        mockExec
            .mockResolvedValueOnce({ stdout: 'develop\n' })
            .mockResolvedValueOnce({ stdout: '0\n' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' }); // refs/heads verify for candidate branch (not found -> caught)

        await service.getStatus('session-1', '/tmp/repo', 'abc123', { fetchRemote: false });

        expect(mockExec).not.toHaveBeenCalledWith('git -C "/tmp/repo" fetch origin');
    });

    it('workspace artifactだけのworking copy changesはdirty扱いしない', async () => {
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([]);
        vi.spyOn(service, '_countCommitsAheadOfBase').mockResolvedValue(0);

        mockExec
            .mockResolvedValueOnce({ stdout: 'develop\n' })
            .mockResolvedValueOnce({ stdout: '0\n' })
            .mockResolvedValueOnce({
                stdout: [
                    'A  .claude/commands/commit.md',
                    'A  node_modules',
                    'M  AGENTS.md',
                    'R  AGENTS.md -> CLAUDE.md',
                    'A  .brainbase-port'
                ].join('\n')
            });

        const result = await service.getStatus('session-1', '/tmp/repo', 'abc123');

        expect(result.hasWorkingCopyChanges).toBe(false);
        expect(result.needsIntegration).toBe(false);
    });

    it('workspace artifact以外のworking copy changesはdirty扱いする', async () => {
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([]);
        vi.spyOn(service, '_countCommitsAheadOfBase').mockResolvedValue(0);

        mockExec
            .mockResolvedValueOnce({ stdout: 'develop\n' })
            .mockResolvedValueOnce({ stdout: '0\n' })
            .mockResolvedValueOnce({
                stdout: [
                    'A  .claude/commands/commit.md',
                    'M  src/app.js'
                ].join('\n')
            })
            .mockResolvedValueOnce({ stdout: '' });

        const result = await service.getStatus('session-1', '/tmp/repo', 'abc123');

        expect(result.hasWorkingCopyChanges).toBe(true);
        expect(result.needsIntegration).toBe(true);
    });

    it('status収集に失敗した場合もfallback branch名を返す', async () => {
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);

        mockExec.mockRejectedValue(new Error('not a git repo'));

        const result = await service.getStatus('session-1', '/tmp/repo', null);

        expect(result.exists).toBe(false);
        expect(result.bookmarkName).toBe('session/session-1');
    });
});

describe('WorktreeService.autoHealArchiveState', () => {
    let service;
    let mockExec;

    beforeEach(() => {
        mockExec = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', mockExec);
    });

    it('staleなworking copyを安全にself-healする', async () => {
        vi.spyOn(service, '_collectStatus')
            .mockResolvedValueOnce({
                exists: true,
                changesNotPushed: 0,
                hasWorkingCopyChanges: true
            })
            .mockResolvedValueOnce({
                exists: true,
                changesNotPushed: 0,
                hasWorkingCopyChanges: false
            });
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([
            { name: 'session/session-1', pushed: true, output: 'session/session-1@origin' },
            { name: 'session-1', pushed: false, output: 'session-1' }
        ]);
        vi.spyOn(service, '_resolveArchiveTargetBranch').mockResolvedValue({
            bookmarkName: 'session/session-1',
            adoptSessionBookmark: false
        });
        vi.spyOn(service, '_workspaceMatchesBranch').mockResolvedValue(true);

        mockExec
            .mockResolvedValueOnce({ stdout: '' }) // branch -D session-1
            .mockResolvedValueOnce({ stdout: '' }); // reset --hard

        const result = await service.autoHealArchiveState(
            'session-1',
            '/tmp/repo',
            '/tmp/worktrees/session-1-repo'
        );

        expect(result.healed).toBe(true);
        expect(result.reason).toBe('healed');
        expect(result.actions).toEqual([
            'delete-branch:session-1',
            'reset-working-copy:session/session-1'
        ]);
        expect(mockExec).toHaveBeenCalledWith('git -C "/tmp/repo" branch -D "session-1"');
        expect(mockExec).toHaveBeenCalledWith(
            'git -C "/tmp/worktrees/session-1-repo" reset --hard "session/session-1"'
        );
    });

    it('unpushed changeがある場合はself-healしない', async () => {
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([
            { name: 'session/session-1', pushed: true, output: 'session/session-1@origin' }
        ]);
        vi.spyOn(service, '_countCommitsAheadOfBase').mockResolvedValue(0);
        vi.spyOn(service, '_hasWorkingCopyConflicts').mockResolvedValue(false);

        mockExec
            .mockResolvedValueOnce({ stdout: 'main\n' })
            .mockResolvedValueOnce({ stdout: '2\n' })
            .mockResolvedValueOnce({ stdout: 'M  src/app.js\n' });

        const result = await service.autoHealArchiveState(
            'session-1',
            '/tmp/repo',
            '/tmp/worktrees/session-1-repo'
        );

        expect(result.healed).toBe(false);
        expect(result.reason).toBe('changes_not_pushed');
        expect(result.actions).toEqual([]);
    });

    it('公式branchが未pushでも現在branchがpush済みならself-healする', async () => {
        vi.spyOn(service, '_collectStatus')
            .mockResolvedValueOnce({
                exists: true,
                changesNotPushed: 0,
                hasWorkingCopyChanges: true
            })
            .mockResolvedValueOnce({
                exists: true,
                changesNotPushed: 0,
                hasWorkingCopyChanges: false
            });
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([
            { name: 'session/session-1', pushed: false, output: 'session/session-1' },
            { name: 'session-1', pushed: false, output: 'session-1' }
        ]);
        vi.spyOn(service, '_resolveArchiveTargetBranch').mockResolvedValue({
            bookmarkName: 'fix/bug-131',
            adoptSessionBookmark: true
        });
        vi.spyOn(service, '_workspaceMatchesGitHead').mockResolvedValue(true);

        mockExec
            .mockResolvedValueOnce({ stdout: '' }) // branch -f session/session-1 fix/bug-131
            .mockResolvedValueOnce({ stdout: '' }) // branch -D session-1
            .mockResolvedValueOnce({ stdout: '' }); // reset --hard

        const result = await service.autoHealArchiveState(
            'session-1',
            '/tmp/repo',
            '/tmp/worktrees/session-1-repo'
        );

        expect(result.healed).toBe(true);
        expect(result.reason).toBe('healed');
        expect(result.actions).toEqual([
            'move-branch:session/session-1->fix/bug-131',
            'delete-branch:session-1',
            'reset-working-copy:session/session-1'
        ]);
        expect(mockExec).toHaveBeenCalledWith(
            'git -C "/tmp/repo" branch -f "session/session-1" "fix/bug-131"'
        );
        expect(mockExec).toHaveBeenCalledWith('git -C "/tmp/repo" branch -D "session-1"');
    });
});

describe('WorktreeService.merge', () => {
    let service;
    let mockExec;

    beforeEach(() => {
        mockExec = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', mockExec);
        vi.spyOn(service, 'syncCanonicalWorkspaceAfterMerge').mockResolvedValue({ success: true });
    });

    it('session/session-id branchがpush済みならmergeでもそのbranchを使う', async () => {
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));

        vi.spyOn(service, '_getMainBranchName').mockResolvedValue('main');
        vi.spyOn(service, '_getGitHubRepoSpec').mockResolvedValue('Unson-LLC/brainbase');
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([
            { name: 'session/session-1', pushed: true, output: 'session/session-1@origin' }
        ]);
        vi.spyOn(service, '_pushBranchForMerge').mockResolvedValue(undefined);
        vi.spyOn(service, '_retireWorkspaceGeneration').mockResolvedValue({
            success: true,
            workspaceName: 'session-1-repo',
            workspacePath: '/tmp/worktrees/session-1-repo'
        });

        mockExec
            .mockResolvedValueOnce({ stdout: '- feat: archive\n' }) // git log
            .mockResolvedValueOnce({ stdout: 'https://github.com/Unson-LLC/brainbase/pull/123\n' }) // gh pr create
            .mockResolvedValueOnce({ stdout: '' }); // gh pr merge

        const result = await service.merge('session-1', '/tmp/repo', 'Archive flow');

        expect(result.success).toBe(true);
        expect(service._pushBranchForMerge).toHaveBeenCalledWith('/tmp/repo', 'session/session-1');
        expect(mockExec).toHaveBeenCalledWith(
            'git -C "/tmp/repo" log "main..session/session-1" --format="- %s"'
        );
    });

    it('PR作成時_ローカルパスではなくGitHub repo specを渡す', async () => {
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));

        vi.spyOn(service, '_getMainBranchName').mockResolvedValue('main');
        vi.spyOn(service, '_getGitHubRepoSpec').mockResolvedValue('Unson-LLC/brainbase');
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([
            { name: 'session-1', pushed: true, output: 'session-1@origin' }
        ]);
        vi.spyOn(service, '_pushBranchForMerge').mockResolvedValue(undefined);
        vi.spyOn(service, '_retireWorkspaceGeneration').mockResolvedValue({
            success: true,
            workspaceName: 'session-1-repo',
            workspacePath: '/tmp/worktrees/session-1-repo'
        });

        mockExec
            .mockResolvedValueOnce({ stdout: '- feat: archive\n' })
            .mockResolvedValueOnce({ stdout: 'https://github.com/Unson-LLC/brainbase/pull/123\n' })
            .mockResolvedValueOnce({ stdout: '' });

        const result = await service.merge('session-1', '/tmp/repo', 'Archive flow');

        expect(result.success).toBe(true);
        expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('--repo "Unson-LLC/brainbase"'));
        expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('--head "session-1"'));
        expect(mockExec).toHaveBeenCalledWith(
            'gh pr merge "https://github.com/Unson-LLC/brainbase/pull/123" --repo "Unson-LLC/brainbase" --merge --delete-branch'
        );
        expect(mockExec).not.toHaveBeenCalledWith(expect.stringContaining('--repo "/tmp/repo"'));
    });
});
