// @ts-check
/**
 * Brainbase Activity Adapter
 * SPEC-candidate-store-mvp Contract-4
 * session/terminal log を Raw Ledger envelope に正規化（生 transcript は Graph に流さない）
 */

import { createHash } from 'crypto';

/**
 * @typedef {Object} BrainbaseSession
 * @property {string} id
 * @property {string} owner_person_id
 * @property {string} workspace
 * @property {string=} channel_id
 * @property {string=} project_code
 * @property {Array<string>=} org_ids
 * @property {string} started_at
 * @property {string} ended_at
 * @property {string=} terminal_text
 * @property {Array<string>=} highlights  // sato が手動で marker を打った行
 * @property {Object=} permission_snapshot
 */

/**
 * @typedef {Object} RawLedgerRecord
 * @property {string} raw_event_id
 * @property {'brainbase'} source_system
 * @property {string} source_event_id
 * @property {string} occurred_at
 * @property {string} captured_at
 * @property {string} actor_external_id
 * @property {string} actor_person_id
 * @property {string} workspace
 * @property {string|null} channel_id
 * @property {string|null} project_code
 * @property {Object} permission_snapshot
 * @property {{kind:string, uri:string, hash:string}} evidence_ref
 * @property {'envelope_only'} retention_policy
 * @property {string=} snippet
 */

function hash(text) {
    return 'sha256:' + createHash('sha256').update(text || '', 'utf8').digest('hex');
}

let ledgerCounter = 0;
function nextLedgerId(source) {
    ledgerCounter += 1;
    return `raw_${source}_${Date.now()}_${ledgerCounter.toString(36)}`;
}

/**
 * brainbase session を Raw Ledger envelope 配列に変換
 * 生 transcript 本文は載せない、hash + uri pointer のみ。snippet（最大 300字）は許容。
 *
 * @param {BrainbaseSession} session
 * @returns {RawLedgerRecord[]}
 */
export function brainbaseSessionToRawLedger(session) {
    if (!session || !session.id || !session.owner_person_id) {
        throw new Error('session: id and owner_person_id required');
    }

    const captured_at = new Date().toISOString();
    const baseEvidence = {
        kind: 'source_pointer',
        uri: `brainbase:session:${session.id}`,
        hash: hash(session.terminal_text || '')
    };

    const baseRecord = {
        raw_event_id: nextLedgerId('brainbase'),
        source_system: 'brainbase',
        source_event_id: `session:${session.id}`,
        occurred_at: session.ended_at || captured_at,
        captured_at,
        actor_external_id: session.owner_person_id,
        actor_person_id: session.owner_person_id,
        workspace: session.workspace,
        channel_id: session.channel_id || null,
        project_code: session.project_code || null,
        permission_snapshot: session.permission_snapshot || { roles: [], project_membership: !!session.project_code },
        evidence_ref: baseEvidence,
        retention_policy: 'envelope_only'
    };

    const records = [baseRecord];

    if (Array.isArray(session.highlights) && session.highlights.length > 0) {
        session.highlights.forEach((line, idx) => {
            const snippet = line.slice(0, 300);
            records.push({
                ...baseRecord,
                raw_event_id: nextLedgerId('brainbase'),
                source_event_id: `session:${session.id}:hl:${idx}`,
                evidence_ref: {
                    kind: 'source_pointer',
                    uri: `brainbase:session:${session.id}#highlight-${idx}`,
                    hash: hash(line)
                },
                snippet
            });
        });
    }

    return records;
}
