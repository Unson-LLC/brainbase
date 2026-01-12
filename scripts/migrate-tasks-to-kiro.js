#!/usr/bin/env node
/**
 * Migration Script: YAML to Kiro Format
 *
 * Converts tasks from _tasks/index.md (YAML front matter format)
 * to _tasks/{project}/tasks.md and _tasks/{project}/done.md (Kiro markdown format)
 *
 * Usage:
 *   node scripts/migrate-tasks-to-kiro.js [--dry-run]
 *
 * Options:
 *   --dry-run  Preview changes without writing files
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { TaskParser } from '../lib/task-parser.js';
import { KiroTaskParser } from '../lib/kiro-task-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const BRAINBASE_ROOT = path.resolve(__dirname, '..');
const TASKS_DIR = path.join(BRAINBASE_ROOT, '_tasks');
const TASKS_FILE = path.join(TASKS_DIR, 'index.md');

/**
 * Main migration function
 */
async function migrate(options = { dryRun: false }) {
    const { dryRun } = options;
    console.log('='.repeat(60));
    console.log('Brainbase Task Migration: YAML -> Kiro Format');
    console.log('='.repeat(60));
    console.log(`Source: ${TASKS_FILE}`);
    console.log(`Target: ${TASKS_DIR}/{project}/tasks.md & done.md`);
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
    console.log('='.repeat(60));
    console.log('');

    // Check if source file exists
    try {
        await fs.access(TASKS_FILE);
    } catch {
        console.error(`Error: Source file not found: ${TASKS_FILE}`);
        process.exit(1);
    }

    // Parse existing tasks using YAML parser
    const yamlParser = new TaskParser(TASKS_FILE);
    const kiroParser = new KiroTaskParser();

    let tasks;
    try {
        tasks = await yamlParser.getAllTasks();
        console.log(`Found ${tasks.length} tasks in source file.`);
    } catch (error) {
        console.error('Error reading tasks:', error.message);
        process.exit(1);
    }

    if (tasks.length === 0) {
        console.log('No tasks to migrate.');
        return;
    }

    // Group tasks by project
    const projectGroups = {};
    for (const task of tasks) {
        const projectId = normalizeProjectId(task.project || 'inbox');
        if (!projectGroups[projectId]) {
            projectGroups[projectId] = { active: [], completed: [] };
        }
        if (task.status === 'done') {
            projectGroups[projectId].completed.push(task);
        } else {
            projectGroups[projectId].active.push(task);
        }
    }

    console.log('');
    console.log('Task distribution by project:');
    for (const [projectId, group] of Object.entries(projectGroups)) {
        console.log(`  ${projectId}: ${group.active.length} active, ${group.completed.length} completed`);
    }
    console.log('');

    // Generate Kiro format files
    const filesToWrite = [];

    for (const [projectId, group] of Object.entries(projectGroups)) {
        const projectDir = path.join(TASKS_DIR, projectId);
        const tasksPath = path.join(projectDir, 'tasks.md');
        const donePath = path.join(projectDir, 'done.md');

        // Generate tasks.md content
        if (group.active.length > 0) {
            let tasksContent = '';
            for (const task of group.active) {
                const kiroTask = convertToKiroFormat(task, kiroParser);
                tasksContent += kiroParser.serializeTask(kiroTask);
            }
            filesToWrite.push({ path: tasksPath, content: tasksContent, dir: projectDir });
        }

        // Generate done.md content
        if (group.completed.length > 0) {
            let doneContent = '';
            for (const task of group.completed) {
                const kiroTask = convertToKiroFormat(task, kiroParser);
                kiroTask.status = 'done';
                doneContent += kiroParser.serializeTask(kiroTask);
            }
            filesToWrite.push({ path: donePath, content: doneContent, dir: projectDir });
        }
    }

    // Write files
    console.log('Files to create/update:');
    for (const file of filesToWrite) {
        const relPath = path.relative(BRAINBASE_ROOT, file.path);
        console.log(`  ${relPath}`);

        if (!dryRun) {
            await fs.mkdir(file.dir, { recursive: true });
            await fs.writeFile(file.path, file.content, 'utf-8');
        }
    }

    console.log('');
    if (dryRun) {
        console.log('DRY RUN complete. No files were modified.');
        console.log('Run without --dry-run to perform the actual migration.');
    } else {
        console.log('Migration complete!');
        console.log('');
        console.log('Next steps:');
        console.log('1. Verify the migrated files in _tasks/{project}/ directories');
        console.log('2. Set KIRO_TASK_FORMAT=true environment variable');
        console.log('3. Restart the server');
        console.log('4. (Optional) Backup and remove _tasks/index.md after verification');
    }
}

/**
 * Normalize project ID for directory name
 * @param {string} project - Project name
 * @returns {string} - Normalized project ID
 */
function normalizeProjectId(project) {
    if (!project || project === 'general' || project === 'Inbox') {
        return 'inbox';
    }
    // Convert to lowercase, replace spaces with hyphens
    return project.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
}

/**
 * Convert YAML task to Kiro format
 * @param {Object} task - YAML format task
 * @param {KiroTaskParser} kiroParser - Kiro parser instance
 * @returns {Object} - Kiro format task
 */
function convertToKiroFormat(task, kiroParser) {
    return {
        id: task.id || kiroParser.generateId(),
        name: task.name || task.title || '(Untitled)',
        status: task.status === 'done' ? 'done' : 'todo',
        priority: task.priority || 'medium',
        due: task.due || task.deadline || null,
        parentId: task.parentId || null
    };
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// Run migration
migrate({ dryRun }).catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
});
