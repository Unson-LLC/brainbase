// @ts-check
/**
 * Private Preference Auto-Promotion Policy
 * SPEC-private-preference-promotion Contract-2
 */

const DAILY_LIMIT_DEFAULT = 50;

export class PrivatePreferencePolicy {
    constructor({ dailyLimit = DAILY_LIMIT_DEFAULT } = {}) {
        this.name = 'private-preference';
        this.dailyLimit = dailyLimit;
        /** @type {Map<string, Array<number>>} - owner_person_id → promoted timestamps (ms) */
        this.dailyCounts = new Map();
    }

    /**
     * @param {{cognitive_type:string, visibility:string, sensitivity:string, agency_level:string, owner_person_id:string, actor_person_id:string, redaction_status:string}} candidate
     * @returns {{ applies: boolean, reason: string }}
     */
    applies(candidate) {
        if (candidate.cognitive_type !== 'preference') {
            return { applies: false, reason: 'cognitive_type-not-preference' };
        }
        if (candidate.visibility !== 'owner') {
            return { applies: false, reason: 'visibility-not-owner' };
        }
        if (candidate.sensitivity !== 'internal') {
            return { applies: false, reason: 'sensitivity-too-high' };
        }
        if (!['synthesize', 'read-only'].includes(candidate.agency_level)) {
            return { applies: false, reason: 'agency-level-not-allowed' };
        }
        if (candidate.owner_person_id !== candidate.actor_person_id) {
            return { applies: false, reason: 'owner-actor-mismatch' };
        }
        if (candidate.redaction_status !== 'none') {
            return { applies: false, reason: 'redaction-required' };
        }
        if (this.currentDailyCount(candidate.owner_person_id) >= this.dailyLimit) {
            return { applies: false, reason: 'daily-rate-limit-exceeded' };
        }
        return { applies: true, reason: 'private-preference-auto-promote' };
    }

    /**
     * 今日（UTC同日）の auto-promote 回数
     * @param {string} ownerId
     * @returns {number}
     */
    currentDailyCount(ownerId) {
        const list = this.dailyCounts.get(ownerId) || [];
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const recent = list.filter((t) => t >= cutoff);
        if (recent.length !== list.length) this.dailyCounts.set(ownerId, recent);
        return recent.length;
    }

    recordPromote(ownerId) {
        const list = this.dailyCounts.get(ownerId) || [];
        list.push(Date.now());
        this.dailyCounts.set(ownerId, list);
    }

    targetSubjectType() {
        return 'person';
    }

    buildGraphPayload(candidate) {
        return {
            type: 'person',
            person_id: candidate.owner_person_id,
            preference_attachment: {
                body: candidate.body,
                source_candidate_id: candidate.id,
                confidence: candidate.confidence,
                attached_at: new Date().toISOString()
            }
        };
    }
}
