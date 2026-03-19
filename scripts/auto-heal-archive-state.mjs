#!/usr/bin/env node

import { exec } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { WorktreeService } from '../server/services/worktree-service.js';

const execPromise = promisify(exec);

function getArg(flag) {
    const index = process.argv.indexOf(flag);
    if (index === -1 || index === process.argv.length - 1) {
        return null;
    }

    return process.argv[index + 1];
}

const sessionId = getArg('--session-id');
const repoPath = getArg('--repo-path');
const workspacePath = getArg('--workspace-path');
const startCommit = getArg('--start-commit');

if (!sessionId || !repoPath || !workspacePath) {
    console.error(JSON.stringify({
        error: 'session-id, repo-path, workspace-path are required'
    }));
    process.exit(1);
}

const service = new WorktreeService(path.dirname(workspacePath), repoPath, execPromise);

try {
    const result = await service.autoHealArchiveState(
        sessionId,
        repoPath,
        workspacePath,
        startCommit || null
    );

    console.log(JSON.stringify(result));

    if (result.healed || result.reason === 'already_clean' || result.reason === 'nothing_to_fix') {
        process.exit(0);
    }

    process.exit(10);
} catch (error) {
    console.error(JSON.stringify({
        error: error.message
    }));
    process.exit(1);
}
