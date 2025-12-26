/**
 * Open File API Test (TDD)
 * t_wada式TDD: Red-Green-Refactorサイクルで実装
 */
import { describe, it, expect, beforeAll, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';

// child_processモジュールをモック
const mockExec = vi.fn();
vi.mock('child_process', () => ({
    exec: (...args) => mockExec(...args)
}));

// テスト用のExpressアプリを作成
let app;
const WORKSPACE_ROOT = '/Users/ksato/workspace';

describe('POST /api/open-file', () => {
    beforeAll(async () => {
        // モックの実装を設定
        mockExec.mockImplementation((cmd, callback) => {
            // 成功をシミュレート
            callback(null, { stdout: '', stderr: '' });
        });

        app = express();
        app.use(express.json());

        // Green: セキュリティを含むopen実装
        app.post('/api/open-file', async (req, res) => {
            const { path: filePath, mode } = req.body;

            // セキュリティチェック: ヌルバイト
            if (filePath.includes('\0')) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid path: contains null byte'
                });
            }

            // パスを正規化
            const normalizedPath = path.resolve(filePath);

            // セキュリティチェック: ワークスペース内かどうか
            const relativePath = path.relative(WORKSPACE_ROOT, normalizedPath);
            const isInsideWorkspace = relativePath &&
                !relativePath.startsWith('..') &&
                !path.isAbsolute(relativePath);

            if (!isInsideWorkspace) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied: path is outside workspace'
                });
            }

            // modeに応じてコマンドを構築
            const command = mode === 'reveal'
                ? `open -R "${normalizedPath}"`
                : `open "${normalizedPath}"`;

            // モック化されたexecを使用
            const { exec } = await import('child_process');
            exec(command, (error) => {
                if (error) {
                    return res.status(500).json({
                        success: false,
                        error: error.message
                    });
                }
                res.json({ success: true });
            });
        });
    });

    beforeEach(() => {
        // 各テスト前にモックをクリア
        mockExec.mockClear();
    });

    describe('基本機能: ファイルを開く', () => {
        it('should open a file and return success', async () => {
            // Red: 最初のテスト - ファイルを開いて成功を返すべき
            const response = await request(app)
                .post('/api/open-file')
                .send({ path: '/Users/ksato/workspace/test.md', mode: 'file' });

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ success: true });
        });

        it('should reveal file in Finder when mode is reveal', async () => {
            // Red: 三角測量 - Finderで表示するケース
            const response = await request(app)
                .post('/api/open-file')
                .send({ path: '/Users/ksato/workspace/test.md', mode: 'reveal' });

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ success: true });
        });
    });

    describe('コマンド実行の検証', () => {
        it('should call open command for file mode', async () => {
            // Red: mode='file'の場合、`open <path>`が呼ばれるべき
            const testPath = '/Users/ksato/workspace/test.md';

            await request(app)
                .post('/api/open-file')
                .send({ path: testPath, mode: 'file' });

            expect(mockExec).toHaveBeenCalledWith(
                `open "${testPath}"`,
                expect.any(Function)
            );
        });

        it('should call open -R command for reveal mode', async () => {
            // Red: mode='reveal'の場合、`open -R <path>`が呼ばれるべき
            const testPath = '/Users/ksato/workspace/test.md';

            await request(app)
                .post('/api/open-file')
                .send({ path: testPath, mode: 'reveal' });

            expect(mockExec).toHaveBeenCalledWith(
                `open -R "${testPath}"`,
                expect.any(Function)
            );
        });
    });

    describe('セキュリティ: パストラバーサル防止', () => {
        it('should reject paths outside workspace', async () => {
            // Red: ワークスペース外のパスは拒否されるべき
            const response = await request(app)
                .post('/api/open-file')
                .send({ path: '/etc/passwd', mode: 'file' });

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('outside workspace');
        });

        it('should reject relative path traversal attempts', async () => {
            // Red: 相対パスでのトラバーサル試行は拒否されるべき
            const response = await request(app)
                .post('/api/open-file')
                .send({ path: '../../etc/passwd', mode: 'file' });

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('outside workspace');
        });

        it('should reject paths with null bytes', async () => {
            // Red: ヌルバイトを含むパスは拒否されるべき
            const response = await request(app)
                .post('/api/open-file')
                .send({ path: '/Users/ksato/workspace/test.md\0.txt', mode: 'file' });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Invalid path');
        });
    });
});
