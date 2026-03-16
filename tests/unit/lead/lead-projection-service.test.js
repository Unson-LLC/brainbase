import { describe, expect, it } from 'vitest';

import { LeadProjectionService } from '../../../public/modules/domain/lead/lead-projection-service.js';
import { LeadRepository } from '../../../public/modules/domain/lead/lead-repository.js';

function buildState(selection = {}) {
    const repository = new LeadRepository();
    const snapshot = repository.createSnapshot();

    return {
        lead: {
            repository: snapshot,
            selection: {
                buildingId: null,
                anomalyId: null,
                actorId: null,
                decisionItemId: null,
                optionId: null,
                activeRightPanelMode: 'ops',
                ...selection
            },
            records: snapshot.records
        }
    };
}

describe('LeadProjectionService', () => {
    it('建物選択時_進行レーンを絞り込み即応パネル初期タブを切り替える', () => {
        const service = new LeadProjectionService();
        const state = buildState({ buildingId: 'building-validation-lab' });

        const projections = service.build(state);

        expect(projections.flowLane.items).toHaveLength(1);
        expect(projections.flowLane.items[0].initiativeId).toBe('initiative-setup-simplification');
        expect(projections.opsPanel.activeTab).toBe('割り振り支援');
    });

    it('異常地点選択時_即応パネルを直接開いて対象判断項目を表示する', () => {
        const service = new LeadProjectionService();
        const state = buildState({
            anomalyId: 'anomaly-setup-evidence-gap',
            decisionItemId: 'decision-setup-simplification'
        });

        const projections = service.build(state);

        expect(projections.opsPanel.mode).toBe('ops');
        expect(projections.opsPanel.selectedDecisionItem.id).toBe('decision-setup-simplification');
        expect(projections.opsPanel.status.label).toBe('成果物不足');
    });

    it('AI選択時_担当カードを返し担当施策で絞り込める', () => {
        const service = new LeadProjectionService();
        const state = buildState({ actorId: 'actor-mina' });

        const projections = service.build(state);

        expect(projections.actorStrip.selectedActor.id).toBe('actor-mina');
        expect(projections.actorStrip.selectedActor.currentInitiativeId).toBe('initiative-setup-simplification');
        expect(projections.actorStrip.selectedActor.card.discretionScope).toContain('比較資料');
    });
});
