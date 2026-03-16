import { beforeEach, describe, expect, it } from 'vitest';

import { DashboardController } from '../../public/modules/dashboard-controller.js';

describe('DashboardController', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div class="view-toggle"></div>
            <button id="nav-console-btn">console</button>
            <button id="nav-dashboard-btn">dashboard</button>
            <div id="console-area" style="display:flex"></div>
            <div id="dashboard-panel"></div>
            <iframe id="terminal-frame"></iframe>
        `;
    });

    it('init呼び出し時_dashboard-panelに現場責任者UIを描画する', async () => {
        const controller = new DashboardController();

        await controller.init();

        expect(document.querySelector('[data-component="lead-console"]')).not.toBeNull();
        expect(document.querySelector('[data-lead-layer="map"]')).not.toBeNull();
        expect(document.querySelector('[data-lead-layer="flow"]')).not.toBeNull();
        expect(document.querySelector('[data-lead-layer="ops"]')).not.toBeNull();
        expect(document.querySelector('[data-lead-layer="actors"]')).not.toBeNull();
        expect(document.querySelector('[data-lead-layer="queue"]')).not.toBeNull();
    });

    it('建物押下時_進行レーンが絞り込まれ右パネルの初期タブが切り替わる', async () => {
        const controller = new DashboardController();
        await controller.init();

        document.querySelector('[data-building-id="building-validation-lab"]').click();

        const flowItems = [...document.querySelectorAll('.lead-flow-item h3')].map((node) => node.textContent);
        expect(flowItems).toEqual(['初回設定簡略化']);
        expect(document.querySelector('.lead-ops-tab').textContent).toContain('割り振り支援');
    });

    it('異常地点押下時_即応パネルに対象判断項目が表示される', async () => {
        const controller = new DashboardController();
        await controller.init();

        document.querySelector('[data-anomaly-id="anomaly-setup-evidence-gap"]').click();

        expect(document.querySelector('.lead-ops-section').textContent).toContain('成果物不足');
        expect(document.querySelector('.lead-ops-section').textContent).toContain('比較資料不足');
    });

    it('AI押下時_担当カードを表示する', async () => {
        const controller = new DashboardController();
        await controller.init();

        document.querySelector('[data-actor-id="actor-mina"]').click();

        const actorCard = document.querySelector('[data-component="lead-actor-card"]');
        expect(actorCard).not.toBeNull();
        expect(actorCard.textContent).toContain('ミナ');
        expect(actorCard.textContent).toContain('比較資料と根拠リンクの補完');
    });

    it('関係AI帯は通常4体までで_もっと見るで全員表示される', async () => {
        const controller = new DashboardController();
        await controller.init();

        expect(document.querySelectorAll('.lead-actor-chip')).toHaveLength(4);

        document.querySelector('[data-action="toggle-actors"]').click();

        expect(document.querySelectorAll('.lead-actor-chip')).toHaveLength(6);
    });

    it('成果物を要求押下時_成果物要求が記録される', async () => {
        const controller = new DashboardController();
        await controller.init();

        document.querySelector('[data-anomaly-id="anomaly-setup-evidence-gap"]').click();
        document.querySelector('[data-command="requestArtifact"]').click();

        const state = controller.store.getState().lead;
        expect(state.records.artifactRequests).toHaveLength(1);
        expect(state.records.artifactRequests[0].evidenceKey).toBe('ベンチマーク比較表');
    });

    it('停止して整理押下時_論点整理室へ切り替わる', async () => {
        const controller = new DashboardController();
        await controller.init();

        document.querySelector('[data-anomaly-id="anomaly-mail-execution-failure"]').click();
        document.querySelector('[data-command="pauseAndStabilize"]').click();

        expect(document.querySelector('.lead-briefing-room')).not.toBeNull();
        expect(document.querySelector('[data-lead-layer="ops"]').textContent).toContain('論点整理室');
    });

    it('論点整理室へ送る押下時_論点整理室へ切り替わる', async () => {
        const controller = new DashboardController();
        await controller.init();

        document.querySelector('[data-anomaly-id="anomaly-onboard-stalled"]').click();
        document.querySelector('[data-command="sendToBriefingRoom"]').click();

        expect(document.querySelector('.lead-briefing-room')).not.toBeNull();
    });

    it('上申資料を作成押下時_上申資料が記録され判断待ち一覧に反映される', async () => {
        const controller = new DashboardController();
        await controller.init();

        document.querySelector('[data-anomaly-id="anomaly-setup-evidence-gap"]').click();
        document.querySelector('[data-command="createEscalationPacket"]').click();

        const state = controller.store.getState().lead;
        expect(state.records.escalationPackets).toHaveLength(1);
        expect(document.querySelector('[data-lead-layer="queue"]').textContent).toContain('上申中');
    });
});
