// @ts-check
/**
 * Dreaming Job
 * SPEC-candidate-store-mvp Contract-5
 * Raw Ledger record から candidate draft を生成（Graph SSOT に直接書かない、INV-6）
 *
 * Deterministic mode（DREAMING_LLM_ENABLED!=='true'）では LLM 呼ばず、rule-based 抽出のみ。
 * テストでは deterministic mode を前提とする。
 */

import { scan } from './pii-scanner.js';

const INSIGHT_KEYWORDS = ['気づいた', 'わかった', '思った', 'やはり', '判明', '結論', 'realize', 'discovered'];
const PREFERENCE_KEYWORDS = ['好き', '派', '使いたい', 'prefer', '好み', '基本的に'];
const CLAIM_KEYWORDS = ['べき', '不要', '必要', 'should', '正しい', '違う'];
const HYPOTHESIS_KEYWORDS = ['仮説', 'たぶん', 'おそらく', 'もしかすると', 'hypothesis'];

/**
 * テキストから cognitive_type を推定（保守的に、observation default）
 * @param {string} text
 * @returns {{cognitive_type: string, confidence: number, recommended_subject_type: string|null}}
 */
function classifyCognitive(text) {
    if (!text) return { cognitive_type: 'observation', confidence: 0.3, recommended_subject_type: null };
    const lower = text.toLowerCase();
    if (PREFERENCE_KEYWORDS.some((k) => text.includes(k) || lower.includes(k.toLowerCase()))) {
        return { cognitive_type: 'preference', confidence: 0.7, recommended_subject_type: 'person' };
    }
    if (HYPOTHESIS_KEYWORDS.some((k) => text.includes(k) || lower.includes(k.toLowerCase()))) {
        return { cognitive_type: 'hypothesis', confidence: 0.6, recommended_subject_type: null };
    }
    if (INSIGHT_KEYWORDS.some((k) => text.includes(k) || lower.includes(k.toLowerCase()))) {
        return { cognitive_type: 'insight', confidence: 0.6, recommended_subject_type: null };
    }
    if (CLAIM_KEYWORDS.some((k) => text.includes(k) || lower.includes(k.toLowerCase()))) {
        return { cognitive_type: 'claim', confidence: 0.55, recommended_subject_type: null };
    }
    return { cognitive_type: 'observation', confidence: 0.4, recommended_subject_type: null };
}

/**
 * @typedef {Object} CandidateDraft
 * @property {string} cognitive_type
 * @property {string} body
 * @property {number} confidence
 * @property {string|null} recommended_subject_type
 * @property {Array<string>} source_event_ids
 * @property {string} owner_person_id
 * @property {string} actor_person_id
 * @property {string} source_system
 * @property {string=} workspace
 * @property {string=} channel_id
 * @property {string|null=} project_code
 * @property {Array<string>} org_ids
 * @property {string} visibility
 * @property {string} sensitivity
 * @property {string} role_min
 * @property {string} agency_level
 * @property {boolean} requires_approval
 * @property {string} redaction_status
 * @property {Object} permission_snapshot
 * @property {Array<{raw_event_id:string,uri:string,hash:string}>} evidence_ids
 */

/**
 * Dreaming pass: raw record(s) → candidate draft(s)
 * scope を引数で指定（personal/project/org）
 *
 * @param {Array<import('./raw-ledger-adapter.js').RawLedgerRecord>} rawRecords
 * @param {{ scope?: 'personal'|'project'|'org', defaultOrgIds?: Array<string> }} [options]
 * @returns {{ drafts: CandidateDraft[], blocked: Array<{source_event_id:string, findings:Array<any>}> }}
 */
export function dreamingPass(rawRecords, options = {}) {
    const drafts = [];
    const blocked = [];
    const scope = options.scope || 'personal';
    const defaultOrgIds = options.defaultOrgIds || [];

    for (const raw of rawRecords) {
        const text = raw.snippet || '';
        if (!text) {
            // session 全体イベントには本文がない → observation の最小 draft を作るか skip
            continue;
        }

        const scanResult = scan(text);
        if (scanResult.block) {
            blocked.push({
                source_event_id: raw.source_event_id,
                findings: scanResult.findings
            });
            continue;
        }

        const classified = classifyCognitive(text);
        const redaction_status = scanResult.review ? 'needs_redaction' : 'none';

        const visibility = scope === 'personal' ? 'owner' : scope === 'project' ? 'team' : 'org';
        const agency_level = classified.cognitive_type === 'preference' ? 'synthesize' : 'synthesize';

        drafts.push({
            cognitive_type: classified.cognitive_type,
            body: text,
            confidence: classified.confidence,
            recommended_subject_type: classified.recommended_subject_type,
            source_event_ids: [raw.source_event_id],
            owner_person_id: raw.actor_person_id,
            actor_person_id: raw.actor_person_id,
            source_system: raw.source_system,
            workspace: raw.workspace,
            channel_id: raw.channel_id,
            project_code: raw.project_code,
            org_ids: defaultOrgIds,
            visibility,
            sensitivity: 'internal',
            role_min: 'member',
            agency_level,
            requires_approval: classified.cognitive_type !== 'preference',
            redaction_status,
            permission_snapshot: raw.permission_snapshot,
            evidence_ids: [{
                raw_event_id: raw.raw_event_id,
                uri: raw.evidence_ref.uri,
                hash: raw.evidence_ref.hash
            }]
        });
    }

    return { drafts, blocked };
}
