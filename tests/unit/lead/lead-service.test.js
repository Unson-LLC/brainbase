import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventBus } from '../../../public/modules/core/event-bus.js';
import { Store } from '../../../public/modules/core/store.js';
import { LeadRepository } from '../../../public/modules/domain/lead/lead-repository.js';
import { LeadService } from '../../../public/modules/domain/lead/lead-service.js';

function createLeadStore() {
    const repository = new LeadRepository();
    return new Store({
        lead: {
            repository: repository.createSnapshot(),
            selection: {
                buildingId: null,
                anomalyId: null,
                actorId: null,
                decisionItemId: 'decision-setup-simplification',
                optionId: 'option-request-artifact',
                activeRightPanelMode: 'ops'
            },
            projections: {},
            records: {
                decisionMemos: [],
                escalationPackets: [],
                artifactRequests: []
            }
        }
    });
}

describe('LeadService', () => {
    let store;
    let eventBus;
    let service;

    beforeEach(() => {
        store = createLeadStore();
        eventBus = new EventBus();
        eventBus.emit = vi.fn().mockResolvedValue({ success: 1, errors: [], meta: {} });
        service = new LeadService({ store, eventBus });
    });

    it('requestArtifact呼び出し時_成果物要求を記録して判断項目を更新する', async () => {
        await service.requestArtifact({
            decisionItemId: 'decision-setup-simplification',
            evidenceKey: 'benchmark-comparison-sheet',
            dueAt: '2026-03-15T14:00:00+09:00'
        });

        const state = store.getState().lead;
        expect(state.records.artifactRequests).toHaveLength(1);
        expect(state.records.artifactRequests[0].evidenceKey).toBe('benchmark-comparison-sheet');
        expect(state.repository.decisionItems.find(item => item.id === 'decision-setup-simplification').status).toBe('artifact_requested');
    });

    it('shrinkScopeAndContinue呼び出し時_施策scopeを更新し判断メモを残す', async () => {
        await service.shrinkScopeAndContinue({
            decisionItemId: 'decision-copy-change',
            initiativeId: 'initiative-copy-change',
            scope: '限定顧客のみ'
        });

        const state = store.getState().lead;
        expect(state.repository.initiatives.find(item => item.id === 'initiative-copy-change').scope).toBe('限定顧客のみ');
        expect(state.records.decisionMemos.at(-1).decision).toBe('範囲を縮小して進める');
    });

    it('pauseAndStabilize呼び出し時_openBriefingRoom=trueなら論点整理室を開く', async () => {
        await service.pauseAndStabilize({
            decisionItemId: 'decision-mail-recovery',
            openBriefingRoom: true
        });

        const leadState = store.getState().lead;
        expect(leadState.repository.decisionItems.find(item => item.id === 'decision-mail-recovery').status).toBe('stabilizing');
        expect(leadState.selection.activeRightPanelMode).toBe('briefing');
    });

    it('setArtifactDueDate呼び出し時_既存成果物要求の期限を更新する', async () => {
        await service.requestArtifact({
            decisionItemId: 'decision-setup-simplification',
            evidenceKey: 'benchmark-comparison-sheet'
        });

        await service.setArtifactDueDate({
            decisionItemId: 'decision-setup-simplification',
            dueAt: '2026-03-16T10:00:00+09:00'
        });

        expect(store.getState().lead.records.artifactRequests[0].dueAt).toBe('2026-03-16T10:00:00+09:00');
    });

    it('proceedWithAlternativeEvidence呼び出し時_代替証跡採用の判断メモを残す', async () => {
        await service.proceedWithAlternativeEvidence({
            decisionItemId: 'decision-setup-simplification'
        });

        const leadState = store.getState().lead;
        expect(leadState.repository.decisionItems.find(item => item.id === 'decision-setup-simplification').status).toBe('alternative_evidence_accepted');
        expect(leadState.records.decisionMemos.at(-1).decision).toBe('代替証跡で進める');
    });

    it('rerouteExecution呼び出し時_再割り振りの判断メモを残す', async () => {
        await service.rerouteExecution({
            decisionItemId: 'decision-onboard-stalled',
            optionId: 'option-reroute-onboard'
        });

        const leadState = store.getState().lead;
        expect(leadState.repository.decisionItems.find(item => item.id === 'decision-onboard-stalled').status).toBe('rerouted');
        expect(leadState.records.decisionMemos.at(-1).decision).toBe('再割り振り');
    });

    it('approveDecisionItem呼び出し時_承認状態を更新する', async () => {
        await service.approveDecisionItem({
            decisionItemId: 'decision-copy-change'
        });

        expect(store.getState().lead.repository.decisionItems.find(item => item.id === 'decision-copy-change').status).toBe('approved');
    });

    it('approveDecisionItemWithConstraint呼び出し時_条件付き承認メモを残す', async () => {
        await service.approveDecisionItemWithConstraint({
            decisionItemId: 'decision-copy-change',
            constraint: '対象顧客を限定する'
        });

        const leadState = store.getState().lead;
        expect(leadState.repository.decisionItems.find(item => item.id === 'decision-copy-change').status).toBe('approved_with_constraint');
        expect(leadState.records.decisionMemos.at(-1).rationale).toContain('対象顧客を限定する');
    });

    it('returnDecisionItem呼び出し時_差戻し状態にする', async () => {
        await service.returnDecisionItem({
            decisionItemId: 'decision-copy-change'
        });

        expect(store.getState().lead.repository.decisionItems.find(item => item.id === 'decision-copy-change').status).toBe('returned');
    });

    it('retryExecutionPlan呼び出し時_再試行状態にする', async () => {
        await service.retryExecutionPlan({
            decisionItemId: 'decision-mail-recovery'
        });

        expect(store.getState().lead.repository.decisionItems.find(item => item.id === 'decision-mail-recovery').status).toBe('retrying');
    });

    it('executeViaAlternateRoute呼び出し時_別経路状態にする', async () => {
        await service.executeViaAlternateRoute({
            decisionItemId: 'decision-mail-recovery'
        });

        expect(store.getState().lead.repository.decisionItems.find(item => item.id === 'decision-mail-recovery').status).toBe('alternate_route');
    });

    it('handoffToRecoveryOwner呼び出し時_回復担当へ引き継ぐ', async () => {
        await service.handoffToRecoveryOwner({
            decisionItemId: 'decision-mail-recovery',
            actorId: 'actor-haru'
        });

        expect(store.getState().lead.repository.decisionItems.find(item => item.id === 'decision-mail-recovery').status).toBe('recovery_handoff');
    });

    it('sendToBriefingRoom呼び出し時_右パネルを論点整理室に切り替える', async () => {
        await service.sendToBriefingRoom({
            decisionItemId: 'decision-onboard-stalled'
        });

        const leadState = store.getState().lead;
        expect(leadState.selection.activeRightPanelMode).toBe('briefing');
        expect(leadState.selection.decisionItemId).toBe('decision-onboard-stalled');
    });

    it('createEscalationPacket呼び出し時_上申資料を追加する', async () => {
        await service.createEscalationPacket({
            decisionItemId: 'decision-setup-simplification',
            recommendation: '比較資料完了後に再確認'
        });

        expect(store.getState().lead.records.escalationPackets).toHaveLength(1);
    });

    it('recordDecision呼び出し時_判断メモを追加する', async () => {
        await service.recordDecision({
            decisionItemId: 'decision-setup-simplification',
            decision: '保留',
            rationale: '証跡不足'
        });

        expect(store.getState().lead.records.decisionMemos.at(-1).decision).toBe('保留');
    });

    it('holdDecisionItem呼び出し時_保留状態にする', async () => {
        await service.holdDecisionItem({
            decisionItemId: 'decision-copy-change'
        });

        expect(store.getState().lead.repository.decisionItems.find(item => item.id === 'decision-copy-change').status).toBe('held');
    });

    it('askForBriefとaskForEvidenceReview呼び出し時_イベントを発火する', async () => {
        await service.askForBrief({ decisionItemId: 'decision-setup-simplification' });
        await service.askForEvidenceReview({ decisionItemId: 'decision-setup-simplification' });

        expect(eventBus.emit).toHaveBeenCalledWith('lead:brief-prepared', { decisionItemId: 'decision-setup-simplification' });
        expect(eventBus.emit).toHaveBeenCalledWith('lead:evidence-review-prepared', { decisionItemId: 'decision-setup-simplification' });
    });
});
