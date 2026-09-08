// @ts-check
/**
 * SNS Read-Only Public Lifelog Curator
 *
 * Personal KGの本人一次体験を、本文を書き換えずreview candidateへ移す。
 * 投稿実行、読者最適化、助言生成は行わない。
 */

import { requirePersonalKgIdentity } from './personal-kg-identity.js';

const DEFAULT_DAILY_LIMIT = 30;
const LIFELOG_CATEGORIES = new Set([
    'daily_log',
    'work_log',
    'life_log',
    'memory',
    'unresolved',
    'proof'
]);
const FIRST_PERSON_EXPERIENCE_PATTERN = /俺|私|自分|うち|今日|昨日|今朝|今夜|やってみ|作った|決めた|迷っ|失敗|止まった|感じた|思い出した|残しておく|まだ答え/u;
const ADVICE_PATTERN = /すべき|した方がいい|しよう|してください|正解は|最初に見るべき|間違えてる|できてない|みんなはどう|詳しくは|DM(?:ください)?|プロフィール(?:へ|から)|問い合わせ/u;

function lifelogCheck(source) {
    const body = String(source?.body || '').trim();
    const category = source?.category || null;
    const risks = [];
    if (!LIFELOG_CATEGORIES.has(category) && source?.lifelog_ready !== true) risks.push('not_lifelog_category');
    if (!FIRST_PERSON_EXPERIENCE_PATTERN.test(body)) risks.push('missing_first_person_experience');
    if (ADVICE_PATTERN.test(body)) risks.push('advice_or_instruction');
    return {
        decision: risks.length === 0 ? 'pass' : 'blocked',
        source_id: source?.id || null,
        source_category: category,
        first_person_evidence: risks.length === 0,
        risks
    };
}

export class SnsReadonlyCurator {
    /**
     * @param {{
     *   graphReader: { listRecentEntities: (opts:{since:string, viewer:any}) => Promise<Array<any>> },
     *   candidateService?: any,
     *   dailyLimit?: number
     * }} deps
     */
    constructor({ graphReader, candidateService = null, dailyLimit = DEFAULT_DAILY_LIMIT }) {
        if (!graphReader || typeof graphReader.listRecentEntities !== 'function') {
            throw new Error('graphReader required');
        }
        this.graphReader = graphReader;
        this.candidateService = candidateService;
        this.dailyLimit = dailyLimit;
        /** @type {Map<string, Array<number>>} viewer.sub → timestamps */
        this.dailyCounts = new Map();
    }

    async listSourceEntities(viewer, { lookbackDays = 7 } = {}) {
        const identity = requirePersonalKgIdentity(viewer);
        const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
        const entities = await this.graphReader.listRecentEntities({ since, viewer: identity });
        return entities
            .filter((entity) => entity.agency_level !== 'none')
            .filter((entity) => lifelogCheck(entity).decision === 'pass');
    }

    async generateDrafts(viewer, { limit = 5 } = {}) {
        const identity = requirePersonalKgIdentity(viewer);
        const sources = await this.listSourceEntities(identity);
        return sources.slice(0, limit).map((source) => ({
            source_entity_id: source.id,
            cognitive_type: 'observation',
            body: source.body,
            score: 1,
            breakdown: { source_fidelity: 1 },
            derived_from: [source.id],
            evidence_ids: source.evidence_ids || [],
            lifelog_check: lifelogCheck(source)
        }));
    }

    _todayCount(sub) {
        const list = this.dailyCounts.get(sub) || [];
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const recent = list.filter((timestamp) => timestamp >= cutoff);
        if (recent.length !== list.length) this.dailyCounts.set(sub, recent);
        return recent.length;
    }

    async saveDraftsToCandidateStore(drafts, viewer) {
        if (!this.candidateService) throw new Error('candidateService required');
        const identity = requirePersonalKgIdentity(viewer);
        const saved = [];
        for (const draft of drafts) {
            if (draft.lifelog_check?.decision !== 'pass') {
                throw new Error('lifelog_check pass required');
            }
            if (this._todayCount(identity.owner_person_id) >= this.dailyLimit) break;
            const result = await this.candidateService.createCandidate({
                cognitive_type: 'observation',
                owner_person_id: identity.owner_person_id,
                actor_person_id: identity.actor_person_id,
                organization_id: identity.organization_id,
                source_system: 'sns-lifelog-curator',
                source_event_ids: [`lifelog-curator:${draft.source_entity_id}:${Date.now()}`],
                workspace: identity.workspace || identity.organization_id,
                org_ids: identity.org_ids,
                visibility: 'owner',
                sensitivity: 'internal',
                role_min: 'member',
                agency_level: 'synthesize',
                body: draft.body,
                requires_approval: true,
                evidence_ids: draft.evidence_ids?.length > 0
                    ? draft.evidence_ids
                    : [{
                        raw_event_id: `lifelog-curator:${draft.source_entity_id}`,
                        uri: `graph:entity:${draft.source_entity_id}`,
                        hash: 'sha256:source'
                    }],
                permission_snapshot: {
                    roles: [identity.role || 'member'],
                    personal_kg_identity: {
                        owner_person_id: identity.owner_person_id,
                        actor_person_id: identity.actor_person_id,
                        organization_id: identity.organization_id
                    },
                    seed: { category: draft.lifelog_check.source_category },
                    sns: {
                        mode: 'public_lifelog',
                        lifelog_check: draft.lifelog_check
                    }
                },
                recommended_subject_type: null
            });
            if (!result.blocked) {
                this.dailyCounts.set(identity.owner_person_id, [...(this.dailyCounts.get(identity.owner_person_id) || []), Date.now()]);
                saved.push({ candidate: result.candidate, scoreBreakdown: draft.breakdown, score: draft.score });
            }
        }
        return saved;
    }
}
