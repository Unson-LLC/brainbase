import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import frontMatter from 'front-matter';
import { getAuth, getConfig, CONFIG_DIR } from './config.js';

const VERIFY_FIRST_ADAPTER = 'verify-first';
const DEFAULT_REVIEW_ROOT = '/tmp/verify-first-bugs';
const DEFAULT_PROJECT_ID = 'brainbase';

function getHeaders(auth) {
    if (!auth) {
        throw new Error('Not logged in. Run: brainbase auth login');
    }
    if (auth.mode === 'insecure_header') {
        return {
            'Content-Type': 'application/json',
            'x-brainbase-role': auth.role,
            'x-brainbase-projects': (auth.projects || []).join(','),
            'x-brainbase-clearance': (auth.clearance || []).join(',')
        };
    }
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
    };
}

function getServerContext() {
    const config = getConfig();
    const auth = getAuth();
    const serverUrl = auth?.server_url || config.server_url;
    const headers = getHeaders(auth);
    return { serverUrl, headers };
}

async function apiJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`${response.status} ${response.statusText}${body ? `: ${body}` : ''}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readTextIfExists(filePath) {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
}

function cleanLine(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function firstMeaningfulLine(text = '') {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && !line.startsWith('```'))
        .map((line) => line.replace(/^[-*]\s*/, '').trim())
        .find(Boolean) || '';
}

export function collectBulletLines(text = '') {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => /^([-*]|\d+\.)\s+/.test(line))
        .map((line) => line.replace(/^([-*]|\d+\.)\s+/, '').trim())
        .filter(Boolean);
}

export function deriveReviewOutcome(reviewReport = {}) {
    const result = reviewReport.review_result || {};
    const phaseStatuses = Object.values(result).map((entry) => entry?.status).filter(Boolean);
    if (phaseStatuses.includes('critical')) return 'failure';
    if (phaseStatuses.includes('minor') || phaseStatuses.includes('warning')) return 'partial';
    return 'success';
}

function summarizeIssues(reviewReport = {}) {
    const issues = [];
    const result = reviewReport.review_result || {};

    Object.entries(result).forEach(([phase, entry]) => {
        if (!entry || !Array.isArray(entry.issues)) return;
        entry.issues.forEach((issue) => {
            const cleaned = cleanLine(issue);
            if (cleaned) {
                issues.push(`${phase}: ${cleaned}`);
            }
        });
    });

    if (issues.length > 0) {
        return issues.slice(0, 3).join(' / ');
    }

    const replan = Array.isArray(reviewReport.replan_details) ? reviewReport.replan_details : [];
    const first = replan.find((item) => cleanLine(item?.issue));
    return first ? cleanLine(first.issue) : '';
}

export function deriveProposedRule(rootCauseText = '', reviewReport = {}) {
    const firstRootCauseLine = firstMeaningfulLine(rootCauseText);
    if (firstRootCauseLine) return firstRootCauseLine;

    const replan = Array.isArray(reviewReport.replan_details) ? reviewReport.replan_details : [];
    const feedback = replan.find((item) => cleanLine(item?.feedback));
    return feedback ? cleanLine(feedback.feedback) : '';
}

export function deriveProposedSteps(fixText = '', reviewReport = {}) {
    const bullets = collectBulletLines(fixText);
    if (bullets.length > 0) {
        return bullets.join('\n');
    }

    const firstFixLine = firstMeaningfulLine(fixText);
    if (firstFixLine) {
        return firstFixLine;
    }

    const replan = Array.isArray(reviewReport.replan_details) ? reviewReport.replan_details : [];
    const feedbacks = replan
        .map((item) => cleanLine(item?.feedback))
        .filter(Boolean);
    return feedbacks.join('\n');
}

export function normalizeVerifyFirstArtifact(bugDirectory, { projectId = DEFAULT_PROJECT_ID } = {}) {
    const reviewReportPath = path.join(bugDirectory, 'review_report.json');
    if (!fs.existsSync(reviewReportPath)) {
        throw new Error(`review_report.json not found: ${reviewReportPath}`);
    }

    const reviewReportRaw = fs.readFileSync(reviewReportPath, 'utf-8');
    const reviewReport = JSON.parse(reviewReportRaw);
    const rootCausePath = path.join(bugDirectory, 'phase5_root_cause.md');
    const fixPath = path.join(bugDirectory, 'phase6_fix.md');
    const verificationPath = path.join(bugDirectory, 'phase3_verify.md');

    const rootCauseText = readTextIfExists(rootCausePath);
    const fixText = readTextIfExists(fixPath);
    const verificationText = readTextIfExists(verificationPath);

    const proposedRule = deriveProposedRule(rootCauseText, reviewReport);
    const proposedSteps = deriveProposedSteps(fixText, reviewReport);
    const summary = firstMeaningfulLine(rootCauseText) || summarizeIssues(reviewReport) || `verify-first review: ${path.basename(bugDirectory)}`;
    const outcome = deriveReviewOutcome(reviewReport);
    const promotionHint = proposedRule && proposedSteps
        ? 'both'
        : proposedRule
            ? 'wiki'
            : proposedSteps
                ? 'skill'
                : 'auto';
    const fingerprint = crypto
        .createHash('sha1')
        .update(reviewReportRaw)
        .update(rootCauseText)
        .update(fixText)
        .update(verificationText)
        .digest('hex');

    return {
        source_type: 'review',
        project_id: projectId,
        task_id: path.basename(bugDirectory),
        outcome,
        summary,
        promotion_hint: promotionHint,
        evidence: {
            review_findings: reviewReport.review_result || {},
            replan_details: reviewReport.replan_details || [],
            root_cause: rootCauseText || null,
            verification: verificationText || null,
            proposed_rule: proposedRule || null,
            proposed_steps: proposedSteps || null
        },
        ingestion: {
            adapter_name: VERIFY_FIRST_ADAPTER,
            source_path: reviewReportPath,
            fingerprint
        }
    };
}

function parseArgs(argv = []) {
    const flags = { _: [] };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) {
            flags._.push(token);
            continue;
        }

        const key = token.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            flags[key] = true;
            continue;
        }
        if (flags[key] === undefined) {
            flags[key] = next;
        } else if (Array.isArray(flags[key])) {
            flags[key].push(next);
        } else {
            flags[key] = [flags[key], next];
        }
        index += 1;
    }
    return flags;
}

function toList(value) {
    if (Array.isArray(value)) {
        return value.flatMap((entry) => String(entry).split(',')).map((entry) => entry.trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value.split(',').map((entry) => entry.trim()).filter(Boolean);
    }
    return [];
}

export function renderPromotionManifest(candidate) {
    const attrs = [
        '---',
        `candidate_id: ${candidate.id}`,
        `pillar: ${candidate.pillar}`,
        `target_ref: ${candidate.target_ref}`,
        `status: ${candidate.status}`,
        `risk_level: ${candidate.risk_level}`,
        `doc_type: ${candidate.doc_type || ''}`,
        `target_project_id: ${candidate.target_project_id || ''}`,
        `apply_mode: ${candidate.apply_mode || 'manual'}`,
        `apply_error: ${candidate.apply_error || ''}`,
        `materialized_ref: ${candidate.materialized_ref || ''}`,
        `source_episode_ids: [${(candidate.source_episode_ids || []).join(', ')}]`,
        `linked_wiki_candidate_id: ${candidate.linked_wiki_candidate_id || ''}`,
        `linked_candidate_ids: [${(candidate.linked_candidate_ids || []).join(', ')}]`,
        '---',
        '',
        '# Promotion Candidate',
        '',
        '## Target',
        candidate.target_ref,
        '',
        '## Evaluation',
        JSON.stringify(candidate.evaluation_summary || {}, null, 2),
        '',
        '## Proposed Content',
        '```md',
        candidate.proposed_content,
        '```',
        ''
    ];

    return attrs.join('\n');
}

export function materializePromotions(candidates, repoRoot = process.cwd()) {
    const materialized = [];
    const manifestDir = path.join(repoRoot, 'docs', 'learning-promotions');
    ensureDir(manifestDir);

    for (const candidate of candidates) {
        const manifestPath = path.join(manifestDir, `${candidate.id}.md`);
        fs.writeFileSync(manifestPath, renderPromotionManifest(candidate), 'utf-8');
        materialized.push(manifestPath);

        if (candidate.pillar === 'skill' && candidate.target_ref) {
            const skillPath = path.join(repoRoot, candidate.target_ref);
            ensureDir(path.dirname(skillPath));
            fs.writeFileSync(skillPath, candidate.proposed_content, 'utf-8');
            materialized.push(skillPath);
        }
    }

    return materialized;
}

async function recordEpisode(payload) {
    const { serverUrl, headers } = getServerContext();
    return apiJson(`${serverUrl}/api/learning/episodes`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
}

async function proposePromotions(applyMode = 'manual') {
    const { serverUrl, headers } = getServerContext();
    return apiJson(`${serverUrl}/api/learning/promotions/propose`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ applyMode })
    });
}

async function listPromotions(filters = {}) {
    const { serverUrl, headers } = getServerContext();
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
    });
    const suffix = params.toString() ? `?${params}` : '';
    return apiJson(`${serverUrl}/api/learning/promotions${suffix}`, { headers });
}

async function dedupeExistingPromotions() {
    const { serverUrl, headers } = getServerContext();
    return apiJson(`${serverUrl}/api/learning/promotions/dedupe-existing`, {
        method: 'POST',
        headers
    });
}

async function getPromotion(candidateId) {
    const { serverUrl, headers } = getServerContext();
    return apiJson(`${serverUrl}/api/learning/promotions/${candidateId}`, { headers });
}

async function markPromotionApplied(candidateId) {
    const { serverUrl, headers } = getServerContext();
    return apiJson(`${serverUrl}/api/learning/promotions/${candidateId}/applied`, {
        method: 'POST',
        headers,
        body: JSON.stringify({})
    });
}

async function rejectPromotion(candidateId, reason = '') {
    const { serverUrl, headers } = getServerContext();
    return apiJson(`${serverUrl}/api/learning/promotions/${candidateId}/reject`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason })
    });
}

async function applyWikiCandidate(candidate) {
    const { serverUrl, headers } = getServerContext();
    await apiJson(`${serverUrl}/api/wiki/page`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            path: candidate.target_ref,
            content: candidate.proposed_content
        })
    });
    await markPromotionApplied(candidate.id);
}

async function applySkillCandidate(candidate, repoRoot = process.cwd()) {
    const targetPath = path.join(repoRoot, candidate.target_ref);
    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, candidate.proposed_content, 'utf-8');
    await markPromotionApplied(candidate.id);
    return targetPath;
}

function scanVerifyFirstBugDirectories(rootDir) {
    if (!fs.existsSync(rootDir)) return [];

    return fs.readdirSync(rootDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(rootDir, entry.name))
        .filter((bugDir) => fs.existsSync(path.join(bugDir, 'review_report.json')))
        .sort();
}

function resolveLearningStateDir() {
    const baseDir = process.env.BRAINBASE_VAR_DIR
        ? path.join(process.env.BRAINBASE_VAR_DIR, 'learning')
        : path.join(CONFIG_DIR, 'learning');
    ensureDir(baseDir);
    return baseDir;
}

function buildInboxSummary(candidates) {
    const pending = candidates.filter((candidate) => candidate.status === 'evaluated' && candidate.apply_mode === 'manual');
    const byPillar = pending.reduce((acc, candidate) => {
        acc[candidate.pillar] = (acc[candidate.pillar] || 0) + 1;
        return acc;
    }, {});

    return {
        generated_at: new Date().toISOString(),
        pending_total: pending.length,
        by_pillar: byPillar,
        top: pending.slice(0, 5).map((candidate) => ({
            id: candidate.id,
            pillar: candidate.pillar,
            target_ref: candidate.target_ref,
            risk_level: candidate.risk_level
        }))
    };
}

function printInbox(candidates) {
    const pending = candidates.filter((candidate) => candidate.status === 'evaluated' && candidate.apply_mode === 'manual');
    console.log(`Pending candidates: ${pending.length}`);
    pending.slice(0, 10).forEach((candidate) => {
        console.log(`- ${candidate.id} [${candidate.pillar}] ${candidate.target_ref} (${candidate.risk_level})`);
    });
}

export async function proposeLearningPromotions() {
    await proposePromotions('manual');
    const candidates = await listPromotions({ status: 'evaluated', apply_mode: 'manual' });
    const materialized = materializePromotions(candidates);

    console.log(`Materialized ${candidates.length} promotion candidates.`);
    materialized.forEach((file) => console.log(`  - ${path.relative(process.cwd(), file)}`));
}

function collectManifestFiles(rootDir) {
    if (!fs.existsSync(rootDir)) return [];
    return fs.readdirSync(rootDir)
        .filter((name) => name.endsWith('.md'))
        .map((name) => path.join(rootDir, name));
}

export async function applyApprovedPromotions() {
    const { serverUrl, headers } = getServerContext();
    const manifestDir = path.join(process.cwd(), 'docs', 'learning-promotions');
    const manifestFiles = collectManifestFiles(manifestDir);

    for (const manifestPath of manifestFiles) {
        const parsed = frontMatter(fs.readFileSync(manifestPath, 'utf-8'));
        const attrs = parsed.attributes || {};
        if (attrs.pillar !== 'wiki' || attrs.status !== 'approved') continue;

        const contentMatch = parsed.body.match(/```md\n([\s\S]*?)\n```/);
        if (!contentMatch) continue;

        await apiJson(`${serverUrl}/api/wiki/page`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                path: attrs.target_ref,
                content: contentMatch[1]
            })
        });

        await markPromotionApplied(attrs.candidate_id);
        console.log(`Applied wiki promotion: ${attrs.candidate_id} -> ${attrs.target_ref}`);
    }
}

export async function addExplicitLearn(argv = []) {
    const flags = parseArgs(argv);
    if (!flags.summary) {
        throw new Error('--summary is required');
    }

    const payload = {
        source_type: 'explicit_learn',
        project_id: flags.project || flags['project-id'] || DEFAULT_PROJECT_ID,
        outcome: flags.outcome || 'success',
        summary: String(flags.summary),
        promotion_hint: flags['promotion-hint'] || 'auto',
        wiki_refs: toList(flags['wiki-ref']),
        skill_refs: toList(flags['skill-ref']),
        evidence: {
            proposed_rule: flags.rule ? String(flags.rule) : null,
            proposed_steps: flags.steps ? String(flags.steps) : null,
            note: flags.note ? String(flags.note) : null
        }
    };

    const episode = await recordEpisode(payload);
    const proposed = await proposePromotions('manual');
    console.log(`Recorded learn episode: ${episode.id}${episode.deduped ? ' (deduped)' : ''}`);
    console.log(`Proposed ${proposed.candidates?.length || proposed.length || 0} candidates.`);
}

export async function ingestReviewArtifacts(argv = []) {
    const flags = parseArgs(argv);
    const rootDir = flags.root || DEFAULT_REVIEW_ROOT;
    const projectId = flags.project || flags['project-id'] || DEFAULT_PROJECT_ID;
    const bugDirectories = scanVerifyFirstBugDirectories(rootDir);

    let imported = 0;
    let deduped = 0;

    for (const bugDirectory of bugDirectories) {
        const payload = normalizeVerifyFirstArtifact(bugDirectory, { projectId });
        const result = await recordEpisode(payload);
        if (result.deduped) {
            deduped += 1;
        } else {
            imported += 1;
        }
    }

    const proposed = await proposePromotions('manual');
    console.log(`Review ingest complete. imported=${imported} deduped=${deduped} proposed=${proposed.candidates?.length || proposed.length || 0}`);
    return { imported, deduped, scanned: bugDirectories.length };
}

export async function showLearningInbox() {
    const candidates = await listPromotions({ status: 'evaluated', apply_mode: 'manual' });
    printInbox(candidates);
    return candidates;
}

export async function showPromotion(candidateId) {
    const candidate = await getPromotion(candidateId);
    console.log(JSON.stringify(candidate, null, 2));
    return candidate;
}

export async function applyPromotion(candidateId, { repoRoot = process.cwd() } = {}) {
    const candidate = await getPromotion(candidateId);
    if (candidate.pillar === 'wiki') {
        await applyWikiCandidate(candidate);
        console.log(`Applied wiki candidate: ${candidate.id} -> ${candidate.target_ref}`);
        return candidate;
    }

    const targetPath = await applySkillCandidate(candidate, repoRoot);
    console.log(`Applied skill candidate: ${candidate.id} -> ${path.relative(repoRoot, targetPath)}`);
    return candidate;
}

export async function rejectLearningPromotion(candidateId, reason = '') {
    await rejectPromotion(candidateId, reason);
    console.log(`Rejected candidate: ${candidateId}`);
}

export async function dedupeExistingLearningPromotions() {
    const result = await dedupeExistingPromotions();
    console.log(`Deduped existing candidates: merged=${result.merged || 0} scanned=${result.scanned || 0}`);
    return result;
}

export async function runDailyLearning(argv = []) {
    const ingestResult = await ingestReviewArtifacts(argv);
    const candidates = await listPromotions({ status: 'evaluated', apply_mode: 'manual' });
    const summary = {
        generated_at: new Date().toISOString(),
        ingest: ingestResult,
        inbox: buildInboxSummary(candidates)
    };

    const stateDir = resolveLearningStateDir();
    const summaryPath = path.join(stateDir, 'daily-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

    console.log(`Daily learning summary written: ${summaryPath}`);
    printInbox(candidates);
    return summary;
}
