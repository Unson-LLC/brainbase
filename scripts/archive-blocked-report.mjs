#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';

import { resolveRuntimePaths } from '../lib/runtime-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoDir = path.resolve(__dirname, '..');

export function collectArchiveBlockedReport(sessions, now = new Date()) {
    const archived = sessions.filter((session) => session.intendedState === 'archived');
    const statusCounts = new Map();
    for (const session of archived) {
        const status = session.archive?.status || 'none';
        statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    }

    const blocked = archived
        .filter((session) => session.archive?.status === 'blocked')
        .map((session) => {
            const updatedAt = session.archive?.updatedAt || session.updatedAt || session.archivedAt || null;
            const ageHours = updatedAt
                ? Math.max(0, Math.round((now.getTime() - new Date(updatedAt).getTime()) / 36_000) / 100)
                : null;
            return {
                id: session.id,
                name: session.name || session.title || session.id,
                project: session.project || null,
                blockerReason: session.archive?.blockerReason || session.archive?.lastError || 'unknown',
                recordPath: session.archive?.recordPath || null,
                recordPrUrl: session.archive?.recordPrUrl || null,
                worktreePath: session.worktree?.path || session.path || null,
                updatedAt,
                ageHours
            };
        })
        .sort((a, b) => {
            const aAge = a.ageHours ?? -1;
            const bAge = b.ageHours ?? -1;
            return bAge - aAge || a.id.localeCompare(b.id);
        });

    return {
        generatedAt: now.toISOString(),
        totalArchived: archived.length,
        statusCounts: Object.fromEntries([...statusCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
        blocked
    };
}

export function formatArchiveBlockedReport(report, { limit = 10 } = {}) {
    const lines = [
        `# Archive Blocked Report`,
        '',
        `Generated: ${report.generatedAt}`,
        '',
        `Archived sessions: ${report.totalArchived}`,
        `Blocked: ${report.blocked.length}`,
        '',
        '## Status Counts',
        ''
    ];

    for (const [status, count] of Object.entries(report.statusCounts)) {
        lines.push(`- ${status}: ${count}`);
    }

    lines.push('', '## Blocked Items', '');

    if (report.blocked.length === 0) {
        lines.push('- none');
        return lines.join('\n');
    }

    for (const item of report.blocked.slice(0, limit)) {
        const age = item.ageHours === null ? 'unknown' : `${item.ageHours}h`;
        lines.push(`- ${item.id} ${item.name}`);
        lines.push(`  - reason: ${item.blockerReason}`);
        lines.push(`  - age: ${age}`);
        if (item.recordPath) lines.push(`  - record: ${item.recordPath}`);
        if (item.recordPrUrl) lines.push(`  - pr: ${item.recordPrUrl}`);
        if (item.worktreePath) lines.push(`  - worktree: ${item.worktreePath}`);
    }

    if (report.blocked.length > limit) {
        lines.push(`- ... ${report.blocked.length - limit} more`);
    }

    return lines.join('\n');
}

function parseArgs(argv) {
    const options = {
        format: 'markdown',
        limit: 10,
        stateUrl: process.env.BRAINBASE_STATE_URL || 'http://127.0.0.1:31013/api/state'
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--json') {
            options.format = 'json';
        } else if (arg === '--limit') {
            options.limit = parseInt(argv[i + 1], 10) || options.limit;
            i += 1;
        } else if (arg === '--state-url') {
            options.stateUrl = argv[i + 1] || options.stateUrl;
            i += 1;
        }
    }

    return options;
}

async function loadSessionsFromStateApi(stateUrl) {
    const response = await fetch(stateUrl);
    if (!response.ok) {
        throw new Error(`State API failed: HTTP ${response.status}`);
    }

    const state = await response.json();
    return state.sessions || [];
}

async function loadSessionsFromStore() {
    const { SqliteStore } = await import('../lib/sqlite-store.js');
    const runtimePaths = resolveRuntimePaths({ repoDir });
    const store = new SqliteStore(runtimePaths.stateFile, runtimePaths.workspaceRoot);
    await store.init();

    try {
        return store.get().sessions || [];
    } finally {
        await store.cleanup();
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    let sessions;

    try {
        sessions = await loadSessionsFromStateApi(options.stateUrl);
    } catch {
        sessions = await loadSessionsFromStore();
    }

    const report = collectArchiveBlockedReport(sessions);
    if (options.format === 'json') {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log(formatArchiveBlockedReport(report, { limit: options.limit }));
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
