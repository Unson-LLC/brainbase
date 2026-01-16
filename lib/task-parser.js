import fs from 'fs/promises';
import path from 'path';
import { TaskDirectoryScanner } from './task-directory-scanner.js';
import { TaskFileManager } from './task-file-manager.js';

export class TaskParser {
    /**
     * @param {string} tasksFilePath - Path to tasks file (YAML mode) or _tasks directory (Kiro mode)
     * @param {Object} options - Configuration options
     * @param {boolean} options.useKiroFormat - Use Kiro markdown format with directory structure
     */
    constructor(tasksFilePath, options = {}) {
        this.tasksFilePath = tasksFilePath;
        this.mutex = Promise.resolve();

        // Kiro format support
        this.useKiroFormat = options.useKiroFormat ?? false;

        if (this.useKiroFormat) {
            // In Kiro mode, tasksFilePath should point to _tasks directory
            this.tasksDir = tasksFilePath;
            this.scanner = new TaskDirectoryScanner(this.tasksDir);
            this.fileManager = new TaskFileManager(this.tasksDir);
        }
    }

    async getAllTasks() {
        // Kiro format: Use scanner to get tasks from all project directories
        if (this.useKiroFormat) {
            try {
                return await this.scanner.getActiveTasks();
            } catch (error) {
                console.error('Error reading Kiro tasks:', error);
                return [];
            }
        }

        // YAML format: Original implementation
        return this.runAtomic(async () => {
            try {
                const markdown = await fs.readFile(this.tasksFilePath, 'utf-8');
                return this.parseMarkdown(markdown);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    return [];
                }
                console.error('Error reading tasks:', error);
                return [];
            }
        });
    }

    /**
     * Get completed tasks (Kiro format only)
     * @returns {Promise<Array>} - Array of completed tasks
     */
    async getCompletedTasks() {
        if (!this.useKiroFormat) {
            // In YAML mode, completed tasks are in the same file
            const allTasks = await this.getAllTasks();
            return allTasks.filter(t => t.status === 'done');
        }

        try {
            return await this.scanner.getCompletedTasks();
        } catch (error) {
            console.error('Error reading completed tasks:', error);
            return [];
        }
    }

    async runAtomic(operation) {
        // Queue operations
        const result = this.mutex.then(() => operation().catch(err => {
            console.error('Atomic operation failed:', err);
            throw err;
        }));
        // Ensure mutex always resolves so queue doesn't get stuck
        this.mutex = result.catch(() => { });
        return result;
    }

    async getTasks() {
        try {
            const content = await fs.readFile(this.tasksFilePath, 'utf-8');
            // We don't use front-matter lib for the whole file anymore as we handle multiple blocks
            return this.parseMarkdown(content);
        } catch (error) {
            console.error('Error reading tasks file:', error);
            return [];
        }
    }

    parseMarkdown(markdown) {
        // Split by '---' to get blocks
        const blocks = markdown.split(/^---$/gm);
        const tasks = [];

        for (const block of blocks) {
            if (!block.trim()) continue;

            try {
                const lines = block.trim().split('\n');
                const task = {};
                let isTaskBlock = false;

                for (const line of lines) {
                    const [key, ...values] = line.split(':');
                    if (key && values.length > 0) {
                        const value = values.join(':').trim();

                        if (key.trim() === 'title') task.name = value;
                        if (key.trim() === 'status') task.status = this.mapStatus(value);
                        if (key.trim() === 'priority') task.priority = value;
                        if (key.trim() === 'due') task.due = value === 'null' ? null : value;
                        if (key.trim() === 'project_id') task.project = value;
                        if (key.trim() === 'owner') task.owner = value;
                        if (key.trim() === 'id' || key.trim() === 'task_id') {
                            task.id = value;
                            isTaskBlock = true;
                        }
                    }
                }

                if (isTaskBlock && task.name) {
                    // Default values
                    if (!task.status) task.status = 'todo';
                    if (!task.priority) task.priority = 'normal';
                    if (!task.project) task.project = 'Inbox';

                    tasks.push(task);
                }
            } catch (e) {
                console.warn('Failed to parse block:', e);
            }
        }

        // Also parse legacy list items if any (fallback)
        const legacyTasks = this.parseLegacyMarkdown(markdown);
        return [...tasks, ...legacyTasks];
    }

    parseLegacyMarkdown(markdown) {
        const lines = markdown.split('\n');
        const tasks = [];
        let currentProject = 'Inbox';

        for (const line of lines) {
            // Detect Project/Section headers
            if (line.startsWith('# ')) {
                currentProject = line.replace('# ', '').trim();
                continue;
            }
            if (line.startsWith('## ')) {
                currentProject = line.replace('## ', '').trim();
                continue;
            }

            // Detect Task Items
            // Matches: - [ ] Task Name (due: 2024-12-31) !high
            const taskMatch = line.match(/^(\s*)-\s*\[( |x|\/|\?)\]\s*(.+)$/);
            if (taskMatch) {
                const [_, indent, statusChar, textRaw] = taskMatch;
                const status = this.mapLegacyStatus(statusChar);
                const { text, priority, due, tags } = this.parseTaskMetadata(textRaw);

                tasks.push({
                    id: Buffer.from(text + currentProject).toString('base64').substring(0, 8),
                    name: text,
                    status,
                    project: currentProject,
                    priority,
                    due,
                    tags,
                    raw: line
                });
            }
        }
        return tasks;
    }

    mapStatus(status) {
        // Map YAML status to UI status
        switch (status.toLowerCase()) {
            case 'done': return 'done';
            case 'in-progress': return 'in-progress';
            case 'todo': return 'todo';
            default: return 'todo';
        }
    }

    mapLegacyStatus(char) {
        switch (char) {
            case 'x': return 'done';
            case '/': return 'in-progress';
            case '?': return 'blocked';
            default: return 'todo';
        }
    }

    parseTaskMetadata(text) {
        let cleanText = text;
        let priority = 'normal';
        let due = null;
        const tags = [];

        // Extract Priority (!high, !med, !low)
        if (cleanText.includes('!high')) {
            priority = 'high';
            cleanText = cleanText.replace('!high', '');
        } else if (cleanText.includes('!med')) {
            priority = 'medium';
            cleanText = cleanText.replace('!med', '');
        } else if (cleanText.includes('!low')) {
            priority = 'low';
            cleanText = cleanText.replace('!low', '');
        }

        // Extract Due Date (due: YYYY-MM-DD)
        const dueMatch = cleanText.match(/\(due:\s*(\d{4}-\d{2}-\d{2})\)/);
        if (dueMatch) {
            due = dueMatch[1];
            cleanText = cleanText.replace(dueMatch[0], '');
        }

        // Extract Tags (#tag)
        const tagMatches = cleanText.match(/#[\w-]+/g);
        if (tagMatches) {
            tags.push(...tagMatches.map(t => t.replace('#', '')));
            cleanText = cleanText.replace(/#[\w-]+/g, '');
        }

        return {
            text: cleanText.trim(),
            priority,
            due,
            tags
        };
    }

    async updateTask(taskId, updates) {
        // Kiro format: Use file manager to update task
        if (this.useKiroFormat) {
            try {
                // Find which project the task belongs to
                const taskInfo = await this.fileManager.findTask(taskId);
                if (!taskInfo) {
                    console.warn(`Task ${taskId} not found in Kiro format.`);
                    return false;
                }

                return await this.fileManager.updateTask(taskInfo.projectId, taskId, updates);
            } catch (error) {
                console.error('Error updating Kiro task:', error);
                return false;
            }
        }

        // YAML format: Original implementation
        return this.runAtomic(async () => {
            try {
                const content = await fs.readFile(this.tasksFilePath, 'utf-8');
                const blocks = content.split(/^---$/gm);
                let updated = false;

                const newBlocks = blocks.map(block => {
                    if (!block.trim()) return block;

                    // Check if this block has the target ID (supports both id: and task_id:)
                    if (block.includes(`id: ${taskId}`) || block.includes(`task_id: ${taskId}`)) {
                        updated = true;
                        let newBlock = block;

                        // Apply updates
                        for (const [key, value] of Object.entries(updates)) {
                            // Map UI keys to YAML keys
                            let yamlKey = key;
                            if (key === 'project') yamlKey = 'project_id';
                            if (key === 'name') yamlKey = 'title';

                            const regex = new RegExp(`${yamlKey}:\\s*.*`);
                            const newValue = value === null ? 'null' : value;

                            if (regex.test(newBlock)) {
                                newBlock = newBlock.replace(regex, `${yamlKey}: ${newValue}`);
                            } else {
                                // If key doesn't exist, we skip for now to avoid breaking format
                                console.warn(`Key ${yamlKey} not found in block for task ${taskId}, skipping update.`);
                            }
                        }
                        return newBlock;
                    }
                    return block;
                });

                if (updated) {
                    await fs.writeFile(this.tasksFilePath, newBlocks.join('---'), 'utf-8');
                    return true;
                }

                console.warn(`Task ${taskId} not found in YAML blocks.`);
                return false;

            } catch (error) {
                console.error('Error updating task:', error);
                return false;
            }
        });
    }

    async deleteTask(taskId) {
        // Kiro format: Use file manager to delete task
        if (this.useKiroFormat) {
            try {
                // Find which project the task belongs to
                const taskInfo = await this.fileManager.findTask(taskId);
                if (!taskInfo) {
                    console.warn(`Task ${taskId} not found in Kiro format for deletion.`);
                    return false;
                }

                return await this.fileManager.deleteTask(taskInfo.projectId, taskId);
            } catch (error) {
                console.error('Error deleting Kiro task:', error);
                return false;
            }
        }

        // YAML format: Original implementation
        return this.runAtomic(async () => {
            try {
                const content = await fs.readFile(this.tasksFilePath, 'utf-8');
                const blocks = content.split(/^---$/gm);

                // Filter out the block with the matching ID (supports both id: and task_id:)
                const newBlocks = blocks.filter(block => {
                    if (!block.trim()) return true; // Keep empty blocks (separators) if needed, but split creates them
                    return !block.includes(`id: ${taskId}`) && !block.includes(`task_id: ${taskId}`);
                });

                if (newBlocks.length < blocks.length) {
                    await fs.writeFile(this.tasksFilePath, newBlocks.join('---'), 'utf-8');
                    return true;
                }

                console.warn(`Task ${taskId} not found for deletion.`);
                return false;

            } catch (error) {
                console.error('Error deleting task:', error);
                return false;
            }
        });
    }

    async createTask(taskData) {
        // Kiro format: Use file manager to create task
        if (this.useKiroFormat) {
            try {
                const projectId = taskData.project || 'inbox';
                return await this.fileManager.createTask(projectId, {
                    name: taskData.title,
                    priority: taskData.priority,
                    due: taskData.due,
                    parentId: taskData.parentId,
                    description: taskData.description
                });
            } catch (error) {
                console.error('Error creating Kiro task:', error);
                throw error;
            }
        }

        // YAML format: Original implementation
        return this.runAtomic(async () => {
            try {
                let content = '';
                try {
                    content = await fs.readFile(this.tasksFilePath, 'utf-8');
                } catch (err) {
                    if (err.code !== 'ENOENT') throw err;
                    // File doesn't exist, will create new
                }

                const taskId = `task-${Date.now()}`;
                const createdAt = new Date().toISOString().split('T')[0];

                // Build YAML block
                const newBlock = `
---
id: ${taskId}
title: ${taskData.title}
status: todo
priority: ${taskData.priority || 'medium'}
project_id: ${taskData.project || 'general'}
due: ${taskData.due || 'null'}
description: ${taskData.description || ''}
created: ${createdAt}
---`;

                // Append to file
                await fs.writeFile(this.tasksFilePath, content + newBlock, 'utf-8');

                return {
                    id: taskId,
                    name: taskData.title,
                    status: 'todo',
                    priority: taskData.priority || 'medium',
                    project: taskData.project || 'general',
                    due: taskData.due || null,
                    description: taskData.description || '',
                    created: createdAt
                };
            } catch (error) {
                console.error('Error creating task:', error);
                throw error;
            }
        });
    }
}
