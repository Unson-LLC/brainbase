#!/usr/bin/env node
// @ts-check
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
    extractMeetingPersonalKgCandidatesSemantic,
    writeMeetingPersonalKgCandidates
} from '../server/services/sns/oyasumi-meeting-personal-kg-service.js';
import { requirePersonalKgIdentity } from '../server/services/sns/personal-kg-identity.js';
import { resolvePersonalKgCliAuthority } from './lib/personal-kg-cli-authority.js';
import {
    linkOyasumiPersonalKgProjects
} from './link-oyasumi-personal-kg-projects.js';

const execFileAsync = promisify(execFile);
const { Pool } = pg;

const MANA_MEETING_SOURCES = [
    { project: 'salestailor', repo: 'Unson-LLC/salestailor-project' },
    { project: 'zeims', repo: 'Unson-LLC/zeims-project' },
    { project: 'senrigan', repo: 'Unson-LLC/senrigan-project' },
    { project: 'baao', repo: 'Unson-LLC/baao-project' },
    { project: 'brainbase', repo: 'Unson-LLC/brainbase-project' },
    { project: 'back-office', repo: 'Unson-LLC/back_office' },
    { project: 'ncom-catalyst', repo: 'Unson-LLC/ncom-catalyst' },
    { project: 'mywa', repo: 'Unson-LLC/MyWa' },
    { project: 'vibepro-project', repo: 'Unson-LLC/vibepro-project' },
    { project: 'unson-os', repo: 'Unson-LLC/unson_os' },
    { project: 'tech-knight', repo: 'Tech-Knight-inc/tech-knight-project' },
    { project: 'senpainurse', repo: 'Tech-Knight-inc/senpainurse' },
    { project: 'web-inn', repo: 'Tech-Knight-inc/web-inn' },
    { project: 'smartfront', repo: 'Tech-Knight-inc/smartfront' },
    { project: 'aitle', repo: 'Tech-Knight-inc/Aitle' },
    { project: 'unson-board', repo: 'Unson-LLC/Drive', minutesDir: 'meetings/unson-board/minutes' },
    { project: 'back-office', repo: 'Unson-LLC/Drive', minutesDir: 'meetings/back-office/minutes' },
    { project: 'dialogai', repo: 'Unson-LLC/Drive', minutesDir: 'meetings/dialogai/minutes' },
    { project: 'mywa', repo: 'Unson-LLC/Drive', minutesDir: 'meetings/mywa/minutes' },
    { project: 'unson-os', repo: 'Unson-LLC/Drive', minutesDir: 'meetings/unson-os/minutes' },
    { project: 'yakumokai', repo: 'Unson-LLC/Drive', minutesDir: 'meetings/yakumokai/minutes' },
    { project: 'other', repo: 'Unson-LLC/Drive', minutesDir: 'meetings/other/minutes' }
];

function parseArgs(argv) {
    const args = {
        date: null,
        repo: 'Unson-LLC/salestailor-project',
        project: 'salestailor',
        paths: [],
        allRepos: false,
        semantic: false,
        write: false,
        json: false,
        projectLink: true,
        ownerPersonId: null,
        actorPersonId: null,
        organizationId: null,
        delegationId: null
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
        else if (arg === '--all-repos') args.allRepos = true;
        else if (arg === '--semantic') args.semantic = true;
        else if (arg === '--write') args.write = true;
        else if (arg === '--no-project-link') args.projectLink = false;
        else if (arg === '--json') args.json = true;
        else if (arg === '--dry-run') args.write = false;
        else if (arg === '--owner-person-id' || arg === '--owner') args.ownerPersonId = argv[++index];
        else if (arg.startsWith('--owner-person-id=')) args.ownerPersonId = arg.slice('--owner-person-id='.length);
        else if (arg.startsWith('--owner=')) args.ownerPersonId = arg.slice('--owner='.length);
        else if (arg === '--actor-person-id' || arg === '--actor') args.actorPersonId = argv[++index];
        else if (arg.startsWith('--actor-person-id=')) args.actorPersonId = arg.slice('--actor-person-id='.length);
        else if (arg.startsWith('--actor=')) args.actorPersonId = arg.slice('--actor='.length);
        else if (arg === '--organization-id' || arg === '--organization') args.organizationId = argv[++index];
        else if (arg.startsWith('--organization-id=')) args.organizationId = arg.slice('--organization-id='.length);
        else if (arg.startsWith('--organization=')) args.organizationId = arg.slice('--organization='.length);
        else if (arg === '--delegation-id') args.delegationId = argv[++index];
        else if (arg.startsWith('--delegation-id=')) args.delegationId = arg.slice('--delegation-id='.length);
    }
    if (!args.date) {
        throw new Error('--date YYYY-MM-DD required');
    }
    return args;
}

function personalKgIdentity(args, env = process.env) {
    return resolvePersonalKgCliAuthority({
        assertedIdentity: args,
        desiredEffect: args.write ? 'write' : 'read',
        env
    });
}

function parseJsonObjectFromText(text) {
    try {
        return JSON.parse(text);
    } catch {
        const match = String(text || '').match(/\{[\s\S]*\}/u);
        if (!match) throw new Error('agent response did not contain JSON object');
        return JSON.parse(match[0]);
    }
}

function createCodexExecSemanticClient() {
    const codexPath = process.env.CODEX_CLI_PATH || process.env.OYASUMI_AGENT_EXEC_PATH || 'codex';
    const timeoutMs = Number(process.env.OYASUMI_AGENT_TIMEOUT_MS || process.env.CODEX_TIMEOUT_MS || 600000);
    const model = process.env.OYASUMI_AGENT_MODEL || process.env.OYASUMI_SEMANTIC_MODEL || '';
    const reasoningEffort = process.env.OYASUMI_AGENT_REASONING_EFFORT || process.env.CODEX_REASONING_EFFORT || 'low';
    const cwd = process.env.OYASUMI_AGENT_EXEC_CWD || process.cwd();

    return {
        async extractPersonalKgCandidates({ prompt }) {
            const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oyasumi-personal-kg-agent-'));
            fs.chmodSync(outputDir, 0o700);
            const outputPath = path.join(outputDir, 'last-message.txt');
            const fd = fs.openSync(outputPath, 'w', 0o600);
            fs.closeSync(fd);
            const cleanupOutputArtifacts = () => {
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                if (fs.existsSync(outputDir)) fs.rmdirSync(outputDir);
            };
            const args = [
                'exec',
                '--ephemeral',
                '--ignore-rules',
                '--skip-git-repo-check',
                '--sandbox',
                'read-only',
                '-C',
                cwd,
                '-c',
                `model_reasoning_effort="${reasoningEffort}"`,
                '--output-last-message',
                outputPath
            ];
            if (model) args.push('--model', model);
            args.push('-');

            const agentPrompt = [
                'You are a bounded extraction subagent for oyasumi Personal KG backfill.',
                'Do not browse. Do not inspect files. Do not run commands.',
                'Use only the source text in this prompt.',
                'Return JSON only. No markdown, no commentary.',
                '',
                prompt.system,
                '',
                prompt.user
            ].join('\n');

            return new Promise((resolve, reject) => {
                const child = spawn(codexPath, args, {
                    env: {
                        ...process.env,
                        CODEX_DISABLE_TELEMETRY: '1'
                    },
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                let stdout = '';
                let stderr = '';
                const timer = setTimeout(() => {
                    child.kill('SIGTERM');
                    reject(new Error(`Codex extraction subagent timed out after ${timeoutMs}ms`));
                }, timeoutMs);

                child.stdout.on('data', (chunk) => {
                    stdout += chunk.toString();
                });
                child.stderr.on('data', (chunk) => {
                    stderr += chunk.toString();
                });
                child.on('error', (error) => {
                    clearTimeout(timer);
                    try {
                        cleanupOutputArtifacts();
                    } catch { /* best-effort cleanup */ }
                    reject(new Error(`Codex extraction subagent spawn failed: ${error.message}`));
                });
                child.on('close', (code) => {
                    clearTimeout(timer);
                    let output = '';
                    try {
                        if (fs.existsSync(outputPath)) {
                            output = fs.readFileSync(outputPath, 'utf8');
                        }
                        cleanupOutputArtifacts();
                    } catch (error) {
                        reject(new Error(`Codex extraction subagent output read failed: ${error.message}`));
                        return;
                    }
                    if (code !== 0) {
                        reject(new Error(`Codex extraction subagent exited with code ${code}: ${(stderr || stdout).slice(0, 240)}`));
                        return;
                    }
                    try {
                        resolve(parseJsonObjectFromText(output || stdout));
                    } catch (error) {
                        reject(error);
                    }
                });
                child.stdin.write(agentPrompt);
                child.stdin.end();
            });
        }
    };
}

function createSemanticClient() {
    const backend = String(process.env.OYASUMI_SEMANTIC_BACKEND || 'codex').toLowerCase();
    if (backend === 'codex' || backend === 'agent' || backend === 'subagent') {
        return createCodexExecSemanticClient();
    }
    throw new Error(`Unsupported OYASUMI_SEMANTIC_BACKEND: ${backend}. Semantic extraction now uses codex/agent/subagent backends only.`);
}

function databaseConfig() {
    if (process.env.INFO_SSOT_DATABASE_URL) {
        return { connectionString: process.env.INFO_SSOT_DATABASE_URL };
    }
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

function isNotFoundError(error) {
    const errorText = [
        error?.stderr,
        error?.stdout,
        error?.message,
        String(error)
    ].filter(Boolean).join('\n');
    return /Not Found|HTTP 404|404/u.test(errorText);
}

async function listMinutePaths({ repo, date, minutesDir = 'meetings/minutes' }) {
    let records;
    try {
        records = await ghJson(`repos/${repo}/contents/${minutesDir}`);
    } catch (error) {
        if (isNotFoundError(error)) return [];
        throw error;
    }
    return records
        .filter((record) => record.type === 'file')
        .filter((record) => String(record.name || '').startsWith(`${date}_`) || String(record.name || '').startsWith(`${date}-`))
        .map((record) => record.path)
        .sort();
}

async function fetchMeeting({ repo, path, projectCode }) {
    const metadata = await ghJson(`repos/${repo}/contents/${path}`);
    const content = await ghRaw(`repos/${repo}/contents/${path}`);
    const transcript = await fetchCompanionTranscript({ repo, minutesPath: path });
    return {
        repo,
        path,
        html_url: metadata.html_url,
        sha: metadata.sha,
        project_code: projectCode,
        content,
        transcript_path: transcript?.path || null,
        transcript_html_url: transcript?.html_url || null,
        transcript_sha: transcript?.sha || null,
        transcript_content: transcript?.content || ''
    };
}

function companionTranscriptPath(minutesPath) {
    const path = String(minutesPath || '');
    if (!path.includes('/minutes/')) return null;
    return path.replace('/minutes/', '/transcripts/').replace(/\.md$/u, '.txt');
}

async function fetchCompanionTranscript({ repo, minutesPath }) {
    const transcriptPath = companionTranscriptPath(minutesPath);
    if (!transcriptPath) return null;
    try {
        const metadata = await ghJson(`repos/${repo}/contents/${transcriptPath}`);
        const content = await ghRaw(`repos/${repo}/contents/${transcriptPath}`);
        return {
            path: transcriptPath,
            html_url: metadata.html_url,
            sha: metadata.sha,
            content
        };
    } catch (error) {
        if (isNotFoundError(error)) {
            return null;
        }
        throw error;
    }
}

function sourceConfigs(args) {
    if (args.allRepos) return MANA_MEETING_SOURCES;
    return [{ repo: args.repo, project: args.project }];
}

async function loadMeetings({ repo, date, paths = [], project, sources = null }) {
    const targetSources = sources || [{ repo, project }];
    const meetings = [];
    for (const source of targetSources) {
        const targetPaths = paths.length > 0
            ? paths
            : await listMinutePaths({ repo: source.repo, date, minutesDir: source.minutesDir });
        for (const path of targetPaths) {
            meetings.push(await fetchMeeting({ repo: source.repo, path, projectCode: source.project }));
        }
    }
    return meetings;
}

function outputText({ extracted, writeSummary, projectLinkSummary, write }) {
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
    if (projectLinkSummary) {
        lines.push(`project_links_linked: ${projectLinkSummary.linked}`);
        lines.push(`project_links_unchanged: ${projectLinkSummary.unchanged}`);
        lines.push(`project_links_unresolved: ${projectLinkSummary.unresolved}`);
    }
    if (Array.isArray(extracted.agent_reports) && extracted.agent_reports.length > 0) {
        lines.push('');
        lines.push('agent reports:');
        for (const report of extracted.agent_reports) {
            lines.push(`- ${report.role}: ${report.status} input=${report.input_count} output=${report.output_count}`);
        }
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
    const identity = personalKgIdentity(args);
    const sources = sourceConfigs(args);
    const meetings = await loadMeetings({
        repo: args.repo,
        date: args.date,
        paths: args.paths,
        project: args.project,
        sources
    });
    const extracted = args.semantic
        ? await extractMeetingPersonalKgCandidatesSemantic({
            date: args.date,
            meetings,
            llmClient: createSemanticClient(),
            identity
        })
        : extractMeetingPersonalKgCandidates({
            date: args.date,
            meetings,
            identity
        });

    let writeSummary = null;
    let projectLinkSummary = null;
    if (args.write) {
        const config = databaseConfig();
        validateConfig(config);
        const pool = new Pool(config);
        try {
            const repository = new PgCandidateRepository({ pool });
            const candidateService = new PromotionGateService({ repository });
            writeSummary = await writeMeetingPersonalKgCandidates({ candidateService, extracted, identity });
            if (args.projectLink) {
                projectLinkSummary = await linkOyasumiPersonalKgProjects({ write: true, pool, identity });
            }
        } finally {
            await pool.end();
        }
    }

    const payload = {
        mode: args.write ? 'write' : 'dry-run',
        extractor: args.semantic ? 'semantic' : 'rules',
        sources,
        meetings: meetings.map((meeting) => ({
            repo: meeting.repo,
            path: meeting.path,
            html_url: meeting.html_url,
            sha: meeting.sha,
            project_code: meeting.project_code,
            transcript_path: meeting.transcript_path,
            transcript_html_url: meeting.transcript_html_url,
            transcript_sha: meeting.transcript_sha
        })),
        extracted,
        write_summary: writeSummary,
        project_link_summary: projectLinkSummary
    };
    console.log(args.json ? JSON.stringify(payload, null, 2) : outputText({ extracted, writeSummary, projectLinkSummary, write: args.write }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

export {
    MANA_MEETING_SOURCES,
    parseArgs,
    loadMeetings,
    companionTranscriptPath
};
