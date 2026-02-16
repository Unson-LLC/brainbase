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
        // _isJujutsuRepo をモック
        service.isJujutsuRepo = true;

        // fs.access のモック（workspace存在チェック用）
        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockResolvedValueOnce(undefined);

        const jjOutput = [
            'abc123456789\x00feat: add panel\x002026-02-16T10:30:00+09:00\x00ksato\x00main\x00true',
            'def987654321\x00fix: bug\x002026-02-16T10:00:00+09:00\x00ksato\x00\x00false'
        ].join('\n');

        mockExec.mockResolvedValueOnce({ stdout: jjOutput });

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
        // _isJujutsuRepo をモック（false）
        service.isJujutsuRepo = false;

        const { promises: fs } = await import('fs');
        vi.spyOn(fs, 'access').mockResolvedValueOnce(undefined);

        const gitOutput = [
            'abc1234\x00feat: add panel\x002026-02-16T10:30:00+09:00\x00ksato\x00HEAD -> main\x00',
            'def9876\x00fix: bug\x002026-02-16T10:00:00+09:00\x00ksato\x00\x00'
        ].join('\n');

        mockExec.mockResolvedValueOnce({ stdout: gitOutput });

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
