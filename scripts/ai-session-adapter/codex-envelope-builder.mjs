// @ts-check
/**
 * codex-envelope-builder: codex rollout jsonl → Raw Ledger envelope
 *
 * Story: story-ai-session-log-kernel-adapter (P0)
 * Parent: STR-006 / ADR-010
 *
 * 1 セッション (= 1 rollout-*.jsonl ファイル) を 1 envelope に変換する。
 * 本 module は **純粋関数** で I/O を行わず、 jsonl のテキストを受け取って
 * envelope を返す。 file 読込 / POST / watermark は P1/P2 で別 module に分離する。
 *
 * SPEC-006 Raw Ledger envelope 仕様準拠:
 *   raw_event_id, source_system, source_event_id, occurred_at, captured_at,
 *   actor_external_id, actor_person_id, workspace, permission_snapshot,
 *   evidence_ref, retention_policy
 */

import { createHash } from 'crypto';
import path from 'path';

const DEFAULT_ACTOR_PERSON_ID = 'person:ksato';
const SOURCE_SYSTEM = 'codex_session';

/**
 * workspace / project_code を cwd から導出。
 * cwd パターン例:
 *   /Volumes/UNSON-DRIVE/brainbase-worktrees/session-1777...-unson  → workspace=unson, project_code=brainbase
 *   /Volumes/UNSON-DRIVE/actions-runner/_work/salestailor/salestailor → workspace=unson, project_code=salestailor
 *   /Users/ksato/workspace/projects/mana                              → workspace=unson, project_code=mana
 *   /Users/ksato/workspace/repos/brainbase                            → workspace=unson, project_code=brainbase
 *
 * 個人 ksato 環境のため workspace は 'unson' 固定。 project_code は cwd の最終的な project name を抽出。
 *
 * @param {string|undefined} cwd
 * @returns {{ workspace: string, project_code: string|null }}
 */
export function deriveWorkspaceAndProject(cwd) {
    if (!cwd || typeof cwd !== 'string') {
        return { workspace: 'unson', project_code: null };
    }

    const segments = cwd.split('/').filter(Boolean);

    // actions-runner 経由 (= GitHub Actions self-hosted runner)
    // /Volumes/UNSON-DRIVE/actions-runner/_work/<project>/<project>
    const actionsRunnerIdx = segments.indexOf('actions-runner');
    if (actionsRunnerIdx >= 0 && segments[actionsRunnerIdx + 1] === '_work' && segments[actionsRunnerIdx + 2]) {
        return { workspace: 'unson', project_code: segments[actionsRunnerIdx + 2] };
    }

    // brainbase-worktrees (= brainbase session 内 codex 起動)
    // 例: session-1777080967793-unson → "session" + ts + project_code(末尾)
    const worktreesIdx = segments.indexOf('brainbase-worktrees');
    if (worktreesIdx >= 0 && segments[worktreesIdx + 1]) {
        const last = segments[worktreesIdx + 1];
        const lastDash = last.lastIndexOf('-');
        if (lastDash >= 0 && lastDash < last.length - 1) {
            const suffix = last.substring(lastDash + 1);
            // 末尾が数字だけなら project_code 抽出失敗 (= session-only な命名規則)、
            // 英字を含むなら project_code として採用
            if (/[a-z]/i.test(suffix)) {
                return { workspace: 'unson', project_code: suffix };
            }
        }
    }

    // workspace/projects/<project> または workspace/code/<project>
    const wsIdx = segments.indexOf('workspace');
    if (wsIdx >= 0 && segments[wsIdx + 1] && segments[wsIdx + 2]) {
        return { workspace: 'unson', project_code: segments[wsIdx + 2] };
    }

    // fallback: 最終 segment を project_code に
    return { workspace: 'unson', project_code: segments[segments.length - 1] || null };
}

/**
 * jsonl テキストを行ごとに parse する。
 * @param {string} text
 * @returns {Array<any>}
 */
function parseJsonl(text) {
    const out = [];
    const lines = text.split('\n');
    for (const line of lines) {
        if (!line || !line.trim()) continue;
        try {
            out.push(JSON.parse(line));
        } catch (err) {
            // 壊れた行は skip (codex CLI が途中で kill された等)
        }
    }
    return out;
}

/**
 * codex rollout jsonl のテキストを Raw Ledger envelope に変換。
 *
 * @param {Object} input
 * @param {string} input.jsonlText - rollout-*.jsonl の中身
 * @param {string} input.filePath - 元 jsonl ファイルの絶対パス (evidence_ref.uri に使う)
 * @param {string} [input.actorPersonId=DEFAULT_ACTOR_PERSON_ID]
 * @param {string} [input.capturedAt=now]
 * @returns {{ envelope: any, warnings: Array<string> }}
 * @throws Error if session_meta が見つからない / 必須情報が欠落
 */
export function buildCodexSessionEnvelope({ jsonlText, filePath, actorPersonId, capturedAt } = {}) {
    const warnings = [];

    if (typeof jsonlText !== 'string' || !jsonlText.length) {
        throw new Error('jsonlText is required and must be a non-empty string');
    }
    if (typeof filePath !== 'string' || !filePath.length) {
        throw new Error('filePath is required');
    }

    const events = parseJsonl(jsonlText);
    if (events.length === 0) {
        throw new Error('no valid events parsed from jsonl');
    }

    const meta = events.find((e) => e && e.type === 'session_meta');
    if (!meta || !meta.payload) {
        throw new Error('session_meta event missing in rollout jsonl');
    }
    if (!meta.payload.id) {
        throw new Error('session_meta.payload.id missing');
    }

    const sessionId = meta.payload.id;
    const cwd = meta.payload.cwd;
    const originator = meta.payload.originator || 'unknown';
    const cliVersion = meta.payload.cli_version || null;
    const gitInfo = meta.payload.git || null;

    const firstTs = meta.timestamp || events.find((e) => e && e.timestamp)?.timestamp || null;
    const lastTs = [...events].reverse().find((e) => e && e.timestamp)?.timestamp || firstTs;

    if (!firstTs) {
        warnings.push('no timestamp found in events, using captured_at as occurred_at fallback');
    }

    const { workspace, project_code } = deriveWorkspaceAndProject(cwd);

    const fileHash = 'sha256:' + createHash('sha256').update(jsonlText, 'utf8').digest('hex');

    const envelope = {
        raw_event_id: sessionId,
        source_system: SOURCE_SYSTEM,
        source_event_id: sessionId,
        occurred_at: firstTs || (capturedAt || new Date().toISOString()),
        captured_at: capturedAt || new Date().toISOString(),
        actor_external_id: `codex:${sessionId}`,
        actor_person_id: actorPersonId || DEFAULT_ACTOR_PERSON_ID,
        workspace,
        channel_id: null,
        project_code,
        permission_snapshot: {
            roles: ['user'],
            clearance: ['internal']
        },
        evidence_ref: {
            kind: 'source_pointer',
            uri: `file://${path.resolve(filePath)}`,
            hash: fileHash
        },
        retention_policy: 'envelope_only',
        // snippet は P0 では空。 P4 で LLM 要約を入れる予定。
        snippet: '',
        // 補足情報 (kernel 側で参考用):
        meta: {
            event_count: events.length,
            originator,
            cli_version: cliVersion,
            session_started_at: firstTs,
            session_ended_at: lastTs,
            git: gitInfo
        }
    };

    return { envelope, warnings };
}
