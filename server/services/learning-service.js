import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ulid } from 'ulid';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEARNING_SCHEMA_PATH = path.join(__dirname, '..', 'sql', 'learning-schema.sql');

const SOURCE_TYPES = new Set(['review', 'explicit_learn']);
const OUTCOMES = new Set(['success', 'failure', 'partial']);
const PROMOTION_HINTS = new Set(['auto', 'wiki', 'skill', 'both']);
const SYSTEM_WIKI_ACCESS = {
    role: 'ceo',
    clearance: ['internal', 'restricted', 'finance', 'hr', 'contract'],
    projectCodes: []
};

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

function slugify(value) {
    return (value || 'untitled')
        .toLowerCase()
        .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'untitled';
}

function truncate(value, max = 120) {
    if (!value) return '';
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
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
    const projectSegment = slugify(episode.project_id || 'brainbase');
    return `.claude/skills/${projectSegment}-${slugify(episode.summary)}/SKILL.md`;
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
    const skillName = targetRef.split('/').slice(-2, -1)[0] || slugify(episode.summary);
    const description = truncate(episode.summary, 100);
    const proposedSteps = episode.evidence?.proposed_steps;

    return [
        '---',
        `name: ${skillName}`,
        `description: ${description}`,
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
    constructor({ pool, wikiService = null, repoRoot = process.cwd() }) {
        this.pool = pool;
        this.wikiService = wikiService;
        this.repoRoot = repoRoot;
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
            throw new Error('source_type must be review or explicit_learn');
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
            promotion_hint: promotionHint
        };
    }

    async recordEpisode(payload) {
        this.assertReady();
        await this.ensureSchema();
        const episode = this.normalizeEpisode(payload);
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

        return { id, ...episode };
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
                    target_project_id, apply_mode, apply_error, materialized_ref, created_at, updated_at
             FROM promotion_candidates
             ${where}
             ORDER BY created_at ASC`,
            values
        );

        return rows.map((row) => ({
            ...row,
            source_episode_ids: toArray(row.source_episode_ids),
            linked_candidate_ids: toArray(row.linked_candidate_ids),
            evaluation_summary: row.evaluation_summary || {}
        }));
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
                    target_project_id, apply_mode, apply_error, materialized_ref
             FROM promotion_candidates
             WHERE pillar = $1 AND target_ref = $2 AND status != 'rejected'
             ORDER BY created_at DESC
             LIMIT 1`,
            [pillar, targetRef]
        );
        return rows[0] || null;
    }

    _buildEvaluationSummary({ episode, pillar, linkedWikiCandidateId = null, docType = null }) {
        return {
            wiki_first_passed: pillar === 'wiki' || Boolean(linkedWikiCandidateId) || toArray(episode.wiki_refs).length > 0,
            contradiction_passed: !hasExplicitConflict(episode.evidence),
            explicit_conflict: hasExplicitConflict(episode.evidence),
            source_type: episode.source_type,
            doc_type: docType
        };
    }

    _buildRiskLevel(episode, pillar) {
        if (pillar === 'skill' && episode.outcome === 'failure') return 'high';
        if (pillar === 'wiki' && episode.outcome === 'failure') return 'medium';
        return 'low';
    }

    _shouldAutoApply({ pillar, episode, linkedWikiCandidateId = null }) {
        if (hasExplicitConflict(episode.evidence)) return false;
        if (pillar === 'skill') {
            return Boolean(linkedWikiCandidateId || toArray(episode.wiki_refs).length > 0);
        }
        return true;
    }

    async _insertCandidate(candidate) {
        await this.pool.query(
            `INSERT INTO promotion_candidates (
                id, pillar, target_ref, status, source_episode_ids, linked_wiki_candidate_id,
                linked_candidate_ids, proposed_content, evaluation_summary, risk_level, doc_type,
                target_project_id, apply_mode, apply_error, materialized_ref, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())`,
            [
                candidate.id,
                candidate.pillar,
                candidate.target_ref,
                candidate.status,
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
                    ? JSON.stringify(value)
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

    async _createWikiCandidate(episode) {
        const docType = classifyWikiDocumentType(episode);
        const targetRef = deriveCanonicalWikiTargetRef(episode, docType);
        const existing = await this._findCandidateByTarget('wiki', targetRef);
        if (existing) {
            return existing;
        }

        const candidate = {
            id: `prm_${ulid()}`,
            pillar: 'wiki',
            target_ref: targetRef,
            status: 'evaluated',
            source_episode_ids: [episode.id],
            linked_wiki_candidate_id: null,
            linked_candidate_ids: [],
            proposed_content: buildWikiCandidateContent(episode, targetRef, docType),
            evaluation_summary: this._buildEvaluationSummary({ episode, pillar: 'wiki', docType }),
            risk_level: this._buildRiskLevel(episode, 'wiki'),
            doc_type: docType,
            target_project_id: episode.project_id,
            apply_mode: this._shouldAutoApply({ pillar: 'wiki', episode }) ? 'auto' : 'manual',
            apply_error: null,
            materialized_ref: null
        };
        await this._insertCandidate(candidate);
        return candidate;
    }

    async _createSkillCandidate(episode, linkedWikiCandidate = null) {
        const targetRef = deriveSkillTargetRef(episode);
        const existing = await this._findCandidateByTarget('skill', targetRef);
        if (existing) {
            return existing;
        }

        const wikiTargetRef = toArray(episode.wiki_refs)[0]
            || linkedWikiCandidate?.target_ref
            || deriveCanonicalWikiTargetRef(episode);

        const candidate = {
            id: `prm_${ulid()}`,
            pillar: 'skill',
            target_ref: targetRef,
            status: 'evaluated',
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
            apply_mode: this._shouldAutoApply({
                pillar: 'skill',
                episode,
                linkedWikiCandidateId: linkedWikiCandidate?.id || null
            }) ? 'auto' : 'manual',
            apply_error: null,
            materialized_ref: null
        };
        await this._insertCandidate(candidate);
        return candidate;
    }

    async _applyWikiCandidate(candidate, episode) {
        if (!this.wikiService) {
            await this._updateCandidate(candidate.id, {
                apply_mode: 'manual',
                apply_error: 'wikiService not configured'
            });
            return { ...candidate, apply_mode: 'manual', apply_error: 'wikiService not configured' };
        }

        const access = {
            ...SYSTEM_WIKI_ACCESS,
            projectCodes: episode.project_id ? [episode.project_id] : []
        };

        await this.wikiService.savePage(access, candidate.target_ref, candidate.proposed_content);
        if (episode.project_id) {
            await this.wikiService.setPageAccess(candidate.target_ref, { projectId: episode.project_id });
        }

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

    async proposePromotions() {
        this.assertReady();
        await this.ensureSchema();

        const episodes = await this._loadPendingEpisodes();
        const created = [];

        for (const episode of episodes) {
            try {
                const wikiNeeded = shouldCreateWikiCandidate(episode);
                const skillNeeded = shouldCreateSkillCandidate(episode);
                let wikiCandidate = null;

                if (wikiNeeded) {
                    wikiCandidate = await this._createWikiCandidate(episode);
                    created.push(
                        wikiCandidate.apply_mode === 'auto'
                            ? await this._applyWikiCandidate(wikiCandidate, episode)
                            : wikiCandidate
                    );
                }

                if (skillNeeded) {
                    const skillCandidate = await this._createSkillCandidate(episode, wikiCandidate);
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
}
