import fs from 'fs/promises';
import path from 'path';
import { KiroTaskParser } from './kiro-task-parser.js';

/**
 * Task Directory Scanner
 *
 * Scans _tasks/{project}/ directories and manages tasks across multiple projects.
 *
 * Directory structure:
 * _tasks/
 * ├── brainbase/
 * │   ├── tasks.md   <- Active tasks
 * │   └── done.md    <- Completed tasks
 * ├── madoguchi-ai/
 * │   ├── tasks.md
 * │   └── done.md
 * └── inbox/
 *     ├── tasks.md
 *     └── done.md
 */
export class TaskDirectoryScanner {
    /**
     * @param {string} rootPath - Root path to _tasks directory
     */
    constructor(rootPath) {
        this.rootPath = rootPath;
        this.parser = new KiroTaskParser();
    }

    /**
     * Scan for all project directories
     * @returns {Promise<Array>} - Array of { projectId, tasksPath, donePath, dirPath }
     */
    async scanProjects() {
        try {
            const entries = await fs.readdir(this.rootPath, { withFileTypes: true });
            const projects = [];

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const paths = this.getProjectPath(entry.name);
                    projects.push({
                        projectId: entry.name,
                        ...paths
                    });
                }
            }

            return projects;
        } catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    /**
     * Get paths for a specific project
     * @param {string} projectId - Project ID
     * @returns {Object} - { tasksPath, donePath, dirPath }
     */
    getProjectPath(projectId) {
        const dirPath = path.join(this.rootPath, projectId);
        return {
            tasksPath: path.join(dirPath, 'tasks.md'),
            donePath: path.join(dirPath, 'done.md'),
            dirPath
        };
    }

    /**
     * Get all active tasks from all projects
     * @returns {Promise<Array>} - Array of task objects
     */
    async getActiveTasks() {
        const projects = await this.scanProjects();
        const allTasks = [];

        for (const project of projects) {
            try {
                const content = await fs.readFile(project.tasksPath, 'utf-8');
                const tasks = this.parser.parseFile(content, project.projectId);
                allTasks.push(...tasks);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    console.error(`Error reading tasks for ${project.projectId}:`, error);
                }
                // Skip projects without tasks.md
            }
        }

        return allTasks;
    }

    /**
     * Get all completed tasks from all projects
     * @returns {Promise<Array>} - Array of completed task objects
     */
    async getCompletedTasks() {
        const projects = await this.scanProjects();
        const allTasks = [];

        for (const project of projects) {
            try {
                const content = await fs.readFile(project.donePath, 'utf-8');
                const tasks = this.parser.parseFile(content, project.projectId);
                allTasks.push(...tasks);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    console.error(`Error reading done tasks for ${project.projectId}:`, error);
                }
                // Skip projects without done.md
            }
        }

        return allTasks;
    }

    /**
     * Get active tasks for a specific project
     * @param {string} projectId - Project ID
     * @returns {Promise<Array>} - Array of task objects
     */
    async getProjectTasks(projectId) {
        const paths = this.getProjectPath(projectId);
        try {
            const content = await fs.readFile(paths.tasksPath, 'utf-8');
            return this.parser.parseFile(content, projectId);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    /**
     * Get completed tasks for a specific project
     * @param {string} projectId - Project ID
     * @returns {Promise<Array>} - Array of task objects
     */
    async getProjectCompletedTasks(projectId) {
        const paths = this.getProjectPath(projectId);
        try {
            const content = await fs.readFile(paths.donePath, 'utf-8');
            return this.parser.parseFile(content, projectId);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    /**
     * Ensure project directory exists
     * @param {string} projectId - Project ID
     */
    async ensureProjectDir(projectId) {
        const paths = this.getProjectPath(projectId);
        await fs.mkdir(paths.dirPath, { recursive: true });
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
     * Write file content
     * @param {string} filePath - Path to file
     * @param {string} content - Content to write
     */
    async writeFile(filePath, content) {
        await fs.writeFile(filePath, content, 'utf-8');
    }

    /**
     * Find a task by ID across all projects
     * @param {string} taskId - Task ID to find
     * @returns {Promise<Object|null>} - { task, projectId, filePath, fileType } or null
     */
    async findTaskById(taskId) {
        const projects = await this.scanProjects();

        for (const project of projects) {
            // Check tasks.md
            try {
                const tasksContent = await fs.readFile(project.tasksPath, 'utf-8');
                const found = this.parser.findTaskById(tasksContent, taskId);
                if (found) {
                    return {
                        task: found.task,
                        projectId: project.projectId,
                        filePath: project.tasksPath,
                        fileType: 'tasks'
                    };
                }
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    console.error(`Error searching tasks for ${project.projectId}:`, error);
                }
            }

            // Check done.md
            try {
                const doneContent = await fs.readFile(project.donePath, 'utf-8');
                const found = this.parser.findTaskById(doneContent, taskId);
                if (found) {
                    return {
                        task: found.task,
                        projectId: project.projectId,
                        filePath: project.donePath,
                        fileType: 'done'
                    };
                }
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    console.error(`Error searching done tasks for ${project.projectId}:`, error);
                }
            }
        }

        return null;
    }
}
