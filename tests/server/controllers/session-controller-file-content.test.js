import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionController } from '../../../server/controllers/session-controller.js';

const mockStat = vi.fn();
const mockOpen = vi.fn();
const mockReadFile = vi.fn();
const mockReaddir = vi.fn();

vi.mock('fs/promises', () => ({
    default: {
        stat: (...args) => mockStat(...args),
        open: (...args) => mockOpen(...args),
        readFile: (...args) => mockReadFile(...args),
        readdir: (...args) => mockReaddir(...args)
    },
    stat: (...args) => mockStat(...args),
    open: (...args) => mockOpen(...args),
    readFile: (...args) => mockReadFile(...args),
    readdir: (...args) => mockReaddir(...args)
}));

describe('SessionController.getFileContent', () => {
    let controller;
    let req;
    let res;
    let stateStore;

    beforeEach(() => {
        stateStore = {
            get: vi.fn().mockReturnValue({
                sessions: [
                    {
                        id: 'session-1',
                        name: 'Test',
                        worktree: { path: '/tmp/project', repo: '/tmp/repo' }
                    }
                ]
            })
        };

        controller = new SessionController(
            { resolveSessionWorkspacePath: vi.fn() },
            {},
            stateStore
        );

        req = {
            params: { id: 'session-1' },
            query: { path: 'README.md' }
        };

        res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        vi.clearAllMocks();
    });

    it('pathが空の場合_400を返す', async () => {
        req.query.path = '';
        await controller.getFileContent(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('セッションが存在しない場合_404を返す', async () => {
        req.params.id = 'non-existent';
        await controller.getFileContent(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('ファイルが大きすぎる場合_413を返す', async () => {
        mockStat.mockResolvedValue({ size: 600 * 1024 });
        await controller.getFileContent(req, res);
        expect(res.status).toHaveBeenCalledWith(413);
    });

    it('バイナリファイルの場合_415を返す', async () => {
        mockStat.mockResolvedValue({ size: 100 });
        const buf = Buffer.alloc(100);
        buf[50] = 0; // null byte
        const mockFd = {
            read: vi.fn().mockResolvedValue({ bytesRead: 100, buffer: buf }),
            close: vi.fn().mockResolvedValue()
        };
        mockOpen.mockResolvedValue(mockFd);
        await controller.getFileContent(req, res);
        expect(res.status).toHaveBeenCalledWith(415);
    });

    it('Markdownファイルの場合_isMarkdownがtrueで返される', async () => {
        const content = '# Hello\n\nWorld';
        const contentBuf = Buffer.from(content);
        mockStat.mockResolvedValue({ size: contentBuf.length });
        const mockFd = {
            read: vi.fn().mockImplementation((buffer, offset, length) => {
                const toCopy = Math.min(length, contentBuf.length);
                contentBuf.copy(buffer, offset, 0, toCopy);
                return Promise.resolve({ bytesRead: toCopy, buffer });
            }),
            close: vi.fn().mockResolvedValue()
        };
        mockOpen.mockResolvedValue(mockFd);
        mockReadFile.mockResolvedValue(content);

        await controller.getFileContent(req, res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            relativePath: 'README.md',
            fileName: 'README.md',
            content,
            isMarkdown: true
        }));
    });

    it('パストラバーサル攻撃_400を返す', async () => {
        req.query.path = '../../../etc/passwd';
        await controller.getFileContent(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('存在しないファイル_404を返す', async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        mockStat.mockRejectedValue(err);
        await controller.getFileContent(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('workspace親配下の絶対パスをプレビューできる', async () => {
        stateStore.get.mockReturnValue({
            sessions: [
                {
                    id: 'session-1',
                    name: 'Test',
                    worktree: {
                        path: '/Users/ksato/workspace/projects/brainbase-worktree',
                        repo: '/Users/ksato/workspace/code/brainbase'
                    }
                }
            ]
        });
        controller = new SessionController(
            { resolveSessionWorkspacePath: vi.fn() },
            {},
            stateStore,
            {
                projectsRoot: '/Users/ksato/workspace/projects',
                codeProjectsRoot: '/Users/ksato/workspace/code'
            }
        );
        req.query.path = '/Users/ksato/workspace/common/talks/example.md';

        mockStat.mockImplementation(async (targetPath) => {
            if (String(targetPath) === '/Users/ksato/workspace/common/talks/example.md') {
                return { size: 16 };
            }
            const err = new Error('ENOENT');
            err.code = 'ENOENT';
            throw err;
        });
        const content = '# Example';
        const contentBuf = Buffer.from(content);
        const mockFd = {
            read: vi.fn().mockImplementation((buffer, offset, length) => {
                const toCopy = Math.min(length, contentBuf.length);
                contentBuf.copy(buffer, offset, 0, toCopy);
                return Promise.resolve({ bytesRead: toCopy, buffer });
            }),
            close: vi.fn().mockResolvedValue()
        };
        mockOpen.mockResolvedValue(mockFd);
        mockReadFile.mockResolvedValue(content);

        await controller.getFileContent(req, res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            relativePath: 'common/talks/example.md',
            fileName: 'example.md',
            content,
            isMarkdown: true
        }));
    });
});
