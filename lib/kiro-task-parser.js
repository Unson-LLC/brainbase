/**
 * Kiro-style Markdown Task Parser
 *
 * Parses tasks in the format:
 * - [ ] Task name
 *   - _ID: task-123_
 *   - _Priority: high_
 *   - _Due: 2025-01-15_
 *   - _Parent: task-parent_
 *   - _Description: Task description_
 */

export class KiroTaskParser {
    constructor() {
        // Checkbox pattern: - [ ] or - [x] or - [X]
        this.checkboxRegex = /^(\s*)-\s*\[([xX ])\]\s*(.+)$/;
        // Metadata pattern: - _Key: value_
        this.metadataRegex = /^\s*-\s*_([^:]+):\s*([^_]+)_\s*$/;
        // Counter for unique ID generation
        this._lastTimestamp = 0;
    }

    /**
     * Parse a checkbox line
     * @param {string} line - Line to parse
     * @returns {Object|null} - Parsed task info or null if not a checkbox
     */
    parseCheckbox(line) {
        const match = line.match(this.checkboxRegex);
        if (!match) {
            return null;
        }

        const [, indent, checkState, text] = match;
        const status = checkState.toLowerCase() === 'x' ? 'done' : 'todo';

        return {
            status,
            name: text.trim(),
            indent: indent.length,
            lineNumber: null // Will be set during file parsing
        };
    }

    /**
     * Parse a metadata line
     * @param {string} line - Line to parse
     * @returns {Object|null} - Parsed metadata or null if not metadata
     */
    parseMetadata(line) {
        const match = line.match(this.metadataRegex);
        if (!match) {
            return null;
        }

        const [, key, value] = match;
        return { [key]: value.trim() };
    }

    /**
     * Parse file content into tasks
     * @param {string} content - File content
     * @param {string} projectId - Project ID (from directory name)
     * @returns {Array} - Array of task objects
     */
    parseFile(content, projectId) {
        if (!content || !content.trim()) {
            return [];
        }

        const lines = content.split('\n');
        const tasks = [];
        let currentTask = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Try to parse as checkbox (new task)
            const checkbox = this.parseCheckbox(line);
            if (checkbox) {
                // Save previous task if it has an ID (ID is in metadata.ID)
                if (currentTask && currentTask.metadata.ID) {
                    tasks.push(this._finalizeTask(currentTask, projectId));
                }

                // Start new task
                currentTask = {
                    ...checkbox,
                    lineNumber: i + 1,
                    metadata: {}
                };
                continue;
            }

            // Try to parse as metadata (belongs to current task)
            const metadata = this.parseMetadata(line);
            if (metadata && currentTask) {
                Object.assign(currentTask.metadata, metadata);
            }
        }

        // Don't forget the last task
        if (currentTask && currentTask.metadata.ID) {
            tasks.push(this._finalizeTask(currentTask, projectId));
        }

        return tasks;
    }

    /**
     * Finalize a task object with proper field names
     * @param {Object} task - Raw task object
     * @param {string} projectId - Project ID
     * @returns {Object} - Finalized task object
     */
    _finalizeTask(task, projectId) {
        return {
            id: task.metadata.ID,
            name: task.name,
            status: task.status,
            project: projectId,
            priority: task.metadata.Priority || 'medium',
            due: task.metadata.Due || null,
            parentId: task.metadata.Parent || null,
            description: task.metadata.Description || null,
            lineNumber: task.lineNumber
        };
    }

    /**
     * Generate a unique task ID
     * @returns {string} - Unique task ID in format task-{timestamp}
     */
    generateId() {
        let timestamp = Date.now();
        // Ensure uniqueness even if called multiple times in same millisecond
        if (timestamp <= this._lastTimestamp) {
            timestamp = this._lastTimestamp + 1;
        }
        this._lastTimestamp = timestamp;
        return `task-${timestamp}`;
    }

    /**
     * Serialize a task object to Kiro markdown format
     * @param {Object} task - Task object
     * @returns {string} - Markdown formatted task
     */
    serializeTask(task) {
        const checkbox = task.status === 'done' ? '[x]' : '[ ]';
        const lines = [`- ${checkbox} ${task.name}`];

        // ID is required
        lines.push(`  - _ID: ${task.id}_`);

        // Optional fields
        if (task.priority && task.priority !== 'medium') {
            lines.push(`  - _Priority: ${task.priority}_`);
        }

        if (task.due) {
            lines.push(`  - _Due: ${task.due}_`);
        }

        if (task.parentId) {
            lines.push(`  - _Parent: ${task.parentId}_`);
        }

        if (task.description) {
            lines.push(`  - _Description: ${task.description}_`);
        }

        return lines.join('\n') + '\n';
    }

    /**
     * Find a task by ID in content and return its line range
     * @param {string} content - File content
     * @param {string} taskId - Task ID to find
     * @returns {Object|null} - { startLine, endLine, task } or null
     */
    findTaskById(content, taskId) {
        const lines = content.split('\n');
        let currentTaskStart = null;
        let currentTask = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // New task starts
            const checkbox = this.parseCheckbox(line);
            if (checkbox) {
                // Check if previous task was the one we're looking for
                if (currentTask && currentTask.id === taskId) {
                    return {
                        startLine: currentTaskStart,
                        endLine: i - 1,
                        task: currentTask
                    };
                }

                currentTaskStart = i;
                currentTask = { ...checkbox, metadata: {} };
                continue;
            }

            // Metadata for current task
            const metadata = this.parseMetadata(line);
            if (metadata && currentTask) {
                Object.assign(currentTask.metadata, metadata);
                if (metadata.ID) {
                    currentTask.id = metadata.ID;
                }
            }
        }

        // Check last task
        if (currentTask && currentTask.id === taskId) {
            return {
                startLine: currentTaskStart,
                endLine: lines.length - 1,
                task: currentTask
            };
        }

        return null;
    }

    /**
     * Remove a task from content by ID
     * @param {string} content - File content
     * @param {string} taskId - Task ID to remove
     * @returns {Object} - { content: string, removedTask: Object|null }
     */
    removeTask(content, taskId) {
        const found = this.findTaskById(content, taskId);
        if (!found) {
            return { content, removedTask: null };
        }

        const lines = content.split('\n');
        const before = lines.slice(0, found.startLine);
        const after = lines.slice(found.endLine + 1);

        // Remove trailing empty line if present
        if (before.length > 0 && before[before.length - 1] === '') {
            before.pop();
        }

        return {
            content: [...before, ...after].join('\n'),
            removedTask: found.task
        };
    }

    /**
     * Append a task to content
     * @param {string} content - File content
     * @param {Object} task - Task object to append
     * @returns {string} - Updated content
     */
    appendTask(content, task) {
        const serialized = this.serializeTask(task);
        const trimmed = content.trim();

        if (!trimmed) {
            return serialized;
        }

        return trimmed + '\n' + serialized;
    }
}
