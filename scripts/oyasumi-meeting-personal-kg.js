#!/usr/bin/env node
// @ts-check
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import pg from 'pg';

import {
    PgCandidateRepository
} from '../server/services/candidate-store/candidate-repository.js';
import { PromotionGateService } from '../server/services/candidate-store/promotion-gate-service.js';
import {
    SOURCE_SYSTEM,
    extractMeetingPersonalKgCandidates,
    writeMeetingPersonalKgCandidates
} from '../server/services/sns/oyasumi-meeting-personal-kg-service.js';

const execFileAsync = promisify(execFile);
const { Pool } = pg;

function parseArgs(argv) {
    const args = {
        date: null,
        repo: 'Unson-LLC/salestailor-project',
        project: 'salestailor',
        paths: [],
        write: false,
        json: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--date') args.date = argv[++index];
        else if (arg.startsWith('--date=')) args.date = arg.slice('--date='.length);
        else if (arg === '--repo') args.repo = argv[++index];
        else if (arg.startsWith('--repo=')) args.repo = arg.slice('--repo='.length);
        else if (arg === '--project') args.project = argv[++index];
        else if (arg.startsWith('--project=')) args.project = arg.slice('--project='.length);
        else if (arg === '--path') args.paths.push(argv[++index]);
        else if (arg.startsWith('--path=')) args.paths.push(arg.slice('--path='.length));
        else if (arg === '--write') args.write = true;
        else if (arg === '--json') args.json = true;
        else if (arg === '--dry-run') args.write = false;
    }
    if (!args.date) {
        throw new Error('--date YYYY-MM-DD required');
    }
    return args;
}

function databaseConfig() {
    if (process.env.DATABASE_URL) {
        return { connectionString: process.env.DATABASE_URL };
    }
    return {
        host: process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.PGPORT || 25432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD
    };
}

function validateConfig(config) {
    if (config.connectionString) return;
    const missing = ['database', 'user'].filter((key) => !config[key]);
    if (missing.length > 0) {
        throw new Error(`Missing PostgreSQL config: ${missing.join(', ')}. Set DATABASE_URL or PGDATABASE/PGUSER.`);
    }
}

async function ghJson(path) {
    const { stdout } = await execFileAsync('gh', ['api', path], { maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
}

async function ghRaw(path) {
    const { stdout } = await execFileAsync(
        'gh',
        ['api', path, '-H', 'Accept: application/vnd.github.raw'],
        { maxBuffer: 20 * 1024 * 1024 }
    );
    return stdout;
}

async function listMinutePaths({ repo, date }) {
    const records = await ghJson(`repos/${repo}/contents/meetings/minutes`);
    return records
        .filter((record) => record.type === 'file')
        .filter((record) => String(record.name || '').startsWith(`${date}_`) || String(record.name || '').startsWith(`${date}-`))
        .map((record) => record.path)
        .sort();
}

async function fetchMeeting({ repo, path, projectCode }) {
    const metadata = await ghJson(`repos/${repo}/contents/${path}`);
    const content = await ghRaw(`repos/${repo}/contents/${path}`);
    return {
        repo,
        path,
        html_url: metadata.html_url,
        sha: metadata.sha,
        project_code: projectCode,
        content
    };
}

async function loadMeetings({ repo, date, paths, project }) {
    const targetPaths = paths.length > 0 ? paths : await listMinutePaths({ repo, date });
    const meetings = [];
    for (const path of targetPaths) {
        meetings.push(await fetchMeeting({ repo, path, projectCode: project }));
    }
    return meetings;
}

function outputText({ extracted, writeSummary, write }) {
    const lines = [
        `${SOURCE_SYSTEM}: ${extracted.date}`,
        `mode: ${write ? 'write' : 'dry-run'}`,
        `adopted: ${extracted.adopted.length}`,
        `rejected: ${extracted.rejected.length}`,
        `needs_review: ${extracted.needs_review.length}`
    ];
    if (writeSummary) {
        lines.push(`inserted: ${writeSummary.inserted}`);
        lines.push(`skipped: ${writeSummary.skipped}`);
        lines.push(`blocked: ${writeSummary.blocked}`);
    }
    if (extracted.adopted.length > 0) {
        lines.push('');
        lines.push('adopted bodies:');
        for (const candidate of extracted.adopted) {
            lines.push(`- [${candidate.permission_snapshot.oyasumi_meeting_personal_kg.category}] ${candidate.body}`);
        }
    }
    if (extracted.rejected.length > 0) {
        lines.push('');
        lines.push('rejected:');
        for (const rejected of extracted.rejected) {
            lines.push(`- [${rejected.reason}] ${rejected.source_ref}`);
        }
    }
    if (extracted.needs_review.length > 0) {
        lines.push('');
        lines.push('needs_review:');
        for (const item of extracted.needs_review) {
            lines.push(`- [${item.reason}] ${item.summary}`);
        }
    }
    return lines.join('\n');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const meetings = await loadMeetings({
        repo: args.repo,
        date: args.date,
        paths: args.paths,
        project: args.project
    });
    const extracted = extractMeetingPersonalKgCandidates({
        date: args.date,
        meetings
    });

    let writeSummary = null;
    if (args.write) {
        const config = databaseConfig();
        validateConfig(config);
        const pool = new Pool(config);
        try {
            const repository = new PgCandidateRepository({ pool });
            const candidateService = new PromotionGateService({ repository });
            writeSummary = await writeMeetingPersonalKgCandidates({ candidateService, extracted });
        } finally {
            await pool.end();
        }
    }

    const payload = {
        mode: args.write ? 'write' : 'dry-run',
        meetings: meetings.map((meeting) => ({
            repo: meeting.repo,
            path: meeting.path,
            html_url: meeting.html_url,
            sha: meeting.sha,
            project_code: meeting.project_code
        })),
        extracted,
        write_summary: writeSummary
    };
    console.log(args.json ? JSON.stringify(payload, null, 2) : outputText({ extracted, writeSummary, write: args.write }));
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});

export {
    parseArgs,
    loadMeetings
};
