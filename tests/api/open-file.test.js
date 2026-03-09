import fs from 'fs';
import os from 'os';
import path from 'path';

import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MiscController } from '../../server/controllers/misc-controller.js';

const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
    default: {
        execFile: (...args) => mockExecFile(...args)
    },
    execFile: (...args) => mockExecFile(...args)
}));

describe('POST /api/open-file', () => {
    let app;
    let fileInSession;
    let normalizedFileInSession;
    let sessionSymlinkPath;

    beforeAll(() => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-file-'));
        const workspaceRoot = path.join(tempRoot, 'workspace', 'brainbase');
        const projectsRoot = path.join(tempRoot, 'workspace', 'projects');
        const brainbaseRoot = path.join(tempRoot, 'workspace');
        const volumeRoot = path.join(tempRoot, 'Volumes', 'UNSON-DRIVE', 'brainbase-worktrees');
        const sessionWorkspacePath = path.join(volumeRoot, 'session-123-brainbase');
        sessionSymlinkPath = path.join(tempRoot, 'links', 'session-123-brainbase');
        fileInSession = path.join(sessionWorkspacePath, 'docs', 'note.md');

        fs.mkdirSync(path.dirname(fileInSession), { recursive: true });
        fs.mkdirSync(projectsRoot, { recursive: true });
        fs.mkdirSync(path.dirname(sessionSymlinkPath), { recursive: true });
        fs.writeFileSync(fileInSession, '# note\n');
        fs.symlinkSync(sessionWorkspacePath, sessionSymlinkPath);
        normalizedFileInSession = fs.realpathSync.native(fileInSession);

        const session = {
            id: 'session-123',
            path: sessionWorkspacePath,
            worktree: { path: sessionSymlinkPath }
        };
        const sessionManager = {
            getSession: vi.fn((sessionId) => sessionId === 'session-123' ? session : null),
            resolveSessionWorkspacePath: vi.fn(async (sessionId) => sessionId === 'session-123' ? sessionWorkspacePath : null)
        };

        const controller = new MiscController(
            '1.0.0',
            null,
            workspaceRoot,
            path.join(tempRoot, 'uploads'),
            null,
            { brainbaseRoot, projectsRoot, sessionManager }
        );

        app = express();
        app.use(express.json());
        app.post('/api/open-file', controller.openFile);
    });

    beforeEach(() => {
        mockExecFile.mockReset();
        mockExecFile.mockImplementation((program, args, callback) => {
            callback(null, { stdout: '', stderr: '' });
        });
    });

    it('セッション配下の /Volumes absolute path を許可する', async () => {
        const response = await request(app)
            .post('/api/open-file')
            .send({ path: fileInSession, mode: 'file', sessionId: 'session-123' });

        expect(response.status).toBe(200);
        expect(mockExecFile).toHaveBeenCalledWith('open', [normalizedFileInSession], expect.any(Function));
    });

    it('sessionId + relative path を session workspace 基準で解決する', async () => {
        const response = await request(app)
            .post('/api/open-file')
            .send({ path: 'docs/note.md', mode: 'file', sessionId: 'session-123' });

        expect(response.status).toBe(200);
        expect(mockExecFile).toHaveBeenCalledWith('open', [normalizedFileInSession], expect.any(Function));
    });

    it('symlink 経由の cwd でも realpath 比較で許可する', async () => {
        const response = await request(app)
            .post('/api/open-file')
            .send({ path: 'docs/note.md', mode: 'cursor', sessionId: 'session-123', cwd: sessionSymlinkPath });

        expect(response.status).toBe(200);
        expect(mockExecFile).toHaveBeenCalledWith('cursor', [normalizedFileInSession], expect.any(Function));
    });

    it('managed roots 外の absolute path を拒否する', async () => {
        const response = await request(app)
            .post('/api/open-file')
            .send({ path: '/etc/passwd', mode: 'file', sessionId: 'session-123' });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('outside managed roots');
    });

    it('relative path traversal を拒否する', async () => {
        const response = await request(app)
            .post('/api/open-file')
            .send({ path: '../../etc/passwd', mode: 'file', sessionId: 'session-123' });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('outside managed roots');
    });

    it('null byte を含む path を拒否する', async () => {
        const response = await request(app)
            .post('/api/open-file')
            .send({ path: `${fileInSession}\0.txt`, mode: 'file', sessionId: 'session-123' });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('contains null byte');
    });
});
