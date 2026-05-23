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

        controller = new SessionController({
            workspace: { resolveSessionWorkspacePath: vi.fn() },
            worktreeService: {},
            stateStore
        });

        req = {
            params: { id: 'session-1' },
            query: { path: 'README.md' }
        };

        res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
            setHeader: vi.fn(),
            send: vi.fn()
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

    it('HTMLファイルの場合_ページプレビューURLを返す', async () => {
        req.query.path = 'dist/index.html';
        const content = '<!doctype html><h1>Hello</h1>';
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
            relativePath: 'dist/index.html',
            fileName: 'index.html',
            content,
            isMarkdown: false,
            isHtml: true,
            htmlPreviewUrl: '/api/sessions/session-1/html-preview/dist/index.html'
        }));
    });

    it('.vibepro配下のHTMLファイルもページプレビューURLを返す', async () => {
        req.query.path = '.vibepro/pr/story/pr-prepare.html';
        const content = '<!doctype html><h1>VibePro</h1>';
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
            relativePath: '.vibepro/pr/story/pr-prepare.html',
            fileName: 'pr-prepare.html',
            isHtml: true,
            htmlPreviewUrl: '/api/sessions/session-1/html-preview/.vibepro/pr/story/pr-prepare.html'
        }));
    });

    it('getHtmlPreview_HTMLファイルをtext/htmlで返す', async () => {
        req.query.path = 'dist/index.html';
        const content = '<!doctype html><h1>Hello</h1>';
        const contentBuf = Buffer.from(content);
        mockStat.mockResolvedValue({ size: contentBuf.length, isFile: () => true });
        const mockFd = {
            read: vi.fn().mockImplementation((buffer, offset, length) => {
                const toCopy = Math.min(length, contentBuf.length);
                contentBuf.copy(buffer, offset, 0, toCopy);
                return Promise.resolve({ bytesRead: toCopy, buffer });
            }),
            close: vi.fn().mockResolvedValue()
        };
        mockOpen.mockResolvedValue(mockFd);
        mockReadFile.mockResolvedValue(Buffer.from(content));

        await controller.getHtmlPreview(req, res);

        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
        expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect(res.send).toHaveBeenCalledWith(Buffer.from(content));
    });

    it('getHtmlPreview_非HTMLファイルは415を返す', async () => {
        req.query.path = 'README.md';
        mockStat.mockResolvedValue({ size: 32, isFile: () => true });

        await controller.getHtmlPreview(req, res);

        expect(res.status).toHaveBeenCalledWith(415);
    });

    it('getHtmlPreviewAsset_画像ファイルを画像MIMEで返す', async () => {
        req.params.previewPath = ['assets', 'logo.png'];
        req.query.path = '';
        const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        mockStat.mockResolvedValue({ size: imageBuffer.length, isFile: () => true });
        mockReadFile.mockResolvedValue(imageBuffer);

        await controller.getHtmlPreviewAsset(req, res);

        expect(mockOpen).not.toHaveBeenCalled();
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
        expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
        expect(res.send).toHaveBeenCalledWith(imageBuffer);
    });

    it('getHtmlPreviewAsset_Codex生成画像の絶対パスを画像MIMEで返す', async () => {
        const imagePath = '/Users/ksato/.codex/generated_images/run/sample.png';
        req.params.previewPath = ['__external__', 'sample.png'];
        req.query.path = imagePath;
        const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        mockStat.mockImplementation(async (targetPath) => {
            if (String(targetPath) === imagePath) {
                return { size: imageBuffer.length, isFile: () => true };
            }
            const err = new Error('ENOENT');
            err.code = 'ENOENT';
            throw err;
        });
        mockReadFile.mockResolvedValue(imageBuffer);

        await controller.getHtmlPreviewAsset(req, res);

        expect(mockOpen).not.toHaveBeenCalled();
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
        expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
        expect(res.send).toHaveBeenCalledWith(imageBuffer);
    });

    it('getHtmlPreviewAsset_Codex生成画像のfile URIを画像MIMEで返す', async () => {
        const imagePath = '/Users/ksato/.codex/generated_images/run/sample.png';
        req.params.previewPath = ['__external__', 'sample.png'];
        req.query.path = `file://${imagePath}`;
        const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        mockStat.mockImplementation(async (targetPath) => {
            if (String(targetPath) === imagePath) {
                return { size: imageBuffer.length, isFile: () => true };
            }
            const err = new Error('ENOENT');
            err.code = 'ENOENT';
            throw err;
        });
        mockReadFile.mockResolvedValue(imageBuffer);

        await controller.getHtmlPreviewAsset(req, res);

        expect(mockOpen).not.toHaveBeenCalled();
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
        expect(res.send).toHaveBeenCalledWith(imageBuffer);
    });

    it('getHtmlPreviewAsset_512KB超の画像もプレビューできる', async () => {
        const imagePath = '/Users/ksato/.codex/generated_images/run/large.png';
        req.params.previewPath = ['__external__', 'large.png'];
        req.query.path = imagePath;
        const imageBuffer = Buffer.alloc(1024 * 1024, 0xff);
        imageBuffer[0] = 0x89;
        imageBuffer[1] = 0x50;
        imageBuffer[2] = 0x4e;
        imageBuffer[3] = 0x47;
        mockStat.mockImplementation(async (targetPath) => {
            if (String(targetPath) === imagePath) {
                return { size: imageBuffer.length, isFile: () => true };
            }
            const err = new Error('ENOENT');
            err.code = 'ENOENT';
            throw err;
        });
        mockReadFile.mockResolvedValue(imageBuffer);

        await controller.getHtmlPreviewAsset(req, res);

        expect(res.status).not.toHaveBeenCalledWith(413);
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
        expect(res.send).toHaveBeenCalledWith(imageBuffer);
    });

    it('getHtmlPreviewAsset_拡張子が未対応の絶対パスは415を返す', async () => {
        req.params.previewPath = ['__external__', 'passwd'];
        req.query.path = '/etc/passwd';
        mockStat.mockResolvedValue({ size: 32, isFile: () => true });

        await controller.getHtmlPreviewAsset(req, res);

        expect(res.status).toHaveBeenCalledWith(415);
    });

    it('workspace外のtmpテキスト絶対パスをプレビューできる', async () => {
        req.query.path = '/tmp/brainbase-note.txt';
        const content = 'tmp note';
        const contentBuf = Buffer.from(content);
        mockStat.mockImplementation(async (targetPath) => {
            if (String(targetPath) === '/tmp/brainbase-note.txt') {
                return { size: contentBuf.length };
            }
            const err = new Error('ENOENT');
            err.code = 'ENOENT';
            throw err;
        });
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
            relativePath: '/tmp/brainbase-note.txt',
            fileName: 'brainbase-note.txt',
            content,
            isMarkdown: false
        }));
    });

    it('workspace外の別ドライブHTML絶対パスをプレビューURL付きで返す', async () => {
        const htmlPath = '/Volumes/UNSON-DRIVE/reports/out.html';
        req.query.path = htmlPath;
        const content = '<!doctype html><h1>Report</h1>';
        const contentBuf = Buffer.from(content);
        mockStat.mockImplementation(async (targetPath) => {
            if (String(targetPath) === htmlPath) {
                return { size: contentBuf.length };
            }
            const err = new Error('ENOENT');
            err.code = 'ENOENT';
            throw err;
        });
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
            relativePath: htmlPath,
            fileName: 'out.html',
            content,
            isHtml: true,
            htmlPreviewUrl: '/api/sessions/session-1/html-preview/__external__/out.html?path=%2FVolumes%2FUNSON-DRIVE%2Freports%2Fout.html'
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
        controller = new SessionController({
            workspace: { resolveSessionWorkspacePath: vi.fn() },
            worktreeService: {},
            stateStore,
            projectsRoot: '/Users/ksato/workspace/projects',
            codeProjectsRoot: '/Users/ksato/workspace/code'
        });
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
