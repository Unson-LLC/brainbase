// @ts-check
/**
 * SNS Read-Only Curator (SPEC-sns-readonly-curator)
 * Graph traversal結果からSNS draft 推薦を作り、candidate-store に書き込む。投稿実行はしない。
 */

import { scoreDraftCandidate } from './curator-scoring.js';

const DEFAULT_DAILY_LIMIT = 30;

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
        const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
        const entities = await this.graphReader.listRecentEntities({ since, viewer });
        // INV-5: agency_level=none は除外
        return entities.filter((e) => e.agency_level !== 'none');
    }

    /**
     * @param {any} viewer
     * @param {{limit?: number, llmEnabled?: boolean, history?: Array<any>}} [options]
     */
    async generateDrafts(viewer, options = {}) {
        const { limit = 5, history = [] } = options;
        const sources = await this.listSourceEntities(viewer);
        const drafts = [];
        for (const src of sources) {
            if (drafts.length >= limit) break;
            const { score, breakdown } = scoreDraftCandidate(src, viewer, history);
            if (score <= 0) continue;
            drafts.push({
                source_entity_id: src.id,
                cognitive_type: 'claim',
                body: src.body,  // LLM disabled mode: paraphrase なし
                score,
                breakdown,
                derived_from: [src.id]
            });
        }
        return drafts.sort((a, b) => b.score - a.score);
    }

    _todayCount(sub) {
        const list = this.dailyCounts.get(sub) || [];
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const recent = list.filter((t) => t >= cutoff);
        if (recent.length !== list.length) this.dailyCounts.set(sub, recent);
        return recent.length;
    }

    /**
     * draft → candidate-store に書く
     */
    async saveDraftsToCandidateStore(drafts, viewer) {
        if (!this.candidateService) throw new Error('candidateService required');
        const saved = [];
        for (const d of drafts) {
            if (this._todayCount(viewer.sub) >= this.dailyLimit) {
                break;  // rate limit overflow → skip remaining
            }
            const result = await this.candidateService.createCandidate({
                cognitive_type: 'claim',
                owner_person_id: viewer.sub,
                actor_person_id: viewer.sub,
                source_system: 'sns-curator',
                source_event_ids: [`curator:${d.source_entity_id}:${Date.now()}`],
                workspace: viewer.workspace || 'unson',
                org_ids: viewer.org_ids || ['unson'],
                visibility: 'owner',
                sensitivity: 'internal',
                role_min: 'member',
                agency_level: 'synthesize',
                body: d.body,
                requires_approval: true,
                evidence_ids: [{
                    raw_event_id: `curator:${d.source_entity_id}`,
                    uri: `graph:entity:${d.source_entity_id}`,
                    hash: 'sha256:source'
                }],
                permission_snapshot: { roles: [viewer.role || 'member'] },
                recommended_subject_type: null
            });
            if (!result.blocked) {
                this.dailyCounts.set(viewer.sub, [...(this.dailyCounts.get(viewer.sub) || []), Date.now()]);
                saved.push({ candidate: result.candidate, scoreBreakdown: d.breakdown, score: d.score });
            }
        }
        return saved;
    }
}
