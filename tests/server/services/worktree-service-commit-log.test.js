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

    it('Jujutsuリポジトリの場合_jjログがパースされる', async () => {
        // _isJujutsuRepo メソッドをモック
        vi.spyOn(service, '_isJujutsuRepo').mockResolvedValue(true);

        // fs.access のモック（workspace存在チェック用）
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockResolvedValueOnce(undefined);

        const jjOutput = [
            'abc123456789\x00feat: add panel\x002026-02-16T10:30:00+09:00\x00ksato\x00main\x00true\x00parent1',
            'def987654321\x00fix: bug\x002026-02-16T10:00:00+09:00\x00ksato\x00\x00false\x00parent2'
        ].join('\n');

        mockExec
            .mockResolvedValueOnce({ stdout: 'origin https://github.com/example/test-repo.git\n' })
            .mockResolvedValueOnce({ stdout: jjOutput });

        const result = await service.getCommitLog('session-1', '/tmp/repo', 50);

        expect(result.repoType).toBe('jj');
        expect(result.commits).toHaveLength(2);
        expect(result.commits[0].hash).toBe('abc123456789');
        expect(result.commits[0].description).toBe('feat: add panel');
        expect(result.commits[0].bookmarks).toEqual(['main']);
        expect(result.commits[0].isWorkingCopy).toBe(true);
        expect(result.commits[1].isWorkingCopy).toBe(false);
    });

    it('Gitリポジトリの場合_gitログがパースされる', async () => {
        // _isJujutsuRepo メソッドをモック（false）
        vi.spyOn(service, '_isJujutsuRepo').mockResolvedValue(false);

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
        expect(result.commits).toHaveLength(2);
        expect(result.commits[0].hash).toBe('abc1234');
        expect(result.commits[0].isWorkingCopy).toBe(true); // first commit marked as WC
        expect(result.commits[1].isWorkingCopy).toBe(false);
    });
});

describe('WorktreeService._parseJujutsuLog', () => {
    let service;

    beforeEach(() => {
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', vi.fn());
    });

    it('空文字列の場合_空配列が返される', () => {
        expect(service._parseJujutsuLog('')).toEqual([]);
        expect(service._parseJujutsuLog(null)).toEqual([]);
    });

    it('正常なjjログ出力がパースされる', () => {
        const stdout = 'abc123\x00feat: test\x002026-02-16T10:00:00\x00ksato\x00main dev\x00true\n';
        const result = service._parseJujutsuLog(stdout);

        expect(result).toHaveLength(1);
        expect(result[0].hash).toBe('abc123');
        expect(result[0].description).toBe('feat: test');
        expect(result[0].bookmarks).toEqual(['main', 'dev']);
        expect(result[0].isWorkingCopy).toBe(true);
    });

    it('descriptionが空の場合_(empty)が設定される', () => {
        const stdout = 'abc123\x00\x002026-02-16T10:00:00\x00ksato\x00\x00false\n';
        const result = service._parseJujutsuLog(stdout);

        expect(result[0].description).toBe('(empty)');
    });
});

describe('WorktreeService._parseGitLog', () => {
    let service;

    beforeEach(() => {
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', vi.fn());
    });

    it('空文字列の場合_空配列が返される', () => {
        expect(service._parseGitLog('')).toEqual([]);
    });

    it('正常なgitログ出力がパースされる', () => {
        const stdout = 'abc1234\x00feat: test\x002026-02-16T10:00:00+09:00\x00ksato\x00HEAD -> main, origin/main\x00\n';
        const result = service._parseGitLog(stdout);

        expect(result).toHaveLength(1);
        expect(result[0].hash).toBe('abc1234');
        expect(result[0].description).toBe('feat: test');
        expect(result[0].bookmarks).toContain('HEAD -> main');
    });
});

describe('WorktreeService Git compatibility helpers', () => {
    let service;
    let mockExec;

    beforeEach(() => {
        mockExec = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', mockExec);
    });

    it('Git互換メタデータ作成時_HEADとindex初期化を行う', async () => {
        const { promises: fs } = await import('fs');
        const mkdirSpy = vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
        const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

        mockExec
            .mockResolvedValueOnce({ stdout: 'abc123\n' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' });

        const result = await service._ensureGitCompatibility(
            'session-1',
            '/tmp/repo',
            '/tmp/worktrees/session-1-repo'
        );

        expect(result.branchName).toBe('session/session-1');
        expect(mkdirSpy).toHaveBeenCalledWith('/tmp/repo/.git/worktrees/session-1-repo', { recursive: true });
        expect(writeFileSpy).toHaveBeenCalledWith(
            '/tmp/repo/.git/worktrees/session-1-repo/HEAD',
            'ref: refs/heads/session/session-1\n'
        );
        expect(writeFileSpy).toHaveBeenCalledWith(
            '/tmp/worktrees/session-1-repo/.git',
            'gitdir: /tmp/repo/.git/worktrees/session-1-repo\n'
        );
        expect(mockExec).toHaveBeenNthCalledWith(1, 'git -C "/tmp/repo" rev-parse HEAD');
        expect(mockExec).toHaveBeenNthCalledWith(2, 'git -C "/tmp/repo" branch --force "session/session-1" "abc123"');
        expect(mockExec).toHaveBeenNthCalledWith(3, 'git -C "/tmp/worktrees/session-1-repo" reset --mixed HEAD');
    });

    it('Git互換メタデータ削除時_worktree管理情報とbranchを掃除する', async () => {
        const { promises: fs } = await import('fs');
        const rmSpy = vi.spyOn(fs, 'rm').mockResolvedValue(undefined);
        mockExec.mockResolvedValueOnce({ stdout: '' });

        await service._removeGitCompatibility('session-1', '/tmp/repo');

        expect(rmSpy).toHaveBeenCalledWith('/tmp/repo/.git/worktrees/session-1-repo', { recursive: true, force: true });
        expect(mockExec).toHaveBeenCalledWith('git -C "/tmp/repo" branch -D "session/session-1"');
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
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);

        mockExec
            .mockResolvedValueOnce({ stdout: 'main\n' })
            .mockResolvedValueOnce({ stdout: '0\n' })
            .mockResolvedValueOnce({ stdout: 'Working copy changes:\n' })
            .mockResolvedValueOnce({ stdout: 'session/session-1: test@origin\n' })
            .mockResolvedValueOnce({ stdout: 'session-1: test\n' })
            .mockResolvedValueOnce({ stdout: 'session/session-1: test@origin\n' })
            .mockResolvedValueOnce({ stdout: 'session-1: test\n' })
            .mockResolvedValueOnce({ stdout: 'refs/remotes/origin/session/session-1\n' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: 'main\n' })
            .mockResolvedValueOnce({ stdout: '0\n' })
            .mockResolvedValueOnce({ stdout: 'The working copy has no changes.\n' })
            .mockResolvedValueOnce({ stdout: 'session/session-1: test@origin\n' })
            .mockResolvedValueOnce({ stdout: '' });

        const result = await service.autoHealArchiveState(
            'session-1',
            '/tmp/repo',
            '/tmp/worktrees/session-1-repo'
        );

        expect(result.healed).toBe(true);
        expect(result.reason).toBe('healed');
        expect(result.actions).toEqual([
            'delete-bookmark:session-1',
            'reset-working-copy:session/session-1',
            'git-export'
        ]);
        expect(mockExec).toHaveBeenCalledWith('jj -R "/tmp/repo" bookmark delete "session-1"');
        expect(mockExec).toHaveBeenCalledWith(
            'jj -R "/tmp/worktrees/session-1-repo" new "session/session-1" -m "wip: archive clean working copy"'
        );
    });

    it('unpushed changeがある場合はself-healしない', async () => {
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);

        mockExec
            .mockResolvedValueOnce({ stdout: 'main\n' })
            .mockResolvedValueOnce({ stdout: '2\n' })
            .mockResolvedValueOnce({ stdout: 'Working copy changes:\n' })
            .mockResolvedValueOnce({ stdout: 'session/session-1: test@origin\n' })
            .mockResolvedValueOnce({ stdout: '' });

        const result = await service.autoHealArchiveState(
            'session-1',
            '/tmp/repo',
            '/tmp/worktrees/session-1-repo'
        );

        expect(result.healed).toBe(false);
        expect(result.reason).toBe('changes_not_pushed');
        expect(result.actions).toEqual([]);
    });
});
