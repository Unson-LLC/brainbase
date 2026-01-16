import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskDirectoryScanner } from '../../lib/task-directory-scanner.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
    default: {
        readdir: vi.fn(),
        readFile: vi.fn(),
        stat: vi.fn(),
        mkdir: vi.fn(),
        writeFile: vi.fn()
    }
}));

import fs from 'fs/promises';

describe('TaskDirectoryScanner', () => {
    let scanner;
    const rootPath = '/test/_tasks';

    beforeEach(() => {
        vi.clearAllMocks();
        scanner = new TaskDirectoryScanner(rootPath);
    });

    describe('scanProjects', () => {
        it('scanProjects呼び出し時_ディレクトリ一覧が返される', async () => {
            fs.readdir.mockResolvedValue([
                { name: 'brainbase', isDirectory: () => true },
                { name: 'madoguchi-ai', isDirectory: () => true },
                { name: 'readme.md', isDirectory: () => false }
            ]);

            const projects = await scanner.scanProjects();

            expect(projects).toHaveLength(2);
            expect(projects[0].projectId).toBe('brainbase');
            expect(projects[0].tasksPath).toBe('/test/_tasks/brainbase/tasks.md');
            expect(projects[0].donePath).toBe('/test/_tasks/brainbase/done.md');
            expect(projects[1].projectId).toBe('madoguchi-ai');
        });

        it('scanProjects呼び出し時_空ディレクトリは空配列が返される', async () => {
            fs.readdir.mockResolvedValue([]);

            const projects = await scanner.scanProjects();

            expect(projects).toEqual([]);
        });

        it('scanProjects呼び出し時_ファイルはスキップされる', async () => {
            fs.readdir.mockResolvedValue([
                { name: 'index.md', isDirectory: () => false },
                { name: 'brainbase', isDirectory: () => true }
            ]);

            const projects = await scanner.scanProjects();

            expect(projects).toHaveLength(1);
            expect(projects[0].projectId).toBe('brainbase');
        });
    });

    describe('getActiveTasks', () => {
        it('getActiveTasks呼び出し時_全プロジェクトのタスクが返される', async () => {
            fs.readdir.mockResolvedValue([
                { name: 'brainbase', isDirectory: () => true },
                { name: 'madoguchi-ai', isDirectory: () => true }
            ]);

            fs.readFile.mockImplementation((path) => {
                if (path.includes('brainbase')) {
                    return Promise.resolve(`- [ ] Brainbase Task
  - _ID: task-1_`);
                }
                if (path.includes('madoguchi-ai')) {
                    return Promise.resolve(`- [ ] Madoguchi Task
  - _ID: task-2_`);
                }
                return Promise.reject(new Error('File not found'));
            });

            const tasks = await scanner.getActiveTasks();

            expect(tasks).toHaveLength(2);
            expect(tasks[0].project).toBe('brainbase');
            expect(tasks[1].project).toBe('madoguchi-ai');
        });

        it('getActiveTasks呼び出し時_tasks.mdがないプロジェクトはスキップされる', async () => {
            fs.readdir.mockResolvedValue([
                { name: 'brainbase', isDirectory: () => true }
            ]);

            fs.readFile.mockRejectedValue({ code: 'ENOENT' });

            const tasks = await scanner.getActiveTasks();

            expect(tasks).toEqual([]);
        });
    });

    describe('getCompletedTasks', () => {
        it('getCompletedTasks呼び出し時_全プロジェクトの完了タスクが返される', async () => {
            fs.readdir.mockResolvedValue([
                { name: 'brainbase', isDirectory: () => true }
            ]);

            fs.readFile.mockImplementation((path) => {
                if (path.includes('done.md')) {
                    return Promise.resolve(`- [x] Completed Task
  - _ID: task-done-1_`);
                }
                return Promise.reject({ code: 'ENOENT' });
            });

            const tasks = await scanner.getCompletedTasks();

            expect(tasks).toHaveLength(1);
            expect(tasks[0].status).toBe('done');
        });

        it('getCompletedTasks呼び出し時_done.mdがないプロジェクトはスキップされる', async () => {
            fs.readdir.mockResolvedValue([
                { name: 'brainbase', isDirectory: () => true }
            ]);

            fs.readFile.mockRejectedValue({ code: 'ENOENT' });

            const tasks = await scanner.getCompletedTasks();

            expect(tasks).toEqual([]);
        });
    });

    describe('getProjectPath', () => {
        it('getProjectPath呼び出し時_正しいパスが返される', () => {
            const result = scanner.getProjectPath('brainbase');

            expect(result.tasksPath).toBe('/test/_tasks/brainbase/tasks.md');
            expect(result.donePath).toBe('/test/_tasks/brainbase/done.md');
            expect(result.dirPath).toBe('/test/_tasks/brainbase');
        });
    });

    describe('ensureProjectDir', () => {
        it('ensureProjectDir呼び出し時_ディレクトリが作成される', async () => {
            fs.mkdir.mockResolvedValue(undefined);

            await scanner.ensureProjectDir('new-project');

            expect(fs.mkdir).toHaveBeenCalledWith(
                '/test/_tasks/new-project',
                { recursive: true }
            );
        });
    });
});
