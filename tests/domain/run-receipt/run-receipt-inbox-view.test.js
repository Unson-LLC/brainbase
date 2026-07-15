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
                source_action: 'approve_deploy',
                blocker_reason: 'production approval required',
                summary: 'Deployment is waiting',
                evidence_refs: [{ kind: 'workflow_url', ref: 'https://example.test/run/1' }],
                metrics: { attempts: 2 },
                effective_at: '2026-07-15T00:00:00Z'
            }],
            count: 1
        }));

        expect(html).toContain('GitHub Actions');
        expect(html).toContain('blocked');
        expect(html).toContain('no_data');
        expect(html).toContain('approve_deploy');
        expect(html).toContain('production approval required');
        expect(html).toContain('workflow_url');
        expect(html).toContain('attempts');
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
