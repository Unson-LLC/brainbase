import path from 'node:path';

export const DEFAULT_WORKSPACE_ROOT = '/Users/ksato/workspace';

export function resolveWorkspaceRoot(env = process.env) {
    return env.BRAINBASE_WORKSPACE_ROOT || DEFAULT_WORKSPACE_ROOT;
}

export function resolveSnsRoot(env = process.env) {
    return env.BRAINBASE_SNS_ROOT || path.join(resolveWorkspaceRoot(env), 'sns');
}

export function resolveWikiRoots(env = process.env) {
    if (env.LOCAL_SSOT_WIKI_ROOTS) {
        return env.LOCAL_SSOT_WIKI_ROOTS
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [path.join(resolveWorkspaceRoot(env), 'wiki')];
}
