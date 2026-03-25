export const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);

export const BROWSER_PREVIEWABLE_EXTENSIONS = new Set([
    ...MARKDOWN_EXTENSIONS,
    '.txt',
    '.log',
    '.json',
    '.jsonl',
    '.yaml',
    '.yml',
    '.toml',
    '.ini',
    '.cfg',
    '.env',
    '.xml',
    '.svg',
    '.html',
    '.css',
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.mjs',
    '.cjs',
    '.py',
    '.rb',
    '.go',
    '.rs',
    '.java',
    '.kt',
    '.swift',
    '.php',
    '.c',
    '.cc',
    '.cpp',
    '.h',
    '.hpp',
    '.sh',
    '.zsh',
    '.bash',
    '.sql'
]);

export function getPathExtension(filePath) {
    if (typeof filePath !== 'string' || filePath.length === 0) return '';
    const queryless = filePath.split(/[?#]/, 1)[0];
    const dot = queryless.lastIndexOf('.');
    return dot >= 0 ? queryless.slice(dot).toLowerCase() : '';
}

export function isBrowserPreviewablePath(filePath) {
    return BROWSER_PREVIEWABLE_EXTENSIONS.has(getPathExtension(filePath));
}

function normalizePathSegments(input) {
    const normalized = String(input || '').replace(/\\/g, '/');
    const absolute = normalized.startsWith('/');
    const segments = normalized.split('/').filter(Boolean);
    const resolved = [];

    for (const segment of segments) {
        if (segment === '.') continue;
        if (segment === '..') {
            if (resolved.length === 0) return null;
            resolved.pop();
            continue;
        }
        resolved.push(segment);
    }

    return `${absolute ? '/' : ''}${resolved.join('/')}`;
}

function inferHomeRootFromWorkspace(workspaceRoot) {
    const normalized = normalizePathSegments(workspaceRoot);
    if (!normalized || !normalized.startsWith('/')) return null;
    const segments = normalized.split('/').filter(Boolean);
    if (segments[0] === 'Users' && segments[1]) {
        return `/${segments[0]}/${segments[1]}`;
    }
    if (segments[0] === 'home' && segments[1]) {
        return `/${segments[0]}/${segments[1]}`;
    }
    return null;
}

function stripWorkspaceNamePrefix(relativePath, workspaceRoot) {
    const normalizedRelativePath = normalizePathSegments(relativePath);
    const normalizedWorkspaceRoot = normalizePathSegments(workspaceRoot);
    if (!normalizedRelativePath || !normalizedWorkspaceRoot) return normalizedRelativePath;

    const workspaceName = normalizedWorkspaceRoot.split('/').filter(Boolean).pop();
    if (!workspaceName) return normalizedRelativePath;
    if (normalizedRelativePath === workspaceName) return '';

    const prefix = `${workspaceName}/`;
    if (normalizedRelativePath.startsWith(prefix)) {
        return normalizedRelativePath.slice(prefix.length);
    }

    return normalizedRelativePath;
}

function inferRepoNameFromWorktree(workspaceRoot, sessionId) {
    const normalizedWorkspaceRoot = normalizePathSegments(workspaceRoot);
    if (!normalizedWorkspaceRoot) return null;

    const workspaceName = normalizedWorkspaceRoot.split('/').filter(Boolean).pop();
    if (!workspaceName) return null;

    if (sessionId && workspaceName.startsWith(`${sessionId}-`)) {
        return workspaceName.slice(sessionId.length + 1) || null;
    }

    return null;
}

function resolveCanonicalRepoRelativePath(absolutePath, workspaceRoot, sessionId) {
    const normalizedAbsolutePath = normalizePathSegments(absolutePath);
    const repoName = inferRepoNameFromWorktree(workspaceRoot, sessionId);
    if (!normalizedAbsolutePath || !repoName) return null;

    const marker = `/${repoName}/`;
    const markerIndex = normalizedAbsolutePath.lastIndexOf(marker);
    if (markerIndex < 0) return null;

    const relativePath = normalizedAbsolutePath.slice(markerIndex + marker.length);
    return relativePath || null;
}

export function resolvePreviewRelativePath(filePath, workspaceRoot, sessionId = null) {
    const normalizedWorkspaceRoot = normalizePathSegments(workspaceRoot);
    if (!normalizedWorkspaceRoot || !filePath) return null;

    const rawPath = String(filePath).trim();
    if (!rawPath) return null;

    if (!rawPath.startsWith('/') && !rawPath.startsWith('~/')) {
        const normalizedRelativePath = stripWorkspaceNamePrefix(rawPath, normalizedWorkspaceRoot);
        return normalizedRelativePath || null;
    }

    let absolutePath = null;
    if (rawPath.startsWith('~/')) {
        const homeRoot = inferHomeRootFromWorkspace(normalizedWorkspaceRoot);
        if (!homeRoot) return null;
        absolutePath = normalizePathSegments(`${homeRoot}/${rawPath.slice(2)}`);
    } else {
        absolutePath = normalizePathSegments(rawPath);
    }

    if (!absolutePath) return null;
    if (absolutePath === normalizedWorkspaceRoot) return null;
    if (!absolutePath.startsWith(`${normalizedWorkspaceRoot}/`)) {
        return resolveCanonicalRepoRelativePath(absolutePath, normalizedWorkspaceRoot, sessionId);
    }

    return absolutePath.slice(normalizedWorkspaceRoot.length + 1);
}
