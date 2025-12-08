import fs from 'fs/promises';
import path from 'path';

export class TaskParser {
    constructor(tasksFilePath) {
        this.tasksFilePath = tasksFilePath;
        this.mutex = Promise.resolve();
    }

    async getAllTasks() {
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
                        if (key.trim() === 'id') {
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
        return this.runAtomic(async () => {
            try {
                const content = await fs.readFile(this.tasksFilePath, 'utf-8');
                const blocks = content.split(/^---$/gm);
                let updated = false;

                const newBlocks = blocks.map(block => {
                    if (!block.trim()) return block;

                    // Check if this block has the target ID
                    if (block.includes(`id: ${taskId}`)) {
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
        return this.runAtomic(async () => {
            try {
                const content = await fs.readFile(this.tasksFilePath, 'utf-8');
                const blocks = content.split(/^---$/gm);

                // Filter out the block with the matching ID
                const newBlocks = blocks.filter(block => {
                    if (!block.trim()) return true; // Keep empty blocks (separators) if needed, but split creates them
                    return !block.includes(`id: ${taskId}`);
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
}
