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
    let fileInWorkspace;
    let normalizedFileInWorkspace;
    let workspaceSymlinkPath;

    beforeAll(() => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-file-'));
        const workspaceRoot = path.join(tempRoot, 'workspace', 'brainbase');
        const projectsRoot = path.join(tempRoot, 'workspace', 'projects');
        const brainbaseRoot = path.join(tempRoot, 'workspace');
        workspaceSymlinkPath = path.join(tempRoot, 'links', 'workspace');
        fileInWorkspace = path.join(workspaceRoot, 'docs', 'note.md');

        fs.mkdirSync(path.dirname(fileInWorkspace), { recursive: true });
        fs.mkdirSync(projectsRoot, { recursive: true });
        fs.mkdirSync(path.dirname(workspaceSymlinkPath), { recursive: true });
        fs.writeFileSync(fileInWorkspace, '# note\n');
        fs.symlinkSync(workspaceRoot, workspaceSymlinkPath);
        normalizedFileInWorkspace = fs.realpathSync.native(fileInWorkspace);

        const controller = new MiscController(
            '1.0.0',
            null,
            workspaceRoot,
            path.join(tempRoot, 'uploads'),
            null,
            { brainbaseRoot, projectsRoot }
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

    it('workspace配下のabsolute pathを許可する', async () => {
        const response = await request(app)
            .post('/api/open-file')
            .send({ path: fileInWorkspace, mode: 'file' });

        expect(response.status).toBe(200);
        expect(mockExecFile).toHaveBeenCalledWith('open', [normalizedFileInWorkspace], expect.any(Function));
    });

    it('cwd + relative pathをworkspace基準で解決する', async () => {
        const response = await request(app)
            .post('/api/open-file')
            .send({ path: 'docs/note.md', mode: 'file', cwd: workspaceSymlinkPath });

        expect(response.status).toBe(200);
        expect(mockExecFile).toHaveBeenCalledWith('open', [normalizedFileInWorkspace], expect.any(Function));
    });

    it('symlink 経由の cwd でも realpath 比較で許可する', async () => {
        const response = await request(app)
            .post('/api/open-file')
            .send({ path: 'docs/note.md', mode: 'cursor', cwd: workspaceSymlinkPath });

        expect(response.status).toBe(200);
        expect(mockExecFile).toHaveBeenCalledWith('cursor', [normalizedFileInWorkspace], expect.any(Function));
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
            .send({ path: `${fileInWorkspace}\0.txt`, mode: 'file' });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('contains null byte');
    });

});
