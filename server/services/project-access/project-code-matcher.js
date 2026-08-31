export function normalizeProjectCode(value) {
    return String(value || '').trim().toLowerCase().replace(/_/g, '-');
}

function accessKeys(project) {
    const values = [
        project?.id,
        project?.project_code,
        project?.github?.repo,
        ...(Array.isArray(project?.aliases) ? project.aliases : [])
    ];
    const keys = new Set();
    for (const value of values) {
        const normalized = normalizeProjectCode(value);
        if (!normalized) continue;
        keys.add(normalized);
    }
    return keys;
}

export function isProjectAllowed(project, allowedProjectCodes) {
    const allowed = new Set((allowedProjectCodes || []).flatMap((value) => {
        const normalized = normalizeProjectCode(value);
        return normalized ? [normalized] : [];
    }));
    if (!allowed.size) return false;
    return Array.from(accessKeys(project)).some((key) => allowed.has(key));
}

export function filterProjectsForAccess(projects, access = {}) {
    const allowed = Array.isArray(access?.projectCodes) ? access.projectCodes : [];
    return projects.filter((project) => isProjectAllowed(project, allowed));
}
