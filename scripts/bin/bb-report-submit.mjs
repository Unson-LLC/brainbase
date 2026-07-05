#!/usr/bin/env node
// @ts-check
//
// bb-report-submit: agent（ceo/cso/retro）が生成したmarkdownレポートを
// external-runner ingest経由でCompanion approval inboxに送り込むCLI。
//
// Usage:
//   bb-report-submit --sender agent/ceo --title "..." --period 2026-07 --file report.md
//   cat report.md | bb-report-submit --sender agent/cso --title "..." --period 2026-07
//
// 失敗時（サーバー未起動・認証エラー等）は _inbox/pending.md にfrontmatter追記して
// フォールバックする（後方互換。人間がgrepで読める保険）。
//
// See: .vibepro/stories/story-brainbase-agent-report-approval-inbox/spec.md

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONTRACT_VERSION = 'external_runner.v0';
export const DEFAULT_REQUIRED_BY = 'sato_keigo';
export const DEFAULT_BASE_URL = 'http://localhost:31013';
const SERVICE_TOKEN_PREFIX = 'bbsvc_';

const SENDER_ROLE_AGENT_IDS = {
    'agent/ceo': 'agent_ceo',
    'agent/cso': 'agent_cso',
    'agent/retro': 'agent_retro'
};

/**
 * @param {string} sender e.g. "agent/ceo"
 * @returns {string} role_agent_id, e.g. "agent_ceo"
 */
export function senderToRoleAgentId(sender) {
    const normalized = String(sender || '').trim();
    if (SENDER_ROLE_AGENT_IDS[normalized]) return SENDER_ROLE_AGENT_IDS[normalized];
    // フォールバック: agent/xxx -> agent_xxx
    return normalized.replace(/^agent\//, 'agent_').replace(/[^a-zA-Z0-9_]/g, '_') || 'agent_unknown';
}

/**
 * @param {string} sender
 * @param {string} period
 * @returns {string} 冪等run.id
 */
export function buildRunId(sender, period) {
    const senderPart = String(sender || 'agent/unknown').replace(/^agent\//, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const periodPart = String(period || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `wfr_agent_${senderPart}_${periodPart}`;
}

/**
 * markdown本文からexternal_runner.v0準拠のpayloadを組み立てる。
 * HTTP送信は行わない（純粋関数、単体テスト用）。
 *
 * @param {{ sender: string, title: string, period: string, markdown: string, requiredBy?: string }} options
 */
export function buildAgentReportPayload({ sender, title, period, markdown, requiredBy = DEFAULT_REQUIRED_BY }) {
    if (!sender || typeof sender !== 'string') {
        throw new Error('sender is required (e.g. --sender agent/ceo)');
    }
    if (!title || typeof title !== 'string') {
        throw new Error('title is required (e.g. --title "CEOレビュー 2026-07")');
    }
    if (!period || typeof period !== 'string') {
        throw new Error('period is required (e.g. --period 2026-07)');
    }
    if (typeof markdown !== 'string' || markdown.trim() === '') {
        throw new Error('markdown body is required (via --file or stdin)');
    }

    const roleAgentId = senderToRoleAgentId(sender);
    const runId = buildRunId(sender, period);
    const preview = markdown.trim().slice(0, 240);

    return {
        contract_version: CONTRACT_VERSION,
        runner: {
            type: 'agent_report',
            external_run_id: `${sender.replace(/^agent\//, '')}-report-${period}`,
            agent_id: sender
        },
        run: {
            id: runId,
            project_id: 'brainbase',
            role_agent_id: roleAgentId,
            status: 'waiting_human',
            metadata: {
                report_kind: `${sender.replace(/^agent\//, '')}_report`,
                period
            }
        },
        loop_control: {
            owner_id: requiredBy,
            cost_owner_id: requiredBy,
            approval_owner_id: requiredBy,
            stop_conditions: ['human_review_required']
        },
        context_sources: [{
            source_type: 'agent_report',
            source_ref: `${sender}:${period}`
        }],
        rounds: [{
            round_id: `round_${runId}`,
            status: 'completed',
            evidence_refs: [`agent_report://${sender.replace(/^agent\//, '')}/${period}`]
        }],
        human_steps: [{
            id: `hs_${runId}`,
            step_key: 'review_agent_report',
            status: 'pending',
            required_by: requiredBy,
            approval_reason: title
        }],
        outputs: [{
            id: `out_${runId}`,
            output_type: 'report_markdown',
            preview,
            payload: { markdown }
        }]
    };
}

/**
 * トークン文字列がbrainbaseサービストークン（bbsvc_プレフィックス）かどうかを判定する。
 *
 * @param {string} token
 * @returns {boolean}
 */
export function isServiceToken(token) {
    return typeof token === 'string' && token.startsWith(SERVICE_TOKEN_PREFIX);
}

/**
 * 個人アクセストークン（JWT）のpayload部から `sub`（personId）を取り出す。
 * デコード不能な場合はnullを返す（例外を投げない）。
 *
 * @param {string} token
 * @returns {string | null}
 */
export function decodeJwtSubject(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
        const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
        const payload = JSON.parse(payloadJson);
        return typeof payload?.sub === 'string' && payload.sub.trim() !== '' ? payload.sub : null;
    } catch {
        return null;
    }
}

/**
 * report owner（owner_id/cost_owner_id/approval_owner_id/required_by）を解決する。
 *
 * 優先順位:
 *   1. 明示override（--owner フラグ or BRAINBASE_REPORT_OWNER env）
 *   2. 個人トークン（bbsvc_で始まらないJWT）の場合はtoken自身のsub（personId）
 *      - ingest側の委譲ガード（loop_control_delegation_not_allowed）は
 *        非サービス認証がactorId以外へownerを委譲することを禁止するため、
 *        個人トークンで送るときはtoken自身のpersonIdをownerにする必要がある
 *   3. サービストークン（bbsvc_）またはデコード不能な場合は既存のDEFAULT_REQUIRED_BY
 *
 * @param {{ override?: string, tokenReader?: () => string, defaultOwner?: string }} options
 * @returns {string}
 */
export function resolveReportOwner({ override, tokenReader = readAccessToken, defaultOwner = DEFAULT_REQUIRED_BY } = {}) {
    if (typeof override === 'string' && override.trim() !== '') {
        return override.trim();
    }

    let token;
    try {
        token = tokenReader();
    } catch {
        return defaultOwner;
    }

    if (isServiceToken(token)) {
        return defaultOwner;
    }

    const subject = decodeJwtSubject(token);
    return subject || defaultOwner;
}

// ---- CLI固有I/O（parseArgs/readStdin/readAccessToken/main はテスト対象外。
//      submitReport は fetchImpl/tokenReader 注入でテスト可能） ----

function parseArgs(argv) {
    const args = new Map();
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = argv[i + 1];
            if (next !== undefined && !next.startsWith('--')) {
                args.set(key, next);
                i += 1;
            } else {
                args.set(key, true);
            }
        }
    }
    return args;
}

function readStdin() {
    return new Promise((resolve, reject) => {
        if (process.stdin.isTTY) {
            resolve('');
            return;
        }
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
    });
}

function readAccessToken() {
    if (process.env.BRAINBASE_AUTH_TOKEN) return process.env.BRAINBASE_AUTH_TOKEN;
    const tokenPath = path.join(os.homedir(), '.brainbase', 'tokens.json');
    const parsed = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    if (!parsed.access_token) throw new Error('access_token is missing from ~/.brainbase/tokens.json');
    return parsed.access_token;
}

/**
 * 送信失敗時のフォールバック: _inbox/pending.md にfrontmatter追記。
 * 既存フォーマット（id/channel/sender/status/message）を踏襲する。
 */
export function appendPendingFallback({ sender, title, reasonDetail, pendingPath }) {
    const id = `INBOX-${Date.now()}`;
    const channel = typeof sender === 'string' && sender.startsWith('agent/') ? sender.slice(6) : 'system';
    const message = `${title}${reasonDetail ? ` — ${reasonDetail}` : ''}`;
    const entry = [
        '---',
        `id: ${id}`,
        `channel: ${channel}`,
        `sender: ${sender}`,
        'status: pending',
        `message: "${message.replace(/"/g, '\\"')}"`,
        '---',
        ''
    ].join('\n');
    fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
    fs.appendFileSync(pendingPath, `\n${entry}`);
    return { id, pendingPath };
}

/**
 * ingest送信＋失敗時fallbackの制御フロー本体。
 * fetchImpl / tokenReader を注入可能にし、main()のcatch経路をテスト可能にする。
 *
 * @param {{
 *   payload: ReturnType<typeof buildAgentReportPayload>,
 *   baseUrl: string,
 *   sender: string,
 *   title: string,
 *   pendingPath: string,
 *   fetchImpl?: typeof fetch,
 *   tokenReader?: () => string,
 *   logger?: { log: (msg: string) => void, error: (msg: string) => void }
 * }} options
 * @returns {Promise<{ ok: true, status: number } | { ok: false, fallback: { id: string, pendingPath: string }, reasonDetail: string }>}
 */
export async function submitReport({ payload, baseUrl, sender, title, pendingPath, fetchImpl = fetch, tokenReader = readAccessToken, logger = console }) {
    try {
        const token = tokenReader();
        const response = await fetchImpl(`${baseUrl}/api/external-runner/ingest`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        const text = await response.text();
        if (!response.ok) {
            throw new Error(`ingest failed: HTTP ${response.status} ${text}`);
        }
        logger.log(`[bb-report-submit] ingested run.id=${payload.run.id} status=${response.status}`);
        return { ok: true, status: response.status };
    } catch (error) {
        const reasonDetail = error instanceof Error ? error.message : String(error);
        logger.error(`[bb-report-submit] ingest failed, falling back to pending.md: ${reasonDetail}`);
        const fallback = appendPendingFallback({ sender, title, reasonDetail, pendingPath });
        logger.log(`[bb-report-submit] fallback written: ${fallback.pendingPath} (${fallback.id})`);
        return { ok: false, fallback, reasonDetail };
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const sender = args.get('sender');
    const title = args.get('title');
    const period = args.get('period');
    const baseUrl = String(args.get('base-url') || process.env.BRAINBASE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const filePath = args.get('file');

    let markdown;
    if (filePath && typeof filePath === 'string') {
        markdown = fs.readFileSync(path.resolve(filePath), 'utf8');
    } else {
        markdown = await readStdin();
    }

    const ownerOverride = args.get('owner') || process.env.BRAINBASE_REPORT_OWNER;
    const requiredBy = resolveReportOwner({
        override: typeof ownerOverride === 'string' ? ownerOverride : undefined
    });

    const payload = buildAgentReportPayload({ sender, title, period, markdown, requiredBy });

    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
    const pendingPath = path.join(repoRoot, '_inbox', 'pending.md');

    await submitReport({ payload, baseUrl, sender, title, pendingPath });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
    main().catch((error) => {
        console.error('[bb-report-submit] fatal error:', error);
        process.exit(1);
    });
}
