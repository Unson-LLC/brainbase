import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ulid } from 'ulid';
import { logger } from '../utils/logger.js';
import { OntologyError } from './ontology-kernel.js';
import { OntologyRegistry } from './ontology-registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEARNING_SCHEMA_PATH = path.join(__dirname, '..', 'sql', 'learning-schema.sql');

const SOURCE_TYPES = new Set(['review', 'explicit_learn', 'session_log', 'codex_session_log']);
const OUTCOMES = new Set(['success', 'failure', 'partial']);
const PROMOTION_HINTS = new Set(['auto', 'wiki', 'skill', 'both']);
const APPLY_MODES = new Set(['auto', 'manual']);
const MEMORY_SUBJECT_TYPES = new Set(['person', 'role', 'project', 'org', 'customer', 'decision', 'raci_assignment', 'philosophy', 'glossary_term']);
const MEMORY_VISIBILITIES = new Set(['private', 'role', 'project', 'owner', 'team', 'org', 'public']);
const MEMORY_ROLE_MIN = new Set(['member', 'gm', 'ceo']);
const MEMORY_SENSITIVITIES = new Set(['internal', 'restricted', 'confidential', 'top-secret', 'hr', 'finance', 'contract']);
const MEMORY_PROMOTION_STATUSES = new Set(['candidate', 'gate_classified', 'pending_approval', 'auto_promoted', 'approved', 'rejected', 'expired', 'promoted_to_graph']);
const MEMORY_REDACTION_STATUSES = new Set(['none', 'redacted', 'needs_redaction']);
const MEMORY_DRAFT_STATUSES = ['candidate', 'gate_classified', 'pending_approval', 'auto_promoted', 'approved', 'rejected', 'expired'];
const MEMORY_APPROVED_FOR_GRAPH_STATUSES = new Set(['approved', 'auto_promoted']);
const MEMORY_GRAPH_ENTITY_TYPES = new Set(['person', 'project', 'org', 'customer', 'decision', 'raci_assignment', 'philosophy', 'glossary_term']);
const WIKI_ROUTE_RULES = [
    { docType: 'decisions', keywords: ['decision', 'adr', '採択', '採用', '判断', '方針決定', 'guardrail'] },
    { docType: 'stories', keywords: ['story', '受け入れ', 'acceptance', 'ユーザー', '導線', 'behavior', 'ふるまい'] },
    { docType: 'specs', keywords: ['spec', '仕様', 'schema', 'contract', 'checklist', 'api', 'field', 'input', 'output'] },
    { docType: 'spikes', keywords: ['spike', 'experiment', '仮説', '検証', 'prototype', 'trial'] }
];

const WIKI_SIGNAL_KEYWORDS = ['原則', '方針', '判断基準', '定義', '背景', 'rule', 'policy', 'decision', 'why', 'spec', 'story', 'adr'];
const SKILL_SIGNAL_KEYWORDS = ['手順', 'チェックリスト', '発火', 'trigger', '運用', 'コマンド', '回避', 'fix', 'how', 'steps', 'procedure'];

function toArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

function flattenValue(value) {
    if (Array.isArray(value)) {
        return value.map(flattenValue).filter(Boolean).join(' ');
    }
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') {
        return Object.values(value).map(flattenValue).filter(Boolean).join(' ');
    }
    return '';
}

function flattenEvidence(evidence) {
    if (!evidence || typeof evidence !== 'object') return '';
    return flattenValue(evidence).trim();
}

function countKeywords(text, keywords) {
    return keywords.reduce((count, keyword) => (
        text.includes(keyword.toLowerCase()) ? count + 1 : count
    ), 0);
}

// Codex/Claude skill loader は SKILL.md frontmatter の `name` フィールドに
// 64 文字上限を要求する（exceeds maximum length of 64 characters エラー）。
// project segment + skill slug の合計が 64 を超えないよう保守的に絞る。
const SKILL_SLUG_MAX = 48;

function slugify(value, maxLen = SKILL_SLUG_MAX) {
    return (value || 'untitled')
        .toLowerCase()
        .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLen) || 'untitled';
}

// --- Skill \u540d \u54c1\u8cea\u30b2\u30fc\u30c8 ---
// Skill \u30c7\u30a3\u30ec\u30af\u30c8\u30ea/name \u306f ASCII kebab-case \u306b\u9650\u5b9a\u3059\u308b\u3002\u65e5\u672c\u8a9e summary \u304b\u3089\u540d\u524d\u3092
// \u81ea\u52d5\u751f\u6210\u3059\u308b\u3068\u58ca\u308c\u305f skill \u540d\u306b\u306a\u308b\uff082026-07 \u306b105\u4ef6\u8aa4\u751f\u6210\u3057\u305f\u6559\u8a13\uff09\u3002ASCII kebab \u3092
// \u5c0e\u51fa\u3067\u304d\u306a\u3044 episode \u306f skill \u3078\u6607\u683c\u3055\u305b\u305a wiki/lessons \u306b\u56de\u3059\u3002
const SKILL_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SKILL_NAME_MIN = 3;
const SKILL_NAME_MAX = 64;
const SKILL_MIN_STEPS_CHARS = 20;

function asciiSlugify(value, maxLen = SKILL_SLUG_MAX) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')  // ASCII \u82f1\u6570\u5b57\u4ee5\u5916\u306f\u5168\u3066 '-' \u306b\uff08\u65e5\u672c\u8a9e\u306f\u4fdd\u6301\u3057\u306a\u3044\uff09
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLen)
        .replace(/-+$/g, '');
}

export function isValidSkillName(name) {
    if (typeof name !== 'string') return false;
    const n = name.trim();
    return n.length >= SKILL_NAME_MIN && n.length <= SKILL_NAME_MAX && SKILL_NAME_PATTERN.test(n);
}

// episode \u304b\u3089\u6607\u683c\u53ef\u80fd\u306a ASCII kebab skill slug \u3092\u5c0e\u51fa\u3002\u5c0e\u51fa\u3067\u304d\u306a\u3051\u308c\u3070 null\u3002
export function deriveSkillSlug(episode) {
    const refs = toArray(episode.skill_refs);
    if (refs.length > 0) {
        const fromRef = (refs[0].split('/').slice(-2, -1)[0] || '').trim();
        if (isValidSkillName(fromRef)) return fromRef;
    }
    if (episode.skill_name && isValidSkillName(String(episode.skill_name))) {
        return String(episode.skill_name).trim();
    }
    const projectSegment = asciiSlugify(episode.project_id || 'brainbase');
    const summarySlug = asciiSlugify(episode.summary);
    if (!summarySlug) return null;  // summary \u304c\u65e5\u672c\u8a9e\u4e3b\u4f53\u306a\u3089 ASCII \u90e8\u5206\u304c\u7a7a \u2192 skill \u5316\u3057\u306a\u3044
    const combined = `${projectSegment ? projectSegment + '-' : ''}${summarySlug}`
        .slice(0, SKILL_NAME_MAX).replace(/-+$/g, '');
    return isValidSkillName(combined) ? combined : null;
}

// YAML 値に特殊文字（`:`, `#`, `&`, `*`, `?`, `|`, `<`, `>`, `=`, `!`, `%`, `@`,
// `` ` ``, 改行, 先頭/末尾の空白）が含まれる場合は double quote で囲む。
// 含まないキーは plain で出力（読みやすさ優先）。
function yamlQuote(value) {
    const text = String(value ?? '');
    const needsQuote = /[:#&*?|<>=!%@`\n]|^\s|\s$/.test(text)
        || text.startsWith('-') || text === '';
    if (!needsQuote) return text;
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function truncate(value, max = 120) {
    if (!value) return '';
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function uniqueStrings(values = []) {
    return Array.from(new Set(toArray(values)));
}

function personalKgSearchTokens(value = '') {
    const normalized = String(value || '')
        .normalize('NFKC')
        .replace(/[「」『』"'`]+/g, ' ')
        .replace(/[。、，,.!！?？:：;；/\\|()[\]{}<>]+/g, ' ')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized) return [];
    return Array.from(new Set(normalized.split(' ').filter(Boolean))).slice(0, 8);
}

function normalizeSemanticText(value = '') {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/brainbase-/g, '')
        .replace(/[「」『』"'`]+/g, ' ')
        .replace(/[。、，,.!！?？:：;；/\\|()[\]{}<>]+/g, ' ')
        .replace(/[-_]+/g, ' ')
        .replace(/\b(?:を|に|で|は|が|の|と|へ|から|より|まで|など|する|した|して|される|している|must|should|always|never|the|a|an|to|for|of|and|or)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizeSemanticText(value = '') {
    const normalized = normalizeSemanticText(value);
    if (!normalized) return [];
    return normalized.split(' ').filter(Boolean);
}

function createTrigrams(value = '') {
    const normalized = normalizeSemanticText(value).replace(/\s+/g, '');
    if (!normalized) return [];
    if (normalized.length < 3) return [normalized];
    const grams = [];
    for (let index = 0; index <= normalized.length - 3; index += 1) {
        grams.push(normalized.slice(index, index + 3));
    }
    return grams;
}

function jaccardSimilarity(left = [], right = []) {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    if (leftSet.size === 0 && rightSet.size === 0) return 1;
    const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
    const union = new Set([...leftSet, ...rightSet]).size;
    return union === 0 ? 0 : intersection / union;
}

function diceSimilarity(left = [], right = []) {
    if (left.length === 0 && right.length === 0) return 1;
    const leftCounts = new Map();
    left.forEach((token) => leftCounts.set(token, (leftCounts.get(token) || 0) + 1));
    let overlap = 0;
    right.forEach((token) => {
        const count = leftCounts.get(token) || 0;
        if (count > 0) {
            overlap += 1;
            leftCounts.set(token, count - 1);
        }
    });
    return (2 * overlap) / (left.length + right.length);
}

function maxRiskLevel(left = 'low', right = 'low') {
    const rank = { low: 1, medium: 2, high: 3 };
    return (rank[left] || 1) >= (rank[right] || 1) ? left : right;
}

function chooseMoreConservativeApplyMode(left = 'manual', right = 'manual') {
    return left === 'manual' || right === 'manual' ? 'manual' : 'auto';
}

function deriveCandidateSemanticText(episode, pillar) {
    if (pillar === 'document' || pillar === 'wiki') {
        return episode.evidence?.proposed_rule || episode.summary || '';
    }
    return episode.evidence?.proposed_steps || episode.summary || '';
}

function deriveExistingCandidateSemanticText(candidate) {
    if (candidate?.canonical_summary) return candidate.canonical_summary;
    return normalizeSemanticText(
        extractFrontmatterValue(candidate?.proposed_content || '', 'description')
        || extractFirstHeading(candidate?.proposed_content || '')
        || candidate?.target_ref
        || ''
    );
}

function deriveSemanticScope({ pillar, docType = '', projectId = '' }) {
    if (pillar === 'document' || pillar === 'wiki') {
        return `document:${docType || 'architecture'}:${projectId || 'global'}`;
    }
    return `${pillar}:${projectId || 'brainbase'}`;
}

function computeSemanticSimilarity(leftText = '', rightText = '') {
    const leftTokens = tokenizeSemanticText(leftText);
    const rightTokens = tokenizeSemanticText(rightText);
    const tokenScore = jaccardSimilarity(leftTokens, rightTokens);
    const trigramScore = diceSimilarity(createTrigrams(leftText), createTrigrams(rightText));
    const commonTokenCount = leftTokens.filter((token) => rightTokens.includes(token)).length;
    const score = Math.max(
        trigramScore,
        (tokenScore + trigramScore) / 2
    );

    return {
        score,
        tokenScore,
        trigramScore,
        commonTokenCount
    };
}

function isSemanticMatch(leftText = '', rightText = '') {
    const left = normalizeSemanticText(leftText);
    const right = normalizeSemanticText(rightText);
    if (!left || !right) {
        return { match: false, reason: 'empty', score: 0 };
    }
    if (left.length < 8 || right.length < 8) {
        return { match: false, reason: 'too_short', score: 0 };
    }
    if (left === right) {
        return { match: true, reason: 'canonical_exact', score: 1 };
    }

    const similarity = computeSemanticSimilarity(left, right);
    if (similarity.trigramScore >= 0.94) {
        return { match: true, reason: 'trigram_high', ...similarity };
    }
    if (similarity.commonTokenCount >= 2 && similarity.tokenScore >= 0.72 && similarity.trigramScore >= 0.82) {
        return { match: true, reason: 'token_trigram_combo', ...similarity };
    }
    return { match: false, reason: 'below_threshold', ...similarity };
}

function extractFirstHeading(markdown = '') {
    if (typeof markdown !== 'string' || !markdown.trim()) return '';
    const lines = markdown.split('\n');
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line === '---') continue;
        if (line.startsWith('# ')) {
            return line.replace(/^#\s+/, '').trim();
        }
    }
    return '';
}

function extractFrontmatterValue(markdown = '', key) {
    if (typeof markdown !== 'string' || !markdown.startsWith('---')) return '';
    const lines = markdown.split('\n');
    for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.trim() === '---') break;
        const match = line.match(new RegExp(`^${key}:\\s*(.+)$`));
        if (match) {
            return match[1].trim();
        }
    }
    return '';
}

function deriveCandidateTitle(candidate) {
    if (!candidate || typeof candidate !== 'object') return '';
    if (candidate.pillar === 'skill') {
        const skillName = extractFrontmatterValue(candidate.proposed_content, 'name');
        if (skillName) return skillName;
    }

    return extractFirstHeading(candidate.proposed_content) || candidate.target_ref || '';
}

function deriveSourcePreview(episode) {
    if (!episode) return '';
    const preview = episode.summary || episode.evidence?.proposed_rule || episode.evidence?.proposed_steps || '';
    return truncate(String(preview).replace(/\s+/g, ' ').trim(), 100);
}

function getEpisodeText(episode) {
    return [
        episode.summary,
        flattenEvidence(episode.evidence),
        ...toArray(episode.skill_refs),
        ...toArray(episode.wiki_refs)
    ].join(' ').toLowerCase();
}

function hasExplicitConflict(evidence = {}) {
    if (!evidence || typeof evidence !== 'object') return false;
    return Boolean(
        evidence.conflicts_with_existing
        || evidence.contradiction
        || evidence.requires_manual_review
    );
}

function normalizeApplyMode(value) {
    return APPLY_MODES.has(value) ? value : 'manual';
}

function normalizeOptionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeMemoryJson(value, fieldName) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${fieldName} must be an object`);
    }
    return value;
}

function normalizeMemoryCandidateInput(payload = {}) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('memory candidate payload is required');
    }

    const ownerPersonId = normalizeOptionalString(payload.owner_person_id || payload.ownerPersonId);
    if (!ownerPersonId) throw new Error('owner_person_id is required');

    const sourceSystem = normalizeOptionalString(payload.source_system || payload.sourceSystem);
    if (!sourceSystem) throw new Error('source_system is required');

    const subjectType = normalizeOptionalString(payload.subject_type || payload.subjectType);
    if (!MEMORY_SUBJECT_TYPES.has(subjectType)) {
        throw new Error('subject_type is invalid');
    }

    const visibility = normalizeOptionalString(payload.visibility) || 'private';
    if (!MEMORY_VISIBILITIES.has(visibility)) {
        throw new Error('visibility is invalid');
    }

    const roleMin = normalizeOptionalString(payload.role_min || payload.roleMin) || 'member';
    if (!MEMORY_ROLE_MIN.has(roleMin)) {
        throw new Error('role_min is invalid');
    }

    const sensitivity = normalizeOptionalString(payload.sensitivity);
    if (!MEMORY_SENSITIVITIES.has(sensitivity)) {
        throw new Error('sensitivity is invalid');
    }

    const promotionStatus = normalizeOptionalString(payload.promotion_status || payload.promotionStatus) || 'candidate';
    if (!MEMORY_PROMOTION_STATUSES.has(promotionStatus)) {
        throw new Error('promotion_status is invalid');
    }

    const redactionStatus = normalizeOptionalString(payload.redaction_status || payload.redactionStatus) || 'none';
    if (!MEMORY_REDACTION_STATUSES.has(redactionStatus)) {
        throw new Error('redaction_status is invalid');
    }

    const confidence = Number(payload.confidence);
    const requiresApproval = payload.requires_approval ?? payload.requiresApproval;

    return {
        id: normalizeOptionalString(payload.candidate_id || payload.id) || `memcand_${ulid()}`,
        owner_person_id: ownerPersonId,
        actor_person_id: normalizeOptionalString(payload.actor_person_id || payload.actorPersonId),
        source_system: sourceSystem,
        source_event_ids: uniqueStrings(payload.source_event_ids || payload.sourceEventIds),
        workspace: normalizeOptionalString(payload.workspace),
        channel_id: normalizeOptionalString(payload.channel_id || payload.channelId),
        thread_ts: normalizeOptionalString(payload.thread_ts || payload.threadTs),
        project_code: normalizeOptionalString(payload.project_code || payload.projectCode),
        subject_type: subjectType,
        subject_id: normalizeOptionalString(payload.subject_id || payload.subjectId),
        visibility,
        role_min: roleMin,
        sensitivity,
        promotion_status: promotionStatus,
        requires_approval: typeof requiresApproval === 'boolean' ? requiresApproval : true,
        recommended_owner_person_id: normalizeOptionalString(payload.recommended_owner_person_id || payload.recommendedOwnerPersonId),
        permission_snapshot: normalizeMemoryJson(payload.permission_snapshot || payload.permissionSnapshot || {}, 'permission_snapshot'),
        evidence_ids: uniqueStrings(payload.evidence_ids || payload.evidenceIds),
        expires_at: normalizeOptionalString(payload.expires_at || payload.expiresAt),
        redaction_status: redactionStatus,
        confidence: Number.isFinite(confidence) ? confidence : null,
        memory: normalizeMemoryJson(payload.memory || {}, 'memory')
    };
}

function isLowRiskPrivateMemoryCandidate(candidate) {
    return (candidate.visibility === 'private' || candidate.visibility === 'owner')
        && candidate.sensitivity === 'internal'
        && candidate.role_min === 'member'
        && candidate.redaction_status === 'none'
        && candidate.requires_approval === false;
}

function mapMemoryCandidateGraphType(candidate) {
    const subjectType = normalizeOptionalString(candidate.recommended_subject_type || candidate.subject_type);
    if (subjectType === 'role') return 'raci_assignment';
    if (MEMORY_GRAPH_ENTITY_TYPES.has(subjectType)) return subjectType;
    throw new Error(`memory candidate subject_type cannot be promoted to graph: ${subjectType || 'unknown'}`);
}

function normalizeIngestion(payload = {}) {
    if (!payload || typeof payload !== 'object') return null;
    const adapterName = typeof payload.adapter_name === 'string' ? payload.adapter_name.trim() : '';
    const sourcePath = typeof payload.source_path === 'string' ? payload.source_path.trim() : '';
    const fingerprint = typeof payload.fingerprint === 'string' ? payload.fingerprint.trim() : '';

    if (!adapterName || !sourcePath || !fingerprint) {
        return null;
    }

    return {
        adapter_name: adapterName,
        source_path: sourcePath,
        fingerprint
    };
}

export function classifyWikiDocumentType(episode) {
    const refs = toArray(episode.wiki_refs);
    if (refs.length > 0) {
        const prefix = refs[0].split('/')[0];
        if (['architecture', 'specs', 'stories', 'decisions', 'spikes'].includes(prefix)) {
            return prefix;
        }
    }

    const text = getEpisodeText(episode);
    for (const rule of WIKI_ROUTE_RULES) {
        if (countKeywords(text, rule.keywords) > 0) {
            return rule.docType;
        }
    }

    return 'architecture';
}

export function shouldCreateSkillCandidate(episode) {
    // 品質ゲート（必須）: ASCII kebab の skill 名を導出できること
    if (!deriveSkillSlug(episode)) return false;
    // 品質ゲート（必須）: 実行手順という最小内容があること（明示 skill_refs がある場合は免除）
    const gateEvidence = episode.evidence || {};
    const gateSteps = typeof gateEvidence.proposed_steps === 'string' ? gateEvidence.proposed_steps.trim() : '';
    if (gateSteps.length < SKILL_MIN_STEPS_CHARS && toArray(episode.skill_refs).length === 0) return false;

    // --- 従来の昇格シグナル ---
    const hint = episode.promotion_hint || 'auto';
    if (hint === 'skill' || hint === 'both') return true;
    if (toArray(episode.skill_refs).length > 0) return true;

    const evidence = episode.evidence || {};
    if (typeof evidence.proposed_steps === 'string' && evidence.proposed_steps.trim()) {
        return true;
    }

    return countKeywords(getEpisodeText(episode), SKILL_SIGNAL_KEYWORDS) > 0;
}

export function shouldCreateWikiCandidate(episode) {
    const hint = episode.promotion_hint || 'auto';
    if (hint === 'wiki' || hint === 'both') return true;
    if (toArray(episode.wiki_refs).length > 0) return true;

    const evidence = episode.evidence || {};
    if (typeof evidence.proposed_rule === 'string' && evidence.proposed_rule.trim()) {
        return true;
    }

    if (countKeywords(getEpisodeText(episode), WIKI_SIGNAL_KEYWORDS) > 0) {
        return true;
    }

    return shouldCreateSkillCandidate(episode);
}

export function deriveCanonicalWikiTargetRef(episode, docType = classifyWikiDocumentType(episode)) {
    const refs = toArray(episode.wiki_refs);
    if (refs.length > 0) return refs[0];
    return `${docType}/${slugify(episode.summary)}`;
}

export function deriveSkillTargetRef(episode) {
    const refs = toArray(episode.skill_refs);
    if (refs.length > 0) return refs[0];
    const slug = deriveSkillSlug(episode);
    if (!slug) {
        throw new Error(`Cannot derive ASCII skill name for episode: ${truncate(episode.summary, 60)}`);
    }
    return `.claude/skills/${slug}/SKILL.md`;
}

export function buildWikiCandidateContent(episode, targetRef, docType = classifyWikiDocumentType(episode)) {
    return [
        `# ${truncate(episode.summary, 60)}`,
        '',
        '## Summary',
        episode.summary,
        '',
        '## Type',
        `- ${docType}`,
        '',
        '## Rule',
        episode.evidence?.proposed_rule || 'Reusable learning promoted from review evidence.',
        '',
        '## Evidence',
        `- source_type: ${episode.source_type}`,
        `- outcome: ${episode.outcome}`,
        `- target_path: ${targetRef}`,
        '',
        '## Notes',
        flattenEvidence(episode.evidence) || 'No additional notes.'
    ].join('\n');
}

export function buildSkillCandidateContent(episode, wikiTargetRef, targetRef = deriveSkillTargetRef(episode)) {
    const rawName = targetRef.split('/').slice(-2, -1)[0] || slugify(episode.summary);
    // codex skill loader の 64 文字上限を満たすよう保守的に切る
    const skillName = rawName.slice(0, 64);
    const description = truncate(episode.summary, 100);
    const proposedSteps = episode.evidence?.proposed_steps;

    return [
        '---',
        `name: ${yamlQuote(skillName)}`,
        `description: ${yamlQuote(description)}`,
        '---',
        '',
        `# ${skillName}`,
        '',
        '## Trigger',
        `- Use when this pattern appears: ${episode.summary}`,
        '',
        '## Steps',
        ...(typeof proposedSteps === 'string' && proposedSteps.trim()
            ? proposedSteps.trim().split('\n').map((line) => line.trim() ? `- ${line.trim().replace(/^-+\s*/, '')}` : null).filter(Boolean)
            : [
                '- Confirm the linked wiki guidance first.',
                '- Execute the corrective workflow consistently.',
                '- Record any new deviations as fresh learning episodes.'
            ]),
        '',
        '## Guardrails',
        '- Do not override the linked wiki rule.',
        '- Escalate if the current case contradicts the wiki guidance.',
        '',
        '## Linked Wiki',
        `- ${wikiTargetRef}`,
        '',
        '## Source',
        `- Promoted from ${episode.source_type} / ${episode.outcome}`
    ].join('\n');
}

export class LearningService {
    constructor({ pool, wikiService = null, repoRoot = process.cwd(), ontologyRegistry = null, candidateRepository = null }) {
        this.pool = pool;
        this.wikiService = wikiService;
        this.repoRoot = repoRoot;
        this.ontologyRegistry = ontologyRegistry || new OntologyRegistry();
        this.candidateRepository = candidateRepository;
        this._schemaReady = false;
    }

    async ensureSchema() {
        if (this._schemaReady || !this.pool) return;
        const schemaSql = await readFile(LEARNING_SCHEMA_PATH, 'utf-8');
        await this.pool.query(schemaSql);
        this._schemaReady = true;
    }

    assertReady() {
        if (!this.pool) {
            throw new Error('LearningService requires PostgreSQL pool');
        }
    }

    normalizeEpisode(payload = {}) {
        const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
        if (!summary) {
            throw new Error('summary is required');
        }

        const sourceType = payload.source_type;
        if (!SOURCE_TYPES.has(sourceType)) {
            throw new Error('source_type must be review, explicit_learn, session_log, or codex_session_log');
        }

        const outcome = payload.outcome;
        if (!OUTCOMES.has(outcome)) {
            throw new Error('outcome must be success, failure, or partial');
        }

        const promotionHint = payload.promotion_hint || 'auto';
        if (!PROMOTION_HINTS.has(promotionHint)) {
            throw new Error('promotion_hint must be auto, wiki, skill, or both');
        }

        return {
            source_type: sourceType,
            project_id: typeof payload.project_id === 'string' ? payload.project_id : null,
            session_id: typeof payload.session_id === 'string' ? payload.session_id : null,
            task_id: typeof payload.task_id === 'string' ? payload.task_id : null,
            skill_refs: toArray(payload.skill_refs),
            wiki_refs: toArray(payload.wiki_refs),
            outcome,
            summary,
            evidence: payload.evidence && typeof payload.evidence === 'object' ? payload.evidence : {},
            promotion_hint: promotionHint,
            ingestion: normalizeIngestion(payload.ingestion)
        };
    }

    async recordEpisode(payload) {
        this.assertReady();
        await this.ensureSchema();
        const episode = this.normalizeEpisode(payload);
        if (episode.ingestion) {
            const existing = await this._findEpisodeByIngestion(episode.ingestion);
            if (existing) {
                await this._touchArtifactIngestion(episode.ingestion);
                return { ...existing, deduped: true, ingestion: episode.ingestion };
            }
        }

        const id = `lep_${ulid()}`;

        await this.pool.query(
            `INSERT INTO learning_episodes (
                id, source_type, project_id, session_id, task_id, skill_refs, wiki_refs,
                outcome, summary, evidence, promotion_hint, processed_at, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,NOW(),NOW())`,
            [
                id,
                episode.source_type,
                episode.project_id,
                episode.session_id,
                episode.task_id,
                JSON.stringify(episode.skill_refs),
                JSON.stringify(episode.wiki_refs),
                episode.outcome,
                episode.summary,
                JSON.stringify(episode.evidence),
                episode.promotion_hint
            ]
        );

        if (episode.ingestion) {
            await this.pool.query(
                `INSERT INTO learning_artifact_ingestions (
                    id, adapter_name, source_path, fingerprint, episode_id, ingested_at, last_seen_at
                ) VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`,
                [
                    `lig_${ulid()}`,
                    episode.ingestion.adapter_name,
                    episode.ingestion.source_path,
                    episode.ingestion.fingerprint,
                    id
                ]
            );
        }

        return { id, ...episode, deduped: false };
    }

    async createMemoryCandidate(payload = {}) {
        const candidate = normalizeMemoryCandidateInput(payload);
        if (!this.candidateRepository) throw new Error('LearningService requires candidateRepository');
        const stored = await this.candidateRepository.create({
            id: candidate.id,
            cognitive_type: normalizeOptionalString(payload.cognitive_type || payload.cognitiveType) || 'observation',
            owner_person_id: candidate.owner_person_id,
            actor_person_id: candidate.actor_person_id || candidate.owner_person_id,
            source_system: candidate.source_system,
            source_event_ids: candidate.source_event_ids,
            workspace: candidate.workspace,
            channel_id: candidate.channel_id,
            thread_ts: candidate.thread_ts,
            project_code: candidate.project_code,
            org_ids: toArray(payload.org_ids || payload.orgIds),
            project_ids: toArray(payload.project_ids || payload.projectIds),
            team_id: normalizeOptionalString(payload.team_id || payload.teamId),
            visibility: candidate.visibility === 'private'
                ? 'owner'
                : (['role', 'project'].includes(candidate.visibility) ? 'team' : candidate.visibility),
            sensitivity: ['hr', 'finance', 'contract'].includes(candidate.sensitivity) ? 'restricted' : candidate.sensitivity,
            role_min: candidate.role_min,
            agency_level: normalizeOptionalString(payload.agency_level || payload.agencyLevel) || 'synthesize',
            recommended_subject_type: candidate.subject_type,
            recommended_subject_id: candidate.subject_id,
            recommended_owner_person_id: candidate.recommended_owner_person_id,
            promotion_status: candidate.promotion_status,
            requires_approval: candidate.requires_approval,
            permission_snapshot: candidate.permission_snapshot,
            evidence_ids: candidate.evidence_ids,
            body: normalizeOptionalString(candidate.memory.body || candidate.memory.text) || JSON.stringify(candidate.memory),
            redaction_status: candidate.redaction_status,
            confidence: candidate.confidence,
            expires_at: candidate.expires_at,
            processing_stage: normalizeOptionalString(payload.processing_stage || payload.processingStage) || 'received',
            semantic_state: normalizeOptionalString(payload.semantic_state || payload.semanticState) || 'active',
            target_tier: normalizeOptionalString(payload.target_tier || payload.targetTier) || 'ledger'
        });

        return this._mapMemoryCandidateRow(stored);
    }

    async listMemoryCandidates({
        owner_person_id,
        ownerPersonId,
        visibility,
        scope,
        sensitivity,
        project_code,
        projectCode,
        status,
        promotion_status,
        subject_type,
        subjectType,
        include_promoted = false,
        includePromoted = false
    } = {}) {
        if (!this.candidateRepository) throw new Error('LearningService requires candidateRepository');
        const owner = normalizeOptionalString(owner_person_id || ownerPersonId);
        const candidateVisibility = normalizeOptionalString(visibility || scope);
        const candidateSensitivity = normalizeOptionalString(sensitivity);
        const project = normalizeOptionalString(project_code || projectCode);
        const candidateStatus = normalizeOptionalString(promotion_status || status);
        const subject = normalizeOptionalString(subject_type || subjectType);
        const shouldIncludePromoted = include_promoted === true || includePromoted === true;
        const rows = await this.candidateRepository.list({
            ...(owner ? { owner_person_id: owner } : {}),
            ...(candidateVisibility ? { visibility: candidateVisibility === 'private' ? 'owner' : candidateVisibility } : {}),
            ...(candidateSensitivity ? { sensitivity: candidateSensitivity } : {}),
            ...(project ? { project_code: project } : {}),
            ...(candidateStatus ? { promotion_status: candidateStatus } : {}),
            ...(subject ? { recommended_subject_type: subject } : {}),
            order_by: 'created_at',
            order_direction: 'asc'
        });
        return rows
            .filter((row) => shouldIncludePromoted || row.promotion_status !== 'promoted_to_graph')
            .map((row) => this._mapMemoryCandidateRow(row));
    }

    /**
     * 個人KG (owner-visible memory_candidates) を本文 (body) でキーワード検索する。
     * list API は旧 `memory` JSON カラムしか返さないため、judgment OS の本文を引く用途には
     * このメソッドを使う (SNS context service / generate-memory-preamble と同じ body 経路)。
     * owner / visibility=owner / 非redaction / 非rejected に限定して owner-only content を守る。
     */
    async searchPersonalKgCandidates({
        query,
        ownerPersonId = 'sato_keigo',
        cognitiveTypes = null,
        limit = 10
    } = {}) {
        const q = normalizeOptionalString(query);
        if (!q) throw new Error('query is required');
        if (!this.candidateRepository?.searchPersonalKg) {
            throw new Error('LearningService requires candidateRepository.searchPersonalKg');
        }
        const owner = normalizeOptionalString(ownerPersonId) || 'sato_keigo';
        const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 10, 1), 50);
        const tokens = personalKgSearchTokens(q);
        const types = Array.isArray(cognitiveTypes)
            ? cognitiveTypes.map((t) => normalizeOptionalString(t)).filter(Boolean)
            : [];
        const rows = await this.candidateRepository.searchPersonalKg({
            owner_person_id: owner,
            query: q,
            tokens,
            cognitive_types: types,
            limit: safeLimit
        });
        return rows.map((row) => ({
            id: row.id,
            cognitive_type: row.cognitive_type,
            body: row.body,
            confidence: row.confidence != null ? Number(row.confidence) : null,
            source_system: row.source_system,
            created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
        }));
    }

    async getMemoryCandidate(id) {
        const candidateId = normalizeOptionalString(id);
        if (!candidateId) throw new Error('candidate id is required');
        if (!this.candidateRepository) throw new Error('LearningService requires candidateRepository');
        const candidate = await this.candidateRepository.findById(candidateId);
        return candidate ? this._mapMemoryCandidateRow(candidate) : null;
    }

    async classifyMemoryCandidate(id, options = {}) {
        const candidate = await this.getMemoryCandidate(id);
        if (!candidate) return { success: false, notFound: true };
        if (candidate.promotion_status !== 'candidate') {
            throw new Error(`invalid memory candidate transition: ${candidate.promotion_status} -> gate_classified`);
        }

        const nextStatus = isLowRiskPrivateMemoryCandidate(candidate) ? 'auto_promoted' : 'pending_approval';
        return this._transitionMemoryCandidate(candidate, {
            nextStatus,
            actor_person_id: options.actor_person_id || options.actorPersonId,
            decision_owner_person_id: options.decision_owner_person_id || options.decisionOwnerPersonId || candidate.recommended_owner_person_id || candidate.owner_person_id,
            decision_reason: options.reason || options.decision_reason || 'promotion_gate_classified',
            requires_approval: nextStatus !== 'auto_promoted'
        });
    }

    async approveMemoryCandidate(id, options = {}) {
        const candidate = await this.getMemoryCandidate(id);
        if (!candidate) return { success: false, notFound: true };

        const decisionOwner = normalizeOptionalString(options.decision_owner_person_id || options.decisionOwnerPersonId);
        const expectedOwner = candidate.recommended_owner_person_id || candidate.owner_person_id;
        if (!decisionOwner || decisionOwner !== expectedOwner) {
            throw new Error('memory candidate approval requires the assigned owner');
        }

        return this._transitionMemoryCandidate(candidate, {
            expectedStatuses: ['pending_approval'],
            nextStatus: 'approved',
            actor_person_id: options.actor_person_id || options.actorPersonId,
            decision_owner_person_id: decisionOwner,
            decision_reason: options.reason || options.decision_reason || 'approved'
        });
    }

    async rejectMemoryCandidate(id, options = {}) {
        const candidate = await this.getMemoryCandidate(id);
        if (!candidate) return { success: false, notFound: true };
        return this._transitionMemoryCandidate(candidate, {
            expectedStatuses: ['candidate', 'gate_classified', 'pending_approval', 'auto_promoted', 'approved'],
            nextStatus: 'rejected',
            actor_person_id: options.actor_person_id || options.actorPersonId,
            decision_owner_person_id: options.decision_owner_person_id || options.decisionOwnerPersonId || candidate.recommended_owner_person_id || candidate.owner_person_id,
            decision_reason: options.reason || options.decision_reason || 'rejected'
        });
    }

    async expireMemoryCandidate(id, options = {}) {
        const candidate = await this.getMemoryCandidate(id);
        if (!candidate) return { success: false, notFound: true };
        return this._transitionMemoryCandidate(candidate, {
            expectedStatuses: ['candidate', 'gate_classified', 'pending_approval', 'auto_promoted', 'approved'],
            nextStatus: 'expired',
            actor_person_id: options.actor_person_id || options.actorPersonId,
            decision_owner_person_id: options.decision_owner_person_id || options.decisionOwnerPersonId || candidate.recommended_owner_person_id || candidate.owner_person_id,
            decision_reason: options.reason || options.decision_reason || 'expired'
        });
    }

    async markMemoryCandidatePromotedToGraph(id, options = {}) {
        const candidate = await this.getMemoryCandidate(id);
        if (!candidate) return { success: false, notFound: true };
        if (!MEMORY_APPROVED_FOR_GRAPH_STATUSES.has(candidate.promotion_status)) {
            throw new Error(`invalid memory candidate transition: ${candidate.promotion_status} -> promoted_to_graph`);
        }
        return this._transitionMemoryCandidate(candidate, {
            expectedStatuses: Array.from(MEMORY_APPROVED_FOR_GRAPH_STATUSES),
            nextStatus: 'promoted_to_graph',
            actor_person_id: options.actor_person_id || options.actorPersonId,
            decision_owner_person_id: options.decision_owner_person_id || options.decisionOwnerPersonId || candidate.recommended_owner_person_id || candidate.owner_person_id,
            decision_reason: options.reason || options.decision_reason || 'promoted_to_graph'
        });
    }

    async promoteMemoryCandidateToGraph(id, options = {}) {
        this.assertReady();
        await this.ensureSchema();

        const candidate = await this.getMemoryCandidate(id);
        if (!candidate) return { success: false, notFound: true };
        if (!MEMORY_APPROVED_FOR_GRAPH_STATUSES.has(candidate.promotion_status)) {
            throw new Error(`invalid memory candidate transition: ${candidate.promotion_status} -> promoted_to_graph`);
        }
        if (candidate.redaction_status === 'needs_redaction') {
            throw new Error('memory candidate requires redaction before graph promotion');
        }
        const actorPersonId = normalizeOptionalString(options.actor_person_id || options.actorPersonId);
        const access = options.access;
        if (!actorPersonId || !access) {
            throw Object.assign(new Error('authenticated promotion access is required'), { status: 403 });
        }
        const projectCode = normalizeOptionalString(candidate.project_code);
        const role = normalizeOptionalString(access.role)?.toLowerCase();
        const authorizedOwner = normalizeOptionalString(candidate.recommended_owner_person_id || candidate.owner_person_id);
        if (!authorizedOwner) {
            throw Object.assign(new Error('approved promotion authority is required'), { status: 403 });
        }
        if (projectCode && role !== 'ceo' && !toArray(access.projectCodes).includes(projectCode)) {
            throw Object.assign(new Error(`promotion project access denied: ${projectCode}`), { status: 403 });
        }
        if (!['gm', 'ceo'].includes(role) && actorPersonId !== authorizedOwner) {
            throw Object.assign(new Error('promotion owner authority denied'), { status: 403 });
        }

        const entityType = mapMemoryCandidateGraphType(candidate);
        const currentRelease = this.ontologyRegistry.hasCurrent()
            ? this.ontologyRegistry.resolve()
            : null;
        const guard = currentRelease
            ? { guard_status: 'active_current', ontology_version: currentRelease.kernel.version }
            : { guard_status: 'inactive_no_current', ontology_version: null };
        const vocabularyRelease = currentRelease || this.ontologyRegistry.resolve({ version: '1.0.0' });
        vocabularyRelease.kernel.getType(entityType);

        const graphEntityId = normalizeOptionalString(candidate.recommended_subject_id);
        if (!graphEntityId) {
            throw new Error('recommended_subject_id is required for Graph promotion');
        }
        const semanticMemory = candidate.memory
            && typeof candidate.memory === 'object'
            && !Array.isArray(candidate.memory)
            ? candidate.memory
            : {};
        const payload = {
            ...semanticMemory,
            memory_candidate_id: candidate.id,
            derived_from_candidate_id: candidate.id,
            subject_type: candidate.recommended_subject_type || candidate.subject_type,
            subject_id: graphEntityId,
            owner_person_id: candidate.owner_person_id,
            actor_person_id: candidate.actor_person_id,
            visibility: candidate.visibility,
            role_min: candidate.role_min,
            sensitivity: candidate.sensitivity,
            source_system: candidate.source_system,
            source_event_ids: candidate.source_event_ids,
            workspace: candidate.workspace,
            channel_id: candidate.channel_id,
            thread_ts: candidate.thread_ts,
            project_code: candidate.project_code,
            evidence_ids: candidate.evidence_ids,
            permission_snapshot: candidate.permission_snapshot,
            memory: candidate.memory,
            promoted_at: new Date().toISOString()
        };

        if (currentRelease) {
            const validation = currentRelease.kernel.validateEntity({
                id: graphEntityId,
                type: entityType,
                payload
            });
            if (!validation.valid) {
                throw new OntologyError(
                    'ONTOLOGY_VALIDATION_FAILED',
                    'Graph write violates the current ontology',
                    {
                        ontology_version: validation.ontology_version,
                        violations: validation.violations
                    }
                );
            }
        }

        const projectId = projectCode ? `prj_${projectCode.replace(/[^a-zA-Z0-9_]+/g, '_').toLowerCase()}` : null;
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            if (projectCode) {
                await client.query(
                `INSERT INTO projects (id, code, name)
                 VALUES ($1,$2,$3)
                 ON CONFLICT (code) DO NOTHING`,
                [projectId, projectCode, projectCode]
                );
            }

            await client.query(
            `INSERT INTO graph_entities (
                id, entity_type, project_id, payload, role_min, sensitivity, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
            ON CONFLICT (id)
            DO UPDATE SET
                entity_type = EXCLUDED.entity_type,
                project_id = EXCLUDED.project_id,
                payload = EXCLUDED.payload,
                role_min = EXCLUDED.role_min,
                sensitivity = EXCLUDED.sensitivity,
                updated_at = NOW()`,
            [
                graphEntityId,
                entityType,
                projectId,
                JSON.stringify(payload),
                candidate.role_min,
                candidate.sensitivity
            ]
            );

            const transition = await this._transitionMemoryCandidate(candidate, {
                expectedStatuses: Array.from(MEMORY_APPROVED_FOR_GRAPH_STATUSES),
                nextStatus: 'promoted_to_graph',
                actor_person_id: actorPersonId,
                decision_owner_person_id: authorizedOwner,
                decision_reason: options.reason || options.decision_reason || 'promoted_to_graph',
                promoted_graph_entity_id: graphEntityId
            }, client);
            await client.query('COMMIT');

            return {
                ...transition,
                ...guard,
                graph_entity: {
                    id: graphEntityId,
                    entity_type: entityType,
                    payload
                }
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async listPromotions({ status, pillar, apply_mode } = {}) {
        this.assertReady();
        await this.ensureSchema();

        const values = [];
        const whereClauses = [];

        if (status) {
            values.push(status);
            whereClauses.push(`status = $${values.length}`);
        }
        if (pillar) {
            values.push(pillar);
            whereClauses.push(`pillar = $${values.length}`);
        }
        if (apply_mode) {
            values.push(apply_mode);
            whereClauses.push(`apply_mode = $${values.length}`);
        }

        const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const { rows } = await this.pool.query(
            `SELECT id, pillar, target_ref, status, source_episode_ids, linked_wiki_candidate_id,
                    linked_candidate_ids, proposed_content, evaluation_summary, risk_level, doc_type,
                    target_project_id, canonical_summary, semantic_scope, merged_episode_count,
                    apply_mode, apply_error, materialized_ref, created_at, updated_at
             FROM promotion_candidates
             ${where}
             ORDER BY created_at ASC`,
            values
        );

        const candidates = rows.map((row) => this._mapCandidateRow(row));
        return this._enrichCandidates(candidates);
    }

    async getPromotion(candidateId) {
        this.assertReady();
        await this.ensureSchema();

        const row = await this._findCandidateRowById(candidateId);
        if (!row) return null;
        const [candidate] = await this._enrichCandidates([this._mapCandidateRow(row)]);
        return candidate;
    }

    async dedupeExistingPromotions() {
        this.assertReady();
        await this.ensureSchema();

        const candidates = await this.listPromotions({ status: 'evaluated', apply_mode: 'manual' });
        const groups = new Map();
        for (const candidate of candidates) {
            const semanticScope = candidate.semantic_scope
                || deriveSemanticScope({
                    pillar: candidate.pillar,
                    docType: candidate.doc_type,
                    projectId: candidate.target_project_id
                });
            const canonicalSummary = candidate.canonical_summary || deriveExistingCandidateSemanticText(candidate);
            if (!candidate.semantic_scope || !candidate.canonical_summary || Number(candidate.merged_episode_count || 1) !== (candidate.source_episode_ids || []).length) {
                await this._updateCandidate(candidate.id, {
                    semantic_scope: semanticScope,
                    canonical_summary: canonicalSummary,
                    merged_episode_count: Math.max(1, (candidate.source_episode_ids || []).length)
                });
            }
            const entry = {
                ...candidate,
                semantic_scope: semanticScope,
                canonical_summary: canonicalSummary,
                merged_episode_count: Math.max(1, (candidate.source_episode_ids || []).length)
            };
            if (!groups.has(semanticScope)) groups.set(semanticScope, []);
            groups.get(semanticScope).push(entry);
        }

        let merged = 0;
        for (const entries of groups.values()) {
            entries.sort((left, right) => new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime());
            for (let index = 0; index < entries.length; index += 1) {
                const base = entries[index];
                if (!base || base.status === 'merged') continue;
                for (let compareIndex = index + 1; compareIndex < entries.length; compareIndex += 1) {
                    const candidate = entries[compareIndex];
                    if (!candidate || candidate.status === 'merged') continue;
                    const similarity = isSemanticMatch(base.canonical_summary, candidate.canonical_summary);
                    if (!similarity.match) continue;

                    const mergedEpisodeIds = uniqueStrings([
                        ...(base.source_episode_ids || []),
                        ...(candidate.source_episode_ids || [])
                    ]);
                    const mergedCount = mergedEpisodeIds.length;
                    const evaluationSummary = {
                        ...(base.evaluation_summary || {}),
                        canonical_summary: base.canonical_summary,
                        dedupe_reason: similarity.reason,
                        dedupe_score: similarity.score,
                        merged_from_candidate_id: candidate.id
                    };

                    await this._updateCandidate(base.id, {
                        source_episode_ids: mergedEpisodeIds,
                        merged_episode_count: mergedCount,
                        risk_level: maxRiskLevel(base.risk_level, candidate.risk_level),
                        apply_mode: chooseMoreConservativeApplyMode(base.apply_mode, candidate.apply_mode),
                        evaluation_summary: evaluationSummary,
                        canonical_summary: base.canonical_summary,
                        semantic_scope: base.semantic_scope
                    });
                    await this._updateCandidate(candidate.id, {
                        status: 'merged',
                        apply_error: `merged_into:${base.id}`,
                        materialized_ref: base.id,
                        canonical_summary: candidate.canonical_summary,
                        semantic_scope: candidate.semantic_scope,
                        merged_episode_count: candidate.merged_episode_count || candidate.source_episode_ids?.length || 1
                    });

                    base.source_episode_ids = mergedEpisodeIds;
                    base.merged_episode_count = mergedCount;
                    base.risk_level = maxRiskLevel(base.risk_level, candidate.risk_level);
                    base.apply_mode = chooseMoreConservativeApplyMode(base.apply_mode, candidate.apply_mode);
                    candidate.status = 'merged';
                    merged += 1;
                }
            }
        }

        return { merged, scanned: candidates.length };
    }

    async _findCandidateRowById(candidateId) {
        const { rows } = await this.pool.query(
            `SELECT id, pillar, target_ref, status, source_episode_ids, linked_wiki_candidate_id,
                    linked_candidate_ids, proposed_content, evaluation_summary, risk_level, doc_type,
                    target_project_id, canonical_summary, semantic_scope, merged_episode_count,
                    apply_mode, apply_error, materialized_ref, created_at, updated_at
             FROM promotion_candidates
             WHERE id = $1
             LIMIT 1`,
            [candidateId]
        );
        return rows[0] || null;
    }

    async applyPromotion(candidateId) {
        this.assertReady();
        await this.ensureSchema();

        const row = await this._findCandidateRowById(candidateId);
        if (!row) {
            return { success: false, notFound: true };
        }
        const candidate = this._mapCandidateRow(row);

        const [episode] = await this._loadEpisodesByIds(candidate.source_episode_ids);
        if (!episode) {
            throw new Error(`Source episode not found for candidate ${candidateId}`);
        }

        if (candidate.pillar === 'document') {
            const preserved = await this._applyWikiCandidate(candidate);
            return { success: false, retired: true, candidate: preserved };
        }

        if (candidate.pillar === 'skill') {
            const applied = await this._applySkillCandidate(candidate);
            return { success: true, candidate: applied };
        }

        throw new Error(`Unsupported candidate pillar: ${candidate.pillar}`);
    }

    async markPromotionApplied(candidateId) {
        this.assertReady();
        await this.ensureSchema();
        const { rowCount } = await this.pool.query(
            `UPDATE promotion_candidates
             SET status = 'applied', updated_at = NOW()
             WHERE id = $1`,
            [candidateId]
        );
        return { success: rowCount > 0 };
    }

    async markPromotionRejected(candidateId, reason = null) {
        this.assertReady();
        await this.ensureSchema();
        const normalizedReason = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
        const { rowCount } = await this.pool.query(
            `UPDATE promotion_candidates
             SET status = 'rejected', apply_error = $2, updated_at = NOW()
             WHERE id = $1`,
            [candidateId, normalizedReason]
        );
        return { success: rowCount > 0 };
    }

    async _loadPendingEpisodes() {
        const { rows } = await this.pool.query(
            `SELECT id, source_type, project_id, session_id, task_id, skill_refs, wiki_refs,
                    outcome, summary, evidence, promotion_hint
             FROM learning_episodes
             WHERE processed_at IS NULL
             ORDER BY created_at ASC`
        );
        return rows.map((row) => ({
            ...row,
            skill_refs: toArray(row.skill_refs),
            wiki_refs: toArray(row.wiki_refs),
            evidence: row.evidence || {},
            promotion_hint: row.promotion_hint || 'auto'
        }));
    }

    async _findCandidateByTarget(pillar, targetRef) {
        const { rows } = await this.pool.query(
            `SELECT id, pillar, target_ref, status, source_episode_ids, linked_wiki_candidate_id,
                    linked_candidate_ids, proposed_content, evaluation_summary, risk_level, doc_type,
                    target_project_id, canonical_summary, semantic_scope, merged_episode_count,
                    apply_mode, apply_error, materialized_ref
             FROM promotion_candidates
             WHERE pillar = $1 AND target_ref = $2 AND status NOT IN ('rejected', 'merged')
             ORDER BY created_at DESC
             LIMIT 1`,
            [pillar, targetRef]
        );
        return rows[0] ? this._mapCandidateRow(rows[0]) : null;
    }

    async _findSemanticDuplicateCandidate({ pillar, docType, projectId, canonicalSummary }) {
        if (!canonicalSummary) return null;

        const semanticScope = deriveSemanticScope({ pillar, docType, projectId });
        const { rows } = await this.pool.query(
            `SELECT id, pillar, target_ref, status, source_episode_ids, linked_wiki_candidate_id,
                    linked_candidate_ids, proposed_content, evaluation_summary, risk_level, doc_type,
                    target_project_id, canonical_summary, semantic_scope, merged_episode_count,
                    apply_mode, apply_error, materialized_ref, created_at, updated_at
             FROM promotion_candidates
             WHERE pillar = $1
               AND (
                    semantic_scope = $2
                    OR (
                        semantic_scope IS NULL
                        AND COALESCE(doc_type, '') = $3
                        AND COALESCE(target_project_id, '') = $4
                    )
               )
               AND status NOT IN ('rejected', 'merged')
             ORDER BY updated_at DESC
             LIMIT 50`,
            [pillar, semanticScope, docType || '', projectId || '']
        );

        let bestMatch = null;
        for (const row of rows) {
            const candidate = this._mapCandidateRow(row);
            const result = isSemanticMatch(canonicalSummary, candidate.canonical_summary || '');
            if (!result.match) continue;
            if (!bestMatch || result.score > bestMatch.score) {
                bestMatch = { candidate, ...result };
            }
        }

        return bestMatch;
    }

    _buildSemanticMetadata({ episode, pillar, docType }) {
        const canonicalSummary = normalizeSemanticText(deriveCandidateSemanticText(episode, pillar));
        return {
            canonical_summary: canonicalSummary,
            semantic_scope: deriveSemanticScope({
                pillar,
                docType,
                projectId: episode.project_id
            })
        };
    }

    async _mergeIntoExistingCandidate(existingCandidate, episode, dedupeMeta = {}, requestedApplyMode = 'manual') {
        const sourceEpisodeIds = uniqueStrings([
            ...(existingCandidate.source_episode_ids || []),
            episode.id
        ]);
        const mergedEpisodeCount = sourceEpisodeIds.length;
        const evaluationSummary = {
            ...(existingCandidate.evaluation_summary || {}),
            canonical_summary: dedupeMeta.canonical_summary || existingCandidate.canonical_summary || null,
            dedupe_reason: dedupeMeta.reason || 'semantic_duplicate',
            dedupe_score: dedupeMeta.score ?? null,
            merged_from_episode_id: episode.id
        };
        const fields = {
            source_episode_ids: sourceEpisodeIds,
            merged_episode_count: mergedEpisodeCount,
            risk_level: maxRiskLevel(existingCandidate.risk_level, this._buildRiskLevel(episode, existingCandidate.pillar)),
            apply_mode: chooseMoreConservativeApplyMode(existingCandidate.apply_mode, requestedApplyMode),
            evaluation_summary: evaluationSummary,
            canonical_summary: dedupeMeta.canonical_summary || existingCandidate.canonical_summary || null
        };
        await this._updateCandidate(existingCandidate.id, fields);
        return {
            ...existingCandidate,
            ...fields,
            linked_candidate_ids: existingCandidate.linked_candidate_ids || []
        };
    }

    async _findEpisodeByIngestion(ingestion) {
        const { rows } = await this.pool.query(
            `SELECT le.id, le.source_type, le.project_id, le.session_id, le.task_id, le.skill_refs,
                    le.wiki_refs, le.outcome, le.summary, le.evidence, le.promotion_hint
             FROM learning_artifact_ingestions li
             JOIN learning_episodes le ON le.id = li.episode_id
             WHERE li.adapter_name = $1
               AND li.source_path = $2
               AND li.fingerprint = $3
             LIMIT 1`,
            [
                ingestion.adapter_name,
                ingestion.source_path,
                ingestion.fingerprint
            ]
        );
        if (!rows[0]) return null;
        const row = rows[0];
        return {
            ...row,
            skill_refs: toArray(row.skill_refs),
            wiki_refs: toArray(row.wiki_refs),
            evidence: row.evidence || {},
            promotion_hint: row.promotion_hint || 'auto'
        };
    }

    async _touchArtifactIngestion(ingestion) {
        await this.pool.query(
            `UPDATE learning_artifact_ingestions
             SET last_seen_at = NOW()
             WHERE adapter_name = $1
               AND source_path = $2
               AND fingerprint = $3`,
            [
                ingestion.adapter_name,
                ingestion.source_path,
                ingestion.fingerprint
            ]
        );
    }

    _mapCandidateRow(row) {
        return {
            ...row,
            pillar: row.pillar === 'wiki' ? 'document' : row.pillar,
            source_episode_ids: toArray(row.source_episode_ids),
            linked_candidate_ids: toArray(row.linked_candidate_ids),
            evaluation_summary: row.evaluation_summary || {},
            merged_episode_count: Number(row.merged_episode_count || 1)
        };
    }

    _mapMemoryCandidateRow(row) {
        const confidence = Number(row.confidence);
        const memory = row.memory && typeof row.memory === 'object' && !Array.isArray(row.memory)
            ? row.memory
            : { body: row.body };
        return {
            ...row,
            candidate_id: row.id,
            subject_type: row.recommended_subject_type || row.subject_type,
            subject_id: row.recommended_subject_id || row.subject_id,
            source_event_ids: toArray(row.source_event_ids),
            permission_snapshot: row.permission_snapshot || {},
            evidence_ids: toArray(row.evidence_ids),
            confidence: Number.isFinite(confidence) ? confidence : null,
            memory,
            graph_truth: row.promotion_status === 'promoted_to_graph'
        };
    }

    async _transitionMemoryCandidate(candidate, {
        expectedStatuses = null,
        nextStatus,
        actor_person_id = null,
        decision_owner_person_id = null,
        decision_reason = '',
        requires_approval = undefined,
        promoted_graph_entity_id = null
    }, transactionClient = null) {
        if (!MEMORY_PROMOTION_STATUSES.has(nextStatus)) {
            throw new Error('next promotion status is invalid');
        }
        if (expectedStatuses && !expectedStatuses.includes(candidate.promotion_status)) {
            throw new Error(`invalid memory candidate transition: ${candidate.promotion_status} -> ${nextStatus}`);
        }

        const nextRequiresApproval = typeof requires_approval === 'boolean'
            ? requires_approval
            : candidate.requires_approval;
        if (!this.candidateRepository?.transitionWithAudit) {
            throw new Error('LearningService requires candidateRepository.transitionWithAudit');
        }
        const result = await this.candidateRepository.transitionWithAudit(candidate.id, nextStatus, {
            actor_person_id: normalizeOptionalString(actor_person_id) || candidate.actor_person_id || candidate.owner_person_id,
            decision_owner_person_id: normalizeOptionalString(decision_owner_person_id),
            decision_reason: normalizeOptionalString(decision_reason) || '',
            evidence_ids: candidate.evidence_ids || []
        }, {
            client: transactionClient,
            requires_approval: nextRequiresApproval,
            promoted_graph_entity_id
        });
        const transitionedCandidate = this._mapMemoryCandidateRow(result.candidate);

        return {
            success: true,
            candidate: {
                ...transitionedCandidate,
                graph_truth: nextStatus === 'promoted_to_graph'
            },
            audit: result.audit
        };
    }

    async _loadEpisodesByIds(ids = []) {
        const uniqueIds = uniqueStrings(ids);
        if (uniqueIds.length === 0) return [];

        const { rows } = await this.pool.query(
            `SELECT id, source_type, project_id, session_id, task_id, skill_refs, wiki_refs,
                    outcome, summary, evidence, promotion_hint
             FROM learning_episodes
             WHERE id = ANY($1::text[])`,
            [uniqueIds]
        );

        return rows.map((row) => ({
            ...row,
            skill_refs: toArray(row.skill_refs),
            wiki_refs: toArray(row.wiki_refs),
            evidence: row.evidence || {},
            promotion_hint: row.promotion_hint || 'auto'
        }));
    }

    async _enrichCandidates(candidates = []) {
        if (candidates.length === 0) return [];
        const episodeIds = uniqueStrings(candidates.flatMap((candidate) => candidate.source_episode_ids));
        const episodes = await this._loadEpisodesByIds(episodeIds);
        const episodeMap = new Map(episodes.map((episode) => [episode.id, episode]));

        return candidates.map((candidate) => {
            const sourceEpisode = candidate.source_episode_ids
                .map((id) => episodeMap.get(id))
                .find(Boolean) || null;

            return {
                ...candidate,
                title: deriveCandidateTitle(candidate),
                source_preview: deriveSourcePreview(sourceEpisode),
                source_type: sourceEpisode?.source_type || null,
                outcome: sourceEpisode?.outcome || null,
                merged_episode_count: Number(candidate.merged_episode_count || candidate.source_episode_ids?.length || 1)
            };
        });
    }

    _buildEvaluationSummary({ episode, pillar, linkedWikiCandidateId = null, docType = null }) {
        return {
            wiki_first_passed: pillar === 'document' || pillar === 'wiki' || Boolean(linkedWikiCandidateId) || toArray(episode.wiki_refs).length > 0,
            contradiction_passed: !hasExplicitConflict(episode.evidence),
            explicit_conflict: hasExplicitConflict(episode.evidence),
            source_type: episode.source_type,
            doc_type: docType
        };
    }

    _buildRiskLevel(episode, pillar) {
        if (pillar === 'skill' && episode.outcome === 'failure') return 'high';
        if ((pillar === 'document' || pillar === 'wiki') && episode.outcome === 'failure') return 'medium';
        return 'low';
    }

    _shouldAutoApply({ pillar, episode, linkedWikiCandidateId = null }) {
        if (hasExplicitConflict(episode.evidence)) return false;
        if (pillar === 'skill') {
            return Boolean(linkedWikiCandidateId || toArray(episode.wiki_refs).length > 0);
        }
        return true;
    }

    _resolveCandidateApplyMode({ requestedApplyMode = 'manual', pillar, episode, linkedWikiCandidateId = null }) {
        if (normalizeApplyMode(requestedApplyMode) === 'manual') {
            return 'manual';
        }
        return this._shouldAutoApply({ pillar, episode, linkedWikiCandidateId }) ? 'auto' : 'manual';
    }

    async _insertCandidate(candidate) {
        if (!['document', 'skill'].includes(candidate.pillar)) {
            throw new Error(`promotion candidate pillar is invalid: ${candidate.pillar || 'missing'}`);
        }
        await this.pool.query(
            `INSERT INTO promotion_candidates (
                id, pillar, target_ref, status, canonical_summary, semantic_scope, merged_episode_count,
                source_episode_ids, linked_wiki_candidate_id, linked_candidate_ids, proposed_content,
                evaluation_summary, risk_level, doc_type, target_project_id, apply_mode, apply_error,
                materialized_ref, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())`,
            [
                candidate.id,
                candidate.pillar,
                candidate.target_ref,
                candidate.status,
                candidate.canonical_summary,
                candidate.semantic_scope,
                candidate.merged_episode_count || 1,
                JSON.stringify(candidate.source_episode_ids),
                candidate.linked_wiki_candidate_id,
                JSON.stringify(candidate.linked_candidate_ids || []),
                candidate.proposed_content,
                JSON.stringify(candidate.evaluation_summary),
                candidate.risk_level,
                candidate.doc_type,
                candidate.target_project_id,
                candidate.apply_mode,
                candidate.apply_error,
                candidate.materialized_ref
            ]
        );
    }

    async _updateCandidate(candidateId, fields = {}) {
        const updates = [];
        const values = [];

        Object.entries(fields).forEach(([key, value]) => {
            values.push(
                ['source_episode_ids', 'linked_candidate_ids', 'evaluation_summary'].includes(key)
                    || ['merged_episode_count'].includes(key)
                    ? (['merged_episode_count'].includes(key) ? value : JSON.stringify(value))
                    : value
            );
            updates.push(`${key} = $${values.length}`);
        });

        if (updates.length === 0) return;
        values.push(candidateId);
        await this.pool.query(
            `UPDATE promotion_candidates
             SET ${updates.join(', ')}, updated_at = NOW()
             WHERE id = $${values.length}`,
            values
        );
    }

    async _markEpisodeProcessed(episodeId) {
        await this.pool.query(
            `UPDATE learning_episodes
             SET processed_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [episodeId]
        );
    }

    async _createWikiCandidate(episode, requestedApplyMode = 'manual') {
        const docType = classifyWikiDocumentType(episode);
        const targetRef = deriveCanonicalWikiTargetRef(episode, docType);
        const existing = await this._findCandidateByTarget('document', targetRef);
        if (existing) {
            return existing;
        }
        const semanticMeta = this._buildSemanticMetadata({ episode, pillar: 'document', docType });
        const semanticDuplicate = await this._findSemanticDuplicateCandidate({
            pillar: 'document',
            docType,
            projectId: episode.project_id,
            canonicalSummary: semanticMeta.canonical_summary
        });
        if (semanticDuplicate) {
            return this._mergeIntoExistingCandidate(semanticDuplicate.candidate, episode, {
                ...semanticMeta,
                reason: semanticDuplicate.reason,
                score: semanticDuplicate.score
            }, requestedApplyMode);
        }

        const candidate = {
            id: `prm_${ulid()}`,
            pillar: 'document',
            target_ref: targetRef,
            status: 'evaluated',
            canonical_summary: semanticMeta.canonical_summary,
            semantic_scope: semanticMeta.semantic_scope,
            merged_episode_count: 1,
            source_episode_ids: [episode.id],
            linked_wiki_candidate_id: null,
            linked_candidate_ids: [],
            proposed_content: buildWikiCandidateContent(episode, targetRef, docType),
            evaluation_summary: this._buildEvaluationSummary({ episode, pillar: 'document', docType }),
            risk_level: this._buildRiskLevel(episode, 'document'),
            doc_type: docType,
            target_project_id: episode.project_id,
            apply_mode: this._resolveCandidateApplyMode({
                requestedApplyMode,
                pillar: 'document',
                episode
            }),
            apply_error: null,
            materialized_ref: null
        };
        await this._insertCandidate(candidate);
        return candidate;
    }

    async _createSkillCandidate(episode, linkedWikiCandidate = null, requestedApplyMode = 'manual') {
        const targetRef = deriveSkillTargetRef(episode);
        const existing = await this._findCandidateByTarget('skill', targetRef);
        if (existing) {
            return existing;
        }
        const semanticMeta = this._buildSemanticMetadata({ episode, pillar: 'skill', docType: 'procedure' });
        const semanticDuplicate = await this._findSemanticDuplicateCandidate({
            pillar: 'skill',
            docType: 'procedure',
            projectId: episode.project_id,
            canonicalSummary: semanticMeta.canonical_summary
        });
        if (semanticDuplicate) {
            return this._mergeIntoExistingCandidate(semanticDuplicate.candidate, episode, {
                ...semanticMeta,
                reason: semanticDuplicate.reason,
                score: semanticDuplicate.score
            }, requestedApplyMode);
        }

        const wikiTargetRef = toArray(episode.wiki_refs)[0]
            || linkedWikiCandidate?.target_ref
            || deriveCanonicalWikiTargetRef(episode);

        const candidate = {
            id: `prm_${ulid()}`,
            pillar: 'skill',
            target_ref: targetRef,
            status: 'evaluated',
            canonical_summary: semanticMeta.canonical_summary,
            semantic_scope: semanticMeta.semantic_scope,
            merged_episode_count: 1,
            source_episode_ids: [episode.id],
            linked_wiki_candidate_id: linkedWikiCandidate?.id || null,
            linked_candidate_ids: linkedWikiCandidate?.id ? [linkedWikiCandidate.id] : [],
            proposed_content: buildSkillCandidateContent(episode, wikiTargetRef, targetRef),
            evaluation_summary: this._buildEvaluationSummary({
                episode,
                pillar: 'skill',
                linkedWikiCandidateId: linkedWikiCandidate?.id || null,
                docType: 'procedure'
            }),
            risk_level: this._buildRiskLevel(episode, 'skill'),
            doc_type: 'procedure',
            target_project_id: episode.project_id,
            apply_mode: this._resolveCandidateApplyMode({
                requestedApplyMode,
                pillar: 'skill',
                episode,
                linkedWikiCandidateId: linkedWikiCandidate?.id || null
            }),
            apply_error: null,
            materialized_ref: null
        };
        await this._insertCandidate(candidate);
        return candidate;
    }

    async _applyWikiCandidate(candidate) {
        const applyError = 'Wiki storage is retired; classify this candidate into Graph, an owning Git repository, Drive, or workspace home';
        await this._updateCandidate(candidate.id, {
            apply_mode: 'manual',
            apply_error: applyError
        });
        return {
            ...candidate,
            apply_mode: 'manual',
            apply_error: applyError
        };
    }

    async _applySkillCandidate(candidate) {
        if (!this.repoRoot) {
            await this._updateCandidate(candidate.id, {
                apply_mode: 'manual',
                apply_error: 'repoRoot not configured'
            });
            return { ...candidate, apply_mode: 'manual', apply_error: 'repoRoot not configured' };
        }

        const targetPath = path.join(this.repoRoot, candidate.target_ref);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, candidate.proposed_content, 'utf-8');

        await this._updateCandidate(candidate.id, {
            status: 'applied',
            materialized_ref: candidate.target_ref,
            apply_error: null
        });

        return {
            ...candidate,
            status: 'applied',
            materialized_ref: candidate.target_ref,
            apply_error: null
        };
    }

    async proposePromotions({ applyMode = 'manual' } = {}) {
        this.assertReady();
        await this.ensureSchema();

        const episodes = await this._loadPendingEpisodes();
        const created = [];
        const resolvedApplyMode = normalizeApplyMode(applyMode);

        for (const episode of episodes) {
            try {
                const wikiNeeded = shouldCreateWikiCandidate(episode);
                const skillNeeded = shouldCreateSkillCandidate(episode);
                let wikiCandidate = null;

                if (wikiNeeded) {
                    wikiCandidate = await this._createWikiCandidate(episode, resolvedApplyMode);
                    created.push(
                        wikiCandidate.apply_mode === 'auto'
                            ? await this._applyWikiCandidate(wikiCandidate)
                            : wikiCandidate
                    );
                }

                if (skillNeeded) {
                    const skillCandidate = await this._createSkillCandidate(episode, wikiCandidate, resolvedApplyMode);
                    created.push(
                        skillCandidate.apply_mode === 'auto'
                            ? await this._applySkillCandidate(skillCandidate)
                            : skillCandidate
                    );
                }

                await this._markEpisodeProcessed(episode.id);
            } catch (error) {
                logger.error('Failed to propose promotion candidate', { error, episodeId: episode.id });
            }
        }

        return created;
    }

    async recordSkillUsage(payload = {}) {
        this.assertReady();
        await this.ensureSchema();

        const skillName = typeof payload.skill_name === 'string' ? payload.skill_name.trim() : '';
        if (!skillName) {
            throw new Error('skill_name is required');
        }

        const outcome = typeof payload.outcome === 'string' ? payload.outcome : 'completed';
        if (!['started', 'completed', 'errored'].includes(outcome)) {
            throw new Error('outcome must be started, completed, or errored');
        }

        const durationMsRaw = payload.duration_ms;
        const durationMs = Number.isFinite(durationMsRaw) && durationMsRaw >= 0
            ? Math.floor(durationMsRaw)
            : null;

        const id = `sul_${ulid()}`;
        await this.pool.query(
            `INSERT INTO skill_usage_logs (
                id, skill_name, session_id, turn_id, project_id, outcome, duration_ms, created_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
            [
                id,
                skillName,
                typeof payload.session_id === 'string' ? payload.session_id : null,
                typeof payload.turn_id === 'string' ? payload.turn_id : null,
                typeof payload.project_id === 'string' ? payload.project_id : null,
                outcome,
                durationMs
            ]
        );

        return { id, skill_name: skillName, outcome, duration_ms: durationMs };
    }

    async listStaleSkills({ days = 90 } = {}) {
        this.assertReady();
        await this.ensureSchema();

        const safeDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 90;
        const result = await this.pool.query(
            `SELECT skill_name, MAX(created_at) AS last_used_at, COUNT(*) AS uses
             FROM skill_usage_logs
             GROUP BY skill_name
             HAVING MAX(created_at) < NOW() - ($1::int * INTERVAL '1 day')
             ORDER BY last_used_at ASC`,
            [safeDays]
        );

        return result.rows.map((row) => ({
            skill_name: row.skill_name,
            last_used_at: row.last_used_at,
            uses: Number(row.uses) || 0,
            stale_threshold_days: safeDays
        }));
    }
}
