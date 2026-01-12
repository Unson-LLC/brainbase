import fs from 'fs/promises';
import path from 'path';
import { KiroTaskParser } from './kiro-task-parser.js';

/**
 * Task File Manager
 *
 * Handles task operations including moving tasks between tasks.md and done.md
 * when status changes.
 */
export class TaskFileManager {
    /**
     * @param {string} rootPath - Root path to _tasks directory
     */
    constructor(rootPath) {
        this.rootPath = rootPath;
        this.parser = new KiroTaskParser();
        this.mutex = Promise.resolve();
    }

    /**
     * Run an operation atomically with mutex
     * @param {Function} operation - Operation to run
     * @returns {Promise<any>} - Result of operation
     */
    async runAtomic(operation) {
        const result = this.mutex.then(() => operation().catch(err => {
            console.error('Atomic operation failed:', err);
            throw err;
        }));
        this.mutex = result.catch(() => {});
        return result;
    }

    /**
     * Get paths for a project
     * @param {string} projectId - Project ID
     * @returns {Object} - { tasksPath, donePath, dirPath }
     */
    getProjectPaths(projectId) {
        const dirPath = path.join(this.rootPath, projectId);
        return {
            tasksPath: path.join(dirPath, 'tasks.md'),
            donePath: path.join(dirPath, 'done.md'),
            dirPath
        };
    }

    /**
     * Read file content safely
     * @param {string} filePath - Path to file
     * @returns {Promise<string>} - File content or empty string
     */
    async readFileSafe(filePath) {
        try {
            return await fs.readFile(filePath, 'utf-8');
        } catch (error) {
            if (error.code === 'ENOENT') {
                return '';
            }
            throw error;
        }
    }

    /**
     * Ensure project directory exists
     * @param {string} projectId - Project ID
     */
    async ensureProjectDir(projectId) {
        const paths = this.getProjectPaths(projectId);
        await fs.mkdir(paths.dirPath, { recursive: true });
    }

    /**
     * Complete a task (move from tasks.md to done.md)
     * @param {string} projectId - Project ID
     * @param {string} taskId - Task ID to complete
     * @returns {Promise<boolean>} - Success status
     */
    async completeTask(projectId, taskId) {
        return this.runAtomic(async () => {
            const paths = this.getProjectPaths(projectId);
            await this.ensureProjectDir(projectId);

            // Read tasks.md
            const tasksContent = await this.readFileSafe(paths.tasksPath);

            // Find and remove task from tasks.md
            const { content: newTasksContent, removedTask } = this.parser.removeTask(tasksContent, taskId);

            if (!removedTask) {
                return false;
            }

            // Create completed task object
            const completedTask = {
                id: taskId,
                name: removedTask.name,
                status: 'done',
                priority: removedTask.metadata?.Priority,
                due: removedTask.metadata?.Due,
                parentId: removedTask.metadata?.Parent
            };

            // Read done.md and append task
            const doneContent = await this.readFileSafe(paths.donePath);
            const newDoneContent = this.parser.appendTask(doneContent, completedTask);

            // Write both files
            await fs.writeFile(paths.tasksPath, newTasksContent, 'utf-8');
            await fs.writeFile(paths.donePath, newDoneContent, 'utf-8');

            return true;
        });
    }

    /**
     * Restore a task (move from done.md to tasks.md)
     * @param {string} projectId - Project ID
     * @param {string} taskId - Task ID to restore
     * @param {string} newStatus - New status (default: 'todo', can be 'in_progress')
     * @returns {Promise<boolean>} - Success status
     */
    async restoreTask(projectId, taskId, newStatus = 'todo') {
        return this.runAtomic(async () => {
            const paths = this.getProjectPaths(projectId);
            await this.ensureProjectDir(projectId);

            // Read done.md
            const doneContent = await this.readFileSafe(paths.donePath);

            // Find and remove task from done.md
            const { content: newDoneContent, removedTask } = this.parser.removeTask(doneContent, taskId);

            if (!removedTask) {
                return false;
            }

            // Create active task object
            const activeTask = {
                id: taskId,
                name: removedTask.name,
                status: newStatus,
                priority: removedTask.metadata?.Priority,
                due: removedTask.metadata?.Due,
                parentId: removedTask.metadata?.Parent
            };

            // Read tasks.md and append task
            const tasksContent = await this.readFileSafe(paths.tasksPath);
            const newTasksContent = this.parser.appendTask(tasksContent, activeTask);

            // Write both files
            await fs.writeFile(paths.donePath, newDoneContent, 'utf-8');
            await fs.writeFile(paths.tasksPath, newTasksContent, 'utf-8');

            return true;
        });
    }

    /**
     * Restore or update task status (handles both done.md -> tasks.md move and in-place update)
     * @param {string} projectId - Project ID
     * @param {string} taskId - Task ID
     * @param {string} newStatus - New status ('todo', 'in_progress', etc.)
     * @returns {Promise<boolean>} - Success status
     */
    async restoreOrUpdateTask(projectId, taskId, newStatus) {
        return this.runAtomic(async () => {
            const paths = this.getProjectPaths(projectId);
            await this.ensureProjectDir(projectId);

            // First, try to find task in tasks.md (most common case)
            let tasksContent = await this.readFileSafe(paths.tasksPath);
            let found = this.parser.findTaskById(tasksContent, taskId);

            if (found) {
                // Task is in tasks.md - update in place
                const { content: contentWithoutTask } = this.parser.removeTask(tasksContent, taskId);

                const updatedTask = {
                    id: taskId,
                    name: found.task.name,
                    status: newStatus,
                    priority: found.task.metadata?.Priority,
                    due: found.task.metadata?.Due,
                    parentId: found.task.metadata?.Parent,
                    description: found.task.metadata?.Description
                };

                const newContent = this.parser.appendTask(contentWithoutTask, updatedTask);
                await fs.writeFile(paths.tasksPath, newContent, 'utf-8');
                return true;
            }

            // Not in tasks.md - try done.md (restore case)
            const doneContent = await this.readFileSafe(paths.donePath);
            found = this.parser.findTaskById(doneContent, taskId);

            if (found) {
                // Task is in done.md - move to tasks.md with new status
                const { content: newDoneContent } = this.parser.removeTask(doneContent, taskId);

                const activeTask = {
                    id: taskId,
                    name: found.task.name,
                    status: newStatus,
                    priority: found.task.metadata?.Priority,
                    due: found.task.metadata?.Due,
                    parentId: found.task.metadata?.Parent,
                    description: found.task.metadata?.Description
                };

                const newTasksContent = this.parser.appendTask(tasksContent, activeTask);

                await fs.writeFile(paths.donePath, newDoneContent, 'utf-8');
                await fs.writeFile(paths.tasksPath, newTasksContent, 'utf-8');
                return true;
            }

            return false;
        });
    }

    /**
     * Create a new task
     * @param {string} projectId - Project ID
     * @param {Object} taskData - Task data { name, priority?, due?, parentId?, description? }
     * @returns {Promise<Object>} - Created task object
     */
    async createTask(projectId, taskData) {
        return this.runAtomic(async () => {
            const paths = this.getProjectPaths(projectId);
            await this.ensureProjectDir(projectId);

            // Generate ID
            const id = this.parser.generateId();

            // Create task object
            const task = {
                id,
                name: taskData.name,
                status: 'todo',
                project: projectId,
                priority: taskData.priority || 'medium',
                due: taskData.due || null,
                parentId: taskData.parentId || null,
                description: taskData.description || null
            };

            // Read and append to tasks.md
            const tasksContent = await this.readFileSafe(paths.tasksPath);
            const newContent = this.parser.appendTask(tasksContent, task);

            await fs.writeFile(paths.tasksPath, newContent, 'utf-8');

            return task;
        });
    }

    /**
     * Delete a task
     * @param {string} projectId - Project ID
     * @param {string} taskId - Task ID to delete
     * @returns {Promise<boolean>} - Success status
     */
    async deleteTask(projectId, taskId) {
        return this.runAtomic(async () => {
            const paths = this.getProjectPaths(projectId);

            // Try to remove from tasks.md
            const tasksContent = await this.readFileSafe(paths.tasksPath);
            const { content: newTasksContent, removedTask: removedFromTasks } = this.parser.removeTask(tasksContent, taskId);

            if (removedFromTasks) {
                await fs.writeFile(paths.tasksPath, newTasksContent, 'utf-8');
                return true;
            }

            // Try to remove from done.md
            const doneContent = await this.readFileSafe(paths.donePath);
            const { content: newDoneContent, removedTask: removedFromDone } = this.parser.removeTask(doneContent, taskId);

            if (removedFromDone) {
                await fs.writeFile(paths.donePath, newDoneContent, 'utf-8');
                return true;
            }

            return false;
        });
    }

    /**
     * Update a task
     * @param {string} projectId - Project ID
     * @param {string} taskId - Task ID to update
     * @param {Object} updates - Updates { name?, priority?, due?, status? }
     * @returns {Promise<boolean>} - Success status
     */
    async updateTask(projectId, taskId, updates) {
        // Handle status changes specially
        // Support both 'done' and 'completed' status values
        if (updates.status === 'done' || updates.status === 'completed') {
            return this.completeTask(projectId, taskId);
        }
        // Handle todo and in_progress: restore from done.md if needed, or update in place
        if (updates.status === 'todo' || updates.status === 'in_progress' || updates.status === 'in-progress') {
            return this.restoreOrUpdateTask(projectId, taskId, updates.status);
        }

        return this.runAtomic(async () => {
            const paths = this.getProjectPaths(projectId);

            // Try to update in tasks.md
            let content = await this.readFileSafe(paths.tasksPath);
            let found = this.parser.findTaskById(content, taskId);
            let filePath = paths.tasksPath;

            // If not found in tasks.md, try done.md
            if (!found) {
                content = await this.readFileSafe(paths.donePath);
                found = this.parser.findTaskById(content, taskId);
                filePath = paths.donePath;
            }

            if (!found) {
                return false;
            }

            // Remove old task
            const { content: contentWithoutTask } = this.parser.removeTask(content, taskId);

            // Create updated task
            // Determine status: use updates.status if provided, otherwise keep original
            const originalStatus = found.task.status || found.task.metadata?.Status || 'todo';
            const newStatus = updates.status !== undefined ? updates.status : originalStatus;

            const updatedTask = {
                id: taskId,
                name: updates.name || found.task.name,
                status: newStatus,
                priority: updates.priority || found.task.metadata?.Priority,
                due: updates.due !== undefined ? updates.due : found.task.metadata?.Due,
                parentId: found.task.metadata?.Parent,
                description: updates.description !== undefined ? updates.description : found.task.metadata?.Description
            };

            // Append updated task
            const newContent = this.parser.appendTask(contentWithoutTask, updatedTask);

            await fs.writeFile(filePath, newContent, 'utf-8');

            return true;
        });
    }

    /**
     * Find task location (which file and project)
     * @param {string} taskId - Task ID
     * @returns {Promise<Object|null>} - { projectId, fileType, task } or null
     */
    async findTask(taskId) {
        try {
            const entries = await fs.readdir(this.rootPath, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                const projectId = entry.name;
                const paths = this.getProjectPaths(projectId);

                // Check tasks.md
                const tasksContent = await this.readFileSafe(paths.tasksPath);
                let found = this.parser.findTaskById(tasksContent, taskId);
                if (found) {
                    return { projectId, fileType: 'tasks', task: found.task };
                }

                // Check done.md
                const doneContent = await this.readFileSafe(paths.donePath);
                found = this.parser.findTaskById(doneContent, taskId);
                if (found) {
                    return { projectId, fileType: 'done', task: found.task };
                }
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }

        return null;
    }
}
