#!/usr/bin/env node
// @ts-check
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

import { PgCandidateRepository } from '../server/services/candidate-store/candidate-repository.js';
import { PromotionGateService } from '../server/services/candidate-store/promotion-gate-service.js';
import {
    SOURCE_SYSTEM,
    writeMeetingPersonalKgCandidates
} from '../server/services/sns/oyasumi-meeting-personal-kg-service.js';
import { requirePersonalKgIdentity } from '../server/services/sns/personal-kg-identity.js';

const { Pool } = pg;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DEFAULT_TMP_ROOT = '/tmp';

function parseArgs(argv) {
    const args = {
        date: null,
        input: null,
        outputDir: null,
        write: false,
        json: false,
        allowEmpty: false,
        includeCodex: true,
        includeClaudeCode: true,
        ownerPersonId: null,
        actorPersonId: null,
        organizationId: null,
        delegationId: null
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--date') args.date = argv[++index];
        else if (arg.startsWith('--date=')) args.date = arg.slice('--date='.length);
        else if (arg === '--input') args.input = argv[++index];
        else if (arg.startsWith('--input=')) args.input = arg.slice('--input='.length);
        else if (arg === '--output-dir') args.outputDir = argv[++index];
        else if (arg.startsWith('--output-dir=')) args.outputDir = arg.slice('--output-dir='.length);
        else if (arg === '--write') args.write = true;
        else if (arg === '--dry-run') args.write = false;
        else if (arg === '--json') args.json = true;
        else if (arg === '--allow-empty') args.allowEmpty = true;
        else if (arg === '--codex-only') args.includeClaudeCode = false;
        else if (arg === '--claude-code-only') args.includeCodex = false;
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
    if (!args.date || !/^\d{4}-\d{2}-\d{2}$/u.test(args.date)) {
        throw new Error('--date YYYY-MM-DD required');
    }
    return args;
}

function personalKgIdentity(args, env = process.env) {
    return requirePersonalKgIdentity({
        owner_person_id: args.ownerPersonId || env.BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID,
        actor_person_id: args.actorPersonId || env.BRAINBASE_PERSONAL_KG_ACTOR_PERSON_ID,
        organization_id: args.organizationId
            || env.BRAINBASE_PERSONAL_KG_ORGANIZATION_ID
            || env.BRAINBASE_ORGANIZATION_ID,
        delegation_id: args.delegationId || env.BRAINBASE_PERSONAL_KG_DELEGATION_ID
    }, env);
}

function jstDayRange(date) {
    const [year, month, day] = date.split('-').map(Number);
    const startUtcMs = Date.UTC(year, month - 1, day) - JST_OFFSET_MS;
    const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
    return { startUtcMs, endUtcMs };
}

function toJstIso(value) {
    const date = new Date(value);
    const shifted = new Date(date.getTime() + JST_OFFSET_MS);
    return `${shifted.toISOString().replace('Z', '')}+09:00`;
}

function toJstDate(value) {
    const date = new Date(value);
    const shifted = new Date(date.getTime() + JST_OFFSET_MS);
    return shifted.toISOString().slice(0, 10);
}

function sha12(value) {
    return crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function normalizeSpaces(value) {
    return String(value || '').replace(/\s+/gu, ' ').trim();
}

function idPart(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-|-$/gu, '')
        .slice(0, 90);
}

function isGeneratedClaudeUserText(text) {
    const value = String(text || '').trim();
    return value.startsWith('<local-command-')
        || value.startsWith('<command-name>')
        || value.startsWith('This session is being continued from a previous conversation');
}

function walkJsonlFiles(rootDir, files = []) {
    if (!fs.existsSync(rootDir)) return files;
    const stat = fs.statSync(rootDir);
    if (stat.isFile() && rootDir.endsWith('.jsonl')) {
        files.push(rootDir);
        return files;
    }
    if (!stat.isDirectory()) return files;
    for (const entry of fs.readdirSync(rootDir)) {
        walkJsonlFiles(path.join(rootDir, entry), files);
    }
    return files;
}

function readJsonLines(filePath) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

function normalizeCodexMessages({ date, homeDir = os.homedir() }) {
    const historyPath = path.join(homeDir, '.codex', 'history.jsonl');
    const { startUtcMs, endUtcMs } = jstDayRange(date);
    return readJsonLines(historyPath)
        .filter((record) => Number.isFinite(Number(record.ts)))
        .map((record) => {
            const utcMs = Number(record.ts) * 1000;
            if (utcMs < startUtcMs || utcMs >= endUtcMs) return null;
            const text = normalizeSpaces(record.text);
            if (!text) return null;
            return {
                tool: 'codex',
                session_id: record.session_id || null,
                ts: toJstIso(utcMs),
                text
            };
        })
        .filter(Boolean);
}

function textFromClaudeContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    if (content.length > 0 && content.every((item) => item?.type === 'tool_result')) return '';
    return content
        .filter((item) => item && item.type !== 'tool_result')
        .map((item) => item.text || item.content || item.type || '')
        .join(' ');
}

function normalizeClaudeCodeMessages({ date, homeDir = os.homedir() }) {
    const projectsDir = path.join(homeDir, '.claude', 'projects');
    const { startUtcMs, endUtcMs } = jstDayRange(date);
    return walkJsonlFiles(projectsDir)
        .flatMap((filePath) => readJsonLines(filePath))
        .map((record) => {
            if (record.type !== 'user' || !record.message || typeof record.message !== 'object') return null;
            if (!record.timestamp) return null;
            const utcMs = Date.parse(record.timestamp);
            if (!Number.isFinite(utcMs) || utcMs < startUtcMs || utcMs >= endUtcMs) return null;
            const text = normalizeSpaces(textFromClaudeContent(record.message.content));
            if (!text || isGeneratedClaudeUserText(text)) return null;
            return {
                tool: 'claude_code',
                session_id: record.sessionId || null,
                cwd: record.cwd || null,
                ts: toJstIso(utcMs),
                text
            };
        })
        .filter(Boolean);
}

function withEventIds(messages) {
    const seen = new Set();
    const deduped = [];
    for (const message of messages.sort((a, b) => a.ts.localeCompare(b.ts))) {
        const key = `${message.tool}|${message.session_id || ''}|${message.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push({
            ...message,
            event_id: `${message.tool}:${message.session_id || 'unknown'}:${sha12(`${message.tool}|${message.session_id || ''}|${message.ts}|${message.text}`)}`
        });
    }
    return deduped;
}

function collectConversationMessages({ date, homeDir = os.homedir(), includeCodex = true, includeClaudeCode = true }) {
    const messages = [
        ...(includeCodex ? normalizeCodexMessages({ date, homeDir }) : []),
        ...(includeClaudeCode ? normalizeClaudeCodeMessages({ date, homeDir }) : [])
    ];
    return withEventIds(messages);
}

function collectConversationMessagesByDate({ homeDir = os.homedir(), includeCodex = true, includeClaudeCode = true } = {}) {
    const messages = [];
    if (includeCodex) {
        const historyPath = path.join(homeDir, '.codex', 'history.jsonl');
        for (const record of readJsonLines(historyPath)) {
            if (!Number.isFinite(Number(record.ts))) continue;
            const text = normalizeSpaces(record.text);
            if (!text) continue;
            const utcMs = Number(record.ts) * 1000;
            messages.push({
                tool: 'codex',
                session_id: record.session_id || null,
                ts: toJstIso(utcMs),
                text
            });
        }
    }
    if (includeClaudeCode) {
        const projectsDir = path.join(homeDir, '.claude', 'projects');
        for (const record of walkJsonlFiles(projectsDir).flatMap((filePath) => readJsonLines(filePath))) {
            if (record.type !== 'user' || !record.message || typeof record.message !== 'object') continue;
            if (!record.timestamp) continue;
            const utcMs = Date.parse(record.timestamp);
            if (!Number.isFinite(utcMs)) continue;
            const text = normalizeSpaces(textFromClaudeContent(record.message.content));
            if (!text || isGeneratedClaudeUserText(text)) continue;
            messages.push({
                tool: 'claude_code',
                session_id: record.sessionId || null,
                cwd: record.cwd || null,
                ts: toJstIso(utcMs),
                text
            });
        }
    }

    const grouped = {};
    for (const message of withEventIds(messages)) {
        const date = toJstDate(Date.parse(message.ts));
        grouped[date] = grouped[date] || [];
        grouped[date].push(message);
    }
    return Object.fromEntries(Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right)));
}

function loadInputMessages(inputPath) {
    return readJsonLines(inputPath).map((record) => ({
        tool: record.tool || 'unknown',
        session_id: record.session_id || null,
        cwd: record.cwd || null,
        ts: record.ts || '',
        text: normalizeSpaces(record.text),
        event_id: record.event_id || `${record.tool || 'unknown'}:${record.session_id || 'unknown'}:${sha12(JSON.stringify(record))}`
    })).filter((record) => record.text);
}

function findEvents(messages, patterns, limit = 6) {
    const hits = [];
    for (const message of messages) {
        if (patterns.some((pattern) => message.text.includes(pattern))) {
            hits.push(message.event_id);
        }
        if (hits.length >= limit) break;
    }
    return hits;
}

function hasAny(messages, patterns) {
    return findEvents(messages, patterns, 1).length > 0;
}

function buildCandidate({ date, messages, identity, key, category, cognitiveType = 'insight', sensitivity = 'internal', confidence = 0.82, patterns, body, reviewReason = null }) {
    const access = requirePersonalKgIdentity(identity);
    const isReview = Boolean(reviewReason);
    const memoryLayer = isReview ? 'needs_review' : 'personal_kg_core';
    const sourceRef = `codex-claude-conversation:${date}#${memoryLayer}:${key}`;
    const sourceEventIds = [sourceRef, ...findEvents(messages, patterns, 6)];
    return {
        id: `oyasumi_${date.replace(/-/gu, '')}_conversation_${memoryLayer}_${idPart(key)}`.slice(0, 180),
        cognitive_type: cognitiveType,
        owner_person_id: access.owner_person_id,
        actor_person_id: access.actor_person_id,
        organization_id: access.organization_id,
        source_system: SOURCE_SYSTEM,
        source_event_ids: sourceEventIds,
        workspace: 'codex-claude-code',
        project_code: 'brainbase',
        org_ids: access.org_ids,
        project_ids: ['brainbase'],
        visibility: 'owner',
        sensitivity,
        role_min: 'member',
        agency_level: 'synthesize',
        promotion_status: 'candidate',
        requires_approval: true,
        redaction_status: isReview ? 'needs_redaction' : 'none',
        confidence,
        body,
        permission_snapshot: {
            oyasumi_meeting_personal_kg: {
                category,
                memory_layer: memoryLayer,
                agent_role: 'conversation_personal_kg_extractor_v1',
                source_kind: 'daily_interaction',
                projection_of: null,
                retrieval_purpose: 'owner_judgment',
                projection_allowed: false,
                sns_projection_allowed: false,
                projection_gate: isReview ? 'needs_owner_review_or_redaction' : 'owner_only_daily_interaction_context',
                promotion_scope_candidate: ['personal'],
                sensitivity_reason: reviewReason,
                personal_core_detail_policy: 'preserve_owner_judgment_without_raw_private_values',
                non_owner_retrieval_policy: 'deny_core_details_without_projection_or_promotion',
                meeting_date: date,
                repo: null,
                path: null,
                minutes_path: null,
                transcript_path: null,
                html_url: null,
                sha: null,
                extraction_decision: isReview ? 'needs_review' : 'adopted',
                rule_id: key,
                source_ref: sourceRef,
                scan_input_count: messages.length,
                personal_kg_identity: {
                    owner_person_id: access.owner_person_id,
                    actor_person_id: access.actor_person_id,
                    organization_id: access.organization_id
                }
            }
        },
        evidence_ids: [{ uri: sourceRef, source_ref: sourceRef, sha: null }]
    };
}

const RULES = [
    {
        key: 'conversation-personal-kg-must-scan-agent-dialogues',
        category: 'personal_kg_learning_loop',
        patterns: ['個人KG', 'Personal KG', 'candidate', '学習'],
        confidence: 0.9,
        body: 'Context: Codex/Claude Codeの直接入力に判断材料があるのに、議事録由来0件をPersonal KG全体0件として扱う問題があった。 Judgment: Personal KG学習はagent会話ログを日次scan対象に含め、入力件数、候補件数、core件数、needs_review件数を分けて報告しないと意味が薄い。 Reusable Pattern: meeting extractorの結果をPersonal KG全体とみなさず、Codex/Claude Code会話もcandidate inbox化する。 Apply When: /oyasumi、retro、KG監査、学習品質の確認。 Do Not Apply When: ログに一過性の作業指示しかなく、再利用可能な判断がない時。'
    },
    {
        key: 'do-not-merge-experimental-work-directly-to-develop',
        category: 'branch_release_policy',
        cognitiveType: 'preference',
        patterns: ['developに直接マージ', 'ブランチ切って', 'feature/'],
        confidence: 0.86,
        body: 'Context: LLMチャットやAI検索など実験性の高い変更で、developへ直接入れないよう修正していた。 Judgment: developは常に受け皿ではなく、影響が大きい機能は目的別feature branchに隔離してから検証・PR化する。 Reusable Pattern: 「マージして」と言われても、直前の方針がfeature branch運用ならdevelopへ入れず、対象ブランチを確認して合わせる。 Apply When: LLM機能、検索、チャット、共有基盤など回帰影響が大きい変更。 Do Not Apply When: ユーザーが明示的にdevelop投入を指示し、検証済みである時。'
    },
    {
        key: 'pr-must-reduce-review-cognitive-load',
        category: 'review_philosophy',
        cognitiveType: 'preference',
        patterns: ['PRとしてレビューできて', '認知負荷', '俺の脳になって'],
        confidence: 0.84,
        body: 'Context: PRを見て「本来どんな内容が書いてあればレビューできてマージまでできるか」「認知負荷を下げるにはどうすればいいか」と確認していた。 Judgment: PRは差分の列挙ではなく、目的、判断理由、影響範囲、検証証跡、残リスクが揃って初めてレビュー可能になる。 Reusable Pattern: PR説明はreviewerの脳内再構築コストを下げる構造にする。 Apply When: VibePro PR、feature branch PR、複数repo同期PR。 Do Not Apply When: ごく小さい文言修正で、diffだけで意図が自明な時。'
    },
    {
        key: 'vibepro-for-story-to-pr-and-pdca',
        category: 'vibepro_operating_model',
        cognitiveType: 'preference',
        patterns: ['VibeProでPR', 'VibeProでストーリー', 'PDCA', 'ゴール設定'],
        confidence: 0.86,
        body: 'Context: 大きめの修正では「VibeProでストーリーを切って」「PRまで」「PDCAまでゴール設定」と繰り返し指示していた。 Judgment: 重要変更は単発実装ではなく、Story、Spec/Task、実装、Gate、PR、PDCAの流れで扱う。 Reusable Pattern: 仕様・UI・運用保証が絡む依頼は、作業前にVibeProの目的単位へ落としてから進める。 Apply When: UI/UX変更、運用保証、AI機能、PR品質改善。 Do Not Apply When: 緊急の小修正で、ユーザーが明示的にVibeProを不要とした時。'
    },
    {
        key: 'verify-with-real-runtime-before-claiming-fixed',
        category: 'verification_philosophy',
        cognitiveType: 'preference',
        patterns: ['ちゃんとローカルで動作確認', 'ログ確認', 'fly.ioも確認', 'gitで確認', 'プレビューURL'],
        confidence: 0.88,
        body: 'Context: 失敗画像、staging/prod、fly.io、git、プレビューURLについて「ちゃんと確認してから」と何度も修正していた。 Judgment: 修正完了や反映済みの主張は、実際のログ、URL、ローカル動作、デプロイ先、git状態の証跡とセットでなければ信用しない。 Reusable Pattern: 「できた」と言う前に、どの環境で何を見て確認したかを明示する。 Apply When: デプロイ、UI反映、データ同期、外部サービス連携、回帰修正。 Do Not Apply When: まだ調査中で、仮説として明示している時。'
    },
    {
        key: 'conversational-ai-must-use-history-and-real-data',
        category: 'product_design_philosophy',
        cognitiveType: 'preference',
        patterns: ['ちゃんとチャット', 'チャット履歴', 'DBから参照', 'コンテキストエンジニアリング', 'LLMベース'],
        confidence: 0.83,
        body: 'Context: チャットUIで、会話履歴、DB参照、LLMベース回答、コンテキスト設計を強く確認していた。 Judgment: 会話型AIはルール返答や単発検索ではなく、履歴、ユーザー意図、実DBデータを統合して応答する必要がある。 Reusable Pattern: AIチャット機能では「会話になっているか」「履歴を次ターンに使っているか」「実データを参照しているか」を最低検証にする。 Apply When: LLMチャット、検索アシスタント、ホテル/企業推薦UI。 Do Not Apply When: 静的なFAQや単発フォーム検索でよいと明示されている時。'
    },
    {
        key: 'keep-recommendations-focused-with-drilldown',
        category: 'content_design',
        cognitiveType: 'preference',
        patterns: ['提案内容が多い', '3つに絞った', 'もっと見る'],
        confidence: 0.78,
        body: 'Context: 提案内容が多すぎる場面で、3つに絞るか「もっと見る」で一覧へ飛ばす形を求めていた。 Judgment: AIの推薦UIは選択肢を増やしすぎると判断負荷が上がるため、初期表示は少数の高品質候補に絞る。 Reusable Pattern: まず3件程度に絞り、必要なら一覧・詳細・もっと見るへ逃がす。 Apply When: 検索結果、ホテル提案、営業候補、AI推薦UI。 Do Not Apply When: 比較表や網羅性が主目的の画面。'
    },
    {
        key: 'ui-workflows-must-keep-add-edit-display-consistent',
        category: 'ui_design_philosophy',
        cognitiveType: 'preference',
        patterns: ['追加UI', '編集UI', '統一性', 'UI/UX', '確定後に描画'],
        confidence: 0.8,
        body: 'Context: 入力時と確定後の描画、追加UIと編集UI、snapshotとxtermなど、同じ体験内の不整合を繰り返し指摘していた。 Judgment: UI改善は単一画面の見た目ではなく、追加、編集、確定後表示、履歴、snapshotなど一連の状態遷移で整合している必要がある。 Reusable Pattern: UI修正では、対象コンポーネントだけでなく隣接する作成/編集/表示/履歴の体験差分も確認する。 Apply When: CRUD UI、チャット履歴、ターミナル表示、snapshot、デザイン同期。 Do Not Apply When: 完全に独立した静的表示だけを修正する時。'
    },
    {
        key: 'context-engineering-should-use-official-guidance',
        category: 'ai_engineering_philosophy',
        cognitiveType: 'preference',
        patterns: ['コンテキストエンジニアリング', 'Anthropic', 'OpenAI', '公式資料'],
        confidence: 0.78,
        body: 'Context: コンテキストエンジニアリングについて、独自判断ではなくAnthropicやOpenAIの公式資料を確認するよう指摘していた。 Judgment: LLMの履歴投入、ツール利用、プロンプト設計は勘で作らず、公式ガイドと既知の実践知に照らして設計する。 Reusable Pattern: AI機能で会話履歴や文脈保持を扱う時は、実装前に公式ドキュメント由来の設計制約を確認する。 Apply When: LLMチャット、agent memory、retrieval、prompt/context設計。 Do Not Apply When: 既存実装の小さな表示修正でLLM挙動に触れない時。'
    },
    {
        key: 'restart-failures-require-cause-analysis',
        category: 'ops_philosophy',
        cognitiveType: 'preference',
        patterns: ['死んでます', '死んだ理由', '再起動'],
        confidence: 0.82,
        body: 'Context: セッションや診断改善プロセスが止まった時、再起動だけでなく「なぜ死んだのか」も調査するよう指示していた。 Judgment: runtime/agent停止は復旧だけでは不足で、原因と再発防止を同時に扱う。 Reusable Pattern: 再起動依頼では、復旧、原因確認、再発防止候補、必要ならissue化までをセットにする。 Apply When: dev server、agent session、VibePro、loop、MCP、外部連携が停止した時。 Do Not Apply When: ユーザーが明示的に一時復旧だけを求めている時。'
    },
    {
        key: 'prefer-official-mcp-and-remove-custom-when-available',
        category: 'mcp_ops',
        cognitiveType: 'preference',
        patterns: ['公式MCP', '自作版', '移行してくれ', '管理対象から消して'],
        confidence: 0.82,
        body: 'Context: MCPについて公式版があるか、自作版を使っているかを確認し、公式へ移行して自作版を管理対象から外すよう指示していた。 Judgment: 公式MCPが実用可能なら、同等の自作MCPを残して同じ障害を繰り返すべきではない。 Reusable Pattern: 外部SaaS連携は公式MCPを優先し、自作版は明確な差分価値がない限り退役させる。 Apply When: Slack、Jibble、Google系、その他公式MCPが存在する連携。 Do Not Apply When: 公式MCPに必要機能がなく、自作版の保守価値が明確な時。'
    },
    {
        key: 'manage-integration-secrets-through-infisical',
        category: 'secret_ops',
        cognitiveType: 'preference',
        patterns: ['infisical化', 'Jibble', 'MCP'],
        confidence: 0.76,
        body: 'Context: MCP連携で、設定をInfisical管理にするよう指示していた。 Judgment: MCP/API連携の認証情報は個別ローカル設定に散らさず、Infisicalなどの管理面へ寄せる。 Reusable Pattern: 新しい外部連携を追加する時は、接続確認だけでなくsecret管理方式も同時に固定する。 Apply When: MCP、API token、外部SaaS連携、launchd/agent runtime。 Do Not Apply When: 一時的なローカル検証で、認証情報を永続化しない時。'
    },
    {
        key: 'cross-repo-sync-after-merge-needs-explicit-preview',
        category: 'release_ops',
        cognitiveType: 'preference',
        patterns: ['SalesTailor-incに同期', 'Salestailor-incに同期', 'プレビューURL', 'マージしてプレビュー'],
        confidence: 0.8,
        body: 'Context: マージ後にSalesTailor-inc同期やプレビューURL提示を繰り返し求めていた。 Judgment: 複数repo/複数環境にまたがる変更は、mergeだけで完了ではなく、同期先とプレビュー確認までが完了条件になる。 Reusable Pattern: merge指示には、対象branch、下流repo同期、preview/prod/staging URL、反映確認をセットで扱う。 Apply When: SalesTailor、Vercel、GitHub連携、staging/prod同期。 Do Not Apply When: 単一repoのローカル-only変更。'
    },
    {
        key: 'data-sync-must-check-related-fields-not-only-visible-symptom',
        category: 'data_integrity',
        patterns: ['業界だけじゃなくて', '代表者の名前', '従業員規模', 'masterfileds', 'golden_company'],
        confidence: 0.78,
        body: 'Context: データ同期不具合の調査で、見えているフィールドだけでなく代表者名や従業員規模など他フィールドも更新されているはずだと指摘していた。 Judgment: データ同期不具合は見えている1フィールドだけでなく、同じ同期単位の関連フィールドも確認しないと原因を見誤る。 Reusable Pattern: sync/importの調査では、症状フィールド、同一source由来フィールド、件数、prod/staging差分をまとめて検証する。 Apply When: masterfields同期、golden_company、企業DB、検索フィルタ。 Do Not Apply When: 単一カラムだけのUI表示バグと証明済みの時。'
    },
    {
        key: 'formalize-private-admin-info-without-raw-values',
        category: 'private_admin_context',
        cognitiveType: 'preference',
        sensitivity: 'restricted',
        patterns: ['資格取得届', 'マイナンバー', '扶養', '保険証'],
        confidence: 0.84,
        body: 'Context: 資格取得届向けの本人情報、扶養、社会保険、健康保険の伝え方を確認していた。 Judgment: 個人情報や番号系情報は会話ログやSlackに生値を残さず、必要項目だけを正式名称でまとめ、不明/未共有項目はXXXまたは別経路に分ける。 Reusable Pattern: HR/社会保険手続きでは俗称や色ではなく、加入先・保険証・扶養有無など正式に伝わる表現を使う。 Apply When: 社会保険、資格取得届、本人確認、番号系情報を共有する時。 Do Not Apply When: 公開投稿、SNS、チーム共有、不要な個人情報保存。'
    },
    {
        key: 'sns-feedback-requires-posted-url-and-metrics',
        category: 'sns_learning_loop',
        patterns: ['SNS', '表示されない', 'feedback', 'posted_url'],
        confidence: 0.76,
        body: 'Context: SNSの更新表示や投稿実績確認で、生成物だけでは学習材料として不十分な状態があった。 Judgment: SNS学習は投稿候補ではなく、posted_url、投稿時刻、反応数値、異常有無が揃って初めて学習候補になる。 Reusable Pattern: /oyasumi feedbackでは実績のない投稿候補を学習済みにせず、翌朝確認へ持ち越す。 Apply When: daily briefやreview packはあるが、投稿実績や反応が未確認の時。 Do Not Apply When: posted_urlとmetricsが揃ってfeedback-learningへ投入できる時。'
    }
];

const REVIEW_RULES = [
    {
        key: 'person-analysis-must-avoid-unreviewed-sensitive-profiling',
        category: 'people_analysis',
        cognitiveType: 'insight',
        sensitivity: 'confidential',
        patterns: ['トシさん', '思考', 'AI分析', '1on1'],
        confidence: 0.74,
        reviewReason: 'third-party/person analysis context; requires owner review before reuse',
        body: 'Context: 第三者との1on1や思考分析について、本人共有後の受け止めを相談していた。 Judgment: 人物分析は有用でも、未レビューの心理・能力推定として扱うと危険なので、本人文脈と目的を確認してから再利用する。 Reusable Pattern: 人物分析は称賛/断定/ラベル化に寄せず、観察事実、仮説、本人確認済み事項、次の対話設計に分ける。 Apply When: 1on1、人物理解、組織配置、コミュニケーション改善。 Do Not Apply When: 公開共有、評価断定、本人確認なしのレッテル貼り。'
    },
    {
        key: 'external-slack-or-payment-threads-need-confidential-review',
        category: 'confidential_ops_context',
        cognitiveType: 'observation',
        sensitivity: 'confidential',
        patterns: ['Slack', '橋本', '振込', '返信', '支払'],
        confidence: 0.7,
        reviewReason: 'Slack/payment/customer context may include confidential details; abstracted only',
        body: 'Context: Slackスレッド、返信下書き、支払/振込確認など、外部関係者や社内オペレーションに関わる相談があった。 Judgment: これらは作業上重要でも、会話ログから直接Personal KG化する前に機密性と共有範囲を確認する必要がある。 Reusable Pattern: 外部スレッドや支払関連は、事実・依頼・返信方針を分け、個人KGには抽象化した運用原則だけを残す。 Apply When: Slack DM/チャンネル、支払、返信下書き、顧客/パートナー連絡。 Do Not Apply When: 公開済み情報または単純なリンク参照だけの時。'
    }
];

function extractConversationPersonalKgCandidates({ date, messages, identity }) {
    const access = requirePersonalKgIdentity(identity);
    const adopted = [];
    for (const rule of RULES) {
        if (!hasAny(messages, rule.patterns)) continue;
        adopted.push(buildCandidate({ date, messages, identity: access, ...rule }));
    }
    for (const rule of REVIEW_RULES) {
        if (!hasAny(messages, rule.patterns)) continue;
        adopted.push(buildCandidate({ date, messages, identity: access, ...rule }));
    }
    const coreCount = adopted.filter((candidate) => candidate.permission_snapshot.oyasumi_meeting_personal_kg.memory_layer === 'personal_kg_core').length;
    const needsReview = adopted.filter((candidate) => candidate.permission_snapshot.oyasumi_meeting_personal_kg.memory_layer === 'needs_review');
    const needsRedactionCount = adopted.filter((candidate) => candidate.redaction_status === 'needs_redaction').length;
    const rejectedSkippedCount = Math.max(0, messages.length - adopted.length);
    const harvesterStatus = messages.length === 0 ? 'needs_review' : 'completed';
    return {
        date,
        source_system: SOURCE_SYSTEM,
        input_count: messages.length,
        scanned_count: messages.length,
        deduped_count: messages.length,
        adopted,
        rejected: [],
        needs_review: needsReview,
        discard_summary: [
            { reason: '単発のmerge/preview/deploy依頼で、新規の再利用可能判断がない', count: rejectedSkippedCount }
        ],
        agent_reports: [
            {
                role: 'conversation_harvester',
                status: harvesterStatus,
                input_count: messages.length,
                output_count: messages.length,
                notes: messages.length === 0
                    ? ['no codex_history or claude_projects user messages found; treat as log collection issue unless --allow-empty was intentional']
                    : ['codex_history + claude_projects user messages']
            },
            {
                role: 'conversation_personal_kg_extractor',
                status: 'completed',
                input_count: messages.length,
                output_count: adopted.length,
                notes: [`personal_kg_core=${coreCount}`, `needs_review=${needsReview.length}`]
            }
        ],
        counts: {
            personal_kg_core: coreCount,
            needs_review: needsReview.length,
            sns_ready: 0,
            rejected_skipped: rejectedSkippedCount,
            needs_redaction: needsRedactionCount,
            projection_allowed: 0,
            deduped_messages: messages.length
        }
    };
}

function databaseConfig() {
    if (process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL) {
        return { connectionString: process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL };
    }
    if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
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
        throw new Error(`Missing PostgreSQL config: ${missing.join(', ')}. Set INFO_SSOT_DATABASE_URL or PGDATABASE/PGUSER.`);
    }
}

function outputText({ extracted, writeSummary, messagesPath, extractionPath, write }) {
    const lines = [
        `${SOURCE_SYSTEM} conversation personal KG: ${extracted.date}`,
        `mode: ${write ? 'write' : 'dry-run'}`,
        `conversation.input_count: ${extracted.input_count}`,
        `conversation.deduped_messages: ${extracted.counts.deduped_messages}`,
        `personal_kg_core: ${extracted.counts.personal_kg_core}`,
        `sns_ready: ${extracted.counts.sns_ready}`,
        `needs_review: ${extracted.counts.needs_review}`,
        `needs_redaction: ${extracted.counts.needs_redaction}`,
        `projection_allowed: ${extracted.counts.projection_allowed}`,
        `rejected_skipped: ${extracted.counts.rejected_skipped}`,
        `messages_path: ${messagesPath}`,
        `extraction_path: ${extractionPath}`
    ];
    if (extracted.input_count === 0) {
        lines.push('WARNING: conversation.input_count is 0; treat this as log collection failure unless --allow-empty was intentional.');
    }
    if (writeSummary) {
        lines.push(`inserted: ${writeSummary.inserted}`);
        lines.push(`skipped: ${writeSummary.skipped}`);
        lines.push(`blocked: ${writeSummary.blocked}`);
    }
    return lines.join('\n');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const identity = personalKgIdentity(args);
    const outputDir = args.outputDir || path.join(DEFAULT_TMP_ROOT, `oyasumi-${args.date}`);
    fs.mkdirSync(outputDir, { recursive: true });
    const messages = args.input
        ? loadInputMessages(args.input)
        : collectConversationMessages({
            date: args.date,
            includeCodex: args.includeCodex,
            includeClaudeCode: args.includeClaudeCode
        });
    const messagesPath = path.join(outputDir, 'conversation-user-messages.jsonl');
    fs.writeFileSync(messagesPath, messages.map((message) => JSON.stringify(message)).join('\n') + (messages.length ? '\n' : ''), { mode: 0o600 });
    fs.chmodSync(messagesPath, 0o600);

    const extracted = extractConversationPersonalKgCandidates({ date: args.date, messages, identity });
    const extractionPath = path.join(outputDir, 'conversation-personal-kg-extraction.json');
    fs.writeFileSync(extractionPath, JSON.stringify(extracted, null, 2), { mode: 0o600 });
    fs.chmodSync(extractionPath, 0o600);
    if (messages.length === 0 && !args.allowEmpty) {
        const payload = {
            mode: args.write ? 'write' : 'dry-run',
            messages_path: messagesPath,
            extraction_path: extractionPath,
            extracted,
            write_summary: null,
            error: 'conversation input_count is 0; log collection likely failed. Pass --allow-empty only for intentional empty backfills.'
        };
        console.error(args.json ? JSON.stringify(payload, null, 2) : outputText({ extracted, writeSummary: null, messagesPath, extractionPath, write: args.write }));
        process.exitCode = 2;
        return;
    }

    let writeSummary = null;
    if (args.write) {
        const config = databaseConfig();
        validateConfig(config);
        const pool = new Pool(config);
        try {
            const repository = new PgCandidateRepository({ pool });
            const candidateService = new PromotionGateService({ repository });
            writeSummary = await writeMeetingPersonalKgCandidates({ candidateService, extracted, identity });
        } finally {
            await pool.end();
        }
    }

    const payload = {
        mode: args.write ? 'write' : 'dry-run',
        messages_path: messagesPath,
        extraction_path: extractionPath,
        extracted,
        write_summary: writeSummary
    };
    console.log(args.json ? JSON.stringify(payload, null, 2) : outputText({ extracted, writeSummary, messagesPath, extractionPath, write: args.write }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

export {
    collectConversationMessages,
    collectConversationMessagesByDate,
    extractConversationPersonalKgCandidates,
    loadInputMessages,
    normalizeClaudeCodeMessages,
    normalizeCodexMessages,
    parseArgs,
    toJstDate
};
