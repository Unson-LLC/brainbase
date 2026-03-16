import { cloneLeadValue } from './lead-fixtures.js';

function createRef(prefix, id) {
    return `${prefix}:${id}`;
}

function updateLeadState(store, updater) {
    const currentLeadState = store.getState().lead;
    const nextLeadState = updater(cloneLeadValue(currentLeadState));
    store.setState({ lead: nextLeadState });
    return nextLeadState;
}

function findDecisionItem(leadState, decisionItemId) {
    return leadState.repository.decisionItems.find(item => item.id === decisionItemId);
}

function findInitiative(leadState, initiativeId) {
    return leadState.repository.initiatives.find(item => item.id === initiativeId);
}

function pushDecisionMemo(leadState, memo) {
    leadState.records.decisionMemos.push({
        id: `memo-${leadState.records.decisionMemos.length + 1}`,
        ...memo
    });
}

export class LeadService {
    constructor({ store, eventBus }) {
        this.store = store;
        this.eventBus = eventBus;
    }

    async requestArtifact({ decisionItemId, evidenceKey, dueAt = null }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            leadState.records.artifactRequests.push({
                id: `artifact-${leadState.records.artifactRequests.length + 1}`,
                decisionItemId,
                evidenceKey,
                dueAt
            });
            const item = findDecisionItem(leadState, decisionItemId);
            if (item) item.status = 'artifact_requested';
            return leadState;
        });

        await this.eventBus.emit?.('lead:artifact-requested', { decisionItemId, evidenceKey, dueAt });
        return nextState;
    }

    async setArtifactDueDate({ decisionItemId, dueAt }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            const request = leadState.records.artifactRequests.find(item => item.decisionItemId === decisionItemId);
            if (request) request.dueAt = dueAt;
            return leadState;
        });

        await this.eventBus.emit?.('lead:artifact-due-date-set', { decisionItemId, dueAt });
        return nextState;
    }

    async proceedWithAlternativeEvidence({ decisionItemId, rationale = '代替証跡で進める' }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            const item = findDecisionItem(leadState, decisionItemId);
            if (item) {
                item.status = 'alternative_evidence_accepted';
            }
            pushDecisionMemo(leadState, {
                decisionItemId,
                decision: '代替証跡で進める',
                rationale,
                evidenceRefs: [createRef('decision', decisionItemId)],
                transcriptRefs: [createRef('transcript', decisionItemId)],
                reviewCondition: '正式証跡が揃い次第見直す'
            });
            return leadState;
        });

        await this.eventBus.emit?.('lead:alternative-evidence-accepted', { decisionItemId });
        return nextState;
    }

    async rerouteExecution({ decisionItemId, optionId = null }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            const item = findDecisionItem(leadState, decisionItemId);
            if (item) {
                item.status = 'rerouted';
            }
            pushDecisionMemo(leadState, {
                decisionItemId,
                decision: '再割り振り',
                rationale: optionId ? `選択案 ${optionId} に沿って再割り振り` : '再割り振りを実施',
                evidenceRefs: [createRef('decision', decisionItemId)],
                transcriptRefs: [createRef('transcript', decisionItemId)],
                reviewCondition: '2時間後に停滞を再確認'
            });
            return leadState;
        });

        await this.eventBus.emit?.('lead:reroute-issued', { decisionItemId, optionId });
        return nextState;
    }

    async shrinkScopeAndContinue({ decisionItemId, initiativeId, scope }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            const initiative = findInitiative(leadState, initiativeId);
            if (initiative) {
                initiative.scope = scope;
                initiative.executionHealth = '処理中';
            }
            pushDecisionMemo(leadState, {
                decisionItemId,
                decision: '範囲を縮小して進める',
                rationale: `scope を ${scope} に変更`,
                evidenceRefs: [createRef('initiative', initiativeId)],
                transcriptRefs: [createRef('transcript', decisionItemId)],
                reviewCondition: '次の承認前確認で再評価'
            });
            return leadState;
        });

        await this.eventBus.emit?.('lead:scope-shrunk', { decisionItemId, initiativeId, scope });
        return nextState;
    }

    async approveDecisionItem({ decisionItemId }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            const item = findDecisionItem(leadState, decisionItemId);
            if (item) item.status = 'approved';
            return leadState;
        });
        await this.eventBus.emit?.('lead:decision-approved', { decisionItemId });
        return nextState;
    }

    async approveDecisionItemWithConstraint({ decisionItemId, constraint }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            const item = findDecisionItem(leadState, decisionItemId);
            if (item) item.status = 'approved_with_constraint';
            pushDecisionMemo(leadState, {
                decisionItemId,
                decision: '条件付き承認',
                rationale: constraint,
                evidenceRefs: [createRef('decision', decisionItemId)],
                transcriptRefs: [createRef('transcript', decisionItemId)],
                reviewCondition: '条件逸脱時に差戻し'
            });
            return leadState;
        });
        await this.eventBus.emit?.('lead:decision-approved-with-constraint', { decisionItemId, constraint });
        return nextState;
    }

    async returnDecisionItem({ decisionItemId }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            const item = findDecisionItem(leadState, decisionItemId);
            if (item) item.status = 'returned';
            return leadState;
        });
        await this.eventBus.emit?.('lead:decision-returned', { decisionItemId });
        return nextState;
    }

    async retryExecutionPlan({ decisionItemId }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            const item = findDecisionItem(leadState, decisionItemId);
            if (item) item.status = 'retrying';
            return leadState;
        });
        await this.eventBus.emit?.('lead:execution-retried', { decisionItemId });
        return nextState;
    }

    async executeViaAlternateRoute({ decisionItemId }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            const item = findDecisionItem(leadState, decisionItemId);
            if (item) item.status = 'alternate_route';
            return leadState;
        });
        await this.eventBus.emit?.('lead:execution-rerouted', { decisionItemId });
        return nextState;
    }

    async handoffToRecoveryOwner({ decisionItemId, actorId = 'actor-haru' }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            const item = findDecisionItem(leadState, decisionItemId);
            if (item) {
                item.status = 'recovery_handoff';
                if (!item.relatedActorIds.includes(actorId)) {
                    item.relatedActorIds.push(actorId);
                }
            }
            return leadState;
        });
        await this.eventBus.emit?.('lead:recovery-owner-assigned', { decisionItemId, actorId });
        return nextState;
    }

    async pauseAndStabilize({ decisionItemId, openBriefingRoom = false }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            const item = findDecisionItem(leadState, decisionItemId);
            if (item) item.status = 'stabilizing';
            leadState.selection.activeRightPanelMode = openBriefingRoom ? 'briefing' : 'ops';
            leadState.selection.decisionItemId = decisionItemId;
            return leadState;
        });
        await this.eventBus.emit?.('lead:execution-stabilization-started', { decisionItemId, openBriefingRoom });
        return nextState;
    }

    async sendToBriefingRoom({ decisionItemId }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            leadState.selection.activeRightPanelMode = 'briefing';
            leadState.selection.decisionItemId = decisionItemId;
            return leadState;
        });
        await this.eventBus.emit?.('lead:briefing-room-requested', { decisionItemId });
        return nextState;
    }

    async createEscalationPacket({ decisionItemId, recommendation = '推奨案を上申' }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            leadState.records.escalationPackets.push({
                id: `escalation-${leadState.records.escalationPackets.length + 1}`,
                decisionItemId,
                recommendation
            });
            return leadState;
        });
        await this.eventBus.emit?.('lead:escalation-packet-created', { decisionItemId });
        return nextState;
    }

    async recordDecision({ decisionItemId, decision, rationale }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            pushDecisionMemo(leadState, {
                decisionItemId,
                decision,
                rationale,
                evidenceRefs: [createRef('decision', decisionItemId)],
                transcriptRefs: [createRef('transcript', decisionItemId)],
                reviewCondition: '次回の類似判断で参照'
            });
            return leadState;
        });
        await this.eventBus.emit?.('lead:decision-recorded', { decisionItemId, decision });
        return nextState;
    }

    async holdDecisionItem({ decisionItemId }) {
        const nextState = updateLeadState(this.store, (leadState) => {
            const item = findDecisionItem(leadState, decisionItemId);
            if (item) item.status = 'held';
            return leadState;
        });
        await this.eventBus.emit?.('lead:decision-held', { decisionItemId });
        return nextState;
    }

    async askForBrief({ decisionItemId }) {
        await this.eventBus.emit?.('lead:brief-prepared', { decisionItemId });
        return { decisionItemId };
    }

    async askForEvidenceReview({ decisionItemId }) {
        await this.eventBus.emit?.('lead:evidence-review-prepared', { decisionItemId });
        return { decisionItemId };
    }
}
