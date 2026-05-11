import fs from 'fs/promises';
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
        portFile: path.join(resolvedVarDir, '.brainbase-port'),
        shadowVarDir: path.join(workspaceRoot, 'shared', 'var')
    };
}

async function backupShadowFile(filePath) {
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 15);
    const backupPath = `${filePath}.shadow-backup-${timestamp}`;
    await fs.copyFile(filePath, backupPath);
    return backupPath;
}

async function isExpectedSymlink(targetPath, linkPath) {
    try {
        const stat = await fs.lstat(linkPath);
        if (!stat.isSymbolicLink()) return false;
        const existingTarget = await fs.readlink(linkPath);
        const resolvedExistingTarget = path.resolve(path.dirname(linkPath), existingTarget);
        return resolvedExistingTarget === targetPath;
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
}

async function removeExistingShadowPath(targetPath, linkPath, warnings) {
    try {
        const stat = await fs.lstat(linkPath);
        if (stat.isSymbolicLink()) {
            if (await isExpectedSymlink(targetPath, linkPath)) {
                return true;
            }

            const existingTarget = await fs.readlink(linkPath);
            warnings.push(`[BRAINBASE] Shadow runtime symlink retargeted: ${linkPath} -> ${existingTarget}`);
            await fs.rm(linkPath, { force: true, recursive: false });
            return false;
        }

        const backupPath = await backupShadowFile(linkPath);
        warnings.push(`[BRAINBASE] Shadow runtime file backed up before symlink: ${backupPath}`);
        await fs.rm(linkPath, { force: true, recursive: false });
        return false;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

async function createExpectedSymlink(targetPath, linkPath, relativeTarget) {
    let lastError = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            await fs.symlink(relativeTarget, linkPath);
            return;
        } catch (error) {
            if (error?.code !== 'EEXIST') {
                throw error;
            }

            if (await isExpectedSymlink(targetPath, linkPath)) {
                return;
            }

            lastError = error;
            await fs.rm(linkPath, { force: true, recursive: false });
        }
    }

    if (await isExpectedSymlink(targetPath, linkPath)) {
        return;
    }

    throw lastError;
}

async function ensureFileSymlink(targetPath, linkPath, warnings) {
    await fs.mkdir(path.dirname(linkPath), { recursive: true });

    if (await removeExistingShadowPath(targetPath, linkPath, warnings)) {
        return;
    }

    const relativeTarget = path.relative(path.dirname(linkPath), targetPath);
    await createExpectedSymlink(targetPath, linkPath, relativeTarget);
}

function shouldManageShadowRuntimeLinks(runtimePaths) {
    const defaultVarDir = path.join(runtimePaths.workspaceRoot, 'var');
    return path.resolve(runtimePaths.varDir) === path.resolve(defaultVarDir);
}

export async function ensureShadowRuntimeLinks(runtimePaths, log = console) {
    if (!shouldManageShadowRuntimeLinks(runtimePaths)) {
        log.warn?.(`[BRAINBASE] Skipping shared runtime shadow links for custom var dir: ${runtimePaths.varDir}`)
            ?? log.log?.(`[BRAINBASE] Skipping shared runtime shadow links for custom var dir: ${runtimePaths.varDir}`);
        return;
    }

    const warnings = [];
    const files = [
        ['stateFile', path.join(runtimePaths.shadowVarDir, 'state.json')],
        ['pidFile', path.join(runtimePaths.shadowVarDir, 'brainbase.pid')],
        ['portFile', path.join(runtimePaths.shadowVarDir, '.brainbase-port')]
    ];

    for (const [key, shadowPath] of files) {
        await ensureFileSymlink(runtimePaths[key], shadowPath, warnings);
    }

    for (const warning of warnings) {
        log.warn?.(warning) ?? log.log?.(warning);
    }
}
