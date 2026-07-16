import { describe, expect, it } from 'vitest';

import { renderRunReceiptInbox } from '../../../public/modules/domain/run-receipt/run-receipt-inbox-view.js';

function inbox(overrides = {}) {
    return {
        status: 'ready',
        items: [],
        count: 0,
        has_more: false,
        omitted_count: 0,
        error: null,
        filters: {},
        ...overrides
    };
}

describe('renderRunReceiptInbox', () => {
    it('専用sectionとlabel付き4 filterとlive statusを描画する', () => {
        const html = renderRunReceiptInbox(inbox(), { projects: ['brainbase', 'mana'] });

        expect(html).toContain('id="agent-run-inbox"');
        expect(html).toContain('id="agent-run-inbox-status" role="status" aria-live="polite"');
        for (const id of ['run-receipt-project', 'run-receipt-source', 'run-receipt-status', 'run-receipt-evidence']) {
            expect(html).toContain(`for="${id}"`);
            expect(html).toContain(`id="${id}"`);
        }
    });

    it('receiptごとにsource status evidence action blocker refsを文字でも表示する', () => {
        const html = renderRunReceiptInbox(inbox({
            items: [{
                id: 'run-1',
                project_id: 'brainbase',
                source: { type: 'github_actions', workflow_id: 'deploy', name: 'Deploy', runtime_target: 'production' },
                source_status: 'blocked',
                evidence_state: 'no_data',
                source_action_required: true,
                source_action: 'review_run',
                blocker_reason: 'production approval required',
                summary: 'Deployment is waiting',
                evidence_refs: [{ kind: 'log_ref', ref: 'github-actions:run/1' }],
                metrics: { attempts: 2 },
                effective_at: '2026-07-15T00:00:00Z'
            }],
            count: 1
        }));

        expect(html).toContain('GitHub Actions');
        expect(html).toContain('blocked');
        expect(html).toContain('no_data');
        expect(html).toContain('review_run');
        expect(html).toContain('production approval required');
        expect(html).toContain('log_ref');
        expect(html).toContain('attempts');
    });

    it('HTTPS URL evidenceを安全な別tab linkとして描画する', () => {
        const evidenceUrl = 'https://evidence.example.invalid/runs/run-1';
        const html = renderRunReceiptInbox(inbox({
            items: [{
                id: 'run-url', project_id: 'brainbase',
                source: { type: 'github_actions', workflow_id: 'deploy' },
                source_status: 'success', evidence_state: 'confirmed',
                evidence_refs: [{ kind: 'url', ref: evidenceUrl }], metrics: {}
            }],
            count: 1
        }));

        expect(html).toContain(`href="${evidenceUrl}"`);
        expect(html).toContain('target="_blank"');
        expect(html).toContain('rel="noopener noreferrer"');
        expect(html).toContain(`aria-label="Open evidence URL: ${evidenceUrl}"`);
    });

    it('安全でないURL evidenceはlinkにせず文字として表示する', () => {
        const html = renderRunReceiptInbox(inbox({
            items: [{
                id: 'run-unsafe-url', project_id: 'brainbase',
                source: { type: 'mana', workflow_id: 'daily' },
                source_status: 'success', evidence_state: 'confirmed',
                evidence_refs: [{ kind: 'url', ref: 'javascript:alert(1)' }], metrics: {}
            }],
            count: 1
        }));

        expect(html).toContain('<code>url: javascript:alert(1)</code>');
        expect(html).not.toContain('href="javascript:');
    });

    it('loading中_再描画で未送信filterを失わないようcontrolsを無効化する', () => {
        const html = renderRunReceiptInbox(inbox({ status: 'loading' }));

        expect(html).toContain('更新中。取得完了まで件数は未確認です。');
        expect(html).not.toContain('該当するRun Receiptはありません');
        for (const id of [
            'run-receipt-project',
            'run-receipt-source',
            'run-receipt-status',
            'run-receipt-evidence'
        ]) {
            expect(html).toContain(`id="${id}" disabled`);
        }
        expect(html).toContain('type="submit" disabled>Apply</button>');
        expect(html).toContain('data-action="reset-run-receipt-filters" disabled>Reset</button>');
    });

    it('readyかつ0件のときだけ_確認済みの空状態を表示する', () => {
        const html = renderRunReceiptInbox(inbox({ status: 'ready', items: [], count: 0 }));

        expect(html).toContain('0件を確認済み');
        expect(html).toContain('該当するRun Receiptはありません');
        expect(html).not.toContain('取得完了まで件数は未確認です');
    });

    it('source_actionがnoneのfailed receiptは正規化済みcheck_errorを表示する', () => {
        const html = renderRunReceiptInbox(inbox({
            items: [{
                id: 'failed-run',
                project_id: 'brainbase',
                source: { type: 'mana', workflow_id: 'daily' },
                source_status: 'failed',
                evidence_state: 'unconfirmed',
                source_action_required: false,
                source_action: 'none',
                action_required: 'check_error',
                blocker_reason: null,
                evidence_refs: [],
                metrics: {}
            }],
            count: 1
        }));

        expect(html).toContain('<dt>Action</dt><dd>check_error</dd>');
        expect(html).not.toContain('<dt>Action</dt><dd>none</dd>');
    });

    it('connector_observationを通常runと区別する文字labelで表示する', () => {
        const html = renderRunReceiptInbox(inbox({
            items: [{
                id: 'connector-observation-1',
                project_id: 'brainbase',
                source: { type: 'mana', workflow_id: '__connector_observation__' },
                observation_kind: 'connector_observation',
                source_status: 'blocked',
                evidence_state: 'unconfirmed',
                source_action: 'check_error',
                blocker_reason: 'source run identity unavailable',
                evidence_refs: [],
                metrics: {}
            }],
            count: 1
        }));

        expect(html).toContain('data-observation-kind="connector_observation"');
        expect(html).toContain('Connector observation');
        expect(html).not.toContain('<strong>__connector_observation__</strong>');
    });

    it('unavailable時_前回確認済みsnapshotを残して0件扱いしない', () => {
        const html = renderRunReceiptInbox(inbox({
            status: 'unavailable',
            items: [{
                id: 'last-run', project_id: 'mana',
                source: { type: 'mana', workflow_id: 'daily' },
                source_status: 'success', evidence_state: 'confirmed', evidence_refs: [], metrics: {}
            }],
            count: 1,
            error: 'HTTP 503'
        }));

        expect(html).toContain('取得不能');
        expect(html).toContain('前回確認済み');
        expect(html).toContain('last-run');
        expect(html).not.toContain('該当するRun Receiptはありません');
    });

    it('表示値をHTML escapeする', () => {
        const html = renderRunReceiptInbox(inbox({
            items: [{
                id: '<img src=x onerror=alert(1)>', project_id: 'brainbase',
                source: { type: 'mana', workflow_id: '<script>x</script>' },
                source_status: 'failed', evidence_state: 'unconfirmed', evidence_refs: [], metrics: {}
            }],
            count: 1
        }));

        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;script&gt;');
    });
});
