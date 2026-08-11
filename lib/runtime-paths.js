import path from 'path';

function normalizePath(value) {
    if (!value) return null;
    return path.resolve(value);
}

function inferWorkspaceRoot(repoDir) {
    const resolved = normalizePath(repoDir);
    const patterns = [
        /(.*)\/workspace\/code\/[^/]+$/,
        /(.*)\/workspace\/projects\/[^/]+$/,
        /(.*)\/workspace\/shared(?:\/.*)?$/,
        /(.*)\/workspace\/[^/]+\/\.worktrees\/[^/]+(?:\/.*)?$/
    ];

    for (const pattern of patterns) {
        const match = resolved.match(pattern);
        if (match) {
            return path.join(match[1], 'workspace');
        }
    }

    const codeParent = path.dirname(path.dirname(resolved));
    return codeParent;
}

export function resolveRuntimePaths({
    repoDir,
    env = process.env,
    statePath = env.BRAINBASE_STATE_PATH,
    varDir = env.BRAINBASE_VAR_DIR
} = {}) {
    const workspaceRoot = normalizePath(env.WORKSPACE_ROOT) || inferWorkspaceRoot(repoDir);
    const canonicalVarDir = normalizePath(varDir) || path.join(workspaceRoot, 'var');
    const stateFile = normalizePath(statePath) || path.join(canonicalVarDir, 'state.json');
    const resolvedVarDir = path.dirname(stateFile);

    return {
        workspaceRoot,
        varDir: resolvedVarDir,
        stateFile,
        uploadsDir: path.join(resolvedVarDir, 'uploads'),
        pidFile: path.join(resolvedVarDir, 'brainbase.pid'),
        portFile: path.join(resolvedVarDir, '.brainbase-port')
    };
}
