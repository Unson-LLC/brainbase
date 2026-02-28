import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskFileManager } from '../../lib/task-file-manager.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
    default: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn()
    }
}));

import fs from 'fs/promises';

describe('TaskFileManager', () => {
    let manager;
    const rootPath = '/test/_tasks';

    beforeEach(() => {
        vi.clearAllMocks();
        manager = new TaskFileManager(rootPath);
    });

    describe('completeTask', () => {
        it('completeTask呼び出し時_tasks.mdからdone.mdへ移動される', async () => {
            const tasksContent = `- [ ] タスク1
  - _ID: task-1_
- [ ] タスク2
  - _ID: task-2_`;

            const doneContent = '';

            fs.readFile.mockImplementation((path) => {
                if (path.includes('tasks.md')) return Promise.resolve(tasksContent);
                if (path.includes('done.md')) return Promise.resolve(doneContent);
                return Promise.reject({ code: 'ENOENT' });
            });
            fs.writeFile.mockResolvedValue(undefined);
            fs.mkdir.mockResolvedValue(undefined);

            await manager.completeTask('brainbase', 'task-1');

            // tasks.md should be updated (task-1 removed)
            const tasksWriteCall = fs.writeFile.mock.calls.find(c => c[0].includes('tasks.md'));
            expect(tasksWriteCall[1]).not.toContain('task-1');
            expect(tasksWriteCall[1]).toContain('task-2');

            // done.md should be updated (task-1 added with [x])
            const doneWriteCall = fs.writeFile.mock.calls.find(c => c[0].includes('done.md'));
            expect(doneWriteCall[1]).toContain('[x]');
            expect(doneWriteCall[1]).toContain('task-1');
        });

        it('completeTask呼び出し時_存在しないタスクはfalseが返される', async () => {
            fs.readFile.mockResolvedValue('');

            const result = await manager.completeTask('brainbase', 'non-existent');

            expect(result).toBe(false);
        });
    });

    describe('restoreTask', () => {
        it('restoreTask呼び出し時_done.mdからtasks.mdへ移動される', async () => {
            const tasksContent = '';
            const doneContent = `- [x] 完了タスク
  - _ID: task-done-1_`;

            fs.readFile.mockImplementation((path) => {
                if (path.includes('tasks.md')) return Promise.resolve(tasksContent);
                if (path.includes('done.md')) return Promise.resolve(doneContent);
                return Promise.reject({ code: 'ENOENT' });
            });
            fs.writeFile.mockResolvedValue(undefined);
            fs.mkdir.mockResolvedValue(undefined);

            await manager.restoreTask('brainbase', 'task-done-1');

            // done.md should be updated (task removed)
            const doneWriteCall = fs.writeFile.mock.calls.find(c => c[0].includes('done.md'));
            expect(doneWriteCall[1]).not.toContain('task-done-1');

            // tasks.md should be updated (task added with [ ])
            const tasksWriteCall = fs.writeFile.mock.calls.find(c => c[0].includes('tasks.md'));
            expect(tasksWriteCall[1]).toContain('[ ]');
            expect(tasksWriteCall[1]).toContain('task-done-1');
        });
    });

    describe('createTask', () => {
        it('createTask呼び出し時_tasks.mdに追加される', async () => {
            fs.readFile.mockResolvedValue('');
            fs.writeFile.mockResolvedValue(undefined);
            fs.mkdir.mockResolvedValue(undefined);

            const task = await manager.createTask('brainbase', {
                name: '新規タスク',
                priority: 'high'
            });

            expect(task.id).toMatch(/^task-\d+$/);
            expect(task.name).toBe('新規タスク');
            expect(task.status).toBe('todo');

            const writeCall = fs.writeFile.mock.calls.find(c => c[0].includes('tasks.md'));
            expect(writeCall[1]).toContain('新規タスク');
            expect(writeCall[1]).toContain('_Priority: high_');
        });

        it('createTask呼び出し時_親タスクIDが設定される', async () => {
            fs.readFile.mockResolvedValue('');
            fs.writeFile.mockResolvedValue(undefined);
            fs.mkdir.mockResolvedValue(undefined);

            const task = await manager.createTask('brainbase', {
                name: '子タスク',
                parentId: 'task-parent'
            });

            expect(task.parentId).toBe('task-parent');

            const writeCall = fs.writeFile.mock.calls.find(c => c[0].includes('tasks.md'));
            expect(writeCall[1]).toContain('_Parent: task-parent_');
        });
    });

    describe('deleteTask', () => {
        it('deleteTask呼び出し時_tasks.mdから削除される', async () => {
            const tasksContent = `- [ ] タスク1
  - _ID: task-1_
- [ ] タスク2
  - _ID: task-2_`;

            fs.readFile.mockImplementation((path) => {
                if (path.includes('tasks.md')) return Promise.resolve(tasksContent);
                if (path.includes('done.md')) return Promise.resolve('');
                return Promise.reject({ code: 'ENOENT' });
            });
            fs.writeFile.mockResolvedValue(undefined);

            const result = await manager.deleteTask('brainbase', 'task-1');

            expect(result).toBe(true);
            const writeCall = fs.writeFile.mock.calls.find(c => c[0].includes('tasks.md'));
            expect(writeCall[1]).not.toContain('task-1');
            expect(writeCall[1]).toContain('task-2');
        });

        it('deleteTask呼び出し時_done.mdからも削除される', async () => {
            const doneContent = `- [x] 完了タスク
  - _ID: task-done-1_`;

            fs.readFile.mockImplementation((path) => {
                if (path.includes('tasks.md')) return Promise.resolve('');
                if (path.includes('done.md')) return Promise.resolve(doneContent);
                return Promise.reject({ code: 'ENOENT' });
            });
            fs.writeFile.mockResolvedValue(undefined);

            const result = await manager.deleteTask('brainbase', 'task-done-1');

            expect(result).toBe(true);
            const writeCall = fs.writeFile.mock.calls.find(c => c[0].includes('done.md'));
            expect(writeCall[1]).not.toContain('task-done-1');
        });
    });

    describe('updateTask', () => {
        it('updateTask呼び出し時_status以外のフィールドが更新される', async () => {
            const tasksContent = `- [ ] 古いタスク名
  - _ID: task-1_
  - _Priority: low_`;

            fs.readFile.mockImplementation((path) => {
                if (path.includes('tasks.md')) return Promise.resolve(tasksContent);
                if (path.includes('done.md')) return Promise.resolve('');
                return Promise.reject({ code: 'ENOENT' });
            });
            fs.writeFile.mockResolvedValue(undefined);

            const result = await manager.updateTask('brainbase', 'task-1', {
                name: '新しいタスク名',
                priority: 'high'
            });

            expect(result).toBe(true);
            const writeCall = fs.writeFile.mock.calls.find(c => c[0].includes('tasks.md'));
            expect(writeCall[1]).toContain('新しいタスク名');
            expect(writeCall[1]).toContain('_Priority: high_');
        });

        it('updateTask呼び出し時_status:doneでcompleteTaskが呼ばれる', async () => {
            const tasksContent = `- [ ] タスク
  - _ID: task-1_`;

            fs.readFile.mockImplementation((path) => {
                if (path.includes('tasks.md')) return Promise.resolve(tasksContent);
                if (path.includes('done.md')) return Promise.resolve('');
                return Promise.reject({ code: 'ENOENT' });
            });
            fs.writeFile.mockResolvedValue(undefined);
            fs.mkdir.mockResolvedValue(undefined);

            await manager.updateTask('brainbase', 'task-1', { status: 'done' });

            // done.md should have the task
            const doneWriteCall = fs.writeFile.mock.calls.find(c => c[0].includes('done.md'));
            expect(doneWriteCall[1]).toContain('task-1');
        });

        it('updateTask呼び出し時_status:todoでrestoreTaskが呼ばれる', async () => {
            const doneContent = `- [x] 完了タスク
  - _ID: task-1_`;

            fs.readFile.mockImplementation((path) => {
                if (path.includes('tasks.md')) return Promise.resolve('');
                if (path.includes('done.md')) return Promise.resolve(doneContent);
                return Promise.reject({ code: 'ENOENT' });
            });
            fs.writeFile.mockResolvedValue(undefined);
            fs.mkdir.mockResolvedValue(undefined);

            await manager.updateTask('brainbase', 'task-1', { status: 'todo' });

            // tasks.md should have the task
            const tasksWriteCall = fs.writeFile.mock.calls.find(c => c[0].includes('tasks.md'));
            expect(tasksWriteCall[1]).toContain('task-1');
        });

        it('updateTask呼び出し時_status:completedでもcompleteTaskが呼ばれる', async () => {
            const tasksContent = `- [ ] タスク
  - _ID: task-1_`;

            fs.readFile.mockImplementation((path) => {
                if (path.includes('tasks.md')) return Promise.resolve(tasksContent);
                if (path.includes('done.md')) return Promise.resolve('');
                return Promise.reject({ code: 'ENOENT' });
            });
            fs.writeFile.mockResolvedValue(undefined);
            fs.mkdir.mockResolvedValue(undefined);

            await manager.updateTask('brainbase', 'task-1', { status: 'completed' });

            // done.md should have the task (same as status: 'done')
            const doneWriteCall = fs.writeFile.mock.calls.find(c => c[0].includes('done.md'));
            expect(doneWriteCall[1]).toContain('task-1');
        });
    });
});
